#!/bin/bash
# Ship-Dock Server-Side Deployment Script
# This script runs ON the server. Called by:
#   - Local: scripts/deploy.sh (via SSH)
#   - CI:    GitHub Actions (via SSH)
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/projects/ship-dock}"
GIT_BRANCH="${GIT_BRANCH:-main}"

cd "$PROJECT_DIR"

echo ""
echo "=============================="
echo "  Ship-Dock Deployment"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================="

# ── 1. Pull latest code ──
echo ""
echo ">> Pulling latest code (${GIT_BRANCH}) ..."
if [[ -d .git ]]; then
  git fetch origin "$GIT_BRANCH"
  git reset --hard "origin/$GIT_BRANCH"
  echo "  Commit: $(git log -1 --format='%h %s')"
else
  echo "  No git repo found — using uploaded source code (first deploy)"
fi

# ── 2. Install backend dependencies ──
echo ""
echo ">> Installing backend dependencies ..."
cd "$PROJECT_DIR/backend"
npm ci

# ── 3. Prisma generate ──
echo ""
echo ">> Generating Prisma client ..."
npx prisma generate

# ── 4. Database migration ──
echo ""
echo ">> Syncing database schema ..."
npx prisma db push --accept-data-loss

# ── 5. Build backend ──
echo ""
echo ">> Building backend ..."
npm run build

cd "$PROJECT_DIR"

# ── 6. Sync nginx config ──
echo ""
echo ">> Syncing nginx config ..."
if [[ -f nginx/yione.conf ]]; then
  sudo cp nginx/yione.conf /etc/nginx/sites-available/yione.conf
  sudo ln -sf /etc/nginx/sites-available/yione.conf /etc/nginx/sites-enabled/yione.conf
  sudo rm -f /etc/nginx/sites-enabled/default
  if sudo nginx -t 2>/dev/null; then
    sudo systemctl reload nginx
    echo "  Nginx config updated and reloaded"
  else
    echo "  WARNING: Nginx config test failed, skipping reload"
  fi
else
  echo "  No nginx config found, skipping"
fi

# ── 7. Restart PM2 ──
echo ""
echo ">> Restarting PM2 ..."
cd "$PROJECT_DIR/backend"
if pm2 describe ship-dock-api &>/dev/null; then
  pm2 reload ship-dock-api
  echo "  PM2 reloaded (zero-downtime)"
else
  pm2 start dist/main.js --name ship-dock-api -i max --env production
  pm2 save
  echo "  PM2 started fresh"
fi

# ── 8. Health check ──
echo ""
echo ">> Health check ..."
sleep 3
if curl -sf http://localhost:4000/api/health > /dev/null 2>&1; then
  echo "  Health check passed!"
else
  echo "  WARNING: Health check failed — check logs with: pm2 logs ship-dock-api"
fi

echo ""
echo "=============================="
echo "  Deployment Complete!"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================="
