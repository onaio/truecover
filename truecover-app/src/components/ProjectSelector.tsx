import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Project, Organization } from '../types';
import { projectsApi } from '../services/api';
import { TacticalSelect, TacticalButton, TacticalCard } from '../tactical-ui';

interface ProjectSelectorProps {
  selectedOrganization: Organization | null;
  selectedProject: Project | null;
  onProjectChange: (project: Project | null) => void;
  onCreateClick: () => void;
  onRefresh?: (refreshFn: () => Promise<void>) => void;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  selectedOrganization,
  selectedProject,
  onProjectChange,
  onCreateClick,
  onRefresh
}) => {
  const { getToken } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedOrganization) {
      loadProjects();
      // Expose the refresh function to the parent
      if (onRefresh) {
        onRefresh(loadProjects);
      }
    } else {
      setProjects([]);
      onProjectChange(null);
    }
  }, [selectedOrganization]);

  const loadProjects = async () => {
    if (!selectedOrganization) return;

    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      const projectList = await projectsApi.list(selectedOrganization.id, token);
      setProjects(projectList);

      // Auto-select first project if none selected
      if (!selectedProject && projectList.length > 0) {
        onProjectChange(projectList[0]);
      }
    } catch (err: any) {
      console.error('Failed to load projects:', err);
      setError(err.response?.data?.error || 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (value: string) => {
    if (value === '') {
      onProjectChange(null);
    } else {
      const project = projects.find(p => p.id === value);
      onProjectChange(project || null);
    }
  };

  if (!selectedOrganization) {
    return (
      <TacticalCard variant="secondary" padding="sm">
        <div className="text-sm text-tactical-text-dim">
          Please select an organization first
        </div>
      </TacticalCard>
    );
  }

  if (error) {
    return (
      <TacticalCard variant="secondary" padding="sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-tactical-accent-red">{error}</span>
          <TacticalButton size="sm" variant="secondary" onClick={loadProjects}>
            Retry
          </TacticalButton>
        </div>
      </TacticalCard>
    );
  }

  // Build options for TacticalSelect
  const selectOptions = [
    { value: '', label: 'Select Project' },
    ...projects.map(project => ({
      value: project.id,
      label: project.title
    }))
  ];

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <TacticalSelect
          value={selectedProject?.id || ''}
          onChange={handleChange}
          options={selectOptions}
          disabled={isLoading}
        />
      </div>
      <TacticalButton
        variant="primary"
        size="sm"
        onClick={onCreateClick}
      >
        + New Project
      </TacticalButton>
    </div>
  );
};

export default ProjectSelector;
