# Repository Section in Project Settings

Add a "Repository" card to the project settings page that displays the linked GitHub repo for GITHUB projects, and allows UPLOAD projects to connect/disconnect a GitHub repository.

## UI Location

Settings page (`/projects/[id]/settings`), positioned between the "General" card and the "Project Directory" card.

## States

### 1. Connected (sourceType = GITHUB)

- GitHub icon + `owner/repo` as a clickable link (opens repo in new tab)
- Branch name shown as a secondary label
- "Disconnect" button (red outline style)

### 2. Not Connected (sourceType = UPLOAD)

- Description text: "Connect a GitHub repository to enable git-based deployments."
- "Connect Repository" button with GitHub icon

### 3. Connect Dialog

Triggered by clicking "Connect Repository". A Dialog containing:

- Reuse existing `repo-selector` component (supports selecting from GitHub installations or manual URL entry)
- Branch input field (default: "main")
- Cancel / Connect buttons

## Behavior

### Connect Flow

1. User clicks "Connect Repository"
2. Dialog opens with repo-selector + branch input
3. User selects/enters repo and branch, clicks "Connect"
4. Frontend calls `PATCH /projects/:id` with `{ repoUrl, branch }`
5. Backend updates: `sourceType` → `GITHUB`, sets `repoUrl`, `branch`, and optionally `githubInstallationId`
6. Dialog closes, Repository card updates to show connected state
7. Toast: "Repository connected. Redeploy to pull from GitHub."

### Disconnect Flow

1. User clicks "Disconnect"
2. ConfirmDialog: "This will disconnect the GitHub repository. The project will switch back to file upload mode and any configured webhook will be removed."
3. On confirm, frontend calls `PATCH /projects/:id` with `{ repoUrl: null }`
4. Backend updates: `sourceType` → `UPLOAD`, clears `repoUrl`, `branch` → `"main"`, clears `githubInstallationId`, deletes associated webhook (if any)
5. Card updates to show "not connected" state
6. Toast: "Repository disconnected."

## Backend Changes

### PATCH `/projects/:id` (UpdateProjectDto)

Extend the existing update endpoint logic:

**When `repoUrl` is provided (connecting):**
- Set `sourceType = 'GITHUB'`
- Set `repoUrl` and `branch` (default "main" if not provided)
- If the repo matches a known GitHub installation, set `githubInstallationId`

**When `repoUrl` is explicitly `null` (disconnecting):**
- Set `sourceType = 'UPLOAD'`
- Clear `repoUrl` (set to `null`)
- Reset `branch` to `"main"`
- Clear `githubInstallationId`
- Delete associated `WebhookConfig` and its webhook on GitHub (if exists)

### UpdateProjectDto

Add `repoUrl` as an optional nullable string field. `branch` is already supported.

## Schema Changes

None. All required fields already exist in the Project model:
- `repoUrl: String?`
- `branch: String @default("main")`
- `sourceType: SourceType` (GITHUB | UPLOAD)
- `githubInstallationId: String?`

## Files to Modify

### Frontend
- `frontend/src/app/projects/[id]/settings/page.tsx` — Add Repository card with three states and connect dialog

### Backend
- `backend/src/projects/dto/update-project.dto.ts` — Add `repoUrl` as optional nullable field
- `backend/src/projects/projects.service.ts` — Handle sourceType switching and webhook cleanup in `update()` method
