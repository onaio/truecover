import React, { useState } from 'react';
import { TacticalModal, TacticalInput, TacticalButton, TacticalTextarea, TacticalSelect, TacticalDatePicker } from '../tactical-ui';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface CreateRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  onRoundCreated: () => void;
}

const CreateRoundModal: React.FC<CreateRoundModalProps> = ({
  isOpen,
  onClose,
  areaId,
  onRoundCreated,
}) => {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [batchSize, setBatchSize] = useState('10');
  const [uncertaintyField, setUncertaintyField] = useState('prevalence_bci_width');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Round name is required');
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
          batch_size: batchSizeNum,
          uncertainty_field: uncertaintyField,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.success) {
        // Reset form
        setName('');
        setDescription('');
        setStartDate('');
        setEndDate('');
        setBatchSize('10');
        setUncertaintyField('prevalence_bci_width');

        onRoundCreated();
        onClose();
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
      <form onSubmit={handleSubmit} className="space-y-4">
        <TacticalInput
          label="Round Name"
          value={name}
          onChange={setName}
          placeholder="e.g., Round 1, Baseline Survey"
          required
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
              label="Batch Size (Number of Locations to Select)"
              type="number"
              value={batchSize}
              onChange={setBatchSize}
              placeholder="10"
              min="1"
              required
              disabled={isSubmitting}
            />
          </div>
        </div>

        {error && (
          <div className="p-3 border border-tactical-accent-red bg-tactical-accent-red/10">
            <p className="text-sm text-tactical-accent-red">{error}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-4 border-t border-tactical-border-medium">
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
