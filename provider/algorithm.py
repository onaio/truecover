"""Adaptive-sampling core for the pixel analysis-provider.

`adaptive_sample_indices` is a faithful numpy port of the validated R
function `fn-adaptive-sampling-0.3.1/fn-adaptive-sampling/function.R`.
`neighbor_quadkeys`/`cell_ground_area_m2`/`_row_centroid_lat` are
self-contained copies of the same-named functions in pixel's
`worker/quadkey.py` (that module is the source of truth for parity — do
not let the two drift). `build_sample_frame` assembles the sample-parity
output frame (selected "pixel" rows + their neighbor "replacement" rows)
that downstream truecover code consumes.
"""

from __future__ import annotations

import math

import mercantile
import numpy as np
import pandas as pd

# Source of truth for this constant: pixel's worker/quadkey.py.
EARTH_CIRCUMFERENCE_M = 40_075_016.686


def adaptive_sample_indices(
    lngs: np.ndarray,
    lats: np.ndarray,
    uncertainty: np.ndarray,
    n: int,
    rng: np.random.Generator,
) -> list[int]:
    """Select `n` of `len(lngs)` candidate indices without replacement.

    Faithful numpy port of `fn-adaptive-sampling-0.3.1/fn-adaptive-sampling/
    function.R`. Algorithm:

    1. Uncertainty values equal to 0 are replaced with 0.0001 (R:
       `uncertainty[uncertainty == 0] <- 0.0001`) so a zero-uncertainty
       point still has a nonzero, if tiny, chance of being drawn instead of
       being permanently excluded / dividing by zero downstream.
    2. The first index is drawn with probability proportional to normalized
       uncertainty.
    3. Each subsequent index: for every candidate not yet selected, compute
       its minimum Euclidean distance (in degree space — see below) to any
       already-selected point, normalize those minimum distances to sum to
       1, multiply elementwise by the candidates' normalized uncertainty,
       renormalize that product to sum to 1, then draw one candidate
       proportional to the result. Repeat until `n` indices are selected.

    DISTANCES ARE DELIBERATELY EUCLIDEAN IN DEGREE SPACE, computed directly
    on the raw (lng, lat) pairs — NOT haversine / great-circle distance.
    This is intentional parity with the validated R behavior, which calls
    `RANN::nn2()` directly on the raw `[lon, lat]` coordinate matrix with no
    geographic correction (RANN operates on a plain kd-tree over whatever
    coordinates it is given). Do NOT "improve" this to haversine — doing so
    would silently change which pixels the sampler favors relative to the R
    reference this was ported from, breaking parity for the sake of a
    correction the validated system never made. (R's `nn2` also defaults to
    returning the `k` nearest neighbors and then takes `min()` across them,
    but since `nn.dists` columns are returned nearest-first, that `min()` is
    always just the 1st-nearest-neighbor distance — equivalent to the
    straightforward "min distance to any selected point" implemented here.)

    Returns 0-indexed positions into `lngs`/`lats`/`uncertainty`, in the
    order selected.
    """
    coords = np.column_stack([np.asarray(lngs, dtype=float), np.asarray(lats, dtype=float)])
    m = coords.shape[0]

    u = np.asarray(uncertainty, dtype=float).copy()
    u[u == 0] = 0.0001
    uncertainty_prob = u / u.sum()

    all_idx = np.arange(m)
    first = int(rng.choice(all_idx, p=uncertainty_prob))
    selected: list[int] = [first]

    for _ in range(n - 1):
        selected_mask = np.zeros(m, dtype=bool)
        selected_mask[selected] = True
        not_in_sample = all_idx[~selected_mask]

        selected_coords = coords[selected]
        remaining_coords = coords[not_in_sample]

        # Min euclidean (degree-space) distance from each remaining point
        # to any already-selected point.
        diffs = remaining_coords[:, None, :] - selected_coords[None, :, :]
        dists = np.sqrt((diffs ** 2).sum(axis=-1))
        min_dist = dists.min(axis=1)
        min_dist = min_dist / min_dist.sum()

        pen_uncertainty = uncertainty_prob[not_in_sample] * min_dist
        pen_uncertainty = pen_uncertainty / pen_uncertainty.sum()

        local_choice = int(rng.choice(len(not_in_sample), p=pen_uncertainty))
        selected.append(int(not_in_sample[local_choice]))

    return selected


def cell_ground_area_m2(lat: float, level: int) -> float:
    """True ground area (m^2) of a level-`level` quadkey cell centred at `lat`.

    Copy of pixel's `worker/quadkey.py::cell_ground_area_m2` (that module is
    the source of truth for parity). A Mercator tile spans C/2^z projected
    meters in each axis; ground distance is projected distance x cos(lat) in
    both axes, hence the cos^2 term.
    """
    side = (EARTH_CIRCUMFERENCE_M / 2**level) * math.cos(math.radians(lat))
    return side * side


def _row_centroid_lat(y: int, level: int) -> float:
    """Latitude of the centroid of every tile in Mercator row `y`.

    Copy of pixel's `worker/quadkey.py::_row_centroid_lat` (that module is
    the source of truth for parity) — the true projected Mercator midpoint,
    not the naive degree-bounds average (which diverges from it at coarse
    zoom levels).
    """
    n = math.pi - 2.0 * math.pi * (y + 0.5) / 2**level
    return math.degrees(math.atan(math.sinh(n)))


def neighbor_quadkeys(qk: str) -> list[str]:
    """The up-to-8 same-level neighbors of a quadkey cell.

    Copy of pixel's `worker/quadkey.py::neighbor_quadkeys` (that module is
    the source of truth for parity): x wraps at the antimeridian (modulo
    2^z); rows above/below the Mercator grid (y < 0 or y >= 2^z) are
    dropped, so polar-edge cells have fewer than 8 neighbors.
    """
    t = mercantile.quadkey_to_tile(qk)
    n = 2**t.z
    out: list[str] = []
    for dy in (-1, 0, 1):
        y = t.y + dy
        if y < 0 or y >= n:
            continue
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            out.append(mercantile.quadkey((t.x + dx) % n, y, t.z))
    return out


_RESERVED_COLUMNS = ("kind", "round", "replacement_for")


def build_sample_frame(df: pd.DataFrame, selected: list[int], round_label: str) -> pd.DataFrame:
    """Build the sample-parity output frame: selected "pixel" rows plus
    their 8-neighbor "replacement" rows.

    `df` must have a `quadkey` column; `selected` are positional (`iloc`)
    indices into `df` (as returned by `adaptive_sample_indices`).

    Selected rows: `df.iloc[selected]` verbatim, except that any of `df`'s
    own columns named `kind`, `round`, or `replacement_for` are first
    renamed to `src_kind`/`src_round`/`src_replacement_for` (so a source
    frame that already carries those names — e.g. re-sampling a previous
    round's output — doesn't get silently clobbered), then `kind="pixel"`,
    `round=round_label`, and `replacement_for=None` are set.

    Replacement rows: the union of `neighbor_quadkeys(qk)` for every
    selected row's quadkey, excluding any quadkey that is itself selected,
    deduplicated keeping the first occurrence (so a neighbor shared by two
    selected cells is attributed only to whichever selected cell reaches it
    first, in `selected` order). Columns: `quadkey`, `ground_area_m2`
    (computed from the cell's own Mercator-midpoint latitude via
    `_row_centroid_lat` — not a naive degree-bounds average, for the same
    reason `worker/quadkey.py`'s `cell_centroids` does), `kind="replacement"`,
    `round=round_label`, `replacement_for=<selected quadkey it stands in
    for>`.
    """
    rename_map = {c: f"src_{c}" for c in _RESERVED_COLUMNS if c in df.columns}
    selected_df = df.iloc[list(selected)].rename(columns=rename_map).reset_index(drop=True).copy()
    selected_df["kind"] = "pixel"
    selected_df["round"] = round_label
    selected_df["replacement_for"] = None

    selected_quadkeys = set(selected_df["quadkey"])

    rep_quadkey: list[str] = []
    rep_ground_area: list[float] = []
    rep_replacement_for: list[str] = []
    seen: set[str] = set()

    for qk in selected_df["quadkey"]:
        for neighbor in neighbor_quadkeys(qk):
            if neighbor in selected_quadkeys or neighbor in seen:
                continue
            seen.add(neighbor)
            t = mercantile.quadkey_to_tile(neighbor)
            lat = _row_centroid_lat(t.y, t.z)
            rep_quadkey.append(neighbor)
            rep_ground_area.append(cell_ground_area_m2(lat, t.z))
            rep_replacement_for.append(qk)

    replacements_df = pd.DataFrame({
        "quadkey": rep_quadkey,
        "ground_area_m2": rep_ground_area,
        "kind": "replacement",
        "round": round_label,
        "replacement_for": rep_replacement_for,
    })

    return pd.concat([selected_df, replacements_df], ignore_index=True, sort=False)
