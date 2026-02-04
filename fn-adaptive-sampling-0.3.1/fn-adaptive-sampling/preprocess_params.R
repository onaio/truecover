function(params) {
  # Validate batch_size
  if (!is.null(params[['batch_size']])) {
    if (!is.numeric(params[['batch_size']])) {
      stop('Parameter `batch_size` is not numeric')
    }
    if (params[['batch_size']] < 1) {
      stop('Parameter `batch_size` must be greater than zero')
    }
  } else {
    params[['batch_size']] = 1
  }

  # Validate required parameters
  if (is.null(params[['coordinates']])) {
    stop('Missing required `coordinates` parameter')
  }

  if (is.null(params[['uncertainty']])) {
    stop('Missing required `uncertainty` parameter')
  }

  # Convert coordinates to matrix and uncertainty to numeric vector.
  # fromJSON may return a matrix (uniform array) or a list (ragged),
  # so handle both.
  coords <- params[['coordinates']]
  if (!is.matrix(coords)) {
    coords <- do.call(rbind, coords)
  }
  params[['coordinates']] <- coords
  params[['uncertainty']] <- as.numeric(unlist(params[['uncertainty']]))

  n_coords <- nrow(params[['coordinates']])
  n_uncertainty <- length(params[['uncertainty']])

  if (n_coords != n_uncertainty) {
    stop(paste0('coordinates (', n_coords, ') and uncertainty (', n_uncertainty, ') must have same length'))
  }

  rows_available <- sum(!is.na(params[['uncertainty']]))
  if (params[['batch_size']] > rows_available) {
    stop('Batch size is larger than the number of points with non-NA uncertainty')
  }

  return(params)
}
