// # Polls and dispatches leader events idempotently with staleness and duplicate-event guards
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopyExecutionService } from './copy-execution.service';
import { LeaderEventRecord, LeaderEventSourceService, subscriptionWasLiveAt } from './leader-event-source.service';

export interface IngestionResult {
  events: number;
  dispatched: number;
  alreadyCopied: number;
  expired: number;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_AGE_MS = 30_000;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Phase 3: automatic leader-event ingestion.
 *
 * Safety properties:
 *  - Idempotent: event ids are stable (`fill:<id>`) and CopyExecution is
 *    unique per (tenant, leaderEvent, subscription); events every live
 *    subscription already has an execution for are not re-processed at all.
 *  - In-batch duplicate protection: duplicate records for the same eventId in
 *    one ingestion pass are deduplicated and counted as alreadyCopied.
 *  - Bounded staleness: a fill older than COPY_LEADER_EVENT_MAX_AGE_MS
 *    (default 30s) is never copied - the market has moved - and is left for
 *    reconciliation to report as MISSING_COPY instead of being filled late.
 *  - No history replay: a subscription is only eligible for events that
 *    happened while it was live (subscriptionWasLiveAt).
 *  - Off in tests; COPY_LEADER_INGESTION_ENABLED=false disables it.
 */
@Injectable()
export class LeaderEventIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderEventIngestionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  readonly intervalMs = positiveInt(process.env.COPY_LEADER_INGESTION_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  readonly maxAgeMs = positiveInt(process.env.COPY_LEADER_EVENT_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly source: LeaderEventSourceService,
    private readonly copyExecution: CopyExecutionService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || (process.env.COPY_LEADER_INGESTION_ENABLED ?? '').toLowerCase() === 'false') {
      this.logger.log('Leader-event ingestion disabled');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep().catch((error: Error) => this.logger.warn(`Leader-event sweep failed: ${error.message}`));
    }, this.intervalMs);
    this.timer.unref?.();
    this.logger.log(`Leader-event ingestion every ${this.intervalMs}ms (max event age ${this.maxAgeMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every tenant with at least one ACTIVE subscription. */
  async sweep(now: Date = new Date()): Promise<IngestionResult> {
    const total: IngestionResult = { events: 0, dispatched: 0, alreadyCopied: 0, expired: 0 };
    if (this.running) return total; // never overlap passes in one process
    this.running = true;
    try {
      const tenants = await this.prisma.copySubscription.findMany({ where: { state: 'ACTIVE' }, distinct: ['tenantId'], select: { tenantId: true } });
      for (const { tenantId } of tenants) {
        try {
          const r = await this.ingestTenant(tenantId, now);
          total.events += r.events;
          total.dispatched += r.dispatched;
          total.alreadyCopied += r.alreadyCopied;
          total.expired += r.expired;
        } catch (error) {
          this.logger.warn(`Leader-event ingestion failed tenant=${tenantId}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
    return total;
  }

  async ingestTenant(tenantId: string, now: Date = new Date()): Promise<IngestionResult> {
    const result: IngestionResult = { events: 0, dispatched: 0, alreadyCopied: 0, expired: 0 };
    const subscriptions = await this.prisma.copySubscription.findMany({ where: { tenantId, state: 'ACTIVE' } });
    if (subscriptions.length === 0) return result;

    const byStrategy = new Map<string, any[]>();
    for (const sub of subscriptions) {
      const list = byStrategy.get(sub.strategyId) ?? [];
      list.push(sub);
      byStrategy.set(sub.strategyId, list);
    }

    const strategies = await this.source.listLeadingStrategies(tenantId, [...byStrategy.keys()]);
    const from = new Date(now.getTime() - this.maxAgeMs - this.intervalMs);
    const seenInPass = new Set<string>();

    for (const strategy of strategies) {
      const subs = byStrategy.get(strategy.id) ?? [];
      const records = await this.source.listForStrategy(tenantId, strategy, from, now);
      if (records.length === 0) continue;

      const existing = await this.prisma.copyExecution.findMany({
        where: { tenantId, leaderEventId: { in: records.map((r) => r.event.eventId) } },
        select: { leaderEventId: true, subscriptionId: true },
      });
      const copied = new Set(existing.map((e) => `${e.leaderEventId}|${e.subscriptionId}`));

      for (const record of records) {
        result.events += 1;
        const passKey = `${tenantId}|${strategy.id}|${record.event.eventId}`;
        if (seenInPass.has(passKey)) {
          result.alreadyCopied += 1;
          continue;
        }
        seenInPass.add(passKey);

        const eligible = subs.filter((s) => subscriptionWasLiveAt(s, record.occurredAt));
        if (eligible.length === 0 || eligible.every((s) => copied.has(`${record.event.eventId}|${s.id}`))) {
          result.alreadyCopied += 1;
          continue;
        }
        if (now.getTime() - record.occurredAt.getTime() > this.maxAgeMs) {
          result.expired += 1;
          continue;
        }
        await this.dispatch(tenantId, record);
        for (const s of eligible) {
          copied.add(`${record.event.eventId}|${s.id}`);
        }
        result.dispatched += 1;
      }
    }
    if (result.dispatched > 0 || result.expired > 0) {
      this.logger.log(`Leader events tenant=${tenantId} seen=${result.events} dispatched=${result.dispatched} expired=${result.expired}`);
    }
    return result;
  }

  private async dispatch(tenantId: string, record: LeaderEventRecord): Promise<void> {
    await this.copyExecution.processLeaderEvent({
      tenantId,
      leaderEvent: record.event,
      traderId: record.traderId,
      strategyId: record.strategyId,
    });
  }
}
