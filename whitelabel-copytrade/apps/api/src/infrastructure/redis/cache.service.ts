import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { RedisService } from './redis.service';

/**
 * Typed JSON cache with stampede protection.
 *
 * `remember()` is the primary entry point: it serves a cached value when
 * present and otherwise computes it under a short lock so a cold key cannot
 * trigger hundreds of identical database queries during a traffic spike.
 */
@Injectable()
export class CacheService {
  constructor(
    private readonly redis: RedisService,
    @InjectPinoLogger(CacheService.name) private readonly logger: PinoLogger,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(
        { event: 'cache.read_failed', key, message: (error as Error).message },
        'Cache read failed; falling through to source of truth',
      );
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        { event: 'cache.write_failed', key, message: (error as Error).message },
        'Cache write failed',
      );
    }
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    try {
      await this.redis.client.del(...keys);
    } catch (error) {
      this.logger.warn(
        { event: 'cache.delete_failed', keys, message: (error as Error).message },
        'Cache delete failed',
      );
    }
  }

  /**
   * Deletes every key matching a pattern using SCAN (never KEYS, which blocks
   * the Redis event loop on large keyspaces).
   */
  async deleteByPattern(pattern: string): Promise<number> {
    const prefixed = `${this.redis.client.options.keyPrefix ?? ''}${pattern}`;
    let cursor = '0';
    let removed = 0;

    do {
      const [nextCursor, keys] = await this.redis.client.scan(
        cursor,
        'MATCH',
        prefixed,
        'COUNT',
        200,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        // SCAN returns fully-qualified keys, but DEL re-applies the prefix.
        const unprefixed = keys.map((key) =>
          key.startsWith(this.redis.client.options.keyPrefix ?? '')
            ? key.slice((this.redis.client.options.keyPrefix ?? '').length)
            : key,
        );
        removed += await this.redis.client.del(...unprefixed);
      }
    } while (cursor !== '0');

    return removed;
  }

  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const lockToken = `${process.pid}-${Date.now()}-${Math.random()}`;
    const release = await this.redis.acquireLock(`cache:${key}`, 5_000, lockToken);

    if (!release) {
      // Another worker is computing the value; wait briefly then re-read.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const retried = await this.get<T>(key);
      if (retried !== null) {
        return retried;
      }
      return factory();
    }

    try {
      const value = await factory();
      await this.set(key, value, ttlSeconds);
      return value;
    } finally {
      await release();
    }
  }

  /** Atomic counter used for quota style checks. */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    return this.incrementBy(key, 1, ttlSeconds);
  }

  /**
   * Adds `amount` to the key and returns the new value, in one round trip.
   *
   * INCRBY rather than read-modify-write: two callers reserving the same budget concurrently must see
   * each other's reservations, and a read followed by a write cannot promise that. A negative amount
   * is returned as charged, so a caller that reserved more than it is allowed to spend can hand the
   * difference back. The expiry is set with NX inside the same MULTI, so it is applied once, on the
   * first increment only, and never extends the window on later hits.
   *
   * This method does not swallow Redis errors. A caller that cannot reserve a budget has not
   * reserved it, and only the caller knows whether that is a reason to proceed.
   */
  async incrementBy(key: string, amount: number, ttlSeconds: number): Promise<number> {
    if (!Number.isInteger(amount)) {
      throw new Error(`cache.incrementBy requires an integer amount, received ${amount}`);
    }
    const pipeline = this.redis.client.multi();
    pipeline.incrby(key, amount);
    pipeline.expire(key, ttlSeconds, 'NX');
    const results = await pipeline.exec();
    return Number(results?.[0]?.[1] ?? 0);
  }
}
