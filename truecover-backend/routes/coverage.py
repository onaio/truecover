from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection
import requests
import json
import os

coverage_bp = Blueprint('coverage', __name__)


def parse_json_response(response):
    """
    Parse JSON from response, handling cases where extra data precedes or follows the JSON.
    Uses JSONDecoder to extract the first valid JSON object and ignores surrounding data.
    """
    try:
        # First try the standard method
        return response.json()
    except (ValueError, json.JSONDecodeError) as e:
        # If that fails, try to find JSON in the text
        text = response.text
        decoder = json.JSONDecoder()

        # Try to find the start of JSON by looking for common JSON start characters
        # JSON can start with {, [, ", or a number/boolean/null
        json_start_chars = ['{', '[', '"', 't', 'f', 'n', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-']

        # Try each position in the text
        for i in range(len(text)):
            if text[i] in json_start_chars:
                try:
                    obj, idx = decoder.raw_decode(text[i:])

                    # Log if there was data before the JSON
                    if i > 0:
                        prefix_data = text[:min(i, 200)]
                        print(f"Warning: Data before JSON (showing first 200 chars): {prefix_data}")

                    # Log if there was extra data after the JSON
                    if i + idx < len(text):
                        extra_data = text[i+idx:i+idx+200]
                        print(f"Warning: Extra data after JSON (showing first 200 chars): {extra_data}")

                    return obj
                except (ValueError, json.JSONDecodeError):
                    # Not valid JSON at this position, try next
                    continue

        # If we get here, no valid JSON was found
        raise ValueError(f"No valid JSON found in response: {text[:500]}")

PREVALENCE_PREDICTOR_URL = os.getenv('DOCKER_FN_PREVALENCE_URL', 'http://localhost:8084')


@coverage_bp.route('/api/coverage/predict', methods=['POST'])
@require_auth
def predict_coverage(user):
    """Generate coverage predictions for an indicator"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        area_id = data.get('area_id')
        indicator_id = data.get('indicator_id')

        if not area_id or not indicator_id:
            return jsonify({'error': 'area_id and indicator_id are required'}), 400

        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get next version number for this indicator
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1
            FROM coverage
            WHERE indicator_id = %s
        """, (indicator_id,))

        version_result = cursor.fetchone()
        version = version_result[0] if version_result else 1

        # Join locations with visit_indicators for selected indicator (all rounds)
        cursor.execute("""
            SELECT
                l.id,
                l.area_id,
                ST_AsGeoJSON(l.geometry) as geometry,
                vi.n_trials,
                vi.n_covered,
                vi.round_id
            FROM locations l
            JOIN visit_indicators vi ON l.id = vi.location_id
            WHERE vi.indicator_id = %s
              AND l.area_id = %s
        """, (indicator_id, area_id))

        location_data = cursor.fetchall()

        if not location_data:
            cursor.close()
            return jsonify({'error': 'No visit data found for this indicator'}), 404

        # Format as GeoJSON for prevalence predictor
        features = []
        for row in location_data:
            location_id, area_id_db, geometry_json, n_trials, n_covered, round_id_db = row

            # Parse the geometry JSON from PostGIS
            import json as json_module
            geometry = json_module.loads(geometry_json) if geometry_json else None

            if not geometry:
                continue  # Skip locations without geometry

            features.append({
                'type': 'Feature',
                'properties': {
                    'id': str(location_id),
                    'n_trials': int(n_trials),
                    'n_positive': int(n_covered)  # Note: predictor expects n_positive
                },
                'geometry': geometry
            })

        geojson_data = {
            'type': 'FeatureCollection',
            'features': features
        }

        # Wrap in point_data parameter as expected by prevalence predictor
        # Include exceedance_threshold and layer_names to match working format in App.tsx
        payload = {
            'point_data': geojson_data,
            'exceedance_threshold': 0.5,
            'layer_names': []
        }

        # Call prevalence predictor
        print(f"Calling prevalence predictor with {len(features)} locations...")
        print(f"DEBUG: First feature sample: {json.dumps(features[0] if features else {}, indent=2)}")
        print(f"DEBUG: Payload structure - has point_data: {'point_data' in payload}")
        print(f"DEBUG: Payload point_data type: {type(payload.get('point_data'))}")
        print(f"DEBUG: Payload point_data has features: {'features' in payload.get('point_data', {})}")
        print(f"DEBUG: Number of features in point_data: {len(payload.get('point_data', {}).get('features', []))}")

        # Print first 1000 chars of the actual JSON payload
        payload_json = json.dumps(payload)
        print(f"DEBUG: Payload JSON (first 1000 chars): {payload_json[:1000]}")

        try:
            # Note: The prevalence predictor has a longer timeout (910 seconds max)
            response = requests.post(
                PREVALENCE_PREDICTOR_URL,
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=920  # Slightly longer than the function's exec_timeout
            )

            print(f"DEBUG: Response status code: {response.status_code}")
            print(f"DEBUG: Response text (first 1000 chars): {response.text[:1000]}")

            # Try to parse JSON response, handling extra data after JSON
            try:
                prediction_result = parse_json_response(response)
                print(f"DEBUG: Successfully parsed response")
                print(f"DEBUG: Response keys: {prediction_result.keys() if isinstance(prediction_result, dict) else 'Not a dict'}")
                print(f"DEBUG: Response type: {type(prediction_result)}")
                if isinstance(prediction_result, dict):
                    print(f"DEBUG: Response structure sample: {json.dumps({k: type(v).__name__ for k, v in list(prediction_result.items())[:5]})}")
            except (ValueError, json.JSONDecodeError) as json_error:
                cursor.close()
                print(f"JSON parsing error from prevalence predictor: {json_error}")
                print(f"Raw response (first 1000 chars): {response.text[:1000]}")
                return jsonify({
                    'error': 'Invalid JSON response from prevalence predictor',
                    'details': str(json_error),
                    'raw_response_preview': response.text[:500]
                }), 500

        except requests.exceptions.Timeout:
            cursor.close()
            return jsonify({'error': 'Request to prevalence predictor timed out'}), 504
        except requests.exceptions.RequestException as e:
            cursor.close()
            print(f"Error calling prevalence predictor: {e}")
            return jsonify({
                'error': 'Failed to call prevalence predictor service',
                'details': str(e)
            }), 500

        # Check if response indicates an error
        if response.status_code != 200:
            cursor.close()
            print(f"ERROR: Prevalence predictor returned status code {response.status_code}")
            return jsonify({
                'error': f'Prevalence predictor returned error status {response.status_code}',
                'details': prediction_result if isinstance(prediction_result, dict) else str(prediction_result)
            }), 500

        # Parse results and insert into coverage table
        if 'features' not in prediction_result:
            cursor.close()
            return jsonify({
                'error': 'Invalid response from prevalence predictor',
                'details': 'Expected FeatureCollection with features'
            }), 500

        inserted_count = 0
        errors = []

        for feature in prediction_result['features']:
            try:
                props = feature.get('properties', {})
                location_id = props.get('id')

                if not location_id:
                    errors.append('Missing location ID in prediction result')
                    continue

                # Find corresponding location data
                location_match = None
                for row in location_data:
                    if str(row[0]) == location_id:
                        location_match = row
                        break

                if not location_match:
                    errors.append(f'Location {location_id} not found in original data')
                    continue

                _, area_id_db, _, _, n_trials, n_covered, round_id_db = location_match

                # Insert coverage record
                cursor.execute("""
                    INSERT INTO coverage (
                        location_id, area_id, indicator_id, round_id, version,
                        n_trials, n_covered,
                        exceedance_probability, exceedance_uncertainty,
                        prevalence_bci_width, prevalence_prediction
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    location_id,
                    area_id_db,
                    indicator_id,
                    round_id_db,
                    version,
                    n_trials,
                    n_covered,
                    props.get('exceedance_probability'),
                    props.get('exceedance_uncertainty'),
                    props.get('prevalence_bci_width'),
                    props.get('prevalence_prediction')
                ))

                inserted_count += 1

            except Exception as e:
                errors.append(f'Error processing location {location_id}: {str(e)}')
                continue

        conn.commit()
        cursor.close()

        return jsonify({
            'success': True,
            'version': version,
            'total_locations': len(features),
            'inserted': inserted_count,
            'errors': errors
        }), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error generating coverage predictions: {e}")
        return jsonify({
            'error': 'Failed to generate coverage predictions',
            'details': str(e)
        }), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/areas/<area_id>/coverage', methods=['GET'])
@require_auth
def list_area_coverage(user, area_id):
    """Get all coverage records for an area with optional filtering"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get query parameters for filtering
        indicator_id = request.args.get('indicator_id')
        round_id = request.args.get('round_id')

        # Build dynamic query based on filters
        query = """
            SELECT
                c.id, c.location_id, c.area_id, c.indicator_id, c.round_id, c.version,
                c.n_trials, c.n_covered,
                c.exceedance_probability, c.exceedance_uncertainty,
                c.prevalence_bci_width, c.prevalence_prediction,
                c.created_at, c.updated_at,
                l.latitude, l.longitude, l.external_id,
                i.name as indicator_name
            FROM coverage c
            JOIN locations l ON c.location_id = l.id
            JOIN indicators i ON c.indicator_id = i.id
            WHERE c.area_id = %s
        """
        params = [area_id]

        if indicator_id:
            query += " AND c.indicator_id = %s"
            params.append(indicator_id)

        if round_id:
            query += " AND c.round_id = %s"
            params.append(round_id)

        query += " ORDER BY c.created_at DESC"

        cursor.execute(query, tuple(params))

        coverage_records = []
        for row in cursor.fetchall():
            coverage_records.append({
                'id': str(row[0]),
                'location_id': str(row[1]),
                'area_id': str(row[2]),
                'indicator_id': str(row[3]),
                'round_id': str(row[4]) if row[4] else None,
                'version': row[5],
                'n_trials': row[6],
                'n_covered': row[7],
                'exceedance_probability': float(row[8]) if row[8] is not None else None,
                'exceedance_uncertainty': float(row[9]) if row[9] is not None else None,
                'prevalence_bci_width': float(row[10]) if row[10] is not None else None,
                'prevalence_prediction': float(row[11]) if row[11] is not None else None,
                'created_at': row[12].isoformat() if row[12] else None,
                'updated_at': row[13].isoformat() if row[13] else None,
                'latitude': float(row[14]) if row[14] is not None else None,
                'longitude': float(row[15]) if row[15] is not None else None,
                'external_id': row[16],
                'indicator_name': row[17]
            })

        cursor.close()
        return jsonify({'coverage': coverage_records}), 200

    except Exception as e:
        print(f"Error listing area coverage: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to list coverage', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/areas/<area_id>/coverage/geojson', methods=['GET'])
@require_auth
def get_coverage_geojson(user, area_id):
    """Get coverage data as GeoJSON with geometries from locations table"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get query parameters for filtering
        indicator_id = request.args.get('indicator_id')
        round_id = request.args.get('round_id')

        # Build dynamic query - left join coverage with locations
        query = """
            SELECT
                c.id, c.location_id, c.area_id, c.indicator_id, c.round_id, c.version,
                c.n_trials, c.n_covered,
                c.exceedance_probability, c.exceedance_uncertainty,
                c.prevalence_bci_width, c.prevalence_prediction,
                l.latitude, l.longitude, l.external_id,
                ST_AsGeoJSON(l.geometry) as geometry,
                l.properties,
                i.name as indicator_name
            FROM coverage c
            LEFT JOIN locations l ON c.location_id = l.id
            LEFT JOIN indicators i ON c.indicator_id = i.id
            WHERE c.area_id = %s
        """
        params = [area_id]

        if indicator_id:
            query += " AND c.indicator_id = %s"
            params.append(indicator_id)

        if round_id:
            query += " AND c.round_id = %s"
            params.append(round_id)

        query += " ORDER BY c.created_at DESC"

        cursor.execute(query, tuple(params))

        features = []
        for row in cursor.fetchall():
            # Parse geometry from PostGIS
            geometry = json.loads(row[15]) if row[15] else {
                'type': 'Point',
                'coordinates': [float(row[13]), float(row[12])]  # lng, lat
            }

            # Get location properties
            location_props = row[16] if isinstance(row[16], dict) else json.loads(row[16]) if row[16] else {}

            # Build feature properties with coverage data
            properties = {
                'coverage_id': str(row[0]),
                'location_id': str(row[1]),
                'external_id': row[14],
                'indicator_id': str(row[3]),
                'indicator_name': row[17],
                'round_id': str(row[4]) if row[4] else None,
                'version': row[5],
                'n_trials': row[6],
                'n_covered': row[7],
                'exceedance_probability': float(row[8]) if row[8] is not None else 0,
                'exceedance_uncertainty': float(row[9]) if row[9] is not None else 0,
                'prevalence_bci_width': float(row[10]) if row[10] is not None else 0,
                'prevalence_prediction': float(row[11]) if row[11] is not None else 0,
                'latitude': float(row[12]) if row[12] is not None else None,
                'longitude': float(row[13]) if row[13] is not None else None,
            }

            # Merge with location properties
            properties.update(location_props)

            feature = {
                'type': 'Feature',
                'id': str(row[0]),  # Use coverage ID as feature ID
                'geometry': geometry,
                'properties': properties
            }
            features.append(feature)

        cursor.close()

        geojson = {
            'type': 'FeatureCollection',
            'features': features
        }

        return jsonify(geojson), 200

    except Exception as e:
        print(f"Error getting coverage GeoJSON: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to get coverage GeoJSON', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/coverage/indicator/<indicator_id>', methods=['GET'])
@require_auth
def list_coverage_versions(user, indicator_id):
    """Get all coverage versions for an indicator"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get distinct versions with metadata
        cursor.execute("""
            SELECT
                c.version,
                COUNT(*) as location_count,
                MIN(c.created_at) as created_at,
                c.round_id,
                r.name as round_name
            FROM coverage c
            JOIN rounds r ON c.round_id = r.id
            WHERE c.indicator_id = %s
            GROUP BY c.version, c.round_id, r.name
            ORDER BY c.version DESC
        """, (indicator_id,))

        versions = []
        for row in cursor.fetchall():
            versions.append({
                'version': row[0],
                'location_count': row[1],
                'created_at': row[2].isoformat() if row[2] else None,
                'round_id': str(row[3]),
                'round_name': row[4]
            })

        cursor.close()
        return jsonify({'versions': versions}), 200

    except Exception as e:
        print(f"Error listing coverage versions: {e}")
        return jsonify({'error': 'Failed to list coverage versions', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/coverage/version/<indicator_id>/<int:version>', methods=['GET'])
@require_auth
def get_coverage_by_version(user, indicator_id, version):
    """Get all coverage records for a specific version"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                c.id, c.location_id, c.area_id, c.indicator_id, c.round_id, c.version,
                c.n_trials, c.n_covered,
                c.exceedance_probability, c.exceedance_uncertainty,
                c.prevalence_bci_width, c.prevalence_prediction,
                c.created_at, c.updated_at,
                l.latitude, l.longitude
            FROM coverage c
            JOIN locations l ON c.location_id = l.id
            WHERE c.indicator_id = %s AND c.version = %s
            ORDER BY c.created_at ASC
        """, (indicator_id, version))

        coverage_records = []
        for row in cursor.fetchall():
            coverage_records.append({
                'id': str(row[0]),
                'location_id': str(row[1]),
                'area_id': str(row[2]),
                'indicator_id': str(row[3]),
                'round_id': str(row[4]),
                'version': row[5],
                'n_trials': row[6],
                'n_covered': row[7],
                'exceedance_probability': float(row[8]) if row[8] is not None else None,
                'exceedance_uncertainty': float(row[9]) if row[9] is not None else None,
                'prevalence_bci_width': float(row[10]) if row[10] is not None else None,
                'prevalence_prediction': float(row[11]) if row[11] is not None else None,
                'created_at': row[12].isoformat() if row[12] else None,
                'updated_at': row[13].isoformat() if row[13] else None,
                'latitude': float(row[14]) if row[14] is not None else None,
                'longitude': float(row[15]) if row[15] is not None else None
            })

        cursor.close()
        return jsonify({'coverage': coverage_records}), 200

    except Exception as e:
        print(f"Error getting coverage by version: {e}")
        return jsonify({'error': 'Failed to get coverage', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/coverage/version/<indicator_id>/<int:version>', methods=['DELETE'])
@require_auth
def delete_coverage_version(user, indicator_id, version):
    """Delete all coverage records for a specific version"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify user has access by checking area_id
        cursor.execute("""
            SELECT DISTINCT area_id FROM coverage
            WHERE indicator_id = %s AND version = %s
            LIMIT 1
        """, (indicator_id, version))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Coverage version not found'}), 404

        area_id = str(result[0])
        if not check_area_access(user['id'], area_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Delete all coverage records for this version
        cursor.execute("""
            DELETE FROM coverage
            WHERE indicator_id = %s AND version = %s
        """, (indicator_id, version))

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting coverage version: {e}")
        return jsonify({'error': 'Failed to delete coverage version', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
