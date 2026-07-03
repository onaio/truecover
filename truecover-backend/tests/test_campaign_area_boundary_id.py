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
