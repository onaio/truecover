# Restart Backend to Use Temporal

## Quick Restart

1. **Stop the backend** (Ctrl+C in the terminal running app.py)

2. **Make sure the Temporal worker is running:**
```bash
# In terminal 1:
cd truecover-backend
PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python temporal_worker.py
```

3. **Start the backend:**
```bash
# In terminal 2:
cd truecover-backend
PORT=5001 PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python app.py
```

## What Changed

The `/api/areas/<area_id>/pixels/generate` endpoint now **automatically** starts a Temporal workflow instead of doing synchronous work.

**Response format changed:**
- Before: `{"count": 500, "level": 18}`
- Now: `{"workflow_id": "pixel-generation-...", "status": "started", "message": "..."}`

## Frontend Needs Update

The frontend needs to handle the new response format and poll for status:

```typescript
// When generating pixels
const response = await fetch('/api/areas/${areaId}/pixels/generate', {
  method: 'POST',
  body: JSON.stringify({ bbox, level, admin_pcode })
})

const data = await response.json()

if (data.workflow_id) {
  // Start polling for status
  pollPixelGenerationStatus(data.workflow_id)
} else {
  // Old response format (shouldn't happen after backend restart)
  console.log(`Generated ${data.count} pixels`)
}

// Poll for status
function pollPixelGenerationStatus(workflowId: string) {
  const interval = setInterval(async () => {
    const status = await fetch(`/api/pixels/generate/workflow/${workflowId}/status`)
    const data = await status.json()

    if (data.status === 'completed') {
      clearInterval(interval)
      console.log(`Generated ${data.result.count} pixels`)
      // Refresh pixel stats
    } else if (data.status === 'failed') {
      clearInterval(interval)
      console.error('Pixel generation failed:', data.error)
    } else {
      // Show progress
      console.log(`Progress: ${data.progress?.pixels_inserted || 0} pixels`)
    }
  }, 2000)
}
```

## Verify It's Working

After restart, generate pixels and check:

1. **Backend logs** should show: `Started pixel generation workflow: pixel-generation-...`
2. **Temporal UI** (http://localhost:8080) should show the workflow running
3. **Worker logs** should show activity execution

If you don't see these, the backend might not have reloaded the route changes.
