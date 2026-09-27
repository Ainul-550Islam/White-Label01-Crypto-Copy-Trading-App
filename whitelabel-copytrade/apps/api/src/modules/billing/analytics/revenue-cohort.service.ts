import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  CohortDefinition,
  CohortMetrics,
  CohortAnalysis,
  MoneyAmount,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
  calculateRate,
} from './revenue-analytics.types';

/**
 * Cohort analysis by signup/subscription start period, retention, recurring revenue, churn, revenue movement.
 * Explicit cohort definition in result, no mixing definitions in one metric.
 */
@Injectable()
export class RevenueCohortService {
  private readonly logger = new Logger(RevenueCohortService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateCohorts(params: {
    currency?: string;
    definition: CohortDefinition;
    period: ReportingPeriod; // Overall analysis period
    retentionPeriods?: number; // Number of months to track retention
  }): Promise<CohortAnalysis> {
    const currency = (params.currency || 'USD').toUpperCase();
    const { start, end } = this.parsePeriod(params.period);
    const retentionPeriods = params.retentionPeriods || 12;

    // Fetch subscriptions grouped by cohort definition
    const subscriptions = await this.fetchSubscriptionsForCohort({ definition: params.definition, start, end, currency });

    // Group by cohort period (YYYY-MM)
    const cohortGroups = new Map<string, any[]>();
    for (const sub of subscriptions) {
      const cohortKey = this.getCohortKey(sub, params.definition);
      if (!cohortKey) continue;
      if (!cohortGroups.has(cohortKey)) cohortGroups.set(cohortKey, []);
      cohortGroups.get(cohortKey)!.push(sub);
    }

    const cohorts: CohortMetrics[] = [];
    const retentionMatrix: { cohortPeriod: string; periods: { period: string; retained: number; rate: string }[] }[] = [];

    for (const [cohortPeriod, subs] of cohortGroups.entries()) {
      const cohortSize = subs.length;
      const cohortDate = new Date(cohortPeriod + '-01');

      // For each retention period (month offset), calculate retained
      const periods: { period: string; retained: number; rate: string }[] = [];
      let cumulativeRevenueMinor = 0;

      for (let offset = 0; offset < retentionPeriods; offset++) {
        const retentionDate = new Date(cohortDate);
        retentionDate.setMonth(retentionDate.getMonth() + offset);
        const retentionKey = retentionDate.toISOString().slice(0, 7);

        // Count retained: subscriptions that are still active at retentionDate
        let retained = 0;
        let periodRevenueMinor = 0;

        for (const sub of subs) {
          const subStart = new Date(sub.createdAt);
          const subEnd = new Date(sub.currentPeriodEnd);

          // If subscription period includes retentionDate, it's retained
          if (subStart <= retentionDate && subEnd >= retentionDate) {
            retained++;
            // Revenue for this period: price normalized
            const plan = sub.plan;
            if (plan && plan.currency?.toUpperCase() === currency) {
              const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', currency);
              let mrrMinor = 0;
              switch (plan.interval) {
                case 'MONTHLY':
                  mrrMinor = priceMinor;
                  break;
                case 'QUARTERLY':
                  mrrMinor = Math.round(priceMinor / 3);
                  break;
                case 'YEARLY':
                  mrrMinor = Math.round(priceMinor / 12);
                  break;
                default:
                  mrrMinor = 0;
              }
              periodRevenueMinor += mrrMinor * (sub.seatsPurchased || 1);
            }
          }
        }

        cumulativeRevenueMinor += periodRevenueMinor;
        const rate = calculateRate(retained, cohortSize);

        periods.push({ period: retentionKey, retained, rate });

        // For first period (offset 0), create cohort metrics
        if (offset === 0) {
          const retainedCount = retained;
          const churnedCount = cohortSize - retainedCount;
          const retentionRate = calculateRate(retainedCount, cohortSize);
          const churnRate = calculateRate(churnedCount, cohortSize);

          // Calculate recurring revenue for cohort in current overall period
          let recurringMinor = 0;
          for (const sub of subs) {
            const plan = sub.plan;
            if (plan && plan.currency?.toUpperCase() === currency) {
              const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', currency);
              let mrrMinor = 0;
              switch (plan.interval) {
                case 'MONTHLY':
                  mrrMinor = priceMinor;
                  break;
                case 'QUARTERLY':
                  mrrMinor = Math.round(priceMinor / 3);
                  break;
                case 'YEARLY':
                  mrrMinor = Math.round(priceMinor / 12);
                  break;
                default:
                  mrrMinor = 0;
              }
              recurringMinor += mrrMinor * (sub.seatsPurchased || 1);
            }
          }

          const avgRevenueMinor = cohortSize > 0 ? Math.round(recurringMinor / cohortSize) : 0;

          cohorts.push({
            cohortDefinition: params.definition,
            cohortPeriod,
            period: params.period,
            currency,
            cohortSize,
            retainedCount,
            retentionRate,
            churnedCount,
            churnRate,
            recurringRevenue: { amount: formatFromMinorUnits(recurringMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
            cumulativeRevenue: { amount: formatFromMinorUnits(cumulativeRevenueMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
            averageRevenuePerCustomer: { amount: formatFromMinorUnits(avgRevenueMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
            calculatedAt: new Date().toISOString(),
          });
        }
      }

      retentionMatrix.push({ cohortPeriod, periods });
    }

    // Sort cohorts by period
    cohorts.sort((a, b) => a.cohortPeriod.localeCompare(b.cohortPeriod));
    retentionMatrix.sort((a, b) => a.cohortPeriod.localeCompare(b.cohortPeriod));

    return {
      definition: params.definition,
      currency,
      cohorts,
      retentionMatrix,
      calculatedAt: new Date().toISOString(),
    };
  }

  private getCohortKey(sub: any, definition: CohortDefinition): string | null {
    try {
      switch (definition) {
        case CohortDefinition.SIGNUP_MONTH:
          // Use tenant createdAt or subscription createdAt as signup proxy
          return new Date(sub.createdAt).toISOString().slice(0, 7);
        case CohortDefinition.FIRST_SUBSCRIPTION_MONTH:
          return new Date(sub.createdAt).toISOString().slice(0, 7);
        case CohortDefinition.FIRST_PAID_MONTH:
          // Use first paid invoice or payment date if available, fallback to subscription
          if (sub.metadata && (sub.metadata as any).firstPaidAt) {
            return new Date((sub.metadata as any).firstPaidAt).toISOString().slice(0, 7);
          }
          return new Date(sub.createdAt).toISOString().slice(0, 7);
        default:
          return new Date(sub.createdAt).toISOString().slice(0, 7);
      }
    } catch {
      return null;
    }
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
  }

  private async fetchSubscriptionsForCohort(params: {
    definition: CohortDefinition;
    start: Date;
    end: Date;
    currency: string;
  }): Promise<any[]> {
    try {
      const where: any = {
        createdAt: { gte: params.start, lte: params.end },
      };
      const subs = await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
      return subs.filter((s: any) => !s.plan || s.plan.currency?.toUpperCase() === params.currency);
    } catch (e: any) {
      this.logger.warn(`Failed to fetch subscriptions for cohort: ${e.message}`);
      return [];
    }
  }
}
