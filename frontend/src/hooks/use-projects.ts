'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api('/projects') });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ['projects', id], queryFn: () => api(`/projects/${id}`) });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api('/projects', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useStopProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/projects/${id}/stop`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useRestartProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/projects/${id}/restart`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
