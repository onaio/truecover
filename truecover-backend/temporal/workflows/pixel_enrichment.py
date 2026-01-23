# ABOUTME: Temporal workflow for pixel enrichment
# ABOUTME: Orchestrates COG download, raster statistics extraction, and metadata updates

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any

with workflow.unsafe.imports_passed_through():
    from ..activities.enrichment import (
        fetch_enrichment_job,
        fetch_cog_url,
        download_cog,
        enrich_area_pixels,
        update_job_progress,
        mark_job_completed,
        mark_job_failed,
    )


@workflow.defn
class PixelEnrichmentWorkflow:
    """
    Workflow for enriching pixels with COG raster statistics.

    Steps:
    1. Fetch enrichment job details
    2. Fetch COG URL from STAC or direct URL
    3. Download and cache COG file
    4. Fetch pixels for the area
    5. Process pixels in batches
    6. Update pixel_metadata table
    7. Mark job as completed
    """

    def __init__(self):
        self.pixels_total = 0
        self.pixels_processed = 0

    @workflow.run
    async def run(self, job_id: str) -> Dict[str, Any]:
        """
        Run pixel enrichment workflow.

        Args:
            job_id: Enrichment job ID

        Returns:
            Result summary with counts
        """
        workflow.logger.info(f"Starting pixel enrichment for job {job_id}")

        try:
            # Activity 1: Fetch job details
            job_details = await workflow.execute_activity(
                fetch_enrichment_job,
                args=[job_id],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            area_id = job_details["area_id"]
            statistic = job_details["statistic"]
            metadata_field_name = job_details["metadata_field_name"]
            metadata_field_description = job_details["metadata_field_description"]
            metadata_field_type = job_details["metadata_field_type"]
            metadata_field_unit = job_details["metadata_field_unit"]

            workflow.logger.info(f"Job details: area={area_id}, statistic={statistic}")

            # Activity 2: Fetch COG URL
            cog_url = await workflow.execute_activity(
                fetch_cog_url,
                args=[job_details],
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            workflow.logger.info(f"COG URL: {cog_url}")

            # Activity 3: Download COG
            cog_path = await workflow.execute_activity(
                download_cog,
                args=[cog_url],
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(seconds=2),
                    maximum_attempts=3
                )
            )

            workflow.logger.info(f"COG downloaded to: {cog_path}")

            # Activity 4: Fetch, enrich, and update all pixels
            # This combined activity handles batching internally to avoid payload limits
            result = await workflow.execute_activity(
                enrich_area_pixels,
                args=[
                    area_id,
                    cog_path,
                    statistic,
                    metadata_field_name,
                    metadata_field_description,
                    metadata_field_type,
                    metadata_field_unit
                ],
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            self.pixels_total = result["pixels_total"]
            self.pixels_processed = result["pixels_total"]
            total_updated = result["pixels_updated"]

            workflow.logger.info(f"Enrichment complete: {total_updated}/{self.pixels_total} pixels updated")

            # Update final progress
            await workflow.execute_activity(
                update_job_progress,
                args=[job_id, self.pixels_processed],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            # Activity 5: Mark job as completed
            await workflow.execute_activity(
                mark_job_completed,
                args=[job_id],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            workflow.logger.info(f"Enrichment complete: {total_updated} pixels updated")

            return {
                "success": True,
                "pixels_processed": self.pixels_processed,
                "pixels_updated": total_updated,
            }

        except Exception as e:
            # Mark job as failed
            workflow.logger.error(f"Enrichment failed: {str(e)}")

            try:
                await workflow.execute_activity(
                    mark_job_failed,
                    args=[job_id, str(e)],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=3)
                )
            except Exception as mark_error:
                workflow.logger.error(f"Failed to mark job as failed: {str(mark_error)}")

            raise

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current progress."""
        return {
            "pixels_total": self.pixels_total,
            "pixels_processed": self.pixels_processed,
        }
