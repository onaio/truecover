# ABOUTME: Imports Bangladesh district (block-level) and city corporation (ward-level) shapefiles
# ABOUTME: Attaches new ward/block/city_corporation/zone rows under existing admin_boundaries rows

import geopandas as gpd
from typing import Dict, Any
from db.boundary_name_matching import find_district_id, find_upazila_id, find_union_id


def _upsert_boundary(cursor, name, level, parent_id, boundary_type, geometry_wkt, source_code=None):
    if source_code is not None:
        # source_code (e.g. block_geoc) is the true unique identifier; org_name can repeat
        # across blocks within the same ward, so name alone isn't a safe dedup key here.
        cursor.execute("""
            SELECT id FROM admin_boundaries WHERE parent_id = %s AND boundary_type = %s AND source_code = %s
        """, (parent_id, boundary_type, source_code))
    else:
        cursor.execute("""
            SELECT id FROM admin_boundaries WHERE parent_id = %s AND name = %s AND boundary_type = %s
        """, (parent_id, name, boundary_type))
    existing = cursor.fetchone()
    if existing:
        return str(existing[0]), False

    cursor.execute("""
        INSERT INTO admin_boundaries (name, iso3, level, parent_id, boundary_type, source_code, geometry)
        VALUES (%s, 'BD', %s, %s, %s, %s, ST_GeomFromText(%s, 4326))
        RETURNING id
    """, (name, level, parent_id, boundary_type, source_code, geometry_wkt))
    return str(cursor.fetchone()[0]), True


def _overlap_ratio(cursor, candidate_geometry_wkt, existing_boundary_id) -> float:
    """Fraction of candidate_geometry_wkt's area that falls inside the existing boundary's geometry."""
    cursor.execute("""
        SELECT
            CASE WHEN ST_Area(candidate.geom) = 0 THEN 0
                 ELSE ST_Area(ST_Intersection(candidate.geom, ab.geometry)) / ST_Area(candidate.geom)
            END
        FROM admin_boundaries ab, (SELECT ST_GeomFromText(%s, 4326) as geom) candidate
        WHERE ab.id = %s
    """, (candidate_geometry_wkt, existing_boundary_id))
    return float(cursor.fetchone()[0])


def import_rural_district(shp_path: str, conn) -> Dict[str, Any]:
    gdf = gpd.read_file(shp_path)
    cursor = conn.cursor()

    wards_created = 0
    blocks_created = 0
    unmatched_unions = []
    low_overlap_wards = []
    union_id_cache = {}

    for uniname, union_rows in gdf.groupby('UNINAME'):
        if uniname not in union_id_cache:
            distname = union_rows.iloc[0]['DISTNAME']
            thaname = union_rows.iloc[0]['THANAME']
            district_id = find_district_id(cursor, distname)
            upazila_id = find_upazila_id(cursor, district_id, thaname) if district_id else None
            union_id = find_union_id(cursor, upazila_id, uniname) if upazila_id else None
            union_id_cache[uniname] = union_id

        union_id = union_id_cache[uniname]
        if union_id is None:
            unmatched_unions.append(uniname)
            continue

        for wardname, ward_rows in union_rows.groupby('WARDNAME'):
            ward_geometry_wkt = ward_rows.geometry.union_all().wkt

            if _overlap_ratio(cursor, ward_geometry_wkt, union_id) < 0.5:
                low_overlap_wards.append(wardname)

            ward_id, ward_was_created = _upsert_boundary(
                cursor, wardname, 5, union_id, 'ward', ward_geometry_wkt
            )
            if ward_was_created:
                wards_created += 1

            for _, block_row in ward_rows.iterrows():
                _, block_was_created = _upsert_boundary(
                    cursor, block_row['org_name'], 6, ward_id, 'block',
                    block_row.geometry.wkt, source_code=block_row['block_geoc']
                )
                if block_was_created:
                    blocks_created += 1

    return {
        'wards_created': wards_created,
        'blocks_created': blocks_created,
        'unmatched_unions': unmatched_unions,
        'low_overlap_wards': low_overlap_wards,
    }
