-- Add workflow_id column to enrichment_jobs table for Temporal integration
-- This allows tracking which Temporal workflow is processing each enrichment job

ALTER TABLE enrichment_jobs
ADD COLUMN IF NOT EXISTS workflow_id VARCHAR(255);

-- Add index for efficient workflow lookups
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_workflow_id
ON enrichment_jobs(workflow_id);

-- Add comment to explain the column
COMMENT ON COLUMN enrichment_jobs.workflow_id IS 'Temporal workflow ID that is processing this enrichment job';
