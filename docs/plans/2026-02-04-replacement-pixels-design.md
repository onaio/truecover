# Replacement Pixels Design

## Summary

For every primary sampled pixel, select one neighboring pixel as a replacement backup. Replacement pixels are shown blue on the map so field teams can navigate to them if the primary pixel doesn't provide enough children.

## Data Model

Add `replacement_for UUID REFERENCES coverage_pixel(id)` to `coverage_pixel`. Replacement pixels get their own `coverage_pixel` row with `rounds` set and `replacement_for` pointing to the primary.

No changes to the `coverage` (building) table — buildings aren't sampled in replacement pixels upfront.

## Neighbor Selection

After a primary pixel is sampled in `sample_buildings_within_pixels`:

1. Compute 8 neighboring quadkeys (level 18) by offsetting tile x/y by -1/0/+1
2. Count buildings per neighbor from `locations` table
3. Filter to neighbors with `count >= buildings_per_pixel` threshold
4. Exclude neighbors already sampled (non-empty `rounds` in `coverage_pixel`)
5. Randomly pick one qualifying neighbor; skip if none qualify
6. Insert `coverage_pixel` row with `replacement_for` set to primary's ID

## Map Rendering

Tile function adds `is_replacement` boolean to MVT properties. MapView colors:
- Primary sampled: green `#28a745`
- Replacement: blue `#007bff`
- Unsampled: dark gray `#1a1a2e`

## Activation

No explicit activation step. Replacement pixels are visual guides. If field teams collect data there, visit submission handles it naturally.

## Files Changed

- `db/migrations/` — new migration for `replacement_for` column
- `temporal/activities/cluster_sampling.py` — neighbor selection logic
- `db/migrations/optimize_pixels_by_campaign.sql` — tile function update
- `truecover-app/src/components/MapView.tsx` — blue color for replacements
