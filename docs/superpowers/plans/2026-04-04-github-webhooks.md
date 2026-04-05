# GitHub Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Webhook support so projects can auto-deploy when code is pushed, PRs are merged, or releases are published.

**Architecture:** New `webhooks` NestJS module with provider-based design (GitHub first, extensible). Public receiver endpoint with HMAC signature auth, config management API with JWT/RBAC, full audit log with replay. Frontend adds a Webhooks page in the project sidebar.

**Tech Stack:** NestJS 11, Prisma 6, class-validator, crypto (HMAC-SHA256), minimatch (glob filtering), @nestjs/throttler (rate limiting), React Query, Shadcn UI

---

## File Map

### Backend — New Files

| File | Responsibility |
|------|---------------|
| `backend/src/webhooks/webhooks.module.ts` | NestJS module registration |
| `backend/src/webhooks/webhooks.controller.ts` | Config CRUD + audit log API (JWT + RBAC) |
| `backend/src/webhooks/webhooks-receiver.controller.ts` | Public endpoint for GitHub callbacks |
| `backend/src/webhooks/webhooks.service.ts` | Config management, event processing |
| `backend/src/webhooks/webhooks-filter.service.ts` | Branch and path filtering |
| `backend/src/webhooks/guards/webhook-signature.guard.ts` | HMAC-SHA256 signature verification |
| `backend/src/webhooks/providers/webhook-provider.interface.ts` | Abstract provider interface |
| `backend/src/webhooks/providers/github.provider.ts` | GitHub API integration |
| `backend/src/webhooks/dto/create-webhook.dto.ts` | Validation DTO for creating webhook config |
| `backend/src/webhooks/dto/update-webhook.dto.ts` | Validation DTO for updating webhook config |
| `backend/src/webhooks/webhooks.service.spec.ts` | Service unit tests |
| `backend/src/webhooks/webhooks-filter.service.spec.ts` | Filter logic unit tests |
| `backend/src/webhooks/guards/webhook-signature.guard.spec.ts` | Signature guard tests |
| `backend/src/webhooks/providers/github.provider.spec.ts` | GitHub provider tests |

### Backend — Modified Files

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add enums + WebhookConfig + WebhookEvent models |
| `backend/src/app.module.ts` | Import WebhooksModule |
| `backend/src/main.ts` | Enable rawBody for signature verification |

### Frontend — New Files

| File | Responsibility |
|------|---------------|
| `frontend/src/hooks/use-webhooks.ts` | React Query hooks for webhook config + events |
| `frontend/src/app/projects/[id]/webhooks/page.tsx` | Webhooks page |

### Frontend — Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/project-sidebar.tsx` | Add Webhooks nav item |

---

## Task 1: Prisma Schema — Add Webhook Models

**Files:**
- Modify: `backend/prisma/schema.prisma:39-45` (after ServiceType enum)
- Modify: `backend/prisma/schema.prisma:63-89` (Project model, add relations)
- Modify: `backend/prisma/schema.prisma:91-109` (Deployment model, add relation)

- [ ] **Step 1: Add new enums after ServiceType enum (line 45)**

In `backend/prisma/schema.prisma`, add after the `ServiceType` enum closing brace:

```prisma
enum WebhookProvider {
  GITHUB
}

enum WebhookEventStatus {
  RECEIVED
  FILTERED
  TRIGGERED
  FAILED
  REPLAYED
}
```

- [ ] **Step 2: Add WebhookConfig model at end of file**

```prisma
model WebhookConfig {
  id              String          @id @default(uuid())
  projectId       String          @unique
  project         Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  enabled         Boolean         @default(true)
  secret          String
  githubToken     String
  githubWebhookId Int?
  events          Json
  branchFilters   Json            @default("[]")
  pathFilters     Json            @default("[]")
  provider        WebhookProvider @default(GITHUB)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}

model WebhookEvent {
  id           String             @id @default(uuid())
  projectId    String
  project      Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  provider     WebhookProvider
  deliveryId   String             @unique
  event        String
  action       String?
  headers      Json
  payload      Json
  status       WebhookEventStatus @default(RECEIVED)
  filterReason String?
  deploymentId String?
  deployment   Deployment?        @relation(fields: [deploymentId], references: [id])
  error        String?
  processedAt  DateTime?
  createdAt    DateTime           @default(now())

  @@index([projectId, createdAt])
}
```

- [ ] **Step 3: Add relations to Project model**

In the `Project` model, after the `services` relation line, add:

```prisma
  webhookConfig  WebhookConfig?
  webhookEvents  WebhookEvent[]
```

- [ ] **Step 4: Add relation to Deployment model**

In the `Deployment` model, after the `createdAt` line (before `@@index`), add:

```prisma
  webhookEvent WebhookEvent?
```

- [ ] **Step 5: Run migration**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx prisma migrate dev --name add-webhook-models`
Expected: Migration created successfully, Prisma Client generated.

- [ ] **Step 6: Verify generated client**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 7: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(webhooks): add WebhookConfig and WebhookEvent prisma models"
```

---

## Task 2: Provider Interface and GitHub Provider

**Files:**
- Create: `backend/src/webhooks/providers/webhook-provider.interface.ts`
- Create: `backend/src/webhooks/providers/github.provider.ts`
- Create: `backend/src/webhooks/providers/github.provider.spec.ts`

- [ ] **Step 1: Write the provider interface**

Create `backend/src/webhooks/providers/webhook-provider.interface.ts`:

```typescript
export interface ParsedWebhookEvent {
  branch: string | null;
  commitHash: string | null;
  changedFiles: string[];
  sender: string;
  message: string;
}

export interface WebhookProviderInterface {
  registerWebhook(
    repoUrl: string,
    callbackUrl: string,
    secret: string,
    events: string[],
    token: string,
  ): Promise<{ webhookId: number }>;

  updateWebhook(
    repoUrl: string,
    webhookId: number,
    events: string[],
    token: string,
  ): Promise<void>;

  deleteWebhook(
    repoUrl: string,
    webhookId: number,
    token: string,
  ): Promise<void>;

  verifySignature(payload: Buffer, signature: string, secret: string): boolean;

  parsePayload(event: string, payload: any): ParsedWebhookEvent;
}
```

- [ ] **Step 2: Write the failing tests for GitHub provider**

Create `backend/src/webhooks/providers/github.provider.spec.ts`:

```typescript
import { GitHubProvider } from './github.provider';

describe('GitHubProvider', () => {
  let provider: GitHubProvider;

  beforeEach(() => {
    provider = new GitHubProvider();
  });

  describe('verifySignature', () => {
    it('should return true for valid signature', () => {
      const secret = 'test-secret';
      const payload = Buffer.from('{"action":"push"}');
      const crypto = require('crypto');
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(provider.verifySignature(payload, expected, secret)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const payload = Buffer.from('{"action":"push"}');
      expect(provider.verifySignature(payload, 'sha256=invalid', 'secret')).toBe(false);
    });
  });

  describe('parsePayload', () => {
    it('should parse push event', () => {
      const payload = {
        ref: 'refs/heads/main',
        after: 'abc123',
        pusher: { name: 'user1' },
        head_commit: { message: 'fix: bug' },
        commits: [
          { added: ['new.ts'], modified: ['old.ts'], removed: ['gone.ts'] },
        ],
      };
      const result = provider.parsePayload('push', payload);
      expect(result).toEqual({
        branch: 'main',
        commitHash: 'abc123',
        changedFiles: ['new.ts', 'old.ts', 'gone.ts'],
        sender: 'user1',
        message: 'fix: bug',
      });
    });

    it('should parse pull_request event', () => {
      const payload = {
        action: 'closed',
        pull_request: {
          merged: true,
          base: { ref: 'main' },
          merge_commit_sha: 'def456',
          title: 'feat: new feature',
          changed_files: 3,
        },
        sender: { login: 'user2' },
      };
      const result = provider.parsePayload('pull_request', payload);
      expect(result).toEqual({
        branch: 'main',
        commitHash: 'def456',
        changedFiles: [],
        sender: 'user2',
        message: 'feat: new feature',
      });
    });

    it('should parse release event', () => {
      const payload = {
        release: {
          target_commitish: 'main',
          tag_name: 'v1.0.0',
          name: 'Release 1.0',
        },
        sender: { login: 'user3' },
      };
      const result = provider.parsePayload('release', payload);
      expect(result).toEqual({
        branch: 'main',
        commitHash: null,
        changedFiles: [],
        sender: 'user3',
        message: 'Release 1.0',
      });
    });
  });

  describe('parseRepoUrl', () => {
    it('should extract owner and repo from HTTPS URL', () => {
      expect((provider as any).parseRepoUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should extract owner and repo from URL with .git suffix', () => {
      expect((provider as any).parseRepoUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/providers/github.provider.spec.ts --no-coverage`
Expected: FAIL — `Cannot find module './github.provider'`

- [ ] **Step 4: Implement the GitHub provider**

Create `backend/src/webhooks/providers/github.provider.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ParsedWebhookEvent, WebhookProviderInterface } from './webhook-provider.interface';

export class GitHubProvider implements WebhookProviderInterface {
  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!match) throw new BadRequestException('Invalid GitHub URL');
    return { owner: match[1], repo: match[2] };
  }

  async registerWebhook(
    repoUrl: string,
    callbackUrl: string,
    secret: string,
    events: string[],
    token: string,
  ): Promise<{ webhookId: number }> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ShipDock',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events,
        config: { url: callbackUrl, content_type: 'json', secret, insecure_ssl: '0' },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new BadRequestException(`GitHub API error: ${err.message}`);
    }
    const data = await res.json();
    return { webhookId: data.id };
  }

  async updateWebhook(
    repoUrl: string,
    webhookId: number,
    events: string[],
    token: string,
  ): Promise<void> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${webhookId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ShipDock',
      },
      body: JSON.stringify({ events, active: true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new BadRequestException(`GitHub API error: ${err.message}`);
    }
  }

  async deleteWebhook(
    repoUrl: string,
    webhookId: number,
    token: string,
  ): Promise<void> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${webhookId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ShipDock',
      },
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new BadRequestException(`GitHub API error: ${err.message}`);
    }
  }

  verifySignature(payload: Buffer, signature: string, secret: string): boolean {
    const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parsePayload(event: string, payload: any): ParsedWebhookEvent {
    switch (event) {
      case 'push':
        return {
          branch: payload.ref?.replace('refs/heads/', '') || null,
          commitHash: payload.after || null,
          changedFiles: (payload.commits || []).flatMap((c: any) => [
            ...(c.added || []),
            ...(c.modified || []),
            ...(c.removed || []),
          ]),
          sender: payload.pusher?.name || 'unknown',
          message: payload.head_commit?.message || '',
        };
      case 'pull_request':
        return {
          branch: payload.pull_request?.base?.ref || null,
          commitHash: payload.pull_request?.merge_commit_sha || null,
          changedFiles: [],
          sender: payload.sender?.login || 'unknown',
          message: payload.pull_request?.title || '',
        };
      case 'release':
        return {
          branch: payload.release?.target_commitish || null,
          commitHash: null,
          changedFiles: [],
          sender: payload.sender?.login || 'unknown',
          message: payload.release?.name || payload.release?.tag_name || '',
        };
      default:
        return { branch: null, commitHash: null, changedFiles: [], sender: 'unknown', message: '' };
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/providers/github.provider.spec.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/src/webhooks/providers/
git commit -m "feat(webhooks): add webhook provider interface and GitHub provider"
```

---

## Task 3: Filter Service

**Files:**
- Create: `backend/src/webhooks/webhooks-filter.service.ts`
- Create: `backend/src/webhooks/webhooks-filter.service.spec.ts`

- [ ] **Step 1: Install minimatch for glob pattern matching**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npm install minimatch`

- [ ] **Step 2: Write the failing tests**

Create `backend/src/webhooks/webhooks-filter.service.spec.ts`:

```typescript
import { WebhooksFilterService } from './webhooks-filter.service';

describe('WebhooksFilterService', () => {
  let service: WebhooksFilterService;

  beforeEach(() => {
    service = new WebhooksFilterService();
  });

  describe('matchBranch', () => {
    it('should pass when branchFilters is empty', () => {
      expect(service.matchBranch('feature/x', [])).toEqual({ pass: true });
    });

    it('should pass on exact match', () => {
      expect(service.matchBranch('main', ['main', 'develop'])).toEqual({ pass: true });
    });

    it('should pass on glob match', () => {
      expect(service.matchBranch('release/1.0', ['main', 'release/*'])).toEqual({ pass: true });
    });

    it('should fail when no pattern matches', () => {
      const result = service.matchBranch('feature/x', ['main', 'release/*']);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain('feature/x');
    });

    it('should fail when branch is null', () => {
      const result = service.matchBranch(null, ['main']);
      expect(result.pass).toBe(false);
    });
  });

  describe('matchPaths', () => {
    it('should pass when pathFilters is empty', () => {
      expect(service.matchPaths(['anything.ts'], [])).toEqual({ pass: true });
    });

    it('should pass when any file matches any pattern', () => {
      expect(service.matchPaths(['src/app.ts', 'README.md'], ['src/**'])).toEqual({ pass: true });
    });

    it('should fail when no file matches', () => {
      const result = service.matchPaths(['docs/readme.md'], ['src/**']);
      expect(result.pass).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should pass when changedFiles is empty (no file info available)', () => {
      expect(service.matchPaths([], ['src/**'])).toEqual({ pass: true });
    });
  });

  describe('matchEvent', () => {
    it('should pass when event is in the list', () => {
      expect(service.matchEvent('push', null, ['push', 'release'])).toEqual({ pass: true });
    });

    it('should fail when event is not in the list', () => {
      const result = service.matchEvent('push', null, ['release']);
      expect(result.pass).toBe(false);
    });

    it('should pass pull_request only when merged', () => {
      expect(service.matchEvent('pull_request', 'closed', ['pull_request'], true)).toEqual({ pass: true });
      const result = service.matchEvent('pull_request', 'opened', ['pull_request'], false);
      expect(result.pass).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/webhooks-filter.service.spec.ts --no-coverage`
Expected: FAIL — `Cannot find module './webhooks-filter.service'`

- [ ] **Step 4: Implement the filter service**

Create `backend/src/webhooks/webhooks-filter.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { minimatch } from 'minimatch';

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

@Injectable()
export class WebhooksFilterService {
  matchBranch(branch: string | null, filters: string[]): FilterResult {
    if (filters.length === 0) return { pass: true };
    if (!branch) return { pass: false, reason: 'No branch in payload' };
    const matched = filters.some((pattern) => minimatch(branch, pattern));
    return matched ? { pass: true } : { pass: false, reason: `Branch "${branch}" does not match filters [${filters.join(', ')}]` };
  }

  matchPaths(changedFiles: string[], filters: string[]): FilterResult {
    if (filters.length === 0) return { pass: true };
    if (changedFiles.length === 0) return { pass: true };
    const matched = changedFiles.some((file) => filters.some((pattern) => minimatch(file, pattern)));
    return matched ? { pass: true } : { pass: false, reason: `No changed files match path filters [${filters.join(', ')}]` };
  }

  matchEvent(event: string, action: string | null, allowedEvents: string[], merged?: boolean): FilterResult {
    if (!allowedEvents.includes(event)) {
      return { pass: false, reason: `Event "${event}" not in allowed events [${allowedEvents.join(', ')}]` };
    }
    if (event === 'pull_request' && !(action === 'closed' && merged)) {
      return { pass: false, reason: `pull_request event not a merge (action=${action}, merged=${merged})` };
    }
    return { pass: true };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/webhooks-filter.service.spec.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/src/webhooks/webhooks-filter.service.ts backend/src/webhooks/webhooks-filter.service.spec.ts backend/package.json backend/package-lock.json
git commit -m "feat(webhooks): add webhook filter service with branch, path, and event matching"
```

---

## Task 4: DTOs

**Files:**
- Create: `backend/src/webhooks/dto/create-webhook.dto.ts`
- Create: `backend/src/webhooks/dto/update-webhook.dto.ts`

- [ ] **Step 1: Create the create-webhook DTO**

Create `backend/src/webhooks/dto/create-webhook.dto.ts`:

```typescript
import { IsArray, IsOptional, IsString, ArrayMinSize } from 'class-validator';

export class CreateWebhookDto {
  @IsString()
  githubToken: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  branchFilters?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  pathFilters?: string[];

  @IsString()
  @IsOptional()
  secret?: string;
}
```

- [ ] **Step 2: Create the update-webhook DTO**

Create `backend/src/webhooks/dto/update-webhook.dto.ts`:

```typescript
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateWebhookDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  events?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  branchFilters?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  pathFilters?: string[];

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  githubToken?: string;
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/src/webhooks/dto/
git commit -m "feat(webhooks): add create and update webhook DTOs"
```

---

## Task 5: Signature Guard

**Files:**
- Create: `backend/src/webhooks/guards/webhook-signature.guard.ts`
- Create: `backend/src/webhooks/guards/webhook-signature.guard.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/webhooks/guards/webhook-signature.guard.spec.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { createHmac } from 'crypto';
import { Test } from '@nestjs/testing';

describe('WebhookSignatureGuard', () => {
  let guard: WebhookSignatureGuard;
  const mockPrisma = { webhookConfig: { findUnique: jest.fn() } };
  const mockEncryption = { decrypt: jest.fn((v: string) => v) };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WebhookSignatureGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
      ],
    }).compile();
    guard = module.get(WebhookSignatureGuard);
    jest.clearAllMocks();
  });

  function mockContext(projectId: string, signature: string, body: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          params: { projectId },
          headers: { 'x-hub-signature-256': signature },
          rawBody: Buffer.from(body),
        }),
      }),
    } as any;
  }

  it('should allow request with valid signature', async () => {
    const secret = 'my-secret';
    const body = '{"ref":"refs/heads/main"}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    mockPrisma.webhookConfig.findUnique.mockResolvedValue({ secret, enabled: true });

    const result = await guard.canActivate(mockContext('proj-1', sig, body));
    expect(result).toBe(true);
  });

  it('should reject request with invalid signature', async () => {
    mockPrisma.webhookConfig.findUnique.mockResolvedValue({ secret: 'real-secret', enabled: true });

    await expect(guard.canActivate(mockContext('proj-1', 'sha256=wrong', '{}'))).rejects.toThrow();
  });

  it('should reject when no webhook config exists', async () => {
    mockPrisma.webhookConfig.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(mockContext('proj-1', 'sha256=x', '{}'))).rejects.toThrow();
  });

  it('should reject when webhook is disabled', async () => {
    mockPrisma.webhookConfig.findUnique.mockResolvedValue({ secret: 's', enabled: false });

    await expect(guard.canActivate(mockContext('proj-1', 'sha256=x', '{}'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/guards/webhook-signature.guard.spec.ts --no-coverage`
Expected: FAIL — `Cannot find module './webhook-signature.guard'`

- [ ] **Step 3: Implement the signature guard**

Create `backend/src/webhooks/guards/webhook-signature.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const projectId = req.params.projectId;
    const signature = req.headers['x-hub-signature-256'];

    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');
    if (!config.enabled) throw new ForbiddenException('Webhook is disabled for this project');

    const secret = this.encryption.decrypt(config.secret);
    const payload = req.rawBody as Buffer;
    const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

    try {
      if (!timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected))) {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/guards/webhook-signature.guard.spec.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/src/webhooks/guards/
git commit -m "feat(webhooks): add HMAC-SHA256 webhook signature guard"
```

---

## Task 6: Webhooks Service

**Files:**
- Create: `backend/src/webhooks/webhooks.service.ts`
- Create: `backend/src/webhooks/webhooks.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/webhooks/webhooks.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { WebhooksFilterService } from './webhooks-filter.service';
import { DeployService } from '../deploy/deploy.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  const mockPrisma = {
    webhookConfig: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    webhookEvent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    project: { findUnique: jest.fn() },
  };
  const mockEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace('enc:', '')),
  };
  const mockFilter = {
    matchEvent: jest.fn().mockReturnValue({ pass: true }),
    matchBranch: jest.fn().mockReturnValue({ pass: true }),
    matchPaths: jest.fn().mockReturnValue({ pass: true }),
  };
  const mockDeploy = { trigger: jest.fn().mockResolvedValue({ id: 'deploy-1' }) };
  const mockConfig = { getOrThrow: jest.fn().mockReturnValue('http://localhost:4000') };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: mockEncryption },
        { provide: WebhooksFilterService, useValue: mockFilter },
        { provide: DeployService, useValue: mockDeploy },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(WebhooksService);
    jest.clearAllMocks();
  });

  describe('processWebhookEvent', () => {
    const baseArgs = {
      projectId: 'proj-1',
      deliveryId: 'del-1',
      event: 'push',
      headers: { 'x-github-event': 'push' },
      payload: { ref: 'refs/heads/main', after: 'abc', pusher: { name: 'u' }, head_commit: { message: 'm' }, commits: [] },
    };

    it('should trigger deployment when all filters pass', async () => {
      mockPrisma.webhookConfig.findUnique.mockResolvedValue({
        projectId: 'proj-1', events: ['push'], branchFilters: [], pathFilters: [], enabled: true,
      });
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.webhookEvent.update.mockResolvedValue({});

      await service.processWebhookEvent(baseArgs);

      expect(mockDeploy.trigger).toHaveBeenCalledWith('proj-1', expect.any(String));
      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'TRIGGERED' }) }),
      );
    });

    it('should set FILTERED status when branch filter fails', async () => {
      mockPrisma.webhookConfig.findUnique.mockResolvedValue({
        projectId: 'proj-1', events: ['push'], branchFilters: ['main'], pathFilters: [], enabled: true,
      });
      mockFilter.matchBranch.mockReturnValueOnce({ pass: false, reason: 'not main' });
      mockPrisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.webhookEvent.update.mockResolvedValue({});

      await service.processWebhookEvent(baseArgs);

      expect(mockDeploy.trigger).not.toHaveBeenCalled();
      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FILTERED' }) }),
      );
    });
  });

  describe('getConfig', () => {
    it('should throw NotFoundException when no config exists', async () => {
      mockPrisma.webhookConfig.findUnique.mockResolvedValue(null);
      await expect(service.getConfig('proj-1')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/webhooks.service.spec.ts --no-coverage`
Expected: FAIL — `Cannot find module './webhooks.service'`

- [ ] **Step 3: Implement the webhooks service**

Create `backend/src/webhooks/webhooks.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { WebhooksFilterService } from './webhooks-filter.service';
import { DeployService } from '../deploy/deploy.service';
import { GitHubProvider } from './providers/github.provider';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@Injectable()
export class WebhooksService {
  private githubProvider = new GitHubProvider();

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private filter: WebhooksFilterService,
    private deployService: DeployService,
    private config: ConfigService,
  ) {}

  async createConfig(projectId: string, dto: CreateWebhookDto) {
    const existing = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (existing) throw new BadRequestException('Webhook already configured for this project');

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.repoUrl) throw new BadRequestException('Project has no GitHub repo URL');

    const secret = dto.secret || randomBytes(32).toString('hex');
    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    const callbackUrl = `${baseUrl}/api/webhooks/receive/${projectId}`;

    const { webhookId } = await this.githubProvider.registerWebhook(
      project.repoUrl, callbackUrl, secret, dto.events, dto.githubToken,
    );

    const config = await this.prisma.webhookConfig.create({
      data: {
        projectId,
        secret: this.encryption.encrypt(secret),
        githubToken: this.encryption.encrypt(dto.githubToken),
        githubWebhookId: webhookId,
        events: dto.events,
        branchFilters: dto.branchFilters || [],
        pathFilters: dto.pathFilters || [],
      },
    });

    return { ...config, secret, githubToken: undefined };
  }

  async getConfig(projectId: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');
    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    return {
      id: config.id,
      projectId: config.projectId,
      enabled: config.enabled,
      events: config.events,
      branchFilters: config.branchFilters,
      pathFilters: config.pathFilters,
      provider: config.provider,
      webhookUrl: `${baseUrl}/api/webhooks/receive/${projectId}`,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  async updateConfig(projectId: string, dto: UpdateWebhookDto) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');

    const data: any = {};
    if (dto.events) data.events = dto.events;
    if (dto.branchFilters) data.branchFilters = dto.branchFilters;
    if (dto.pathFilters) data.pathFilters = dto.pathFilters;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.githubToken) data.githubToken = this.encryption.encrypt(dto.githubToken);

    if (dto.events && config.githubWebhookId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      const token = dto.githubToken || this.encryption.decrypt(config.githubToken);
      await this.githubProvider.updateWebhook(project!.repoUrl!, config.githubWebhookId, dto.events, token);
    }

    return this.prisma.webhookConfig.update({ where: { projectId }, data });
  }

  async deleteConfig(projectId: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');

    if (config.githubWebhookId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      const token = this.encryption.decrypt(config.githubToken);
      await this.githubProvider.deleteWebhook(project!.repoUrl!, config.githubWebhookId, token).catch(() => {});
    }

    return this.prisma.webhookConfig.delete({ where: { projectId } });
  }

  async regenerateSecret(projectId: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId } });
    if (!config) throw new NotFoundException('No webhook configured for this project');

    const newSecret = randomBytes(32).toString('hex');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    const token = this.encryption.decrypt(config.githubToken);
    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    const callbackUrl = `${baseUrl}/api/webhooks/receive/${projectId}`;

    if (config.githubWebhookId) {
      await this.githubProvider.deleteWebhook(project!.repoUrl!, config.githubWebhookId, token).catch(() => {});
    }
    const { webhookId } = await this.githubProvider.registerWebhook(
      project!.repoUrl!, callbackUrl, newSecret, config.events as string[], token,
    );

    await this.prisma.webhookConfig.update({
      where: { projectId },
      data: { secret: this.encryption.encrypt(newSecret), githubWebhookId: webhookId },
    });

    return { secret: newSecret };
  }

  async processWebhookEvent(args: {
    projectId: string;
    deliveryId: string;
    event: string;
    headers: Record<string, string>;
    payload: any;
  }) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { projectId: args.projectId } });
    if (!config || !config.enabled) return;

    const parsed = this.githubProvider.parsePayload(args.event, args.payload);
    const webhookEvent = await this.prisma.webhookEvent.create({
      data: {
        projectId: args.projectId,
        provider: 'GITHUB',
        deliveryId: args.deliveryId,
        event: args.event,
        action: args.payload.action || null,
        headers: args.headers,
        payload: args.payload,
        status: 'RECEIVED',
      },
    });

    const eventCheck = this.filter.matchEvent(
      args.event, args.payload.action || null, config.events as string[],
      args.event === 'pull_request' ? args.payload.pull_request?.merged : undefined,
    );
    if (!eventCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: eventCheck.reason, processedAt: new Date() },
      });
      return;
    }

    const branchCheck = this.filter.matchBranch(parsed.branch, config.branchFilters as string[]);
    if (!branchCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: branchCheck.reason, processedAt: new Date() },
      });
      return;
    }

    const pathCheck = this.filter.matchPaths(parsed.changedFiles, config.pathFilters as string[]);
    if (!pathCheck.pass) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FILTERED', filterReason: pathCheck.reason, processedAt: new Date() },
      });
      return;
    }

    try {
      const deployment = await this.deployService.trigger(args.projectId, 'webhook');
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

  async replayEvent(eventId: string) {
    const original = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!original) throw new NotFoundException('Webhook event not found');

    const replayDeliveryId = `replay-${randomBytes(16).toString('hex')}`;
    await this.processWebhookEvent({
      projectId: original.projectId,
      deliveryId: replayDeliveryId,
      event: original.event,
      headers: original.headers as Record<string, string>,
      payload: original.payload,
    });
  }

  async getEvents(projectId: string, status?: string, page = 1, limit = 20) {
    const where: any = { projectId };
    if (status) where.status = status;
    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { deployment: { select: { id: true, version: true, status: true } } },
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return { events, total, page, limit };
  }

  async getEvent(eventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
      include: { deployment: { select: { id: true, version: true, status: true } } },
    });
    if (!event) throw new NotFoundException('Webhook event not found');
    return event;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest src/webhooks/webhooks.service.spec.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/src/webhooks/webhooks.service.ts backend/src/webhooks/webhooks.service.spec.ts
git commit -m "feat(webhooks): add webhooks service with config management, event processing, and replay"
```

---

## Task 7: Controllers

**Files:**
- Create: `backend/src/webhooks/webhooks.controller.ts`
- Create: `backend/src/webhooks/webhooks-receiver.controller.ts`

- [ ] **Step 1: Create the management controller**

Create `backend/src/webhooks/webhooks.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@Controller('projects/:projectId/webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post() @MinRole('ADMIN')
  create(@Param('projectId') projectId: string, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.createConfig(projectId, dto);
  }

  @Get() @MinRole('DEVELOPER')
  getConfig(@Param('projectId') projectId: string) {
    return this.webhooksService.getConfig(projectId);
  }

  @Patch() @MinRole('ADMIN')
  update(@Param('projectId') projectId: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooksService.updateConfig(projectId, dto);
  }

  @Delete() @MinRole('ADMIN')
  delete(@Param('projectId') projectId: string) {
    return this.webhooksService.deleteConfig(projectId);
  }

  @Post('regenerate-secret') @MinRole('ADMIN')
  regenerateSecret(@Param('projectId') projectId: string) {
    return this.webhooksService.regenerateSecret(projectId);
  }

  @Get('events') @MinRole('DEVELOPER')
  getEvents(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.webhooksService.getEvents(projectId, status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get('events/:eventId') @MinRole('DEVELOPER')
  getEvent(@Param('eventId') eventId: string) {
    return this.webhooksService.getEvent(eventId);
  }

  @Post('events/:eventId/replay') @MinRole('ADMIN')
  replay(@Param('eventId') eventId: string) {
    return this.webhooksService.replayEvent(eventId);
  }
}
```

- [ ] **Step 1b: Install throttler package**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npm install @nestjs/throttler`

- [ ] **Step 2: Create the receiver controller**

Create `backend/src/webhooks/webhooks-receiver.controller.ts`:

```typescript
import { Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksReceiverController {
  constructor(private webhooksService: WebhooksService) {}

  @Post('receive/:projectId')
  @UseGuards(WebhookSignatureGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async receive(
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const deliveryId = req.headers['x-github-delivery'] as string;
    const event = req.headers['x-github-event'] as string;

    if (!deliveryId || !event) {
      return res.status(400).json({ message: 'Missing GitHub headers' });
    }

    res.status(200).json({ received: true });

    this.webhooksService.processWebhookEvent({
      projectId,
      deliveryId,
      event,
      headers: req.headers as Record<string, string>,
      payload: req.body,
    }).catch(() => {});
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/src/webhooks/webhooks.controller.ts backend/src/webhooks/webhooks-receiver.controller.ts
git commit -m "feat(webhooks): add management and receiver controllers"
```

---

## Task 8: Module Registration and Raw Body

**Files:**
- Create: `backend/src/webhooks/webhooks.module.ts`
- Modify: `backend/src/app.module.ts:1-43`
- Modify: `backend/src/main.ts:1-15`

- [ ] **Step 1: Create the webhooks module**

Create `backend/src/webhooks/webhooks.module.ts`:

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
})
export class WebhooksModule {}
```

- [ ] **Step 2: Register WebhooksModule in AppModule**

In `backend/src/app.module.ts`, add the import statement:

```typescript
import { WebhooksModule } from './webhooks/webhooks.module';
```

And add `WebhooksModule` to the imports array, after `StorageBrowserModule`.

- [ ] **Step 3: Enable raw body in main.ts**

In `backend/src/main.ts`, change the `NestFactory.create` call to enable raw body:

```typescript
const app = await NestFactory.create(AppModule, { rawBody: true });
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add backend/src/webhooks/webhooks.module.ts backend/src/app.module.ts backend/src/main.ts
git commit -m "feat(webhooks): register webhooks module and enable raw body parsing"
```

---

## Task 9: Frontend — React Query Hooks

**Files:**
- Create: `frontend/src/hooks/use-webhooks.ts`

- [ ] **Step 1: Create the webhook hooks file**

Create `frontend/src/hooks/use-webhooks.ts`:

```typescript
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface WebhookConfig {
  id: string;
  projectId: string;
  enabled: boolean;
  events: string[];
  branchFilters: string[];
  pathFilters: string[];
  provider: string;
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface WebhookEvent {
  id: string;
  projectId: string;
  provider: string;
  deliveryId: string;
  event: string;
  action: string | null;
  headers: Record<string, string>;
  payload: any;
  status: string;
  filterReason: string | null;
  deploymentId: string | null;
  deployment: { id: string; version: number; status: string } | null;
  error: string | null;
  processedAt: string | null;
  createdAt: string;
}

interface WebhookEventsResponse {
  events: WebhookEvent[];
  total: number;
  page: number;
  limit: number;
}

export function useWebhookConfig(projectId: string) {
  return useQuery<WebhookConfig>({
    queryKey: ['webhook-config', projectId],
    queryFn: () => api(`/projects/${projectId}/webhooks`),
    retry: false,
  });
}

export function useCreateWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { githubToken: string; events: string[]; branchFilters?: string[]; pathFilters?: string[]; secret?: string }) =>
      api<WebhookConfig & { secret: string }>(`/projects/${projectId}/webhooks`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-config', projectId] }),
  });
}

export function useUpdateWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { events?: string[]; branchFilters?: string[]; pathFilters?: string[]; enabled?: boolean; githubToken?: string }) =>
      api(`/projects/${projectId}/webhooks`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-config', projectId] }),
  });
}

export function useDeleteWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/projects/${projectId}/webhooks`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-config', projectId] }),
  });
}

export function useRegenerateSecret(projectId: string) {
  return useMutation({
    mutationFn: () => api<{ secret: string }>(`/projects/${projectId}/webhooks/regenerate-secret`, { method: 'POST' }),
  });
}

export function useWebhookEvents(projectId: string, status?: string, page = 1) {
  return useQuery<WebhookEventsResponse>({
    queryKey: ['webhook-events', projectId, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status) params.set('status', status);
      return api(`/projects/${projectId}/webhooks/events?${params}`);
    },
  });
}

export function useWebhookEvent(eventId: string) {
  return useQuery<WebhookEvent>({
    queryKey: ['webhook-event', eventId],
    queryFn: () => api(`/projects/_/webhooks/events/${eventId}`),
    enabled: !!eventId,
  });
}

export function useReplayWebhookEvent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => api(`/projects/${projectId}/webhooks/events/${eventId}/replay`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-events', projectId] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add frontend/src/hooks/use-webhooks.ts
git commit -m "feat(webhooks): add React Query hooks for webhook config and events"
```

---

## Task 10: Frontend — Webhooks Page

**Files:**
- Create: `frontend/src/app/projects/[id]/webhooks/page.tsx`
- Modify: `frontend/src/components/project-sidebar.tsx:36-40`

- [ ] **Step 1: Add Webhooks to sidebar navigation**

In `frontend/src/components/project-sidebar.tsx`, change the Config group to add Webhooks:

```typescript
  {
    label: 'Config',
    items: [
      { href: 'webhooks', label: 'Webhooks' },
      { href: 'settings', label: 'Settings' },
    ],
  },
```

- [ ] **Step 2: Create the webhooks page**

Create `frontend/src/app/projects/[id]/webhooks/page.tsx`:

```typescript
'use client';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  useWebhookConfig, useCreateWebhook, useUpdateWebhook, useDeleteWebhook,
  useRegenerateSecret, useWebhookEvents, useReplayWebhookEvent,
} from '@/hooks/use-webhooks';

const EVENT_OPTIONS = ['push', 'pull_request', 'release', 'create', 'delete'];

const statusBadgeColor: Record<string, string> = {
  TRIGGERED: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  FILTERED: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  RECEIVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  REPLAYED: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
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

export default function WebhooksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: config, isLoading, error } = useWebhookConfig(projectId);
  const createWebhook = useCreateWebhook(projectId);
  const updateWebhook = useUpdateWebhook(projectId);
  const deleteWebhook = useDeleteWebhook(projectId);
  const regenerateSecret = useRegenerateSecret(projectId);
  const replayEvent = useReplayWebhookEvent(projectId);

  const [showSetup, setShowSetup] = useState(false);
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [eventsPage, setEventsPage] = useState(1);

  const { data: eventsData } = useWebhookEvents(projectId, statusFilter || undefined, eventsPage);

  const [form, setForm] = useState({
    githubToken: '',
    events: ['push'] as string[],
    branchFilters: '',
    pathFilters: '',
    secret: '',
  });

  const hasConfig = !!config && !error;

  function handleToggleEvent(event: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter((e) => e !== event)
        : [...f.events, event],
    }));
  }

  async function handleCreate() {
    try {
      const result = await createWebhook.mutateAsync({
        githubToken: form.githubToken,
        events: form.events,
        branchFilters: form.branchFilters ? form.branchFilters.split(',').map((s) => s.trim()) : undefined,
        pathFilters: form.pathFilters ? form.pathFilters.split(',').map((s) => s.trim()) : undefined,
        secret: form.secret || undefined,
      });
      setShowSetup(false);
      setShowSecret(result.secret);
      toast.success('Webhook configured');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete webhook? This will also unregister it from GitHub.')) return;
    try {
      await deleteWebhook.mutateAsync();
      toast.success('Webhook deleted');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleRegenerateSecret() {
    if (!confirm('Regenerate secret? The old secret will stop working immediately.')) return;
    try {
      const result = await regenerateSecret.mutateAsync();
      setShowSecret(result.secret);
      toast.success('Secret regenerated');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleToggleEnabled() {
    if (!config) return;
    try {
      await updateWebhook.mutateAsync({ enabled: !config.enabled });
      toast.success(config.enabled ? 'Webhook disabled' : 'Webhook enabled');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (isLoading) return <p>Loading...</p>;

  return (
    <div className="space-y-6">
      {/* Configuration */}
      {!hasConfig ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-foreground-secondary mb-4">No webhook configured for this project.</p>
            <p className="text-sm text-muted-foreground mb-6">
              Configure a GitHub webhook to automatically deploy when you push code.
            </p>
            <Button onClick={() => setShowSetup(true)}>Configure Webhook</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Webhook Configuration</CardTitle>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleEnabled}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    config.enabled ? 'bg-green-500' : 'bg-foreground-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      config.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
                <span className="text-sm text-foreground-secondary">
                  {config.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Webhook URL</Label>
              <div className="flex gap-2">
                <Input value={config.webhookUrl} disabled className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { navigator.clipboard.writeText(config.webhookUrl); toast.success('Copied'); }}
                >
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <Label>Events</Label>
              <div className="flex gap-1.5 mt-1">
                {(config.events as string[]).map((e) => (
                  <span key={e} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground-secondary">
                    {e}
                  </span>
                ))}
              </div>
            </div>
            {(config.branchFilters as string[]).length > 0 && (
              <div>
                <Label>Branch Filters</Label>
                <p className="text-sm text-foreground-secondary font-mono">{(config.branchFilters as string[]).join(', ')}</p>
              </div>
            )}
            {(config.pathFilters as string[]).length > 0 && (
              <div>
                <Label>Path Filters</Label>
                <p className="text-sm text-foreground-secondary font-mono">{(config.pathFilters as string[]).join(', ')}</p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handleRegenerateSecret}>Regenerate Secret</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>Delete Webhook</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup Dialog */}
      <Dialog open={showSetup} onOpenChange={setShowSetup}>
        <DialogContent>
          <DialogHeader><DialogTitle>Configure Webhook</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>GitHub Personal Access Token</Label>
              <Input
                type="password"
                value={form.githubToken}
                onChange={(e) => setForm({ ...form, githubToken: e.target.value })}
                placeholder="ghp_..."
              />
              <p className="text-xs text-muted-foreground mt-1">Needs repo/admin:repo_hook permissions.</p>
            </div>
            <div>
              <Label>Events</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {EVENT_OPTIONS.map((event) => (
                  <label key={event} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.events.includes(event)}
                      onChange={() => handleToggleEvent(event)}
                      className="rounded"
                    />
                    {event}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Branch Filters (comma-separated, glob patterns)</Label>
              <Input
                value={form.branchFilters}
                onChange={(e) => setForm({ ...form, branchFilters: e.target.value })}
                placeholder="main, release/*"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Path Filters (comma-separated, glob patterns)</Label>
              <Input
                value={form.pathFilters}
                onChange={(e) => setForm({ ...form, pathFilters: e.target.value })}
                placeholder="src/**, package.json"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Secret (optional, auto-generated if empty)</Label>
              <Input
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder="Leave empty to auto-generate"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSetup(false)}>Cancel</Button>
            <Button
              disabled={!form.githubToken || form.events.length === 0 || createWebhook.isPending}
              onClick={handleCreate}
            >
              {createWebhook.isPending ? 'Configuring...' : 'Configure'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret Display Dialog */}
      <Dialog open={!!showSecret} onOpenChange={() => setShowSecret(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Webhook Secret</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-foreground-secondary">
              Save this secret now. It will not be shown again.
            </p>
            <div className="flex gap-2">
              <Input value={showSecret || ''} disabled className="font-mono text-xs" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => { navigator.clipboard.writeText(showSecret || ''); toast.success('Copied'); }}
              >
                Copy
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit Log */}
      {hasConfig && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Webhook Events</CardTitle>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setEventsPage(1); }}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">All statuses</option>
                <option value="TRIGGERED">Triggered</option>
                <option value="FILTERED">Filtered</option>
                <option value="FAILED">Failed</option>
                <option value="REPLAYED">Replayed</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {!eventsData || eventsData.events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No webhook events yet.</p>
            ) : (
              <div className="space-y-1">
                {eventsData.events.map((evt) => (
                  <div key={evt.id}>
                    <button
                      onClick={() => setExpandedEvent(expandedEvent === evt.id ? null : evt.id)}
                      className="w-full flex items-center justify-between p-2.5 rounded-md hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-16">{timeAgo(evt.createdAt)}</span>
                        <span className="text-sm font-mono">{evt.event}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${statusBadgeColor[evt.status] || 'bg-muted text-foreground-secondary'}`}>
                          {evt.status}
                        </span>
                      </div>
                      {evt.deployment && (
                        <span className="text-xs text-foreground-secondary">Deploy #{evt.deployment.version}</span>
                      )}
                    </button>
                    {expandedEvent === evt.id && (
                      <div className="ml-4 p-3 mb-2 border rounded-md bg-muted/30 space-y-2 text-sm">
                        {evt.filterReason && (
                          <div><span className="text-muted-foreground">Filter reason:</span> <span className="text-yellow-600">{evt.filterReason}</span></div>
                        )}
                        {evt.error && (
                          <div><span className="text-muted-foreground">Error:</span> <span className="text-red-600">{evt.error}</span></div>
                        )}
                        <details>
                          <summary className="text-xs text-muted-foreground cursor-pointer">Payload</summary>
                          <pre className="text-xs font-mono mt-1 p-2 bg-muted rounded overflow-x-auto max-h-60">
                            {JSON.stringify(evt.payload, null, 2)}
                          </pre>
                        </details>
                        <details>
                          <summary className="text-xs text-muted-foreground cursor-pointer">Headers</summary>
                          <pre className="text-xs font-mono mt-1 p-2 bg-muted rounded overflow-x-auto max-h-40">
                            {JSON.stringify(evt.headers, null, 2)}
                          </pre>
                        </details>
                        {(evt.status === 'FAILED' || evt.status === 'FILTERED') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => replayEvent.mutate(evt.id, {
                              onSuccess: () => toast.success('Event replayed'),
                              onError: (err: any) => toast.error(err.message),
                            })}
                            disabled={replayEvent.isPending}
                          >
                            Replay
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {eventsData.total > eventsData.limit && (
                  <div className="flex justify-center gap-2 pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={eventsPage <= 1}
                      onClick={() => setEventsPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground py-1">
                      Page {eventsPage} of {Math.ceil(eventsData.total / eventsData.limit)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={eventsPage >= Math.ceil(eventsData.total / eventsData.limit)}
                      onClick={() => setEventsPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/noah/Work/idea/ship-dock/frontend && npx next build`
Expected: Build succeeds (or at least no TypeScript errors in webhook files).

- [ ] **Step 4: Commit**

```bash
cd /Users/noah/Work/idea/ship-dock
git add frontend/src/app/projects/\[id\]/webhooks/ frontend/src/components/project-sidebar.tsx
git commit -m "feat(webhooks): add webhooks page and sidebar navigation"
```

---

## Task 11: Run All Tests

- [ ] **Step 1: Run all backend tests**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx jest --no-coverage`
Expected: All tests PASS.

- [ ] **Step 2: Fix any failures**

If any tests fail, read the error output and fix the issue in the relevant file.

- [ ] **Step 3: Final commit if fixes were needed**

```bash
cd /Users/noah/Work/idea/ship-dock
git add -A
git commit -m "fix(webhooks): fix test failures"
```
