-- Add cached statistics columns to campaign_areas table
-- These values are computed once when pixels are computed and avoid expensive joins on every load

ALTER TABLE campaign_areas
ADD COLUMN IF NOT EXISTS cached_pixel_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS cached_population NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS cached_building_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS cached_sampled_population NUMERIC DEFAULT 0;

COMMENT ON COLUMN campaign_areas.cached_pixel_count IS 'Cached count of pixels in this area, updated when pixels are computed';
COMMENT ON COLUMN campaign_areas.cached_population IS 'Cached sum of population from all pixels in this area';
COMMENT ON COLUMN campaign_areas.cached_building_count IS 'Cached count of buildings/locations in this area';
COMMENT ON COLUMN campaign_areas.cached_sampled_population IS 'Cached sum of population from sampled pixels in this area';
