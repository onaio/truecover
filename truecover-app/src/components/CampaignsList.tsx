import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Campaign, Project } from '../types';
import { campaignsApi } from '../services/api';
import { useDeleteCampaign } from '../hooks/useCampaigns';
import { useAppContext } from '../contexts/AppContext';
import CreateCampaignModal from './CreateCampaignModal';
import {
  TacticalCard,
  TacticalButton,
  TacticalBadge,
  TacticalCollapsible,
  TacticalModal
} from '../tactical-ui';

interface CampaignsListProps {
  project: Project | null;
  onCampaignSelect?: (campaign: Campaign) => void;
}

const CampaignsList: React.FC<CampaignsListProps> = ({ project, onCampaignSelect }) => {
  const { getToken } = useAuth();
  const { selectedCampaign, setSelectedCampaign } = useAppContext();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const deleteCampaignMutation = useDeleteCampaign();

  useEffect(() => {
    if (project) {
      loadCampaigns();
    } else {
      setCampaigns([]);
    }
  }, [project, refreshKey]);

  const loadCampaigns = async () => {
    if (!project) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const campaignsList = await campaignsApi.list(project.id, token);
      setCampaigns(campaignsList);
    } catch (err: any) {
      console.error('Failed to load campaigns:', err);
      setError(err.response?.data?.error || 'Failed to load campaigns');
    } finally {
      setIsLoading(false);
    }
  };

  if (!project) {
    return (
      <TacticalCard variant="secondary" padding="lg">
        <div className="text-center text-tactical-text-muted">
          <p className="font-mono text-sm uppercase tracking-wider">
            Select a project to view campaigns
          </p>
        </div>
      </TacticalCard>
    );
  }

  const handleCampaignCreated = (newCampaign: Campaign) => {
    setCampaigns([newCampaign, ...campaigns]);
    setRefreshKey(prev => prev + 1);
  };

  const handleCampaignUpdated = (updatedCampaign: Campaign) => {
    setCampaigns(campaigns.map(campaign => campaign.id === updatedCampaign.id ? updatedCampaign : campaign));
    setEditingCampaign(null);
    setRefreshKey(prev => prev + 1);
  };

  const handleEditClick = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setIsCreateModalOpen(true);
  };

  const handleDeleteClick = (campaign: Campaign) => {
    setCampaignToDelete(campaign);
  };

  const handleConfirmDelete = async () => {
    if (!campaignToDelete || !project) return;

    try {
      await deleteCampaignMutation.mutateAsync({
        campaignId: campaignToDelete.id,
        projectId: project.id
      });
      setCampaigns(campaigns.filter(c => c.id !== campaignToDelete.id));

      // Clear selected campaign if we're deleting the currently selected one
      if (selectedCampaign?.id === campaignToDelete.id) {
        setSelectedCampaign(null);
      }

      setCampaignToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete campaign:', err);
      setError(err.response?.data?.error || 'Failed to delete campaign');
    }
  };

  const handleModalClose = () => {
    setIsCreateModalOpen(false);
    setEditingCampaign(null);
    setRefreshKey(prev => prev + 1);
  };

  return (
    <>
    <TacticalCard padding="lg">
      <TacticalCollapsible
        title="Campaigns"
        defaultCollapsed={false}
        collapsedSummary={
          !isLoading
            ? `(${campaigns.length} ${campaigns.length === 1 ? 'Campaign' : 'Campaigns'})`
            : undefined
        }
        actionButton={
          <TacticalButton
            variant="primary"
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
          >
            + New Campaign
          </TacticalButton>
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
              LOADING CAMPAIGNS<span>.</span><span>.</span><span>.</span>
            </span>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
            <p className="text-sm text-tactical-text-dim mb-3">
              No campaigns yet
            </p>
            <TacticalButton
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
            >
              Create Your First Campaign
            </TacticalButton>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="group border border-tactical-border-medium bg-tactical-bg-secondary p-4 hover:border-tactical-accent-orange transition-colors cursor-pointer"
                onClick={() => onCampaignSelect?.(campaign)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-1">
                      {campaign.name}
                    </h4>
                    {campaign.description && (
                      <p className="text-sm text-tactical-text-muted mb-2">
                        {campaign.description}
                      </p>
                    )}
                    <p className="text-xs text-tactical-text-dim">
                      Created {new Date(campaign.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <TacticalButton
                      variant="secondary"
                      size="sm"
                      onClick={() => handleEditClick(campaign)}
                    >
                      Edit
                    </TacticalButton>
                    <TacticalButton
                      variant="danger"
                      size="sm"
                      onClick={() => handleDeleteClick(campaign)}
                    >
                      Delete
                    </TacticalButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </TacticalCollapsible>
    </TacticalCard>

    {/* Create/Edit Campaign Modal */}
    <CreateCampaignModal
      isOpen={isCreateModalOpen}
      onClose={handleModalClose}
      project={project}
      onCampaignCreated={handleCampaignCreated}
      editCampaign={editingCampaign}
      onCampaignUpdated={handleCampaignUpdated}
    />

    {/* Delete Campaign Confirmation Modal */}
    {campaignToDelete && (
      <TacticalModal
        isOpen={!!campaignToDelete}
        onClose={() => setCampaignToDelete(null)}
        title="Delete Campaign"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-tactical-text-secondary">
            Are you sure you want to delete <span className="font-bold">"{campaignToDelete.name}"</span>?
          </p>
          <p className="text-xs text-tactical-text-muted">
            This action cannot be undone. All associated data will be deleted.
          </p>
          <div className="flex gap-3 justify-end pt-4 border-t border-tactical-border-medium">
            <TacticalButton
              variant="secondary"
              onClick={() => setCampaignToDelete(null)}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              variant="danger"
              onClick={handleConfirmDelete}
              disabled={deleteCampaignMutation.isPending}
            >
              {deleteCampaignMutation.isPending ? 'Deleting...' : 'Delete Campaign'}
            </TacticalButton>
          </div>
        </div>
      </TacticalModal>
    )}
    </>
  );
};

export default CampaignsList;
