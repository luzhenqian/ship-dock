# Repository Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Repository" card to the project settings page that shows the linked GitHub repo, allows UPLOAD projects to connect a GitHub repo (switching to GITHUB type), and allows disconnecting (switching back to UPLOAD type).

**Architecture:** Extend the existing `PATCH /projects/:id` endpoint to handle `repoUrl` changes that trigger `sourceType` switching. Add webhook cleanup on disconnect. Frontend adds a new Card to the settings page with three states (connected, not connected, connect dialog).

**Tech Stack:** NestJS, Prisma, Next.js 16, React 19, shadcn components, repo-selector component

---

## File Structure

**Backend (modify):**
- `backend/src/projects/projects.service.ts` — Add repo connect/disconnect logic in `update()` method
- `backend/src/projects/projects.module.ts` — Import WebhooksModule for webhook cleanup access

**Frontend (modify):**
- `frontend/src/app/projects/[id]/settings/page.tsx` — Add Repository card with connected/not-connected states and connect dialog

---

### Task 1: Backend — Handle repo connect/disconnect in update()

**Files:**
- Modify: `backend/src/projects/projects.module.ts`
- Modify: `backend/src/projects/projects.service.ts:138-147`

- [ ] **Step 1: Import WebhooksModule in ProjectsModule**

In `backend/src/projects/projects.module.ts`, add the import so `ProjectsService` can access `WebhooksService` for webhook cleanup on disconnect:

```typescript
import { Module } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PortAllocationService } from './port-allocation.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [forwardRef(() => WebhooksModule)],
  controllers: [ProjectsController],
  providers: [ProjectsService, PortAllocationService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

Note: Use `forwardRef` because WebhooksModule likely depends on ProjectsModule (or shares common deps). Check if WebhooksModule exports WebhooksService — if not, you'll need to add the export there too.

- [ ] **Step 2: Check WebhooksModule exports WebhooksService**

Read `backend/src/webhooks/webhooks.module.ts`. Ensure `WebhooksService` is in the `exports` array. If not, add it.

- [ ] **Step 3: Update ProjectsService to inject WebhooksService and handle connect/disconnect**

In `backend/src/projects/projects.service.ts`, add the import and inject `WebhooksService`:

```typescript
// Add to imports at top
import { WebhooksService } from '../webhooks/webhooks.service';
import { Inject, forwardRef } from '@nestjs/common';
```

Update constructor to inject `WebhooksService`:

```typescript
constructor(
  private prisma: PrismaService,
  private encryption: EncryptionService,
  private portAllocation: PortAllocationService,
  private config: ConfigService,
  private dbProvisioner: DatabaseProvisionerService,
  @Inject(forwardRef(() => WebhooksService))
  private webhooksService: WebhooksService,
) {}
```

Replace the `update()` method (lines 138-147) with:

```typescript
async update(id: string, dto: UpdateProjectDto) {
  const data: any = { ...dto };

  // Handle repo connect/disconnect
  if ('repoUrl' in dto) {
    if (dto.repoUrl) {
      // Connect: switch to GITHUB
      data.sourceType = 'GITHUB';
      data.repoUrl = dto.repoUrl;
      data.branch = dto.branch || data.branch || 'main';
    } else {
      // Disconnect: switch to UPLOAD
      data.sourceType = 'UPLOAD';
      data.repoUrl = null;
      data.branch = 'main';
      data.githubInstallationId = null;

      // Clean up webhook if exists
      try {
        await this.webhooksService.deleteConfig(id);
      } catch {
        // No webhook configured — that's fine
      }
    }
  }

  if (data.envVars) {
    this.syncEnvFile(id, data.envVars);
    data.envVars = this.encryption.encrypt(JSON.stringify(data.envVars));
  }
  delete data.port;
  return this.prisma.project.update({ where: { id }, data });
}
```

- [ ] **Step 4: Verify the backend compiles**

Run: `cd /Users/noah/Work/idea/ship-dock/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/projects/projects.module.ts backend/src/projects/projects.service.ts backend/src/webhooks/webhooks.module.ts
git commit -m "feat: handle repo connect/disconnect in project update endpoint"
```

---

### Task 2: Frontend — Add Repository card to settings page

**Files:**
- Modify: `frontend/src/app/projects/[id]/settings/page.tsx`

- [ ] **Step 1: Read Next.js 16 docs for any relevant API changes**

Read `frontend/node_modules/next/dist/docs/` to check if there are relevant breaking changes for components used in this page (Dialog, form handling, etc.). This is required per AGENTS.md.

- [ ] **Step 2: Add state variables and imports**

At the top of `frontend/src/app/projects/[id]/settings/page.tsx`, add these imports:

```typescript
import { RepoSelector } from '@/components/repo-selector';
import { ExternalLink } from 'lucide-react';
```

Inside the component, after the existing `useState` declarations (around line 44), add:

```typescript
const [showConnectRepo, setShowConnectRepo] = useState(false);
const [connectRepoUrl, setConnectRepoUrl] = useState('');
const [connectBranch, setConnectBranch] = useState('main');
const [connectManual, setConnectManual] = useState(false);
const [connecting, setConnecting] = useState(false);
const [disconnecting, setDisconnecting] = useState(false);
const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
```

- [ ] **Step 3: Add connect handler function**

After the `handleDelete` function, add:

```typescript
async function handleConnectRepo() {
  if (!connectRepoUrl) return;
  setConnecting(true);
  try {
    await api(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ repoUrl: connectRepoUrl, branch: connectBranch }),
    });
    toast.success('Repository connected', {
      description: 'Redeploy to pull from GitHub.',
    });
    setShowConnectRepo(false);
    setConnectRepoUrl('');
    setConnectBranch('main');
    setConnectManual(false);
    refetch();
  } catch (err: any) {
    toast.error(`Failed to connect: ${err.message}`);
  } finally {
    setConnecting(false);
  }
}

async function handleDisconnectRepo() {
  setDisconnecting(true);
  try {
    await api(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ repoUrl: null }),
    });
    toast.success('Repository disconnected');
    refetch();
  } catch (err: any) {
    toast.error(`Failed to disconnect: ${err.message}`);
  } finally {
    setDisconnecting(false);
  }
}
```

- [ ] **Step 4: Add Repository card JSX**

In the JSX, after the closing `</Card>` of the "General" card (after line 133) and before the "Project Directory" card, insert the Repository card:

```tsx
<Card>
  <CardHeader><CardTitle>Repository</CardTitle></CardHeader>
  <CardContent>
    {project.sourceType === 'GITHUB' && project.repoUrl ? (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-mono hover:underline flex items-center gap-1"
          >
            {project.repoUrl.replace('https://github.com/', '')}
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-xs text-muted-foreground">{project.branch}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10"
          disabled={disconnecting}
          onClick={() => setShowDisconnectConfirm(true)}
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </Button>
      </div>
    ) : (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Connect a GitHub repository to enable git-based deployments. This will change the project source from file upload to GitHub.
        </p>
        <Button size="sm" onClick={() => setShowConnectRepo(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="mr-1.5"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          Connect Repository
        </Button>
      </div>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 5: Add Connect Repository Dialog**

After the existing `<Dialog>` for "Add Service Connection" (after line 430), add the connect dialog:

```tsx
<Dialog open={showConnectRepo} onOpenChange={(open) => {
  setShowConnectRepo(open);
  if (!open) { setConnectRepoUrl(''); setConnectBranch('main'); setConnectManual(false); }
}}>
  <DialogContent className="max-w-lg">
    <DialogHeader>
      <DialogTitle>Connect Repository</DialogTitle>
    </DialogHeader>
    <div className="space-y-4">
      {connectManual ? (
        <div className="space-y-3">
          <div>
            <Label>Repository URL</Label>
            <Input
              value={connectRepoUrl}
              onChange={(e) => setConnectRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="font-mono"
            />
          </div>
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => setConnectManual(false)}
          >
            Select from GitHub installations instead
          </button>
        </div>
      ) : (
        <RepoSelector
          onSelect={(url, defaultBranch) => {
            setConnectRepoUrl(url);
            setConnectBranch(defaultBranch);
          }}
          onSwitchToManual={() => setConnectManual(true)}
        />
      )}
      {connectRepoUrl && (
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-sm font-medium">Selected: <code className="bg-muted px-1 rounded text-xs">{connectRepoUrl}</code></p>
          <div>
            <Label>Branch</Label>
            <Input
              value={connectBranch}
              onChange={(e) => setConnectBranch(e.target.value)}
              placeholder="main"
              className="font-mono"
            />
          </div>
        </div>
      )}
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setShowConnectRepo(false)}>Cancel</Button>
      <Button disabled={!connectRepoUrl || connecting} onClick={handleConnectRepo}>
        {connecting ? 'Connecting...' : 'Connect'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<ConfirmDialog
  open={showDisconnectConfirm}
  onOpenChange={setShowDisconnectConfirm}
  title="Disconnect repository"
  description="This will disconnect the GitHub repository. The project will switch back to file upload mode and any configured webhook will be removed."
  onConfirm={handleDisconnectRepo}
  destructive
/>
```

- [ ] **Step 6: Verify the frontend compiles**

Run: `cd /Users/noah/Work/idea/ship-dock/frontend && npx next build`
Expected: Build succeeds (or use `npx tsc --noEmit` for faster type checking)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/projects/[id]/settings/page.tsx
git commit -m "feat: add repository card to project settings page"
```

---

### Task 3: Manual Testing

- [ ] **Step 1: Start backend and frontend dev servers**

```bash
cd /Users/noah/Work/idea/ship-dock/backend && npm run start:dev &
cd /Users/noah/Work/idea/ship-dock/frontend && npm run dev &
```

- [ ] **Step 2: Test GITHUB project — verify connected state**

Open a project that was created via GitHub. Go to Settings. Verify:
- Repository card shows between General and Project Directory
- Shows GitHub icon, repo name as clickable link, branch label
- "Disconnect" button is visible with red styling

- [ ] **Step 3: Test UPLOAD project — verify not-connected state**

Open a project that was created via file upload. Go to Settings. Verify:
- Repository card shows description text and "Connect Repository" button

- [ ] **Step 4: Test connect flow**

On the UPLOAD project, click "Connect Repository". Verify:
- Dialog opens with repo-selector (or manual URL input)
- Can enter a URL and branch
- Click "Connect" → toast appears, card updates to show connected state
- Refresh the page — state persists

- [ ] **Step 5: Test disconnect flow**

On the now-connected project, click "Disconnect". Verify:
- Confirm dialog appears with warning text
- Click confirm → toast appears, card updates to not-connected state
- Refresh the page — state persists, sourceType is UPLOAD
