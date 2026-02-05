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
async def fetch_and_insert_overture_buildings(
    campaign_id: str,
    bbox: Tuple[float, float, float, float],
    boundary_wkt: str,
    batch_size: int = 5000
) -> Dict[str, Any]:
    """
    Fetch buildings from Overture and insert directly to PostgreSQL.

    Combines fetch and insert in one activity to avoid passing large data through Temporal.
    """
    from routes.locations import calculate_quadkey
    from psycopg2.extras import execute_values

    activity.logger.info(f"Fetching and inserting buildings for campaign {campaign_id}")

    # Setup DuckDB connection for reading
    duckdb_con = duckdb.connect()
    duckdb_con.execute("INSTALL spatial; LOAD spatial;")
    duckdb_con.execute("SET s3_region='us-west-2';")

    # Setup PostgreSQL connection for writing
    pg_conn = get_db_connection()
    pg_cursor = pg_conn.cursor()

    total_fetched = 0
    total_inserted = 0
    total_duplicates = 0
    all_new_location_ids = []
    all_existing_location_ids = []

    try:
        # Query to get all buildings in one pass
        buildings_query = f"""
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

        # Stream results in batches
        offset = 0
        while True:
            paginated_query = f"({buildings_query}) LIMIT {batch_size} OFFSET {offset}"
            buildings = duckdb_con.execute(paginated_query).fetchall()

            if not buildings:
                break

            total_fetched += len(buildings)
            activity.logger.info(f"Fetched batch of {len(buildings)} buildings (total: {total_fetched})")

            # Process this batch directly to PostgreSQL
            batch_to_insert = []
            batch_duplicates = 0

            for building in buildings:
                overture_id, primary_name, height, num_floors, building_class, geometry_wkt, centroid_lng, centroid_lat = building

                if centroid_lat is None or centroid_lng is None:
                    continue

                # Check for duplicate by external_id (global — any campaign)
                pg_cursor.execute(
                    "SELECT id FROM locations WHERE external_id = %s",
                    (overture_id,)
                )
                existing = pg_cursor.fetchone()
                if existing:
                    all_existing_location_ids.append(str(existing[0]))
                    batch_duplicates += 1
                    continue

                # Calculate quadkey
                quadkey = calculate_quadkey(centroid_lat, centroid_lng)

                # Prepare properties
                properties = {
                    'overture_id': overture_id,
                    'class': building_class,
                    'height': height,
                    'num_floors': num_floors,
                    'primary_name': primary_name,
                    'source': 'overture_maps'
                }
                properties = {k: v for k, v in properties.items() if v is not None}

                batch_to_insert.append((
                    overture_id,
                    f"SRID=4326;{geometry_wkt}",
                    centroid_lat,
                    centroid_lng,
                    quadkey,
                    json.dumps(properties)
                ))

            total_duplicates += batch_duplicates

            # Batch insert to PostgreSQL
            if batch_to_insert:
                result = execute_values(pg_cursor, """
                    INSERT INTO locations (
                        external_id, geometry, latitude, longitude, quadkey, properties
                    )
                    VALUES %s
                    RETURNING id
                """, batch_to_insert,
                    template="(%s, ST_GeomFromText(%s), %s, %s, %s, %s)",
                    fetch=True)

                new_ids = [str(row[0]) for row in result]
                all_new_location_ids.extend(new_ids)
                total_inserted += len(new_ids)
                pg_conn.commit()

            activity.logger.info(f"Batch inserted: {len(batch_to_insert)}, duplicates: {batch_duplicates}")

            # Check if we got fewer than batch_size (end of data)
            if len(buildings) < batch_size:
                break

            offset += batch_size

        activity.logger.info(f"Complete: fetched={total_fetched}, inserted={total_inserted}, duplicates={total_duplicates}")

        return {
            'success': True,
            'total_fetched': total_fetched,
            'inserted': total_inserted,
            'duplicates': total_duplicates,
            'new_location_ids': all_new_location_ids,
            'existing_location_ids': all_existing_location_ids
        }

    except Exception as e:
        pg_conn.rollback()
        activity.logger.error(f"Error in fetch_and_insert: {e}")
        raise

    finally:
        duckdb_con.close()
        pg_cursor.close()
        return_db_connection(pg_conn)


@activity.defn
async def update_campaign_area_building_counts(campaign_id: str) -> Dict[str, int]:
    """
    Update cached_building_count for all campaign areas in a campaign.

    Counts locations within each area's admin boundary geometry.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Update building counts for all campaign areas in this campaign
        # Uses spatial intersection with admin boundary geometry
        cursor.execute("""
            UPDATE campaign_areas ca
            SET cached_building_count = COALESCE(counts.building_count, 0)
            FROM (
                SELECT
                    ca2.id as area_id,
                    COUNT(DISTINCT l.id) as building_count
                FROM campaign_areas ca2
                LEFT JOIN pixel_area pa ON pa.campaign_area_id = ca2.id
                LEFT JOIN locations l ON l.quadkey = pa.quadkey
                WHERE ca2.campaign_id = %s
                GROUP BY ca2.id
            ) counts
            WHERE ca.id = counts.area_id
        """, (campaign_id,))

        updated = cursor.rowcount
        conn.commit()

        activity.logger.info(f"Updated building counts for {updated} campaign areas")

        return {'areas_updated': updated}

    except Exception as e:
        conn.rollback()
        activity.logger.error(f"Error updating building counts: {e}")
        raise

    finally:
        cursor.close()
        return_db_connection(conn)
