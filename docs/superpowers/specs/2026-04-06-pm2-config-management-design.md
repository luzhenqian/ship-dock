# PM2 Configuration Management

Visual configuration page for PM2 ecosystem settings within project management, parallel to the existing Nginx config page.

## Overview

Add a PM2 config page at `/projects/[id]/pm2` that displays current PM2 process info (read-only) and allows editing runtime settings. Changes are saved and applied immediately (ecosystem.config.js rewritten + `pm2 restart`).

## UI Layout

Three cards, mirroring the Nginx config page structure:

### Card 1: Process Info (read-only)

Displays current PM2 process metadata pulled from the project record:

| Field | Source | Display |
|-------|--------|---------|
| name | `project.pm2Name` | Text |
| cwd | `project.directory` | Text |
| PORT | `project.port` | Text |
| NODE_ENV | Fixed `production` | Text |
| Environment Variables | Decrypted `project.envVars` | Collapsible key=value list, with a link to Settings page for editing |

### Card 2: Runtime Settings (editable)

| Field | Type | Default | Validation | Notes |
|-------|------|---------|------------|-------|
| script | Text input | `null` (auto-detect) | Optional | Placeholder shows detected value from backend |
| instances | Number input | 1 | 1-16 | Process count |
| execMode | Select dropdown | `fork` | `fork` \| `cluster` | Auto-switches to `cluster` when instances > 1 |
| maxMemoryRestart | Text input | `null` (no limit) | `/^\d+[KMG]$/i` | e.g., `300M`, `1G` |

**Interaction: instances/execMode linkage**
- When `instances` changes to > 1, `execMode` auto-sets to `cluster` with inline hint: "Multiple instances require cluster mode"
- When `instances` changes back to 1, `execMode` is NOT auto-reverted

### Card 3: Generated Configuration (read-only preview)

- Real-time preview of the generated `ecosystem.config.js`
- Syntax highlighted with Shiki (`javascript` language, `github-dark` theme)
- Updates live as user edits fields in Card 2

### Save Button

Label: "Save & Restart". Saves config to database, rewrites ecosystem.config.js, and executes `pm2 restart`.

### Precondition

Project must have been deployed (has `directory`). Otherwise, show: "Please deploy the project before managing PM2 settings."

## Database

New `Pm2Config` model, one-to-one with `Project`:

```prisma
model Pm2Config {
  id                String   @id @default(cuid())
  projectId         String   @unique
  project           Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  script            String?
  instances         Int      @default(1)
  execMode          String   @default("fork")
  maxMemoryRestart  String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

Add `pm2Config Pm2Config?` relation to the `Project` model.

## API

### Module

`Pm2ConfigModule` — controller + service, registered in AppModule.

### Endpoints

**GET `/projects/:projectId/pm2-config`** (MinRole: VIEWER)

Response:
```json
{
  "config": {
    "script": null,
    "instances": 1,
    "execMode": "fork",
    "maxMemoryRestart": null
  },
  "info": {
    "name": "my-app",
    "cwd": "/var/www/my-app",
    "port": 3001,
    "detectedScript": "dist/main.js",
    "envVars": { "DATABASE_URL": "***" }
  },
  "preview": "module.exports = { apps: [{ ... }] };"
}
```

- `config`: Current Pm2Config record (or defaults if none exists)
- `info.detectedScript`: The script that would be used if `config.script` is null (auto-detection chain: startCommand > package.json scripts.start > package.json main > dist/main.js)
- `info.envVars`: Decrypted env vars with values masked for display
- `preview`: Generated ecosystem.config.js content

**PATCH `/projects/:projectId/pm2-config`** (MinRole: DEVELOPER)

Request body (all optional, partial update):
```json
{
  "script": "dist/main.js",
  "instances": 2,
  "execMode": "cluster",
  "maxMemoryRestart": "300M"
}
```

Flow:
1. Validate DTO
2. Upsert Pm2Config in database
3. Read project info (name, cwd, port, envVars)
4. Resolve effective script (explicit or auto-detected)
5. Build ecosystem config via extended `Pm2Stage.buildEcosystemConfig()`
6. Write ecosystem.config.js to project directory
7. Execute `pm2 restart <pm2Name>`
8. Return updated config + info + preview

### DTO Validation

```typescript
script?:            @IsOptional() @IsString()
instances?:         @IsOptional() @IsInt() @Min(1) @Max(16)
execMode?:          @IsOptional() @IsIn(['fork', 'cluster'])
maxMemoryRestart?:  @IsOptional() @Matches(/^\d+[KMG]$/i)
```

## Pm2Stage Extension

Extend `Pm2Config` interface and `buildEcosystemConfig()` to support new fields:

```typescript
interface Pm2Config {
  name: string;
  script: string;
  cwd: string;
  port: number;
  envVars: Record<string, string>;
  instances?: number;      // NEW
  execMode?: string;       // NEW
  maxMemoryRestart?: string; // NEW
}
```

Generated ecosystem.config.js output with new fields:
```javascript
module.exports = {
  apps: [{
    name: 'my-app',
    script: 'dist/main.js',
    cwd: '/var/www/my-app',
    instances: 2,
    exec_mode: 'cluster',
    max_memory_restart: '300M',
    env: {
      PORT: 3001,
      NODE_ENV: 'production',
      // ...custom vars
    }
  }]
};
```

Fields with `undefined`/`null` values are omitted from output (PM2 uses its own defaults).

## Frontend

### Hook: `usePm2Config`

File: `frontend/src/hooks/use-pm2-config.ts`

- `usePm2Config(projectId)` — GET query, key `['pm2-config', projectId]`
- `useUpdatePm2Config(projectId)` — PATCH mutation, invalidates query on success

### Page: `/projects/[id]/pm2/page.tsx`

Client component following the same pattern as the Nginx page:
- `useProject` for project data
- `usePm2Config` for config data
- Local form state initialized from fetched data
- `buildPreview()` function generates ecosystem.config.js string from form + info
- `useHighlightedCode()` for Shiki syntax highlighting
- Toast notifications on save success/error

### Sidebar

Add `{ href: 'pm2', label: 'PM2' }` to the Config group in `project-sidebar.tsx`, between Nginx and Webhooks.

## Error Handling

**Restart failure:** Config is saved to database, ecosystem.config.js is written, but `pm2 restart` fails. Toast shows the error message. No database rollback — the file and DB stay in sync, and the next manual restart will use the new config.

**No rollback rationale:** Unlike Nginx (which has `nginx -t` pre-validation), PM2 has no dry-run. Rolling back the DB while the filesystem has the new config creates inconsistency. Keeping them in sync is the safer choice.

## Scope

### In scope
- New Prisma model + migration
- Backend module (controller, service, DTO)
- Pm2Stage extension for new config fields
- Frontend page + hooks
- Sidebar navigation update
- Ecosystem.config.js preview with syntax highlighting

### Out of scope
- PM2 log_date_format, cron_restart, watch, max_restarts, min_uptime
- Real-time PM2 process status (cpu/memory monitoring)
- Moving env var editing into this page (stays in Settings)
