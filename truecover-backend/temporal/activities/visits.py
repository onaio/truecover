# ABOUTME: Temporal activities for processing visit data and updating coverage
# ABOUTME: Handles matching locations, creating/updating coverage records, and aggregating pixels

from temporalio import activity
from typing import List, Dict, Any
from db.connection import get_db_connection, return_db_connection


@activity.defn
async def process_visit_batch(
    area_id: str,
    indicator_id: str,
    round_id: str,
    visits: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Process a batch of visits: match/create locations and update coverage.

    Args:
        area_id: Area ID
        indicator_id: Indicator ID
        round_id: Round ID
        visits: List of visit data with location_id, lat/lng, n_trials, n_covered

    Returns:
        Dict with counts: matched_by_id, matched_by_proximity, new_locations, errors
    """
    from routes.locations import calculate_quadkey

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        matched_by_id = 0
        matched_by_proximity = 0
        new_locations = 0
        affected_quadkeys = set()
        errors = []

        # Get round number
        cursor.execute("SELECT round_number FROM rounds WHERE id = %s", (round_id,))
        round_result = cursor.fetchone()
        round_number = round_result[0] if round_result else None

        for visit_data in visits:
            try:
                uploaded_location_id = visit_data.get('location_id')
                latitude = visit_data.get('latitude')
                longitude = visit_data.get('longitude')
                n_trials = visit_data.get('n_trials')
                n_covered = visit_data.get('n_covered')

                if not latitude or not longitude:
                    errors.append(f"Missing coordinates for location {uploaded_location_id or 'unknown'}")
                    continue

                if n_trials is None or n_covered is None:
                    errors.append(f"Missing n_trials or n_covered for location {uploaded_location_id or 'unknown'}")
                    continue

                actual_location_id = None

                # Try to match by ID first
                if uploaded_location_id:
                    cursor.execute("""
                        SELECT id FROM locations
                        WHERE id = %s AND area_id = %s
                    """, (uploaded_location_id, area_id))

                    location_result = cursor.fetchone()
                    if location_result:
                        actual_location_id = str(location_result[0])
                        matched_by_id += 1

                # Try proximity match (within 50 meters)
                if not actual_location_id:
                    cursor.execute("""
                        SELECT id, ST_Distance(
                            geometry::geography,
                            ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                        ) as distance
                        FROM locations
                        WHERE area_id = %s
                          AND ST_DWithin(
                              geometry::geography,
                              ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                              50
                          )
                        ORDER BY distance
                        LIMIT 1
                    """, (longitude, latitude, area_id, longitude, latitude))

                    location_result = cursor.fetchone()
                    if location_result:
                        actual_location_id = str(location_result[0])
                        matched_by_proximity += 1

                # Create new location if no match
                if not actual_location_id:
                    quadkey = calculate_quadkey(latitude, longitude)
                    if quadkey:
                        affected_quadkeys.add(quadkey)
                    cursor.execute("""
                        INSERT INTO locations (area_id, external_id, latitude, longitude, geometry, quadkey)
                        VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
                        RETURNING id
                    """, (area_id, uploaded_location_id, latitude, longitude, longitude, latitude, quadkey))

                    location_result = cursor.fetchone()
                    actual_location_id = str(location_result[0])
                    new_locations += 1

                # Update or create coverage record
                cursor.execute("""
                    SELECT id, rounds FROM coverage
                    WHERE location_id = %s AND indicator_id = %s
                    LIMIT 1
                """, (actual_location_id, indicator_id))

                coverage_result = cursor.fetchone()
                quadkey = calculate_quadkey(latitude, longitude)
                if quadkey:
                    affected_quadkeys.add(quadkey)

                if coverage_result:
                    # Update existing coverage
                    existing_rounds = coverage_result[1] if coverage_result[1] else []
                    updated_rounds = list(set(existing_rounds + [round_number])) if round_number else existing_rounds

                    cursor.execute("""
                        UPDATE coverage
                        SET n_trials = %s,
                            n_covered = %s,
                            rounds = %s,
                            quadkey = %s,
                            updated_at = NOW()
                        WHERE id = %s
                    """, (n_trials, n_covered, updated_rounds, quadkey, coverage_result[0]))
                else:
                    # Create new coverage
                    initial_rounds = [round_number] if round_number else []
                    cursor.execute("""
                        INSERT INTO coverage (
                            location_id, area_id, indicator_id,
                            version, n_trials, n_covered, rounds, quadkey
                        )
                        VALUES (%s, %s, %s, 0, %s, %s, %s, %s)
                    """, (actual_location_id, area_id, indicator_id, n_trials, n_covered, initial_rounds, quadkey))

            except Exception as e:
                errors.append(f"Error processing location {uploaded_location_id or 'unknown'}: {str(e)}")
                continue

        conn.commit()

        activity.logger.info(
            f"Processed {len(visits)} visits: "
            f"{matched_by_id} matched by ID, "
            f"{matched_by_proximity} matched by proximity, "
            f"{new_locations} new locations"
        )

        return {
            "matched_by_id": matched_by_id,
            "matched_by_proximity": matched_by_proximity,
            "new_locations": new_locations,
            "affected_quadkeys": list(affected_quadkeys),
            "errors": errors
        }
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def update_coverage_pixel_aggregates(
    area_id: str,
    indicator_id: str,
    quadkeys: List[str]
) -> int:
    """
    Update coverage_pixel table with aggregated data from coverage table.

    Args:
        area_id: Area ID
        indicator_id: Indicator ID
        quadkeys: List of quadkeys to update

    Returns:
        Number of coverage_pixel records updated
    """
    from routes.coverage import update_coverage_pixel

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        update_coverage_pixel(cursor, area_id, indicator_id, quadkeys)
        conn.commit()

        activity.logger.info(f"Updated {len(quadkeys)} coverage_pixel records")
        return len(quadkeys)
    finally:
        cursor.close()
        return_db_connection(conn)
