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
    - Uses exactextract for fast raster extraction
    - Pre-clips raster per grid cell to reduce I/O
    - Supports parallel processing with --workers flag
    - Resumable: skips already-completed cells
    - Spatial indexing for fast admin boundary lookups
"""

import argparse
import os
import sys
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
from exactextract import exact_extract
from shapely.geometry import Point, Polygon, box, shape, mapping
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
            return adm0.union_all()

    # Fall back to union of all geometries
    print("Creating country boundary from union of all admin boundaries...")
    return admin_gdf.union_all()


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


def extract_population_exactextract(gdf: gpd.GeoDataFrame,
                                    raster_path: str,
                                    statistic: str = 'sum') -> pd.Series:
    """
    Extract population values using exactextract for speed.

    Args:
        gdf: GeoDataFrame with polygon geometries
        raster_path: Path to raster file (GeoTIFF)
        statistic: Statistic to compute (sum, mean, etc.)

    Returns:
        Series with population values
    """
    # exactextract reads directly from the raster file
    # It handles COGs efficiently, reading only what's needed
    result = exact_extract(
        raster_path,
        gdf,
        [statistic],
        output='pandas'
    )

    return result[statistic]


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
        # Check if already completed (resumability)
        output_path = os.path.join(output_dir, f'cell_{cell.id:04d}.parquet')
        if os.path.exists(output_path):
            # Validate the file is readable
            try:
                existing_df = pd.read_parquet(output_path)
                print(f"Cell {cell.id}: Already completed ({len(existing_df)} records), skipping")
                return (cell.id, output_path, len(existing_df))
            except Exception:
                # File is corrupt, reprocess
                os.remove(output_path)

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
            print(f"Cell {cell.id}: Extracting population data...")

            # Create polygon geometries for zonal stats
            polygon_geoms = [wkt.loads(w) for w in geocoded['geometry_wkt']]
            polygon_gdf = gpd.GeoDataFrame(
                geocoded.drop(columns=['geometry']),
                geometry=polygon_geoms,
                crs='EPSG:4326'
            )

            # Extract population using exactextract (reads directly from raster file)
            try:
                geocoded['population'] = extract_population_exactextract(
                    polygon_gdf, worldpop_path, 'sum'
                )
            except Exception as e:
                print(f"Cell {cell.id}: Population extraction failed: {e}")
                import traceback
                traceback.print_exc()
                geocoded['population'] = None
        else:
            geocoded['population'] = None

        # Prepare output DataFrame
        output_df = geocoded[[
            'quadkey', 'geometry_wkt', 'latitude', 'longitude', 'level',
            'ADM1_PCODE', 'ADM2_PCODE', 'ADM3_PCODE', 'ADM4_PCODE', 'population'
        ]].copy()

        # Rename columns to lowercase
        output_df.columns = [c.lower() for c in output_df.columns]

        # Write to parquet file
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
                       work_dir: str,
                       chunk_size: int = DEFAULT_CHUNK_SIZE) -> int:
    """
    Process all cells sequentially with chunked writing.

    Args:
        cells: List of grid cells to process
        country_boundary: Country boundary polygon for filtering
        admin_gdf: GeoDataFrame with admin boundaries
        worldpop_path: Path to WorldPop raster
        output_path: Output parquet file path
        work_dir: Working directory for intermediate files
        chunk_size: Number of records per write batch

    Returns:
        Total number of records written
    """
    # Pre-clip raster once if available
    clipped_raster = None
    raster_meta = None

    # Process each cell
    country_boundary_wkt = country_boundary.wkt

    for cell_idx, cell in enumerate(cells):
        print(f"\nProcessing cell {cell_idx + 1}/{len(cells)} (id={cell.id})...")

        result = process_grid_cell(
            cell,
            country_boundary_wkt,
            admin_gdf,  # Pass loaded GDF for sequential
            worldpop_path,
            work_dir
        )

        if result[1]:
            print(f"  Completed: {result[2]} records")

    # Merge all cell parquet files
    print("\nMerging results...")
    cell_files = sorted(Path(work_dir).glob('cell_*.parquet'))

    if not cell_files:
        print("No data generated!")
        return 0

    dfs = []
    for f in cell_files:
        dfs.append(pd.read_parquet(f))

    merged_df = pd.concat(dfs, ignore_index=True)
    merged_df.to_parquet(output_path, index=False)

    total_records = len(merged_df)
    print(f"Wrote {total_records} records to {output_path}")

    return total_records


def process_parallel(cells: List[GridCell],
                     country_boundary: Polygon,
                     admin_path: str,
                     worldpop_path: Optional[str],
                     output_path: str,
                     work_dir: str,
                     num_workers: int = 4) -> int:
    """
    Process cells in parallel using ProcessPoolExecutor.

    Args:
        cells: List of grid cells to process
        country_boundary: Country boundary polygon for filtering
        admin_path: Path to admin boundaries (for subprocess to load)
        worldpop_path: Path to WorldPop raster
        output_path: Output parquet file path
        work_dir: Working directory for intermediate files (persistent for resumability)
        num_workers: Number of parallel workers

    Returns:
        Total number of records written
    """
    # Convert boundary to WKT for serialization
    country_boundary_wkt = country_boundary.wkt

    print(f"Using work directory: {work_dir}")

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
                work_dir
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

    # Merge all cell parquet files
    print("\nMerging results...")
    cell_files = sorted(Path(work_dir).glob('cell_*.parquet'))

    if not cell_files:
        print("No data generated!")
        return 0

    # Read and concatenate all cell files
    dfs = []
    for f in cell_files:
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
        '--work-dir',
        help='Working directory for intermediate cell files (enables resumability). '
             'If not specified, uses a temp directory next to output file.'
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
    parser.add_argument(
        '--resume',
        action='store_true',
        help='Resume from previous run (requires --work-dir or uses default work dir)'
    )

    args = parser.parse_args()

    # Set up work directory for resumability
    if args.work_dir:
        work_dir = args.work_dir
    else:
        # Create work dir next to output file
        output_path = Path(args.output)
        work_dir = str(output_path.parent / f'.{output_path.stem}_work')

    Path(work_dir).mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("Bangladesh Quadkey Pixel Generator")
    print("=" * 60)
    print(f"Admin boundaries: {args.admin_boundaries}")
    print(f"WorldPop raster: {args.worldpop or 'Not provided'}")
    print(f"Output file: {args.output}")
    print(f"Work directory: {work_dir}")
    print(f"Workers: {args.workers}")
    print(f"Grid size: {args.grid_size}x{args.grid_size} = {args.grid_size**2} cells")
    print(f"Bounding box: {args.bbox}")
    print(f"Resume mode: {args.resume}")
    print("=" * 60)

    # Validate inputs
    if not os.path.exists(args.admin_boundaries):
        print(f"Error: Admin boundaries not found: {args.admin_boundaries}")
        sys.exit(1)

    if args.worldpop and not os.path.exists(args.worldpop):
        print(f"Warning: WorldPop raster not found: {args.worldpop}")
        print("Proceeding without population data...")
        args.worldpop = None

    # Check for existing progress
    existing_cells = list(Path(work_dir).glob('cell_*.parquet'))
    if existing_cells:
        print(f"\nFound {len(existing_cells)} completed cells in work directory")
        if not args.resume:
            print("Use --resume to continue from previous run, or delete work directory to start fresh")

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
            work_dir,
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
            work_dir,
            args.chunk_size
        )

    print("\n" + "=" * 60)
    print(f"Complete! Generated {total:,} quadkey pixels")
    print(f"Output: {args.output}")
    print("=" * 60)


if __name__ == '__main__':
    main()
