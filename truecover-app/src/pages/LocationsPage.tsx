import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useAppContext } from '../contexts/AppContext';
import { useLocationsData } from '../hooks/useLocationsData';
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
    isAddVisitModalOpen,
    setIsAddVisitModalOpen,
    isGenerateMockDataModalOpen,
    setIsGenerateMockDataModalOpen,
    loadLocations,
    handleLocationsUploaded,
    handleEditLocation,
    handleLocationUpdated,
    handleLocationDeleted,
  } = useLocationsData();

  // Load locations when entering the page
  useEffect(() => {
    if (selectedArea?.id) {
      loadLocations(selectedArea.id, setLocations);
    }
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
            {/* Map View */}
            <TacticalCard padding="none" className="mb-6">
              {locations && locations.features && locations.features.length > 0 ? (
                <>
                  {/* Map Filter */}
                  <div className="p-4 border-b border-tactical-border-medium bg-tactical-bg-secondary">
                    <div className="max-w-md">
                      <TacticalMultiSelect
                        options={(() => {
                          const uniqueRounds = new Set<number>();
                          locations.features.forEach((f: any) => {
                            const rounds = f.properties?.rounds || [];
                            rounds.forEach((r: number) => uniqueRounds.add(r));
                          });
                          const roundOptions = Array.from(uniqueRounds)
                            .sort((a, b) => a - b)
                            .map(r => ({
                              value: r.toString(),
                              label: `Round ${r}`
                            }));
                          return [
                            { value: 'all', label: 'All Rounds' },
                            ...roundOptions
                          ];
                        })()}
                        value={mapHighlightRounds.length === 0 ? ['all'] : mapHighlightRounds.map(r => r.toString())}
                        onChange={(values) => {
                          const currentValue = mapHighlightRounds.length === 0 ? ['all'] : mapHighlightRounds.map(r => r.toString());

                          // Check if "all" was just selected
                          const allWasSelected = !currentValue.includes('all') && values.includes('all');

                          // If "all" was just clicked, clear all filters
                          if (allWasSelected) {
                            setMapHighlightRounds([]);
                          }
                          // If nothing selected, default to all
                          else if (values.length === 0) {
                            setMapHighlightRounds([]);
                          }
                          // Otherwise, filter out 'all' if present and set specific rounds
                          else {
                            setMapHighlightRounds(values.filter(v => v !== 'all').map(v => parseInt(v as string)));
                          }
                        }}
                      />
                    </div>
                  </div>
                  <MapView
                    data={{ type: 'FeatureCollection', features: [] }}
                    locations={locations}
                    mode="locations"
                    highlightRounds={mapHighlightRounds}
                  />
                </>
              ) : (
                <div className="h-[500px] flex items-center justify-center bg-tactical-bg-secondary border border-tactical-border-medium">
                  <p className="text-tactical-text-dim">No locations to display</p>
                </div>
              )}
            </TacticalCard>

            {/* Predicted Coverage Section */}
            <PredictedCoverageSection
              areaId={selectedArea?.id || ''}
              projectId={selectedProject?.id || ''}
            />

            {/* Visit Data Section */}
            <TacticalCard padding="lg" className="mb-6">
              <TacticalCollapsible
                title="Visit Data"
                defaultCollapsed={true}
                actionButton={
                  <div className="flex gap-2">
                    <TacticalButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsGenerateMockDataModalOpen(true)}
                    >
                      Generate Mock Data
                    </TacticalButton>
                    <TacticalButton
                      variant="primary"
                      size="sm"
                      onClick={() => setIsAddVisitModalOpen(true)}
                    >
                      + Add Visit Data
                    </TacticalButton>
                  </div>
                }
              >
                <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
                  <p className="text-tactical-text-dim">No visit data yet</p>
                </div>
              </TacticalCollapsible>
            </TacticalCard>

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
