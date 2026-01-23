# ABOUTME: Temporal workflow for uploading and processing location files
# ABOUTME: Orchestrates parsing GeoJSON/CSV, inserting locations, generating pixels, and creating coverage records

from datetime import timedelta
from typing import Any, Dict, List

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..activities.locations import (
        create_coverage_pixel_records,
        generate_pixels_for_quadkeys,
        parse_location_file,
        populate_coverage_for_locations,
        process_location_batch,
    )


@workflow.defn
class LocationUploadWorkflow:
    """
    Workflow for processing location file uploads.

    Steps:
    1. Parse uploaded file (GeoJSON or CSV)
    2. Process locations in batches (insert/update with deduplication)
    3. Populate coverage records for new locations
    4. Auto-generate pixels for new quadkeys
    5. Create coverage_pixel records for new pixels
    """

    def __init__(self):
        self.total_features = 0
        self.processed_features = 0
        self.inserted_count = 0
        self.updated_count = 0
        self.error_count = 0

    @workflow.run
    async def run(
        self, campaign_id: str, file_path: str, file_type: str, config: Dict[str, str]
    ) -> Dict[str, Any]:
        """
        Run location upload workflow.

        Args:
            campaign_id: Area ID
            file_path: Path to uploaded file (temporary storage)
            file_type: Type of file ('geojson' or 'csv')
            config: Upload configuration (column mappings, etc.)

        Returns:
            Result summary with counts
        """
        # Activity 1: Parse uploaded file
        features = await workflow.execute_activity(
            parse_location_file,
            args=[file_path, file_type, config],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        self.total_features = len(features)
        workflow.logger.info(f"Parsed {len(features)} features from file")

        # Activity 2: Process locations in batches
        batch_size = 250
        new_location_ids = []
        errors = []

        for i in range(0, len(features), batch_size):
            batch = features[i : i + batch_size]
            batch_num = i // batch_size + 1
            total_batches = (len(features) + batch_size - 1) // batch_size

            workflow.logger.info(f"Processing batch {batch_num}/{total_batches}")

            result = await workflow.execute_activity(
                process_location_batch,
                args=[campaign_id, batch],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

            # Accumulate results
            self.inserted_count += result["inserted"]
            self.updated_count += result["updated"]
            new_location_ids.extend(result["new_location_ids"])
            errors.extend(result["errors"])
            self.processed_features = min(i + batch_size, len(features))

        self.error_count = len(errors)

        # Activity 3: Populate coverage for new locations
        if new_location_ids:
            workflow.logger.info(
                f"Populating coverage for {len(new_location_ids)} new locations"
            )
            await workflow.execute_activity(
                populate_coverage_for_locations,
                args=[campaign_id, new_location_ids],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

        # Activity 4: Auto-generate pixels for new quadkeys
        new_quadkeys = []
        if self.inserted_count > 0:
            workflow.logger.info("Auto-generating pixels for uploaded locations")
            pixel_result = await workflow.execute_activity(
                generate_pixels_for_quadkeys,
                args=[campaign_id],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
            new_quadkeys = pixel_result["new_quadkeys"]

        # Activity 5: Create coverage_pixel records for new pixels
        if new_quadkeys:
            workflow.logger.info(
                f"Creating coverage_pixel records for {len(new_quadkeys)} pixels"
            )
            await workflow.execute_activity(
                create_coverage_pixel_records,
                args=[campaign_id, new_quadkeys],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

        return {
            "success": True,
            "inserted": self.inserted_count,
            "updated": self.updated_count,
            "pixels_created": len(new_quadkeys),
            "errors": errors,
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current progress."""
        return {
            "total_features": self.total_features,
            "processed_features": self.processed_features,
            "inserted_count": self.inserted_count,
            "updated_count": self.updated_count,
            "error_count": self.error_count,
        }
