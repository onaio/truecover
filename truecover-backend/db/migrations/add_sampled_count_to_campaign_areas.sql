-- ABOUTME: Migration to add sampled pixel count tracking to campaign areas
-- ABOUTME: Stores count of pixels selected via adaptive sampling

ALTER TABLE campaign_areas
ADD COLUMN IF NOT EXISTS cached_sampled_count INTEGER DEFAULT 0;
