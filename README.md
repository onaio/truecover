# TrueCover - Geospatial Disease Surveillance Platform

A microservices-based geospatial analysis platform for disease surveillance and coverage prediction, consisting of Docker-containerized OpenFaaS functions and web interfaces.

## Architecture Overview

TrueCover consists of:
- **3 OpenFaaS Functions** (Docker containers)
  - `fn-prevalence-predictor` - Predicts disease prevalence using GAM models
  - `fn-covariate-extractor` - Extracts environmental covariates from global datasets  
  - `fn-adaptive-sampling` - Recommends optimal survey locations
- **2 Web Interfaces**
  - `truecover-sample` - Modern React app (simplified interface)
  - `truecover_ui_v1.53.0` - Original Vue.js interface

## Quick Start

### Prerequisites
- Docker Desktop installed and running
- Node.js 16+ and npm (for web interfaces)
- Git

### 1. Start the Docker Functions

All Docker images are pre-built. Simply run:

```bash
# Start all three functions
docker run -d -p 8081:8080 -e exec_timeout=910 disarm/fn-prevalence-predictor:1.3.0
docker run -d -p 8082:8080 -e exec_timeout=600 disarm/fn-covariate-extractor:0.2.5
docker run -d -p 8083:8080 -e exec_timeout=60 disarm/fn-adaptive-sampling:0.3.1
```

The functions will be available at:
- **Prevalence Predictor**: http://localhost:8081
- **Covariate Extractor**: http://localhost:8082
- **Adaptive Sampling**: http://localhost:8083

### 2. Start the Web Interface

#### Option A: TrueCover Sample App (Recommended - Simpler, Modern React)

```bash
cd truecover-sample
npm install

# Start the proxy server (required for API communication)
node proxy-server.js &

# Start the React app
npm start
```

Opens at http://localhost:3000

**Architecture:**
- React app (port 3000) → Proxy server (port 3001) → Docker functions (port 8081)
- The proxy server handles CORS and response parsing from the Docker functions

**Note:** Both the proxy server and React app must be running for the app to work

#### Option B: Original TrueCover UI (Full-featured Vue.js)

```bash
cd truecover_ui_v1.53.0
npm install
npm run serve
```

Opens at http://localhost:8080 (development mode)

## Function Details

### fn-prevalence-predictor (Port 8081)
- **Purpose**: Predicts disease prevalence at geographic points using Generalized Additive Models
- **Language**: Python with R integration
- **Depends on**: fn-covariate-extractor (makes API calls to it)
- **Input**: GeoJSON with survey data points
- **Output**: Predictions with uncertainty bounds

### fn-covariate-extractor (Port 8082)
- **Purpose**: Extracts environmental data at specified locations
- **Language**: R with geospatial packages
- **Available layers**: 
  - WorldClim bioclimatic variables (bioclim1-19)
  - Elevation (elev_m)
  - Distance to water (dist_to_water_m)
  - Distance to roads (dist_to_road_m)
- **Input**: GeoJSON points + layer names
- **Output**: GeoJSON with added covariate properties

### fn-adaptive-sampling (Port 8083)
- **Purpose**: Recommends optimal survey locations to minimize uncertainty
- **Language**: R
- **Algorithm**: Spatially-weighted uncertainty sampling
- **Input**: GeoJSON with uncertainty values
- **Output**: Selected points marked with `adaptively_selected: 1`

## Docker Management

### Check Running Containers
```bash
docker ps | grep disarm
```

### Stop All Functions
```bash
# Get container IDs
docker ps | grep disarm | awk '{print $1}'

# Stop all
docker stop $(docker ps | grep disarm | awk '{print $1}')
```

### View Logs
```bash
docker logs <container_id>
```

### Platform Warning
If you see warnings about platform mismatch on Apple Silicon (M1/M2), the containers will still run using Rosetta emulation. The warning can be safely ignored.

## API Usage Examples

### Test Function Health
```bash
# Check if functions are running
curl http://localhost:8081
curl http://localhost:8082
curl http://localhost:8083
```

### Sample API Call (Prevalence Predictor)
```bash
curl -X POST http://localhost:8081 \
  -H "Content-Type: application/json" \
  -d '{
    "point_data": {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "geometry": {"type": "Point", "coordinates": [35.0, -1.0]},
          "properties": {"n_trials": 100, "n_positive": 25}
        }
      ]
    }
  }'
```

## Development

### Building Functions from Source

If you need to rebuild the Docker images:

```bash
# Install OpenFaaS CLI
curl -sL https://cli.openfaas.com | sh

# Pull templates
faas template pull https://github.com/disarm-platform/faas-templates.git

# Build functions
faas build -f fn-prevalence-predictor-1.3.0/stack.yml
faas build -f fn-covariate-extractor-0.2.5/stack.yml
faas build -f fn-adaptive-sampling-0.3.1/stack.yml
```

### Project Structure
```
truecover/
├── fn-prevalence-predictor-1.3.0/   # Python GAM predictor function
├── fn-covariate-extractor-0.2.5/    # R covariate extraction function
├── fn-adaptive-sampling-0.3.1/      # R adaptive sampling function
├── truecover-sample/                 # Modern React interface
├── truecover_ui_v1.53.0/           # Original Vue.js interface
└── truecover.md                     # Detailed technical documentation
```

## Important Notes

1. **Function Dependencies**: The prevalence predictor requires the covariate extractor to be running if you use environmental layers
2. **Network Requirements**: Functions need internet access to download external data (WorldClim, elevation data, etc.)
3. **Single Country Limitation**: All points must be within the same country for covariate extraction
4. **Memory Requirements**: Docker Desktop should have at least 4GB RAM allocated

## Troubleshooting

### Functions not responding
1. Check Docker is running: `docker ps`
2. Check logs: `docker logs <container_id>`
3. Ensure ports aren't already in use: `lsof -i :8081`

### TrueCover Sample App network errors
1. Ensure the proxy server is running: `ps aux | grep proxy-server`
2. If not, start it: `cd truecover-sample && node proxy-server.js`
3. Check proxy server logs for errors
4. Verify Docker functions are running on ports 8081-8083

### Platform warnings on Apple Silicon
- The images are built for x86_64 but will run under emulation
- Performance may be slightly slower but functionality is unaffected

### Connection errors in web apps
- Ensure all three Docker functions are running
- Check the proxy configuration in package.json matches the function ports
- Try accessing functions directly via curl to verify they're responding

## More Information

See `truecover.md` for detailed technical documentation including:
- API specifications for each function
- Algorithm implementations
- Data sources and limitations
- Architecture diagrams