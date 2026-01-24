import React, { useState, useRef } from 'react';
import { TacticalCard, TacticalButton, TacticalCollapsible, TacticalMultiSelect } from '../tactical-ui';
import PredictCoverageModal from './PredictCoverageModal';
import GenerateMockVisitDataModal from './GenerateMockVisitDataModal';
import AddVisitModal from './AddVisitModal';
import ExportDataModal from './ExportDataModal';
import { CoverageRecord, CoveragePixelRecord } from '../hooks/useCoverage';

interface Round {
  id: string;
  round_number: number;
  name?: string;
}

interface PredictedCoverageSectionProps {
  campaignId: string;
  areaName: string;
  projectId: string;
  selectedIndicatorId: string;
  selectedRoundIds: (string | number)[];
  indicators: Array<{ id: string; name: string }>;
  coverageData: CoverageRecord[];
  coveragePixelData: CoveragePixelRecord[];
  isLoadingCoverage: boolean;
  onRefetchCoverage: () => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  locationTotalCount: number;
  pixelTotalCount: number;
  rounds?: Round[];
  onRoundsChange?: (roundIds: (string | number)[]) => void;
  onRoundClick?: (roundNumber: number) => void;
}

const PredictedCoverageSection: React.FC<PredictedCoverageSectionProps> = ({
  campaignId,
  areaName,
  projectId,
  selectedRoundIds,
  indicators,
  coverageData,
  coveragePixelData,
  isLoadingCoverage,
  onRefetchCoverage,
  onLoadMore,
  hasMore,
  isLoadingMore,
  locationTotalCount,
  pixelTotalCount,
  rounds,
  onRoundsChange,
  onRoundClick,
}) => {
  const [isPredictCoverageModalOpen, setIsPredictCoverageModalOpen] = useState(false);
  const [isGenerateMockDataModalOpen, setIsGenerateMockDataModalOpen] = useState(false);
  const [isAddVisitModalOpen, setIsAddVisitModalOpen] = useState(false);
  const [isExportDataModalOpen, setIsExportDataModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'locations' | 'pixels'>('pixels');

  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Reload data when modal closes
  const handleModalClose = () => {
    setIsPredictCoverageModalOpen(false);
    onRefetchCoverage();
  };

  // Handle scroll to bottom for infinite loading
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrolledToBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 100;

    if (scrolledToBottom && hasMore && !isLoadingMore) {
      onLoadMore();
    }
  };

  return (
    <>
      <TacticalCard padding="lg" className="mb-6">
        <TacticalCollapsible
          title="Predicted Coverage"
          defaultCollapsed={false}
          collapsedSummary={`(${locationTotalCount} Locations, ${pixelTotalCount} Pixels)`}
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
          {/* Tab Switcher and Filters */}
          <div className="flex justify-between items-center mb-4 border-b border-tactical-border-medium">
            <div className="flex gap-2">
              <button
                className={`px-4 py-2 font-medium transition-colors ${
                  activeTab === 'pixels'
                    ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                    : 'text-tactical-text-dim hover:text-tactical-text-secondary'
                }`}
                onClick={() => setActiveTab('pixels')}
              >
                Pixels ({pixelTotalCount})
              </button>
              <button
                className={`px-4 py-2 font-medium transition-colors ${
                  activeTab === 'locations'
                    ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                    : 'text-tactical-text-dim hover:text-tactical-text-secondary'
                }`}
                onClick={() => setActiveTab('locations')}
              >
                Locations ({locationTotalCount})
              </button>
            </div>
            {/* Round Filter */}
            {rounds && rounds.length > 0 && onRoundsChange && (
              <div className="w-64 text-sm mb-1">
                <TacticalMultiSelect
                  value={selectedRoundIds}
                  onChange={onRoundsChange}
                  options={[
                    { value: 'all', label: 'All Rounds' },
                    ...rounds
                      .sort((a, b) => a.round_number - b.round_number)
                      .map((round) => ({
                        value: round.id,
                        label: `Round ${round.round_number}`
                      }))
                  ]}
                  placeholder="Select Rounds"
                  autoApply
                />
              </div>
            )}
          </div>

          {/* Coverage Table */}
          {isLoadingCoverage ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim">Loading coverage data...</p>
            </div>
          ) : activeTab === 'locations' && coverageData.length === 0 ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim mb-2">
                No location coverage predictions yet
              </p>
              <p className="text-xs text-tactical-text-muted">
                Generate coverage predictions using visit data and indicator information
              </p>
            </div>
          ) : activeTab === 'pixels' && coveragePixelData.length === 0 ? (
            <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
              <p className="text-tactical-text-dim mb-2">
                No pixel coverage predictions yet
              </p>
              <p className="text-xs text-tactical-text-muted">
                Generate coverage predictions using visit data and indicator information
              </p>
            </div>
          ) : activeTab === 'locations' ? (
            <div
              ref={tableContainerRef}
              className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary"
              onScroll={handleScroll}
            >
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
                            ? record.rounds.sort((a, b) => a - b).map((roundNum, idx) => (
                                <React.Fragment key={roundNum}>
                                  {idx > 0 && ', '}
                                  <button
                                    onClick={() => onRoundClick?.(roundNum)}
                                    className="hover:underline cursor-pointer hover:text-tactical-accent-blue transition-colors"
                                    title={`Filter by round ${roundNum}`}
                                  >
                                    {roundNum}
                                  </button>
                                </React.Fragment>
                              ))
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
              {isLoadingMore && (
                <div className="py-4 text-center text-tactical-text-dim">
                  Loading more locations...
                </div>
              )}
            </div>
          ) : (
            <div
              className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary"
              onScroll={handleScroll}
            >
              <table className="tactical-table text-tactical-text-secondary">
                <thead>
                  <tr className="sticky top-0 z-10">
                    <th className="bg-tactical-bg-secondary">Coverage ID</th>
                    <th className="bg-tactical-bg-secondary">Quadkey</th>
                    <th className="bg-tactical-bg-secondary">Locations</th>
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
                        <td className={rowTextColor}>
                          {record.location_count}
                        </td>
                        <td className={`font-bold ${rowTextColor}`}>
                          {hasRounds
                            ? record.rounds.sort((a, b) => a - b).map((roundNum, idx) => (
                                <React.Fragment key={roundNum}>
                                  {idx > 0 && ', '}
                                  <button
                                    onClick={() => onRoundClick?.(roundNum)}
                                    className="hover:underline cursor-pointer hover:text-tactical-accent-blue transition-colors"
                                    title={`Filter by round ${roundNum}`}
                                  >
                                    {roundNum}
                                  </button>
                                </React.Fragment>
                              ))
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
              {isLoadingMore && (
                <div className="py-4 text-center text-tactical-text-dim">
                  Loading more pixels...
                </div>
              )}
            </div>
          )}
        </TacticalCollapsible>
      </TacticalCard>

      <PredictCoverageModal
        isOpen={isPredictCoverageModalOpen}
        onClose={handleModalClose}
        campaignId={campaignId}
        projectId={projectId}
      />

      <GenerateMockVisitDataModal
        isOpen={isGenerateMockDataModalOpen}
        onClose={() => setIsGenerateMockDataModalOpen(false)}
      />

      <AddVisitModal
        isOpen={isAddVisitModalOpen}
        onClose={() => setIsAddVisitModalOpen(false)}
        campaignId={campaignId}
        areaName={areaName}
        roundId={selectedRoundIds.length > 0 && selectedRoundIds[0] !== 'all' ? String(selectedRoundIds[0]) : ''}
        projectId={projectId}
        onSuccess={onRefetchCoverage}
      />

      <ExportDataModal
        isOpen={isExportDataModalOpen}
        onClose={() => setIsExportDataModalOpen(false)}
        campaignId={campaignId}
        projectId={projectId}
        indicators={indicators}
      />
    </>
  );
};

export default PredictedCoverageSection;
