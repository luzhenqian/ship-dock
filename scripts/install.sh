#!/bin/bash
# Ship Dock Installer
# Usage: curl -fsSL https://beta.shipdock.web3noah.com/install | bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/luzhenqian/ship-dock.git"
INSTALL_DIR="/opt/shipdock"

echo ""
echo -e "${BOLD}▲ Ship Dock Installer${NC}"
echo ""

# ── Check root ──
if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}Error: This script must be run as root.${NC}"
  echo "  Run: sudo sh -c \"\$(curl -fsSL https://beta.shipdock.web3noah.com/install)\""
  exit 1
fi

# ── Detect OS ──
if command -v apt-get &>/dev/null; then
  PM="apt"
elif command -v dnf &>/dev/null; then
  PM="dnf"
elif command -v yum &>/dev/null; then
  PM="yum"
else
  echo -e "${RED}Error: Unsupported OS. Ship Dock requires Debian/Ubuntu or CentOS/RHEL.${NC}"
  exit 1
fi

echo -e "${GRAY}Detected package manager: ${PM}${NC}"

# ── Check existing installation ──
if [[ -d "$INSTALL_DIR" ]]; then
  echo ""
  echo -e "${BOLD}Ship Dock is already installed at ${INSTALL_DIR}.${NC}"
  read -rp "Overwrite and reinstall? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
  rm -rf "$INSTALL_DIR"
fi

# ── Install Node.js (multiple versions via n) ──
if command -v node &>/dev/null && node -v | grep -q "^v2[0-9]"; then
  echo -e "${GREEN}✓${NC} Node.js $(node -v) already installed"
else
  echo -e "  Installing Node.js 22 (default)..."
  if [[ "$PM" == "apt" ]]; then
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    $PM install -y nodejs
  fi
  echo -e "${GREEN}✓${NC} Node.js $(node -v) installed"
fi

# ── Install n (Node version manager) and additional versions ──
if command -v n &>/dev/null; then
  echo -e "${GREEN}✓${NC} n (Node version manager) already installed"
else
  echo "  Installing n (Node version manager)..."
  npm install -g n
  echo -e "${GREEN}✓${NC} n installed"
fi

echo "  Installing Node.js 20, 22, 24..."
n install 20 >/dev/null 2>&1 && echo -e "${GREEN}✓${NC} Node.js 20 installed"
n install 22 >/dev/null 2>&1 && echo -e "${GREEN}✓${NC} Node.js 22 installed"
n install 24 >/dev/null 2>&1 && echo -e "${GREEN}✓${NC} Node.js 24 installed"
# Keep 22 as default
n 22 >/dev/null 2>&1

# ── Install Git ──
if command -v git &>/dev/null; then
  echo -e "${GREEN}✓${NC} Git $(git --version | awk '{print $3}') already installed"
else
  echo "  Installing Git..."
  if [[ "$PM" == "apt" ]]; then
    apt-get install -y -qq git
  else
    $PM install -y git
  fi
  echo -e "${GREEN}✓${NC} Git installed"
fi

# ── Clone repository ──
echo ""
echo "  Cloning Ship Dock..."
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
echo -e "${GREEN}✓${NC} Cloned to $INSTALL_DIR"

# ── Install CLI dependencies ──
echo "  Installing CLI dependencies..."
cd "$INSTALL_DIR/cli"
npm install --silent
echo -e "${GREEN}✓${NC} CLI ready"

# ── Install ship-dock CLI ──
echo "  Installing ship-dock command..."
chmod +x "$INSTALL_DIR/scripts/ship-dock"
chmod +x "$INSTALL_DIR/scripts/upgrade.sh"
ln -sf "$INSTALL_DIR/scripts/ship-dock" /usr/local/bin/ship-dock
echo -e "${GREEN}✓${NC} ship-dock command installed"

# ── Launch interactive setup ──
echo ""
exec </dev/tty npx tsx src/index.tsx init
