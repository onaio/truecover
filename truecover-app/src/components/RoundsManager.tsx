import React, { useState, useEffect, useCallback } from 'react';
import { TacticalCard, TacticalButton, TacticalBadge, TacticalCollapsible } from '../tactical-ui';
import CreateRoundModal from './CreateRoundModal';
import ExportLocationsModal from './ExportLocationsModal';
import { StratifiedClusterSamplingWizard } from './StratifiedClusterSamplingWizard';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import { useIndicators } from '../hooks/useIndicators';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

interface Round {
  id: string;
  round_number: number;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  location_count: number;
  pixel_count: number;
  sampled_population: number;
}

interface RoundsManagerProps {
  campaignId: string;
  areaName: string;
  projectId: string;
  locations: any; // GeoJSON FeatureCollection
  onRoundSelected?: (roundNumber: number | null) => void;
  selectedAdminBoundary?: { pcode: string; name: string } | null;
  onClearAdminBoundary?: () => void;
  pixelCount?: number;
  indicatorId?: string;
  onSamplingWorkflowsStarted?: (areaWorkflowMap: Record<string, string>) => void;
}

const RoundsManager: React.FC<RoundsManagerProps> = ({ campaignId, areaName, projectId, locations, onRoundSelected, selectedAdminBoundary, onClearAdminBoundary, pixelCount = 0, indicatorId, onSamplingWorkflowsStarted }) => {
  const { getToken } = useAuth();
  const { data: indicators } = useIndicators(projectId);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [totalPopulation, setTotalPopulation] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isStratifiedWizardOpen, setIsStratifiedWizardOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Use provided indicatorId or fall back to first indicator
  const effectiveIndicatorId = indicatorId || indicators?.[0]?.id || '';


  const loadRounds = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      const response = await axios.get(
        `${API_URL}/api/campaigns/${campaignId}/rounds`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setRounds(response.data.rounds || []);
      setTotalPopulation(response.data.total_population || 0);
    } catch (err: any) {
      console.error('Error loading rounds:', err);
      // Don't set error if it's just an empty result or table doesn't exist
      // Only show error for actual server failures
      if (err.response?.status !== 404 && err.response?.status !== 500) {
        setError('Failed to load rounds');
      } else {
        // Treat as no rounds available
        setRounds([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [campaignId, getToken]);

  useEffect(() => {
    if (campaignId) {
      loadRounds();
    }
  }, [campaignId, loadRounds, refreshKey]);

  // Open modal when admin boundary is selected
  useEffect(() => {
    if (selectedAdminBoundary) {
      setIsCreateModalOpen(true);
    }
  }, [selectedAdminBoundary]);

  const handleRoundCreated = async () => {
    await loadRounds();
  };

  const handleRoundClick = (roundNumber: number) => {
    const newSelected = selectedRound === roundNumber ? null : roundNumber;
    setSelectedRound(newSelected);
    if (onRoundSelected) {
      onRoundSelected(newSelected);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Not set';
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return 'Invalid date';
    }
  };

  return (
    <>
      <TacticalCard padding="lg" className="mb-6">
        <TacticalCollapsible
          title="Rounds"
          defaultCollapsed={true}
          collapsedSummary={
            !isLoading
              ? `(${rounds.length} ${rounds.length === 1 ? 'Round' : 'Rounds'})`
              : undefined
          }
          actionButton={
            <div className="flex gap-2">
              <TacticalButton
                variant="secondary"
                size="sm"
                onClick={() => setIsExportModalOpen(true)}
                disabled={rounds.length === 0}
              >
                Export Locations to Visit
              </TacticalButton>
              <TacticalButton
                variant="secondary"
                size="sm"
                onClick={() => setIsStratifiedWizardOpen(true)}
              >
                Stratified Round
              </TacticalButton>
              <TacticalButton
                variant="primary"
                size="sm"
                onClick={() => setIsCreateModalOpen(true)}
                disabled={pixelCount === 0}
              >
                + Create New Round
              </TacticalButton>
            </div>
          }
        >
          {isLoading ? (
          <div className="text-center py-8">
            <p className="text-tactical-text-dim">Loading rounds...</p>
          </div>
        ) : error ? (
          <div className="p-3 border border-tactical-accent-red bg-tactical-accent-red/10">
            <p className="text-sm text-tactical-accent-red">{error}</p>
          </div>
        ) : rounds.length === 0 ? (
          <div className="text-center py-8 border border-tactical-border-medium bg-tactical-bg-secondary">
            <p className="text-tactical-text-dim mb-2">No rounds created yet</p>
            <p className="text-xs text-tactical-text-muted">
              Create a round to run adaptive sampling on your locations
            </p>
          </div>
        ) : (
          <div className="border border-tactical-border-medium">
            <table className="w-full">
              <thead className="bg-tactical-bg-secondary border-b border-tactical-border-medium">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                    Round
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                    Start Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                    End Date
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                    Locations
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                    Pixels
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                    Sampled Population
                  </th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round) => (
                  <tr
                    key={round.id}
                    className={`
                      transition-all border-b border-tactical-border-medium
                      ${
                        selectedRound === round.round_number
                          ? 'bg-tactical-accent-orange/10'
                          : 'hover:bg-tactical-bg-secondary'
                      }
                    `}
                  >
                    <td
                      className="px-4 py-3 cursor-pointer"
                      onClick={() => handleRoundClick(round.round_number)}
                    >
                      <TacticalBadge variant="success">
                        Round {round.round_number}
                      </TacticalBadge>
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-tactical-text-primary font-mono cursor-pointer"
                      onClick={() => handleRoundClick(round.round_number)}
                    >
                      {round.name}
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-tactical-text-dim font-mono cursor-pointer"
                      onClick={() => handleRoundClick(round.round_number)}
                    >
                      {formatDate(round.start_date)}
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-tactical-text-dim font-mono cursor-pointer"
                      onClick={() => handleRoundClick(round.round_number)}
                    >
                      {formatDate(round.end_date)}
                    </td>
                    <td
                      className="px-4 py-3 text-center text-sm text-tactical-text-primary font-mono cursor-pointer"
                      onClick={() => handleRoundClick(round.round_number)}
                    >
                      {round.location_count}
                    </td>
                    <td
                      className="px-4 py-3 text-center text-sm text-tactical-text-primary font-mono cursor-pointer"
                      onClick={() => handleRoundClick(round.round_number)}
                    >
                      {round.pixel_count}
                    </td>
                    <td
                      className="px-4 py-3 text-right text-sm font-mono cursor-pointer"
                      onClick={() => handleRoundClick(round.round_number)}
                    >
                      {totalPopulation === 0 ? (
                        <span className="text-tactical-text-muted">—</span>
                      ) : (
                        <span>
                          <span className="text-tactical-accent-green">
                            {round.sampled_population.toLocaleString()}
                          </span>
                          <span className="text-tactical-text-muted"> / </span>
                          <span className="text-tactical-text-primary">
                            {totalPopulation.toLocaleString()}
                          </span>
                          <span className="text-tactical-accent-green ml-1">
                            ({Math.round(round.sampled_population / totalPopulation * 100)}%)
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

          {selectedRound !== null && (
            <div className="mt-4 p-3 border border-tactical-accent-orange bg-tactical-accent-orange/10">
              <p className="text-sm text-tactical-text-secondary">
                Filtering locations for Round {selectedRound}. Click the card again to clear filter.
              </p>
            </div>
          )}
        </TacticalCollapsible>
      </TacticalCard>

      <CreateRoundModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setRefreshKey(prev => prev + 1);
          if (onClearAdminBoundary) {
            onClearAdminBoundary();
          }
        }}
        campaignId={campaignId}
        projectId={projectId}
        onRoundCreated={handleRoundCreated}
        adminBoundaryPcode={selectedAdminBoundary?.pcode}
        adminBoundaryName={selectedAdminBoundary?.name}
      />

      <ExportLocationsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        campaignId={campaignId}
        areaName={areaName}
        projectId={projectId}
        locations={locations}
      />

      <StratifiedClusterSamplingWizard
        isOpen={isStratifiedWizardOpen}
        onClose={() => {
          setIsStratifiedWizardOpen(false);
          setRefreshKey(prev => prev + 1);
          if (onClearAdminBoundary) {
            onClearAdminBoundary();
          }
        }}
        campaignId={campaignId}
        projectId={projectId}
        startingPcode={selectedAdminBoundary?.pcode || ''}
        startingName={selectedAdminBoundary?.name || ''}
        indicatorId={effectiveIndicatorId}
        onRoundCreated={handleRoundCreated}
        onSamplingWorkflowsStarted={onSamplingWorkflowsStarted}
      />
    </>
  );
};

export default RoundsManager;
