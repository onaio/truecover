-- ABOUTME: Migration to add replacement_for column to coverage_pixel table.
-- ABOUTME: Links replacement pixels to their primary sampled pixel.

ALTER TABLE coverage_pixel
ADD COLUMN IF NOT EXISTS replacement_for UUID REFERENCES coverage_pixel(id);

CREATE INDEX IF NOT EXISTS idx_coverage_pixel_replacement_for
ON coverage_pixel(replacement_for) WHERE replacement_for IS NOT NULL;
