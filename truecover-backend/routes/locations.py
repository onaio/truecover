from flask import Blueprint, jsonify, request
from auth.middleware import require_auth
from auth.helpers import check_area_access
from db.connection import get_db_connection, return_db_connection
import json
import csv
import io
from shapely.geometry import shape, Point, mapping
from shapely.wkt import loads as wkt_loads
import mercantile

locations_bp = Blueprint('locations', __name__)

QUADKEY_LEVEL = 18


def calculate_quadkey(latitude, longitude, level=QUADKEY_LEVEL):
    """Calculate quadkey from latitude/longitude at given level"""
    if latitude is None or longitude is None:
        return None
    try:
        tile = mercantile.tile(longitude, latitude, level)
        return mercantile.quadkey(tile)
    except Exception as e:
        print(f"Error calculating quadkey for lat={latitude}, lng={longitude}: {e}")
        return None


def calculate_centroid(geometry_dict):
    """Calculate centroid from a GeoJSON geometry dict"""
    try:
        geom = shape(geometry_dict)
        centroid = geom.centroid
        return centroid.y, centroid.x  # lat, lng
    except Exception as e:
        print(f"Error calculating centroid: {e}")
        return None, None


def geometry_to_wkt(geometry_dict):
    """Convert GeoJSON geometry to PostGIS WKT"""
    try:
        geom = shape(geometry_dict)
        return geom.wkt
    except Exception as e:
        print(f"Error converting geometry to WKT: {e}")
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


def populate_coverage_for_locations(cursor, area_id, new_location_ids):
    """
    Populate coverage table for newly added locations.
    For each indicator in the project, create coverage entries for all new locations
    with prediction values defaulting to 0 if not present in location properties.

    Args:
        cursor: Database cursor
        area_id: UUID of the area
        new_location_ids: List of UUIDs of newly inserted locations
    """
    if not new_location_ids:
        return

    try:
        # Get the project_id from the area
        cursor.execute("""
            SELECT project_id FROM areas WHERE id = %s
        """, (area_id,))
        result = cursor.fetchone()
        if not result:
            print(f"Warning: Could not find area {area_id}")
            return

        project_id = result[0]

        # Get all indicators for this project
        cursor.execute("""
            SELECT id FROM indicators WHERE project_id = %s
        """, (project_id,))
        indicators = cursor.fetchall()

        print(f"Found {len(indicators)} indicators for project {project_id}")
        if not indicators:
            print(f"Info: No indicators found for project {project_id}, skipping coverage population")
            return

        # For each new location
        for location_id in new_location_ids:
            # Get location properties and coordinates to extract prediction values and calculate quadkey
            cursor.execute("""
                SELECT properties, latitude, longitude FROM locations WHERE id = %s
            """, (location_id,))
            location_result = cursor.fetchone()

            if not location_result:
                continue

            properties = location_result[0] if location_result[0] else {}
            latitude = float(location_result[1])
            longitude = float(location_result[2])

            # Extract prediction values, defaulting to 0
            exceedance_probability = properties.get('exceedance_probability', 0)
            exceedance_uncertainty = properties.get('exceedance_uncertainty', 0)
            prevalence_bci_width = properties.get('prevalence_bci_width', 0)
            prevalence_prediction = properties.get('prevalence_prediction', 0)

            # Ensure numeric types
            try:
                exceedance_probability = float(exceedance_probability) if exceedance_probability is not None else 0
                exceedance_uncertainty = float(exceedance_uncertainty) if exceedance_uncertainty is not None else 0
                prevalence_bci_width = float(prevalence_bci_width) if prevalence_bci_width is not None else 0
                prevalence_prediction = float(prevalence_prediction) if prevalence_prediction is not None else 0
            except (ValueError, TypeError):
                # If conversion fails, default to 0
                exceedance_probability = 0
                exceedance_uncertainty = 0
                prevalence_bci_width = 0
                prevalence_prediction = 0

            # Calculate quadkey from location coordinates
            quadkey = calculate_quadkey(latitude, longitude)

            # For each indicator, create a coverage entry
            for indicator_row in indicators:
                indicator_id = indicator_row[0]

                # Check if coverage entry already exists
                cursor.execute("""
                    SELECT id FROM coverage
                    WHERE location_id = %s AND indicator_id = %s AND version = 0
                """, (location_id, indicator_id))

                if cursor.fetchone():
                    # Entry already exists, skip
                    continue

                # Insert new coverage entry with quadkey
                cursor.execute("""
                    INSERT INTO coverage (
                        location_id, area_id, indicator_id,
                        version, n_trials, n_covered,
                        exceedance_probability, exceedance_uncertainty,
                        prevalence_bci_width, prevalence_prediction, quadkey
                    )
                    VALUES (%s, %s, %s, 0, 0, 0, %s, %s, %s, %s, %s)
                """, (
                    location_id, area_id, indicator_id,
                    exceedance_probability, exceedance_uncertainty,
                    prevalence_bci_width, prevalence_prediction, quadkey
                ))

        expected_total = len(new_location_ids) * len(indicators)
        print(f"Coverage population complete: processed {len(new_location_ids)} locations × {len(indicators)} indicators = {expected_total} total records")

        # Update coverage_pixel table for all affected indicators
        # Import here to avoid circular dependency
        from routes.coverage import update_coverage_pixel

        for indicator_row in indicators:
            indicator_id = indicator_row[0]
            try:
                # Update all quadkeys for this indicator (don't pass specific quadkeys, let it aggregate all)
                update_coverage_pixel(cursor, area_id, indicator_id, quadkeys=None)
            except Exception as e:
                print(f"Error updating coverage_pixel for indicator {indicator_id}: {e}")
                # Continue with other indicators even if one fails

    except Exception as e:
        print(f"Error populating coverage: {e}")
        import traceback
        traceback.print_exc()
        # Don't raise - we don't want to fail the upload if coverage population fails


@locations_bp.route('/api/areas/<area_id>/locations/upload', methods=['POST'])
@require_auth
def upload_locations(user, area_id):
    """Upload locations from GeoJSON or CSV file"""
    print(f"===== LOCATION UPLOAD STARTED =====")
    print(f"Area ID: {area_id}")
    print(f"User ID: {user.get('id')}")

    conn = None
    try:
        # Check if user has access to this area
        print(f"Checking area access...")
        if not check_area_access(user['id'], area_id):
            print(f"ERROR: Access denied for user {user.get('id')} to area {area_id}")
            return jsonify({'error': 'Access denied'}), 403
        print(f"Access check passed")

        # Check for file
        if 'file' not in request.files:
            print(f"ERROR: No file in request.files")
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            print(f"ERROR: Empty filename")
            return jsonify({'error': 'No file selected'}), 400

        print(f"File received: {file.filename}")

        # Get configuration from form data
        config = {}
        if request.form.get('latColumn'):
            config['latColumn'] = request.form.get('latColumn')
        if request.form.get('lngColumn'):
            config['lngColumn'] = request.form.get('lngColumn')
        if request.form.get('externalIdColumn'):
            config['externalIdColumn'] = request.form.get('externalIdColumn')

        print(f"Upload config: {config}")

        filename = file.filename.lower()
        print(f"Processing file type: {filename}")

        # Process file based on type
        features = []
        if filename.endswith('.geojson') or filename.endswith('.json'):
            print(f"Parsing as GeoJSON...")
            # Parse GeoJSON
            content = file.read().decode('utf-8')
            print(f"File content length: {len(content)} chars")
            data = json.loads(content)

            if data.get('type') == 'FeatureCollection':
                features = data.get('features', [])
                print(f"FeatureCollection with {len(features)} features")
            elif data.get('type') == 'Feature':
                features = [data]
                print(f"Single Feature")
            else:
                print(f"ERROR: Invalid GeoJSON type: {data.get('type')}")
                return jsonify({'error': 'Invalid GeoJSON format'}), 400

            # For GeoJSON, extract external_id from properties if externalIdColumn is specified
            ext_id_col = config.get('externalIdColumn')
            if ext_id_col:
                print(f"Extracting external_id from column: {ext_id_col}")
                for feature in features:
                    properties = feature.get('properties', {})
                    if ext_id_col in properties:
                        # Move the specified field to external_id
                        feature['properties']['external_id'] = properties[ext_id_col]
            else:
                print(f"WARNING: No externalIdColumn specified in config")

        elif filename.endswith('.csv'):
            # Parse CSV
            content = file.read().decode('utf-8')
            csv_reader = csv.DictReader(io.StringIO(content))

            lat_col = config.get('latColumn')
            lng_col = config.get('lngColumn')
            ext_id_col = config.get('externalIdColumn')

            if not lat_col or not lng_col:
                return jsonify({'error': 'Latitude and longitude columns must be specified for CSV'}), 400

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
                    print(f"Skipping row due to error: {e}")
                    continue
        else:
            print(f"ERROR: Unsupported file format")
            return jsonify({'error': 'Unsupported file format. Use .geojson or .csv'}), 400

        print(f"Starting database operations for {len(features)} features...")
        # Process features
        conn = get_db_connection()
        cursor = conn.cursor()
        print(f"Database connection established")

        inserted_count = 0
        updated_count = 0
        errors = []
        new_location_ids = []  # Track newly inserted location IDs for coverage population

        for idx, feature in enumerate(features):
            if idx % 10 == 0:
                print(f"Processing feature {idx + 1}/{len(features)}...")
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
                    # Calculate centroid
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
                    # Update existing location - merge properties and recalculate quadkey
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
                    # Insert new location and calculate quadkey
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
                print(f"Error processing feature {idx + 1}: {e}")
                continue

        print(f"Feature processing complete. Inserted: {inserted_count}, Updated: {updated_count}, Errors: {len(errors)}")

        # Populate coverage table for new locations
        if new_location_ids:
            print(f"Populating coverage for {len(new_location_ids)} new locations...")
            populate_coverage_for_locations(cursor, area_id, new_location_ids)
            print(f"Coverage population complete")
        else:
            print(f"No new locations to populate coverage for")

        # Generate pixels for uploaded locations (if new locations were added)
        if inserted_count > 0:
            print(f"Auto-generating pixels for uploaded locations...")
            try:
                # Get all unique quadkeys from locations in this area
                cursor.execute("""
                    SELECT DISTINCT quadkey FROM locations
                    WHERE area_id = %s AND quadkey IS NOT NULL
                """, (area_id,))
                location_quadkeys = {row[0] for row in cursor.fetchall()}

                if location_quadkeys:
                    # Get existing pixels for this area
                    cursor.execute("""
                        SELECT quadkey FROM pixels WHERE area_id = %s
                    """, (area_id,))
                    existing_quadkeys = {row[0] for row in cursor.fetchall()}

                    # Find quadkeys that need pixels
                    quadkeys_needing_pixels = location_quadkeys - existing_quadkeys

                    if quadkeys_needing_pixels:
                        print(f"Creating {len(quadkeys_needing_pixels)} new pixels...")

                        # Create pixel data for each missing quadkey
                        pixel_data = []
                        for quadkey in quadkeys_needing_pixels:
                            tile = mercantile.quadkey_to_tile(quadkey)
                            bounds = mercantile.bounds(tile)

                            # Calculate centroid
                            centroid_lng = (bounds.west + bounds.east) / 2
                            centroid_lat = (bounds.south + bounds.north) / 2

                            # Create polygon geometry WKT
                            geometry_wkt = f"POLYGON(({bounds.west} {bounds.south}, {bounds.west} {bounds.north}, {bounds.east} {bounds.north}, {bounds.east} {bounds.south}, {bounds.west} {bounds.south}))"

                            pixel_data.append((
                                quadkey,
                                area_id,
                                geometry_wkt,
                                centroid_lat,
                                centroid_lng,
                                tile.z
                            ))

                        # Batch insert pixels (upsert to handle any race conditions)
                        cursor.executemany("""
                            INSERT INTO pixels (quadkey, area_id, geometry, latitude, longitude, level)
                            VALUES (%s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s)
                            ON CONFLICT (quadkey) DO UPDATE SET
                                area_id = EXCLUDED.area_id,
                                geometry = EXCLUDED.geometry,
                                latitude = EXCLUDED.latitude,
                                longitude = EXCLUDED.longitude,
                                level = EXCLUDED.level,
                                updated_at = NOW()
                        """, pixel_data)

                        print(f"Auto-generated {len(pixel_data)} pixels for uploaded locations")
                    else:
                        print(f"All location quadkeys already have pixels")
                else:
                    print(f"No valid quadkeys found in locations")

            except Exception as e:
                print(f"Error auto-generating pixels: {e}")
                import traceback
                traceback.print_exc()
                # Don't fail the upload if pixel generation fails

        print(f"Committing transaction...")
        conn.commit()
        cursor.close()
        print(f"===== LOCATION UPLOAD COMPLETED SUCCESSFULLY =====")

        return jsonify({
            'success': True,
            'inserted': inserted_count,
            'updated': updated_count,
            'errors': errors
        }), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"===== LOCATION UPLOAD FAILED =====")
        print(f"Error uploading locations: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to upload locations', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@locations_bp.route('/api/areas/<area_id>/locations', methods=['GET'])
@require_auth
def list_locations(user, area_id):
    """Get all locations for an area as a lightweight list (no geometry for bandwidth reduction)"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Return lightweight list without geometry - map uses vector tiles now
        cursor.execute("""
            SELECT
                id, external_id,
                latitude, longitude,
                properties, quadkey,
                created_at, updated_at
            FROM locations
            WHERE area_id = %s
            ORDER BY created_at DESC
        """, (area_id,))

        locations = []
        for row in cursor.fetchall():
            # Handle both dict and JSON string from database
            if row[4]:
                properties = row[4] if isinstance(row[4], dict) else json.loads(row[4])
            else:
                properties = {}

            location = {
                'id': str(row[0]),
                'external_id': row[1],
                'latitude': float(row[2]) if row[2] else None,
                'longitude': float(row[3]) if row[3] else None,
                'properties': properties,
                'quadkey': row[5],
                'created_at': row[6].isoformat() if row[6] else None,
                'updated_at': row[7].isoformat() if row[7] else None,
            }
            locations.append(location)

        cursor.close()

        return jsonify({'locations': locations}), 200

    except Exception as e:
        import traceback
        print(f"Error listing locations: {e}")
        print(traceback.format_exc())
        return jsonify({'error': 'Failed to list locations', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@locations_bp.route('/api/areas/<area_id>/locations/<location_id>', methods=['PUT'])
@require_auth
def update_location(user, area_id, location_id):
    """Update a location (excluding geometry)"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify location belongs to area
        cursor.execute("""
            SELECT id FROM locations
            WHERE id = %s AND area_id = %s
        """, (location_id, area_id))

        if not cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'Location not found'}), 404

        # Update location - excluding geometry, latitude, longitude
        cursor.execute("""
            UPDATE locations
            SET
                external_id = COALESCE(%s, external_id),
                updated_at = NOW()
            WHERE id = %s AND area_id = %s
        """, (
            data.get('external_id'),
            location_id,
            area_id
        ))

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error updating location: {e}")
        return jsonify({'error': 'Failed to update location', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)


@locations_bp.route('/api/areas/<area_id>/locations/<location_id>', methods=['DELETE'])
@require_auth
def delete_location(user, area_id, location_id):
    """Delete a location"""
    conn = None
    try:
        # Check if user has access to this area
        if not check_area_access(user['id'], area_id):
            return jsonify({'error': 'Access denied'}), 403

        conn = get_db_connection()
        cursor = conn.cursor()

        # Verify location belongs to area
        cursor.execute("""
            SELECT id FROM locations
            WHERE id = %s AND area_id = %s
        """, (location_id, area_id))

        if not cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'Location not found'}), 404

        # Delete location
        cursor.execute("""
            DELETE FROM locations
            WHERE id = %s AND area_id = %s
        """, (location_id, area_id))

        conn.commit()
        cursor.close()

        return jsonify({'success': True}), 200

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error deleting location: {e}")
        return jsonify({'error': 'Failed to delete location', 'details': str(e)}), 500
    finally:
        if conn:
            return_db_connection(conn)
