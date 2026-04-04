import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface FileTableInfo {
  tableName: string;
  schemaName: string;
}

export class FileMigrator {
  static detectFormat(fileName: string): 'plain' | 'custom' {
    return fileName.endsWith('.dump') ? 'custom' : 'plain';
  }

  static parseTablesFromSql(sql: string): FileTableInfo[] {
    const tables: FileTableInfo[] = [];
    const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql)) !== null) {
      tables.push({
        schemaName: match[1] || 'public',
        tableName: match[2],
      });
    }
    return tables;
  }

  static async parseTablesFromDump(filePath: string): Promise<FileTableInfo[]> {
    const { stdout } = await execFileAsync('pg_restore', ['--list', filePath]);
    const tables: FileTableInfo[] = [];
    const regex = /^\d+;\s+\d+\s+\d+\s+TABLE\s+(\S+)\s+(\S+)/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(stdout)) !== null) {
      tables.push({ schemaName: match[1], tableName: match[2] });
    }
    return tables;
  }

  static async restoreFromDump(
    filePath: string,
    databaseUrl: string,
    tables: FileTableInfo[],
    conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP',
    onLog: (line: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const url = new URL(databaseUrl);
    const args = [
      '-h', url.hostname,
      '-p', url.port || '5432',
      '-U', url.username,
      '-d', url.pathname.slice(1),
      '--no-owner',
      '--no-acl',
      '--verbose',
    ];

    if (conflictStrategy === 'OVERWRITE') {
      args.push('--clean', '--if-exists');
    }

    for (const t of tables) {
      args.push('-t', `${t.schemaName}.${t.tableName}`);
    }

    args.push(filePath);

    const env = { ...process.env, PGPASSWORD: url.password };

    try {
      const { stderr } = await execFileAsync('pg_restore', args, {
        env,
        maxBuffer: 50 * 1024 * 1024,
      });
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      return { success: true };
    } catch (err: any) {
      if (err.stderr) {
        for (const line of err.stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      if (err.code === 1 && conflictStrategy === 'SKIP') {
        return { success: true };
      }
      return { success: false, error: err.message };
    }
  }

  static async restoreFromSql(
    filePath: string,
    databaseUrl: string,
    tables: FileTableInfo[],
    conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP',
    onLog: (line: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const url = new URL(databaseUrl);
    const env = { ...process.env, PGPASSWORD: url.password };

    if (conflictStrategy === 'OVERWRITE') {
      const dropArgs = [
        '-h', url.hostname,
        '-p', url.port || '5432',
        '-U', url.username,
        '-d', url.pathname.slice(1),
        '-c', tables.map((t) => `DROP TABLE IF EXISTS "${t.schemaName}"."${t.tableName}" CASCADE`).join('; ') + ';',
      ];
      try {
        await execFileAsync('psql', dropArgs, { env });
        onLog('Dropped existing tables for overwrite');
      } catch (err: any) {
        onLog(`Warning: ${err.message}`);
      }
    }

    const args = [
      '-h', url.hostname,
      '-p', url.port || '5432',
      '-U', url.username,
      '-d', url.pathname.slice(1),
      '-f', filePath,
      '-v', 'ON_ERROR_STOP=' + (conflictStrategy === 'ERROR' ? '1' : '0'),
    ];

    try {
      const { stderr } = await execFileAsync('psql', args, {
        env,
        maxBuffer: 50 * 1024 * 1024,
      });
      if (stderr) {
        for (const line of stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      return { success: true };
    } catch (err: any) {
      if (err.stderr) {
        for (const line of err.stderr.split('\n').filter(Boolean)) {
          onLog(line);
        }
      }
      return { success: false, error: err.message };
    }
  }
}
