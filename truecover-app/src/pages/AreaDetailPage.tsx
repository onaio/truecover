import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppContext } from '../contexts/AppContext';
import { TacticalCard, TacticalButton, TacticalHeader } from '../tactical-ui';

const AreaDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedOrganization, selectedProject, selectedArea, setSelectedArea } = useAppContext();

  if (!selectedArea) return null;

  return (
    <div className="min-h-screen bg-tactical-bg-primary">
      <TacticalHeader
        title=""
        subtitle=""
        actions={
          <TacticalButton
            variant="secondary"
            size="sm"
            onClick={() => {
              navigate('/');
              setSelectedArea(null);
            }}
          >
            Back
          </TacticalButton>
        }
      />

      <div className="max-w-7xl mx-auto p-6">
        <div className="w-9/12 mx-auto">
          {/* Breadcrumbs */}
          <div className="mb-4">
            <p className="text-sm text-tactical-text-dim font-mono uppercase tracking-wider">
              <Link
                to="/"
                className="hover:text-tactical-accent-orange cursor-pointer transition-colors"
              >
                {selectedOrganization?.name || 'Organization'}
              </Link>
              {' / '}
              <Link
                to="/"
                className="hover:text-tactical-accent-orange cursor-pointer transition-colors"
              >
                {selectedProject?.title || 'Project'}
              </Link>
            </p>
          </div>

          {/* Area Name */}
          <h1 className="font-mono text-4xl font-bold text-tactical-text-primary uppercase tracking-wider mb-8">
            {selectedArea.name}
          </h1>

          {/* Area Description */}
          {selectedArea.description && (
            <TacticalCard padding="lg" className="mb-6">
              <p className="text-sm text-tactical-text-muted">{selectedArea.description}</p>
            </TacticalCard>
          )}

          {/* Tools Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <TacticalCard
              hoverable
              onClick={() => navigate(`/orgs/${selectedOrganization?.id}/projects/${selectedProject?.id}/areas/${selectedArea?.id}/locations`)}
              padding="none"
              className="overflow-hidden"
            >
              <div className="relative group">
                <div className="w-full h-64 bg-gradient-to-br from-tactical-accent-green/20 to-tactical-bg-secondary flex items-center justify-center">
                  <div className="text-tactical-accent-green text-6xl">📍</div>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-tactical-bg-primary via-tactical-bg-primary/50 to-transparent" />
              </div>
              <div className="p-6 text-center">
                <h2 className="text-lg font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
                  Locations
                </h2>
                <p className="text-sm text-tactical-text-muted leading-relaxed">
                  Manage and visualize location data for your survey area
                </p>
              </div>
            </TacticalCard>

            <TacticalCard
              hoverable
              onClick={() => navigate('/tools/adaptive-sampling')}
              padding="none"
              className="overflow-hidden"
            >
              <div className="relative group">
                <img
                  src="/assets/adaptive-sampling-demo.png"
                  alt="Adaptive Sampling Demo"
                  className="w-full h-64 object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-tactical-bg-primary via-tactical-bg-primary/50 to-transparent" />
              </div>
              <div className="p-6 text-center">
                <h2 className="text-lg font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
                  Adaptive Sampling
                </h2>
                <p className="text-sm text-tactical-text-muted leading-relaxed">
                  Optimize your survey sampling with intelligent adaptive algorithms
                </p>
              </div>
            </TacticalCard>

            <TacticalCard
              hoverable
              onClick={() => navigate('/tools/coverage-prediction')}
              padding="none"
              className="overflow-hidden"
            >
              <div className="relative group">
                <img
                  src="/assets/coverage-prediction-demo.png"
                  alt="Coverage Prediction Demo"
                  className="w-full h-64 object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-tactical-bg-primary via-tactical-bg-primary/50 to-transparent" />
              </div>
              <div className="p-6 text-center">
                <h2 className="text-lg font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
                  Coverage Prediction
                </h2>
                <p className="text-sm text-tactical-text-muted leading-relaxed">
                  Predict and analyze coverage patterns for your survey data
                </p>
              </div>
            </TacticalCard>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AreaDetailPage;
