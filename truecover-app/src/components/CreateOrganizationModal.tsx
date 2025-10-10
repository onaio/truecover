import React, { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Organization } from '../types';
import { organizationsApi } from '../services/api';
import { TacticalModal, TacticalInput, TacticalButton, TacticalBadge } from '../tactical-ui';

interface CreateOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrganizationCreated: (org: Organization) => void;
}

const CreateOrganizationModal: React.FC<CreateOrganizationModalProps> = ({
  isOpen,
  onClose,
  onOrganizationCreated
}) => {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Organization name is required');
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

      const newOrg = await organizationsApi.create(name.trim(), token);
      onOrganizationCreated(newOrg);
      setName('');
      onClose();
    } catch (err: any) {
      console.error('Failed to create organization:', err);
      setError(err.response?.data?.error || 'Failed to create organization');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setError(null);
    onClose();
  };

  return (
    <TacticalModal
      title="Create Organization"
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

        <div>
          <label
            htmlFor="orgName"
            className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2"
          >
            Organization Name
          </label>
          <TacticalInput
            id="orgName"
            type="text"
            value={name}
            onChange={setName}
            placeholder="Enter organization name"
            disabled={isLoading}
          />
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <TacticalButton
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            type="submit"
            variant="primary"
            disabled={isLoading || !name.trim()}
          >
            {isLoading ? (
              <span className="tactical-loading-dots">
                CREATING<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              'Create Organization'
            )}
          </TacticalButton>
        </div>
      </form>
    </TacticalModal>
  );
};

export default CreateOrganizationModal;
