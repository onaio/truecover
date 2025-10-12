import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalInput, TacticalButton, TacticalBadge, TacticalSelect } from '../tactical-ui';
import FileUpload from './FileUpload';
import { useCreateVisit } from '../hooks/useVisits';
import { useBulkCreateVisitIndicators } from '../hooks/useVisitIndicators';
import { useIndicators } from '../hooks/useIndicators';
import { FileData } from '../types';

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

  // Field mapping state
  const [locationIdField, setLocationIdField] = useState<string>('');
  const [roundField, setRoundField] = useState<string>('');
  const [indicatorId, setIndicatorId] = useState<string>('');
  const [nTrialsField, setNTrialsField] = useState<string>('');
  const [nPositiveField, setNPositiveField] = useState<string>('');

  const createVisit = useCreateVisit();
  const createIndicators = useBulkCreateVisitIndicators();
  const { data: projectIndicators = [], isLoading: loadingIndicators } = useIndicators(projectId);

  useEffect(() => {
    console.log('AddVisitModal MOUNTED or isOpen changed to:', isOpen);
  }, [isOpen]);

  useEffect(() => {
    console.log('AddVisitModal step changed to:', step);
  }, [step]);

  useEffect(() => {
    console.log('AddVisitModal fileData changed:', fileData ? `${fileData.data.features.length} features` : 'null');
    if (fileData) {
      console.log('Available fields in modal:', fileData.fields);
    }
  }, [fileData]);

  const handleFileLoaded = (data: FileData) => {
    try {
      console.log('File loaded, setting fileData', data.data.features.length, 'features');
      console.log('Available fields:', data.fields);
      setFileData(data);
      setError(null);
      // Don't automatically move to step 2 - let user click "Continue"
    } catch (err: any) {
      console.error('Error in handleFileLoaded:', err);
      setError(`Failed to load file: ${err.message}`);
    }
  };

  const handleContinueToStep2 = () => {
    console.log('Moving to step 2');
    setStep(2);
  };

  const resetFieldMapping = () => {
    setLocationIdField('');
    setRoundField('');
    setIndicatorId('');
    setNTrialsField('');
    setNPositiveField('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fileData) {
      setError('Please upload a file first');
      return;
    }

    // Validate field mapping
    if (!locationIdField) {
      setError('Please select a Location ID field');
      return;
    }

    if (!indicatorId) {
      setError('Please select an indicator');
      return;
    }

    if (!nTrialsField) {
      setError('Please select the n_trials field');
      return;
    }

    if (!nPositiveField) {
      setError('Please select the n_positive field');
      return;
    }

    try {
      // Process each feature in the uploaded file
      const features = fileData.data.features;
      let successCount = 0;
      let errorCount = 0;

      for (const feature of features) {
        try {
          const props = feature.properties || {};

          // Extract coordinates - handle both Point and Polygon geometries
          let longitude: number;
          let latitude: number;

          if (feature.geometry.type === 'Point') {
            longitude = feature.geometry.coordinates[0];
            latitude = feature.geometry.coordinates[1];
          } else if (feature.geometry.type === 'Polygon') {
            // Use first coordinate of the outer ring
            longitude = feature.geometry.coordinates[0][0][0];
            latitude = feature.geometry.coordinates[0][0][1];
          } else if (feature.geometry.type === 'MultiPolygon') {
            // Use first coordinate of the first polygon's outer ring
            longitude = feature.geometry.coordinates[0][0][0][0];
            latitude = feature.geometry.coordinates[0][0][0][1];
          } else {
            console.warn(`Skipping feature: unsupported geometry type "${feature.geometry.type}"`);
            errorCount++;
            continue;
          }

          // Extract values from mapped fields
          const mappedLocationId = props[locationIdField];
          const nTrials = parseInt(props[nTrialsField]);
          const nPositive = parseInt(props[nPositiveField]);
          const mappedRound = roundField ? props[roundField] : null;

          // Validate extracted values
          if (!mappedLocationId) {
            console.warn(`Skipping feature: missing location_id in field "${locationIdField}"`);
            errorCount++;
            continue;
          }

          if (isNaN(nTrials) || isNaN(nPositive)) {
            console.warn(`Skipping feature: invalid n_trials or n_positive for location ${mappedLocationId}`);
            errorCount++;
            continue;
          }

          if (nPositive > nTrials) {
            console.warn(`Skipping feature: n_positive (${nPositive}) > n_trials (${nTrials}) for location ${mappedLocationId}`);
            errorCount++;
            continue;
          }

          // Step 1: Create the visit for this location
          const visitData = {
            area_id: areaId,
            round_id: mappedRound || roundId,
            location_id: mappedLocationId,
            latitude,
            longitude,
            properties: props
          };

          const visit = await createVisit.mutateAsync(visitData);

          // Step 2: Create indicator measurement for this visit
          const indicatorData = [{
            visit_id: visit.id,
            location_id: visit.location_id,
            indicator_id: indicatorId,
            n_trials: nTrials,
            n_positive: nPositive,
            exceedance_probability: props.exceedance_probability || null,
            exceedance_uncertainty: props.exceedance_uncertainty || null,
            prevalence_bci_width: props.prevalence_bci_width || null,
            prevalence_prediction: props.prevalence_prediction || null,
          }];

          await createIndicators.mutateAsync({ indicators: indicatorData });
          successCount++;
        } catch (featureErr: any) {
          console.error('Error processing feature:', featureErr);
          errorCount++;
        }
      }

      // Show results
      if (successCount > 0) {
        setError(errorCount > 0
          ? `Successfully created ${successCount} visits, ${errorCount} failed`
          : null
        );
        setFileData(null);
        setStep(1);
        resetFieldMapping();
        onSuccess();

        if (errorCount === 0) {
          onClose();
        }
      } else {
        setError('Failed to create any visits. Please check your data and field mappings.');
      }
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
      resetFieldMapping();
      onClose();
    }
  };

  const handleBackToStep1 = () => {
    setFileData(null);
    setStep(1);
    resetFieldMapping();
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
            <span className="text-sm font-mono text-tactical-text-primary">Map Fields</span>
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
                    Continue to Map Fields →
                  </TacticalButton>
                </div>
              </>
            )}
          </>
        )}

        {/* Step 2: Map Fields */}
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

            {/* Field Mapping Configuration */}
            <div className="space-y-3">
              <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider">
                Field Mapping
              </label>
              <p className="text-xs text-tactical-text-dim font-mono mb-3">
                Map fields from your uploaded file to the required data fields
              </p>

              {/* Location ID Field */}
              <TacticalSelect
                label="Location ID Field *"
                value={locationIdField}
                onChange={setLocationIdField}
                options={[
                  { value: '', label: 'Select a field...' },
                  ...(fileData?.fields || []).map(field => ({
                    value: field,
                    label: field
                  }))
                ]}
                disabled={isSubmitting}
              />

              {/* Round Field (Optional) */}
              <TacticalSelect
                label="Round Field (Optional)"
                value={roundField}
                onChange={setRoundField}
                options={[
                  { value: '', label: 'None - use current round' },
                  ...(fileData?.fields || []).map(field => ({
                    value: field,
                    label: field
                  }))
                ]}
                disabled={isSubmitting}
              />

              {/* Indicator Selector */}
              <TacticalSelect
                label="Indicator *"
                value={indicatorId}
                onChange={setIndicatorId}
                options={[
                  { value: '', label: loadingIndicators ? 'Loading indicators...' : 'Select an indicator' },
                  ...projectIndicators.map(ind => ({
                    value: ind.id,
                    label: ind.name
                  }))
                ]}
                disabled={isSubmitting || loadingIndicators}
              />

              {/* N Trials Field */}
              <TacticalSelect
                label="N Trials Field *"
                value={nTrialsField}
                onChange={setNTrialsField}
                options={[
                  { value: '', label: 'Select a field...' },
                  ...(fileData?.fields || []).map(field => ({
                    value: field,
                    label: field
                  }))
                ]}
                disabled={isSubmitting}
              />

              {/* N Positive Field */}
              <TacticalSelect
                label="N Positive Field *"
                value={nPositiveField}
                onChange={setNPositiveField}
                options={[
                  { value: '', label: 'Select a field...' },
                  ...(fileData?.fields || []).map(field => ({
                    value: field,
                    label: field
                  }))
                ]}
                disabled={isSubmitting}
              />
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
