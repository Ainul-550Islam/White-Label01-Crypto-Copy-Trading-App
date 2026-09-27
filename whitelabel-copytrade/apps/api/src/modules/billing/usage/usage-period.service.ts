import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UsagePeriod, PeriodType, PeriodStatus } from './usage-metering.types';
import { randomUUID } from 'crypto';

/**
 * Resolves billing/measurement periods, period start/end, reset boundaries,
 * timezone-safe date handling, and period status.
 * API rate-limit windows NOT replaced by monthly durable periods - this is for reporting/commercial periods.
 */
@Injectable()
export class UsagePeriodService {
  private readonly logger = new Logger(UsagePeriodService.name);

  constructor(private readonly prisma: PrismaService) {}

  getCurrentCalendarMonthPeriod(tenantId: string, timezone: string = 'UTC'): UsagePeriod {
    const now = new Date();
    const start = this.startOfMonthUTC(now);
    const end = this.endOfMonthUTC(now);

    return {
      id: `cal_month_${tenantId}_${start.getUTCFullYear()}_${start.getUTCMonth() + 1}`,
      tenantId,
      type: PeriodType.CALENDAR_MONTH,
      status: PeriodStatus.CURRENT,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone,
      isCurrent: true,
      subscriptionId: null,
      metadata: { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 },
    };
  }

  getCurrentCalendarDayPeriod(tenantId: string, timezone: string = 'UTC'): UsagePeriod {
    const now = new Date();
    const start = this.startOfDayUTC(now);
    const end = this.endOfDayUTC(now);

    return {
      id: `cal_day_${tenantId}_${start.toISOString().split('T')[0]}`,
      tenantId,
      type: PeriodType.CALENDAR_DAY,
      status: PeriodStatus.CURRENT,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone,
      isCurrent: true,
      subscriptionId: null,
    };
  }

  getCurrentHourPeriod(tenantId: string, timezone: string = 'UTC'): UsagePeriod {
    const now = new Date();
    const start = this.startOfHourUTC(now);
    const end = new Date(start.getTime() + 3600 * 1000);

    return {
      id: `cal_hour_${tenantId}_${start.toISOString()}`,
      tenantId,
      type: PeriodType.CALENDAR_HOUR,
      status: PeriodStatus.CURRENT,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone,
      isCurrent: true,
      subscriptionId: null,
    };
  }

  async getSubscriptionPeriod(tenantId: string): Promise<UsagePeriod> {
    try {
      const subscription = await (this.prisma as any).tenantSubscription?.findFirst({
        where: {
          tenantId,
          status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!subscription) {
        // Fallback to calendar month if no subscription
        return this.getCurrentCalendarMonthPeriod(tenantId);
      }

      const start = subscription.currentPeriodStart ? new Date(subscription.currentPeriodStart) : new Date();
      const end = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : this.endOfMonthUTC(start);

      const now = new Date();
      const isCurrent = now >= start && now < end;
      const status = isCurrent ? PeriodStatus.CURRENT : now < start ? PeriodStatus.FUTURE : PeriodStatus.CLOSED;

      return {
        id: `sub_period_${subscription.id}`,
        tenantId,
        type: PeriodType.SUBSCRIPTION_PERIOD,
        status,
        start: start.toISOString(),
        end: end.toISOString(),
        timezone: 'UTC',
        isCurrent,
        subscriptionId: subscription.id,
        metadata: {
          subscriptionStatus: subscription.status,
          planId: subscription.planId,
        },
      };
    } catch (error: any) {
      this.logger.warn(`Failed to get subscription period for ${tenantId}: ${error.message}`);
      return this.getCurrentCalendarMonthPeriod(tenantId);
    }
  }

  getRollingMinuteWindow(tenantId: string, windowMinutes: number = 1): UsagePeriod {
    const now = new Date();
    const windowMs = windowMinutes * 60 * 1000;
    const windowEpoch = Math.floor(now.getTime() / windowMs);
    const start = new Date(windowEpoch * windowMs);
    const end = new Date(start.getTime() + windowMs);

    return {
      id: `rolling_${windowMinutes}m_${tenantId}_${windowEpoch}`,
      tenantId,
      type: PeriodType.ROLLING_MINUTE,
      status: PeriodStatus.CURRENT,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: 'UTC',
      isCurrent: true,
      subscriptionId: null,
      metadata: { windowMinutes, windowEpoch },
    };
  }

  getPeriodForTimestamp(tenantId: string, timestamp: Date, type: PeriodType, timezone: string = 'UTC'): UsagePeriod {
    switch (type) {
      case PeriodType.CALENDAR_DAY:
        return {
          id: `cal_day_${tenantId}_${this.startOfDayUTC(timestamp).toISOString().split('T')[0]}`,
          tenantId,
          type,
          status: this.getPeriodStatus(timestamp, this.startOfDayUTC(timestamp), this.endOfDayUTC(timestamp)),
          start: this.startOfDayUTC(timestamp).toISOString(),
          end: this.endOfDayUTC(timestamp).toISOString(),
          timezone,
          isCurrent: this.isCurrentPeriod(timestamp, this.startOfDayUTC(timestamp), this.endOfDayUTC(timestamp)),
          subscriptionId: null,
        };
      case PeriodType.CALENDAR_MONTH:
        return {
          id: `cal_month_${tenantId}_${timestamp.getUTCFullYear()}_${timestamp.getUTCMonth() + 1}`,
          tenantId,
          type,
          status: this.getPeriodStatus(timestamp, this.startOfMonthUTC(timestamp), this.endOfMonthUTC(timestamp)),
          start: this.startOfMonthUTC(timestamp).toISOString(),
          end: this.endOfMonthUTC(timestamp).toISOString(),
          timezone,
          isCurrent: this.isCurrentPeriod(timestamp, this.startOfMonthUTC(timestamp), this.endOfMonthUTC(timestamp)),
          subscriptionId: null,
        };
      case PeriodType.CALENDAR_HOUR:
        const hourStart = this.startOfHourUTC(timestamp);
        return {
          id: `cal_hour_${tenantId}_${hourStart.toISOString()}`,
          tenantId,
          type,
          status: PeriodStatus.CURRENT,
          start: hourStart.toISOString(),
          end: new Date(hourStart.getTime() + 3600 * 1000).toISOString(),
          timezone,
          isCurrent: true,
          subscriptionId: null,
        };
      default:
        return this.getCurrentCalendarMonthPeriod(tenantId, timezone);
    }
  }

  getPreviousPeriod(currentPeriod: UsagePeriod): UsagePeriod {
    const start = new Date(currentPeriod.start);
    const end = new Date(currentPeriod.end);
    const duration = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime());
    const prevStart = new Date(prevEnd.getTime() - duration);

    return {
      id: `${currentPeriod.id}_prev`,
      tenantId: currentPeriod.tenantId,
      type: currentPeriod.type,
      status: PeriodStatus.CLOSED,
      start: prevStart.toISOString(),
      end: prevEnd.toISOString(),
      timezone: currentPeriod.timezone,
      isCurrent: false,
      subscriptionId: currentPeriod.subscriptionId,
    };
  }

  private startOfDayUTC(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  }

  private endOfDayUTC(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  }

  private startOfMonthUTC(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  }

  private endOfMonthUTC(date: Date): Date {
    const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return new Date(nextMonth.getTime() - 1);
  }

  private startOfHourUTC(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), 0, 0, 0));
  }

  private getPeriodStatus(timestamp: Date, start: Date, end: Date): PeriodStatus {
    const now = new Date();
    if (now < start) return PeriodStatus.FUTURE;
    if (now >= start && now < end) return PeriodStatus.CURRENT;
    return PeriodStatus.CLOSED;
  }

  private isCurrentPeriod(timestamp: Date, start: Date, end: Date): boolean {
    const now = new Date();
    return now >= start && now < end;
  }

  normalizeToUTC(date: Date): Date {
    return new Date(date.toISOString());
  }

  isDateInPeriod(date: Date, period: UsagePeriod): boolean {
    const d = date.getTime();
    const s = new Date(period.start).getTime();
    const e = new Date(period.end).getTime();
    return d >= s && d < e;
  }
}
