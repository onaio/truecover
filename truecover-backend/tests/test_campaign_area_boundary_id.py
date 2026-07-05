# ABOUTME: Tests for resolving an admin_boundaries row by id vs by pcode when adding a campaign area
# ABOUTME: Verifies both lookup paths return the same shape of data for downstream insert

import uuid
import flask
import pytest
from db.connection import get_db_connection, return_db_connection
from routes.campaigns import add_campaign_area, list_campaign_areas


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


@pytest.fixture
def committed_campaign(db_conn):
    """
    Real org/project/campaign for add_campaign_area to attach a campaign_areas
    row to. add_campaign_area calls conn.commit() on the connection we hand it
    (via monkeypatch, same db_conn), so these rows are persisted for real
    regardless of db_conn's rollback-on-teardown. Cleaned up with an explicit
    cascade delete instead.
    """
    cursor = db_conn.cursor()
    cursor.execute(
        "INSERT INTO organizations (name) VALUES (%s) RETURNING id",
        (f"test-org-{uuid.uuid4().hex[:8]}",)
    )
    org_id = cursor.fetchone()[0]
    cursor.execute(
        "INSERT INTO projects (organization_id, title) VALUES (%s, %s) RETURNING id",
        (org_id, f"test-project-{uuid.uuid4().hex[:8]}")
    )
    project_id = cursor.fetchone()[0]
    cursor.execute(
        "INSERT INTO campaigns (project_id, name) VALUES (%s, %s) RETURNING id",
        (project_id, f"test-campaign-{uuid.uuid4().hex[:8]}")
    )
    campaign_id = cursor.fetchone()[0]

    yield str(campaign_id)

    cursor.execute("DELETE FROM organizations WHERE id = %s", (org_id,))
    db_conn.commit()


@pytest.fixture
def city_corporation_boundary(db_conn):
    """A real admin_boundaries row with no pcode, mirroring city corporations
    (level-3 boundaries linked to their district via parent_id rather than
    adm*_pcode)."""
    cursor = db_conn.cursor()
    cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 LIMIT 1")
    district_id = cursor.fetchone()[0]
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type, geometry)
        VALUES ('Test City Corp Area', 'BD', 3, %s, 'city_corporation',
                ST_GeomFromText('POLYGON((90 23, 91 23, 91 24, 90 24, 90 23))', 4326))
        RETURNING id
    """, (str(district_id),))
    cc_id = cursor.fetchone()[0]

    yield str(cc_id)

    cursor.execute("DELETE FROM admin_boundaries WHERE id = %s", (cc_id,))
    db_conn.commit()


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


class TestAddCampaignAreaResolvesBoundaryByIdOrPcode:
    """Exercises add_campaign_area's real if/else branching (admin_boundary_id
    vs pcode), rather than just replaying its SQL by hand."""

    def test_admin_boundary_id_creates_area_for_boundary_with_no_pcode(
        self, db_conn, committed_campaign, city_corporation_boundary, monkeypatch
    ):
        monkeypatch.setattr('routes.campaigns.get_db_connection', lambda: db_conn)
        monkeypatch.setattr('routes.campaigns.return_db_connection', lambda conn: None)
        monkeypatch.setattr('routes.campaigns.check_campaign_access', lambda user_id, campaign_id: True)

        app = flask.Flask(__name__)
        with app.test_request_context(json={
            'area_type': 'admin_boundary',
            'admin_boundary_id': city_corporation_boundary
        }):
            response, status = add_campaign_area.__wrapped__({'id': 'test-user'}, committed_campaign)

        assert status == 201
        body = response.get_json()
        assert body['admin_boundary_id'] == city_corporation_boundary

        cursor = db_conn.cursor()
        cursor.execute("SELECT admin_boundary_id FROM campaign_areas WHERE id = %s", (body['id'],))
        assert str(cursor.fetchone()[0]) == city_corporation_boundary

    def test_pcode_creates_area_for_a_real_district(
        self, db_conn, committed_campaign, monkeypatch
    ):
        monkeypatch.setattr('routes.campaigns.get_db_connection', lambda: db_conn)
        monkeypatch.setattr('routes.campaigns.return_db_connection', lambda conn: None)
        monkeypatch.setattr('routes.campaigns.check_campaign_access', lambda user_id, campaign_id: True)

        cursor = db_conn.cursor()
        cursor.execute("SELECT id, adm2_pcode FROM admin_boundaries WHERE level = 2 AND adm2_pcode IS NOT NULL LIMIT 1")
        district_id, district_pcode = cursor.fetchone()

        app = flask.Flask(__name__)
        with app.test_request_context(json={
            'area_type': 'admin_boundary',
            'pcode': district_pcode
        }):
            response, status = add_campaign_area.__wrapped__({'id': 'test-user'}, committed_campaign)

        assert status == 201
        body = response.get_json()
        assert body['admin_boundary_id'] == str(district_id)

        cursor.execute("SELECT admin_boundary_id FROM campaign_areas WHERE id = %s", (body['id'],))
        assert str(cursor.fetchone()[0]) == str(district_id)


class TestAncestorNamesForBoundaryWithParentId:
    def test_recursive_ancestor_lookup_returns_full_chain(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("SELECT id, name FROM admin_boundaries WHERE level = 2 LIMIT 1")
        district_id, district_name = cursor.fetchone()

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

        # The recursive walk doesn't stop at city_corporation - it continues up
        # through the pre-existing district row that the test city corporation
        # was attached to, since that district still has a real row in
        # admin_boundaries (with a NULL parent_id, which is where the
        # recursion actually terminates).
        assert chain == [
            ('ward', 'Test Ward'),
            ('zone', 'Test Zone'),
            ('city_corporation', 'Test CC'),
            ('district', district_name),
        ]


@pytest.fixture
def city_zone_ward_chain(db_conn):
    """A real city_corporation -> zone -> ward chain of admin_boundaries rows
    linked via parent_id, for exercising the ancestor-name recursive CTE.
    Deleting the city corporation row cascades (ON DELETE CASCADE on
    parent_id) down through the zone and ward rows."""
    cursor = db_conn.cursor()
    cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 LIMIT 1")
    district_id = cursor.fetchone()[0]
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
        VALUES ('Test CC Route', 'BD', 3, %s, 'city_corporation') RETURNING id
    """, (str(district_id),))
    cc_id = cursor.fetchone()[0]
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
        VALUES ('Test Zone Route', 'BD', 4, %s, 'zone') RETURNING id
    """, (str(cc_id),))
    zone_id = cursor.fetchone()[0]
    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
        VALUES ('Test Ward Route', 'BD', 5, %s, 'ward') RETURNING id
    """, (str(zone_id),))
    ward_id = cursor.fetchone()[0]

    yield str(ward_id)

    cursor.execute("DELETE FROM admin_boundaries WHERE id = %s", (str(cc_id),))
    db_conn.commit()


class TestListCampaignAreasAncestorNames:
    """Exercises the list_campaign_areas route directly (not just its SQL in
    isolation), following the pattern established in
    TestAddCampaignAreaResolvesBoundaryByIdOrPcode."""

    def test_route_returns_ancestor_names_for_boundary_with_parent_id(
        self, db_conn, committed_campaign, city_zone_ward_chain, monkeypatch
    ):
        monkeypatch.setattr('routes.campaigns.get_db_connection', lambda: db_conn)
        monkeypatch.setattr('routes.campaigns.return_db_connection', lambda conn: None)
        monkeypatch.setattr('routes.campaigns.check_campaign_access', lambda user_id, campaign_id: True)

        ward_id = city_zone_ward_chain
        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO campaign_areas (campaign_id, name, area_type, admin_boundary_id)
            VALUES (%s, %s, 'admin_boundary', %s)
        """, (committed_campaign, 'Test Ward Area', ward_id))

        app = flask.Flask(__name__)
        with app.test_request_context():
            response, status = list_campaign_areas.__wrapped__({'id': 'test-user'}, committed_campaign)

        assert status == 200
        areas = response.get_json()['areas']
        assert len(areas) == 1
        area = areas[0]
        assert area['city_corporation_name'] == 'Test CC Route'
        assert area['zone_name'] == 'Test Zone Route'
        assert area['ward_name'] == 'Test Ward Route'
        assert area['block_name'] is None
        assert area['division_name'] is None
        assert area['district_name'] is None
        assert area['upazila_name'] is None
        assert area['union_name'] is None

    def test_route_returns_legacy_names_unchanged_for_pcode_boundary(
        self, db_conn, committed_campaign, monkeypatch
    ):
        monkeypatch.setattr('routes.campaigns.get_db_connection', lambda: db_conn)
        monkeypatch.setattr('routes.campaigns.return_db_connection', lambda conn: None)
        monkeypatch.setattr('routes.campaigns.check_campaign_access', lambda user_id, campaign_id: True)

        cursor = db_conn.cursor()
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND adm2_pcode IS NOT NULL LIMIT 1")
        district_id = cursor.fetchone()[0]

        cursor.execute("""
            INSERT INTO campaign_areas (campaign_id, name, area_type, admin_boundary_id)
            VALUES (%s, %s, 'admin_boundary', %s)
        """, (committed_campaign, 'Test District Area', str(district_id)))

        app = flask.Flask(__name__)
        with app.test_request_context():
            response, status = list_campaign_areas.__wrapped__({'id': 'test-user'}, committed_campaign)

        assert status == 200
        areas = response.get_json()['areas']
        assert len(areas) == 1
        area = areas[0]
        assert area['district_name'] is not None
        assert area['city_corporation_name'] is None
        assert area['zone_name'] is None
        assert area['ward_name'] is None
        assert area['block_name'] is None
