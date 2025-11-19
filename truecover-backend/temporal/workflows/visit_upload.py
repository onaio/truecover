# ABOUTME: Temporal workflow for processing bulk visit uploads
# ABOUTME: Orchestrates matching locations, updating coverage, and aggregating pixel data

from datetime import timedelta
from typing import Any, Dict, List

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..activities.visits import process_visit_batch, update_coverage_pixel_aggregates


@workflow.defn
class VisitUploadWorkflow:
    """
    Workflow for processing bulk visit uploads.

    Steps:
    1. Process visits in batches (match/create locations, update coverage)
    2. Aggregate coverage_pixel data for affected quadkeys
    """

    def __init__(self):
        self.total_visits = 0
        self.processed_visits = 0
        self.matched_by_id = 0
        self.matched_by_proximity = 0
        self.new_locations = 0
        self.error_count = 0

    @workflow.run
    async def run(
        self,
        area_id: str,
        indicator_id: str,
        round_id: str,
        visits: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Run visit upload workflow.

        Args:
            area_id: Area ID
            indicator_id: Indicator ID
            round_id: Round ID
            visits: List of visit data

        Returns:
            Result summary with counts
        """
        self.total_visits = len(visits)
        workflow.logger.info(f"Processing {len(visits)} visits")

        # Process visits in batches
        batch_size = 250
        all_affected_quadkeys = set()
        errors = []

        for i in range(0, len(visits), batch_size):
            batch = visits[i : i + batch_size]
            batch_num = i // batch_size + 1
            total_batches = (len(visits) + batch_size - 1) // batch_size

            workflow.logger.info(f"Processing batch {batch_num}/{total_batches}")

            result = await workflow.execute_activity(
                process_visit_batch,
                args=[area_id, indicator_id, round_id, batch],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

            # Accumulate results
            self.matched_by_id += result["matched_by_id"]
            self.matched_by_proximity += result["matched_by_proximity"]
            self.new_locations += result["new_locations"]
            all_affected_quadkeys.update(result["affected_quadkeys"])
            errors.extend(result["errors"])
            self.processed_visits = min(i + batch_size, len(visits))

        self.error_count = len(errors)

        # Update coverage_pixel aggregates
        if all_affected_quadkeys:
            workflow.logger.info(
                f"Updating coverage_pixel for {len(all_affected_quadkeys)} quadkeys"
            )
            await workflow.execute_activity(
                update_coverage_pixel_aggregates,
                args=[area_id, indicator_id, list(all_affected_quadkeys)],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

        workflow.logger.info(
            f"Visit upload complete: {self.processed_visits} visits processed, "
            f"{self.matched_by_id} matched by ID, "
            f"{self.matched_by_proximity} matched by proximity, "
            f"{self.new_locations} new locations, "
            f"{self.error_count} errors"
        )

        return {
            "success": True,
            "total_visits": self.total_visits,
            "processed_visits": self.processed_visits,
            "matched_by_id": self.matched_by_id,
            "matched_by_proximity": self.matched_by_proximity,
            "new_locations": self.new_locations,
            "error_count": self.error_count,
            "errors": errors[:100]  # Limit errors to avoid huge payloads
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current workflow progress."""
        return {
            "total_visits": self.total_visits,
            "processed_visits": self.processed_visits,
            "matched_by_id": self.matched_by_id,
            "matched_by_proximity": self.matched_by_proximity,
            "new_locations": self.new_locations,
            "error_count": self.error_count
        }
