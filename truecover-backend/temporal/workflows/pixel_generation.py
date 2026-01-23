# ABOUTME: DEPRECATED - Pixels are now global, not per-campaign
# ABOUTME: This workflow is kept for reference but should not be used

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any, List

with workflow.unsafe.imports_passed_through():
    from ..activities.pixels import (
        convert_geojson_to_wkt,
        fetch_admin_boundary_geometry,
        delete_existing_pixels,
        generate_and_insert_tiles,
        create_default_coverage_pixels_for_area,
    )


@workflow.defn
class PixelGenerationWorkflow:
    """
    Workflow for generating quadkey pixels for an area.

    Steps:
    1. Fetch admin boundary geometry (if provided)
    2. Delete existing pixels (if not appending)
    3. Generate tile data
    4. Insert pixels in batches
    5. Create default coverage_pixel records
    """

    def __init__(self):
        self.total_tiles = 0
        self.pixels_inserted = 0

    @workflow.run
    async def run(
        self,
        campaign_id: str,
        bbox: List[float],
        level: int,
        append: bool = False,
        admin_pcode: str = None,
        geometry: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Run pixel generation workflow.

        Args:
            campaign_id: Area ID
            bbox: [min_lng, min_lat, max_lng, max_lat]
            level: Zoom level (0-24)
            append: If True, add to existing pixels instead of replacing
            admin_pcode: Optional admin boundary code for filtering

        Returns:
            Result summary with pixel count
        """
        workflow.logger.info(f"Starting pixel generation for area {campaign_id}, level {level}")

        # Activity 1: Fetch admin boundary geometry (if provided) or convert drawn geometry
        admin_geometry_wkt = None
        if geometry:
            # Convert GeoJSON geometry to WKT for drawn areas
            geometry_data = await workflow.execute_activity(
                convert_geojson_to_wkt,
                args=[geometry],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
            admin_geometry_wkt = geometry_data['wkt']
            workflow.logger.info(f"Converted drawn geometry to WKT")
        elif admin_pcode:
            admin_geometry_wkt = await workflow.execute_activity(
                fetch_admin_boundary_geometry,
                args=[admin_pcode],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
            workflow.logger.info(f"Fetched admin boundary geometry for {admin_pcode}")

        # Activity 2: Delete existing pixels (if not appending)
        if not append:
            deleted_count = await workflow.execute_activity(
                delete_existing_pixels,
                args=[campaign_id],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
            workflow.logger.info(f"Deleted {deleted_count} existing pixels")

        # Activity 3: Generate tiles and insert directly into database
        # This combined activity avoids passing large tile data through Temporal's payload
        result = await workflow.execute_activity(
            generate_and_insert_tiles,
            args=[campaign_id, bbox, level, admin_geometry_wkt],
            start_to_close_timeout=timedelta(minutes=30),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.total_tiles = result["total_generated"]
        self.pixels_inserted = result["total_inserted"]
        workflow.logger.info(f"Generated {self.total_tiles} tiles, inserted {self.pixels_inserted}")

        if self.pixels_inserted == 0:
            workflow.logger.warning("No pixels inserted")
            return {
                "success": True,
                "count": 0,
                "level": level
            }

        # Activity 4: Create default coverage_pixel records
        total_coverage_created = await workflow.execute_activity(
            create_default_coverage_pixels_for_area,
            args=[campaign_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        workflow.logger.info(f"Created {total_coverage_created} coverage_pixel records")

        return {
            "success": True,
            "count": self.pixels_inserted,
            "level": level,
            "coverage_pixels_created": total_coverage_created
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current progress."""
        return {
            "total_tiles": self.total_tiles,
            "pixels_inserted": self.pixels_inserted,
        }
