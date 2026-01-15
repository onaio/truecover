import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalInput, TacticalButton, TacticalTextarea, TacticalSelect, TacticalDatePicker, tacticalToast } from '../tactical-ui';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import { useIndicators } from '../hooks/useIndicators';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface CreateRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  projectId: string;
  onRoundCreated: () => void;
  adminBoundaryPcode?: string;
  adminBoundaryName?: string;
}

const CreateRoundModal: React.FC<CreateRoundModalProps> = ({
  isOpen,
  onClose,
  areaId,
  projectId,
  onRoundCreated,
  adminBoundaryPcode,
  adminBoundaryName,
}) => {
  const { getToken } = useAuth();
  const { data: indicators } = useIndicators(projectId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedIndicatorId, setSelectedIndicatorId] = useState('');
  const [batchSize, setBatchSize] = useState('10');
  const [uncertaintyField, setUncertaintyField] = useState('prevalence_bci_width');
  const [allowRevisit, setAllowRevisit] = useState(false);
  const [samplingTarget, setSamplingTarget] = useState<'locations' | 'pixels'>('locations');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select first indicator when indicators load
  useEffect(() => {
    if (indicators && indicators.length > 0 && !selectedIndicatorId) {
      setSelectedIndicatorId(indicators[0].id);
    }
  }, [indicators]);

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

    const batchSizeNum = parseInt(batchSize);
    if (isNaN(batchSizeNum) || batchSizeNum < 1) {
      setError('Batch size must be a number greater than 0');
      return;
    }

    setIsSubmitting(true);

    try {
      const token = await getToken();

      const response = await axios.post(
        `${API_URL}/api/areas/${areaId}/rounds`,
        {
          name: name.trim(),
          description: description.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          indicator_id: selectedIndicatorId,
          batch_size: batchSizeNum,
          uncertainty_field: uncertaintyField,
          allow_revisit: allowRevisit,
          sampling_target: samplingTarget,
          admin_pcode: adminBoundaryPcode || null,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // Temporal workflow started - close modal immediately
      if (response.status === 202 && response.data.workflow_id) {
        const workflowId = response.data.workflow_id;
        const roundName = name.trim();

        // Reset form
        setName('');
        setDescription('');
        setStartDate('');
        setEndDate('');
        setSelectedIndicatorId(indicators && indicators.length > 0 ? indicators[0].id : '');
        setBatchSize('10');
        setUncertaintyField('prevalence_bci_width');
        setAllowRevisit(false);
        setSamplingTarget('locations');

        // Close modal immediately
        onClose();

        // Show info toast that round generation started
        tacticalToast.info(
          'Round Generation Started',
          `Generating round "${roundName}"...`
        );

        // Poll for completion
        const pollInterval = setInterval(async () => {
          try {
            const statusResponse = await axios.get(
              `${API_URL}/api/rounds/workflow/${workflowId}/status`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            if (statusResponse.data.status === 'completed' && statusResponse.data.result) {
              clearInterval(pollInterval);
              const selectedCount = statusResponse.data.result.selected_count || 0;
              tacticalToast.success(
                'Round Generated',
                `Created round "${roundName}" with ${selectedCount.toLocaleString()} ${samplingTarget} selected`
              );
              // Trigger parent refresh
              onRoundCreated();
            } else if (statusResponse.data.status === 'failed') {
              clearInterval(pollInterval);
              tacticalToast.error(
                'Round Generation Failed',
                statusResponse.data.error || 'Round generation failed'
              );
            }
          } catch (err) {
            console.error('Failed to check workflow status:', err);
          }
        }, 2000);

        // Clean up interval after 10 minutes (failsafe)
        setTimeout(() => clearInterval(pollInterval), 600000);
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

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Round"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[calc(100vh-120px)]">
        <div className="space-y-4 overflow-y-auto pr-2 flex-1">
          {/* Admin Boundary Filter Indicator */}
          {adminBoundaryPcode && adminBoundaryName && (
          <div className="p-3 border border-tactical-accent-blue bg-tactical-accent-blue/10">
            <p className="text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-1">
              Filtering to Admin Boundary
            </p>
            <p className="text-sm font-mono text-tactical-text-secondary">
              {adminBoundaryName} ({adminBoundaryPcode})
            </p>
            <p className="text-xs font-mono text-tactical-text-muted mt-1">
              This round will only include {samplingTarget === 'locations' ? 'locations' : 'pixels'} within this administrative boundary.
            </p>
          </div>
        )}

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
          rows={3}
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

        <TacticalSelect
          label="Sampling Target"
          value={samplingTarget}
          onChange={(value) => setSamplingTarget(value as 'locations' | 'pixels')}
          options={[
            { value: 'locations', label: 'Locations' },
            { value: 'pixels', label: 'Pixels' },
          ]}
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

        <div className="border-t border-tactical-border-medium pt-4 mt-4">
          <h3 className="text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-4">
            Adaptive Sampling Parameters
          </h3>

          <div className="space-y-4">
            <TacticalSelect
              label="Uncertainty Field"
              value={uncertaintyField}
              onChange={setUncertaintyField}
              options={[
                { value: 'prevalence_bci_width', label: 'Prevalence BCI Width' },
              ]}
              disabled={isSubmitting}
            />

            <TacticalInput
              label={`Batch Size (Number of ${samplingTarget === 'locations' ? 'Locations' : 'Pixels'} to Select)`}
              type="number"
              value={batchSize}
              onChange={setBatchSize}
              placeholder="10"
              disabled={isSubmitting}
            />

            <div className="flex items-center gap-3 mt-4">
              <input
                type="checkbox"
                id="allowRevisit"
                checked={allowRevisit}
                onChange={(e) => setAllowRevisit(e.target.checked)}
                disabled={isSubmitting}
                className="w-4 h-4 bg-tactical-bg-tertiary border border-tactical-border-medium text-tactical-accent-orange focus:ring-tactical-accent-orange focus:ring-2"
              />
              <label
                htmlFor="allowRevisit"
                className="text-sm font-mono text-tactical-text-primary cursor-pointer select-none"
              >
                Allow revisit to same {samplingTarget === 'locations' ? 'location' : 'pixel'}
              </label>
            </div>
          </div>
        </div>
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
