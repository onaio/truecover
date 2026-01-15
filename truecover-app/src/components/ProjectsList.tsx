import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project, Organization } from '../types';
import { projectsApi } from '../services/api';
import ProjectSettings from './ProjectSettings';
import {
  TacticalCard,
  TacticalButton,
  TacticalBadge,
  TacticalModal,
  TacticalInput,
  TacticalTextarea
} from '../tactical-ui';

interface ProjectsListProps {
  organization: Organization | null;
}

const ProjectsList: React.FC<ProjectsListProps> = ({ organization }) => {
  const { getToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create Project Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Settings Modal state
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsProject, setSettingsProject] = useState<Project | null>(null);

  // Delete Project Modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (organization) {
      loadProjects();
    } else {
      setProjects([]);
    }
  }, [organization]);

  const loadProjects = async () => {
    if (!organization) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const projectsList = await projectsApi.list(organization.id, token);
      setProjects(projectsList);
    } catch (err: any) {
      console.error('Failed to load projects:', err);
      setError(err.response?.data?.error || 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!organization) return;
    if (!newProjectTitle.trim()) {
      setCreateError('Project title is required');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const token = await getToken();
      if (!token) {
        setCreateError('Authentication required');
        return;
      }

      const newProject = await projectsApi.create(
        organization.id,
        newProjectTitle.trim(),
        newProjectDescription.trim(),
        token
      );

      setProjects([newProject, ...projects]);
      setNewProjectTitle('');
      setNewProjectDescription('');
      setIsCreateModalOpen(false);
    } catch (err: any) {
      console.error('Failed to create project:', err);
      setCreateError(err.response?.data?.error || 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setNewProjectTitle('');
    setNewProjectDescription('');
    setCreateError(null);
  };

  const openSettingsModal = (project: Project) => {
    setSettingsProject(project);
    setIsSettingsModalOpen(true);
  };

  const closeSettingsModal = () => {
    setIsSettingsModalOpen(false);
    setSettingsProject(null);
  };

  const openDeleteModal = (project: Project) => {
    setDeletingProject(project);
    setIsDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeletingProject(null);
    setDeleteError(null);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const token = await getToken();
      if (!token) {
        setDeleteError('Authentication required');
        return;
      }

      await projectsApi.delete(deletingProject.id, token);
      setProjects(projects.filter(p => p.id !== deletingProject.id));
      closeDeleteModal();
    } catch (err: any) {
      console.error('Failed to delete project:', err);
      setDeleteError(err.response?.data?.error || 'Failed to delete project');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!organization) {
    return (
      <TacticalCard variant="secondary" padding="lg">
        <div className="text-center text-tactical-text-muted">
          <p className="font-mono text-sm uppercase tracking-wider">
            Select an organization to view projects
          </p>
        </div>
      </TacticalCard>
    );
  }

  return (
    <>
      <TacticalCard title="Projects" padding="lg">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm text-tactical-text-muted">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </p>
          <TacticalButton
            variant="primary"
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
          >
            + New Project
          </TacticalButton>
        </div>

        {error && (
          <div className="mb-4 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
            <div className="flex items-start gap-3">
              <TacticalBadge variant="danger">ERROR</TacticalBadge>
              <span className="text-sm text-tactical-accent-red">{error}</span>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8">
            <span className="text-sm text-tactical-text-muted tactical-loading-dots">
              LOADING PROJECTS<span>.</span><span>.</span><span>.</span>
            </span>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
            <p className="text-sm text-tactical-text-dim mb-3">
              No projects yet
            </p>
            <TacticalButton
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
            >
              Create Your First Project
            </TacticalButton>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className="border border-tactical-border-medium bg-tactical-bg-secondary p-4 hover:border-orange-500 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-1">
                      {project.title}
                    </h4>
                    {project.description && (
                      <p className="text-sm text-tactical-text-muted mb-2">
                        {project.description}
                      </p>
                    )}
                    <p className="text-xs text-tactical-text-dim">
                      Created {new Date(project.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <TacticalButton
                      variant="secondary"
                      size="sm"
                      onClick={() => openSettingsModal(project)}
                    >
                      Settings
                    </TacticalButton>
                    <TacticalButton
                      variant="secondary"
                      size="sm"
                      onClick={() => openDeleteModal(project)}
                    >
                      Delete
                    </TacticalButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </TacticalCard>

      {/* Create Project Modal */}
      <TacticalModal
        title="Create Project"
        isOpen={isCreateModalOpen}
        onClose={closeCreateModal}
        size="md"
      >
        <form onSubmit={handleCreateProject} className="space-y-4">
          {createError && (
            <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
              <TacticalBadge variant="danger">ERROR</TacticalBadge>
              <span className="text-sm text-tactical-accent-red">{createError}</span>
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
              value={newProjectTitle}
              onChange={setNewProjectTitle}
              placeholder="Enter project title"
              disabled={isCreating}
            />
          </div>

          <TacticalTextarea
            id="projectDescription"
            label="Description (Optional)"
            value={newProjectDescription}
            onChange={setNewProjectDescription}
            placeholder="Enter project description"
            disabled={isCreating}
            rows={3}
          />

          <div className="flex gap-3 justify-end pt-2">
            <TacticalButton
              type="button"
              variant="secondary"
              onClick={closeCreateModal}
              disabled={isCreating}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              type="submit"
              variant="primary"
              disabled={isCreating || !newProjectTitle.trim()}
            >
              {isCreating ? (
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

      {/* Project Settings Modal */}
      {settingsProject && (
        <ProjectSettings
          isOpen={isSettingsModalOpen}
          onClose={closeSettingsModal}
          project={settingsProject}
          onProjectUpdated={(updatedProject) => {
            setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
          }}
        />
      )}

      {/* Delete Project Modal */}
      <TacticalModal
        title="Delete Project"
        isOpen={isDeleteModalOpen}
        onClose={closeDeleteModal}
        size="md"
      >
        <div className="space-y-4">
          {deleteError && (
            <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
              <TacticalBadge variant="danger">ERROR</TacticalBadge>
              <span className="text-sm text-tactical-accent-red">{deleteError}</span>
            </div>
          )}

          <div className="p-4 border border-tactical-accent-red bg-tactical-bg-secondary">
            <div className="flex items-start gap-3 mb-3">
              <TacticalBadge variant="danger">WARNING</TacticalBadge>
              <span className="text-sm font-mono font-bold text-tactical-accent-red uppercase tracking-wider">
                Permanent Action
              </span>
            </div>
            <p className="text-sm text-tactical-text-secondary mb-2">
              You are about to delete the project <span className="font-bold text-tactical-text-primary">"{deletingProject?.title}"</span>.
            </p>
            <p className="text-sm text-tactical-text-secondary mb-2">
              This will permanently delete:
            </p>
            <ul className="list-disc list-inside text-sm text-tactical-text-secondary space-y-1 ml-4">
              <li>All project data and metadata</li>
              <li>All associated files and documents</li>
              <li>Project history and settings</li>
            </ul>
            <p className="text-sm text-tactical-accent-red font-bold mt-3">
              This action cannot be undone.
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <TacticalButton
              type="button"
              variant="secondary"
              onClick={closeDeleteModal}
              disabled={isDeleting}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              type="button"
              variant="primary"
              onClick={handleDeleteProject}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <span className="tactical-loading-dots">
                  DELETING<span>.</span><span>.</span><span>.</span>
                </span>
              ) : (
                'Delete Project'
              )}
            </TacticalButton>
          </div>
        </div>
      </TacticalModal>
    </>
  );
};

export default ProjectsList;
