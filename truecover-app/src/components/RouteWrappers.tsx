import React, { useEffect, Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { useAppContext } from '../contexts/AppContext';
import { useOrganization } from '../hooks/useOrganizations';
import { useProject } from '../hooks/useProjects';
import { useCampaign } from '../hooks/useCampaigns';
import { useLocations } from '../hooks/useLocations';
import { TacticalLoader } from '../tactical-ui';

// Lazy-loaded page components for code-splitting
const CampaignDetailPage = lazy(() => import('../pages/CampaignDetailPage'));
const LocationsPage = lazy(() => import('../pages/LocationsPage'));

/**
 * Wrapper component for Campaign Detail with deep linking using React Query
 */
export const AreaDetailWrapper: React.FC = () => {
  const { orgId, projectId, campaignId } = useParams();
  const {
    selectedOrganization,
    setSelectedOrganization,
    selectedProject,
    setSelectedProject,
    selectedCampaign,
    setSelectedCampaign,
  } = useAppContext();

  // Use React Query hooks to fetch data
  const { data: organization, isLoading: isLoadingOrg } = useOrganization(orgId);
  const { data: project, isLoading: isLoadingProject } = useProject(projectId);
  const { data: campaign, isLoading: isLoadingCampaign } = useCampaign(campaignId);

  // Update local state when data is loaded
  useEffect(() => {
    if (organization && (!selectedOrganization || selectedOrganization.id !== organization.id)) {
      setSelectedOrganization(organization);
    }
  }, [organization]);

  useEffect(() => {
    if (project && (!selectedProject || selectedProject.id !== project.id)) {
      setSelectedProject(project);
    }
  }, [project]);

  useEffect(() => {
    if (campaign && (!selectedCampaign || selectedCampaign.id !== campaign.id)) {
      setSelectedCampaign(campaign);
    }
  }, [campaign]);

  // Show loading state while any data is loading
  const isLoading = isLoadingOrg || isLoadingProject || isLoadingCampaign;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-tactical-bg-primary flex items-center justify-center">
        <TacticalLoader size="lg" />
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-tactical-bg-primary flex items-center justify-center">
        <TacticalLoader size="lg" />
      </div>
    }>
      <CampaignDetailPage />
    </Suspense>
  );
};

/**
 * Wrapper component for Locations with deep linking using React Query
 */
export const LocationsWrapper: React.FC = () => {
  const { orgId, projectId, campaignId } = useParams();
  const {
    selectedOrganization,
    setSelectedOrganization,
    selectedProject,
    setSelectedProject,
    selectedCampaign,
    setSelectedCampaign,
    setLocations,
  } = useAppContext();

  // Use React Query hooks to fetch data
  const { data: organization, isLoading: isLoadingOrg } = useOrganization(orgId);
  const { data: project, isLoading: isLoadingProject } = useProject(projectId);
  const { data: campaign, isLoading: isLoadingCampaign } = useCampaign(campaignId);
  const { data: locationsData, isLoading: isLoadingLocations } = useLocations(campaignId);

  // Update local state when data is loaded
  useEffect(() => {
    if (organization && (!selectedOrganization || selectedOrganization.id !== organization.id)) {
      setSelectedOrganization(organization);
    }
  }, [organization]);

  useEffect(() => {
    if (project && (!selectedProject || selectedProject.id !== project.id)) {
      setSelectedProject(project);
    }
  }, [project]);

  useEffect(() => {
    if (campaign && (!selectedCampaign || selectedCampaign.id !== campaign.id)) {
      setSelectedCampaign(campaign);
    }
  }, [campaign]);

  useEffect(() => {
    if (locationsData) {
      setLocations(locationsData);
    }
  }, [locationsData]);

  // Show loading state while any data is loading
  const isLoading = isLoadingOrg || isLoadingProject || isLoadingCampaign || isLoadingLocations;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-tactical-bg-primary flex items-center justify-center">
        <TacticalLoader size="lg" />
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-tactical-bg-primary flex items-center justify-center">
        <TacticalLoader size="lg" />
      </div>
    }>
      <LocationsPage />
    </Suspense>
  );
};
