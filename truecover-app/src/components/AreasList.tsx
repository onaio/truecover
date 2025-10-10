import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Area, Project } from '../types';
import { areasApi } from '../services/api';
import CreateAreaModal from './CreateAreaModal';
import {
  TacticalCard,
  TacticalButton,
  TacticalBadge
} from '../tactical-ui';

interface AreasListProps {
  project: Project | null;
  onAreaSelect?: (area: Area) => void;
}

const AreasList: React.FC<AreasListProps> = ({ project, onAreaSelect }) => {
  const { getToken } = useAuth();
  const [areas, setAreas] = useState<Area[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<Area | null>(null);

  useEffect(() => {
    if (project) {
      loadAreas();
    } else {
      setAreas([]);
    }
  }, [project]);

  const loadAreas = async () => {
    if (!project) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      const areasList = await areasApi.list(project.id, token);
      setAreas(areasList);
    } catch (err: any) {
      console.error('Failed to load areas:', err);
      setError(err.response?.data?.error || 'Failed to load areas');
    } finally {
      setIsLoading(false);
    }
  };

  if (!project) {
    return (
      <TacticalCard variant="secondary" padding="lg">
        <div className="text-center text-tactical-text-muted">
          <p className="font-mono text-sm uppercase tracking-wider">
            Select a project to view areas
          </p>
        </div>
      </TacticalCard>
    );
  }

  const handleAreaCreated = (newArea: Area) => {
    setAreas([newArea, ...areas]);
  };

  const handleAreaUpdated = (updatedArea: Area) => {
    setAreas(areas.map(area => area.id === updatedArea.id ? updatedArea : area));
    setEditingArea(null);
  };

  const handleEditClick = (area: Area) => {
    setEditingArea(area);
    setIsCreateModalOpen(true);
  };

  const handleModalClose = () => {
    setIsCreateModalOpen(false);
    setEditingArea(null);
  };

  return (
    <>
    <TacticalCard title="Areas" padding="lg">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-tactical-text-muted">
          {areas.length} area{areas.length !== 1 ? 's' : ''}
        </p>
        <TacticalButton
          variant="primary"
          size="sm"
          onClick={() => setIsCreateModalOpen(true)}
        >
          + New Area
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
            LOADING AREAS<span>.</span><span>.</span><span>.</span>
          </span>
        </div>
      ) : areas.length === 0 ? (
        <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
          <p className="text-sm text-tactical-text-dim mb-3">
            No areas yet
          </p>
          <TacticalButton
            variant="secondary"
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
          >
            Create Your First Area
          </TacticalButton>
        </div>
      ) : (
        <div className="space-y-3">
          {areas.map((area) => (
            <div
              key={area.id}
              className="group border border-tactical-border-medium bg-tactical-bg-secondary p-4 hover:border-tactical-accent-orange transition-colors cursor-pointer"
              onClick={() => onAreaSelect?.(area)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h4 className="font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-1">
                    {area.name}
                  </h4>
                  {area.description && (
                    <p className="text-sm text-tactical-text-muted mb-2">
                      {area.description}
                    </p>
                  )}
                  <p className="text-xs text-tactical-text-dim">
                    Created {new Date(area.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <TacticalButton
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditClick(area);
                    }}
                  >
                    Edit
                  </TacticalButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </TacticalCard>

    {/* Create/Edit Area Modal */}
    <CreateAreaModal
      isOpen={isCreateModalOpen}
      onClose={handleModalClose}
      project={project}
      onAreaCreated={handleAreaCreated}
      editArea={editingArea}
      onAreaUpdated={handleAreaUpdated}
    />
    </>
  );
};

export default AreasList;
