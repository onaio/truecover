import React, { useState, useEffect } from 'react';
import { TacticalCard, TacticalButton, TacticalCollapsible } from '../tactical-ui';
import PredictCoverageModal from './PredictCoverageModal';
import GenerateMockVisitDataModal from './GenerateMockVisitDataModal';
import AddVisitModal from './AddVisitModal';
import ExportDataModal from './ExportDataModal';
import { useCoverage, CoverageRecord, CoveragePixelRecord } from '../hooks/useCoverage';

interface PredictedCoverageSectionProps {
  areaId: string;
  areaName: string;
  projectId: string;
  selectedIndicatorId: string;
  selectedRoundId: string;
  indicators: Array<{ id: string; name: string }>;
}

const PredictedCoverageSection: React.FC<PredictedCoverageSectionProps> = ({
  areaId,
  areaName,
  projectId,
  selectedIndicatorId,
  selectedRoundId,
  indicators,
}) => {
  const [isPredictCoverageModalOpen, setIsPredictCoverageModalOpen] = useState(false);
  const [isGenerateMockDataModalOpen, setIsGenerateMockDataModalOpen] = useState(false);
  const [isAddVisitModalOpen, setIsAddVisitModalOpen] = useState(false);
  const [isExportDataModalOpen, setIsExportDataModalOpen] = useState(false);
  const [coverageData, setCoverageData] = useState<CoverageRecord[]>([]);
  const [coveragePixelData, setCoveragePixelData] = useState<CoveragePixelRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'locations' | 'pixels'>('locations');

  const { listCoverage, listCoveragePixel } = useCoverage();

  // Load coverage data
  const loadCoverageData = async () => {
    if (!areaId || !selectedIndicatorId) return;

    setIsLoading(true);
    try {
      const [locationData, pixelData] = await Promise.all([
        listCoverage({
          area_id: areaId,
          indicator_id: selectedIndicatorId,
          round_id: selectedRoundId || undefined,
        }),
        listCoveragePixel({
          area_id: areaId,
          indicator_id: selectedIndicatorId,
          round_id: selectedRoundId || undefined,
        })
      ]);
      setCoverageData(locationData);
      setCoveragePixelData(pixelData);
    } catch (error) {
      console.error('Error loading coverage data:', error);
      setCoverageData([]);
      setCoveragePixelData([]);
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
          collapsedSummary={`(${coverageData.length} Locations, ${coveragePixelData.length} Pixels)`}
          actionButton={
            <div className="flex gap-2">
              <TacticalButton
                variant="secondary"
                size="sm"
                onClick={() => setIsExportDataModalOpen(true)}
              >
                Export Data
              </TacticalButton>
              <TacticalButton
                variant="secondary"
                size="sm"
                onClick={() => setIsGenerateMockDataModalOpen(true)}
              >
                Generate Mock Data
              </TacticalButton>
              <TacticalButton
                variant="secondary"
                size="sm"
                onClick={() => setIsAddVisitModalOpen(true)}
              >
                Add Visit Data
              </TacticalButton>
              <TacticalButton
                variant="primary"
                size="sm"
                onClick={() => setIsPredictCoverageModalOpen(true)}
              >
                Predict Coverage
              </TacticalButton>
            </div>
          }
        >
          {/* Tab Switcher */}
          <div className="flex gap-2 mb-4 border-b border-tactical-border-medium">
            <button
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'locations'
                  ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                  : 'text-tactical-text-dim hover:text-tactical-text-secondary'
              }`}
              onClick={() => setActiveTab('locations')}
            >
              Locations ({coverageData.length})
            </button>
            <button
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'pixels'
                  ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                  : 'text-tactical-text-dim hover:text-tactical-text-secondary'
              }`}
              onClick={() => setActiveTab('pixels')}
            >
              Pixels ({coveragePixelData.length})
            </button>
          </div>

          {/* Coverage Table */}
          {isLoading ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim">Loading coverage data...</p>
            </div>
          ) : activeTab === 'locations' && coverageData.length === 0 ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim mb-2">No location coverage predictions yet</p>
              <p className="text-xs text-tactical-text-muted">
                Generate coverage predictions using visit data and indicator information
              </p>
            </div>
          ) : activeTab === 'pixels' && coveragePixelData.length === 0 ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim mb-2">No pixel coverage predictions yet</p>
              <p className="text-xs text-tactical-text-muted">
                Generate coverage predictions using visit data and indicator information
              </p>
            </div>
          ) : activeTab === 'locations' ? (
            <div className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary">
              <table className="tactical-table text-tactical-text-secondary">
                <thead>
                  <tr className="sticky top-0 z-10">
                    <th className="bg-tactical-bg-secondary">Coverage ID</th>
                    <th className="bg-tactical-bg-secondary">Quadkey</th>
                    <th className="bg-tactical-bg-secondary">Rounds</th>
                    <th className="bg-tactical-bg-secondary">Latitude</th>
                    <th className="bg-tactical-bg-secondary">Longitude</th>
                    <th className="bg-tactical-bg-secondary">N Trials</th>
                    <th className="bg-tactical-bg-secondary">N Covered</th>
                    <th className="bg-tactical-bg-secondary">Prevalence Pred</th>
                    <th className="bg-tactical-bg-secondary">Prevalence BCI</th>
                    <th className="bg-tactical-bg-secondary">Exceedance Prob</th>
                    <th className="bg-tactical-bg-secondary">Exceedance Unc</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageData.map((record) => {
                    const hasRounds = record.rounds && record.rounds.length > 0;
                    const rowTextColor = hasRounds ? 'text-tactical-accent-green' : '';
                    return (
                      <tr
                        key={record.id}
                        className={hasRounds ? 'group hover:bg-tactical-bg-tertiary transition-colors' : ''}
                      >
                        <td title={record.id} className={rowTextColor}>
                          {record.id.substring(0, 8)}...
                        </td>
                        <td className={rowTextColor}>
                          {record.quadkey || '-'}
                        </td>
                        <td className={`font-bold ${rowTextColor}`}>
                          {hasRounds
                            ? record.rounds.sort((a, b) => a - b).join(', ')
                            : '-'}
                        </td>
                      <td className={rowTextColor}>
                        {record.latitude !== null
                          ? record.latitude.toFixed(3)
                          : '-'}
                      </td>
                      <td className={rowTextColor}>
                        {record.longitude !== null
                          ? record.longitude.toFixed(3)
                          : '-'}
                      </td>
                      <td className={rowTextColor}>{record.n_trials}</td>
                      <td className={rowTextColor}>{record.n_covered}</td>
                      <td className={rowTextColor}>
                        {record.prevalence_prediction !== null
                          ? record.prevalence_prediction.toFixed(3)
                          : '-'}
                      </td>
                      <td className={rowTextColor}>
                        {record.prevalence_bci_width !== null
                          ? record.prevalence_bci_width.toFixed(3)
                          : '-'}
                      </td>
                      <td className={rowTextColor}>
                        {record.exceedance_probability !== null
                          ? record.exceedance_probability.toFixed(3)
                          : '-'}
                      </td>
                      <td className={rowTextColor}>
                        {record.exceedance_uncertainty !== null
                          ? record.exceedance_uncertainty.toFixed(3)
                          : '-'}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary">
              <table className="tactical-table text-tactical-text-secondary">
                <thead>
                  <tr className="sticky top-0 z-10">
                    <th className="bg-tactical-bg-secondary">Coverage ID</th>
                    <th className="bg-tactical-bg-secondary">Quadkey</th>
                    <th className="bg-tactical-bg-secondary">Rounds</th>
                    <th className="bg-tactical-bg-secondary">N Trials</th>
                    <th className="bg-tactical-bg-secondary">N Covered</th>
                    <th className="bg-tactical-bg-secondary">Prevalence Pred</th>
                    <th className="bg-tactical-bg-secondary">Prevalence BCI</th>
                    <th className="bg-tactical-bg-secondary">Exceedance Prob</th>
                    <th className="bg-tactical-bg-secondary">Exceedance Unc</th>
                  </tr>
                </thead>
                <tbody>
                  {coveragePixelData.map((record) => {
                    const hasRounds = record.rounds && record.rounds.length > 0;
                    const rowTextColor = hasRounds ? 'text-tactical-accent-green' : '';
                    return (
                      <tr
                        key={record.id}
                        className={hasRounds ? 'group hover:bg-tactical-bg-tertiary transition-colors' : ''}
                      >
                        <td title={record.id} className={rowTextColor}>
                          {record.id.substring(0, 8)}...
                        </td>
                        <td className={rowTextColor}>
                          {record.quadkey}
                        </td>
                        <td className={`font-bold ${rowTextColor}`}>
                          {hasRounds
                            ? record.rounds.sort((a, b) => a - b).join(', ')
                            : '-'}
                        </td>
                        <td className={rowTextColor}>{record.n_trials}</td>
                        <td className={rowTextColor}>{record.n_covered}</td>
                        <td className={rowTextColor}>
                          {record.prevalence_prediction !== null
                            ? record.prevalence_prediction.toFixed(3)
                            : '-'}
                        </td>
                        <td className={rowTextColor}>
                          {record.prevalence_bci_width !== null
                            ? record.prevalence_bci_width.toFixed(3)
                            : '-'}
                        </td>
                        <td className={rowTextColor}>
                          {record.exceedance_probability !== null
                            ? record.exceedance_probability.toFixed(3)
                            : '-'}
                        </td>
                        <td className={rowTextColor}>
                          {record.exceedance_uncertainty !== null
                            ? record.exceedance_uncertainty.toFixed(3)
                            : '-'}
                        </td>
                      </tr>
                    );
                  })}
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

      <GenerateMockVisitDataModal
        isOpen={isGenerateMockDataModalOpen}
        onClose={() => setIsGenerateMockDataModalOpen(false)}
      />

      <AddVisitModal
        isOpen={isAddVisitModalOpen}
        onClose={() => setIsAddVisitModalOpen(false)}
        areaId={areaId}
        areaName={areaName}
        roundId={selectedRoundId}
        projectId={projectId}
        onSuccess={loadCoverageData}
      />

      <ExportDataModal
        isOpen={isExportDataModalOpen}
        onClose={() => setIsExportDataModalOpen(false)}
        areaId={areaId}
        projectId={projectId}
        indicators={indicators}
      />
    </>
  );
};

export default PredictedCoverageSection;
