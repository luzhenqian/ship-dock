# Data Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to import data from existing PostgreSQL databases into ship-dock project databases via remote direct connection (SQL streaming) or SQL dump file upload.

**Architecture:** New `data-migration` NestJS module with BullMQ async processing, WebSocket real-time progress, and a multi-step frontend wizard. Remote connections use `pg` client COPY streaming; file uploads use `pg_restore`/SQL execution. Prisma models track migration and per-table status.

**Tech Stack:** NestJS, Prisma, BullMQ, pg (node-postgres), Socket.io, Next.js, React Query, shadcn/ui, Multer, MinIO

**Spec:** `docs/superpowers/specs/2026-04-05-data-migration-design.md`

---

## File Structure

### Backend (`backend/src/data-migration/`)

| File | Responsibility |
|------|---------------|
| `data-migration.module.ts` | Module registration (BullMQ queue, JWT, imports) |
| `data-migration.controller.ts` | HTTP endpoints for migrations, upload, connection testing |
| `data-migration.service.ts` | Business logic: create migration, test connection, discover tables, analyze file |
| `data-migration.processor.ts` | BullMQ processor: executes remote and file migration jobs |
| `data-migration.gateway.ts` | WebSocket gateway: join/leave migration rooms, emit progress |
| `dto/create-migration.dto.ts` | Validation DTOs for API requests |
| `remote-migrator.ts` | Remote direct connection logic: DDL extraction, COPY streaming |
| `file-migrator.ts` | File import logic: pg_restore, SQL parsing |

### Backend (modified)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add enums + DataMigration + DataMigrationTable models |
| `src/app.module.ts` | Register DataMigrationModule |

### Frontend

| File | Responsibility |
|------|---------------|
| `src/hooks/use-migrations.ts` | React Query hooks for migration API |
| `src/hooks/use-migration-logs.ts` | WebSocket hook for migration progress/logs |
| `src/components/migration-wizard.tsx` | Multi-step wizard component (source → tables → execute → complete) |
| `src/app/projects/[id]/database/page.tsx` | Add "Import Data" button (modified) |
| `src/app/projects/new/page.tsx` | Add optional "Import Data" step after creation (modified) |

---

## Task 1: Prisma Schema — Enums and Models

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add enums and models to schema.prisma**

Add to the end of `backend/prisma/schema.prisma`:

```prisma
enum MigrationSource {
  REMOTE
  FILE
}

enum MigrationStatus {
  PENDING
  CONNECTING
  ANALYZING
  MIGRATING
  COMPLETED
  FAILED
  CANCELLED
}

enum MigrationConflictStrategy {
  ERROR
  OVERWRITE
  SKIP
}

enum MigrationTableStatus {
  PENDING
  MIGRATING
  COMPLETED
  FAILED
  SKIPPED
}

model DataMigration {
  id               String                    @id @default(uuid())
  projectId        String
  project          Project                   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  source           MigrationSource
  status           MigrationStatus           @default(PENDING)
  connectionConfig String?
  fileName         String?
  fileKey          String?
  fileSize         BigInt?
  conflictStrategy MigrationConflictStrategy @default(ERROR)
  totalTables      Int                       @default(0)
  completedTables  Int                       @default(0)
  totalRows        BigInt                    @default(0)
  completedRows    BigInt                    @default(0)
  logs             Json                      @default("[]")
  errorMessage     String?
  startedAt        DateTime?
  completedAt      DateTime?
  createdAt        DateTime                  @default(now())

  tables           DataMigrationTable[]
  triggeredBy      User                      @relation(fields: [triggeredById], references: [id])
  triggeredById    String

  @@index([projectId])
}

model DataMigrationTable {
  id            String               @id @default(uuid())
  migrationId   String
  migration     DataMigration        @relation(fields: [migrationId], references: [id], onDelete: Cascade)
  tableName     String
  schemaName    String               @default("public")
  status        MigrationTableStatus @default(PENDING)
  rowCount      BigInt               @default(0)
  migratedRows  BigInt               @default(0)
  errorMessage  String?
  startedAt     DateTime?
  completedAt   DateTime?
}
```

- [ ] **Step 2: Add relations to existing models**

Add to the `Project` model (after `webhookEvents` line):

```prisma
  dataMigrations DataMigration[]
```

Add to the `User` model (after `invites` line):

```prisma
  dataMigrations DataMigration[]
```

- [ ] **Step 3: Generate and run migration**

Run:
```bash
cd backend && npx prisma migrate dev --name add_data_migration_models
```

Expected: Migration created successfully, Prisma client regenerated.

- [ ] **Step 4: Verify Prisma client**

Run:
```bash
cd backend && npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/
git commit -m "feat(data-migration): add DataMigration and DataMigrationTable Prisma models"
```

---

## Task 2: Backend — WebSocket Gateway

**Files:**
- Create: `backend/src/data-migration/data-migration.gateway.ts`

- [ ] **Step 1: Write test for gateway**

Create `backend/src/data-migration/data-migration.gateway.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataMigrationGateway } from './data-migration.gateway';

describe('DataMigrationGateway', () => {
  let gateway: DataMigrationGateway;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DataMigrationGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', role: 'ADMIN' }) } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'test-secret' } },
      ],
    }).compile();
    gateway = module.get(DataMigrationGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('emitToMigration does nothing when server is not set', () => {
    // server is undefined by default in tests
    expect(() => gateway.emitToMigration('m1', 'progress', {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=data-migration.gateway.spec --no-coverage`

Expected: FAIL — cannot find module `./data-migration.gateway`

- [ ] **Step 3: Implement the gateway**

Create `backend/src/data-migration/data-migration.gateway.ts`:

```typescript
import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class DataMigrationGateway implements OnGatewayConnection, OnGatewayDisconnect {
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

  @SubscribeMessage('join-migration')
  handleJoinMigration(client: Socket, migrationId: string) { client.join(`migration:${migrationId}`); }

  @SubscribeMessage('leave-migration')
  handleLeaveMigration(client: Socket, migrationId: string) { client.leave(`migration:${migrationId}`); }

  emitToMigration(migrationId: string, event: string, data: any) {
    if (this.server) this.server.to(`migration:${migrationId}`).emit(event, data);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=data-migration.gateway.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/data-migration/data-migration.gateway.ts backend/src/data-migration/data-migration.gateway.spec.ts
git commit -m "feat(data-migration): add WebSocket gateway for real-time migration progress"
```

---

## Task 3: Backend — DTOs

**Files:**
- Create: `backend/src/data-migration/dto/create-migration.dto.ts`

- [ ] **Step 1: Create DTOs**

Create `backend/src/data-migration/dto/create-migration.dto.ts`:

```typescript
import { IsEnum, IsString, IsOptional, IsArray, ValidateNested, IsInt, IsPort, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ConnectionConfigDto {
  @IsString()
  host: string;

  @IsInt() @Min(1) @Max(65535)
  port: number;

  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsString()
  database: string;
}

export class TestConnectionDto {
  @ValidateNested()
  @Type(() => ConnectionConfigDto)
  connection: ConnectionConfigDto;
}

export class DiscoverTablesDto {
  @ValidateNested()
  @Type(() => ConnectionConfigDto)
  connection: ConnectionConfigDto;
}

export class SelectedTableDto {
  @IsString()
  tableName: string;

  @IsString()
  @IsOptional()
  schemaName?: string = 'public';
}

export class CreateMigrationDto {
  @IsEnum(['REMOTE', 'FILE'])
  source: 'REMOTE' | 'FILE';

  @ValidateNested()
  @Type(() => ConnectionConfigDto)
  @IsOptional()
  connection?: ConnectionConfigDto;

  @IsString()
  @IsOptional()
  fileKey?: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedTableDto)
  tables: SelectedTableDto[];

  @IsEnum(['ERROR', 'OVERWRITE', 'SKIP'])
  conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP';
}

export class AnalyzeFileDto {
  @IsString()
  fileKey: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/data-migration/dto/
git commit -m "feat(data-migration): add validation DTOs for migration API"
```

---

## Task 4: Backend — Remote Migrator

This handles the SQL streaming path: connecting to a remote DB, extracting DDL, and COPY-streaming data.

**Files:**
- Create: `backend/src/data-migration/remote-migrator.ts`

- [ ] **Step 1: Write test for remote migrator**

Create `backend/src/data-migration/remote-migrator.spec.ts`:

```typescript
import { RemoteMigrator } from './remote-migrator';

describe('RemoteMigrator', () => {
  describe('buildConnectionString', () => {
    it('builds a valid connection string', () => {
      const result = RemoteMigrator.buildConnectionString({
        host: 'localhost', port: 5432, username: 'user', password: 'pass', database: 'mydb',
      });
      expect(result).toBe('postgresql://user:pass@localhost:5432/mydb');
    });

    it('encodes special characters in password', () => {
      const result = RemoteMigrator.buildConnectionString({
        host: 'localhost', port: 5432, username: 'user', password: 'p@ss/word', database: 'mydb',
      });
      expect(result).toContain(encodeURIComponent('p@ss/word'));
    });
  });

  describe('parseTableSize', () => {
    it('converts bytes to human readable', () => {
      expect(RemoteMigrator.formatBytes(1024)).toBe('1.0 KB');
      expect(RemoteMigrator.formatBytes(1048576)).toBe('1.0 MB');
      expect(RemoteMigrator.formatBytes(0)).toBe('0 B');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=remote-migrator.spec --no-coverage`

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement remote migrator**

Create `backend/src/data-migration/remote-migrator.ts`:

```typescript
import { Client } from 'pg';
import { pipeline } from 'stream/promises';
import { from as copyFrom } from 'pg-copy-streams';
import { to as copyTo } from 'pg-copy-streams';

export interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface TableInfo {
  tableName: string;
  schemaName: string;
  estimatedRows: number;
  estimatedSize: number;
  estimatedSizeFormatted: string;
}

export class RemoteMigrator {
  static buildConnectionString(config: ConnectionConfig): string {
    const password = encodeURIComponent(config.password);
    return `postgresql://${config.username}:${password}@${config.host}:${config.port}/${config.database}`;
  }

  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  static async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
    const client = new Client({ connectionString: this.buildConnectionString(config), connectionTimeoutMillis: 30000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      await client.end().catch(() => {});
    }
  }

  static async discoverTables(config: ConnectionConfig): Promise<TableInfo[]> {
    const client = new Client({ connectionString: this.buildConnectionString(config), connectionTimeoutMillis: 30000 });
    await client.connect();
    try {
      const result = await client.query(`
        SELECT
          schemaname AS "schemaName",
          relname AS "tableName",
          n_live_tup AS "estimatedRows",
          pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) AS "estimatedSize"
        FROM pg_stat_user_tables
        ORDER BY schemaname, relname
      `);
      return result.rows.map((row) => ({
        ...row,
        estimatedRows: Number(row.estimatedRows),
        estimatedSize: Number(row.estimatedSize),
        estimatedSizeFormatted: this.formatBytes(Number(row.estimatedSize)),
      }));
    } finally {
      await client.end().catch(() => {});
    }
  }

  static async getTableDDL(client: Client, schemaName: string, tableName: string): Promise<string> {
    // Get column definitions
    const cols = await client.query(`
      SELECT column_name, data_type, character_maximum_length, column_default, is_nullable,
             udt_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `, [schemaName, tableName]);

    const colDefs = cols.rows.map((c) => {
      let type = c.udt_name;
      if (c.character_maximum_length) type += `(${c.character_maximum_length})`;
      else if (c.data_type === 'numeric' && c.numeric_precision) type += `(${c.numeric_precision},${c.numeric_scale || 0})`;
      let def = `"${c.column_name}" ${type}`;
      if (c.column_default) def += ` DEFAULT ${c.column_default}`;
      if (c.is_nullable === 'NO') def += ' NOT NULL';
      return def;
    });

    // Get primary key
    const pk = await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `, [schemaName, tableName]);

    let ddl = `CREATE TABLE IF NOT EXISTS "${schemaName}"."${tableName}" (\n  ${colDefs.join(',\n  ')}`;
    if (pk.rows.length > 0) {
      ddl += `,\n  PRIMARY KEY (${pk.rows.map((r) => `"${r.column_name}"`).join(', ')})`;
    }
    ddl += '\n);';

    // Get indexes (non-primary)
    const indexes = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = $1 AND tablename = $2
      AND indexname NOT IN (
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = $1 AND table_name = $2 AND constraint_type = 'PRIMARY KEY'
      )
    `, [schemaName, tableName]);

    for (const idx of indexes.rows) {
      ddl += `\n${idx.indexdef};`;
    }

    return ddl;
  }

  static async getTableForeignKeys(client: Client, schemaName: string, tableName: string): Promise<string[]> {
    const result = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS def, conname
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE contype = 'f' AND conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
    `, [schemaName, tableName]);
    return result.rows.map((r) => `ALTER TABLE "${schemaName}"."${tableName}" ADD CONSTRAINT "${r.conname}" ${r.def};`);
  }

  static async copyTableData(
    sourceClient: Client,
    targetClient: Client,
    schemaName: string,
    tableName: string,
    onProgress: (rows: number) => void,
  ): Promise<number> {
    const qualifiedName = `"${schemaName}"."${tableName}"`;

    const sourceStream = sourceClient.query(copyTo(`COPY ${qualifiedName} TO STDOUT`));
    const targetStream = targetClient.query(copyFrom(`COPY ${qualifiedName} FROM STDIN`));

    let rowCount = 0;
    sourceStream.on('data', (chunk: Buffer) => {
      // Count newlines as approximate row count
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 10) rowCount++;
      }
    });

    await pipeline(sourceStream, targetStream);
    onProgress(rowCount);
    return rowCount;
  }

  /**
   * Get topological order of tables based on foreign key dependencies.
   * Tables that are referenced by others come first.
   */
  static async getTableOrder(
    client: Client,
    tables: Array<{ tableName: string; schemaName: string }>,
  ): Promise<Array<{ tableName: string; schemaName: string }>> {
    // Build dependency graph
    const deps = new Map<string, Set<string>>();
    const tableSet = new Set(tables.map((t) => `${t.schemaName}.${t.tableName}`));

    for (const t of tables) {
      const key = `${t.schemaName}.${t.tableName}`;
      if (!deps.has(key)) deps.set(key, new Set());

      const fks = await client.query(`
        SELECT cl2.relname AS referenced_table, n2.nspname AS referenced_schema
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_class cl2 ON cl2.oid = c.confrelid
        JOIN pg_namespace n2 ON n2.oid = cl2.relnamespace
        WHERE c.contype = 'f' AND n.nspname = $1 AND cl.relname = $2
      `, [t.schemaName, t.tableName]);

      for (const fk of fks.rows) {
        const refKey = `${fk.referenced_schema}.${fk.referenced_table}`;
        if (tableSet.has(refKey)) {
          deps.get(key)!.add(refKey);
        }
      }
    }

    // Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    for (const key of tableSet) inDegree.set(key, 0);
    for (const [, depSet] of deps) {
      for (const dep of depSet) {
        // dep must come before the table that depends on it
        // So the table with deps has higher in-degree
      }
    }
    // Recompute: inDegree counts how many tables must come before this one
    for (const [key, depSet] of deps) {
      inDegree.set(key, depSet.size);
    }

    const queue: string[] = [];
    for (const [key, degree] of inDegree) {
      if (degree === 0) queue.push(key);
    }

    const ordered: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current);
      for (const [key, depSet] of deps) {
        if (depSet.has(current)) {
          depSet.delete(current);
          inDegree.set(key, inDegree.get(key)! - 1);
          if (inDegree.get(key) === 0) queue.push(key);
        }
      }
    }

    // If there are cycles, append remaining tables
    for (const key of tableSet) {
      if (!ordered.includes(key)) ordered.push(key);
    }

    const tableMap = new Map(tables.map((t) => [`${t.schemaName}.${t.tableName}`, t]));
    return ordered.map((key) => tableMap.get(key)!);
  }
}
```

- [ ] **Step 4: Install pg-copy-streams dependency**

Run:
```bash
cd backend && npm install pg-copy-streams && npm install -D @types/pg-copy-streams
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=remote-migrator.spec --no-coverage`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/data-migration/remote-migrator.ts backend/src/data-migration/remote-migrator.spec.ts backend/package.json backend/package-lock.json
git commit -m "feat(data-migration): add remote migrator with COPY streaming and table dependency ordering"
```

---

## Task 5: Backend — File Migrator

**Files:**
- Create: `backend/src/data-migration/file-migrator.ts`

- [ ] **Step 1: Write test for file migrator**

Create `backend/src/data-migration/file-migrator.spec.ts`:

```typescript
import { FileMigrator } from './file-migrator';

describe('FileMigrator', () => {
  describe('detectFormat', () => {
    it('detects .sql as plain format', () => {
      expect(FileMigrator.detectFormat('backup.sql')).toBe('plain');
    });

    it('detects .dump as custom format', () => {
      expect(FileMigrator.detectFormat('backup.dump')).toBe('custom');
    });

    it('defaults to plain for unknown extensions', () => {
      expect(FileMigrator.detectFormat('backup.txt')).toBe('plain');
    });
  });

  describe('parseTablesFromSql', () => {
    it('extracts CREATE TABLE names from SQL', () => {
      const sql = `
        CREATE TABLE "public"."users" (id serial PRIMARY KEY);
        CREATE TABLE public.posts (id serial PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS "comments" (id serial);
      `;
      const tables = FileMigrator.parseTablesFromSql(sql);
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'users' });
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'posts' });
      expect(tables).toContainEqual({ schemaName: 'public', tableName: 'comments' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=file-migrator.spec --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement file migrator**

Create `backend/src/data-migration/file-migrator.ts`:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';

const execFileAsync = promisify(execFile);

export interface FileTableInfo {
  tableName: string;
  schemaName: string;
}

export class FileMigrator {
  static detectFormat(fileName: string): 'plain' | 'custom' {
    return fileName.endsWith('.dump') ? 'custom' : 'plain';
  }

  /**
   * Parse CREATE TABLE statements from a plain SQL file to extract table names.
   */
  static parseTablesFromSql(sql: string): FileTableInfo[] {
    const tables: FileTableInfo[] = [];
    // Match: CREATE TABLE [IF NOT EXISTS] ["schema".]"table" or schema.table
    const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql)) !== null) {
      tables.push({
        schemaName: match[1] || 'public',
        tableName: match[2],
      });
    }
    return tables;
  }

  /**
   * List tables from a pg_dump custom format file using pg_restore --list.
   */
  static async parseTablesFromDump(filePath: string): Promise<FileTableInfo[]> {
    const { stdout } = await execFileAsync('pg_restore', ['--list', filePath]);
    const tables: FileTableInfo[] = [];
    // Lines like: "123; 1259 16385 TABLE public users postgres"
    const regex = /^\d+;\s+\d+\s+\d+\s+TABLE\s+(\S+)\s+(\S+)/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(stdout)) !== null) {
      tables.push({ schemaName: match[1], tableName: match[2] });
    }
    return tables;
  }

  /**
   * Restore specific tables from a custom format dump file.
   */
  static async restoreFromDump(
    filePath: string,
    databaseUrl: string,
    tables: FileTableInfo[],
    conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP',
    onLog: (line: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const url = new URL(databaseUrl);
    const args = [
      '-h', url.hostname,
      '-p', url.port || '5432',
      '-U', url.username,
      '-d', url.pathname.slice(1), // remove leading /
      '--no-owner',
      '--no-acl',
      '--verbose',
    ];

    if (conflictStrategy === 'OVERWRITE') {
      args.push('--clean', '--if-exists');
    }

    for (const t of tables) {
      args.push('-t', `${t.schemaName}.${t.tableName}`);
    }

    args.push(filePath);

    const env = { ...process.env, PGPASSWORD: url.password };

    try {
      const { stderr } = await execFileAsync('pg_restore', args, {
        env,
        maxBuffer: 50 * 1024 * 1024,
      });
      // pg_restore outputs progress to stderr
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      return { success: true };
    } catch (err: any) {
      // pg_restore exits with non-zero on warnings too
      if (err.stderr) {
        for (const line of err.stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      // Check if it's just warnings or actual errors
      if (err.code === 1 && conflictStrategy === 'SKIP') {
        return { success: true }; // Warnings are OK for SKIP mode
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Execute plain SQL file against the target database, optionally filtering tables.
   */
  static async restoreFromSql(
    filePath: string,
    databaseUrl: string,
    tables: FileTableInfo[],
    conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP',
    onLog: (line: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const url = new URL(databaseUrl);
    const env = { ...process.env, PGPASSWORD: url.password };
    const tableSet = new Set(tables.map((t) => `${t.schemaName}.${t.tableName}`));

    // For plain SQL, use psql to execute
    // First, if OVERWRITE, drop the selected tables
    if (conflictStrategy === 'OVERWRITE') {
      const dropArgs = [
        '-h', url.hostname,
        '-p', url.port || '5432',
        '-U', url.username,
        '-d', url.pathname.slice(1),
        '-c', tables.map((t) => `DROP TABLE IF EXISTS "${t.schemaName}"."${t.tableName}" CASCADE`).join('; ') + ';',
      ];
      try {
        await execFileAsync('psql', dropArgs, { env });
        onLog('Dropped existing tables for overwrite');
      } catch (err: any) {
        onLog(`Warning: ${err.message}`);
      }
    }

    // Execute the SQL file via psql
    // For table filtering with plain SQL, we use psql with the full file
    // (pg_restore table filtering only works with custom format)
    const args = [
      '-h', url.hostname,
      '-p', url.port || '5432',
      '-U', url.username,
      '-d', url.pathname.slice(1),
      '-f', filePath,
      '-v', 'ON_ERROR_STOP=' + (conflictStrategy === 'ERROR' ? '1' : '0'),
    ];

    try {
      const { stderr } = await execFileAsync('psql', args, {
        env,
        maxBuffer: 50 * 1024 * 1024,
      });
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      return { success: true };
    } catch (err: any) {
      if (err.stderr) {
        for (const line of err.stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      return { success: false, error: err.message };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=file-migrator.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/data-migration/file-migrator.ts backend/src/data-migration/file-migrator.spec.ts
git commit -m "feat(data-migration): add file migrator with pg_restore and SQL execution"
```

---

## Task 6: Backend — Migration Service

**Files:**
- Create: `backend/src/data-migration/data-migration.service.ts`

- [ ] **Step 1: Write test for service**

Create `backend/src/data-migration/data-migration.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { DataMigrationService } from './data-migration.service';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';

describe('DataMigrationService', () => {
  let service: DataMigrationService;
  let prisma: any;
  let queue: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = {
      dataMigration: {
        create: jest.fn().mockResolvedValue({ id: 'mig-1', status: 'PENDING' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'mig-1', status: 'PENDING' }),
        update: jest.fn().mockResolvedValue({ id: 'mig-1', status: 'CANCELLED' }),
      },
      dataMigrationTable: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', dbName: 'test_db', useLocalDb: true }),
      },
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    encryption = {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn((v: string) => v.replace('enc:', '')),
    };

    const module = await Test.createTestingModule({
      providers: [
        DataMigrationService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('data-migration'), useValue: queue },
        { provide: EncryptionService, useValue: encryption },
        { provide: ConfigService, useValue: { getOrThrow: () => 'postgresql://u:p@localhost:5432/main' } },
      ],
    }).compile();
    service = module.get(DataMigrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a remote migration and enqueues a job', async () => {
    const result = await service.createMigration('p1', 'u1', {
      source: 'REMOTE',
      connection: { host: 'remote', port: 5432, username: 'user', password: 'pass', database: 'src' },
      tables: [{ tableName: 'users', schemaName: 'public' }],
      conflictStrategy: 'ERROR',
    });
    expect(prisma.dataMigration.create).toHaveBeenCalled();
    expect(prisma.dataMigrationTable.createMany).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('data-migration', expect.objectContaining({ migrationId: 'mig-1' }));
    expect(result.id).toBe('mig-1');
  });

  it('cancels a pending migration', async () => {
    await service.cancelMigration('mig-1');
    expect(prisma.dataMigration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'mig-1' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });

  it('throws if project has no local db', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', useLocalDb: false });
    await expect(service.createMigration('p1', 'u1', {
      source: 'REMOTE',
      connection: { host: 'h', port: 5432, username: 'u', password: 'p', database: 'd' },
      tables: [{ tableName: 't' }],
      conflictStrategy: 'ERROR',
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=data-migration.service.spec --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement the service**

Create `backend/src/data-migration/data-migration.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { CreateMigrationDto, AnalyzeFileDto, ConnectionConfigDto } from './dto/create-migration.dto';
import { RemoteMigrator } from './remote-migrator';
import { FileMigrator } from './file-migrator';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB

@Injectable()
export class DataMigrationService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('data-migration') private migrationQueue: Queue,
    private encryption: EncryptionService,
    private config: ConfigService,
  ) {}

  async testConnection(connection: ConnectionConfigDto) {
    return RemoteMigrator.testConnection(connection);
  }

  async discoverTables(connection: ConnectionConfigDto) {
    const tables = await RemoteMigrator.discoverTables(connection);
    const totalSize = tables.reduce((sum, t) => sum + t.estimatedSize, 0);
    return {
      tables,
      totalSize,
      totalSizeFormatted: RemoteMigrator.formatBytes(totalSize),
      exceedsLimit: totalSize > MAX_SIZE_BYTES,
    };
  }

  async analyzeFile(dto: AnalyzeFileDto) {
    // Download file from MinIO temp storage to analyze
    // For now, files are stored at a temp path during upload
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const filePath = join(tempDir, dto.fileKey);
    const format = FileMigrator.detectFormat(dto.fileKey);

    if (format === 'custom') {
      const tables = await FileMigrator.parseTablesFromDump(filePath);
      return { tables, format };
    } else {
      const sql = readFileSync(filePath, 'utf-8');
      const tables = FileMigrator.parseTablesFromSql(sql);
      return { tables, format };
    }
  }

  async createMigration(projectId: string, userId: string, dto: CreateMigrationDto) {
    // Verify project has a local database
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.useLocalDb || !project.dbName) {
      throw new BadRequestException('Project does not have a platform database. Provision one first.');
    }

    // Check no active migration
    const active = await this.prisma.dataMigration.findFirst({
      where: { projectId, status: { in: ['PENDING', 'CONNECTING', 'ANALYZING', 'MIGRATING'] } },
    });
    if (active) throw new BadRequestException('A migration is already in progress for this project');

    // Validate size for remote
    if (dto.source === 'REMOTE' && dto.connection) {
      const tables = await RemoteMigrator.discoverTables(dto.connection);
      const selectedNames = new Set(dto.tables.map((t) => `${t.schemaName || 'public'}.${t.tableName}`));
      const selectedTables = tables.filter((t) => selectedNames.has(`${t.schemaName}.${t.tableName}`));
      const totalSize = selectedTables.reduce((sum, t) => sum + t.estimatedSize, 0);
      if (totalSize > MAX_SIZE_BYTES) {
        throw new BadRequestException(`Selected tables exceed 1GB limit (${RemoteMigrator.formatBytes(totalSize)})`);
      }
    }

    const migration = await this.prisma.dataMigration.create({
      data: {
        projectId,
        triggeredById: userId,
        source: dto.source,
        connectionConfig: dto.connection ? this.encryption.encrypt(JSON.stringify(dto.connection)) : null,
        fileKey: dto.fileKey,
        fileName: dto.fileName,
        conflictStrategy: dto.conflictStrategy,
        totalTables: dto.tables.length,
      },
    });

    await this.prisma.dataMigrationTable.createMany({
      data: dto.tables.map((t) => ({
        migrationId: migration.id,
        tableName: t.tableName,
        schemaName: t.schemaName || 'public',
      })),
    });

    await this.migrationQueue.add('data-migration', {
      migrationId: migration.id,
      projectId,
    });

    return migration;
  }

  async getMigrations(projectId: string) {
    return this.prisma.dataMigration.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
  }

  async getMigration(migrationId: string) {
    const migration = await this.prisma.dataMigration.findUnique({
      where: { id: migrationId },
      include: { tables: true, triggeredBy: { select: { id: true, name: true } } },
    });
    if (!migration) throw new NotFoundException('Migration not found');
    return migration;
  }

  async cancelMigration(migrationId: string) {
    const migration = await this.prisma.dataMigration.findUnique({ where: { id: migrationId } });
    if (!migration) throw new NotFoundException('Migration not found');
    if (!['PENDING', 'CONNECTING', 'ANALYZING', 'MIGRATING'].includes(migration.status)) {
      throw new BadRequestException('Can only cancel active migrations');
    }
    return this.prisma.dataMigration.update({
      where: { id: migrationId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=data-migration.service.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/data-migration/data-migration.service.ts backend/src/data-migration/data-migration.service.spec.ts
git commit -m "feat(data-migration): add migration service with create, cancel, discover operations"
```

---

## Task 7: Backend — Migration Processor (BullMQ)

**Files:**
- Create: `backend/src/data-migration/data-migration.processor.ts`

- [ ] **Step 1: Write test for processor**

Create `backend/src/data-migration/data-migration.processor.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { DataMigrationProcessor } from './data-migration.processor';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { DataMigrationGateway } from './data-migration.gateway';

describe('DataMigrationProcessor', () => {
  let processor: DataMigrationProcessor;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DataMigrationProcessor,
        {
          provide: PrismaService,
          useValue: {
            dataMigration: { findUnique: jest.fn(), update: jest.fn() },
            dataMigrationTable: { findMany: jest.fn(), update: jest.fn() },
            project: { findUnique: jest.fn() },
          },
        },
        { provide: EncryptionService, useValue: { decrypt: jest.fn((v) => v) } },
        { provide: ConfigService, useValue: { get: () => '/tmp', getOrThrow: () => 'postgresql://u:p@localhost:5432/main' } },
        { provide: DataMigrationGateway, useValue: { emitToMigration: jest.fn() } },
      ],
    }).compile();
    processor = module.get(DataMigrationProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --testPathPattern=data-migration.processor.spec --no-coverage`

Expected: FAIL

- [ ] **Step 3: Implement the processor**

Create `backend/src/data-migration/data-migration.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { DataMigrationGateway } from './data-migration.gateway';
import { RemoteMigrator, ConnectionConfig } from './remote-migrator';
import { FileMigrator } from './file-migrator';
import { Client } from 'pg';
import { join } from 'path';

@Processor('data-migration')
export class DataMigrationProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
    private gateway: DataMigrationGateway,
  ) {
    super();
  }

  async process(job: Job<{ migrationId: string; projectId: string }>) {
    const { migrationId, projectId } = job.data;

    const migration = await this.prisma.dataMigration.findUnique({
      where: { id: migrationId },
      include: { tables: true },
    });
    if (!migration || migration.status === 'CANCELLED') return;

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || !project.dbName) return;

    const targetUrl = this.buildTargetUrl(project.dbName);

    try {
      if (migration.source === 'REMOTE') {
        await this.processRemoteMigration(migration, targetUrl);
      } else {
        await this.processFileMigration(migration, targetUrl);
      }
    } catch (err: any) {
      await this.updateMigrationStatus(migrationId, 'FAILED', err.message);
      this.log(migrationId, 'error', `Migration failed: ${err.message}`);
    }
  }

  private async processRemoteMigration(migration: any, targetUrl: string) {
    const migrationId = migration.id;
    const config: ConnectionConfig = JSON.parse(this.encryption.decrypt(migration.connectionConfig));

    // Phase 1: Connect
    await this.updateMigrationStatus(migrationId, 'CONNECTING');
    this.log(migrationId, 'info', 'Connecting to source database...');

    const sourceUrl = RemoteMigrator.buildConnectionString(config);
    const sourceClient = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 30000 });
    const targetClient = new Client({ connectionString: targetUrl });

    try {
      await sourceClient.connect();
      await targetClient.connect();
      this.log(migrationId, 'info', 'Connected to both source and target databases');

      // Phase 2: Analyze and order tables
      await this.updateMigrationStatus(migrationId, 'ANALYZING');
      const orderedTables = await RemoteMigrator.getTableOrder(
        sourceClient,
        migration.tables.map((t: any) => ({ tableName: t.tableName, schemaName: t.schemaName })),
      );
      this.log(migrationId, 'info', `Migration order: ${orderedTables.map((t) => t.tableName).join(' → ')}`);

      // Phase 3: Migrate
      await this.updateMigrationStatus(migrationId, 'MIGRATING');
      const allForeignKeys: string[] = [];
      let completedTables = 0;
      let completedRows = BigInt(0);

      for (const table of orderedTables) {
        const migTable = migration.tables.find(
          (t: any) => t.tableName === table.tableName && t.schemaName === table.schemaName,
        );
        if (!migTable) continue;

        // Check if cancelled
        const current = await this.prisma.dataMigration.findUnique({ where: { id: migrationId } });
        if (current?.status === 'CANCELLED') {
          this.log(migrationId, 'info', 'Migration cancelled by user');
          return;
        }

        const qualifiedName = `"${table.schemaName}"."${table.tableName}"`;
        this.log(migrationId, 'info', `Migrating table ${qualifiedName}...`);
        await this.prisma.dataMigrationTable.update({
          where: { id: migTable.id },
          data: { status: 'MIGRATING', startedAt: new Date() },
        });
        this.emitProgress(migrationId, completedTables, migration.tables.length, migTable.tableName);

        try {
          // Check conflict
          const existsResult = await targetClient.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)`,
            [table.schemaName, table.tableName],
          );
          const tableExists = existsResult.rows[0].exists;

          if (tableExists) {
            if (migration.conflictStrategy === 'ERROR') {
              throw new Error(`Table ${qualifiedName} already exists in target database`);
            } else if (migration.conflictStrategy === 'SKIP') {
              this.log(migrationId, 'info', `Skipping ${qualifiedName} (already exists)`);
              await this.prisma.dataMigrationTable.update({
                where: { id: migTable.id },
                data: { status: 'SKIPPED', completedAt: new Date() },
              });
              completedTables++;
              continue;
            } else {
              // OVERWRITE
              this.log(migrationId, 'info', `Dropping existing ${qualifiedName} for overwrite`);
              await targetClient.query(`DROP TABLE IF EXISTS ${qualifiedName} CASCADE`);
            }
          }

          // Create table DDL
          const ddl = await RemoteMigrator.getTableDDL(sourceClient, table.schemaName, table.tableName);
          await targetClient.query(ddl);
          this.log(migrationId, 'info', `Created table structure for ${qualifiedName}`);

          // Collect foreign keys for later
          const fks = await RemoteMigrator.getTableForeignKeys(sourceClient, table.schemaName, table.tableName);
          allForeignKeys.push(...fks);

          // Copy data
          const rowsCopied = await RemoteMigrator.copyTableData(
            sourceClient, targetClient, table.schemaName, table.tableName,
            (rows) => {
              completedRows += BigInt(rows);
              this.emitProgress(migrationId, completedTables, migration.tables.length, migTable.tableName);
            },
          );

          this.log(migrationId, 'info', `Copied ${rowsCopied} rows for ${qualifiedName}`);
          await this.prisma.dataMigrationTable.update({
            where: { id: migTable.id },
            data: { status: 'COMPLETED', migratedRows: rowsCopied, completedAt: new Date() },
          });
          completedTables++;

          await this.prisma.dataMigration.update({
            where: { id: migrationId },
            data: { completedTables, completedRows },
          });
        } catch (err: any) {
          this.log(migrationId, 'error', `Failed to migrate ${qualifiedName}: ${err.message}`);
          await this.prisma.dataMigrationTable.update({
            where: { id: migTable.id },
            data: { status: 'FAILED', errorMessage: err.message, completedAt: new Date() },
          });
          completedTables++;
        }
      }

      // Restore foreign keys
      if (allForeignKeys.length > 0) {
        this.log(migrationId, 'info', `Restoring ${allForeignKeys.length} foreign key constraints...`);
        for (const fk of allForeignKeys) {
          try {
            await targetClient.query(fk);
          } catch (err: any) {
            this.log(migrationId, 'warn', `Failed to restore FK: ${err.message}`);
          }
        }
      }

      // Final status
      const failedCount = migration.tables.filter(
        (t: any) => t.status === 'FAILED',
      ).length;
      // Re-query to get updated statuses
      const updatedTables = await this.prisma.dataMigrationTable.findMany({
        where: { migrationId },
      });
      const failed = updatedTables.filter((t) => t.status === 'FAILED').length;
      const skipped = updatedTables.filter((t) => t.status === 'SKIPPED').length;
      const succeeded = updatedTables.filter((t) => t.status === 'COMPLETED').length;

      this.log(migrationId, 'info', `Migration complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
      await this.updateMigrationStatus(migrationId, failed > 0 ? 'FAILED' : 'COMPLETED');
    } finally {
      await sourceClient.end().catch(() => {});
      await targetClient.end().catch(() => {});
    }
  }

  private async processFileMigration(migration: any, targetUrl: string) {
    const migrationId = migration.id;
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const filePath = join(tempDir, migration.fileKey);
    const format = FileMigrator.detectFormat(migration.fileKey || migration.fileName || '');

    await this.updateMigrationStatus(migrationId, 'MIGRATING');
    this.log(migrationId, 'info', `Starting file import (${format} format)...`);

    const tables = migration.tables.map((t: any) => ({
      tableName: t.tableName,
      schemaName: t.schemaName,
    }));

    const onLog = (line: string) => this.log(migrationId, 'info', line);

    let result: { success: boolean; error?: string };
    if (format === 'custom') {
      result = await FileMigrator.restoreFromDump(filePath, targetUrl, tables, migration.conflictStrategy, onLog);
    } else {
      result = await FileMigrator.restoreFromSql(filePath, targetUrl, tables, migration.conflictStrategy, onLog);
    }

    // Mark all tables as completed or failed
    for (const migTable of migration.tables) {
      await this.prisma.dataMigrationTable.update({
        where: { id: migTable.id },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          errorMessage: result.success ? null : result.error,
          completedAt: new Date(),
        },
      });
    }

    await this.updateMigrationStatus(migrationId, result.success ? 'COMPLETED' : 'FAILED', result.error);

    // Clean up temp file
    try {
      const { unlinkSync } = require('fs');
      unlinkSync(filePath);
    } catch {}
  }

  private buildTargetUrl(dbName: string): string {
    const adminUrl = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    return `postgresql://${adminUrl.username}:${adminUrl.password}@${adminUrl.hostname}:${adminUrl.port || 5432}/${dbName}`;
  }

  private async updateMigrationStatus(migrationId: string, status: string, errorMessage?: string) {
    const data: any = { status };
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      data.completedAt = new Date();
    }
    if (status === 'MIGRATING' || status === 'CONNECTING') {
      data.startedAt = new Date();
    }
    if (errorMessage) data.errorMessage = errorMessage;
    await this.prisma.dataMigration.update({ where: { id: migrationId }, data });
    this.gateway.emitToMigration(migrationId, 'migration:status', { status, errorMessage });
  }

  private log(migrationId: string, level: string, message: string) {
    this.gateway.emitToMigration(migrationId, 'migration:log', {
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }

  private emitProgress(migrationId: string, completedTables: number, totalTables: number, currentTable: string) {
    this.gateway.emitToMigration(migrationId, 'migration:progress', {
      completedTables,
      totalTables,
      currentTable,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --testPathPattern=data-migration.processor.spec --no-coverage`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/data-migration/data-migration.processor.ts backend/src/data-migration/data-migration.processor.spec.ts
git commit -m "feat(data-migration): add BullMQ processor for remote and file migration execution"
```

---

## Task 8: Backend — Controller

**Files:**
- Create: `backend/src/data-migration/data-migration.controller.ts`

- [ ] **Step 1: Implement the controller**

Create `backend/src/data-migration/data-migration.controller.ts`:

```typescript
import {
  Controller, Get, Post, Param, Body, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DataMigrationService } from './data-migration.service';
import { CreateMigrationDto, TestConnectionDto, DiscoverTablesDto, AnalyzeFileDto } from './dto/create-migration.dto';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

@Controller('projects/:projectId/migrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataMigrationController {
  constructor(
    private migrationService: DataMigrationService,
    private config: ConfigService,
  ) {}

  @Post('test-connection') @MinRole('DEVELOPER')
  testConnection(@Body() dto: TestConnectionDto) {
    return this.migrationService.testConnection(dto.connection);
  }

  @Post('discover-tables') @MinRole('DEVELOPER')
  discoverTables(@Body() dto: DiscoverTablesDto) {
    return this.migrationService.discoverTables(dto.connection);
  }

  @Post('upload') @MinRole('DEVELOPER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!['sql', 'dump'].includes(ext || '')) {
      throw new BadRequestException('Only .sql and .dump files are supported');
    }

    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const fileKey = `migration-${randomBytes(8).toString('hex')}.${ext}`;
    const filePath = join(tempDir, fileKey);
    writeFileSync(filePath, file.buffer);

    return { fileKey, fileName: file.originalname, fileSize: file.size };
  }

  @Post('analyze-file') @MinRole('DEVELOPER')
  analyzeFile(@Body() dto: AnalyzeFileDto) {
    return this.migrationService.analyzeFile(dto);
  }

  @Post() @MinRole('DEVELOPER')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMigrationDto,
    @Req() req: any,
  ) {
    return this.migrationService.createMigration(projectId, req.user.id, dto);
  }

  @Get() @MinRole('VIEWER')
  list(@Param('projectId') projectId: string) {
    return this.migrationService.getMigrations(projectId);
  }

  @Get(':migrationId') @MinRole('VIEWER')
  getOne(@Param('migrationId') migrationId: string) {
    return this.migrationService.getMigration(migrationId);
  }

  @Post(':migrationId/cancel') @MinRole('DEVELOPER')
  cancel(@Param('migrationId') migrationId: string) {
    return this.migrationService.cancelMigration(migrationId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/data-migration/data-migration.controller.ts
git commit -m "feat(data-migration): add controller with upload, connection test, and CRUD endpoints"
```

---

## Task 9: Backend — Module Registration

**Files:**
- Create: `backend/src/data-migration/data-migration.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create the module**

Create `backend/src/data-migration/data-migration.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { DataMigrationController } from './data-migration.controller';
import { DataMigrationService } from './data-migration.service';
import { DataMigrationProcessor } from './data-migration.processor';
import { DataMigrationGateway } from './data-migration.gateway';

@Module({
  imports: [BullModule.registerQueue({ name: 'data-migration' }), JwtModule.register({})],
  controllers: [DataMigrationController],
  providers: [DataMigrationService, DataMigrationProcessor, DataMigrationGateway],
  exports: [DataMigrationService],
})
export class DataMigrationModule {}
```

- [ ] **Step 2: Register in app.module.ts**

In `backend/src/app.module.ts`, add the import:

```typescript
import { DataMigrationModule } from './data-migration/data-migration.module';
```

Add `DataMigrationModule` to the `imports` array (after `WebhooksModule`).

- [ ] **Step 3: Verify the backend compiles**

Run:
```bash
cd backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Run all data-migration tests**

Run:
```bash
cd backend && npx jest --testPathPattern=data-migration --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/data-migration/data-migration.module.ts backend/src/app.module.ts
git commit -m "feat(data-migration): register DataMigrationModule in app"
```

---

## Task 10: Frontend — API Hooks

**Files:**
- Create: `frontend/src/hooks/use-migrations.ts`

- [ ] **Step 1: Create migration hooks**

Create `frontend/src/hooks/use-migrations.ts`:

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiRaw } from '@/lib/api';

interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

interface SelectedTable {
  tableName: string;
  schemaName?: string;
}

interface CreateMigrationDto {
  source: 'REMOTE' | 'FILE';
  connection?: ConnectionConfig;
  fileKey?: string;
  fileName?: string;
  tables: SelectedTable[];
  conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP';
}

export function useMigrations(projectId: string) {
  return useQuery({
    queryKey: ['migrations', projectId],
    queryFn: () => api(`/projects/${projectId}/migrations`),
  });
}

export function useMigration(projectId: string, migrationId: string) {
  return useQuery({
    queryKey: ['migrations', projectId, migrationId],
    queryFn: () => api(`/projects/${projectId}/migrations/${migrationId}`),
    enabled: !!migrationId,
  });
}

export function useTestConnection(projectId: string) {
  return useMutation({
    mutationFn: (connection: ConnectionConfig) =>
      api(`/projects/${projectId}/migrations/test-connection`, {
        method: 'POST',
        body: JSON.stringify({ connection }),
      }),
  });
}

export function useDiscoverTables(projectId: string) {
  return useMutation({
    mutationFn: (connection: ConnectionConfig) =>
      api(`/projects/${projectId}/migrations/discover-tables`, {
        method: 'POST',
        body: JSON.stringify({ connection }),
      }),
  });
}

export function useUploadDump(projectId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiRaw(`/projects/${projectId}/migrations/upload`, {
        method: 'POST',
        body: formData,
      });
      return res.json();
    },
  });
}

export function useAnalyzeFile(projectId: string) {
  return useMutation({
    mutationFn: (fileKey: string) =>
      api(`/projects/${projectId}/migrations/analyze-file`, {
        method: 'POST',
        body: JSON.stringify({ fileKey }),
      }),
  });
}

export function useCreateMigration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateMigrationDto) =>
      api(`/projects/${projectId}/migrations`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migrations', projectId] }),
  });
}

export function useCancelMigration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (migrationId: string) =>
      api(`/projects/${projectId}/migrations/${migrationId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migrations', projectId] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-migrations.ts
git commit -m "feat(data-migration): add React Query hooks for migration API"
```

---

## Task 11: Frontend — WebSocket Hook

**Files:**
- Create: `frontend/src/hooks/use-migration-logs.ts`

- [ ] **Step 1: Create migration WebSocket hook**

Create `frontend/src/hooks/use-migration-logs.ts`:

```typescript
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket } from '@/lib/socket';

interface MigrationLog {
  timestamp: string;
  level: string;
  message: string;
}

interface MigrationProgress {
  completedTables: number;
  totalTables: number;
  currentTable: string;
}

export function useMigrationLogs(migrationId: string) {
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [status, setStatus] = useState<string>('');
  const socketRef = useRef(connectSocket());
  const onCompleteRef = useRef<(() => void) | null>(null);

  const onComplete = useCallback((cb: () => void) => {
    onCompleteRef.current = cb;
  }, []);

  useEffect(() => {
    const socket = socketRef.current;

    const joinRoom = () => {
      socket.emit('join-migration', migrationId);
    };

    joinRoom();
    socket.on('connect', joinRoom);

    socket.on('migration:log', (data: MigrationLog) => {
      setLogs((prev) => [...prev, data]);
    });

    socket.on('migration:progress', (data: MigrationProgress) => {
      setProgress(data);
    });

    socket.on('migration:status', (data: { status: string; errorMessage?: string }) => {
      setStatus(data.status);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) {
        onCompleteRef.current?.();
      }
    });

    return () => {
      socket.emit('leave-migration', migrationId);
      socket.off('connect', joinRoom);
      socket.off('migration:log');
      socket.off('migration:progress');
      socket.off('migration:status');
    };
  }, [migrationId]);

  return { logs, progress, status, onComplete };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-migration-logs.ts
git commit -m "feat(data-migration): add WebSocket hook for migration progress and logs"
```

---

## Task 12: Frontend — Migration Wizard Component

**Files:**
- Create: `frontend/src/components/migration-wizard.tsx`

- [ ] **Step 1: Create the migration wizard component**

Create `frontend/src/components/migration-wizard.tsx`:

```tsx
'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  useTestConnection, useDiscoverTables, useUploadDump, useAnalyzeFile, useCreateMigration, useCancelMigration,
} from '@/hooks/use-migrations';
import { useMigrationLogs } from '@/hooks/use-migration-logs';
import { Database, Upload, Check, X, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

type Step = 'source' | 'tables' | 'execute' | 'complete';
type SourceMode = 'REMOTE' | 'FILE' | '';
type ConflictStrategy = 'ERROR' | 'OVERWRITE' | 'SKIP';

interface TableInfo {
  tableName: string;
  schemaName: string;
  estimatedRows?: number;
  estimatedSize?: number;
  estimatedSizeFormatted?: string;
}

interface MigrationWizardProps {
  projectId: string;
  onClose: () => void;
}

export function MigrationWizard({ projectId, onClose }: MigrationWizardProps) {
  const [step, setStep] = useState<Step>('source');
  const [sourceMode, setSourceMode] = useState<SourceMode>('');
  const [connection, setConnection] = useState({
    host: '', port: 5432, username: '', password: '', database: '',
  });
  const [fileKey, setFileKey] = useState('');
  const [fileName, setFileName] = useState('');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('ERROR');
  const [migrationId, setMigrationId] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  const testConnection = useTestConnection(projectId);
  const discoverTables = useDiscoverTables(projectId);
  const uploadDump = useUploadDump(projectId);
  const analyzeFile = useAnalyzeFile(projectId);
  const createMigration = useCreateMigration(projectId);
  const cancelMigration = useCancelMigration(projectId);
  const { logs, progress, status, onComplete } = useMigrationLogs(migrationId);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Source Step ---
  const handleTestConnection = async () => {
    setConnectionError('');
    const result = await testConnection.mutateAsync(connection);
    if (!result.success) {
      setConnectionError(result.error || 'Connection failed');
      return;
    }
    const discovered = await discoverTables.mutateAsync(connection);
    setTables(discovered.tables);
    setSelectedTables(new Set(discovered.tables.map((t: TableInfo) => `${t.schemaName}.${t.tableName}`)));
    setStep('tables');
  };

  const handleFileUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['sql', 'dump'].includes(ext || '')) {
      setConnectionError('Only .sql and .dump files are supported');
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      setConnectionError('File exceeds 1GB limit');
      return;
    }
    setConnectionError('');
    const result = await uploadDump.mutateAsync(file);
    setFileKey(result.fileKey);
    setFileName(result.fileName);
    const analyzed = await analyzeFile.mutateAsync(result.fileKey);
    setTables(analyzed.tables.map((t: any) => ({ ...t, estimatedRows: 0, estimatedSize: 0, estimatedSizeFormatted: '-' })));
    setSelectedTables(new Set(analyzed.tables.map((t: any) => `${t.schemaName}.${t.tableName}`)));
    setStep('tables');
  };

  // --- Tables Step ---
  const toggleTable = (key: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(tables.map((t) => `${t.schemaName}.${t.tableName}`)));
    }
  };

  const selectedSize = tables
    .filter((t) => selectedTables.has(`${t.schemaName}.${t.tableName}`))
    .reduce((sum, t) => sum + (t.estimatedSize || 0), 0);

  const exceedsLimit = selectedSize > 1024 * 1024 * 1024;

  const handleStartMigration = async () => {
    const selectedTableList = tables
      .filter((t) => selectedTables.has(`${t.schemaName}.${t.tableName}`))
      .map((t) => ({ tableName: t.tableName, schemaName: t.schemaName }));

    const result = await createMigration.mutateAsync({
      source: sourceMode as 'REMOTE' | 'FILE',
      connection: sourceMode === 'REMOTE' ? connection : undefined,
      fileKey: sourceMode === 'FILE' ? fileKey : undefined,
      fileName: sourceMode === 'FILE' ? fileName : undefined,
      tables: selectedTableList,
      conflictStrategy,
    });

    setMigrationId(result.id);
    setStep('execute');
  };

  // --- Render ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Import Data</h2>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 text-sm text-muted-foreground">
        {(['source', 'tables', 'execute', 'complete'] as const).map((s, i) => (
          <span key={s} className={step === s ? 'text-foreground font-medium' : ''}>
            {i > 0 && ' → '}{s === 'source' ? 'Data Source' : s === 'tables' ? 'Select Tables' : s === 'execute' ? 'Migrating' : 'Complete'}
          </span>
        ))}
      </div>

      {/* Step 1: Source */}
      {step === 'source' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'REMOTE' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => { setSourceMode('REMOTE'); setConnectionError(''); }}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Database className="h-8 w-8" />
                <p className="font-medium">Remote Database</p>
                <p className="text-xs text-muted-foreground">Connect directly to a PostgreSQL database</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'FILE' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => { setSourceMode('FILE'); setConnectionError(''); }}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Upload className="h-8 w-8" />
                <p className="font-medium">Upload File</p>
                <p className="text-xs text-muted-foreground">Import from .sql or .dump file</p>
              </CardContent>
            </Card>
          </div>

          {sourceMode === 'REMOTE' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Host</Label>
                  <Input value={connection.host} onChange={(e) => setConnection({ ...connection, host: e.target.value })} placeholder="localhost" />
                </div>
                <div>
                  <Label>Port</Label>
                  <Input type="number" value={connection.port} onChange={(e) => setConnection({ ...connection, port: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username</Label>
                  <Input value={connection.username} onChange={(e) => setConnection({ ...connection, username: e.target.value })} />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input type="password" value={connection.password} onChange={(e) => setConnection({ ...connection, password: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Database</Label>
                <Input value={connection.database} onChange={(e) => setConnection({ ...connection, database: e.target.value })} />
              </div>
              {connectionError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {connectionError}
                </p>
              )}
              <Button
                onClick={handleTestConnection}
                disabled={!connection.host || !connection.username || !connection.database || testConnection.isPending || discoverTables.isPending}
              >
                {(testConnection.isPending || discoverTables.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Test Connection & Discover Tables
              </Button>
            </div>
          )}

          {sourceMode === 'FILE' && (
            <div className="space-y-3">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileUpload(file);
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {uploadDump.isPending || analyzeFile.isPending ? 'Uploading and analyzing...' : 'Click or drag and drop a .sql or .dump file (max 1GB)'}
                </p>
                {(uploadDump.isPending || analyzeFile.isPending) && <Loader2 className="h-4 w-4 mx-auto mt-2 animate-spin" />}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".sql,.dump"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
              {connectionError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {connectionError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Tables */}
      {step === 'tables' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedTables.size === tables.length} onChange={toggleAll} />
                Select all ({tables.length} tables)
              </label>
            </div>
            {sourceMode === 'REMOTE' && (
              <span className={`text-sm ${exceedsLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                Total: {formatBytes(selectedSize)} {exceedsLimit && '(exceeds 1GB limit)'}
              </span>
            )}
          </div>

          <div className="border rounded-lg max-h-80 overflow-y-auto">
            {tables.map((t) => {
              const key = `${t.schemaName}.${t.tableName}`;
              return (
                <label key={key} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 hover:bg-muted/50 cursor-pointer">
                  <input type="checkbox" checked={selectedTables.has(key)} onChange={() => toggleTable(key)} />
                  <span className="flex-1 font-mono text-sm">{t.schemaName !== 'public' ? `${t.schemaName}.` : ''}{t.tableName}</span>
                  <span className="text-xs text-muted-foreground w-20 text-right">{t.estimatedRows?.toLocaleString() ?? '-'} rows</span>
                  <span className="text-xs text-muted-foreground w-20 text-right">{t.estimatedSizeFormatted || '-'}</span>
                </label>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label>Conflict Strategy (when table already exists)</Label>
            <div className="flex gap-3">
              {([['ERROR', 'Stop on conflict'], ['OVERWRITE', 'Drop & reimport'], ['SKIP', 'Skip existing']] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="conflict" checked={conflictStrategy === value} onChange={() => setConflictStrategy(value)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('source')}>Back</Button>
            <Button onClick={handleStartMigration} disabled={selectedTables.size === 0 || exceedsLimit || createMigration.isPending}>
              {createMigration.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Start Migration ({selectedTables.size} tables)
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Execute */}
      {step === 'execute' && (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{progress?.currentTable ? `Migrating: ${progress.currentTable}` : 'Starting...'}</span>
              <span>{progress ? `${progress.completedTables}/${progress.totalTables} tables` : ''}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: progress ? `${(progress.completedTables / progress.totalTables) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {/* Log toggle */}
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

          {/* Status message */}
          {status === 'COMPLETED' && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" /> Migration completed successfully
            </div>
          )}
          {status === 'FAILED' && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> Migration failed. Check logs for details.
            </div>
          )}

          <div className="flex gap-2">
            {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) && (
              <Button variant="destructive" size="sm" onClick={() => cancelMigration.mutate(migrationId)}>
                Cancel
              </Button>
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/migration-wizard.tsx
git commit -m "feat(data-migration): add multi-step migration wizard component"
```

---

## Task 13: Frontend — Integrate into Database Page

**Files:**
- Modify: `frontend/src/app/projects/[id]/database/page.tsx`

- [ ] **Step 1: Add import and migration state**

At the top of `frontend/src/app/projects/[id]/database/page.tsx`, add to imports:

```typescript
import { MigrationWizard } from '@/components/migration-wizard';
import { Upload } from 'lucide-react';
```

Inside the component, add state:

```typescript
const [showMigration, setShowMigration] = useState(false);
```

- [ ] **Step 2: Add "Import Data" button and wizard**

Find the main content area header in the database page. Add an "Import Data" button in the top area, and render the wizard when `showMigration` is true.

Before the existing content (sub-view tabs), add:

```tsx
{showMigration ? (
  <MigrationWizard projectId={id} onClose={() => setShowMigration(false)} />
) : (
  <>
    {/* existing database page content */}
  </>
)}
```

Add the import button to the top bar area (near the sub-view tabs):

```tsx
<Button variant="outline" size="sm" onClick={() => setShowMigration(true)}>
  <Upload className="h-4 w-4 mr-2" /> Import Data
</Button>
```

- [ ] **Step 3: Verify frontend compiles**

Run:
```bash
cd frontend && npx next build 2>&1 | head -30
```

Or if build is slow, verify with TypeScript only:
```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/projects/[id]/database/page.tsx
git commit -m "feat(data-migration): add Import Data button and wizard to database page"
```

---

## Task 14: Frontend — Integrate into New Project Flow

**Files:**
- Modify: `frontend/src/app/projects/new/page.tsx`

- [ ] **Step 1: Add import data step to project creation**

In `frontend/src/app/projects/new/page.tsx`:

Update the Step type to include 'import':
```typescript
type Step = 'source' | 'basic' | 'env' | 'confirm' | 'import';
```

After the project creation success handler (where it navigates to the new project), add a step that asks if the user wants to import data. Store the created project ID:

```typescript
const [createdProjectId, setCreatedProjectId] = useState('');
```

In the confirm step's submit handler, after successful creation, instead of immediately navigating:

```typescript
// If project uses local DB, offer to import data
if (form.useLocalDb) {
  setCreatedProjectId(result.id);
  setStep('import');
} else {
  router.push(`/projects/${result.id}`);
}
```

Add the import step rendering (after the confirm step JSX):

```tsx
{step === 'import' && (
  <Card>
    <CardHeader>
      <CardTitle>Import Existing Data</CardTitle>
      <CardDescription>You can import data from an existing database now or skip this step.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <MigrationWizard projectId={createdProjectId} onClose={() => router.push(`/projects/${createdProjectId}`)} />
      <Button variant="ghost" onClick={() => router.push(`/projects/${createdProjectId}`)}>
        Skip for now
      </Button>
    </CardContent>
  </Card>
)}
```

Add the import:
```typescript
import { MigrationWizard } from '@/components/migration-wizard';
```

- [ ] **Step 2: Verify frontend compiles**

Run:
```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/new/page.tsx
git commit -m "feat(data-migration): add optional data import step to project creation flow"
```

---

## Task 15: Final Verification

- [ ] **Step 1: Run all backend tests**

Run:
```bash
cd backend && npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 2: Verify backend compiles**

Run:
```bash
cd backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify frontend compiles**

Run:
```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit any remaining fixes if needed**

```bash
git add -A && git commit -m "fix(data-migration): address compilation and test issues"
```
