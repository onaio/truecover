# TrueCover

Geospatial disease surveillance platform with adaptive sampling capabilities.

## Quick Start

### Prerequisites

- Docker Desktop (for PostgreSQL database)
- Python 3.12+
- Node.js 16+
- Git

### 1. Start the Database

```bash
cd truecover-backend
docker-compose up -d
```

This starts PostgreSQL on port 5432.

### 2. Start the Backend API

```bash
cd truecover-backend

# Create virtual environment (first time only)
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies (first time only)
pip install -r requirements.txt

# Start the Flask server
python app.py
```

The backend API will be available at **http://localhost:5001**

### 3. Start the Frontend

```bash
cd truecover-app

# Install dependencies (first time only)
npm install

# Start the development server
npm run dev
```

The frontend will be available at **http://localhost:3050**

## Project Structure

```
truecover/
├── truecover-app/          # React frontend (Vite + TypeScript)
├── truecover-backend/      # Flask API backend
│   ├── app.py             # Main Flask application
│   ├── routes/            # API route handlers
│   ├── db/                # Database migrations and connections
│   ├── auth/              # Clerk authentication middleware
│   └── docker-compose.yml # PostgreSQL database
└── README.md
```

## Tech Stack

### Frontend
- **React** with TypeScript
- **Vite** for fast development
- **TailwindCSS** for styling
- **React Query** for data fetching
- **Mapbox GL** for maps
- **Clerk** for authentication

### Backend
- **Flask** REST API
- **PostgreSQL** with PostGIS extension
- **psycopg2** for database connections
- **Clerk** for authentication
- Python 3.12+

## Environment Variables

### Backend (.env)

Create a `.env` file in `truecover-backend/`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/truecover
CLERK_SECRET_KEY=your_clerk_secret_key
FLASK_ENV=development
```

### Frontend (.env)

Create a `.env` file in `truecover-app/`:

```env
VITE_API_URL=http://localhost:5001
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
VITE_MAPBOX_TOKEN=your_mapbox_token
```

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/:id` - Get project details

### Areas
- `GET /api/projects/:id/areas` - List areas in project
- `POST /api/areas` - Create new area
- `GET /api/areas/:id/locations` - Get locations in area

### Rounds
- `GET /api/areas/:id/rounds` - List rounds for area
- `POST /api/rounds` - Create new round

### Visits
- `POST /api/visits` - Create single visit
- `POST /api/visits/bulk` - Upload multiple visits with location matching

### Visit Indicators
- `POST /api/visit-indicators` - Create visit indicator
- `POST /api/visit-indicators/bulk` - Create multiple indicators

## Database Schema

Key tables:
- **users** - User accounts (Clerk)
- **organizations** - Organizations/teams
- **projects** - Disease surveillance projects
- **areas** - Geographic survey areas
- **locations** - Point locations with PostGIS geometry
- **rounds** - Data collection rounds
- **visits** - Field visit records
- **indicators** - Project indicators (e.g., malaria prevalence)
- **visit_indicators** - Indicator measurements per visit

## Features

- **Project Management** - Create and manage surveillance projects
- **Area Definition** - Define geographic survey areas
- **Location Upload** - Import location data (CSV/GeoJSON)
- **Adaptive Sampling** - Run adaptive sampling algorithms
- **Visit Data Collection** - Upload field visit data with field mapping
- **Indicator Tracking** - Track multiple indicators per visit
- **Data Export** - Export locations and visit data

## Development

### Running Migrations

Database migrations run automatically on startup. To manually run:

```bash
cd truecover-backend
python -m db.migrations
```

### Stopping Services

```bash
# Stop backend (Ctrl+C in terminal)

# Stop database
cd truecover-backend
docker-compose down

# Stop frontend (Ctrl+C in terminal)
```

## Troubleshooting

### Database connection errors
- Ensure Docker is running
- Check PostgreSQL is up: `docker ps | grep postgres`
- Verify DATABASE_URL in backend/.env

### Backend not starting
- Check Python version: `python --version` (should be 3.12+)
- Ensure virtual environment is activated
- Check for port conflicts: `lsof -i :5001`

### Frontend build errors
- Clear node_modules: `rm -rf node_modules && npm install`
- Check Node version: `node --version` (should be 16+)
- Ensure VITE_API_URL points to backend

### Authentication errors
- Verify Clerk keys are set in .env files
- Ensure keys match (publishable key in frontend, secret key in backend)
- Check Clerk dashboard for API status

## License

Proprietary
