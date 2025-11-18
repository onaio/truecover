# ABOUTME: API endpoints for pixel enrichment jobs
# ABOUTME: Provides async job creation and status tracking for COG/STAC data enrichment

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection

enrichment_bp = Blueprint('enrichment', __name__)


@enrichment_bp.route('/api/areas/<area_id>/enrich-pixels', methods=['POST'])
@require_auth
def create_enrichment_job(user, area_id):
    """Create a new pixel enrichment job and start workflow"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.pixel_enrichment import PixelEnrichmentWorkflow

    conn = None
    try:
        check_area_access(user['id'], area_id)

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        data_source_id = data.get('data_source_id')
        if not data_source_id:
            return jsonify({'error': 'data_source_id is required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify data source exists
        cursor.execute("""
            SELECT id, default_statistic FROM data_sources WHERE id = %s
        """, (data_source_id,))

        ds_row = cursor.fetchone()
        if not ds_row:
            cursor.close()
            return jsonify({'error': 'Data source not found'}), 404

        default_statistic = ds_row[1]
        statistic = data.get('statistic', default_statistic)

        # Count pixels for this area
        cursor.execute("""
            SELECT COUNT(*) FROM pixels WHERE area_id = %s
        """, (area_id,))
        pixels_total = cursor.fetchone()[0]

        if pixels_total == 0:
            cursor.close()
            return jsonify({'error': 'No pixels found for this area. Generate pixels first.'}), 400

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"pixel-enrichment-{area_id}-{data_source_id}-{timestamp}"

        # Create job with workflow_id
        cursor.execute("""
            INSERT INTO enrichment_jobs (
                area_id,
                data_source_id,
                statistic,
                status,
                pixels_total,
                workflow_id
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, area_id, data_source_id, statistic, status,
                      pixels_processed, pixels_total, error_message,
                      retry_count, last_attempted_at,
                      created_at, updated_at, workflow_id
        """, (area_id, data_source_id, statistic, 'pending', pixels_total, workflow_id))

        row = cursor.fetchone()
        job_id = str(row[0])
        conn.commit()
        cursor.close()
        return_db_connection(conn)
        conn = None

        # Start workflow
        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                PixelEnrichmentWorkflow.run,
                args=[job_id],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        print(f"Started pixel enrichment workflow: {workflow_id} for job {job_id}")

        job = {
            'id': job_id,
            'area_id': str(row[1]),
            'data_source_id': str(row[2]),
            'statistic': row[3],
            'status': row[4],
            'pixels_processed': row[5],
            'pixels_total': row[6],
            'error_message': row[7],
            'retry_count': row[8],
            'last_attempted_at': row[9].isoformat() if row[9] else None,
            'created_at': row[10].isoformat() if row[10] else None,
            'updated_at': row[11].isoformat() if row[11] else None,
            'workflow_id': workflow_id
        }

        return jsonify(job), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating enrichment job: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to create enrichment job', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@enrichment_bp.route('/api/enrichment-jobs/<job_id>', methods=['GET'])
@require_auth
def get_enrichment_job(user, job_id):
    """Get status of an enrichment job"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                ej.id, ej.area_id, ej.data_source_id, ej.statistic, ej.status,
                ej.pixels_processed, ej.pixels_total, ej.error_message,
                ej.retry_count, ej.last_attempted_at,
                ej.created_at, ej.updated_at,
                ds.name as data_source_name,
                ds.metadata_field_name
            FROM enrichment_jobs ej
            JOIN data_sources ds ON ej.data_source_id = ds.id
            WHERE ej.id = %s
        """, (job_id,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Enrichment job not found'}), 404

        area_id = str(row[1])
        check_area_access(user['id'], area_id)

        job = {
            'id': str(row[0]),
            'area_id': area_id,
            'data_source_id': str(row[2]),
            'statistic': row[3],
            'status': row[4],
            'pixels_processed': row[5],
            'pixels_total': row[6],
            'error_message': row[7],
            'retry_count': row[8],
            'last_attempted_at': row[9].isoformat() if row[9] else None,
            'created_at': row[10].isoformat() if row[10] else None,
            'updated_at': row[11].isoformat() if row[11] else None,
            'data_source': {
                'name': row[12],
                'metadata_field_name': row[13]
            }
        }

        cursor.close()
        return jsonify(job), 200

    except Exception as e:
        print(f"Error getting enrichment job: {e}")
        return jsonify({'error': 'Failed to get enrichment job', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@enrichment_bp.route('/api/areas/<area_id>/enrichment-jobs', methods=['GET'])
@require_auth
def list_enrichment_jobs(user, area_id):
    """List all enrichment jobs for an area"""
    conn = None
    try:
        check_area_access(user['id'], area_id)

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                ej.id, ej.area_id, ej.data_source_id, ej.statistic, ej.status,
                ej.pixels_processed, ej.pixels_total, ej.error_message,
                ej.retry_count, ej.last_attempted_at,
                ej.created_at, ej.updated_at,
                ds.name as data_source_name,
                ds.metadata_field_name
            FROM enrichment_jobs ej
            JOIN data_sources ds ON ej.data_source_id = ds.id
            WHERE ej.area_id = %s
            ORDER BY ej.created_at DESC
        """, (area_id,))

        jobs = []
        for row in cursor.fetchall():
            jobs.append({
                'id': str(row[0]),
                'area_id': str(row[1]),
                'data_source_id': str(row[2]),
                'statistic': row[3],
                'status': row[4],
                'pixels_processed': row[5],
                'pixels_total': row[6],
                'error_message': row[7],
                'retry_count': row[8],
                'last_attempted_at': row[9].isoformat() if row[9] else None,
                'created_at': row[10].isoformat() if row[10] else None,
                'updated_at': row[11].isoformat() if row[11] else None,
                'data_source': {
                    'name': row[12],
                    'metadata_field_name': row[13]
                }
            })

        cursor.close()
        return jsonify({'jobs': jobs}), 200

    except Exception as e:
        print(f"Error listing enrichment jobs: {e}")
        return jsonify({'error': 'Failed to list enrichment jobs', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@enrichment_bp.route('/api/enrichment-jobs/<job_id>', methods=['DELETE'])
@require_auth
def delete_enrichment_job(user, job_id):
    """Delete an enrichment job"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get job to verify area access
        cursor.execute("""
            SELECT area_id FROM enrichment_jobs WHERE id = %s
        """, (job_id,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Enrichment job not found'}), 404

        area_id = str(row[0])
        check_area_access(user['id'], area_id)

        # Delete the job
        cursor.execute("""
            DELETE FROM enrichment_jobs WHERE id = %s
        """, (job_id,))

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting enrichment job: {e}")
        return jsonify({'error': 'Failed to delete enrichment job', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@enrichment_bp.route('/api/enrichment-jobs/<job_id>/retry', methods=['POST'])
@require_auth
def retry_enrichment_job(user, job_id):
    """Retry a failed enrichment job"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get job to verify area access and status
        cursor.execute("""
            SELECT area_id, status, retry_count FROM enrichment_jobs WHERE id = %s
        """, (job_id,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Enrichment job not found'}), 404

        area_id = str(row[0])
        status = row[1]
        retry_count = row[2]

        check_area_access(user['id'], area_id)

        if status not in ['failed', 'completed']:
            cursor.close()
            return jsonify({'error': f'Can only retry failed or completed jobs. Current status: {status}'}), 400

        # Reset the job to pending
        cursor.execute("""
            UPDATE enrichment_jobs
            SET status = 'pending',
                retry_count = 0,
                error_message = NULL,
                pixels_processed = 0,
                last_attempted_at = NULL,
                updated_at = NOW()
            WHERE id = %s
        """, (job_id,))

        conn.commit()
        cursor.close()

        return jsonify({'success': True, 'message': 'Job reset to pending and will be retried'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error retrying enrichment job: {e}")
        return jsonify({'error': 'Failed to retry enrichment job', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@enrichment_bp.route('/api/areas/<area_id>/enrichment-jobs/failed', methods=['DELETE'])
@require_auth
def clear_failed_jobs(user, area_id):
    """Clear all failed enrichment jobs for an area"""
    conn = None
    try:
        check_area_access(user['id'], area_id)

        conn = get_db_connection()
        cursor = conn.cursor()

        # Delete all failed jobs for this area
        cursor.execute("""
            DELETE FROM enrichment_jobs
            WHERE area_id = %s AND status = 'failed'
            RETURNING id
        """, (area_id,))

        deleted_jobs = cursor.fetchall()
        deleted_count = len(deleted_jobs)

        conn.commit()
        cursor.close()

        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'message': f'Deleted {deleted_count} failed job(s)'
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error clearing failed jobs: {e}")
        return jsonify({'error': 'Failed to clear failed jobs', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
