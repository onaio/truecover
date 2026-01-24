# ABOUTME: Populates admin_boundary_stats and admin_boundary_pixels tables
# ABOUTME: Uses pcode matching instead of spatial intersection for speed

import sys
import os
import psycopg2
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from dotenv import load_dotenv

load_dotenv()

progress_lock = threading.Lock()
processed_count = 0
total_count = 0


def get_direct_connection():
    """Get a direct database connection (not from pool)."""
    return psycopg2.connect(os.getenv('DATABASE_URL'))


def process_boundary(boundary_id: str, name: str, level: int, pcode: str) -> int:
    """Process a single boundary using pcode matching - returns pixel count."""
    global processed_count

    conn = get_direct_connection()
    cursor = conn.cursor()

    # Map level to pcode column
    pcode_column = f"adm{level}_pcode"

    try:
        # Insert pixel mappings using pcode match (no spatial intersection needed!)
        cursor.execute(f"""
            INSERT INTO admin_boundary_pixels (admin_boundary_id, quadkey)
            SELECT %s, quadkey
            FROM pixels
            WHERE {pcode_column} = %s
            ON CONFLICT DO NOTHING
        """, (boundary_id, pcode))

        pixels_inserted = cursor.rowcount

        # Calculate and insert stats
        cursor.execute("""
            INSERT INTO admin_boundary_stats (admin_boundary_id, pixel_count, population)
            SELECT
                %s,
                COUNT(*),
                COALESCE(SUM(p.population), 0)
            FROM admin_boundary_pixels abp
            JOIN pixels p ON abp.quadkey = p.quadkey
            WHERE abp.admin_boundary_id = %s
            ON CONFLICT (admin_boundary_id) DO UPDATE SET
                pixel_count = EXCLUDED.pixel_count,
                population = EXCLUDED.population,
                computed_at = NOW()
        """, (boundary_id, boundary_id))

        conn.commit()

        with progress_lock:
            processed_count += 1
            if processed_count % 100 == 0 or processed_count == total_count:
                print(f"  Progress: {processed_count}/{total_count}", flush=True)

        return pixels_inserted

    except Exception as e:
        conn.rollback()
        print(f"  Error processing {name}: {e}", flush=True)
        return 0
    finally:
        cursor.close()
        conn.close()


def get_pcode_for_level(cursor, boundary_id: str, level: int) -> str:
    """Get the appropriate pcode for a boundary at a given level."""
    pcode_column = f"adm{level}_pcode"
    cursor.execute(f"SELECT {pcode_column} FROM admin_boundaries WHERE id = %s", (boundary_id,))
    result = cursor.fetchone()
    return result[0] if result else None


def populate_level(level: int, workers: int = 8):
    """Populate pixel mappings and stats for a single admin level in parallel."""
    global processed_count, total_count

    conn = get_direct_connection()
    cursor = conn.cursor()

    # Get boundaries at this level that haven't been processed yet
    pcode_column = f"adm{level}_pcode"
    cursor.execute(f"""
        SELECT ab.id, ab.name, ab.{pcode_column}
        FROM admin_boundaries ab
        LEFT JOIN admin_boundary_stats abs ON ab.id = abs.admin_boundary_id
        WHERE ab.level = %s AND abs.admin_boundary_id IS NULL
    """, (level,))
    boundaries = cursor.fetchall()

    cursor.close()
    conn.close()

    if not boundaries:
        print(f"Level {level}: All boundaries already processed")
        return

    processed_count = 0
    total_count = len(boundaries)
    print(f"Level {level}: {total_count} boundaries remaining, using {workers} workers", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(process_boundary, str(row[0]), row[1], level, row[2]): row[1]
            for row in boundaries
        }

        for future in as_completed(futures):
            name = futures[future]
            try:
                future.result()
            except Exception as e:
                print(f"  Failed {name}: {e}", flush=True)


def main():
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 8

    # Process from smallest (level 4 unions) to largest (level 1 divisions)
    for level in [4, 3, 2, 1]:
        print(f"\n=== Processing level {level} ===", flush=True)
        populate_level(level, workers=workers)
        print(f"Level {level} done.", flush=True)

    print("\nAll done!", flush=True)


if __name__ == "__main__":
    main()
