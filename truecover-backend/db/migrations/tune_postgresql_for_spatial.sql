-- ABOUTME: PostgreSQL configuration tuning for spatial tile queries.
-- ABOUTME: Run these after database setup to optimize tile generation performance.

-- Lower random_page_cost for SSD/cached workloads.
-- Default (4.0) makes the planner avoid spatial indexes in favor of
-- sequential scans on large tables like pixels (7M+ rows).
ALTER SYSTEM SET random_page_cost = 1.1;

-- Larger work_mem for hash joins used in tile queries.
ALTER SYSTEM SET work_mem = '16MB';

-- Tell the planner how much memory is available for caching.
ALTER SYSTEM SET effective_cache_size = '6GB';

-- Apply changes without restart.
SELECT pg_reload_conf();

-- Refresh table statistics so the planner has accurate row estimates.
ANALYZE pixels;
ANALYZE pixel_area;
ANALYZE coverage_pixel;
ANALYZE campaign_areas;
