import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConfigService } from '@nestjs/config';
import { CreateMigrationDto, AnalyzeFileDto, ConnectionConfigDto } from './dto/create-migration.dto';
import { RemoteMigrator } from './remote-migrator';
import { FileMigrator } from './file-migrator';
import { readFileSync } from 'fs';
import { join } from 'path';

const MAX_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB

@Injectable()
export class DataMigrationService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('data-migration') private migrationQueue: Queue,
    private encryption: EncryptionService,
    private config: ConfigService,
  ) {}

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
      return { tables, format };
    } else {
      const sql = readFileSync(filePath, 'utf-8');
      const tables = FileMigrator.parseTablesFromSql(sql);
      return { tables, format };
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
