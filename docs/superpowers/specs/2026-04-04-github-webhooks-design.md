# GitHub Webhooks — Design Spec

## Overview

Add GitHub Webhook support to ship-dock so that users can configure automatic deployment triggers. When code is pushed, a PR is merged, or a release is published, GitHub sends a webhook to ship-dock, which filters and routes the event to the existing deploy pipeline.

Architecture is provider-based (GitHub first) with an interface that can be extended to GitLab, Bitbucket, etc.

---

## Data Model

### New Enums

```prisma
enum WebhookProvider {
  GITHUB
}

enum WebhookEventStatus {
  RECEIVED
  FILTERED
  TRIGGERED
  FAILED
  REPLAYED
}
```

### WebhookConfig

One-to-one with Project. Stores the webhook configuration and GitHub API state.

```prisma
model WebhookConfig {
  id               String          @id @default(uuid())
  projectId        String          @unique
  project          Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  enabled          Boolean         @default(true)
  secret           String          // AES-256 encrypted, auto-generated or user-provided
  githubToken      String          // AES-256 encrypted, per-project GitHub PAT
  githubWebhookId  Int?            // Webhook ID returned by GitHub API
  events           Json            // e.g. ["push", "pull_request", "release"]
  branchFilters    Json            @default("[]") // e.g. ["main", "release/*"]
  pathFilters      Json            @default("[]") // e.g. ["src/**", "package.json"]
  provider         WebhookProvider @default(GITHUB)
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
}
```

### WebhookEvent

Audit log for every incoming webhook request.

```prisma
model WebhookEvent {
  id            String             @id @default(uuid())
  projectId     String
  project       Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  provider      WebhookProvider
  deliveryId    String             @unique // X-GitHub-Delivery header, prevents replay attacks
  event         String             // GitHub event type, e.g. "push"
  action        String?            // Event subtype, e.g. "closed" for PR
  headers       Json               // Full request headers
  payload       Json               // Full GitHub payload
  status        WebhookEventStatus @default(RECEIVED)
  filterReason  String?            // Why the event was filtered out
  deploymentId  String?
  deployment    Deployment?        @relation(fields: [deploymentId], references: [id])
  error         String?            // Error message on failure
  processedAt   DateTime?
  createdAt     DateTime           @default(now())

  @@index([projectId, createdAt])
}
```

Add relations to existing models:

- `Project`: add `webhookConfig WebhookConfig?` and `webhookEvents WebhookEvent[]`
- `Deployment`: add `webhookEvent WebhookEvent?`

---

## Module Structure

```
backend/src/webhooks/
├── webhooks.module.ts              # NestJS module
├── webhooks.controller.ts          # Config CRUD + audit log API (JWT + RBAC)
├── webhooks-receiver.controller.ts # Public endpoint for GitHub callbacks (signature auth)
├── webhooks.service.ts             # Config management, event processing, audit
├── webhooks-filter.service.ts      # Branch and path filtering logic
├── guards/
│   └── webhook-signature.guard.ts  # Validates X-Hub-Signature-256
└── providers/
    ├── webhook-provider.interface.ts  # Abstract provider interface
    └── github.provider.ts            # GitHub API: register/update/delete webhooks
```

---

## Provider Interface

```typescript
interface WebhookProviderInterface {
  registerWebhook(
    repoUrl: string,
    callbackUrl: string,
    secret: string,
    events: string[],
    token: string,
  ): Promise<{ webhookId: number }>;

  updateWebhook(
    repoUrl: string,
    webhookId: number,
    events: string[],
    token: string,
  ): Promise<void>;

  deleteWebhook(
    repoUrl: string,
    webhookId: number,
    token: string,
  ): Promise<void>;

  verifySignature(
    payload: Buffer,
    signature: string,
    secret: string,
  ): boolean;

  parsePayload(
    event: string,
    payload: any,
  ): ParsedWebhookEvent;
}

interface ParsedWebhookEvent {
  branch: string | null;       // Extracted branch name
  commitHash: string | null;
  changedFiles: string[];      // For path filtering
  sender: string;              // GitHub username
  message: string;             // Commit message or PR title
}
```

---

## API Endpoints

### Webhook Configuration (JWT + RBAC)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `POST` | `/projects/:projectId/webhooks` | ADMIN | Create config, auto-register on GitHub |
| `GET` | `/projects/:projectId/webhooks` | DEVELOPER | Get current config (no secret/token plaintext) |
| `PATCH` | `/projects/:projectId/webhooks` | ADMIN | Update config, sync changes to GitHub |
| `DELETE` | `/projects/:projectId/webhooks` | ADMIN | Delete config, unregister from GitHub |
| `POST` | `/projects/:projectId/webhooks/regenerate-secret` | ADMIN | Regenerate secret, update on GitHub |

### Audit Log (JWT + RBAC)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/projects/:projectId/webhooks/events` | DEVELOPER | Paginated event list (filter by status) |
| `GET` | `/projects/:projectId/webhooks/events/:eventId` | DEVELOPER | Full event detail (payload, headers) |
| `POST` | `/projects/:projectId/webhooks/events/:eventId/replay` | ADMIN | Re-process stored payload |

### Webhook Receiver (Public, Signature Auth)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/webhooks/receive/:projectId` | Signature | GitHub callback endpoint |

---

## Processing Flow

### Create Webhook

1. User submits `{ githubToken, events, branchFilters?, pathFilters?, secret? }`
2. Auto-generate secret if not provided (32-byte random hex)
3. Call `GitHubProvider.registerWebhook()` via GitHub API
4. Store config with encrypted token and secret
5. Return config with secret in plaintext (one-time only)

### Receive Webhook

1. `POST /webhooks/receive/:projectId` hit by GitHub
2. `WebhookSignatureGuard`: lookup secret by projectId, verify `X-Hub-Signature-256` using `crypto.timingSafeEqual`
3. Check `X-GitHub-Delivery` uniqueness (reject duplicates)
4. Create `WebhookEvent` record (status: RECEIVED)
5. Check config enabled + event type in `events` list
6. `WebhooksFilterService` runs branch + path filters
7. Pass → call `DeployService.triggerDeployment()`, link deploymentId, status → TRIGGERED
8. Filtered → status → FILTERED, record `filterReason`
9. Error → status → FAILED, record `error`
10. Return `200 OK` immediately (processing is fast; deploy is already async via BullMQ)

### Replay Webhook

1. Load original `WebhookEvent` by ID
2. Create a new `WebhookEvent` record with a generated `deliveryId` (prefixed `replay-` + UUID to distinguish from GitHub-originated deliveries)
3. Re-run steps 5-9 from "Receive Webhook" using stored payload against the new event record
4. New event status → REPLAYED if triggered, FILTERED if filtered out
5. Original event remains unchanged for audit trail

---

## Filtering Logic

### Branch Filter

- Extract branch from payload:
  - `push`: `ref` field, strip `refs/heads/` prefix
  - `pull_request`: `pull_request.base.ref` (target branch)
  - `release`: `release.target_commitish`
- Match against `branchFilters` using glob patterns (e.g. `main`, `release/*`)
- Empty `branchFilters` = no filtering, all branches pass

### Path Filter

- Extract changed files from payload:
  - `push`: union of `commits[].added`, `commits[].modified`, `commits[].removed`
  - `pull_request`: fetch via GitHub API (`GET /repos/:owner/:repo/pulls/:number/files`) using stored token
  - `release`: skip path filtering (no file-level info)
- Match: if any changed file matches any path pattern, pass
- Empty `pathFilters` = no filtering, all changes pass

### Event Filter

- Check `X-GitHub-Event` header against `events` list
- Special case: `pull_request` only triggers on `action: "closed"` + `merged: true`

---

## Security

### Signature Verification

- HMAC-SHA256 using stored secret
- Compare with `crypto.timingSafeEqual` to prevent timing attacks
- Raw body required: configure NestJS with `rawBody: true` on the receiver endpoint

### Encrypted Storage

- `githubToken` and `secret` encrypted with existing `EncryptionService` (AES-256)
- Secret plaintext returned only on creation
- GET endpoints never return token or secret plaintext

### Anti-Replay

- `X-GitHub-Delivery` header stored as `deliveryId` with unique constraint
- Duplicate delivery IDs rejected

### Rate Limiting

- Receiver endpoint: max 30 requests per projectId per minute
- Prevents abuse from misconfigured or malicious sources

### RBAC

- Config management: ADMIN
- Audit log read: DEVELOPER
- Replay: ADMIN
- Receiver: no JWT, signature-only

---

## Frontend

### Project Settings — Webhooks Tab

**Unconfigured state**: Guide card with "Configure Webhook" button.

**Configuration form**:
- GitHub Token (password input)
- Events (checkboxes: push, pull_request, release, etc.)
- Branch filters (tag input with glob support)
- Path filters (tag input with glob support)

**Configured state**: Status card showing:
- Enabled/disabled toggle
- Webhook URL (read-only, copy button)
- Events and filter summary
- Edit / Delete / Regenerate Secret buttons

**Secret display**: Modal shown once on creation, with copy button and warning to save.

### Audit Log Section

- Table: timestamp, event type, branch, status (color-coded badge), linked deployment
- Row click → expand to full payload, headers, filterReason/error
- FAILED events show "Replay" button
- Pagination + status filter dropdown

### New React Query Hooks

- `use-webhooks.ts` — config CRUD, regenerate secret
- `use-webhook-events.ts` — event list, detail, replay
