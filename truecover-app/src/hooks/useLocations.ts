import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { locationsApi } from '../services/api';
import axios from 'axios';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

/**
 * Hook to fetch locations for a specific area
 */
export function useLocations(campaignId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['locations', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return locationsApi.list(campaignId, token);
    },
    enabled: !!campaignId && isSignedIn,
    staleTime: 60000, // Fresh for 1 minute
    gcTime: 300000, // Keep in cache for 5 minutes
  });
}

/**
 * Hook to fetch locations with infinite scroll pagination
 */
export function useInfiniteLocations(campaignId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useInfiniteQuery({
    queryKey: ['locations-infinite', campaignId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!campaignId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.get(
        `${API_URL}/api/campaigns/${campaignId}/locations?limit=200&offset=${pageParam}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      return {
        locations: response.data.locations || [],
        total_count: response.data.total_count || 0,
      };
    },
    getNextPageParam: (lastPage, allPages) => {
      const hasMore = lastPage.locations.length === 200;
      return hasMore ? allPages.length * 200 : undefined;
    },
    initialPageParam: 0,
    enabled: !!campaignId && isSignedIn,
    staleTime: 60000,
    gcTime: 300000,
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
      campaignId,
      file,
      config
    }: {
      campaignId: string;
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

      return locationsApi.upload(campaignId, file, config, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate and refetch locations for this area
      queryClient.invalidateQueries({ queryKey: ['locations', variables.campaignId] });
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
      campaignId,
      locationId,
      data
    }: {
      campaignId: string;
      locationId: string;
      data: any
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return locationsApi.update(campaignId, locationId, data, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate and refetch locations for this area
      queryClient.invalidateQueries({ queryKey: ['locations', variables.campaignId] });
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
      campaignId,
      locationId
    }: {
      campaignId: string;
      locationId: string
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return locationsApi.delete(campaignId, locationId, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate and refetch locations for this area
      queryClient.invalidateQueries({ queryKey: ['locations', variables.campaignId] });
    },
  });
}
