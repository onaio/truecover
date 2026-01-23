// ABOUTME: React Query hooks for managing pixel enrichment jobs
// ABOUTME: Provides hooks for creating jobs and checking their status

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { enrichmentApi } from '../services/api';

/**
 * Hook to create an enrichment job
 */
export function useCreateEnrichmentJob() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      campaignId,
      dataSourceId,
      statistic
    }: {
      campaignId: string;
      dataSourceId: string;
      statistic?: string;
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return enrichmentApi.createJob(
        campaignId,
        { data_source_id: dataSourceId, statistic },
        token
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate enrichment jobs list for this area
      queryClient.invalidateQueries({ queryKey: ['enrichment-jobs', variables.campaignId] });
    },
  });
}

/**
 * Hook to fetch enrichment job status
 */
export function useEnrichmentJob(jobId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['enrichment-jobs', jobId],
    queryFn: async () => {
      if (!jobId) {
        throw new Error('Job ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return enrichmentApi.getJob(jobId, token);
    },
    enabled: !!jobId && isSignedIn,
    refetchInterval: (query) => {
      // Poll every 2 seconds if job is pending or processing
      const data = query.state.data;
      if (data && (data.status === 'pending' || data.status === 'processing')) {
        return 2000;
      }
      return false;
    },
  });
}

/**
 * Hook to list enrichment jobs for an area
 */
export function useEnrichmentJobs(campaignId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['enrichment-jobs', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('Area ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return enrichmentApi.listJobs(campaignId, token);
    },
    enabled: !!campaignId && isSignedIn,
    refetchInterval: (query) => {
      // Poll every 2 seconds if any jobs are pending or processing
      const data = query.state.data;
      if (data?.jobs && data.jobs.some((job: any) =>
        job.status === 'pending' || job.status === 'processing'
      )) {
        return 2000;
      }
      return false;
    },
  });
}
