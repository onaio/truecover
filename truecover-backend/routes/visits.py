from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection
import uuid
import json
from datetime import datetime

visits_bp = Blueprint('visits', __name__)


@visits_bp.route('/api/visits/bulk', methods=['POST'])
@require_auth
def create_visits_bulk(user):
    """Create multiple visit indicators with indicator data (auto-creates locations if needed)"""
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

        # Create ONE upload ID for this entire upload session
        upload_id = str(uuid.uuid4())

        # Process all locations
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

                # Create visit_indicator record using the shared upload_id
                cursor.execute("""
                    INSERT INTO visit_indicators (upload_id, round_id, location_id, indicator_id, n_trials, n_covered)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (upload_id, round_id, actual_location_id, indicator_id, n_trials, n_covered))

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
