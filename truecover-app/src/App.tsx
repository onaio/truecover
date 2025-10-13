import React from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { SignInButton, UserButton, useAuth } from '@clerk/clerk-react';
import { AppProvider, useAppContext } from './contexts/AppContext';
import { useUserSync } from './hooks/useUserSync';
import { locationsApi } from './services/api';
import HomePage from './pages/HomePage';
import AdaptiveSamplingPage from './pages/AdaptiveSamplingPage';
import CoveragePredictionPage from './pages/CoveragePredictionPage';
import OrganizationManagementPage from './pages/OrganizationManagementPage';
import { LocationsWrapper } from './components/RouteWrappers';
import CreateOrganizationModal from './components/CreateOrganizationModal';
import CreateProjectModal from './components/CreateProjectModal';
import AddVisitModal from './components/AddVisitModal';
import GenerateMockVisitDataModal from './components/GenerateMockVisitDataModal';
import { TacticalButton } from './tactical-ui';

const AppContent: React.FC = () => {
  const navigate = useNavigate();
  const { getToken, isSignedIn } = useAuth();
  const {
    selectedOrganization,
    setSelectedOrganization,
    selectedProject,
    selectedArea,
    isCreateOrgModalOpen,
    setIsCreateOrgModalOpen,
    isCreateProjectModalOpen,
    setIsCreateProjectModalOpen,
    refreshOrganizations,
    refreshProjects,
    setLocations,
  } = useAppContext();

  // Auto-sync user to database on sign-in
  useUserSync();

  // Visit modal state - kept in App for global access
  const [isAddVisitModalOpen, setIsAddVisitModalOpen] = React.useState(false);
  const [isGenerateMockDataModalOpen, setIsGenerateMockDataModalOpen] = React.useState(false);
  const [selectedRoundForVisit, setSelectedRoundForVisit] = React.useState<string>('');

  return (
    <div style={{ position: 'relative' }}>
      {/* Clerk Auth Button - Top Right */}
      <div style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        zIndex: 9999,
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center'
      }}>
        {isSignedIn && window.location.pathname === '/' && (
          <TacticalButton
            variant="secondary"
            size="sm"
            onClick={() => navigate('/admin')}
          >
            Admin
          </TacticalButton>
        )}
        {isSignedIn ? (
          <UserButton afterSignOutUrl="/" />
        ) : (
          <SignInButton mode="modal">
            <TacticalButton variant="secondary" size="sm">
              Sign In
            </TacticalButton>
          </SignInButton>
        )}
      </div>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<OrganizationManagementPage />} />
        <Route path="/tools/adaptive-sampling" element={<AdaptiveSamplingPage />} />
        <Route path="/tools/coverage-prediction" element={<CoveragePredictionPage />} />
        <Route path="/orgs/:orgId/projects/:projectId/areas/:areaId" element={<LocationsWrapper />} />
      </Routes>

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
        organization={selectedOrganization}
        onProjectCreated={(project) => {
          setIsCreateProjectModalOpen(false);
          if (refreshProjects) {
            refreshProjects();
          }
        }}
      />

      {/* Create Organization Modal - Global */}
      <CreateOrganizationModal
        isOpen={isCreateOrgModalOpen}
        onClose={() => setIsCreateOrgModalOpen(false)}
        onOrganizationCreated={async (org) => {
          setSelectedOrganization(org);
          setIsCreateOrgModalOpen(false);
          if (refreshOrganizations) {
            await refreshOrganizations();
          }
        }}
      />

      {/* Add Visit Modal - Global */}
      {isAddVisitModalOpen && (
        <AddVisitModal
          isOpen={isAddVisitModalOpen}
          onClose={() => {
            setIsAddVisitModalOpen(false);
            setSelectedRoundForVisit('');
          }}
          areaId={selectedArea?.id || ''}
          areaName={selectedArea?.name || ''}
          roundId={selectedRoundForVisit}
          projectId={selectedProject?.id || ''}
          onSuccess={async () => {
            // Reload locations after adding visit data
            if (selectedArea) {
              const token = await getToken();
              if (token) {
                const locationsData = await locationsApi.list(selectedArea.id, token);
                setLocations(locationsData);
              }
            }
          }}
        />
      )}

      {/* Generate Mock Visit Data Modal - Global */}
      <GenerateMockVisitDataModal
        isOpen={isGenerateMockDataModalOpen}
        onClose={() => setIsGenerateMockDataModalOpen(false)}
      />
    </div>
  );
};

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
