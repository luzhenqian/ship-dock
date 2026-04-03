import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import * as Minio from 'minio';

interface PoolEntry<T> {
  client: T;
  lastUsed: number;
}

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class ConnectionPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionPoolService.name);
  private pgPools = new Map<string, PoolEntry<Pool>>();
  private redisClients = new Map<string, PoolEntry<Redis>>();
  private minioClients = new Map<string, PoolEntry<Minio.Client>>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupIdle(), 60_000);
  }

  getPgPool(connectionId: string, config: { host: string; port: number; database: string; user: string; password: string; ssl?: boolean }): Pool {
    const entry = this.pgPools.get(connectionId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: IDLE_TIMEOUT,
    });

    this.pgPools.set(connectionId, { client: pool, lastUsed: Date.now() });
    return pool;
  }

  getRedisClient(connectionId: string, config: { host: string; port: number; password?: string; db?: number }): Redis {
    const entry = this.redisClients.get(connectionId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    const client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password || undefined,
      db: config.db || 0,
      lazyConnect: true,
    });

    this.redisClients.set(connectionId, { client, lastUsed: Date.now() });
    return client;
  }

  getMinioClient(connectionId: string, config: { endPoint: string; port: number; accessKey: string; secretKey: string; useSSL?: boolean }): Minio.Client {
    const entry = this.minioClients.get(connectionId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    const client = new Minio.Client({
      endPoint: config.endPoint,
      port: config.port,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      useSSL: config.useSSL ?? false,
    });

    this.minioClients.set(connectionId, { client, lastUsed: Date.now() });
    return client;
  }

  async removeConnection(connectionId: string) {
    const pg = this.pgPools.get(connectionId);
    if (pg) { await pg.client.end(); this.pgPools.delete(connectionId); }

    const redis = this.redisClients.get(connectionId);
    if (redis) { redis.client.disconnect(); this.redisClients.delete(connectionId); }

    this.minioClients.delete(connectionId);
  }

  private async cleanupIdle() {
    const now = Date.now();

    for (const [id, entry] of this.pgPools) {
      if (now - entry.lastUsed > IDLE_TIMEOUT) {
        this.logger.debug(`Closing idle PG pool: ${id}`);
        await entry.client.end();
        this.pgPools.delete(id);
      }
    }

    for (const [id, entry] of this.redisClients) {
      if (now - entry.lastUsed > IDLE_TIMEOUT) {
        this.logger.debug(`Closing idle Redis client: ${id}`);
        entry.client.disconnect();
        this.redisClients.delete(id);
      }
    }

    for (const [id, entry] of this.minioClients) {
      if (now - entry.lastUsed > IDLE_TIMEOUT) {
        this.logger.debug(`Removing idle MinIO client: ${id}`);
        this.minioClients.delete(id);
      }
    }
  }

  async onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    for (const [, entry] of this.pgPools) await entry.client.end();
    for (const [, entry] of this.redisClients) entry.client.disconnect();
    this.pgPools.clear();
    this.redisClients.clear();
    this.minioClients.clear();
  }
}
