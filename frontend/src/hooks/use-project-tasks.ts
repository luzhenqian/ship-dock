'use client';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface TaskRunSummary {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  triggeredBy: { id: string; name: string } | null;
  duration?: number | null;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  name: string;
  command: string;
  workDir: string | null;
  createdAt: string;
  updatedAt: string;
  latestRun: TaskRunSummary | null;
}

export interface TaskRun extends TaskRunSummary {
  taskId: string;
  logs: { t: number; m: string }[];
}

export function useProjectTasks(projectId: string) {
  return useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: () => api<ProjectTask[]>(`/projects/${projectId}/tasks`),
  });
}

export function useProjectTask(projectId: string, taskId: string) {
  return useQuery({
    queryKey: ['project-task', projectId, taskId],
    queryFn: () => api<ProjectTask>(`/projects/${projectId}/tasks/${taskId}`),
  });
}

export function useCreateProjectTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; command: string; workDir?: string }) =>
      api<ProjectTask>(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-tasks', projectId] }),
  });
}

export function useUpdateProjectTask(projectId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<{ name: string; command: string; workDir: string }>) =>
      api<ProjectTask>(`/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-tasks', projectId] });
      qc.invalidateQueries({ queryKey: ['project-task', projectId, taskId] });
    },
  });
}

export function useDeleteProjectTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api<void>(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-tasks', projectId] }),
  });
}

export function useTriggerTaskRun(projectId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<TaskRunSummary>(`/projects/${projectId}/tasks/${taskId}/run`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-tasks', projectId] });
      qc.invalidateQueries({ queryKey: ['task-runs', projectId, taskId] });
    },
  });
}

export function useTaskRuns(projectId: string, taskId: string) {
  return useInfiniteQuery({
    queryKey: ['task-runs', projectId, taskId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      params.set('limit', '20');
      return api<{ items: TaskRunSummary[]; nextCursor: string | null }>(
        `/projects/${projectId}/tasks/${taskId}/runs?${params}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTaskRun(projectId: string, taskId: string, runId: string) {
  return useQuery({
    queryKey: ['task-run', runId],
    queryFn: () => api<TaskRun>(`/projects/${projectId}/tasks/${taskId}/runs/${runId}`),
    refetchInterval: (q) => {
      const data = q.state.data as any;
      return data?.status === 'RUNNING' || data?.status === 'QUEUED' ? 3000 : false;
    },
  });
}

export function useCancelTaskRun(projectId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api(`/projects/${projectId}/tasks/${taskId}/runs/${runId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-runs', projectId, taskId] }),
  });
}
