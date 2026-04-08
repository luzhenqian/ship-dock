'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ImportItem {
  id: string;
  importId: string;
  sourceName: string;
  projectId?: string;
  status: string;
  config: Record<string, any>;
  stages: { name: string; status: string; error?: string }[];
  errorMessage?: string;
}

export interface Import {
  id: string;
  status: string;
  sourceType: string;
  manifestData: any;
  packageKey?: string;
  totalProjects: number;
  errorMessage?: string;
  items: ImportItem[];
  createdAt: string;
  updatedAt: string;
}

export function useImport(importId: string | null) {
  return useQuery({
    queryKey: ['import', importId],
    queryFn: () => api<Import>(`/imports/${importId}`),
    enabled: !!importId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'RUNNING' || status === 'PENDING') return 2000;
      return false;
    },
  });
}

export function useCreateImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { sourceType: 'CLI_PACKAGE' | 'REMOTE' }) =>
      api<Import>('/imports', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import'] }),
  });
}

export function useSubmitImportConfig(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: any[]) =>
      api<Import>(`/imports/${importId}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import', importId] }),
  });
}

export function useStartImport(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<Import>(`/imports/${importId}/start`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import', importId] }),
  });
}

export function useCancelImport(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<Import>(`/imports/${importId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import', importId] }),
  });
}

export function useGenerateImportToken() {
  return useMutation({
    mutationFn: () =>
      api<{ token: string }>('/imports/token', { method: 'POST' }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (data: { type: string; [key: string]: any }) =>
      api<{ success: boolean; error?: string }>('/imports/test-connection', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}
