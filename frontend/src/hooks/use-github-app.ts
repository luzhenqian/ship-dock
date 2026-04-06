'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface GitHubInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  createdAt: string;
  updatedAt: string;
}

interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
}

export function useGitHubInstallationUrl() {
  return useQuery<{ url: string }>({
    queryKey: ['github-installation-url'],
    queryFn: () => api('/github/installation-url'),
  });
}

export function useGitHubInstallations() {
  return useQuery<GitHubInstallation[]>({
    queryKey: ['github-installations'],
    queryFn: () => api('/github/installations'),
  });
}

export function useGitHubRepositories(installationId: number | null) {
  return useQuery<GitHubRepo[]>({
    queryKey: ['github-repos', installationId],
    queryFn: () => api(`/github/repositories?installationId=${installationId}`),
    enabled: !!installationId,
  });
}

export function useGitHubCallback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { installation_id: string; setup_action: string }) =>
      api(`/github/callback?installation_id=${params.installation_id}&setup_action=${params.setup_action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['github-installations'] }),
  });
}

export function useDeleteGitHubInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/github/installations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['github-installations'] }),
  });
}
