# ABOUTME: Tests for the generalized stratified cluster sampling schema and activities
# ABOUTME: Covers cluster_sampling_config renames, boundary-id-based children lookup, and campaign area creation

import pytest
from db.connection import get_db_connection, return_db_connection


@pytest.fixture
def db_conn():
    conn = get_db_connection()
    conn.autocommit = False
    yield conn
    conn.rollback()
    return_db_connection(conn)


class TestClusterSamplingConfigSchema:
    def test_new_columns_exist(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'cluster_sampling_config'
              AND column_name IN ('stage1_count', 'stage2_count', 'pixels_per_stage2', 'starting_boundary_id')
        """)
        found = {row[0] for row in cursor.fetchall()}
        assert found == {'stage1_count', 'stage2_count', 'pixels_per_stage2', 'starting_boundary_id'}

    def test_old_columns_removed(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'cluster_sampling_config'
              AND column_name IN ('starting_pcode', 'upazila_count', 'unions_per_upazila', 'pixels_per_union')
        """)
        assert cursor.fetchall() == []

    def test_starting_boundary_id_references_admin_boundaries(self, db_conn):
        cursor = db_conn.cursor()
        cursor.execute("""
            SELECT ccu.table_name, ccu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'cluster_sampling_config'
              AND tc.constraint_type = 'FOREIGN KEY'
              AND kcu.column_name = 'starting_boundary_id'
        """)
        result = cursor.fetchone()
        assert result == ('admin_boundaries', 'id')
