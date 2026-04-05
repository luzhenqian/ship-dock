'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDatabaseOverview(projectId: string) {
  return useQuery({
    queryKey: ['db-overview', projectId],
    queryFn: () => api(`/projects/${projectId}/database/overview`),
  });
}

export function useDatabaseTables(projectId: string) {
  return useQuery({
    queryKey: ['db-tables', projectId],
    queryFn: () => api(`/projects/${projectId}/database/tables`),
  });
}

export function useTableData(projectId: string, table: string, options?: { page?: number; pageSize?: number; sort?: string; order?: string }) {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', options.page.toString());
  if (options?.pageSize) params.set('pageSize', options.pageSize.toString());
  if (options?.sort) params.set('sort', options.sort);
  if (options?.order) params.set('order', options.order);

  return useQuery({
    queryKey: ['db-table-data', projectId, table, options],
    queryFn: () => api(`/projects/${projectId}/database/tables/${table}?${params}`),
    enabled: !!table,
  });
}

export function useTableStructure(projectId: string, table: string) {
  return useQuery({
    queryKey: ['db-table-structure', projectId, table],
    queryFn: () => api(`/projects/${projectId}/database/tables/${table}/structure`),
    enabled: !!table,
  });
}

export function useInsertRow(projectId: string, table: string) {
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      api(`/projects/${projectId}/database/tables/${table}/rows`, {
        method: 'POST',
        body: JSON.stringify({ data }),
      }),
  });
}

export function useDeleteRows(projectId: string, table: string) {
  return useMutation({
    mutationFn: (rows: Record<string, any>[]) =>
      api(`/projects/${projectId}/database/tables/${table}/rows`, {
        method: 'DELETE',
        body: JSON.stringify({ rows }),
      }),
  });
}

export function useUpdateRow(projectId: string, table: string) {
  return useMutation({
    mutationFn: (data: { primaryKeys: Record<string, any>; column: string; value: any }) =>
      api(`/projects/${projectId}/database/tables/${table}/rows`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  });
}

export function useExecuteQuery(projectId: string) {
  return useMutation({
    mutationFn: (sql: string) =>
      api(`/projects/${projectId}/database/query`, { method: 'POST', body: JSON.stringify({ sql }) }),
  });
}
