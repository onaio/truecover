# TrueCover Application Analysis

## Executive Summary

TrueCover is a geospatial disease surveillance and coverage prediction application built using a microservices architecture. The application consists of three OpenFaaS serverless functions (two in R, one in Python) and a Vue.js web interface. **Important Finding: The functions are NOT fully self-contained** - they make external API calls to each other and require Docker containerization for proper execution.

## Architecture Overview

### Technology Stack
- **Backend Functions**: OpenFaaS serverless functions
  - Python (fn-prevalence-predictor)
  - R with geospatial packages (fn-covariate-extractor, fn-adaptive-sampling)
- **Frontend**: Vue.js with TypeScript
- **Deployment**: Docker containers via OpenFaaS
- **Map Visualization**: Mapbox GL
- **API Gateway**: Node.js streaming server (staging/production)

### Component Relationships
```
User Interface (Vue.js)
    ↓
Node Streaming Server API
    ↓
OpenFaaS Gateway (faas.srv.disarm.io)
    ↓
Individual Functions:
    - fn-prevalence-predictor → calls → fn-covariate-extractor
    - fn-adaptive-sampling (standalone)
    - fn-covariate-extractor (standalone)
```

## Function Dependency Analysis

### Key Finding: Functions Are NOT Self-Contained

The functions have the following external dependencies:

1. **fn-prevalence-predictor** (Python):
   - Makes HTTP POST requests to `fn-covariate-extractor` at `http://faas.srv.disarm.io/function/fn-covariate-extractor`
   - Requires the `disarm_gears` Python package from GitHub
   - Cannot run standalone without network access to the covariate extractor service

2. **fn-covariate-extractor** (R):
   - Downloads external data from multiple sources:
     - WorldClim bioclimatic data
     - DIVA-GIS water body data
     - gRoads global roads dataset from Google Cloud Storage
   - Requires internet connectivity to function properly

3. **fn-adaptive-sampling** (R):
   - Most self-contained of the three
   - Still requires R geospatial packages
   - No external API calls

### Docker Containerization Requirements

All functions are designed to run as Docker containers with specific configurations:
- Custom language templates: `python-geospatial`, `r-geospatial`
- Execution timeouts: 60-910 seconds
- Memory and CPU resource allocations
- Environment variable configurations

**To run locally, you MUST use Docker** with the appropriate OpenFaaS templates.

## Detailed Function Analysis

### 1. fn-prevalence-predictor (Python)

**Purpose**: Predicts disease prevalence/coverage at all geographic points based on existing survey data using Generalized Additive Models (GAM).

**Input Parameters**:
```json
{
  "point_data": {
    "type": "FeatureCollection",
    "features": [
      {
        "properties": {
          "n_trials": integer,     // Number tested (null for prediction points)
          "n_positive": integer,    // Number positive (null for prediction points)
          "id": string              // Optional unique identifier
        },
        "geometry": {
          "type": "Point",
          "coordinates": [lng, lat]
        }
      }
    ]
  },
  "exceedance_threshold": float,   // Optional (0-1): probability threshold
  "layer_names": ["bioclim1", ...] // Optional: covariate layers to include
}
```

**Processing Logic**:
1. Converts GeoJSON to GeoPandas DataFrame
2. If `layer_names` provided:
   - Calls fn-covariate-extractor API to fetch environmental covariates
   - Merges covariate data with input points
3. Builds GAM formula:
   - Base: `cbind(n_positive, n_trials - n_positive) ~ te(lng, lat, bs='gp')`
   - Adds covariates if specified
4. Fits binomial GAM using `disarm_gears.r_plugins.mgcv_fit()`
5. Generates predictions and posterior samples
6. Calculates credible intervals and exceedance probabilities

**Output Fields**:
- `prevalence_prediction`: Probability of occurrence (0-1)
- `prevalence_bci_width`: Uncertainty (97.5% - 2.5% quantile difference)
- `exceedance_probability`: P(prevalence > threshold) if threshold provided
- `exceedance_uncertainty`: Uncertainty in exceedance (0.5 - |P - 0.5|)

**External Dependencies**:
- fn-covariate-extractor API endpoint
- disarm_gears Python package
- R mgcv package (via rpy2 bridge)

### 2. fn-covariate-extractor (R)

**Purpose**: Extracts environmental covariate values at specified geographic points from various global datasets.

**Input Parameters**:
```json
{
  "points": GeoJSON FeatureCollection,
  "layer_names": ["bioclim1", "elev_m", ...],
  "resolution": integer  // Optional: resample resolution in km² (default: 1)
}
```

**Available Layers**:
- `bioclim1` to `bioclim19`: WorldClim bioclimatic variables
- `elev_m`: Elevation in meters (CGIAR-SRTM)
- `dist_to_water_m`: Distance to nearest water body (Digital Chart of the World)
- `dist_to_road_m`: Distance to nearest road (gRoads dataset)

**Processing Logic**:
1. Determines country from first point using `coords2country()`
2. For each requested layer:
   - **bioclim**: Downloads from WorldClim, resamples to resolution
   - **elev_m**: Downloads country-specific elevation data
   - **dist_to_water_m**: Downloads country water bodies, calculates nearest neighbor distances
   - **dist_to_road_m**: Downloads global roads dataset, crops to bbox, calculates distances
3. Extracts values at point locations using raster operations
4. Returns input GeoJSON with added covariate properties

**External Data Sources**:
- `raster::getData('worldclim')` - WorldClim server
- `raster::getData('alt', country)` - DIVA-GIS elevation
- `http://biogeo.ucdavis.edu/data/diva/wat/` - Water bodies
- `https://storage.googleapis.com/ds-faas/` - Pre-processed roads data

**Constraints**:
- All points must be within a single country
- Maximum number of features limited by memory

### 3. fn-adaptive-sampling (R)

**Purpose**: Recommends optimal locations for next survey samples to minimize prediction uncertainty.

**Input Parameters**:
```json
{
  "point_data": GeoJSON FeatureCollection,
  "uncertainty_fieldname": "exceedance_uncertainty",  // Field containing uncertainty values
  "batch_size": 10  // Number of locations to select
}
```

**Algorithm (Spatially-Weighted Uncertainty Sampling)**:
1. Converts zero uncertainties to 0.0001 (allows random selection)
2. Calculates selection probability proportional to uncertainty
3. Selects first point randomly weighted by uncertainty
4. For remaining points (batch_size - 1):
   - Calculates minimum distance from candidates to already-selected points
   - Weights uncertainty by spatial distance (penalizes clustering)
   - Selects next point based on distance-penalized uncertainty
5. Returns input with `adaptively_selected` field (0/1)

**Key Algorithm Features**:
- Balances high uncertainty with spatial coverage
- Prevents clustering of sample points
- Uses RANN package for efficient nearest neighbor calculations

**Output**:
Original GeoJSON with additional property:
- `adaptively_selected`: 1 for selected points, 0 for others

## UI Component Analysis

### Frontend Architecture
- **Framework**: Vue.js 2.x with TypeScript
- **State Management**: Vuex store
- **UI Library**: Quasar Framework
- **Map**: Mapbox GL with vue-mapbox wrapper
- **Build**: Vue CLI with webpack

### API Integration Pattern
1. User loads data (GeoJSON file or sample data)
2. Selects algorithm (prevalence-predictor or adaptive-sampling)
3. Configures parameters through UI forms
4. Frontend sends POST request to Node streaming server:
   ```typescript
   const headers = {
     'api_key': config.api.key,
     'function_name': function_name
   };
   fetch(config.api.url, {
     method: 'POST',
     body: JSON.stringify(run_request.params)
   });
   ```
5. Streaming server proxies to OpenFaaS gateway
6. Results displayed on map and table

### Visualization Components
- **Map Layers**: Points, grid cells, choropleth polygons
- **Color Scales**: YlOrRd palette with 7 bins
- **Interactive Features**: Layer toggling, zoom controls, feature inspection
- **Data Export**: Download results as GeoJSON

## Key Findings and Recommendations

### 1. Function Dependencies
**Finding**: Functions are tightly coupled through API calls and external data dependencies.

**Implications**:
- Cannot run functions locally without Docker and network access
- fn-prevalence-predictor requires fn-covariate-extractor to be deployed
- All functions require internet access for data downloads

**Recommendation**: 
- For local development, use Docker Compose to orchestrate all services
- Consider caching external data to reduce latency and dependency

### 2. Deployment Architecture
**Finding**: Functions are deployed as OpenFaaS containers on a remote server.

**Implications**:
- Scaling handled by OpenFaaS autoscaling
- Cold starts possible (scale-to-zero enabled)
- Network latency impacts user experience

**Recommendation**:
- Keep functions warm for production use
- Implement client-side caching for repeated requests

### 3. Data Limitations
**Finding**: Functions restricted to single-country analysis.

**Implications**:
- Cross-border analysis not supported
- Country detection based on first point only
- Covariate data availability varies by country

**Recommendation**:
- Validate all points are in same country before processing
- Implement multi-country support if needed

### 4. Error Handling
**Finding**: Limited error handling for external service failures.

**Implications**:
- Function failures cascade through the pipeline
- Users receive generic error messages
- Debugging requires access to function logs

**Recommendation**:
- Implement retry logic for external API calls
- Add detailed error messages for common failures
- Consider fallback mechanisms for data source unavailability

## Running the Application

### Production Use
The application is deployed and accessible via the web UI. Functions are called through the API gateway automatically.

### Local Development

**Option 1: UI Only (Recommended for frontend development)**
```bash
cd truecover_ui_v1.53.0
npm install
npm run serve  # Development server with hot reload
```

**Option 2: Full Stack with Docker (Required for function development)**
```bash
# Install OpenFaaS CLI
curl -sL https://cli.openfaas.com | sh

# Pull templates
faas template pull https://github.com/disarm-platform/faas-templates.git

# Build functions
faas build -f fn-prevalence-predictor-1.3.0/stack.yml
faas build -f fn-covariate-extractor-0.2.5/stack.yml
faas build -f fn-adaptive-sampling-0.3.1/stack.yml

# Run with Docker
docker run -p 8080:8080 -e exec_timeout=910 disarm/fn-prevalence-predictor:1.3.0
```

**Note**: Functions will not work properly without access to the external OpenFaaS gateway for inter-function communication.

## Conclusion

TrueCover is a sophisticated geospatial analysis platform that leverages serverless architecture for scalable disease surveillance and coverage prediction. While the modular design provides flexibility, the tight coupling between services and external dependencies means that **functions cannot run independently without their full Docker environment and network access to other services**. For production use, the complete OpenFaaS infrastructure is required, making local development challenging without proper Docker orchestration.