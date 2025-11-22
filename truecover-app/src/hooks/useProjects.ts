import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { projectsApi } from '../services/api';
import { Project } from '../types';

/**
 * Hook to fetch all projects for an organization
 */
export function useProjects(orgId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['projects', orgId],
    queryFn: async () => {
      if (!orgId) {
        throw new Error('Organization ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return projectsApi.list(orgId, token);
    },
    enabled: !!orgId && isSignedIn,
  });
}

/**
 * Hook to fetch a single project
 */
export function useProject(projectId: string | undefined) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return projectsApi.get(projectId, token);
    },
    enabled: !!projectId && isSignedIn,
  });
}

/**
 * Hook to create a project
 */
export function useCreateProject() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      title,
      description
    }: {
      orgId: string;
      title: string;
      description: string
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return projectsApi.create(orgId, title, description, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate projects list for this organization
      queryClient.invalidateQueries({ queryKey: ['projects', variables.orgId] });
    },
  });
}

/**
 * Hook to update a project
 */
export function useUpdateProject() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      orgId,
      data
    }: {
      projectId: string;
      orgId: string;
      data: {
        title?: string;
        description?: string;
        odk_api_key?: string | null;
        odk_host_url?: string | null;
      }
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return projectsApi.update(projectId, data, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate both the list and the specific project
      queryClient.invalidateQueries({ queryKey: ['projects', variables.orgId] });
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
    },
  });
}

/**
 * Hook to delete a project
 */
export function useDeleteProject() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, orgId }: { projectId: string; orgId: string }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication token not available');
      }

      return projectsApi.delete(projectId, token);
    },
    onSuccess: (_, variables) => {
      // Invalidate projects list for this organization
      queryClient.invalidateQueries({ queryKey: ['projects', variables.orgId] });
    },
  });
}
