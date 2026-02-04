suppressPackageStartupMessages({
  library(RANN)
})

function(params) {
  coords <- params[['coordinates']]      # matrix of [lon, lat] from preprocessing
  uncertainty <- params[['uncertainty']]  # numeric vector from preprocessing
  batch_size <- params[['batch_size']]

  n <- nrow(coords)

  # Replace zero uncertainty with small value to allow inclusion
  uncertainty[uncertainty == 0] <- 0.0001
  uncertainty_prob <- uncertainty / sum(uncertainty)

  # Select first point by uncertainty probability
  in_sample <- sample(1:n, 1, prob = uncertainty_prob)

  # Iteratively select remaining points using uncertainty * spatial diversity
  if (batch_size > 1) {
    for (i in 1:(batch_size - 1)) {
      not_in_sample <- setdiff(1:n, in_sample)

      # Nearest-neighbor distances from sampled to unsampled points
      nn <- nn2(coords[in_sample, , drop = FALSE], coords[not_in_sample, , drop = FALSE])

      # Min distance from each unsampled point to any sampled point
      min_dist <- apply(nn$nn.dists, 1, min)
      min_dist <- min_dist / sum(min_dist)

      # Combine distance diversity with uncertainty
      pen_uncertainty <- uncertainty_prob[not_in_sample] * min_dist
      pen_uncertainty <- pen_uncertainty / sum(pen_uncertainty)

      # Sample next point
      selected <- sample(1:length(not_in_sample), 1, prob = pen_uncertainty)
      in_sample <- c(in_sample, not_in_sample[selected])
    }
  }

  # Return 0-indexed selected indices for Python
  return(list(selected_indices = as.integer(in_sample - 1)))
}
