'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface StaticFile {
  id: string;
  path: string;
  content: string;
  updatedAt: string;
}

export function useStaticFiles(projectId: string) {
  return useQuery<StaticFile[]>({
    queryKey: ['static-files', projectId],
    queryFn: () => api(`/projects/${projectId}/static-files`),
  });
}

export function useUpsertStaticFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api(`/projects/${projectId}/static-files`, {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['static-files', projectId] }),
  });
}

export function useDeleteStaticFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api(`/projects/${projectId}/static-files/${encodeURIComponent(path)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['static-files', projectId] }),
  });
}
