from functools import wraps
from flask import jsonify
from db.connection import get_db_connection, return_db_connection

def check_organization_membership(user_id, organization_id):
    """
    Check if a user is a member of an organization.
    Returns True if user is a member, False otherwise.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id FROM organization_members
            WHERE user_id = %s AND organization_id = %s
        """, (user_id, organization_id))

        result = cursor.fetchone()
        cursor.close()

        return result is not None

    except Exception as e:
        print(f"Error checking organization membership: {e}")
        return False
    finally:
        if conn:
            return_db_connection(conn)


def require_org_membership(f):
    """
    Decorator to require organization membership for a route.
    Expects organization_id to be passed as a route parameter.
    Adds 'organization_id' to kwargs.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get user from kwargs (set by require_auth decorator)
        user = kwargs.get('user')
        if not user:
            return jsonify({'error': 'Authentication required'}), 401

        # Get organization_id from route parameters
        organization_id = kwargs.get('organization_id')
        if not organization_id:
            return jsonify({'error': 'Organization ID required'}), 400

        # Check if user is a member of the organization
        if not check_organization_membership(user['id'], organization_id):
            return jsonify({'error': 'Access denied: Not a member of this organization'}), 403

        return f(*args, **kwargs)

    return decorated_function


def get_user_organizations(user_id):
    """
    Get all organizations that a user is a member of.
    Returns list of organization dicts.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT o.id, o.name, o.created_at, o.updated_at, om.role, om.joined_at
            FROM organizations o
            JOIN organization_members om ON o.id = om.organization_id
            WHERE om.user_id = %s
            ORDER BY o.created_at DESC
        """, (user_id,))

        organizations = []
        for row in cursor.fetchall():
            organizations.append({
                'id': str(row[0]),
                'name': row[1],
                'created_at': row[2].isoformat() if row[2] else None,
                'updated_at': row[3].isoformat() if row[3] else None,
                'role': row[4],
                'joined_at': row[5].isoformat() if row[5] else None
            })

        cursor.close()
        return organizations

    except Exception as e:
        print(f"Error getting user organizations: {e}")
        return []
    finally:
        if conn:
            return_db_connection(conn)


def check_project_access(user_id, project_id):
    """
    Check if a user has access to a project (via organization membership).
    Returns True if user has access, False otherwise.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT p.id FROM projects p
            JOIN organization_members om ON p.organization_id = om.organization_id
            WHERE p.id = %s AND om.user_id = %s
        """, (project_id, user_id))

        result = cursor.fetchone()
        cursor.close()

        return result is not None

    except Exception as e:
        print(f"Error checking project access: {e}")
        return False
    finally:
        if conn:
            return_db_connection(conn)


def check_area_access(user_id, area_id):
    """
    Check if a user has access to an area (via project -> organization membership).
    Returns True if user has access, False otherwise.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT a.id FROM areas a
            JOIN projects p ON a.project_id = p.id
            JOIN organization_members om ON p.organization_id = om.organization_id
            WHERE a.id = %s AND om.user_id = %s
        """, (area_id, user_id))

        result = cursor.fetchone()
        cursor.close()

        return result is not None

    except Exception as e:
        print(f"Error checking area access: {e}")
        return False
    finally:
        if conn:
            return_db_connection(conn)
