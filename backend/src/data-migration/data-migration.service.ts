import { BadRequestException, Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { CreateMigrationDto, AnalyzeFileDto, ConnectionConfigDto } from './dto/create-migration.dto';
import { RemoteMigrator } from './remote-migrator';
import { FileMigrator } from './file-migrator';
import { readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const MAX_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

@Injectable()
export class DataMigrationService implements OnModuleInit {
  private readonly logger = new Logger(DataMigrationService.name);
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private prisma: PrismaService,
    @InjectQueue('data-migration') private migrationQueue: Queue,
    private encryption: EncryptionService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanupTempFiles(), CLEANUP_INTERVAL_MS);
  }

  private cleanupTempFiles() {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    try {
      const files = readdirSync(tempDir);
      const now = Date.now();
      let cleaned = 0;
      for (const file of files) {
        if (!file.startsWith('migration-')) continue;
        const filePath = join(tempDir, file);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {}
      }
      if (cleaned > 0) {
        this.logger.log(`Cleaned up ${cleaned} stale migration temp file(s)`);
      }
    } catch {}
  }

  async testConnection(connection: ConnectionConfigDto) {
    return RemoteMigrator.testConnection(connection);
  }

  async discoverTables(connection: ConnectionConfigDto) {
    const tables = await RemoteMigrator.discoverTables(connection);
    const totalSize = tables.reduce((sum, t) => sum + t.estimatedSize, 0);
    return {
      tables,
      totalSize,
      totalSizeFormatted: RemoteMigrator.formatBytes(totalSize),
      exceedsLimit: totalSize > MAX_SIZE_BYTES,
    };
  }

  async analyzeFile(dto: AnalyzeFileDto) {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const filePath = join(tempDir, dto.fileKey);
    const format = FileMigrator.detectFormat(dto.fileKey);

    if (format === 'custom') {
      const tables = await FileMigrator.parseTablesFromDump(filePath);
      return { tables, format, hasCreateStatements: false };
    } else {
      const sql = readFileSync(filePath, 'utf-8');
      const tables = FileMigrator.parseTablesFromSql(sql);
      const hasCreateStatements = /CREATE\s+TABLE\s/i.test(sql);
      return { tables, format, hasCreateStatements };
    }
  }

  async createMigration(projectId: string, userId: string, dto: CreateMigrationDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.useLocalDb || !project.dbName) {
      throw new BadRequestException('Project does not have a platform database. Provision one first.');
    }

    const active = await this.prisma.dataMigration.findFirst({
      where: { projectId, status: { in: ['PENDING', 'CONNECTING', 'ANALYZING', 'MIGRATING'] } },
    });
    if (active) throw new BadRequestException('A migration is already in progress for this project');

    const migration = await this.prisma.dataMigration.create({
      data: {
        projectId,
        triggeredById: userId,
        source: dto.source,
        connectionConfig: dto.connection ? this.encryption.encrypt(JSON.stringify(dto.connection)) : null,
        fileKey: dto.fileKey,
        fileName: dto.fileName,
        conflictStrategy: dto.conflictStrategy,
        totalTables: dto.tables.length,
      },
    });

    await this.prisma.dataMigrationTable.createMany({
      data: dto.tables.map((t) => ({
        migrationId: migration.id,
        tableName: t.tableName,
        schemaName: t.schemaName || 'public',
      })),
    });

    await this.migrationQueue.add('data-migration', {
      migrationId: migration.id,
      projectId,
    });

    return migration;
  }

  async getMigrations(projectId: string) {
    return this.prisma.dataMigration.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
  }

  async getMigration(migrationId: string) {
    const migration = await this.prisma.dataMigration.findUnique({
      where: { id: migrationId },
      include: { tables: true, triggeredBy: { select: { id: true, name: true } } },
    });
    if (!migration) throw new NotFoundException('Migration not found');
    return migration;
  }

  async cancelMigration(migrationId: string) {
    const migration = await this.prisma.dataMigration.findUnique({ where: { id: migrationId } });
    if (!migration) throw new NotFoundException('Migration not found');
    if (!['PENDING', 'CONNECTING', 'ANALYZING', 'MIGRATING'].includes(migration.status)) {
      throw new BadRequestException('Can only cancel active migrations');
    }
    return this.prisma.dataMigration.update({
      where: { id: migrationId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }
}
