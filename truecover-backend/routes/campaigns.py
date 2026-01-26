# ABOUTME: API endpoints for managing campaigns (renamed from areas)
# ABOUTME: Includes CRUD for campaigns and campaign_areas (multi-area support)

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_project_access, check_campaign_access
from db.connection import get_db_connection, return_db_connection
import json

campaigns_bp = Blueprint('campaigns', __name__)


# ===== CAMPAIGN ROUTES =====

@campaigns_bp.route('/api/projects/<project_id>/campaigns', methods=['POST'])
@require_auth
def create_campaign(user, project_id):
    """Create a new campaign within a project"""
    conn = None
    try:
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        data = request.get_json()

        name = data.get('name')
        if not name or not name.strip():
            return jsonify({'error': 'Campaign name is required'}), 400

        description = data.get('description', '')

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO campaigns (project_id, name, description)
            VALUES (%s, %s, %s)
            RETURNING id, project_id, name, description, created_at, updated_at;
        """, (project_id, name.strip(), description))

        campaign_data = cursor.fetchone()
        conn.commit()

        campaign = {
            'id': str(campaign_data[0]),
            'project_id': str(campaign_data[1]),
            'name': campaign_data[2],
            'description': campaign_data[3],
            'created_at': campaign_data[4].isoformat() if campaign_data[4] else None,
            'updated_at': campaign_data[5].isoformat() if campaign_data[5] else None
        }

        cursor.close()
        return jsonify(campaign), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating campaign: {e}")
        return jsonify({'error': 'Failed to create campaign', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/projects/<project_id>/campaigns', methods=['GET'])
@require_auth
def list_campaigns(user, project_id):
    """Get all campaigns for a project"""
    conn = None
    try:
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, project_id, name, description, created_at, updated_at
            FROM campaigns
            WHERE project_id = %s AND deleted_at IS NULL
            ORDER BY created_at DESC
        """, (project_id,))

        campaigns = []
        for row in cursor.fetchall():
            campaigns.append({
                'id': str(row[0]),
                'project_id': str(row[1]),
                'name': row[2],
                'description': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'updated_at': row[5].isoformat() if row[5] else None
            })

        cursor.close()
        return jsonify({'campaigns': campaigns}), 200

    except Exception as e:
        print(f"Error listing campaigns: {e}")
        return jsonify({'error': 'Failed to list campaigns', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaigns/<campaign_id>', methods=['GET'])
@require_auth
def get_campaign(user, campaign_id):
    """Get campaign details"""
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this campaign'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, project_id, name, description, created_at, updated_at
            FROM campaigns
            WHERE id = %s AND deleted_at IS NULL
        """, (campaign_id,))

        campaign_data = cursor.fetchone()

        if not campaign_data:
            cursor.close()
            return jsonify({'error': 'Campaign not found'}), 404

        campaign = {
            'id': str(campaign_data[0]),
            'project_id': str(campaign_data[1]),
            'name': campaign_data[2],
            'description': campaign_data[3],
            'created_at': campaign_data[4].isoformat() if campaign_data[4] else None,
            'updated_at': campaign_data[5].isoformat() if campaign_data[5] else None
        }

        cursor.close()
        return jsonify(campaign), 200

    except Exception as e:
        print(f"Error getting campaign: {e}")
        return jsonify({'error': 'Failed to get campaign', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaigns/<campaign_id>', methods=['PUT'])
@require_auth
def update_campaign(user, campaign_id):
    """Update a campaign"""
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this campaign'}), 403

        data = request.get_json()

        name = data.get('name')
        description = data.get('description')

        if not name and description is None:
            return jsonify({'error': 'No fields to update'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        if name and description is not None:
            cursor.execute("""
                UPDATE campaigns
                SET name = %s, description = %s, updated_at = NOW()
                WHERE id = %s AND deleted_at IS NULL
                RETURNING id, project_id, name, description, created_at, updated_at;
            """, (name.strip(), description, campaign_id))
        elif name:
            cursor.execute("""
                UPDATE campaigns
                SET name = %s, updated_at = NOW()
                WHERE id = %s AND deleted_at IS NULL
                RETURNING id, project_id, name, description, created_at, updated_at;
            """, (name.strip(), campaign_id))
        else:
            cursor.execute("""
                UPDATE campaigns
                SET description = %s, updated_at = NOW()
                WHERE id = %s AND deleted_at IS NULL
                RETURNING id, project_id, name, description, created_at, updated_at;
            """, (description, campaign_id))

        campaign_data = cursor.fetchone()

        if not campaign_data:
            cursor.close()
            return jsonify({'error': 'Campaign not found'}), 404

        conn.commit()

        campaign = {
            'id': str(campaign_data[0]),
            'project_id': str(campaign_data[1]),
            'name': campaign_data[2],
            'description': campaign_data[3],
            'created_at': campaign_data[4].isoformat() if campaign_data[4] else None,
            'updated_at': campaign_data[5].isoformat() if campaign_data[5] else None
        }

        cursor.close()
        return jsonify(campaign), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating campaign: {e}")
        return jsonify({'error': 'Failed to update campaign', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaigns/<campaign_id>', methods=['DELETE'])
@require_auth
def delete_campaign(user, campaign_id):
    """Delete a campaign (soft delete)"""
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this campaign'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE campaigns
            SET deleted_at = NOW()
            WHERE id = %s AND deleted_at IS NULL
            RETURNING id
        """, (campaign_id,))

        deleted = cursor.fetchone()

        if not deleted:
            cursor.close()
            return jsonify({'error': 'Campaign not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'message': 'Campaign deleted successfully'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting campaign: {e}")
        return jsonify({'error': 'Failed to delete campaign', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


# ===== CAMPAIGN AREAS ROUTES =====

@campaigns_bp.route('/api/campaigns/<campaign_id>/areas', methods=['GET'])
@require_auth
def list_campaign_areas(user, campaign_id):
    """Get all areas for a campaign"""
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Use cached statistics columns for fast loading
        cursor.execute("""
            SELECT
                ca.id, ca.campaign_id, ca.name, ca.area_type,
                ca.admin_boundary_id,
                ST_AsGeoJSON(ca.geometry) as geometry,
                ca.bbox_min_lng, ca.bbox_min_lat, ca.bbox_max_lng, ca.bbox_max_lat,
                ca.created_at, ca.updated_at,
                ab.name as admin_boundary_name,
                COALESCE(ca.cached_pixel_count, 0) as pixel_count,
                COALESCE(ca.cached_population, 0) as total_population,
                COALESCE(ca.cached_building_count, 0) as building_count,
                div.name as division_name,
                dist.name as district_name,
                upz.name as upazila_name,
                uni.name as union_name,
                COALESCE(ca.cached_sampled_count, 0) as sampled_count
            FROM campaign_areas ca
            LEFT JOIN admin_boundaries ab ON ca.admin_boundary_id = ab.id
            -- Get parent boundary names using the pcode hierarchy
            LEFT JOIN admin_boundaries div ON div.adm1_pcode = ab.adm1_pcode AND div.level = 1
            LEFT JOIN admin_boundaries dist ON dist.adm2_pcode = ab.adm2_pcode AND dist.level = 2
            LEFT JOIN admin_boundaries upz ON upz.adm3_pcode = ab.adm3_pcode AND upz.level = 3
            LEFT JOIN admin_boundaries uni ON uni.adm4_pcode = ab.adm4_pcode AND uni.level = 4
            WHERE ca.campaign_id = %s
            ORDER BY ca.created_at DESC
        """, (campaign_id,))

        areas = []
        for row in cursor.fetchall():
            area = {
                'id': str(row[0]),
                'campaign_id': str(row[1]),
                'name': row[2],
                'area_type': row[3],
                'admin_boundary_id': str(row[4]) if row[4] else None,
                'geometry': json.loads(row[5]) if row[5] else None,
                'bbox': {
                    'min_lng': float(row[6]) if row[6] else None,
                    'min_lat': float(row[7]) if row[7] else None,
                    'max_lng': float(row[8]) if row[8] else None,
                    'max_lat': float(row[9]) if row[9] else None,
                } if row[6] else None,
                'created_at': row[10].isoformat() if row[10] else None,
                'updated_at': row[11].isoformat() if row[11] else None,
                'admin_boundary_name': row[12],
                'pixel_count': row[13] or 0,
                'total_population': int(row[14]) if row[14] else 0,
                'building_count': row[15] or 0,
                'division_name': row[16],
                'district_name': row[17],
                'upazila_name': row[18],
                'union_name': row[19],
                'sampled_count': row[20] or 0
            }
            areas.append(area)

        cursor.close()
        return jsonify({'areas': areas}), 200

    except Exception as e:
        print(f"Error listing campaign areas: {e}")
        return jsonify({'error': 'Failed to list campaign areas', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaigns/<campaign_id>/areas', methods=['POST'])
@require_auth
def add_campaign_area(user, campaign_id):
    """Add an area to a campaign (admin boundary or drawn geometry)"""
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()

        area_type = data.get('area_type', 'admin_boundary')
        admin_boundary_pcode = data.get('pcode')  # Use pcode from frontend
        geometry = data.get('geometry')
        name = data.get('name')

        if area_type == 'admin_boundary' and not admin_boundary_pcode:
            return jsonify({'error': 'pcode is required for admin_boundary type'}), 400
        if area_type == 'drawn' and not geometry:
            return jsonify({'error': 'geometry is required for drawn type'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        geometry_wkt = None
        bbox = None
        admin_boundary_id = None

        cached_pixel_count = 0
        cached_population = 0

        if area_type == 'admin_boundary':
            # Get geometry, name, id, and pre-computed stats from admin_boundaries table by pcode
            cursor.execute("""
                SELECT ab.id, ab.name, ST_AsText(ab.geometry),
                       ST_XMin(ab.geometry), ST_YMin(ab.geometry),
                       ST_XMax(ab.geometry), ST_YMax(ab.geometry),
                       COALESCE(abs.pixel_count, 0),
                       COALESCE(abs.population, 0)
                FROM admin_boundaries ab
                LEFT JOIN admin_boundary_stats abs ON abs.admin_boundary_id = ab.id
                WHERE ab.adm0_pcode = %s
                   OR ab.adm1_pcode = %s
                   OR ab.adm2_pcode = %s
                   OR ab.adm3_pcode = %s
                   OR ab.adm4_pcode = %s
                LIMIT 1
            """, (admin_boundary_pcode, admin_boundary_pcode, admin_boundary_pcode,
                  admin_boundary_pcode, admin_boundary_pcode))
            ab_data = cursor.fetchone()
            if not ab_data:
                cursor.close()
                return jsonify({'error': f'Admin boundary not found for pcode: {admin_boundary_pcode}'}), 404
            admin_boundary_id = str(ab_data[0])
            if not name:
                name = ab_data[1]
            geometry_wkt = ab_data[2]
            bbox = {
                'min_lng': float(ab_data[3]),
                'min_lat': float(ab_data[4]),
                'max_lng': float(ab_data[5]),
                'max_lat': float(ab_data[6])
            }
            cached_pixel_count = ab_data[7] or 0
            cached_population = ab_data[8] or 0
        else:
            # For drawn areas, convert GeoJSON to WKT and calculate bbox
            from shapely.geometry import shape
            geom = shape(geometry)
            geometry_wkt = geom.wkt
            bounds = geom.bounds
            bbox = {
                'min_lng': bounds[0],
                'min_lat': bounds[1],
                'max_lng': bounds[2],
                'max_lat': bounds[3]
            }

            # Detect admin boundaries using centroid
            centroid = geom.centroid
            cursor.execute("""
                SELECT id
                FROM admin_boundaries
                WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                ORDER BY level DESC
                LIMIT 1
            """, (centroid.x, centroid.y))
            ab_result = cursor.fetchone()
            if ab_result:
                admin_boundary_id = str(ab_result[0])

        cursor.execute("""
            INSERT INTO campaign_areas (
                campaign_id, name, area_type, admin_boundary_id, geometry,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
                cached_pixel_count, cached_population
            )
            VALUES (%s, %s, %s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s, %s, %s, %s)
            RETURNING id, created_at, updated_at
        """, (
            campaign_id, name, area_type, admin_boundary_id, geometry_wkt,
            bbox['min_lng'], bbox['min_lat'], bbox['max_lng'], bbox['max_lat'],
            cached_pixel_count, cached_population
        ))

        result = cursor.fetchone()
        campaign_area_id = str(result[0])

        # For admin boundary areas, copy pixel mappings from pre-computed table
        if area_type == 'admin_boundary' and admin_boundary_id:
            cursor.execute("""
                INSERT INTO pixel_area (quadkey, campaign_area_id)
                SELECT quadkey, %s
                FROM admin_boundary_pixels
                WHERE admin_boundary_id = %s
                ON CONFLICT (quadkey, campaign_area_id) DO NOTHING
            """, (campaign_area_id, admin_boundary_id))

        conn.commit()
        cursor.close()

        return jsonify({
            'id': campaign_area_id,
            'campaign_id': campaign_id,
            'name': name,
            'area_type': area_type,
            'admin_boundary_id': admin_boundary_id,
            'bbox': bbox,
            'pixel_count': cached_pixel_count,
            'total_population': int(cached_population),
            'created_at': result[1].isoformat() if result[1] else None,
            'updated_at': result[2].isoformat() if result[2] else None
        }), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error adding campaign area: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to add campaign area', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaigns/<campaign_id>/areas/<area_id>', methods=['DELETE'])
@require_auth
def delete_campaign_area(user, campaign_id, area_id):
    """Remove an area from a campaign"""
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            DELETE FROM campaign_areas
            WHERE id = %s AND campaign_id = %s
            RETURNING id
        """, (area_id, campaign_id))

        deleted = cursor.fetchone()

        if not deleted:
            cursor.close()
            return jsonify({'error': 'Campaign area not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'message': 'Campaign area deleted successfully'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting campaign area: {e}")
        return jsonify({'error': 'Failed to delete campaign area', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaign-areas/<area_id>/compute-pixels', methods=['POST'])
@require_auth
def compute_pixels_for_area(user, area_id):
    """
    Compute which pixels belong to a campaign area.
    Uses ST_Intersects to find all global pixels that intersect the area geometry.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get campaign_id to check access
        cursor.execute("""
            SELECT campaign_id FROM campaign_areas WHERE id = %s
        """, (area_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Campaign area not found'}), 404

        campaign_id = str(result[0])
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Delete existing pixel_area records for this campaign area
        cursor.execute("""
            DELETE FROM pixel_area WHERE campaign_area_id = %s
        """, (area_id,))

        # Find all pixels that intersect the campaign area geometry
        cursor.execute("""
            INSERT INTO pixel_area (quadkey, campaign_area_id)
            SELECT p.quadkey, %s
            FROM pixels p
            JOIN campaign_areas ca ON ST_Intersects(p.geometry, ca.geometry)
            WHERE ca.id = %s
            ON CONFLICT (quadkey, campaign_area_id) DO NOTHING
        """, (area_id, area_id))

        inserted_count = cursor.rowcount

        # Update cached statistics
        cursor.execute("""
            WITH pixel_stats AS (
                SELECT
                    COUNT(*) as pixel_count,
                    COALESCE(SUM(p.population), 0) as total_population
                FROM pixel_area pa
                JOIN pixels p ON pa.quadkey = p.quadkey
                WHERE pa.campaign_area_id = %s
            ),
            location_counts AS (
                SELECT COUNT(l.id) as building_count
                FROM campaign_areas ca
                LEFT JOIN locations l ON l.campaign_id = ca.campaign_id
                    AND l.latitude BETWEEN ca.bbox_min_lat AND ca.bbox_max_lat
                    AND l.longitude BETWEEN ca.bbox_min_lng AND ca.bbox_max_lng
                    AND ST_Intersects(l.geometry, ca.geometry)
                WHERE ca.id = %s
            )
            UPDATE campaign_areas
            SET
                cached_pixel_count = (SELECT pixel_count FROM pixel_stats),
                cached_population = (SELECT total_population FROM pixel_stats),
                cached_building_count = (SELECT building_count FROM location_counts)
            WHERE id = %s
        """, (area_id, area_id, area_id))

        conn.commit()
        cursor.close()

        return jsonify({
            'success': True,
            'campaign_area_id': area_id,
            'pixels_computed': inserted_count
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error computing pixels for area: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute pixels', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaigns/<campaign_id>/compute-all-pixels', methods=['POST'])
@require_auth
def compute_all_pixels_for_campaign(user, campaign_id):
    """
    Compute pixels for all areas in a campaign.
    """
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get all campaign areas
        cursor.execute("""
            SELECT id FROM campaign_areas WHERE campaign_id = %s
        """, (campaign_id,))
        areas = cursor.fetchall()

        total_pixels = 0
        for (area_id,) in areas:
            area_id_str = str(area_id)

            # Delete existing
            cursor.execute("""
                DELETE FROM pixel_area WHERE campaign_area_id = %s
            """, (area_id_str,))

            # Insert new
            cursor.execute("""
                INSERT INTO pixel_area (quadkey, campaign_area_id)
                SELECT p.quadkey, %s
                FROM pixels p
                JOIN campaign_areas ca ON ST_Intersects(p.geometry, ca.geometry)
                WHERE ca.id = %s
                ON CONFLICT (quadkey, campaign_area_id) DO NOTHING
            """, (area_id_str, area_id_str))

            total_pixels += cursor.rowcount

            # Update cached statistics for this area
            cursor.execute("""
                WITH pixel_stats AS (
                    SELECT
                        COUNT(*) as pixel_count,
                        COALESCE(SUM(p.population), 0) as total_population
                    FROM pixel_area pa
                    JOIN pixels p ON pa.quadkey = p.quadkey
                    WHERE pa.campaign_area_id = %s
                ),
                location_counts AS (
                    SELECT COUNT(l.id) as building_count
                    FROM campaign_areas ca
                    LEFT JOIN locations l ON l.campaign_id = ca.campaign_id
                        AND l.latitude BETWEEN ca.bbox_min_lat AND ca.bbox_max_lat
                        AND l.longitude BETWEEN ca.bbox_min_lng AND ca.bbox_max_lng
                        AND ST_Intersects(l.geometry, ca.geometry)
                    WHERE ca.id = %s
                )
                UPDATE campaign_areas
                SET
                    cached_pixel_count = (SELECT pixel_count FROM pixel_stats),
                    cached_population = (SELECT total_population FROM pixel_stats),
                    cached_building_count = (SELECT building_count FROM location_counts)
                WHERE id = %s
            """, (area_id_str, area_id_str, area_id_str))

        conn.commit()
        cursor.close()

        return jsonify({
            'success': True,
            'campaign_id': campaign_id,
            'areas_processed': len(areas),
            'total_pixels_computed': total_pixels
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error computing pixels for campaign: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute pixels', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaigns/<campaign_id>/pixels/stats', methods=['GET'])
@require_auth
def get_campaign_pixels_stats(user, campaign_id):
    """Get pixel statistics for a campaign"""
    conn = None
    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Count total pixels across all campaign areas
        cursor.execute("""
            SELECT COUNT(DISTINCT pa.quadkey)
            FROM pixel_area pa
            JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
            WHERE ca.campaign_id = %s
        """, (campaign_id,))
        total_pixels = cursor.fetchone()[0] or 0

        # Get combined bounding box
        cursor.execute("""
            SELECT
                MIN(ca.bbox_min_lng) as min_lng,
                MIN(ca.bbox_min_lat) as min_lat,
                MAX(ca.bbox_max_lng) as max_lng,
                MAX(ca.bbox_max_lat) as max_lat
            FROM campaign_areas ca
            WHERE ca.campaign_id = %s
        """, (campaign_id,))
        bbox_row = cursor.fetchone()
        bounds = None
        if bbox_row and all(x is not None for x in bbox_row):
            bounds = [float(x) for x in bbox_row]

        cursor.close()

        return jsonify({
            'count': total_pixels,
            'bounds': bounds
        }), 200

    except Exception as e:
        print(f"Error getting campaign pixel stats: {e}")
        return jsonify({'error': 'Failed to get pixel stats', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaign-areas/<area_id>/sample', methods=['POST'])
@require_auth
def sample_campaign_area(user, area_id):
    """
    Sample pixels from a campaign area using adaptive sampling.
    Creates coverage_pixel records if they don't exist, then samples.
    """
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.campaign_area_sampling import CampaignAreaSamplingWorkflow

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get campaign_id and check access
        cursor.execute("""
            SELECT campaign_id FROM campaign_areas WHERE id = %s
        """, (area_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Campaign area not found'}), 404

        campaign_id = str(result[0])
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        cursor.close()

        data = request.get_json() or {}
        sample_count = data.get('sample_count', 50)
        indicator_id = data.get('indicator_id')
        resample = data.get('resample', False)
        round_id = data.get('round_id')
        sample_target = data.get('sample_target', 'pixels')  # 'pixels' or 'buildings'

        if not indicator_id:
            return jsonify({'error': 'indicator_id is required'}), 400

        if not round_id:
            return jsonify({'error': 'round_id is required'}), 400

        # Look up round_number from round_id
        cursor = conn.cursor()
        cursor.execute("""
            SELECT round_number FROM rounds WHERE id = %s AND campaign_id = %s
        """, (round_id, campaign_id))
        round_result = cursor.fetchone()
        cursor.close()

        if not round_result:
            return jsonify({'error': 'Round not found'}), 404

        round_number = round_result[0]

        # Start workflow
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"area-sampling-{area_id}-{timestamp}"

        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                CampaignAreaSamplingWorkflow.run,
                args=[
                    campaign_id,
                    indicator_id,
                    area_id,
                    sample_count,
                    resample,
                    round_number,
                    None,  # round_name (not needed since round exists)
                    sample_target
                ],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        return jsonify({
            'workflow_id': workflow_id,
            'area_id': area_id,
            'status': 'started',
            'message': f'Sampling {sample_count} pixels from area'
        }), 202

    except Exception as e:
        print(f"Error starting area sampling: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start sampling', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@campaigns_bp.route('/api/campaign-areas/sample/<workflow_id>/status', methods=['GET'])
@require_auth
def get_area_sampling_status(user, workflow_id):
    """Get status of area sampling workflow"""
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.campaign_area_sampling import CampaignAreaSamplingWorkflow
    from temporalio.client import WorkflowExecutionStatus

    try:
        async def get_status():
            client = await get_temporal_client()
            handle = client.get_workflow_handle(workflow_id)

            try:
                desc = await handle.describe()

                if desc.status == WorkflowExecutionStatus.RUNNING:
                    try:
                        progress = await handle.query(CampaignAreaSamplingWorkflow.get_progress)
                        return {
                            "workflow_id": workflow_id,
                            "status": "running",
                            "progress": progress
                        }
                    except Exception:
                        return {
                            "workflow_id": workflow_id,
                            "status": "running",
                            "progress": None
                        }
                elif desc.status == WorkflowExecutionStatus.COMPLETED:
                    result = await handle.result()
                    return {
                        "workflow_id": workflow_id,
                        "status": "completed",
                        "result": result
                    }
                elif desc.status == WorkflowExecutionStatus.FAILED:
                    error_message = "Workflow failed"
                    try:
                        await handle.result()
                    except Exception as e:
                        error_message = str(e)
                    return {
                        "workflow_id": workflow_id,
                        "status": "failed",
                        "error": error_message
                    }
                else:
                    return {
                        "workflow_id": workflow_id,
                        "status": desc.status.name.lower()
                    }
            except Exception as e:
                return {
                    "workflow_id": workflow_id,
                    "status": "failed",
                    "error": str(e)
                }

        status = run_async(get_status())
        return jsonify(status), 200

    except Exception as e:
        print(f"Error getting sampling workflow status: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to get workflow status', 'details': str(e)}), 500
