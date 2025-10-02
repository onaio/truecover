#!/usr/bin/env python3
"""
Add random survey data (n_trials and n_positive) to adaptively selected features.
Preserves all existing properties and structure.
"""

import json
import random
import sys
from pathlib import Path


def generate_survey_data(input_file, output_file=None):
    """
    Add n_trials and n_positive to features with adaptively_selected=1.
    Preserves all other properties exactly as they are.

    Args:
        input_file: Path to input GeoJSON file
        output_file: Optional output path (defaults to input_file-survey.json)
    """
    # Read input file
    print(f"Reading {input_file}...")
    with open(input_file, 'r') as f:
        data = json.load(f)

    # Get features
    if 'features' not in data:
        raise ValueError("Invalid GeoJSON format: no 'features' found")

    features = data['features']

    # Count adaptively selected features
    selected_count = sum(1 for f in features if f.get('properties', {}).get('adaptively_selected') == 1)

    print(f"Found {len(features)} total features")
    print(f"Found {selected_count} features with adaptively_selected=1")

    # Add n_trials and n_positive to adaptively selected features
    updated_count = 0
    for feature in features:
        props = feature.get('properties', {})

        # Only add survey data to adaptively selected features
        if props.get('adaptively_selected') == 1:
            # Generate random number of trials (children found: 1-4)
            n_trials = random.randint(1, 4)
            # Generate random number of positive (vaccinated: 0 to n_trials)
            n_positive = random.randint(0, n_trials)

            # Add to existing properties (don't replace anything)
            props['n_trials'] = n_trials
            props['n_positive'] = n_positive

            updated_count += 1

    print(f"Added survey data to {updated_count} features")

    # Determine output file path
    if output_file is None:
        input_path = Path(input_file)
        output_file = input_path.parent / f"{input_path.stem}-survey.geojson"

    # Write output file (preserve exact structure)
    with open(output_file, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Output written to: {output_file}")

    # Print summary statistics
    total_trials = 0
    total_positive = 0
    for feature in features:
        props = feature.get('properties', {})
        if 'n_trials' in props and 'n_positive' in props:
            total_trials += props['n_trials']
            total_positive += props['n_positive']

    if total_trials > 0:
        print(f"\nSummary:")
        print(f"  Total children found: {total_trials}")
        print(f"  Total vaccinated: {total_positive}")
        print(f"  Overall vaccination rate: {total_positive/total_trials:.1%}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python generate_survey_sample.py <input_geojson_file> [output_file]")
        print("\nExample:")
        print("  python generate_survey_sample.py data/adaptive_sampling_result-geo.json")
        print("  python generate_survey_sample.py data/result.geojson data/survey.geojson")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    generate_survey_data(input_file, output_file)
