import React, { useState, useMemo, useEffect } from 'react';
import { TacticalModal, TacticalButton, TacticalBadge } from '../tactical-ui';
import FileUpload from './FileUpload';
import { FileData } from '../types';

interface GenerateMockVisitDataModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GenerateMockVisitDataModal: React.FC<GenerateMockVisitDataModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [selectedRounds, setSelectedRounds] = useState<number[]>([]);
  const [exportFormat, setExportFormat] = useState<'geojson' | 'csv'>('geojson');
  const [step, setStep] = useState<1 | 2>(1);

  // Extract unique rounds from the uploaded file
  const availableRounds = useMemo(() => {
    if (!fileData || !fileData.data.features) return [];

    const roundsSet = new Set<number>();
    fileData.data.features.forEach((feature: any) => {
      const rounds = feature.properties?.rounds || [];
      rounds.forEach((round: number) => roundsSet.add(round));
    });

    return Array.from(roundsSet).sort((a, b) => a - b);
  }, [fileData]);

  const handleFileLoaded = (data: FileData) => {
    setFileData(data);
  };

  // Automatically advance to step 2 when valid data is loaded
  useEffect(() => {
    if (fileData && fileData.data.features && availableRounds.length > 0) {
      setStep(2);
    }
  }, [fileData, availableRounds]);

  const handleContinueToStep2 = () => {
    setStep(2);
  };

  const handleBackToStep1 = () => {
    setStep(1);
  };

  const handleRoundToggle = (round: number) => {
    setSelectedRounds(prev => {
      if (prev.includes(round)) {
        return prev.filter(r => r !== round);
      } else {
        return [...prev, round];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedRounds.length === availableRounds.length) {
      setSelectedRounds([]);
    } else {
      setSelectedRounds([...availableRounds]);
    }
  };

  const generateMockData = () => {
    if (!fileData || !fileData.data.features) {
      alert('No data to process');
      return;
    }

    // Filter locations that have at least one selected round
    const locationsWithSelectedRounds = fileData.data.features.filter((feature: any) => {
      const featureRounds = feature.properties?.rounds || [];
      return selectedRounds.some(round => featureRounds.includes(round));
    });

    // Generate mock visit data for each location
    const mockData = locationsWithSelectedRounds.map((feature: any) => {
      // Generate random n_trials (0-8) and n_covered (0 to n_trials)
      const nTrials = Math.floor(Math.random() * 9); // 0 to 8
      const nCovered = Math.floor(Math.random() * (nTrials + 1)); // 0 to n_trials

      return {
        ...feature,
        properties: {
          ...feature.properties,
          n_trials: nTrials,
          n_covered: nCovered
        }
      };
    });

    // Create filename
    const timestamp = new Date().toISOString().split('T')[0];
    const roundsStr = selectedRounds.sort((a, b) => a - b).join('-');
    const filename = `mock-visit-data-rounds-${roundsStr}-${timestamp}`;

    if (exportFormat === 'csv') {
      // Export as CSV
      const csvContent = convertToCSV(mockData);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      // Export as GeoJSON
      const exportData = {
        type: 'FeatureCollection',
        features: mockData.map((feature: any) => ({
          type: 'Feature',
          id: feature.id,
          geometry: feature.geometry,
          properties: {
            location_id: feature.properties?.id || feature.id,
            latitude: feature.properties?.latitude,
            longitude: feature.properties?.longitude,
            rounds: feature.properties?.rounds || [],
            n_trials: feature.properties?.n_trials,
            n_covered: feature.properties?.n_covered
          }
        }))
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.geojson`;
      link.click();
      URL.revokeObjectURL(url);
    }

    // Close modal after export
    handleClose();
  };

  const convertToCSV = (features: any[]): string => {
    // CSV Headers
    const headers = ['location_id', 'latitude', 'longitude', 'rounds', 'n_trials', 'n_covered'];
    const csvRows = [headers.join(',')];

    // Convert each feature to CSV row
    features.forEach((feature: any) => {
      const props = feature.properties || {};
      const locationId = props.id || feature.id || '';
      const latitude = props.latitude || '';
      const longitude = props.longitude || '';
      const rounds = props.rounds || [];
      const roundsStr = rounds.join(',');
      const nTrials = props.n_trials ?? '';
      const nCovered = props.n_covered ?? '';

      const row = [
        escapeCSVValue(locationId),
        escapeCSVValue(latitude),
        escapeCSVValue(longitude),
        `"${roundsStr}"`,
        escapeCSVValue(nTrials),
        escapeCSVValue(nCovered)
      ];

      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  };

  const escapeCSVValue = (value: any): string => {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleClose = () => {
    setFileData(null);
    setSelectedRounds([]);
    setStep(1);
    onClose();
  };

  // Count locations that will get mock data
  const mockDataCount = useMemo(() => {
    if (!fileData || !fileData.data.features || selectedRounds.length === 0) return 0;

    return fileData.data.features.filter((feature: any) => {
      const featureRounds = feature.properties?.rounds || [];
      return selectedRounds.some(round => featureRounds.includes(round));
    }).length;
  }, [fileData, selectedRounds]);

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Generate Mock Visit Data"
      size="md"
    >
      <div className="space-y-4">
        {/* Step Indicator */}
        <div className="flex items-center gap-4 pb-4 border-b border-tactical-border-medium">
          <div
            className={`flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity ${step === 1 ? 'opacity-100' : 'opacity-50'}`}
            onClick={() => setStep(1)}
          >
            <TacticalBadge variant={step === 1 ? "primary" : "secondary"}>STEP 1</TacticalBadge>
            <span className="text-sm font-mono text-tactical-text-primary">Upload Data</span>
          </div>
          <div className="flex-1 h-px bg-tactical-border-medium"></div>
          <div className={`flex items-center gap-2 ${step === 2 ? 'opacity-100' : 'opacity-50'}`}>
            <TacticalBadge variant={step === 2 ? "primary" : "secondary"}>STEP 2</TacticalBadge>
            <span className="text-sm font-mono text-tactical-text-primary">Configure & Export</span>
          </div>
        </div>

        {/* Step 1: Upload File */}
        {step === 1 && (
          <FileUpload
            onFileLoaded={handleFileLoaded}
            label="Upload Location Data (CSV or GeoJSON)"
          />
        )}

        {/* Step 2: Configure and Export */}
        {step === 2 && fileData && (
          <>
            <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
              <div className="text-sm font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Locations loaded:</span>
                  <span className="text-tactical-text-primary font-bold">{fileData.data.features.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Rounds available:</span>
                  <span className="text-tactical-text-primary font-bold">{availableRounds.join(', ')}</span>
                </div>
              </div>
            </div>

            {/* Rounds Selection */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                  Select Rounds
                </label>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-xs text-tactical-accent-orange hover:underline font-mono"
                  disabled={availableRounds.length === 0}
                >
                  {selectedRounds.length === availableRounds.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {availableRounds.length === 0 ? (
                <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary text-center">
                  <p className="text-sm text-tactical-text-dim">No rounds found in uploaded data</p>
                </div>
              ) : (
                <div className="border border-tactical-border-medium bg-tactical-bg-secondary">
                  {availableRounds.map((round) => (
                    <label
                      key={round}
                      className="flex items-center gap-3 p-3 border-b border-tactical-border-medium last:border-b-0 hover:bg-tactical-bg-tertiary cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRounds.includes(round)}
                        onChange={() => handleRoundToggle(round)}
                        className="w-4 h-4 bg-tactical-bg-secondary border-2 border-tactical-border-medium checked:bg-tactical-accent-green checked:border-tactical-accent-green focus:outline-none focus:ring-2 focus:ring-tactical-accent-orange"
                      />
                      <div className="flex-1">
                        <TacticalBadge variant="success">Round {round}</TacticalBadge>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Export Format */}
            <div>
              <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                Export Format
              </label>
              <div className="flex gap-3">
                <label className="flex-1 flex items-center gap-3 p-3 border border-tactical-border-medium bg-tactical-bg-secondary hover:bg-tactical-bg-tertiary cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="exportFormat"
                    checked={exportFormat === 'geojson'}
                    onChange={() => setExportFormat('geojson')}
                    className="w-4 h-4 bg-tactical-bg-secondary border-2 border-tactical-border-medium checked:bg-tactical-accent-green checked:border-tactical-accent-green focus:outline-none focus:ring-2 focus:ring-tactical-accent-orange"
                  />
                  <div className="flex-1">
                    <div className="text-sm text-tactical-text-primary font-mono">GeoJSON</div>
                  </div>
                </label>
                <label className="flex-1 flex items-center gap-3 p-3 border border-tactical-border-medium bg-tactical-bg-secondary hover:bg-tactical-bg-tertiary cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="exportFormat"
                    checked={exportFormat === 'csv'}
                    onChange={() => setExportFormat('csv')}
                    className="w-4 h-4 bg-tactical-bg-secondary border-2 border-tactical-border-medium checked:bg-tactical-accent-green checked:border-tactical-accent-green focus:outline-none focus:ring-2 focus:ring-tactical-accent-orange"
                  />
                  <div className="flex-1">
                    <div className="text-sm text-tactical-text-primary font-mono">CSV</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Summary */}
            <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
              <div className="flex items-center gap-2 mb-2">
                <TacticalBadge variant="info">GENERATION SUMMARY</TacticalBadge>
              </div>
              <div className="text-sm font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Locations to generate data for:</span>
                  <span className="text-tactical-text-primary font-bold">{mockDataCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Selected rounds:</span>
                  <span className="text-tactical-text-primary font-bold">{selectedRounds.length}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-tactical-text-dim font-mono">
                Each location will get random n_trials (0-8) and n_covered (0 to n_trials)
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end pt-2">
              <TacticalButton
                type="button"
                variant="secondary"
                onClick={handleBackToStep1}
              >
                ← Back
              </TacticalButton>
              <TacticalButton
                type="button"
                variant="primary"
                onClick={generateMockData}
                disabled={mockDataCount === 0 || selectedRounds.length === 0}
              >
                {exportFormat === 'csv' ? 'Generate & Export CSV' : 'Generate & Export GeoJSON'}
              </TacticalButton>
            </div>
          </>
        )}
      </div>
    </TacticalModal>
  );
};

export default GenerateMockVisitDataModal;
