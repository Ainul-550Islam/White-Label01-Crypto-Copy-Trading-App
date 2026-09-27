import { Injectable, Logger } from '@nestjs/common';
import { UsageEventRepository } from './usage-event.repository';
import { UsageMeterRepository } from './usage-meter.repository';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MeterKey, UsageScope, ENFORCED_METER_TO_LIMIT_KEY } from './usage-metering.types';

/**
 * Compares runtime counters against durable metering totals and identifies
 * drift, duplicates, missing events, impossible usage, period mismatch, negative usage.
 * Never silently rewrites financial/commercial history.
 */
@Injectable()
export class UsageReconciliationService {
  private readonly logger = new Logger(UsageReconciliationService.name);

  constructor(
    private readonly eventRepository: UsageEventRepository,
    private readonly meterRepository: UsageMeterRepository,
    private readonly prisma: PrismaService,
  ) {}

  async reconcileTenant(
    tenantId: string,
    options?: { meterKey?: MeterKey; periodId?: string; fromDate?: Date; toDate?: Date },
  ): Promise<{
    tenantId: string;
    checkedMeters: number;
    issues: any[];
    summary: { critical: number; high: number; medium: number; low: number };
  }> {
    const issues: any[] = [];
    let checkedMeters = 0;

    const meterKeys = options?.meterKey ? [options.meterKey] : Object.values(MeterKey);

    for (const meterKey of meterKeys) {
      checkedMeters++;

      try {
        // Get durable totals
        const durableTotals = await this.meterRepository.getTenantTotals(tenantId, meterKey, undefined, options?.fromDate, options?.toDate);
        const durableTotal = durableTotals.reduce((sum, t) => sum + t.totalQuantity, 0);

        // Get runtime counter (actual DB counts or Redis) for enforced meters
        let runtimeTotal: number | null = null;

        if ([MeterKey.USERS, MeterKey.TRADERS].includes(meterKey)) {
          try {
            if (meterKey === MeterKey.USERS) {
              runtimeTotal = await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
            } else if (meterKey === MeterKey.TRADERS) {
              runtimeTotal = await (this.prisma as any).tradingAccount?.count({ where: { tenantId, deletedAt: null } }) || null;
            }
          } catch {}
        }

        // For other meters, try to get from events
        if (runtimeTotal === null) {
          const events = await this.eventRepository.listByTenant(tenantId, {
            meterKey,
            fromDate: options?.fromDate,
            toDate: options?.toDate,
            limit: 10000,
          });
          const eventTotal = events.reduce((sum, e) => sum + e.quantity, 0);

          // Compare bucket totals vs event totals for drift
          if (Math.abs(durableTotal - eventTotal) > 0) {
            issues.push({
              severity: 'MEDIUM',
              category: 'AGGREGATE_DRIFT',
              meterKey,
              tenantId,
              detectedValue: durableTotal,
              expectedValue: eventTotal,
              description: `Bucket total ${durableTotal} != event sum ${eventTotal} for meter ${meterKey}`,
              detectedAt: new Date().toISOString(),
            });
          }

          // Check for duplicate events (same sourceId)
          const sourceMap = new Map<string, number>();
          for (const event of events) {
            sourceMap.set(event.sourceId, (sourceMap.get(event.sourceId) || 0) + 1);
          }
          for (const [sourceId, count] of sourceMap) {
            if (count > 1) {
              issues.push({
                severity: 'HIGH',
                category: 'DUPLICATE_EVENT',
                meterKey,
                tenantId,
                sourceId,
                detectedValue: count,
                expectedValue: 1,
                description: `Duplicate usage events for source ${sourceId} meter ${meterKey}: count=${count}`,
                detectedAt: new Date().toISOString(),
              });
            }
          }

          // Check for negative usage
          for (const event of events) {
            if (event.quantity < 0) {
              issues.push({
                severity: 'CRITICAL',
                category: 'NEGATIVE_USAGE',
                meterKey,
                tenantId,
                sourceId: event.sourceId,
                detectedValue: event.quantity,
                expectedValue: 0,
                description: `Negative usage quantity ${event.quantity} for event ${event.id}`,
                detectedAt: new Date().toISOString(),
              });
            }
          }

          // Check for impossible usage (e.g., more users than can exist)
          // For count meters, quantity should be 1 per event typically
          if ([MeterKey.USERS, MeterKey.TRADERS, MeterKey.FOLLOWERS, MeterKey.EXCHANGE_ACCOUNTS, MeterKey.COPY_SUBSCRIPTIONS].includes(meterKey)) {
            for (const event of events) {
              if (event.quantity > 1) {
                issues.push({
                  severity: 'MEDIUM',
                  category: 'IMPOSSIBLE_USAGE',
                  meterKey,
                  tenantId,
                  sourceId: event.sourceId,
                  detectedValue: event.quantity,
                  expectedValue: 1,
                  description: `Count meter ${meterKey} has quantity ${event.quantity} > 1 for single event`,
                  detectedAt: new Date().toISOString(),
                });
              }
            }
          }

          continue;
        }

        // Compare runtime vs durable for count meters
        if (runtimeTotal !== null) {
          const drift = Math.abs(runtimeTotal - durableTotal);
          const threshold = Math.max(1, Math.floor(runtimeTotal * 0.05)); // 5% threshold

          if (drift > threshold) {
            issues.push({
              severity: drift > runtimeTotal * 0.2 ? 'HIGH' : 'MEDIUM',
              category: 'COUNTER_DRIFT',
              meterKey,
              tenantId,
              detectedValue: durableTotal,
              expectedValue: runtimeTotal,
              description: `Counter drift for ${meterKey}: durable=${durableTotal} runtime=${runtimeTotal} drift=${drift}`,
              detectedAt: new Date().toISOString(),
            });
          }
        }

        // Check for missing events (runtime has more than durable)
        if (runtimeTotal !== null && runtimeTotal > durableTotal) {
          const missing = runtimeTotal - durableTotal;
          if (missing > 0) {
            issues.push({
              severity: 'MEDIUM',
              category: 'MISSING_EVENT',
              meterKey,
              tenantId,
              detectedValue: durableTotal,
              expectedValue: runtimeTotal,
              description: `Missing usage events for ${meterKey}: durable=${durableTotal} runtime=${runtimeTotal} missing=${missing}`,
              detectedAt: new Date().toISOString(),
            });
          }
        }

        // Period mismatch check
        const events = await this.eventRepository.listByTenant(tenantId, {
          meterKey,
          fromDate: options?.fromDate,
          toDate: options?.toDate,
          limit: 100,
        });

        for (const event of events) {
          const periodStart = new Date(event.periodStart);
          const periodEnd = new Date(event.periodEnd);
          const eventTime = new Date(event.timestamp);

          if (eventTime < periodStart || eventTime >= periodEnd) {
            issues.push({
              severity: 'LOW',
              category: 'PERIOD_MISMATCH',
              meterKey,
              tenantId,
              sourceId: event.sourceId,
              detectedValue: eventTime.toISOString(),
              expectedValue: `${periodStart.toISOString()} - ${periodEnd.toISOString()}`,
              description: `Event timestamp ${eventTime.toISOString()} outside period ${event.periodId} [${periodStart.toISOString()}, ${periodEnd.toISOString()})`,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      } catch (e) {
        this.logger.warn(`Reconciliation failed for meter ${meterKey}: ${(e as Error).message}`);
        issues.push({
          severity: 'LOW',
          category: 'RECONCILIATION_ERROR',
          meterKey,
          tenantId,
          description: `Reconciliation error for ${meterKey}: ${(e as Error).message}`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    const summary = {
      critical: issues.filter((i) => i.severity === 'CRITICAL').length,
      high: issues.filter((i) => i.severity === 'HIGH').length,
      medium: issues.filter((i) => i.severity === 'MEDIUM').length,
      low: issues.filter((i) => i.severity === 'LOW').length,
    };

    this.logger.log(`Usage reconciliation tenant=${tenantId} checked=${checkedMeters} issues=${issues.length} critical=${summary.critical} high=${summary.high}`);

    return {
      tenantId,
      checkedMeters,
      issues,
      summary,
    };
  }

  async reconcileAllTenants(options?: { fromDate?: Date; toDate?: Date }): Promise<any[]> {
    // In real implementation, iterate all tenants
    return [];
  }
}
