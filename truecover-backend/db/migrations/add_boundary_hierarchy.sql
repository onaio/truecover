-- ABOUTME: Additive schema for a self-referential admin boundary tree
-- ABOUTME: Lets ward/block/city_corporation/zone rows attach under existing district/upazila/union rows

ALTER TABLE admin_boundaries
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES admin_boundaries(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS boundary_type TEXT,
  ADD COLUMN IF NOT EXISTS source_code TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_boundaries_parent_id ON admin_boundaries(parent_id);

UPDATE admin_boundaries SET boundary_type = CASE level
    WHEN 0 THEN 'country'
    WHEN 1 THEN 'division'
    WHEN 2 THEN 'district'
    WHEN 3 THEN 'upazila'
    WHEN 4 THEN 'union'
END
WHERE boundary_type IS NULL AND level BETWEEN 0 AND 4;
