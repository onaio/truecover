# ABOUTME: API endpoints for querying global quadkey-based pixels
# ABOUTME: Pixels are now global (not per-campaign), linked to campaigns via campaign_areas

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_campaign_access
from db.connection import get_db_connection, return_db_connection

pixels_bp = Blueprint('pixels', __name__)


@pixels_bp.route('/api/pixels/stats', methods=['GET'])
@require_auth
def get_global_pixels_stats(user):
    """Get statistics about global pixels"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT COUNT(*), MAX(level) as level
            FROM pixels
        """)

        result = cursor.fetchone()
        count = result[0] if result else 0
        level = result[1] if result and result[1] is not None else None

        bounds = None
        if count > 0:
            cursor.execute("""
                SELECT
                    MIN(ST_XMin(geometry)) as min_lng,
                    MIN(ST_YMin(geometry)) as min_lat,
                    MAX(ST_XMax(geometry)) as max_lng,
                    MAX(ST_YMax(geometry)) as max_lat
                FROM pixels
            """)

            bbox_result = cursor.fetchone()
            if bbox_result and all(x is not None for x in bbox_result):
                bounds = [float(x) for x in bbox_result]

        cursor.close()
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


@pixels_bp.route('/api/campaigns/<campaign_id>/pixels/stats', methods=['GET'])
@require_auth
def get_campaign_pixels_stats(user, campaign_id):
    """Get statistics about pixels associated with a campaign"""
    if not check_campaign_access(user['id'], campaign_id):
        return jsonify({'error': 'Access denied'}), 403

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Count unique pixels across all campaign areas
        cursor.execute("""
            SELECT COUNT(DISTINCT pa.quadkey)
            FROM pixel_area pa
            JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
            WHERE ca.campaign_id = %s
        """, (campaign_id,))

        count = cursor.fetchone()[0] or 0

        # Get level from any pixel
        level = None
        if count > 0:
            cursor.execute("""
                SELECT DISTINCT p.level
                FROM pixels p
                JOIN pixel_area pa ON p.quadkey = pa.quadkey
                JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                WHERE ca.campaign_id = %s
                LIMIT 1
            """, (campaign_id,))
            level_result = cursor.fetchone()
            if level_result:
                level = level_result[0]

        # Get bounding box from campaign_areas
        bounds = None
        cursor.execute("""
            SELECT
                MIN(bbox_min_lng) as min_lng,
                MIN(bbox_min_lat) as min_lat,
                MAX(bbox_max_lng) as max_lng,
                MAX(bbox_max_lat) as max_lat
            FROM campaign_areas
            WHERE campaign_id = %s
        """, (campaign_id,))

        bbox_result = cursor.fetchone()
        if bbox_result and all(x is not None for x in bbox_result):
            bounds = [float(x) for x in bbox_result]

        cursor.close()
        return jsonify({
            'count': count,
            'level': level,
            'bounds': bounds
        }), 200

    except Exception as e:
        print(f"Error getting campaign pixels stats: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@pixels_bp.route('/api/campaigns/<campaign_id>/pixels/metadata-stats', methods=['GET'])
@require_auth
def get_campaign_pixels_metadata_stats(user, campaign_id):
    """Get statistics about pixel metadata for a campaign"""
    if not check_campaign_access(user['id'], campaign_id):
        return jsonify({'error': 'Access denied'}), 403

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

        # Get count of pixels with metadata for this campaign
        cursor.execute("""
            SELECT COUNT(DISTINCT pm.quadkey)
            FROM pixel_metadata pm
            JOIN pixel_area pa ON pm.quadkey = pa.quadkey
            JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
            WHERE ca.campaign_id = %s
        """, (campaign_id,))
        total_enriched = cursor.fetchone()[0]

        # For each field, get count and stats
        metadata_fields = []
        for field_name, field_desc, field_type, field_unit in field_definitions:
            # Count how many pixels in this campaign have this field
            cursor.execute("""
                SELECT COUNT(*)
                FROM pixel_metadata pm
                JOIN pixel_area pa ON pm.quadkey = pa.quadkey
                JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                WHERE ca.campaign_id = %s
                  AND pm.metadata ? %s
            """, (campaign_id, field_name))
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
                sql_type = 'integer' if field_type == 'integer' else 'float'
                cursor.execute(f"""
                    SELECT
                        MIN((pm.metadata->>%s)::{sql_type}) as min_val,
                        MAX((pm.metadata->>%s)::{sql_type}) as max_val,
                        AVG((pm.metadata->>%s)::{sql_type}) as avg_val
                    FROM pixel_metadata pm
                    JOIN pixel_area pa ON pm.quadkey = pa.quadkey
                    JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                    WHERE ca.campaign_id = %s
                      AND pm.metadata ? %s
                """, (field_name, field_name, field_name, campaign_id, field_name))
                stats_row = cursor.fetchone()
                if stats_row:
                    field_info['min'] = float(stats_row[0]) if stats_row[0] is not None else None
                    field_info['max'] = float(stats_row[1]) if stats_row[1] is not None else None
                    field_info['avg'] = float(stats_row[2]) if stats_row[2] is not None else None

            metadata_fields.append(field_info)

        cursor.close()
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


@pixels_bp.route('/api/pixels/by-quadkey/<quadkey>', methods=['GET'])
@require_auth
def get_pixel_by_quadkey(user, quadkey):
    """Get a single pixel by quadkey"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                quadkey, ST_AsGeoJSON(geometry) as geometry,
                latitude, longitude, level,
                adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode,
                population, created_at
            FROM pixels
            WHERE quadkey = %s
        """, (quadkey,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Pixel not found'}), 404

        import json
        pixel = {
            'quadkey': row[0],
            'geometry': json.loads(row[1]) if row[1] else None,
            'latitude': float(row[2]) if row[2] else None,
            'longitude': float(row[3]) if row[3] else None,
            'level': row[4],
            'adm1_pcode': row[5],
            'adm2_pcode': row[6],
            'adm3_pcode': row[7],
            'adm4_pcode': row[8],
            'population': float(row[9]) if row[9] else None,
            'created_at': row[10].isoformat() if row[10] else None
        }

        # Also get metadata if available
        cursor.execute("""
            SELECT metadata FROM pixel_metadata WHERE quadkey = %s
        """, (quadkey,))
        metadata_row = cursor.fetchone()
        if metadata_row:
            pixel['metadata'] = metadata_row[0]

        cursor.close()
        return jsonify(pixel), 200

    except Exception as e:
        print(f"Error getting pixel: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
