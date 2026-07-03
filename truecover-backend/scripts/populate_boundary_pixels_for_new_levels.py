# ABOUTME: Populates admin_boundary_pixels for new ward/block/zone/city_corporation rows
# ABOUTME: Leaf rows (no boundary_type children) get a spatial join; ancestors get a bottom-up union

def populate_pixels_for_leaf_boundaries(conn, boundary_ids: list = None) -> int:
    cursor = conn.cursor()
    query = """
        SELECT ab.id FROM admin_boundaries ab
        WHERE ab.boundary_type IN ('ward', 'block')
          AND NOT EXISTS (SELECT 1 FROM admin_boundaries child WHERE child.parent_id = ab.id)
          AND NOT EXISTS (SELECT 1 FROM admin_boundary_pixels abp WHERE abp.admin_boundary_id = ab.id)
    """
    params = []
    if boundary_ids is not None:
        query += " AND ab.id = ANY(%s::uuid[])"
        params.append(boundary_ids)
    cursor.execute(query, params)
    leaf_ids = [str(row[0]) for row in cursor.fetchall()]

    total = 0
    for leaf_id in leaf_ids:
        cursor.execute("""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey)
            SELECT %s, p.quadkey
            FROM pixels p
            JOIN admin_boundaries ab ON ab.id = %s
            WHERE ST_Intersects(p.geometry, ab.geometry)
            ON CONFLICT (admin_boundary_id, quadkey) DO NOTHING
        """, (leaf_id, leaf_id))
        total += cursor.rowcount

    return total


def roll_up_pixels_to_ancestors(conn, boundary_ids: list = None) -> int:
    cursor = conn.cursor()
    query = """
        SELECT id FROM admin_boundaries
        WHERE boundary_type IN ('zone', 'city_corporation', 'ward')
          AND EXISTS (SELECT 1 FROM admin_boundaries child WHERE child.parent_id = admin_boundaries.id)
    """
    params = []
    if boundary_ids is not None:
        query += " AND id = ANY(%s::uuid[])"
        params.append(boundary_ids)
    query += " ORDER BY level DESC"
    cursor.execute(query, params)
    ancestor_ids = [str(row[0]) for row in cursor.fetchall()]

    total = 0
    for ancestor_id in ancestor_ids:
        cursor.execute("""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey)
            SELECT %s, abp.quadkey
            FROM admin_boundary_pixels abp
            JOIN admin_boundaries child ON child.id = abp.admin_boundary_id
            WHERE child.parent_id = %s
            ON CONFLICT (admin_boundary_id, quadkey) DO NOTHING
        """, (ancestor_id, ancestor_id))
        total += cursor.rowcount

    return total


if __name__ == "__main__":
    from db.connection import get_db_connection, return_db_connection

    conn = get_db_connection()
    try:
        leaf_count = populate_pixels_for_leaf_boundaries(conn)
        conn.commit()
        print(f"Populated {leaf_count} leaf pixel mappings")
        rollup_count = roll_up_pixels_to_ancestors(conn)
        conn.commit()
        print(f"Rolled up {rollup_count} ancestor pixel mappings")
    finally:
        return_db_connection(conn)
