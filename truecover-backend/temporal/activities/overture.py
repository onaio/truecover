# ABOUTME: Temporal activities for Overture Maps building imports
# ABOUTME: Handles DuckDB queries and building processing for location import

import duckdb
import json
import os
from temporalio import activity
from typing import List, Dict, Any, Tuple
from db.connection import get_db_connection, return_db_connection

OVERTURE_BUILDINGS_PATH = os.getenv(
    'OVERTURE_BUILDINGS_PATH',
    'az://overturemapswestus2.blob.core.windows.net/release/2025-10-22.0/theme=buildings/type=building/*'
)


@activity.defn
async def fetch_admin_boundary(pcode: str) -> Dict[str, Any]:
    """Fetch admin boundary bbox and geometry for the given PCODE."""
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                ST_XMin(geometry) as min_lng,
                ST_YMin(geometry) as min_lat,
                ST_XMax(geometry) as max_lng,
                ST_YMax(geometry) as max_lat,
                ST_AsText(geometry) as geometry_wkt
            FROM admin_boundaries
            WHERE adm0_pcode = %s OR adm1_pcode = %s OR adm2_pcode = %s
               OR adm3_pcode = %s OR adm4_pcode = %s
            LIMIT 1
        """, (pcode, pcode, pcode, pcode, pcode))

        result = cursor.fetchone()
        if not result:
            raise ValueError(f'Admin boundary not found for PCODE: {pcode}')

        bbox = (result[0], result[1], result[2], result[3])
        boundary_wkt = result[4]

        activity.logger.info(f"Fetched boundary for {pcode}: bbox={bbox}")

        return {
            'bbox': bbox,
            'boundary_wkt': boundary_wkt
        }

    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def fetch_overture_buildings_batch(
    bbox: Tuple[float, float, float, float],
    boundary_wkt: str,
    offset: int,
    batch_size: int
) -> List[Dict[str, Any]]:
    """Fetch a batch of buildings from Overture Maps using DuckDB."""

    activity.logger.info(f"Fetching buildings batch: offset={offset}, batch_size={batch_size}")

    # Setup DuckDB connection
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")

    try:
        # Base query for buildings
        base_buildings_query = f"""
            SELECT
                id,
                names.primary as primary_name,
                height,
                num_floors,
                class,
                ST_AsText(geometry) as geometry_wkt,
                ST_X(ST_Centroid(geometry)) as centroid_lng,
                ST_Y(ST_Centroid(geometry)) as centroid_lat
            FROM read_parquet('{OVERTURE_BUILDINGS_PATH}', hive_partitioning=1)
            WHERE bbox.xmin BETWEEN {bbox[0]} AND {bbox[2]}
              AND bbox.ymin BETWEEN {bbox[1]} AND {bbox[3]}
              AND ST_Within(geometry, ST_GeomFromText('{boundary_wkt}'))
        """

        # Add pagination
        paginated_query = f"({base_buildings_query}) LIMIT {batch_size} OFFSET {offset}"
        buildings = con.execute(paginated_query).fetchall()

        activity.logger.info(f"Fetched {len(buildings)} buildings from Overture")

        # Convert to dict format
        result = []
        for building in buildings:
            overture_id, primary_name, height, num_floors, building_class, geometry_wkt, centroid_lng, centroid_lat = building

            # Prepare properties
            properties = {
                'overture_id': overture_id,
                'class': building_class,
                'height': height,
                'num_floors': num_floors,
                'primary_name': primary_name,
                'source': 'overture_maps'
            }
            # Remove None values
            properties = {k: v for k, v in properties.items() if v is not None}

            result.append({
                'overture_id': overture_id,
                'geometry_wkt': geometry_wkt,
                'latitude': centroid_lat,
                'longitude': centroid_lng,
                'properties': properties
            })

        return result

    finally:
        con.close()


@activity.defn
async def process_overture_buildings_batch(
    area_id: str,
    buildings: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Process a batch of Overture buildings - insert locations with deduplication."""
    from routes.locations import calculate_quadkey
    from psycopg2.extras import execute_values

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        activity.logger.info(f"Processing batch of {len(buildings)} buildings")

        batch_to_insert = []
        duplicates = 0

        for building in buildings:
            try:
                overture_id = building['overture_id']
                geometry_wkt = building['geometry_wkt']
                lat = building['latitude']
                lng = building['longitude']
                properties = building['properties']

                if lat is None or lng is None:
                    continue

                # Check for duplicate by external_id
                cursor.execute(
                    "SELECT id FROM locations WHERE area_id = %s AND external_id = %s",
                    (area_id, overture_id)
                )
                if cursor.fetchone():
                    duplicates += 1
                    continue

                # Calculate quadkey
                quadkey = calculate_quadkey(lat, lng)

                # Add to batch
                batch_to_insert.append((
                    area_id,
                    overture_id,  # external_id
                    f"SRID=4326;{geometry_wkt}",
                    lat,
                    lng,
                    quadkey,
                    json.dumps(properties)
                ))

            except Exception as e:
                activity.logger.error(f"Error preparing building {overture_id}: {e}")
                continue

        # Batch insert locations
        new_location_ids = []
        if batch_to_insert:
            result = execute_values(cursor, """
                INSERT INTO locations (
                    area_id, external_id, geometry, latitude, longitude, quadkey, properties
                )
                VALUES %s
                RETURNING id
            """, batch_to_insert,
                template="(%s, %s, ST_GeomFromText(%s), %s, %s, %s, %s)",
                fetch=True)

            new_location_ids = [str(row[0]) for row in result]
            conn.commit()

        activity.logger.info(f"Batch complete: inserted={len(new_location_ids)}, duplicates={duplicates}")

        return {
            'inserted': len(new_location_ids),
            'duplicates': duplicates,
            'new_location_ids': new_location_ids,
            'errors': []
        }

    except Exception as e:
        conn.rollback()
        activity.logger.error(f"Error processing batch: {e}")
        raise

    finally:
        cursor.close()
        return_db_connection(conn)
