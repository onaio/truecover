"""Tests for provider.app: the pixel execution-contract HTTP service.

Uses fastapi.testclient.TestClient and tmp_path `file://` URLs for both the
input and output parquet, so these exercise the real _read_bytes/_write_bytes
seam without mocking httpx.
"""

import mercantile
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from provider.app import app

TOKEN = "dev-secret"


@pytest.fixture(autouse=True)
def provider_token(monkeypatch):
    monkeypatch.setenv("PROVIDER_TOKEN", TOKEN)
    # file:// URLs are gated behind PROVIDER_ALLOW_FILE_URLS (dev/test only —
    # see provider/app.py's _file_urls_allowed); every test here relies on
    # tmp_path file:// input/output URLs, so enable it by default. The one
    # test asserting the gate itself overrides this back off.
    monkeypatch.setenv("PROVIDER_ALLOW_FILE_URLS", "1")


@pytest.fixture
def client():
    return TestClient(app)


def _auth(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def _grid_df(n_side=4, level=10, x0=500, y0=500, seed=0):
    """A small square grid of quadkeys with random nonnegative uncertainty."""
    rng = np.random.default_rng(seed)
    quadkeys = [
        mercantile.quadkey(x0 + dx, y0 + dy, level)
        for dx in range(n_side)
        for dy in range(n_side)
    ]
    return pd.DataFrame(
        {
            "quadkey": quadkeys,
            "uncertainty": rng.uniform(0.0, 1.0, size=len(quadkeys)),
        }
    )


def _post_op(client, tmp_path, df, params, name="in"):
    in_path = tmp_path / f"{name}.parquet"
    out_path = tmp_path / f"{name}-out.parquet"
    df.to_parquet(in_path, index=False)
    body = {
        "op": "adaptive-sample",
        "params": params,
        "inputs": [{"role": "source", "parquet_url": f"file://{in_path}"}],
        "output": {
            "parquet_put_url": f"file://{out_path}",
            "content_type": "application/vnd.apache.parquet",
        },
    }
    resp = client.post("/ops/adaptive-sample", json=body, headers=_auth())
    return resp, out_path


# --------------------------------------------------------------------------
# Manifest + auth
# --------------------------------------------------------------------------


def test_manifest_shape(client):
    resp = client.get("/manifest", headers=_auth())
    assert resp.status_code == 200
    assert resp.json() == {
        "name": "TrueCover",
        "operations": [
            {
                "id": "adaptive-sample",
                "label": "Adaptive sample",
                "description": (
                    "Uncertainty-weighted, spatially spread cell sampling "
                    "with replacement neighbors"
                ),
                "source_geometry": "quadkey",
            }
        ],
    }


def test_manifest_requires_token(client):
    resp = client.get("/manifest")
    assert resp.status_code == 401


def test_manifest_rejects_wrong_token(client):
    resp = client.get("/manifest", headers=_auth("wrong-token"))
    assert resp.status_code == 401


def test_op_requires_token(client, tmp_path):
    df = _grid_df()
    in_path = tmp_path / "in.parquet"
    df.to_parquet(in_path, index=False)
    body = {
        "op": "adaptive-sample",
        "params": {"n": 2, "uncertainty_column": "uncertainty"},
        "inputs": [{"role": "source", "parquet_url": f"file://{in_path}"}],
        "output": {
            "parquet_put_url": f"file://{tmp_path / 'out.parquet'}",
            "content_type": "application/vnd.apache.parquet",
        },
    }
    resp = client.post("/ops/adaptive-sample", json=body)
    assert resp.status_code == 401


# --------------------------------------------------------------------------
# Happy path
# --------------------------------------------------------------------------


def test_happy_path_writes_output(client, tmp_path):
    df = _grid_df()  # 16 rows
    resp, out_path = _post_op(
        client, tmp_path, df, {"n": 3, "uncertainty_column": "uncertainty", "seed": 42}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert out_path.exists()

    out = pd.read_parquet(out_path)
    assert body == {"rows": len(out)}

    assert set(out["kind"]) == {"pixel", "replacement"}
    assert (out["kind"] == "pixel").sum() == 3
    assert (out["kind"] == "replacement").sum() > 0
    assert out["quadkey"].is_unique


def test_deterministic_with_same_seed(client, tmp_path):
    df = _grid_df()
    resp_a, out_a = _post_op(
        client, tmp_path, df, {"n": 3, "uncertainty_column": "uncertainty", "seed": 7}, name="a"
    )
    resp_b, out_b = _post_op(
        client, tmp_path, df, {"n": 3, "uncertainty_column": "uncertainty", "seed": 7}, name="b"
    )

    assert resp_a.status_code == 200
    assert resp_b.status_code == 200

    frame_a = pd.read_parquet(out_a)
    frame_b = pd.read_parquet(out_b)
    pd.testing.assert_frame_equal(frame_a, frame_b)


# --------------------------------------------------------------------------
# Validation failures
# --------------------------------------------------------------------------


def test_missing_uncertainty_column_is_422(client, tmp_path):
    df = _grid_df()
    resp, _ = _post_op(client, tmp_path, df, {"n": 3, "uncertainty_column": "does-not-exist"})
    assert resp.status_code == 422
    assert "does-not-exist" in resp.json()["detail"]


def test_n_exceeds_rows_is_422(client, tmp_path):
    df = _grid_df(n_side=2)  # 4 rows
    resp, _ = _post_op(client, tmp_path, df, {"n": 10, "uncertainty_column": "uncertainty"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "n=10 exceeds the 4 cells available"


def test_negative_uncertainty_is_422(client, tmp_path):
    df = _grid_df()
    df["uncertainty"] = -1.0
    resp, _ = _post_op(client, tmp_path, df, {"n": 3, "uncertainty_column": "uncertainty"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "uncertainty values must be nonnegative"


def test_missing_quadkey_column_is_422(client, tmp_path):
    df = pd.DataFrame({"not_quadkey": ["a", "b"], "uncertainty": [1.0, 2.0]})
    resp, _ = _post_op(client, tmp_path, df, {"n": 1, "uncertainty_column": "uncertainty"})
    assert resp.status_code == 422


def test_n_out_of_range_is_422(client, tmp_path):
    df = _grid_df()
    resp, _ = _post_op(client, tmp_path, df, {"n": 0, "uncertainty_column": "uncertainty"})
    assert resp.status_code == 422


def test_file_url_rejected_without_allow_flag(client, tmp_path, monkeypatch):
    monkeypatch.delenv("PROVIDER_ALLOW_FILE_URLS", raising=False)
    df = _grid_df()
    resp, _ = _post_op(client, tmp_path, df, {"n": 3, "uncertainty_column": "uncertainty"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "file:// URLs are not allowed"
