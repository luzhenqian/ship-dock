# Storage Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MinIO/S3 storage data import supporting remote S3 connections, multi-file/ZIP upload, and URL import — following the same wizard pattern as the existing PostgreSQL migration feature.

**Architecture:** New `storage-import` NestJS module with controller, service, BullMQ processor, and WebSocket gateway (mirroring `data-migration` module). Frontend adds `StorageImportWizard` component and hooks. Prisma model tracks import jobs.

**Tech Stack:** NestJS, BullMQ, MinIO SDK, unzipper, Socket.io, React Query, Next.js

---

### File Map

**Backend — new files:**
- `backend/src/storage-import/storage-import.module.ts` — module registration
- `backend/src/storage-import/storage-import.controller.ts` — REST endpoints
- `backend/src/storage-import/storage-import.service.ts` — business logic, connection testing, URL validation, temp file management
- `backend/src/storage-import/storage-import.processor.ts` — BullMQ async import execution
- `backend/src/storage-import/storage-import.gateway.ts` — WebSocket progress events
- `backend/src/storage-import/dto/create-storage-import.dto.ts` — request validation

**Backend — modified files:**
- `backend/prisma/schema.prisma` — add StorageImport model + enums
- `backend/src/app.module.ts` — import StorageImportModule
- `backend/package.json` — add `unzipper` dependency

**Frontend — new files:**
- `frontend/src/components/storage-import-wizard.tsx` — wizard UI
- `frontend/src/hooks/use-storage-import.ts` — React Query hooks
- `frontend/src/hooks/use-storage-import-progress.ts` — WebSocket + polling

**Frontend — modified files:**
- `frontend/src/app/projects/[id]/storage/page.tsx` — add Import button, integrate wizard

---

### Task 1: Prisma Schema — StorageImport Model

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add enums and model to schema**

Add after the `DataMigrationTable` model (around line 314):

```prisma
enum StorageImportSource {
  REMOTE
  FILE
  URL
}

enum StorageImportConflict {
  OVERWRITE
  SKIP
  ERROR
}

enum StorageImportStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

model StorageImport {
  id               String                @id @default(uuid())
  projectId        String
  project          Project               @relation(fields: [projectId], references: [id], onDelete: Cascade)
  source           StorageImportSource
  targetBucket     String
  targetPrefix     String                @default("")
  conflictStrategy StorageImportConflict
  status           StorageImportStatus   @default(PENDING)
  totalFiles       Int                   @default(0)
  completedFiles   Int                   @default(0)
  skippedFiles     Int                   @default(0)
  totalSize        BigInt                @default(0)
  error            String?
  metadata         Json?
  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt
}
```

- [ ] **Step 2: Add relation to Project model**

Add to the Project model relations (around line 130, after `importItems`):

```prisma
  storageImports        StorageImport[]
```

- [ ] **Step 3: Generate migration and client**

Run:
```bash
cd backend && npx prisma migrate dev --name add-storage-import
```

Expected: Migration created, Prisma Client regenerated.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add StorageImport prisma model and migration"
```

---

### Task 2: Backend — Install Dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install unzipper**

```bash
cd backend && npm install unzipper && npm install -D @types/unzipper
```

- [ ] **Step 2: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat: add unzipper dependency for storage import"
```

---

### Task 3: Backend — DTOs

**Files:**
- Create: `backend/src/storage-import/dto/create-storage-import.dto.ts`

- [ ] **Step 1: Create DTO file**

```typescript
import { IsString, IsEnum, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class RemoteConnectionDto {
  @IsString() endpoint: string;
  @IsNumber() @Min(1) @Max(65535) port: number;
  @IsString() accessKey: string;
  @IsString() secretKey: string;
  @IsBoolean() @IsOptional() useSSL?: boolean;
}

export class TestStorageConnectionDto {
  @ValidateNested() @Type(() => RemoteConnectionDto)
  connection: RemoteConnectionDto;
}

export class DiscoverStorageObjectsDto {
  @ValidateNested() @Type(() => RemoteConnectionDto)
  connection: RemoteConnectionDto;

  @IsString() bucket: string;
  @IsString() @IsOptional() prefix?: string;
}

export class ValidateUrlsDto {
  @IsArray() @IsString({ each: true })
  urls: string[];
}

export class CreateStorageImportDto {
  @IsEnum(['REMOTE', 'FILE', 'URL'])
  source: 'REMOTE' | 'FILE' | 'URL';

  @IsString() targetBucket: string;
  @IsString() @IsOptional() targetPrefix?: string;

  @IsEnum(['OVERWRITE', 'SKIP', 'ERROR'])
  conflictStrategy: 'OVERWRITE' | 'SKIP' | 'ERROR';

  // REMOTE source
  @ValidateNested() @Type(() => RemoteConnectionDto) @IsOptional()
  connection?: RemoteConnectionDto;

  @IsString() @IsOptional() sourceBucket?: string;
  @IsArray() @IsString({ each: true }) @IsOptional()
  objectKeys?: string[];

  // FILE source
  @IsArray() @IsString({ each: true }) @IsOptional()
  fileKeys?: string[];

  // URL source
  @IsArray() @IsString({ each: true }) @IsOptional()
  urls?: string[];

  @IsNumber() @IsOptional() totalFiles?: number;
  @IsNumber() @IsOptional() totalSize?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/storage-import/
git commit -m "feat: add storage import DTOs"
```

---

### Task 4: Backend — WebSocket Gateway

**Files:**
- Create: `backend/src/storage-import/storage-import.gateway.ts`

- [ ] **Step 1: Create gateway**

```typescript
import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class StorageImportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private jwt: JwtService, private config: ConfigService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) { client.disconnect(); return; }
      await this.jwt.verifyAsync(token, { secret: this.config.getOrThrow('JWT_SECRET') });
    } catch { client.disconnect(); }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join-storage-import')
  handleJoin(client: Socket, importId: string) { client.join(`storage-import:${importId}`); }

  @SubscribeMessage('leave-storage-import')
  handleLeave(client: Socket, importId: string) { client.leave(`storage-import:${importId}`); }

  emit(importId: string, event: string, data: any) {
    if (this.server) this.server.to(`storage-import:${importId}`).emit(event, data);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/storage-import/storage-import.gateway.ts
git commit -m "feat: add storage import WebSocket gateway"
```

---

### Task 5: Backend — Service

**Files:**
- Create: `backend/src/storage-import/storage-import.service.ts`

- [ ] **Step 1: Create service**

```typescript
import { BadRequestException, Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';
import { CreateStorageImportDto, RemoteConnectionDto, ValidateUrlsDto } from './dto/create-storage-import.dto';
import { Client as MinioClient } from 'minio';
import { readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class StorageImportService implements OnModuleInit {
  private readonly logger = new Logger(StorageImportService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('storage-import') private importQueue: Queue,
    private config: ConfigService,
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
  ) {}

  onModuleInit() {
    setInterval(() => this.cleanupTempFiles(), CLEANUP_INTERVAL_MS);
  }

  private cleanupTempFiles() {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    try {
      const files = readdirSync(tempDir);
      const now = Date.now();
      let cleaned = 0;
      for (const file of files) {
        if (!file.startsWith('storage-import-')) continue;
        const filePath = join(tempDir, file);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE_MS) { unlinkSync(filePath); cleaned++; }
        } catch {}
      }
      if (cleaned > 0) this.logger.log(`Cleaned up ${cleaned} stale storage import temp file(s)`);
    } catch {}
  }

  async testConnection(dto: RemoteConnectionDto) {
    const client = new MinioClient({
      endPoint: dto.endpoint,
      port: dto.port,
      accessKey: dto.accessKey,
      secretKey: dto.secretKey,
      useSSL: dto.useSSL ?? false,
    });
    try {
      const buckets = await client.listBuckets();
      return { success: true, buckets: buckets.map((b) => ({ name: b.name, creationDate: b.creationDate })) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async discoverObjects(dto: RemoteConnectionDto & { bucket: string; prefix?: string }) {
    const client = new MinioClient({
      endPoint: dto.endpoint,
      port: dto.port,
      accessKey: dto.accessKey,
      secretKey: dto.secretKey,
      useSSL: dto.useSSL ?? false,
    });

    return new Promise<{ objects: any[]; prefixes: string[] }>((resolve, reject) => {
      const objects: any[] = [];
      const prefixes: string[] = [];
      const stream = client.listObjectsV2(dto.bucket, dto.prefix || '', false, '/');

      stream.on('data', (obj: any) => {
        if (obj.prefix) {
          prefixes.push(obj.prefix);
        } else {
          objects.push({ name: obj.name, size: obj.size, lastModified: obj.lastModified });
        }
      });
      stream.on('end', () => resolve({ objects, prefixes }));
      stream.on('error', reject);
    });
  }

  async validateUrls(dto: ValidateUrlsDto) {
    const results = await Promise.all(
      dto.urls.map(async (url) => {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { url, valid: false, error: 'Only HTTP/HTTPS URLs are supported' };
          }
          const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
          if (!res.ok) return { url, valid: false, error: `HTTP ${res.status}` };
          const size = parseInt(res.headers.get('content-length') || '0', 10);
          const disposition = res.headers.get('content-disposition');
          let fileName = parsed.pathname.split('/').pop() || 'download';
          if (disposition) {
            const match = disposition.match(/filename="?([^";\n]+)"?/);
            if (match) fileName = match[1];
          }
          return { url, valid: true, fileName, size };
        } catch (err: any) {
          return { url, valid: false, error: err.message };
        }
      }),
    );
    return { results };
  }

  async createImport(projectId: string, dto: CreateStorageImportDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const active = await this.prisma.storageImport.findFirst({
      where: { projectId, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (active) throw new BadRequestException('A storage import is already in progress for this project');

    const storageImport = await this.prisma.storageImport.create({
      data: {
        projectId,
        source: dto.source,
        targetBucket: dto.targetBucket,
        targetPrefix: dto.targetPrefix || '',
        conflictStrategy: dto.conflictStrategy,
        totalFiles: dto.totalFiles || 0,
        totalSize: dto.totalSize || 0,
        metadata: {
          connection: dto.source === 'REMOTE' ? dto.connection : undefined,
          sourceBucket: dto.source === 'REMOTE' ? dto.sourceBucket : undefined,
          objectKeys: dto.source === 'REMOTE' ? dto.objectKeys : undefined,
          fileKeys: dto.source === 'FILE' ? dto.fileKeys : undefined,
          urls: dto.source === 'URL' ? dto.urls : undefined,
        },
      },
    });

    await this.importQueue.add('storage-import', {
      importId: storageImport.id,
      projectId,
    });

    return storageImport;
  }

  async getImport(importId: string) {
    const imp = await this.prisma.storageImport.findUnique({ where: { id: importId } });
    if (!imp) throw new NotFoundException('Import not found');
    return imp;
  }

  async cancelImport(importId: string) {
    const imp = await this.prisma.storageImport.findUnique({ where: { id: importId } });
    if (!imp) throw new NotFoundException('Import not found');
    if (!['PENDING', 'RUNNING'].includes(imp.status)) {
      throw new BadRequestException('Can only cancel active imports');
    }
    return this.prisma.storageImport.update({
      where: { id: importId },
      data: { status: 'CANCELLED' },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/storage-import/storage-import.service.ts
git commit -m "feat: add storage import service"
```

---

### Task 6: Backend — Processor

**Files:**
- Create: `backend/src/storage-import/storage-import.processor.ts`

- [ ] **Step 1: Create processor**

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';
import { StorageImportGateway } from './storage-import.gateway';
import { Client as MinioClient } from 'minio';
import { createReadStream, unlinkSync } from 'fs';
import { join } from 'path';
import * as unzipper from 'unzipper';
import { Readable } from 'stream';

@Processor('storage-import')
export class StorageImportProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
    private gateway: StorageImportGateway,
  ) {
    super();
  }

  async process(job: Job<{ importId: string; projectId: string }>) {
    const { importId, projectId } = job.data;

    const imp = await this.prisma.storageImport.findUnique({ where: { id: importId } });
    if (!imp || imp.status === 'CANCELLED') return;

    await this.updateStatus(importId, 'RUNNING');

    try {
      const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'MINIO');
      const targetClient = this.pool.getMinioClient(service.id, config);
      const meta = imp.metadata as any;

      if (imp.source === 'REMOTE') {
        await this.processRemote(importId, imp, targetClient, meta);
      } else if (imp.source === 'FILE') {
        await this.processFile(importId, imp, targetClient, meta);
      } else if (imp.source === 'URL') {
        await this.processUrl(importId, imp, targetClient, meta);
      }
    } catch (err: any) {
      await this.updateStatus(importId, 'FAILED', err.message);
      this.log(importId, 'error', `Import failed: ${err.message}`);
    }
  }

  private async processRemote(importId: string, imp: any, targetClient: MinioClient, meta: any) {
    const sourceClient = new MinioClient({
      endPoint: meta.connection.endpoint,
      port: meta.connection.port,
      accessKey: meta.connection.accessKey,
      secretKey: meta.connection.secretKey,
      useSSL: meta.connection.useSSL ?? false,
    });

    // Resolve all object keys (expand prefixes)
    const allKeys: string[] = [];
    for (const key of meta.objectKeys || []) {
      if (key.endsWith('/')) {
        // It's a prefix — list all objects under it recursively
        const objects = await this.listAllObjects(sourceClient, meta.sourceBucket, key);
        allKeys.push(...objects.map((o) => o.name));
      } else {
        allKeys.push(key);
      }
    }

    await this.prisma.storageImport.update({ where: { id: importId }, data: { totalFiles: allKeys.length } });
    this.log(importId, 'info', `Found ${allKeys.length} objects to import from remote`);

    let completed = 0;
    let skipped = 0;

    for (const key of allKeys) {
      const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
      if (current?.status === 'CANCELLED') { this.log(importId, 'info', 'Import cancelled'); return; }

      const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${key}` : key;

      // Check conflict
      const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
      if (exists) {
        if (imp.conflictStrategy === 'SKIP') {
          skipped++;
          this.log(importId, 'info', `Skipped (exists): ${targetKey}`);
          this.emitProgress(importId, ++completed, allKeys.length, targetKey, skipped);
          continue;
        } else if (imp.conflictStrategy === 'ERROR') {
          throw new Error(`Object already exists: ${targetKey}`);
        }
        // OVERWRITE: continue to putObject
      }

      const stream = await sourceClient.getObject(meta.sourceBucket, key);
      await targetClient.putObject(imp.targetBucket, targetKey, stream);
      this.emitProgress(importId, ++completed, allKeys.length, targetKey, skipped);
    }

    await this.prisma.storageImport.update({
      where: { id: importId },
      data: { completedFiles: completed, skippedFiles: skipped },
    });
    this.log(importId, 'info', `Import complete: ${completed - skipped} imported, ${skipped} skipped`);
    await this.updateStatus(importId, 'COMPLETED');
  }

  private async processFile(importId: string, imp: any, targetClient: MinioClient, meta: any) {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const fileKeys: string[] = meta.fileKeys || [];
    let totalUploaded = 0;
    let skipped = 0;
    let fileIndex = 0;

    for (const fileKey of fileKeys) {
      const filePath = join(tempDir, fileKey);
      const isZip = fileKey.endsWith('.zip');
      const isTarGz = fileKey.endsWith('.tar.gz') || fileKey.endsWith('.tgz');

      if (isZip) {
        this.log(importId, 'info', `Extracting ZIP: ${fileKey}`);
        const directory = await unzipper.Open.file(filePath);
        const entries = directory.files.filter((f) => f.type === 'File');

        await this.prisma.storageImport.update({
          where: { id: importId },
          data: { totalFiles: { increment: entries.length - 1 } }, // -1 because the zip itself was counted
        });

        for (const entry of entries) {
          const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
          if (current?.status === 'CANCELLED') return;

          const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${entry.path}` : entry.path;

          const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
          if (exists) {
            if (imp.conflictStrategy === 'SKIP') {
              skipped++;
              this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped);
              continue;
            } else if (imp.conflictStrategy === 'ERROR') {
              throw new Error(`Object already exists: ${targetKey}`);
            }
          }

          const stream = entry.stream();
          await targetClient.putObject(imp.targetBucket, targetKey, stream);
          this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped);
        }
      } else if (isTarGz) {
        this.log(importId, 'info', `Extracting TAR.GZ: ${fileKey}`);
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Extract to temp dir then upload
        const extractDir = join(tempDir, `storage-import-extract-${Date.now()}`);
        await execAsync(`mkdir -p "${extractDir}" && tar -xzf "${filePath}" -C "${extractDir}"`);

        const walkDir = (dir: string, base: string = ''): string[] => {
          const { readdirSync, statSync } = require('fs');
          const results: string[] = [];
          for (const entry of readdirSync(dir)) {
            const fullPath = join(dir, entry);
            const relPath = base ? `${base}/${entry}` : entry;
            if (statSync(fullPath).isDirectory()) {
              results.push(...walkDir(fullPath, relPath));
            } else {
              results.push(relPath);
            }
          }
          return results;
        };

        const extractedFiles = walkDir(extractDir);
        await this.prisma.storageImport.update({
          where: { id: importId },
          data: { totalFiles: { increment: extractedFiles.length - 1 } },
        });

        for (const relPath of extractedFiles) {
          const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
          if (current?.status === 'CANCELLED') return;

          const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${relPath}` : relPath;

          const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
          if (exists) {
            if (imp.conflictStrategy === 'SKIP') { skipped++; this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped); continue; }
            else if (imp.conflictStrategy === 'ERROR') throw new Error(`Object already exists: ${targetKey}`);
          }

          const fileStream = createReadStream(join(extractDir, relPath));
          await targetClient.putObject(imp.targetBucket, targetKey, fileStream);
          this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped);
        }

        // Clean up extract dir
        await execAsync(`rm -rf "${extractDir}"`);
      } else {
        // Regular file
        const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
        if (current?.status === 'CANCELLED') return;

        // Derive original filename from fileKey: storage-import-<hex>-<originalname>
        const originalName = fileKey.replace(/^storage-import-[a-f0-9]+-/, '');
        const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${originalName}` : originalName;

        const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
        if (exists) {
          if (imp.conflictStrategy === 'SKIP') { skipped++; this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped); continue; }
          else if (imp.conflictStrategy === 'ERROR') throw new Error(`Object already exists: ${targetKey}`);
        }

        const fileStream = createReadStream(filePath);
        await targetClient.putObject(imp.targetBucket, targetKey, fileStream);
        this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped);
      }

      // Clean up temp file
      try { unlinkSync(filePath); } catch {}
      fileIndex++;
    }

    await this.prisma.storageImport.update({
      where: { id: importId },
      data: { completedFiles: totalUploaded, skippedFiles: skipped },
    });
    this.log(importId, 'info', `File import complete: ${totalUploaded - skipped} imported, ${skipped} skipped`);
    await this.updateStatus(importId, 'COMPLETED');
  }

  private async processUrl(importId: string, imp: any, targetClient: MinioClient, meta: any) {
    const urls: string[] = meta.urls || [];
    let completed = 0;
    let skipped = 0;

    this.log(importId, 'info', `Downloading ${urls.length} URLs`);

    for (const url of urls) {
      const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
      if (current?.status === 'CANCELLED') { this.log(importId, 'info', 'Import cancelled'); return; }

      try {
        const parsed = new URL(url);
        let fileName = parsed.pathname.split('/').pop() || 'download';

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const disposition = res.headers.get('content-disposition');
        if (disposition) {
          const match = disposition.match(/filename="?([^";\n]+)"?/);
          if (match) fileName = match[1];
        }

        const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${fileName}` : fileName;

        const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
        if (exists) {
          if (imp.conflictStrategy === 'SKIP') {
            skipped++;
            this.log(importId, 'info', `Skipped (exists): ${targetKey}`);
            this.emitProgress(importId, ++completed, urls.length, targetKey, skipped);
            continue;
          } else if (imp.conflictStrategy === 'ERROR') {
            throw new Error(`Object already exists: ${targetKey}`);
          }
        }

        const body = res.body;
        if (!body) throw new Error('Empty response body');
        const readable = Readable.fromWeb(body as any);
        await targetClient.putObject(imp.targetBucket, targetKey, readable);
        this.log(importId, 'info', `Downloaded: ${fileName}`);
        this.emitProgress(importId, ++completed, urls.length, targetKey, skipped);
      } catch (err: any) {
        this.log(importId, 'error', `Failed to download ${url}: ${err.message}`);
        if (imp.conflictStrategy === 'ERROR') throw err;
        completed++;
      }
    }

    await this.prisma.storageImport.update({
      where: { id: importId },
      data: { completedFiles: completed, skippedFiles: skipped },
    });
    this.log(importId, 'info', `URL import complete: ${completed - skipped} downloaded, ${skipped} skipped`);
    await this.updateStatus(importId, 'COMPLETED');
  }

  // --- Helpers ---

  private async listAllObjects(client: MinioClient, bucket: string, prefix: string): Promise<{ name: string }[]> {
    return new Promise((resolve, reject) => {
      const objects: { name: string }[] = [];
      const stream = client.listObjectsV2(bucket, prefix, true);
      stream.on('data', (obj) => { if (obj.name) objects.push({ name: obj.name }); });
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });
  }

  private async objectExists(client: MinioClient, bucket: string, key: string): Promise<boolean> {
    try { await client.statObject(bucket, key); return true; } catch { return false; }
  }

  private async updateStatus(importId: string, status: string, error?: string) {
    await this.prisma.storageImport.update({
      where: { id: importId },
      data: { status: status as any, error },
    });
    this.gateway.emit(importId, 'storage-import:status', { status, error });
  }

  private log(importId: string, level: string, message: string) {
    this.gateway.emit(importId, 'storage-import:log', { timestamp: new Date().toISOString(), level, message });
  }

  private emitProgress(importId: string, completedFiles: number, totalFiles: number, currentFile: string, skippedFiles: number) {
    this.gateway.emit(importId, 'storage-import:progress', { completedFiles, totalFiles, currentFile, skippedFiles });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/storage-import/storage-import.processor.ts
git commit -m "feat: add storage import BullMQ processor"
```

---

### Task 7: Backend — Controller

**Files:**
- Create: `backend/src/storage-import/storage-import.controller.ts`

- [ ] **Step 1: Create controller**

```typescript
import {
  Controller, Get, Post, Param, Body, UseGuards, UseInterceptors, UploadedFiles, BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { StorageImportService } from './storage-import.service';
import {
  TestStorageConnectionDto, DiscoverStorageObjectsDto, ValidateUrlsDto, CreateStorageImportDto,
} from './dto/create-storage-import.dto';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

@Controller('projects/:projectId/storage/import')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StorageImportController {
  constructor(
    private importService: StorageImportService,
    private config: ConfigService,
  ) {}

  @Post('test-connection') @MinRole('DEVELOPER')
  testConnection(@Body() dto: TestStorageConnectionDto) {
    return this.importService.testConnection(dto.connection);
  }

  @Post('discover') @MinRole('DEVELOPER')
  discover(@Body() dto: DiscoverStorageObjectsDto) {
    return this.importService.discoverObjects({ ...dto.connection, bucket: dto.bucket, prefix: dto.prefix });
  }

  @Post('validate-urls') @MinRole('DEVELOPER')
  validateUrls(@Body() dto: ValidateUrlsDto) {
    return this.importService.validateUrls(dto);
  }

  @Post('upload') @MinRole('DEVELOPER')
  @UseInterceptors(FilesInterceptor('files', 50, { limits: { fileSize: MAX_FILE_SIZE } }))
  upload(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('No files uploaded');

    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const results = files.map((file) => {
      const hex = randomBytes(8).toString('hex');
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileKey = `storage-import-${hex}-${safeName}`;
      const filePath = join(tempDir, fileKey);
      writeFileSync(filePath, file.buffer);
      return { fileKey, fileName: file.originalname, fileSize: file.size };
    });

    return { files: results };
  }

  @Post() @MinRole('DEVELOPER')
  create(@Param('projectId') projectId: string, @Body() dto: CreateStorageImportDto) {
    return this.importService.createImport(projectId, dto);
  }

  @Get(':importId') @MinRole('VIEWER')
  getOne(@Param('importId') importId: string) {
    return this.importService.getImport(importId);
  }

  @Post(':importId/cancel') @MinRole('DEVELOPER')
  cancel(@Param('importId') importId: string) {
    return this.importService.cancelImport(importId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/storage-import/storage-import.controller.ts
git commit -m "feat: add storage import controller"
```

---

### Task 8: Backend — Module Registration

**Files:**
- Create: `backend/src/storage-import/storage-import.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create module**

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ServicesModule } from '../services/services.module';
import { StorageImportController } from './storage-import.controller';
import { StorageImportService } from './storage-import.service';
import { StorageImportProcessor } from './storage-import.processor';
import { StorageImportGateway } from './storage-import.gateway';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'storage-import' }),
    JwtModule.register({}),
    ServicesModule,
  ],
  controllers: [StorageImportController],
  providers: [StorageImportService, StorageImportProcessor, StorageImportGateway],
})
export class StorageImportModule {}
```

- [ ] **Step 2: Register in AppModule**

In `backend/src/app.module.ts`, add import:

```typescript
import { StorageImportModule } from './storage-import/storage-import.module';
```

Add `StorageImportModule` to the `imports` array (after `StorageBrowserModule`).

- [ ] **Step 3: Verify backend compiles**

```bash
cd backend && npm run build
```

Expected: Successful compilation with no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/storage-import/storage-import.module.ts backend/src/app.module.ts
git commit -m "feat: register storage import module"
```

---

### Task 9: Frontend — Hooks

**Files:**
- Create: `frontend/src/hooks/use-storage-import.ts`
- Create: `frontend/src/hooks/use-storage-import-progress.ts`

- [ ] **Step 1: Create API hooks**

```typescript
// frontend/src/hooks/use-storage-import.ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiRaw } from '@/lib/api';

interface RemoteConnection {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  useSSL?: boolean;
}

export interface CreateStorageImportDto {
  source: 'REMOTE' | 'FILE' | 'URL';
  targetBucket: string;
  targetPrefix?: string;
  conflictStrategy: 'OVERWRITE' | 'SKIP' | 'ERROR';
  connection?: RemoteConnection;
  sourceBucket?: string;
  objectKeys?: string[];
  fileKeys?: string[];
  urls?: string[];
  totalFiles?: number;
  totalSize?: number;
}

export function useTestStorageConnection(projectId: string) {
  return useMutation({
    mutationFn: (connection: RemoteConnection) =>
      api(`/projects/${projectId}/storage/import/test-connection`, {
        method: 'POST',
        body: JSON.stringify({ connection }),
      }),
  });
}

export function useDiscoverStorageObjects(projectId: string) {
  return useMutation({
    mutationFn: (data: { connection: RemoteConnection; bucket: string; prefix?: string }) =>
      api(`/projects/${projectId}/storage/import/discover`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useValidateUrls(projectId: string) {
  return useMutation({
    mutationFn: (urls: string[]) =>
      api(`/projects/${projectId}/storage/import/validate-urls`, {
        method: 'POST',
        body: JSON.stringify({ urls }),
      }),
  });
}

export function useUploadImportFiles(projectId: string, onProgress?: (percent: number) => void) {
  return useMutation({
    mutationFn: (files: File[]) => {
      return new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
        xhr.open('POST', `${API_URL}/projects/${projectId}/storage/import/upload`);

        const token = localStorage.getItem('access_token');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.withCredentials = true;

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
          else reject(new Error(`Upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('Upload failed: network error'));

        const formData = new FormData();
        files.forEach((f) => formData.append('files', f));
        xhr.send(formData);
      });
    },
  });
}

export function useCreateStorageImport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateStorageImportDto) =>
      api(`/projects/${projectId}/storage/import`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-objects', projectId] }),
  });
}

export function useCancelStorageImport(projectId: string) {
  return useMutation({
    mutationFn: (importId: string) =>
      api(`/projects/${projectId}/storage/import/${importId}/cancel`, { method: 'POST' }),
  });
}
```

- [ ] **Step 2: Create progress hook**

```typescript
// frontend/src/hooks/use-storage-import-progress.ts
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket } from '@/lib/socket';
import { api } from '@/lib/api';

interface ImportLog {
  timestamp: string;
  level: string;
  message: string;
}

interface ImportProgress {
  completedFiles: number;
  totalFiles: number;
  currentFile: string;
  skippedFiles: number;
}

export function useStorageImportProgress(projectId: string, importId: string) {
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [status, setStatus] = useState<string>('');
  const socketRef = useRef(connectSocket());

  useEffect(() => {
    if (!importId) return;

    const socket = socketRef.current;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const handleDone = (newStatus: string) => {
      setStatus(newStatus);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(newStatus)) {
        if (pollTimer) clearInterval(pollTimer);
      }
    };

    const joinRoom = () => { socket.emit('join-storage-import', importId); };
    joinRoom();
    socket.on('connect', joinRoom);
    socket.on('storage-import:log', (data: ImportLog) => { setLogs((prev) => [...prev, data]); });
    socket.on('storage-import:progress', (data: ImportProgress) => { setProgress(data); });
    socket.on('storage-import:status', (data: { status: string }) => { handleDone(data.status); });

    pollTimer = setInterval(async () => {
      try {
        const data = await api<any>(`/projects/${projectId}/storage/import/${importId}`);
        if (data.status && data.status !== status) {
          setProgress({
            completedFiles: data.completedFiles ?? 0,
            totalFiles: data.totalFiles ?? 0,
            currentFile: '',
            skippedFiles: data.skippedFiles ?? 0,
          });
          handleDone(data.status);
        }
      } catch {}
    }, 3000);

    return () => {
      socket.emit('leave-storage-import', importId);
      socket.off('connect', joinRoom);
      socket.off('storage-import:log');
      socket.off('storage-import:progress');
      socket.off('storage-import:status');
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [importId, projectId]);

  return { logs, progress, status };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-storage-import.ts frontend/src/hooks/use-storage-import-progress.ts
git commit -m "feat: add storage import frontend hooks"
```

---

### Task 10: Frontend — StorageImportWizard Component

**Files:**
- Create: `frontend/src/components/storage-import-wizard.tsx`

- [ ] **Step 1: Create wizard component**

This is a large component (~500 lines). Create `frontend/src/components/storage-import-wizard.tsx` with the full wizard implementation following the same patterns as `migration-wizard.tsx`:

```typescript
'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  useTestStorageConnection, useDiscoverStorageObjects, useUploadImportFiles,
  useValidateUrls, useCreateStorageImport, useCancelStorageImport,
} from '@/hooks/use-storage-import';
import { useStorageImportProgress } from '@/hooks/use-storage-import-progress';
import { Cloud, Upload, Link, Check, X, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

type Step = 'source' | 'configure' | 'conflict' | 'execute';
type SourceMode = 'REMOTE' | 'FILE' | 'URL' | '';
type ConflictStrategy = 'OVERWRITE' | 'SKIP' | 'ERROR';

interface StorageImportWizardProps {
  projectId: string;
  bucket: string;
  prefix: string;
  onClose: () => void;
}

export function StorageImportWizard({ projectId, bucket, prefix, onClose }: StorageImportWizardProps) {
  const [step, setStep] = useState<Step>('source');
  const [sourceMode, setSourceMode] = useState<SourceMode>('');
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('OVERWRITE');
  const [importId, setImportId] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  // Remote state
  const [connection, setConnection] = useState({
    endpoint: '', port: 9000, accessKey: '', secretKey: '', useSSL: false,
  });
  const [remoteBuckets, setRemoteBuckets] = useState<any[]>([]);
  const [selectedRemoteBucket, setSelectedRemoteBucket] = useState('');
  const [remoteObjects, setRemoteObjects] = useState<any[]>([]);
  const [remotePrefixes, setRemotePrefixes] = useState<string[]>([]);
  const [remotePrefix, setRemotePrefix] = useState('');
  const [selectedObjects, setSelectedObjects] = useState<Set<string>>(new Set());

  // File state
  const [uploadedFiles, setUploadedFiles] = useState<{ fileKey: string; fileName: string; fileSize: number }[]>([]);
  const [uploadPercent, setUploadPercent] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL state
  const [urlText, setUrlText] = useState('');
  const [validatedUrls, setValidatedUrls] = useState<any[]>([]);

  // Mutations
  const testConnection = useTestStorageConnection(projectId);
  const discoverObjects = useDiscoverStorageObjects(projectId);
  const uploadFiles = useUploadImportFiles(projectId, setUploadPercent);
  const validateUrls = useValidateUrls(projectId);
  const createImport = useCreateStorageImport(projectId);
  const cancelImport = useCancelStorageImport(projectId);
  const { logs, progress, status } = useStorageImportProgress(projectId, importId);

  // --- Remote handlers ---
  const handleTestConnection = async () => {
    const result = await testConnection.mutateAsync(connection);
    if (!result.success) { toast.error(result.error || 'Connection failed'); return; }
    setRemoteBuckets(result.buckets);
    toast.success(`Connected! Found ${result.buckets.length} buckets`);
  };

  const handleBrowseBucket = async (bucketName: string) => {
    setSelectedRemoteBucket(bucketName);
    setRemotePrefix('');
    const result = await discoverObjects.mutateAsync({ connection, bucket: bucketName, prefix: '' });
    setRemoteObjects(result.objects);
    setRemotePrefixes(result.prefixes);
    setSelectedObjects(new Set());
  };

  const handleBrowsePrefix = async (p: string) => {
    setRemotePrefix(p);
    const result = await discoverObjects.mutateAsync({ connection, bucket: selectedRemoteBucket, prefix: p });
    setRemoteObjects(result.objects);
    setRemotePrefixes(result.prefixes);
  };

  const toggleObject = (key: string) => {
    setSelectedObjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // --- File handlers ---
  const handleFileSelect = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    try {
      const result = await uploadFiles.mutateAsync(files);
      setUploadedFiles((prev) => [...prev, ...result.files]);
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- URL handlers ---
  const handleValidateUrls = async () => {
    const urls = urlText.split('\n').map((u) => u.trim()).filter(Boolean);
    if (!urls.length) { toast.error('Enter at least one URL'); return; }
    const result = await validateUrls.mutateAsync(urls);
    setValidatedUrls(result.results);
  };

  // --- Start import ---
  const handleStartImport = async () => {
    let dto: any = {
      source: sourceMode,
      targetBucket: bucket,
      targetPrefix: prefix,
      conflictStrategy,
    };

    if (sourceMode === 'REMOTE') {
      dto.connection = connection;
      dto.sourceBucket = selectedRemoteBucket;
      dto.objectKeys = Array.from(selectedObjects);
      dto.totalFiles = selectedObjects.size;
    } else if (sourceMode === 'FILE') {
      dto.fileKeys = uploadedFiles.map((f) => f.fileKey);
      dto.totalFiles = uploadedFiles.length;
      dto.totalSize = uploadedFiles.reduce((s, f) => s + f.fileSize, 0);
    } else if (sourceMode === 'URL') {
      dto.urls = validatedUrls.filter((u) => u.valid).map((u) => u.url);
      dto.totalFiles = dto.urls.length;
    }

    const result = await createImport.mutateAsync(dto);
    setImportId(result.id);
    setStep('execute');
  };

  const canProceedToConfigure = () => {
    if (sourceMode === 'REMOTE') return selectedObjects.size > 0;
    if (sourceMode === 'FILE') return uploadedFiles.length > 0;
    if (sourceMode === 'URL') return validatedUrls.filter((u) => u.valid).length > 0;
    return false;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Import Storage Data</h2>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 text-sm text-muted-foreground">
        {(['source', 'configure', 'conflict', 'execute'] as const).map((s, i) => (
          <span key={s} className={step === s ? 'text-foreground font-medium' : ''}>
            {i > 0 && ' → '}{s === 'source' ? 'Source' : s === 'configure' ? 'Select Files' : s === 'conflict' ? 'Options' : 'Importing'}
          </span>
        ))}
      </div>

      {/* Step 1: Source */}
      {step === 'source' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'REMOTE' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => setSourceMode('REMOTE')}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Cloud className="h-8 w-8" />
                <p className="font-medium text-sm">Remote S3/MinIO</p>
                <p className="text-xs text-muted-foreground text-center">Copy from another S3-compatible storage</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'FILE' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => setSourceMode('FILE')}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Upload className="h-8 w-8" />
                <p className="font-medium text-sm">Upload Files</p>
                <p className="text-xs text-muted-foreground text-center">Multi-file, folders, ZIP/TAR.GZ</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'URL' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => setSourceMode('URL')}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Link className="h-8 w-8" />
                <p className="font-medium text-sm">URL Import</p>
                <p className="text-xs text-muted-foreground text-center">Download from public URLs</p>
              </CardContent>
            </Card>
          </div>

          {/* Remote form */}
          {sourceMode === 'REMOTE' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Endpoint</Label><Input value={connection.endpoint} onChange={(e) => setConnection({ ...connection, endpoint: e.target.value })} placeholder="s3.amazonaws.com" /></div>
                <div><Label>Port</Label><Input type="number" value={connection.port} onChange={(e) => setConnection({ ...connection, port: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Access Key</Label><Input value={connection.accessKey} onChange={(e) => setConnection({ ...connection, accessKey: e.target.value })} /></div>
                <div><Label>Secret Key</Label><Input type="password" value={connection.secretKey} onChange={(e) => setConnection({ ...connection, secretKey: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={connection.useSSL} onChange={(e) => setConnection({ ...connection, useSSL: e.target.checked })} />
                Use SSL
              </label>
              <Button onClick={handleTestConnection} disabled={!connection.endpoint || !connection.accessKey || !connection.secretKey || testConnection.isPending}>
                {testConnection.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Test Connection
              </Button>

              {remoteBuckets.length > 0 && !selectedRemoteBucket && (
                <div className="space-y-2">
                  <Label>Select Source Bucket</Label>
                  <div className="border rounded-lg max-h-40 overflow-y-auto">
                    {remoteBuckets.map((b: any) => (
                      <button key={b.name} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-0" onClick={() => handleBrowseBucket(b.name)}>
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedRemoteBucket && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1 text-sm">
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => handleBrowsePrefix('')}>{selectedRemoteBucket}</button>
                    {remotePrefix && remotePrefix.split('/').filter(Boolean).map((part, i, arr) => (
                      <span key={i}>
                        <span className="text-muted-foreground mx-1">/</span>
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => handleBrowsePrefix(arr.slice(0, i + 1).join('/') + '/')}>{part}</button>
                      </span>
                    ))}
                  </div>
                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    {remotePrefixes.map((p) => (
                      <label key={p} className="flex items-center gap-3 px-3 py-2 border-b hover:bg-muted/50">
                        <input type="checkbox" checked={selectedObjects.has(p)} onChange={() => toggleObject(p)} />
                        <span className="flex-1 text-sm cursor-pointer" onClick={() => handleBrowsePrefix(p)}>{p.replace(remotePrefix, '')}</span>
                      </label>
                    ))}
                    {remoteObjects.map((obj: any) => (
                      <label key={obj.name} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 hover:bg-muted/50 cursor-pointer">
                        <input type="checkbox" checked={selectedObjects.has(obj.name)} onChange={() => toggleObject(obj.name)} />
                        <span className="flex-1 font-mono text-xs">{obj.name.replace(remotePrefix, '')}</span>
                        <span className="text-xs text-muted-foreground">{formatSize(obj.size)}</span>
                      </label>
                    ))}
                    {!remotePrefixes.length && !remoteObjects.length && (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">Empty</div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{selectedObjects.size} selected</p>
                </div>
              )}
            </div>
          )}

          {/* File upload */}
          {sourceMode === 'FILE' && (
            <div className="space-y-3">
              {uploadFiles.isPending ? (
                <div className="border-2 border-dashed rounded-lg p-8 text-center opacity-70">
                  <Loader2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground animate-spin" />
                  <p className="text-sm font-medium">Uploading... {uploadPercent}%</p>
                  <div className="h-2 bg-muted rounded-full overflow-hidden max-w-xs mx-auto mt-2">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${uploadPercent}%` }} />
                  </div>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFileSelect(e.dataTransfer.files); }}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click or drag files here. Supports multiple files, ZIP, and TAR.GZ (max 1GB each)</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFileSelect(e.target.files)} />

              {uploadedFiles.length > 0 && (
                <div className="border rounded-lg max-h-60 overflow-y-auto">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 text-sm">
                      <span className="flex-1 font-mono text-xs">{f.fileName}</span>
                      <span className="text-xs text-muted-foreground">{formatSize(f.fileSize)}</span>
                      {(f.fileName.endsWith('.zip') || f.fileName.endsWith('.tar.gz') || f.fileName.endsWith('.tgz')) && (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">extract</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* URL input */}
          {sourceMode === 'URL' && (
            <div className="space-y-3">
              <div>
                <Label>URLs (one per line)</Label>
                <textarea
                  className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm font-mono min-h-[120px] resize-y"
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                  placeholder={"https://example.com/file1.csv\nhttps://example.com/file2.json"}
                />
              </div>
              <Button onClick={handleValidateUrls} disabled={!urlText.trim() || validateUrls.isPending}>
                {validateUrls.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Validate URLs
              </Button>

              {validatedUrls.length > 0 && (
                <div className="border rounded-lg max-h-60 overflow-y-auto">
                  {validatedUrls.map((u, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 text-sm">
                      {u.valid ? <Check className="h-4 w-4 text-green-500 shrink-0" /> : <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <span className="flex-1 font-mono text-xs truncate">{u.fileName || u.url}</span>
                      {u.valid && u.size > 0 && <span className="text-xs text-muted-foreground">{formatSize(u.size)}</span>}
                      {!u.valid && <span className="text-xs text-destructive">{u.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {sourceMode && canProceedToConfigure() && (
            <Button onClick={() => setStep('conflict')}>
              Next: Conflict Strategy
            </Button>
          )}
        </div>
      )}

      {/* Step 2: Conflict Strategy */}
      {step === 'conflict' && (
        <div className="space-y-4">
          <div className="rounded-lg border p-3 text-sm text-foreground/80">
            Importing into <strong>{bucket}</strong>{prefix ? <> / <strong>{prefix}</strong></> : ''}
          </div>

          <div className="space-y-3">
            <Label>If a file with the same name already exists:</Label>
            {([
              ['OVERWRITE', 'Overwrite', 'Replace existing files with imported files'],
              ['SKIP', 'Skip', 'Keep existing files, skip duplicates'],
              ['ERROR', 'Stop on conflict', 'Stop the entire import if any file already exists'],
            ] as const).map(([value, label, desc]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="conflict" className="mt-0.5" checked={conflictStrategy === value} onChange={() => setConflictStrategy(value)} />
                <span><span className="font-medium">{label}</span> — {desc}</span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('source')}>Back</Button>
            <Button onClick={handleStartImport} disabled={createImport.isPending}>
              {createImport.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Start Import
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Execute */}
      {step === 'execute' && (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{progress?.currentFile ? `Importing: ${progress.currentFile.split('/').pop()}` : 'Starting...'}</span>
              <span>{progress ? `${progress.completedFiles}${progress.totalFiles ? `/${progress.totalFiles}` : ''} files${progress.skippedFiles ? ` (${progress.skippedFiles} skipped)` : ''}` : ''}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: progress && progress.totalFiles ? `${(progress.completedFiles / progress.totalFiles) * 100}%` : '0%' }}
              />
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={() => setShowLogs(!showLogs)}>
            {showLogs ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showLogs ? 'Hide' : 'Show'} Logs ({logs.length})
          </Button>

          {showLogs && (
            <div className="bg-muted/50 rounded-lg p-3 max-h-60 overflow-y-auto font-mono text-xs space-y-0.5">
              {logs.map((log, i) => (
                <div key={i} className={log.level === 'error' ? 'text-destructive' : log.level === 'warn' ? 'text-yellow-500' : ''}>
                  <span className="text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                  {log.message}
                </div>
              ))}
              {logs.length === 0 && <p className="text-muted-foreground">Waiting for logs...</p>}
            </div>
          )}

          {status === 'COMPLETED' && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" /> Import completed successfully
            </div>
          )}
          {status === 'FAILED' && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> Import failed. Check logs for details.
            </div>
          )}

          <div className="flex gap-2">
            {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) && (
              <Button variant="destructive" size="sm" onClick={() => cancelImport.mutate(importId)}>Cancel</Button>
            )}
            {['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) && (
              <Button onClick={onClose}>Done</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/storage-import-wizard.tsx
git commit -m "feat: add StorageImportWizard component"
```

---

### Task 11: Frontend — Integrate Wizard into Storage Page

**Files:**
- Modify: `frontend/src/app/projects/[id]/storage/page.tsx`

- [ ] **Step 1: Add import button and wizard integration**

Add the import to the top of the file:

```typescript
import { StorageImportWizard } from '@/components/storage-import-wizard';
```

Add state for showing the import wizard (after existing state declarations around line 16):

```typescript
const [showImport, setShowImport] = useState(false);
```

Replace the file browser section (the `{!selectedBucket ? ... : ...}` block starting around line 96) to include the import wizard:

```typescript
        {showImport && selectedBucket ? (
          <StorageImportWizard
            projectId={id}
            bucket={selectedBucket}
            prefix={prefix}
            onClose={() => setShowImport(false)}
          />
        ) : !selectedBucket ? (
```

Add an "Import" button next to the existing "Upload" button (around line 116):

```typescript
                <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
                  Import
                </Button>
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd frontend && npm run build
```

Expected: Successful build.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/[id]/storage/page.tsx
git commit -m "feat: integrate storage import wizard into storage page"
```

---

### Task 12: Build, Test & Deploy

- [ ] **Step 1: Build backend**

```bash
cd backend && npm run build
```

- [ ] **Step 2: Build frontend**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Push and deploy**

```bash
git push
ssh root@178.104.154.165 "ship-dock upgrade --edge --force"
```

- [ ] **Step 4: Verify on production**

Navigate to a project's Storage page, select a bucket, and verify the "Import" button appears next to "Upload". Click it and verify the wizard opens with three source options.
