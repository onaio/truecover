# TrueCover Sample Application

A web-based interface for TrueCover's geospatial analysis tools, including adaptive sampling and coverage prediction for disease surveillance.

## Quick Start (Docker - Recommended)

The easiest way to run the application is using Docker Compose:

```bash
docker-compose up -d
```

Then open **http://localhost:3030** in your browser.

## Features

- **Adaptive Sampling**: Optimize survey sampling with intelligent adaptive algorithms
- **Coverage Prediction**: Predict disease prevalence/coverage patterns using statistical models
- **Interactive Map**: Visualize data and results on an interactive map
- **File Upload**: Support for GeoJSON and CSV files
- **Results Export**: Download results as GeoJSON

## Running with Docker

### Using Docker Compose (Recommended)

Start all services with a single command:

```bash
docker-compose up -d
```

This will start:
- TrueCover UI (port 3030)
- Adaptive Sampling service (port 8083)
- Prevalence Predictor service (port 8081)
- Covariate Extractor service (port 8082)

### Accessing the Application

Once running, access at: **http://localhost:3030**

All services:
- **TrueCover UI**: http://localhost:3030
- **Adaptive Sampling**: http://localhost:8083
- **Prevalence Predictor**: http://localhost:8081
- **Covariate Extractor**: http://localhost:8082

### Docker Management Commands

```bash
# View logs
docker-compose logs -f truecover-ui

# Stop all services
docker-compose down

# Restart services
docker-compose restart

# Rebuild after code changes
docker-compose build --no-cache truecover-ui
docker-compose up -d
```

## How to Use

### Adaptive Sampling

1. Click "Adaptive Sampling" from the home page
2. Upload a GeoJSON or CSV file with uncertainty data
3. Select the uncertainty field name (e.g., `exceedance_uncertainty`)
4. Set the batch size (number of points to select)
5. Click "Run Adaptive Sampling"
6. View results on the map and download as GeoJSON

### Coverage Prediction

1. Click "Coverage Prediction" from the home page
2. Upload a survey file (GeoJSON with `n_trials` and `n_positive` fields)
3. Click "Generate Coverage Prediction"
4. View predicted prevalence on the map
5. Download results as GeoJSON

## File Formats

### Input Files

**GeoJSON Format:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [90.4125, 23.8103]
      },
      "properties": {
        "n_trials": 100,
        "n_positive": 15
      }
    }
  ]
}
```

**Survey File Format (with wrapper):**
```json
{
  "point_data": {
    "type": "FeatureCollection",
    "features": [...]
  }
}
```

**CSV Format:**
Must include latitude/longitude columns (lat, lon, latitude, longitude, etc.)

## Architecture

```
┌─────────────────────┐
│   TrueCover UI      │  (Port 3030)
│   (React + Nginx)   │
└──────────┬──────────┘
           │
           ├─ /api ────────────────> Adaptive Sampling (Port 8083)
           │
           └─ /api/prediction ────> Prevalence Predictor (Port 8081)
                                    └──> Covariate Extractor (Port 8082)
```

The Docker setup uses Nginx to proxy API requests to the backend services, eliminating CORS issues.

## Troubleshooting

### Container won't start
```bash
docker-compose logs truecover-ui
```

### Can't connect to backend services
Ensure all containers are running:
```bash
docker-compose ps
```

### Port already in use
Change the port in `docker-compose.yml`:
```yaml
ports:
  - "8080:80"  # Change 3030 to 8080
```

## Development Workflow

### Local Development (Recommended for Active Development)

For faster development with hot reloading, run locally without Docker:

1. **Ensure backend services are running** on Docker:
   ```bash
   docker run -d --name adaptive-sampling -p 8083:8080 disarm/fn-adaptive-sampling:0.3.1
   docker run -d --name prevalence-predictor -p 8081:8080 -e exec_timeout=910 disarm/fn-prevalence-predictor:1.3.0
   docker run -d --name covariate-extractor -p 8082:8080 disarm/fn-covariate-extractor:0.2.5
   ```

2. **Start local development server**:
   ```bash
   npm run dev
   ```

3. **Access at http://localhost:3050** with hot reload enabled

The app uses `setupProxy.js` to automatically proxy API requests to the backend services running on Docker (ports 8081 and 8083).

### Docker Deployment

When ready to deploy or test the production build:

**Build and deploy to Docker:**
```bash
npm run docker:deploy
```

This command builds the Docker image and starts the container on port 3030.

**Individual Docker commands:**
```bash
# Build Docker image
npm run docker:build

# Run container
npm run docker:run

# Stop and remove container
npm run docker:stop

# Or use docker-compose
docker-compose up -d
```

### Available NPM Scripts

- `npm run dev` - Start local development server on port 3050 (with hot reload)
- `npm start` - Same as `npm run dev`
- `npm run build` - Build production assets
- `npm run docker:build` - Build Docker image
- `npm run docker:run` - Run Docker container on port 3030
- `npm run docker:stop` - Stop and remove Docker container
- `npm run docker:deploy` - Build and deploy to Docker (runs build, stop, run)
- `npm test` - Run tests

### Development Setup Notes

- **Proxy Configuration**: API proxying is handled by `src/setupProxy.js` using `http-proxy-middleware`
  - `/api/prediction` → `http://localhost:8081` (prevalence predictor)
  - `/api` → `http://localhost:8083` (adaptive sampling)
- **Port**: Local dev runs on port 3050 (configured in `.env`)
- **Docker**: Production build runs on port 3030

### Recommended Workflow

- **During active development**: Use `npm run dev` for hot reload
- **For testing production build**: Use `npm run docker:deploy`
- **For deployment**: Use Docker Compose or `npm run docker:deploy`

## Additional Documentation

- [DOCKER.md](./DOCKER.md) - Detailed Docker setup and configuration
- [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started)

## Technology Stack

- **Frontend**: React 19, TypeScript
- **Maps**: Mapbox GL, react-map-gl
- **HTTP Client**: Axios
- **File Parsing**: PapaParse (CSV)
- **Production Server**: Nginx (in Docker)
- **Backend**: OpenFaaS serverless functions (Python, R)
