'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskFormDialog } from '@/components/task-form-dialog';
import {
  useProjectTasks, useCreateProjectTask, useTriggerTaskRun, useDeleteProjectTask, useUpdateProjectTask,
  type ProjectTask,
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

// Edit dialog is its own component so the update hook only runs when a task is selected.
// This keeps hook order stable across renders.
function EditTaskDialog({ task, projectId, onClose }: {
  task: ProjectTask;
  projectId: string;
  onClose: () => void;
}) {
  const update = useUpdateProjectTask(projectId, task.id);
  return (
    <TaskFormDialog
      open={true}
      onOpenChange={(v) => { if (!v) onClose(); }}
      initial={{ name: task.name, command: task.command, workDir: task.workDir }}
      title="Edit Task"
      submitLabel="Save"
      onSubmit={async (values) => { await update.mutateAsync(values); }}
    />
  );
}

function TaskRow({
  projectId, task, onEdit, onDelete, onRun,
}: {
  projectId: string;
  task: ProjectTask;
  onEdit: () => void;
  onDelete: () => void;
  onRun: (runId: string) => void;
}) {
  const trigger = useTriggerTaskRun(projectId, task.id);
  const lr = task.latestRun;

  return (
    <div className="flex items-center px-5 py-4 hover:bg-foreground/[0.03] transition-colors">
      <Link href={`/projects/${projectId}/tasks/${task.id}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="font-medium text-sm">{task.name}</span>
          {lr && (
            <>
              <span className={`h-[7px] w-[7px] rounded-full ${statusDot[lr.status] ?? 'bg-foreground-muted'}`} />
              <span className="text-xs text-foreground-muted">
                {lr.status} · {timeAgo(lr.createdAt)}{lr.triggeredBy ? ` · ${lr.triggeredBy.name}` : ''}
              </span>
            </>
          )}
          {!lr && <span className="text-xs text-foreground-muted">Never run</span>}
        </div>
        <code className="text-xs text-foreground-secondary font-mono truncate block">{task.command}</code>
      </Link>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <Button
          size="sm"
          onClick={async () => {
            const run = await trigger.mutateAsync();
            onRun(run.id);
          }}
          disabled={trigger.isPending}
        >
          <Play className="h-3.5 w-3.5 mr-1" />
          {trigger.isPending ? 'Starting…' : 'Run'}
        </Button>
        <button onClick={onEdit} className="p-1.5 rounded hover:bg-foreground/10 text-xs">Edit</button>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-foreground/10 text-xs text-destructive">Delete</button>
      </div>
    </div>
  );
}

export default function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { data: tasks, isLoading } = useProjectTasks(projectId);
  const create = useCreateProjectTask(projectId);
  const del = useDeleteProjectTask(projectId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectTask | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium tracking-tight">Tasks</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> New Task
        </Button>
      </div>

      {isLoading && (
        <div className="border rounded-xl divide-y">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-5 py-4 space-y-2">
              <div className="h-4 w-32 bg-muted/40 rounded animate-pulse" />
              <div className="h-3 w-64 bg-muted/30 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && tasks && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <p className="text-foreground-secondary mb-2">No tasks yet</p>
          <p className="text-foreground-muted text-sm mb-4">Create one-off commands like seeding or cache clearing.</p>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Task
          </Button>
        </div>
      )}

      {!isLoading && tasks && tasks.length > 0 && (
        <div className="border rounded-xl overflow-hidden divide-y">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              projectId={projectId}
              task={t}
              onEdit={() => setEditing(t)}
              onDelete={async () => {
                if (!confirm(`Delete task "${t.name}"?\nThis will also delete all of its run history.`)) return;
                await del.mutateAsync(t.id);
              }}
              onRun={(runId) => router.push(`/projects/${projectId}/tasks/${t.id}/runs/${runId}`)}
            />
          ))}
        </div>
      )}

      <TaskFormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New Task"
        submitLabel="Create"
        onSubmit={async (values) => { await create.mutateAsync(values); }}
      />

      {editing && (
        <EditTaskDialog
          task={editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
