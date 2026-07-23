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

import os
from io import BytesIO
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
        }
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
# Auth
# --------------------------------------------------------------------------


async def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("PROVIDER_TOKEN", "")
    provided = None
    if authorization and authorization.startswith("Bearer "):
        provided = authorization[len("Bearer "):]
    if not expected or provided != expected:
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

    lngs = np.empty(rows, dtype=float)
    lats = np.empty(rows, dtype=float)
    for i, qk in enumerate(df["quadkey"]):
        tile = mercantile.quadkey_to_tile(qk)
        bounds = mercantile.bounds(tile)
        lngs[i] = (bounds.west + bounds.east) / 2
        # Mercator-midpoint latitude, NOT a naive degree-bounds average — see
        # `_row_centroid_lat`'s docstring / pixel's worker/quadkey.py, the
        # parity source of truth this must not diverge from.
        lats[i] = _row_centroid_lat(tile.y, tile.z)

    rng = np.random.default_rng(seed)
    selected = adaptive_sample_indices(lngs, lats, uncertainty, n, rng)
    out = build_sample_frame(df, selected, round_label)

    buf = BytesIO()
    out.to_parquet(buf, index=False)
    _write_bytes(body.output.parquet_put_url, buf.getvalue(), body.output.content_type)

    return {"rows": len(out)}
