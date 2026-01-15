import React, { useState } from 'react';
import { TacticalCard, TacticalButton, TacticalBadge, TacticalCollapsible } from '../tactical-ui';
import IndicatorModal from './IndicatorModal';
import { useIndicators } from '../hooks/useIndicators';

interface Indicator {
  id: string;
  project_id: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
}

interface IndicatorsManagerProps {
  projectId: string;
}

const IndicatorsManager: React.FC<IndicatorsManagerProps> = ({ projectId }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedIndicator, setSelectedIndicator] = useState<Indicator | null>(null);

  const { data: indicators = [], isLoading, error, refetch } = useIndicators(projectId);

  const handleCreateClick = () => {
    setSelectedIndicator(null);
    setIsModalOpen(true);
  };

  const handleEditClick = (indicator: Indicator) => {
    setSelectedIndicator(indicator);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedIndicator(null);
    refetch();
  };

  const handleSuccess = () => {
    refetch();
  };

  return (
    <>
      <TacticalCard padding="lg" className="mb-6">
        <TacticalCollapsible
          title="Indicators"
          defaultCollapsed={false}
          collapsedSummary={
            !isLoading
              ? `(${indicators.length} ${indicators.length === 1 ? 'Indicator' : 'Indicators'})`
              : undefined
          }
          actionButton={
            <TacticalButton
              variant="primary"
              size="sm"
              onClick={handleCreateClick}
            >
              + Create New Indicator
            </TacticalButton>
          }
        >
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-tactical-text-dim">Loading indicators...</p>
            </div>
          ) : error ? (
            <div className="p-3 border border-tactical-accent-red bg-tactical-accent-red/10">
              <p className="text-sm text-tactical-accent-red">
                Failed to load indicators
              </p>
            </div>
          ) : indicators.length === 0 ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim mb-2">No indicators created yet</p>
              <p className="text-xs text-tactical-text-muted">
                Create indicators to track measurements for this project
              </p>
            </div>
          ) : (
            <div className="border border-tactical-border-medium">
              <table className="w-full">
                <thead className="bg-tactical-bg-secondary border-b border-tactical-border-medium">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {indicators.map((indicator) => (
                    <tr
                      key={indicator.id}
                      className="border-b border-tactical-border-medium hover:bg-tactical-bg-secondary"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TacticalBadge variant="info">
                            {indicator.name}
                          </TacticalBadge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-tactical-text-dim font-mono">
                        {indicator.description || <span className="italic text-tactical-text-muted">No description</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <TacticalButton
                          variant="secondary"
                          size="sm"
                          onClick={() => handleEditClick(indicator)}
                        >
                          Edit
                        </TacticalButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TacticalCollapsible>
      </TacticalCard>

      <IndicatorModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        projectId={projectId}
        indicator={selectedIndicator}
        onSuccess={handleSuccess}
      />
    </>
  );
};

export default IndicatorsManager;
