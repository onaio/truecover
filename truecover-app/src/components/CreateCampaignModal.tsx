import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project, Campaign } from '../types';
import { campaignsApi } from '../services/api';
import { TacticalModal, TacticalInput, TacticalButton, TacticalBadge, TacticalTextarea } from '../tactical-ui';

interface CreateCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onCampaignCreated: (campaign: Campaign) => void;
  editCampaign?: Campaign | null;
  onCampaignUpdated?: (campaign: Campaign) => void;
}

const CreateCampaignModal: React.FC<CreateCampaignModalProps> = ({
  isOpen,
  onClose,
  project,
  onCampaignCreated,
  editCampaign = null,
  onCampaignUpdated
}) => {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (editCampaign) {
      setName(editCampaign.name);
      setDescription(editCampaign.description || '');
    } else {
      setName('');
      setDescription('');
    }
  }, [editCampaign, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Campaign name is required');
      return;
    }

    if (!project) {
      setError('Please select a project first');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      if (editCampaign) {
        // Update existing campaign
        const updatedCampaign = await campaignsApi.update(
          editCampaign.id,
          name.trim(),
          description.trim(),
          token
        );
        if (onCampaignUpdated) {
          onCampaignUpdated(updatedCampaign);
        }
      } else {
        // Create new campaign
        const newCampaign = await campaignsApi.create(
          project.id,
          name.trim(),
          description.trim(),
          token
        );
        onCampaignCreated(newCampaign);
      }
      setName('');
      setDescription('');
      onClose();
    } catch (err: any) {
      console.error(`Failed to ${editCampaign ? 'update' : 'create'} campaign:`, err);
      setError(err.response?.data?.error || `Failed to ${editCampaign ? 'update' : 'create'} campaign`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setError(null);
    onClose();
  };

  return (
    <TacticalModal
      title={editCampaign ? "Edit Campaign" : "Create Campaign"}
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
            <TacticalBadge variant="danger">ERROR</TacticalBadge>
            <span className="text-sm text-tactical-accent-red">{error}</span>
          </div>
        )}

        {project && (
          <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
            <span className="text-xs text-tactical-text-dim uppercase tracking-wider">
              Project
            </span>
            <p className="text-sm text-tactical-text-primary font-bold mt-1">
              {project.title}
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="campaignName"
            className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
          >
            Campaign Name
          </label>
          <TacticalInput
            type="text"
            value={name}
            onChange={setName}
            placeholder="Enter campaign name"
            disabled={isLoading}
          />
        </div>

        <TacticalTextarea
          id="campaignDescription"
          label="Description (Optional)"
          value={description}
          onChange={setDescription}
          placeholder="Enter campaign description"
          disabled={isLoading}
          rows={3}
        />

        <div className="flex gap-3 justify-end pt-2">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="submit"
            variant="primary"
            disabled={isLoading || !name.trim() || (!project && !editCampaign)}
          >
            {isLoading ? (
              <span className="tactical-loading-dots">
                {editCampaign ? 'UPDATING' : 'CREATING'}<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              editCampaign ? 'Update Campaign' : 'Create Campaign'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default CreateCampaignModal;
