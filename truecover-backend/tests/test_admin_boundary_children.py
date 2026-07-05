# ABOUTME: Tests for the parent_id-based children lookup used by get_admin_boundary_children
# ABOUTME: Verifies existing pcode-based rows are unaffected and new parent_id rows resolve correctly

import flask
import pytest
from db.connection import get_db_connection, return_db_connection
from routes.admin_boundaries import get_admin_boundary_children, get_city_corporations


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
        # Real districts have adm0/adm1/adm2 all populated simultaneously
        # (e.g. adm0_pcode='BD', adm1_pcode='BD30', adm2_pcode='BD3026'). Only
        # setting adm2_pcode here would let the old "first non-null adm*_pcode"
        # heuristic happen to pick the same value as the correct
        # parent_row[1 + parent_level] lookup, masking a regression.
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm0_pcode, adm1_pcode, adm2_pcode)
            VALUES ('Test Merge District', 'BD', 2, 'BD', 'BD30', 'BDMERGE') RETURNING id
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


class TestChildrenEndpointNoChildLevel:
    def test_level_4_boundary_with_no_children_returns_message(self, db_conn, app_context, monkeypatch):
        """A level-4 boundary (union) has no level 5 pcode column to look up and,
        for boundaries that predate the parent_id feature, no parent_id children
        either. This path is supposed to remain unchanged from before the merge
        fix, which included a 'No child level exists' message.
        """
        monkeypatch.setattr('routes.admin_boundaries.get_db_connection', lambda: db_conn)
        monkeypatch.setattr('routes.admin_boundaries.return_db_connection', lambda conn: None)

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm4_pcode)
            VALUES ('Test Leaf Union', 'BD', 4, 'BDLEAFUNION') RETURNING id
        """)
        union_id = cursor.fetchone()[0]

        response, status = get_admin_boundary_children.__wrapped__(
            user={'id': 'test-user'}, identifier=str(union_id)
        )

        assert status == 200
        body = response.get_json()
        assert body['children'] == []
        assert body['message'] == 'No child level exists'


class TestCityCorporationsEndpoint:
    def test_returns_only_city_corporations_sorted_by_name(self, db_conn, app_context, monkeypatch):
        monkeypatch.setattr('routes.admin_boundaries.get_db_connection', lambda: db_conn)
        monkeypatch.setattr('routes.admin_boundaries.return_db_connection', lambda conn: None)

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Zeta City Corporation', 'BD', 3, 'city_corporation') RETURNING id
        """)
        zeta_id = cursor.fetchone()[0]

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Alpha City Corporation', 'BD', 3, 'city_corporation') RETURNING id
        """)
        alpha_id = cursor.fetchone()[0]

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Upazila', 'BD', 3, 'upazila')
        """)

        response, status = get_city_corporations.__wrapped__(user={'id': 'test-user'})

        assert status == 200
        body = response.get_json()
        results = body['city_corporations']

        names = [row['name'] for row in results]
        assert 'Test Upazila' not in names

        alpha_entry = {'id': str(alpha_id), 'name': 'Test Alpha City Corporation'}
        zeta_entry = {'id': str(zeta_id), 'name': 'Test Zeta City Corporation'}
        assert alpha_entry in results
        assert zeta_entry in results
        assert results.index(alpha_entry) < results.index(zeta_entry)
        assert names == sorted(names)
