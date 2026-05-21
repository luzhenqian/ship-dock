# Database Extensions

Allow users to select PostgreSQL extensions (pgvector, PostGIS, etc.) for their project database, installed immediately on toggle and re-ensured on every deploy.

## Data Model

### Prisma Schema

Add to `Project` model:

```prisma
dbExtensions  Json  @default("[]")   // string[] of extension IDs
```

### Extension Registry

New file `backend/src/projects/db-extensions.const.ts`:

```ts
export const DB_EXTENSIONS_WHITELIST = [
  { id: 'pgvector',  name: 'pgvector',       description: 'Vector similarity search (AI/embeddings)',  extension: 'vector' },
  { id: 'postgis',   name: 'PostGIS',        description: 'Geospatial data & queries',                extension: 'postgis' },
  { id: 'pg_trgm',   name: 'pg_trgm',        description: 'Trigram-based fuzzy text search',           extension: 'pg_trgm' },
  { id: 'hstore',    name: 'hstore',         description: 'Key-value pairs in a single column',       extension: 'hstore' },
  { id: 'ltree',     name: 'ltree',          description: 'Hierarchical tree-like data',              extension: 'ltree' },
  { id: 'citext',    name: 'citext',         description: 'Case-insensitive text type',               extension: 'citext' },
  { id: 'tablefunc', name: 'tablefunc',      description: 'Crosstab / pivot queries',                 extension: 'tablefunc' },
  { id: 'pgcrypto',  name: 'pgcrypto',       description: 'Cryptographic functions',                  extension: 'pgcrypto' },
  { id: 'unaccent',  name: 'unaccent',       description: 'Remove accents from text',                 extension: 'unaccent' },
];

export const DB_EXTENSIONS_IDS = new Set(DB_EXTENSIONS_WHITELIST.map((e) => e.id));
```

Each entry has an `extension` field for the actual PostgreSQL extension name used in `CREATE EXTENSION` (may differ from the `id`, e.g. `pgvector` → `vector`).

`uuid-ossp` is installed by default on every provisioned database and is not part of this selectable list.

## Backend

### API Endpoints

**GET `/projects/settings/db-extensions`** — returns `DB_EXTENSIONS_WHITELIST` array. Role: VIEWER.

**PATCH `/projects/:id`** — existing endpoint, now also accepts `dbExtensions: string[]`. Validation: reject IDs not in `DB_EXTENSIONS_IDS`.

### Immediate Installation (on toggle)

In `ProjectsService.update()`, when `dbExtensions` changes:

1. Compare old vs new arrays to find newly added extension IDs.
2. For each new extension, use admin credentials to connect to the project database and run `CREATE EXTENSION IF NOT EXISTS "<extension>"`.
3. On success, save the updated `dbExtensions` array.
4. On failure, throw `BadRequestException` with the extension name and error message (e.g. "extension not available on server").

Unchecking an extension removes it from the `dbExtensions` array only — **no `DROP EXTENSION`** is executed. Dropping extensions can destroy data (e.g. vector-typed columns) and is too dangerous for a checkbox toggle.

### Deploy-time Ensure (ensureDatabase enhancement)

`DatabaseProvisionerService.ensureDatabase()` is updated to accept an optional `extensions: string[]` parameter:

1. Ensure database exists (existing behavior).
2. Connect to the project database with admin credentials.
3. For each extension in the array, run `CREATE EXTENSION IF NOT EXISTS "<extension>"` (errors logged but non-fatal).

This guarantees extensions are re-applied if manually dropped or if a database is recreated.

### provision() Adjustment

Remove the hardcoded `vector` extension installation from `provision()`. Keep `uuid-ossp` as default. All other extensions are driven by the project's `dbExtensions` field.

### DTO Update

Add to `CreateProjectDto`:

```ts
@IsArray()
@IsString({ each: true })
@IsOptional()
dbExtensions?: string[];
```

`UpdateProjectDto` inherits via `PartialType`.

## Frontend

### UI Placement

Inside the existing Database card on the project settings page, below the "Export SQL / Disable & Delete" buttons. Only visible when `useLocalDb === true` (database is Active).

### Layout

- Horizontal divider
- Section heading: "Extensions"
- Subtitle: "Select PostgreSQL extensions to install. Changes apply immediately."
- 2-column checkbox grid, identical styling to System Dependencies (rounded border label, checkbox + name + description)

### Interaction

- Each checkbox toggle sends an independent PATCH request updating the full `dbExtensions` array — no separate Save button.
- While the request is in-flight: checkbox is disabled (or shows a spinner).
- On success: toast "Extension installed" (or "Extension removed from configuration" for uncheck).
- On failure: revert checkbox state, toast with error message.

### Data Fetching

- Whitelist: `GET /projects/settings/db-extensions` (fetched once, same pattern as `systemDepsWhitelist`).
- Current selections: loaded from `project.dbExtensions` on project fetch.

## Deploy Pipeline

In `deploy.processor.ts`, the existing `ensureDatabase` call is updated:

```ts
if (stage.name === 'migrate' && project.useLocalDb && project.dbName) {
  await this.dbProvisioner.ensureDatabase(project.dbName, project.dbExtensions);
}
```

Extensions are resolved from IDs to PG extension names via `DB_EXTENSIONS_WHITELIST` before executing `CREATE EXTENSION` statements.
