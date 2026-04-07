import * as path from 'path';
import { execShell } from '../utils';

export interface RedisCollectResult {
  success: boolean;
  filePath?: string;
  error?: string;
  sizeBytes?: number;
}

/**
 * Trigger a Redis BGSAVE, wait for it to complete, and copy the RDB file.
 */
export async function collectRedis(
  redisUrl: string,
  outputDir: string,
): Promise<RedisCollectResult> {
  const { host, port, password } = parseRedisUrl(redisUrl);

  const authArgs = password ? `-a '${password}' --no-auth-warning` : '';
  const cliPrefix = `redis-cli -h '${host}' -p '${port}' ${authArgs}`;

  // Trigger BGSAVE
  const bgsaveResult = await execShell(`${cliPrefix} BGSAVE`);
  if (bgsaveResult === null) {
    return { success: false, error: 'Failed to trigger BGSAVE (redis-cli not available or connection failed)' };
  }

  // Wait for BGSAVE to complete (poll LASTSAVE)
  const startSave = await execShell(`${cliPrefix} LASTSAVE`);
  const startTime = parseInt(startSave?.trim() || '0', 10);

  let attempts = 0;
  while (attempts < 30) {
    await sleep(1000);
    const currentSave = await execShell(`${cliPrefix} LASTSAVE`);
    const currentTime = parseInt(currentSave?.trim() || '0', 10);
    if (currentTime > startTime) break;
    attempts++;
  }

  if (attempts >= 30) {
    return { success: false, error: 'BGSAVE timed out after 30 seconds' };
  }

  // Find the RDB file path
  const dirResult = await execShell(`${cliPrefix} CONFIG GET dir`);
  const fileResult = await execShell(`${cliPrefix} CONFIG GET dbfilename`);

  const dirMatch = dirResult?.split('\n')[1]?.trim();
  const fileMatch = fileResult?.split('\n')[1]?.trim();

  if (!dirMatch || !fileMatch) {
    return { success: false, error: 'Could not determine RDB file location' };
  }

  const rdbPath = path.join(dirMatch, fileMatch);
  const outFile = path.join(outputDir, 'redis.rdb');

  const copyResult = await execShell(`cp '${rdbPath}' '${outFile}'`);
  if (copyResult === null) {
    return { success: false, error: `Failed to copy RDB file from ${rdbPath}` };
  }

  const sizeResult = await execShell(`stat -c%s '${outFile}' 2>/dev/null || stat -f%z '${outFile}' 2>/dev/null`);
  const sizeBytes = sizeResult ? parseInt(sizeResult.trim(), 10) || undefined : undefined;

  return { success: true, filePath: outFile, sizeBytes };
}

function parseRedisUrl(url: string): { host: string; port: string; password: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parsed.port || '6379',
      password: parsed.password || '',
    };
  } catch {
    return { host: '127.0.0.1', port: '6379', password: '' };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
