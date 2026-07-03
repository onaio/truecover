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
