import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useAppContext } from '../contexts/AppContext';
import { useLocationsData } from '../hooks/useLocationsData';
import { useCoverage } from '../hooks/useCoverage';
import { useIndicators } from '../hooks/useIndicators';
import { useRounds } from '../hooks/useRounds';
import { usePixelStats, useDeletePixels } from '../hooks/usePixels';
import LocationUploadModal from '../components/LocationUploadModal';
import LocationEditModal from '../components/LocationEditModal';
import GeneratePixelsModal from '../components/GeneratePixelsModal';
import LocationsTable from '../components/LocationsTable';
import MapView from '../components/MapView';
import RoundsManager from '../components/RoundsManager';
import PredictedCoverageSection from '../components/PredictedCoverageSection';
import DistributionHistogram from '../components/DistributionHistogram';
import {
  TacticalCard,
  TacticalButton,
  TacticalHeader,
  TacticalCollapsible,
  TacticalMultiSelect,
  TacticalSelect,
} from '../tactical-ui';

const LocationsPage: React.FC = () => {
  const { getToken } = useAuth();
  const {
    selectedOrganization,
    selectedProject,
    selectedArea,
    locations,
    setLocations,
  } = useAppContext();

  const {
    isLocationUploadModalOpen,
    setIsLocationUploadModalOpen,
    isLocationEditModalOpen,
    setIsLocationEditModalOpen,
    selectedLocationForEdit,
    isLoadingLocations,
    selectedRoundFilter,
    setSelectedRoundFilter,
    mapHighlightRounds,
    setMapHighlightRounds,
    loadLocations,
    handleLocationsUploaded,
    handleEditLocation,
    handleLocationUpdated,
    handleLocationDeleted,
  } = useLocationsData();

  const { listCoverage, listCoveragePixel } = useCoverage();
  const [coverageData, setCoverageData] = useState<any[]>([]);
  const [coveragePixelData, setCoveragePixelData] = useState<any[]>([]);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);
  const [histogramBrushRanges, setHistogramBrushRanges] = useState<[number, number][] | null>(null);
  const [histogramTab, setHistogramTab] = useState<'locations' | 'pixels'>('locations');

  // Refresh key to trigger data reload after mutations
  const [refreshKey, setRefreshKey] = useState(0);

  // Indicator and Round filters
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [selectedRoundIds, setSelectedRoundIds] = useState<(string | number)[]>(['all']);
  const [showVisitLocations, setShowVisitLocations] = useState<boolean>(true);
  const [interpolationMode, setInterpolationMode] = useState<'none' | 'coverage' | 'uncertainty'>('none');
  const [showPixels, setShowPixels] = useState<boolean>(false);
  const [isGeneratePixelsModalOpen, setIsGeneratePixelsModalOpen] = useState<boolean>(false);
  const [currentMapBounds, setCurrentMapBounds] = useState<[number, number, number, number] | null>(null);
  const { data: indicators } = useIndicators(selectedProject?.id);
  const { data: rounds } = useRounds(selectedArea?.id);
  const { data: pixelStats, refetch: refetchPixelStats } = usePixelStats(selectedArea?.id);
  const deletePixels = useDeletePixels();

  // Set default indicator to first one when indicators load
  useEffect(() => {
    if (indicators && indicators.length > 0 && !selectedIndicatorId) {
      setSelectedIndicatorId(indicators[0].id);
    }
  }, [indicators]);

  // Auto-enable pixels when they exist for the area
  useEffect(() => {
    if (pixelStats && pixelStats.count > 0) {
      setShowPixels(true);
    }
  }, [pixelStats?.count]);

  // Load locations when entering the page or after data mutations
  useEffect(() => {
    if (selectedArea?.id) {
      loadLocations(selectedArea.id, setLocations);
    }
  }, [selectedArea?.id, refreshKey]);

  // Load coverage data for metrics and histogram
  useEffect(() => {
    const loadCoverage = async () => {
      if (!selectedArea?.id || !selectedIndicatorId) {
        setCoverageData([]);
        setCoveragePixelData([]);
        return;
      }

      setIsLoadingCoverage(true);
      try {
        // If "all" is selected or multiple rounds, use undefined for round_id
        const roundId = selectedRoundIds.includes('all') || selectedRoundIds.length === 0
          ? undefined
          : selectedRoundIds.length === 1
            ? String(selectedRoundIds[0])
            : undefined;

        // Load both location and pixel coverage data
        const [locationData, pixelData] = await Promise.all([
          listCoverage({
            area_id: selectedArea.id,
            indicator_id: selectedIndicatorId,
            round_id: roundId,
          }),
          listCoveragePixel({
            area_id: selectedArea.id,
            indicator_id: selectedIndicatorId,
            round_id: roundId,
          })
        ]);

        setCoverageData(locationData);
        setCoveragePixelData(pixelData);
      } catch (error) {
        console.error('Error loading coverage data:', error);
        setCoverageData([]);
        setCoveragePixelData([]);
      } finally {
        setIsLoadingCoverage(false);
      }
    };

    loadCoverage();
  }, [selectedArea?.id, selectedIndicatorId, selectedRoundIds, refreshKey]);

  // Calculate locations to visit count for map legend
  const locationsToVisitCount = useMemo(() => {
    if (!coverageData || !selectedRoundIds) {
      return 0;
    }

    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
      // Count all records with any rounds data
      return coverageData.filter(record =>
        record.rounds && record.rounds.length > 0
      ).length;
    }

    // Count records with rounds matching selected round IDs
    const selectedRoundNumbers = selectedRoundIds
      .map(id => rounds?.find(r => r.id === id)?.round_number)
      .filter((num): num is number => num !== undefined);

    return coverageData.filter(record =>
      record.rounds &&
      record.rounds.length > 0 &&
      record.rounds.some((rn: number) => selectedRoundNumbers.includes(rn))
    ).length;
  }, [coverageData, selectedRoundIds, rounds]);

  // Update mapHighlightRounds based on toggle and selected rounds
  useEffect(() => {
    if (!showVisitLocations) {
      // Toggle is off - don't highlight anything
      setMapHighlightRounds([]);
      return;
    }

    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
      // "All Rounds" selected - highlight all locations with any rounds data
      setMapHighlightRounds([]);
    } else {
      // Specific rounds selected - find the round numbers
      const roundNumbers = selectedRoundIds
        .map(id => rounds?.find(r => r.id === id)?.round_number)
        .filter((num): num is number => num !== undefined);
      setMapHighlightRounds(roundNumbers);
    }
  }, [showVisitLocations, selectedRoundIds, rounds]);

  // Clear histogram brush when interpolation mode changes
  useEffect(() => {
    setHistogramBrushRanges(null);
  }, [interpolationMode]);

  if (!selectedArea) {
    return null;
  }

  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title=""
        subtitle=""
      />

      <div className="max-w-7xl mx-auto p-6">
        {/* Breadcrumbs */}
        <div className="mb-4">
          <p className="text-sm text-tactical-text-dim font-mono uppercase tracking-wider">
            <Link
              to="/"
              className="hover:text-tactical-accent-orange cursor-pointer transition-colors"
            >
              {selectedOrganization?.name || 'Organization'}
            </Link>
            {' / '}
            <Link
              to="/"
              className="hover:text-tactical-accent-orange cursor-pointer transition-colors"
            >
              {selectedProject?.title || 'Project'}
            </Link>
          </p>
        </div>

        {/* Page Title - Show Area Name */}
        <h1 className="font-mono text-4xl font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
          {selectedArea.name}
        </h1>

        {/* Location Summary */}
        {locations && locations.locations && (
          <>
            <div className="mb-4 grid grid-cols-4 gap-4">
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Total Locations</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {locations.locations.length}
                </p>
              </div>
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Total Rounds</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {rounds?.length || 0}
                </p>
              </div>
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Locations to Visit</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {(() => {
                    const totalLocations = locations.locations.length;

                    // Count coverage table rows with rounds data matching selected filters
                    let locationsToVisit = 0;
                    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
                      // Count all records with any rounds data
                      locationsToVisit = coverageData.filter(record =>
                        record.rounds && record.rounds.length > 0
                      ).length;
                    } else {
                      // Count records with rounds matching selected round IDs
                      const selectedRoundNumbers = selectedRoundIds
                        .map(id => rounds?.find(r => r.id === id)?.round_number)
                        .filter((num): num is number => num !== undefined);

                      locationsToVisit = coverageData.filter(record =>
                        record.rounds &&
                        record.rounds.length > 0 &&
                        record.rounds.some((rn: number) => selectedRoundNumbers.includes(rn))
                      ).length;
                    }

                    const percentage = totalLocations > 0 ? Math.round((locationsToVisit / totalLocations) * 100) : 0;

                    return (
                      <>
                        {locationsToVisit}
                        <span className="text-lg text-tactical-text-dim ml-2">
                          ({percentage}%)
                        </span>
                      </>
                    );
                  })()}
                </p>
              </div>
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Locations Visited</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {(() => {
                    const totalLocations = locations.locations.length;

                    // Count coverage table rows where n_trials AND n_covered are both not 0
                    let locationsVisited = 0;
                    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
                      // Count all records with n_trials and n_covered both not 0
                      locationsVisited = coverageData.filter(record =>
                        record.n_trials !== 0 && record.n_covered !== 0
                      ).length;
                    } else {
                      // Count records matching selected rounds with n_trials and n_covered both not 0
                      const selectedRoundNumbers = selectedRoundIds
                        .map(id => rounds?.find(r => r.id === id)?.round_number)
                        .filter((num): num is number => num !== undefined);

                      locationsVisited = coverageData.filter(record =>
                        record.n_trials !== 0 &&
                        record.n_covered !== 0 &&
                        record.rounds &&
                        record.rounds.some((rn: number) => selectedRoundNumbers.includes(rn))
                      ).length;
                    }

                    const percentage = totalLocations > 0 ? Math.round((locationsVisited / totalLocations) * 100) : 0;

                    return (
                      <>
                        {locationsVisited}
                        <span className="text-lg text-tactical-text-dim ml-2">
                          ({percentage}%)
                        </span>
                      </>
                    );
                  })()}
                </p>
              </div>
            </div>
          </>
        )}

        {isLoadingLocations ? (
          <TacticalCard padding="lg" className="text-center">
            <p className="text-tactical-text-secondary">Loading locations...</p>
          </TacticalCard>
        ) : (
          <>
            {/* Filter Dropdowns Above Map */}
            <div className="mb-4 flex gap-4 items-center">
              {/* Indicator Filter */}
              <div className="w-64 text-lg">
                <TacticalSelect
                  value={selectedIndicatorId}
                  onChange={(value) => setSelectedIndicatorId(value)}
                  options={
                    (indicators || []).map(ind => ({
                      value: ind.id,
                      label: ind.name
                    }))
                  }
                  placeholder="Select Indicator"
                />
              </div>

              {/* Round Filter */}
              <div className="w-64 text-lg">
                <TacticalMultiSelect
                  value={selectedRoundIds}
                  onChange={setSelectedRoundIds}
                  options={[
                    { value: 'all', label: 'All Rounds' },
                    ...(rounds || []).map(round => ({
                      value: round.id,
                      label: round.name || `Round ${round.round_number}`
                    }))
                  ]}
                  placeholder="Filter by Round"
                />
              </div>

              {/* Visit Locations Toggle */}
              <TacticalButton
                variant={showVisitLocations ? "success" : "secondary"}
                size="md"
                isActive={showVisitLocations}
                onClick={() => setShowVisitLocations(!showVisitLocations)}
              >
                Visit Locations
              </TacticalButton>

              {/* Coverage Toggle */}
              <TacticalButton
                variant={interpolationMode === 'coverage' ? "primary" : "secondary"}
                size="md"
                isActive={interpolationMode === 'coverage'}
                onClick={() => setInterpolationMode(interpolationMode === 'coverage' ? 'none' : 'coverage')}
              >
                Coverage
              </TacticalButton>

              {/* Uncertainty Toggle */}
              <TacticalButton
                variant={interpolationMode === 'uncertainty' ? "primary" : "secondary"}
                size="md"
                isActive={interpolationMode === 'uncertainty'}
                onClick={() => setInterpolationMode(interpolationMode === 'uncertainty' ? 'none' : 'uncertainty')}
              >
                Uncertainty
              </TacticalButton>
            </div>

            {/* Map View */}
            <TacticalCard padding="none" className="mb-6">
              <MapView
                data={{ type: 'FeatureCollection', features: [] }}
                locations={locations}
                mode="locations"
                highlightRounds={mapHighlightRounds}
                showVisitLocations={showVisitLocations}
                interpolationMode={interpolationMode}
                showPixels={showPixels}
                onTogglePixels={() => setShowPixels(!showPixels)}
                pixelsBounds={pixelStats?.bounds || null}
                onBoundsChange={setCurrentMapBounds}
                areaId={selectedArea?.id}
                indicatorId={selectedIndicatorId}
                pixelVersion={pixelStats ? `${pixelStats.count}-${pixelStats.level}` : null}
                pixelCount={pixelStats?.count || 0}
                onGeneratePixels={() => setIsGeneratePixelsModalOpen(true)}
                histogramBrushRanges={histogramBrushRanges}
                locationsToVisitCount={locationsToVisitCount}
              />
            </TacticalCard>

            {/* Distribution Histogram with Tabs */}
            {(interpolationMode === 'coverage' || interpolationMode === 'uncertainty') && (
              <div className="mb-6">
                {/* Tab Switcher */}
                <div className="flex gap-2 mb-0 border-b border-tactical-border-medium bg-tactical-bg-secondary">
                  <button
                    className={`px-4 py-2 font-medium transition-colors ${
                      histogramTab === 'locations'
                        ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                        : 'text-tactical-text-dim hover:text-tactical-text-secondary'
                    }`}
                    onClick={() => setHistogramTab('locations')}
                  >
                    Locations ({coverageData.length})
                  </button>
                  <button
                    className={`px-4 py-2 font-medium transition-colors ${
                      histogramTab === 'pixels'
                        ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                        : 'text-tactical-text-dim hover:text-tactical-text-secondary'
                    }`}
                    onClick={() => setHistogramTab('pixels')}
                  >
                    Pixels ({coveragePixelData.length})
                  </button>
                </div>

                {/* Histogram */}
                <DistributionHistogram
                  data={histogramTab === 'locations' ? coverageData : coveragePixelData}
                  mode={interpolationMode === 'coverage' ? 'coverage' : 'uncertainty'}
                  visible={true}
                  indicatorName={indicators?.find(ind => ind.id === selectedIndicatorId)?.name}
                  onBrushChange={setHistogramBrushRanges}
                  dataType={histogramTab}
                />
              </div>
            )}

            {/* Predicted Coverage Section */}
            <PredictedCoverageSection
              areaId={selectedArea?.id || ''}
              areaName={selectedArea?.name || ''}
              projectId={selectedProject?.id || ''}
              selectedIndicatorId={selectedIndicatorId}
              selectedRoundId={
                selectedRoundIds.includes('all') || selectedRoundIds.length === 0
                  ? ''
                  : selectedRoundIds.length === 1
                    ? String(selectedRoundIds[0])
                    : ''
              }
              indicators={indicators || []}
            />

            {/* Rounds Manager */}
            <RoundsManager
              key={`rounds-${selectedArea?.id || 'none'}`}
              areaId={selectedArea?.id || ''}
              areaName={selectedArea?.name || ''}
              projectId={selectedProject?.id || ''}
              locations={locations}
              onRoundSelected={setSelectedRoundFilter}
            />

            {/* Locations Table */}
            <TacticalCard padding="lg">
              <TacticalCollapsible
                title="Locations"
                defaultCollapsed={true}
                collapsedSummary={(() => {
                  if (!locations || !locations.locations) {
                    return '(Loading...)';
                  }
                  const count = locations.locations.length;
                  return `(${count} ${count === 1 ? 'Location' : 'Locations'})`;
                })()}
                actionButton={
                  <TacticalButton
                    variant="primary"
                    size="sm"
                    onClick={() => setIsLocationUploadModalOpen(true)}
                  >
                    + Add Locations
                  </TacticalButton>
                }
              >
                <div className="border border-tactical-border-medium -mx-6 -mb-6">
                  <LocationsTable
                    locations={
                      !locations || !locations.locations
                        ? { locations: [] }
                        : locations
                    }
                    onEditLocation={handleEditLocation}
                  />
                </div>
              </TacticalCollapsible>
            </TacticalCard>

            {/* Pixels Section */}
            <TacticalCard padding="lg" className="mt-6">
              <TacticalCollapsible
                title="Pixels"
                defaultCollapsed={true}
                collapsedSummary={
                  pixelStats?.count
                    ? `(${pixelStats.count.toLocaleString()} pixels at level ${pixelStats.level})`
                    : '(No pixels)'
                }
              >
                <div className="space-y-4">
                  {pixelStats?.count && pixelStats.count > 0 ? (
                    <>
                      <div className="flex justify-between items-center p-4 bg-tactical-bg-secondary border border-tactical-border-medium">
                        <div className="space-y-1">
                          <div className="font-mono text-xs text-tactical-text-muted">Zoom Level</div>
                          <div className="font-mono text-lg text-tactical-text-primary">{pixelStats.level}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="font-mono text-xs text-tactical-text-muted">Pixel Count</div>
                          <div className="font-mono text-lg text-tactical-text-primary">
                            {pixelStats.count.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <TacticalButton
                          variant="primary"
                          size="md"
                          onClick={() => setIsGeneratePixelsModalOpen(true)}
                        >
                          Regenerate Pixels
                        </TacticalButton>
                        <TacticalButton
                          variant="danger"
                          size="md"
                          onClick={async () => {
                            if (window.confirm('Are you sure you want to delete all pixels? This cannot be undone.')) {
                              try {
                                await deletePixels.mutateAsync({ areaId: selectedArea?.id || '' });
                                await refetchPixelStats();
                                setRefreshKey(prev => prev + 1);
                              } catch (error: any) {
                                alert(`Error deleting pixels: ${error.message || 'Unknown error'}`);
                              }
                            }
                          }}
                          disabled={deletePixels.isPending}
                        >
                          {deletePixels.isPending ? 'Deleting...' : 'Delete All Pixels'}
                        </TacticalButton>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-tactical-text-muted mb-4 font-mono text-sm">
                        No pixels generated yet. Generate pixels to visualize quadkey grids on the map.
                      </p>
                      <TacticalButton
                        variant="primary"
                        size="md"
                        onClick={() => setIsGeneratePixelsModalOpen(true)}
                      >
                        Generate Pixels
                      </TacticalButton>
                    </div>
                  )}
                </div>
              </TacticalCollapsible>
            </TacticalCard>
          </>
        )}
      </div>

      {/* Location Upload Modal */}
      <LocationUploadModal
        isOpen={isLocationUploadModalOpen}
        onClose={() => setIsLocationUploadModalOpen(false)}
        area={selectedArea}
        onLocationsUploaded={() => {
          handleLocationsUploaded(selectedArea.id, setLocations);
          setRefreshKey(prev => prev + 1);
        }}
      />

      {/* Location Edit Modal */}
      <LocationEditModal
        isOpen={isLocationEditModalOpen}
        onClose={() => {
          setIsLocationEditModalOpen(false);
        }}
        location={selectedLocationForEdit}
        areaId={selectedArea?.id || ''}
        onLocationUpdated={() => {
          handleLocationUpdated(selectedArea.id, setLocations);
          setRefreshKey(prev => prev + 1);
        }}
        onLocationDeleted={() => {
          handleLocationDeleted(selectedArea.id, setLocations);
          setRefreshKey(prev => prev + 1);
        }}
      />

      {/* Generate Pixels Modal */}
      <GeneratePixelsModal
        isOpen={isGeneratePixelsModalOpen}
        onClose={() => setIsGeneratePixelsModalOpen(false)}
        areaId={selectedArea?.id || ''}
        currentBounds={currentMapBounds}
        onGenerated={() => {
          refetchPixelStats();
          setRefreshKey(prev => prev + 1);
        }}
      />
    </div>
  );
};

export default LocationsPage;
