#!/usr/bin/env Rscript
# Coverage estimation: binomial GAM with a Gaussian-process spatial smooth.
#
# Statistical logic is fn-prevalence-predictor-1.3.0/fn-prevalence-predictor/
# function.R kept verbatim, EXCEPT the posterior simulation: that file draws
# sim_coef from the posterior and never uses it (every "simulation" is the
# same deterministic prediction, so bci_width degenerates to 0). The deployed
# service used disarm_gears' mgcv_posterior_samples instead; this script
# implements the same standard mgcv idiom directly:
#   Xp %*% t(rmvn(1, coef(m), vcov(m)))
# NOTE (genuine R error found while validating this script): mgcv::rmvn(1, ..)
# drops to a bare length-p vector rather than a 1xp matrix (R's usual
# dimension-dropping for a single-row result), so the literal idiom above is
# non-conformable -- t() turns that bare vector into a 1xp row instead of a
# px1 column. The loop below multiplies Xp by the un-transposed draw instead;
# see the comment at that line for the shape reasoning.
# JSON on stdin -> JSON on stdout; any error -> stderr + non-zero exit.

suppressPackageStartupMessages(library(mgcv))
suppressPackageStartupMessages(library(jsonlite))

input <- fromJSON(file("stdin"))
# pixel seeds are uint32; fold into R's signed-int32 range. Determinism is
# still preserved per recorded seed (the fold is itself deterministic).
set.seed(input$params$seed %% .Machine$integer.max)

train <- as.data.frame(input$train)
pred <- as.data.frame(input$predict)
stopifnot(nrow(train) > 0, nrow(pred) > 0)

model <- gam(
  cbind(n_covered, n_trials - n_covered) ~ te(lng, lat, bs = "gp", m = c(2), k = -1),
  family = binomial,
  data = train
)

prevalence <- as.numeric(predict(model, newdata = pred, type = "response"))

n_samples <- 200
Xp <- predict(model, newdata = pred, type = "lpmatrix")
link_sims <- matrix(NA_real_, nrow = nrow(pred), ncol = n_samples)
for (i in seq_len(n_samples)) {
  # mgcv::rmvn(1, mu, sigma) drops to a bare length-p vector (not a 1xp
  # matrix) when n = 1 -- R's usual dimension-dropping for single-row
  # results. t(beta) would then produce a 1xp row, making Xp %*% t(beta)
  # non-conformable (Xp is n_pred x p). beta is already the right shape to
  # multiply directly: Xp %*% beta is treated as Xp %*% (p x 1), giving the
  # intended n_pred x 1 posterior draw.
  beta <- rmvn(1, coef(model), vcov(model))
  link_sims[, i] <- Xp %*% beta
}
bci_lower <- apply(link_sims, 1, function(r) quantile(plogis(r), 0.025, na.rm = TRUE))
bci_upper <- apply(link_sims, 1, function(r) quantile(plogis(r), 0.975, na.rm = TRUE))

out <- list(
  prevalence = prevalence,
  bci_width = as.numeric(bci_upper - bci_lower),
  exceedance_probability = NULL,
  exceedance_uncertainty = NULL
)

threshold <- input$params$exceedance_threshold
if (!is.null(threshold)) {
  link_threshold <- qlogis(threshold)
  ex_prob <- rowMeans(link_sims > link_threshold, na.rm = TRUE)
  out$exceedance_probability <- as.numeric(ex_prob)
  out$exceedance_uncertainty <- as.numeric(0.5 - abs(ex_prob - 0.5))
}

cat(toJSON(out, digits = 10, null = "null", auto_unbox = FALSE))
