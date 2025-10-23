import React from 'react';
import { useAppContext } from '../contexts/AppContext';
import OrganizationSelector from '../components/OrganizationSelector';
import ProjectsList from '../components/ProjectsList';
import OrganizationSettings from '../components/OrganizationSettings';
import { TacticalCard, TacticalHeader } from '../tactical-ui';

const OrganizationManagementPage: React.FC = () => {
  const {
    selectedOrganization,
    setSelectedOrganization,
    setIsCreateOrgModalOpen,
    setRefreshOrganizations,
    refreshOrganizations,
  } = useAppContext();

  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title="True Cover / Organization Management"
        subtitle="Manage your organizations, projects, and team members"
      />

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Organization Selector */}
        <TacticalCard padding="md">
          <OrganizationSelector
            selectedOrganization={selectedOrganization}
            onOrganizationChange={setSelectedOrganization}
            onCreateClick={() => setIsCreateOrgModalOpen(true)}
            onRefresh={(refreshFn) => setRefreshOrganizations(() => refreshFn)}
          />
        </TacticalCard>

        {/* Projects and Settings Grid */}
        {selectedOrganization && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ProjectsList organization={selectedOrganization} />
            <OrganizationSettings
              organization={selectedOrganization}
              onOrganizationUpdated={(updatedOrg) => {
                setSelectedOrganization(updatedOrg);
              }}
              onOrganizationDeleted={async () => {
                setSelectedOrganization(null);
                if (refreshOrganizations) {
                  await refreshOrganizations();
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default OrganizationManagementPage;
