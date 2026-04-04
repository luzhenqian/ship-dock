'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useRedisKeys(projectId: string, pattern: string = '*', cursor: string = '0') {
  return useQuery({
    queryKey: ['redis-keys', projectId, pattern, cursor],
    queryFn: () => {
      const params = new URLSearchParams({ pattern, cursor, count: '50' });
      return api(`/projects/${projectId}/redis/keys?${params}`);
    },
  });
}

export function useRedisKeyDetail(projectId: string, key: string) {
  return useQuery({
    queryKey: ['redis-key', projectId, key],
    queryFn: () => api(`/projects/${projectId}/redis/keys/detail?key=${encodeURIComponent(key)}`),
    enabled: !!key,
  });
}

export function useCreateRedisKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { key: string; type: string; value: any; ttl?: number }) =>
      api(`/projects/${projectId}/redis/keys`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['redis-keys', projectId] }),
  });
}

export function useUpdateRedisKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value, ttl }: { key: string; value: any; ttl?: number }) =>
      api(`/projects/${projectId}/redis/keys/update?key=${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value, ttl }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['redis-key', projectId] }),
  });
}

export function useDeleteRedisKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      api(`/projects/${projectId}/redis/keys/delete?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['redis-keys', projectId] }),
  });
}

export function useRedisCommand(projectId: string) {
  return useMutation({
    mutationFn: (command: string) =>
      api(`/projects/${projectId}/redis/command`, { method: 'POST', body: JSON.stringify({ command }) }),
  });
}
