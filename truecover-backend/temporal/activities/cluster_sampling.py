# ABOUTME: Temporal activities for stratified cluster sampling
# ABOUTME: Handles cluster selection with optional population weighting

from db.connection import get_db_connection, return_db_connection
from temporalio import activity
import random
import json
from typing import List, Dict, Any, Optional


@activity.defn
async def select_clusters(
    pcodes: List[str],
    categories: Dict[str, List[str]],
    count: int,
    population_weighted: bool,
    category_weights: Optional[Dict[str, float]] = None
) -> List[str]:
    """
    Select clusters (upazilas or unions) from categorized areas.

    Args:
        pcodes: All available pcodes to select from
        categories: Dict mapping category name to list of pcodes
        count: Number of clusters to select
        population_weighted: Whether to weight by population
        category_weights: Optional multipliers per category

    Returns:
        List of selected pcodes
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Build selection pool with weights
        pool = []
        for category, category_pcodes in categories.items():
            category_weight = 1.0
            if category_weights and category in category_weights:
                category_weight = category_weights[category]

            for pcode in category_pcodes:
                weight = category_weight

                if population_weighted:
                    # Get population for this pcode from pixels
                    cursor.execute("""
                        SELECT COALESCE(SUM(p.population), 1)
                        FROM pixels p
                        WHERE (p.adm1_pcode = %s OR p.adm2_pcode = %s
                               OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
                          AND p.population IS NOT NULL
                    """, (pcode, pcode, pcode, pcode))
                    pop_result = cursor.fetchone()
                    population = float(pop_result[0]) if pop_result and pop_result[0] else 1
                    weight *= population

                pool.append({'pcode': pcode, 'weight': weight, 'category': category})

        if not pool:
            return []

        # Select using weighted random sampling without replacement
        selected = []
        remaining_pool = pool.copy()

        for _ in range(min(count, len(remaining_pool))):
            if not remaining_pool:
                break

            total_weight = sum(item['weight'] for item in remaining_pool)
            if total_weight == 0:
                # Fall back to uniform random
                choice = random.choice(remaining_pool)
            else:
                # Weighted random selection
                r = random.uniform(0, total_weight)
                cumulative = 0
                choice = remaining_pool[0]
                for item in remaining_pool:
                    cumulative += item['weight']
                    if cumulative >= r:
                        choice = item
                        break

            selected.append(choice['pcode'])
            remaining_pool = [item for item in remaining_pool if item['pcode'] != choice['pcode']]

        activity.logger.info(f"Selected {len(selected)} clusters from {len(pool)} candidates")
        return selected

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def get_children_for_boundary_ids(
    parent_ids: List[str],
    categories: Dict[str, List[str]]
) -> Dict[str, Dict[str, Any]]:
    """
    Get child boundaries for a list of parent admin_boundaries ids.

    Merges parent_id-linked children (e.g. a district's city corporation)
    with pcode-derived children (e.g. that district's upazilas) - a boundary
    can have both simultaneously, they are siblings, not alternatives.

    Args:
        parent_ids: List of parent admin_boundaries.id values
        categories: Original categories to inherit to children, keyed by parent id

    Returns:
        Dict mapping parent_id to {children: [{id, pcode, name}], category: str}
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        result = {}

        id_to_category = {}
        for category, ids in categories.items():
            for boundary_id in ids:
                id_to_category[boundary_id] = category

        for parent_id in parent_ids:
            children = []

            cursor.execute("""
                SELECT id, name,
                       adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
                FROM admin_boundaries WHERE parent_id = %s ORDER BY name
            """, (parent_id,))
            for row in cursor.fetchall():
                pcode = next((row[2 + i] for i in range(5) if row[2 + i]), None)
                children.append({'id': str(row[0]), 'pcode': pcode, 'name': row[1]})

            cursor.execute("""
                SELECT level, adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
                FROM admin_boundaries WHERE id = %s
            """, (parent_id,))
            parent_row = cursor.fetchone()
            if parent_row:
                parent_level = parent_row[0]
                child_level = parent_level + 1
                if child_level <= 4:
                    pcode = parent_row[1 + parent_level]
                    parent_col = f'adm{parent_level}_pcode'
                    child_col = f'adm{child_level}_pcode'
                    cursor.execute(f"""
                        SELECT id, name, {child_col} FROM admin_boundaries
                        WHERE level = %s AND {parent_col} = %s
                        ORDER BY name
                    """, (child_level, pcode))
                    for row in cursor.fetchall():
                        children.append({'id': str(row[0]), 'pcode': row[2], 'name': row[1]})

            result[parent_id] = {
                'children': children,
                'category': id_to_category.get(parent_id, 'uncategorized')
            }

        activity.logger.info(f"Fetched children for {len(result)} parent boundary ids")
        return result

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def save_cluster_sampling_config(
    round_id: str,
    campaign_id: str,
    starting_pcode: str,
    categories: Dict[str, List[str]],
    upazila_count: int,
    unions_per_upazila: int,
    pixels_per_union: int,
    population_weighted: bool,
    category_weights: Optional[Dict[str, float]],
    min_population: Optional[int]
) -> str:
    """Save cluster sampling configuration to database."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        import json
        cursor.execute("""
            INSERT INTO cluster_sampling_config
            (round_id, campaign_id, starting_pcode, categories, upazila_count, unions_per_upazila,
             pixels_per_union, population_weighted, category_weights, min_population)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            round_id,
            campaign_id,
            starting_pcode,
            json.dumps(categories),
            upazila_count,
            unions_per_upazila,
            pixels_per_union,
            population_weighted,
            json.dumps(category_weights) if category_weights else None,
            min_population
        ))

        config_id = str(cursor.fetchone()[0])
        conn.commit()

        activity.logger.info(f"Saved cluster sampling config {config_id} for round {round_id}")
        return config_id

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def create_campaign_areas_for_unions(
    campaign_id: str,
    union_pcodes: List[str],
    union_category_map: Optional[Dict[str, str]] = None
) -> List[str]:
    """
    Create campaign_areas for each selected union.

    Args:
        campaign_id: Campaign to add areas to
        union_pcodes: List of union pcodes to add as campaign areas
        union_category_map: Optional mapping of pcode -> category name

    Returns:
        List of created campaign_area IDs
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        created_ids = []

        for pcode in union_pcodes:
            # Get admin boundary info for this pcode
            cursor.execute("""
                SELECT id, name, ST_AsText(geometry),
                       ST_XMin(geometry), ST_YMin(geometry),
                       ST_XMax(geometry), ST_YMax(geometry)
                FROM admin_boundaries
                WHERE adm4_pcode = %s
                LIMIT 1
            """, (pcode,))

            row = cursor.fetchone()
            if not row:
                activity.logger.warning(f"Admin boundary not found for pcode {pcode}")
                continue

            admin_boundary_id = str(row[0])
            name = row[1]
            geometry_wkt = row[2]
            bbox_min_lng = row[3]
            bbox_min_lat = row[4]
            bbox_max_lng = row[5]
            bbox_max_lat = row[6]
            category = union_category_map.get(pcode) if union_category_map else None

            # Check if this area already exists for the campaign
            cursor.execute("""
                SELECT id FROM campaign_areas
                WHERE campaign_id = %s AND admin_boundary_id = %s
            """, (campaign_id, admin_boundary_id))

            existing = cursor.fetchone()
            if existing:
                # Update category and set status to sampling
                cursor.execute("""
                    UPDATE campaign_areas SET category = %s, status = 'sampling' WHERE id = %s
                """, (category, str(existing[0])))
                created_ids.append(str(existing[0]))
                continue

            # Create the campaign_area
            cursor.execute("""
                INSERT INTO campaign_areas (
                    campaign_id, name, area_type, admin_boundary_id, geometry,
                    bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
                    category, status
                )
                VALUES (%s, %s, 'admin_boundary', %s, ST_GeomFromText(%s, 4326), %s, %s, %s, %s, %s, 'sampling')
                RETURNING id
            """, (
                campaign_id, name, admin_boundary_id, geometry_wkt,
                bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat,
                category
            ))

            area_id = str(cursor.fetchone()[0])
            created_ids.append(area_id)

        conn.commit()
        activity.logger.info(f"Created {len(created_ids)} campaign areas for unions")
        return created_ids

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def compute_pixels_for_campaign_areas(
    campaign_area_ids: List[str]
) -> int:
    """
    Compute which pixels belong to the given campaign areas.

    Args:
        campaign_area_ids: List of campaign_area IDs to compute pixels for

    Returns:
        Total number of pixel associations created
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        total_pixels = 0

        for area_id in campaign_area_ids:
            # Delete existing pixel_area records
            cursor.execute("""
                DELETE FROM pixel_area WHERE campaign_area_id = %s
            """, (area_id,))

            # Insert pixels whose centroid falls inside this area.
            # Use bounding box filter (&&) first for spatial index, then
            # refine with ST_Contains on the centroid to exclude edge pixels.
            cursor.execute("""
                INSERT INTO pixel_area (quadkey, campaign_area_id)
                SELECT p.quadkey, %s
                FROM pixels p
                JOIN campaign_areas ca ON p.geometry && ca.geometry
                    AND ST_Contains(
                        ca.geometry,
                        ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)
                    )
                WHERE ca.id = %s
                ON CONFLICT (quadkey, campaign_area_id) DO NOTHING
            """, (area_id, area_id))

            area_pixel_count = cursor.rowcount
            total_pixels += area_pixel_count

            # Update cached_pixel_count, cached_population, and cached_building_count
            cursor.execute("""
                WITH pixel_stats AS (
                    SELECT
                        COUNT(*) as pixel_count,
                        COALESCE(SUM(p.population), 0) as total_population
                    FROM pixel_area pa
                    JOIN pixels p ON pa.quadkey = p.quadkey
                    WHERE pa.campaign_area_id = %s
                ),
                location_counts AS (
                    SELECT COUNT(DISTINCT l.id) as building_count
                    FROM pixel_area pa2
                    LEFT JOIN locations l ON l.quadkey = pa2.quadkey
                    WHERE pa2.campaign_area_id = %s
                )
                UPDATE campaign_areas
                SET cached_pixel_count = (SELECT pixel_count FROM pixel_stats),
                    cached_population = (SELECT total_population FROM pixel_stats),
                    cached_building_count = (SELECT building_count FROM location_counts),
                    updated_at = NOW()
                WHERE id = %s
            """, (area_id, area_id, area_id))

        conn.commit()
        activity.logger.info(f"Computed {total_pixels} pixel associations for {len(campaign_area_ids)} areas")
        return total_pixels

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def create_coverage_pixels_for_union(
    campaign_id: str,
    indicator_id: str,
    union_pcode: str,
    min_population: Optional[int] = None
) -> int:
    """
    Create coverage_pixel records for all pixels in a union.
    This prepares the union for adaptive sampling.

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        union_pcode: Union pcode to create coverage_pixel records for
        min_population: Optional minimum population filter

    Returns:
        Number of coverage_pixel records created
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Build population filter
        pop_filter = ""
        if min_population is not None:
            pop_filter = f"AND p.population >= {int(min_population)}"

        # Insert coverage_pixel records for all pixels in this union, skipping duplicates
        cursor.execute(f"""
            INSERT INTO coverage_pixel (
                campaign_id, indicator_id, quadkey, version,
                n_trials, n_covered,
                exceedance_probability, exceedance_uncertainty,
                prevalence_prediction, prevalence_bci_width
            )
            SELECT %s, %s, p.quadkey, 0, 0, 0, 0.5, 0.5, 0.5, 0.5
            FROM pixels p
            WHERE p.adm4_pcode = %s
              {pop_filter}
            ON CONFLICT (quadkey, indicator_id, campaign_id, version) DO NOTHING
        """, (campaign_id, indicator_id, union_pcode))

        created_count = cursor.rowcount
        conn.commit()

        activity.logger.info(f"Created {created_count} coverage_pixel records for union {union_pcode}")
        return created_count

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def create_coverage_pixels_for_campaign_area(
    campaign_id: str,
    indicator_id: str,
    campaign_area_id: str,
    min_population: Optional[int] = None
) -> int:
    """
    Create coverage_pixel records for all pixels in a campaign area.

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        campaign_area_id: Campaign area to create coverage_pixel records for
        min_population: Optional minimum population filter

    Returns:
        Number of coverage_pixel records created
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Build population filter
        pop_filter = ""
        if min_population is not None:
            pop_filter = f"AND p.population >= {int(min_population)}"

        # Insert coverage_pixel records for all pixels in this campaign area, skipping duplicates
        cursor.execute(f"""
            INSERT INTO coverage_pixel (
                campaign_id, indicator_id, quadkey, version,
                n_trials, n_covered,
                exceedance_probability, exceedance_uncertainty,
                prevalence_prediction, prevalence_bci_width
            )
            SELECT %s, %s, pa.quadkey, 0, 0, 0, 0.5, 0.5, 0.5, 0.5
            FROM pixel_area pa
            JOIN pixels p ON pa.quadkey = p.quadkey
            WHERE pa.campaign_area_id = %s
              {pop_filter}
            ON CONFLICT (quadkey, indicator_id, campaign_id, version) DO NOTHING
        """, (campaign_id, indicator_id, campaign_area_id))

        created_count = cursor.rowcount
        conn.commit()

        activity.logger.info(f"Created {created_count} coverage_pixel records for campaign_area {campaign_area_id}")
        return created_count

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def sample_pixels_for_campaign_area(
    campaign_id: str,
    indicator_id: str,
    campaign_area_id: str,
    sample_count: int,
    uncertainty_field: str = 'prevalence_bci_width'
) -> Dict[str, Any]:
    """
    Sample pixels from a campaign area using adaptive sampling.

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        campaign_area_id: Campaign area to sample from
        sample_count: Number of pixels to sample
        uncertainty_field: Field to use for uncertainty-based sampling

    Returns:
        Dict with selected_ids and count
    """
    import requests
    import os

    SAMPLING_URL = os.getenv('DOCKER_FN_SAMPLING_URL', 'http://localhost:8083')

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get the admin boundary pcode for this campaign area
        cursor.execute("""
            SELECT ab.adm1_pcode, ab.adm2_pcode, ab.adm3_pcode, ab.adm4_pcode, ab.level
            FROM campaign_areas ca
            JOIN admin_boundaries ab ON ca.admin_boundary_id = ab.id
            WHERE ca.id = %s
        """, (campaign_area_id,))

        row = cursor.fetchone()
        if not row:
            return {'selected_ids': [], 'error': 'Campaign area not found or has no admin boundary'}

        # Use the most specific pcode based on level
        level = row[4]
        admin_pcode = row[level - 1] if level > 0 else None

        if not admin_pcode:
            return {'selected_ids': [], 'error': 'No admin pcode found for campaign area'}

        # Fetch coverage_pixel data for this area
        cursor.execute("""
            SELECT
                cp.id as coverage_pixel_id,
                cp.quadkey,
                p.latitude, p.longitude,
                cp.exceedance_probability, cp.exceedance_uncertainty,
                cp.prevalence_bci_width, cp.prevalence_prediction
            FROM coverage_pixel cp
            JOIN pixel_area pa ON cp.quadkey = pa.quadkey
            JOIN pixels p ON cp.quadkey = p.quadkey
            WHERE cp.campaign_id = %s
              AND cp.indicator_id = %s
              AND cp.version = 0
              AND pa.campaign_area_id = %s
              AND (cp.rounds IS NULL OR array_length(cp.rounds, 1) IS NULL OR array_length(cp.rounds, 1) = 0)
        """, (campaign_id, indicator_id, campaign_area_id))

        records = cursor.fetchall()

        if not records:
            return {'selected_ids': [], 'total_items': 0, 'message': 'No unsampled pixels found'}

        # Build simple arrays for sampling service
        field_to_col = {
            'exceedance_probability': 4,
            'exceedance_uncertainty': 5,
            'prevalence_bci_width': 6,
            'prevalence_prediction': 7,
        }
        uncertainty_col = field_to_col.get(uncertainty_field, 6)

        coordinates = []
        uncertainty_values = []
        coverage_ids = []

        for r in records:
            coordinates.append([float(r[3]), float(r[2])])  # [lon, lat]
            uncertainty_values.append(float(r[uncertainty_col]) if r[uncertainty_col] else 0.5)
            coverage_ids.append(str(r[0]))

        payload = {
            'coordinates': coordinates,
            'uncertainty': uncertainty_values,
            'batch_size': min(sample_count, len(coordinates))
        }

        activity.logger.info(f"Calling adaptive sampling for {len(coordinates)} pixels, selecting {sample_count}")

        response = requests.post(
            SAMPLING_URL,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=300
        )
        response.raise_for_status()

        # R function may print stdout before/after JSON — extract just the JSON
        response_text = response.text
        json_start = response_text.find('{')
        if json_start == -1:
            raise ValueError(f"No JSON in adaptive sampling response: {response_text[:200]}")
        depth = 0
        json_end = json_start
        for i, char in enumerate(response_text[json_start:], start=json_start):
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    json_end = i + 1
                    break
        result = json.loads(response_text[json_start:json_end])

        # Unwrap if wrapped by OpenFaaS
        if isinstance(result, dict) and result.get('function_status') == 'success' and result.get('result'):
            result = result['result']

        # Map selected indices back to coverage IDs
        selected_indices = result.get('selected_indices', [])
        selected_ids = [coverage_ids[i] for i in selected_indices]

        activity.logger.info(f"Selected {len(selected_ids)} pixels from campaign_area {campaign_area_id}")

        return {
            'selected_ids': selected_ids,
            'total_items': len(records)
        }

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def assign_pixels_to_round(
    campaign_area_id: str,
    selected_ids: List[str],
    round_number: int
) -> int:
    """
    Assign selected coverage_pixel records to a round and update cached count.

    Args:
        campaign_area_id: Campaign area ID
        selected_ids: List of coverage_pixel IDs to assign
        round_number: Round number to assign

    Returns:
        Number of pixels assigned
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        if not selected_ids:
            return 0

        # Add round number to pixels in a single batch query
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(COALESCE(rounds, '{}'), %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[]) AND NOT (%s = ANY(COALESCE(rounds, '{}')))
        """, (round_number, selected_ids, round_number))

        # Update cached_sampled_count and cached_sampled_population on campaign_area
        cursor.execute("""
            WITH sampled AS (
                SELECT
                    COUNT(DISTINCT cp.quadkey) as cnt,
                    COALESCE(SUM(p.population), 0) as sampled_pop
                FROM coverage_pixel cp
                JOIN pixel_area pa ON cp.quadkey = pa.quadkey
                JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                JOIN pixels p ON cp.quadkey = p.quadkey
                WHERE pa.campaign_area_id = %s
                  AND cp.campaign_id = ca.campaign_id
                  AND cp.rounds IS NOT NULL
                  AND array_length(cp.rounds, 1) > 0
            )
            UPDATE campaign_areas
            SET cached_sampled_count = (SELECT cnt FROM sampled),
                cached_sampled_population = (SELECT sampled_pop FROM sampled),
                updated_at = NOW()
            WHERE id = %s
        """, (campaign_area_id, campaign_area_id))

        conn.commit()

        activity.logger.info(f"Assigned {len(selected_ids)} pixels to round {round_number} for campaign_area {campaign_area_id}")
        return len(selected_ids)

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def update_campaign_area_sampled_count_for_union(
    campaign_id: str,
    indicator_id: str,
    union_pcode: str,
) -> Optional[str]:
    """
    Update cached_sampled_count for the campaign area matching a union pcode.
    Counts all pixels with rounds assigned in coverage_pixel.

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        union_pcode: Union pcode to find campaign_area for

    Returns:
        Campaign area ID if found and updated, None otherwise
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Find campaign_area for this union
        cursor.execute("""
            SELECT ca.id
            FROM campaign_areas ca
            JOIN admin_boundaries ab ON ca.admin_boundary_id = ab.id
            WHERE ca.campaign_id = %s AND ab.adm4_pcode = %s
            LIMIT 1
        """, (campaign_id, union_pcode))

        row = cursor.fetchone()
        if not row:
            activity.logger.warning(f"No campaign_area found for union {union_pcode}")
            return None

        area_id = str(row[0])

        # Count pixels and population with rounds assigned
        cursor.execute("""
            WITH sampled AS (
                SELECT
                    COUNT(DISTINCT cp.quadkey) as cnt,
                    COALESCE(SUM(p.population), 0) as sampled_pop
                FROM coverage_pixel cp
                JOIN pixel_area pa ON cp.quadkey = pa.quadkey
                JOIN pixels p ON cp.quadkey = p.quadkey
                WHERE pa.campaign_area_id = %s
                  AND cp.campaign_id = %s
                  AND cp.indicator_id = %s
                  AND cp.rounds IS NOT NULL
                  AND array_length(cp.rounds, 1) > 0
            )
            UPDATE campaign_areas
            SET cached_sampled_count = (SELECT cnt FROM sampled),
                cached_sampled_population = (SELECT sampled_pop FROM sampled),
                status = NULL,
                updated_at = NOW()
            WHERE id = %s
            RETURNING cached_sampled_count
        """, (area_id, campaign_id, indicator_id, area_id))

        result = cursor.fetchone()
        sampled_count = result[0] if result else 0

        conn.commit()

        activity.logger.info(f"Updated cached_sampled_count={sampled_count} for campaign_area {area_id}")
        return area_id

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def update_campaign_area_sampled_counts(
    campaign_area_ids: List[str],
    campaign_id: str,
    indicator_id: str
) -> Dict[str, int]:
    """
    Update cached_sampled_count for campaign areas based on coverage_pixel.rounds.

    Args:
        campaign_area_ids: List of campaign area IDs to update
        campaign_id: Campaign ID
        indicator_id: Indicator ID

    Returns:
        Dict mapping area_id to sampled count
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        results = {}

        for area_id in campaign_area_ids:
            # Count pixels and population that have been sampled (have any round assigned)
            cursor.execute("""
                SELECT
                    COUNT(DISTINCT cp.quadkey),
                    COALESCE(SUM(p.population), 0)
                FROM coverage_pixel cp
                JOIN pixel_area pa ON cp.quadkey = pa.quadkey
                JOIN pixels p ON cp.quadkey = p.quadkey
                WHERE pa.campaign_area_id = %s
                  AND cp.campaign_id = %s
                  AND cp.indicator_id = %s
                  AND cp.rounds IS NOT NULL
                  AND array_length(cp.rounds, 1) > 0
            """, (area_id, campaign_id, indicator_id))

            row = cursor.fetchone()
            sampled_count = row[0] or 0
            sampled_population = row[1] or 0
            results[area_id] = sampled_count

            # Update cached counts
            cursor.execute("""
                UPDATE campaign_areas
                SET cached_sampled_count = %s,
                    cached_sampled_population = %s,
                    updated_at = NOW()
                WHERE id = %s
            """, (sampled_count, sampled_population, area_id))

        conn.commit()

        activity.logger.info(f"Updated sampled counts for {len(campaign_area_ids)} campaign areas")
        return results

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def sample_buildings_for_campaign_area(
    campaign_id: str,
    indicator_id: str,
    campaign_area_id: str,
    sample_count: int,
    uncertainty_field: str = 'prevalence_bci_width'
) -> Dict[str, Any]:
    """
    Sample buildings (locations) from a campaign area using adaptive sampling.

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        campaign_area_id: Campaign area to sample from
        sample_count: Number of buildings to sample
        uncertainty_field: Field to use for uncertainty-based sampling

    Returns:
        Dict with selected_ids and count
    """
    import requests
    import os

    SAMPLING_URL = os.getenv('DOCKER_FN_SAMPLING_URL', 'http://localhost:8083')

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get the campaign area geometry bounds
        cursor.execute("""
            SELECT bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat
            FROM campaign_areas
            WHERE id = %s
        """, (campaign_area_id,))

        row = cursor.fetchone()
        if not row:
            return {'selected_ids': [], 'error': 'Campaign area not found'}

        # Fetch buildings (locations) within this campaign area that haven't been sampled
        cursor.execute("""
            SELECT DISTINCT ON (l.id)
                l.id as location_id,
                l.quadkey,
                l.latitude, l.longitude,
                c.exceedance_probability, c.exceedance_uncertainty,
                c.prevalence_bci_width, c.prevalence_prediction
            FROM locations l
            JOIN pixel_area pa ON l.quadkey = pa.quadkey
            LEFT JOIN coverage c ON c.location_id = l.id
                AND c.campaign_id = %s
                AND c.indicator_id = %s
            WHERE pa.campaign_area_id = %s
              AND (c.rounds IS NULL OR array_length(c.rounds, 1) IS NULL OR array_length(c.rounds, 1) = 0)
        """, (campaign_id, indicator_id, campaign_area_id))

        records = cursor.fetchall()

        if not records:
            return {'selected_ids': [], 'total_items': 0, 'message': 'No unsampled buildings found'}

        # Build GeoJSON features
        features = []
        location_id_map = {}

        for idx, r in enumerate(records):
            location_id = str(r[0])
            quadkey = r[1]
            lat, lon = float(r[2]), float(r[3])

            features.append({
                'type': 'Feature',
                'id': idx,
                'geometry': {
                    'type': 'Point',
                    'coordinates': [lon, lat]
                },
                'properties': {
                    'location_id': location_id,
                    'quadkey': quadkey,
                    'exceedance_probability': float(r[4]) if r[4] else 0.5,
                    'exceedance_uncertainty': float(r[5]) if r[5] else 0.5,
                    'prevalence_bci_width': float(r[6]) if r[6] else 0.5,
                    'prevalence_prediction': float(r[7]) if r[7] else 0.5,
                }
            })
            location_id_map[idx] = location_id

        # Call adaptive sampling
        payload = {
            'point_data': {
                'type': 'FeatureCollection',
                'features': features
            },
            'uncertainty_fieldname': uncertainty_field,
            'batch_size': min(sample_count, len(features))
        }

        activity.logger.info(f"Calling adaptive sampling for {len(features)} buildings, selecting {sample_count}")

        response = requests.post(
            SAMPLING_URL,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=300
        )
        response.raise_for_status()

        # Parse response
        response_text = response.text
        json_start = response_text.find('{')
        if json_start == -1:
            return {'selected_ids': [], 'error': 'No JSON in response'}

        depth = 0
        json_end = json_start
        for i, char in enumerate(response_text[json_start:], start=json_start):
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    json_end = i + 1
                    break

        result = json.loads(response_text[json_start:json_end])

        if result.get('function_status') == 'success' and result.get('result'):
            result = result['result']

        # Extract selected IDs
        selected_ids = []
        for feature in result.get('features', []):
            props = feature.get('properties', {})
            if props.get('adaptively_selected', 0) == 1:
                location_id = props.get('location_id')
                if location_id:
                    selected_ids.append(location_id)

        activity.logger.info(f"Selected {len(selected_ids)} buildings from campaign_area {campaign_area_id}")

        return {
            'selected_ids': selected_ids,
            'total_items': len(records)
        }

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def assign_buildings_to_round(
    campaign_area_id: str,
    campaign_id: str,
    indicator_id: str,
    selected_location_ids: List[str],
    round_number: int
) -> int:
    """
    Assign selected buildings (locations) to a round via coverage table.

    Args:
        campaign_area_id: Campaign area ID (for updating cached count)
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        selected_location_ids: List of location IDs to assign
        round_number: Round number to assign

    Returns:
        Number of buildings assigned
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        if not selected_location_ids:
            return 0

        for location_id in selected_location_ids:
            # Create or update coverage record for this location
            cursor.execute("""
                INSERT INTO coverage (
                    campaign_id, indicator_id, location_id, version,
                    n_trials, n_covered, rounds,
                    exceedance_probability, exceedance_uncertainty,
                    prevalence_prediction, prevalence_bci_width
                )
                VALUES (%s, %s, %s, 0, 0, 0, ARRAY[%s], 0.5, 0.5, 0.5, 0.5)
                ON CONFLICT (campaign_id, indicator_id, location_id, version)
                DO UPDATE SET
                    rounds = array_append(COALESCE(coverage.rounds, '{}'), %s),
                    updated_at = NOW()
                WHERE NOT (%s = ANY(COALESCE(coverage.rounds, '{}')))
            """, (campaign_id, indicator_id, location_id, round_number, round_number, round_number))

        # Update cached_sampled_count on campaign_area (count buildings with any round)
        cursor.execute("""
            WITH sampled AS (
                SELECT COUNT(DISTINCT c.location_id) as cnt
                FROM coverage c
                JOIN locations l ON c.location_id = l.id
                JOIN pixel_area pa ON l.quadkey = pa.quadkey
                WHERE pa.campaign_area_id = %s
                  AND c.campaign_id = %s
                  AND c.rounds IS NOT NULL
                  AND array_length(c.rounds, 1) > 0
            )
            UPDATE campaign_areas
            SET cached_sampled_count = (SELECT cnt FROM sampled),
                updated_at = NOW()
            WHERE id = %s
        """, (campaign_area_id, campaign_id, campaign_area_id))

        conn.commit()

        activity.logger.info(f"Assigned {len(selected_location_ids)} buildings to round {round_number} for campaign_area {campaign_area_id}")
        return len(selected_location_ids)

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def ensure_coverage_pixels_for_locations(
    campaign_id: str,
    indicator_id: str,
    location_ids: List[str],
    round_number: int
) -> List[str]:
    """
    Ensure a coverage_pixel row exists and is marked sampled for this round for
    each distinct quadkey among the given locations.

    Building-target sampling assigns individual locations to a round and never
    touches coverage_pixel — this gives it a pixel anchor so
    create_replacement_pixels (which operates on coverage_pixel ids) can be
    reused for building-target rounds too.

    Returns the coverage_pixel ids for those quadkeys.
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        if not location_ids:
            return []

        cursor.execute("""
            SELECT DISTINCT quadkey FROM locations
            WHERE id = ANY(%s::uuid[]) AND quadkey IS NOT NULL
        """, (location_ids,))
        quadkeys = [row[0] for row in cursor.fetchall()]

        pixel_ids = []
        for quadkey in quadkeys:
            cursor.execute("""
                INSERT INTO coverage_pixel (
                    quadkey, campaign_id, indicator_id, version, n_trials, n_covered, rounds
                )
                VALUES (%s, %s, %s, 0, 0, 0, ARRAY[%s])
                ON CONFLICT (quadkey, indicator_id, campaign_id) DO UPDATE SET
                    rounds = array_append(COALESCE(coverage_pixel.rounds, '{}'), %s),
                    updated_at = NOW()
                WHERE NOT (%s = ANY(COALESCE(coverage_pixel.rounds, '{}')))
                RETURNING id
            """, (quadkey, campaign_id, indicator_id, round_number, round_number, round_number))
            row = cursor.fetchone()
            if not row:
                cursor.execute("""
                    SELECT id FROM coverage_pixel
                    WHERE quadkey = %s AND campaign_id = %s AND indicator_id = %s
                """, (quadkey, campaign_id, indicator_id))
                row = cursor.fetchone()
            if row:
                pixel_ids.append(str(row[0]))

        conn.commit()
        return pixel_ids

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def sample_buildings_within_pixels(
    campaign_id: str,
    indicator_id: str,
    campaign_area_id: str,
    candidate_pixel_ids: List[str],
    target_pixel_count: int,
    buildings_per_pixel: int,
    round_number: int
) -> Dict[str, Any]:
    """
    Filter candidate pixels by minimum building count, assign qualified pixels
    to the round, and sample buildings within them.

    candidate_pixel_ids are ordered by priority from adaptive sampling (highest
    uncertainty/spatial diversity first). Includes backup pixels beyond
    target_pixel_count. We walk in priority order and keep the first
    target_pixel_count pixels that have >= buildings_per_pixel buildings.
    """
    import requests
    import os

    SAMPLING_URL = os.getenv('DOCKER_FN_SAMPLING_URL', 'http://localhost:8083')

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Phase 1: Map pixel IDs to quadkeys, preserving candidate order
        cursor.execute("""
            SELECT id, quadkey FROM coverage_pixel WHERE id = ANY(%s::uuid[])
        """, (candidate_pixel_ids,))
        pixel_id_to_quadkey = {str(row[0]): row[1] for row in cursor.fetchall()}

        all_quadkeys = list(set(pixel_id_to_quadkey.values()))
        if not all_quadkeys:
            return {
                'pixels_assigned': 0, 'pixels_skipped': 0,
                'buildings_selected': 0, 'pixels_with_buildings': 0
            }

        # Phase 2: Count buildings per quadkey (locations are global)
        cursor.execute("""
            SELECT l.quadkey, COUNT(*) as cnt
            FROM locations l
            WHERE l.quadkey = ANY(%s)
            GROUP BY l.quadkey
        """, (all_quadkeys,))
        quadkey_building_count = {row[0]: row[1] for row in cursor.fetchall()}

        # Phase 3: Filter pixels — walk in priority order, keep those meeting threshold.
        # buildings_per_pixel of 0 means no minimum — accept all pixels.
        qualified_pixel_ids = []
        qualified_quadkeys = []
        skipped = 0

        for pixel_id in candidate_pixel_ids:
            if len(qualified_pixel_ids) >= target_pixel_count:
                break
            qk = pixel_id_to_quadkey.get(pixel_id)
            if not qk:
                skipped += 1
                continue
            bcount = quadkey_building_count.get(qk, 0)
            if buildings_per_pixel == 0 or bcount >= buildings_per_pixel:
                qualified_pixel_ids.append(pixel_id)
                qualified_quadkeys.append(qk)
            else:
                skipped += 1
                activity.logger.info(
                    f"Skipped pixel {pixel_id} (quadkey {qk}): "
                    f"only {bcount} buildings, need {buildings_per_pixel}"
                )

        activity.logger.info(
            f"Pixel filtering: {len(qualified_pixel_ids)} qualified, "
            f"{skipped} skipped out of {len(candidate_pixel_ids)} candidates"
        )

        if not qualified_pixel_ids:
            return {
                'pixels_assigned': 0, 'pixels_skipped': skipped,
                'buildings_selected': 0, 'pixels_with_buildings': 0
            }

        # Phase 4: Assign qualified pixels to round
        cursor.execute("""
            UPDATE coverage_pixel
            SET rounds = array_append(COALESCE(rounds, '{}'), %s),
                updated_at = NOW()
            WHERE id = ANY(%s::uuid[]) AND NOT (%s = ANY(COALESCE(rounds, '{}')))
        """, (round_number, qualified_pixel_ids, round_number))

        # Update cached_sampled_count and cached_sampled_population
        cursor.execute("""
            WITH sampled AS (
                SELECT
                    COUNT(DISTINCT cp.quadkey) as cnt,
                    COALESCE(SUM(p.population), 0) as sampled_pop
                FROM coverage_pixel cp
                JOIN pixel_area pa ON cp.quadkey = pa.quadkey
                JOIN pixels p ON cp.quadkey = p.quadkey
                WHERE pa.campaign_area_id = %s
                  AND cp.campaign_id = %s
                  AND cp.rounds IS NOT NULL
                  AND array_length(cp.rounds, 1) > 0
            )
            UPDATE campaign_areas
            SET cached_sampled_count = (SELECT cnt FROM sampled),
                cached_sampled_population = (SELECT sampled_pop FROM sampled),
                updated_at = NOW()
            WHERE id = %s
        """, (campaign_area_id, campaign_id, campaign_area_id))

        # Phase 5: Sample buildings within qualified pixels
        unique_quadkeys = list(set(qualified_quadkeys))
        cursor.execute("""
            SELECT l.id, l.quadkey, l.latitude, l.longitude,
                   COALESCE(c.prevalence_bci_width, 0.5) as uncertainty
            FROM locations l
            LEFT JOIN coverage c ON c.location_id = l.id
                AND c.campaign_id = %s AND c.indicator_id = %s
            WHERE l.quadkey = ANY(%s)
        """, (campaign_id, indicator_id, unique_quadkeys))

        rows = cursor.fetchall()
        by_quadkey: Dict[str, list] = {}
        for row in rows:
            qk = row[1]
            if qk not in by_quadkey:
                by_quadkey[qk] = []
            by_quadkey[qk].append({
                'id': str(row[0]),
                'lat': float(row[2]),
                'lon': float(row[3]),
                'uncertainty': float(row[4])
            })

        total_selected = 0
        pixels_with_buildings = 0

        for qk, buildings in by_quadkey.items():
            if not buildings:
                continue

            pixels_with_buildings += 1

            if len(buildings) <= buildings_per_pixel:
                selected_ids = [b['id'] for b in buildings]
            else:
                coordinates = [[b['lon'], b['lat']] for b in buildings]
                uncertainty_values = [b['uncertainty'] for b in buildings]

                payload = {
                    'coordinates': coordinates,
                    'uncertainty': uncertainty_values,
                    'batch_size': buildings_per_pixel
                }

                try:
                    response = requests.post(
                        SAMPLING_URL,
                        json=payload,
                        headers={'Content-Type': 'application/json'},
                        timeout=60
                    )
                    response.raise_for_status()

                    response_text = response.text
                    json_start = response_text.find('{')
                    if json_start == -1:
                        activity.logger.warning(f"No JSON in sampling response for quadkey {qk}")
                        continue

                    depth = 0
                    json_end = json_start
                    for i, char in enumerate(response_text[json_start:], start=json_start):
                        if char == '{':
                            depth += 1
                        elif char == '}':
                            depth -= 1
                            if depth == 0:
                                json_end = i + 1
                                break

                    result = json.loads(response_text[json_start:json_end])

                    if isinstance(result, dict) and result.get('function_status') == 'success' and result.get('result'):
                        result = result['result']

                    selected_indices = result.get('selected_indices', [])
                    selected_ids = [buildings[i]['id'] for i in selected_indices]
                except Exception as e:
                    activity.logger.warning(f"Sampling failed for quadkey {qk}: {e}, selecting first {buildings_per_pixel}")
                    selected_ids = [b['id'] for b in buildings[:buildings_per_pixel]]

            for location_id in selected_ids:
                cursor.execute("""
                    INSERT INTO coverage (
                        campaign_id, indicator_id, location_id, version,
                        n_trials, n_covered, rounds,
                        exceedance_probability, exceedance_uncertainty,
                        prevalence_prediction, prevalence_bci_width
                    )
                    VALUES (%s, %s, %s, 0, 0, 0, ARRAY[%s], 0.5, 0.5, 0.5, 0.5)
                    ON CONFLICT (campaign_id, location_id, indicator_id, version)
                    DO UPDATE SET
                        rounds = array_append(COALESCE(coverage.rounds, '{}'), %s),
                        updated_at = NOW()
                    WHERE NOT (%s = ANY(COALESCE(coverage.rounds, '{}')))
                """, (campaign_id, indicator_id, location_id, round_number, round_number, round_number))

            total_selected += len(selected_ids)

        # Update cached_sampled_count on campaign_area (buildings)
        cursor.execute("""
            WITH sampled AS (
                SELECT COUNT(DISTINCT c.location_id) as cnt
                FROM coverage c
                JOIN locations l ON c.location_id = l.id
                JOIN pixel_area pa ON l.quadkey = pa.quadkey
                WHERE pa.campaign_area_id = %s
                  AND c.campaign_id = %s
                  AND c.rounds IS NOT NULL
                  AND array_length(c.rounds, 1) > 0
            )
            UPDATE campaign_areas
            SET cached_sampled_count = (SELECT cnt FROM sampled),
                updated_at = NOW()
            WHERE id = %s
        """, (campaign_area_id, campaign_id, campaign_area_id))

        conn.commit()

        activity.logger.info(
            f"Selected {total_selected} buildings across {pixels_with_buildings} pixels "
            f"({len(qualified_pixel_ids)} assigned, {skipped} skipped) "
            f"for campaign_area {campaign_area_id}"
        )

        return {
            'pixels_assigned': len(qualified_pixel_ids),
            'pixels_skipped': skipped,
            'buildings_selected': total_selected,
            'pixels_with_buildings': pixels_with_buildings,
            'qualified_pixel_ids': qualified_pixel_ids
        }

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def clear_round_from_buildings(
    campaign_id: str,
    indicator_id: str,
    campaign_area_id: str,
    round_number: int
) -> int:
    """
    Remove a round assignment from buildings in a campaign area (for resampling).

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        campaign_area_id: Campaign area to clear samples from
        round_number: Round number to remove

    Returns:
        Number of buildings cleared
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Remove round_number from rounds array for buildings in this area
        cursor.execute("""
            UPDATE coverage c
            SET rounds = array_remove(rounds, %s),
                updated_at = NOW()
            FROM locations l
            JOIN pixel_area pa ON l.quadkey = pa.quadkey
            WHERE c.location_id = l.id
              AND pa.campaign_area_id = %s
              AND c.campaign_id = %s
              AND c.indicator_id = %s
              AND %s = ANY(COALESCE(c.rounds, '{}'))
        """, (round_number, campaign_area_id, campaign_id, indicator_id, round_number))

        cleared_count = cursor.rowcount

        # Update cached_sampled_count
        cursor.execute("""
            WITH sampled AS (
                SELECT COUNT(DISTINCT c.location_id) as cnt
                FROM coverage c
                JOIN locations l ON c.location_id = l.id
                JOIN pixel_area pa ON l.quadkey = pa.quadkey
                WHERE pa.campaign_area_id = %s
                  AND c.campaign_id = %s
                  AND c.rounds IS NOT NULL
                  AND array_length(c.rounds, 1) > 0
            )
            UPDATE campaign_areas
            SET cached_sampled_count = (SELECT cnt FROM sampled),
                updated_at = NOW()
            WHERE id = %s
        """, (campaign_area_id, campaign_id, campaign_area_id))

        conn.commit()

        activity.logger.info(f"Cleared round {round_number} from {cleared_count} buildings in campaign_area {campaign_area_id}")
        return cleared_count

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def clear_round_from_pixels(
    campaign_id: str,
    indicator_id: str,
    campaign_area_id: str,
    round_number: int
) -> int:
    """
    Remove a round assignment from pixels in a campaign area (for resampling).

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        campaign_area_id: Campaign area to clear samples from
        round_number: Round number to remove

    Returns:
        Number of pixels cleared
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Remove round_number from rounds array for pixels in this area
        cursor.execute("""
            UPDATE coverage_pixel cp
            SET rounds = array_remove(rounds, %s),
                updated_at = NOW()
            FROM pixel_area pa
            WHERE cp.quadkey = pa.quadkey
              AND pa.campaign_area_id = %s
              AND cp.campaign_id = %s
              AND cp.indicator_id = %s
              AND %s = ANY(COALESCE(cp.rounds, '{}'))
        """, (round_number, campaign_area_id, campaign_id, indicator_id, round_number))

        cleared_count = cursor.rowcount

        # Update cached_sampled_count and cached_sampled_population (count pixels still having rounds)
        cursor.execute("""
            WITH sampled AS (
                SELECT
                    COUNT(DISTINCT cp.quadkey) as cnt,
                    COALESCE(SUM(p.population), 0) as sampled_pop
                FROM coverage_pixel cp
                JOIN pixel_area pa ON cp.quadkey = pa.quadkey
                JOIN pixels p ON cp.quadkey = p.quadkey
                WHERE pa.campaign_area_id = %s
                  AND cp.campaign_id = %s
                  AND cp.rounds IS NOT NULL
                  AND array_length(cp.rounds, 1) > 0
            )
            UPDATE campaign_areas
            SET cached_sampled_count = (SELECT cnt FROM sampled),
                cached_sampled_population = (SELECT sampled_pop FROM sampled),
                updated_at = NOW()
            WHERE id = %s
        """, (campaign_area_id, campaign_id, campaign_area_id))

        conn.commit()

        activity.logger.info(f"Cleared round {round_number} from {cleared_count} pixels in campaign_area {campaign_area_id}")
        return cleared_count

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


def upsert_replacement_pixel(cursor, quadkey: str, campaign_id: str, indicator_id: str,
                              round_number: int, primary_pixel_id: str) -> bool:
    """
    Claim a quadkey as the replacement for a primary pixel.

    Returns True if this call actually claimed the pixel, False if it was
    already claimed as someone else's replacement or already sampled as a
    primary (a lost race, or a stale candidate) — the caller should not
    count a False result as a created replacement.
    """
    cursor.execute("""
        INSERT INTO coverage_pixel (
            quadkey, campaign_id, indicator_id, version,
            n_trials, n_covered, rounds, replacement_for
        )
        VALUES (%s, %s, %s, 0, 0, 0, ARRAY[%s], %s)
        ON CONFLICT (quadkey, indicator_id, campaign_id) DO UPDATE SET
            replacement_for = EXCLUDED.replacement_for,
            rounds = array_append(COALESCE(coverage_pixel.rounds, '{}'), %s),
            updated_at = NOW()
        WHERE coverage_pixel.replacement_for IS NULL
          AND (coverage_pixel.rounds IS NULL OR array_length(coverage_pixel.rounds, 1) IS NULL)
    """, (quadkey, campaign_id, indicator_id, round_number, primary_pixel_id, round_number))
    return cursor.rowcount > 0


@activity.defn
async def create_replacement_pixels(
    campaign_id: str,
    indicator_id: str,
    primary_pixel_ids: List[str],
    round_number: int,
    min_building_count: int = 5
) -> Dict[str, Any]:
    """
    For each primary sampled pixel, select a neighboring pixel as a replacement.

    Picks from the 8 adjacent quadkey neighbors, filtering by minimum building
    count and excluding already-sampled pixels. Randomly selects one qualifying
    neighbor per primary pixel.

    Args:
        campaign_id: Campaign ID
        indicator_id: Indicator ID
        primary_pixel_ids: coverage_pixel IDs of primary sampled pixels
        round_number: Round number to assign to replacement pixels
        min_building_count: Minimum buildings required in replacement pixel

    Returns:
        Dict with replacement_count
    """
    import mercantile

    if not primary_pixel_ids:
        return {'replacement_count': 0}

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Map pixel IDs to quadkeys
        cursor.execute("""
            SELECT id, quadkey FROM coverage_pixel WHERE id = ANY(%s::uuid[])
        """, (primary_pixel_ids,))
        pixel_id_to_quadkey = {str(row[0]): row[1] for row in cursor.fetchall()}

        # Build lookup of all quadkeys already sampled or being sampled
        cursor.execute("""
            SELECT quadkey FROM coverage_pixel
            WHERE campaign_id = %s
              AND (rounds IS NOT NULL AND array_length(rounds, 1) > 0)
        """, (campaign_id,))
        already_sampled_quadkeys = {row[0] for row in cursor.fetchall()}

        # Count buildings in primary pixels to skip those below threshold
        primary_quadkeys = list(pixel_id_to_quadkey.values())
        primary_building_counts = {}
        if min_building_count > 0 and primary_quadkeys:
            cursor.execute("""
                SELECT quadkey, COUNT(*) FROM locations
                WHERE quadkey = ANY(%s)
                GROUP BY quadkey
            """, (primary_quadkeys,))
            primary_building_counts = {row[0]: row[1] for row in cursor.fetchall()}

        # Compute all neighbor quadkeys for all primary pixels
        neighbor_candidates = {}  # primary_pixel_id -> list of neighbor quadkeys
        all_neighbor_quadkeys = set()
        for pixel_id in primary_pixel_ids:
            qk = pixel_id_to_quadkey.get(pixel_id)
            if not qk:
                continue
            # Skip primaries that don't meet the building count threshold
            if min_building_count > 0 and primary_building_counts.get(qk, 0) < min_building_count:
                continue
            tile = mercantile.quadkey_to_tile(qk)
            neighbors = []
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    try:
                        neighbor_qk = mercantile.quadkey(mercantile.Tile(
                            tile.x + dx, tile.y + dy, tile.z
                        ))
                        if neighbor_qk not in already_sampled_quadkeys:
                            neighbors.append(neighbor_qk)
                            all_neighbor_quadkeys.add(neighbor_qk)
                    except Exception:
                        continue
            neighbor_candidates[pixel_id] = neighbors

        # Count buildings in all neighbor quadkeys (skip if no minimum required)
        neighbor_building_counts = {}
        if min_building_count > 0 and all_neighbor_quadkeys:
            cursor.execute("""
                SELECT quadkey, COUNT(*) FROM locations
                WHERE quadkey = ANY(%s)
                GROUP BY quadkey
            """, (list(all_neighbor_quadkeys),))
            neighbor_building_counts = {row[0]: row[1] for row in cursor.fetchall()}

        # For each primary pixel, pick a random qualifying neighbor
        replacement_count = 0
        used_replacement_quadkeys = set()
        for pixel_id in primary_pixel_ids:
            candidates = [
                qk for qk in neighbor_candidates.get(pixel_id, [])
                if (min_building_count == 0 or neighbor_building_counts.get(qk, 0) >= min_building_count)
                and qk not in used_replacement_quadkeys
            ]
            if not candidates:
                activity.logger.info(f"No qualifying replacement for pixel {pixel_id}")
                continue

            random.shuffle(candidates)
            claimed = False
            for replacement_qk in candidates:
                # Ensure pixel exists in pixels table
                cursor.execute("""
                    SELECT quadkey FROM pixels WHERE quadkey = %s
                """, (replacement_qk,))
                if not cursor.fetchone():
                    tile = mercantile.quadkey_to_tile(replacement_qk)
                    bounds = mercantile.bounds(tile)
                    centroid_lng = (bounds.west + bounds.east) / 2
                    centroid_lat = (bounds.south + bounds.north) / 2
                    geometry_wkt = (
                        f"POLYGON(({bounds.west} {bounds.south}, "
                        f"{bounds.west} {bounds.north}, "
                        f"{bounds.east} {bounds.north}, "
                        f"{bounds.east} {bounds.south}, "
                        f"{bounds.west} {bounds.south}))"
                    )
                    cursor.execute("""
                        INSERT INTO pixels (quadkey, geometry, latitude, longitude, level)
                        VALUES (%s, ST_GeomFromText(%s, 4326), %s, %s, %s)
                        ON CONFLICT (quadkey) DO NOTHING
                    """, (replacement_qk, geometry_wkt, centroid_lat, centroid_lng, tile.z))

                claimed = upsert_replacement_pixel(
                    cursor, replacement_qk, campaign_id, indicator_id, round_number, pixel_id
                )
                if claimed:
                    used_replacement_quadkeys.add(replacement_qk)
                    break
                activity.logger.info(f"Lost race for replacement candidate {replacement_qk}, trying next")

            if claimed:
                replacement_count += 1
            else:
                activity.logger.info(f"No qualifying replacement for pixel {pixel_id} after exhausting candidates")

        conn.commit()
        activity.logger.info(f"Created {replacement_count} replacement pixels for {len(primary_pixel_ids)} primaries")

        return {'replacement_count': replacement_count}

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)
