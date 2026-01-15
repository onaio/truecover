# ABOUTME: API endpoints for admin boundary queries
# ABOUTME: Provides geometric info like bounding boxes for admin areas by PCODE

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection
from temporal.client import get_temporal_client, run_async
from temporal.workflows.overture_import import OvertureImportWorkflow
from temporalio.client import WorkflowExecutionStatus
import asyncio
import json
import duckdb
import time
import os
from datetime import datetime

admin_boundaries_bp = Blueprint('admin_boundaries', __name__)

OVERTURE_BUILDINGS_PATH = os.getenv(
    'OVERTURE_BUILDINGS_PATH',
    'az://overturemapswestus2.blob.core.windows.net/release/2025-10-22.0/theme=buildings/type=building/*'
)


def find_duplicate_by_external_id(cursor, area_id, external_id):
    """Check if location exists by external_id only (for Overture imports)"""
    if not external_id:
        return None
    cursor.execute("""
        SELECT id FROM locations
        WHERE area_id = %s AND external_id = %s
        LIMIT 1
    """, (area_id, external_id))
    result = cursor.fetchone()
    return str(result[0]) if result else None


@admin_boundaries_bp.route('/api/admin-boundaries/<pcode>/bounds', methods=['GET'])
@require_auth
def get_admin_boundary_bounds(user, pcode):
    """Get bounding box and metadata for an admin boundary by its PCODE"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Query admin_boundaries table for this PCODE
        # Check all PCODE columns since we don't know the level
        cursor.execute("""
            SELECT
                name,
                level,
                ST_XMin(geometry) as min_lng,
                ST_YMin(geometry) as min_lat,
                ST_XMax(geometry) as max_lng,
                ST_YMax(geometry) as max_lat
            FROM admin_boundaries
            WHERE adm0_pcode = %s
               OR adm1_pcode = %s
               OR adm2_pcode = %s
               OR adm3_pcode = %s
               OR adm4_pcode = %s
            LIMIT 1
        """, (pcode, pcode, pcode, pcode, pcode))

        result = cursor.fetchone()

        if not result:
            return jsonify({'error': f'Admin boundary not found for PCODE: {pcode}'}), 404

        return jsonify({
            'name': result[0],
            'level': result[1],
            'bbox': [result[2], result[3], result[4], result[5]]  # [minLng, minLat, maxLng, maxLat]
        }), 200

    except Exception as e:
        print(f"Error fetching admin boundary bounds: {e}")
        return jsonify({'error': 'Failed to fetch admin boundary bounds'}), 500
    finally:
        if conn:
            return_db_connection(conn)


@admin_boundaries_bp.route('/api/admin-boundaries/<pcode>/pixel-summary', methods=['GET'])
@require_auth
def get_pixel_summary(user, pcode):
    """Get population summary for pixels in an admin boundary by PCODE and area_id"""
    area_id = request.args.get('area_id')

    if not area_id:
        return jsonify({'error': 'area_id parameter is required'}), 400

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Query pixels filtered by pcode and area_id, joined with pixel_metadata
        cursor.execute("""
            SELECT
                COUNT(p.quadkey) as pixel_count,
                COALESCE(SUM((pm.metadata->>'population')::numeric), 0) as total_population,
                COALESCE(AVG((pm.metadata->>'population')::numeric), 0) as avg_population,
                COUNT(CASE WHEN pm.metadata->>'population' IS NOT NULL THEN 1 END) as pixels_with_data
            FROM pixels p
            LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
            WHERE p.area_id = %s
              AND (p.adm1_pcode = %s OR p.adm2_pcode = %s OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
        """, (area_id, pcode, pcode, pcode, pcode))

        result = cursor.fetchone()

        if not result or result[0] == 0:
            return jsonify({
                'pixel_count': 0,
                'total_population': 0,
                'avg_population': 0,
                'pixels_with_data': 0
            }), 200

        return jsonify({
            'pixel_count': int(result[0]),
            'total_population': float(result[1]) if result[1] is not None else 0,
            'avg_population': float(result[2]) if result[2] is not None else 0,
            'pixels_with_data': int(result[3])
        }), 200

    except Exception as e:
        print(f"Error fetching pixel summary: {e}")
        return jsonify({'error': 'Failed to fetch pixel summary'}), 500
    finally:
        if conn:
            return_db_connection(conn)


@admin_boundaries_bp.route('/api/admin-boundaries/<pcode>/preview-overture-buildings', methods=['POST'])
@require_auth
def preview_overture_buildings(user, pcode):
    """Preview count of buildings available from Overture Maps for this admin boundary or drawn geometry"""
    data = request.get_json()
    area_id = data.get('area_id')
    geometry = data.get('geometry')  # Optional GeoJSON geometry for drawn areas

    if not area_id:
        return jsonify({'error': 'area_id is required'}), 400

    check_area_access(user['id'], area_id)

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # If geometry is provided (drawn area), use it instead of looking up pcode
        if geometry:
            from shapely.geometry import shape
            from shapely import wkt as shapely_wkt

            # Convert GeoJSON to WKT
            geom = shape(geometry)
            boundary_wkt = shapely_wkt.dumps(geom)

            # Calculate bbox from geometry
            bounds = geom.bounds  # (minx, miny, maxx, maxy)
            bbox = bounds  # (min_lng, min_lat, max_lng, max_lat)
        else:
            # Get bounding box and WKT geometry for admin boundary
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
                return jsonify({'error': f'Admin boundary not found for PCODE: {pcode}'}), 404

            bbox = (result[0], result[1], result[2], result[3])  # (min_lng, min_lat, max_lng, max_lat)
            boundary_wkt = result[4]

        # Count buildings from Overture Maps using DuckDB
        print(f"Counting Overture buildings for PCODE {pcode}")

        con = duckdb.connect()
        con.execute("INSTALL spatial; LOAD spatial;")
        con.execute("SET s3_region='us-west-2';")

        # First filter by bbox for performance, then by actual boundary
        count_query = f"""
            SELECT COUNT(*) as count
            FROM read_parquet('{OVERTURE_BUILDINGS_PATH}', hive_partitioning=1)
            WHERE bbox.xmin BETWEEN {bbox[0]} AND {bbox[2]}
              AND bbox.ymin BETWEEN {bbox[1]} AND {bbox[3]}
              AND ST_Within(geometry, ST_GeomFromText('{boundary_wkt}'))
        """

        count = con.execute(count_query).fetchone()[0]
        con.close()
        print(f"Found {count} buildings from Overture Maps")

        return jsonify({
            'count': count,
            'bbox': list(bbox)
        }), 200

    except Exception as e:
        print(f"Error previewing Overture buildings: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to preview buildings: {str(e)}'}), 500
    finally:
        if conn:
            return_db_connection(conn)


@admin_boundaries_bp.route('/api/admin-boundaries/<pcode>/import-overture-buildings', methods=['POST'])
@require_auth
def import_overture_buildings(user, pcode):
    """Import buildings from Overture Maps for this admin boundary into locations table"""
    data = request.get_json()
    area_id = data.get('area_id')
    geometry = data.get('geometry')  # Optional GeoJSON geometry for drawn areas

    if not area_id:
        return jsonify({'error': 'area_id is required'}), 400

    check_area_access(user['id'], area_id)

    conn = None
    con = None

    # Timing metrics
    timing = {
        'total_start': time.time(),
        'duckdb_query_time': 0,
        'duplicate_check_time': 0,
        'batch_insert_time': 0,
        'coverage_time': 0,
        'pixel_time': 0
    }

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # If geometry is provided (drawn area), use it instead of looking up pcode
        if geometry:
            from shapely.geometry import shape
            from shapely import wkt as shapely_wkt

            # Convert GeoJSON to WKT
            geom = shape(geometry)
            boundary_wkt = shapely_wkt.dumps(geom)

            # Calculate bbox from geometry
            bounds = geom.bounds  # (minx, miny, maxx, maxy)
            bbox = bounds  # (min_lng, min_lat, max_lng, max_lat)
        else:
            # Get bounding box and WKT geometry for admin boundary
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
                return jsonify({'error': f'Admin boundary not found for PCODE: {pcode}'}), 404

            bbox = (result[0], result[1], result[2], result[3])
            boundary_wkt = result[4]

        print(f"Importing Overture buildings for PCODE {pcode}")

        # Setup DuckDB connection
        con = duckdb.connect()
        con.execute("INSTALL spatial; LOAD spatial;")
        con.execute("SET s3_region='us-west-2';")

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

        # Import helper functions
        from routes.locations import calculate_quadkey
        import mercantile

        # Get indicators for this area's project (needed for coverage creation)
        cursor.execute("""
            SELECT id FROM indicators WHERE project_id = (
                SELECT project_id FROM areas WHERE id = %s
            )
        """, (area_id,))
        indicators = [row[0] for row in cursor.fetchall()]
        print(f"Found {len(indicators)} indicators for coverage creation")

        # Pagination settings
        BATCH_SIZE = 1000
        offset = 0

        # Overall counters
        total_inserted = 0
        total_duplicates = 0
        total_fetched = 0
        total_coverage_created = 0
        unique_quadkeys = set()

        # Process buildings in batches
        while True:
            # Fetch batch from DuckDB
            query_start = time.time()
            paginated_query = f"({base_buildings_query}) LIMIT {BATCH_SIZE} OFFSET {offset}"
            buildings = con.execute(paginated_query).fetchall()
            query_time = time.time() - query_start
            timing['duckdb_query_time'] += query_time

            if not buildings:
                break

            total_fetched += len(buildings)
            print(f"Fetched batch of {len(buildings)} buildings (offset {offset}, took {query_time:.2f}s)")

            # Prepare batch data
            dup_check_start = time.time()
            batch_to_insert = []
            batch_duplicates = 0

            for building in buildings:
                try:
                    overture_id, primary_name, height, num_floors, building_class, geometry_wkt, centroid_lng, centroid_lat = building

                    # Use the centroid from DuckDB
                    lat, lng = centroid_lat, centroid_lng
                    if lat is None or lng is None:
                        continue

                    # Check for duplicate by external_id only
                    duplicate_id = find_duplicate_by_external_id(cursor, area_id, overture_id)
                    if duplicate_id:
                        batch_duplicates += 1
                        continue

                    # Calculate quadkey
                    quadkey = calculate_quadkey(lat, lng)
                    if quadkey:
                        unique_quadkeys.add(quadkey)

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

                    # Add to batch
                    batch_to_insert.append((
                        area_id,
                        overture_id,  # external_id
                        geometry_wkt,
                        lat,
                        lng,
                        quadkey,
                        json.dumps(properties)
                    ))

                except Exception as e:
                    print(f"Error preparing building {overture_id}: {e}")
                    continue

            dup_check_time = time.time() - dup_check_start
            timing['duplicate_check_time'] += dup_check_time
            total_duplicates += batch_duplicates
            print(f"Duplicate check complete: {batch_duplicates} duplicates, {len(batch_to_insert)} to insert (took {dup_check_time:.2f}s)")

            # Batch insert locations and create coverage
            if batch_to_insert:
                insert_start = time.time()

                # Insert locations using execute_values to support RETURNING
                from psycopg2.extras import execute_values

                batch_ids = []
                result = execute_values(cursor, """
                    INSERT INTO locations (
                        area_id, external_id, geometry, latitude, longitude, quadkey, properties
                    )
                    VALUES %s
                    RETURNING id
                """, [(area_id, ext_id, f"SRID=4326;{geom}", lat, lng, qk, props)
                      for area_id, ext_id, geom, lat, lng, qk, props in batch_to_insert],
                    template="(%s, %s, ST_GeomFromText(%s), %s, %s, %s, %s)",
                    fetch=True)

                # Get all returned IDs
                batch_ids = [str(row[0]) for row in result]
                total_inserted += len(batch_ids)

                insert_time = time.time() - insert_start
                timing['batch_insert_time'] += insert_time
                print(f"Batch insert complete: {len(batch_ids)} locations inserted (took {insert_time:.2f}s)")

                # Immediately create coverage for this batch
                if batch_ids and indicators:
                    coverage_start = time.time()
                    coverage_batch = []

                    # Fetch quadkeys for all batch locations
                    format_strings = ','.join(['%s'] * len(batch_ids))
                    cursor.execute(f"""
                        SELECT id, quadkey FROM locations WHERE id IN ({format_strings})
                    """, batch_ids)
                    location_quadkeys = {str(row[0]): row[1] for row in cursor.fetchall()}

                    for location_id in batch_ids:
                        quadkey = location_quadkeys.get(location_id)
                        for indicator_id in indicators:
                            coverage_batch.append((
                                location_id,
                                area_id,
                                indicator_id,
                                0,  # version
                                0,  # n_trials
                                0,  # n_covered
                                quadkey
                            ))

                    # Batch insert coverage records
                    cursor.executemany("""
                        INSERT INTO coverage (location_id, area_id, indicator_id, version, n_trials, n_covered, quadkey)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (location_id, indicator_id, version) DO NOTHING
                    """, coverage_batch)

                    coverage_created = cursor.rowcount
                    total_coverage_created += coverage_created
                    coverage_time = time.time() - coverage_start
                    timing['coverage_time'] += coverage_time
                    print(f"Coverage batch complete: {coverage_created} records created (took {coverage_time:.2f}s)")

            # Move to next batch
            offset += BATCH_SIZE

        # Close DuckDB connection
        if con:
            con.close()
            con = None

        print(f"Total fetched: {total_fetched}, inserted: {total_inserted}, duplicates: {total_duplicates}")

        # Validate coverage creation
        if total_inserted > 0 and indicators:
            expected_coverage = total_inserted * len(indicators)
            if total_coverage_created != expected_coverage:
                error_msg = f"Coverage validation failed: expected {expected_coverage} records ({total_inserted} locations × {len(indicators)} indicators), but created {total_coverage_created}"
                print(f"ERROR: {error_msg}")
                conn.rollback()
                raise ValueError(error_msg)
            print(f"Coverage validation passed: {total_coverage_created} records created for {total_inserted} locations × {len(indicators)} indicators")

        # Generate pixels for unique quadkeys
        pixel_start = time.time()
        pixels_created = 0
        if unique_quadkeys:
            # Prepare batch of pixels to insert
            pixels_to_insert = []
            for quadkey in unique_quadkeys:
                # Calculate lat/lng from quadkey
                tile = mercantile.quadkey_to_tile(quadkey)
                bounds = mercantile.bounds(tile)
                center_lng = (bounds.west + bounds.east) / 2
                center_lat = (bounds.north + bounds.south) / 2

                # Create geometry WKT for pixel bounds
                pixel_wkt = f'POLYGON(({bounds.west} {bounds.south},{bounds.east} {bounds.south},{bounds.east} {bounds.north},{bounds.west} {bounds.north},{bounds.west} {bounds.south}))'

                pixels_to_insert.append((
                    area_id, quadkey, pixel_wkt, center_lat, center_lng, 18
                ))

            # Batch insert with ON CONFLICT DO NOTHING to handle duplicates
            if pixels_to_insert:
                cursor.executemany("""
                    INSERT INTO pixels (area_id, quadkey, geometry, latitude, longitude, level)
                    VALUES (%s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s)
                    ON CONFLICT ON CONSTRAINT pixels_area_quadkey_unique DO NOTHING
                """, pixels_to_insert)

                # Count how many were actually inserted
                pixels_created = cursor.rowcount
                conn.commit()
                print(f"Created {pixels_created} new pixels")

            # Populate coverage_pixel for new pixels
            if pixels_created > 0:
                cursor.execute("""
                    SELECT id FROM indicators WHERE project_id = (
                        SELECT project_id FROM areas WHERE id = %s
                    )
                """, (area_id,))

                indicators = cursor.fetchall()
                for indicator_row in indicators:
                    indicator_id = indicator_row[0]

                    cursor.execute("""
                        INSERT INTO coverage_pixel (quadkey, indicator_id, area_id, version, n_trials, n_covered)
                        SELECT p.quadkey, %s, %s, 0, 0, 0
                        FROM pixels p
                        WHERE p.area_id = %s
                        AND NOT EXISTS (
                            SELECT 1 FROM coverage_pixel cp
                            WHERE cp.quadkey = p.quadkey AND cp.indicator_id = %s AND cp.area_id = %s
                        )
                    """, (indicator_id, area_id, area_id, indicator_id, area_id))

                conn.commit()
                print(f"Populated coverage_pixel for {pixels_created} new pixels")

        timing['pixel_time'] = time.time() - pixel_start
        timing['total_time'] = time.time() - timing['total_start']

        # Log performance summary
        print(f"\n=== Performance Summary ===")
        print(f"Total time: {timing['total_time']:.2f}s")
        print(f"  DuckDB queries: {timing['duckdb_query_time']:.2f}s ({timing['duckdb_query_time']/timing['total_time']*100:.1f}%)")
        print(f"  Duplicate checks: {timing['duplicate_check_time']:.2f}s ({timing['duplicate_check_time']/timing['total_time']*100:.1f}%)")
        print(f"  Batch inserts: {timing['batch_insert_time']:.2f}s ({timing['batch_insert_time']/timing['total_time']*100:.1f}%)")
        print(f"  Coverage population: {timing['coverage_time']:.2f}s ({timing['coverage_time']/timing['total_time']*100:.1f}%)")
        print(f"  Pixel generation: {timing['pixel_time']:.2f}s ({timing['pixel_time']/timing['total_time']*100:.1f}%)")
        print(f"==========================\n")

        return jsonify({
            'success': True,
            'inserted': total_inserted,
            'duplicates': total_duplicates,
            'pixels_created': pixels_created,
            'total_fetched': total_fetched,
            'timing': {
                'total_seconds': round(timing['total_time'], 2),
                'duckdb_seconds': round(timing['duckdb_query_time'], 2),
                'duplicate_check_seconds': round(timing['duplicate_check_time'], 2),
                'insert_seconds': round(timing['batch_insert_time'], 2),
                'coverage_seconds': round(timing['coverage_time'], 2),
                'pixel_seconds': round(timing['pixel_time'], 2)
            }
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error importing Overture buildings: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to import buildings: {str(e)}'}), 500
    finally:
        if con:
            con.close()
        if conn:
            return_db_connection(conn)


@admin_boundaries_bp.route('/api/admin-boundaries/<pcode>/import-overture-buildings/async', methods=['POST'])
@require_auth
def import_overture_buildings_async(user, pcode):
    """Start async Overture Maps building import workflow"""
    data = request.get_json()
    area_id = data.get('area_id')
    geometry = data.get('geometry')  # Optional GeoJSON geometry for drawn areas

    if not area_id:
        return jsonify({'error': 'area_id is required'}), 400

    check_area_access(user['id'], area_id)

    try:
        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"overture-import-{pcode}-{area_id}-{timestamp}"

        # Start the workflow
        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                OvertureImportWorkflow.run,
                args=[pcode, area_id, geometry],
                id=workflow_id,
                task_queue="truecover-tasks"
            )

        run_async(start_workflow())

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started'
        }), 202

    except Exception as e:
        print(f"Error starting Overture import workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to start import: {str(e)}'}), 500


@admin_boundaries_bp.route('/api/overture/import/<workflow_id>/status', methods=['GET'])
@require_auth
def get_overture_import_status(user, workflow_id):
    """Get status of Overture import workflow"""
    try:
        async def get_status():
            client = await get_temporal_client()
            handle = client.get_workflow_handle(workflow_id)

            # Check workflow status
            try:
                desc = await handle.describe()

                if desc.status == WorkflowExecutionStatus.RUNNING:
                    # Workflow is running, try to get progress
                    try:
                        progress = await handle.query(OvertureImportWorkflow.get_progress)
                        return {
                            "workflow_id": workflow_id,
                            "status": "running",
                            "progress": progress
                        }
                    except Exception as query_error:
                        # Query failed (timeout/expired), but workflow is still running
                        # Return running status without progress
                        return {
                            "workflow_id": workflow_id,
                            "status": "running",
                            "progress": None
                        }
                elif desc.status == WorkflowExecutionStatus.COMPLETED:
                    # Workflow completed, get result
                    result = await handle.result()
                    return {
                        "workflow_id": workflow_id,
                        "status": "completed",
                        "result": result
                    }
                else:
                    # Workflow failed/cancelled
                    return {
                        "workflow_id": workflow_id,
                        "status": desc.status.name.lower()
                    }
            except Exception as e:
                # Workflow not found or other error
                return {
                    "workflow_id": workflow_id,
                    "status": "failed",
                    "error": str(e)
                }

        status = run_async(get_status())
        return jsonify(status), 200

    except Exception as e:
        print(f"Error getting workflow status: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to get status: {str(e)}'}), 500
