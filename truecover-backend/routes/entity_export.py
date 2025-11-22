# ABOUTME: Routes for exporting pixel coverage data to ODK entity lists
# ABOUTME: Handles starting and monitoring Temporal workflows for entity creation

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access

entity_export_bp = Blueprint('entity_export', __name__)


@entity_export_bp.route('/api/areas/<area_id>/export-entities/workflow', methods=['POST'])
@require_auth
def start_entity_export_workflow(user, area_id):
    """Start a Temporal workflow to export pixels to ODK entity list"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.entity_export import EntityExportWorkflow

    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        indicator_id = data.get('indicator_id')
        round_ids = data.get('round_ids', [])
        project_id = data.get('project_id')

        if not indicator_id:
            return jsonify({'error': 'indicator_id is required'}), 400

        if not round_ids or len(round_ids) == 0:
            return jsonify({'error': 'round_ids array is required and must not be empty'}), 400

        if not project_id:
            return jsonify({'error': 'project_id is required'}), 400

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"entity-export-{area_id}-{timestamp}"

        # Start workflow
        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                EntityExportWorkflow.run,
                args=[area_id, indicator_id, round_ids, project_id],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        print(f"Started entity export workflow: {workflow_id}")

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started',
            'message': 'Entity export started. Use the workflow_id to check progress.'
        }), 202

    except Exception as e:
        print(f"Error starting entity export workflow: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start entity export', 'details': str(e)}), 500


@entity_export_bp.route('/api/entity-export/<workflow_id>/status', methods=['GET'])
@require_auth
def get_entity_export_status(user, workflow_id):
    """Get status of entity export workflow"""
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.entity_export import EntityExportWorkflow
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
                        progress = await handle.query(EntityExportWorkflow.get_progress)
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
                    # Get failure info
                    try:
                        result = await handle.result()
                    except Exception as e:
                        return {
                            "workflow_id": workflow_id,
                            "status": "failed",
                            "error": str(e)
                        }
                    return {
                        "workflow_id": workflow_id,
                        "status": "failed",
                        "error": "Workflow failed"
                    }
                else:
                    # Other status (cancelled, etc)
                    return {
                        "workflow_id": workflow_id,
                        "status": desc.status.name.lower()
                    }
            except Exception as e:
                # Workflow not found or error
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
