import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Organization } from '../types';
import { organizationsApi } from '../services/api';
import { TacticalSelect, TacticalButton, TacticalCard } from '../tactical-ui';

interface OrganizationSelectorProps {
  selectedOrganization: Organization | null;
  onOrganizationChange: (org: Organization | null) => void;
  onCreateClick: () => void;
  onRefresh?: (refreshFn: () => Promise<void>) => void;
}

const OrganizationSelector: React.FC<OrganizationSelectorProps> = ({
  selectedOrganization,
  onOrganizationChange,
  onCreateClick,
  onRefresh
}) => {
  const { getToken } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrganizations();
    // Expose the refresh function to the parent
    if (onRefresh) {
      onRefresh(loadOrganizations);
    }
  }, []);

  const loadOrganizations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      const orgs = await organizationsApi.list(token);
      setOrganizations(orgs);

      // Auto-select first org if none selected
      if (!selectedOrganization && orgs.length > 0) {
        onOrganizationChange(orgs[0]);
      }
    } catch (err: any) {
      console.error('Failed to load organizations:', err);
      setError(err.response?.data?.error || 'Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (value: string) => {
    if (value === '') {
      onOrganizationChange(null);
    } else {
      const org = organizations.find(o => o.id === value);
      onOrganizationChange(org || null);
    }
  };

  if (error) {
    return (
      <TacticalCard variant="secondary" padding="sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-tactical-accent-red">{error}</span>
          <TacticalButton size="sm" variant="secondary" onClick={loadOrganizations}>
            Retry
          </TacticalButton>
        </div>
      </TacticalCard>
    );
  }

  // Build options for TacticalSelect
  const selectOptions = [
    { value: '', label: 'Select Organization' },
    ...organizations.map(org => ({
      value: org.id,
      label: org.name
    }))
  ];

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <TacticalSelect
          value={selectedOrganization?.id || ''}
          onChange={handleChange}
          options={selectOptions}
          disabled={isLoading}
        />
      </div>
      <TacticalButton
        variant="primary"
        size="sm"
        onClick={onCreateClick}
      >
        + New Org
      </TacticalButton>
    </div>
  );
};

export default OrganizationSelector;
