import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LeaderEvent } from './copy-order-mapper.service';

/**
 * Phase 3: the leader-event store.
 *
 * A leader event is a FILL on one of the strategy owner's own trading accounts.
 * Fills (not orders) are the unit because they are what actually changed the
 * leader's position: a partially filled leader order produces one event per
 * fill, so followers mirror exactly what executed, and an order that never
 * fills produces nothing to copy.
 *
 * Nothing new is persisted: the canonical `fills` table (written by the
 * execution engine / private streams, unique on (orderId, venueTradeId)) is
 * the store, and the event id `fill:<fillId>` is stable, so CopyExecution's
 * unique (tenantId, leaderEventId, subscriptionId) makes ingestion idempotent
 * across sweeps and across API instances.
 *
 * Follower orders are excluded: the OMS stamps every copy order's metadata
 * with `copyExecutionId`, so a follower who is also a leader never has a copy
 * re-copied as if it were their own decision (no copy loops). Dry-run orders
 * are excluded too - they were never transmitted.
 */

export interface LeaderStrategyRef {
  id: string;
  traderId: string;
  userId: string;
  supportedSymbols?: string[] | null;
  supportedVenues?: string[] | null;
  strategyConfig?: Record<string, unknown> | null;
}

export interface LeaderEventRecord {
  event: LeaderEvent;
  strategyId: string;
  traderId: string;
  /** When the fill happened (exchange time when known). */
  occurredAt: Date;
}

interface FillWithOrder {
  id: string;
  price: unknown;
  quantity: unknown;
  isSimulated: boolean;
  exchangeTimestampMicros: bigint | number | null;
  createdAt: Date;
  order: {
    id: string;
    tenantId: string;
    accountId: string;
    symbol: string;
    side: string;
    venue: string;
    isSimulated: boolean;
    wasDryRun: boolean;
    metadata: unknown;
  };
}

function decimalString(value: unknown): string {
  if (value === null || value === undefined) return '0';
  return typeof value === 'string' ? value : String((value as { toString(): string }).toString());
}

function occurredAt(fill: FillWithOrder): Date {
  const micros = fill.exchangeTimestampMicros;
  if (micros !== null && micros !== undefined) {
    const ms = Number(BigInt(micros) / 1000n);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  }
  return new Date(fill.createdAt);
}

/** True when the order was placed by copy trading (never a leader decision). */
export function isCopyOrder(metadata: unknown): boolean {
  return typeof metadata === 'object' && metadata !== null && typeof (metadata as Record<string, unknown>).copyExecutionId === 'string';
}

/** Pure: one leader fill → the LeaderEvent the copy pipeline consumes. */
export function leaderEventFromFill(fill: FillWithOrder): { event: LeaderEvent; occurredAt: Date } {
  const at = occurredAt(fill);
  return {
    occurredAt: at,
    event: {
      eventId: `fill:${fill.id}`,
      orderId: fill.order.id,
      fillId: fill.id,
      symbol: fill.order.symbol,
      exchangeSymbol: fill.order.symbol,
      side: fill.order.side,
      // A follower mirrors an execution that already happened, so it follows
      // at market; the leader's fill price is the slippage reference.
      type: 'MARKET',
      quantity: decimalString(fill.quantity),
      price: decimalString(fill.price),
      stopPrice: null,
      venue: fill.order.venue,
      timestamp: at.toISOString(),
      isSimulated: fill.isSimulated === true || fill.order.isSimulated === true,
    },
  };
}

@Injectable()
export class LeaderEventSourceService {
  private readonly logger = new Logger(LeaderEventSourceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Leader fills of one strategy in [from, to], oldest first. */
  async listForStrategy(tenantId: string, strategy: LeaderStrategyRef, from: Date, to: Date, limit = 500): Promise<LeaderEventRecord[]> {
    const pinnedAccount = typeof strategy.strategyConfig?.leaderAccountId === 'string' ? (strategy.strategyConfig.leaderAccountId as string) : null;
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { tenantId, userId: strategy.userId, ...(pinnedAccount ? { id: pinnedAccount } : {}) },
      select: { id: true },
    });
    if (accounts.length === 0) return [];

    const fills = (await this.prisma.fill.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        order: { tenantId, accountId: { in: accounts.map((a) => a.id) } },
      },
      include: {
        order: {
          select: { id: true, tenantId: true, accountId: true, symbol: true, side: true, venue: true, isSimulated: true, wasDryRun: true, metadata: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })) as unknown as FillWithOrder[];

    const symbols = (strategy.supportedSymbols ?? []).map((s) => s.toUpperCase());
    const venues = (strategy.supportedVenues ?? []).map((v) => v.toUpperCase());
    const records: LeaderEventRecord[] = [];
    for (const fill of fills) {
      if (!fill.order || fill.order.tenantId !== tenantId) continue;
      if (isCopyOrder(fill.order.metadata) || fill.order.wasDryRun) continue;
      if (symbols.length > 0 && !symbols.includes(String(fill.order.symbol).toUpperCase())) continue;
      if (venues.length > 0 && !venues.includes(String(fill.order.venue).toUpperCase())) continue;
      const { event, occurredAt: at } = leaderEventFromFill(fill);
      records.push({ event, strategyId: strategy.id, traderId: strategy.traderId, occurredAt: at });
    }
    if (fills.length >= limit) {
      this.logger.warn(`Leader fill window truncated tenant=${tenantId} strategy=${strategy.id} limit=${limit}`);
    }
    return records;
  }

  /** Strategies that can currently lead (published) with their copy fields. */
  async listLeadingStrategies(tenantId: string, strategyIds?: string[]): Promise<LeaderStrategyRef[]> {
    const rows = await this.prisma.traderStrategy.findMany({
      where: { tenantId, deletedAt: null, ...(strategyIds ? { id: { in: strategyIds } } : { status: 'PUBLISHED' }) },
      select: { id: true, traderId: true, userId: true, supportedSymbols: true, supportedVenues: true, strategyConfig: true },
    });
    return rows.map((r) => ({ ...r, strategyConfig: (r.strategyConfig ?? {}) as Record<string, unknown> }));
  }
}

/**
 * Whether a subscription was live when a leader event happened: started at or
 * before it, and not stopped/cancelled/expired/paused before it. Shared by
 * ingestion (never copy history into a new subscription) and reconciliation
 * (only a subscription that was live can have MISSED a copy).
 */
export function subscriptionWasLiveAt(sub: Record<string, any>, at: Date): boolean {
  const t = at.getTime();
  const before = (value: unknown) => value !== null && value !== undefined && new Date(value as string).getTime() <= t;
  if (!sub.startedAt || !before(sub.startedAt)) return false;
  if (before(sub.stoppedAt) || before(sub.cancelledAt)) return false;
  if (sub.expiresAt && new Date(sub.expiresAt).getTime() <= t) return false;
  if (sub.state === 'PAUSED' && before(sub.pausedAt)) return false;
  return true;
}
