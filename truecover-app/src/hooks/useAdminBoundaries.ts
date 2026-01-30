// ABOUTME: React Query hooks for fetching admin boundary data
// ABOUTME: Provides hooks for divisions, districts, and child boundaries

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { adminBoundariesApi } from '../services/api';

interface AdminBoundaryChild {
  pcode: string;
  name: string;
  level: number;
  parent_pcode: string;
  population: number;
}

/**
 * Hook to fetch child boundaries for a given pcode
 */
export function useAdminBoundaryChildren(pcode: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['adminBoundaryChildren', pcode],
    queryFn: async (): Promise<AdminBoundaryChild[]> => {
      if (!pcode) {
        throw new Error('PCODE is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      const response = await adminBoundariesApi.getChildren(pcode, token);
      return response.children;
    },
    enabled: !!pcode && isSignedIn,
    staleTime: 600000, // Fresh for 10 minutes (rarely changes)
    gcTime: 1800000, // Keep in cache for 30 minutes
  });
}

/**
 * Hook to fetch Bangladesh divisions (adm1 level)
 */
export function useDivisions() {
  return useAdminBoundaryChildren('BD');
}

/**
 * Hook to fetch districts for a given division
 */
export function useDistricts(divisionPcode: string | undefined) {
  return useAdminBoundaryChildren(divisionPcode);
}

/**
 * Hook to fetch upazilas for a given district
 */
export function useUpazilas(districtPcode: string | undefined) {
  return useAdminBoundaryChildren(districtPcode);
}
