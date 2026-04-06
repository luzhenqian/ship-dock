# GitHub App Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual PAT token input with GitHub App integration for connecting repos and receiving webhooks automatically, while keeping manual token as fallback.

**Architecture:** New `GitHubAppModule` in the backend handles GitHub App JWT auth, installation management, and a unified webhook endpoint. Frontend adds a GitHub connection section in Settings and a repository selector in the "New Project" wizard. Existing webhook infrastructure is untouched — both paths coexist.

**Tech Stack:** NestJS 11, Prisma, Redis (token caching), React 19, TanStack Query, jsonwebtoken (App JWT signing)

---

## File Structure

### Backend — New Files
- `backend/src/github-app/github-app.module.ts` — Module registration
- `backend/src/github-app/github-app.service.ts` — JWT signing, Installation Access Token management, repo listing
- `backend/src/github-app/github-app.controller.ts` — Callback, installations CRUD, repo listing endpoints
- `backend/src/github-app/github-app-webhook.controller.ts` — Unified App-level webhook receiver
- `backend/src/github-app/github-app-webhook.guard.ts` — HMAC signature verification for App webhooks
- `backend/src/github-app/github-app.service.spec.ts` — Service tests
- `backend/src/github-app/github-app-webhook.controller.spec.ts` — Webhook controller tests

### Backend — Modified Files
- `backend/prisma/schema.prisma` — Add `GitHubInstallation` model, add relation to `Project`
- `backend/src/app.module.ts` — Import `GitHubAppModule`
- `backend/src/webhooks/webhooks.service.ts` — Add `processAppWebhookEvent()` for App-routed events
- `scripts/deploy.config.example.sh` — Add GitHub App env vars

### Frontend — New Files
- `frontend/src/hooks/use-github-app.ts` — React Query hooks for GitHub App API
- `frontend/src/components/repo-selector.tsx` — Searchable repo list with manual fallback

### Frontend — Modified Files
- `frontend/src/app/(app)/settings/page.tsx` — Add GitHub connection section
- `frontend/src/app/projects/new/page.tsx` — Integrate repo selector
- `frontend/src/app/projects/[id]/webhooks/page.tsx` — Conditional UI for App vs manual mode

---

### Task 1: Prisma Schema — Add GitHubInstallation Model

**Files:**
- Modify: `backend/prisma/schema.prisma:59-75` (User model), `backend/prisma/schema.prisma:77-111` (Project model)

- [ ] **Step 1: Add GitHubInstallation model to schema**

Add after the `WebhookEventStatus` enum (line 57) in `backend/prisma/schema.prisma`:

```prisma
model GitHubInstallation {
  id             String   @id @default(uuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  installationId Int      @unique
  accountLogin   String
  accountType    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  projects Project[]
}
```

Add to the `User` model relations (after line 74):

```prisma
  githubInstallations GitHubInstallation[]
```

Add to the `Project` model (after line 97, the `createdById` field):

```prisma
  githubInstallationId String?
  githubInstallation   GitHubInstallation? @relation(fields: [githubInstallationId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: Generate and run migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add-github-installation
```

Expected: Migration created, Prisma Client regenerated.

- [ ] **Step 3: Verify schema**

Run:
```bash
cd backend && npx prisma validate
```

Expected: "The schema is valid."

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add GitHubInstallation model and Project relation"
```

---

### Task 2: GitHub App Service — JWT and Installation Access Tokens

**Files:**
- Create: `backend/src/github-app/github-app.service.ts`
- Create: `backend/src/github-app/github-app.service.spec.ts`

- [ ] **Step 1: Install jsonwebtoken dependency**

Run:
```bash
cd backend && npm install jsonwebtoken && npm install -D @types/jsonwebtoken
```

- [ ] **Step 2: Write failing tests for GitHubAppService**

Create `backend/src/github-app/github-app.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GitHubAppService } from './github-app.service';
import { PrismaService } from '../common/prisma.service';

describe('GitHubAppService', () => {
  let service: GitHubAppService;
  let configService: ConfigService;
  let prismaService: PrismaService;

  const mockRedisGet = jest.fn();
  const mockRedisSet = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GitHubAppService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const values: Record<string, string> = {
                GITHUB_APP_ID: '12345',
                GITHUB_APP_PRIVATE_KEY: Buffer.from('test-private-key').toString('base64'),
                GITHUB_APP_WEBHOOK_SECRET: 'webhook-secret',
                GITHUB_APP_CLIENT_ID: 'client-id',
                GITHUB_APP_CLIENT_SECRET: 'client-secret',
                GITHUB_APP_SLUG: 'ship-dock',
              };
              return values[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            gitHubInstallation: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { get: mockRedisGet, set: mockRedisSet },
        },
      ],
    }).compile();

    service = module.get(GitHubAppService);
    configService = module.get(ConfigService);
    prismaService = module.get(PrismaService);
  });

  describe('getInstallationUrl', () => {
    it('should return the GitHub App installation URL', () => {
      const url = service.getInstallationUrl();
      expect(url).toBe('https://github.com/apps/ship-dock/installations/new');
    });
  });

  describe('generateAppJwt', () => {
    it('should generate a JWT signed with the app private key', () => {
      const jwt = service.generateAppJwt();
      expect(typeof jwt).toBe('string');
      expect(jwt.split('.')).toHaveLength(3);
    });
  });

  describe('saveInstallation', () => {
    it('should create a GitHubInstallation record', async () => {
      const mockInstallation = {
        id: 'uuid-1',
        userId: 'user-1',
        installationId: 99,
        accountLogin: 'octocat',
        accountType: 'User',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prismaService.gitHubInstallation.create as jest.Mock).mockResolvedValue(mockInstallation);

      const result = await service.saveInstallation('user-1', 99, 'octocat', 'User');
      expect(prismaService.gitHubInstallation.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', installationId: 99, accountLogin: 'octocat', accountType: 'User' },
      });
      expect(result).toEqual(mockInstallation);
    });
  });

  describe('getUserInstallations', () => {
    it('should return installations for a user', async () => {
      const mockInstallations = [
        { id: 'uuid-1', installationId: 99, accountLogin: 'octocat', accountType: 'User', createdAt: new Date(), updatedAt: new Date() },
      ];
      (prismaService.gitHubInstallation.findMany as jest.Mock).mockResolvedValue(mockInstallations);

      const result = await service.getUserInstallations('user-1');
      expect(prismaService.gitHubInstallation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockInstallations);
    });
  });

  describe('deleteInstallation', () => {
    it('should delete an installation owned by the user', async () => {
      const mockInstallation = { id: 'uuid-1', userId: 'user-1', installationId: 99 };
      (prismaService.gitHubInstallation.findFirst as jest.Mock).mockResolvedValue(mockInstallation);
      (prismaService.gitHubInstallation.delete as jest.Mock).mockResolvedValue(mockInstallation);

      await service.deleteInstallation('uuid-1', 'user-1');
      expect(prismaService.gitHubInstallation.delete).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });

    it('should throw NotFoundException if installation not found', async () => {
      (prismaService.gitHubInstallation.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.deleteInstallation('uuid-1', 'user-1')).rejects.toThrow('not found');
    });
  });

  describe('handleInstallationDeleted', () => {
    it('should delete installation by GitHub installationId', async () => {
      const mockInstallation = { id: 'uuid-1', installationId: 99 };
      (prismaService.gitHubInstallation.findUnique as jest.Mock).mockResolvedValue(mockInstallation);
      (prismaService.gitHubInstallation.delete as jest.Mock).mockResolvedValue(mockInstallation);

      await service.handleInstallationDeleted(99);
      expect(prismaService.gitHubInstallation.delete).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });

    it('should do nothing if installation not found', async () => {
      (prismaService.gitHubInstallation.findUnique as jest.Mock).mockResolvedValue(null);
      await service.handleInstallationDeleted(99);
      expect(prismaService.gitHubInstallation.delete).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd backend && npx jest github-app.service.spec --no-coverage
```

Expected: FAIL — module `./github-app.service` not found.

- [ ] **Step 4: Write GitHubAppService implementation**

Create `backend/src/github-app/github-app.service.ts`:

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../common/prisma.service';
import Redis from 'ioredis';

@Injectable()
export class GitHubAppService {
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly webhookSecret: string;
  private readonly slug: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {
    this.appId = this.config.getOrThrow('GITHUB_APP_ID');
    this.privateKey = Buffer.from(
      this.config.getOrThrow('GITHUB_APP_PRIVATE_KEY'),
      'base64',
    ).toString('utf8');
    this.webhookSecret = this.config.getOrThrow('GITHUB_APP_WEBHOOK_SECRET');
    this.slug = this.config.getOrThrow('GITHUB_APP_SLUG');
  }

  getInstallationUrl(): string {
    return `https://github.com/apps/${this.slug}/installations/new`;
  }

  getWebhookSecret(): string {
    return this.webhookSecret;
  }

  generateAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iat: now - 60, exp: now + 600, iss: this.appId },
      this.privateKey,
      { algorithm: 'RS256' },
    );
  }

  async getInstallationAccessToken(installationId: number): Promise<string> {
    const cacheKey = `github:iat:${installationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const appJwt = this.generateAppJwt();
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to get installation token: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    await this.redis.set(cacheKey, data.token, 'EX', 3300); // 55 min TTL
    return data.token;
  }

  async listRepositories(installationId: number): Promise<{ id: number; full_name: string; name: string; private: boolean; default_branch: string }[]> {
    const token = await this.getInstallationAccessToken(installationId);
    const repos: any[] = [];
    let page = 1;

    while (true) {
      const res = await fetch(
        `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      if (!res.ok) break;
      const data = await res.json();
      repos.push(...data.repositories);
      if (data.repositories.length < 100) break;
      page++;
    }

    return repos.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      name: r.name,
      private: r.private,
      default_branch: r.default_branch,
    }));
  }

  async saveInstallation(userId: string, installationId: number, accountLogin: string, accountType: string) {
    return this.prisma.gitHubInstallation.create({
      data: { userId, installationId, accountLogin, accountType },
    });
  }

  async getUserInstallations(userId: string) {
    return this.prisma.gitHubInstallation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteInstallation(id: string, userId: string) {
    const installation = await this.prisma.gitHubInstallation.findFirst({
      where: { id, userId },
    });
    if (!installation) throw new NotFoundException('Installation not found');
    return this.prisma.gitHubInstallation.delete({ where: { id } });
  }

  async handleInstallationDeleted(installationId: number) {
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { installationId },
    });
    if (!installation) return;
    await this.prisma.gitHubInstallation.delete({ where: { id: installation.id } });
  }

  async findProjectByRepo(repoFullName: string) {
    const repoUrl = `https://github.com/${repoFullName}`;
    return this.prisma.project.findFirst({
      where: {
        OR: [
          { repoUrl },
          { repoUrl: `${repoUrl}.git` },
        ],
        githubInstallationId: { not: null },
      },
    });
  }
}
```

- [ ] **Step 5: Run tests**

Run:
```bash
cd backend && npx jest github-app.service.spec --no-coverage
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/github-app/github-app.service.ts backend/src/github-app/github-app.service.spec.ts backend/package.json backend/package-lock.json
git commit -m "feat: add GitHubAppService with JWT auth and installation management"
```

---

### Task 3: GitHub App Webhook Guard

**Files:**
- Create: `backend/src/github-app/github-app-webhook.guard.ts`

- [ ] **Step 1: Write the guard**

Create `backend/src/github-app/github-app-webhook.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { GitHubAppService } from './github-app.service';

@Injectable()
export class GitHubAppWebhookGuard implements CanActivate {
  constructor(private githubApp: GitHubAppService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) throw new ForbiddenException('Missing signature header');

    const payload = req.rawBody as Buffer;
    const secret = this.githubApp.getWebhookSecret();
    const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

    try {
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        throw new ForbiddenException('Invalid webhook signature');
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/github-app/github-app-webhook.guard.ts
git commit -m "feat: add webhook signature guard for GitHub App"
```

---

### Task 4: GitHub App Webhook Controller

**Files:**
- Create: `backend/src/github-app/github-app-webhook.controller.ts`
- Create: `backend/src/github-app/github-app-webhook.controller.spec.ts`
- Modify: `backend/src/webhooks/webhooks.service.ts`

- [ ] **Step 1: Add processAppWebhookEvent to WebhooksService**

This method is like `processWebhookEvent` but looks up the project by repo URL instead of requiring a projectId, and doesn't require a `WebhookConfig` record — it uses the project's own filter settings.

Add to the end of `backend/src/webhooks/webhooks.service.ts` (before the closing `}`):

```typescript
  async processAppWebhookEvent(args: {
    repoFullName: string;
    deliveryId: string;
    event: string;
    headers: Record<string, string>;
    payload: any;
  }) {
    const repoUrl = `https://github.com/${args.repoFullName}`;
    const project = await this.prisma.project.findFirst({
      where: {
        OR: [{ repoUrl }, { repoUrl: `${repoUrl}.git` }],
        githubInstallationId: { not: null },
      },
    });
    if (!project) return;

    const existing = await this.prisma.webhookEvent.findUnique({ where: { deliveryId: args.deliveryId } });
    if (existing) return;

    const parsed = this.githubProvider.parsePayload(args.event, args.payload);
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        projectId: project.id,
        provider: 'GITHUB',
        deliveryId: args.deliveryId,
        event: args.event,
        action: args.payload.action || null,
        headers: args.headers,
        payload: args.payload,
        status: 'RECEIVED',
      },
    });

    // Default events for App-connected projects: push and merged pull_request
    const enabledEvents = ['push', 'pull_request', 'release', 'create', 'delete'];
    const eventCheck = this.filter.matchEvent(
      args.event, args.payload.action || null, enabledEvents,
      args.event === 'pull_request' ? args.payload.pull_request?.merged : undefined,
    );
    if (!eventCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: eventCheck.reason, processedAt: new Date() },
      });
      return;
    }

    // Use webhook config filters if they exist (for branch/path filtering)
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId: project.id } });
    const branchFilters = config ? (config.branchFilters as string[]) : [];
    const pathFilters = config ? (config.pathFilters as string[]) : [];

    if (branchFilters.length > 0) {
      const branchCheck = this.filter.matchBranch(parsed.branch, branchFilters);
      if (!branchCheck.pass) {
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: 'FILTERED', filterReason: branchCheck.reason, processedAt: new Date() },
        });
        return;
      }
    }

    if (pathFilters.length > 0) {
      const pathCheck = this.filter.matchPaths(parsed.changedFiles, pathFilters);
      if (!pathCheck.pass) {
        await this.prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: 'FILTERED', filterReason: pathCheck.reason, processedAt: new Date() },
        });
        return;
      }
    }

    try {
      const deployment = await this.deployService.trigger(project.id, project.createdById);
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'TRIGGERED', deploymentId: deployment.id, processedAt: new Date() },
      });
    } catch (err: any) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', error: err.message, processedAt: new Date() },
      });
    }
  }
```

- [ ] **Step 2: Write failing tests for the webhook controller**

Create `backend/src/github-app/github-app-webhook.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { GitHubAppWebhookController } from './github-app-webhook.controller';
import { GitHubAppService } from './github-app.service';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('GitHubAppWebhookController', () => {
  let controller: GitHubAppWebhookController;
  let githubAppService: GitHubAppService;
  let webhooksService: WebhooksService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [GitHubAppWebhookController],
      providers: [
        {
          provide: GitHubAppService,
          useValue: {
            handleInstallationDeleted: jest.fn(),
          },
        },
        {
          provide: WebhooksService,
          useValue: {
            processAppWebhookEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(GitHubAppWebhookController);
    githubAppService = module.get(GitHubAppService);
    webhooksService = module.get(WebhooksService);
  });

  it('should handle push events by routing to processAppWebhookEvent', async () => {
    const req = {
      headers: {
        'x-github-delivery': 'delivery-123',
        'x-github-event': 'push',
      },
      body: { repository: { full_name: 'octocat/hello-world' } },
    };

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.receive(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(webhooksService.processAppWebhookEvent).toHaveBeenCalledWith({
      repoFullName: 'octocat/hello-world',
      deliveryId: 'delivery-123',
      event: 'push',
      headers: req.headers,
      payload: req.body,
    });
  });

  it('should handle installation.deleted events', async () => {
    const req = {
      headers: {
        'x-github-delivery': 'delivery-456',
        'x-github-event': 'installation',
      },
      body: { action: 'deleted', installation: { id: 99 } },
    };

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.receive(req as any, res as any);

    expect(githubAppService.handleInstallationDeleted).toHaveBeenCalledWith(99);
  });

  it('should return 400 for missing headers', async () => {
    const req = { headers: {}, body: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.receive(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd backend && npx jest github-app-webhook.controller.spec --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write GitHubAppWebhookController**

Create `backend/src/github-app/github-app-webhook.controller.ts`:

```typescript
import { Controller, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { GitHubAppWebhookGuard } from './github-app-webhook.guard';
import { GitHubAppService } from './github-app.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Controller('webhooks')
export class GitHubAppWebhookController {
  private readonly logger = new Logger(GitHubAppWebhookController.name);

  constructor(
    private githubApp: GitHubAppService,
    private webhooksService: WebhooksService,
  ) {}

  @Post('github')
  @UseGuards(ThrottlerGuard, GitHubAppWebhookGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async receive(@Req() req: Request, @Res() res: Response) {
    const deliveryId = req.headers['x-github-delivery'] as string;
    const event = req.headers['x-github-event'] as string;

    if (!deliveryId || !event) {
      return res.status(400).json({ message: 'Missing GitHub headers' });
    }

    res.status(200).json({ received: true });

    try {
      if (event === 'installation') {
        const action = req.body?.action;
        if (action === 'deleted') {
          await this.githubApp.handleInstallationDeleted(req.body.installation.id);
        }
        return;
      }

      const repoFullName = req.body?.repository?.full_name;
      if (!repoFullName) {
        this.logger.debug(`No repository in ${event} event ${deliveryId}, ignoring`);
        return;
      }

      await this.webhooksService.processAppWebhookEvent({
        repoFullName,
        deliveryId,
        event,
        headers: req.headers as Record<string, string>,
        payload: req.body,
      });
    } catch (err: any) {
      this.logger.error(`Failed to process app webhook ${deliveryId}: ${err.message}`, err.stack);
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run:
```bash
cd backend && npx jest github-app-webhook.controller.spec --no-coverage
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/github-app/github-app-webhook.controller.ts backend/src/github-app/github-app-webhook.controller.spec.ts backend/src/webhooks/webhooks.service.ts
git commit -m "feat: add unified GitHub App webhook endpoint"
```

---

### Task 5: GitHub App Controller — Callback, Installations, Repos

**Files:**
- Create: `backend/src/github-app/github-app.controller.ts`

- [ ] **Step 1: Write GitHubAppController**

Create `backend/src/github-app/github-app.controller.ts`:

```typescript
import { Controller, Delete, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MinRole } from '../auth/decorators/min-role.decorator';
import { GitHubAppService } from './github-app.service';

@Controller('github')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GitHubAppController {
  constructor(private githubApp: GitHubAppService) {}

  @Get('installation-url')
  getInstallationUrl() {
    return { url: this.githubApp.getInstallationUrl() };
  }

  @Get('callback')
  async handleCallback(
    @Query('installation_id') installationIdStr: string,
    @Query('setup_action') setupAction: string,
    @Req() req: any,
  ) {
    if (setupAction !== 'install' && setupAction !== 'update') {
      return { success: false, message: 'Unsupported setup action' };
    }

    const installationId = parseInt(installationIdStr, 10);
    if (isNaN(installationId)) {
      return { success: false, message: 'Invalid installation_id' };
    }

    // Verify the installation exists by fetching its info from GitHub
    const appJwt = this.githubApp.generateAppJwt();
    const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      return { success: false, message: 'Installation not found on GitHub' };
    }

    const installationData = await res.json();
    const installation = await this.githubApp.saveInstallation(
      req.user.id,
      installationId,
      installationData.account.login,
      installationData.account.type,
    );

    return { success: true, installation };
  }

  @Get('installations')
  async listInstallations(@Req() req: any) {
    return this.githubApp.getUserInstallations(req.user.id);
  }

  @Get('repositories')
  @MinRole('DEVELOPER')
  async listRepositories(@Query('installationId') installationId: string) {
    return this.githubApp.listRepositories(parseInt(installationId, 10));
  }

  @Delete('installations/:id')
  @MinRole('ADMIN')
  async deleteInstallation(@Param('id') id: string, @Req() req: any) {
    await this.githubApp.deleteInstallation(id, req.user.id);
    return { success: true };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/github-app/github-app.controller.ts
git commit -m "feat: add GitHub App controller for callback and installation management"
```

---

### Task 6: GitHub App Module and Registration

**Files:**
- Create: `backend/src/github-app/github-app.module.ts`
- Modify: `backend/src/app.module.ts:39`
- Modify: `backend/src/webhooks/webhooks.module.ts`

- [ ] **Step 1: Create the module**

Create `backend/src/github-app/github-app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { GitHubAppService } from './github-app.service';
import { GitHubAppController } from './github-app.controller';
import { GitHubAppWebhookController } from './github-app-webhook.controller';
import { GitHubAppWebhookGuard } from './github-app-webhook.guard';

@Module({
  imports: [WebhooksModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])],
  controllers: [GitHubAppController, GitHubAppWebhookController],
  providers: [
    GitHubAppService,
    GitHubAppWebhookGuard,
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get('REDIS_URL', 'redis://localhost:6379');
        return new Redis(url);
      },
    },
  ],
  exports: [GitHubAppService],
})
export class GitHubAppModule {}
```

- [ ] **Step 2: Export WebhooksService from WebhooksModule**

In `backend/src/webhooks/webhooks.module.ts`, add exports so GitHubAppModule can use WebhooksService:

```typescript
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DeployModule } from '../deploy/deploy.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksReceiverController } from './webhooks-receiver.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksFilterService } from './webhooks-filter.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

@Module({
  imports: [DeployModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }])],
  controllers: [WebhooksController, WebhooksReceiverController],
  providers: [WebhooksService, WebhooksFilterService, WebhookSignatureGuard],
  exports: [WebhooksService],
})
export class WebhooksModule {}
```

- [ ] **Step 3: Register GitHubAppModule in AppModule**

In `backend/src/app.module.ts`, add the import:

```typescript
import { GitHubAppModule } from './github-app/github-app.module';
```

And add `GitHubAppModule` to the imports array (after `WebhooksModule` on line 39).

- [ ] **Step 4: Update deploy config example**

Add to the end of `scripts/deploy.config.example.sh`:

```bash

# ── GitHub App (optional — for OAuth-based repo connection) ──
GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""          # Base64-encoded PEM private key
GITHUB_APP_WEBHOOK_SECRET=""
GITHUB_APP_CLIENT_ID=""
GITHUB_APP_CLIENT_SECRET=""
GITHUB_APP_SLUG=""
```

- [ ] **Step 5: Verify the app compiles**

Run:
```bash
cd backend && npx nest build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/github-app/github-app.module.ts backend/src/webhooks/webhooks.module.ts backend/src/app.module.ts scripts/deploy.config.example.sh
git commit -m "feat: register GitHubAppModule and export WebhooksService"
```

---

### Task 7: Frontend — React Query Hooks for GitHub App

**Files:**
- Create: `frontend/src/hooks/use-github-app.ts`

- [ ] **Step 1: Write the hooks**

Create `frontend/src/hooks/use-github-app.ts`:

```typescript
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface GitHubInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  createdAt: string;
  updatedAt: string;
}

interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
}

export function useGitHubInstallationUrl() {
  return useQuery<{ url: string }>({
    queryKey: ['github-installation-url'],
    queryFn: () => api('/github/installation-url'),
  });
}

export function useGitHubInstallations() {
  return useQuery<GitHubInstallation[]>({
    queryKey: ['github-installations'],
    queryFn: () => api('/github/installations'),
  });
}

export function useGitHubRepositories(installationId: number | null) {
  return useQuery<GitHubRepo[]>({
    queryKey: ['github-repos', installationId],
    queryFn: () => api(`/github/repositories?installationId=${installationId}`),
    enabled: !!installationId,
  });
}

export function useGitHubCallback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { installation_id: string; setup_action: string }) =>
      api(`/github/callback?installation_id=${params.installation_id}&setup_action=${params.setup_action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['github-installations'] }),
  });
}

export function useDeleteGitHubInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/github/installations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['github-installations'] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-github-app.ts
git commit -m "feat: add React Query hooks for GitHub App integration"
```

---

### Task 8: Frontend — Settings Page GitHub Connection Section

**Files:**
- Modify: `frontend/src/app/(app)/settings/page.tsx`

**Important flow note:** The GitHub App setup redirect URL should point to the frontend settings page (e.g., `https://app.shipdock.dev/settings?installation_id=xxx&setup_action=install`). When creating the GitHub App on GitHub, set the "Setup URL" to the frontend settings page URL. The frontend then calls the backend API with the `installation_id` param to complete the connection.

- [ ] **Step 1: Rewrite the settings page to include GitHub connection**

Replace the full contents of `frontend/src/app/(app)/settings/page.tsx`:

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useGitHubInstallations, useGitHubInstallationUrl, useGitHubCallback, useDeleteGitHubInstallation } from '@/hooks/use-github-app';
import { Github, Trash2, Loader2, ExternalLink } from 'lucide-react';

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const { data: installations, isLoading: installationsLoading } = useGitHubInstallations();
  const { data: urlData } = useGitHubInstallationUrl();
  const callback = useGitHubCallback();
  const deleteInstallation = useDeleteGitHubInstallation();
  const callbackHandled = useRef(false);

  useEffect(() => {
    if (callbackHandled.current) return;
    const installationId = searchParams.get('installation_id');
    const setupAction = searchParams.get('setup_action');
    if (installationId && setupAction) {
      callbackHandled.current = true;
      callback.mutate({ installation_id: installationId, setup_action: setupAction });
      window.history.replaceState({}, '', '/settings');
    }
  }, [searchParams]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Server Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Projects Directory</Label><Input value="/var/www" disabled /></div>
          <div><Label>Port Range</Label><Input value="3001 - 3999" disabled /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              GitHub Connection
            </CardTitle>
            {urlData?.url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = urlData.url}
              >
                <Github className="mr-2 h-4 w-4" />
                Connect GitHub
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {callback.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting GitHub...
            </div>
          )}

          {installationsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : installations && installations.length > 0 ? (
            <div className="space-y-3">
              {installations.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Github className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{inst.accountLogin}</p>
                      <p className="text-xs text-muted-foreground">
                        {inst.accountType} &middot; Connected {new Date(inst.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(`https://github.com/settings/installations`, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteInstallation.mutate(inst.id)}
                      disabled={deleteInstallation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No GitHub accounts connected. Connect GitHub to select repositories when creating projects and receive webhooks automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/\(app\)/settings/page.tsx
git commit -m "feat: add GitHub connection section to settings page"
```

---

### Task 9: Frontend — Repository Selector Component

**Files:**
- Create: `frontend/src/components/repo-selector.tsx`

- [ ] **Step 1: Write the repo selector component**

Create `frontend/src/components/repo-selector.tsx`:

```tsx
'use client';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGitHubInstallations, useGitHubRepositories } from '@/hooks/use-github-app';
import { Github, Search, Lock, Globe, ChevronDown, Loader2 } from 'lucide-react';

interface RepoSelectorProps {
  onSelect: (repoUrl: string, defaultBranch: string) => void;
  onSwitchToManual: () => void;
}

export function RepoSelector({ onSelect, onSwitchToManual }: RepoSelectorProps) {
  const { data: installations, isLoading: installationsLoading } = useGitHubInstallations();
  const [selectedInstallation, setSelectedInstallation] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const activeInstallationId = selectedInstallation ?? installations?.[0]?.installationId ?? null;
  const { data: repos, isLoading: reposLoading } = useGitHubRepositories(activeInstallationId);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!search) return repos;
    const lower = search.toLowerCase();
    return repos.filter((r) => r.full_name.toLowerCase().includes(lower));
  }, [repos, search]);

  if (installationsLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading GitHub connections...
      </div>
    );
  }

  if (!installations || installations.length === 0) {
    return null; // Parent should show manual input
  }

  return (
    <div className="space-y-3">
      {installations.length > 1 && (
        <div className="flex gap-2">
          {installations.map((inst) => (
            <Button
              key={inst.id}
              variant={activeInstallationId === inst.installationId ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedInstallation(inst.installationId)}
            >
              <Github className="mr-1.5 h-3.5 w-3.5" />
              {inst.accountLogin}
            </Button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
        {reposLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading repositories...
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {search ? 'No matching repositories' : 'No repositories found'}
          </div>
        ) : (
          filteredRepos.map((repo) => (
            <button
              key={repo.id}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              onClick={() => onSelect(`https://github.com/${repo.full_name}`, repo.default_branch)}
            >
              <div className="flex items-center gap-2">
                {repo.private ? (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{repo.full_name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{repo.default_branch}</span>
            </button>
          ))
        )}
      </div>

      <button
        className="text-xs text-muted-foreground hover:text-foreground underline"
        onClick={onSwitchToManual}
      >
        Enter repository URL manually instead
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/repo-selector.tsx
git commit -m "feat: add searchable repository selector component"
```

---

### Task 10: Frontend — Integrate Repo Selector into New Project Page

**Files:**
- Modify: `frontend/src/app/projects/new/page.tsx`

- [ ] **Step 1: Add repo selector import and state**

At the top of `frontend/src/app/projects/new/page.tsx`, add the import (after the existing imports around line 11):

```typescript
import { RepoSelector } from '@/components/repo-selector';
import { useGitHubInstallations } from '@/hooks/use-github-app';
```

- [ ] **Step 2: Add state for manual mode toggle**

Inside the component function body, add state (near the existing state declarations):

```typescript
const { data: githubInstallations } = useGitHubInstallations();
const hasGitHubConnection = (githubInstallations?.length ?? 0) > 0;
const [manualRepoInput, setManualRepoInput] = useState(false);
```

- [ ] **Step 3: Replace the repo URL input section**

Find the repo URL input section in the "source" step (around lines 408-415 where the GitHub URL input is). Wrap it with the repo selector:

When `sourceType === 'GITHUB'`, replace the plain URL input with:

```tsx
{sourceType === 'GITHUB' && hasGitHubConnection && !manualRepoInput ? (
  <RepoSelector
    onSelect={(url, defaultBranch) => {
      setRepoUrl(url);
      setBranch(defaultBranch);
      setManualRepoInput(false);
    }}
    onSwitchToManual={() => setManualRepoInput(true)}
  />
) : sourceType === 'GITHUB' ? (
  <>
    {/* existing repo URL input and branch selector */}
    {hasGitHubConnection && (
      <button
        className="text-xs text-muted-foreground hover:text-foreground underline"
        onClick={() => { setManualRepoInput(false); setRepoUrl(''); }}
      >
        Select from connected GitHub repositories instead
      </button>
    )}
  </>
) : null}
```

The exact edit depends on the surrounding JSX structure. Keep the existing URL input and branch selector code for the manual path — just wrap it with the conditional.

- [ ] **Step 4: Verify the frontend compiles**

Run:
```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/projects/new/page.tsx
git commit -m "feat: integrate repo selector into new project wizard"
```

---

### Task 11: Frontend — Conditional Webhook Page for App-Connected Projects

**Files:**
- Modify: `frontend/src/app/projects/[id]/webhooks/page.tsx`

- [ ] **Step 1: Add a query to check if the project uses GitHub App**

At the top of the webhooks page component, after the existing hooks, add a check for whether the project has a `githubInstallationId`. Use the existing project query (from `use-projects.ts`):

```typescript
import { useProject } from '@/hooks/use-projects';
```

Then inside the component:

```typescript
const { data: project } = useProject(projectId);
const isAppConnected = !!project?.githubInstallationId;
```

- [ ] **Step 2: Add conditional banner for App-connected projects**

Before the existing webhook setup dialog, add a conditional section:

```tsx
{isAppConnected && !config && (
  <Card>
    <CardContent className="flex items-center gap-3 py-6">
      <Github className="h-5 w-5 text-muted-foreground" />
      <div>
        <p className="font-medium">Webhooks are automatically configured via GitHub App</p>
        <p className="text-sm text-muted-foreground">
          Push events from your repository will automatically trigger deployments. You can optionally configure branch and path filters below.
        </p>
      </div>
    </CardContent>
  </Card>
)}
```

The existing manual setup dialog should only show when `!isAppConnected`:

```tsx
{!isAppConnected && !config && (
  // ... existing setup dialog ...
)}
```

The event log and filter configuration sections remain visible in both modes.

- [ ] **Step 3: Ensure the project API returns githubInstallationId**

Check that the `useProject` hook's response includes `githubInstallationId`. If the backend project query doesn't include it by default, add it to the project select/response in the projects controller. Since it's a direct field on the Project model, Prisma will include it by default.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/projects/\[id\]/webhooks/page.tsx
git commit -m "feat: show auto-configured webhook status for App-connected projects"
```

---

### Task 12: Deploy Script — Add GitHub App Environment Variables

**Files:**
- Modify: `scripts/deploy.sh` or `scripts/deploy-remote.sh` (whichever passes env vars to the app)

- [ ] **Step 1: Find where env vars are passed to the backend**

Check how existing env vars like `JWT_SECRET` are passed from `deploy.config.sh` to the running application. Add the GitHub App env vars in the same pattern.

- [ ] **Step 2: Add the GitHub App env vars to the deploy script**

Add these to the env var section:

```bash
GITHUB_APP_ID="${GITHUB_APP_ID:-}"
GITHUB_APP_PRIVATE_KEY="${GITHUB_APP_PRIVATE_KEY:-}"
GITHUB_APP_WEBHOOK_SECRET="${GITHUB_APP_WEBHOOK_SECRET:-}"
GITHUB_APP_CLIENT_ID="${GITHUB_APP_CLIENT_ID:-}"
GITHUB_APP_CLIENT_SECRET="${GITHUB_APP_CLIENT_SECRET:-}"
GITHUB_APP_SLUG="${GITHUB_APP_SLUG:-}"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/
git commit -m "feat: add GitHub App env vars to deploy scripts"
```

---

### Task 13: End-to-End Verification

- [ ] **Step 1: Run all backend tests**

Run:
```bash
cd backend && npx jest --no-coverage
```

Expected: All tests pass including new GitHub App tests.

- [ ] **Step 2: Verify backend builds**

Run:
```bash
cd backend && npx nest build
```

Expected: Build succeeds.

- [ ] **Step 3: Verify frontend builds**

Run:
```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test (local dev)**

1. Start backend: `cd backend && npm run start:dev`
2. Start frontend: `cd frontend && npm run dev`
3. Verify Settings page shows "GitHub Connection" section
4. Verify New Project page shows repo selector (or manual input if no GitHub connection)
5. Verify existing webhook page still works for manual-token projects

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found in e2e verification"
```
