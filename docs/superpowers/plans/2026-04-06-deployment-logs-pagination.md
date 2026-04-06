# Deployment Logs & Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add timestamps to deployment logs (Vercel-style), paginate the deployment list with infinite scroll, and show deployment duration.

**Architecture:** Backend log entries change from `string` to `{ t: number; m: string }` objects. WebSocket log events also include timestamps. The deployment list endpoint gains cursor-based pagination. Frontend DeployLogViewer renders timestamps per line with color-coded error/warning backgrounds. Deployment list uses `useInfiniteQuery` with IntersectionObserver for infinite scroll.

**Tech Stack:** NestJS/Prisma (backend), Next.js/React/TanStack Query (frontend), xterm.js (log viewer), socket.io (real-time)

---

### Task 1: Backend — Add timestamps to log entries

**Files:**
- Modify: `backend/src/deploy/deploy.processor.ts:60-66` (onLog callback)
- Modify: `backend/src/deploy/deploy.processor.ts:208-221` (updateStageStatus)
- Modify: `backend/src/deploy/deploy.gateway.ts:35-37` (emitToDeployment — no change needed, passes data through)

- [ ] **Step 1: Update onLog to include timestamp**

In `backend/src/deploy/deploy.processor.ts`, change the `onLog` callback (lines 62-65) and `stageLogs` type:

```typescript
// line 61: change type
const stageLogs: Array<{ t: number; m: string }> = [];
const onLog = (line: string) => {
  const stageName = stage.name;
  const entry = { t: Date.now(), m: line };
  this.gateway.emitToDeployment(deploymentId, 'log', { index: i, stage: stageName, line, t: entry.t });
  stageLogs.push(entry);
};
```

- [ ] **Step 2: Verify updateStageStatus works with new log format**

`updateStageStatus` uses `stages[index].logs.push(...logs)` — since `logs` is now `Array<{ t: number; m: string }>` and the JSON column accepts any shape, no schema migration needed. The existing code at lines 208-221 works as-is because it just pushes into the JSON array.

- [ ] **Step 3: Commit**

```bash
git add backend/src/deploy/deploy.processor.ts
git commit -m "feat: add timestamps to deployment log entries"
```

---

### Task 2: Backend — Paginate deployment history & include duration

**Files:**
- Modify: `backend/src/deploy/deploy.controller.ts:15-16` (getHistory endpoint)
- Modify: `backend/src/deploy/deploy.service.ts:49-54` (getHistory method)

- [ ] **Step 1: Add Query decorator import and pagination params to controller**

In `backend/src/deploy/deploy.controller.ts`, add `Query` to imports and update the `getHistory` method:

```typescript
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
```

```typescript
@Get() @MinRole('VIEWER')
getHistory(
  @Param('projectId') projectId: string,
  @Query('cursor') cursor?: string,
  @Query('limit') limit?: string,
) {
  return this.deployService.getHistory(projectId, cursor, limit ? parseInt(limit) : undefined);
}
```

- [ ] **Step 2: Implement cursor-based pagination in service**

In `backend/src/deploy/deploy.service.ts`, replace the `getHistory` method (lines 49-54):

```typescript
async getHistory(projectId: string, cursor?: string, limit = 20) {
  const where: any = { projectId };
  if (cursor) {
    where.createdAt = { lt: (await this.prisma.deployment.findUnique({ where: { id: cursor }, select: { createdAt: true } }))?.createdAt };
  }
  const items = await this.prisma.deployment.findMany({
    where,
    orderBy: { version: 'desc' },
    take: limit + 1,
    include: { triggeredBy: { select: { id: true, name: true } } },
    // Exclude stages from list — they contain all log data and are only needed in detail view
    omit: { stages: true },
  });
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return {
    items: items.map((d) => ({
      ...d,
      duration: d.startedAt && d.finishedAt
        ? Math.round((d.finishedAt.getTime() - d.startedAt.getTime()) / 1000)
        : null,
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}
```

Note: Prisma's `omit` is available in Prisma 5.16+. If not supported, use `select` with all fields except stages instead.

- [ ] **Step 3: Commit**

```bash
git add backend/src/deploy/deploy.controller.ts backend/src/deploy/deploy.service.ts
git commit -m "feat: add cursor pagination and duration to deployment history"
```

---

### Task 3: Frontend — Update useDeployments hook for infinite scroll

**Files:**
- Modify: `frontend/src/hooks/use-deployments.ts:5-7` (useDeployments hook)

- [ ] **Step 1: Replace useQuery with useInfiniteQuery**

In `frontend/src/hooks/use-deployments.ts`, replace the `useDeployments` hook:

```typescript
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface DeploymentListItem {
  id: string;
  version: number;
  status: string;
  commitHash: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  duration: number | null;
  triggeredBy: { id: string; name: string } | null;
}

interface DeploymentPage {
  items: DeploymentListItem[];
  nextCursor: string | null;
}

export function useDeployments(projectId: string) {
  return useInfiniteQuery({
    queryKey: ['deployments', projectId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      params.set('limit', '20');
      const qs = params.toString();
      return api<DeploymentPage>(`/projects/${projectId}/deployments?${qs}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-deployments.ts
git commit -m "feat: switch useDeployments to useInfiniteQuery for pagination"
```

---

### Task 4: Frontend — Update deployment list page with infinite scroll & duration

**Files:**
- Modify: `frontend/src/app/projects/[id]/deployments/page.tsx` (full rewrite of list rendering)

- [ ] **Step 1: Update the deployments page**

Replace the entire content of `frontend/src/app/projects/[id]/deployments/page.tsx`:

```tsx
'use client';

import { use, useEffect, useRef, useCallback } from 'react';
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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
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
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 border-b last:border-0 bg-muted/20 animate-pulse" />
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
              <div className="flex items-center gap-4">
                {d.duration !== null && (
                  <span className="text-[13px] text-foreground-muted font-mono">{formatDuration(d.duration)}</span>
                )}
                <span className="text-[13px] text-foreground-muted">{timeAgo(d.createdAt)}</span>
              </div>
            </Link>
          ))}
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/[id]/deployments/page.tsx
git commit -m "feat: deployment list with infinite scroll and duration display"
```

---

### Task 5: Frontend — Update DeployLogViewer with Vercel-style timestamps

**Files:**
- Modify: `frontend/src/components/deploy-log-viewer.tsx` (timestamp rendering, color-coded backgrounds)
- Modify: `frontend/src/app/projects/[id]/deployments/[did]/page.tsx:34-52` (adapt log data extraction)
- Modify: `frontend/src/hooks/use-deploy-logs.ts:27-29` (include timestamp in log state)

- [ ] **Step 1: Update use-deploy-logs to include timestamp**

In `frontend/src/hooks/use-deploy-logs.ts`, update the log type and socket handler:

Change line 6:
```typescript
const [logs, setLogs] = useState<Array<{ stage: string; line: string; t?: number }>>([]);
```

Change the socket `log` handler (line 27-29):
```typescript
socket.on('log', (data: { index?: number; stage?: string; line: string; t?: number }) => {
  setLogs((prev) => [...prev, { stage: data.stage || `stage-${data.index}`, line: data.line, t: data.t }]);
});
```

- [ ] **Step 2: Update deployment detail page log extraction for new format**

In `frontend/src/app/projects/[id]/deployments/[did]/page.tsx`, update the `persistedLogs` memo (lines 34-45):

```typescript
const persistedLogs = useMemo(() => {
  if (!deployment?.stages) return [];
  const logs: Array<{ stage: string; line: string; t?: number }> = [];
  for (const stage of deployment.stages as any[]) {
    if (stage.logs && Array.isArray(stage.logs)) {
      for (const entry of stage.logs) {
        // Support both old format (string) and new format ({ t, m })
        if (typeof entry === 'string') {
          logs.push({ stage: stage.name, line: entry });
        } else {
          logs.push({ stage: stage.name, line: entry.m, t: entry.t });
        }
      }
    }
  }
  return logs;
}, [deployment?.stages]);
```

- [ ] **Step 3: Update DeployLogViewer props and rendering**

Replace `frontend/src/components/deploy-log-viewer.tsx` entirely:

```tsx
'use client';
import { useEffect, useRef, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface DeployLogViewerProps {
  logs: Array<{ stage: string; line: string; t?: number }>;
}

function formatTimestamp(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function DeployLogViewer({ logs }: DeployLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenCountRef = useRef(0);

  const stats = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const { line } of logs) {
      const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
      if (/\bwarn(ing)?\b/i.test(plain)) warnings++;
      else if (plain.includes('[stderr]') || plain.includes('Error') || plain.includes('error:') || plain.includes('FAILED')) errors++;
    }
    return { total: logs.length, errors, warnings };
  }, [logs]);

  // Initialize terminal once
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.4,
      scrollback: 50000,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        selectionBackground: '#ffffff40',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    writtenCountRef.current = 0;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      writtenCountRef.current = 0;
    };
  }, []);

  // Track which logs array identity we last wrote from
  const logsSourceRef = useRef(logs);

  // Write new logs incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (logsSourceRef.current !== logs && writtenCountRef.current > 0) {
      term.clear();
      writtenCountRef.current = 0;
    }
    logsSourceRef.current = logs;

    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const start = writtenCountRef.current;
    for (let i = start; i < logs.length; i++) {
      const { line, t } = logs[i];
      const plain = stripAnsi(line);
      const isWarning = /\bwarn(ing)?\b/i.test(plain);
      const isError = !isWarning && (plain.includes('[stderr]') || plain.includes('Error') || plain.includes('error:') || plain.includes('FAILED'));
      const isCommand = plain.startsWith('$ ');

      // Timestamp prefix (dim gray)
      const tsPrefix = t ? `\x1b[90m${formatTimestamp(t)}\x1b[0m   ` : '';

      if (isWarning) {
        // Yellow background, black text — like Vercel warning lines
        term.writeln(`${tsPrefix}\x1b[43;30m ${plain} \x1b[0m`);
      } else if (isError) {
        // Red background, white text — like Vercel error lines
        term.writeln(`${tsPrefix}\x1b[41m ${plain} \x1b[0m`);
      } else if (isCommand) {
        term.writeln(`${tsPrefix}\x1b[36m${plain}\x1b[0m`);
      } else {
        term.writeln(`${tsPrefix}${plain}`);
      }
    }
    writtenCountRef.current = logs.length;
  }, [logs]);

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Stats bar — like Vercel's top bar with line count, errors, warnings */}
      <div className="flex items-center gap-4 px-4 py-2 bg-[#0a0a0a] border-b border-border/50 text-[13px] font-mono">
        <span className="text-foreground-muted">{stats.total} lines</span>
        {stats.errors > 0 && (
          <span className="text-status-error">{stats.errors} error{stats.errors !== 1 ? 's' : ''}</span>
        )}
        {stats.warnings > 0 && (
          <span className="text-yellow-500">{stats.warnings} warning{stats.warnings !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div
        ref={containerRef}
        style={{ height: 600, backgroundColor: '#0a0a0a' }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/deploy-log-viewer.tsx frontend/src/app/projects/[id]/deployments/[did]/page.tsx frontend/src/hooks/use-deploy-logs.ts
git commit -m "feat: Vercel-style log viewer with timestamps, stats bar, and colored backgrounds"
```

---

### Task 6: Verify and test end-to-end

- [ ] **Step 1: Build backend**

```bash
cd backend && npm run build
```

Expected: compiles without errors.

- [ ] **Step 2: Build frontend**

```bash
cd frontend && npm run build
```

Expected: compiles without errors.

- [ ] **Step 3: Manual verification checklist**

1. Trigger a new deployment — log lines should now show `HH:mm:ss.SSS` timestamps
2. Deployment list shows 20 items max, scrolling to bottom loads more
3. Each deployment row shows duration (e.g. `1m 23s`) for completed deployments
4. Error lines have red background, warning lines have yellow background
5. Stats bar shows line count, error count, warning count
6. Old deployments (with string-format logs) still display correctly (no timestamps, but no crash)

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: address issues found during testing"
```
