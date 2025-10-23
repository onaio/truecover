# ABOUTME: Script to drop all tables and reset database to empty state
# ABOUTME: Use with caution - this will delete all data

from db.connection import get_db_connection, return_db_connection

def reset_database():
    """Drop all tables from the database"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        print("⚠️  WARNING: Dropping all tables from database...")

        # Drop all tables in reverse order of dependencies
        # CASCADE will handle any remaining foreign key constraints
        tables_to_drop = [
            'coverage',
            'rounds',
            'indicators',
            'locations',
            'areas',
            'projects',
            'organization_members',
            'organizations',
            'users',
            'visit_indicators',  # Drop if it still exists
            'visits'  # Drop if it still exists
        ]

        for table in tables_to_drop:
            cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
            print(f"  ✓ Dropped table: {table}")

        conn.commit()
        print("\n✅ All tables dropped successfully")
        print("💡 Run migrations.py to recreate the schema\n")

        cursor.close()
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"❌ Error resetting database: {e}")
        raise
    finally:
        if conn:
            return_db_connection(conn)

if __name__ == "__main__":
    response = input("⚠️  This will DELETE ALL DATA from the database. Type 'yes' to continue: ")
    if response.lower() == 'yes':
        reset_database()
    else:
        print("❌ Database reset cancelled")
