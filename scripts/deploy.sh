#!/bin/bash
# Ship-Dock Local Deployment Trigger
# Usage: ./scripts/deploy.sh
# Reads config from deploy.config.sh, SSH to server, runs deploy-remote.sh
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

PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# rsync uses -e for ssh options; port flag is different from ssh
RSYNC_SSH="ssh -o StrictHostKeyChecking=accept-new"
[[ -n "${PEM_PATH:-}" ]] && RSYNC_SSH="$RSYNC_SSH -i $PEM_PATH"
[[ -n "${SSH_PORT:-}" ]] && RSYNC_SSH="$RSYNC_SSH -p $SSH_PORT"

echo "==> Deploying to ${SSH_USER}@${SERVER_HOST} ..."
echo "    Project: ${PROJECT_DIR}"
echo "    Branch:  ${GIT_BRANCH}"
echo ""

# ── Upload source code to server ──
echo ">> Uploading source code via rsync ..."
ssh $SSH_OPTS "${SSH_USER}@${SERVER_HOST}" "sudo mkdir -p '${PROJECT_DIR}' && sudo chown ${SSH_USER}:${SSH_USER} '${PROJECT_DIR}'"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'scripts/deploy.config.sh' \
  --exclude '*.pem' \
  -e "$RSYNC_SSH" \
  "${PROJECT_ROOT}/" "${SSH_USER}@${SERVER_HOST}:${PROJECT_DIR}/"
echo "   Upload complete"
echo ""

# ── Always sync scripts to server ──
echo ">> Syncing deploy scripts ..."
rsync -az \
  --exclude 'deploy.config.sh' \
  --exclude '*.pem' \
  -e "$RSYNC_SSH" \
  "${SCRIPT_DIR}/" "${SSH_USER}@${SERVER_HOST}:${PROJECT_DIR}/scripts/"
echo "   Scripts synced"

# ── Always ensure .env exists on server ──
echo ">> Ensuring server .env file ..."
ssh $SSH_OPTS "${SSH_USER}@${SERVER_HOST}" "cat > '${PROJECT_DIR}/backend/.env' << ENVEOF
DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}
REDIS_PASSWORD=${REDIS_PASSWORD}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
BASE_URL=${BASE_URL}
SERVER_IP=${SERVER_IP}
NODE_ENV=${NODE_ENV}
PORT=${PORT}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}
MICROSOFT_CLIENT_ID=${MICROSOFT_CLIENT_ID}
MICROSOFT_CLIENT_SECRET=${MICROSOFT_CLIENT_SECRET}
MICROSOFT_REDIRECT_URI=${MICROSOFT_REDIRECT_URI}
MINIO_ENDPOINT=${MINIO_ENDPOINT}
MINIO_PORT=${MINIO_PORT}
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
MINIO_USE_SSL=${MINIO_USE_SSL}
FRONTEND_URL=${FRONTEND_URL}
GITHUB_APP_ID=${GITHUB_APP_ID}
GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY}
GITHUB_APP_WEBHOOK_SECRET=${GITHUB_APP_WEBHOOK_SECRET}
GITHUB_APP_CLIENT_ID=${GITHUB_APP_CLIENT_ID}
GITHUB_APP_CLIENT_SECRET=${GITHUB_APP_CLIENT_SECRET}
GITHUB_APP_SLUG=${GITHUB_APP_SLUG}
ENVEOF"
echo "   .env ready"
echo ""

# ── Run deploy-remote.sh on server ──
ssh $SSH_OPTS "${SSH_USER}@${SERVER_HOST}" \
  "export PROJECT_DIR='${PROJECT_DIR}' GIT_BRANCH='${GIT_BRANCH}' && bash ${PROJECT_DIR}/scripts/deploy-remote.sh"

echo ""
echo "==> Deployment triggered successfully!"
