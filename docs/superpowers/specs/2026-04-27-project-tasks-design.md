# Project Tasks Design

## Overview

Add a "Project Tasks" feature to Ship Dock for one-off operational commands such as database seeding, cache clearing, or search reindexing. Tasks are decoupled from the deployment pipeline: a project owner defines a set of named commands, and any team member with the right role can run them on demand against the deployed project.

This addresses a current gap: there is no way to run initialization or maintenance commands (e.g. `npm run seed`) without putting them in the deploy pipeline, where they would re-run on every deployment.

## Goals

- Define multiple named tasks per project (`seed`, `reset-db`, `reindex`, etc.)
- Trigger tasks manually from the project UI, decoupled from `git push` / webhook deploys
- Persist run history with full logs, exit code, status, and triggering user
- Stream live logs while a task runs
- Strict per-project mutual exclusion: deploys and tasks never run concurrently against the same project
- Reuse existing deploy infrastructure where it fits (`CommandStage`, BullMQ, gateway pattern)

## Non-Goals

- Task dependencies / DAG ordering
- Cron / scheduled tasks
- Task templates or cross-project sharing
- Per-task enable/disable toggle
- Per-task "danger" flag with extra confirmation prompts
- Task references inside the deploy pipeline
- Triggering tasks via webhook or external API key

## Concepts

| Term | Meaning |
|------|---------|
| **Task** (`ProjectTask`) | A named, reusable command attached to a project |
| **Run** (`ProjectTaskRun`) | One execution of a task — status, logs, who triggered it, timing |
| **Project lock** | Redis-based per-project mutex shared with the deploy queue |

## Data Model

Two new Prisma models. No changes to existing models other than adding the inverse relation on `Project`.

```prisma
model ProjectTask {
  id        String   @id @default(uuid())
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId String
  name      String   // user-facing name, e.g. "seed"
  command   String   // shell command, e.g. "npm run seed"
  workDir   String?  // optional override; falls back to project.workDir
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  runs ProjectTaskRun[]

  @@unique([projectId, name])
}

enum ProjectTaskRunStatus {
  QUEUED
  RUNNING
  SUCCESS
  FAILED
  CANCELLED
}

model ProjectTaskRun {
  id        String                @id @default(uuid())
  task      ProjectTask           @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId    String
  status    ProjectTaskRunStatus  @default(QUEUED)
  exitCode  Int?
  logs      Json                  @default("[]")
  startedAt DateTime?
  finishedAt DateTime?
  triggeredBy   User              @relation(fields: [triggeredById], references: [id])
  triggeredById String
  createdAt DateTime @default(now())

  @@index([taskId, createdAt])
}
```

`Project` gets `tasks ProjectTask[]` (and `User` gets the inverse for `triggeredBy`).

### Lifecycle Rules

- Deleting a `Project` cascades to its tasks and runs.
- Deleting a `ProjectTask` cascades to its runs (rejected at the API layer if a run is currently `RUNNING` — see API rules).
- Renaming a task is a plain `PATCH`; runs reference the task by ID, so history is preserved and re-labels naturally.

### Logs Storage

`logs` is a JSON array of `{ t: number, m: string }` entries (timestamp ms + message line), matching the shape used by `Deployment.stages[].logs`. Stderr lines preserve the same `\x1b[31m...\x1b[0m` ANSI coloring that `CommandStage` already emits, so the existing log viewer renders them identically. Logs are accumulated in memory by the processor and persisted on completion (or cancellation). Live logs are pushed via WebSocket during the run.

**Truncation:** if a single run produces more than **5 MB** or **50,000 lines** (whichever comes first), in-memory logs are truncated and a final line `"[truncated, N+ lines suppressed]"` is appended. (Deploy logs do not currently have an explicit cap; this is a new policy that we should consider backporting in a follow-up.)

## Execution

### Queue & Lock

- New BullMQ queue: **`tasks`**, with its own processor (`task.processor.ts`)
- Shared Redis mutex: **`project-lock:{projectId}`**, taken by both the deploy processor and the task processor before entering their critical sections
- If the lock is held, the job is delayed and re-attempted (BullMQ delayed retry); it does not fail
- This guarantees at most one execution (deploy *or* task) per project at any moment

> **Touches deploy code.** The existing `deploy.processor.ts` does not currently take any project-level lock. This spec requires adding the same `project-lock:{projectId}` acquire/release around the deploy critical section. A small shared helper (e.g. `ProjectLockService`) is the cleanest place for it.

A separate queue (rather than adding task jobs to the existing `deploy` queue) keeps deploy metrics, UI surfaces, and processor logic isolated. The shared Redis lock supplies the actual mutual exclusion.

### Trigger Flow

```
POST /api/projects/:id/tasks/:taskId/run
  └─ Validate: project exists, task exists, project has been deployed at least once
  └─ INSERT ProjectTaskRun (status: QUEUED, triggeredById = req.user.id)
  └─ enqueue { taskRunId } on `tasks` queue
  └─ 200 → { run: <ProjectTaskRun> }
```

### Processor Flow

```
1. Acquire project-lock:{projectId} (delay-retry if held)
2. Load run + task + project; if project missing, mark CANCELLED and exit
3. UPDATE run: status = RUNNING, startedAt = now()
4. Compute cwd = {PROJECTS_DIR}/{project.slug}/{task.workDir ?? project.workDir ?? ''}
5. Decrypt project.envVars; merge with process.env
6. Invoke CommandStage.execute({ command, ... }, ctx)
     - ctx.onLog: push to ws gateway room `task-run:{runId}` AND append to in-memory buffer
     - Track the spawned ChildProcess in a Map<runId, ChildProcess> for cancellation
7. On exit: UPDATE run with status (SUCCESS/FAILED), exitCode, finishedAt, logs (truncated if needed)
8. Release the project lock
```

### Cancellation

`POST /api/projects/:id/tasks/:taskId/runs/:runId/cancel`:

- `QUEUED` → mark `CANCELLED`, remove from queue
- `RUNNING` → `child.kill('SIGTERM')`; after 5s without exit, `child.kill('SIGKILL')`; mark `CANCELLED` once the child exits

The child-process map is process-local; only the worker that owns the run can cancel it. For the single-worker deployment that Ship Dock uses today, this is sufficient.

### Crash Recovery

On `task.module.ts` `onModuleInit`, scan for runs with `status = RUNNING`. Mark each as `FAILED`, append a final log line `"[system] Worker restarted, run aborted"`, and set `finishedAt = now()`. This handles worker crashes mid-run.

### Timeout

No global timeout. Long-running seeds against large datasets must not be killed automatically. Users observe elapsed time in the UI and use **Cancel** if needed. A per-task `timeoutSec` field can be added later if real usage warrants it.

## API

All routes live under `/api/projects/:id/tasks`. Auth via existing JWT guard; role enforcement via existing `MinRole` decorator.

| Method | Path | Min Role | Notes |
|---|---|---|---|
| GET | `/projects/:id/tasks` | VIEWER | List tasks; each includes `latestRun` summary |
| POST | `/projects/:id/tasks` | DEVELOPER | Create task `{ name, command, workDir? }` |
| PATCH | `/projects/:id/tasks/:taskId` | DEVELOPER | Update name/command/workDir |
| DELETE | `/projects/:id/tasks/:taskId` | DEVELOPER | 409 if any run is `RUNNING`; else cascade |
| POST | `/projects/:id/tasks/:taskId/run` | DEVELOPER | Enqueue a run; 400 if project never deployed |
| GET | `/projects/:id/tasks/:taskId/runs` | VIEWER | Paginated history, newest first |
| GET | `/projects/:id/tasks/:taskId/runs/:runId` | VIEWER | Full run including logs |
| POST | `/projects/:id/tasks/:taskId/runs/:runId/cancel` | DEVELOPER | Cancel `QUEUED` or `RUNNING` |

### Validation

- `name`: matches `^[a-zA-Z0-9_-]{1,40}$`; unique within project
- `command`: 1..4000 chars; no escaping/sanitization (commands run on user's own server, parity with deploy `pipeline.command`)
- `workDir`: same path-traversal sanitization rules as `Project.workDir` (no `..`, no absolute paths, no shell metacharacters)

### Errors

Reuse existing NestJS exceptions:

- `BadRequestException` — invalid input, project never deployed
- `NotFoundException` — task or run not found
- `ConflictException` — delete with running run, duplicate name
- `ForbiddenException` — role check failure (handled by `MinRole`)

## Realtime Logs

New `tasks.gateway.ts`, structurally mirroring `deploy.gateway.ts`:

- Client subscribes to room `task-run:{runId}`
- On subscription, the gateway replays any logs already in the DB, then switches to live push
- Events: `log` (per line) and `status` (state transitions)

## UI

### Entry Point

A new **Tasks** tab on the project detail page, alongside existing tabs (Overview, Deployments, Settings, etc).

### Tasks List

Card per task:

- **Header:** name + `Run` button + overflow menu (Edit / Delete)
- **Body:** the `command` in monospace, dimmed
- **Footer:** last-run summary — status icon, relative time, triggering user; or `Never run`
- Empty state with a `+ New Task` call-to-action

The `+ New Task` button opens a modal with `name`, `command`, and optional `workDir` fields.

### Task Detail

- Header: breadcrumb `Tasks / <name>`, with `Edit` and `Run` buttons
- Body: command, workDir
- **Runs** list below: status icon, relative time, duration, triggering user, `View logs` link

### Run Detail / Live Logs

Clicking `Run` navigates to a dedicated run page at `/projects/[id]/tasks/[taskId]/runs/[runId]`, mirroring the existing deploy run page (`/projects/[id]/deployments/[did]`). The page subscribes to `task-run:{runId}` and renders streaming logs using `deploy-log-viewer.tsx` (or a sibling component sharing the same xterm-style). Final state shows the exit code.

### Lock Conflicts

When a deploy is in progress (or another task is running), the `Run` button stays clickable. Clicking enqueues the run and shows a toast `"A deployment is in progress; this task will run when it finishes"`. Same flow if the contention is task-vs-task. The user is not forced to wait and retry.

### Confirmations

- **Delete task:** modal confirm — `"This will also delete N run records"`
- **Cancel run:** no confirm — easy to re-run
- **Run task:** no confirm — point of the feature is fast iteration

### Permissions

- `VIEWER`: sees the Tasks tab and run history; `Run`, `Edit`, `Delete`, `Cancel` controls hidden
- `DEVELOPER` and above: full control

## Edge Cases

| Scenario | Handling |
|---|---|
| Project never deployed | `POST /run` returns 400 `"Project has not been deployed yet"` |
| New `Run` while previous run is RUNNING | Allowed; queued; lock serializes |
| Delete task with running run | 409 `"Task has a running execution, cancel it first"` |
| Project deleted during a running task | Processor detects missing project after lock acquisition, marks run `CANCELLED` |
| Worker crash mid-run | `onModuleInit` sweeps stale `RUNNING` rows to `FAILED` |
| Runaway logs | Per-run cap: 5 MB / 50,000 lines, then truncate + final system line |
| WebSocket reconnect | Gateway replays existing log buffer from DB before resuming live push |
| Concurrent rename from two tabs | Last write wins; no optimistic concurrency |

## Testing

Follow the existing `*.service.spec.ts` / `*.controller.spec.ts` pattern in `backend/src`.

### Unit

- `project-tasks.service.spec.ts`
  - Create / update / delete task; name uniqueness
  - Trigger run: project-deployed precondition, `ProjectTaskRun` row insert, enqueue
  - Cancel: `QUEUED` → status flip + queue removal; `RUNNING` → child kill via process map
  - Delete with running run → `ConflictException`
- `task.processor.spec.ts`
  - Lock acquired and released around execution
  - Command success / non-zero exit / spawn error → correct final status
  - Log accumulation and persistence on completion
  - Truncation kicks in at 5 MB / 50k lines
  - Crash-recovery sweep on init
- `tasks.gateway.spec.ts` — mirrors `deploy.gateway.spec.ts`

### Integration

- End-to-end: create task → run → live logs → DB persistence → history readable
- Lock conflict: enqueue a task while a deploy is running; verify task waits and starts only after deploy releases the lock

### Out of scope

- No frontend tests (matches current repo convention)
- BullMQ internals not under test; only the processor's own logic

## Risks & Open Questions

- **Single-worker assumption.** The cancellation map is process-local. If Ship Dock ever moves to multi-worker, cancellation needs a Redis pub/sub signal. Acceptable for now; the existing deploy processor has the same limitation.
- **Task command is unsanitized.** Same trust model as `pipeline.command` — the user is running on their own server. Documented but not mitigated.
