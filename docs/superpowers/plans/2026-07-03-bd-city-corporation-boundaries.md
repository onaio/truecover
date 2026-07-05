# Bangladesh City Corporation & Sub-District Admin Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let campaigns be generated against Bangladesh city corporations (and their zones/wards) and rural wards/blocks, by extending `admin_boundaries` with a self-referential tree and ingesting the new shapefiles in `data/new/`, without touching any existing level-0..4 data or code paths.

**Architecture:** Additive-only schema change (`parent_id`, `boundary_type`, `source_code` columns on `admin_boundaries`) lets new rows (ward, block, city_corporation, zone) hang off the *existing* district/upazila/union rows as children, resolved by name at import time. A new `geopandas`-based importer reads the shapefiles and inserts only the new rows. Backend routes get an `id`/`parent_id`-based lookup path added *alongside* the existing pcode-based one (never replacing it). A new frontend drill-down picker (division → district → then whatever children actually exist — upazila/union or city corporation/zone) lets a user pick any boundary at any depth as a campaign area's starting point.

**Tech Stack:** Flask + psycopg2, PostgreSQL/PostGIS, geopandas (already a dependency), pytest with real-DB rollback fixtures, React + TypeScript, React Query.

## Global Constraints

- Every migration in `truecover-backend/db/migrations/` is a loose `.sql` file with no auto-runner — it must be applied manually via `psql $DATABASE_URL < db/migrations/<file>.sql` (confirmed: `app.py` only auto-runs the older `db/migrations.py` Python-based migration; the `.sql` files are manual, per `verify_temporal_setup.py:151`).
- Never touch the existing 5 `adm0_pcode`..`adm4_pcode` columns, the `level` column's existing 0-4 semantics, or any existing row. All new columns are nullable; all new rows are net-new inserts.
- Real district/upazila/union names already in `admin_boundaries` are correct and must not be duplicated — new rows attach as children of the existing matching row, found by name (with a small alias table for known renamed districts — verified 3 mismatches: `Chattogram`/`Chittagong`, `Bogura`/`Bogra`, `Moulvibazar`/`Maulvibazar`).
- Tests use real Postgres via `db.connection.get_db_connection()`/`return_db_connection()` with a rollback fixture (per `tests/test_batch_round_updates.py`), except where the code under test opens its *own* connection and commits (per `tests/test_replacement_pixels.py`'s `committed_*` fixture pattern) — in that case use a real committed fixture with explicit cleanup, never a mock.
- `geopandas.read_file()` reads `.shp` directly — verified both `Districts/*.shp` and `City corporations/*.shp` are already in EPSG:4326 (matching `admin_boundaries.geometry`'s SRID), no reprojection needed.
- No comments referencing "new", "old", or this task's history — comments describe what the code does now.
- Every new/modified Python and TypeScript file needs the two-line `ABOUTME:` header per repo convention.

---

## File Structure

| File | Responsibility |
|---|---|
| `truecover-backend/db/migrations/add_boundary_hierarchy.sql` | Additive schema migration (new) |
| `truecover-backend/db/boundary_name_matching.py` | Name resolution against existing `admin_boundaries` rows, with the alias table (new) |
| `truecover-backend/tests/test_boundary_name_matching.py` | Tests for the above (new) |
| `truecover-backend/db/import_boundary_shapefiles.py` | Reads the shapefiles, inserts new ward/block/city_corporation/zone rows (new) |
| `truecover-backend/tests/test_import_boundary_shapefiles.py` | Tests for the above (new) |
| `truecover-backend/routes/admin_boundaries.py` | `get_admin_boundary_children` gets a `parent_id`-first branch (modified) |
| `truecover-backend/routes/campaigns.py` | `add_campaign_area` accepts an `admin_boundary_id` directly; `list_campaign_areas` gets a recursive-CTE name lookup (modified) |
| `truecover-backend/tests/test_admin_boundary_children.py` | Tests for the `get_admin_boundary_children` change (new) |
| `truecover-backend/tests/test_campaign_area_boundary_id.py` | Tests for the `add_campaign_area`/`list_campaign_areas` changes (new) |
| `truecover-backend/scripts/populate_boundary_pixels_for_new_levels.py` | Spatial-join population of `admin_boundary_pixels` for new leaf rows + bottom-up rollup for ancestors (new) |
| `truecover-backend/tests/test_populate_boundary_pixels_for_new_levels.py` | Tests for the above (new) |
| `truecover-app/src/services/api.ts` | `adminBoundariesApi.getChildren` response type gets `id`; `campaignAreasApi.add` accepts `admin_boundary_id` (modified) |
| `truecover-app/src/hooks/useAdminBoundaries.ts` | `AdminBoundaryChild` type gets `id` (modified) |
| `truecover-app/src/components/AdminBoundaryDrillPicker.tsx` | New reusable drill-down picker (division → district → whatever children exist) (new) |
| `truecover-app/src/components/AddCampaignAreaModal.tsx` | Accepts an `id`-only `adminBoundary` (no `pcode`) (modified) |
| `truecover-app/src/pages/LocationsPage.tsx` | New "Add area by drilling down" entry point launching the picker (modified) |

**Not in this plan (follow-up):**
- Stratified Cluster Sampling generalization for city corporations (separate plan — depends on this one's `parent_id`/`boundary_type` columns and generalized children endpoint).
- Regenerating the static PMTiles files (`bgd_adm0`..`bgd_adm4`) that back the map-click "Add to Campaign Area" flow in `MapView.tsx` — that's a separate infrastructure pipeline (`convert_to_pmtiles.sh` + S3 + Martin config), not the `admin_boundaries` Postgres table this plan extends.

---

## Task 1: Additive schema migration

**Files:**
- Create: `truecover-backend/db/migrations/add_boundary_hierarchy.sql`
- Test: `truecover-backend/tests/test_boundary_hierarchy_schema.py`

**Interfaces:**
- Produces: `admin_boundaries.parent_id` (UUID, nullable, FK to `admin_boundaries.id`), `admin_boundaries.boundary_type` (TEXT, nullable), `admin_boundaries.source_code` (TEXT, nullable), index `idx_admin_boundaries_parent_id`.

- [ ] **Step 1: Write the failing test**

```python
# ABOUTME: Tests for the additive parent_id/boundary_type/source_code schema on admin_boundaries
# ABOUTME: Verifies the columns exist and existing rows are unaffected

import pytest
from db.connection import get_db_connection, return_db_connection


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestBoundaryHierarchySchema:
    def test_new_columns_exist(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'admin_boundaries'
              AND column_name IN ('parent_id', 'boundary_type', 'source_code')
        """)
        found = {row[0] for row in cursor.fetchall()}
        assert found == {'parent_id', 'boundary_type', 'source_code'}

    def test_existing_rows_have_null_parent_id(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM admin_boundaries WHERE level <= 4 AND parent_id IS NOT NULL")
        assert cursor.fetchone()[0] == 0

    def test_parent_id_references_admin_boundaries(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 LIMIT 1")
        district_id = cursor.fetchone()[0]
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test City Corporation', 'BD', 3, %s, 'city_corporation')
            RETURNING id
        """, (district_id,))
        row_id = cursor.fetchone()[0]
        cursor.execute("SELECT parent_id, boundary_type FROM admin_boundaries WHERE id = %s", (row_id,))
        result = cursor.fetchone()
        assert str(result[0]) == str(district_id)
        assert result[1] == 'city_corporation'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_boundary_hierarchy_schema.py -v`
Expected: FAIL — `found == set()` (columns don't exist yet)

- [ ] **Step 3: Write the migration**

```sql
-- ABOUTME: Additive schema for a self-referential admin boundary tree
-- ABOUTME: Lets ward/block/city_corporation/zone rows attach under existing district/upazila/union rows

ALTER TABLE admin_boundaries
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES admin_boundaries(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS boundary_type TEXT,
  ADD COLUMN IF NOT EXISTS source_code TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_boundaries_parent_id ON admin_boundaries(parent_id);

UPDATE admin_boundaries SET boundary_type = CASE level
    WHEN 0 THEN 'country'
    WHEN 1 THEN 'division'
    WHEN 2 THEN 'district'
    WHEN 3 THEN 'upazila'
    WHEN 4 THEN 'union'
END
WHERE boundary_type IS NULL AND level BETWEEN 0 AND 4;
```

Apply it:

Run: `psql postgresql://truecover:truecover@localhost:5435/truecover < db/migrations/add_boundary_hierarchy.sql`
Expected: `ALTER TABLE`, `CREATE INDEX`, `UPDATE 5777` (or similar row count)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_boundary_hierarchy_schema.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/db/migrations/add_boundary_hierarchy.sql truecover-backend/tests/test_boundary_hierarchy_schema.py
git commit -m "Add parent_id/boundary_type/source_code columns to admin_boundaries"
```

---

## Task 2: Boundary name matching helper

**Files:**
- Create: `truecover-backend/db/boundary_name_matching.py`
- Test: `truecover-backend/tests/test_boundary_name_matching.py`

**Interfaces:**
- Consumes: `admin_boundaries` table (Task 1's schema).
- Produces:
  - `DISTRICT_NAME_ALIASES: Dict[str, str]` — maps a shapefile `DISTNAME` to the name actually stored in `admin_boundaries` when they differ.
  - `find_district_id(cursor, distname: str) -> Optional[str]`
  - `find_upazila_id(cursor, district_id: str, thaname: str) -> Optional[str]`
  - `find_union_id(cursor, upazila_id: str, uniname: str) -> Optional[str]`

- [ ] **Step 1: Write the failing test**

```python
# ABOUTME: Tests for resolving shapefile district/upazila/union names against existing admin_boundaries rows
# ABOUTME: Covers exact match, known renamed-district aliases, and no-match

import pytest
from db.connection import get_db_connection, return_db_connection
from db.boundary_name_matching import find_district_id, find_upazila_id, find_union_id


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestFindDistrictId:
    def test_exact_match(self, db_conn):
        cursor = db_conn.cursor()
        result = find_district_id(cursor, 'Dhaka')
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = 'Dhaka'")
        assert result == str(cursor.fetchone()[0])

    def test_known_alias_chattogram_to_chittagong(self, db_conn):
        cursor = db_conn.cursor()
        result = find_district_id(cursor, 'Chattogram')
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = 'Chittagong'")
        assert result == str(cursor.fetchone()[0])

    def test_known_alias_bogura_to_bogra(self, db_conn):
        cursor = db_conn.cursor()
        result = find_district_id(cursor, 'Bogura')
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = 'Bogra'")
        assert result == str(cursor.fetchone()[0])

    def test_known_alias_moulvibazar_to_maulvibazar(self, db_conn):
        cursor = db_conn.cursor()
        result = find_district_id(cursor, 'Moulvibazar')
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = 'Maulvibazar'")
        assert result == str(cursor.fetchone()[0])

    def test_no_match_returns_none(self, db_conn):
        cursor = db_conn.cursor()
        assert find_district_id(cursor, 'Nonexistent District Name') is None


class TestFindUpazilaId:
    def test_exact_match_under_correct_district(self, db_conn):
        cursor = db_conn.cursor()
        district_id = find_district_id(cursor, 'Dhaka')
        result = find_upazila_id(cursor, district_id, 'Keraniganj')
        cursor.execute(
            "SELECT id FROM admin_boundaries WHERE level = 3 AND name = 'Keraniganj' AND adm2_pcode = "
            "(SELECT adm2_pcode FROM admin_boundaries WHERE id = %s)",
            (district_id,)
        )
        assert result == str(cursor.fetchone()[0])

    def test_no_match_returns_none(self, db_conn):
        cursor = db_conn.cursor()
        district_id = find_district_id(cursor, 'Dhaka')
        assert find_upazila_id(cursor, district_id, 'Nonexistent Upazila') is None


class TestFindUnionId:
    def test_exact_match_under_correct_upazila(self, db_conn):
        cursor = db_conn.cursor()
        district_id = find_district_id(cursor, 'Dhaka')
        upazila_id = find_upazila_id(cursor, district_id, 'Keraniganj')
        result = find_union_id(cursor, upazila_id, 'Kalatia')
        cursor.execute(
            "SELECT id FROM admin_boundaries WHERE level = 4 AND name = 'Kalatia' AND adm3_pcode = "
            "(SELECT adm3_pcode FROM admin_boundaries WHERE id = %s)",
            (upazila_id,)
        )
        assert result == str(cursor.fetchone()[0])

    def test_no_match_returns_none(self, db_conn):
        cursor = db_conn.cursor()
        district_id = find_district_id(cursor, 'Dhaka')
        upazila_id = find_upazila_id(cursor, district_id, 'Keraniganj')
        assert find_union_id(cursor, upazila_id, 'Nonexistent Union') is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_boundary_name_matching.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'db.boundary_name_matching'`

- [ ] **Step 3: Write the implementation**

```python
# ABOUTME: Resolves shapefile district/upazila/union names against existing admin_boundaries rows
# ABOUTME: Handles the small set of districts renamed since the BBS pcode data was generated

from typing import Optional

DISTRICT_NAME_ALIASES = {
    'Chattogram': 'Chittagong',
    'Bogura': 'Bogra',
    'Moulvibazar': 'Maulvibazar',
}


def find_district_id(cursor, distname: str) -> Optional[str]:
    cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = %s", (distname,))
    row = cursor.fetchone()
    if row:
        return str(row[0])

    alias = DISTRICT_NAME_ALIASES.get(distname)
    if alias:
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = %s", (alias,))
        row = cursor.fetchone()
        if row:
            return str(row[0])

    return None


def find_upazila_id(cursor, district_id: str, thaname: str) -> Optional[str]:
    cursor.execute("""
        SELECT id FROM admin_boundaries
        WHERE level = 3 AND name = %s
          AND adm2_pcode = (SELECT adm2_pcode FROM admin_boundaries WHERE id = %s)
    """, (thaname, district_id))
    row = cursor.fetchone()
    return str(row[0]) if row else None


def find_union_id(cursor, upazila_id: str, uniname: str) -> Optional[str]:
    cursor.execute("""
        SELECT id FROM admin_boundaries
        WHERE level = 4 AND name = %s
          AND adm3_pcode = (SELECT adm3_pcode FROM admin_boundaries WHERE id = %s)
    """, (uniname, upazila_id))
    row = cursor.fetchone()
    return str(row[0]) if row else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_boundary_name_matching.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/db/boundary_name_matching.py truecover-backend/tests/test_boundary_name_matching.py
git commit -m "Add name resolution helper for attaching new boundary rows to existing ones"
```

---

## Task 3: Rural importer (Ward + Block under existing Union rows)

**Files:**
- Create: `truecover-backend/db/import_boundary_shapefiles.py`
- Test: `truecover-backend/tests/test_import_boundary_shapefiles.py`

**Interfaces:**
- Consumes: `find_district_id`, `find_upazila_id`, `find_union_id` from Task 2.
- Produces: `import_rural_district(shp_path: str, conn) -> Dict[str, Any]` returning `{'wards_created': N, 'blocks_created': N, 'unmatched_unions': List[str], 'low_overlap_wards': List[str]}`. `low_overlap_wards` lists ward names whose dissolved geometry overlaps its matched union's real geometry by less than 50% — inserted anyway (name match is still the best evidence available), but logged for manual review per the spec's spatial sanity-check requirement.

- [ ] **Step 1: Write the failing test**

The shapefiles use free-text names like `THANAME`/`UNINAME`/`WARDNAME` grouped under `uni_uid`. Rather than depend on the real 1526-row Dhaka shapefile (whose exact coordinates a test shouldn't hardcode against), the test inserts its own small, self-contained district → upazila → union fixture with known geometry, and builds a small synthetic GeoDataFrame with the same columns geopandas would produce, monkeypatching `geopandas.read_file` to return it. This tests the grouping/matching/insert/overlap logic, not geopandas' shapefile parsing itself (already verified working manually in this task's investigation).

```python
# ABOUTME: Tests for importing rural district shapefiles (ward + block under existing union rows)
# ABOUTME: Uses a small synthetic GeoDataFrame and a self-contained boundary fixture, not real production data

import pytest
import uuid
import geopandas as gpd
from shapely.geometry import Polygon
from db.connection import get_db_connection, return_db_connection
from db.import_boundary_shapefiles import import_rural_district


def _block(uniname, wardname, ward_c, block_c, geometry):
    return {
        'DIVNAME': 'Test Division', 'DISTNAME': 'Test District', 'THANAME': 'Test Upazila',
        'UNINAME': uniname, 'WARDNAME': wardname,
        'uni_uid': f'uid-{uniname}', 'ward_c': ward_c, 'block_c': block_c,
        'org_name': f'{wardname} EPI Center',
        'block_geoc': f'test-{uniname}-{ward_c}-{block_c}',
        'geometry': geometry,
    }


def _square(x, y, size=0.01):
    return Polygon([(x, y), (x + size, y), (x + size, y + size), (x, y + size)])


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


@pytest.fixture
def union_fixture(db_conn):
    """A self-contained district -> upazila -> union hierarchy with known geometry."""
    cursor = db_conn.cursor()
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, geometry, adm2_pcode)
        VALUES ('Test District', 'BD', 2, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326), 'BDTEST')
        RETURNING id
    """)
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, geometry, adm2_pcode, adm3_pcode)
        VALUES ('Test Upazila', 'BD', 3, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326), 'BDTEST', 'BDTEST01')
        RETURNING id
    """)
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, geometry, adm2_pcode, adm3_pcode, adm4_pcode)
        VALUES ('Test Union', 'BD', 4, ST_GeomFromText('POLYGON((0 0, 0.05 0, 0.05 0.05, 0 0.05, 0 0))', 4326),
                'BDTEST', 'BDTEST01', 'BDTEST0101')
        RETURNING id
    """)
    return str(cursor.fetchone()[0])


@pytest.fixture
def synthetic_district_gdf():
    rows = [
        _block('Test Union', 'Ward 1', 'W1', 'KHA1', _square(0.001, 0.001)),
        _block('Test Union', 'Ward 1', 'W1', 'KHA2', _square(0.011, 0.001)),  # same ward, second block
        _block('Test Union', 'Ward 2', 'W2', 'GA1', _square(0.021, 0.001)),
        _block('Nonexistent Union Xyz', 'Ward 1', 'W1', 'KA1', _square(0.001, 0.03)),  # unmatched, logged
    ]
    return gpd.GeoDataFrame(rows, crs='EPSG:4326')


class TestImportRuralDistrict:
    def test_creates_wards_and_blocks_under_matched_union(self, db_conn, union_fixture, synthetic_district_gdf, monkeypatch):
        monkeypatch.setattr('db.import_boundary_shapefiles.gpd.read_file', lambda path: synthetic_district_gdf)

        result = import_rural_district('fake/path/Test.shp', db_conn)

        assert result['wards_created'] == 2  # Ward 1 and Ward 2 under Test Union
        assert result['blocks_created'] == 3
        assert result['unmatched_unions'] == ['Nonexistent Union Xyz']
        assert result['low_overlap_wards'] == []  # both wards fall inside the union's real geometry

        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT name, boundary_type FROM admin_boundaries
            WHERE parent_id = %s ORDER BY name
        """, (union_fixture,))
        wards = cursor.fetchall()
        assert [w[0] for w in wards] == ['Ward 1', 'Ward 2']
        assert all(w[1] == 'ward' for w in wards)

        cursor.execute("""
            SELECT COUNT(*) FROM admin_boundaries
            WHERE boundary_type = 'block' AND parent_id IN (
                SELECT id FROM admin_boundaries WHERE parent_id = %s
            )
        """, (union_fixture,))
        assert cursor.fetchone()[0] == 3

    def test_flags_ward_with_low_overlap_against_its_matched_union(self, db_conn, union_fixture, monkeypatch):
        # This ward geometry sits far outside "Test Union"'s real (0,0)-(0.05,0.05) box,
        # even though the union name matches by name - a real-world sign of a bad name match.
        far_away_gdf = gpd.GeoDataFrame([
            _block('Test Union', 'Ward 9', 'W9', 'KHA9', _square(5.0, 5.0)),
        ], crs='EPSG:4326')
        monkeypatch.setattr('db.import_boundary_shapefiles.gpd.read_file', lambda path: far_away_gdf)

        result = import_rural_district('fake/path/Test.shp', db_conn)

        assert result['low_overlap_wards'] == ['Ward 9']
        # Still inserted - name match is the best evidence available, this is advisory only
        assert result['wards_created'] == 1

    def test_idempotent_on_rerun(self, db_conn, union_fixture, synthetic_district_gdf, monkeypatch):
        monkeypatch.setattr('db.import_boundary_shapefiles.gpd.read_file', lambda path: synthetic_district_gdf)

        import_rural_district('fake/path/Test.shp', db_conn)
        result = import_rural_district('fake/path/Test.shp', db_conn)

        assert result['wards_created'] == 0
        assert result['blocks_created'] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_import_boundary_shapefiles.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'db.import_boundary_shapefiles'`

- [ ] **Step 3: Write the implementation**

```python
# ABOUTME: Imports Bangladesh district (block-level) and city corporation (ward-level) shapefiles
# ABOUTME: Attaches new ward/block/city_corporation/zone rows under existing admin_boundaries rows

import geopandas as gpd
from typing import Dict, Any
from db.boundary_name_matching import find_district_id, find_upazila_id, find_union_id


def _upsert_boundary(cursor, name, level, parent_id, boundary_type, geometry_wkt, source_code=None):
    cursor.execute("""
        SELECT id FROM admin_boundaries WHERE parent_id = %s AND name = %s AND boundary_type = %s
    """, (parent_id, name, boundary_type))
    existing = cursor.fetchone()
    if existing:
        return str(existing[0]), False

    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type, source_code, geometry)
        VALUES (%s, 'BD', %s, %s, %s, %s, ST_GeomFromText(%s, 4326))
        RETURNING id
    """, (name, level, parent_id, boundary_type, source_code, geometry_wkt))
    return str(cursor.fetchone()[0]), True


def _overlap_ratio(cursor, candidate_geometry_wkt, existing_boundary_id) -> float:
    """Fraction of candidate_geometry_wkt's area that falls inside the existing boundary's geometry."""
    cursor.execute("""
        SELECT
            CASE WHEN ST_Area(candidate.geom) = 0 THEN 0
                 ELSE ST_Area(ST_Intersection(candidate.geom, ab.geometry)) / ST_Area(candidate.geom)
            END
        FROM admin_boundaries ab, (SELECT ST_GeomFromText(%s, 4326) as geom) candidate
        WHERE ab.id = %s
    """, (candidate_geometry_wkt, existing_boundary_id))
    return float(cursor.fetchone()[0])


def import_rural_district(shp_path: str, conn) -> Dict[str, Any]:
    gdf = gpd.read_file(shp_path)
    cursor = conn.cursor()

    wards_created = 0
    blocks_created = 0
    unmatched_unions = []
    low_overlap_wards = []
    union_id_cache = {}

    for uniname, union_rows in gdf.groupby('UNINAME'):
        if uniname not in union_id_cache:
            distname = union_rows.iloc[0]['DISTNAME']
            thaname = union_rows.iloc[0]['THANAME']
            district_id = find_district_id(cursor, distname)
            upazila_id = find_upazila_id(cursor, district_id, thaname) if district_id else None
            union_id = find_union_id(cursor, upazila_id, uniname) if upazila_id else None
            union_id_cache[uniname] = union_id

        union_id = union_id_cache[uniname]
        if union_id is None:
            unmatched_unions.append(uniname)
            continue

        for wardname, ward_rows in union_rows.groupby('WARDNAME'):
            ward_geometry_wkt = ward_rows.geometry.union_all().wkt

            if _overlap_ratio(cursor, ward_geometry_wkt, union_id) < 0.5:
                low_overlap_wards.append(wardname)

            ward_id, ward_was_created = _upsert_boundary(
                cursor, wardname, 5, union_id, 'ward', ward_geometry_wkt
            )
            if ward_was_created:
                wards_created += 1

            for _, block_row in ward_rows.iterrows():
                _, block_was_created = _upsert_boundary(
                    cursor, block_row['org_name'], 6, ward_id, 'block',
                    block_row.geometry.wkt, source_code=block_row['block_geoc']
                )
                if block_was_created:
                    blocks_created += 1

    conn.commit()
    return {
        'wards_created': wards_created,
        'blocks_created': blocks_created,
        'unmatched_unions': unmatched_unions,
        'low_overlap_wards': low_overlap_wards,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_import_boundary_shapefiles.py -v`
Expected: 3 passed

Note: `GeoDataFrame.union_all()` requires `geopandas>=0.14` and `shapely>=2.0` (already project dependencies per `pyproject.toml`).

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/db/import_boundary_shapefiles.py truecover-backend/tests/test_import_boundary_shapefiles.py
git commit -m "Add rural district shapefile importer (ward + block under existing union rows)"
```

---

## Task 4: Urban importer (City Corporation + Zone + Ward under existing District rows)

**Files:**
- Modify: `truecover-backend/db/import_boundary_shapefiles.py`
- Modify: `truecover-backend/tests/test_import_boundary_shapefiles.py`

**Interfaces:**
- Consumes: `find_district_id` from Task 2, `_upsert_boundary` from Task 3.
- Produces: `import_city_corporation(shp_path: str, conn) -> Dict[str, int]` returning `{'city_corporations_created': N, 'zones_created': N, 'wards_created': N}`.

- [ ] **Step 1: Write the failing test**

```python
def _cc_ward(ccname, zonename, wardname, x_offset):
    return {
        'DIVNAME': 'Dhaka', 'DISTNAME': 'Dhaka', 'CCNAME': ccname,
        'ZONENAME': zonename, 'WARDNAME': wardname,
        'zone_uid': f'zone-{zonename}', 'ward_uid': f'ward-{wardname}',
        'ward_geoc': f'test-{ccname}-{zonename}-{wardname}',
        'geometry': Polygon([
            (90.40 + x_offset, 23.75), (90.41 + x_offset, 23.75),
            (90.41 + x_offset, 23.76), (90.40 + x_offset, 23.76),
        ])
    }


@pytest.fixture
def synthetic_dncc_gdf():
    rows = [
        _cc_ward('Dhaka North City Corporation (DNCC)', 'Zone 06', 'Ward 52', 0.00),
        _cc_ward('Dhaka North City Corporation (DNCC)', 'Zone 06', 'Ward 53', 0.01),
        _cc_ward('Dhaka North City Corporation (DNCC)', 'Zone 08', 'Ward 44', 0.02),
    ]
    return gpd.GeoDataFrame(rows, crs='EPSG:4326')


class TestImportCityCorporation:
    def test_creates_city_corporation_zones_and_wards(self, db_conn, synthetic_dncc_gdf, monkeypatch):
        from db.import_boundary_shapefiles import import_city_corporation
        monkeypatch.setattr('db.import_boundary_shapefiles.gpd.read_file', lambda path: synthetic_dncc_gdf)

        result = import_city_corporation('fake/path/DNCC.shp', db_conn)

        assert result['city_corporations_created'] == 1
        assert result['zones_created'] == 2
        assert result['wards_created'] == 3

        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT id FROM admin_boundaries
            WHERE boundary_type = 'city_corporation' AND name = 'Dhaka North City Corporation (DNCC)'
        """)
        cc_id = cursor.fetchone()[0]

        cursor.execute("SELECT name FROM admin_boundaries WHERE parent_id = %s ORDER BY name", (cc_id,))
        zones = [r[0] for r in cursor.fetchall()]
        assert zones == ['Zone 06', 'Zone 08']

        cursor.execute("""
            SELECT COUNT(*) FROM admin_boundaries
            WHERE boundary_type = 'ward' AND parent_id IN (
                SELECT id FROM admin_boundaries WHERE parent_id = %s
            )
        """, (cc_id,))
        assert cursor.fetchone()[0] == 3

    def test_idempotent_on_rerun(self, db_conn, synthetic_dncc_gdf, monkeypatch):
        from db.import_boundary_shapefiles import import_city_corporation
        monkeypatch.setattr('db.import_boundary_shapefiles.gpd.read_file', lambda path: synthetic_dncc_gdf)

        import_city_corporation('fake/path/DNCC.shp', db_conn)
        result = import_city_corporation('fake/path/DNCC.shp', db_conn)

        assert result == {'city_corporations_created': 0, 'zones_created': 0, 'wards_created': 0}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_import_boundary_shapefiles.py::TestImportCityCorporation -v`
Expected: FAIL with `ImportError: cannot import name 'import_city_corporation'`

- [ ] **Step 3: Write the implementation**

Append to `truecover-backend/db/import_boundary_shapefiles.py`:

```python
def import_city_corporation(shp_path: str, conn) -> Dict[str, int]:
    gdf = gpd.read_file(shp_path)
    cursor = conn.cursor()

    ccname = gdf.iloc[0]['CCNAME']
    distname = gdf.iloc[0]['DISTNAME']
    district_id = find_district_id(cursor, distname)
    if district_id is None:
        conn.commit()
        return {'city_corporations_created': 0, 'zones_created': 0, 'wards_created': 0}

    cc_geometry_wkt = gdf.geometry.union_all().wkt
    cc_id, cc_created = _upsert_boundary(
        cursor, ccname, 3, district_id, 'city_corporation', cc_geometry_wkt
    )

    zones_created = 0
    wards_created = 0

    for zonename, zone_rows in gdf.groupby('ZONENAME'):
        zone_geometry_wkt = zone_rows.geometry.union_all().wkt
        zone_id, zone_was_created = _upsert_boundary(
            cursor, zonename, 4, cc_id, 'zone', zone_geometry_wkt
        )
        if zone_was_created:
            zones_created += 1

        for _, ward_row in zone_rows.iterrows():
            _, ward_was_created = _upsert_boundary(
                cursor, ward_row['WARDNAME'], 5, zone_id, 'ward',
                ward_row.geometry.wkt, source_code=ward_row['ward_geoc']
            )
            if ward_was_created:
                wards_created += 1

    conn.commit()
    return {
        'city_corporations_created': 1 if cc_created else 0,
        'zones_created': zones_created,
        'wards_created': wards_created,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_import_boundary_shapefiles.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/db/import_boundary_shapefiles.py truecover-backend/tests/test_import_boundary_shapefiles.py
git commit -m "Add city corporation shapefile importer (city_corporation + zone + ward under existing district rows)"
```

---

## Task 5: CLI entry point with spatial containment sanity check

**Files:**
- Modify: `truecover-backend/db/import_boundary_shapefiles.py`
- Modify: `truecover-backend/tests/test_import_boundary_shapefiles.py`

**Interfaces:**
- Produces: `run_import(data_dir: str, conn) -> None` (walks `Districts/*/*.shp` and `City corporations/*/*.shp`), plus a `__main__` block.
- Consumes nothing new — wires Tasks 3 and 4 together and adds the spatial sanity check the spec calls for.

- [ ] **Step 1: Write the failing test**

```python
class TestRunImport:
    def test_walks_districts_and_city_corporations_directories(self, db_conn, tmp_path, monkeypatch):
        from db.import_boundary_shapefiles import run_import
        import shutil

        districts_dir = tmp_path / "Districts" / "Dhaka"
        districts_dir.mkdir(parents=True)
        (districts_dir / "Dhaka.shp").touch()

        cc_dir = tmp_path / "City corporations" / "Test CC"
        cc_dir.mkdir(parents=True)
        (cc_dir / "Test CC.shp").touch()

        calls = []
        monkeypatch.setattr(
            'db.import_boundary_shapefiles.import_rural_district',
            lambda path, conn: calls.append(('rural', path)) or {'wards_created': 0, 'blocks_created': 0, 'unmatched_unions': []}
        )
        monkeypatch.setattr(
            'db.import_boundary_shapefiles.import_city_corporation',
            lambda path, conn: calls.append(('urban', path)) or {'city_corporations_created': 0, 'zones_created': 0, 'wards_created': 0}
        )

        run_import(str(tmp_path), db_conn)

        assert ('rural', str(districts_dir / "Dhaka.shp")) in calls
        assert ('urban', str(cc_dir / "Test CC.shp")) in calls
```

This test verifies directory-walking wiring only (the individual import functions are exercised in Tasks 3-4's tests); using `monkeypatch` here on the *plan's own* just-written functions (not framework/DB behavior) is directory traversal testing, not testing mocked business logic.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_import_boundary_shapefiles.py::TestRunImport -v`
Expected: FAIL with `ImportError: cannot import name 'run_import'`

- [ ] **Step 3: Write the implementation**

Append to `truecover-backend/db/import_boundary_shapefiles.py`:

```python
import os
import sys
from pathlib import Path
from db.connection import get_db_connection, return_db_connection


def run_import(data_dir: str, conn) -> None:
    districts_root = Path(data_dir) / "Districts"
    for shp_path in sorted(districts_root.glob("*/*.shp")):
        result = import_rural_district(str(shp_path), conn)
        print(f"{shp_path.stem}: {result['wards_created']} wards, {result['blocks_created']} blocks created")
        if result['unmatched_unions']:
            print(f"  Unmatched unions (skipped, needs manual review): {result['unmatched_unions']}")
        if result['low_overlap_wards']:
            print(f"  Low geometry overlap with matched union (inserted anyway, needs manual review): {result['low_overlap_wards']}")

    cc_root = Path(data_dir) / "City corporations"
    for shp_path in sorted(cc_root.glob("*/*.shp")):
        result = import_city_corporation(str(shp_path), conn)
        print(f"{shp_path.stem}: {result['zones_created']} zones, {result['wards_created']} wards created")


if __name__ == "__main__":
    default_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "data", "new")
    data_dir = sys.argv[1] if len(sys.argv) > 1 else default_dir

    conn = get_db_connection()
    try:
        print(f"Importing boundary shapefiles from: {data_dir}")
        run_import(data_dir, conn)
    finally:
        return_db_connection(conn)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_import_boundary_shapefiles.py -v`
Expected: 5 passed

- [ ] **Step 5: Manually run against the real data and verify counts**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run python db/import_boundary_shapefiles.py "../data/new"`
Expected: prints per-file ward/block/zone counts for all 23 districts and 9 city corporations; note any `Unmatched unions` output for manual follow-up (per the spec, these are logged and skipped, not guessed).

- [ ] **Step 6: Commit**

```bash
git add truecover-backend/db/import_boundary_shapefiles.py truecover-backend/tests/test_import_boundary_shapefiles.py
git commit -m "Add CLI entry point walking Districts/ and City corporations/ directories"
```

---

## Task 6: Generalize `get_admin_boundary_children` with a `parent_id` branch

**Files:**
- Modify: `truecover-backend/routes/admin_boundaries.py` (function at line 88, per current source)
- Test: `truecover-backend/tests/test_admin_boundary_children.py`

**Interfaces:**
- Consumes: `admin_boundaries.parent_id`/`boundary_type` (Task 1).
- Produces: `GET /api/admin-boundaries/<identifier>/children` accepts either a pcode (existing behavior, unchanged) or a UUID `admin_boundaries.id` (new). Response items now always include an `id` field (previously absent) alongside the existing `pcode`/`name`/`level`/`parent_pcode`/`population` fields; for boundaries without a pcode, `pcode` is `null`.

- [ ] **Step 1: Write the failing test**

```python
# ABOUTME: Tests for get_admin_boundary_children's parent_id-based lookup branch
# ABOUTME: Verifies existing pcode-based behavior is untouched and the new id-based path works

import pytest
import uuid
from db.connection import get_db_connection, return_db_connection

# app.py wires up routes as Flask blueprints; import the app factory used elsewhere in the test suite
from app import create_app


@pytest.fixture
def client():
    app = create_app()
    app.config['TESTING'] = True
    return app.test_client()


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


@pytest.fixture
def auth_headers(monkeypatch):
    # require_auth decorator; the existing test suite's convention for bypassing Clerk in tests
    # is confirmed by checking auth/middleware.py's require_auth signature before writing this fixture
    pytest.skip("Wire to the project's existing auth-bypass test fixture (see auth/middleware.py) before implementing this task")
```

Before writing this test for real, read `truecover-backend/auth/middleware.py` to find the existing convention for calling `@require_auth`-protected routes in tests (e.g. a test JWT, a monkeypatched decorator, or a `TESTING` bypass) — none of the existing test files in `truecover-backend/tests/` exercise a Flask route directly (they all test DB/activity logic), so this is the first route-level test in the suite. Two options depending on what you find:

- **If there's no existing auth-bypass convention:** test the underlying SQL/logic directly instead of through Flask, mirroring every other test in this codebase (real DB, no HTTP layer):

```python
# ABOUTME: Tests for the parent_id-based children lookup used by get_admin_boundary_children
# ABOUTME: Verifies existing pcode-based rows are unaffected and new parent_id rows resolve correctly

import pytest
import uuid
from db.connection import get_db_connection, return_db_connection


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestChildrenByParentId:
    def test_finds_children_via_parent_id(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 LIMIT 1")
        district_id = cursor.fetchone()[0]

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test City Corp', 'BD', 3, %s, 'city_corporation') RETURNING id
        """, (district_id,))
        cc_id = cursor.fetchone()[0]

        cursor.execute("""
            SELECT id, name, level, boundary_type FROM admin_boundaries WHERE parent_id = %s
        """, (str(district_id),))
        children = cursor.fetchall()
        assert len(children) == 1
        assert children[0][1] == 'Test City Corp'
        assert children[0][3] == 'city_corporation'

    def test_boundary_with_no_parent_id_children_and_no_pcode_children_returns_empty(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Leaf Ward', 'BD', 5, 'ward') RETURNING id
        """)
        leaf_id = cursor.fetchone()[0]
        cursor.execute("SELECT id FROM admin_boundaries WHERE parent_id = %s", (str(leaf_id),))
        assert cursor.fetchone() is None
```

Then wire the route itself to prefer this query (Step 3) and add one Flask-level test once the auth convention is confirmed and documented in a follow-up task — don't block this task on inventing a new auth-test pattern the rest of the suite doesn't use.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_admin_boundary_children.py -v`
Expected: PASS immediately (this test only exercises schema/queries already in place from Task 1) — confirms the DB-level behavior the route will rely on, before touching `routes/admin_boundaries.py`.

- [ ] **Step 3: Modify the route**

In `truecover-backend/routes/admin_boundaries.py`, replace the body of `get_admin_boundary_children` (currently lines 88-169) with:

```python
@admin_boundaries_bp.route('/api/admin-boundaries/<identifier>/children', methods=['GET'])
@require_auth
def get_admin_boundary_children(user, identifier):
    """Get child boundaries for a given PCODE or admin_boundaries.id"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Try parent_id-based children first (works for any boundary_type/depth)
        cursor.execute("""
            SELECT id FROM admin_boundaries
            WHERE id::text = %s
               OR adm0_pcode = %s OR adm1_pcode = %s OR adm2_pcode = %s
               OR adm3_pcode = %s OR adm4_pcode = %s
            LIMIT 1
        """, (identifier, identifier, identifier, identifier, identifier, identifier))
        parent = cursor.fetchone()
        if not parent:
            return jsonify({'error': f'Admin boundary not found for: {identifier}'}), 404

        parent_id = str(parent[0])
        cursor.execute("""
            SELECT id, name, level, boundary_type,
                   adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
            FROM admin_boundaries WHERE parent_id = %s ORDER BY name
        """, (parent_id,))
        parent_id_children = cursor.fetchall()

        if parent_id_children:
            result = [{
                'id': str(row[0]),
                'name': row[1],
                'level': row[2],
                'pcode': next((row[4 + i] for i in range(5) if row[4 + i]), None),
                'parent_pcode': identifier if not identifier.count('-') == 4 else None,
                'population': 0
            } for row in parent_id_children]
            cursor.close()
            return jsonify({'children': result}), 200

        # Fall back to the existing pcode/level+1 lookup for boundaries that predate this feature
        cursor.execute("""
            SELECT level, adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
            FROM admin_boundaries WHERE id = %s
        """, (parent_id,))
        parent_row = cursor.fetchone()
        parent_level = parent_row[0]
        child_level = parent_level + 1

        if child_level > 4:
            return jsonify({'children': [], 'message': 'No child level exists'}), 200

        pcode = next((parent_row[1 + i] for i in range(5) if parent_row[1 + i]), None)
        parent_col = f'adm{parent_level}_pcode'
        child_col = f'adm{child_level}_pcode'

        if child_level >= 3:
            cursor.execute(f"""
                SELECT
                    ab.id, ab.name, ab.level, ab.{child_col} as pcode,
                    ab.{parent_col} as parent_pcode,
                    COALESCE(SUM(p.population), 0) as population
                FROM admin_boundaries ab
                LEFT JOIN pixels p ON p.{child_col} = ab.{child_col}
                WHERE ab.level = %s AND ab.{parent_col} = %s
                GROUP BY ab.id, ab.name, ab.level, ab.{child_col}, ab.{parent_col}
                ORDER BY ab.name
            """, (child_level, pcode))
        else:
            cursor.execute(f"""
                SELECT DISTINCT
                    ab.id, ab.name, ab.level, ab.{child_col} as pcode,
                    ab.{parent_col} as parent_pcode, 0 as population
                FROM admin_boundaries ab
                WHERE ab.level = %s AND ab.{parent_col} = %s
                ORDER BY ab.name
            """, (child_level, pcode))

        children = cursor.fetchall()
        result = [{
            'id': str(row[0]),
            'name': row[1],
            'level': row[2],
            'pcode': row[3],
            'parent_pcode': row[4],
            'population': int(row[5]) if row[5] else 0
        } for row in children]

        cursor.close()
        return jsonify({'children': result}), 200

    except Exception as e:
        print(f"Error fetching admin boundary children: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to fetch admin boundary children'}), 500
    finally:
        if conn:
            return_db_connection(conn)
```

Note the URL parameter is renamed from `<pcode>` to `<identifier>` since it now accepts either — this is a same-file rename, not a URL shape change, so no frontend route paths need updating.

- [ ] **Step 4: Run the DB-level test again to confirm nothing regressed, then manually verify the route**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_admin_boundary_children.py -v`
Expected: 2 passed

Manually verify the route end-to-end (existing pcode path unchanged, new id path works) with the backend running:
```bash
curl -s "http://localhost:5001/api/admin-boundaries/BD30/children" -H "Authorization: Bearer $TOKEN" | head -c 300
curl -s "http://localhost:5001/api/admin-boundaries/<a-city-corporation-id-from-task-5>/children" -H "Authorization: Bearer $TOKEN"
```
Expected: first call returns districts under division BD30 exactly as before (with a new `id` field added to each item); second call returns the city corporation's zones.

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/routes/admin_boundaries.py truecover-backend/tests/test_admin_boundary_children.py
git commit -m "Add parent_id-based children lookup to get_admin_boundary_children"
```

---

## Task 7: `add_campaign_area` accepts an `admin_boundary_id` directly

**Files:**
- Modify: `truecover-backend/routes/campaigns.py` (function at line 353, per current source)
- Test: `truecover-backend/tests/test_campaign_area_boundary_id.py`

**Interfaces:**
- Consumes: nothing new from earlier tasks (works against any `admin_boundaries` row, old or new).
- Produces: `POST /api/campaigns/<campaign_id>/areas` accepts `{area_type: 'admin_boundary', admin_boundary_id: '<uuid>'}` as an alternative to the existing `{area_type: 'admin_boundary', pcode: '<pcode>'}`.

- [ ] **Step 1: Write the failing test**

Since this route is behind `@require_auth`/`check_campaign_access`, and per Task 6 the test suite has no existing Flask-route-level test convention, test the query logic directly:

```python
# ABOUTME: Tests for resolving an admin_boundaries row by id vs by pcode when adding a campaign area
# ABOUTME: Verifies both lookup paths return the same shape of data for downstream insert

import pytest
from db.connection import get_db_connection, return_db_connection


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestResolveAdminBoundaryForCampaignArea:
    def test_lookup_by_id_returns_same_shape_as_lookup_by_pcode(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("SELECT id, adm2_pcode FROM admin_boundaries WHERE level = 2 LIMIT 1")
        district_id, district_pcode = cursor.fetchone()

        cursor.execute("""
            SELECT ab.id, ab.name, ST_AsText(ab.geometry),
                   ST_XMin(ab.geometry), ST_YMin(ab.geometry), ST_XMax(ab.geometry), ST_YMax(ab.geometry)
            FROM admin_boundaries ab WHERE ab.id = %s
        """, (str(district_id),))
        by_id = cursor.fetchone()

        cursor.execute("""
            SELECT ab.id, ab.name, ST_AsText(ab.geometry),
                   ST_XMin(ab.geometry), ST_YMin(ab.geometry), ST_XMax(ab.geometry), ST_YMax(ab.geometry)
            FROM admin_boundaries ab
            WHERE ab.adm0_pcode = %s OR ab.adm1_pcode = %s OR ab.adm2_pcode = %s
               OR ab.adm3_pcode = %s OR ab.adm4_pcode = %s
        """, (district_pcode,) * 5)
        by_pcode = cursor.fetchone()

        assert by_id == by_pcode

    def test_lookup_by_id_works_for_a_boundary_with_no_pcode(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 LIMIT 1")
        district_id = cursor.fetchone()[0]
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type, geometry)
            VALUES ('Test City Corp', 'BD', 3, %s, 'city_corporation',
                    ST_GeomFromText('POLYGON((90 23, 91 23, 91 24, 90 24, 90 23))', 4326))
            RETURNING id
        """, (str(district_id),))
        cc_id = cursor.fetchone()[0]

        cursor.execute("SELECT id, name FROM admin_boundaries WHERE id = %s", (str(cc_id),))
        result = cursor.fetchone()
        assert result[1] == 'Test City Corp'
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_campaign_area_boundary_id.py -v`
Expected: 2 passed (this confirms the query shapes before wiring the route)

- [ ] **Step 3: Modify the route**

In `truecover-backend/routes/campaigns.py`, in `add_campaign_area` (lines 353-494), change:

```python
        area_type = data.get('area_type', 'admin_boundary')
        admin_boundary_pcode = data.get('pcode')  # Use pcode from frontend
        geometry = data.get('geometry')
        name = data.get('name')

        if area_type == 'admin_boundary' and not admin_boundary_pcode:
            return jsonify({'error': 'pcode is required for admin_boundary type'}), 400
```

to:

```python
        area_type = data.get('area_type', 'admin_boundary')
        admin_boundary_pcode = data.get('pcode')
        admin_boundary_id_param = data.get('admin_boundary_id')
        geometry = data.get('geometry')
        name = data.get('name')

        if area_type == 'admin_boundary' and not admin_boundary_pcode and not admin_boundary_id_param:
            return jsonify({'error': 'pcode or admin_boundary_id is required for admin_boundary type'}), 400
```

and change the lookup block:

```python
        if area_type == 'admin_boundary':
            # Get geometry, name, id, and pre-computed stats from admin_boundaries table by pcode
            cursor.execute("""
                SELECT ab.id, ab.name, ST_AsText(ab.geometry),
                       ST_XMin(ab.geometry), ST_YMin(ab.geometry),
                       ST_XMax(ab.geometry), ST_YMax(ab.geometry),
                       COALESCE(abs.pixel_count, 0),
                       COALESCE(abs.population, 0)
                FROM admin_boundaries ab
                LEFT JOIN admin_boundary_stats abs ON abs.admin_boundary_id = ab.id
                WHERE ab.adm0_pcode = %s
                   OR ab.adm1_pcode = %s
                   OR ab.adm2_pcode = %s
                   OR ab.adm3_pcode = %s
                   OR ab.adm4_pcode = %s
                LIMIT 1
            """, (admin_boundary_pcode, admin_boundary_pcode, admin_boundary_pcode,
                  admin_boundary_pcode, admin_boundary_pcode))
            ab_data = cursor.fetchone()
            if not ab_data:
                cursor.close()
                return jsonify({'error': f'Admin boundary not found for pcode: {admin_boundary_pcode}'}), 404
```

to:

```python
        if area_type == 'admin_boundary':
            # Get geometry, name, id, and pre-computed stats from admin_boundaries table by id or pcode
            if admin_boundary_id_param:
                cursor.execute("""
                    SELECT ab.id, ab.name, ST_AsText(ab.geometry),
                           ST_XMin(ab.geometry), ST_YMin(ab.geometry),
                           ST_XMax(ab.geometry), ST_YMax(ab.geometry),
                           COALESCE(abs.pixel_count, 0),
                           COALESCE(abs.population, 0)
                    FROM admin_boundaries ab
                    LEFT JOIN admin_boundary_stats abs ON abs.admin_boundary_id = ab.id
                    WHERE ab.id = %s
                """, (admin_boundary_id_param,))
            else:
                cursor.execute("""
                    SELECT ab.id, ab.name, ST_AsText(ab.geometry),
                           ST_XMin(ab.geometry), ST_YMin(ab.geometry),
                           ST_XMax(ab.geometry), ST_YMax(ab.geometry),
                           COALESCE(abs.pixel_count, 0),
                           COALESCE(abs.population, 0)
                    FROM admin_boundaries ab
                    LEFT JOIN admin_boundary_stats abs ON abs.admin_boundary_id = ab.id
                    WHERE ab.adm0_pcode = %s
                       OR ab.adm1_pcode = %s
                       OR ab.adm2_pcode = %s
                       OR ab.adm3_pcode = %s
                       OR ab.adm4_pcode = %s
                    LIMIT 1
                """, (admin_boundary_pcode, admin_boundary_pcode, admin_boundary_pcode,
                      admin_boundary_pcode, admin_boundary_pcode))
            ab_data = cursor.fetchone()
            if not ab_data:
                cursor.close()
                identifier = admin_boundary_id_param or admin_boundary_pcode
                return jsonify({'error': f'Admin boundary not found for: {identifier}'}), 404
```

The rest of the function (building `admin_boundary_id`, `name`, `geometry_wkt`, `bbox`, the `INSERT INTO campaign_areas`, and the `pixel_area` copy) is unchanged — it already only depends on `ab_data`, not on how the boundary was looked up.

- [ ] **Step 4: Manually verify with the backend running**

```bash
curl -s -X POST "http://localhost:5001/api/campaigns/<campaign_id>/areas" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"area_type": "admin_boundary", "admin_boundary_id": "<a-city-corporation-id>"}'
```
Expected: 201 with the campaign area created, `admin_boundary_id` matching what was passed in.

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/routes/campaigns.py truecover-backend/tests/test_campaign_area_boundary_id.py
git commit -m "Let add_campaign_area accept an admin_boundary_id directly, not just pcode"
```

---

## Task 8: `list_campaign_areas` recursive CTE for ancestor names

**Files:**
- Modify: `truecover-backend/routes/campaigns.py` (function at line 267, per current source)
- Modify: `truecover-backend/tests/test_campaign_area_boundary_id.py`

**Interfaces:**
- Consumes: `admin_boundaries.parent_id` (Task 1).
- Produces: `GET /api/campaigns/<campaign_id>/areas` response items keep their existing `division_name`/`district_name`/`upazila_name`/`union_name` fields for pre-existing boundary types, and additionally populate `city_corporation_name`/`zone_name`/`ward_name`/`block_name` when the campaign area's boundary has a `parent_id` ancestry.

- [ ] **Step 1: Write the failing test**

```python
class TestAncestorNamesForBoundaryWithParentId:
    def test_recursive_ancestor_lookup_returns_full_chain(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 LIMIT 1")
        district_id = cursor.fetchone()[0]

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test CC', 'BD', 3, %s, 'city_corporation') RETURNING id
        """, (str(district_id),))
        cc_id = cursor.fetchone()[0]
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test Zone', 'BD', 4, %s, 'zone') RETURNING id
        """, (str(cc_id),))
        zone_id = cursor.fetchone()[0]
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test Ward', 'BD', 5, %s, 'ward') RETURNING id
        """, (str(zone_id),))
        ward_id = cursor.fetchone()[0]

        cursor.execute("""
            WITH RECURSIVE ancestors AS (
                SELECT id, name, boundary_type, parent_id, 0 as depth FROM admin_boundaries WHERE id = %s
                UNION ALL
                SELECT ab.id, ab.name, ab.boundary_type, ab.parent_id, a.depth + 1
                FROM admin_boundaries ab JOIN ancestors a ON ab.id = a.parent_id
            )
            SELECT boundary_type, name FROM ancestors ORDER BY depth
        """, (str(ward_id),))
        chain = cursor.fetchall()

        assert chain == [('ward', 'Test Ward'), ('zone', 'Test Zone'), ('city_corporation', 'Test CC')]
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_campaign_area_boundary_id.py::TestAncestorNamesForBoundaryWithParentId -v`
Expected: 1 passed (confirms the recursive CTE shape before wiring the route)

- [ ] **Step 3: Modify the route**

In `truecover-backend/routes/campaigns.py`, `list_campaign_areas` (lines 267-348), change the query from:

```python
        cursor.execute("""
            SELECT
                ca.id, ca.campaign_id, ca.name, ca.area_type,
                ca.admin_boundary_id,
                ST_AsGeoJSON(ca.geometry) as geometry,
                ca.bbox_min_lng, ca.bbox_min_lat, ca.bbox_max_lng, ca.bbox_max_lat,
                ca.created_at, ca.updated_at,
                ab.name as admin_boundary_name,
                COALESCE(ca.cached_pixel_count, 0) as pixel_count,
                COALESCE(ca.cached_population, 0) as total_population,
                COALESCE(ca.cached_building_count, 0) as building_count,
                div.name as division_name,
                dist.name as district_name,
                upz.name as upazila_name,
                uni.name as union_name,
                COALESCE(ca.cached_sampled_count, 0) as sampled_count,
                COALESCE(ca.cached_sampled_population, 0) as sampled_population,
                ca.category,
                ca.status
            FROM campaign_areas ca
            LEFT JOIN admin_boundaries ab ON ca.admin_boundary_id = ab.id
            -- Get parent boundary names using the pcode hierarchy
            LEFT JOIN admin_boundaries div ON div.adm1_pcode = ab.adm1_pcode AND div.level = 1
            LEFT JOIN admin_boundaries dist ON dist.adm2_pcode = ab.adm2_pcode AND dist.level = 2
            LEFT JOIN admin_boundaries upz ON upz.adm3_pcode = ab.adm3_pcode AND upz.level = 3
            LEFT JOIN admin_boundaries uni ON uni.adm4_pcode = ab.adm4_pcode AND uni.level = 4
            WHERE ca.campaign_id = %s
            ORDER BY ca.created_at DESC
        """, (campaign_id,))
```

to:

```python
        cursor.execute("""
            WITH RECURSIVE ancestors AS (
                SELECT ab.id as leaf_id, ab.id, ab.name, ab.boundary_type, ab.parent_id, 0 as depth
                FROM admin_boundaries ab
                JOIN campaign_areas ca ON ca.admin_boundary_id = ab.id
                WHERE ca.campaign_id = %s
                UNION ALL
                SELECT a.leaf_id, ab.id, ab.name, ab.boundary_type, ab.parent_id, a.depth + 1
                FROM admin_boundaries ab JOIN ancestors a ON ab.id = a.parent_id
            ),
            ancestor_names AS (
                SELECT leaf_id,
                    MAX(name) FILTER (WHERE boundary_type = 'city_corporation') as city_corporation_name,
                    MAX(name) FILTER (WHERE boundary_type = 'zone') as zone_name,
                    MAX(name) FILTER (WHERE boundary_type = 'ward') as ward_name,
                    MAX(name) FILTER (WHERE boundary_type = 'block') as block_name
                FROM ancestors
                GROUP BY leaf_id
            )
            SELECT
                ca.id, ca.campaign_id, ca.name, ca.area_type,
                ca.admin_boundary_id,
                ST_AsGeoJSON(ca.geometry) as geometry,
                ca.bbox_min_lng, ca.bbox_min_lat, ca.bbox_max_lng, ca.bbox_max_lat,
                ca.created_at, ca.updated_at,
                ab.name as admin_boundary_name,
                COALESCE(ca.cached_pixel_count, 0) as pixel_count,
                COALESCE(ca.cached_population, 0) as total_population,
                COALESCE(ca.cached_building_count, 0) as building_count,
                div.name as division_name,
                dist.name as district_name,
                upz.name as upazila_name,
                uni.name as union_name,
                an.city_corporation_name,
                an.zone_name,
                an.ward_name,
                an.block_name,
                COALESCE(ca.cached_sampled_count, 0) as sampled_count,
                COALESCE(ca.cached_sampled_population, 0) as sampled_population,
                ca.category,
                ca.status
            FROM campaign_areas ca
            LEFT JOIN admin_boundaries ab ON ca.admin_boundary_id = ab.id
            LEFT JOIN admin_boundaries div ON div.adm1_pcode = ab.adm1_pcode AND div.level = 1
            LEFT JOIN admin_boundaries dist ON dist.adm2_pcode = ab.adm2_pcode AND dist.level = 2
            LEFT JOIN admin_boundaries upz ON upz.adm3_pcode = ab.adm3_pcode AND upz.level = 3
            LEFT JOIN admin_boundaries uni ON uni.adm4_pcode = ab.adm4_pcode AND uni.level = 4
            LEFT JOIN ancestor_names an ON an.leaf_id = ab.id
            WHERE ca.campaign_id = %s
            ORDER BY ca.created_at DESC
        """, (campaign_id, campaign_id))
```

and update the row-to-dict mapping (adjusting indices for the 4 new columns inserted before `sampled_count`):

```python
        areas = []
        for row in cursor.fetchall():
            area = {
                'id': str(row[0]),
                'campaign_id': str(row[1]),
                'name': row[2],
                'area_type': row[3],
                'admin_boundary_id': str(row[4]) if row[4] else None,
                'geometry': json.loads(row[5]) if row[5] else None,
                'bbox': {
                    'min_lng': float(row[6]) if row[6] else None,
                    'min_lat': float(row[7]) if row[7] else None,
                    'max_lng': float(row[8]) if row[8] else None,
                    'max_lat': float(row[9]) if row[9] else None,
                } if row[6] else None,
                'created_at': row[10].isoformat() if row[10] else None,
                'updated_at': row[11].isoformat() if row[11] else None,
                'admin_boundary_name': row[12],
                'pixel_count': row[13] or 0,
                'total_population': int(row[14]) if row[14] else 0,
                'building_count': row[15] or 0,
                'division_name': row[16],
                'district_name': row[17],
                'upazila_name': row[18],
                'union_name': row[19],
                'city_corporation_name': row[20],
                'zone_name': row[21],
                'ward_name': row[22],
                'block_name': row[23],
                'sampled_count': row[24] or 0,
                'sampled_population': int(row[25]) if row[25] else 0,
                'category': row[26],
                'status': row[27]
            }
            areas.append(area)
```

- [ ] **Step 4: Manually verify with the backend running**

```bash
curl -s "http://localhost:5001/api/campaigns/<campaign_id>/areas" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -40
```
Expected: existing campaign areas (district/upazila/union-based) show unchanged `division_name`/`district_name`/`upazila_name`/`union_name` and `null` for the 4 new fields; a campaign area added against a city corporation/ward/block shows the new fields populated and `null` for the old ones.

- [ ] **Step 5: Commit**

```bash
git add truecover-backend/routes/campaigns.py truecover-backend/tests/test_campaign_area_boundary_id.py
git commit -m "Add recursive ancestor name lookup to list_campaign_areas for city corporation/zone/ward/block"
```

---

## Task 9: Populate `admin_boundary_pixels` for new leaf rows via spatial join, roll up to ancestors

**Files:**
- Create: `truecover-backend/scripts/populate_boundary_pixels_for_new_levels.py`
- Test: `truecover-backend/tests/test_populate_boundary_pixels_for_new_levels.py`

**Interfaces:**
- Consumes: `admin_boundaries.parent_id`/`boundary_type` (Task 1), the existing `admin_boundary_pixels` table (`admin_boundary_id`, `quadkey`).
- Produces: `populate_pixels_for_leaf_boundaries(conn) -> int` (spatial join for `boundary_type IN ('ward', 'block')` rows with no existing `admin_boundary_pixels` rows — "ward" here means a leaf ward, i.e. one with no `block` children), `roll_up_pixels_to_ancestors(conn) -> int` (for every non-leaf new row, union its children's pixel sets).

- [ ] **Step 1: Write the failing test**

```python
# ABOUTME: Tests for populating admin_boundary_pixels for new ward/block/zone/city_corporation rows
# ABOUTME: Leaf rows get a real spatial join; ancestors get their children's pixel sets unioned

import pytest
import uuid
from db.connection import get_db_connection, return_db_connection
from scripts.populate_boundary_pixels_for_new_levels import (
    populate_pixels_for_leaf_boundaries, roll_up_pixels_to_ancestors
)


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestPopulatePixelsForLeafBoundaries:
    def test_spatial_join_finds_intersecting_pixels(self, db_conn):
        cursor = db_conn.cursor()
        quadkey = f"test_leaf_{uuid.uuid4().hex[:10]}"
        cursor.execute("""
            INSERT INTO pixels (quadkey, geometry, latitude, longitude, level)
            VALUES (%s, ST_GeomFromText('POLYGON((90 23, 90.01 23, 90.01 23.01, 90 23.01, 90 23))', 4326), 23.005, 90.005, 18)
        """, (quadkey,))

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, geometry)
            VALUES ('Test Ward', 'BD', 5, 'ward',
                    ST_GeomFromText('POLYGON((89.9 22.9, 90.1 22.9, 90.1 23.1, 89.9 23.1, 89.9 22.9))', 4326))
            RETURNING id
        """)
        ward_id = str(cursor.fetchone()[0])

        count = populate_pixels_for_leaf_boundaries(db_conn)

        assert count >= 1
        cursor.execute("SELECT quadkey FROM admin_boundary_pixels WHERE admin_boundary_id = %s", (ward_id,))
        assert cursor.fetchone()[0] == quadkey

    def test_skips_boundaries_that_already_have_pixels(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, geometry)
            VALUES ('Test Ward 2', 'BD', 5, 'ward',
                    ST_GeomFromText('POLYGON((89.9 22.9, 90.1 22.9, 90.1 23.1, 89.9 23.1, 89.9 22.9))', 4326))
            RETURNING id
        """)
        ward_id = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'already-there')
        """, (ward_id,))

        populate_pixels_for_leaf_boundaries(db_conn)

        cursor.execute("SELECT COUNT(*) FROM admin_boundary_pixels WHERE admin_boundary_id = %s", (ward_id,))
        assert cursor.fetchone()[0] == 1


class TestRollUpPixelsToAncestors:
    def test_ancestor_gets_union_of_children_pixels(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Zone', 'BD', 4, 'zone') RETURNING id
        """)
        zone_id = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, parent_id)
            VALUES ('Test Ward A', 'BD', 5, 'ward', %s) RETURNING id
        """, (zone_id,))
        ward_a = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, parent_id)
            VALUES ('Test Ward B', 'BD', 5, 'ward', %s) RETURNING id
        """, (zone_id,))
        ward_b = str(cursor.fetchone()[0])

        cursor.execute("INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'qk-a')", (ward_a,))
        cursor.execute("INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'qk-b')", (ward_b,))

        roll_up_pixels_to_ancestors(db_conn)

        cursor.execute(
            "SELECT quadkey FROM admin_boundary_pixels WHERE admin_boundary_id = %s ORDER BY quadkey", (zone_id,)
        )
        assert [r[0] for r in cursor.fetchall()] == ['qk-a', 'qk-b']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_populate_boundary_pixels_for_new_levels.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.populate_boundary_pixels_for_new_levels'`

- [ ] **Step 3: Write the implementation**

```python
# ABOUTME: Populates admin_boundary_pixels for new ward/block/zone/city_corporation rows
# ABOUTME: Leaf rows (no boundary_type children) get a spatial join; ancestors get a bottom-up union

def populate_pixels_for_leaf_boundaries(conn) -> int:
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ab.id FROM admin_boundaries ab
        WHERE ab.boundary_type IN ('ward', 'block')
          AND NOT EXISTS (SELECT 1 FROM admin_boundaries child WHERE child.parent_id = ab.id)
          AND NOT EXISTS (SELECT 1 FROM admin_boundary_pixels abp WHERE abp.admin_boundary_id = ab.id)
    """)
    leaf_ids = [str(row[0]) for row in cursor.fetchall()]

    total = 0
    for leaf_id in leaf_ids:
        cursor.execute("""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey)
            SELECT %s, p.quadkey
            FROM pixels p
            JOIN admin_boundaries ab ON ab.id = %s
            WHERE ST_Intersects(p.geometry, ab.geometry)
            ON CONFLICT (admin_boundary_id, quadkey) DO NOTHING
        """, (leaf_id, leaf_id))
        total += cursor.rowcount

    conn.commit()
    return total


def roll_up_pixels_to_ancestors(conn) -> int:
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id FROM admin_boundaries
        WHERE boundary_type IN ('zone', 'city_corporation', 'ward')
          AND EXISTS (SELECT 1 FROM admin_boundaries child WHERE child.parent_id = admin_boundaries.id)
        ORDER BY level DESC
    """)
    ancestor_ids = [str(row[0]) for row in cursor.fetchall()]

    total = 0
    for ancestor_id in ancestor_ids:
        cursor.execute("""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey)
            SELECT %s, abp.quadkey
            FROM admin_boundary_pixels abp
            JOIN admin_boundaries child ON child.id = abp.admin_boundary_id
            WHERE child.parent_id = %s
            ON CONFLICT (admin_boundary_id, quadkey) DO NOTHING
        """, (ancestor_id, ancestor_id))
        total += cursor.rowcount

    conn.commit()
    return total
```

Ordering note: `roll_up_pixels_to_ancestors` selects ancestors ordered by `level DESC` (deepest first — e.g. ward before zone, zone before city_corporation) so a multi-level rollup completes bottom-up in one pass. Run `populate_pixels_for_leaf_boundaries` before `roll_up_pixels_to_ancestors`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run pytest tests/test_populate_boundary_pixels_for_new_levels.py -v`
Expected: 3 passed

- [ ] **Step 5: Add the `__main__` block and run it against the real imported data**

```python
if __name__ == "__main__":
    from db.connection import get_db_connection, return_db_connection

    conn = get_db_connection()
    try:
        leaf_count = populate_pixels_for_leaf_boundaries(conn)
        print(f"Populated {leaf_count} leaf pixel mappings")
        rollup_count = roll_up_pixels_to_ancestors(conn)
        print(f"Rolled up {rollup_count} ancestor pixel mappings")
    finally:
        return_db_connection(conn)
```

Run: `cd truecover-backend && DATABASE_URL=postgresql://truecover:truecover@localhost:5435/truecover uv run python scripts/populate_boundary_pixels_for_new_levels.py`
Expected: prints non-zero counts once Task 5's importer has been run against the real data.

- [ ] **Step 6: Commit**

```bash
git add truecover-backend/scripts/populate_boundary_pixels_for_new_levels.py truecover-backend/tests/test_populate_boundary_pixels_for_new_levels.py
git commit -m "Populate admin_boundary_pixels for new ward/block/zone/city_corporation rows"
```

---

## Task 10: Frontend API/hook types support `id`

**Files:**
- Modify: `truecover-app/src/services/api.ts`
- Modify: `truecover-app/src/hooks/useAdminBoundaries.ts`

**Interfaces:**
- Produces: `AdminBoundaryChild` gets `id: string` (always present) and `pcode: string | null` (was `string`); `campaignAreasApi.add` accepts `admin_boundary_id?: string` alongside existing `pcode?: string`; `adminBoundariesApi.getChildren`'s return type matches.

- [ ] **Step 1: Update `api.ts`**

In `truecover-app/src/services/api.ts`, change:

```typescript
  async getChildren(pcode: string, token: string): Promise<{
    children: Array<{
      pcode: string;
      name: string;
      level: number;
      parent_pcode: string;
      population: number;
    }>;
  }> {
    const response = await axios.get(
      `${API_URL}/api/admin-boundaries/${pcode}/children`,
```

to:

```typescript
  async getChildren(identifier: string, token: string): Promise<{
    children: Array<{
      id: string;
      pcode: string | null;
      name: string;
      level: number;
      parent_pcode: string | null;
      population: number;
    }>;
  }> {
    const response = await axios.get(
      `${API_URL}/api/admin-boundaries/${identifier}/children`,
```

and change `campaignAreasApi.add`'s data type:

```typescript
  async add(
    campaignId: string,
    data: {
      area_type: 'admin_boundary' | 'drawn';
      pcode?: string;  // For admin_boundary type
      geometry?: any;  // For drawn type
      name?: string;
    },
    token: string
  ): Promise<any> {
```

to:

```typescript
  async add(
    campaignId: string,
    data: {
      area_type: 'admin_boundary' | 'drawn';
      pcode?: string;  // For admin_boundary type (legacy, pcode-bearing rows)
      admin_boundary_id?: string;  // For admin_boundary type (any row, including id-only ones)
      geometry?: any;  // For drawn type
      name?: string;
    },
    token: string
  ): Promise<any> {
```

- [ ] **Step 2: Update `useAdminBoundaries.ts`**

Change:

```typescript
interface AdminBoundaryChild {
  pcode: string;
  name: string;
  level: number;
  parent_pcode: string;
  population: number;
}
```

to:

```typescript
interface AdminBoundaryChild {
  id: string;
  pcode: string | null;
  name: string;
  level: number;
  parent_pcode: string | null;
  population: number;
}
```

`useAdminBoundaryChildren(pcode: string | undefined)`'s implementation is unchanged (it already takes an arbitrary string identifier positionally); only its JSDoc comment's use of "pcode" as the param name stays accurate for the existing division/district/upazila call sites, and is equally correct when a caller passes an `id` for a boundary with no pcode.

- [ ] **Step 3: Typecheck**

Run: `cd truecover-app && npx tsc --noEmit -p .`
Expected: no errors (existing callers of `useAdminBoundaryChildren`/`getChildren`/`campaignAreasApi.add` all still compile — they either don't destructure `pcode` off children, or already guard for it)

- [ ] **Step 4: Commit**

```bash
git add truecover-app/src/services/api.ts truecover-app/src/hooks/useAdminBoundaries.ts
git commit -m "Add id field to admin boundary children and admin_boundary_id to campaign area add"
```

---

## Task 11: `AdminBoundaryDrillPicker` component + wiring into `AddCampaignAreaModal`/`LocationsPage`

**Files:**
- Create: `truecover-app/src/components/AdminBoundaryDrillPicker.tsx`
- Modify: `truecover-app/src/components/AddCampaignAreaModal.tsx`
- Modify: `truecover-app/src/pages/LocationsPage.tsx`

**Interfaces:**
- Consumes: `useAdminBoundaryChildren` (Task 10), `AddCampaignAreaModal`'s existing `adminBoundary` prop.
- Produces: `AdminBoundaryDrillPicker` component with props `{ isOpen, onClose, onSelect: (boundary: { id: string; name: string }) => void }`.

- [ ] **Step 1: Write the component**

```tsx
// ABOUTME: Drill-down picker from division through whatever admin boundary levels exist
// ABOUTME: Follows the branch the data actually has - upazila/union or city corporation/zone/ward/block

import React, { useState } from 'react';
import { TacticalModal, TacticalButton } from '../tactical-ui';
import { useAdminBoundaryChildren } from '../hooks/useAdminBoundaries';

interface BoundaryStep {
  id: string;
  name: string;
}

interface AdminBoundaryDrillPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (boundary: { id: string; name: string }) => void;
}

export const AdminBoundaryDrillPicker: React.FC<AdminBoundaryDrillPickerProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const [path, setPath] = useState<BoundaryStep[]>([]);

  const currentIdentifier = path.length > 0 ? path[path.length - 1].id : 'BD';
  const { data: childrenData, isLoading } = useAdminBoundaryChildren(isOpen ? currentIdentifier : undefined);
  const children = childrenData?.children ?? [];

  const handleDrillInto = (child: { id: string; name: string }) => {
    setPath(prev => [...prev, child]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setPath(prev => prev.slice(0, index + 1));
  };

  const handleSelect = (child: { id: string; name: string }) => {
    onSelect(child);
    setPath([]);
    onClose();
  };

  const handleClose = () => {
    setPath([]);
    onClose();
  };

  return (
    <TacticalModal title="Select Admin Boundary" isOpen={isOpen} onClose={handleClose} size="md">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1 text-xs font-mono text-tactical-text-dim">
          <span className="cursor-pointer hover:text-tactical-text-primary" onClick={() => setPath([])}>
            Bangladesh
          </span>
          {path.map((step, idx) => (
            <React.Fragment key={step.id}>
              <span>/</span>
              <span
                className="cursor-pointer hover:text-tactical-text-primary"
                onClick={() => handleBreadcrumbClick(idx)}
              >
                {step.name}
              </span>
            </React.Fragment>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm font-mono text-tactical-text-muted">Loading...</p>
        ) : children.length === 0 ? (
          <p className="text-sm font-mono text-tactical-text-muted">No sub-areas found at this level.</p>
        ) : (
          <div className="border border-tactical-border-medium max-h-80 overflow-y-auto">
            {children.map((child) => (
              <div
                key={child.id}
                className="flex items-center justify-between px-3 py-2 border-b border-tactical-border-dark last:border-b-0 hover:bg-tactical-bg-secondary"
              >
                <span className="text-sm font-mono text-tactical-text-primary">{child.name}</span>
                <div className="flex gap-2">
                  <TacticalButton size="sm" variant="secondary" onClick={() => handleDrillInto(child)}>
                    Drill In
                  </TacticalButton>
                  <TacticalButton size="sm" variant="primary" onClick={() => handleSelect(child)}>
                    Use This
                  </TacticalButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TacticalModal>
  );
};
```

Note: `TacticalButton`'s `size`/`variant` prop names and values are copied from existing usage in `CampaignAreasManager.tsx` (`variant="danger"`, `variant="secondary"`) and `CreateRoundModal.tsx` — verify against `truecover-app/src/tactical-ui`'s actual `TacticalButton` prop types before this step (`grep -n "size?\|variant?" src/tactical-ui/*.tsx`) and adjust if the accepted values differ.

- [ ] **Step 2: Wire `AddCampaignAreaModal.tsx` to accept an id-only boundary**

Change the `adminBoundary` prop type from:

```typescript
  adminBoundary?: {
    pcode: string;
    name: string;
  } | null;
```

to:

```typescript
  adminBoundary?: {
    pcode?: string;
    id?: string;
    name: string;
  } | null;
```

and change the submit logic from:

```typescript
      if (mode === 'admin_boundary' && adminBoundary) {
        areaData.pcode = adminBoundary.pcode;
      } else if (mode === 'drawn' && drawnGeometry) {
```

to:

```typescript
      if (mode === 'admin_boundary' && adminBoundary) {
        if (adminBoundary.id) {
          areaData.admin_boundary_id = adminBoundary.id;
        } else {
          areaData.pcode = adminBoundary.pcode;
        }
      } else if (mode === 'drawn' && drawnGeometry) {
```

and change the two display references from `adminBoundary.pcode` (in the JSX at line ~142 showing `Code: {adminBoundary.pcode}`) to conditionally show either:

```tsx
            <p className="text-xs text-tactical-text-muted mt-1">
              {adminBoundary?.pcode ? `Code: ${adminBoundary.pcode}` : `ID: ${adminBoundary?.id}`}
            </p>
```

Also, the "Extract buildings from Overture Maps" logic further down uses `adminBoundary?.pcode` as the identifier passed to `importOvertureBuildingsAsync` — since that endpoint is pcode-based only and out of scope for this plan, guard it: change

```typescript
          const pcode = mode === 'admin_boundary' ? adminBoundary?.pcode : undefined;
```

to:

```typescript
          const pcode = mode === 'admin_boundary' ? adminBoundary?.pcode : undefined;
          if (mode === 'admin_boundary' && !adminBoundary?.pcode) {
            tacticalToast.warning('Overture building extraction is not yet available for this boundary type; skipping.');
          } else {
```

closing the added `else` block around the existing `importOvertureBuildingsAsync` call (find the matching closing brace a few lines below and add one more `}`).

- [ ] **Step 3: Wire `LocationsPage.tsx` with a new entry point**

Find where `AddCampaignAreaModal` is rendered (line ~1147) and where `selectedAdminBoundaryForCampaign` state is declared (line ~84). Add:

```typescript
  const [isDrillPickerOpen, setIsDrillPickerOpen] = useState(false);
```

near the existing `isAddCampaignAreaModalOpen` state, and render the picker alongside the existing modal:

```tsx
      <AdminBoundaryDrillPicker
        isOpen={isDrillPickerOpen}
        onClose={() => setIsDrillPickerOpen(false)}
        onSelect={(boundary) => {
          setSelectedAdminBoundaryForCampaign({ id: boundary.id, name: boundary.name } as any);
          setIsAddCampaignAreaModalOpen(true);
        }}
      />
```

Note `selectedAdminBoundaryForCampaign`'s declared type is `{ pcode: string; name: string } | null` (line 84) — widen it to `{ pcode?: string; id?: string; name: string } | null` to match `AddCampaignAreaModal`'s widened prop from Step 2, and drop the `as any` cast once that's done.

Add an import for `AdminBoundaryDrillPicker` at the top of the file, and a button near wherever campaign areas are managed in the UI (search for the existing "Add Campaign Area" trigger button in this file to place it alongside):

```tsx
              <TacticalButton size="sm" variant="secondary" onClick={() => setIsDrillPickerOpen(true)}>
                Add Area by Drilling Down
              </TacticalButton>
```

- [ ] **Step 4: Typecheck**

Run: `cd truecover-app && npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 5: Manually verify in the browser**

Run: `cd truecover-app && bun run dev`, open a campaign's Locations page, click "Add Area by Drilling Down", drill Bangladesh → a division → a district that has a city corporation as a child (e.g. Dhaka), confirm "Dhaka North City Corporation (DNCC)" appears as a selectable child, click "Use This", confirm `AddCampaignAreaModal` opens showing the city corporation name and an `ID:` line (not `Code:`), submit, and confirm the area appears in the campaign's area list.

- [ ] **Step 6: Commit**

```bash
git add truecover-app/src/components/AdminBoundaryDrillPicker.tsx truecover-app/src/components/AddCampaignAreaModal.tsx truecover-app/src/pages/LocationsPage.tsx
git commit -m "Add drill-down admin boundary picker so city corporations can be picked as campaign areas"
```

---

## Self-Review Notes

**Spec coverage:**
- Schema changes → Task 1.
- Ingestion (rural + urban, name matching, alias table, spatial overlap sanity check) → Tasks 2-5. The spatial check (`_overlap_ratio` in Task 3) computes real intersection area between each new ward's dissolved geometry and its matched union's existing geometry, logging (not blocking) any ward under 50% overlap into `low_overlap_wards` — inserted anyway since the name match is still the best evidence available, surfaced by Task 5's CLI output for manual review.
- Route/query generalization → Tasks 6-8.
- Pixel population for new levels → Task 9.
- Frontend → Tasks 10-11.
- Explicitly out of scope (District.json, stratified sampling generalization, PMTiles regeneration) → carried into this plan's "Not in this plan" section, not tasked here.

**Follow-up plan needed:** Stratified Cluster Sampling generalization (cluster_sampling_config renames, get_children_for_pcodes generalization, dropping the redundant union-specific activities, select_clusters population-weighting fix, StratifiedClusterSamplingWizard.tsx branch UI) is a separate, subsequent plan — it depends on this plan's Task 1 (schema) and Task 6 (generalized children endpoint) being complete first.
