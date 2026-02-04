-- Optimize pixels_by_campaign: skip centroids query when metadata_field is not needed
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
