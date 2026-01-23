#!/usr/bin/env python3
# ABOUTME: Generate quadkey pixels for all of Bangladesh at zoom level 18
# ABOUTME: Includes admin boundary geocoding and WorldPop population data

"""
Generate quadkey pixels for Bangladesh with population data.

This script generates all quadkeys at zoom level 18 for Bangladesh,
geocodes them to administrative boundaries (down to union/ADM4 level),
extracts WorldPop population data, and outputs to a parquet file.

Usage:
    python generate_bd_quadkeys.py --admin-boundaries /path/to/admin.geoparquet \
                                   --worldpop /path/to/worldpop.tif \
                                   --output bd-wordpop-qk18.parquet

Performance:
    - Uses chunked processing to manage memory
    - Supports parallel processing with --workers flag
    - Spatial indexing for fast admin boundary lookups
"""

import argparse
import os
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

import geopandas as gpd
import mercantile
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from rasterstats import zonal_stats
from shapely.geometry import Point, Polygon, box, shape
from shapely import wkt

# Bangladesh approximate bounding box
BANGLADESH_BBOX = (88.0, 20.6, 92.7, 26.6)  # (min_lng, min_lat, max_lng, max_lat)
QUADKEY_LEVEL = 18
DEFAULT_CHUNK_SIZE = 50000


@dataclass
class GridCell:
    """Represents a grid cell for spatial partitioning."""
    id: int
    min_lng: float
    min_lat: float
    max_lng: float
    max_lat: float

    @property
    def bounds(self) -> Tuple[float, float, float, float]:
        return (self.min_lng, self.min_lat, self.max_lng, self.max_lat)


def create_grid_cells(bbox: Tuple[float, float, float, float],
                      grid_size: int = 8) -> List[GridCell]:
    """
    Divide a bounding box into grid cells for parallel processing.

    Args:
        bbox: (min_lng, min_lat, max_lng, max_lat)
        grid_size: Number of cells per dimension (total cells = grid_size^2)

    Returns:
        List of GridCell objects
    """
    min_lng, min_lat, max_lng, max_lat = bbox
    lng_step = (max_lng - min_lng) / grid_size
    lat_step = (max_lat - min_lat) / grid_size

    cells = []
    cell_id = 0
    for i in range(grid_size):
        for j in range(grid_size):
            cell = GridCell(
                id=cell_id,
                min_lng=min_lng + i * lng_step,
                min_lat=min_lat + j * lat_step,
                max_lng=min_lng + (i + 1) * lng_step,
                max_lat=min_lat + (j + 1) * lat_step
            )
            cells.append(cell)
            cell_id += 1

    return cells


def generate_tiles_for_bbox(bbox: Tuple[float, float, float, float],
                            level: int = QUADKEY_LEVEL) -> Iterator[mercantile.Tile]:
    """
    Generate tiles for a bounding box at the specified zoom level.

    Args:
        bbox: (min_lng, min_lat, max_lng, max_lat)
        level: Zoom level (default 18)

    Yields:
        mercantile.Tile objects
    """
    min_lng, min_lat, max_lng, max_lat = bbox
    return mercantile.tiles(min_lng, min_lat, max_lng, max_lat, zooms=[level])


def tile_to_record(tile: mercantile.Tile) -> dict:
    """
    Convert a tile to a record dict with quadkey, geometry, and centroid.

    Args:
        tile: mercantile.Tile object

    Returns:
        Dict with quadkey, geometry_wkt, latitude, longitude, level
    """
    quadkey = mercantile.quadkey(tile)
    bounds = mercantile.bounds(tile)

    # Calculate centroid
    centroid_lng = (bounds.west + bounds.east) / 2
    centroid_lat = (bounds.south + bounds.north) / 2

    # Create polygon WKT
    geometry_wkt = (
        f"POLYGON(({bounds.west} {bounds.south}, "
        f"{bounds.west} {bounds.north}, "
        f"{bounds.east} {bounds.north}, "
        f"{bounds.east} {bounds.south}, "
        f"{bounds.west} {bounds.south}))"
    )

    return {
        'quadkey': quadkey,
        'geometry_wkt': geometry_wkt,
        'latitude': centroid_lat,
        'longitude': centroid_lng,
        'level': tile.z
    }


def load_admin_boundaries(admin_path: str) -> gpd.GeoDataFrame:
    """
    Load admin boundaries from geoparquet file(s).

    Supports both single file and directory of files.

    Args:
        admin_path: Path to geoparquet file or directory

    Returns:
        GeoDataFrame with admin boundaries
    """
    path = Path(admin_path)

    if path.is_file():
        print(f"Loading admin boundaries from {path}...")
        gdf = gpd.read_parquet(path)
    elif path.is_dir():
        # Load all geoparquet files in directory
        files = list(path.glob('*.geoparquet')) + list(path.glob('*.parquet'))
        if not files:
            raise FileNotFoundError(f"No geoparquet files found in {path}")

        print(f"Loading {len(files)} admin boundary files from {path}...")
        gdfs = []
        for f in sorted(files):
            print(f"  Loading {f.name}...")
            gdfs.append(gpd.read_parquet(f))
        gdf = pd.concat(gdfs, ignore_index=True)
        gdf = gpd.GeoDataFrame(gdf, geometry='geometry', crs='EPSG:4326')
    else:
        raise FileNotFoundError(f"Admin boundary path not found: {path}")

    # Ensure we have the required columns
    required_cols = ['geometry']
    pcode_cols = ['ADM0_PCODE', 'ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE']

    # Normalize column names (handle case variations)
    gdf.columns = [c.upper() if c.upper() in pcode_cols else c for c in gdf.columns]

    print(f"Loaded {len(gdf)} admin boundary features")
    print(f"Columns: {list(gdf.columns)}")

    # Create spatial index for fast lookups
    print("Building spatial index...")
    gdf.sindex  # This triggers index creation

    return gdf


def load_country_boundary(admin_gdf: gpd.GeoDataFrame) -> Polygon:
    """
    Extract country boundary from admin boundaries (ADM0 level).

    Args:
        admin_gdf: GeoDataFrame with admin boundaries

    Returns:
        Shapely Polygon of country boundary
    """
    # Try to find ADM0 level boundary
    if 'level' in admin_gdf.columns:
        adm0 = admin_gdf[admin_gdf['level'] == 0]
        if len(adm0) > 0:
            return adm0.unary_union

    # Fall back to union of all geometries
    print("Creating country boundary from union of all admin boundaries...")
    return admin_gdf.unary_union


def geocode_points_to_admin(points_gdf: gpd.GeoDataFrame,
                            admin_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Geocode points to administrative boundaries using spatial join.

    Args:
        points_gdf: GeoDataFrame with point geometries
        admin_gdf: GeoDataFrame with admin boundary polygons

    Returns:
        GeoDataFrame with admin pcodes added
    """
    # Find the most detailed admin level (highest level number)
    if 'level' in admin_gdf.columns:
        max_level = admin_gdf['level'].max()
        detailed_admin = admin_gdf[admin_gdf['level'] == max_level].copy()
    else:
        detailed_admin = admin_gdf.copy()

    # Spatial join - find which admin boundary contains each point
    result = gpd.sjoin(
        points_gdf,
        detailed_admin[['geometry', 'ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE']],
        how='left',
        predicate='within'
    )

    # Handle points that didn't match (use nearest)
    unmatched = result[result['ADM1_PCODE'].isna()]
    if len(unmatched) > 0:
        print(f"  {len(unmatched)} points didn't match admin boundaries, using nearest...")
        # For unmatched, use sjoin_nearest
        unmatched_result = gpd.sjoin_nearest(
            unmatched[['geometry']],
            detailed_admin[['geometry', 'ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE']],
            how='left'
        )
        # Update the original result
        for col in ['ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE']:
            result.loc[result['ADM1_PCODE'].isna(), col] = unmatched_result[col].values

    # Drop the index_right column from sjoin
    if 'index_right' in result.columns:
        result = result.drop(columns=['index_right'])

    return result


def extract_population(gdf: gpd.GeoDataFrame,
                       worldpop_path: str,
                       statistic: str = 'sum') -> pd.Series:
    """
    Extract population values from WorldPop raster for each geometry.

    Args:
        gdf: GeoDataFrame with polygon geometries
        worldpop_path: Path to WorldPop GeoTIFF
        statistic: Statistic to compute (sum, mean, etc.)

    Returns:
        Series with population values
    """
    stats = zonal_stats(
        gdf,
        worldpop_path,
        stats=[statistic],
        all_touched=True  # Include pixels that touch the polygon edge
    )

    return pd.Series([s[statistic] if s and statistic in s else None for s in stats])


def process_grid_cell(cell: GridCell,
                      country_boundary_wkt: str,
                      admin_path: str,
                      worldpop_path: Optional[str],
                      output_dir: str) -> Tuple[int, str, int]:
    """
    Process a single grid cell - generate tiles, geocode, extract population.

    This function is designed to run in a separate process.

    Args:
        cell: GridCell to process
        country_boundary_wkt: WKT string of country boundary for filtering
        admin_path: Path to admin boundaries
        worldpop_path: Path to WorldPop raster (optional)
        output_dir: Directory to write temporary parquet file

    Returns:
        Tuple of (cell_id, output_path, record_count)
    """
    try:
        # Parse country boundary
        country_boundary = wkt.loads(country_boundary_wkt)

        # Generate tiles for this cell
        tiles = list(generate_tiles_for_bbox(cell.bounds, QUADKEY_LEVEL))

        if not tiles:
            return (cell.id, None, 0)

        # Convert to records
        records = [tile_to_record(t) for t in tiles]

        # Create GeoDataFrame with centroids for filtering and geocoding
        df = pd.DataFrame(records)
        geometry = [Point(r['longitude'], r['latitude']) for r in records]
        gdf = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

        # Filter to points within country boundary
        within_boundary = gdf[gdf.within(country_boundary)]

        if len(within_boundary) == 0:
            return (cell.id, None, 0)

        print(f"Cell {cell.id}: {len(within_boundary)}/{len(gdf)} tiles within boundary")

        # Load admin boundaries and geocode
        admin_gdf = load_admin_boundaries(admin_path)
        geocoded = geocode_points_to_admin(within_boundary, admin_gdf)

        # Extract population if WorldPop path provided
        if worldpop_path and os.path.exists(worldpop_path):
            # Create polygon geometries for zonal stats
            polygon_geoms = [wkt.loads(w) for w in geocoded['geometry_wkt']]
            polygon_gdf = gpd.GeoDataFrame(
                geocoded.drop(columns=['geometry']),
                geometry=polygon_geoms,
                crs='EPSG:4326'
            )
            geocoded['population'] = extract_population(polygon_gdf, worldpop_path, 'sum')
        else:
            geocoded['population'] = None

        # Prepare output DataFrame
        output_df = geocoded[[
            'quadkey', 'geometry_wkt', 'latitude', 'longitude', 'level',
            'ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE', 'population'
        ]].copy()

        # Rename columns to lowercase
        output_df.columns = [c.lower() for c in output_df.columns]

        # Write to temporary parquet file
        output_path = os.path.join(output_dir, f'cell_{cell.id:04d}.parquet')
        output_df.to_parquet(output_path, index=False)

        return (cell.id, output_path, len(output_df))

    except Exception as e:
        print(f"Error processing cell {cell.id}: {e}")
        import traceback
        traceback.print_exc()
        return (cell.id, None, 0)


def process_sequential(cells: List[GridCell],
                       country_boundary: Polygon,
                       admin_gdf: gpd.GeoDataFrame,
                       worldpop_path: Optional[str],
                       output_path: str,
                       chunk_size: int = DEFAULT_CHUNK_SIZE) -> int:
    """
    Process all cells sequentially with chunked writing.

    Args:
        cells: List of grid cells to process
        country_boundary: Country boundary polygon for filtering
        admin_gdf: GeoDataFrame with admin boundaries
        worldpop_path: Path to WorldPop raster
        output_path: Output parquet file path
        chunk_size: Number of records per write batch

    Returns:
        Total number of records written
    """
    # Define schema
    schema = pa.schema([
        ('quadkey', pa.string()),
        ('geometry_wkt', pa.string()),
        ('latitude', pa.float64()),
        ('longitude', pa.float64()),
        ('level', pa.int32()),
        ('adm1_pcode', pa.string()),
        ('adm2_pcode', pa.string()),
        ('adm3_pcode', pa.string()),
        ('adm4_pcode', pa.string()),
        ('population', pa.float64()),
    ])

    total_records = 0
    writer = None

    try:
        for cell_idx, cell in enumerate(cells):
            print(f"\nProcessing cell {cell_idx + 1}/{len(cells)} (id={cell.id})...")

            # Generate tiles for this cell
            tiles = list(generate_tiles_for_bbox(cell.bounds, QUADKEY_LEVEL))

            if not tiles:
                continue

            # Process in chunks
            for chunk_start in range(0, len(tiles), chunk_size):
                chunk_tiles = tiles[chunk_start:chunk_start + chunk_size]

                # Convert to records
                records = [tile_to_record(t) for t in chunk_tiles]

                # Create GeoDataFrame with centroids
                df = pd.DataFrame(records)
                geometry = [Point(r['longitude'], r['latitude']) for r in records]
                gdf = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

                # Filter to points within country boundary
                within_boundary = gdf[gdf.within(country_boundary)]

                if len(within_boundary) == 0:
                    continue

                # Geocode to admin boundaries
                geocoded = geocode_points_to_admin(within_boundary, admin_gdf)

                # Extract population if available
                if worldpop_path and os.path.exists(worldpop_path):
                    polygon_geoms = [wkt.loads(w) for w in geocoded['geometry_wkt']]
                    polygon_gdf = gpd.GeoDataFrame(
                        geocoded.drop(columns=['geometry']),
                        geometry=polygon_geoms,
                        crs='EPSG:4326'
                    )
                    geocoded['population'] = extract_population(polygon_gdf, worldpop_path, 'sum')
                else:
                    geocoded['population'] = None

                # Prepare output DataFrame
                output_df = geocoded[[
                    'quadkey', 'geometry_wkt', 'latitude', 'longitude', 'level',
                    'ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE', 'population'
                ]].copy()
                output_df.columns = [c.lower() for c in output_df.columns]

                # Write to parquet
                table = pa.Table.from_pandas(output_df, schema=schema, preserve_index=False)

                if writer is None:
                    writer = pq.ParquetWriter(output_path, schema)

                writer.write_table(table)
                total_records += len(output_df)

                print(f"  Chunk {chunk_start // chunk_size + 1}: "
                      f"processed {len(chunk_tiles)} tiles, "
                      f"wrote {len(output_df)} records "
                      f"(total: {total_records})")

    finally:
        if writer:
            writer.close()

    return total_records


def process_parallel(cells: List[GridCell],
                     country_boundary: Polygon,
                     admin_path: str,
                     worldpop_path: Optional[str],
                     output_path: str,
                     num_workers: int = 4) -> int:
    """
    Process cells in parallel using ProcessPoolExecutor.

    Args:
        cells: List of grid cells to process
        country_boundary: Country boundary polygon for filtering
        admin_path: Path to admin boundaries (for subprocess to load)
        worldpop_path: Path to WorldPop raster
        output_path: Output parquet file path
        num_workers: Number of parallel workers

    Returns:
        Total number of records written
    """
    # Convert boundary to WKT for serialization
    country_boundary_wkt = country_boundary.wkt

    # Create temporary directory for cell outputs
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temp directory: {temp_dir}")

        # Process cells in parallel
        results = []
        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            futures = {
                executor.submit(
                    process_grid_cell,
                    cell,
                    country_boundary_wkt,
                    admin_path,
                    worldpop_path,
                    temp_dir
                ): cell.id
                for cell in cells
            }

            for future in as_completed(futures):
                cell_id = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                    if result[1]:  # Has output file
                        print(f"Completed cell {result[0]}: {result[2]} records")
                except Exception as e:
                    print(f"Cell {cell_id} failed: {e}")

        # Merge all temp parquet files
        print("\nMerging results...")
        temp_files = [r[1] for r in results if r[1] is not None]

        if not temp_files:
            print("No data generated!")
            return 0

        # Read and concatenate all temp files
        dfs = []
        for f in temp_files:
            dfs.append(pd.read_parquet(f))

        merged_df = pd.concat(dfs, ignore_index=True)

        # Write final parquet
        merged_df.to_parquet(output_path, index=False)

        total_records = len(merged_df)
        print(f"Wrote {total_records} records to {output_path}")

        return total_records


def main():
    parser = argparse.ArgumentParser(
        description='Generate quadkey pixels for Bangladesh with population data'
    )
    parser.add_argument(
        '--admin-boundaries', '-a',
        required=True,
        help='Path to admin boundary geoparquet file or directory'
    )
    parser.add_argument(
        '--worldpop', '-w',
        help='Path to WorldPop population GeoTIFF (optional)'
    )
    parser.add_argument(
        '--output', '-o',
        default='bd-wordpop-qk18.parquet',
        help='Output parquet file path (default: bd-wordpop-qk18.parquet)'
    )
    parser.add_argument(
        '--workers', '-n',
        type=int,
        default=1,
        help='Number of parallel workers (default: 1 for sequential processing)'
    )
    parser.add_argument(
        '--grid-size', '-g',
        type=int,
        default=8,
        help='Grid size for spatial partitioning (default: 8, creates 64 cells)'
    )
    parser.add_argument(
        '--chunk-size', '-c',
        type=int,
        default=DEFAULT_CHUNK_SIZE,
        help=f'Chunk size for sequential processing (default: {DEFAULT_CHUNK_SIZE})'
    )
    parser.add_argument(
        '--bbox',
        type=float,
        nargs=4,
        default=list(BANGLADESH_BBOX),
        metavar=('MIN_LNG', 'MIN_LAT', 'MAX_LNG', 'MAX_LAT'),
        help='Bounding box (default: Bangladesh)'
    )

    args = parser.parse_args()

    print("=" * 60)
    print("Bangladesh Quadkey Pixel Generator")
    print("=" * 60)
    print(f"Admin boundaries: {args.admin_boundaries}")
    print(f"WorldPop raster: {args.worldpop or 'Not provided'}")
    print(f"Output file: {args.output}")
    print(f"Workers: {args.workers}")
    print(f"Grid size: {args.grid_size}x{args.grid_size} = {args.grid_size**2} cells")
    print(f"Bounding box: {args.bbox}")
    print("=" * 60)

    # Validate inputs
    if not os.path.exists(args.admin_boundaries):
        print(f"Error: Admin boundaries not found: {args.admin_boundaries}")
        sys.exit(1)

    if args.worldpop and not os.path.exists(args.worldpop):
        print(f"Warning: WorldPop raster not found: {args.worldpop}")
        print("Proceeding without population data...")
        args.worldpop = None

    # Load admin boundaries
    print("\nLoading admin boundaries...")
    admin_gdf = load_admin_boundaries(args.admin_boundaries)

    # Get country boundary
    print("\nExtracting country boundary...")
    country_boundary = load_country_boundary(admin_gdf)
    print(f"Country boundary type: {country_boundary.geom_type}")

    # Create grid cells
    bbox = tuple(args.bbox)
    cells = create_grid_cells(bbox, args.grid_size)
    print(f"\nCreated {len(cells)} grid cells for processing")

    # Process
    if args.workers > 1:
        print(f"\nProcessing in parallel with {args.workers} workers...")
        total = process_parallel(
            cells,
            country_boundary,
            args.admin_boundaries,
            args.worldpop,
            args.output,
            args.workers
        )
    else:
        print("\nProcessing sequentially...")
        total = process_sequential(
            cells,
            country_boundary,
            admin_gdf,
            args.worldpop,
            args.output,
            args.chunk_size
        )

    print("\n" + "=" * 60)
    print(f"Complete! Generated {total:,} quadkey pixels")
    print(f"Output: {args.output}")
    print("=" * 60)


if __name__ == '__main__':
    main()
