'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface StorageConnection {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  useSSL?: boolean;
}

interface DiscoverParams {
  connection: StorageConnection;
  bucket: string;
  prefix?: string;
}

interface CreateStorageImportDto {
  source: 'REMOTE' | 'UPLOAD' | 'URL';
  connection?: StorageConnection;
  sourceBucket?: string;
  sourcePrefix?: string;
  objects?: string[];
  urls?: string[];
  fileKeys?: string[];
  targetBucket: string;
  targetPrefix: string;
  conflictStrategy: 'OVERWRITE' | 'SKIP' | 'ERROR';
}

export function useTestStorageConnection(projectId: string) {
  return useMutation({
    mutationFn: (connection: StorageConnection) =>
      api(`/projects/${projectId}/storage/import/test-connection`, {
        method: 'POST',
        body: JSON.stringify({ connection }),
      }),
  });
}

export function useDiscoverStorageObjects(projectId: string) {
  return useMutation({
    mutationFn: (params: DiscoverParams) =>
      api(`/projects/${projectId}/storage/import/discover`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  });
}

export function useValidateUrls(projectId: string) {
  return useMutation({
    mutationFn: (urls: string[]) =>
      api(`/projects/${projectId}/storage/import/validate-urls`, {
        method: 'POST',
        body: JSON.stringify({ urls }),
      }),
  });
}

export function useUploadImportFiles(projectId: string, onProgress?: (percent: number) => void) {
  return useMutation({
    mutationFn: (files: File[]) => {
      return new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
        xhr.open('POST', `${API_URL}/projects/${projectId}/storage/import/upload`);

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
        files.forEach((file) => formData.append('files', file));
        xhr.send(formData);
      });
    },
  });
}

export function useCreateStorageImport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateStorageImportDto) =>
      api(`/projects/${projectId}/storage/import`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-objects', projectId] }),
  });
}

export function useCancelStorageImport(projectId: string) {
  return useMutation({
    mutationFn: (importId: string) =>
      api(`/projects/${projectId}/storage/import/${importId}/cancel`, { method: 'POST' }),
  });
}
