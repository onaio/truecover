# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TrueCover is a geospatial disease surveillance platform for planning, monitoring, and predicting coverage in health campaigns. It combines location intelligence, adaptive sampling, and coverage prediction to help health organizations optimize field operations.

**Stack:** Flask + PostgreSQL/PostGIS backend, React + TypeScript + Mapbox frontend, Temporal for workflow orchestration.

## Common Commands

### Development Setup

```bash
# Start all Docker services (PostgreSQL, Martin tiles, Temporal)
cd truecover-backend && docker-compose up -d

# Backend API (port 5001)
cd truecover-backend
uv sync
uv run python app.py

# Temporal worker (separate terminal)
cd truecover-backend
uv run python temporal_worker.py

# Frontend (port 3050)
cd truecover-app
bun install
bun run dev
```

### Testing

```bash
# Frontend tests
cd truecover-app && bun run test

# Backend tests
cd truecover-backend && uv run pytest

# Single test file
cd truecover-app && bun run test -- src/components/MyComponent.test.tsx
```

### Linting/Formatting

```bash
# Backend
cd truecover-backend
uv run black .
uv run flake8

# Frontend (TypeScript checking)
cd truecover-app && bun run build  # includes tsc
```

### Docker Deployment

```bash
# Frontend production build
cd truecover-app
bun run docker:build
bun run docker:run  # runs on port 3030
```

## Architecture

### Backend (`truecover-backend/`)

- **`app.py`** - Flask entry point, registers all blueprints
- **`routes/`** - API endpoints organized by domain (locations, coverage, rounds, areas, etc.)
- **`temporal/`** - Workflow orchestration for long-running operations
  - `workflows/` - Workflow definitions (round_generation, coverage_prediction, pixel_generation, etc.)
  - `activities/` - Reusable activity implementations
  - `client.py` - Temporal client initialization
- **`db/`** - Database connection and migrations
- **`auth/`** - Clerk JWT authentication middleware and access control

### Frontend (`truecover-app/src/`)

- **`pages/`** - Route-level components (LocationsPage, CoveragePredictionPage, AdaptiveSamplingPage, etc.)
- **`components/`** - Reusable UI components
- **`hooks/`** - Custom React hooks for API calls and state
- **`services/api.ts`** - Axios-based API client
- **`tactical-ui/`** - Custom design system components

### Algorithm Functions (`fn-*/`)

Docker-containerized processing functions:
- **`fn-adaptive-sampling-0.3.1/`** - Uncertainty-guided sampling algorithm
- **`fn-prevalence-predictor-1.3.0/`** - GAM-based spatial interpolation
- **`fn-covariate-extractor-0.2.5/`** - Environmental covariate extraction

## Key Patterns

### Multi-Tenant Access Control

Organizations own projects, projects own areas. Access is enforced at the area level via `@check_area_access` decorator in routes.

### Temporal Workflows

Long-running operations (round generation, coverage prediction, bulk uploads) use Temporal workflows. The worker process must be running separately from the Flask server.

#### Data Serialization Best Practices

**CRITICAL:** All data passed between workflow and activities is serialized through Temporal. Large payloads degrade performance and can hit size limits.

**Anti-patterns to avoid:**
- Fetching data in one activity, returning it, then passing to another activity
- Returning full records with geometry when only IDs are needed
- Per-item activity calls in loops (e.g., one activity per pixel)
- Accumulating large lists in workflow state

**Preferred patterns:**

1. **Combined Activities** - Fetch, process, and write in a single activity:
   ```python
   # BAD: Data flows through Temporal twice
   data = await workflow.execute_activity(fetch_data, ...)
   result = await workflow.execute_activity(process_data, args=[data], ...)

   # GOOD: Data stays in the activity, only summary returned
   result = await workflow.execute_activity(fetch_and_process_data, args=[ids_only], ...)
   ```

2. **Return IDs, not records** - Let activities fetch their own data:
   ```python
   # BAD: Full records serialized
   locations = await workflow.execute_activity(fetch_locations, ...)  # 100KB+

   # GOOD: Only IDs cross the boundary
   location_ids = await workflow.execute_activity(process_locations, args=[campaign_id], ...)
   ```

3. **Batch activity calls** - Never loop with per-item activities:
   ```python
   # BAD: 1000 activity invocations
   for pixel in pixels:
       await workflow.execute_activity(create_entity, args=[pixel], ...)

   # GOOD: Single batched activity
   await workflow.execute_activity(create_entities_batch, args=[pixel_ids], ...)
   ```

4. **Use database as intermediary** - Write results directly, don't return through Temporal:
   ```python
   # Activity writes to DB and returns only count
   return {'inserted': len(new_ids), 'success': True}
   ```

**Good examples in codebase:** `pixel_enrichment.py`, `pixel_generation.py` (see "combined activity" comments)

### Geospatial Data

- PostGIS for spatial queries and storage
- Geometries transmitted as WKT strings
- Mercantile for tile calculations
- Quadkey indexing on locations for efficient spatial lookups

### API Authentication

All protected routes use `@require_auth` decorator which validates Clerk JWT tokens. User synced to local database on first authenticated request.

### Frontend Data Fetching

Use React Query (`@tanstack/react-query`) for all API calls:
- Create custom hooks in `hooks/` that use `useQuery` and `useMutation`
- API methods go in `services/api.ts` with proper TypeScript types
- Never use raw `useEffect` + `axios` for data fetching
- Use `enabled` option to conditionally fetch (e.g., `enabled: !!campaignId && isSignedIn`)
- Query keys should follow the pattern: `['resource', id, ...filters]`

## Database

PostgreSQL 15 with PostGIS.

**IMPORTANT:** Never guess the database schema. Always check with `\d tablename` or query `information_schema` before writing queries. Column names and types change.

Key tables:
- `organizations`, `projects`, `areas` - multi-tenant hierarchy
- `locations` - survey points with geometry and quadkey index
- `rounds` - sampling batches with selected locations
- `visits` - survey outcomes
- `coverage` - prediction values per location/indicator
- `pixels` - raster grid cells for sampling
- `admin_boundaries` - administrative boundary geometries

Migrations in `truecover-backend/db/migrations/`.

## Ports Reference

| Service | Port |
|---------|------|
| Frontend (dev) | 3050 |
| Frontend (Docker) | 3030 |
| Backend API | 5001 |
| PostgreSQL | 5432 |
| Martin Tiles | 3052 |
| Temporal | 7233 |
| Temporal UI | 8080 |
