#!/bin/bash
# Ship Dock — Self-upgrade script
# Usage: ship-dock upgrade [--edge] [--check] [--rollback] [--force]
set -euo pipefail

# ---------- Colors & helpers ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

log()    { echo -e "${GREEN}✓${NC} $*"; }
warn()   { echo -e "${YELLOW}!${NC} $*"; }
fail()   { echo -e "${RED}✗${NC} $*"; }
header() { echo -e "\n${BOLD}$*${NC}"; }

# ---------- Configuration ----------
INSTALL_DIR="${INSTALL_DIR:-/opt/shipdock}"
GITHUB_REPO="luzhenqian/ship-dock"
BACKUP_BASE="$INSTALL_DIR-backups"
LOG_DIR="$INSTALL_DIR/logs"
LOG_FILE="$LOG_DIR/upgrades.log"
VERSION_FILE="$INSTALL_DIR/.shipdock-version"
MIGRATION_ATTEMPTED=false
BACKUP_PATH=""

# ---------- Logging to file ----------
mkdir -p "$LOG_DIR"
log_to_file() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG_FILE"
}

# ---------- Parse arguments ----------
MODE="stable"
ACTION="upgrade"
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --edge)     MODE="edge"; shift ;;
    --check)    ACTION="check"; shift ;;
    --rollback) ACTION="rollback"; shift ;;
    --force)    FORCE=true; shift ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done

# ---------- Helper: read current version ----------
get_current_version() {
  if [[ -f "$VERSION_FILE" ]]; then
    python3 -c "import json; d=json.load(open('$VERSION_FILE')); print(d.get('version','unknown'))" 2>/dev/null || echo "unknown"
  elif [[ -f "$INSTALL_DIR/backend/package.json" ]]; then
    node -e "console.log(require('$INSTALL_DIR/backend/package.json').version)" 2>/dev/null || echo "unknown"
  else
    echo "unknown"
  fi
}

get_current_commit() {
  if [[ -f "$VERSION_FILE" ]]; then
    python3 -c "import json; d=json.load(open('$VERSION_FILE')); print(d.get('commit','unknown'))" 2>/dev/null || echo "unknown"
  else
    git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown"
  fi
}

# ---------- Helper: get latest version ----------
get_latest_stable() {
  local response
  response=$(curl -sf "https://api.github.com/repos/$GITHUB_REPO/releases/latest" 2>/dev/null) || {
    fail "Could not fetch latest release from GitHub"
    exit 1
  }
  LATEST_VERSION=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null)
  LATEST_VERSION="${LATEST_VERSION#v}"  # strip leading v
}

get_latest_edge() {
  git -C "$INSTALL_DIR" fetch origin main --quiet 2>/dev/null || {
    fail "Could not fetch origin/main"
    exit 1
  }
  LATEST_COMMIT=$(git -C "$INSTALL_DIR" rev-parse --short origin/main 2>/dev/null)
}

# ---------- Health check ----------
health_check() {
  header "Running health check..."
  local retries=5
  local delay=2
  for i in $(seq 1 $retries); do
    if curl -sf http://localhost:4000/api/health > /dev/null 2>&1; then
      log "Health check passed"
      return 0
    fi
    warn "Health check attempt $i/$retries failed, retrying in ${delay}s..."
    sleep "$delay"
  done
  fail "Health check failed after $retries attempts"
  return 1
}

# ---------- Save version ----------
save_version() {
  local version="$1"
  local commit="$2"
  python3 -c "
import json, datetime
d = {'version': '$version', 'commit': '$commit', 'updatedAt': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')}
with open('$VERSION_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
  log "Version saved to $VERSION_FILE"
}

# ---------- Rollback ----------
do_rollback() {
  local rollback_from="${1:-manual}"
  header "Rolling back ($rollback_from)..."
  log_to_file "ROLLBACK started (trigger: $rollback_from)"

  if [[ -z "$BACKUP_PATH" || ! -d "$BACKUP_PATH" ]]; then
    fail "No backup found at: $BACKUP_PATH"
    echo ""
    echo -e "${RED}${BOLD}Manual recovery instructions:${NC}"
    echo "  1. Check $BACKUP_BASE/ for available backups"
    echo "  2. Restore code:  cp -a <backup>/backend/ $INSTALL_DIR/backend/"
    echo "  3. Restore DB:    gunzip -c <backup>/database.sql.gz | psql \$DATABASE_URL"
    echo "  4. Rebuild:       cd $INSTALL_DIR/backend && npm ci && npx prisma generate && npm run build"
    echo "  5. Restart:       pm2 reload ship-dock-api"
    log_to_file "ROLLBACK FAILED — no backup directory"
    exit 1
  fi

  # Restore database if migration was attempted
  if [[ "$MIGRATION_ATTEMPTED" == "true" && -f "$BACKUP_PATH/database.sql.gz" ]]; then
    warn "Restoring database from backup..."
    local db_url
    db_url=$(grep -E '^DATABASE_URL=' "$INSTALL_DIR/backend/.env" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    if gunzip -c "$BACKUP_PATH/database.sql.gz" | psql "$db_url" > /dev/null 2>&1; then
      log "Database restored"
    else
      fail "Database restore failed"
      echo ""
      echo -e "${RED}${BOLD}Manual recovery instructions:${NC}"
      echo "  1. Restore DB manually: gunzip -c $BACKUP_PATH/database.sql.gz | psql \$DATABASE_URL"
      echo "  2. Restore code:  cp -a $BACKUP_PATH/backend/ $INSTALL_DIR/backend/"
      echo "  3. Rebuild:       cd $INSTALL_DIR/backend && npm ci && npx prisma generate && npm run build"
      echo "  4. Restart:       pm2 reload ship-dock-api"
      log_to_file "ROLLBACK FAILED — database restore error"
      exit 1
    fi
  fi

  # Restore code
  warn "Restoring code from backup..."
  if [[ -d "$BACKUP_PATH/backend" ]]; then
    rm -rf "$INSTALL_DIR/backend"
    cp -a "$BACKUP_PATH/backend" "$INSTALL_DIR/backend"
    log "Backend code restored"
  fi
  if [[ -d "$BACKUP_PATH/frontend" ]]; then
    rm -rf "$INSTALL_DIR/frontend"
    cp -a "$BACKUP_PATH/frontend" "$INSTALL_DIR/frontend"
    log "Frontend code restored"
  fi

  # Rebuild
  warn "Rebuilding after rollback..."
  cd "$INSTALL_DIR/backend"
  if ! npm ci 2>/dev/null; then
    fail "npm ci failed during rollback"
    echo -e "${RED}${BOLD}Manual recovery:${NC} cd $INSTALL_DIR/backend && npm ci && npx prisma generate && npm run build && pm2 reload ship-dock-api"
    log_to_file "ROLLBACK FAILED — npm ci error"
    exit 1
  fi
  if ! npx prisma generate 2>/dev/null; then
    fail "prisma generate failed during rollback"
    echo -e "${RED}${BOLD}Manual recovery:${NC} cd $INSTALL_DIR/backend && npx prisma generate && npm run build && pm2 reload ship-dock-api"
    log_to_file "ROLLBACK FAILED — prisma generate error"
    exit 1
  fi
  if ! npm run build 2>/dev/null; then
    fail "npm run build failed during rollback"
    echo -e "${RED}${BOLD}Manual recovery:${NC} cd $INSTALL_DIR/backend && npm run build && pm2 reload ship-dock-api"
    log_to_file "ROLLBACK FAILED — build error"
    exit 1
  fi

  # PM2 reload
  pm2 reload ship-dock-api 2>/dev/null || pm2 start "$INSTALL_DIR/backend/dist/main.js" --name ship-dock-api 2>/dev/null || true
  pm2 reload ship-dock-web 2>/dev/null || true

  # Health check
  if ! health_check; then
    fail "Health check failed after rollback"
    echo -e "${RED}${BOLD}Manual recovery:${NC} Check logs with 'pm2 logs ship-dock-api' and restart manually"
    log_to_file "ROLLBACK FAILED — health check error"
    exit 1
  fi

  # Restore version file
  if [[ -f "$BACKUP_PATH/version-file" ]]; then
    cp "$BACKUP_PATH/version-file" "$VERSION_FILE"
    log "Version file restored"
  fi

  log "Rollback completed successfully"
  log_to_file "ROLLBACK completed successfully"
}

# ---------- Manual rollback mode ----------
if [[ "$ACTION" == "rollback" ]]; then
  header "Ship Dock — Manual Rollback"

  if [[ ! -d "$BACKUP_BASE" ]]; then
    fail "No backups found at $BACKUP_BASE"
    exit 1
  fi

  # Find latest backup
  BACKUP_PATH=$(ls -dt "$BACKUP_BASE"/*/ 2>/dev/null | head -1)
  BACKUP_PATH="${BACKUP_PATH%/}"

  if [[ -z "$BACKUP_PATH" ]]; then
    fail "No backups found in $BACKUP_BASE"
    exit 1
  fi

  log "Found backup: $BACKUP_PATH"
  if [[ -f "$BACKUP_PATH/backup.json" ]]; then
    echo -e "${GRAY}$(cat "$BACKUP_PATH/backup.json")${NC}"
  fi

  MIGRATION_ATTEMPTED=true  # assume migrations may have been run
  do_rollback "manual"
  exit 0
fi

# ---------- Check for updates ----------
header "Ship Dock — Upgrade ($MODE mode)"

CURRENT_VERSION=$(get_current_version)
CURRENT_COMMIT=$(get_current_commit)
log "Current version: ${CURRENT_VERSION} (${CURRENT_COMMIT})"

if [[ "$MODE" == "stable" ]]; then
  get_latest_stable
  log "Latest stable: ${LATEST_VERSION}"

  if [[ "$CURRENT_VERSION" == "$LATEST_VERSION" && "$FORCE" == "false" ]]; then
    log "Already up to date! (use --force to rebuild anyway)"
    exit 0
  fi

  if [[ "$ACTION" == "check" ]]; then
    if [[ "$CURRENT_VERSION" == "$LATEST_VERSION" ]]; then
      log "Already up to date!"
    else
      warn "Update available: ${CURRENT_VERSION} -> ${LATEST_VERSION}"
    fi
    exit 0
  fi
else
  get_latest_edge
  LOCAL_COMMIT=$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  log "Latest edge commit: ${LATEST_COMMIT}"

  if [[ "$LOCAL_COMMIT" == "$LATEST_COMMIT" && "$FORCE" == "false" ]]; then
    log "Already up to date! (use --force to rebuild anyway)"
    exit 0
  fi

  if [[ "$ACTION" == "check" ]]; then
    if [[ "$LOCAL_COMMIT" == "$LATEST_COMMIT" ]]; then
      log "Already up to date!"
    else
      warn "Update available: ${LOCAL_COMMIT} -> ${LATEST_COMMIT}"
    fi
    exit 0
  fi
fi

# ---------- Backup ----------
header "Creating backup..."
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP_PATH="$BACKUP_BASE/$TIMESTAMP"
mkdir -p "$BACKUP_PATH"

# Backup backend
cp -a "$INSTALL_DIR/backend" "$BACKUP_PATH/backend"
log "Backend code backed up"

# Backup frontend if built
if [[ -d "$INSTALL_DIR/frontend/.next" ]]; then
  cp -a "$INSTALL_DIR/frontend" "$BACKUP_PATH/frontend"
  log "Frontend code backed up"
fi

# Backup database
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$INSTALL_DIR/backend/.env" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [[ -n "$DATABASE_URL" ]]; then
  if pg_dump "$DATABASE_URL" 2>/dev/null | gzip > "$BACKUP_PATH/database.sql.gz"; then
    log "Database backed up"
  else
    warn "Database backup failed — continuing without DB backup"
  fi
fi

# Backup version file
if [[ -f "$VERSION_FILE" ]]; then
  cp "$VERSION_FILE" "$BACKUP_PATH/version-file"
fi

# Write backup metadata
python3 -c "
import json, datetime
d = {
    'timestamp': '$TIMESTAMP',
    'version': '$(get_current_version)',
    'commit': '$(get_current_commit)',
    'mode': '$MODE',
    'createdAt': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
}
with open('$BACKUP_PATH/backup.json', 'w') as f:
    json.dump(d, f, indent=2)
"
log "Backup metadata written"

# Prune old backups (keep only 3 most recent)
BACKUP_COUNT=$(ls -dt "$BACKUP_BASE"/*/ 2>/dev/null | wc -l | tr -d ' ')
if [[ "$BACKUP_COUNT" -gt 3 ]]; then
  ls -dt "$BACKUP_BASE"/*/ | tail -n +4 | while read -r old_backup; do
    rm -rf "$old_backup"
    warn "Removed old backup: $old_backup"
  done
fi

log_to_file "UPGRADE started: $CURRENT_VERSION -> ${LATEST_VERSION:-edge:$LATEST_COMMIT} (mode=$MODE, backup=$BACKUP_PATH)"

# ---------- Pull code ----------
header "Pulling latest code..."
cd "$INSTALL_DIR"

if [[ "$MODE" == "stable" ]]; then
  git fetch --tags --quiet 2>/dev/null
  TAG="v${LATEST_VERSION}"
  # Try with v prefix first, then without
  if ! git tag -l "$TAG" | grep -q .; then
    TAG="${LATEST_VERSION}"
  fi
  git checkout "$TAG" --quiet 2>/dev/null || {
    fail "Could not checkout tag $TAG"
    do_rollback "checkout-failed"
    exit 1
  }
  log "Checked out tag: $TAG"
else
  git fetch origin main --quiet 2>/dev/null
  git reset --hard origin/main --quiet 2>/dev/null || git reset --hard origin/main 2>/dev/null
  log "Reset to origin/main ($LATEST_COMMIT)"
fi

# ---------- Install backend deps ----------
header "Installing backend dependencies..."
cd "$INSTALL_DIR/backend"
if ! npm ci 2>&1; then
  fail "npm ci failed"
  do_rollback "npm-ci-failed"
  exit 1
fi
log "Backend dependencies installed"

# ---------- Prisma generate + migrate ----------
header "Running database migrations..."
if ! npx prisma generate 2>&1; then
  fail "prisma generate failed"
  do_rollback "prisma-generate-failed"
  exit 1
fi
log "Prisma client generated"

MIGRATION_ATTEMPTED=true
if ! npx prisma migrate deploy 2>&1; then
  fail "prisma migrate deploy failed"
  do_rollback "migration-failed"
  exit 1
fi
log "Database migrations applied"

# ---------- Build backend ----------
header "Building backend..."
if ! npm run build 2>&1; then
  fail "Backend build failed"
  do_rollback "build-failed"
  exit 1
fi
log "Backend built"

# ---------- Frontend (if applicable) ----------
if [[ -f "$INSTALL_DIR/frontend/package.json" && -d "$INSTALL_DIR/frontend/.next" ]]; then
  header "Building frontend..."
  cd "$INSTALL_DIR/frontend"
  if ! npm ci 2>&1; then
    fail "Frontend npm ci failed"
    do_rollback "frontend-npm-ci-failed"
    exit 1
  fi
  if ! npm run build 2>&1; then
    fail "Frontend build failed"
    do_rollback "frontend-build-failed"
    exit 1
  fi
  log "Frontend built"
fi

# ---------- Nginx ----------
# Nginx config is generated during installation with user-specific settings
# (domain, SSL, client_max_body_size, etc.) — do NOT overwrite during upgrades.
# Just reload to pick up any upstream proxy changes.
if nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
  log "Nginx reloaded"
fi

# ---------- PM2 ----------
header "Restarting application..."

# Reload backend
if pm2 describe ship-dock-api &>/dev/null; then
  pm2 reload ship-dock-api 2>/dev/null
  log "Backend restarted (ship-dock-api)"
else
  pm2 start "$INSTALL_DIR/backend/dist/main.js" --name ship-dock-api -i 1 2>/dev/null || {
    fail "PM2 start ship-dock-api failed"
    do_rollback "pm2-failed"
    exit 1
  }
  log "Backend started (ship-dock-api)"
fi

# Reload frontend (if managed by PM2)
if pm2 describe ship-dock-web &>/dev/null; then
  pm2 reload ship-dock-web 2>/dev/null
  log "Frontend restarted (ship-dock-web)"
fi

pm2 save 2>/dev/null || true

# ---------- Health check ----------
if ! health_check; then
  do_rollback "health-check-failed"
  exit 1
fi

# ---------- Save version ----------
if [[ "$MODE" == "stable" ]]; then
  FINAL_COMMIT=$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  save_version "$LATEST_VERSION" "$FINAL_COMMIT"
else
  EDGE_VERSION=$(node -e "console.log(require('$INSTALL_DIR/backend/package.json').version)" 2>/dev/null || echo "edge")
  save_version "${EDGE_VERSION}-edge" "$LATEST_COMMIT"
fi

# ---------- Done ----------
log_to_file "UPGRADE completed: -> ${LATEST_VERSION:-edge:$LATEST_COMMIT}"

echo ""
header "Upgrade complete!"
log "Version: $(get_current_version) ($(get_current_commit))"
echo ""
