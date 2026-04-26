# Project Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-27-project-tasks-design.md`

**Goal:** Add named, on-demand operational tasks (e.g. `seed`, `reset-db`) to each project — runnable from the UI, decoupled from deploys, with persistent run history and live logs.

**Architecture:** Two new Prisma models (`ProjectTask`, `ProjectTaskRun`) plus a new NestJS module (`project-tasks/`) that mirrors the deploy module's shape: BullMQ processor (`tasks` queue), Socket.IO gateway, REST controller, service. A new shared `ProjectLockService` (Redis SET NX) gives per-project mutual exclusion across deploys and tasks. Frontend adds a `Tasks` sidebar entry, a task list page, a task detail page, and a run page that reuses `deploy-log-viewer.tsx` for streaming logs.

**Tech Stack:** NestJS 11, Prisma (PostgreSQL), BullMQ + ioredis, Socket.IO, Next.js 16 App Router, React 19, TanStack Query, shadcn/base-ui, Tailwind CSS 4.

**Conventions to follow:**
- Backend tests: Jest, colocated `*.spec.ts`. Run with `cd backend && npm test`.
- Frontend has no tests by convention. Manual verification via dev servers.
- Frontend AGENTS note: Next.js in this repo is **not** the Next.js you remember — read `frontend/node_modules/next/dist/docs/` before writing any frontend code, heed deprecation notices.
- Commit per task with a Conventional-Commits-style subject.

---

## File Structure

### Created

| File | Purpose |
|---|---|
| `backend/src/common/project-lock.service.ts` | Redis-based per-project mutex shared by deploy + tasks |
| `backend/src/common/project-lock.service.spec.ts` | Lock unit tests |
| `backend/src/project-tasks/project-tasks.module.ts` | NestJS module wiring |
| `backend/src/project-tasks/project-tasks.controller.ts` | REST endpoints |
| `backend/src/project-tasks/project-tasks.controller.spec.ts` | Controller smoke tests |
| `backend/src/project-tasks/project-tasks.service.ts` | CRUD + trigger/cancel logic |
| `backend/src/project-tasks/project-tasks.service.spec.ts` | Service unit tests |
| `backend/src/project-tasks/project-tasks.processor.ts` | BullMQ processor that runs the command |
| `backend/src/project-tasks/project-tasks.processor.spec.ts` | Processor unit tests |
| `backend/src/project-tasks/project-tasks.gateway.ts` | Socket.IO live-log gateway |
| `backend/src/project-tasks/project-tasks.gateway.spec.ts` | Gateway smoke test |
| `backend/src/project-tasks/dto/create-task.dto.ts` | DTO with `class-validator` rules |
| `backend/src/project-tasks/dto/update-task.dto.ts` | Partial DTO |
| `frontend/src/hooks/use-project-tasks.ts` | TanStack Query hooks (list / CRUD / run / cancel / runs) |
| `frontend/src/hooks/use-task-run-logs.ts` | Socket.IO subscription hook for a single run |
| `frontend/src/app/projects/[id]/tasks/page.tsx` | Task list page |
| `frontend/src/app/projects/[id]/tasks/[taskId]/page.tsx` | Task detail + run history |
| `frontend/src/app/projects/[id]/tasks/[taskId]/runs/[runId]/page.tsx` | Single-run page with live logs |
| `frontend/src/components/task-form-dialog.tsx` | Create/Edit modal |

### Modified

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | Add `ProjectTask`, `ProjectTaskRun`, enum, inverse relations |
| `backend/src/common/common.module.ts` | Provide + export `ProjectLockService` |
| `backend/src/app.module.ts` | Import `ProjectTasksModule` |
| `backend/src/deploy/deploy.module.ts` | (no change if Common is already global; otherwise import CommonModule) |
| `backend/src/deploy/deploy.processor.ts` | Acquire/release `project-lock:{projectId}` around `process()` |
| `frontend/src/components/project-sidebar.tsx` | Add `Tasks` entry under `Project` group |

---

## Tasks

### Task 1: Schema migration — add ProjectTask + ProjectTaskRun

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_project_tasks/migration.sql` (generated)

- [ ] **Step 1: Add the enum + models to schema.prisma**

Append after the existing `WebhookEventStatus` enum (around line 89), or wherever enums live:

```prisma
enum ProjectTaskRunStatus {
  QUEUED
  RUNNING
  SUCCESS
  FAILED
  CANCELLED
}
```

Inside the `Project` model (around line 134, before the closing `}`), add:

```prisma
  tasks ProjectTask[]
```

Inside the `User` model, near the other relations (around line 84), add:

```prisma
  taskRuns ProjectTaskRun[]
```

At the end of the file (after the last existing model), append:

```prisma
model ProjectTask {
  id        String   @id @default(uuid())
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId String
  name      String
  command   String
  workDir   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  runs ProjectTaskRun[]

  @@unique([projectId, name])
}

model ProjectTaskRun {
  id            String                @id @default(uuid())
  task          ProjectTask           @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId        String
  status        ProjectTaskRunStatus  @default(QUEUED)
  exitCode      Int?
  logs          Json                  @default("[]")
  startedAt     DateTime?
  finishedAt    DateTime?
  triggeredBy   User                  @relation(fields: [triggeredById], references: [id])
  triggeredById String
  createdAt     DateTime              @default(now())

  @@index([taskId, createdAt])
}
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
cd backend && npx prisma migrate dev --name add_project_tasks
```

Expected: a new migration directory under `prisma/migrations/` and `node_modules/@prisma/client` regenerated. No errors.

- [ ] **Step 3: Verify Prisma client compiles**

Run:

```bash
cd backend && npx tsc --noEmit
```

Expected: clean output (or only pre-existing unrelated errors). The new `prisma.projectTask` and `prisma.projectTaskRun` accessors must compile.

- [ ] **Step 4: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add ProjectTask and ProjectTaskRun models"
```

---

### Task 2: ProjectLockService — Redis-backed per-project mutex

**Files:**
- Create: `backend/src/common/project-lock.service.ts`
- Create: `backend/src/common/project-lock.service.spec.ts`
- Modify: `backend/src/common/common.module.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/common/project-lock.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProjectLockService } from './project-lock.service';

describe('ProjectLockService', () => {
  let service: ProjectLockService;
  let redisMock: any;

  beforeEach(async () => {
    redisMock = {
      set: jest.fn(),
      eval: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    const module = await Test.createTestingModule({
      providers: [
        ProjectLockService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = module.get(ProjectLockService);
    (service as any).client = redisMock;
  });

  it('acquire returns a token when SET NX succeeds', async () => {
    redisMock.set.mockResolvedValue('OK');
    const token = await service.acquire('p1');
    expect(token).toBeTruthy();
    expect(redisMock.set).toHaveBeenCalledWith(
      'project-lock:p1', expect.any(String), 'PX', expect.any(Number), 'NX',
    );
  });

  it('acquire returns null when lock is held', async () => {
    redisMock.set.mockResolvedValue(null);
    const token = await service.acquire('p1');
    expect(token).toBeNull();
  });

  it('release runs the compare-and-delete script', async () => {
    await service.release('p1', 'tok-1');
    expect(redisMock.eval).toHaveBeenCalled();
    const args = redisMock.eval.mock.calls[0];
    expect(args[2]).toBe('project-lock:p1');
    expect(args[3]).toBe('tok-1');
  });

  it('withLock acquires, runs fn, and releases even on throw', async () => {
    redisMock.set.mockResolvedValue('OK');
    await expect(
      service.withLock('p1', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(redisMock.eval).toHaveBeenCalled();
  });

  it('withLock retries when lock is held, then succeeds', async () => {
    redisMock.set
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('OK');
    const fn = jest.fn().mockResolvedValue('done');
    const result = await service.withLock('p1', fn, { retryDelayMs: 1, maxWaitMs: 1000 });
    expect(result).toBe('done');
    expect(redisMock.set).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend && npx jest src/common/project-lock.service.spec.ts
```

Expected: FAIL — `Cannot find module './project-lock.service'`.

- [ ] **Step 3: Implement ProjectLockService**

Create `backend/src/common/project-lock.service.ts`:

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

interface WithLockOptions {
  ttlMs?: number;        // lock TTL; auto-expires if holder dies (default 10min)
  maxWaitMs?: number;    // total time to wait for the lock (default 1h)
  retryDelayMs?: number; // poll interval while waiting (default 500)
}

@Injectable()
export class ProjectLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectLockService.name);
  private client!: Redis;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
      lazyConnect: true,
    });
    this.client.connect().catch((err) => this.logger.error(`Redis connect failed: ${err.message}`));
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit();
  }

  private key(projectId: string) {
    return `project-lock:${projectId}`;
  }

  async acquire(projectId: string, ttlMs = 10 * 60 * 1000): Promise<string | null> {
    const token = randomUUID();
    const result = await this.client.set(this.key(projectId), token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(projectId: string, token: string): Promise<void> {
    await this.client.eval(RELEASE_SCRIPT, 1, this.key(projectId), token);
  }

  async withLock<T>(
    projectId: string,
    fn: () => Promise<T>,
    opts: WithLockOptions = {},
  ): Promise<T> {
    const ttl = opts.ttlMs ?? 10 * 60 * 1000;
    const maxWait = opts.maxWaitMs ?? 60 * 60 * 1000;
    const retry = opts.retryDelayMs ?? 500;
    const deadline = Date.now() + maxWait;

    let token: string | null = null;
    while (token === null) {
      token = await this.acquire(projectId, ttl);
      if (token) break;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for project lock ${projectId}`);
      }
      await new Promise((r) => setTimeout(r, retry));
    }

    try {
      return await fn();
    } finally {
      await this.release(projectId, token);
    }
  }
}
```

- [ ] **Step 4: Wire into CommonModule**

Read the existing module first, then update:

```bash
cat backend/src/common/common.module.ts
```

Modify `backend/src/common/common.module.ts` so it provides and exports `ProjectLockService`. Keep all existing providers/exports. The edit pattern: add `ProjectLockService` to the imports list and to both `providers` and `exports` arrays.

Example (adapt to actual existing code):

```typescript
import { ProjectLockService } from './project-lock.service';

// inside @Module({...}):
//   providers: [..., ProjectLockService],
//   exports:   [..., ProjectLockService],
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd backend && npx jest src/common/project-lock.service.spec.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/project-lock.service.ts backend/src/common/project-lock.service.spec.ts backend/src/common/common.module.ts
git commit -m "feat(common): add ProjectLockService for per-project mutex"
```

---

### Task 3: Wire ProjectLockService into deploy.processor

**Files:**
- Modify: `backend/src/deploy/deploy.processor.ts`

- [ ] **Step 1: Inject the lock service**

In the constructor of `DeployProcessor` (around line 30-35 of `backend/src/deploy/deploy.processor.ts`), add the dependency:

```typescript
import { ProjectLockService } from '../common/project-lock.service';

// in constructor signature:
private projectLock: ProjectLockService,
```

Place it among the existing constructor parameters.

- [ ] **Step 2: Wrap process() body in withLock**

The current `process()` (around line 54) starts with:

```typescript
async process(job: Job<{ deploymentId: string; projectId: string; resumeFromStage?: number }>) {
  const { deploymentId, projectId, resumeFromStage } = job.data;
  const project = await this.projectsService.findOne(projectId);
  // ... rest of method
}
```

Wrap everything after destructuring with `this.projectLock.withLock(projectId, async () => { ... })`. The destructuring stays outside; everything else moves inside. Pattern:

```typescript
async process(job: Job<{ deploymentId: string; projectId: string; resumeFromStage?: number }>) {
  const { deploymentId, projectId, resumeFromStage } = job.data;
  return this.projectLock.withLock(projectId, async () => {
    const project = await this.projectsService.findOne(projectId);
    // ... existing body unchanged ...
  });
}
```

- [ ] **Step 3: Verify CommonModule is global, or import it**

Run:

```bash
grep -n "Global" backend/src/common/common.module.ts
```

Expected output: contains `@Global()`. If yes, no further imports needed. If not, add `imports: [CommonModule]` to `DeployModule` in `backend/src/deploy/deploy.module.ts`.

- [ ] **Step 4: Type check**

Run:

```bash
cd backend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Run existing deploy tests to verify no regression**

Run:

```bash
cd backend && npx jest src/deploy
```

Expected: existing tests still pass. (They use mocks; add `ProjectLockService` to the mock providers list of `deploy.processor.spec.ts` only if it exists. If `deploy.processor.spec.ts` does not exist, skip — no spec to update.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/deploy/deploy.processor.ts backend/src/deploy/deploy.module.ts
git commit -m "feat(deploy): acquire project lock around deployment execution"
```

---

### Task 4: DTOs for create/update task

**Files:**
- Create: `backend/src/project-tasks/dto/create-task.dto.ts`
- Create: `backend/src/project-tasks/dto/update-task.dto.ts`

- [ ] **Step 1: Create CreateProjectTaskDto**

Create `backend/src/project-tasks/dto/create-task.dto.ts`:

```typescript
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateProjectTaskDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,40}$/, {
    message: 'name must be 1-40 chars of letters, digits, underscore, or hyphen',
  })
  name!: string;

  @IsString()
  @Length(1, 4000)
  command!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  workDir?: string;
}
```

- [ ] **Step 2: Create UpdateProjectTaskDto**

Create `backend/src/project-tasks/dto/update-task.dto.ts`:

```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectTaskDto } from './create-task.dto';

export class UpdateProjectTaskDto extends PartialType(CreateProjectTaskDto) {}
```

- [ ] **Step 3: Type check**

Run:

```bash
cd backend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/project-tasks/dto
git commit -m "feat(tasks): add create/update DTOs"
```

---

### Task 5: ProjectTasksGateway — Socket.IO live logs

**Files:**
- Create: `backend/src/project-tasks/project-tasks.gateway.ts`
- Create: `backend/src/project-tasks/project-tasks.gateway.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/project-tasks/project-tasks.gateway.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ProjectTasksGateway } from './project-tasks.gateway';

describe('ProjectTasksGateway', () => {
  let gateway: ProjectTasksGateway;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProjectTasksGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', role: 'ADMIN' }) } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'secret' } },
      ],
    }).compile();
    gateway = module.get(ProjectTasksGateway);
  });

  it('is defined', () => { expect(gateway).toBeDefined(); });
  it('exposes emitToTaskRun', () => { expect(typeof gateway.emitToTaskRun).toBe('function'); });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend && npx jest src/project-tasks/project-tasks.gateway.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gateway**

Create `backend/src/project-tasks/project-tasks.gateway.ts`:

```typescript
import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class ProjectTasksGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private jwt: JwtService, private config: ConfigService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) { client.disconnect(); return; }
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.getOrThrow('JWT_SECRET') });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch { client.disconnect(); }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join-task-run')
  handleJoin(client: Socket, runId: string) { client.join(`task-run:${runId}`); }

  @SubscribeMessage('leave-task-run')
  handleLeave(client: Socket, runId: string) { client.leave(`task-run:${runId}`); }

  emitToTaskRun(runId: string, event: string, data: any) {
    if (this.server) this.server.to(`task-run:${runId}`).emit(event, data);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd backend && npx jest src/project-tasks/project-tasks.gateway.spec.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/project-tasks/project-tasks.gateway.ts backend/src/project-tasks/project-tasks.gateway.spec.ts
git commit -m "feat(tasks): add gateway for live run logs"
```

---

### Task 6: ProjectTasksService — CRUD

**Files:**
- Create: `backend/src/project-tasks/project-tasks.service.ts`
- Create: `backend/src/project-tasks/project-tasks.service.spec.ts`

- [ ] **Step 1: Write the failing tests for CRUD**

Create `backend/src/project-tasks/project-tasks.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { existsSync } from 'fs';
import { ProjectTasksService } from './project-tasks.service';
import { PrismaService } from '../common/prisma.service';
import { ProjectTasksGateway } from './project-tasks.gateway';

jest.mock('fs', () => ({ existsSync: jest.fn() }));

describe('ProjectTasksService', () => {
  let service: ProjectTasksService;
  let prisma: any;
  let queue: any;
  let gateway: any;

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn() },
      projectTask: {
        create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
        findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(),
      },
      projectTaskRun: {
        create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
        findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
      },
    };
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn(),
    };
    gateway = { emitToTaskRun: jest.fn(), server: { sockets: { adapter: { rooms: new Map() } } } };
    (existsSync as jest.Mock).mockReturnValue(true);

    const module = await Test.createTestingModule({
      providers: [
        ProjectTasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('tasks'), useValue: queue },
        { provide: ProjectTasksGateway, useValue: gateway },
        { provide: ConfigService, useValue: { get: (_k: string, d?: any) => d ?? '/var/www' } },
      ],
    }).compile();
    service = module.get(ProjectTasksService);
  });

  describe('create', () => {
    it('creates a task', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.projectTask.create.mockResolvedValue({ id: 't1', name: 'seed' });
      const result = await service.create('p1', { name: 'seed', command: 'npm run seed' });
      expect(prisma.projectTask.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', name: 'seed', command: 'npm run seed', workDir: undefined },
      });
      expect(result).toEqual({ id: 't1', name: 'seed' });
    });

    it('rejects when project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(
        service.create('missing', { name: 'seed', command: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates Prisma unique-violation into ConflictException', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: 'p1' });
      const err: any = new Error('unique');
      err.code = 'P2002';
      prisma.projectTask.create.mockRejectedValue(err);
      await expect(
        service.create('p1', { name: 'seed', command: 'x' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('returns tasks with latestRun summary', async () => {
      prisma.projectTask.findMany.mockResolvedValue([
        {
          id: 't1', name: 'seed', command: 'npm run seed', workDir: null, projectId: 'p1',
          createdAt: new Date(), updatedAt: new Date(),
          runs: [{ id: 'r1', status: 'SUCCESS', startedAt: new Date(), finishedAt: new Date(), createdAt: new Date(), exitCode: 0, triggeredBy: { id: 'u1', name: 'alice' } }],
        },
      ]);
      const result = await service.list('p1');
      expect(result[0].latestRun?.status).toBe('SUCCESS');
      // logs must not leak in list responses
      expect(result[0].latestRun).not.toHaveProperty('logs');
    });
  });

  describe('update', () => {
    it('updates an existing task', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.projectTask.update.mockResolvedValue({ id: 't1', name: 'seed-v2' });
      const result = await service.update('p1', 't1', { name: 'seed-v2' });
      expect(result.name).toBe('seed-v2');
    });

    it('404s when task is not in this project', async () => {
      prisma.projectTask.findFirst.mockResolvedValue(null);
      await expect(service.update('p1', 't1', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('refuses to delete while a run is RUNNING', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.projectTaskRun.findFirst.mockResolvedValue({ id: 'r1', status: 'RUNNING' });
      await expect(service.remove('p1', 't1')).rejects.toThrow(ConflictException);
    });

    it('deletes when no run is RUNNING', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      prisma.projectTaskRun.findFirst.mockResolvedValue(null);
      prisma.projectTask.delete.mockResolvedValue({ id: 't1' });
      const result = await service.remove('p1', 't1');
      expect(result).toEqual({ id: 't1' });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend && npx jest src/project-tasks/project-tasks.service.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service (CRUD only — trigger/cancel come in Task 7)**

Create `backend/src/project-tasks/project-tasks.service.ts`:

```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../common/prisma.service';
import { ProjectTasksGateway } from './project-tasks.gateway';
import { CreateProjectTaskDto } from './dto/create-task.dto';
import { UpdateProjectTaskDto } from './dto/update-task.dto';

@Injectable()
export class ProjectTasksService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('tasks') private queue: Queue,
    private gateway: ProjectTasksGateway,
    private config: ConfigService,
  ) {}

  private validateWorkDir(dir: string): string {
    const sanitized = dir.replace(/\\/g, '/').trim();
    if (sanitized.includes('..') || sanitized.startsWith('/') || /[;&|`$]/.test(sanitized)) {
      throw new BadRequestException('Invalid workDir');
    }
    return sanitized;
  }

  async create(projectId: string, dto: CreateProjectTaskDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    const workDir = dto.workDir ? this.validateWorkDir(dto.workDir) : undefined;
    try {
      return await this.prisma.projectTask.create({
        data: { projectId, name: dto.name, command: dto.command, workDir },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException(`A task named "${dto.name}" already exists in this project`);
      throw err;
    }
  }

  async list(projectId: string) {
    const tasks = await this.prisma.projectTask.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true, status: true, exitCode: true,
            startedAt: true, finishedAt: true, createdAt: true,
            triggeredBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    return tasks.map((t) => {
      const { runs, ...rest } = t;
      return { ...rest, latestRun: runs[0] ?? null };
    });
  }

  async getOne(projectId: string, taskId: string) {
    const task = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(projectId: string, taskId: string, dto: UpdateProjectTaskDto) {
    const existing = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!existing) throw new NotFoundException('Task not found');
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.command !== undefined) data.command = dto.command;
    if (dto.workDir !== undefined) data.workDir = dto.workDir ? this.validateWorkDir(dto.workDir) : null;
    try {
      return await this.prisma.projectTask.update({ where: { id: taskId }, data });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException(`A task named "${dto.name}" already exists in this project`);
      throw err;
    }
  }

  async remove(projectId: string, taskId: string) {
    const existing = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!existing) throw new NotFoundException('Task not found');
    const running = await this.prisma.projectTaskRun.findFirst({
      where: { taskId, status: 'RUNNING' },
      select: { id: true, status: true },
    });
    if (running) throw new ConflictException('Task has a running execution, cancel it first');
    return this.prisma.projectTask.delete({ where: { id: taskId } });
  }
}
```

- [ ] **Step 4: Run the test to verify CRUD tests pass**

Run:

```bash
cd backend && npx jest src/project-tasks/project-tasks.service.spec.ts
```

Expected: all CRUD test cases pass. (Trigger/cancel tests will be added in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/project-tasks/project-tasks.service.ts backend/src/project-tasks/project-tasks.service.spec.ts
git commit -m "feat(tasks): add CRUD service for project tasks"
```

---

### Task 7: ProjectTasksService — trigger / runs / crash recovery

> Cancellation needs the processor (which is created in Task 9), so `cancelRun` lands there. This task adds everything else.

**Files:**
- Modify: `backend/src/project-tasks/project-tasks.service.ts`
- Modify: `backend/src/project-tasks/project-tasks.service.spec.ts`

- [ ] **Step 1: Add failing tests for trigger/runs/recovery**

Append to `backend/src/project-tasks/project-tasks.service.spec.ts` inside the existing `describe('ProjectTasksService', ...)` block, after the `remove` describe:

```typescript
  describe('triggerRun', () => {
    it('rejects when project never deployed (workDir missing on disk)', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1', command: 'x', workDir: null });
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', slug: 'app', workDir: null, directory: 'app' });
      (existsSync as jest.Mock).mockReturnValue(false);
      await expect(service.triggerRun('p1', 't1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('creates a QUEUED run and enqueues a job (jobId = runId)', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1', command: 'x', workDir: null });
      prisma.project.findUnique.mockResolvedValue({ id: 'p1', slug: 'app', workDir: null, directory: 'app' });
      (existsSync as jest.Mock).mockReturnValue(true);
      prisma.projectTaskRun.create.mockResolvedValue({ id: 'r1', status: 'QUEUED' });
      const run = await service.triggerRun('p1', 't1', 'u1');
      expect(prisma.projectTaskRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taskId: 't1', triggeredById: 'u1', status: 'QUEUED' }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith('run', { taskRunId: 'r1' }, { jobId: 'r1' });
      expect(run.id).toBe('r1');
    });
  });

  describe('listRuns', () => {
    it('omits logs and returns duration when finished', async () => {
      prisma.projectTask.findFirst.mockResolvedValue({ id: 't1', projectId: 'p1' });
      const start = new Date('2026-04-27T10:00:00Z');
      const end = new Date('2026-04-27T10:00:05Z');
      prisma.projectTaskRun.findMany.mockResolvedValue([
        { id: 'r1', startedAt: start, finishedAt: end, createdAt: end, status: 'SUCCESS', triggeredBy: { id: 'u1', name: 'a' } },
      ]);
      const result = await service.listRuns('p1', 't1');
      expect(result.items[0].duration).toBe(5);
      expect(result.items[0]).not.toHaveProperty('logs');
    });
  });

  describe('crash recovery', () => {
    it('marks RUNNING runs as FAILED on init', async () => {
      prisma.projectTaskRun.findMany.mockResolvedValue([{ id: 'r1', logs: [] }, { id: 'r2', logs: [{ t: 1, m: 'hello' }] }]);
      prisma.projectTaskRun.update.mockResolvedValue({});
      await service.recoverStuckRuns();
      expect(prisma.projectTaskRun.update).toHaveBeenCalledTimes(2);
      const firstCallData = prisma.projectTaskRun.update.mock.calls[0][0].data;
      expect(firstCallData.status).toBe('FAILED');
      expect(firstCallData.finishedAt).toBeInstanceOf(Date);
      expect(JSON.stringify(firstCallData.logs)).toContain('Worker restarted');
    });
  });
```

- [ ] **Step 2: Verify the new tests fail**

Run:

```bash
cd backend && npx jest src/project-tasks/project-tasks.service.spec.ts
```

Expected: FAIL — `triggerRun`, `listRuns`, `recoverStuckRuns` are not defined.

- [ ] **Step 3: Implement trigger/runs/recovery (no cancel yet — comes in Task 9 alongside the processor)**

Edit `backend/src/project-tasks/project-tasks.service.ts`. At the top, add:

```typescript
import { existsSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
```

(Some of these may already be there from Task 6; just ensure the final import list is complete.)

Add these methods inside the class (place above the closing `}`):

```typescript
  private resolveProjectDir(project: { slug: string; directory: string | null; workDir: string | null }, taskWorkDir?: string | null) {
    const projectsRoot = this.config.get('PROJECTS_DIR', '/var/www');
    const repoDir = join(projectsRoot, project.directory || project.slug);
    const sub = taskWorkDir ?? project.workDir ?? '';
    return sub ? join(repoDir, sub) : repoDir;
  }

  async triggerRun(projectId: string, taskId: string, userId: string) {
    const task = await this.prisma.projectTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new NotFoundException('Task not found');
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, slug: true, directory: true, workDir: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const cwd = this.resolveProjectDir(project, task.workDir);
    if (!existsSync(cwd)) {
      throw new BadRequestException('Project has not been deployed yet');
    }

    const run = await this.prisma.projectTaskRun.create({
      data: { taskId, status: 'QUEUED', triggeredById: userId },
    });
    // jobId = run.id so cancelRun (added in Task 9) can find and remove queued jobs.
    await this.queue.add('run', { taskRunId: run.id }, { jobId: run.id });
    return run;
  }

  async listRuns(projectId: string, taskId: string, cursor?: string, limit = 20) {
    await this.getOne(projectId, taskId); // 404 if not in project
    const where: any = { taskId };
    if (cursor) {
      const c = await this.prisma.projectTaskRun.findUnique({ where: { id: cursor }, select: { createdAt: true } });
      if (c) where.createdAt = { lt: c.createdAt };
    }
    const items = await this.prisma.projectTaskRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      omit: { logs: true },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return {
      items: items.map((r) => ({
        ...r,
        duration: r.startedAt && r.finishedAt ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000) : null,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getRun(projectId: string, taskId: string, runId: string) {
    const run = await this.prisma.projectTaskRun.findFirst({
      where: { id: runId, taskId, task: { projectId } },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async recoverStuckRuns() {
    const stuck = await this.prisma.projectTaskRun.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, logs: true },
    });
    const now = new Date();
    for (const r of stuck) {
      const logs = Array.isArray(r.logs) ? (r.logs as any[]) : [];
      logs.push({ t: now.getTime(), m: '[system] Worker restarted, run aborted' });
      await this.prisma.projectTaskRun.update({
        where: { id: r.id },
        data: { status: 'FAILED', finishedAt: now, logs },
      });
    }
  }
```

- [ ] **Step 4: Run all service tests**

Run:

```bash
cd backend && npx jest src/project-tasks/project-tasks.service.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/project-tasks/project-tasks.service.ts backend/src/project-tasks/project-tasks.service.spec.ts
git commit -m "feat(tasks): add trigger/runs/recovery to service"
```

---

### Task 8: ProjectTasksController — REST endpoints

**Files:**
- Create: `backend/src/project-tasks/project-tasks.controller.ts`
- Create: `backend/src/project-tasks/project-tasks.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/project-tasks/project-tasks.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectTasksService } from './project-tasks.service';

describe('ProjectTasksController', () => {
  let controller: ProjectTasksController;
  let svc: any;

  beforeEach(async () => {
    svc = {
      list: jest.fn(), create: jest.fn(), getOne: jest.fn(),
      update: jest.fn(), remove: jest.fn(),
      triggerRun: jest.fn(), listRuns: jest.fn(), getRun: jest.fn(), cancelRun: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ProjectTasksController],
      providers: [{ provide: ProjectTasksService, useValue: svc }],
    }).compile();
    controller = module.get(ProjectTasksController);
  });

  it('list delegates to service', async () => {
    svc.list.mockResolvedValue([]);
    await controller.list('p1');
    expect(svc.list).toHaveBeenCalledWith('p1');
  });

  it('triggerRun passes the user id from req', async () => {
    svc.triggerRun.mockResolvedValue({ id: 'r1' });
    const result = await controller.triggerRun('p1', 't1', { user: { id: 'u1' } } as any);
    expect(svc.triggerRun).toHaveBeenCalledWith('p1', 't1', 'u1');
    expect(result).toEqual({ id: 'r1' });
  });

  it('listRuns parses limit', async () => {
    svc.listRuns.mockResolvedValue({ items: [], nextCursor: null });
    await controller.listRuns('p1', 't1', undefined, '10');
    expect(svc.listRuns).toHaveBeenCalledWith('p1', 't1', undefined, 10);
  });
  // The cancel endpoint is added in Task 9 alongside service.cancelRun + processor.
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx jest src/project-tasks/project-tasks.controller.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the controller**

Create `backend/src/project-tasks/project-tasks.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ProjectTasksService } from './project-tasks.service';
import { CreateProjectTaskDto } from './dto/create-task.dto';
import { UpdateProjectTaskDto } from './dto/update-task.dto';

@Controller('projects/:projectId/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectTasksController {
  constructor(private service: ProjectTasksService) {}

  @Get() @MinRole('VIEWER')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post() @MinRole('DEVELOPER')
  create(@Param('projectId') projectId: string, @Body() dto: CreateProjectTaskDto) {
    return this.service.create(projectId, dto);
  }

  @Get(':taskId') @MinRole('VIEWER')
  getOne(@Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.getOne(projectId, taskId);
  }

  @Patch(':taskId') @MinRole('DEVELOPER')
  update(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateProjectTaskDto,
  ) {
    return this.service.update(projectId, taskId, dto);
  }

  @Delete(':taskId') @MinRole('DEVELOPER')
  remove(@Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.remove(projectId, taskId);
  }

  @Post(':taskId/run') @MinRole('DEVELOPER')
  triggerRun(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Req() req: any,
  ) {
    return this.service.triggerRun(projectId, taskId, req.user.id);
  }

  @Get(':taskId/runs') @MinRole('VIEWER')
  listRuns(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listRuns(projectId, taskId, cursor, limit ? parseInt(limit) : undefined);
  }

  @Get(':taskId/runs/:runId') @MinRole('VIEWER')
  getRun(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('runId') runId: string,
  ) {
    return this.service.getRun(projectId, taskId, runId);
  }

  // Cancel endpoint is added in Task 9 once service.cancelRun + processor exist.
}
```

- [ ] **Step 4: Run controller tests**

```bash
cd backend && npx jest src/project-tasks/project-tasks.controller.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/project-tasks/project-tasks.controller.ts backend/src/project-tasks/project-tasks.controller.spec.ts
git commit -m "feat(tasks): add REST controller"
```

---

### Task 9: ProjectTasksProcessor — execute the command, stream logs

**Files:**
- Create: `backend/src/project-tasks/project-tasks.processor.ts`
- Create: `backend/src/project-tasks/project-tasks.processor.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/project-tasks/project-tasks.processor.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProjectTasksProcessor } from './project-tasks.processor';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ProjectLockService } from '../common/project-lock.service';
import { ProjectTasksGateway } from './project-tasks.gateway';

describe('ProjectTasksProcessor', () => {
  let processor: ProjectTasksProcessor;
  let prisma: any;
  let lock: any;
  let gateway: any;

  beforeEach(async () => {
    prisma = {
      projectTaskRun: { findUnique: jest.fn(), update: jest.fn() },
      project: { findUnique: jest.fn() },
    };
    lock = { withLock: jest.fn().mockImplementation((_id: string, fn: () => any) => fn()) };
    gateway = { emitToTaskRun: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ProjectTasksProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: { decrypt: () => '{}' } },
        { provide: ConfigService, useValue: { get: (_k: string, d?: any) => d } },
        { provide: ProjectLockService, useValue: lock },
        { provide: ProjectTasksGateway, useValue: gateway },
      ],
    }).compile();
    processor = module.get(ProjectTasksProcessor);
  });

  it('marks run CANCELLED when the project no longer exists', async () => {
    prisma.projectTaskRun.findUnique.mockResolvedValue({
      id: 'r1', taskId: 't1', status: 'QUEUED',
      task: { id: 't1', projectId: 'p1', command: 'echo hi', workDir: null },
    });
    prisma.project.findUnique.mockResolvedValue(null);
    prisma.projectTaskRun.update.mockResolvedValue({});
    await processor.process({ data: { taskRunId: 'r1' } } as any);
    expect(prisma.projectTaskRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });

  it('signalCancel kills the tracked child process', () => {
    const child: any = { killed: false, kill: jest.fn(() => { child.killed = true; }) };
    (processor as any).children.set('r1', child);
    processor.signalCancel('r1');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect((processor as any).cancelRequested.has('r1')).toBe(true);
  });

});
```

> The end-to-end "runs command + persists SUCCESS" path and log-truncation behavior are exercised by the manual smoke test in Task 11. Mocking spawn/cwd into a unit test is more brittle than it's worth.

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && npx jest src/project-tasks/project-tasks.processor.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the processor**

Create `backend/src/project-tasks/project-tasks.processor.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ProjectLockService } from '../common/project-lock.service';
import { ProjectTasksGateway } from './project-tasks.gateway';

const MAX_LOG_LINES = 50_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

interface LogEntry { t: number; m: string }

@Processor('tasks')
export class ProjectTasksProcessor extends WorkerHost {
  private readonly logger = new Logger(ProjectTasksProcessor.name);
  private readonly children = new Map<string, ChildProcess>();
  private readonly cancelRequested = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
    private projectLock: ProjectLockService,
    private gateway: ProjectTasksGateway,
  ) { super(); }

  async process(job: Job<{ taskRunId: string }>) {
    const { taskRunId } = job.data;
    const run = await this.prisma.projectTaskRun.findUnique({
      where: { id: taskRunId },
      include: { task: true },
    });
    if (!run) return;

    const projectId = run.task.projectId;

    return this.projectLock.withLock(projectId, async () => {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, slug: true, directory: true, workDir: true, envVars: true, nodeVersion: true },
      });
      if (!project) {
        await this.prisma.projectTaskRun.update({
          where: { id: taskRunId },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        });
        return;
      }

      const projectsRoot = this.config.get<string>('PROJECTS_DIR', '/var/www');
      const repoDir = join(projectsRoot, project.directory || project.slug);
      const cwd = run.task.workDir
        ? join(repoDir, run.task.workDir)
        : project.workDir
        ? join(repoDir, project.workDir)
        : repoDir;

      if (!existsSync(cwd)) {
        const log: LogEntry = { t: Date.now(), m: `\x1b[31m[error] Working directory ${cwd} does not exist\x1b[0m` };
        await this.prisma.projectTaskRun.update({
          where: { id: taskRunId },
          data: { status: 'FAILED', finishedAt: new Date(), logs: [log] },
        });
        this.gateway.emitToTaskRun(taskRunId, 'log', log);
        this.gateway.emitToTaskRun(taskRunId, 'status', { status: 'FAILED' });
        return;
      }

      // Decrypt project env
      let envVars: Record<string, string> = {};
      if (project.envVars) {
        try { envVars = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
      }
      // Optional Node version on PATH (mirrors deploy.processor logic)
      if (project.nodeVersion) {
        try {
          const { readdirSync } = require('fs');
          const versions: string[] = readdirSync('/usr/local/n/versions/node/');
          const match = versions.find((v: string) => v.startsWith(project.nodeVersion + '.'));
          if (match) envVars.PATH = `/usr/local/n/versions/node/${match}/bin:${process.env.PATH || ''}`;
        } catch {}
      }

      await this.prisma.projectTaskRun.update({
        where: { id: taskRunId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      this.gateway.emitToTaskRun(taskRunId, 'status', { status: 'RUNNING' });

      // Cancellation is signalled by ProjectTasksService.cancelRun calling
      // this.signalCancel(taskRunId), which kills the child and flips cancelRequested.

      const logs: LogEntry[] = [];
      let bytes = 0;
      let truncated = false;
      const onLog = (line: string) => {
        const entry = { t: Date.now(), m: line };
        if (!truncated) {
          if (logs.length >= MAX_LOG_LINES || bytes + line.length > MAX_LOG_BYTES) {
            truncated = true;
            const summary = { t: Date.now(), m: `[truncated, ${logs.length}+ lines suppressed]` };
            logs.push(summary);
            this.gateway.emitToTaskRun(taskRunId, 'log', summary);
          } else {
            logs.push(entry);
            bytes += line.length;
            this.gateway.emitToTaskRun(taskRunId, 'log', entry);
          }
        }
      };

      const result = await this.runShell(taskRunId, run.task.command, cwd, envVars, onLog);

      const finalStatus = result.cancelled ? 'CANCELLED' : (result.exitCode === 0 ? 'SUCCESS' : 'FAILED');
      await this.prisma.projectTaskRun.update({
        where: { id: taskRunId },
        data: {
          status: finalStatus,
          exitCode: result.exitCode,
          finishedAt: new Date(),
          logs,
        },
      });
      this.gateway.emitToTaskRun(taskRunId, 'status', { status: finalStatus, exitCode: result.exitCode });

      this.children.delete(taskRunId);
      this.cancelRequested.delete(taskRunId);
    });
  }

  /** Called by ProjectTasksService.cancelRun for RUNNING runs. */
  signalCancel(taskRunId: string) {
    this.cancelRequested.add(taskRunId);
    const child = this.children.get(taskRunId);
    if (child && !child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000).unref();
    }
  }

  private runShell(
    taskRunId: string,
    command: string,
    cwd: string,
    envVars: Record<string, string>,
    onLog: (line: string) => void,
  ): Promise<{ exitCode: number | null; cancelled: boolean }> {
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], {
        cwd,
        env: { ...process.env, ...envVars },
      });
      this.children.set(taskRunId, child);

      child.stdout.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach(onLog);
      });
      child.stderr.on('data', (data) => {
        data.toString().split('\n').filter((l: string) => l).forEach((line: string) => {
          const color = /\bwarn(ing)?\b/i.test(line) ? '\x1b[33m' : '\x1b[31m';
          onLog(`${color}[stderr] ${line}\x1b[0m`);
        });
      });

      child.on('close', (code) => {
        const cancelled = this.cancelRequested.has(taskRunId);
        resolve({ exitCode: cancelled ? null : code, cancelled });
      });
      child.on('error', (err) => {
        onLog(`\x1b[31m[error] ${err.message}\x1b[0m`);
        resolve({ exitCode: null, cancelled: false });
      });
    });
  }
}
```

- [ ] **Step 4: Add cancellation tests for the service**

Append to `backend/src/project-tasks/project-tasks.service.spec.ts` inside the existing top-level `describe`. First, update the providers in `beforeEach` to include the new processor mock — find the `Test.createTestingModule({ providers: [...] })` call and add:

```typescript
import { ProjectTasksProcessor } from './project-tasks.processor';

// inside providers array:
{ provide: ProjectTasksProcessor, useValue: { signalCancel: jest.fn() } },
```

Then add the new describe block:

```typescript
  describe('cancelRun', () => {
    it('marks a QUEUED run cancelled and removes the job', async () => {
      prisma.projectTaskRun.findFirst.mockResolvedValue({
        id: 'r1', taskId: 't1', status: 'QUEUED', task: { projectId: 'p1' },
      });
      const job = { remove: jest.fn() };
      queue.getJob.mockResolvedValue(job);
      prisma.projectTaskRun.update.mockResolvedValue({ id: 'r1', status: 'CANCELLED' });
      const r = await service.cancelRun('p1', 't1', 'r1');
      expect(job.remove).toHaveBeenCalled();
      expect(r.status).toBe('CANCELLED');
    });

    it('signals processor cancellation when RUNNING', async () => {
      prisma.projectTaskRun.findFirst.mockResolvedValue({
        id: 'r1', taskId: 't1', status: 'RUNNING', task: { projectId: 'p1' },
      });
      const result = await service.cancelRun('p1', 't1', 'r1');
      const proc = (service as any).processor;
      expect(proc.signalCancel).toHaveBeenCalledWith('r1');
      expect(result.id).toBe('r1');
    });

    it('rejects cancelling a finished run', async () => {
      prisma.projectTaskRun.findFirst.mockResolvedValue({
        id: 'r1', status: 'SUCCESS', task: { projectId: 'p1' },
      });
      await expect(service.cancelRun('p1', 't1', 'r1')).rejects.toThrow(BadRequestException);
    });
  });
```

- [ ] **Step 5: Add cancelRun method + processor dependency to the service**

Edit `backend/src/project-tasks/project-tasks.service.ts`. Add the import at the top:

```typescript
import { Inject, forwardRef } from '@nestjs/common';
import { ProjectTasksProcessor } from './project-tasks.processor';
```

Update the constructor — append the processor as the last parameter:

```typescript
constructor(
  private prisma: PrismaService,
  @InjectQueue('tasks') private queue: Queue,
  private gateway: ProjectTasksGateway,
  private config: ConfigService,
  @Inject(forwardRef(() => ProjectTasksProcessor)) private processor: ProjectTasksProcessor,
) {}
```

Add the `cancelRun` method (place above `recoverStuckRuns`):

```typescript
  async cancelRun(projectId: string, taskId: string, runId: string) {
    const run = await this.prisma.projectTaskRun.findFirst({
      where: { id: runId, taskId },
      include: { task: { select: { projectId: true } } },
    });
    if (!run || run.task.projectId !== projectId) throw new NotFoundException('Run not found');

    if (run.status === 'QUEUED') {
      const job = await this.queue.getJob(runId);
      if (job) { try { await job.remove(); } catch {} }
      return this.prisma.projectTaskRun.update({
        where: { id: runId },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });
    }
    if (run.status === 'RUNNING') {
      this.processor.signalCancel(runId);
      this.gateway.emitToTaskRun(runId, 'cancel-requested', { runId });
      return run;
    }
    throw new BadRequestException(`Cannot cancel a run in status ${run.status}`);
  }
```

The processor in turn must use `forwardRef(() => ProjectTasksService)` if it ever needs the service — currently it doesn't, so only the service side has the forwardRef. NestJS will resolve correctly at construction time.

- [ ] **Step 6: Add cancel endpoint to the controller**

Edit `backend/src/project-tasks/project-tasks.controller.ts`. Add the route inside the class, after `getRun`:

```typescript
  @Post(':taskId/runs/:runId/cancel') @MinRole('DEVELOPER')
  cancelRun(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('runId') runId: string,
  ) {
    return this.service.cancelRun(projectId, taskId, runId);
  }
```

- [ ] **Step 7: Run all backend tests for the new module**

```bash
cd backend && npx jest src/project-tasks
```

Expected: all pass — processor + service (CRUD, trigger, runs, recovery, cancelRun) + controller + gateway.

- [ ] **Step 8: Commit**

```bash
git add backend/src/project-tasks
git commit -m "feat(tasks): add processor, cancellation, and live log streaming"
```

---

### Task 10: ProjectTasksModule + crash-recovery hook + app.module wiring

**Files:**
- Create: `backend/src/project-tasks/project-tasks.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create the module**

Create `backend/src/project-tasks/project-tasks.module.ts`:

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectTasksProcessor } from './project-tasks.processor';
import { ProjectTasksGateway } from './project-tasks.gateway';

@Module({
  imports: [BullModule.registerQueue({ name: 'tasks' }), JwtModule.register({})],
  controllers: [ProjectTasksController],
  providers: [ProjectTasksService, ProjectTasksProcessor, ProjectTasksGateway],
  exports: [ProjectTasksService, ProjectTasksGateway],
})
export class ProjectTasksModule implements OnModuleInit {
  constructor(private service: ProjectTasksService) {}

  async onModuleInit() {
    // Sweep RUNNING runs left over from a crashed worker.
    try { await this.service.recoverStuckRuns(); } catch {}
  }
}
```

- [ ] **Step 2: Register in app.module.ts**

Edit `backend/src/app.module.ts` to import and add `ProjectTasksModule`:

```typescript
import { ProjectTasksModule } from './project-tasks/project-tasks.module';

// inside the imports array, alongside other feature modules:
ProjectTasksModule,
```

- [ ] **Step 3: Build to verify wiring**

```bash
cd backend && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Run the full backend test suite**

```bash
cd backend && npm test
```

Expected: all pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/project-tasks/project-tasks.module.ts backend/src/app.module.ts
git commit -m "feat(tasks): wire ProjectTasksModule into the app"
```

---

### Task 11: Manual backend smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start the backend in dev mode**

```bash
cd backend && npm run start:dev
```

Expected: server starts, no errors. Leave running in another terminal.

- [ ] **Step 2: Pick a deployed project**

In another terminal:

```bash
psql -d shipdock -c "SELECT id, slug, directory, \"workDir\" FROM \"Project\" LIMIT 5;"
```

Pick a project ID where the directory exists on disk (i.e. it has been deployed at least once).

- [ ] **Step 3: Get a JWT**

Use the existing login endpoint (or grab one from the browser dev tools):

```bash
TOKEN=<your-jwt>
PROJECT=<project-id>
```

- [ ] **Step 4: Create a task, run it, check logs**

```bash
# Create
curl -sS -X POST http://localhost:3000/api/projects/$PROJECT/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"hello","command":"echo hello world && sleep 1 && echo done"}' | jq .

# List
curl -sS http://localhost:3000/api/projects/$PROJECT/tasks -H "Authorization: Bearer $TOKEN" | jq .

# Run (capture taskId from list)
TASK=<task-id>
curl -sS -X POST http://localhost:3000/api/projects/$PROJECT/tasks/$TASK/run \
  -H "Authorization: Bearer $TOKEN" | jq .

# Wait a couple seconds, then read history
curl -sS http://localhost:3000/api/projects/$PROJECT/tasks/$TASK/runs \
  -H "Authorization: Bearer $TOKEN" | jq .

# Read full run with logs
RUN=<run-id>
curl -sS http://localhost:3000/api/projects/$PROJECT/tasks/$TASK/runs/$RUN \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: status transitions QUEUED → RUNNING → SUCCESS, logs contain `hello world` and `done`, `exitCode: 0`.

- [ ] **Step 5: Try the failure path and the never-deployed path**

```bash
# A failing command
curl -sS -X POST http://localhost:3000/api/projects/$PROJECT/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"fail","command":"exit 7"}' | jq .

# Trigger and verify status FAILED with exitCode 7

# A project that has never been deployed: pick a slug where no directory exists,
# create a task, trigger run — expect 400 "Project has not been deployed yet"
```

Expected: failure path works, never-deployed returns 400.

- [ ] **Step 6: Commit nothing — this is verification only**

If anything failed, fix and commit incrementally. Do not commit from this task.

---

### Task 12: Frontend hook — useProjectTasks

**Files:**
- Create: `frontend/src/hooks/use-project-tasks.ts`

> **Reminder:** Read `frontend/node_modules/next/dist/docs/` notes if writing client/server boundary code, since this Next.js may differ from your training data.

- [ ] **Step 1: Implement the hooks**

Create `frontend/src/hooks/use-project-tasks.ts`:

```typescript
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
```

- [ ] **Step 2: Type-check the frontend**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-project-tasks.ts
git commit -m "feat(tasks): add frontend data hooks"
```

---

### Task 13: Frontend hook — useTaskRunLogs (live streaming)

**Files:**
- Create: `frontend/src/hooks/use-task-run-logs.ts`

> Mirror the existing `frontend/src/hooks/use-deploy-logs.ts`. Read it first:
>
> ```bash
> cat frontend/src/hooks/use-deploy-logs.ts
> ```
>
> If its socket setup uses helpers from `lib/`, reuse the same helpers below.

- [ ] **Step 1: Implement the hook**

Create `frontend/src/hooks/use-task-run-logs.ts`. Pattern (adjust the socket connect call to match what `use-deploy-logs.ts` already uses in this repo — e.g. token retrieval, base URL):

```typescript
'use client';
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface LogLine { t: number; m: string }

export function useTaskRunLogs(runId: string | undefined, initialLogs: LogLine[] = []) {
  const [logs, setLogs] = useState<LogLine[]>(initialLogs);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setLogs(initialLogs);
    setStatus(null);
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const url = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api$/, '') || 'http://localhost:3000';
    const socket: Socket = io(url, { auth: { token }, transports: ['websocket'] });
    socket.emit('join-task-run', runId);
    socket.on('log', (entry: LogLine) => setLogs((prev) => [...prev, entry]));
    socket.on('status', (s: any) => setStatus(s.status));
    return () => {
      socket.emit('leave-task-run', runId);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { logs, status };
}
```

If the existing `use-deploy-logs.ts` uses a different token source or socket URL helper, adapt to match — they should look almost identical.

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-task-run-logs.ts
git commit -m "feat(tasks): add live-log streaming hook"
```

---

### Task 14: Sidebar entry — add Tasks under Project group

**Files:**
- Modify: `frontend/src/components/project-sidebar.tsx`

- [ ] **Step 1: Add the entry**

Edit `frontend/src/components/project-sidebar.tsx`. In the `groups` array (around line 32), inside the `Project` group `items`, add a new entry alongside the existing ones:

```typescript
import { Play } from 'lucide-react';
// ...
{ href: 'tasks', label: 'Tasks', icon: Play },
```

Place it after the existing `pipeline` entry, before `logs`.

- [ ] **Step 2: Visual verification**

Start the frontend and navigate to a project:

```bash
cd frontend && npm run dev
```

Open `http://localhost:3000/projects/<id>/deployments` — confirm the new "Tasks" link appears in the sidebar. Clicking it 404s for now (page comes in next task) — that is expected.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/project-sidebar.tsx
git commit -m "feat(tasks): add Tasks sidebar entry"
```

---

### Task 15: Tasks list page

**Files:**
- Create: `frontend/src/app/projects/[id]/tasks/page.tsx`
- Create: `frontend/src/components/task-form-dialog.tsx`

> **Reminder:** Read `frontend/node_modules/next/dist/docs/` if any client/server boundary or routing question arises. Also look at how an existing page handles modals and form state — `frontend/src/app/projects/[id]/webhooks/page.tsx` or similar — and reuse the same Dialog primitive from `frontend/src/components/ui/`.

- [ ] **Step 1: Look at existing UI primitives**

```bash
ls frontend/src/components/ui/
cat frontend/src/components/ui/dialog.tsx 2>/dev/null | head -40
```

Note the names of the available components (Button, Dialog, Input, etc.). Use them — do not introduce new shadcn primitives.

- [ ] **Step 2: Implement TaskFormDialog**

Create `frontend/src/components/task-form-dialog.tsx` (skeleton — adapt to the actual Dialog API in this repo):

```tsx
'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// Adapt the Dialog import to whatever this repo exposes:
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: { name: string; command: string; workDir?: string | null };
  title: string;
  submitLabel: string;
  onSubmit: (values: { name: string; command: string; workDir?: string }) => Promise<void>;
}

export function TaskFormDialog({ open, onOpenChange, initial, title, submitLabel, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [workDir, setWorkDir] = useState(initial?.workDir ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setCommand(initial?.command ?? '');
      setWorkDir(initial?.workDir ?? '');
      setError(null);
    }
  }, [open, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name, command, workDir: workDir || undefined });
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="block mb-1">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="seed" required />
          </label>
          <label className="block text-sm">
            <span className="block mb-1">Command</span>
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm run seed" required className="font-mono" />
          </label>
          <label className="block text-sm">
            <span className="block mb-1">Working directory <span className="text-foreground-muted">(optional)</span></span>
            <Input value={workDir} onChange={(e) => setWorkDir(e.target.value)} placeholder="backend" />
          </label>
          {error && <p className="text-sm text-status-error">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

If the repo's Dialog primitive uses different prop names, adapt.

- [ ] **Step 3: Implement the list page**

Create `frontend/src/app/projects/[id]/tasks/page.tsx`:

```tsx
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
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-foreground/10 text-xs text-status-error">Delete</button>
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
```

Why a separate `EditTaskDialog`: `useUpdateProjectTask` needs a stable `taskId` argument. Conditionally rendering it only when `editing` is set guarantees the hook isn't created for `null`, while `editing` being passed as a non-null prop gives a stable id for the lifetime of the dialog.

- [ ] **Step 4: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean. Also remove the placeholder lines noted in the page (the `_ = update`-style comments) once `EditTaskDialog` is in place.

- [ ] **Step 5: Visual verification**

With backend + frontend running, navigate to `/projects/<id>/tasks`:

- The empty state shows.
- Clicking **+ New Task** opens the dialog.
- Submitting creates a task; it appears in the list.
- Clicking **Run** triggers a run, navigates to `/runs/<runId>` (page exists in Task 17 — until then, expect 404).
- Clicking **Edit** opens the form pre-filled.
- Clicking **Delete** prompts and removes the task.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/task-form-dialog.tsx frontend/src/app/projects/[id]/tasks/page.tsx
git commit -m "feat(tasks): add task list page and create/edit dialog"
```

---

### Task 16: Task detail page

**Files:**
- Create: `frontend/src/app/projects/[id]/tasks/[taskId]/page.tsx`

- [ ] **Step 1: Implement the page**

Create `frontend/src/app/projects/[id]/tasks/[taskId]/page.tsx`:

```tsx
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
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Visual verification**

Navigate to `/projects/<id>/tasks/<taskId>` after creating a task. Trigger a run from this page; the breadcrumb back-arrow returns to the list.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/projects/[id]/tasks/[taskId]/page.tsx
git commit -m "feat(tasks): add task detail page with run history"
```

---

### Task 17: Run page with live logs

**Files:**
- Create: `frontend/src/app/projects/[id]/tasks/[taskId]/runs/[runId]/page.tsx`

- [ ] **Step 1: Inspect the deploy log viewer to reuse**

```bash
cat frontend/src/components/deploy-log-viewer.tsx | head -80
```

If the component takes log entries with shape `{ t: number; m: string }`, it can be reused directly. If it expects a richer shape with stage indices, write a small adapter or render a simpler block of `<pre>` lines styled to match. Pick the cheaper path.

- [ ] **Step 2: Implement the page**

Create `frontend/src/app/projects/[id]/tasks/[taskId]/runs/[runId]/page.tsx`:

```tsx
'use client';
import { use, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTaskRun, useCancelTaskRun } from '@/hooks/use-project-tasks';
import { useTaskRunLogs } from '@/hooks/use-task-run-logs';

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
  const { logs, status: liveStatus } = useTaskRunLogs(runId, initial);

  const status = liveStatus ?? run?.status;
  const isLive = status === 'RUNNING' || status === 'QUEUED';

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

      <div className="border rounded-xl bg-black/40 p-4 font-mono text-xs overflow-auto max-h-[70vh]">
        {logs.length === 0 && <p className="text-foreground-muted">No output yet…</p>}
        {logs.map((line, i) => (
          <pre key={i} className="whitespace-pre-wrap leading-relaxed">{line.m}</pre>
        ))}
      </div>
    </div>
  );
}
```

> If `deploy-log-viewer.tsx` already does ANSI color rendering, swap the inner `<pre>` for that component to get colored stderr — adjust prop shape as needed. The `\x1b[31m...\x1b[0m` markers from the backend won't render unless processed.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Manual end-to-end check**

With backend + frontend running:

1. Create a task with command `for i in 1 2 3 4 5; do echo step $i; sleep 1; done`.
2. Click **Run** — the run page opens.
3. Lines stream in approximately one per second.
4. Final state shows SUCCESS, exit 0.
5. Refresh the page — logs reappear from the persisted row.
6. Run the task again with `sleep 30` and click **Cancel** while RUNNING — confirm the status flips to CANCELLED and the process is killed (no PID lingering: `ps aux | grep sleep`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/projects/[id]/tasks/[taskId]/runs/[runId]/page.tsx
git commit -m "feat(tasks): add run page with live log streaming"
```

---

### Task 18: Concurrency integration check (deploy ↔ task)

**Files:** none (verification only)

- [ ] **Step 1: Reproduce the lock conflict**

With backend running and a project that builds slowly enough to observe:

1. Trigger a deploy from `/projects/<id>/deployments` — wait until status is RUNNING.
2. From `/projects/<id>/tasks`, run a task.

Expected: the task row shows QUEUED while the deploy is still RUNNING. Once the deploy reaches SUCCESS or FAILED, the task transitions to RUNNING.

- [ ] **Step 2: Reverse direction**

1. Run a slow task (e.g. `sleep 60`).
2. While it's RUNNING, trigger a deploy.

Expected: the deploy row shows QUEUED until the task finishes.

- [ ] **Step 3: If observed behavior diverges, debug**

If both run concurrently, inspect Redis:

```bash
redis-cli get project-lock:<projectId>
```

Should be set while either runs. If empty, recheck `withLock` wiring in `deploy.processor.ts`.

---

### Task 19: Documentation

**Files:**
- Modify: `CLAUDE.md` (add a one-paragraph blurb under "Key conventions" or a new "Tasks" section)

- [ ] **Step 1: Add a short note**

Edit `CLAUDE.md` and add (under appropriate heading):

```markdown
## Project Tasks

Each project has a list of named one-off commands ("tasks") for operational
actions like seeding or cache clearing. Tasks live separately from the deploy
pipeline — they do not run on `git push`. Trigger them from `/projects/<id>/tasks`
or via `POST /api/projects/<id>/tasks/<taskId>/run`. Tasks and deploys share a
per-project mutex, so they never run concurrently against the same project.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note Project Tasks feature"
```

---

## Self-Review Checklist (run after implementing all tasks)

- [ ] All 19 tasks completed and committed
- [ ] `cd backend && npm test` passes
- [ ] `cd backend && npm run build` succeeds
- [ ] `cd frontend && npx tsc --noEmit` clean
- [ ] Manual smoke (Task 11) and concurrency check (Task 18) passed
- [ ] CLAUDE.md updated
