import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Execute a shell command and return stdout. Returns null on error.
 */
export function exec(
  command: string,
  args: string[],
  options?: { timeout?: number },
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: options?.timeout ?? 15_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/**
 * Execute a shell command via /bin/sh -c. Returns null on error.
 */
export function execShell(
  command: string,
  options?: { timeout?: number },
): Promise<string | null> {
  return exec('/bin/sh', ['-c', command], options);
}

/**
 * Generate a stable ID from a directory path.
 */
export function directoryId(dir: string): string {
  return crypto.createHash('sha256').update(dir).digest('hex').slice(0, 12);
}

/**
 * Parse a .env file into a key-value map.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  } catch {
    // File doesn't exist or not readable
  }
  return vars;
}

/**
 * Extract database and redis URLs from env vars.
 */
export function extractConnectionUrls(env: Record<string, string>): {
  databaseUrl?: string;
  redisUrl?: string;
} {
  const dbKeys = ['DATABASE_URL', 'DB_URL', 'POSTGRES_URL', 'MYSQL_URL', 'MONGODB_URI', 'MONGO_URL'];
  const redisKeys = ['REDIS_URL', 'REDIS_URI'];
  let databaseUrl: string | undefined;
  let redisUrl: string | undefined;

  for (const key of dbKeys) {
    if (env[key]) {
      databaseUrl = env[key];
      break;
    }
  }
  for (const key of redisKeys) {
    if (env[key]) {
      redisUrl = env[key];
      break;
    }
  }
  return { databaseUrl, redisUrl };
}

/**
 * Try to get git info from a directory.
 */
export async function getGitInfo(
  dir: string,
): Promise<{ remote?: string; commit?: string; branch?: string }> {
  const [remote, commit, branch] = await Promise.all([
    execShell(`git -C "${dir}" remote get-url origin 2>/dev/null`),
    execShell(`git -C "${dir}" rev-parse HEAD 2>/dev/null`),
    execShell(`git -C "${dir}" rev-parse --abbrev-ref HEAD 2>/dev/null`),
  ]);
  return {
    remote: remote?.trim() || undefined,
    commit: commit?.trim() || undefined,
    branch: branch?.trim() || undefined,
  };
}

/**
 * Read env vars from .env file in a directory.
 */
export function readProjectEnv(dir: string): Record<string, string> {
  const envPath = path.join(dir, '.env');
  return parseEnvFile(envPath);
}

/**
 * Try to read package.json name from a directory.
 */
export function readPackageName(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    return pkg.name;
  } catch {
    return undefined;
  }
}
