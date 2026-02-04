-- Add status column to campaign_areas for tracking workflow progress
ALTER TABLE campaign_areas ADD COLUMN IF NOT EXISTS status TEXT;
