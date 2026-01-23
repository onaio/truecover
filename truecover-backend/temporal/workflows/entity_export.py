# ABOUTME: Temporal workflow for exporting pixel coverage data to ODK entity lists
# ABOUTME: Orchestrates fetching pixel data and creating entities via Ona API

from datetime import timedelta
from typing import Any, Dict, List

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..activities.entity_export import (
        fetch_pixel_coverage_activity,
        create_odk_entity_activity
    )


@workflow.defn
class EntityExportWorkflow:
    """
    Workflow for exporting pixel coverage data to ODK entity lists.

    Steps:
    1. Fetch pixel coverage data filtered by selected rounds
    2. Create ODK entity for each pixel (stops on first error)
    """

    def __init__(self):
        self.total_pixels = 0
        self.created_pixels = 0
        self.current_quadkey = ""
        self.error_message = None

    @workflow.run
    async def run(
        self,
        campaign_id: str,
        indicator_id: str,
        round_ids: List[str],
        project_id: str,
        geometry_type: str = 'centroid'
    ) -> Dict[str, Any]:
        """
        Run entity export workflow.

        Args:
            campaign_id: Area ID
            indicator_id: Indicator ID
            round_ids: List of round IDs to filter by
            project_id: Project ID for ODK credentials

        Returns:
            Result summary with counts

        Raises:
            Exception if any entity creation fails
        """
        workflow.logger.info(f"Starting entity export for area {campaign_id}")

        # Fetch pixel coverage data
        pixels = await workflow.execute_activity(
            fetch_pixel_coverage_activity,
            args=[campaign_id, indicator_id, round_ids],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.total_pixels = len(pixels)
        workflow.logger.info(f"Found {self.total_pixels} pixels to export")

        if self.total_pixels == 0:
            return {
                "success": True,
                "total_pixels": 0,
                "created_pixels": 0,
                "message": "No pixels found for selected rounds"
            }

        # Create ODK entity for each pixel
        # Stop immediately on first error (no retry policy)
        for pixel in pixels:
            self.current_quadkey = pixel['quadkey']
            workflow.logger.info(f"Creating entity for pixel {self.current_quadkey}")

            try:
                result = await workflow.execute_activity(
                    create_odk_entity_activity,
                    args=[project_id, pixel, geometry_type],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=1)
                )

                self.created_pixels += 1
                workflow.logger.info(
                    f"Created entity {self.created_pixels}/{self.total_pixels}: "
                    f"{result['quadkey']}"
                )

            except Exception as e:
                # Stop on first error
                error_msg = f"Failed to create entity for pixel {self.current_quadkey}: {str(e)}"
                self.error_message = error_msg
                workflow.logger.error(error_msg)
                raise Exception(error_msg)

        workflow.logger.info(
            f"Entity export complete: {self.created_pixels} entities created"
        )

        return {
            "success": True,
            "total_pixels": self.total_pixels,
            "created_pixels": self.created_pixels,
            "message": f"Successfully created {self.created_pixels} entities in ODK"
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current workflow progress."""
        return {
            "total_pixels": self.total_pixels,
            "created_pixels": self.created_pixels,
            "current_quadkey": self.current_quadkey,
            "error_message": self.error_message
        }
