# Stratified Cluster Sampling Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Stratified Round wizard start from a City Corporation (picking N Zones, then M Wards per zone, then K pixels per ward) as an alternative to the existing District → Upazila → Union rural flow, by making `admin_boundaries.id` the canonical selector throughout the stratified-sampling pipeline instead of pcodes.

**Architecture:** About half of `temporal/activities/cluster_sampling.py` is already generic (keyed by `campaign_area_id`, not by rural vocabulary) and needs zero changes. The other half — `get_children_for_pcodes`, `create_campaign_areas_for_unions`, `create_coverage_pixels_for_union`, `update_campaign_area_sampled_count_for_union`, `select_clusters`'s population weighting, `cluster_sampling_config`, the workflow, the route, and the wizard — is hardcoded to rural pcodes and gets generalized to accept `admin_boundaries.id` (which every boundary has, pcode-bearing or not), reusing the merge-both-branches pattern already shipped in `routes/admin_boundaries.py::get_admin_boundary_children`.

**Tech Stack:** Flask + psycopg2, PostgreSQL/PostGIS, Temporal (Python SDK), pytest with real-DB rollback fixtures, React + TypeScript.

## Global Constraints

- `cluster_sampling_config` is an internal table with a single frontend consumer (the wizard) — column renames happen with no backward-compatibility shim, both sides change together.
- Never touch `admin_boundaries`'s existing columns, `campaign_areas`, or any rural-only activity that's already generic (`compute_pixels_for_campaign_areas`, `create_coverage_pixels_for_campaign_area`, `sample_pixels_for_campaign_area`, `assign_pixels_to_round`, `update_campaign_area_sampled_counts`, `create_replacement_pixels`) — these are reused unchanged.
- `admin_boundary_pixels` is NOT populated for the new levels (ward/block/zone/city_corporation) in production yet — any population-weighting fix must degrade gracefully (treat as population 0/unweighted) rather than error when that table has no rows for a given boundary.
- Mirror the merge-both-branches pattern from `routes/admin_boundaries.py::get_admin_boundary_children` (lines 86-185, current shipped state) exactly — a boundary can have BOTH `parent_id`-linked children (e.g. a district's city corporation) AND pcode-derived children (e.g. that same district's upazilas) simultaneously; treating them as either/or was a real, previously-shipped bug. Do not repeat it here.
- Tests use real Postgres via `db.connection.get_db_connection()`/`return_db_connection()` with a rollback fixture (per `truecover-backend/tests/test_admin_boundary_children.py`'s pattern), except where the code under test commits internally — then use a real committed fixture with explicit cleanup (per `truecover-backend/tests/test_replacement_pixels.py`'s `committed_*` pattern).
- No existing test-bypass convention for `@require_auth`-protected Flask routes exists — where a route needs direct testing, call the undecorated view via `route_function.__wrapped__(user, ...)` inside a `test_request_context`, monkeypatching `get_db_connection`/`return_db_connection` to the test's own connection (per `truecover-backend/tests/test_admin_boundary_children.py::TestChildrenEndpointMergesBothSources`).
- **Temporal workflow/activity code changes require redeploying the `temporal-worker` Railway service specifically** — it does not share a deploy with the Flask API and does not hot-reload. A previous merge sat live in `master` for 5 months without this service being redeployed, silently running stale code. Do not consider this plan "deployed" until `temporal-worker` has been redeployed and its live commit hash verified.
- Every new/modified Python and TypeScript file needs the two-line `ABOUTME:` header per repo convention.

---

## File Structure

| File | Responsibility |
|---|---|
| `truecover-backend/db/migrations/rename_cluster_sampling_config_columns.sql` | Renames 3 columns, replaces `starting_pcode` with `starting_boundary_id` (new) |
| `truecover-backend/temporal/activities/cluster_sampling.py` | `get_children_for_pcodes` → `get_children_for_boundary_ids`; `select_clusters` population-weighting fix; `create_campaign_areas_for_unions` → `create_campaign_areas_for_boundaries`; `create_coverage_pixels_for_union`/`update_campaign_area_sampled_count_for_union` removed; `save_cluster_sampling_config` param renames (modified) |
| `truecover-backend/temporal/workflows/stratified_cluster_sampling.py` | `UnionPixelSamplingWorkflow` → `AreaPixelSamplingWorkflow` (campaign_area_id-keyed); `StratifiedClusterSamplingWorkflow` generalized to ids (modified) |
| `truecover-backend/routes/rounds.py` | `create_stratified_cluster_round` body field renames (modified) |
| `truecover-backend/tests/test_cluster_sampling_generalization.py` | Tests for all the above backend changes (new) |
| `truecover-app/src/hooks/useAdminBoundaries.ts` | Add `useCityCorporations()` hook (modified) |
| `truecover-app/src/components/StratifiedClusterSamplingWizard.tsx` | Step 0 branch choice, generic Step 1/2/3 labels driven by chosen branch (modified) |

---

## Task 1: `cluster_sampling_config` schema migration

**Files:**
- Create: `truecover-backend/db/migrations/rename_cluster_sampling_config_columns.sql`
- Test: `truecover-backend/tests/test_cluster_sampling_generalization.py` (new file, this task adds the first test class)

**Interfaces:**
- Produces: `cluster_sampling_config` columns `stage1_count`, `stage2_count`, `pixels_per_stage2`, `starting_boundary_id UUID NOT NULL REFERENCES admin_boundaries(id)`. `starting_pcode`, `upazila_count`, `unions_per_upazila`, `pixels_per_union` no longer exist.

- [ ] **Step 1: Write the failing test**

```python
# ABOUTME: Tests for the generalized stratified cluster sampling schema and activities
# ABOUTME: Covers cluster_sampling_config renames, boundary-id-based children lookup, and campaign area creation

import pytest
from db.connection import get_db_connection, return_db_connection


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestClusterSamplingConfigSchema:
    def test_new_columns_exist(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'cluster_sampling_config'
              AND column_name IN ('stage1_count', 'stage2_count', 'pixels_per_stage2', 'starting_boundary_id')
        """)
        found = {row[0] for row in cursor.fetchall()}
        assert found == {'stage1_count', 'stage2_count', 'pixels_per_stage2', 'starting_boundary_id'}

    def test_old_columns_removed(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'cluster_sampling_config'
              AND column_name IN ('starting_pcode', 'upazila_count', 'unions_per_upazila', 'pixels_per_union')
        """)
        assert cursor.fetchall() == []

    def test_starting_boundary_id_references_admin_boundaries(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT ccu.table_name, ccu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'cluster_sampling_config'
              AND tc.constraint_type = 'FOREIGN KEY'
              AND kcu.column_name = 'starting_boundary_id'
        """)
        result = cursor.fetchone()
        assert result == ('admin_boundaries', 'id')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py -v`
Expected: FAIL — `found == set()`, old columns still present

- [ ] **Step 3: Write the migration**

```sql
-- ABOUTME: Renames cluster_sampling_config's rural-specific columns to generic stage names
-- ABOUTME: Replaces starting_pcode with starting_boundary_id so city corporations (no pcode) can start a round

ALTER TABLE cluster_sampling_config RENAME COLUMN upazila_count TO stage1_count;
ALTER TABLE cluster_sampling_config RENAME COLUMN unions_per_upazila TO stage2_count;
ALTER TABLE cluster_sampling_config RENAME COLUMN pixels_per_union TO pixels_per_stage2;

ALTER TABLE cluster_sampling_config ADD COLUMN starting_boundary_id UUID REFERENCES admin_boundaries(id);

UPDATE cluster_sampling_config csc
SET starting_boundary_id = ab.id
FROM admin_boundaries ab
WHERE ab.adm2_pcode = csc.starting_pcode AND ab.level = 2;

ALTER TABLE cluster_sampling_config ALTER COLUMN starting_boundary_id SET NOT NULL;
ALTER TABLE cluster_sampling_config DROP COLUMN starting_pcode;
```

Note: the `UPDATE` backfill only matches rows whose `starting_pcode` was a district pcode (the only kind ever created, since city-corporation starting points didn't exist before this plan) — if any existing `cluster_sampling_config` row's `starting_pcode` doesn't match a level-2 district (unexpected, but possible if data is stale), the subsequent `SET NOT NULL` will fail loudly rather than silently leaving a NULL; investigate any such row before re-running if that happens.

Apply it:

Run: `psql postgresql://truecover:truecover@localhost:5435/truecover < db/migrations/rename_cluster_sampling_config_columns.sql`
Expected: `ALTER TABLE` ×3, `ALTER TABLE`, `UPDATE N` (N = however many existing rows), `ALTER TABLE` ×2

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/db/migrations/rename_cluster_sampling_config_columns.sql truecover-backend/tests/test_cluster_sampling_generalization.py
git commit -m "Rename cluster_sampling_config to generic stage columns, add starting_boundary_id"
```

---

## Task 2: `get_children_for_boundary_ids` (generalize `get_children_for_pcodes`)

**Files:**
- Modify: `truecover-backend/temporal/activities/cluster_sampling.py` (function at lines 100-175, current source)
- Modify: `truecover-backend/tests/test_cluster_sampling_generalization.py`

**Interfaces:**
- Consumes: `admin_boundaries.parent_id`/`boundary_type` (already shipped).
- Produces: `get_children_for_boundary_ids(parent_ids: List[str], categories: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]` — same return shape as before (`{parent_id: {'children': [{'id': str, 'pcode': str|None, 'name': str}], 'category': str}}`), but `parent_ids` and `categories`'s keys are now `admin_boundaries.id` strings instead of pcodes, and each child dict now includes `id` (previously only `pcode`).

- [ ] **Step 1: Write the failing test**

This mirrors `routes/admin_boundaries.py`'s already-shipped merge logic — the test constructs a district with BOTH a real pcode-reachable upazila-equivalent child and a `parent_id`-linked city-corporation-equivalent child, and asserts both come back merged (not either/or).

```python
class TestGetChildrenForBoundaryIds:
    def test_merges_parent_id_and_pcode_children(self, db_conn):
        from temporal.activities.cluster_sampling import get_children_for_boundary_ids
        import asyncio

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm2_pcode, boundary_type)
            VALUES ('Test District GCFBI', 'BD', 2, 'BDGCFBI', 'district')
            RETURNING id
        """)
        district_id = str(cursor.fetchone()[0])

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm2_pcode, adm3_pcode, boundary_type)
            VALUES ('Test Upazila GCFBI', 'BD', 3, 'BDGCFBI', 'BDGCFBI01', 'upazila')
        """)

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test City Corp GCFBI', 'BD', 3, %s, 'city_corporation')
        """, (district_id,))

        result = asyncio.get_event_loop().run_until_complete(
            get_children_for_boundary_ids([district_id], {'high_risk': [district_id]})
        )

        children = result[district_id]['children']
        names = {c['name'] for c in children}
        assert names == {'Test Upazila GCFBI', 'Test City Corp GCFBI'}
        assert result[district_id]['category'] == 'high_risk'

        upazila_child = next(c for c in children if c['name'] == 'Test Upazila GCFBI')
        cc_child = next(c for c in children if c['name'] == 'Test City Corp GCFBI')
        assert upazila_child['pcode'] == 'BDGCFBI01'
        assert cc_child['pcode'] is None
        assert 'id' in upazila_child and 'id' in cc_child

    def test_no_children_returns_empty_list(self, db_conn):
        from temporal.activities.cluster_sampling import get_children_for_boundary_ids
        import asyncio

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Leaf GCFBI', 'BD', 5, 'ward') RETURNING id
        """)
        leaf_id = str(cursor.fetchone()[0])

        result = asyncio.get_event_loop().run_until_complete(
            get_children_for_boundary_ids([leaf_id], {})
        )
        assert result[leaf_id]['children'] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py::TestGetChildrenForBoundaryIds -v`
Expected: FAIL with `ImportError: cannot import name 'get_children_for_boundary_ids'`

- [ ] **Step 3: Replace the function**

Replace `get_children_for_pcodes` (lines 100-175 of `truecover-backend/temporal/activities/cluster_sampling.py`) with:

```python
@activity.defn
async def get_children_for_boundary_ids(
    parent_ids: List[str],
    categories: Dict[str, List[str]]
) -> Dict[str, Dict[str, Any]]:
    """
    Get child boundaries for a list of parent admin_boundaries ids.

    Merges parent_id-linked children (e.g. a district's city corporation)
    with pcode-derived children (e.g. that district's upazilas) - a boundary
    can have both simultaneously, they are siblings, not alternatives.

    Args:
        parent_ids: List of parent admin_boundaries.id values
        categories: Original categories to inherit to children, keyed by parent id

    Returns:
        Dict mapping parent_id to {children: [{id, pcode, name}], category: str}
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        result = {}

        id_to_category = {}
        for category, ids in categories.items():
            for boundary_id in ids:
                id_to_category[boundary_id] = category

        for parent_id in parent_ids:
            children = []

            cursor.execute("""
                SELECT id, name,
                       adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
                FROM admin_boundaries WHERE parent_id = %s ORDER BY name
            """, (parent_id,))
            for row in cursor.fetchall():
                pcode = next((row[2 + i] for i in range(5) if row[2 + i]), None)
                children.append({'id': str(row[0]), 'pcode': pcode, 'name': row[1]})

            cursor.execute("""
                SELECT level, adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
                FROM admin_boundaries WHERE id = %s
            """, (parent_id,))
            parent_row = cursor.fetchone()
            if parent_row:
                parent_level = parent_row[0]
                child_level = parent_level + 1
                if child_level <= 4:
                    pcode = parent_row[1 + parent_level]
                    parent_col = f'adm{parent_level}_pcode'
                    child_col = f'adm{child_level}_pcode'
                    cursor.execute(f"""
                        SELECT id, name, {child_col} FROM admin_boundaries
                        WHERE level = %s AND {parent_col} = %s
                        ORDER BY name
                    """, (child_level, pcode))
                    for row in cursor.fetchall():
                        children.append({'id': str(row[0]), 'pcode': row[2], 'name': row[1]})

            result[parent_id] = {
                'children': children,
                'category': id_to_category.get(parent_id, 'uncategorized')
            }

        activity.logger.info(f"Fetched children for {len(result)} parent boundary ids")
        return result

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/temporal/activities/cluster_sampling.py truecover-backend/tests/test_cluster_sampling_generalization.py
git commit -m "Generalize get_children_for_pcodes to accept boundary ids and merge both child sources"
```

---

## Task 3: `select_clusters` population-weighting fix for id-only boundaries

**Files:**
- Modify: `truecover-backend/temporal/activities/cluster_sampling.py` (function at lines 11-97, current source)
- Modify: `truecover-backend/tests/test_cluster_sampling_generalization.py`

**Interfaces:**
- Consumes: `admin_boundary_pixels`, `pixel_area`/`pixels.population` (existing tables).
- Produces: `select_clusters` unchanged signature (`pcodes: List[str]` param now holds either pcodes or `admin_boundaries.id` strings — rename the param to `ids` for clarity since it's genuinely either now); when an entry is a UUID (has no pcode meaning), population is looked up via `admin_boundary_pixels` instead of the `pixels` table's `adm{n}_pcode` columns, defaulting to population `0` (not `1`) when `admin_boundary_pixels` has no rows for that boundary (since that table isn't populated for new levels yet — see Global Constraints).

- [ ] **Step 1: Write the failing test**

```python
class TestSelectClustersPopulationWeighting:
    def test_population_weighting_by_pcode_still_works(self, db_conn):
        from temporal.activities.cluster_sampling import select_clusters
        import asyncio

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO pixels (quadkey, geometry, latitude, longitude, level, adm4_pcode, population)
            VALUES ('test_scpw_pcode', ST_GeomFromText('POINT(90 23)', 4326), 23, 90, 18, 'BDSCPWPCODE', 500)
        """)

        result = asyncio.get_event_loop().run_until_complete(
            select_clusters(['BDSCPWPCODE'], {'high_risk': ['BDSCPWPCODE']}, 1, True, None)
        )
        assert result == ['BDSCPWPCODE']

    def test_population_weighting_by_boundary_id_uses_admin_boundary_pixels(self, db_conn):
        from temporal.activities.cluster_sampling import select_clusters
        import asyncio

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Zone SCPW', 'BD', 4, 'zone') RETURNING id
        """)
        zone_id = str(cursor.fetchone()[0])

        cursor.execute("""
            INSERT INTO pixels (quadkey, geometry, latitude, longitude, level, population)
            VALUES ('test_scpw_id', ST_GeomFromText('POINT(91 24)', 4326), 24, 91, 18, 300)
        """)
        cursor.execute("""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'test_scpw_id')
        """, (zone_id,))

        result = asyncio.get_event_loop().run_until_complete(
            select_clusters([zone_id], {'high_risk': [zone_id]}, 1, True, None)
        )
        assert result == [zone_id]

    def test_population_weighting_by_boundary_id_with_no_pixels_defaults_to_zero(self, db_conn):
        from temporal.activities.cluster_sampling import select_clusters
        import asyncio

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Empty Zone SCPW', 'BD', 4, 'zone') RETURNING id
        """)
        zone_id = str(cursor.fetchone()[0])

        # No admin_boundary_pixels rows for this zone - must not error, must still select it
        result = asyncio.get_event_loop().run_until_complete(
            select_clusters([zone_id], {'high_risk': [zone_id]}, 1, True, None)
        )
        assert result == [zone_id]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py::TestSelectClustersPopulationWeighting -v`
Expected: the id-based tests FAIL — `zone_id` doesn't parse as a pcode-matching value in the current `WHERE p.adm1_pcode = %s OR ...` query (it's a UUID string that will never match any `adm{n}_pcode` column), so population silently defaults to the old code's `1` instead of `300`/`0`, but since there's only one candidate the selection still returns it — sharpen the test to prove the value used, by checking a version that also can't select a second one with the same behavior. Simpler: verify the assertion directly on the underlying query fix in Step 3, and rely on `test_population_weighting_by_boundary_id_uses_admin_boundary_pixels` failing to distinguish `1` from `300` only if two candidates compete — add a two-candidate variant:

```python
    def test_boundary_id_with_more_pixels_is_weighted_higher(self, db_conn):
        from temporal.activities.cluster_sampling import select_clusters
        import asyncio
        from collections import Counter

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Heavy Zone SCPW', 'BD', 4, 'zone') RETURNING id
        """)
        heavy_id = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Light Zone SCPW', 'BD', 4, 'zone') RETURNING id
        """)
        light_id = str(cursor.fetchone()[0])

        cursor.execute("""
            INSERT INTO pixels (quadkey, geometry, latitude, longitude, level, population)
            VALUES ('test_scpw_heavy', ST_GeomFromText('POINT(92 25)', 4326), 25, 92, 18, 10000)
        """)
        cursor.execute("INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'test_scpw_heavy')", (heavy_id,))
        cursor.execute("""
            INSERT INTO pixels (quadkey, geometry, latitude, longitude, level, population)
            VALUES ('test_scpw_light', ST_GeomFromText('POINT(93 26)', 4326), 26, 93, 18, 1)
        """)
        cursor.execute("INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'test_scpw_light')", (light_id,))

        picks = Counter()
        for _ in range(30):
            result = asyncio.get_event_loop().run_until_complete(
                select_clusters([heavy_id, light_id], {'high_risk': [heavy_id, light_id]}, 1, True, None)
            )
            picks[result[0]] += 1

        assert picks[heavy_id] > picks[light_id]
```

- [ ] **Step 3: Modify the population-weighting query**

In `truecover-backend/temporal/activities/cluster_sampling.py`, `select_clusters` (lines 11-97), replace:

```python
def upsert_replacement_pixel(cursor, quadkey: str, campaign_id: str, indicator_id: str,
```

Wait — that function is unrelated and stays untouched. The actual edit is inside `select_clusters`'s loop, changing:

```python
                if population_weighted:
                    # Get population for this pcode from pixels
                    cursor.execute("""
                        SELECT COALESCE(SUM(p.population), 1)
                        FROM pixels p
                        WHERE (p.adm1_pcode = %s OR p.adm2_pcode = %s
                               OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
                          AND p.population IS NOT NULL
                    """, (pcode, pcode, pcode, pcode))
                    pop_result = cursor.fetchone()
                    population = float(pop_result[0]) if pop_result and pop_result[0] else 1
                    weight *= population
```

to:

```python
                if population_weighted:
                    population = _population_for_identifier(cursor, pcode)
                    weight *= population
```

and add this helper function above `select_clusters`:

```python
def _population_for_identifier(cursor, identifier: str) -> float:
    """
    Population for a pcode (existing pixels.adm{n}_pcode match) or a boundary
    id (admin_boundary_pixels -> pixels.population). Defaults to 0 for a
    boundary id with no admin_boundary_pixels rows yet (that table isn't
    populated for the new ward/block/zone/city_corporation levels in
    production yet) - not 1, since 0 correctly means "unweighted, not
    silently favored" rather than pretending a nonzero population exists.
    """
    import uuid
    try:
        uuid.UUID(identifier)
        cursor.execute("""
            SELECT COALESCE(SUM(p.population), 0)
            FROM admin_boundary_pixels abp
            JOIN pixels p ON abp.quadkey = p.quadkey
            WHERE abp.admin_boundary_id = %s AND p.population IS NOT NULL
        """, (identifier,))
    except ValueError:
        cursor.execute("""
            SELECT COALESCE(SUM(p.population), 1)
            FROM pixels p
            WHERE (p.adm1_pcode = %s OR p.adm2_pcode = %s
                   OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
              AND p.population IS NOT NULL
        """, (identifier, identifier, identifier, identifier))
    result = cursor.fetchone()
    return float(result[0]) if result and result[0] else (0.0 if _is_uuid(identifier) else 1.0)


def _is_uuid(value: str) -> bool:
    import uuid
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False
```

Note: `weight *= population` with `population = 0` makes that candidate's `weight` exactly `0` (unless `category_weight` alone matters) — combined with the existing "fall back to uniform random" branch (`if total_weight == 0: choice = random.choice(remaining_pool)`), a pool of all-zero-population id-only boundaries degrades to plain uniform random selection, which is the correct behavior once `admin_boundary_pixels` is empty for every candidate — not a crash, not a silent bias.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py -v`
Expected: 9 passed. (The weighted-higher test is probabilistic across 30 trials with a 10000:1 population ratio — if it ever flakes, that signals a real bug in the weighting math, not test noise; do not raise the trial count to paper over an actual failure.)

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/temporal/activities/cluster_sampling.py truecover-backend/tests/test_cluster_sampling_generalization.py
git commit -m "Fix select_clusters population weighting for boundaries with no pcode"
```

---

## Task 4: `create_campaign_areas_for_boundaries` (generalize `create_campaign_areas_for_unions`)

**Files:**
- Modify: `truecover-backend/temporal/activities/cluster_sampling.py` (function at lines 229-318, current source)
- Modify: `truecover-backend/tests/test_cluster_sampling_generalization.py`

**Interfaces:**
- Produces: `create_campaign_areas_for_boundaries(campaign_id: str, boundary_ids: List[str], boundary_category_map: Optional[Dict[str, str]] = None) -> List[str]` — same behavior as `create_campaign_areas_for_unions` but looks up `admin_boundaries` by `id = %s` instead of `adm4_pcode = %s`.

- [ ] **Step 1: Write the failing test**

```python
class TestCreateCampaignAreasForBoundaries:
    def test_creates_campaign_area_for_boundary_with_no_pcode(self, db_conn):
        from temporal.activities.cluster_sampling import create_campaign_areas_for_boundaries
        import asyncio, uuid as uuid_mod

        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO organizations (name) VALUES (%s) RETURNING id", (f"test-org-{uuid_mod.uuid4().hex[:8]}",))
        org_id = cursor.fetchone()[0]
        cursor.execute("INSERT INTO projects (organization_id, title) VALUES (%s, %s) RETURNING id", (org_id, "test-proj"))
        project_id = cursor.fetchone()[0]
        cursor.execute("INSERT INTO campaigns (project_id, name) VALUES (%s, %s) RETURNING id", (project_id, "test-campaign"))
        campaign_id = str(cursor.fetchone()[0])

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, geometry)
            VALUES ('Test Ward CCAFB', 'BD', 5, 'ward',
                    ST_GeomFromText('POLYGON((90 23, 91 23, 91 24, 90 24, 90 23))', 4326))
            RETURNING id
        """)
        ward_id = str(cursor.fetchone()[0])

        result = asyncio.get_event_loop().run_until_complete(
            create_campaign_areas_for_boundaries(campaign_id, [ward_id], {ward_id: 'high_risk'})
        )

        assert len(result) == 1
        cursor.execute("SELECT admin_boundary_id, category, status FROM campaign_areas WHERE id = %s", (result[0],))
        row = cursor.fetchone()
        assert str(row[0]) == ward_id
        assert row[1] == 'high_risk'
        assert row[2] == 'sampling'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py::TestCreateCampaignAreasForBoundaries -v`
Expected: FAIL with `ImportError: cannot import name 'create_campaign_areas_for_boundaries'`

- [ ] **Step 3: Replace the function**

Replace `create_campaign_areas_for_unions` (lines 229-318) with:

```python
@activity.defn
async def create_campaign_areas_for_boundaries(
    campaign_id: str,
    boundary_ids: List[str],
    boundary_category_map: Optional[Dict[str, str]] = None
) -> List[str]:
    """
    Create campaign_areas for each selected boundary (union, ward, or any
    admin_boundaries row - looked up by id, not pcode, since city
    corporation/zone/ward rows have no pcode).

    Args:
        campaign_id: Campaign to add areas to
        boundary_ids: List of admin_boundaries.id values to add as campaign areas
        boundary_category_map: Optional mapping of boundary id -> category name

    Returns:
        List of created campaign_area IDs
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        created_ids = []

        for boundary_id in boundary_ids:
            cursor.execute("""
                SELECT id, name, ST_AsText(geometry),
                       ST_XMin(geometry), ST_YMin(geometry),
                       ST_XMax(geometry), ST_YMax(geometry)
                FROM admin_boundaries
                WHERE id = %s
            """, (boundary_id,))

            row = cursor.fetchone()
            if not row:
                activity.logger.warning(f"Admin boundary not found for id {boundary_id}")
                continue

            admin_boundary_id = str(row[0])
            name = row[1]
            geometry_wkt = row[2]
            bbox_min_lng = row[3]
            bbox_min_lat = row[4]
            bbox_max_lng = row[5]
            bbox_max_lat = row[6]
            category = boundary_category_map.get(boundary_id) if boundary_category_map else None

            cursor.execute("""
                SELECT id FROM campaign_areas
                WHERE campaign_id = %s AND admin_boundary_id = %s
            """, (campaign_id, admin_boundary_id))

            existing = cursor.fetchone()
            if existing:
                cursor.execute("""
                    UPDATE campaign_areas SET category = %s, status = 'sampling' WHERE id = %s
                """, (category, str(existing[0])))
                created_ids.append(str(existing[0]))
                continue

            cursor.execute("""
                INSERT INTO campaign_areas (
                    campaign_id, name, area_type, admin_boundary_id, geometry,
                    bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
                    category, status
                )
                VALUES (%s, %s, 'admin_boundary', %s, ST_GeomFromText(%s, 4326), %s, %s, %s, %s, %s, 'sampling')
                RETURNING id
            """, (
                campaign_id, name, admin_boundary_id, geometry_wkt,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
                category
            ))

            area_id = str(cursor.fetchone()[0])
            created_ids.append(area_id)

        conn.commit()
        activity.logger.info(f"Created {len(created_ids)} campaign areas for boundaries")
        return created_ids

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py -v`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/temporal/activities/cluster_sampling.py truecover-backend/tests/test_cluster_sampling_generalization.py
git commit -m "Generalize create_campaign_areas_for_unions to look up boundaries by id"
```

---

## Task 5: Drop `create_coverage_pixels_for_union`/`update_campaign_area_sampled_count_for_union`, rename `save_cluster_sampling_config` params

**Files:**
- Modify: `truecover-backend/temporal/activities/cluster_sampling.py` (removes lines 400-454 and 725-799 of the pre-Task-1 source; modifies `save_cluster_sampling_config` at lines 178-226)
- Modify: `truecover-backend/tests/test_cluster_sampling_generalization.py`

**Interfaces:**
- Consumes: `create_coverage_pixels_for_campaign_area`, `update_campaign_area_sampled_counts` (already generic, unchanged, still in this file).
- Produces: `save_cluster_sampling_config(round_id, campaign_id, starting_boundary_id, categories, stage1_count, stage2_count, pixels_per_stage2, population_weighted, category_weights, min_population) -> str`. `create_coverage_pixels_for_union` and `update_campaign_area_sampled_count_for_union` no longer exist — Task 6's workflow generalization calls the generic `create_coverage_pixels_for_campaign_area`/`update_campaign_area_sampled_counts` instead.

- [ ] **Step 1: Write the failing test**

```python
class TestSaveClusterSamplingConfig:
    def test_saves_with_generic_column_names(self, db_conn):
        from temporal.activities.cluster_sampling import save_cluster_sampling_config
        import asyncio, uuid as uuid_mod

        cursor = db_conn.cursor()
        cursor.execute("INSERT INTO organizations (name) VALUES (%s) RETURNING id", (f"test-org-{uuid_mod.uuid4().hex[:8]}",))
        org_id = cursor.fetchone()[0]
        cursor.execute("INSERT INTO projects (organization_id, title) VALUES (%s, %s) RETURNING id", (org_id, "test-proj"))
        project_id = cursor.fetchone()[0]
        cursor.execute("INSERT INTO campaigns (project_id, name) VALUES (%s, %s) RETURNING id", (project_id, "test-campaign"))
        campaign_id = str(cursor.fetchone()[0])
        cursor.execute("INSERT INTO indicators (project_id, name) VALUES (%s, %s) RETURNING id", (project_id, "test-indicator"))
        indicator_id = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO rounds (campaign_id, round_number, name, indicator_id, sampling_target, sampling_method)
            VALUES (%s, 1, 'Test Round', %s, 'pixels', 'stratified_cluster') RETURNING id
        """, (campaign_id, indicator_id))
        round_id = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test CC SCSC', 'BD', 3, 'city_corporation') RETURNING id
        """)
        cc_id = str(cursor.fetchone()[0])

        config_id = asyncio.get_event_loop().run_until_complete(
            save_cluster_sampling_config(
                round_id, campaign_id, cc_id, {'high_risk': [cc_id]}, 3, 2, 50, False, None, None
            )
        )

        cursor.execute("""
            SELECT starting_boundary_id, stage1_count, stage2_count, pixels_per_stage2
            FROM cluster_sampling_config WHERE id = %s
        """, (config_id,))
        row = cursor.fetchone()
        assert str(row[0]) == cc_id
        assert row[1:] == (3, 2, 50)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py::TestSaveClusterSamplingConfig -v`
Expected: FAIL — current `save_cluster_sampling_config` still takes `starting_pcode`/`upazila_count`/`unions_per_upazila`/`pixels_per_union` and inserts into now-nonexistent columns

- [ ] **Step 3: Modify `save_cluster_sampling_config`, delete the two union-specific functions**

Replace `save_cluster_sampling_config` (lines 178-226 of the pre-Task-1 source) with:

```python
@activity.defn
async def save_cluster_sampling_config(
    round_id: str,
    campaign_id: str,
    starting_boundary_id: str,
    categories: Dict[str, List[str]],
    stage1_count: int,
    stage2_count: int,
    pixels_per_stage2: int,
    population_weighted: bool,
    category_weights: Optional[Dict[str, float]],
    min_population: Optional[int]
) -> str:
    """Save cluster sampling configuration to database."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO cluster_sampling_config
            (round_id, campaign_id, starting_boundary_id, categories, stage1_count, stage2_count,
             pixels_per_stage2, population_weighted, category_weights, min_population)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            round_id,
            campaign_id,
            starting_boundary_id,
            json.dumps(categories),
            stage1_count,
            stage2_count,
            pixels_per_stage2,
            population_weighted,
            json.dumps(category_weights) if category_weights else None,
            min_population
        ))

        config_id = str(cursor.fetchone()[0])
        conn.commit()

        activity.logger.info(f"Saved cluster sampling config {config_id} for round {round_id}")
        return config_id

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)
```

Delete the entire `create_coverage_pixels_for_union` function (lines 400-454 of the pre-Task-1 source) and the entire `update_campaign_area_sampled_count_for_union` function (lines 725-799 of the pre-Task-1 source) — their generic siblings `create_coverage_pixels_for_campaign_area` and `update_campaign_area_sampled_counts` (both already in this file, unchanged) replace them in Task 6's workflow.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py -v`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/temporal/activities/cluster_sampling.py truecover-backend/tests/test_cluster_sampling_generalization.py
git commit -m "Rename save_cluster_sampling_config params, drop union-specific activities in favor of generic siblings"
```

---

## Task 6: Generalize the Temporal workflow

**Files:**
- Modify: `truecover-backend/temporal/workflows/stratified_cluster_sampling.py` (entire file)

**Interfaces:**
- Consumes: `get_children_for_boundary_ids`, `create_campaign_areas_for_boundaries`, `save_cluster_sampling_config` (Tasks 2/4/5), `create_coverage_pixels_for_campaign_area`, `update_campaign_area_sampled_counts` (already generic).
- Produces: `AreaPixelSamplingWorkflow` (renamed from `UnionPixelSamplingWorkflow`, keyed by `campaign_area_id` not `union_pcode`), `StratifiedClusterSamplingWorkflow.run(campaign_id, name, description, start_date, end_date, indicator_id, starting_boundary_id, categories, stage1_count, stage2_count, pixels_per_stage2, population_weighted, category_weights, min_population, uncertainty_field='prevalence_bci_width')`.

- [ ] **Step 1: There is no isolated unit test for a Temporal workflow in this codebase** (workflows are integration-tested by running them against the real Temporal server + worker, which the plan's other tasks' activity-level tests already cover the pieces of). Skip the TDD test-first step for this task specifically — instead, after writing the code, verify by reading it against every activity signature from Tasks 2, 4, and 5, checking each `args=[...]` list matches the callee's parameter order exactly. This is the one task in this plan without an automated test; the final manual verification (Task 8) exercises it end-to-end.

- [ ] **Step 2: Rewrite the file**

```python
# ABOUTME: Temporal workflow for stratified cluster sampling
# ABOUTME: Orchestrates multi-stage cluster selection with adaptive sampling, rural or city-corporation branch

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.workflow import ParentClosePolicy
from typing import Dict, Any, List, Optional

with workflow.unsafe.imports_passed_through():
    from ..activities.cluster_sampling import (
        select_clusters,
        get_children_for_boundary_ids,
        save_cluster_sampling_config,
        create_campaign_areas_for_boundaries,
        compute_pixels_for_campaign_areas,
        create_coverage_pixels_for_campaign_area,
        update_campaign_area_sampled_counts,
        create_replacement_pixels,
    )
    from ..activities.rounds import (
        create_round_record,
        delete_round_record,
        call_adaptive_sampling,
        update_round_assignments,
        remove_round_assignments,
    )
    from ..activities.cluster_sampling import sample_pixels_for_campaign_area, assign_pixels_to_round


@workflow.defn
class AreaPixelSamplingWorkflow:
    """
    Child workflow for sampling pixels from a single campaign area
    (a selected union, or a selected ward under a city corporation zone).
    Spawned by StratifiedClusterSamplingWorkflow for each selected stage-2 boundary.
    """

    def __init__(self):
        self.status = "initializing"
        self.pixels_selected = 0

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'pixels_selected': self.pixels_selected
        }

    @workflow.run
    async def run(
        self,
        campaign_id: str,
        indicator_id: str,
        campaign_area_id: str,
        round_number: int,
        pixels_per_stage2: int,
        min_population: Optional[int],
        uncertainty_field: str = 'prevalence_bci_width'
    ) -> Dict[str, Any]:
        """Run pixel sampling for a single campaign area."""

        workflow.logger.info(f"Starting pixel sampling for campaign_area {campaign_area_id}")

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        selected_ids = []

        try:
            self.status = "creating_coverage_pixels"
            await workflow.execute_activity(
                create_coverage_pixels_for_campaign_area,
                args=[campaign_id, indicator_id, campaign_area_id, min_population],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            self.status = "adaptive_sampling"
            sampling_result = await workflow.execute_activity(
                sample_pixels_for_campaign_area,
                args=[campaign_id, indicator_id, campaign_area_id, pixels_per_stage2, uncertainty_field],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            selected_ids = sampling_result.get('selected_ids', [])
            self.pixels_selected = len(selected_ids)

            if not selected_ids:
                workflow.logger.warning(f"No pixels selected for campaign_area {campaign_area_id}")
                self.status = "completed_empty"
                return {
                    'campaign_area_id': campaign_area_id,
                    'selected_ids': [],
                    'pixels_selected': 0,
                    'status': 'completed_empty'
                }

            self.status = "assigning_to_round"
            await workflow.execute_activity(
                assign_pixels_to_round,
                args=[campaign_area_id, selected_ids, round_number],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            self.status = "updating_sampled_count"
            await workflow.execute_activity(
                update_campaign_area_sampled_counts,
                args=[[campaign_area_id], campaign_id, indicator_id],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            self.status = "creating_replacements"
            replacement_result = await workflow.execute_activity(
                create_replacement_pixels,
                args=[campaign_id, indicator_id, selected_ids, round_number, 5],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )
            workflow.logger.info(
                f"Created {replacement_result.get('replacement_count', 0)} replacement pixels for campaign_area {campaign_area_id}"
            )

            self.status = "completed"
            workflow.logger.info(f"Completed sampling for campaign_area {campaign_area_id}: {self.pixels_selected} pixels")

            return {
                'campaign_area_id': campaign_area_id,
                'selected_ids': selected_ids,
                'pixels_selected': self.pixels_selected,
                'status': 'completed'
            }

        except Exception as e:
            workflow.logger.error(f"Area pixel sampling failed for {campaign_area_id}: {e}")
            self.status = "failed"

            if selected_ids:
                try:
                    await workflow.execute_activity(
                        remove_round_assignments,
                        args=[selected_ids, round_number, 'pixels'],
                        start_to_close_timeout=timedelta(minutes=2),
                        retry_policy=retry_policy
                    )
                    await workflow.execute_activity(
                        update_campaign_area_sampled_counts,
                        args=[[campaign_area_id], campaign_id, indicator_id],
                        start_to_close_timeout=timedelta(seconds=30),
                        retry_policy=retry_policy
                    )
                    workflow.logger.info(f"Compensation complete for campaign_area {campaign_area_id}")
                except Exception as comp_error:
                    workflow.logger.error(f"Compensation failed for campaign_area {campaign_area_id}: {comp_error}")

            raise


@workflow.defn
class StratifiedClusterSamplingWorkflow:
    """
    Workflow for stratified cluster sampling, generic across the rural
    (district -> upazila -> union) and city-corporation (city corp -> zone ->
    ward) branches - the starting boundary determines which children exist.

    Phase 1 (this workflow):
    1. Create round record
    2. Select stage-1 boundaries (upazilas or zones) from categorized areas
    3. For each stage-1 boundary, select stage-2 boundaries (unions or wards)
    4. Create campaign_areas for selected stage-2 boundaries
    5. Spawn child workflows for pixel sampling

    Phase 2 (child workflows - AreaPixelSamplingWorkflow):
    - Each stage-2 boundary gets its own workflow for pixel sampling
    - Runs in parallel, continues independently
    """

    def __init__(self):
        self.selected_stage1 = []
        self.selected_stage2 = []
        self.status = "initializing"
        self.child_workflows_started = 0

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'selected_stage1': len(self.selected_stage1),
            'selected_stage2': len(self.selected_stage2),
            'child_workflows_started': self.child_workflows_started
        }

    @workflow.run
    async def run(
        self,
        campaign_id: str,
        name: str,
        description: str,
        start_date: Optional[str],
        end_date: Optional[str],
        indicator_id: str,
        starting_boundary_id: str,
        categories: Dict[str, List[str]],
        stage1_count: int,
        stage2_count: int,
        pixels_per_stage2: int,
        population_weighted: bool,
        category_weights: Optional[Dict[str, float]],
        min_population: Optional[int],
        uncertainty_field: str = 'prevalence_bci_width'
    ) -> Dict[str, Any]:
        """Run stratified cluster sampling workflow."""

        workflow.logger.info(f"Starting stratified cluster sampling for campaign {campaign_id}")
        self.status = "creating_round"

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        round_data = await workflow.execute_activity(
            create_round_record,
            args=[campaign_id, name, description, start_date, end_date,
                  indicator_id, 'pixels', 'stratified_cluster'],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry_policy
        )

        round_id = round_data['round_id']
        round_number = round_data['round_number']

        try:
            self.status = "selecting_stage1"
            all_stage1 = []
            for category_ids in categories.values():
                all_stage1.extend(category_ids)

            self.selected_stage1 = await workflow.execute_activity(
                select_clusters,
                args=[all_stage1, categories, stage1_count,
                      population_weighted, category_weights],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            if not self.selected_stage1:
                raise ValueError("No stage-1 areas selected - check category assignments")

            workflow.logger.info(f"Selected {len(self.selected_stage1)} stage-1 areas")

            self.status = "selecting_stage2"
            stage1_children = await workflow.execute_activity(
                get_children_for_boundary_ids,
                args=[self.selected_stage1, categories],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            stage2_categories: Dict[str, List[str]] = {
                'high_risk': [], 'low_risk': [], 'hard_to_reach': []
            }

            for stage1_id, data in stage1_children.items():
                parent_category = data['category']
                child_ids = [c['id'] for c in data['children']]
                if parent_category in stage2_categories:
                    stage2_categories[parent_category].extend(child_ids)
                else:
                    stage2_categories['low_risk'].extend(child_ids)

            for stage1_id, data in stage1_children.items():
                stage2_ids = [c['id'] for c in data['children']]
                if not stage2_ids:
                    continue

                stage1_stage2_categories = {}
                for cat, ids in stage2_categories.items():
                    matching = [i for i in ids if i in stage2_ids]
                    if matching:
                        stage1_stage2_categories[cat] = matching

                selected = await workflow.execute_activity(
                    select_clusters,
                    args=[stage2_ids, stage1_stage2_categories, stage2_count,
                          population_weighted, category_weights],
                    start_to_close_timeout=timedelta(minutes=1),
                    retry_policy=retry_policy
                )
                self.selected_stage2.extend(selected)

            workflow.logger.info(f"Selected {len(self.selected_stage2)} stage-2 areas total")

            if not self.selected_stage2:
                raise ValueError("No stage-2 areas selected")

            self.status = "creating_campaign_areas"
            stage2_category_map = {}
            for cat, ids in stage2_categories.items():
                for boundary_id in ids:
                    if boundary_id in self.selected_stage2:
                        stage2_category_map[boundary_id] = cat

            campaign_area_ids = await workflow.execute_activity(
                create_campaign_areas_for_boundaries,
                args=[campaign_id, self.selected_stage2, stage2_category_map],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            workflow.logger.info(f"Created {len(campaign_area_ids)} campaign areas")

            self.status = "computing_pixels"
            await workflow.execute_activity(
                compute_pixels_for_campaign_areas,
                args=[campaign_area_ids],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            await workflow.execute_activity(
                save_cluster_sampling_config,
                args=[round_id, campaign_id, starting_boundary_id, categories, stage1_count,
                      stage2_count, pixels_per_stage2, population_weighted,
                      category_weights, min_population],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            self.status = "spawning_sampling_workflows"
            child_workflow_ids = []

            for campaign_area_id in campaign_area_ids:
                child_workflow_id = f"area-sampling-{campaign_id}-{round_number}-{campaign_area_id}"

                await workflow.start_child_workflow(
                    AreaPixelSamplingWorkflow.run,
                    args=[
                        campaign_id,
                        indicator_id,
                        campaign_area_id,
                        round_number,
                        pixels_per_stage2,
                        min_population,
                        uncertainty_field
                    ],
                    id=child_workflow_id,
                    task_queue="truecover-tasks",
                    parent_close_policy=ParentClosePolicy.ABANDON,
                    execution_timeout=timedelta(minutes=30),
                    task_timeout=timedelta(minutes=2),
                )

                child_workflow_ids.append(child_workflow_id)
                self.child_workflows_started += 1

            workflow.logger.info(f"Started {len(child_workflow_ids)} child workflows for pixel sampling")

            self.status = "completed"

            return {
                'round_id': round_id,
                'round_number': round_number,
                'selected_stage1': self.selected_stage1,
                'selected_stage2': self.selected_stage2,
                'campaign_area_ids': campaign_area_ids,
                'child_workflow_ids': child_workflow_ids,
                'area_workflow_map': dict(zip(campaign_area_ids, child_workflow_ids)),
                'status': 'completed'
            }

        except Exception as e:
            workflow.logger.error(f"Workflow failed: {e}")
            self.status = "failed"

            try:
                await workflow.execute_activity(
                    delete_round_record,
                    args=[round_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=retry_policy
                )
                workflow.logger.info(f"Deleted round {round_id} due to failure")
            except Exception as delete_error:
                workflow.logger.error(f"Failed to delete round {round_id}: {delete_error}")

            raise
```

Verified against the live file: `sample_pixels_for_campaign_area` (`truecover-backend/temporal/activities/cluster_sampling.py:515-521`) does accept `uncertainty_field: str = 'prevalence_bci_width'` as its 5th parameter — `AreaPixelSamplingWorkflow.run` above already threads it through (accepts it as a parameter, defaults to the same value, passes it as the 5th positional arg to `sample_pixels_for_campaign_area`), and `StratifiedClusterSamplingWorkflow.run`'s child-workflow spawn call above passes its own `uncertainty_field` parameter through as the 7th arg.

- [ ] **Step 3: Typecheck by import**

Run: `cd truecover-backend && uv run python -c "from temporal.workflows.stratified_cluster_sampling import StratifiedClusterSamplingWorkflow, AreaPixelSamplingWorkflow; print('ok')"`
Expected: `ok`, no import errors

- [ ] **Step 4: Commit**

```bash
git add truecover-backend/temporal/workflows/stratified_cluster_sampling.py
git commit -m "Generalize StratifiedClusterSamplingWorkflow to work with any boundary branch"
```

---

## Task 7: Generalize `routes/rounds.py`'s stratified-cluster route

**Files:**
- Modify: `truecover-backend/routes/rounds.py` (function at lines 294-380, current source)
- Test: `truecover-backend/tests/test_cluster_sampling_generalization.py`

**Interfaces:**
- Consumes: `StratifiedClusterSamplingWorkflow` (Task 6).
- Produces: `POST /api/campaigns/<campaign_id>/rounds/stratified-cluster` request body fields renamed to `starting_boundary_id`, `stage1_count`, `stage2_count`, `pixels_per_stage2` (was `starting_pcode`, `upazila_count`, `unions_per_upazila`, `pixels_per_union`).

- [ ] **Step 1: Write the failing test**

Mirrors the `.__wrapped__` route-testing pattern from `truecover-backend/tests/test_admin_boundary_children.py`.

```python
class TestCreateStratifiedClusterRoundValidation:
    def test_rejects_missing_starting_boundary_id(self, db_conn, monkeypatch):
        from routes import rounds as rounds_module
        from flask import Flask

        monkeypatch.setattr(rounds_module, 'get_db_connection', lambda: db_conn)
        monkeypatch.setattr(rounds_module, 'return_db_connection', lambda conn: None)
        monkeypatch.setattr(rounds_module, 'check_campaign_access', lambda user_id, campaign_id: True)

        app = Flask(__name__)
        with app.test_request_context(json={'name': 'Test Round', 'categories': {'high_risk': ['x']}, 'indicator_id': 'y'}):
            response, status = rounds_module.create_stratified_cluster_round.__wrapped__({'id': 'test-user'}, 'test-campaign')
        assert status == 400
        assert 'starting_boundary_id' in response.get_json()['error'].lower() or 'boundary' in response.get_json()['error'].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py::TestCreateStratifiedClusterRoundValidation -v`
Expected: FAIL — current route checks for `starting_pcode`, not `starting_boundary_id`, so the error message text won't match

- [ ] **Step 3: Modify the route**

In `truecover-backend/routes/rounds.py`, `create_stratified_cluster_round` (lines 294-380), change:

```python
        name = data.get('name')
        starting_pcode = data.get('starting_pcode')
        categories = data.get('categories', {})
        upazila_count = data.get('upazila_count', 3)
        unions_per_upazila = data.get('unions_per_upazila', 2)
        pixels_per_union = data.get('pixels_per_union', 50)
        indicator_id = data.get('indicator_id')
```

to:

```python
        name = data.get('name')
        starting_boundary_id = data.get('starting_boundary_id')
        categories = data.get('categories', {})
        stage1_count = data.get('stage1_count', 3)
        stage2_count = data.get('stage2_count', 2)
        pixels_per_stage2 = data.get('pixels_per_stage2', 50)
        indicator_id = data.get('indicator_id')
```

and:

```python
        if not starting_pcode:
            return jsonify({'error': 'Starting PCODE is required'}), 400
```

to:

```python
        if not starting_boundary_id:
            return jsonify({'error': 'starting_boundary_id is required'}), 400
```

and the `args` list passed to `StratifiedClusterSamplingWorkflow.run`:

```python
                args=[
                    campaign_id,
                    name,
                    description,
                    start_date,
                    end_date,
                    indicator_id,
                    starting_pcode,
                    categories,
                    upazila_count,
                    unions_per_upazila,
                    pixels_per_union,
                    population_weighted,
                    category_weights,
                    min_population,
                    uncertainty_field,
                ],
```

to:

```python
                args=[
                    campaign_id,
                    name,
                    description,
                    start_date,
                    end_date,
                    indicator_id,
                    starting_boundary_id,
                    categories,
                    stage1_count,
                    stage2_count,
                    pixels_per_stage2,
                    population_weighted,
                    category_weights,
                    min_population,
                    uncertainty_field,
                ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_cluster_sampling_generalization.py -v`
Expected: 12 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/routes/rounds.py truecover-backend/tests/test_cluster_sampling_generalization.py
git commit -m "Rename stratified-cluster route body fields to match generalized config"
```

---

## Task 8: Frontend — `useCityCorporations` hook

**Files:**
- Modify: `truecover-app/src/hooks/useAdminBoundaries.ts`

**Interfaces:**
- Consumes: `useAdminBoundaryChildren` (existing, already id-aware per the just-shipped boundaries plan).
- Produces: `useCityCorporations(): { data: AdminBoundaryChild[], isLoading: boolean }` — flat list of the ~8 real city corporations nationally, found by walking every division's children and filtering to `boundary_type`-implied city corporations. Since the children endpoint doesn't currently return `boundary_type` in its response (only `id`/`pcode`/`name`/`level`/`parent_pcode`/`population` — verified against `routes/admin_boundaries.py`'s current response shape), city corporations are distinguishable as: `pcode === null && level === 3` (a level-3 boundary with no pcode can only be a city corporation, since upazilas — the other level-3 type — always have a pcode).

- [ ] **Step 1: Add the hook**

In `truecover-app/src/hooks/useAdminBoundaries.ts`, add after the existing `useUpazilas` hook:

```typescript
/**
 * Hook to fetch all Bangladesh city corporations (flat list, no drilling needed - only ~8 exist).
 * A city corporation is a level-3 boundary with no pcode (upazilas, the other level-3 type, always have one).
 */
export function useCityCorporations() {
  const { data: divisions = [] } = useDivisions();
  const divisionQueries = divisions.map(d => useAdminBoundaryChildren(d.id));

  const isLoading = divisionQueries.some(q => q.isLoading);
  const allDistrictLists = divisionQueries.map(q => q.data ?? []);

  const districtQueries = allDistrictLists.flat().map(d => useAdminBoundaryChildren(d.id));
  const districtChildrenLists = districtQueries.map(q => q.data ?? []);

  const cityCorporations = districtChildrenLists
    .flat()
    .filter(child => child.pcode === null && child.level === 3);

  return {
    data: cityCorporations,
    isLoading: isLoading || districtQueries.some(q => q.isLoading),
  };
}
```

Note: calling `useAdminBoundaryChildren` inside a `.map()` violates the Rules of Hooks (hook call count must be stable across renders) if `divisions`/`allDistrictLists` ever change length between renders. Since `divisions` is a fixed list of 8 Bangladesh divisions that never changes at runtime, and district counts per division are similarly static reference data, this is a case where the hook count is stable in practice — but this is a real React footgun, not idiomatic code. Before finalizing this step, check whether `truecover-app`'s ESLint config has `eslint-plugin-react-hooks`'s `rules-of-hooks` enabled (`grep -n "react-hooks" truecover-app/.eslintrc* truecover-app/eslint.config.*`) — if it does and this pattern trips the linter, replace this implementation with a single new backend endpoint instead (e.g. `GET /api/admin-boundaries/city-corporations`, a straightforward `SELECT id, name FROM admin_boundaries WHERE boundary_type = 'city_corporation' ORDER BY name`, avoiding the nested-hooks problem entirely) — this is a legitimate design fork to resolve during implementation, not a deferred decision: pick whichever this codebase's lint config forces, and use that one.

- [ ] **Step 2: Typecheck**

Run: `cd truecover-app && npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add truecover-app/src/hooks/useAdminBoundaries.ts
git commit -m "Add useCityCorporations hook for the stratified round wizard's city corporation branch"
```

---

## Task 9: Frontend — Step 0 branch choice in `StratifiedClusterSamplingWizard.tsx`

**Files:**
- Modify: `truecover-app/src/components/StratifiedClusterSamplingWizard.tsx` (entire file — Step 0's JSX, related state, and the submit payload change together)

**Interfaces:**
- Consumes: `useCityCorporations` (Task 8), `useDivisions`/`useDistricts`/`useAdminBoundaryChildren` (existing).
- Produces: Step 0 offers "Rural (District)" vs "City Corporation"; whichever is chosen sets `selectedStartingBoundary: {id: string, name: string}` used as `starting_boundary_id` in the submit payload.

- [ ] **Step 1: Add branch state and the Step 0 choice UI**

Add a new state near the existing Step 0 state (`selectedDivision`/`selectedDistrict`/`selectedDistrictName`):

```typescript
  const [branch, setBranch] = useState<'rural' | 'city'>('rural');
  const [selectedCityCorporation, setSelectedCityCorporation] = useState('');
  const [selectedCityCorporationName, setSelectedCityCorporationName] = useState('');
```

Add the city corporations hook alongside the existing division/district/upazila hooks:

```typescript
  const { data: cityCorporations = [], isLoading: cityCorporationsLoading } = useCityCorporations();
```

(add `useCityCorporations` to the existing import line: `import { useDivisions, useDistricts, useAdminBoundaryChildren, useCityCorporations } from '../hooks/useAdminBoundaries';`)

Replace the Step 0 JSX block (currently `{step === 0 && (...)}`, lines 320-375) with:

```tsx
      {step === 0 && (
        <div>
          <div className="mb-6 text-zinc-300">
            Select where to sample from.
          </div>

          <div className="flex gap-2 mb-6">
            <TacticalButton
              variant={branch === 'rural' ? 'primary' : 'secondary'}
              onClick={() => setBranch('rural')}
            >
              Rural (District → Upazila → Union)
            </TacticalButton>
            <TacticalButton
              variant={branch === 'city' ? 'primary' : 'secondary'}
              onClick={() => setBranch('city')}
            >
              City Corporation (Zone → Ward)
            </TacticalButton>
          </div>

          {branch === 'rural' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  Division
                </label>
                {divisionsLoading ? (
                  <div className="text-zinc-500">Loading divisions...</div>
                ) : (
                  <TacticalSelect
                    value={selectedDivision}
                    onChange={setSelectedDivision}
                    options={divisions.filter(d => d.id).map(d => ({ value: d.id, label: d.name }))}
                    placeholder="Select a division..."
                  />
                )}
              </div>

              {selectedDivision && (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    District
                  </label>
                  {districtsLoading ? (
                    <div className="text-zinc-500">Loading districts...</div>
                  ) : (
                    <TacticalSelect
                      value={selectedDistrict}
                      onChange={handleDistrictSelect}
                      options={districts.filter(d => d.id).map(d => ({ value: d.id, label: d.name }))}
                      placeholder="Select a district..."
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                City Corporation
              </label>
              {cityCorporationsLoading ? (
                <div className="text-zinc-500">Loading city corporations...</div>
              ) : (
                <TacticalSelect
                  value={selectedCityCorporation}
                  onChange={(id) => {
                    setSelectedCityCorporation(id);
                    const cc = cityCorporations.find(c => c.id === id);
                    setSelectedCityCorporationName(cc?.name || '');
                  }}
                  options={cityCorporations.map(c => ({ value: c.id, label: c.name }))}
                  placeholder="Select a city corporation..."
                />
              )}
            </div>
          )}

          <div className="flex justify-end mt-6">
            <TacticalButton onClick={onClose} variant="secondary">
              Cancel
            </TacticalButton>
            <TacticalButton
              onClick={handleProceedToStep1}
              disabled={branch === 'rural' ? !selectedDistrict : !selectedCityCorporation}
              className="ml-2"
            >
              Next
            </TacticalButton>
          </div>
        </div>
      )}
```

Note: `handleDistrictSelect` currently does `districts.find(d => d.pcode === pcode)` (line 208) — since districts still have real pcodes (unchanged, this is the existing rural path), leave `handleDistrictSelect` as-is EXCEPT change its parameter/lookup to match `id` instead of `pcode`, consistent with the `TacticalSelect` `options` above now using `d.id` as `value`:

```typescript
  const handleDistrictSelect = (id: string) => {
    setSelectedDistrict(id);
    const district = districts.find(d => d.id === id);
    setSelectedDistrictName(district?.name || '');
  };
```

The starting boundary for the rest of the wizard is now branch-dependent — add a derived value used everywhere `selectedDistrict` was previously used as "the starting point":

```typescript
  const startingBoundaryId = branch === 'rural' ? selectedDistrict : selectedCityCorporation;
  const startingBoundaryName = branch === 'rural' ? selectedDistrictName : selectedCityCorporationName;
```

Replace the Step 1 data-fetching hook (`useAdminBoundaryChildren(selectedDistrict || undefined)`, currently named `upazilas`) to key off `startingBoundaryId` instead: `useAdminBoundaryChildren(startingBoundaryId || undefined)` (variable name `upazilas` stays for now, since Task 10 renames it to a branch-neutral name alongside the label changes — don't rename it here to keep this task's diff focused on Step 0).

- [ ] **Step 2: Update the submit payload**

In `handleSubmit`, change:

```typescript
        {
          name: roundName.trim(),
          starting_pcode: selectedDistrict,
          categories: {
```

to:

```typescript
        {
          name: roundName.trim(),
          starting_boundary_id: startingBoundaryId,
          categories: {
```

- [ ] **Step 3: Update the reset-on-close effect**

In the `useEffect` that resets state when the modal closes (currently resetting `selectedDivision`/`selectedDistrict`/`selectedDistrictName`), add:

```typescript
      setBranch('rural');
      setSelectedCityCorporation('');
      setSelectedCityCorporationName('');
```

- [ ] **Step 4: Typecheck**

Run: `cd truecover-app && npx tsc --noEmit -p .`
Expected: no errors (the `initialPcode`/`initialName` props and the effect that skips to step 1 when they're provided still work — those are used when this wizard is launched from a context that already has a district selected, and remain rural-only per existing behavior, which is fine since only the map-click flow and `AddCampaignAreaModal`'s existing callers pass those props today, both district-only)

- [ ] **Step 5: Commit**

```bash
git add truecover-app/src/components/StratifiedClusterSamplingWizard.tsx
git commit -m "Add rural vs city corporation branch choice to Step 0 of the stratified round wizard"
```

---

## Task 10: Frontend — dynamic labels in Steps 1-3

**Files:**
- Modify: `truecover-app/src/components/StratifiedClusterSamplingWizard.tsx`

**Interfaces:**
- Produces: Step 1's heading, Step 2's three input labels and summary sentence, and Step 3's progress labels all read from a small branch-keyed vocabulary object instead of hardcoded "upazila"/"union" strings.

- [ ] **Step 1: Add the vocabulary lookup**

Near the top of the component body (after the `branch` state declaration from Task 9):

```typescript
  const vocabulary = branch === 'rural'
    ? { stage1: 'Upazilas', stage2: 'Unions', stage1Singular: 'Upazila', stage2Singular: 'Union', pixelUnit: 'Union' }
    : { stage1: 'Zones', stage2: 'Wards', stage1Singular: 'Zone', stage2Singular: 'Ward', pixelUnit: 'Ward' };
```

- [ ] **Step 2: Update Step 1's heading**

Change:

```tsx
          <div className="mb-4 text-zinc-300">
            <span className="text-cyan-400">{selectedDistrictName}</span> - Drag upazilas
            into categories. All must be categorized to proceed.
          </div>
```

to:

```tsx
          <div className="mb-4 text-zinc-300">
            <span className="text-cyan-400">{startingBoundaryName}</span> - Drag {vocabulary.stage1.toLowerCase()}
            into categories. All must be categorized to proceed.
          </div>
```

- [ ] **Step 3: Rename state variables and update Step 2's inputs**

Rename `upazilaCount`/`setUpazilaCount` → `stage1Count`/`setStage1Count`, `unionsPerUpazila`/`setUnionsPerUpazila` → `stage2Count`/`setStage2Count`, `pixelsPerUnion`/`setPixelsPerUnion` → `pixelsPerStage2`/`setPixelsPerStage2` throughout the file (state declarations, the `estimatedPixels` calculation, the submit payload, and the three `TacticalInput`s in Step 2).

Change the three Step 2 inputs from:

```tsx
              <TacticalInput
                label="Upazilas to Select"
                type="number"
                value={upazilaCount}
                onChange={setUpazilaCount}
              />
              <TacticalInput
                label="Unions per Upazila"
                type="number"
                value={unionsPerUpazila}
                onChange={setUnionsPerUpazila}
              />
              <TacticalInput
                label="Pixels per Union"
                type="number"
                value={pixelsPerUnion}
                onChange={setPixelsPerUnion}
              />
```

to:

```tsx
              <TacticalInput
                label={`${vocabulary.stage1} to Select`}
                type="number"
                value={stage1Count}
                onChange={setStage1Count}
              />
              <TacticalInput
                label={`${vocabulary.stage2} per ${vocabulary.stage1Singular}`}
                type="number"
                value={stage2Count}
                onChange={setStage2Count}
              />
              <TacticalInput
                label={`Pixels per ${vocabulary.pixelUnit}`}
                type="number"
                value={pixelsPerStage2}
                onChange={setPixelsPerStage2}
              />
```

And the summary sentence, from:

```tsx
                <strong>Summary:</strong> ~{estimatedPixels.toLocaleString()}{' '}
                pixels across {parseInt(upazilaCount || '0') * parseInt(unionsPerUpazila || '0')}{' '}
                unions in {upazilaCount} upazilas
```

to:

```tsx
                <strong>Summary:</strong> ~{estimatedPixels.toLocaleString()}{' '}
                pixels across {parseInt(stage1Count || '0') * parseInt(stage2Count || '0')}{' '}
                {vocabulary.stage2.toLowerCase()} in {stage1Count} {vocabulary.stage1.toLowerCase()}
```

- [ ] **Step 4: Update Step 3's progress labels**

Change:

```tsx
                <div className="flex justify-between text-zinc-300">
                  <span>Upazilas Selected:</span>
                  <span className="text-cyan-400">{workflowProgress.selected_upazilas}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Unions Selected:</span>
                  <span className="text-cyan-400">{workflowProgress.selected_unions}</span>
                </div>
```

to:

```tsx
                <div className="flex justify-between text-zinc-300">
                  <span>{vocabulary.stage1} Selected:</span>
                  <span className="text-cyan-400">{workflowProgress.selected_stage1}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>{vocabulary.stage2} Selected:</span>
                  <span className="text-cyan-400">{workflowProgress.selected_stage2}</span>
                </div>
```

and update the `WorkflowProgress` interface at the top of the file:

```typescript
interface WorkflowProgress {
  status: string;
  selected_stage1: number;
  selected_stage2: number;
  child_workflows_started: number;
}
```

(matching the generalized workflow's `get_progress` query shape from Task 6) and the result-summary block:

```tsx
                <div className="flex justify-between text-zinc-300">
                  <span>Selected Upazilas:</span>
                  <span className="text-green-400">{workflowResult.selected_upazilas?.length || 0}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Selected Unions:</span>
                  <span className="text-green-400">{workflowResult.selected_unions?.length || 0}</span>
                </div>
```

to:

```tsx
                <div className="flex justify-between text-zinc-300">
                  <span>Selected {vocabulary.stage1}:</span>
                  <span className="text-green-400">{workflowResult.selected_stage1?.length || 0}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Selected {vocabulary.stage2}:</span>
                  <span className="text-green-400">{workflowResult.selected_stage2?.length || 0}</span>
                </div>
```

- [ ] **Step 5: Typecheck**

Run: `cd truecover-app && npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add truecover-app/src/components/StratifiedClusterSamplingWizard.tsx
git commit -m "Drive stratified round wizard labels from rural/city-corporation vocabulary"
```

---

## Task 11: End-to-end manual verification and deployment

**Files:** none (verification-only task)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/ -v`
Expected: all tests pass except the pre-existing unrelated `test_batch_round_updates.py` failures (empty `campaigns` table in a fresh local DB, documented as out-of-scope in the prior plan's execution)

- [ ] **Step 2: Manually start a rural stratified round and confirm unchanged behavior**

With the backend/frontend running locally (or against a staging environment), open the Stratified Round wizard, choose "Rural (District)", pick a division/district, categorize upazilas, set stage1/stage2/pixel counts, submit. Confirm the round completes and pixels are assigned, exactly as before this plan.

- [ ] **Step 3: Manually start a city-corporation stratified round**

Choose "City Corporation", pick one from the flat list (e.g. Narayanganj City Corporation), categorize its zones, set counts, submit. Confirm campaign areas are created for selected wards and pixels get sampled.

- [ ] **Step 4: Redeploy — both the Flask API AND the Temporal worker**

This plan's changes touch `temporal/activities/cluster_sampling.py` and `temporal/workflows/stratified_cluster_sampling.py`, which only take effect once the `temporal-worker` Railway service is redeployed (it does not hot-reload and does not share a deploy with `truecover-backend`). After merging to `master`:

```bash
# Trigger fresh deploys for both, using the GraphQL API (see prior plan's execution notes for
# the railway-api.sh script location and serviceInstanceDeploy mutation with latestCommit: true)
```

Redeploy `truecover-backend`, `truecover-app`, AND `temporal-worker` — verify each new deployment's `meta.commitHash` matches the merge commit before considering this live. Do not skip `temporal-worker` — that was the exact gap that caused the previous plan's replacement-pixel fix to silently not take effect for months.

- [ ] **Step 5: Apply the production migration**

Apply `db/migrations/rename_cluster_sampling_config_columns.sql` against the production database manually (no auto-migration-runner exists in this codebase) before or immediately after deploying — the renamed columns must exist before any stratified round (rural or city) can be created against production.

---

## Self-Review Notes

**Spec coverage:** every bullet in the design spec's "Stratified Cluster Sampling generalization" section maps to a task: population weighting (Task 3), `get_children_for_pcodes` generalization (Task 2), `create_campaign_areas_for_unions` generalization (Task 4), dropping the union-specific pair (Task 5), `cluster_sampling_config` renames (Task 1), workflow rename/generalization (Task 6), route renames (Task 7), wizard Step 0 branch + dynamic labels (Tasks 8-10).

**Deviation from the spec's suggested workflow structure:** the spec's own text says `UnionPixelSamplingWorkflow` used `call_adaptive_sampling` with an `admin_pcode` filter — reading the actual current code (`temporal/workflows/stratified_cluster_sampling.py`), this is correct, but Task 6 replaces that call entirely with the already-generic `sample_pixels_for_campaign_area`/`create_coverage_pixels_for_campaign_area` (the same activities `CampaignAreaSamplingWorkflow` already uses for regular campaign-area sampling) rather than trying to generalize `call_adaptive_sampling`'s `admin_pcode` parameter itself. This is a cleaner generalization — it reuses working, already-tested, campaign_area_id-scoped code instead of extending a third parallel pcode-filtering mechanism — and was verified against the live file before locking in this plan.

**Placeholder scan:** no TBD/TODO. Task 8's hook has one explicitly-flagged design fork (nested-hooks pattern vs. a new backend endpoint) that must be resolved by checking the actual ESLint config during implementation — this is not a deferred requirement, it's a concrete decision procedure with both outcomes fully specified.

**Type consistency:** `WorkflowProgress`'s `selected_stage1`/`selected_stage2` (Task 10) matches `AreaPixelSamplingWorkflow`'s workflow-level `get_progress` return shape from Task 6 exactly. `starting_boundary_id` is used consistently from the wizard's submit payload (Task 9) through the route (Task 7) to the workflow (Task 6) to `save_cluster_sampling_config` (Task 5) to the schema (Task 1).
