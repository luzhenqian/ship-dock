#!/bin/bash
# Ship Dock — Auto-install missing server dependencies
# Runs on the server. Called by deploy.sh when env-check detects missing components.
set -euo pipefail

DB_NAME="${1:-shipdock}"
DB_USER="${2:-shipdock}"
DB_PASSWORD="${3:-}"
PROJECT_DIR="${4:-/projects/ship-dock}"
MINIO_ACCESS_KEY="${5:-minioadmin}"
MINIO_SECRET_KEY="${6:-minioadmin}"

export DEBIAN_FRONTEND=noninteractive

UPDATED=false
ensure_updated() {
  if ! $UPDATED; then
    echo ">> Updating package index ..."
    sudo apt-get update -qq
    UPDATED=true
  fi
}

echo ""
echo "=============================="
echo "  Ship Dock — Installing Dependencies"
echo "=============================="

# ── Node.js 20 ──
if ! command -v node &>/dev/null || ! node -v | grep -q "^v2[0-9]"; then
  ensure_updated
  echo ""
  echo ">> Installing Node.js 20 ..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
  echo "   Installed Node.js $(node -v)"
fi

# ── PM2 ──
if ! command -v pm2 &>/dev/null; then
  echo ""
  echo ">> Installing PM2 ..."
  sudo npm install -g pm2
  sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true
  echo "   Installed PM2 $(pm2 -v)"
fi

# ── Git ──
if ! command -v git &>/dev/null; then
  ensure_updated
  echo ""
  echo ">> Installing Git ..."
  sudo apt-get install -y -qq git
  echo "   Installed Git"
fi

# ── PostgreSQL 16 ──
if ! command -v psql &>/dev/null; then
  ensure_updated
  echo ""
  echo ">> Installing PostgreSQL 16 ..."
  sudo apt-get install -y -qq gnupg2 lsb-release
  echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-16 postgresql-client-16 postgresql-16-pgvector
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
  echo "   Installed PostgreSQL 16"
fi

# ── Database & user ──
if command -v psql &>/dev/null; then
  if ! sudo -u postgres psql -lqt | cut -d\| -f1 | grep -qw "$DB_NAME"; then
    echo ""
    echo ">> Creating database '$DB_NAME' ..."
    sudo -u postgres psql -c "CREATE USER \"$DB_USER\" WITH PASSWORD '$DB_PASSWORD' CREATEDB;" 2>/dev/null || true
    sudo -u postgres psql -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
    echo "   Database '$DB_NAME' created"
  fi
  sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null
fi

# ── Redis ──
if ! command -v redis-server &>/dev/null; then
  ensure_updated
  echo ""
  echo ">> Installing Redis ..."
  sudo apt-get install -y -qq redis-server
  sudo systemctl enable redis-server
  sudo systemctl start redis-server
  echo "   Installed Redis"
fi

# ── Nginx ──
if ! command -v nginx &>/dev/null; then
  ensure_updated
  echo ""
  echo ">> Installing Nginx ..."
  sudo apt-get install -y -qq nginx
  sudo systemctl enable nginx
  sudo systemctl start nginx
  echo "   Installed Nginx"
fi

# ── MinIO ──
if ! command -v minio &>/dev/null; then
  echo ""
  echo ">> Installing MinIO ..."
  ARCH=$(dpkg --print-architecture)
  curl -fsSL "https://dl.min.io/server/minio/release/linux-${ARCH}/minio" -o /tmp/minio
  sudo install -m 755 /tmp/minio /usr/local/bin/minio
  rm -f /tmp/minio

  # Create minio user and data directory
  sudo useradd -r -s /sbin/nologin minio-user 2>/dev/null || true
  sudo mkdir -p /data/minio
  sudo chown minio-user:minio-user /data/minio

  # Create environment file
  sudo tee /etc/default/minio > /dev/null <<MINIO_ENV
MINIO_ROOT_USER=${MINIO_ACCESS_KEY}
MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}
MINIO_VOLUMES="/data/minio"
MINIO_OPTS="--address :9000 --console-address :9001"
MINIO_ENV

  # Create systemd service
  sudo tee /etc/systemd/system/minio.service > /dev/null <<'MINIO_SVC'
[Unit]
Description=MinIO Object Storage
After=network-online.target
Wants=network-online.target

[Service]
User=minio-user
Group=minio-user
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server $MINIO_OPTS $MINIO_VOLUMES
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
MINIO_SVC

  sudo systemctl daemon-reload
  sudo systemctl enable minio
  sudo systemctl start minio
  echo "   Installed MinIO (API: :9000, Console: :9001)"

  # Configure mc aliases
  if command -v mc &>/dev/null; then
    mc alias set local http://localhost:9000 "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" 2>/dev/null
    mc alias set shipdock http://localhost:9000 "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" 2>/dev/null
    echo "   Configured mc aliases 'local' and 'shipdock'"
  fi
fi

# ── Ensure all services are running ──
echo ""
echo ">> Ensuring services are running ..."
for svc in postgresql redis-server nginx minio; do
  if systemctl is-enabled --quiet "$svc" 2>/dev/null && \
     ! systemctl is-active --quiet "$svc" 2>/dev/null; then
    echo "   Starting $svc ..."
    sudo systemctl start "$svc"
  fi
done

# ── Project directory ──
sudo mkdir -p "$PROJECT_DIR"
sudo chown "$USER:$USER" "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/uploads" 2>/dev/null || true

echo ""
echo "=============================="
echo "  All dependencies installed!"
echo "=============================="
echo ""
echo "  Node.js:     $(node -v)"
echo "  npm:         $(npm -v)"
echo "  PM2:         $(pm2 -v 2>/dev/null || echo 'N/A')"
echo "  PostgreSQL:  $(psql --version 2>/dev/null | awk '{print $3}' || echo 'N/A')"
echo "  Redis:       $(redis-server --version 2>/dev/null | awk '{print $3}' | cut -d= -f2 || echo 'N/A')"
echo "  Nginx:       $(nginx -v 2>&1 | awk -F/ '{print $2}' || echo 'N/A')"
echo "  MinIO:       $(minio --version 2>/dev/null | awk '{print $3}' || echo 'N/A')"
echo "  Git:         $(git --version 2>/dev/null | awk '{print $3}' || echo 'N/A')"
echo ""
