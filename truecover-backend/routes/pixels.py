# ABOUTME: API endpoints for managing quadkey-based pixels
# ABOUTME: Supports generation, stats retrieval, and deletion of pixels per area

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection
import mercantile

pixels_bp = Blueprint('pixels', __name__)


@pixels_bp.route('/api/areas/<area_id>/pixels/generate', methods=['POST'])
@require_auth
def generate_pixels(user, area_id):
    """Generate quadkey pixels for a given bounding box and zoom level"""
    check_area_access(user['id'], area_id)

    conn = None
    try:
        data = request.get_json()
        bbox = data.get('bbox')  # [minLng, minLat, maxLng, maxLat]
        level = data.get('level', 18)

        if not bbox or len(bbox) != 4:
            return jsonify({'error': 'Invalid bbox. Expected [minLng, minLat, maxLng, maxLat]'}), 400

        min_lng, min_lat, max_lng, max_lat = bbox

        # Validate bbox
        if not (-180 <= min_lng <= 180 and -180 <= max_lng <= 180):
            return jsonify({'error': 'Longitude must be between -180 and 180'}), 400
        if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
            return jsonify({'error': 'Latitude must be between -90 and 90'}), 400
        if min_lng >= max_lng or min_lat >= max_lat:
            return jsonify({'error': 'Invalid bounding box coordinates'}), 400

        # Validate level
        if not (0 <= level <= 24):
            return jsonify({'error': 'Zoom level must be between 0 and 24'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Delete existing pixels for this area
        cursor.execute("""
            DELETE FROM pixels WHERE area_id = %s
        """, (area_id,))

        # Generate tiles using mercantile
        tiles = list(mercantile.tiles(min_lng, min_lat, max_lng, max_lat, zooms=[level]))

        # Prepare batch insert data
        pixel_data = []
        for tile in tiles:
            quadkey = mercantile.quadkey(tile)
            bounds = mercantile.bounds(tile)

            # Calculate centroid
            centroid_lng = (bounds.west + bounds.east) / 2
            centroid_lat = (bounds.south + bounds.north) / 2

            # Create polygon geometry WKT
            geometry_wkt = f"POLYGON(({bounds.west} {bounds.south}, {bounds.west} {bounds.north}, {bounds.east} {bounds.north}, {bounds.east} {bounds.south}, {bounds.west} {bounds.south}))"

            pixel_data.append((
                quadkey,
                area_id,
                geometry_wkt,
                centroid_lat,
                centroid_lng,
                level
            ))

        # Batch insert/update pixels (upsert to avoid duplicates)
        if pixel_data:
            cursor.executemany("""
                INSERT INTO pixels (quadkey, area_id, geometry, latitude, longitude, level)
                VALUES (%s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s)
                ON CONFLICT (quadkey) DO UPDATE SET
                    area_id = EXCLUDED.area_id,
                    geometry = EXCLUDED.geometry,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    level = EXCLUDED.level,
                    updated_at = NOW()
            """, pixel_data)

            # Create default coverage_pixel records for the new pixels
            from routes.coverage import create_default_coverage_pixels
            quadkeys = [p[0] for p in pixel_data]
            create_default_coverage_pixels(cursor, area_id, quadkeys)

        conn.commit()

        return jsonify({
            'count': len(pixel_data),
            'level': level
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error generating pixels: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@pixels_bp.route('/api/areas/<area_id>/pixels/stats', methods=['GET'])
@require_auth
def get_pixels_stats(user, area_id):
    """Get statistics about pixels for an area"""
    check_area_access(user['id'], area_id)

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get count and level
        cursor.execute("""
            SELECT COUNT(*), MAX(level) as level
            FROM pixels
            WHERE area_id = %s
        """, (area_id,))

        result = cursor.fetchone()
        count = result[0] if result else 0
        level = result[1] if result and result[1] is not None else None

        # Get bounding box if pixels exist
        bounds = None
        if count > 0:
            cursor.execute("""
                SELECT
                    MIN(ST_XMin(geometry)) as min_lng,
                    MIN(ST_YMin(geometry)) as min_lat,
                    MAX(ST_XMax(geometry)) as max_lng,
                    MAX(ST_YMax(geometry)) as max_lat
                FROM pixels
                WHERE area_id = %s
            """, (area_id,))

            bbox_result = cursor.fetchone()
            if bbox_result and all(x is not None for x in bbox_result):
                bounds = [float(x) for x in bbox_result]

        return jsonify({
            'count': count,
            'level': level,
            'bounds': bounds
        }), 200

    except Exception as e:
        print(f"Error getting pixels stats: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@pixels_bp.route('/api/areas/<area_id>/pixels', methods=['DELETE'])
@require_auth
def delete_pixels(user, area_id):
    """Delete all pixels for an area"""
    check_area_access(user['id'], area_id)

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            DELETE FROM pixels WHERE area_id = %s
        """, (area_id,))

        deleted_count = cursor.rowcount
        conn.commit()

        return jsonify({
            'deleted_count': deleted_count
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting pixels: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@pixels_bp.route('/api/areas/<area_id>/pixels/metadata-stats', methods=['GET'])
@require_auth
def get_pixels_metadata_stats(user, area_id):
    """Get statistics about pixel metadata for an area"""
    check_area_access(user['id'], area_id)

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get all metadata field definitions
        cursor.execute("""
            SELECT name, description, data_type, unit
            FROM pixel_metadata_definitions
            ORDER BY name
        """)
        field_definitions = cursor.fetchall()

        # Get count of pixels with metadata in this area
        cursor.execute("""
            SELECT COUNT(DISTINCT pm.quadkey)
            FROM pixel_metadata pm
            JOIN pixels p ON pm.quadkey = p.quadkey
            WHERE p.area_id = %s
        """, (area_id,))
        total_enriched = cursor.fetchone()[0]

        # For each field, get count and stats
        metadata_fields = []
        for field_name, field_desc, field_type, field_unit in field_definitions:
            # Count how many pixels have this field
            cursor.execute("""
                SELECT COUNT(*)
                FROM pixel_metadata pm
                JOIN pixels p ON pm.quadkey = p.quadkey
                WHERE p.area_id = %s
                  AND pm.metadata ? %s
            """, (area_id, field_name))
            field_count = cursor.fetchone()[0]

            field_info = {
                'name': field_name,
                'description': field_desc,
                'data_type': field_type,
                'unit': field_unit,
                'count': field_count
            }

            # If numeric type, get min/max/avg
            if field_type in ['integer', 'float'] and field_count > 0:
                cursor.execute(f"""
                    SELECT
                        MIN((pm.metadata->>%s)::{field_type}) as min_val,
                        MAX((pm.metadata->>%s)::{field_type}) as max_val,
                        AVG((pm.metadata->>%s)::{field_type}) as avg_val
                    FROM pixel_metadata pm
                    JOIN pixels p ON pm.quadkey = p.quadkey
                    WHERE p.area_id = %s
                      AND pm.metadata ? %s
                """, (field_name, field_name, field_name, area_id, field_name))
                stats_row = cursor.fetchone()
                if stats_row:
                    field_info['min'] = float(stats_row[0]) if stats_row[0] is not None else None
                    field_info['max'] = float(stats_row[1]) if stats_row[1] is not None else None
                    field_info['avg'] = float(stats_row[2]) if stats_row[2] is not None else None

            metadata_fields.append(field_info)

        return jsonify({
            'total_enriched': total_enriched,
            'metadata_fields': metadata_fields
        }), 200

    except Exception as e:
        print(f"Error getting pixel metadata stats: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
