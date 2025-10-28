# ABOUTME: Background worker for processing pixel enrichment jobs
# ABOUTME: Extracts statistics from COG rasters and updates pixel metadata

import threading
import time
import traceback
import json
from db.connection import get_db_connection, return_db_connection


def process_enrichment_jobs():
    """Background worker to process pending enrichment jobs"""
    print("Enrichment worker started")
    MAX_RETRIES = 3
    STUCK_JOB_TIMEOUT_MINUTES = 30

    while True:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()

            # First, recover stuck jobs (in 'processing' state for too long)
            cursor.execute("""
                UPDATE enrichment_jobs
                SET status = 'pending',
                    error_message = CONCAT(
                        COALESCE(error_message, ''),
                        CASE WHEN error_message IS NOT NULL THEN ' | ' ELSE '' END,
                        'Job was stuck in processing state and has been reset'
                    ),
                    updated_at = NOW()
                WHERE status = 'processing'
                  AND last_attempted_at < NOW() - INTERVAL '%s minutes'
                  AND retry_count < %s
                RETURNING id
            """, (STUCK_JOB_TIMEOUT_MINUTES, MAX_RETRIES))

            stuck_jobs = cursor.fetchall()
            if stuck_jobs:
                conn.commit()
                for job in stuck_jobs:
                    print(f"Recovered stuck job {job[0]}")

            # Find pending jobs (including those that need retry)
            cursor.execute("""
                SELECT id, retry_count FROM enrichment_jobs
                WHERE status = 'pending'
                  AND retry_count < %s
                ORDER BY created_at ASC
                LIMIT 1
            """, (MAX_RETRIES,))

            job_row = cursor.fetchone()

            if job_row:
                job_id = job_row[0]
                retry_count = job_row[1]
                cursor.close()
                return_db_connection(conn)

                # Process the job
                try:
                    process_single_job(job_id)
                except Exception as e:
                    print(f"Error processing job {job_id}: {e}")
                    traceback.print_exc()

                    # Update job status - retry or fail permanently
                    try:
                        error_conn = get_db_connection()
                        error_cursor = error_conn.cursor()

                        new_retry_count = retry_count + 1
                        if new_retry_count >= MAX_RETRIES:
                            # Max retries reached, fail permanently
                            error_cursor.execute("""
                                UPDATE enrichment_jobs
                                SET status = 'failed',
                                    error_message = %s,
                                    retry_count = %s,
                                    updated_at = NOW()
                                WHERE id = %s
                            """, (f"Failed after {MAX_RETRIES} attempts: {str(e)}", new_retry_count, job_id))
                            print(f"Job {job_id} permanently failed after {MAX_RETRIES} attempts")
                        else:
                            # Keep as pending for retry
                            error_cursor.execute("""
                                UPDATE enrichment_jobs
                                SET status = 'pending',
                                    error_message = %s,
                                    retry_count = %s,
                                    updated_at = NOW()
                                WHERE id = %s
                            """, (f"Retry {new_retry_count}/{MAX_RETRIES}: {str(e)}", new_retry_count, job_id))
                            print(f"Job {job_id} will retry (attempt {new_retry_count}/{MAX_RETRIES})")

                        error_conn.commit()
                        error_cursor.close()
                        return_db_connection(error_conn)
                    except Exception as update_error:
                        print(f"Error updating job status: {update_error}")
            else:
                cursor.close()
                return_db_connection(conn)
                # Sleep for a bit if no jobs found
                time.sleep(5)

        except Exception as e:
            print(f"Error in enrichment worker loop: {e}")
            traceback.print_exc()
            time.sleep(5)


def download_and_cache_cog(cog_url, cache_dir='cog_cache'):
    """Download a COG file and cache it locally for reuse"""
    import os
    import hashlib
    import requests
    from urllib.parse import urlparse

    # Create cache directory if it doesn't exist
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache_path = os.path.join(base_dir, cache_dir)
    os.makedirs(cache_path, exist_ok=True)

    # Generate a safe filename from the URL
    # Use the original filename if possible, with URL hash as suffix for uniqueness
    parsed_url = urlparse(cog_url)
    original_filename = os.path.basename(parsed_url.path)
    url_hash = hashlib.md5(cog_url.encode()).hexdigest()[:8]

    # Keep original extension if present
    if original_filename:
        name_parts = os.path.splitext(original_filename)
        cached_filename = f"{name_parts[0]}_{url_hash}{name_parts[1]}"
    else:
        cached_filename = f"cog_{url_hash}.tif"

    cached_file_path = os.path.join(cache_path, cached_filename)

    # Check if file already exists
    if os.path.exists(cached_file_path):
        file_size_mb = os.path.getsize(cached_file_path) / (1024 * 1024)
        print(f"Using cached COG: {cached_filename} ({file_size_mb:.2f} MB)")
        return cached_file_path

    # Download the file
    print(f"Downloading COG from {cog_url}...")
    print(f"Will cache as: {cached_filename}")

    try:
        response = requests.get(cog_url, stream=True, timeout=300)
        response.raise_for_status()

        # Get file size if available
        total_size = int(response.headers.get('content-length', 0))
        total_size_mb = total_size / (1024 * 1024) if total_size else 0

        if total_size_mb:
            print(f"Downloading {total_size_mb:.2f} MB...")

        # Download in chunks
        downloaded_size = 0
        chunk_size = 1024 * 1024  # 1MB chunks

        with open(cached_file_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
                    if total_size:
                        progress = (downloaded_size / total_size) * 100
                        print(f"  Progress: {progress:.1f}% ({downloaded_size / (1024 * 1024):.2f} MB)", end='\r')

        print(f"\nDownload complete: {cached_filename} ({downloaded_size / (1024 * 1024):.2f} MB)")
        return cached_file_path

    except Exception as e:
        # Clean up partial download on error
        if os.path.exists(cached_file_path):
            os.remove(cached_file_path)
        raise Exception(f"Failed to download COG: {str(e)}")


def process_single_job(job_id):
    """Process a single enrichment job"""
    import requests
    from rasterstats import zonal_stats
    import geopandas as gpd
    from shapely import wkt

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Update status to processing and record attempt time
        cursor.execute("""
            UPDATE enrichment_jobs
            SET status = 'processing',
                last_attempted_at = NOW(),
                updated_at = NOW()
            WHERE id = %s
        """, (job_id,))
        conn.commit()

        # Get job details
        cursor.execute("""
            SELECT
                ej.area_id, ej.data_source_id, ej.statistic,
                ds.source_type, ds.stac_catalog_url, ds.stac_collection,
                ds.stac_item, ds.stac_asset, ds.cog_url,
                ds.metadata_field_name, ds.metadata_field_description,
                ds.metadata_field_type, ds.metadata_field_unit
            FROM enrichment_jobs ej
            JOIN data_sources ds ON ej.data_source_id = ds.id
            WHERE ej.id = %s
        """, (job_id,))

        job_row = cursor.fetchone()
        if not job_row:
            raise Exception(f"Job {job_id} not found")

        area_id = job_row[0]
        statistic = job_row[2]
        source_type = job_row[3]
        metadata_field_name = job_row[9]
        metadata_field_description = job_row[10]
        metadata_field_type = job_row[11]
        metadata_field_unit = job_row[12]

        # Get COG URL
        if source_type == 'stac':
            stac_catalog_url = job_row[4]
            stac_collection = job_row[5]
            stac_item = job_row[6]
            stac_asset = job_row[7] or 'cog'

            print(f"Fetching COG URL from STAC:")
            print(f"  Catalog URL: {stac_catalog_url}")
            print(f"  Collection: {stac_collection}")
            print(f"  Item: {stac_item}")
            print(f"  Asset: {stac_asset}")

            # Construct direct item URL
            # Remove trailing slash from catalog URL if present
            base_url = stac_catalog_url.rstrip('/')
            item_url = f"{base_url}/collections/{stac_collection}/items/{stac_item}"

            print(f"Fetching STAC item from: {item_url}")

            # Fetch the STAC item directly
            try:
                response = requests.get(item_url, timeout=30)
                response.raise_for_status()
                item_data = response.json()
                print(f"Successfully fetched STAC item. Type: {item_data.get('type')}")
            except requests.RequestException as e:
                print(f"ERROR fetching STAC item: {e}")
                raise Exception(f"Failed to fetch STAC item from {item_url}: {str(e)}")

            # Extract assets
            assets = item_data.get('assets', {})
            print(f"Available assets: {list(assets.keys())}")

            if not assets:
                raise Exception(f"No assets found in STAC item {stac_item}")

            # Try to find the raster asset - use fallback logic for common names
            asset_to_use = None
            if stac_asset in assets:
                asset_to_use = stac_asset
            else:
                # Try common raster asset names
                common_names = ['data', 'cog', 'asset', 'image', 'raster']
                for name in common_names:
                    if name in assets:
                        print(f"Asset '{stac_asset}' not found, using '{name}' instead")
                        asset_to_use = name
                        break

            if not asset_to_use:
                raise Exception(
                    f"Asset '{stac_asset}' not found in item and no common asset names found. "
                    f"Available assets: {list(assets.keys())}"
                )

            # Get the COG URL from the asset
            asset_info = assets[asset_to_use]
            cog_url = asset_info.get('href')

            if not cog_url:
                raise Exception(f"No 'href' found in asset '{asset_to_use}'")

            print(f"COG URL resolved: {cog_url}")
        else:
            cog_url = job_row[8]

        print(f"Processing job {job_id} with COG URL: {cog_url}")

        # Download and cache the COG file locally
        try:
            local_cog_path = download_and_cache_cog(cog_url)
            print(f"Using local COG file: {local_cog_path}")
        except Exception as e:
            raise Exception(f"Failed to download/cache COG: {str(e)}")

        # Ensure pixel_metadata_definition exists
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

        # Fetch pixels for this area with geometries
        cursor.execute("""
            SELECT quadkey, ST_AsText(geometry) as wkt_geometry
            FROM pixels
            WHERE area_id = %s
        """, (area_id,))

        pixels = cursor.fetchall()
        total_pixels = len(pixels)

        print(f"Processing {total_pixels} pixels for job {job_id}")

        # Process in batches to avoid memory issues
        batch_size = 100
        processed_count = 0

        for i in range(0, total_pixels, batch_size):
            batch = pixels[i:i + batch_size]

            # Convert to GeoDataFrame
            quadkeys = [p[0] for p in batch]
            geometries = [wkt.loads(p[1]) for p in batch]
            gdf = gpd.GeoDataFrame({'quadkey': quadkeys}, geometry=geometries, crs='EPSG:4326')

            # Run zonal stats on local cached file
            stats = zonal_stats(gdf, local_cog_path, stats=[statistic])

            # Prepare updates
            updates = []
            for quadkey, stat_result in zip(quadkeys, stats):
                if stat_result and statistic in stat_result and stat_result[statistic] is not None:
                    value = stat_result[statistic]
                    # Use json.dumps to properly serialize the metadata
                    metadata_dict = {metadata_field_name: value}
                    metadata_json = json.dumps(metadata_dict)
                    updates.append((quadkey, metadata_json))

            # Bulk upsert to pixel_metadata
            if updates:
                cursor.executemany("""
                    INSERT INTO pixel_metadata (quadkey, metadata)
                    VALUES (%s, %s::jsonb)
                    ON CONFLICT (quadkey)
                    DO UPDATE SET
                        metadata = pixel_metadata.metadata || EXCLUDED.metadata,
                        updated_at = NOW()
                """, updates)
                conn.commit()

            processed_count += len(batch)

            # Update progress
            cursor.execute("""
                UPDATE enrichment_jobs
                SET pixels_processed = %s, updated_at = NOW()
                WHERE id = %s
            """, (processed_count, job_id))
            conn.commit()

            print(f"Job {job_id}: Processed {processed_count}/{total_pixels} pixels")

        # Mark job as completed
        cursor.execute("""
            UPDATE enrichment_jobs
            SET status = 'completed', updated_at = NOW()
            WHERE id = %s
        """, (job_id,))
        conn.commit()

        print(f"Job {job_id} completed successfully")

        cursor.close()

    except Exception as e:
        print(f"Error processing job {job_id}: {e}")
        traceback.print_exc()
        raise
    finally:
        if conn:
            return_db_connection(conn)


def start_enrichment_worker():
    """Start the enrichment worker in a background thread"""
    worker_thread = threading.Thread(target=process_enrichment_jobs, daemon=True)
    worker_thread.start()
    print("Enrichment worker thread started")
