// ABOUTME: Project settings modal for configuring project details and ODK integration
// ABOUTME: Allows users to edit project name, description, and ODK API credentials
import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project, OnaProject, OnaEntityList } from '../types';
import { projectsApi, onaApi } from '../services/api';
import {
  TacticalModal,
  TacticalButton,
  TacticalBadge,
  TacticalInput,
  TacticalTextarea,
  TacticalSelect
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

  // Ona project selection state
  const [isVerifying, setIsVerifying] = useState(false);
  const [onaProjects, setOnaProjects] = useState<OnaProject[]>([]);
  const [selectedOnaProjectId, setSelectedOnaProjectId] = useState<number | null>(project.ona_project_id);
  const [selectedOnaProjectName, setSelectedOnaProjectName] = useState<string | null>(project.ona_project_name);

  // Entity list selection state
  const [isLoadingEntityLists, setIsLoadingEntityLists] = useState(false);
  const [onaEntityLists, setOnaEntityLists] = useState<OnaEntityList[]>([]);
  const [selectedEntityListId, setSelectedEntityListId] = useState<number | null>(project.ona_entity_list_id);
  const [selectedEntityListName, setSelectedEntityListName] = useState<string | null>(project.ona_entity_list_name);

  useEffect(() => {
    if (isOpen) {
      setTitle(project.title);
      setDescription(project.description || '');
      setOdkApiKey(project.odk_api_key || '');
      setOdkHostUrl(project.odk_host_url || '');
      setSelectedOnaProjectId(project.ona_project_id);
      setSelectedOnaProjectName(project.ona_project_name);
      setSelectedEntityListId(project.ona_entity_list_id);
      setSelectedEntityListName(project.ona_entity_list_name);
      setError(null);
      setOnaProjects([]);
      setOnaEntityLists([]);
    }
  }, [project, isOpen]);

  // Clear selections when credentials are edited
  useEffect(() => {
    if (isOpen) {
      const credentialsChanged =
        odkApiKey !== project.odk_api_key ||
        odkHostUrl !== project.odk_host_url;

      if (credentialsChanged) {
        setOnaProjects([]);
        setOnaEntityLists([]);
        setSelectedOnaProjectId(null);
        setSelectedOnaProjectName(null);
        setSelectedEntityListId(null);
        setSelectedEntityListName(null);
      }
    }
  }, [odkApiKey, odkHostUrl, isOpen]);

  const handleVerifyAndListProjects = async (autoLoad = false, savedProjectId: number | null = null) => {
    if (!odkApiKey.trim() || !odkHostUrl.trim()) {
      if (!autoLoad) {
        setError('Please enter both API Key and Host URL before verifying');
      }
      return;
    }

    setIsVerifying(true);
    setError(null);

    // Only clear selections if not auto-loading
    if (!autoLoad) {
      setOnaProjects([]);
      setOnaEntityLists([]);
      setSelectedOnaProjectId(null);
      setSelectedOnaProjectName(null);
      setSelectedEntityListId(null);
      setSelectedEntityListName(null);
    } else {
      setOnaProjects([]);
      setOnaEntityLists([]);
    }

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      const result = await onaApi.verifyCredentialsAndListProjects(
        project.id,
        odkApiKey.trim(),
        odkHostUrl.trim(),
        token
      );

      if (!result.success) {
        setError(result.error || 'Failed to verify credentials');
        return;
      }

      setOnaProjects(result.projects || []);

      // If auto-loading and there's a saved project selection, load entity lists
      if (autoLoad && savedProjectId) {
        await loadEntityListsForProject(savedProjectId);
      }
    } catch (err: any) {
      console.error('Failed to verify credentials:', err);
      setError(err.response?.data?.error || 'Failed to verify credentials');
    } finally {
      setIsVerifying(false);
    }
  };

  const loadEntityListsForProject = async (numProjectId: number) => {
    setIsLoadingEntityLists(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      const result = await onaApi.getEntityLists(project.id, numProjectId, token);

      if (result.error) {
        setError(result.error);
      }

      setOnaEntityLists(result.entity_lists || []);
    } catch (err: any) {
      console.error('Failed to load entity lists:', err);
      setError(err.response?.data?.error || 'Failed to load entity lists');
    } finally {
      setIsLoadingEntityLists(false);
    }
  };

  const handleOnaProjectSelect = async (projectId: string) => {
    const numProjectId = parseInt(projectId, 10);
    const selectedProject = onaProjects.find(p => {
      // Try to extract project ID from URL if projectid field doesn't exist
      const idFromUrl = p.url.split('/').pop();
      return p.projectid === numProjectId || parseInt(idFromUrl || '0', 10) === numProjectId;
    });

    setSelectedOnaProjectId(numProjectId);
    setSelectedOnaProjectName(selectedProject?.name || null);
    setSelectedEntityListId(null);
    setSelectedEntityListName(null);
    setOnaEntityLists([]);

    // Load entity lists for selected project
    if (numProjectId) {
      await loadEntityListsForProject(numProjectId);
    }
  };

  const handleEntityListSelect = (entityListId: string) => {
    const numEntityListId = parseInt(entityListId, 10);
    const selectedList = onaEntityLists.find(e => e.id === numEntityListId);

    setSelectedEntityListId(numEntityListId);
    setSelectedEntityListName(selectedList?.name || null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('🔴 SAVE CLICKED - Current state:');
    console.log('   selectedOnaProjectId:', selectedOnaProjectId);
    console.log('   selectedOnaProjectName:', selectedOnaProjectName);
    console.log('   selectedEntityListId:', selectedEntityListId);
    console.log('   selectedEntityListName:', selectedEntityListName);

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

      const updateData = {
        title: title.trim(),
        description: description.trim(),
        odk_api_key: odkApiKey.trim() || null,
        odk_host_url: odkHostUrl.trim() || null,
        ona_project_id: selectedOnaProjectId,
        ona_project_name: selectedOnaProjectName,
        ona_entity_list_id: selectedEntityListId,
        ona_entity_list_name: selectedEntityListName
      };

      console.log('💾 Saving project with data:', updateData);

      const updatedProject = await projectsApi.update(
        project.id,
        updateData,
        token
      );

      console.log('✅ Received updated project:', updatedProject);

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
            ODK Integration
          </h4>

          <div className="space-y-4">
            <TacticalInput
              label="Ona Data Host URL"
              type="text"
              value={odkHostUrl}
              onChange={setOdkHostUrl}
              placeholder="https://your-odk-server.com"
              disabled={isSaving}
              helperText="The base URL of your ODK server"
            />

            <TacticalInput
              label="API Key"
              type="password"
              value={odkApiKey}
              onChange={setOdkApiKey}
              placeholder="Enter API key"
              disabled={isSaving}
              showToggle={true}
              helperText="API key for authenticating with ODK"
            />

            {/* Show verify button only if no project is selected */}
            {!selectedOnaProjectId && (
              <div className="pt-2">
                <TacticalButton
                  type="button"
                  variant="secondary"
                  onClick={() => handleVerifyAndListProjects(false)}
                  disabled={isVerifying || isSaving || !odkApiKey.trim() || !odkHostUrl.trim()}
                  fullWidth
                >
                  {isVerifying ? (
                    <span className="tactical-loading-dots">
                      VERIFYING<span>.</span><span>.</span><span>.</span>
                    </span>
                  ) : (
                    'Verify & Select Project'
                  )}
                </TacticalButton>
              </div>
            )}

            {/* Show saved project as badge when selected */}
            {selectedOnaProjectId && selectedOnaProjectName && !onaProjects.length && (
              <div>
                <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                  Ona Project
                </label>
                <div className="flex items-center justify-between p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
                  <div className="flex items-center gap-2">
                    <TacticalBadge variant="success">SELECTED</TacticalBadge>
                    <span className="text-sm text-tactical-text-primary font-mono">{selectedOnaProjectName}</span>
                  </div>
                  <TacticalButton
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSelectedOnaProjectId(null);
                      setSelectedOnaProjectName(null);
                      setSelectedEntityListId(null);
                      setSelectedEntityListName(null);
                    }}
                    disabled={isSaving}
                  >
                    Change
                  </TacticalButton>
                </div>
              </div>
            )}

            {/* Show project dropdown when verifying */}
            {onaProjects.length > 0 && (() => {
              console.log('🔶 RENDERING PROJECT DROPDOWN with', onaProjects.length, 'projects');
              console.log('   Projects:', onaProjects.map(p => ({ id: p.projectid, name: p.name })));
              return (
                <TacticalSelect
                  label="Ona Project"
                  value={selectedOnaProjectId?.toString() || ''}
                  onChange={handleOnaProjectSelect}
                  options={onaProjects.map(p => {
                    const projectId = p.projectid || parseInt(p.url.split('/').pop() || '0', 10);
                    return {
                      value: projectId.toString(),
                      label: p.name
                    };
                  })}
                  placeholder="Select a project..."
                  disabled={isLoadingEntityLists || isSaving}
                  helperText={selectedOnaProjectName ? `Selected: ${selectedOnaProjectName}` : undefined}
                />
              );
            })()}

            {/* Show saved entity list as badge when selected */}
            {selectedEntityListId && selectedEntityListName && !onaEntityLists.length && (
              <div>
                <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                  Entity List
                </label>
                <div className="flex items-center justify-between p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
                  <div className="flex items-center gap-2">
                    <TacticalBadge variant="success">SELECTED</TacticalBadge>
                    <span className="text-sm text-tactical-text-primary font-mono">{selectedEntityListName}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Show entity list dropdown when project is selected and verifying */}
            {onaEntityLists.length > 0 && (
              <TacticalSelect
                label="Entity List"
                value={selectedEntityListId?.toString() || ''}
                onChange={handleEntityListSelect}
                options={onaEntityLists.map(e => ({
                  value: e.id.toString(),
                  label: `${e.name} (${e.numentities} entities)`
                }))}
                placeholder="Select an entity list..."
                disabled={isSaving}
                helperText={selectedEntityListName ? `Selected: ${selectedEntityListName}` : undefined}
              />
            )}
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
