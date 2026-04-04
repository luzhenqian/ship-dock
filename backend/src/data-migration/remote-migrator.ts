import { Client } from 'pg';
import { pipeline } from 'stream/promises';
import { from as copyFrom } from 'pg-copy-streams';
import { to as copyTo } from 'pg-copy-streams';

export interface ConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface TableInfo {
  tableName: string;
  schemaName: string;
  estimatedRows: number;
  estimatedSize: number;
  estimatedSizeFormatted: string;
}

export class RemoteMigrator {
  static buildConnectionString(config: ConnectionConfig): string {
    const password = encodeURIComponent(config.password);
    return `postgresql://${config.username}:${password}@${config.host}:${config.port}/${config.database}`;
  }

  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  static async testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
    const client = new Client({ connectionString: this.buildConnectionString(config), connectionTimeoutMillis: 30000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      await client.end().catch(() => {});
    }
  }

  static async discoverTables(config: ConnectionConfig): Promise<TableInfo[]> {
    const client = new Client({ connectionString: this.buildConnectionString(config), connectionTimeoutMillis: 30000 });
    await client.connect();
    try {
      const result = await client.query(`
        SELECT
          schemaname AS "schemaName",
          relname AS "tableName",
          n_live_tup AS "estimatedRows",
          pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) AS "estimatedSize"
        FROM pg_stat_user_tables
        ORDER BY schemaname, relname
      `);
      return result.rows.map((row) => ({
        ...row,
        estimatedRows: Number(row.estimatedRows),
        estimatedSize: Number(row.estimatedSize),
        estimatedSizeFormatted: this.formatBytes(Number(row.estimatedSize)),
      }));
    } finally {
      await client.end().catch(() => {});
    }
  }

  static async getTableDDL(client: Client, schemaName: string, tableName: string): Promise<string> {
    const cols = await client.query(`
      SELECT column_name, data_type, character_maximum_length, column_default, is_nullable,
             udt_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `, [schemaName, tableName]);

    const colDefs = cols.rows.map((c) => {
      let type = c.udt_name;
      if (c.character_maximum_length) type += `(${c.character_maximum_length})`;
      else if (c.data_type === 'numeric' && c.numeric_precision) type += `(${c.numeric_precision},${c.numeric_scale || 0})`;
      let def = `"${c.column_name}" ${type}`;
      if (c.column_default) def += ` DEFAULT ${c.column_default}`;
      if (c.is_nullable === 'NO') def += ' NOT NULL';
      return def;
    });

    const pk = await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `, [schemaName, tableName]);

    let ddl = `CREATE TABLE IF NOT EXISTS "${schemaName}"."${tableName}" (\n  ${colDefs.join(',\n  ')}`;
    if (pk.rows.length > 0) {
      ddl += `,\n  PRIMARY KEY (${pk.rows.map((r) => `"${r.column_name}"`).join(', ')})`;
    }
    ddl += '\n);';

    const indexes = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = $1 AND tablename = $2
      AND indexname NOT IN (
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = $1 AND table_name = $2 AND constraint_type = 'PRIMARY KEY'
      )
    `, [schemaName, tableName]);

    for (const idx of indexes.rows) {
      ddl += `\n${idx.indexdef};`;
    }

    return ddl;
  }

  static async getTableForeignKeys(client: Client, schemaName: string, tableName: string): Promise<string[]> {
    const result = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS def, conname
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE contype = 'f' AND conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
    `, [schemaName, tableName]);
    return result.rows.map((r) => `ALTER TABLE "${schemaName}"."${tableName}" ADD CONSTRAINT "${r.conname}" ${r.def};`);
  }

  static async copyTableData(
    sourceClient: Client,
    targetClient: Client,
    schemaName: string,
    tableName: string,
    onProgress: (rows: number) => void,
  ): Promise<number> {
    const qualifiedName = `"${schemaName}"."${tableName}"`;
    const sourceStream = sourceClient.query(copyTo(`COPY ${qualifiedName} TO STDOUT`));
    const targetStream = targetClient.query(copyFrom(`COPY ${qualifiedName} FROM STDIN`));

    let rowCount = 0;
    sourceStream.on('data', (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 10) rowCount++;
      }
    });

    await pipeline(sourceStream, targetStream);
    onProgress(rowCount);
    return rowCount;
  }

  static async getTableOrder(
    client: Client,
    tables: Array<{ tableName: string; schemaName: string }>,
  ): Promise<Array<{ tableName: string; schemaName: string }>> {
    const deps = new Map<string, Set<string>>();
    const tableSet = new Set(tables.map((t) => `${t.schemaName}.${t.tableName}`));

    for (const t of tables) {
      const key = `${t.schemaName}.${t.tableName}`;
      if (!deps.has(key)) deps.set(key, new Set());

      const fks = await client.query(`
        SELECT cl2.relname AS referenced_table, n2.nspname AS referenced_schema
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_class cl2 ON cl2.oid = c.confrelid
        JOIN pg_namespace n2 ON n2.oid = cl2.relnamespace
        WHERE c.contype = 'f' AND n.nspname = $1 AND cl.relname = $2
      `, [t.schemaName, t.tableName]);

      for (const fk of fks.rows) {
        const refKey = `${fk.referenced_schema}.${fk.referenced_table}`;
        if (tableSet.has(refKey)) {
          deps.get(key)!.add(refKey);
        }
      }
    }

    // Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    for (const [key, depSet] of deps) {
      inDegree.set(key, depSet.size);
    }
    // Ensure all keys have an entry
    for (const key of tableSet) {
      if (!inDegree.has(key)) inDegree.set(key, 0);
    }

    const queue: string[] = [];
    for (const [key, degree] of inDegree) {
      if (degree === 0) queue.push(key);
    }

    const ordered: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current);
      for (const [key, depSet] of deps) {
        if (depSet.has(current)) {
          depSet.delete(current);
          inDegree.set(key, inDegree.get(key)! - 1);
          if (inDegree.get(key) === 0) queue.push(key);
        }
      }
    }

    // If there are cycles, append remaining tables
    for (const key of tableSet) {
      if (!ordered.includes(key)) ordered.push(key);
    }

    const tableMap = new Map(tables.map((t) => [`${t.schemaName}.${t.tableName}`, t]));
    return ordered.map((key) => tableMap.get(key)!);
  }
}
