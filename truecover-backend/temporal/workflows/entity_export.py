# ABOUTME: Temporal workflow for exporting coverage data to ODK entity lists
# ABOUTME: Orchestrates fetching pixel/location data and creating entities via Ona API

from datetime import timedelta
from typing import Any, Dict, List

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..activities.entity_export import (
        fetch_pixel_coverage_activity,
        fetch_location_coverage_activity,
        create_odk_entity_activity
    )


@workflow.defn
class EntityExportWorkflow:
    """
    Workflow for exporting coverage data (pixels and locations) to ODK entity lists.

    Steps:
    1. Fetch pixel and/or location coverage data filtered by selected rounds
    2. Create ODK entity for each item (stops on first error)
    """

    def __init__(self):
        self.total_entities = 0
        self.created_entities = 0
        self.current_label = ""
        self.error_message = None

    @workflow.run
    async def run(
        self,
        campaign_id: str,
        indicator_id: str,
        pixel_round_ids: List[str],
        location_round_ids: List[str],
        project_id: str,
        geometry_type: str = 'centroid'
    ) -> Dict[str, Any]:
        workflow.logger.info(f"Starting entity export for campaign {campaign_id}")

        entities = []

        # Fetch pixel coverage data if pixel rounds selected
        if pixel_round_ids:
            pixels = await workflow.execute_activity(
                fetch_pixel_coverage_activity,
                args=[campaign_id, indicator_id, pixel_round_ids],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
            for p in pixels:
                p['entity_type'] = 'pixel'
            entities.extend(pixels)
            workflow.logger.info(f"Found {len(pixels)} pixels to export")

        # Fetch location coverage data if location rounds selected
        if location_round_ids:
            locations = await workflow.execute_activity(
                fetch_location_coverage_activity,
                args=[campaign_id, indicator_id, location_round_ids],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )
            for loc in locations:
                loc['entity_type'] = 'location'
            entities.extend(locations)
            workflow.logger.info(f"Found {len(locations)} locations to export")

        self.total_entities = len(entities)

        if self.total_entities == 0:
            return {
                "success": True,
                "total_entities": 0,
                "created_entities": 0,
                "message": "No entities found for selected rounds"
            }

        # Create ODK entity for each item
        # Stop immediately on first error
        for entity in entities:
            entity_type = entity['entity_type']
            label = entity.get('external_id') if entity_type == 'location' else entity.get('quadkey')
            self.current_label = label or ''
            workflow.logger.info(f"Creating {entity_type} entity: {self.current_label}")

            try:
                result = await workflow.execute_activity(
                    create_odk_entity_activity,
                    args=[project_id, entity, geometry_type, entity_type],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=1)
                )

                self.created_entities += 1
                workflow.logger.info(
                    f"Created entity {self.created_entities}/{self.total_entities}: "
                    f"{result['label']}"
                )

            except Exception as e:
                error_msg = f"Failed to create {entity_type} entity {self.current_label}: {str(e)}"
                self.error_message = error_msg
                workflow.logger.error(error_msg)
                raise Exception(error_msg)

        workflow.logger.info(
            f"Entity export complete: {self.created_entities} entities created"
        )

        return {
            "success": True,
            "total_entities": self.total_entities,
            "created_entities": self.created_entities,
            "message": f"Successfully created {self.created_entities} entities in ODK"
        }

    @workflow.query
    def get_progress(self) -> Dict[str, Any]:
        """Query to get current workflow progress."""
        return {
            "total_entities": self.total_entities,
            "created_entities": self.created_entities,
            "current_label": self.current_label,
            "error_message": self.error_message
        }
