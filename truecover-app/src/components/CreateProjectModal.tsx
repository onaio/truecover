import React, { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project, Organization } from '../types';
import { projectsApi } from '../services/api';
import { TacticalModal, TacticalInput, TacticalButton, TacticalBadge, TacticalTextarea } from '../tactical-ui';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  organization: Organization | null;
  onProjectCreated: (project: Project) => void;
}

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  organization,
  onProjectCreated
}) => {
  const { getToken } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Project title is required');
      return;
    }

    if (!organization) {
      setError('Please select an organization first');
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

      const newProject = await projectsApi.create(
        organization.id,
        title.trim(),
        description.trim(),
        token
      );
      onProjectCreated(newProject);
      setTitle('');
      setDescription('');
      onClose();
    } catch (err: any) {
      console.error('Failed to create project:', err);
      setError(err.response?.data?.error || 'Failed to create project');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setError(null);
    onClose();
  };

  return (
    <TacticalModal
      title="Create Project"
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

        {organization && (
          <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
            <span className="text-xs text-tactical-text-dim uppercase tracking-wider">
              Organization
            </span>
            <p className="text-sm text-tactical-text-primary font-bold mt-1">
              {organization.name}
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="projectTitle"
            className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
          >
            Project Title
          </label>
          <TacticalInput
            type="text"
            value={title}
            onChange={setTitle}
            placeholder="Enter project title"
            disabled={isLoading}
          />
        </div>

        <TacticalTextarea
          id="projectDescription"
          label="Description (Optional)"
          value={description}
          onChange={setDescription}
          placeholder="Enter project description"
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
            disabled={isLoading || !title.trim() || !organization}
          >
            {isLoading ? (
              <span className="tactical-loading-dots">
                CREATING<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              'Create Project'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default CreateProjectModal;
