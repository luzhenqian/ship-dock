import { Injectable, BadRequestException } from '@nestjs/common';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';

const ALLOWED_SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|EXPLAIN)\b/i;
const BLOCKED_SQL = /\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|SET|COPY)\b/i;

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

    return { columns: columns.rows, indexes: indexes.rows };
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

  async executeQuery(projectId: string, sql: string) {
    if (!ALLOWED_SQL.test(sql)) {
      throw new BadRequestException('Only SELECT, INSERT, UPDATE, DELETE, and EXPLAIN statements are allowed');
    }
    if (BLOCKED_SQL.test(sql)) {
      throw new BadRequestException('DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE, SET, and COPY statements are not allowed');
    }

    const pool = await this.getPool(projectId);
    const result = await pool.query(sql);

    return {
      rows: result.rows || [],
      columns: result.fields?.map((f) => f.name) || [],
      rowCount: result.rowCount,
      command: result.command,
    };
  }
}
