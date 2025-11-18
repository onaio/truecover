// ABOUTME: Modal for importing building locations from Overture Maps for an admin boundary
// ABOUTME: Previews building count, handles import, and displays results

import React, { useState, useEffect } from 'react';
import { TacticalModal, TacticalButton, tacticalToast } from '../tactical-ui';
import { adminBoundariesApi } from '../services/api';
import { useAuth } from '@clerk/clerk-react';

interface AddOvertureLocationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  areaName: string;
  adminBoundary: { pcode: string; name: string } | null;
  onImportComplete?: () => void;
}

const AddOvertureLocationsModal: React.FC<AddOvertureLocationsModalProps> = ({
  isOpen,
  onClose,
  areaId,
  areaName,
  adminBoundary,
  onImportComplete
}) => {
  const { getToken } = useAuth();
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [buildingCount, setBuildingCount] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Load preview when modal opens
  useEffect(() => {
    if (isOpen && adminBoundary) {
      loadPreview();
    } else {
      // Reset state when modal closes
      setBuildingCount(null);
      setPreviewError(null);
    }
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
        areaId,
        token
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

  const handleImport = async () => {
    if (!adminBoundary || buildingCount === null || buildingCount === 0) return;

    setIsImporting(true);

    try {
      const token = await getToken();
      if (!token) {
        tacticalToast.error('Authentication Error', 'Authentication required');
        return;
      }

      const result = await adminBoundariesApi.importOvertureBuildings(
        adminBoundary.pcode,
        areaId,
        token
      );

      // Show success message
      tacticalToast.success(
        'Locations Imported',
        `Added ${result.inserted.toLocaleString()} buildings (${result.duplicates.toLocaleString()} duplicates skipped, ${result.pixels_created.toLocaleString()} pixels created)`
      );

      // Call completion callback
      if (onImportComplete) {
        onImportComplete();
      }

      onClose();
    } catch (error: any) {
      console.error('Error importing buildings:', error);
      tacticalToast.error('Import Failed', error.response?.data?.error || 'Failed to import buildings from Overture Maps');
    } finally {
      setIsImporting(false);
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
            Admin Boundary
          </p>
          <p className="text-sm font-mono text-tactical-text-secondary">
            {adminBoundary.name} ({adminBoundary.pcode})
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

        {!isLoadingPreview && !previewError && buildingCount !== null && (
          <div className="p-4 border border-tactical-border-medium bg-tactical-bg-secondary">
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
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <TacticalButton
            variant="secondary"
            onClick={onClose}
            disabled={isImporting}
            className="flex-1"
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            variant="primary"
            onClick={handleImport}
            disabled={isLoadingPreview || isImporting || buildingCount === null || buildingCount === 0 || !!previewError}
            className="flex-1"
          >
            {isImporting ? 'Importing...' : 'Import Locations'}
          </TacticalButton>
        </div>
      </div>
    </TacticalModal>
  );
};

export default AddOvertureLocationsModal;
