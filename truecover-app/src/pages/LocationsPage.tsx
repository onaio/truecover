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

  const { getCoverageGeoJSON } = useCoverage();
  const [coverageGeoJSON, setCoverageGeoJSON] = useState<any>(null);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);

  // Indicator and Round filters
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
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

  // Load coverage GeoJSON for map visualization
  useEffect(() => {
    const loadCoverage = async () => {
      if (!selectedArea?.id) return;

      setIsLoadingCoverage(true);
      try {
        const geojson = await getCoverageGeoJSON({
          area_id: selectedArea.id,
        });
        setCoverageGeoJSON(geojson);
      } catch (error) {
        console.error('Error loading coverage GeoJSON:', error);
        setCoverageGeoJSON(null);
      } finally {
        setIsLoadingCoverage(false);
      }
    };

    loadCoverage();
  }, [selectedArea?.id]);

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
                  {(() => {
                    const uniqueRounds = new Set();
                    locations.features.forEach((f: any) => {
                      const rounds = f.properties?.rounds || [];
                      rounds.forEach((r: number) => uniqueRounds.add(r));
                    });
                    return uniqueRounds.size;
                  })()}
                </p>
              </div>
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Locations to Visit</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {(() => {
                    const totalLocations = locations.features.length;
                    let locationsToVisit = 0;

                    // Filter locations based on mapHighlightRounds
                    if (mapHighlightRounds.length === 0) {
                      // Show all locations with any round data
                      locationsToVisit = locations.features.filter((f: any) => {
                        const rounds = f.properties?.rounds || [];
                        return Array.isArray(rounds) && rounds.length > 0;
                      }).length;
                    } else {
                      // Show only locations in selected rounds
                      locationsToVisit = locations.features.filter((f: any) => {
                        const rounds = f.properties?.rounds || [];
                        return Array.isArray(rounds) && rounds.some((r: number) => mapHighlightRounds.includes(r));
                      }).length;
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
            <div className="mb-4 flex gap-4">
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
                <TacticalSelect
                  value={selectedRoundId}
                  onChange={(value) => setSelectedRoundId(value)}
                  options={[
                    { value: '', label: 'All Rounds' },
                    ...(rounds || []).map(round => ({
                      value: round.id,
                      label: round.name || `Round ${round.round_number}`
                    }))
                  ]}
                  placeholder="Filter by Round"
                />
              </div>
            </div>

            {/* Map View */}
            <TacticalCard padding="none" className="mb-6">
              {(coverageGeoJSON?.features?.length > 0 || (locations?.features?.length > 0)) ? (
                <MapView
                  data={{ type: 'FeatureCollection', features: [] }}
                  locations={coverageGeoJSON?.features?.length > 0 ? coverageGeoJSON : locations}
                  mode="locations"
                  highlightRounds={mapHighlightRounds}
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
              projectId={selectedProject?.id || ''}
              selectedIndicatorId={selectedIndicatorId}
              selectedRoundId={selectedRoundId}
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
                title={
                  <>
                    Locations
                    {(selectedRoundFilter !== null || mapHighlightRounds.length > 0) && (
                      <span className="ml-3 px-2 py-1 border border-tactical-accent-orange text-tactical-accent-orange text-sm font-normal inline-flex items-center gap-2">
                        <span>
                          Filtering by Round{mapHighlightRounds.length > 1 || selectedRoundFilter !== null ? 's' : ''}: {
                            selectedRoundFilter !== null
                              ? selectedRoundFilter
                              : [...mapHighlightRounds].sort((a, b) => a - b).join(', ')
                          }
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMapHighlightRounds([]);
                            setSelectedRoundFilter(null);
                          }}
                          className="hover:text-tactical-accent-orange/70 transition-colors"
                          aria-label="Clear filter"
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </>
                }
                collapsedSummary={(() => {
                  if (!locations || !locations.features) {
                    return '(Loading...)';
                  }
                  let count = locations.features.length;
                  if (selectedRoundFilter !== null) {
                    count = locations.features.filter((f: any) => {
                      const rounds = f.properties?.rounds || [];
                      return rounds.includes(selectedRoundFilter);
                    }).length;
                  } else if (mapHighlightRounds.length > 0) {
                    count = locations.features.filter((f: any) => {
                      const rounds = f.properties?.rounds || [];
                      return Array.isArray(rounds) && rounds.some((r: number) => mapHighlightRounds.includes(r));
                    }).length;
                  }
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
                        : selectedRoundFilter !== null
                        ? {
                            type: 'FeatureCollection',
                            features: locations.features.filter((f: any) => {
                              const rounds = f.properties?.rounds || [];
                              return rounds.includes(selectedRoundFilter);
                            }),
                          }
                        : mapHighlightRounds.length > 0
                        ? {
                            type: 'FeatureCollection',
                            features: locations.features.filter((f: any) => {
                              const rounds = f.properties?.rounds || [];
                              return Array.isArray(rounds) && rounds.some((r: number) => mapHighlightRounds.includes(r));
                            }),
                          }
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
