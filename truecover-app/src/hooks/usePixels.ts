// ABOUTME: React Query hooks for managing quadkey pixels
// ABOUTME: Provides hooks for generating, fetching stats, and deleting pixels per area

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { pixelsApi } from '../services/api';

/**
 * Hook to fetch pixel statistics for a specific area
 */
export function usePixelStats(campaignId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['pixels', 'stats', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.getStats(campaignId, token);
    },
    enabled: !!campaignId && isSignedIn,
    staleTime: 60000, // Fresh for 1 minute
    gcTime: 300000, // Keep in cache for 5 minutes
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
      campaignId,
      bbox,
      level,
      append,
      admin_pcode
    }: {
      campaignId: string;
      bbox: [number, number, number, number];
      level: number;
      append?: boolean;
      admin_pcode?: string;
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.generate(campaignId, bbox, level, token, append, admin_pcode);
    },
    onSuccess: (_, variables) => {
      // Invalidate pixels queries for this area
      queryClient.invalidateQueries({ queryKey: ['pixels', 'stats', variables.campaignId] });
      queryClient.invalidateQueries({ queryKey: ['pixels', variables.campaignId] });
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
    mutationFn: async ({ campaignId }: { campaignId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.delete(campaignId, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate pixels queries for this area
      queryClient.invalidateQueries({ queryKey: ['pixels', 'stats', variables.campaignId] });
      queryClient.invalidateQueries({ queryKey: ['pixels', variables.campaignId] });
    },
  });
}

/**
 * Hook to fetch pixel metadata statistics for an area
 */
export function usePixelMetadataStats(campaignId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['pixels', 'metadata-stats', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return pixelsApi.getMetadataStats(campaignId, token);
    },
    enabled: !!campaignId && isSignedIn,
    staleTime: 60000,
    gcTime: 300000,
  });
}
