import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalInput, TacticalButton, TacticalBadge, TacticalSelect } from '../tactical-ui';
import FileUpload from './FileUpload';
import { useIndicators } from '../hooks/useIndicators';
import { useRounds } from '../hooks/useRounds';
import { FileData } from '../types';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface AddVisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  areaName: string;
  roundId: string;
  projectId: string;
  onSuccess: () => void;
}

const AddVisitModal: React.FC<AddVisitModalProps> = ({
  isOpen,
  onClose,
  areaId,
  areaName,
  roundId,
  projectId,
  onSuccess,
}) => {
  const { getToken } = useAuth();
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<any>(null);

  // Field mapping state
  const [locationIdField, setLocationIdField] = useState<string>('');
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const [indicatorId, setIndicatorId] = useState<string>('');
  const [nTrialsField, setNTrialsField] = useState<string>('');
  const [nCoveredField, setNCoveredField] = useState<string>('');

  const { data: projectIndicators = [], isLoading: loadingIndicators } = useIndicators(projectId);
  const { data: rounds = [], isLoading: loadingRounds } = useRounds(areaId);

  // Set default round when modal opens
  useEffect(() => {
    if (isOpen && roundId && !selectedRoundId) {
      setSelectedRoundId(roundId);
    }
  }, [isOpen, roundId]);

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
    setSelectedRoundId('');
    setIndicatorId('');
    setNTrialsField('');
    setNCoveredField('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUploadSummary(null);

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

    if (!nCoveredField) {
      setError('Please select the n_covered field');
      return;
    }

    setIsSubmitting(true);

    try {
      // Process each feature and build visits array
      const features = fileData.data.features;
      const visits = [];

      for (const feature of features) {
        const props = feature.properties || {};

        // Extract coordinates - handle both Point and Polygon geometries
        let longitude: number;
        let latitude: number;

        if (feature.geometry.type === 'Point') {
          longitude = feature.geometry.coordinates[0];
          latitude = feature.geometry.coordinates[1];
        } else if (feature.geometry.type === 'Polygon') {
          longitude = feature.geometry.coordinates[0][0][0];
          latitude = feature.geometry.coordinates[0][0][1];
        } else if (feature.geometry.type === 'MultiPolygon') {
          longitude = feature.geometry.coordinates[0][0][0][0];
          latitude = feature.geometry.coordinates[0][0][0][1];
        } else {
          console.warn(`Skipping feature: unsupported geometry type "${feature.geometry.type}"`);
          continue;
        }

        // Extract values from mapped fields
        const mappedLocationId = props[locationIdField];
        const nTrials = parseInt(props[nTrialsField]);
        const nCovered = parseInt(props[nCoveredField]);

        // Validate extracted values
        if (isNaN(nTrials) || isNaN(nCovered)) {
          console.warn(`Skipping feature: invalid n_trials or n_covered`);
          continue;
        }

        if (nCovered > nTrials) {
          console.warn(`Skipping feature: n_covered (${nCovered}) > n_trials (${nTrials})`);
          continue;
        }

        visits.push({
          area_id: areaId,
          round_id: selectedRoundId || roundId,
          indicator_id: indicatorId,
          location_id: mappedLocationId || null,
          latitude,
          longitude,
          n_trials: nTrials,
          n_covered: nCovered,
          geometry: feature.geometry
        });
      }

      // Call bulk upload endpoint
      const token = await getToken();
      const response = await axios.post(
        `${API_URL}/api/visits/bulk`,
        { visits },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const summary = response.data.summary;
      setUploadSummary(summary);

      if (summary.errors && summary.errors.length > 0) {
        setError(`Processed ${summary.total_processed} locations with ${summary.errors.length} errors`);
      }

      onSuccess();

      if (!summary.errors || summary.errors.length === 0) {
        setTimeout(() => {
          handleClose();
        }, 3000);
      }

    } catch (err: any) {
      console.error('Error creating visits:', err);
      setError(
        err.response?.data?.error ||
        err.message ||
        'Failed to create visits'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    console.log('handleClose called');
    if (!isSubmitting) {
      setError(null);
      setFileData(null);
      setStep(1);
      setUploadSummary(null);
      resetFieldMapping();
      onClose();
    }
  };

  const handleBackToStep1 = () => {
    setFileData(null);
    setStep(1);
    setUploadSummary(null);
    resetFieldMapping();
  };

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
          <div
            className={`flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity ${step === 1 ? 'opacity-100' : 'opacity-50'}`}
            onClick={() => setStep(1)}
          >
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
            <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
              <div className="text-sm font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Locations to process:</span>
                  <span className="text-tactical-text-primary font-bold">{fileData.data.features.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-tactical-text-dim">Area:</span>
                  <span className="text-tactical-text-primary">{areaName}</span>
                </div>
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

              {/* Round Selector */}
              <TacticalSelect
                label="Round (Optional)"
                value={selectedRoundId}
                onChange={setSelectedRoundId}
                options={[
                  { value: '', label: loadingRounds ? 'Loading rounds...' : 'Select a round (or leave blank for default)' },
                  ...rounds.map(round => ({
                    value: round.id,
                    label: `Round ${round.round_number}: ${round.name}`
                  }))
                ]}
                disabled={isSubmitting || loadingRounds}
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

              {/* N Covered Field */}
              <TacticalSelect
                label="N Covered Field *"
                value={nCoveredField}
                onChange={setNCoveredField}
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

            {/* Upload Summary */}
            {uploadSummary && (
              <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
                <div className="flex items-center gap-2 mb-2">
                  <TacticalBadge variant="success">UPLOAD COMPLETE</TacticalBadge>
                </div>
                <div className="text-sm font-mono space-y-1">
                  <div className="flex justify-between">
                    <span className="text-tactical-text-dim">Total processed:</span>
                    <span className="text-tactical-text-primary font-bold">{uploadSummary.total_processed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-tactical-text-dim">Matched existing locations:</span>
                    <span className="text-tactical-text-primary font-bold">{uploadSummary.matched_locations}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-tactical-text-dim">New locations created:</span>
                    <span className="text-tactical-text-primary font-bold">{uploadSummary.new_locations}</span>
                  </div>
                  {uploadSummary.errors && uploadSummary.errors.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-tactical-border-medium">
                      <div className="text-tactical-accent-red font-bold mb-1">Errors:</div>
                      <div className="max-h-32 overflow-y-auto tactical-scrollbar">
                        {uploadSummary.errors.map((err: string, idx: number) => (
                          <div key={idx} className="text-xs text-tactical-accent-red">{err}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
