from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_campaign_access
from db.connection import get_db_connection, return_db_connection
from routes.locations import calculate_quadkey
from routes.coverage import update_coverage_pixel
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

        campaign_id = visits_data[0].get('campaign_id')
        round_id = visits_data[0].get('round_id')
        indicator_id = visits_data[0].get('indicator_id')

        if not campaign_id or not round_id or not indicator_id:
            return jsonify({'error': 'campaign_id, round_id, and indicator_id are required'}), 400

        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        # Check if this is a preview request
        preview_mode = request.args.get('preview', '').lower() == 'true'

        conn = get_db_connection()
        cursor = conn.cursor()

        matched_by_id = 0
        matched_by_proximity = 0
        new_locations = 0
        total_processed = 0
        errors = []
        affected_quadkeys = set()  # Track quadkeys that need coverage_pixel update

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
                match_type = None

                # Step 1: Check if uploaded_location_id matches existing location by ID
                if uploaded_location_id:
                    cursor.execute("""
                        SELECT id FROM locations
                        WHERE id = %s AND campaign_id = %s
                    """, (uploaded_location_id, campaign_id))

                    location_result = cursor.fetchone()
                    if location_result:
                        actual_location_id = str(location_result[0])
                        matched_by_id += 1
                        match_type = 'id'

                # Step 2: If no ID match, try proximity match (within 50 meters)
                if not actual_location_id:
                    cursor.execute("""
                        SELECT id, ST_Distance(
                            geometry::geography,
                            ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                        ) as distance
                        FROM locations
                        WHERE campaign_id = %s
                          AND ST_DWithin(
                              geometry::geography,
                              ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                              50
                          )
                        ORDER BY distance
                        LIMIT 1
                    """, (longitude, latitude, campaign_id, longitude, latitude))

                    location_result = cursor.fetchone()
                    if location_result:
                        actual_location_id = str(location_result[0])
                        matched_by_proximity += 1
                        match_type = 'proximity'

                # Step 3: If no match, create new location
                if not actual_location_id:
                    # In preview mode, just count without creating
                    if preview_mode:
                        new_locations += 1
                        match_type = 'new'
                        total_processed += 1
                        continue
                    else:
                        # Create geometry Point from coordinates and calculate quadkey
                        quadkey = calculate_quadkey(latitude, longitude)
                        if quadkey:
                            affected_quadkeys.add(quadkey)
                        cursor.execute("""
                            INSERT INTO locations (campaign_id, external_id, latitude, longitude, geometry, quadkey)
                            VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
                            RETURNING id
                        """, (campaign_id, uploaded_location_id, latitude, longitude, longitude, latitude, quadkey))

                        location_result = cursor.fetchone()
                        actual_location_id = str(location_result[0])
                        new_locations += 1
                        match_type = 'new'

                # In preview mode, skip database updates
                if not preview_mode:
                    # Update coverage entry for this location + indicator
                    # Check if coverage entry exists for this location_id and indicator_id
                    cursor.execute("""
                        SELECT id, rounds FROM coverage
                        WHERE location_id = %s AND indicator_id = %s
                        LIMIT 1
                    """, (actual_location_id, indicator_id))

                    coverage_result = cursor.fetchone()

                    # Get the round number from round_id
                    cursor.execute("""
                        SELECT round_number FROM rounds WHERE id = %s
                    """, (round_id,))
                    round_result = cursor.fetchone()
                    round_number = round_result[0] if round_result else None

                    if coverage_result:
                        # Update existing coverage entry with new visit data and recalculate quadkey
                        # Add round_number to rounds array if not already present
                        existing_rounds = coverage_result[1] if coverage_result[1] else []
                        updated_rounds = list(set(existing_rounds + [round_number])) if round_number else existing_rounds

                        # Recalculate quadkey from current location coordinates
                        quadkey = calculate_quadkey(latitude, longitude)
                        if quadkey:
                            affected_quadkeys.add(quadkey)

                        cursor.execute("""
                            UPDATE coverage
                            SET n_trials = %s,
                                n_covered = %s,
                                rounds = %s,
                                quadkey = %s,
                                updated_at = NOW()
                            WHERE id = %s
                        """, (n_trials, n_covered, updated_rounds, quadkey, coverage_result[0]))
                    else:
                        # Only create new coverage entry if this is a new location_id
                        # Calculate quadkey from location coordinates
                        quadkey = calculate_quadkey(latitude, longitude)
                        if quadkey:
                            affected_quadkeys.add(quadkey)
                        initial_rounds = [round_number] if round_number else []
                        cursor.execute("""
                            INSERT INTO coverage (
                                location_id, campaign_id, indicator_id,
                                version, n_trials, n_covered, rounds, quadkey
                            )
                            VALUES (%s, %s, %s, 0, %s, %s, %s, %s)
                        """, (actual_location_id, campaign_id, indicator_id, n_trials, n_covered, initial_rounds, quadkey))

                total_processed += 1

            except Exception as e:
                errors.append(f"Error processing location {uploaded_location_id or 'unknown'}: {str(e)}")
                continue

        # Update coverage_pixel table with aggregated data (only if not in preview mode)
        if not preview_mode and affected_quadkeys:
            try:
                update_coverage_pixel(cursor, campaign_id, indicator_id, list(affected_quadkeys))
            except Exception as e:
                print(f"Error updating coverage_pixel: {e}")
                # Don't fail the entire request if coverage_pixel update fails

        # Only commit if not in preview mode
        if not preview_mode:
            conn.commit()

        cursor.close()

        return jsonify({
            'success': True,
            'preview': preview_mode,
            'summary': {
                'total_processed': total_processed,
                'matched_by_id': matched_by_id,
                'matched_by_proximity': matched_by_proximity,
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


@visits_bp.route('/api/visits/bulk/workflow', methods=['POST'])
@require_auth
def create_visits_bulk_workflow(user):
    """Start a Temporal workflow to process bulk visit uploads"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.visit_upload import VisitUploadWorkflow

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        visits_data = data.get('visits', [])
        if not visits_data:
            return jsonify({'error': 'visits array is required'}), 400

        campaign_id = visits_data[0].get('campaign_id')
        round_id = visits_data[0].get('round_id')
        indicator_id = visits_data[0].get('indicator_id')

        if not campaign_id or not round_id or not indicator_id:
            return jsonify({'error': 'campaign_id, round_id, and indicator_id are required'}), 400

        # Check if user has access to this area
        if not check_campaign_access(user['id'], campaign_id):
            return jsonify({'error': 'Access denied'}), 403

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"visit-upload-{campaign_id}-{round_id}-{timestamp}"

        # Start workflow
        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                VisitUploadWorkflow.run,
                args=[campaign_id, indicator_id, round_id, visits_data],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        print(f"Started visit upload workflow: {workflow_id}")

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started',
            'message': 'Visit upload started. Use the workflow_id to check progress.'
        }), 202

    except Exception as e:
        print(f"Error starting visit upload workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start visit upload', 'details': str(e)}), 500


@visits_bp.route('/api/visits/bulk/workflow/<workflow_id>/status', methods=['GET'])
@require_auth
def get_visit_upload_status(user, workflow_id):
    """Get status of visit upload workflow"""
    import asyncio
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.visit_upload import VisitUploadWorkflow
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
                        progress = await handle.query(VisitUploadWorkflow.get_progress)
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
