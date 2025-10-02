suppressPackageStartupMessages({
  library(RANN)
  library(sf)
  library(jsonlite)
})

function(params) {
  # 1. Handle input
  # NOTE: from preprocess_params
  point_data = params[['point_data']]
  batch_size = params[['batch_size']]
  uncertainty_fieldname = params[['uncertainty_fieldname']]


  # 2. Process
  candidates_copy <- point_data

  # Filter out points that have already been visited (have n_positive value)
  # Store original row indices for later mapping
  if ("n_positive" %in% names(point_data)) {
    # Exclude points where n_positive is not NA (already surveyed)
    # Keep only points where n_positive is NA (not yet visited)
    candidate_indices <- which(is.na(point_data$n_positive))
    candidates <- point_data[candidate_indices, ]
  } else {
    candidate_indices <- 1:nrow(point_data)
    candidates <- point_data
  }

  # Change any 0 probabilities to 0.0001 to allow them to be included (effectively randomly)
  candidates[[uncertainty_fieldname]] [candidates[[uncertainty_fieldname]]==0] <- 0.0001

  candidates$uncertainty_prob <- as.data.frame(candidates)[, uncertainty_fieldname] / sum(as.data.frame(candidates)[, uncertainty_fieldname])

  # Give each an id (for internal tracking during sampling)
  candidates$temp_id <- 1:nrow(candidates)
  in_sample <- sample(1:nrow(candidates), 1, prob = candidates$uncertainty_prob)
  

  # Loop
  if (batch_size > 1) {
    for (i in 1:(batch_size - 1)) {
      
      # Define which is in and out of sample
      candidates_in_sample <- candidates[in_sample, , drop = FALSE]
      candidates_not_in_sample <- candidates[-in_sample, , drop = FALSE]

      # First calc distance between the in_sample and the rest
      # Use centroids for both points and polygons
      # st_centroid works on any geometry type (points return themselves)
      # Suppress warnings about attributes being discarded
      coords_in_sample <- suppressWarnings(st_coordinates(st_centroid(candidates_in_sample)))
      coords_not_in_sample <- suppressWarnings(st_coordinates(st_centroid(candidates_not_in_sample)))
      nn <- nn2(coords_in_sample, coords_not_in_sample)
      
      # convert distances to selection probability
      min_dist_to_other_points <- apply(nn$nn.dists, 1, min)
      min_dist_to_other_points <- min_dist_to_other_points / sum(min_dist_to_other_points)
      
      # Multiply by entropy
      candidates_not_in_sample$pen_uncertainty <- 
        candidates_not_in_sample$uncertainty_prob * min_dist_to_other_points
      
      candidates_not_in_sample$uncertainty_prob <- 
        candidates_not_in_sample$pen_uncertainty / sum(candidates_not_in_sample$pen_uncertainty)
      
      # Sample
      uncertainty_sample <- sample(1:nrow(candidates_not_in_sample), 1, prob = candidates_not_in_sample$uncertainty_prob)
      in_sample <- c(in_sample, candidates_not_in_sample$temp_id[uncertainty_sample])
    }
  }

  # 3. Package response

  # Return points with additional column
  # Initialize adaptively_selected if it doesn't exist, or preserve existing values
  if (!"adaptively_selected" %in% names(candidates_copy)) {
    candidates_copy$adaptively_selected <- 0
  }

  # Mark newly selected points - map from candidates temp_ids back to original indices
  original_indices <- candidate_indices[in_sample]
  candidates_copy$adaptively_selected[original_indices] <- 1
  
  # Convert to geojson and handle NA values properly
  result <- geojson_list(candidates_copy)
  
  # Convert the geo_list to a regular list to avoid serialization issues
  result_list <- unclass(result)
  
  return(result_list)
}
