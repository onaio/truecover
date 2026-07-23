"""Tests for provider/r/coverage_estimate.R: the GAM coverage-estimate script.

Drives the script exactly as it will run in production -- a subprocess given
JSON on stdin, expected to emit JSON on stdout and exit 0, or write an error
to stderr and exit non-zero. Skipped everywhere Rscript isn't installed (this
repo has no R runtime locally); validated for real by running the script
inside a `r-base` Docker container -- see the pixel-side task report for that
transcript. These tests encode the same checks so they run wherever R is
actually available (e.g. CI, the provider's Docker image).
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "r" / "coverage_estimate.R"

requires_r = pytest.mark.skipif(shutil.which("Rscript") is None, reason="R not installed")


def run_script(payload) -> tuple[dict | None, subprocess.CompletedProcess]:
    """Run coverage_estimate.R with `payload` as JSON stdin.

    `payload` may be a dict (JSON-encoded) or a raw string (sent verbatim, for
    malformed-input tests). Returns (parsed_stdout_or_None, completed_process)
    so callers can assert on exit code / stderr as well as the parsed body.
    """
    stdin = payload if isinstance(payload, str) else json.dumps(payload)
    proc = subprocess.run(
        ["Rscript", str(SCRIPT)],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=120,
    )
    body = None
    if proc.returncode == 0:
        body = json.loads(proc.stdout)
    return body, proc


# --------------------------------------------------------------------------
# Synthetic fixtures
# --------------------------------------------------------------------------

# A 6x5 grid of train points on a west (low coverage) -> east (high coverage)
# gradient. 30 unique (lng, lat) combinations -- fewer and mgcv's te(bs="gp")
# default k raises "fewer unique covariate combinations than specified
# maximum degrees of freedom".
_TRAIN_LNGS = [-10, -6, -2, 2, 6, 10]
_TRAIN_LATS = [-4, -2, 0, 2, 4]
_N_TRIALS = 50


def _train_points():
    points = []
    for lng in _TRAIN_LNGS:
        for lat in _TRAIN_LATS:
            p = 0.05 + 0.9 * (lng + 10) / 20.0
            n_covered = round(p * _N_TRIALS)
            points.append(
                {"lng": lng, "lat": lat, "n_trials": _N_TRIALS, "n_covered": n_covered}
            )
    return points


def _predict_points():
    """Predict grid: points at the train locations ("near") plus points well
    outside the train lat range ("far"), to exercise the far-from-data
    uncertainty property."""
    near = [{"lng": lng, "lat": lat} for lng in _TRAIN_LNGS for lat in _TRAIN_LATS]
    far = [
        {"lng": lng, "lat": lat}
        for lng in [-10, -5, 0, 5, 10]
        for lat in [-15, 15]
    ]
    return near, far


def _payload(seed=42, threshold=None):
    near, far = _predict_points()
    params = {"seed": seed}
    if threshold is not None:
        params["exceedance_threshold"] = threshold
    return {"train": _train_points(), "predict": near + far, "params": params}, near, far


# --------------------------------------------------------------------------
# (a) prevalence increases west -> east
# --------------------------------------------------------------------------


@requires_r
def test_prevalence_increases_west_to_east():
    payload, near, far = _payload()
    body, proc = run_script(payload)
    assert proc.returncode == 0, proc.stderr

    predict = near + far
    prevalence = body["prevalence"]
    assert len(prevalence) == len(predict)

    by_lng = {}
    for pt, p in zip(predict, prevalence):
        by_lng.setdefault(pt["lng"], []).append(p)

    means = [sum(by_lng[lng]) / len(by_lng[lng]) for lng in _TRAIN_LNGS]
    assert all(a <= b for a, b in zip(means, means[1:])), means
    # meaningfully separated, not just non-decreasing by rounding noise
    assert means[0] < 0.2
    assert means[-1] > 0.8


# --------------------------------------------------------------------------
# (b) bci_width strictly positive, and larger far from training data
# --------------------------------------------------------------------------


@requires_r
def test_bci_width_positive_and_larger_far_from_train():
    payload, near, far = _payload()
    body, proc = run_script(payload)
    assert proc.returncode == 0, proc.stderr

    predict = near + far
    bci_width = body["bci_width"]
    assert len(bci_width) == len(predict)
    assert all(w > 0 for w in bci_width)

    near_widths = bci_width[: len(near)]
    far_widths = bci_width[len(near) :]
    assert len(far_widths) == len(far)

    # This is exactly the property the original (unfixed) posterior-sampling
    # code destroyed: with sim_coef never used, every simulation collapses to
    # the same point prediction and bci_width is 0 everywhere. Real posterior
    # draws should widen with distance from training data.
    assert min(far_widths) > max(near_widths)


# --------------------------------------------------------------------------
# (c) deterministic under the same seed
# --------------------------------------------------------------------------


@requires_r
def test_deterministic_with_same_seed():
    payload, _, _ = _payload(seed=99)
    body_a, proc_a = run_script(payload)
    body_b, proc_b = run_script(payload)

    assert proc_a.returncode == 0, proc_a.stderr
    assert proc_b.returncode == 0, proc_b.stderr
    assert body_a == body_b


# --------------------------------------------------------------------------
# (d) exceedance fields present iff threshold given
# --------------------------------------------------------------------------


@requires_r
def test_exceedance_fields_absent_without_threshold():
    payload, _, _ = _payload(threshold=None)
    body, proc = run_script(payload)
    assert proc.returncode == 0, proc.stderr

    assert body["exceedance_probability"] is None
    assert body["exceedance_uncertainty"] is None


@requires_r
def test_exceedance_fields_present_with_threshold():
    payload, near, far = _payload(threshold=0.5)
    body, proc = run_script(payload)
    assert proc.returncode == 0, proc.stderr

    predict = near + far
    ex_prob = body["exceedance_probability"]
    ex_unc = body["exceedance_uncertainty"]
    assert len(ex_prob) == len(predict)
    assert len(ex_unc) == len(predict)
    assert all(0.0 <= p <= 1.0 for p in ex_prob)
    # 0.5 - |p - 0.5| is maximized (0.5) at p=0.5 and minimized (0) at p=0/1
    assert all(0.0 <= u <= 0.5 for u in ex_unc)


# --------------------------------------------------------------------------
# (e) malformed stdin -> non-zero exit with stderr
# --------------------------------------------------------------------------


@requires_r
def test_malformed_stdin_fails_nonzero_with_stderr():
    body, proc = run_script("{not valid json")
    assert proc.returncode != 0
    assert body is None
    assert proc.stderr.strip() != ""
