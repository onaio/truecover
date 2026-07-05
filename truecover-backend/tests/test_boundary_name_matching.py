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
