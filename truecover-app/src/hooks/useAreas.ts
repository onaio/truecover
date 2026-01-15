import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { areasApi } from '../services/api';

/**
 * Hook to fetch all areas for a project
 */
export function useAreas(projectId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['areas', projectId],
    queryFn: async () => {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return areasApi.list(projectId, token);
    },
    enabled: !!projectId && isSignedIn,
  });
}

/**
 * Hook to fetch a single area
 */
export function useArea(areaId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['area', areaId],
    queryFn: async () => {
      if (!areaId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return areasApi.get(areaId, token);
    },
    enabled: !!areaId && isSignedIn,
  });
}

/**
 * Hook to create an area
 */
export function useCreateArea() {
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

      return areasApi.create(projectId, name, description, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate areas list for this project
      queryClient.invalidateQueries({ queryKey: ['areas', variables.projectId] });
    },
  });
}

/**
 * Hook to update an area
 */
export function useUpdateArea() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      areaId,
      name,
      description
    }: {
      areaId: string;
      projectId: string;
      name: string;
      description: string
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return areasApi.update(areaId, name, description, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate both the list and the specific area
      queryClient.invalidateQueries({ queryKey: ['areas', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['area', variables.areaId] });
    },
  });
}

/**
 * Hook to delete an area
 */
export function useDeleteArea() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ areaId }: { areaId: string; projectId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return areasApi.delete(areaId, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate areas list for this project
      queryClient.invalidateQueries({ queryKey: ['areas', variables.projectId] });
    },
  });
}
