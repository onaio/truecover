# ABOUTME: Script to import administrative boundary geoparquet files into the database.
# ABOUTME: Reads geoparquet files and loads them into the admin_boundaries table.

import os
import sys
import geopandas as gpd
from pathlib import Path
from db.connection import get_db_connection, return_db_connection

def import_geoparquet_file(file_path, conn):
    """Import a single geoparquet file into the admin_boundaries table"""
    print(f"Processing {file_path}...")

    # Read the geoparquet file
    gdf = gpd.read_parquet(file_path)

    # Determine the admin level from the filename
    filename = Path(file_path).name
    if 'adm0' in filename.lower():
        level = 0
        name_col = 'ADM0_EN'
    elif 'adm1' in filename.lower():
        level = 1
        name_col = 'ADM1_EN'
    elif 'adm2' in filename.lower():
        level = 2
        name_col = 'ADM2_EN'
    elif 'adm3' in filename.lower():
        level = 3
        name_col = 'ADM3_EN'
    elif 'adm4' in filename.lower():
        level = 4
        name_col = 'ADM4_EN'
    else:
        print(f"Skipping {filename} - cannot determine admin level")
        return 0

    cursor = conn.cursor()
    imported_count = 0

    # Process each row
    for idx, row in gdf.iterrows():
        try:
            # Extract ISO3 code from ADM0_PCODE
            iso3 = row.get('ADM0_PCODE', '')

            # Get the name for this level
            name = row.get(name_col, '')

            # Get all pcode levels
            adm0_pcode = row.get('ADM0_PCODE')
            adm1_pcode = row.get('ADM1_PCODE')
            adm2_pcode = row.get('ADM2_PCODE')
            adm3_pcode = row.get('ADM3_PCODE')
            adm4_pcode = row.get('ADM4_PCODE')

            # Convert geometry to WKT
            geometry_wkt = row.geometry.wkt if row.geometry else None

            # Insert into database
            cursor.execute("""
                INSERT INTO admin_boundaries
                (name, iso3, level, adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode, geometry)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326))
            """, (name, iso3, level, adm0_pcode, adm1_pcode, adm2_pcode, adm3_pcode, adm4_pcode, geometry_wkt))

            imported_count += 1

        except Exception as e:
            print(f"Error importing row {idx}: {e}")
            continue

    conn.commit()
    cursor.close()
    print(f"Imported {imported_count} features from {filename}")
    return imported_count

def import_admin_boundaries(geoparquet_dir):
    """Import all geoparquet files from the specified directory"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Clear existing data
        print("Clearing existing admin boundaries...")
        cursor.execute("DELETE FROM admin_boundaries")
        conn.commit()
        cursor.close()

        # Find all geoparquet files
        geoparquet_path = Path(geoparquet_dir)
        geoparquet_files = sorted(geoparquet_path.glob('*.geoparquet'))

        # Filter to only admin boundary files (not lines or points)
        admin_files = [f for f in geoparquet_files if 'admbnda' in f.name.lower()]

        print(f"Found {len(admin_files)} admin boundary files to import")

        total_imported = 0
        for file_path in admin_files:
            count = import_geoparquet_file(str(file_path), conn)
            total_imported += count

        print(f"\nTotal imported: {total_imported} admin boundaries")

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error importing admin boundaries: {e}")
        raise
    finally:
        if conn:
            return_db_connection(conn)

if __name__ == "__main__":
    # Default to the geoparquet directory in the project root
    default_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "geoparquet")
    geoparquet_dir = sys.argv[1] if len(sys.argv) > 1 else default_dir

    print(f"Importing admin boundaries from: {geoparquet_dir}")
    import_admin_boundaries(geoparquet_dir)
