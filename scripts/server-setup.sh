#!/bin/bash
# Ship Dock Server Environment Setup
# Run from local machine: ./scripts/server-setup.sh
# Connects via SSH and installs all required dependencies on Ubuntu server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/deploy.config.sh"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  echo "Run: cp scripts/deploy.config.example.sh scripts/deploy.config.sh"
  exit 1
fi

source "$CONFIG_FILE"

SSH_OPTS="-o StrictHostKeyChecking=accept-new"
[[ -n "${PEM_PATH:-}" ]] && SSH_OPTS="$SSH_OPTS -i $PEM_PATH"
[[ -n "${SSH_PORT:-}" ]] && SSH_OPTS="$SSH_OPTS -p $SSH_PORT"

echo "==> Connecting to ${SSH_USER}@${SERVER_HOST} ..."

ssh $SSH_OPTS "${SSH_USER}@${SERVER_HOST}" bash -s -- \
  "$DB_NAME" "$DB_USER" "$DB_PASSWORD" "$PROJECT_DIR" << 'REMOTE_SCRIPT'
set -euo pipefail

DB_NAME="$1"
DB_USER="$2"
DB_PASSWORD="$3"
PROJECT_DIR="$4"

export DEBIAN_FRONTEND=noninteractive

ok()   { echo "  [OK] $1 — already installed"; }
inst() { echo "  [INSTALLING] $1 ..."; }

echo ""
echo "=============================="
echo "  Ship Dock Server Environment Setup"
echo "=============================="
echo ""

# ── 1. System update ──
echo ">> Updating system packages ..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# ── 2. Node.js 20 ──
echo ""
echo ">> Checking Node.js ..."
if command -v node &>/dev/null && node -v | grep -q "^v20"; then
  ok "Node.js $(node -v)"
else
  inst "Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
  echo "  Installed Node.js $(node -v)"
fi

# ── 3. pnpm ──
echo ""
echo ">> Checking pnpm ..."
if command -v pnpm &>/dev/null; then
  ok "pnpm $(pnpm -v)"
else
  inst "pnpm"
  sudo corepack enable
  sudo corepack prepare pnpm@9.15.4 --activate
  echo "  Installed pnpm $(pnpm -v)"
fi

# ── 4. PostgreSQL 16 ──
echo ""
echo ">> Checking PostgreSQL ..."
if command -v psql &>/dev/null && psql --version | grep -q "16"; then
  ok "PostgreSQL $(psql --version | awk '{print $3}')"
else
  inst "PostgreSQL 16"
  sudo apt-get install -y -qq gnupg2 lsb-release
  echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-16 postgresql-client-16
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
  echo "  Installed PostgreSQL 16"
fi

# ── 5. pgvector extension ──
echo ""
echo ">> Checking pgvector ..."
if dpkg -l | grep -q postgresql-16-pgvector; then
  ok "pgvector"
else
  inst "pgvector"
  sudo apt-get install -y -qq postgresql-16-pgvector
  echo "  Installed pgvector"
fi

# ── 6. Create database & user ──
echo ""
echo ">> Checking database ..."
if sudo -u postgres psql -lqt | cut -d\| -f1 | grep -qw "$DB_NAME"; then
  ok "Database '$DB_NAME' exists"
else
  inst "Creating database '$DB_NAME'"
  sudo -u postgres psql <<-SQL
    CREATE USER "$DB_USER" WITH PASSWORD '$DB_PASSWORD';
    CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
SQL
  echo "  Database '$DB_NAME' created"
fi

# Enable pgvector extension on the database
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null
echo "  [OK] pgvector extension enabled on '$DB_NAME'"

# ── 7. Redis 7 ──
echo ""
echo ">> Checking Redis ..."
if command -v redis-server &>/dev/null; then
  ok "Redis $(redis-server --version | awk '{print $3}' | cut -d= -f2)"
else
  inst "Redis"
  sudo apt-get install -y -qq redis-server
  sudo systemctl enable redis-server
  sudo systemctl start redis-server
  echo "  Installed Redis"
fi

# ── 8. Nginx ──
echo ""
echo ">> Checking Nginx ..."
if command -v nginx &>/dev/null; then
  ok "Nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"
else
  inst "Nginx"
  sudo apt-get install -y -qq nginx
  sudo systemctl enable nginx
  sudo systemctl start nginx
  echo "  Installed Nginx"
fi

# ── 9. PM2 ──
echo ""
echo ">> Checking PM2 ..."
if command -v pm2 &>/dev/null; then
  ok "PM2 $(pm2 -v)"
else
  inst "PM2"
  sudo npm install -g pm2
  sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true
  echo "  Installed PM2 $(pm2 -v)"
fi

# ── 10. Git ──
echo ""
echo ">> Checking Git ..."
if command -v git &>/dev/null; then
  ok "Git $(git --version | awk '{print $3}')"
else
  inst "Git"
  sudo apt-get install -y -qq git
  echo "  Installed Git"
fi

# ── 11. Create project directory ──
echo ""
echo ">> Checking project directory ..."
if [[ -d "$PROJECT_DIR" ]]; then
  ok "Project directory $PROJECT_DIR"
else
  sudo mkdir -p "$PROJECT_DIR"
  sudo chown "$USER:$USER" "$PROJECT_DIR"
  echo "  Created $PROJECT_DIR"
fi

# ── 12. Create uploads directory ──
mkdir -p "$PROJECT_DIR/uploads" 2>/dev/null || sudo mkdir -p "$PROJECT_DIR/uploads"

# ── Summary ──
echo ""
echo "=============================="
echo "  Setup Complete!"
echo "=============================="
echo ""
echo "  Node.js:     $(node -v)"
echo "  pnpm:        $(pnpm -v)"
echo "  PostgreSQL:  $(psql --version | awk '{print $3}')"
echo "  Redis:       $(redis-server --version | awk '{print $3}' | cut -d= -f2)"
echo "  Nginx:       $(nginx -v 2>&1 | awk -F/ '{print $2}')"
echo "  PM2:         $(pm2 -v)"
echo "  Git:         $(git --version | awk '{print $3}')"
echo ""
echo "Next steps:"
echo "  1. Clone your repo to $PROJECT_DIR"
echo "  2. Copy nginx/ship-dock.conf to /etc/nginx/sites-enabled/"
echo "  3. Set up SSL certificates"
echo "  4. Create .env file in $PROJECT_DIR/apps/server/"
echo "  5. Run deploy script"
echo ""
REMOTE_SCRIPT

echo ""
echo "==> Server setup finished!"
