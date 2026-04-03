'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useServices(projectId: string) {
  return useQuery({
    queryKey: ['services', projectId],
    queryFn: () => api(`/projects/${projectId}/services`),
  });
}

export function useCreateService(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: string; name: string; config: Record<string, any> }) =>
      api(`/projects/${projectId}/services`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', projectId] }),
  });
}

export function useDeleteService(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) =>
      api(`/projects/${projectId}/services/${sid}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', projectId] }),
  });
}

export function useDetectServices(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}/services/detect`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', projectId] }),
  });
}

export function useTestService(projectId: string) {
  return useMutation({
    mutationFn: (sid: string) =>
      api(`/projects/${projectId}/services/${sid}/test`, { method: 'POST' }),
  });
}
