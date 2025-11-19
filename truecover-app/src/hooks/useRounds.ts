import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

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

export const useRounds = (areaId: string | undefined) => {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['rounds', areaId],
    queryFn: async () => {
      if (!areaId) {
        return [];
      }

      const token = await getToken();
      const response = await axios.get<{ rounds: Round[] }>(
        `${API_URL}/api/areas/${areaId}/rounds`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data.rounds || [];
    },
    enabled: !!areaId,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
};
