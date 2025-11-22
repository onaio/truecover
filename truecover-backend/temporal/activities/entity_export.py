# ABOUTME: Temporal activities for exporting pixel coverage data to ODK entity lists
# ABOUTME: Handles fetching pixel data and creating entities via Ona API

from temporalio import activity
from typing import List, Dict, Any
from db.connection import get_db_connection, return_db_connection
import requests
import mercantile


def get_pixel_boundary_coords(quadkey: str) -> str:
    """
    Get the boundary coordinates of a pixel from its quadkey.

    Returns a string in ODK geoshape format:
    "lat1 lon1 0 0, lat2 lon2 0 0, lat3 lon3 0 0, lat4 lon4 0 0, lat1 lon1 0 0"

    The corners are ordered counter-clockwise starting from southwest:
    SW -> SE -> NE -> NW -> SW (closed polygon)
    """
    try:
        # Convert quadkey to tile
        tile = mercantile.quadkey_to_tile(quadkey)

        # Get bounding box (west, south, east, north)
        bounds = mercantile.bounds(tile)

        # Create corners in counter-clockwise order starting from SW
        # Format: lat lon 0 0 for each corner
        sw = f"{bounds.south} {bounds.west} 0 0"
        se = f"{bounds.south} {bounds.east} 0 0"
        ne = f"{bounds.north} {bounds.east} 0 0"
        nw = f"{bounds.north} {bounds.west} 0 0"

        # Close the polygon by repeating first point
        return f"{sw}, {se}, {ne}, {nw}, {sw}"
    except Exception as e:
        print(f"Error calculating boundary for quadkey {quadkey}: {e}")
        # Fallback to empty geoshape
        return ""


@activity.defn
async def fetch_pixel_coverage_activity(
    area_id: str,
    indicator_id: str,
    round_ids: List[str]
) -> List[Dict[str, Any]]:
    """
    Fetch pixel coverage data filtered by selected rounds.

    Args:
        area_id: Area ID
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
            JOIN pixels p ON p.quadkey = pc.quadkey AND p.area_id = pc.area_id
            WHERE pc.area_id = %s
                AND pc.indicator_id = %s
                AND pc.rounds && %s::integer[]
            ORDER BY pc.quadkey
        """, (area_id, indicator_id, round_numbers))

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
async def create_odk_entity_activity(
    project_id: str,
    pixel_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a single ODK entity via Ona API.

    Args:
        project_id: Project ID to get ODK credentials
        pixel_data: Pixel data dict with id, quadkey, lat, lng, adm4_pcode

    Returns:
        Dict with success status and created entity info

    Raises:
        Exception if entity creation fails
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get ODK credentials and geometry type from project
        cursor.execute("""
            SELECT odk_api_key, odk_host_url, ona_entity_list_id, odk_pixel_geometry_type
            FROM projects
            WHERE id = %s
        """, (project_id,))

        project_data = cursor.fetchone()
        if not project_data:
            raise Exception(f'Project {project_id} not found')

        api_key, host_url, entity_list_id, geometry_type = project_data

        if not api_key or not host_url or not entity_list_id:
            raise Exception('ODK credentials or entity list not configured for this project')

        # Remove trailing slash from host_url
        host_url = host_url.rstrip('/')

        # Format geometry based on project setting
        if geometry_type == 'boundary':
            # Use pixel boundary (geoshape polygon)
            geometry = get_pixel_boundary_coords(pixel_data['quadkey'])
        else:
            # Use pixel centroid (geopoint)
            geometry = f"{pixel_data['latitude']} {pixel_data['longitude']} 0 0"

        # Build entity payload
        entity_payload = {
            'label': pixel_data['quadkey'],
            'data': {
                'geometry': geometry,
                'status': 'not_visited',
                'details': pixel_data['adm4_pcode']
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
            'quadkey': pixel_data['quadkey'],
            'entity_uuid': entity_result.get('uuid')
        }

    except requests.exceptions.Timeout:
        raise Exception('Request to Ona API timed out')
    except requests.exceptions.ConnectionError:
        raise Exception('Could not connect to Ona API')
    finally:
        cursor.close()
        return_db_connection(conn)
