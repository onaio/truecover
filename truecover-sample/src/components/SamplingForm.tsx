import React, { useState } from 'react';
import { FileData } from '../types';

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
    <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
      <h3>Sampling Configuration</h3>
      
      <div style={{ marginBottom: '15px' }}>
        <label htmlFor="field-select" style={{ display: 'block', marginBottom: '5px' }}>
          Select Uncertainty Field:
        </label>
        <select
          id="field-select"
          value={selectedField}
          onChange={(e) => setSelectedField(e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px'
          }}
          required
        >
          <option value="">-- Select a field --</option>
          {fileData.fields.map(field => (
            <option key={field} value={field}>{field}</option>
          ))}
        </select>
      </div>
      
      <div style={{ marginBottom: '15px' }}>
        <label htmlFor="batch-size" style={{ display: 'block', marginBottom: '5px' }}>
          Number of Points to Sample:
        </label>
        <input
          id="batch-size"
          type="text"
          value={batchSize}
          onChange={(e) => setBatchSize(e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px'
          }}
          placeholder="Enter number of points"
          required
        />
      </div>
      
      <div style={{ marginBottom: '10px', fontSize: '14px', color: '#666' }}>
        <p>Total features in file: {fileData.data.features.length}</p>
        <p>File type: {fileData.type.toUpperCase()}</p>
      </div>
      
      <button
        type="submit"
        disabled={isLoading}
        style={{
          padding: '10px 20px',
          backgroundColor: isLoading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '16px',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          width: '100%'
        }}
      >
        {isLoading ? 'Processing...' : 'Submit to Adaptive Sampling Service'}
      </button>
    </form>
  );
};

export default SamplingForm;