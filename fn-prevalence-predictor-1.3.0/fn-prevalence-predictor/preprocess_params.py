from function.preprocess_helpers import required_exists, is_type


def preprocess(params: dict):
    required_exists('point_data', params)

    # Validate point_data structure
    point_data = params.get('point_data')
    if not isinstance(point_data, dict):
        raise ValueError("point_data must be a dictionary/object")

    if 'features' not in point_data:
        raise ValueError("point_data must be a GeoJSON FeatureCollection with 'features' array")

    features = point_data.get('features', [])
    if not isinstance(features, list) or len(features) == 0:
        raise ValueError("point_data must contain at least one feature")

    # Validate that features have required fields (per SPECS.md)
    # Each feature should have either:
    #   1. n_trials and n_positive (standard survey data), OR
    #   2. prevalence (pre-calculated)
    first_feature = features[0]
    if 'properties' not in first_feature:
        raise ValueError("Features must have 'properties' field")

    props = first_feature['properties']

    # Check for required fields
    has_prevalence = 'prevalence' in props
    has_trials = 'n_trials' in props and 'n_positive' in props

    if not has_prevalence and not has_trials:
        available_keys = ', '.join(props.keys()) if props else '(none)'
        raise ValueError(
            f"Features must contain either:\n"
            f"  1. 'n_trials' and 'n_positive' fields (per SPECS.md), OR\n"
            f"  2. 'prevalence' field (pre-calculated)\n"
            f"First feature has properties: {available_keys}"
        )

    # Validate exceedance_threshold if provided
    if 'exceedance_threshold' in params:
        threshold = params['exceedance_threshold']
        if not isinstance(threshold, (int, float)):
            raise ValueError("exceedance_threshold must be a number")
        if threshold <= 0 or threshold >= 1:
            raise ValueError("exceedance_threshold must be between 0 and 1 (exclusive)")

    # Optional, but if exists, must be string
    is_type('uncertainty_type', params, str)