# Bangladesh City Corporation & Sub-District Admin Boundaries

Date: 2026-07-03

## Problem

`data/new/` contains two new Bangladesh boundary datasets that the current
`admin_boundaries` schema cannot represent:

- **`Districts/<DistrictName>/*.shp`** (23 of 64 districts present today, more
  expected over time): each shapefile is **block-level** (EPI-catchment)
  polygons, one row per block, carrying the full path
  `Division > District > Upazila (THANAME) > Union (UNINAME) > Ward (WARDNAME) > Block (block_c/org_name)`.
  Ward names are only unique within a union (e.g. "Ward 2" repeats across
  unions); `org_name` is literally the EPI center name.
- **`City corporations/<CCName>/*.shp`** (9 of 9 city corporations): each
  shapefile is **ward-level** polygons — the finest unit provided (no block
  breakdown exists for city corporations) — carrying the path
  `Division > District > City Corporation (CCNAME) > Zone (ZONENAME) > Ward (WARDNAME)`.

Rural and urban boundaries are geographically carved out from each other
(verified: Dhaka district's block file contains only its 5 rural upazilas —
Dhamrai, Dohar, Keraniganj, Nawabganj, Savar — none of the urban core covered
by DNCC/DSCC). Real-world Bangladesh admin structure branches at the district
level: rural areas go `district → upazila → union → ward → block`, urban
areas (inside a city corporation's jurisdiction) go
`district → city_corporation → zone → ward`, skipping upazila/union
entirely.

The existing `admin_boundaries` table encodes a single linear 5-tier chain
(`level` 0-4, columns `adm0_pcode`...`adm4_pcode`, with `level` implicitly
mapped to country/division/district/upazila/union everywhere in code) and
cannot express a branching hierarchy or depth beyond union. Every place that
walks the tree (`routes/admin_boundaries.py::get_admin_boundary_children`,
`temporal/activities/cluster_sampling.py::get_children_for_pcodes`,
`scripts/populate_admin_boundary_stats.py`) hardcodes
`child_level = parent_level + 1`, capped at 4.

Verified against the live `admin_boundaries` table: all 64 districts, 544
upazilas, and 5,160 unions already exist (from the existing geoparquet
import), using standard BD numeric pcodes (e.g. `BD302638`). The new
shapefiles use a **different, incompatible identifier scheme**
(`div_uid`/`dist_uid` alphanumeric strings; `ward_c`/`block_c` like
`"W1"`/`"KHA1"`) — there is no shared pcode to join on. However, **name
matching confirms the existing union rows are already correct**: all 12
union names under Keraniganj upazila (`Aganagar`, `Basta`, `Kalatia`,
`Kalindi`, `Konda`, `Ruhitpur`, `Sakta`, `Subhadya`, `Taranagar`, `Tegharia`,
`Zinjira`) match the new shapefile's `UNINAME` values (near-exact; one row is
`"Subhadya (Part)"` vs `"Subhadya"`). So district/upazila/union do **not**
need to be recreated — only new levels need to attach underneath (and, for
city corporations, a new sibling branch needs to attach under district).

## Scope

- **In scope:** letting campaigns be generated against city corporations,
  their zones/wards, and rural wards/blocks — i.e. campaign area *selection*,
  via the existing `area_type: 'admin_boundary'` flow in
  `routes/campaigns.py`.
- **In scope:** generalizing the Stratified Cluster Sampling workflow so it
  can start from a City Corporation and run the same two-stage random
  selection one branch over — N Zones, then M Wards per zone, then K pixels
  per ward — mirroring today's District → N Upazilas → M Unions per upazila
  → K pixels per union. The top-level wizard gets a choice of which branch
  to start from; see "Stratified Cluster Sampling generalization" below.
- **Out of scope:** `data/new/District.json` (64 simple district-outline
  polygons with DHIS2 codes) — unrelated to this feature, existing level-2
  district data is left as-is.
- **Full depth is in scope on both branches:** rural selectable down to
  individual Block; urban selectable down to Ward (the finest unit the city
  corporation data provides — confirmed no block-equivalent exists for city
  corporations, each CC folder contains exactly one shapefile with no deeper
  breakdown).
- Ingestion coverage is expected to stay partial/ongoing — only 23 of 64
  districts have block-level shapefiles today; the importer must handle
  districts one at a time as more shapefiles arrive, not assume full national
  coverage.

## Schema changes (additive only)

```sql
ALTER TABLE admin_boundaries
  ADD COLUMN parent_id UUID REFERENCES admin_boundaries(id) ON DELETE CASCADE,
  ADD COLUMN boundary_type TEXT,
  ADD COLUMN source_code TEXT;
CREATE INDEX idx_admin_boundaries_parent_id ON admin_boundaries(parent_id);
```

- `parent_id`: self-referential tree link, nullable. Only populated for new
  rows (ward/block/city_corporation/zone). All existing rows (levels 0-4)
  keep `parent_id = NULL` — no existing query or code path changes behavior.
- `boundary_type`: disambiguates what a given `level` means once the
  hierarchy branches — `level=3` is `'upazila'` on the rural branch,
  `'city_corporation'` on the urban branch; `level=4` is `'union'` vs
  `'zone'`; `level=5` is `'ward'` on both branches; `level=6` is `'block'`
  (rural only, one level deeper than the urban branch goes). Backfill this
  on the existing 0-4 rows with a one-time `UPDATE ... CASE level` for
  consistency (`'country'`, `'division'`, `'district'`, `'upazila'`,
  `'union'`) — cheap, but not required for existing code to keep working.
- `source_code`: stores the shapefile's own composite code
  (`ward_geoc`/`block_geoc`) as an external reference/dedup key, since these
  new levels don't fit the existing numeric BD-pcode scheme.
- `level` stays a plain integer depth counter. No CHECK constraint or enum
  type is added — matches the existing style, and the app doesn't enforce
  one today.

No existing column, index, or row is altered or removed. `level` and
`adm0-4_pcode` keep meaning exactly what they mean today for existing rows.

## Ingestion

New script: `truecover-backend/db/import_boundary_shapefiles.py`, sibling to
the existing geoparquet-based `db/import_admin_boundaries.py`. Uses `pyshp`
(pure Python, no GDAL system dependency) since no shapefile ingestion path
exists in the repo today — the only current path is geoparquet.

**Rural districts** (`Districts/<Name>/*.shp`): only Ward and Block are new.
1. Resolve the existing Union row (`level=4`) by matching
   `(name, adm3_pcode)` against the shapefile's `UNINAME` grouped under its
   parent upazila's `adm3_pcode`.
2. Dissolve blocks sharing `(uni_uid, WARDNAME)` into a Ward polygon; insert
   with `parent_id` = matched union, `boundary_type='ward'`.
3. Insert each block row as-is (already a leaf polygon); `parent_id` = the
   ward just created, `boundary_type='block'`, `source_code` = `block_geoc`.
4. Any union that fails to name-match is logged and skipped — not guessed —
   surfaced for manual reconciliation.
5. Before trusting a name match, check the block geometries are spatially
   contained within (or substantially overlap) the existing union polygon
   (`ST_Contains`/`ST_Intersects` sanity check); flag mismatches for manual
   review instead of silently attaching to the wrong parent.

**City corporations** (`City corporations/<CCName>/*.shp`): City
Corporation, Zone, and Ward are all new — a new branch under the existing
District row.
1. Resolve the existing District row by `DISTNAME` match.
2. Insert City Corporation row (geometry = dissolve of all its wards),
   `parent_id` = district, `boundary_type='city_corporation'`.
3. Insert Zone rows (geometry = dissolve of wards sharing `zone_uid`),
   `parent_id` = city corporation, `boundary_type='zone'`.
4. Insert Ward rows (leaf, already real polygons), `parent_id` = zone,
   `boundary_type='ward'`, `source_code` = `ward_geoc`.

Run manually like the existing importer (`python db/import_admin_boundaries.py`
equivalent) — no Temporal workflow, since this is an occasional data-load
operation, not a recurring job.

## Route/query changes

- **`get_admin_boundary_children`** (`routes/admin_boundaries.py`): add a
  `parent_id`-based lookup as a first branch — if the requested boundary has
  rows linked via `parent_id`, return those (works for any depth); otherwise
  fall back to the existing `child_level = parent_level + 1` pcode logic,
  unchanged, for boundaries that predate this feature.
- **`add_campaign_area`** (`routes/campaigns.py`): currently looks up the
  boundary by pcode matched across `adm0-4`. Extend it to also accept an
  `admin_boundaries.id` directly, since new rows have no meaningful pcode —
  the picker UI already has the id from the children endpoint and can pass
  it straight through instead of being forced through pcode matching. This
  means a city corporation (or any level — zone, ward, block) can be picked
  directly as the campaign area's starting point, the same way a district
  can be picked directly today — drilling down to zone/ward/block is not
  required, just supported.
- **`list_campaign_areas`**: currently re-derives division/district/
  upazila/union names via hardcoded level-1/2/3/4 self-joins. Add a
  recursive CTE that walks `parent_id` upward to also produce
  city_corporation/zone/ward/block names when present, without touching the
  existing joins for campaign areas that have no `parent_id` chain.
- **`admin_boundary_pixels`/`admin_boundary_stats`**: new ward/block/zone/
  city_corporation rows need their own pixel↔boundary population, but the
  existing `scripts/populate_admin_boundary_stats.py` matches pixels to
  boundaries by **pcode equality** — the new leaf rows (block, ward) have no
  pcode to match on, so that shortcut doesn't apply to them. For these, do a
  real spatial join instead (`ST_Intersects`/`ST_Contains` between pixel
  geometry and the leaf boundary's geometry) to populate
  `admin_boundary_pixels` for leaf rows only. Every non-leaf new row (rural
  Ward, urban Zone, City Corporation) then gets its pixel set as the union
  of its children's already-computed pixel sets, walked bottom-up via
  `parent_id` — no repeated spatial join per level. The existing hardcoded
  `[4,3,2,1]` pcode-match loop is untouched and keeps serving existing rows.

## Frontend

Wherever the campaign-area picker currently drills
division→district→upazila→union, add city corporation as a sibling option
under district, and let drilling continue down through zone→ward (urban) or
ward→block (rural). This is UI wiring against the now-generalized children
endpoint — no new picker paradigm needed.

## Stratified Cluster Sampling generalization

Investigated `temporal/activities/cluster_sampling.py`,
`cluster_sampling_config`, `temporal/workflows/stratified_cluster_sampling.py`,
`routes/rounds.py`, and `StratifiedClusterSamplingWizard.tsx` in detail.
Finding: about half of the pipeline is already level-agnostic and needs zero
changes; the other half is hardcoded to the rural pcode/vocabulary and needs
generalizing. Because this hardcoded half is the *same* `child_level =
parent_level + 1`, capped-at-4 pattern already being fixed in
`get_admin_boundary_children` above, and because new boundary rows (ward,
zone, city_corporation, block) have no meaningful pcode, the fix is to make
**`admin_boundaries.id` the canonical selector throughout this workflow**,
with the existing pcode columns kept as-is for rows that have them (rural
rows keep working exactly as before) rather than as the thing new code reads.

**Already generic, reused unchanged:** `select_clusters` (weighted random
pick — operates on whatever ids/pcodes and categories it's given),
`compute_pixels_for_campaign_areas`, `create_coverage_pixels_for_campaign_area`
(id/`campaign_area_id`-keyed, already exists as a sibling to the
union-specific version), `sample_pixels_for_campaign_area`,
`assign_pixels_to_round`, `update_campaign_area_sampled_counts`
(campaign_area_id-keyed sibling of the union-specific version),
building-sampling activities, `create_replacement_pixels`.

**Needs generalizing:**
- `select_clusters`'s population-weighting path currently looks up
  population by matching `adm1_pcode`/`adm2_pcode`/`adm3_pcode`/`adm4_pcode`
  against the `pixels` table. For a zone/ward/city_corporation row (no
  pcode), this silently matches nothing and falls back to population=1
  (i.e. quietly un-weights that candidate instead of erroring) — a real
  correctness gap, not just a missing feature. Fix: when the boundary has no
  pcode, look up its population via `admin_boundary_pixels`/`pixel_area`
  (quadkey join to `pixels.population`) instead of pcode matching.
- `get_children_for_pcodes` → rewrite to accept boundary ids, mirroring the
  `parent_id`-based branch being added to `get_admin_boundary_children`: if
  the parent row has `parent_id`-linked children, return those directly
  (works at any depth, any `boundary_type`); otherwise fall back to the
  existing pcode/`level+1` logic unchanged, so rural upazila→union lookups
  behave exactly as they do today.
- `create_campaign_areas_for_unions` → replace with a lookup by
  `admin_boundaries.id` instead of `adm4_pcode` matching (a ward is just as
  valid a campaign-area source as a union once looked up by id).
- `create_coverage_pixels_for_union` and
  `update_campaign_area_sampled_count_for_union` → **drop these**, don't
  reimplement them for the zone/ward branch. Per the investigation, their
  campaign-area-id-keyed siblings (`create_coverage_pixels_for_campaign_area`,
  `update_campaign_area_sampled_counts`) already do the same job generically
  and are already called elsewhere — the union-specific pair exists only
  because the stratified workflow was written before the generic ones. Once
  the workflow calls the generic pair, this also removes the current
  duplication, not just adds city-corporation support.
- `cluster_sampling_config` — rename `upazila_count`→`stage1_count`,
  `unions_per_upazila`→`stage2_count`, `pixels_per_union`→`pixels_per_stage2`
  (the old names describe rural vocabulary specifically, which is no longer
  accurate once the same columns hold zone/ward counts); replace
  `starting_pcode TEXT` with `starting_boundary_id UUID NOT NULL REFERENCES
  admin_boundaries(id)` (every boundary row has an id regardless of whether
  it has a pcode, so this covers both branches uniformly and is a strict
  simplification over pcode matching); `categories JSONB` now holds boundary
  ids instead of pcodes. This is an internal API/table with a single
  frontend consumer (the wizard) — no backward-compatibility shim, both
  sides change together in the same PR.
- `StratifiedClusterSamplingWorkflow`/`UnionPixelSamplingWorkflow` (rename
  the latter to something branch-agnostic, e.g. `AreaPixelSamplingWorkflow`,
  keyed by `campaign_area_id` not `union_pcode`) — same rename/generalization
  applied through the workflow's parameters and the child-workflow calls.
- `POST /api/campaigns/<id>/rounds/stratified-cluster` (`routes/rounds.py`):
  body field renames to match the config table (`starting_boundary_id`,
  `stage1_count`, `stage2_count`, `pixels_per_stage2`), updated together with
  the workflow signature.
- **`StratifiedClusterSamplingWizard.tsx`:**
  - Step 0 gets a top-level choice: "Rural (District → Upazila → Union)" vs
    "City Corporation (Zone → Ward)". Rural keeps the existing
    Division → District drill; city corporation shows a flat picker (only 9
    exist nationally — no need to drill through division/district first).
  - Step 1 (drag-drop categorization) is unchanged structurally — it already
    fetches "children of the starting boundary" via
    `useAdminBoundaryChildren`, which becomes id-based/generic once the
    children endpoint is generalized.
  - Step 2 labels ("Upazilas to Select" / "Unions per Upazila" / "Pixels per
    Union") become branch-dependent strings (e.g. "Zones to Select" / "Wards
    per Zone" / "Pixels per Ward") pulled from a small vocabulary lookup
    keyed by which branch was chosen in Step 0, rather than duplicating the
    whole step for each branch.
  - Step 3 progress labels follow the same branch-dependent vocabulary,
    reading the now-generic `stage1`/`stage2` fields from the workflow's
    progress query instead of `selected_upazilas`/`selected_unions`.
  - The hardcoded 3-way categorization (`high_risk`/`low_risk`/
    `hard_to_reach`) is unaffected — it's independent of which branch is
    selected and Matt hasn't asked to change it.

## Explicitly out of scope

- Touching `District.json` or the existing level-2 district polygons.
- Backfilling `parent_id` on existing levels 0-4 rows (optional nice-to-have,
  not required for this feature — can be done later without risk since it's
  purely additive).
