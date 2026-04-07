'use client';

import { use, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeployments, useTriggerDeploy } from '@/hooks/use-deployments';
import { useProject, useStopProject, useRestartProject } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { GitBranch, GitCommit, MoreHorizontal, Webhook, User } from 'lucide-react';

const statusConfig: Record<string, { dot: string; label: string }> = {
  SUCCESS: { dot: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]', label: 'Ready' },
  FAILED: { dot: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]', label: 'Error' },
  RUNNING: { dot: 'bg-status-building shadow-[0_0_6px_rgba(245,166,35,0.4)]', label: 'Building' },
  QUEUED: { dot: 'bg-foreground-muted', label: 'Queued' },
  CANCELLED: { dot: 'bg-foreground-muted', label: 'Cancelled' },
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function shortId(id: string): string {
  // Generate a Vercel-style short ID from the UUID
  return id.replace(/-/g, '').slice(0, 9);
}

export default function DeploymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { data: project } = useProject(projectId);
  const {
    data,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useDeployments(projectId);
  const triggerDeploy = useTriggerDeploy(projectId);
  const stopProject = useStopProject(projectId);
  const restartProject = useRestartProject(projectId);

  const isStopped = project?.status === 'STOPPED';
  const deployments = data?.pages.flatMap((p) => p.items) ?? [];

  // Find the latest successful deployment to mark as "Current"
  const currentDeploymentId = deployments.find((d: any) => d.status === 'SUCCESS')?.id;

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleIntersect, { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleIntersect]);

  const handleDeploy = () => {
    triggerDeploy.mutate(undefined, {
      onSuccess: (data) => {
        router.push(`/projects/${projectId}/deployments/${data.id}`);
      },
    });
  };

  const handleRestart = () => {
    restartProject.mutate(undefined, {
      onSuccess: () => {
        router.push(`/projects/${projectId}/logs`);
      },
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium tracking-tight">Deployments</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRestart}
            disabled={restartProject.isPending}
          >
            {restartProject.isPending ? 'Restarting...' : isStopped ? 'Start' : 'Restart'}
          </Button>
          <Button
            variant="outline"
            onClick={() => stopProject.mutate()}
            disabled={stopProject.isPending || isStopped}
          >
            {stopProject.isPending ? 'Stopping...' : 'Stop'}
          </Button>
          <Button onClick={handleDeploy} disabled={triggerDeploy.isPending}>
            {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-0 border rounded-xl overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 border-b last:border-0">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-20 bg-muted/40 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-muted/30 rounded animate-pulse" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-3.5 w-32 bg-muted/20 rounded animate-pulse" />
                </div>
              </div>
              <div className="h-4 w-24 bg-muted/20 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && deployments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <p className="text-foreground-secondary mb-4">No deployments yet</p>
          <Button onClick={handleDeploy} disabled={triggerDeploy.isPending}>
            {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
          </Button>
        </div>
      )}

      {deployments.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          {deployments.map((d: any, i: number) => {
            const config = statusConfig[d.status] || { dot: 'bg-foreground-muted', label: d.status };
            const isCurrent = d.id === currentDeploymentId;

            return (
              <Link
                key={d.id}
                href={`/projects/${projectId}/deployments/${d.id}`}
                className={`group flex items-center px-5 py-4 hover:bg-foreground/[0.03] transition-colors ${
                  i < deployments.length - 1 ? 'border-b' : ''
                }`}
              >
                {/* Left section: deployment info */}
                <div className="flex-1 min-w-0">
                  {/* Row 1: ID, environment, status */}
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="font-medium text-sm">{shortId(d.id)}</span>
                    <span className="text-xs text-foreground-secondary">Production</span>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 bg-blue-400/10 border border-blue-400/20 px-1.5 py-0.5 rounded-full">
                        Current
                      </span>
                    )}
                    <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${config.dot}`} />
                    <span className="text-sm">{config.label}</span>
                    {d.duration !== null && (
                      <span className="text-xs text-foreground-muted font-mono">{formatDuration(d.duration)}</span>
                    )}
                  </div>
                  {/* Row 2: trigger source + branch + commit */}
                  <div className="flex items-center gap-3 text-xs text-foreground-muted">
                    {d.webhookEvent ? (
                      <span className="inline-flex items-center gap-1" title={`Triggered by ${d.webhookEvent.provider} webhook`}>
                        <Webhook className="h-3 w-3" />
                        {d.webhookEvent.provider.toLowerCase()}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1" title="Manual deployment">
                        <User className="h-3 w-3" />
                        manual
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      main
                    </span>
                    {d.commitHash && (
                      <span className="inline-flex items-center gap-1">
                        <GitCommit className="h-3 w-3" />
                        {d.commitHash.slice(0, 7)}
                        {d.commitMessage && (
                          <span className="text-foreground-secondary ml-0.5 truncate max-w-[300px]">{d.commitMessage}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right section: time + author + menu */}
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className="text-xs text-foreground-muted whitespace-nowrap">
                    {timeAgo(d.createdAt)}
                    {d.triggeredBy && <> by {d.triggeredBy.name}</>}
                  </span>
                  <button
                    className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-foreground/10 transition-all"
                    onClick={(e) => e.preventDefault()}
                  >
                    <MoreHorizontal className="h-4 w-4 text-foreground-muted" />
                  </button>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 border-2 border-foreground-muted border-t-foreground rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
