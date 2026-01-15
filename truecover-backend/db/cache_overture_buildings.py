# ABOUTME: Script to cache Overture building parquet files locally filtered by country boundary.
# ABOUTME: Downloads remote Overture data, filters by admin boundary, and saves to local parquet.

import os
import sys
import argparse
import duckdb
from pathlib import Path
from db.connection import get_db_connection, return_db_connection

REMOTE_OVERTURE_URL = 'az://overturemapswestus2.blob.core.windows.net/release/2025-10-22.0/theme=buildings/type=building/*'


def get_country_boundary(iso3: str):
    """Fetch country boundary bbox from admin_boundaries table."""
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                ST_XMin(geometry) as min_lng,
                ST_YMin(geometry) as min_lat,
                ST_XMax(geometry) as max_lng,
                ST_YMax(geometry) as max_lat
            FROM admin_boundaries
            WHERE iso3 = %s AND level = 0
            LIMIT 1
        """, (iso3,))

        result = cursor.fetchone()
        if not result:
            raise ValueError(f"Country boundary not found for iso3: {iso3}")

        return (result[0], result[1], result[2], result[3])

    finally:
        cursor.close()
        return_db_connection(conn)


def cache_buildings(iso3: str, output_path: str):
    """Download and cache buildings filtered by country boundary."""

    # Get boundary from database
    print(f"Fetching boundary for {iso3}...", flush=True)
    bbox = get_country_boundary(iso3)
    print(f"Boundary bbox: {bbox}", flush=True)

    # Setup output directory
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # Connect to DuckDB
    print("Connecting to DuckDB...", flush=True)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")

    try:
        # Export filtered data to parquet (skip count to save time)
        print(f"Exporting buildings to {output_file.absolute()}...", flush=True)
        print("This may take 10-30 minutes depending on network speed...", flush=True)

        export_query = f"""
            COPY (
                SELECT
                    id,
                    names,
                    height,
                    num_floors,
                    class,
                    sources,
                    bbox,
                    geometry
                FROM read_parquet('{REMOTE_OVERTURE_URL}', hive_partitioning=1)
                WHERE bbox.xmin BETWEEN {bbox[0]} AND {bbox[2]}
                  AND bbox.ymin BETWEEN {bbox[1]} AND {bbox[3]}
            ) TO '{output_file.absolute()}' (FORMAT PARQUET, COMPRESSION 'ZSTD')
        """
        con.execute(export_query)

        # Report results
        file_size_mb = output_file.stat().st_size / (1024 * 1024)

        # Count rows in the exported file
        row_count = con.execute(f"SELECT COUNT(*) FROM read_parquet('{output_file.absolute()}')").fetchone()[0]

        print(f"\nCache complete!", flush=True)
        print(f"  File: {output_file.absolute()}", flush=True)
        print(f"  Size: {file_size_mb:.2f} MB", flush=True)
        print(f"  Buildings: {row_count:,}", flush=True)
        print(f"\nTo use this cache, set in your .env:", flush=True)
        print(f"  OVERTURE_BUILDINGS_PATH={output_file.absolute()}", flush=True)

    finally:
        con.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Cache Overture buildings locally filtered by country boundary'
    )
    parser.add_argument(
        '--iso3',
        default='BD',
        help='ISO country code as stored in admin_boundaries table (default: BD for Bangladesh)'
    )
    parser.add_argument(
        '--output',
        default=None,
        help='Output file path (default: parquet_cache/<iso3>_buildings.parquet)'
    )
    args = parser.parse_args()

    # Default output path based on iso3
    if args.output is None:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        output_path = os.path.join(base_dir, 'parquet_cache', f'{args.iso3.lower()}_buildings.parquet')
    else:
        output_path = args.output

    print(f"Caching Overture buildings for {args.iso3}")
    print(f"Output: {output_path}")
    cache_buildings(args.iso3, output_path)
