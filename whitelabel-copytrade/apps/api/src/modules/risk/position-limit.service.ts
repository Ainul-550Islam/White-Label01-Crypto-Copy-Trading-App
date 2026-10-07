// # Responsibility: enforces tenant-scoped, user-wide concurrent position and open-order ceilings atomically before OMS intent persistence.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditOutcome,
  OmsOrderIntentState,
  OmsTradeState,
  OrderStatusEnum,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isDecimalString, parseDecimalString } from '../../common/decimal-string';

const ACTIVE_OMS_INTENT_STATES = [
  OmsOrderIntentState.CREATED,
  OmsOrderIntentState.VALIDATING,
  OmsOrderIntentState.APPROVED,
  OmsOrderIntentState.SUBMITTED,
  OmsOrderIntentState.ACKNOWLEDGED,
  OmsOrderIntentState.PARTIALLY_FILLED,
  OmsOrderIntentState.CANCEL_REQUESTED,
  OmsOrderIntentState.RECONCILIATION_REQUIRED,
] as const;

const ACTIVE_CANONICAL_ORDER_STATES = [
  OrderStatusEnum.PENDING,
  OrderStatusEnum.SUBMITTED,
  OrderStatusEnum.ACKNOWLEDGED,
  OrderStatusEnum.PARTIALLY_FILLED,
  OrderStatusEnum.CANCEL_REQUESTED,
] as const;

const ACTIVE_OMS_TRADE_STATES = [OmsTradeState.OPEN, OmsTradeState.PARTIAL] as const;
const MAX_DATABASE_INTEGER = 2_147_483_647;
const USER_ACCOUNT_SCOPE = 'USER_OWNED_NON_DELETED_ACCOUNTS_INCLUDING_PAPER_AND_LIVE' as const;

type LimitPatch = {
  maxConcurrentPositions?: number | null;
  maxOpenOrders?: number | null;
};

type UserPositionLimits = {
  maxConcurrentPositions: number | null;
  maxOpenOrders: number | null;
};

type PositionLimitUsage = {
  ownedAccountCount: number;
  openPositionSlots: number;
  openOrderCount: number;
};

type PositionLimitSnapshot = PositionLimitUsage & {
  positionSlots: Set<string>;
  openOrderKeys: Set<string>;
};

type PositionLimitView = {
  tenantId: string;
  limits: UserPositionLimits;
  configured: boolean;
  updatedAt: string | null;
  usage: PositionLimitUsage | null;
  usageState: 'CURRENT' | 'UNKNOWN';
  accountScope: typeof USER_ACCOUNT_SCOPE;
  asOf: string;
};

/**
 * User-wide integer-count limits for concurrent open position slots and open
 * orders. The user is derived from the TradingAccount owner in the database,
 * never from a caller-supplied user selector. The same transaction-scoped
 * PostgreSQL advisory lock serializes limit edits and OMS intent creation.
 *
 * Open OMS intents are provisional reservations. A successful fill is moved
 * into the canonical OMS trade lifecycle before its intent becomes terminal;
 * current non-zero Position rows and active OMS trades are then unioned by
 * account and symbol. No money, notional, balance, or conversion is inferred.
 */
@Injectable()
export class PositionLimitService {
  private readonly logger = new Logger(PositionLimitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMyLimits(params: { tenantId: string; userId: string }): Promise<PositionLimitView> {
    const { tenantId, userId } = params;
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      await this.assertTenantUser(tx, tenantId, userId);
      const policy = await tx.userPositionLimit.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      this.assertStoredLimits(policy);
      const usage = await this.readUsageForDisplay(tx, tenantId, userId);
      return this.toView(tenantId, policy, usage);
    });
  }

  async updateMyLimits(params: {
    tenantId: string;
    userId: string;
    patch: LimitPatch;
    requestId?: string | null;
  }): Promise<PositionLimitView> {
    const { tenantId, userId, patch, requestId } = params;
    const hasMaxConcurrentPositions = Object.prototype.hasOwnProperty.call(patch, 'maxConcurrentPositions');
    const hasMaxOpenOrders = Object.prototype.hasOwnProperty.call(patch, 'maxOpenOrders');

    if (!hasMaxConcurrentPositions && !hasMaxOpenOrders) {
      throw new BadRequestException('At least one position or open-order limit must be supplied.');
    }
    if (hasMaxConcurrentPositions) {
      this.assertInputLimit('maxConcurrentPositions', patch.maxConcurrentPositions);
    }
    if (hasMaxOpenOrders) {
      this.assertInputLimit('maxOpenOrders', patch.maxOpenOrders);
    }

    return this.prisma.withTenantRls(tenantId, async (tx) => {
      await this.assertTenantUser(tx, tenantId, userId);
      await this.lockUserScope(tx, tenantId, userId);

      const before = await tx.userPositionLimit.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      this.assertStoredLimits(before);

      const nextLimits: UserPositionLimits = {
        maxConcurrentPositions: hasMaxConcurrentPositions
          ? patch.maxConcurrentPositions ?? null
          : before?.maxConcurrentPositions ?? null,
        maxOpenOrders: hasMaxOpenOrders ? patch.maxOpenOrders ?? null : before?.maxOpenOrders ?? null,
      };

      const saved = await tx.userPositionLimit.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: {
          tenantId,
          userId,
          maxConcurrentPositions: nextLimits.maxConcurrentPositions,
          maxOpenOrders: nextLimits.maxOpenOrders,
        },
        update: {
          maxConcurrentPositions: nextLimits.maxConcurrentPositions,
          maxOpenOrders: nextLimits.maxOpenOrders,
        },
      });

      // The policy mutation and its audit record commit together. No credential,
      // exchange key, financial amount, or caller-selected tenant is recorded.
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: AuditActorType.USER,
          actorId: userId,
          action: 'USER_POSITION_LIMIT_UPDATED',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'USER_POSITION_LIMIT',
          resourceId: saved.id,
          description: 'Updated self-service concurrent position and open-order limits.',
          changes: {
            maxConcurrentPositions: {
              before: before?.maxConcurrentPositions ?? null,
              after: nextLimits.maxConcurrentPositions,
            },
            maxOpenOrders: {
              before: before?.maxOpenOrders ?? null,
              after: nextLimits.maxOpenOrders,
            },
          },
          metadata: { source: 'SELF_SERVICE', accountScope: USER_ACCOUNT_SCOPE },
          requestId: requestId ? requestId.slice(0, 64) : null,
        },
      });

      const usage = await this.readUsageForDisplay(tx, tenantId, userId);
      return this.toView(tenantId, saved, usage);
    });
  }

  /**
   * Persist an OMS intent only after acquiring the per-tenant/user transaction
   * lock and measuring canonical active reservations. The callback must write
   * through the supplied transaction client; doing so makes the count and the
   * new reservation one atomic unit. Accounts without a canonical user owner
   * are tenant-level house accounts and are deliberately outside this
   * per-user policy rather than being assigned to the request actor.
   */
  async persistOrderIntentWithLimits<T>(params: {
    tenantId: string;
    accountId: string;
    symbol: string;
    persist: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<T> {
    const { tenantId, accountId, symbol, persist } = params;
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const account = await tx.tradingAccount.findFirst({
        where: { id: accountId, tenantId, deletedAt: null },
        select: { id: true, userId: true },
      });
      if (!account) {
        throw new ForbiddenException('Trading account is not available in the authenticated tenant.');
      }

      const ownerUserId = account.userId;
      if (!ownerUserId) return persist(tx);

      await this.lockUserScope(tx, tenantId, ownerUserId);
      const policy = await tx.userPositionLimit.findUnique({
        where: { tenantId_userId: { tenantId, userId: ownerUserId } },
      });
      this.assertStoredLimits(policy);

      if (policy && (policy.maxConcurrentPositions !== null || policy.maxOpenOrders !== null)) {
        const snapshot = await this.collectUsageSnapshot(tx, tenantId, ownerUserId);
        this.assertWithinLimits({
          tenantId,
          accountId,
          symbol,
          policy,
          snapshot,
        });
      }

      return persist(tx);
    });
  }

  private async assertTenantUser(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new ForbiddenException('Authenticated user is not available in the authenticated tenant.');
  }

  private async lockUserScope(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
    const lockName = `user-position-limits:${tenantId}:${userId}`;
    // hashtextextended maps the stable tenant/user scope to a PostgreSQL
    // transaction advisory lock. The string is a bound parameter, never SQL.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`;
  }

  private async readUsageForDisplay(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<PositionLimitUsage | null> {
    try {
      const snapshot = await this.collectUsageSnapshot(tx, tenantId, userId);
      return {
        ownedAccountCount: snapshot.ownedAccountCount,
        openPositionSlots: snapshot.openPositionSlots,
        openOrderCount: snapshot.openOrderCount,
      };
    } catch (error) {
      this.logger.warn(
        `Position-limit usage unavailable tenant ${tenantId} user ${userId} error ${this.safeErrorCode(error)}`,
      );
      return null;
    }
  }

  private async collectUsageSnapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<PositionLimitSnapshot> {
    const accounts = await tx.tradingAccount.findMany({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    const positionSlots = new Set<string>();
    const openOrderKeys = new Set<string>();

    if (accountIds.length === 0) {
      return {
        ownedAccountCount: 0,
        openPositionSlots: 0,
        openOrderCount: 0,
        positionSlots,
        openOrderKeys,
      };
    }

    // Read active intents first. Fill management keeps an intent active until
    // its persisted OMS trade has been written. Thus a fill transition racing
    // this read is represented either by the active intent below or by the
    // trade/position reads that follow; no reservation-free terminal gap is
    // accepted. Each subsequent SELECT uses a fresh READ COMMITTED snapshot.
    const intents = await tx.omsOrderIntent.findMany({
      where: {
        tenantId,
        accountId: { in: accountIds },
        state: { in: [...ACTIVE_OMS_INTENT_STATES] },
      },
      select: { accountId: true, symbol: true, clientOrderId: true },
    });

    const orders = await tx.order.findMany({
      where: {
        tenantId,
        accountId: { in: accountIds },
        status: { in: [...ACTIVE_CANONICAL_ORDER_STATES] },
      },
      select: { accountId: true, symbol: true, clientOrderId: true },
    });

    const [positions, trades] = await Promise.all([
      tx.position.findMany({
        where: { tenantId, accountId: { in: accountIds } },
        select: { accountId: true, symbol: true, quantity: true },
      }),
      tx.omsTrade.findMany({
        where: {
          tenantId,
          accountId: { in: accountIds },
          state: { in: [...ACTIVE_OMS_TRADE_STATES] },
        },
        select: { accountId: true, symbol: true, state: true },
      }),
    ]);

    const pendingPositionSlots = new Set<string>();
    const addActiveOrder = (order: {
      accountId: string;
      symbol: string;
      clientOrderId: string;
    }): void => {
      const orderKey = `client:${order.clientOrderId}`;
      openOrderKeys.add(orderKey);
      // Do not trust a caller-supplied reduceOnly flag to bypass the position
      // ceiling. Existing open exposure already occupies this slot; any new
      // account/symbol pair reserves one until the canonical lifecycle closes.
      pendingPositionSlots.add(this.positionSlotKey(order.accountId, order.symbol));
    };

    for (const order of orders) addActiveOrder(order);
    for (const intent of intents) addActiveOrder(intent);

    for (const position of positions) {
      if (this.hasNonZeroOrUncertainQuantity(position.quantity)) {
        positionSlots.add(this.positionSlotKey(position.accountId, position.symbol));
      }
    }
    for (const trade of trades) {
      // OPEN/PARTIAL lifecycle states represent exposure until explicitly
      // closed. Quantity strings are not converted into money or floats.
      positionSlots.add(this.positionSlotKey(trade.accountId, trade.symbol));
    }
    for (const slot of pendingPositionSlots) positionSlots.add(slot);

    return {
      ownedAccountCount: accountIds.length,
      openPositionSlots: positionSlots.size,
      openOrderCount: openOrderKeys.size,
      positionSlots,
      openOrderKeys,
    };
  }

  private assertWithinLimits(params: {
    tenantId: string;
    accountId: string;
    symbol: string;
    policy: UserPositionLimits;
    snapshot: PositionLimitSnapshot;
  }): void {
    const { tenantId, accountId, symbol, policy, snapshot } = params;

    if (policy.maxOpenOrders !== null && snapshot.openOrderCount + 1 > policy.maxOpenOrders) {
      throw new ConflictException({
        statusCode: 409,
        code: 'USER_OPEN_ORDER_LIMIT_EXCEEDED',
        message: 'The user-wide open-order limit would be exceeded.',
        current: snapshot.openOrderCount,
        maximum: policy.maxOpenOrders,
      });
    }

    if (policy.maxConcurrentPositions !== null) {
      const candidateSlots = new Set(snapshot.positionSlots);
      candidateSlots.add(this.positionSlotKey(accountId, symbol));
      if (candidateSlots.size > policy.maxConcurrentPositions) {
        throw new ConflictException({
          statusCode: 409,
          code: 'USER_CONCURRENT_POSITION_LIMIT_EXCEEDED',
          message: 'The user-wide concurrent position limit would be exceeded.',
          current: snapshot.openPositionSlots,
          projected: candidateSlots.size,
          maximum: policy.maxConcurrentPositions,
        });
      }
    }

    // The tenant id is part of the lock scope even though it is not repeated
    // in the response body. This argument makes the enforced scope explicit
    // at the call site and guards against accidental removal during refactors.
    if (!tenantId) throw new ForbiddenException('Tenant scope is required for position-limit enforcement.');
  }

  private positionSlotKey(accountId: string, symbol: string): string {
    return `${accountId}\u0000${symbol.trim().toUpperCase()}`;
  }

  private hasNonZeroOrUncertainQuantity(quantity: unknown): boolean {
    let value: string;
    if (typeof quantity === 'string') value = quantity;
    else if (typeof quantity === 'number') value = String(quantity);
    else if (quantity && typeof quantity === 'object' && typeof (quantity as { toString?: unknown }).toString === 'function') {
      value = (quantity as { toString: () => string }).toString();
    } else {
      return true;
    }

    if (!isDecimalString(value)) return true;
    try {
      return parseDecimalString(value) !== 0n;
    } catch {
      return true;
    }
  }

  private assertInputLimit(name: keyof UserPositionLimits, value: number | null | undefined): void {
    if (value === null) return;
    if (
      value === undefined ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > MAX_DATABASE_INTEGER
    ) {
      throw new BadRequestException(`${name} must be null or a whole number from 0 through ${MAX_DATABASE_INTEGER}.`);
    }
  }

  private assertStoredLimits(policy: UserPositionLimits | null): void {
    if (!policy) return;
    const values: Array<[keyof UserPositionLimits, number | null]> = [
      ['maxConcurrentPositions', policy.maxConcurrentPositions],
      ['maxOpenOrders', policy.maxOpenOrders],
    ];
    for (const [name, value] of values) {
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > MAX_DATABASE_INTEGER)) {
        throw new Error(`Stored ${name} is outside the supported nonnegative integer range.`);
      }
    }
  }

  private toView(
    tenantId: string,
    policy: (UserPositionLimits & { updatedAt: Date }) | null,
    usage: PositionLimitUsage | null,
  ): PositionLimitView {
    const limits: UserPositionLimits = {
      maxConcurrentPositions: policy?.maxConcurrentPositions ?? null,
      maxOpenOrders: policy?.maxOpenOrders ?? null,
    };
    return {
      tenantId,
      limits,
      configured: limits.maxConcurrentPositions !== null || limits.maxOpenOrders !== null,
      updatedAt: policy?.updatedAt?.toISOString() ?? null,
      usage,
      usageState: usage ? 'CURRENT' : 'UNKNOWN',
      accountScope: USER_ACCOUNT_SCOPE,
      asOf: new Date().toISOString(),
    };
  }

  private safeErrorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
    }
    return 'UNKNOWN';
  }
}
