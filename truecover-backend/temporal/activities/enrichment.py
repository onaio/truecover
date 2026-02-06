# ABOUTME: Temporal activities for pixel enrichment operations
# ABOUTME: COG download, raster statistics extraction, and metadata updates

from temporalio import activity
from typing import List, Dict, Any
import os
import hashlib
import requests
import json
from urllib.parse import urlparse

from db.connection import get_db_connection, return_db_connection


@activity.defn
async def fetch_enrichment_job(job_id: str) -> Dict[str, Any]:
    """
    Fetch enrichment job details from database.

    Args:
        job_id: Job ID

    Returns:
        Job details including area, data source, and statistic info
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                ej.campaign_id, ej.data_source_id, ej.statistic,
                ds.source_type, ds.stac_catalog_url, ds.stac_collection,
                ds.stac_item, ds.stac_asset, ds.cog_url,
                ds.metadata_field_name, ds.metadata_field_description,
                ds.metadata_field_type, ds.metadata_field_unit
            FROM enrichment_jobs ej
            JOIN data_sources ds ON ej.data_source_id = ds.id
            WHERE ej.id = %s
        """, (job_id,))

        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Enrichment job {job_id} not found")

        # Update job status to processing
        cursor.execute("""
            UPDATE enrichment_jobs
            SET status = 'processing',
                last_attempted_at = NOW(),
                updated_at = NOW()
            WHERE id = %s
        """, (job_id,))
        conn.commit()

        return {
            "job_id": job_id,
            "campaign_id": str(row[0]),
            "data_source_id": str(row[1]),
            "statistic": row[2],
            "source_type": row[3],
            "stac_catalog_url": row[4],
            "stac_collection": row[5],
            "stac_item": row[6],
            "stac_asset": row[7],
            "cog_url": row[8],
            "metadata_field_name": row[9],
            "metadata_field_description": row[10],
            "metadata_field_type": row[11],
            "metadata_field_unit": row[12],
        }
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def fetch_cog_url(job_details: Dict[str, Any]) -> str:
    """
    Fetch COG URL from STAC or direct URL.

    Args:
        job_details: Job details from fetch_enrichment_job

    Returns:
        COG URL
    """
    if job_details["source_type"] == "stac":
        catalog_url = job_details["stac_catalog_url"]
        collection = job_details["stac_collection"]
        item = job_details["stac_item"]
        asset = job_details["stac_asset"] or "cog"

        activity.logger.info(f"Fetching COG URL from STAC: {catalog_url}/collections/{collection}/items/{item}")

        # Construct direct item URL
        base_url = catalog_url.rstrip('/')
        item_url = f"{base_url}/collections/{collection}/items/{item}"

        # Fetch STAC item
        response = requests.get(item_url, timeout=30)
        response.raise_for_status()
        item_data = response.json()

        # Extract assets
        assets = item_data.get('assets', {})
        activity.logger.info(f"Available assets: {list(assets.keys())}")

        if not assets:
            raise ValueError(f"No assets found in STAC item {item}")

        # Find the raster asset
        asset_to_use = None
        if asset in assets:
            asset_to_use = asset
        else:
            # Try common raster asset names
            common_names = ['data', 'cog', 'asset', 'image', 'raster']
            for name in common_names:
                if name in assets:
                    activity.logger.info(f"Asset '{asset}' not found, using '{name}' instead")
                    asset_to_use = name
                    break

        if not asset_to_use:
            raise ValueError(
                f"Asset '{asset}' not found in item and no common asset names found. "
                f"Available assets: {list(assets.keys())}"
            )

        # Get COG URL
        asset_info = assets[asset_to_use]
        cog_url = asset_info.get('href')

        if not cog_url:
            raise ValueError(f"No 'href' found in asset '{asset_to_use}'")

        activity.logger.info(f"COG URL resolved: {cog_url}")
        return cog_url
    else:
        return job_details["cog_url"]


@activity.defn
async def download_cog(cog_url: str) -> str:
    """
    Download and cache COG file locally.

    Args:
        cog_url: COG URL or local file path

    Returns:
        Local file path to cached COG
    """
    # Check if it's a local file
    if os.path.isfile(cog_url):
        file_size_mb = os.path.getsize(cog_url) / (1024 * 1024)
        activity.logger.info(f"Using local COG file: {cog_url} ({file_size_mb:.2f} MB)")
        return cog_url

    # Create cache directory
    cache_dir = 'cog_cache'
    # Go up 3 levels from temporal/activities/enrichment.py to get to project root
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    cache_path = os.path.join(base_dir, cache_dir)
    os.makedirs(cache_path, exist_ok=True)

    # Generate filename
    parsed_url = urlparse(cog_url)
    original_filename = os.path.basename(parsed_url.path)
    url_hash = hashlib.md5(cog_url.encode()).hexdigest()[:8]

    if original_filename:
        name_parts = os.path.splitext(original_filename)
        cached_filename = f"{name_parts[0]}_{url_hash}{name_parts[1]}"
    else:
        cached_filename = f"cog_{url_hash}.tif"

    cached_file_path = os.path.join(cache_path, cached_filename)

    # Check cache
    if os.path.exists(cached_file_path):
        file_size_mb = os.path.getsize(cached_file_path) / (1024 * 1024)
        activity.logger.info(f"Using cached COG: {cached_filename} ({file_size_mb:.2f} MB)")
        return cached_file_path

    # Download
    activity.logger.info(f"Downloading COG from {cog_url}...")
    activity.logger.info(f"Will cache as: {cached_filename}")

    try:
        response = requests.get(cog_url, stream=True, timeout=300)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        total_size_mb = total_size / (1024 * 1024) if total_size else 0

        if total_size_mb:
            activity.logger.info(f"Downloading {total_size_mb:.2f} MB...")

        downloaded_size = 0
        chunk_size = 1024 * 1024  # 1MB chunks

        with open(cached_file_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)

        activity.logger.info(f"Download complete: {cached_filename} ({downloaded_size / (1024 * 1024):.2f} MB)")
        return cached_file_path

    except Exception as e:
        # Clean up partial download
        if os.path.exists(cached_file_path):
            os.remove(cached_file_path)
        raise Exception(f"Failed to download COG: {str(e)}")


@activity.defn
async def enrich_area_pixels(
    campaign_id: str,
    cog_path: str,
    statistic: str,
    metadata_field_name: str,
    metadata_field_description: str,
    metadata_field_type: str,
    metadata_field_unit: str
) -> Dict[str, Any]:
    """
    Fetch, enrich, and update all pixels for an area.

    This combined activity handles the entire enrichment process to avoid
    passing large pixel data through Temporal's payload system.

    Args:
        campaign_id: Area ID
        cog_path: Local path to COG file
        statistic: Statistic to compute (mean, median, etc.)
        metadata_field_name: Name of metadata field
        metadata_field_description: Description of metadata field
        metadata_field_type: Data type of metadata field
        metadata_field_unit: Unit of metadata field

    Returns:
        Summary dict with pixels_total and pixels_updated counts
    """
    from rasterstats import zonal_stats
    import geopandas as gpd
    from shapely import wkt

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Ensure metadata definition exists
        cursor.execute("""
            INSERT INTO pixel_metadata_definitions (
                name, description, data_type, unit
            )
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (name) DO UPDATE SET
                description = EXCLUDED.description,
                data_type = EXCLUDED.data_type,
                unit = EXCLUDED.unit
        """, (
            metadata_field_name,
            metadata_field_description,
            metadata_field_type,
            metadata_field_unit
        ))
        conn.commit()

        # Count pixels that still need enrichment (skip already-enriched)
        cursor.execute("""
            SELECT COUNT(DISTINCT p.quadkey)
            FROM pixels p
            JOIN pixel_area pa ON p.quadkey = pa.quadkey
            JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
            LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
            WHERE ca.campaign_id = %s
              AND (pm.metadata IS NULL OR NOT pm.metadata ? %s)
        """, (campaign_id, metadata_field_name))
        total_pixels = cursor.fetchone()[0]

        activity.logger.info(f"Processing {total_pixels} unenriched pixels for campaign {campaign_id}")

        if total_pixels == 0:
            return {"pixels_total": 0, "pixels_updated": 0, "skipped": True}

        # Process in batches using cursor-based pagination
        batch_size = 500
        total_updated = 0
        offset = 0

        while offset < total_pixels:
            # Fetch batch of pixels that don't yet have this metadata field
            cursor.execute("""
                SELECT DISTINCT p.quadkey, ST_AsText(p.geometry) as wkt_geometry
                FROM pixels p
                JOIN pixel_area pa ON p.quadkey = pa.quadkey
                JOIN campaign_areas ca ON pa.campaign_area_id = ca.id
                LEFT JOIN pixel_metadata pm ON p.quadkey = pm.quadkey
                WHERE ca.campaign_id = %s
                  AND (pm.metadata IS NULL OR NOT pm.metadata ? %s)
                ORDER BY p.quadkey
                LIMIT %s OFFSET %s
            """, (campaign_id, metadata_field_name, batch_size, offset))

            batch_rows = cursor.fetchall()
            if not batch_rows:
                break

            batch_num = offset // batch_size + 1
            total_batches = (total_pixels + batch_size - 1) // batch_size
            activity.logger.info(f"Processing batch {batch_num}/{total_batches} ({len(batch_rows)} pixels)")

            # Convert to GeoDataFrame
            quadkeys = [row[0] for row in batch_rows]
            geometries = [wkt.loads(row[1]) for row in batch_rows]
            gdf = gpd.GeoDataFrame({'quadkey': quadkeys}, geometry=geometries, crs='EPSG:4326')

            # Run zonal stats
            stats = zonal_stats(gdf, cog_path, stats=[statistic])

            # Build results and update metadata
            updates = []
            for quadkey, stat_result in zip(quadkeys, stats):
                if stat_result and statistic in stat_result and stat_result[statistic] is not None:
                    metadata_dict = {metadata_field_name: stat_result[statistic]}
                    metadata_json = json.dumps(metadata_dict)
                    updates.append((quadkey, metadata_json))

            # Bulk upsert metadata
            if updates:
                cursor.executemany("""
                    INSERT INTO pixel_metadata (quadkey, metadata)
                    VALUES (%s, %s::jsonb)
                    ON CONFLICT (quadkey)
                    DO UPDATE SET
                        metadata = pixel_metadata.metadata || EXCLUDED.metadata,
                        updated_at = NOW()
                """, updates)

                # Also write to pixels.population column for population data
                if metadata_field_name == 'population':
                    pop_updates = [
                        (json.loads(metadata_json)[metadata_field_name], quadkey)
                        for quadkey, metadata_json in updates
                    ]
                    cursor.executemany("""
                        UPDATE pixels SET population = %s WHERE quadkey = %s
                    """, pop_updates)

                conn.commit()
                total_updated += len(updates)

            activity.logger.info(f"Batch {batch_num}: extracted stats for {len(updates)}/{len(batch_rows)} pixels")
            offset += batch_size

        # Update cached_population on affected campaign areas
        if metadata_field_name == 'population' and total_updated > 0:
            cursor.execute("""
                UPDATE campaign_areas ca
                SET cached_population = sub.total_pop
                FROM (
                    SELECT pa.campaign_area_id,
                           COALESCE(SUM(p.population), 0) as total_pop
                    FROM pixel_area pa
                    JOIN pixels p ON pa.quadkey = p.quadkey
                    JOIN campaign_areas ca2 ON pa.campaign_area_id = ca2.id
                    WHERE ca2.campaign_id = %s
                    GROUP BY pa.campaign_area_id
                ) sub
                WHERE ca.id = sub.campaign_area_id
            """, (campaign_id,))
            conn.commit()
            activity.logger.info(f"Updated cached_population for campaign areas")

        activity.logger.info(f"Enrichment complete: {total_updated}/{total_pixels} pixels updated")
        return {"pixels_total": total_pixels, "pixels_updated": total_updated}

    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def update_job_progress(job_id: str, pixels_processed: int) -> None:
    """
    Update enrichment job progress.

    Args:
        job_id: Job ID
        pixels_processed: Number of pixels processed so far
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            UPDATE enrichment_jobs
            SET pixels_processed = %s,
                updated_at = NOW()
            WHERE id = %s
        """, (pixels_processed, job_id))
        conn.commit()
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def mark_job_completed(job_id: str) -> None:
    """
    Mark enrichment job as completed.

    Args:
        job_id: Job ID
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            UPDATE enrichment_jobs
            SET status = 'completed',
                updated_at = NOW()
            WHERE id = %s
        """, (job_id,))
        conn.commit()
        activity.logger.info(f"Job {job_id} marked as completed")
    finally:
        cursor.close()
        return_db_connection(conn)


@activity.defn
async def mark_job_failed(job_id: str, error_message: str) -> None:
    """
    Mark enrichment job as failed.

    Args:
        job_id: Job ID
        error_message: Error message
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            UPDATE enrichment_jobs
            SET status = 'failed',
                error_message = %s,
                updated_at = NOW()
            WHERE id = %s
        """, (error_message, job_id))
        conn.commit()
        activity.logger.error(f"Job {job_id} marked as failed: {error_message}")
    finally:
        cursor.close()
        return_db_connection(conn)
