# TrueCover provider service

A small FastAPI service that exposes TrueCover's adaptive-sampling algorithm
(`provider/algorithm.py`) to pixel over pixel's external analysis-provider
HTTP contract. Pixel calls this service by reference — it hands us presigned
parquet URLs, we read/write parquet at those URLs, we never see pixel
credentials and pixel never sees ours.

## Contract summary

- **Auth**: every route requires `Authorization: Bearer <PROVIDER_TOKEN>`
  (`PROVIDER_TOKEN` env var). Missing or wrong token → `401`.
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

  Reads `inputs[0].parquet_url` (a `file://` path is read locally — used by
  tests and local dev; anything else is fetched with `httpx.get`, 300s
  timeout) into a pandas DataFrame, which must have a `quadkey` column.

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
  parquet to `output.parquet_put_url` (`file://` written locally, else
  `httpx.put` with the given `Content-Type`), and returns `{"rows": <int>}`.

  All validation failures respond `422` with a human-readable `detail` string
  — pixel surfaces that `detail` verbatim in the dataset's error state.

## Running locally

From the repo root:

```bash
PROVIDER_TOKEN=dev-secret uv run \
  --with fastapi --with 'uvicorn[standard]' --with httpx \
  --with pandas --with pyarrow --with numpy --with mercantile \
  uvicorn provider.app:app --port 18090
```

## Tests

From the repo root:

```bash
uv run --with pytest --with fastapi --with httpx --with pandas --with pyarrow \
  --with numpy --with mercantile python -m pytest provider/tests -q
```
