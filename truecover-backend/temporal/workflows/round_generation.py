# ABOUTME: Temporal workflow for round generation
# ABOUTME: Orchestrates round creation, adaptive sampling, and coverage assignment

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any

with workflow.unsafe.imports_passed_through():
    from ..activities.rounds import (
        create_round_record,
        fetch_coverage_for_sampling,
        call_adaptive_sampling,
        update_round_assignments,
        delete_round_record,
    )


@workflow.defn
class RoundGenerationWorkflow:
    """
    Workflow for generating survey rounds with adaptive sampling.

    Steps:
    1. Create round record
    2. Fetch coverage data for sampling
    3. Call adaptive sampling service
    4. Update coverage records with round assignments
    5. Handle compensation if update fails
    """

    def __init__(self):
        self.total_items = 0
        self.selected_count = 0

    @workflow.run
    async def run(
        self,
        area_id: str,
        name: str,
        description: str,
        start_date: str,
        end_date: str,
        indicator_id: str,
        batch_size: int,
        uncertainty_field: str,
        allow_revisit: bool,
        sampling_target: str,
        admin_pcode: str = None
    ) -> Dict[str, Any]:
        """
        Run round generation workflow.

        Args:
            area_id: Area ID
            name: Round name
            description: Round description
            start_date: Start date
            end_date: End date
            indicator_id: Indicator ID
            batch_size: Number of items to select
            uncertainty_field: Field to use for uncertainty
            allow_revisit: Allow revisiting locations/pixels
            sampling_target: 'locations' or 'pixels'
            admin_pcode: Optional admin boundary filter

        Returns:
            Result summary with round details and selection count
        """
        workflow.logger.info(f"Starting round generation for area {area_id}")

        # Activity 1: Create round record
        round_data = await workflow.execute_activity(
            create_round_record,
            args=[area_id, name, description, start_date, end_date, indicator_id, sampling_target],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        round_id = round_data["round_id"]
        round_number = round_data["round_number"]

        workflow.logger.info(f"Created round {round_number} with ID {round_id}")

        try:
            # Activity 2: Fetch coverage data
            coverage_data = await workflow.execute_activity(
                fetch_coverage_for_sampling,
                args=[area_id, indicator_id, sampling_target, allow_revisit, admin_pcode],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            self.total_items = len(coverage_data)

            if not coverage_data:
                # No data found, delete round and return error
                await workflow.execute_activity(
                    delete_round_record,
                    args=[round_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=3)
                )
                raise ValueError(f"No {sampling_target} found for sampling")

            workflow.logger.info(f"Fetched {len(coverage_data)} {sampling_target} for sampling")

            # Activity 3: Call adaptive sampling
            sampling_results = await workflow.execute_activity(
                call_adaptive_sampling,
                args=[coverage_data, sampling_target, batch_size, uncertainty_field],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=1),
                    maximum_attempts=3
                )
            )

            workflow.logger.info(f"Received {len(sampling_results)} results from adaptive sampling")

            # Activity 4: Update round assignments
            selected_count = await workflow.execute_activity(
                update_round_assignments,
                args=[sampling_results, coverage_data, round_number, sampling_target],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            self.selected_count = selected_count

            workflow.logger.info(f"Round generation complete: {selected_count} {sampling_target} selected")

            return {
                "success": True,
                "round": round_data,
                "selected_count": selected_count,
            }

        except Exception as e:
            # Compensation: Delete round record
            workflow.logger.error(f"Round generation failed: {str(e)}")

            try:
                await workflow.execute_activity(
                    delete_round_record,
                    args=[round_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=3)
                )
                workflow.logger.info(f"Deleted round {round_id} due to failure")
            except Exception as delete_error:
                workflow.logger.error(f"Failed to delete round {round_id}: {str(delete_error)}")

            raise

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current progress."""
        return {
            "total_items": self.total_items,
            "selected_count": self.selected_count,
        }
