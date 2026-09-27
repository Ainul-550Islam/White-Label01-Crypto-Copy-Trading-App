import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { ServerOptions, Server } from 'socket.io';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

/**
 * Socket.IO adapter backed by Redis.
 *
 * Without this, a message emitted on API node A never reaches a socket held by
 * node B, so any horizontally scaled deployment silently loses events. The
 * adapter needs two *dedicated* connections (one permanently in subscriber
 * mode), so we duplicate rather than reuse the shared command client.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    if (!this.config.wsRedisAdapterEnabled) {
      return;
    }

    this.pubClient = this.redis.duplicate();
    this.subClient = this.redis.duplicate();

    await Promise.all([this.pubClient.ping(), this.subClient.ping()]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient, {
      key: `${this.config.redisKeyPrefix}socket.io`,
    });
  }

  override async close(): Promise<void> {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: this.config.wsPath,
      pingInterval: this.config.wsPingIntervalMs,
      pingTimeout: this.config.wsPingTimeoutMs,
      // Sockets are authenticated by the gateway, but CORS still has to allow
      // the tenant's own front-end origins.
      cors: {
        origin: this.config.corsOriginValidator,
        credentials: this.config.corsCredentials,
      },
      // A handshake that has not authenticated within this window is dropped.
      connectTimeout: 20_000,
      maxHttpBufferSize: 1_000_000,
    }) as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
