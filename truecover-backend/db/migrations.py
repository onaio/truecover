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

        # Rename locations table to areas if it exists
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'locations') THEN
                    ALTER TABLE locations RENAME TO areas;
                    ALTER INDEX IF EXISTS idx_locations_project_id RENAME TO idx_areas_project_id;
                END IF;
            END $$;
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

        # Rename location_features table to locations if it exists
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'location_features') THEN
                    ALTER TABLE location_features RENAME TO locations;
                    ALTER TABLE locations RENAME COLUMN location_id TO area_id;
                    ALTER INDEX IF EXISTS idx_location_features_geometry RENAME TO idx_locations_geometry;
                    ALTER INDEX IF EXISTS idx_location_features_location_id RENAME TO idx_locations_area_id;
                    ALTER INDEX IF EXISTS idx_location_features_coords RENAME TO idx_locations_coords;
                ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'area_features') THEN
                    ALTER TABLE area_features RENAME TO locations;
                    ALTER INDEX IF EXISTS idx_area_features_geometry RENAME TO idx_locations_geometry;
                    ALTER INDEX IF EXISTS idx_area_features_area_id RENAME TO idx_locations_area_id;
                    ALTER INDEX IF EXISTS idx_area_features_coords RENAME TO idx_locations_coords;
                END IF;
            END $$;
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

        # Add rounds column to locations table to track which rounds selected each location
        cursor.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'locations') THEN
                    ALTER TABLE locations ADD COLUMN IF NOT EXISTS rounds INTEGER[] DEFAULT '{}';
                END IF;
            END $$;
        """)

        # Create GIN index on rounds array for efficient queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_locations_rounds ON locations USING GIN(rounds);
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
