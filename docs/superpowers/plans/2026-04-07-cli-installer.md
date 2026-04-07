# CLI Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React + Ink interactive CLI that initializes Ship Dock on a fresh server via `curl -fsSL https://beta.shipdock.web3noah.com/install | sh`.

**Architecture:** A standalone `cli/` package in the monorepo using React + Ink for terminal UI and Commander.js for command parsing. A bootstrap shell script handles Node.js/Git installation and repo cloning, then hands off to the Ink app which guides the user through configuration, dependency installation, and service initialization.

**Tech Stack:** React 19, Ink 5, Commander.js, TypeScript, tsx (runtime), child_process for shell execution

---

### Task 1: Project Scaffolding

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/src/index.tsx`
- Create: `cli/src/app.tsx`

- [ ] **Step 1: Create `cli/package.json`**

```json
{
  "name": "shipdock-cli",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.tsx",
    "init": "tsx src/index.tsx init"
  },
  "dependencies": {
    "ink": "^5.1.0",
    "ink-text-input": "^6.0.0",
    "ink-select-input": "^6.0.0",
    "ink-spinner": "^5.0.0",
    "react": "^19.0.0",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create `cli/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `cli/src/index.tsx`**

Entry point — Commander.js defines the `init` command, renders the Ink app.

```tsx
#!/usr/bin/env node
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './app.js';

const program = new Command();

program
  .name('shipdock')
  .description('Ship Dock CLI installer')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Ship Dock on this server')
  .action(() => {
    render(<App />);
  });

program.parse();
```

- [ ] **Step 4: Create `cli/src/app.tsx`**

Skeleton App with state machine. Renders the current phase.

```tsx
import React, { useReducer } from 'react';
import { Box, Text } from 'ink';

type Phase = 'collecting' | 'confirming' | 'installing' | 'initializing' | 'done';

interface State {
  phase: Phase;
  config: Record<string, string>;
}

type Action =
  | { type: 'SET_CONFIG'; config: Record<string, string> }
  | { type: 'CONFIRM' }
  | { type: 'INSTALL_DONE' }
  | { type: 'INIT_DONE' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: action.config, phase: 'confirming' };
    case 'CONFIRM':
      return { ...state, phase: 'installing' };
    case 'INSTALL_DONE':
      return { ...state, phase: 'initializing' };
    case 'INIT_DONE':
      return { ...state, phase: 'done' };
    default:
      return state;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, {
    phase: 'collecting',
    config: {},
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>▲ Ship Dock</Text>
        <Text color="gray">  v1.0.0</Text>
      </Box>
      <Text color="gray">Phase: {state.phase} (placeholder)</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Install dependencies and verify**

Run: `cd /opt/shipdock/cli && npm install && npx tsx src/index.tsx init`
Expected: Shows the Ship Dock header and "Phase: collecting (placeholder)"

- [ ] **Step 6: Commit**

```bash
git add cli/
git commit -m "feat(cli): scaffold project with React + Ink + Commander.js"
```

---

### Task 2: Shell Utility Library

**Files:**
- Create: `cli/src/lib/shell.ts`

- [ ] **Step 1: Create `cli/src/lib/shell.ts`**

Wraps `child_process.execFile` to return a Promise with stdout/stderr. Used by detect and install logic.

```ts
import { execFile, exec } from 'child_process';

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function run(command: string, args: string[] = []): Promise<ShellResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 300_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString().trim() ?? '',
        stderr: stderr?.toString().trim() ?? '',
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}

export function runShell(command: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: 300_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString().trim() ?? '',
        stderr: stderr?.toString().trim() ?? '',
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/lib/shell.ts
git commit -m "feat(cli): add shell execution utility"
```

---

### Task 3: Credentials Utility Library

**Files:**
- Create: `cli/src/lib/credentials.ts`

- [ ] **Step 1: Create `cli/src/lib/credentials.ts`**

Generates random secrets and writes the credentials file.

```ts
import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'fs';
import { dirname } from 'path';

export function generateSecret(length = 32): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

export interface Credentials {
  adminEmail: string;
  adminPassword: string;
  domain: string;
  port: string;
  ssl: boolean;
  dbPassword: string;
  redisPassword: string;
  minioAccessKey: string;
  minioSecretKey: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  encryptionKey: string;
}

export function saveCredentials(creds: Credentials, path: string): void {
  mkdirSync(dirname(path), { recursive: true });

  const lines = [
    '# Ship Dock Credentials',
    `# Generated at ${new Date().toISOString()}`,
    '',
    `Admin Email:       ${creds.adminEmail}`,
    `Admin Password:    ${creds.adminPassword}`,
    '',
    `Domain:            ${creds.domain}`,
    `API Port:          ${creds.port}`,
    `SSL:               ${creds.ssl ? 'enabled' : 'disabled'}`,
    '',
    `PostgreSQL Password: ${creds.dbPassword}`,
    `Redis Password:      ${creds.redisPassword}`,
    '',
    `MinIO Access Key:  ${creds.minioAccessKey}`,
    `MinIO Secret Key:  ${creds.minioSecretKey}`,
    '',
    `JWT Secret:        ${creds.jwtSecret}`,
    `JWT Refresh Secret: ${creds.jwtRefreshSecret}`,
    `Encryption Key:    ${creds.encryptionKey}`,
  ];

  writeFileSync(path, lines.join('\n') + '\n');
  chmodSync(path, 0o600);
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/lib/credentials.ts
git commit -m "feat(cli): add credentials generation and file writing utility"
```

---

### Task 4: Dependency Detection Library

**Files:**
- Create: `cli/src/lib/detect.ts`

- [ ] **Step 1: Create `cli/src/lib/detect.ts`**

Detects installed dependencies. Returns structured results for the UI.

```ts
import { run, runShell } from './shell.js';

export interface Dependency {
  name: string;
  installed: boolean;
  version?: string;
  service?: 'running' | 'stopped' | 'not-installed';
}

async function checkCommand(name: string, cmd: string, versionArg: string, versionParser: (out: string) => string): Promise<Dependency> {
  const result = await run(cmd, [versionArg]);
  if (result.exitCode !== 0) {
    return { name, installed: false };
  }
  return { name, installed: true, version: versionParser(result.stdout) };
}

async function checkService(name: string, serviceName: string): Promise<'running' | 'stopped' | 'not-installed'> {
  const result = await runShell(`systemctl is-active ${serviceName} 2>/dev/null`);
  if (result.stdout === 'active') return 'running';
  const enabled = await runShell(`systemctl is-enabled ${serviceName} 2>/dev/null`);
  if (enabled.stdout === 'enabled' || enabled.stdout === 'disabled') return 'stopped';
  return 'not-installed';
}

export async function detectAll(): Promise<Dependency[]> {
  const deps: Dependency[] = [];

  // PostgreSQL
  const psql = await checkCommand('PostgreSQL 16', 'psql', '--version', (out) => {
    const m = out.match(/(\d+\.\d+)/);
    return m?.[1] ?? out;
  });
  if (psql.installed) {
    psql.service = await checkService('postgresql', 'postgresql');
  }
  deps.push(psql);

  // Redis
  const redis = await checkCommand('Redis 7', 'redis-server', '--version', (out) => {
    const m = out.match(/v=(\d+\.\d+\.\d+)/);
    return m?.[1] ?? out;
  });
  if (redis.installed) {
    redis.service = await checkService('redis', 'redis-server');
  }
  deps.push(redis);

  // Nginx
  const nginx = await checkCommand('Nginx', 'nginx', '-v', (out) => {
    // nginx -v writes to stderr, but our run() captures both
    return out;
  });
  // nginx -v outputs to stderr
  if (!nginx.installed) {
    const fallback = await runShell('nginx -v 2>&1');
    if (fallback.exitCode === 0 || fallback.stdout.includes('nginx')) {
      nginx.installed = true;
      const m = fallback.stdout.match(/nginx\/(\S+)/);
      nginx.version = m?.[1] ?? fallback.stdout;
    }
  }
  if (nginx.installed) {
    nginx.service = await checkService('nginx', 'nginx');
  }
  deps.push(nginx);

  // MinIO
  const minio = await runShell('command -v minio');
  const minioDep: Dependency = { name: 'MinIO', installed: minio.exitCode === 0 };
  if (minioDep.installed) {
    minioDep.service = await checkService('minio', 'minio');
  }
  deps.push(minioDep);

  // PM2
  const pm2 = await checkCommand('PM2', 'pm2', '-v', (out) => out.trim());
  deps.push(pm2);

  return deps;
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/lib/detect.ts
git commit -m "feat(cli): add dependency detection library"
```

---

### Task 5: Dependency Installers Library

**Files:**
- Create: `cli/src/lib/installers.ts`

- [ ] **Step 1: Create `cli/src/lib/installers.ts`**

Installs each dependency using apt or yum. Returns success/failure.

```ts
import { runShell } from './shell.js';

export type PackageManager = 'apt' | 'yum' | 'dnf';

export async function detectPackageManager(): Promise<PackageManager> {
  const apt = await runShell('command -v apt-get');
  if (apt.exitCode === 0) return 'apt';
  const dnf = await runShell('command -v dnf');
  if (dnf.exitCode === 0) return 'dnf';
  const yum = await runShell('command -v yum');
  if (yum.exitCode === 0) return 'yum';
  throw new Error('Unsupported OS: no apt, yum, or dnf found');
}

export interface InstallResult {
  success: boolean;
  error?: string;
}

type Installer = (pm: PackageManager) => Promise<InstallResult>;

async function tryInstall(cmd: string): Promise<InstallResult> {
  const result = await runShell(cmd);
  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || result.stdout };
  }
  return { success: true };
}

const installPostgres: Installer = async (pm) => {
  if (pm === 'apt') {
    await runShell('sudo apt-get update -qq');
    await runShell('sudo apt-get install -y -qq gnupg2 lsb-release');
    await runShell('echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null');
    await runShell('curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg --yes');
    await runShell('sudo apt-get update -qq');
    const result = await tryInstall('sudo apt-get install -y -qq postgresql-16 postgresql-client-16 postgresql-16-pgvector');
    if (!result.success) return result;
    await runShell('sudo systemctl enable postgresql && sudo systemctl start postgresql');
    return { success: true };
  }
  // yum/dnf
  await runShell('sudo yum install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E %{rhel})-x86_64/pgdg-redhat-repo-latest.noarch.rpm');
  const result = await tryInstall(`sudo ${pm} install -y postgresql16-server postgresql16`);
  if (!result.success) return result;
  await runShell('sudo /usr/pgsql-16/bin/postgresql-16-setup initdb');
  await runShell('sudo systemctl enable postgresql-16 && sudo systemctl start postgresql-16');
  return { success: true };
};

const installRedis: Installer = async (pm) => {
  if (pm === 'apt') {
    const result = await tryInstall('sudo apt-get install -y -qq redis-server');
    if (!result.success) return result;
  } else {
    const result = await tryInstall(`sudo ${pm} install -y redis`);
    if (!result.success) return result;
  }
  await runShell('sudo systemctl enable redis-server && sudo systemctl start redis-server');
  return { success: true };
};

const installNginx: Installer = async (pm) => {
  if (pm === 'apt') {
    const result = await tryInstall('sudo apt-get install -y -qq nginx');
    if (!result.success) return result;
  } else {
    const result = await tryInstall(`sudo ${pm} install -y nginx`);
    if (!result.success) return result;
  }
  await runShell('sudo systemctl enable nginx && sudo systemctl start nginx');
  return { success: true };
};

const installMinio: Installer = async (pm) => {
  if (pm === 'apt') {
    const result = await tryInstall('wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio && sudo mv /tmp/minio /usr/local/bin/minio && sudo chmod +x /usr/local/bin/minio');
    if (!result.success) return result;
  } else {
    const result = await tryInstall('wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio && sudo mv /tmp/minio /usr/local/bin/minio && sudo chmod +x /usr/local/bin/minio');
    if (!result.success) return result;
  }
  return { success: true };
};

const installPm2: Installer = async () => {
  return tryInstall('sudo npm install -g pm2');
};

export const installers: Record<string, Installer> = {
  'PostgreSQL 16': installPostgres,
  'Redis 7': installRedis,
  'Nginx': installNginx,
  'MinIO': installMinio,
  'PM2': installPm2,
};
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/lib/installers.ts
git commit -m "feat(cli): add dependency installers for apt/yum/dnf"
```

---

### Task 6: Config Generation Library

**Files:**
- Create: `cli/src/lib/config.ts`

- [ ] **Step 1: Create `cli/src/lib/config.ts`**

Generates `.env`, Nginx config, PM2 ecosystem file, and MinIO systemd unit.

```ts
import { writeFileSync, mkdirSync } from 'fs';
import { Credentials } from './credentials.js';

const PROJECT_DIR = '/opt/shipdock';

export function generateEnvFile(creds: Credentials): void {
  const dbUrl = `postgresql://shipdock:${creds.dbPassword}@localhost:5432/shipdock`;
  const redisUrl = creds.redisPassword
    ? `redis://:${creds.redisPassword}@localhost:6379`
    : 'redis://localhost:6379';

  const lines = [
    `DATABASE_URL="${dbUrl}"`,
    `REDIS_HOST=localhost`,
    `REDIS_PORT=6379`,
    creds.redisPassword ? `REDIS_PASSWORD=${creds.redisPassword}` : '',
    `JWT_SECRET=${creds.jwtSecret}`,
    `JWT_REFRESH_SECRET=${creds.jwtRefreshSecret}`,
    `ENCRYPTION_KEY=${creds.encryptionKey}`,
    `PORT=${creds.port}`,
    `PROJECTS_DIR=/var/www`,
    `NODE_ENV=production`,
    '',
    `MINIO_ENDPOINT=localhost`,
    `MINIO_PORT=9000`,
    `MINIO_ACCESS_KEY=${creds.minioAccessKey}`,
    `MINIO_SECRET_KEY=${creds.minioSecretKey}`,
    `MINIO_USE_SSL=false`,
    '',
    `FRONTEND_URL=http${creds.ssl ? 's' : ''}://${creds.domain}`,
  ].filter(Boolean);

  writeFileSync(`${PROJECT_DIR}/backend/.env`, lines.join('\n') + '\n');
}

export function generateNginxConfig(creds: Credentials): string {
  const config = `upstream ship_dock_api {
    server 127.0.0.1:${creds.port};
}

server {
    listen 80;
    server_name ${creds.domain};
${creds.ssl ? '    return 301 https://$host$request_uri;\n' : `
    client_max_body_size 20M;

    location / {
        proxy_pass http://ship_dock_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /uploads/ {
        alias ${PROJECT_DIR}/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
`}}
${creds.ssl ? `}

server {
    listen 443 ssl http2;
    server_name ${creds.domain};

    ssl_certificate /etc/letsencrypt/live/${creds.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${creds.domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 20M;

    location / {
        proxy_pass http://ship_dock_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /uploads/ {
        alias ${PROJECT_DIR}/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}` : '}'}`;

  return config;
}

export function generatePm2Ecosystem(): string {
  return JSON.stringify({
    apps: [{
      name: 'ship-dock-api',
      script: 'dist/main.js',
      cwd: `${PROJECT_DIR}/backend`,
      instances: 1,
      env: { NODE_ENV: 'production' },
    }],
  }, null, 2);
}

export function generateMinioSystemd(creds: Credentials): string {
  return `[Unit]
Description=MinIO
After=network.target

[Service]
Type=simple
User=minio-user
Group=minio-user
Environment="MINIO_ROOT_USER=${creds.minioAccessKey}"
Environment="MINIO_ROOT_PASSWORD=${creds.minioSecretKey}"
ExecStart=/usr/local/bin/minio server /data/minio --console-address ":9001"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;
}

export function writeAllConfigs(creds: Credentials): void {
  // .env
  generateEnvFile(creds);

  // Nginx
  mkdirSync(`${PROJECT_DIR}/nginx`, { recursive: true });
  writeFileSync(`${PROJECT_DIR}/nginx/ship-dock.conf`, generateNginxConfig(creds));

  // PM2 ecosystem
  writeFileSync(`${PROJECT_DIR}/backend/ecosystem.config.json`, generatePm2Ecosystem());
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/lib/config.ts
git commit -m "feat(cli): add config file generation (env, nginx, pm2, minio)"
```

---

### Task 7: UI Components — Header

**Files:**
- Create: `cli/src/components/header.tsx`

- [ ] **Step 1: Create `cli/src/components/header.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';

export function Header() {
  return (
    <Box marginBottom={1}>
      <Text bold>▲ Ship Dock</Text>
      <Text color="gray">  v1.0.0</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/components/header.tsx
git commit -m "feat(cli): add Header component"
```

---

### Task 8: UI Components — TextPrompt and PasswordPrompt

**Files:**
- Create: `cli/src/components/text-prompt.tsx`
- Create: `cli/src/components/password-prompt.tsx`

- [ ] **Step 1: Create `cli/src/components/text-prompt.tsx`**

A single text input prompt with the ◆ marker and vertical line. Calls `onSubmit` when the user presses Enter.

```tsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}

export function TextPrompt({ label, placeholder, defaultValue, onSubmit }: Props) {
  const [value, setValue] = useState(defaultValue ?? '');

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="white">◆</Text>
        <Text> {label}</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={() => onSubmit(value)}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Create `cli/src/components/password-prompt.tsx`**

Same as TextPrompt but masks input with `•` characters.

```tsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  label: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}

export function PasswordPrompt({ label, placeholder, onSubmit }: Props) {
  const [value, setValue] = useState('');

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="white">◆</Text>
        <Text> {label}</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={() => onSubmit(value)}
          mask="•"
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add cli/src/components/text-prompt.tsx cli/src/components/password-prompt.tsx
git commit -m "feat(cli): add TextPrompt and PasswordPrompt components"
```

---

### Task 9: UI Components — SelectPrompt

**Files:**
- Create: `cli/src/components/select-prompt.tsx`

- [ ] **Step 1: Create `cli/src/components/select-prompt.tsx`**

Yes/No selector with ◆ marker.

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

interface Props {
  label: string;
  items: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
}

export function SelectPrompt({ label, items, onSelect }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="white">◆</Text>
        <Text> {label}</Text>
      </Box>
      <Box marginLeft={2}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value)}
        />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/components/select-prompt.tsx
git commit -m "feat(cli): add SelectPrompt component"
```

---

### Task 10: UI Components — CompletedField and TaskLine

**Files:**
- Create: `cli/src/components/completed-field.tsx`
- Create: `cli/src/components/task-line.tsx`

- [ ] **Step 1: Create `cli/src/components/completed-field.tsx`**

Shows a completed prompt field (read-only, with ✓).

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  label: string;
  value: string;
  masked?: boolean;
}

export function CompletedField({ label, value, masked }: Props) {
  return (
    <Box>
      <Text color="green">✓</Text>
      <Text> {label} </Text>
      <Text color="gray">{masked ? '•'.repeat(value.length) : value}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Create `cli/src/components/task-line.tsx`**

Shows installation task status: pending, running (spinner), done, or failed.

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

interface Props {
  label: string;
  status: TaskStatus;
  detail?: string;
}

export function TaskLine({ label, status, detail }: Props) {
  return (
    <Box>
      {status === 'pending' && <Text color="gray">  ◻ </Text>}
      {status === 'running' && (
        <Box>
          <Text color="cyan">  </Text>
          <Spinner type="dots" />
          <Text> </Text>
        </Box>
      )}
      {status === 'done' && <Text color="green">  ✓ </Text>}
      {status === 'failed' && <Text color="red">  ✗ </Text>}
      <Text>{label}</Text>
      {detail && <Text color="gray"> {detail}</Text>}
    </Box>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add cli/src/components/completed-field.tsx cli/src/components/task-line.tsx
git commit -m "feat(cli): add CompletedField and TaskLine components"
```

---

### Task 11: Phase 1 — Information Collection

**Files:**
- Create: `cli/src/phases/collect.tsx`

- [ ] **Step 1: Create `cli/src/phases/collect.tsx`**

Sequential prompts. Each field moves to the next on submit. Auto-generates secrets when left empty.

```tsx
import React, { useState } from 'react';
import { Box } from 'ink';
import { TextPrompt } from '../components/text-prompt.js';
import { PasswordPrompt } from '../components/password-prompt.js';
import { SelectPrompt } from '../components/select-prompt.js';
import { CompletedField } from '../components/completed-field.js';
import { generateSecret, Credentials } from '../lib/credentials.js';

interface Props {
  onComplete: (config: Credentials) => void;
}

interface FieldDef {
  key: keyof Credentials;
  label: string;
  type: 'text' | 'password' | 'select';
  placeholder?: string;
  defaultValue?: string;
  items?: Array<{ label: string; value: string }>;
  autoGenerate?: boolean;
  masked?: boolean;
}

const fields: FieldDef[] = [
  { key: 'adminEmail', label: 'Admin email', type: 'text', placeholder: 'admin@example.com' },
  { key: 'adminPassword', label: 'Admin password', type: 'password' },
  { key: 'domain', label: 'Domain', type: 'text', placeholder: 'deploy.example.com' },
  { key: 'port', label: 'API port', type: 'text', defaultValue: '4000', placeholder: '4000' },
  { key: 'ssl', label: 'Enable SSL via Let\'s Encrypt?', type: 'select', items: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
  { key: 'dbPassword', label: 'PostgreSQL password', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
  { key: 'redisPassword', label: 'Redis password', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
  { key: 'minioAccessKey', label: 'MinIO access key', type: 'text', placeholder: 'leave empty to auto-generate', autoGenerate: true },
  { key: 'minioSecretKey', label: 'MinIO secret key', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
  { key: 'jwtSecret', label: 'JWT secret', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
];

export function CollectPhase({ onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSubmit = (key: string, value: string, autoGenerate?: boolean) => {
    const finalValue = (value === '' && autoGenerate) ? generateSecret() : value;
    const newValues = { ...values, [key]: finalValue };
    setValues(newValues);

    if (currentIndex + 1 >= fields.length) {
      // Generate jwtRefreshSecret and encryptionKey automatically
      const creds: Credentials = {
        adminEmail: newValues.adminEmail,
        adminPassword: newValues.adminPassword,
        domain: newValues.domain,
        port: newValues.port || '4000',
        ssl: newValues.ssl === 'true',
        dbPassword: newValues.dbPassword,
        redisPassword: newValues.redisPassword,
        minioAccessKey: newValues.minioAccessKey,
        minioSecretKey: newValues.minioSecretKey,
        jwtSecret: newValues.jwtSecret,
        jwtRefreshSecret: generateSecret(),
        encryptionKey: generateSecret(64),
      };
      onComplete(creds);
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  };

  return (
    <Box flexDirection="column">
      {fields.map((field, i) => {
        if (i < currentIndex) {
          const displayValue = values[field.key] ?? '';
          if (field.key === 'ssl') {
            return <CompletedField key={field.key} label={field.label} value={displayValue === 'true' ? 'Yes' : 'No'} />;
          }
          return <CompletedField key={field.key} label={field.label} value={displayValue} masked={field.masked} />;
        }
        if (i === currentIndex) {
          if (field.type === 'select') {
            return <SelectPrompt key={field.key} label={field.label} items={field.items!} onSelect={(v) => handleSubmit(field.key, v)} />;
          }
          if (field.type === 'password') {
            return <PasswordPrompt key={field.key} label={field.label} placeholder={field.placeholder} onSubmit={(v) => handleSubmit(field.key, v, field.autoGenerate)} />;
          }
          return <TextPrompt key={field.key} label={field.label} placeholder={field.placeholder} defaultValue={field.defaultValue} onSubmit={(v) => handleSubmit(field.key, v, field.autoGenerate)} />;
        }
        return null;
      })}
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/phases/collect.tsx
git commit -m "feat(cli): add Phase 1 — information collection with sequential prompts"
```

---

### Task 12: Phase 2 — Dependency Detection + Installation

**Files:**
- Create: `cli/src/phases/install.tsx`

- [ ] **Step 1: Create `cli/src/phases/install.tsx`**

Detects dependencies, shows confirmation checklist, then installs missing ones.

```tsx
import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { TaskLine, TaskStatus } from '../components/task-line.js';
import { detectAll, Dependency } from '../lib/detect.js';
import { installers, detectPackageManager, PackageManager } from '../lib/installers.js';
import Spinner from 'ink-spinner';

interface Props {
  onComplete: () => void;
}

type Stage = 'detecting' | 'confirming' | 'installing' | 'done';

interface InstallTask {
  name: string;
  status: TaskStatus;
  detail?: string;
}

export function InstallPhase({ onComplete }: Props) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>('detecting');
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [tasks, setTasks] = useState<InstallTask[]>([]);
  const [pm, setPm] = useState<PackageManager>('apt');

  // Detect dependencies
  useEffect(() => {
    (async () => {
      try {
        const detectedPm = await detectPackageManager();
        setPm(detectedPm);
        const detected = await detectAll();
        setDeps(detected);
        setStage('confirming');
      } catch (err: any) {
        setDeps([]);
        setStage('confirming');
      }
    })();
  }, []);

  // Install missing dependencies sequentially
  const runInstall = async () => {
    const missing = deps.filter((d) => !d.installed);
    const taskList: InstallTask[] = missing.map((d) => ({
      name: d.name,
      status: 'pending' as TaskStatus,
    }));
    setTasks(taskList);
    setStage('installing');

    for (let i = 0; i < missing.length; i++) {
      setTasks((prev) =>
        prev.map((t, j) => (j === i ? { ...t, status: 'running' } : t))
      );

      const installer = installers[missing[i].name];
      if (installer) {
        const result = await installer(pm);
        setTasks((prev) =>
          prev.map((t, j) =>
            j === i
              ? {
                  ...t,
                  status: result.success ? 'done' : 'failed',
                  detail: result.success ? undefined : result.error?.slice(0, 80),
                }
              : t
          )
        );
        // Stop on critical failures (PostgreSQL, Redis)
        if (!result.success && (missing[i].name.includes('PostgreSQL') || missing[i].name.includes('Redis'))) {
          return; // Don't call onComplete — stay in failed state
        }
      }
    }

    setStage('done');
    onComplete();
  };

  if (stage === 'detecting') {
    return (
      <Box>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text> Detecting installed dependencies...</Text>
      </Box>
    );
  }

  if (stage === 'confirming') {
    const missing = deps.filter((d) => !d.installed);
    const installed = deps.filter((d) => d.installed);

    return (
      <Box flexDirection="column">
        <Text bold>Dependencies:</Text>
        {installed.map((d) => (
          <Box key={d.name}>
            <Text color="green">  ✓ </Text>
            <Text>{d.name}</Text>
            <Text color="gray"> ({d.version ?? 'installed'})</Text>
          </Box>
        ))}
        {missing.map((d) => (
          <Box key={d.name}>
            <Text color="yellow">  ◆ </Text>
            <Text>{d.name}</Text>
            <Text color="gray"> (will install)</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          {missing.length === 0 ? (
            <Box flexDirection="column">
              <Text color="green">All dependencies installed!</Text>
              <SelectInput
                items={[{ label: 'Continue', value: 'continue' }]}
                onSelect={() => { setStage('done'); onComplete(); }}
              />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text>Install {missing.length} missing {missing.length === 1 ? 'dependency' : 'dependencies'}?</Text>
              <SelectInput
                items={[
                  { label: 'Yes, install', value: 'yes' },
                  { label: 'Cancel', value: 'no' },
                ]}
                onSelect={(item) => {
                  if (item.value === 'yes') {
                    runInstall();
                  } else {
                    exit();
                  }
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // installing or done
  return (
    <Box flexDirection="column">
      <Text bold>Installing dependencies:</Text>
      {tasks.map((t) => (
        <TaskLine key={t.name} label={t.name} status={t.status} detail={t.detail} />
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/phases/install.tsx
git commit -m "feat(cli): add Phase 2 — dependency detection and installation"
```

---

### Task 13: Phase 3 — Service Initialization

**Files:**
- Create: `cli/src/phases/initialize.tsx`

- [ ] **Step 1: Create `cli/src/phases/initialize.tsx`**

Runs the initialization sequence: config generation, database setup, admin creation, Nginx config, SSL, MinIO, PM2 start.

```tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { TaskLine, TaskStatus } from '../components/task-line.js';
import { Credentials, saveCredentials } from '../lib/credentials.js';
import { writeAllConfigs, generateMinioSystemd } from '../lib/config.js';
import { runShell } from '../lib/shell.js';
import { homedir } from 'os';
import { writeFileSync } from 'fs';

const PROJECT_DIR = '/opt/shipdock';

interface Props {
  config: Credentials;
  onComplete: () => void;
}

interface InitTask {
  name: string;
  status: TaskStatus;
  detail?: string;
  run: () => Promise<void>;
}

export function InitializePhase({ config, onComplete }: Props) {
  const [tasks, setTasks] = useState<InitTask[]>([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const taskDefs: InitTask[] = [
      {
        name: 'Generate configuration files',
        status: 'pending',
        run: async () => {
          writeAllConfigs(config);
        },
      },
      {
        name: 'Install backend dependencies',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npm ci`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      {
        name: 'Generate Prisma client',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npx prisma generate`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      {
        name: 'Set up PostgreSQL database',
        status: 'pending',
        run: async () => {
          // Create user and database
          await runShell(`sudo -u postgres psql -c "CREATE USER shipdock WITH PASSWORD '${config.dbPassword}';" 2>/dev/null || true`);
          await runShell(`sudo -u postgres psql -c "CREATE DATABASE shipdock OWNER shipdock;" 2>/dev/null || true`);
          await runShell(`sudo -u postgres psql -d shipdock -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true`);
        },
      },
      {
        name: 'Run database migrations',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npx prisma db push --accept-data-loss`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      {
        name: 'Configure Redis password',
        status: 'pending',
        run: async () => {
          if (config.redisPassword) {
            await runShell(`sudo sed -i 's/^# requirepass .*/requirepass ${config.redisPassword}/' /etc/redis/redis.conf`);
            await runShell(`sudo sed -i 's/^requirepass .*/requirepass ${config.redisPassword}/' /etc/redis/redis.conf`);
            await runShell('sudo systemctl restart redis-server');
          }
        },
      },
      {
        name: 'Build backend',
        status: 'pending',
        run: async () => {
          const result = await runShell(`cd ${PROJECT_DIR}/backend && npm run build`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
        },
      },
      {
        name: 'Configure Nginx',
        status: 'pending',
        run: async () => {
          await runShell(`sudo cp ${PROJECT_DIR}/nginx/ship-dock.conf /etc/nginx/sites-available/ship-dock.conf`);
          await runShell('sudo ln -sf /etc/nginx/sites-available/ship-dock.conf /etc/nginx/sites-enabled/ship-dock.conf');
          await runShell('sudo rm -f /etc/nginx/sites-enabled/default');
          const test = await runShell('sudo nginx -t');
          if (test.exitCode !== 0) throw new Error('Nginx config test failed');
          await runShell('sudo systemctl reload nginx');
        },
      },
      {
        name: 'Set up MinIO',
        status: 'pending',
        run: async () => {
          // Create minio user if not exists
          await runShell('id -u minio-user &>/dev/null || sudo useradd -r -s /sbin/nologin minio-user');
          await runShell('sudo mkdir -p /data/minio && sudo chown minio-user:minio-user /data/minio');
          // Write systemd unit
          const unit = generateMinioSystemd(config);
          writeFileSync('/tmp/minio.service', unit);
          await runShell('sudo mv /tmp/minio.service /etc/systemd/system/minio.service');
          await runShell('sudo systemctl daemon-reload && sudo systemctl enable minio && sudo systemctl start minio');
        },
      },
      ...(config.ssl ? [{
        name: 'Set up SSL certificate',
        status: 'pending' as TaskStatus,
        run: async () => {
          await runShell('sudo apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null || sudo yum install -y certbot python3-certbot-nginx 2>/dev/null');
          const result = await runShell(`sudo certbot certonly --nginx --non-interactive --agree-tos --register-unsafely-without-email -d ${config.domain}`);
          if (result.exitCode !== 0) throw new Error(result.stderr);
          // Reload nginx with SSL config
          await runShell('sudo systemctl reload nginx');
        },
      }] : []),
      {
        name: 'Start services via PM2',
        status: 'pending',
        run: async () => {
          const check = await runShell('pm2 describe ship-dock-api 2>/dev/null');
          if (check.exitCode === 0) {
            await runShell(`cd ${PROJECT_DIR}/backend && pm2 reload ship-dock-api`);
          } else {
            await runShell(`cd ${PROJECT_DIR}/backend && pm2 start dist/main.js --name ship-dock-api -i 1 --env production`);
          }
          await runShell('pm2 save');
          await runShell(`sudo env PATH="$PATH" pm2 startup systemd -u $(whoami) --hp $HOME 2>/dev/null || true`);
        },
      },
      {
        name: 'Create admin account',
        status: 'pending',
        run: async () => {
          // Wait for API to be ready
          let ready = false;
          for (let i = 0; i < 15; i++) {
            const health = await runShell(`curl -sf http://localhost:${config.port}/api/health`);
            if (health.exitCode === 0) { ready = true; break; }
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (!ready) throw new Error('API failed to start — check pm2 logs ship-dock-api');

          const result = await runShell(`curl -sf -X POST http://localhost:${config.port}/api/auth/setup -H "Content-Type: application/json" -d '${JSON.stringify({ email: config.adminEmail, password: config.adminPassword, name: 'Admin' })}'`);
          if (result.exitCode !== 0) throw new Error('Failed to create admin account');
        },
      },
      {
        name: 'Save credentials file',
        status: 'pending',
        run: async () => {
          saveCredentials(config, `${homedir()}/.shipdock/credentials`);
        },
      },
    ];
    setTasks(taskDefs);
  }, []);

  // Run tasks sequentially
  useEffect(() => {
    if (tasks.length === 0 || started) return;
    setStarted(true);

    (async () => {
      for (let i = 0; i < tasks.length; i++) {
        setTasks((prev) =>
          prev.map((t, j) => (j === i ? { ...t, status: 'running' } : t))
        );

        try {
          await tasks[i].run();
          setTasks((prev) =>
            prev.map((t, j) => (j === i ? { ...t, status: 'done' } : t))
          );
        } catch (err: any) {
          setTasks((prev) =>
            prev.map((t, j) =>
              j === i ? { ...t, status: 'failed', detail: err.message?.slice(0, 100) } : t
            )
          );
          // Log error but continue for non-critical tasks
          const critical = ['PostgreSQL', 'migrations', 'backend dependencies', 'Build backend'];
          if (critical.some((c) => tasks[i].name.toLowerCase().includes(c.toLowerCase()))) {
            return; // Stop on critical failure
          }
        }
      }
      onComplete();
    })();
  }, [tasks]);

  return (
    <Box flexDirection="column">
      <Text bold>Initializing services:</Text>
      {tasks.map((t) => (
        <TaskLine key={t.name} label={t.name} status={t.status} detail={t.detail} />
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/phases/initialize.tsx
git commit -m "feat(cli): add Phase 3 — service initialization"
```

---

### Task 14: Completion Report Component

**Files:**
- Create: `cli/src/components/report.tsx`

- [ ] **Step 1: Create `cli/src/components/report.tsx`**

Displays the final success report with all info.

```tsx
import React from 'react';
import { Box, Text, Newline } from 'ink';
import { Credentials } from '../lib/credentials.js';
import { homedir } from 'os';

interface Props {
  config: Credentials;
}

export function Report({ config }: Props) {
  const proto = config.ssl ? 'https' : 'http';
  const url = `${proto}://${config.domain}`;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">─────────────────────────────────────────</Text>
      <Newline />
      <Text bold color="green">  ✓ Ship Dock is running!</Text>
      <Newline />
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Platform</Text>
        <Text>  URL:              {url}</Text>
        <Text>  API:              http://localhost:{config.port}</Text>
        <Newline />
        <Text bold>Admin</Text>
        <Text>  Email:            {config.adminEmail}</Text>
        <Text>  Password:         {config.adminPassword}</Text>
        <Newline />
        <Text bold>PostgreSQL</Text>
        <Text>  Database:         shipdock</Text>
        <Text>  User:             shipdock</Text>
        <Text>  Password:         {config.dbPassword}</Text>
        <Newline />
        <Text bold>Redis</Text>
        <Text>  Password:         {config.redisPassword || '(none)'}</Text>
        <Newline />
        <Text bold>MinIO</Text>
        <Text>  Console:          http://localhost:9001</Text>
        <Text>  Access Key:       {config.minioAccessKey}</Text>
        <Text>  Secret Key:       {config.minioSecretKey}</Text>
        <Newline />
        <Text bold>Files</Text>
        <Text>  Config:           /opt/shipdock/backend/.env</Text>
        <Text>  Credentials:      {homedir()}/.shipdock/credentials</Text>
        <Text>  Logs:             pm2 logs ship-dock-api</Text>
      </Box>
      <Newline />
      <Text color="gray">─────────────────────────────────────────</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/components/report.tsx
git commit -m "feat(cli): add completion report component"
```

---

### Task 15: Wire Up App Component

**Files:**
- Modify: `cli/src/app.tsx`

- [ ] **Step 1: Replace `cli/src/app.tsx` with full implementation**

Connects all phases and the report.

```tsx
import React, { useReducer } from 'react';
import { Box, useApp } from 'ink';
import { Header } from './components/header.js';
import { Report } from './components/report.js';
import { CollectPhase } from './phases/collect.js';
import { InstallPhase } from './phases/install.js';
import { InitializePhase } from './phases/initialize.js';
import { Credentials } from './lib/credentials.js';

type Phase = 'collecting' | 'confirming' | 'installing' | 'initializing' | 'done';

interface State {
  phase: Phase;
  config: Credentials | null;
}

type Action =
  | { type: 'SET_CONFIG'; config: Credentials }
  | { type: 'INSTALL_DONE' }
  | { type: 'INIT_DONE' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: action.config, phase: 'installing' };
    case 'INSTALL_DONE':
      return { ...state, phase: 'initializing' };
    case 'INIT_DONE':
      return { ...state, phase: 'done' };
    default:
      return state;
  }
}

export function App() {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, {
    phase: 'collecting',
    config: null,
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {state.phase === 'collecting' && (
        <CollectPhase
          onComplete={(config) => dispatch({ type: 'SET_CONFIG', config })}
        />
      )}

      {state.phase === 'installing' && (
        <InstallPhase
          onComplete={() => dispatch({ type: 'INSTALL_DONE' })}
        />
      )}

      {state.phase === 'initializing' && state.config && (
        <InitializePhase
          config={state.config}
          onComplete={() => dispatch({ type: 'INIT_DONE' })}
        />
      )}

      {state.phase === 'done' && state.config && (
        <Report config={state.config} />
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Verify the full flow compiles**

Run: `cd /opt/shipdock/cli && npx tsx --no-warnings src/index.tsx init`
Expected: Shows header, starts the collection prompts

- [ ] **Step 3: Commit**

```bash
git add cli/src/app.tsx
git commit -m "feat(cli): wire up all phases in App component"
```

---

### Task 16: Bootstrap Script

**Files:**
- Create: `scripts/install.sh`

- [ ] **Step 1: Create `scripts/install.sh`**

The shell script that `curl | sh` downloads. Installs Node.js and Git, clones repo, launches CLI.

```bash
#!/bin/bash
# Ship Dock Installer
# Usage: curl -fsSL https://beta.shipdock.web3noah.com/install | sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/<owner>/ship-dock.git"
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

# ── Install Node.js 20 ──
if command -v node &>/dev/null && node -v | grep -q "^v2[0-9]"; then
  echo -e "${GREEN}✓${NC} Node.js $(node -v) already installed"
else
  echo -e "  Installing Node.js 20..."
  if [[ "$PM" == "apt" ]]; then
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    $PM install -y nodejs
  fi
  echo -e "${GREEN}✓${NC} Node.js $(node -v) installed"
fi

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

# ── Launch interactive setup ──
echo ""
exec npx tsx src/index.tsx init
```

- [ ] **Step 2: Commit**

```bash
git add scripts/install.sh
git commit -m "feat(cli): add bootstrap install script for curl | sh"
```

---

### Task 17: End-to-End Manual Test

**Files:** None (testing only)

- [ ] **Step 1: Verify project structure is complete**

Run: `find /opt/shipdock/cli -type f -name '*.ts' -o -name '*.tsx' -o -name '*.json' | sort`

Expected output:
```
/opt/shipdock/cli/package.json
/opt/shipdock/cli/src/app.tsx
/opt/shipdock/cli/src/components/completed-field.tsx
/opt/shipdock/cli/src/components/header.tsx
/opt/shipdock/cli/src/components/password-prompt.tsx
/opt/shipdock/cli/src/components/report.tsx
/opt/shipdock/cli/src/components/select-prompt.tsx
/opt/shipdock/cli/src/components/task-line.tsx
/opt/shipdock/cli/src/components/text-prompt.tsx
/opt/shipdock/cli/src/index.tsx
/opt/shipdock/cli/src/lib/config.ts
/opt/shipdock/cli/src/lib/credentials.ts
/opt/shipdock/cli/src/lib/detect.ts
/opt/shipdock/cli/src/lib/installers.ts
/opt/shipdock/cli/src/lib/shell.ts
/opt/shipdock/cli/src/phases/collect.tsx
/opt/shipdock/cli/src/phases/initialize.tsx
/opt/shipdock/cli/src/phases/install.tsx
/opt/shipdock/cli/tsconfig.json
```

- [ ] **Step 2: Run `npm install` in cli directory**

Run: `cd /opt/shipdock/cli && npm install`
Expected: Installs without errors

- [ ] **Step 3: Run TypeScript type check**

Run: `cd /opt/shipdock/cli && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Launch the CLI and verify Phase 1 renders**

Run: `cd /opt/shipdock/cli && npx tsx src/index.tsx init`
Expected: Shows "▲ Ship Dock  v1.0.0" header and the first prompt "◆ Admin email"

- [ ] **Step 5: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix(cli): fixes from end-to-end testing"
```
