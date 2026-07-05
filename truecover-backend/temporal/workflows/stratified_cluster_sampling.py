# ABOUTME: Temporal workflow for stratified cluster sampling
# ABOUTME: Orchestrates multi-stage cluster selection with adaptive sampling, rural or city-corporation branch

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.workflow import ParentClosePolicy
from typing import Dict, Any, List, Optional

with workflow.unsafe.imports_passed_through():
    from ..activities.cluster_sampling import (
        select_clusters,
        get_children_for_boundary_ids,
        save_cluster_sampling_config,
        create_campaign_areas_for_boundaries,
        compute_pixels_for_campaign_areas,
        create_coverage_pixels_for_campaign_area,
        update_campaign_area_sampled_counts,
        create_replacement_pixels,
    )
    from ..activities.rounds import (
        create_round_record,
        delete_round_record,
        remove_round_assignments,
    )
    from ..activities.cluster_sampling import sample_pixels_for_campaign_area, assign_pixels_to_round


@workflow.defn
class AreaPixelSamplingWorkflow:
    """
    Child workflow for sampling pixels from a single campaign area
    (a selected union, or a selected ward under a city corporation zone).
    Spawned by StratifiedClusterSamplingWorkflow for each selected stage-2 boundary.
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
        campaign_area_id: str,
        round_number: int,
        pixels_per_stage2: int,
        min_population: Optional[int],
        uncertainty_field: str = 'prevalence_bci_width'
    ) -> Dict[str, Any]:
        """Run pixel sampling for a single campaign area."""

        workflow.logger.info(f"Starting pixel sampling for campaign_area {campaign_area_id}")

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        selected_ids = []

        try:
            self.status = "creating_coverage_pixels"
            await workflow.execute_activity(
                create_coverage_pixels_for_campaign_area,
                args=[campaign_id, indicator_id, campaign_area_id, min_population],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            self.status = "adaptive_sampling"
            sampling_result = await workflow.execute_activity(
                sample_pixels_for_campaign_area,
                args=[campaign_id, indicator_id, campaign_area_id, pixels_per_stage2, uncertainty_field],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            selected_ids = sampling_result.get('selected_ids', [])
            self.pixels_selected = len(selected_ids)

            if not selected_ids:
                workflow.logger.warning(f"No pixels selected for campaign_area {campaign_area_id}")
                self.status = "completed_empty"
                return {
                    'campaign_area_id': campaign_area_id,
                    'selected_ids': [],
                    'pixels_selected': 0,
                    'status': 'completed_empty'
                }

            self.status = "assigning_to_round"
            await workflow.execute_activity(
                assign_pixels_to_round,
                args=[campaign_area_id, selected_ids, round_number],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            self.status = "updating_sampled_count"
            await workflow.execute_activity(
                update_campaign_area_sampled_counts,
                args=[[campaign_area_id], campaign_id, indicator_id],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            self.status = "creating_replacements"
            replacement_result = await workflow.execute_activity(
                create_replacement_pixels,
                args=[campaign_id, indicator_id, selected_ids, round_number, 5],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )
            workflow.logger.info(
                f"Created {replacement_result.get('replacement_count', 0)} replacement pixels for campaign_area {campaign_area_id}"
            )

            self.status = "completed"
            workflow.logger.info(f"Completed sampling for campaign_area {campaign_area_id}: {self.pixels_selected} pixels")

            return {
                'campaign_area_id': campaign_area_id,
                'selected_ids': selected_ids,
                'pixels_selected': self.pixels_selected,
                'status': 'completed'
            }

        except Exception as e:
            workflow.logger.error(f"Area pixel sampling failed for {campaign_area_id}: {e}")
            self.status = "failed"

            if selected_ids:
                try:
                    await workflow.execute_activity(
                        remove_round_assignments,
                        args=[selected_ids, round_number, 'pixels'],
                        start_to_close_timeout=timedelta(minutes=2),
                        retry_policy=retry_policy
                    )
                    await workflow.execute_activity(
                        update_campaign_area_sampled_counts,
                        args=[[campaign_area_id], campaign_id, indicator_id],
                        start_to_close_timeout=timedelta(seconds=30),
                        retry_policy=retry_policy
                    )
                    workflow.logger.info(f"Compensation complete for campaign_area {campaign_area_id}")
                except Exception as comp_error:
                    workflow.logger.error(f"Compensation failed for campaign_area {campaign_area_id}: {comp_error}")

            raise


@workflow.defn
class StratifiedClusterSamplingWorkflow:
    """
    Workflow for stratified cluster sampling, generic across the rural
    (district -> upazila -> union) and city-corporation (city corp -> zone ->
    ward) branches - the starting boundary determines which children exist.

    Phase 1 (this workflow):
    1. Create round record
    2. Select stage-1 boundaries (upazilas or zones) from categorized areas
    3. For each stage-1 boundary, select stage-2 boundaries (unions or wards)
    4. Create campaign_areas for selected stage-2 boundaries
    5. Spawn child workflows for pixel sampling

    Phase 2 (child workflows - AreaPixelSamplingWorkflow):
    - Each stage-2 boundary gets its own workflow for pixel sampling
    - Runs in parallel, continues independently
    """

    def __init__(self):
        self.selected_stage1 = []
        self.selected_stage2 = []
        self.status = "initializing"
        self.child_workflows_started = 0

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'selected_stage1': len(self.selected_stage1),
            'selected_stage2': len(self.selected_stage2),
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
        starting_boundary_id: str,
        categories: Dict[str, List[str]],
        stage1_count: int,
        stage2_count: int,
        pixels_per_stage2: int,
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
            self.status = "selecting_stage1"
            all_stage1 = []
            for category_ids in categories.values():
                all_stage1.extend(category_ids)

            self.selected_stage1 = await workflow.execute_activity(
                select_clusters,
                args=[all_stage1, categories, stage1_count,
                      population_weighted, category_weights],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            if not self.selected_stage1:
                raise ValueError("No stage-1 areas selected - check category assignments")

            workflow.logger.info(f"Selected {len(self.selected_stage1)} stage-1 areas")

            self.status = "selecting_stage2"
            stage1_children = await workflow.execute_activity(
                get_children_for_boundary_ids,
                args=[self.selected_stage1, categories],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            stage2_categories: Dict[str, List[str]] = {
                'high_risk': [], 'low_risk': [], 'hard_to_reach': []
            }

            for stage1_id, data in stage1_children.items():
                parent_category = data['category']
                child_ids = [c['id'] for c in data['children']]
                if parent_category in stage2_categories:
                    stage2_categories[parent_category].extend(child_ids)
                else:
                    stage2_categories['low_risk'].extend(child_ids)

            for stage1_id, data in stage1_children.items():
                stage2_ids = [c['id'] for c in data['children']]
                if not stage2_ids:
                    continue

                stage1_stage2_categories = {}
                for cat, ids in stage2_categories.items():
                    matching = [i for i in ids if i in stage2_ids]
                    if matching:
                        stage1_stage2_categories[cat] = matching

                selected = await workflow.execute_activity(
                    select_clusters,
                    args=[stage2_ids, stage1_stage2_categories, stage2_count,
                          population_weighted, category_weights],
                    start_to_close_timeout=timedelta(minutes=1),
                    retry_policy=retry_policy
                )
                self.selected_stage2.extend(selected)

            workflow.logger.info(f"Selected {len(self.selected_stage2)} stage-2 areas total")

            if not self.selected_stage2:
                raise ValueError("No stage-2 areas selected")

            self.status = "creating_campaign_areas"
            stage2_category_map = {}
            for cat, ids in stage2_categories.items():
                for boundary_id in ids:
                    if boundary_id in self.selected_stage2:
                        stage2_category_map[boundary_id] = cat

            campaign_area_ids = await workflow.execute_activity(
                create_campaign_areas_for_boundaries,
                args=[campaign_id, self.selected_stage2, stage2_category_map],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            workflow.logger.info(f"Created {len(campaign_area_ids)} campaign areas")

            self.status = "computing_pixels"
            await workflow.execute_activity(
                compute_pixels_for_campaign_areas,
                args=[campaign_area_ids],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            await workflow.execute_activity(
                save_cluster_sampling_config,
                args=[round_id, campaign_id, starting_boundary_id, categories, stage1_count,
                      stage2_count, pixels_per_stage2, population_weighted,
                      category_weights, min_population],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )

            self.status = "spawning_sampling_workflows"
            child_workflow_ids = []

            for campaign_area_id in campaign_area_ids:
                child_workflow_id = f"area-sampling-{campaign_id}-{round_number}-{campaign_area_id}"

                # Start child workflow - continues even if parent completes
                await workflow.start_child_workflow(
                    AreaPixelSamplingWorkflow.run,
                    args=[
                        campaign_id,
                        indicator_id,
                        campaign_area_id,
                        round_number,
                        pixels_per_stage2,
                        min_population,
                        uncertainty_field
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
                'selected_stage1': self.selected_stage1,
                'selected_stage2': self.selected_stage2,
                'campaign_area_ids': campaign_area_ids,
                'child_workflow_ids': child_workflow_ids,
                'area_workflow_map': dict(zip(campaign_area_ids, child_workflow_ids)),
                'status': 'completed'
            }

        except Exception as e:
            workflow.logger.error(f"Workflow failed: {e}")
            self.status = "failed"

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
