import React, { useState, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Area } from '../types';
import { locationsApi } from '../services/api';
import { TacticalModal, TacticalButton, TacticalBadge, TacticalInput, TacticalSelect } from '../tactical-ui';

interface LocationUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  area: Area | null;
  onLocationsUploaded: () => void;
}

const LocationUploadModal: React.FC<LocationUploadModalProps> = ({
  isOpen,
  onClose,
  area,
  onLocationsUploaded
}) => {
  const { getToken } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [latColumn, setLatColumn] = useState('');
  const [lngColumn, setLngColumn] = useState('');
  const [externalIdColumn, setExternalIdColumn] = useState('');
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; updated: number; errors: string[]; pixels_created?: number } | null>(null);
  const [progress, setProgress] = useState<{ total_features: number; processed_features: number; inserted_count: number; updated_count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const parseFileFields = async (selectedFile: File) => {
    try {
      const fileName = selectedFile.name.toLowerCase();
      const isCsv = fileName.endsWith('.csv');
      const isGeoJson = fileName.endsWith('.geojson') || fileName.endsWith('.json');

      if (isCsv) {
        // Parse CSV to get column headers
        const text = await selectedFile.text();
        const firstLine = text.split('\n')[0];
        const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        setAvailableFields(headers);
      } else if (isGeoJson) {
        // Parse GeoJSON to get property keys from first feature
        const text = await selectedFile.text();
        const data = JSON.parse(text);

        let features = [];
        if (data.type === 'FeatureCollection') {
          features = data.features || [];
        } else if (data.type === 'Feature') {
          features = [data];
        }

        if (features.length > 0 && features[0].properties) {
          const propertyKeys = Object.keys(features[0].properties);
          setAvailableFields(propertyKeys);
        }
      }
    } catch (err) {
      console.error('Error parsing file fields:', err);
      setAvailableFields([]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setResult(null);
      setLatColumn('');
      setLngColumn('');
      setExternalIdColumn('');

      // Parse file to get available fields
      await parseFileFields(selectedFile);
    }
  };

  const pollWorkflowStatus = async (workflowId: string, token: string) => {
    try {
      const status = await locationsApi.getUploadStatus(workflowId, token);

      if (status.status === 'running' && status.progress) {
        setProgress(status.progress);
      } else if (status.status === 'completed' && status.result) {
        // Workflow completed
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setResult(status.result);
        setProgress(null);
        setIsLoading(false);

        // If successful, notify parent to refresh
        if (status.result.inserted > 0 || status.result.updated > 0) {
          onLocationsUploaded();
        }

        // Reset form if fully successful
        if (status.result.errors.length === 0) {
          setTimeout(() => {
            handleClose();
          }, 2000);
        }
      } else if (status.status === 'failed') {
        // Workflow failed
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setError(status.error || 'Workflow failed');
        setIsLoading(false);
        setProgress(null);
      }
    } catch (err: any) {
      console.error('Failed to get workflow status:', err);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setError('Failed to check upload status');
      setIsLoading(false);
      setProgress(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setError('Please select a file');
      return;
    }

    if (!area) {
      setError('Please select an area first');
      return;
    }

    // Check if CSV and validate columns
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    if (isCsv && (!latColumn.trim() || !lngColumn.trim())) {
      setError('Latitude and longitude columns are required for CSV files');
      return;
    }

    // Validate external ID column is provided
    if (!externalIdColumn.trim()) {
      setError('ID column is required');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        setIsLoading(false);
        return;
      }

      const config = {
        latColumn: latColumn.trim() || undefined,
        lngColumn: lngColumn.trim() || undefined,
        externalIdColumn: externalIdColumn.trim() || undefined
      };

      // Start the async workflow
      const uploadResponse = await locationsApi.upload(area.id, file, config, token);

      // Start polling for status
      pollIntervalRef.current = setInterval(() => {
        pollWorkflowStatus(uploadResponse.workflow_id, token);
      }, 2000); // Poll every 2 seconds

      // Do first poll immediately
      pollWorkflowStatus(uploadResponse.workflow_id, token);

    } catch (err: any) {
      console.error('Failed to upload locations:', err);
      setError(err.response?.data?.error || 'Failed to start upload');
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    // Clean up polling interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setFile(null);
    setLatColumn('');
    setLngColumn('');
    setExternalIdColumn('');
    setError(null);
    setResult(null);
    setProgress(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  const isCsv = file?.name.toLowerCase().endsWith('.csv');

  return (
    <TacticalModal
      title="Upload Locations"
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
            <TacticalBadge variant="danger">ERROR</TacticalBadge>
            <span className="text-sm text-tactical-accent-red">{error}</span>
          </div>
        )}

        {progress && (
          <div className="p-3 border border-tactical-accent-orange bg-tactical-bg-secondary space-y-2">
            <div className="flex items-center gap-3">
              <TacticalBadge variant="warning">PROCESSING</TacticalBadge>
              <span className="text-sm text-tactical-accent-orange font-bold tactical-loading-dots">
                Uploading<span>.</span><span>.</span><span>.</span>
              </span>
            </div>
            <div className="text-xs text-tactical-text-secondary space-y-1 ml-[76px]">
              <div>Features: {progress.processed_features} / {progress.total_features}</div>
              <div>Inserted: {progress.inserted_count}</div>
              <div>Updated: {progress.updated_count}</div>
              {(progress as any).error_count > 0 && (
                <div className="text-tactical-accent-red">Errors: {(progress as any).error_count}</div>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="p-3 border border-tactical-accent-green bg-tactical-bg-secondary space-y-2">
            <div className="flex items-center gap-3">
              <TacticalBadge variant="success">SUCCESS</TacticalBadge>
              <span className="text-sm text-tactical-accent-green font-bold">Upload Complete</span>
            </div>
            <div className="text-xs text-tactical-text-secondary space-y-1 ml-[76px]">
              <div>Inserted: {result.inserted}</div>
              <div>Updated: {result.updated}</div>
              {result.pixels_created !== undefined && result.pixels_created > 0 && (
                <div>Pixels Created: {result.pixels_created}</div>
              )}
              {result.errors.length > 0 && (
                <div className="text-tactical-accent-red">
                  Errors: {result.errors.length}
                  <div className="mt-1 max-h-24 overflow-auto tactical-scrollbar">
                    {result.errors.map((err, idx) => (
                      <div key={idx} className="text-xs">- {err}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {area && (
          <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
            <span className="text-xs text-tactical-text-dim uppercase tracking-wider">
              Area
            </span>
            <p className="text-sm text-tactical-text-primary font-bold mt-1">
              {area.name}
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="locationFile"
            className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
          >
            File (GeoJSON or CSV)
          </label>
          <input
            ref={fileInputRef}
            id="locationFile"
            type="file"
            accept=".geojson,.json,.csv"
            onChange={handleFileChange}
            disabled={isLoading}
            className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50 file:mr-4 file:py-1 file:px-3 file:border-0 file:text-sm file:font-mono file:bg-tactical-accent-green file:text-tactical-bg-primary file:cursor-pointer file:hover:bg-tactical-accent-orange"
          />
          {file && (
            <p className="text-xs text-tactical-text-dim mt-2">
              Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {file && isCsv && (
          <div className="grid grid-cols-2 gap-3">
            <TacticalInput
              label="Latitude Column *"
              type="text"
              value={latColumn}
              onChange={setLatColumn}
              placeholder="e.g., latitude, lat, y"
              disabled={isLoading}
            />
            <TacticalInput
              label="Longitude Column *"
              type="text"
              value={lngColumn}
              onChange={setLngColumn}
              placeholder="e.g., longitude, lng, x"
              disabled={isLoading}
            />
          </div>
        )}

        {file && (
          <div>
            <TacticalSelect
              label="ID Column *"
              value={externalIdColumn}
              onChange={setExternalIdColumn}
              options={[
                { value: '', label: '-- Select ID field (required) --' },
                ...availableFields.map(field => ({ value: field, label: field }))
              ]}
              disabled={isLoading || availableFields.length === 0}
            />
            <p className="text-xs text-tactical-text-dim mt-1 font-mono">
              <span className="text-tactical-accent-orange">Required:</span> Used for duplicate detection and updates
            </p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isLoading}
          >
            {result ? 'Close' : 'Cancel'}
          </TacticalButton>
          <TacticalButton
            type="submit"
            variant="primary"
            disabled={isLoading || !file || !area || (isCsv && (!latColumn.trim() || !lngColumn.trim())) || !externalIdColumn.trim()}
          >
            {isLoading ? (
              <span className="tactical-loading-dots">
                UPLOADING<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              'Upload Locations'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default LocationUploadModal;
