'use client';
import { use, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTaskRun, useCancelTaskRun } from '@/hooks/use-project-tasks';
import { useTaskRunLogs } from '@/hooks/use-task-run-logs';
import { DeployLogViewer } from '@/components/deploy-log-viewer';

const statusDot: Record<string, string> = {
  SUCCESS: 'bg-status-ready',
  FAILED: 'bg-status-error',
  RUNNING: 'bg-status-building',
  QUEUED: 'bg-foreground-muted',
  CANCELLED: 'bg-foreground-muted',
};

export default function RunPage({ params }: { params: Promise<{ id: string; taskId: string; runId: string }> }) {
  const { id: projectId, taskId, runId } = use(params);
  const { data: run } = useTaskRun(projectId, taskId, runId);
  const cancel = useCancelTaskRun(projectId, taskId);

  // Persisted logs come from the run row; live logs come from the socket.
  const initial = useMemo(() => run?.logs ?? [], [run?.id]);
  const { logs: liveLogs, status: liveStatus } = useTaskRunLogs(runId, initial);

  const status = liveStatus ?? run?.status;
  const isLive = status === 'RUNNING' || status === 'QUEUED';

  // Adapt {t, m} to DeployLogViewer's expected shape {stage, line, t}
  const viewerLogs = useMemo(
    () => liveLogs.map((entry) => ({ stage: 'task', line: entry.m, t: entry.t })),
    [liveLogs],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}/tasks/${taskId}`} className="text-foreground-muted hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-[7px] w-[7px] rounded-full ${statusDot[status ?? 'QUEUED']}`} />
              <span className="text-base font-medium">{status ?? '…'}</span>
              {run?.exitCode !== null && run?.exitCode !== undefined && (
                <span className="text-xs text-foreground-muted">exit {run.exitCode}</span>
              )}
            </div>
            <p className="text-xs text-foreground-muted">
              Run {runId.slice(0, 8)}{run?.triggeredBy ? ` · ${run.triggeredBy.name}` : ''}
            </p>
          </div>
        </div>
        {isLive && (
          <Button variant="outline" onClick={() => cancel.mutate(runId)} disabled={cancel.isPending}>
            <X className="h-4 w-4 mr-1.5" />
            {cancel.isPending ? 'Cancelling…' : 'Cancel'}
          </Button>
        )}
      </div>

      <DeployLogViewer logs={viewerLogs} />
    </div>
  );
}
