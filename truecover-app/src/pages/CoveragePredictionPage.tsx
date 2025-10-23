import React from 'react';
import { useNavigate } from 'react-router-dom';
import FileUpload from '../components/FileUpload';
import ResultsTable from '../components/ResultsTable';
import MapView from '../components/MapView';
import { useCoveragePrediction } from '../hooks/useCoveragePrediction';
import {
  TacticalCard,
  TacticalButton,
  TacticalHeader,
  TacticalBadge,
} from '../tactical-ui';

const CoveragePredictionPage: React.FC = () => {
  const navigate = useNavigate();
  const {
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
  } = useCoveragePrediction();

  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title="True Cover / Coverage Prediction"
        subtitle="Upload sample frame and survey data to predict coverage patterns"
        actions={
          <TacticalButton
            variant="secondary"
            size="sm"
            onClick={() => {
              navigate('/');
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

            <ResultsTable resultText={JSON.stringify(predictionResult, null, 2)} />
          </TacticalCard>
        )}
      </div>
    </div>
  );
};

export default CoveragePredictionPage;
