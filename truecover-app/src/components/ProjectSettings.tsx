// ABOUTME: Project settings page for configuring ODK integration and other project-level settings
// ABOUTME: Allows users to set ODK API credentials for data collection integration
import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project } from '../types';
import { projectsApi } from '../services/api';
import {
  TacticalCard,
  TacticalButton,
  TacticalBadge,
  TacticalInput
} from '../tactical-ui';

interface ProjectSettingsProps {
  project: Project;
  organizationId: string;
  onProjectUpdated: (project: Project) => void;
}

const ProjectSettings: React.FC<ProjectSettingsProps> = ({
  project,
  organizationId,
  onProjectUpdated
}) => {
  const { getToken } = useAuth();
  const [odkApiKey, setOdkApiKey] = useState(project.odk_api_key || '');
  const [odkHostUrl, setOdkHostUrl] = useState(project.odk_host_url || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setOdkApiKey(project.odk_api_key || '');
    setOdkHostUrl(project.odk_host_url || '');
  }, [project]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      const updatedProject = await projectsApi.update(
        project.id,
        {
          odk_api_key: odkApiKey.trim() || null,
          odk_host_url: odkHostUrl.trim() || null
        },
        token
      );

      onProjectUpdated(updatedProject);
      setSuccessMessage('Settings saved successfully');

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to update project settings:', err);
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    odkApiKey !== (project.odk_api_key || '') ||
    odkHostUrl !== (project.odk_host_url || '');

  return (
    <TacticalCard title="Project Settings" padding="lg">
      <div className="space-y-6">
        {/* Project Info */}
        <div>
          <h4 className="font-mono text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
            Project Information
          </h4>
          <div className="space-y-2">
            <div>
              <span className="text-xs text-tactical-text-muted uppercase tracking-wider">Name:</span>
              <p className="text-tactical-text-secondary">{project.title}</p>
            </div>
            {project.description && (
              <div>
                <span className="text-xs text-tactical-text-muted uppercase tracking-wider">Description:</span>
                <p className="text-tactical-text-secondary">{project.description}</p>
              </div>
            )}
          </div>
        </div>

        {/* ODK Configuration */}
        <div>
          <h4 className="font-mono text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
            ODK Central Integration
          </h4>

          <form onSubmit={handleSave} className="space-y-4">
            {error && (
              <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
                <TacticalBadge variant="danger">ERROR</TacticalBadge>
                <span className="text-sm text-tactical-accent-red">{error}</span>
              </div>
            )}

            {successMessage && (
              <div className="flex items-start gap-3 p-3 border border-tactical-accent-green bg-tactical-bg-secondary">
                <TacticalBadge variant="success">SUCCESS</TacticalBadge>
                <span className="text-sm text-tactical-accent-green">{successMessage}</span>
              </div>
            )}

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

            <div className="flex gap-3 justify-end pt-4">
              <TacticalButton
                type="submit"
                variant="primary"
                disabled={isSaving || !hasChanges}
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
        </div>
      </div>
    </TacticalCard>
  );
};

export default ProjectSettings;
