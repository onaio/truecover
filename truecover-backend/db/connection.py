import psycopg2
from psycopg2 import pool
import os
from dotenv import load_dotenv

load_dotenv()

class Database:
    _instance = None
    _connection_pool = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Database, cls).__new__(cls)
            cls._instance._initialize_pool()
        return cls._instance

    def _initialize_pool(self):
        """Initialize the connection pool"""
        try:
            self._connection_pool = psycopg2.pool.SimpleConnectionPool(
                1, 20,  # min and max connections
                os.getenv('DATABASE_URL')
            )
            print("Database connection pool created successfully")
        except Exception as e:
            print(f"Error creating connection pool: {e}")
            raise

    def get_connection(self):
        """Get a connection from the pool"""
        return self._connection_pool.getconn()

    def return_connection(self, connection):
        """Return a connection to the pool"""
        self._connection_pool.putconn(connection)

    def close_all_connections(self):
        """Close all connections in the pool"""
        if self._connection_pool:
            self._connection_pool.closeall()

# Global database instance
db = Database()

def get_db_connection():
    """Helper function to get a database connection"""
    return db.get_connection()

def return_db_connection(connection):
    """Helper function to return a database connection"""
    db.return_connection(connection)
