"""TrueCover pixel analysis-provider HTTP service.

Exposes the pixel execution contract (see pixel's `worker/analyses/provider.py`
for the calling side): a manifest of supported operations, and one POST route
per operation that reads its input parquet by URL, runs the op, and writes
its output parquet by URL. Pixel never sends bytes through this service
directly — `inputs[*].parquet_url` and `output.parquet_put_url` are either
`file://` paths (tests, local dev) or presigned HTTP URLs the provider GETs /
PUTs directly.

Every route requires `Authorization: Bearer <PROVIDER_TOKEN>` — this is
pixel's authorization to call us; the presigned URLs it hands us are our only
authorization to its data (we never see pixel credentials).
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import mercantile
import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from provider.algorithm import (
    _row_centroid_lat,
    adaptive_sample_indices,
    build_sample_frame,
)

app = FastAPI(title="TrueCover provider")

_HTTP_TIMEOUT_S = 300.0

R_SCRIPT_PATH = Path(__file__).parent / "r" / "coverage_estimate.R"

MANIFEST: dict[str, Any] = {
    "name": "TrueCover",
    "operations": [
        {
            "id": "adaptive-sample",
            "label": "Adaptive sample",
            "description": (
                "Uncertainty-weighted, spatially spread cell sampling with "
                "replacement neighbors"
            ),
            "source_geometry": "quadkey",
        },
        {
            "id": "coverage-estimate",
            "label": "Coverage estimate",
            "description": (
                "Model-based prevalence + uncertainty per cell from survey "
                "results (GAM)"
            ),
            "source_geometry": "quadkey",
            "extra_inputs": [
                {
                    "role": "survey",
                    "label": "Survey results layer",
                    "geometry": ["point", "quadkey"],
                }
            ],
        },
    ],
}


# --------------------------------------------------------------------------
# URL IO seam: file:// for tests/local dev, else plain httpx GET/PUT for the
# presigned URLs pixel hands us. Kept as free functions (not methods) so
# tests can exercise the real HTTP path against tmp_path file:// URLs without
# any mocking.
#
# The file:// branch is gated behind PROVIDER_ALLOW_FILE_URLS — mirroring
# pixel's own ALLOW_PRIVATE_EXTERNAL_URLS precedent for its SSRF guard on
# POST /api/datasets/external (see pixel's CLAUDE.md). Without the gate,
# whoever holds the bearer token (the same token pixel uses to call us) could
# hand us a `file://` input/output URL and read or write arbitrary paths on
# this container's filesystem — an attacker with the token must not gain
# local filesystem read/write. Off by default; only tests/local dev set it.
# --------------------------------------------------------------------------


def _file_urls_allowed() -> bool:
    return os.environ.get("PROVIDER_ALLOW_FILE_URLS") == "1"


def _read_bytes(url: str) -> bytes:
    if url.startswith("file://"):
        if not _file_urls_allowed():
            raise HTTPException(422, detail="file:// URLs are not allowed")
        path = url[len("file://"):]
        with open(path, "rb") as f:
            return f.read()
    resp = httpx.get(url, timeout=_HTTP_TIMEOUT_S)
    resp.raise_for_status()
    return resp.content


def _write_bytes(url: str, data: bytes, content_type: str) -> None:
    if url.startswith("file://"):
        if not _file_urls_allowed():
            raise HTTPException(422, detail="file:// URLs are not allowed")
        path = url[len("file://"):]
        with open(path, "wb") as f:
            f.write(data)
        return
    resp = httpx.put(
        url, content=data, headers={"Content-Type": content_type}, timeout=_HTTP_TIMEOUT_S
    )
    resp.raise_for_status()


# --------------------------------------------------------------------------
# Quadkey -> centroid helper, shared by adaptive-sample and coverage-estimate
# --------------------------------------------------------------------------


def _quadkey_centroids(quadkeys) -> tuple[np.ndarray, np.ndarray]:
    """Mercantile-midpoint (lng, lat) centroids for a sequence of quadkeys.

    Longitude is the plain tile-bounds midpoint; latitude uses
    `_row_centroid_lat`'s true Mercator-projected midpoint (not a naive
    degree-bounds average) — see that function's docstring for why.
    """
    quadkeys = list(quadkeys)
    lngs = np.empty(len(quadkeys), dtype=float)
    lats = np.empty(len(quadkeys), dtype=float)
    for i, qk in enumerate(quadkeys):
        tile = mercantile.quadkey_to_tile(qk)
        bounds = mercantile.bounds(tile)
        lngs[i] = (bounds.west + bounds.east) / 2
        lats[i] = _row_centroid_lat(tile.y, tile.z)
    return lngs, lats


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


async def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("PROVIDER_TOKEN", "")
    provided = None
    if authorization and authorization.startswith("Bearer "):
        provided = authorization[len("Bearer "):]
    # Constant-time comparison — a naive `!=` short-circuits on the first
    # differing byte, letting a timing attack recover the token one
    # character at a time. `provided is None` is checked before calling
    # compare_digest, which requires two str (or two bytes) arguments.
    if not expected or provided is None or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


# --------------------------------------------------------------------------
# Execution contract request model (pixel's worker/analyses/provider.py is
# the source of truth for this shape).
# --------------------------------------------------------------------------


class OpInput(BaseModel):
    role: str
    parquet_url: str


class OpOutput(BaseModel):
    parquet_put_url: str
    content_type: str


class OpRequest(BaseModel):
    op: str
    params: dict[str, Any] = {}
    inputs: list[OpInput]
    output: OpOutput


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.get("/manifest", dependencies=[Depends(require_token)])
def manifest() -> dict:
    return MANIFEST


@app.post("/ops/adaptive-sample", dependencies=[Depends(require_token)])
def adaptive_sample(body: OpRequest) -> dict:
    if not body.inputs:
        raise HTTPException(422, detail="inputs[0] is required")

    raw = _read_bytes(body.inputs[0].parquet_url)
    df = pd.read_parquet(BytesIO(raw))

    if "quadkey" not in df.columns:
        raise HTTPException(422, detail="input frame is missing a quadkey column")

    params = body.params or {}
    rows = len(df)

    n = params.get("n")
    if isinstance(n, bool) or not isinstance(n, int) or not (1 <= n <= 10000):
        raise HTTPException(422, detail="params.n must be an integer between 1 and 10000")

    uncertainty_column = params.get("uncertainty_column")
    if not uncertainty_column:
        raise HTTPException(422, detail="params.uncertainty_column is required")
    if uncertainty_column not in df.columns:
        raise HTTPException(
            422,
            detail=f"uncertainty_column {uncertainty_column!r} not found in input frame",
        )

    seed = params.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise HTTPException(422, detail="params.seed must be an integer")

    round_label = params.get("round", "round-1")
    if not isinstance(round_label, str):
        raise HTTPException(422, detail="params.round must be a string")

    if n > rows:
        raise HTTPException(422, detail=f"n={n} exceeds the {rows} cells available")

    uncertainty = pd.to_numeric(df[uncertainty_column], errors="coerce").fillna(0).to_numpy(
        dtype=float
    )
    if (uncertainty < 0).any():
        raise HTTPException(422, detail="uncertainty values must be nonnegative")

    lngs, lats = _quadkey_centroids(df["quadkey"])

    rng = np.random.default_rng(seed)
    selected = adaptive_sample_indices(lngs, lats, uncertainty, n, rng)
    out = build_sample_frame(df, selected, round_label)

    buf = BytesIO()
    out.to_parquet(buf, index=False)
    _write_bytes(body.output.parquet_put_url, buf.getvalue(), body.output.content_type)

    return {"rows": len(out)}


# --------------------------------------------------------------------------
# coverage-estimate: binomial-GAM prevalence + uncertainty, delegated to
# provider/r/coverage_estimate.R (see that file's header for the exact JSON
# contract this builds/consumes).
# --------------------------------------------------------------------------


def _run_r(payload: dict) -> dict:
    """Run `R_SCRIPT_PATH` as a subprocess with `payload` as JSON stdin.

    This is the test seam: tests monkeypatch `_run_r` directly to avoid
    needing a local R install for every non-R-contract test, and the one
    real-R end-to-end test exercises this exact function.
    """
    rscript = shutil.which("Rscript")
    if rscript is None:
        raise HTTPException(500, detail="R runtime unavailable")

    proc = subprocess.run(
        [rscript, str(R_SCRIPT_PATH)],
        input=json.dumps(payload).encode(),
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode(errors="replace")
        raise HTTPException(422, detail=stderr[-500:])
    return json.loads(proc.stdout)


_COVERAGE_OUTPUT_COLUMNS = (
    "prevalence",
    "prevalence_bci_width",
    "exceedance_probability",
    "exceedance_uncertainty",
)


def _survey_coords(survey: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """(lng, lat) arrays for every survey row: quadkey centroids if present,
    else numeric `lng`/`lat` columns; 422 if neither is available."""
    if "quadkey" in survey.columns:
        return _quadkey_centroids(survey["quadkey"])
    if (
        "lng" in survey.columns
        and "lat" in survey.columns
        and pd.api.types.is_numeric_dtype(survey["lng"])
        and pd.api.types.is_numeric_dtype(survey["lat"])
    ):
        return (
            survey["lng"].to_numpy(dtype=float),
            survey["lat"].to_numpy(dtype=float),
        )
    raise HTTPException(
        422,
        detail="survey input must have a quadkey column or numeric lng and lat columns",
    )


@app.post("/ops/coverage-estimate", dependencies=[Depends(require_token)])
def coverage_estimate(body: OpRequest) -> dict:
    if not body.inputs:
        raise HTTPException(422, detail="inputs[0] is required")

    inputs_by_role = {inp.role: inp for inp in body.inputs}

    source_input = inputs_by_role.get("source")
    if source_input is None:
        raise HTTPException(422, detail="source input is required")

    grid = pd.read_parquet(BytesIO(_read_bytes(source_input.parquet_url)))
    if "quadkey" not in grid.columns:
        raise HTTPException(422, detail="source input is missing a quadkey column")

    survey_input = inputs_by_role.get("survey")
    if survey_input is None:
        raise HTTPException(422, detail="survey input is required")

    survey = pd.read_parquet(BytesIO(_read_bytes(survey_input.parquet_url)))
    survey_lngs, survey_lats = _survey_coords(survey)

    params = body.params or {}

    n_trials_column = params.get("n_trials_column", "n_trials")
    n_covered_column = params.get("n_covered_column", "n_covered")
    if n_trials_column not in survey.columns:
        raise HTTPException(
            422, detail=f"n_trials_column {n_trials_column!r} not found in survey input"
        )
    if n_covered_column not in survey.columns:
        raise HTTPException(
            422, detail=f"n_covered_column {n_covered_column!r} not found in survey input"
        )

    seed = params.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise HTTPException(422, detail="params.seed must be an integer")

    threshold = params.get("exceedance_threshold")
    if threshold is not None:
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            raise HTTPException(422, detail="params.exceedance_threshold must be a number")
        if not (0 < threshold < 1):
            raise HTTPException(
                422, detail="params.exceedance_threshold must be strictly between 0 and 1"
            )

    n_trials_all = pd.to_numeric(survey[n_trials_column], errors="coerce").to_numpy(dtype=float)
    n_covered_all = pd.to_numeric(survey[n_covered_column], errors="coerce").to_numpy(dtype=float)
    valid = ~(np.isnan(n_trials_all) | np.isnan(n_covered_all))

    n_trials = n_trials_all[valid]
    n_covered = n_covered_all[valid]
    train_lngs = np.asarray(survey_lngs, dtype=float)[valid]
    train_lats = np.asarray(survey_lats, dtype=float)[valid]

    if len(n_trials) == 0:
        raise HTTPException(422, detail="no valid training rows")

    bad = (n_trials < 0) | (n_covered < 0) | (n_covered > n_trials)
    if bad.any():
        raise HTTPException(
            422,
            detail=f"{int(bad.sum())} training rows have negative counts or n_covered > n_trials",
        )

    predict_lngs, predict_lats = _quadkey_centroids(grid["quadkey"])

    r_params: dict[str, Any] = {"seed": seed}
    if threshold is not None:
        r_params["exceedance_threshold"] = float(threshold)

    payload = {
        "train": [
            {
                "lng": float(lng),
                "lat": float(lat),
                "n_trials": float(nt),
                "n_covered": float(nc),
            }
            for lng, lat, nt, nc in zip(train_lngs, train_lats, n_trials, n_covered)
        ],
        "predict": [
            {"lng": float(lng), "lat": float(lat)}
            for lng, lat in zip(predict_lngs, predict_lats)
        ],
        "params": r_params,
    }

    result = _run_r(payload)

    rename_map = {c: f"src_{c}" for c in _COVERAGE_OUTPUT_COLUMNS if c in grid.columns}
    out = grid.rename(columns=rename_map).reset_index(drop=True).copy()
    out["prevalence"] = result["prevalence"]
    out["prevalence_bci_width"] = result["bci_width"]
    if threshold is not None:
        out["exceedance_probability"] = result.get("exceedance_probability")
        out["exceedance_uncertainty"] = result.get("exceedance_uncertainty")

    buf = BytesIO()
    out.to_parquet(buf, index=False)
    _write_bytes(body.output.parquet_put_url, buf.getvalue(), body.output.content_type)

    return {"rows": len(out)}
