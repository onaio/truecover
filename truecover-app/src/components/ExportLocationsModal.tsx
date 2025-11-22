import React, { useState, useMemo, useEffect } from 'react';
import { TacticalModal, TacticalButton, TacticalBadge, TacticalSelect } from '../tactical-ui';
import { useRounds } from '../hooks/useRounds';
import { useIndicators } from '../hooks/useIndicators';
import { useAllCoverageData } from '../hooks/useCoverageData';
import { useProject } from '../hooks/useProjects';
import { useAuth } from '@clerk/clerk-react';
import { onaApi, entityExportApi } from '../services/api';

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
  const { getToken } = useAuth();
  const { data: rounds = [], isLoading: loadingRounds } = useRounds(areaId);
  const { data: indicators = [] } = useIndicators(projectId);
  const { data: project } = useProject(projectId);

  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [selectedRoundIds, setSelectedRoundIds] = useState<string[]>([]);
  const [includeAllPoints, setIncludeAllPoints] = useState(true);
  const [exportFormat, setExportFormat] = useState<'geojson' | 'csv'>('geojson');
  const [exportDestination, setExportDestination] = useState<'download' | 'odk'>('download');

  // ODK entity state
  const [entityCount, setEntityCount] = useState<number>(0);
  const [isLoadingEntities, setIsLoadingEntities] = useState(false);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);

  // Entity export workflow state
  const [exportWorkflowId, setExportWorkflowId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{
    total_pixels: number;
    created_pixels: number;
    current_quadkey: string;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Use React Query hook to fetch ALL coverage data (not paginated)
  const { data: coverageDataResult, isLoading: isLoadingCoverage } = useAllCoverageData(
    areaId,
    selectedIndicatorId
  );

  // Flatten paginated data from infinite query
  const coverageData = useMemo(() => {
    if (!coverageDataResult?.pages) return [];
    return coverageDataResult.pages.flatMap(page => page.locationData);
  }, [coverageDataResult]);

  const coveragePixelData = useMemo(() => {
    if (!coverageDataResult?.pages) return [];
    return coverageDataResult.pages.flatMap(page => page.pixelData);
  }, [coverageDataResult]);

  // Get total counts from API (not paginated)
  const locationTotalCount = coverageDataResult?.pages?.[0]?.locationTotalCount || 0;
  const pixelTotalCount = coverageDataResult?.pages?.[0]?.pixelTotalCount || 0;

  // Set default indicator when indicators load
  useEffect(() => {
    if (indicators && indicators.length > 0 && !selectedIndicatorId) {
      setSelectedIndicatorId(indicators[0].id);
    }
  }, [indicators]);

  // Fetch entity count when ODK export is selected
  useEffect(() => {
    const fetchEntityCount = async () => {
      if (exportDestination !== 'odk') {
        setEntityCount(0);
        setEntitiesError(null);
        return;
      }

      // Check if entity list is configured
      if (!project?.ona_entity_list_id) {
        setEntitiesError('No entity list configured. Please configure ODK integration in project settings.');
        setEntityCount(0);
        setIsLoadingEntities(false);
        return;
      }

      setIsLoadingEntities(true);
      setEntitiesError(null);

      try {
        const token = await getToken();
        if (!token) {
          setEntitiesError('Authentication required');
          return;
        }

        const result = await onaApi.getEntities(projectId, token);

        if (result.error) {
          setEntitiesError(result.error);
          setEntityCount(0);
        } else {
          setEntityCount(result.count || 0);
        }
      } catch (err: any) {
        console.error('Failed to load entity count:', err);
        setEntitiesError(err.response?.data?.error || 'Failed to load entity count');
        setEntityCount(0);
      } finally {
        setIsLoadingEntities(false);
      }
    };

    fetchEntityCount();
  }, [exportDestination, projectId, project?.ona_entity_list_id, getToken]);

  // Poll for entity export workflow status
  useEffect(() => {
    if (!exportWorkflowId || !isExporting) {
      return;
    }

    const pollStatus = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const status = await entityExportApi.getWorkflowStatus(exportWorkflowId, token);

        if (status.status === 'running' && status.progress) {
          setExportProgress(status.progress);
        } else if (status.status === 'completed' && status.result) {
          setIsExporting(false);
          setExportProgress(null);
          setExportWorkflowId(null);
          alert(status.result.message);
          onClose();
        } else if (status.status === 'failed') {
          setIsExporting(false);
          setExportProgress(null);
          setExportWorkflowId(null);
          setExportError(status.error || 'Entity export failed');
          alert(`Export failed: ${status.error || 'Unknown error'}`);
        }
      } catch (err: any) {
        console.error('Failed to get workflow status:', err);
      }
    };

    // Poll every 2 seconds
    const interval = setInterval(pollStatus, 2000);
    pollStatus(); // Initial poll

    return () => clearInterval(interval);
  }, [exportWorkflowId, isExporting, getToken, onClose]);

  // Calculate how many items would be exported (locations + pixels)
  const exportCount = useMemo(() => {
    if (includeAllPoints) {
      // Use total counts from API instead of counting paginated data
      return locationTotalCount + pixelTotalCount;
    }

    if (!selectedRoundIds || selectedRoundIds.length === 0) {
      return 0;
    }

    // Get selected rounds and sum their counts
    const selectedRounds = rounds.filter(r => selectedRoundIds.includes(r.id));

    let count = 0;
    for (const round of selectedRounds) {
      const isPixelRound = round.sampling_target === 'pixels';
      count += isPixelRound ? round.pixel_count : round.location_count;
    }

    return count;
  }, [locationTotalCount, pixelTotalCount, includeAllPoints, selectedRoundIds, rounds]);

  const handleExport = async () => {
    // Handle ODK export via workflow
    if (exportDestination === 'odk') {
      if (selectedRoundIds.length === 0) {
        alert('Please select at least one round for ODK export');
        return;
      }

      if (!project?.ona_entity_list_id) {
        alert('Please configure ODK entity list in project settings');
        return;
      }

      try {
        setIsExporting(true);
        setExportError(null);

        const token = await getToken();
        if (!token) {
          alert('Authentication required');
          setIsExporting(false);
          return;
        }

        const result = await entityExportApi.startWorkflow(
          areaId,
          selectedIndicatorId,
          selectedRoundIds,
          projectId,
          token
        );

        setExportWorkflowId(result.workflow_id);
      } catch (err: any) {
        console.error('Failed to start entity export:', err);
        alert(`Failed to start export: ${err.response?.data?.error || err.message}`);
        setIsExporting(false);
      }

      return;
    }

    // Regular download export
    if ((!coverageData || coverageData.length === 0) && (!coveragePixelData || coveragePixelData.length === 0)) {
      alert('No coverage data available to export');
      return;
    }

    // Filter coverage data based on settings and sampling_target
    let filteredLocationData: any[] = [];
    let filteredPixelData: any[] = [];

    if (includeAllPoints) {
      // Export ALL coverage records for the indicator (both locations and pixels)
      filteredLocationData = coverageData || [];
      filteredPixelData = coveragePixelData || [];
    } else if (selectedRoundIds.length > 0) {
      // Get selected rounds with their sampling targets
      const selectedRounds = rounds.filter(r => selectedRoundIds.includes(r.id));

      // Separate rounds by sampling target
      const locationRounds = selectedRounds.filter(r => r.sampling_target === 'locations' || !r.sampling_target);
      const pixelRounds = selectedRounds.filter(r => r.sampling_target === 'pixels');

      // Filter location data for location rounds
      if (locationRounds.length > 0 && coverageData) {
        const locationRoundNumbers = locationRounds.map(r => r.round_number);
        filteredLocationData = coverageData.filter((record: any) => {
          const recordRounds = record.rounds || [];
          return recordRounds.length > 0 && locationRoundNumbers.some((roundNum: number) =>
            recordRounds.includes(roundNum)
          );
        });
      }

      // Filter pixel data for pixel rounds
      if (pixelRounds.length > 0 && coveragePixelData) {
        const pixelRoundNumbers = pixelRounds.map(r => r.round_number);
        filteredPixelData = coveragePixelData.filter((record: any) => {
          const recordRounds = record.rounds || [];
          return recordRounds.length > 0 && pixelRoundNumbers.some((roundNum: number) =>
            recordRounds.includes(roundNum)
          );
        });
      }
    } else {
      // No rounds selected and includeAllPoints is false - export nothing
      alert('Please select at least one round or enable "Include all items"');
      return;
    }

    // Check if we have any data to export
    if (filteredLocationData.length === 0 && filteredPixelData.length === 0) {
      alert('No data to export with current selection');
      return;
    }

    // Get indicator name
    const indicator = indicators.find(ind => ind.id === selectedIndicatorId);
    const indicatorName = indicator?.name || 'unknown';
    const sanitizedIndicatorName = indicatorName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    // Create filename with area name, indicator, rounds (if selected), and timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedAreaName = areaName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    // Build filename parts
    let filename = `samples-to-visit-${sanitizedAreaName}-${sanitizedIndicatorName}`;

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
      // Export as CSV - combine location and pixel data
      const csvContent = convertToCSV(filteredLocationData, filteredPixelData);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      // Export as GeoJSON - combine location and pixel features
      const features: any[] = [];

      // Add location features
      filteredLocationData.forEach((record: any) => {
        if (!record.latitude || !record.longitude) {
          console.warn(`No coordinates found for location ${record.location_id}`);
          return;
        }

        features.push({
          type: 'Feature',
          id: record.id,
          geometry: {
            type: 'Point',
            coordinates: [record.longitude, record.latitude]
          },
          properties: {
            sample_type: 'location',
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
        });
      });

      // Add pixel features
      filteredPixelData.forEach((record: any) => {
        if (!record.latitude || !record.longitude) {
          console.warn(`No coordinates found for pixel ${record.quadkey}`);
          return;
        }

        features.push({
          type: 'Feature',
          id: record.id,
          geometry: {
            type: 'Point',
            coordinates: [record.longitude, record.latitude]
          },
          properties: {
            sample_type: 'pixel',
            quadkey: record.quadkey,
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
        });
      });

      const exportData = {
        type: 'FeatureCollection',
        features
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

  const convertToCSV = (locationRecords: any[], pixelRecords: any[]): string => {
    // CSV Headers - include sample_type and both location_id/external_id and quadkey
    const headers = [
      'sample_type',
      'location_id',
      'external_id',
      'quadkey',
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

    // Convert location records to CSV rows
    locationRecords.forEach((record: any) => {
      const roundsStr = (record.rounds || []).join(',');
      const row = [
        'location',
        escapeCSVValue(record.location_id || ''),
        escapeCSVValue(record.external_id || ''),
        '', // no quadkey for locations
        escapeCSVValue(record.latitude || ''),
        escapeCSVValue(record.longitude || ''),
        `"${roundsStr}"`,
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

    // Convert pixel records to CSV rows
    pixelRecords.forEach((record: any) => {
      const roundsStr = (record.rounds || []).join(',');
      const row = [
        'pixel',
        '', // no location_id for pixels
        '', // no external_id for pixels
        escapeCSVValue(record.quadkey || ''),
        escapeCSVValue(record.latitude || ''),
        escapeCSVValue(record.longitude || ''),
        `"${roundsStr}"`,
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
    // Filter to only rounds with coverage data (using API counts)
    const roundsWithCoverage = rounds.filter((round) => {
      const isPixelRound = round.sampling_target === 'pixels';
      const itemsInRound = isPixelRound ? round.pixel_count : round.location_count;
      return itemsInRound > 0;
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
      title="Export Samples to Visit"
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
                  const isPixelRound = round.sampling_target === 'pixels';
                  const itemsInRound = isPixelRound ? round.pixel_count : round.location_count;
                  return itemsInRound > 0;
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
                    // Use counts from API instead of counting paginated data
                    const isPixelRound = round.sampling_target === 'pixels';
                    const itemsInRound = isPixelRound ? round.pixel_count : round.location_count;

                    return itemsInRound > 0;
                  });

                  if (roundsWithCoverage.length === 0) {
                    return (
                      <div className="p-3 text-center">
                        <p className="text-sm text-tactical-text-dim">No rounds with coverage data for this indicator</p>
                      </div>
                    );
                  }

                  return roundsWithCoverage.map((round) => {
                    // Use counts from API instead of counting paginated data
                    const isPixelRound = round.sampling_target === 'pixels';
                    const itemsInRound = isPixelRound ? round.pixel_count : round.location_count;

                    const itemType = isPixelRound ? 'pixel' : 'location';
                    const itemTypeLabel = itemsInRound === 1 ? itemType : `${itemType}s`;

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
                            {itemsInRound} {itemTypeLabel}
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

        {/* Export Destination */}
        <div>
          <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
            Export Destination
          </label>
          <div className="flex gap-3">
            <label className="flex-1 flex items-center gap-3 p-3 border border-tactical-border-medium bg-tactical-bg-secondary hover:bg-tactical-bg-tertiary cursor-pointer transition-colors">
              <input
                type="radio"
                name="exportDestination"
                checked={exportDestination === 'download'}
                onChange={() => setExportDestination('download')}
                className="w-4 h-4 bg-tactical-bg-secondary border-2 border-tactical-border-medium checked:bg-tactical-accent-green checked:border-tactical-accent-green focus:outline-none focus:ring-2 focus:ring-tactical-accent-orange"
              />
              <div className="flex-1">
                <div className="text-sm text-tactical-text-primary font-mono">Download</div>
              </div>
            </label>
            <label className="flex-1 flex items-center gap-3 p-3 border border-tactical-border-medium bg-tactical-bg-secondary hover:bg-tactical-bg-tertiary cursor-pointer transition-colors">
              <input
                type="radio"
                name="exportDestination"
                checked={exportDestination === 'odk'}
                onChange={() => setExportDestination('odk')}
                className="w-4 h-4 bg-tactical-bg-secondary border-2 border-tactical-border-medium checked:bg-tactical-accent-green checked:border-tactical-accent-green focus:outline-none focus:ring-2 focus:ring-tactical-accent-orange"
              />
              <div className="flex-1">
                <div className="text-sm text-tactical-text-primary font-mono">Export to ODK</div>
              </div>
            </label>
          </div>
        </div>

        {/* Export Format (only shown for Download) */}
        {exportDestination === 'download' && (
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
        )}

        {/* ODK Entity List Info (shown when Export to ODK is selected) */}
        {exportDestination === 'odk' && (
          <div>
            <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
              ODK Entity List
            </label>
            {isLoadingEntities ? (
              <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary text-center">
                <p className="text-sm text-tactical-text-dim">Loading entity list information...</p>
              </div>
            ) : entitiesError ? (
              <div className="p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
                <div className="flex items-start gap-2">
                  <TacticalBadge variant="danger">ERROR</TacticalBadge>
                  <div className="flex-1">
                    <span className="text-sm text-tactical-accent-red">{entitiesError}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
                <div className="flex items-center gap-2">
                  <TacticalBadge variant="success">CONFIGURED</TacticalBadge>
                  <div className="flex-1">
                    <div className="text-sm text-tactical-text-primary font-mono">
                      {project?.ona_entity_list_name || 'Entity List'}
                    </div>
                    <div className="text-xs text-tactical-text-dim font-mono mt-1">
                      {entityCount} {entityCount === 1 ? 'location' : 'locations'} in ODK
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filter Options (hidden for ODK export) */}
        {exportDestination === 'download' && (
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
                  Include all items
                </div>
                <div className="text-xs text-tactical-text-dim font-mono mt-1">
                  When enabled, exports all items (locations or pixels) regardless of round selection. When disabled, only exports items with data in selected rounds.
                </div>
              </div>
            </label>
          </div>
        )}

        {/* Export Progress (shown during ODK export) */}
        {exportDestination === 'odk' && isExporting && exportProgress && (
          <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
            <div className="flex items-center gap-2 mb-2">
              <TacticalBadge variant="info">CREATING ENTITIES</TacticalBadge>
            </div>
            <div className="text-sm font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-tactical-text-dim">Progress:</span>
                <span className="text-tactical-text-primary font-bold">
                  {exportProgress.created_pixels} / {exportProgress.total_pixels} pixels
                </span>
              </div>
              {exportProgress.current_quadkey && (
                <div className="text-xs text-tactical-text-dim">
                  Current: {exportProgress.current_quadkey}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Data Summary */}
        <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
          <div className="flex items-center gap-2 mb-2">
            <TacticalBadge variant="info">EXPORT SUMMARY</TacticalBadge>
          </div>
          <div className="text-sm font-mono space-y-1">
            <div className="flex justify-between">
              <span className="text-tactical-text-dim">Items to export:</span>
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
            disabled={isExporting}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="button"
            variant="primary"
            onClick={handleExport}
            disabled={
              isExporting ||
              (exportDestination === 'odk' ? selectedRoundIds.length === 0 : exportCount === 0)
            }
          >
            {isExporting ? (
              <span className="tactical-loading-dots">
                EXPORTING<span>.</span><span>.</span><span>.</span>
              </span>
            ) : exportDestination === 'odk' ? (
              'Export to ODK'
            ) : exportFormat === 'csv' ? (
              'Export CSV'
            ) : (
              'Export GeoJSON'
            )}
          </TacticalButton>
        </div>
      </div>
    </TacticalModal>
  );
};

export default ExportLocationsModal;
