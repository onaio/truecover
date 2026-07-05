-- ABOUTME: Renames cluster_sampling_config's rural-specific columns to generic stage names
-- ABOUTME: Replaces starting_pcode with starting_boundary_id so city corporations (no pcode) can start a round

BEGIN;

ALTER TABLE cluster_sampling_config RENAME COLUMN upazila_count TO stage1_count;
ALTER TABLE cluster_sampling_config RENAME COLUMN unions_per_upazila TO stage2_count;
ALTER TABLE cluster_sampling_config RENAME COLUMN pixels_per_union TO pixels_per_stage2;

ALTER TABLE cluster_sampling_config ADD COLUMN starting_boundary_id UUID REFERENCES admin_boundaries(id);

UPDATE cluster_sampling_config csc
SET starting_boundary_id = ab.id
FROM admin_boundaries ab
WHERE ab.adm2_pcode = csc.starting_pcode AND ab.level = 2;

ALTER TABLE cluster_sampling_config ALTER COLUMN starting_boundary_id SET NOT NULL;
ALTER TABLE cluster_sampling_config DROP COLUMN starting_pcode;

CREATE INDEX IF NOT EXISTS idx_cluster_sampling_config_starting_boundary_id
  ON cluster_sampling_config(starting_boundary_id);

COMMIT;
