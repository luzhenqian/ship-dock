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
    const seen = new Set<string>();
    const tables: FileTableInfo[] = [];

    const addTable = (schema: string, table: string) => {
      const key = `${schema}.${table}`;
      if (!seen.has(key)) {
        seen.add(key);
        tables.push({ schemaName: schema, tableName: table });
      }
    };

    // Match CREATE TABLE
    const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = createRegex.exec(sql)) !== null) {
      addTable(match[1] || 'public', match[2]);
    }

    // Match INSERT INTO (for data-only dumps)
    const insertRegex = /INSERT\s+INTO\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s/gi;
    while ((match = insertRegex.exec(sql)) !== null) {
      addTable(match[1] || 'public', match[2]);
    }

    // Match COPY ... FROM (for pg_dump plain format)
    const copyRegex = /COPY\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s.*FROM\s+stdin/gi;
    while ((match = copyRegex.exec(sql)) !== null) {
      addTable(match[1] || 'public', match[2]);
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
    conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP' | 'APPEND',
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
    conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP' | 'APPEND',
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
      '-v', 'ON_ERROR_STOP=' + (conflictStrategy === 'ERROR' ? '1' : '0'), // APPEND and SKIP both continue past errors
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
