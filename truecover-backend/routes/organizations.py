from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import require_org_membership, get_user_organizations
from db.connection import get_db_connection, return_db_connection

organizations_bp = Blueprint('organizations', __name__)

@organizations_bp.route('/api/organizations', methods=['POST'])
@require_auth
def create_organization(user):
    """Create a new organization and automatically add the creator as a member"""
    conn = None
    try:
        data = request.get_json()

        # Validate required fields
        name = data.get('name')
        if not name or not name.strip():
            return jsonify({'error': 'Organization name is required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Create organization
        cursor.execute("""
            INSERT INTO organizations (name)
            VALUES (%s)
            RETURNING id, name, created_at, updated_at;
        """, (name.strip(),))

        org_data = cursor.fetchone()
        organization_id = org_data[0]

        # Automatically add creator as an admin
        cursor.execute("""
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES (%s, %s, 'admin')
        """, (organization_id, user['id']))

        conn.commit()

        # Build response
        organization = {
            'id': str(org_data[0]),
            'name': org_data[1],
            'created_at': org_data[2].isoformat() if org_data[2] else None,
            'updated_at': org_data[3].isoformat() if org_data[3] else None
        }

        cursor.close()
        return jsonify(organization), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating organization: {e}")
        return jsonify({'error': 'Failed to create organization', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@organizations_bp.route('/api/organizations', methods=['GET'])
@require_auth
def list_organizations(user):
    """Get all organizations that the current user is a member of"""
    try:
        organizations = get_user_organizations(user['id'])
        return jsonify({'organizations': organizations}), 200

    except Exception as e:
        print(f"Error listing organizations: {e}")
        return jsonify({'error': 'Failed to list organizations', 'details': str(e)}), 500


@organizations_bp.route('/api/organizations/<organization_id>', methods=['GET'])
@require_auth
@require_org_membership
def get_organization(user, organization_id):
    """Get organization details"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, created_at, updated_at
            FROM organizations
            WHERE id = %s
        """, (organization_id,))

        org_data = cursor.fetchone()

        if not org_data:
            cursor.close()
            return jsonify({'error': 'Organization not found'}), 404

        organization = {
            'id': str(org_data[0]),
            'name': org_data[1],
            'created_at': org_data[2].isoformat() if org_data[2] else None,
            'updated_at': org_data[3].isoformat() if org_data[3] else None
        }

        cursor.close()
        return jsonify(organization), 200

    except Exception as e:
        print(f"Error getting organization: {e}")
        return jsonify({'error': 'Failed to get organization', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@organizations_bp.route('/api/organizations/<organization_id>/members', methods=['GET'])
@require_auth
@require_org_membership
def get_organization_members(user, organization_id):
    """Get all members of an organization"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT u.id, u.clerk_id, u.email, u.name, om.role, om.joined_at
            FROM users u
            JOIN organization_members om ON u.id = om.user_id
            WHERE om.organization_id = %s
            ORDER BY om.joined_at ASC
        """, (organization_id,))

        members = []
        for row in cursor.fetchall():
            members.append({
                'id': str(row[0]),
                'clerk_id': row[1],
                'email': row[2],
                'name': row[3],
                'role': row[4],
                'joined_at': row[5].isoformat() if row[5] else None
            })

        cursor.close()
        return jsonify({'members': members}), 200

    except Exception as e:
        print(f"Error getting organization members: {e}")
        return jsonify({'error': 'Failed to get organization members', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@organizations_bp.route('/api/organizations/<organization_id>/members', methods=['POST'])
@require_auth
@require_org_membership
def add_organization_member(user, organization_id):
    """Add a member to an organization by email"""
    conn = None
    try:
        data = request.get_json()

        # Validate required fields
        email = data.get('email')
        if not email or not email.strip():
            return jsonify({'error': 'Member email is required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Find user by email
        cursor.execute("""
            SELECT id, email, name FROM users WHERE email = %s
        """, (email.strip(),))

        user_data = cursor.fetchone()

        if not user_data:
            cursor.close()
            return jsonify({'error': 'User not found with that email'}), 404

        user_id = user_data[0]

        # Check if user is already a member
        cursor.execute("""
            SELECT id FROM organization_members
            WHERE organization_id = %s AND user_id = %s
        """, (organization_id, user_id))

        if cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'User is already a member of this organization'}), 400

        # Add user as member
        cursor.execute("""
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES (%s, %s, 'member')
            RETURNING joined_at
        """, (organization_id, user_id))

        joined_at = cursor.fetchone()[0]
        conn.commit()

        member = {
            'id': str(user_data[0]),
            'email': user_data[1],
            'name': user_data[2],
            'role': 'member',
            'joined_at': joined_at.isoformat() if joined_at else None
        }

        cursor.close()
        return jsonify(member), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error adding organization member: {e}")
        return jsonify({'error': 'Failed to add organization member', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@organizations_bp.route('/api/organizations/<organization_id>/members/<member_user_id>', methods=['DELETE'])
@require_auth
@require_org_membership
def remove_organization_member(user, organization_id, member_user_id):
    """Remove a member from an organization"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Check if member exists in organization
        cursor.execute("""
            SELECT id FROM organization_members
            WHERE organization_id = %s AND user_id = %s
        """, (organization_id, member_user_id))

        if not cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'Member not found in this organization'}), 404

        # Remove member
        cursor.execute("""
            DELETE FROM organization_members
            WHERE organization_id = %s AND user_id = %s
        """, (organization_id, member_user_id))

        conn.commit()
        cursor.close()

        return jsonify({'message': 'Member removed successfully'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error removing organization member: {e}")
        return jsonify({'error': 'Failed to remove organization member', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@organizations_bp.route('/api/organizations/<organization_id>', methods=['PUT'])
@require_auth
@require_org_membership
def update_organization(user, organization_id):
    """Update organization details"""
    conn = None
    try:
        data = request.get_json()

        # Validate required fields
        name = data.get('name')
        if not name or not name.strip():
            return jsonify({'error': 'Organization name is required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Update organization
        cursor.execute("""
            UPDATE organizations
            SET name = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, name, created_at, updated_at;
        """, (name.strip(), organization_id))

        org_data = cursor.fetchone()

        if not org_data:
            cursor.close()
            return jsonify({'error': 'Organization not found'}), 404

        conn.commit()

        organization = {
            'id': str(org_data[0]),
            'name': org_data[1],
            'created_at': org_data[2].isoformat() if org_data[2] else None,
            'updated_at': org_data[3].isoformat() if org_data[3] else None
        }

        cursor.close()
        return jsonify(organization), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating organization: {e}")
        return jsonify({'error': 'Failed to update organization', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@organizations_bp.route('/api/organizations/<organization_id>', methods=['DELETE'])
@require_auth
@require_org_membership
def delete_organization(user, organization_id):
    """Delete an organization (cascades to members and projects) - Admin only"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Check if user is an admin of this organization
        cursor.execute("""
            SELECT role FROM organization_members
            WHERE organization_id = %s AND user_id = %s
        """, (organization_id, user['id']))

        member_data = cursor.fetchone()
        if not member_data or member_data[0] != 'admin':
            cursor.close()
            return jsonify({'error': 'Only organization admins can delete the organization'}), 403

        # Delete organization (cascade will handle members and projects)
        cursor.execute("""
            DELETE FROM organizations
            WHERE id = %s
            RETURNING id
        """, (organization_id,))

        deleted = cursor.fetchone()

        if not deleted:
            cursor.close()
            return jsonify({'error': 'Organization not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'message': 'Organization deleted successfully'}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting organization: {e}")
        return jsonify({'error': 'Failed to delete organization', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
