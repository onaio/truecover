# ABOUTME: Tests for the parent_id-based children lookup used by get_admin_boundary_children
# ABOUTME: Verifies existing pcode-based rows are unaffected and new parent_id rows resolve correctly

import flask
import pytest
from db.connection import get_db_connection, return_db_connection
from routes.admin_boundaries import get_admin_boundary_children


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


@pytest.fixture
def app_context():
    app = flask.Flask(__name__)
    with app.app_context():
        yield


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


class TestChildrenEndpointMergesBothSources:
    def test_district_with_upazila_and_city_corporation_returns_both(self, db_conn, app_context, monkeypatch):
        """A district can have a pcode-reachable upazila AND a parent_id-linked city
        corporation at the same time (e.g. Chittagong, Dhaka, Gazipur, Khulna,
        Narayanganj, Rangpur, Sylhet in the real dataset). Both are children and
        must both be returned, not just whichever lookup path runs first.
        """
        monkeypatch.setattr('routes.admin_boundaries.get_db_connection', lambda: db_conn)
        monkeypatch.setattr('routes.admin_boundaries.return_db_connection', lambda conn: None)

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm2_pcode)
            VALUES ('Test Merge District', 'BD', 2, 'BDMERGE') RETURNING id
        """)
        district_id = cursor.fetchone()[0]

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm2_pcode, adm3_pcode)
            VALUES ('Test Merge Upazila', 'BD', 3, 'BDMERGE', 'BDMERGE01')
        """)

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test Merge City Corp', 'BD', 3, %s, 'city_corporation')
        """, (str(district_id),))

        response, status = get_admin_boundary_children.__wrapped__(
            user={'id': 'test-user'}, identifier=str(district_id)
        )

        assert status == 200
        names = {child['name'] for child in response.get_json()['children']}
        assert names == {'Test Merge Upazila', 'Test Merge City Corp'}
