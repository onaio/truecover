# ABOUTME: Database migration to make locations global (not campaign-scoped)
# ABOUTME: Removes campaign_id from locations, updates constraints and tile functions

from db.connection import get_db_connection, return_db_connection


def run_global_locations_migration():
    """
    Make locations global by removing campaign_id from the locations table.

    Locations associate with campaigns through spatial overlap with campaign areas
    via quadkey/pixel_area joins. The coverage table retains campaign_id since
    coverage predictions are campaign-specific.

    This migration:
    1. Updates coverage unique constraint to include campaign_id
    2. Adds global unique index on external_id
    3. Drops campaign_id from locations
    4. Recreates pixel_location_counts materialized view
    5. Recreates locations_by_campaign tile function
    """
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        print("=" * 60)
        print("GLOBAL LOCATIONS MIGRATION")
        print("=" * 60)

        # Step 1: Update coverage unique constraint
        print("\n[Step 1] Updating coverage unique constraint...")
        cursor.execute("""
            ALTER TABLE coverage DROP CONSTRAINT IF EXISTS coverage_location_id_indicator_id_version_key;
        """)
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'coverage_campaign_location_indicator_version_key'
                ) THEN
                    ALTER TABLE coverage ADD CONSTRAINT coverage_campaign_location_indicator_version_key
                        UNIQUE(campaign_id, location_id, indicator_id, version);
                END IF;
            END $$;
        """)
        print("  - Updated coverage unique constraint to include campaign_id")

        # Step 2: Add global unique index on external_id
        print("\n[Step 2] Adding global unique index on external_id...")
        cursor.execute("""
            DROP INDEX IF EXISTS idx_locations_external_id;
        """)
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_external_id_unique
            ON locations(external_id) WHERE external_id IS NOT NULL;
        """)
        print("  - Created global unique index on external_id")

        # Step 3: Drop campaign_id from locations
        print("\n[Step 3] Dropping campaign_id from locations...")
        cursor.execute("""
            ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_campaign_id_fkey;
        """)
        cursor.execute("""
            DROP INDEX IF EXISTS idx_locations_campaign_id;
        """)
        cursor.execute("""
            ALTER TABLE locations DROP COLUMN IF EXISTS campaign_id;
        """)
        print("  - Dropped campaign_id column from locations")

        # Step 4: Recreate pixel_location_counts materialized view
        print("\n[Step 4] Recreating pixel_location_counts materialized view...")
        cursor.execute("""
            DROP MATERIALIZED VIEW IF EXISTS pixel_location_counts CASCADE;
        """)
        cursor.execute("""
            CREATE MATERIALIZED VIEW pixel_location_counts AS
            SELECT quadkey, COUNT(*) as location_count
            FROM locations WHERE quadkey IS NOT NULL
            GROUP BY quadkey;
        """)
        cursor.execute("""
            CREATE UNIQUE INDEX idx_pixel_location_counts_quadkey
            ON pixel_location_counts(quadkey);
        """)
        print("  - Recreated pixel_location_counts (global, no campaign_id)")

        cursor.execute("REFRESH MATERIALIZED VIEW pixel_location_counts")
        print("  - Refreshed materialized view")

        # Step 5: Recreate locations_by_campaign tile function
        print("\n[Step 5] Recreating locations_by_campaign tile function...")
        cursor.execute("DROP FUNCTION IF EXISTS locations_by_campaign(integer, integer, integer, json) CASCADE;")
        cursor.execute("""
            CREATE OR REPLACE FUNCTION locations_by_campaign(z integer, x integer, y integer, query_params json)
            RETURNS bytea AS $$
            DECLARE
                mvt bytea;
                target_campaign_id uuid;
                target_indicator_id uuid;
            BEGIN
                target_campaign_id := (query_params->>'campaign_id')::uuid;
                target_indicator_id := NULLIF(query_params->>'indicator_id', '')::uuid;

                IF target_campaign_id IS NULL THEN
                    RETURN NULL;
                END IF;

                SELECT INTO mvt ST_AsMVT(tile, 'locations', 4096, 'geom')
                FROM (
                    SELECT DISTINCT ON (l.id)
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
                    JOIN pixel_area pa ON l.quadkey = pa.quadkey
                    JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
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
                    WHERE ca.campaign_id = target_campaign_id
                      AND l.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                ) as tile
                WHERE geom IS NOT NULL;

                RETURN mvt;
            END
            $$ LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE;
        """)
        print("  - Recreated locations_by_campaign with spatial join")

        # Verify
        print("\n[Verify] Checking schema...")
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'locations' AND column_name = 'campaign_id'
        """)
        if cursor.fetchone():
            raise RuntimeError("campaign_id still exists on locations table!")

        cursor.execute("""
            SELECT COUNT(*) FROM locations
        """)
        location_count = cursor.fetchone()[0]
        print(f"  - Locations count: {location_count:,}")

        conn.commit()
        cursor.close()

        print("\n" + "=" * 60)
        print("GLOBAL LOCATIONS MIGRATION COMPLETED SUCCESSFULLY")
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
    run_global_locations_migration()
