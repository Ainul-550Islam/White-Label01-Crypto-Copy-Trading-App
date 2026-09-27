import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlansService } from '../plans.service';
import { SubscriptionsService } from '../subscriptions.service';
import { UsageMeterRepository } from './usage-meter.repository';
import { UsagePeriodService } from './usage-period.service';
import { MeterKey, UsageScope, QuotaSnapshot, ENFORCED_METER_TO_LIMIT_KEY } from './usage-metering.types';

/**
 * Produces authoritative quota snapshots by combining canonical plan limits with metered usage.
 * Do NOT duplicate limit values - always resolve from plan.
 * Aligns with Part 2 enforcement limit keys.
 */
@Injectable()
export class QuotaSnapshotService {
  private readonly logger = new Logger(QuotaSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly meterRepository: UsageMeterRepository,
    private readonly periodService: UsagePeriodService,
  ) {}

  async getQuotaSnapshot(params: {
    tenantId: string;
    meterKey: MeterKey;
    scope: UsageScope;
    subjectId?: string;
    periodId?: string;
  }): Promise<QuotaSnapshot> {
    const meterDef = this.meterRepository.getMeterDefinition(params.meterKey);
    if (!meterDef) {
      throw new Error(`Invalid meter key: ${params.meterKey}`);
    }

    const limitKey = ENFORCED_METER_TO_LIMIT_KEY[params.meterKey];
    let maximum: number | null = null;
    let planCode: string | null = null;
    let isEnforced = meterDef.isEnforced;

    // Resolve canonical plan limits if enforced meter
    if (limitKey) {
      try {
        const subscription = await this.subscriptionsService.getCurrent(params.tenantId);
        if (subscription) {
          const plan = subscription.plan as any;
          if (plan) {
            planCode = plan.code || null;
            const limits = plan.limits as any;
            if (limits && limits[limitKey] !== undefined) {
              maximum = limits[limitKey];
              // Boolean limits mean unlimited or feature toggle, not numeric
              if (typeof maximum === 'boolean') {
                maximum = null;
              }
            }
          }
        }
      } catch (e) {
        this.logger.warn(`Failed to resolve plan limits for ${params.tenantId} limitKey=${limitKey}: ${(e as Error).message}`);
      }

      // Also check tenant overrides (maxUsers, maxTraders) from tenant table
      if (limitKey === 'maxUsers' || limitKey === 'maxTraders') {
        try {
          const tenant = await this.prisma.tenant.findUnique({
            where: { id: params.tenantId },
            select: { maxUsers: true, maxTraders: true },
          });
          if (tenant) {
            if (limitKey === 'maxUsers' && tenant.maxUsers !== null) {
              maximum = tenant.maxUsers;
            }
            if (limitKey === 'maxTraders' && tenant.maxTraders !== null) {
              maximum = tenant.maxTraders;
            }
          }
        } catch {}
      }
    }

    // Get current usage from durable metering
    let current = 0;
    let periodId = params.periodId;
    let periodStart: string;
    let periodEnd: string;

    if (!periodId) {
      const period = this.periodService.getCurrentCalendarMonthPeriod(params.tenantId);
      periodId = period.id;
      periodStart = period.start;
      periodEnd = period.end;
    } else {
      // Try to parse periodId to get start/end, fallback to current month
      const period = this.periodService.getCurrentCalendarMonthPeriod(params.tenantId);
      periodStart = period.start;
      periodEnd = period.end;
    }

    try {
      const total = await this.meterRepository.getCurrentPeriodTotal({
        tenantId: params.tenantId,
        meterKey: params.meterKey,
        scope: params.scope,
        subjectId: params.subjectId,
        periodId,
      });
      current = total.totalQuantity;

      // For count-based meters that are not period-based (users, traders), get actual DB counts
      // to ensure quota snapshot matches canonical truth, not just metered events
      if ([MeterKey.USERS, MeterKey.TRADERS].includes(params.meterKey) && params.scope === UsageScope.TENANT) {
        // Use actual counts from DB for these meters to align with enforcement
        try {
          if (params.meterKey === MeterKey.USERS) {
            current = await this.prisma.user.count({ where: { tenantId: params.tenantId, deletedAt: null } });
          } else if (params.meterKey === MeterKey.TRADERS) {
            current = await (this.prisma as any).tradingAccount?.count({ where: { tenantId: params.tenantId, deletedAt: null } }) || current;
          }
        } catch {}
      }
    } catch (e) {
      this.logger.warn(`Failed to get current usage for ${params.tenantId} meter=${params.meterKey}: ${(e as Error).message}`);
    }

    // Calculate remaining and utilization
    let remaining: number | null = null;
    let utilizationPercent: number | null = null;
    let status: QuotaSnapshot['status'] = 'OK';

    if (maximum === null) {
      remaining = null;
      utilizationPercent = null;
      status = 'UNLIMITED';
    } else {
      remaining = Math.max(0, maximum - current);
      utilizationPercent = maximum > 0 ? Math.min(100, Math.round((current / maximum) * 100)) : current > 0 ? 100 : 0;

      if (current >= maximum) {
        status = current > maximum ? 'OVER_LIMIT' : 'AT_LIMIT';
      } else if (utilizationPercent >= 90) {
        status = 'APPROACHING';
      } else {
        status = 'OK';
      }
    }

    const period = this.periodService.getCurrentCalendarMonthPeriod(params.tenantId);
    if (!periodId) periodId = period.id;
    if (!periodStart!) periodStart = period.start;
    if (!periodEnd!) periodEnd = period.end;

    const snapshot: QuotaSnapshot = {
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      limitKey: limitKey || params.meterKey,
      scope: params.scope,
      subjectId: params.subjectId,
      maximum,
      current,
      remaining,
      utilizationPercent,
      status,
      periodId,
      periodStart,
      periodEnd,
      fetchedAt: new Date().toISOString(),
      planCode,
      isEnforced,
    };

    this.logger.log(`Quota snapshot tenant=${params.tenantId} meter=${params.meterKey} current=${current} max=${maximum} remaining=${remaining} util=${utilizationPercent}% status=${status}`);

    return snapshot;
  }

  async getTenantQuotaOverview(tenantId: string, periodId?: string): Promise<QuotaSnapshot[]> {
    const snapshots: QuotaSnapshot[] = [];

    // Get snapshots for all enforced meters
    const enforcedMeters = [MeterKey.USERS, MeterKey.TRADERS, MeterKey.FOLLOWERS, MeterKey.EXCHANGE_ACCOUNTS, MeterKey.COPY_SUBSCRIPTIONS, MeterKey.API_REQUESTS, MeterKey.WEBSOCKET_CONNECTIONS];

    for (const meterKey of enforcedMeters) {
      try {
        const meterDef = this.meterRepository.getMeterDefinition(meterKey);
        if (!meterDef) continue;

        // For per-trader/per-user scoped meters, we need to get tenant-level overview
        // For simplicity, get tenant scope snapshot
        const scope = meterKey === MeterKey.FOLLOWERS ? UsageScope.TENANT : meterKey === MeterKey.EXCHANGE_ACCOUNTS ? UsageScope.TENANT : meterKey === MeterKey.COPY_SUBSCRIPTIONS ? UsageScope.TENANT : UsageScope.TENANT;

        const snapshot = await this.getQuotaSnapshot({
          tenantId,
          meterKey,
          scope,
          periodId,
        });

        snapshots.push(snapshot);
      } catch (e) {
        this.logger.warn(`Failed to get quota snapshot for ${meterKey}: ${(e as Error).message}`);
      }
    }

    // Also include informational meters
    const infoMeters = [MeterKey.TRADING_VOLUME, MeterKey.COPY_TRADING_VOLUME, MeterKey.ORDERS, MeterKey.FILLS];
    for (const meterKey of infoMeters) {
      try {
        const snapshot = await this.getQuotaSnapshot({
          tenantId,
          meterKey,
          scope: UsageScope.TENANT,
          periodId,
        });
        snapshots.push(snapshot);
      } catch {}
    }

    return snapshots;
  }

  async getResourceQuotaSnapshot(params: { tenantId: string; scope: UsageScope; subjectId: string; meterKey: MeterKey; periodId?: string }): Promise<QuotaSnapshot> {
    return this.getQuotaSnapshot({
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      scope: params.scope,
      subjectId: params.subjectId,
      periodId: params.periodId,
    });
  }
}
