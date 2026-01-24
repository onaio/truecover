import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../contexts/AppContext';
import { useLocationsData } from '../hooks/useLocationsData';
import { useInfiniteLocations } from '../hooks/useLocations';
import { useCoverageData, useCoverageHistogram } from '../hooks/useCoverageData';
import { useIndicators } from '../hooks/useIndicators';
import { useRounds } from '../hooks/useRounds';
import { usePixelStats, usePixelMetadataStats } from '../hooks/usePixels';
import { useEnrichmentJobs } from '../hooks/useEnrichment';
import { useCampaignAreas } from '../hooks/useCampaignAreas';
import LocationUploadModal from '../components/LocationUploadModal';
import LocationEditModal from '../components/LocationEditModal';
import GeneratePixelsModal from '../components/GeneratePixelsModal';
import EnrichPixelsModal from '../components/EnrichPixelsModal';
import MapView from '../components/MapView';
import RoundsManager from '../components/RoundsManager';
import PredictedCoverageSection from '../components/PredictedCoverageSection';
import CampaignAreasManager from '../components/CampaignAreasManager';
import AddCampaignAreaModal from '../components/AddCampaignAreaModal';
import DistributionHistogram from '../components/DistributionHistogram';
import CondensedStatsBar from '../components/CondensedStatsBar';
import HistogramDrawer from '../components/HistogramDrawer';
import {
  TacticalCard,
  TacticalButton,
  TacticalHeader,
  TacticalCollapsible,
  TacticalMultiSelect,
  tacticalToast,
  TacticalSelect,
} from '../tactical-ui';

const LocationsPage: React.FC = () => {
  const {
    selectedOrganization,
    selectedProject,
    selectedCampaign,
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
    setSelectedRoundFilter,
    mapHighlightRounds,
    setMapHighlightRounds,
    loadLocations,
    handleLocationsUploaded,
    handleLocationUpdated,
    handleLocationDeleted,
  } = useLocationsData();

  const [histogramBrushRanges, setHistogramBrushRanges] = useState<[number, number][] | null>(null);
  const [histogramTab, setHistogramTab] = useState<'locations' | 'pixels'>('locations');

  // Refresh key to trigger data reload after mutations
  const [refreshKey, setRefreshKey] = useState(0);

  // Indicator and Round filters
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [selectedRoundIds, setSelectedRoundIds] = useState<(string | number)[]>(['all']);
  const [showSampled, setShowSampled] = useState<boolean>(true);
  const [interpolationMode, setInterpolationMode] = useState<'none' | 'coverage' | 'uncertainty' | 'metadata'>('none');
  const [selectedMetadataField, setSelectedMetadataField] = useState<string>('');
  const [metadataVisualizationMode, setMetadataVisualizationMode] = useState<'fill' | 'circle'>('fill');
  const [showPixels, setShowPixels] = useState<boolean>(false);
  const [isGeneratePixelsModalOpen, setIsGeneratePixelsModalOpen] = useState<boolean>(false);
  const [isEnrichPixelsModalOpen, setIsEnrichPixelsModalOpen] = useState<boolean>(false);
  const [currentMapBounds, setCurrentMapBounds] = useState<[number, number, number, number] | null>(null);
  const [planningMode, setPlanningMode] = useState<boolean>(false);
  const [mapMode, setMapMode] = useState<boolean>(false);
  const [histogramDrawerOpen, setHistogramDrawerOpen] = useState<boolean>(false);
  const [selectedAdminBoundary, setSelectedAdminBoundary] = useState<{ pcode: string; name: string } | null>(null);
  const [isAddCampaignAreaModalOpen, setIsAddCampaignAreaModalOpen] = useState(false);
  const [campaignAreaMode, setCampaignAreaMode] = useState<'admin_boundary' | 'drawn'>('admin_boundary');
  const [selectedAdminBoundaryForCampaign, setSelectedAdminBoundaryForCampaign] = useState<{ pcode: string; name: string } | null>(null);
  const [drawnGeometryForCampaign, setDrawnGeometryForCampaign] = useState<any>(null);
  const [campaignAreasRefreshKey, setCampaignAreasRefreshKey] = useState(0);
  const [buildingWorkflows, setBuildingWorkflows] = useState<Map<string, string>>(new Map()); // areaId -> workflowId
  const [showCampaignAreas, setShowCampaignAreas] = useState<boolean>(true);
  const { data: indicators } = useIndicators(selectedProject?.id);
  const { data: rounds } = useRounds(selectedCampaign?.id);
  const { data: pixelStats, refetch: refetchPixelStats } = usePixelStats(selectedCampaign?.id);
  const { data: enrichmentJobsData } = useEnrichmentJobs(selectedCampaign?.id);
  const enrichmentJobs = enrichmentJobsData?.jobs || [];
  const { data: pixelMetadataStats } = usePixelMetadataStats(selectedCampaign?.id);
  const { data: campaignAreas } = useCampaignAreas(selectedCampaign?.id);

  // Compute roundId for coverage data query
  const coverageRoundId = useMemo(() => {
    // If "all" is selected or multiple rounds, use undefined for round_id
    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
      return undefined;
    }
    if (selectedRoundIds.length === 1) {
      return String(selectedRoundIds[0]);
    }
    return undefined;
  }, [selectedRoundIds]);

  // Use React Query hook to fetch coverage data with infinite scroll
  const {
    data: coverageDataResult,
    isLoading: isLoadingCoverage,
    refetch: refetchCoverage,
    fetchNextPage: fetchNextCoveragePage,
    hasNextPage: hasNextCoveragePage,
    isFetchingNextPage: isFetchingNextCoveragePage,
  } = useCoverageData(
    selectedCampaign?.id,
    selectedIndicatorId,
    coverageRoundId,
    refreshKey
  );

  // Flatten all pages of data
  const coverageData = React.useMemo(() => {
    if (!coverageDataResult?.pages) return [];
    return coverageDataResult.pages.flatMap(page => page.locationData);
  }, [coverageDataResult]);

  const coveragePixelData = React.useMemo(() => {
    if (!coverageDataResult?.pages) return [];
    return coverageDataResult.pages.flatMap(page => page.pixelData);
  }, [coverageDataResult]);

  // Use histogram hook for aggregated data (replaces loading all coverage data)
  const { data: histogramData } = useCoverageHistogram(
    selectedCampaign?.id,
    selectedIndicatorId,
    interpolationMode === 'uncertainty' ? 'uncertainty' : 'coverage',
    histogramTab,
    12,
    coverageRoundId,
    refreshKey
  );

  // Use infinite query for locations stats
  const {
    data: locationsResult,
  } = useInfiniteLocations(selectedCampaign?.id);

  // Get total counts from first page (they're the same across all pages)
  const locationTotalCount = locationsResult?.pages?.[0]?.total_count || locations?.total_count || locations?.locations?.length || 0;
  const pixelTotalCount = coverageDataResult?.pages?.[0]?.pixelTotalCount || 0;

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

  // Auto-select first metadata field when switching to metadata mode
  useEffect(() => {
    if (interpolationMode === 'metadata' && !selectedMetadataField && pixelMetadataStats?.metadata_fields) {
      const availableFields = pixelMetadataStats.metadata_fields.filter((field: any) => field.count > 0);
      if (availableFields.length > 0) {
        setSelectedMetadataField(availableFields[0].name);
      }
    }
  }, [interpolationMode, selectedMetadataField, pixelMetadataStats]);

  // Clear metadata field when switching away from metadata/coverage/uncertainty modes
  useEffect(() => {
    if (interpolationMode === 'none') {
      setSelectedMetadataField('');
    }
  }, [interpolationMode]);

  // Load locations when entering the page or after data mutations
  useEffect(() => {
    if (selectedCampaign?.id) {
      loadLocations(selectedCampaign.id, setLocations);
    }
  }, [selectedCampaign?.id, refreshKey]);


  // Calculate sampled items count (locations + pixels) for map legend
  const sampledItemsCount = useMemo(() => {
    if (!selectedRoundIds) {
      return 0;
    }

    let locationsCount = 0;
    let pixelsCount = 0;

    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
      // Count all records with any rounds data
      if (coverageData) {
        locationsCount = coverageData.filter(record =>
          record.rounds && record.rounds.length > 0
        ).length;
      }
      if (coveragePixelData) {
        pixelsCount = coveragePixelData.filter(record =>
          record.rounds && record.rounds.length > 0
        ).length;
      }
    } else {
      // Count records with rounds matching selected round IDs
      const selectedRoundNumbers = selectedRoundIds
        .map(id => rounds?.find(r => r.id === id)?.round_number)
        .filter((num): num is number => num !== undefined);

      if (coverageData) {
        locationsCount = coverageData.filter(record =>
          record.rounds &&
          record.rounds.length > 0 &&
          record.rounds.some((rn: number) => selectedRoundNumbers.includes(rn))
        ).length;
      }
      if (coveragePixelData) {
        pixelsCount = coveragePixelData.filter(record =>
          record.rounds &&
          record.rounds.length > 0 &&
          record.rounds.some((rn: number) => selectedRoundNumbers.includes(rn))
        ).length;
      }
    }

    return locationsCount + pixelsCount;
  }, [coverageData, coveragePixelData, selectedRoundIds, rounds]);

  // Update mapHighlightRounds based on toggle and selected rounds
  useEffect(() => {
    if (!showSampled) {
      // Toggle is off - don't highlight anything
      setMapHighlightRounds([]);
      return;
    }

    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
      // "All Rounds" selected - highlight all sampled locations/pixels
      setMapHighlightRounds([]);
    } else {
      // Specific rounds selected - find the round numbers
      const roundNumbers = selectedRoundIds
        .map(id => rounds?.find(r => r.id === id)?.round_number)
        .filter((num): num is number => num !== undefined);
      setMapHighlightRounds(roundNumbers);
    }
  }, [showSampled, selectedRoundIds, rounds]);

  // Clear histogram brush when interpolation mode changes
  useEffect(() => {
    setHistogramBrushRanges(null);
  }, [interpolationMode]);

  // Monitor enrichment job completion and show toast notifications
  const previousJobsRef = React.useRef<Map<string, string>>(new Map());
  useEffect(() => {
    enrichmentJobs.forEach((job: any) => {
      const previousStatus = previousJobsRef.current.get(job.id);

      // Job just completed
      if (previousStatus === 'processing' && job.status === 'completed') {
        tacticalToast.success(
          'Enrichment Complete',
          `Successfully enriched ${job.pixels_processed.toLocaleString()} pixels with ${job.data_source_name || 'metadata'}`
        );
      }

      // Job just failed
      if (previousStatus === 'processing' && job.status === 'failed') {
        tacticalToast.error(
          'Enrichment Failed',
          job.error_message || 'The enrichment job encountered an error'
        );
      }

      // Update tracked status
      previousJobsRef.current.set(job.id, job.status);
    });
  }, [enrichmentJobs]);

  // Keyboard shortcuts for map mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setMapMode(prev => !prev);
      }
      if (e.key === 'Escape' && mapMode) {
        setMapMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mapMode]);

  // Calculate visit stats for reuse in both layouts
  const visitStats = useMemo(() => {
    const totalLocations = locations?.locations?.length || 0;

    let locationsToVisit = 0;
    let locationsVisited = 0;

    if (selectedRoundIds.includes('all') || selectedRoundIds.length === 0) {
      locationsToVisit = coverageData.filter(record =>
        record.rounds && record.rounds.length > 0
      ).length;
      locationsVisited = coverageData.filter(record =>
        record.n_trials !== 0 && record.n_covered !== 0
      ).length;
    } else {
      const selectedRoundNumbers = selectedRoundIds
        .map(id => rounds?.find(r => r.id === id)?.round_number)
        .filter((num): num is number => num !== undefined);

      locationsToVisit = coverageData.filter(record =>
        record.rounds &&
        record.rounds.length > 0 &&
        record.rounds.some((rn: number) => selectedRoundNumbers.includes(rn))
      ).length;
      locationsVisited = coverageData.filter(record =>
        record.n_trials !== 0 &&
        record.n_covered !== 0 &&
        record.rounds &&
        record.rounds.some((rn: number) => selectedRoundNumbers.includes(rn))
      ).length;
    }

    const toVisitPercent = totalLocations > 0 ? Math.round((locationsToVisit / totalLocations) * 100) : 0;
    const visitedPercent = totalLocations > 0 ? Math.round((locationsVisited / totalLocations) * 100) : 0;

    return {
      locationsToVisit,
      locationsToVisitPercent: toVisitPercent,
      locationsVisited,
      locationsVisitedPercent: visitedPercent,
    };
  }, [locations, coverageData, selectedRoundIds, rounds]);

  if (!selectedCampaign) {
    return null;
  }

  return (
    <>
      {/* Map Mode Button - Fixed to viewport */}
      <div style={{
        position: 'fixed',
        top: '16px',
        right: '180px',
        zIndex: 10000,
        pointerEvents: 'auto'
      }}>
        <TacticalButton
          variant={mapMode ? "primary" : "secondary"}
          size="sm"
          isActive={mapMode}
          onClick={() => setMapMode(!mapMode)}
        >
          {mapMode ? 'Exit Map' : 'Map Mode'}
        </TacticalButton>
      </div>

      {/* Planning Mode Button - Fixed to viewport */}
      <div style={{
        position: 'fixed',
        top: '16px',
        right: '72px',
        zIndex: 10000,
        pointerEvents: 'auto'
      }}>
        <TacticalButton
          variant={planningMode ? "primary" : "secondary"}
          size="sm"
          isActive={planningMode}
          onClick={() => setPlanningMode(!planningMode)}
        >
          {planningMode ? 'Planning On' : 'Planning Off'}
        </TacticalButton>
      </div>

      {mapMode ? (
        /* MAP MODE LAYOUT */
        <div className="fixed inset-0 z-40 bg-tactical-bg-primary flex flex-col">
          {/* Header with Breadcrumb */}
          <div className="flex-shrink-0 p-3 border-b border-tactical-border-medium">
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
              {' / '}
              <span className="text-tactical-text-primary">{selectedCampaign.name}</span>
            </p>
          </div>

          {/* Filter Controls */}
          <div className="flex-shrink-0 p-3 border-b border-tactical-border-medium flex gap-4 items-center flex-wrap">
            {/* Indicator Filter */}
            <div className="w-48 text-sm">
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
            <div className="w-48 text-sm">
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

            {/* Coverage Toggle */}
            <TacticalButton
              variant={interpolationMode === 'coverage' ? "primary" : "secondary"}
              size="sm"
              isActive={interpolationMode === 'coverage'}
              onClick={() => setInterpolationMode(interpolationMode === 'coverage' ? 'none' : 'coverage')}
            >
              Coverage
            </TacticalButton>

            {/* Uncertainty Toggle */}
            <TacticalButton
              variant={interpolationMode === 'uncertainty' ? "primary" : "secondary"}
              size="sm"
              isActive={interpolationMode === 'uncertainty'}
              onClick={() => setInterpolationMode(interpolationMode === 'uncertainty' ? 'none' : 'uncertainty')}
            >
              Uncertainty
            </TacticalButton>

            {/* Metadata Toggle */}
            {pixelMetadataStats && pixelMetadataStats.metadata_fields.length > 0 && (
              <TacticalButton
                variant={interpolationMode === 'metadata' ? "primary" : "secondary"}
                size="sm"
                isActive={interpolationMode === 'metadata'}
                onClick={() => setInterpolationMode(interpolationMode === 'metadata' ? 'none' : 'metadata')}
              >
                Metadata
              </TacticalButton>
            )}

            {/* Metadata Field Selector */}
            {(interpolationMode === 'metadata' || (interpolationMode !== 'none' && selectedMetadataField)) && pixelMetadataStats && pixelMetadataStats.metadata_fields.length > 0 && (
              <div className="w-48 text-sm">
                <TacticalSelect
                  value={selectedMetadataField}
                  onChange={(value) => setSelectedMetadataField(value)}
                  options={
                    pixelMetadataStats.metadata_fields
                      .filter((field: any) => field.count > 0)
                      .map((field: any) => ({
                        value: field.name,
                        label: field.name
                      }))
                  }
                  placeholder="Select Metadata Field"
                />
              </div>
            )}
          </div>

          {/* Condensed Stats Bar */}
          {locations && locations.locations && (
            <CondensedStatsBar
              locationTotalCount={locationTotalCount}
              pixelTotalCount={pixelTotalCount}
              roundCount={rounds?.length || 0}
              locationsToVisitCount={visitStats.locationsToVisit}
              locationsToVisitPercent={visitStats.locationsToVisitPercent}
              locationsVisitedCount={visitStats.locationsVisited}
              locationsVisitedPercent={visitStats.locationsVisitedPercent}
            />
          )}

          {/* Map taking remaining space */}
          <div className="flex-1 relative overflow-hidden">
            <MapView
              data={{ type: 'FeatureCollection', features: [] }}
              locations={locations}
              mode="locations"
              highlightRounds={mapHighlightRounds}
              showSampled={showSampled}
              onToggleSampled={() => setShowSampled(!showSampled)}
              interpolationMode={interpolationMode}
              selectedMetadataField={selectedMetadataField}
              metadataVisualizationMode={metadataVisualizationMode}
              showPixels={showPixels}
              onTogglePixels={() => setShowPixels(!showPixels)}
              pixelsBounds={pixelStats?.bounds || null}
              onBoundsChange={setCurrentMapBounds}
              campaignId={selectedCampaign?.id}
              indicatorId={selectedIndicatorId}
              pixelVersion={pixelStats ? `${pixelStats.count}-${pixelStats.level}` : null}
              pixelCount={pixelStats?.count || 0}
              onGeneratePixels={() => {
                refetchPixelStats();
                setRefreshKey(prev => prev + 1);
              }}
              histogramBrushRanges={histogramBrushRanges}
              histogramDataType={histogramTab}
              sampledItemsCount={sampledItemsCount}
              planningMode={planningMode}
              campaignAreas={campaignAreas || []}
              showCampaignAreas={showCampaignAreas}
              onToggleCampaignAreas={() => setShowCampaignAreas(!showCampaignAreas)}
              onAddAdminBoundaryToCampaign={(_id: string, pcode: string, name: string, geometry?: any) => {
                if (pcode === 'drawn' && geometry) {
                  setDrawnGeometryForCampaign(geometry);
                  setCampaignAreaMode('drawn');
                } else {
                  setSelectedAdminBoundaryForCampaign({ pcode, name });
                  setCampaignAreaMode('admin_boundary');
                }
                setIsAddCampaignAreaModalOpen(true);
              }}
              className="h-full"
            />

            {/* Histogram Drawer */}
            {(interpolationMode === 'coverage' || interpolationMode === 'uncertainty' || interpolationMode === 'metadata') && (
              <HistogramDrawer
                isOpen={histogramDrawerOpen}
                onToggle={() => setHistogramDrawerOpen(!histogramDrawerOpen)}
                histogramData={histogramData}
                interpolationMode={interpolationMode}
                indicatorName={indicators?.find(ind => ind.id === selectedIndicatorId)?.name}
                onBrushChange={setHistogramBrushRanges}
                histogramTab={histogramTab}
                onTabChange={setHistogramTab}
                locationTotalCount={locationTotalCount}
                pixelTotalCount={pixelTotalCount}
              />
            )}
          </div>
        </div>
      ) : (
        /* NORMAL LAYOUT */
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

          {/* Page Title - Show Campaign Name */}
          <h1 className="font-mono text-4xl font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
            {selectedCampaign.name}
          </h1>

        {/* Location Summary */}
        {locations && locations.locations && (
          <>
            <div className="mb-4 grid grid-cols-5 gap-4">
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Total Locations</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {locations.total_count || locations.locations.length}
                </p>
              </div>
              <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4">
                <p className="text-xs text-tactical-text-dim uppercase tracking-wider mb-2">Total Pixels</p>
                <p className="text-3xl font-bold text-tactical-text-primary font-mono">
                  {pixelTotalCount}
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

              {/* Metadata Toggle */}
              {pixelMetadataStats && pixelMetadataStats.metadata_fields.length > 0 && (
                <TacticalButton
                  variant={interpolationMode === 'metadata' ? "primary" : "secondary"}
                  size="md"
                  isActive={interpolationMode === 'metadata'}
                  onClick={() => setInterpolationMode(interpolationMode === 'metadata' ? 'none' : 'metadata')}
                >
                  Metadata
                </TacticalButton>
              )}

              {/* Metadata Field Selector */}
              {(interpolationMode === 'metadata' || (interpolationMode !== 'none' && selectedMetadataField)) && pixelMetadataStats && pixelMetadataStats.metadata_fields.length > 0 && (
                <>
                  <div className="w-64 text-lg">
                    <TacticalSelect
                      value={selectedMetadataField}
                      onChange={(value) => setSelectedMetadataField(value)}
                      options={
                        pixelMetadataStats.metadata_fields
                          .filter((field: any) => field.count > 0)
                          .map((field: any) => ({
                            value: field.name,
                            label: field.name
                          }))
                      }
                      placeholder="Select Metadata Field"
                    />
                  </div>

                  {/* Metadata Visualization Mode Toggle */}
                  {selectedMetadataField && (
                    <div className="flex gap-2 border border-tactical-border-medium bg-tactical-bg-secondary">
                      <button
                        className={`px-3 py-2 text-sm font-mono transition-colors ${
                          metadataVisualizationMode === 'fill'
                            ? 'bg-tactical-accent-blue text-tactical-text-primary'
                            : 'text-tactical-text-dim hover:text-tactical-text-secondary'
                        }`}
                        onClick={() => setMetadataVisualizationMode('fill')}
                      >
                        Fill
                      </button>
                      <button
                        className={`px-3 py-2 text-sm font-mono transition-colors ${
                          metadataVisualizationMode === 'circle'
                            ? 'bg-tactical-accent-blue text-tactical-text-primary'
                            : 'text-tactical-text-dim hover:text-tactical-text-secondary'
                        }`}
                        onClick={() => setMetadataVisualizationMode('circle')}
                      >
                        Circle
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Map View */}
            <TacticalCard padding="none" className="mb-6">
              <MapView
                data={{ type: 'FeatureCollection', features: [] }}
                locations={locations}
                mode="locations"
                highlightRounds={mapHighlightRounds}
                showSampled={showSampled}
                onToggleSampled={() => setShowSampled(!showSampled)}
                interpolationMode={interpolationMode}
                selectedMetadataField={selectedMetadataField}
                metadataVisualizationMode={metadataVisualizationMode}
                showPixels={showPixels}
                onTogglePixels={() => setShowPixels(!showPixels)}
                pixelsBounds={pixelStats?.bounds || null}
                onBoundsChange={setCurrentMapBounds}
                campaignId={selectedCampaign?.id}
                indicatorId={selectedIndicatorId}
                pixelVersion={pixelStats ? `${pixelStats.count}-${pixelStats.level}` : null}
                pixelCount={pixelStats?.count || 0}
                onGeneratePixels={() => {
                  refetchPixelStats();
                  setRefreshKey(prev => prev + 1);
                }}
                histogramBrushRanges={histogramBrushRanges}
                histogramDataType={histogramTab}
                sampledItemsCount={sampledItemsCount}
                planningMode={planningMode}
                campaignAreas={campaignAreas || []}
                showCampaignAreas={showCampaignAreas}
                onToggleCampaignAreas={() => setShowCampaignAreas(!showCampaignAreas)}
                onAddAdminBoundaryToCampaign={(_id: string, pcode: string, name: string, geometry?: any) => {
                  if (pcode === 'drawn' && geometry) {
                    setDrawnGeometryForCampaign(geometry);
                    setCampaignAreaMode('drawn');
                  } else {
                    setSelectedAdminBoundaryForCampaign({ pcode, name });
                    setCampaignAreaMode('admin_boundary');
                  }
                  setIsAddCampaignAreaModalOpen(true);
                }}
              />
            </TacticalCard>

            {/* Distribution Histogram with Tabs */}
            {(interpolationMode === 'coverage' || interpolationMode === 'uncertainty' || interpolationMode === 'metadata') && (
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
                    Locations ({locationTotalCount})
                  </button>
                  <button
                    className={`px-4 py-2 font-medium transition-colors ${
                      histogramTab === 'pixels'
                        ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                        : 'text-tactical-text-dim hover:text-tactical-text-secondary'
                    }`}
                    onClick={() => setHistogramTab('pixels')}
                  >
                    Pixels ({pixelTotalCount})
                  </button>
                </div>

                {/* Histogram */}
                <DistributionHistogram
                  histogramData={histogramData}
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
              campaignId={selectedCampaign?.id || ''}
              areaName={selectedCampaign?.name || ''}
              projectId={selectedProject?.id || ''}
              selectedIndicatorId={selectedIndicatorId}
              selectedRoundId={coverageRoundId}
              indicators={indicators || []}
              coverageData={coverageData}
              coveragePixelData={coveragePixelData}
              isLoadingCoverage={isLoadingCoverage}
              onRefetchCoverage={refetchCoverage}
              onLoadMore={fetchNextCoveragePage}
              hasMore={hasNextCoveragePage || false}
              isLoadingMore={isFetchingNextCoveragePage}
              locationTotalCount={locationTotalCount}
              pixelTotalCount={pixelTotalCount}
              rounds={rounds}
              onRoundChange={(roundId) => {
                if (roundId) {
                  setSelectedRoundIds([roundId]);
                } else {
                  setSelectedRoundIds(['all']);
                }
              }}
              onRoundClick={(roundNumber) => {
                const round = rounds?.find(r => r.round_number === roundNumber);
                if (round) {
                  setSelectedRoundIds([round.id]);
                }
              }}
            />

            {/* Rounds Manager */}
            <RoundsManager
              key={`rounds-${selectedCampaign?.id || 'none'}`}
              campaignId={selectedCampaign?.id || ''}
              areaName={selectedCampaign?.name || ''}
              projectId={selectedProject?.id || ''}
              locations={locations}
              onRoundSelected={setSelectedRoundFilter}
              selectedAdminBoundary={selectedAdminBoundary}
              onClearAdminBoundary={() => setSelectedAdminBoundary(null)}
              pixelCount={pixelStats?.count || 0}
              indicatorId={selectedIndicatorId}
            />

            {/* Campaign Areas Section - Primary workflow entry point */}
            <CampaignAreasManager
              key={campaignAreasRefreshKey}
              campaignId={selectedCampaign?.id || ''}
              indicatorId={selectedIndicatorId}
              buildingWorkflows={buildingWorkflows}
              onBuildingWorkflowComplete={(areaId) => {
                setBuildingWorkflows(prev => {
                  const next = new Map(prev);
                  next.delete(areaId);
                  return next;
                });
              }}
            />

            {/* Buildings Stats */}
            <TacticalCard padding="lg" className="mt-6">
              <TacticalCollapsible
                title="Buildings"
                defaultCollapsed={true}
                collapsedSummary={(() => {
                  if (!locationsResult) {
                    return '(Loading...)';
                  }
                  const count = locationTotalCount;
                  return `(${count.toLocaleString()} ${count === 1 ? 'Building' : 'Buildings'})`;
                })()}
              >
                <div className="p-4 bg-tactical-bg-secondary border border-tactical-border-medium">
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <div className="font-mono text-xs text-tactical-text-muted uppercase tracking-wider">Total</div>
                      <div className="font-mono text-2xl text-tactical-text-primary">
                        {locationTotalCount.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-xs text-tactical-text-muted uppercase tracking-wider">From Overture</div>
                      <div className="font-mono text-2xl text-tactical-text-primary">
                        {/* TODO: Track source in locations table */}
                        -
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-xs text-tactical-text-muted uppercase tracking-wider">Uploaded</div>
                      <div className="font-mono text-2xl text-tactical-text-primary">
                        {/* TODO: Track source in locations table */}
                        -
                      </div>
                    </div>
                  </div>
                </div>
              </TacticalCollapsible>
            </TacticalCard>

          </>
        )}
        </div>
        </div>
      )}

      {/* Location Upload Modal */}
      <LocationUploadModal
        isOpen={isLocationUploadModalOpen}
        onClose={() => setIsLocationUploadModalOpen(false)}
        area={selectedCampaign}
        onLocationsUploaded={() => {
          handleLocationsUploaded(selectedCampaign.id, setLocations);
          refetchPixelStats();
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
        campaignId={selectedCampaign?.id || ''}
        onLocationUpdated={() => {
          handleLocationUpdated(selectedCampaign.id, setLocations);
          setRefreshKey(prev => prev + 1);
        }}
        onLocationDeleted={() => {
          handleLocationDeleted(selectedCampaign.id, setLocations);
          setRefreshKey(prev => prev + 1);
        }}
      />

      {/* Generate Pixels Modal */}
      <GeneratePixelsModal
        isOpen={isGeneratePixelsModalOpen}
        onClose={() => setIsGeneratePixelsModalOpen(false)}
        campaignId={selectedCampaign?.id || ''}
        currentBounds={currentMapBounds}
        onGenerated={() => {
          refetchPixelStats();
          setRefreshKey(prev => prev + 1);
        }}
      />

      {/* Enrich Pixels Modal */}
      <EnrichPixelsModal
        isOpen={isEnrichPixelsModalOpen}
        onClose={() => setIsEnrichPixelsModalOpen(false)}
        campaignId={selectedCampaign?.id || ''}
        pixelCount={pixelStats?.count || 0}
        onJobCreated={(jobId) => {
          console.log('Enrichment job created:', jobId);
        }}
      />

      {/* Add Campaign Area Modal */}
      <AddCampaignAreaModal
        isOpen={isAddCampaignAreaModalOpen}
        onClose={() => {
          setIsAddCampaignAreaModalOpen(false);
          setSelectedAdminBoundaryForCampaign(null);
          setDrawnGeometryForCampaign(null);
        }}
        campaignId={selectedCampaign?.id || ''}
        mode={campaignAreaMode}
        adminBoundary={selectedAdminBoundaryForCampaign}
        drawnGeometry={drawnGeometryForCampaign}
        onAreaAdded={(result) => {
          setCampaignAreasRefreshKey(prev => prev + 1);
          refetchPixelStats();
          // Track building extraction workflow if one was started
          const workflowId = result?.buildingWorkflowId;
          const areaId = result?.areaId;
          if (workflowId && areaId) {
            setBuildingWorkflows(prev => new Map(prev).set(areaId, workflowId));
          }
        }}
      />
    </>
  );
};

export default LocationsPage;
