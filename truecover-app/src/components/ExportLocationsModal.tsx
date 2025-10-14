import React, { useState, useMemo, useEffect } from 'react';
import { TacticalModal, TacticalButton, TacticalBadge, TacticalSelect } from '../tactical-ui';
import { useRounds } from '../hooks/useRounds';
import { useIndicators } from '../hooks/useIndicators';
import { useCoverage } from '../hooks/useCoverage';

interface ExportLocationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  areaName: string;
  projectId: string;
  locations: any; // GeoJSON FeatureCollection
}

const ExportLocationsModal: React.FC<ExportLocationsModalProps> = ({
  isOpen,
  onClose,
  areaId,
  areaName,
  projectId,
  locations,
}) => {
  const { data: rounds = [], isLoading: loadingRounds } = useRounds(areaId);
  const { data: indicators = [] } = useIndicators(projectId);
  const { listCoverage } = useCoverage();

  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [selectedRoundIds, setSelectedRoundIds] = useState<string[]>([]);
  const [coverageData, setCoverageData] = useState<any[]>([]);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);
  const [includeAllPoints, setIncludeAllPoints] = useState(true);
  const [exportFormat, setExportFormat] = useState<'geojson' | 'csv'>('geojson');

  // Set default indicator when indicators load
  useEffect(() => {
    if (indicators && indicators.length > 0 && !selectedIndicatorId) {
      setSelectedIndicatorId(indicators[0].id);
    }
  }, [indicators]);

  // Load coverage data when indicator or rounds change
  useEffect(() => {
    const loadCoverageData = async () => {
      if (!areaId || !selectedIndicatorId) {
        setCoverageData([]);
        return;
      }

      setIsLoadingCoverage(true);
      try {
        // Load all coverage data for the indicator
        const data = await listCoverage({
          area_id: areaId,
          indicator_id: selectedIndicatorId,
        });
        setCoverageData(data);
      } catch (error) {
        console.error('Error loading coverage data:', error);
        setCoverageData([]);
      } finally {
        setIsLoadingCoverage(false);
      }
    };

    loadCoverageData();
  }, [areaId, selectedIndicatorId]);

  // Calculate how many locations would be exported
  const exportCount = useMemo(() => {
    if (!coverageData || coverageData.length === 0) return 0;

    if (includeAllPoints) {
      // Count all coverage records with rounds data
      return coverageData.filter(record => record.rounds && record.rounds.length > 0).length;
    }

    // Get the round numbers from selected round IDs
    const selectedRoundNumbers = rounds
      .filter(r => selectedRoundIds.includes(r.id))
      .map(r => r.round_number);

    // Count coverage records that have data in selected rounds
    return coverageData.filter((record: any) => {
      const recordRounds = record.rounds || [];
      return selectedRoundNumbers.some((roundNum: number) =>
        recordRounds.includes(roundNum)
      );
    }).length;
  }, [coverageData, includeAllPoints, selectedRoundIds, rounds]);

  const handleExport = () => {
    if (!coverageData || coverageData.length === 0) {
      alert('No coverage data available to export');
      return;
    }

    // Filter coverage data based on settings
    let filteredData = coverageData.filter(record => record.rounds && record.rounds.length > 0);

    if (!includeAllPoints && selectedRoundIds.length > 0) {
      // Get the round numbers from selected round IDs
      const selectedRoundNumbers = rounds
        .filter(r => selectedRoundIds.includes(r.id))
        .map(r => r.round_number);

      filteredData = filteredData.filter((record: any) => {
        const recordRounds = record.rounds || [];
        return selectedRoundNumbers.some((roundNum: number) =>
          recordRounds.includes(roundNum)
        );
      });
    }

    // Get indicator name
    const indicator = indicators.find(ind => ind.id === selectedIndicatorId);
    const indicatorName = indicator?.name || 'unknown';
    const sanitizedIndicatorName = indicatorName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    // Create filename with area name, indicator, rounds (if selected), and timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedAreaName = areaName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    // Build filename parts
    let filename = `locations-to-visit-${sanitizedAreaName}-${sanitizedIndicatorName}`;

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
      const csvContent = convertCoverageToCSV(filteredData);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      // Export as GeoJSON - join with locations to get geometry
      const exportData = {
        type: 'FeatureCollection',
        features: filteredData
          .map((record: any) => {
            // Find the matching location by location_id
            const matchingLocation = locations?.features?.find((feature: any) =>
              feature.properties?.id === record.location_id
            );

            // Skip if no matching location found (shouldn't happen but just in case)
            if (!matchingLocation?.geometry) {
              console.warn(`No geometry found for location ${record.location_id}`);
              return null;
            }

            return {
              type: 'Feature',
              id: record.id,
              geometry: matchingLocation.geometry,
              properties: {
                location_id: record.location_id,
                external_id: record.external_id,
                latitude: record.latitude,
                longitude: record.longitude,
                rounds: record.rounds,
                indicator_name: record.indicator_name,
                n_trials: record.n_trials,
                n_covered: record.n_covered,
                exceedance_probability: record.exceedance_probability,
                exceedance_uncertainty: record.exceedance_uncertainty,
                prevalence_bci_width: record.prevalence_bci_width,
                prevalence_prediction: record.prevalence_prediction
              }
            };
          })
          .filter(feature => feature !== null) // Remove any features without geometry
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

  const convertCoverageToCSV = (records: any[]): string => {
    // CSV Headers
    const headers = [
      'location_id',
      'external_id',
      'latitude',
      'longitude',
      'rounds',
      'indicator_name',
      'n_trials',
      'n_covered',
      'exceedance_probability',
      'exceedance_uncertainty',
      'prevalence_bci_width',
      'prevalence_prediction'
    ];
    const csvRows = [headers.join(',')];

    // Convert each record to CSV row
    records.forEach((record: any) => {
      // Handle rounds array - format as quoted comma-separated string
      const roundsStr = (record.rounds || []).join(',');

      // Escape values that might contain commas or quotes
      const row = [
        escapeCSVValue(record.location_id || ''),
        escapeCSVValue(record.external_id || ''),
        escapeCSVValue(record.latitude || ''),
        escapeCSVValue(record.longitude || ''),
        `"${roundsStr}"`, // Always quote the rounds field
        escapeCSVValue(record.indicator_name || ''),
        escapeCSVValue(record.n_trials || ''),
        escapeCSVValue(record.n_covered || ''),
        escapeCSVValue(record.exceedance_probability || ''),
        escapeCSVValue(record.exceedance_uncertainty || ''),
        escapeCSVValue(record.prevalence_bci_width || ''),
        escapeCSVValue(record.prevalence_prediction || '')
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
    // Filter to only rounds with coverage data
    const roundsWithCoverage = rounds.filter((round) => {
      const locationsInRound = coverageData.filter((record: any) => {
        const recordRounds = record.rounds || [];
        return recordRounds.includes(round.round_number);
      }).length;
      return locationsInRound > 0;
    });

    if (selectedRoundIds.length === roundsWithCoverage.length) {
      setSelectedRoundIds([]);
    } else {
      setSelectedRoundIds(roundsWithCoverage.map(r => r.id));
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Locations to Visit"
      size="md"
    >
      <div className="space-y-4">
        {/* Indicator Selection */}
        <div>
          <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
            Indicator
          </label>
          <TacticalSelect
            value={selectedIndicatorId}
            onChange={setSelectedIndicatorId}
            options={indicators.map(ind => ({
              value: ind.id,
              label: ind.name
            }))}
            placeholder="Select Indicator"
          />
        </div>

        {/* Rounds Selection */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
              Rounds
            </label>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-tactical-accent-orange hover:underline font-mono disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loadingRounds || rounds.length === 0 || isLoadingCoverage}
            >
              {(() => {
                const roundsWithCoverage = rounds.filter((round) => {
                  const locationsInRound = coverageData.filter((record: any) => {
                    const recordRounds = record.rounds || [];
                    return recordRounds.includes(round.round_number);
                  }).length;
                  return locationsInRound > 0;
                });
                return selectedRoundIds.length === roundsWithCoverage.length && roundsWithCoverage.length > 0 ? 'Deselect All' : 'Select All';
              })()}
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
              {isLoadingCoverage ? (
                <div className="p-3 text-center">
                  <p className="text-sm text-tactical-text-dim">Loading coverage data...</p>
                </div>
              ) : (
                (() => {
                  // Filter rounds to only show those with coverage data for the selected indicator
                  const roundsWithCoverage = rounds.filter((round) => {
                    const locationsInRound = coverageData.filter((record: any) => {
                      const recordRounds = record.rounds || [];
                      return recordRounds.includes(round.round_number);
                    }).length;
                    return locationsInRound > 0;
                  });

                  if (roundsWithCoverage.length === 0) {
                    return (
                      <div className="p-3 text-center">
                        <p className="text-sm text-tactical-text-dim">No rounds with coverage data for this indicator</p>
                      </div>
                    );
                  }

                  return roundsWithCoverage.map((round) => {
                    // Count coverage records in this round
                    const locationsInRound = coverageData.filter((record: any) => {
                      const recordRounds = record.rounds || [];
                      return recordRounds.includes(round.round_number);
                    }).length;

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
                  });
                })()
              )}
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
