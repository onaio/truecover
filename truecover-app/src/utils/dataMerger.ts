import { GeoJSONFeatureCollection, GeoJSONFeature } from '../types';

export interface MergeResult {
  mergedData: GeoJSONFeatureCollection;
  stats: {
    sampleFrameCount: number;
    surveyDataCount: number;
    matchedCount: number;
    addedFromSurvey: number;
    totalInMerged: number;
  };
}

/**
 * Merges sample frame and survey data GeoJSON FeatureCollections.
 *
 * Logic:
 * 1. Survey data overrides sample frame data for matching points
 * 2. Points are matched by ID field or GPS coordinates
 * 3. Non-matching survey points are added
 * 4. All sample frame points are preserved (with or without survey data)
 *
 * @param sampleFrame - The complete sample frame (all points for prediction)
 * @param surveyData - The collected survey data (subset/superset of sample frame)
 * @returns MergeResult with merged data and statistics
 */
export function mergeSampleFrameAndSurvey(
  sampleFrame: GeoJSONFeatureCollection,
  surveyData: GeoJSONFeatureCollection
): MergeResult {
  const result: GeoJSONFeature[] = [];
  const surveyMatched = new Set<number>();

  let matchedCount = 0;

  // Common ID field names to check
  const idFields = ['id', 'ID', 'point_id', 'pointId', 'POINT_ID', 'location_id', 'locationId'];

  // GPS coordinate tolerance (degrees) - approximately 11 meters at equator
  const GPS_TOLERANCE = 0.0001;

  /**
   * Check if two GPS coordinates match within tolerance
   */
  function coordinatesMatch(coords1: number[], coords2: number[]): boolean {
    if (!coords1 || !coords2 || coords1.length < 2 || coords2.length < 2) {
      return false;
    }
    const lngMatch = Math.abs(coords1[0] - coords2[0]) < GPS_TOLERANCE;
    const latMatch = Math.abs(coords1[1] - coords2[1]) < GPS_TOLERANCE;
    return lngMatch && latMatch;
  }

  /**
   * Find matching survey feature for a sample frame feature
   */
  function findMatchingSurveyFeature(sampleFeature: GeoJSONFeature): number | null {
    // Try matching by ID first
    for (const idField of idFields) {
      const sampleId = sampleFeature.properties?.[idField];
      if (sampleId !== undefined && sampleId !== null) {
        for (let i = 0; i < surveyData.features.length; i++) {
          if (surveyMatched.has(i)) continue; // Skip already matched

          const surveyId = surveyData.features[i].properties?.[idField];
          if (surveyId === sampleId) {
            return i;
          }
        }
      }
    }

    // Fallback to GPS coordinate matching
    if (sampleFeature.geometry.type === 'Point') {
      const sampleCoords = sampleFeature.geometry.coordinates;

      for (let i = 0; i < surveyData.features.length; i++) {
        if (surveyMatched.has(i)) continue; // Skip already matched

        const surveyFeature = surveyData.features[i];
        if (surveyFeature.geometry.type === 'Point') {
          const surveyCoords = surveyFeature.geometry.coordinates;
          if (coordinatesMatch(sampleCoords, surveyCoords)) {
            return i;
          }
        }
      }
    }

    return null;
  }

  // Process each sample frame feature
  for (const sampleFeature of sampleFrame.features) {
    const matchIndex = findMatchingSurveyFeature(sampleFeature);

    if (matchIndex !== null) {
      // Found a match - merge properties (survey data overrides sample frame)
      const surveyFeature = surveyData.features[matchIndex];

      // Ensure numeric fields are numbers (they might be strings from CSV)
      const surveyProps = { ...surveyFeature.properties };
      if (surveyProps.n_trials !== undefined) {
        surveyProps.n_trials = Number(surveyProps.n_trials);
      }
      if (surveyProps.n_positive !== undefined) {
        surveyProps.n_positive = Number(surveyProps.n_positive);
      }

      const mergedFeature: GeoJSONFeature = {
        type: 'Feature',
        geometry: sampleFeature.geometry, // Keep sample frame geometry
        properties: {
          ...sampleFeature.properties, // Start with sample frame properties
          ...surveyProps,  // Override with survey properties (with converted numbers)
        }
      };

      result.push(mergedFeature);
      surveyMatched.add(matchIndex);
      matchedCount++;
    } else {
      // No match - keep sample frame feature as-is
      result.push({ ...sampleFeature });
    }
  }

  // Add unmatched survey features
  const addedFromSurvey = surveyData.features.length - surveyMatched.size;
  for (let i = 0; i < surveyData.features.length; i++) {
    if (!surveyMatched.has(i)) {
      const feature = { ...surveyData.features[i] };

      // Ensure numeric fields are numbers
      if (feature.properties) {
        const props = { ...feature.properties };
        if (props.n_trials !== undefined) {
          props.n_trials = Number(props.n_trials);
        }
        if (props.n_positive !== undefined) {
          props.n_positive = Number(props.n_positive);
        }
        feature.properties = props;
      }

      result.push(feature);
    }
  }

  const mergedData: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: result
  };

  return {
    mergedData,
    stats: {
      sampleFrameCount: sampleFrame.features.length,
      surveyDataCount: surveyData.features.length,
      matchedCount,
      addedFromSurvey,
      totalInMerged: result.length
    }
  };
}
