import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopyExecutionRepository } from './copy-execution.repository';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { CopyReconciliationCategory, CopyReconciliationSeverity } from './copy-trading.types';
import { randomUUID } from 'crypto';
import { LeaderEventSourceService, subscriptionWasLiveAt } from './leader-event-source.service';

/** Events younger than this are still in flight (ingestion interval + dispatch). */
const MISSING_COPY_GRACE_MS = 60_000;

/**
 * Reconciles leader ↔ copy intent ↔ copy execution ↔ follower order/fill for correctness, detects missing/duplicate/stale/mismatch/slippage/delay anomalies, and produces auditable diffs.
 * Execution after stop-copy must be flagged.
 */
@Injectable()
export class CopyReconciliationService {
  private readonly logger = new Logger(CopyReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executionRepo: CopyExecutionRepository,
    private readonly subscriptionRepo: CopySubscriptionRepository,
    // Phase 3: the leader-event store (leader fills). Optional so a harness
    // without it still reconciles executions; missing-copy detection then
    // reports itself as skipped instead of silently passing.
    @Optional() private readonly leaderEvents?: LeaderEventSourceService,
  ) {}

  async reconcileTenant(tenantId: string, filters?: { strategyId?: string; from?: Date; to?: Date; limit?: number }): Promise<{ records: any[]; summary: Record<string, number> }> {
    const limit = filters?.limit || 100;
    const from = filters?.from || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = filters?.to || new Date();

    // Get leader events - from orders/fills? For simplicity, we treat orders as leader events
    // In real system, leader events would be stored in a separate table or derived from trader's orders

    // Get all executions in time range
    const executions = await (this.prisma as any).copyExecution?.findMany({ where: { tenantId, createdAt: { gte: from, lte: to }, ...(filters?.strategyId ? { traderId: filters.strategyId } : {}) }, orderBy: { createdAt: 'desc' }, take: limit }) || [];

    // Get all active subscriptions for tenant
    const { data: subscriptions } = await this.subscriptionRepo.listByTenant(tenantId, { page: 1, limit: 1000 });

    const records: any[] = [];
    const summary: Record<string, number> = {};

    const incrementSummary = (cat: string) => {
      summary[cat] = (summary[cat] || 0) + 1;
    };

    // Check each execution
    for (const exec of executions) {
      try {
        const sub = subscriptions.find((s: any) => s.id === exec.subscriptionId);

        // Execution after stop-copy must be flagged
        if (sub && (sub.state === 'STOPPED' || sub.state === 'CANCELLED')) {
          if (new Date(exec.createdAt) > new Date(sub.stoppedAt || sub.cancelledAt || sub.updatedAt)) {
            const rec = await this.createRecord({
              tenantId,
              leaderEventId: exec.leaderEventId,
              subscriptionId: exec.subscriptionId,
              executionId: exec.id,
              category: CopyReconciliationCategory.EXECUTION_AFTER_STOP,
              severity: CopyReconciliationSeverity.CRITICAL,
              expected: { subscriptionState: sub.state, stoppedAt: sub.stoppedAt || sub.cancelledAt },
              actual: { executionCreatedAt: exec.createdAt, status: exec.status },
              leaderReference: { leaderEventId: exec.leaderEventId, leaderOrderId: exec.leaderOrderId },
              followerReference: { followerOrderId: exec.followerOrderId, followerFillId: exec.followerFillId },
            });
            records.push(rec);
            incrementSummary(CopyReconciliationCategory.EXECUTION_AFTER_STOP);
          }
        }

        // Duplicate copy detection - same leaderEvent + subscription
        const duplicates = executions.filter((e: any) => e.leaderEventId === exec.leaderEventId && e.subscriptionId === exec.subscriptionId && e.id !== exec.id);
        if (duplicates.length > 0) {
          const rec = await this.createRecord({
            tenantId,
            leaderEventId: exec.leaderEventId,
            subscriptionId: exec.subscriptionId,
            executionId: exec.id,
            category: CopyReconciliationCategory.DUPLICATE_COPY,
            severity: CopyReconciliationSeverity.HIGH,
            expected: { count: 1 },
            actual: { count: duplicates.length + 1, duplicateIds: duplicates.map((d: any) => d.id) },
            leaderReference: { leaderEventId: exec.leaderEventId },
            followerReference: null,
          });
          records.push(rec);
          incrementSummary(CopyReconciliationCategory.DUPLICATE_COPY);
        }

        // Stale intent - execution stuck in PENDING/VALIDATED for too long
        if (['PENDING', 'VALIDATED', 'MAPPED', 'RISK_CHECKED', 'ROUTED'].includes(exec.status)) {
          const ageMs = Date.now() - new Date(exec.createdAt).getTime();
          if (ageMs > 5 * 60 * 1000) {
            // 5 minutes stale
            const rec = await this.createRecord({
              tenantId,
              leaderEventId: exec.leaderEventId,
              subscriptionId: exec.subscriptionId,
              executionId: exec.id,
              category: CopyReconciliationCategory.STALE_INTENT,
              severity: ageMs > 30 * 60 * 1000 ? CopyReconciliationSeverity.HIGH : CopyReconciliationSeverity.MEDIUM,
              expected: { status: 'FILLED or FAILED within 5min' },
              actual: { status: exec.status, ageMs },
              leaderReference: null,
              followerReference: null,
            });
            records.push(rec);
            incrementSummary(CopyReconciliationCategory.STALE_INTENT);
          }
        }

        // Order mismatch - follower order not found or mismatched
        if (exec.followerOrderId) {
          try {
            const followerOrder = await this.prisma.order.findFirst({ where: { id: exec.followerOrderId, tenantId } });
            if (!followerOrder) {
              const rec = await this.createRecord({
                tenantId,
                leaderEventId: exec.leaderEventId,
                subscriptionId: exec.subscriptionId,
                executionId: exec.id,
                category: CopyReconciliationCategory.ORDER_MISMATCH,
                severity: CopyReconciliationSeverity.HIGH,
                expected: { followerOrderId: exec.followerOrderId },
                actual: { found: false },
                leaderReference: null,
                followerReference: { followerOrderId: exec.followerOrderId },
              });
              records.push(rec);
              incrementSummary(CopyReconciliationCategory.ORDER_MISMATCH);
            } else {
              // Quantity mismatch
              if (exec.followerQuantity && followerOrder.quantity) {
                const execQty = exec.followerQuantity.toString();
                const orderQty = followerOrder.quantity.toString();
                if (execQty !== orderQty) {
                  const rec = await this.createRecord({
                    tenantId,
                    leaderEventId: exec.leaderEventId,
                    subscriptionId: exec.subscriptionId,
                    executionId: exec.id,
                    category: CopyReconciliationCategory.QUANTITY_MISMATCH,
                    severity: CopyReconciliationSeverity.MEDIUM,
                    expected: { quantity: execQty },
                    actual: { quantity: orderQty },
                    leaderReference: null,
                    followerReference: { orderId: followerOrder.id, quantity: orderQty },
                  });
                  records.push(rec);
                  incrementSummary(CopyReconciliationCategory.QUANTITY_MISMATCH);
                }
              }

              // Price mismatch / slippage
              if (exec.followerPrice && followerOrder.price) {
                const execPrice = parseFloat(exec.followerPrice.toString());
                const orderPrice = parseFloat(followerOrder.price.toString());
                const slippage = Math.abs(execPrice - orderPrice) / execPrice;
                const tolerance = exec.slippageTolerance ? parseFloat(exec.slippageTolerance) / 10000 : 0.01;
                if (slippage > tolerance) {
                  const rec = await this.createRecord({
                    tenantId,
                    leaderEventId: exec.leaderEventId,
                    subscriptionId: exec.subscriptionId,
                    executionId: exec.id,
                    category: CopyReconciliationCategory.SLIPPAGE_EXCEEDED,
                    severity: slippage > tolerance * 2 ? CopyReconciliationSeverity.HIGH : CopyReconciliationSeverity.MEDIUM,
                    expected: { price: exec.followerPrice, slippageTolerance: tolerance },
                    actual: { price: followerOrder.price, slippage },
                    leaderReference: { leaderPrice: exec.leaderPrice },
                    followerReference: { followerPrice: followerOrder.price },
                  });
                  records.push(rec);
                  incrementSummary(CopyReconciliationCategory.SLIPPAGE_EXCEEDED);
                }
              }
            }
          } catch {}
        }

        // Status mismatch - execution FILLED but order not FILLED
        if (exec.status === 'FILLED' && exec.followerOrderId) {
          try {
            const order = await this.prisma.order.findFirst({ where: { id: exec.followerOrderId, tenantId } });
            if (order && order.status !== 'FILLED' && order.status !== 'PARTIALLY_FILLED') {
              const rec = await this.createRecord({
                tenantId,
                leaderEventId: exec.leaderEventId,
                subscriptionId: exec.subscriptionId,
                executionId: exec.id,
                category: CopyReconciliationCategory.STATUS_MISMATCH,
                severity: CopyReconciliationSeverity.MEDIUM,
                expected: { executionStatus: 'FILLED', orderStatus: 'FILLED' },
                actual: { executionStatus: exec.status, orderStatus: order.status },
                leaderReference: null,
                followerReference: { orderId: order.id, status: order.status },
              });
              records.push(rec);
              incrementSummary(CopyReconciliationCategory.STATUS_MISMATCH);
            }
          } catch {}
        }
      } catch (e: any) {
        this.logger.warn(`Reconciliation error for execution=${exec.id} error=${e.message}`);
      }
    }

    // Missing copy detection - every leader event (leader fill) that happened
    // while a subscription was live must have a CopyExecution for that
    // subscription (FILLED, SKIPPED, BLOCKED... any outcome is an answer; no
    // record at all is a silent miss). Events inside the grace window are
    // still in flight and are not judged yet.
    if (!this.leaderEvents) {
      summary.MISSING_COPY_CHECK_SKIPPED = 1;
    } else {
      try {
        const now = Date.now();
        const byStrategy = new Map<string, any[]>();
        for (const sub of subscriptions as any[]) {
          if (filters?.strategyId && sub.strategyId !== filters.strategyId && sub.traderId !== filters.strategyId) continue;
          const list = byStrategy.get(sub.strategyId) ?? [];
          list.push(sub);
          byStrategy.set(sub.strategyId, list);
        }
        const strategies = byStrategy.size > 0 ? await this.leaderEvents.listLeadingStrategies(tenantId, [...byStrategy.keys()]) : [];
        for (const strategy of strategies) {
          const subs = byStrategy.get(strategy.id) ?? [];
          const events = await this.leaderEvents.listForStrategy(tenantId, strategy, from, to, 500);
          if (events.length === 0) continue;
          const copies = (await (this.prisma as any).copyExecution?.findMany({
            where: { tenantId, leaderEventId: { in: events.map((e) => e.event.eventId) } },
            select: { leaderEventId: true, subscriptionId: true },
          })) || [];
          const copied = new Set(copies.map((c: any) => `${c.leaderEventId}|${c.subscriptionId}`));
          for (const record of events) {
            const ageMs = now - record.occurredAt.getTime();
            if (ageMs < MISSING_COPY_GRACE_MS) continue;
            for (const sub of subs) {
              if (!subscriptionWasLiveAt(sub, record.occurredAt)) continue;
              if (copied.has(`${record.event.eventId}|${sub.id}`)) continue;
              const rec = await this.createRecord({
                tenantId,
                leaderEventId: record.event.eventId,
                subscriptionId: sub.id,
                executionId: null,
                category: CopyReconciliationCategory.MISSING_COPY,
                severity: CopyReconciliationSeverity.HIGH,
                expected: { copyExecution: 'one record per live subscription', subscriptionState: sub.state },
                actual: { found: 0, eventAgeMs: ageMs },
                leaderReference: {
                  leaderEventId: record.event.eventId,
                  leaderOrderId: record.event.orderId,
                  leaderFillId: record.event.fillId,
                  symbol: record.event.symbol,
                  side: record.event.side,
                  quantity: record.event.quantity,
                  price: record.event.price,
                  occurredAt: record.occurredAt.toISOString(),
                },
                followerReference: { subscriptionId: sub.id, followerId: sub.followerId, followerAccountId: sub.followerAccountId ?? null },
              });
              records.push(rec);
              incrementSummary(CopyReconciliationCategory.MISSING_COPY);
            }
          }
        }
      } catch (e: any) {
        this.logger.warn(`Missing-copy detection failed tenant=${tenantId} error=${e.message}`);
        summary.MISSING_COPY_CHECK_FAILED = 1;
      }
    }

    this.logger.log(`Reconciliation completed tenant=${tenantId} records=${records.length} summary=${JSON.stringify(summary)}`);

    return { records, summary };
  }

  private async createRecord(input: {
    tenantId: string;
    leaderEventId: string;
    subscriptionId?: string | null;
    executionId?: string | null;
    category: CopyReconciliationCategory;
    severity: CopyReconciliationSeverity;
    expected: Record<string, any> | null;
    actual: Record<string, any> | null;
    leaderReference: Record<string, any> | null;
    followerReference: Record<string, any> | null;
  }): Promise<any> {
    try {
      const existing = await (this.prisma as any).copyReconciliationRecord?.findFirst({ where: { tenantId: input.tenantId, leaderEventId: input.leaderEventId, subscriptionId: input.subscriptionId, category: input.category, resolved: false } });
      if (existing) return existing;

      return await (this.prisma as any).copyReconciliationRecord.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          leaderEventId: input.leaderEventId,
          subscriptionId: input.subscriptionId || null,
          executionId: input.executionId || null,
          category: input.category,
          severity: input.severity,
          expected: input.expected,
          actual: input.actual,
          leaderReference: input.leaderReference,
          followerReference: input.followerReference,
          resolved: false,
          createdAt: new Date(),
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to create reconciliation record error=${e.message}`);
      return { id: randomUUID(), ...input, resolved: false, createdAt: new Date().toISOString() };
    }
  }

  async resolveRecord(tenantId: string, recordId: string, actorId: string, notes?: string): Promise<any | null> {
    // Tenant check before the write (the old code updated first and checked afterwards).
    const existing = await (this.prisma as any).copyReconciliationRecord.findFirst({ where: { id: recordId, tenantId } });
    if (!existing) return null;
    // Columns: resolved/resolvedAt/resolvedBy. No notes column: kept in actual._resolution.
    const actual = existing.actual && typeof existing.actual === 'object' && !Array.isArray(existing.actual) ? existing.actual : {};
    const updated = await (this.prisma as any).copyReconciliationRecord.update({
      where: { id: recordId },
      data: {
        resolved: true,
        resolvedBy: actorId,
        resolvedAt: new Date(),
        ...(notes ? { actual: { ...actual, _resolution: { notes } } } : {}),
      },
    });
    return updated;
  }

  async listRecords(tenantId: string, filters?: { resolved?: boolean; category?: CopyReconciliationCategory; severity?: CopyReconciliationSeverity; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = {
      tenantId,
      ...(filters?.resolved !== undefined ? { resolved: filters.resolved } : {}),
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.severity ? { severity: filters.severity } : {}),
    };
    const [data, total] = await Promise.all([
      (this.prisma as any).copyReconciliationRecord?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).copyReconciliationRecord?.count({ where }) || 0,
    ]);
    return { data, total };
  }
}
