import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { campaignsApi } from '../services/api';

/**
 * Hook to fetch all campaigns for a project
 */
export function useCampaigns(projectId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['campaigns', projectId],
    queryFn: async () => {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return campaignsApi.list(projectId, token);
    },
    enabled: !!projectId && isSignedIn,
    staleTime: 300000, // Fresh for 5 minutes
    gcTime: 600000, // Keep in cache for 10 minutes
  });
}

/**
 * Hook to fetch a single campaign
 */
export function useCampaign(campaignId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('Campaign ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return campaignsApi.get(campaignId, token);
    },
    enabled: !!campaignId && isSignedIn,
    staleTime: 300000,
    gcTime: 600000,
  });
}

/**
 * Hook to create a campaign
 */
export function useCreateCampaign() {
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

      return campaignsApi.create(projectId, name, description, token);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', variables.projectId] });
    },
  });
}

/**
 * Hook to update a campaign
 */
export function useUpdateCampaign() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      campaignId,
      name,
      description
    }: {
      campaignId: string;
      projectId: string;
      name: string;
      description: string
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return campaignsApi.update(campaignId, name, description, token);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['campaign', variables.campaignId] });
    },
  });
}

/**
 * Hook to delete a campaign
 */
export function useDeleteCampaign() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campaignId }: { campaignId: string; projectId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return campaignsApi.delete(campaignId, token);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', variables.projectId] });
    },
  });
}
