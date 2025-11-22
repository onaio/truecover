// ABOUTME: Page for project settings including ODK configuration
// ABOUTME: Accessed via /orgs/:orgId/projects/:projectId/settings route
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProject } from '../hooks/useProjects';
import ProjectSettings from '../components/ProjectSettings';
import { TacticalHeader, TacticalBreadcrumb } from '../tactical-ui';

const ProjectSettingsPage: React.FC = () => {
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading, error, refetch } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-tactical-bg-primary">
        <div className="max-w-4xl mx-auto p-6">
          <div className="text-center py-12">
            <span className="text-sm text-tactical-text-muted tactical-loading-dots">
              LOADING PROJECT SETTINGS<span>.</span><span>.</span><span>.</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-tactical-bg-primary">
        <div className="max-w-4xl mx-auto p-6">
          <div className="text-center py-12">
            <p className="text-sm text-tactical-accent-red">
              Failed to load project settings
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <div className="bg-tactical-bg-secondary px-6 py-3">
        <TacticalBreadcrumb
          items={[
            { label: 'Home', href: '/' },
            { label: 'Admin', href: '/admin' },
            { label: project.title },
            { label: 'Settings' }
          ]}
        />
      </div>
      <TacticalHeader
        title={`${project.title} Settings`}
        subtitle="Configure project settings and integrations"
      />

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <ProjectSettings
          project={project}
          organizationId={orgId!}
          onProjectUpdated={(updatedProject) => {
            refetch();
          }}
        />
      </div>
    </div>
  );
};

export default ProjectSettingsPage;
