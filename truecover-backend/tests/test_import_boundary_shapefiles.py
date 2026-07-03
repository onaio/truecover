# ABOUTME: Tests for importing rural district shapefiles (ward + block under existing union rows)
# ABOUTME: Uses a small synthetic GeoDataFrame and a self-contained boundary fixture, not real production data

import pytest
import uuid
import geopandas as gpd
from shapely.geometry import Polygon
from db.connection import get_db_connection, return_db_connection
from db.import_boundary_shapefiles import import_rural_district


def _block(uniname, wardname, ward_c, block_c, geometry, thaname='Test Upazila'):
    return {
        'DIVNAME': 'Test Division', 'DISTNAME': 'Test District', 'THANAME': thaname,
        'UNINAME': uniname, 'WARDNAME': wardname,
        'uni_uid': f'uid-{uniname}', 'ward_c': ward_c, 'block_c': block_c,
        'org_name': f'{wardname} EPI Center',
        'block_geoc': f'test-{thaname}-{uniname}-{ward_c}-{block_c}',
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
def second_union_fixture(db_conn, union_fixture):
    """A second upazila under the same district, with a union sharing `union_fixture`'s union name.

    Union names are only guaranteed unique within an upazila, not district-wide, so a district
    shapefile can legitimately contain two different upazilas that each have a "Test Union".
    """
    cursor = db_conn.cursor()
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, geometry, adm2_pcode, adm3_pcode)
        VALUES ('Test Upazila Two', 'BD', 3, ST_GeomFromText('POLYGON((10 10, 11 10, 11 11, 10 11, 10 10))', 4326),
                'BDTEST', 'BDTEST02')
    """)
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, geometry, adm2_pcode, adm3_pcode, adm4_pcode)
        VALUES ('Test Union', 'BD', 4, ST_GeomFromText('POLYGON((10 10, 10.05 10, 10.05 10.05, 10 10.05, 10 10))', 4326),
                'BDTEST', 'BDTEST02', 'BDTEST0201')
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

    def test_groups_by_upazila_and_union_when_union_name_repeats_across_upazilas(
        self, db_conn, union_fixture, second_union_fixture, monkeypatch
    ):
        # Two different upazilas ('Test Upazila' and 'Test Upazila Two') both have a "Test Union" -
        # grouping by UNINAME alone would merge these into a single group and could attach one
        # upazila's blocks under the other upazila's matched union row.
        mixed_gdf = gpd.GeoDataFrame([
            _block('Test Union', 'Ward 1', 'W1', 'KHA1', _square(0.001, 0.001), thaname='Test Upazila'),
            _block('Test Union', 'Ward 1', 'W1', 'KHA1', _square(10.001, 10.001), thaname='Test Upazila Two'),
        ], crs='EPSG:4326')
        monkeypatch.setattr('db.import_boundary_shapefiles.gpd.read_file', lambda path: mixed_gdf)

        result = import_rural_district('fake/path/Test.shp', db_conn)

        assert result['wards_created'] == 2
        assert result['unmatched_unions'] == []
        # Each ward's geometry falls squarely inside its own upazila's union - if the blocks were
        # merged under the wrong union, this would flag a low-overlap mismatch instead.
        assert result['low_overlap_wards'] == []

        cursor = db_conn.cursor()
        cursor.execute("SELECT id FROM admin_boundaries WHERE parent_id = %s AND name = 'Ward 1'", (union_fixture,))
        ward_under_first_union = cursor.fetchone()
        assert ward_under_first_union is not None

        cursor.execute(
            "SELECT id FROM admin_boundaries WHERE parent_id = %s AND name = 'Ward 1'", (second_union_fixture,)
        )
        ward_under_second_union = cursor.fetchone()
        assert ward_under_second_union is not None

        cursor.execute("""
            SELECT source_code FROM admin_boundaries WHERE boundary_type = 'block' AND parent_id = %s
        """, (ward_under_first_union[0],))
        assert cursor.fetchone()[0] == 'test-Test Upazila-Test Union-W1-KHA1'

        cursor.execute("""
            SELECT source_code FROM admin_boundaries WHERE boundary_type = 'block' AND parent_id = %s
        """, (ward_under_second_union[0],))
        assert cursor.fetchone()[0] == 'test-Test Upazila Two-Test Union-W1-KHA1'

    def test_idempotent_on_rerun(self, db_conn, union_fixture, synthetic_district_gdf, monkeypatch):
        monkeypatch.setattr('db.import_boundary_shapefiles.gpd.read_file', lambda path: synthetic_district_gdf)

        import_rural_district('fake/path/Test.shp', db_conn)
        result = import_rural_district('fake/path/Test.shp', db_conn)

        assert result['wards_created'] == 0
        assert result['blocks_created'] == 0


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
