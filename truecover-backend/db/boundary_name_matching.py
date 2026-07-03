# ABOUTME: Resolves shapefile district/upazila/union names against existing admin_boundaries rows
# ABOUTME: Handles the small set of districts renamed since the BBS pcode data was generated

from typing import Optional

DISTRICT_NAME_ALIASES = {
    'Chattogram': 'Chittagong',
    'Bogura': 'Bogra',
    'Moulvibazar': 'Maulvibazar',
}


def find_district_id(cursor, distname: str) -> Optional[str]:
    cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = %s", (distname,))
    row = cursor.fetchone()
    if row:
        return str(row[0])

    alias = DISTRICT_NAME_ALIASES.get(distname)
    if alias:
        cursor.execute("SELECT id FROM admin_boundaries WHERE level = 2 AND name = %s", (alias,))
        row = cursor.fetchone()
        if row:
            return str(row[0])

    return None


def find_upazila_id(cursor, district_id: str, thaname: str) -> Optional[str]:
    cursor.execute("""
        SELECT id FROM admin_boundaries
        WHERE level = 3 AND name = %s
          AND adm2_pcode = (SELECT adm2_pcode FROM admin_boundaries WHERE id = %s)
    """, (thaname, district_id))
    row = cursor.fetchone()
    return str(row[0]) if row else None


def find_union_id(cursor, upazila_id: str, uniname: str) -> Optional[str]:
    cursor.execute("""
        SELECT id FROM admin_boundaries
        WHERE level = 4 AND name = %s
          AND adm3_pcode = (SELECT adm3_pcode FROM admin_boundaries WHERE id = %s)
    """, (uniname, upazila_id))
    row = cursor.fetchone()
    return str(row[0]) if row else None
