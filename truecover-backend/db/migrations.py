from db.connection import get_db_connection, return_db_connection

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
                mvt bytea;
                target_area_id uuid;
            BEGIN
                -- Extract area_id from query params
                target_area_id := (query_params->>'area_id')::uuid;

                -- If no area_id provided, return empty tile
                IF target_area_id IS NULL THEN
                    RETURN NULL;
                END IF;

                -- Generate MVT tile for pixels in the specified area
                SELECT INTO mvt ST_AsMVT(tile, 'pixels', 4096, 'geom')
                FROM (
                    SELECT
                        ST_AsMVTGeom(
                            ST_Transform(geometry, 3857),
                            ST_TileEnvelope(z, x, y),
                            4096, 64, true
                        ) AS geom,
                        quadkey,
                        level,
                        latitude,
                        longitude
                    FROM pixels
                    WHERE area_id = target_area_id
                      AND geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
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
                END IF;
            END $$;
        """)

        # Create index on last_predicted_at for filtering/sorting
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_coverage_last_predicted_at ON coverage(last_predicted_at);
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
