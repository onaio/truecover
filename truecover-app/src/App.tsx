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
import ProjectSettingsPage from './pages/ProjectSettingsPage';
import TacticalShowcase from './pages/TacticalShowcase';
import { LocationsWrapper } from './components/RouteWrappers';
import CreateOrganizationModal from './components/CreateOrganizationModal';
import CreateProjectModal from './components/CreateProjectModal';
import AddVisitModal from './components/AddVisitModal';
import { TacticalButton, TacticalToaster } from './tactical-ui';

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
  const [selectedRoundForVisit, setSelectedRoundForVisit] = React.useState<string>('');

  return (
    <div style={{ position: 'relative' }}>
      {/* Clerk Auth Button - Top Right */}
      <div style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 10000,
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        pointerEvents: 'auto'
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
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                userButtonBox: 'border-0',
                userButtonTrigger: 'focus:shadow-none',
                userButtonAvatarBox: 'border-0',
                avatarBox: 'border-0',
                userButtonPopoverCard: 'bg-black border border-white rounded-none shadow-none',
                userButtonPopoverActions: 'border-t border-white',
                userButtonPopoverActionButton: 'text-white hover:bg-white hover:text-black font-mono transition-colors',
                userButtonPopoverActionButtonIcon: 'text-white',
                userButtonPopoverActionButtonText: 'font-mono uppercase tracking-wider text-xs',
                userButtonPopoverFooter: 'hidden',
                userPreview: 'bg-black text-white',
                userPreviewMainIdentifier: 'text-white font-mono',
                userPreviewSecondaryIdentifier: 'text-gray-400 font-mono text-xs',
              }
            }}
          />
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
        <Route path="/tactical" element={<TacticalShowcase />} />
        <Route path="/tools/adaptive-sampling" element={<AdaptiveSamplingPage />} />
        <Route path="/tools/coverage-prediction" element={<CoveragePredictionPage />} />
        <Route path="/orgs/:orgId/projects/:projectId/settings" element={<ProjectSettingsPage />} />
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

      {/* Toast Notifications */}
      <TacticalToaster />
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
