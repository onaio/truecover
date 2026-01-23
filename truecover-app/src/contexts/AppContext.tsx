import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Organization, Project } from '../types';

interface AppContextType {
  // Organization state
  selectedOrganization: Organization | null;
  setSelectedOrganization: (org: Organization | null) => void;
  refreshOrganizations: (() => Promise<void>) | null;
  setRefreshOrganizations: (fn: (() => Promise<void>) | null) => void;

  // Project state
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  refreshProjects: (() => Promise<void>) | null;
  setRefreshProjects: (fn: (() => Promise<void>) | null) => void;

  // Campaign state
  selectedCampaign: any | null;
  setSelectedCampaign: (area: any | null) => void;

  // Locations state
  locations: any | null;
  setLocations: (locations: any | null) => void;

  // Modal states
  isCreateOrgModalOpen: boolean;
  setIsCreateOrgModalOpen: (open: boolean) => void;
  isCreateProjectModalOpen: boolean;
  setIsCreateProjectModalOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Organization state
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [refreshOrganizations, setRefreshOrganizations] = useState<(() => Promise<void>) | null>(null);

  // Project state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [refreshProjects, setRefreshProjects] = useState<(() => Promise<void>) | null>(null);

  // Campaign state
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);

  // Locations state
  const [locations, setLocations] = useState<any | null>(null);

  // Modal states
  const [isCreateOrgModalOpen, setIsCreateOrgModalOpen] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);

  const value: AppContextType = {
    selectedOrganization,
    setSelectedOrganization,
    refreshOrganizations,
    setRefreshOrganizations,
    selectedProject,
    setSelectedProject,
    refreshProjects,
    setRefreshProjects,
    selectedCampaign,
    setSelectedCampaign,
    locations,
    setLocations,
    isCreateOrgModalOpen,
    setIsCreateOrgModalOpen,
    isCreateProjectModalOpen,
    setIsCreateProjectModalOpen,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
