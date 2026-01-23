// ABOUTME: Modal for exporting coverage data in CSV or GeoJSON formats
// ABOUTME: Allows users to select indicator and format before downloading

import React, { useState } from 'react';
import {
  TacticalModal,
  TacticalButton,
  TacticalSelect,
} from '../tactical-ui';
import { useCoverage } from '../hooks/useCoverage';

interface ExportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  projectId: string;
  indicators: Array<{ id: string; name: string }>;
}

const ExportDataModal: React.FC<ExportDataModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  indicators,
}) => {
  const [selectedIndicatorId, setSelectedIndicatorId] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<'csv' | 'geojson'>('csv');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { listCoverage, getCoverageGeoJSON } = useCoverage();

  // Set default indicator when modal opens
  React.useEffect(() => {
    if (isOpen && indicators && indicators.length > 0 && !selectedIndicatorId) {
      setSelectedIndicatorId(indicators[0].id);
    }
  }, [isOpen, indicators]);

  const handleExport = async () => {
    if (!selectedIndicatorId || !campaignId) {
      setError('Please select an indicator');
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      console.log('Starting export:', { selectedIndicatorId, campaignId, selectedFormat });

      const indicator = indicators.find(ind => ind.id === selectedIndicatorId);
      const indicatorName = indicator?.name || 'coverage';
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${indicatorName.toLowerCase().replace(/\s+/g, '_')}_${timestamp}`;

      if (selectedFormat === 'csv') {
        console.log('Fetching CSV data...');
        // Fetch coverage data and export as CSV
        const data = await listCoverage({
          campaign_id: campaignId,
          indicator_id: selectedIndicatorId,
        });

        console.log('Data received:', data.length, 'records');

        if (data.length === 0) {
          setError('No data available to export');
          return;
        }

        // Convert to CSV
        const headers = [
          'location_id',
          'external_id',
          'latitude',
          'longitude',
          'rounds',
          'n_trials',
          'n_covered',
          'prevalence_prediction',
          'prevalence_bci_width',
          'exceedance_probability',
          'exceedance_uncertainty',
          'last_predicted_at',
        ];

        const csvRows = [
          headers.join(','),
          ...data.map(record => [
            record.location_id,
            record.external_id ?? '',
            record.latitude ?? '',
            record.longitude ?? '',
            record.rounds ? record.rounds.join(';') : '',
            record.n_trials,
            record.n_covered,
            record.prevalence_prediction ?? '',
            record.prevalence_bci_width ?? '',
            record.exceedance_probability ?? '',
            record.exceedance_uncertainty ?? '',
            record.last_predicted_at ?? '',
          ].join(','))
        ];

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${filename}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        console.log('CSV download triggered');
      } else {
        console.log('Fetching GeoJSON data...');
        // Fetch coverage GeoJSON and export
        const geojson = await getCoverageGeoJSON({
          campaign_id: campaignId,
          indicator_id: selectedIndicatorId,
        });

        console.log('GeoJSON received:', geojson);

        if (!geojson || !geojson.features || geojson.features.length === 0) {
          setError('No data available to export');
          return;
        }

        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${filename}.geojson`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        console.log('GeoJSON download triggered');
      }

      onClose();
    } catch (error) {
      console.error('Error exporting data:', error);
      setError(error instanceof Error ? error.message : 'Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Data"
      size="md"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-red-900/20 border border-red-600 text-red-400 text-sm font-mono">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-mono text-tactical-text-primary mb-2">
            Indicator
          </label>
          <TacticalSelect
            value={selectedIndicatorId}
            onChange={setSelectedIndicatorId}
            options={indicators.map(ind => ({
              value: ind.id,
              label: ind.name,
            }))}
            placeholder="Select Indicator"
          />
        </div>

        <div>
          <label className="block text-sm font-mono text-tactical-text-primary mb-2">
            Format
          </label>
          <TacticalSelect
            value={selectedFormat}
            onChange={(value) => setSelectedFormat(value as 'csv' | 'geojson')}
            options={[
              { value: 'csv', label: 'CSV' },
              { value: 'geojson', label: 'GeoJSON' },
            ]}
            placeholder="Select Format"
          />
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <TacticalButton
            variant="secondary"
            onClick={onClose}
            disabled={isExporting}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            variant="primary"
            onClick={handleExport}
            disabled={!selectedIndicatorId || isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </TacticalButton>
        </div>
      </div>
    </TacticalModal>
  );
};

export default ExportDataModal;
