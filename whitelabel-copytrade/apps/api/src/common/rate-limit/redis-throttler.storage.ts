import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { RedisService } from '../../infrastructure/redis/redis.service';

/**
 * Redis backed sliding-window counter for @nestjs/throttler.
 *
 * The increment and the TTL are applied in one round trip; the block key is a
 * separate short-lived entry so a blocked caller stays blocked even if their
 * window counter expires.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.client;
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;

    const blockTtl = await client.pttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockTtl / 1000),
      };
    }

    const pipeline = client.multi();
    pipeline.incr(counterKey);
    pipeline.pttl(counterKey);
    const results = await pipeline.exec();

    const totalHits = Number(results?.[0]?.[1] ?? 1);
    let remainingTtl = Number(results?.[1]?.[1] ?? -1);

    if (remainingTtl < 0) {
      await client.pexpire(counterKey, ttl);
      remainingTtl = ttl;
    }

    if (totalHits > limit) {
      const effectiveBlock = blockDuration > 0 ? blockDuration : ttl;
      await client.set(blockKey, '1', 'PX', effectiveBlock);
      return {
        totalHits,
        timeToExpire: Math.ceil(remainingTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(effectiveBlock / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(remainingTtl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
