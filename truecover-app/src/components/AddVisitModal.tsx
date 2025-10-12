import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalInput, TacticalButton, TacticalBadge, TacticalSelect } from '../tactical-ui';
import FileUpload from './FileUpload';
import { useCreateVisit } from '../hooks/useVisits';
import { useBulkCreateVisitIndicators } from '../hooks/useVisitIndicators';
import { useIndicators } from '../hooks/useIndicators';
import { FileData } from '../types';

interface IndicatorMeasurement {
  indicator_id: string;
  indicator_name: string;
  n_trials: string;
  n_positive: string;
}

interface AddVisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  roundId: string;
  projectId: string;
  onSuccess: () => void;
}

const AddVisitModal: React.FC<AddVisitModalProps> = ({
  isOpen,
  onClose,
  areaId,
  roundId,
  projectId,
  onSuccess,
}) => {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  // Indicator measurements - start with one empty row
  const [measurements, setMeasurements] = useState<IndicatorMeasurement[]>([
    { indicator_id: '', indicator_name: '', n_trials: '', n_positive: '' }
  ]);

  const createVisit = useCreateVisit();
  const createIndicators = useBulkCreateVisitIndicators();
  const { data: projectIndicators = [], isLoading: loadingIndicators } = useIndicators(projectId);

  useEffect(() => {
    console.log('AddVisitModal isOpen changed to:', isOpen);
  }, [isOpen]);

  useEffect(() => {
    console.log('AddVisitModal step changed to:', step);
  }, [step]);

  useEffect(() => {
    console.log('AddVisitModal fileData changed:', fileData ? `${fileData.data.features.length} features` : 'null');
  }, [fileData]);

  const handleFileLoaded = (data: FileData) => {
    console.log('File loaded, setting fileData', data.data.features.length, 'features');
    setFileData(data);
    setError(null);
    // Don't automatically move to step 2 - let user click "Continue"
  };

  const handleContinueToStep2 = () => {
    console.log('Moving to step 2');
    setStep(2);
  };

  const handleAddMeasurement = () => {
    setMeasurements([
      ...measurements,
      { indicator_id: '', indicator_name: '', n_trials: '', n_positive: '' }
    ]);
  };

  const handleRemoveMeasurement = (index: number) => {
    setMeasurements(measurements.filter((_, i) => i !== index));
  };

  const handleMeasurementChange = (index: number, field: keyof IndicatorMeasurement, value: string) => {
    const updated = [...measurements];
    updated[index] = { ...updated[index], [field]: value };

    // If changing indicator, also update the name
    if (field === 'indicator_id') {
      const indicator = projectIndicators.find(ind => ind.id === value);
      updated[index].indicator_name = indicator?.name || '';
    }

    setMeasurements(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fileData) {
      setError('Please upload a file first');
      return;
    }

    // Validate measurements
    const validMeasurements = measurements.filter(m =>
      m.indicator_id && m.n_trials && m.n_positive
    );

    if (validMeasurements.length === 0) {
      setError('Please add at least one indicator measurement');
      return;
    }

    // Validate n_positive <= n_trials
    for (const m of validMeasurements) {
      const trials = parseInt(m.n_trials);
      const positive = parseInt(m.n_positive);
      if (positive > trials) {
        setError('Number of positive results cannot exceed number of trials');
        return;
      }
    }

    try {
      // Process each feature in the uploaded file
      const features = fileData.data.features;

      for (const feature of features) {
        const coords = feature.geometry.coordinates;
        const longitude = coords[0];
        const latitude = coords[1];

        // Step 1: Create the visit for this location
        const visitData = {
          area_id: areaId,
          round_id: roundId,
          latitude,
          longitude,
          properties: feature.properties || {}
        };

        const visit = await createVisit.mutateAsync(visitData);

        // Step 2: Create all indicator measurements for this visit
        // Extract prediction fields from GeoJSON properties if they exist
        const props = feature.properties || {};
        const indicatorData = validMeasurements.map(m => ({
          visit_id: visit.id,
          location_id: visit.location_id,
          indicator_id: m.indicator_id,
          n_trials: parseInt(m.n_trials),
          n_positive: parseInt(m.n_positive),
          exceedance_probability: props.exceedance_probability || null,
          exceedance_uncertainty: props.exceedance_uncertainty || null,
          prevalence_bci_width: props.prevalence_bci_width || null,
          prevalence_prediction: props.prevalence_prediction || null,
        }));

        await createIndicators.mutateAsync({ indicators: indicatorData });
      }

      // Success!
      setFileData(null);
      setStep(1);
      setMeasurements([{ indicator_id: '', indicator_name: '', n_trials: '', n_positive: '' }]);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error creating visits:', err);
      setError(
        err.response?.data?.error ||
        err.message ||
        'Failed to create visits'
      );
    }
  };

  const handleClose = () => {
    console.log('handleClose called');
    if (!createVisit.isPending && !createIndicators.isPending) {
      setError(null);
      setFileData(null);
      setStep(1);
      setMeasurements([{ indicator_id: '', indicator_name: '', n_trials: '', n_positive: '' }]);
      onClose();
    }
  };

  const handleBackToStep1 = () => {
    setFileData(null);
    setStep(1);
  };

  const isSubmitting = createVisit.isPending || createIndicators.isPending;

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Visit Data"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Step Indicator */}
        <div className="flex items-center gap-4 pb-4 border-b border-tactical-border-medium">
          <div className={`flex items-center gap-2 ${step === 1 ? 'opacity-100' : 'opacity-50'}`}>
            <TacticalBadge variant={step === 1 ? "primary" : "secondary"}>STEP 1</TacticalBadge>
            <span className="text-sm font-mono text-tactical-text-primary">Upload Data</span>
          </div>
          <div className="flex-1 h-px bg-tactical-border-medium"></div>
          <div className={`flex items-center gap-2 ${step === 2 ? 'opacity-100' : 'opacity-50'}`}>
            <TacticalBadge variant={step === 2 ? "primary" : "secondary"}>STEP 2</TacticalBadge>
            <span className="text-sm font-mono text-tactical-text-primary">Configure Indicators</span>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-accent-red/10">
            <TacticalBadge variant="danger">ERROR</TacticalBadge>
            <span className="text-sm text-tactical-accent-red">{error}</span>
          </div>
        )}

        {/* Step 1: File Upload */}
        {step === 1 && (
          <>
            <FileUpload onFileLoaded={handleFileLoaded} label="Upload Visit Data (GeoJSON or CSV)" />

            {fileData && (
              <>
                <div className="p-3 border border-tactical-accent-green bg-tactical-accent-green/10">
                  <TacticalBadge variant="success">FILE LOADED</TacticalBadge>
                  <span className="ml-2 text-sm text-tactical-text-primary">
                    {fileData.data.features.length} location{fileData.data.features.length !== 1 ? 's' : ''} found
                  </span>
                </div>

                <div className="flex justify-end">
                  <TacticalButton
                    type="button"
                    variant="primary"
                    onClick={handleContinueToStep2}
                  >
                    Continue to Configure Indicators →
                  </TacticalButton>
                </div>
              </>
            )}
          </>
        )}

        {/* Step 2: Configure Indicators */}
        {step === 2 && fileData && (
          <>
            {/* Area Information */}
            <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary space-y-2">
              <div className="flex items-center gap-2">
                <TacticalBadge variant="info">DATA SUMMARY</TacticalBadge>
              </div>
              <div className="text-sm font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Locations to process:</span>
                  <span className="text-tactical-text-primary font-bold">{fileData.data.features.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Area ID:</span>
                  <span className="text-tactical-text-primary">{areaId.substring(0, 8)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Round ID:</span>
                  <span className="text-tactical-text-primary">{roundId.substring(0, 8)}...</span>
                </div>
              </div>
              <div className="pt-2">
                <TacticalButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleBackToStep1}
                  disabled={isSubmitting}
                >
                  ← Change File
                </TacticalButton>
              </div>
            </div>

            {/* Indicator Configuration */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                  Indicator Measurements
                </label>
                <TacticalButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAddMeasurement}
                  disabled={isSubmitting}
                >
                  + Add Indicator
                </TacticalButton>
              </div>

              {measurements.map((measurement, index) => (
                <div key={index} className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary space-y-3">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-mono text-tactical-text-dim">Indicator {index + 1}</span>
                    {measurements.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMeasurement(index)}
                        disabled={isSubmitting}
                        className="text-xs text-tactical-accent-red hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <TacticalSelect
                    label="Indicator"
                    value={measurement.indicator_id}
                    onChange={(value) => handleMeasurementChange(index, 'indicator_id', value)}
                    options={[
                      { value: '', label: loadingIndicators ? 'Loading indicators...' : 'Select an indicator' },
                      ...projectIndicators.map(ind => ({
                        value: ind.id,
                        label: ind.name
                      }))
                    ]}
                    disabled={isSubmitting || loadingIndicators}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <TacticalInput
                      label="Number of Trials"
                      type="number"
                      min="0"
                      value={measurement.n_trials}
                      onChange={(value) => handleMeasurementChange(index, 'n_trials', value)}
                      placeholder="e.g., 100"
                      disabled={isSubmitting}
                    />
                    <TacticalInput
                      label="Number Positive"
                      type="number"
                      min="0"
                      value={measurement.n_positive}
                      onChange={(value) => handleMeasurementChange(index, 'n_positive', value)}
                      placeholder="e.g., 75"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Footer buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t border-tactical-border-medium">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </TacticalButton>

          {step === 2 && (
            <TacticalButton
              type="submit"
              variant="primary"
              disabled={isSubmitting || !fileData}
            >
              {isSubmitting ? (
                <span className="tactical-loading-dots">
                  SAVING<span>.</span><span>.</span><span>.</span>
                </span>
              ) : (
                'Save Visits'
              )}
            </TacticalButton>
          )}
        </div>
      </form>
    </TacticalModal>
  );
};

export default AddVisitModal;
