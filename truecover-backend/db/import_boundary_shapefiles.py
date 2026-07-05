# ABOUTME: Imports Bangladesh district (block-level) and city corporation (ward-level) shapefiles
# ABOUTME: Attaches new ward/block/city_corporation/zone rows under existing admin_boundaries rows

import os
import sys
from pathlib import Path
import geopandas as gpd
from typing import Dict, Any
from db.boundary_name_matching import find_district_id, find_upazila_id, find_union_id
from db.connection import get_db_connection, return_db_connection


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

    for (thaname, uniname), union_rows in gdf.groupby(['THANAME', 'UNINAME']):
        cache_key = (thaname, uniname)
        if cache_key not in union_id_cache:
            distname = union_rows.iloc[0]['DISTNAME']
            district_id = find_district_id(cursor, distname)
            upazila_id = find_upazila_id(cursor, district_id, thaname) if district_id else None
            union_id = find_union_id(cursor, upazila_id, uniname) if upazila_id else None
            union_id_cache[cache_key] = union_id

        union_id = union_id_cache[cache_key]
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


def import_city_corporation(shp_path: str, conn) -> Dict[str, int]:
    gdf = gpd.read_file(shp_path)
    cursor = conn.cursor()

    ccname = gdf.iloc[0]['CCNAME']
    distname = gdf.iloc[0]['DISTNAME']
    district_id = find_district_id(cursor, distname)
    if district_id is None:
        return {'city_corporations_created': 0, 'zones_created': 0, 'wards_created': 0}

    cc_geometry_wkt = gdf.geometry.union_all().wkt
    cc_id, cc_created = _upsert_boundary(
        cursor, ccname, 3, district_id, 'city_corporation', cc_geometry_wkt
    )

    zones_created = 0
    wards_created = 0

    for zonename, zone_rows in gdf.groupby('ZONENAME'):
        zone_geometry_wkt = zone_rows.geometry.union_all().wkt
        zone_id, zone_was_created = _upsert_boundary(
            cursor, zonename, 4, cc_id, 'zone', zone_geometry_wkt
        )
        if zone_was_created:
            zones_created += 1

        for _, ward_row in zone_rows.iterrows():
            _, ward_was_created = _upsert_boundary(
                cursor, ward_row['WARDNAME'], 5, zone_id, 'ward',
                ward_row.geometry.wkt, source_code=ward_row['ward_geoc']
            )
            if ward_was_created:
                wards_created += 1

    return {
        'city_corporations_created': 1 if cc_created else 0,
        'zones_created': zones_created,
        'wards_created': wards_created,
    }


def run_import(data_dir: str, conn) -> None:
    districts_root = Path(data_dir) / "Districts"
    for shp_path in sorted(districts_root.glob("*/*.shp")):
        result = import_rural_district(str(shp_path), conn)
        conn.commit()
        print(f"{shp_path.stem}: {result['wards_created']} wards, {result['blocks_created']} blocks created")
        if result['unmatched_unions']:
            print(f"  Unmatched unions (skipped, needs manual review): {result['unmatched_unions']}")
        if result['low_overlap_wards']:
            print(f"  Low geometry overlap with matched union (inserted anyway, needs manual review): {result['low_overlap_wards']}")

    cc_root = Path(data_dir) / "City corporations"
    for shp_path in sorted(cc_root.glob("*/*.shp")):
        result = import_city_corporation(str(shp_path), conn)
        conn.commit()
        print(f"{shp_path.stem}: {result['zones_created']} zones, {result['wards_created']} wards created")


if __name__ == "__main__":
    default_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "data", "new")
    data_dir = sys.argv[1] if len(sys.argv) > 1 else default_dir

    conn = get_db_connection()
    try:
        print(f"Importing boundary shapefiles from: {data_dir}")
        run_import(data_dir, conn)
    finally:
        return_db_connection(conn)
