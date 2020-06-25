library(RANN)
library(sf)

function(params) {
  # 1. Handle input
  # NOTE: from preprocess_params
  point_data = params[['point_data']]
  batch_size = params[['batch_size']]
  uncertainty_fieldname = params[['uncertainty_fieldname']]

  
  # 2. Process
  candidates <- candidates_copy <- point_data
  
  # Change any 0 probabilities to 0.0001 to allow them to be included (effectively randomly)
  candidates[[uncertainty_fieldname]] [candidates[[uncertainty_fieldname]]==0] <- 0.0001
  
  candidates$uncertainty_prob <- as.data.frame(candidates)[, uncertainty_fieldname] / sum(as.data.frame(candidates)[, uncertainty_fieldname])
  
  # Give each an id
  candidates$id <- 1:nrow(candidates)
  in_sample <- sample(1:nrow(candidates), 1, prob = candidates$uncertainty_prob)
  

  # Loop
  if (batch_size > 1) {
    for (i in 1:(batch_size - 1)) {
      
      # Define which is in and out of sample
      candidates_in_sample <- candidates[in_sample,]
      candidates_not_in_sample <- candidates[-in_sample,]

      # First calc distance between the in_sample and the rest
      nn <- nn2(st_coordinates(candidates_in_sample), st_coordinates(candidates_not_in_sample))
      
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
      in_sample <- c(in_sample, candidates_not_in_sample$id[uncertainty_sample])
    }
  }

  # 3. Package response

  # Return points with additional column
  candidates_copy$adaptively_selected <- 0
  candidates_copy$adaptively_selected[in_sample] <- 1
  return(geojson_list(candidates_copy))
}
