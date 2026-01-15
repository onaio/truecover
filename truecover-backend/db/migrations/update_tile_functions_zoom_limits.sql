-- ABOUTME: Updates tile functions to limit features at lower zoom levels
-- ABOUTME: Prevents tile overflow and enables viewing buildings at zoomed out levels

-- Update locations_by_area to limit features at lower zoom levels
CREATE OR REPLACE FUNCTION locations_by_area(z integer, x integer, y integer, query_params json)
RETURNS bytea AS $$
DECLARE
    mvt bytea;
    target_area_id uuid;
    target_indicator_id uuid;
    feature_limit integer;
BEGIN
    target_area_id := (query_params->>'area_id')::uuid;
    target_indicator_id := (query_params->>'indicator_id')::uuid;

    IF target_area_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Limit features at lower zoom levels to prevent tile overflow
    feature_limit := CASE
        WHEN z < 10 THEN 500
        WHEN z < 12 THEN 1000
        WHEN z < 14 THEN 2000
        WHEN z < 16 THEN 5000
        ELSE NULL  -- No limit at high zoom
    END;

    SELECT INTO mvt ST_AsMVT(tile, 'locations', 4096, 'geom')
    FROM (
        SELECT
            ST_AsMVTGeom(
                CASE
                    WHEN z < 12 THEN ST_Simplify(ST_Transform(l.geometry, 3857), 10)
                    WHEN z < 14 THEN ST_Simplify(ST_Transform(l.geometry, 3857), 5)
                    WHEN z < 16 THEN ST_Simplify(ST_Transform(l.geometry, 3857), 2)
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
              AND area_id = target_area_id
              AND (target_indicator_id IS NULL OR indicator_id = target_indicator_id)
            ORDER BY version DESC
            LIMIT 1
        ) c ON true
        WHERE l.area_id = target_area_id
          AND l.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
        ORDER BY c.prevalence_bci_width DESC NULLS LAST  -- Prioritize higher uncertainty
        LIMIT feature_limit
    ) as tile
    WHERE geom IS NOT NULL;

    RETURN mvt;
END
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Update pixels_by_area to limit features at lower zoom levels
CREATE OR REPLACE FUNCTION pixels_by_area(z integer, x integer, y integer, query_params json)
RETURNS bytea AS $$
DECLARE
    mvt_polygons bytea;
    mvt_points bytea;
    target_area_id uuid;
    target_indicator_id uuid;
    metadata_field text;
    feature_limit integer;
BEGIN
    target_area_id := (query_params->>'area_id')::uuid;
    target_indicator_id := (query_params->>'indicator_id')::uuid;
    metadata_field := query_params->>'metadata_field';

    IF target_area_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Limit features at lower zoom levels
    feature_limit := CASE
        WHEN z < 10 THEN 500
        WHEN z < 12 THEN 1000
        WHEN z < 14 THEN 2000
        WHEN z < 16 THEN 5000
        ELSE NULL
    END;

    SELECT ST_AsMVT(tile, 'pixels', 4096, 'geom') INTO mvt_polygons
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
            cp.rounds::text,
            pm.metadata::text,
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
        ORDER BY cp.prevalence_bci_width DESC NULLS LAST
        LIMIT feature_limit
    ) as tile
    WHERE geom IS NOT NULL;

    SELECT ST_AsMVT(tile, 'pixels_centroids', 4096, 'geom') INTO mvt_points
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
                WHEN metadata_field IS NOT NULL AND pm.metadata IS NOT NULL THEN
                    (pm.metadata->>metadata_field)::numeric
                ELSE NULL
            END AS metadata_value
        FROM pixels p
        LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
        WHERE p.area_id = target_area_id
          AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
        LIMIT feature_limit
    ) as tile
    WHERE geom IS NOT NULL;

    RETURN COALESCE(mvt_polygons, ''::bytea) || COALESCE(mvt_points, ''::bytea);
END
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
