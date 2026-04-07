import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioProvisionerService {
  private readonly logger = new Logger(MinioProvisionerService.name);

  constructor(private config: ConfigService) {}

  /**
   * Generate a bucket name from the project slug.
   * Bucket names must be 3-63 chars, lowercase, no underscores.
   */
  generateBucketName(slug: string): string {
    return `proj-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);
  }

  /**
   * Create a MinIO bucket for a project.
   * Returns bucket name and connection details to inject as env vars.
   */
  async provision(bucketName: string): Promise<{
    bucketName: string;
    endpoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    useSSL: boolean;
  }> {
    const client = this.getClient();
    const exists = await client.bucketExists(bucketName);
    if (!exists) {
      await client.makeBucket(bucketName);
    }
    this.logger.log(`Provisioned MinIO bucket: ${bucketName}`);

    const { endPoint, port, accessKey, secretKey, useSSL } = this.getConnectionConfig();
    return { bucketName, endpoint: endPoint, port, accessKey, secretKey, useSSL };
  }

  /**
   * Remove all objects and delete the bucket.
   */
  async deprovision(bucketName: string): Promise<void> {
    const client = this.getClient();
    const exists = await client.bucketExists(bucketName);
    if (!exists) return;

    // Remove all objects in bucket
    const objectsList = await new Promise<string[]>((resolve, reject) => {
      const objects: string[] = [];
      const stream = client.listObjects(bucketName, '', true);
      stream.on('data', (obj) => { if (obj.name) objects.push(obj.name); });
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });

    if (objectsList.length > 0) {
      await client.removeObjects(bucketName, objectsList);
    }
    await client.removeBucket(bucketName);
    this.logger.log(`Deprovisioned MinIO bucket: ${bucketName}`);
  }

  private getClient(): Minio.Client {
    const config = this.getConnectionConfig();
    return new Minio.Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  private getConnectionConfig() {
    return {
      endPoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: this.config.get<number>('MINIO_PORT', 9000),
      useSSL: this.config.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
    };
  }
}
