# ABOUTME: Temporal workflow for coverage prediction
# ABOUTME: Orchestrates calling prevalence predictor and updating database for locations and pixels

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any

with workflow.unsafe.imports_passed_through():
    from ..activities.coverage import (
        fetch_location_coverage,
        predict_location_coverage,
        update_location_coverage,
        fetch_pixel_coverage,
        predict_pixel_coverage,
        update_pixel_coverage,
    )


@workflow.defn
class CoveragePredictionWorkflow:
    """
    Workflow for predicting coverage for locations and pixels.

    Steps:
    1. Fetch location coverage records
    2. Call prevalence predictor for locations
    3. Update location coverage records with predictions
    4. Fetch pixel coverage records
    5. Call prevalence predictor for pixels
    6. Update pixel coverage records with predictions
    """

    def __init__(self):
        self.locations_total = 0
        self.locations_processed = 0
        self.pixels_total = 0
        self.pixels_processed = 0

    @workflow.run
    async def run(self, area_id: str, indicator_id: str) -> Dict[str, Any]:
        """
        Run coverage prediction for locations and pixels.

        Args:
            area_id: Area ID
            indicator_id: Indicator ID

        Returns:
            Result summary with counts
        """
        workflow.logger.info(f"Starting coverage prediction for area {area_id}, indicator {indicator_id}")

        # Activity 1: Fetch location coverage records
        locations = await workflow.execute_activity(
            fetch_location_coverage,
            args=[area_id, indicator_id],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.locations_total = len(locations)
        workflow.logger.info(f"Fetched {self.locations_total} location coverage records")

        locations_updated = 0
        if locations:
            # Activity 2: Predict location coverage
            location_results = await workflow.execute_activity(
                predict_location_coverage,
                args=[locations],
                start_to_close_timeout=timedelta(minutes=20),  # Allow 20 min for prediction
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=1),
                    maximum_interval=timedelta(minutes=1),
                    maximum_attempts=3
                )
            )

            workflow.logger.info(f"Received predictions for {len(location_results)} locations")

            # Activity 3: Update location coverage
            locations_updated = await workflow.execute_activity(
                update_location_coverage,
                args=[location_results, area_id, indicator_id],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            self.locations_processed = locations_updated
            workflow.logger.info(f"Updated {locations_updated} location coverage records")

        # Activity 4: Fetch pixel coverage records
        pixels = await workflow.execute_activity(
            fetch_pixel_coverage,
            args=[area_id, indicator_id],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.pixels_total = len(pixels)
        workflow.logger.info(f"Fetched {self.pixels_total} pixel coverage records")

        pixels_updated = 0
        if pixels:
            # Activity 5: Predict pixel coverage
            pixel_results = await workflow.execute_activity(
                predict_pixel_coverage,
                args=[pixels],
                start_to_close_timeout=timedelta(minutes=20),  # Allow 20 min for prediction
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=1),
                    maximum_interval=timedelta(minutes=1),
                    maximum_attempts=3
                )
            )

            workflow.logger.info(f"Received predictions for {len(pixel_results)} pixels")

            # Activity 6: Update pixel coverage
            pixels_updated = await workflow.execute_activity(
                update_pixel_coverage,
                args=[pixel_results],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            self.pixels_processed = pixels_updated
            workflow.logger.info(f"Updated {pixels_updated} pixel coverage records")

        workflow.logger.info(
            f"Coverage prediction complete: {locations_updated} locations, {pixels_updated} pixels updated"
        )

        return {
            "success": True,
            "locations_updated": locations_updated,
            "pixels_updated": pixels_updated,
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current progress."""
        return {
            "locations_total": self.locations_total,
            "locations_processed": self.locations_processed,
            "pixels_total": self.pixels_total,
            "pixels_processed": self.pixels_processed,
        }
