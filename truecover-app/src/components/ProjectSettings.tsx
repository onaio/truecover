// ABOUTME: Project settings modal for configuring project details and ODK integration
// ABOUTME: Allows users to edit project name, description, and ODK API credentials
import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project } from '../types';
import { projectsApi } from '../services/api';
import {
  TacticalModal,
  TacticalButton,
  TacticalBadge,
  TacticalInput,
  TacticalTextarea
} from '../tactical-ui';

interface ProjectSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  onProjectUpdated: (project: Project) => void;
}

const ProjectSettings: React.FC<ProjectSettingsProps> = ({
  isOpen,
  onClose,
  project,
  onProjectUpdated
}) => {
  const { getToken } = useAuth();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description || '');
  const [odkApiKey, setOdkApiKey] = useState(project.odk_api_key || '');
  const [odkHostUrl, setOdkHostUrl] = useState(project.odk_host_url || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(project.title);
      setDescription(project.description || '');
      setOdkApiKey(project.odk_api_key || '');
      setOdkHostUrl(project.odk_host_url || '');
      setError(null);
    }
  }, [project, isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Project title is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      const updatedProject = await projectsApi.update(
        project.id,
        {
          title: title.trim(),
          description: description.trim(),
          odk_api_key: odkApiKey.trim() || null,
          odk_host_url: odkHostUrl.trim() || null
        },
        token
      );

      onProjectUpdated(updatedProject);
      onClose();
    } catch (err: any) {
      console.error('Failed to update project settings:', err);
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <TacticalModal
      title="Project Settings"
      isOpen={isOpen}
      onClose={onClose}
      size="md"
    >
      <form onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
            <TacticalBadge variant="danger">ERROR</TacticalBadge>
            <span className="text-sm text-tactical-accent-red">{error}</span>
          </div>
        )}

        <div>
          <h4 className="font-mono text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
            Project Information
          </h4>

          <div className="space-y-4">
            <TacticalInput
              label="Project Title"
              type="text"
              value={title}
              onChange={setTitle}
              placeholder="Enter project title"
              disabled={isSaving}
            />

            <TacticalTextarea
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Enter project description (optional)"
              disabled={isSaving}
              rows={3}
            />
          </div>
        </div>

        <div>
          <h4 className="font-mono text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
            ODK Central Integration
          </h4>

          <div className="space-y-4">
            <TacticalInput
              label="ODK Host URL"
              type="text"
              value={odkHostUrl}
              onChange={setOdkHostUrl}
              placeholder="https://your-odk-server.com"
              disabled={isSaving}
              helperText="The base URL of your ODK Central server"
            />

            <TacticalInput
              label="ODK API Key"
              type="password"
              value={odkApiKey}
              onChange={setOdkApiKey}
              placeholder="Enter API key"
              disabled={isSaving}
              showToggle={true}
              helperText="API key for authenticating with ODK Central"
            />
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="submit"
            variant="primary"
            disabled={isSaving || !title.trim()}
          >
            {isSaving ? (
              <span className="tactical-loading-dots">
                SAVING<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              'Save Settings'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default ProjectSettings;
