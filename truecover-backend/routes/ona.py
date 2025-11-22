from flask import Blueprint, jsonify, request
import requests
from auth.middleware import require_auth
from auth.helpers import check_project_access
from db.connection import get_db_connection, return_db_connection

ona_bp = Blueprint('ona', __name__)

@ona_bp.route('/api/projects/<project_id>/ona/verify-credentials', methods=['POST'])
@require_auth
def verify_credentials_and_list_projects(user, project_id):
    """Verify Ona credentials and list available projects"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        data = request.get_json()
        api_key = data.get('api_key')
        host_url = data.get('host_url')

        if not api_key or not host_url:
            return jsonify({'error': 'Both api_key and host_url are required'}), 400

        # Remove trailing slash from host_url if present
        host_url = host_url.rstrip('/')

        # Make request to Ona API to verify credentials and get projects
        headers = {
            'Authorization': f'Token {api_key}'
        }

        try:
            response = requests.get(
                f'{host_url}/api/v1/projects',
                headers=headers,
                timeout=10
            )

            if response.status_code == 401:
                return jsonify({'success': False, 'error': 'Invalid API key'}), 200

            if response.status_code != 200:
                return jsonify({
                    'success': False,
                    'error': f'Ona API returned status {response.status_code}'
                }), 200

            projects = response.json()

            return jsonify({
                'success': True,
                'projects': projects
            }), 200

        except requests.exceptions.Timeout:
            return jsonify({'success': False, 'error': 'Request to Ona API timed out'}), 200
        except requests.exceptions.ConnectionError:
            return jsonify({'success': False, 'error': 'Could not connect to Ona API. Please check the host URL.'}), 200
        except Exception as e:
            return jsonify({'success': False, 'error': f'Error connecting to Ona API: {str(e)}'}), 200

    except Exception as e:
        print(f"Error verifying Ona credentials: {e}")
        return jsonify({'error': 'Failed to verify credentials', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@ona_bp.route('/api/projects/<project_id>/ona/entity-lists', methods=['GET'])
@require_auth
def get_entity_lists(user, project_id):
    """Get entity lists for a specific Ona project"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        ona_project_id = request.args.get('ona_project_id')
        if not ona_project_id:
            return jsonify({'error': 'ona_project_id parameter is required'}), 400

        # Get stored credentials from database
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT odk_api_key, odk_host_url
            FROM projects
            WHERE id = %s
        """, (project_id,))

        project_data = cursor.fetchone()
        cursor.close()

        if not project_data:
            return jsonify({'error': 'Project not found'}), 404

        api_key, host_url = project_data

        if not api_key or not host_url:
            return jsonify({'error': 'ODK credentials not configured for this project'}), 400

        # Remove trailing slash from host_url if present
        host_url = host_url.rstrip('/')

        # Make request to Ona API to get entity lists
        headers = {
            'Authorization': f'Token {api_key}'
        }

        try:
            response = requests.get(
                f'{host_url}/api/v2/entity-lists?project={ona_project_id}',
                headers=headers,
                timeout=10
            )

            if response.status_code != 200:
                return jsonify({
                    'error': f'Ona API returned status {response.status_code}',
                    'entity_lists': []
                }), 200

            entity_lists = response.json()

            return jsonify({
                'entity_lists': entity_lists
            }), 200

        except requests.exceptions.Timeout:
            return jsonify({'error': 'Request to Ona API timed out', 'entity_lists': []}), 200
        except requests.exceptions.ConnectionError:
            return jsonify({'error': 'Could not connect to Ona API', 'entity_lists': []}), 200
        except Exception as e:
            return jsonify({'error': f'Error connecting to Ona API: {str(e)}', 'entity_lists': []}), 200

    except Exception as e:
        print(f"Error getting entity lists: {e}")
        return jsonify({'error': 'Failed to get entity lists', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@ona_bp.route('/api/projects/<project_id>/ona/entities', methods=['GET'])
@require_auth
def get_entities(user, project_id):
    """Get entities from a specific Ona entity list"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        # Get stored credentials and entity list ID from database
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT odk_api_key, odk_host_url, ona_entity_list_id
            FROM projects
            WHERE id = %s
        """, (project_id,))

        project_data = cursor.fetchone()
        cursor.close()

        if not project_data:
            return jsonify({'error': 'Project not found'}), 404

        api_key, host_url, entity_list_id = project_data

        if not api_key or not host_url:
            return jsonify({'error': 'ODK credentials not configured for this project'}), 400

        if not entity_list_id:
            return jsonify({'error': 'No entity list selected for this project'}), 400

        # Remove trailing slash from host_url if present
        host_url = host_url.rstrip('/')

        # Make request to Ona API to get entities
        headers = {
            'Authorization': f'Token {api_key}'
        }

        try:
            response = requests.get(
                f'{host_url}/api/v2/entity-lists/{entity_list_id}/entities',
                headers=headers,
                timeout=30
            )

            if response.status_code != 200:
                return jsonify({
                    'error': f'Ona API returned status {response.status_code}',
                    'entities': []
                }), 200

            entities_data = response.json()

            # Handle both response formats: list or paginated dict
            if isinstance(entities_data, list):
                # Direct list response
                entities = entities_data
                total_count = len(entities)
            else:
                # Paginated response with 'results' array and 'count' for total
                entities = entities_data.get('results', [])
                total_count = entities_data.get('count', len(entities))

            return jsonify({
                'entities': entities,
                'count': total_count
            }), 200

        except requests.exceptions.Timeout:
            return jsonify({'error': 'Request to Ona API timed out', 'entities': []}), 200
        except requests.exceptions.ConnectionError:
            return jsonify({'error': 'Could not connect to Ona API', 'entities': []}), 200
        except Exception as e:
            return jsonify({'error': f'Error connecting to Ona API: {str(e)}', 'entities': []}), 200

    except Exception as e:
        print(f"Error getting entities: {e}")
        return jsonify({'error': 'Failed to get entities', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
