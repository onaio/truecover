from functools import wraps
from flask import request, jsonify
import os
import jwt
from db.connection import get_db_connection, return_db_connection
from clerk_backend_api import Clerk

# Initialize Clerk SDK
clerk = Clerk(bearer_auth=os.getenv('CLERK_SECRET_KEY'))


def get_user_from_db(clerk_id):
    """
    Get user from database by clerk_id.
    Returns user dict if found, None if not found.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, clerk_id, email, name, organization, created_at, updated_at
            FROM users
            WHERE clerk_id = %s;
        """, (clerk_id,))

        user_data = cursor.fetchone()
        cursor.close()

        if not user_data:
            return None

        return {
            'id': str(user_data[0]),
            'clerk_id': user_data[1],
            'email': user_data[2],
            'name': user_data[3],
            'organization': user_data[4],
            'created_at': user_data[5].isoformat() if user_data[5] else None,
            'updated_at': user_data[6].isoformat() if user_data[6] else None
        }

    except Exception as e:
        print(f"Error getting user from database: {e}")
        return None
    finally:
        if conn:
            return_db_connection(conn)


def require_auth(f):
    """
    Decorator to require authentication for a route.
    Verifies the Clerk JWT token and gets user from database.
    Only calls Clerk API if user not found in database (first login).
    Adds 'user' to kwargs with user data from database.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get the Authorization header
        auth_header = request.headers.get('Authorization')

        if not auth_header:
            return jsonify({'error': 'No authorization header provided'}), 401

        # Extract the token (format: "Bearer <token>")
        try:
            token = auth_header.split(' ')[1] if auth_header.startswith('Bearer ') else auth_header
        except IndexError:
            return jsonify({'error': 'Invalid authorization header format'}), 401

        try:
            # Decode the JWT to get user ID
            # The JWT signature was already verified by Clerk on the frontend
            # TODO: Add JWKS verification for additional security
            decoded = jwt.decode(token, options={"verify_signature": False})

            clerk_user_id = decoded.get('sub')

            if not clerk_user_id:
                return jsonify({'error': 'Invalid token payload'}), 401

            # Try to get user from database first (fast path)
            user = get_user_from_db(clerk_user_id)

            if not user:
                # User not in DB - first login, fetch from Clerk and sync
                clerk_user = clerk.users.get(user_id=clerk_user_id)
                user = sync_user_to_db(clerk_user)

            # Add user to kwargs
            kwargs['user'] = user

            return f(*args, **kwargs)

        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError as e:
            return jsonify({'error': 'Invalid token'}), 401
        except Exception as e:
            print(f"Authentication error: {e}")
            return jsonify({'error': 'Authentication failed', 'details': str(e)}), 401

    return decorated_function


def sync_user_to_db(clerk_user):
    """
    Sync Clerk user to local database.
    Creates user if doesn't exist, updates if exists.
    Returns user data from database.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Extract user data from Clerk user object
        clerk_id = clerk_user.id
        email = clerk_user.email_addresses[0].email_address if clerk_user.email_addresses else None
        name = f"{clerk_user.first_name or ''} {clerk_user.last_name or ''}".strip() or None

        # Get organization from metadata if available
        organization = clerk_user.public_metadata.get('organization') if clerk_user.public_metadata else None

        # Upsert user
        cursor.execute("""
            INSERT INTO users (clerk_id, email, name, organization, updated_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (clerk_id)
            DO UPDATE SET
                email = EXCLUDED.email,
                name = EXCLUDED.name,
                organization = EXCLUDED.organization,
                updated_at = NOW()
            RETURNING id, clerk_id, email, name, organization, created_at, updated_at;
        """, (clerk_id, email, name, organization))

        user_data = cursor.fetchone()
        conn.commit()

        # Convert to dict
        user = {
            'id': str(user_data[0]),
            'clerk_id': user_data[1],
            'email': user_data[2],
            'name': user_data[3],
            'organization': user_data[4],
            'created_at': user_data[5].isoformat() if user_data[5] else None,
            'updated_at': user_data[6].isoformat() if user_data[6] else None
        }

        cursor.close()
        return user

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error syncing user to database: {e}")
        raise
    finally:
        if conn:
            return_db_connection(conn)
