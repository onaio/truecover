import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { locationsApi } from '../services/api';
import { TacticalModal, TacticalButton, TacticalBadge, TacticalMultiSelect } from '../tactical-ui';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface Location {
  id: string;
  properties: {
    external_id?: string;
    latitude?: number;
    longitude?: number;
    exceedance_probability?: number;
    exceedance_uncertainty?: number;
    prevalence_bci_width?: number;
    prevalence_prediction?: number;
    rounds?: number[];
  };
}

interface Round {
  id: string;
  round_number: number;
  name: string;
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
  const [exceedanceProbability, setExceedanceProbability] = useState('');
  const [exceedanceUncertainty, setExceedanceUncertainty] = useState('');
  const [prevalenceBciWidth, setPrevalenceBciWidth] = useState('');
  const [prevalencePrediction, setPrevalencePrediction] = useState('');
  const [selectedRounds, setSelectedRounds] = useState<number[]>([]);
  const [availableRounds, setAvailableRounds] = useState<Round[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (location) {
      setExternalId(location.properties.external_id || '');
      setExceedanceProbability(location.properties.exceedance_probability?.toString() || '');
      setExceedanceUncertainty(location.properties.exceedance_uncertainty?.toString() || '');
      setPrevalenceBciWidth(location.properties.prevalence_bci_width?.toString() || '');
      setPrevalencePrediction(location.properties.prevalence_prediction?.toString() || '');
      setSelectedRounds(location.properties.rounds || []);
    }
  }, [location]);

  // Fetch available rounds when modal opens
  useEffect(() => {
    const fetchRounds = async () => {
      if (!isOpen || !areaId) return;

      try {
        const token = await getToken();
        if (!token) return;

        const response = await axios.get(
          `${API_URL}/api/areas/${areaId}/rounds`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        setAvailableRounds(response.data.rounds || []);
      } catch (err) {
        console.error('Failed to fetch rounds:', err);
      }
    };

    fetchRounds();
  }, [isOpen, areaId, getToken]);

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
      if (exceedanceProbability.trim()) data.exceedance_probability = parseFloat(exceedanceProbability);
      if (exceedanceUncertainty.trim()) data.exceedance_uncertainty = parseFloat(exceedanceUncertainty);
      if (prevalenceBciWidth.trim()) data.prevalence_bci_width = parseFloat(prevalenceBciWidth);
      if (prevalencePrediction.trim()) data.prevalence_prediction = parseFloat(prevalencePrediction);
      data.rounds = selectedRounds;

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
              Lat: {location.properties.latitude?.toFixed(6)}, Lng: {location.properties.longitude?.toFixed(6)}
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="exceedanceProbability"
              className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
            >
              Exceedance Probability
            </label>
            <input
              id="exceedanceProbability"
              type="number"
              step="0.01"
              value={exceedanceProbability}
              onChange={(e) => setExceedanceProbability(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50"
            />
          </div>
          <div>
            <label
              htmlFor="exceedanceUncertainty"
              className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
            >
              Exceedance Uncertainty
            </label>
            <input
              id="exceedanceUncertainty"
              type="number"
              step="0.01"
              value={exceedanceUncertainty}
              onChange={(e) => setExceedanceUncertainty(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="prevalenceBciWidth"
              className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
            >
              Prevalence BCI Width
            </label>
            <input
              id="prevalenceBciWidth"
              type="number"
              step="0.01"
              value={prevalenceBciWidth}
              onChange={(e) => setPrevalenceBciWidth(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50"
            />
          </div>
          <div>
            <label
              htmlFor="prevalencePrediction"
              className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
            >
              Prevalence Prediction
            </label>
            <input
              id="prevalencePrediction"
              type="number"
              step="0.01"
              value={prevalencePrediction}
              onChange={(e) => setPrevalencePrediction(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50"
            />
          </div>
        </div>

        <TacticalMultiSelect
          label="Rounds"
          options={availableRounds.map(round => ({
            value: round.round_number,
            label: `Round ${round.round_number}: ${round.name}`
          }))}
          value={selectedRounds}
          onChange={setSelectedRounds}
          disabled={isLoading}
          placeholder="Select rounds..."
        />

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
