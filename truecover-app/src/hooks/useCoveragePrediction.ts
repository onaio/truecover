import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';
import { FileData } from '../types';
import { mergeSampleFrameAndSurvey } from '../utils/dataMerger';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export const useCoveragePrediction = () => {
  const { getToken } = useAuth();
  const [sampleFrameFile, setSampleFrameFile] = useState<FileData | null>(null);
  const [surveyDataFile, setSurveyDataFile] = useState<FileData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [predictionResult, setPredictionResult] = useState<any>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [mergeStats, setMergeStats] = useState<any>(null);

  const handleSampleFrameLoaded = (data: FileData) => {
    setSampleFrameFile(data);
    setPredictionResult(null);
    setPredictionError(null);
    setMergeStats(null);
  };

  const handleSurveyDataLoaded = (data: FileData) => {
    setSurveyDataFile(data);
    setPredictionResult(null);
    setPredictionError(null);
    setMergeStats(null);
  };

  const handleGeneratePrediction = async () => {
    if (!sampleFrameFile || !surveyDataFile) {
      setPredictionError('Please upload both sample frame and survey data files');
      return;
    }

    // Validate survey data has required fields
    const surveyHasRequiredFields = surveyDataFile.data.features.some(f => {
      const props = f.properties || {};
      return typeof props.n_trials === 'number' && typeof props.n_positive === 'number';
    });

    if (!surveyHasRequiredFields) {
      setPredictionError(
        'Survey data must include n_trials and n_positive fields. ' +
        'Found fields: ' + surveyDataFile.fields.join(', ')
      );
      return;
    }

    setIsProcessing(true);
    setPredictionError(null);
    setPredictionResult(null);

    // Merge the two datasets
    const mergeResult = mergeSampleFrameAndSurvey(
      sampleFrameFile.data,
      surveyDataFile.data
    );

    // Validate and count points with survey data (for training)
    let pointsWithSurveyData = 0;
    let invalidPoints: string[] = [];

    mergeResult.mergedData.features.forEach((feature, idx) => {
      const props = feature.properties || {};
      if (typeof props.n_trials === 'number' && typeof props.n_positive === 'number') {
        if (props.n_trials <= 0) {
          invalidPoints.push(`Point ${idx}: n_trials must be > 0 (found ${props.n_trials})`);
        } else if (props.n_positive < 0) {
          invalidPoints.push(`Point ${idx}: n_positive must be >= 0 (found ${props.n_positive})`);
        } else if (props.n_positive > props.n_trials) {
          invalidPoints.push(`Point ${idx}: n_positive (${props.n_positive}) > n_trials (${props.n_trials})`);
        } else {
          pointsWithSurveyData++;
        }
      }
    });

    if (invalidPoints.length > 0) {
      setPredictionError(
        'Invalid survey data found:\n' + invalidPoints.slice(0, 5).join('\n') +
        (invalidPoints.length > 5 ? `\n... and ${invalidPoints.length - 5} more` : '')
      );
      setIsProcessing(false);
      return;
    }

    if (pointsWithSurveyData === 0) {
      setPredictionError(
        'No points with valid n_trials and n_positive fields found. ' +
        'Survey data must include n_trials and n_positive fields for at least some points to train the model.'
      );
      setIsProcessing(false);
      return;
    }

    // Save merge stats for display (including training data count)
    setMergeStats({
      ...mergeResult.stats,
      pointsWithSurveyData: pointsWithSurveyData
    });

    // Prepare data for prediction - keep all fields but ensure consistent types
    const cleanedFeatures = mergeResult.mergedData.features.map((feature, idx) => {
      const props = { ...feature.properties } || {};

      // Normalize ID to be numeric (important for pandas DataFrame)
      if (props.id !== undefined && props.id !== null) {
        const numId = typeof props.id === 'number' ? props.id : parseInt(String(props.id), 10);
        props.id = isNaN(numId) ? idx : numId;
      } else {
        props.id = idx;
      }

      // Ensure numeric fields are actually numbers
      if (props.n_trials !== undefined) {
        props.n_trials = Number(props.n_trials);
      }
      if (props.n_positive !== undefined) {
        props.n_positive = Number(props.n_positive);
      }

      return {
        type: 'Feature' as const,
        geometry: feature.geometry,
        properties: props
      };
    });

    const cleanedData = {
      type: 'FeatureCollection' as const,
      features: cleanedFeatures
    };

    // Store original geometries to restore after prediction
    const originalGeometries = new Map<number | string, any>();
    cleanedData.features.forEach(feature => {
      const id = feature.properties.id;
      if (id !== undefined && id !== null) {
        originalGeometries.set(id, feature.geometry);
      }
    });

    // Send cleaned data
    const request = {
      point_data: cleanedData,
      exceedance_threshold: 0.5,
      layer_names: []
    };

    try {
      // Get Clerk auth token
      const token = await getToken();

      const response = await axios.post(`${API_URL}/api/prediction`, request, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        responseType: 'json'
      });

      let resultData = response.data;

      // If it's a string, try to parse it
      if (typeof resultData === 'string') {
        let jsonStr = resultData.trim();

        // Find the actual JSON content
        const jsonStart = jsonStr.search(/[{[]/);
        if (jsonStart > 0) {
          jsonStr = jsonStr.substring(jsonStart);
        }

        // Try to find where the JSON ends
        try {
          resultData = JSON.parse(jsonStr);
        } catch (parseErr: any) {
          // Check if there's content after valid JSON
          const match = parseErr.message.match(/position (\d+)/);
          if (match) {
            const errorPos = parseInt(match[1]);

            // Look backwards from error position to find complete JSON
            for (let i = errorPos - 1; i >= 0; i--) {
              const char = jsonStr[i];
              if (char === '}' || char === ']') {
                const candidate = jsonStr.substring(0, i + 1);
                try {
                  resultData = JSON.parse(candidate);
                  break;
                } catch {
                  // Keep trying
                }
              }
            }

            if (typeof resultData === 'string') {
              setPredictionError('Response is a string but not valid JSON. Error: ' + parseErr.message);
              return;
            }
          } else {
            setPredictionError('Response is a string but not valid JSON. Error: ' + parseErr.message);
            return;
          }
        }
      }

      // Extract result from function_status wrapper if present
      if (resultData && typeof resultData === 'object' && 'function_status' in resultData) {
        if (resultData.function_status === 'success' && 'result' in resultData) {
          resultData = resultData.result;
        } else if (resultData.function_status === 'error') {
          setPredictionError('Server returned error: ' + JSON.stringify(resultData));
          return;
        }
      }

      // Clean up the result - remove old/stale fields and restore original geometries
      if (resultData && resultData.features) {
        resultData.features = resultData.features.map((feature: any) => {
          const props = { ...feature.properties };

          // Remove old prediction fields that are now replaced
          delete props.predicted_prevalence;
          delete props.prediction_uncertainty;
          delete props.adaptively_selected;

          // Restore original geometry if available
          const id = props.id;
          const originalGeometry = originalGeometries.get(id);

          return {
            ...feature,
            geometry: originalGeometry || feature.geometry,
            properties: props
          };
        });
      }

      setPredictionResult(resultData);
    } catch (err: any) {
      console.error('Error generating prediction:', err);
      console.error('Error response:', err.response);
      console.error('Error response data:', err.response?.data);

      let errorMessage = 'Failed to connect to the prevalence predictor service';

      if (err.response?.data) {
        const data = err.response.data;
        if (typeof data === 'object' && data.result) {
          errorMessage = `Server error: ${data.result}`;
        } else {
          errorMessage = JSON.stringify(data, null, 2);
        }
      } else if (err.message) {
        errorMessage = err.message;
      }

      setPredictionError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadPrediction = () => {
    if (!predictionResult) return;

    const dataStr = JSON.stringify(predictionResult, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = 'coverage_prediction.geojson';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleCopyPrediction = () => {
    if (!predictionResult) return;
    const dataStr = JSON.stringify(predictionResult, null, 2);
    navigator.clipboard.writeText(dataStr);
    alert('Prediction copied to clipboard!');
  };

  return {
    sampleFrameFile,
    surveyDataFile,
    isProcessing,
    predictionResult,
    predictionError,
    mergeStats,
    handleSampleFrameLoaded,
    handleSurveyDataLoaded,
    handleGeneratePrediction,
    handleDownloadPrediction,
    handleCopyPrediction,
  };
};
