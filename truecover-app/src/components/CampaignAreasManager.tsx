import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { campaignAreasApi, enrichmentApi, adminBoundariesApi } from '../services/api';
import {
  TacticalCard,
  TacticalButton,
  TacticalBadge,
  TacticalCollapsible,
  TacticalModal,
  tacticalToast
} from '../tactical-ui';

interface CampaignArea {
  id: string;
  campaign_id: string;
  name: string | null;
  area_type: 'admin_boundary' | 'drawn';
  admin_boundary_id: string | null;
  admin_boundary_name: string | null;
  bbox: {
    min_lng: number;
    min_lat: number;
    max_lng: number;
    max_lat: number;
  } | null;
  pixel_count: number;
  sampled_count: number;
  total_population: number;
  building_count: number;
  division_name: string | null;
  district_name: string | null;
  upazila_name: string | null;
  union_name: string | null;
  created_at: string;
}

interface CampaignAreasManagerProps {
  campaignId: string;
  indicatorId?: string;
  onRefresh?: () => void;
  buildingWorkflows?: Map<string, string>; // areaId -> workflowId
  onBuildingWorkflowComplete?: (areaId: string) => void;
}

const CampaignAreasManager: React.FC<CampaignAreasManagerProps> = ({
  campaignId,
  indicatorId,
  onRefresh,
  buildingWorkflows,
  onBuildingWorkflowComplete
}) => {
  const { getToken } = useAuth();
  const [areas, setAreas] = useState<CampaignArea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computingAreaId, setComputingAreaId] = useState<string | null>(null);
  const [enrichingAreaId, setEnrichingAreaId] = useState<string | null>(null);
  const [areaToDelete, setAreaToDelete] = useState<CampaignArea | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [areaToEdit, setAreaToEdit] = useState<CampaignArea | null>(null);
  const [sampleCount, setSampleCount] = useState<number>(50);
  const [isSampling, setIsSampling] = useState(false);
  const [samplingWorkflows, setSamplingWorkflows] = useState<Map<string, { workflowId: string; status: string }>>(new Map());
  const [buildingExtractionWorkflows, setBuildingExtractionWorkflows] = useState<Map<string, { workflowId: string; status: string }>>(new Map());

  useEffect(() => {
    if (campaignId) {
      loadAreas();
    }
  }, [campaignId]);

  // Start polling for any new building workflows passed from parent
  useEffect(() => {
    if (!buildingWorkflows) return;

    buildingWorkflows.forEach((workflowId, areaId) => {
      // Only start polling if we're not already tracking this workflow
      if (!buildingExtractionWorkflows.has(areaId)) {
        setBuildingExtractionWorkflows(prev => new Map(prev).set(areaId, {
          workflowId,
          status: 'running'
        }));
        pollBuildingWorkflowStatus(areaId, workflowId);
      }
    });
  }, [buildingWorkflows]);

  const pollBuildingWorkflowStatus = async (areaId: string, workflowId: string) => {
    const token = await getToken();
    if (!token) return;

    const poll = async () => {
      try {
        const status = await adminBoundariesApi.getOvertureImportStatus(workflowId, token);

        if (status.status === 'completed') {
          // Remove from tracking
          setBuildingExtractionWorkflows(prev => {
            const next = new Map(prev);
            next.delete(areaId);
            return next;
          });

          tacticalToast.success(`Building extraction complete: ${status.result?.inserted || 0} buildings imported`);
          onBuildingWorkflowComplete?.(areaId);
          loadAreas(); // Refresh to get updated building counts
        } else if (status.status === 'failed') {
          setBuildingExtractionWorkflows(prev => {
            const next = new Map(prev);
            next.delete(areaId);
            return next;
          });

          tacticalToast.error(`Building extraction failed: ${status.error || 'Unknown error'}`);
          onBuildingWorkflowComplete?.(areaId);
        } else {
          // Still running, update status and continue polling
          setBuildingExtractionWorkflows(prev => new Map(prev).set(areaId, {
            workflowId,
            status: 'running'
          }));

          // Poll again in 3 seconds
          setTimeout(poll, 3000);
        }
      } catch (err) {
        console.error('Error polling building workflow status:', err);
        // Continue polling on error
        setTimeout(poll, 5000);
      }
    };

    // Start polling
    poll();
  };

  const loadAreas = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const areasList = await campaignAreasApi.list(campaignId, token);
      setAreas(areasList);
    } catch (err: any) {
      console.error('Failed to load campaign areas:', err);
      setError(err.response?.data?.error || 'Failed to load areas');
    } finally {
      setIsLoading(false);
    }
  };

  const handleComputePixels = async (areaId: string) => {
    setComputingAreaId(areaId);

    try {
      const token = await getToken();
      if (!token) return;

      const result = await campaignAreasApi.computePixels(areaId, token);
      tacticalToast.success(`Computed ${result.pixels_computed.toLocaleString()} pixels`);

      // Refresh areas to get updated pixel counts
      await loadAreas();
    } catch (err: any) {
      console.error('Failed to compute pixels:', err);
      tacticalToast.error(err.response?.data?.error || 'Failed to compute pixels');
    } finally {
      setComputingAreaId(null);
    }
  };

  const handleComputeAllPixels = async () => {
    setComputingAreaId('all');

    try {
      const token = await getToken();
      if (!token) return;

      const result = await campaignAreasApi.computeAllPixels(campaignId, token);
      tacticalToast.success(`Computed ${result.total_pixels_computed.toLocaleString()} pixels across all areas`);

      // Refresh areas to get updated pixel counts
      await loadAreas();
    } catch (err: any) {
      console.error('Failed to compute all pixels:', err);
      tacticalToast.error(err.response?.data?.error || 'Failed to compute pixels');
    } finally {
      setComputingAreaId(null);
    }
  };

  const handleEnrichAllPixels = async () => {
    setEnrichingAreaId('all');

    try {
      const token = await getToken();
      if (!token) return;

      // Use WorldPop population data source for enrichment
      await enrichmentApi.createJob(campaignId, { data_source_id: 'worldpop' }, token);
      tacticalToast.success('Pixel enrichment started. This may take a few minutes.');

      // Note: onRefresh could be called to reload data after enrichment completes
      // For now, we just show the toast
    } catch (err: any) {
      console.error('Failed to start pixel enrichment:', err);
      tacticalToast.error(err.response?.data?.error || 'Failed to start pixel enrichment');
    } finally {
      setEnrichingAreaId(null);
    }
  };

  const handleDeleteArea = async () => {
    if (!areaToDelete) return;

    setIsDeleting(true);

    try {
      const token = await getToken();
      if (!token) return;

      await campaignAreasApi.remove(campaignId, areaToDelete.id, token);
      tacticalToast.success('Area removed');
      setAreas(areas.filter(a => a.id !== areaToDelete.id));
      setAreaToDelete(null);
      onRefresh?.();
    } catch (err: any) {
      console.error('Failed to delete area:', err);
      tacticalToast.error(err.response?.data?.error || 'Failed to remove area');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSample = async (resample: boolean = false) => {
    if (!areaToEdit || !indicatorId) return;

    setIsSampling(true);
    const areaId = areaToEdit.id;

    try {
      const token = await getToken();
      if (!token) return;

      const result = await campaignAreasApi.samplePixels(
        areaId,
        {
          indicator_id: indicatorId,
          sample_count: sampleCount,
          resample
        },
        token
      );

      // Track the workflow
      setSamplingWorkflows(prev => new Map(prev).set(areaId, {
        workflowId: result.workflow_id,
        status: 'running'
      }));

      tacticalToast.success(`Sampling ${sampleCount} pixels${resample ? ' (resample)' : ''}...`);
      setAreaToEdit(null);

      // Start polling for status
      pollWorkflowStatus(areaId, result.workflow_id);
    } catch (err: any) {
      console.error('Failed to sample pixels:', err);
      tacticalToast.error(err.response?.data?.error || 'Failed to start sampling');
    } finally {
      setIsSampling(false);
    }
  };

  const pollWorkflowStatus = async (areaId: string, workflowId: string) => {
    const token = await getToken();
    if (!token) return;

    const poll = async () => {
      try {
        const status = await campaignAreasApi.getSamplingStatus(workflowId, token);

        if (status.status === 'completed') {
          // Remove from tracking
          setSamplingWorkflows(prev => {
            const next = new Map(prev);
            next.delete(areaId);
            return next;
          });

          tacticalToast.success(`Sampling complete: ${status.result?.pixels_sampled || 0} pixels sampled`);
          loadAreas();
        } else if (status.status === 'failed') {
          setSamplingWorkflows(prev => {
            const next = new Map(prev);
            next.delete(areaId);
            return next;
          });

          tacticalToast.error(`Sampling failed: ${status.error || 'Unknown error'}`);
        } else {
          // Still running, update status and continue polling
          setSamplingWorkflows(prev => new Map(prev).set(areaId, {
            workflowId,
            status: status.progress?.status || 'running'
          }));

          // Poll again in 2 seconds
          setTimeout(poll, 2000);
        }
      } catch (err) {
        console.error('Error polling workflow status:', err);
        // Continue polling on error
        setTimeout(poll, 3000);
      }
    };

    // Start polling
    poll();
  };

  const openEditModal = (area: CampaignArea) => {
    setAreaToEdit(area);
    setSampleCount(area.sampled_count > 0 ? area.sampled_count : 50);
  };

  const totalPixels = areas.reduce((sum, area) => sum + (area.pixel_count || 0), 0);
  const totalSampled = areas.reduce((sum, area) => sum + (area.sampled_count || 0), 0);
  const totalPopulation = areas.reduce((sum, area) => sum + (area.total_population || 0), 0);
  const totalBuildings = areas.reduce((sum, area) => sum + (area.building_count || 0), 0);

  return (
    <>
      <TacticalCard padding="lg">
        <TacticalCollapsible
          title="Campaign Areas"
          defaultCollapsed={false}
          collapsedSummary={
            !isLoading
              ? `(${areas.length} ${areas.length === 1 ? 'Area' : 'Areas'}, ${totalPixels.toLocaleString()} Pixels, Pop: ${totalPopulation.toLocaleString()})`
              : undefined
          }
          actionButton={
            !isLoading && areas.length > 0 && (
              <div className="flex gap-2">
                {areas.some(a => a.pixel_count === 0) && (
                  <TacticalButton
                    variant="primary"
                    size="sm"
                    onClick={handleComputeAllPixels}
                    disabled={computingAreaId !== null}
                  >
                    {computingAreaId === 'all' ? (
                      <span className="tactical-loading-dots">
                        Computing<span>.</span><span>.</span><span>.</span>
                      </span>
                    ) : (
                      'Compute All Pixels'
                    )}
                  </TacticalButton>
                )}
                {areas.some(a => a.pixel_count > 0) && (
                  <TacticalButton
                    variant="secondary"
                    size="sm"
                    onClick={handleEnrichAllPixels}
                    disabled={enrichingAreaId !== null}
                  >
                    {enrichingAreaId === 'all' ? (
                      <span className="tactical-loading-dots">
                        Enriching<span>.</span><span>.</span><span>.</span>
                      </span>
                    ) : (
                      'Enrich All Pixels'
                    )}
                  </TacticalButton>
                )}
              </div>
            )
          }
        >
          {error && (
            <div className="mb-4 p-3 border border-tactical-accent-red bg-tactical-accent-red/10">
              <div className="flex items-start gap-3">
                <TacticalBadge variant="danger">ERROR</TacticalBadge>
                <span className="text-sm text-tactical-accent-red">{error}</span>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8">
              <span className="text-sm text-tactical-text-muted tactical-loading-dots">
                LOADING AREAS<span>.</span><span>.</span><span>.</span>
              </span>
            </div>
          ) : areas.length === 0 ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-sm text-tactical-text-dim mb-3">
                No areas defined for this campaign
              </p>
              <p className="text-xs text-tactical-text-muted">
                Enable planning mode and click on admin boundaries or draw shapes on the map to add areas
              </p>
            </div>
          ) : (
            <>
              {/* Areas Table */}
              <div className="w-full overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary">
                <table className="tactical-table text-tactical-text-secondary w-full">
                  <thead>
                    <tr className="sticky top-0 z-10">
                      <th className="bg-tactical-bg-secondary text-left">Name</th>
                      <th className="bg-tactical-bg-secondary text-left">Division</th>
                      <th className="bg-tactical-bg-secondary text-left">District</th>
                      <th className="bg-tactical-bg-secondary text-left">Upazila</th>
                      <th className="bg-tactical-bg-secondary text-left">Union</th>
                      <th className="bg-tactical-bg-secondary text-right">Sampled / Pixels</th>
                      <th className="bg-tactical-bg-secondary text-right">Population</th>
                      <th className="bg-tactical-bg-secondary text-right">Buildings</th>
                      <th className="bg-tactical-bg-secondary text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {areas.map((area) => (
                      <tr key={area.id} className="group hover:bg-tactical-bg-tertiary transition-colors">
                        <td className="font-mono font-bold text-tactical-text-primary">
                          {area.name || area.admin_boundary_name || 'Unnamed Area'}
                        </td>
                        <td className="text-tactical-text-muted">
                          {area.division_name || '—'}
                        </td>
                        <td className="text-tactical-text-muted">
                          {area.district_name || '—'}
                        </td>
                        <td className="text-tactical-text-muted">
                          {area.upazila_name || '—'}
                        </td>
                        <td className="text-tactical-text-muted">
                          {area.union_name || '—'}
                        </td>
                        <td className="text-right font-mono">
                          {area.pixel_count === 0 ? (
                            <span className="text-tactical-accent-red">—</span>
                          ) : (
                            <span>
                              <span className="text-tactical-accent-green">
                                {area.sampled_count.toLocaleString()}
                              </span>
                              <span className="text-tactical-text-muted"> / </span>
                              <span className="text-tactical-text-primary">
                                {area.pixel_count.toLocaleString()}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="text-right font-mono">
                          {area.total_population.toLocaleString()}
                        </td>
                        <td className="text-right font-mono">
                          {buildingExtractionWorkflows.has(area.id) ? (
                            <span className="tactical-shimmer">
                              Extracting...
                            </span>
                          ) : (
                            area.building_count.toLocaleString()
                          )}
                        </td>
                        <td className="text-center">
                          <div className="flex gap-2 justify-center">
                            {area.pixel_count === 0 && (
                              <TacticalButton
                                variant="primary"
                                size="sm"
                                onClick={() => handleComputePixels(area.id)}
                                disabled={computingAreaId !== null}
                              >
                                {computingAreaId === area.id ? '...' : 'Compute'}
                              </TacticalButton>
                            )}
                            {samplingWorkflows.has(area.id) ? (
                              <TacticalButton
                                variant="secondary"
                                size="sm"
                                disabled
                              >
                                <span className="tactical-shimmer tactical-loading-dots">
                                  Sampling<span>.</span><span>.</span><span>.</span>
                                </span>
                              </TacticalButton>
                            ) : (
                              <TacticalButton
                                variant="secondary"
                                size="sm"
                                onClick={() => openEditModal(area)}
                              >
                                {area.sampled_count > 0 ? 'Edit' : area.pixel_count > 0 && indicatorId ? 'Sample' : 'View'}
                              </TacticalButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-tactical-border-medium bg-tactical-bg-tertiary font-bold">
                      <td className="text-tactical-text-primary">
                        Total ({areas.length} {areas.length === 1 ? 'area' : 'areas'})
                      </td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td className="text-right font-mono font-bold">
                        <span className="text-tactical-accent-green">
                          {totalSampled.toLocaleString()}
                        </span>
                        <span className="text-tactical-text-muted"> / </span>
                        <span className="text-tactical-text-primary">
                          {totalPixels.toLocaleString()}
                        </span>
                      </td>
                      <td className="text-right font-mono font-bold text-tactical-text-primary">
                        {totalPopulation.toLocaleString()}
                      </td>
                      <td className="text-right font-mono font-bold text-tactical-text-primary">
                        {totalBuildings.toLocaleString()}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </TacticalCollapsible>
      </TacticalCard>

      {/* Delete Confirmation Modal */}
      {areaToDelete && (
        <TacticalModal
          isOpen={!!areaToDelete}
          onClose={() => setAreaToDelete(null)}
          title="Remove Area"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-tactical-text-secondary">
              Are you sure you want to remove <span className="font-bold">"{areaToDelete.name || areaToDelete.admin_boundary_name || 'this area'}"</span>?
            </p>
            <p className="text-xs text-tactical-text-muted">
              This will remove the area and its pixel associations from the campaign.
            </p>
            <div className="flex gap-3 justify-end pt-4 border-t border-tactical-border-medium">
              <TacticalButton
                variant="secondary"
                onClick={() => setAreaToDelete(null)}
              >
                Cancel
              </TacticalButton>
              <TacticalButton
                variant="danger"
                onClick={handleDeleteArea}
                disabled={isDeleting}
              >
                {isDeleting ? 'Removing...' : 'Remove Area'}
              </TacticalButton>
            </div>
          </div>
        </TacticalModal>
      )}

      {/* Edit/Sample Modal */}
      {areaToEdit && (
        <TacticalModal
          isOpen={!!areaToEdit}
          onClose={() => setAreaToEdit(null)}
          title={areaToEdit.name || areaToEdit.admin_boundary_name || 'Area'}
          size="sm"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-tactical-text-muted">Pixels:</span>
                <span className="ml-2 font-mono text-tactical-text-primary">{areaToEdit.pixel_count.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-tactical-text-muted">Sampled:</span>
                <span className={`ml-2 font-mono ${areaToEdit.sampled_count > 0 ? 'text-tactical-accent-green' : 'text-tactical-text-muted'}`}>
                  {areaToEdit.sampled_count.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-tactical-text-muted">Population:</span>
                <span className="ml-2 font-mono text-tactical-text-primary">{areaToEdit.total_population.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-tactical-text-muted">Buildings:</span>
                <span className="ml-2 font-mono text-tactical-text-primary">{areaToEdit.building_count.toLocaleString()}</span>
              </div>
            </div>

            {indicatorId && areaToEdit.pixel_count > 0 && (
              <div className="pt-4 border-t border-tactical-border-medium">
                <label className="block text-xs text-tactical-text-muted mb-1">
                  Number of pixels to sample
                </label>
                <input
                  type="number"
                  value={sampleCount}
                  onChange={(e) => setSampleCount(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={areaToEdit.pixel_count}
                  className="w-full px-3 py-2 bg-tactical-bg-tertiary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:border-tactical-accent-primary focus:outline-none"
                />
              </div>
            )}

            <div className="flex gap-3 justify-between pt-4 border-t border-tactical-border-medium">
              <TacticalButton
                variant="danger"
                size="sm"
                onClick={() => {
                  setAreaToDelete(areaToEdit);
                  setAreaToEdit(null);
                }}
              >
                Remove
              </TacticalButton>
              <div className="flex gap-3">
                <TacticalButton
                  variant="secondary"
                  onClick={() => setAreaToEdit(null)}
                >
                  Cancel
                </TacticalButton>
                {indicatorId && areaToEdit.pixel_count > 0 && (
                  areaToEdit.sampled_count > 0 ? (
                    <TacticalButton
                      variant="primary"
                      onClick={() => handleSample(true)}
                      disabled={isSampling}
                    >
                      {isSampling ? 'Resampling...' : 'Resample'}
                    </TacticalButton>
                  ) : (
                    <TacticalButton
                      variant="primary"
                      onClick={() => handleSample(false)}
                      disabled={isSampling}
                    >
                      {isSampling ? 'Sampling...' : 'Sample'}
                    </TacticalButton>
                  )
                )}
              </div>
            </div>
          </div>
        </TacticalModal>
      )}
    </>
  );
};

export default CampaignAreasManager;
