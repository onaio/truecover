# ABOUTME: Temporal workflow for pixel generation
# ABOUTME: Orchestrates generating quadkey pixels for an area with optional admin boundary filtering

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any, List

with workflow.unsafe.imports_passed_through():
    from ..activities.pixels import (
        convert_geojson_to_wkt,
        fetch_admin_boundary_geometry,
        delete_existing_pixels,
        generate_tile_data,
        insert_pixel_batch,
        create_default_coverage_pixels_for_batch,
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
        area_id: str,
        bbox: List[float],
        level: int,
        append: bool = False,
        admin_pcode: str = None,
        geometry: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Run pixel generation workflow.

        Args:
            area_id: Area ID
            bbox: [min_lng, min_lat, max_lng, max_lat]
            level: Zoom level (0-24)
            append: If True, add to existing pixels instead of replacing
            admin_pcode: Optional admin boundary code for filtering

        Returns:
            Result summary with pixel count
        """
        workflow.logger.info(f"Starting pixel generation for area {area_id}, level {level}")

        # Activity 1: Fetch admin boundary geometry (if provided) or convert drawn geometry
        admin_geometry_wkt = None
        if geometry:
            # Convert GeoJSON geometry to WKT for drawn areas
            admin_geometry_wkt = await workflow.execute_activity(
                convert_geojson_to_wkt,
                args=[geometry],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
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
                args=[area_id],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
            workflow.logger.info(f"Deleted {deleted_count} existing pixels")

        # Activity 3: Generate tile data
        tile_data = await workflow.execute_activity(
            generate_tile_data,
            args=[bbox, level, admin_geometry_wkt],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.total_tiles = len(tile_data)
        workflow.logger.info(f"Generated {self.total_tiles} tiles")

        if not tile_data:
            workflow.logger.warning("No tiles generated")
            return {
                "success": True,
                "count": 0,
                "level": level
            }

        # Activity 4: Insert pixels in batches
        batch_size = 500
        total_inserted = 0
        all_quadkeys = []

        for i in range(0, len(tile_data), batch_size):
            batch = tile_data[i:i+batch_size]
            batch_num = i // batch_size + 1
            total_batches = (len(tile_data) + batch_size - 1) // batch_size

            workflow.logger.info(f"Inserting batch {batch_num}/{total_batches}")

            inserted = await workflow.execute_activity(
                insert_pixel_batch,
                args=[area_id, batch],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            total_inserted += inserted
            all_quadkeys.extend([tile["quadkey"] for tile in batch])
            self.pixels_inserted = total_inserted

        workflow.logger.info(f"Inserted {total_inserted} pixels total")

        # Activity 5: Create default coverage_pixel records in batches
        coverage_batch_size = 1000
        total_coverage_created = 0

        for i in range(0, len(all_quadkeys), coverage_batch_size):
            batch_quadkeys = all_quadkeys[i:i+coverage_batch_size]
            batch_num = i // coverage_batch_size + 1
            total_batches = (len(all_quadkeys) + coverage_batch_size - 1) // coverage_batch_size

            workflow.logger.info(f"Creating coverage_pixel records batch {batch_num}/{total_batches}")

            created = await workflow.execute_activity(
                create_default_coverage_pixels_for_batch,
                args=[area_id, batch_quadkeys],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            total_coverage_created += created

        workflow.logger.info(f"Created {total_coverage_created} coverage_pixel records")

        return {
            "success": True,
            "count": total_inserted,
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
