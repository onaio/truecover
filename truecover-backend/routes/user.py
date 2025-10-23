from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from db.connection import get_db_connection, return_db_connection

user_bp = Blueprint('user', __name__)

@user_bp.route('/api/user/me', methods=['GET'])
@require_auth
def get_current_user(user):
    """Get current authenticated user's information"""
    return jsonify(user), 200

@user_bp.route('/api/user/me', methods=['PUT'])
@require_auth
def update_current_user(user):
    """Update current authenticated user's profile"""
    conn = None
    try:
        data = request.get_json()

        # Extract allowed fields
        name = data.get('name')
        organization = data.get('organization')

        conn = get_db_connection()
        cursor = conn.cursor()

        # Update user
        cursor.execute("""
            UPDATE users
            SET name = COALESCE(%s, name),
                organization = COALESCE(%s, organization),
                updated_at = NOW()
            WHERE clerk_id = %s
            RETURNING id, clerk_id, email, name, organization, created_at, updated_at;
        """, (name, organization, user['clerk_id']))

        updated_user = cursor.fetchone()
        conn.commit()

        # Convert to dict
        user_data = {
            'id': str(updated_user[0]),
            'clerk_id': updated_user[1],
            'email': updated_user[2],
            'name': updated_user[3],
            'organization': updated_user[4],
            'created_at': updated_user[5].isoformat() if updated_user[5] else None,
            'updated_at': updated_user[6].isoformat() if updated_user[6] else None
        }

        cursor.close()
        return jsonify(user_data), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating user: {e}")
        return jsonify({'error': 'Failed to update user', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
