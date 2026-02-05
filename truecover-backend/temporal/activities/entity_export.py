# ABOUTME: Temporal activities for exporting coverage data to ODK entity lists
# ABOUTME: Handles fetching pixel and location data and creating entities via Ona API

from temporalio import activity
from typing import List, Dict, Any
from db.connection import get_db_connection, return_db_connection
import requests
import mercantile


def get_pixel_boundary_coords(quadkey: str) -> str:
    """
    Get the boundary coordinates of a pixel from its quadkey.

    Returns a string in ODK geoshape format:
    "lat1 lon1 0 0;lat2 lon2 0 0;lat3 lon3 0 0;lat4 lon4 0 0;lat1 lon1 0 0"

    The corners are ordered counter-clockwise starting from southwest:
    SW -> SE -> NE -> NW -> SW (closed polygon)
    """
    try:
        # Convert quadkey to tile
        tile = mercantile.quadkey_to_tile(quadkey)

        # Get bounding box (west, south, east, north)
        bounds = mercantile.bounds(tile)

        # Create corners in counter-clockwise order starting from SW
        # Format: lat lon 0 0 for each corner, separated by semicolons
        sw = f"{bounds.south} {bounds.west} 0 0"
        se = f"{bounds.south} {bounds.east} 0 0"
        ne = f"{bounds.north} {bounds.east} 0 0"
        nw = f"{bounds.north} {bounds.west} 0 0"

        # Close the polygon by repeating first point
        return f"{sw};{se};{ne};{nw};{sw}"
    except Exception as e:
        print(f"Error calculating boundary for quadkey {quadkey}: {e}")
        # Fallback to empty geoshape
        return ""


@activity.defn
async def fetch_pixel_coverage_activity(
    campaign_id: str,
    indicator_id: str,
    round_ids: List[str]
) -> List[Dict[str, Any]]:
    """
    Fetch pixel coverage data filtered by selected rounds.

    Args:
        campaign_id: Area ID
        indicator_id: Indicator ID
        round_ids: List of round IDs to filter by

    Returns:
        List of pixel coverage records with pixel details
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get round numbers from round IDs
        placeholders = ','.join(['%s'] * len(round_ids))
        cursor.execute(f"""
            SELECT round_number
            FROM rounds
            WHERE id IN ({placeholders})
        """, tuple(round_ids))

        round_numbers = [row[0] for row in cursor.fetchall()]

        if not round_numbers:
            return []

        # Fetch pixel coverage data with pixel details
        # Join with pixels table to get adm4_pcode and other fields
        cursor.execute("""
            SELECT DISTINCT
                pc.id,
                pc.quadkey,
                p.latitude,
                p.longitude,
                p.adm4_pcode,
                pc.rounds
            FROM coverage_pixel pc
            JOIN pixels p ON p.quadkey = pc.quadkey
            WHERE pc.campaign_id = %s
                AND pc.indicator_id = %s
                AND pc.rounds && %s::integer[]
            ORDER BY pc.quadkey
        """, (campaign_id, indicator_id, round_numbers))

        pixels = []
        for row in cursor.fetchall():
            pixel_id, quadkey, latitude, longitude, adm4_pcode, rounds = row
            pixels.append({
                'id': str(pixel_id),
                'quadkey': quadkey,
                'latitude': float(latitude) if latitude else None,
                'longitude': float(longitude) if longitude else None,
                'adm4_pcode': adm4_pcode or '',
                'rounds': rounds or []
            })

        return pixels

    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def fetch_location_coverage_activity(
    campaign_id: str,
    indicator_id: str,
    round_ids: List[str]
) -> List[Dict[str, Any]]:
    """
    Fetch location coverage data filtered by selected rounds.

    Returns list of location coverage records with location details.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get round numbers from round IDs
        placeholders = ','.join(['%s'] * len(round_ids))
        cursor.execute(f"""
            SELECT round_number
            FROM rounds
            WHERE id IN ({placeholders})
        """, tuple(round_ids))

        round_numbers = [row[0] for row in cursor.fetchall()]

        if not round_numbers:
            return []

        cursor.execute("""
            SELECT DISTINCT
                c.id,
                l.external_id,
                l.latitude,
                l.longitude,
                l.quadkey,
                c.rounds
            FROM coverage c
            JOIN locations l ON l.id = c.location_id
            WHERE c.campaign_id = %s
                AND c.indicator_id = %s
                AND c.rounds && %s::integer[]
            ORDER BY l.external_id
        """, (campaign_id, indicator_id, round_numbers))

        locations = []
        for row in cursor.fetchall():
            cov_id, external_id, latitude, longitude, quadkey, rounds = row
            locations.append({
                'id': str(cov_id),
                'external_id': external_id or '',
                'latitude': float(latitude) if latitude else None,
                'longitude': float(longitude) if longitude else None,
                'quadkey': quadkey or '',
                'rounds': rounds or []
            })

        return locations

    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def create_odk_entity_activity(
    project_id: str,
    entity_data: Dict[str, Any],
    geometry_type: str = 'centroid',
    entity_type: str = 'pixel'
) -> Dict[str, Any]:
    """
    Create a single ODK entity via Ona API.

    Args:
        project_id: Project ID to get ODK credentials
        entity_data: Entity data dict (pixel or location fields)
        geometry_type: 'centroid' or 'boundary' - how to represent pixel geometry
        entity_type: 'pixel' or 'location'

    Returns:
        Dict with success status and created entity info

    Raises:
        Exception if entity creation fails
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get ODK credentials from project
        cursor.execute("""
            SELECT odk_api_key, odk_host_url, ona_entity_list_id
            FROM projects
            WHERE id = %s
        """, (project_id,))

        project_data = cursor.fetchone()
        if not project_data:
            raise Exception(f'Project {project_id} not found')

        api_key, host_url, entity_list_id = project_data

        if not api_key or not host_url or not entity_list_id:
            raise Exception('ODK credentials or entity list not configured for this project')

        # Remove trailing slash from host_url
        host_url = host_url.rstrip('/')

        if entity_type == 'location':
            # Locations always use point geometry
            label = entity_data['external_id']
            geometry = f"{entity_data['latitude']} {entity_data['longitude']} 0 0"
            details = entity_data['quadkey']
        else:
            # Pixels use configurable geometry
            label = entity_data['quadkey']
            if geometry_type == 'boundary':
                geometry = get_pixel_boundary_coords(entity_data['quadkey'])
            else:
                geometry = f"{entity_data['latitude']} {entity_data['longitude']} 0 0"
            details = entity_data['adm4_pcode']

        # Build entity payload
        entity_payload = {
            'label': label,
            'data': {
                'geometry': geometry,
                'status': 'not_visited',
                'details': details
            }
        }

        # Make POST request to Ona API
        headers = {
            'Authorization': f'Token {api_key}',
            'Content-Type': 'application/json'
        }

        response = requests.post(
            f'{host_url}/api/v2/entity-lists/{entity_list_id}/entities',
            headers=headers,
            json=entity_payload,
            timeout=30
        )

        # Raise exception on error (stops workflow immediately)
        if response.status_code not in [200, 201]:
            error_msg = f'Ona API returned status {response.status_code}'
            try:
                error_detail = response.json()
                error_msg += f': {error_detail}'
            except:
                error_msg += f': {response.text}'
            raise Exception(error_msg)

        entity_result = response.json()

        return {
            'success': True,
            'label': label,
            'entity_uuid': entity_result.get('uuid')
        }

    except requests.exceptions.Timeout:
        raise Exception('Request to Ona API timed out')
    except requests.exceptions.ConnectionError:
        raise Exception('Could not connect to Ona API')
    finally:
        cursor.close()
        return_db_connection(conn)
