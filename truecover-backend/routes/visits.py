from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection
import uuid

visits_bp = Blueprint('visits', __name__)


@visits_bp.route('/api/visits', methods=['POST'])
@require_auth
def create_visit(user):
    """Create a new visit (auto-creates location if needed)"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        area_id = data.get('area_id')
        round_id = data.get('round_id')
        location_id = data.get('location_id')
        latitude = data.get('latitude')
        longitude = data.get('longitude')
        properties = data.get('properties', {})

        if not area_id or not round_id:
            return jsonify({'error': 'area_id and round_id are required'}), 400

        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # If no location_id provided, create a new location
        if not location_id:
            if not latitude or not longitude:
                cursor.close()
                return jsonify({'error': 'Either location_id or latitude/longitude must be provided'}), 400

            # Create new location
            cursor.execute("""
                INSERT INTO locations (area_id, latitude, longitude, geometry)
                VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                RETURNING id
            """, (area_id, latitude, longitude, longitude, latitude))

            location_result = cursor.fetchone()
            location_id = str(location_result[0])
        else:
            # Verify the location exists and belongs to the correct area
            cursor.execute("""
                SELECT id, latitude, longitude
                FROM locations
                WHERE id = %s AND area_id = %s
            """, (location_id, area_id))

            location_result = cursor.fetchone()
            if not location_result:
                cursor.close()
                return jsonify({'error': 'Location not found or does not belong to this area'}), 404

            # Use location's coordinates if not provided
            if not latitude:
                latitude = location_result[1]
            if not longitude:
                longitude = location_result[2]

        # Create visit
        cursor.execute("""
            INSERT INTO visits (location_id, area_id, round_id, latitude, longitude, properties)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, location_id, area_id, round_id, latitude, longitude, properties, created_at, updated_at
        """, (location_id, area_id, round_id, latitude, longitude, str(properties) if isinstance(properties, dict) else properties))

        visit_data = cursor.fetchone()
        conn.commit()

        visit = {
            'id': str(visit_data[0]),
            'location_id': str(visit_data[1]),
            'area_id': str(visit_data[2]),
            'round_id': str(visit_data[3]),
            'latitude': float(visit_data[4]) if visit_data[4] else None,
            'longitude': float(visit_data[5]) if visit_data[5] else None,
            'properties': visit_data[6],
            'created_at': visit_data[7].isoformat() if visit_data[7] else None,
            'updated_at': visit_data[8].isoformat() if visit_data[8] else None
        }

        cursor.close()
        return jsonify(visit), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating visit: {e}")
        return jsonify({'error': 'Failed to create visit', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visits_bp.route('/api/visits/bulk', methods=['POST'])
@require_auth
def create_visits_bulk(user):
    """Create multiple visits with indicator data (auto-creates locations if needed)"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        visits_data = data.get('visits', [])
        if not visits_data:
            return jsonify({'error': 'visits array is required'}), 400

        area_id = visits_data[0].get('area_id')
        round_id = visits_data[0].get('round_id')
        indicator_id = visits_data[0].get('indicator_id')

        if not area_id or not round_id or not indicator_id:
            return jsonify({'error': 'area_id, round_id, and indicator_id are required'}), 400

        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        matched_locations = 0
        new_locations = 0
        total_processed = 0
        errors = []

        for visit_data in visits_data:
            try:
                uploaded_location_id = visit_data.get('location_id')
                latitude = visit_data.get('latitude')
                longitude = visit_data.get('longitude')
                n_trials = visit_data.get('n_trials')
                n_covered = visit_data.get('n_covered')
                geometry = visit_data.get('geometry')

                if not latitude or not longitude:
                    errors.append(f"Missing coordinates for location {uploaded_location_id or 'unknown'}")
                    continue

                if n_trials is None or n_covered is None:
                    errors.append(f"Missing n_trials or n_covered for location {uploaded_location_id or 'unknown'}")
                    continue

                actual_location_id = None

                # Check if uploaded_location_id matches existing location
                if uploaded_location_id:
                    cursor.execute("""
                        SELECT id FROM locations
                        WHERE id = %s AND area_id = %s
                    """, (uploaded_location_id, area_id))

                    location_result = cursor.fetchone()
                    if location_result:
                        actual_location_id = str(location_result[0])
                        matched_locations += 1

                # If no match or empty, create new location
                if not actual_location_id:
                    # Create geometry Point from coordinates
                    cursor.execute("""
                        INSERT INTO locations (area_id, external_id, latitude, longitude, geometry)
                        VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                        RETURNING id
                    """, (area_id, uploaded_location_id, latitude, longitude, longitude, latitude))

                    location_result = cursor.fetchone()
                    actual_location_id = str(location_result[0])
                    new_locations += 1

                # Create a unique visit for this location
                visit_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO visits (id, location_id, area_id, round_id, latitude, longitude, properties)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (visit_id, actual_location_id, area_id, round_id, latitude, longitude, '{}'))

                # Create visit_indicator record
                cursor.execute("""
                    INSERT INTO visit_indicators (visit_id, location_id, indicator_id, n_trials, n_covered)
                    VALUES (%s, %s, %s, %s, %s)
                """, (visit_id, actual_location_id, indicator_id, n_trials, n_covered))

                total_processed += 1

            except Exception as e:
                errors.append(f"Error processing location {uploaded_location_id or 'unknown'}: {str(e)}")
                continue

        conn.commit()
        cursor.close()

        return jsonify({
            'success': True,
            'summary': {
                'total_processed': total_processed,
                'matched_locations': matched_locations,
                'new_locations': new_locations,
                'errors': errors
            }
        }), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating visits in bulk: {e}")
        return jsonify({'error': 'Failed to create visits', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visits_bp.route('/api/rounds/<round_id>/visits', methods=['GET'])
@require_auth
def list_visits_by_round(user, round_id):
    """Get all visits for a round"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify round exists and user has access
        cursor.execute("""
            SELECT r.area_id
            FROM rounds r
            WHERE r.id = %s
        """, (round_id,))

        round_result = cursor.fetchone()
        if not round_result:
            cursor.close()
            return jsonify({'error': 'Round not found'}), 404

        area_id = str(round_result[0])
        if not check_area_access(user['id'], area_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        cursor.execute("""
            SELECT id, location_id, area_id, round_id, latitude, longitude, properties, created_at, updated_at
            FROM visits
            WHERE round_id = %s
            ORDER BY created_at DESC
        """, (round_id,))

        visits = []
        for row in cursor.fetchall():
            visits.append({
                'id': str(row[0]),
                'location_id': str(row[1]),
                'area_id': str(row[2]),
                'round_id': str(row[3]),
                'latitude': float(row[4]) if row[4] else None,
                'longitude': float(row[5]) if row[5] else None,
                'properties': row[6],
                'created_at': row[7].isoformat() if row[7] else None,
                'updated_at': row[8].isoformat() if row[8] else None
            })

        cursor.close()
        return jsonify({'visits': visits}), 200

    except Exception as e:
        print(f"Error listing visits: {e}")
        return jsonify({'error': 'Failed to list visits', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visits_bp.route('/api/visits/<visit_id>', methods=['GET'])
@require_auth
def get_visit(user, visit_id):
    """Get details of a specific visit"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, location_id, area_id, round_id, latitude, longitude, properties, created_at, updated_at
            FROM visits
            WHERE id = %s
        """, (visit_id,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        # Check if user has access to this visit's area
        area_id = str(row[2])
        if not check_area_access(user['id'], area_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        visit = {
            'id': str(row[0]),
            'location_id': str(row[1]),
            'area_id': str(row[2]),
            'round_id': str(row[3]),
            'latitude': float(row[4]) if row[4] else None,
            'longitude': float(row[5]) if row[5] else None,
            'properties': row[6],
            'created_at': row[7].isoformat() if row[7] else None,
            'updated_at': row[8].isoformat() if row[8] else None
        }

        cursor.close()
        return jsonify(visit), 200

    except Exception as e:
        print(f"Error getting visit: {e}")
        return jsonify({'error': 'Failed to get visit', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visits_bp.route('/api/visits/<visit_id>', methods=['PUT'])
@require_auth
def update_visit(user, visit_id):
    """Update a visit"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify visit exists and get area_id
        cursor.execute("""
            SELECT area_id FROM visits
            WHERE id = %s
        """, (visit_id,))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        area_id = str(result[0])

        # Check if user has access to this visit's area
        if not check_area_access(user['id'], area_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Update visit
        cursor.execute("""
            UPDATE visits
            SET
                latitude = COALESCE(%s, latitude),
                longitude = COALESCE(%s, longitude),
                properties = COALESCE(%s, properties),
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, location_id, area_id, round_id, latitude, longitude, properties, created_at, updated_at
        """, (
            data.get('latitude'),
            data.get('longitude'),
            str(data.get('properties')) if data.get('properties') else None,
            visit_id
        ))

        visit_data = cursor.fetchone()
        if not visit_data:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        conn.commit()

        visit = {
            'id': str(visit_data[0]),
            'location_id': str(visit_data[1]),
            'area_id': str(visit_data[2]),
            'round_id': str(visit_data[3]),
            'latitude': float(visit_data[4]) if visit_data[4] else None,
            'longitude': float(visit_data[5]) if visit_data[5] else None,
            'properties': visit_data[6],
            'created_at': visit_data[7].isoformat() if visit_data[7] else None,
            'updated_at': visit_data[8].isoformat() if visit_data[8] else None
        }

        cursor.close()
        return jsonify(visit), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating visit: {e}")
        return jsonify({'error': 'Failed to update visit', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visits_bp.route('/api/visits/<visit_id>', methods=['DELETE'])
@require_auth
def delete_visit(user, visit_id):
    """Delete a visit"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify visit exists and get area_id
        cursor.execute("""
            SELECT area_id FROM visits
            WHERE id = %s
        """, (visit_id,))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        area_id = str(result[0])

        # Check if user has access to this visit's area
        if not check_area_access(user['id'], area_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Delete visit (will cascade to visit_indicators)
        cursor.execute("""
            DELETE FROM visits
            WHERE id = %s
            RETURNING id
        """, (visit_id,))

        deleted = cursor.fetchone()
        if not deleted:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting visit: {e}")
        return jsonify({'error': 'Failed to delete visit', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
