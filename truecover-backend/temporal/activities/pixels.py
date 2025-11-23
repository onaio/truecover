# ABOUTME: Temporal activities for pixel generation operations
# ABOUTME: Generates quadkey pixels and creates default coverage records

from temporalio import activity
from typing import List, Dict, Any, Tuple
import mercantile

from db.connection import get_db_connection, return_db_connection


@activity.defn
async def convert_geojson_to_wkt(geometry: Dict[str, Any]) -> str:
    """
    Convert GeoJSON geometry to WKT format.

    Args:
        geometry: GeoJSON geometry dict

    Returns:
        WKT string representation
    """
    from shapely.geometry import shape
    from shapely import wkt as shapely_wkt

    try:
        geom = shape(geometry)
        wkt_string = shapely_wkt.dumps(geom)
        activity.logger.info(f"Converted GeoJSON to WKT: {geom.geom_type}")
        return wkt_string
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
async def delete_existing_pixels(area_id: str) -> int:
    """
    Delete existing pixels for an area.

    Args:
        area_id: Area ID

    Returns:
        Number of pixels deleted
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            DELETE FROM pixels WHERE area_id = %s
        """, (area_id,))

        deleted_count = cursor.rowcount
        conn.commit()

        activity.logger.info(f"Deleted {deleted_count} existing pixels for area {area_id}")
        return deleted_count
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def generate_tile_data(
    bbox: List[float],
    level: int,
    admin_geometry_wkt: str = None
) -> List[Dict[str, Any]]:
    """
    Generate tile data for the given bounding box.

    Args:
        bbox: [min_lng, min_lat, max_lng, max_lat]
        level: Zoom level
        admin_geometry_wkt: Optional admin boundary geometry WKT for filtering

    Returns:
        List of tile data with quadkey, geometry, and coordinates
    """
    min_lng, min_lat, max_lng, max_lat = bbox

    # Generate tiles using mercantile
    tiles = list(mercantile.tiles(min_lng, min_lat, max_lng, max_lat, zooms=[level]))

    activity.logger.info(f"Generated {len(tiles)} tiles at level {level}")

    # Convert tiles to data format with coordinates
    all_tiles = []
    for tile in tiles:
        quadkey = mercantile.quadkey(tile)
        bounds = mercantile.bounds(tile)

        # Calculate centroid
        centroid_lng = (bounds.west + bounds.east) / 2
        centroid_lat = (bounds.south + bounds.north) / 2

        # Create polygon geometry WKT
        geometry_wkt = f"POLYGON(({bounds.west} {bounds.south}, {bounds.west} {bounds.north}, {bounds.east} {bounds.north}, {bounds.east} {bounds.south}, {bounds.west} {bounds.south}))"

        all_tiles.append({
            "quadkey": quadkey,
            "geometry_wkt": geometry_wkt,
            "latitude": centroid_lat,
            "longitude": centroid_lng,
            "level": level
        })

    # Filter by admin boundary if provided (batch operation)
    if admin_geometry_wkt:
        conn = get_db_connection()
        cursor = conn.cursor()

        try:
            # Create temporary table with all tile centroids
            centroids = [(t["longitude"], t["latitude"], t["quadkey"]) for t in all_tiles]

            # Batch check which centroids are within the admin boundary
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

            # Get set of quadkeys that are within boundary
            valid_quadkeys = {row[0] for row in cursor.fetchall()}

            # Filter tiles to only those within boundary
            tile_data = [t for t in all_tiles if t["quadkey"] in valid_quadkeys]

            activity.logger.info(f"Filtered to {len(tile_data)} tiles after admin boundary check")
        finally:
            cursor.close()
            return_db_connection(conn)
    else:
        tile_data = all_tiles

    return tile_data


@activity.defn
async def insert_pixel_batch(
    area_id: str,
    batch: List[Dict[str, Any]]
) -> int:
    """
    Insert a batch of pixels into the database.

    Args:
        area_id: Area ID
        batch: List of tile data

    Returns:
        Number of pixels inserted
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Extract data into lists
        quadkeys = [p["quadkey"] for p in batch]
        area_ids = [area_id] * len(batch)
        geometries = [p["geometry_wkt"] for p in batch]
        latitudes = [p["latitude"] for p in batch]
        longitudes = [p["longitude"] for p in batch]
        levels = [p["level"] for p in batch]

        # Batch insert with admin boundary lookup
        cursor.execute("""
            WITH pixel_data AS (
                SELECT
                    unnest(%s::text[]) as quadkey,
                    unnest(%s::uuid[]) as area_id,
                    unnest(%s::text[]) as geometry_wkt,
                    unnest(%s::decimal[]) as latitude,
                    unnest(%s::decimal[]) as longitude,
                    unnest(%s::integer[]) as level
            ),
            pixels_with_admin AS (
                SELECT
                    pd.quadkey,
                    pd.area_id,
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
            INSERT INTO pixels (quadkey, area_id, geometry, latitude, longitude, level, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode)
            SELECT
                quadkey,
                area_id,
                ST_GeomFromText(geometry_wkt, 4326),
                latitude,
                longitude,
                level,
                adm1_pcode,
                adm2_pcode,
                adm3_pcode,
                adm4_pcode
            FROM pixels_with_admin
            ON CONFLICT (area_id, quadkey) DO UPDATE SET
                geometry = EXCLUDED.geometry,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                level = EXCLUDED.level,
                adm1_pcode = EXCLUDED.adm1_pcode,
                adm2_pcode = EXCLUDED.adm2_pcode,
                adm3_pcode = EXCLUDED.adm3_pcode,
                adm4_pcode = EXCLUDED.adm4_pcode,
                updated_at = NOW()
        """, (quadkeys, area_ids, geometries, latitudes, longitudes, levels))

        inserted_count = cursor.rowcount
        conn.commit()

        activity.logger.info(f"Inserted {inserted_count} pixels")
        return inserted_count
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def create_default_coverage_pixels_for_batch(
    area_id: str,
    quadkeys: List[str]
) -> int:
    """
    Create default coverage_pixel records for new pixels.

    Args:
        area_id: Area ID
        quadkeys: List of quadkeys

    Returns:
        Number of coverage_pixel records created
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        if not quadkeys:
            return 0

        # Get the project_id from the area
        cursor.execute("""
            SELECT project_id FROM areas WHERE id = %s
        """, (area_id,))

        area_row = cursor.fetchone()
        if not area_row or not area_row[0]:
            activity.logger.warning(f"No project found for area {area_id}")
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

        # Build list of records to create
        # Only create records for quadkey/indicator combos that don't exist
        cursor.execute("""
            SELECT DISTINCT quadkey, indicator_id
            FROM coverage_pixel
            WHERE quadkey = ANY(%s) AND area_id = %s
        """, (quadkeys, area_id))

        existing = {(row[0], str(row[1])) for row in cursor.fetchall()}

        records_to_create = []
        for quadkey in quadkeys:
            for indicator_row in indicators:
                indicator_id = str(indicator_row[0])
                if (quadkey, indicator_id) not in existing:
                    records_to_create.append((quadkey, area_id, indicator_id))

        # Batch insert new records
        if records_to_create:
            cursor.executemany("""
                INSERT INTO coverage_pixel (
                    quadkey, area_id, indicator_id, version,
                    n_trials, n_covered, rounds,
                    exceedance_probability, exceedance_uncertainty,
                    prevalence_bci_width, prevalence_prediction
                )
                VALUES (%s, %s, %s, 0, 0, 0, '{}', 0, 0, 0, 0)
            """, records_to_create)

            conn.commit()
            activity.logger.info(f"Created {len(records_to_create)} coverage_pixel records")
            return len(records_to_create)
        else:
            activity.logger.info("No new coverage_pixel records needed")
            return 0

    finally:
        cursor.close()
        return_db_connection(conn)
