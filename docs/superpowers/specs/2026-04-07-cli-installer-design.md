# Ship Dock CLI Installer Design

## Overview

A React + Ink interactive CLI tool that runs directly on a target server to initialize the entire Ship Dock platform. Replaces the current SSH/rsync deployment flow with a single `curl | sh` command.

**Scope:** Initial setup only. No ongoing management, updates, or maintenance commands.

## User Experience

### Entry Point

```bash
curl -fsSL https://beta.shipdock.web3noah.com/install | sh
```

### Visual Style

Vercel CLI-inspired: minimal black/white, vertical line connectors, `◆` markers for prompts, `✓`/`✗` for task status. Spinner animation for in-progress tasks.

### Three-Phase Flow

#### Phase 1: Information Collection

Sequential prompts with vertical line connectors:

| Field | Type | Default | Required |
|-------|------|---------|----------|
| Admin email | text input | — | yes |
| Admin password | password input | — | yes |
| Domain | text input | — | yes |
| API port | text input | 4000 | no |
| Enable SSL (Let's Encrypt) | yes/no select | Yes | no |
| PostgreSQL password | password input | auto-generate | no |
| Redis password | password input | auto-generate | no |
| MinIO access key | text input | auto-generate | no |
| MinIO secret key | password input | auto-generate | no |
| JWT secret | password input | auto-generate | no |

Leaving password/key fields empty triggers automatic generation (random 32-char strings).

#### Phase 2: Dependency Detection + Installation

1. CLI scans the system for installed dependencies and versions
2. Displays a checklist showing what's already installed and what needs installing:
   ```
   Dependencies:
     ✓ Node.js 20.x (already installed)
     ◆ PostgreSQL 16 (will install)
     ◆ Redis 7 (will install)
     ◆ Nginx (will install)
     ◆ MinIO (will install)
     ◆ PM2 (will install)
   ```
3. User confirms to proceed
4. Each dependency installs sequentially with real-time status updates

Package manager auto-detection: apt (Debian/Ubuntu) or yum/dnf (CentOS/RHEL).

#### Phase 3: Service Initialization

Sequential execution with progress display:

1. Generate configuration files (`.env`, Nginx config, PM2 ecosystem)
2. Initialize database (Prisma migrate deploy)
3. Install pgvector extension
4. Create admin account
5. Configure Nginx reverse proxy
6. Configure SSL certificate (if enabled)
7. Initialize MinIO buckets
8. Start all services via PM2
9. Save credentials to `~/.shipdock/credentials` (chmod 600)
10. Display complete report

### Completion Report

Terminal output includes:
- Platform URL (`https://deploy.example.com`)
- Admin credentials
- All service ports and credentials (PostgreSQL, Redis, MinIO)
- Configuration file paths
- Credentials file location

All credentials also saved to `~/.shipdock/credentials`.

## Architecture

### Technology Stack

- **React + Ink** — Terminal UI rendering
- **Commander.js** — CLI argument parsing
- **TypeScript** — Type safety
- **tsx** — TypeScript execution without build step

### Project Structure

```
cli/
  package.json
  tsconfig.json
  src/
    index.tsx           # Entry point, Commander.js command definition
    app.tsx             # Main App, useReducer state machine
    components/
      header.tsx        # ▲ Ship Dock v1.0.0 branding
      text-input.tsx    # ◆ text input with vertical line
      password-input.tsx # ◆ masked password input
      select.tsx        # ◆ yes/no selection
      confirm.tsx       # Confirmation checklist
      task-list.tsx     # ✓/◼/✗ progress list
      report.tsx        # Final report display
    phases/
      collect.tsx       # Phase 1: information collection
      install.tsx       # Phase 2: dependency detection + installation
      initialize.tsx    # Phase 3: service initialization
    lib/
      detect.ts         # Detect installed dependencies and versions
      installers.ts     # Per-dependency install logic (apt/yum)
      config.ts         # Generate .env, Nginx, PM2 config files
      credentials.ts    # Key generation + credentials file I/O
      shell.ts          # child_process.execFile wrapper returning Promise
scripts/
  install.sh            # Bootstrap script (downloaded via curl)
```

### State Machine

App component manages flow via `useReducer`:

```
collecting → confirming → installing → initializing → done
```

Each state maps to a phase component. Transitions happen when a phase completes.

### Bootstrap Script (`scripts/install.sh`)

Responsibilities:
1. Check root permissions (exit if not root)
2. Detect OS (Debian/Ubuntu or CentOS/RHEL; exit on unsupported)
3. Install Node.js 20 if missing (NodeSource repository)
4. Install Git if missing
5. Check if `/opt/shipdock` exists — if yes, prompt: overwrite or exit
6. `git clone https://github.com/<owner>/ship-dock.git /opt/shipdock` (repo URL configured in the script)
7. `cd /opt/shipdock/cli && npm install && npx tsx src/index.tsx init`

### Installation Path

`/opt/shipdock` — standard Linux location for third-party applications.

## Error Handling

- **Per-step failure:** Each install step runs independently. Failure shows `✗` + error message. Non-critical steps don't block subsequent steps.
- **Critical failure:** If a critical dependency (PostgreSQL, Node.js) fails to install, halt and display error with guidance.
- **Install log:** All output written to `/opt/shipdock/install.log`. Error messages reference this file.
- **Repeat runs:** Detect existing `/opt/shipdock` and prompt user to overwrite or exit. Already-installed dependencies are skipped.

## Supported Platforms

| OS | Package Manager |
|----|----------------|
| Debian / Ubuntu | apt |
| CentOS / RHEL | yum / dnf |

Other operating systems: exit immediately with "unsupported OS" message.
