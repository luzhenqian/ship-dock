# Storage Import Design

## Overview

Add a data import feature for MinIO/S3 storage in Ship Dock, following the same wizard pattern as the existing PostgreSQL migration wizard. Users can import data from three sources into a project's MinIO bucket.

## Data Sources

| Mode | Description |
|------|-------------|
| **Remote S3/MinIO** | Connect to a remote S3-compatible endpoint (MinIO, AWS S3, Cloudflare R2, etc.) using endpoint + access key + secret key, browse and select objects to copy |
| **Upload Files** | Multi-file and folder drag-and-drop upload; ZIP/TAR.GZ archives are auto-extracted into the target bucket |
| **URL Import** | Enter one or more public URLs; backend downloads each file directly into the target bucket |

## User Flow

```
Select source → Configure/select files → Conflict strategy → Execute import
```

### Step 1: Select Source

Three cards (same pattern as MigrationWizard):
- Remote S3/MinIO (icon: cloud)
- Upload Files (icon: upload)
- URL Import (icon: link)

### Step 2: Configure Source

**Remote S3/MinIO:**
1. Fill connection form: endpoint, port, access key, secret key, use SSL toggle
2. Click "Test Connection & Browse" — tests connection, lists buckets
3. Select source bucket, browse objects with prefix navigation
4. Check objects/prefixes to import — shows file count and total size

**Upload Files:**
1. Drag-and-drop zone accepts multiple files, folders, and ZIP/TAR.GZ archives
2. File list shows name, size, and "extract" badge for archives
3. Archives are extracted on the server side after upload

**URL Import:**
1. Text area for entering URLs (one per line)
2. Backend validates URLs (HEAD request to check accessibility and content-length)
3. Shows validated URL list with file names and sizes

### Step 3: Conflict Strategy

Unified for all sources:

| Strategy | Behavior |
|----------|----------|
| **Overwrite** | Replace existing files with the same key |
| **Skip** | Keep existing files, skip imports with duplicate keys |
| **Error** | Stop the entire import if any key already exists |

### Step 4: Execute

- Progress bar showing completed/total files
- Real-time logs via WebSocket (with polling fallback)
- Cancel button
- Completion/failure status with summary

### Target Location

The import target is determined by the user's current position in the Storage page:
- **Bucket**: the currently selected bucket
- **Prefix**: the current path/prefix the user has navigated to

The "Import" button appears next to the existing "Upload" button.

## Technical Architecture

### Backend

#### New Module: `storage-import`

| Component | File | Purpose |
|-----------|------|---------|
| Controller | `storage-import.controller.ts` | REST endpoints for import operations |
| Service | `storage-import.service.ts` | Connection testing, object discovery, URL validation, temp file management |
| Processor | `storage-import.processor.ts` | BullMQ async processor — executes the actual import |
| Gateway | `storage-import.gateway.ts` | WebSocket gateway for real-time progress |
| DTOs | `dto/create-storage-import.dto.ts` | Request validation |

#### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/projects/:id/storage/import/test-connection` | DEVELOPER | Test remote S3 connection, return bucket list |
| POST | `/projects/:id/storage/import/discover` | DEVELOPER | List objects in remote bucket (with prefix support) |
| POST | `/projects/:id/storage/import/validate-urls` | DEVELOPER | Validate URLs, return file info |
| POST | `/projects/:id/storage/import/upload` | DEVELOPER | Upload files to temp directory (multipart, multiple files) |
| POST | `/projects/:id/storage/import` | DEVELOPER | Create and enqueue import job |
| GET | `/projects/:id/storage/import/:importId` | VIEWER | Get import status |
| POST | `/projects/:id/storage/import/:importId/cancel` | DEVELOPER | Cancel running import |

#### Import Execution Logic

**Remote S3:**
1. Create MinIO client with provided credentials
2. For each selected object: `getObject()` from remote → `putObject()` to local
3. For selected prefixes: recursively list and copy all objects under that prefix
4. Before each write, check conflict strategy (stat target key to see if exists)

**Upload Files:**
1. Files are uploaded to temp directory via multipart upload
2. ZIP files: extract using `unzipper` library, stream each entry to bucket
3. TAR.GZ files: extract using `tar` library
4. Regular files: directly `putObject()` to bucket
5. Clean up temp files after completion

**URL Import:**
1. For each URL: `fetch()` with streaming → pipe response body to `putObject()`
2. Use `Content-Disposition` header for filename if available, otherwise derive from URL path
3. Before each write, check conflict strategy

#### Conflict Strategy Implementation

Before writing each object:
1. Try `statObject(bucket, key)` on the target
2. If object exists:
   - **Overwrite**: proceed with `putObject()`
   - **Skip**: skip this file, log as skipped
   - **Error**: fail the import, set status to FAILED

### Database Model

```prisma
model StorageImport {
  id              String   @id @default(uuid())
  projectId       String
  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  source          StorageImportSource // REMOTE, FILE, URL
  targetBucket    String
  targetPrefix    String   @default("")
  conflictStrategy StorageImportConflict // OVERWRITE, SKIP, ERROR
  status          StorageImportStatus   // PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
  totalFiles      Int      @default(0)
  completedFiles  Int      @default(0)
  skippedFiles    Int      @default(0)
  totalSize       BigInt   @default(0)
  error           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

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
```

### Frontend

#### New Components

| Component | File | Purpose |
|-----------|------|---------|
| StorageImportWizard | `components/storage-import-wizard.tsx` | Main wizard component (same pattern as MigrationWizard) |

#### New Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useTestStorageConnection` | `hooks/use-storage-import.ts` | Test remote S3 connection |
| `useDiscoverStorageObjects` | `hooks/use-storage-import.ts` | Browse remote bucket objects |
| `useValidateUrls` | `hooks/use-storage-import.ts` | Validate import URLs |
| `useUploadImportFiles` | `hooks/use-storage-import.ts` | Upload files for import |
| `useCreateStorageImport` | `hooks/use-storage-import.ts` | Create import job |
| `useCancelStorageImport` | `hooks/use-storage-import.ts` | Cancel import |
| `useStorageImportProgress` | `hooks/use-storage-import-progress.ts` | WebSocket + polling for progress |

#### Storage Page Changes

Add "Import" button next to the existing "Upload" button. Clicking opens the StorageImportWizard in a panel (same pattern as MigrationWizard in database page).

### Dependencies

**Backend npm packages:**
- `unzipper` — ZIP extraction with streaming support
- `tar` — TAR.GZ extraction
- MinIO SDK already available via `minio` package

**No new frontend packages needed.**

### Security

- Remote S3 credentials are NOT stored — only used during the import session
- Temp uploaded files are cleaned up after import (same cleanup logic as data-migration: files older than 1 hour deleted every 10 min)
- URL imports only accept HTTP/HTTPS URLs
- File upload size limit: 1GB per file (same as data-migration)
- All endpoints require JWT auth and DEVELOPER role minimum

### Error Handling

- Remote connection failures: return clear error message with connection details
- URL download failures: log the failed URL, continue with remaining URLs (unless Error strategy)
- ZIP extraction failures: fail the import with descriptive error
- Partial failures: completed files remain in bucket, status set to FAILED with error message
- Cancellation: stop processing remaining files, already imported files remain

### WebSocket Events

Same pattern as data-migration gateway:

| Event | Payload |
|-------|---------|
| `storage-import:log` | `{ importId, message, level, timestamp }` |
| `storage-import:progress` | `{ importId, completedFiles, totalFiles, currentFile, skippedFiles }` |
| `storage-import:status` | `{ importId, status }` |
