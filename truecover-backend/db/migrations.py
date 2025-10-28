from db.connection import get_db_connection, return_db_connection
import mercantile

def run_migrations():
    """Run database migrations"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Create users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                clerk_id TEXT UNIQUE NOT NULL,
                email TEXT NOT NULL,
                name TEXT,
                organization TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create index on clerk_id for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
        """)

        # Create organizations table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS organizations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create organization_members table (junction table for many-to-many relationship)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS organization_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT DEFAULT 'member',
                joined_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(organization_id, user_id)
            );
        """)

        # Create indexes on organization_members for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);
        """)

        # Create projects table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create index on organization_id for faster project lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(organization_id);
        """)

        # Enable PostGIS extension for spatial data
        cursor.execute("""
            CREATE EXTENSION IF NOT EXISTS postgis;
        """)

        # Drop visits table if it exists (no longer needed) - do this early before other migrations
        cursor.execute("""
            DROP TABLE IF EXISTS visits CASCADE;
        """)

        # Create areas table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS areas (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create index on project_id for faster area lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_areas_project_id ON areas(project_id);
        """)

        # Add deleted_at column to areas table for soft delete
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'areas') THEN
                    ALTER TABLE areas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
                END IF;
            END $$;
        """)

        # Create index on deleted_at for filtering queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_areas_deleted_at ON areas(deleted_at) WHERE deleted_at IS NULL;
        """)

        # Create locations table with PostGIS geometry
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS locations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
                external_id TEXT,
                geometry GEOMETRY(Geometry, 4326),
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                properties JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Add new columns to existing locations table if they don't exist, and drop old columns
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'locations') THEN
                    ALTER TABLE locations ADD COLUMN IF NOT EXISTS external_id TEXT;
                    ALTER TABLE locations ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb;
                    ALTER TABLE locations ADD COLUMN IF NOT EXISTS quadkey TEXT;
                    ALTER TABLE locations DROP COLUMN IF EXISTS version;
                    ALTER TABLE locations DROP COLUMN IF EXISTS sources;
                    ALTER TABLE locations DROP COLUMN IF EXISTS exceedance_probability;
                    ALTER TABLE locations DROP COLUMN IF EXISTS exceedance_uncertainty;
                    ALTER TABLE locations DROP COLUMN IF EXISTS prevalence_bci_width;
                    ALTER TABLE locations DROP COLUMN IF EXISTS prevalence_prediction;
                    ALTER TABLE locations DROP COLUMN IF EXISTS adaptively_selected;
                END IF;
            END $$;
        """)

        # Create spatial index on geometry column
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_locations_geometry ON locations USING GIST(geometry);
        """)

        # Create index on area_id for faster location lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_locations_area_id ON locations(area_id);
        """)

        # Create index on lat/lng for bounding box queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_locations_coords ON locations(latitude, longitude);
        """)

        # Create index on external_id for faster duplicate detection
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_locations_external_id ON locations(external_id) WHERE external_id IS NOT NULL;
        """)

        # Create index on quadkey for spatial queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_locations_quadkey ON locations(quadkey);
        """)

        # Create pixels table for quadkey pixel grids
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pixels (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                quadkey TEXT NOT NULL,
                area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
                geometry GEOMETRY(Polygon, 4326),
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                level INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create spatial index on pixel geometry column
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_pixels_geometry ON pixels USING GIST(geometry);
        """)

        # Create index on area_id for faster pixel lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_pixels_area_id ON pixels(area_id);
        """)

        # Create unique index on quadkey to prevent duplicates
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pixels_quadkey_unique ON pixels(quadkey);
        """)

        # Create index on level for zoom-based queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_pixels_level ON pixels(level);
        """)

        # Create Martin tile server function for pixels filtered by area_id
        cursor.execute("""
            CREATE OR REPLACE FUNCTION pixels_by_area(z integer, x integer, y integer, query_params json)
            RETURNS bytea AS $$
            DECLARE
                mvt_polygons bytea;
                mvt_points bytea;
                target_area_id uuid;
                target_indicator_id uuid;
                metadata_field text;
            BEGIN
                -- Extract area_id, indicator_id, and metadata_field from query params
                target_area_id := (query_params->>'area_id')::uuid;
                target_indicator_id := (query_params->>'indicator_id')::uuid;
                metadata_field := query_params->>'metadata_field';

                -- If no area_id provided, return empty tile
                IF target_area_id IS NULL THEN
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
                        pm.metadata,
                        -- Extract specific metadata field as metadata_value for visualization
                        CASE
                            WHEN metadata_field IS NOT NULL AND pm.metadata IS NOT NULL THEN
                                (pm.metadata->>metadata_field)::numeric
                            ELSE NULL
                        END AS metadata_value
                    FROM pixels p
                    LEFT JOIN coverage_pixel cp ON p.quadkey = cp.quadkey
                        AND cp.area_id = target_area_id
                        AND (target_indicator_id IS NULL OR cp.indicator_id = target_indicator_id)
                    LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                    WHERE p.area_id = target_area_id
                      AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                ) as tile
                WHERE geom IS NOT NULL;

                -- Generate MVT tile for pixel centroids (points)
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
                        -- Extract specific metadata field as metadata_value for visualization
                        CASE
                            WHEN metadata_field IS NOT NULL AND pm.metadata IS NOT NULL THEN
                                (pm.metadata->>metadata_field)::numeric
                            ELSE NULL
                        END AS metadata_value
                    FROM pixels p
                    LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                    WHERE p.area_id = target_area_id
                      AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                ) as tile
                WHERE geom IS NOT NULL;

                -- Combine both MVT layers
                RETURN mvt_polygons || mvt_points;
            END
            $$ LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE;
        """)

        # Create Martin tile server function for locations filtered by area_id
        cursor.execute("""
            CREATE OR REPLACE FUNCTION locations_by_area(z integer, x integer, y integer, query_params json)
            RETURNS bytea AS $$
            DECLARE
                mvt bytea;
                target_area_id uuid;
                target_indicator_id uuid;
            BEGIN
                -- Extract area_id and indicator_id from query params
                target_area_id := (query_params->>'area_id')::uuid;
                target_indicator_id := (query_params->>'indicator_id')::uuid;

                -- If no area_id provided, return empty tile
                IF target_area_id IS NULL THEN
                    RETURN NULL;
                END IF;

                -- Generate MVT tile for locations in the specified area
                -- Join with coverage table to get prediction data if indicator_id provided
                SELECT INTO mvt ST_AsMVT(tile, 'locations', 4096, 'geom')
                FROM (
                    SELECT
                        ST_AsMVTGeom(
                            ST_Transform(l.geometry, 3857),
                            ST_TileEnvelope(z, x, y),
                            4096, 64, true
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
                          AND area_id = target_area_id
                          AND (target_indicator_id IS NULL OR indicator_id = target_indicator_id)
                        ORDER BY version DESC
                        LIMIT 1
                    ) c ON true
                    WHERE l.area_id = target_area_id
                      AND l.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                ) as tile
                WHERE geom IS NOT NULL;

                RETURN mvt;
            END
            $$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;
        """)

        # Create rounds table for tracking data collection rounds
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rounds (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
                round_number INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                start_date DATE,
                end_date DATE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(area_id, round_number)
            );
        """)

        # Create index on area_id for faster round lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_rounds_area_id ON rounds(area_id);
        """)

        # Remove rounds column from locations table if it exists
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'locations') THEN
                    -- Drop the GIN index first
                    DROP INDEX IF EXISTS idx_locations_rounds;
                    -- Then drop the column
                    ALTER TABLE locations DROP COLUMN IF EXISTS rounds;
                END IF;
            END $$;
        """)

        # Create indicators table for project-level indicators
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS indicators (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(project_id, name)
            );
        """)

        # Create index on project_id for faster indicator lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_indicators_project_id ON indicators(project_id);
        """)

        # Create visit_indicators table for tracking indicator measurements
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS visit_indicators (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                upload_id UUID NOT NULL,
                round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
                location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
                indicator_id UUID NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
                n_trials INTEGER NOT NULL,
                n_covered INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Rename n_positive to n_covered if the table exists
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.columns
                          WHERE table_name = 'visit_indicators'
                          AND column_name = 'n_positive') THEN
                    ALTER TABLE visit_indicators RENAME COLUMN n_positive TO n_covered;
                END IF;
            END $$;
        """)

        # Remove visit_id column and add upload_id if table exists, also remove prediction fields
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'visit_indicators') THEN
                    -- Drop old visit_id constraint and column
                    ALTER TABLE visit_indicators DROP CONSTRAINT IF EXISTS visit_indicators_visit_id_fkey;
                    ALTER TABLE visit_indicators DROP COLUMN IF EXISTS visit_id;

                    -- Add new columns if they don't exist
                    ALTER TABLE visit_indicators ADD COLUMN IF NOT EXISTS upload_id UUID NOT NULL DEFAULT gen_random_uuid();
                    ALTER TABLE visit_indicators ADD COLUMN IF NOT EXISTS round_id UUID REFERENCES rounds(id) ON DELETE CASCADE;

                    -- Drop prediction/analysis columns that are no longer needed
                    ALTER TABLE visit_indicators DROP COLUMN IF EXISTS exceedance_probability;
                    ALTER TABLE visit_indicators DROP COLUMN IF EXISTS exceedance_uncertainty;
                    ALTER TABLE visit_indicators DROP COLUMN IF EXISTS prevalence_bci_width;
                    ALTER TABLE visit_indicators DROP COLUMN IF EXISTS prevalence_prediction;
                END IF;
            END $$;
        """)

        # Create indexes on visit_indicators table for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_visit_indicators_upload_id ON visit_indicators(upload_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_visit_indicators_round_id ON visit_indicators(round_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_visit_indicators_location_id ON visit_indicators(location_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_visit_indicators_indicator_id ON visit_indicators(indicator_id);
        """)

        # Drop old visit_id index if it exists
        cursor.execute("""
            DROP INDEX IF EXISTS idx_visit_indicators_visit_id;
        """)

        # Create coverage table for storing prediction results
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS coverage (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
                area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
                indicator_id UUID NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
                version INTEGER NOT NULL,
                n_trials INTEGER NOT NULL,
                n_covered INTEGER NOT NULL,
                exceedance_probability DECIMAL(10, 8),
                exceedance_uncertainty DECIMAL(10, 8),
                prevalence_bci_width DECIMAL(10, 8),
                prevalence_prediction DECIMAL(10, 8),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(location_id, indicator_id, version)
            );
        """)

        # Create indexes on coverage table for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_location_id ON coverage(location_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_area_id ON coverage(area_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_indicator_id ON coverage(indicator_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_version ON coverage(indicator_id, version);
        """)

        # Add rounds column to coverage table (integer array to track which rounds include this location)
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'coverage') THEN
                    ALTER TABLE coverage ADD COLUMN IF NOT EXISTS rounds INTEGER[] DEFAULT '{}';
                END IF;
            END $$;
        """)

        # Create index on rounds column for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_rounds ON coverage USING GIN(rounds);
        """)

        # Add last_predicted_at column to coverage table to track when predictions were last generated
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'coverage') THEN
                    ALTER TABLE coverage ADD COLUMN IF NOT EXISTS last_predicted_at TIMESTAMP;
                    ALTER TABLE coverage ADD COLUMN IF NOT EXISTS quadkey TEXT;
                END IF;
            END $$;
        """)

        # Create index on last_predicted_at for filtering/sorting
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_last_predicted_at ON coverage(last_predicted_at);
        """)

        # Create index on quadkey for spatial queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_quadkey ON coverage(quadkey);
        """)

        # Create coverage_pixel table for storing aggregated pixel-level predictions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS coverage_pixel (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                quadkey TEXT NOT NULL,
                area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
                indicator_id UUID NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
                version INTEGER NOT NULL,
                n_trials INTEGER NOT NULL,
                n_covered INTEGER NOT NULL,
                rounds INTEGER[] DEFAULT '{}',
                exceedance_probability DECIMAL(10, 8),
                exceedance_uncertainty DECIMAL(10, 8),
                prevalence_bci_width DECIMAL(10, 8),
                prevalence_prediction DECIMAL(10, 8),
                last_predicted_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(quadkey, indicator_id, area_id, version)
            );
        """)

        # Create indexes on coverage_pixel table for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_pixel_quadkey ON coverage_pixel(quadkey);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_pixel_area_id ON coverage_pixel(area_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_pixel_indicator_id ON coverage_pixel(indicator_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_pixel_version ON coverage_pixel(indicator_id, version);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_pixel_rounds ON coverage_pixel USING GIN(rounds);
        """)

        # Create pixel_metadata_definitions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pixel_metadata_definitions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                data_type TEXT NOT NULL,
                unit TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create pixel_metadata table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pixel_metadata (
                quadkey TEXT PRIMARY KEY,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create GIN index on pixel_metadata JSONB column for fast queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_pixel_metadata_data ON pixel_metadata USING GIN(metadata);
        """)

        # Create data_sources table for managing COG/STAC data sources
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS data_sources (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                source_type TEXT NOT NULL DEFAULT 'stac',
                stac_catalog_url TEXT,
                stac_collection TEXT,
                stac_item TEXT,
                stac_asset TEXT DEFAULT 'cog',
                cog_url TEXT,
                default_statistic TEXT DEFAULT 'sum',
                metadata_field_name TEXT NOT NULL,
                metadata_field_description TEXT,
                metadata_field_type TEXT NOT NULL,
                metadata_field_unit TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Create enrichment_jobs table for tracking async enrichment jobs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS enrichment_jobs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
                data_source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
                statistic TEXT NOT NULL,
                status TEXT NOT NULL,
                pixels_processed INTEGER DEFAULT 0,
                pixels_total INTEGER DEFAULT 0,
                error_message TEXT,
                retry_count INTEGER DEFAULT 0,
                last_attempted_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)

        # Add retry tracking columns to existing enrichment_jobs table
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'enrichment_jobs') THEN
                    ALTER TABLE enrichment_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
                    ALTER TABLE enrichment_jobs ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMP;
                END IF;
            END $$;
        """)

        # Create indexes on enrichment_jobs table
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_area_id ON enrichment_jobs(area_id);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status);
        """)

        # Add indicator_id to rounds table
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'rounds') THEN
                    -- Add indicator_id column (nullable initially to allow existing rows)
                    ALTER TABLE rounds ADD COLUMN IF NOT EXISTS indicator_id UUID REFERENCES indicators(id) ON DELETE CASCADE;
                END IF;
            END $$;
        """)

        # Create index on indicator_id in rounds table
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_rounds_indicator_id ON rounds(indicator_id);
        """)

        # Drop visit_indicators table (no longer used)
        cursor.execute("""
            DROP TABLE IF EXISTS visit_indicators CASCADE;
        """)

        # Drop round_id column from coverage table (replaced by rounds array)
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.columns
                          WHERE table_name = 'coverage' AND column_name = 'round_id') THEN
                    -- Drop the index first
                    DROP INDEX IF EXISTS idx_coverage_round_id;
                    -- Then drop the column
                    ALTER TABLE coverage DROP COLUMN round_id;
                END IF;
            END $$;
        """)

        # Backfill quadkeys for existing locations
        print("Backfilling quadkeys for existing locations...")
        cursor.execute("""
            SELECT id, latitude, longitude FROM locations
            WHERE quadkey IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
        """)
        locations_to_update = cursor.fetchall()

        quadkey_level = 18
        location_updates = []
        for location_id, lat, lng in locations_to_update:
            try:
                tile = mercantile.tile(float(lng), float(lat), quadkey_level)
                quadkey = mercantile.quadkey(tile)
                location_updates.append((quadkey, location_id))
            except Exception as e:
                print(f"Warning: Could not calculate quadkey for location {location_id}: {e}")

        if location_updates:
            cursor.executemany("""
                UPDATE locations SET quadkey = %s WHERE id = %s
            """, location_updates)
            print(f"Backfilled {len(location_updates)} location quadkeys")
        else:
            print("No locations to backfill")

        # Backfill quadkeys for existing coverage records
        print("Backfilling quadkeys for existing coverage records...")
        cursor.execute("""
            SELECT c.id, l.latitude, l.longitude
            FROM coverage c
            JOIN locations l ON c.location_id = l.id
            WHERE c.quadkey IS NULL AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
        """)
        coverage_to_update = cursor.fetchall()

        coverage_updates = []
        for coverage_id, lat, lng in coverage_to_update:
            try:
                tile = mercantile.tile(float(lng), float(lat), quadkey_level)
                quadkey = mercantile.quadkey(tile)
                coverage_updates.append((quadkey, coverage_id))
            except Exception as e:
                print(f"Warning: Could not calculate quadkey for coverage {coverage_id}: {e}")

        if coverage_updates:
            cursor.executemany("""
                UPDATE coverage SET quadkey = %s WHERE id = %s
            """, coverage_updates)
            print(f"Backfilled {len(coverage_updates)} coverage quadkeys")
        else:
            print("No coverage records to backfill")

        conn.commit()
        print("Database migrations completed successfully")

        cursor.close()
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error running migrations: {e}")
        raise
    finally:
        if conn:
            return_db_connection(conn)

if __name__ == "__main__":
    run_migrations()
