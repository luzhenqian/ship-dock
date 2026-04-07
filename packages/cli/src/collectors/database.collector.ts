import * as path from 'path';
import { execShell } from '../utils';

export interface DatabaseDumpResult {
  success: boolean;
  filePath?: string;
  error?: string;
  type: 'postgresql' | 'mysql' | 'unknown';
  sizeBytes?: number;
}

/**
 * Dump a database based on its connection URL.
 * Output is a gzipped SQL file in the given output directory.
 */
export async function collectDatabase(
  databaseUrl: string,
  outputDir: string,
): Promise<DatabaseDumpResult> {
  const url = parseDatabaseUrl(databaseUrl);

  if (url.type === 'postgresql') {
    return dumpPostgres(url, outputDir);
  } else if (url.type === 'mysql') {
    return dumpMysql(url, outputDir);
  }

  return { success: false, error: `Unsupported database type: ${url.type}`, type: 'unknown' };
}

interface ParsedDbUrl {
  type: 'postgresql' | 'mysql' | 'unknown';
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function parseDatabaseUrl(url: string): ParsedDbUrl {
  let type: ParsedDbUrl['type'] = 'unknown';
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    type = 'postgresql';
  } else if (url.startsWith('mysql://')) {
    type = 'mysql';
  }

  try {
    const parsed = new URL(url);
    return {
      type,
      host: parsed.hostname,
      port: parsed.port || (type === 'postgresql' ? '5432' : '3306'),
      user: parsed.username,
      password: parsed.password,
      database: parsed.pathname.replace(/^\//, ''),
    };
  } catch {
    return { type, host: '', port: '', user: '', password: '', database: '' };
  }
}

async function dumpPostgres(
  db: ParsedDbUrl,
  outputDir: string,
): Promise<DatabaseDumpResult> {
  const outFile = path.join(outputDir, 'database.sql.gz');
  const env = `PGPASSWORD='${db.password}'`;
  const cmd = `${env} pg_dump -h '${db.host}' -p '${db.port}' -U '${db.user}' '${db.database}' | gzip > '${outFile}'`;

  const result = await execShell(cmd, { timeout: 300_000 }); // 5 min timeout

  if (result === null) {
    return { success: false, error: 'pg_dump failed or timed out', type: 'postgresql' };
  }

  const sizeResult = await execShell(`stat -c%s '${outFile}' 2>/dev/null || stat -f%z '${outFile}' 2>/dev/null`);
  const sizeBytes = sizeResult ? parseInt(sizeResult.trim(), 10) || undefined : undefined;

  return { success: true, filePath: outFile, type: 'postgresql', sizeBytes };
}

async function dumpMysql(
  db: ParsedDbUrl,
  outputDir: string,
): Promise<DatabaseDumpResult> {
  const outFile = path.join(outputDir, 'database.sql.gz');
  const cmd = `mysqldump -h '${db.host}' -P '${db.port}' -u '${db.user}' -p'${db.password}' '${db.database}' | gzip > '${outFile}'`;

  const result = await execShell(cmd, { timeout: 300_000 });

  if (result === null) {
    return { success: false, error: 'mysqldump failed or timed out', type: 'mysql' };
  }

  const sizeResult = await execShell(`stat -c%s '${outFile}' 2>/dev/null || stat -f%z '${outFile}' 2>/dev/null`);
  const sizeBytes = sizeResult ? parseInt(sizeResult.trim(), 10) || undefined : undefined;

  return { success: true, filePath: outFile, type: 'mysql', sizeBytes };
}
