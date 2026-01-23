#!/usr/bin/env python3
# ABOUTME: Tests for the Bangladesh quadkey generation script
# ABOUTME: Verifies core functionality with small test areas

"""
Tests for generate_bd_quadkeys.py
"""

import os
import tempfile
import pytest
import mercantile
import geopandas as gpd
import pandas as pd
from shapely.geometry import box, Point, Polygon

from generate_bd_quadkeys import (
    GridCell,
    create_grid_cells,
    generate_tiles_for_bbox,
    tile_to_record,
    BANGLADESH_BBOX,
    QUADKEY_LEVEL,
)


class TestGridCell:
    """Tests for GridCell and grid creation."""

    def test_create_grid_cells_count(self):
        """Grid cells should be grid_size squared."""
        cells = create_grid_cells(BANGLADESH_BBOX, grid_size=4)
        assert len(cells) == 16

        cells = create_grid_cells(BANGLADESH_BBOX, grid_size=8)
        assert len(cells) == 64

    def test_create_grid_cells_coverage(self):
        """Grid cells should cover the entire bbox."""
        bbox = (0.0, 0.0, 1.0, 1.0)
        cells = create_grid_cells(bbox, grid_size=2)

        # Collect all cell bounds
        min_lngs = [c.min_lng for c in cells]
        max_lngs = [c.max_lng for c in cells]
        min_lats = [c.min_lat for c in cells]
        max_lats = [c.max_lat for c in cells]

        assert min(min_lngs) == pytest.approx(0.0)
        assert max(max_lngs) == pytest.approx(1.0)
        assert min(min_lats) == pytest.approx(0.0)
        assert max(max_lats) == pytest.approx(1.0)

    def test_grid_cell_bounds_property(self):
        """GridCell bounds property should return correct tuple."""
        cell = GridCell(id=0, min_lng=1.0, min_lat=2.0, max_lng=3.0, max_lat=4.0)
        assert cell.bounds == (1.0, 2.0, 3.0, 4.0)


class TestTileGeneration:
    """Tests for tile generation functions."""

    def test_generate_tiles_for_small_bbox(self):
        """Should generate tiles for a small bounding box."""
        # Small bbox around Dhaka
        bbox = (90.35, 23.7, 90.45, 23.8)
        tiles = list(generate_tiles_for_bbox(bbox, level=18))

        assert len(tiles) > 0
        # All tiles should be at level 18
        assert all(t.z == 18 for t in tiles)

    def test_generate_tiles_returns_generator(self):
        """Should return a generator, not a list."""
        bbox = (90.35, 23.7, 90.45, 23.8)
        result = generate_tiles_for_bbox(bbox, level=18)

        # Should be a generator
        assert hasattr(result, '__iter__')
        assert hasattr(result, '__next__')

    def test_tile_to_record_structure(self):
        """tile_to_record should return correct structure."""
        tile = mercantile.Tile(x=206391, y=116702, z=18)
        record = tile_to_record(tile)

        assert 'quadkey' in record
        assert 'geometry_wkt' in record
        assert 'latitude' in record
        assert 'longitude' in record
        assert 'level' in record

        assert record['level'] == 18
        assert len(record['quadkey']) == 18
        assert record['geometry_wkt'].startswith('POLYGON((')

    def test_tile_to_record_centroid_in_bounds(self):
        """Centroid should be within tile bounds."""
        tile = mercantile.Tile(x=206391, y=116702, z=18)
        record = tile_to_record(tile)
        bounds = mercantile.bounds(tile)

        assert bounds.west <= record['longitude'] <= bounds.east
        assert bounds.south <= record['latitude'] <= bounds.north


class TestIntegration:
    """Integration tests for the full pipeline."""

    def test_small_area_generates_quadkeys(self):
        """Generate quadkeys for a very small test area."""
        # Tiny bbox (about 1km x 1km) in Dhaka
        bbox = (90.40, 23.75, 90.41, 23.76)

        tiles = list(generate_tiles_for_bbox(bbox, level=18))
        records = [tile_to_record(t) for t in tiles]

        assert len(records) > 0
        assert len(records) < 1000  # Should be manageable size

        # Create DataFrame
        df = pd.DataFrame(records)
        assert 'quadkey' in df.columns
        assert df['quadkey'].nunique() == len(df)  # All unique

    def test_can_create_geodataframe(self):
        """Should be able to create GeoDataFrame from records."""
        bbox = (90.40, 23.75, 90.41, 23.76)

        tiles = list(generate_tiles_for_bbox(bbox, level=18))
        records = [tile_to_record(t) for t in tiles]

        df = pd.DataFrame(records)
        geometry = [Point(r['longitude'], r['latitude']) for r in records]
        gdf = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

        assert len(gdf) > 0
        assert gdf.crs.to_string() == 'EPSG:4326'


class TestBangladeshBbox:
    """Tests specific to Bangladesh coverage."""

    def test_bangladesh_bbox_valid(self):
        """Bangladesh bbox should be valid coordinates."""
        min_lng, min_lat, max_lng, max_lat = BANGLADESH_BBOX

        assert 88.0 <= min_lng <= 93.0
        assert 20.0 <= min_lat <= 27.0
        assert 88.0 <= max_lng <= 93.0
        assert 20.0 <= max_lat <= 27.0
        assert min_lng < max_lng
        assert min_lat < max_lat

    def test_dhaka_in_bangladesh_bbox(self):
        """Dhaka (capital) should be within Bangladesh bbox."""
        dhaka_lng, dhaka_lat = 90.4125, 23.8103
        min_lng, min_lat, max_lng, max_lat = BANGLADESH_BBOX

        assert min_lng <= dhaka_lng <= max_lng
        assert min_lat <= dhaka_lat <= max_lat


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
