# TrueCover provider service

A small FastAPI service that exposes TrueCover's adaptive-sampling algorithm
(`provider/algorithm.py`) to pixel over pixel's external analysis-provider
HTTP contract. Pixel calls this service by reference — it hands us presigned
parquet URLs, we read/write parquet at those URLs, we never see pixel
credentials and pixel never sees ours.

## Contract summary

- **Auth**: every route requires `Authorization: Bearer <PROVIDER_TOKEN>`
  (`PROVIDER_TOKEN` env var). Missing or wrong token → `401`.
- **`file://` URLs**: `inputs[*].parquet_url` and `output.parquet_put_url`
  accept a `file://` path only when `PROVIDER_ALLOW_FILE_URLS=1` is set —
  **dev/test only**, mirroring pixel's `ALLOW_PRIVATE_EXTERNAL_URLS` SSRF-guard
  precedent (see pixel's `CLAUDE.md`). Whoever holds the bearer token could
  otherwise make this service read or write arbitrary paths on its own
  filesystem. Unset (the default) → any `file://` URL is rejected with `422`.
  Never set this in production; the Dockerfile deliberately does not set it.
- **`GET /manifest`** → declares the operations this provider supports:

  ```json
  {
    "name": "TrueCover",
    "operations": [
      {
        "id": "adaptive-sample",
        "label": "Adaptive sample",
        "description": "Uncertainty-weighted, spatially spread cell sampling with replacement neighbors",
        "source_geometry": "quadkey"
      },
      {
        "id": "coverage-estimate",
        "label": "Coverage estimate",
        "description": "Binomial GAM prevalence and uncertainty estimation from survey data",
        "source_geometry": "quadkey"
      }
    ]
  }
  ```

- **`POST /ops/adaptive-sample`** — body is pixel's execution-contract shape:

  ```json
  {
    "op": "adaptive-sample",
    "params": {
      "n": 50,
      "uncertainty_column": "uncertainty",
      "seed": 0,
      "round": "round-1"
    },
    "inputs": [{"role": "source", "parquet_url": "https://..."}],
    "output": {"parquet_put_url": "https://...", "content_type": "application/vnd.apache.parquet"}
  }
  ```

  Reads `inputs[0].parquet_url` (a `file://` path is read locally when
  `PROVIDER_ALLOW_FILE_URLS=1`, else rejected — see above; anything else is
  fetched with `httpx.get`, 300s timeout) into a pandas DataFrame, which must
  have a `quadkey` column.

  `params`:
  - `n` — integer, `1`–`10000`. `n` greater than the number of rows in the
    input frame is a `422`.
  - `uncertainty_column` — required; must name a column present in the input
    frame. Values are coerced with `pd.to_numeric(errors="coerce")` (non-numeric
    → `NaN` → `0`); any negative value is a `422`.
  - `seed` — integer, defaults to `0`.
  - `round` — string, defaults to `"round-1"`.

  Cell centroids for the algorithm come from each row's `quadkey`: longitude
  is the midpoint of the tile's mercantile bounds, latitude is the Mercator
  row-midpoint (`_row_centroid_lat`, kept in parity with pixel's
  `worker/quadkey.py::_row_centroid_lat` — not a naive degree-bounds average).

  Runs `adaptive_sample_indices` + `build_sample_frame`, writes the resulting
  parquet to `output.parquet_put_url` (`file://` written locally when
  allowed, else `httpx.put` with the given `Content-Type`), and returns
  `{"rows": <int>}`.

  All validation failures respond `422` with a human-readable `detail` string
  — pixel surfaces that `detail` verbatim in the dataset's error state.

- **`POST /ops/coverage-estimate`** — binomial-GAM prevalence + uncertainty estimation from survey data. Body is pixel's execution-contract shape:

  ```json
  {
    "op": "coverage-estimate",
    "params": {
      "seed": 0,
      "n_trials_column": "n_trials",
      "n_covered_column": "n_covered",
      "exceedance_threshold": 0.8
    },
    "inputs": [
      {"role": "source", "parquet_url": "https://..."},
      {"role": "survey", "parquet_url": "https://..."}
    ],
    "output": {"parquet_put_url": "https://...", "content_type": "application/vnd.apache.parquet"}
  }
  ```

  Reads `inputs[0]` (role: "source", must have a `quadkey` column) as the prediction grid, and `inputs[1]` (role: "survey") as training data. Fits a binomial GAM to the survey data and predicts prevalence + Bayesian credible-interval width for each grid cell. All parameters are optional except the two required inputs.

  `params`:
  - `n_trials_column` — string, column name in survey data (default: `"n_trials"`). Must be numeric; coerced with `pd.to_numeric(errors="coerce")`.
  - `n_covered_column` — string, column name in survey data (default: `"n_covered"`). Must be numeric; coerced with `pd.to_numeric(errors="coerce")`.
  - `seed` — integer, RNG seed (default: `0`).
  - `exceedance_threshold` — optional float, strictly between 0 and 1. If provided, also computes the probability that prevalence exceeds this threshold and the uncertainty of that exceedance estimate.

  Survey coordinates come from the `survey` input's `quadkey` column (if present) or numeric `lng`/`lat` columns; grid coordinates from the `source` input's `quadkey` column.

  Delegates to `provider/r/coverage_estimate.R` (see that file's header for the posterior-bug fix — a genuine R error found in the original implementation). Runs the R script as a subprocess and returns a parquet with source grid columns plus `prevalence`, `prevalence_bci_width`, optionally `exceedance_probability` and `exceedance_uncertainty`. Returns `{"rows": <int>}`.

  All validation failures respond `422` with a human-readable `detail` string.

## Running locally

### With local R runtime

On macOS with Homebrew:

```bash
brew install r
```

Then from the repo root:

```bash
PROVIDER_TOKEN=dev-secret PROVIDER_ALLOW_FILE_URLS=1 uv run \
  --with fastapi --with 'uvicorn[standard]' --with httpx \
  --with pandas --with pyarrow --with numpy --with mercantile \
  uvicorn provider.app:app --port 18090
```

The `coverage-estimate` op will work only if `Rscript` is on your PATH.

### Via Docker

From the repo root:

```bash
docker build -f provider/Dockerfile -t truecover-provider .
docker run --rm -p 18090:8080 -e PROVIDER_TOKEN=dev-secret truecover-provider
```

Both `adaptive-sample` and `coverage-estimate` ops are available in the container.

### Testing without local R

The `adaptive-sample` op works without an R runtime. If you need to test `coverage-estimate` without installing R, use the Docker approach above or monkeypatch `provider.app::_run_r` in unit tests (see `provider/tests/` for examples).

`PROVIDER_ALLOW_FILE_URLS=1` is only needed if you want to exercise the
`file://` path locally (e.g. against a `file://`-URL test payload); omit it
to match production behavior, where only real HTTP(S) presigned URLs work.

## Tests

From the repo root:

```bash
uv run --with pytest --with fastapi --with httpx --with pandas --with pyarrow \
  --with numpy --with mercantile python -m pytest provider/tests -q
```
