#!/bin/bash
# YiOne Deployment Configuration
# Copy this file to deploy.config.sh and fill in your values:
#   cp scripts/deploy.config.example.sh scripts/deploy.config.sh
#
# WARNING: deploy.config.sh contains secrets — it is gitignored.

# ── Server Connection ──
SERVER_HOST="your-server-ip"
SSH_USER="root"
PEM_PATH="~/.ssh/your-key.pem"
SSH_PORT="22"

# ── Project Paths ──
PROJECT_DIR="/opt/yione"
GIT_BRANCH="main"

# ── PostgreSQL ──
DB_NAME="yione"
DB_USER="yione"
DB_PASSWORD="change_me_in_production"

# ── Application ──
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="change_me_jwt_secret"
JWT_REFRESH_SECRET="change_me_jwt_refresh_secret"
NODE_ENV="production"
PORT="4000"
