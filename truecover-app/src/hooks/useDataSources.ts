// ABOUTME: React Query hooks for managing data sources
// ABOUTME: Provides hooks for listing and fetching data source configurations

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { dataSourcesApi } from '../services/api';

/**
 * Hook to fetch all data sources
 */
export function useDataSources() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['data-sources'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return dataSourcesApi.list(token);
    },
    enabled: isSignedIn,
    staleTime: 300000, // Fresh for 5 minutes
    gcTime: 600000, // Keep in cache for 10 minutes
  });
}

/**
 * Hook to fetch a single data source by ID
 */
export function useDataSource(id: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['data-sources', id],
    queryFn: async () => {
      if (!id) {
        throw new Error('Data source ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return dataSourcesApi.get(id, token);
    },
    enabled: !!id && isSignedIn,
    staleTime: 300000,
    gcTime: 600000,
  });
}
