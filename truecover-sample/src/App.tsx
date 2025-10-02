import React, { useState } from 'react';
import axios from 'axios';
import './App.css';
import FileUpload from './components/FileUpload';
import SamplingForm from './components/SamplingForm';
import ResultsTable from './components/ResultsTable';
import MapView from './components/MapView';
import { FileData, SamplingRequest } from './types';
import { mergeSampleFrameAndSurvey } from './utils/dataMerger';

type AppView = 'home' | 'adaptive-sampling' | 'coverage-prediction';

function App() {
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Coverage Prediction state
  const [sampleFrameFile, setSampleFrameFile] = useState<FileData | null>(null);
  const [surveyDataFile, setSurveyDataFile] = useState<FileData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [predictionResult, setPredictionResult] = useState<any>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [mergeStats, setMergeStats] = useState<any>(null);

  const handleFileLoaded = (data: FileData) => {
    setFileData(data);
    setResult(null);
    setError(null);
  };

  const handleSubmit = async (batchSize: number, fieldName: string) => {
    if (!fileData) return;

    setIsLoading(true);
    setError(null);

    const request: SamplingRequest = {
      point_data: fileData.data,
      uncertainty_fieldname: fieldName,
      batch_size: batchSize
    };

    try {
      const response = await axios.post('/api', request, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('Response from service:', response.data);

      // Extract the actual result from the response
      let resultData = response.data;

      // Handle string responses with log messages
      if (typeof response.data === 'string') {
        const jsonMatch = response.data.match(/\{.*\}$/s);
        if (jsonMatch) {
          try {
            resultData = JSON.parse(jsonMatch[0]);
          } catch {
            resultData = response.data;
          }
        }
      }

      // If response has function_status wrapper, extract the result
      if (resultData?.function_status === 'success' && resultData?.result) {
        resultData = resultData.result;
      }

      setResult(JSON.stringify(resultData, null, 2));
    } catch (err: any) {
      console.error('Error calling adaptive sampling service:', err);

      // Extract error from response
      let errorMsg = 'Failed to connect to the adaptive sampling service';

      if (err.response?.data) {
        const data = err.response.data;
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data.match(/\{.*\}$/s)?.[0] || data);
            errorMsg = parsed.result || parsed.message || data;
          } catch {
            errorMsg = data;
          }
        } else if (data.result) {
          errorMsg = data.result;
        } else if (data.message) {
          errorMsg = data.message;
        }
      } else if (err.message) {
        errorMsg = err.message;
      }

      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;

    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(result);
    const exportFileDefaultName = 'adaptive_sampling_result.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    alert('Result copied to clipboard!');
  };

  const renderHomePage = () => (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f5f5f5',
      padding: '20px'
    }}>
      <h1 style={{
        fontSize: '48px',
        marginBottom: '20px',
        color: '#282c34'
      }}>
        TrueCover
      </h1>
      <p style={{
        fontSize: '18px',
        color: '#666',
        marginBottom: '50px'
      }}>
        Select a tool to get started
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '30px',
        maxWidth: '800px',
        width: '100%'
      }}>
        <div
          onClick={() => setCurrentView('adaptive-sampling')}
          style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
            textAlign: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-5px)';
            e.currentTarget.style.boxShadow = '0 8px 12px rgba(0, 0, 0, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
          }}
        >
          <h2 style={{
            fontSize: '24px',
            marginBottom: '15px',
            color: '#282c34'
          }}>
            Adaptive Sampling
          </h2>
          <p style={{
            color: '#666',
            lineHeight: '1.6'
          }}>
            Optimize your survey sampling with intelligent adaptive algorithms
          </p>
        </div>

        <div
          onClick={() => setCurrentView('coverage-prediction')}
          style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
            textAlign: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-5px)';
            e.currentTarget.style.boxShadow = '0 8px 12px rgba(0, 0, 0, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
          }}
        >
          <h2 style={{
            fontSize: '24px',
            marginBottom: '15px',
            color: '#282c34'
          }}>
            Coverage Prediction
          </h2>
          <p style={{
            color: '#666',
            lineHeight: '1.6'
          }}>
            Predict and analyze coverage patterns for your survey data
          </p>
        </div>
      </div>
    </div>
  );

  const renderAdaptiveSampling = () => (
    <div className="App">
      <header style={{
        backgroundColor: '#282c34',
        padding: '20px',
        color: 'white',
        marginBottom: '30px'
      }}>
        <button
          onClick={() => {
            setCurrentView('home');
            setFileData(null);
            setResult(null);
            setError(null);
          }}
          style={{
            backgroundColor: 'transparent',
            color: 'white',
            border: '1px solid white',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '15px',
            fontSize: '14px'
          }}
        >
          ← Back to Home
        </button>
        <h1>Adaptive Sampling</h1>
        <p>Upload a GeoJSON or CSV file to perform adaptive sampling</p>
      </header>

      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '20px'
      }}>
        <FileUpload onFileLoaded={handleFileLoaded} />

        {fileData && (
          <>
            <MapView
              data={fileData.data}
              selectedData={result ? (() => {
                try {
                  return JSON.parse(result);
                } catch (e) {
                  console.error('Failed to parse result:', e);
                  return null;
                }
              })() : null}
              mode="sampling"
            />

            <SamplingForm
              fileData={fileData}
              onSubmit={handleSubmit}
              isLoading={isLoading}
            />
          </>
        )}

        {error && (
          <div style={{
            padding: '15px',
            backgroundColor: '#f8d7da',
            border: '1px solid #f5c6cb',
            borderRadius: '4px',
            color: '#721c24',
            marginTop: '20px'
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && (
          <div style={{
            marginTop: '20px',
            padding: '20px',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
            border: '1px solid #dee2e6'
          }}>
            <h3>Sampling Results</h3>

            {/* Show summary of selected points */}
            {(() => {
              try {
                const data = JSON.parse(result);
                const features = data.features || data.result?.features || [];
                const selectedCount = features.filter((f: any) =>
                  f.properties?.adaptively_selected === 1 ||
                  f.properties?.adaptively_selected === true
                ).length;
                const totalCount = features.length;

                return (
                  <div style={{
                    marginBottom: '15px',
                    padding: '10px',
                    backgroundColor: selectedCount > 0 ? '#d4edda' : '#f8d7da',
                    border: `1px solid ${selectedCount > 0 ? '#c3e6cb' : '#f5c6cb'}`,
                    borderRadius: '4px',
                    color: selectedCount > 0 ? '#155724' : '#721c24'
                  }}>
                    <strong>Summary:</strong> {selectedCount} out of {totalCount} points selected for sampling
                    {selectedCount > 0 && (
                      <div style={{ marginTop: '5px', fontSize: '12px' }}>
                        Look for <code style={{ backgroundColor: '#fff', padding: '2px 4px' }}>
                          "adaptively_selected": 1
                        </code> in the results below
                      </div>
                    )}
                  </div>
                );
              } catch {
                return null;
              }
            })()}

            <div style={{ marginBottom: '10px', display: 'flex', gap: '10px' }}>
              <button
                onClick={handleCopy}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Copy to Clipboard
              </button>
              <button
                onClick={handleDownload}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Download Results
              </button>
            </div>
            <ResultsTable resultText={result} />
          </div>
        )}
      </div>
    </div>
  );

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
    // The model will use n_trials/n_positive for training and prior predictions for context
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

    // Send cleaned data - the algorithm will:
    // 1. Train on points WITH n_trials/n_positive
    // 2. Predict for ALL points (including those without survey data)
    const request = {
      point_data: cleanedData,
      exceedance_threshold: 0.5,
      layer_names: []
    };

    // Find a feature with survey data for logging
    const featureWithSurveyData = mergeResult.mergedData.features.find(f => {
      const props = f.properties || {};
      return typeof props.n_trials === 'number' && typeof props.n_positive === 'number';
    });

    console.log('Sending prediction request:');
    console.log('- Total points:', cleanedData.features.length);
    console.log('- Points with survey data (for training):', pointsWithSurveyData);

    try {
      const response = await axios.post('/api/prediction', request, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        responseType: 'json'
      });

      let resultData = response.data;

      // If it's a string, try to parse it
      if (typeof resultData === 'string') {
        // Try to clean up the string - remove any non-JSON content
        let jsonStr = resultData.trim();

        // Find the actual JSON content (starts with { or [)
        const jsonStart = jsonStr.search(/[{\[]/);
        if (jsonStart > 0) {
          jsonStr = jsonStr.substring(jsonStart);
        }

        // Try to find where the JSON ends and remove any trailing content (like Python warnings)
        try {
          resultData = JSON.parse(jsonStr);
        } catch (parseErr: any) {
          // Check if there's content after valid JSON
          const match = parseErr.message.match(/position (\d+)/);
          if (match) {
            const errorPos = parseInt(match[1]);

            // Try to extract just the JSON part by finding the last valid closing brace/bracket
            // Look backwards from the error position to find a complete JSON object
            for (let i = errorPos - 1; i >= 0; i--) {
              const char = jsonStr[i];
              if (char === '}' || char === ']') {
                const candidate = jsonStr.substring(0, i + 1);
                try {
                  resultData = JSON.parse(candidate);
                  // Successfully cleaned trailing non-JSON content from response
                  break;
                } catch {
                  // Keep trying
                }
              }
            }

            // If we still don't have valid JSON, show the error
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

      // Clean up the result - remove old/stale fields from prior predictions
      if (resultData && resultData.features) {
        resultData.features = resultData.features.map((feature: any) => {
          const props = { ...feature.properties };

          // Remove old prediction fields that are now replaced
          delete props.predicted_prevalence;
          delete props.prediction_uncertainty;
          delete props.adaptively_selected;

          return {
            ...feature,
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

  const renderCoveragePrediction = () => {
    return (
      <div className="App">
        <header style={{
          backgroundColor: '#282c34',
          padding: '20px',
          color: 'white',
          marginBottom: '30px'
        }}>
          <button
            onClick={() => {
              setCurrentView('home');
              setSampleFrameFile(null);
              setSurveyDataFile(null);
              setPredictionResult(null);
              setPredictionError(null);
              setMergeStats(null);
            }}
            style={{
              backgroundColor: 'transparent',
              color: 'white',
              border: '1px solid white',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '15px',
              fontSize: '14px'
            }}
          >
            ← Back to Home
          </button>
          <h1>Coverage Prediction</h1>
          <p>Upload sample frame and survey data to predict coverage patterns</p>
        </header>

        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '20px'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            marginBottom: '20px'
          }}>
            <FileUpload
              onFileLoaded={handleSampleFrameLoaded}
              label="Upload Sample Frame"
            />
            <FileUpload
              onFileLoaded={handleSurveyDataLoaded}
              label="Upload Survey Data"
            />
          </div>

          {(sampleFrameFile || surveyDataFile) && (
            <div style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid #dee2e6'
            }}>
              <h3>Files Loaded</h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  <h4 style={{ marginTop: 0 }}>Sample Frame</h4>
                  {sampleFrameFile ? (
                    <p>
                      <strong>Features:</strong> {sampleFrameFile.data.features.length}<br />
                      <strong>Fields:</strong> {sampleFrameFile.fields.join(', ')}
                    </p>
                  ) : (
                    <p style={{ color: '#999' }}>Not loaded</p>
                  )}
                </div>

                <div>
                  <h4 style={{ marginTop: 0 }}>Survey Data</h4>
                  {surveyDataFile ? (
                    <p>
                      <strong>Features:</strong> {surveyDataFile.data.features.length}<br />
                      <strong>Fields:</strong> {surveyDataFile.fields.join(', ')}
                    </p>
                  ) : (
                    <p style={{ color: '#999' }}>Not loaded</p>
                  )}
                </div>
              </div>

              {mergeStats && (
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#d4edda',
                  border: '1px solid #c3e6cb',
                  borderRadius: '4px',
                  color: '#155724'
                }}>
                  <strong>Merge Summary:</strong>
                  <ul style={{ marginBottom: 0, marginTop: '5px' }}>
                    <li>Sample frame points: {mergeStats.sampleFrameCount}</li>
                    <li>Survey data points: {mergeStats.surveyDataCount}</li>
                    <li>Matched points (survey overrode sample frame): {mergeStats.matchedCount}</li>
                    <li>Added from survey: {mergeStats.addedFromSurvey}</li>
                    <li><strong>Total in merged dataset: {mergeStats.totalInMerged}</strong></li>
                    {mergeStats.pointsWithSurveyData !== undefined && (
                      <li style={{ color: '#0c5460', fontWeight: 'bold' }}>
                        Points with survey data (for model training): {mergeStats.pointsWithSurveyData}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <button
                onClick={handleGeneratePrediction}
                disabled={isProcessing || !sampleFrameFile || !surveyDataFile}
                style={{
                  padding: '10px 20px',
                  backgroundColor: (isProcessing || !sampleFrameFile || !surveyDataFile) ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: (isProcessing || !sampleFrameFile || !surveyDataFile) ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  marginTop: '15px'
                }}
              >
                {isProcessing ? 'Generating Prediction...' : 'Generate Coverage Prediction'}
              </button>
            </div>
          )}

          {sampleFrameFile && surveyDataFile && predictionResult && (
            <MapView
              data={sampleFrameFile.data}
              selectedData={predictionResult}
              mode="prediction"
            />
          )}

          {predictionError && (
            <div style={{
              padding: '15px',
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              borderRadius: '4px',
              color: '#721c24',
              marginTop: '20px'
            }}>
              <strong>Error:</strong> {predictionError}
            </div>
          )}

          {predictionResult && (
            <div style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid #dee2e6'
            }}>
              <h3>Prediction Results</h3>

              <div style={{
                marginBottom: '15px',
                padding: '10px',
                backgroundColor: '#d4edda',
                border: '1px solid #c3e6cb',
                borderRadius: '4px',
                color: '#155724'
              }}>
                <strong>Summary:</strong> Generated predictions for {predictionResult.features?.length || 0} points
                <div style={{ marginTop: '5px', fontSize: '12px' }}>
                  Type: {predictionResult.type || 'N/A'}
                </div>
              </div>

              <div style={{ marginBottom: '10px', display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleCopyPrediction}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={handleDownloadPrediction}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Download as GeoJSON
                </button>
              </div>

              {/* Raw Response section - disabled for now but kept for debugging
              <div style={{
                marginTop: '20px',
                padding: '15px',
                backgroundColor: 'white',
                borderRadius: '4px',
                border: '1px solid #dee2e6'
              }}>
                <h4 style={{ marginTop: 0, marginBottom: '10px' }}>Raw Response:</h4>
                <pre style={{
                  backgroundColor: '#f8f9fa',
                  padding: '15px',
                  borderRadius: '4px',
                  overflow: 'auto',
                  maxHeight: '400px',
                  fontSize: '12px',
                  margin: 0
                }}>
                  {JSON.stringify(predictionResult, null, 2)}
                </pre>
              </div>
              */}

              <ResultsTable resultText={JSON.stringify(predictionResult, null, 2)} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {currentView === 'home' && renderHomePage()}
      {currentView === 'adaptive-sampling' && renderAdaptiveSampling()}
      {currentView === 'coverage-prediction' && renderCoveragePrediction()}
    </>
  );
}

export default App;
