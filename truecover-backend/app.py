from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

# Import routes
from routes.user import user_bp
from routes.functions import functions_bp
from routes.organizations import organizations_bp
from routes.projects import projects_bp
from routes.areas import areas_bp
from routes.locations import locations_bp
from routes.rounds import rounds_bp
from routes.indicators import indicators_bp
from routes.visits import visits_bp
# from routes.visit_indicators import visit_indicators_bp  # No longer used
from routes.coverage import coverage_bp

# Import database utilities
from db.migrations import run_migrations

# Create Flask app
app = Flask(__name__)

# Configure CORS - allow requests from React app
CORS(app, origins=[
    'http://localhost:3000',  # React dev server
    'http://localhost:3001',  # Alternative port
    'http://localhost:3050',  # Current React app port
], supports_credentials=True)

# Register blueprints
app.register_blueprint(user_bp)
app.register_blueprint(functions_bp)
app.register_blueprint(organizations_bp)
app.register_blueprint(projects_bp)
app.register_blueprint(areas_bp)
app.register_blueprint(locations_bp)
app.register_blueprint(rounds_bp)
app.register_blueprint(indicators_bp)
app.register_blueprint(visits_bp)
# app.register_blueprint(visit_indicators_bp)  # No longer used
app.register_blueprint(coverage_bp)

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'truecover-backend',
        'version': '1.0.0'
    }), 200

# Root endpoint
@app.route('/', methods=['GET'])
def root():
    return jsonify({
        'message': 'TrueCover Backend API',
        'version': '1.0.0',
        'endpoints': {
            'user': {
                'GET /api/user/me': 'Get current user',
                'PUT /api/user/me': 'Update current user'
            },
            'organizations': {
                'POST /api/organizations': 'Create organization',
                'GET /api/organizations': 'List user organizations',
                'GET /api/organizations/<id>': 'Get organization details',
                'GET /api/organizations/<id>/members': 'List organization members',
                'POST /api/organizations/<id>/members': 'Add member by email',
                'DELETE /api/organizations/<id>/members/<user_id>': 'Remove member'
            },
            'projects': {
                'POST /api/organizations/<org_id>/projects': 'Create project',
                'GET /api/organizations/<org_id>/projects': 'List organization projects',
                'GET /api/projects/<id>': 'Get project details',
                'PUT /api/projects/<id>': 'Update project',
                'DELETE /api/projects/<id>': 'Delete project'
            },
            'areas': {
                'POST /api/projects/<project_id>/areas': 'Create area',
                'GET /api/projects/<project_id>/areas': 'List project areas',
                'GET /api/areas/<id>': 'Get area details',
                'PUT /api/areas/<id>': 'Update area',
                'DELETE /api/areas/<id>': 'Delete area',
                'POST /api/areas/<id>/features': 'Add features (bulk import GeoJSON)',
                'GET /api/areas/<id>/features': 'Get features (supports ?bbox=minLng,minLat,maxLng,maxLat)',
                'GET /api/areas/<id>/geojson': 'Export as GeoJSON FeatureCollection',
                'DELETE /api/areas/<id>/features/<feature_id>': 'Delete feature'
            },
            'functions': {
                'POST /api/sampling': 'Adaptive sampling (requires auth)',
                'POST /api/prediction': 'Prevalence prediction (requires auth)',
                'POST /api/covariate': 'Covariate extraction (requires auth)'
            }
        }
    }), 200

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Run migrations on startup
    print("Running database migrations...")
    try:
        run_migrations()
    except Exception as e:
        print(f"Warning: Could not run migrations: {e}")
        print("Make sure PostgreSQL is running (docker-compose up)")

    # Start Flask app
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_ENV') == 'development'

    print(f"\n🚀 Starting TrueCover Backend API on port {port}")
    print(f"📝 Environment: {os.getenv('FLASK_ENV', 'production')}")
    print(f"🔐 Clerk authentication enabled")
    print(f"\nAPI Documentation: http://localhost:{port}/\n")

    app.run(host='0.0.0.0', port=port, debug=debug)
