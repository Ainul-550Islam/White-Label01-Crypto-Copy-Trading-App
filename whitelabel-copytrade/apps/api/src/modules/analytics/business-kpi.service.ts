// # Responsibility: computes read-only trading and billing KPIs from persisted evidence with currency-separated exact arithmetic.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

function addExact(buckets: Map<string, Prisma.Decimal>, currency: string, amount: string | Prisma.Decimal): void {
  const value = new Prisma.Decimal(amount);
  if (!value.isFinite()) throw new Error('Invalid persisted financial amount');
  buckets.set(currency, (buckets.get(currency) ?? new Prisma.Decimal(0)).plus(value));
}

@Injectable()
export class BusinessKpiService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot() {
    try {
      const [activeCopySubscriptions, traderCount, activeSubscribers, statements, revenue] = await Promise.all([
        this.prisma.copySubscription.count({ where: { state: { in: ['ACTIVE', 'PAUSED'] } } }),
        this.prisma.traderProfile.count({ where: { deletedAt: null } }),
        this.prisma.tenantSubscription.findMany({ where: { status: { in: ['ACTIVE', 'TRIALING'] } }, include: { plan: { select: { price: true, currency: true, interval: true } } } }),
        this.prisma.portfolioStatement.findMany({ where: { state: 'FINALIZED', closingNav: { not: null } }, select: { profileId: true, closingNav: true, baseCurrency: true, finalizedAt: true, createdAt: true }, orderBy: [{ finalizedAt: 'desc' }, { createdAt: 'desc' }] }),
        this.prisma.feeAccrual.findMany({ where: { status: 'SETTLED' }, select: { feeAmount: true, currency: true, updatedAt: true } }),
      ]);
      const latestNav = new Map<string, { currency: string; value: string }>();
      for (const row of statements) {
        if (row.closingNav !== null && !latestNav.has(row.profileId)) latestNav.set(row.profileId, { currency: row.baseCurrency.toUpperCase(), value: row.closingNav });
      }
      const aum = new Map<string, Prisma.Decimal>();
      for (const row of latestNav.values()) addExact(aum, row.currency, row.value);
      const settledFees = new Map<string, Prisma.Decimal>();
      for (const row of revenue) addExact(settledFees, row.currency.toUpperCase(), row.feeAmount);
      const mrr = new Map<string, Prisma.Decimal>();
      for (const sub of activeSubscribers) {
        const plan = sub.plan;
        let divisor = 1;
        if (plan.interval === 'QUARTERLY') divisor = 3;
        else if (plan.interval === 'YEARLY') divisor = 12;
        else if (plan.interval === 'LIFETIME') continue;
        addExact(mrr, plan.currency.toUpperCase(), new Prisma.Decimal(plan.price).dividedBy(divisor));
      }
      return {
        generatedAt: new Date().toISOString(),
        definitions: { activeCopySubscriptions: 'ACTIVE and PAUSED copy subscriptions', traders: 'Non-deleted trader profiles across authorized platform scope', aum: 'Latest finalized closing NAV per accounting profile, grouped by base currency', settledFeeRevenue: 'Settled fee accruals, grouped by native currency; not FX converted', mrr: 'Active and trialing plan price normalized to monthly; lifetime plans excluded' },
        activeCopySubscriptions,
        traderCount,
        accountingProfilesWithStatements: latestNav.size,
        aumByCurrency: Object.fromEntries([...aum].map(([currency, value]) => [currency, value.toFixed()])),
        settledFeeRevenueByCurrency: Object.fromEntries([...settledFees].map(([currency, value]) => [currency, value.toFixed()])),
        mrrByCurrency: Object.fromEntries([...mrr].map(([currency, value]) => [currency, value.toFixed()])),
        dataFreshness: { oldestIncludedFeeUpdatedAt: revenue.length ? new Date(Math.min(...revenue.map((r) => r.updatedAt.getTime()))).toISOString() : null, statementAsOf: statements[0]?.finalizedAt?.toISOString() ?? null },
      };
    } catch {
      throw new ServiceUnavailableException('Business KPI snapshot is temporarily unavailable');
    }
  }
}
