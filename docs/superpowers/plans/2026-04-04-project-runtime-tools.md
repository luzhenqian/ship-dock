# Project Runtime Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Logs, Database, Redis, and Storage tabs to the project detail page, allowing users to view and manage their deployed project's runtime data directly within Ship-Dock.

**Architecture:** Direct-connect mode — the Ship-Dock backend connects to the target project's PostgreSQL, Redis, and MinIO using stored connection configs, and reads PM2 log files from the local filesystem. A `ConnectionPoolService` manages dynamic connections with idle timeout. Frontend adds 4 new tab pages reusing existing UI patterns (xterm.js, React Query, Socket.IO).

**Tech Stack:** NestJS (backend modules), Prisma (data model), `pg` (PostgreSQL client), `ioredis` (Redis client), `minio` (MinIO SDK), Next.js App Router (frontend pages), TanStack React Query (data fetching), xterm.js (log viewer), Socket.IO (real-time logs)

**Spec:** `docs/superpowers/specs/2026-04-04-project-runtime-tools-design.md`

---

## File Structure

### Backend — New Files

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | Add `ServiceConnection` model and `ServiceType` enum |
| `backend/src/services/services.module.ts` | Module registration for connection management |
| `backend/src/services/services.controller.ts` | CRUD endpoints for service connections |
| `backend/src/services/services.service.ts` | Business logic: CRUD, auto-detect, connection test |
| `backend/src/services/dto/create-service.dto.ts` | Validation DTO for creating connections |
| `backend/src/services/dto/update-service.dto.ts` | Validation DTO for updating connections |
| `backend/src/services/connection-pool.service.ts` | Dynamic connection pool manager (pg, ioredis, minio) |
| `backend/src/logs/logs.module.ts` | Module for PM2 log reading |
| `backend/src/logs/logs.controller.ts` | REST endpoint for historical logs |
| `backend/src/logs/logs.service.ts` | PM2 log file reading + tail |
| `backend/src/logs/logs.gateway.ts` | WebSocket gateway for real-time log streaming |
| `backend/src/database-browser/database-browser.module.ts` | Module for PostgreSQL browsing |
| `backend/src/database-browser/database-browser.controller.ts` | REST endpoints for tables, data, SQL queries |
| `backend/src/database-browser/database-browser.service.ts` | PostgreSQL query proxy with SQL validation |
| `backend/src/redis-browser/redis-browser.module.ts` | Module for Redis browsing |
| `backend/src/redis-browser/redis-browser.controller.ts` | REST endpoints for keys, values, commands |
| `backend/src/redis-browser/redis-browser.service.ts` | Redis operation proxy with command validation |
| `backend/src/storage-browser/storage-browser.module.ts` | Module for MinIO browsing |
| `backend/src/storage-browser/storage-browser.controller.ts` | REST endpoints for buckets, files, upload/download |
| `backend/src/storage-browser/storage-browser.service.ts` | MinIO operation proxy |

### Frontend — New Files

| File | Responsibility |
|------|----------------|
| `frontend/src/hooks/use-services.ts` | React Query hooks for service connections |
| `frontend/src/hooks/use-logs.ts` | Socket.IO hook for real-time PM2 logs |
| `frontend/src/hooks/use-database.ts` | React Query hooks for PostgreSQL browsing |
| `frontend/src/hooks/use-redis.ts` | React Query hooks for Redis browsing |
| `frontend/src/hooks/use-storage.ts` | React Query hooks for MinIO browsing |
| `frontend/src/app/projects/[id]/logs/page.tsx` | Logs tab page |
| `frontend/src/app/projects/[id]/database/page.tsx` | Database tab page |
| `frontend/src/app/projects/[id]/redis/page.tsx` | Redis tab page |
| `frontend/src/app/projects/[id]/storage/page.tsx` | Storage tab page |
| `frontend/src/components/sql-query-panel.tsx` | SQL editor + results table |
| `frontend/src/components/redis-cli-panel.tsx` | Redis CLI command interface |
| `frontend/src/components/confirm-dialog.tsx` | Reusable dangerous-action confirmation dialog |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/app.module.ts` | Register 5 new modules |
| `frontend/src/app/projects/[id]/layout.tsx` | Add 4 new tabs, move Settings to last |
| `frontend/src/lib/api.ts` | Add `apiRaw()` helper for non-JSON responses (file downloads) |

---

## Task 1: Prisma Schema — ServiceConnection Model

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add ServiceType enum and ServiceConnection model to schema**

Add after the `DnsProvider` enum (line 39 area) in `backend/prisma/schema.prisma`:

```prisma
enum ServiceType {
  POSTGRESQL
  REDIS
  MINIO
}
```

Add after the `Invite` model at the end of the file:

```prisma
model ServiceConnection {
  id           String      @id @default(uuid())
  projectId    String
  project      Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type         ServiceType
  name         String
  config       String
  autoDetected Boolean     @default(false)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  @@index([projectId])
}
```

Also add the relation to the `Project` model — add this line after the `portAllocation PortAllocation?` line:

```prisma
  services       ServiceConnection[]
```

- [ ] **Step 2: Generate Prisma client and create migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add-service-connections
```

Expected: Migration created successfully, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add ServiceConnection model for runtime service connections"
```

---

## Task 2: ConnectionPoolService — Dynamic Connection Manager

**Files:**
- Create: `backend/src/services/connection-pool.service.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd backend && npm install pg ioredis minio && npm install -D @types/pg
```

- [ ] **Step 2: Create ConnectionPoolService**

Create `backend/src/services/connection-pool.service.ts`:

```typescript
import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import * as Minio from 'minio';

interface PoolEntry<T> {
  client: T;
  lastUsed: number;
}

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class ConnectionPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionPoolService.name);
  private pgPools = new Map<string, PoolEntry<Pool>>();
  private redisClients = new Map<string, PoolEntry<Redis>>();
  private minioClients = new Map<string, PoolEntry<Minio.Client>>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupIdle(), 60_000);
  }

  getPgPool(connectionId: string, config: { host: string; port: number; database: string; user: string; password: string; ssl?: boolean }): Pool {
    const entry = this.pgPools.get(connectionId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: IDLE_TIMEOUT,
    });

    this.pgPools.set(connectionId, { client: pool, lastUsed: Date.now() });
    return pool;
  }

  getRedisClient(connectionId: string, config: { host: string; port: number; password?: string; db?: number }): Redis {
    const entry = this.redisClients.get(connectionId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    const client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password || undefined,
      db: config.db || 0,
      lazyConnect: true,
    });

    this.redisClients.set(connectionId, { client, lastUsed: Date.now() });
    return client;
  }

  getMinioClient(connectionId: string, config: { endPoint: string; port: number; accessKey: string; secretKey: string; useSSL?: boolean }): Minio.Client {
    const entry = this.minioClients.get(connectionId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    const client = new Minio.Client({
      endPoint: config.endPoint,
      port: config.port,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      useSSL: config.useSSL ?? false,
    });

    this.minioClients.set(connectionId, { client, lastUsed: Date.now() });
    return client;
  }

  async removeConnection(connectionId: string) {
    const pg = this.pgPools.get(connectionId);
    if (pg) { await pg.client.end(); this.pgPools.delete(connectionId); }

    const redis = this.redisClients.get(connectionId);
    if (redis) { redis.client.disconnect(); this.redisClients.delete(connectionId); }

    this.minioClients.delete(connectionId);
  }

  private async cleanupIdle() {
    const now = Date.now();

    for (const [id, entry] of this.pgPools) {
      if (now - entry.lastUsed > IDLE_TIMEOUT) {
        this.logger.debug(`Closing idle PG pool: ${id}`);
        await entry.client.end();
        this.pgPools.delete(id);
      }
    }

    for (const [id, entry] of this.redisClients) {
      if (now - entry.lastUsed > IDLE_TIMEOUT) {
        this.logger.debug(`Closing idle Redis client: ${id}`);
        entry.client.disconnect();
        this.redisClients.delete(id);
      }
    }

    for (const [id, entry] of this.minioClients) {
      if (now - entry.lastUsed > IDLE_TIMEOUT) {
        this.logger.debug(`Removing idle MinIO client: ${id}`);
        this.minioClients.delete(id);
      }
    }
  }

  async onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    for (const [, entry] of this.pgPools) await entry.client.end();
    for (const [, entry] of this.redisClients) entry.client.disconnect();
    this.pgPools.clear();
    this.redisClients.clear();
    this.minioClients.clear();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/connection-pool.service.ts backend/package.json backend/package-lock.json
git commit -m "feat: add ConnectionPoolService for dynamic pg/redis/minio connections"
```

---

## Task 3: ServicesModule — Connection Management CRUD

**Files:**
- Create: `backend/src/services/dto/create-service.dto.ts`
- Create: `backend/src/services/dto/update-service.dto.ts`
- Create: `backend/src/services/services.service.ts`
- Create: `backend/src/services/services.controller.ts`
- Create: `backend/src/services/services.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

Create `backend/src/services/dto/create-service.dto.ts`:

```typescript
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateServiceDto {
  @IsEnum(['POSTGRESQL', 'REDIS', 'MINIO'])
  type: 'POSTGRESQL' | 'REDIS' | 'MINIO';

  @IsString()
  name: string;

  @IsObject()
  config: Record<string, any>;
}
```

Create `backend/src/services/dto/update-service.dto.ts`:

```typescript
import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateServiceDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsObject()
  config?: Record<string, any>;
}
```

- [ ] **Step 2: Create ServicesService**

Create `backend/src/services/services.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConnectionPoolService } from './connection-pool.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private pool: ConnectionPoolService,
  ) {}

  async findAll(projectId: string) {
    const services = await this.prisma.serviceConnection.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    // Return without decrypting config (just metadata)
    return services.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      type: s.type,
      name: s.name,
      autoDetected: s.autoDetected,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async create(projectId: string, dto: CreateServiceDto) {
    return this.prisma.serviceConnection.create({
      data: {
        projectId,
        type: dto.type,
        name: dto.name,
        config: this.encryption.encrypt(JSON.stringify(dto.config)),
        autoDetected: false,
      },
    });
  }

  async update(id: string, dto: UpdateServiceDto) {
    const existing = await this.prisma.serviceConnection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service connection not found');

    const data: any = {};
    if (dto.name) data.name = dto.name;
    if (dto.config) {
      data.config = this.encryption.encrypt(JSON.stringify(dto.config));
      // Remove old pooled connection since config changed
      await this.pool.removeConnection(id);
    }

    return this.prisma.serviceConnection.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.pool.removeConnection(id);
    return this.prisma.serviceConnection.delete({ where: { id } });
  }

  getDecryptedConfig(service: { id: string; config: string }) {
    return JSON.parse(this.encryption.decrypt(service.config));
  }

  async getServiceWithConfig(projectId: string, type: string) {
    const service = await this.prisma.serviceConnection.findFirst({
      where: { projectId, type: type as any },
    });
    if (!service) throw new NotFoundException(`No ${type} connection configured for this project`);
    return { service, config: this.getDecryptedConfig(service) };
  }

  async detect(projectId: string) {
    // Get decrypted env vars from the project
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || !project.envVars) return [];

    let envVars: Record<string, string>;
    try {
      envVars = JSON.parse(this.encryption.decrypt(project.envVars));
    } catch {
      return [];
    }

    const detected: Array<{ type: string; name: string; config: Record<string, any> }> = [];

    // PostgreSQL: DATABASE_URL
    if (envVars.DATABASE_URL) {
      try {
        const url = new URL(envVars.DATABASE_URL);
        detected.push({
          type: 'POSTGRESQL',
          name: 'Database (auto-detected)',
          config: {
            host: url.hostname,
            port: parseInt(url.port) || 5432,
            database: url.pathname.slice(1),
            user: url.username,
            password: url.password,
            ssl: url.searchParams.get('sslmode') === 'require',
          },
        });
      } catch {}
    }
    // PostgreSQL: PG_HOST + PG_PORT + ...
    if (!envVars.DATABASE_URL && envVars.PG_HOST) {
      detected.push({
        type: 'POSTGRESQL',
        name: 'Database (auto-detected)',
        config: {
          host: envVars.PG_HOST,
          port: parseInt(envVars.PG_PORT || '5432'),
          database: envVars.PG_DATABASE || 'postgres',
          user: envVars.PG_USER || 'postgres',
          password: envVars.PG_PASSWORD || '',
        },
      });
    }

    // Redis: REDIS_URL
    if (envVars.REDIS_URL) {
      try {
        const url = new URL(envVars.REDIS_URL);
        detected.push({
          type: 'REDIS',
          name: 'Redis (auto-detected)',
          config: {
            host: url.hostname,
            port: parseInt(url.port) || 6379,
            password: url.password || undefined,
            db: parseInt(url.pathname.slice(1)) || 0,
          },
        });
      } catch {}
    }
    // Redis: REDIS_HOST + REDIS_PORT
    if (!envVars.REDIS_URL && envVars.REDIS_HOST) {
      detected.push({
        type: 'REDIS',
        name: 'Redis (auto-detected)',
        config: {
          host: envVars.REDIS_HOST,
          port: parseInt(envVars.REDIS_PORT || '6379'),
          password: envVars.REDIS_PASSWORD || undefined,
          db: parseInt(envVars.REDIS_DB || '0'),
        },
      });
    }

    // MinIO: MINIO_ENDPOINT + MINIO_ACCESS_KEY + MINIO_SECRET_KEY
    if (envVars.MINIO_ENDPOINT && envVars.MINIO_ACCESS_KEY && envVars.MINIO_SECRET_KEY) {
      const endpoint = envVars.MINIO_ENDPOINT.replace(/^https?:\/\//, '');
      detected.push({
        type: 'MINIO',
        name: 'Storage (auto-detected)',
        config: {
          endPoint: endpoint.split(':')[0],
          port: parseInt(endpoint.split(':')[1] || (envVars.MINIO_USE_SSL === 'true' ? '443' : '9000')),
          accessKey: envVars.MINIO_ACCESS_KEY,
          secretKey: envVars.MINIO_SECRET_KEY,
          useSSL: envVars.MINIO_USE_SSL === 'true',
        },
      });
    }
    // S3-compatible: S3_ENDPOINT + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
    if (envVars.S3_ENDPOINT && envVars.AWS_ACCESS_KEY_ID && envVars.AWS_SECRET_ACCESS_KEY) {
      const endpoint = envVars.S3_ENDPOINT.replace(/^https?:\/\//, '');
      detected.push({
        type: 'MINIO',
        name: 'S3 Storage (auto-detected)',
        config: {
          endPoint: endpoint.split(':')[0],
          port: parseInt(endpoint.split(':')[1] || '9000'),
          accessKey: envVars.AWS_ACCESS_KEY_ID,
          secretKey: envVars.AWS_SECRET_ACCESS_KEY,
          useSSL: envVars.S3_ENDPOINT.startsWith('https'),
        },
      });
    }

    return detected;
  }

  async detectAndSave(projectId: string) {
    const detected = await this.detect(projectId);
    const results = [];

    for (const item of detected) {
      // Skip if already have a connection of this type
      const existing = await this.prisma.serviceConnection.findFirst({
        where: { projectId, type: item.type as any },
      });
      if (existing) continue;

      const created = await this.prisma.serviceConnection.create({
        data: {
          projectId,
          type: item.type as any,
          name: item.name,
          config: this.encryption.encrypt(JSON.stringify(item.config)),
          autoDetected: true,
        },
      });
      results.push(created);
    }

    return results;
  }

  async testConnection(id: string) {
    const service = await this.prisma.serviceConnection.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Service connection not found');

    const config = this.getDecryptedConfig(service);

    try {
      if (service.type === 'POSTGRESQL') {
        const pool = this.pool.getPgPool(id, config);
        const result = await pool.query('SELECT 1');
        return { success: true, message: 'Connected successfully' };
      }

      if (service.type === 'REDIS') {
        const client = this.pool.getRedisClient(id, config);
        await client.connect();
        await client.ping();
        return { success: true, message: 'Connected successfully' };
      }

      if (service.type === 'MINIO') {
        const client = this.pool.getMinioClient(id, config);
        await client.listBuckets();
        return { success: true, message: 'Connected successfully' };
      }

      return { success: false, message: 'Unknown service type' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}
```

- [ ] **Step 3: Create ServicesController**

Create `backend/src/services/services.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Controller('projects/:projectId/services')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @Get() @MinRole('VIEWER')
  findAll(@Param('projectId') projectId: string) {
    return this.servicesService.findAll(projectId);
  }

  @Post() @MinRole('DEVELOPER')
  create(@Param('projectId') projectId: string, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(projectId, dto);
  }

  @Patch(':sid') @MinRole('DEVELOPER')
  update(@Param('sid') sid: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(sid, dto);
  }

  @Delete(':sid') @MinRole('DEVELOPER')
  delete(@Param('sid') sid: string) {
    return this.servicesService.delete(sid);
  }

  @Post('detect') @MinRole('DEVELOPER')
  detect(@Param('projectId') projectId: string) {
    return this.servicesService.detectAndSave(projectId);
  }

  @Post(':sid/test') @MinRole('VIEWER')
  test(@Param('sid') sid: string) {
    return this.servicesService.testConnection(sid);
  }
}
```

- [ ] **Step 4: Create ServicesModule**

Create `backend/src/services/services.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ConnectionPoolService } from './connection-pool.service';

@Global()
@Module({
  controllers: [ServicesController],
  providers: [ServicesService, ConnectionPoolService],
  exports: [ServicesService, ConnectionPoolService],
})
export class ServicesModule {}
```

- [ ] **Step 5: Register ServicesModule in AppModule**

In `backend/src/app.module.ts`, add import:

```typescript
import { ServicesModule } from './services/services.module';
```

Add `ServicesModule` to the `imports` array (after `UploadModule`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ backend/src/app.module.ts
git commit -m "feat: add ServicesModule with CRUD, auto-detection, and connection testing"
```

---

## Task 4: LogsModule — PM2 Log Streaming

**Files:**
- Create: `backend/src/logs/logs.service.ts`
- Create: `backend/src/logs/logs.controller.ts`
- Create: `backend/src/logs/logs.gateway.ts`
- Create: `backend/src/logs/logs.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create LogsService**

Create `backend/src/logs/logs.service.ts`:

```typescript
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private tails = new Map<string, ChildProcess>();

  constructor(private prisma: PrismaService) {}

  private getLogPaths(pm2Name: string) {
    const pm2LogDir = join(homedir(), '.pm2', 'logs');
    return {
      stdout: join(pm2LogDir, `${pm2Name}-out.log`),
      stderr: join(pm2LogDir, `${pm2Name}-error.log`),
    };
  }

  async getHistoricalLogs(
    projectId: string,
    options: { type?: 'stdout' | 'stderr'; lines?: number; search?: string },
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const paths = this.getLogPaths(project.pm2Name);
    const type = options.type || 'stdout';
    const filePath = type === 'stderr' ? paths.stderr : paths.stdout;

    if (!existsSync(filePath)) return { lines: [], type };

    const content = await readFile(filePath, 'utf-8');
    let lines = content.split('\n').filter((l) => l.length > 0);

    if (options.search) {
      const search = options.search.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(search));
    }

    const maxLines = options.lines || 200;
    lines = lines.slice(-maxLines);

    return { lines, type };
  }

  async startTail(
    projectId: string,
    onLog: (data: { type: string; line: string }) => void,
  ): Promise<void> {
    if (this.tails.has(projectId)) return;

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const paths = this.getLogPaths(project.pm2Name);

    for (const [type, filePath] of [['stdout', paths.stdout], ['stderr', paths.stderr]] as const) {
      if (!existsSync(filePath)) continue;

      const tail = spawn('tail', ['-f', '-n', '0', filePath]);
      const key = `${projectId}:${type}`;
      this.tails.set(key, tail);

      tail.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.length > 0);
        for (const line of lines) {
          onLog({ type, line });
        }
      });

      tail.on('close', () => {
        this.tails.delete(key);
      });
    }
  }

  stopTail(projectId: string) {
    for (const type of ['stdout', 'stderr']) {
      const key = `${projectId}:${type}`;
      const tail = this.tails.get(key);
      if (tail) {
        tail.kill();
        this.tails.delete(key);
      }
    }
  }
}
```

- [ ] **Step 2: Create LogsController**

Create `backend/src/logs/logs.controller.ts`:

```typescript
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { LogsService } from './logs.service';

@Controller('projects/:projectId/logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LogsController {
  constructor(private logsService: LogsService) {}

  @Get() @MinRole('VIEWER')
  getLogs(
    @Param('projectId') projectId: string,
    @Query('type') type?: 'stdout' | 'stderr',
    @Query('lines') lines?: string,
    @Query('search') search?: string,
  ) {
    return this.logsService.getHistoricalLogs(projectId, {
      type,
      lines: lines ? parseInt(lines) : undefined,
      search,
    });
  }
}
```

- [ ] **Step 3: Create LogsGateway**

Create `backend/src/logs/logs.gateway.ts`:

```typescript
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LogsService } from './logs.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class LogsGateway implements OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private clientProjects = new Map<string, string>(); // clientId -> projectId

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private logsService: LogsService,
  ) {}

  async handleDisconnect(client: Socket) {
    const projectId = this.clientProjects.get(client.id);
    if (projectId) {
      client.leave(`logs:${projectId}`);
      this.clientProjects.delete(client.id);
      // Stop tail if no one is listening
      const room = this.server.sockets.adapter.rooms.get(`logs:${projectId}`);
      if (!room || room.size === 0) {
        this.logsService.stopTail(projectId);
      }
    }
  }

  @SubscribeMessage('join-logs')
  async handleJoinLogs(client: Socket, projectId: string) {
    client.join(`logs:${projectId}`);
    this.clientProjects.set(client.id, projectId);

    // Start tailing if this is the first subscriber
    const room = this.server.sockets.adapter.rooms.get(`logs:${projectId}`);
    if (room && room.size === 1) {
      await this.logsService.startTail(projectId, (data) => {
        this.server.to(`logs:${projectId}`).emit('log-line', data);
      });
    }
  }

  @SubscribeMessage('leave-logs')
  handleLeaveLogs(client: Socket, projectId: string) {
    client.leave(`logs:${projectId}`);
    this.clientProjects.delete(client.id);

    const room = this.server.sockets.adapter.rooms.get(`logs:${projectId}`);
    if (!room || room.size === 0) {
      this.logsService.stopTail(projectId);
    }
  }
}
```

- [ ] **Step 4: Create LogsModule and register in AppModule**

Create `backend/src/logs/logs.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { LogsGateway } from './logs.gateway';

@Module({
  imports: [JwtModule.register({})],
  controllers: [LogsController],
  providers: [LogsService, LogsGateway],
})
export class LogsModule {}
```

In `backend/src/app.module.ts`, add:

```typescript
import { LogsModule } from './logs/logs.module';
```

Add `LogsModule` to imports array.

- [ ] **Step 5: Commit**

```bash
git add backend/src/logs/ backend/src/app.module.ts
git commit -m "feat: add LogsModule with PM2 log reading and real-time WebSocket streaming"
```

---

## Task 5: DatabaseBrowserModule — PostgreSQL Query Proxy

**Files:**
- Create: `backend/src/database-browser/database-browser.service.ts`
- Create: `backend/src/database-browser/database-browser.controller.ts`
- Create: `backend/src/database-browser/database-browser.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create DatabaseBrowserService**

Create `backend/src/database-browser/database-browser.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';

const ALLOWED_SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|EXPLAIN)\b/i;
const BLOCKED_SQL = /\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|SET|COPY)\b/i;

@Injectable()
export class DatabaseBrowserService {
  constructor(
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
  ) {}

  private async getPool(projectId: string) {
    const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'POSTGRESQL');
    return this.pool.getPgPool(service.id, config);
  }

  async getTables(projectId: string) {
    const pool = await this.getPool(projectId);
    const result = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    return result.rows;
  }

  async getTableStructure(projectId: string, table: string) {
    const pool = await this.getPool(projectId);

    // Validate table name (alphanumeric + underscore only)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('Invalid table name');
    }

    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);

    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
    `, [table]);

    return { columns: columns.rows, indexes: indexes.rows };
  }

  async getTableData(
    projectId: string,
    table: string,
    options: { page?: number; pageSize?: number; sort?: string; order?: 'asc' | 'desc' },
  ) {
    const pool = await this.getPool(projectId);

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('Invalid table name');
    }

    const page = options.page || 1;
    const pageSize = Math.min(options.pageSize || 50, 200);
    const offset = (page - 1) * pageSize;

    // Validate sort column if provided
    let orderClause = '';
    if (options.sort && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.sort)) {
      const order = options.order === 'desc' ? 'DESC' : 'ASC';
      orderClause = `ORDER BY "${options.sort}" ${order}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM "${table}"`);
    const total = parseInt(countResult.rows[0].total);

    const dataResult = await pool.query(
      `SELECT * FROM "${table}" ${orderClause} LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );

    return {
      rows: dataResult.rows,
      columns: dataResult.fields.map((f) => f.name),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async executeQuery(projectId: string, sql: string) {
    if (!ALLOWED_SQL.test(sql)) {
      throw new BadRequestException('Only SELECT, INSERT, UPDATE, DELETE, and EXPLAIN statements are allowed');
    }
    if (BLOCKED_SQL.test(sql)) {
      throw new BadRequestException('DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE, SET, and COPY statements are not allowed');
    }

    const pool = await this.getPool(projectId);
    const result = await pool.query(sql);

    return {
      rows: result.rows || [],
      columns: result.fields?.map((f) => f.name) || [],
      rowCount: result.rowCount,
      command: result.command,
    };
  }
}
```

- [ ] **Step 2: Create DatabaseBrowserController**

Create `backend/src/database-browser/database-browser.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DatabaseBrowserService } from './database-browser.service';

@Controller('projects/:projectId/database')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatabaseBrowserController {
  constructor(private dbService: DatabaseBrowserService) {}

  @Get('tables') @MinRole('VIEWER')
  getTables(@Param('projectId') projectId: string) {
    return this.dbService.getTables(projectId);
  }

  @Get('tables/:table') @MinRole('VIEWER')
  getTable(
    @Param('projectId') projectId: string,
    @Param('table') table: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.dbService.getTableData(projectId, table, {
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
      sort,
      order,
    });
  }

  @Get('tables/:table/structure') @MinRole('VIEWER')
  getTableStructure(
    @Param('projectId') projectId: string,
    @Param('table') table: string,
  ) {
    return this.dbService.getTableStructure(projectId, table);
  }

  @Post('query') @MinRole('DEVELOPER')
  executeQuery(
    @Param('projectId') projectId: string,
    @Body('sql') sql: string,
  ) {
    return this.dbService.executeQuery(projectId, sql);
  }
}
```

- [ ] **Step 3: Create DatabaseBrowserModule and register**

Create `backend/src/database-browser/database-browser.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DatabaseBrowserController } from './database-browser.controller';
import { DatabaseBrowserService } from './database-browser.service';

@Module({
  controllers: [DatabaseBrowserController],
  providers: [DatabaseBrowserService],
})
export class DatabaseBrowserModule {}
```

In `backend/src/app.module.ts`, add:

```typescript
import { DatabaseBrowserModule } from './database-browser/database-browser.module';
```

Add `DatabaseBrowserModule` to imports array.

- [ ] **Step 4: Commit**

```bash
git add backend/src/database-browser/ backend/src/app.module.ts
git commit -m "feat: add DatabaseBrowserModule with table browsing and SQL query proxy"
```

---

## Task 6: RedisBrowserModule — Redis Operation Proxy

**Files:**
- Create: `backend/src/redis-browser/redis-browser.service.ts`
- Create: `backend/src/redis-browser/redis-browser.controller.ts`
- Create: `backend/src/redis-browser/redis-browser.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create RedisBrowserService**

Create `backend/src/redis-browser/redis-browser.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';

const BLOCKED_COMMANDS = new Set([
  'FLUSHALL', 'FLUSHDB', 'CONFIG', 'SHUTDOWN', 'DEBUG',
  'SLAVEOF', 'REPLICAOF', 'CLUSTER', 'KEYS',
]);

@Injectable()
export class RedisBrowserService {
  constructor(
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
  ) {}

  private async getClient(projectId: string) {
    const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'REDIS');
    const client = this.pool.getRedisClient(service.id, config);
    if (client.status === 'wait') await client.connect();
    return client;
  }

  async scanKeys(projectId: string, pattern: string = '*', cursor: string = '0', count: number = 50) {
    const client = await this.getClient(projectId);
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', count);

    // Get type for each key
    const pipeline = client.pipeline();
    for (const key of keys) {
      pipeline.type(key);
    }
    const types = await pipeline.exec();

    const items = keys.map((key, i) => ({
      key,
      type: types?.[i]?.[1] as string || 'unknown',
    }));

    return { cursor: nextCursor, keys: items, done: nextCursor === '0' };
  }

  async getKeyDetail(projectId: string, key: string) {
    const client = await this.getClient(projectId);
    const type = await client.type(key);
    const ttl = await client.ttl(key);

    let value: any;
    let size: number;

    switch (type) {
      case 'string': {
        value = await client.get(key);
        size = await client.strlen(key);
        break;
      }
      case 'hash': {
        value = await client.hgetall(key);
        size = await client.hlen(key);
        break;
      }
      case 'list': {
        value = await client.lrange(key, 0, 99); // first 100 items
        size = await client.llen(key);
        break;
      }
      case 'set': {
        value = await client.smembers(key);
        size = await client.scard(key);
        break;
      }
      case 'zset': {
        value = await client.zrange(key, 0, 99, 'WITHSCORES');
        size = await client.zcard(key);
        break;
      }
      default:
        value = null;
        size = 0;
    }

    return { key, type, ttl, size, value };
  }

  async createKey(projectId: string, data: { key: string; type: string; value: any; ttl?: number }) {
    const client = await this.getClient(projectId);

    switch (data.type) {
      case 'string':
        await client.set(data.key, data.value);
        break;
      case 'hash':
        await client.hmset(data.key, data.value);
        break;
      case 'list':
        await client.rpush(data.key, ...data.value);
        break;
      case 'set':
        await client.sadd(data.key, ...data.value);
        break;
      default:
        throw new BadRequestException(`Unsupported type: ${data.type}`);
    }

    if (data.ttl && data.ttl > 0) {
      await client.expire(data.key, data.ttl);
    }

    return { success: true };
  }

  async updateKey(projectId: string, key: string, value: any, ttl?: number) {
    const client = await this.getClient(projectId);
    const type = await client.type(key);

    switch (type) {
      case 'string':
        await client.set(key, value);
        break;
      case 'hash':
        await client.del(key);
        await client.hmset(key, value);
        break;
      case 'list':
        await client.del(key);
        await client.rpush(key, ...value);
        break;
      case 'set':
        await client.del(key);
        await client.sadd(key, ...value);
        break;
      default:
        throw new BadRequestException(`Cannot update type: ${type}`);
    }

    if (ttl !== undefined && ttl > 0) {
      await client.expire(key, ttl);
    }

    return { success: true };
  }

  async deleteKey(projectId: string, key: string) {
    const client = await this.getClient(projectId);
    await client.del(key);
    return { success: true };
  }

  async executeCommand(projectId: string, command: string) {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toUpperCase();

    if (BLOCKED_COMMANDS.has(cmd)) {
      throw new BadRequestException(`Command "${cmd}" is not allowed. Blocked commands: ${Array.from(BLOCKED_COMMANDS).join(', ')}`);
    }

    const client = await this.getClient(projectId);
    const result = await (client as any).call(cmd, ...parts.slice(1));
    return { result };
  }
}
```

- [ ] **Step 2: Create RedisBrowserController**

Create `backend/src/redis-browser/redis-browser.controller.ts`:

```typescript
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { RedisBrowserService } from './redis-browser.service';

@Controller('projects/:projectId/redis')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RedisBrowserController {
  constructor(private redisService: RedisBrowserService) {}

  @Get('keys') @MinRole('VIEWER')
  scanKeys(
    @Param('projectId') projectId: string,
    @Query('pattern') pattern?: string,
    @Query('cursor') cursor?: string,
    @Query('count') count?: string,
  ) {
    return this.redisService.scanKeys(projectId, pattern, cursor, count ? parseInt(count) : undefined);
  }

  @Get('keys/detail') @MinRole('VIEWER')
  getKeyDetail(
    @Param('projectId') projectId: string,
    @Query('key') key: string,
  ) {
    return this.redisService.getKeyDetail(projectId, key);
  }

  @Post('keys') @MinRole('DEVELOPER')
  createKey(
    @Param('projectId') projectId: string,
    @Body() data: { key: string; type: string; value: any; ttl?: number },
  ) {
    return this.redisService.createKey(projectId, data);
  }

  @Put('keys/update') @MinRole('DEVELOPER')
  updateKey(
    @Param('projectId') projectId: string,
    @Query('key') key: string,
    @Body() data: { value: any; ttl?: number },
  ) {
    return this.redisService.updateKey(projectId, key, data.value, data.ttl);
  }

  @Delete('keys/delete') @MinRole('DEVELOPER')
  deleteKey(
    @Param('projectId') projectId: string,
    @Query('key') key: string,
  ) {
    return this.redisService.deleteKey(projectId, key);
  }

  @Post('command') @MinRole('DEVELOPER')
  executeCommand(
    @Param('projectId') projectId: string,
    @Body('command') command: string,
  ) {
    return this.redisService.executeCommand(projectId, command);
  }
}
```

- [ ] **Step 3: Create RedisBrowserModule and register**

Create `backend/src/redis-browser/redis-browser.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { RedisBrowserController } from './redis-browser.controller';
import { RedisBrowserService } from './redis-browser.service';

@Module({
  controllers: [RedisBrowserController],
  providers: [RedisBrowserService],
})
export class RedisBrowserModule {}
```

In `backend/src/app.module.ts`, add:

```typescript
import { RedisBrowserModule } from './redis-browser/redis-browser.module';
```

Add `RedisBrowserModule` to imports array.

- [ ] **Step 4: Commit**

```bash
git add backend/src/redis-browser/ backend/src/app.module.ts
git commit -m "feat: add RedisBrowserModule with key browsing, CRUD, and CLI command proxy"
```

---

## Task 7: StorageBrowserModule — MinIO File Proxy

**Files:**
- Create: `backend/src/storage-browser/storage-browser.service.ts`
- Create: `backend/src/storage-browser/storage-browser.controller.ts`
- Create: `backend/src/storage-browser/storage-browser.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create StorageBrowserService**

Create `backend/src/storage-browser/storage-browser.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';
import { Readable } from 'stream';

@Injectable()
export class StorageBrowserService {
  constructor(
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
  ) {}

  private async getClient(projectId: string) {
    const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'MINIO');
    return this.pool.getMinioClient(service.id, config);
  }

  async listBuckets(projectId: string) {
    const client = await this.getClient(projectId);
    return client.listBuckets();
  }

  async listObjects(
    projectId: string,
    bucket: string,
    options: { prefix?: string; delimiter?: string; maxKeys?: number; continuationToken?: string },
  ) {
    const client = await this.getClient(projectId);
    const prefix = options.prefix || '';
    const delimiter = options.delimiter || '/';

    return new Promise<{ objects: any[]; prefixes: string[] }>((resolve, reject) => {
      const objects: any[] = [];
      const prefixes: string[] = [];

      const stream = client.listObjectsV2(bucket, prefix, false, delimiter);
      let count = 0;
      const maxKeys = options.maxKeys || 100;

      stream.on('data', (obj: any) => {
        if (count >= maxKeys) {
          stream.destroy();
          return;
        }
        if (obj.prefix) {
          prefixes.push(obj.prefix);
        } else {
          objects.push({
            name: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
            etag: obj.etag,
          });
        }
        count++;
      });

      stream.on('end', () => resolve({ objects, prefixes }));
      stream.on('error', reject);
    });
  }

  async getObject(projectId: string, bucket: string, key: string): Promise<Readable> {
    const client = await this.getClient(projectId);
    return client.getObject(bucket, key);
  }

  async getObjectStat(projectId: string, bucket: string, key: string) {
    const client = await this.getClient(projectId);
    return client.statObject(bucket, key);
  }

  async uploadObject(projectId: string, bucket: string, key: string, buffer: Buffer, contentType: string) {
    const client = await this.getClient(projectId);
    await client.putObject(bucket, key, buffer, buffer.length, { 'Content-Type': contentType });
    return { success: true, key };
  }

  async deleteObject(projectId: string, bucket: string, key: string) {
    const client = await this.getClient(projectId);
    await client.removeObject(bucket, key);
    return { success: true };
  }
}
```

- [ ] **Step 2: Create StorageBrowserController**

Create `backend/src/storage-browser/storage-browser.controller.ts`:

```typescript
import { Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { StorageBrowserService } from './storage-browser.service';

@Controller('projects/:projectId/storage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StorageBrowserController {
  constructor(private storageService: StorageBrowserService) {}

  @Get('buckets') @MinRole('VIEWER')
  listBuckets(@Param('projectId') projectId: string) {
    return this.storageService.listBuckets(projectId);
  }

  @Get('buckets/:bucket') @MinRole('VIEWER')
  listObjects(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('prefix') prefix?: string,
    @Query('delimiter') delimiter?: string,
    @Query('maxKeys') maxKeys?: string,
  ) {
    return this.storageService.listObjects(projectId, bucket, {
      prefix,
      delimiter,
      maxKeys: maxKeys ? parseInt(maxKeys) : undefined,
    });
  }

  @Get('buckets/:bucket/download') @MinRole('VIEWER')
  async downloadObject(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('key') key: string,
    @Res() res: Response,
  ) {
    const stat = await this.storageService.getObjectStat(projectId, bucket, key);
    const stream = await this.storageService.getObject(projectId, bucket, key);

    const filename = key.split('/').pop() || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    if (stat.size) res.setHeader('Content-Length', stat.size.toString());

    stream.pipe(res);
  }

  @Post('buckets/:bucket/upload') @MinRole('DEVELOPER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadObject(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('prefix') prefix: string = '',
    @UploadedFile() file: Express.Multer.File,
  ) {
    const key = prefix ? `${prefix}${file.originalname}` : file.originalname;
    return this.storageService.uploadObject(projectId, bucket, key, file.buffer, file.mimetype);
  }

  @Delete('buckets/:bucket/objects') @MinRole('DEVELOPER')
  deleteObject(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('key') key: string,
  ) {
    return this.storageService.deleteObject(projectId, bucket, key);
  }
}
```

- [ ] **Step 3: Create StorageBrowserModule and register**

Create `backend/src/storage-browser/storage-browser.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { StorageBrowserController } from './storage-browser.controller';
import { StorageBrowserService } from './storage-browser.service';

@Module({
  controllers: [StorageBrowserController],
  providers: [StorageBrowserService],
})
export class StorageBrowserModule {}
```

In `backend/src/app.module.ts`, add:

```typescript
import { StorageBrowserModule } from './storage-browser/storage-browser.module';
```

Add `StorageBrowserModule` to imports array.

- [ ] **Step 4: Commit**

```bash
git add backend/src/storage-browser/ backend/src/app.module.ts
git commit -m "feat: add StorageBrowserModule with bucket listing, file upload/download/delete"
```

---

## Task 8: Frontend — Shared Components and Hooks

**Files:**
- Create: `frontend/src/components/confirm-dialog.tsx`
- Create: `frontend/src/hooks/use-services.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/projects/[id]/layout.tsx`

- [ ] **Step 1: Add apiRaw helper to api.ts**

In `frontend/src/lib/api.ts`, add before the final closing of the file — add this function after the existing `api` function:

```typescript
export async function apiRaw(path: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      setAccessToken(data.accessToken);
      headers.Authorization = `Bearer ${data.accessToken}`;
      return fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
    }
    setAccessToken(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res;
}
```

- [ ] **Step 2: Create ConfirmDialog component**

Create `frontend/src/components/confirm-dialog.tsx`:

```typescript
'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  onConfirm: () => void;
  destructive?: boolean;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmText, onConfirm, destructive = true,
}: ConfirmDialogProps) {
  const [input, setInput] = useState('');
  const requiresTyping = !!confirmText;

  const handleConfirm = () => {
    if (requiresTyping && input !== confirmText) return;
    onConfirm();
    onOpenChange(false);
    setInput('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); setInput(''); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {requiresTyping && (
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Type <span className="font-mono font-bold">{confirmText}</span> to confirm:
            </p>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={confirmText} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setInput(''); }}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={requiresTyping && input !== confirmText}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create use-services hook**

Create `frontend/src/hooks/use-services.ts`:

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useServices(projectId: string) {
  return useQuery({
    queryKey: ['services', projectId],
    queryFn: () => api(`/projects/${projectId}/services`),
  });
}

export function useCreateService(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: string; name: string; config: Record<string, any> }) =>
      api(`/projects/${projectId}/services`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', projectId] }),
  });
}

export function useDeleteService(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) =>
      api(`/projects/${projectId}/services/${sid}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', projectId] }),
  });
}

export function useDetectServices(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}/services/detect`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services', projectId] }),
  });
}

export function useTestService(projectId: string) {
  return useMutation({
    mutationFn: (sid: string) =>
      api(`/projects/${projectId}/services/${sid}/test`, { method: 'POST' }),
  });
}
```

- [ ] **Step 4: Update layout.tsx with new tabs**

In `frontend/src/app/projects/[id]/layout.tsx`, replace the `tabs` array:

```typescript
const tabs = [
  { href: 'deployments', label: 'Deployments' },
  { href: 'pipeline', label: 'Pipeline' },
  { href: 'logs', label: 'Logs' },
  { href: 'database', label: 'Database' },
  { href: 'redis', label: 'Redis' },
  { href: 'storage', label: 'Storage' },
  { href: 'settings', label: 'Settings' },
];
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/confirm-dialog.tsx frontend/src/hooks/use-services.ts frontend/src/app/projects/\[id\]/layout.tsx
git commit -m "feat: add shared frontend components, hooks, and new tab navigation"
```

---

## Task 9: Frontend — Logs Tab

**Files:**
- Create: `frontend/src/hooks/use-logs.ts`
- Create: `frontend/src/app/projects/[id]/logs/page.tsx`

- [ ] **Step 1: Create use-logs hook**

Create `frontend/src/hooks/use-logs.ts`:

```typescript
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { connectSocket } from '@/lib/socket';

export function useHistoricalLogs(
  projectId: string,
  options?: { type?: string; search?: string; lines?: number },
) {
  return useQuery({
    queryKey: ['logs', projectId, options],
    queryFn: () => {
      const params = new URLSearchParams();
      if (options?.type) params.set('type', options.type);
      if (options?.search) params.set('search', options.search);
      if (options?.lines) params.set('lines', options.lines.toString());
      return api(`/projects/${projectId}/logs?${params}`);
    },
  });
}

export function useLiveLogs(projectId: string) {
  const [logs, setLogs] = useState<Array<{ type: string; line: string }>>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const bufferRef = useRef<Array<{ type: string; line: string }>>([]);

  const clear = useCallback(() => {
    setLogs([]);
    bufferRef.current = [];
  }, []);

  useEffect(() => {
    const socket = connectSocket();

    socket.emit('join-logs', projectId);
    setConnected(true);

    const handler = (data: { type: string; line: string }) => {
      if (paused) {
        bufferRef.current.push(data);
      } else {
        setLogs((prev) => [...prev, data]);
      }
    };

    socket.on('log-line', handler);

    return () => {
      socket.off('log-line', handler);
      socket.emit('leave-logs', projectId);
      setConnected(false);
    };
  }, [projectId, paused]);

  const resume = useCallback(() => {
    setPaused(false);
    setLogs((prev) => [...prev, ...bufferRef.current]);
    bufferRef.current = [];
  }, []);

  return { logs, connected, paused, setPaused, resume, clear };
}
```

- [ ] **Step 2: Create Logs page**

Create `frontend/src/app/projects/[id]/logs/page.tsx`:

```typescript
'use client';

import { use, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLiveLogs, useHistoricalLogs } from '@/hooks/use-logs';

export default function LogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [logType, setLogType] = useState<'stdout' | 'stderr'>('stdout');
  const [search, setSearch] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const writtenRef = useRef(0);

  const { logs, paused, setPaused, resume, clear, connected } = useLiveLogs(id);
  const { data: historical } = useHistoricalLogs(id, { type: logType, lines: 200 });

  // Initialize terminal
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
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    writtenRef.current = 0;

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Write historical logs on load
  useEffect(() => {
    const term = termRef.current;
    if (!term || !historical?.lines) return;

    term.clear();
    writtenRef.current = 0;
    for (const line of historical.lines) {
      const colored = colorize(line);
      term.writeln(colored);
    }
  }, [historical]);

  // Write live logs incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const start = writtenRef.current;
    for (let i = start; i < logs.length; i++) {
      const { type, line } = logs[i];
      if (logType !== 'stdout' && logType !== type) continue;
      const prefix = type === 'stderr' ? '\x1b[31m[stderr]\x1b[0m ' : '';
      term.writeln(`${prefix}${colorize(line)}`);
    }
    writtenRef.current = logs.length;
  }, [logs, logType]);

  // Search
  useEffect(() => {
    if (search && searchAddonRef.current) {
      searchAddonRef.current.findNext(search);
    }
  }, [search]);

  const handleClear = () => {
    termRef.current?.clear();
    clear();
    writtenRef.current = 0;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={logType === 'stdout' ? 'default' : 'outline'}
            onClick={() => setLogType('stdout')}
          >
            stdout
          </Button>
          <Button
            size="sm"
            variant={logType === 'stderr' ? 'destructive' : 'outline'}
            onClick={() => setLogType('stderr')}
          >
            stderr
          </Button>
          <span className={`ml-2 h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
          <span className="text-xs text-muted-foreground">{connected ? 'Live' : 'Disconnected'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 h-8 text-sm"
          />
          <Button size="sm" variant="outline" onClick={handleClear}>Clear</Button>
          <Button
            size="sm"
            variant={paused ? 'default' : 'destructive'}
            onClick={() => paused ? resume() : setPaused(true)}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div ref={containerRef} style={{ height: 600, backgroundColor: '#0a0a0a' }} />
      </div>
    </div>
  );
}

function colorize(line: string): string {
  if (line.includes('[ERROR]') || line.includes('Error') || line.includes('error:')) {
    return `\x1b[31m${line}\x1b[0m`;
  }
  if (line.includes('[WARN]') || line.includes('warn')) {
    return `\x1b[33m${line}\x1b[0m`;
  }
  return line;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-logs.ts frontend/src/app/projects/\[id\]/logs/
git commit -m "feat: add Logs tab with real-time PM2 log streaming via Socket.IO"
```

---

## Task 10: Frontend — Database Tab

**Files:**
- Create: `frontend/src/hooks/use-database.ts`
- Create: `frontend/src/components/sql-query-panel.tsx`
- Create: `frontend/src/app/projects/[id]/database/page.tsx`

- [ ] **Step 1: Create use-database hook**

Create `frontend/src/hooks/use-database.ts`:

```typescript
'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDatabaseTables(projectId: string) {
  return useQuery({
    queryKey: ['db-tables', projectId],
    queryFn: () => api(`/projects/${projectId}/database/tables`),
  });
}

export function useTableData(projectId: string, table: string, options?: { page?: number; pageSize?: number; sort?: string; order?: string }) {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', options.page.toString());
  if (options?.pageSize) params.set('pageSize', options.pageSize.toString());
  if (options?.sort) params.set('sort', options.sort);
  if (options?.order) params.set('order', options.order);

  return useQuery({
    queryKey: ['db-table-data', projectId, table, options],
    queryFn: () => api(`/projects/${projectId}/database/tables/${table}?${params}`),
    enabled: !!table,
  });
}

export function useTableStructure(projectId: string, table: string) {
  return useQuery({
    queryKey: ['db-table-structure', projectId, table],
    queryFn: () => api(`/projects/${projectId}/database/tables/${table}/structure`),
    enabled: !!table,
  });
}

export function useExecuteQuery(projectId: string) {
  return useMutation({
    mutationFn: (sql: string) =>
      api(`/projects/${projectId}/database/query`, { method: 'POST', body: JSON.stringify({ sql }) }),
  });
}
```

- [ ] **Step 2: Create SqlQueryPanel component**

Create `frontend/src/components/sql-query-panel.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useExecuteQuery } from '@/hooks/use-database';

interface SqlQueryPanelProps {
  projectId: string;
}

export function SqlQueryPanel({ projectId }: SqlQueryPanelProps) {
  const [sql, setSql] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const { mutate, data, isPending, error } = useExecuteQuery(projectId);

  const handleExecute = () => {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('DELETE') || trimmed.startsWith('UPDATE')) {
      setShowConfirm(true);
    } else {
      mutate(sql);
    }
  };

  return (
    <div>
      <div className="mb-3">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM users LIMIT 10;"
          className="w-full h-32 p-3 font-mono text-sm border rounded-md bg-background resize-y"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleExecute();
          }}
        />
      </div>
      <div className="flex items-center gap-2 mb-4">
        <Button size="sm" onClick={handleExecute} disabled={isPending || !sql.trim()}>
          {isPending ? 'Executing...' : 'Run Query'} <span className="text-xs text-muted-foreground ml-1">(⌘+Enter)</span>
        </Button>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.command} — {data.rowCount} row(s) affected
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 mb-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-600 dark:text-red-400">
          {(error as Error).message}
        </div>
      )}

      {data?.rows?.length > 0 && (
        <div className="border rounded-md overflow-auto max-h-96">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                {data.columns.map((col: string) => (
                  <th key={col} className="px-3 py-2 text-left font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row: any, i: number) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  {data.columns.map((col: string) => (
                    <td key={col} className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                      {row[col] === null ? <span className="text-muted-foreground italic">NULL</span> : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Execute destructive query?"
        description={`You are about to run: ${sql.slice(0, 100)}...`}
        onConfirm={() => mutate(sql)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create Database page**

Create `frontend/src/app/projects/[id]/database/page.tsx`:

```typescript
'use client';

import { use, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDatabaseTables, useTableData, useTableStructure } from '@/hooks/use-database';
import { SqlQueryPanel } from '@/components/sql-query-panel';

type SubView = 'data' | 'structure' | 'query';

export default function DatabasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedTable, setSelectedTable] = useState('');
  const [subView, setSubView] = useState<SubView>('data');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ column: string; order: 'asc' | 'desc' } | null>(null);

  const { data: tables, isLoading: tablesLoading } = useDatabaseTables(id);
  const { data: tableData, isLoading: dataLoading } = useTableData(id, selectedTable, {
    page,
    pageSize: 50,
    sort: sort?.column,
    order: sort?.order,
  });
  const { data: structure } = useTableStructure(id, selectedTable);

  const handleSort = (column: string) => {
    setSort((prev) =>
      prev?.column === column
        ? { column, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { column, order: 'asc' },
    );
    setPage(1);
  };

  if (tablesLoading) return <div className="text-sm text-muted-foreground">Loading tables...</div>;
  if (!tables?.length) return <div className="text-sm text-muted-foreground">No PostgreSQL connection configured. Add one in Settings → Services.</div>;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)' }}>
      {/* Sidebar */}
      <div className="w-48 shrink-0 border rounded-md">
        <div className="p-3 border-b text-xs font-medium text-muted-foreground uppercase">Tables</div>
        <ScrollArea className="h-full">
          {tables.map((t: any) => (
            <button
              key={t.table_name}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selectedTable === t.table_name ? 'bg-muted font-medium' : ''}`}
              onClick={() => { setSelectedTable(t.table_name); setPage(1); setSort(null); }}
            >
              {t.table_name}
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {!selectedTable ? (
          <div className="text-sm text-muted-foreground">Select a table to view its data.</div>
        ) : (
          <>
            <div className="flex gap-1 mb-4">
              {(['data', 'structure', 'query'] as SubView[]).map((v) => (
                <Button key={v} size="sm" variant={subView === v ? 'default' : 'outline'} onClick={() => setSubView(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </Button>
              ))}
            </div>

            {subView === 'data' && tableData && (
              <>
                <div className="border rounded-md overflow-auto max-h-[calc(100vh-340px)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b sticky top-0">
                        {tableData.columns.map((col: string) => (
                          <th
                            key={col}
                            className="px-3 py-2 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-muted"
                            onClick={() => handleSort(col)}
                          >
                            {col} {sort?.column === col ? (sort.order === 'asc' ? '↑' : '↓') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row: any, i: number) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          {tableData.columns.map((col: string) => (
                            <td key={col} className="px-3 py-2 whitespace-nowrap font-mono text-xs max-w-xs truncate">
                              {row[col] === null ? <span className="text-muted-foreground italic">NULL</span> : String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                  <span>{tableData.total} rows total</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</Button>
                    <span>{page} / {tableData.totalPages}</span>
                    <Button size="sm" variant="outline" disabled={page >= tableData.totalPages} onClick={() => setPage(page + 1)}>→</Button>
                  </div>
                </div>
              </>
            )}

            {subView === 'structure' && structure && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Columns</h3>
                  <div className="border rounded-md overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="px-3 py-2 text-left font-medium">Column</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-left font-medium">Nullable</th>
                          <th className="px-3 py-2 text-left font-medium">Default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {structure.columns.map((col: any) => (
                          <tr key={col.column_name} className="border-b last:border-0">
                            <td className="px-3 py-2 font-mono text-xs">{col.column_name}</td>
                            <td className="px-3 py-2 font-mono text-xs">{col.data_type}{col.character_maximum_length ? `(${col.character_maximum_length})` : ''}</td>
                            <td className="px-3 py-2 text-xs">{col.is_nullable}</td>
                            <td className="px-3 py-2 font-mono text-xs truncate max-w-xs">{col.column_default || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {structure.indexes.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">Indexes</h3>
                    <div className="border rounded-md overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="px-3 py-2 text-left font-medium">Name</th>
                            <th className="px-3 py-2 text-left font-medium">Definition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structure.indexes.map((idx: any) => (
                            <tr key={idx.indexname} className="border-b last:border-0">
                              <td className="px-3 py-2 font-mono text-xs">{idx.indexname}</td>
                              <td className="px-3 py-2 font-mono text-xs">{idx.indexdef}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {subView === 'query' && <SqlQueryPanel projectId={id} />}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/use-database.ts frontend/src/components/sql-query-panel.tsx frontend/src/app/projects/\[id\]/database/
git commit -m "feat: add Database tab with table browser, structure viewer, and SQL query panel"
```

---

## Task 11: Frontend — Redis Tab

**Files:**
- Create: `frontend/src/hooks/use-redis.ts`
- Create: `frontend/src/components/redis-cli-panel.tsx`
- Create: `frontend/src/app/projects/[id]/redis/page.tsx`

- [ ] **Step 1: Create use-redis hook**

Create `frontend/src/hooks/use-redis.ts`:

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useRedisKeys(projectId: string, pattern: string = '*', cursor: string = '0') {
  return useQuery({
    queryKey: ['redis-keys', projectId, pattern, cursor],
    queryFn: () => {
      const params = new URLSearchParams({ pattern, cursor, count: '50' });
      return api(`/projects/${projectId}/redis/keys?${params}`);
    },
  });
}

export function useRedisKeyDetail(projectId: string, key: string) {
  return useQuery({
    queryKey: ['redis-key', projectId, key],
    queryFn: () => api(`/projects/${projectId}/redis/keys/detail?key=${encodeURIComponent(key)}`),
    enabled: !!key,
  });
}

export function useCreateRedisKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { key: string; type: string; value: any; ttl?: number }) =>
      api(`/projects/${projectId}/redis/keys`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['redis-keys', projectId] }),
  });
}

export function useUpdateRedisKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value, ttl }: { key: string; value: any; ttl?: number }) =>
      api(`/projects/${projectId}/redis/keys/update?key=${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value, ttl }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['redis-key', projectId] }),
  });
}

export function useDeleteRedisKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      api(`/projects/${projectId}/redis/keys/delete?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['redis-keys', projectId] }),
  });
}

export function useRedisCommand(projectId: string) {
  return useMutation({
    mutationFn: (command: string) =>
      api(`/projects/${projectId}/redis/command`, { method: 'POST', body: JSON.stringify({ command }) }),
  });
}
```

- [ ] **Step 2: Create RedisCliPanel component**

Create `frontend/src/components/redis-cli-panel.tsx`:

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { useRedisCommand } from '@/hooks/use-redis';

interface RedisCliPanelProps {
  projectId: string;
}

export function RedisCliPanel({ projectId }: RedisCliPanelProps) {
  const [history, setHistory] = useState<Array<{ command: string; result: string; error?: boolean }>>([]);
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { mutateAsync } = useRedisCommand(projectId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    const command = input.trim();
    setCmdHistory((prev) => [command, ...prev]);
    setHistoryIndex(-1);
    setInput('');

    try {
      const data = await mutateAsync(command);
      setHistory((prev) => [...prev, {
        command,
        result: typeof data.result === 'object' ? JSON.stringify(data.result, null, 2) : String(data.result ?? '(nil)'),
      }]);
    } catch (err: any) {
      setHistory((prev) => [...prev, { command, result: err.message, error: true }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < cmdHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(cmdHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(cmdHistory[newIndex]);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  return (
    <div className="border rounded-md bg-[#0a0a0a] text-[#e5e5e5] font-mono text-sm h-80 flex flex-col">
      <div className="flex-1 overflow-auto p-3">
        {history.map((entry, i) => (
          <div key={i} className="mb-2">
            <div className="text-cyan-400">{'>'} {entry.command}</div>
            <div className={entry.error ? 'text-red-400' : 'text-gray-300 whitespace-pre-wrap'}>{entry.result}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-gray-700 p-2 flex items-center gap-2">
        <span className="text-cyan-400">{'>'}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter Redis command..."
          className="flex-1 bg-transparent outline-none text-sm"
          autoFocus
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create Redis page**

Create `frontend/src/app/projects/[id]/redis/page.tsx`:

```typescript
'use client';

import { use, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RedisCliPanel } from '@/components/redis-cli-panel';
import { useRedisKeys, useRedisKeyDetail, useDeleteRedisKey } from '@/hooks/use-redis';

export default function RedisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pattern, setPattern] = useState('*');
  const [selectedKey, setSelectedKey] = useState('');
  const [showCli, setShowCli] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: keysData, isLoading } = useRedisKeys(id, pattern);
  const { data: keyDetail } = useRedisKeyDetail(id, selectedKey);
  const deleteMutation = useDeleteRedisKey(id);

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, {
      onSuccess: () => {
        if (selectedKey === deleteTarget) setSelectedKey('');
        setDeleteTarget(null);
      },
    });
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const typeColors: Record<string, string> = {
    string: 'text-green-600',
    hash: 'text-blue-600',
    list: 'text-orange-600',
    set: 'text-purple-600',
    zset: 'text-pink-600',
  };

  return (
    <div>
      {showCli && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Redis CLI</h3>
            <Button size="sm" variant="outline" onClick={() => setShowCli(false)}>Close</Button>
          </div>
          <RedisCliPanel projectId={id} />
        </div>
      )}

      <div className="flex gap-4" style={{ height: showCli ? 'calc(100vh - 600px)' : 'calc(100vh - 220px)' }}>
        {/* Key list */}
        <div className="w-64 shrink-0 border rounded-md flex flex-col">
          <div className="p-3 border-b space-y-2">
            <Input
              placeholder="Filter pattern (e.g. user:*)"
              value={pattern}
              onChange={(e) => setPattern(e.target.value || '*')}
              className="h-8 text-sm"
            />
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowCli(true)}>CLI</Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {keysData?.keys?.map((item: any) => (
              <button
                key={item.key}
                className={`w-full text-left px-3 py-2 text-sm flex justify-between hover:bg-muted/50 ${selectedKey === item.key ? 'bg-muted font-medium' : ''}`}
                onClick={() => setSelectedKey(item.key)}
              >
                <span className="truncate">{item.key}</span>
                <span className={`text-xs shrink-0 ml-2 ${typeColors[item.type] || 'text-muted-foreground'}`}>{item.type}</span>
              </button>
            ))}
            {keysData?.keys?.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No keys found</div>
            )}
          </ScrollArea>
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0">
          {!selectedKey ? (
            <div className="text-sm text-muted-foreground">Select a key to view its value.</div>
          ) : keyDetail ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-medium font-mono">{keyDetail.key}</h3>
                  <p className="text-xs text-muted-foreground">
                    Type: {keyDetail.type} | TTL: {keyDetail.ttl === -1 ? 'No expiry' : `${keyDetail.ttl}s`} | Size: {keyDetail.size}
                  </p>
                </div>
                <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(selectedKey)}>Delete</Button>
              </div>
              <div className="border rounded-md bg-[#0a0a0a] text-[#e5e5e5] p-4 font-mono text-sm overflow-auto max-h-[calc(100vh-360px)]">
                <pre className="whitespace-pre-wrap">
                  {typeof keyDetail.value === 'object'
                    ? JSON.stringify(keyDetail.value, null, 2)
                    : String(keyDetail.value)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Redis Key?"
        description={`This will permanently delete the key "${deleteTarget}".`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/use-redis.ts frontend/src/components/redis-cli-panel.tsx frontend/src/app/projects/\[id\]/redis/
git commit -m "feat: add Redis tab with key browser, detail viewer, CLI, and CRUD operations"
```

---

## Task 12: Frontend — Storage Tab

**Files:**
- Create: `frontend/src/hooks/use-storage.ts`
- Create: `frontend/src/app/projects/[id]/storage/page.tsx`

- [ ] **Step 1: Create use-storage hook**

Create `frontend/src/hooks/use-storage.ts`:

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiRaw } from '@/lib/api';
import { getAccessToken } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export function useStorageBuckets(projectId: string) {
  return useQuery({
    queryKey: ['storage-buckets', projectId],
    queryFn: () => api(`/projects/${projectId}/storage/buckets`),
  });
}

export function useStorageObjects(projectId: string, bucket: string, prefix: string = '') {
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  params.set('delimiter', '/');

  return useQuery({
    queryKey: ['storage-objects', projectId, bucket, prefix],
    queryFn: () => api(`/projects/${projectId}/storage/buckets/${bucket}?${params}`),
    enabled: !!bucket,
  });
}

export function useUploadFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket, prefix, file }: { bucket: string; prefix: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      return apiRaw(`/projects/${projectId}/storage/buckets/${bucket}/upload${params}`, {
        method: 'POST',
        body: formData,
      }).then((res) => res.json());
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['storage-objects', projectId, vars.bucket] }),
  });
}

export function useDeleteFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      api(`/projects/${projectId}/storage/buckets/${bucket}/objects?key=${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['storage-objects', projectId, vars.bucket] }),
  });
}

export function getDownloadUrl(projectId: string, bucket: string, key: string) {
  return `${API_URL}/projects/${projectId}/storage/buckets/${bucket}/download?key=${encodeURIComponent(key)}`;
}
```

- [ ] **Step 2: Create Storage page**

Create `frontend/src/app/projects/[id]/storage/page.tsx`:

```typescript
'use client';

import { use, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useStorageBuckets, useStorageObjects, useUploadFile, useDeleteFile, getDownloadUrl } from '@/hooks/use-storage';
import { getAccessToken } from '@/lib/api';

export default function StoragePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedBucket, setSelectedBucket] = useState('');
  const [prefix, setPrefix] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ bucket: string; key: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: buckets, isLoading } = useStorageBuckets(id);
  const { data: objects } = useStorageObjects(id, selectedBucket, prefix);
  const uploadMutation = useUploadFile(id);
  const deleteMutation = useDeleteFile(id);

  const breadcrumbs = prefix ? prefix.split('/').filter(Boolean) : [];

  const handleBucketSelect = (name: string) => {
    setSelectedBucket(name);
    setPrefix('');
  };

  const handleFolderClick = (folderPrefix: string) => {
    setPrefix(folderPrefix);
  };

  const handleBreadcrumb = (index: number) => {
    if (index < 0) {
      setPrefix('');
    } else {
      setPrefix(breadcrumbs.slice(0, index + 1).join('/') + '/');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBucket) return;
    await uploadMutation.mutateAsync({ bucket: selectedBucket, prefix, file });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (key: string) => {
    const url = getDownloadUrl(id, selectedBucket, key);
    const token = getAccessToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = key.split('/').pop() || 'download';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!buckets?.length) return <div className="text-sm text-muted-foreground">No MinIO connection configured. Add one in Settings → Services.</div>;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)' }}>
      {/* Bucket list */}
      <div className="w-48 shrink-0 border rounded-md">
        <div className="p-3 border-b text-xs font-medium text-muted-foreground uppercase">Buckets</div>
        <ScrollArea className="h-full">
          {buckets.map((b: any) => (
            <button
              key={b.name}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selectedBucket === b.name ? 'bg-muted font-medium' : ''}`}
              onClick={() => handleBucketSelect(b.name)}
            >
              {b.name}
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* File browser */}
      <div className="flex-1 min-w-0">
        {!selectedBucket ? (
          <div className="text-sm text-muted-foreground">Select a bucket to browse files.</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1 text-sm">
                <button className="text-muted-foreground hover:text-foreground" onClick={() => handleBreadcrumb(-1)}>
                  {selectedBucket}
                </button>
                {breadcrumbs.map((crumb, i) => (
                  <span key={i}>
                    <span className="text-muted-foreground mx-1">/</span>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => handleBreadcrumb(i)}>
                      {crumb}
                    </button>
                  </span>
                ))}
              </div>
              <div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                  {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </div>

            <div className="border rounded-md overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Size</th>
                    <th className="px-3 py-2 text-left font-medium">Modified</th>
                    <th className="px-3 py-2 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {objects?.prefixes?.map((p: string) => {
                    const name = p.replace(prefix, '').replace(/\/$/, '');
                    return (
                      <tr key={p} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => handleFolderClick(p)}>
                        <td className="px-3 py-2 font-medium">📁 {name}/</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2">—</td>
                      </tr>
                    );
                  })}
                  {objects?.objects?.map((obj: any) => {
                    const name = obj.name.replace(prefix, '');
                    return (
                      <tr key={obj.name} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">{name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{formatSize(obj.size)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(obj.lastModified).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button className="text-xs text-blue-600 hover:underline" onClick={() => handleDownload(obj.name)}>
                              Download
                            </button>
                            <button className="text-xs text-red-600 hover:underline" onClick={() => setDeleteTarget({ bucket: selectedBucket, key: obj.name })}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!objects?.prefixes?.length && !objects?.objects?.length && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Empty</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete File?"
        description={`This will permanently delete "${deleteTarget?.key}".`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-storage.ts frontend/src/app/projects/\[id\]/storage/
git commit -m "feat: add Storage tab with bucket browser, file upload/download/delete"
```

---

## Task 13: Final AppModule Registration & Verification

**Files:**
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Verify final AppModule**

Ensure `backend/src/app.module.ts` has all 5 new modules imported. The final imports should include:

```typescript
import { ServicesModule } from './services/services.module';
import { LogsModule } from './logs/logs.module';
import { DatabaseBrowserModule } from './database-browser/database-browser.module';
import { RedisBrowserModule } from './redis-browser/redis-browser.module';
import { StorageBrowserModule } from './storage-browser/storage-browser.module';
```

And the `imports` array should include all of them.

- [ ] **Step 2: Build backend to verify no compilation errors**

Run:
```bash
cd backend && npm run build
```

Expected: Compilation succeeds with no errors.

- [ ] **Step 3: Build frontend to verify no compilation errors**

Run:
```bash
cd frontend && npm run build
```

Expected: Build succeeds (or only has non-blocking warnings).

- [ ] **Step 4: Commit any fixes**

If any build issues were found, fix them and commit:

```bash
git add -A
git commit -m "fix: resolve build issues in runtime tools integration"
```
