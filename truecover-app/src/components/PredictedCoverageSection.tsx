import React, { useState, useEffect } from 'react';
import { TacticalCard, TacticalButton, TacticalCollapsible } from '../tactical-ui';
import PredictCoverageModal from './PredictCoverageModal';
import { useCoverage, CoverageRecord } from '../hooks/useCoverage';

interface PredictedCoverageSectionProps {
  areaId: string;
  projectId: string;
  selectedIndicatorId: string;
  selectedRoundId: string;
}

const PredictedCoverageSection: React.FC<PredictedCoverageSectionProps> = ({
  areaId,
  projectId,
  selectedIndicatorId,
  selectedRoundId,
}) => {
  const [isPredictCoverageModalOpen, setIsPredictCoverageModalOpen] = useState(false);
  const [coverageData, setCoverageData] = useState<CoverageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { listCoverage } = useCoverage();

  // Load coverage data
  const loadCoverageData = async () => {
    if (!areaId || !selectedIndicatorId) return;

    setIsLoading(true);
    try {
      const data = await listCoverage({
        area_id: areaId,
        indicator_id: selectedIndicatorId,
        round_id: selectedRoundId || undefined,
      });
      setCoverageData(data);
    } catch (error) {
      console.error('Error loading coverage data:', error);
      setCoverageData([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Load coverage data when filters change
  useEffect(() => {
    if (selectedIndicatorId) {
      loadCoverageData();
    }
  }, [areaId, selectedIndicatorId, selectedRoundId]);

  // Reload data when modal closes
  const handleModalClose = () => {
    setIsPredictCoverageModalOpen(false);
    loadCoverageData();
  };

  return (
    <>
      <TacticalCard padding="lg" className="mb-6">
        <TacticalCollapsible
          title="Predicted Coverage"
          defaultCollapsed={false}
          collapsedSummary={`(${coverageData.length} ${coverageData.length === 1 ? 'Location' : 'Locations'})`}
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

          {/* Coverage Table */}
          {isLoading ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim">Loading coverage data...</p>
            </div>
          ) : coverageData.length === 0 ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim mb-2">No coverage predictions yet</p>
              <p className="text-xs text-tactical-text-muted">
                Generate coverage predictions using visit data and indicator information
              </p>
            </div>
          ) : (
            <div className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary">
              <table className="tactical-table text-tactical-text-secondary">
                <thead>
                  <tr className="sticky top-0 z-10">
                    <th className="bg-tactical-bg-secondary">Location ID</th>
                    <th className="bg-tactical-bg-secondary">Latitude</th>
                    <th className="bg-tactical-bg-secondary">Longitude</th>
                    <th className="bg-tactical-bg-secondary">N Trials</th>
                    <th className="bg-tactical-bg-secondary">N Covered</th>
                    <th className="bg-tactical-bg-secondary">Exceedance Prob</th>
                    <th className="bg-tactical-bg-secondary">Exceedance Unc</th>
                    <th className="bg-tactical-bg-secondary">Prevalence BCI</th>
                    <th className="bg-tactical-bg-secondary">Prevalence Pred</th>
                    <th className="bg-tactical-bg-secondary">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageData.map((record) => (
                    <tr key={record.id}>
                      <td title={record.location_id}>
                        {record.location_id.substring(0, 8)}...
                      </td>
                      <td>
                        {record.latitude !== null
                          ? record.latitude.toFixed(3)
                          : '-'}
                      </td>
                      <td>
                        {record.longitude !== null
                          ? record.longitude.toFixed(3)
                          : '-'}
                      </td>
                      <td>{record.n_trials}</td>
                      <td>{record.n_covered}</td>
                      <td>
                        {record.exceedance_probability !== null
                          ? record.exceedance_probability.toFixed(3)
                          : '-'}
                      </td>
                      <td>
                        {record.exceedance_uncertainty !== null
                          ? record.exceedance_uncertainty.toFixed(3)
                          : '-'}
                      </td>
                      <td>
                        {record.prevalence_bci_width !== null
                          ? record.prevalence_bci_width.toFixed(3)
                          : '-'}
                      </td>
                      <td>
                        {record.prevalence_prediction !== null
                          ? record.prevalence_prediction.toFixed(3)
                          : '-'}
                      </td>
                      <td>
                        {record.created_at
                          ? new Date(record.created_at).toLocaleString()
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TacticalCollapsible>
      </TacticalCard>

      <PredictCoverageModal
        isOpen={isPredictCoverageModalOpen}
        onClose={handleModalClose}
        areaId={areaId}
        projectId={projectId}
      />
    </>
  );
};

export default PredictedCoverageSection;
