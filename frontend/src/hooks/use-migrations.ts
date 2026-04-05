'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiRaw } from '@/lib/api';

interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

interface SelectedTable {
  tableName: string;
  schemaName?: string;
}

interface CreateMigrationDto {
  source: 'REMOTE' | 'FILE';
  connection?: ConnectionConfig;
  fileKey?: string;
  fileName?: string;
  tables: SelectedTable[];
  conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP';
}

export function useMigrations(projectId: string) {
  return useQuery({
    queryKey: ['migrations', projectId],
    queryFn: () => api(`/projects/${projectId}/migrations`),
  });
}

export function useMigration(projectId: string, migrationId: string) {
  return useQuery({
    queryKey: ['migrations', projectId, migrationId],
    queryFn: () => api(`/projects/${projectId}/migrations/${migrationId}`),
    enabled: !!migrationId,
  });
}

export function useTestConnection(projectId: string) {
  return useMutation({
    mutationFn: (connection: ConnectionConfig) =>
      api(`/projects/${projectId}/migrations/test-connection`, {
        method: 'POST',
        body: JSON.stringify({ connection }),
      }),
  });
}

export function useDiscoverTables(projectId: string) {
  return useMutation({
    mutationFn: (connection: ConnectionConfig) =>
      api(`/projects/${projectId}/migrations/discover-tables`, {
        method: 'POST',
        body: JSON.stringify({ connection }),
      }),
  });
}

export function useUploadDump(projectId: string, onProgress?: (percent: number) => void) {
  return useMutation({
    mutationFn: (file: File) => {
      return new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
        xhr.open('POST', `${API_URL}/projects/${projectId}/migrations/upload`);

        const token = localStorage.getItem('access_token');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.withCredentials = true;

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed: network error'));

        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      });
    },
  });
}

export function useAnalyzeFile(projectId: string) {
  return useMutation({
    mutationFn: (fileKey: string) =>
      api(`/projects/${projectId}/migrations/analyze-file`, {
        method: 'POST',
        body: JSON.stringify({ fileKey }),
      }),
  });
}

export function useCreateMigration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateMigrationDto) =>
      api(`/projects/${projectId}/migrations`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migrations', projectId] }),
  });
}

export function useCancelMigration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (migrationId: string) =>
      api(`/projects/${projectId}/migrations/${migrationId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migrations', projectId] }),
  });
}
