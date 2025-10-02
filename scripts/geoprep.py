#!/usr/bin/env python3
"""
Prepare a GeoJSON file for TrueCover analysis.
Adds required properties for prevalence prediction and analysis.
"""

import json
import sys
import uuid
from pathlib import Path


def prepare_geojson(input_file, output_file=None):
    """
    Add TrueCover properties to GeoJSON features.

    Args:
        input_file: Path to input GeoJSON file
        output_file: Optional output path (defaults to input_file-tc.geojson)
    """
    # Read input file
    print(f"Reading {input_file}...")
    with open(input_file, 'r') as f:
        data = json.load(f)

    # Extract features
    features = data.get('features', [])
    print(f"Found {len(features)} features")

    # Process each feature
    for idx, feature in enumerate(features):
        # Get or generate ID
        if 'properties' not in feature:
            feature['properties'] = {}

        # Generate or use existing ID
        if 'id' in feature['properties'] and feature['properties']['id']:
            feature_id = str(feature['properties']['id'])
        elif 'id' in feature and feature['id']:
            feature_id = str(feature['id'])
        else:
            feature_id = str(uuid.uuid4())

        # Set feature-level id (string)
        feature['id'] = feature_id

        # Add TrueCover properties
        # Keep existing properties, add new ones with default values (only if they don't exist)
        tc_properties = {
            'exceedance_probability': feature['properties'].get('exceedance_probability', 0),
            'exceedance_uncertainty': feature['properties'].get('exceedance_uncertainty', 0),
            'id': feature['properties'].get('id', idx + 1),  # Integer ID for properties
            'n_positive': feature['properties'].get('n_positive', None),
            'n_trials': feature['properties'].get('n_trials', None),
            'prevalence_bci_width': feature['properties'].get('prevalence_bci_width', 0),
            'prevalence_prediction': feature['properties'].get('prevalence_prediction', 0)
        }

        # Preserve existing properties, but update with TrueCover properties
        # TrueCover properties will only set defaults if they don't already exist
        feature['properties'] = {**feature['properties'], **tc_properties}

    # Determine output file path
    if output_file is None:
        input_path = Path(input_file)
        output_file = input_path.parent / f"{input_path.stem}-tc.geojson"

    # Write output file
    with open(output_file, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"\nProcessed {len(features)} features")
    print(f"Output written to: {output_file}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python geoprep.py <input_geojson_file> [output_file]")
        print("\nExample:")
        print("  python geoprep.py data/map.geojson")
        print("  python geoprep.py data/map.geojson data/map-tc.geojson")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    prepare_geojson(input_file, output_file)
