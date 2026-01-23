from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_campaign_access
from db.connection import get_db_connection, return_db_connection
from routes.locations import calculate_quadkey
import requests
import json
import os
import sys

coverage_bp = Blueprint('coverage', __name__)


def create_default_coverage_pixels(cursor, campaign_id, quadkeys):
    """
    Create default coverage_pixel records for newly created pixels.
    Creates records for all indicators in the project with zero values.

    Args:
        cursor: Database cursor
        campaign_id: UUID of the area
        quadkeys: List of quadkeys to create coverage_pixel records for
    """
    if not quadkeys:
        return

    try:
        # Get the project_id from the area
        cursor.execute("""
            SELECT project_id FROM areas WHERE id = %s
        """, (campaign_id,))
        result = cursor.fetchone()
        if not result:
            print(f"Warning: Could not find area {campaign_id}")
            return

        project_id = result[0]

        # Get all indicators for this project
        cursor.execute("""
            SELECT id FROM indicators WHERE project_id = %s
        """, (project_id,))
        indicators = cursor.fetchall()

        if not indicators:
            print(f"Info: No indicators found for project {project_id}, skipping coverage_pixel creation")
            return

        # Create coverage_pixel records for each quadkey and indicator
        records_to_create = []
        for quadkey in quadkeys:
            for indicator_row in indicators:
                indicator_id = indicator_row[0]

                # Check if coverage_pixel entry already exists
                cursor.execute("""
                    SELECT id FROM coverage_pixel
                    WHERE quadkey = %s AND indicator_id = %s AND campaign_id = %s AND version = 0
                """, (quadkey, indicator_id, campaign_id))

                if not cursor.fetchone():
                    # Doesn't exist, add to batch insert
                    records_to_create.append((quadkey, campaign_id, indicator_id))

        # Batch insert new coverage_pixel records with default values
        if records_to_create:
            cursor.executemany("""
                INSERT INTO coverage_pixel (
                    quadkey, campaign_id, indicator_id, version,
                    n_trials, n_covered, rounds,
                    exceedance_probability, exceedance_uncertainty,
                    prevalence_bci_width, prevalence_prediction
                )
                VALUES (%s, %s, %s, 0, 0, 0, '{}', 0, 0, 0, 0)
            """, records_to_create)
            print(f"Created {len(records_to_create)} default coverage_pixel records for {len(quadkeys)} quadkeys")

    except Exception as e:
        print(f"Error creating default coverage_pixel records: {e}")
        import traceback
        traceback.print_exc()
        # Don't fail the pixel creation if this fails


def update_coverage_pixel(cursor, campaign_id, indicator_id, quadkeys=None):
    """
    Update coverage_pixel table by aggregating coverage data by quadkey.

    Args:
        cursor: Database cursor
        campaign_id: UUID of the area
        indicator_id: UUID of the indicator
        quadkeys: Optional list of specific quadkeys to update. If None, updates all quadkeys for this area/indicator.
    """
    try:
        # Build query to aggregate coverage by quadkey
        query = """
            SELECT
                c.quadkey,
                SUM(c.n_trials) as total_trials,
                SUM(c.n_covered) as total_covered,
                array_agg(DISTINCT unnest) as all_rounds
            FROM coverage c
            LEFT JOIN LATERAL unnest(c.rounds) ON true
            WHERE c.campaign_id = %s
              AND c.indicator_id = %s
              AND c.quadkey IS NOT NULL
        """
        params = [campaign_id, indicator_id]

        # Filter by specific quadkeys if provided
        if quadkeys:
            query += " AND c.quadkey = ANY(%s)"
            params.append(quadkeys)

        query += """
            GROUP BY c.quadkey
        """

        cursor.execute(query, tuple(params))
        aggregated_data = cursor.fetchall()

        # Update or insert coverage_pixel records
        for row in aggregated_data:
            quadkey, total_trials, total_covered, all_rounds = row

            # Filter out None values from rounds and convert to list
            rounds = [r for r in (all_rounds or []) if r is not None]

            # Cap n_trials at 100 for mock data and ensure n_covered <= n_trials
            capped_trials = min(total_trials or 0, 100)
            capped_covered = min(total_covered or 0, capped_trials)

            # Check if coverage_pixel entry exists
            cursor.execute("""
                SELECT id FROM coverage_pixel
                WHERE quadkey = %s AND indicator_id = %s AND campaign_id = %s AND version = 0
            """, (quadkey, indicator_id, campaign_id))

            existing = cursor.fetchone()

            if existing:
                # Update existing record
                cursor.execute("""
                    UPDATE coverage_pixel
                    SET n_trials = %s,
                        n_covered = %s,
                        rounds = %s,
                        updated_at = NOW()
                    WHERE id = %s
                """, (capped_trials, capped_covered, rounds, existing[0]))
            else:
                # Insert new record with predictions defaulting to 0
                cursor.execute("""
                    INSERT INTO coverage_pixel (
                        quadkey, campaign_id, indicator_id, version,
                        n_trials, n_covered, rounds,
                        exceedance_probability, exceedance_uncertainty,
                        prevalence_bci_width, prevalence_prediction
                    )
                    VALUES (%s, %s, %s, 0, %s, %s, %s, 0, 0, 0, 0)
                """, (quadkey, campaign_id, indicator_id, capped_trials, capped_covered, rounds))

        print(f"Updated {len(aggregated_data)} coverage_pixel records for area {campaign_id}, indicator {indicator_id}")

    except Exception as e:
        print(f"Error updating coverage_pixel: {e}")
        import traceback
        traceback.print_exc()
        raise


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

        campaign_id = data.get('campaign_id')
        indicator_id = data.get('indicator_id')

        if not campaign_id or not indicator_id:
            return jsonify({'error': 'campaign_id and indicator_id are required'}), 400

        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Query ALL coverage records for this indicator and area
        cursor.execute("""
            SELECT
                l.id,
                l.campaign_id,
                ST_AsGeoJSON(l.geometry) as geometry,
                c.n_trials,
                c.n_covered,
                l.latitude,
                l.longitude
            FROM locations l
            JOIN coverage c ON l.id = c.location_id
            WHERE c.indicator_id = %s
              AND l.campaign_id = %s
        """, (indicator_id, campaign_id))

        location_data = cursor.fetchall()

        if not location_data:
            cursor.close()
            return jsonify({'error': 'No coverage data found for this indicator'}), 404

        print(f"INFO: Found {len(location_data)} coverage records for indicator {indicator_id}")
        print(f"INFO: Prevalence predictor URL: {PREVALENCE_PREDICTOR_URL}")
        sys.stdout.flush()

        # Format as GeoJSON for prevalence predictor and build location coords map
        features = []
        location_coords = {}  # Map location_id -> (lat, lng) for quadkey calculation
        for row in location_data:
            location_id, campaign_id_db, geometry_json, n_trials, n_covered, latitude, longitude = row

            # Store coordinates for later quadkey calculation
            location_coords[str(location_id)] = (latitude, longitude)

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
        sys.stdout.flush()
        print(f"DEBUG: First feature sample: {json.dumps(features[0] if features else {}, indent=2)}")
        sys.stdout.flush()
        print(f"DEBUG: Payload structure - has point_data: {'point_data' in payload}")
        print(f"DEBUG: Payload point_data type: {type(payload.get('point_data'))}")
        print(f"DEBUG: Payload point_data has features: {'features' in payload.get('point_data', {})}")
        print(f"DEBUG: Number of features in point_data: {len(payload.get('point_data', {}).get('features', []))}")
        sys.stdout.flush()

        # Print first 1000 chars of the actual JSON payload
        payload_json = json.dumps(payload)
        print(f"DEBUG: Payload JSON (first 1000 chars): {payload_json[:1000]}")
        sys.stdout.flush()

        try:
            # Note: The prevalence predictor has a longer timeout (910 seconds max)
            response = requests.post(
                PREVALENCE_PREDICTOR_URL,
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=920  # Slightly longer than the function's exec_timeout
            )

            print(f"DEBUG: Response status code: {response.status_code}")
            sys.stdout.flush()
            print(f"DEBUG: Response text (first 1000 chars): {response.text[:1000]}")
            sys.stdout.flush()

            # Try to parse JSON response, handling extra data after JSON
            try:
                prediction_result = parse_json_response(response)
                print(f"DEBUG: Successfully parsed response")
                sys.stdout.flush()
                print(f"DEBUG: Response keys: {prediction_result.keys() if isinstance(prediction_result, dict) else 'Not a dict'}")
                print(f"DEBUG: Response type: {type(prediction_result)}")
                if isinstance(prediction_result, dict):
                    print(f"DEBUG: Response structure sample: {json.dumps({k: type(v).__name__ for k, v in list(prediction_result.items())[:5]})}")
                sys.stdout.flush()
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

        # Parse results and update coverage table
        # The prevalence predictor wraps the result in a "result" key
        if 'result' in prediction_result and 'features' in prediction_result['result']:
            features_data = prediction_result['result']['features']
        elif 'features' in prediction_result:
            features_data = prediction_result['features']
        else:
            cursor.close()
            print(f"ERROR: Response missing 'features' key")
            sys.stdout.flush()
            print(f"ERROR: Actual response keys: {prediction_result.keys() if isinstance(prediction_result, dict) else 'Not a dict'}")
            print(f"ERROR: Full response: {json.dumps(prediction_result, indent=2)[:2000]}")
            sys.stdout.flush()
            return jsonify({
                'error': 'Invalid response from prevalence predictor',
                'details': 'Expected FeatureCollection with features',
                'actual_response': prediction_result if isinstance(prediction_result, dict) else str(prediction_result)
            }), 500

        updated_count = 0
        errors = []

        for feature in features_data:
            try:
                props = feature.get('properties', {})
                location_id = props.get('id')

                if not location_id:
                    errors.append('Missing location ID in prediction result')
                    continue

                # Calculate quadkey from location coordinates
                lat, lng = location_coords.get(location_id, (None, None))
                quadkey = calculate_quadkey(lat, lng)

                # Update coverage record with prediction results and quadkey
                cursor.execute("""
                    UPDATE coverage
                    SET exceedance_probability = %s,
                        exceedance_uncertainty = %s,
                        prevalence_bci_width = %s,
                        prevalence_prediction = %s,
                        quadkey = %s,
                        last_predicted_at = NOW(),
                        updated_at = NOW()
                    WHERE location_id = %s
                      AND indicator_id = %s
                """, (
                    props.get('exceedance_probability'),
                    props.get('exceedance_uncertainty'),
                    props.get('prevalence_bci_width'),
                    props.get('prevalence_prediction'),
                    quadkey,
                    location_id,
                    indicator_id
                ))

                if cursor.rowcount > 0:
                    updated_count += 1
                else:
                    errors.append(f'Location {location_id} not found in coverage table')

            except Exception as e:
                errors.append(f'Error processing location {location_id}: {str(e)}')
                continue

        print(f"Location predictions complete. Now predicting pixel coverage...")
        sys.stdout.flush()

        # Now predict coverage for pixels
        # Query coverage_pixel records for this indicator and area, joining with pixels table for geometry
        cursor.execute("""
            SELECT
                cp.quadkey,
                cp.n_trials,
                cp.n_covered,
                ST_AsGeoJSON(p.geometry) as geometry
            FROM coverage_pixel cp
            JOIN pixels p ON cp.quadkey = p.quadkey
            WHERE cp.indicator_id = %s
              AND cp.campaign_id = %s
        """, (indicator_id, campaign_id))

        pixel_data = cursor.fetchall()

        if pixel_data:
            print(f"INFO: Found {len(pixel_data)} coverage_pixel records for indicator {indicator_id}")
            sys.stdout.flush()

            # Format as GeoJSON for prevalence predictor
            pixel_features = []
            for row in pixel_data:
                quadkey, n_trials, n_covered, geometry_json = row

                # Parse the geometry JSON from PostGIS
                import json as json_module
                geometry = json_module.loads(geometry_json) if geometry_json else None

                if not geometry:
                    continue  # Skip pixels without geometry

                pixel_features.append({
                    'type': 'Feature',
                    'properties': {
                        'id': quadkey,  # Use quadkey as ID
                        'n_trials': int(n_trials),
                        'n_positive': int(n_covered)
                    },
                    'geometry': geometry
                })

            pixel_geojson_data = {
                'type': 'FeatureCollection',
                'features': pixel_features
            }

            pixel_payload = {
                'point_data': pixel_geojson_data,
                'exceedance_threshold': 0.5,
                'layer_names': []
            }

            # Call prevalence predictor for pixels
            print(f"Calling prevalence predictor for {len(pixel_features)} pixels...")
            sys.stdout.flush()

            try:
                pixel_response = requests.post(
                    PREVALENCE_PREDICTOR_URL,
                    json=pixel_payload,
                    headers={'Content-Type': 'application/json'},
                    timeout=920
                )

                print(f"DEBUG: Pixel prediction response status code: {pixel_response.status_code}")
                sys.stdout.flush()

                pixel_prediction_result = parse_json_response(pixel_response)

                if pixel_response.status_code != 200:
                    print(f"ERROR: Pixel prediction returned status code {pixel_response.status_code}")
                    errors.append(f'Pixel prediction failed with status {pixel_response.status_code}')
                else:
                    # Parse pixel prediction results and update coverage_pixel table
                    if 'result' in pixel_prediction_result and 'features' in pixel_prediction_result['result']:
                        pixel_features_data = pixel_prediction_result['result']['features']
                    elif 'features' in pixel_prediction_result:
                        pixel_features_data = pixel_prediction_result['features']
                    else:
                        print(f"ERROR: Pixel prediction response missing 'features' key")
                        errors.append('Invalid pixel prediction response format')
                        pixel_features_data = []

                    pixel_updated_count = 0
                    for feature in pixel_features_data:
                        try:
                            props = feature.get('properties', {})
                            quadkey = props.get('id')

                            if not quadkey:
                                errors.append('Missing quadkey in pixel prediction result')
                                continue

                            # Update coverage_pixel record with prediction results
                            cursor.execute("""
                                UPDATE coverage_pixel
                                SET exceedance_probability = %s,
                                    exceedance_uncertainty = %s,
                                    prevalence_bci_width = %s,
                                    prevalence_prediction = %s,
                                    last_predicted_at = NOW(),
                                    updated_at = NOW()
                                WHERE quadkey = %s
                                  AND indicator_id = %s
                                  AND campaign_id = %s
                            """, (
                                props.get('exceedance_probability'),
                                props.get('exceedance_uncertainty'),
                                props.get('prevalence_bci_width'),
                                props.get('prevalence_prediction'),
                                quadkey,
                                indicator_id,
                                campaign_id
                            ))

                            if cursor.rowcount > 0:
                                pixel_updated_count += 1
                            else:
                                errors.append(f'Pixel {quadkey} not found in coverage_pixel table')

                        except Exception as e:
                            errors.append(f'Error processing pixel {quadkey}: {str(e)}')
                            continue

                    print(f"Updated {pixel_updated_count} pixel predictions")
                    sys.stdout.flush()

            except requests.exceptions.Timeout:
                errors.append('Pixel prediction request timed out')
                print(f"ERROR: Pixel prediction request timed out")
            except requests.exceptions.RequestException as e:
                errors.append(f'Failed to call prevalence predictor for pixels: {str(e)}')
                print(f"ERROR: Pixel prediction request failed: {e}")
            except Exception as e:
                errors.append(f'Error during pixel prediction: {str(e)}')
                print(f"ERROR: Error during pixel prediction: {e}")
        else:
            print(f"INFO: No coverage_pixel records found for prediction")
            sys.stdout.flush()

        conn.commit()
        cursor.close()

        return jsonify({
            'success': True,
            'total_locations': len(features_data),
            'updated': updated_count,
            'errors': errors
        }), 200

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


@coverage_bp.route('/api/campaigns/<campaign_id>/coverage', methods=['GET'])
@require_auth
def list_area_coverage(user, campaign_id):
    """Get all coverage records for an area with optional filtering"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get query parameters for filtering
        indicator_id = request.args.get('indicator_id')

        # Get pagination parameters
        limit = request.args.get('limit', type=int, default=200)
        offset = request.args.get('offset', type=int, default=0)

        # Build base WHERE clause for both queries
        where_clause = "WHERE c.campaign_id = %s"
        params = [campaign_id]

        if indicator_id:
            where_clause += " AND c.indicator_id = %s"
            params.append(indicator_id)

        # Get total count first
        count_query = f"""
            SELECT COUNT(*)
            FROM coverage c
            {where_clause}
        """
        cursor.execute(count_query, tuple(params))
        total_count = cursor.fetchone()[0]

        # Build data query
        query = f"""
            SELECT
                c.id, c.location_id, c.campaign_id, c.indicator_id, c.version,
                c.n_trials, c.n_covered,
                c.exceedance_probability, c.exceedance_uncertainty,
                c.prevalence_bci_width, c.prevalence_prediction,
                c.created_at, c.updated_at, c.last_predicted_at,
                l.latitude, l.longitude, l.external_id,
                i.name as indicator_name,
                c.rounds, c.quadkey
            FROM coverage c
            JOIN locations l ON c.location_id = l.id
            JOIN indicators i ON c.indicator_id = i.id
            {where_clause}
            LIMIT %s OFFSET %s
        """
        params.extend([limit, offset])

        cursor.execute(query, tuple(params))

        coverage_records = []
        for row in cursor.fetchall():
            coverage_records.append({
                'id': str(row[0]),
                'location_id': str(row[1]),
                'campaign_id': str(row[2]),
                'indicator_id': str(row[3]),
                'version': row[4],
                'n_trials': row[5],
                'n_covered': row[6],
                'exceedance_probability': float(row[7]) if row[7] is not None else None,
                'exceedance_uncertainty': float(row[8]) if row[8] is not None else None,
                'prevalence_bci_width': float(row[9]) if row[9] is not None else None,
                'prevalence_prediction': float(row[10]) if row[10] is not None else None,
                'created_at': row[11].isoformat() if row[11] else None,
                'updated_at': row[12].isoformat() if row[12] else None,
                'last_predicted_at': row[13].isoformat() if row[13] else None,
                'latitude': float(row[14]) if row[14] is not None else None,
                'longitude': float(row[15]) if row[15] is not None else None,
                'external_id': row[16],
                'indicator_name': row[17],
                'rounds': list(row[18]) if row[18] else [],
                'quadkey': row[19]
            })

        cursor.close()
        return jsonify({
            'coverage': coverage_records,
            'total_count': total_count
        }), 200

    except Exception as e:
        print(f"Error listing area coverage: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to list coverage', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/campaigns/<campaign_id>/coverage/geojson', methods=['GET'])
@require_auth
def get_coverage_geojson(user, campaign_id):
    """Get coverage data as GeoJSON with geometries from locations table"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get query parameters for filtering
        indicator_id = request.args.get('indicator_id')

        # Build dynamic query - left join coverage with locations
        query = """
            SELECT
                c.id, c.location_id, c.campaign_id, c.indicator_id, c.version,
                c.n_trials, c.n_covered,
                c.exceedance_probability, c.exceedance_uncertainty,
                c.prevalence_bci_width, c.prevalence_prediction,
                l.latitude, l.longitude, l.external_id,
                ST_AsGeoJSON(l.geometry) as geometry,
                l.properties,
                i.name as indicator_name,
                c.rounds, c.quadkey
            FROM coverage c
            LEFT JOIN locations l ON c.location_id = l.id
            LEFT JOIN indicators i ON c.indicator_id = i.id
            WHERE c.campaign_id = %s
        """
        params = [campaign_id]

        if indicator_id:
            query += " AND c.indicator_id = %s"
            params.append(indicator_id)

        cursor.execute(query, tuple(params))

        features = []
        for row in cursor.fetchall():
            # Parse geometry from PostGIS
            geometry = json.loads(row[14]) if row[14] else {
                'type': 'Point',
                'coordinates': [float(row[12]), float(row[11])]  # lng, lat
            }

            # Get location properties
            location_props = row[15] if isinstance(row[15], dict) else json.loads(row[15]) if row[15] else {}

            # Build feature properties with coverage data
            properties = {
                'coverage_id': str(row[0]),
                'location_id': str(row[1]),
                'external_id': row[13],
                'indicator_id': str(row[3]),
                'indicator_name': row[16],
                'version': row[4],
                'n_trials': row[5],
                'n_covered': row[6],
                'exceedance_probability': float(row[7]) if row[7] is not None else 0,
                'exceedance_uncertainty': float(row[8]) if row[8] is not None else 0,
                'prevalence_bci_width': float(row[9]) if row[9] is not None else 0,
                'prevalence_prediction': float(row[10]) if row[10] is not None else 0,
                'latitude': float(row[11]) if row[11] is not None else None,
                'longitude': float(row[12]) if row[12] is not None else None,
                'rounds': list(row[17]) if row[17] else [],
                'quadkey': row[18]
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
                MIN(c.created_at) as created_at
            FROM coverage c
            WHERE c.indicator_id = %s
            GROUP BY c.version
            ORDER BY c.version DESC
        """, (indicator_id,))

        versions = []
        for row in cursor.fetchall():
            versions.append({
                'version': row[0],
                'location_count': row[1],
                'created_at': row[2].isoformat() if row[2] else None
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
                c.id, c.location_id, c.campaign_id, c.indicator_id, c.version,
                c.n_trials, c.n_covered,
                c.exceedance_probability, c.exceedance_uncertainty,
                c.prevalence_bci_width, c.prevalence_prediction,
                c.created_at, c.updated_at, c.last_predicted_at,
                l.latitude, l.longitude,
                c.rounds, c.quadkey
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
                'campaign_id': str(row[2]),
                'indicator_id': str(row[3]),
                'version': row[4],
                'n_trials': row[5],
                'n_covered': row[6],
                'exceedance_probability': float(row[7]) if row[7] is not None else None,
                'exceedance_uncertainty': float(row[8]) if row[8] is not None else None,
                'prevalence_bci_width': float(row[9]) if row[9] is not None else None,
                'prevalence_prediction': float(row[10]) if row[10] is not None else None,
                'created_at': row[11].isoformat() if row[11] else None,
                'updated_at': row[12].isoformat() if row[12] else None,
                'last_predicted_at': row[13].isoformat() if row[13] else None,
                'latitude': float(row[14]) if row[14] is not None else None,
                'longitude': float(row[15]) if row[15] is not None else None,
                'rounds': list(row[16]) if row[16] else [],
                'quadkey': row[17]
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

        # Verify user has access by checking campaign_id
        cursor.execute("""
            SELECT DISTINCT campaign_id FROM coverage
            WHERE indicator_id = %s AND version = %s
            LIMIT 1
        """, (indicator_id, version))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Coverage version not found'}), 404

        campaign_id = str(result[0])
        if not check_campaign_access(user['id'], campaign_id):
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


@coverage_bp.route('/api/campaigns/<campaign_id>/coverage_pixel', methods=['GET'])
@require_auth
def list_area_coverage_pixel(user, campaign_id):
    """Get all coverage_pixel records for an area with optional filtering"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get query parameters for filtering
        indicator_id = request.args.get('indicator_id')
        only_with_locations = request.args.get('only_with_locations', 'false').lower() == 'true'

        # Get pagination parameters
        limit = request.args.get('limit', type=int, default=200)
        offset = request.args.get('offset', type=int, default=0)

        # Build base WHERE clause for both queries
        where_clause = "WHERE cp.campaign_id = %s"
        params = [campaign_id]

        if indicator_id:
            where_clause += " AND cp.indicator_id = %s"
            params.append(indicator_id)

        if only_with_locations:
            where_clause += """
                AND EXISTS (
                    SELECT 1 FROM locations l
                    WHERE l.quadkey = cp.quadkey AND l.campaign_id = cp.campaign_id
                )
            """

        # Get total count first
        count_query = f"""
            SELECT COUNT(*)
            FROM coverage_pixel cp
            {where_clause}
        """
        cursor.execute(count_query, tuple(params))
        total_count = cursor.fetchone()[0]

        # Build data query
        query = f"""
            SELECT
                cp.id, cp.quadkey, cp.campaign_id, cp.indicator_id, cp.version,
                cp.n_trials, cp.n_covered,
                cp.exceedance_probability, cp.exceedance_uncertainty,
                cp.prevalence_bci_width, cp.prevalence_prediction,
                cp.created_at, cp.updated_at, cp.last_predicted_at,
                i.name as indicator_name,
                cp.rounds,
                p.latitude, p.longitude,
                COALESCE(plc.location_count, 0) as location_count
            FROM coverage_pixel cp
            JOIN indicators i ON cp.indicator_id = i.id
            LEFT JOIN pixels p ON cp.quadkey = p.quadkey
            LEFT JOIN pixel_location_counts plc ON cp.quadkey = plc.quadkey AND cp.campaign_id = plc.campaign_id
            {where_clause}
            LIMIT %s OFFSET %s
        """
        params.extend([limit, offset])

        cursor.execute(query, tuple(params))

        coverage_pixel_records = []
        for row in cursor.fetchall():
            coverage_pixel_records.append({
                'id': str(row[0]),
                'quadkey': row[1],
                'campaign_id': str(row[2]),
                'indicator_id': str(row[3]),
                'version': row[4],
                'n_trials': row[5],
                'n_covered': row[6],
                'exceedance_probability': float(row[7]) if row[7] is not None else None,
                'exceedance_uncertainty': float(row[8]) if row[8] is not None else None,
                'prevalence_bci_width': float(row[9]) if row[9] is not None else None,
                'prevalence_prediction': float(row[10]) if row[10] is not None else None,
                'created_at': row[11].isoformat() if row[11] else None,
                'updated_at': row[12].isoformat() if row[12] else None,
                'last_predicted_at': row[13].isoformat() if row[13] else None,
                'indicator_name': row[14],
                'rounds': list(row[15]) if row[15] else [],
                'latitude': float(row[16]) if row[16] is not None else None,
                'longitude': float(row[17]) if row[17] is not None else None,
                'location_count': row[18]
            })

        cursor.close()
        return jsonify({
            'coverage_pixel': coverage_pixel_records,
            'total_count': total_count
        }), 200

    except Exception as e:
        print(f"Error listing area coverage_pixel: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to list coverage_pixel', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/campaigns/<campaign_id>/coverage/histogram', methods=['GET'])
@require_auth
def get_coverage_histogram(user, campaign_id):
    """Get histogram data for coverage using PostgreSQL aggregation"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get query parameters
        indicator_id = request.args.get('indicator_id')
        mode = request.args.get('mode', 'coverage')  # 'coverage' or 'uncertainty'
        num_bins = request.args.get('bins', type=int, default=12)
        data_type = request.args.get('data_type', 'locations')  # 'locations' or 'pixels'

        if not indicator_id:
            return jsonify({'error': 'indicator_id is required'}), 400

        # Determine which column to use based on mode
        value_column = 'prevalence_prediction' if mode == 'coverage' else 'prevalence_bci_width'

        # First, get the min and max values to check if they're equal
        table_name = 'coverage' if data_type == 'locations' else 'coverage_pixel'
        range_query = f"""
            SELECT MIN({value_column}) as min_val, MAX({value_column}) as max_val, COUNT(*) as count
            FROM {table_name}
            WHERE campaign_id = %s AND indicator_id = %s AND {value_column} IS NOT NULL
        """
        cursor.execute(range_query, (campaign_id, indicator_id))
        range_result = cursor.fetchone()
        min_val, max_val, count = range_result

        # Handle edge cases
        if count == 0 or min_val is None or max_val is None:
            # No data
            cursor.close()
            return jsonify({
                'bins': [],
                'overall_min': None,
                'overall_max': None,
                'num_bins': num_bins,
                'mode': mode,
                'data_type': data_type
            }), 200

        if min_val == max_val:
            # All values are the same - return a single bin
            cursor.close()
            return jsonify({
                'bins': [{
                    'bucket': 1,
                    'count': count,
                    'min': float(min_val),
                    'max': float(max_val)
                }],
                'overall_min': float(min_val),
                'overall_max': float(max_val),
                'num_bins': 1,
                'mode': mode,
                'data_type': data_type
            }), 200

        # Build query based on data type
        if data_type == 'locations':
            # Use coverage table
            query = f"""
                WITH value_range AS (
                    SELECT
                        MIN({value_column}) as min_val,
                        MAX({value_column}) as max_val
                    FROM coverage
                    WHERE campaign_id = %s
                        AND indicator_id = %s
                        AND {value_column} IS NOT NULL
                ),
                histogram AS (
                    SELECT
                        width_bucket({value_column},
                            (SELECT min_val FROM value_range),
                            (SELECT max_val FROM value_range),
                            %s
                        ) as bucket,
                        COUNT(*) as count,
                        MIN({value_column}) as bin_min,
                        MAX({value_column}) as bin_max
                    FROM coverage
                    WHERE campaign_id = %s
                        AND indicator_id = %s
                        AND {value_column} IS NOT NULL
                    GROUP BY bucket
                    ORDER BY bucket
                )
                SELECT
                    bucket,
                    count,
                    bin_min,
                    bin_max,
                    (SELECT min_val FROM value_range) as overall_min,
                    (SELECT max_val FROM value_range) as overall_max
                FROM histogram
            """
            params = (campaign_id, indicator_id, num_bins, campaign_id, indicator_id)
        else:
            # Use coverage_pixel table
            query = f"""
                WITH value_range AS (
                    SELECT
                        MIN({value_column}) as min_val,
                        MAX({value_column}) as max_val
                    FROM coverage_pixel
                    WHERE campaign_id = %s
                        AND indicator_id = %s
                        AND {value_column} IS NOT NULL
                ),
                histogram AS (
                    SELECT
                        width_bucket({value_column},
                            (SELECT min_val FROM value_range),
                            (SELECT max_val FROM value_range),
                            %s
                        ) as bucket,
                        COUNT(*) as count,
                        MIN({value_column}) as bin_min,
                        MAX({value_column}) as bin_max
                    FROM coverage_pixel
                    WHERE campaign_id = %s
                        AND indicator_id = %s
                        AND {value_column} IS NOT NULL
                    GROUP BY bucket
                    ORDER BY bucket
                )
                SELECT
                    bucket,
                    count,
                    bin_min,
                    bin_max,
                    (SELECT min_val FROM value_range) as overall_min,
                    (SELECT max_val FROM value_range) as overall_max
                FROM histogram
            """
            params = (campaign_id, indicator_id, num_bins, campaign_id, indicator_id)

        cursor.execute(query, params)
        rows = cursor.fetchall()

        # Create a map of bucket number to bin data
        bin_map = {}
        overall_min = None
        overall_max = None

        for row in rows:
            bucket, count, bin_min, bin_max, o_min, o_max = row
            bin_map[bucket] = {
                'bucket': bucket,
                'count': count,
                'min': float(bin_min) if bin_min is not None else None,
                'max': float(bin_max) if bin_max is not None else None
            }
            if overall_min is None:
                overall_min = float(o_min) if o_min is not None else None
                overall_max = float(o_max) if o_max is not None else None

        # Fill in missing bins with count=0
        bins = []
        bin_width = (overall_max - overall_min) / num_bins if overall_max and overall_min else 0

        for bucket_num in range(1, num_bins + 1):
            if bucket_num in bin_map:
                bins.append(bin_map[bucket_num])
            else:
                # Empty bin
                bins.append({
                    'bucket': bucket_num,
                    'count': 0,
                    'min': None,
                    'max': None
                })

        cursor.close()
        return jsonify({
            'bins': bins,
            'overall_min': overall_min,
            'overall_max': overall_max,
            'num_bins': num_bins,
            'mode': mode,
            'data_type': data_type
        }), 200

    except Exception as e:
        print(f"Error getting coverage histogram: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to get histogram', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@coverage_bp.route('/api/coverage/predict/workflow', methods=['POST'])
@require_auth
def predict_coverage_workflow(user):
    """Start coverage prediction workflow using Temporal"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.coverage_prediction import CoveragePredictionWorkflow

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        campaign_id = data.get('campaign_id')
        indicator_id = data.get('indicator_id')

        if not campaign_id or not indicator_id:
            return jsonify({'error': 'campaign_id and indicator_id are required'}), 400

        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"coverage-prediction-{campaign_id}-{indicator_id}-{timestamp}"

        # Start workflow
        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                CoveragePredictionWorkflow.run,
                args=[campaign_id, indicator_id],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        print(f"Started coverage prediction workflow: {workflow_id}")

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started',
            'message': 'Coverage prediction started. Use the workflow_id to check progress.'
        }), 202

    except Exception as e:
        print(f"Error starting coverage prediction workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start coverage prediction', 'details': str(e)}), 500


@coverage_bp.route('/api/coverage/predict/workflow/<workflow_id>/status', methods=['GET'])
@require_auth
def get_coverage_prediction_status(user, workflow_id):
    """Get status of coverage prediction workflow"""
    import asyncio
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.coverage_prediction import CoveragePredictionWorkflow
    from temporalio.client import WorkflowExecutionStatus

    try:
        async def get_status():
            client = await get_temporal_client()
            handle = client.get_workflow_handle(workflow_id)

            # Check workflow status
            try:
                desc = await handle.describe()

                if desc.status == WorkflowExecutionStatus.RUNNING:
                    # Try to query progress
                    try:
                        progress = await handle.query(CoveragePredictionWorkflow.get_progress)
                        return {
                            "workflow_id": workflow_id,
                            "status": "running",
                            "progress": progress
                        }
                    except Exception:
                        # Query failed, return running without progress
                        return {
                            "workflow_id": workflow_id,
                            "status": "running",
                            "progress": None
                        }
                elif desc.status == WorkflowExecutionStatus.COMPLETED:
                    # Get result
                    result = await handle.result()
                    return {
                        "workflow_id": workflow_id,
                        "status": "completed",
                        "result": result
                    }
                else:
                    # Failed/cancelled
                    return {
                        "workflow_id": workflow_id,
                        "status": desc.status.name.lower()
                    }
            except Exception as e:
                # Workflow not found
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
        return jsonify({'error': 'Failed to get workflow status', 'details': str(e)}), 500
