# ABOUTME: Temporal activities for coverage prediction operations
# ABOUTME: Database queries and external service calls for coverage prediction workflows

from temporalio import activity
import requests
from typing import List, Dict, Any
import os
import json

from db.connection import get_db_connection, return_db_connection

PREVALENCE_PREDICTOR_URL = os.getenv('DOCKER_FN_PREVALENCE_URL', 'http://localhost:8084')


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

        # Prioritize objects and arrays (what we expect from API responses)
        # Look for { or [ first before trying other JSON types
        for start_char in ['{', '[']:
            for i in range(len(text)):
                if text[i] == start_char:
                    try:
                        obj, idx = decoder.raw_decode(text[i:])

                        # Log if there was data before the JSON
                        if i > 0:
                            prefix_data = text[:min(i, 200)]
                            activity.logger.warning(f"Data before JSON (showing first 200 chars): {prefix_data}")

                        # Log if there was extra data after the JSON
                        if i + idx < len(text):
                            extra_data = text[i+idx:i+idx+200]
                            activity.logger.warning(f"Extra data after JSON (showing first 200 chars): {extra_data}")

                        return obj
                    except (ValueError, json.JSONDecodeError):
                        # Not valid JSON at this position, try next
                        continue

        # If we get here, no valid JSON object/array was found
        raise ValueError(f"No valid JSON object or array found in response: {text[:500]}")


@activity.defn
async def fetch_location_coverage(campaign_id: str, indicator_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all location coverage records for an area and indicator.

    Args:
        campaign_id: Area ID
        indicator_id: Indicator ID

    Returns:
        List of coverage records with location geometry and coordinates
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                c.id,
                l.id as location_id,
                c.campaign_id,
                ST_AsGeoJSON(l.geometry) as geometry,
                c.n_trials,
                c.n_covered,
                l.latitude,
                l.longitude
            FROM coverage c
            JOIN locations l ON c.location_id = l.id
            WHERE c.indicator_id = %s
              AND c.campaign_id = %s
        """, (indicator_id, campaign_id))

        records = cursor.fetchall()

        activity.logger.info(f"Fetched {len(records)} location coverage records")

        results = []
        for r in records:
            # Parse geometry JSON
            geometry = json.loads(r[3]) if r[3] else None

            results.append({
                "coverage_id": str(r[0]),
                "location_id": str(r[1]),
                "campaign_id": str(r[2]),
                "geometry": geometry,
                "n_trials": int(r[4]) if r[4] is not None else 0,
                "n_covered": int(r[5]) if r[5] is not None else 0,
                "latitude": float(r[6]) if r[6] is not None else None,
                "longitude": float(r[7]) if r[7] is not None else None,
            })

        return results
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def predict_location_coverage(locations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Call prevalence predictor service for location coverage.

    Args:
        locations: List of location coverage records

    Returns:
        List of predictions with coverage IDs
    """
    activity.logger.info(f"Predicting coverage for {len(locations)} locations")

    # Build GeoJSON features
    features = []
    for loc in locations:
        if not loc.get("geometry"):
            continue

        features.append({
            'type': 'Feature',
            'properties': {
                'id': loc["location_id"],
                'n_trials': loc["n_trials"],
                'n_positive': loc["n_covered"]
            },
            'geometry': loc["geometry"]
        })

    geojson_data = {
        'type': 'FeatureCollection',
        'features': features
    }

    # Prepare payload for prevalence predictor
    payload = {
        'point_data': geojson_data,
        'exceedance_threshold': 0.5,
        'layer_names': []
    }

    activity.logger.info(f"Calling prevalence predictor at {PREVALENCE_PREDICTOR_URL}")
    activity.logger.info(f"Number of features: {len(features)}")
    if features:
        activity.logger.info(f"First feature: {json.dumps(features[0])}")
    activity.logger.info(f"Full payload (first 2000 chars): {json.dumps(payload)[:2000]}")

    # Call prevalence predictor service
    response = requests.post(
        PREVALENCE_PREDICTOR_URL,
        json=payload,
        headers={'Content-Type': 'application/json'},
        timeout=920  # 15 minutes + buffer
    )

    response.raise_for_status()
    activity.logger.info(f"Response status: {response.status_code}")
    activity.logger.info(f"Response text (first 2000 chars): {response.text[:2000]}")

    prediction_result = parse_json_response(response)
    activity.logger.info(f"Parsed response type: {type(prediction_result)}")
    if isinstance(prediction_result, dict):
        activity.logger.info(f"Response keys: {prediction_result.keys()}")

    # Check for function status and handle errors
    if isinstance(prediction_result, dict) and 'function_status' in prediction_result:
        if prediction_result['function_status'] == 'error':
            error_msg = prediction_result.get('result', 'Unknown error from prevalence predictor')
            activity.logger.error(f"Prevalence predictor returned error: {error_msg}")
            raise ValueError(f"Prevalence predictor error: {error_msg}")
        elif prediction_result['function_status'] == 'success':
            # Unwrap the result
            prediction_result = prediction_result.get('result', prediction_result)

    # Extract features from response
    if isinstance(prediction_result, dict) and 'features' in prediction_result:
        features_data = prediction_result['features']
    else:
        activity.logger.error(f"Cannot find features in response. Full response: {prediction_result}")
        raise ValueError('Invalid response from prevalence predictor - missing features')

    # Build results mapping location_id to coverage_id and predictions
    location_to_coverage = {loc["location_id"]: loc["coverage_id"] for loc in locations}

    results = []
    for feature in features_data:
        props = feature.get('properties', {})
        location_id = props.get('id')

        if not location_id or location_id not in location_to_coverage:
            continue

        coverage_id = location_to_coverage[location_id]

        results.append({
            "coverage_id": coverage_id,
            "location_id": location_id,
            "exceedance_probability": props.get('exceedance_probability'),
            "exceedance_uncertainty": props.get('exceedance_uncertainty'),
            "prevalence_bci_width": props.get('prevalence_bci_width'),
            "prevalence_prediction": props.get('prevalence_prediction'),
        })

    activity.logger.info(f"Received predictions for {len(results)} locations")
    return results


@activity.defn
async def update_location_coverage(results: List[Dict[str, Any]], campaign_id: str, indicator_id: str) -> int:
    """
    Update coverage records with predictions.

    Args:
        results: List of predictions with coverage IDs
        campaign_id: Area ID for calculating quadkeys
        indicator_id: Indicator ID

    Returns:
        Number of records updated
    """
    from routes.locations import calculate_quadkey

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        activity.logger.info(f"Updating {len(results)} coverage records")

        # Get location coordinates for quadkey calculation
        location_coords = {}
        location_ids = [r["location_id"] for r in results]

        if location_ids:
            cursor.execute("""
                SELECT id, latitude, longitude
                FROM locations
                WHERE id::text = ANY(%s)
            """, (location_ids,))

            for row in cursor.fetchall():
                location_coords[str(row[0])] = (row[1], row[2])

        updated_count = 0
        for result in results:
            location_id = result["location_id"]
            lat, lng = location_coords.get(location_id, (None, None))
            quadkey = calculate_quadkey(lat, lng) if lat and lng else None

            cursor.execute("""
                UPDATE coverage
                SET exceedance_probability = %s,
                    exceedance_uncertainty = %s,
                    prevalence_bci_width = %s,
                    prevalence_prediction = %s,
                    quadkey = %s,
                    last_predicted_at = NOW(),
                    updated_at = NOW()
                WHERE id = %s
            """, (
                result["exceedance_probability"],
                result["exceedance_uncertainty"],
                result["prevalence_bci_width"],
                result["prevalence_prediction"],
                quadkey,
                result["coverage_id"],
            ))

            if cursor.rowcount > 0:
                updated_count += 1

        conn.commit()
        activity.logger.info(f"Successfully updated {updated_count} coverage records")
        return updated_count
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def fetch_pixel_coverage(campaign_id: str, indicator_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all pixel coverage records for an area and indicator.

    Args:
        campaign_id: Area ID
        indicator_id: Indicator ID

    Returns:
        List of pixel coverage records with geometry
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                cp.id,
                cp.quadkey,
                cp.n_trials,
                cp.n_covered,
                ST_AsGeoJSON(p.geometry) as geometry
            FROM coverage_pixel cp
            JOIN pixels p ON cp.quadkey = p.quadkey
            WHERE cp.indicator_id = %s
              AND cp.campaign_id = %s
        """, (indicator_id, campaign_id))

        records = cursor.fetchall()

        activity.logger.info(f"Fetched {len(records)} pixel coverage records")

        results = []
        for r in records:
            # Parse geometry JSON
            geometry = json.loads(r[4]) if r[4] else None

            results.append({
                "coverage_pixel_id": str(r[0]),
                "quadkey": r[1],
                "n_trials": int(r[2]) if r[2] is not None else 0,
                "n_covered": int(r[3]) if r[3] is not None else 0,
                "geometry": geometry,
            })

        return results
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def predict_pixel_coverage(pixels: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Call prevalence predictor service for pixel coverage.

    Args:
        pixels: List of pixel coverage records

    Returns:
        List of predictions with coverage_pixel IDs
    """
    activity.logger.info(f"Predicting coverage for {len(pixels)} pixels")

    # Build GeoJSON features
    features = []
    for pixel in pixels:
        if not pixel.get("geometry"):
            continue

        features.append({
            'type': 'Feature',
            'properties': {
                'id': pixel["quadkey"],
                'n_trials': pixel["n_trials"],
                'n_positive': pixel["n_covered"]
            },
            'geometry': pixel["geometry"]
        })

    geojson_data = {
        'type': 'FeatureCollection',
        'features': features
    }

    # Prepare payload for prevalence predictor
    payload = {
        'point_data': geojson_data,
        'exceedance_threshold': 0.5,
        'layer_names': []
    }

    activity.logger.info(f"Calling prevalence predictor at {PREVALENCE_PREDICTOR_URL}")
    activity.logger.info(f"Number of features: {len(features)}")
    if features:
        activity.logger.info(f"First feature: {json.dumps(features[0])}")
    activity.logger.info(f"Full payload (first 2000 chars): {json.dumps(payload)[:2000]}")

    # Call prevalence predictor service
    response = requests.post(
        PREVALENCE_PREDICTOR_URL,
        json=payload,
        headers={'Content-Type': 'application/json'},
        timeout=920
    )

    response.raise_for_status()
    prediction_result = parse_json_response(response)

    # Extract features from response
    if 'result' in prediction_result and 'features' in prediction_result['result']:
        features_data = prediction_result['result']['features']
    elif 'features' in prediction_result:
        features_data = prediction_result['features']
    else:
        raise ValueError('Invalid response from prevalence predictor - missing features')

    # Build results mapping quadkey to coverage_pixel_id and predictions
    quadkey_to_coverage = {p["quadkey"]: p["coverage_pixel_id"] for p in pixels}

    results = []
    for feature in features_data:
        props = feature.get('properties', {})
        quadkey = props.get('id')

        if not quadkey or quadkey not in quadkey_to_coverage:
            continue

        coverage_pixel_id = quadkey_to_coverage[quadkey]

        results.append({
            "coverage_pixel_id": coverage_pixel_id,
            "quadkey": quadkey,
            "exceedance_probability": props.get('exceedance_probability'),
            "exceedance_uncertainty": props.get('exceedance_uncertainty'),
            "prevalence_bci_width": props.get('prevalence_bci_width'),
            "prevalence_prediction": props.get('prevalence_prediction'),
        })

    activity.logger.info(f"Received predictions for {len(results)} pixels")
    return results


@activity.defn
async def update_pixel_coverage(results: List[Dict[str, Any]]) -> int:
    """
    Update coverage_pixel records with predictions.

    Args:
        results: List of predictions with coverage_pixel IDs

    Returns:
        Number of records updated
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        activity.logger.info(f"Updating {len(results)} coverage_pixel records")

        updated_count = 0
        for result in results:
            cursor.execute("""
                UPDATE coverage_pixel
                SET exceedance_probability = %s,
                    exceedance_uncertainty = %s,
                    prevalence_bci_width = %s,
                    prevalence_prediction = %s,
                    last_predicted_at = NOW(),
                    updated_at = NOW()
                WHERE id = %s
            """, (
                result["exceedance_probability"],
                result["exceedance_uncertainty"],
                result["prevalence_bci_width"],
                result["prevalence_prediction"],
                result["coverage_pixel_id"],
            ))

            if cursor.rowcount > 0:
                updated_count += 1

        conn.commit()
        activity.logger.info(f"Successfully updated {updated_count} coverage_pixel records")
        return updated_count
    finally:
        cursor.close()
        return_db_connection(conn)
