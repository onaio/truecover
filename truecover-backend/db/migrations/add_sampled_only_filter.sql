-- ABOUTME: Adds sampled_only query parameter to pixels_by_campaign tile function.
-- ABOUTME: When sampled_only=true, only pixels with assigned rounds are returned.
CREATE OR REPLACE FUNCTION pixels_by_campaign(z integer, x integer, y integer, query_params json)
RETURNS bytea AS $$
DECLARE
    mvt_polygons bytea;
    mvt_points bytea;
    mvt_labels bytea;
    target_campaign_id uuid;
    target_indicator_id uuid;
    metadata_field text;
    sampled_only boolean;
BEGIN
    target_campaign_id := (query_params->>'campaign_id')::uuid;
    target_indicator_id := NULLIF(query_params->>'indicator_id', '')::uuid;
    metadata_field := query_params->>'metadata_field';
    sampled_only := COALESCE((query_params->>'sampled_only')::boolean, false);

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
            (cp.replacement_for IS NOT NULL) AS is_replacement,
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
        LEFT JOIN coverage_pixel primary_cp ON cp.replacement_for = primary_cp.id
        LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
        WHERE ca.campaign_id = target_campaign_id
          AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
          AND (NOT sampled_only OR (cp.rounds IS NOT NULL AND cp.rounds != '{}'))
          -- Hide replacement pixels whose primary has no rounds
          AND (cp.replacement_for IS NULL
               OR (primary_cp.rounds IS NOT NULL AND primary_cp.rounds != '{}'))
    ) as tile
    WHERE geom IS NOT NULL;

    -- Generate label points at pixel corners for zoom 16+ display.
    -- Uses a CTE to scan the pixels table once, then generates both corner points.
    IF z >= 16 THEN
        SELECT INTO mvt_labels ST_AsMVT(tile, 'pixels_labels', 4096, 'geom')
        FROM (
            WITH pixel_data AS (
                SELECT
                    p.quadkey,
                    p.geometry,
                    (pm.metadata->>'population')::numeric AS population,
                    lc.building_count
                FROM pixels p
                JOIN pixel_area pa ON p.quadkey = pa.quadkey
                JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                LEFT JOIN coverage_pixel cp ON p.quadkey = cp.quadkey
                    AND cp.campaign_id = target_campaign_id
                    AND (target_indicator_id IS NULL OR cp.indicator_id = target_indicator_id)
                LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                LEFT JOIN LATERAL (
                    SELECT COUNT(*)::integer AS building_count
                    FROM locations l
                    WHERE l.quadkey = p.quadkey
                ) lc ON true
                WHERE ca.campaign_id = target_campaign_id
                  AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
                  AND (NOT sampled_only OR (cp.rounds IS NOT NULL AND cp.rounds != '{}'))
            )
            -- Top-left corner (quadkey label)
            SELECT
                ST_AsMVTGeom(
                    ST_Transform(ST_SetSRID(ST_MakePoint(ST_XMin(pd.geometry), ST_YMax(pd.geometry)), 4326), 3857),
                    ST_TileEnvelope(z, x, y),
                    4096, 64, true
                ) AS geom,
                'quadkey' AS label_type,
                pd.quadkey,
                NULL::numeric AS population,
                NULL::integer AS building_count
            FROM pixel_data pd
            UNION ALL
            -- Bottom-right corner (stats label)
            SELECT
                ST_AsMVTGeom(
                    ST_Transform(ST_SetSRID(ST_MakePoint(ST_XMax(pd.geometry), ST_YMin(pd.geometry)), 4326), 3857),
                    ST_TileEnvelope(z, x, y),
                    4096, 64, true
                ) AS geom,
                'stats' AS label_type,
                pd.quadkey,
                pd.population,
                pd.building_count
            FROM pixel_data pd
        ) as tile
        WHERE geom IS NOT NULL;
    END IF;

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
            LEFT JOIN coverage_pixel cp ON p.quadkey = cp.quadkey
                AND cp.campaign_id = target_campaign_id
                AND (target_indicator_id IS NULL OR cp.indicator_id = target_indicator_id)
            LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
            WHERE ca.campaign_id = target_campaign_id
              AND p.geometry && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
              AND (NOT sampled_only OR (cp.rounds IS NOT NULL AND cp.rounds != '{}'))
        ) as tile
        WHERE geom IS NOT NULL;
    END IF;

    RETURN COALESCE(mvt_polygons, ''::bytea) || COALESCE(mvt_points, ''::bytea) || COALESCE(mvt_labels, ''::bytea);
END
$$ LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE;
