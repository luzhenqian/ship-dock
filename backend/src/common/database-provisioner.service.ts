import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class DatabaseProvisionerService {
  constructor(private config: ConfigService) {}

  /**
   * Generate a unique database name from slug.
   * If the DB already exists, append a short hash.
   */
  async generateDbName(slug: string): Promise<string> {
    const baseName = slug.replace(/[^a-z0-9_-]/g, '_');
    const client = await this.getAdminClient();
    try {
      const exists = await this.dbExists(client, baseName);
      return exists ? `${baseName}_${randomBytes(3).toString('hex')}` : baseName;
    } finally {
      await client.end();
    }
  }

  /**
   * Create a database using the platform's own DB credentials, return the DATABASE_URL.
   */
  async provision(dbName: string): Promise<{ dbName: string; databaseUrl: string }> {
    const client = await this.getAdminClient();

    try {
      if (!(await this.dbExists(client, dbName))) {
        await client.query(`CREATE DATABASE "${dbName}"`);
      }
    } finally {
      await client.end();
    }

    // Enable common extensions
    const databaseUrl = this.buildUrl(dbName);
    const extClient = new Client({ connectionString: databaseUrl });
    await extClient.connect();
    try {
      await extClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await extClient.query('CREATE EXTENSION IF NOT EXISTS "vector"').catch(() => {});
    } finally {
      await extClient.end();
    }

    return { dbName, databaseUrl };
  }

  /**
   * Ensure a database exists before migration. Called during deploy.
   */
  async ensureDatabase(dbName: string): Promise<void> {
    const client = await this.getAdminClient();
    try {
      if (!(await this.dbExists(client, dbName))) {
        await client.query(`CREATE DATABASE "${dbName}"`);
      }
    } finally {
      await client.end();
    }
  }

  /**
   * Drop a database. Terminates active connections first.
   */
  async dropDatabase(dbName: string): Promise<void> {
    const client = await this.getAdminClient();
    try {
      // Terminate all connections to the database
      await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName]);
      if (await this.dbExists(client, dbName)) {
        await client.query(`DROP DATABASE "${dbName}"`);
      }
    } finally {
      await client.end();
    }
  }

  /**
   * Export database as SQL dump. Returns the dump content as a string.
   */
  async exportDatabase(dbName: string): Promise<string> {
    const adminUrl = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    const env = { ...process.env, PGPASSWORD: adminUrl.password };
    const { stdout } = await execFileAsync('pg_dump', [
      '-h', adminUrl.hostname,
      '-p', adminUrl.port || '5432',
      '-U', adminUrl.username,
      '-d', dbName,
      '--no-owner',
      '--no-acl',
    ], { env, maxBuffer: 100 * 1024 * 1024 }); // 100MB max
    return stdout;
  }

  private async dbExists(client: Client, dbName: string): Promise<boolean> {
    const result = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    return (result.rowCount ?? 0) > 0;
  }

  private getAdminClient(): Promise<Client> {
    const url = this.config.getOrThrow<string>('DATABASE_URL');
    const client = new Client({ connectionString: url });
    return client.connect().then(() => client);
  }

  private buildUrl(dbName: string): string {
    const adminUrl = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    return `postgresql://${adminUrl.username}:${adminUrl.password}@${adminUrl.hostname}:${adminUrl.port || 5432}/${dbName}`;
  }
}
