# Temporal Workflow Integration Strategy for TrueCover

## Executive Summary

TrueCover currently has several long-running processes that are either implemented synchronously (causing timeouts) or with simple threading (lacking reliability and observability). This document proposes integrating [Temporal](https://temporal.io/) as a durable workflow orchestration engine to manage these processes.

### Problems Temporal Solves

1. **Timeouts**: Coverage prediction can take 15+ minutes and times out HTTP requests
2. **No Progress Tracking**: Users have no visibility into long-running operations
3. **Poor Reliability**: Single-threaded enrichment worker, no distributed processing
4. **Limited Retry Logic**: Manual retry mechanisms without exponential backoff
5. **No Observability**: Only console logs and database status fields
6. **Process Management**: Difficult to track and monitor what's running

### What We Gain

- **Durable Execution**: Workflows survive process restarts
- **Automatic Retries**: Configurable retry policies with exponential backoff
- **Observability**: Temporal UI shows workflow status, history, and execution details
- **Scalability**: Horizontal scaling via multiple workers
- **Progress Tracking**: Query workflow state in real-time
- **Error Handling**: Built-in compensation and saga patterns
- **Testing**: Deterministic workflow testing framework

---

## Current State Analysis

### Existing Processes

#### 1. Pixel Enrichment (ASYNC - needs improvement)
- **Location**: `truecover-backend/services/enrichment_worker.py`
- **Current**: Threading-based background worker, polls job queue
- **Issues**:
  - Single-threaded (one job at a time)
  - Runs in Flask process (stops when Flask restarts)
  - Manual retry logic (max 3 attempts)
  - Time-based stuck detection (30 min timeout)
  - No distributed processing

#### 2. Coverage Prediction (SYNC - major pain point)
- **Location**: `truecover-backend/routes/coverage.py:217-605`
- **Current**: Synchronous HTTP endpoint with 920s timeout
- **Issues**:
  - Can timeout with large datasets (15+ minutes)
  - Blocks HTTP request entire duration
  - No progress tracking
  - Can't cancel once started
  - No retry if fails midway

#### 3. Round Generation (SYNC - needs async)
- **Location**: `truecover-backend/routes/rounds.py:15-411`
- **Current**: Synchronous HTTP endpoint with 120s timeout
- **Issues**:
  - 2-minute timeout
  - External service dependency (adaptive sampling)
  - No progress tracking
  - All-or-nothing transaction

#### 4. Location Upload (SYNC - could benefit)
- **Location**: `truecover-backend/routes/locations.py:222-525`
- **Current**: Synchronous file upload processing
- **Issues**:
  - Complex multi-step process in single transaction
  - No progress for large uploads
  - Timeout risk with large files

---

## Temporal Architecture

### High-Level Design

```
┌─────────────────┐
│  React Frontend │
│                 │
│  - Start workflows via API
│  - Poll for progress
│  - Display status
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────────────────────┐
│      Flask API Server           │
│                                 │
│  - Workflow client              │
│  - Start workflows              │
│  - Query workflow status        │
│  - Return workflow IDs          │
└────────┬────────────────────────┘
         │ Temporal Client
         ▼
┌─────────────────────────────────┐
│    Temporal Server (Docker)     │
│                                 │
│  - Workflow orchestration       │
│  - State persistence            │
│  - Event history                │
│  - Task queues                  │
└────────┬────────────────────────┘
         │ PostgreSQL (visibility)
         ▼
┌─────────────────────────────────┐
│      PostgreSQL Database        │
│                                 │
│  - App data (locations, pixels) │
│  - Temporal visibility store    │
└─────────────────────────────────┘
         ▲
         │
┌────────┴────────────────────────┐
│   Temporal Worker (Python)      │
│                                 │
│  - Workflow implementations     │
│  - Activity implementations     │
│  - Polls task queues            │
│  - Executes workflow code       │
└─────────────────────────────────┘
```

### Components

#### 1. Temporal Server
- **Deployment**: Docker container via docker-compose
- **Visibility Store**: PostgreSQL (shared with app database)
- **UI**: Web interface on port 8088 for monitoring

#### 2. Temporal Worker
- **Language**: Python 3.12+
- **Location**: `truecover-backend/temporal_worker.py`
- **Runs**: Separate process from Flask app
- **Deployment**: Managed by docker-compose or systemd

#### 3. Temporal Client (in Flask)
- **Integration**: Flask app creates client to start/query workflows
- **Usage**: API endpoints create workflow executions
- **Queries**: Poll workflow status for progress updates

---

## Workflow Designs

### 1. Coverage Prediction Workflow (Priority 1)

**Trigger**: `POST /api/coverage/predict`

**Current Flow**:
```python
# Synchronous - can take 15+ minutes
def predict_coverage():
    # 1. Fetch all locations for indicator
    # 2. Call prevalence predictor for locations (910s timeout)
    # 3. Update coverage table
    # 4. Fetch all pixels for indicator
    # 5. Call prevalence predictor for pixels (910s timeout)
    # 6. Update coverage_pixel table
    # 7. Return results
```

**Temporal Flow**:
```python
@workflow.defn
class CoveragePredictionWorkflow:
    @workflow.run
    async def run(self, area_id: str, indicator_id: str) -> PredictionResult:
        # Activity 1: Fetch location coverage records
        locations = await workflow.execute_activity(
            fetch_location_coverage,
            args=[area_id, indicator_id],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 2: Predict location coverage (parallel batches)
        location_results = await workflow.execute_activity(
            predict_location_coverage,
            args=[locations],
            start_to_close_timeout=timedelta(minutes=15),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                maximum_interval=timedelta(minutes=1),
                maximum_attempts=3
            )
        )

        # Activity 3: Update location coverage records
        await workflow.execute_activity(
            update_location_coverage,
            args=[location_results],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 4: Fetch pixel coverage records
        pixels = await workflow.execute_activity(
            fetch_pixel_coverage,
            args=[area_id, indicator_id],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 5: Predict pixel coverage (parallel batches)
        pixel_results = await workflow.execute_activity(
            predict_pixel_coverage,
            args=[pixels],
            start_to_close_timeout=timedelta(minutes=15),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                maximum_interval=timedelta(minutes=1),
                maximum_attempts=3
            )
        )

        # Activity 6: Update pixel coverage records
        await workflow.execute_activity(
            update_pixel_coverage,
            args=[pixel_results],
            start_to_close_timeout=timedelta(minutes=2)
        )

        return PredictionResult(
            locations_updated=len(location_results),
            pixels_updated=len(pixel_results)
        )
```

**Activities**:
- `fetch_location_coverage`: Query database for coverage records
- `predict_location_coverage`: Call prevalence predictor service
- `update_location_coverage`: Update database with predictions
- `fetch_pixel_coverage`: Query database for pixel coverage records
- `predict_pixel_coverage`: Call prevalence predictor service
- `update_pixel_coverage`: Update database with predictions

**Benefits**:
- Survives restarts (durable execution)
- Automatic retries on external service failures
- Progress tracking via workflow queries
- Can handle 15+ minute executions
- History of all executions in Temporal UI

**API Changes**:
```python
# OLD (synchronous)
@app.route('/api/coverage/predict', methods=['POST'])
def predict_coverage():
    # ... do all work ...
    return jsonify(results)

# NEW (async)
@app.route('/api/coverage/predict', methods=['POST'])
async def predict_coverage():
    # Start workflow
    workflow_id = f"coverage-prediction-{area_id}-{indicator_id}-{timestamp}"
    handle = await client.start_workflow(
        CoveragePredictionWorkflow.run,
        args=[area_id, indicator_id],
        id=workflow_id,
        task_queue="truecover-tasks"
    )

    # Return workflow ID for polling
    return jsonify({
        "workflow_id": workflow_id,
        "status": "started"
    })

# New endpoint for status
@app.route('/api/coverage/predict/<workflow_id>/status', methods=['GET'])
async def get_prediction_status(workflow_id):
    handle = client.get_workflow_handle(workflow_id)

    # Query workflow for progress
    progress = await handle.query("get_progress")

    return jsonify({
        "workflow_id": workflow_id,
        "status": "running" if not handle.result else "completed",
        "progress": progress
    })
```

---

### 2. Pixel Enrichment Workflow (Priority 2)

**Trigger**: `POST /api/areas/<area_id>/enrich-pixels`

**Current Flow**:
```python
# Threading-based background worker
class EnrichmentWorker:
    def run(self):
        while True:
            job = get_pending_job()
            if job:
                try:
                    # Download COG
                    # Process pixels in batches
                    # Update pixel_metadata
                    mark_complete(job)
                except Exception as e:
                    mark_failed(job)
            sleep(5)
```

**Temporal Flow**:
```python
@workflow.defn
class PixelEnrichmentWorkflow:
    @workflow.run
    async def run(self, job_id: str, area_id: str, data_source_id: str, statistic: str) -> EnrichmentResult:
        # Activity 1: Fetch COG URL from STAC or direct URL
        cog_url = await workflow.execute_activity(
            fetch_cog_url,
            args=[data_source_id],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        # Activity 2: Download and validate COG
        cog_path = await workflow.execute_activity(
            download_cog,
            args=[cog_url],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=2),
                maximum_attempts=3
            )
        )

        # Activity 3: Fetch all pixels for area
        pixels = await workflow.execute_activity(
            fetch_area_pixels,
            args=[area_id],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 4: Process pixels in parallel batches
        batch_size = 100
        total_batches = (len(pixels) + batch_size - 1) // batch_size

        for i in range(0, len(pixels), batch_size):
            batch = pixels[i:i+batch_size]
            batch_num = i // batch_size + 1

            # Process batch
            results = await workflow.execute_activity(
                enrich_pixel_batch,
                args=[batch, cog_path, statistic],
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3)
            )

            # Update database
            await workflow.execute_activity(
                update_pixel_metadata,
                args=[results],
                start_to_close_timeout=timedelta(minutes=1)
            )

            # Update progress (stored in workflow state)
            self.pixels_processed += len(batch)

        return EnrichmentResult(
            pixels_processed=len(pixels),
            pixels_total=len(pixels)
        )

    @workflow.query
    def get_progress(self) -> dict:
        return {
            "pixels_processed": self.pixels_processed,
            "pixels_total": self.pixels_total
        }
```

**Activities**:
- `fetch_cog_url`: Get COG URL from STAC or data source
- `download_cog`: Download COG file to local cache
- `fetch_area_pixels`: Query database for pixels
- `enrich_pixel_batch`: Run rasterstats on pixel batch
- `update_pixel_metadata`: Update database with enrichment results

**Benefits**:
- Parallel processing of batches (via multiple workers)
- Automatic retry on COG download failures
- Progress tracking via workflow queries
- Can pause/resume if worker restarts
- Batch-level granularity for retries

---

### 3. Round Generation Workflow (Priority 3)

**Trigger**: `POST /api/areas/<area_id>/rounds`

**Temporal Flow**:
```python
@workflow.defn
class RoundGenerationWorkflow:
    @workflow.run
    async def run(self, area_id: str, indicator_id: str, sampling_target: str, round_number: int) -> RoundResult:
        # Activity 1: Create round record
        round_id = await workflow.execute_activity(
            create_round_record,
            args=[area_id, indicator_id, round_number, sampling_target],
            start_to_close_timeout=timedelta(seconds=30)
        )

        # Activity 2: Fetch coverage data for sampling
        coverage_data = await workflow.execute_activity(
            fetch_coverage_for_sampling,
            args=[area_id, indicator_id, sampling_target],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 3: Convert to GeoJSON
        geojson = await workflow.execute_activity(
            convert_to_geojson,
            args=[coverage_data],
            start_to_close_timeout=timedelta(minutes=1)
        )

        # Activity 4: Call adaptive sampling service
        sampling_results = await workflow.execute_activity(
            call_adaptive_sampling,
            args=[geojson],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                maximum_attempts=3
            )
        )

        # Activity 5: Update coverage records with round assignments
        # Use saga pattern - compensate if this fails
        try:
            updated = await workflow.execute_activity(
                update_round_assignments,
                args=[sampling_results, round_number, sampling_target],
                start_to_close_timeout=timedelta(minutes=2)
            )

            return RoundResult(
                round_id=round_id,
                locations_assigned=updated['locations'],
                pixels_assigned=updated['pixels']
            )
        except Exception as e:
            # Compensation: Delete round record
            await workflow.execute_activity(
                delete_round_record,
                args=[round_id],
                start_to_close_timeout=timedelta(seconds=30)
            )
            raise
```

**Activities**:
- `create_round_record`: Insert round in database
- `fetch_coverage_for_sampling`: Query coverage/pixel data
- `convert_to_geojson`: Transform to GeoJSON format
- `call_adaptive_sampling`: HTTP call to OpenFaaS function
- `update_round_assignments`: Update coverage records with round number
- `delete_round_record`: Compensation activity

**Benefits**:
- Saga pattern for rollback on failure
- Retry on external service failures
- Consistent state even if process crashes

---

### 4. Location Upload Workflow (Priority 4)

**Temporal Flow**:
```python
@workflow.defn
class LocationUploadWorkflow:
    @workflow.run
    async def run(self, area_id: str, file_path: str, file_type: str) -> UploadResult:
        # Activity 1: Parse uploaded file
        locations = await workflow.execute_activity(
            parse_location_file,
            args=[file_path, file_type],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 2: Process locations in batches
        batch_size = 50
        locations_created = []

        for i in range(0, len(locations), batch_size):
            batch = locations[i:i+batch_size]

            # Insert/update locations
            result = await workflow.execute_activity(
                upsert_locations,
                args=[area_id, batch],
                start_to_close_timeout=timedelta(minutes=1)
            )

            locations_created.extend(result['created'])

        # Activity 3: Create coverage records for all indicators
        await workflow.execute_activity(
            create_coverage_records,
            args=[area_id, locations_created],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 4: Auto-generate pixels for new quadkeys
        new_quadkeys = list(set([loc['quadkey'] for loc in locations_created if loc['quadkey']]))
        if new_quadkeys:
            await workflow.execute_activity(
                generate_pixels_for_quadkeys,
                args=[area_id, new_quadkeys],
                start_to_close_timeout=timedelta(minutes=5)
            )

        # Activity 5: Create coverage_pixel records
        await workflow.execute_activity(
            create_coverage_pixel_records,
            args=[area_id, new_quadkeys],
            start_to_close_timeout=timedelta(minutes=2)
        )

        # Activity 6: Update aggregates
        await workflow.execute_activity(
            update_coverage_pixel_aggregates,
            args=[area_id],
            start_to_close_timeout=timedelta(minutes=1)
        )

        return UploadResult(
            locations_created=len(locations_created),
            pixels_created=len(new_quadkeys)
        )
```

**Benefits**:
- Progress tracking for large uploads
- Saga pattern for multi-step process
- Batch processing with retries

---

## Implementation Plan

### Phase 1: Infrastructure Setup (Week 1)

**Tasks**:
1. Add Temporal server to `docker-compose.yml`
2. Configure PostgreSQL as visibility store
3. Add Temporal Python SDK to dependencies
4. Create `truecover-backend/temporal/` directory structure
5. Implement basic worker skeleton

**Docker Compose Addition**:
```yaml
services:
  temporal:
    image: temporalio/auto-setup:1.24.2
    ports:
      - "7233:7233"  # gRPC
      - "8088:8088"  # UI
    environment:
      - DB=postgresql
      - DB_PORT=5432
      - POSTGRES_USER=truecover
      - POSTGRES_PWD=truecover
      - POSTGRES_SEEDS=postgres
      - DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/development-sql.yaml
    depends_on:
      - postgres
    networks:
      - truecover-network

  temporal-worker:
    build:
      context: ./truecover-backend
      dockerfile: Dockerfile.temporal
    environment:
      - TEMPORAL_HOST=temporal:7233
      - DATABASE_URL=postgresql://truecover:truecover@postgres:5432/truecover
      - PYTHONPATH=/app
    depends_on:
      - temporal
      - postgres
    networks:
      - truecover-network
```

**Directory Structure**:
```
truecover-backend/
├── temporal/
│   ├── __init__.py
│   ├── workflows/
│   │   ├── __init__.py
│   │   ├── coverage_prediction.py
│   │   ├── pixel_enrichment.py
│   │   ├── round_generation.py
│   │   └── location_upload.py
│   ├── activities/
│   │   ├── __init__.py
│   │   ├── coverage.py
│   │   ├── enrichment.py
│   │   ├── rounds.py
│   │   └── locations.py
│   ├── client.py       # Temporal client singleton
│   └── worker.py       # Worker entry point
└── temporal_worker.py  # Worker script
```

**Dependencies (pyproject.toml)**:
```toml
[project]
dependencies = [
    # ... existing ...
    "temporalio>=1.6.0",
]
```

### Phase 2: Coverage Prediction Workflow (Week 2-3)

**Tasks**:
1. Implement `CoveragePredictionWorkflow`
2. Implement activities:
   - `fetch_location_coverage`
   - `predict_location_coverage`
   - `update_location_coverage`
   - `fetch_pixel_coverage`
   - `predict_pixel_coverage`
   - `update_pixel_coverage`
3. Update Flask route to start workflow
4. Add status endpoint for polling
5. Update frontend to poll for progress
6. Test with real data
7. Deploy to staging

**Migration Strategy**:
- Keep old synchronous endpoint as `/api/coverage/predict/sync` (deprecated)
- New async endpoint at `/api/coverage/predict`
- Add feature flag to switch between old/new
- Run both in parallel for 1 week
- Monitor for issues
- Remove old endpoint once confident

### Phase 3: Pixel Enrichment Workflow (Week 4)

**Tasks**:
1. Implement `PixelEnrichmentWorkflow`
2. Implement activities:
   - `fetch_cog_url`
   - `download_cog`
   - `fetch_area_pixels`
   - `enrich_pixel_batch`
   - `update_pixel_metadata`
3. Update enrichment endpoint to start workflow
4. Add progress query endpoint
5. Update frontend to show progress
6. Test with real enrichment jobs
7. Deprecate old `enrichment_worker.py`

**Database Schema Changes**:
```sql
-- Add workflow_id to enrichment_jobs table
ALTER TABLE enrichment_jobs
ADD COLUMN workflow_id VARCHAR(255);

-- Index for looking up jobs by workflow
CREATE INDEX idx_enrichment_jobs_workflow_id
ON enrichment_jobs(workflow_id);
```

### Phase 4: Round Generation Workflow (Week 5)

**Tasks**:
1. Implement `RoundGenerationWorkflow`
2. Implement activities with saga compensation
3. Update rounds endpoint
4. Add progress tracking
5. Update frontend
6. Test saga compensation scenarios
7. Deploy

### Phase 5: Location Upload Workflow (Week 6)

**Tasks**:
1. Implement `LocationUploadWorkflow`
2. Implement batch processing activities
3. Update upload endpoint
4. Add progress tracking
5. Update frontend with progress bar
6. Test with large files
7. Deploy

### Phase 6: Monitoring & Observability (Week 7)

**Tasks**:
1. Set up Temporal UI access (port forwarding or ingress)
2. Add structured logging to activities
3. Add metrics collection (optional: Prometheus integration)
4. Create dashboard for workflow monitoring
5. Document how to debug failed workflows
6. Set up alerts for workflow failures

---

## Code Structure

### Workflow Example: Coverage Prediction

**File**: `truecover-backend/temporal/workflows/coverage_prediction.py`

```python
# ABOUTME: Temporal workflow for coverage prediction
# ABOUTME: Orchestrates calling prevalence predictor and updating database

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy

from ..activities.coverage import (
    fetch_location_coverage,
    predict_location_coverage,
    update_location_coverage,
    fetch_pixel_coverage,
    predict_pixel_coverage,
    update_pixel_coverage,
)


@workflow.defn
class CoveragePredictionWorkflow:
    def __init__(self):
        self.locations_processed = 0
        self.pixels_processed = 0
        self.locations_total = 0
        self.pixels_total = 0

    @workflow.run
    async def run(self, area_id: str, indicator_id: str) -> dict:
        """
        Run coverage prediction for locations and pixels.

        Args:
            area_id: Area ID
            indicator_id: Indicator ID

        Returns:
            Result summary with counts
        """
        # Fetch location coverage records
        locations = await workflow.execute_activity(
            fetch_location_coverage,
            args=[area_id, indicator_id],
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )

        self.locations_total = len(locations)

        # Predict location coverage
        location_results = await workflow.execute_activity(
            predict_location_coverage,
            args=[locations],
            start_to_close_timeout=timedelta(minutes=15),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                maximum_interval=timedelta(minutes=1),
                maximum_attempts=3
            )
        )

        # Update location coverage
        await workflow.execute_activity(
            update_location_coverage,
            args=[location_results],
            start_to_close_timeout=timedelta(minutes=2)
        )

        self.locations_processed = len(location_results)

        # Fetch pixel coverage records
        pixels = await workflow.execute_activity(
            fetch_pixel_coverage,
            args=[area_id, indicator_id],
            start_to_close_timeout=timedelta(minutes=2)
        )

        self.pixels_total = len(pixels)

        # Predict pixel coverage
        pixel_results = await workflow.execute_activity(
            predict_pixel_coverage,
            args=[pixels],
            start_to_close_timeout=timedelta(minutes=15),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=1),
                maximum_interval=timedelta(minutes=1),
                maximum_attempts=3
            )
        )

        # Update pixel coverage
        await workflow.execute_activity(
            update_pixel_coverage,
            args=[pixel_results],
            start_to_close_timeout=timedelta(minutes=2)
        )

        self.pixels_processed = len(pixel_results)

        return {
            "locations_updated": self.locations_processed,
            "pixels_updated": self.pixels_processed
        }

    @workflow.query
    def get_progress(self) -> dict:
        """Query to get current progress."""
        return {
            "locations_processed": self.locations_processed,
            "locations_total": self.locations_total,
            "pixels_processed": self.pixels_processed,
            "pixels_total": self.pixels_total,
        }
```

### Activity Example: Predict Location Coverage

**File**: `truecover-backend/temporal/activities/coverage.py`

```python
# ABOUTME: Temporal activities for coverage operations
# ABOUTME: Database queries and external service calls for coverage workflows

from temporalio import activity
import requests
from typing import List, Dict, Any
from db import get_db


@activity.defn
async def fetch_location_coverage(area_id: str, indicator_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all location coverage records for an area and indicator.

    Args:
        area_id: Area ID
        indicator_id: Indicator ID

    Returns:
        List of coverage records
    """
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT c.id, c.location_id, c.quadkey, c.n_trials, c.n_covered,
               l.latitude, l.longitude
        FROM coverage c
        JOIN locations l ON c.location_id = l.id
        WHERE c.area_id = %s AND c.indicator_id = %s
    """, (area_id, indicator_id))

    records = cursor.fetchall()
    cursor.close()

    return [
        {
            "id": r[0],
            "location_id": r[1],
            "quadkey": r[2],
            "n_trials": r[3],
            "n_covered": r[4],
            "latitude": r[5],
            "longitude": r[6],
        }
        for r in records
    ]


@activity.defn
async def predict_location_coverage(locations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Call prevalence predictor service for location coverage.

    Args:
        locations: List of location coverage records

    Returns:
        List of predictions with coverage IDs
    """
    activity.logger.info(f"Predicting coverage for {len(locations)} locations")

    # Prepare request payload
    payload = {
        "points": [
            {
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
                "n_trials": loc["n_trials"],
                "n_positive": loc["n_covered"],
            }
            for loc in locations
        ]
    }

    # Call prevalence predictor service
    response = requests.post(
        "http://localhost:8084/",
        json=payload,
        timeout=910  # 15 minutes + buffer
    )

    response.raise_for_status()
    predictions = response.json()

    # Combine predictions with coverage IDs
    results = []
    for i, loc in enumerate(locations):
        pred = predictions[i]
        results.append({
            "coverage_id": loc["id"],
            "exceedance_probability": pred.get("exceedance_probability"),
            "exceedance_uncertainty": pred.get("exceedance_uncertainty"),
            "prevalence_bci_width": pred.get("prevalence_bci_width"),
            "prevalence_prediction": pred.get("prevalence_prediction"),
        })

    return results


@activity.defn
async def update_location_coverage(results: List[Dict[str, Any]]) -> None:
    """
    Update coverage records with predictions.

    Args:
        results: List of predictions with coverage IDs
    """
    conn = get_db()
    cursor = conn.cursor()

    activity.logger.info(f"Updating {len(results)} coverage records")

    for result in results:
        cursor.execute("""
            UPDATE coverage
            SET exceedance_probability = %s,
                exceedance_uncertainty = %s,
                prevalence_bci_width = %s,
                prevalence_prediction = %s,
                last_predicted_at = NOW()
            WHERE id = %s
        """, (
            result["exceedance_probability"],
            result["exceedance_uncertainty"],
            result["prevalence_bci_width"],
            result["prevalence_prediction"],
            result["coverage_id"],
        ))

    conn.commit()
    cursor.close()

    activity.logger.info("Coverage records updated successfully")


# Similar implementations for:
# - fetch_pixel_coverage
# - predict_pixel_coverage
# - update_pixel_coverage
```

### Worker Script

**File**: `truecover-backend/temporal_worker.py`

```python
# ABOUTME: Temporal worker entry point
# ABOUTME: Registers workflows and activities, starts worker

import asyncio
import logging
from temporalio.client import Client
from temporalio.worker import Worker

from temporal.workflows.coverage_prediction import CoveragePredictionWorkflow
from temporal.workflows.pixel_enrichment import PixelEnrichmentWorkflow
from temporal.workflows.round_generation import RoundGenerationWorkflow
from temporal.workflows.location_upload import LocationUploadWorkflow

from temporal.activities import coverage, enrichment, rounds, locations


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    # Connect to Temporal server
    client = await Client.connect("localhost:7233")

    # Create worker
    worker = Worker(
        client,
        task_queue="truecover-tasks",
        workflows=[
            CoveragePredictionWorkflow,
            PixelEnrichmentWorkflow,
            RoundGenerationWorkflow,
            LocationUploadWorkflow,
        ],
        activities=[
            # Coverage activities
            coverage.fetch_location_coverage,
            coverage.predict_location_coverage,
            coverage.update_location_coverage,
            coverage.fetch_pixel_coverage,
            coverage.predict_pixel_coverage,
            coverage.update_pixel_coverage,

            # Enrichment activities
            enrichment.fetch_cog_url,
            enrichment.download_cog,
            enrichment.fetch_area_pixels,
            enrichment.enrich_pixel_batch,
            enrichment.update_pixel_metadata,

            # Rounds activities
            rounds.create_round_record,
            rounds.fetch_coverage_for_sampling,
            rounds.convert_to_geojson,
            rounds.call_adaptive_sampling,
            rounds.update_round_assignments,
            rounds.delete_round_record,

            # Location activities
            locations.parse_location_file,
            locations.upsert_locations,
            locations.create_coverage_records,
            locations.generate_pixels_for_quadkeys,
            locations.create_coverage_pixel_records,
            locations.update_coverage_pixel_aggregates,
        ],
    )

    logger.info("Starting Temporal worker on task queue 'truecover-tasks'")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
```

### Flask Integration

**File**: `truecover-backend/temporal/client.py`

```python
# ABOUTME: Temporal client singleton for Flask app
# ABOUTME: Provides client instance for starting workflows

from temporalio.client import Client
import asyncio


_client = None
_client_lock = asyncio.Lock()


async def get_temporal_client() -> Client:
    """Get or create Temporal client singleton."""
    global _client

    async with _client_lock:
        if _client is None:
            _client = await Client.connect("localhost:7233")

    return _client
```

**File**: `truecover-backend/routes/coverage.py` (updated)

```python
# Add async endpoint for coverage prediction
from temporal.client import get_temporal_client
from temporal.workflows.coverage_prediction import CoveragePredictionWorkflow
import asyncio
from datetime import datetime


@app.route('/api/coverage/predict', methods=['POST'])
def predict_coverage():
    """Start coverage prediction workflow."""
    data = request.json
    area_id = data.get('area_id')
    indicator_id = data.get('indicator_id')

    # Validate access
    if not has_access(area_id):
        return jsonify({"error": "Access denied"}), 403

    # Generate workflow ID
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    workflow_id = f"coverage-prediction-{area_id}-{indicator_id}-{timestamp}"

    # Start workflow
    async def start_workflow():
        client = await get_temporal_client()
        handle = await client.start_workflow(
            CoveragePredictionWorkflow.run,
            args=[area_id, indicator_id],
            id=workflow_id,
            task_queue="truecover-tasks"
        )
        return handle

    # Run in event loop
    asyncio.run(start_workflow())

    return jsonify({
        "workflow_id": workflow_id,
        "status": "started",
        "message": "Coverage prediction started. Use /api/coverage/predict/{workflow_id}/status to check progress."
    })


@app.route('/api/coverage/predict/<workflow_id>/status', methods=['GET'])
def get_prediction_status(workflow_id):
    """Get status of coverage prediction workflow."""
    async def get_status():
        client = await get_temporal_client()
        handle = client.get_workflow_handle(workflow_id)

        # Check if workflow is complete
        try:
            result = await asyncio.wait_for(handle.result(), timeout=0.1)
            return {
                "workflow_id": workflow_id,
                "status": "completed",
                "result": result
            }
        except asyncio.TimeoutError:
            # Workflow still running, query progress
            progress = await handle.query(CoveragePredictionWorkflow.get_progress)
            return {
                "workflow_id": workflow_id,
                "status": "running",
                "progress": progress
            }

    status = asyncio.run(get_status())
    return jsonify(status)
```

### Frontend Integration

**File**: `truecover-app/src/services/coverageApi.ts`

```typescript
// Start coverage prediction workflow
export async function startCoveragePrediction(
  areaId: string,
  indicatorId: string
): Promise<{ workflowId: string }> {
  const response = await fetch('/api/coverage/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ area_id: areaId, indicator_id: indicatorId }),
  });

  if (!response.ok) throw new Error('Failed to start prediction');

  return await response.json();
}

// Poll for workflow status
export async function getCoveragePredictionStatus(
  workflowId: string
): Promise<{
  status: 'running' | 'completed';
  progress?: {
    locations_processed: number;
    locations_total: number;
    pixels_processed: number;
    pixels_total: number;
  };
  result?: any;
}> {
  const response = await fetch(`/api/coverage/predict/${workflowId}/status`);

  if (!response.ok) throw new Error('Failed to get status');

  return await response.json();
}
```

**React Component Example**:

```tsx
function PredictCoverageButton({ areaId, indicatorId }: Props) {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed'>('idle');
  const [progress, setProgress] = useState({ locations: 0, pixels: 0 });

  const startPrediction = async () => {
    const { workflowId } = await startCoveragePrediction(areaId, indicatorId);
    setWorkflowId(workflowId);
    setStatus('running');
    pollStatus(workflowId);
  };

  const pollStatus = async (workflowId: string) => {
    const interval = setInterval(async () => {
      const result = await getCoveragePredictionStatus(workflowId);

      if (result.status === 'completed') {
        clearInterval(interval);
        setStatus('completed');
        // Refresh data
      } else if (result.progress) {
        setProgress({
          locations: result.progress.locations_processed,
          pixels: result.progress.pixels_processed,
        });
      }
    }, 2000); // Poll every 2 seconds
  };

  return (
    <div>
      <button onClick={startPrediction} disabled={status === 'running'}>
        {status === 'running' ? 'Predicting...' : 'Update Predictions'}
      </button>

      {status === 'running' && (
        <div>
          <p>Locations: {progress.locations}</p>
          <p>Pixels: {progress.pixels}</p>
        </div>
      )}
    </div>
  );
}
```

---

## Migration Strategy

### Principles

1. **No Big Bang**: Migrate one workflow at a time
2. **Feature Flags**: Support both old and new implementations
3. **Parallel Running**: Run old and new in parallel for validation
4. **Gradual Rollout**: Start with staging, then production
5. **Rollback Plan**: Keep old implementation for quick rollback

### Migration Phases

#### Phase 1: Infrastructure (No User Impact)
- Add Temporal server to docker-compose
- Deploy worker service
- Verify connectivity
- No changes to application code

#### Phase 2: Coverage Prediction (High Impact)
- Implement workflow and activities
- Add new async endpoint
- Keep old sync endpoint as `/api/coverage/predict/sync`
- Add feature flag `ENABLE_TEMPORAL_PREDICTION`
- Frontend uses old endpoint by default
- Test new endpoint in staging
- Enable feature flag for internal users
- Monitor for 1 week
- Roll out to all users
- Deprecate old endpoint after 2 weeks
- Remove old endpoint after 1 month

#### Phase 3: Pixel Enrichment (Medium Impact)
- Implement workflow and activities
- Keep old worker running
- Add feature flag `ENABLE_TEMPORAL_ENRICHMENT`
- New jobs use Temporal, old jobs use old worker
- Monitor for 1 week
- Stop old worker after 2 weeks

#### Phase 4: Rounds & Locations (Lower Impact)
- Similar gradual rollout
- Less critical, can move faster

### Rollback Plan

If issues arise:
1. Disable feature flag to revert to old implementation
2. Stop Temporal worker to prevent new executions
3. Let in-flight workflows complete (they'll survive restarts)
4. Fix issues in staging
5. Re-enable gradually

---

## Monitoring & Observability

### Temporal UI

- **Access**: http://localhost:8088
- **Features**:
  - List all workflows
  - View workflow history (every activity, decision, timer)
  - See retry attempts
  - Query workflow state
  - Terminate or cancel workflows
  - Search by workflow ID, type, status

### Logging

All activities should use structured logging:

```python
@activity.defn
async def enrich_pixel_batch(batch, cog_path, statistic):
    activity.logger.info(
        "Starting pixel enrichment",
        extra={
            "batch_size": len(batch),
            "statistic": statistic,
            "cog_path": cog_path,
        }
    )

    # ... do work ...

    activity.logger.info(
        "Completed pixel enrichment",
        extra={
            "pixels_processed": len(batch),
            "duration_seconds": duration,
        }
    )
```

### Metrics (Optional)

Temporal supports Prometheus metrics:
- Workflow start rate
- Workflow completion rate
- Workflow failure rate
- Activity retry rate
- Activity duration

### Debugging Failed Workflows

1. Open Temporal UI
2. Find workflow by ID or search
3. View event history to see:
   - Which activity failed
   - Error message and stack trace
   - Retry attempts
   - Inputs and outputs
4. Fix issue in code
5. Restart worker to pick up new code
6. Workflow will automatically retry failed activity

---

## Trade-offs & Considerations

### What We Gain

✅ **Reliability**: Workflows survive crashes, restarts, deployments
✅ **Observability**: Full history of execution in UI
✅ **Scalability**: Horizontal scaling via multiple workers
✅ **Retries**: Automatic retry with exponential backoff
✅ **Progress Tracking**: Real-time status via queries
✅ **Error Handling**: Built-in compensation and saga patterns
✅ **Testing**: Deterministic workflow testing
✅ **Distributed**: Multiple workers can process jobs in parallel

### What We Add

❌ **Complexity**: New system to learn, operate, and debug
❌ **Infrastructure**: Temporal server to run and maintain
❌ **Code Changes**: Workflows and activities to implement
❌ **Migration Effort**: Weeks of work to migrate existing processes
❌ **Dependencies**: Another service to monitor and keep healthy

### Alternatives Considered

#### 1. Celery
- **Pros**: Python-native, well-known, simpler
- **Cons**: Less durable execution, no built-in workflow orchestration, requires Redis/RabbitMQ
- **Why Not**: TrueCover needs durable workflows with complex multi-step processes

#### 2. Airflow
- **Pros**: Workflow orchestration, UI, Python
- **Cons**: Designed for batch/scheduled jobs, not on-demand workflows, heavier weight
- **Why Not**: Overkill for on-demand user-triggered workflows

#### 3. Custom Queue (Redis/RabbitMQ)
- **Pros**: Simple, lightweight
- **Cons**: Have to implement retry logic, progress tracking, error handling manually
- **Why Not**: Reinventing the wheel that Temporal already solved

#### 4. Keep Current Approach
- **Pros**: No changes needed
- **Cons**: Timeouts, poor reliability, no observability
- **Why Not**: Current approach is causing production issues

### Verdict

Temporal is the right choice for TrueCover because:
1. Long-running processes (15+ min) that timeout HTTP requests
2. Need for reliability (external service calls fail)
3. Need for progress tracking (users want visibility)
4. Complex multi-step workflows (location upload, enrichment)
5. Python SDK is mature and well-documented

The complexity trade-off is worth it given the production issues we're solving.

---

## Next Steps

1. **Review This Document**: Matt reviews and provides feedback
2. **Approval Decision**: Go/no-go on Temporal integration
3. **Phase 1 Start**: Set up infrastructure in staging
4. **Proof of Concept**: Implement coverage prediction workflow in staging
5. **Validate**: Test POC with real data, monitor for issues
6. **Full Rollout**: Follow implementation plan phases

---

## Resources

- [Temporal Documentation](https://docs.temporal.io/)
- [Python SDK Guide](https://docs.temporal.io/dev-guide/python)
- [Workflow Patterns](https://docs.temporal.io/encyclopedia/application-patterns)
- [Best Practices](https://docs.temporal.io/dev-guide/python/best-practices)
- [Production Deployment](https://docs.temporal.io/self-hosted/guide-production)
