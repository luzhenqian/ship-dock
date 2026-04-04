'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDeployments(projectId: string) {
  return useQuery({ queryKey: ['deployments', projectId], queryFn: () => api(`/projects/${projectId}/deployments`) });
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
