#!/bin/bash
# ABOUTME: Converts geoparquet admin boundary files to pmtiles format
# ABOUTME: Uses ogr2ogr to convert to GeoJSON, then tippecanoe to create pmtiles

set -e

GEOPARQUET_DIR="/Users/mberg/github/truecover/geoparquet"
PMTILES_DIR="/Users/mberg/github/truecover/pmtiles"
TEMP_DIR="/tmp/geojson_conversion"

# Create temp directory for intermediate GeoJSON files
mkdir -p "$TEMP_DIR"

echo "Converting geoparquet files to pmtiles..."

# Convert ADM0 (country level) - visible at all zooms
echo "Converting ADM0 (country)..."
ogr2ogr -f GeoJSON "$TEMP_DIR/adm0.geojson" "$GEOPARQUET_DIR/bgd_admbnda_adm0_bbs_20201113.geoparquet"
tippecanoe -o "$PMTILES_DIR/bgd_adm0.pmtiles" \
  --layer="admin_boundaries_adm0" \
  --minimum-zoom=0 \
  --maximum-zoom=12 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  "$TEMP_DIR/adm0.geojson"

# Convert ADM1 (division level) - visible from zoom 4+
echo "Converting ADM1 (division)..."
ogr2ogr -f GeoJSON "$TEMP_DIR/adm1.geojson" "$GEOPARQUET_DIR/bgd_admbnda_adm1_bbs_20201113.geoparquet"
tippecanoe -o "$PMTILES_DIR/bgd_adm1.pmtiles" \
  --layer="admin_boundaries_adm1" \
  --minimum-zoom=4 \
  --maximum-zoom=12 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  "$TEMP_DIR/adm1.geojson"

# Convert ADM2 (district level) - visible from zoom 6+
echo "Converting ADM2 (district)..."
ogr2ogr -f GeoJSON "$TEMP_DIR/adm2.geojson" "$GEOPARQUET_DIR/bgd_admbnda_adm2_bbs_20201113.geoparquet"
tippecanoe -o "$PMTILES_DIR/bgd_adm2.pmtiles" \
  --layer="admin_boundaries_adm2" \
  --minimum-zoom=6 \
  --maximum-zoom=14 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  "$TEMP_DIR/adm2.geojson"

# Convert ADM3 (upazila level) - visible from zoom 8+
echo "Converting ADM3 (upazila)..."
ogr2ogr -f GeoJSON "$TEMP_DIR/adm3.geojson" "$GEOPARQUET_DIR/bgd_admbnda_adm3_bbs_20201113.geoparquet"
tippecanoe -o "$PMTILES_DIR/bgd_adm3.pmtiles" \
  --layer="admin_boundaries_adm3" \
  --minimum-zoom=8 \
  --maximum-zoom=16 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  "$TEMP_DIR/adm3.geojson"

# Convert ADM4 (union level) - visible from zoom 10+
echo "Converting ADM4 (union)..."
ogr2ogr -f GeoJSON "$TEMP_DIR/adm4.geojson" "$GEOPARQUET_DIR/bgd_admbnda_adm4_bbs_20201113.geoparquet"
tippecanoe -o "$PMTILES_DIR/bgd_adm4.pmtiles" \
  --layer="admin_boundaries_adm4" \
  --minimum-zoom=10 \
  --maximum-zoom=18 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  "$TEMP_DIR/adm4.geojson"

# Convert boundary lines (admALL boundaries)
echo "Converting admin boundary lines..."
ogr2ogr -f GeoJSON "$TEMP_DIR/adm_lines.geojson" "$GEOPARQUET_DIR/bgd_admbndl_admALL_bbs_itos_20201113.geoparquet"
tippecanoe -o "$PMTILES_DIR/bgd_adm_lines.pmtiles" \
  --layer="admin_boundary_lines" \
  --minimum-zoom=0 \
  --maximum-zoom=18 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  "$TEMP_DIR/adm_lines.geojson"

# Convert boundary points (admALL points)
echo "Converting admin boundary points..."
ogr2ogr -f GeoJSON "$TEMP_DIR/adm_points.geojson" "$GEOPARQUET_DIR/bgd_admbndp_admALL_bbs_itos_20201113.geoparquet"
tippecanoe -o "$PMTILES_DIR/bgd_adm_points.pmtiles" \
  --layer="admin_boundary_points" \
  --minimum-zoom=8 \
  --maximum-zoom=18 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --force \
  "$TEMP_DIR/adm_points.geojson"

# Clean up temp files
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

echo "Conversion complete! PMTiles are in: $PMTILES_DIR"
ls -lh "$PMTILES_DIR"/*.pmtiles
