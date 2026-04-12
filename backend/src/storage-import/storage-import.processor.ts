import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';
import { StorageImportGateway } from './storage-import.gateway';
import { Client as MinioClient } from 'minio';
import { createReadStream, unlinkSync } from 'fs';
import { join } from 'path';
import * as unzipper from 'unzipper';
import { Readable } from 'stream';

@Processor('storage-import')
export class StorageImportProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
    private gateway: StorageImportGateway,
  ) {
    super();
  }

  async process(job: Job<{ importId: string; projectId: string }>) {
    const { importId, projectId } = job.data;

    const imp = await this.prisma.storageImport.findUnique({ where: { id: importId } });
    if (!imp || imp.status === 'CANCELLED') return;

    await this.updateStatus(importId, 'RUNNING');

    try {
      const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'MINIO');
      const targetClient = this.pool.getMinioClient(service.id, config);
      const meta = imp.metadata as any;

      if (imp.source === 'REMOTE') {
        await this.processRemote(importId, imp, targetClient, meta);
      } else if (imp.source === 'FILE') {
        await this.processFile(importId, imp, targetClient, meta);
      } else if (imp.source === 'URL') {
        await this.processUrl(importId, imp, targetClient, meta);
      }
    } catch (err: any) {
      await this.updateStatus(importId, 'FAILED', err.message);
      this.log(importId, 'error', `Import failed: ${err.message}`);
    }
  }

  private async processRemote(importId: string, imp: any, targetClient: MinioClient, meta: any) {
    const sourceClient = new MinioClient({
      endPoint: meta.connection.endpoint,
      port: meta.connection.port,
      accessKey: meta.connection.accessKey,
      secretKey: meta.connection.secretKey,
      useSSL: meta.connection.useSSL ?? false,
    });

    const allKeys: string[] = [];
    for (const key of meta.objectKeys || []) {
      if (key.endsWith('/')) {
        const objects = await this.listAllObjects(sourceClient, meta.sourceBucket, key);
        allKeys.push(...objects.map((o) => o.name));
      } else {
        allKeys.push(key);
      }
    }

    await this.prisma.storageImport.update({ where: { id: importId }, data: { totalFiles: allKeys.length } });
    this.log(importId, 'info', `Found ${allKeys.length} objects to import from remote`);

    let completed = 0;
    let skipped = 0;

    for (const key of allKeys) {
      const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
      if (current?.status === 'CANCELLED') { this.log(importId, 'info', 'Import cancelled'); return; }

      const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${key}` : key;

      const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
      if (exists) {
        if (imp.conflictStrategy === 'SKIP') {
          skipped++;
          this.log(importId, 'info', `Skipped (exists): ${targetKey}`);
          this.emitProgress(importId, ++completed, allKeys.length, targetKey, skipped);
          continue;
        } else if (imp.conflictStrategy === 'ERROR') {
          throw new Error(`Object already exists: ${targetKey}`);
        }
      }

      this.log(importId, 'info', `Copying: ${key} → ${targetKey}`);
      const stream = await sourceClient.getObject(meta.sourceBucket, key);
      await targetClient.putObject(imp.targetBucket, targetKey, stream);
      this.log(importId, 'info', `Imported (${completed + 1}/${allKeys.length}): ${targetKey}`);
      this.emitProgress(importId, ++completed, allKeys.length, targetKey, skipped);
    }

    await this.prisma.storageImport.update({
      where: { id: importId },
      data: { completedFiles: completed, skippedFiles: skipped },
    });
    this.log(importId, 'info', `Import complete: ${completed - skipped} imported, ${skipped} skipped`);
    await this.updateStatus(importId, 'COMPLETED');
  }

  private async processFile(importId: string, imp: any, targetClient: MinioClient, meta: any) {
    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    const fileKeys: string[] = meta.fileKeys || [];
    let totalUploaded = 0;
    let skipped = 0;

    for (const fileKey of fileKeys) {
      const filePath = join(tempDir, fileKey);
      const isZip = fileKey.endsWith('.zip');
      const isTarGz = fileKey.endsWith('.tar.gz') || fileKey.endsWith('.tgz');

      if (isZip) {
        this.log(importId, 'info', `Extracting ZIP: ${fileKey}`);
        const directory = await unzipper.Open.file(filePath);
        const entries = directory.files.filter((f) => f.type === 'File');

        await this.prisma.storageImport.update({
          where: { id: importId },
          data: { totalFiles: { increment: entries.length - 1 } },
        });

        for (const entry of entries) {
          const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
          if (current?.status === 'CANCELLED') return;

          const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${entry.path}` : entry.path;

          const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
          if (exists) {
            if (imp.conflictStrategy === 'SKIP') { skipped++; this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped); continue; }
            else if (imp.conflictStrategy === 'ERROR') throw new Error(`Object already exists: ${targetKey}`);
          }

          const stream = entry.stream();
          await targetClient.putObject(imp.targetBucket, targetKey, stream);
          this.log(importId, 'info', `Extracted & imported: ${targetKey}`);
          this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped);
        }
      } else if (isTarGz) {
        this.log(importId, 'info', `Extracting TAR.GZ: ${fileKey}`);
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const extractDir = join(tempDir, `storage-import-extract-${Date.now()}`);
        await execAsync(`mkdir -p "${extractDir}" && tar -xzf "${filePath}" -C "${extractDir}"`);

        const walkDir = (dir: string, base: string = ''): string[] => {
          const { readdirSync, statSync } = require('fs');
          const results: string[] = [];
          for (const entry of readdirSync(dir)) {
            const fullPath = join(dir, entry);
            const relPath = base ? `${base}/${entry}` : entry;
            if (statSync(fullPath).isDirectory()) results.push(...walkDir(fullPath, relPath));
            else results.push(relPath);
          }
          return results;
        };

        const extractedFiles = walkDir(extractDir);
        this.log(importId, 'info', `Found ${extractedFiles.length} files in archive`);
        await this.prisma.storageImport.update({
          where: { id: importId },
          data: { totalFiles: { increment: extractedFiles.length - 1 } },
        });

        for (const relPath of extractedFiles) {
          const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
          if (current?.status === 'CANCELLED') return;

          const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${relPath}` : relPath;

          const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
          if (exists) {
            if (imp.conflictStrategy === 'SKIP') { skipped++; this.log(importId, 'info', `Skipped (exists): ${targetKey}`); this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped); continue; }
            else if (imp.conflictStrategy === 'ERROR') throw new Error(`Object already exists: ${targetKey}`);
          }

          const fileStream = createReadStream(join(extractDir, relPath));
          await targetClient.putObject(imp.targetBucket, targetKey, fileStream);
          this.log(importId, 'info', `Imported (${totalUploaded + 1}/${extractedFiles.length}): ${targetKey}`);
          this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped);
        }

        await execAsync(`rm -rf "${extractDir}"`);
      } else {
        const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
        if (current?.status === 'CANCELLED') return;

        const originalName = fileKey.replace(/^storage-import-[a-f0-9]+-/, '');
        const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${originalName}` : originalName;

        const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
        if (exists) {
          if (imp.conflictStrategy === 'SKIP') { skipped++; this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped); continue; }
          else if (imp.conflictStrategy === 'ERROR') throw new Error(`Object already exists: ${targetKey}`);
        }

        this.log(importId, 'info', `Uploading: ${originalName}`);
        const fileStream = createReadStream(filePath);
        await targetClient.putObject(imp.targetBucket, targetKey, fileStream);
        this.log(importId, 'info', `Imported: ${targetKey}`);
        this.emitProgress(importId, ++totalUploaded, 0, targetKey, skipped);
      }

      try { unlinkSync(filePath); } catch {}
    }

    await this.prisma.storageImport.update({
      where: { id: importId },
      data: { completedFiles: totalUploaded, skippedFiles: skipped },
    });
    this.log(importId, 'info', `File import complete: ${totalUploaded - skipped} imported, ${skipped} skipped`);
    await this.updateStatus(importId, 'COMPLETED');
  }

  private async processUrl(importId: string, imp: any, targetClient: MinioClient, meta: any) {
    const urls: string[] = meta.urls || [];
    let completed = 0;
    let skipped = 0;

    this.log(importId, 'info', `Downloading ${urls.length} URLs`);

    for (const url of urls) {
      const current = await this.prisma.storageImport.findUnique({ where: { id: importId } });
      if (current?.status === 'CANCELLED') { this.log(importId, 'info', 'Import cancelled'); return; }

      try {
        const parsed = new URL(url);
        let fileName = parsed.pathname.split('/').pop() || 'download';

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const disposition = res.headers.get('content-disposition');
        if (disposition) {
          const match = disposition.match(/filename="?([^";\n]+)"?/);
          if (match) fileName = match[1];
        }

        const targetKey = imp.targetPrefix ? `${imp.targetPrefix}${fileName}` : fileName;

        const exists = await this.objectExists(targetClient, imp.targetBucket, targetKey);
        if (exists) {
          if (imp.conflictStrategy === 'SKIP') { skipped++; this.log(importId, 'info', `Skipped (exists): ${targetKey}`); this.emitProgress(importId, ++completed, urls.length, targetKey, skipped); continue; }
          else if (imp.conflictStrategy === 'ERROR') throw new Error(`Object already exists: ${targetKey}`);
        }

        const body = res.body;
        if (!body) throw new Error('Empty response body');
        const readable = Readable.fromWeb(body as any);
        await targetClient.putObject(imp.targetBucket, targetKey, readable);
        this.log(importId, 'info', `Downloaded: ${fileName}`);
        this.emitProgress(importId, ++completed, urls.length, targetKey, skipped);
      } catch (err: any) {
        this.log(importId, 'error', `Failed to download ${url}: ${err.message}`);
        if (imp.conflictStrategy === 'ERROR') throw err;
        completed++;
      }
    }

    await this.prisma.storageImport.update({
      where: { id: importId },
      data: { completedFiles: completed, skippedFiles: skipped },
    });
    this.log(importId, 'info', `URL import complete: ${completed - skipped} downloaded, ${skipped} skipped`);
    await this.updateStatus(importId, 'COMPLETED');
  }

  private async listAllObjects(client: MinioClient, bucket: string, prefix: string): Promise<{ name: string }[]> {
    return new Promise((resolve, reject) => {
      const objects: { name: string }[] = [];
      const stream = client.listObjectsV2(bucket, prefix, true);
      stream.on('data', (obj) => { if (obj.name) objects.push({ name: obj.name }); });
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });
  }

  private async objectExists(client: MinioClient, bucket: string, key: string): Promise<boolean> {
    try { await client.statObject(bucket, key); return true; } catch { return false; }
  }

  private async updateStatus(importId: string, status: string, error?: string) {
    await this.flushLogs(importId);
    await this.prisma.storageImport.update({ where: { id: importId }, data: { status: status as any, error } });
    this.gateway.emit(importId, 'storage-import:status', { status, error });
  }

  private logBuffer: Map<string, any[]> = new Map();

  private log(importId: string, level: string, message: string) {
    const entry = { timestamp: new Date().toISOString(), level, message };
    this.gateway.emit(importId, 'storage-import:log', entry);
    if (!this.logBuffer.has(importId)) this.logBuffer.set(importId, []);
    this.logBuffer.get(importId)!.push(entry);
  }

  private async flushLogs(importId: string) {
    const logs = this.logBuffer.get(importId) || [];
    if (logs.length === 0) return;
    try {
      const imp = await this.prisma.storageImport.findUnique({ where: { id: importId }, select: { metadata: true } });
      const meta = (imp?.metadata as any) || {};
      await this.prisma.storageImport.update({
        where: { id: importId },
        data: { metadata: { ...meta, logs } },
      });
    } catch {}
    this.logBuffer.delete(importId);
  }

  private emitProgress(importId: string, completedFiles: number, totalFiles: number, currentFile: string, skippedFiles: number) {
    this.gateway.emit(importId, 'storage-import:progress', { completedFiles, totalFiles, currentFile, skippedFiles });
  }
}
