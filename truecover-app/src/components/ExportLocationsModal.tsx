import React, { useState, useMemo } from 'react';
import { TacticalModal, TacticalButton, TacticalBadge, TacticalSelect } from '../tactical-ui';
import { useRounds } from '../hooks/useRounds';

interface ExportLocationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  areaName: string;
  locations: any; // GeoJSON FeatureCollection
}

const ExportLocationsModal: React.FC<ExportLocationsModalProps> = ({
  isOpen,
  onClose,
  areaId,
  areaName,
  locations,
}) => {
  const { data: rounds = [], isLoading: loadingRounds } = useRounds(areaId);
  const [selectedRoundIds, setSelectedRoundIds] = useState<string[]>([]);
  const [includeAllPoints, setIncludeAllPoints] = useState(true);
  const [exportFormat, setExportFormat] = useState<'geojson' | 'csv'>('geojson');

  // Calculate how many locations would be exported
  const exportCount = useMemo(() => {
    if (!locations || !locations.features) return 0;

    if (includeAllPoints) {
      return locations.features.length;
    }

    // Get the round numbers from selected round IDs
    const selectedRoundNumbers = rounds
      .filter(r => selectedRoundIds.includes(r.id))
      .map(r => r.round_number);

    // Count locations that have data in selected rounds
    return locations.features.filter((feature: any) => {
      const locationRounds = feature.properties?.rounds || [];
      return selectedRoundNumbers.some((roundNum: number) =>
        locationRounds.includes(roundNum)
      );
    }).length;
  }, [locations, includeAllPoints, selectedRoundIds, rounds]);

  const handleExport = () => {
    if (!locations || !locations.features) {
      alert('No location data available to export');
      return;
    }

    // Filter locations based on settings
    let filteredFeatures = locations.features;

    if (!includeAllPoints && selectedRoundIds.length > 0) {
      // Get the round numbers from selected round IDs
      const selectedRoundNumbers = rounds
        .filter(r => selectedRoundIds.includes(r.id))
        .map(r => r.round_number);

      filteredFeatures = locations.features.filter((feature: any) => {
        const locationRounds = feature.properties?.rounds || [];
        return selectedRoundNumbers.some((roundNum: number) =>
          locationRounds.includes(roundNum)
        );
      });
    }

    // Create filename with area name, rounds (if selected), and timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedAreaName = areaName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    // Build filename parts
    let filename = `locations-export-${sanitizedAreaName}`;

    // Include round numbers in filename if specific rounds are selected
    if (selectedRoundIds.length > 0) {
      const selectedRoundNumbers = rounds
        .filter(r => selectedRoundIds.includes(r.id))
        .map(r => r.round_number)
        .sort((a, b) => a - b);
      filename += `-rounds-${selectedRoundNumbers.join('-')}`;
    }

    filename += `-${timestamp}`;

    if (exportFormat === 'csv') {
      // Export as CSV
      const csvContent = convertToCSV(filteredFeatures);
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
        features: filteredFeatures.map((feature: any) => ({
          type: 'Feature',
          id: feature.id,
          geometry: feature.geometry,
          properties: {
            location_id: feature.properties?.id || feature.id,
            latitude: feature.properties?.latitude,
            longitude: feature.properties?.longitude,
            rounds: feature.properties?.rounds || []
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
    onClose();
  };

  const convertToCSV = (features: any[]): string => {
    // CSV Headers
    const headers = ['location_id', 'latitude', 'longitude', 'rounds'];
    const csvRows = [headers.join(',')];

    // Convert each feature to CSV row
    features.forEach((feature: any) => {
      const props = feature.properties || {};
      const locationId = props.id || feature.id || '';
      const latitude = props.latitude || '';
      const longitude = props.longitude || '';

      // Handle rounds array - format as quoted comma-separated string
      const rounds = props.rounds || [];
      const roundsStr = rounds.join(',');

      // Escape values that might contain commas or quotes
      const row = [
        escapeCSVValue(locationId),
        escapeCSVValue(latitude),
        escapeCSVValue(longitude),
        `"${roundsStr}"` // Always quote the rounds field
      ];

      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  };

  const escapeCSVValue = (value: any): string => {
    const str = String(value);
    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleRoundToggle = (roundId: string) => {
    setSelectedRoundIds(prev => {
      if (prev.includes(roundId)) {
        return prev.filter(id => id !== roundId);
      } else {
        return [...prev, roundId];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedRoundIds.length === rounds.length) {
      setSelectedRoundIds([]);
    } else {
      setSelectedRoundIds(rounds.map(r => r.id));
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Locations"
      size="md"
    >
      <div className="space-y-4">
        {/* Rounds Selection */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
              Rounds
            </label>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-tactical-accent-orange hover:underline font-mono"
              disabled={loadingRounds || rounds.length === 0}
            >
              {selectedRoundIds.length === rounds.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {loadingRounds ? (
            <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary text-center">
              <p className="text-sm text-tactical-text-dim">Loading rounds...</p>
            </div>
          ) : rounds.length === 0 ? (
            <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary text-center">
              <p className="text-sm text-tactical-text-dim">No rounds available</p>
            </div>
          ) : (
            <div className="border border-tactical-border-medium bg-tactical-bg-secondary max-h-48 overflow-y-auto tactical-scrollbar">
              {rounds.map((round) => {
                // Count locations in this round
                const locationsInRound = locations?.features?.filter((feature: any) => {
                  const featureRounds = feature.properties?.rounds || [];
                  return featureRounds.includes(round.round_number);
                }).length || 0;

                return (
                  <label
                    key={round.id}
                    className="flex items-center gap-3 p-3 border-b border-tactical-border-medium last:border-b-0 hover:bg-tactical-bg-tertiary cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoundIds.includes(round.id)}
                      onChange={() => handleRoundToggle(round.id)}
                      className="w-4 h-4 bg-tactical-bg-secondary border-2 border-tactical-border-medium checked:bg-tactical-accent-green checked:border-tactical-accent-green focus:outline-none focus:ring-2 focus:ring-tactical-accent-orange"
                    />
                    <div className="flex-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TacticalBadge variant="success">
                          Round {round.round_number}
                        </TacticalBadge>
                        <span className="text-sm text-tactical-text-primary font-mono">
                          {round.name}
                        </span>
                      </div>
                      <span className="text-xs text-tactical-text-dim font-mono">
                        {locationsInRound} {locationsInRound === 1 ? 'location' : 'locations'}
                      </span>
                    </div>
                  </label>
                );
              })}
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

        {/* Filter Options */}
        <div>
          <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
            Filter Options
          </label>
          <label className="flex items-start gap-3 p-3 border border-tactical-border-medium bg-tactical-bg-secondary hover:bg-tactical-bg-tertiary cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={includeAllPoints}
              onChange={(e) => setIncludeAllPoints(e.target.checked)}
              className="mt-0.5 w-4 h-4 bg-tactical-bg-secondary border-2 border-tactical-border-medium checked:bg-tactical-accent-green checked:border-tactical-accent-green focus:outline-none focus:ring-2 focus:ring-tactical-accent-orange"
            />
            <div className="flex-1">
              <div className="text-sm text-tactical-text-primary font-mono">
                Include all locations
              </div>
              <div className="text-xs text-tactical-text-dim font-mono mt-1">
                When enabled, exports all locations regardless of round selection. When disabled, only exports locations with data in selected rounds.
              </div>
            </div>
          </label>
        </div>

        {/* Data Summary */}
        <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
          <div className="flex items-center gap-2 mb-2">
            <TacticalBadge variant="info">EXPORT SUMMARY</TacticalBadge>
          </div>
          <div className="text-sm font-mono space-y-1">
            <div className="flex justify-between">
              <span className="text-tactical-text-dim">Locations to export:</span>
              <span className="text-tactical-text-primary font-bold">{exportCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tactical-text-dim">Selected rounds:</span>
              <span className="text-tactical-text-primary font-bold">{selectedRoundIds.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tactical-text-dim">Area:</span>
              <span className="text-tactical-text-primary">{areaName}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end pt-2">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="button"
            variant="primary"
            onClick={handleExport}
            disabled={exportCount === 0}
          >
            {exportFormat === 'csv' ? 'Export CSV' : 'Export GeoJSON'}
          </TacticalButton>
        </div>
      </div>
    </TacticalModal>
  );
};

export default ExportLocationsModal;
