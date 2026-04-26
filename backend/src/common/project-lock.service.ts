import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

interface WithLockOptions {
  /**
   * Lock TTL — Redis auto-expires the key after this duration so a crashed holder
   * doesn't leak the lock forever. Pick a value comfortably greater than the longest
   * expected duration of `fn`. If `fn` exceeds the TTL, a second waiter may acquire
   * the lock concurrently. Default: 60 minutes.
   */
  ttlMs?: number;
  maxWaitMs?: number;    // total time to wait for the lock (default 1h)
  retryDelayMs?: number; // poll interval while waiting (default 500)
}

@Injectable()
export class ProjectLockService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
      lazyConnect: true,
    });
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit();
  }

  private key(projectId: string) {
    return `project-lock:${projectId}`;
  }

  async acquire(projectId: string, ttlMs = 60 * 60 * 1000): Promise<string | null> {
    const token = randomUUID();
    const result = await this.client.set(this.key(projectId), token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(projectId: string, token: string): Promise<void> {
    await this.client.eval(RELEASE_SCRIPT, 1, this.key(projectId), token);
  }

  async withLock<T>(
    projectId: string,
    fn: () => Promise<T>,
    opts: WithLockOptions = {},
  ): Promise<T> {
    const ttl = opts.ttlMs ?? 60 * 60 * 1000;
    const maxWait = opts.maxWaitMs ?? 60 * 60 * 1000;
    const retry = opts.retryDelayMs ?? 500;
    const deadline = Date.now() + maxWait;

    let token: string | null = null;
    while (token === null) {
      token = await this.acquire(projectId, ttl);
      if (token) break;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for project lock ${projectId}`);
      }
      await new Promise((r) => setTimeout(r, retry));
    }

    try {
      return await fn();
    } finally {
      await this.release(projectId, token);
    }
  }
}
