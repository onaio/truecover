⏺ GAM (Generalized Additive Models) Explained Simply

  Think of GAM as a flexible way to find patterns in data when those
  patterns might be curved or wavy rather than straight lines.

  The Problem GAM Solves

  Imagine you're trying to predict disease prevalence across a map.
  The relationship between location and disease isn't simple:
  - Disease might be high in valleys but low on hills
  - It might spread along rivers in curved patterns
  - Urban areas might have different patterns than rural areas

  A straight line can't capture these complex, curvy relationships.
  GAM can.

  Visual Analogy

  Traditional Linear Model: Like drawing with a ruler
  Disease Risk
      ^
      |     /
      |    /  ← Single straight line
      |   /
      |  /
      +---------> Location

  GAM: Like drawing with a flexible spline (bendy ruler)
  Disease Risk
      ^
      |    ╭─╮
      |   ╱   ╲    ← Curved, flexible line
      |  ╱     ╲_╱  ← Can capture local patterns
      | ╱
      +---------> Location

  How GAM Works in TrueCover

  1. The Input Data

  Location A: 100 people tested, 10 positive → 10% prevalence
  Location B: 50 people tested, 30 positive → 60% prevalence
  Location C: We want to predict prevalence here

  2. The GAM Formula Breakdown

  cbind(n_positive, n_trials - n_positive) ~ te(lng, lat, bs='gp',
  m=c(2), k=-1)

  Let me decode this:

  - Left side cbind(n_positive, n_trials - n_positive):
    - "Out of n_trials people, n_positive tested positive"
    - This is binomial data (success/failure counts)
  - Right side te(lng, lat, bs='gp'):
    - te() = "tensor smooth" - creates a flexible 2D surface
    - lng, lat = longitude and latitude coordinates
    - bs='gp' = use Gaussian process (good for spatial data)
    - Creates a "heat map" that can bend and flex to fit the data

  3. What the Model Does

  Step 1: Learn the Spatial Pattern
  - Looks at where disease is high/low
  - Creates a smooth "surface" over the map
  - Like stretching a flexible rubber sheet over pins of different
  heights

  Step 2: Handle Uncertainty
  - Areas with lots of data points → confident predictions
  - Areas with few data points → uncertain predictions
  - Automatically smooths more where data is sparse

  Step 3: Make Predictions
  - For new locations, reads the value from the smooth surface
  - Provides probability (0-100% chance of disease)

  Real-World Example

  Imagine malaria prevalence in a region:

  Map View:
      River →  ～～～～～～～～
             ↙ High prevalence (wet areas)

      Village • 60% prevalence
              ╱
      Road ═══╬═══════════
              ╲
      Village • 15% prevalence
             ↖ Low prevalence (dry areas)

      Hills ▲▲▲▲▲▲▲▲▲▲

  GAM learns:
  - Disease is higher near the river (moisture)
  - Disease decreases toward the hills (elevation)
  - Creates smooth gradients between known points

  With vs Without Covariates

  Without Covariates (Spatial Only)

  GAM only knows: "Disease tends to be similar in nearby locations"
  If Village A (10km away) has 30% prevalence
  And Village B (10km away) has 40% prevalence
  → Your location probably has ~35% prevalence

  With Covariates (Environmental Factors)

  GAM knows: "Disease relates to temperature, rainfall, elevation..."
  Your location has:
  - Temperature similar to Village A → suggests 30% prevalence
  - Rainfall similar to Village B → suggests 40% prevalence
  - Near a river (like other high-risk areas) → suggests 50%
  prevalence
  → Model weighs all factors: predicts 42% prevalence

  Why GAM Instead of Simple Averages?

  Simple Average: "The average of nearby villages is 35%"
  - Ignores that disease might spread in specific directions
  - Treats all directions equally

  GAM: "Disease follows the river valley and decreases with
  elevation"
  - Learns directional patterns
  - Adapts to local geography
  - Provides uncertainty estimates

  The Statistical Magic

  GAM automatically:
  1. Avoids overfitting: Won't create wild spikes just because one
  village has high disease
  2. Balances flexibility: Smooth enough to generalize, flexible
  enough to capture real patterns
  3. Handles sparse data: Makes conservative predictions where data
  is limited
  4. Quantifies uncertainty: Tells you "50% prevalence ± 20%" vs "50%
   prevalence ± 5%"

  In Summary

  GAM is like having a smart interpolation system that:
  - Learns complex, curved patterns from your data
  - Makes educated guesses for unmeasured locations
  - Tells you how confident it is about each prediction
  - Can incorporate environmental factors if available

  For disease mapping, this means better predictions than simple
  distance-based averaging, especially when disease follows
  geographic features like rivers, roads, or elevation gradients.