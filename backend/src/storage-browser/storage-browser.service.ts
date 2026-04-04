import { Injectable } from '@nestjs/common';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';
import { Readable } from 'stream';

@Injectable()
export class StorageBrowserService {
  constructor(
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
  ) {}

  private async getClient(projectId: string) {
    const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'MINIO');
    return this.pool.getMinioClient(service.id, config);
  }

  async listBuckets(projectId: string) {
    const client = await this.getClient(projectId);
    return client.listBuckets();
  }

  async listObjects(
    projectId: string,
    bucket: string,
    options: { prefix?: string; delimiter?: string; maxKeys?: number },
  ) {
    const client = await this.getClient(projectId);
    const prefix = options.prefix || '';
    const delimiter = options.delimiter || '/';

    return new Promise<{ objects: any[]; prefixes: string[]; isTruncated: boolean; nextMarker?: string }>((resolve, reject) => {
      const objects: any[] = [];
      const prefixes: string[] = [];
      const maxKeys = options.maxKeys || 100;
      let count = 0;
      let lastKey: string | undefined;
      let truncated = false;

      const stream = client.listObjectsV2(bucket, prefix, false, delimiter);

      stream.on('data', (obj: any) => {
        if (count >= maxKeys) {
          truncated = true;
          stream.destroy();
          return;
        }
        if (obj.prefix) {
          prefixes.push(obj.prefix);
        } else {
          objects.push({
            name: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
            etag: obj.etag,
          });
          lastKey = obj.name;
        }
        count++;
      });

      stream.on('end', () => resolve({ objects, prefixes, isTruncated: truncated, nextMarker: truncated ? lastKey : undefined }));
      stream.on('error', reject);
    });
  }

  async getObject(projectId: string, bucket: string, key: string): Promise<Readable> {
    const client = await this.getClient(projectId);
    return client.getObject(bucket, key);
  }

  async getObjectStat(projectId: string, bucket: string, key: string) {
    const client = await this.getClient(projectId);
    return client.statObject(bucket, key);
  }

  async uploadObject(projectId: string, bucket: string, key: string, buffer: Buffer, contentType: string) {
    const client = await this.getClient(projectId);
    await client.putObject(bucket, key, buffer, buffer.length, { 'Content-Type': contentType });
    return { success: true, key };
  }

  async deleteObject(projectId: string, bucket: string, key: string) {
    const client = await this.getClient(projectId);
    await client.removeObject(bucket, key);
    return { success: true };
  }
}
