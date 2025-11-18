# ABOUTME: Temporal workflow for importing buildings from Overture Maps
# ABOUTME: Orchestrates DuckDB queries, location processing, pixel generation, and coverage creation

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Dict, Any

with workflow.unsafe.imports_passed_through():
    from ..activities.overture import (
        fetch_admin_boundary,
        fetch_overture_buildings_batch,
        process_overture_buildings_batch,
    )
    from ..activities.locations import (
        populate_coverage_for_locations,
        generate_pixels_for_quadkeys,
        create_coverage_pixel_records,
    )


@workflow.defn
class OvertureImportWorkflow:
    """
    Workflow for importing Overture Maps buildings.

    Steps:
    1. Fetch admin boundary bbox and geometry
    2. Fetch buildings from Overture Maps in batches via DuckDB
    3. Process each batch (insert/update with deduplication)
    4. Populate coverage records for new locations
    5. Auto-generate pixels for new quadkeys
    6. Create coverage_pixel records for new pixels
    """

    def __init__(self):
        self.total_fetched = 0
        self.total_inserted = 0
        self.total_duplicates = 0
        self.batches_processed = 0

    @workflow.run
    async def run(
        self,
        pcode: str,
        area_id: str
    ) -> Dict[str, Any]:
        """
        Run Overture Maps building import workflow.

        Args:
            pcode: Admin boundary PCODE
            area_id: Area ID

        Returns:
            Result summary with counts
        """
        # Activity 1: Fetch admin boundary
        boundary_data = await workflow.execute_activity(
            fetch_admin_boundary,
            args=[pcode],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        bbox = tuple(boundary_data['bbox'])
        boundary_wkt = boundary_data['boundary_wkt']

        workflow.logger.info(f"Fetched boundary for {pcode}")

        # Fetch and process buildings in batches
        batch_size = 5000
        offset = 0
        all_new_location_ids = []

        workflow.logger.info(f"Starting batch import from Overture Maps (batch_size={batch_size})")

        while True:
            # Activity 2: Fetch batch of buildings from Overture
            workflow.logger.info(f"Fetching batch {self.batches_processed + 1} (offset={offset})")
            buildings_batch = await workflow.execute_activity(
                fetch_overture_buildings_batch,
                args=[bbox, boundary_wkt, offset, batch_size],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            # If no buildings returned, we're done
            if not buildings_batch:
                workflow.logger.info("No more buildings to fetch")
                break

            self.total_fetched += len(buildings_batch)
            workflow.logger.info(f"Fetched {len(buildings_batch)} buildings (total: {self.total_fetched})")

            # Activity 3: Process batch (insert locations)
            result = await workflow.execute_activity(
                process_overture_buildings_batch,
                args=[area_id, buildings_batch],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            self.total_inserted += result['inserted']
            self.total_duplicates += result['duplicates']
            all_new_location_ids.extend(result['new_location_ids'])
            self.batches_processed += 1

            workflow.logger.info(
                f"Batch {self.batches_processed} complete: "
                f"fetched={len(buildings_batch)}, inserted={result['inserted']}, duplicates={result['duplicates']}"
            )

            # If we got fewer buildings than batch_size, we're done
            if len(buildings_batch) < batch_size:
                workflow.logger.info("Reached end of buildings (partial batch)")
                break

            offset += batch_size

        # Activity 4: Populate coverage for new locations
        if all_new_location_ids:
            workflow.logger.info(f"Populating coverage for {len(all_new_location_ids)} new locations")
            await workflow.execute_activity(
                populate_coverage_for_locations,
                args=[area_id, all_new_location_ids],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

        # Activity 5: Auto-generate pixels for new quadkeys
        new_quadkeys = []
        if self.total_inserted > 0:
            workflow.logger.info("Auto-generating pixels for imported buildings")
            pixel_result = await workflow.execute_activity(
                generate_pixels_for_quadkeys,
                args=[area_id],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
            new_quadkeys = pixel_result['new_quadkeys']

        # Activity 6: Create coverage_pixel records for new pixels
        if new_quadkeys:
            workflow.logger.info(f"Creating coverage_pixel records for {len(new_quadkeys)} pixels")
            await workflow.execute_activity(
                create_coverage_pixel_records,
                args=[area_id, new_quadkeys],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

        return {
            'success': True,
            'inserted': self.total_inserted,
            'duplicates': self.total_duplicates,
            'pixels_created': len(new_quadkeys),
            'total_fetched': self.total_fetched,
            'batches_processed': self.batches_processed
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current progress."""
        return {
            'total_fetched': self.total_fetched,
            'total_inserted': self.total_inserted,
            'total_duplicates': self.total_duplicates,
            'batches_processed': self.batches_processed,
        }
