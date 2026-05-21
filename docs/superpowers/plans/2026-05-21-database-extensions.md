# Database Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select PostgreSQL extensions (pgvector, PostGIS, etc.) for their project database via a checkbox UI, installed immediately on toggle and re-ensured every deploy.

**Architecture:** Mirrors the existing System Dependencies pattern — a whitelist registry, a JSON array on the Project model, validation in the service, and a checkbox grid in the frontend. The key difference: extensions install immediately via `CREATE EXTENSION` rather than waiting for the next deploy. The deploy pipeline also ensures extensions on every run.

**Tech Stack:** Prisma (schema + migration), NestJS (service/controller/DTO), React/Next.js (settings page), PostgreSQL `CREATE EXTENSION`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/src/projects/db-extensions.const.ts` | Extension whitelist registry |
| Modify | `backend/prisma/schema.prisma:118` | Add `dbExtensions` field to Project |
| Create | Prisma migration | Add column to database |
| Modify | `backend/src/projects/dto/create-project.dto.ts:71-74` | Add `dbExtensions` validation |
| Modify | `backend/src/projects/projects.controller.ts:9,60-64` | Add `GET /settings/db-extensions` endpoint |
| Modify | `backend/src/projects/projects.service.ts:11,277-280` | Validate + install extensions on update |
| Modify | `backend/src/common/database-provisioner.service.ts:43-52,60-69` | `ensureDatabase` accepts extensions; remove hardcoded `vector` |
| Modify | `backend/src/deploy/deploy.processor.ts:150-158` | Pass `dbExtensions` to `ensureDatabase` |
| Modify | `frontend/src/app/projects/[id]/settings/page.tsx:329-407` | Add extensions checkbox grid inside Database card |

---

### Task 1: Extension Whitelist Registry

**Files:**
- Create: `backend/src/projects/db-extensions.const.ts`

- [ ] **Step 1: Create the registry file**

```ts
// backend/src/projects/db-extensions.const.ts
export interface DbExtensionEntry {
  id: string;
  name: string;
  description: string;
  extension: string; // actual PG extension name for CREATE EXTENSION
}

export const DB_EXTENSIONS_WHITELIST: DbExtensionEntry[] = [
  { id: 'pgvector', name: 'pgvector', description: 'Vector similarity search (AI/embeddings)', extension: 'vector' },
  { id: 'postgis', name: 'PostGIS', description: 'Geospatial data & queries', extension: 'postgis' },
  { id: 'pg_trgm', name: 'pg_trgm', description: 'Trigram-based fuzzy text search', extension: 'pg_trgm' },
  { id: 'hstore', name: 'hstore', description: 'Key-value pairs in a single column', extension: 'hstore' },
  { id: 'ltree', name: 'ltree', description: 'Hierarchical tree-like data', extension: 'ltree' },
  { id: 'citext', name: 'citext', description: 'Case-insensitive text type', extension: 'citext' },
  { id: 'tablefunc', name: 'tablefunc', description: 'Crosstab / pivot queries', extension: 'tablefunc' },
  { id: 'pgcrypto', name: 'pgcrypto', description: 'Cryptographic functions', extension: 'pgcrypto' },
  { id: 'unaccent', name: 'unaccent', description: 'Remove accents from text', extension: 'unaccent' },
];

export const DB_EXTENSIONS_IDS = new Set(DB_EXTENSIONS_WHITELIST.map((e) => e.id));
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/projects/db-extensions.const.ts
git commit -m "feat: add database extensions whitelist registry"
```

---

### Task 2: Prisma Schema + Migration

**Files:**
- Modify: `backend/prisma/schema.prisma:118`

- [ ] **Step 1: Add `dbExtensions` field to Project model**

In `backend/prisma/schema.prisma`, after line 118 (`dbName String?`), add:

```prisma
  dbExtensions  Json          @default("[]")
```

The Project model block around that area should look like:

```prisma
  useLocalDb    Boolean       @default(false)
  dbName        String?
  dbExtensions  Json          @default("[]")
  useLocalRedis Boolean       @default(false)
```

- [ ] **Step 2: Generate and run the migration**

```bash
cd backend && npx prisma migrate dev --name add-db-extensions
```

Expected: Migration creates successfully, adds `dbExtensions` column with default `[]`.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add dbExtensions field to Project schema"
```

---

### Task 3: DTO Validation

**Files:**
- Modify: `backend/src/projects/dto/create-project.dto.ts`

- [ ] **Step 1: Add `dbExtensions` field to CreateProjectDto**

In `backend/src/projects/dto/create-project.dto.ts`, after the `systemDeps` field (lines 71-74), add:

```ts
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dbExtensions?: string[];
```

`UpdateProjectDto` inherits this via `PartialType` — no change needed there.

- [ ] **Step 2: Commit**

```bash
git add backend/src/projects/dto/create-project.dto.ts
git commit -m "feat: add dbExtensions to project DTO"
```

---

### Task 4: Database Provisioner — ensureDatabase with Extensions

**Files:**
- Modify: `backend/src/common/database-provisioner.service.ts`

- [ ] **Step 1: Update `ensureDatabase` to accept and install extensions**

Replace the current `ensureDatabase` method (lines 60-69) with:

```ts
  async ensureDatabase(dbName: string, extensions?: string[]): Promise<void> {
    const client = await this.getAdminClient();
    try {
      if (!(await this.dbExists(client, dbName))) {
        await client.query(`CREATE DATABASE "${dbName}"`);
      }
    } finally {
      await client.end();
    }

    const allExtensions = ['uuid-ossp', ...(extensions || [])];
    const databaseUrl = this.buildUrl(dbName);
    const extClient = new Client({ connectionString: databaseUrl });
    await extClient.connect();
    try {
      for (const ext of allExtensions) {
        await extClient.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`).catch(() => {});
      }
    } finally {
      await extClient.end();
    }
  }
```

- [ ] **Step 2: Remove hardcoded `vector` from `provision()`**

Replace lines 43-52 of the `provision` method (the extension installation block) with:

```ts
    // Enable uuid-ossp by default
    const databaseUrl = this.buildUrl(dbName);
    const extClient = new Client({ connectionString: databaseUrl });
    await extClient.connect();
    try {
      await extClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    } finally {
      await extClient.end();
    }
```

- [ ] **Step 3: Add `installExtension` method for immediate toggle installation**

Add a new public method to the class:

```ts
  async installExtension(dbName: string, extensionName: string): Promise<void> {
    const databaseUrl = this.buildUrl(dbName);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "${extensionName}"`);
    } catch (err: any) {
      throw new Error(`Failed to install extension "${extensionName}": ${err.message}`);
    } finally {
      await client.end();
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/common/database-provisioner.service.ts
git commit -m "feat: ensureDatabase installs extensions, add installExtension method"
```

---

### Task 5: Controller — db-extensions Whitelist Endpoint

**Files:**
- Modify: `backend/src/projects/projects.controller.ts`

- [ ] **Step 1: Import the whitelist**

At line 9 of `projects.controller.ts`, after the SYSTEM_DEPS_WHITELIST import, add:

```ts
import { DB_EXTENSIONS_WHITELIST } from './db-extensions.const';
```

- [ ] **Step 2: Add the endpoint**

After the `getSystemDepsWhitelist` method (lines 60-64), add:

```ts
  @Get('settings/db-extensions')
  @MinRole('VIEWER')
  getDbExtensionsWhitelist() {
    return DB_EXTENSIONS_WHITELIST;
  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/projects/projects.controller.ts
git commit -m "feat: add GET /settings/db-extensions endpoint"
```

---

### Task 6: Service — Validate + Install Extensions on Update

**Files:**
- Modify: `backend/src/projects/projects.service.ts`

- [ ] **Step 1: Import the extensions constants**

At line 11, after the SYSTEM_DEPS_IDS import, add:

```ts
import { DB_EXTENSIONS_IDS, DB_EXTENSIONS_WHITELIST } from './db-extensions.const';
```

- [ ] **Step 2: Add extension validation and installation in `update()`**

In the `update` method, after the `systemDeps` validation block (lines 277-280), add:

```ts
    if (data.dbExtensions) {
      const invalid = (data.dbExtensions as string[]).filter((d) => !DB_EXTENSIONS_IDS.has(d));
      if (invalid.length) throw new BadRequestException(`Invalid database extensions: ${invalid.join(', ')}`);

      // Install newly added extensions immediately
      const project = await this.prisma.project.findUnique({ where: { id } });
      if (project?.useLocalDb && project.dbName) {
        const oldExtensions = (project.dbExtensions as string[]) || [];
        const newExtensions = (data.dbExtensions as string[]).filter((d) => !oldExtensions.includes(d));
        for (const extId of newExtensions) {
          const entry = DB_EXTENSIONS_WHITELIST.find((e) => e.id === extId);
          if (entry) {
            await this.dbProvisioner.installExtension(project.dbName, entry.extension);
          }
        }
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/projects/projects.service.ts
git commit -m "feat: validate and immediately install database extensions on update"
```

---

### Task 7: Deploy Processor — Pass Extensions to ensureDatabase

**Files:**
- Modify: `backend/src/deploy/deploy.processor.ts`

- [ ] **Step 1: Import the whitelist**

Add import near the top of the file, after the existing SYSTEM_DEPS_WHITELIST import (line 21):

```ts
import { DB_EXTENSIONS_WHITELIST } from '../projects/db-extensions.const';
```

- [ ] **Step 2: Update the ensureDatabase call**

Replace lines 150-158 (the `ensureDatabase` block) with:

```ts
        if (stage.name === 'migrate' && project.useLocalDb && project.dbName) {
          try {
            onLog(`Ensuring database "${project.dbName}" exists...`);
            const extIds = (project.dbExtensions as string[]) || [];
            const pgExtNames = extIds
              .map((id) => DB_EXTENSIONS_WHITELIST.find((e) => e.id === id)?.extension)
              .filter(Boolean) as string[];
            await this.dbProvisioner.ensureDatabase(project.dbName, pgExtNames);
            onLog(`Database "${project.dbName}" ready${pgExtNames.length ? ` (extensions: ${pgExtNames.join(', ')})` : ''}`);
          } catch (err: any) {
            onLog(`\x1b[31mFailed to ensure database: ${err.message}\x1b[0m`);
          }
        }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/deploy/deploy.processor.ts
git commit -m "feat: pass dbExtensions to ensureDatabase during deploy"
```

---

### Task 8: Frontend — Database Extensions Checkbox Grid

**Files:**
- Modify: `frontend/src/app/projects/[id]/settings/page.tsx`

- [ ] **Step 1: Add state and data fetching**

After the `systemDeps` state (line 75) and the `systemDepsWhitelist` query (lines 77-80), add:

```tsx
  const [dbExtensions, setDbExtensions] = useState<string[]>([]);
  const [dbExtSaving, setDbExtSaving] = useState<string | null>(null);

  const { data: dbExtensionsWhitelist } = useQuery({
    queryKey: ['db-extensions-whitelist'],
    queryFn: () => api<Array<{ id: string; name: string; description: string; extension: string }>>('/projects/settings/db-extensions'),
  });
```

- [ ] **Step 2: Hydrate dbExtensions from project data**

In the `useEffect` that hydrates project data (lines 88-99), after line 97 (`setSystemDeps(...)`) add:

```tsx
      setDbExtensions((project as any).dbExtensions || []);
```

- [ ] **Step 3: Add the extensions UI inside the Database card**

In the Database card's active state block (`project.useLocalDb` truthy branch), after the buttons `div` (after line 377, the closing `</div>` of the Export/Delete buttons), add:

```tsx
              {dbExtensionsWhitelist && dbExtensionsWhitelist.length > 0 && (
                <>
                  <hr className="border-border" />
                  <div>
                    <h4 className="text-sm font-medium mb-1">Extensions</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Select PostgreSQL extensions to install. Changes apply immediately.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {dbExtensionsWhitelist.map((ext) => (
                        <label
                          key={ext.id}
                          className="flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer hover:bg-foreground/[0.04] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={dbExtensions.includes(ext.id)}
                            disabled={dbExtSaving === ext.id}
                            onChange={async (e) => {
                              const checked = e.target.checked;
                              const next = checked
                                ? [...dbExtensions, ext.id]
                                : dbExtensions.filter((d) => d !== ext.id);
                              setDbExtensions(next);
                              setDbExtSaving(ext.id);
                              try {
                                await api(`/projects/${projectId}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ dbExtensions: next }),
                                });
                                toast.success(
                                  checked
                                    ? `Extension "${ext.name}" installed`
                                    : `Extension "${ext.name}" removed from configuration`,
                                );
                                refetch();
                              } catch (err: any) {
                                setDbExtensions(checked
                                  ? dbExtensions.filter((d) => d !== ext.id)
                                  : [...dbExtensions, ext.id],
                                );
                                toast.error(err.message || `Failed to update extension`);
                              } finally {
                                setDbExtSaving(null);
                              }
                            }}
                            className="h-4 w-4 mt-0.5 rounded border shrink-0"
                          />
                          <div>
                            <span className="text-sm font-medium">{ext.name}</span>
                            <p className="text-xs text-muted-foreground">{ext.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/projects/[id]/settings/page.tsx
git commit -m "feat: add database extensions checkbox grid to project settings"
```

---

### Task 9: Manual Verification

- [ ] **Step 1: Start backend dev server**

```bash
cd backend && npm run start:dev
```

- [ ] **Step 2: Start frontend dev server**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Verify the whitelist endpoint**

```bash
curl -s http://localhost:4000/api/projects/settings/db-extensions -H "Authorization: Bearer <token>" | jq '.[].id'
```

Expected: 9 extension IDs returned.

- [ ] **Step 4: Test in the browser**

1. Navigate to a project settings page that has an active platform database
2. Verify the "Extensions" section appears below the Export/Delete buttons
3. Check a box (e.g. pgvector) — should see toast "Extension pgvector installed"
4. Uncheck it — should see toast "Extension pgvector removed from configuration"
5. Verify checkbox reflects saved state after page refresh

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: database extensions — complete feature"
```
