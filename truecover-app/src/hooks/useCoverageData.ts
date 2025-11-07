// ABOUTME: React Query hooks for managing coverage data
// ABOUTME: Provides hooks for fetching location and pixel coverage data with caching

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';
import { CoverageRecord, CoveragePixelRecord } from './useCoverage';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface CoverageDataParams {
  area_id: string;
  indicator_id: string;
  round_id?: string;
}

interface CoverageDataResult {
  locationData: CoverageRecord[];
  pixelData: CoveragePixelRecord[];
}

/**
 * Fetch both location and pixel coverage data for an area and indicator
 */
async function fetchCoverageData(
  params: CoverageDataParams,
  token: string
): Promise<CoverageDataResult> {
  // Build query string
  const queryParams = new URLSearchParams();
  queryParams.append('indicator_id', params.indicator_id);
  if (params.round_id) {
    queryParams.append('round_id', params.round_id);
  }

  const queryString = queryParams.toString();
  const baseUrl = `${API_URL}/api/areas/${params.area_id}`;

  // Fetch both location and pixel coverage data in parallel
  const [locationResponse, pixelResponse] = await Promise.all([
    axios.get(`${baseUrl}/coverage?${queryString}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    axios.get(`${baseUrl}/coverage_pixel?${queryString}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  return {
    locationData: locationResponse.data.coverage || [],
    pixelData: pixelResponse.data.coverage_pixel || [],
  };
}

/**
 * Hook to fetch coverage data for a specific area and indicator
 * Automatically deduplicates requests and caches results
 */
export function useCoverageData(
  areaId: string | undefined,
  indicatorId: string | undefined,
  roundId?: string | undefined,
  refreshKey?: number
) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['coverage', areaId, indicatorId, roundId, refreshKey],
    queryFn: async () => {
      if (!areaId || !indicatorId) {
        throw new Error('Area ID and Indicator ID are required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return fetchCoverageData(
        {
          area_id: areaId,
          indicator_id: indicatorId,
          round_id: roundId,
        },
        token
      );
    },
    enabled: !!areaId && !!indicatorId && isSignedIn,
  });
}
