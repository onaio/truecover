import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import FileUpload from './components/FileUpload';
import SamplingForm from './components/SamplingForm';
import ResultsTable from './components/ResultsTable';
import MapView from './components/MapView';
import OrganizationSelector from './components/OrganizationSelector';
import CreateOrganizationModal from './components/CreateOrganizationModal';
import ProjectSelector from './components/ProjectSelector';
import CreateProjectModal from './components/CreateProjectModal';
import ProjectsList from './components/ProjectsList';
import AreasList from './components/AreasList';
import OrganizationSettings from './components/OrganizationSettings';
import { FileData, SamplingRequest, Organization, Project } from './types';
import { mergeSampleFrameAndSurvey } from './utils/dataMerger';
import {
  TacticalCard,
  TacticalButton,
  TacticalHeader,
  TacticalBadge,
} from './tactical-ui';
import { SignInButton, UserButton, useAuth } from '@clerk/clerk-react';

type AppView = 'home' | 'adaptive-sampling' | 'coverage-prediction' | 'organization-management' | 'area-detail';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

function App() {
  const { getToken, isSignedIn } = useAuth();
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

  // Organization state
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [isCreateOrgModalOpen, setIsCreateOrgModalOpen] = useState(false);
  const [refreshOrganizations, setRefreshOrganizations] = useState<(() => Promise<void>) | null>(null);

  // Project state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [refreshProjects, setRefreshProjects] = useState<(() => Promise<void>) | null>(null);

  // Area state
  const [selectedArea, setSelectedArea] = useState<any | null>(null);

  // Auto-sync user to database on sign-in
  useEffect(() => {
    const syncUser = async () => {
      if (isSignedIn) {
        try {
          const token = await getToken();
          console.log('Got Clerk token:', token ? 'Token received' : 'No token');

          // Call /api/user/me to trigger user sync in backend
          const response = await axios.get(`${API_URL}/api/user/me`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          console.log('User synced to database:', response.data);
        } catch (error: any) {
          console.error('Failed to sync user:', error);
          console.error('Error details:', error.response?.data);
        }
      }
    };

    syncUser();
  }, [isSignedIn, getToken]);

  const handleFileLoaded = (data: FileData) => {
    // Reset adaptively_selected to 0 for all features
    // This ensures we start fresh and select new points
    if (data.data && data.data.features) {
      const cleanedData = {
        ...data.data,
        features: data.data.features.map((feature: any) => ({
          ...feature,
          properties: {
            ...feature.properties,
            adaptively_selected: 0
          }
        }))
      };
      setFileData({ ...data, data: cleanedData });
    } else {
      setFileData(data);
    }
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
      // Get Clerk auth token
      const token = await getToken();

      const response = await axios.post(`${API_URL}/api/sampling`, request, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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
    <div className="min-h-screen bg-tactical-bg-primary flex flex-col p-6">
      <div className="flex-1 flex flex-col items-center">
        <div className="text-center mb-12 mt-12">
          <h1 className="font-mono text-6xl font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
            TrueCover
          </h1>
          <p className="font-mono text-sm text-tactical-text-muted uppercase tracking-wide">
            Estimating true coverage
          </p>
        </div>

        {/* Organization and Project Selectors */}
        {isSignedIn && (
          <div className="w-full max-w-4xl mx-auto mb-8 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TacticalCard padding="md">
                <OrganizationSelector
                  selectedOrganization={selectedOrganization}
                  onOrganizationChange={setSelectedOrganization}
                  onRefresh={(refreshFn) => setRefreshOrganizations(() => refreshFn)}
                  showCreateButton={false}
                />
              </TacticalCard>
              <TacticalCard padding="md">
                <ProjectSelector
                  selectedOrganization={selectedOrganization}
                  selectedProject={selectedProject}
                  onProjectChange={setSelectedProject}
                  onCreateClick={() => setIsCreateProjectModalOpen(true)}
                  onRefresh={(refreshFn) => setRefreshProjects(() => refreshFn)}
                />
              </TacticalCard>
            </div>

            {/* Locations List */}
            <AreasList
              project={selectedProject}
              onAreaSelect={(area) => {
                setSelectedArea(area);
                setCurrentView('area-detail');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );

  const renderAdaptiveSampling = () => (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title="TrueCover / Adaptive Sampling"
        subtitle="Upload a GeoJSON or CSV file to perform adaptive sampling"
        actions={
          <TacticalButton
            variant="secondary"
            size="sm"
            onClick={() => {
              setCurrentView('home');
              setFileData(null);
              setResult(null);
              setError(null);
            }}
          >
            Back to Home
          </TacticalButton>
        }
      />

      <div className="max-w-7xl mx-auto p-6 space-y-6">
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
          <TacticalCard borderStyle="medium" variant="secondary" padding="md">
            <div className="flex items-start gap-3">
              <TacticalBadge variant="danger">ERROR</TacticalBadge>
              <span className="text-sm text-tactical-accent-red">{error}</span>
            </div>
          </TacticalCard>
        )}

        {result && (
          <TacticalCard title="Sampling Results" padding="lg">
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
                  <div className="mb-4 p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
                    <div className="flex items-center gap-3 mb-2">
                      <TacticalBadge variant={selectedCount > 0 ? 'success' : 'danger'}>
                        SUMMARY
                      </TacticalBadge>
                      <span className="text-sm">
                        {selectedCount} out of {totalCount} points selected for sampling
                      </span>
                    </div>
                    {selectedCount > 0 && (
                      <p className="text-xs text-tactical-text-dim mt-2">
                        Look for <code className="bg-tactical-bg-tertiary px-1 py-0.5 border border-tactical-border-dark">
                          "adaptively_selected": 1
                        </code> in the results below
                      </p>
                    )}
                  </div>
                );
              } catch {
                return null;
              }
            })()}

            <div className="flex gap-2 mb-4">
              <TacticalButton
                variant="secondary"
                size="sm"
                onClick={handleCopy}
              >
                Copy to Clipboard
              </TacticalButton>
              <TacticalButton
                variant="success"
                size="sm"
                onClick={handleDownload}
              >
                Download Results
              </TacticalButton>
            </div>
            <ResultsTable resultText={result} />
          </TacticalCard>
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

    // Store original geometries to restore after prediction
    // The prediction API may return centroids for polygons, but we want to preserve the original shapes
    const originalGeometries = new Map<number | string, any>();
    cleanedData.features.forEach(feature => {
      const id = feature.properties.id;
      if (id !== undefined && id !== null) {
        originalGeometries.set(id, feature.geometry);
      }
    });

    // Send cleaned data - the algorithm will:
    // 1. Train on points WITH n_trials/n_positive
    // 2. Predict for ALL points (including those without survey data)
    const request = {
      point_data: cleanedData,
      exceedance_threshold: 0.5,
      layer_names: []
    };

    console.log('Sending prediction request:');
    console.log('- Total points:', cleanedData.features.length);
    console.log('- Points with survey data (for training):', pointsWithSurveyData);

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
        // Try to clean up the string - remove any non-JSON content
        let jsonStr = resultData.trim();

        // Find the actual JSON content (starts with { or [)
        const jsonStart = jsonStr.search(/[{[]/);
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
      // AND restore original geometries (polygons) if they were converted to points
      if (resultData && resultData.features) {
        resultData.features = resultData.features.map((feature: any) => {
          const props = { ...feature.properties };

          // Remove old prediction fields that are now replaced
          delete props.predicted_prevalence;
          delete props.prediction_uncertainty;
          delete props.adaptively_selected;

          // Restore original geometry if available (preserve polygons instead of centroids)
          const id = props.id;
          const originalGeometry = originalGeometries.get(id);

          return {
            ...feature,
            geometry: originalGeometry || feature.geometry, // Use original geometry if available
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
      <div className="min-h-screen bg-tactical-bg-primary">
        <TacticalHeader
          title="TrueCover / Coverage Prediction"
          subtitle="Upload sample frame and survey data to predict coverage patterns"
          actions={
            <TacticalButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setCurrentView('home');
                setSampleFrameFile(null);
                setSurveyDataFile(null);
                setPredictionResult(null);
                setPredictionError(null);
                setMergeStats(null);
              }}
            >
              Back to Home
            </TacticalButton>
          }
        />

        <div className="max-w-7xl mx-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            <TacticalCard title="Files Loaded" padding="lg">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                <div>
                  <h4 className="text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                    Sample Frame
                  </h4>
                  {sampleFrameFile ? (
                    <div className="text-xs space-y-1">
                      <div><span className="text-tactical-text-muted">Features:</span> <span className="text-tactical-text-secondary">{sampleFrameFile.data.features.length}</span></div>
                      <div><span className="text-tactical-text-muted">Fields:</span> <span className="text-tactical-text-secondary">{sampleFrameFile.fields.join(', ')}</span></div>
                    </div>
                  ) : (
                    <p className="text-xs text-tactical-text-dim">Not loaded</p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                    Survey Data
                  </h4>
                  {surveyDataFile ? (
                    <div className="text-xs space-y-1">
                      <div><span className="text-tactical-text-muted">Features:</span> <span className="text-tactical-text-secondary">{surveyDataFile.data.features.length}</span></div>
                      <div><span className="text-tactical-text-muted">Fields:</span> <span className="text-tactical-text-secondary">{surveyDataFile.fields.join(', ')}</span></div>
                    </div>
                  ) : (
                    <p className="text-xs text-tactical-text-dim">Not loaded</p>
                  )}
                </div>
              </div>

              {mergeStats && (
                <div className="p-3 border border-tactical-accent-orange-dim bg-tactical-bg-secondary mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TacticalBadge variant="success">MERGE SUMMARY</TacticalBadge>
                  </div>
                  <ul className="text-xs space-y-1 list-disc list-inside text-tactical-text-secondary">
                    <li>Sample frame points: {mergeStats.sampleFrameCount}</li>
                    <li>Survey data points: {mergeStats.surveyDataCount}</li>
                    <li>Matched points (survey overrode sample frame): {mergeStats.matchedCount}</li>
                    <li>Added from survey: {mergeStats.addedFromSurvey}</li>
                    <li className="font-bold">Total in merged dataset: {mergeStats.totalInMerged}</li>
                    {mergeStats.pointsWithSurveyData !== undefined && (
                      <li className="text-tactical-accent-blue font-bold">
                        Points with survey data (for model training): {mergeStats.pointsWithSurveyData}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <TacticalButton
                variant="primary"
                size="lg"
                fullWidth
                onClick={handleGeneratePrediction}
                disabled={isProcessing || !sampleFrameFile || !surveyDataFile}
              >
                {isProcessing ? (
                  <span className="tactical-loading-dots">
                    GENERATING PREDICTION<span>.</span><span>.</span><span>.</span>
                  </span>
                ) : (
                  'Generate Coverage Prediction'
                )}
              </TacticalButton>
            </TacticalCard>
          )}

          {sampleFrameFile && surveyDataFile && predictionResult && (
            <MapView
              data={sampleFrameFile.data}
              selectedData={predictionResult}
              mode="prediction"
            />
          )}

          {predictionError && (
            <TacticalCard borderStyle="medium" variant="secondary" padding="md">
              <div className="flex items-start gap-3">
                <TacticalBadge variant="danger">ERROR</TacticalBadge>
                <span className="text-sm text-tactical-accent-red">{predictionError}</span>
              </div>
            </TacticalCard>
          )}

          {predictionResult && (
            <TacticalCard title="Prediction Results" padding="lg">
              <div className="mb-4 p-3 border border-tactical-accent-orange-dim bg-tactical-bg-secondary">
                <div className="flex items-center gap-3 mb-2">
                  <TacticalBadge variant="success">SUMMARY</TacticalBadge>
                  <span className="text-sm">
                    Generated predictions for {predictionResult.features?.length || 0} points
                  </span>
                </div>
                <p className="text-xs text-tactical-text-dim">
                  Type: {predictionResult.type || 'N/A'}
                </p>
              </div>

              <div className="flex gap-2 mb-4">
                <TacticalButton
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyPrediction}
                >
                  Copy to Clipboard
                </TacticalButton>
                <TacticalButton
                  variant="success"
                  size="sm"
                  onClick={handleDownloadPrediction}
                >
                  Download as GeoJSON
                </TacticalButton>
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
            </TacticalCard>
          )}
        </div>
      </div>
    );
  };

  const renderOrganizationManagement = () => (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title="TrueCover / Organization Management"
        subtitle="Manage your organizations, projects, and team members"
      />

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Organization Selector */}
        <TacticalCard padding="md">
          <OrganizationSelector
            selectedOrganization={selectedOrganization}
            onOrganizationChange={setSelectedOrganization}
            onCreateClick={() => setIsCreateOrgModalOpen(true)}
            onRefresh={(refreshFn) => setRefreshOrganizations(() => refreshFn)}
          />
        </TacticalCard>

        {/* Projects and Settings Grid */}
        {selectedOrganization && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ProjectsList organization={selectedOrganization} />
            <OrganizationSettings
              organization={selectedOrganization}
              onOrganizationUpdated={(updatedOrg) => {
                setSelectedOrganization(updatedOrg);
              }}
              onOrganizationDeleted={async () => {
                setSelectedOrganization(null);
                if (refreshOrganizations) {
                  await refreshOrganizations();
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Create Organization Modal */}
      <CreateOrganizationModal
        isOpen={isCreateOrgModalOpen}
        onClose={() => setIsCreateOrgModalOpen(false)}
        onOrganizationCreated={(org) => {
          setSelectedOrganization(org);
          setIsCreateOrgModalOpen(false);
        }}
      />
    </div>
  );

  const renderAreaDetail = () => {
    if (!selectedArea) return null;

    return (
      <div className="min-h-screen bg-tactical-bg-primary">
        <TacticalHeader
          title=""
          subtitle=""
          actions={
            <TacticalButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setCurrentView('home');
                setSelectedArea(null);
              }}
            >
              Back
            </TacticalButton>
          }
        />

        <div className="max-w-7xl mx-auto p-6">
          <div className="w-9/12 mx-auto">
            {/* Breadcrumbs */}
            <div className="mb-4">
              <p className="text-sm text-tactical-text-dim font-mono uppercase tracking-wider">
                <span
                  className="hover:text-tactical-accent-orange cursor-pointer transition-colors"
                  onClick={() => {
                    setCurrentView('home');
                    setSelectedArea(null);
                  }}
                >
                  {selectedOrganization?.name || 'Organization'}
                </span>
                {' / '}
                <span
                  className="hover:text-tactical-accent-orange cursor-pointer transition-colors"
                  onClick={() => {
                    setCurrentView('home');
                    setSelectedArea(null);
                  }}
                >
                  {selectedProject?.title || 'Project'}
                </span>
              </p>
            </div>

            {/* Area Name */}
            <h1 className="font-mono text-4xl font-bold text-tactical-text-primary uppercase tracking-wider mb-8">
              {selectedArea.name}
            </h1>

            {/* Area Description */}
            {selectedArea.description && (
              <TacticalCard padding="lg" className="mb-6">
                <p className="text-sm text-tactical-text-muted">{selectedArea.description}</p>
              </TacticalCard>
            )}

            {/* Tools Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <TacticalCard
                hoverable
                onClick={() => setCurrentView('adaptive-sampling')}
                padding="none"
                className="overflow-hidden"
              >
                <div className="relative group">
                  <img
                    src="/assets/adaptive-sampling-demo.png"
                    alt="Adaptive Sampling Demo"
                    className="w-full h-64 object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-tactical-bg-primary via-tactical-bg-primary/50 to-transparent" />
                </div>
                <div className="p-6 text-center">
                  <h2 className="text-lg font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
                    Adaptive Sampling
                  </h2>
                  <p className="text-sm text-tactical-text-muted leading-relaxed">
                    Optimize your survey sampling with intelligent adaptive algorithms
                  </p>
                </div>
              </TacticalCard>

              <TacticalCard
                hoverable
                onClick={() => setCurrentView('coverage-prediction')}
                padding="none"
                className="overflow-hidden"
              >
                <div className="relative group">
                  <img
                    src="/assets/coverage-prediction-demo.png"
                    alt="Coverage Prediction Demo"
                    className="w-full h-64 object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-tactical-bg-primary via-tactical-bg-primary/50 to-transparent" />
                </div>
                <div className="p-6 text-center">
                  <h2 className="text-lg font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
                    Coverage Prediction
                  </h2>
                  <p className="text-sm text-tactical-text-muted leading-relaxed">
                    Predict and analyze coverage patterns for your survey data
                  </p>
                </div>
              </TacticalCard>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Clerk Auth Button - Top Right */}
      <div style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        zIndex: 9999,
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center'
      }}>
        {isSignedIn && currentView === 'home' && (
          <TacticalButton
            variant="secondary"
            size="sm"
            onClick={() => setCurrentView('organization-management')}
          >
            Admin
          </TacticalButton>
        )}
        {isSignedIn ? (
          <UserButton afterSignOutUrl="/" />
        ) : (
          <SignInButton mode="modal">
            <TacticalButton variant="secondary" size="sm">
              Sign In
            </TacticalButton>
          </SignInButton>
        )}
      </div>

      {currentView === 'home' && renderHomePage()}
      {currentView === 'adaptive-sampling' && renderAdaptiveSampling()}
      {currentView === 'coverage-prediction' && renderCoveragePrediction()}
      {currentView === 'organization-management' && renderOrganizationManagement()}
      {currentView === 'area-detail' && renderAreaDetail()}

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
        organization={selectedOrganization}
        onProjectCreated={(project) => {
          setSelectedProject(project);
          setIsCreateProjectModalOpen(false);
          if (refreshProjects) {
            refreshProjects();
          }
        }}
      />

      {/* Create Organization Modal - Global */}
      <CreateOrganizationModal
        isOpen={isCreateOrgModalOpen}
        onClose={() => setIsCreateOrgModalOpen(false)}
        onOrganizationCreated={async (org) => {
          setSelectedOrganization(org);
          setIsCreateOrgModalOpen(false);
          if (refreshOrganizations) {
            await refreshOrganizations();
          }
        }}
      />
    </div>
  );
}

export default App;
