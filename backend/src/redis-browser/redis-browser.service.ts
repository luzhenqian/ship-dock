import { Injectable, BadRequestException } from '@nestjs/common';
import { ServicesService } from '../services/services.service';
import { ConnectionPoolService } from '../services/connection-pool.service';

const BLOCKED_COMMANDS = new Set([
  'FLUSHALL', 'FLUSHDB', 'CONFIG', 'SHUTDOWN', 'DEBUG',
  'SLAVEOF', 'REPLICAOF', 'CLUSTER', 'KEYS',
]);

@Injectable()
export class RedisBrowserService {
  constructor(
    private servicesService: ServicesService,
    private pool: ConnectionPoolService,
  ) {}

  private async getClient(projectId: string) {
    const { service, config } = await this.servicesService.getServiceWithConfig(projectId, 'REDIS');
    const client = this.pool.getRedisClient(service.id, config);
    if (client.status === 'wait') await client.connect();
    return client;
  }

  async scanKeys(projectId: string, pattern: string = '*', cursor: string = '0', count: number = 50) {
    const client = await this.getClient(projectId);
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', count);

    const pipeline = client.pipeline();
    for (const key of keys) {
      pipeline.type(key);
    }
    const types = await pipeline.exec();

    const items = keys.map((key, i) => ({
      key,
      type: types?.[i]?.[1] as string || 'unknown',
    }));

    return { cursor: nextCursor, keys: items, done: nextCursor === '0' };
  }

  async getKeyDetail(projectId: string, key: string) {
    const client = await this.getClient(projectId);
    const type = await client.type(key);
    const ttl = await client.ttl(key);

    let value: any;
    let size: number;

    switch (type) {
      case 'string': {
        value = await client.get(key);
        size = await client.strlen(key);
        break;
      }
      case 'hash': {
        value = await client.hgetall(key);
        size = await client.hlen(key);
        break;
      }
      case 'list': {
        value = await client.lrange(key, 0, 99);
        size = await client.llen(key);
        break;
      }
      case 'set': {
        value = await client.smembers(key);
        size = await client.scard(key);
        break;
      }
      case 'zset': {
        value = await client.zrange(key, 0, 99, 'WITHSCORES');
        size = await client.zcard(key);
        break;
      }
      default:
        value = null;
        size = 0;
    }

    return { key, type, ttl, size, value };
  }

  async createKey(projectId: string, data: { key: string; type: string; value: any; ttl?: number }) {
    const client = await this.getClient(projectId);

    switch (data.type) {
      case 'string':
        await client.set(data.key, data.value);
        break;
      case 'hash':
        await client.hmset(data.key, data.value);
        break;
      case 'list':
        await client.rpush(data.key, ...data.value);
        break;
      case 'set':
        await client.sadd(data.key, ...data.value);
        break;
      default:
        throw new BadRequestException(`Unsupported type: ${data.type}`);
    }

    if (data.ttl && data.ttl > 0) {
      await client.expire(data.key, data.ttl);
    }

    return { success: true };
  }

  async updateKey(projectId: string, key: string, value: any, ttl?: number) {
    const client = await this.getClient(projectId);
    const type = await client.type(key);

    switch (type) {
      case 'string':
        await client.set(key, value);
        break;
      case 'hash':
        await client.del(key);
        await client.hmset(key, value);
        break;
      case 'list':
        await client.del(key);
        await client.rpush(key, ...value);
        break;
      case 'set':
        await client.del(key);
        await client.sadd(key, ...value);
        break;
      default:
        throw new BadRequestException(`Cannot update type: ${type}`);
    }

    if (ttl !== undefined && ttl > 0) {
      await client.expire(key, ttl);
    }

    return { success: true };
  }

  async deleteKey(projectId: string, key: string) {
    const client = await this.getClient(projectId);
    await client.del(key);
    return { success: true };
  }

  async executeCommand(projectId: string, command: string) {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toUpperCase();

    if (BLOCKED_COMMANDS.has(cmd)) {
      throw new BadRequestException(`Command "${cmd}" is not allowed. Blocked commands: ${Array.from(BLOCKED_COMMANDS).join(', ')}`);
    }

    const client = await this.getClient(projectId);
    const result = await (client as any).call(cmd, ...parts.slice(1));
    return { result };
  }
}
