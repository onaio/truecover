function(params) {
  library(mgcv)
  library(sf)
  library(dplyr)

  # Set random seed for reproducibility
  set.seed(1000)

  # Extract parameters
  layer_names = params$layer_names
  exceedance_threshold = params$exceedance_threshold
  point_data = params$point_data

  # Convert GeoJSON to sf object
  features = point_data$features

  # Extract data from features
  data_list = lapply(features, function(feature) {
    props = feature$properties
    coords = feature$geometry$coordinates
    data.frame(
      lng = coords[1],
      lat = coords[2],
      n_trials = ifelse(is.null(props$n_trials), NA, props$n_trials),
      n_positive = ifelse(is.null(props$n_positive), NA, props$n_positive),
      id = ifelse(is.null(props$id), NA, props$id),
      stringsAsFactors = FALSE
    )
  })

  input_data = do.call(rbind, data_list)

  # Add row IDs if not present
  if (all(is.na(input_data$id))) {
    input_data$id = 1:nrow(input_data)
  }

  # Filter out rows with NA n_trials or n_positive for training
  train_data = input_data[!is.na(input_data$n_trials) & !is.na(input_data$n_positive), ]

  if (nrow(train_data) == 0) {
    stop("No valid training data found (all n_trials or n_positive are NA)")
  }

  # Define GAM formula
  gam_formula = as.formula("cbind(n_positive, n_trials - n_positive) ~ te(lng, lat, bs='gp', m=c(2), k=-1)")

  # Fit GAM model
  gam_model = gam(gam_formula, family = binomial, data = train_data)

  # Make predictions on all data
  predictions = predict(gam_model, newdata = input_data, type = "response")

  # Simulate from posterior for credible intervals
  n_samples = 200
  link_sims = matrix(NA, nrow = nrow(input_data), ncol = n_samples)

  for (i in 1:n_samples) {
    # Simulate coefficients from posterior
    sim_coef = rmvn(1, coef(gam_model), vcov(gam_model))
    # Predict on link scale
    link_pred = predict(gam_model, newdata = input_data, type = "link")
    link_sims[, i] = link_pred
  }

  # Convert link scale simulations to response scale
  response_sims = 1 / (1 + exp(-link_sims))

  # Calculate credible intervals (2.5% and 97.5% quantiles)
  bci_lower = apply(response_sims, 1, quantile, probs = 0.025, na.rm = TRUE)
  bci_upper = apply(response_sims, 1, quantile, probs = 0.975, na.rm = TRUE)
  bci_width = bci_upper - bci_lower

  # Calculate exceedance probability if threshold provided
  ex_prob = NULL
  ex_uncert = NULL

  if (!is.null(exceedance_threshold)) {
    link_threshold = log(exceedance_threshold / (1 - exceedance_threshold))
    ex_prob = rowMeans(link_sims > link_threshold, na.rm = TRUE)
    ex_uncert = 0.5 - abs(ex_prob - 0.5)
  }

  # Create output features
  output_features = lapply(1:nrow(input_data), function(i) {
    properties = list(
      id = input_data$id[i],
      prevalence_prediction = predictions[i],
      prevalence_bci_width = bci_width[i]
    )

    if (!is.null(ex_prob)) {
      properties$exceedance_probability = ex_prob[i]
      properties$exceedance_uncertainty = ex_uncert[i]
    }

    # Add original n_trials and n_positive if they exist
    if (!is.na(input_data$n_trials[i])) {
      properties$n_trials = input_data$n_trials[i]
    }
    if (!is.na(input_data$n_positive[i])) {
      properties$n_positive = input_data$n_positive[i]
    }

    list(
      type = "Feature",
      properties = properties,
      geometry = list(
        type = "Point",
        coordinates = c(input_data$lng[i], input_data$lat[i])
      )
    )
  })

  # Create GeoJSON output
  result = list(
    type = "FeatureCollection",
    features = output_features
  )

  return(result)
}
