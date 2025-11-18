# Temporal Workflows - Quick Start Guide

## ✅ Setup Complete!

All three remaining workflows have been implemented and verified:
- ✅ Coverage Prediction Workflow (28 min timeout-free execution)
- ✅ Pixel Enrichment Workflow (replaces threading worker)
- ✅ Round Generation Workflow (with saga pattern rollback)

**Total Activities:** 28 (across 5 modules)
**Total Workflows:** 5 (including location upload and overture import)
**Database Migration:** ✅ Complete

## Quick Start

### 1. Verify Setup

```bash
cd truecover-backend
PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python verify_temporal_setup.py
```

Expected output: "✓ ALL CHECKS PASSED"

### 2. Start Worker

In one terminal:

```bash
cd truecover-backend
PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python temporal_worker.py
```

You should see:
```
INFO:temporal_worker:Discovered 28 activities
INFO:temporal_worker:Registered 28 activities
INFO:temporal_worker:Starting Temporal worker on task queue 'truecover-tasks'
```

### 3. Start Backend Server

In another terminal:

```bash
cd truecover-backend
PORT=5001 PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python app.py
```

### 4. Test Coverage Prediction

```bash
# Get auth token first
TOKEN="your_jwt_token_here"

# Start workflow
curl -X POST http://localhost:5001/api/coverage/predict/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "area_id": "YOUR_AREA_ID",
    "indicator_id": "YOUR_INDICATOR_ID"
  }'

# Response: {"workflow_id": "coverage-prediction-...", "status": "started"}

# Poll for status (repeat every 2 seconds)
curl http://localhost:5001/api/coverage/predict/workflow/WORKFLOW_ID/status \
  -H "Authorization: Bearer $TOKEN"
```

### 5. Test Pixel Enrichment

```bash
# Start enrichment (automatically starts workflow)
curl -X POST http://localhost:5001/api/areas/YOUR_AREA_ID/enrich-pixels \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "data_source_id": "YOUR_DATA_SOURCE_ID",
    "statistic": "mean"
  }'

# Response includes job_id and workflow_id

# Check job status
curl http://localhost:5001/api/enrichment-jobs/JOB_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 6. Test Round Generation

```bash
# Start round generation workflow
curl -X POST http://localhost:5001/api/areas/YOUR_AREA_ID/rounds/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Test Round 1",
    "description": "Testing temporal workflow",
    "indicator_id": "YOUR_INDICATOR_ID",
    "batch_size": 10,
    "sampling_target": "locations",
    "allow_revisit": false
  }'

# Poll for status
curl http://localhost:5001/api/rounds/workflow/WORKFLOW_ID/status \
  -H "Authorization: Bearer $TOKEN"
```

### 7. Monitor in Temporal UI

Open http://localhost:8080 in your browser to see:
- All running workflows
- Workflow history and events
- Progress and errors
- Retry attempts

## API Endpoints Reference

### Coverage Prediction
- `POST /api/coverage/predict/workflow` - Start workflow
- `GET /api/coverage/predict/workflow/<workflow_id>/status` - Check status

### Pixel Enrichment
- `POST /api/areas/<area_id>/enrich-pixels` - Start enrichment (creates job + starts workflow)
- `GET /api/enrichment-jobs/<job_id>` - Check job status
- `GET /api/areas/<area_id>/enrichment-jobs` - List all jobs

### Round Generation
- `POST /api/areas/<area_id>/rounds/workflow` - Start workflow
- `GET /api/rounds/workflow/<workflow_id>/status` - Check status

## Status Response Format

All workflows return status in this format:

```json
{
  "workflow_id": "coverage-prediction-...",
  "status": "running|completed|failed",
  "progress": {
    "locations_total": 100,
    "locations_processed": 45,
    "pixels_total": 500,
    "pixels_processed": 200
  },
  "result": {
    "success": true,
    "locations_updated": 100,
    "pixels_updated": 500
  }
}
```

## Common Issues

### Worker not processing workflows
**Problem:** Workflows stay in "running" but never progress
**Solution:** Check that worker is running and connected to Temporal server

```bash
docker logs truecover-temporal -f
```

### Workflow not found
**Problem:** Status endpoint returns "workflow not found"
**Solution:** Check workflow_id is correct, and workflow was actually started

### Database connection errors
**Problem:** Activities fail with database errors
**Solution:** Check PostgreSQL is running and credentials are correct

```bash
docker ps | grep postgres
```

### Import errors
**Problem:** Worker fails to start with import errors
**Solution:** Run verification script to identify missing dependencies

```bash
PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python verify_temporal_setup.py
```

## Files Created

### Workflows
- `temporal/workflows/coverage_prediction.py`
- `temporal/workflows/pixel_enrichment.py`
- `temporal/workflows/round_generation.py`

### Activities
- `temporal/activities/coverage.py` (6 activities)
- `temporal/activities/enrichment.py` (9 activities)
- `temporal/activities/rounds.py` (5 activities)

### Routes Updated
- `routes/coverage.py` - Added workflow endpoints
- `routes/enrichment.py` - Auto-starts workflow on job creation
- `routes/rounds.py` - Added workflow endpoints

### Infrastructure
- `temporal_worker.py` - Updated with new workflows/activities
- `db/migrations/add_workflow_id_to_enrichment_jobs.sql` - Migration script
- `verify_temporal_setup.py` - Verification script

### Documentation
- `TEMPORAL_MIGRATION_COMPLETE.md` - Full implementation details
- `QUICKSTART_TEMPORAL.md` - This file

## Next Steps for Frontend

Update frontend to use new workflow endpoints:

1. **Coverage Prediction**: Switch to `/api/coverage/predict/workflow` endpoint
2. **Pixel Enrichment**: Already works, just poll job status
3. **Round Generation**: Switch to `/api/areas/<area_id>/rounds/workflow` endpoint

Implement autopolling pattern (same as location upload):
```typescript
const pollWorkflowStatus = async (workflowId: string) => {
  const interval = setInterval(async () => {
    const status = await fetch(`/api/coverage/predict/workflow/${workflowId}/status`)
    const data = await status.json()

    if (data.status === 'completed') {
      clearInterval(interval)
      // Show success message
    } else if (data.status === 'failed') {
      clearInterval(interval)
      // Show error message
    } else {
      // Update progress UI with data.progress
    }
  }, 2000) // Poll every 2 seconds
}
```

## Benefits Summary

✅ **No timeouts** - Workflows can run for hours
✅ **Automatic retries** - Failed activities retry with exponential backoff
✅ **Progress tracking** - Real-time progress via workflow queries
✅ **Full history** - Every step logged in Temporal UI
✅ **Crash recovery** - Workflows survive process restarts
✅ **Horizontal scaling** - Add more workers for parallel processing
✅ **Testing** - Deterministic workflow testing support

## Support

- Temporal UI: http://localhost:8080
- Documentation: See `TEMPORAL_MIGRATION_COMPLETE.md` for details
- Worker logs: Check terminal where `temporal_worker.py` is running
- Temporal logs: `docker logs truecover-temporal -f`
