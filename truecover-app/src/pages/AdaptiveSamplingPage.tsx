import React from 'react';
import { useNavigate } from 'react-router-dom';
import FileUpload from '../components/FileUpload';
import SamplingForm from '../components/SamplingForm';
import ResultsTable from '../components/ResultsTable';
import MapView from '../components/MapView';
import { useAdaptiveSampling } from '../hooks/useAdaptiveSampling';
import {
  TacticalCard,
  TacticalButton,
  TacticalHeader,
  TacticalBadge,
} from '../tactical-ui';

const AdaptiveSamplingPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    fileData,
    isLoading,
    result,
    error,
    handleFileLoaded,
    handleSubmit,
    handleDownload,
    handleCopy,
  } = useAdaptiveSampling();

  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title="True Cover / Adaptive Sampling"
        subtitle="Upload a GeoJSON or CSV file to perform adaptive sampling"
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
};

export default AdaptiveSamplingPage;
