'use client';
import { use, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useProjectTask, useTaskRuns, useTriggerTaskRun,
} from '@/hooks/use-project-tasks';

const statusDot: Record<string, string> = {
  SUCCESS: 'bg-status-ready',
  FAILED: 'bg-status-error',
  RUNNING: 'bg-status-building',
  QUEUED: 'bg-foreground-muted',
  CANCELLED: 'bg-foreground-muted',
};

function timeAgo(s: string): string {
  const sec = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmt(d: number | null) {
  if (d === null) return '';
  if (d < 60) return `${d}s`;
  return `${Math.floor(d / 60)}m ${d % 60}s`;
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id: projectId, taskId } = use(params);
  const router = useRouter();
  const { data: task } = useProjectTask(projectId, taskId);
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useTaskRuns(projectId, taskId);
  const trigger = useTriggerTaskRun(projectId, taskId);
  const runs = data?.pages.flatMap((p) => p.items) ?? [];

  const sentinel = useRef<HTMLDivElement>(null);
  const onSee = useCallback((es: IntersectionObserverEntry[]) => {
    if (es[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const o = new IntersectionObserver(onSee, { threshold: 0 });
    o.observe(el);
    return () => o.disconnect();
  }, [onSee]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}/tasks`} className="text-foreground-muted hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h2 className="text-xl font-medium tracking-tight">{task?.name ?? '…'}</h2>
        </div>
        <Button
          onClick={async () => {
            const r = await trigger.mutateAsync();
            router.push(`/projects/${projectId}/tasks/${taskId}/runs/${r.id}`);
          }}
          disabled={trigger.isPending}
        >
          <Play className="h-4 w-4 mr-1.5" />
          {trigger.isPending ? 'Starting…' : 'Run'}
        </Button>
      </div>

      {task && (
        <div className="mb-6 border rounded-xl p-4 space-y-2">
          <div>
            <span className="text-xs text-foreground-muted">Command</span>
            <code className="block mt-1 font-mono text-sm">{task.command}</code>
          </div>
          {task.workDir && (
            <div>
              <span className="text-xs text-foreground-muted">Working directory</span>
              <div className="mt-1 font-mono text-sm">{task.workDir}</div>
            </div>
          )}
        </div>
      )}

      <h3 className="text-sm font-medium mb-3">Runs</h3>
      {runs.length === 0 && <p className="text-sm text-foreground-muted">No runs yet.</p>}
      <div className="border rounded-xl divide-y">
        {runs.map((r) => (
          <Link
            key={r.id}
            href={`/projects/${projectId}/tasks/${taskId}/runs/${r.id}`}
            className="flex items-center px-5 py-3 hover:bg-foreground/[0.03] transition-colors"
          >
            <span className={`h-[7px] w-[7px] rounded-full mr-3 ${statusDot[r.status]}`} />
            <span className="text-sm w-24">{r.status}</span>
            <span className="text-xs text-foreground-muted flex-1">
              {timeAgo(r.createdAt)}{r.triggeredBy ? ` · ${r.triggeredBy.name}` : ''}
            </span>
            {r.duration !== null && r.duration !== undefined && (
              <span className="text-xs font-mono text-foreground-muted">{fmt(r.duration)}</span>
            )}
          </Link>
        ))}
      </div>
      <div ref={sentinel} className="h-8" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 border-2 border-foreground-muted border-t-foreground rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
