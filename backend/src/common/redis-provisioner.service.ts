import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from './prisma.service';

@Injectable()
export class RedisProvisionerService {
  private readonly logger = new Logger(RedisProvisionerService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  /**
   * Find the next available Redis database index.
   * DB 0 is reserved for Ship Dock itself; project DBs start at 1.
   */
  async allocateDbIndex(): Promise<number> {
    const result = await this.prisma.project.aggregate({
      _max: { redisDbIndex: true },
      where: { useLocalRedis: true },
    });
    return (result._max.redisDbIndex ?? 0) + 1;
  }

  /**
   * Provision a Redis database for a project.
   * Verifies the database is accessible, returns the REDIS_URL.
   */
  async provision(dbIndex: number): Promise<{ dbIndex: number; redisUrl: string }> {
    const { host, port, password } = this.getConnectionConfig();
    const client = new Redis({ host, port, password, db: dbIndex, lazyConnect: true });

    try {
      await client.connect();
      // Verify we can SELECT into this database
      await client.select(dbIndex);
      this.logger.log(`Provisioned Redis db ${dbIndex}`);
    } finally {
      await client.quit();
    }

    const redisUrl = password
      ? `redis://:${encodeURIComponent(password)}@${host}:${port}/${dbIndex}`
      : `redis://${host}:${port}/${dbIndex}`;

    return { dbIndex, redisUrl };
  }

  /**
   * Flush and release a Redis database.
   */
  async deprovision(dbIndex: number): Promise<void> {
    const { host, port, password } = this.getConnectionConfig();
    const client = new Redis({ host, port, password, db: dbIndex, lazyConnect: true });

    try {
      await client.connect();
      await client.flushdb();
      this.logger.log(`Deprovisioned Redis db ${dbIndex} (flushed)`);
    } finally {
      await client.quit();
    }
  }

  private getConnectionConfig(): { host: string; port: number; password: string | undefined } {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      const url = new URL(redisUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        password: url.password || undefined,
      };
    }
    return {
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD'),
    };
  }
}
