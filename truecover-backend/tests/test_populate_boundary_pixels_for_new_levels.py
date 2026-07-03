# ABOUTME: Tests for populating admin_boundary_pixels for new ward/block/zone/city_corporation rows
# ABOUTME: Leaf rows get a real spatial join; ancestors get their children's pixel sets unioned

import pytest
import uuid
from db.connection import get_db_connection, return_db_connection
from scripts.populate_boundary_pixels_for_new_levels import (
    populate_pixels_for_leaf_boundaries, roll_up_pixels_to_ancestors
)


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestPopulatePixelsForLeafBoundaries:
    def test_spatial_join_finds_intersecting_pixels(self, db_conn):
        cursor = db_conn.cursor()
        quadkey = f"test_leaf_{uuid.uuid4().hex[:10]}"
        cursor.execute("""
            INSERT INTO pixels (quadkey, geometry, latitude, longitude, level)
            VALUES (%s, ST_GeomFromText('POLYGON((90 23, 90.01 23, 90.01 23.01, 90 23.01, 90 23))', 4326), 23.005, 90.005, 18)
        """, (quadkey,))

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, geometry)
            VALUES ('Test Ward', 'BD', 5, 'ward',
                    ST_GeomFromText('POLYGON((89.9 22.9, 90.1 22.9, 90.1 23.1, 89.9 23.1, 89.9 22.9))', 4326))
            RETURNING id
        """)
        ward_id = str(cursor.fetchone()[0])

        count = populate_pixels_for_leaf_boundaries(db_conn, boundary_ids=[ward_id])

        assert count >= 1
        cursor.execute("SELECT quadkey FROM admin_boundary_pixels WHERE admin_boundary_id = %s", (ward_id,))
        assert quadkey in [row[0] for row in cursor.fetchall()]

    def test_skips_boundaries_that_already_have_pixels(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, geometry)
            VALUES ('Test Ward 2', 'BD', 5, 'ward',
                    ST_GeomFromText('POLYGON((89.9 22.9, 90.1 22.9, 90.1 23.1, 89.9 23.1, 89.9 22.9))', 4326))
            RETURNING id
        """)
        ward_id = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'already-there')
        """, (ward_id,))

        populate_pixels_for_leaf_boundaries(db_conn, boundary_ids=[ward_id])

        cursor.execute("SELECT COUNT(*) FROM admin_boundary_pixels WHERE admin_boundary_id = %s", (ward_id,))
        assert cursor.fetchone()[0] == 1


class TestRollUpPixelsToAncestors:
    def test_ancestor_gets_union_of_children_pixels(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Zone', 'BD', 4, 'zone') RETURNING id
        """)
        zone_id = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, parent_id)
            VALUES ('Test Ward A', 'BD', 5, 'ward', %s) RETURNING id
        """, (zone_id,))
        ward_a = str(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type, parent_id)
            VALUES ('Test Ward B', 'BD', 5, 'ward', %s) RETURNING id
        """, (zone_id,))
        ward_b = str(cursor.fetchone()[0])

        cursor.execute("INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'qk-a')", (ward_a,))
        cursor.execute("INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey) VALUES (%s, 'qk-b')", (ward_b,))

        roll_up_pixels_to_ancestors(db_conn, boundary_ids=[zone_id])

        cursor.execute(
            "SELECT quadkey FROM admin_boundary_pixels WHERE admin_boundary_id = %s ORDER BY quadkey", (zone_id,)
        )
        assert [r[0] for r in cursor.fetchall()] == ['qk-a', 'qk-b']
