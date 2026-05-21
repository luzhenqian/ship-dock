# Domain Conflict Check

When a user sets a domain on a project (create or update), validate whether its DNS A record already points to a different server. If it does, show the current IP and ask for confirmation before proceeding.

## Backend

### New endpoint: `POST /api/projects/check-domain`

Added to `ProjectsController`. Accepts `{ domain: string }` and returns one of three statuses.

**Logic:**
1. Resolve the domain's A records using `dns/promises.resolve4(domain)`
2. Compare against `SERVER_IP` from config

**Response shape:**
```typescript
type CheckDomainResponse =
  | { status: 'available' }
  | { status: 'conflict'; currentIp: string }
  | { status: 'unknown'; message: string }
```

| Condition | Response |
|-----------|----------|
| No A record (ENOTFOUND) | `{ status: "available" }` |
| A record matches SERVER_IP | `{ status: "available" }` |
| A record points elsewhere | `{ status: "conflict", currentIp: "<ip>" }` |
| DNS resolution timeout/error | `{ status: "unknown", message: "..." }` |

**Notes:**
- No new module needed — lives in `ProjectsController`/`ProjectsService`
- Does not block saving. The endpoint is informational; the frontend decides whether to proceed.
- Create/update endpoints remain unchanged

### DTO

New `CheckDomainDto` with a single `@IsString()` `domain` field.

## Frontend

### Shared hook: `useDomainCheck()`

Encapsulates the check-domain call and confirmation dialog state. Used by both the project creation page and the Settings page.

**Interface:**
```typescript
function useDomainCheck(): {
  checkAndConfirm: (domain: string) => Promise<boolean>;
  dialogProps: {
    open: boolean;
    currentIp: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
}
```

`checkAndConfirm(domain)` returns a Promise that resolves to:
- `true` — domain is available, unknown, or user confirmed the conflict → proceed with save
- `false` — user cancelled the conflict dialog → do not save

### Confirmation dialog

Reuses the existing `ConfirmDialog` component with `destructive={false}` and no `confirmText` (no typed confirmation needed).

Dialog content:
> **域名已被使用**
>
> 该域名当前指向 `{currentIp}`，与本服务器 IP 不同。是否仍要使用此域名？

### Integration points

**Project creation page** (`/projects/new`):
- In the submit handler, before calling `createProject.mutateAsync()`, call `checkAndConfirm(domain)` if domain is non-empty
- If returns false, abort submission

**Settings page** (`/projects/[id]/settings`):
- In the save handler, before the PATCH request, call `checkAndConfirm(domain)` if domain changed and is non-empty
- If returns false, abort save

### Edge cases

- Domain field empty → skip check entirely
- Domain unchanged (settings page) → skip check
- `status: "unknown"` → proceed with save, show a toast: "DNS 解析失败，无法验证域名指向"

## Files to modify

| File | Change |
|------|--------|
| `backend/src/projects/projects.controller.ts` | Add `checkDomain` endpoint |
| `backend/src/projects/projects.service.ts` | Add `checkDomain` method |
| `backend/src/projects/dto/check-domain.dto.ts` | New DTO file |
| `frontend/src/hooks/use-domain-check.ts` | New hook |
| `frontend/src/app/projects/new/page.tsx` | Integrate hook in submit flow |
| `frontend/src/app/projects/[id]/settings/page.tsx` | Integrate hook in save flow |
