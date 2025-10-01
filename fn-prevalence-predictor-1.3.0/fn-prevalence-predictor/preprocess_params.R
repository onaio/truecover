function(params) {
  # Check for required parameters
  if (is.null(params$point_data)) {
    stop("'point_data' parameter is required")
  }

  # Convert point_data if it's a URL
  if (is.character(params$point_data)) {
    # If it's a URL, fetch it
    if (grepl("^http", params$point_data)) {
      params$point_data = jsonlite::fromJSON(params$point_data)
    } else {
      # If it's a file path, read it
      params$point_data = jsonlite::fromJSON(params$point_data)
    }
  }

  # Validate point_data structure
  if (is.null(params$point_data$features)) {
    stop("'point_data' must be a GeoJSON FeatureCollection with 'features'")
  }

  # Check that features have required fields (n_trials and n_positive)
  features = params$point_data$features
  if (length(features) > 0) {
    props = features[[1]]$properties
    if (is.null(props$n_trials) && is.null(props$n_positive)) {
      stop("Features must have 'n_trials' and 'n_positive' fields")
    }
  }

  return(params)
}
