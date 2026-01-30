import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { indicatorsApi } from '../services/api';

/**
 * Hook to fetch all indicators for a project
 */
export function useIndicators(projectId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['indicators', projectId],
    queryFn: async () => {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return indicatorsApi.list(projectId, token);
    },
    enabled: !!projectId && isSignedIn,
    staleTime: 300000, // Fresh for 5 minutes
    gcTime: 600000, // Keep in cache for 10 minutes
  });
}

/**
 * Hook to fetch a single indicator
 */
export function useIndicator(indicatorId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['indicator', indicatorId],
    queryFn: async () => {
      if (!indicatorId) {
        throw new Error('Indicator ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return indicatorsApi.get(indicatorId, token);
    },
    enabled: !!indicatorId && isSignedIn,
    staleTime: 300000,
    gcTime: 600000,
  });
}

/**
 * Hook to create an indicator
 */
export function useCreateIndicator() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      name,
      description
    }: {
      projectId: string;
      name: string;
      description: string
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return indicatorsApi.create(projectId, name, description, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate indicators list for this project
      queryClient.invalidateQueries({ queryKey: ['indicators', variables.projectId] });
    },
  });
}

/**
 * Hook to update an indicator
 */
export function useUpdateIndicator() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      indicatorId,
      name,
      description
    }: {
      indicatorId: string;
      projectId: string;
      name: string;
      description: string
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return indicatorsApi.update(indicatorId, name, description, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate both the list and the specific indicator
      queryClient.invalidateQueries({ queryKey: ['indicators', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['indicator', variables.indicatorId] });
    },
  });
}

/**
 * Hook to delete an indicator
 */
export function useDeleteIndicator() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ indicatorId }: { indicatorId: string; projectId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return indicatorsApi.delete(indicatorId, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate indicators list for this project
      queryClient.invalidateQueries({ queryKey: ['indicators', variables.projectId] });
    },
  });
}
