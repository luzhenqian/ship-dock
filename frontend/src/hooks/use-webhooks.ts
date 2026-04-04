'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface WebhookConfig {
  id: string;
  projectId: string;
  enabled: boolean;
  events: string[];
  branchFilters: string[];
  pathFilters: string[];
  provider: string;
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface WebhookEvent {
  id: string;
  projectId: string;
  provider: string;
  deliveryId: string;
  event: string;
  action: string | null;
  headers: Record<string, string>;
  payload: any;
  status: string;
  filterReason: string | null;
  deploymentId: string | null;
  deployment: { id: string; version: number; status: string } | null;
  error: string | null;
  processedAt: string | null;
  createdAt: string;
}

interface WebhookEventsResponse {
  events: WebhookEvent[];
  total: number;
  page: number;
  limit: number;
}

export function useWebhookConfig(projectId: string) {
  return useQuery<WebhookConfig>({
    queryKey: ['webhook-config', projectId],
    queryFn: () => api(`/projects/${projectId}/webhooks`),
    retry: false,
  });
}

export function useCreateWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { githubToken: string; events: string[]; branchFilters?: string[]; pathFilters?: string[]; secret?: string }) =>
      api<WebhookConfig & { secret: string }>(`/projects/${projectId}/webhooks`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-config', projectId] }),
  });
}

export function useUpdateWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { events?: string[]; branchFilters?: string[]; pathFilters?: string[]; enabled?: boolean; githubToken?: string }) =>
      api(`/projects/${projectId}/webhooks`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-config', projectId] }),
  });
}

export function useDeleteWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/projects/${projectId}/webhooks`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-config', projectId] }),
  });
}

export function useRegenerateSecret(projectId: string) {
  return useMutation({
    mutationFn: () => api<{ secret: string }>(`/projects/${projectId}/webhooks/regenerate-secret`, { method: 'POST' }),
  });
}

export function useWebhookEvents(projectId: string, status?: string, page = 1) {
  return useQuery<WebhookEventsResponse>({
    queryKey: ['webhook-events', projectId, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status) params.set('status', status);
      return api(`/projects/${projectId}/webhooks/events?${params}`);
    },
  });
}

export function useWebhookEvent(eventId: string) {
  return useQuery<WebhookEvent>({
    queryKey: ['webhook-event', eventId],
    queryFn: () => api(`/projects/_/webhooks/events/${eventId}`),
    enabled: !!eventId,
  });
}

export function useReplayWebhookEvent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => api(`/projects/${projectId}/webhooks/events/${eventId}/replay`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-events', projectId] }),
  });
}
