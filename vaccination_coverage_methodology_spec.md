# Vaccination Coverage Cluster Survey Methodology
## Technical Specification Document

**Version:** 1.0  
**Based on:** WHO Vaccination Coverage Cluster Surveys Reference Manual (Version 3, 2015)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Survey Design Framework](#2-survey-design-framework)
3. [Sample Size Calculations](#3-sample-size-calculations)
4. [Cluster Selection Algorithm (PPES)](#4-cluster-selection-algorithm-ppes)
5. [Survey Weights Calculation](#5-survey-weights-calculation)
6. [Coverage Estimation](#6-coverage-estimation)
7. [Confidence Intervals](#7-confidence-intervals)
8. [Classification of Coverage](#8-classification-of-coverage)
9. [Valid Dose Determination](#9-valid-dose-determination)
10. [Dropout Rate Calculations](#10-dropout-rate-calculations)
11. [Missed Opportunities Analysis](#11-missed-opportunities-analysis)
12. [Python Implementation](#12-python-implementation)

---

## 1. Overview

This specification documents the algorithms and calculations used in WHO-recommended vaccination coverage cluster surveys. The methodology employs a **stratified two-stage cluster sampling design** where:

- **Stage 1**: Clusters (enumeration areas) are selected with Probability Proportional to Estimated Size (PPES)
- **Stage 2**: All eligible individuals within selected cluster segments are interviewed

### Key Concepts

| Term | Definition |
|------|------------|
| **Stratum** | Geographic unit for which separate estimates are required (e.g., province, district) |
| **Cluster** | Primary Sampling Unit (PSU), typically a census enumeration area |
| **Segment** | Subdivision of a large cluster to limit household visits |
| **Design Effect (DEFF)** | Inflation factor accounting for clustering in sample design |
| **ICC** | Intracluster Correlation Coefficient - correlation of responses within clusters |

---

## 2. Survey Design Framework

### 2.1 Survey Goals

Three primary types of survey questions:

1. **Estimation**: "What is the coverage?" → Point estimate with confidence interval
2. **Comparison**: "Is coverage different between groups/time points?" → Hypothesis testing
3. **Classification**: "Is coverage above/below a threshold?" → One-sided confidence bounds

### 2.2 Target Population

Standard target populations:

- **Routine immunization**: Children aged 12-23 months (completed primary series)
- **SIA coverage**: Age range targeted by the campaign
- **Tetanus**: Women who gave birth in the last 12 months

### 2.3 Key Parameters

```
A = Number of strata (geographic units)
B = Effective Sample Size (ESS) per stratum
C = Design Effect (DEFF)
D = Average households to visit per eligible child
E = Non-response inflation factor
m = Target respondents per cluster
```

---

## 3. Sample Size Calculations

### 3.1 Effective Sample Size (ESS) Formula

For a simple random sample estimating a proportion `p` with desired precision `d`:

```
ESS = z² × p × (1-p) / d²
```

Where:
- `z` = Z-score for desired confidence level (1.96 for 95% CI)
- `p` = Expected proportion (coverage estimate, use 0.5 if unknown)
- `d` = Desired half-width of confidence interval (precision)

### 3.2 Design Effect (DEFF) Formula

```
DEFF = 1 + (m - 1) × ICC
```

Where:
- `m` = Average number of respondents per cluster
- `ICC` = Intracluster Correlation Coefficient

**Typical ICC Values:**
- Post-campaign surveys: 1/24 to 1/6 (0.042 to 0.167)
- Routine immunization surveys: 1/6 to 1/3 (0.167 to 0.333)

### 3.3 Total Sample Size Calculations

```
Total target respondents = A × B × C

Number of clusters per stratum = (B × C) / m

Households to visit per cluster = D × E × m

Total households to visit = A × B × C × D × E
```

### 3.4 Households per Eligible Child (D)

Calculate the expected number of households to visit to find one eligible child:

```
N_survived_per_HH = (YC × BR / (1000/HS)) × ((1000 - IM) / 1000)

D = 1 / N_survived_per_HH
```

Where:
- `YC` = Years in eligible cohort (typically 1)
- `BR` = Birth rate per 1000 population
- `HS` = Average household size
- `IM` = Infant mortality rate per 1000 live births

### 3.5 Non-Response Inflation (E)

```
E = 1 / (1 - expected_non_response_rate)
```

Example: 10% expected non-response → E = 1.11

### 3.6 Worked Example

**Goal**: Estimate national coverage with ±10% precision at 50% coverage

```python
# Parameters
p = 0.50           # Expected coverage
d = 0.10           # Desired precision (±10%)
z = 1.96           # 95% confidence
ICC = 1/3          # Conservative ICC for routine immunization
m = 7              # Target respondents per cluster
D = 5              # Households per eligible child
non_response = 0.10

# Calculations
ESS = (z**2 * p * (1-p)) / d**2  # = 96.04, round to 103
DEFF = 1 + (m - 1) * ICC         # = 3.0

E = 1 / (1 - non_response)        # = 1.11

total_respondents = 1 * 103 * 3   # = 309
n_clusters = (103 * 3) / 7        # = 44.1, round to 45
households_per_cluster = D * E * m # = 38.85, round to 40
total_households = 309 * 5 * 1.11 # = 1,715
```

---

## 4. Cluster Selection Algorithm (PPES)

### 4.1 Systematic Sampling with PPES

Probability Proportional to Estimated Size (PPES) ensures larger clusters have proportionally higher probability of selection.

### 4.2 Algorithm Steps

1. **Prepare the sampling frame**: List all enumeration areas (EAs) with estimated households
2. **Sort for implicit stratification**: Order EAs by urban/rural status (and other strata)
3. **Calculate cumulative households**: Running sum of household counts
4. **Handle extreme sizes**:
   - Combine small EAs (< target households per cluster) with neighbors
   - Split large EAs (> sampling interval) into segments
5. **Calculate sampling interval**: `SI = Total_HH / n_clusters`
6. **Select random start**: Random number between 1 and SI
7. **Systematic selection**: Select clusters at positions: start, start+SI, start+2×SI, ...

### 4.3 Cluster Selection Pseudocode

```
Input:
    - frame: List of (EA_id, n_households, cumulative_HH)
    - n_clusters: Number of clusters to select
    - sampling_interval: Total_HH / n_clusters

Algorithm:
    random_start = random_integer(1, sampling_interval)
    selected_clusters = []
    
    for i in range(n_clusters):
        target_HH = random_start + (i * sampling_interval)
        
        for ea in frame:
            if ea.cumulative_HH >= target_HH:
                selected_clusters.append(ea.EA_id)
                break
    
    return selected_clusters
```

### 4.4 Segmentation

When selected cluster is too large:

```
n_segments = ceiling(cluster_households / target_households_per_cluster)

For each segment:
    probability_of_selection = 1 / n_segments
```

---

## 5. Survey Weights Calculation

### 5.1 Base Sampling Weight

For a respondent `i` in cluster `c` and segment `s`:

```
Sampling_Weight_i = 1 / P(respondent i selected)

P(selected) = P(cluster selected) × P(segment selected | cluster)
```

### 5.2 Probability of Cluster Selection (PPES)

```
P(cluster c selected) = (n_clusters × HH_c) / Total_HH

Where:
    n_clusters = number of clusters to select in stratum
    HH_c = number of households in cluster c
    Total_HH = total households in stratum
```

### 5.3 Probability with Segmentation

```
P(selected) = P(cluster) × P(segment)
            = (n_clusters × HH_c / Total_HH) × (1 / n_segments)
```

### 5.4 Sampling Weight Formula

```
Weight_i = Total_HH / (n_clusters × HH_c × (1/n_segments))
         = Total_HH × n_segments / (n_clusters × HH_c)
```

### 5.5 Non-Response Adjustment

Adjust weights to account for non-responding households:

```
Adjusted_Weight = Base_Weight × (n_eligible_HH / n_responding_HH)
```

### 5.6 Post-Stratification

Scale weights to match known population totals:

```
Scaled_Weight_i = Unscaled_Weight_i × (Known_Population_Stratum / Sum_Unscaled_Weights_Stratum)
```

---

## 6. Coverage Estimation

### 6.1 Weighted Coverage Proportion

The survey-weighted coverage estimate:

```
p_hat = Σ(w_i × y_i) / Σ(w_i)

Where:
    w_i = survey weight for respondent i
    y_i = 1 if vaccinated, 0 otherwise
```

### 6.2 Types of Coverage Estimates

| Type | Definition |
|------|------------|
| **Crude by Survey** | All doses, any source (card/register/history), by survey time |
| **Crude by Age 12m** | All doses received before 12 months of age |
| **Valid by Age 12m** | Only valid doses (correct age/intervals) received before 12 months |
| **Card-Only** | Only documented vaccinations (card or register) |

### 6.3 Resolving Data Conflicts

When multiple sources disagree, apply this hierarchy:

1. Card with date (highest priority)
2. Register with date
3. Card without date (tick mark)
4. Register without date
5. Caretaker recall (lowest priority)

**Rule**: If any documented source shows vaccination, count as vaccinated for coverage.

---

## 7. Confidence Intervals

### 7.1 Standard Error for Cluster Surveys

The variance of the weighted proportion:

```
Var(p_hat) = DEFF × (p_hat × (1 - p_hat)) / n_eff

Where:
    n_eff = effective sample size = n / DEFF
    n = total respondents
```

### 7.2 95% Confidence Interval

Using the modified Clopper-Pearson method (recommended for conservative intervals):

```
SE = sqrt(Var(p_hat))

95% CI = (p_hat - 1.96 × SE, p_hat + 1.96 × SE)
```

### 7.3 Confidence Bounds for Classification

- **95% Lower Confidence Bound (LCB)**: p_hat - 1.645 × SE
- **95% Upper Confidence Bound (UCB)**: p_hat + 1.645 × SE

(Note: One-sided bounds use z=1.645 for 95% confidence)

---

## 8. Classification of Coverage

### 8.1 Classification Rules

Given a programmatic threshold `T` (e.g., 80% or 95%):

1. **Coverage Very Likely ≥ T**: 95% LCB ≥ T
2. **Coverage Very Likely < T**: 95% UCB < T  
3. **Inconclusive**: LCB < T and UCB ≥ T

### 8.2 Sample Size for Classification

To classify with confidence when true coverage is `delta` points from threshold:

```
ESS = f(threshold, delta, alpha, beta)
```

The required ESS increases dramatically as `delta` approaches zero.

| True Coverage Distance from Threshold | Approximate ESS Needed |
|--------------------------------------|------------------------|
| 15 percentage points | ~45-100 |
| 10 percentage points | ~100-250 |
| 5 percentage points | ~400-1000 |
| 1 percentage point | ~10,000+ |

---

## 9. Valid Dose Determination

### 9.1 Validity Criteria

A dose is **valid** if administered:

1. **At or after minimum age**:
   - DTPCV/OPV/PCV/RV first dose: ≥ 6 weeks (42 days, or 36 with 4-day grace)
   - MCV1: ≥ 9 months (266 days)
   - BCG: at birth

2. **With minimum interval** since previous dose:
   - DTPCV, OPV, PCV, RV: ≥ 28 days between doses

### 9.2 Valid Dose Algorithm

```
For each dose in sequence (dose_1, dose_2, dose_3):
    
    if dose_number == 1:
        valid = (vaccination_date - birth_date) >= minimum_age
    else:
        age_valid = (vaccination_date - birth_date) >= minimum_age
        interval_valid = (vaccination_date - previous_valid_dose_date) >= min_interval
        valid = age_valid AND interval_valid
    
    if NOT valid:
        # Shift subsequent valid doses down
        # This dose is dropped; next valid dose becomes this position
```

### 9.3 Dose Shifting Example

Child receives DTP at weeks 7, 10, 14:

```
Week 7 (49 days): Valid for DTP1 (≥42 days from birth)
Week 10 (70 days): INVALID (only 21 days since DTP1, need 28)
Week 14 (98 days): Valid, but shifted to DTP2 position (49 days since DTP1)

Result: Child has valid DTP1 and DTP2, but NOT DTP3
```

---

## 10. Dropout Rate Calculations

### 10.1 Dropout Rate Formula

```
Dropout_Rate = (Coverage_Early - Coverage_Late) / Coverage_Early × 100

Example:
    DTP1-DTP3 Dropout = (DTP1_coverage - DTP3_coverage) / DTP1_coverage × 100
```

### 10.2 Key Dropout Indicators

| Dropout Pair | Interpretation |
|--------------|----------------|
| BCG → MCV1 | Overall program retention |
| DTP1 → DTP3 | Multi-dose completion |
| DTP1 → MCV1 | Full schedule completion |
| DTP3 → MCV1 | Late schedule access |

### 10.3 Negative Dropout

A negative dropout rate indicates coverage for the later dose exceeds the earlier dose - this can occur with:
- Supplementary immunization activities (SIAs)
- Catch-up campaigns
- Data quality issues

---

## 11. Missed Opportunities Analysis

### 11.1 Definition

A **Missed Opportunity for Vaccination (MOV)** occurs when a child visits a health facility and is eligible for a vaccine but does not receive it.

### 11.2 Visit-Based Analysis

**VB1**: Proportion of visits with MOV for each vaccine
```
VB1_vaccine = Visits_with_MOV_vaccine / Total_eligible_visits × 100
```

**VB2**: Proportion of visits with at least one MOV (any vaccine)
```
VB2 = Visits_with_any_MOV / Total_visits × 100
```

**VB3**: Rate of MOVs per visit
```
VB3 = Total_MOVs / Total_visits
```

### 11.3 Child-Based Analysis

**CB1**: Proportion of children with at least one MOV for each vaccine
```
CB1_vaccine = Children_with_MOV_vaccine / Children_with_eligible_visits × 100
```

**CB2**: Proportion of children with at least one MOV (any vaccine)
```
CB2 = Children_with_any_MOV / Children_with_documentation × 100
```

### 11.4 Potential Coverage Calculation

Coverage achievable if no MOVs had occurred:

```
Potential_Coverage = (Current_Vaccinated + Children_with_uncorrected_MOV) / Total_Children × 100
```

---

## 12. Python Implementation

### 12.1 Core Data Structures

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from datetime import date
import numpy as np


@dataclass
class VaccinationRecord:
    """Single vaccination record for a child"""
    vaccine: str           # e.g., 'DTP', 'OPV', 'MCV'
    dose_number: int       # 1, 2, 3, etc.
    date: Optional[date]   # Date of vaccination
    source: str            # 'card', 'register', 'history'
    
    
@dataclass
class Child:
    """Survey respondent record"""
    child_id: str
    birth_date: date
    cluster_id: str
    stratum_id: str
    household_id: str
    weight: float
    vaccinations: List[VaccinationRecord]


@dataclass
class Cluster:
    """Census enumeration area / cluster"""
    cluster_id: str
    stratum_id: str
    n_households: int
    cumulative_households: int = 0
    is_urban: bool = False
    segment_id: Optional[int] = None
    n_segments: int = 1
```

### 12.2 Sample Size Calculator

```python
class SampleSizeCalculator:
    """Calculate required sample size for vaccination coverage survey"""
    
    def __init__(self):
        self.z_95 = 1.96      # Z-score for 95% CI
        self.z_90 = 1.645     # Z-score for 90% CI / one-sided 95%
        
    def effective_sample_size(
        self,
        precision: float,
        expected_coverage: float = 0.5,
        confidence: float = 0.95
    ) -> int:
        """
        Calculate effective sample size for estimation.
        
        Args:
            precision: Desired half-width of CI (e.g., 0.05 for ±5%)
            expected_coverage: Expected coverage proportion (0-1)
            confidence: Confidence level (default 0.95)
            
        Returns:
            Effective sample size (integer)
        """
        z = self.z_95 if confidence == 0.95 else 1.645
        p = expected_coverage
        
        ess = (z ** 2 * p * (1 - p)) / (precision ** 2)
        return int(np.ceil(ess))
    
    def design_effect(
        self,
        respondents_per_cluster: int,
        icc: float
    ) -> float:
        """
        Calculate design effect for cluster sampling.
        
        Args:
            respondents_per_cluster: Target m value
            icc: Intracluster correlation coefficient
            
        Returns:
            Design effect (DEFF)
        """
        return 1 + (respondents_per_cluster - 1) * icc
    
    def households_per_eligible_child(
        self,
        birth_rate_per_1000: float,
        household_size: float,
        infant_mortality_per_1000: float = 0,
        cohort_years: float = 1.0
    ) -> float:
        """
        Calculate expected households to visit per eligible child.
        
        Args:
            birth_rate_per_1000: Annual births per 1000 population
            household_size: Average persons per household
            infant_mortality_per_1000: Infant deaths per 1000 live births
            cohort_years: Years in eligible age cohort (default 1)
            
        Returns:
            Average households per eligible child
        """
        births_per_hh = (cohort_years * birth_rate_per_1000) / (1000 / household_size)
        survived_per_hh = births_per_hh * (1 - infant_mortality_per_1000 / 1000)
        
        return 1 / survived_per_hh if survived_per_hh > 0 else float('inf')
    
    def total_sample_size(
        self,
        n_strata: int,
        ess: int,
        deff: float,
        households_per_child: float,
        non_response_rate: float = 0.10,
        respondents_per_cluster: int = 7
    ) -> Dict[str, float]:
        """
        Calculate complete sample size requirements.
        
        Args:
            n_strata: Number of geographic strata
            ess: Effective sample size per stratum
            deff: Design effect
            households_per_child: Average households per eligible child
            non_response_rate: Expected proportion of non-response
            respondents_per_cluster: Target respondents per cluster (m)
            
        Returns:
            Dictionary with all sample size components
        """
        # Non-response inflation factor
        e = 1 / (1 - non_response_rate)
        
        # Core calculations
        total_respondents = n_strata * ess * deff
        n_clusters_per_stratum = (ess * deff) / respondents_per_cluster
        households_per_cluster = households_per_child * e * respondents_per_cluster
        total_households = total_respondents * households_per_child * e
        total_clusters = n_strata * n_clusters_per_stratum
        
        return {
            'n_strata': n_strata,
            'ess_per_stratum': ess,
            'design_effect': deff,
            'non_response_factor': e,
            'total_respondents': int(np.ceil(total_respondents)),
            'clusters_per_stratum': int(np.ceil(n_clusters_per_stratum)),
            'total_clusters': int(np.ceil(total_clusters)),
            'households_per_cluster': int(np.ceil(households_per_cluster)),
            'total_households': int(np.ceil(total_households))
        }
```

### 12.3 Cluster Selection (PPES Algorithm)

```python
import random
from typing import Tuple


class PPESClusterSelector:
    """
    Systematic sampling with Probability Proportional to Estimated Size (PPES)
    """
    
    def __init__(self, seed: Optional[int] = None):
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)
    
    def prepare_sampling_frame(
        self,
        clusters: List[Cluster],
        target_households_per_cluster: int = 40
    ) -> List[Cluster]:
        """
        Prepare sampling frame: sort, combine small clusters, split large ones.
        
        Args:
            clusters: List of cluster objects
            target_households_per_cluster: Target households to visit per cluster
            
        Returns:
            Processed list of clusters ready for selection
        """
        # Sort by stratum, then urban/rural, then cluster_id
        clusters = sorted(clusters, key=lambda c: (c.stratum_id, not c.is_urban, c.cluster_id))
        
        # Calculate cumulative households
        cumulative = 0
        for cluster in clusters:
            cumulative += cluster.n_households
            cluster.cumulative_households = cumulative
            
        return clusters
    
    def calculate_sampling_interval(
        self,
        clusters: List[Cluster],
        n_clusters_to_select: int
    ) -> float:
        """
        Calculate the sampling interval for systematic selection.
        
        Args:
            clusters: Prepared sampling frame
            n_clusters_to_select: Number of clusters to select
            
        Returns:
            Sampling interval
        """
        total_households = clusters[-1].cumulative_households
        return total_households / n_clusters_to_select
    
    def select_clusters(
        self,
        clusters: List[Cluster],
        n_clusters_to_select: int
    ) -> Tuple[List[Cluster], int, float]:
        """
        Select clusters using systematic PPES sampling.
        
        Args:
            clusters: Prepared sampling frame
            n_clusters_to_select: Number of clusters to select
            
        Returns:
            Tuple of (selected clusters, random start, sampling interval)
        """
        sampling_interval = self.calculate_sampling_interval(clusters, n_clusters_to_select)
        random_start = random.randint(1, int(sampling_interval))
        
        selected = []
        for i in range(n_clusters_to_select):
            target_household = random_start + (i * sampling_interval)
            
            for cluster in clusters:
                if cluster.cumulative_households >= target_household:
                    selected.append(cluster)
                    break
                    
        return selected, random_start, sampling_interval
    
    def calculate_selection_probability(
        self,
        cluster: Cluster,
        total_households: int,
        n_clusters_selected: int
    ) -> float:
        """
        Calculate probability that a cluster was selected.
        
        Args:
            cluster: Cluster object
            total_households: Total households in sampling frame
            n_clusters_selected: Number of clusters selected
            
        Returns:
            Selection probability
        """
        base_prob = (n_clusters_selected * cluster.n_households) / total_households
        segment_prob = 1 / cluster.n_segments if cluster.n_segments > 1 else 1
        
        return base_prob * segment_prob
```

### 12.4 Survey Weights Calculator

```python
class WeightCalculator:
    """Calculate and adjust survey weights"""
    
    def __init__(
        self,
        total_households_by_stratum: Dict[str, int],
        n_clusters_by_stratum: Dict[str, int]
    ):
        """
        Initialize weight calculator.
        
        Args:
            total_households_by_stratum: Total HH in each stratum's sampling frame
            n_clusters_by_stratum: Number of clusters selected per stratum
        """
        self.total_hh = total_households_by_stratum
        self.n_clusters = n_clusters_by_stratum
    
    def base_weight(
        self,
        stratum_id: str,
        cluster_households: int,
        n_segments: int = 1
    ) -> float:
        """
        Calculate base sampling weight for a respondent.
        
        Args:
            stratum_id: Stratum identifier
            cluster_households: Households in the cluster
            n_segments: Number of segments if cluster was divided
            
        Returns:
            Base sampling weight
        """
        total_hh = self.total_hh[stratum_id]
        n_clusters = self.n_clusters[stratum_id]
        
        # Inverse of selection probability
        selection_prob = (n_clusters * cluster_households / total_hh) * (1 / n_segments)
        
        return 1 / selection_prob
    
    def adjust_for_nonresponse(
        self,
        base_weight: float,
        n_eligible_households: int,
        n_responding_households: int
    ) -> float:
        """
        Adjust weight for non-response within cluster.
        
        Args:
            base_weight: Base sampling weight
            n_eligible_households: Households with eligible children
            n_responding_households: Households that completed survey
            
        Returns:
            Non-response adjusted weight
        """
        if n_responding_households == 0:
            return 0
        
        adjustment = n_eligible_households / n_responding_households
        return base_weight * adjustment
    
    def post_stratify(
        self,
        weights: List[float],
        stratum_ids: List[str],
        known_population: Dict[str, int]
    ) -> List[float]:
        """
        Post-stratify weights to match known population totals.
        
        Args:
            weights: List of current weights
            stratum_ids: Stratum ID for each weight
            known_population: Known eligible population by stratum
            
        Returns:
            Post-stratified weights
        """
        # Sum weights by stratum
        stratum_weight_sums = {}
        for w, s in zip(weights, stratum_ids):
            stratum_weight_sums[s] = stratum_weight_sums.get(s, 0) + w
        
        # Calculate scaling factors
        scaling_factors = {
            s: known_population[s] / stratum_weight_sums[s]
            for s in stratum_weight_sums
        }
        
        # Apply scaling
        return [w * scaling_factors[s] for w, s in zip(weights, stratum_ids)]
```

### 12.5 Coverage Calculator

```python
class CoverageCalculator:
    """Calculate vaccination coverage and confidence intervals"""
    
    def weighted_coverage(
        self,
        vaccinated: List[int],  # 0 or 1 for each child
        weights: List[float]
    ) -> float:
        """
        Calculate weighted coverage proportion.
        
        Args:
            vaccinated: Binary indicator (1=vaccinated, 0=not)
            weights: Survey weights for each respondent
            
        Returns:
            Weighted coverage proportion (0-1)
        """
        numerator = sum(v * w for v, w in zip(vaccinated, weights))
        denominator = sum(weights)
        
        return numerator / denominator if denominator > 0 else 0
    
    def estimate_deff(
        self,
        vaccinated: List[int],
        weights: List[float],
        cluster_ids: List[str]
    ) -> float:
        """
        Estimate design effect from survey data.
        
        Args:
            vaccinated: Binary indicator for each respondent
            weights: Survey weights
            cluster_ids: Cluster ID for each respondent
            
        Returns:
            Estimated design effect
        """
        # Overall coverage
        p = self.weighted_coverage(vaccinated, weights)
        
        # Cluster-level variances
        clusters = {}
        for v, w, c in zip(vaccinated, weights, cluster_ids):
            if c not in clusters:
                clusters[c] = {'vaccinated': [], 'weights': []}
            clusters[c]['vaccinated'].append(v)
            clusters[c]['weights'].append(w)
        
        # Within-cluster variance
        within_var = sum(
            w * (v - p) ** 2 
            for v, w in zip(vaccinated, weights)
        ) / sum(weights)
        
        # Simple random sample variance
        srs_var = p * (1 - p) / len(vaccinated)
        
        return within_var / srs_var if srs_var > 0 else 1
    
    def confidence_interval(
        self,
        coverage: float,
        n_effective: int,
        confidence: float = 0.95
    ) -> Tuple[float, float]:
        """
        Calculate confidence interval for coverage estimate.
        
        Args:
            coverage: Point estimate (0-1)
            n_effective: Effective sample size (n/DEFF)
            confidence: Confidence level (default 0.95)
            
        Returns:
            Tuple of (lower bound, upper bound)
        """
        from scipy import stats
        
        z = stats.norm.ppf(1 - (1 - confidence) / 2)
        se = np.sqrt(coverage * (1 - coverage) / n_effective)
        
        lower = max(0, coverage - z * se)
        upper = min(1, coverage + z * se)
        
        return (lower, upper)
    
    def confidence_bounds(
        self,
        coverage: float,
        n_effective: int,
        confidence: float = 0.95
    ) -> Tuple[float, float]:
        """
        Calculate one-sided confidence bounds for classification.
        
        Args:
            coverage: Point estimate (0-1)
            n_effective: Effective sample size
            confidence: Confidence level (default 0.95)
            
        Returns:
            Tuple of (lower confidence bound, upper confidence bound)
        """
        from scipy import stats
        
        z = stats.norm.ppf(confidence)  # One-sided
        se = np.sqrt(coverage * (1 - coverage) / n_effective)
        
        lcb = max(0, coverage - z * se)
        ucb = min(1, coverage + z * se)
        
        return (lcb, ucb)
    
    def classify_coverage(
        self,
        coverage: float,
        n_effective: int,
        threshold: float,
        confidence: float = 0.95
    ) -> str:
        """
        Classify coverage relative to threshold.
        
        Args:
            coverage: Point estimate (0-1)
            n_effective: Effective sample size
            threshold: Programmatic threshold (0-1)
            confidence: Confidence level
            
        Returns:
            Classification: 'high', 'low', or 'inconclusive'
        """
        lcb, ucb = self.confidence_bounds(coverage, n_effective, confidence)
        
        if lcb >= threshold:
            return 'high'  # Coverage very likely >= threshold
        elif ucb < threshold:
            return 'low'   # Coverage very likely < threshold
        else:
            return 'inconclusive'
```

### 12.6 Valid Dose Validator

```python
from datetime import timedelta


class ValidDoseValidator:
    """Validate vaccination doses per WHO criteria"""
    
    # Minimum ages in days
    MIN_AGES = {
        'BCG': 0,
        'OPV0': 0,
        'HepB0': 0,
        'DTP1': 42,   # 6 weeks
        'DTP2': 70,   # 10 weeks
        'DTP3': 98,   # 14 weeks
        'OPV1': 42,
        'OPV2': 70,
        'OPV3': 98,
        'PCV1': 42,
        'PCV2': 70,
        'PCV3': 98,
        'RV1': 42,
        'RV2': 70,
        'RV3': 98,
        'MCV1': 266,  # 9 months (38 weeks)
        'MCV2': 456,  # 15 months
        'YF': 266,
    }
    
    # Minimum interval between doses (days)
    MIN_INTERVAL = 28
    
    # Grace period (days before minimum age still considered valid)
    GRACE_PERIOD = 4
    
    def __init__(self, grace_period: int = 4):
        self.grace_period = grace_period
    
    def is_valid_dose(
        self,
        vaccine: str,
        dose_number: int,
        vaccination_date: date,
        birth_date: date,
        previous_dose_date: Optional[date] = None
    ) -> Tuple[bool, str]:
        """
        Check if a dose is valid per WHO criteria.
        
        Args:
            vaccine: Vaccine type (e.g., 'DTP')
            dose_number: Dose number (1, 2, 3, etc.)
            vaccination_date: Date vaccine was administered
            birth_date: Child's birth date
            previous_dose_date: Date of previous dose (for multi-dose vaccines)
            
        Returns:
            Tuple of (is_valid, reason)
        """
        # Calculate age at vaccination
        age_days = (vaccination_date - birth_date).days
        
        # Get minimum age for this vaccine-dose
        vaccine_key = f"{vaccine}{dose_number}" if dose_number > 0 else vaccine
        min_age = self.MIN_AGES.get(vaccine_key, self.MIN_AGES.get(f"{vaccine}1", 0))
        
        # Check age validity (with grace period)
        if age_days < (min_age - self.grace_period):
            return False, f"Too young: {age_days} days, minimum {min_age - self.grace_period}"
        
        # Check interval for doses > 1
        if dose_number > 1 and previous_dose_date is not None:
            interval = (vaccination_date - previous_dose_date).days
            min_interval = self.MIN_INTERVAL - self.grace_period
            
            if interval < min_interval:
                return False, f"Interval too short: {interval} days, minimum {min_interval}"
        
        return True, "Valid"
    
    def validate_series(
        self,
        vaccine: str,
        doses: List[VaccinationRecord],
        birth_date: date
    ) -> List[Tuple[VaccinationRecord, bool, int]]:
        """
        Validate a series of doses, shifting invalid doses down.
        
        Args:
            vaccine: Vaccine type
            doses: List of vaccination records (sorted by date)
            birth_date: Child's birth date
            
        Returns:
            List of (record, is_valid, assigned_dose_number)
        """
        # Sort doses by date
        sorted_doses = sorted(
            [d for d in doses if d.date is not None],
            key=lambda x: x.date
        )
        
        results = []
        valid_dose_count = 0
        last_valid_date = None
        
        for record in sorted_doses:
            target_dose = valid_dose_count + 1
            
            is_valid, reason = self.is_valid_dose(
                vaccine=vaccine,
                dose_number=target_dose,
                vaccination_date=record.date,
                birth_date=birth_date,
                previous_dose_date=last_valid_date
            )
            
            if is_valid:
                valid_dose_count += 1
                last_valid_date = record.date
                results.append((record, True, valid_dose_count))
            else:
                results.append((record, False, 0))
        
        return results
```

### 12.7 Dropout Calculator

```python
class DropoutCalculator:
    """Calculate dropout rates between vaccine doses"""
    
    def dropout_rate(
        self,
        coverage_early: float,
        coverage_late: float
    ) -> float:
        """
        Calculate dropout rate between two doses.
        
        Args:
            coverage_early: Coverage for earlier dose (e.g., DTP1)
            coverage_late: Coverage for later dose (e.g., DTP3)
            
        Returns:
            Dropout rate as proportion (0-1)
        """
        if coverage_early == 0:
            return 0
        
        return (coverage_early - coverage_late) / coverage_early
    
    def weighted_dropout(
        self,
        early_vaccinated: List[int],
        late_vaccinated: List[int],
        weights: List[float]
    ) -> Dict[str, float]:
        """
        Calculate weighted dropout with confidence interval.
        
        Args:
            early_vaccinated: Binary indicator for early dose
            late_vaccinated: Binary indicator for late dose
            weights: Survey weights
            
        Returns:
            Dictionary with dropout rate and coverage values
        """
        calc = CoverageCalculator()
        
        early_cov = calc.weighted_coverage(early_vaccinated, weights)
        late_cov = calc.weighted_coverage(late_vaccinated, weights)
        
        dropout = self.dropout_rate(early_cov, late_cov)
        
        return {
            'early_coverage': early_cov,
            'late_coverage': late_cov,
            'dropout_rate': dropout,
            'dropout_pct': dropout * 100
        }
    
    def standard_dropout_indicators(
        self,
        children: List[Child]
    ) -> Dict[str, Dict]:
        """
        Calculate all standard dropout indicators.
        
        Args:
            children: List of Child objects with vaccination records
            
        Returns:
            Dictionary of dropout indicators
        """
        indicators = [
            ('BCG', 'MCV1', 'BCG to MCV1'),
            ('DTP1', 'DTP3', 'DTP1 to DTP3'),
            ('DTP1', 'MCV1', 'DTP1 to MCV1'),
            ('DTP3', 'MCV1', 'DTP3 to MCV1'),
            ('OPV1', 'OPV3', 'OPV1 to OPV3'),
        ]
        
        results = {}
        weights = [c.weight for c in children]
        
        for early, late, name in indicators:
            early_vax = [self._has_vaccine(c, early) for c in children]
            late_vax = [self._has_vaccine(c, late) for c in children]
            
            results[name] = self.weighted_dropout(early_vax, late_vax, weights)
        
        return results
    
    def _has_vaccine(self, child: Child, vaccine_dose: str) -> int:
        """Check if child has a specific vaccine-dose combination"""
        for vax in child.vaccinations:
            if f"{vax.vaccine}{vax.dose_number}" == vaccine_dose:
                return 1
            if vax.vaccine == vaccine_dose:  # For single-dose vaccines
                return 1
        return 0
```

### 12.8 Complete Survey Pipeline Example

```python
def run_coverage_survey_analysis(
    children: List[Child],
    clusters: List[Cluster],
    stratum_populations: Dict[str, int],
    vaccine_doses: List[str]
) -> Dict:
    """
    Complete pipeline for analyzing vaccination coverage survey data.
    
    Args:
        children: List of surveyed children
        clusters: List of clusters in survey
        stratum_populations: Known population by stratum
        vaccine_doses: List of vaccine-dose combinations to analyze
        
    Returns:
        Complete analysis results
    """
    # Initialize calculators
    weight_calc = WeightCalculator(
        total_households_by_stratum={c.stratum_id: sum(
            cl.n_households for cl in clusters if cl.stratum_id == c.stratum_id
        ) for c in clusters},
        n_clusters_by_stratum={c.stratum_id: len([
            cl for cl in clusters if cl.stratum_id == c.stratum_id
        ]) for c in clusters}
    )
    
    coverage_calc = CoverageCalculator()
    validator = ValidDoseValidator()
    dropout_calc = DropoutCalculator()
    
    results = {
        'coverage': {},
        'classification': {},
        'dropout': {},
        'sample_description': {
            'n_children': len(children),
            'n_clusters': len(clusters),
            'n_strata': len(set(c.stratum_id for c in clusters))
        }
    }
    
    # Calculate weights (simplified - would need cluster info per child)
    weights = [c.weight for c in children]
    
    # Post-stratify weights
    stratum_ids = [c.stratum_id for c in children]
    weights = weight_calc.post_stratify(weights, stratum_ids, stratum_populations)
    
    # Calculate coverage for each vaccine-dose
    for vax_dose in vaccine_doses:
        vaccinated = [
            1 if any(
                f"{v.vaccine}{v.dose_number}" == vax_dose 
                for v in c.vaccinations
            ) else 0
            for c in children
        ]
        
        coverage = coverage_calc.weighted_coverage(vaccinated, weights)
        deff = coverage_calc.estimate_deff(vaccinated, weights, [c.cluster_id for c in children])
        n_eff = len(children) / deff
        
        ci = coverage_calc.confidence_interval(coverage, int(n_eff))
        lcb, ucb = coverage_calc.confidence_bounds(coverage, int(n_eff))
        classification = coverage_calc.classify_coverage(coverage, int(n_eff), threshold=0.80)
        
        results['coverage'][vax_dose] = {
            'estimate': coverage,
            'ci_lower': ci[0],
            'ci_upper': ci[1],
            'lcb_95': lcb,
            'ucb_95': ucb,
            'n_effective': n_eff,
            'deff': deff
        }
        
        results['classification'][vax_dose] = {
            'threshold_80': coverage_calc.classify_coverage(coverage, int(n_eff), 0.80),
            'threshold_90': coverage_calc.classify_coverage(coverage, int(n_eff), 0.90),
            'threshold_95': coverage_calc.classify_coverage(coverage, int(n_eff), 0.95)
        }
    
    # Calculate dropout rates
    results['dropout'] = dropout_calc.standard_dropout_indicators(children)
    
    return results
```

---

## Appendix A: Reference Tables

### A.1 Effective Sample Size for Estimation

| Precision (±%) | Coverage 50% | Coverage 70% | Coverage 80% | Coverage 90% |
|----------------|--------------|--------------|--------------|--------------|
| ±10% | 96 | 81 | 61 | 35 |
| ±7% | 196 | 165 | 125 | 71 |
| ±5% | 384 | 323 | 246 | 138 |
| ±3% | 1,067 | 896 | 683 | 384 |

### A.2 Design Effect Values

| ICC | m=5 | m=7 | m=10 | m=15 |
|-----|-----|-----|------|------|
| 1/6 (0.167) | 1.67 | 2.00 | 2.50 | 3.33 |
| 1/4 (0.250) | 2.00 | 2.50 | 3.25 | 4.50 |
| 1/3 (0.333) | 2.33 | 3.00 | 4.00 | 5.67 |
| 1/2 (0.500) | 3.00 | 4.00 | 5.50 | 8.00 |

### A.3 Minimum Ages for Valid Doses

| Vaccine | Minimum Age |
|---------|-------------|
| BCG | Birth |
| OPV0/HepB0 | Birth |
| DTP/OPV/PCV/RV Dose 1 | 6 weeks (42 days) |
| DTP/OPV/PCV/RV Dose 2 | 10 weeks (70 days) |
| DTP/OPV/PCV/RV Dose 3 | 14 weeks (98 days) |
| MCV1 | 9 months (266 days) |
| MCV2 | 15 months (456 days) |

---

## Appendix B: Quick Reference Formulas

```
EFFECTIVE SAMPLE SIZE (ESS):
    ESS = z² × p × (1-p) / d²

DESIGN EFFECT (DEFF):
    DEFF = 1 + (m - 1) × ICC

TOTAL RESPONDENTS:
    n = A × ESS × DEFF

NUMBER OF CLUSTERS:
    k = (ESS × DEFF) / m

SAMPLING WEIGHT:
    w = 1 / P(selection) = Total_HH × n_segments / (n_clusters × HH_cluster)

WEIGHTED COVERAGE:
    p̂ = Σ(wᵢ × yᵢ) / Σ(wᵢ)

CONFIDENCE INTERVAL:
    CI = p̂ ± z × √(p̂(1-p̂) / n_eff)

DROPOUT RATE:
    DR = (Coverage_early - Coverage_late) / Coverage_early
```

---

*Document generated from WHO Vaccination Coverage Cluster Surveys Reference Manual, Version 3 (2015)*
