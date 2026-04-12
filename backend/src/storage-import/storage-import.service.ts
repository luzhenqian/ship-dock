import { BadRequestException, Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CreateStorageImportDto, RemoteConnectionDto, ValidateUrlsDto } from './dto/create-storage-import.dto';
import { Client as MinioClient } from 'minio';
import { InputJsonValue } from '@prisma/client/runtime/library';
import { readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class StorageImportService implements OnModuleInit {
  private readonly logger = new Logger(StorageImportService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('storage-import') private importQueue: Queue,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    setInterval(() => this.cleanupTempFiles(), CLEANUP_INTERVAL_MS);
  }

  private cleanupTempFiles() {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    try {
      const files = readdirSync(tempDir);
      const now = Date.now();
      let cleaned = 0;
      for (const file of files) {
        if (!file.startsWith('storage-import-')) continue;
        const filePath = join(tempDir, file);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE_MS) { unlinkSync(filePath); cleaned++; }
        } catch {}
      }
      if (cleaned > 0) this.logger.log(`Cleaned up ${cleaned} stale storage import temp file(s)`);
    } catch {}
  }

  async testConnection(dto: RemoteConnectionDto) {
    const client = new MinioClient({
      endPoint: dto.endpoint,
      port: dto.port,
      accessKey: dto.accessKey,
      secretKey: dto.secretKey,
      useSSL: dto.useSSL ?? false,
    });
    try {
      const buckets = await client.listBuckets();
      return { success: true, buckets: buckets.map((b) => ({ name: b.name, creationDate: b.creationDate })) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async discoverObjects(dto: RemoteConnectionDto & { bucket: string; prefix?: string }) {
    const client = new MinioClient({
      endPoint: dto.endpoint,
      port: dto.port,
      accessKey: dto.accessKey,
      secretKey: dto.secretKey,
      useSSL: dto.useSSL ?? false,
    });

    return new Promise<{ objects: any[]; prefixes: string[] }>((resolve, reject) => {
      const objects: any[] = [];
      const prefixes: string[] = [];
      const stream = client.listObjectsV2(dto.bucket, dto.prefix || '', false, '/');

      stream.on('data', (obj: any) => {
        if (obj.prefix) {
          prefixes.push(obj.prefix);
        } else {
          objects.push({ name: obj.name, size: obj.size, lastModified: obj.lastModified });
        }
      });
      stream.on('end', () => resolve({ objects, prefixes }));
      stream.on('error', reject);
    });
  }

  async validateUrls(dto: ValidateUrlsDto) {
    const results = await Promise.all(
      dto.urls.map(async (url) => {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { url, valid: false, error: 'Only HTTP/HTTPS URLs are supported' };
          }
          const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
          if (!res.ok) return { url, valid: false, error: `HTTP ${res.status}` };
          const size = parseInt(res.headers.get('content-length') || '0', 10);
          const disposition = res.headers.get('content-disposition');
          let fileName = parsed.pathname.split('/').pop() || 'download';
          if (disposition) {
            const match = disposition.match(/filename="?([^";\n]+)"?/);
            if (match) fileName = match[1];
          }
          return { url, valid: true, fileName, size };
        } catch (err: any) {
          return { url, valid: false, error: err.message };
        }
      }),
    );
    return { results };
  }

  async createImport(projectId: string, dto: CreateStorageImportDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const active = await this.prisma.storageImport.findFirst({
      where: { projectId, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (active) throw new BadRequestException('A storage import is already in progress for this project');

    const storageImport = await this.prisma.storageImport.create({
      data: {
        projectId,
        source: dto.source,
        targetBucket: dto.targetBucket,
        targetPrefix: dto.targetPrefix || '',
        conflictStrategy: dto.conflictStrategy,
        totalFiles: dto.totalFiles || 0,
        totalSize: dto.totalSize || 0,
        metadata: {
          connection: dto.source === 'REMOTE' ? dto.connection : undefined,
          sourceBucket: dto.source === 'REMOTE' ? dto.sourceBucket : undefined,
          objectKeys: dto.source === 'REMOTE' ? dto.objectKeys : undefined,
          fileKeys: dto.source === 'FILE' ? dto.fileKeys : undefined,
          urls: dto.source === 'URL' ? dto.urls : undefined,
        } as unknown as InputJsonValue,
      },
    });

    await this.importQueue.add('storage-import', {
      importId: storageImport.id,
      projectId,
    });

    return storageImport;
  }

  async getImport(importId: string) {
    const imp = await this.prisma.storageImport.findUnique({ where: { id: importId } });
    if (!imp) throw new NotFoundException('Import not found');
    return imp;
  }

  async cancelImport(importId: string) {
    const imp = await this.prisma.storageImport.findUnique({ where: { id: importId } });
    if (!imp) throw new NotFoundException('Import not found');
    if (!['PENDING', 'RUNNING'].includes(imp.status)) {
      throw new BadRequestException('Can only cancel active imports');
    }
    return this.prisma.storageImport.update({
      where: { id: importId },
      data: { status: 'CANCELLED' },
    });
  }
}
