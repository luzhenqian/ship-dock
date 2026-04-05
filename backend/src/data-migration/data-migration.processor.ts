import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { DataMigrationGateway } from './data-migration.gateway';
import { RemoteMigrator, ConnectionConfig } from './remote-migrator';
import { FileMigrator } from './file-migrator';
import { Client } from 'pg';
import { join } from 'path';
import { unlinkSync } from 'fs';

@Processor('data-migration')
export class DataMigrationProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
    private gateway: DataMigrationGateway,
  ) {
    super();
  }

  async process(job: Job<{ migrationId: string; projectId: string }>) {
    const { migrationId, projectId } = job.data;

    const migration = await this.prisma.dataMigration.findUnique({
      where: { id: migrationId },
      include: { tables: true },
    });
    if (!migration || migration.status === 'CANCELLED') return;

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || !project.dbName) return;

    const targetUrl = this.buildTargetUrl(project.dbName);

    try {
      if (migration.source === 'REMOTE') {
        await this.processRemoteMigration(migration, targetUrl);
      } else {
        await this.processFileMigration(migration, targetUrl);
      }
    } catch (err: any) {
      await this.updateMigrationStatus(migrationId, 'FAILED', err.message);
      this.log(migrationId, 'error', `Migration failed: ${err.message}`);
    }
  }

  private async processRemoteMigration(migration: any, targetUrl: string) {
    const migrationId = migration.id;
    const config: ConnectionConfig = JSON.parse(this.encryption.decrypt(migration.connectionConfig));

    // Phase 1: Connect
    await this.updateMigrationStatus(migrationId, 'CONNECTING');
    this.log(migrationId, 'info', 'Connecting to source database...');

    const sourceUrl = RemoteMigrator.buildConnectionString(config);
    const sourceClient = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 30000 });
    const targetClient = new Client({ connectionString: targetUrl });

    try {
      await sourceClient.connect();
      await targetClient.connect();
      this.log(migrationId, 'info', 'Connected to both source and target databases');

      // Phase 2: Analyze and order tables
      await this.updateMigrationStatus(migrationId, 'ANALYZING');
      const orderedTables = await RemoteMigrator.getTableOrder(
        sourceClient,
        migration.tables.map((t: any) => ({ tableName: t.tableName, schemaName: t.schemaName })),
      );
      this.log(migrationId, 'info', `Migration order: ${orderedTables.map((t) => t.tableName).join(' → ')}`);

      // Phase 3: Migrate
      await this.updateMigrationStatus(migrationId, 'MIGRATING');
      const allForeignKeys: string[] = [];
      let completedTables = 0;
      let completedRows = BigInt(0);

      for (const table of orderedTables) {
        const migTable = migration.tables.find(
          (t: any) => t.tableName === table.tableName && t.schemaName === table.schemaName,
        );
        if (!migTable) continue;

        // Check if cancelled
        const current = await this.prisma.dataMigration.findUnique({ where: { id: migrationId } });
        if (current?.status === 'CANCELLED') {
          this.log(migrationId, 'info', 'Migration cancelled by user');
          return;
        }

        const qualifiedName = `"${table.schemaName}"."${table.tableName}"`;
        this.log(migrationId, 'info', `Migrating table ${qualifiedName}...`);
        await this.prisma.dataMigrationTable.update({
          where: { id: migTable.id },
          data: { status: 'MIGRATING', startedAt: new Date() },
        });
        this.emitProgress(migrationId, completedTables, migration.tables.length, migTable.tableName);

        try {
          // Check conflict
          const existsResult = await targetClient.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)`,
            [table.schemaName, table.tableName],
          );
          const tableExists = existsResult.rows[0].exists;

          if (migration.conflictStrategy === 'APPEND') {
            // APPEND mode: table must exist, insert data with ON CONFLICT DO NOTHING
            if (!tableExists) {
              this.log(migrationId, 'info', `Skipping ${qualifiedName} (table does not exist in target)`);
              await this.prisma.dataMigrationTable.update({
                where: { id: migTable.id },
                data: { status: 'SKIPPED', completedAt: new Date() },
              });
              completedTables++;
              continue;
            }

            // Copy into temp table, then INSERT ... ON CONFLICT DO NOTHING
            const tempName = `_migration_tmp_${table.tableName}_${Date.now()}`;
            const tempQualified = `"${table.schemaName}"."${tempName}"`;
            await targetClient.query(`CREATE TEMP TABLE "${tempName}" (LIKE ${qualifiedName} INCLUDING ALL)`);
            this.log(migrationId, 'info', `Appending data to ${qualifiedName} (skip duplicates)...`);

            const rowsCopied = await RemoteMigrator.copyTableData(
              sourceClient, targetClient, table.schemaName, table.tableName,
              (rows) => {
                completedRows += BigInt(rows);
                this.emitProgress(migrationId, completedTables, migration.tables.length, migTable.tableName);
              },
              tempName,
            );

            // Get primary key columns for ON CONFLICT
            const pkResult = await targetClient.query(`
              SELECT a.attname FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
              WHERE i.indrelid = ${qualifiedName}::regclass AND i.indisprimary
            `);
            const pkCols = pkResult.rows.map((r: any) => `"${r.attname}"`).join(', ');

            let inserted = 0;
            if (pkCols) {
              const res = await targetClient.query(
                `INSERT INTO ${qualifiedName} SELECT * FROM "${tempName}" ON CONFLICT (${pkCols}) DO NOTHING`,
              );
              inserted = res.rowCount || 0;
            } else {
              // No primary key — just insert all, duplicates may occur
              const res = await targetClient.query(`INSERT INTO ${qualifiedName} SELECT * FROM "${tempName}"`);
              inserted = res.rowCount || 0;
            }
            await targetClient.query(`DROP TABLE IF EXISTS "${tempName}"`);

            const skipped = rowsCopied - inserted;
            this.log(migrationId, 'info', `Appended ${inserted} rows to ${qualifiedName}${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}`);
          } else {
            // Table-level strategies: ERROR, SKIP, OVERWRITE
            if (tableExists) {
              if (migration.conflictStrategy === 'ERROR') {
                throw new Error(`Table ${qualifiedName} already exists in target database`);
              } else if (migration.conflictStrategy === 'SKIP') {
                this.log(migrationId, 'info', `Skipping ${qualifiedName} (already exists)`);
                await this.prisma.dataMigrationTable.update({
                  where: { id: migTable.id },
                  data: { status: 'SKIPPED', completedAt: new Date() },
                });
                completedTables++;
                continue;
              } else {
                // OVERWRITE
                this.log(migrationId, 'info', `Dropping existing ${qualifiedName} for overwrite`);
                await targetClient.query(`DROP TABLE IF EXISTS ${qualifiedName} CASCADE`);
              }
            }

            // Create table DDL
            const ddl = await RemoteMigrator.getTableDDL(sourceClient, table.schemaName, table.tableName);
            await targetClient.query(ddl);
            this.log(migrationId, 'info', `Created table structure for ${qualifiedName}`);

            // Collect foreign keys for later
            const fks = await RemoteMigrator.getTableForeignKeys(sourceClient, table.schemaName, table.tableName);
            allForeignKeys.push(...fks);

            // Copy data
            const rowsCopied = await RemoteMigrator.copyTableData(
              sourceClient, targetClient, table.schemaName, table.tableName,
              (rows) => {
                completedRows += BigInt(rows);
                this.emitProgress(migrationId, completedTables, migration.tables.length, migTable.tableName);
              },
            );

            this.log(migrationId, 'info', `Copied ${rowsCopied} rows for ${qualifiedName}`);
          }
          await this.prisma.dataMigrationTable.update({
            where: { id: migTable.id },
            data: { status: 'COMPLETED', migratedRows: rowsCopied, completedAt: new Date() },
          });
          completedTables++;

          await this.prisma.dataMigration.update({
            where: { id: migrationId },
            data: { completedTables, completedRows },
          });
        } catch (err: any) {
          this.log(migrationId, 'error', `Failed to migrate ${qualifiedName}: ${err.message}`);
          await this.prisma.dataMigrationTable.update({
            where: { id: migTable.id },
            data: { status: 'FAILED', errorMessage: err.message, completedAt: new Date() },
          });
          completedTables++;
        }
      }

      // Restore foreign keys
      if (allForeignKeys.length > 0) {
        this.log(migrationId, 'info', `Restoring ${allForeignKeys.length} foreign key constraints...`);
        for (const fk of allForeignKeys) {
          try {
            await targetClient.query(fk);
          } catch (err: any) {
            this.log(migrationId, 'warn', `Failed to restore FK: ${err.message}`);
          }
        }
      }

      // Final status
      const updatedTables = await this.prisma.dataMigrationTable.findMany({
        where: { migrationId },
      });
      const failed = updatedTables.filter((t: any) => t.status === 'FAILED').length;
      const skipped = updatedTables.filter((t: any) => t.status === 'SKIPPED').length;
      const succeeded = updatedTables.filter((t: any) => t.status === 'COMPLETED').length;

      this.log(migrationId, 'info', `Migration complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);
      await this.updateMigrationStatus(migrationId, failed > 0 ? 'FAILED' : 'COMPLETED');
    } finally {
      await sourceClient.end().catch(() => {});
      await targetClient.end().catch(() => {});
    }
  }

  private async processFileMigration(migration: any, targetUrl: string) {
    const migrationId = migration.id;
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const filePath = join(tempDir, migration.fileKey);
    const format = FileMigrator.detectFormat(migration.fileKey || migration.fileName || '');

    await this.updateMigrationStatus(migrationId, 'MIGRATING');
    this.log(migrationId, 'info', `Starting file import (${format} format)...`);

    const tables = migration.tables.map((t: any) => ({
      tableName: t.tableName,
      schemaName: t.schemaName,
    }));

    const onLog = (line: string) => this.log(migrationId, 'info', line);

    let result: { success: boolean; error?: string };
    if (format === 'custom') {
      result = await FileMigrator.restoreFromDump(filePath, targetUrl, tables, migration.conflictStrategy, onLog);
    } else {
      result = await FileMigrator.restoreFromSql(filePath, targetUrl, tables, migration.conflictStrategy, onLog);
    }

    // Mark all tables as completed or failed
    for (const migTable of migration.tables) {
      await this.prisma.dataMigrationTable.update({
        where: { id: migTable.id },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          errorMessage: result.success ? null : result.error,
          completedAt: new Date(),
        },
      });
    }

    await this.updateMigrationStatus(migrationId, result.success ? 'COMPLETED' : 'FAILED', result.error);

    // Clean up temp file
    try { unlinkSync(filePath); } catch {}
  }

  private buildTargetUrl(dbName: string): string {
    const adminUrl = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    return `postgresql://${adminUrl.username}:${adminUrl.password}@${adminUrl.hostname}:${adminUrl.port || 5432}/${dbName}`;
  }

  private async updateMigrationStatus(migrationId: string, status: string, errorMessage?: string) {
    const data: any = { status };
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      data.completedAt = new Date();
    }
    if (status === 'MIGRATING' || status === 'CONNECTING') {
      data.startedAt = new Date();
    }
    if (errorMessage) data.errorMessage = errorMessage;
    await this.prisma.dataMigration.update({ where: { id: migrationId }, data });
    this.gateway.emitToMigration(migrationId, 'migration:status', { status, errorMessage });
  }

  private log(migrationId: string, level: string, message: string) {
    this.gateway.emitToMigration(migrationId, 'migration:log', {
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  }

  private emitProgress(migrationId: string, completedTables: number, totalTables: number, currentTable: string) {
    this.gateway.emitToMigration(migrationId, 'migration:progress', {
      completedTables,
      totalTables,
      currentTable,
    });
  }
}
