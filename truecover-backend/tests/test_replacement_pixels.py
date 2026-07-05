# ABOUTME: Tests for the replacement-pixel upsert helper in cluster_sampling.py
# ABOUTME: Verifies a lost race/existing claim is reported honestly, not counted as success

import pytest
import uuid
import asyncio
from db.connection import get_db_connection, return_db_connection
from temporal.activities.cluster_sampling import upsert_replacement_pixel, ensure_coverage_pixels_for_locations


@pytest.fixture
def committed_campaign_and_indicator():
    """
    Real, committed org/project/campaign/indicator, cleaned up via cascade
    delete on the org afterward.

    ensure_coverage_pixels_for_locations opens its own DB connection (as it
    does in production), so fixture data created on a separate, uncommitted
    connection wouldn't be visible to it — this fixture commits for real
    instead of relying on rollback-based isolation.
    """
    conn = get_db_connection()
    conn.autocommit = True
    cursor = conn.cursor()

    cursor.execute("INSERT INTO organizations (name) VALUES (%s) RETURNING id", (f"test-org-{uuid.uuid4().hex[:8]}",))
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
    cursor.execute(
        "INSERT INTO indicators (project_id, name) VALUES (%s, %s) RETURNING id",
        (project_id, f"test-indicator-{uuid.uuid4().hex[:8]}")
    )
    indicator_id = cursor.fetchone()[0]

    yield str(campaign_id), str(indicator_id)

    cursor.execute("DELETE FROM organizations WHERE id = %s", (org_id,))
    cursor.close()
    return_db_connection(conn)


@pytest.fixture
def committed_locations():
    """Real, committed locations rows with quadkeys, cleaned up afterward."""
    conn = get_db_connection()
    conn.autocommit = True
    cursor = conn.cursor()
    created_ids = []

    def _make(quadkey):
        cursor.execute(
            "INSERT INTO locations (quadkey) VALUES (%s) RETURNING id",
            (quadkey,)
        )
        location_id = str(cursor.fetchone()[0])
        created_ids.append(location_id)
        return location_id

    yield _make

    if created_ids:
        cursor.execute("DELETE FROM locations WHERE id = ANY(%s::uuid[])", (created_ids,))
    cursor.close()
    return_db_connection(conn)


@pytest.fixture
def db_conn():
    """Provide a database connection that rolls back after each test."""
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


@pytest.fixture
def campaign_and_indicator(db_conn):
    """Create a self-contained org/project/campaign/indicator for this test."""
    cursor = db_conn.cursor()

    cursor.execute("INSERT INTO organizations (name) VALUES (%s) RETURNING id", (f"test-org-{uuid.uuid4().hex[:8]}",))
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

    cursor.execute(
        "INSERT INTO indicators (project_id, name) VALUES (%s, %s) RETURNING id",
        (project_id, f"test-indicator-{uuid.uuid4().hex[:8]}")
    )
    indicator_id = cursor.fetchone()[0]

    return str(campaign_id), str(indicator_id)


def _make_primary_pixel(cursor, campaign_id, indicator_id):
    """Insert a real primary coverage_pixel row (replacement_for has an FK to it)."""
    quadkey = f"test_primary_{uuid.uuid4().hex[:10]}"
    cursor.execute("""
        INSERT INTO coverage_pixel (quadkey, campaign_id, indicator_id, version, n_trials, n_covered, rounds)
        VALUES (%s, %s, %s, 0, 0, 0, ARRAY[1]) RETURNING id
    """, (quadkey, campaign_id, indicator_id))
    return str(cursor.fetchone()[0])


class TestUpsertReplacementPixel:
    def test_creates_new_replacement_pixel(self, db_conn, campaign_and_indicator):
        campaign_id, indicator_id = campaign_and_indicator
        cursor = db_conn.cursor()
        quadkey = f"test_repl_{uuid.uuid4().hex[:10]}"
        primary_id = _make_primary_pixel(cursor, campaign_id, indicator_id)

        result = upsert_replacement_pixel(cursor, quadkey, campaign_id, indicator_id, 1, primary_id)

        assert result is True
        cursor.execute(
            "SELECT replacement_for, rounds FROM coverage_pixel WHERE quadkey = %s AND campaign_id = %s AND indicator_id = %s",
            (quadkey, campaign_id, indicator_id)
        )
        row = cursor.fetchone()
        assert row is not None
        assert str(row[0]) == primary_id
        assert row[1] == [1]

    def test_does_not_overwrite_pixel_already_claimed_as_replacement(self, db_conn, campaign_and_indicator):
        campaign_id, indicator_id = campaign_and_indicator
        cursor = db_conn.cursor()
        quadkey = f"test_repl_{uuid.uuid4().hex[:10]}"
        first_primary = _make_primary_pixel(cursor, campaign_id, indicator_id)
        second_primary = _make_primary_pixel(cursor, campaign_id, indicator_id)

        first = upsert_replacement_pixel(cursor, quadkey, campaign_id, indicator_id, 1, first_primary)
        assert first is True

        # Simulate a losing race: a second primary tries to claim the same quadkey
        second = upsert_replacement_pixel(cursor, quadkey, campaign_id, indicator_id, 1, second_primary)

        assert second is False
        cursor.execute(
            "SELECT replacement_for FROM coverage_pixel WHERE quadkey = %s AND campaign_id = %s AND indicator_id = %s",
            (quadkey, campaign_id, indicator_id)
        )
        row = cursor.fetchone()
        assert str(row[0]) == first_primary  # unchanged, still points at the winner

    def test_does_not_overwrite_pixel_already_sampled_as_primary(self, db_conn, campaign_and_indicator):
        campaign_id, indicator_id = campaign_and_indicator
        cursor = db_conn.cursor()
        quadkey = f"test_repl_{uuid.uuid4().hex[:10]}"
        primary_id = _make_primary_pixel(cursor, campaign_id, indicator_id)

        cursor.execute("""
            INSERT INTO coverage_pixel (quadkey, campaign_id, indicator_id, version, n_trials, n_covered, rounds)
            VALUES (%s, %s, %s, 0, 0, 0, ARRAY[1])
        """, (quadkey, campaign_id, indicator_id))

        result = upsert_replacement_pixel(cursor, quadkey, campaign_id, indicator_id, 2, primary_id)

        assert result is False
        cursor.execute(
            "SELECT replacement_for, rounds FROM coverage_pixel WHERE quadkey = %s AND campaign_id = %s AND indicator_id = %s",
            (quadkey, campaign_id, indicator_id)
        )
        row = cursor.fetchone()
        assert row[0] is None
        assert row[1] == [1]


class TestEnsureCoveragePixelsForLocations:
    def test_creates_one_pixel_per_distinct_quadkey(
        self, committed_campaign_and_indicator, committed_locations
    ):
        campaign_id, indicator_id = committed_campaign_and_indicator
        quadkey = f"test_bldg_{uuid.uuid4().hex[:10]}"
        loc_a = committed_locations(quadkey)
        loc_b = committed_locations(quadkey)  # same pixel, different building

        pixel_ids = asyncio.run(
            ensure_coverage_pixels_for_locations(campaign_id, indicator_id, [loc_a, loc_b], 3)
        )

        assert len(pixel_ids) == 1

        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT rounds FROM coverage_pixel WHERE id = %s",
                (pixel_ids[0],)
            )
            row = cursor.fetchone()
            assert row[0] == [3]
            cursor.execute("DELETE FROM coverage_pixel WHERE id = %s", (pixel_ids[0],))
            conn.commit()
        finally:
            cursor.close()
            return_db_connection(conn)

    def test_idempotent_across_rounds(self, committed_campaign_and_indicator, committed_locations):
        campaign_id, indicator_id = committed_campaign_and_indicator
        quadkey = f"test_bldg_{uuid.uuid4().hex[:10]}"
        loc = committed_locations(quadkey)

        first = asyncio.run(ensure_coverage_pixels_for_locations(campaign_id, indicator_id, [loc], 1))
        second = asyncio.run(ensure_coverage_pixels_for_locations(campaign_id, indicator_id, [loc], 2))

        assert first == second  # same pixel row both times

        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT rounds FROM coverage_pixel WHERE id = %s", (first[0],))
            assert cursor.fetchone()[0] == [1, 2]
            cursor.execute("DELETE FROM coverage_pixel WHERE id = %s", (first[0],))
            conn.commit()
        finally:
            cursor.close()
            return_db_connection(conn)

    def test_empty_location_ids_returns_empty(self, committed_campaign_and_indicator):
        campaign_id, indicator_id = committed_campaign_and_indicator
        result = asyncio.run(ensure_coverage_pixels_for_locations(campaign_id, indicator_id, [], 1))
        assert result == []
