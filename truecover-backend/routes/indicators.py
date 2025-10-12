from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_project_access
from db.connection import get_db_connection, return_db_connection

indicators_bp = Blueprint('indicators', __name__)


@indicators_bp.route('/api/projects/<project_id>/indicators', methods=['POST'])
@require_auth
def create_indicator(user, project_id):
    """Create a new indicator for a project"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        name = data.get('name')
        if not name or not name.strip():
            return jsonify({'error': 'Indicator name is required'}), 400

        description = data.get('description', '')

        conn = get_db_connection()
        cursor = conn.cursor()

        # Create indicator
        cursor.execute("""
            INSERT INTO indicators (project_id, name, description)
            VALUES (%s, %s, %s)
            RETURNING id, project_id, name, description, created_at, updated_at
        """, (project_id, name.strip(), description))

        indicator_data = cursor.fetchone()
        conn.commit()

        indicator = {
            'id': str(indicator_data[0]),
            'project_id': str(indicator_data[1]),
            'name': indicator_data[2],
            'description': indicator_data[3],
            'created_at': indicator_data[4].isoformat() if indicator_data[4] else None,
            'updated_at': indicator_data[5].isoformat() if indicator_data[5] else None
        }

        cursor.close()
        return jsonify(indicator), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating indicator: {e}")
        # Check for unique constraint violation
        if 'unique constraint' in str(e).lower() or 'duplicate key' in str(e).lower():
            return jsonify({'error': 'An indicator with this name already exists for this project'}), 400
        return jsonify({'error': 'Failed to create indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@indicators_bp.route('/api/projects/<project_id>/indicators', methods=['GET'])
@require_auth
def list_indicators(user, project_id):
    """Get all indicators for a project"""
    conn = None
    try:
        # Check if user has access to this project
        if not check_project_access(user['id'], project_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, project_id, name, description, created_at, updated_at
            FROM indicators
            WHERE project_id = %s
            ORDER BY name ASC
        """, (project_id,))

        indicators = []
        for row in cursor.fetchall():
            indicators.append({
                'id': str(row[0]),
                'project_id': str(row[1]),
                'name': row[2],
                'description': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'updated_at': row[5].isoformat() if row[5] else None
            })

        cursor.close()
        return jsonify({'indicators': indicators}), 200

    except Exception as e:
        print(f"Error listing indicators: {e}")
        # If the indicators table doesn't exist yet, return empty array
        if 'indicators' in str(e) and ('does not exist' in str(e) or 'relation' in str(e)):
            return jsonify({'indicators': []}), 200
        return jsonify({'error': 'Failed to list indicators', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@indicators_bp.route('/api/indicators/<indicator_id>', methods=['GET'])
@require_auth
def get_indicator(user, indicator_id):
    """Get details of a specific indicator"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT i.id, i.project_id, i.name, i.description, i.created_at, i.updated_at
            FROM indicators i
            WHERE i.id = %s
        """, (indicator_id,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Indicator not found'}), 404

        # Check if user has access to this indicator's project
        project_id = str(row[1])
        if not check_project_access(user['id'], project_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        indicator = {
            'id': str(row[0]),
            'project_id': project_id,
            'name': row[2],
            'description': row[3],
            'created_at': row[4].isoformat() if row[4] else None,
            'updated_at': row[5].isoformat() if row[5] else None
        }

        cursor.close()
        return jsonify(indicator), 200

    except Exception as e:
        print(f"Error getting indicator: {e}")
        return jsonify({'error': 'Failed to get indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@indicators_bp.route('/api/indicators/<indicator_id>', methods=['PUT'])
@require_auth
def update_indicator(user, indicator_id):
    """Update an indicator"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify indicator exists and get project_id
        cursor.execute("""
            SELECT project_id FROM indicators
            WHERE id = %s
        """, (indicator_id,))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Indicator not found'}), 404

        project_id = str(result[0])

        # Check if user has access to this indicator's project
        if not check_project_access(user['id'], project_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Update indicator
        cursor.execute("""
            UPDATE indicators
            SET
                name = COALESCE(%s, name),
                description = COALESCE(%s, description),
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, project_id, name, description, created_at, updated_at
        """, (
            data.get('name'),
            data.get('description'),
            indicator_id
        ))

        indicator_data = cursor.fetchone()
        if not indicator_data:
            cursor.close()
            return jsonify({'error': 'Indicator not found'}), 404

        conn.commit()

        indicator = {
            'id': str(indicator_data[0]),
            'project_id': str(indicator_data[1]),
            'name': indicator_data[2],
            'description': indicator_data[3],
            'created_at': indicator_data[4].isoformat() if indicator_data[4] else None,
            'updated_at': indicator_data[5].isoformat() if indicator_data[5] else None
        }

        cursor.close()
        return jsonify(indicator), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating indicator: {e}")
        # Check for unique constraint violation
        if 'unique constraint' in str(e).lower() or 'duplicate key' in str(e).lower():
            return jsonify({'error': 'An indicator with this name already exists for this project'}), 400
        return jsonify({'error': 'Failed to update indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@indicators_bp.route('/api/indicators/<indicator_id>', methods=['DELETE'])
@require_auth
def delete_indicator(user, indicator_id):
    """Delete an indicator"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify indicator exists and get project_id
        cursor.execute("""
            SELECT project_id FROM indicators
            WHERE id = %s
        """, (indicator_id,))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Indicator not found'}), 404

        project_id = str(result[0])

        # Check if user has access to this indicator's project
        if not check_project_access(user['id'], project_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Delete indicator
        cursor.execute("""
            DELETE FROM indicators
            WHERE id = %s
            RETURNING id
        """, (indicator_id,))

        deleted = cursor.fetchone()
        if not deleted:
            cursor.close()
            return jsonify({'error': 'Indicator not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting indicator: {e}")
        return jsonify({'error': 'Failed to delete indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
