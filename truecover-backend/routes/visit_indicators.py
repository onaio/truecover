from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_campaign_access
from db.connection import get_db_connection, return_db_connection

visit_indicators_bp = Blueprint('visit_indicators', __name__)


@visit_indicators_bp.route('/api/visit-indicators', methods=['POST'])
@require_auth
def create_visit_indicator(user):
    """Create a single visit indicator measurement"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        visit_id = data.get('visit_id')
        location_id = data.get('location_id')
        indicator_id = data.get('indicator_id')
        n_trials = data.get('n_trials')
        n_covered = data.get('n_covered')

        if not all([visit_id, location_id, indicator_id, n_trials is not None, n_covered is not None]):
            return jsonify({'error': 'visit_id, location_id, indicator_id, n_trials, and n_covered are required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify visit exists and user has access
        cursor.execute("""
            SELECT campaign_id FROM visits
            WHERE id = %s
        """, (visit_id,))

        visit_result = cursor.fetchone()
        if not visit_result:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        campaign_id = str(visit_result[0])
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Create visit indicator
        cursor.execute("""
            INSERT INTO visit_indicators (visit_id, location_id, indicator_id, n_trials, n_covered)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, visit_id, location_id, indicator_id, n_trials, n_covered, created_at, updated_at
        """, (visit_id, location_id, indicator_id, n_trials, n_covered))

        indicator_data = cursor.fetchone()
        conn.commit()

        visit_indicator = {
            'id': str(indicator_data[0]),
            'visit_id': str(indicator_data[1]),
            'location_id': str(indicator_data[2]),
            'indicator_id': str(indicator_data[3]),
            'n_trials': indicator_data[4],
            'n_covered': indicator_data[5],
            'created_at': indicator_data[6].isoformat() if indicator_data[6] else None,
            'updated_at': indicator_data[7].isoformat() if indicator_data[7] else None
        }

        cursor.close()
        return jsonify(visit_indicator), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating visit indicator: {e}")
        return jsonify({'error': 'Failed to create visit indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visit_indicators_bp.route('/api/visit-indicators/bulk', methods=['POST'])
@require_auth
def create_visit_indicators_bulk(user):
    """Create multiple visit indicator measurements at once"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        indicators = data.get('indicators', [])
        if not indicators:
            return jsonify({'error': 'indicators array is required'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify first indicator's visit exists and user has access
        first_visit_id = indicators[0].get('visit_id')
        cursor.execute("""
            SELECT campaign_id FROM visits
            WHERE id = %s
        """, (first_visit_id,))

        visit_result = cursor.fetchone()
        if not visit_result:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        campaign_id = str(visit_result[0])
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Create all visit indicators
        created_indicators = []
        for indicator in indicators:
            visit_id = indicator.get('visit_id')
            location_id = indicator.get('location_id')
            indicator_id = indicator.get('indicator_id')
            n_trials = indicator.get('n_trials')
            n_covered = indicator.get('n_covered')

            if not all([visit_id, location_id, indicator_id, n_trials is not None, n_covered is not None]):
                conn.rollback()
                cursor.close()
                return jsonify({'error': 'Each indicator must have visit_id, location_id, indicator_id, n_trials, and n_covered'}), 400

            cursor.execute("""
                INSERT INTO visit_indicators (visit_id, location_id, indicator_id, n_trials, n_covered)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, visit_id, location_id, indicator_id, n_trials, n_covered, created_at, updated_at
            """, (visit_id, location_id, indicator_id, n_trials, n_covered))

            indicator_data = cursor.fetchone()
            created_indicators.append({
                'id': str(indicator_data[0]),
                'visit_id': str(indicator_data[1]),
                'location_id': str(indicator_data[2]),
                'indicator_id': str(indicator_data[3]),
                'n_trials': indicator_data[4],
                'n_covered': indicator_data[5],
                'created_at': indicator_data[6].isoformat() if indicator_data[6] else None,
                'updated_at': indicator_data[7].isoformat() if indicator_data[7] else None
            })

        conn.commit()
        cursor.close()
        return jsonify({'indicators': created_indicators}), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating visit indicators in bulk: {e}")
        return jsonify({'error': 'Failed to create visit indicators', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visit_indicators_bp.route('/api/visits/<visit_id>/indicators', methods=['GET'])
@require_auth
def list_visit_indicators(user, visit_id):
    """Get all indicators for a visit"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify visit exists and user has access
        cursor.execute("""
            SELECT campaign_id FROM visits
            WHERE id = %s
        """, (visit_id,))

        visit_result = cursor.fetchone()
        if not visit_result:
            cursor.close()
            return jsonify({'error': 'Visit not found'}), 404

        campaign_id = str(visit_result[0])
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        cursor.execute("""
            SELECT id, visit_id, location_id, indicator_id, n_trials, n_covered, created_at, updated_at
            FROM visit_indicators
            WHERE visit_id = %s
            ORDER BY created_at ASC
        """, (visit_id,))

        indicators = []
        for row in cursor.fetchall():
            indicators.append({
                'id': str(row[0]),
                'visit_id': str(row[1]),
                'location_id': str(row[2]),
                'indicator_id': str(row[3]),
                'n_trials': row[4],
                'n_covered': row[5],
                'created_at': row[6].isoformat() if row[6] else None,
                'updated_at': row[7].isoformat() if row[7] else None
            })

        cursor.close()
        return jsonify({'indicators': indicators}), 200

    except Exception as e:
        print(f"Error listing visit indicators: {e}")
        return jsonify({'error': 'Failed to list visit indicators', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visit_indicators_bp.route('/api/visit-indicators/<indicator_id>', methods=['GET'])
@require_auth
def get_visit_indicator(user, indicator_id):
    """Get details of a specific visit indicator"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT vi.id, vi.visit_id, vi.location_id, vi.indicator_id, vi.n_trials, vi.n_covered,
                   vi.created_at, vi.updated_at, v.campaign_id
            FROM visit_indicators vi
            JOIN visits v ON v.id = vi.visit_id
            WHERE vi.id = %s
        """, (indicator_id,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Visit indicator not found'}), 404

        # Check if user has access
        campaign_id = str(row[8])
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        visit_indicator = {
            'id': str(row[0]),
            'visit_id': str(row[1]),
            'location_id': str(row[2]),
            'indicator_id': str(row[3]),
            'n_trials': row[4],
            'n_covered': row[5],
            'created_at': row[6].isoformat() if row[6] else None,
            'updated_at': row[7].isoformat() if row[7] else None
        }

        cursor.close()
        return jsonify(visit_indicator), 200

    except Exception as e:
        print(f"Error getting visit indicator: {e}")
        return jsonify({'error': 'Failed to get visit indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visit_indicators_bp.route('/api/visit-indicators/<indicator_id>', methods=['PUT'])
@require_auth
def update_visit_indicator(user, indicator_id):
    """Update a visit indicator measurement"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify indicator exists and get campaign_id
        cursor.execute("""
            SELECT v.campaign_id
            FROM visit_indicators vi
            JOIN visits v ON v.id = vi.visit_id
            WHERE vi.id = %s
        """, (indicator_id,))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Visit indicator not found'}), 404

        campaign_id = str(result[0])

        # Check if user has access
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Update visit indicator
        cursor.execute("""
            UPDATE visit_indicators
            SET
                n_trials = COALESCE(%s, n_trials),
                n_covered = COALESCE(%s, n_covered),
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, visit_id, location_id, indicator_id, n_trials, n_covered, created_at, updated_at
        """, (
            data.get('n_trials'),
            data.get('n_covered'),
            indicator_id
        ))

        indicator_data = cursor.fetchone()
        if not indicator_data:
            cursor.close()
            return jsonify({'error': 'Visit indicator not found'}), 404

        conn.commit()

        visit_indicator = {
            'id': str(indicator_data[0]),
            'visit_id': str(indicator_data[1]),
            'location_id': str(indicator_data[2]),
            'indicator_id': str(indicator_data[3]),
            'n_trials': indicator_data[4],
            'n_covered': indicator_data[5],
            'created_at': indicator_data[6].isoformat() if indicator_data[6] else None,
            'updated_at': indicator_data[7].isoformat() if indicator_data[7] else None
        }

        cursor.close()
        return jsonify(visit_indicator), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating visit indicator: {e}")
        return jsonify({'error': 'Failed to update visit indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@visit_indicators_bp.route('/api/visit-indicators/<indicator_id>', methods=['DELETE'])
@require_auth
def delete_visit_indicator(user, indicator_id):
    """Delete a visit indicator measurement"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify indicator exists and get campaign_id
        cursor.execute("""
            SELECT v.campaign_id
            FROM visit_indicators vi
            JOIN visits v ON v.id = vi.visit_id
            WHERE vi.id = %s
        """, (indicator_id,))

        result = cursor.fetchone()
        if not result:
            cursor.close()
            return jsonify({'error': 'Visit indicator not found'}), 404

        campaign_id = str(result[0])

        # Check if user has access
        if not check_campaign_access(user['id'], campaign_id):
            cursor.close()
            return jsonify({'error': 'Access denied'}), 403

        # Delete visit indicator
        cursor.execute("""
            DELETE FROM visit_indicators
            WHERE id = %s
            RETURNING id
        """, (indicator_id,))

        deleted = cursor.fetchone()
        if not deleted:
            cursor.close()
            return jsonify({'error': 'Visit indicator not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting visit indicator: {e}")
        return jsonify({'error': 'Failed to delete visit indicator', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
