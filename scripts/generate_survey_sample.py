#!/usr/bin/env python3
"""
Convert a GeoJSON file with sampled points to a survey data format.
Generates random n_trials (1-4) and n_positive (0 to n_trials) for each point.
"""

import json
import random
import sys
from pathlib import Path


def generate_survey_data(input_file, output_file=None):
    """
    Convert GeoJSON to survey format with random sampling data.

    Args:
        input_file: Path to input GeoJSON file
        output_file: Optional output path (defaults to input_file-survey.json)
    """
    # Read input file
    print(f"Reading {input_file}...")
    with open(input_file, 'r') as f:
        data = json.load(f)

    # Extract features - handle both root-level FeatureCollection and wrapped format
    if 'point_data' in data and isinstance(data['point_data'], dict):
        # Old format: wrapped in point_data
        features = data['point_data'].get('features', [])
    elif 'features' in data:
        # New format: direct FeatureCollection
        features = data.get('features', [])
    else:
        raise ValueError("Invalid GeoJSON format: no 'features' found")

    # Filter for adaptively selected points only
    sampled_features = [f for f in features if f['properties'].get('adaptively_selected') == 1]

    print(f"Found {len(features)} total features")
    print(f"Found {len(sampled_features)} sampled features (adaptively_selected=1)")

    if len(sampled_features) == 0:
        print("WARNING: No features with adaptively_selected=1 found!")
        print("Using all features instead...")
        sampled_features = features

    # Generate survey data
    survey_features = []
    for idx, feature in enumerate(sampled_features):
        # Generate random number of trials (children found: 1-4)
        n_trials = random.randint(1, 4)
        # Generate random number of positive (vaccinated: 0 to n_trials)
        n_positive = random.randint(0, n_trials)

        # Get ID - handle both string UUID and integer ID
        feature_id = feature['properties'].get('id')
        if feature_id is None:
            feature_id = idx + 1

        survey_feature = {
            "type": "Feature",
            "properties": {
                "n_trials": n_trials,
                "n_positive": n_positive,
                "id": str(feature_id)
            },
            "geometry": feature['geometry']
        }
        survey_features.append(survey_feature)

    # Create output structure
    output_data = {
        "point_data": {
            "type": "FeatureCollection",
            "features": survey_features
        }
    }

    # Determine output file path
    if output_file is None:
        input_path = Path(input_file)
        output_file = input_path.parent / f"{input_path.stem}-survey.json"

    # Write output file
    with open(output_file, 'w') as f:
        json.dump(output_data, f, indent=2)

    print(f"Generated survey data with {len(survey_features)} points")
    print(f"Output written to: {output_file}")

    # Print summary statistics
    total_trials = sum(f['properties']['n_trials'] for f in survey_features)
    total_positive = sum(f['properties']['n_positive'] for f in survey_features)
    print(f"\nSummary:")
    print(f"  Total children found: {total_trials}")
    print(f"  Total vaccinated: {total_positive}")
    print(f"  Overall vaccination rate: {total_positive/total_trials:.1%}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python generate_survey_sample.py <input_geojson_file> [output_file]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    generate_survey_data(input_file, output_file)
