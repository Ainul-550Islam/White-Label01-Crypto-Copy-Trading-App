import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  DecrementUsageInput,
  IncrementUsageInput,
  ReserveUsageResult,
  UsageRecord,
} from './usage.types';

const USAGE_KEY_PREFIX = 'usage';
const DEFAULT_WINDOW_TTL_SECONDS = 120;

/**
 * Persistence abstraction for usage counters.
 *
 * Counters are stored in Redis for atomic increment/decrement operations and
 * fast reads.  The repository hides the Redis commands behind a clean
 * domain-oriented interface.
 *
 * Key schema:
 *   usage:{tenantId}:{limitKey}:{scopeId}
 *
 * For rate limits with a window:
 *   usage:{tenantId}:{limitKey}:{scopeId}:{windowEpoch}
 */
@Injectable()
export class UsageRepository {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(UsageRepository.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Read the current usage counter value.  Returns 0 when no key exists. */
  async getCurrent(input: { tenantId: string; limitKey: string; scopeId: string }): Promise<number> {
    const key = this.buildKey(input.tenantId, input.limitKey, input.scopeId);
    try {
      const raw = await this.redis.client.get(key);
      return raw ? parseInt(raw, 10) : 0;
    } catch (error) {
      this.logger.error(
        { event: 'usage.read_failed', key, message: (error as Error).message },
        'Failed to read usage counter',
      );
      return 0;
    }
  }

  /** Read a windowed counter (for rate limits). */
  async getWindowedCurrent(input: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
    windowEpoch: number;
  }): Promise<number> {
    const key = this.buildWindowedKey(input.tenantId, input.limitKey, input.scopeId, input.windowEpoch);
    try {
      const raw = await this.redis.client.get(key);
      return raw ? parseInt(raw, 10) : 0;
    } catch (error) {
      this.logger.error(
        { event: 'usage.read_failed', key, message: (error as Error).message },
        'Failed to read windowed usage counter',
      );
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Increment / Decrement
  // ---------------------------------------------------------------------------

  /** Atomically increment a usage counter.  Returns the new value. */
  async increment(input: IncrementUsageInput): Promise<number> {
    const key = this.buildKey(input.tenantId, input.limitKey, input.scopeId);
    const amount = input.amount ?? 1;
    try {
      const pipeline = this.redis.client.multi();
      pipeline.incrby(key, amount);
      pipeline.expire(key, DEFAULT_WINDOW_TTL_SECONDS, 'NX');
      const results = await pipeline.exec();
      return Number(results?.[0]?.[1] ?? 0);
    } catch (error) {
      this.logger.error(
        { event: 'usage.increment_failed', key, message: (error as Error).message },
        'Failed to increment usage counter',
      );
      return -1;
    }
  }

  /** Atomically decrement a usage counter.  Clamps at 0. */
  async decrement(input: DecrementUsageInput): Promise<number> {
    const key = this.buildKey(input.tenantId, input.limitKey, input.scopeId);
    const amount = input.amount ?? 1;
    try {
      // DECRBY can go negative; clamp to 0 with a Lua script.
      const script = `
        local current = redis.call("GET", KEYS[1])
        if not current then return 0 end
        local val = tonumber(current) - tonumber(ARGV[1])
        if val < 0 then val = 0 end
        redis.call("SET", KEYS[1], val)
        return val
      `;
      const result = await this.redis.client.eval(script, 1, key, amount);
      return Number(result);
    } catch (error) {
      this.logger.error(
        { event: 'usage.decrement_failed', key, message: (error as Error).message },
        'Failed to decrement usage counter',
      );
      return -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Atomic reserve / release (for concurrency-safe quota enforcement)
  // ---------------------------------------------------------------------------

  /**
   * Atomically check the current count against the maximum and increment only
   * when capacity remains.  This is the core primitive that prevents
   * race-condition over-allocation.
   *
   * Returns whether the reservation succeeded and the new counts.
   */
  async atomicReserve(input: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
    maximum: number;
    amount: number;
  }): Promise<ReserveUsageResult> {
    const key = this.buildKey(input.tenantId, input.limitKey, input.scopeId);
    const { maximum, amount } = input;

    try {
      // Lua script: read current, check against max, increment if allowed.
      const script = `
        local current = tonumber(redis.call("GET", KEYS[1]) or "0")
        local max = tonumber(ARGV[1])
        local amount = tonumber(ARGV[2])
        if current + amount > max then
          return {0, current, max, max - current}
        end
        local new_val = redis.call("INCRBY", KEYS[1], amount)
        redis.call("EXPIRE", KEYS[1], ${DEFAULT_WINDOW_TTL_SECONDS})
        return {1, new_val, max, max - new_val}
      `;
      const result = await this.redis.client.eval(script, 1, key, maximum, amount);
      const [reserved, currentAfter, maxVal, remaining] = result as number[];

      return {
        reserved: reserved === 1,
        currentAfter,
        maximum: maxVal,
        remaining: Math.max(0, remaining),
      };
    } catch (error) {
      this.logger.error(
        { event: 'usage.reserve_failed', key, message: (error as Error).message },
        'Failed to atomic reserve usage',
      );
      return { reserved: false, currentAfter: -1, maximum, remaining: 0 };
    }
  }

  /**
   * Release a previously reserved slot.
   *
   * Called when a creation fails after the reservation was granted, so the
   * counter does not permanently leak.
   */
  async release(input: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
    amount: number;
  }): Promise<number> {
    return this.decrement({
      tenantId: input.tenantId,
      limitKey: input.limitKey,
      scope: 'TENANT' as any,
      scopeId: input.scopeId,
      amount: input.amount,
    });
  }

  // ---------------------------------------------------------------------------
  // Windowed counters for rate limits
  // ---------------------------------------------------------------------------

  /**
   * Atomically increment a windowed counter and return the new value.
   * The key automatically expires at the end of the window.
   */
  async incrementWindowed(input: {
    tenantId: string;
    limitKey: string;
    scopeId: string;
    windowEpoch: number;
    windowTtlSeconds: number;
    amount?: number;
  }): Promise<number> {
    const key = this.buildWindowedKey(
      input.tenantId,
      input.limitKey,
      input.scopeId,
      input.windowEpoch,
    );
    const amount = input.amount ?? 1;
    try {
      const pipeline = this.redis.client.multi();
      pipeline.incrby(key, amount);
      pipeline.expire(key, input.windowTtlSeconds, 'NX');
      const results = await pipeline.exec();
      return Number(results?.[0]?.[1] ?? 0);
    } catch (error) {
      this.logger.error(
        { event: 'usage.increment_windowed_failed', key, message: (error as Error).message },
        'Failed to increment windowed usage counter',
      );
      return -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Database-sourced counts (for resources persisted in Postgres)
  // ---------------------------------------------------------------------------

  /** Count active users for a tenant. */
  async countActiveUsers(tenantId: string): Promise<number> {
    return this.prisma.user.count({
      where: { tenantId, deletedAt: null },
    });
  }

  /** Count active traders for a tenant. */
  async countActiveTraders(tenantId: string): Promise<number> {
    return this.prisma.tradingAccount.count({
      // deletedAt: null is the soft-delete filter; TradingAccountStatus has
    // no DELETED member, so the previous `status: { not: 'DELETED' }`
    // predicate named a state that cannot exist.
      where: { tenantId, deletedAt: null },
    });
  }

  /** Count followers for a specific trader. */
  async countFollowersForTrader(tenantId: string, traderId: string): Promise<number> {
    return this.prisma.copySubscription.count({
      where: { tenantId, traderId, state: 'ACTIVE' },
    });
  }

  /** Count exchange accounts for a specific user. */
  async countExchangeAccountsForUser(tenantId: string, userId: string): Promise<number> {
    return this.prisma.tradingAccount.count({
      where: { tenantId, userId, deletedAt: null },
    });
  }

  /** Count copy subscriptions for a specific follower. */
  async countCopySubscriptionsForFollower(tenantId: string, followerId: string): Promise<number> {
    return this.prisma.copySubscription.count({
      where: { tenantId, followerId, state: 'ACTIVE' },
    });
  }

  // ---------------------------------------------------------------------------
  // Key builders
  // ---------------------------------------------------------------------------

  private buildKey(tenantId: string, limitKey: string, scopeId: string): string {
    return `${USAGE_KEY_PREFIX}:${tenantId}:${limitKey}:${scopeId}`;
  }

  private buildWindowedKey(
    tenantId: string,
    limitKey: string,
    scopeId: string,
    windowEpoch: number,
  ): string {
    return `${USAGE_KEY_PREFIX}:${tenantId}:${limitKey}:${scopeId}:w${windowEpoch}`;
  }
}
