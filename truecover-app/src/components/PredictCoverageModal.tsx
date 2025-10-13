import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalButton, TacticalInput, TacticalSelect } from '../tactical-ui';
import { useIndicators } from '../hooks/useIndicators';
import { useRounds } from '../hooks/useRounds';
import { useCoverage } from '../hooks/useCoverage';

interface PredictCoverageModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  projectId: string;
}

const PredictCoverageModal: React.FC<PredictCoverageModalProps> = ({
  isOpen,
  onClose,
  areaId,
  projectId,
}) => {
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: indicators, isLoading: loadingIndicators, error: indicatorsError } = useIndicators(projectId);
  const { predictCoverage } = useCoverage();

  // Build options for TacticalSelect
  const indicatorOptions = [
    { value: '', label: '-- Select Indicator --' },
    ...(indicators || []).map(indicator => ({
      value: indicator.id,
      label: indicator.name
    }))
  ];

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedIndicatorId('');
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedIndicatorId) {
      setError('Please select an indicator');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await predictCoverage({
        area_id: areaId,
        indicator_id: selectedIndicatorId,
      });

      setSuccess(
        `Coverage predictions generated successfully! Version ${result.version} with ${result.inserted} locations.`
      );

      // Close modal after 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to generate coverage predictions');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Predict Coverage"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Indicator Selection */}
        <div>
          <label className="block text-sm font-mono font-bold text-tactical-text-primary mb-2">
            Select Indicator
          </label>
          {loadingIndicators ? (
            <p className="text-sm text-tactical-text-dim">Loading indicators...</p>
          ) : indicatorsError ? (
            <p className="text-sm text-tactical-accent-red">
              {indicatorsError instanceof Error ? indicatorsError.message : 'Failed to load indicators'}
            </p>
          ) : (
            <TacticalSelect
              value={selectedIndicatorId}
              onChange={setSelectedIndicatorId}
              options={indicatorOptions}
              disabled={isSubmitting}
            />
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 border border-tactical-accent-red bg-tactical-accent-red/10">
            <p className="text-sm text-tactical-accent-red">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="p-3 border border-tactical-accent-green bg-tactical-accent-green/10">
            <p className="text-sm text-tactical-accent-green">{success}</p>
          </div>
        )}

        {/* Info Box */}
        <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
          <p className="text-xs text-tactical-text-dim mb-1">
            This will generate coverage predictions by:
          </p>
          <ul className="text-xs text-tactical-text-dim list-disc list-inside space-y-1">
            <li>Joining location data with visit indicators</li>
            <li>Calling the prevalence predictor algorithm</li>
            <li>Storing predictions in the coverage table</li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="submit"
            variant="primary"
            disabled={isSubmitting || !selectedIndicatorId}
          >
            {isSubmitting ? 'Generating...' : 'Generate Predictions'}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default PredictCoverageModal;
