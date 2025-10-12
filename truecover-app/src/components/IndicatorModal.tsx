import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalInput, TacticalButton, TacticalTextarea, TacticalBadge } from '../tactical-ui';
import { useCreateIndicator, useUpdateIndicator, useDeleteIndicator } from '../hooks/useIndicators';

interface Indicator {
  id: string;
  project_id: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
}

interface IndicatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  indicator?: Indicator | null;
  onSuccess: () => void;
}

const IndicatorModal: React.FC<IndicatorModalProps> = ({
  isOpen,
  onClose,
  projectId,
  indicator,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createIndicator = useCreateIndicator();
  const updateIndicator = useUpdateIndicator();
  const deleteIndicator = useDeleteIndicator();

  const isEditMode = !!indicator;
  const isSubmitting = createIndicator.isPending || updateIndicator.isPending;
  const isDeleting = deleteIndicator.isPending;

  useEffect(() => {
    if (indicator) {
      setName(indicator.name);
      setDescription(indicator.description || '');
    } else {
      setName('');
      setDescription('');
    }
    setError(null);
  }, [indicator, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Indicator name is required');
      return;
    }

    try {
      if (isEditMode && indicator) {
        await updateIndicator.mutateAsync({
          indicatorId: indicator.id,
          projectId,
          name: name.trim(),
          description: description.trim(),
        });
      } else {
        await createIndicator.mutateAsync({
          projectId,
          name: name.trim(),
          description: description.trim(),
        });
      }

      // Reset form
      setName('');
      setDescription('');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving indicator:', err);
      setError(
        err.response?.data?.error ||
        err.message ||
        'Failed to save indicator'
      );
    }
  };

  const handleDelete = async () => {
    if (!indicator) return;

    if (!confirm(`Are you sure you want to delete the indicator "${indicator.name}"? This action cannot be undone.`)) {
      return;
    }

    setError(null);

    try {
      await deleteIndicator.mutateAsync({
        indicatorId: indicator.id,
        projectId,
      });

      // Reset form
      setName('');
      setDescription('');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error deleting indicator:', err);
      setError(
        err.response?.data?.error ||
        err.message ||
        'Failed to delete indicator'
      );
    }
  };

  const handleClose = () => {
    if (!isSubmitting && !isDeleting) {
      setError(null);
      setName('');
      setDescription('');
      onClose();
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditMode ? 'Edit Indicator' : 'Create New Indicator'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-accent-red/10">
            <TacticalBadge variant="danger">ERROR</TacticalBadge>
            <span className="text-sm text-tactical-accent-red">{error}</span>
          </div>
        )}

        <TacticalInput
          label="Indicator Name"
          value={name}
          onChange={setName}
          placeholder="e.g., Malaria Prevalence, ITN Coverage"
          required
          disabled={isSubmitting || isDeleting}
        />

        <TacticalTextarea
          label="Description (Optional)"
          value={description}
          onChange={setDescription}
          placeholder="Describe this indicator and how it will be measured..."
          rows={3}
          disabled={isSubmitting || isDeleting}
        />

        <div className="flex gap-3 justify-between pt-4 border-t border-tactical-border-medium">
          <div>
            {isEditMode && (
              <TacticalButton
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={isSubmitting || isDeleting}
              >
                {isDeleting ? (
                  <span className="tactical-loading-dots">
                    DELETING<span>.</span><span>.</span><span>.</span>
                  </span>
                ) : (
                  'Delete Indicator'
                )}
              </TacticalButton>
            )}
          </div>
          <div className="flex gap-3">
            <TacticalButton
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isSubmitting || isDeleting}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              type="submit"
              variant="primary"
              disabled={isSubmitting || isDeleting}
            >
              {isSubmitting ? (
                <span className="tactical-loading-dots">
                  {isEditMode ? 'SAVING' : 'CREATING'}
                  <span>.</span><span>.</span><span>.</span>
                </span>
              ) : (
                isEditMode ? 'Save Changes' : 'Create Indicator'
              )}
            </TacticalButton>
          </div>
        </div>
      </form>
    </TacticalModal>
  );
};

export default IndicatorModal;
