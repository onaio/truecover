# TrueCover

A geospatial disease surveillance platform for planning, monitoring, and predicting coverage in health campaigns. TrueCover helps health organizations optimize field operations by combining location intelligence, adaptive sampling, and machine learning-based coverage prediction.

## Prerequisites

- **Python 3.12+**
- **Node.js 18+**
- **Docker** and **Docker Compose**
- **UV** (Python package manager) - `pip install uv`

## Quick Start

### 1. Start Docker Services

From the `truecover-backend` directory, start PostgreSQL, Martin tile server, and Temporal:

```bash
cd truecover-backend
docker-compose up -d
```

This starts:
| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Database with PostGIS |
| Martin | 3052 | Vector tile server |
| Temporal | 7233 | Workflow orchestration |
| Temporal UI | 8080 | Temporal dashboard |

### 2. Start the Backend API

```bash
cd truecover-backend
uv sync                    # Install dependencies
uv run python app.py       # Start on port 5001
```

### 3. Start the Temporal Worker

In a separate terminal:

```bash
cd truecover-backend
uv run python temporal_worker.py
```

### 4. Start the Frontend

```bash
cd truecover-app
npm install                # Install dependencies
npm run dev                # Start on port 3050
```

### 5. Open the App

Navigate to **http://localhost:3050**

## Port Reference

| Service | Port |
|---------|------|
| Frontend (Vite) | 3050 |
| Backend API | 5001 |
| Martin Tiles | 3052 |
| PostgreSQL | 5432 |
| Temporal gRPC | 7233 |
| Temporal UI | 8080 |
| Adaptive Sampling | 8083 |
| Prevalence Predictor | 8084 |

## Environment Variables

### Frontend (`truecover-app/.env`)

```
VITE_MAPBOX_TOKEN=your_mapbox_token
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_key
VITE_API_URL=http://localhost:5001
VITE_MARTIN_URL=http://localhost:3052
```

### Backend (`truecover-backend/.env`)

```
DATABASE_URL=postgresql://truecover:truecover@localhost:5432/truecover
CLERK_SECRET_KEY=your_clerk_secret
```

## Stopping Services

```bash
# Stop Docker services
cd truecover-backend
docker-compose down

# Or stop everything including volumes
docker-compose down -v
```
