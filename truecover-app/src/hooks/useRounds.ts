import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

interface Round {
  id: string;
  round_number: number;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  location_count: number;
  pixel_count: number;
  sampling_target: string;
}

export const useRounds = (campaignId: string | undefined) => {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['rounds', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        return [];
      }

      const token = await getToken();
      const response = await axios.get<{ rounds: Round[] }>(
        `${API_URL}/api/campaigns/${campaignId}/rounds`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data.rounds || [];
    },
    enabled: !!campaignId,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
};
