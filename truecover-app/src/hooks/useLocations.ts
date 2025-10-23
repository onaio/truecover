import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { locationsApi } from '../services/api';

/**
 * Hook to fetch locations for a specific area
 */
export function useLocations(areaId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['locations', areaId],
    queryFn: async () => {
      if (!areaId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return locationsApi.list(areaId, token);
    },
    enabled: !!areaId && isSignedIn,
  });
}

/**
 * Hook to upload locations
 */
export function useUploadLocations() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      areaId,
      file,
      config
    }: {
      areaId: string;
      file: File;
      config: {
        latColumn?: string;
        lngColumn?: string;
        externalIdColumn?: string;
      }
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return locationsApi.upload(areaId, file, config, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate and refetch locations for this area
      queryClient.invalidateQueries({ queryKey: ['locations', variables.areaId] });
    },
  });
}

/**
 * Hook to update a location
 */
export function useUpdateLocation() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      areaId,
      locationId,
      data
    }: {
      areaId: string;
      locationId: string;
      data: any
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return locationsApi.update(areaId, locationId, data, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate and refetch locations for this area
      queryClient.invalidateQueries({ queryKey: ['locations', variables.areaId] });
    },
  });
}

/**
 * Hook to delete a location
 */
export function useDeleteLocation() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      areaId,
      locationId
    }: {
      areaId: string;
      locationId: string
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return locationsApi.delete(areaId, locationId, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate and refetch locations for this area
      queryClient.invalidateQueries({ queryKey: ['locations', variables.areaId] });
    },
  });
}
