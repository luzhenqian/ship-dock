# Static Site Deployment Design

**Date:** 2026-06-16  
**Status:** Approved

## Overview

Support deploying simple static sites (HTML/CSS/JS) without a Node.js process. Static projects skip port allocation and PM2 entirely — Nginx serves files directly from disk. Two authoring modes: zip upload and an in-browser multi-file editor.

---

## 1. Schema & Data Model

### SourceType enum

Add `STATIC` to the existing `SourceType` enum:

```prisma
enum SourceType {
  GITHUB
  UPLOAD
  STATIC
}
```

### Project model

No new fields on `Project`. The existing `port` field stores `0` and `pm2Name` stores `""` for static projects. All static-specific branching is done via `sourceType === STATIC` — no reliance on these placeholder values.

### StaticFile table (new)

Stores file contents for the in-browser editor:

```prisma
model StaticFile {
  id        String   @id @default(uuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  path      String   // e.g. "index.html", "css/style.css"
  content   String   // UTF-8 text content
  updatedAt DateTime @updatedAt

  @@unique([projectId, path])
}
```

Zip-uploaded files are extracted directly to `/var/www/<slug>/` and are not stored in the DB. The online editor uses `StaticFile` rows as its source of truth; Publish syncs them to disk. The two modes are mutually exclusive per deploy: whichever ran last wins on disk.

---

## 2. Deploy Pipeline

Static projects have a two-stage pipeline — no install, build, or PM2 stages.

### Stage 1 — `static-sync`

**Zip upload path:** Extract the zip to `/var/www/<slug>/`. Validate that `index.html` exists at the root (or in the only top-level subdirectory). Clear any existing `StaticFile` rows for this project (zip takes over as source of truth).

**Editor publish path:** Read all `StaticFile` rows for the project, delete `/var/www/<slug>/` contents, then write each file to its path under the directory.

### Stage 2 — `nginx`

`NginxStage` gets a new `buildStaticConfig()` method alongside the existing `buildConfig()`:

```nginx
server {
  listen 80;
  server_name <domain>;

  root /var/www/<slug>;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  gzip on;
  gzip_types text/html text/css application/javascript image/svg+xml;
}
```

SSL: the existing `SslStage` is reused without modification. When SSL is provisioned, the static config gains the standard HTTPS redirect block.

`DeployProcessor` routes to `buildStaticConfig()` when `project.sourceType === 'STATIC'`.

---

## 3. Frontend — Project Creation

The existing multi-step flow (`source → basic → env → confirm`) is extended:

**`source` step:** Add a third source card — **Static Site** — alongside GitHub and Upload.

**`basic` step (Static Site):** Show only: name, slug, domain. Hide port, startCommand, nodeVersion, system deps, local services.

**`env` step:** Skipped entirely for static projects.

**`confirm` step:** Two options:
- **Upload zip** — drag-and-drop; triggers immediate deploy on upload
- **Open Editor** — navigates to `/projects/<id>/editor`; no deploy until user clicks Publish

On project creation, the backend automatically seeds one `StaticFile` row with a minimal `index.html` skeleton so the editor is never blank.

---

## 4. Online Editor — `/projects/<id>/editor`

**Layout:** Left panel = file tree, right panel = Monaco Editor, top bar = project name + Save status + Publish button.

**File tree:**
- New file / new folder / rename / delete actions
- Path validation: no absolute paths, no `..` segments, no empty names
- Single-file size cap: 1 MB

**Monaco Editor:**
- Language auto-detected from file extension (html → html, css → css, js → javascript, etc.)
- Autosave on debounce (500 ms) via `PUT /api/projects/:id/static-files`
- Top bar shows "Saved" / "Saving…" indicator

**Publish button:**
- Calls `POST /api/projects/:id/deploy` with no extra payload (backend reads `StaticFile` rows)
- Deploy log panel slides in, reusing the existing `DeployLog` component
- Disabled if `StaticFile` table has no rows for this project

---

## 5. Backend API (new endpoints)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/projects/:id/static-files` | List all files (path + content) |
| `PUT` | `/api/projects/:id/static-files` | Upsert a file (path + content) |
| `DELETE` | `/api/projects/:id/static-files/:encodedPath` | Delete a file |

These endpoints live in a new `StaticFilesModule`. Authorization: same JWT guard as the rest of the project API.

---

## 6. Edge Cases & Constraints

### Zip upload
- Reject if no `index.html` found after extraction
- Path traversal protection: filter entries containing `../` or absolute paths before extraction
- Reuse existing `fileSizeLimit` / `fileTotalLimit` from `Project`
- On success, clear all `StaticFile` rows for the project (zip becomes source of truth)
- UI shows warning: "Uploading a zip will overwrite your online editor files"

### Editor publish
- Block Publish if `StaticFile` count for project is 0
- Files written atomically: write to a temp dir first, then `mv` to `/var/www/<slug>/`

### Isolation from existing logic
- `PortAllocationService`: add `sourceType != 'STATIC'` filter when querying used ports
- PM2 management pages: exclude static projects or label them "Static Site — no process"
- Deployment list: show static projects normally; deploy logs work the same way

---

## 7. Out of Scope

- Build step support (e.g. Vite/webpack — that's a Node.js project, use GITHUB/UPLOAD)
- CDN or object-storage-backed serving (MinIO route deferred)
- Binary file upload in the online editor (images etc. — zip upload only)
