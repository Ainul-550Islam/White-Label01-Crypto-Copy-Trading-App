import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { ReserveUsageResult } from './usage.types';

const COUNTER_KEY_PREFIX = 'counter';
const COUNTER_TTL_SECONDS = 300;

/**
 * Atomic counter utilities for quota enforcement.
 *
 * Critical requirement: CHECK + LIMIT VALIDATION + INCREMENT/RESERVATION
 * must be atomic to prevent race-condition over-allocation when multiple
 * concurrent requests attempt to create the same resource type.
 *
 * All operations use Lua scripts executed atomically by Redis, so the
 * read-compare-write cycle is never interleaved with another client.
 */
@Injectable()
export class UsageCounter {
  constructor(
    private readonly redis: RedisService,
    @InjectPinoLogger(UsageCounter.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Atomically check the current count against the maximum and increment only
   * when capacity remains.  Returns whether the reservation succeeded.
   *
   * This is the primary primitive for concurrency-safe quota enforcement.
   */
  async atomicCheckAndIncrement(params: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
    maximum: number;
    amount?: number;
  }): Promise<ReserveUsageResult> {
    const key = this.buildKey(params.tenantId, params.limitKey, params.scopeId);
    const amount = params.amount ?? 1;
    const maximum = params.maximum;

    try {
      // Lua script: atomic read → compare → increment
      const script = `
        local key = KEYS[1]
        local max = tonumber(ARGV[1])
        local amount = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        local current = tonumber(redis.call("GET", key) or "0")
        if current + amount > max then
          return {0, current, max, math.max(0, max - current)}
        end
        local new_val = redis.call("INCRBY", key, amount)
        redis.call("EXPIRE", key, ttl)
        return {1, new_val, max, math.max(0, max - new_val)}
      `;

      const result = await this.redis.client.eval(
        script,
        1,
        key,
        maximum,
        amount,
        COUNTER_TTL_SECONDS,
      );
      const [reserved, currentAfter, maxVal, remaining] = result as number[];

      return {
        reserved: reserved === 1,
        currentAfter,
        maximum: maxVal,
        remaining,
      };
    } catch (error) {
      this.logger.error(
        { event: 'counter.check_and_increment_failed', key, message: (error as Error).message },
        'Atomic check-and-increment failed',
      );
      return { reserved: false, currentAfter: -1, maximum, remaining: 0 };
    }
  }

  /**
   * Atomically decrement a counter.  Clamps at 0 to prevent negative values.
   */
  async atomicDecrement(params: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
    amount?: number;
  }): Promise<number> {
    const key = this.buildKey(params.tenantId, params.limitKey, params.scopeId);
    const amount = params.amount ?? 1;

    try {
      const script = `
        local key = KEYS[1]
        local amount = tonumber(ARGV[1])
        local current = tonumber(redis.call("GET", key) or "0")
        local new_val = math.max(0, current - amount)
        if new_val == 0 then
          redis.call("DEL", key)
        else
          redis.call("SET", key, new_val)
          redis.call("EXPIRE", key, tonumber(ARGV[2]))
        end
        return new_val
      `;

      const result = await this.redis.client.eval(script, 1, key, amount, COUNTER_TTL_SECONDS);
      return Number(result);
    } catch (error) {
      this.logger.error(
        { event: 'counter.decrement_failed', key, message: (error as Error).message },
        'Atomic decrement failed',
      );
      return -1;
    }
  }

  /**
   * Read the current counter value without modifying it.
   */
  async read(params: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
  }): Promise<number> {
    const key = this.buildKey(params.tenantId, params.limitKey, params.scopeId);
    try {
      const raw = await this.redis.client.get(key);
      return raw ? Math.max(0, parseInt(raw, 10)) : 0;
    } catch (error) {
      this.logger.error(
        { event: 'counter.read_failed', key, message: (error as Error).message },
        'Counter read failed',
      );
      return 0;
    }
  }

  /**
   * Reset a counter to zero.
   *
   * Used when a quota period rolls over (e.g. the end of a billing cycle) or
   * when an administrative action clears a usage record.
   */
  async reset(params: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
  }): Promise<void> {
    const key = this.buildKey(params.tenantId, params.limitKey, params.scopeId);
    try {
      await this.redis.client.del(key);
    } catch (error) {
      this.logger.error(
        { event: 'counter.reset_failed', key, message: (error as Error).message },
        'Counter reset failed',
      );
    }
  }

  /**
   * Atomic reserve-then-release pattern for idempotent operations.
   *
   * When a retried request arrives with the same idempotency key, this method
   * checks whether the reservation was already counted and skips the increment
   * if so.  This prevents double-counting quota for retried creation requests.
   */
  async atomicReserveIdempotent(params: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
    idempotencyKey: string;
    maximum: number;
    amount?: number;
  }): Promise<ReserveUsageResult & { alreadyCounted: boolean }> {
    const counterKey = this.buildKey(params.tenantId, params.limitKey, params.scopeId);
    const idempotencyKey = this.buildIdempotencyKey(params.tenantId, params.limitKey, params.idempotencyKey);
    const amount = params.amount ?? 1;
    const maximum = params.maximum;

    try {
      // Lua: check idempotency key first; if present, skip.  Otherwise
      // check-and-increment and set the idempotency key.
      const script = `
        local counter_key = KEYS[1]
        local idempotency_key = KEYS[2]
        local max = tonumber(ARGV[1])
        local amount = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        local idempotency_ttl = tonumber(ARGV[4])

        -- Check idempotency
        if redis.call("EXISTS", idempotency_key) == 1 then
          local current = tonumber(redis.call("GET", counter_key) or "0")
          return {1, current, max, math.max(0, max - current), 1}
        end

        -- Atomic check and increment
        local current = tonumber(redis.call("GET", counter_key) or "0")
        if current + amount > max then
          return {0, current, max, math.max(0, max - current), 0}
        end

        local new_val = redis.call("INCRBY", counter_key, amount)
        redis.call("EXPIRE", counter_key, ttl)
        redis.call("SETEX", idempotency_key, idempotency_ttl, "1")
        return {1, new_val, max, math.max(0, max - new_val), 0}
      `;

      const result = await this.redis.client.eval(
        script,
        2,
        counterKey,
        idempotencyKey,
        maximum,
        amount,
        COUNTER_TTL_SECONDS,
        600, // idempotency key TTL
      );

      const [reserved, currentAfter, maxVal, remaining, alreadyCounted] = result as number[];

      return {
        reserved: reserved === 1,
        currentAfter,
        maximum: maxVal,
        remaining,
        alreadyCounted: alreadyCounted === 1,
      };
    } catch (error) {
      this.logger.error(
        { event: 'counter.reserve_idempotent_failed', counterKey, message: (error as Error).message },
        'Atomic reserve-idempotent failed',
      );
      return { reserved: false, currentAfter: -1, maximum, remaining: 0, alreadyCounted: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Key builders
  // ---------------------------------------------------------------------------

  private buildKey(tenantId: string, limitKey: string, scopeId: string): string {
    return `${COUNTER_KEY_PREFIX}:${tenantId}:${limitKey}:${scopeId}`;
  }

  private buildIdempotencyKey(tenantId: string, limitKey: string, idempotencyKey: string): string {
    return `${COUNTER_KEY_PREFIX}:idem:${tenantId}:${limitKey}:${idempotencyKey}`;
  }
}
