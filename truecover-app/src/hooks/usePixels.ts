// ABOUTME: React Query hooks for managing quadkey pixels
// ABOUTME: Provides hooks for generating, fetching stats, and deleting pixels per area

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { pixelsApi } from '../services/api';

/**
 * Hook to fetch pixel statistics for a specific area
 */
export function usePixelStats(areaId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['pixels', 'stats', areaId],
    queryFn: async () => {
      if (!areaId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.getStats(areaId, token);
    },
    enabled: !!areaId && isSignedIn,
  });
}

/**
 * Hook to generate pixels for an area
 */
export function useGeneratePixels() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      areaId,
      bbox,
      level
    }: {
      areaId: string;
      bbox: [number, number, number, number];
      level: number;
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.generate(areaId, bbox, level, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate pixels queries for this area
      queryClient.invalidateQueries({ queryKey: ['pixels', 'stats', variables.areaId] });
      queryClient.invalidateQueries({ queryKey: ['pixels', variables.areaId] });
    },
  });
}

/**
 * Hook to delete all pixels for an area
 */
export function useDeletePixels() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ areaId }: { areaId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.delete(areaId, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate pixels queries for this area
      queryClient.invalidateQueries({ queryKey: ['pixels', 'stats', variables.areaId] });
      queryClient.invalidateQueries({ queryKey: ['pixels', variables.areaId] });
    },
  });
}

/**
 * Hook to fetch pixel metadata statistics for an area
 */
export function usePixelMetadataStats(areaId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['pixels', 'metadata-stats', areaId],
    queryFn: async () => {
      if (!areaId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.getMetadataStats(areaId, token);
    },
    enabled: !!areaId && isSignedIn,
  });
}
