import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { locationsApi } from '../services/api';
import { TacticalModal, TacticalButton, TacticalBadge } from '../tactical-ui';

interface Location {
  id: string;
  external_id?: string;
  latitude?: number;
  longitude?: number;
  properties?: Record<string, any>;
  quadkey?: string | null;
}

interface LocationEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  location: Location | null;
  areaId: string;
  onLocationUpdated: () => void;
  onLocationDeleted?: () => void;
}

const LocationEditModal: React.FC<LocationEditModalProps> = ({
  isOpen,
  onClose,
  location,
  areaId,
  onLocationUpdated,
  onLocationDeleted
}) => {
  const { getToken } = useAuth();
  const [externalId, setExternalId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (location) {
      setExternalId(location.external_id || '');
    }
  }, [location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!location) {
      setError('No location selected');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      const data: any = {};

      if (externalId.trim()) data.external_id = externalId.trim();

      await locationsApi.update(areaId, location.id, data, token);
      onLocationUpdated();
      handleClose();
    } catch (err: any) {
      console.error('Failed to update location:', err);
      setError(err.response?.data?.error || 'Failed to update location');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleDelete = async () => {
    if (!location) {
      setError('No location selected');
      return;
    }

    if (!confirm('Are you sure you want to delete this location? This action cannot be undone.')) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      await locationsApi.delete(areaId, location.id, token);

      if (onLocationDeleted) {
        onLocationDeleted();
      }
      handleClose();
    } catch (err: any) {
      console.error('Failed to delete location:', err);
      setError(err.response?.data?.error || 'Failed to delete location');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <TacticalModal
      title="Edit Location"
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

        {location && (
          <div className="p-3 border border-tactical-border-medium bg-tactical-bg-secondary">
            <span className="text-xs text-tactical-text-dim uppercase tracking-wider">
              Location Coordinates (Read-Only)
            </span>
            <p className="text-sm text-tactical-text-primary font-mono mt-1">
              Lat: {location.latitude?.toFixed(6)}, Lng: {location.longitude?.toFixed(6)}
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="externalId"
            className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
          >
            External ID
          </label>
          <input
            id="externalId"
            type="text"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            disabled={isLoading}
            className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50"
          />
        </div>

        <div className="flex gap-3 justify-between pt-2">
          <div>
            {onLocationDeleted && (
              <TacticalButton
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={isLoading || isDeleting}
              >
                {isDeleting ? (
                  <span className="tactical-loading-dots">
                    DELETING<span>.</span><span>.</span><span>.</span>
                  </span>
                ) : (
                  'Delete Location'
                )}
              </TacticalButton>
            )}
          </div>
          <div className="flex gap-3">
            <TacticalButton
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isLoading || isDeleting}
            >
              Cancel
            </TacticalButton>
            <TacticalButton
              type="submit"
              variant="primary"
              disabled={isLoading || isDeleting}
            >
              {isLoading ? (
                <span className="tactical-loading-dots">
                  SAVING<span>.</span><span>.</span><span>.</span>
                </span>
              ) : (
                'Save Changes'
              )}
            </TacticalButton>
          </div>
        </div>
      </form>
    </TacticalModal>
  );
};

export default LocationEditModal;
