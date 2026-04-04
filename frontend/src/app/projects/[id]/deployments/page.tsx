'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeployments, useTriggerDeploy } from '@/hooks/use-deployments';
import { useProject, useStopProject, useRestartProject } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';

const statusDot: Record<string, string> = {
  SUCCESS: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  FAILED: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
  RUNNING: 'bg-status-building shadow-[0_0_6px_rgba(245,166,35,0.4)]',
  QUEUED: 'bg-foreground-muted',
  CANCELLED: 'bg-foreground-muted',
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

export default function DeploymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { data: project } = useProject(projectId);
  const { data: deployments, isLoading } = useDeployments(projectId);
  const triggerDeploy = useTriggerDeploy(projectId);
  const stopProject = useStopProject(projectId);
  const restartProject = useRestartProject(projectId);

  const isStopped = project?.status === 'STOPPED';

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
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 border-b last:border-0 bg-muted/20 animate-pulse" />
          ))}
        </div>
      )}
      {deployments && deployments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <p className="text-foreground-secondary mb-4">No deployments yet</p>
          <Button onClick={handleDeploy} disabled={triggerDeploy.isPending}>
            {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
          </Button>
        </div>
      )}
      {deployments && deployments.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          {deployments.map((d: any, i: number) => (
            <Link
              key={d.id}
              href={`/projects/${projectId}/deployments/${d.id}`}
              className={`flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.04] transition-colors ${
                i < deployments.length - 1 ? 'border-b' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot[d.status] || 'bg-foreground-muted'}`} />
                <span className="font-mono text-[13px]">#{d.version}</span>
                <span className="text-[13px] text-foreground-secondary">{d.status.toLowerCase()}</span>
                {d.triggeredBy && (
                  <span className="text-[13px] text-foreground-muted">by {d.triggeredBy.name}</span>
                )}
              </div>
              <span className="text-[13px] text-foreground-muted">{timeAgo(d.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
