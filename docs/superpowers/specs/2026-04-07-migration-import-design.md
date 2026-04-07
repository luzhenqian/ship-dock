# Migration & Import Design

**Date:** 2026-04-07
**Status:** Approved

## Overview

Ship Dock migration system that allows users to migrate from traditional self-hosted deployments or serverless platforms to Ship Dock. Two migration paths share a common import wizard.

## Migration Paths

### Path 1: CLI (Server/VPS)
User runs `npx ship-dock-migrate` on the source server. CLI scans, collects data, and uploads a migration package to Ship Dock API.

### Path 2: Serverless/Cloud
User connects remote services directly through the frontend wizard (GitHub repos, remote databases, S3/Redis credentials).

Both paths converge at the Import Wizard for project configuration, conflict handling, and deployment.

## Architecture

```
CLI (source server)  ──upload──►  Import Module  ◄──remote connect──  Wizard (serverless)
                                       │
                              ┌────────┼────────┐
                          项目创建   数据同步   配置映射
```

**Approach:** Dual independent flows, shared backend import wizard. CLI path and serverless path each handle data collection independently, then feed into the same import execution pipeline.

**Migration strategy:** Allow short downtime. One-time data transfer, then DNS switch.

---

## Part 1: CLI Tool (Source Server)

### Tool
Standalone npm package `ship-dock-migrate`, run via `npx ship-dock-migrate`. No global install needed. Does not depend on NestJS — lightweight CLI only.

### Package Structure

```
packages/cli/
├── package.json            # name: ship-dock-migrate, bin: ship-dock-migrate
├── tsconfig.json
├── src/
│   ├── index.ts            # Entry point, interactive flow
│   ├── scanner.ts          # Orchestrates detectors, deduplicates results
│   ├── detectors/
│   │   ├── detector.interface.ts
│   │   ├── pm2.detector.ts
│   │   ├── docker.detector.ts
│   │   ├── systemd.detector.ts
│   │   ├── nginx.detector.ts
│   │   ├── process.detector.ts    # Bare process detection
│   │   └── cron.detector.ts
│   ├── collectors/
│   │   ├── collector.interface.ts
│   │   ├── code.collector.ts      # git remote / directory archive
│   │   ├── database.collector.ts  # pg_dump / mysqldump
│   │   ├── redis.collector.ts     # RDB export
│   │   ├── storage.collector.ts   # S3/MinIO download
│   │   ├── env.collector.ts       # .env / ecosystem config
│   │   └── ssl.collector.ts       # Certificate files
│   ├── packager.ts          # Generate manifest.json, assemble package
│   ├── uploader.ts          # Chunked upload to Ship Dock API
│   └── utils/
│       ├── shell.ts         # Safe shell execution
│       └── crypto.ts        # Sensitive data encryption
```

### Detectors

| Detector | Detection Method | Collected Data |
|----------|-----------------|----------------|
| PM2 | `pm2 jlist` | Process name, directory, env vars, start script |
| Docker/Compose | `docker ps` + compose files | Container name, image, port mapping, volumes, env |
| systemd | Scan `/etc/systemd/system/*.service` | Working directory, start command, env files |
| Nginx | Parse `/etc/nginx/sites-enabled/*` | server_name, proxy_pass, SSL cert paths |
| Bare Process | `ps aux` matching node/python/java/php | PID, command, working directory |
| Cron | `crontab -l` | Cron rules and associated scripts |

### Data Collectors

| Data Type | Collection Method |
|-----------|------------------|
| Code | Record git remote URL + current commit hash; archive directory for non-git projects |
| Database | Extract connection string from .env/env vars, `pg_dump` / `mysqldump` export |
| Redis | Extract from connection string, `redis-cli --rdb` export or key scan |
| Object Storage | Extract S3/MinIO credentials from env, list and download bucket contents |
| Environment Variables | Read .env files, PM2 ecosystem config, Docker env |
| SSL Certificates | Extract cert file paths from nginx config, copy cert files |
| Cron Jobs | Parse crontab entries, associate with project directories |

### Detector Interface

```typescript
interface DetectedProject {
  name: string;
  type: 'pm2' | 'docker' | 'systemd' | 'process';
  directory: string;
  command: string;
  port?: number;
  env: Record<string, string>;
  nginx?: { serverNames: string[]; sslCert?: string; sslKey?: string };
  cron?: { schedule: string; command: string }[];
  databases: { type: 'postgresql' | 'mysql'; connectionUrl: string }[];
  redis: { connectionUrl: string }[];
  storage: { type: 's3' | 'minio'; endpoint: string; bucket: string; credentials: any }[];
}

interface Detector {
  name: string;
  detect(): Promise<DetectedProject[]>;
}
```

### Deduplication
Multiple detectors may find the same project (e.g., PM2 process with nginx reverse proxy and cron job). Scanner deduplicates by working directory, merging results from all detectors.

### Interactive Flow

```
$ npx ship-dock-migrate

🔍 Scanning server...
Found 3 projects:
  1. ✅ my-api (PM2 + Nginx + PostgreSQL + Redis)
  2. ✅ blog-app (Docker Compose + PostgreSQL)
  3. ✅ worker (systemd + Redis)

Select projects to migrate: [1, 2, 3] (default: all)
> all

Ship Dock server URL: https://dock.example.com
API Token: ****

📦 Collecting data...
  my-api: code ✓ database (245MB) ✓ redis ✓ env ✓ nginx ✓ cron ✓
  blog-app: code ✓ database (1.2GB) ✓ env ✓
  worker: code ✓ redis ✓ env ✓

⬆️  Uploading to Ship Dock... (1.5GB)
  [████████████████████████] 100%

✅ Migration package uploaded. Open Ship Dock dashboard to continue import.
```

### Migration Package Format

```
migration-package/
├── manifest.json          # Metadata: project list, detected services, timestamp
├── projects/
│   ├── my-api/
│   │   ├── project.json   # Project config (name, port, domain, runtime)
│   │   ├── env.json       # Environment variables (encrypted)
│   │   ├── nginx.conf     # Original nginx config
│   │   ├── cron.json      # Cron rules
│   │   ├── database.sql.gz
│   │   ├── redis.rdb
│   │   └── storage/       # Object storage files
│   ├── blog-app/
│   │   └── ...
```

### Upload Mechanism
- Streaming chunked upload to Ship Dock API (MinIO as temp storage)
- Resume support for interrupted uploads
- TLS encrypted transport, sensitive data (env vars, credentials) additionally AES encrypted

### Key Dependencies
- `inquirer` — interactive prompts
- `ora` — progress spinners
- `chalk` — terminal colors
- `commander` — CLI argument parsing

### Security
- Env vars and database credentials encrypted with temporary public key from Ship Dock API before packaging
- Sensitive info never written to disk in plaintext
- Local temp files cleaned up after CLI completes

---

## Part 2: Frontend Import Wizard

### Entry Point
Dashboard gets an "Import Projects" button. Wizard starts with source selection:

- **Server** — From a VPS or server via CLI
- **Cloud** — Serverless / hosted services

### CLI Path (Server)

**Step 1 — Connect:**
Display CLI install instructions and API Token. Frontend polls / listens via WebSocket for migration package upload. Auto-advances when upload completes.

**Step 2 — Project Preview:**
Parse manifest.json, display detected projects:
- Project name, detected runtime (PM2/Docker/systemd)
- Included data: database (size), Redis, object storage, cron jobs
- Domain (extracted from nginx config)
- Checkboxes to select which projects to import

**Step 3 — Configuration Mapping (per project):**
One page per project, user confirms/adjusts:
- Project name and slug
- Port allocation (auto-assign or manual)
- Environment variable review (highlight vars that need modification, e.g., database URLs auto-replaced with Ship Dock local ones)
- Build commands / pipeline configuration
- Domain binding

**Step 4 — Conflict Handling:**
- Database: OVERWRITE / SKIP / APPEND (reuse existing Data Migration conflict strategies)
- Slug conflict: auto-suffix or manual rename
- Port conflict: auto-assign next available port

**Step 5 — Confirm & Execute:**
Overview of all project configs. One-click start. Real-time progress display per project with stage-level granularity.

### Serverless Path (Cloud)

**Step 1 — Code Source:**
Connect GitHub repo (reuse existing GitHub integration), select repos to migrate.

**Step 2 — Data Service Connections:**
Fill in remote service credentials per item:
- PostgreSQL / MySQL connection string
- Redis connection string
- S3 / R2 / MinIO credentials + bucket name
- Real-time connection test for each entry

**Step 3 — Environment Variables:**
- Paste .env content or upload .env file
- Auto-detect which vars are database/Redis/storage connection strings, mark as "will be auto-replaced after migration"

**Steps 4–5:** Same as CLI path (Configuration Mapping → Confirm & Execute)

### DNS Switch (shared final step)

After import completes and projects deploy successfully:
- **With domain provider integration (Namecheap/GoDaddy):** Show "Auto-switch DNS" button, one-click completion
- **Without integration:** Display clear DNS configuration guide with target records, plus a "Check DNS propagation" button that polls to verify DNS has switched

---

## Part 3: Backend Architecture

### New Module

```
backend/src/
├── import/
│   ├── import.controller.ts       # API endpoints
│   ├── import.service.ts          # Import orchestration
│   ├── import.processor.ts        # BullMQ job processor
│   ├── import.gateway.ts          # WebSocket real-time progress
│   ├── dto/
│   │   ├── create-import.dto.ts
│   │   └── import-config.dto.ts
│   ├── parsers/
│   │   └── manifest-parser.ts     # Parse CLI migration package manifest
│   └── collectors/
│       ├── remote-db.collector.ts  # Serverless path: remote database pull
│       ├── remote-redis.collector.ts
│       └── remote-storage.collector.ts
```

### Data Model (Prisma)

```prisma
model Import {
  id            String         @id @default(uuid())
  status        ImportStatus   @default(PENDING)
  sourceType    ImportSource   // CLI_PACKAGE or REMOTE
  manifestData  Json?          // Parsed manifest
  packageKey    String?        // Migration package key in MinIO
  totalProjects Int
  errorMessage  String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  items         ImportItem[]
  userId        String
  user          User           @relation(fields: [userId], references: [id])
}

model ImportItem {
  id              String           @id @default(uuid())
  importId        String
  import          Import           @relation(fields: [importId], references: [id])
  sourceName      String           // Original project name
  projectId       String?          // Associated Ship Dock project after creation
  project         Project?         @relation(fields: [projectId], references: [id])
  status          ImportItemStatus @default(PENDING)
  config          Json             // User-confirmed configuration mapping
  stages          Json             @default("[]") // Per-stage progress
  errorMessage    String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}

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
```

### API Endpoints

```
POST   /api/imports/upload          # CLI chunked upload
GET    /api/imports/upload/:id      # Upload progress (resume support)
POST   /api/imports                 # Create import task
GET    /api/imports/:id             # Get import details (with items)
PATCH  /api/imports/:id/config      # Submit user configuration mapping
POST   /api/imports/:id/start       # Start import execution
POST   /api/imports/:id/cancel      # Cancel import
DELETE /api/imports/:id             # Delete import record and temp data

POST   /api/imports/test-connection # Test remote database/Redis/S3 connection
POST   /api/imports/token           # Generate temporary CLI API token
```

### Import Execution Pipeline (per ImportItem)

```
 1. CREATE_PROJECT     → Call ProjectsService.create()
 2. PROVISION_DB       → Create local PostgreSQL database
 3. IMPORT_DB          → Reuse DataMigrationService (CLI: from sql.gz / REMOTE: remote pull)
 4. PROVISION_REDIS    → Allocate local Redis DB index
 5. IMPORT_REDIS       → RDB import or key-by-key sync
 6. PROVISION_STORAGE  → Create MinIO bucket
 7. SYNC_STORAGE       → Copy objects from package or remote S3
 8. SET_ENV            → Write env vars (auto-replace connection strings with local ones)
 9. SETUP_CRON         → Create cron jobs (if any)
10. DEPLOY             → Trigger standard deploy pipeline (clone → install → build → pm2 → nginx → ssl)
11. SWITCH_DNS         → Auto-switch DNS (if integrated) or mark as pending manual switch
```

Each stage independently tracks status and logs. Failed stages can be retried from the failure point (consistent with existing deploy pipeline design).

### Reuse of Existing Modules

| Existing Module | Reuse |
|----------------|-------|
| DataMigrationService | Database import (both REMOTE and FILE modes) |
| MinioProvisionerService | Bucket creation, object operations |
| ProjectsService | Project creation, env vars, port allocation |
| DeployService | Trigger standard deploy pipeline |
| DomainService | DNS auto-switch |
| Redis provisioning | Redis DB allocation |

### Temp Storage & Cleanup
- CLI uploads stored in MinIO `imports/` bucket
- Auto-cleanup via BullMQ delayed job (24 hours) after import completes or is cancelled
- Large files (database dumps) streamed, never fully loaded into memory

---

## Part 4: Environment Variable Smart Mapping

### Auto-Replacement Rules

System identifies and suggests replacements via pattern matching:

| Original Value | Replaced With |
|---------------|---------------|
| `postgresql://user:pass@localhost:5432/mydb` | Ship Dock local PostgreSQL URL |
| `mysql://user:pass@rds.amazonaws.com:3306/mydb` | Ship Dock local PostgreSQL URL (needs confirmation) |
| `redis://localhost:6379/0` | Ship Dock local Redis URL |
| `s3.amazonaws.com` / `minio.example.com` | Ship Dock MinIO endpoint |

**Detection patterns:**
- Variable name patterns: `DATABASE_URL`, `DB_*`, `REDIS_URL`, `REDIS_HOST`, `S3_*`, `MINIO_*`, `AWS_*` (storage-related)
- Connection string formats: `postgresql://`, `mysql://`, `redis://`, `mongodb://`

**UX:** In wizard Step 3, highlight detected vars showing "original → suggested replacement". User can confirm, modify, or keep original per variable. Unrecognized variables kept as-is.

### MySQL → PostgreSQL Notice

Ship Dock uses PostgreSQL. If source project uses MySQL:
- Wizard explicitly warns: "Ship Dock uses PostgreSQL. MySQL data will require conversion via pgloader"
- Marked as high-risk step, user advised to verify data post-migration
- No automatic conversion — user can skip database migration and handle manually

### Cron Job Mapping

Source crontab entries mapped to Ship Dock project config:

```
Source (crontab):
*/5 * * * * cd /var/www/my-api && node scripts/cleanup.js

Maps to Ship Dock project config:
{
  "cron": [
    {
      "schedule": "*/5 * * * *",
      "command": "node scripts/cleanup.js",
      "description": "cleanup (migrated from crontab)"
    }
  ]
}
```

- Cron executed via PM2 `cron_restart` or project-level BullMQ scheduled jobs
- Wizard displays detected cron rules for user confirmation
- Associated with projects via directory path matching in cron commands

---

## Part 5: Error Handling, Security & Limits

### Error Handling

**Per-project isolation:** One project failing does not affect others. Failed projects marked FAILED, user can:
- View detailed logs for the failed stage
- Retry from the failed stage
- Skip the project and continue

**Stage-level rollback:** On failure or cancellation, auto-cleanup of created resources:
- Delete created project records
- Release allocated ports
- Drop created databases / Redis DBs / MinIO buckets
- Clean up PM2 processes and Nginx configs

**Common failure scenarios:**

| Scenario | Handling |
|----------|----------|
| CLI upload interrupted | Resume upload, uploaded chunks retained 24h |
| Database dump corrupted | Mark that project's DB import as failed, others continue |
| Remote connection timeout | Retry 3 times, then prompt user to check network/firewall |
| Disk space insufficient | Pre-check before start, error early if insufficient |
| Port exhaustion | Prompt user to free ports or adjust PORT_RANGE |

### Security

- **CLI Token:** Temporary, 2-hour validity, scoped to import-related APIs only
- **Transport encryption:** TLS + AES-256 for sensitive fields
- **Access control:** Only ADMIN and OWNER roles can perform imports
- **Package cleanup:** Auto-delete 24 hours after import completes/cancels
- **Audit logging:** Passwords and keys redacted in import logs

### Limits (v1)

**Not supported in v1:**
- MongoDB data migration (PostgreSQL / MySQL only)
- Multi-server orchestration (one source server at a time)
- Direct Docker container execution (migrated projects use PM2; Docker projects need source code extraction)
- Windows source servers

**Size limits:**
- Single project database dump: 10GB
- Single project object storage: 20GB
- Total migration package: 50GB
- Over-limit: prompt user to migrate in batches or handle large data manually
