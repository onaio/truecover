import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface VisitIndicator {
  id: string;
  visit_id: string;
  location_id: string;
  indicator_id: string;
  n_trials: number;
  n_positive: number;
  created_at: string;
  updated_at: string;
}

interface CreateVisitIndicatorParams {
  visit_id: string;
  location_id: string;
  indicator_id: string;
  n_trials: number;
  n_positive: number;
}

interface BulkCreateVisitIndicatorsParams {
  indicators: CreateVisitIndicatorParams[];
}

interface UpdateVisitIndicatorParams {
  indicatorId: string;
  visitId: string;
  n_trials?: number;
  n_positive?: number;
}

/**
 * Hook to fetch all indicators for a visit
 */
export function useVisitIndicators(visitId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['visitIndicators', visitId],
    queryFn: async () => {
      if (!visitId) {
        throw new Error('Visit ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.get(
        `${API_URL}/api/visits/${visitId}/indicators`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data.indicators as VisitIndicator[];
    },
    enabled: !!visitId && isSignedIn,
  });
}

/**
 * Hook to fetch a single visit indicator
 */
export function useVisitIndicator(indicatorId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['visitIndicator', indicatorId],
    queryFn: async () => {
      if (!indicatorId) {
        throw new Error('Indicator ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.get(
        `${API_URL}/api/visit-indicators/${indicatorId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data as VisitIndicator;
    },
    enabled: !!indicatorId && isSignedIn,
  });
}

/**
 * Hook to create a single visit indicator
 */
export function useCreateVisitIndicator() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateVisitIndicatorParams) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.post(
        `${API_URL}/api/visit-indicators`,
        params,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data as VisitIndicator;
    },
    onSuccess: (data) => {
      // Invalidate visit indicators list
      queryClient.invalidateQueries({ queryKey: ['visitIndicators', data.visit_id] });
    },
  });
}

/**
 * Hook to create multiple visit indicators at once
 */
export function useBulkCreateVisitIndicators() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: BulkCreateVisitIndicatorsParams) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.post(
        `${API_URL}/api/visit-indicators/bulk`,
        params,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.indicators as VisitIndicator[];
    },
    onSuccess: (data) => {
      // Invalidate visit indicators list for the visit
      if (data.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['visitIndicators', data[0].visit_id] });
      }
    },
  });
}

/**
 * Hook to update a visit indicator
 */
export function useUpdateVisitIndicator() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateVisitIndicatorParams) => {
      const { indicatorId, visitId, ...updateData } = params;
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.put(
        `${API_URL}/api/visit-indicators/${indicatorId}`,
        updateData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data as VisitIndicator;
    },
    onSuccess: (data, variables) => {
      // Invalidate both the list and the specific indicator
      queryClient.invalidateQueries({ queryKey: ['visitIndicators', variables.visitId] });
      queryClient.invalidateQueries({ queryKey: ['visitIndicator', data.id] });
    },
  });
}

/**
 * Hook to delete a visit indicator
 */
export function useDeleteVisitIndicator() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ indicatorId }: { indicatorId: string; visitId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      await axios.delete(
        `${API_URL}/api/visit-indicators/${indicatorId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate visit indicators list
      queryClient.invalidateQueries({ queryKey: ['visitIndicators', variables.visitId] });
    },
  });
}
