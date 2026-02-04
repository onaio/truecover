# ABOUTME: Tests for batch round assignment SQL operations on coverage_pixel table.
# ABOUTME: Verifies that WHERE id = ANY(%s::uuid[]) batch updates work correctly.

import pytest
import uuid
from db.connection import get_db_connection, return_db_connection


@pytest.fixture
def db_conn():
    """Provide a database connection that rolls back after each test."""
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


@pytest.fixture
def test_pixel_ids(db_conn):
    """Create test coverage_pixel records and return their IDs."""
    cursor = db_conn.cursor()

    # Find a valid campaign_id and indicator_id from existing data
    cursor.execute("SELECT id FROM campaigns LIMIT 1")
    campaign_id = cursor.fetchone()[0]
    cursor.execute("SELECT id FROM indicators LIMIT 1")
    indicator_id = cursor.fetchone()[0]

    pixel_ids = []
    for i in range(5):
        pixel_id = str(uuid.uuid4())
        quadkey = f"test_batch_{pixel_id[:8]}"
        cursor.execute("""
            INSERT INTO coverage_pixel
                (id, quadkey, campaign_id, indicator_id, version, n_trials, n_covered, rounds)
            VALUES (%s, %s, %s, %s, 0, 0, 0, '{}')
        """, (pixel_id, quadkey, campaign_id, indicator_id))
        pixel_ids.append(pixel_id)

    return pixel_ids


class TestBatchUpdateRoundAssignments:
    """Test batch UPDATE ... WHERE id = ANY(%s::uuid[]) for round assignments."""

    def test_batch_update_assigns_round_to_all_pixels(self, db_conn, test_pixel_ids):
        cursor = db_conn.cursor()
        round_number = 1

        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[])
        """, (round_number, test_pixel_ids))

        assert cursor.rowcount == 5

        cursor.execute(
            "SELECT id, rounds FROM coverage_pixel WHERE id = ANY(%s::uuid[])",
            (test_pixel_ids,)
        )
        for row in cursor.fetchall():
            assert row[1] == [1], f"Pixel {row[0]} should have rounds [1], got {row[1]}"

    def test_batch_update_appends_to_existing_rounds(self, db_conn, test_pixel_ids):
        cursor = db_conn.cursor()

        # First assign round 1
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[])
        """, (1, test_pixel_ids))

        # Then assign round 2
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[])
        """, (2, test_pixel_ids))

        cursor.execute(
            "SELECT rounds FROM coverage_pixel WHERE id = ANY(%s::uuid[])",
            (test_pixel_ids,)
        )
        for row in cursor.fetchall():
            assert row[0] == [1, 2]

    def test_batch_update_with_empty_list_updates_nothing(self, db_conn):
        cursor = db_conn.cursor()

        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[])
        """, (1, []))

        assert cursor.rowcount == 0

    def test_batch_update_with_subset_only_updates_matching(self, db_conn, test_pixel_ids):
        cursor = db_conn.cursor()
        subset = test_pixel_ids[:2]

        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[])
        """, (1, subset))

        assert cursor.rowcount == 2

        # Check the rest are untouched
        remaining = test_pixel_ids[2:]
        cursor.execute(
            "SELECT rounds FROM coverage_pixel WHERE id = ANY(%s::uuid[])",
            (remaining,)
        )
        for row in cursor.fetchall():
            assert row[0] == []


class TestBatchRemoveRoundAssignments:
    """Test batch removal of round assignments."""

    def test_batch_remove_clears_round_from_all_pixels(self, db_conn, test_pixel_ids):
        cursor = db_conn.cursor()

        # Setup: assign round 1
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s)
            WHERE id = ANY(%s::uuid[])
        """, (1, test_pixel_ids))

        # Remove round 1
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_remove(COALESCE(rounds, '{}'), %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[]) AND %s = ANY(COALESCE(rounds, '{}'))
        """, (1, test_pixel_ids, 1))

        assert cursor.rowcount == 5

        cursor.execute(
            "SELECT rounds FROM coverage_pixel WHERE id = ANY(%s::uuid[])",
            (test_pixel_ids,)
        )
        for row in cursor.fetchall():
            assert row[0] == []

    def test_batch_remove_only_affects_pixels_with_that_round(self, db_conn, test_pixel_ids):
        cursor = db_conn.cursor()

        # Assign round 1 to first 3, round 2 to last 2
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s)
            WHERE id = ANY(%s::uuid[])
        """, (1, test_pixel_ids[:3]))
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(rounds, %s)
            WHERE id = ANY(%s::uuid[])
        """, (2, test_pixel_ids[3:]))

        # Remove round 1
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_remove(COALESCE(rounds, '{}'), %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[]) AND %s = ANY(COALESCE(rounds, '{}'))
        """, (1, test_pixel_ids, 1))

        # Only 3 should be affected
        assert cursor.rowcount == 3

        # Round 2 pixels should be untouched
        cursor.execute(
            "SELECT rounds FROM coverage_pixel WHERE id = ANY(%s::uuid[])",
            (test_pixel_ids[3:],)
        )
        for row in cursor.fetchall():
            assert row[0] == [2]


class TestBatchIdempotentUpdate:
    """Test the idempotent pattern from cluster_sampling.py."""

    def test_idempotent_update_skips_already_assigned(self, db_conn, test_pixel_ids):
        cursor = db_conn.cursor()

        # First assignment
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(COALESCE(rounds, '{}'), %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[]) AND NOT (%s = ANY(COALESCE(rounds, '{}')))
        """, (1, test_pixel_ids, 1))

        assert cursor.rowcount == 5

        # Second assignment of same round - should skip all
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(COALESCE(rounds, '{}'), %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[]) AND NOT (%s = ANY(COALESCE(rounds, '{}')))
        """, (1, test_pixel_ids, 1))

        assert cursor.rowcount == 0

        # Verify no duplicates
        cursor.execute(
            "SELECT rounds FROM coverage_pixel WHERE id = ANY(%s::uuid[])",
            (test_pixel_ids,)
        )
        for row in cursor.fetchall():
            assert row[0] == [1]
