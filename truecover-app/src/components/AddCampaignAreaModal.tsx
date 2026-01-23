import React, { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { campaignAreasApi } from '../services/api';
import {
  TacticalModal,
  TacticalButton,
  TacticalInput,
  TacticalBadge,
  tacticalToast
} from '../tactical-ui';

interface AddCampaignAreaModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  mode: 'admin_boundary' | 'drawn';
  adminBoundary?: {
    pcode: string;
    name: string;
  } | null;
  drawnGeometry?: any;
  onAreaAdded?: () => void;
}

const AddCampaignAreaModal: React.FC<AddCampaignAreaModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  mode,
  adminBoundary,
  drawnGeometry,
  onAreaAdded
}) => {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computePixels, setComputePixels] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      // Add the area
      const areaData: any = {
        area_type: mode,
        name: name.trim() || undefined
      };

      if (mode === 'admin_boundary' && adminBoundary) {
        areaData.pcode = adminBoundary.pcode;
      } else if (mode === 'drawn' && drawnGeometry) {
        areaData.geometry = drawnGeometry;
      }

      const result = await campaignAreasApi.add(campaignId, areaData, token);

      // Optionally compute pixels immediately
      if (computePixels && result.id) {
        try {
          const pixelResult = await campaignAreasApi.computePixels(result.id, token);
          tacticalToast.success(`Area added with ${pixelResult.pixels_computed.toLocaleString()} pixels`);
        } catch (pixelErr: any) {
          console.error('Failed to compute pixels:', pixelErr);
          tacticalToast.warning('Area added, but pixel computation failed. You can retry later.');
        }
      } else {
        tacticalToast.success('Area added to campaign');
      }

      setName('');
      onClose();
      onAreaAdded?.();
    } catch (err: any) {
      console.error('Failed to add area:', err);
      setError(err.response?.data?.error || 'Failed to add area');
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    setName('');
    setError(null);
    onClose();
  };

  return (
    <TacticalModal
      title={mode === 'admin_boundary' ? 'Add Admin Boundary' : 'Add Drawn Area'}
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

        {mode === 'admin_boundary' && adminBoundary && (
          <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
            <span className="text-xs text-tactical-text-dim uppercase tracking-wider">
              Admin Boundary
            </span>
            <p className="text-sm text-tactical-text-primary font-bold mt-1">
              {adminBoundary.name}
            </p>
            <p className="text-xs text-tactical-text-muted mt-1">
              Code: {adminBoundary.pcode}
            </p>
          </div>
        )}

        {mode === 'drawn' && drawnGeometry && (
          <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
            <span className="text-xs text-tactical-text-dim uppercase tracking-wider">
              Drawn Area
            </span>
            <p className="text-sm text-tactical-text-primary font-bold mt-1">
              Custom polygon
            </p>
            <p className="text-xs text-tactical-text-muted mt-1">
              Type: {drawnGeometry.type}
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="areaName"
            className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
          >
            Area Name (Optional)
          </label>
          <TacticalInput
            type="text"
            value={name}
            onChange={setName}
            placeholder={mode === 'admin_boundary' ? adminBoundary?.name : 'Enter area name'}
            disabled={isAdding}
          />
          <p className="text-xs text-tactical-text-muted mt-1">
            Leave blank to use the default name
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="computePixels"
            checked={computePixels}
            onChange={(e) => setComputePixels(e.target.checked)}
            className="w-4 h-4"
          />
          <label htmlFor="computePixels" className="text-sm text-tactical-text-secondary">
            Compute pixels immediately
          </label>
        </div>
        <p className="text-xs text-tactical-text-muted -mt-2 ml-6">
          This will find all global pixels that intersect this area
        </p>

        <div className="flex gap-3 justify-end pt-2">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isAdding}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="submit"
            variant="primary"
            disabled={isAdding || (mode === 'admin_boundary' && !adminBoundary) || (mode === 'drawn' && !drawnGeometry)}
          >
            {isAdding ? (
              <span className="tactical-loading-dots">
                Adding<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              'Add Area'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default AddCampaignAreaModal;
