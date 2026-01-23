# Stratified Cluster Sampling Design

## Overview

Enable WHO-aligned multi-stage cluster sampling for vaccination coverage surveys. This combines hierarchical area selection with existing adaptive sampling for final point selection within each selected union.

## User Flow

### Two-Step Wizard

**Step 1 - Area Selection & Categorization**
- User selects starting admin level (e.g., District)
- System displays all sub-units (Upazilas → Unions) in a drag-drop interface
- Four columns: Uncategorized | High-risk | Low-risk | Hard-to-reach
- All units start in "Uncategorized"
- User must empty Uncategorized column before proceeding

**Step 2 - Sampling Parameters & Review**
- Set counts: N upazilas, N unions per upazila, N pixels per union
- Toggle: Random vs Population-weighted selection
- Optional: How risk categories affect selection weights
- Optional: Minimum population threshold (if population data exists)
- Summary showing expected pixels and estimated population (if data exists)
- Confirm to create round

## Sampling Algorithm

### Stage 1 - Upazila Selection
- Pool upazilas from each category (high-risk, low-risk, hard-to-reach)
- If category weighting enabled: apply multipliers to selection probability
- If population-weighted: probability proportional to total population in upazila
- If pure random: equal probability per upazila
- Randomly select N upazilas from the pool

### Stage 2 - Union Selection
- For each selected upazila, get its unions
- Apply same weighting logic (category + optional population)
- Randomly select M unions per upazila

### Stage 3 - Pixel Preparation
- Check if pixels exist for each selected union
- Generate missing pixels (using existing pixel generation workflow)
- If population data exists and threshold set, filter out pixels below threshold

### Stage 4 - Pixel Selection (Adaptive Sampling)
- For each selected union, run adaptive sampling
- Batch size = user-specified "pixels per union"
- Uses uncertainty field (e.g., prevalence_bci_width) to prioritize
- Combines results across all unions into final round

**Output:** Round containing all selected pixels, tagged with round_number

## UI Components

### New Component: `StratifiedClusterSamplingWizard.tsx`

**Step 1 Panel - Area Categorization**
- Admin level dropdown at top (District, Upazila, Union)
- On selection, fetches child boundaries from `/api/admin-boundaries/<pcode>/children`
- Four-column drag-drop area using `@dnd-kit/core`
- Each column shows count badge (e.g., "High-risk (4)")
- Validation: "Proceed" button disabled until Uncategorized is empty
- Cards show area name + population (if available)

**Step 2 Panel - Parameters**
- Three number inputs: "Upazilas to select", "Unions per upazila", "Pixels per union"
- Toggle switch: "Weight selection by population"
- Collapsible section: "Category weighting" with optional multipliers
- Collapsible section: "Population filter" with min threshold input (shown only if population data exists)
- Summary box: "~150 pixels across 6 unions in 3 upazilas, Estimated population: ~12,500"
- "Create Round" button triggers workflow

**Integration Point**
- Toggle in round creation: "Simple sampling" vs "Stratified Cluster Sampling"

## Backend API

### New Endpoints

**GET `/api/admin-boundaries/<pcode>/children`**
- Returns child boundaries with hierarchy info
- Response: pcode, name, level, parent_pcode, population (if available)

**POST `/api/areas/<area_id>/rounds/stratified-cluster`**
```json
{
  "name": "Round 1",
  "starting_pcode": "BD1234",
  "categories": {
    "high_risk": ["BD1234-01", "BD1234-02"],
    "low_risk": ["BD1234-03"],
    "hard_to_reach": ["BD1234-04"]
  },
  "upazila_count": 3,
  "unions_per_upazila": 2,
  "pixels_per_union": 50,
  "population_weighted": true,
  "category_weights": {"high_risk": 2, "low_risk": 1, "hard_to_reach": 1},
  "min_population": 10,
  "indicator_id": "uuid"
}
```

### New Temporal Workflow: `StratifiedClusterSamplingWorkflow`

Activities:
1. Select upazilas (with weighting logic)
2. Select unions per upazila
3. Ensure pixels exist, generate if missing
4. Run adaptive sampling per union
5. Create round with combined results

## Data Model

### New Table: `cluster_sampling_config`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| round_id | UUID | FK to rounds |
| starting_pcode | TEXT | Starting admin boundary |
| categories | JSONB | Maps pcodes to category names |
| upazila_count | INTEGER | Number of upazilas to select |
| unions_per_upazila | INTEGER | Unions per upazila |
| pixels_per_union | INTEGER | Pixels per union (adaptive sampling batch) |
| population_weighted | BOOLEAN | Use population weighting |
| category_weights | JSONB | Optional category multipliers |
| min_population | INTEGER | Optional population threshold |
| created_at | TIMESTAMP | Creation timestamp |

### Modification to `rounds` Table

Add column: `sampling_method` (TEXT)
- Values: 'simple', 'stratified_cluster'
- Distinguishes round types for display

## Edge Cases

- **Not enough units:** If user requests 5 upazilas but only 3 exist, select all available and warn
- **No pixels in union:** Trigger pixel generation before adaptive sampling
- **No population data:** Hide population-weighted toggle and estimate
- **Empty category:** Valid - user may categorize everything as high-risk

## Performance

- Children boundaries: Fast with existing PostGIS indexes
- Pixel generation: Run in parallel within workflow
- Adaptive sampling per union: Run in parallel after pixels ready

## Future Extensions (Not in Scope)

- Full WHO PPES mode with statistical sample size calculations
- Export to ODK/ONA with pre-loaded entities
- Building-level sampling within pixels
- Printable field materials per union
