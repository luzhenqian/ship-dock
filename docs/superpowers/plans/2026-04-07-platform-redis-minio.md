# Platform Redis & MinIO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to toggle Platform Redis and Platform Storage (MinIO) during project creation — matching the existing Platform Database pattern — with full provision/deprovision lifecycle.

**Architecture:** Two new provisioner services mirror `DatabaseProvisionerService`. Redis isolates projects via numbered databases (`SELECT <n>`). MinIO isolates via per-project buckets (`proj-<slug>`). Both inject env vars and create `ServiceConnection` records automatically.

**Tech Stack:** ioredis (already installed), minio SDK (already installed), Prisma, NestJS, Next.js

---

### Task 1: Prisma Schema — Add Redis & MinIO Fields to Project

**Files:**
- Modify: `backend/prisma/schema.prisma:91-128` (Project model)

- [ ] **Step 1: Add fields to Project model**

In `backend/prisma/schema.prisma`, add these four fields to the `Project` model after the `dbName` line (line 107):

```prisma
  useLocalRedis Boolean       @default(false)
  redisDbIndex  Int?
  useLocalMinio Boolean       @default(false)
  minioBucket   String?
```

- [ ] **Step 2: Generate and run migration**

```bash
cd backend && npx prisma migrate dev --name add-redis-minio-fields
```

Expected: Migration created and applied, Prisma Client regenerated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add useLocalRedis, redisDbIndex, useLocalMinio, minioBucket to Project schema"
```

---

### Task 2: RedisProvisionerService

**Files:**
- Create: `backend/src/common/redis-provisioner.service.ts`
- Modify: `backend/src/common/common.module.ts`

- [ ] **Step 1: Create RedisProvisionerService**

Create `backend/src/common/redis-provisioner.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from './prisma.service';

@Injectable()
export class RedisProvisionerService {
  private readonly logger = new Logger(RedisProvisionerService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  /**
   * Find the next available Redis database index.
   * DB 0 is reserved for Ship Dock itself; project DBs start at 1.
   */
  async allocateDbIndex(): Promise<number> {
    const result = await this.prisma.project.aggregate({
      _max: { redisDbIndex: true },
      where: { useLocalRedis: true },
    });
    return (result._max.redisDbIndex ?? 0) + 1;
  }

  /**
   * Provision a Redis database for a project.
   * Verifies the database is accessible, returns the REDIS_URL.
   */
  async provision(dbIndex: number): Promise<{ dbIndex: number; redisUrl: string }> {
    const { host, port, password } = this.getConnectionConfig();
    const client = new Redis({ host, port, password, db: dbIndex, lazyConnect: true });

    try {
      await client.connect();
      // Verify we can SELECT into this database
      await client.select(dbIndex);
      this.logger.log(`Provisioned Redis db ${dbIndex}`);
    } finally {
      await client.quit();
    }

    const redisUrl = password
      ? `redis://:${encodeURIComponent(password)}@${host}:${port}/${dbIndex}`
      : `redis://${host}:${port}/${dbIndex}`;

    return { dbIndex, redisUrl };
  }

  /**
   * Flush and release a Redis database.
   */
  async deprovision(dbIndex: number): Promise<void> {
    const { host, port, password } = this.getConnectionConfig();
    const client = new Redis({ host, port, password, db: dbIndex, lazyConnect: true });

    try {
      await client.connect();
      await client.flushdb();
      this.logger.log(`Deprovisioned Redis db ${dbIndex} (flushed)`);
    } finally {
      await client.quit();
    }
  }

  private getConnectionConfig(): { host: string; port: number; password: string | undefined } {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      const url = new URL(redisUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        password: url.password || undefined,
      };
    }
    return {
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD'),
    };
  }
}
```

- [ ] **Step 2: Register in CommonModule**

In `backend/src/common/common.module.ts`, add the import and register:

```typescript
import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PrismaService } from './prisma.service';
import { DatabaseProvisionerService } from './database-provisioner.service';
import { RedisProvisionerService } from './redis-provisioner.service';

@Global()
@Module({
  providers: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService],
  exports: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService],
})
export class CommonModule {}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/common/redis-provisioner.service.ts backend/src/common/common.module.ts
git commit -m "feat: add RedisProvisionerService for per-project Redis database provisioning"
```

---

### Task 3: MinioProvisionerService

**Files:**
- Create: `backend/src/common/minio-provisioner.service.ts`
- Modify: `backend/src/common/common.module.ts`

- [ ] **Step 1: Create MinioProvisionerService**

Create `backend/src/common/minio-provisioner.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioProvisionerService {
  private readonly logger = new Logger(MinioProvisionerService.name);

  constructor(private config: ConfigService) {}

  /**
   * Generate a bucket name from the project slug.
   * Bucket names must be 3-63 chars, lowercase, no underscores.
   */
  generateBucketName(slug: string): string {
    return `proj-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);
  }

  /**
   * Create a MinIO bucket for a project.
   * Returns bucket name and connection details to inject as env vars.
   */
  async provision(bucketName: string): Promise<{
    bucketName: string;
    endpoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    useSSL: boolean;
  }> {
    const client = this.getClient();
    const exists = await client.bucketExists(bucketName);
    if (!exists) {
      await client.makeBucket(bucketName);
    }
    this.logger.log(`Provisioned MinIO bucket: ${bucketName}`);

    const { endPoint, port, accessKey, secretKey, useSSL } = this.getConnectionConfig();
    return { bucketName, endpoint: endPoint, port, accessKey, secretKey, useSSL };
  }

  /**
   * Remove all objects and delete the bucket.
   */
  async deprovision(bucketName: string): Promise<void> {
    const client = this.getClient();
    const exists = await client.bucketExists(bucketName);
    if (!exists) return;

    // Remove all objects in bucket
    const objectsList = await new Promise<string[]>((resolve, reject) => {
      const objects: string[] = [];
      const stream = client.listObjects(bucketName, '', true);
      stream.on('data', (obj) => objects.push(obj.name));
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });

    if (objectsList.length > 0) {
      await client.removeObjects(bucketName, objectsList);
    }
    await client.removeBucket(bucketName);
    this.logger.log(`Deprovisioned MinIO bucket: ${bucketName}`);
  }

  private getClient(): Minio.Client {
    const config = this.getConnectionConfig();
    return new Minio.Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  private getConnectionConfig() {
    return {
      endPoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: this.config.get<number>('MINIO_PORT', 9000),
      useSSL: this.config.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
    };
  }
}
```

- [ ] **Step 2: Register in CommonModule**

In `backend/src/common/common.module.ts`, add the import and register:

```typescript
import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PrismaService } from './prisma.service';
import { DatabaseProvisionerService } from './database-provisioner.service';
import { RedisProvisionerService } from './redis-provisioner.service';
import { MinioProvisionerService } from './minio-provisioner.service';

@Global()
@Module({
  providers: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService, MinioProvisionerService],
  exports: [EncryptionService, PrismaService, DatabaseProvisionerService, RedisProvisionerService, MinioProvisionerService],
})
export class CommonModule {}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/common/minio-provisioner.service.ts backend/src/common/common.module.ts
git commit -m "feat: add MinioProvisionerService for per-project bucket provisioning"
```

---

### Task 4: DTO — Add useLocalRedis & useLocalMinio

**Files:**
- Modify: `backend/src/projects/dto/create-project.dto.ts`

- [ ] **Step 1: Add fields to CreateProjectDto**

In `backend/src/projects/dto/create-project.dto.ts`, add after the `useLocalDb` field (line 45-46):

```typescript
  @IsBoolean()
  @IsOptional()
  useLocalRedis?: boolean;

  @IsBoolean()
  @IsOptional()
  useLocalMinio?: boolean;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/projects/dto/create-project.dto.ts
git commit -m "feat: add useLocalRedis and useLocalMinio to CreateProjectDto"
```

---

### Task 5: ProjectsService — Redis & MinIO Provisioning in create()

**Files:**
- Modify: `backend/src/projects/projects.service.ts`

- [ ] **Step 1: Add provisioner imports and constructor params**

In `backend/src/projects/projects.service.ts`, add imports:

```typescript
import { RedisProvisionerService } from '../common/redis-provisioner.service';
import { MinioProvisionerService } from '../common/minio-provisioner.service';
```

Add to constructor after `dbProvisioner`:

```typescript
    private redisProvisioner: RedisProvisionerService,
    private minioProvisioner: MinioProvisionerService,
```

- [ ] **Step 2: Add Redis provisioning to create() method**

In `create()`, after the database provisioning block (after line 77 `envVarsObj.DATABASE_URL = db.databaseUrl;` and closing `}`), add:

```typescript
    // Auto-provision Redis if requested
    let redisDbIndex: number | undefined;
    if (dto.useLocalRedis) {
      redisDbIndex = await this.redisProvisioner.allocateDbIndex();
      const redis = await this.redisProvisioner.provision(redisDbIndex);
      envVarsObj.REDIS_URL = redis.redisUrl;
    }

    // Auto-provision MinIO if requested
    let minioBucket: string | undefined;
    if (dto.useLocalMinio) {
      minioBucket = this.minioProvisioner.generateBucketName(dto.slug);
      const minio = await this.minioProvisioner.provision(minioBucket);
      envVarsObj.MINIO_ENDPOINT = minio.endpoint;
      envVarsObj.MINIO_PORT = String(minio.port);
      envVarsObj.MINIO_ACCESS_KEY = minio.accessKey;
      envVarsObj.MINIO_SECRET_KEY = minio.secretKey;
      envVarsObj.MINIO_BUCKET = minio.bucketName;
      envVarsObj.MINIO_USE_SSL = String(minio.useSSL);
    }
```

- [ ] **Step 3: Add Redis/MinIO fields to project creation data**

In the `this.prisma.project.create({ data: { ... } })` call, add after `useLocalDb: dto.useLocalDb || false, dbName,`:

```typescript
        useLocalRedis: dto.useLocalRedis || false, redisDbIndex,
        useLocalMinio: dto.useLocalMinio || false, minioBucket,
```

- [ ] **Step 4: Add ServiceConnection creation for Redis and MinIO**

After the existing Platform Database `ServiceConnection` creation block (after line 112's closing `}`), add:

```typescript
    // Auto-create service connection for platform Redis
    if (dto.useLocalRedis && redisDbIndex !== undefined) {
      const redisUrl = new URL(envVarsObj.REDIS_URL);
      await this.prisma.serviceConnection.create({
        data: {
          projectId: project.id,
          type: 'REDIS',
          name: 'Platform Redis',
          config: this.encryption.encrypt(JSON.stringify({
            host: redisUrl.hostname,
            port: parseInt(redisUrl.port || '6379'),
            password: redisUrl.password || undefined,
            db: redisDbIndex,
          })),
          autoDetected: true,
        },
      });
    }

    // Auto-create service connection for platform MinIO
    if (dto.useLocalMinio && minioBucket) {
      await this.prisma.serviceConnection.create({
        data: {
          projectId: project.id,
          type: 'MINIO',
          name: 'Platform Storage',
          config: this.encryption.encrypt(JSON.stringify({
            endPoint: envVarsObj.MINIO_ENDPOINT,
            port: parseInt(envVarsObj.MINIO_PORT),
            accessKey: envVarsObj.MINIO_ACCESS_KEY,
            secretKey: envVarsObj.MINIO_SECRET_KEY,
            useSSL: envVarsObj.MINIO_USE_SSL === 'true',
            bucket: minioBucket,
          })),
          autoDetected: true,
        },
      });
    }
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/projects/projects.service.ts
git commit -m "feat: provision Redis and MinIO during project creation"
```

---

### Task 6: ProjectsService — Provision/Deprovision Methods for Redis

**Files:**
- Modify: `backend/src/projects/projects.service.ts`

- [ ] **Step 1: Add provisionRedis method**

Add after `exportDatabase()` method:

```typescript
  async provisionRedis(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.useLocalRedis && project.redisDbIndex !== null) {
      throw new BadRequestException('Project already has platform Redis');
    }

    const redisDbIndex = await this.redisProvisioner.allocateDbIndex();
    const redis = await this.redisProvisioner.provision(redisDbIndex);

    // Merge REDIS_URL into existing envVars
    let envVarsObj: Record<string, string> = {};
    if (project.envVars) {
      try { envVarsObj = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }
    envVarsObj.REDIS_URL = redis.redisUrl;

    await this.prisma.project.update({
      where: { id },
      data: {
        useLocalRedis: true,
        redisDbIndex,
        envVars: this.encryption.encrypt(JSON.stringify(envVarsObj)),
      },
    });

    // Auto-create service connection
    const redisUrl = new URL(redis.redisUrl);
    await this.prisma.serviceConnection.create({
      data: {
        projectId: id,
        type: 'REDIS',
        name: 'Platform Redis',
        config: this.encryption.encrypt(JSON.stringify({
          host: redisUrl.hostname,
          port: parseInt(redisUrl.port || '6379'),
          password: redisUrl.password || undefined,
          db: redisDbIndex,
        })),
        autoDetected: true,
      },
    });

    return { redisDbIndex, redisUrl: redis.redisUrl };
  }
```

- [ ] **Step 2: Add deprovisionRedis method**

```typescript
  async deprovisionRedis(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.useLocalRedis || project.redisDbIndex === null) {
      throw new BadRequestException('Project has no platform Redis');
    }

    await this.redisProvisioner.deprovision(project.redisDbIndex);

    // Remove REDIS_URL from envVars
    let envVarsObj: Record<string, string> = {};
    if (project.envVars) {
      try { envVarsObj = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }
    delete envVarsObj.REDIS_URL;

    await this.prisma.project.update({
      where: { id },
      data: {
        useLocalRedis: false,
        redisDbIndex: null,
        envVars: Object.keys(envVarsObj).length > 0 ? this.encryption.encrypt(JSON.stringify(envVarsObj)) : '',
      },
    });

    await this.prisma.serviceConnection.deleteMany({
      where: { projectId: id, type: 'REDIS', autoDetected: true },
    });

    if (Object.keys(envVarsObj).length > 0) {
      this.syncEnvFile(id, envVarsObj);
    }

    return { success: true };
  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/projects/projects.service.ts
git commit -m "feat: add provisionRedis and deprovisionRedis methods"
```

---

### Task 7: ProjectsService — Provision/Deprovision Methods for MinIO

**Files:**
- Modify: `backend/src/projects/projects.service.ts`

- [ ] **Step 1: Add provisionMinio method**

```typescript
  async provisionMinio(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.useLocalMinio && project.minioBucket) {
      throw new BadRequestException('Project already has platform storage');
    }

    const minioBucket = this.minioProvisioner.generateBucketName(project.slug);
    const minio = await this.minioProvisioner.provision(minioBucket);

    // Merge MinIO vars into existing envVars
    let envVarsObj: Record<string, string> = {};
    if (project.envVars) {
      try { envVarsObj = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }
    envVarsObj.MINIO_ENDPOINT = minio.endpoint;
    envVarsObj.MINIO_PORT = String(minio.port);
    envVarsObj.MINIO_ACCESS_KEY = minio.accessKey;
    envVarsObj.MINIO_SECRET_KEY = minio.secretKey;
    envVarsObj.MINIO_BUCKET = minio.bucketName;
    envVarsObj.MINIO_USE_SSL = String(minio.useSSL);

    await this.prisma.project.update({
      where: { id },
      data: {
        useLocalMinio: true,
        minioBucket,
        envVars: this.encryption.encrypt(JSON.stringify(envVarsObj)),
      },
    });

    await this.prisma.serviceConnection.create({
      data: {
        projectId: id,
        type: 'MINIO',
        name: 'Platform Storage',
        config: this.encryption.encrypt(JSON.stringify({
          endPoint: minio.endpoint,
          port: minio.port,
          accessKey: minio.accessKey,
          secretKey: minio.secretKey,
          useSSL: minio.useSSL,
          bucket: minioBucket,
        })),
        autoDetected: true,
      },
    });

    return { minioBucket, endpoint: minio.endpoint };
  }
```

- [ ] **Step 2: Add deprovisionMinio method**

```typescript
  async deprovisionMinio(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.useLocalMinio || !project.minioBucket) {
      throw new BadRequestException('Project has no platform storage');
    }

    await this.minioProvisioner.deprovision(project.minioBucket);

    // Remove MinIO vars from envVars
    let envVarsObj: Record<string, string> = {};
    if (project.envVars) {
      try { envVarsObj = JSON.parse(this.encryption.decrypt(project.envVars)); } catch {}
    }
    delete envVarsObj.MINIO_ENDPOINT;
    delete envVarsObj.MINIO_PORT;
    delete envVarsObj.MINIO_ACCESS_KEY;
    delete envVarsObj.MINIO_SECRET_KEY;
    delete envVarsObj.MINIO_BUCKET;
    delete envVarsObj.MINIO_USE_SSL;

    await this.prisma.project.update({
      where: { id },
      data: {
        useLocalMinio: false,
        minioBucket: null,
        envVars: Object.keys(envVarsObj).length > 0 ? this.encryption.encrypt(JSON.stringify(envVarsObj)) : '',
      },
    });

    await this.prisma.serviceConnection.deleteMany({
      where: { projectId: id, type: 'MINIO', autoDetected: true },
    });

    if (Object.keys(envVarsObj).length > 0) {
      this.syncEnvFile(id, envVarsObj);
    }

    return { success: true };
  }
```

- [ ] **Step 3: Update delete() to clean up Redis and MinIO**

Modify the `delete()` method to deprovision Redis/MinIO before deleting:

```typescript
  async delete(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');

    // Clean up provisioned resources
    if (project.useLocalRedis && project.redisDbIndex !== null) {
      try { await this.redisProvisioner.deprovision(project.redisDbIndex); } catch {}
    }
    if (project.useLocalMinio && project.minioBucket) {
      try { await this.minioProvisioner.deprovision(project.minioBucket); } catch {}
    }

    await this.portAllocation.release(id);
    return this.prisma.project.delete({ where: { id } });
  }
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/projects/projects.service.ts
git commit -m "feat: add provisionMinio, deprovisionMinio, and cleanup on project delete"
```

---

### Task 8: ProjectsController — API Endpoints

**Files:**
- Modify: `backend/src/projects/projects.controller.ts`

- [ ] **Step 1: Add Redis provision/deprovision endpoints**

After the existing `deprovisionDatabase` endpoint (line 85), add:

```typescript
  @Post(':id/provision-redis') @MinRole('ADMIN')
  provisionRedis(@Param('id') id: string) { return this.projectsService.provisionRedis(id); }

  @Delete(':id/provision-redis') @MinRole('ADMIN')
  deprovisionRedis(@Param('id') id: string) { return this.projectsService.deprovisionRedis(id); }

  @Post(':id/provision-minio') @MinRole('ADMIN')
  provisionMinio(@Param('id') id: string) { return this.projectsService.provisionMinio(id); }

  @Delete(':id/provision-minio') @MinRole('ADMIN')
  deprovisionMinio(@Param('id') id: string) { return this.projectsService.deprovisionMinio(id); }
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/projects/projects.controller.ts
git commit -m "feat: add API endpoints for Redis and MinIO provisioning"
```

---

### Task 9: Frontend — New Project Page Toggles

**Files:**
- Modify: `frontend/src/app/projects/new/page.tsx`

- [ ] **Step 1: Add form state fields**

In the `useState` for `form` (around line 92), add after `useLocalDb: false,`:

```typescript
    useLocalRedis: false,
    useLocalMinio: false,
```

- [ ] **Step 2: Add icons import**

In the lucide-react import (line 11), add `HardDrive` and `Server` (or reuse existing icons). Update to:

```typescript
import { GitBranch, Upload, ChevronRight, Loader2, Check, Database, Globe, Terminal, File, X, AlertCircle, CheckCircle2, Server, HardDrive } from 'lucide-react';
```

- [ ] **Step 3: Add Redis toggle after Platform Database toggle**

After the Platform Database toggle `</div>` (line 643), add:

```tsx
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${form.useLocalRedis ? 'bg-foreground text-background' : 'bg-muted text-foreground-muted'}`}>
                  <Server className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-medium">Platform Redis</p>
                  <p className="text-xs text-foreground-muted">Auto-create Redis database and inject REDIS_URL</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.useLocalRedis}
                onClick={() => update({ useLocalRedis: !form.useLocalRedis })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${form.useLocalRedis ? 'bg-foreground' : 'bg-border'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform mt-0.5 ${form.useLocalRedis ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${form.useLocalMinio ? 'bg-foreground text-background' : 'bg-muted text-foreground-muted'}`}>
                  <HardDrive className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-medium">Platform Storage</p>
                  <p className="text-xs text-foreground-muted">Auto-create MinIO bucket and inject storage env vars</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.useLocalMinio}
                onClick={() => update({ useLocalMinio: !form.useLocalMinio })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${form.useLocalMinio ? 'bg-foreground' : 'bg-border'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform mt-0.5 ${form.useLocalMinio ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
```

- [ ] **Step 4: Pass new fields in handleCreate**

In the `createProject.mutateAsync()` call (around line 277), add after `useLocalDb`:

```typescript
        useLocalRedis: form.useLocalRedis || undefined,
        useLocalMinio: form.useLocalMinio || undefined,
```

- [ ] **Step 5: Add Redis and MinIO rows to the confirm step**

After the existing `useLocalDb` confirm row (around line 721), add:

```tsx
            {form.useLocalRedis && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-foreground-muted">Redis</span>
                <span className="text-[13px]">Redis <span className="text-foreground-muted">(auto-provisioned)</span></span>
              </div>
            )}
            {form.useLocalMinio && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-foreground-muted">Storage</span>
                <span className="text-[13px]">MinIO <span className="text-foreground-muted">(auto-provisioned)</span></span>
              </div>
            )}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/projects/new/page.tsx
git commit -m "feat: add Platform Redis and Platform Storage toggles to project creation"
```

---

### Task 10: Frontend — Settings Page Redis & MinIO Sections

**Files:**
- Modify: `frontend/src/app/projects/[id]/settings/page.tsx`

- [ ] **Step 1: Add state variables**

Find the existing state variables for database provisioning (near `dbExporting`, `dbDeleting`, `provisioning`) and add:

```typescript
  const [redisProvisioning, setRedisProvisioning] = useState(false);
  const [redisDeleting, setRedisDeleting] = useState(false);
  const [showRedisDeleteConfirm, setShowRedisDeleteConfirm] = useState(false);
  const [minioProvisioning, setMinioProvisioning] = useState(false);
  const [minioDeleting, setMinioDeleting] = useState(false);
  const [showMinioDeleteConfirm, setShowMinioDeleteConfirm] = useState(false);
```

- [ ] **Step 2: Add Redis card after the Database card**

After the Database `</Card>` (around line 347), add:

```tsx
      <Card>
        <CardHeader><CardTitle>Redis</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {project.useLocalRedis ? (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Active</span>
                <span className="text-sm">Platform Redis</span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">db {project.redisDbIndex}</code>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={redisDeleting}
                  onClick={() => setShowRedisDeleteConfirm(true)}
                >
                  Disable & Delete
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Enable platform Redis to auto-create a Redis database and inject <code className="bg-muted px-1 rounded">REDIS_URL</code> into environment variables.
              </p>
              <Button
                size="sm"
                disabled={redisProvisioning}
                onClick={async () => {
                  setRedisProvisioning(true);
                  try {
                    await api(`/projects/${projectId}/provision-redis`, { method: 'POST' });
                    toast.success('Redis created', { description: 'REDIS_URL has been added to your environment variables. Redeploy to apply.' });
                    refetch();
                    const newEnv = await api<Record<string, string>>(`/projects/${projectId}/env`);
                    setEnvVars(newEnv);
                  } catch (err: any) {
                    toast.error(`Failed: ${err.message}`);
                  } finally {
                    setRedisProvisioning(false);
                  }
                }}
              >
                {redisProvisioning ? 'Creating...' : 'Enable Platform Redis'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 3: Add MinIO card after the Redis card**

```tsx
      <Card>
        <CardHeader><CardTitle>Storage</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {project.useLocalMinio ? (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Active</span>
                <span className="text-sm">Platform Storage</span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{project.minioBucket}</code>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={minioDeleting}
                  onClick={() => setShowMinioDeleteConfirm(true)}
                >
                  Disable & Delete
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Enable platform storage to auto-create a MinIO bucket and inject storage env vars (<code className="bg-muted px-1 rounded">MINIO_ENDPOINT</code>, <code className="bg-muted px-1 rounded">MINIO_BUCKET</code>, etc.).
              </p>
              <Button
                size="sm"
                disabled={minioProvisioning}
                onClick={async () => {
                  setMinioProvisioning(true);
                  try {
                    await api(`/projects/${projectId}/provision-minio`, { method: 'POST' });
                    toast.success('Storage created', { description: 'MinIO env vars have been added. Redeploy to apply.' });
                    refetch();
                    const newEnv = await api<Record<string, string>>(`/projects/${projectId}/env`);
                    setEnvVars(newEnv);
                  } catch (err: any) {
                    toast.error(`Failed: ${err.message}`);
                  } finally {
                    setMinioProvisioning(false);
                  }
                }}
              >
                {minioProvisioning ? 'Creating...' : 'Enable Platform Storage'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 4: Add delete confirmation dialogs**

Find the existing database delete confirm dialog in the settings page. Add similar dialogs for Redis and MinIO near it:

```tsx
      <Dialog open={showRedisDeleteConfirm} onOpenChange={setShowRedisDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Platform Redis?</DialogTitle>
            <DialogDescription>
              This will flush all data in Redis database {project.redisDbIndex} and remove REDIS_URL from environment variables. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRedisDeleteConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={redisDeleting}
              onClick={async () => {
                setRedisDeleting(true);
                try {
                  await api(`/projects/${projectId}/provision-redis`, { method: 'DELETE' });
                  toast.success('Redis deleted');
                  setShowRedisDeleteConfirm(false);
                  refetch();
                  const newEnv = await api<Record<string, string>>(`/projects/${projectId}/env`);
                  setEnvVars(newEnv);
                } catch (err: any) {
                  toast.error(`Failed: ${err.message}`);
                } finally {
                  setRedisDeleting(false);
                }
              }}
            >
              {redisDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMinioDeleteConfirm} onOpenChange={setShowMinioDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Platform Storage?</DialogTitle>
            <DialogDescription>
              This will delete all files in bucket &quot;{project.minioBucket}&quot; and remove MinIO env vars. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMinioDeleteConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={minioDeleting}
              onClick={async () => {
                setMinioDeleting(true);
                try {
                  await api(`/projects/${projectId}/provision-minio`, { method: 'DELETE' });
                  toast.success('Storage deleted');
                  setShowMinioDeleteConfirm(false);
                  refetch();
                  const newEnv = await api<Record<string, string>>(`/projects/${projectId}/env`);
                  setEnvVars(newEnv);
                } catch (err: any) {
                  toast.error(`Failed: ${err.message}`);
                } finally {
                  setMinioDeleting(false);
                }
              }}
            >
              {minioDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/projects/[id]/settings/page.tsx
git commit -m "feat: add Redis and Storage management sections to project settings"
```
