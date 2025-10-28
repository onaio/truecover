# ABOUTME: API endpoints for managing COG/STAC data sources
# ABOUTME: Provides CRUD operations for configurable raster data sources

from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from db.connection import get_db_connection, return_db_connection

data_sources_bp = Blueprint('data_sources', __name__)


@data_sources_bp.route('/api/data-sources', methods=['POST'])
@require_auth
def create_data_source(user):
    """Create a new data source configuration"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        name = data.get('name')
        if not name or not name.strip():
            return jsonify({'error': 'Data source name is required'}), 400

        source_type = data.get('source_type', 'stac')
        if source_type not in ['stac', 'direct_cog']:
            return jsonify({'error': 'source_type must be "stac" or "direct_cog"'}), 400

        metadata_field_name = data.get('metadata_field_name')
        if not metadata_field_name or not metadata_field_name.strip():
            return jsonify({'error': 'metadata_field_name is required'}), 400

        metadata_field_type = data.get('metadata_field_type', 'float')
        if metadata_field_type not in ['integer', 'float', 'text']:
            return jsonify({'error': 'metadata_field_type must be "integer", "float", or "text"'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO data_sources (
                name,
                description,
                source_type,
                stac_catalog_url,
                stac_collection,
                stac_item,
                stac_asset,
                cog_url,
                default_statistic,
                metadata_field_name,
                metadata_field_description,
                metadata_field_type,
                metadata_field_unit
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, name, description, source_type, stac_catalog_url,
                      stac_collection, stac_item, stac_asset, cog_url,
                      default_statistic, metadata_field_name,
                      metadata_field_description, metadata_field_type,
                      metadata_field_unit, created_at, updated_at
        """, (
            name.strip(),
            data.get('description', ''),
            source_type,
            data.get('stac_catalog_url'),
            data.get('stac_collection'),
            data.get('stac_item'),
            data.get('stac_asset', 'cog'),
            data.get('cog_url'),
            data.get('default_statistic', 'sum'),
            metadata_field_name.strip(),
            data.get('metadata_field_description', ''),
            metadata_field_type,
            data.get('metadata_field_unit', '')
        ))

        row = cursor.fetchone()
        conn.commit()

        data_source = {
            'id': str(row[0]),
            'name': row[1],
            'description': row[2],
            'source_type': row[3],
            'stac_catalog_url': row[4],
            'stac_collection': row[5],
            'stac_item': row[6],
            'stac_asset': row[7],
            'cog_url': row[8],
            'default_statistic': row[9],
            'metadata_field_name': row[10],
            'metadata_field_description': row[11],
            'metadata_field_type': row[12],
            'metadata_field_unit': row[13],
            'created_at': row[14].isoformat() if row[14] else None,
            'updated_at': row[15].isoformat() if row[15] else None
        }

        cursor.close()
        return jsonify(data_source), 201

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error creating data source: {e}")
        if 'unique constraint' in str(e).lower() or 'duplicate key' in str(e).lower():
            return jsonify({'error': 'A data source with this name already exists'}), 400
        return jsonify({'error': 'Failed to create data source', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@data_sources_bp.route('/api/data-sources', methods=['GET'])
@require_auth
def list_data_sources(user):
    """Get all data sources"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, description, source_type, stac_catalog_url,
                   stac_collection, stac_item, stac_asset, cog_url,
                   default_statistic, metadata_field_name,
                   metadata_field_description, metadata_field_type,
                   metadata_field_unit, created_at, updated_at
            FROM data_sources
            ORDER BY name ASC
        """)

        data_sources = []
        for row in cursor.fetchall():
            data_sources.append({
                'id': str(row[0]),
                'name': row[1],
                'description': row[2],
                'source_type': row[3],
                'stac_catalog_url': row[4],
                'stac_collection': row[5],
                'stac_item': row[6],
                'stac_asset': row[7],
                'cog_url': row[8],
                'default_statistic': row[9],
                'metadata_field_name': row[10],
                'metadata_field_description': row[11],
                'metadata_field_type': row[12],
                'metadata_field_unit': row[13],
                'created_at': row[14].isoformat() if row[14] else None,
                'updated_at': row[15].isoformat() if row[15] else None
            })

        cursor.close()
        return jsonify({'data_sources': data_sources}), 200

    except Exception as e:
        print(f"Error listing data sources: {e}")
        if 'data_sources' in str(e) and ('does not exist' in str(e) or 'relation' in str(e)):
            return jsonify({'data_sources': []}), 200
        return jsonify({'error': 'Failed to list data sources', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@data_sources_bp.route('/api/data-sources/<data_source_id>', methods=['GET'])
@require_auth
def get_data_source(user, data_source_id):
    """Get a specific data source"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, description, source_type, stac_catalog_url,
                   stac_collection, stac_item, stac_asset, cog_url,
                   default_statistic, metadata_field_name,
                   metadata_field_description, metadata_field_type,
                   metadata_field_unit, created_at, updated_at
            FROM data_sources
            WHERE id = %s
        """, (data_source_id,))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Data source not found'}), 404

        data_source = {
            'id': str(row[0]),
            'name': row[1],
            'description': row[2],
            'source_type': row[3],
            'stac_catalog_url': row[4],
            'stac_collection': row[5],
            'stac_item': row[6],
            'stac_asset': row[7],
            'cog_url': row[8],
            'default_statistic': row[9],
            'metadata_field_name': row[10],
            'metadata_field_description': row[11],
            'metadata_field_type': row[12],
            'metadata_field_unit': row[13],
            'created_at': row[14].isoformat() if row[14] else None,
            'updated_at': row[15].isoformat() if row[15] else None
        }

        cursor.close()
        return jsonify(data_source), 200

    except Exception as e:
        print(f"Error getting data source: {e}")
        return jsonify({'error': 'Failed to get data source', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@data_sources_bp.route('/api/data-sources/<data_source_id>', methods=['PUT'])
@require_auth
def update_data_source(user, data_source_id):
    """Update a data source"""
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE data_sources
            SET
                name = COALESCE(%s, name),
                description = COALESCE(%s, description),
                source_type = COALESCE(%s, source_type),
                stac_catalog_url = COALESCE(%s, stac_catalog_url),
                stac_collection = COALESCE(%s, stac_collection),
                stac_item = COALESCE(%s, stac_item),
                stac_asset = COALESCE(%s, stac_asset),
                cog_url = COALESCE(%s, cog_url),
                default_statistic = COALESCE(%s, default_statistic),
                metadata_field_name = COALESCE(%s, metadata_field_name),
                metadata_field_description = COALESCE(%s, metadata_field_description),
                metadata_field_type = COALESCE(%s, metadata_field_type),
                metadata_field_unit = COALESCE(%s, metadata_field_unit),
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, name, description, source_type, stac_catalog_url,
                      stac_collection, stac_item, stac_asset, cog_url,
                      default_statistic, metadata_field_name,
                      metadata_field_description, metadata_field_type,
                      metadata_field_unit, created_at, updated_at
        """, (
            data.get('name'),
            data.get('description'),
            data.get('source_type'),
            data.get('stac_catalog_url'),
            data.get('stac_collection'),
            data.get('stac_item'),
            data.get('stac_asset'),
            data.get('cog_url'),
            data.get('default_statistic'),
            data.get('metadata_field_name'),
            data.get('metadata_field_description'),
            data.get('metadata_field_type'),
            data.get('metadata_field_unit'),
            data_source_id
        ))

        row = cursor.fetchone()
        if not row:
            cursor.close()
            return jsonify({'error': 'Data source not found'}), 404

        conn.commit()

        data_source = {
            'id': str(row[0]),
            'name': row[1],
            'description': row[2],
            'source_type': row[3],
            'stac_catalog_url': row[4],
            'stac_collection': row[5],
            'stac_item': row[6],
            'stac_asset': row[7],
            'cog_url': row[8],
            'default_statistic': row[9],
            'metadata_field_name': row[10],
            'metadata_field_description': row[11],
            'metadata_field_type': row[12],
            'metadata_field_unit': row[13],
            'created_at': row[14].isoformat() if row[14] else None,
            'updated_at': row[15].isoformat() if row[15] else None
        }

        cursor.close()
        return jsonify(data_source), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating data source: {e}")
        if 'unique constraint' in str(e).lower() or 'duplicate key' in str(e).lower():
            return jsonify({'error': 'A data source with this name already exists'}), 400
        return jsonify({'error': 'Failed to update data source', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@data_sources_bp.route('/api/data-sources/<data_source_id>', methods=['DELETE'])
@require_auth
def delete_data_source(user, data_source_id):
    """Delete a data source"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            DELETE FROM data_sources
            WHERE id = %s
            RETURNING id
        """, (data_source_id,))

        deleted = cursor.fetchone()
        if not deleted:
            cursor.close()
            return jsonify({'error': 'Data source not found'}), 404

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting data source: {e}")
        return jsonify({'error': 'Failed to delete data source', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
