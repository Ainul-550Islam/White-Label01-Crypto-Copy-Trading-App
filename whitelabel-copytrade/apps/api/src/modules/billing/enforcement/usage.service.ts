import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { UsageRepository } from './usage.repository';
import type {
  ApiRequestUsage,
  CopySubscriptionUsage,
  ExchangeAccountUsage,
  FollowerUsage,
  TraderUsage,
  UserUsage,
  WebsocketUsage,
  ReserveUsageResult,
} from './usage.types';
import { UsageUnavailableError } from './enforcement.errors';

/**
 * Business layer above the usage repository.
 *
 * Responsibilities:
 *  - get current usage
 *  - calculate remaining capacity
 *  - reserve capacity (atomic)
 *  - release capacity (on creation failure)
 *  - prevent negative counters
 *  - support tenant / user / trader / follower scopes
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly repository: UsageRepository,
    @InjectPinoLogger(UsageService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Tenant-scoped usage
  // ---------------------------------------------------------------------------

  /** Get current user count for the tenant. */
  async getUserUsage(tenantId: string, maximum: number | null): Promise<UserUsage> {
    const current = await this.repository.countActiveUsers(tenantId);
    return {
      tenantId,
      current,
      maximum,
      remaining: maximum !== null ? Math.max(0, maximum - current) : null,
      updatedAt: new Date(),
    };
  }

  /** Get current trader count for the tenant. */
  async getTraderUsage(tenantId: string, maximum: number | null): Promise<TraderUsage> {
    const current = await this.repository.countActiveTraders(tenantId);
    return {
      tenantId,
      current,
      maximum,
      remaining: maximum !== null ? Math.max(0, maximum - current) : null,
      updatedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Per-trader scoped usage
  // ---------------------------------------------------------------------------

  /** Get follower count for a specific trader. */
  async getFollowerUsage(
    tenantId: string,
    traderId: string,
    maximum: number | null,
  ): Promise<FollowerUsage> {
    const current = await this.repository.countFollowersForTrader(tenantId, traderId);
    return {
      tenantId,
      traderId,
      current,
      maximum,
      remaining: maximum !== null ? Math.max(0, maximum - current) : null,
      updatedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Per-user scoped usage
  // ---------------------------------------------------------------------------

  /** Get exchange account count for a specific user. */
  async getExchangeAccountUsage(
    tenantId: string,
    userId: string,
    maximum: number | null,
  ): Promise<ExchangeAccountUsage> {
    const current = await this.repository.countExchangeAccountsForUser(tenantId, userId);
    return {
      tenantId,
      userId,
      current,
      maximum,
      remaining: maximum !== null ? Math.max(0, maximum - current) : null,
      updatedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Per-follower scoped usage
  // ---------------------------------------------------------------------------

  /** Get copy subscription count for a specific follower. */
  async getCopySubscriptionUsage(
    tenantId: string,
    followerId: string,
    maximum: number | null,
  ): Promise<CopySubscriptionUsage> {
    const current = await this.repository.countCopySubscriptionsForFollower(tenantId, followerId);
    return {
      tenantId,
      followerId,
      current,
      maximum,
      remaining: maximum !== null ? Math.max(0, maximum - current) : null,
      updatedAt: new Date(),
    };
  }

  // ---------------------------------------------------------------------------
  // Rate-limited usage (windowed)
  // ---------------------------------------------------------------------------

  /**
   * Get the current API request count within the current minute window.
   *
   * The window is a fixed 60-second bucket aligned to epoch minutes.
   */
  async getApiRequestUsage(
    tenantId: string,
    maximum: number | null,
    userId?: string,
  ): Promise<ApiRequestUsage> {
    const scopeId = userId ?? tenantId;
    const { windowEpoch, windowStart, windowEnd } = this.currentMinuteWindow();

    const current = await this.repository.getWindowedCurrent({
      tenantId,
      limitKey: 'maxApiRequestsPerMinute',
      scopeId,
      windowEpoch,
    });

    return {
      tenantId,
      userId,
      current,
      maximum,
      remaining: maximum !== null ? Math.max(0, maximum - current) : null,
      windowStart,
      windowEnd,
      updatedAt: new Date(),
    };
  }

  /**
   * Increment the API request counter for the current window.
   * Returns the new count.
   */
  async incrementApiRequest(tenantId: string, userId?: string): Promise<number> {
    const scopeId = userId ?? tenantId;
    const { windowEpoch } = this.currentMinuteWindow();
    const ttlSeconds = 120; // slightly longer than the window to avoid races

    return this.repository.incrementWindowed({
      tenantId,
      limitKey: 'maxApiRequestsPerMinute',
      scopeId,
      windowEpoch,
      windowTtlSeconds: ttlSeconds,
    });
  }

  // ---------------------------------------------------------------------------
  // WebSocket connection usage
  // ---------------------------------------------------------------------------

  /**
   * Get current websocket connection usage for a tenant.
   * `current` is confirmed connections; `reserved` includes in-flight handshakes.
   */
  async getWebsocketUsage(tenantId: string, maximum: number | null): Promise<WebsocketUsage> {
    const current = await this.repository.getCurrent({
      tenantId,
      limitKey: 'websocketConnections',
      scopeId: tenantId,
    });

    return {
      tenantId,
      current,
      reserved: current,
      maximum,
      remaining: maximum !== null ? Math.max(0, maximum - current) : null,
      updatedAt: new Date(),
    };
  }

  /**
   * Reserve a websocket connection slot atomically.
   * Returns whether the reservation succeeded.
   */
  async reserveWebsocketConnection(
    tenantId: string,
    maximum: number,
  ): Promise<ReserveUsageResult> {
    return this.repository.atomicReserve({
      tenantId,
      limitKey: 'websocketConnections',
      scopeId: tenantId,
      maximum,
      amount: 1,
    });
  }

  /**
   * Release a websocket connection slot.
   * Called on disconnect or failed handshake.
   */
  async releaseWebsocketConnection(tenantId: string): Promise<void> {
    await this.repository.release({
      tenantId,
      limitKey: 'websocketConnections',
      scopeId: tenantId,
      amount: 1,
    });
  }

  // ---------------------------------------------------------------------------
  // Generic quota reservation (used by all creation-path guards)
  // ---------------------------------------------------------------------------

  /**
   * Atomically reserve one unit of quota for the given limit key.
   * Returns whether the reservation succeeded, the count after reservation,
   * the maximum, and remaining capacity.
   */
  async reserveQuota(
    tenantId: string,
    limitKey: string,
    scopeId: string,
    maximum: number,
    amount: number = 1,
  ): Promise<ReserveUsageResult> {
    return this.repository.atomicReserve({
      tenantId,
      limitKey,
      scopeId,
      maximum,
      amount,
    });
  }

  /**
   * Release a previously reserved quota slot.
   * Called when the creation that triggered the reservation fails.
   */
  async releaseQuota(
    tenantId: string,
    limitKey: string,
    scopeId: string,
    amount: number = 1,
  ): Promise<void> {
    await this.repository.release({
      tenantId,
      limitKey,
      scopeId,
      amount,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Current fixed 60-second window aligned to epoch minutes.
   */
  private currentMinuteWindow(): {
    windowEpoch: number;
    windowStart: Date;
    windowEnd: Date;
  } {
    const now = Date.now();
    const windowEpoch = Math.floor(now / 60_000);
    const windowStart = new Date(windowEpoch * 60_000);
    const windowEnd = new Date(windowStart.getTime() + 60_000);
    return { windowEpoch, windowStart, windowEnd };
  }
}
