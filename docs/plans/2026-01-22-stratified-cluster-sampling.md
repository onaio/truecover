# Stratified Cluster Sampling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add WHO-aligned multi-stage cluster sampling for vaccination coverage surveys, integrating hierarchical area selection with existing adaptive sampling.

**Architecture:** Two-step wizard UI for area categorization and parameter selection. New Temporal workflow orchestrates cluster selection, pixel generation, and adaptive sampling per union. New API endpoint returns admin boundary children for hierarchy display.

**Tech Stack:** React + TypeScript + @dnd-kit/core (frontend), Flask + Temporal + PostGIS (backend)

---

## Task 1: Database Migration - Add cluster_sampling_config Table

**Files:**
- Modify: `truecover-backend/db/migrations.py`

**Step 1: Add migration for cluster_sampling_config table**

Add at the end of `run_migrations()` before `conn.commit()`:

```python
        # Create cluster_sampling_config table for stratified cluster sampling
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cluster_sampling_config (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
                starting_pcode TEXT NOT NULL,
                categories JSONB NOT NULL,
                upazila_count INTEGER NOT NULL,
                unions_per_upazila INTEGER NOT NULL,
                pixels_per_union INTEGER NOT NULL,
                population_weighted BOOLEAN DEFAULT FALSE,
                category_weights JSONB,
                min_population INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            );
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_cluster_sampling_config_round_id
            ON cluster_sampling_config(round_id);
        """)

        # Add sampling_method column to rounds table
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'rounds' AND column_name = 'sampling_method'
                ) THEN
                    ALTER TABLE rounds ADD COLUMN sampling_method TEXT DEFAULT 'simple';
                END IF;
            END $$;
        """)
```

**Step 2: Test migration runs without error**

Run: `cd truecover-backend && uv run python -c "from db.migrations import run_migrations; run_migrations(); print('OK')"`
Expected: `OK` (no errors)

**Step 3: Commit**

```bash
git add truecover-backend/db/migrations.py
git commit -m "feat: add cluster_sampling_config table and sampling_method column"
```

---

## Task 2: API Endpoint - Get Admin Boundary Children

**Files:**
- Modify: `truecover-backend/routes/admin_boundaries.py`

**Step 1: Add endpoint to get children of an admin boundary**

Add after the existing endpoints:

```python
@admin_boundaries_bp.route('/api/admin-boundaries/<pcode>/children', methods=['GET'])
@require_auth
def get_admin_boundary_children(user, pcode):
    """Get child boundaries for a given PCODE with optional population data"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # First, find the level of the given pcode
        cursor.execute("""
            SELECT level,
                   adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode
            FROM admin_boundaries
            WHERE adm0_pcode = %s OR adm1_pcode = %s OR adm2_pcode = %s
               OR adm3_pcode = %s OR adm4_pcode = %s
            LIMIT 1
        """, (pcode, pcode, pcode, pcode, pcode))

        parent = cursor.fetchone()
        if not parent:
            return jsonify({'error': f'Admin boundary not found for PCODE: {pcode}'}), 404

        parent_level = parent[0]
        child_level = parent_level + 1

        if child_level > 4:
            return jsonify({'children': [], 'message': 'No child level exists'}), 200

        # Build the parent pcode column name
        parent_col = f'adm{parent_level}_pcode'

        # Query for children at the next level
        cursor.execute(f"""
            SELECT DISTINCT
                ab.name,
                ab.level,
                CASE
                    WHEN ab.level = 1 THEN ab.adm1_pcode
                    WHEN ab.level = 2 THEN ab.adm2_pcode
                    WHEN ab.level = 3 THEN ab.adm3_pcode
                    WHEN ab.level = 4 THEN ab.adm4_pcode
                END as pcode,
                ab.{parent_col} as parent_pcode,
                COALESCE(
                    (SELECT SUM((pm.metadata->>'population')::numeric)
                     FROM pixels p
                     JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                     WHERE p.adm{child_level}_pcode =
                           CASE
                               WHEN ab.level = 1 THEN ab.adm1_pcode
                               WHEN ab.level = 2 THEN ab.adm2_pcode
                               WHEN ab.level = 3 THEN ab.adm3_pcode
                               WHEN ab.level = 4 THEN ab.adm4_pcode
                           END
                     AND pm.metadata ? 'population'
                    ), 0
                ) as population
            FROM admin_boundaries ab
            WHERE ab.level = %s AND ab.{parent_col} = %s
            ORDER BY ab.name
        """, (child_level, pcode))

        children = cursor.fetchall()

        result = [{
            'name': row[0],
            'level': row[1],
            'pcode': row[2],
            'parent_pcode': row[3],
            'population': float(row[4]) if row[4] else 0
        } for row in children]

        return jsonify({
            'parent_pcode': pcode,
            'parent_level': parent_level,
            'child_level': child_level,
            'children': result
        }), 200

    except Exception as e:
        print(f"Error fetching admin boundary children: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to fetch admin boundary children'}), 500
    finally:
        if conn:
            return_db_connection(conn)
```

**Step 2: Test endpoint manually**

Run: `curl -H "Authorization: Bearer $TOKEN" http://localhost:5001/api/admin-boundaries/BD10/children`
Expected: JSON with `children` array

**Step 3: Commit**

```bash
git add truecover-backend/routes/admin_boundaries.py
git commit -m "feat: add endpoint to get admin boundary children with population"
```

---

## Task 3: Temporal Activities - Cluster Selection Logic

**Files:**
- Create: `truecover-backend/temporal/activities/cluster_sampling.py`

**Step 1: Create cluster sampling activities file**

```python
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
            return_db_connection(conn)
```

**Step 2: Commit**

```bash
git add truecover-backend/temporal/activities/cluster_sampling.py
git commit -m "feat: add Temporal activities for cluster selection logic"
```

---

## Task 4: Temporal Workflow - Stratified Cluster Sampling

**Files:**
- Create: `truecover-backend/temporal/workflows/stratified_cluster_sampling.py`

**Step 1: Create the workflow**

```python
# ABOUTME: Temporal workflow for stratified cluster sampling
# ABOUTME: Orchestrates multi-stage cluster selection with adaptive sampling

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any, List, Optional

with workflow.unsafe.imports_passed_through():
    from ..activities.cluster_sampling import (
        select_clusters,
        get_children_for_pcodes,
        save_cluster_sampling_config,
    )
    from ..activities.rounds import (
        create_round_record,
        delete_round_record,
    )
    from ..activities.pixels import (
        generate_pixels_for_area,
        check_pixels_exist,
    )


@workflow.defn
class StratifiedClusterSamplingWorkflow:
    """
    Workflow for stratified cluster sampling.

    Steps:
    1. Create round record with sampling_method='stratified_cluster'
    2. Select upazilas from categorized areas
    3. For each upazila, select unions
    4. Ensure pixels exist for selected unions
    5. Run adaptive sampling within each union
    6. Combine results and update round
    """

    def __init__(self):
        self.selected_upazilas = []
        self.selected_unions = []
        self.total_pixels_selected = 0
        self.status = "initializing"

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'selected_upazilas': len(self.selected_upazilas),
            'selected_unions': len(self.selected_unions),
            'total_pixels_selected': self.total_pixels_selected
        }

    @workflow.run
    async def run(
        self,
        area_id: str,
        name: str,
        description: str,
        start_date: Optional[str],
        end_date: Optional[str],
        indicator_id: str,
        starting_pcode: str,
        categories: Dict[str, List[str]],
        upazila_count: int,
        unions_per_upazila: int,
        pixels_per_union: int,
        population_weighted: bool,
        category_weights: Optional[Dict[str, float]],
        min_population: Optional[int],
        uncertainty_field: str = 'prevalence_bci_width'
    ) -> Dict[str, Any]:
        """Run stratified cluster sampling workflow."""

        workflow.logger.info(f"Starting stratified cluster sampling for area {area_id}")
        self.status = "creating_round"

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        # Step 1: Create round record
        round_data = await workflow.execute_activity(
            create_round_record,
            args=[area_id, name, description, start_date, end_date,
                  indicator_id, 'pixels', 'stratified_cluster'],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry_policy
        )

        round_id = round_data['round_id']
        round_number = round_data['round_number']

        try:
            # Step 2: Select upazilas
            self.status = "selecting_upazilas"
            all_upazilas = []
            for category_pcodes in categories.values():
                all_upazilas.extend(category_pcodes)

            self.selected_upazilas = await workflow.execute_activity(
                select_clusters,
                args=[all_upazilas, categories, upazila_count,
                      population_weighted, category_weights],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            if not self.selected_upazilas:
                raise ValueError("No upazilas selected - check category assignments")

            workflow.logger.info(f"Selected {len(self.selected_upazilas)} upazilas")

            # Step 3: Get unions for each upazila and select
            self.status = "selecting_unions"
            upazila_children = await workflow.execute_activity(
                get_children_for_pcodes,
                args=[self.selected_upazilas, categories],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            # Build union categories (inherit from parent upazila)
            union_categories: Dict[str, List[str]] = {
                'high_risk': [], 'low_risk': [], 'hard_to_reach': []
            }

            for upazila_pcode, data in upazila_children.items():
                parent_category = data['category']
                child_pcodes = [c['pcode'] for c in data['children']]
                if parent_category in union_categories:
                    union_categories[parent_category].extend(child_pcodes)
                else:
                    union_categories['low_risk'].extend(child_pcodes)

            # Select unions for each upazila
            for upazila_pcode, data in upazila_children.items():
                union_pcodes = [c['pcode'] for c in data['children']]
                if not union_pcodes:
                    continue

                # Build mini-categories for this upazila's unions
                upazila_union_categories = {}
                for cat, pcodes in union_categories.items():
                    matching = [p for p in pcodes if p in union_pcodes]
                    if matching:
                        upazila_union_categories[cat] = matching

                selected = await workflow.execute_activity(
                    select_clusters,
                    args=[union_pcodes, upazila_union_categories, unions_per_upazila,
                          population_weighted, category_weights],
                    start_to_close_timeout=timedelta(minutes=1),
                    retry_policy=retry_policy
                )
                self.selected_unions.extend(selected)

            workflow.logger.info(f"Selected {len(self.selected_unions)} unions total")

            if not self.selected_unions:
                raise ValueError("No unions selected")

            # Step 4: Ensure pixels exist for selected unions
            self.status = "preparing_pixels"
            # This would call existing pixel generation if needed
            # For now, we assume pixels exist

            # Step 5: Run adaptive sampling per union
            self.status = "adaptive_sampling"

            # Import adaptive sampling activities
            with workflow.unsafe.imports_passed_through():
                from ..activities.rounds import (
                    fetch_coverage_for_sampling,
                    call_adaptive_sampling,
                    update_round_assignments,
                )

            all_selected_coverage_ids = []

            for union_pcode in self.selected_unions:
                # Fetch coverage for this union
                coverage_data = await workflow.execute_activity(
                    fetch_coverage_for_sampling,
                    args=[area_id, indicator_id, False, 'pixels',
                          union_pcode, min_population, 'population'],
                    start_to_close_timeout=timedelta(minutes=2),
                    retry_policy=retry_policy
                )

                if not coverage_data or len(coverage_data) == 0:
                    workflow.logger.warning(f"No coverage data for union {union_pcode}")
                    continue

                # Call adaptive sampling for this union
                selected_ids = await workflow.execute_activity(
                    call_adaptive_sampling,
                    args=[coverage_data, pixels_per_union, uncertainty_field, 'pixels'],
                    start_to_close_timeout=timedelta(minutes=5),
                    retry_policy=retry_policy
                )

                all_selected_coverage_ids.extend(selected_ids)
                self.total_pixels_selected += len(selected_ids)

            workflow.logger.info(f"Total pixels selected: {self.total_pixels_selected}")

            if not all_selected_coverage_ids:
                raise ValueError("No pixels selected across any union")

            # Step 6: Update round assignments
            self.status = "updating_assignments"
            await workflow.execute_activity(
                update_round_assignments,
                args=[all_selected_coverage_ids, round_number, 'pixels'],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            # Save config
            await workflow.execute_activity(
                save_cluster_sampling_config,
                args=[round_id, starting_pcode, categories, upazila_count,
                      unions_per_upazila, pixels_per_union, population_weighted,
                      category_weights, min_population],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            self.status = "completed"

            return {
                'round_id': round_id,
                'round_number': round_number,
                'selected_upazilas': self.selected_upazilas,
                'selected_unions': self.selected_unions,
                'total_pixels_selected': self.total_pixels_selected,
                'status': 'completed'
            }

        except Exception as e:
            workflow.logger.error(f"Workflow failed: {e}")
            self.status = "failed"

            # Compensation: delete the round
            await workflow.execute_activity(
                delete_round_record,
                args=[round_id],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            raise
```

**Step 2: Register workflow in worker**

Modify `truecover-backend/temporal_worker.py` to import and register the new workflow.

**Step 3: Commit**

```bash
git add truecover-backend/temporal/workflows/stratified_cluster_sampling.py
git commit -m "feat: add Temporal workflow for stratified cluster sampling"
```

---

## Task 5: Update create_round_record Activity

**Files:**
- Modify: `truecover-backend/temporal/activities/rounds.py`

**Step 1: Update create_round_record to accept sampling_method parameter**

Find the `create_round_record` function and add `sampling_method` parameter:

```python
@activity.defn
async def create_round_record(
    area_id: str,
    name: str,
    description: str,
    start_date: str,
    end_date: str,
    indicator_id: str,
    sampling_target: str,
    sampling_method: str = 'simple'  # Add this parameter
) -> Dict[str, Any]:
```

Update the INSERT query to include `sampling_method`:

```python
cursor.execute("""
    INSERT INTO rounds (area_id, round_number, name, description,
                       start_date, end_date, indicator_id, sampling_method)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    RETURNING id
""", (area_id, round_number, name, description,
      start_date or None, end_date or None, indicator_id, sampling_method))
```

**Step 2: Commit**

```bash
git add truecover-backend/temporal/activities/rounds.py
git commit -m "feat: add sampling_method parameter to create_round_record"
```

---

## Task 6: API Endpoint - Stratified Cluster Sampling

**Files:**
- Modify: `truecover-backend/routes/rounds.py`

**Step 1: Add new endpoint for stratified cluster sampling**

```python
@rounds_bp.route('/api/areas/<area_id>/rounds/stratified-cluster', methods=['POST'])
@require_auth
def create_stratified_cluster_round(user, area_id):
    """Create a new round using stratified cluster sampling workflow"""
    from datetime import datetime
    from temporal.client import get_temporal_client, run_async
    from temporal.workflows.stratified_cluster_sampling import StratifiedClusterSamplingWorkflow

    try:
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        # Required fields
        name = data.get('name')
        starting_pcode = data.get('starting_pcode')
        categories = data.get('categories', {})
        upazila_count = data.get('upazila_count', 3)
        unions_per_upazila = data.get('unions_per_upazila', 2)
        pixels_per_union = data.get('pixels_per_union', 50)
        indicator_id = data.get('indicator_id')

        # Optional fields
        description = data.get('description', '')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        population_weighted = data.get('population_weighted', False)
        category_weights = data.get('category_weights')
        min_population = data.get('min_population')
        uncertainty_field = data.get('uncertainty_field', 'prevalence_bci_width')

        # Validation
        if not name:
            return jsonify({'error': 'Round name is required'}), 400
        if not starting_pcode:
            return jsonify({'error': 'Starting PCODE is required'}), 400
        if not indicator_id:
            return jsonify({'error': 'Indicator ID is required'}), 400
        if not categories or all(len(v) == 0 for v in categories.values()):
            return jsonify({'error': 'At least one area must be categorized'}), 400

        # Generate workflow ID
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        workflow_id = f"stratified-cluster-{area_id}-{timestamp}"

        async def start_workflow():
            client = await get_temporal_client()
            handle = await client.start_workflow(
                StratifiedClusterSamplingWorkflow.run,
                args=[
                    area_id,
                    name,
                    description,
                    start_date,
                    end_date,
                    indicator_id,
                    starting_pcode,
                    categories,
                    upazila_count,
                    unions_per_upazila,
                    pixels_per_union,
                    population_weighted,
                    category_weights,
                    min_population,
                    uncertainty_field
                ],
                id=workflow_id,
                task_queue="truecover-tasks"
            )
            return handle

        run_async(start_workflow())

        return jsonify({
            'workflow_id': workflow_id,
            'status': 'started',
            'message': 'Stratified cluster sampling started.'
        }), 202

    except Exception as e:
        print(f"Error starting stratified cluster sampling: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to start workflow', 'details': str(e)}), 500
```

**Step 2: Commit**

```bash
git add truecover-backend/routes/rounds.py
git commit -m "feat: add API endpoint for stratified cluster sampling"
```

---

## Task 7: Register Workflow in Temporal Worker

**Files:**
- Modify: `truecover-backend/temporal_worker.py`

**Step 1: Import and register new workflow and activities**

Add imports:

```python
from temporal.workflows.stratified_cluster_sampling import StratifiedClusterSamplingWorkflow
from temporal.activities.cluster_sampling import (
    select_clusters,
    get_children_for_pcodes,
    save_cluster_sampling_config,
)
```

Add to workflows list in Worker:

```python
workflows=[
    # ... existing workflows ...
    StratifiedClusterSamplingWorkflow,
]
```

Add to activities list:

```python
activities=[
    # ... existing activities ...
    select_clusters,
    get_children_for_pcodes,
    save_cluster_sampling_config,
]
```

**Step 2: Commit**

```bash
git add truecover-backend/temporal_worker.py
git commit -m "feat: register stratified cluster sampling workflow in worker"
```

---

## Task 8: Frontend - Install @dnd-kit

**Files:**
- Modify: `truecover-app/package.json`

**Step 1: Install drag-and-drop library**

Run:
```bash
cd truecover-app && bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Step 2: Commit**

```bash
git add truecover-app/package.json truecover-app/bun.lock
git commit -m "feat: add @dnd-kit for drag-drop functionality"
```

---

## Task 9: Frontend - Create DraggableAreaCard Component

**Files:**
- Create: `truecover-app/src/components/DraggableAreaCard.tsx`

**Step 1: Create the component**

```typescript
import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

interface DraggableAreaCardProps {
  id: string;
  name: string;
  pcode: string;
  population?: number;
}

export const DraggableAreaCard: React.FC<DraggableAreaCardProps> = ({
  id,
  name,
  pcode,
  population,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        p-2 mb-2 bg-zinc-800 border border-zinc-700 rounded cursor-grab
        hover:border-cyan-500 transition-colors
        ${isDragging ? 'cursor-grabbing shadow-lg' : ''}
      `}
    >
      <div className="text-sm font-medium text-zinc-100">{name}</div>
      <div className="text-xs text-zinc-400">{pcode}</div>
      {population !== undefined && population > 0 && (
        <div className="text-xs text-cyan-400 mt-1">
          Pop: {population.toLocaleString()}
        </div>
      )}
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add truecover-app/src/components/DraggableAreaCard.tsx
git commit -m "feat: add DraggableAreaCard component"
```

---

## Task 10: Frontend - Create CategoryColumn Component

**Files:**
- Create: `truecover-app/src/components/CategoryColumn.tsx`

**Step 1: Create the component**

```typescript
import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface CategoryColumnProps {
  id: string;
  title: string;
  count: number;
  color: 'red' | 'green' | 'yellow' | 'gray';
  children: React.ReactNode;
}

const colorClasses = {
  red: 'border-red-500/50 bg-red-950/20',
  green: 'border-green-500/50 bg-green-950/20',
  yellow: 'border-yellow-500/50 bg-yellow-950/20',
  gray: 'border-zinc-500/50 bg-zinc-900/50',
};

const headerClasses = {
  red: 'text-red-400',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  gray: 'text-zinc-400',
};

export const CategoryColumn: React.FC<CategoryColumnProps> = ({
  id,
  title,
  count,
  color,
  children,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`
        flex-1 min-w-[200px] p-3 rounded border-2
        ${colorClasses[color]}
        ${isOver ? 'ring-2 ring-cyan-400' : ''}
        transition-all
      `}
    >
      <div className={`text-sm font-bold mb-3 ${headerClasses[color]}`}>
        {title} ({count})
      </div>
      <div className="min-h-[200px] max-h-[400px] overflow-y-auto">
        {children}
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add truecover-app/src/components/CategoryColumn.tsx
git commit -m "feat: add CategoryColumn component for drag-drop targets"
```

---

## Task 11: Frontend - Create StratifiedClusterSamplingWizard Component

**Files:**
- Create: `truecover-app/src/components/StratifiedClusterSamplingWizard.tsx`

**Step 1: Create the wizard component (Part 1 - state and fetching)**

```typescript
import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import {
  TacticalModal,
  TacticalButton,
  TacticalInput,
  TacticalSelect,
  tacticalToast,
} from '../tactical-ui';
import { DraggableAreaCard } from './DraggableAreaCard';
import { CategoryColumn } from './CategoryColumn';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface AdminBoundary {
  pcode: string;
  name: string;
  level: number;
  population: number;
}

interface Categories {
  high_risk: string[];
  low_risk: string[];
  hard_to_reach: string[];
  uncategorized: string[];
}

interface StratifiedClusterSamplingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  projectId: string;
  startingPcode: string;
  startingName: string;
  indicatorId: string;
  onRoundCreated: () => void;
}

export const StratifiedClusterSamplingWizard: React.FC<
  StratifiedClusterSamplingWizardProps
> = ({
  isOpen,
  onClose,
  areaId,
  projectId,
  startingPcode,
  startingName,
  indicatorId,
  onRoundCreated,
}) => {
  const { getToken } = useAuth();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1 state
  const [children, setChildren] = useState<AdminBoundary[]>([]);
  const [categories, setCategories] = useState<Categories>({
    high_risk: [],
    low_risk: [],
    hard_to_reach: [],
    uncategorized: [],
  });

  // Step 2 state
  const [roundName, setRoundName] = useState('');
  const [upazilaCount, setUpazilaCount] = useState('3');
  const [unionsPerUpazila, setUnionsPerUpazila] = useState('2');
  const [pixelsPerUnion, setPixelsPerUnion] = useState('50');
  const [populationWeighted, setPopulationWeighted] = useState(false);
  const [minPopulation, setMinPopulation] = useState('');

  // Fetch children on mount
  useEffect(() => {
    if (isOpen && startingPcode) {
      fetchChildren();
    }
  }, [isOpen, startingPcode]);

  const fetchChildren = async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const response = await axios.get(
        `${API_URL}/api/admin-boundaries/${startingPcode}/children`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const childData = response.data.children || [];
      setChildren(childData);
      setCategories({
        high_risk: [],
        low_risk: [],
        hard_to_reach: [],
        uncategorized: childData.map((c: AdminBoundary) => c.pcode),
      });
    } catch (error) {
      console.error('Error fetching children:', error);
      tacticalToast.error('Failed to load areas');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const draggedPcode = active.id as string;
    const targetCategory = over.id as keyof Categories;

    // Remove from current category
    const newCategories = { ...categories };
    for (const cat of Object.keys(newCategories) as (keyof Categories)[]) {
      newCategories[cat] = newCategories[cat].filter((p) => p !== draggedPcode);
    }

    // Add to new category
    newCategories[targetCategory].push(draggedPcode);
    setCategories(newCategories);
  };

  const getAreaByPcode = (pcode: string) =>
    children.find((c) => c.pcode === pcode);

  const canProceedStep1 = categories.uncategorized.length === 0;

  const estimatedPixels =
    parseInt(upazilaCount) *
    parseInt(unionsPerUpazila) *
    parseInt(pixelsPerUnion);

  const estimatedPopulation = () => {
    const categorizedPcodes = [
      ...categories.high_risk,
      ...categories.low_risk,
      ...categories.hard_to_reach,
    ];
    const totalPop = children
      .filter((c) => categorizedPcodes.includes(c.pcode))
      .reduce((sum, c) => sum + (c.population || 0), 0);

    if (totalPop === 0) return null;

    const avgPopPerPixel = totalPop / children.length / 100; // rough estimate
    return Math.round(estimatedPixels * avgPopPerPixel);
  };

  const handleSubmit = async () => {
    if (!roundName.trim()) {
      tacticalToast.error('Round name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getToken();
      const response = await axios.post(
        `${API_URL}/api/areas/${areaId}/rounds/stratified-cluster`,
        {
          name: roundName.trim(),
          starting_pcode: startingPcode,
          categories: {
            high_risk: categories.high_risk,
            low_risk: categories.low_risk,
            hard_to_reach: categories.hard_to_reach,
          },
          upazila_count: parseInt(upazilaCount),
          unions_per_upazila: parseInt(unionsPerUpazila),
          pixels_per_union: parseInt(pixelsPerUnion),
          population_weighted: populationWeighted,
          min_population: minPopulation ? parseInt(minPopulation) : null,
          indicator_id: indicatorId,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      tacticalToast.success('Stratified cluster sampling started');
      onRoundCreated();
      onClose();
    } catch (error: any) {
      console.error('Error creating round:', error);
      tacticalToast.error(
        error.response?.data?.error || 'Failed to create round'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Stratified Cluster Sampling"
      size="xl"
    >
      {step === 1 && (
        <div>
          <div className="mb-4 text-zinc-300">
            <span className="text-cyan-400">{startingName}</span> - Drag areas
            into categories. All areas must be categorized to proceed.
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-zinc-400">Loading...</div>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-3 overflow-x-auto pb-4">
                <CategoryColumn
                  id="uncategorized"
                  title="Uncategorized"
                  count={categories.uncategorized.length}
                  color="gray"
                >
                  {categories.uncategorized.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>

                <CategoryColumn
                  id="high_risk"
                  title="High Risk"
                  count={categories.high_risk.length}
                  color="red"
                >
                  {categories.high_risk.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>

                <CategoryColumn
                  id="low_risk"
                  title="Low Risk"
                  count={categories.low_risk.length}
                  color="green"
                >
                  {categories.low_risk.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>

                <CategoryColumn
                  id="hard_to_reach"
                  title="Hard to Reach"
                  count={categories.hard_to_reach.length}
                  color="yellow"
                >
                  {categories.hard_to_reach.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>
              </div>
            </DndContext>
          )}

          <div className="flex justify-end mt-4">
            <TacticalButton onClick={onClose} variant="secondary">
              Cancel
            </TacticalButton>
            <TacticalButton
              onClick={() => setStep(2)}
              disabled={!canProceedStep1}
              className="ml-2"
            >
              Next
            </TacticalButton>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="space-y-4">
            <TacticalInput
              label="Round Name"
              value={roundName}
              onChange={(e) => setRoundName(e.target.value)}
              placeholder="e.g., Round 1 - District Survey"
              required
            />

            <div className="grid grid-cols-3 gap-4">
              <TacticalInput
                label="Upazilas to Select"
                type="number"
                min="1"
                value={upazilaCount}
                onChange={(e) => setUpazilaCount(e.target.value)}
              />
              <TacticalInput
                label="Unions per Upazila"
                type="number"
                min="1"
                value={unionsPerUpazila}
                onChange={(e) => setUnionsPerUpazila(e.target.value)}
              />
              <TacticalInput
                label="Pixels per Union"
                type="number"
                min="1"
                value={pixelsPerUnion}
                onChange={(e) => setPixelsPerUnion(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={populationWeighted}
                  onChange={(e) => setPopulationWeighted(e.target.checked)}
                  className="rounded"
                />
                Weight selection by population
              </label>
            </div>

            <TacticalInput
              label="Minimum Population (optional)"
              type="number"
              min="0"
              value={minPopulation}
              onChange={(e) => setMinPopulation(e.target.value)}
              placeholder="e.g., 10"
            />

            <div className="mt-4 p-3 bg-zinc-800 rounded border border-zinc-700">
              <div className="text-sm text-zinc-300">
                <strong>Summary:</strong> ~{estimatedPixels.toLocaleString()}{' '}
                pixels across {parseInt(upazilaCount) * parseInt(unionsPerUpazila)}{' '}
                unions in {upazilaCount} upazilas
                {estimatedPopulation() && (
                  <span className="text-cyan-400 ml-2">
                    (Est. pop: {estimatedPopulation()?.toLocaleString()})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-between mt-6">
            <TacticalButton onClick={() => setStep(1)} variant="secondary">
              Back
            </TacticalButton>
            <div>
              <TacticalButton onClick={onClose} variant="secondary">
                Cancel
              </TacticalButton>
              <TacticalButton
                onClick={handleSubmit}
                disabled={isSubmitting || !roundName.trim()}
                className="ml-2"
              >
                {isSubmitting ? 'Creating...' : 'Create Round'}
              </TacticalButton>
            </div>
          </div>
        </div>
      )}
    </TacticalModal>
  );
};
```

**Step 2: Commit**

```bash
git add truecover-app/src/components/StratifiedClusterSamplingWizard.tsx
git commit -m "feat: add StratifiedClusterSamplingWizard component"
```

---

## Task 12: Frontend - Integrate Wizard into RoundsManager

**Files:**
- Modify: `truecover-app/src/components/RoundsManager.tsx`

**Step 1: Add state and button to launch wizard**

Import the wizard:
```typescript
import { StratifiedClusterSamplingWizard } from './StratifiedClusterSamplingWizard';
```

Add state:
```typescript
const [showStratifiedWizard, setShowStratifiedWizard] = useState(false);
```

Add button alongside existing "Create Round" button:
```typescript
<TacticalButton
  onClick={() => setShowStratifiedWizard(true)}
  variant="secondary"
  disabled={!selectedAdminBoundary}
>
  Stratified Cluster Sampling
</TacticalButton>
```

Add wizard component:
```typescript
<StratifiedClusterSamplingWizard
  isOpen={showStratifiedWizard}
  onClose={() => setShowStratifiedWizard(false)}
  areaId={areaId}
  projectId={projectId}
  startingPcode={selectedAdminBoundary?.pcode || ''}
  startingName={selectedAdminBoundary?.name || ''}
  indicatorId={indicators?.[0]?.id || ''}
  onRoundCreated={handleRoundCreated}
/>
```

**Step 2: Commit**

```bash
git add truecover-app/src/components/RoundsManager.tsx
git commit -m "feat: integrate stratified cluster sampling wizard"
```

---

## Task 13: Export New Components

**Files:**
- Modify: `truecover-app/src/components/index.ts` (if exists, otherwise skip)

**Step 1: Export new components**

Add exports if there's an index file:
```typescript
export { DraggableAreaCard } from './DraggableAreaCard';
export { CategoryColumn } from './CategoryColumn';
export { StratifiedClusterSamplingWizard } from './StratifiedClusterSamplingWizard';
```

**Step 2: Commit**

```bash
git add truecover-app/src/components/index.ts
git commit -m "feat: export stratified cluster sampling components"
```

---

## Task 14: Final Build Verification

**Step 1: Verify backend imports work**

```bash
cd truecover-backend && uv run python -c "
from temporal.workflows.stratified_cluster_sampling import StratifiedClusterSamplingWorkflow
from temporal.activities.cluster_sampling import select_clusters
print('Backend imports OK')
"
```

**Step 2: Verify frontend builds**

```bash
cd truecover-app && bun run build
```

Expected: Build succeeds

**Step 3: Create final commit**

```bash
git add -A
git status
git commit -m "feat: complete stratified cluster sampling implementation"
```

---

## Summary

This implementation adds:
1. **Database**: `cluster_sampling_config` table + `sampling_method` column on rounds
2. **API**: `/api/admin-boundaries/<pcode>/children` endpoint
3. **API**: `/api/areas/<id>/rounds/stratified-cluster` endpoint
4. **Temporal**: `StratifiedClusterSamplingWorkflow` with cluster selection activities
5. **Frontend**: Two-step wizard with drag-drop categorization
6. **Frontend**: Integration into RoundsManager

The feature enables WHO-aligned multi-stage cluster sampling by combining hierarchical area selection (upazilas → unions) with existing adaptive sampling for final pixel selection within each union.
