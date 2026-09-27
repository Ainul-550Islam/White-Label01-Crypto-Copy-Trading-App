import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import Redis, { type RedisOptions } from 'ioredis';

import { AppConfigService } from '../../config/app-config.service';

/**
 * Owns the Redis connections used by the API process.
 *
 * Three logical clients are exposed because ioredis puts a connection into
 * subscriber mode permanently once it subscribes: mixing that with regular
 * commands (or with BullMQ's blocking calls) breaks in subtle ways under load.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly commandClient: Redis;
  private readonly subscriberClient: Redis;
  private readonly publisherClient: Redis;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    const options = this.buildOptions();
    this.commandClient = new Redis(options);
    this.subscriberClient = new Redis({ ...options, lazyConnect: true });
    this.publisherClient = new Redis({ ...options, lazyConnect: true });

    this.attachHandlers(this.commandClient, 'command');
    this.attachHandlers(this.subscriberClient, 'subscriber');
    this.attachHandlers(this.publisherClient, 'publisher');
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.subscriberClient.connect(), this.publisherClient.connect()]);
    await this.commandClient.ping();
    this.logger.info({ event: 'redis.connected' }, 'Redis connections established');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.commandClient.quit(),
      this.subscriberClient.quit(),
      this.publisherClient.quit(),
    ]);
    this.logger.info({ event: 'redis.disconnected' }, 'Redis connections closed');
  }

  get client(): Redis {
    return this.commandClient;
  }

  get subscriber(): Redis {
    return this.subscriberClient;
  }

  get publisher(): Redis {
    return this.publisherClient;
  }

  /** Fresh duplicate used by components that need their own connection. */
  duplicate(): Redis {
    return this.commandClient.duplicate();
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    const response = await this.commandClient.ping();
    return { ok: response === 'PONG', latencyMs: Date.now() - startedAt };
  }

  /**
   * Best-effort distributed lock (single-node Redlock variant).
   * Returns the release function, or null when the lock is already held.
   */
  async acquireLock(
    key: string,
    ttlMs: number,
    token: string,
  ): Promise<(() => Promise<void>) | null> {
    const lockKey = `lock:${key}`;
    const acquired = await this.commandClient.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') {
      return null;
    }

    return async () => {
      // Only the owner may release the lock.
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.commandClient.eval(script, 1, lockKey, token);
    };
  }

  private buildOptions(): RedisOptions {
    const options = this.config.redisOptions;
    return {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      keyPrefix: options.keyPrefix,
      tls: options.tls,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10_000,
      retryStrategy: (times: number) => Math.min(times * 200, 5_000),
      reconnectOnError: (error: Error) => error.message.includes('READONLY'),
    };
  }

  private attachHandlers(client: Redis, role: string): void {
    client.on('error', (error: Error) => {
      this.logger.error({ event: 'redis.error', role, message: error.message }, 'Redis error');
    });
    client.on('reconnecting', () => {
      this.logger.warn({ event: 'redis.reconnecting', role }, 'Redis reconnecting');
    });
    client.on('end', () => {
      this.logger.warn({ event: 'redis.closed', role }, 'Redis connection closed');
    });
  }
}
