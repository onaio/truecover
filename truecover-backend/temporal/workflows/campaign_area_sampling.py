# ABOUTME: Temporal workflow for sampling pixels from a single campaign area
# ABOUTME: Creates coverage_pixel records if needed, then runs adaptive sampling

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any, Optional

with workflow.unsafe.imports_passed_through():
    from ..activities.cluster_sampling import (
        create_coverage_pixels_for_campaign_area,
        sample_pixels_for_campaign_area,
        assign_pixels_to_round,
        clear_round_from_pixels,
        sample_buildings_for_campaign_area,
        assign_buildings_to_round,
        clear_round_from_buildings,
        sample_buildings_within_pixels,
    )
    from ..activities.rounds import create_round_record


@workflow.defn
class CampaignAreaSamplingWorkflow:
    """
    Workflow for sampling pixels from a campaign area.

    Steps:
    1. Create a round for this sampling (or use existing round_number)
    2. Clear existing samples if resampling
    3. Create coverage_pixel records if they don't exist
    4. Run adaptive sampling to select pixels
    5. Assign selected pixels to the round
    """

    def __init__(self):
        self.status = "initializing"
        self.pixels_sampled = 0
        self.round_number = None

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'pixels_sampled': self.pixels_sampled,
            'round_number': self.round_number
        }

    @workflow.run
    async def run(
        self,
        campaign_id: str,
        indicator_id: str,
        campaign_area_id: str,
        sample_count: int,
        resample: bool = False,
        round_number: Optional[int] = None,
        round_name: Optional[str] = None,
        sample_target: str = 'pixels',  # 'pixels' or 'buildings'
        buildings_per_pixel: int = 0
    ) -> Dict[str, Any]:
        """Run sampling for a campaign area."""

        workflow.logger.info(f"Starting sampling for campaign_area {campaign_area_id}, count={sample_count}, resample={resample}, target={sample_target}")

        building_result = None

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        # Step 1: Create or use existing round
        if round_number is None:
            self.status = "creating_round"
            round_data = await workflow.execute_activity(
                create_round_record,
                args=[
                    campaign_id,
                    round_name or f"Area Sampling",
                    f"Sampled {sample_count} pixels from campaign area",
                    None,  # start_date
                    None,  # end_date
                    indicator_id,
                    'pixels',
                    'area_sampling'
                ],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy
            )
            self.round_number = round_data['round_number']
            round_id = round_data['round_id']
        else:
            self.round_number = round_number
            round_id = None

        # Step 2: Clear existing samples if resampling
        if resample:
            self.status = "clearing_samples"
            if sample_target == 'buildings':
                await workflow.execute_activity(
                    clear_round_from_buildings,
                    args=[campaign_id, indicator_id, campaign_area_id, self.round_number],
                    start_to_close_timeout=timedelta(minutes=2),
                    retry_policy=retry_policy
                )
            else:
                await workflow.execute_activity(
                    clear_round_from_pixels,
                    args=[campaign_id, indicator_id, campaign_area_id, self.round_number],
                    start_to_close_timeout=timedelta(minutes=2),
                    retry_policy=retry_policy
                )

        if sample_target == 'buildings':
            # Building sampling: sample from locations table
            self.status = "sampling_buildings"
            sampling_result = await workflow.execute_activity(
                sample_buildings_for_campaign_area,
                args=[campaign_id, indicator_id, campaign_area_id, sample_count],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            selected_ids = sampling_result.get('selected_ids', [])
            self.pixels_sampled = len(selected_ids)

            if not selected_ids:
                workflow.logger.warning(f"No buildings selected for campaign_area {campaign_area_id}")
                self.status = "completed_empty"
                return {
                    'campaign_area_id': campaign_area_id,
                    'round_number': self.round_number,
                    'pixels_sampled': 0,
                    'total_available': sampling_result.get('total_items', 0),
                    'status': 'completed_empty',
                    'message': sampling_result.get('message', 'No buildings available for sampling')
                }

            # Assign buildings to round
            self.status = "assigning_to_round"
            await workflow.execute_activity(
                assign_buildings_to_round,
                args=[campaign_area_id, campaign_id, indicator_id, selected_ids, self.round_number],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )
        else:
            # Pixel sampling: use coverage_pixel table
            # Step 3: Create coverage_pixel records if they don't exist
            self.status = "creating_coverage_pixels"
            created = await workflow.execute_activity(
                create_coverage_pixels_for_campaign_area,
                args=[campaign_id, indicator_id, campaign_area_id, None],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )
            workflow.logger.info(f"Created {created} coverage_pixel records")

            # Step 4: Run adaptive sampling
            self.status = "sampling"
            sampling_result = await workflow.execute_activity(
                sample_pixels_for_campaign_area,
                args=[campaign_id, indicator_id, campaign_area_id, sample_count],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy
            )

            selected_ids = sampling_result.get('selected_ids', [])
            self.pixels_sampled = len(selected_ids)

            if not selected_ids:
                workflow.logger.warning(f"No pixels selected for campaign_area {campaign_area_id}")
                self.status = "completed_empty"
                return {
                    'campaign_area_id': campaign_area_id,
                    'round_number': self.round_number,
                    'pixels_sampled': 0,
                    'total_available': sampling_result.get('total_items', 0),
                    'status': 'completed_empty',
                    'message': sampling_result.get('message', 'No pixels available for sampling')
                }

            # Step 5: Assign pixels to round
            self.status = "assigning_to_round"
            await workflow.execute_activity(
                assign_pixels_to_round,
                args=[campaign_area_id, selected_ids, self.round_number],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy
            )

            # Step 6: Sample buildings within selected pixels if requested
            if buildings_per_pixel > 0 and selected_ids:
                self.status = "sampling_buildings_within_pixels"
                building_result = await workflow.execute_activity(
                    sample_buildings_within_pixels,
                    args=[campaign_id, indicator_id, campaign_area_id,
                          selected_ids, buildings_per_pixel, self.round_number],
                    start_to_close_timeout=timedelta(minutes=10),
                    retry_policy=retry_policy
                )
                workflow.logger.info(
                    f"Building sampling: {building_result.get('buildings_selected', 0)} buildings "
                    f"across {building_result.get('pixels_with_buildings', 0)} pixels"
                )

        self.status = "completed"
        workflow.logger.info(f"Completed sampling for campaign_area {campaign_area_id}: {self.pixels_sampled} pixels in round {self.round_number}")

        result = {
            'campaign_area_id': campaign_area_id,
            'round_number': self.round_number,
            'round_id': round_id,
            'pixels_sampled': self.pixels_sampled,
            'total_available': sampling_result.get('total_items', 0),
            'status': 'completed'
        }
        if building_result:
            result['buildings_selected'] = building_result.get('buildings_selected', 0)
        return result
