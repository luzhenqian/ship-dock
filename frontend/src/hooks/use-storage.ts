'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiRaw, getAccessToken } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export function useStorageBuckets(projectId: string) {
  return useQuery({
    queryKey: ['storage-buckets', projectId],
    queryFn: () => api(`/projects/${projectId}/storage/buckets`),
  });
}

export function useStorageObjects(projectId: string, bucket: string, prefix: string = '') {
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  params.set('delimiter', '/');

  return useQuery({
    queryKey: ['storage-objects', projectId, bucket, prefix],
    queryFn: () => api(`/projects/${projectId}/storage/buckets/${bucket}?${params}`),
    enabled: !!bucket,
  });
}

export function useUploadFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket, prefix, file }: { bucket: string; prefix: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      return apiRaw(`/projects/${projectId}/storage/buckets/${bucket}/upload${params}`, {
        method: 'POST',
        body: formData,
      }).then((res) => res.json());
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['storage-objects', projectId, vars.bucket] }),
  });
}

export function useDeleteFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      api(`/projects/${projectId}/storage/buckets/${bucket}/objects?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['storage-objects', projectId, vars.bucket] }),
  });
}

export function getDownloadUrl(projectId: string, bucket: string, key: string) {
  return `${API_URL}/projects/${projectId}/storage/buckets/${bucket}/download?key=${encodeURIComponent(key)}`;
}
