import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CustomLocation {
  path: string;
  cacheEnabled?: boolean;
  cacheDuration?: string;
  cacheMaxSize?: string;
  proxyBuffering?: boolean;
  customDirectives?: string;
}

export interface NginxConfigData {
  clientMaxBodySize: number;
  proxyReadTimeout: number;
  proxySendTimeout: number;
  proxyConnectTimeout: number;
  gzipEnabled: boolean;
  gzipMinLength: number;
  gzipTypes: string;
  proxyBuffering: boolean;
  proxyBufferSize: string;
  proxyBuffers: string;
  customLocations: CustomLocation[];
}

export interface NginxConfigResponse {
  config: NginxConfigData;
  preview: string | null;
}

export function useNginxConfig(projectId: string) {
  return useQuery({
    queryKey: ['nginx-config', projectId],
    queryFn: () => api<NginxConfigResponse>(`/projects/${projectId}/nginx-config`),
  });
}

export function useUpdateNginxConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<NginxConfigData>) =>
      api<NginxConfigResponse>(`/projects/${projectId}/nginx-config`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nginx-config', projectId] }),
  });
}
