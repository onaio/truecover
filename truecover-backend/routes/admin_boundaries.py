# ABOUTME: API endpoints for admin boundary queries
# ABOUTME: Provides geometric info like bounding boxes for admin areas by PCODE

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from db.connection import get_db_connection, return_db_connection

admin_boundaries_bp = Blueprint('admin_boundaries', __name__)


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
