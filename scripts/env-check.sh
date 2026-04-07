#!/bin/bash
# Ship Dock — Lightweight Server Environment Check
# Runs on the server. Detects missing dependencies without installing anything.
# Exit code: 0 = all OK, 1 = missing dependencies
# Output format: STATUS|name|detail (one line per check)

MISSING=0

check_cmd() {
  local name="$1" cmd="$2" version_check="${3:-}"
  if command -v "$cmd" &>/dev/null; then
    if [[ -n "$version_check" ]]; then
      if eval "$version_check" &>/dev/null; then
        echo "OK|$name|$(command -v "$cmd")"
      else
        echo "WRONG_VERSION|$name|needs upgrade"
        MISSING=1
      fi
    else
      echo "OK|$name|$(command -v "$cmd")"
    fi
  else
    echo "MISSING|$name|not installed"
    MISSING=1
  fi
}

check_service() {
  local name="$1" service="$2"
  if systemctl is-active --quiet "$service" 2>/dev/null; then
    echo "OK|$name|running"
  elif systemctl is-enabled --quiet "$service" 2>/dev/null; then
    echo "STOPPED|$name|installed but not running"
    MISSING=1
  else
    echo "MISSING|$name|not installed"
    MISSING=1
  fi
}

check_db() {
  local db_name="$1"
  if sudo -u postgres psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw "$db_name"; then
    echo "OK|database:$db_name|exists"
  else
    echo "MISSING|database:$db_name|not created"
    MISSING=1
  fi
}

check_minio() {
  # MinIO can be installed as binary or running as systemd service
  if command -v minio &>/dev/null; then
    if systemctl is-active --quiet minio 2>/dev/null; then
      echo "OK|minio|running"
    else
      echo "STOPPED|minio|installed but not running"
      MISSING=1
    fi
  else
    echo "MISSING|minio|not installed"
    MISSING=1
  fi
}

# ── Commands ──
check_cmd "node"      "node"      'node -v | grep -q "^v2[0-9]"'
check_cmd "npm"       "npm"
check_cmd "pm2"       "pm2"
check_cmd "git"       "git"
check_cmd "nginx"     "nginx"
check_cmd "psql"      "psql"      'psql --version | grep -qE "1[6-9]\.|2[0-9]\."'
check_cmd "redis-cli" "redis-cli"

# ── Services ──
check_service "postgresql" "postgresql"
check_service "redis"      "redis-server"
check_service "nginx"      "nginx"

# ── MinIO ──
check_minio

# ── Database (if db name provided as $1) ──
if [[ -n "${1:-}" ]] && command -v psql &>/dev/null; then
  check_db "$1"
fi

exit $MISSING
