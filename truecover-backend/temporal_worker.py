# ABOUTME: Temporal worker entry point
# ABOUTME: Registers workflows and activities, starts worker process

import asyncio
import logging
import os
from temporalio.client import Client
from temporalio.worker import Worker

# Import workflows
from temporal.workflows.location_upload import LocationUploadWorkflow
from temporal.workflows.overture_import import OvertureImportWorkflow

# Import activities
from temporal.activities import locations, overture


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def discover_activities(module):
    """Auto-discover all @activity.defn decorated functions in a module."""
    activities = []
    for name in dir(module):
        if name.startswith('_'):
            continue
        obj = getattr(module, name)
        if callable(obj) and hasattr(obj, '__temporal_activity_definition'):
            activities.append(obj)
            logger.info(f"Discovered activity: {name}")
    return activities


def discover_workflows(module):
    """Auto-discover all @workflow.defn decorated classes in a module."""
    workflows = []
    for name in dir(module):
        if name.startswith('_'):
            continue
        obj = getattr(module, name)
        if hasattr(obj, '__temporal_workflow_class'):
            workflows.append(obj)
            logger.info(f"Discovered workflow: {name}")
    return workflows


async def main():
    """Start Temporal worker."""
    # Connect to Temporal server
    temporal_host = os.getenv("TEMPORAL_HOST", "localhost:7233")
    logger.info(f"Connecting to Temporal server at {temporal_host}")

    client = await Client.connect(temporal_host)

    # Auto-discover all activities from activity modules
    all_activities = [
        *discover_activities(locations),
        *discover_activities(overture),
    ]

    logger.info(f"Registered {len(all_activities)} activities")

    # Create worker
    worker = Worker(
        client,
        task_queue="truecover-tasks",
        workflows=[
            LocationUploadWorkflow,
            OvertureImportWorkflow,
        ],
        activities=all_activities,
    )

    logger.info("Starting Temporal worker on task queue 'truecover-tasks'")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
