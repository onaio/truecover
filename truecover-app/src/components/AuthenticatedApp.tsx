import { useState } from 'react';
import axios from 'axios';
import FileUpload from './FileUpload';
import SamplingForm from './SamplingForm';
import ResultsTable from './ResultsTable';
import MapView from './MapView';
import { FileData, SamplingRequest } from '../types';
import { mergeSampleFrameAndSurvey } from '../utils/dataMerger';
import {
  TacticalCard,
  TacticalButton,
  TacticalHeader,
  TacticalBadge,
} from '../tactical-ui';
import { useAuth } from '@clerk/clerk-react';
import { env } from '../config/env';

type AppView = 'home' | 'adaptive-sampling' | 'coverage-prediction';

const API_URL = env.VITE_API_URL;

function AuthenticatedApp() {
  const { getToken } = useAuth();
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
    // Reset adaptively_selected to 0 for all features
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
      setError(err.response?.data?.error || err.message || 'Failed to call service');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProcessCoveragePrediction = async () => {
    if (!sampleFrameFile || !surveyDataFile) {
      setPredictionError('Both sample frame and survey data files are required');
      return;
    }

    setIsProcessing(true);
    setPredictionError(null);
    setPredictionResult(null);

    try {
      // Merge the datasets
      const { mergedData, stats } = mergeSampleFrameAndSurvey(
        sampleFrameFile.data,
        surveyDataFile.data
      );

      setMergeStats(stats);

      // Get Clerk auth token
      const token = await getToken();

      // Call the prediction API
      const response = await axios.post(`${API_URL}/api/prediction`, {
        point_data: mergedData,
        exceedance_threshold: 0.5,
        layer_names: []
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('Prediction response:', response.data);

      let resultData = response.data;
      if (resultData?.function_status === 'success' && resultData?.result) {
        resultData = resultData.result;
      }

      setPredictionResult(resultData);
    } catch (err: any) {
      console.error('Error processing coverage prediction:', err);
      setPredictionError(err.response?.data?.error || err.message || 'Failed to process prediction');
    } finally {
      setIsProcessing(false);
    }
  };

  // Render functions remain the same as the original App.tsx
  const renderHome = () => (
    <div style={{ padding: '2rem' }}>
      <TacticalCard>
        <h2 style={{ marginBottom: '1.5rem' }}>Welcome to TrueCover</h2>
        <p style={{ marginBottom: '2rem', color: '#666' }}>
          Select a workflow to get started:
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <TacticalButton onClick={() => setCurrentView('adaptive-sampling')}>
            Adaptive Sampling
          </TacticalButton>
          <TacticalButton onClick={() => setCurrentView('coverage-prediction')}>
            Coverage Prediction
          </TacticalButton>
        </div>
      </TacticalCard>
    </div>
  );

  const renderAdaptiveSampling = () => (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <TacticalButton onClick={() => setCurrentView('home')}>
          ← Back to Home
        </TacticalButton>
      </div>

      <TacticalCard>
        <h2 style={{ marginBottom: '1.5rem' }}>Adaptive Sampling</h2>

        <div style={{ marginBottom: '2rem' }}>
          <FileUpload onFileLoaded={handleFileLoaded} />
        </div>

        {fileData && (
          <>
            <div style={{ marginBottom: '2rem' }}>
              <SamplingForm
                fileData={fileData}
                onSubmit={handleSubmit}
                isLoading={isLoading}
              />
            </div>

            {error && (
              <div style={{
                padding: '1rem',
                marginBottom: '1rem',
                backgroundColor: '#fee',
                border: '1px solid #fcc',
                borderRadius: '4px',
                color: '#c00'
              }}>
                Error: {error}
              </div>
            )}

            {result && (
              <>
                <ResultsTable resultText={result} />
                <MapView data={JSON.parse(result)} mode="sampling" />
              </>
            )}
          </>
        )}
      </TacticalCard>
    </div>
  );

  const renderCoveragePrediction = () => (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <TacticalButton onClick={() => setCurrentView('home')}>
          ← Back to Home
        </TacticalButton>
      </div>

      <TacticalCard>
        <h2 style={{ marginBottom: '1.5rem' }}>Coverage Prediction</h2>

        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>1. Upload Sample Frame</h3>
          <FileUpload onFileLoaded={setSampleFrameFile} />
          {sampleFrameFile && (
            <TacticalBadge variant="success">
              Sample frame loaded ({sampleFrameFile.data.features.length} features)
            </TacticalBadge>
          )}
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>2. Upload Survey Data</h3>
          <FileUpload onFileLoaded={setSurveyDataFile} />
          {surveyDataFile && (
            <TacticalBadge variant="success">
              Survey data loaded ({surveyDataFile.data.features.length} features)
            </TacticalBadge>
          )}
        </div>

        {sampleFrameFile && surveyDataFile && (
          <div style={{ marginBottom: '2rem' }}>
            <TacticalButton
              onClick={handleProcessCoveragePrediction}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Run Coverage Prediction'}
            </TacticalButton>
          </div>
        )}

        {predictionError && (
          <div style={{
            padding: '1rem',
            marginBottom: '1rem',
            backgroundColor: '#fee',
            border: '1px solid #fcc',
            borderRadius: '4px',
            color: '#c00'
          }}>
            Error: {predictionError}
          </div>
        )}

        {mergeStats && (
          <div style={{ marginBottom: '2rem' }}>
            <h3>Merge Statistics</h3>
            <pre style={{ backgroundColor: '#f5f5f5', padding: '1rem', borderRadius: '4px' }}>
              {JSON.stringify(mergeStats, null, 2)}
            </pre>
          </div>
        )}

        {predictionResult && (
          <>
            <ResultsTable resultText={JSON.stringify(predictionResult, null, 2)} />
            <MapView data={predictionResult} mode="prediction" />
          </>
        )}
      </TacticalCard>
    </div>
  );

  return (
    <div className="App">
      <TacticalHeader
        title="TrueCover"
        subtitle={
          currentView === 'home' ? 'Disease Surveillance Platform' :
          currentView === 'adaptive-sampling' ? 'Adaptive Sampling' :
          'Coverage Prediction'
        }
      />

      {currentView === 'home' && renderHome()}
      {currentView === 'adaptive-sampling' && renderAdaptiveSampling()}
      {currentView === 'coverage-prediction' && renderCoveragePrediction()}
    </div>
  );
}

export default AuthenticatedApp;
