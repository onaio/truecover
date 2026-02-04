# ABOUTME: Temporal workflow for stratified cluster sampling
# ABOUTME: Orchestrates multi-stage cluster selection with adaptive sampling

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.workflow import ParentClosePolicy
from typing import Dict, Any, List, Optional

with workflow.unsafe.imports_passed_through():
    from ..activities.cluster_sampling import (
        select_clusters,
        get_children_for_pcodes,
        save_cluster_sampling_config,
        create_campaign_areas_for_unions,
        compute_pixels_for_campaign_areas,
        create_coverage_pixels_for_union,
        update_campaign_area_sampled_count_for_union,
    )
    from ..activities.rounds import (
        create_round_record,
        delete_round_record,
        call_adaptive_sampling,
        update_round_assignments,
        remove_round_assignments,
    )


@workflow.defn
class UnionPixelSamplingWorkflow:
    """
    Child workflow for sampling pixels from a single union.
    Spawned by StratifiedClusterSamplingWorkflow for each selected union.
    """

    def __init__(self):
        self.status = "initializing"
        self.pixels_selected = 0

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'pixels_selected': self.pixels_selected
        }

    @workflow.run
    async def run(
        self,
        campaign_id: str,
        indicator_id: str,
        union_pcode: str,
        round_number: int,
        pixels_per_union: int,
        uncertainty_field: str,
        min_population: Optional[int]
    ) -> Dict[str, Any]:
        """Run pixel sampling for a single union."""

        workflow.logger.info(f"Starting pixel sampling for union {union_pcode}")

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        selected_ids = []

        try:
            # Step 1: Create coverage_pixel records for this union
            self.status = "creating_coverage_pixels"
            await workflow.execute_activity(
                create_coverage_pixels_for_union,
                args=[campaign_id, indicator_id, union_pcode, min_population],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            # Step 2: Run adaptive sampling
            self.status = "adaptive_sampling"
            sampling_result = await workflow.execute_activity(
                call_adaptive_sampling,
                args=[
                    campaign_id,
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
            self.pixels_selected = len(selected_ids)

            if not selected_ids:
                workflow.logger.warning(f"No pixels selected for union {union_pcode}")
                self.status = "completed_empty"
                return {
                    'union_pcode': union_pcode,
                    'selected_ids': [],
                    'pixels_selected': 0,
                    'status': 'completed_empty'
                }

            # Step 3: Update round assignments for this union's pixels
            self.status = "updating_assignments"
            await workflow.execute_activity(
                update_round_assignments,
                args=[selected_ids, round_number, 'pixels'],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            # Step 4: Update cached_sampled_count for the campaign_area
            self.status = "updating_sampled_count"
            await workflow.execute_activity(
                update_campaign_area_sampled_count_for_union,
                args=[campaign_id, indicator_id, union_pcode],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            self.status = "completed"
            workflow.logger.info(f"Completed sampling for union {union_pcode}: {self.pixels_selected} pixels")

            return {
                'union_pcode': union_pcode,
                'selected_ids': selected_ids,
                'pixels_selected': self.pixels_selected,
                'status': 'completed'
            }

        except Exception as e:
            workflow.logger.error(f"Union pixel sampling failed for {union_pcode}: {e}")
            self.status = "failed"

            # Compensation: remove round assignments if any were made
            if selected_ids:
                try:
                    await workflow.execute_activity(
                        remove_round_assignments,
                        args=[selected_ids, round_number, 'pixels'],
                        start_to_close_timeout=timedelta(minutes=2),
                        retry_policy=retry_policy
                    )
                    await workflow.execute_activity(
                        update_campaign_area_sampled_count_for_union,
                        args=[campaign_id, indicator_id, union_pcode],
                        start_to_close_timeout=timedelta(seconds=30),
                        retry_policy=retry_policy
                    )
                    workflow.logger.info(f"Compensation complete for union {union_pcode}")
                except Exception as comp_error:
                    workflow.logger.error(f"Compensation failed for union {union_pcode}: {comp_error}")

            raise


@workflow.defn
class StratifiedClusterSamplingWorkflow:
    """
    Workflow for stratified cluster sampling.

    Phase 1 (this workflow):
    1. Create round record
    2. Select upazilas from categorized areas
    3. For each upazila, select unions
    4. Create campaign_areas for selected unions
    5. Spawn child workflows for pixel sampling

    Phase 2 (child workflows - UnionPixelSamplingWorkflow):
    - Each union gets its own workflow for pixel sampling
    - Runs in parallel, continues independently
    """

    def __init__(self):
        self.selected_upazilas = []
        self.selected_unions = []
        self.status = "initializing"
        self.child_workflows_started = 0

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'selected_upazilas': len(self.selected_upazilas),
            'selected_unions': len(self.selected_unions),
            'child_workflows_started': self.child_workflows_started
        }

    @workflow.run
    async def run(
        self,
        campaign_id: str,
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

        workflow.logger.info(f"Starting stratified cluster sampling for campaign {campaign_id}")
        self.status = "creating_round"

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        # Step 1: Create round record
        round_data = await workflow.execute_activity(
            create_round_record,
            args=[campaign_id, name, description, start_date, end_date,
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

            # Step 4: Create campaign_areas for selected unions
            self.status = "creating_campaign_areas"
            campaign_area_ids = await workflow.execute_activity(
                create_campaign_areas_for_unions,
                args=[campaign_id, self.selected_unions],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            workflow.logger.info(f"Created {len(campaign_area_ids)} campaign areas")

            # Step 5: Compute pixels for the new campaign areas
            self.status = "computing_pixels"
            await workflow.execute_activity(
                compute_pixels_for_campaign_areas,
                args=[campaign_area_ids],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            # Step 6: Save config
            await workflow.execute_activity(
                save_cluster_sampling_config,
                args=[round_id, campaign_id, starting_pcode, categories, upazila_count,
                      unions_per_upazila, pixels_per_union, population_weighted,
                      category_weights, min_population],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            # Step 7: Spawn child workflows for each union's pixel sampling
            self.status = "spawning_sampling_workflows"
            child_workflow_ids = []

            for union_pcode in self.selected_unions:
                child_workflow_id = f"union-sampling-{campaign_id}-{round_number}-{union_pcode}"

                # Start child workflow - continues even if parent completes
                await workflow.start_child_workflow(
                    UnionPixelSamplingWorkflow.run,
                    args=[
                        campaign_id,
                        indicator_id,
                        union_pcode,
                        round_number,
                        pixels_per_union,
                        uncertainty_field,
                        min_population
                    ],
                    id=child_workflow_id,
                    task_queue="truecover-tasks",
                    parent_close_policy=ParentClosePolicy.ABANDON,
                    execution_timeout=timedelta(minutes=30),
                    task_timeout=timedelta(minutes=2),
                )

                child_workflow_ids.append(child_workflow_id)
                self.child_workflows_started += 1

            workflow.logger.info(f"Started {len(child_workflow_ids)} child workflows for pixel sampling")

            self.status = "completed"

            return {
                'round_id': round_id,
                'round_number': round_number,
                'selected_upazilas': self.selected_upazilas,
                'selected_unions': self.selected_unions,
                'campaign_area_ids': campaign_area_ids,
                'child_workflow_ids': child_workflow_ids,
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
