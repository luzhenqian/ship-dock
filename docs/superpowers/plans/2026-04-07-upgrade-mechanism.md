# Upgrade Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ship-dock upgrade` command that safely upgrades the platform with automatic backup and rollback.

**Architecture:** A single shell script (`scripts/upgrade.sh`) handles the full upgrade lifecycle: version check, backup, code pull, deps install, database migration, build, restart, health check, and rollback on failure. A thin wrapper (`scripts/ship-dock`) is installed to `/usr/local/bin/` during initial setup for convenient access.

**Tech Stack:** Bash, Git, PostgreSQL (pg_dump/psql), Prisma, PM2, GitHub API (curl)

**Spec:** `docs/superpowers/specs/2026-04-07-upgrade-mechanism-design.md`

---

## File Structure

```
scripts/
├── ship-dock            # CLI entrypoint — dispatches to subcommands
├── upgrade.sh           # Full upgrade logic with backup and rollback
└── install.sh           # Modified: install ship-dock CLI to /usr/local/bin

backend/
└── package.json         # Modified: bump version to 1.0.0
```

---

### Task 1: Create the upgrade script

**Files:**
- Create: `scripts/upgrade.sh`

- [ ] **Step 1: Create the upgrade script**

`scripts/upgrade.sh`:
```bash
#!/bin/bash
# Ship Dock Upgrade Script
# Usage: ship-dock upgrade [--edge] [--check] [--rollback]
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-/opt/shipdock}"
BACKUP_DIR="/opt/shipdock-backups"
MAX_BACKUPS=3
HEALTH_URL="http://localhost:4000/api/health"
HEALTH_RETRIES=5
HEALTH_INTERVAL=2
GITHUB_REPO="luzhenqian/ship-dock"

# ── Parse args ──
MODE="stable"
CHECK_ONLY=false
DO_ROLLBACK=false

for arg in "$@"; do
  case "$arg" in
    --edge)     MODE="edge" ;;
    --check)    CHECK_ONLY=true ;;
    --rollback) DO_ROLLBACK=true ;;
  esac
done

# ── Helpers ──
log()     { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${YELLOW}!${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; }
header()  { echo -e "\n${BOLD}$1${NC}"; }

get_current_version() {
  if [[ -f "$INSTALL_DIR/.shipdock-version" ]]; then
    cat "$INSTALL_DIR/.shipdock-version" | grep -o '"version":"[^"]*"' | cut -d'"' -f4
  else
    # Fallback to package.json
    node -e "console.log(require('$INSTALL_DIR/backend/package.json').version)" 2>/dev/null || echo "unknown"
  fi
}

get_current_commit() {
  cd "$INSTALL_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

get_latest_release() {
  curl -sf "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | \
    grep -o '"tag_name":"[^"]*"' | cut -d'"' -f4
}

get_latest_release_body() {
  curl -sf "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('body',''))" 2>/dev/null || echo ""
}

save_version() {
  local version="$1"
  local commit="$2"
  cat > "$INSTALL_DIR/.shipdock-version" << EOF
{"version":"$version","commit":"$commit","updatedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
}

# ── Manual rollback ──
if [[ "$DO_ROLLBACK" == "true" ]]; then
  header "Ship Dock Rollback"

  # Find latest backup
  LATEST_BACKUP=$(ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | sort -r | head -1)
  if [[ -z "$LATEST_BACKUP" ]]; then
    fail "No backups found in $BACKUP_DIR"
    exit 1
  fi

  echo -e "  Rolling back from: ${GRAY}$LATEST_BACKUP${NC}"
  do_rollback "$LATEST_BACKUP"
  exit 0
fi

# ── Version check ──
header "Ship Dock Upgrade"
echo "────────────────────"

CURRENT_VERSION=$(get_current_version)
CURRENT_COMMIT=$(get_current_commit)
echo -e "  Current: ${BOLD}v${CURRENT_VERSION}${NC} (${GRAY}${CURRENT_COMMIT}${NC})"

if [[ "$MODE" == "stable" ]]; then
  LATEST_TAG=$(get_latest_release)
  if [[ -z "$LATEST_TAG" ]]; then
    fail "Could not fetch latest release from GitHub"
    exit 1
  fi
  LATEST_VERSION="${LATEST_TAG#v}"
  echo -e "  Latest:  ${BOLD}${LATEST_TAG}${NC}"

  if [[ "v$CURRENT_VERSION" == "$LATEST_TAG" ]]; then
    log "Already up to date!"
    exit 0
  fi

  # Show changelog
  CHANGELOG=$(get_latest_release_body)
  if [[ -n "$CHANGELOG" ]]; then
    echo ""
    echo -e "${GRAY}Changelog:${NC}"
    echo "$CHANGELOG" | head -20 | sed 's/^/  /'
  fi
else
  echo -e "  Mode:    ${YELLOW}edge${NC} (main branch)"
  cd "$INSTALL_DIR"
  git fetch origin main --quiet 2>/dev/null
  LOCAL_HEAD=$(git rev-parse HEAD)
  REMOTE_HEAD=$(git rev-parse origin/main)
  if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
    log "Already up to date with main branch!"
    exit 0
  fi
  LATEST_VERSION="edge"
  echo -e "  Remote:  ${GRAY}$(git log origin/main -1 --format='%h %s')${NC}"
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
  echo ""
  warn "Update available. Run 'ship-dock upgrade' to install."
  exit 0
fi

echo ""

# ── Backup ──
header "Backing up..."
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"
mkdir -p "$BACKUP_PATH"

# Backup code
cp -a "$INSTALL_DIR/backend" "$BACKUP_PATH/backend"
if [[ -d "$INSTALL_DIR/frontend/.next" ]]; then
  cp -a "$INSTALL_DIR/frontend" "$BACKUP_PATH/frontend"
fi
log "Code backed up"

# Backup database
DB_URL=$(grep "^DATABASE_URL=" "$INSTALL_DIR/backend/.env" 2>/dev/null | cut -d'=' -f2- || echo "")
if [[ -n "$DB_URL" ]]; then
  # Extract connection parts from DATABASE_URL
  pg_dump "$DB_URL" | gzip > "$BACKUP_PATH/database.sql.gz"
  DB_SIZE=$(du -sh "$BACKUP_PATH/database.sql.gz" | cut -f1)
  log "Database backed up ($DB_SIZE)"
else
  warn "No DATABASE_URL found, skipping database backup"
fi

# Save backup metadata
cat > "$BACKUP_PATH/backup.json" << EOF
{"version":"$CURRENT_VERSION","commit":"$CURRENT_COMMIT","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

# Cleanup old backups
BACKUP_COUNT=$(ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | wc -l)
if (( BACKUP_COUNT > MAX_BACKUPS )); then
  ls -1d "$BACKUP_DIR"/*/ | sort | head -n $((BACKUP_COUNT - MAX_BACKUPS)) | xargs rm -rf
  log "Cleaned up old backups (keeping $MAX_BACKUPS)"
fi

# ── Rollback function (defined after backup is created) ──
MIGRATION_ATTEMPTED=false

do_rollback() {
  local backup="$1"
  header "Rolling back..."

  # Restore database (only if migration was attempted)
  if [[ "$MIGRATION_ATTEMPTED" == "true" ]] && [[ -f "$backup/database.sql.gz" ]]; then
    local db_url=$(grep "^DATABASE_URL=" "$INSTALL_DIR/backend/.env" 2>/dev/null | cut -d'=' -f2- || echo "")
    if [[ -n "$db_url" ]]; then
      gunzip -c "$backup/database.sql.gz" | psql "$db_url" --quiet 2>/dev/null
      log "Database restored"
    fi
  fi

  # Restore code
  rm -rf "$INSTALL_DIR/backend/node_modules" "$INSTALL_DIR/backend/dist"
  cp -a "$backup/backend/." "$INSTALL_DIR/backend/"
  if [[ -d "$backup/frontend" ]]; then
    cp -a "$backup/frontend/." "$INSTALL_DIR/frontend/"
  fi
  log "Code restored"

  # Rebuild
  cd "$INSTALL_DIR/backend"
  npm ci --production --silent 2>/dev/null
  log "Dependencies reinstalled"
  npx prisma generate --quiet 2>/dev/null
  npm run build --silent 2>/dev/null
  log "Backend rebuilt"

  # Restart
  pm2 reload ship-dock-api 2>/dev/null
  sleep 3
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    log "Health check passed — rollback successful"
  else
    fail "Health check failed after rollback!"
    fail "Manual recovery: backup at $backup"
  fi

  # Restore version file
  local old_version=$(cat "$backup/backup.json" 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  local old_commit=$(cat "$backup/backup.json" 2>/dev/null | grep -o '"commit":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  save_version "$old_version" "$old_commit"

  echo ""
  echo -e "  Rollback complete. Still running ${BOLD}v${old_version}${NC}."
}

# ── Upgrade ──
header "Upgrading..."

# Pull code
cd "$INSTALL_DIR"
if [[ "$MODE" == "stable" ]]; then
  git fetch --tags --quiet
  git checkout "$LATEST_TAG" --quiet 2>/dev/null
  log "Code updated to $LATEST_TAG"
else
  git fetch origin main --quiet
  git reset --hard origin/main --quiet
  log "Code updated to latest main"
fi

# Install backend deps
cd "$INSTALL_DIR/backend"
if ! npm ci --production --silent 2>&1; then
  fail "Dependency installation failed"
  do_rollback "$BACKUP_PATH"
  exit 1
fi
log "Dependencies installed"

# Prisma generate
npx prisma generate --quiet 2>/dev/null

# Database migration
MIGRATION_ATTEMPTED=true
header "Migrating database..."
MIGRATE_OUTPUT=$(npx prisma migrate deploy 2>&1) || {
  fail "Database migration failed"
  echo -e "${GRAY}$MIGRATE_OUTPUT${NC}" | sed 's/^/  /'
  do_rollback "$BACKUP_PATH"
  exit 1
}

# Count applied migrations
APPLIED=$(echo "$MIGRATE_OUTPUT" | grep -c "applied" || echo "0")
if (( APPLIED > 0 )); then
  log "Database migrated ($APPLIED new migration(s))"
else
  log "Database up to date (no new migrations)"
fi

# Build backend
if ! npm run build --silent 2>&1; then
  fail "Build failed"
  do_rollback "$BACKUP_PATH"
  exit 1
fi
log "Backend built"

# Build frontend (if self-hosted)
if [[ -f "$INSTALL_DIR/frontend/package.json" ]] && [[ -d "$INSTALL_DIR/frontend/.next" ]]; then
  cd "$INSTALL_DIR/frontend"
  npm ci --silent 2>/dev/null
  npm run build --silent 2>/dev/null
  log "Frontend built"
fi

# Sync nginx config
cd "$INSTALL_DIR"
if [[ -f nginx/ship-dock.conf ]]; then
  sudo cp nginx/ship-dock.conf /etc/nginx/sites-available/ship-dock.conf
  sudo ln -sf /etc/nginx/sites-available/ship-dock.conf /etc/nginx/sites-enabled/ship-dock.conf
  if sudo nginx -t 2>/dev/null; then
    sudo systemctl reload nginx
    log "Nginx config updated"
  fi
fi

# Restart PM2
cd "$INSTALL_DIR/backend"
if pm2 describe ship-dock-api &>/dev/null; then
  pm2 reload ship-dock-api
  log "Service restarted (zero-downtime)"
else
  pm2 start dist/main.js --name ship-dock-api -i 1 --env production
  pm2 save
  log "Service started"
fi

# Health check
sleep 2
HEALTHY=false
for i in $(seq 1 $HEALTH_RETRIES); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep $HEALTH_INTERVAL
done

if [[ "$HEALTHY" == "true" ]]; then
  log "Health check passed"
else
  fail "Health check failed after $HEALTH_RETRIES retries"
  do_rollback "$BACKUP_PATH"
  exit 1
fi

# Save new version
NEW_COMMIT=$(cd "$INSTALL_DIR" && git rev-parse --short HEAD)
if [[ "$MODE" == "stable" ]]; then
  save_version "$LATEST_VERSION" "$NEW_COMMIT"
else
  save_version "edge-$NEW_COMMIT" "$NEW_COMMIT"
fi

# Save upgrade log
LOG_DIR="$INSTALL_DIR/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Upgraded from v$CURRENT_VERSION ($CURRENT_COMMIT) to v$LATEST_VERSION ($NEW_COMMIT)" >> "$LOG_DIR/upgrades.log"

echo ""
echo "────────────────────"
echo -e "  ${GREEN}Upgrade complete!${NC} v${CURRENT_VERSION} → v${LATEST_VERSION}"
echo ""
```

- [ ] **Step 2: Make executable**

Run:
```bash
chmod +x scripts/upgrade.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/upgrade.sh
git commit -m "feat: add upgrade script with backup and auto-rollback"
```

---

### Task 2: Create the ship-dock CLI entrypoint

**Files:**
- Create: `scripts/ship-dock`

- [ ] **Step 1: Create CLI entrypoint**

`scripts/ship-dock`:
```bash
#!/bin/bash
# Ship Dock CLI
# Installed to /usr/local/bin/ship-dock
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/shipdock}"
SCRIPTS_DIR="$INSTALL_DIR/scripts"

case "${1:-help}" in
  upgrade)
    shift
    bash "$SCRIPTS_DIR/upgrade.sh" "$@"
    ;;
  version)
    if [[ -f "$INSTALL_DIR/.shipdock-version" ]]; then
      cat "$INSTALL_DIR/.shipdock-version" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Ship Dock v{d[\"version\"]} ({d[\"commit\"]})')" 2>/dev/null || echo "Ship Dock (version unknown)"
    else
      echo "Ship Dock v$(node -e "console.log(require('$INSTALL_DIR/backend/package.json').version)" 2>/dev/null || echo 'unknown')"
    fi
    ;;
  help|--help|-h)
    echo ""
    echo "Ship Dock CLI"
    echo ""
    echo "Usage: ship-dock <command> [options]"
    echo ""
    echo "Commands:"
    echo "  upgrade              Upgrade to the latest stable version"
    echo "    --edge             Upgrade to latest main branch code"
    echo "    --check            Check for updates without upgrading"
    echo "    --rollback         Rollback to previous version"
    echo "  version              Show current version"
    echo "  help                 Show this help message"
    echo ""
    ;;
  *)
    echo "Unknown command: $1"
    echo "Run 'ship-dock help' for usage."
    exit 1
    ;;
esac
```

- [ ] **Step 2: Make executable**

Run:
```bash
chmod +x scripts/ship-dock
```

- [ ] **Step 3: Commit**

```bash
git add scripts/ship-dock
git commit -m "feat: add ship-dock CLI entrypoint with upgrade and version commands"
```

---

### Task 3: Update install.sh to register ship-dock CLI

**Files:**
- Modify: `scripts/install.sh`

- [ ] **Step 1: Add CLI installation to install.sh**

Add before the `# ── Launch interactive setup ──` section in `scripts/install.sh`:

```bash
# ── Install ship-dock CLI ──
echo "  Installing ship-dock command..."
chmod +x "$INSTALL_DIR/scripts/ship-dock"
chmod +x "$INSTALL_DIR/scripts/upgrade.sh"
ln -sf "$INSTALL_DIR/scripts/ship-dock" /usr/local/bin/ship-dock
echo -e "${GREEN}✓${NC} ship-dock command installed"
```

- [ ] **Step 2: Commit**

```bash
git add scripts/install.sh
git commit -m "feat: register ship-dock CLI in PATH during installation"
```

---

### Task 4: Switch deploy-remote.sh from db push to migrate deploy

**Files:**
- Modify: `scripts/deploy-remote.sh`

- [ ] **Step 1: Replace prisma db push with prisma migrate deploy**

In `scripts/deploy-remote.sh`, change line 44:

Old:
```bash
npx prisma db push --accept-data-loss
```

New:
```bash
npx prisma migrate deploy
```

Also update the comment on line 42 from "Syncing database schema" to "Running database migrations":

Old:
```bash
echo ">> Syncing database schema ..."
```

New:
```bash
echo ">> Running database migrations ..."
```

- [ ] **Step 2: Commit**

```bash
git add scripts/deploy-remote.sh
git commit -m "fix: use prisma migrate deploy instead of db push for safe migrations"
```

---

### Task 5: Bump version and create version file support

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Bump version in package.json**

Change line 3 of `backend/package.json`:

Old:
```json
"version": "0.0.1",
```

New:
```json
"version": "1.0.0",
```

- [ ] **Step 2: Commit**

```bash
git add backend/package.json
git commit -m "chore: bump backend version to 1.0.0"
```

---

### Task 6: Test the upgrade script locally (dry-run verification)

**Files:**
- No new files

- [ ] **Step 1: Verify scripts are syntactically valid**

Run:
```bash
bash -n scripts/upgrade.sh && echo "upgrade.sh: OK"
bash -n scripts/ship-dock && echo "ship-dock: OK"
```

Expected: Both print OK with no errors.

- [ ] **Step 2: Verify help output**

Run:
```bash
INSTALL_DIR="$(pwd)" bash scripts/ship-dock help
```

Expected: Shows help message with upgrade, version, and help commands.

- [ ] **Step 3: Verify version command**

Run:
```bash
INSTALL_DIR="$(pwd)" bash scripts/ship-dock version
```

Expected: Shows `Ship Dock v1.0.0` (or similar).

- [ ] **Step 4: Commit (no changes — verification only)**

No commit needed for this task.
