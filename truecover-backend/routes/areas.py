from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_project_access, check_area_access
from db.connection import get_db_connection, return_db_connection
import json

areas_bp = Blueprint('areas', __name__)


# ===== AREA ROUTES =====

@areas_bp.route('/api/projects/<project_id>/areas', methods=['POST'])
@require_auth
def create_area(user, project_id):
    """Create a new area within a project"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        data = request.get_json()

        # Validate required fields
        name = data.get('name')
        if not name or not name.strip():
            return jsonify({'error': 'Area name is required'}), 400

        description = data.get('description', '')

        conn = get_db_connection()
        cursor = conn.cursor()

        # Create area
        cursor.execute("""
            INSERT INTO areas (project_id, name, description)
            VALUES (%s, %s, %s)
            RETURNING id, project_id, name, description, created_at, updated_at;
        """, (project_id, name.strip(), description))

        area_data = cursor.fetchone()
        conn.commit()

        # Build response
        area = {
            'id': str(area_data[0]),
            'project_id': str(area_data[1]),
            'name': area_data[2],
            'description': area_data[3],
            'created_at': area_data[4].isoformat() if area_data[4] else None,
            'updated_at': area_data[5].isoformat() if area_data[5] else None
        }

        cursor.close()
        return jsonify(area), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating area: {e}")
        return jsonify({'error': 'Failed to create area', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@areas_bp.route('/api/projects/<project_id>/areas', methods=['GET'])
@require_auth
def list_areas(user, project_id):
    """Get all areas for a project"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, project_id, name, description, created_at, updated_at
            FROM areas
            WHERE project_id = %s
            ORDER BY created_at DESC
        """, (project_id,))

        areas = []
        for row in cursor.fetchall():
            areas.append({
                'id': str(row[0]),
                'project_id': str(row[1]),
                'name': row[2],
                'description': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'updated_at': row[5].isoformat() if row[5] else None
            })

        cursor.close()
        return jsonify({'areas': areas}), 200

    except Exception as e:
        print(f"Error listing areas: {e}")
        return jsonify({'error': 'Failed to list areas', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@areas_bp.route('/api/areas/<area_id>', methods=['GET'])
@require_auth
def get_area(user, area_id):
    """Get area details"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this area'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, project_id, name, description, created_at, updated_at
            FROM areas
            WHERE id = %s
        """, (area_id,))

        area_data = cursor.fetchone()

        if not area_data:
            cursor.close()
            return jsonify({'error': 'Area not found'}), 404

        area = {
            'id': str(area_data[0]),
            'project_id': str(area_data[1]),
            'name': area_data[2],
            'description': area_data[3],
            'created_at': area_data[4].isoformat() if area_data[4] else None,
            'updated_at': area_data[5].isoformat() if area_data[5] else None
        }

        cursor.close()
        return jsonify(area), 200

    except Exception as e:
        print(f"Error getting area: {e}")
        return jsonify({'error': 'Failed to get area', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@areas_bp.route('/api/areas/<area_id>', methods=['PUT'])
@require_auth
def update_area(user, area_id):
    """Update a area"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this area'}), 403

        data = request.get_json()

        # Extract allowed fields
        name = data.get('name')
        description = data.get('description')

        if not name and description is None:
            return jsonify({'error': 'No fields to update'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Update area
        if name and description is not None:
            cursor.execute("""
                UPDATE areas
                SET name = %s, description = %s, updated_at = NOW()
                WHERE id = %s
                RETURNING id, project_id, name, description, created_at, updated_at;
            """, (name.strip(), description, area_id))
        elif name:
            cursor.execute("""
                UPDATE areas
                SET name = %s, updated_at = NOW()
                WHERE id = %s
                RETURNING id, project_id, name, description, created_at, updated_at;
            """, (name.strip(), area_id))
        else:  # description only
            cursor.execute("""
                UPDATE areas
                SET description = %s, updated_at = NOW()
                WHERE id = %s
                RETURNING id, project_id, name, description, created_at, updated_at;
            """, (description, area_id))

        area_data = cursor.fetchone()

        if not area_data:
            cursor.close()
            return jsonify({'error': 'Area not found'}), 404

        conn.commit()

        area = {
            'id': str(area_data[0]),
            'project_id': str(area_data[1]),
            'name': area_data[2],
            'description': area_data[3],
            'created_at': area_data[4].isoformat() if area_data[4] else None,
            'updated_at': area_data[5].isoformat() if area_data[5] else None
        }

        cursor.close()
        return jsonify(area), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating area: {e}")
        return jsonify({'error': 'Failed to update area', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@areas_bp.route('/api/areas/<area_id>', methods=['DELETE'])
@require_auth
def delete_area(user, area_id):
    """Delete a area"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this area'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Delete area (cascade will delete features)
        cursor.execute("""
            DELETE FROM areas
            WHERE id = %s
            RETURNING id
        """, (area_id,))

        deleted = cursor.fetchone()

        if not deleted:
            cursor.close()
            return jsonify({'error': 'Area not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'message': 'Area deleted successfully'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting area: {e}")
        return jsonify({'error': 'Failed to delete area', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


# ===== AREA FEATURE ROUTES =====

def calculate_centroid(geometry):
    """
    Calculate centroid (latitude, longitude) from GeoJSON geometry.
    Returns (lat, lng) tuple.
    """
    if geometry['type'] == 'Point':
        return (geometry['coordinates'][1], geometry['coordinates'][0])
    elif geometry['type'] == 'Polygon':
        # Simple average of all coordinates
        coords = geometry['coordinates'][0]
        avg_lng = sum(c[0] for c in coords) / len(coords)
        avg_lat = sum(c[1] for c in coords) / len(coords)
        return (avg_lat, avg_lng)
    elif geometry['type'] == 'MultiPolygon':
        # Get first polygon's centroid
        coords = geometry['coordinates'][0][0]
        avg_lng = sum(c[0] for c in coords) / len(coords)
        avg_lat = sum(c[1] for c in coords) / len(coords)
        return (avg_lat, avg_lng)
    else:
        # Default to 0,0 for unknown types
        return (0, 0)


@areas_bp.route('/api/areas/<area_id>/features', methods=['POST'])
@require_auth
def add_features(user, area_id):
    """
    Add features to a area.
    Expects GeoJSON FeatureCollection or array of features.
    Each feature should have properties.id, properties.version, properties.sources, and geometry.
    """
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this area'}), 403

        data = request.get_json()

        # Handle both FeatureCollection and plain array of features
        if data.get('type') == 'FeatureCollection':
            features = data.get('features', [])
        elif isinstance(data, list):
            features = data
        else:
            features = [data]

        if not features:
            return jsonify({'error': 'No features provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        added_features = []

        for feature in features:
            # Extract properties
            props = feature.get('properties', {})
            feature_id = props.get('id')
            version = props.get('version', 1)
            sources = props.get('sources', [])
            geometry = feature.get('geometry')

            if not geometry:
                continue  # Skip features without geometry

            # Calculate centroid
            lat, lng = calculate_centroid(geometry)

            # Convert geometry and sources to proper format
            geojson_str = json.dumps(geometry)
            sources_json = json.dumps(sources) if isinstance(sources, (list, dict)) else sources

            # Insert feature
            if feature_id:
                # Use provided feature ID
                cursor.execute("""
                    INSERT INTO area_features (id, area_id, version, sources, geometry, latitude, longitude)
                    VALUES (%s, %s, %s, %s, ST_GeomFromGeoJSON(%s), %s, %s)
                    RETURNING id, area_id, version, sources, latitude, longitude, created_at, updated_at;
                """, (feature_id, area_id, version, sources_json, geojson_str, lat, lng))
            else:
                # Generate new feature ID
                cursor.execute("""
                    INSERT INTO area_features (area_id, version, sources, geometry, latitude, longitude)
                    VALUES (%s, %s, %s, ST_GeomFromGeoJSON(%s), %s, %s)
                    RETURNING id, area_id, version, sources, latitude, longitude, created_at, updated_at;
                """, (area_id, version, sources_json, geojson_str, lat, lng))

            feature_data = cursor.fetchone()
            added_features.append({
                'id': str(feature_data[0]),
                'area_id': str(feature_data[1]),
                'version': feature_data[2],
                'sources': feature_data[3],
                'latitude': float(feature_data[4]) if feature_data[4] else None,
                'longitude': float(feature_data[5]) if feature_data[5] else None,
                'created_at': feature_data[6].isoformat() if feature_data[6] else None,
                'updated_at': feature_data[7].isoformat() if feature_data[7] else None
            })

        conn.commit()
        cursor.close()

        return jsonify({
            'message': f'Added {len(added_features)} features',
            'features': added_features
        }), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error adding features: {e}")
        return jsonify({'error': 'Failed to add features', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@areas_bp.route('/api/areas/<area_id>/features', methods=['GET'])
@require_auth
def get_features(user, area_id):
    """
    Get all features for a area.
    Supports optional bounding box filtering: ?bbox=minLng,minLat,maxLng,maxLat
    Supports pagination: ?limit=100&offset=0
    """
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this area'}), 403

        # Get query parameters
        bbox = request.args.get('bbox')
        limit = request.args.get('limit', type=int, default=1000)
        offset = request.args.get('offset', type=int, default=0)

        conn = get_db_connection()
        cursor = conn.cursor()

        # Build query based on bbox filter
        if bbox:
            try:
                min_lng, min_lat, max_lng, max_lat = map(float, bbox.split(','))
                cursor.execute("""
                    SELECT id, area_id, version, sources,
                           ST_AsGeoJSON(geometry) as geometry,
                           latitude, longitude, created_at, updated_at
                    FROM area_features
                    WHERE area_id = %s
                      AND latitude BETWEEN %s AND %s
                      AND longitude BETWEEN %s AND %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """, (area_id, min_lat, max_lat, min_lng, max_lng, limit, offset))
            except ValueError:
                return jsonify({'error': 'Invalid bbox format. Expected: minLng,minLat,maxLng,maxLat'}), 400
        else:
            cursor.execute("""
                SELECT id, area_id, version, sources,
                       ST_AsGeoJSON(geometry) as geometry,
                       latitude, longitude, created_at, updated_at
                FROM area_features
                WHERE area_id = %s
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """, (area_id, limit, offset))

        features = []
        for row in cursor.fetchall():
            features.append({
                'id': str(row[0]),
                'area_id': str(row[1]),
                'version': row[2],
                'sources': row[3],
                'geometry': json.loads(row[4]) if row[4] else None,
                'latitude': float(row[5]) if row[5] else None,
                'longitude': float(row[6]) if row[6] else None,
                'created_at': row[7].isoformat() if row[7] else None,
                'updated_at': row[8].isoformat() if row[8] else None
            })

        cursor.close()
        return jsonify({'features': features, 'count': len(features)}), 200

    except Exception as e:
        print(f"Error getting features: {e}")
        return jsonify({'error': 'Failed to get features', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@areas_bp.route('/api/areas/<area_id>/geojson', methods=['GET'])
@require_auth
def export_geojson(user, area_id):
    """Export area features as GeoJSON FeatureCollection"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this area'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, version, sources, ST_AsGeoJSON(geometry) as geometry
            FROM area_features
            WHERE area_id = %s
            ORDER BY created_at
        """, (area_id,))

        features = []
        for row in cursor.fetchall():
            features.append({
                'type': 'Feature',
                'properties': {
                    'id': str(row[0]),
                    'version': row[1],
                    'sources': row[2]
                },
                'geometry': json.loads(row[3]) if row[3] else None
            })

        cursor.close()

        feature_collection = {
            'type': 'FeatureCollection',
            'features': features
        }

        return jsonify(feature_collection), 200

    except Exception as e:
        print(f"Error exporting GeoJSON: {e}")
        return jsonify({'error': 'Failed to export GeoJSON', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@areas_bp.route('/api/areas/<area_id>/features/<feature_id>', methods=['DELETE'])
@require_auth
def delete_feature(user, area_id, feature_id):
    """Delete a specific feature from a area"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this area'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Delete feature
        cursor.execute("""
            DELETE FROM area_features
            WHERE id = %s AND area_id = %s
            RETURNING id
        """, (feature_id, area_id))

        deleted = cursor.fetchone()

        if not deleted:
            cursor.close()
            return jsonify({'error': 'Feature not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'message': 'Feature deleted successfully'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting feature: {e}")
        return jsonify({'error': 'Failed to delete feature', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
