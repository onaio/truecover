# ABOUTME: Database migration for pixel & campaign refactor
# ABOUTME: Converts area-scoped pixels to global pixels, renames areas to campaigns

from db.connection import get_db_connection, return_db_connection


def run_campaign_refactor_migration():
    """
    Run database migration for pixel & campaign refactor.

    This migration:
    1. Drops the old area-scoped `pixels` table
    2. Renames `pixel_source` to `pixels` (global pixel storage)
    3. Renames `areas` to `campaigns`
    4. Creates `campaign_areas` junction table for multi-area campaigns
    5. Creates `pixel_area` junction table linking pixels to campaign areas
    6. Updates all foreign key references from area_id to campaign_id
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        print("=" * 60)
        print("PIXEL & CAMPAIGN REFACTOR MIGRATION")
        print("=" * 60)

        # Step 1: Drop dependent objects that reference the old pixels table
        print("\n[Step 1] Dropping dependent objects...")

        # Drop the Martin tile function that references old pixels table
        cursor.execute("DROP FUNCTION IF EXISTS pixels_by_area(integer, integer, integer, json) CASCADE;")
        print("  - Dropped pixels_by_area function")

        # Drop the materialized view that references locations.area_id
        cursor.execute("DROP MATERIALIZED VIEW IF EXISTS pixel_location_counts CASCADE;")
        print("  - Dropped pixel_location_counts materialized view")

        # Step 2: Drop old pixels table (area-scoped)
        print("\n[Step 2] Dropping old pixels table...")
        cursor.execute("DROP TABLE IF EXISTS pixels CASCADE;")
        print("  - Dropped old area-scoped pixels table")

        # Step 3: Rename pixel_source to pixels
        print("\n[Step 3] Renaming pixel_source to pixels...")
        cursor.execute("ALTER TABLE IF EXISTS pixel_source RENAME TO pixels;")
        print("  - Renamed pixel_source to pixels")

        # Rename pixel_source indexes
        cursor.execute("ALTER INDEX IF EXISTS pixel_source_pkey RENAME TO pixels_pkey;")
        cursor.execute("ALTER INDEX IF EXISTS idx_pixel_source_adm1_pcode RENAME TO idx_pixels_adm1_pcode;")
        cursor.execute("ALTER INDEX IF EXISTS idx_pixel_source_adm2_pcode RENAME TO idx_pixels_adm2_pcode;")
        cursor.execute("ALTER INDEX IF EXISTS idx_pixel_source_adm3_pcode RENAME TO idx_pixels_adm3_pcode;")
        cursor.execute("ALTER INDEX IF EXISTS idx_pixel_source_adm4_pcode RENAME TO idx_pixels_adm4_pcode;")
        cursor.execute("ALTER INDEX IF EXISTS idx_pixel_source_geometry RENAME TO idx_pixels_geometry;")
        cursor.execute("ALTER INDEX IF EXISTS idx_pixel_source_level RENAME TO idx_pixels_level;")
        print("  - Renamed indexes")

        # Step 4: Rename areas to campaigns
        print("\n[Step 4] Renaming areas to campaigns...")
        cursor.execute("ALTER TABLE IF EXISTS areas RENAME TO campaigns;")
        print("  - Renamed areas to campaigns")

        # Rename areas indexes
        cursor.execute("ALTER INDEX IF EXISTS areas_pkey RENAME TO campaigns_pkey;")
        cursor.execute("ALTER INDEX IF EXISTS idx_areas_project_id RENAME TO idx_campaigns_project_id;")
        cursor.execute("ALTER INDEX IF EXISTS idx_areas_deleted_at RENAME TO idx_campaigns_deleted_at;")
        print("  - Renamed indexes")

        # Step 5: Create campaign_areas table for multi-area campaigns
        print("\n[Step 5] Creating campaign_areas table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS campaign_areas (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                name TEXT,
                area_type TEXT NOT NULL DEFAULT 'admin_boundary',  -- 'admin_boundary' or 'drawn'
                admin_boundary_id UUID REFERENCES admin_boundaries(id) ON DELETE SET NULL,
                geometry GEOMETRY(Geometry, 4326),
                bbox_min_lng DECIMAL(11, 8),
                bbox_min_lat DECIMAL(10, 8),
                bbox_max_lng DECIMAL(11, 8),
                bbox_max_lat DECIMAL(10, 8),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_campaign_areas_campaign_id ON campaign_areas(campaign_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_campaign_areas_admin_boundary_id ON campaign_areas(admin_boundary_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_campaign_areas_geometry ON campaign_areas USING GIST(geometry);")
        print("  - Created campaign_areas table with indexes")

        # Step 6: Create pixel_area junction table
        print("\n[Step 6] Creating pixel_area junction table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pixel_area (
                quadkey TEXT NOT NULL REFERENCES pixels(quadkey) ON DELETE CASCADE,
                campaign_area_id UUID NOT NULL REFERENCES campaign_areas(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (quadkey, campaign_area_id)
            );
        """)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pixel_area_quadkey ON pixel_area(quadkey);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pixel_area_campaign_area_id ON pixel_area(campaign_area_id);")
        print("  - Created pixel_area table with indexes")

        # Step 7: Update foreign key references
        print("\n[Step 7] Updating foreign key references...")

        # Update locations table
        cursor.execute("""
            DO $$
            BEGIN
                -- Drop old FK constraint
                ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_area_id_fkey;

                -- Rename column
                IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'locations' AND column_name = 'area_id') THEN
                    ALTER TABLE locations RENAME COLUMN area_id TO campaign_id;
                END IF;

                -- Add new FK constraint
                ALTER TABLE locations ADD CONSTRAINT locations_campaign_id_fkey
                    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
            END $$;
        """)
        cursor.execute("ALTER INDEX IF EXISTS idx_locations_area_id RENAME TO idx_locations_campaign_id;")
        print("  - Updated locations table")

        # Update rounds table
        cursor.execute("""
            DO $$
            BEGIN
                ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_area_id_fkey;

                IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'rounds' AND column_name = 'area_id') THEN
                    ALTER TABLE rounds RENAME COLUMN area_id TO campaign_id;
                END IF;

                ALTER TABLE rounds ADD CONSTRAINT rounds_campaign_id_fkey
                    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

                -- Also need to update the unique constraint
                ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_area_id_round_number_key;

                -- Check if constraint exists before adding
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_campaign_id_round_number_key') THEN
                    ALTER TABLE rounds ADD CONSTRAINT rounds_campaign_id_round_number_key
                        UNIQUE (campaign_id, round_number);
                END IF;
            END $$;
        """)
        cursor.execute("ALTER INDEX IF EXISTS idx_rounds_area_id RENAME TO idx_rounds_campaign_id;")
        print("  - Updated rounds table")

        # Update coverage table
        cursor.execute("""
            DO $$
            BEGIN
                ALTER TABLE coverage DROP CONSTRAINT IF EXISTS coverage_area_id_fkey;

                IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'coverage' AND column_name = 'area_id') THEN
                    ALTER TABLE coverage RENAME COLUMN area_id TO campaign_id;
                END IF;

                ALTER TABLE coverage ADD CONSTRAINT coverage_campaign_id_fkey
                    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
            END $$;
        """)
        cursor.execute("ALTER INDEX IF EXISTS idx_coverage_area_id RENAME TO idx_coverage_campaign_id;")
        print("  - Updated coverage table")

        # Update coverage_pixel table
        cursor.execute("""
            DO $$
            BEGIN
                ALTER TABLE coverage_pixel DROP CONSTRAINT IF EXISTS coverage_pixel_area_id_fkey;

                IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'coverage_pixel' AND column_name = 'area_id') THEN
                    ALTER TABLE coverage_pixel RENAME COLUMN area_id TO campaign_id;
                END IF;

                ALTER TABLE coverage_pixel ADD CONSTRAINT coverage_pixel_campaign_id_fkey
                    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

                -- Update unique constraint
                ALTER TABLE coverage_pixel DROP CONSTRAINT IF EXISTS coverage_pixel_quadkey_indicator_id_area_id_version_key;

                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coverage_pixel_quadkey_indicator_id_campaign_id_version_key') THEN
                    ALTER TABLE coverage_pixel ADD CONSTRAINT coverage_pixel_quadkey_indicator_id_campaign_id_version_key
                        UNIQUE (quadkey, indicator_id, campaign_id, version);
                END IF;
            END $$;
        """)
        cursor.execute("ALTER INDEX IF EXISTS idx_coverage_pixel_area_id RENAME TO idx_coverage_pixel_campaign_id;")
        print("  - Updated coverage_pixel table")

        # Update enrichment_jobs table
        cursor.execute("""
            DO $$
            BEGIN
                ALTER TABLE enrichment_jobs DROP CONSTRAINT IF EXISTS enrichment_jobs_area_id_fkey;

                IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'enrichment_jobs' AND column_name = 'area_id') THEN
                    ALTER TABLE enrichment_jobs RENAME COLUMN area_id TO campaign_id;
                END IF;

                ALTER TABLE enrichment_jobs ADD CONSTRAINT enrichment_jobs_campaign_id_fkey
                    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
            END $$;
        """)
        cursor.execute("ALTER INDEX IF EXISTS idx_enrichment_jobs_area_id RENAME TO idx_enrichment_jobs_campaign_id;")
        print("  - Updated enrichment_jobs table")

        # Update grids table if it exists
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'grids') THEN
                    ALTER TABLE grids DROP CONSTRAINT IF EXISTS grids_area_id_fkey;

                    IF EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name = 'grids' AND column_name = 'area_id') THEN
                        ALTER TABLE grids RENAME COLUMN area_id TO campaign_id;
                    END IF;

                    ALTER TABLE grids ADD CONSTRAINT grids_campaign_id_fkey
                        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
                END IF;
            END $$;
        """)
        print("  - Updated grids table (if exists)")

        # Step 8: Recreate Martin tile functions with new schema
        print("\n[Step 8] Recreating Martin tile functions...")

        # New pixels_by_campaign function
        cursor.execute("""
            CREATE OR REPLACE FUNCTION pixels_by_campaign(z integer, x integer, y integer, query_params json)
            RETURNS bytea AS $$
            DECLARE
                mvt_polygons bytea;
                mvt_points bytea;
                target_campaign_id uuid;
                target_indicator_id uuid;
                metadata_field text;
            BEGIN
                target_campaign_id := (query_params->>'campaign_id')::uuid;
                target_indicator_id := NULLIF(query_params->>'indicator_id', '')::uuid;
                metadata_field := query_params->>'metadata_field';

                IF target_campaign_id IS NULL THEN
                    RETURN NULL;
                END IF;

                -- Generate MVT tile for pixel polygons
                SELECT INTO mvt_polygons ST_AsMVT(tile, 'pixels', 4096, 'geom')
                FROM (
                    SELECT
                        ST_AsMVTGeom(
                            ST_Transform(p.geometry, 3857),
                            ST_TileEnvelope(z, x, y),
                            4096, 64, true
                        ) AS geom,
                        p.quadkey,
                        p.level,
                        p.latitude,
                        p.longitude,
                        cp.prevalence_prediction,
                        cp.prevalence_bci_width,
                        cp.n_trials,
                        cp.n_covered,
                        cp.rounds,
                        pm.metadata,
                        CASE
                            WHEN metadata_field IS NOT NULL AND pm.metadata IS NOT NULL THEN
                                (pm.metadata->>metadata_field)::numeric
                            ELSE NULL
                        END AS metadata_value
                    FROM pixels p
                    JOIN pixel_area pa ON p.quadkey = pa.quadkey
                    JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                    LEFT JOIN coverage_pixel cp ON p.quadkey = cp.quadkey
                        AND cp.campaign_id = target_campaign_id
                        AND (target_indicator_id IS NULL OR cp.indicator_id = target_indicator_id)
                    LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                    WHERE ca.campaign_id = target_campaign_id
                      AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                ) as tile
                WHERE geom IS NOT NULL;

                -- Only generate centroids when metadata circle visualization is needed
                IF metadata_field IS NOT NULL AND metadata_field != '' THEN
                    SELECT INTO mvt_points ST_AsMVT(tile, 'pixels_centroids', 4096, 'geom')
                    FROM (
                        SELECT
                            ST_AsMVTGeom(
                                ST_Transform(ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326), 3857),
                                ST_TileEnvelope(z, x, y),
                                4096, 64, true
                            ) AS geom,
                            p.quadkey,
                            p.level,
                            CASE
                                WHEN pm.metadata IS NOT NULL THEN
                                    (pm.metadata->>metadata_field)::numeric
                                ELSE NULL
                            END AS metadata_value
                        FROM pixels p
                        JOIN pixel_area pa ON p.quadkey = pa.quadkey
                        JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                        LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                        WHERE ca.campaign_id = target_campaign_id
                          AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                    ) as tile
                    WHERE geom IS NOT NULL;
                END IF;

                RETURN COALESCE(mvt_polygons, ''::bytea) || COALESCE(mvt_points, ''::bytea);
            END
            $$ LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE;
        """)
        print("  - Created pixels_by_campaign function")

        # Update locations_by_area to locations_by_campaign
        cursor.execute("DROP FUNCTION IF EXISTS locations_by_area(integer, integer, integer, json) CASCADE;")
        cursor.execute("""
            CREATE OR REPLACE FUNCTION locations_by_campaign(z integer, x integer, y integer, query_params json)
            RETURNS bytea AS $$
            DECLARE
                mvt bytea;
                target_campaign_id uuid;
                target_indicator_id uuid;
            BEGIN
                -- Extract campaign_id and indicator_id from query params
                target_campaign_id := (query_params->>'campaign_id')::uuid;
                target_indicator_id := NULLIF(query_params->>'indicator_id', '')::uuid;

                -- If no campaign_id provided, return empty tile
                IF target_campaign_id IS NULL THEN
                    RETURN NULL;
                END IF;

                -- Generate MVT tile for locations in the specified campaign
                SELECT INTO mvt ST_AsMVT(tile, 'locations', 4096, 'geom')
                FROM (
                    SELECT
                        ST_AsMVTGeom(
                            CASE
                                WHEN z < 10 THEN ST_Simplify(ST_Transform(l.geometry, 3857), 100)
                                WHEN z < 12 THEN ST_Simplify(ST_Transform(l.geometry, 3857), 50)
                                WHEN z < 14 THEN ST_Simplify(ST_Transform(l.geometry, 3857), 20)
                                WHEN z < 16 THEN ST_Simplify(ST_Transform(l.geometry, 3857), 5)
                                ELSE ST_Transform(l.geometry, 3857)
                            END,
                            ST_TileEnvelope(z, x, y),
                            4096, 256, true
                        ) AS geom,
                        l.id::text,
                        l.external_id,
                        l.latitude,
                        l.longitude,
                        l.properties,
                        c.rounds,
                        c.n_trials,
                        c.n_covered,
                        c.prevalence_prediction,
                        c.prevalence_bci_width,
                        c.exceedance_probability,
                        c.exceedance_uncertainty
                    FROM locations l
                    LEFT JOIN LATERAL (
                        SELECT
                            rounds,
                            n_trials,
                            n_covered,
                            prevalence_prediction,
                            prevalence_bci_width,
                            exceedance_probability,
                            exceedance_uncertainty
                        FROM coverage
                        WHERE location_id = l.id
                          AND campaign_id = target_campaign_id
                          AND (target_indicator_id IS NULL OR indicator_id = target_indicator_id)
                        ORDER BY version DESC
                        LIMIT 1
                    ) c ON true
                    WHERE l.campaign_id = target_campaign_id
                      AND l.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                ) as tile
                WHERE geom IS NOT NULL;

                RETURN mvt;
            END
            $$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;
        """)
        print("  - Created locations_by_campaign function")

        # Step 9: Recreate materialized view with new column name
        print("\n[Step 9] Recreating materialized view...")
        cursor.execute("""
            CREATE MATERIALIZED VIEW IF NOT EXISTS pixel_location_counts AS
            SELECT
                quadkey,
                campaign_id,
                COUNT(*) as location_count
            FROM locations
            WHERE quadkey IS NOT NULL
            GROUP BY quadkey, campaign_id
        """)

        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pixel_location_counts_quadkey_campaign
            ON pixel_location_counts(quadkey, campaign_id)
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_pixel_location_counts_quadkey
            ON pixel_location_counts(quadkey)
        """)

        cursor.execute("REFRESH MATERIALIZED VIEW pixel_location_counts")
        print("  - Recreated pixel_location_counts materialized view")

        # Step 10: Verify pixel count
        print("\n[Step 10] Verifying migration...")
        cursor.execute("SELECT COUNT(*) FROM pixels")
        pixel_count = cursor.fetchone()[0]
        print(f"  - Pixel count: {pixel_count:,}")

        cursor.execute("SELECT COUNT(*) FROM campaigns")
        campaign_count = cursor.fetchone()[0]
        print(f"  - Campaign count: {campaign_count}")

        conn.commit()
        cursor.close()

        print("\n" + "=" * 60)
        print("MIGRATION COMPLETED SUCCESSFULLY")
        print("=" * 60)

        return True

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"\nERROR: Migration failed: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        if conn:
            return_db_connection(conn)


def run_stratified_cluster_sampling_migration():
    """
    Add support for stratified cluster sampling.

    This migration:
    1. Adds sampling_method column to rounds table
    2. Creates cluster_sampling_config table
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        print("=" * 60)
        print("STRATIFIED CLUSTER SAMPLING MIGRATION")
        print("=" * 60)

        # Step 1: Add sampling_method column to rounds
        print("\n[Step 1] Adding sampling_method column to rounds...")
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name = 'rounds' AND column_name = 'sampling_method') THEN
                    ALTER TABLE rounds ADD COLUMN sampling_method TEXT DEFAULT 'simple';
                END IF;
            END $$;
        """)
        print("  - Added sampling_method column to rounds table")

        # Step 2: Create cluster_sampling_config table
        print("\n[Step 2] Creating cluster_sampling_config table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cluster_sampling_config (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
                campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                starting_pcode TEXT NOT NULL,
                categories JSONB NOT NULL,
                upazila_count INTEGER NOT NULL,
                unions_per_upazila INTEGER NOT NULL,
                pixels_per_union INTEGER NOT NULL,
                population_weighted BOOLEAN DEFAULT FALSE,
                category_weights JSONB,
                min_population INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            );
        """)
        print("  - Created cluster_sampling_config table")

        # Step 3: Create indexes
        print("\n[Step 3] Creating indexes...")
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_cluster_sampling_config_round_id
            ON cluster_sampling_config(round_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_cluster_sampling_config_campaign_id
            ON cluster_sampling_config(campaign_id);
        """)
        print("  - Created indexes on cluster_sampling_config")

        conn.commit()
        cursor.close()

        print("\n" + "=" * 60)
        print("STRATIFIED CLUSTER SAMPLING MIGRATION COMPLETED")
        print("=" * 60)

        return True

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"\nERROR: Migration failed: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        if conn:
            return_db_connection(conn)


if __name__ == "__main__":
    run_campaign_refactor_migration()
    run_stratified_cluster_sampling_migration()
