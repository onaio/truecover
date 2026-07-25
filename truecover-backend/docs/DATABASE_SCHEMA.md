# TrueCover Database Schema

This document describes the PostgreSQL/PostGIS database schema for TrueCover.

## Entity Relationship Diagram

```
┌─────────────────┐
│  organizations  │
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────────┐      M:N     ┌─────────────────┐
│ organization_members│◄────────────►│     users       │
└─────────────────────┘              └─────────────────┘
         │
         │ (via organization_id)
         ▼
┌─────────────────┐
│    projects     │
└────────┬────────┘
         │ 1:N
    ┌────┴────┬──────────────────────────────────┐
    ▼         ▼                                  ▼
┌──────────┐ ┌───────────────┐           ┌─────────────┐
│campaigns │ │  indicators   │           │  (settings) │
└────┬─────┘ └───────────────┘           └─────────────┘
     │ 1:N            │
     │                │
     ├────────────────┼──────────────────────────────────────┐
     │                │                                      │
     ▼                ▼                                      ▼
┌────────────────┐  ┌──────────┐  ┌───────────────┐  ┌─────────────────┐
│ campaign_areas │  │  rounds  │  │   coverage    │  │  coverage_pixel │
└───────┬────────┘  └────┬─────┘  └───────────────┘  └─────────────────┘
        │                │                │                   │
        │                ▼                │                   │
        │        ┌────────────────────┐   │                   │
        │        │cluster_sampling_   │   │                   │
        │        │config              │   │                   │
        │        └────────────────────┘   │                   │
        │                                 │                   │
        ▼                                 ▼                   │
┌──────────────┐  ┌───────────────┐  ┌───────────┐           │
│  pixel_area  │  │   locations   │──┤ (coverage)│           │
└──────┬───────┘  └───────────────┘  └───────────┘           │
       │                  │                                   │
       ▼                  │ (via quadkey)                     │
┌──────────────┐          │                                   │
│   pixels     │◄─────────┴───────────────────────────────────┘
└──────┬───────┘
       │
       ├──────────────────────────┐
       ▼                          ▼
┌─────────────────┐    ┌────────────────────────┐
│ pixel_metadata  │    │ admin_boundary_pixels  │
└─────────────────┘    └───────────┬────────────┘
                                   │
                                   ▼
                       ┌─────────────────────┐
                       │  admin_boundaries   │
                       └─────────────────────┘
```

## Tables

### Organization & User Management

#### `users`
External users authenticated via Clerk.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `clerk_id` | TEXT | Clerk authentication ID (unique) |
| `email` | TEXT | User email |
| `name` | TEXT | Display name |
| `organization` | TEXT | Organization name (legacy) |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `organizations`
Top-level organizational units that own projects.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Organization name |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `organization_members`
Junction table linking users to organizations with roles.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | → organizations.id |
| `user_id` | UUID | → users.id |
| `role` | TEXT | Member role (default: 'member') |
| `joined_at` | TIMESTAMP | When user joined |

---

### Project Hierarchy

#### `projects`
Projects belong to organizations and contain campaign and indicator configurations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | → organizations.id |
| `title` | TEXT | Project title |
| `description` | TEXT | Project description |
| `odk_api_key` | TEXT | ODK Central API key |
| `odk_host_url` | TEXT | ODK Central host URL |
| `ona_project_id` | INTEGER | Ona platform project ID |
| `ona_project_name` | TEXT | Ona platform project name |
| `ona_entity_list_id` | INTEGER | Ona entity list ID |
| `ona_entity_list_name` | TEXT | Ona entity list name |
| `odk_pixel_geometry_type` | TEXT | Geometry type for ODK export ('centroid' or 'polygon') |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `campaigns`
Campaigns (formerly called "areas") represent survey campaigns within a project.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `project_id` | UUID | → projects.id |
| `name` | TEXT | Campaign name |
| `description` | TEXT | Campaign description |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |
| `deleted_at` | TIMESTAMP | Soft delete timestamp |

#### `campaign_areas`
Geographic areas within a campaign. Supports both admin boundary references and drawn polygons.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `campaign_id` | UUID | → campaigns.id |
| `name` | TEXT | Area name |
| `area_type` | TEXT | 'admin_boundary' or 'drawn' |
| `admin_boundary_id` | UUID | → admin_boundaries.id (optional) |
| `geometry` | GEOMETRY | PostGIS geometry (SRID 4326) |
| `bbox_min_lng` | DECIMAL | Bounding box min longitude |
| `bbox_min_lat` | DECIMAL | Bounding box min latitude |
| `bbox_max_lng` | DECIMAL | Bounding box max longitude |
| `bbox_max_lat` | DECIMAL | Bounding box max latitude |
| `cached_pixel_count` | INTEGER | Pre-computed pixel count |
| `cached_population` | INTEGER | Pre-computed population |
| `cached_building_count` | INTEGER | Pre-computed building count |
| `cached_sampled_count` | INTEGER | Adaptively sampled pixel count |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

---

### Indicators

#### `indicators`
Measurable indicators tracked within a project (e.g., vaccination coverage).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `project_id` | UUID | → projects.id |
| `name` | TEXT | Indicator name (unique per project) |
| `description` | TEXT | Indicator description |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

---

### Sampling & Rounds

#### `rounds`
Sampling rounds within a campaign.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `campaign_id` | UUID | → campaigns.id |
| `round_number` | INTEGER | Round sequence number |
| `name` | TEXT | Round name |
| `description` | TEXT | Round description |
| `start_date` | DATE | Round start date |
| `end_date` | DATE | Round end date |
| `indicator_id` | UUID | → indicators.id |
| `sampling_target` | TEXT | 'locations' or 'pixels' |
| `sampling_method` | TEXT | 'simple', 'adaptive', 'stratified' |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Constraint:** `UNIQUE(campaign_id, round_number)`

#### `cluster_sampling_config`
Configuration for stratified/cluster sampling rounds.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `round_id` | UUID | → rounds.id |
| `campaign_id` | UUID | → campaigns.id |
| `starting_pcode` | TEXT | Admin boundary pcode to start from |
| `categories` | JSONB | Category definitions |
| `upazila_count` | INTEGER | Number of upazilas to sample |
| `unions_per_upazila` | INTEGER | Unions per upazila |
| `pixels_per_union` | INTEGER | Pixels per union |
| `population_weighted` | BOOLEAN | Use population weighting |
| `category_weights` | JSONB | Weights per category |
| `min_population` | INTEGER | Minimum population filter |
| `created_at` | TIMESTAMP | Creation timestamp |

---

### Locations & Survey Points

#### `locations`
Survey points/locations collected in the field.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `campaign_id` | UUID | → campaigns.id |
| `external_id` | TEXT | External reference ID for deduplication |
| `geometry` | GEOMETRY | PostGIS geometry (SRID 4326) |
| `latitude` | DECIMAL | Latitude |
| `longitude` | DECIMAL | Longitude |
| `quadkey` | TEXT | Mercantile quadkey for spatial indexing |
| `properties` | JSONB | Additional properties |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

---

### Pixel Grids

#### `pixels`
Global pixel grid storage. Pixels are reused across campaigns.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `quadkey` | TEXT | Mercantile quadkey (unique) |
| `geometry` | GEOMETRY | Polygon geometry (SRID 4326) |
| `latitude` | DECIMAL | Centroid latitude |
| `longitude` | DECIMAL | Centroid longitude |
| `level` | INTEGER | Zoom/quadkey level |
| `adm1_pcode` | TEXT | Admin level 1 pcode |
| `adm2_pcode` | TEXT | Admin level 2 pcode |
| `adm3_pcode` | TEXT | Admin level 3 pcode |
| `adm4_pcode` | TEXT | Admin level 4 pcode |
| `population` | NUMERIC | Population within pixel |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `pixel_area`
Junction table linking pixels to campaign areas.

| Column | Type | Description |
|--------|------|-------------|
| `quadkey` | TEXT | → pixels.quadkey |
| `campaign_area_id` | UUID | → campaign_areas.id |
| `created_at` | TIMESTAMP | Creation timestamp |

**Primary Key:** `(quadkey, campaign_area_id)`

#### `pixel_metadata`
Enriched metadata for pixels (population, building counts, covariates).

| Column | Type | Description |
|--------|------|-------------|
| `quadkey` | TEXT | Primary key, → pixels.quadkey |
| `metadata` | JSONB | Key-value metadata |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `pixel_metadata_definitions`
Definitions for metadata fields.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Metadata field name (unique) |
| `description` | TEXT | Field description |
| `data_type` | TEXT | Data type |
| `unit` | TEXT | Unit of measurement |
| `created_at` | TIMESTAMP | Creation timestamp |

---

### Administrative Boundaries

#### `admin_boundaries`
Administrative boundary polygons (countries, divisions, districts, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Boundary name |
| `iso3` | TEXT | Country ISO3 code |
| `level` | INTEGER | Admin level (0=country, 1=division, 2=district, 3=upazila, 4=union) |
| `adm0_pcode` | TEXT | Level 0 pcode |
| `adm1_pcode` | TEXT | Level 1 pcode |
| `adm2_pcode` | TEXT | Level 2 pcode |
| `adm3_pcode` | TEXT | Level 3 pcode |
| `adm4_pcode` | TEXT | Level 4 pcode |
| `geometry` | GEOMETRY | PostGIS geometry (SRID 4326) |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `admin_boundary_stats`
Pre-computed statistics for admin boundaries.

| Column | Type | Description |
|--------|------|-------------|
| `admin_boundary_id` | UUID | → admin_boundaries.id |
| `pixel_count` | INTEGER | Number of pixels |
| `population` | NUMERIC | Total population |

#### `admin_boundary_pixels`
Pre-computed pixel mapping for admin boundaries.

| Column | Type | Description |
|--------|------|-------------|
| `admin_boundary_id` | UUID | → admin_boundaries.id |
| `quadkey` | TEXT | → pixels.quadkey |

---

### Coverage Data

#### `coverage`
Location-level coverage predictions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `location_id` | UUID | → locations.id |
| `campaign_id` | UUID | → campaigns.id |
| `indicator_id` | UUID | → indicators.id |
| `version` | INTEGER | Model version |
| `n_trials` | INTEGER | Number of trials |
| `n_covered` | INTEGER | Number covered |
| `exceedance_probability` | DECIMAL | Probability of exceeding threshold |
| `exceedance_uncertainty` | DECIMAL | Uncertainty in exceedance |
| `prevalence_bci_width` | DECIMAL | Bayesian credible interval width |
| `prevalence_prediction` | DECIMAL | Predicted prevalence |
| `rounds` | INTEGER[] | Array of round numbers included |
| `quadkey` | TEXT | Location quadkey |
| `last_predicted_at` | TIMESTAMP | Last prediction time |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Constraint:** `UNIQUE(location_id, indicator_id, version)`

#### `coverage_pixel`
Pixel-level aggregated coverage predictions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `quadkey` | TEXT | Pixel quadkey |
| `campaign_id` | UUID | → campaigns.id |
| `indicator_id` | UUID | → indicators.id |
| `version` | INTEGER | Model version |
| `n_trials` | INTEGER | Aggregated trials |
| `n_covered` | INTEGER | Aggregated covered |
| `rounds` | INTEGER[] | Array of round numbers |
| `exceedance_probability` | DECIMAL | Probability of exceeding threshold |
| `exceedance_uncertainty` | DECIMAL | Uncertainty in exceedance |
| `prevalence_bci_width` | DECIMAL | Bayesian credible interval width |
| `prevalence_prediction` | DECIMAL | Predicted prevalence |
| `last_predicted_at` | TIMESTAMP | Last prediction time |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Constraint:** `UNIQUE(quadkey, indicator_id, campaign_id, version)`

---

### Data Enrichment

#### `data_sources`
Definitions for external data sources (STAC catalogs, COG files).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Source name (unique) |
| `description` | TEXT | Source description |
| `source_type` | TEXT | 'stac' or 'cog' |
| `stac_catalog_url` | TEXT | STAC catalog URL |
| `stac_collection` | TEXT | STAC collection ID |
| `stac_item` | TEXT | STAC item ID |
| `stac_asset` | TEXT | STAC asset name |
| `cog_url` | TEXT | Direct COG URL |
| `default_statistic` | TEXT | Default aggregation statistic |
| `metadata_field_name` | TEXT | Field name in pixel_metadata |
| `metadata_field_description` | TEXT | Field description |
| `metadata_field_type` | TEXT | Field data type |
| `metadata_field_unit` | TEXT | Field unit |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `enrichment_jobs`
Async jobs for enriching pixel metadata from data sources.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `campaign_id` | UUID | → campaigns.id |
| `data_source_id` | UUID | → data_sources.id |
| `statistic` | TEXT | Aggregation statistic |
| `status` | TEXT | 'queued', 'running', 'completed', 'failed' |
| `pixels_processed` | INTEGER | Progress counter |
| `pixels_total` | INTEGER | Total pixels to process |
| `error_message` | TEXT | Error details if failed |
| `workflow_id` | VARCHAR(255) | Temporal workflow ID |
| `retry_count` | INTEGER | Number of retries |
| `last_attempted_at` | TIMESTAMP | Last attempt time |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

---

### Materialized Views

#### `pixel_location_counts`
Pre-computed location counts per pixel per campaign.

| Column | Type | Description |
|--------|------|-------------|
| `quadkey` | TEXT | Pixel quadkey |
| `campaign_id` | UUID | Campaign ID |
| `location_count` | INTEGER | Number of locations |

---

## Key Relationships

### Multi-Tenant Hierarchy
```
organizations (1) ──► (N) projects (1) ──► (N) campaigns (1) ──► (N) campaign_areas
                                    │                    │
                                    │                    └──► (N) locations
                                    │                    └──► (N) rounds
                                    │                    └──► (N) coverage_pixel
                                    │
                                    └──► (N) indicators ──► (N) coverage
```

### Spatial Data Linking
```
pixels ◄───── pixel_area ─────► campaign_areas
   │
   ├──► pixel_metadata (enriched data)
   │
   └──► admin_boundary_pixels ─────► admin_boundaries
```

### Coverage Flow
```
locations ──► coverage (location-level predictions)
    │
    └── quadkey ──► pixels ──► coverage_pixel (aggregated predictions)
```

---

## Indexes

Key spatial indexes use PostGIS GIST:
- `idx_locations_geometry` - Location point lookups
- `idx_pixels_geometry` - Pixel polygon lookups
- `idx_campaign_areas_geometry` - Area boundary lookups
- `idx_admin_boundaries_geometry` - Admin boundary lookups

Key performance indexes:
- `idx_locations_quadkey` - Quadkey-based spatial queries
- `idx_coverage_quadkey` - Coverage by pixel lookups
- `idx_pixels_adm*_pcode` - Admin boundary filtering
