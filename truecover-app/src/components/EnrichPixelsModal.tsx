// ABOUTME: Modal for enriching pixels with metadata from COG/STAC data sources
// ABOUTME: Allows selecting data source and statistic, then creates async enrichment job

import React, { useState } from 'react';
import { TacticalModal, TacticalButton, TacticalSelect, tacticalToast } from '../tactical-ui';
import { useDataSources } from '../hooks/useDataSources';
import { useCreateEnrichmentJob } from '../hooks/useEnrichment';

interface EnrichPixelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  pixelCount: number;
  onJobCreated?: (jobId: string) => void;
}

const STATISTICS = [
  { value: 'sum', label: 'Sum', description: 'Total value within pixel (good for population counts)' },
  { value: 'mean', label: 'Mean', description: 'Average value within pixel (good for densities, elevations)' },
  { value: 'min', label: 'Min', description: 'Minimum value within pixel' },
  { value: 'max', label: 'Max', description: 'Maximum value within pixel' },
  { value: 'count', label: 'Count', description: 'Number of raster cells within pixel' },
];

const EnrichPixelsModal: React.FC<EnrichPixelsModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  pixelCount,
  onJobCreated
}) => {
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string>('');
  const [selectedStatistic, setSelectedStatistic] = useState<string>('');

  const { data: dataSourcesData, isLoading: isLoadingDataSources } = useDataSources();
  const createJob = useCreateEnrichmentJob();

  const dataSources = dataSourcesData?.data_sources || [];
  const selectedDataSource = dataSources.find((ds: any) => ds.id === selectedDataSourceId);

  // Set default statistic when data source changes
  React.useEffect(() => {
    if (selectedDataSource && !selectedStatistic) {
      setSelectedStatistic(selectedDataSource.default_statistic || 'sum');
    }
  }, [selectedDataSource, selectedStatistic]);

  const handleEnrich = async () => {
    if (!selectedDataSourceId) {
      tacticalToast.warning('Missing Selection', 'Please select a data source');
      return;
    }

    if (!selectedStatistic) {
      tacticalToast.warning('Missing Selection', 'Please select a statistic');
      return;
    }

    try {
      const result = await createJob.mutateAsync({
        campaignId,
        dataSourceId: selectedDataSourceId,
        statistic: selectedStatistic
      });

      tacticalToast.info(
        'Enrichment Job Started',
        `Job is running in the background. You'll be notified when it completes.`
      );

      if (onJobCreated) {
        onJobCreated(result.id);
      }

      onClose();
    } catch (error: any) {
      console.error('Error creating enrichment job:', error);
      tacticalToast.error(
        'Failed to Create Job',
        error.message || 'Unknown error occurred'
      );
    }
  };

  const handleClose = () => {
    if (!createJob.isPending) {
      onClose();
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Enrich Pixels"
      size="lg"
    >
      <div className="space-y-6">
        {/* Pixel Count Info */}
        <div className="p-3 bg-tactical-bg-secondary border border-tactical-border-medium">
          <div className="font-mono text-xs text-tactical-text-muted mb-1">Pixels in Area</div>
          <div className="font-mono text-lg text-tactical-text-primary">
            {pixelCount.toLocaleString()} pixels
          </div>
          <div className="font-mono text-xs text-tactical-text-dim mt-1">
            Will be enriched with metadata from selected data source
          </div>
        </div>

        {/* Data Source Selector */}
        <div>
          <div className="mb-2 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider">
            Data Source
          </div>
          {isLoadingDataSources ? (
            <div className="p-3 bg-tactical-bg-tertiary border border-tactical-border-medium font-mono text-xs text-tactical-text-dim">
              Loading data sources...
            </div>
          ) : dataSources.length === 0 ? (
            <div className="p-3 bg-tactical-bg-tertiary border border-tactical-border-medium font-mono text-xs text-tactical-text-dim">
              No data sources configured. Please create a data source first.
            </div>
          ) : (
            <TacticalSelect
              value={selectedDataSourceId}
              onChange={setSelectedDataSourceId}
              options={[
                { value: '', label: 'Select a data source...' },
                ...dataSources.map((ds: any) => ({
                  value: ds.id,
                  label: `${ds.name} (${ds.metadata_field_name})`
                }))
              ]}
            />
          )}
        </div>

        {/* Selected Data Source Details */}
        {selectedDataSource && (
          <div className="p-3 bg-tactical-bg-tertiary border border-tactical-border-medium">
            <div className="font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider mb-2">
              Data Source Details
            </div>
            <div className="space-y-2 font-mono text-xs">
              <div>
                <span className="text-tactical-text-muted">Description:</span>{' '}
                <span className="text-tactical-text-secondary">{selectedDataSource.description || 'N/A'}</span>
              </div>
              <div>
                <span className="text-tactical-text-muted">Field Name:</span>{' '}
                <span className="text-tactical-text-secondary">{selectedDataSource.metadata_field_name}</span>
              </div>
              <div>
                <span className="text-tactical-text-muted">Type:</span>{' '}
                <span className="text-tactical-text-secondary">{selectedDataSource.metadata_field_type}</span>
              </div>
              {selectedDataSource.metadata_field_unit && (
                <div>
                  <span className="text-tactical-text-muted">Unit:</span>{' '}
                  <span className="text-tactical-text-secondary">{selectedDataSource.metadata_field_unit}</span>
                </div>
              )}
              <div>
                <span className="text-tactical-text-muted">Source:</span>{' '}
                <span className="text-tactical-text-secondary">
                  {selectedDataSource.source_type === 'stac'
                    ? `STAC: ${selectedDataSource.stac_collection}/${selectedDataSource.stac_item}`
                    : 'Direct COG URL'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Statistic Selector */}
        {selectedDataSource && (
          <div>
            <div className="mb-2 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider">
              Statistic
            </div>
            <TacticalSelect
              value={selectedStatistic}
              onChange={setSelectedStatistic}
              options={STATISTICS.map(stat => ({
                value: stat.value,
                label: stat.label
              }))}
            />
            {selectedStatistic && (
              <div className="mt-2 p-2 bg-tactical-bg-secondary border border-tactical-border-dark font-mono text-xs text-tactical-text-dim">
                {STATISTICS.find(s => s.value === selectedStatistic)?.description}
              </div>
            )}
          </div>
        )}

        {/* Info Box */}
        <div className="p-3 bg-tactical-bg-secondary border border-tactical-border-medium font-mono text-xs text-tactical-text-dim">
          <div className="mb-1 font-bold text-tactical-text-muted uppercase">Note:</div>
          <div>This will create an asynchronous enrichment job that runs in the background. You'll receive a notification when the job completes. The metadata will be added to pixels and will appear in pixel popups on the map.</div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <TacticalButton
            variant="secondary"
            onClick={handleClose}
            disabled={createJob.isPending}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            variant="primary"
            onClick={handleEnrich}
            disabled={!selectedDataSourceId || !selectedStatistic || createJob.isPending || pixelCount === 0}
          >
            {createJob.isPending ? 'Creating Job...' : 'Start Enrichment'}
          </TacticalButton>
        </div>
      </div>
    </TacticalModal>
  );
};

export default EnrichPixelsModal;
