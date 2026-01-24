// ABOUTME: React Query hook for fetching campaign areas
// ABOUTME: Returns campaign areas with geometries for map display

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export interface CampaignArea {
  id: string;
  campaign_id: string;
  name: string | null;
  area_type: 'admin_boundary' | 'drawn';
  admin_boundary_id: string | null;
  admin_boundary_name: string | null;
  geometry: any | null;
  bbox: {
    min_lng: number;
    min_lat: number;
    max_lng: number;
    max_lat: number;
  } | null;
  pixel_count: number;
  total_population: number;
  building_count: number;
  division_name: string | null;
  district_name: string | null;
  upazila_name: string | null;
  union_name: string | null;
  created_at: string;
}

export const useCampaignAreas = (campaignId: string | undefined) => {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['campaignAreas', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        return [];
      }

      const token = await getToken();
      const response = await axios.get<{ areas: CampaignArea[] }>(
        `${API_URL}/api/campaigns/${campaignId}/areas`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data.areas || [];
    },
    enabled: !!campaignId,
    staleTime: 30000,
  });
};
