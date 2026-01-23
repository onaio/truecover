# ABOUTME: Temporal activities for stratified cluster sampling
# ABOUTME: Handles upazila/union selection with optional population weighting

from db.connection import get_db_connection, return_db_connection
from temporalio import activity
import random
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
                        SELECT COALESCE(SUM((pm.metadata->>'population')::numeric), 1)
                        FROM pixels p
                        JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                        WHERE (p.adm1_pcode = %s OR p.adm2_pcode = %s
                               OR p.adm3_pcode = %s OR p.adm4_pcode = %s)
                          AND pm.metadata ? 'population'
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

        return selected

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def get_children_for_pcodes(
    parent_pcodes: List[str],
    categories: Dict[str, List[str]]
) -> Dict[str, Dict[str, Any]]:
    """
    Get child boundaries for a list of parent pcodes.

    Args:
        parent_pcodes: List of parent pcodes to get children for
        categories: Original categories to inherit to children

    Returns:
        Dict mapping parent_pcode to {children: [...], category: str}
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        result = {}

        # Build reverse lookup for category
        pcode_to_category = {}
        for category, pcodes in categories.items():
            for pcode in pcodes:
                pcode_to_category[pcode] = category

        for parent_pcode in parent_pcodes:
            # Find parent level
            cursor.execute("""
                SELECT level FROM admin_boundaries
                WHERE adm1_pcode = %s OR adm2_pcode = %s
                   OR adm3_pcode = %s OR adm4_pcode = %s
                LIMIT 1
            """, (parent_pcode, parent_pcode, parent_pcode, parent_pcode))

            level_result = cursor.fetchone()
            if not level_result:
                continue

            parent_level = level_result[0]
            child_level = parent_level + 1

            if child_level > 4:
                continue

            parent_col = f'adm{parent_level}_pcode'

            cursor.execute(f"""
                SELECT DISTINCT
                    CASE
                        WHEN level = 1 THEN adm1_pcode
                        WHEN level = 2 THEN adm2_pcode
                        WHEN level = 3 THEN adm3_pcode
                        WHEN level = 4 THEN adm4_pcode
                    END as pcode,
                    name
                FROM admin_boundaries
                WHERE level = %s AND {parent_col} = %s
            """, (child_level, parent_pcode))

            children = [{'pcode': row[0], 'name': row[1]} for row in cursor.fetchall()]

            result[parent_pcode] = {
                'children': children,
                'category': pcode_to_category.get(parent_pcode, 'uncategorized')
            }

        return result

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)


@activity.defn
async def save_cluster_sampling_config(
    round_id: str,
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
            (round_id, starting_pcode, categories, upazila_count, unions_per_upazila,
             pixels_per_union, population_weighted, category_weights, min_population)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            round_id,
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
        return config_id

    finally:
        if conn:
            cursor.close()
            return_db_connection(conn)
