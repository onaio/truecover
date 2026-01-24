from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_campaign_access
from db.connection import get_db_connection, return_db_connection
import json
import requests
import os

rounds_bp = Blueprint('rounds', __name__)

# Docker function URL for adaptive sampling
SAMPLING_URL = os.getenv('DOCKER_FN_SAMPLING_URL', 'http://localhost:8083')


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds/workflow', methods=['POST'])
@require_auth
def create_round_workflow(user, campaign_id):
    """Create a new round using Temporal workflow"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.round_generation import RoundGenerationWorkflow

    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        name = data.get('name')
        description = data.get('description', '')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        indicator_id = data.get('indicator_id')
        batch_size = data.get('batch_size', 10)
        uncertainty_field = data.get('uncertainty_field', 'exceedance_uncertainty')
        allow_revisit = data.get('allow_revisit', False)
        sampling_target = data.get('sampling_target', 'locations')
        admin_pcode = data.get('admin_pcode')
        min_population = data.get('min_population')
        population_field = data.get('population_field')

        if not name:
            return jsonify({'error': 'Round name is required'}), 400

        if not indicator_id:
            return jsonify({'error': 'Indicator ID is required'}), 400

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"round-generation-{campaign_id}-{indicator_id}-{timestamp}"

        # Start workflow
        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                RoundGenerationWorkflow.run,
                args=[
                    campaign_id,
                    name,
                    description,
                    start_date,
                    end_date,
                    indicator_id,
                    batch_size,
                    uncertainty_field,
                    allow_revisit,
                    sampling_target,
                    admin_pcode,
                    min_population,
                    population_field
                ],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        print(f"Started round generation workflow: {workflow_id}")

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started',
            'message': 'Round generation started. Use the workflow_id to check progress.'
        }), 202

    except Exception as e:
        print(f"Error starting round generation workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start round generation', 'details': str(e)}), 500


@rounds_bp.route('/api/rounds/workflow/<workflow_id>/status', methods=['GET'])
@require_auth
def get_round_workflow_status(user, workflow_id):
    """Get status of round generation workflow"""
    import asyncio
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.round_generation import RoundGenerationWorkflow
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
                        progress = await handle.query(RoundGenerationWorkflow.get_progress)
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
                elif desc.status == WorkflowExecutionStatus.FAILED:
                    # Extract failure message from workflow history
                    error_message = "Workflow failed"
                    try:
                        # Try to get the result which will raise an exception with the error
                        await handle.result()
                    except Exception as e:
                        error_message = str(e)
                    return {
                        "workflow_id": workflow_id,
                        "status": "failed",
                        "error": error_message
                    }
                else:
                    # Cancelled or other status
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


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds', methods=['POST'])
@require_auth
def create_round(user, campaign_id):
    """Create a new round and run adaptive sampling using Temporal workflow"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.round_generation import RoundGenerationWorkflow

    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        name = data.get('name')
        description = data.get('description', '')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        indicator_id = data.get('indicator_id')
        batch_size = data.get('batch_size', 10)
        uncertainty_field = data.get('uncertainty_field', 'exceedance_uncertainty')
        allow_revisit = data.get('allow_revisit', False)
        sampling_target = data.get('sampling_target', 'locations')
        admin_pcode = data.get('admin_pcode')
        min_population = data.get('min_population')
        population_field = data.get('population_field')

        if not name:
            return jsonify({'error': 'Round name is required'}), 400

        if not indicator_id:
            return jsonify({'error': 'Indicator ID is required'}), 400

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"round-generation-{campaign_id}-{timestamp}"

        # Start workflow
        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                RoundGenerationWorkflow.run,
                args=[
                    campaign_id, name, description, start_date, end_date,
                    indicator_id, batch_size, uncertainty_field,
                    allow_revisit, sampling_target, admin_pcode,
                    min_population, population_field
                ],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        print(f"Started round generation workflow: {workflow_id}")

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started',
            'message': 'Round generation started. Use the workflow_id to check progress.'
        }), 202

    except Exception as e:
        print(f"Error starting round generation workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start round generation', 'details': str(e)}), 500


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds/stratified-cluster', methods=['POST'])
@require_auth
def create_stratified_cluster_round(user, campaign_id):
    """Create a new round using stratified cluster sampling workflow"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.stratified_cluster_sampling import StratifiedClusterSamplingWorkflow

    try:
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        # Required fields
        name = data.get('name')
        starting_pcode = data.get('starting_pcode')
        categories = data.get('categories', {})
        upazila_count = data.get('upazila_count', 3)
        unions_per_upazila = data.get('unions_per_upazila', 2)
        pixels_per_union = data.get('pixels_per_union', 50)
        indicator_id = data.get('indicator_id')

        # Optional fields
        description = data.get('description', '')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        population_weighted = data.get('population_weighted', False)
        category_weights = data.get('category_weights')
        min_population = data.get('min_population')
        uncertainty_field = data.get('uncertainty_field', 'prevalence_bci_width')

        # Validation
        if not name:
            return jsonify({'error': 'Round name is required'}), 400
        if not starting_pcode:
            return jsonify({'error': 'Starting PCODE is required'}), 400
        if not indicator_id:
            return jsonify({'error': 'Indicator ID is required'}), 400
        if not categories or all(len(v) == 0 for v in categories.values()):
            return jsonify({'error': 'At least one area must be categorized'}), 400

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"stratified-cluster-{campaign_id}-{timestamp}"

        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                StratifiedClusterSamplingWorkflow.run,
                args=[
                    campaign_id,
                    name,
                    description,
                    start_date,
                    end_date,
                    indicator_id,
                    starting_pcode,
                    categories,
                    upazila_count,
                    unions_per_upazila,
                    pixels_per_union,
                    population_weighted,
                    category_weights,
                    min_population,
                    uncertainty_field,
                ],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started',
            'message': 'Stratified cluster sampling started.'
        }), 202

    except Exception as e:
        print(f"Error starting stratified cluster sampling: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start workflow', 'details': str(e)}), 500


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds_old', methods=['POST'])
@require_auth
def create_round_old(user, campaign_id):
    """OLD SYNCHRONOUS VERSION - Create a new round and run adaptive sampling on locations"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        name = data.get('name')
        description = data.get('description', '')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        indicator_id = data.get('indicator_id')
        batch_size = data.get('batch_size', 10)
        uncertainty_field = data.get('uncertainty_field', 'exceedance_uncertainty')
        allow_revisit = data.get('allow_revisit', False)
        sampling_target = data.get('sampling_target', 'locations')
        admin_pcode = data.get('admin_pcode')

        if not name:
            return jsonify({'error': 'Round name is required'}), 400

        if not indicator_id:
            return jsonify({'error': 'Indicator ID is required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get the next round number for this area
        cursor.execute("""
            SELECT COALESCE(MAX(round_number), 0) + 1
            FROM rounds
            WHERE campaign_id = %s
        """, (campaign_id,))
        round_number = cursor.fetchone()[0]

        # Create the round
        cursor.execute("""
            INSERT INTO rounds (campaign_id, round_number, name, description, start_date, end_date, indicator_id, sampling_target)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, round_number, name, description, start_date, end_date, created_at, updated_at, sampling_target
        """, (campaign_id, round_number, name, description, start_date, end_date, indicator_id, sampling_target))

        round_data = cursor.fetchone()
        round_id = str(round_data[0])

        # Fetch data based on sampling target (locations or pixels)
        if sampling_target == 'pixels':
            # Fetch coverage_pixel data joined with pixels
            if allow_revisit:
                if admin_pcode:
                    cursor.execute("""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                          AND (p.adm1_pcode = %s OR p.adm2_pcode = %s OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
                    """, (campaign_id, indicator_id, admin_pcode, admin_pcode, admin_pcode, admin_pcode))
                else:
                    cursor.execute("""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                    """, (campaign_id, indicator_id))
            else:
                # Only include pixels that have NOT been visited in any round
                if admin_pcode:
                    cursor.execute("""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                          AND (cp.rounds IS NULL OR array_length(cp.rounds, 1) IS NULL OR array_length(cp.rounds, 1) = 0)
                          AND (p.adm1_pcode = %s OR p.adm2_pcode = %s OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
                    """, (campaign_id, indicator_id, admin_pcode, admin_pcode, admin_pcode, admin_pcode))
                else:
                    cursor.execute("""
                        SELECT
                            cp.id as coverage_pixel_id,
                            cp.quadkey,
                            ST_AsGeoJSON(p.geometry) as geometry,
                            p.latitude, p.longitude,
                            cp.exceedance_probability, cp.exceedance_uncertainty,
                            cp.prevalence_bci_width, cp.prevalence_prediction
                        FROM coverage_pixel cp
                        LEFT JOIN pixels p ON cp.quadkey = p.quadkey
                        WHERE cp.campaign_id = %s AND cp.indicator_id = %s AND cp.version = 0
                          AND (cp.rounds IS NULL OR array_length(cp.rounds, 1) IS NULL OR array_length(cp.rounds, 1) = 0)
                    """, (campaign_id, indicator_id))
        else:
            # Fetch coverage data for locations
            if allow_revisit:
                if admin_pcode:
                    # Filter locations by admin boundary via spatial join
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
                # Only include locations that have NOT been visited in any round
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

        locations = cursor.fetchall()

        if not locations:
            conn.rollback()
            cursor.close()
            target_name = 'pixels' if sampling_target == 'pixels' else 'locations'
            return jsonify({'error': f'No {target_name} found in this area'}), 400

        # Convert data to GeoJSON for adaptive sampling
        features = []
        coverage_ids = {}  # Map feature index to coverage_id (or coverage_pixel_id)

        if sampling_target == 'pixels':
            # Process pixel data (use centroid point)
            for idx, pix in enumerate(locations):
                coverage_pixel_id = str(pix[0])
                quadkey = pix[1]
                # Always use centroid point for pixels (not polygon)
                geometry = {
                    'type': 'Point',
                    'coordinates': [float(pix[4]), float(pix[3])]
                }

                properties = {
                    'quadkey': quadkey,
                    'exceedance_probability': float(pix[5]) if pix[5] else 0,
                    'exceedance_uncertainty': float(pix[6]) if pix[6] else 0,
                    'prevalence_bci_width': float(pix[7]) if pix[7] else 0,
                    'prevalence_prediction': float(pix[8]) if pix[8] else 0,
                }

                feature = {
                    'type': 'Feature',
                    'id': idx,
                    'geometry': geometry,
                    'properties': properties
                }
                features.append(feature)
                # Map by index and quadkey to coverage_pixel_id for lookup
                coverage_ids[idx] = coverage_pixel_id
                coverage_ids[quadkey] = coverage_pixel_id
        else:
            # Process location data (existing behavior)
            for idx, cov in enumerate(locations):
                coverage_id = str(cov[0])
                location_id = str(cov[1])
                # Always use centroid point for adaptive sampling (R function can't handle polygons)
                geometry = {
                    'type': 'Point',
                    'coordinates': [float(cov[4]), float(cov[3])]
                }

                properties = cov[9] if isinstance(cov[9], dict) else json.loads(cov[9]) if cov[9] else {}
                external_id = cov[10]
                properties.update({
                    'exceedance_probability': float(cov[5]) if cov[5] else 0,
                    'exceedance_uncertainty': float(cov[6]) if cov[6] else 0,
                    'prevalence_bci_width': float(cov[7]) if cov[7] else 0,
                    'prevalence_prediction': float(cov[8]) if cov[8] else 0,
                    'external_id': external_id,
                })

                feature = {
                    'type': 'Feature',
                    'id': idx,
                    'geometry': geometry,
                    'properties': properties
                }
                features.append(feature)
                # Map both by index and external_id to coverage_id for lookup
                coverage_ids[idx] = coverage_id
                if external_id:
                    coverage_ids[external_id] = coverage_id

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
        print(f"CREATING ROUND {round_number} FOR AREA {campaign_id}")
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

            # R function may print stdout messages before/after JSON - extract just the JSON
            response_text = response.text
            json_start = response_text.find('{')
            if json_start == -1:
                conn.rollback()
                cursor.close()
                return jsonify({'error': 'No JSON in response', 'details': response_text[:200]}), 500

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
                print(f"DEBUG: Extracting JSON from position {json_start} to {json_end}")

            response_text = response_text[json_start:json_end]
            result = json.loads(response_text)

            # Extract result if wrapped
            if result.get('function_status') == 'success' and result.get('result'):
                result = result['result']

            # Debug logging
            print(f"DEBUG: Adaptive sampling returned {len(result.get('features', []))} features")

            # Update coverage or coverage_pixel rounds array with round assignment
            selected_count = 0
            if result.get('features'):
                for feature in result['features']:
                    feature_id = feature.get('id')
                    properties = feature.get('properties', {})
                    adaptively_selected = properties.get('adaptively_selected', 0)

                    if sampling_target == 'pixels':
                        quadkey = properties.get('quadkey')
                        print(f"DEBUG: Feature id={feature_id}, quadkey={quadkey}, adaptively_selected={adaptively_selected}")

                        if adaptively_selected == 1:
                            # Try to find coverage_pixel_id using feature_id first, then quadkey
                            coverage_pixel_id = None
                            if feature_id is not None:
                                coverage_pixel_id = coverage_ids.get(feature_id)
                            if not coverage_pixel_id and quadkey:
                                coverage_pixel_id = coverage_ids.get(quadkey)

                            print(f"DEBUG: Selected pixel -> coverage_pixel_id={coverage_pixel_id}")
                            if coverage_pixel_id:
                                # Add round_number to coverage_pixel.rounds array
                                cursor.execute("""
                                    UPDATE coverage_pixel
                                    SET rounds = array_append(rounds, %s),
                                        updated_at = NOW()
                                    WHERE id = %s
                                """, (round_number, coverage_pixel_id))
                                print(f"DEBUG: Coverage_pixel {coverage_pixel_id} added to round {round_number}")
                                selected_count += 1
                            else:
                                print(f"DEBUG: WARNING - Could not find coverage_pixel_id for feature {feature_id}/{quadkey}")
                    else:
                        external_id = properties.get('external_id')
                        print(f"DEBUG: Feature id={feature_id}, external_id={external_id}, adaptively_selected={adaptively_selected}")

                        if adaptively_selected == 1:
                            # Try to find coverage_id using feature_id first, then external_id
                            coverage_id = None
                            if feature_id is not None:
                                coverage_id = coverage_ids.get(feature_id)
                            if not coverage_id and external_id:
                                coverage_id = coverage_ids.get(external_id)

                            print(f"DEBUG: Selected location -> coverage_id={coverage_id}")
                            if coverage_id:
                                # Add round_number to coverage.rounds array
                                cursor.execute("""
                                    UPDATE coverage
                                    SET rounds = array_append(rounds, %s),
                                        updated_at = NOW()
                                    WHERE id = %s
                                """, (round_number, coverage_id))
                                print(f"DEBUG: Coverage {coverage_id} added to round {round_number}")
                                selected_count += 1
                            else:
                                print(f"DEBUG: WARNING - Could not find coverage_id for feature {feature_id}/{external_id}")

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
                'sampling_target': round_data[8] if len(round_data) > 8 else 'locations',
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


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds', methods=['GET'])
@require_auth
def list_rounds(user, campaign_id):
    """Get all rounds for an area"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                id, round_number, name, description,
                start_date, end_date, created_at, updated_at, sampling_target
            FROM rounds
            WHERE campaign_id = %s
            ORDER BY round_number ASC
        """, (campaign_id,))

        rounds = []
        for row in cursor.fetchall():
            # Count locations in this round (from coverage table)
            cursor.execute("""
                SELECT COUNT(DISTINCT location_id)
                FROM coverage
                WHERE campaign_id = %s AND %s = ANY(rounds)
            """, (campaign_id, row[1]))
            location_count = cursor.fetchone()[0]

            # Count pixels in this round (from coverage_pixel table)
            cursor.execute("""
                SELECT COUNT(DISTINCT quadkey)
                FROM coverage_pixel
                WHERE campaign_id = %s AND %s = ANY(rounds)
            """, (campaign_id, row[1]))
            pixel_count = cursor.fetchone()[0]

            rounds.append({
                'id': str(row[0]),
                'round_number': row[1],
                'name': row[2],
                'description': row[3],
                'start_date': row[4].isoformat() if row[4] else None,
                'end_date': row[5].isoformat() if row[5] else None,
                'created_at': row[6].isoformat() if row[6] else None,
                'updated_at': row[7].isoformat() if row[7] else None,
                'sampling_target': row[8] if len(row) > 8 else 'locations',
                'location_count': location_count,
                'pixel_count': pixel_count
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


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds/<round_id>', methods=['GET'])
@require_auth
def get_round(user, campaign_id, round_id):
    """Get details of a specific round"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                id, round_number, name, description,
                start_date, end_date, created_at, updated_at
            FROM rounds
            WHERE id = %s AND campaign_id = %s
        """, (round_id, campaign_id))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Round not found'}), 404

        # Count locations in this round (from coverage table)
        cursor.execute("""
            SELECT COUNT(DISTINCT location_id)
            FROM coverage
            WHERE campaign_id = %s AND %s = ANY(rounds)
        """, (campaign_id, row[1]))
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


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds/<round_id>', methods=['PUT'])
@require_auth
def update_round(user, campaign_id, round_id):
    """Update round metadata"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify round exists
        cursor.execute("""
            SELECT id FROM rounds
            WHERE id = %s AND campaign_id = %s
        """, (round_id, campaign_id))

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
            WHERE id = %s AND campaign_id = %s
        """, (
            data.get('name'),
            data.get('description'),
            data.get('start_date'),
            data.get('end_date'),
            round_id,
            campaign_id
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


@rounds_bp.route('/api/campaigns/<campaign_id>/rounds/<round_id>', methods=['DELETE'])
@require_auth
def delete_round(user, campaign_id, round_id):
    """Delete a round and remove it from all coverage entries"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Get round number before deleting
        cursor.execute("""
            SELECT round_number FROM rounds
            WHERE id = %s AND campaign_id = %s
        """, (round_id, campaign_id))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Round not found'}), 404

        round_number = result[0]

        # Remove this round from all coverage entries
        cursor.execute("""
            UPDATE coverage
            SET rounds = array_remove(rounds, %s),
                updated_at = NOW()
            WHERE campaign_id = %s AND %s = ANY(rounds)
        """, (round_number, campaign_id, round_number))

        # Delete the round
        cursor.execute("""
            DELETE FROM rounds
            WHERE id = %s AND campaign_id = %s
        """, (round_id, campaign_id))

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
