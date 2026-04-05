import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// === Connections ===

export function useAnalyticsConnections() {
  return useQuery({
    queryKey: ['analytics', 'connections'],
    queryFn: () => api('/analytics/connections'),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/analytics/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['analytics', 'connections'] }),
  });
}

// === GA4 Admin ===

export function useGa4Accounts(connectionId: string | null) {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'accounts', connectionId],
    queryFn: () => api(`/analytics/ga4/accounts?connectionId=${connectionId}`),
    enabled: !!connectionId,
  });
}

export function useGa4Properties(
  connectionId: string | null,
  accountId: string | null,
) {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'properties', connectionId, accountId],
    queryFn: () =>
      api(
        `/analytics/ga4/properties?connectionId=${connectionId}&accountId=${accountId}`,
      ),
    enabled: !!connectionId && !!accountId,
  });
}

export function useGa4Streams(
  connectionId: string | null,
  propertyId: string | null,
) {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'streams', connectionId, propertyId],
    queryFn: () =>
      api(
        `/analytics/ga4/streams?connectionId=${connectionId}&propertyId=${propertyId}`,
      ),
    enabled: !!connectionId && !!propertyId,
  });
}

export function useCreateGa4Property() {
  return useMutation({
    mutationFn: (data: {
      connectionId: string;
      accountId: string;
      displayName: string;
      timeZone?: string;
      currencyCode?: string;
    }) =>
      api('/analytics/ga4/properties', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useCreateGa4Stream() {
  return useMutation({
    mutationFn: (data: {
      connectionId: string;
      propertyId: string;
      displayName: string;
      defaultUri: string;
    }) =>
      api('/analytics/ga4/streams', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

// === Clarity Admin ===

export function useClarityProjects(connectionId: string | null) {
  return useQuery({
    queryKey: ['analytics', 'clarity', 'projects', connectionId],
    queryFn: () =>
      api(`/analytics/clarity/projects?connectionId=${connectionId}`),
    enabled: !!connectionId,
  });
}

export function useCreateClarityProject() {
  return useMutation({
    mutationFn: (data: {
      connectionId: string;
      name: string;
      siteUrl: string;
    }) =>
      api('/analytics/clarity/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

// === Integrations ===

export function useProjectIntegrations(projectId: string) {
  return useQuery({
    queryKey: ['analytics', 'integrations', projectId],
    queryFn: () => api(`/analytics/integrations/${projectId}`),
  });
}

export function useCreateIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      ...data
    }: {
      projectId: string;
      connectionId: string;
      provider: string;
      ga4PropertyId?: string;
      ga4StreamId?: string;
      measurementId?: string;
      clarityProjectId?: string;
      clarityTrackingCode?: string;
    }) =>
      api(`/analytics/integrations/${projectId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({
        queryKey: ['analytics', 'integrations', variables.projectId],
      }),
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      integrationId,
    }: {
      projectId: string;
      integrationId: string;
    }) =>
      api(`/analytics/integrations/${projectId}/${integrationId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, variables) =>
      qc.invalidateQueries({
        queryKey: ['analytics', 'integrations', variables.projectId],
      }),
  });
}

// === GA4 Reports ===

export function useGa4Dimensions() {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'dimensions'],
    queryFn: () => api('/analytics/ga4/dimensions'),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useGa4Metrics() {
  return useQuery({
    queryKey: ['analytics', 'ga4', 'metrics'],
    queryFn: () => api('/analytics/ga4/metrics'),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useRunReport() {
  return useMutation({
    mutationFn: ({
      projectId,
      ...query
    }: {
      projectId: string;
      dimensions: string[];
      metrics: string[];
      startDate: string;
      endDate: string;
      limit?: number;
    }) =>
      api(`/analytics/integrations/${projectId}/reports`, {
        method: 'POST',
        body: JSON.stringify(query),
      }),
  });
}

export function useRealtimeReport(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', 'realtime', projectId],
    queryFn: () => api(`/analytics/integrations/${projectId}/realtime`),
    enabled,
    refetchInterval: 30000,
  });
}
