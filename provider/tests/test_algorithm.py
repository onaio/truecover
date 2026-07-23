"""Tests for provider.algorithm: adaptive sampling, quadkey neighbors, and
sample-parity frame assembly.
"""

import mercantile
import numpy as np
import pandas as pd

from provider.algorithm import (
    adaptive_sample_indices,
    build_sample_frame,
)


def test_determinism():
    lngs = np.array([0.0, 1.0, 2.0, 3.0, 10.0])
    lats = np.array([0.0, 1.0, 2.0, 3.0, 10.0])
    uncertainty = np.array([1.0, 2.0, 0.5, 3.0, 1.0])

    result1 = adaptive_sample_indices(lngs, lats, uncertainty, 3, np.random.default_rng(42))
    result2 = adaptive_sample_indices(lngs, lats, uncertainty, 3, np.random.default_rng(42))

    assert result1 == result2


def test_first_pick_bias():
    # One candidate has overwhelmingly higher uncertainty than the rest, so
    # with n=1 (a single weighted draw) index 0 should be picked essentially
    # every time, across many independent seeds.
    lngs = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    lats = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    uncertainty = np.array([1e6, 1e-6, 1e-6, 1e-6, 1e-6])

    for seed in range(50):
        rng = np.random.default_rng(seed)
        result = adaptive_sample_indices(lngs, lats, uncertainty, 1, rng)
        assert result == [0], f"seed {seed} picked {result} instead of [0]"


def test_spatial_spread():
    # A tight cluster of candidates plus one far-away candidate, all with
    # equal uncertainty. Whichever clustered point is picked first, the far
    # point's normalized min-distance term (its distance dwarfs the
    # intra-cluster distances) should dominate the second draw's weighting
    # and get picked second almost certainly.
    #
    # With equal uncertainty, the far point's chance of being picked FIRST
    # is 1/(cluster_size + 1), which caps the achievable "picked second"
    # rate at 1 - 1/(cluster_size + 1). A 3-vs-1 split (as in a minimal
    # "three clustered + one far" example) caps that at only 75% — right at
    # the 150/200 threshold, making the test flaky by construction (200
    # single-draw trials fluctuate by several points either side of the
    # cap). Using a larger cluster pushes the achievable rate well above
    # 150/200 while keeping the same qualitative scenario, so the test
    # reliably exercises the "far point dominates the second draw" behavior
    # without being a coin flip on the cap itself.
    cluster_size = 8
    cluster_lngs = 0.001 * np.arange(cluster_size)
    cluster_lats = np.zeros(cluster_size)
    lngs = np.concatenate([cluster_lngs, [10.0]])
    lats = np.concatenate([cluster_lats, [10.0]])
    far_index = cluster_size
    uncertainty = np.ones(cluster_size + 1)

    trials = 200
    hits = 0
    for seed in range(trials):
        rng = np.random.default_rng(seed)
        result = adaptive_sample_indices(lngs, lats, uncertainty, 2, rng)
        if result[1] == far_index:
            hits += 1

    assert hits >= 150, f"far cell picked second in only {hits}/{trials} trials"


def test_zero_uncertainty_floor():
    # All-zero uncertainty must not error (0 -> 0.0001 floor) and must still
    # produce n distinct indices.
    lngs = np.array([0.0, 1.0, 2.0, 3.0])
    lats = np.array([0.0, 1.0, 2.0, 3.0])
    uncertainty = np.zeros(4)

    rng = np.random.default_rng(1)
    result = adaptive_sample_indices(lngs, lats, uncertainty, 3, rng)

    assert len(result) == 3
    assert len(set(result)) == 3


def test_build_sample_frame_parity():
    level = 10
    tile_a = mercantile.Tile(500, 500, level)
    tile_b = mercantile.Tile(501, 500, level)  # adjacent to A -> shared neighbors
    tile_c = mercantile.Tile(700, 700, level)  # unrelated, not selected

    qk_a = mercantile.quadkey(tile_a)
    qk_b = mercantile.quadkey(tile_b)
    qk_c = mercantile.quadkey(tile_c)

    df = pd.DataFrame({
        "quadkey": [qk_a, qk_b, qk_c],
        "value": [1.0, 2.0, 3.0],
        # Reserved names already present on the source frame, to verify the
        # src_ rename doesn't clobber them.
        "kind": ["orig_a", "orig_b", "orig_c"],
        "round": [0, 0, 0],
        "replacement_for": [None, None, None],
    })

    result = build_sample_frame(df, [0, 1], round_label="round-1")

    # Reserved source columns were renamed, not overwritten.
    assert {"src_kind", "src_round", "src_replacement_for"} <= set(result.columns)

    selected_rows = result[result["kind"] == "pixel"]
    replacement_rows = result[result["kind"] == "replacement"]

    # Selected rows: kind/round/replacement_for set, original data preserved
    # under src_*.
    assert len(selected_rows) == 2
    assert set(selected_rows["src_kind"]) == {"orig_a", "orig_b"}
    assert (selected_rows["round"] == "round-1").all()
    assert selected_rows["replacement_for"].isna().all()
    assert set(selected_rows["quadkey"]) == {qk_a, qk_b}

    # Replacement rows: kind/round/replacement_for set; ground_area_m2
    # present; never re-list a selected quadkey.
    assert len(replacement_rows) > 0
    assert (replacement_rows["kind"] == "replacement").all()
    assert (replacement_rows["round"] == "round-1").all()
    assert set(replacement_rows["replacement_for"]) <= {qk_a, qk_b}
    assert not (set(replacement_rows["quadkey"]) & {qk_a, qk_b})
    assert replacement_rows["ground_area_m2"].notna().all()

    # The untouched, unselected row C never appears in the output at all.
    assert qk_c not in set(result["quadkey"])

    # Quadkey uniqueness across the whole frame (selected + replacements).
    assert result["quadkey"].is_unique

    # Dedup keep-first: A and B are adjacent tiles, so they share some
    # neighbors (e.g. the tile directly above the shared edge). That shared
    # neighbor must appear exactly once, attributed to A (selected first).
    shared_neighbor = mercantile.quadkey(mercantile.Tile(500, 499, level))
    match = replacement_rows[replacement_rows["quadkey"] == shared_neighbor]
    assert len(match) == 1
    assert match["replacement_for"].iloc[0] == qk_a
