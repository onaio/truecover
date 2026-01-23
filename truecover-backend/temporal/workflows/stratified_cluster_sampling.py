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
        call_adaptive_sampling,
        update_round_assignments,
    )


@workflow.defn
class StratifiedClusterSamplingWorkflow:
    """
    Workflow for stratified cluster sampling.

    Steps:
    1. Create round record with sampling_method='stratified_cluster'
    2. Select upazilas from categorized areas
    3. For each upazila, select unions
    4. Run adaptive sampling within each union
    5. Combine results and update round
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

            # Step 4: Run adaptive sampling per union
            self.status = "adaptive_sampling"

            all_selected_coverage_ids = []

            for union_pcode in self.selected_unions:
                # Call adaptive sampling for this union
                # Uses existing call_adaptive_sampling which fetches coverage internally
                sampling_result = await workflow.execute_activity(
                    call_adaptive_sampling,
                    args=[
                        area_id,
                        indicator_id,
                        'pixels',
                        pixels_per_union,
                        uncertainty_field,
                        False,  # allow_revisit
                        union_pcode,  # admin_pcode filter
                        min_population,
                        'population'  # population_field
                    ],
                    start_to_close_timeout=timedelta(minutes=5),
                    retry_policy=retry_policy
                )

                selected_ids = sampling_result.get('selected_ids', [])
                if not selected_ids:
                    workflow.logger.warning(f"No pixels selected for union {union_pcode}")
                    continue

                all_selected_coverage_ids.extend(selected_ids)
                self.total_pixels_selected += len(selected_ids)

            workflow.logger.info(f"Total pixels selected: {self.total_pixels_selected}")

            if not all_selected_coverage_ids:
                raise ValueError("No pixels selected across any union")

            # Step 5: Update round assignments
            self.status = "updating_assignments"
            await workflow.execute_activity(
                update_round_assignments,
                args=[all_selected_coverage_ids, round_number, 'pixels'],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            # Step 6: Save config
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
            try:
                await workflow.execute_activity(
                    delete_round_record,
                    args=[round_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=retry_policy
                )
                workflow.logger.info(f"Deleted round {round_id} due to failure")
            except Exception as delete_error:
                workflow.logger.error(f"Failed to delete round {round_id}: {delete_error}")

            raise
