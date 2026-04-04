import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { ConnectionPoolService } from './connection-pool.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private pool: ConnectionPoolService,
  ) {}

  async findAll(projectId: string) {
    const services = await this.prisma.serviceConnection.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return services.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      type: s.type,
      name: s.name,
      autoDetected: s.autoDetected,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async create(projectId: string, dto: CreateServiceDto) {
    return this.prisma.serviceConnection.create({
      data: {
        projectId,
        type: dto.type,
        name: dto.name,
        config: this.encryption.encrypt(JSON.stringify(dto.config)),
        autoDetected: false,
      },
    });
  }

  async update(id: string, dto: UpdateServiceDto) {
    const existing = await this.prisma.serviceConnection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service connection not found');

    const data: any = {};
    if (dto.name) data.name = dto.name;
    if (dto.config) {
      data.config = this.encryption.encrypt(JSON.stringify(dto.config));
      await this.pool.removeConnection(id);
    }

    return this.prisma.serviceConnection.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.pool.removeConnection(id);
    return this.prisma.serviceConnection.delete({ where: { id } });
  }

  getDecryptedConfig(service: { id: string; config: string }) {
    return JSON.parse(this.encryption.decrypt(service.config));
  }

  async getServiceWithConfig(projectId: string, type: string) {
    const service = await this.prisma.serviceConnection.findFirst({
      where: { projectId, type: type as any },
    });
    if (!service) throw new NotFoundException(`No ${type} connection configured for this project`);
    return { service, config: this.getDecryptedConfig(service) };
  }

  async detect(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || !project.envVars) return [];

    let envVars: Record<string, string>;
    try {
      envVars = JSON.parse(this.encryption.decrypt(project.envVars));
    } catch {
      return [];
    }

    const detected: Array<{ type: string; name: string; config: Record<string, any> }> = [];

    if (envVars.DATABASE_URL) {
      try {
        const url = new URL(envVars.DATABASE_URL);
        detected.push({
          type: 'POSTGRESQL',
          name: 'Database (auto-detected)',
          config: {
            host: url.hostname,
            port: parseInt(url.port) || 5432,
            database: url.pathname.slice(1),
            user: url.username,
            password: url.password,
            ssl: url.searchParams.get('sslmode') === 'require',
          },
        });
      } catch {}
    }
    if (!envVars.DATABASE_URL && envVars.PG_HOST) {
      detected.push({
        type: 'POSTGRESQL',
        name: 'Database (auto-detected)',
        config: {
          host: envVars.PG_HOST,
          port: parseInt(envVars.PG_PORT || '5432'),
          database: envVars.PG_DATABASE || 'postgres',
          user: envVars.PG_USER || 'postgres',
          password: envVars.PG_PASSWORD || '',
        },
      });
    }
    if (!envVars.DATABASE_URL && !envVars.PG_HOST && envVars.POSTGRES_HOST) {
      detected.push({
        type: 'POSTGRESQL',
        name: 'Database (auto-detected)',
        config: {
          host: envVars.POSTGRES_HOST,
          port: parseInt(envVars.POSTGRES_PORT || '5432'),
          database: envVars.POSTGRES_DB || 'postgres',
          user: envVars.POSTGRES_USER || 'postgres',
          password: envVars.POSTGRES_PASSWORD || '',
        },
      });
    }

    if (envVars.REDIS_URL) {
      try {
        const url = new URL(envVars.REDIS_URL);
        detected.push({
          type: 'REDIS',
          name: 'Redis (auto-detected)',
          config: {
            host: url.hostname,
            port: parseInt(url.port) || 6379,
            password: url.password || undefined,
            db: parseInt(url.pathname.slice(1)) || 0,
          },
        });
      } catch {}
    }
    if (!envVars.REDIS_URL && envVars.REDIS_HOST) {
      detected.push({
        type: 'REDIS',
        name: 'Redis (auto-detected)',
        config: {
          host: envVars.REDIS_HOST,
          port: parseInt(envVars.REDIS_PORT || '6379'),
          password: envVars.REDIS_PASSWORD || undefined,
          db: parseInt(envVars.REDIS_DB || '0'),
        },
      });
    }

    if (envVars.MINIO_ENDPOINT && envVars.MINIO_ACCESS_KEY && envVars.MINIO_SECRET_KEY) {
      const endpoint = envVars.MINIO_ENDPOINT.replace(/^https?:\/\//, '');
      detected.push({
        type: 'MINIO',
        name: 'Storage (auto-detected)',
        config: {
          endPoint: endpoint.split(':')[0],
          port: parseInt(endpoint.split(':')[1] || (envVars.MINIO_USE_SSL === 'true' ? '443' : '9000')),
          accessKey: envVars.MINIO_ACCESS_KEY,
          secretKey: envVars.MINIO_SECRET_KEY,
          useSSL: envVars.MINIO_USE_SSL === 'true',
        },
      });
    }
    if (envVars.S3_ENDPOINT && envVars.AWS_ACCESS_KEY_ID && envVars.AWS_SECRET_ACCESS_KEY) {
      const endpoint = envVars.S3_ENDPOINT.replace(/^https?:\/\//, '');
      detected.push({
        type: 'MINIO',
        name: 'S3 Storage (auto-detected)',
        config: {
          endPoint: endpoint.split(':')[0],
          port: parseInt(endpoint.split(':')[1] || '9000'),
          accessKey: envVars.AWS_ACCESS_KEY_ID,
          secretKey: envVars.AWS_SECRET_ACCESS_KEY,
          useSSL: envVars.S3_ENDPOINT.startsWith('https'),
        },
      });
    }

    return detected;
  }

  async detectAndSave(projectId: string) {
    const detected = await this.detect(projectId);
    const results: any[] = [];

    for (const item of detected) {
      const existing = await this.prisma.serviceConnection.findFirst({
        where: { projectId, type: item.type as any },
      });
      if (existing) continue;

      const created = await this.prisma.serviceConnection.create({
        data: {
          projectId,
          type: item.type as any,
          name: item.name,
          config: this.encryption.encrypt(JSON.stringify(item.config)),
          autoDetected: true,
        },
      });
      results.push(created);
    }

    return results;
  }

  async testConnection(id: string) {
    const service = await this.prisma.serviceConnection.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Service connection not found');

    const config = this.getDecryptedConfig(service);

    try {
      if (service.type === 'POSTGRESQL') {
        const pool = this.pool.getPgPool(id, config);
        await pool.query('SELECT 1');
        return { success: true, message: 'Connected successfully' };
      }

      if (service.type === 'REDIS') {
        const client = this.pool.getRedisClient(id, config);
        await client.connect();
        await client.ping();
        return { success: true, message: 'Connected successfully' };
      }

      if (service.type === 'MINIO') {
        const client = this.pool.getMinioClient(id, config);
        await client.listBuckets();
        return { success: true, message: 'Connected successfully' };
      }

      return { success: false, message: 'Unknown service type' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}
