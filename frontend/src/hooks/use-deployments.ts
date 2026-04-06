'use client';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DeploymentListItem {
  id: string;
  version: number;
  status: string;
  commitHash: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  duration: number | null;
  triggeredBy: { id: string; name: string } | null;
}

interface DeploymentPage {
  items: DeploymentListItem[];
  nextCursor: string | null;
}

export function useDeployments(projectId: string) {
  return useInfiniteQuery({
    queryKey: ['deployments', projectId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      params.set('limit', '20');
      const qs = params.toString();
      return api<DeploymentPage>(`/projects/${projectId}/deployments?${qs}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useDeployment(deploymentId: string) {
  return useQuery({
    queryKey: ['deployment', deploymentId],
    queryFn: () => api(`/projects/_/deployments/${deploymentId}`),
    refetchInterval: (query) => {
      const data = query.state.data as any;
      return data?.status === 'RUNNING' || data?.status === 'QUEUED' ? 3000 : false;
    },
  });
}

export function useTriggerDeploy(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ id: string }>(`/projects/${projectId}/deployments`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments', projectId] }),
  });
}

export function useCancelDeploy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: string) => api(`/projects/_/deployments/${deploymentId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  });
}
