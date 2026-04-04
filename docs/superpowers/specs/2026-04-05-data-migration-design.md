# Data Migration Feature Design

## Overview

Allow users to import data from existing PostgreSQL databases into ship-dock platform project databases. Supports two data source modes: remote database direct connection and SQL dump file upload.

## Requirements

- **Data sources**: Remote PostgreSQL direct connection, SQL dump file upload (.sql / .dump)
- **Table selection**: Users can select which tables to migrate
- **Conflict strategy**: ERROR (stop on conflict) / OVERWRITE (drop and reimport) / SKIP (skip existing tables)
- **Real-time feedback**: Progress bar + expandable detailed logs via WebSocket
- **Entry points**: During project creation flow and on the project Database page
- **Size limit**: Maximum 1GB per migration
- **Database support**: PostgreSQL only (extensible to other databases later)

## Architecture

### New Module: `data-migration`

A new NestJS module with the following components:

- **DataMigrationController** — API request handling (create migration, upload file, query status)
- **DataMigrationService** — Business logic (connection validation, table discovery, size estimation)
- **DataMigrationProcessor** — BullMQ processor, executes the actual migration work
- **DataMigrationGateway** — WebSocket gateway, pushes real-time progress and logs

### Two Migration Paths

1. **Remote direct connection** → Connect to source DB via `pg` client → Stream data table-by-table using `COPY TO/FROM`
2. **File upload** → Store file in MinIO → Import using `pg_restore` (for .dump) or sequential SQL execution (for .sql)

Both paths execute asynchronously via BullMQ and push real-time logs and progress via WebSocket.

## Data Model

### DataMigration

Main migration task table:

| Field | Type | Description |
|-------|------|-------------|
| id | String (cuid) | Primary key |
| projectId | String | FK to Project |
| source | Enum: REMOTE, FILE | Data source type |
| status | Enum: PENDING, CONNECTING, ANALYZING, MIGRATING, COMPLETED, FAILED, CANCELLED | Migration status |
| connectionConfig | String (encrypted) | Source DB connection info (REMOTE mode) |
| fileName | String? | Uploaded file name (FILE mode) |
| fileKey | String? | MinIO storage key (FILE mode) |
| fileSize | BigInt? | File size in bytes |
| conflictStrategy | Enum: ERROR, OVERWRITE, SKIP | How to handle existing tables |
| totalTables | Int | Total number of tables to migrate |
| completedTables | Int | Number of tables completed |
| totalRows | BigInt | Total estimated rows |
| completedRows | BigInt | Rows migrated so far |
| logs | Json | Migration log entries |
| errorMessage | String? | Failure reason |
| startedAt | DateTime? | When migration started |
| completedAt | DateTime? | When migration finished |
| createdAt | DateTime | Record creation time |

### DataMigrationTable

Per-table migration status:

| Field | Type | Description |
|-------|------|-------------|
| id | String (cuid) | Primary key |
| migrationId | String | FK to DataMigration |
| tableName | String | Table name |
| schemaName | String | Schema name (default: public) |
| status | Enum: PENDING, MIGRATING, COMPLETED, FAILED, SKIPPED | Table migration status |
| rowCount | BigInt | Estimated row count |
| migratedRows | BigInt | Rows migrated so far |
| errorMessage | String? | Failure reason |
| startedAt | DateTime? | When table migration started |
| completedAt | DateTime? | When table migration finished |

Relations: DataMigration belongs to Project (cascade delete). DataMigrationTable belongs to DataMigration (cascade delete).

## API Design

All endpoints under `/api/projects/:projectId/migrations`:

### Migration Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create migration task (body: source type, connection info or file info, selected tables, conflict strategy) |
| GET | `/` | List migration history for project |
| GET | `/:migrationId` | Get detailed migration status with per-table progress |
| POST | `/:migrationId/cancel` | Cancel an in-progress migration |

### Remote Connection

| Method | Path | Description |
|--------|------|-------------|
| POST | `/test-connection` | Test if source database is reachable |
| POST | `/discover-tables` | Connect to source DB, return all tables with estimated row counts and sizes |

### File Upload

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Upload SQL dump file to MinIO (1GB limit, Multer) |
| POST | `/analyze-file` | Parse uploaded file (by fileKey from /upload response) to extract table list for selection |

### WebSocket

Client joins room `migration:{migrationId}`. Events:

- `migration:progress` — Progress update (completedTables, completedRows)
- `migration:log` — Log line (timestamp, level, message)
- `migration:complete` — Migration finished with summary
- `migration:error` — Migration failed with error details

## Migration Execution Flow

### Remote Direct Connection

1. User fills in connection info → call `test-connection` to validate
2. On success → call `discover-tables` to get table list (with row counts, size estimates)
3. Check if total size exceeds 1GB limit; reject if exceeded
4. User selects tables + conflict strategy → call `POST /` to create task
5. BullMQ Processor executes:
   - Connect to source and target databases
   - Sort tables by dependency order (topological sort on foreign keys, referenced tables first)
   - Per-table migration: create table DDL (columns, primary keys, indexes, constraints, defaults, sequences) → `COPY TO` stream from source → `COPY FROM` stream to target
   - Restore foreign key constraints after all tables are migrated
   - Update progress and push WebSocket events after each table
6. Conflict handling: when target DB has a table with the same name:
   - ERROR: stop and report error
   - OVERWRITE: DROP table then reimport
   - SKIP: skip the table, mark as SKIPPED

### File Upload

1. User uploads SQL dump file (.sql or .dump format)
2. File stored in MinIO → call `analyze-file` to extract table list
3. User selects tables + conflict strategy → create task
4. BullMQ Processor executes:
   - Download file from MinIO to temp directory
   - For .dump format: use `pg_restore -t table1 -t table2` to filter selected tables
   - For .sql format: parse and execute relevant statements
   - Push progress and logs via WebSocket
5. Clean up MinIO temp file after migration completes

### Error Handling

- Single table failure does NOT block other tables — mark as FAILED with error, continue
- Final summary: N succeeded, M failed, K skipped
- Users can view per-table failure reasons and re-migrate failed tables

## Frontend Design

### Entry Point 1: Project Creation Flow

After project creation in `/projects/new`, add an optional step — "Import Existing Data". User can skip or choose to import from remote database or file.

### Entry Point 2: Project Database Page

Add an "Import Data" button at the top of `/projects/[id]/database`. Clicking opens the migration wizard.

### Migration Wizard (shared component)

**Step 1 — Choose Data Source**
- Two cards: "Remote Database" and "Upload File"
- Remote: form with host, port, username, password, database name + "Test Connection" button
- Upload: drag-and-drop area, supports .sql / .dump, shows file size, error if > 1GB

**Step 2 — Select Tables**
- Table list with: checkbox, table name, estimated rows, estimated size
- Top: select all / deselect all + total size display (disable continue if > 1GB)
- Bottom: conflict strategy selector (Error / Overwrite / Skip)

**Step 3 — Execute Migration**
- Top: overall progress bar (completed tables / total tables)
- Middle: table list with status icon per row (pending / migrating / success / failed / skipped) and row progress
- Bottom: collapsible detailed log panel (reuse xterm terminal style)
- Top-right: cancel button

**Step 4 — Complete**
- Summary: N tables succeeded, M rows migrated, K tables failed (expandable to see reasons)
- Buttons: "View Database" (navigate to Database browser), "Retry Failed Tables"

## Security

- Source DB connection info encrypted via existing `EncryptionService`; passwords cleared after migration completes
- File upload validation: check file extension and MIME type, reject non-SQL/dump files
- SQL injection prevention: remote connections use `pg` client parameterized connections; file imports use `child_process.execFile` (not `exec`) for `pg_restore`
- Connection timeout: 30 seconds for remote connections

## Limits & Resource Protection

- **1GB maximum** per migration (remote: calculated from size estimates; file: file size check)
- **One concurrent migration** per project
- **PostgreSQL only** as source database (extensible later)
- **File formats**: `.sql` (plain text) and `.dump` (pg_dump custom format)
- Migrations queued via BullMQ to limit concurrent database connections
- Streaming transfer to avoid loading large datasets into memory
- **Timeouts**: 30 minutes per table, 2 hours per migration
