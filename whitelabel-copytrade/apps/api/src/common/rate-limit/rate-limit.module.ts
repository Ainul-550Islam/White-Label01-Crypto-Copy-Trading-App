import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Distributed rate limiting.
 *
 * Counters live in Redis so the limit is enforced across every API replica -
 * an in-memory limiter would let an attacker multiply their allowance by the
 * number of pods behind the load balancer.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, RedisService],
      useFactory: (config: AppConfigService, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimitTtlSeconds * 1000,
            limit: config.rateLimitEnabled ? config.rateLimitMax : Number.MAX_SAFE_INTEGER,
          },
          {
            name: 'auth',
            ttl: config.rateLimitAuthTtlSeconds * 1000,
            limit: config.rateLimitEnabled ? config.rateLimitAuthMax : Number.MAX_SAFE_INTEGER,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
        // Health probes and internal traffic bypass the limiter.
        skipIf: (context) => {
          const request = context.switchToHttp().getRequest<{ path?: string; ip?: string }>();
          const path = request?.path ?? '';
          if (path.startsWith('/health')) {
            return true;
          }
          return false;
        },
        errorMessage: 'Too many requests. Please slow down and try again shortly.',
      }),
    }),
  ],
  providers: [RedisThrottlerStorage],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
