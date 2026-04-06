# GitHub App Integration Design

## Overview

Replace manual Personal Access Token (PAT) input with a GitHub App integration as the primary method for connecting GitHub repositories and receiving webhooks. Users install the GitHub App once at the account level, then select repositories from a list when creating projects. Webhooks are received automatically via a unified App-level endpoint — zero configuration needed.

Manual PAT token input is retained as a fallback for GitHub Enterprise or users who prefer not to install an App.

## Motivation

Current flow requires users to:
1. Navigate to GitHub Settings → Developer Settings → Personal Access Tokens
2. Create a token with `repo` and `admin:repo_hook` permissions
3. Copy the token back into Ship Dock's webhook configuration UI

This is friction-heavy and error-prone. GitHub App installation is a single click — the standard UX for platforms like Vercel and Netlify.

## Data Model Changes

### New Model: `GitHubInstallation`

```prisma
model GitHubInstallation {
  id               String   @id @default(uuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  installationId   Int      @unique  // GitHub App Installation ID
  accountLogin     String             // GitHub username or org name
  accountType      String             // "User" | "Organization"
  projects         Project[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

### Modified Model: `Project`

Add optional relation to `GitHubInstallation`:

```prisma
model Project {
  // ... existing fields ...
  githubInstallationId String?
  githubInstallation   GitHubInstallation? @relation(fields: [githubInstallationId], references: [id], onDelete: SetNull)
}
```

Existing `repoUrl`, `branch`, and `sourceType` fields are unchanged.

### `WebhookConfig` — No Changes

`WebhookConfig` is retained for the manual token fallback. Projects connected via GitHub App do not need a `WebhookConfig` record — webhooks are received automatically through the App-level endpoint.

## User Flows

### 1. Connect GitHub (Account Settings)

1. User navigates to Settings and clicks "Connect GitHub"
2. Redirects to `https://github.com/apps/<app-name>/installations/new`
3. User selects account/org, chooses repositories (all or selected), and installs
4. GitHub redirects to `/api/github/callback?installation_id=xxx&setup_action=install`
5. Backend stores `GitHubInstallation` record linked to the current user
6. Frontend callback page (`/github/callback`) receives the result and redirects to Settings with a success state

### 2. Create Project (Repository Selection)

When the user has a connected GitHub installation:
1. Show a searchable repository list fetched via Installation Access Token (`GET /installation/repositories`)
2. User selects a repo — `repoUrl`, `branch`, and `githubInstallationId` are set automatically
3. A "Enter URL manually" toggle switches to the existing manual input mode
4. Manual input mode is also the default when no GitHub installation exists

### 3. Webhook Reception (Automatic)

1. GitHub App sends all subscribed events to the unified endpoint: `POST /api/webhooks/github`
2. Backend verifies the signature using the App's webhook secret (HMAC-SHA256, timing-safe comparison)
3. Backend extracts `repository.full_name` from the payload and matches it to a project via `repoUrl`
4. If no matching project is found, the event is ignored (logged at debug level)
5. Existing filter logic applies: event type filter, branch filter (minimatch), path filter (minimatch)
6. If filters pass, a deployment is triggered
7. Event is logged in `WebhookEvent` table with `provider: GITHUB`

### 4. Webhook Configuration Page

- If the project is connected via GitHub App: display "Webhooks are automatically configured via GitHub App" with the active filters (branch/path). No token input shown.
- If the project uses manual token (fallback): show the existing webhook configuration UI unchanged.
- Branch and path filters remain configurable in both modes.

### 5. Disconnect / Uninstall

- User can disconnect a GitHub installation from Settings
- Backend deletes the `GitHubInstallation` record
- Projects linked to that installation have `githubInstallationId` set to null (via `onDelete: SetNull`)
- Those projects stop receiving webhook events until reconfigured (manual token or reinstall App)
- GitHub also sends an `installation.deleted` webhook event when a user uninstalls the App from GitHub directly — backend handles this by removing the record

## Backend Architecture

### New Module: `GitHubAppModule`

#### `GitHubAppService`

- `getInstallationAccessToken(installationId: number): Promise<string>` — generates a JWT signed with the App private key, exchanges it for an Installation Access Token via `POST /app/installations/{id}/access_tokens`. Caches tokens in Redis with TTL slightly less than 1 hour.
- `listRepositories(installationId: number): Promise<Repository[]>` — fetches accessible repos using the Installation Access Token.
- `handleInstallationEvent(payload)` — processes `installation.deleted` and `installation.created` webhook events to keep `GitHubInstallation` records in sync.

#### `GitHubAppController`

- `GET /api/github/installations` — list current user's GitHub installations
- `GET /api/github/callback` — handle GitHub App installation callback (requires authenticated user via JWT; stores installation linked to current user, redirects to frontend)
- `GET /api/github/repositories?installationId=xxx` — list repos for an installation
- `DELETE /api/github/installations/:id` — disconnect an installation

### Modified: Webhook Reception

#### New: `POST /api/webhooks/github` (App-level endpoint)

- No auth guard (public endpoint, signature-verified)
- Verify signature using `GITHUB_APP_WEBHOOK_SECRET`
- Route based on event type:
  - `installation.*` events → `GitHubAppService.handleInstallationEvent()`
  - Repository events (push, pull_request, etc.) → existing deployment pipeline
- Match project by `repository.full_name` against `Project.repoUrl`
- Apply existing `WebhooksFilterService` logic for branch/path filtering
- Log event in `WebhookEvent` table

#### Existing: `POST /api/webhooks/receive/:projectId` (per-project endpoint)

- Unchanged — continues to work for manual token fallback projects
- Existing `WebhookSignatureGuard` and flow remain as-is

## Frontend Changes

### New Components

- **Settings page: GitHub connection section** — shows connected installations (account name, type, connected date), "Connect GitHub" button, "Disconnect" action per installation
- **GitHub callback page** (`/github/callback`) — handles redirect from GitHub, shows loading state, then redirects to settings
- **Repository selector component** — searchable list of repos from connected installations, with "Enter URL manually" toggle

### Modified Pages

- **Create project page** (`/projects/new`) — integrate repository selector when GitHub is connected; fall back to URL input when not connected or user toggles manual mode
- **Webhook configuration page** (`/projects/[id]/webhooks`) — conditional UI based on connection type (GitHub App vs manual token)

## Environment Variables

```bash
GITHUB_APP_ID=                    # App ID from GitHub App settings
GITHUB_APP_PRIVATE_KEY=           # PEM private key (base64-encoded for env var)
GITHUB_APP_WEBHOOK_SECRET=        # Secret for verifying App-level webhook signatures
GITHUB_APP_CLIENT_ID=             # OAuth Client ID (from GitHub App settings)
GITHUB_APP_CLIENT_SECRET=         # OAuth Client Secret
GITHUB_APP_SLUG=                  # App slug for installation URL construction
```

These are added to `deploy.config.sh` and the deploy script.

## GitHub App Configuration

When creating the GitHub App on GitHub:

- **Webhook URL:** `https://<api-domain>/api/webhooks/github`
- **Webhook secret:** value of `GITHUB_APP_WEBHOOK_SECRET`
- **Permissions:**
  - Repository contents: Read — for fetching repo info and code
  - Metadata: Read — required, for listing repositories
- **Subscribe to events:** Push, Pull request, Create, Delete, Release
- **Installation scope:** "Any account" (allows users and orgs to install)

## Security Considerations

- **Installation Access Tokens** are cached in Redis with a TTL of 55 minutes (tokens expire at 1 hour). Cache key: `github:iat:{installationId}`.
- **App private key** is injected via environment variable, never stored in the database.
- **Webhook signature verification** uses HMAC-SHA256 with timing-safe comparison (same approach as current implementation, different secret source).
- **Installation callback** verifies the `installation_id` parameter by calling GitHub's API to confirm the installation exists and is accessible.
- **Existing encryption** of manual tokens in `WebhookConfig` is unchanged.

## Migration Path

- Existing projects using manual PAT tokens continue to work unchanged
- No forced migration — users can optionally connect GitHub App and re-link existing projects
- Both webhook endpoints (`/api/webhooks/github` and `/api/webhooks/receive/:projectId`) coexist
