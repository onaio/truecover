import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useAppContext } from '../contexts/AppContext';
import { useLocationsData } from '../hooks/useLocationsData';
import { useCoverage } from '../hooks/useCoverage';
import { useIndicators } from '../hooks/useIndicators';
import { useRounds } from '../hooks/useRounds';
import LocationUploadModal from '../components/LocationUploadModal';
import LocationEditModal from '../components/LocationEditModal';
import LocationsTable from '../components/LocationsTable';
import MapView from '../components/MapView';
import RoundsManager from '../components/RoundsManager';
import PredictedCoverageSection from '../components/PredictedCoverageSection';
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

  const { getCoverageGeoJSON, listCoverage } = useCoverage();
  const [coverageGeoJSON, setCoverageGeoJSON] = useState<any>(null);
  const [coverageData, setCoverageData] = useState<any[]>([]);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);

  // Indicator and Round filters
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [selectedRoundIds, setSelectedRoundIds] = useState<(string | number)[]>(['all']);
  const [showVisitLocations, setShowVisitLocations] = useState<boolean>(true);
  const { data: indicators } = useIndicators(selectedProject?.id);
  const { data: rounds } = useRounds(selectedArea?.id);

  // Set default indicator to first one when indicators load
  useEffect(() => {
    if (indicators && indicators.length > 0 && !selectedIndicatorId) {
      setSelectedIndicatorId(indicators[0].id);
    }
  }, [indicators]);

  // Load locations when entering the page
  useEffect(() => {
    if (selectedArea?.id) {
      loadLocations(selectedArea.id, setLocations);
    }
  }, [selectedArea?.id]);

  // Load coverage GeoJSON for map visualization and coverage data for metrics
  useEffect(() => {
    const loadCoverage = async () => {
      if (!selectedArea?.id || !selectedIndicatorId) {
        setCoverageGeoJSON(null);
        setCoverageData([]);
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

        // Load both GeoJSON for map and coverage data for metrics
        const [geojson, data] = await Promise.all([
          getCoverageGeoJSON({
            area_id: selectedArea.id,
            indicator_id: selectedIndicatorId,
            round_id: roundId,
          }),
          listCoverage({
            area_id: selectedArea.id,
            indicator_id: selectedIndicatorId,
            round_id: roundId,
          }),
        ]);

        setCoverageGeoJSON(geojson);
        setCoverageData(data);
      } catch (error) {
        console.error('Error loading coverage data:', error);
        setCoverageGeoJSON(null);
        setCoverageData([]);
      } finally {
        setIsLoadingCoverage(false);
      }
    };

    loadCoverage();
  }, [selectedArea?.id, selectedIndicatorId, selectedRoundIds]);

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
        {locations && locations.features && (
          <>
            <div className="mb-4 grid grid-cols-3 gap-4">
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Total Locations</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {locations.features.length}
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
                    const totalLocations = locations.features.length;

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
            </div>

            {/* Map View */}
            <TacticalCard padding="none" className="mb-6">
              {(coverageGeoJSON?.features?.length > 0 || (locations?.features?.length > 0)) ? (
                <MapView
                  data={{ type: 'FeatureCollection', features: [] }}
                  locations={coverageGeoJSON?.features?.length > 0 ? coverageGeoJSON : locations}
                  mode="locations"
                  highlightRounds={mapHighlightRounds}
                  showVisitLocations={showVisitLocations}
                />
              ) : (
                <div className="h-[500px] flex items-center justify-center bg-tactical-bg-secondary border border-tactical-border-medium">
                  <p className="text-tactical-text-dim">
                    {isLoadingCoverage ? 'Loading coverage data...' : 'No data to display'}
                  </p>
                </div>
              )}
            </TacticalCard>

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
                  if (!locations || !locations.features) {
                    return '(Loading...)';
                  }
                  const count = locations.features.length;
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
                      !locations || !locations.features
                        ? { type: 'FeatureCollection', features: [] }
                        : locations
                    }
                    onEditLocation={handleEditLocation}
                  />
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
        onLocationsUploaded={() => handleLocationsUploaded(selectedArea.id, setLocations)}
      />

      {/* Location Edit Modal */}
      <LocationEditModal
        isOpen={isLocationEditModalOpen}
        onClose={() => {
          setIsLocationEditModalOpen(false);
        }}
        location={selectedLocationForEdit}
        areaId={selectedArea?.id || ''}
        onLocationUpdated={() => handleLocationUpdated(selectedArea.id, setLocations)}
        onLocationDeleted={() => handleLocationDeleted(selectedArea.id, setLocations)}
      />
    </div>
  );
};

export default LocationsPage;
