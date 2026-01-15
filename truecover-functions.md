# TrueCover Function Algorithms

This document provides detailed technical documentation for the three core analytical functions used in TrueCover.

---

## Table of Contents

1. [Prevalence Predictor (fn-prevalence-predictor)](#1-prevalence-predictor)
2. [Covariate Extractor (fn-covariate-extractor)](#2-covariate-extractor)
3. [Adaptive Sampling (fn-adaptive-sampling)](#3-adaptive-sampling)

---

## 1. Prevalence Predictor

**Version:** 1.3.0

### Overview

The prevalence predictor estimates the probability of occurrence (prevalence) at any geographic location based on observed survey data. It uses a **Generalized Additive Model (GAM)** with a **Gaussian Process (GP)** spatial smooth to interpolate between observed locations and quantify prediction uncertainty.

### The GAM Methodology

#### What is a GAM?

A **Generalized Additive Model** extends traditional linear models by allowing non-linear relationships between predictors and the response. Instead of fitting:

```
y = β₀ + β₁x₁ + β₂x₂ + ε
```

A GAM fits:

```
y = β₀ + f₁(x₁) + f₂(x₂) + ε
```

Where `f₁` and `f₂` are smooth functions estimated from the data.

#### Why GAM for Spatial Prevalence?

1. **Flexibility**: Captures complex non-linear spatial patterns without assuming a specific functional form
2. **Interpretability**: Results are still interpretable as probabilities
3. **Uncertainty quantification**: Provides confidence intervals on predictions
4. **Handles sparse data**: Works well when survey locations are limited

### Model Specification

The core model formula is:

```r
cbind(n_positive, n_trials - n_positive) ~ te(lng, lat, bs='gp', m=c(2), k=-1)
```

Breaking this down:

| Component | Meaning |
|-----------|---------|
| `cbind(n_positive, n_trials - n_positive)` | Binomial response: successes and failures |
| `te(lng, lat, ...)` | Tensor product smooth over longitude and latitude |
| `bs='gp'` | Gaussian Process basis - treats spatial correlation using GP |
| `m=c(2)` | Matérn smoothness parameter (order 2 = twice differentiable) |
| `k=-1` | Automatically determine number of basis functions |

#### The Gaussian Process Component

The `bs='gp'` option fits a Gaussian Process prior over the spatial surface. This:

- **Assumes spatial autocorrelation**: Nearby locations have similar prevalence
- **Uses the Matérn covariance function**: Controls smoothness of the surface
- **Estimates correlation length**: Learns how far spatial influence extends from data

### Inputs

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `point_data` | GeoJSON FeatureCollection | Yes | Points with `n_trials` and `n_positive` properties |
| `exceedance_threshold` | numeric (0-1) | No | Threshold for exceedance probability calculation |
| `layer_names` | array of strings | No | Environmental covariates to include |

#### Point Data Structure

Each feature in `point_data` should have:

- **Coordinates**: Geographic location (longitude, latitude)
- **`n_trials`**: Number of individuals tested/examined (set to `null` for prediction-only points)
- **`n_positive`**: Number positive/affected (set to `null` for prediction-only points)
- **`id`**: Optional unique identifier

### Algorithm Steps

1. **Data Preparation**
   - Parse GeoJSON features into a data frame
   - Extract coordinates (centroids for polygons)
   - Separate training data (has `n_trials` and `n_positive`) from prediction points

2. **Covariate Extraction** (if `layer_names` provided)
   - Call `fn-covariate-extractor` to get environmental variables
   - Merge covariates into the model data
   - Formula becomes: `response ~ te(lng, lat, bs='gp') + covariate1 + covariate2 + ...`

3. **Model Fitting**
   - Fit GAM using R's `mgcv` package with binomial family
   - Estimate spatial smooth and covariate effects
   - Random seed set to 1000 for reproducibility

4. **Prediction Generation**
   - Predict prevalence (probability 0-1) at all input points
   - Generate 200 posterior samples for uncertainty quantification

5. **Uncertainty Calculation**
   - **Bayesian Credible Interval (BCI)**:
     - Draw 200 samples from posterior distribution
     - Calculate 2.5% and 97.5% quantiles
     - BCI width = upper - lower

6. **Exceedance Probability** (if threshold provided)
   - Transform threshold to link scale: `link_threshold = log(threshold / (1 - threshold))`
   - Calculate proportion of posterior samples exceeding threshold
   - **Exceedance uncertainty**: `0.5 - |exceedance_prob - 0.5|`
     - Maximum uncertainty (0.5) when exceedance probability is 0.5
     - Zero uncertainty when probability is 0 or 1

### Outputs

| Field | Description |
|-------|-------------|
| `prevalence_prediction` | Point estimate of probability (0-1) |
| `prevalence_bci_width` | Width of 95% credible interval |
| `exceedance_probability` | Probability prevalence exceeds threshold |
| `exceedance_uncertainty` | Uncertainty in exceedance classification |

### Confidence and Prediction Quality

#### How to Interpret BCI Width

| BCI Width | Interpretation |
|-----------|----------------|
| < 0.10 | High confidence - prediction is well-constrained |
| 0.10 - 0.25 | Moderate confidence - reasonable estimate |
| 0.25 - 0.40 | Low confidence - considerable uncertainty |
| > 0.40 | Very low confidence - need more data |

#### Factors Affecting Prediction Confidence

1. **Distance to observations**: Predictions far from survey points have higher uncertainty
2. **Number of observations**: More surveys → tighter credible intervals
3. **Sample sizes**: Higher `n_trials` at each location reduces variance
4. **Spatial pattern complexity**: Highly variable surfaces are harder to predict
5. **Covariate availability**: Environmental predictors can improve predictions in data-sparse areas

### Mathematical Details

#### Binomial Likelihood

For each observation location *i*:

```
n_positive_i ~ Binomial(n_trials_i, p_i)
```

Where `p_i` is the true prevalence at location *i*.

#### Link Function

The model uses a logit link:

```
logit(p_i) = η_i = f(lng_i, lat_i) + Σ β_j × covariate_ij
```

#### Posterior Simulation

To generate credible intervals:

1. Draw coefficient vector `β*` from `MVN(β̂, Σ̂)` where `Σ̂` is the estimated covariance matrix
2. Compute linear predictor: `η* = X × β*`
3. Transform to probability: `p* = 1 / (1 + exp(-η*))`
4. Repeat 200 times
5. Take quantiles across simulations

---

## 2. Covariate Extractor

**Version:** 0.2.5

### Overview

The covariate extractor retrieves environmental variable values at specified geographic coordinates. These covariates can improve prevalence predictions by incorporating environmental drivers of disease/condition distribution.

### Available Covariates

#### Bioclimatic Variables (bioclim1-19)

From WorldClim (worldclim.org), these capture climate characteristics:

| Variable | Description |
|----------|-------------|
| bioclim1 | Annual Mean Temperature |
| bioclim2 | Mean Diurnal Range (mean of monthly max-min temps) |
| bioclim3 | Isothermality (BIO2/BIO7 × 100) |
| bioclim4 | Temperature Seasonality (standard deviation × 100) |
| bioclim5 | Max Temperature of Warmest Month |
| bioclim6 | Min Temperature of Coldest Month |
| bioclim7 | Temperature Annual Range (BIO5-BIO6) |
| bioclim8 | Mean Temperature of Wettest Quarter |
| bioclim9 | Mean Temperature of Driest Quarter |
| bioclim10 | Mean Temperature of Warmest Quarter |
| bioclim11 | Mean Temperature of Coldest Quarter |
| bioclim12 | Annual Precipitation |
| bioclim13 | Precipitation of Wettest Month |
| bioclim14 | Precipitation of Driest Month |
| bioclim15 | Precipitation Seasonality (coefficient of variation) |
| bioclim16 | Precipitation of Wettest Quarter |
| bioclim17 | Precipitation of Driest Quarter |
| bioclim18 | Precipitation of Warmest Quarter |
| bioclim19 | Precipitation of Coldest Quarter |

#### Elevation (elev_m)

- **Source**: CGIAR-SRTM 90m resolution, aggregated to ~1km
- **Units**: Meters above sea level
- **Notes**: Points in the ocean are assigned 0

#### Distance to Water (dist_to_water_m)

- **Source**: Digital Chart of the World (via DIVA-GIS)
- **Units**: Meters
- **Includes**: Rivers and water bodies
- **Method**: Nearest neighbor distance using geodesic calculation

#### Distance to Roads (dist_to_road_m)

- **Source**: gRoads Global Roads Open Access dataset
- **Units**: Meters
- **Method**: Nearest neighbor distance using geodesic calculation

### Inputs

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `points` | GeoJSON FeatureCollection | Yes | Points to extract values at |
| `layer_names` | array of strings | Yes | List of covariates to extract |
| `resolution` | integer (≥1) | No | Resampling resolution in km² (default: 1) |

### Algorithm Steps

1. **Country Detection**
   - Determine country from first point using rworldmap
   - All data retrieved for that single country

2. **Reference Raster Setup**
   - Load country elevation raster as reference
   - Resample to requested resolution using bilinear interpolation

3. **Layer-by-Layer Extraction**
   - For each requested layer:
     - Download/load layer data
     - Resample to match reference raster
     - Extract values at point locations

4. **Distance Calculations** (for dist_to_water_m, dist_to_road_m)
   - Load water/road vector data
   - Use RANN (nearest neighbor) to find closest feature
   - Calculate geodesic distance using geosphere package

### Limitations

- Only processes points within a single country
- First point determines which country's data to use
- Some layers may have gaps or NA values
- Depends on external data sources (WorldClim, DIVA-GIS, etc.)

---

## 3. Adaptive Sampling

**Version:** 0.3.1

### Overview

The adaptive sampling algorithm recommends optimal locations for the next round of surveys. It balances two objectives:

1. **Target high-uncertainty areas**: Survey where predictions are least reliable
2. **Maintain spatial spread**: Avoid clustering surveys too closely

### The Uncertainty-Distance Sampling Method

This is a form of **utility-based adaptive design** that iteratively selects locations by combining:

- **Uncertainty weight**: Proportional to prediction uncertainty (e.g., `prevalence_bci_width`)
- **Distance penalty**: Penalizes locations close to already-selected points

### Algorithm Steps

1. **Initialize Candidate Pool**
   - Start with all points that have NOT been surveyed (`n_positive` is NA)
   - Exclude points with zero or NA uncertainty values

2. **Select First Point**
   - Probability of selection proportional to uncertainty value
   - Points with higher uncertainty have higher selection probability
   - Formula: `P(select_i) = uncertainty_i / Σ uncertainty`

3. **Iterative Selection** (for batch_size > 1)

   For each subsequent point:

   a. **Calculate distances to selected points**
      - Use centroid coordinates for all geometries
      - Find minimum distance to any already-selected point

   b. **Compute penalized probability**
      ```
      penalized_uncertainty = uncertainty_prob × min_distance_to_selected
      ```
      Normalize so probabilities sum to 1

   c. **Weighted random selection**
      - Sample one point from remaining candidates
      - Probability proportional to penalized uncertainty

   d. **Add to selection set**

4. **Return Results**
   - Original GeoJSON with new `adaptively_selected` field
   - Value is 1 for selected points, 0 for others

### Mathematical Formulation

For iteration *k*, selecting from candidates not yet selected:

**Selection probability:**
```
P(select_i | selected_{1:k-1}) ∝ u_i × min_j∈selected d(i, j)
```

Where:
- `u_i` = normalized uncertainty at location *i*
- `d(i, j)` = Euclidean distance between points *i* and *j*
- `min_j` = minimum distance to any already-selected point

### Inputs

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `point_data` | GeoJSON FeatureCollection | Yes | Points with uncertainty values |
| `uncertainty_fieldname` | string | Yes | Property name containing uncertainty |
| `batch_size` | integer | No | Number of points to select (default: 1) |

### Design Rationale

#### Why Combine Uncertainty and Distance?

- **Pure uncertainty sampling** would cluster points in high-uncertainty regions
- **Pure spatial sampling** ignores where information is most needed
- **Combined approach** achieves:
  - Information-rich surveys (high uncertainty)
  - Good spatial coverage for model improvement
  - Efficient use of survey resources

#### Why Probabilistic Selection?

- **Deterministic selection** always picks the single "best" point
- **Probabilistic selection**:
  - Maintains exploration vs. exploitation balance
  - Introduces diversity across repeated runs
  - Avoids always selecting the same locations if uncertainty is similar

### Connection to Prevalence Predictor

The adaptive sampling function is designed to work with `fn-prevalence-predictor` outputs:

1. Run prevalence predictor → get `prevalence_bci_width` or `exceedance_uncertainty`
2. Feed those outputs to adaptive sampling with appropriate `uncertainty_fieldname`
3. Survey the selected locations
4. Re-run prevalence predictor with new data
5. Repeat until uncertainty is acceptable

### Which Uncertainty Measure to Use?

| Uncertainty Field | Best For |
|-------------------|----------|
| `prevalence_bci_width` | General prevalence mapping - reduces overall prediction uncertainty |
| `exceedance_uncertainty` | Threshold-based decisions - clarifies whether areas exceed a target |

---

## Workflow Integration

The three functions form an iterative survey optimization pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SURVEY OPTIMIZATION LOOP                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Initial Survey Data                                          │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────┐                                         │
│  │ Covariate Extractor │ ◄─── Optional: Add environmental       │
│  │   (fn-covariate-    │       predictors to improve model       │
│  │    extractor)       │                                         │
│  └─────────┬───────────┘                                         │
│            │                                                     │
│            ▼                                                     │
│  ┌─────────────────────┐                                         │
│  │ Prevalence Predictor│ ───► Outputs:                          │
│  │  (fn-prevalence-    │      • prevalence_prediction            │
│  │   predictor)        │      • prevalence_bci_width             │
│  └─────────┬───────────┘      • exceedance_probability           │
│            │                  • exceedance_uncertainty            │
│            │                                                     │
│            ▼                                                     │
│      ┌──────────┐                                                │
│      │ Evaluate │ ◄─── Is uncertainty acceptable?               │
│      │ Results  │                                                │
│      └────┬─────┘                                                │
│           │                                                      │
│    ┌──────┴──────┐                                               │
│    │             │                                               │
│   YES           NO                                               │
│    │             │                                               │
│    ▼             ▼                                               │
│  ┌────┐   ┌─────────────────────┐                                │
│  │DONE│   │  Adaptive Sampling  │ ◄─── Select next survey       │
│  └────┘   │   (fn-adaptive-     │       locations                │
│           │    sampling)        │                                │
│           └─────────┬───────────┘                                │
│                     │                                            │
│                     ▼                                            │
│            ┌────────────────┐                                    │
│            │ Conduct Surveys│                                    │
│            │ at Selected    │                                    │
│            │ Locations      │                                    │
│            └────────┬───────┘                                    │
│                     │                                            │
│                     └───────────────────► Return to Step 1       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Example: Vaccination Coverage Survey

1. **Initial data**: 20 household surveys with coverage estimates
2. **Run predictor**: Generate coverage map with uncertainty
3. **Identify gaps**: BCI width > 0.20 in 30% of target area
4. **Adaptive sampling**: Select 10 new survey locations
5. **Conduct surveys**: Visit selected households
6. **Update model**: Re-run predictor with 30 total observations
7. **Evaluate**: BCI width now < 0.15 everywhere → acceptable

---

## Technical Dependencies

| Function | Language | Key Packages |
|----------|----------|--------------|
| Prevalence Predictor | R + Python | mgcv, sf, disarm_gears |
| Covariate Extractor | R | raster, sf, RANN, geosphere |
| Adaptive Sampling | R | RANN, sf, jsonlite |

---

## References

- Wood, S.N. (2017). *Generalized Additive Models: An Introduction with R* (2nd ed.). Chapman and Hall/CRC.
- Hijmans, R.J., et al. (2005). Very high resolution interpolated climate surfaces for global land areas. *International Journal of Climatology*, 25(15), 1965-1978.
- Rasmussen, C.E. & Williams, C.K.I. (2006). *Gaussian Processes for Machine Learning*. MIT Press.
