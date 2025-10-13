import React, { useState } from 'react';
import { TacticalCard, TacticalButton, TacticalCollapsible } from '../tactical-ui';
import PredictCoverageModal from './PredictCoverageModal';

interface PredictedCoverageSectionProps {
  areaId: string;
  projectId: string;
}

const PredictedCoverageSection: React.FC<PredictedCoverageSectionProps> = ({
  areaId,
  projectId,
}) => {
  const [isPredictCoverageModalOpen, setIsPredictCoverageModalOpen] = useState(false);

  return (
    <>
      <TacticalCard padding="lg" className="mb-6">
        <TacticalCollapsible
          title="Predicted Coverage"
          defaultCollapsed={true}
          actionButton={
            <TacticalButton
              variant="primary"
              size="sm"
              onClick={() => setIsPredictCoverageModalOpen(true)}
            >
              Predict Coverage
            </TacticalButton>
          }
        >
          <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
            <p className="text-tactical-text-dim mb-2">No coverage predictions yet</p>
            <p className="text-xs text-tactical-text-muted">
              Generate coverage predictions using visit data and indicator information
            </p>
          </div>
        </TacticalCollapsible>
      </TacticalCard>

      <PredictCoverageModal
        isOpen={isPredictCoverageModalOpen}
        onClose={() => setIsPredictCoverageModalOpen(false)}
        areaId={areaId}
        projectId={projectId}
      />
    </>
  );
};

export default PredictedCoverageSection;
