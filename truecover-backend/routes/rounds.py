from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection
import json
import requests
import os

rounds_bp = Blueprint('rounds', __name__)

# Docker function URL for adaptive sampling
SAMPLING_URL = os.getenv('DOCKER_FN_SAMPLING_URL', 'http://localhost:8083')


@rounds_bp.route('/api/areas/<area_id>/rounds', methods=['POST'])
@require_auth
def create_round(user, area_id):
    """Create a new round and run adaptive sampling on locations"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        name = data.get('name')
        description = data.get('description', '')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        batch_size = data.get('batch_size', 10)
        uncertainty_field = data.get('uncertainty_field', 'exceedance_uncertainty')
        allow_revisit = data.get('allow_revisit', False)

        if not name:
            return jsonify({'error': 'Round name is required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get the next round number for this area
        cursor.execute("""
            SELECT COALESCE(MAX(round_number), 0) + 1
            FROM rounds
            WHERE area_id = %s
        """, (area_id,))
        round_number = cursor.fetchone()[0]

        # Create the round
        cursor.execute("""
            INSERT INTO rounds (area_id, round_number, name, description, start_date, end_date)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, round_number, name, description, start_date, end_date, created_at, updated_at
        """, (area_id, round_number, name, description, start_date, end_date))

        round_data = cursor.fetchone()
        round_id = str(round_data[0])

        # Fetch locations for this area
        cursor.execute("""
            SELECT
                id,
                ST_AsGeoJSON(geometry) as geometry,
                latitude, longitude,
                exceedance_probability, exceedance_uncertainty,
                prevalence_bci_width, prevalence_prediction,
                adaptively_selected, properties, external_id
            FROM locations
            WHERE area_id = %s
        """, (area_id,))

        locations = cursor.fetchall()

        if not locations:
            conn.rollback()
            cursor.close()
            return jsonify({'error': 'No locations found in this area'}), 400

        # Convert locations to GeoJSON for adaptive sampling
        features = []
        location_ids = {}
        for idx, loc in enumerate(locations):
            geometry = json.loads(loc[1]) if loc[1] else {
                'type': 'Point',
                'coordinates': [float(loc[3]), float(loc[2])]
            }

            properties = loc[9] if isinstance(loc[9], dict) else json.loads(loc[9]) if loc[9] else {}
            external_id = loc[10]
            properties.update({
                'exceedance_probability': float(loc[4]) if loc[4] else 0,
                'exceedance_uncertainty': float(loc[5]) if loc[5] else 0,
                'prevalence_bci_width': float(loc[6]) if loc[6] else 0,
                'prevalence_prediction': float(loc[7]) if loc[7] else 0,
                'adaptively_selected': loc[8] if loc[8] else 0,
                'external_id': external_id,
            })

            feature = {
                'type': 'Feature',
                'id': idx,
                'geometry': geometry,
                'properties': properties
            }
            features.append(feature)
            # Map both by index and external_id for lookup
            location_ids[idx] = str(loc[0])
            if external_id:
                location_ids[external_id] = str(loc[0])

        geojson_data = {
            'type': 'FeatureCollection',
            'features': features
        }

        # Call adaptive sampling service
        sampling_request = {
            'point_data': geojson_data,
            'uncertainty_fieldname': uncertainty_field,
            'batch_size': batch_size
        }

        print(f"\n{'='*60}")
        print(f"CREATING ROUND {round_number} FOR AREA {area_id}")
        print(f"Total locations to process: {len(features)}")
        print(f"Batch size: {batch_size}")
        print(f"{'='*60}\n")

        try:
            response = requests.post(
                SAMPLING_URL,
                json=sampling_request,
                headers={'Content-Type': 'application/json'},
                timeout=120
            )

            if response.status_code != 200:
                conn.rollback()
                cursor.close()
                return jsonify({
                    'error': 'Adaptive sampling failed',
                    'details': response.text
                }), 500

            result = response.json()

            # Extract result if wrapped
            if result.get('function_status') == 'success' and result.get('result'):
                result = result['result']

            # Debug logging
            print(f"DEBUG: Adaptive sampling returned {len(result.get('features', []))} features")

            # Update locations with round assignment
            selected_count = 0
            if result.get('features'):
                for feature in result['features']:
                    feature_id = feature.get('id')
                    properties = feature.get('properties', {})
                    adaptively_selected = properties.get('adaptively_selected', 0)
                    external_id = properties.get('external_id')

                    print(f"DEBUG: Feature id={feature_id}, external_id={external_id}, adaptively_selected={adaptively_selected}")

                    if adaptively_selected == 1:
                        # Try to find location_id using feature_id first, then external_id
                        location_id = None
                        if feature_id is not None:
                            location_id = location_ids.get(feature_id)
                        if not location_id and external_id:
                            location_id = location_ids.get(external_id)

                        print(f"DEBUG: Selected location -> location_id={location_id}")
                        if location_id:
                            print(f"DEBUG: Location {location_id} selected for round {round_number}")
                            selected_count += 1
                        else:
                            print(f"DEBUG: WARNING - Could not find location_id for feature {feature_id}/{external_id}")

            print(f"DEBUG: Total selected_count: {selected_count}")

        except requests.exceptions.RequestException as e:
            conn.rollback()
            cursor.close()
            return jsonify({
                'error': 'Failed to call adaptive sampling service',
                'details': str(e)
            }), 500

        conn.commit()
        cursor.close()

        return jsonify({
            'success': True,
            'round': {
                'id': round_id,
                'round_number': round_data[1],
                'name': round_data[2],
                'description': round_data[3],
                'start_date': round_data[4].isoformat() if round_data[4] else None,
                'end_date': round_data[5].isoformat() if round_data[5] else None,
                'created_at': round_data[6].isoformat() if round_data[6] else None,
                'updated_at': round_data[7].isoformat() if round_data[7] else None,
            },
            'selected_count': selected_count
        }), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating round: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to create round', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@rounds_bp.route('/api/areas/<area_id>/rounds', methods=['GET'])
@require_auth
def list_rounds(user, area_id):
    """Get all rounds for an area"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                id, round_number, name, description,
                start_date, end_date, created_at, updated_at
            FROM rounds
            WHERE area_id = %s
            ORDER BY round_number ASC
        """, (area_id,))

        rounds = []
        for row in cursor.fetchall():
            # Count locations in this round
            cursor.execute("""
                SELECT COUNT(*)
                FROM locations
                WHERE area_id = %s AND %s = ANY(rounds)
            """, (area_id, row[1]))
            location_count = cursor.fetchone()[0]

            rounds.append({
                'id': str(row[0]),
                'round_number': row[1],
                'name': row[2],
                'description': row[3],
                'start_date': row[4].isoformat() if row[4] else None,
                'end_date': row[5].isoformat() if row[5] else None,
                'created_at': row[6].isoformat() if row[6] else None,
                'updated_at': row[7].isoformat() if row[7] else None,
                'location_count': location_count
            })

        cursor.close()
        return jsonify({'rounds': rounds}), 200

    except Exception as e:
        print(f"Error listing rounds: {e}")
        import traceback
        traceback.print_exc()
        # If the rounds table doesn't exist yet, return empty array
        if 'rounds' in str(e) and ('does not exist' in str(e) or 'relation' in str(e)):
            return jsonify({'rounds': []}), 200
        return jsonify({'error': 'Failed to list rounds', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@rounds_bp.route('/api/areas/<area_id>/rounds/<round_id>', methods=['GET'])
@require_auth
def get_round(user, area_id, round_id):
    """Get details of a specific round"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                id, round_number, name, description,
                start_date, end_date, created_at, updated_at
            FROM rounds
            WHERE id = %s AND area_id = %s
        """, (round_id, area_id))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Round not found'}), 404

        # Count locations in this round
        cursor.execute("""
            SELECT COUNT(*)
            FROM locations
            WHERE area_id = %s AND %s = ANY(rounds)
        """, (area_id, row[1]))
        location_count = cursor.fetchone()[0]

        round_data = {
            'id': str(row[0]),
            'round_number': row[1],
            'name': row[2],
            'description': row[3],
            'start_date': row[4].isoformat() if row[4] else None,
            'end_date': row[5].isoformat() if row[5] else None,
            'created_at': row[6].isoformat() if row[6] else None,
            'updated_at': row[7].isoformat() if row[7] else None,
            'location_count': location_count
        }

        cursor.close()
        return jsonify(round_data), 200

    except Exception as e:
        print(f"Error getting round: {e}")
        return jsonify({'error': 'Failed to get round', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@rounds_bp.route('/api/areas/<area_id>/rounds/<round_id>', methods=['PUT'])
@require_auth
def update_round(user, area_id, round_id):
    """Update round metadata"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify round exists
        cursor.execute("""
            SELECT id FROM rounds
            WHERE id = %s AND area_id = %s
        """, (round_id, area_id))

        if not cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'Round not found'}), 404

        # Update round
        cursor.execute("""
            UPDATE rounds
            SET
                name = COALESCE(%s, name),
                description = COALESCE(%s, description),
                start_date = COALESCE(%s, start_date),
                end_date = COALESCE(%s, end_date),
                updated_at = NOW()
            WHERE id = %s AND area_id = %s
        """, (
            data.get('name'),
            data.get('description'),
            data.get('start_date'),
            data.get('end_date'),
            round_id,
            area_id
        ))

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating round: {e}")
        return jsonify({'error': 'Failed to update round', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@rounds_bp.route('/api/areas/<area_id>/rounds/<round_id>', methods=['DELETE'])
@require_auth
def delete_round(user, area_id, round_id):
    """Delete a round and remove it from all locations"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get round number before deleting
        cursor.execute("""
            SELECT round_number FROM rounds
            WHERE id = %s AND area_id = %s
        """, (round_id, area_id))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Round not found'}), 404

        round_number = result[0]

        # Remove this round from all locations
        cursor.execute("""
            UPDATE locations
            SET rounds = array_remove(rounds, %s),
                updated_at = NOW()
            WHERE area_id = %s AND %s = ANY(rounds)
        """, (round_number, area_id, round_number))

        # Delete the round
        cursor.execute("""
            DELETE FROM rounds
            WHERE id = %s AND area_id = %s
        """, (round_id, area_id))

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting round: {e}")
        return jsonify({'error': 'Failed to delete round', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
