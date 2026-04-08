import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ManifestParser } from './parsers/manifest-parser';
import { CreateImportDto } from './dto/create-import.dto';
import { SubmitImportConfigDto } from './dto/import-config.dto';
import { TestConnectionDto } from './dto/test-connection.dto';
import { ImportGateway } from './import.gateway';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private config: ConfigService,
    private manifestParser: ManifestParser,
    private jwt: JwtService,
    private gateway: ImportGateway,
    @InjectQueue('import') private importQueue: Queue,
  ) {}

  async createUploadToken(): Promise<{ token: string }> {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    const token = await this.jwt.signAsync(
      { scope: 'import' },
      { secret, expiresIn: '2h' },
    );
    return { token };
  }

  async reportProgress(importId: string, data: { stage: string; message?: string; percent?: number }) {
    // Store progress in the Import record so frontend can poll it
    const imp = await this.prisma.import.findUnique({ where: { id: importId } });
    if (!imp) throw new NotFoundException('Import not found');

    const cliProgress = ((imp.manifestData as any)?.cliProgress || []) as any[];
    const existing = cliProgress.findIndex((p: any) => p.stage === data.stage);
    const entry = { stage: data.stage, message: data.message, percent: data.percent, updatedAt: new Date().toISOString() };
    if (existing >= 0) {
      cliProgress[existing] = entry;
    } else {
      cliProgress.push(entry);
    }

    await this.prisma.import.update({
      where: { id: importId },
      data: { manifestData: { ...(imp.manifestData as any || {}), cliProgress } },
    });

    // Also emit via WebSocket for real-time updates
    this.gateway.emitProgress(importId, {
      itemId: 'cli',
      stage: data.stage,
      status: 'RUNNING',
      progress: data.percent,
    });

    return { ok: true };
  }

  async handleUpload(file: Express.Multer.File, userId: string, existingImportId?: string): Promise<any> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const uploadId = randomUUID();
    const uploadsDir = join(tempDir, 'imports');
    mkdirSync(uploadsDir, { recursive: true });

    const filePath = join(uploadsDir, `${uploadId}.tar.gz`);
    writeFileSync(filePath, file.buffer);

    // Extract and parse manifest
    const { execSync } = require('child_process');
    const extractDir = join(uploadsDir, uploadId);
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf ${filePath} -C ${extractDir}`, { timeout: 60000 });

    const { readFileSync, existsSync } = require('fs');
    const manifestPath = join(extractDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new BadRequestException('No manifest.json found in uploaded archive');
    }

    const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const manifest = this.manifestParser.parse(manifestRaw);

    let importId: string;

    if (existingImportId) {
      // Update existing import record (created by frontend)
      await this.prisma.import.update({
        where: { id: existingImportId },
        data: {
          status: 'UPLOADED',
          manifestData: manifestRaw,
          packageKey: filePath,
          totalProjects: manifest.projects.length,
        },
      });
      importId = existingImportId;
    } else {
      // Create new import record
      const importRecord = await this.prisma.import.create({
        data: {
          status: 'UPLOADED',
          sourceType: 'CLI_PACKAGE',
          manifestData: manifestRaw,
          packageKey: filePath,
          totalProjects: manifest.projects.length,
          userId,
        },
      });
      importId = importRecord.id;
    }

    await this.parseAndCreateItems(importId, manifest);

    return this.prisma.import.findUnique({
      where: { id: importId },
      include: { items: true },
    });
  }

  async getUpload(id: string): Promise<any> {
    const importRecord = await this.prisma.import.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!importRecord) {
      throw new NotFoundException('Import not found');
    }
    return importRecord;
  }

  async createImport(userId: string, dto: CreateImportDto): Promise<any> {
    const data: any = {
      status: 'PENDING',
      sourceType: dto.sourceType,
      userId,
    };

    if (dto.packageKey) {
      data.packageKey = dto.packageKey;
    }

    const importRecord = await this.prisma.import.create({ data });

    // If a package key is provided, try to parse its manifest
    if (dto.packageKey) {
      try {
        const { readFileSync, existsSync } = require('fs');
        const tempDir = this.config.get('TEMP_DIR', '/tmp');
        const extractDir = join(tempDir, 'imports', importRecord.id);
        const manifestPath = join(extractDir, 'manifest.json');

        if (existsSync(manifestPath)) {
          const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
          const manifest = this.manifestParser.parse(manifestRaw);
          await this.prisma.import.update({
            where: { id: importRecord.id },
            data: {
              manifestData: manifestRaw,
              totalProjects: manifest.projects.length,
              status: 'UPLOADED',
            },
          });
          await this.parseAndCreateItems(importRecord.id, manifest);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to parse manifest for import ${importRecord.id}: ${err.message}`);
      }
    }

    return this.prisma.import.findUnique({
      where: { id: importRecord.id },
      include: { items: true },
    });
  }

  async getImport(id: string): Promise<any> {
    const importRecord = await this.prisma.import.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!importRecord) {
      throw new NotFoundException('Import not found');
    }
    return importRecord;
  }

  async parseAndCreateItems(importId: string, manifest: any): Promise<void> {
    const projects = manifest.projects || [];

    for (const project of projects) {
      await this.prisma.importItem.create({
        data: {
          importId,
          sourceName: project.name,
          status: 'PENDING',
          config: {
            name: project.name,
            type: project.type,
            directory: project.directory,
            command: project.command,
            port: project.port,
            env: project.env || {},
            nginx: project.nginx,
            cron: project.cron || [],
            databases: project.databases || [],
            redis: project.redis || [],
            storage: project.storage || [],
            data: project.data || {},
            gitRemote: project.gitRemote,
            gitCommit: project.gitCommit,
          },
          stages: [],
        },
      });
    }

    await this.prisma.import.update({
      where: { id: importId },
      data: { status: 'CONFIGURING', totalProjects: projects.length },
    });
  }

  async updateConfig(id: string, dto: SubmitImportConfigDto): Promise<any> {
    const importRecord = await this.prisma.import.findUnique({ where: { id } });
    if (!importRecord) {
      throw new NotFoundException('Import not found');
    }
    if (importRecord.status !== 'CONFIGURING' && importRecord.status !== 'UPLOADED') {
      throw new BadRequestException(
        `Cannot update config when import is in ${importRecord.status} status`,
      );
    }

    for (const itemConfig of dto.items) {
      const existing = await this.prisma.importItem.findUnique({
        where: { id: itemConfig.itemId },
      });
      if (!existing || existing.importId !== id) {
        throw new NotFoundException(`Import item ${itemConfig.itemId} not found`);
      }

      const currentConfig = (existing.config as any) || {};
      await this.prisma.importItem.update({
        where: { id: itemConfig.itemId },
        data: {
          config: {
            ...currentConfig,
            name: itemConfig.name,
            slug: itemConfig.slug,
            port: itemConfig.port,
            repoUrl: itemConfig.repoUrl,
            branch: itemConfig.branch,
            envVars: itemConfig.envVars,
            pipeline: itemConfig.pipeline,
            domain: itemConfig.domain,
            dbConflictStrategy: itemConfig.dbConflictStrategy,
            cronJobs: itemConfig.cronJobs,
            skipDatabase: itemConfig.skipDatabase,
            skipRedis: itemConfig.skipRedis,
            skipStorage: itemConfig.skipStorage,
          },
        },
      });
    }

    // Ensure status is CONFIGURING
    if (importRecord.status === 'UPLOADED') {
      await this.prisma.import.update({
        where: { id },
        data: { status: 'CONFIGURING' },
      });
    }

    return this.prisma.import.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  async startImport(id: string): Promise<any> {
    const importRecord = await this.prisma.import.findUnique({ where: { id } });
    if (!importRecord) {
      throw new NotFoundException('Import not found');
    }
    if (importRecord.status !== 'CONFIGURING') {
      throw new BadRequestException(
        `Cannot start import in ${importRecord.status} status. Must be in CONFIGURING status.`,
      );
    }

    await this.prisma.import.update({
      where: { id },
      data: { status: 'RUNNING' },
    });

    await this.importQueue.add('process-import', { importId: id });

    return this.prisma.import.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  async cancelImport(id: string): Promise<any> {
    const importRecord = await this.prisma.import.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!importRecord) {
      throw new NotFoundException('Import not found');
    }

    await this.prisma.import.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    // Mark all pending items as SKIPPED
    for (const item of importRecord.items) {
      if (item.status === 'PENDING' || item.status === 'RUNNING') {
        await this.prisma.importItem.update({
          where: { id: item.id },
          data: { status: 'SKIPPED' },
        });
      }
    }

    return this.prisma.import.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  async deleteImport(id: string): Promise<{ deleted: boolean }> {
    const importRecord = await this.prisma.import.findUnique({ where: { id } });
    if (!importRecord) {
      throw new NotFoundException('Import not found');
    }

    await this.prisma.import.delete({ where: { id } });
    return { deleted: true };
  }

  async testConnection(
    dto: TestConnectionDto,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (dto.type === 'database') {
        return await this.testDatabaseConnection(dto);
      } else if (dto.type === 'redis') {
        return await this.testRedisConnection(dto);
      } else if (dto.type === 'storage') {
        return await this.testStorageConnection(dto);
      }
      return { success: false, error: `Unknown connection type: ${dto.type}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  private async testDatabaseConnection(
    dto: TestConnectionDto,
  ): Promise<{ success: boolean; error?: string }> {
    const { Client } = require('pg');
    const connectionString =
      dto.url ||
      `postgresql://${dto.username}:${dto.password}@${dto.host}:${dto.port || '5432'}/${dto.database}`;
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 10000,
    });
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

  private async testRedisConnection(
    dto: TestConnectionDto,
  ): Promise<{ success: boolean; error?: string }> {
    const Redis = require('ioredis').default || require('ioredis');
    const url =
      dto.url || `redis://${dto.host}:${dto.port || '6379'}`;
    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 10000,
      maxRetriesPerRequest: 0,
    });
    try {
      await client.connect();
      await client.ping();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      await client.quit().catch(() => {});
    }
  }

  private async testStorageConnection(
    dto: TestConnectionDto,
  ): Promise<{ success: boolean; error?: string }> {
    const Minio = require('minio');
    const endpoint = dto.endpoint || dto.host || 'localhost';
    const port = parseInt(dto.port || '9000', 10);
    const client = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL: false,
      accessKey: dto.accessKey || '',
      secretKey: dto.secretKey || '',
    });
    try {
      // Try listing buckets as a connection test
      await client.listBuckets();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
