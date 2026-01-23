import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { campaignAreasApi } from '../services/api';
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
  created_at: string;
}

interface CampaignAreasManagerProps {
  campaignId: string;
  onAddAdminBoundary?: () => void;
  onDrawArea?: () => void;
}

const CampaignAreasManager: React.FC<CampaignAreasManagerProps> = ({
  campaignId,
  onAddAdminBoundary,
  onDrawArea
}) => {
  const { getToken } = useAuth();
  const [areas, setAreas] = useState<CampaignArea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computingAreaId, setComputingAreaId] = useState<string | null>(null);
  const [areaToDelete, setAreaToDelete] = useState<CampaignArea | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (campaignId) {
      loadAreas();
    }
  }, [campaignId]);

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
    } catch (err: any) {
      console.error('Failed to delete area:', err);
      tacticalToast.error(err.response?.data?.error || 'Failed to remove area');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPixels = areas.reduce((sum, area) => sum + (area.pixel_count || 0), 0);

  return (
    <>
      <TacticalCard padding="lg">
        <TacticalCollapsible
          title="Campaign Areas"
          defaultCollapsed={false}
          collapsedSummary={
            !isLoading
              ? `(${areas.length} ${areas.length === 1 ? 'Area' : 'Areas'}, ${totalPixels.toLocaleString()} pixels)`
              : undefined
          }
          actionButton={
            <div className="flex gap-2">
              {onAddAdminBoundary && (
                <TacticalButton
                  variant="secondary"
                  size="sm"
                  onClick={onAddAdminBoundary}
                >
                  + Admin Boundary
                </TacticalButton>
              )}
              {onDrawArea && (
                <TacticalButton
                  variant="secondary"
                  size="sm"
                  onClick={onDrawArea}
                >
                  + Draw Area
                </TacticalButton>
              )}
            </div>
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
              <p className="text-xs text-tactical-text-muted mb-4">
                Add admin boundaries or draw custom areas to define the campaign coverage
              </p>
              <div className="flex gap-2 justify-center">
                {onAddAdminBoundary && (
                  <TacticalButton
                    variant="secondary"
                    size="sm"
                    onClick={onAddAdminBoundary}
                  >
                    Add Admin Boundary
                  </TacticalButton>
                )}
                {onDrawArea && (
                  <TacticalButton
                    variant="secondary"
                    size="sm"
                    onClick={onDrawArea}
                  >
                    Draw Area
                  </TacticalButton>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Compute All Pixels Button */}
              {areas.some(a => a.pixel_count === 0) && (
                <div className="flex justify-end mb-2">
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
                </div>
              )}

              {areas.map((area) => (
                <div
                  key={area.id}
                  className="group border border-tactical-border-medium bg-tactical-bg-secondary p-4"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                          {area.name || area.admin_boundary_name || 'Unnamed Area'}
                        </h4>
                        <TacticalBadge variant={area.area_type === 'admin_boundary' ? 'info' : 'warning'}>
                          {area.area_type === 'admin_boundary' ? 'ADMIN' : 'DRAWN'}
                        </TacticalBadge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-tactical-text-muted">
                        <span>
                          {area.pixel_count > 0 ? (
                            <span className="text-tactical-accent-green">
                              {area.pixel_count.toLocaleString()} pixels
                            </span>
                          ) : (
                            <span className="text-tactical-text-dim">No pixels computed</span>
                          )}
                        </span>
                        {area.bbox && (
                          <span className="text-xs text-tactical-text-dim">
                            bbox: [{area.bbox.min_lng.toFixed(2)}, {area.bbox.min_lat.toFixed(2)}] to [{area.bbox.max_lng.toFixed(2)}, {area.bbox.max_lat.toFixed(2)}]
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {area.pixel_count === 0 && (
                        <TacticalButton
                          variant="primary"
                          size="sm"
                          onClick={() => handleComputePixels(area.id)}
                          disabled={computingAreaId !== null}
                        >
                          {computingAreaId === area.id ? (
                            <span className="tactical-loading-dots">
                              Computing<span>.</span><span>.</span><span>.</span>
                            </span>
                          ) : (
                            'Compute Pixels'
                          )}
                        </TacticalButton>
                      )}
                      <TacticalButton
                        variant="danger"
                        size="sm"
                        onClick={() => setAreaToDelete(area)}
                      >
                        Remove
                      </TacticalButton>
                    </div>
                  </div>
                </div>
              ))}

              {/* Summary */}
              <div className="pt-3 border-t border-tactical-border-medium">
                <p className="text-sm text-tactical-text-muted">
                  Total: <span className="font-bold text-tactical-text-primary">{areas.length}</span> areas,
                  <span className="font-bold text-tactical-accent-green ml-1">{totalPixels.toLocaleString()}</span> pixels
                </p>
              </div>
            </div>
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
    </>
  );
};

export default CampaignAreasManager;
