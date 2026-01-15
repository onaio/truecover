import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { organizationsApi } from '../services/api';

/**
 * Hook to fetch all organizations
 */
export function useOrganizations() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return organizationsApi.list(token);
    },
    enabled: isSignedIn,
  });
}

/**
 * Hook to fetch a single organization
 */
export function useOrganization(orgId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['organizations', orgId],
    queryFn: async () => {
      if (!orgId) {
        throw new Error('Organization ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return organizationsApi.get(orgId, token);
    },
    enabled: !!orgId && isSignedIn,
  });
}

/**
 * Hook to create an organization
 */
export function useCreateOrganization() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return organizationsApi.create(name, token);
    },
    onSuccess: () => {
      // Invalidate and refetch organizations list
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

/**
 * Hook to update an organization
 */
export function useUpdateOrganization() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return organizationsApi.update(id, name, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate both the list and the specific organization
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', variables.id] });
    },
  });
}

/**
 * Hook to delete an organization
 */
export function useDeleteOrganization() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return organizationsApi.delete(id, token);
    },
    onSuccess: () => {
      // Invalidate organizations list
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}
