# ABOUTME: Temporal activities for location upload operations
# ABOUTME: Database operations and file parsing for location workflows

from temporalio import activity
from typing import List, Dict, Any
import json
import csv
import io
import mercantile
from shapely.geometry import shape
from db.connection import get_db_connection, return_db_connection


QUADKEY_LEVEL = 18


def calculate_quadkey(latitude, longitude, level=QUADKEY_LEVEL):
    """Calculate quadkey from latitude/longitude at given level"""
    if latitude is None or longitude is None:
        return None
    try:
        tile = mercantile.tile(float(longitude), float(latitude), level)
        return mercantile.quadkey(tile)
    except Exception as e:
        activity.logger.warning(f"Error calculating quadkey for lat={latitude}, lng={longitude}: {e}")
        return None


def calculate_centroid(geometry_dict):
    """Calculate centroid from a GeoJSON geometry dict"""
    try:
        geom = shape(geometry_dict)
        centroid = geom.centroid
        return centroid.y, centroid.x  # lat, lng
    except Exception as e:
        activity.logger.warning(f"Error calculating centroid: {e}")
        return None, None


def geometry_to_wkt(geometry_dict):
    """Convert GeoJSON geometry to PostGIS WKT"""
    try:
        geom = shape(geometry_dict)
        return geom.wkt
    except Exception as e:
        activity.logger.warning(f"Error converting geometry to WKT: {e}")
        return None


def find_duplicate(cursor, area_id, external_id, lat, lng, geometry_wkt):
    """
    Find duplicate location using multiple strategies:
    1. Match by external_id
    2. Match by lat/lng (within tolerance)
    3. Match by geometry intersection
    """
    # Strategy 1: Match by external_id
    if external_id:
        cursor.execute("""
            SELECT id FROM locations
            WHERE area_id = %s AND external_id = %s
            LIMIT 1
        """, (area_id, external_id))
        result = cursor.fetchone()
        if result:
            return str(result[0])

    # Strategy 2: Match by lat/lng (within 0.0001 degrees ~11 meters)
    if lat is not None and lng is not None:
        cursor.execute("""
            SELECT id FROM locations
            WHERE area_id = %s
            AND ABS(latitude - %s) < 0.0001
            AND ABS(longitude - %s) < 0.0001
            LIMIT 1
        """, (area_id, lat, lng))
        result = cursor.fetchone()
        if result:
            return str(result[0])

    # Strategy 3: Match by geometry intersection (if we have geometry)
    if geometry_wkt:
        cursor.execute("""
            SELECT id FROM locations
            WHERE area_id = %s
            AND ST_Intersects(geometry, ST_GeomFromText(%s, 4326))
            LIMIT 1
        """, (area_id, geometry_wkt))
        result = cursor.fetchone()
        if result:
            return str(result[0])

    return None


@activity.defn
async def parse_location_file(
    file_path: str,
    file_type: str,
    config: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Parse uploaded location file (GeoJSON or CSV).

    Args:
        file_path: Path to uploaded file
        file_type: Type of file ('geojson' or 'csv')
        config: Upload configuration (column mappings)

    Returns:
        List of GeoJSON features
    """
    activity.logger.info(f"Parsing {file_type} file: {file_path}")

    features = []

    with open(file_path, 'r') as file:
        if file_type in ['geojson', 'json']:
            # Parse GeoJSON
            content = file.read()
            data = json.loads(content)

            if data.get('type') == 'FeatureCollection':
                features = data.get('features', [])
            elif data.get('type') == 'Feature':
                features = [data]
            else:
                raise ValueError(f"Invalid GeoJSON type: {data.get('type')}")

            # Extract external_id from properties if specified
            ext_id_col = config.get('externalIdColumn')
            if ext_id_col:
                for feature in features:
                    properties = feature.get('properties', {})
                    if ext_id_col in properties:
                        feature['properties']['external_id'] = properties[ext_id_col]

        elif file_type == 'csv':
            # Parse CSV
            content = file.read()
            csv_reader = csv.DictReader(io.StringIO(content))

            lat_col = config.get('latColumn')
            lng_col = config.get('lngColumn')
            ext_id_col = config.get('externalIdColumn')

            if not lat_col or not lng_col:
                raise ValueError('Latitude and longitude columns must be specified for CSV')

            for row in csv_reader:
                try:
                    lat = float(row[lat_col])
                    lng = float(row[lng_col])

                    # Create GeoJSON feature
                    feature = {
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Point',
                            'coordinates': [lng, lat]
                        },
                        'properties': {}
                    }

                    # Add external_id if column specified
                    if ext_id_col and ext_id_col in row:
                        feature['properties']['external_id'] = row[ext_id_col]

                    # Add all other columns to properties
                    for key, value in row.items():
                        if key not in [lat_col, lng_col, ext_id_col]:
                            feature['properties'][key] = value

                    features.append(feature)
                except (ValueError, KeyError) as e:
                    activity.logger.warning(f"Skipping CSV row due to error: {e}")
                    continue
        else:
            raise ValueError(f'Unsupported file format: {file_type}')

    activity.logger.info(f"Parsed {len(features)} features")
    return features


@activity.defn
async def process_location_batch(
    area_id: str,
    features: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Process a batch of location features (insert/update with deduplication).

    Args:
        area_id: Area ID
        features: List of GeoJSON features

    Returns:
        Result with counts and new location IDs
    """
    activity.logger.info(f"Processing batch of {len(features)} features")

    conn = get_db_connection()
    cursor = conn.cursor()

    inserted_count = 0
    updated_count = 0
    errors = []
    new_location_ids = []

    try:
        for idx, feature in enumerate(features):
            try:
                geometry = feature.get('geometry', {})
                properties = feature.get('properties', {})

                # Extract coordinates
                geom_type = geometry.get('type')
                coords = geometry.get('coordinates', [])

                # Calculate lat/lng
                if geom_type == 'Point':
                    lng, lat = coords[0], coords[1]
                elif geom_type in ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']:
                    lat, lng = calculate_centroid(geometry)
                else:
                    lat, lng = None, None

                # Get external_id
                external_id = properties.pop('external_id', None)

                # Convert geometry to WKT for PostGIS
                geometry_wkt = geometry_to_wkt(geometry) if geometry else None

                # Check for duplicates
                duplicate_id = find_duplicate(cursor, area_id, external_id, lat, lng, geometry_wkt)

                if duplicate_id:
                    # Update existing location
                    quadkey = calculate_quadkey(lat, lng)
                    cursor.execute("""
                        UPDATE locations
                        SET
                            external_id = COALESCE(%s, external_id),
                            geometry = COALESCE(ST_GeomFromText(%s, 4326), geometry),
                            latitude = COALESCE(%s, latitude),
                            longitude = COALESCE(%s, longitude),
                            quadkey = COALESCE(%s, quadkey),
                            properties = properties || %s::jsonb,
                            updated_at = NOW()
                        WHERE id = %s
                    """, (
                        external_id, geometry_wkt, lat, lng, quadkey,
                        json.dumps(properties),
                        duplicate_id
                    ))
                    updated_count += 1
                else:
                    # Insert new location
                    quadkey = calculate_quadkey(lat, lng)
                    cursor.execute("""
                        INSERT INTO locations (
                            area_id, external_id, geometry, latitude, longitude, quadkey, properties
                        )
                        VALUES (
                            %s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s, %s
                        )
                        RETURNING id
                    """, (
                        area_id, external_id, geometry_wkt, lat, lng, quadkey,
                        json.dumps(properties)
                    ))
                    new_location_id = cursor.fetchone()[0]
                    new_location_ids.append(str(new_location_id))
                    inserted_count += 1

            except Exception as e:
                errors.append(f"Feature {idx + 1}: {str(e)}")
                activity.logger.warning(f"Error processing feature {idx + 1}: {e}")
                continue

        conn.commit()

    finally:
        cursor.close()
        return_db_connection(conn)

    activity.logger.info(
        f"Batch complete: inserted={inserted_count}, updated={updated_count}, errors={len(errors)}"
    )

    return {
        'inserted': inserted_count,
        'updated': updated_count,
        'new_location_ids': new_location_ids,
        'errors': errors
    }


@activity.defn
async def populate_coverage_for_locations(area_id: str, new_location_ids: List[str]) -> None:
    """
    Populate coverage table for newly added locations.

    Args:
        area_id: Area ID
        new_location_ids: List of new location IDs
    """
    if not new_location_ids:
        return

    activity.logger.info(f"Populating coverage for {len(new_location_ids)} locations")

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get the project_id from the area
        cursor.execute("SELECT project_id FROM areas WHERE id = %s", (area_id,))
        result = cursor.fetchone()
        if not result:
            activity.logger.warning(f"Could not find area {area_id}")
            return

        project_id = result[0]

        # Get all indicators for this project
        cursor.execute("SELECT id FROM indicators WHERE project_id = %s", (project_id,))
        indicators = cursor.fetchall()

        if not indicators:
            activity.logger.info(f"No indicators found for project {project_id}")
            return

        # For each new location
        for location_id in new_location_ids:
            # Get location properties and coordinates
            cursor.execute(
                "SELECT properties, latitude, longitude FROM locations WHERE id = %s",
                (location_id,)
            )
            location_result = cursor.fetchone()

            if not location_result:
                continue

            properties = location_result[0] if location_result[0] else {}
            latitude = float(location_result[1])
            longitude = float(location_result[2])

            # Calculate quadkey
            quadkey = calculate_quadkey(latitude, longitude)

            # Extract prediction values, defaulting to 0
            exceedance_probability = properties.get('exceedance_probability', 0)
            exceedance_uncertainty = properties.get('exceedance_uncertainty', 0)
            prevalence_bci_width = properties.get('prevalence_bci_width', 0)
            prevalence_prediction = properties.get('prevalence_prediction', 0)

            # For each indicator, create coverage entry
            for (indicator_id,) in indicators:
                cursor.execute("""
                    INSERT INTO coverage (
                        location_id, area_id, indicator_id, quadkey,
                        version, n_trials, n_covered,
                        exceedance_probability, exceedance_uncertainty,
                        prevalence_bci_width, prevalence_prediction
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (location_id, indicator_id) DO NOTHING
                """, (
                    location_id, area_id, indicator_id, quadkey,
                    1, 0, 0,  # version=1, n_trials=0, n_covered=0 for new records
                    exceedance_probability, exceedance_uncertainty,
                    prevalence_bci_width, prevalence_prediction
                ))

        conn.commit()

    finally:
        cursor.close()
        return_db_connection(conn)

    activity.logger.info("Coverage population complete")


@activity.defn
async def generate_pixels_for_quadkeys(area_id: str) -> Dict[str, Any]:
    """
    Auto-generate pixels for location quadkeys that don't have pixels yet.

    Args:
        area_id: Area ID

    Returns:
        Result with new quadkeys
    """
    activity.logger.info(f"Generating pixels for area {area_id}")

    conn = get_db_connection()
    cursor = conn.cursor()
    new_quadkeys = []

    try:
        # Get all unique quadkeys from locations in this area
        cursor.execute("""
            SELECT DISTINCT quadkey FROM locations
            WHERE area_id = %s AND quadkey IS NOT NULL
        """, (area_id,))
        location_quadkeys = {row[0] for row in cursor.fetchall()}

        if not location_quadkeys:
            activity.logger.info("No valid quadkeys found in locations")
            return {'new_quadkeys': []}

        # Get existing pixels for this area
        cursor.execute("SELECT quadkey FROM pixels WHERE area_id = %s", (area_id,))
        existing_quadkeys = {row[0] for row in cursor.fetchall()}

        # Find quadkeys that need pixels
        quadkeys_needing_pixels = location_quadkeys - existing_quadkeys

        if quadkeys_needing_pixels:
            activity.logger.info(f"Creating {len(quadkeys_needing_pixels)} new pixels")

            # Create pixel data for each missing quadkey
            pixel_data = []
            for quadkey in quadkeys_needing_pixels:
                tile = mercantile.quadkey_to_tile(quadkey)
                bounds = mercantile.bounds(tile)

                # Calculate centroid
                centroid_lng = (bounds.west + bounds.east) / 2
                centroid_lat = (bounds.south + bounds.north) / 2

                # Create polygon geometry WKT
                geometry_wkt = (
                    f"POLYGON(({bounds.west} {bounds.south}, "
                    f"{bounds.west} {bounds.north}, "
                    f"{bounds.east} {bounds.north}, "
                    f"{bounds.east} {bounds.south}, "
                    f"{bounds.west} {bounds.south}))"
                )

                pixel_data.append((
                    area_id,
                    quadkey,
                    geometry_wkt,
                    centroid_lat,
                    centroid_lng,
                    tile.z
                ))

            # Batch insert pixels
            cursor.executemany("""
                INSERT INTO pixels (area_id, quadkey, geometry, latitude, longitude, level)
                VALUES (%s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s)
                ON CONFLICT ON CONSTRAINT pixels_area_quadkey_unique DO NOTHING
            """, pixel_data)

            new_quadkeys = list(quadkeys_needing_pixels)
            conn.commit()

            activity.logger.info(f"Created {len(new_quadkeys)} pixels")
        else:
            activity.logger.info("All location quadkeys already have pixels")

    finally:
        cursor.close()
        return_db_connection(conn)

    return {'new_quadkeys': new_quadkeys}


@activity.defn
async def create_coverage_pixel_records(area_id: str, quadkeys: List[str]) -> None:
    """
    Create default coverage_pixel records for new pixels.

    Args:
        area_id: Area ID
        quadkeys: List of quadkeys for new pixels
    """
    if not quadkeys:
        return

    activity.logger.info(f"Creating coverage_pixel records for {len(quadkeys)} pixels")

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # Get the project_id from the area
        cursor.execute("SELECT project_id FROM areas WHERE id = %s", (area_id,))
        result = cursor.fetchone()
        if not result:
            activity.logger.warning(f"Could not find area {area_id}")
            return

        project_id = result[0]

        # Get all indicators for this project
        cursor.execute("SELECT id FROM indicators WHERE project_id = %s", (project_id,))
        indicators = cursor.fetchall()

        if not indicators:
            activity.logger.info(f"No indicators found for project {project_id}")
            return

        # For each quadkey and indicator, create coverage_pixel entry
        for quadkey in quadkeys:
            for (indicator_id,) in indicators:
                cursor.execute("""
                    INSERT INTO coverage_pixel (
                        quadkey, area_id, indicator_id, version,
                        n_trials, n_covered
                    )
                    VALUES (%s, %s, %s, %s, 0, 0)
                    ON CONFLICT (quadkey, indicator_id, area_id) DO NOTHING
                """, (quadkey, area_id, indicator_id, 1))

        conn.commit()

    finally:
        cursor.close()
        return_db_connection(conn)

    activity.logger.info("Coverage_pixel records created")
