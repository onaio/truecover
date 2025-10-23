import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { useAppContext } from '../contexts/AppContext';
import OrganizationSelector from '../components/OrganizationSelector';
import ProjectSelector from '../components/ProjectSelector';
import AreasList from '../components/AreasList';
import IndicatorsManager from '../components/IndicatorsManager';
import { TacticalCard } from '../tactical-ui';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const {
    selectedOrganization,
    setSelectedOrganization,
    selectedProject,
    setSelectedProject,
    setSelectedArea,
    setRefreshOrganizations,
    setRefreshProjects,
    setIsCreateProjectModalOpen,
  } = useAppContext();

  return (
    <div className="min-h-screen bg-tactical-bg-primary flex flex-col p-6">
      <div className="flex-1 flex flex-col items-center">
        <div className="text-center mb-12 mt-12">
          <h1 className="font-mono text-6xl font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
            True Cover
          </h1>
          <p className="font-mono text-sm text-tactical-text-muted uppercase tracking-wide">
            Estimating true coverage
          </p>
        </div>

        {/* Organization and Project Selectors */}
        {isSignedIn && (
          <div className="w-full max-w-4xl mx-auto mb-8 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TacticalCard padding="md">
                <OrganizationSelector
                  selectedOrganization={selectedOrganization}
                  onOrganizationChange={setSelectedOrganization}
                  onRefresh={(refreshFn) => setRefreshOrganizations(() => refreshFn)}
                  showCreateButton={false}
                />
              </TacticalCard>
              <TacticalCard padding="md">
                <ProjectSelector
                  selectedOrganization={selectedOrganization}
                  selectedProject={selectedProject}
                  onProjectChange={setSelectedProject}
                  onCreateClick={() => setIsCreateProjectModalOpen(true)}
                  onRefresh={(refreshFn) => setRefreshProjects(() => refreshFn)}
                />
              </TacticalCard>
            </div>

            {/* Indicators Manager */}
            {selectedProject && (
              <IndicatorsManager projectId={selectedProject.id} />
            )}

            {/* Locations List */}
            <AreasList
              project={selectedProject}
              onAreaSelect={(area) => {
                setSelectedArea(area);
                navigate(`/orgs/${selectedOrganization?.id}/projects/${selectedProject?.id}/areas/${area?.id}`);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePage;
