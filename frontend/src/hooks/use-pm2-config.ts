import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Pm2ConfigData {
  script: string | null;
  instances: number;
  execMode: string;
  maxMemoryRestart: string | null;
}

export interface Pm2ConfigInfo {
  name: string;
  cwd: string;
  port: number;
  detectedScript: string;
  envVars: Record<string, string>;
}

export interface Pm2ConfigResponse {
  config: Pm2ConfigData;
  info: Pm2ConfigInfo;
  preview: string;
}

export function usePm2Config(projectId: string) {
  return useQuery({
    queryKey: ['pm2-config', projectId],
    queryFn: () => api<Pm2ConfigResponse>(`/projects/${projectId}/pm2-config`),
  });
}

export function useUpdatePm2Config(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pm2ConfigData>) =>
      api<Pm2ConfigResponse>(`/projects/${projectId}/pm2-config`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pm2-config', projectId] }),
  });
}
