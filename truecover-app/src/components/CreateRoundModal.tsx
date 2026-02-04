// ABOUTME: Modal for creating a sampling round with optional per-area auto-sampling
// ABOUTME: Creates a round record and optionally starts CampaignAreaSamplingWorkflow per selected area

import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalInput, TacticalButton, TacticalTextarea, TacticalSelect, TacticalDatePicker, tacticalToast } from '../tactical-ui';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import { useIndicators } from '../hooks/useIndicators';
import { CampaignArea } from '../hooks/useCampaignAreas';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

interface CreateRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  projectId: string;
  onRoundCreated: () => void;
  campaignAreas?: CampaignArea[];
  onSamplingStarted?: (areaWorkflowMap: Record<string, string>) => void;
}

const CreateRoundModal: React.FC<CreateRoundModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  projectId,
  onRoundCreated,
  campaignAreas = [],
  onSamplingStarted,
}) => {
  const { getToken } = useAuth();
  const { data: indicators } = useIndicators(projectId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedIndicatorId, setSelectedIndicatorId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-area selection: area_id -> sample count
  const [selectedAreas, setSelectedAreas] = useState<Map<string, number>>(new Map());

  // Auto-select first indicator when indicators load
  useEffect(() => {
    if (indicators && indicators.length > 0 && !selectedIndicatorId) {
      setSelectedIndicatorId(indicators[0].id);
    }
  }, [indicators]);

  const toggleArea = (areaId: string) => {
    setSelectedAreas(prev => {
      const next = new Map(prev);
      if (next.has(areaId)) {
        next.delete(areaId);
      } else {
        next.set(areaId, 50);
      }
      return next;
    });
  };

  const updateSampleCount = (areaId: string, count: number) => {
    setSelectedAreas(prev => {
      const next = new Map(prev);
      next.set(areaId, count);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Round name is required');
      return;
    }

    if (!selectedIndicatorId) {
      setError('Please select an indicator');
      return;
    }

    setIsSubmitting(true);

    try {
      const token = await getToken();

      // Build sample_areas array from checked areas
      const sampleAreas = Array.from(selectedAreas.entries()).map(([areaId, sampleCount]) => ({
        area_id: areaId,
        sample_count: sampleCount,
        sample_target: 'pixels',
      }));

      const response = await axios.post(
        `${API_URL}/api/campaigns/${campaignId}/rounds`,
        {
          name: name.trim(),
          description: description.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          indicator_id: selectedIndicatorId,
          ...(sampleAreas.length > 0 ? { sample_areas: sampleAreas } : {}),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.status === 201) {
        const workflowIds = response.data.workflow_ids || {};
        const roundName = name.trim();

        // Reset form
        setName('');
        setDescription('');
        setStartDate('');
        setEndDate('');
        setSelectedIndicatorId(indicators && indicators.length > 0 ? indicators[0].id : '');
        setSelectedAreas(new Map());

        onClose();
        onRoundCreated();

        if (Object.keys(workflowIds).length > 0) {
          tacticalToast.info(
            'Sampling Started',
            `Created round "${roundName}" and started sampling for ${Object.keys(workflowIds).length} area(s)`
          );
          if (onSamplingStarted) {
            onSamplingStarted(workflowIds);
          }
        } else {
          tacticalToast.success(
            'Round Created',
            `Created round "${roundName}"`
          );
        }
      }
    } catch (err: any) {
      console.error('Error creating round:', err);
      setError(
        err.response?.data?.error ||
        err.response?.data?.details ||
        'Failed to create round'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      onClose();
    }
  };

  const areaDisplayName = (area: CampaignArea) => {
    const parts = [
      area.name || area.admin_boundary_name || 'Unnamed Area',
    ];
    const hierarchy = [area.division_name, area.district_name, area.upazila_name, area.union_name]
      .filter(Boolean);
    if (hierarchy.length > 0) {
      parts.push(`(${hierarchy.join(' > ')})`);
    }
    return parts.join(' ');
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Round"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[calc(100vh-120px)]">
        <div className="space-y-4 overflow-y-auto pr-2 flex-1">
        <TacticalInput
          label="Round Name"
          value={name}
          onChange={setName}
          placeholder="e.g., Round 1, Baseline Survey"
          disabled={isSubmitting}
        />

        <TacticalTextarea
          label="Description (Optional)"
          value={description}
          onChange={setDescription}
          placeholder="Describe the purpose of this data collection round..."
          rows={2}
          disabled={isSubmitting}
        />

        <TacticalSelect
          label="Indicator"
          value={selectedIndicatorId}
          onChange={setSelectedIndicatorId}
          options={
            (indicators || []).map(ind => ({
              value: ind.id,
              label: ind.name
            }))
          }
          placeholder="Select Indicator"
          disabled={isSubmitting}
        />

        <div className="grid grid-cols-2 gap-4">
          <TacticalDatePicker
            label="Start Date (Optional)"
            value={startDate}
            onChange={setStartDate}
            disabled={isSubmitting}
          />

          <TacticalDatePicker
            label="End Date (Optional)"
            value={endDate}
            onChange={setEndDate}
            disabled={isSubmitting}
          />
        </div>

        {/* Campaign Areas Selection */}
        {campaignAreas.length > 0 && (
          <div className="border-t border-tactical-border-medium pt-4 mt-4">
            <h3 className="text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
              Auto-Sample Areas
            </h3>
            <p className="text-xs font-mono text-tactical-text-dim mb-3">
              Select areas to automatically sample when this round is created. Leave unchecked to sample manually later.
            </p>

            <div className="border border-tactical-border-medium">
              <table className="w-full">
                <thead className="bg-tactical-bg-secondary border-b border-tactical-border-medium">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider w-8"></th>
                    <th className="px-3 py-2 text-left text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">Area</th>
                    <th className="px-3 py-2 text-right text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">Pixels</th>
                    <th className="px-3 py-2 text-right text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider">Population</th>
                    <th className="px-3 py-2 text-right text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider w-28">Sample Count</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignAreas.map((area) => {
                    const isSelected = selectedAreas.has(area.id);
                    return (
                      <tr
                        key={area.id}
                        className={`border-b border-tactical-border-dark transition-colors ${
                          isSelected ? 'bg-tactical-accent-orange/5' : 'hover:bg-tactical-bg-secondary'
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleArea(area.id)}
                            disabled={isSubmitting}
                            className="w-4 h-4 bg-tactical-bg-tertiary border border-tactical-border-medium text-tactical-accent-orange focus:ring-tactical-accent-orange focus:ring-2"
                          />
                        </td>
                        <td
                          className="px-3 py-2 text-sm font-mono text-tactical-text-primary cursor-pointer"
                          onClick={() => toggleArea(area.id)}
                        >
                          {areaDisplayName(area)}
                        </td>
                        <td className="px-3 py-2 text-sm font-mono text-tactical-text-dim text-right">
                          {area.pixel_count.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-sm font-mono text-tactical-text-dim text-right">
                          {area.total_population.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isSelected ? (
                            <input
                              type="number"
                              min={1}
                              value={selectedAreas.get(area.id) || 50}
                              onChange={(e) => updateSampleCount(area.id, parseInt(e.target.value) || 1)}
                              disabled={isSubmitting}
                              className="w-24 px-2 py-1 text-sm font-mono text-right bg-tactical-bg-tertiary border border-tactical-border-medium text-tactical-text-primary focus:border-tactical-accent-orange focus:outline-none"
                            />
                          ) : (
                            <span className="text-sm font-mono text-tactical-text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>

        {error && (
          <div className="p-3 border border-tactical-accent-red bg-tactical-accent-red/10 mt-4">
            <p className="text-sm text-tactical-accent-red">{error}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-4 border-t border-tactical-border-medium mt-4">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="submit"
            variant="primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="tactical-loading-dots">
                CREATING<span>.</span><span>.</span><span>.</span>
              </span>
            ) : selectedAreas.size > 0 ? (
              `Create Round & Sample ${selectedAreas.size} Area${selectedAreas.size > 1 ? 's' : ''}`
            ) : (
              'Create Round'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default CreateRoundModal;
