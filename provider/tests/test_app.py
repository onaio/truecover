"""Tests for provider.app: the pixel execution-contract HTTP service.

Uses fastapi.testclient.TestClient and tmp_path `file://` URLs for both the
input and output parquet, so these exercise the real _read_bytes/_write_bytes
seam without mocking httpx.
"""

import shutil

import mercantile
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import provider.app as app_module
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
            },
            {
                "id": "coverage-estimate",
                "label": "Coverage estimate",
                "description": (
                    "Model-based prevalence + uncertainty per cell from "
                    "survey results (GAM)"
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


# --------------------------------------------------------------------------
# coverage-estimate
# --------------------------------------------------------------------------


def _survey_df_quadkey(n=4, level=10, x0=500, y0=500, n_trials=50, seed=0):
    """A survey frame keyed by quadkey, with n_trials/n_covered columns."""
    rng = np.random.default_rng(seed)
    quadkeys = [mercantile.quadkey(x0 + i, y0, level) for i in range(n)]
    return pd.DataFrame(
        {
            "quadkey": quadkeys,
            "n_trials": [n_trials] * n,
            "n_covered": rng.integers(0, n_trials + 1, size=n),
        }
    )


def _post_coverage_op(client, tmp_path, grid_df, survey_df, params, name="cov"):
    """POST /ops/coverage-estimate with a `source` grid and (optionally) a
    `survey` input. `survey_df=None` omits the survey input entirely (for
    the "survey missing" case)."""
    grid_path = tmp_path / f"{name}-grid.parquet"
    out_path = tmp_path / f"{name}-out.parquet"
    grid_df.to_parquet(grid_path, index=False)

    inputs = [{"role": "source", "parquet_url": f"file://{grid_path}"}]
    if survey_df is not None:
        survey_path = tmp_path / f"{name}-survey.parquet"
        survey_df.to_parquet(survey_path, index=False)
        inputs.append({"role": "survey", "parquet_url": f"file://{survey_path}"})

    body = {
        "op": "coverage-estimate",
        "params": params,
        "inputs": inputs,
        "output": {
            "parquet_put_url": f"file://{out_path}",
            "content_type": "application/vnd.apache.parquet",
        },
    }
    resp = client.post("/ops/coverage-estimate", json=body, headers=_auth())
    return resp, out_path


class _FakeCompletedProcess:
    def __init__(self, returncode, stdout=b"", stderr=b""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_coverage_estimate_happy_path(client, tmp_path, monkeypatch):
    grid_df = _grid_df(n_side=3)  # 9 rows: quadkey + uncertainty
    grid_df["prevalence"] = "pre-existing"  # exercise the reserved-name guard

    survey_df = pd.DataFrame(
        {
            "quadkey": [
                mercantile.quadkey(500, 500, 10),
                mercantile.quadkey(501, 500, 10),
                mercantile.quadkey(502, 500, 10),
                mercantile.quadkey(503, 500, 10),
            ],
            "n_trials": [50, 50, np.nan, 50],
            "n_covered": [10, np.nan, 5, 20],
        }
    )

    expected_predict_lngs, expected_predict_lats = app_module._quadkey_centroids(
        grid_df["quadkey"]
    )
    expected_train_lngs, expected_train_lats = app_module._quadkey_centroids(
        [survey_df["quadkey"][0], survey_df["quadkey"][3]]
    )

    captured_payload = {}
    fake_prevalence = [0.1 * i for i in range(9)]
    fake_bci_width = [0.05] * 9

    def fake_run_r(payload):
        captured_payload.update(payload)
        return {"prevalence": fake_prevalence, "bci_width": fake_bci_width}

    monkeypatch.setattr(app_module, "_run_r", fake_run_r)

    resp, out_path = _post_coverage_op(client, tmp_path, grid_df, survey_df, {"seed": 5})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"rows": 9}

    # Train rows: the two NA-count rows (index 1, 2) were dropped, in order.
    train = captured_payload["train"]
    assert len(train) == 2
    assert [t["n_trials"] for t in train] == [50, 50]
    assert [t["n_covered"] for t in train] == [10, 20]
    assert [t["lng"] for t in train] == pytest.approx(list(expected_train_lngs))
    assert [t["lat"] for t in train] == pytest.approx(list(expected_train_lats))

    # Predict rows: grid centroids, in grid row order.
    predict = captured_payload["predict"]
    assert len(predict) == 9
    assert [p["lng"] for p in predict] == pytest.approx(list(expected_predict_lngs))
    assert [p["lat"] for p in predict] == pytest.approx(list(expected_predict_lats))

    assert captured_payload["params"] == {"seed": 5}

    out = pd.read_parquet(out_path)
    assert len(out) == 9
    assert list(out["quadkey"]) == list(grid_df["quadkey"])
    assert out["prevalence"].tolist() == pytest.approx(fake_prevalence)
    assert out["prevalence_bci_width"].tolist() == pytest.approx(fake_bci_width)
    # Reserved-name guard: pre-existing grid "prevalence" column preserved as src_prevalence.
    assert list(out["src_prevalence"]) == ["pre-existing"] * 9
    assert "exceedance_probability" not in out.columns
    assert "exceedance_uncertainty" not in out.columns


def test_coverage_estimate_with_threshold_adds_exceedance_columns(client, tmp_path, monkeypatch):
    grid_df = _grid_df(n_side=2)  # 4 rows
    survey_df = _survey_df_quadkey(n=4)

    def fake_run_r(payload):
        assert payload["params"]["exceedance_threshold"] == 0.5
        n = len(payload["predict"])
        return {
            "prevalence": [0.5] * n,
            "bci_width": [0.1] * n,
            "exceedance_probability": [0.3] * n,
            "exceedance_uncertainty": [0.2] * n,
        }

    monkeypatch.setattr(app_module, "_run_r", fake_run_r)

    resp, out_path = _post_coverage_op(
        client, tmp_path, grid_df, survey_df, {"exceedance_threshold": 0.5}
    )
    assert resp.status_code == 200, resp.text

    out = pd.read_parquet(out_path)
    assert out["exceedance_probability"].tolist() == pytest.approx([0.3] * 4)
    assert out["exceedance_uncertainty"].tolist() == pytest.approx([0.2] * 4)


def test_coverage_estimate_survey_missing_is_422(client, tmp_path):
    grid_df = _grid_df(n_side=2)
    resp, _ = _post_coverage_op(client, tmp_path, grid_df, None, {})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "survey input is required"


def test_coverage_estimate_survey_without_coords_is_422(client, tmp_path):
    grid_df = _grid_df(n_side=2)
    survey_df = pd.DataFrame({"n_trials": [50, 50], "n_covered": [10, 20]})
    resp, _ = _post_coverage_op(client, tmp_path, grid_df, survey_df, {})
    assert resp.status_code == 422


def test_coverage_estimate_missing_count_column_is_422(client, tmp_path):
    grid_df = _grid_df(n_side=2)
    survey_df = pd.DataFrame(
        {
            "quadkey": [mercantile.quadkey(500, 500, 10), mercantile.quadkey(501, 500, 10)],
            "n_covered": [10, 20],
        }
    )
    resp, _ = _post_coverage_op(client, tmp_path, grid_df, survey_df, {})
    assert resp.status_code == 422
    assert "n_trials" in resp.json()["detail"]


def test_coverage_estimate_custom_count_columns_naming(client, tmp_path):
    grid_df = _grid_df(n_side=2)
    survey_df = pd.DataFrame(
        {
            "quadkey": [mercantile.quadkey(500, 500, 10), mercantile.quadkey(501, 500, 10)],
            "n_trials": [50, 50],
            "n_covered": [10, 20],
        }
    )
    resp, _ = _post_coverage_op(
        client, tmp_path, grid_df, survey_df, {"n_covered_column": "does-not-exist"}
    )
    assert resp.status_code == 422
    assert "does-not-exist" in resp.json()["detail"]


def test_coverage_estimate_all_na_counts_is_422(client, tmp_path):
    grid_df = _grid_df(n_side=2)
    survey_df = pd.DataFrame(
        {
            "quadkey": [mercantile.quadkey(500, 500, 10), mercantile.quadkey(501, 500, 10)],
            "n_trials": [np.nan, np.nan],
            "n_covered": [10, 20],
        }
    )
    resp, _ = _post_coverage_op(client, tmp_path, grid_df, survey_df, {})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "no valid training rows"


def test_coverage_estimate_n_covered_exceeds_n_trials_is_422(client, tmp_path):
    grid_df = _grid_df(n_side=2)
    survey_df = pd.DataFrame(
        {
            "quadkey": [
                mercantile.quadkey(500, 500, 10),
                mercantile.quadkey(501, 500, 10),
                mercantile.quadkey(502, 500, 10),
            ],
            "n_trials": [50, 50, 50],
            "n_covered": [10, 999, 30],
        }
    )
    resp, _ = _post_coverage_op(client, tmp_path, grid_df, survey_df, {})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "1 training rows have negative counts or n_covered > n_trials"


@pytest.mark.parametrize("threshold", [0, 1, 1.5])
def test_coverage_estimate_bad_threshold_is_422(client, tmp_path, threshold):
    grid_df = _grid_df(n_side=2)
    survey_df = _survey_df_quadkey(n=3)
    resp, _ = _post_coverage_op(
        client, tmp_path, grid_df, survey_df, {"exceedance_threshold": threshold}
    )
    assert resp.status_code == 422


def test_coverage_estimate_rscript_missing_is_500(client, tmp_path, monkeypatch):
    monkeypatch.setattr(app_module.shutil, "which", lambda name: None)
    grid_df = _grid_df(n_side=2)
    survey_df = _survey_df_quadkey(n=3)
    resp, _ = _post_coverage_op(client, tmp_path, grid_df, survey_df, {})
    assert resp.status_code == 500
    assert resp.json()["detail"] == "R runtime unavailable"


def test_coverage_estimate_r_failure_is_422_with_stderr_tail(client, tmp_path, monkeypatch):
    monkeypatch.setattr(app_module.shutil, "which", lambda name: "/usr/bin/Rscript")
    stderr_msg = ("x" * 600 + "boom").encode()

    def fake_run(*args, **kwargs):
        return _FakeCompletedProcess(returncode=1, stdout=b"", stderr=stderr_msg)

    monkeypatch.setattr(app_module.subprocess, "run", fake_run)

    grid_df = _grid_df(n_side=2)
    survey_df = _survey_df_quadkey(n=3)
    resp, _ = _post_coverage_op(client, tmp_path, grid_df, survey_df, {})
    assert resp.status_code == 422
    assert resp.json()["detail"] == stderr_msg.decode()[-500:]
    assert len(resp.json()["detail"]) == 500


# --------------------------------------------------------------------------
# coverage-estimate: real Rscript end-to-end (skipped where R isn't installed)
# --------------------------------------------------------------------------


@pytest.mark.skipif(shutil.which("Rscript") is None, reason="R not installed")
def test_coverage_estimate_real_r_end_to_end(client, tmp_path):
    train_lngs = [-10, -6, -2, 2, 6, 10]
    train_lats = [-4, -2, 0, 2, 4]
    rows = []
    for lng in train_lngs:
        for lat in train_lats:
            p = 0.05 + 0.9 * (lng + 10) / 20.0
            rows.append({"lng": lng, "lat": lat, "n_trials": 50, "n_covered": round(p * 50)})
    survey_df = pd.DataFrame(rows)

    grid_df = _grid_df(n_side=3)  # 9 quadkey cells

    resp, out_path = _post_coverage_op(client, tmp_path, grid_df, survey_df, {"seed": 42})
    assert resp.status_code == 200, resp.text

    out = pd.read_parquet(out_path)
    assert len(out) == len(grid_df)
    assert "prevalence" in out.columns
    assert "prevalence_bci_width" in out.columns
    assert out["prevalence"].between(0.0, 1.0).all()
    assert (out["prevalence_bci_width"] > 0).all()
