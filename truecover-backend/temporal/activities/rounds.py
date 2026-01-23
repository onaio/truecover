# ABOUTME: Temporal activities for round generation operations
# ABOUTME: Database operations and adaptive sampling service calls for rounds

from temporalio import activity
from typing import List, Dict, Any
import requests
import json
import os

from db.connection import get_db_connection, return_db_connection

SAMPLING_URL = os.getenv('DOCKER_FN_SAMPLING_URL', 'http://localhost:8083')


@activity.defn
async def create_round_record(
    campaign_id: str,
    name: str,
    description: str,
    start_date: str,
    end_date: str,
    indicator_id: str,
    sampling_target: str,
    sampling_method: str = 'simple'
) -> Dict[str, Any]:
    """
    Create a new round record in database.

    Args:
        campaign_id: Area ID
        name: Round name
        description: Round description
        start_date: Start date
        end_date: End date
        indicator_id: Indicator ID
        sampling_target: 'locations' or 'pixels'
        sampling_method: 'simple' or 'stratified_cluster'

    Returns:
        Round record details
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get next round number
        cursor.execute("""
            SELECT COALESCE(MAX(round_number), 0) + 1
            FROM rounds
            WHERE campaign_id = %s
        """, (campaign_id,))
        round_number = cursor.fetchone()[0]

        # Create round
        cursor.execute("""
            INSERT INTO rounds (campaign_id, round_number, name, description, start_date, end_date, indicator_id, sampling_target, sampling_method)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, round_number, name, description, start_date, end_date, created_at, updated_at, sampling_target, sampling_method
        """, (campaign_id, round_number, name, description, start_date, end_date, indicator_id, sampling_target, sampling_method))

        row = cursor.fetchone()
        conn.commit()

        activity.logger.info(f"Created round {round_number} for area {campaign_id}")

        return {
            "round_id": str(row[0]),
            "round_number": row[1],
            "name": row[2],
            "description": row[3],
            "start_date": row[4].isoformat() if row[4] else None,
            "end_date": row[5].isoformat() if row[5] else None,
            "created_at": row[6].isoformat() if row[6] else None,
            "updated_at": row[7].isoformat() if row[7] else None,
            "sampling_target": row[8] if len(row) > 8 else 'locations',
            "sampling_method": row[9] if len(row) > 9 else 'simple',
        }
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def fetch_coverage_for_sampling(
    campaign_id: str,
    indicator_id: str,
    sampling_target: str,
    allow_revisit: bool,
    admin_pcode: str = None,
    min_population: float = None,
    population_field: str = None
) -> List[Dict[str, Any]]:
    """
    Fetch coverage data for adaptive sampling.

    Args:
        campaign_id: Area ID
        indicator_id: Indicator ID
        sampling_target: 'locations' or 'pixels'
        allow_revisit: Allow revisiting locations/pixels
        admin_pcode: Optional admin boundary filter
        min_population: Optional minimum population threshold for pixel filtering
        population_field: Optional metadata field name for population data

    Returns:
        List of coverage records with geometry and prediction fields
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        if sampling_target == 'pixels':
            # Fetch pixel coverage data
            # Build population filter components if enabled
            pop_join = ""
            pop_filter = ""
            pop_params = []

            if min_population is not None and population_field:
                import re
                if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', population_field):
                    raise ValueError(f"Invalid population field name: {population_field}")
                pop_join = "LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey"
                pop_filter = f"AND (pm.metadata->>'{population_field}')::float >= %s"
                pop_params = [min_population]

            if allow_revisit:
                if admin_pcode:
                    cursor.execute(f"""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        {pop_join}
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                          AND (p.adm1_pcode = %s OR p.adm2_pcode = %s OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
                          {pop_filter}
                    """, (campaign_id, indicator_id, admin_pcode, admin_pcode, admin_pcode, admin_pcode, *pop_params))
                else:
                    cursor.execute(f"""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        {pop_join}
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                          {pop_filter}
                    """, (campaign_id, indicator_id, *pop_params))
            else:
                # Only unvisited pixels
                if admin_pcode:
                    cursor.execute(f"""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        {pop_join}
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                          AND (cp.rounds IS NULL OR array_length(cp.rounds, 1) IS NULL OR array_length(cp.rounds, 1) = 0)
                          AND (p.adm1_pcode = %s OR p.adm2_pcode = %s OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
                          {pop_filter}
                    """, (campaign_id, indicator_id, admin_pcode, admin_pcode, admin_pcode, admin_pcode, *pop_params))
                else:
                    cursor.execute(f"""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        {pop_join}
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                          AND (cp.rounds IS NULL OR array_length(cp.rounds, 1) IS NULL OR array_length(cp.rounds, 1) = 0)
                          {pop_filter}
                    """, (campaign_id, indicator_id, *pop_params))
        else:
            # Fetch location coverage data
            if allow_revisit:
                if admin_pcode:
                    cursor.execute("""
                        SELECT DISTINCT
                            c.id as coverage_id,
                            c.location_id,
                            ST_AsGeoJSON(l.geometry) as geometry,
                            l.latitude, l.longitude,
                            c.exceedance_probability, c.exceedance_uncertainty,
                            c.prevalence_bci_width, c.prevalence_prediction,
                            l.properties, l.external_id
                        FROM coverage c
                        LEFT JOIN locations l ON c.location_id = l.id
                        LEFT JOIN admin_boundaries ab ON ST_Contains(ab.geometry, l.geometry)
                        WHERE c.campaign_id = %s AND c.indicator_id = %s
                          AND (ab.adm1_pcode = %s OR ab.adm2_pcode = %s OR ab.adm3_pcode = %s OR ab.adm4_pcode = %s)
                    """, (campaign_id, indicator_id, admin_pcode, admin_pcode, admin_pcode, admin_pcode))
                else:
                    cursor.execute("""
                        SELECT
                            c.id as coverage_id,
                            c.location_id,
                            ST_AsGeoJSON(l.geometry) as geometry,
                            l.latitude, l.longitude,
                            c.exceedance_probability, c.exceedance_uncertainty,
                            c.prevalence_bci_width, c.prevalence_prediction,
                            l.properties, l.external_id
                        FROM coverage c
                        LEFT JOIN locations l ON c.location_id = l.id
                        WHERE c.campaign_id = %s AND c.indicator_id = %s
                    """, (campaign_id, indicator_id))
            else:
                # Only unvisited locations
                if admin_pcode:
                    cursor.execute("""
                        SELECT DISTINCT
                            c.id as coverage_id,
                            c.location_id,
                            ST_AsGeoJSON(l.geometry) as geometry,
                            l.latitude, l.longitude,
                            c.exceedance_probability, c.exceedance_uncertainty,
                            c.prevalence_bci_width, c.prevalence_prediction,
                            l.properties, l.external_id
                        FROM coverage c
                        LEFT JOIN locations l ON c.location_id = l.id
                        LEFT JOIN admin_boundaries ab ON ST_Contains(ab.geometry, l.geometry)
                        WHERE c.campaign_id = %s AND c.indicator_id = %s
                          AND (c.rounds IS NULL OR array_length(c.rounds, 1) IS NULL OR array_length(c.rounds, 1) = 0)
                          AND (ab.adm1_pcode = %s OR ab.adm2_pcode = %s OR ab.adm3_pcode = %s OR ab.adm4_pcode = %s)
                    """, (campaign_id, indicator_id, admin_pcode, admin_pcode, admin_pcode, admin_pcode))
                else:
                    cursor.execute("""
                        SELECT
                            c.id as coverage_id,
                            c.location_id,
                            ST_AsGeoJSON(l.geometry) as geometry,
                            l.latitude, l.longitude,
                            c.exceedance_probability, c.exceedance_uncertainty,
                            c.prevalence_bci_width, c.prevalence_prediction,
                            l.properties, l.external_id
                        FROM coverage c
                        LEFT JOIN locations l ON c.location_id = l.id
                        WHERE c.campaign_id = %s AND c.indicator_id = %s
                          AND (c.rounds IS NULL OR array_length(c.rounds, 1) IS NULL OR array_length(c.rounds, 1) = 0)
                    """, (campaign_id, indicator_id))

        records = cursor.fetchall()

        activity.logger.info(f"Fetched {len(records)} {sampling_target} records for sampling")

        results = []
        for r in records:
            if sampling_target == 'pixels':
                results.append({
                    "coverage_id": str(r[0]),
                    "identifier": r[1],  # quadkey
                    "geometry": json.loads(r[2]) if r[2] else None,
                    "latitude": float(r[3]) if r[3] else None,
                    "longitude": float(r[4]) if r[4] else None,
                    "exceedance_probability": float(r[5]) if r[5] else 0,
                    "exceedance_uncertainty": float(r[6]) if r[6] else 0,
                    "prevalence_bci_width": float(r[7]) if r[7] else 0,
                    "prevalence_prediction": float(r[8]) if r[8] else 0,
                })
            else:
                properties = r[9] if isinstance(r[9], dict) else json.loads(r[9]) if r[9] else {}
                results.append({
                    "coverage_id": str(r[0]),
                    "location_id": str(r[1]),
                    "identifier": r[10],  # external_id
                    "geometry": json.loads(r[2]) if r[2] else None,
                    "latitude": float(r[3]) if r[3] else None,
                    "longitude": float(r[4]) if r[4] else None,
                    "exceedance_probability": float(r[5]) if r[5] else 0,
                    "exceedance_uncertainty": float(r[6]) if r[6] else 0,
                    "prevalence_bci_width": float(r[7]) if r[7] else 0,
                    "prevalence_prediction": float(r[8]) if r[8] else 0,
                    "properties": properties,
                })

        return results
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def call_adaptive_sampling(
    campaign_id: str,
    indicator_id: str,
    sampling_target: str,
    batch_size: int,
    uncertainty_field: str,
    allow_revisit: bool,
    admin_pcode: str = None,
    min_population: float = None,
    population_field: str = None
) -> Dict[str, Any]:
    """
    Fetch coverage data and call adaptive sampling service.

    Args:
        campaign_id: Area ID
        indicator_id: Indicator ID
        sampling_target: 'locations' or 'pixels'
        batch_size: Number of items to select
        uncertainty_field: Field to use for uncertainty
        allow_revisit: Allow revisiting locations/pixels
        admin_pcode: Optional admin boundary filter
        min_population: Optional minimum population threshold for pixel filtering
        population_field: Optional metadata field name for population data

    Returns:
        Dict with 'selected_ids' (list of coverage IDs) and 'total_items'
    """
    # Fetch coverage data internally
    coverage_data = await fetch_coverage_for_sampling(
        campaign_id, indicator_id, sampling_target, allow_revisit, admin_pcode,
        min_population, population_field
    )

    activity.logger.info(f"Fetched {len(coverage_data)} {sampling_target} for adaptive sampling")

    # Build GeoJSON features
    features = []
    for idx, record in enumerate(coverage_data):
        if sampling_target == 'pixels':
            # Use centroid point for pixels
            geometry = {
                'type': 'Point',
                'coordinates': [record["longitude"], record["latitude"]]
            }
            properties = {
                'quadkey': record["identifier"],
                'exceedance_probability': record["exceedance_probability"],
                'exceedance_uncertainty': record["exceedance_uncertainty"],
                'prevalence_bci_width': record["prevalence_bci_width"],
                'prevalence_prediction': record["prevalence_prediction"],
            }
        else:
            # Always use Point centroid for adaptive sampling (R function can't handle polygons)
            geometry = {
                'type': 'Point',
                'coordinates': [record["longitude"], record["latitude"]]
            }
            properties = record.get("properties", {}).copy()
            properties.update({
                'external_id': record["identifier"],
                'exceedance_probability': record["exceedance_probability"],
                'exceedance_uncertainty': record["exceedance_uncertainty"],
                'prevalence_bci_width': record["prevalence_bci_width"],
                'prevalence_prediction': record["prevalence_prediction"],
            })

        features.append({
            'type': 'Feature',
            'id': idx,
            'geometry': geometry,
            'properties': properties
        })

    geojson_data = {
        'type': 'FeatureCollection',
        'features': features
    }

    # Call sampling service
    payload = {
        'point_data': geojson_data,
        'uncertainty_fieldname': uncertainty_field,
        'batch_size': batch_size
    }

    activity.logger.info(f"Calling adaptive sampling service at {SAMPLING_URL}")
    activity.logger.info(f"Payload has {len(features)} features, batch_size={batch_size}, uncertainty_field={uncertainty_field}")

    response = requests.post(
        SAMPLING_URL,
        json=payload,
        headers={'Content-Type': 'application/json'},
        timeout=300
    )

    activity.logger.info(f"Response status: {response.status_code}, size: {len(response.content)} bytes")

    response.raise_for_status()

    # R function may print stdout messages before/after JSON - extract just the JSON
    response_text = response.text
    json_start = response_text.find('{')
    if json_start == -1:
        raise ValueError(f"No JSON found in response: {response_text[:200]}")

    # Find matching closing brace by counting
    depth = 0
    json_end = json_start
    for i, char in enumerate(response_text[json_start:], start=json_start):
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                json_end = i + 1
                break

    if json_start > 0 or json_end < len(response_text):
        activity.logger.info(f"Extracting JSON from position {json_start} to {json_end} (total response: {len(response_text)} bytes)")

    response_text = response_text[json_start:json_end]
    result = json.loads(response_text)

    # Extract result if wrapped
    if result.get('function_status') == 'success' and result.get('result'):
        result = result['result']

    features_result = result.get('features', [])
    activity.logger.info(f"Adaptive sampling returned {len(features_result)} features")

    # Build lookup dict by identifier for efficient fallback (sampling service doesn't preserve id field)
    identifier_to_coverage_id = {record["identifier"]: record["coverage_id"] for record in coverage_data}

    # Extract only the IDs of selected items (not the full data)
    selected_ids = []
    for idx, feature in enumerate(features_result):
        properties = feature.get('properties', {})
        adaptively_selected = properties.get('adaptively_selected', 0)

        if adaptively_selected == 1:
            # Sampling service doesn't preserve the id field, so look up by identifier
            identifier = properties.get('quadkey' if sampling_target == 'pixels' else 'external_id')
            coverage_id = identifier_to_coverage_id.get(identifier)

            if not coverage_id:
                activity.logger.warning(f"Could not find coverage record for identifier {identifier}")
            else:
                selected_ids.append(coverage_id)

    activity.logger.info(f"Selected {len(selected_ids)} {sampling_target} for sampling")

    return {
        'selected_ids': selected_ids,
        'total_items': len(coverage_data)
    }


@activity.defn
async def update_round_assignments(
    selected_ids: List[str],
    round_number: int,
    sampling_target: str
) -> int:
    """
    Update coverage records with round assignments.

    Args:
        selected_ids: List of coverage IDs that were selected
        round_number: Round number to assign
        sampling_target: 'locations' or 'pixels'

    Returns:
        Number of items updated
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        if not selected_ids:
            return 0

        # Batch update all selected records
        if sampling_target == 'pixels':
            cursor.executemany("""
                UPDATE coverage_pixel
                SET rounds = array_append(rounds, %s),
                    updated_at = NOW()
                WHERE id = %s
            """, [(round_number, coverage_id) for coverage_id in selected_ids])
        else:
            cursor.executemany("""
                UPDATE coverage
                SET rounds = array_append(rounds, %s),
                    updated_at = NOW()
                WHERE id = %s
            """, [(round_number, coverage_id) for coverage_id in selected_ids])

        conn.commit()
        selected_count = len(selected_ids)
        activity.logger.info(f"Updated {selected_count} {sampling_target} with round {round_number}")
        return selected_count
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def delete_round_record(round_id: str) -> None:
    """
    Delete round record (compensation activity).

    Args:
        round_id: Round ID to delete
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            DELETE FROM rounds WHERE id = %s
        """, (round_id,))
        conn.commit()
        activity.logger.info(f"Deleted round {round_id}")
    finally:
        cursor.close()
        return_db_connection(conn)
