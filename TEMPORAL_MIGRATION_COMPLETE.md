# Temporal Migration - Implementation Complete

## Summary

Successfully migrated the remaining three features to use Temporal workflows:

1. **Coverage Prediction** (Priority 1) ✅
2. **Pixel Enrichment** (Priority 2) ✅
3. **Round Generation** (Priority 3) ✅

All workflows are now implemented with autodiscovery and support autopolling for progress tracking, matching the pattern used for location upload and overture import.

## What Was Implemented

### 1. Coverage Prediction Workflow

**Files Created:**
- `temporal/workflows/coverage_prediction.py` - Workflow orchestration
- `temporal/activities/coverage.py` - Database and API activities

**New API Endpoints:**
- `POST /api/coverage/predict/workflow` - Start prediction workflow
- `GET /api/coverage/predict/workflow/<workflow_id>/status` - Check workflow status

**Features:**
- Predicts coverage for both locations and pixels
- Handles 15+ minute execution times without timeout
- Progress tracking via workflow queries
- Automatic retries on failures
- Full history in Temporal UI

**Old endpoint preserved:** The original synchronous `/api/coverage/predict` endpoint remains unchanged for backward compatibility.

### 2. Pixel Enrichment Workflow

**Files Created:**
- `temporal/workflows/pixel_enrichment.py` - Workflow orchestration
- `temporal/activities/enrichment.py` - COG download and raster stats activities

**Modified:**
- `routes/enrichment.py` - Updated to start workflow automatically when creating enrichment job

**Features:**
- Downloads and caches COG files
- Processes pixels in batches (100 per batch)
- Updates pixel_metadata table with enrichment results
- Progress tracking per batch
- Replaces the old threading-based enrichment_worker.py
- Automatic retry on COG download failures

**Database Note:** Enrichment jobs now include a `workflow_id` field (see migrations below).

### 3. Round Generation Workflow

**Files Created:**
- `temporal/workflows/round_generation.py` - Workflow orchestration
- `temporal/activities/rounds.py` - Round creation and adaptive sampling activities

**New API Endpoints:**
- `POST /api/areas/<area_id>/rounds/workflow` - Start round generation workflow
- `GET /api/rounds/workflow/<workflow_id>/status` - Check workflow status

**Features:**
- Creates round record
- Fetches coverage data (locations or pixels)
- Calls adaptive sampling service
- Updates coverage records with round assignments
- Saga pattern for rollback on failure
- Handles both location and pixel sampling targets

**Old endpoint preserved:** The original synchronous `/api/areas/<area_id>/rounds` endpoint remains unchanged.

### 4. Worker Registration

**Updated:**
- `temporal_worker.py` - Registered all new workflows and activities with autodiscovery

**Registered Workflows:**
- LocationUploadWorkflow ✅
- OvertureImportWorkflow ✅
- CoveragePredictionWorkflow ✅ NEW
- PixelEnrichmentWorkflow ✅ NEW
- RoundGenerationWorkflow ✅ NEW

## Database Migrations Needed

### Enrichment Jobs Table

The `enrichment_jobs` table needs a `workflow_id` column:

```sql
ALTER TABLE enrichment_jobs
ADD COLUMN workflow_id VARCHAR(255);

CREATE INDEX idx_enrichment_jobs_workflow_id
ON enrichment_jobs(workflow_id);
```

## Testing the Workflows

### 1. Start Temporal Services

Make sure Temporal is running:

```bash
cd truecover-backend
docker-compose up -d temporal temporal-ui
```

### 2. Start the Worker

```bash
cd truecover-backend
PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python temporal_worker.py
```

### 3. Test Coverage Prediction

```bash
curl -X POST http://localhost:5001/api/coverage/predict/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "area_id": "YOUR_AREA_ID",
    "indicator_id": "YOUR_INDICATOR_ID"
  }'
```

Response will include `workflow_id` - use it to check status:

```bash
curl http://localhost:5001/api/coverage/predict/workflow/WORKFLOW_ID/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Test Pixel Enrichment

```bash
curl -X POST http://localhost:5001/api/areas/YOUR_AREA_ID/enrich-pixels \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "data_source_id": "YOUR_DATA_SOURCE_ID",
    "statistic": "mean"
  }'
```

Response includes `workflow_id` - check job status:

```bash
curl http://localhost:5001/api/enrichment-jobs/JOB_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 5. Test Round Generation

```bash
curl -X POST http://localhost:5001/api/areas/YOUR_AREA_ID/rounds/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Round 1",
    "description": "Test round",
    "indicator_id": "YOUR_INDICATOR_ID",
    "batch_size": 10,
    "sampling_target": "locations"
  }'
```

### 6. Monitor in Temporal UI

Open http://localhost:8080 to see all workflows, their status, history, and progress.

## Frontend Integration Notes

The frontend needs to be updated to:

1. **Coverage Prediction**: Use the new `/api/coverage/predict/workflow` endpoint and implement polling for status
2. **Pixel Enrichment**: Already returns workflow_id - just needs to poll for progress
3. **Round Generation**: Use the new `/api/areas/<area_id>/rounds/workflow` endpoint and implement polling

Follow the same pattern used for location upload:
- Start workflow
- Poll status endpoint every 2 seconds
- Display progress from `progress` field in status response
- Show completion when `status === 'completed'`

## Next Steps

1. **Run Database Migration**: Add `workflow_id` column to `enrichment_jobs` table
2. **Test Each Workflow**: Use the test commands above to verify each workflow works
3. **Update Frontend**: Implement autopolling UI for the three new workflows
4. **Deprecate Old Workers**: The `enrichment_worker.py` can be removed once pixel enrichment workflow is tested
5. **Monitor in Production**: Use Temporal UI to monitor workflow execution and debug any issues

## Benefits Achieved

✅ **No More Timeouts**: Coverage prediction can run for 15+ minutes without HTTP timeout
✅ **Reliability**: Workflows survive process restarts and automatically retry on failures
✅ **Observability**: Full execution history in Temporal UI with detailed logging
✅ **Scalability**: Can run multiple workers for parallel processing
✅ **Progress Tracking**: Real-time progress updates via workflow queries
✅ **Error Handling**: Automatic retries with exponential backoff
✅ **Saga Pattern**: Round generation rolls back on failure

## Architecture

All workflows follow the same pattern:

```
Frontend → API Endpoint → Start Workflow → Temporal Server
                              ↓
                         Temporal Worker
                              ↓
                         Activities (DB + External APIs)
                              ↓
                         Update Progress
                              ↓
                         Return Result
```

Workflows are:
- Durable (survive crashes)
- Observable (full history in UI)
- Testable (deterministic workflow testing)
- Scalable (horizontal worker scaling)
