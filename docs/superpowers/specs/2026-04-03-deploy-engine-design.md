# Ship Dock - Deploy Engine Design Spec

## Overview

Ship Dock is a web-based deployment and management dashboard for managing multiple Node.js projects on a single AWS EC2 instance. This spec covers **Phase 1: Deploy Engine** — the core deployment pipeline that takes a GitHub repo URL or uploaded source code and deploys it as a PM2 + Nginx service with automatic SSL.

**Tech Stack:**
- Frontend: Next.js (deployed to Vercel)
- Backend: NestJS + Prisma (deployed on EC2 as a PM2 process)
- Database: PostgreSQL (shared instance, dedicated database)
- Queue: BullMQ (using existing Redis instance)
- Realtime: Socket.io

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────────────────────┐
│   Next.js (Vercel)  │◄──REST──►│     NestJS API (EC2, PM2)               │
│                     │  + WS    │                                          │
│  - Dashboard UI     │         │  ┌─────────────┐  ┌──────────────────┐   │
│  - Deploy forms     │         │  │ Auth Module  │  │ Deploy Module    │   │
│  - Realtime logs    │         │  │ (JWT + RBAC) │  │ (Pipeline Engine)│   │
│  - Domain mgmt      │         │  └─────────────┘  └───────┬──────────┘   │
│                     │         │                           │              │
│                     │         │  ┌─────────────┐  ┌───────▼──────────┐   │
│                     │         │  │ Domain Module│  │ BullMQ Workers   │   │
│                     │         │  │ (DNS + SSL)  │  │ (exec stages)    │   │
│                     │         │  └─────────────┘  └──────────────────┘   │
│                     │         │                                          │
│                     │         │  ┌──────────────────────────────────┐    │
│                     │         │  │ PostgreSQL (Prisma)   │  Redis   │    │
│                     │         │  │ - users, projects     │  - BullMQ│    │
│                     │         │  │ - deployments, logs   │  - queue │    │
│                     │         │  └──────────────────────────────────┘    │
│                     │         │                                          │
│                     │         │  Local ops: PM2 CLI / Nginx / Certbot    │
└─────────────────────┘         └──────────────────────────────────────────┘
```

Key points:
- NestJS backend runs as a PM2 process on the same EC2 instance
- Deployment operations execute local commands via `child_process` (git, npm, pm2, nginx, certbot)
- BullMQ reuses the existing Redis instance for job queuing
- Frontend communicates via REST API + WebSocket (Socket.io)
- PostgreSQL stores all persistent data (shared PG instance, dedicated `ship_dock` database)

## Data Model

### User
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| email | String | Unique |
| password | String | bcrypt hash |
| name | String | |
| avatar | String? | Nullable |
| role | Enum | OWNER, ADMIN, DEVELOPER, VIEWER |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### Project
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| name | String | Display name |
| slug | String | Unique, used for directory name and PM2 process name |
| repoUrl | String? | GitHub repo URL, null for upload-based projects |
| branch | String | Default: "main" |
| sourceType | Enum | GITHUB, UPLOAD |
| domain | String? | e.g. app1.example.com |
| port | Int | Auto-assigned or manual |
| envVars | String | AES-256 encrypted JSON |
| pipeline | JSON | Deployment pipeline config |
| pm2Name | String | PM2 process name (= slug) |
| status | Enum | ACTIVE, STOPPED, ERROR |
| createdById | UUID | FK → User |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### Deployment
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| projectId | UUID | FK → Project |
| triggeredById | UUID | FK → User |
| version | Int | Auto-increment per project (#1, #2, #3...) |
| commitHash | String? | Null for upload-based deploys |
| status | Enum | QUEUED, RUNNING, SUCCESS, FAILED, CANCELLED |
| stages | JSON | Per-stage status and log output |
| startedAt | DateTime? | |
| finishedAt | DateTime? | |
| createdAt | DateTime | |

### DomainProvider
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| provider | Enum | NAMECHEAP, GODADDY |
| apiKey | String | AES-256 encrypted |
| apiSecret | String | AES-256 encrypted |
| createdById | UUID | FK → User |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### PortAllocation
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | PK |
| port | Int | Unique, range 3001-3999 |
| projectId | UUID? | FK → Project, null = available |
| allocatedAt | DateTime? | |

### Role Permissions

| Action | OWNER | ADMIN | DEVELOPER | VIEWER |
|--------|-------|-------|-----------|--------|
| Manage users | Y | Y | N | N |
| Create/delete projects | Y | Y | N | N |
| Deploy/rollback | Y | Y | Y | N |
| Edit pipeline | Y | Y | Y | N |
| View logs/status | Y | Y | Y | Y |
| Manage domain providers | Y | Y | N | N |

Roles are linear: OWNER > ADMIN > DEVELOPER > VIEWER. No resource-level permissions.

## Deploy Pipeline Engine

### Default Pipeline Config

```json
{
  "stages": [
    { "name": "clone", "type": "builtin", "config": {} },
    { "name": "install", "type": "command", "command": "npm install" },
    { "name": "migrate", "type": "command", "command": "npx prisma migrate deploy" },
    { "name": "build", "type": "command", "command": "npm run build" },
    { "name": "pm2", "type": "builtin", "config": {} },
    { "name": "nginx", "type": "builtin", "config": {} },
    { "name": "ssl", "type": "builtin", "config": {} }
  ]
}
```

### Stage Types

- **`builtin`** — System-managed logic with configurable parameters:
  - `clone`: git clone (first deploy) or git pull (subsequent), or extract uploaded archive
  - `pm2`: Generate ecosystem.config.js, run pm2 start/restart
  - `nginx`: Generate nginx server block config, run `nginx -t && nginx -s reload`
  - `ssl`: Run certbot to obtain Let's Encrypt certificate (first deploy or domain change only)
- **`command`** — User-defined shell command executed in the project directory
- Users can add optional stages like `seed` (`npx prisma db seed`)

### Execution Flow

```
User clicks "Deploy"
  → Create Deployment record (status: QUEUED)
  → Push job to BullMQ queue
  → Worker picks up job
  → Execute stages sequentially:
      → Update stage status: RUNNING
      → Execute command, stream stdout/stderr via WebSocket
      → Success → stage status: SUCCESS → next stage
      → Failure → stage status: FAILED → Deployment marked FAILED, stop
  → All stages pass → Deployment status: SUCCESS
```

### Retry and Rollback

- **Stage-level retry:** Resume from the failed stage without re-running earlier stages
- **Rollback:** Re-deploy the last successful Deployment version (re-run pipeline with previous commitHash)
- **Cancel:** Kill running process, mark deployment as CANCELLED

### Project Directory Layout

```
/var/www/
├── ship-dock-api/          ← Dashboard backend
├── project-a/              ← Named by project.slug
├── project-b/
└── project-c/
```

## Domain and SSL Management

### Domain Configuration Flow

```
User sets domain in project settings (e.g. app.example.com)
  → Detect domain type:
      A) Subdomain → Add DNS A record pointing to EC2 public IP
      B) New domain registration → Call registrar API to purchase → then same as A
  → Call provider API (Namecheap / GoDaddy) to add A record
  → Poll for DNS propagation (timeout: 10 minutes)
  → DNS resolved → Trigger SSL certificate request
```

### DNS Management

- Users configure domain provider API credentials in Dashboard (stored in `DomainProvider` table)
- System reads domain lists from provider via API
- CRUD operations on DNS records (A, CNAME, etc.) through provider APIs
- Domain registration: Namecheap `domains.create` / GoDaddy `/v1/domains/purchase`

### SSL Certificates

- Certbot (standalone or webroot mode) for Let's Encrypt certificates
- Auto-request on first deploy or domain change
- Auto-renewal handled by certbot's built-in cron (`certbot renew`)
- Cert paths: `/etc/letsencrypt/live/{domain}/`

### Nginx Config Template

Per-project config generated at `/etc/nginx/sites-available/{slug}.conf`, symlinked to `sites-enabled/`:

```nginx
server {
    listen 80;
    server_name {domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name {domain};

    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:{port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Authentication and Authorization

### Auth Flow

- JWT + Refresh Token dual-token mechanism
- Access Token: 15-minute expiry, sent in Authorization header
- Refresh Token: 7-day expiry, stored in httpOnly cookie
- First launch triggers setup wizard to create OWNER account

### User Invitation

- No public registration; OWNER/ADMIN invite users only
- Invite flow: Generate invite link (one-time token, 48-hour expiry) → Invitee registers via link
- Registration requires: email, password, name

### RBAC Implementation

NestJS Guards + custom decorators:

```typescript
@Role(Role.DEVELOPER)
@Post('projects/:id/deploy')
async deploy(@Param('id') id: string) { ... }
```

- Permission checks in Guard layer
- Four linear roles: OWNER > ADMIN > DEVELOPER > VIEWER

### API Security

- All endpoints require authentication (except login, invite registration)
- Sensitive operations (delete project, manage users) require ADMIN+
- API keys (domain provider credentials) encrypted at rest, API returns masked values (`****abcd`)
- AES-256 encryption key read from `ENCRYPTION_KEY` environment variable on the Ship Dock backend

## Realtime Communication

### WebSocket (Socket.io)

**Deployment log streaming:**
- User opens deployment detail page → join room `deployment:{deploymentId}`
- Worker streams stdout/stderr line-by-line via WebSocket during each stage
- Frontend renders terminal-style log output in realtime
- Final status (SUCCESS/FAILED) pushed on completion

**Dashboard status updates:**
- Project status changes pushed to room `dashboard`
- All connected users see live status indicator updates

### WebSocket Auth

- JWT passed via `auth` parameter on connection
- Server validates token in `handleConnection`, disconnects on invalid
- Permissions match REST API (VIEWER can receive but not trigger actions)

## File Upload

- Frontend: drag-and-drop or file picker to select project folder
- Browser-side compression to `.tar.gz` using `fflate`
- Upload via HTTP `multipart/form-data`
- Backend extracts to `/var/www/{slug}/`
- Max file size: 200MB
- Upload triggers deployment pipeline (skips `clone` stage)

## Frontend Pages

```
/login                    — Login page
/setup                    — First-time setup (create OWNER account)
/invite/:token            — Invite registration page

/dashboard                — Home: project cards overview (status, domain, last deploy)
/projects/new             — New project (GitHub URL or file upload)
/projects/:id             — Project detail
  ├── /deployments        — Deployment history list
  ├── /deployments/:did   — Deployment detail (realtime logs, stage progress)
  ├── /settings           — Project settings (domain, port, env vars)
  └── /pipeline           — Pipeline editor (drag-and-drop stages)

/domains                  — Domain provider management + DNS record editor
/team                     — User management (invite, role assignment)
/settings                 — System settings (EC2 info, port range, etc.)
```

### Key Interactions

- **Dashboard:** Card layout, each project shows name, status indicator (green/yellow/red), domain, last deploy time
- **New Project:** Step-by-step form — ① Source (GitHub/Upload) → ② Basic info (name, domain, port) → ③ Env vars → ④ Pipeline preview → ⑤ Confirm and deploy
- **Deployment Detail:** Left: stage list with status icons. Right: terminal-style log output, auto-scrolling
- **Pipeline Editor:** Visual stage list with drag-and-drop reorder, add/remove/edit stages

### Frontend Tech

- UI components: **shadcn/ui** (Tailwind-based)
- Server state: **TanStack Query (React Query)**
- WebSocket: **socket.io-client**
- Forms: **React Hook Form + Zod** validation
- Drag-and-drop: **dnd-kit** (pipeline editor)

## Future Phases (Out of Scope)

- Phase 2: Operations Dashboard (PM2 logs, Redis data viewer, PostgreSQL data browser)
- Phase 3: Domain management UI enhancements (bulk operations, domain marketplace)
- Phase 4: Monitoring and alerting (resource usage, uptime, notifications)
