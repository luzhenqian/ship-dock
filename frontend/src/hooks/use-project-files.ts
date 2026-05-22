import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiRaw, getAccessToken } from '@/lib/api';

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

interface FileListResponse {
  path: string;
  items: FileItem[];
}

interface FileStats {
  used: number;
  fileSizeLimit: number;
  fileTotalLimit: number;
}

export function useProjectFiles(projectId: string, path: string) {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  return useQuery<FileListResponse>({
    queryKey: ['project-files', projectId, path],
    queryFn: () => api(`/projects/${projectId}/files?${params}`),
  });
}

export function useProjectFileStats(projectId: string) {
  return useQuery<FileStats>({
    queryKey: ['project-file-stats', projectId],
    queryFn: () => api(`/projects/${projectId}/files/stats`),
  });
}

export function useProjectDirectories(projectId: string) {
  return useQuery<string[]>({
    queryKey: ['project-file-dirs', projectId],
    queryFn: () => api(`/projects/${projectId}/files/directories`),
  });
}

export function useUploadProjectFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, targetDir, extract }: { file: File; targetDir: string; extract: boolean }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (targetDir) formData.append('targetDir', targetDir);
      if (extract) formData.append('extract', 'true');
      return apiRaw(`/projects/${projectId}/files/upload`, {
        method: 'POST',
        body: formData,
      }).then((res) => res.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-files', projectId] });
      qc.invalidateQueries({ queryKey: ['project-file-stats', projectId] });
    },
  });
}

export function useUploadProjectFolder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, targetDir }: { files: File[]; targetDir: string }) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
        formData.append('paths', (file as any).webkitRelativePath || file.name);
      }
      if (targetDir) formData.append('targetDir', targetDir);
      return apiRaw(`/projects/${projectId}/files/upload-batch`, {
        method: 'POST',
        body: formData,
      }).then((res) => res.json());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-files', projectId] });
      qc.invalidateQueries({ queryKey: ['project-file-stats', projectId] });
    },
  });
}

export function useMkdir(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      return api(`/projects/${projectId}/files/mkdir`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-files', projectId] });
    },
  });
}

export function useDeleteProjectFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      return api(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-files', projectId] });
      qc.invalidateQueries({ queryKey: ['project-file-stats', projectId] });
    },
  });
}

export function useExtractArchive(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      return api(`/projects/${projectId}/files/extract`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-files', projectId] });
      qc.invalidateQueries({ queryKey: ['project-file-stats', projectId] });
    },
  });
}

export function getFileDownloadUrl(projectId: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  return `${base}/projects/${projectId}/files/download?path=${encodeURIComponent(path)}`;
}

const MAX_PREVIEW_SIZE = 512 * 1024; // 512KB

export function useFileContent(projectId: string, filePath: string | null) {
  return useQuery<string>({
    queryKey: ['project-file-content', projectId, filePath],
    enabled: !!filePath,
    queryFn: async () => {
      const url = getFileDownloadUrl(projectId, filePath!);
      const token = getAccessToken();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load file');
      const contentLength = res.headers.get('content-length');
      if (contentLength && Number(contentLength) > MAX_PREVIEW_SIZE) {
        throw new Error('File too large to preview');
      }
      return res.text();
    },
  });
}
