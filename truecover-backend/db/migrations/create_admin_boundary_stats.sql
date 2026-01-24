-- Pre-computed statistics and pixel mappings for all admin boundaries
-- Uses hierarchical approach: compute for unions (level 4), roll up to parents

-- Stats table for quick lookups
CREATE TABLE IF NOT EXISTS admin_boundary_stats (
    admin_boundary_id UUID PRIMARY KEY REFERENCES admin_boundaries(id) ON DELETE CASCADE,
    pixel_count INTEGER NOT NULL DEFAULT 0,
    population NUMERIC NOT NULL DEFAULT 0,
    computed_at TIMESTAMP DEFAULT NOW()
);

-- Pre-computed pixel-to-admin-boundary mappings (only for level 4 unions)
CREATE TABLE IF NOT EXISTS admin_boundary_pixels (
    admin_boundary_id UUID NOT NULL REFERENCES admin_boundaries(id) ON DELETE CASCADE,
    quadkey TEXT NOT NULL,
    PRIMARY KEY (admin_boundary_id, quadkey)
);

CREATE INDEX IF NOT EXISTS idx_admin_boundary_pixels_quadkey ON admin_boundary_pixels(quadkey);
