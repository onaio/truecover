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


class TestGetChildrenForBoundaryIds:
    def test_merges_parent_id_and_pcode_children(self, db_conn, monkeypatch):
        from temporal.activities import cluster_sampling
        from temporal.activities.cluster_sampling import get_children_for_boundary_ids
        import asyncio

        monkeypatch.setattr(cluster_sampling, 'get_db_connection', lambda: db_conn)
        monkeypatch.setattr(cluster_sampling, 'return_db_connection', lambda conn: None)

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm2_pcode, boundary_type)
            VALUES ('Test District GCFBI', 'BD', 2, 'BDGCFBI', 'district')
            RETURNING id
        """)
        district_id = str(cursor.fetchone()[0])

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, adm2_pcode, adm3_pcode, boundary_type)
            VALUES ('Test Upazila GCFBI', 'BD', 3, 'BDGCFBI', 'BDGCFBI01', 'upazila')
        """)

        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type)
            VALUES ('Test City Corp GCFBI', 'BD', 3, %s, 'city_corporation')
        """, (district_id,))

        result = asyncio.get_event_loop().run_until_complete(
            get_children_for_boundary_ids([district_id], {'high_risk': [district_id]})
        )

        children = result[district_id]['children']
        names = {c['name'] for c in children}
        assert names == {'Test Upazila GCFBI', 'Test City Corp GCFBI'}
        assert result[district_id]['category'] == 'high_risk'

        upazila_child = next(c for c in children if c['name'] == 'Test Upazila GCFBI')
        cc_child = next(c for c in children if c['name'] == 'Test City Corp GCFBI')
        assert upazila_child['pcode'] == 'BDGCFBI01'
        assert cc_child['pcode'] is None
        assert 'id' in upazila_child and 'id' in cc_child

    def test_no_children_returns_empty_list(self, db_conn, monkeypatch):
        from temporal.activities import cluster_sampling
        from temporal.activities.cluster_sampling import get_children_for_boundary_ids
        import asyncio

        monkeypatch.setattr(cluster_sampling, 'get_db_connection', lambda: db_conn)
        monkeypatch.setattr(cluster_sampling, 'return_db_connection', lambda conn: None)

        cursor = db_conn.cursor()
        cursor.execute("""
            INSERT INTO admin_boundaries (name, iso3, level, boundary_type)
            VALUES ('Test Leaf GCFBI', 'BD', 5, 'ward') RETURNING id
        """)
        leaf_id = str(cursor.fetchone()[0])

        result = asyncio.get_event_loop().run_until_complete(
            get_children_for_boundary_ids([leaf_id], {})
        )
        assert result[leaf_id]['children'] == []
