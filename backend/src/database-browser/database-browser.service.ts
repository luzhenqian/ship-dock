import { Injectable, BadRequestException } from '@nestjs/common';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';

const ALLOWED_SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|EXPLAIN)\b/i;
const BLOCKED_SQL = /\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|SET|COPY|DO|EXECUTE|PREPARE|CALL)\b/i;
const HAS_SEMICOLON = /;[\s]*\S/; // detects multi-statement queries

function throwPgError(err: any): never {
  if (err?.code) {
    const detail = err.detail ? `: ${err.detail}` : '';
    const messages: Record<string, string> = {
      '23505': `Duplicate key violation${detail}`,
      '23503': `Foreign key violation${detail}`,
      '23502': `Not-null violation: column "${err.column}" cannot be null`,
      '23514': `Check constraint violation${detail}`,
      '22P02': `Invalid input syntax${detail}`,
      '22003': `Numeric value out of range${detail}`,
      '22001': `Value too long for column${detail}`,
      '42703': `Column not found${detail}`,
      '42601': `SQL syntax error${detail ? detail : err.message ? `: ${err.message}` : ''}`,
      '42501': `Permission denied${detail}`,
    };
    throw new BadRequestException(messages[err.code] || `Database error (${err.code})${detail}`);
  }
  throw err;
}

@Injectable()
export class DatabaseBrowserService {
  constructor(
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
  ) {}

  private async getPool(projectId: string) {
    const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'POSTGRESQL');
    return this.pool.getPgPool(service.id, config);
  }

  async getTables(projectId: string) {
    const pool = await this.getPool(projectId);
    const result = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    return result.rows;
  }

  async getOverview(projectId: string) {
    const pool = await this.getPool(projectId);

    // Database size
    const sizeResult = await pool.query(`SELECT pg_database_size(current_database()) AS size`);
    const dbSize = Number(sizeResult.rows[0].size);

    // Per-table stats
    const tablesResult = await pool.query(`
      SELECT
        relname AS table_name,
        n_live_tup AS row_count,
        pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) AS size
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) DESC
    `);

    const tables = tablesResult.rows.map((r: any) => ({
      name: r.table_name,
      rows: Number(r.row_count),
      size: Number(r.size),
    }));

    const totalRows = tables.reduce((sum: number, t: any) => sum + t.rows, 0);

    return { dbSize, totalRows, tableCount: tables.length, tables };
  }

  async getTableStructure(projectId: string, table: string) {
    const pool = await this.getPool(projectId);

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('Invalid table name');
    }

    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);

    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
    `, [table]);

    const primaryKeys = await pool.query(`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ('"' || $1 || '"')::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)
    `, [table]);

    return { columns: columns.rows, indexes: indexes.rows, primaryKeys: primaryKeys.rows.map((r) => r.column_name) };
  }

  async updateRow(
    projectId: string,
    table: string,
    primaryKeys: Record<string, any>,
    column: string,
    value: any,
  ) {
    const pool = await this.getPool(projectId);

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('Invalid table name');
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
      throw new BadRequestException('Invalid column name');
    }

    const pkEntries = Object.entries(primaryKeys);
    if (pkEntries.length === 0) {
      throw new BadRequestException('Primary key values are required');
    }

    for (const key of pkEntries.map(([k]) => k)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new BadRequestException('Invalid primary key column name');
      }
    }

    const whereClause = pkEntries
      .map(([k], i) => `"${k}" = $${i + 2}`)
      .join(' AND ');
    const params = [value, ...pkEntries.map(([, v]) => v)];

    try {
      const result = await pool.query(
        `UPDATE "${table}" SET "${column}" = $1 WHERE ${whereClause}`,
        params,
      );

      if (result.rowCount === 0) {
        throw new BadRequestException('Row not found');
      }

      return { updated: result.rowCount };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throwPgError(err);
    }
  }

  async insertRow(projectId: string, table: string, data: Record<string, any>) {
    const pool = await this.getPool(projectId);

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('Invalid table name');
    }

    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      try {
        const result = await pool.query(`INSERT INTO "${table}" DEFAULT VALUES RETURNING *`);
        return result.rows[0];
      } catch (err) { throwPgError(err); }
    }

    for (const [col] of entries) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
        throw new BadRequestException('Invalid column name');
      }
    }

    const columns = entries.map(([k]) => `"${k}"`).join(', ');
    const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ');
    const values = entries.map(([, v]) => v === '' ? null : v);

    try {
      const result = await pool.query(
        `INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      return result.rows[0];
    } catch (err) { throwPgError(err); }
  }

  async getTableData(
    projectId: string,
    table: string,
    options: { page?: number; pageSize?: number; sort?: string; order?: 'asc' | 'desc' },
  ) {
    const pool = await this.getPool(projectId);

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('Invalid table name');
    }

    const page = options.page || 1;
    const pageSize = Math.min(options.pageSize || 50, 200);
    const offset = (page - 1) * pageSize;

    let orderClause = '';
    if (options.sort && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.sort)) {
      const order = options.order === 'desc' ? 'DESC' : 'ASC';
      orderClause = `ORDER BY "${options.sort}" ${order}`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM "${table}"`);
    const total = parseInt(countResult.rows[0].total);

    const dataResult = await pool.query(
      `SELECT * FROM "${table}" ${orderClause} LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );

    return {
      rows: dataResult.rows,
      columns: dataResult.fields.map((f) => f.name),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async deleteRows(
    projectId: string,
    table: string,
    rows: Record<string, any>[],
  ) {
    const pool = await this.getPool(projectId);

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new BadRequestException('Invalid table name');
    }
    if (!rows.length) {
      throw new BadRequestException('No rows specified');
    }

    // Validate all pk column names
    const pkColumns = Object.keys(rows[0]);
    for (const col of pkColumns) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
        throw new BadRequestException('Invalid primary key column name');
      }
    }

    try {
      let deleted = 0;
      for (const pkValues of rows) {
        const entries = Object.entries(pkValues);
        const whereClause = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(' AND ');
        const params = entries.map(([, v]) => v);
        const result = await pool.query(`DELETE FROM "${table}" WHERE ${whereClause}`, params);
        deleted += result.rowCount ?? 0;
      }
      return { deleted };
    } catch (err) { throwPgError(err); }
  }

  async executeQuery(projectId: string, sql: string) {
    if (HAS_SEMICOLON.test(sql)) {
      throw new BadRequestException('Multi-statement queries are not allowed');
    }
    if (!ALLOWED_SQL.test(sql)) {
      throw new BadRequestException('Only SELECT, INSERT, UPDATE, DELETE, and EXPLAIN statements are allowed');
    }
    if (BLOCKED_SQL.test(sql)) {
      throw new BadRequestException('Destructive statements (DROP, TRUNCATE, ALTER, CREATE, etc.) are not allowed');
    }

    const pool = await this.getPool(projectId);
    try {
      const result = await pool.query(sql);
      return {
        rows: result.rows || [],
        columns: result.fields?.map((f) => f.name) || [],
        rowCount: result.rowCount,
        command: result.command,
      };
    } catch (err) { throwPgError(err); }
  }
}
