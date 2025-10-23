import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project, Area } from '../types';
import { areasApi } from '../services/api';
import { TacticalModal, TacticalInput, TacticalButton, TacticalBadge, TacticalTextarea } from '../tactical-ui';

interface CreateAreaModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onAreaCreated: (area: Area) => void;
  editArea?: Area | null;
  onAreaUpdated?: (area: Area) => void;
}

const CreateAreaModal: React.FC<CreateAreaModalProps> = ({
  isOpen,
  onClose,
  project,
  onAreaCreated,
  editArea = null,
  onAreaUpdated
}) => {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (editArea) {
      setName(editArea.name);
      setDescription(editArea.description || '');
    } else {
      setName('');
      setDescription('');
    }
  }, [editArea, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Area name is required');
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

      if (editArea) {
        // Update existing area
        const updatedArea = await areasApi.update(
          editArea.id,
          name.trim(),
          description.trim(),
          token
        );
        if (onAreaUpdated) {
          onAreaUpdated(updatedArea);
        }
      } else {
        // Create new area
        const newArea = await areasApi.create(
          project.id,
          name.trim(),
          description.trim(),
          token
        );
        onAreaCreated(newArea);
      }
      setName('');
      setDescription('');
      onClose();
    } catch (err: any) {
      console.error(`Failed to ${editArea ? 'update' : 'create'} area:`, err);
      setError(err.response?.data?.error || `Failed to ${editArea ? 'update' : 'create'} area`);
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
      title={editArea ? "Edit Area" : "Create Area"}
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
            htmlFor="areaName"
            className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
          >
            Area Name
          </label>
          <TacticalInput
            id="areaName"
            type="text"
            value={name}
            onChange={setName}
            placeholder="Enter area name"
            disabled={isLoading}
          />
        </div>

        <TacticalTextarea
          id="areaDescription"
          label="Description (Optional)"
          value={description}
          onChange={setDescription}
          placeholder="Enter area description"
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
            disabled={isLoading || !name.trim() || (!project && !editArea)}
          >
            {isLoading ? (
              <span className="tactical-loading-dots">
                {editArea ? 'UPDATING' : 'CREATING'}<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              editArea ? 'Update Area' : 'Create Area'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default CreateAreaModal;
