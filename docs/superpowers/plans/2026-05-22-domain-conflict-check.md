# Domain Conflict Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating or updating a project with a domain, check if the domain's A record points to a different IP and ask the user for confirmation before proceeding.

**Architecture:** New `POST /api/projects/check-domain` backend endpoint resolves DNS and returns conflict info. New `useDomainCheck()` frontend hook wraps the API call + confirmation dialog state. Both the project creation page and settings page call the hook before submitting.

**Tech Stack:** Node.js `dns/promises` (backend), React hook + existing `ConfirmDialog` component (frontend)

---

### Task 1: Backend — DTO and service method

**Files:**
- Create: `backend/src/projects/dto/check-domain.dto.ts`
- Modify: `backend/src/projects/projects.service.ts`

- [ ] **Step 1: Create the DTO**

Create `backend/src/projects/dto/check-domain.dto.ts`:

```typescript
import { IsString } from 'class-validator';

export class CheckDomainDto {
  @IsString()
  domain: string;
}
```

- [ ] **Step 2: Add `checkDomain` method to ProjectsService**

In `backend/src/projects/projects.service.ts`, add this method after the `checkPortAvailability` method (after line 72):

```typescript
async checkDomain(domain: string): Promise<{ status: 'available' | 'conflict' | 'unknown'; currentIp?: string; message?: string }> {
  const { resolve4 } = await import('dns/promises');
  const serverIp = this.config.get('SERVER_IP');
  try {
    const addresses = await resolve4(domain);
    if (!serverIp || addresses.includes(serverIp)) {
      return { status: 'available' };
    }
    return { status: 'conflict', currentIp: addresses[0] };
  } catch (err: any) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      return { status: 'available' };
    }
    return { status: 'unknown', message: err.message || 'DNS resolution failed' };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/projects/dto/check-domain.dto.ts backend/src/projects/projects.service.ts
git commit -m "feat: add checkDomain service method and DTO"
```

---

### Task 2: Backend — Controller endpoint

**Files:**
- Modify: `backend/src/projects/projects.controller.ts`

- [ ] **Step 1: Add import for CheckDomainDto**

At the top of `backend/src/projects/projects.controller.ts`, add to the existing imports:

```typescript
import { CheckDomainDto } from './dto/check-domain.dto';
```

- [ ] **Step 2: Add the endpoint**

In `backend/src/projects/projects.controller.ts`, add this method before the `create` method (before line 73). It must come before `:id` routes to avoid being caught by the param route:

```typescript
@Post('check-domain') @MinRole('VIEWER')
checkDomain(@Body() dto: CheckDomainDto) { return this.projectsService.checkDomain(dto.domain); }
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/projects/projects.controller.ts
git commit -m "feat: add POST /projects/check-domain endpoint"
```

---

### Task 3: Frontend — useDomainCheck hook

**Files:**
- Create: `frontend/src/hooks/use-domain-check.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/use-domain-check.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

type CheckResult = { status: 'available' } | { status: 'conflict'; currentIp: string } | { status: 'unknown'; message: string };

export function useDomainCheck() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentIp, setCurrentIp] = useState('');
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const checkAndConfirm = useCallback(async (domain: string): Promise<boolean> => {
    if (!domain) return true;
    try {
      const result = await api<CheckResult>('/projects/check-domain', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      if (result.status === 'available') return true;
      if (result.status === 'unknown') {
        toast.warning('DNS 解析失败，无法验证域名指向');
        return true;
      }
      setCurrentIp(result.currentIp);
      setDialogOpen(true);
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
      });
    } catch {
      toast.warning('域名检查失败，跳过验证');
      return true;
    }
  }, []);

  const onConfirm = useCallback(() => {
    setDialogOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const onCancel = useCallback(() => {
    setDialogOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return {
    checkAndConfirm,
    dialogProps: { open: dialogOpen, onOpenChange: (v: boolean) => { if (!v) onCancel(); }, currentIp, onConfirm, onCancel },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-domain-check.ts
git commit -m "feat: add useDomainCheck hook"
```

---

### Task 4: Frontend — Integrate into project creation page

**Files:**
- Modify: `frontend/src/app/projects/new/page.tsx`

- [ ] **Step 1: Add imports**

At the top of the file, add:

```typescript
import { useDomainCheck } from '@/hooks/use-domain-check';
import { ConfirmDialog } from '@/components/confirm-dialog';
```

- [ ] **Step 2: Initialize the hook**

Inside the `NewProjectPage` component, after the line `const [uploading, setUploading] = useState(false);` (line 82), add:

```typescript
const domainCheck = useDomainCheck();
```

- [ ] **Step 3: Add domain check to handleCreate**

In the `handleCreate` function, add the domain check right after `setCreateError('');` (line 277) and before the `try` block:

```typescript
async function handleCreate() {
  setCreateError('');
  if (form.domain) {
    const ok = await domainCheck.checkAndConfirm(form.domain);
    if (!ok) return;
  }
  try {
```

- [ ] **Step 4: Add the confirmation dialog**

Right before the closing `</div>` of the component (before the last `</div>` at line 826), add:

```tsx
<ConfirmDialog
  open={domainCheck.dialogProps.open}
  onOpenChange={domainCheck.dialogProps.onOpenChange}
  title="域名已被使用"
  description={`该域名当前指向 ${domainCheck.dialogProps.currentIp}，与本服务器 IP 不同。是否仍要使用此域名？`}
  onConfirm={domainCheck.dialogProps.onConfirm}
  destructive={false}
/>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/projects/new/page.tsx
git commit -m "feat: add domain conflict check to project creation"
```

---

### Task 5: Frontend — Integrate into settings page

**Files:**
- Modify: `frontend/src/app/projects/[id]/settings/page.tsx`

- [ ] **Step 1: Add import**

At the top of the file, add:

```typescript
import { useDomainCheck } from '@/hooks/use-domain-check';
```

- [ ] **Step 2: Initialize the hook**

Inside the component, after the `const [fileTotalLimit, setFileTotalLimit] = useState(1024);` line (line 77), add:

```typescript
const domainCheck = useDomainCheck();
```

- [ ] **Step 3: Add domain check to handleSave**

In the `handleSave` function, add the domain check before the `setSaving(true)` line. The function should check if the domain changed and is non-empty:

```typescript
async function handleSave() {
  if (domain && domain !== (project?.domain || '')) {
    const ok = await domainCheck.checkAndConfirm(domain);
    if (!ok) return;
  }
  setSaving(true);
```

- [ ] **Step 4: Add the confirmation dialog**

Right before the closing `</div>` of the component (before the final `</div>` at line 1001), add:

```tsx
<ConfirmDialog
  open={domainCheck.dialogProps.open}
  onOpenChange={domainCheck.dialogProps.onOpenChange}
  title="域名已被使用"
  description={`该域名当前指向 ${domainCheck.dialogProps.currentIp}，与本服务器 IP 不同。是否仍要使用此域名？`}
  onConfirm={domainCheck.dialogProps.onConfirm}
  destructive={false}
/>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/projects/[id]/settings/page.tsx
git commit -m "feat: add domain conflict check to project settings"
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Verify frontend compiles**

Run: `cd frontend && npx next build --no-lint`
Expected: Build succeeds

- [ ] **Step 3: Manual test plan**

1. Create a new project with a domain that resolves to a different IP (e.g. `google.com`) → should see confirmation dialog showing the current IP
2. Click Cancel → project should not be created
3. Click Confirm → project should be created normally
4. Create a project with a domain that doesn't exist → should proceed without dialog
5. In Settings, change domain to one pointing elsewhere → should see confirmation dialog
6. In Settings, save without changing domain → should not trigger check
