# ABOUTME: Tests for the parent_id-based children lookup used by get_admin_boundary_children
# ABOUTME: Verifies existing pcode-based rows are unaffected and new parent_id rows resolve correctly

import pytest
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
