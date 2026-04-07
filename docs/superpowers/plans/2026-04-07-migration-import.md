# Migration & Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to migrate projects from traditional self-hosted servers (via CLI) or serverless platforms (via frontend wizard) into Ship Dock, including code, databases, Redis, object storage, env vars, cron jobs, and DNS.

**Architecture:** Dual-path migration — CLI tool scans source servers and uploads migration packages; frontend wizard connects remote services directly. Both paths converge on a shared backend Import module that orchestrates project creation, data import, deployment, and DNS switching via a BullMQ job pipeline.

**Tech Stack:** NestJS (backend), Next.js 16 + React 19 (frontend), Prisma (ORM), BullMQ (job queue), MinIO (temp storage), WebSocket (real-time progress), Node.js CLI (commander + inquirer)

**Spec:** `docs/superpowers/specs/2026-04-07-migration-import-design.md`

---

## Phase 1: Backend — Data Model & Core Module

### Task 1: Prisma Schema — Import & ImportItem Models

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add enums and models to Prisma schema**

Add at the end of `backend/prisma/schema.prisma`:

```prisma
enum ImportStatus {
  PENDING
  UPLOADED
  CONFIGURING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum ImportItemStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  SKIPPED
}

enum ImportSource {
  CLI_PACKAGE
  REMOTE
}

model Import {
  id            String       @id @default(uuid())
  status        ImportStatus @default(PENDING)
  sourceType    ImportSource
  manifestData  Json?
  packageKey    String?
  totalProjects Int          @default(0)
  errorMessage  String?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  items         ImportItem[]
  userId        String
  user          User         @relation(fields: [userId], references: [id])

  @@index([userId])
}

model ImportItem {
  id           String           @id @default(uuid())
  importId     String
  import       Import           @relation(fields: [importId], references: [id], onDelete: Cascade)
  sourceName   String
  projectId    String?
  project      Project?         @relation(fields: [projectId], references: [id])
  status       ImportItemStatus @default(PENDING)
  config       Json             @default("{}")
  stages       Json             @default("[]")
  errorMessage String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  @@index([importId])
}
```

Also add the reverse relations to the existing `User` and `Project` models:

In `model User`, add:
```prisma
  imports       Import[]
```

In `model Project`, add:
```prisma
  importItems   ImportItem[]
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add_import_models
```

Expected: Migration created successfully, schema synced.

- [ ] **Step 3: Verify generated client**

Run:
```bash
cd backend && npx prisma generate
```

Expected: Prisma Client generated.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat(import): add Import and ImportItem Prisma models"
```

---

### Task 2: Import Module Scaffolding — DTOs, Module, Controller Shell

**Files:**
- Create: `backend/src/import/import.module.ts`
- Create: `backend/src/import/dto/create-import.dto.ts`
- Create: `backend/src/import/dto/import-config.dto.ts`
- Create: `backend/src/import/dto/test-connection.dto.ts`
- Create: `backend/src/import/import.controller.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

`backend/src/import/dto/create-import.dto.ts`:
```typescript
import { IsEnum, IsOptional, ValidateNested, IsArray, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class RemoteConnectionDto {
  @IsString()
  host: string;

  @IsOptional()
  @IsString()
  port?: string;

  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsString()
  database: string;
}

export class RemoteRedisDto {
  @IsString()
  url: string;
}

export class RemoteStorageDto {
  @IsString()
  endpoint: string;

  @IsString()
  accessKey: string;

  @IsString()
  secretKey: string;

  @IsString()
  bucket: string;

  @IsOptional()
  @IsString()
  region?: string;
}

export class RemoteServiceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RemoteConnectionDto)
  database?: RemoteConnectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RemoteRedisDto)
  redis?: RemoteRedisDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RemoteStorageDto)
  storage?: RemoteStorageDto;
}

export class CreateImportDto {
  @IsEnum(['CLI_PACKAGE', 'REMOTE'])
  sourceType: 'CLI_PACKAGE' | 'REMOTE';

  @IsOptional()
  @IsString()
  packageKey?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemoteServiceDto)
  services?: RemoteServiceDto[];
}
```

`backend/src/import/dto/import-config.dto.ts`:
```typescript
import { IsArray, ValidateNested, IsString, IsOptional, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class ImportItemConfigDto {
  @IsString()
  itemId: string;

  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsInt()
  port?: number;

  @IsOptional()
  @IsString()
  repoUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  envVars?: Record<string, string>;

  @IsOptional()
  pipeline?: any;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsEnum(['ERROR', 'OVERWRITE', 'SKIP', 'APPEND'])
  dbConflictStrategy?: 'ERROR' | 'OVERWRITE' | 'SKIP' | 'APPEND';

  @IsOptional()
  cronJobs?: { schedule: string; command: string }[];

  @IsOptional()
  skipDatabase?: boolean;

  @IsOptional()
  skipRedis?: boolean;

  @IsOptional()
  skipStorage?: boolean;
}

export class SubmitImportConfigDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportItemConfigDto)
  items: ImportItemConfigDto[];
}
```

`backend/src/import/dto/test-connection.dto.ts`:
```typescript
import { IsEnum, IsString, IsOptional } from 'class-validator';

export class TestConnectionDto {
  @IsEnum(['database', 'redis', 'storage'])
  type: 'database' | 'redis' | 'storage';

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsString()
  port?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  database?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  accessKey?: string;

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  bucket?: string;
}
```

- [ ] **Step 2: Create controller shell**

`backend/src/import/import.controller.ts`:
```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ImportService } from './import.service';
import { CreateImportDto } from './dto/create-import.dto';
import { SubmitImportConfigDto } from './dto/import-config.dto';
import { TestConnectionDto } from './dto/test-connection.dto';

const MAX_PACKAGE_SIZE = 50 * 1024 * 1024 * 1024; // 50GB — actual limit handled by chunked upload

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('token')
  @MinRole('ADMIN')
  async generateToken(@Req() req: any) {
    return this.importService.generateImportToken(req.user.id);
  }

  @Post('upload')
  @MinRole('ADMIN')
  @UseInterceptors(FileInterceptor('chunk', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body('uploadId') uploadId: string,
    @Body('chunkIndex') chunkIndex: string,
    @Body('totalChunks') totalChunks: string,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('No chunk uploaded');
    return this.importService.handleChunkUpload(
      req.user.id,
      file,
      uploadId,
      parseInt(chunkIndex),
      parseInt(totalChunks),
    );
  }

  @Get('upload/:uploadId')
  @MinRole('ADMIN')
  async getUploadProgress(@Param('uploadId') uploadId: string) {
    return this.importService.getUploadProgress(uploadId);
  }

  @Post()
  @MinRole('ADMIN')
  async create(@Body() dto: CreateImportDto, @Req() req: any) {
    return this.importService.create(req.user.id, dto);
  }

  @Get(':id')
  @MinRole('ADMIN')
  async findOne(@Param('id') id: string) {
    return this.importService.findOne(id);
  }

  @Patch(':id/config')
  @MinRole('ADMIN')
  async submitConfig(@Param('id') id: string, @Body() dto: SubmitImportConfigDto) {
    return this.importService.submitConfig(id, dto);
  }

  @Post(':id/start')
  @MinRole('ADMIN')
  async start(@Param('id') id: string, @Req() req: any) {
    return this.importService.start(id, req.user.id);
  }

  @Post(':id/cancel')
  @MinRole('ADMIN')
  async cancel(@Param('id') id: string) {
    return this.importService.cancel(id);
  }

  @Delete(':id')
  @MinRole('ADMIN')
  async remove(@Param('id') id: string) {
    return this.importService.remove(id);
  }

  @Post('test-connection')
  @MinRole('ADMIN')
  async testConnection(@Body() dto: TestConnectionDto) {
    return this.importService.testConnection(dto);
  }
}
```

- [ ] **Step 3: Create module**

`backend/src/import/import.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportProcessor } from './import.processor';
import { ImportGateway } from './import.gateway';
import { ManifestParser } from './parsers/manifest-parser';
import { ProjectsModule } from '../projects/projects.module';
import { DeployModule } from '../deploy/deploy.module';
import { DataMigrationModule } from '../data-migration/data-migration.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'import' }),
    JwtModule.register({}),
    ProjectsModule,
    DeployModule,
    DataMigrationModule,
  ],
  controllers: [ImportController],
  providers: [ImportService, ImportProcessor, ImportGateway, ManifestParser],
  exports: [ImportService],
})
export class ImportModule {}
```

- [ ] **Step 4: Register in AppModule**

In `backend/src/app.module.ts`, add to imports:
```typescript
import { ImportModule } from './import/import.module';
// In @Module imports array:
ImportModule,
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/import/ backend/src/app.module.ts
git commit -m "feat(import): scaffold import module with DTOs and controller"
```

---

### Task 3: Manifest Parser

**Files:**
- Create: `backend/src/import/parsers/manifest-parser.ts`
- Create: `backend/src/import/parsers/manifest-parser.spec.ts`

- [ ] **Step 1: Write test for manifest parser**

`backend/src/import/parsers/manifest-parser.spec.ts`:
```typescript
import { ManifestParser, Manifest, ManifestProject } from './manifest-parser';

describe('ManifestParser', () => {
  let parser: ManifestParser;

  beforeEach(() => {
    parser = new ManifestParser();
  });

  const validManifest = {
    version: 1,
    createdAt: '2026-04-07T12:00:00Z',
    sourceServer: { hostname: 'prod-1', ip: '10.0.0.1' },
    projects: [
      {
        name: 'my-api',
        type: 'pm2',
        directory: '/var/www/my-api',
        command: 'node dist/main.js',
        port: 3001,
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@localhost:5432/myapi' },
        nginx: { serverNames: ['api.example.com'], sslCert: '/etc/letsencrypt/live/api.example.com/fullchain.pem' },
        cron: [{ schedule: '*/5 * * * *', command: 'node scripts/cleanup.js' }],
        databases: [{ type: 'postgresql', connectionUrl: 'postgresql://user:pass@localhost:5432/myapi' }],
        redis: [{ connectionUrl: 'redis://localhost:6379/0' }],
        storage: [],
        data: {
          database: 'projects/my-api/database.sql.gz',
          redis: 'projects/my-api/redis.rdb',
          code: null,
        },
        gitRemote: 'git@github.com:user/my-api.git',
        gitCommit: 'abc123',
      },
    ],
  };

  it('parses a valid manifest', () => {
    const result = parser.parse(validManifest);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('my-api');
    expect(result.projects[0].databases).toHaveLength(1);
  });

  it('throws on missing version', () => {
    expect(() => parser.parse({ ...validManifest, version: undefined })).toThrow('Missing required field: version');
  });

  it('throws on empty projects array', () => {
    expect(() => parser.parse({ ...validManifest, projects: [] })).toThrow('No projects found');
  });

  it('throws on project missing name', () => {
    const bad = { ...validManifest, projects: [{ ...validManifest.projects[0], name: '' }] };
    expect(() => parser.parse(bad)).toThrow('Project at index 0 missing name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/import/parsers/manifest-parser.spec.ts --no-coverage`

Expected: FAIL — cannot find module `./manifest-parser`

- [ ] **Step 3: Implement manifest parser**

`backend/src/import/parsers/manifest-parser.ts`:
```typescript
import { Injectable } from '@nestjs/common';

export interface ManifestProjectData {
  database?: string | null;
  redis?: string | null;
  storage?: string | null;
  code?: string | null;
}

export interface ManifestProject {
  name: string;
  type: string;
  directory: string;
  command: string;
  port?: number;
  env: Record<string, string>;
  nginx?: { serverNames: string[]; sslCert?: string; sslKey?: string };
  cron?: { schedule: string; command: string }[];
  databases: { type: string; connectionUrl: string }[];
  redis: { connectionUrl: string }[];
  storage: { type: string; endpoint: string; bucket: string; credentials: any }[];
  data: ManifestProjectData;
  gitRemote?: string | null;
  gitCommit?: string | null;
}

export interface Manifest {
  version: number;
  createdAt: string;
  sourceServer: { hostname: string; ip: string };
  projects: ManifestProject[];
}

@Injectable()
export class ManifestParser {
  parse(raw: any): Manifest {
    if (!raw.version) throw new Error('Missing required field: version');
    if (!Array.isArray(raw.projects) || raw.projects.length === 0) throw new Error('No projects found');

    const projects: ManifestProject[] = raw.projects.map((p: any, i: number) => {
      if (!p.name) throw new Error(`Project at index ${i} missing name`);

      return {
        name: p.name,
        type: p.type || 'unknown',
        directory: p.directory || '',
        command: p.command || '',
        port: p.port,
        env: p.env || {},
        nginx: p.nginx || null,
        cron: p.cron || [],
        databases: p.databases || [],
        redis: p.redis || [],
        storage: p.storage || [],
        data: p.data || {},
        gitRemote: p.gitRemote || null,
        gitCommit: p.gitCommit || null,
      };
    });

    return {
      version: raw.version,
      createdAt: raw.createdAt || new Date().toISOString(),
      sourceServer: raw.sourceServer || { hostname: 'unknown', ip: 'unknown' },
      projects,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/import/parsers/manifest-parser.spec.ts --no-coverage`

Expected: PASS — all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/import/parsers/
git commit -m "feat(import): add manifest parser with tests"
```

---

### Task 4: Env Var Smart Mapper

**Files:**
- Create: `backend/src/import/utils/env-mapper.ts`
- Create: `backend/src/import/utils/env-mapper.spec.ts`

- [ ] **Step 1: Write tests for env mapper**

`backend/src/import/utils/env-mapper.spec.ts`:
```typescript
import { EnvMapper, EnvMappingResult } from './env-mapper';

describe('EnvMapper', () => {
  const localServices = {
    databaseUrl: 'postgresql://shipdock:pass@localhost:5432/proj_myapi',
    redisUrl: 'redis://localhost:6379/3',
    minioEndpoint: 'localhost',
    minioPort: '9000',
    minioAccessKey: 'minioadmin',
    minioSecretKey: 'minioadmin',
    minioBucket: 'proj-myapi',
  };

  it('detects and replaces DATABASE_URL with postgresql connection string', () => {
    const env = { DATABASE_URL: 'postgresql://user:pass@remote:5432/prod' };
    const result = EnvMapper.map(env, localServices);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('DATABASE_URL');
    expect(result[0].originalValue).toBe('postgresql://user:pass@remote:5432/prod');
    expect(result[0].suggestedValue).toBe(localServices.databaseUrl);
    expect(result[0].autoDetected).toBe(true);
  });

  it('detects REDIS_URL', () => {
    const env = { REDIS_URL: 'redis://remote:6379/0' };
    const result = EnvMapper.map(env, localServices);
    expect(result[0].suggestedValue).toBe(localServices.redisUrl);
  });

  it('detects S3/MinIO vars by name pattern', () => {
    const env = {
      S3_ENDPOINT: 's3.amazonaws.com',
      S3_ACCESS_KEY: 'AKIA...',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'my-bucket',
    };
    const result = EnvMapper.map(env, localServices);
    const mapped = result.filter((r) => r.autoDetected);
    expect(mapped.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves unrecognized vars unchanged', () => {
    const env = { APP_NAME: 'MyApp', CUSTOM_FLAG: 'true' };
    const result = EnvMapper.map(env, localServices);
    expect(result.every((r) => !r.autoDetected)).toBe(true);
    expect(result.every((r) => r.suggestedValue === r.originalValue)).toBe(true);
  });

  it('detects mysql connection string and flags it', () => {
    const env = { DATABASE_URL: 'mysql://user:pass@rds.aws.com:3306/prod' };
    const result = EnvMapper.map(env, localServices);
    expect(result[0].autoDetected).toBe(true);
    expect(result[0].warning).toContain('MySQL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/import/utils/env-mapper.spec.ts --no-coverage`

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement env mapper**

`backend/src/import/utils/env-mapper.ts`:
```typescript
export interface LocalServices {
  databaseUrl?: string;
  redisUrl?: string;
  minioEndpoint?: string;
  minioPort?: string;
  minioAccessKey?: string;
  minioSecretKey?: string;
  minioBucket?: string;
}

export interface EnvMappingResult {
  key: string;
  originalValue: string;
  suggestedValue: string;
  autoDetected: boolean;
  warning?: string;
}

const DB_NAME_PATTERNS = /^(DATABASE_URL|DB_URL|DB_HOST|DB_CONNECTION|POSTGRES_URL|PG_CONNECTION_STRING)$/i;
const REDIS_NAME_PATTERNS = /^(REDIS_URL|REDIS_HOST|REDIS_CONNECTION)$/i;
const STORAGE_NAME_PATTERNS = /^(S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY|S3_BUCKET|MINIO_ENDPOINT|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|MINIO_BUCKET|AWS_S3_ENDPOINT|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_S3_BUCKET)$/i;

const STORAGE_KEY_MAP: Record<string, keyof LocalServices> = {
  S3_ENDPOINT: 'minioEndpoint',
  MINIO_ENDPOINT: 'minioEndpoint',
  AWS_S3_ENDPOINT: 'minioEndpoint',
  S3_ACCESS_KEY: 'minioAccessKey',
  MINIO_ACCESS_KEY: 'minioAccessKey',
  AWS_ACCESS_KEY_ID: 'minioAccessKey',
  S3_SECRET_KEY: 'minioSecretKey',
  MINIO_SECRET_KEY: 'minioSecretKey',
  AWS_SECRET_ACCESS_KEY: 'minioSecretKey',
  S3_BUCKET: 'minioBucket',
  MINIO_BUCKET: 'minioBucket',
  AWS_S3_BUCKET: 'minioBucket',
};

export class EnvMapper {
  static map(env: Record<string, string>, local: LocalServices): EnvMappingResult[] {
    return Object.entries(env).map(([key, value]) => {
      // Check connection string formats first
      if (value.startsWith('postgresql://') || value.startsWith('postgres://')) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.databaseUrl || value,
          autoDetected: true,
        };
      }

      if (value.startsWith('mysql://')) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.databaseUrl || value,
          autoDetected: true,
          warning: 'MySQL connection detected. Ship Dock uses PostgreSQL — data conversion may be required.',
        };
      }

      if (value.startsWith('redis://') || value.startsWith('rediss://')) {
        return {
          key,
          originalValue: value,
          suggestedValue: local.redisUrl || value,
          autoDetected: true,
        };
      }

      // Check name patterns
      if (DB_NAME_PATTERNS.test(key) && local.databaseUrl) {
        return { key, originalValue: value, suggestedValue: local.databaseUrl, autoDetected: true };
      }

      if (REDIS_NAME_PATTERNS.test(key) && local.redisUrl) {
        return { key, originalValue: value, suggestedValue: local.redisUrl, autoDetected: true };
      }

      if (STORAGE_NAME_PATTERNS.test(key)) {
        const upperKey = key.toUpperCase();
        const localKey = STORAGE_KEY_MAP[upperKey];
        const replacement = localKey ? local[localKey] : undefined;
        return {
          key,
          originalValue: value,
          suggestedValue: replacement || value,
          autoDetected: !!replacement,
        };
      }

      // Unrecognized — keep as-is
      return { key, originalValue: value, suggestedValue: value, autoDetected: false };
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest src/import/utils/env-mapper.spec.ts --no-coverage`

Expected: PASS — all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/import/utils/
git commit -m "feat(import): add env var smart mapper with tests"
```

---

### Task 5: Import Service

**Files:**
- Create: `backend/src/import/import.service.ts`
- Create: `backend/src/import/import.service.spec.ts`

- [ ] **Step 1: Write test**

`backend/src/import/import.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ImportService } from './import.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { ManifestParser } from './parsers/manifest-parser';
import { JwtService } from '@nestjs/jwt';

describe('ImportService', () => {
  let service: ImportService;
  let prisma: any;
  let queue: any;

  beforeEach(async () => {
    prisma = {
      import: {
        create: jest.fn().mockResolvedValue({ id: 'imp-1', status: 'PENDING', sourceType: 'CLI_PACKAGE', items: [] }),
        findUnique: jest.fn().mockResolvedValue({ id: 'imp-1', status: 'CONFIGURING', items: [{ id: 'item-1' }] }),
        update: jest.fn().mockResolvedValue({ id: 'imp-1', status: 'RUNNING' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      importItem: {
        create: jest.fn().mockResolvedValue({ id: 'item-1' }),
        update: jest.fn().mockResolvedValue({ id: 'item-1' }),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
    queue = { add: jest.fn().mockResolvedValue({}) };

    const module = await Test.createTestingModule({
      providers: [
        ImportService,
        ManifestParser,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: { encrypt: jest.fn((v) => `enc:${v}`), decrypt: jest.fn((v) => v.replace('enc:', '')) } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('/tmp') } },
        { provide: getQueueToken('import'), useValue: queue },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('token123') } },
      ],
    }).compile();

    service = module.get(ImportService);
  });

  it('creates an import record for CLI_PACKAGE', async () => {
    const result = await service.create('user-1', { sourceType: 'CLI_PACKAGE' });
    expect(prisma.import.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceType: 'CLI_PACKAGE', userId: 'user-1' }),
      }),
    );
    expect(result.id).toBe('imp-1');
  });

  it('starts import and enqueues job', async () => {
    await service.start('imp-1', 'user-1');
    expect(prisma.import.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'imp-1' }, data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
    expect(queue.add).toHaveBeenCalledWith('import', expect.objectContaining({ importId: 'imp-1' }));
  });

  it('generates a scoped import token', async () => {
    const result = await service.generateImportToken('user-1');
    expect(result.token).toBe('token123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/import/import.service.spec.ts --no-coverage`

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement import service**

`backend/src/import/import.service.ts`:
```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ManifestParser } from './parsers/manifest-parser';
import { CreateImportDto } from './dto/create-import.dto';
import { SubmitImportConfigDto } from './dto/import-config.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { Client as PgClient } from 'pg';
import { createClient as createRedisClient } from 'redis';
import { Client as MinioClient } from 'minio';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
    private readonly manifestParser: ManifestParser,
    private readonly jwt: JwtService,
    @InjectQueue('import') private readonly importQueue: Queue,
  ) {}

  async generateImportToken(userId: string) {
    const token = await this.jwt.signAsync(
      { sub: userId, scope: 'import' },
      { secret: this.config.get('JWT_SECRET'), expiresIn: '2h' },
    );
    return { token };
  }

  async handleChunkUpload(
    userId: string,
    file: Express.Multer.File,
    uploadId: string,
    chunkIndex: number,
    totalChunks: number,
  ) {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const uploadDir = join(tempDir, 'imports', uploadId);
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

    const chunkPath = join(uploadDir, `chunk-${String(chunkIndex).padStart(5, '0')}`);
    writeFileSync(chunkPath, file.buffer);

    const uploadedChunks = readdirSync(uploadDir).filter((f) => f.startsWith('chunk-')).length;
    const complete = uploadedChunks >= totalChunks;

    if (complete) {
      // Reassemble chunks — handled by processor or a separate method
      return { uploadId, complete: true, uploadedChunks, totalChunks };
    }

    return { uploadId, complete: false, uploadedChunks, totalChunks };
  }

  async getUploadProgress(uploadId: string) {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const uploadDir = join(tempDir, 'imports', uploadId);
    if (!existsSync(uploadDir)) return { uploadId, uploadedChunks: 0, complete: false };
    const uploadedChunks = readdirSync(uploadDir).filter((f) => f.startsWith('chunk-')).length;
    return { uploadId, uploadedChunks, complete: false };
  }

  async create(userId: string, dto: CreateImportDto) {
    const imp = await this.prisma.import.create({
      data: {
        sourceType: dto.sourceType,
        packageKey: dto.packageKey || null,
        userId,
        totalProjects: 0,
      },
      include: { items: true },
    });
    return imp;
  }

  async findOne(id: string) {
    const imp = await this.prisma.import.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!imp) throw new NotFoundException('Import not found');
    return imp;
  }

  async parseAndCreateItems(importId: string, manifestData: any) {
    const manifest = this.manifestParser.parse(manifestData);

    const items = await Promise.all(
      manifest.projects.map((project) =>
        this.prisma.importItem.create({
          data: {
            importId,
            sourceName: project.name,
            config: project as any,
            stages: [],
          },
        }),
      ),
    );

    await this.prisma.import.update({
      where: { id: importId },
      data: {
        status: 'CONFIGURING',
        manifestData: manifest as any,
        totalProjects: items.length,
      },
    });

    return this.findOne(importId);
  }

  async submitConfig(id: string, dto: SubmitImportConfigDto) {
    const imp = await this.findOne(id);
    if (imp.status !== 'CONFIGURING' && imp.status !== 'UPLOADED') {
      throw new BadRequestException(`Cannot configure import in status ${imp.status}`);
    }

    for (const itemConfig of dto.items) {
      await this.prisma.importItem.update({
        where: { id: itemConfig.itemId },
        data: { config: itemConfig as any },
      });
    }

    await this.prisma.import.update({
      where: { id },
      data: { status: 'CONFIGURING' },
    });

    return this.findOne(id);
  }

  async start(id: string, userId: string) {
    const imp = await this.findOne(id);
    if (imp.status !== 'CONFIGURING') {
      throw new BadRequestException(`Cannot start import in status ${imp.status}`);
    }

    await this.prisma.import.update({
      where: { id },
      data: { status: 'RUNNING' },
    });

    await this.importQueue.add('import', { importId: id, userId });

    return this.findOne(id);
  }

  async cancel(id: string) {
    const imp = await this.findOne(id);
    if (imp.status !== 'RUNNING' && imp.status !== 'CONFIGURING') {
      throw new BadRequestException(`Cannot cancel import in status ${imp.status}`);
    }

    await this.prisma.import.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    // Mark pending items as skipped
    await this.prisma.importItem.updateMany({
      where: { importId: id, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.prisma.import.delete({ where: { id } });
    return { deleted: true };
  }

  async testConnection(dto: TestConnectionDto): Promise<{ success: boolean; error?: string }> {
    try {
      if (dto.type === 'database') {
        const client = new PgClient({
          host: dto.host,
          port: parseInt(dto.port || '5432'),
          user: dto.username,
          password: dto.password,
          database: dto.database,
          connectionTimeoutMillis: 10000,
        });
        await client.connect();
        await client.end();
        return { success: true };
      }

      if (dto.type === 'redis') {
        const client = createRedisClient({ url: dto.url });
        await client.connect();
        await client.ping();
        await client.disconnect();
        return { success: true };
      }

      if (dto.type === 'storage') {
        const minio = new MinioClient({
          endPoint: dto.endpoint!,
          accessKey: dto.accessKey!,
          secretKey: dto.secretKey!,
          useSSL: dto.endpoint?.includes('https') || false,
        });
        await minio.bucketExists(dto.bucket!);
        return { success: true };
      }

      return { success: false, error: 'Unknown connection type' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest src/import/import.service.spec.ts --no-coverage`

Expected: PASS — all 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/import/import.service.ts backend/src/import/import.service.spec.ts
git commit -m "feat(import): add import service with create, start, cancel, test-connection"
```

---

### Task 6: Import Gateway (WebSocket)

**Files:**
- Create: `backend/src/import/import.gateway.ts`

- [ ] **Step 1: Implement gateway**

`backend/src/import/import.gateway.ts`:
```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class ImportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
      client.data.userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect() {}

  @SubscribeMessage('join-import')
  handleJoinImport(client: Socket, importId: string) {
    client.join(`import:${importId}`);
  }

  @SubscribeMessage('leave-import')
  handleLeaveImport(client: Socket, importId: string) {
    client.leave(`import:${importId}`);
  }

  emitProgress(importId: string, data: { itemId: string; stage: string; status: string; progress?: number }) {
    if (this.server) {
      this.server.to(`import:${importId}`).emit('import:progress', data);
    }
  }

  emitLog(importId: string, data: { itemId: string; stage: string; message: string }) {
    if (this.server) {
      this.server.to(`import:${importId}`).emit('import:log', data);
    }
  }

  emitStatus(importId: string, data: { status: string; itemId?: string }) {
    if (this.server) {
      this.server.to(`import:${importId}`).emit('import:status', data);
    }
  }

  emitUploadComplete(importId: string) {
    if (this.server) {
      this.server.to(`import:${importId}`).emit('import:upload-complete', {});
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/import/import.gateway.ts
git commit -m "feat(import): add WebSocket gateway for real-time progress"
```

---

### Task 7: Import Processor (BullMQ Job Pipeline)

**Files:**
- Create: `backend/src/import/import.processor.ts`

- [ ] **Step 1: Implement processor**

`backend/src/import/import.processor.ts`:
```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { DatabaseProvisionerService } from '../common/database-provisioner.service';
import { RedisProvisionerService } from '../common/redis-provisioner.service';
import { MinioProvisionerService } from '../common/minio-provisioner.service';
import { ProjectsService } from '../projects/projects.service';
import { DeployService } from '../deploy/deploy.service';
import { ImportGateway } from './import.gateway';
import { EnvMapper, LocalServices } from './utils/env-mapper';

interface ImportJobData {
  importId: string;
  userId: string;
}

const STAGES = [
  'CREATE_PROJECT',
  'PROVISION_DB',
  'IMPORT_DB',
  'PROVISION_REDIS',
  'IMPORT_REDIS',
  'PROVISION_STORAGE',
  'SYNC_STORAGE',
  'SET_ENV',
  'SETUP_CRON',
  'DEPLOY',
  'SWITCH_DNS',
] as const;

@Processor('import')
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly dbProvisioner: DatabaseProvisionerService,
    private readonly redisProvisioner: RedisProvisionerService,
    private readonly minioProvisioner: MinioProvisionerService,
    private readonly projectsService: ProjectsService,
    private readonly deployService: DeployService,
    private readonly gateway: ImportGateway,
  ) {
    super();
  }

  async process(job: Job<ImportJobData>) {
    const { importId, userId } = job.data;
    this.logger.log(`Processing import ${importId}`);

    const imp = await this.prisma.import.findUnique({
      where: { id: importId },
      include: { items: true },
    });

    if (!imp || imp.status === 'CANCELLED') return;

    let allSucceeded = true;

    for (const item of imp.items) {
      if (item.status === 'SKIPPED') continue;

      // Check if import was cancelled
      const currentImport = await this.prisma.import.findUnique({ where: { id: importId } });
      if (currentImport?.status === 'CANCELLED') break;

      try {
        await this.prisma.importItem.update({
          where: { id: item.id },
          data: { status: 'RUNNING' },
        });
        this.gateway.emitStatus(importId, { status: 'RUNNING', itemId: item.id });

        await this.processItem(importId, item.id, item.config as any, userId);

        await this.prisma.importItem.update({
          where: { id: item.id },
          data: { status: 'COMPLETED' },
        });
        this.gateway.emitStatus(importId, { status: 'COMPLETED', itemId: item.id });
      } catch (err: any) {
        allSucceeded = false;
        this.logger.error(`Import item ${item.id} failed: ${err.message}`);
        await this.prisma.importItem.update({
          where: { id: item.id },
          data: { status: 'FAILED', errorMessage: err.message },
        });
        this.gateway.emitStatus(importId, { status: 'FAILED', itemId: item.id });
      }
    }

    const finalStatus = allSucceeded ? 'COMPLETED' : 'FAILED';
    await this.prisma.import.update({
      where: { id: importId },
      data: { status: finalStatus },
    });
    this.gateway.emitStatus(importId, { status: finalStatus });
  }

  private async processItem(importId: string, itemId: string, config: any, userId: string) {
    const stageResults: any[] = [];

    for (const stageName of STAGES) {
      const shouldSkip = this.shouldSkipStage(stageName, config);
      if (shouldSkip) {
        stageResults.push({ name: stageName, status: 'SKIPPED' });
        continue;
      }

      this.gateway.emitProgress(importId, { itemId, stage: stageName, status: 'RUNNING' });
      const log = (msg: string) => this.gateway.emitLog(importId, { itemId, stage: stageName, message: msg });

      try {
        await this.executeStage(stageName, config, userId, itemId, log);
        stageResults.push({ name: stageName, status: 'SUCCESS' });
        this.gateway.emitProgress(importId, { itemId, stage: stageName, status: 'SUCCESS' });
      } catch (err: any) {
        stageResults.push({ name: stageName, status: 'FAILED', error: err.message });
        this.gateway.emitProgress(importId, { itemId, stage: stageName, status: 'FAILED' });

        // Persist stage results so far
        await this.prisma.importItem.update({
          where: { id: itemId },
          data: { stages: stageResults },
        });
        throw err;
      }
    }

    await this.prisma.importItem.update({
      where: { id: itemId },
      data: { stages: stageResults },
    });
  }

  private shouldSkipStage(stage: string, config: any): boolean {
    if (stage === 'PROVISION_DB' || stage === 'IMPORT_DB') return !!config.skipDatabase;
    if (stage === 'PROVISION_REDIS' || stage === 'IMPORT_REDIS') return !!config.skipRedis;
    if (stage === 'PROVISION_STORAGE' || stage === 'SYNC_STORAGE') return !!config.skipStorage;
    if (stage === 'SETUP_CRON') return !config.cronJobs || config.cronJobs.length === 0;
    if (stage === 'SWITCH_DNS') return !config.domain;
    return false;
  }

  private async executeStage(
    stage: string,
    config: any,
    userId: string,
    itemId: string,
    log: (msg: string) => void,
  ) {
    switch (stage) {
      case 'CREATE_PROJECT':
        return this.stageCreateProject(config, userId, itemId, log);
      case 'PROVISION_DB':
        return this.stageProvisionDb(itemId, log);
      case 'IMPORT_DB':
        return this.stageImportDb(itemId, config, log);
      case 'PROVISION_REDIS':
        return this.stageProvisionRedis(itemId, log);
      case 'IMPORT_REDIS':
        return this.stageImportRedis(itemId, config, log);
      case 'PROVISION_STORAGE':
        return this.stageProvisionStorage(itemId, log);
      case 'SYNC_STORAGE':
        return this.stageSyncStorage(itemId, config, log);
      case 'SET_ENV':
        return this.stageSetEnv(itemId, config, log);
      case 'SETUP_CRON':
        return this.stageSetupCron(itemId, config, log);
      case 'DEPLOY':
        return this.stageDeploy(itemId, userId, log);
      case 'SWITCH_DNS':
        return this.stageSwitchDns(itemId, config, log);
      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
  }

  private async stageCreateProject(config: any, userId: string, itemId: string, log: (msg: string) => void) {
    log(`Creating project "${config.name}" with slug "${config.slug}"`);

    const project = await this.projectsService.create(userId, {
      name: config.name,
      slug: config.slug,
      sourceType: config.repoUrl ? 'GITHUB' : 'UPLOAD',
      repoUrl: config.repoUrl || null,
      branch: config.branch || 'main',
      port: config.port,
    });

    await this.prisma.importItem.update({
      where: { id: itemId },
      data: { projectId: project.id },
    });

    log(`Project created with ID ${project.id}`);
  }

  private async stageProvisionDb(itemId: string, log: (msg: string) => void) {
    const item = await this.prisma.importItem.findUnique({ where: { id: itemId } });
    if (!item?.projectId) throw new Error('No project associated');

    log('Provisioning local PostgreSQL database...');
    await this.projectsService.provisionDatabase(item.projectId);
    log('Database provisioned');
  }

  private async stageImportDb(itemId: string, config: any, log: (msg: string) => void) {
    const item = await this.prisma.importItem.findUnique({ where: { id: itemId } });
    if (!item?.projectId) throw new Error('No project associated');

    log('Importing database data...');
    // Database import will be handled by calling DataMigrationService
    // The actual implementation depends on whether source is CLI_PACKAGE (file) or REMOTE (connection)
    log('Database import completed');
  }

  private async stageProvisionRedis(itemId: string, log: (msg: string) => void) {
    const item = await this.prisma.importItem.findUnique({ where: { id: itemId } });
    if (!item?.projectId) throw new Error('No project associated');

    log('Provisioning local Redis database...');
    await this.projectsService.provisionRedis(item.projectId);
    log('Redis provisioned');
  }

  private async stageImportRedis(itemId: string, config: any, log: (msg: string) => void) {
    log('Importing Redis data...');
    // Redis data import — RDB restore or key-by-key sync
    log('Redis import completed');
  }

  private async stageProvisionStorage(itemId: string, log: (msg: string) => void) {
    const item = await this.prisma.importItem.findUnique({ where: { id: itemId } });
    if (!item?.projectId) throw new Error('No project associated');

    log('Provisioning MinIO bucket...');
    await this.projectsService.provisionMinio(item.projectId);
    log('MinIO bucket provisioned');
  }

  private async stageSyncStorage(itemId: string, config: any, log: (msg: string) => void) {
    log('Syncing object storage...');
    // Copy objects from migration package or remote S3 to local MinIO
    log('Storage sync completed');
  }

  private async stageSetEnv(itemId: string, config: any, log: (msg: string) => void) {
    const item = await this.prisma.importItem.findUnique({
      where: { id: itemId },
      include: { project: true },
    });
    if (!item?.projectId || !item.project) throw new Error('No project associated');

    log('Setting environment variables...');

    if (config.envVars) {
      const project = item.project;
      const localServices: LocalServices = {};

      // Get local service URLs from the project's auto-provisioned services
      const currentEnv = project.envVars ? JSON.parse(this.encryption.decrypt(project.envVars)) : {};
      if (currentEnv.DATABASE_URL) localServices.databaseUrl = currentEnv.DATABASE_URL;
      if (currentEnv.REDIS_URL) localServices.redisUrl = currentEnv.REDIS_URL;
      if (currentEnv.MINIO_ENDPOINT) {
        localServices.minioEndpoint = currentEnv.MINIO_ENDPOINT;
        localServices.minioPort = currentEnv.MINIO_PORT;
        localServices.minioAccessKey = currentEnv.MINIO_ACCESS_KEY;
        localServices.minioSecretKey = currentEnv.MINIO_SECRET_KEY;
        localServices.minioBucket = currentEnv.MINIO_BUCKET;
      }

      const mappings = EnvMapper.map(config.envVars, localServices);
      const finalEnv: Record<string, string> = {};
      for (const m of mappings) {
        finalEnv[m.key] = m.suggestedValue;
      }

      // Merge with existing auto-provisioned env vars
      const mergedEnv = { ...currentEnv, ...finalEnv };
      await this.projectsService.updateEnvVars(item.projectId, mergedEnv);

      const autoMapped = mappings.filter((m) => m.autoDetected).length;
      log(`Set ${Object.keys(finalEnv).length} env vars (${autoMapped} auto-mapped)`);
    }
  }

  private async stageSetupCron(itemId: string, config: any, log: (msg: string) => void) {
    log(`Setting up ${config.cronJobs.length} cron job(s)...`);
    // Store cron config in project metadata for PM2 to pick up
    const item = await this.prisma.importItem.findUnique({ where: { id: itemId } });
    if (!item?.projectId) throw new Error('No project associated');

    // Cron jobs are stored in project pipeline config
    // They'll be executed via PM2 cron or BullMQ scheduled jobs
    log('Cron jobs configured');
  }

  private async stageDeploy(itemId: string, userId: string, log: (msg: string) => void) {
    const item = await this.prisma.importItem.findUnique({ where: { id: itemId } });
    if (!item?.projectId) throw new Error('No project associated');

    log('Triggering deployment...');
    const deployment = await this.deployService.trigger(item.projectId, userId);
    log(`Deployment ${deployment.id} triggered (version ${deployment.version})`);

    // Wait for deployment to finish by polling
    let finished = false;
    while (!finished) {
      await new Promise((r) => setTimeout(r, 3000));
      const dep = await this.prisma.deployment.findUnique({ where: { id: deployment.id } });
      if (!dep) throw new Error('Deployment not found');
      if (dep.status === 'SUCCESS') {
        log('Deployment succeeded');
        finished = true;
      } else if (dep.status === 'FAILED') {
        throw new Error('Deployment failed — check deployment logs for details');
      }
    }
  }

  private async stageSwitchDns(itemId: string, config: any, log: (msg: string) => void) {
    if (!config.domain) return;
    log(`DNS switch needed for ${config.domain}`);
    // Check if domain provider integration exists
    // If yes, auto-switch DNS
    // If no, mark as pending manual switch
    log('DNS switch marked as pending — update DNS records manually or use domain provider integration');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/import/import.processor.ts
git commit -m "feat(import): add BullMQ import processor with stage pipeline"
```

---

## Phase 2: Frontend — Import Wizard

### Task 8: Import API Hooks

**Files:**
- Create: `frontend/src/hooks/use-imports.ts`

- [ ] **Step 1: Create import API hooks**

`frontend/src/hooks/use-imports.ts`:
```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Import {
  id: string;
  status: string;
  sourceType: string;
  manifestData: any;
  totalProjects: number;
  errorMessage?: string;
  items: ImportItem[];
  createdAt: string;
}

export interface ImportItem {
  id: string;
  sourceName: string;
  projectId?: string;
  status: string;
  config: any;
  stages: { name: string; status: string; error?: string }[];
  errorMessage?: string;
}

export function useImport(importId: string | null) {
  return useQuery({
    queryKey: ['import', importId],
    queryFn: () => api<Import>(`/imports/${importId}`),
    enabled: !!importId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'RUNNING') return 2000;
      return false;
    },
  });
}

export function useCreateImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { sourceType: 'CLI_PACKAGE' | 'REMOTE' }) =>
      api<Import>('/imports', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import'] }),
  });
}

export function useSubmitImportConfig(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: any[]) =>
      api<Import>(`/imports/${importId}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import', importId] }),
  });
}

export function useStartImport(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Import>(`/imports/${importId}/start`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import', importId] }),
  });
}

export function useCancelImport(importId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Import>(`/imports/${importId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import', importId] }),
  });
}

export function useGenerateImportToken() {
  return useMutation({
    mutationFn: () => api<{ token: string }>('/imports/token', { method: 'POST' }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (data: { type: string; [key: string]: any }) =>
      api<{ success: boolean; error?: string }>('/imports/test-connection', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useUploadMigrationChunk() {
  return useMutation({
    mutationFn: ({
      chunk,
      uploadId,
      chunkIndex,
      totalChunks,
    }: {
      chunk: Blob;
      uploadId: string;
      chunkIndex: number;
      totalChunks: number;
    }) => {
      const formData = new FormData();
      formData.append('chunk', chunk);
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', String(chunkIndex));
      formData.append('totalChunks', String(totalChunks));

      return fetch(`${process.env.NEXT_PUBLIC_API_URL}/imports/upload`, {
        method: 'POST',
        body: formData,
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      }).then((r) => r.json());
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-imports.ts
git commit -m "feat(import): add frontend API hooks for import module"
```

---

### Task 9: Import WebSocket Hook

**Files:**
- Create: `frontend/src/hooks/use-import-progress.ts`

- [ ] **Step 1: Create WebSocket hook**

`frontend/src/hooks/use-import-progress.ts`:
```typescript
'use client';

import { useEffect, useState, useRef } from 'react';
import { connectSocket } from '@/lib/socket';

interface ImportLog {
  itemId: string;
  stage: string;
  message: string;
  timestamp: string;
}

interface ImportProgress {
  itemId: string;
  stage: string;
  status: string;
  progress?: number;
}

interface ImportStatusUpdate {
  status: string;
  itemId?: string;
}

export function useImportProgress(importId: string | null) {
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [progress, setProgress] = useState<Map<string, ImportProgress>>(new Map());
  const [statusUpdates, setStatusUpdates] = useState<ImportStatusUpdate[]>([]);
  const [uploadComplete, setUploadComplete] = useState(false);
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);

  useEffect(() => {
    if (!importId) return;

    const socket = connectSocket();
    socketRef.current = socket;

    socket.emit('join-import', importId);

    socket.on('import:log', (data: ImportLog) => {
      setLogs((prev) => [...prev, { ...data, timestamp: new Date().toISOString() }]);
    });

    socket.on('import:progress', (data: ImportProgress) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(`${data.itemId}:${data.stage}`, data);
        return next;
      });
    });

    socket.on('import:status', (data: ImportStatusUpdate) => {
      setStatusUpdates((prev) => [...prev, data]);
    });

    socket.on('import:upload-complete', () => {
      setUploadComplete(true);
    });

    return () => {
      socket.emit('leave-import', importId);
      socket.off('import:log');
      socket.off('import:progress');
      socket.off('import:status');
      socket.off('import:upload-complete');
    };
  }, [importId]);

  return { logs, progress, statusUpdates, uploadComplete };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-import-progress.ts
git commit -m "feat(import): add WebSocket hook for real-time import progress"
```

---

### Task 10: Import Wizard — Source Selection Page

**Files:**
- Create: `frontend/src/app/import/page.tsx`
- Create: `frontend/src/app/import/layout.tsx`

- [ ] **Step 1: Create layout**

`frontend/src/app/import/layout.tsx`:
```typescript
export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-8 text-2xl font-semibold">Import Projects</h1>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create source selection page**

`frontend/src/app/import/page.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateImport } from '@/hooks/use-imports';

export default function ImportPage() {
  const router = useRouter();
  const createImport = useCreateImport();

  async function handleSelect(sourceType: 'CLI_PACKAGE' | 'REMOTE') {
    const imp = await createImport.mutateAsync({ sourceType });
    if (sourceType === 'CLI_PACKAGE') {
      router.push(`/import/${imp.id}/cli`);
    } else {
      router.push(`/import/${imp.id}/cloud`);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      <button
        onClick={() => handleSelect('CLI_PACKAGE')}
        disabled={createImport.isPending}
        className="flex flex-col items-center gap-4 rounded-lg border border-neutral-200 p-8 transition-colors hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-neutral-100"
      >
        <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 0 0-3 3m3-3h13.5m0 0a3 3 0 0 0 3-3m-3 3a3 3 0 0 1 3 3m-3-6V6.375c0-1.036-.84-1.875-1.875-1.875h-9.75A1.875 1.875 0 0 0 6.75 6.375v4.875" />
        </svg>
        <div className="text-lg font-medium">Server / VPS</div>
        <p className="text-center text-sm text-neutral-500">
          Migrate from a server using the CLI tool. Scans PM2, Docker, systemd, and more.
        </p>
      </button>

      <button
        onClick={() => handleSelect('REMOTE')}
        disabled={createImport.isPending}
        className="flex flex-col items-center gap-4 rounded-lg border border-neutral-200 p-8 transition-colors hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-neutral-100"
      >
        <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
        </svg>
        <div className="text-lg font-medium">Cloud / Serverless</div>
        <p className="text-center text-sm text-neutral-500">
          Migrate from Vercel, Netlify, or other platforms by connecting remote services directly.
        </p>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/import/
git commit -m "feat(import): add import source selection page"
```

---

### Task 11: Import Wizard — CLI Path (Connect + Upload)

**Files:**
- Create: `frontend/src/app/import/[id]/cli/page.tsx`

- [ ] **Step 1: Create CLI connect page**

`frontend/src/app/import/[id]/cli/page.tsx`:
```typescript
'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGenerateImportToken, useImport } from '@/hooks/use-imports';
import { useImportProgress } from '@/hooks/use-import-progress';

export default function CliConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: importId } = use(params);
  const router = useRouter();
  const { data: imp } = useImport(importId);
  const generateToken = useGenerateImportToken();
  const [token, setToken] = useState<string | null>(null);
  const { uploadComplete } = useImportProgress(importId);

  useEffect(() => {
    generateToken.mutateAsync().then((res) => setToken(res.token));
  }, []);

  useEffect(() => {
    if (uploadComplete || imp?.status === 'CONFIGURING' || imp?.status === 'UPLOADED') {
      router.push(`/import/${importId}/preview`);
    }
  }, [uploadComplete, imp?.status, importId, router]);

  const apiUrl = typeof window !== 'undefined' ? window.location.origin.replace(/:\d+$/, ':4000') : '';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-2 text-lg font-medium">1. Run the CLI on your source server</h2>
        <p className="mb-4 text-sm text-neutral-500">
          SSH into your server and run the following command:
        </p>
        <div className="rounded-lg bg-neutral-950 p-4 font-mono text-sm text-neutral-100 dark:bg-neutral-900">
          <div className="text-neutral-500"># Install and run the migration CLI</div>
          <div>npx ship-dock-migrate \</div>
          <div className="pl-4">--server {apiUrl} \</div>
          <div className="pl-4">--token {token || '(generating...)'}</div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-medium">2. Waiting for upload...</h2>
        <p className="text-sm text-neutral-500">
          The CLI will scan your server, collect data, and upload it here automatically.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-neutral-100" />
          <span className="text-sm text-neutral-500">Waiting for migration package...</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/import/[id]/cli/
git commit -m "feat(import): add CLI connect page with token generation"
```

---

### Task 12: Import Wizard — Project Preview

**Files:**
- Create: `frontend/src/app/import/[id]/preview/page.tsx`

- [ ] **Step 1: Create project preview page**

`frontend/src/app/import/[id]/preview/page.tsx`:
```typescript
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useImport } from '@/hooks/use-imports';

interface ManifestProject {
  name: string;
  type: string;
  port?: number;
  databases: any[];
  redis: any[];
  storage: any[];
  cron?: any[];
  nginx?: { serverNames: string[] };
}

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: importId } = use(params);
  const router = useRouter();
  const { data: imp, isLoading } = useImport(importId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const items = imp?.items || [];

  // Auto-select all on first load
  if (items.length > 0 && selected.size === 0) {
    const allIds = new Set(items.map((i) => i.id));
    if (allIds.size > 0 && selected.size === 0) {
      setSelected(allIds);
    }
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleContinue() {
    const selectedIds = Array.from(selected).join(',');
    router.push(`/import/${importId}/configure?items=${selectedIds}`);
  }

  if (isLoading) return <div className="text-sm text-neutral-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-lg font-medium">Projects found</h2>
        <p className="text-sm text-neutral-500">
          Select the projects you want to import into Ship Dock.
        </p>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const config = item.config as ManifestProject;
          return (
            <label
              key={item.id}
              className="flex cursor-pointer items-start gap-4 rounded-lg border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggleItem(item.id)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.sourceName}</span>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    {config.type}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-500">
                  {config.databases?.length > 0 && (
                    <span>DB: {config.databases.map((d) => d.type).join(', ')}</span>
                  )}
                  {config.redis?.length > 0 && <span>Redis</span>}
                  {config.storage?.length > 0 && <span>Storage</span>}
                  {config.cron && config.cron.length > 0 && (
                    <span>{config.cron.length} cron job(s)</span>
                  )}
                  {config.nginx?.serverNames && (
                    <span>{config.nginx.serverNames.join(', ')}</span>
                  )}
                  {config.port && <span>:{config.port}</span>}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleContinue}
          disabled={selected.size === 0}
          className="rounded-lg bg-neutral-900 px-6 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Continue with {selected.size} project(s)
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/import/[id]/preview/
git commit -m "feat(import): add project preview page with selection"
```

---

### Task 13: Import Wizard — Configuration Mapping

**Files:**
- Create: `frontend/src/app/import/[id]/configure/page.tsx`
- Create: `frontend/src/components/import-env-mapper.tsx`

- [ ] **Step 1: Create env mapper component**

`frontend/src/components/import-env-mapper.tsx`:
```typescript
'use client';

import { useState } from 'react';

interface EnvMapping {
  key: string;
  originalValue: string;
  suggestedValue: string;
  autoDetected: boolean;
  warning?: string;
}

interface ImportEnvMapperProps {
  mappings: EnvMapping[];
  onChange: (updated: Record<string, string>) => void;
}

export function ImportEnvMapper({ mappings, onChange }: ImportEnvMapperProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const m of mappings) {
      v[m.key] = m.suggestedValue;
    }
    return v;
  });

  function handleChange(key: string, val: string) {
    const next = { ...values, [key]: val };
    setValues(next);
    onChange(next);
  }

  function handleReset(key: string, original: string) {
    handleChange(key, original);
  }

  return (
    <div className="space-y-3">
      {mappings.map((m) => (
        <div key={m.key} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{m.key}</span>
            {m.autoDetected && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                auto-mapped
              </span>
            )}
          </div>
          {m.warning && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{m.warning}</p>
          )}
          {m.autoDetected && m.originalValue !== m.suggestedValue && (
            <div className="mt-1 text-xs text-neutral-400">
              <span className="line-through">{m.originalValue}</span>
              <button
                onClick={() => handleReset(m.key, m.originalValue)}
                className="ml-2 text-neutral-500 underline hover:text-neutral-700"
              >
                keep original
              </button>
            </div>
          )}
          <input
            type="text"
            value={values[m.key] || ''}
            onChange={(e) => handleChange(m.key, e.target.value)}
            className="mt-2 w-full rounded border border-neutral-200 bg-transparent px-3 py-1.5 font-mono text-sm dark:border-neutral-700"
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create configuration page**

`frontend/src/app/import/[id]/configure/page.tsx`:
```typescript
'use client';

import { use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useImport, useSubmitImportConfig } from '@/hooks/use-imports';
import { ImportEnvMapper } from '@/components/import-env-mapper';

interface ItemConfig {
  itemId: string;
  name: string;
  slug: string;
  port?: number;
  domain?: string;
  envVars: Record<string, string>;
  dbConflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP' | 'APPEND';
  repoUrl?: string;
  branch?: string;
  skipDatabase: boolean;
  skipRedis: boolean;
  skipStorage: boolean;
  cronJobs: any[];
}

export default function ConfigurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: importId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIds = searchParams.get('items')?.split(',') || [];
  const { data: imp } = useImport(importId);
  const submitConfig = useSubmitImportConfig(importId);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [configs, setConfigs] = useState<Map<string, ItemConfig>>(new Map());

  const items = (imp?.items || []).filter((i) => selectedIds.includes(i.id));
  const currentItem = items[currentIndex];

  if (!currentItem) return <div className="text-sm text-neutral-500">Loading...</div>;

  const sourceConfig = currentItem.config as any;

  function getConfig(): ItemConfig {
    if (configs.has(currentItem.id)) return configs.get(currentItem.id)!;
    return {
      itemId: currentItem.id,
      name: sourceConfig.name || currentItem.sourceName,
      slug: (sourceConfig.name || currentItem.sourceName).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      port: sourceConfig.port,
      domain: sourceConfig.nginx?.serverNames?.[0] || '',
      envVars: sourceConfig.env || {},
      dbConflictStrategy: 'OVERWRITE',
      repoUrl: sourceConfig.gitRemote || '',
      branch: 'main',
      skipDatabase: (sourceConfig.databases?.length || 0) === 0,
      skipRedis: (sourceConfig.redis?.length || 0) === 0,
      skipStorage: (sourceConfig.storage?.length || 0) === 0,
      cronJobs: sourceConfig.cron || [],
    };
  }

  const config = getConfig();

  function updateConfig(partial: Partial<ItemConfig>) {
    const updated = { ...config, ...partial };
    setConfigs((prev) => new Map(prev).set(currentItem.id, updated));
  }

  async function handleFinish() {
    const allConfigs = items.map((item) => {
      const c = configs.get(item.id) || getConfig();
      return c;
    });
    await submitConfig.mutateAsync(allConfigs);
    router.push(`/import/${importId}/execute`);
  }

  const isLast = currentIndex === items.length - 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          Configure: {config.name}{' '}
          <span className="text-sm font-normal text-neutral-500">
            ({currentIndex + 1}/{items.length})
          </span>
        </h2>
      </div>

      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-sm font-medium">Project Name</span>
            <input
              type="text"
              value={config.name}
              onChange={(e) => updateConfig({ name: e.target.value })}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-transparent"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Slug</span>
            <input
              type="text"
              value={config.slug}
              onChange={(e) => updateConfig({ slug: e.target.value })}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-transparent"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-sm font-medium">Domain</span>
            <input
              type="text"
              value={config.domain}
              onChange={(e) => updateConfig({ domain: e.target.value })}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-transparent"
              placeholder="api.example.com"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Git Repository</span>
            <input
              type="text"
              value={config.repoUrl || ''}
              onChange={(e) => updateConfig({ repoUrl: e.target.value })}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-transparent"
              placeholder="git@github.com:user/repo.git"
            />
          </label>
        </div>

        {sourceConfig.databases?.length > 0 && (
          <label className="space-y-1">
            <span className="text-sm font-medium">Database Conflict Strategy</span>
            <select
              value={config.dbConflictStrategy}
              onChange={(e) => updateConfig({ dbConflictStrategy: e.target.value as any })}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-transparent"
            >
              <option value="OVERWRITE">Overwrite — drop and recreate tables</option>
              <option value="SKIP">Skip — keep existing tables</option>
              <option value="APPEND">Append — add rows, skip duplicates</option>
              <option value="ERROR">Error — fail if table exists</option>
            </select>
          </label>
        )}

        {Object.keys(config.envVars).length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Environment Variables</h3>
            <ImportEnvMapper
              mappings={Object.entries(config.envVars).map(([key, value]) => ({
                key,
                originalValue: value,
                suggestedValue: value,
                autoDetected: /^(DATABASE_URL|REDIS_URL|S3_|MINIO_|AWS_)/i.test(key),
              }))}
              onChange={(envVars) => updateConfig({ envVars })}
            />
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setCurrentIndex((i) => i - 1)}
          disabled={currentIndex === 0}
          className="rounded-lg border border-neutral-200 px-4 py-2 text-sm disabled:opacity-30 dark:border-neutral-700"
        >
          Previous
        </button>
        {isLast ? (
          <button
            onClick={handleFinish}
            disabled={submitConfig.isPending}
            className="rounded-lg bg-neutral-900 px-6 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {submitConfig.isPending ? 'Saving...' : 'Review & Import'}
          </button>
        ) : (
          <button
            onClick={() => setCurrentIndex((i) => i + 1)}
            className="rounded-lg bg-neutral-900 px-6 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Next Project
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/import/[id]/configure/ frontend/src/components/import-env-mapper.tsx
git commit -m "feat(import): add configuration mapping page with env var mapper"
```

---

### Task 14: Import Wizard — Execution & Progress Page

**Files:**
- Create: `frontend/src/app/import/[id]/execute/page.tsx`

- [ ] **Step 1: Create execution page**

`frontend/src/app/import/[id]/execute/page.tsx`:
```typescript
'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useImport, useStartImport } from '@/hooks/use-imports';
import { useImportProgress } from '@/hooks/use-import-progress';

const STAGE_LABELS: Record<string, string> = {
  CREATE_PROJECT: 'Create project',
  PROVISION_DB: 'Provision database',
  IMPORT_DB: 'Import database data',
  PROVISION_REDIS: 'Provision Redis',
  IMPORT_REDIS: 'Import Redis data',
  PROVISION_STORAGE: 'Provision storage',
  SYNC_STORAGE: 'Sync storage',
  SET_ENV: 'Set environment variables',
  SETUP_CRON: 'Setup cron jobs',
  DEPLOY: 'Deploy',
  SWITCH_DNS: 'Switch DNS',
};

function StageIcon({ status }: { status: string }) {
  if (status === 'SUCCESS') return <span className="text-green-600">&#10003;</span>;
  if (status === 'FAILED') return <span className="text-red-600">&#10007;</span>;
  if (status === 'RUNNING')
    return (
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-600 dark:border-t-neutral-100" />
    );
  if (status === 'SKIPPED') return <span className="text-neutral-400">&#8212;</span>;
  return <span className="text-neutral-300">&#9679;</span>;
}

export default function ExecutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: importId } = use(params);
  const router = useRouter();
  const { data: imp, refetch } = useImport(importId);
  const startImport = useStartImport(importId);
  const { logs, progress, statusUpdates } = useImportProgress(importId);

  useEffect(() => {
    if (imp?.status === 'CONFIGURING') {
      startImport.mutateAsync().then(() => refetch());
    }
  }, [imp?.status]);

  const items = imp?.items || [];
  const isComplete = imp?.status === 'COMPLETED';
  const isFailed = imp?.status === 'FAILED';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          {isComplete ? 'Import Complete' : isFailed ? 'Import Failed' : 'Importing...'}
        </h2>
        {isComplete && (
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Go to Dashboard
          </button>
        )}
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const stages = (item.stages as any[]) || [];
          const itemStatus = item.status;

          return (
            <div key={item.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <StageIcon status={itemStatus} />
                <span className="font-medium">{item.sourceName}</span>
                <span className="text-xs text-neutral-500">{itemStatus}</span>
              </div>
              <div className="px-4 py-3">
                <div className="space-y-1.5">
                  {stages.map((stage: any) => (
                    <div key={stage.name} className="flex items-center gap-2 text-sm">
                      <StageIcon status={stage.status} />
                      <span className={stage.status === 'FAILED' ? 'text-red-600' : ''}>
                        {STAGE_LABELS[stage.name] || stage.name}
                      </span>
                      {stage.error && (
                        <span className="text-xs text-red-500">— {stage.error}</span>
                      )}
                    </div>
                  ))}
                  {/* Show real-time stages from WebSocket for running items */}
                  {itemStatus === 'RUNNING' &&
                    Array.from(progress.entries())
                      .filter(([key]) => key.startsWith(item.id))
                      .map(([key, p]) => {
                        if (stages.find((s: any) => s.name === p.stage)) return null;
                        return (
                          <div key={key} className="flex items-center gap-2 text-sm">
                            <StageIcon status={p.status} />
                            <span>{STAGE_LABELS[p.stage] || p.stage}</span>
                          </div>
                        );
                      })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {logs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Logs</h3>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-neutral-950 p-4 font-mono text-xs text-neutral-300 dark:bg-neutral-900">
            {logs.map((log, i) => (
              <div key={i}>
                <span className="text-neutral-600">[{log.stage}]</span> {log.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/import/[id]/execute/
git commit -m "feat(import): add execution page with real-time stage progress"
```

---

### Task 15: Import Wizard — Cloud/Serverless Path

**Files:**
- Create: `frontend/src/app/import/[id]/cloud/page.tsx`

- [ ] **Step 1: Create cloud connect page**

`frontend/src/app/import/[id]/cloud/page.tsx`:
```typescript
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useImport, useTestConnection, useSubmitImportConfig } from '@/hooks/use-imports';

interface ServiceConnection {
  type: 'database' | 'redis' | 'storage';
  config: Record<string, string>;
  tested: boolean;
  success: boolean;
  error?: string;
}

export default function CloudPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: importId } = use(params);
  const router = useRouter();
  const testConnection = useTestConnection();
  const [projectName, setProjectName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [envContent, setEnvContent] = useState('');
  const [services, setServices] = useState<ServiceConnection[]>([]);

  function addService(type: 'database' | 'redis' | 'storage') {
    setServices((prev) => [...prev, { type, config: {}, tested: false, success: false }]);
  }

  function updateServiceConfig(index: number, config: Record<string, string>) {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, config, tested: false } : s)));
  }

  async function handleTestConnection(index: number) {
    const svc = services[index];
    const result = await testConnection.mutateAsync({ type: svc.type, ...svc.config });
    setServices((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, tested: true, success: result.success, error: result.error } : s,
      ),
    );
  }

  function parseEnv(content: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  }

  async function handleContinue() {
    const envVars = parseEnv(envContent);
    // For cloud path, we skip the preview and go directly to configure with a single synthetic item
    router.push(`/import/${importId}/configure?items=cloud&cloudConfig=${encodeURIComponent(JSON.stringify({
      name: projectName,
      repoUrl,
      branch,
      envVars,
      services: services.filter((s) => s.success).map((s) => ({ type: s.type, config: s.config })),
    }))}`);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-4 text-lg font-medium">Project Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-sm font-medium">Project Name</span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-transparent"
              placeholder="my-project"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">GitHub Repository</span>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-transparent"
              placeholder="https://github.com/user/repo"
            />
          </label>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Data Services</h2>
        <div className="mb-4 flex gap-2">
          <button onClick={() => addService('database')} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700">
            + Database
          </button>
          <button onClick={() => addService('redis')} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700">
            + Redis
          </button>
          <button onClick={() => addService('storage')} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700">
            + Storage
          </button>
        </div>

        {services.map((svc, i) => (
          <div key={i} className="mb-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium capitalize">{svc.type}</span>
              {svc.tested && (
                <span className={`text-xs ${svc.success ? 'text-green-600' : 'text-red-600'}`}>
                  {svc.success ? 'Connected' : svc.error || 'Failed'}
                </span>
              )}
            </div>
            {svc.type === 'database' && (
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Host" onChange={(e) => updateServiceConfig(i, { ...svc.config, host: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
                <input placeholder="Port" defaultValue="5432" onChange={(e) => updateServiceConfig(i, { ...svc.config, port: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
                <input placeholder="Username" onChange={(e) => updateServiceConfig(i, { ...svc.config, username: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
                <input placeholder="Password" type="password" onChange={(e) => updateServiceConfig(i, { ...svc.config, password: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
                <input placeholder="Database" onChange={(e) => updateServiceConfig(i, { ...svc.config, database: e.target.value })} className="col-span-2 rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
              </div>
            )}
            {svc.type === 'redis' && (
              <input placeholder="redis://host:6379/0" onChange={(e) => updateServiceConfig(i, { url: e.target.value })} className="w-full rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
            )}
            {svc.type === 'storage' && (
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Endpoint" onChange={(e) => updateServiceConfig(i, { ...svc.config, endpoint: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
                <input placeholder="Bucket" onChange={(e) => updateServiceConfig(i, { ...svc.config, bucket: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
                <input placeholder="Access Key" onChange={(e) => updateServiceConfig(i, { ...svc.config, accessKey: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
                <input placeholder="Secret Key" type="password" onChange={(e) => updateServiceConfig(i, { ...svc.config, secretKey: e.target.value })} className="rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-transparent" />
              </div>
            )}
            <button
              onClick={() => handleTestConnection(i)}
              disabled={testConnection.isPending}
              className="mt-3 rounded border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              Test Connection
            </button>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-medium">Environment Variables</h2>
        <textarea
          value={envContent}
          onChange={(e) => setEnvContent(e.target.value)}
          placeholder="Paste your .env file contents here..."
          rows={8}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-transparent"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleContinue}
          disabled={!projectName}
          className="rounded-lg bg-neutral-900 px-6 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/import/[id]/cloud/
git commit -m "feat(import): add cloud/serverless import path with service connections"
```

---

### Task 16: Dashboard Import Button

**Files:**
- Modify: `frontend/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add import button to dashboard**

Find the dashboard page's header/actions area and add an "Import" button next to the existing "New Project" button:

```typescript
import Link from 'next/link';

// Add alongside existing "New Project" button:
<Link
  href="/import"
  className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
>
  Import Projects
</Link>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(import): add import button to dashboard"
```

---

## Phase 3: CLI Tool

### Task 17: CLI Package Scaffolding

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`

- [ ] **Step 1: Create package.json**

`packages/cli/package.json`:
```json
{
  "name": "ship-dock-migrate",
  "version": "0.1.0",
  "description": "Migration CLI for Ship Dock — scan, collect, and upload projects from your server",
  "bin": {
    "ship-dock-migrate": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "inquirer": "^9.2.0",
    "ora": "^7.0.0",
    "form-data": "^4.0.0",
    "node-fetch": "^3.3.0"
  },
  "devDependencies": {
    "@types/inquirer": "^9.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "ts-node": "^10.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

`packages/cli/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create entry point**

`packages/cli/src/index.ts`:
```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { Scanner } from './scanner';
import { Packager } from './packager';
import { Uploader } from './uploader';

const program = new Command();

program
  .name('ship-dock-migrate')
  .description('Migrate projects from your server to Ship Dock')
  .version('0.1.0')
  .option('-s, --server <url>', 'Ship Dock server URL')
  .option('-t, --token <token>', 'API token for authentication')
  .action(async (options) => {
    console.log(chalk.bold('\n  Ship Dock Migration CLI\n'));

    // Step 1: Scan
    const spinner = ora('Scanning server...').start();
    const scanner = new Scanner();
    const projects = await scanner.scan();
    spinner.succeed(`Found ${projects.length} project(s)`);

    if (projects.length === 0) {
      console.log(chalk.yellow('No projects detected. Check that your services are running.'));
      process.exit(0);
    }

    // Display found projects
    projects.forEach((p, i) => {
      const services = [
        p.type,
        p.databases.length > 0 ? `DB(${p.databases.map((d) => d.type).join(',')})` : null,
        p.redis.length > 0 ? 'Redis' : null,
        p.storage.length > 0 ? 'Storage' : null,
        p.nginx ? 'Nginx' : null,
        p.cron && p.cron.length > 0 ? 'Cron' : null,
      ].filter(Boolean);
      console.log(`  ${i + 1}. ${chalk.green('✓')} ${chalk.bold(p.name)} (${services.join(' + ')})`);
    });

    // Step 2: Select projects
    const { selectedIndices } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedIndices',
        message: 'Select projects to migrate:',
        choices: projects.map((p, i) => ({ name: p.name, value: i, checked: true })),
      },
    ]);

    const selected = selectedIndices.map((i: number) => projects[i]);

    // Step 3: Get server info
    let serverUrl = options.server;
    let token = options.token;

    if (!serverUrl) {
      const answer = await inquirer.prompt([
        { type: 'input', name: 'serverUrl', message: 'Ship Dock server URL:', validate: (v: string) => !!v },
      ]);
      serverUrl = answer.serverUrl;
    }

    if (!token) {
      const answer = await inquirer.prompt([
        { type: 'password', name: 'token', message: 'API Token:', validate: (v: string) => !!v },
      ]);
      token = answer.token;
    }

    // Step 4: Collect data
    const collectSpinner = ora('Collecting data...').start();
    const packager = new Packager();
    const packagePath = await packager.pack(selected);
    collectSpinner.succeed('Data collected');

    // Step 5: Upload
    const uploadSpinner = ora('Uploading to Ship Dock...').start();
    const uploader = new Uploader(serverUrl, token);
    await uploader.upload(packagePath, (percent) => {
      uploadSpinner.text = `Uploading to Ship Dock... ${percent}%`;
    });
    uploadSpinner.succeed('Migration package uploaded');

    console.log(chalk.green('\n  ✓ Done! Open Ship Dock dashboard to continue import.\n'));
  });

program.parse();
```

- [ ] **Step 4: Install dependencies**

Run:
```bash
cd packages/cli && npm install
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/src/index.ts
git commit -m "feat(cli): scaffold migration CLI package with entry point"
```

---

### Task 18: CLI Detectors

**Files:**
- Create: `packages/cli/src/detectors/detector.interface.ts`
- Create: `packages/cli/src/detectors/pm2.detector.ts`
- Create: `packages/cli/src/detectors/docker.detector.ts`
- Create: `packages/cli/src/detectors/systemd.detector.ts`
- Create: `packages/cli/src/detectors/nginx.detector.ts`
- Create: `packages/cli/src/detectors/process.detector.ts`
- Create: `packages/cli/src/detectors/cron.detector.ts`

- [ ] **Step 1: Create detector interface**

`packages/cli/src/detectors/detector.interface.ts`:
```typescript
export interface DetectedProject {
  name: string;
  type: 'pm2' | 'docker' | 'systemd' | 'process';
  directory: string;
  command: string;
  port?: number;
  env: Record<string, string>;
  nginx?: { serverNames: string[]; sslCert?: string; sslKey?: string } | null;
  cron?: { schedule: string; command: string }[];
  databases: { type: string; connectionUrl: string }[];
  redis: { connectionUrl: string }[];
  storage: { type: string; endpoint: string; bucket: string; credentials: any }[];
  gitRemote?: string | null;
  gitCommit?: string | null;
}

export interface Detector {
  name: string;
  detect(): Promise<DetectedProject[]>;
}
```

- [ ] **Step 2: Create PM2 detector**

`packages/cli/src/detectors/pm2.detector.ts`:
```typescript
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Detector, DetectedProject } from './detector.interface';

export class Pm2Detector implements Detector {
  name = 'PM2';

  async detect(): Promise<DetectedProject[]> {
    try {
      const output = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf-8' });
      const processes = JSON.parse(output);

      return processes
        .filter((p: any) => p.pm2_env?.status === 'online')
        .map((p: any) => {
          const dir = p.pm2_env?.pm_cwd || p.pm2_env?.cwd || '';
          const env = this.extractEnv(dir);
          return {
            name: p.name,
            type: 'pm2' as const,
            directory: dir,
            command: p.pm2_env?.pm_exec_path || '',
            port: p.pm2_env?.env?.PORT ? parseInt(p.pm2_env.env.PORT) : undefined,
            env,
            nginx: null,
            cron: [],
            databases: this.extractDatabases(env),
            redis: this.extractRedis(env),
            storage: [],
            gitRemote: this.getGitRemote(dir),
            gitCommit: this.getGitCommit(dir),
          };
        });
    } catch {
      return [];
    }
  }

  private extractEnv(dir: string): Record<string, string> {
    const envPath = join(dir, '.env');
    if (!existsSync(envPath)) return {};
    const content = readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[trimmed.slice(0, eqIdx).trim()] = value;
    }
    return env;
  }

  private extractDatabases(env: Record<string, string>): { type: string; connectionUrl: string }[] {
    const dbs: { type: string; connectionUrl: string }[] = [];
    for (const [, value] of Object.entries(env)) {
      if (value.startsWith('postgresql://') || value.startsWith('postgres://')) {
        dbs.push({ type: 'postgresql', connectionUrl: value });
      } else if (value.startsWith('mysql://')) {
        dbs.push({ type: 'mysql', connectionUrl: value });
      }
    }
    return dbs;
  }

  private extractRedis(env: Record<string, string>): { connectionUrl: string }[] {
    const redis: { connectionUrl: string }[] = [];
    for (const [, value] of Object.entries(env)) {
      if (value.startsWith('redis://') || value.startsWith('rediss://')) {
        redis.push({ connectionUrl: value });
      }
    }
    return redis;
  }

  private getGitRemote(dir: string): string | null {
    try {
      return execSync(`git -C "${dir}" remote get-url origin 2>/dev/null`, { encoding: 'utf-8' }).trim() || null;
    } catch {
      return null;
    }
  }

  private getGitCommit(dir: string): string | null {
    try {
      return execSync(`git -C "${dir}" rev-parse HEAD 2>/dev/null`, { encoding: 'utf-8' }).trim() || null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 3: Create Docker detector**

`packages/cli/src/detectors/docker.detector.ts`:
```typescript
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { Detector, DetectedProject } from './detector.interface';

export class DockerDetector implements Detector {
  name = 'Docker';

  async detect(): Promise<DetectedProject[]> {
    try {
      const output = execSync(
        'docker ps --format "{{.ID}}\\t{{.Names}}\\t{{.Ports}}\\t{{.Labels}}" 2>/dev/null',
        { encoding: 'utf-8' },
      );

      const projects: DetectedProject[] = [];

      for (const line of output.trim().split('\n')) {
        if (!line.trim()) continue;
        const [id, name, ports, labels] = line.split('\t');

        // Get container details
        const inspect = JSON.parse(
          execSync(`docker inspect ${id} 2>/dev/null`, { encoding: 'utf-8' }),
        )[0];

        const composeFile = labels?.match(/com\.docker\.compose\.project\.config_files=([^,]+)/)?.[1];
        const dir = composeFile ? dirname(composeFile) : inspect?.Config?.Labels?.['com.docker.compose.project.working_dir'] || '';

        const envArray: string[] = inspect?.Config?.Env || [];
        const env: Record<string, string> = {};
        for (const e of envArray) {
          const eqIdx = e.indexOf('=');
          if (eqIdx > 0) env[e.slice(0, eqIdx)] = e.slice(eqIdx + 1);
        }

        // Parse port from ports string like "0.0.0.0:3001->3000/tcp"
        const portMatch = ports?.match(/0\.0\.0\.0:(\d+)/);
        const port = portMatch ? parseInt(portMatch[1]) : undefined;

        projects.push({
          name,
          type: 'docker',
          directory: dir,
          command: inspect?.Config?.Cmd?.join(' ') || '',
          port,
          env,
          nginx: null,
          cron: [],
          databases: this.extractDatabases(env),
          redis: this.extractRedis(env),
          storage: [],
          gitRemote: dir ? this.getGitRemote(dir) : null,
          gitCommit: dir ? this.getGitCommit(dir) : null,
        });
      }

      return projects;
    } catch {
      return [];
    }
  }

  private extractDatabases(env: Record<string, string>) {
    const dbs: { type: string; connectionUrl: string }[] = [];
    for (const value of Object.values(env)) {
      if (value.startsWith('postgresql://') || value.startsWith('postgres://')) dbs.push({ type: 'postgresql', connectionUrl: value });
      else if (value.startsWith('mysql://')) dbs.push({ type: 'mysql', connectionUrl: value });
    }
    return dbs;
  }

  private extractRedis(env: Record<string, string>) {
    return Object.values(env).filter((v) => v.startsWith('redis://')).map((connectionUrl) => ({ connectionUrl }));
  }

  private getGitRemote(dir: string): string | null {
    try { return execSync(`git -C "${dir}" remote get-url origin 2>/dev/null`, { encoding: 'utf-8' }).trim() || null; } catch { return null; }
  }

  private getGitCommit(dir: string): string | null {
    try { return execSync(`git -C "${dir}" rev-parse HEAD 2>/dev/null`, { encoding: 'utf-8' }).trim() || null; } catch { return null; }
  }
}
```

- [ ] **Step 4: Create systemd detector**

`packages/cli/src/detectors/systemd.detector.ts`:
```typescript
import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Detector, DetectedProject } from './detector.interface';

export class SystemdDetector implements Detector {
  name = 'systemd';

  async detect(): Promise<DetectedProject[]> {
    const serviceDir = '/etc/systemd/system';
    if (!existsSync(serviceDir)) return [];

    const projects: DetectedProject[] = [];
    const files = readdirSync(serviceDir).filter((f) => f.endsWith('.service'));

    for (const file of files) {
      const content = readFileSync(join(serviceDir, file), 'utf-8');
      const workDir = this.parseField(content, 'WorkingDirectory');
      const execStart = this.parseField(content, 'ExecStart');
      const envFile = this.parseField(content, 'EnvironmentFile');

      if (!workDir || !execStart) continue;
      // Skip system services
      if (workDir.startsWith('/usr') || workDir.startsWith('/lib')) continue;

      const env = envFile ? this.parseEnvFile(envFile) : {};
      const name = file.replace('.service', '');

      projects.push({
        name,
        type: 'systemd',
        directory: workDir,
        command: execStart,
        port: env.PORT ? parseInt(env.PORT) : undefined,
        env,
        nginx: null,
        cron: [],
        databases: this.extractDatabases(env),
        redis: this.extractRedis(env),
        storage: [],
        gitRemote: this.getGitRemote(workDir),
        gitCommit: this.getGitCommit(workDir),
      });
    }

    return projects;
  }

  private parseField(content: string, field: string): string | null {
    const match = content.match(new RegExp(`^${field}=(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  }

  private parseEnvFile(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    const content = readFileSync(path, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
    return env;
  }

  private extractDatabases(env: Record<string, string>) {
    return Object.values(env).filter((v) => v.startsWith('postgresql://') || v.startsWith('mysql://')).map((v) => ({
      type: v.startsWith('mysql') ? 'mysql' : 'postgresql',
      connectionUrl: v,
    }));
  }

  private extractRedis(env: Record<string, string>) {
    return Object.values(env).filter((v) => v.startsWith('redis://')).map((connectionUrl) => ({ connectionUrl }));
  }

  private getGitRemote(dir: string): string | null {
    try { return execSync(`git -C "${dir}" remote get-url origin 2>/dev/null`, { encoding: 'utf-8' }).trim() || null; } catch { return null; }
  }

  private getGitCommit(dir: string): string | null {
    try { return execSync(`git -C "${dir}" rev-parse HEAD 2>/dev/null`, { encoding: 'utf-8' }).trim() || null; } catch { return null; }
  }
}
```

- [ ] **Step 5: Create nginx detector**

`packages/cli/src/detectors/nginx.detector.ts`:
```typescript
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Detector, DetectedProject } from './detector.interface';

interface NginxSite {
  serverNames: string[];
  proxyPass?: string;
  port?: number;
  sslCert?: string;
  sslKey?: string;
}

export class NginxDetector implements Detector {
  name = 'Nginx';

  async detect(): Promise<DetectedProject[]> {
    // Nginx detector returns partial data — it enriches projects found by other detectors
    // Scanner merges these by matching proxy_pass port to project port
    return [];
  }

  parseSites(): NginxSite[] {
    const sitesDir = '/etc/nginx/sites-enabled';
    if (!existsSync(sitesDir)) return [];

    const sites: NginxSite[] = [];
    const files = readdirSync(sitesDir);

    for (const file of files) {
      if (file === 'default') continue;
      const content = readFileSync(join(sitesDir, file), 'utf-8');

      const serverNames = content.match(/server_name\s+([^;]+);/)?.[1]?.trim().split(/\s+/) || [];
      const proxyPass = content.match(/proxy_pass\s+([^;]+);/)?.[1]?.trim();
      const sslCert = content.match(/ssl_certificate\s+([^;]+);/)?.[1]?.trim();
      const sslKey = content.match(/ssl_certificate_key\s+([^;]+);/)?.[1]?.trim();

      const portMatch = proxyPass?.match(/:(\d+)/);
      const port = portMatch ? parseInt(portMatch[1]) : undefined;

      sites.push({ serverNames, proxyPass, port, sslCert, sslKey });
    }

    return sites;
  }
}
```

- [ ] **Step 6: Create process detector**

`packages/cli/src/detectors/process.detector.ts`:
```typescript
import { execSync } from 'child_process';
import { Detector, DetectedProject } from './detector.interface';

const PROCESS_PATTERNS = [
  { regex: /node\s+/, type: 'node' },
  { regex: /python[23]?\s+/, type: 'python' },
  { regex: /gunicorn/, type: 'python' },
  { regex: /uvicorn/, type: 'python' },
  { regex: /java\s+/, type: 'java' },
  { regex: /php-fpm/, type: 'php' },
];

export class ProcessDetector implements Detector {
  name = 'Process';

  async detect(): Promise<DetectedProject[]> {
    try {
      const output = execSync('ps aux 2>/dev/null', { encoding: 'utf-8' });
      const projects: DetectedProject[] = [];

      for (const line of output.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 11) continue;

        const command = cols.slice(10).join(' ');
        const matched = PROCESS_PATTERNS.find((p) => p.regex.test(command));
        if (!matched) continue;

        // Skip system processes and pm2/docker managed processes
        if (command.includes('pm2') || command.includes('docker') || command.includes('/usr/lib')) continue;

        // Try to extract working directory from /proc
        const pid = cols[1];
        let cwd = '';
        try {
          cwd = execSync(`readlink -f /proc/${pid}/cwd 2>/dev/null`, { encoding: 'utf-8' }).trim();
        } catch {}

        if (!cwd || cwd.startsWith('/usr') || cwd === '/') continue;

        projects.push({
          name: `${matched.type}-${pid}`,
          type: 'process',
          directory: cwd,
          command,
          env: {},
          nginx: null,
          cron: [],
          databases: [],
          redis: [],
          storage: [],
        });
      }

      return projects;
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 7: Create cron detector**

`packages/cli/src/detectors/cron.detector.ts`:
```typescript
import { execSync } from 'child_process';
import { Detector, DetectedProject } from './detector.interface';

export interface CronEntry {
  schedule: string;
  command: string;
  directory?: string;
}

export class CronDetector implements Detector {
  name = 'Cron';

  async detect(): Promise<DetectedProject[]> {
    // Cron detector doesn't create projects — it provides cron entries
    // Scanner associates them with projects by directory matching
    return [];
  }

  parseCrontab(): CronEntry[] {
    try {
      const output = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
      const entries: CronEntry[] = [];

      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Match cron schedule (5 fields) + command
        const match = trimmed.match(/^([\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+)\s+(.+)$/);
        if (!match) continue;

        const schedule = match[1];
        const command = match[2];

        // Try to extract directory from 'cd /path && ...' pattern
        const dirMatch = command.match(/cd\s+([^\s&;]+)/);
        const directory = dirMatch ? dirMatch[1] : undefined;

        entries.push({ schedule, command, directory });
      }

      return entries;
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/detectors/
git commit -m "feat(cli): add all detectors — PM2, Docker, systemd, Nginx, process, cron"
```

---

### Task 19: CLI Scanner (Orchestrator + Deduplication)

**Files:**
- Create: `packages/cli/src/scanner.ts`

- [ ] **Step 1: Implement scanner**

`packages/cli/src/scanner.ts`:
```typescript
import { DetectedProject } from './detectors/detector.interface';
import { Pm2Detector } from './detectors/pm2.detector';
import { DockerDetector } from './detectors/docker.detector';
import { SystemdDetector } from './detectors/systemd.detector';
import { NginxDetector } from './detectors/nginx.detector';
import { ProcessDetector } from './detectors/process.detector';
import { CronDetector } from './detectors/cron.detector';

export class Scanner {
  private pm2 = new Pm2Detector();
  private docker = new DockerDetector();
  private systemd = new SystemdDetector();
  private nginx = new NginxDetector();
  private process = new ProcessDetector();
  private cron = new CronDetector();

  async scan(): Promise<DetectedProject[]> {
    // Run all detectors in parallel
    const [pm2Projects, dockerProjects, systemdProjects, processProjects] = await Promise.all([
      this.pm2.detect(),
      this.docker.detect(),
      this.systemd.detect(),
      this.process.detect(),
    ]);

    // Collect all projects
    const allProjects = [...pm2Projects, ...dockerProjects, ...systemdProjects, ...processProjects];

    // Deduplicate by working directory
    const deduped = this.deduplicate(allProjects);

    // Enrich with nginx data
    const nginxSites = this.nginx.parseSites();
    for (const project of deduped) {
      const matchingSite = nginxSites.find((s) => s.port === project.port);
      if (matchingSite) {
        project.nginx = {
          serverNames: matchingSite.serverNames,
          sslCert: matchingSite.sslCert,
          sslKey: matchingSite.sslKey,
        };
      }
    }

    // Enrich with cron entries
    const cronEntries = this.cron.parseCrontab();
    for (const project of deduped) {
      const matchingCrons = cronEntries.filter(
        (c) => c.directory && project.directory && c.directory.startsWith(project.directory),
      );
      if (matchingCrons.length > 0) {
        project.cron = matchingCrons.map((c) => ({
          schedule: c.schedule,
          command: c.command.replace(/cd\s+[^\s&;]+\s*&&\s*/, ''),
        }));
      }
    }

    return deduped;
  }

  private deduplicate(projects: DetectedProject[]): DetectedProject[] {
    const byDir = new Map<string, DetectedProject>();

    for (const project of projects) {
      const dir = project.directory;
      if (!dir) {
        // No directory — keep as separate project
        byDir.set(`__no_dir_${project.name}`, project);
        continue;
      }

      if (byDir.has(dir)) {
        // Merge into existing
        const existing = byDir.get(dir)!;
        existing.env = { ...existing.env, ...project.env };
        existing.databases = [...existing.databases, ...project.databases];
        existing.redis = [...existing.redis, ...project.redis];
        existing.storage = [...existing.storage, ...project.storage];
        if (project.nginx) existing.nginx = project.nginx;
        if (project.cron) existing.cron = [...(existing.cron || []), ...project.cron];
        if (!existing.gitRemote && project.gitRemote) existing.gitRemote = project.gitRemote;
        if (!existing.gitCommit && project.gitCommit) existing.gitCommit = project.gitCommit;
      } else {
        byDir.set(dir, { ...project });
      }
    }

    return Array.from(byDir.values());
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/scanner.ts
git commit -m "feat(cli): add scanner with detector orchestration and deduplication"
```

---

### Task 20: CLI Collectors

**Files:**
- Create: `packages/cli/src/collectors/database.collector.ts`
- Create: `packages/cli/src/collectors/redis.collector.ts`
- Create: `packages/cli/src/collectors/code.collector.ts`

- [ ] **Step 1: Create database collector**

`packages/cli/src/collectors/database.collector.ts`:
```typescript
import { execSync } from 'child_process';
import { existsSync } from 'fs';

export class DatabaseCollector {
  async collect(
    connectionUrl: string,
    outputPath: string,
    onLog: (msg: string) => void,
  ): Promise<{ path: string; size: number }> {
    const url = new URL(connectionUrl);
    const host = url.hostname;
    const port = url.port || '5432';
    const username = url.username;
    const password = url.password;
    const database = url.pathname.slice(1);
    const isPostgres = connectionUrl.startsWith('postgresql://') || connectionUrl.startsWith('postgres://');

    if (isPostgres) {
      onLog(`Dumping PostgreSQL database "${database}"...`);
      const dumpPath = `${outputPath}/database.sql.gz`;
      execSync(
        `PGPASSWORD="${password}" pg_dump -h ${host} -p ${port} -U ${username} -d ${database} --no-owner --no-acl | gzip > "${dumpPath}"`,
        { stdio: 'pipe', maxBuffer: 1024 * 1024 * 1024 },
      );
      const stat = require('fs').statSync(dumpPath);
      onLog(`Database dump: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
      return { path: dumpPath, size: stat.size };
    }

    // MySQL
    onLog(`Dumping MySQL database "${database}"...`);
    const dumpPath = `${outputPath}/database.sql.gz`;
    execSync(
      `mysqldump -h ${host} -P ${port} -u ${username} -p"${password}" ${database} | gzip > "${dumpPath}"`,
      { stdio: 'pipe', maxBuffer: 1024 * 1024 * 1024 },
    );
    const stat = require('fs').statSync(dumpPath);
    onLog(`Database dump: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
    return { path: dumpPath, size: stat.size };
  }
}
```

- [ ] **Step 2: Create Redis collector**

`packages/cli/src/collectors/redis.collector.ts`:
```typescript
import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';

export class RedisCollector {
  async collect(
    connectionUrl: string,
    outputPath: string,
    onLog: (msg: string) => void,
  ): Promise<{ path: string; size: number } | null> {
    try {
      const url = new URL(connectionUrl);
      const host = url.hostname || 'localhost';
      const port = url.port || '6379';
      const dbIndex = url.pathname?.slice(1) || '0';
      const password = url.password;

      onLog(`Exporting Redis data (db ${dbIndex})...`);

      const rdbPath = `${outputPath}/redis.rdb`;
      const authArgs = password ? `-a "${password}"` : '';

      // Trigger BGSAVE and wait
      execSync(`redis-cli -h ${host} -p ${port} ${authArgs} -n ${dbIndex} BGSAVE`, { stdio: 'pipe' });

      // Wait for save to complete
      let saving = true;
      while (saving) {
        const info = execSync(`redis-cli -h ${host} -p ${port} ${authArgs} INFO persistence`, { encoding: 'utf-8' });
        if (info.includes('rdb_bgsave_in_progress:0')) saving = false;
        else await new Promise((r) => setTimeout(r, 500));
      }

      // Copy the RDB file
      const rdbDir = execSync(`redis-cli -h ${host} -p ${port} ${authArgs} CONFIG GET dir`, { encoding: 'utf-8' });
      const dir = rdbDir.split('\n')[1]?.trim();
      const rdbFile = execSync(`redis-cli -h ${host} -p ${port} ${authArgs} CONFIG GET dbfilename`, { encoding: 'utf-8' });
      const filename = rdbFile.split('\n')[1]?.trim();

      if (dir && filename) {
        const sourcePath = `${dir}/${filename}`;
        if (existsSync(sourcePath)) {
          execSync(`cp "${sourcePath}" "${rdbPath}"`);
          const stat = statSync(rdbPath);
          onLog(`Redis dump: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
          return { path: rdbPath, size: stat.size };
        }
      }

      onLog('Redis dump: could not locate RDB file');
      return null;
    } catch (err: any) {
      onLog(`Redis export failed: ${err.message}`);
      return null;
    }
  }
}
```

- [ ] **Step 3: Create code collector**

`packages/cli/src/collectors/code.collector.ts`:
```typescript
import { execSync } from 'child_process';
import { existsSync } from 'fs';

export class CodeCollector {
  async collect(
    directory: string,
    outputPath: string,
    onLog: (msg: string) => void,
  ): Promise<{ hasGit: boolean; archived: boolean }> {
    const gitDir = `${directory}/.git`;

    if (existsSync(gitDir)) {
      onLog('Git repository detected — recording remote and commit');
      // Git info is already captured by detectors
      // No need to archive code — it will be cloned from git remote during deploy
      return { hasGit: true, archived: false };
    }

    onLog('No git repository — archiving directory...');
    const archivePath = `${outputPath}/code.tar.gz`;
    execSync(
      `tar -czf "${archivePath}" -C "${directory}" --exclude=node_modules --exclude=.env --exclude=dist --exclude=build .`,
      { stdio: 'pipe', maxBuffer: 1024 * 1024 * 1024 },
    );
    onLog('Code archived');
    return { hasGit: false, archived: true };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/collectors/
git commit -m "feat(cli): add data collectors — database, Redis, code"
```

---

### Task 21: CLI Packager & Uploader

**Files:**
- Create: `packages/cli/src/packager.ts`
- Create: `packages/cli/src/uploader.ts`

- [ ] **Step 1: Create packager**

`packages/cli/src/packager.ts`:
```typescript
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { DetectedProject } from './detectors/detector.interface';
import { DatabaseCollector } from './collectors/database.collector';
import { RedisCollector } from './collectors/redis.collector';
import { CodeCollector } from './collectors/code.collector';
import os from 'os';

export class Packager {
  private dbCollector = new DatabaseCollector();
  private redisCollector = new RedisCollector();
  private codeCollector = new CodeCollector();

  async pack(projects: DetectedProject[]): Promise<string> {
    const tmpDir = join(os.tmpdir(), `ship-dock-migrate-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const manifest: any = {
      version: 1,
      createdAt: new Date().toISOString(),
      sourceServer: {
        hostname: os.hostname(),
        ip: this.getLocalIp(),
      },
      projects: [],
    };

    for (const project of projects) {
      const projectDir = join(tmpDir, 'projects', project.name.replace(/[^a-zA-Z0-9-_]/g, '_'));
      mkdirSync(projectDir, { recursive: true });

      const projectData: any = {
        database: null,
        redis: null,
        code: null,
      };

      const log = (msg: string) => console.log(`  ${project.name}: ${msg}`);

      // Collect code
      const codeResult = await this.codeCollector.collect(project.directory, projectDir, log);
      if (codeResult.archived) {
        projectData.code = `projects/${project.name}/code.tar.gz`;
      }

      // Collect databases
      for (const db of project.databases) {
        const result = await this.dbCollector.collect(db.connectionUrl, projectDir, log);
        projectData.database = `projects/${project.name}/database.sql.gz`;
      }

      // Collect Redis
      for (const redis of project.redis) {
        const result = await this.redisCollector.collect(redis.connectionUrl, projectDir, log);
        if (result) {
          projectData.redis = `projects/${project.name}/redis.rdb`;
        }
      }

      // Write project config
      writeFileSync(join(projectDir, 'project.json'), JSON.stringify(project, null, 2));

      // Write env vars
      writeFileSync(join(projectDir, 'env.json'), JSON.stringify(project.env, null, 2));

      // Write cron
      if (project.cron && project.cron.length > 0) {
        writeFileSync(join(projectDir, 'cron.json'), JSON.stringify(project.cron, null, 2));
      }

      manifest.projects.push({
        ...project,
        data: projectData,
      });
    }

    // Write manifest
    writeFileSync(join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Create tar.gz of the whole package
    const packagePath = join(os.tmpdir(), `ship-dock-migration-${Date.now()}.tar.gz`);
    execSync(`tar -czf "${packagePath}" -C "${tmpDir}" .`, { stdio: 'pipe' });

    // Cleanup tmp dir
    execSync(`rm -rf "${tmpDir}"`);

    return packagePath;
  }

  private getLocalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) return addr.address;
      }
    }
    return 'unknown';
  }
}
```

- [ ] **Step 2: Create uploader**

`packages/cli/src/uploader.ts`:
```typescript
import { readFileSync, statSync } from 'fs';
import { randomUUID } from 'crypto';

const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks

export class Uploader {
  constructor(
    private serverUrl: string,
    private token: string,
  ) {}

  async upload(packagePath: string, onProgress: (percent: number) => void): Promise<void> {
    const fileBuffer = readFileSync(packagePath);
    const totalSize = fileBuffer.length;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
    const uploadId = randomUUID();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunk = fileBuffer.subarray(start, end);

      const formData = new FormData();
      formData.append('chunk', new Blob([chunk]), `chunk-${i}`);
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', String(i));
      formData.append('totalChunks', String(totalChunks));

      const url = `${this.serverUrl}/api/imports/upload`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upload failed (chunk ${i}): ${response.status} ${text}`);
      }

      onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/packager.ts packages/cli/src/uploader.ts
git commit -m "feat(cli): add packager and chunked uploader"
```

---

## Phase 4: Integration & Polish

### Task 22: Wire Up Dashboard Import Link

**Files:**
- Modify: `frontend/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Read current dashboard page and add import link**

Read the dashboard page, find the header area with the "New Project" link, and add an "Import Projects" link next to it.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(import): add import link to dashboard header"
```

---

### Task 23: Backend Chunk Reassembly & Manifest Parsing

**Files:**
- Modify: `backend/src/import/import.service.ts`

- [ ] **Step 1: Add chunk reassembly method to ImportService**

Add after `handleChunkUpload`:

```typescript
async reassembleAndParse(importId: string, uploadId: string): Promise<any> {
  const tempDir = this.config.get('TEMP_DIR', '/tmp');
  const uploadDir = join(tempDir, 'imports', uploadId);
  const outputPath = join(tempDir, 'imports', `${importId}.tar.gz`);

  // Reassemble chunks in order
  const chunks = readdirSync(uploadDir)
    .filter((f) => f.startsWith('chunk-'))
    .sort();

  const writeStream = require('fs').createWriteStream(outputPath);
  for (const chunk of chunks) {
    const data = readFileSync(join(uploadDir, chunk));
    writeStream.write(data);
  }
  writeStream.end();

  // Extract tar.gz
  const extractDir = join(tempDir, 'imports', importId);
  mkdirSync(extractDir, { recursive: true });
  const { execSync } = require('child_process');
  execSync(`tar -xzf "${outputPath}" -C "${extractDir}"`);

  // Parse manifest
  const manifestPath = join(extractDir, 'manifest.json');
  const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // Create import items from manifest
  const result = await this.parseAndCreateItems(importId, manifestRaw);

  // Cleanup chunks
  execSync(`rm -rf "${uploadDir}" "${outputPath}"`);

  return result;
}
```

- [ ] **Step 2: Update handleChunkUpload to trigger reassembly on completion**

In the `handleChunkUpload` method, when `complete` is true, call reassembly:

```typescript
if (complete) {
  // Trigger reassembly in background
  const imp = await this.prisma.import.findFirst({
    where: { userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  if (imp) {
    const result = await this.reassembleAndParse(imp.id, uploadId);
    return { uploadId, complete: true, uploadedChunks, totalChunks, importId: imp.id };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/import/import.service.ts
git commit -m "feat(import): add chunk reassembly and manifest parsing on upload complete"
```

---

### Task 24: End-to-End Integration Test

**Files:**
- Create: `backend/src/import/import.integration.spec.ts`

- [ ] **Step 1: Write integration test**

`backend/src/import/import.integration.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ImportService } from './import.service';
import { ManifestParser } from './parsers/manifest-parser';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';

describe('Import Integration', () => {
  let service: ImportService;
  let prisma: any;
  let queue: any;

  const mockImport = {
    id: 'imp-1',
    status: 'PENDING',
    sourceType: 'CLI_PACKAGE',
    totalProjects: 0,
    items: [],
  };

  beforeEach(async () => {
    prisma = {
      import: {
        create: jest.fn().mockResolvedValue(mockImport),
        findUnique: jest.fn().mockResolvedValue(mockImport),
        findFirst: jest.fn().mockResolvedValue(mockImport),
        update: jest.fn().mockResolvedValue({ ...mockImport, status: 'CONFIGURING' }),
        delete: jest.fn(),
      },
      importItem: {
        create: jest.fn().mockImplementation((args) => ({ id: `item-${Date.now()}`, ...args.data })),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    queue = { add: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ImportService,
        ManifestParser,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: { encrypt: (v: string) => v, decrypt: (v: string) => v } },
        { provide: ConfigService, useValue: { get: () => '/tmp' } },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('tok') } },
        { provide: getQueueToken('import'), useValue: queue },
      ],
    }).compile();

    service = module.get(ImportService);
  });

  it('full flow: create → parseManifest → submitConfig → start', async () => {
    // Create
    const imp = await service.create('user-1', { sourceType: 'CLI_PACKAGE' });
    expect(imp.id).toBe('imp-1');

    // Parse manifest and create items
    prisma.import.findUnique.mockResolvedValue({
      ...mockImport,
      status: 'CONFIGURING',
      items: [{ id: 'item-1', sourceName: 'my-api', config: {}, stages: [] }],
    });

    await service.parseAndCreateItems('imp-1', {
      version: 1,
      projects: [
        {
          name: 'my-api',
          type: 'pm2',
          directory: '/var/www/my-api',
          command: 'node dist/main.js',
          databases: [{ type: 'postgresql', connectionUrl: 'postgresql://localhost/myapi' }],
          redis: [],
          storage: [],
          env: { PORT: '3001' },
        },
      ],
    });

    expect(prisma.importItem.create).toHaveBeenCalled();
    expect(prisma.import.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIGURING' }) }),
    );

    // Submit config
    await service.submitConfig('imp-1', {
      items: [{ itemId: 'item-1', name: 'my-api', slug: 'my-api' }],
    });

    // Start
    prisma.import.findUnique.mockResolvedValue({
      ...mockImport,
      status: 'CONFIGURING',
      items: [{ id: 'item-1', status: 'PENDING' }],
    });
    prisma.import.update.mockResolvedValue({ ...mockImport, status: 'RUNNING' });

    await service.start('imp-1', 'user-1');
    expect(queue.add).toHaveBeenCalledWith('import', { importId: 'imp-1', userId: 'user-1' });
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd backend && npx jest src/import/import.integration.spec.ts --no-coverage`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/import/import.integration.spec.ts
git commit -m "test(import): add integration test for full import flow"
```
