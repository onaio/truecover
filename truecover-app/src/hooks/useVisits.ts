import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface Visit {
  id: string;
  location_id: string;
  area_id: string;
  round_id: string;
  latitude: number | null;
  longitude: number | null;
  properties: any;
  created_at: string;
  updated_at: string;
}

interface CreateVisitParams {
  area_id: string;
  round_id: string;
  location_id?: string;
  latitude?: number;
  longitude?: number;
  properties?: any;
}

interface UpdateVisitParams {
  visitId: string;
  latitude?: number;
  longitude?: number;
  properties?: any;
}

/**
 * Hook to fetch all visits for a round
 */
export function useVisits(roundId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['visits', roundId],
    queryFn: async () => {
      if (!roundId) {
        throw new Error('Round ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.get(
        `${API_URL}/api/rounds/${roundId}/visits`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data.visits as Visit[];
    },
    enabled: !!roundId && isSignedIn,
  });
}

/**
 * Hook to fetch a single visit
 */
export function useVisit(visitId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['visit', visitId],
    queryFn: async () => {
      if (!visitId) {
        throw new Error('Visit ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.get(
        `${API_URL}/api/visits/${visitId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data as Visit;
    },
    enabled: !!visitId && isSignedIn,
  });
}

/**
 * Hook to create a visit
 */
export function useCreateVisit() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateVisitParams) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.post(
        `${API_URL}/api/visits`,
        params,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data as Visit;
    },
    onSuccess: (data) => {
      // Invalidate visits list for this round
      queryClient.invalidateQueries({ queryKey: ['visits', data.round_id] });
    },
  });
}

/**
 * Hook to update a visit
 */
export function useUpdateVisit() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateVisitParams) => {
      const { visitId, ...updateData } = params;
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await axios.put(
        `${API_URL}/api/visits/${visitId}`,
        updateData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data as Visit;
    },
    onSuccess: (data) => {
      // Invalidate both the list and the specific visit
      queryClient.invalidateQueries({ queryKey: ['visits', data.round_id] });
      queryClient.invalidateQueries({ queryKey: ['visit', data.id] });
    },
  });
}

/**
 * Hook to delete a visit
 */
export function useDeleteVisit() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ visitId }: { visitId: string; roundId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      await axios.delete(
        `${API_URL}/api/visits/${visitId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate visits list for this round
      queryClient.invalidateQueries({ queryKey: ['visits', variables.roundId] });
    },
  });
}
