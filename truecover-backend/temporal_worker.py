# ABOUTME: Temporal worker entry point
# ABOUTME: Registers workflows and activities, starts worker process

import asyncio
import logging
import os
from temporalio.client import Client
from temporalio.worker import Worker

# Import workflows
from temporal.workflows.location_upload import LocationUploadWorkflow

# Import activities
from temporal.activities import locations


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    """Start Temporal worker."""
    # Connect to Temporal server
    temporal_host = os.getenv("TEMPORAL_HOST", "localhost:7233")
    logger.info(f"Connecting to Temporal server at {temporal_host}")

    client = await Client.connect(temporal_host)

    # Create worker
    worker = Worker(
        client,
        task_queue="truecover-tasks",
        workflows=[
            LocationUploadWorkflow,
        ],
        activities=[
            locations.parse_location_file,
            locations.process_location_batch,
            locations.populate_coverage_for_locations,
            locations.generate_pixels_for_quadkeys,
            locations.create_coverage_pixel_records,
        ],
    )

    logger.info("Starting Temporal worker on task queue 'truecover-tasks'")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
