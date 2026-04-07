# Ship Dock Upgrade Mechanism Design

**Date:** 2026-04-07
**Status:** Approved

## Overview

Self-upgrade mechanism for Ship Dock deployed on user servers. Users run `ship-dock upgrade` to pull the latest version, migrate the database safely, rebuild, and restart — with automatic rollback on failure.

## Version Sources

- **Stable:** GitHub Releases with semver tags (`v1.0.0`). Fetched via GitHub API.
- **Edge:** `git pull origin main` for latest development code. Activated with `--edge` flag.

## Commands

```
ship-dock upgrade              # Upgrade to latest stable release
ship-dock upgrade --edge       # Upgrade to latest main branch code
ship-dock upgrade --check      # Check for updates without upgrading
ship-dock upgrade --rollback   # Manually rollback to previous backup
```

Installed as `/usr/local/bin/ship-dock` (shell script) during initial setup.

## Upgrade Flow

```
1. Version check     → compare current vs latest, exit if up-to-date
2. Backup            → code snapshot + pg_dump (gzipped)
3. Pull new code     → git checkout tag (stable) or git reset --hard origin/main (edge)
4. Install deps      → npm ci --production (backend, and frontend if self-hosted)
5. Database migrate  → npx prisma migrate deploy
6. Build             → npm run build (backend, and frontend if detected)
7. Restart           → pm2 reload ship-dock-api (zero-downtime)
8. Health check      → curl localhost:4000/api/health, retry 5x at 2s intervals
9. Failure at any step → automatic rollback
```

## Backup Strategy

**Location:** `/opt/shipdock-backups/{YYYYMMDD-HHmmss}/`

**Contents:**
- `backend/` — full copy of backend directory
- `frontend/` — full copy (if self-hosted frontend exists)
- `database.sql.gz` — full PostgreSQL dump, gzipped
- `backup.json` — metadata: version, commit hash, timestamp, pg_dump command used

**Retention:** Keep last 3 backups. Auto-delete older ones before creating new backup.

## Automatic Rollback

Triggered when any step from 5 onward fails (after code has been modified). Steps:

1. Restore code from backup directory
2. Restore database from `database.sql.gz` (only if migration was attempted)
3. Reinstall dependencies (`npm ci`)
4. Rebuild (`npm run build`)
5. Restart PM2 (`pm2 reload ship-dock-api`)
6. Health check to confirm rollback succeeded
7. Log full error details to `/opt/shipdock/logs/upgrade-{timestamp}.log`

If rollback itself fails, print manual recovery instructions pointing to backup location.

## Version Tracking

- Current version stored in `/opt/shipdock/.shipdock-version` (JSON: `{version, commit, updatedAt}`)
- Source of truth for version number: `backend/package.json` version field
- `--check` flag reads local version file, compares against GitHub API / git fetch

## Frontend Handling

- If frontend is deployed on Vercel (no `/opt/shipdock/frontend/.next`): skip frontend, only upgrade backend
- If frontend is self-hosted (`.next` build exists): include `npm ci && npm run build` for frontend in upgrade flow

## Database Migration

**Changed from** `prisma db push --accept-data-loss` **to** `prisma migrate deploy`:
- Runs migration files in order, safe for production
- No data loss risk
- Migrations are tracked in `_prisma_migrations` table
- If a migration fails, automatic rollback restores the database from pg_dump backup

## Script Structure

Single shell script at `scripts/upgrade.sh`, symlinked to `/usr/local/bin/ship-dock` during install:

```
scripts/upgrade.sh
├── version_check()      # Compare local vs remote version
├── backup()             # Code + database backup
├── pull_code()          # Git fetch + checkout/reset
├── install_deps()       # npm ci for backend (+ frontend)
├── migrate_db()         # prisma migrate deploy
├── build()              # npm run build
├── restart()            # pm2 reload
├── health_check()       # curl health endpoint
├── rollback()           # Restore from backup
└── cleanup_old_backups() # Keep only 3 most recent
```

## Limitations (v1)

- No web UI for upgrades (manual command only)
- No automatic update notifications
- No partial/selective upgrades (always full upgrade)
- Rollback restores entire database, not individual migrations
