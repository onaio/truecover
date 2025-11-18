// ABOUTME: React Query hooks for managing coverage data
// ABOUTME: Provides hooks for fetching location and pixel coverage data with caching and pagination

import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';
import { CoverageRecord, CoveragePixelRecord } from './useCoverage';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface CoverageDataParams {
  area_id: string;
  indicator_id: string;
  round_id?: string;
  limit?: number;
  offset?: number;
}

interface CoverageDataResult {
  locationData: CoverageRecord[];
  pixelData: CoveragePixelRecord[];
  locationTotalCount: number;
  pixelTotalCount: number;
}

/**
 * Fetch both location and pixel coverage data for an area and indicator with pagination
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
  queryParams.append('limit', String(params.limit || 200));
  queryParams.append('offset', String(params.offset || 0));

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
    locationTotalCount: locationResponse.data.total_count || 0,
    pixelTotalCount: pixelResponse.data.total_count || 0,
  };
}

/**
 * Hook to fetch coverage data with infinite scroll pagination
 * Automatically loads more data as user scrolls
 */
export function useCoverageData(
  areaId: string | undefined,
  indicatorId: string | undefined,
  roundId?: string | undefined,
  refreshKey?: number
) {
  const { getToken, isSignedIn } = useAuth();

  return useInfiniteQuery({
    queryKey: ['coverage', areaId, indicatorId, roundId, refreshKey],
    queryFn: async ({ pageParam = 0 }) => {
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
          limit: 200,
          offset: pageParam,
        },
        token
      );
    },
    getNextPageParam: (lastPage, allPages) => {
      // If either location or pixel data returned full page, there may be more
      const hasMore = lastPage.locationData.length === 200 || lastPage.pixelData.length === 200;
      return hasMore ? allPages.length * 200 : undefined;
    },
    initialPageParam: 0,
    enabled: !!areaId && !!indicatorId && isSignedIn,
  });
}

/**
 * Hook to fetch all coverage data at once (no pagination) for charts/histograms
 */
export function useAllCoverageData(
  areaId: string | undefined,
  indicatorId: string | undefined,
  roundId?: string | undefined,
  refreshKey?: number
) {
  const { getToken, isSignedIn } = useAuth();

  return useInfiniteQuery({
    queryKey: ['allCoverage', areaId, indicatorId, roundId, refreshKey],
    queryFn: async ({ pageParam = 0 }) => {
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
          limit: 10000,
          offset: pageParam,
        },
        token
      );
    },
    getNextPageParam: (lastPage, allPages) => {
      // If either location or pixel data returned full page, there may be more
      const hasMore = lastPage.locationData.length === 10000 || lastPage.pixelData.length === 10000;
      return hasMore ? allPages.length * 10000 : undefined;
    },
    initialPageParam: 0,
    enabled: !!areaId && !!indicatorId && isSignedIn,
  });
}
