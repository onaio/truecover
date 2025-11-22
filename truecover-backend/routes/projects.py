from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import require_org_membership, check_project_access
from db.connection import get_db_connection, return_db_connection

projects_bp = Blueprint('projects', __name__)

@projects_bp.route('/api/organizations/<organization_id>/projects', methods=['POST'])
@require_auth
@require_org_membership
def create_project(user, organization_id):
    """Create a new project within an organization"""
    conn = None
    try:
        data = request.get_json()

        # Validate required fields
        title = data.get('title')
        if not title or not title.strip():
            return jsonify({'error': 'Project title is required'}), 400

        description = data.get('description', '')
        odk_api_key = data.get('odk_api_key')
        odk_host_url = data.get('odk_host_url')

        conn = get_db_connection()
        cursor = conn.cursor()

        # Create project
        cursor.execute("""
            INSERT INTO projects (organization_id, title, description, odk_api_key, odk_host_url)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, organization_id, title, description, created_at, updated_at,
                      odk_api_key, odk_host_url, ona_project_id, ona_project_name,
                      ona_entity_list_id, ona_entity_list_name;
        """, (organization_id, title.strip(), description, odk_api_key, odk_host_url))

        project_data = cursor.fetchone()
        conn.commit()

        # Build response
        project = {
            'id': str(project_data[0]),
            'organization_id': str(project_data[1]),
            'title': project_data[2],
            'description': project_data[3],
            'created_at': project_data[4].isoformat() if project_data[4] else None,
            'updated_at': project_data[5].isoformat() if project_data[5] else None,
            'odk_api_key': project_data[6],
            'odk_host_url': project_data[7],
            'ona_project_id': project_data[8],
            'ona_project_name': project_data[9],
            'ona_entity_list_id': project_data[10],
            'ona_entity_list_name': project_data[11]
        }

        cursor.close()
        return jsonify(project), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating project: {e}")
        return jsonify({'error': 'Failed to create project', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@projects_bp.route('/api/organizations/<organization_id>/projects', methods=['GET'])
@require_auth
@require_org_membership
def list_projects(user, organization_id):
    """Get all projects for an organization"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, organization_id, title, description, created_at, updated_at,
                   odk_api_key, odk_host_url, ona_project_id, ona_project_name,
                   ona_entity_list_id, ona_entity_list_name
            FROM projects
            WHERE organization_id = %s
            ORDER BY created_at DESC
        """, (organization_id,))

        projects = []
        for row in cursor.fetchall():
            projects.append({
                'id': str(row[0]),
                'organization_id': str(row[1]),
                'title': row[2],
                'description': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'updated_at': row[5].isoformat() if row[5] else None,
                'odk_api_key': row[6],
                'odk_host_url': row[7],
                'ona_project_id': row[8],
                'ona_project_name': row[9],
                'ona_entity_list_id': row[10],
                'ona_entity_list_name': row[11]
            })

        cursor.close()
        return jsonify({'projects': projects}), 200

    except Exception as e:
        print(f"Error listing projects: {e}")
        return jsonify({'error': 'Failed to list projects', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@projects_bp.route('/api/projects/<project_id>', methods=['GET'])
@require_auth
def get_project(user, project_id):
    """Get project details"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, organization_id, title, description, created_at, updated_at,
                   odk_api_key, odk_host_url, ona_project_id, ona_project_name,
                   ona_entity_list_id, ona_entity_list_name
            FROM projects
            WHERE id = %s
        """, (project_id,))

        project_data = cursor.fetchone()

        if not project_data:
            cursor.close()
            return jsonify({'error': 'Project not found'}), 404

        project = {
            'id': str(project_data[0]),
            'organization_id': str(project_data[1]),
            'title': project_data[2],
            'description': project_data[3],
            'created_at': project_data[4].isoformat() if project_data[4] else None,
            'updated_at': project_data[5].isoformat() if project_data[5] else None,
            'odk_api_key': project_data[6],
            'odk_host_url': project_data[7],
            'ona_project_id': project_data[8],
            'ona_project_name': project_data[9],
            'ona_entity_list_id': project_data[10],
            'ona_entity_list_name': project_data[11]
        }

        cursor.close()
        return jsonify(project), 200

    except Exception as e:
        print(f"Error getting project: {e}")
        return jsonify({'error': 'Failed to get project', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@projects_bp.route('/api/projects/<project_id>', methods=['PUT'])
@require_auth
def update_project(user, project_id):
    """Update a project"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        data = request.get_json()

        # Extract allowed fields
        title = data.get('title')
        description = data.get('description')
        odk_api_key = data.get('odk_api_key')
        odk_host_url = data.get('odk_host_url')
        ona_project_id = data.get('ona_project_id')
        ona_project_name = data.get('ona_project_name')
        ona_entity_list_id = data.get('ona_entity_list_id')
        ona_entity_list_name = data.get('ona_entity_list_name')

        print(f"💾 Backend received update for project {project_id}:")
        print(f"   ona_project_id: {ona_project_id}")
        print(f"   ona_project_name: {ona_project_name}")
        print(f"   ona_entity_list_id: {ona_entity_list_id}")
        print(f"   ona_entity_list_name: {ona_entity_list_name}")

        # Build dynamic update query
        update_fields = []
        params = []

        if title is not None:
            update_fields.append('title = %s')
            params.append(title.strip())
        if description is not None:
            update_fields.append('description = %s')
            params.append(description)
        if odk_api_key is not None:
            update_fields.append('odk_api_key = %s')
            params.append(odk_api_key)
        if odk_host_url is not None:
            update_fields.append('odk_host_url = %s')
            params.append(odk_host_url)
        if ona_project_id is not None:
            update_fields.append('ona_project_id = %s')
            params.append(ona_project_id)
        if ona_project_name is not None:
            update_fields.append('ona_project_name = %s')
            params.append(ona_project_name)
        if ona_entity_list_id is not None:
            update_fields.append('ona_entity_list_id = %s')
            params.append(ona_entity_list_id)
        if ona_entity_list_name is not None:
            update_fields.append('ona_entity_list_name = %s')
            params.append(ona_entity_list_name)

        if not update_fields:
            return jsonify({'error': 'No fields to update'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Update project
        params.append(project_id)
        cursor.execute(f"""
            UPDATE projects
            SET {', '.join(update_fields)}, updated_at = NOW()
            WHERE id = %s
            RETURNING id, organization_id, title, description, created_at, updated_at,
                      odk_api_key, odk_host_url, ona_project_id, ona_project_name,
                      ona_entity_list_id, ona_entity_list_name;
        """, params)

        project_data = cursor.fetchone()

        if not project_data:
            cursor.close()
            return jsonify({'error': 'Project not found'}), 404

        conn.commit()

        project = {
            'id': str(project_data[0]),
            'organization_id': str(project_data[1]),
            'title': project_data[2],
            'description': project_data[3],
            'created_at': project_data[4].isoformat() if project_data[4] else None,
            'updated_at': project_data[5].isoformat() if project_data[5] else None,
            'odk_api_key': project_data[6],
            'odk_host_url': project_data[7],
            'ona_project_id': project_data[8],
            'ona_project_name': project_data[9],
            'ona_entity_list_id': project_data[10],
            'ona_entity_list_name': project_data[11]
        }

        print(f"✅ Backend returning project:")
        print(f"   ona_project_id: {project['ona_project_id']}")
        print(f"   ona_project_name: {project['ona_project_name']}")

        cursor.close()
        return jsonify(project), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating project: {e}")
        return jsonify({'error': 'Failed to update project', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@projects_bp.route('/api/projects/<project_id>', methods=['DELETE'])
@require_auth
def delete_project(user, project_id):
    """Delete a project"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied: Not a member of the organization that owns this project'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Delete project
        cursor.execute("""
            DELETE FROM projects
            WHERE id = %s
            RETURNING id
        """, (project_id,))

        deleted = cursor.fetchone()

        if not deleted:
            cursor.close()
            return jsonify({'error': 'Project not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'message': 'Project deleted successfully'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting project: {e}")
        return jsonify({'error': 'Failed to delete project', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
