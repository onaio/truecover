# ABOUTME: Temporal workflow for importing buildings from Overture Maps
# ABOUTME: Orchestrates DuckDB queries, location processing, pixel generation, and coverage creation

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any

with workflow.unsafe.imports_passed_through():
    from ..activities.overture import (
        fetch_admin_boundary,
        fetch_and_insert_overture_buildings,
        update_campaign_area_building_counts,
    )
    from ..activities.locations import (
        populate_coverage_for_locations,
        generate_pixels_for_quadkeys,
        create_coverage_pixel_records,
    )
    from ..activities.pixels import convert_geojson_to_wkt


@workflow.defn
class OvertureImportWorkflow:
    """
    Workflow for importing Overture Maps buildings.

    Steps:
    1. Fetch admin boundary bbox and geometry
    2. Fetch and insert buildings directly (DuckDB -> PostgreSQL, no Temporal serialization)
    3. Populate coverage records for new locations
    4. Auto-generate pixels for new quadkeys
    5. Create coverage_pixel records for new pixels
    """

    def __init__(self):
        self.total_fetched = 0
        self.total_inserted = 0
        self.total_duplicates = 0
        self.status = 'initializing'

    @workflow.run
    async def run(
        self,
        pcode: str,
        campaign_id: str,
        geometry: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Run Overture Maps building import workflow.

        Args:
            pcode: Admin boundary PCODE
            campaign_id: Campaign ID
            geometry: Optional GeoJSON geometry for drawn areas

        Returns:
            Result summary with counts
        """
        # Activity 1: Get boundary geometry (from drawn shape or admin boundary)
        self.status = 'fetching_boundary'
        if geometry:
            # Convert GeoJSON geometry to WKT for drawn areas
            geometry_data = await workflow.execute_activity(
                convert_geojson_to_wkt,
                args=[geometry],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            boundary_wkt = geometry_data['wkt']
            bbox = tuple(geometry_data['bbox'])

            workflow.logger.info(f"Converted drawn geometry to WKT")
        else:
            # Fetch admin boundary
            boundary_data = await workflow.execute_activity(
                fetch_admin_boundary,
                args=[pcode],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            bbox = tuple(boundary_data['bbox'])
            boundary_wkt = boundary_data['boundary_wkt']

            workflow.logger.info(f"Fetched boundary for {pcode}")

        # Activity 2: Fetch and insert buildings directly (bypasses Temporal serialization)
        self.status = 'importing_buildings'
        workflow.logger.info("Starting building import (direct DuckDB -> PostgreSQL)")

        import_result = await workflow.execute_activity(
            fetch_and_insert_overture_buildings,
            args=[campaign_id, bbox, boundary_wkt],
            start_to_close_timeout=timedelta(minutes=30),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.total_fetched = import_result['total_fetched']
        self.total_inserted = import_result['inserted']
        self.total_duplicates = import_result['duplicates']
        all_new_location_ids = import_result['new_location_ids']
        all_existing_location_ids = import_result.get('existing_location_ids', [])

        workflow.logger.info(
            f"Import complete: fetched={self.total_fetched}, "
            f"inserted={self.total_inserted}, duplicates={self.total_duplicates}"
        )

        # Activity 3: Populate coverage for all locations in this campaign
        # Both new and existing (duplicate) buildings need coverage entries
        all_location_ids = all_new_location_ids + all_existing_location_ids
        if all_location_ids:
            self.status = 'populating_coverage'
            workflow.logger.info(f"Populating coverage for {len(all_location_ids)} locations ({len(all_new_location_ids)} new, {len(all_existing_location_ids)} existing)")
            await workflow.execute_activity(
                populate_coverage_for_locations,
                args=[campaign_id, all_location_ids],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

        # Activity 4: Auto-generate pixels for quadkeys
        self.status = 'generating_pixels'
        workflow.logger.info("Auto-generating pixels for imported buildings")
        pixel_result = await workflow.execute_activity(
            generate_pixels_for_quadkeys,
            args=[campaign_id],
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )
        new_quadkeys = pixel_result['new_quadkeys']

        # Activity 5: Create coverage_pixel records for new pixels
        if new_quadkeys:
            self.status = 'creating_coverage_pixels'
            workflow.logger.info(f"Creating coverage_pixel records for {len(new_quadkeys)} pixels")
            await workflow.execute_activity(
                create_coverage_pixel_records,
                args=[campaign_id, new_quadkeys],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

        # Activity 6: Update campaign area building counts
        self.status = 'updating_building_counts'
        workflow.logger.info("Updating campaign area building counts")
        await workflow.execute_activity(
            update_campaign_area_building_counts,
            args=[campaign_id],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.status = 'completed'
        return {
            'success': True,
            'inserted': self.total_inserted,
            'duplicates': self.total_duplicates,
            'pixels_created': len(new_quadkeys),
            'total_fetched': self.total_fetched
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current progress."""
        return {
            'status': self.status,
            'total_fetched': self.total_fetched,
            'total_inserted': self.total_inserted,
            'total_duplicates': self.total_duplicates,
        }
