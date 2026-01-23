# ABOUTME: Temporal activities for pixel generation operations
# ABOUTME: Generates quadkey pixels and creates default coverage records

from temporalio import activity
from typing import List, Dict, Any
import mercantile

from db.connection import get_db_connection, return_db_connection


@activity.defn
async def convert_geojson_to_wkt(geometry: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert GeoJSON geometry to WKT format and calculate bounding box.

    Args:
        geometry: GeoJSON geometry dict

    Returns:
        Dict with 'wkt' (string) and 'bbox' (tuple of minx, miny, maxx, maxy)
    """
    from shapely.geometry import shape
    from shapely import wkt as shapely_wkt

    try:
        geom = shape(geometry)
        wkt_string = shapely_wkt.dumps(geom)
        bbox = geom.bounds  # (minx, miny, maxx, maxy)
        activity.logger.info(f"Converted GeoJSON to WKT: {geom.geom_type}, bbox={bbox}")
        return {
            'wkt': wkt_string,
            'bbox': bbox
        }
    except Exception as e:
        activity.logger.error(f"Failed to convert geometry to WKT: {e}")
        raise


@activity.defn
async def fetch_admin_boundary_geometry(admin_pcode: str) -> str:
    """
    Fetch admin boundary geometry for filtering pixels.

    Args:
        admin_pcode: Admin boundary code

    Returns:
        PostGIS geometry WKT string
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT ST_AsText(geometry)
            FROM admin_boundaries
            WHERE adm0_pcode = %s
               OR adm1_pcode = %s
               OR adm2_pcode = %s
               OR adm3_pcode = %s
               OR adm4_pcode = %s
            LIMIT 1
        """, (admin_pcode, admin_pcode, admin_pcode, admin_pcode, admin_pcode))

        result = cursor.fetchone()
        if not result:
            raise ValueError(f"Admin boundary with pcode {admin_pcode} not found")

        activity.logger.info(f"Fetched admin boundary geometry for {admin_pcode}")
        return result[0]
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def delete_existing_pixels(campaign_id: str) -> int:
    """
    Delete existing pixels for an area.

    Args:
        campaign_id: Area ID

    Returns:
        Number of pixels deleted
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            DELETE FROM pixels WHERE campaign_id = %s
        """, (campaign_id,))

        deleted_count = cursor.rowcount
        conn.commit()

        activity.logger.info(f"Deleted {deleted_count} existing pixels for area {campaign_id}")
        return deleted_count
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def generate_and_insert_tiles(
    campaign_id: str,
    bbox: List[float],
    level: int,
    admin_geometry_wkt: str = None
) -> Dict[str, Any]:
    """
    Generate tiles for the given bounding box and insert them directly into the database.

    This activity handles both generation and insertion to avoid passing large tile
    data through Temporal's payload system, which has a ~2MB size limit.

    Args:
        campaign_id: Area ID to associate pixels with
        bbox: [min_lng, min_lat, max_lng, max_lat]
        level: Zoom level
        admin_geometry_wkt: Optional admin boundary geometry WKT for filtering

    Returns:
        Summary dict with total_generated and total_inserted counts
    """
    min_lng, min_lat, max_lng, max_lat = bbox

    # Generate tiles using mercantile
    tiles = list(mercantile.tiles(min_lng, min_lat, max_lng, max_lat, zooms=[level]))
    total_generated = len(tiles)

    activity.logger.info(f"Generated {total_generated} tiles at level {level}")

    if total_generated == 0:
        return {"total_generated": 0, "total_inserted": 0}

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Process tiles in batches to manage memory and transaction size
        batch_size = 500
        total_inserted = 0

        for batch_start in range(0, len(tiles), batch_size):
            batch_tiles = tiles[batch_start:batch_start + batch_size]

            # Convert batch tiles to data format
            batch_data = []
            for tile in batch_tiles:
                quadkey = mercantile.quadkey(tile)
                bounds = mercantile.bounds(tile)

                centroid_lng = (bounds.west + bounds.east) / 2
                centroid_lat = (bounds.south + bounds.north) / 2

                geometry_wkt = f"POLYGON(({bounds.west} {bounds.south}, {bounds.west} {bounds.north}, {bounds.east} {bounds.north}, {bounds.east} {bounds.south}, {bounds.west} {bounds.south}))"

                batch_data.append({
                    "quadkey": quadkey,
                    "geometry_wkt": geometry_wkt,
                    "latitude": centroid_lat,
                    "longitude": centroid_lng,
                    "level": level
                })

            # Filter by admin boundary if provided
            if admin_geometry_wkt:
                centroids = [(t["longitude"], t["latitude"], t["quadkey"]) for t in batch_data]

                cursor.execute("""
                    WITH tile_points AS (
                        SELECT
                            unnest(%s::decimal[]) as lng,
                            unnest(%s::decimal[]) as lat,
                            unnest(%s::text[]) as quadkey
                    )
                    SELECT quadkey
                    FROM tile_points
                    WHERE ST_Contains(
                        ST_GeomFromText(%s, 4326),
                        ST_SetSRID(ST_MakePoint(lng, lat), 4326)
                    )
                """, (
                    [c[0] for c in centroids],
                    [c[1] for c in centroids],
                    [c[2] for c in centroids],
                    admin_geometry_wkt
                ))

                valid_quadkeys = {row[0] for row in cursor.fetchall()}
                batch_data = [t for t in batch_data if t["quadkey"] in valid_quadkeys]

            if not batch_data:
                continue

            # Insert batch into database
            quadkeys = [p["quadkey"] for p in batch_data]
            campaign_ids = [campaign_id] * len(batch_data)
            geometries = [p["geometry_wkt"] for p in batch_data]
            latitudes = [p["latitude"] for p in batch_data]
            longitudes = [p["longitude"] for p in batch_data]
            levels = [p["level"] for p in batch_data]

            cursor.execute("""
                WITH pixel_data AS (
                    SELECT
                        unnest(%s::text[]) as quadkey,
                        unnest(%s::uuid[]) as campaign_id,
                        unnest(%s::text[]) as geometry_wkt,
                        unnest(%s::decimal[]) as latitude,
                        unnest(%s::decimal[]) as longitude,
                        unnest(%s::integer[]) as level
                ),
                pixels_with_admin AS (
                    SELECT
                        pd.quadkey,
                        pd.campaign_id,
                        pd.geometry_wkt,
                        pd.latitude,
                        pd.longitude,
                        pd.level,
                        ab.adm1_pcode,
                        ab.adm2_pcode,
                        ab.adm3_pcode,
                        ab.adm4_pcode
                    FROM pixel_data pd
                    LEFT JOIN LATERAL (
                        SELECT adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
                        FROM admin_boundaries
                        WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint(pd.longitude, pd.latitude), 4326))
                        ORDER BY level DESC
                        LIMIT 1
                    ) ab ON true
                )
                INSERT INTO pixels (quadkey, campaign_id, geometry, latitude, longitude, level, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode)
                SELECT
                    quadkey,
                    campaign_id,
                    ST_GeomFromText(geometry_wkt, 4326),
                    latitude,
                    longitude,
                    level,
                    adm1_pcode,
                    adm2_pcode,
                    adm3_pcode,
                    adm4_pcode
                FROM pixels_with_admin
                ON CONFLICT (campaign_id, quadkey) DO UPDATE SET
                    geometry = EXCLUDED.geometry,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    level = EXCLUDED.level,
                    adm1_pcode = EXCLUDED.adm1_pcode,
                    adm2_pcode = EXCLUDED.adm2_pcode,
                    adm3_pcode = EXCLUDED.adm3_pcode,
                    adm4_pcode = EXCLUDED.adm4_pcode,
                    updated_at = NOW()
            """, (quadkeys, campaign_ids, geometries, latitudes, longitudes, levels))

            total_inserted += cursor.rowcount
            conn.commit()

            batch_num = batch_start // batch_size + 1
            total_batches = (len(tiles) + batch_size - 1) // batch_size
            activity.logger.info(f"Inserted batch {batch_num}/{total_batches}: {cursor.rowcount} pixels")

        activity.logger.info(f"Completed: generated {total_generated}, inserted {total_inserted} pixels")
        return {"total_generated": total_generated, "total_inserted": total_inserted}

    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def create_default_coverage_pixels_for_area(campaign_id: str) -> int:
    """
    Create default coverage_pixel records for all pixels in an area.

    Queries the database for quadkeys to avoid passing large lists through Temporal.

    Args:
        campaign_id: Area ID

    Returns:
        Number of coverage_pixel records created
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get the project_id from the area
        cursor.execute("""
            SELECT project_id FROM areas WHERE id = %s
        """, (campaign_id,))

        area_row = cursor.fetchone()
        if not area_row or not area_row[0]:
            activity.logger.warning(f"No project found for area {campaign_id}")
            return 0

        project_id = area_row[0]

        # Get all indicators for this project
        cursor.execute("""
            SELECT id FROM indicators WHERE project_id = %s
        """, (project_id,))

        indicators = cursor.fetchall()

        if not indicators:
            activity.logger.info(f"No indicators found for project {project_id}")
            return 0

        indicator_ids = [str(row[0]) for row in indicators]

        # Insert coverage_pixel records for all pixel/indicator combinations
        # that don't already exist, using a single efficient query
        cursor.execute("""
            INSERT INTO coverage_pixel (
                quadkey, campaign_id, indicator_id, version,
                n_trials, n_covered, rounds,
                exceedance_probability, exceedance_uncertainty,
                prevalence_bci_width, prevalence_prediction
            )
            SELECT
                p.quadkey,
                p.campaign_id,
                i.indicator_id,
                0, 0, 0, '{}', 0, 0, 0, 0
            FROM pixels p
            CROSS JOIN (SELECT unnest(%s::uuid[]) as indicator_id) i
            WHERE p.campaign_id = %s
            ON CONFLICT (campaign_id, quadkey, indicator_id) DO NOTHING
        """, (indicator_ids, campaign_id))

        created_count = cursor.rowcount
        conn.commit()

        activity.logger.info(f"Created {created_count} coverage_pixel records for area {campaign_id}")
        return created_count

    finally:
        cursor.close()
        return_db_connection(conn)
