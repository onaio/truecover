# Method Comparison: WHO Vaccination Coverage Surveys vs. TrueCover Functions

This document analyzes the methodological differences and synergies between the WHO Vaccination Coverage Cluster Survey methodology and TrueCover's analytical functions.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Fundamental Paradigm Differences](#2-fundamental-paradigm-differences)
3. [Sampling Design Comparison](#3-sampling-design-comparison)
4. [Statistical Inference Approaches](#4-statistical-inference-approaches)
5. [Uncertainty Quantification](#5-uncertainty-quantification)
6. [Threshold Classification Methods](#6-threshold-classification-methods)
7. [How They Complement Each Other](#7-how-they-complement-each-other)
8. [Adapting TrueCover for Vaccination Coverage](#8-adapting-truecover-for-vaccination-coverage)
9. [Integration Scenarios](#9-integration-scenarios)
10. [Recommendations](#10-recommendations)

---

## 1. Executive Summary

| Aspect | WHO Cluster Survey | TrueCover |
|--------|-------------------|-----------|
| **Philosophy** | Design-based inference | Model-based inference |
| **Sampling** | Probability sampling (PPES) | Adaptive/uncertainty-driven |
| **Spatial Structure** | Implicit (design effect) | Explicit (Gaussian Process) |
| **Inference** | Frequentist (confidence intervals) | Bayesian (credible intervals) |
| **Primary Goal** | Unbiased population estimates | Spatial prediction with uncertainty |
| **When Used** | Before survey (sample design) | During/after (adaptive refinement) |

**Key Finding**: These approaches are fundamentally complementary. WHO methodology ensures representative, defensible population estimates. TrueCover enables spatial prediction, identifies where additional data is most valuable, and provides continuous coverage maps.

---

## 2. Fundamental Paradigm Differences

### 2.1 Design-Based vs. Model-Based Inference

**WHO (Design-Based)**

The validity of estimates comes from the sampling design itself:

- Every unit has a known, non-zero probability of selection
- Survey weights correct for unequal selection probabilities
- Inference is valid regardless of the underlying population structure
- Requires no assumptions about spatial correlation

```
Estimate = Σ(weight_i × response_i) / Σ(weight_i)
```

**TrueCover (Model-Based)**

The validity of estimates comes from the model being "true enough":

- Assumes spatial autocorrelation (nearby locations are similar)
- Borrows strength from neighboring observations
- Can predict at unobserved locations
- Requires model assumptions to hold for valid inference

```
Prediction at location x = f(spatial_smooth) + covariates + error
```

### 2.2 Implications

| Criterion | Design-Based (WHO) | Model-Based (TrueCover) |
|-----------|-------------------|-------------------------|
| **Unbiased estimates** | Guaranteed by design | Depends on model fit |
| **Spatial prediction** | Not possible | Core capability |
| **Data efficiency** | Fixed by design | Can adapt to data |
| **Defensibility** | Gold standard for official statistics | Stronger for operational decisions |
| **Regulatory acceptance** | High (established methodology) | Emerging (needs validation) |

---

## 3. Sampling Design Comparison

### 3.1 WHO: Probability Proportional to Estimated Size (PPES)

**How it works:**

1. List all enumeration areas (EAs) with household counts
2. Calculate cumulative household totals
3. Determine sampling interval: `SI = Total_HH / n_clusters`
4. Random start, then systematic selection
5. Larger EAs have higher probability of selection

**Strengths:**
- Mathematically unbiased
- Self-weighting within strata (when combined with equal household selection)
- Reproducible and auditable

**Limitations:**
- Requires complete sampling frame with accurate population estimates
- Fixed design - can't adapt based on interim results
- May miss high-variation areas by chance

### 3.2 TrueCover: Adaptive Uncertainty Sampling

**How it works:**

1. Fit model to existing data
2. Quantify prediction uncertainty at candidate locations
3. Select locations combining:
   - High uncertainty (where model is most uncertain)
   - Spatial dispersion (avoid clustering)
4. Survey selected locations, update model
5. Repeat until uncertainty acceptable

**Selection probability:**
```
P(select_i) ∝ uncertainty_i × min_distance_to_already_selected
```

**Strengths:**
- Optimizes information gain per survey
- Can adapt as data accumulates
- Targets resources to high-uncertainty areas

**Limitations:**
- No guaranteed unbiased population estimate
- Requires initial model (which needs some data)
- Selection probabilities are unknown/model-dependent

### 3.3 Side-by-Side Comparison

| Aspect | WHO PPES | TrueCover Adaptive |
|--------|----------|-------------------|
| **Selection basis** | Population size | Model uncertainty |
| **Probability known?** | Yes (calculable) | No (model-dependent) |
| **Adaptivity** | None (fixed design) | Full (iterative) |
| **Frame requirement** | Complete EA listing | Can work with partial |
| **Sample size** | Fixed before survey | Can grow until satisfied |
| **Spatial efficiency** | Random within design | Optimized for information |

---

## 4. Statistical Inference Approaches

### 4.1 WHO: Survey-Weighted Estimation

The estimator incorporates selection probability through weights:

```
Coverage = Σ(w_i × vaccinated_i) / Σ(w_i)

Where:
  w_i = 1 / P(selection_i)
  P(selection_i) = (n_clusters × HH_cluster) / Total_HH × (1/n_segments)
```

**Variance estimation** accounts for clustering:

```
Var(Coverage) = DEFF × p(1-p) / n_effective
DEFF = 1 + (m-1) × ICC
```

### 4.2 TrueCover: GAM with Gaussian Process

The estimator is a spatial model prediction:

```
logit(coverage_i) = f(lng, lat) + Σ β_j × covariate_j + ε_i

Where:
  f(lng, lat) = Gaussian Process spatial smooth
  ε_i ~ Normal(0, σ²)
```

**Uncertainty** comes from posterior sampling:

```
For s = 1 to 200:
  Draw β* from MVN(β̂, Σ̂)
  Predict coverage* at all locations

BCI = [2.5th percentile, 97.5th percentile] across simulations
```

### 4.3 When Each Approach Excels

| Scenario | Best Approach | Why |
|----------|--------------|-----|
| National coverage estimate for WHO reporting | WHO | Unbiased, defensible, standard methodology |
| Identifying pockets of low coverage | TrueCover | Spatial prediction to unobserved areas |
| Deciding where to survey next | TrueCover | Uncertainty-driven adaptive sampling |
| Comparing coverage between regions | WHO | Design-based inference handles comparisons |
| Creating a coverage map | TrueCover | Only approach that predicts spatially |
| Resource-constrained settings | TrueCover | More efficient use of limited surveys |

---

## 5. Uncertainty Quantification

### 5.1 WHO: Confidence Intervals

Based on normal approximation to the sampling distribution:

```
95% CI = coverage ± 1.96 × SE

SE = sqrt(DEFF × p(1-p) / n)
```

**Design Effect (DEFF)** inflates variance due to clustering:
- If responses within clusters are correlated (ICC > 0), effective sample size decreases
- DEFF = 1 + (cluster_size - 1) × ICC

**Interpretation**: "If we repeated this survey many times, 95% of CIs would contain the true value."

### 5.2 TrueCover: Bayesian Credible Intervals

Based on posterior distribution of model parameters:

```
95% BCI = [2.5th percentile, 97.5th percentile] of posterior samples

BCI_width = upper - lower
```

**Interpretation**: "There is a 95% probability that the true value lies in this interval, given the data and model."

### 5.3 Key Differences

| Aspect | WHO CI | TrueCover BCI |
|--------|--------|---------------|
| **Type** | Frequentist | Bayesian |
| **Interpretation** | Long-run coverage | Probability statement |
| **Depends on** | Sample design, DEFF | Model fit, prior |
| **Location-specific** | No (aggregate only) | Yes (varies spatially) |
| **Incorporates prior info** | No | Yes (through GP) |

### 5.4 Uncertainty Comparison Table

| WHO Term | TrueCover Equivalent | Notes |
|----------|---------------------|-------|
| Standard Error | Posterior SD | Both measure estimate precision |
| 95% CI | 95% BCI | Similar width if model is good |
| Design Effect | (implicit in GP) | GP models spatial correlation directly |
| ICC | GP correlation range | Both capture within-cluster similarity |
| Effective sample size | n_surveys × (1/avg_BCI_width) | Approximate comparison |

---

## 6. Threshold Classification Methods

### 6.1 WHO: Confidence Bound Classification

Given a threshold T (e.g., 80% coverage):

```
LCB = coverage - 1.645 × SE    (95% lower confidence bound)
UCB = coverage + 1.645 × SE    (95% upper confidence bound)

Classification:
  - "High": LCB ≥ T (very likely above threshold)
  - "Low": UCB < T (very likely below threshold)
  - "Inconclusive": otherwise
```

### 6.2 TrueCover: Exceedance Probability

Given a threshold T:

```
exceedance_prob = P(coverage > T | data)
                = proportion of posterior samples > T

exceedance_uncertainty = 0.5 - |exceedance_prob - 0.5|
```

**Classification mapping:**
- exceedance_prob > 0.95 → "High" (analogous to LCB > T)
- exceedance_prob < 0.05 → "Low" (analogous to UCB < T)
- Otherwise → "Uncertain"

### 6.3 Comparison of Classification Approaches

| Aspect | WHO Confidence Bounds | TrueCover Exceedance |
|--------|----------------------|----------------------|
| **Output** | Binary bounds | Continuous probability |
| **Granularity** | 3 categories | Full [0,1] scale |
| **Spatial** | Aggregate only | Location-specific |
| **Adaptive value** | None | High (exceedance_uncertainty drives sampling) |

**Key insight**: TrueCover's `exceedance_uncertainty` provides a natural criterion for adaptive sampling - survey where classification is most uncertain.

---

## 7. How They Complement Each Other

### 7.1 Strengths and Weaknesses

| Strength | WHO | TrueCover |
|----------|-----|-----------|
| Population-level validity | ✓ | |
| Spatial prediction | | ✓ |
| Regulatory acceptance | ✓ | |
| Operational flexibility | | ✓ |
| Fixed sample size planning | ✓ | |
| Adaptive refinement | | ✓ |
| Works without sampling frame | | ✓ |

### 7.2 Natural Division of Labor

```
┌────────────────────────────────────────────────────────────────┐
│                    COMPLEMENTARY WORKFLOW                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STRATEGIC LEVEL (WHO Methodology)                              │
│  ─────────────────────────────────                              │
│  • National/regional coverage estimates for reporting           │
│  • Official statistics and regulatory compliance                │
│  • Comparison between time periods                              │
│  • Sample size justification                                    │
│                                                                 │
│                           ↓                                     │
│                                                                 │
│  OPERATIONAL LEVEL (TrueCover)                                  │
│  ─────────────────────────────                                  │
│  • Identify spatial variation within survey area                │
│  • Prioritize locations for intervention                        │
│  • Guide follow-up surveys in uncertain areas                   │
│  • Create continuous coverage maps for planning                 │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### 7.3 Information Flow

WHO surveys provide **ground truth** data that TrueCover models can use:
- n_trials = household count in cluster
- n_positive = vaccinated children in cluster

TrueCover provides **spatial intelligence** that can inform WHO survey design:
- Where are high-uncertainty areas?
- Which strata need more clusters?
- Where might previous estimates be unreliable?

---

## 8. Adapting TrueCover for Vaccination Coverage

### 8.1 Current TrueCover Functions Applicability

| TrueCover Function | Applicability to Vaccination | Modifications Needed |
|-------------------|------------------------------|----------------------|
| **fn-prevalence-predictor** | High - directly applicable | Minor terminology changes |
| **fn-covariate-extractor** | Medium - useful for prediction | Add health-system covariates |
| **fn-adaptive-sampling** | High - directly applicable | Consider survey logistics |

### 8.2 Using fn-prevalence-predictor for Vaccination

The prevalence predictor can estimate vaccination coverage directly:

**Input mapping:**
```
WHO Data                    →  TrueCover Input
────────────────────────────────────────────────
Cluster centroid            →  Point coordinates
n_children_surveyed         →  n_trials
n_children_vaccinated       →  n_positive
```

**Output interpretation:**
```
TrueCover Output            →  Vaccination Meaning
────────────────────────────────────────────────
prevalence_prediction       →  Predicted coverage (0-1)
prevalence_bci_width        →  Coverage estimate uncertainty
exceedance_probability      →  P(coverage > target threshold)
exceedance_uncertainty      →  Classification uncertainty
```

### 8.3 Using fn-adaptive-sampling for Survey Refinement

After an initial WHO-style cluster survey:

1. **Run prevalence predictor** on survey results
2. **Identify high-uncertainty areas** (high `prevalence_bci_width`)
3. **Use adaptive sampling** to select additional cluster locations
4. **Conduct follow-up surveys** at selected locations
5. **Update model** with combined data

### 8.4 Recommended Covariate Additions

Current TrueCover covariates (bioclim, elevation, distance to water/roads) are environmentally focused. For vaccination coverage, consider adding:

| Covariate | Rationale | Potential Source |
|-----------|-----------|------------------|
| Distance to health facility | Access affects coverage | KEMRI, WHO SARA |
| Population density | Service delivery patterns | WorldPop |
| Travel time to city | Remoteness indicator | Malaria Atlas Project |
| Night-time lights | Development proxy | VIIRS/DMSP |
| Conflict/security index | Access barriers | ACLED, UCDP |
| Previous campaign coverage | Historical predictor | Program data |

### 8.5 Incorporating Survey Weights

**Challenge**: TrueCover currently treats all observations equally. WHO survey data has weights.

**Adaptation options:**

1. **Weighted likelihood in GAM**:
   ```r
   gam(response ~ smooth, weights = survey_weights, ...)
   ```

2. **Replicate observations**: Create pseudo-observations proportional to weights

3. **Two-stage approach**:
   - Use WHO weights for aggregate estimates
   - Use TrueCover for relative spatial patterns only

### 8.6 Handling WHO Data Structures

WHO vaccination surveys collect individual-level data with:
- Vaccination card/history information
- Multiple doses per child
- Valid dose determination

**Aggregation for TrueCover:**
```python
# Convert individual records to cluster-level summary
cluster_summary = (
    survey_data
    .groupby('cluster_id')
    .agg({
        'child_id': 'count',           # n_trials
        'dtp3_valid': 'sum',           # n_positive for DTP3
        'lat': 'first',
        'lng': 'first'
    })
    .rename(columns={'child_id': 'n_trials', 'dtp3_valid': 'n_positive'})
)
```

---

## 9. Integration Scenarios

### 9.1 Scenario A: WHO Survey with TrueCover Analysis

**Use case**: You've completed a WHO cluster survey and want spatial insights.

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  1. Complete WHO cluster survey (45 clusters)                    │
│                     ↓                                             │
│  2. Aggregate to cluster-level: n_trials, n_positive             │
│                     ↓                                             │
│  3. Run fn-prevalence-predictor                                  │
│     - Input: cluster locations + aggregated data                 │
│     - Output: coverage surface + uncertainty                     │
│                     ↓                                             │
│  4. Generate coverage map and identify:                          │
│     - Predicted low-coverage areas                               │
│     - High-uncertainty zones                                     │
│                     ↓                                             │
│  5. Use for:                                                     │
│     - Targeting interventions                                    │
│     - Planning micro-plans                                       │
│     - Identifying areas for follow-up                            │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 Scenario B: TrueCover-Guided Cluster Selection

**Use case**: You're designing a new survey and want to optimize cluster placement.

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  1. Gather existing data (previous surveys, admin data)          │
│                     ↓                                             │
│  2. Run fn-prevalence-predictor to create initial coverage map   │
│                     ↓                                             │
│  3. Calculate sample size per WHO methodology                    │
│     - ESS = 103, DEFF = 3, need 45 clusters                      │
│                     ↓                                             │
│  4. Use fn-adaptive-sampling to suggest cluster locations        │
│     - uncertainty_fieldname = 'prevalence_bci_width'             │
│     - batch_size = 45                                            │
│                     ↓                                             │
│  5. Map suggested locations to actual EAs in sampling frame      │
│                     ↓                                             │
│  6. Conduct survey at selected clusters                          │
│                     ↓                                             │
│  7. Calculate coverage using WHO weighted estimator              │
│     (for official reporting)                                     │
│                                                                   │
│  NOTE: Selection probabilities become model-based, not PPES.     │
│  Official reporting should note methodology deviation.           │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 9.3 Scenario C: Hybrid Iterative Survey

**Use case**: Limited resources, need to optimize data collection.

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  PHASE 1: Initial WHO Survey                                     │
│  ─────────────────────────────                                   │
│  • Select 20 clusters using PPES (minimum for model fitting)     │
│  • Conduct standard survey                                       │
│  • Calculate initial coverage estimate with CI                   │
│                     ↓                                             │
│  PHASE 2: TrueCover Analysis                                     │
│  ───────────────────────────                                     │
│  • Run fn-prevalence-predictor                                   │
│  • Identify high-uncertainty areas                               │
│  • Calculate exceedance uncertainty for target threshold         │
│                     ↓                                             │
│  PHASE 3: Adaptive Refinement                                    │
│  ──────────────────────────                                      │
│  • If uncertainty acceptable → STOP                              │
│  • Otherwise: select 10 more clusters via adaptive sampling      │
│  • Conduct additional surveys                                    │
│                     ↓                                             │
│  PHASE 4: Final Analysis                                         │
│  ───────────────────────                                         │
│  • Update model with all 30 clusters                             │
│  • Generate final coverage map                                   │
│  • Report both:                                                  │
│    - WHO weighted estimate (Phases 1+3 data)                     │
│    - TrueCover spatial predictions                               │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 9.4 Scenario D: Multi-Antigen Coverage Mapping

**Use case**: Survey collects multiple vaccine coverage indicators.

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  For each antigen (DTP3, MCV1, OPV3, etc.):                      │
│                                                                   │
│  1. Aggregate cluster data:                                      │
│     n_trials = children surveyed                                 │
│     n_positive = children with valid dose                        │
│                                                                   │
│  2. Run fn-prevalence-predictor separately                       │
│     → coverage_dtp3, coverage_mcv1, coverage_opv3                │
│                                                                   │
│  3. Calculate dropout rate surfaces:                             │
│     dropout_dtp1_dtp3 = (pred_dtp1 - pred_dtp3) / pred_dtp1     │
│                                                                   │
│  4. Identify:                                                    │
│     - Areas with high dropout (access but not completion)        │
│     - Areas with low coverage all antigens (no access)           │
│     - Antigen-specific gaps (missed opportunities)               │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 10. Recommendations

### 10.1 For Official Coverage Reporting

**Use WHO methodology**

- Regulatory and international reporting requires design-based inference
- Sample size calculations ensure adequate precision
- Survey weights provide unbiased population estimates

**Augment with TrueCover**

- Generate coverage maps for operational planning
- Identify spatial heterogeneity within reported regions
- Target interventions to predicted low-coverage areas

### 10.2 For Operational Decision-Making

**Use TrueCover adaptive approach**

- More efficient use of limited survey resources
- Continuous refinement as data accumulates
- Spatial predictions guide resource allocation

**Validate with WHO principles**

- Ensure some probability-sampled clusters for bias assessment
- Compare model predictions to weighted estimates
- Document methodology deviations

### 10.3 Technical Integration Recommendations

| Integration Point | Recommendation |
|-------------------|----------------|
| **Data format** | Standardize on GeoJSON with WHO-compatible properties |
| **Aggregation** | Define standard cluster-level summary statistics |
| **Weights** | Add optional weight parameter to fn-prevalence-predictor |
| **Thresholds** | Align exceedance thresholds with WHO targets (80%, 90%, 95%) |
| **Covariates** | Add health-system covariates to fn-covariate-extractor |

### 10.4 Future Development Priorities

1. **Survey weight integration**: Modify GAM fitting to incorporate design weights

2. **Multi-stage uncertainty**: Propagate WHO sampling uncertainty through spatial model

3. **Cluster-specific predictions**: Allow predictions to include cluster-level random effects

4. **Validation framework**: Tools to compare TrueCover predictions against WHO estimates

5. **Logistics constraints**: Add travel time and accessibility to adaptive sampling

### 10.5 When to Use Each Approach

| Situation | Recommended Approach |
|-----------|---------------------|
| National immunization coverage report | WHO cluster survey |
| Identifying underserved communities | TrueCover spatial prediction |
| Campaign micro-planning | TrueCover coverage maps |
| Evaluating campaign impact | WHO pre/post survey |
| Real-time coverage monitoring | TrueCover with admin data |
| Supplementary survey design | TrueCover adaptive sampling |

---

## Appendix: Terminology Mapping

| WHO Term | TrueCover Equivalent |
|----------|---------------------|
| Enumeration area (EA) | Point feature |
| Stratum | - (implicit in spatial model) |
| Cluster | Survey location |
| Design effect (DEFF) | (modeled via GP correlation) |
| ICC | GP correlation range parameter |
| Effective sample size | Inverse of avg(BCI_width) |
| Confidence interval | Bayesian credible interval |
| Lower confidence bound | exceedance_prob threshold |
| Coverage proportion | prevalence_prediction |
| Survey weight | - (not currently used) |

---

## References

- WHO (2015). Vaccination Coverage Cluster Surveys: Reference Manual. Version 3.
- Wood, S.N. (2017). Generalized Additive Models: An Introduction with R. 2nd ed.
- Diggle, P.J. & Giorgi, E. (2019). Model-Based Geostatistics for Global Public Health.
- Lumley, T. (2010). Complex Surveys: A Guide to Analysis Using R.
