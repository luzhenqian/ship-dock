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
