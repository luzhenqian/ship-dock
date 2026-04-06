#!/bin/bash
# Ship Dock Database Backup Script
# Usage: ./scripts/db-backup.sh [daily|weekly|manual]
# Requires: pg_dump, DATABASE_URL environment variable
set -euo pipefail

BACKUP_TYPE="${1:-manual}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/opt/ship-dock/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Extract DB connection from DATABASE_URL
DB_URL="${DATABASE_URL:?DATABASE_URL environment variable is required}"

# Create backup directory
mkdir -p "${BACKUP_DIR}/${BACKUP_TYPE}"

BACKUP_FILE="${BACKUP_DIR}/${BACKUP_TYPE}/ship_dock_${BACKUP_TYPE}_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting ${BACKUP_TYPE} backup..."

# Dump and compress
pg_dump "${DB_URL}" --no-owner --no-acl --clean --if-exists | gzip > "${BACKUP_FILE}"

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date)] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Clean up old backups
echo "[$(date)] Cleaning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}/${BACKUP_TYPE}" -name "*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true

# List remaining backups
BACKUP_COUNT=$(find "${BACKUP_DIR}/${BACKUP_TYPE}" -name "*.sql.gz" | wc -l | tr -d ' ')
echo "[$(date)] ${BACKUP_COUNT} ${BACKUP_TYPE} backups retained"
echo "[$(date)] Done."
