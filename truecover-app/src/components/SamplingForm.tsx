import React, { useState } from 'react';
import { FileData } from '../types';
import { TacticalCard, TacticalButton, TacticalInput, TacticalSelect } from '../tactical-ui';

interface SamplingFormProps {
  fileData: FileData | null;
  onSubmit: (batchSize: number, fieldName: string) => void;
  isLoading: boolean;
}

const SamplingForm: React.FC<SamplingFormProps> = ({ fileData, onSubmit, isLoading }) => {
  const [batchSize, setBatchSize] = useState<string>('10');
  const [selectedField, setSelectedField] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedField) {
      alert('Please select an uncertainty field');
      return;
    }

    const batchSizeNum = parseInt(batchSize);
    if (isNaN(batchSizeNum) || batchSizeNum < 1) {
      alert('Batch size must be a number greater than 0');
      return;
    }

    onSubmit(batchSizeNum, selectedField);
  };

  if (!fileData) {
    return null;
  }

  return (
    <TacticalCard title="Sampling Configuration" padding="lg" className="mb-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <TacticalSelect
          label="Select Uncertainty Field"
          value={selectedField}
          onChange={setSelectedField}
          options={[
            { value: '', label: '-- Select a field --' },
            ...fileData.fields.map(field => ({ value: field, label: field }))
          ]}
        />

        <TacticalInput
          label="Number of Points to Sample"
          type="number"
          value={batchSize}
          onChange={setBatchSize}
          placeholder="Enter number of points"
        />

        <div className="p-3 border border-tactical-border-dark bg-tactical-bg-secondary">
          <div className="space-y-1 text-xs font-mono text-tactical-text-muted">
            <div>
              <span className="text-tactical-text-dim">Total features in file:</span>{' '}
              <span className="text-tactical-text-secondary">{fileData.data.features.length}</span>
            </div>
            <div>
              <span className="text-tactical-text-dim">File type:</span>{' '}
              <span className="text-tactical-text-secondary">{fileData.type.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <TacticalButton
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={isLoading}
        >
          {isLoading ? 'Processing...' : 'Submit to Adaptive Sampling Service'}
        </TacticalButton>
      </form>
    </TacticalCard>
  );
};

export default SamplingForm;