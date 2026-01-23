// ABOUTME: Modal for importing building locations from Overture Maps for an admin boundary
// ABOUTME: Previews building count, handles import, and displays results

import React, { useState, useEffect, useRef } from 'react';
import { TacticalModal, TacticalButton, tacticalToast } from '../tactical-ui';
import { adminBoundariesApi } from '../services/api';
import { useAuth } from '@clerk/clerk-react';

interface AddOvertureLocationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  areaName: string;
  adminBoundary: { pcode: string; name: string; geometry?: any } | null;
  onImportComplete?: () => void;
}

interface ImportProgress {
  total_fetched: number;
  total_inserted: number;
  total_duplicates: number;
  batches_processed: number;
}

interface ImportResult {
  success: boolean;
  inserted: number;
  duplicates: number;
  pixels_created: number;
  total_fetched: number;
  batches_processed: number;
}

const AddOvertureLocationsModal: React.FC<AddOvertureLocationsModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  areaName,
  adminBoundary,
  onImportComplete
}) => {
  const { getToken } = useAuth();
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [buildingCount, setBuildingCount] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load preview when modal opens and cleanup on close
  useEffect(() => {
    if (isOpen && adminBoundary) {
      // Skip preview for drawn areas (they have geometry)
      if (adminBoundary.geometry) {
        // For drawn areas, set count to 1 to enable the import button
        // (we don't know the actual count until we import)
        setBuildingCount(1);
        setIsLoadingPreview(false);
      } else {
        // For admin boundaries, do the preview
        loadPreview();
      }
    } else {
      // Reset state when modal closes
      setBuildingCount(null);
      setPreviewError(null);
      setProgress(null);
      setResult(null);

      // Clear polling interval
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      // Cleanup on unmount
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOpen, adminBoundary]);

  const loadPreview = async () => {
    if (!adminBoundary) return;

    setIsLoadingPreview(true);
    setPreviewError(null);

    try {
      const token = await getToken();
      if (!token) {
        setPreviewError('Authentication required');
        return;
      }

      const result = await adminBoundariesApi.previewOvertureBuildings(
        adminBoundary.pcode,
        campaignId,
        token,
        adminBoundary.geometry
      );

      setBuildingCount(result.count);
    } catch (error: any) {
      console.error('Error previewing buildings:', error);
      setPreviewError(error.response?.data?.error || 'Failed to preview buildings');
      tacticalToast.error('Preview Failed', error.response?.data?.error || 'Failed to preview buildings from Overture Maps');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const pollWorkflowStatus = async (workflowId: string, token: string) => {
    try {
      const status = await adminBoundariesApi.getOvertureImportStatus(workflowId, token);
      console.log('Workflow status poll:', status);

      if (status.status === 'running') {
        // Update progress if available (query might have timed out)
        if (status.progress) {
          setProgress(status.progress);
        }
        // Keep polling even if progress is null (workflow is still running)
      } else if (status.status === 'completed' && status.result) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        setResult(status.result);
        setIsImporting(false);

        // Show success message
        tacticalToast.success(
          'Import Complete',
          `Imported ${status.result.inserted.toLocaleString()} buildings (${status.result.duplicates.toLocaleString()} duplicates, ${status.result.pixels_created.toLocaleString()} pixels created)`
        );

        // Call completion callback
        if (onImportComplete) {
          onImportComplete();
        }
      } else if (status.status === 'failed') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        setIsImporting(false);
        tacticalToast.error('Import Failed', status.error || 'Workflow failed');
      } else {
        // Unexpected status
        console.warn('Unexpected workflow status:', status.status);
      }
    } catch (error: any) {
      console.error('Error polling workflow status:', error);
      // Don't stop polling on network errors - keep trying
      if (error.response?.status === 404) {
        // Workflow not found - stop polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsImporting(false);
        tacticalToast.error('Error', 'Workflow not found');
      }
      // For other errors (network issues, etc.), keep polling
    }
  };

  const handleImport = async () => {
    if (!adminBoundary || buildingCount === null || buildingCount === 0) return;

    setIsImporting(true);
    setProgress(null);
    setResult(null);

    try {
      const token = await getToken();
      if (!token) {
        tacticalToast.error('Authentication Error', 'Authentication required');
        setIsImporting(false);
        return;
      }

      // Start async import workflow
      const response = await adminBoundariesApi.importOvertureBuildingsAsync(
        adminBoundary.pcode,
        campaignId,
        token,
        adminBoundary.geometry
      );

      console.log('Import workflow started:', response.workflow_id);

      // Poll immediately first time
      pollWorkflowStatus(response.workflow_id, token);

      // Then start polling for status every 2 seconds
      pollIntervalRef.current = setInterval(() => {
        pollWorkflowStatus(response.workflow_id, token);
      }, 2000);

    } catch (error: any) {
      console.error('Error starting import:', error);
      setIsImporting(false);
      tacticalToast.error('Import Failed', error.response?.data?.error || 'Failed to start import from Overture Maps');
    }
  };

  if (!adminBoundary) {
    return null;
  }

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Locations from Overture Maps"
      size="md"
    >
      <div className="space-y-4">
        {/* Admin Boundary Info */}
        <div className="p-3 border border-tactical-accent-blue bg-tactical-accent-blue/10">
          <p className="text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-1">
            {adminBoundary.geometry ? 'Drawn Area' : 'Admin Boundary'}
          </p>
          <p className="text-sm font-mono text-tactical-text-secondary">
            {adminBoundary.geometry ? adminBoundary.name : `${adminBoundary.name} (${adminBoundary.pcode})`}
          </p>
          <p className="text-xs font-mono text-tactical-text-muted mt-1">
            Area: {areaName}
          </p>
        </div>

        {/* Preview Section */}
        {isLoadingPreview && (
          <div className="p-4 border border-tactical-border-medium bg-tactical-bg-secondary">
            <p className="text-sm font-mono text-tactical-text-muted">
              Loading building count from Overture Maps...
            </p>
          </div>
        )}

        {previewError && (
          <div className="p-4 border border-red-500 bg-red-500/10">
            <p className="text-sm font-mono text-red-400">
              {previewError}
            </p>
          </div>
        )}

        {!isLoadingPreview && !previewError && buildingCount !== null && !isImporting && !result && (
          <div className="p-4 border border-tactical-border-medium bg-tactical-bg-secondary">
            {adminBoundary.geometry ? (
              // For drawn areas, show a simpler message
              <>
                <p className="text-sm font-mono text-tactical-text-secondary">
                  Buildings from Overture Maps within the drawn area will be added to <span className="font-bold">{areaName}</span>
                </p>
                <p className="text-xs font-mono text-tactical-text-muted mt-2">
                  Duplicate locations will be skipped automatically.
                </p>
              </>
            ) : (
              // For admin boundaries, show the preview count
              <>
                <p className="text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                  Preview
                </p>
                <p className="text-sm font-mono text-tactical-text-secondary">
                  {buildingCount === 0 ? (
                    <>No buildings found in this area</>
                  ) : (
                    <>
                      <span className="font-bold text-tactical-accent-blue">{buildingCount.toLocaleString()}</span> buildings will be added to <span className="font-bold">{areaName}</span>
                    </>
                  )}
                </p>
                <p className="text-xs font-mono text-tactical-text-muted mt-2">
                  Duplicate locations will be skipped automatically.
                </p>
              </>
            )}
          </div>
        )}

        {/* Import Progress */}
        {isImporting && progress && (
          <div className="p-4 border border-tactical-accent-blue bg-tactical-accent-blue/10">
            <p className="text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
              Import Progress
            </p>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Batches Processed</p>
                  <p className="text-lg font-mono font-bold text-tactical-accent-blue">
                    {progress.batches_processed}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Buildings Fetched</p>
                  <p className="text-lg font-mono font-bold text-tactical-text-primary">
                    {progress.total_fetched.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Inserted</p>
                  <p className="text-lg font-mono font-bold text-green-400">
                    {progress.total_inserted.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Duplicates</p>
                  <p className="text-lg font-mono font-bold text-yellow-400">
                    {progress.total_duplicates.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1 flex-1 bg-tactical-border-medium rounded overflow-hidden">
                  <div
                    className="h-full bg-tactical-accent-blue transition-all duration-300"
                    style={{
                      width: buildingCount ? `${Math.min(100, (progress.total_fetched / buildingCount) * 100)}%` : '0%'
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-tactical-text-muted">
                  {buildingCount ? `${Math.round((progress.total_fetched / buildingCount) * 100)}%` : '0%'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Import Results */}
        {result && (
          <div className="p-4 border border-green-500 bg-green-500/10">
            <p className="text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
              Import Complete
            </p>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Total Fetched</p>
                  <p className="text-lg font-mono font-bold text-tactical-text-primary">
                    {result.total_fetched.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Batches</p>
                  <p className="text-lg font-mono font-bold text-tactical-text-primary">
                    {result.batches_processed}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Buildings Added</p>
                  <p className="text-lg font-mono font-bold text-green-400">
                    {result.inserted.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-tactical-text-muted">Pixels Created</p>
                  <p className="text-lg font-mono font-bold text-tactical-accent-blue">
                    {result.pixels_created.toLocaleString()}
                  </p>
                </div>
              </div>
              {result.duplicates > 0 && (
                <p className="text-xs font-mono text-yellow-400 mt-2">
                  {result.duplicates.toLocaleString()} duplicate buildings were skipped
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <TacticalButton
            variant="secondary"
            onClick={onClose}
            disabled={isImporting && !result}
            className="flex-1"
          >
            {result ? 'Close' : 'Cancel'}
          </TacticalButton>
          {!result && (
            <TacticalButton
              variant="primary"
              onClick={handleImport}
              disabled={isLoadingPreview || isImporting || buildingCount === null || buildingCount === 0 || !!previewError}
              className="flex-1"
            >
              {isImporting && !progress
                ? 'Fetching from Overture Maps...'
                : isImporting && progress && progress.batches_processed === 0
                ? 'Fetching from Overture Maps...'
                : isImporting && progress
                ? `Importing... (${progress.batches_processed} batches)`
                : 'Import Locations'}
            </TacticalButton>
          )}
        </div>
      </div>
    </TacticalModal>
  );
};

export default AddOvertureLocationsModal;
