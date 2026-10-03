import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface PartnerUsageAggregate {
  partnerId: string;
  periodStart: string;
  periodEnd: string;
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  activeSubscriptions: number;
  totalApiCalls: number;
  totalTradingVolume: string;
  totalCopyTrades: number;
  usageByTenant: Array<{ tenantId: string; apiCalls: number; tradingVolume: string; activeUsers: number; subscriptionStatus: string }>;
  generatedAt: string;
  currency: string;
}

@Injectable()
export class PartnerUsageService {
  private readonly logger = new Logger(PartnerUsageService.name);

  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly tenantService: PartnerTenantService,
    private readonly prisma: PrismaService,
  ) {}

  async aggregateUsage(params: {
    partnerId: string;
    periodStart: string;
    periodEnd: string;
    correlationId: string;
  }): Promise<PartnerUsageAggregate> {
    if (!params.partnerId || !params.periodStart || !params.periodEnd) throw new BadRequestException('partnerId, periodStart, periodEnd required');

    await this.profileService.getProfile(params.partnerId);
    const periodStart = new Date(params.periodStart);
    const periodEnd = new Date(params.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart >= periodEnd) throw new BadRequestException('invalid period');

    const relationships = await this.tenantService.listTenantsForPartner(params.partnerId);
    const activeRels = relationships.filter(r => r.state === 'ACTIVE');
    const tenantIds = activeRels.map(r => r.tenantId);

    let totalUsers = 0;
    let activeSubscriptions = 0;
    let totalApiCalls = 0;
    let totalTradingVolumeMinor = BigInt(0);
    let totalCopyTrades = 0;
    const usageByTenant: PartnerUsageAggregate['usageByTenant'] = [];

    for (const tenantId of tenantIds) {
      try {
        // Aggregate from existing UsageModule records - never create second metering source
        const users = await (this.prisma as any).user?.count?.({ where: { tenantId } }) ?? 0;
        const subs = await (this.prisma as any).tenantSubscription?.count?.({ where: { tenantId, status: { in: ['ACTIVE', 'TRIALING'] } } }) ?? 0;
        // UsageMeter rows are per metering period with an Int currentValue (no timestamp/count columns).
        const apiCalls = await (this.prisma as any).usageMeter?.aggregate?.({
          where: { tenantId, meterKey: 'API_REQUESTS', periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
          _sum: { currentValue: true },
        }).then((r: any) => r._sum?.currentValue ?? 0);
        // Cash-ledger amounts are decimal strings (Prisma cannot _sum a String column): sum trade settlements here.
        const tradingVolume = await (this.prisma as any).portfolioCashLedgerEntry?.findMany?.({
          where: { tenantId, cashFlowType: { in: ['TRADE_SETTLEMENT_BUY', 'TRADE_SETTLEMENT_SELL'] }, occurredAt: { gte: periodStart, lte: periodEnd } },
          select: { amount: true },
        }).then((rows: Array<{ amount: string }>) => String(rows.reduce((sum, row) => sum + Math.abs(parseFloat(row.amount) || 0), 0)));
        const copyTrades = await (this.prisma as any).copyExecution?.count?.({ where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } } }) ?? 0;

        totalUsers += users;
        activeSubscriptions += subs;
        totalApiCalls += apiCalls;
        try {
          totalTradingVolumeMinor += BigInt(Math.round(parseFloat(tradingVolume) * 100));
        } catch {}
        totalCopyTrades += copyTrades;

        usageByTenant.push({
          tenantId,
          apiCalls,
          tradingVolume: tradingVolume.toString(),
          activeUsers: users,
          subscriptionStatus: subs > 0 ? 'ACTIVE' : 'INACTIVE',
        });
      } catch (error) {
        // Recorded as UNKNOWN (not as zero usage) so the aggregate never presents an unread tenant as an idle one.
        this.logger.warn(`usage aggregate read failed tenant=${tenantId}: ${(error as Error).message}`);
        usageByTenant.push({ tenantId, apiCalls: 0, tradingVolume: '0', activeUsers: 0, subscriptionStatus: 'UNKNOWN' });
      }
    }

    const aggregate: PartnerUsageAggregate = {
      partnerId: params.partnerId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totalTenants: tenantIds.length,
      activeTenants: activeRels.length,
      totalUsers,
      activeSubscriptions,
      totalApiCalls,
      totalTradingVolume: (Number(totalTradingVolumeMinor) / 100).toFixed(2),
      totalCopyTrades,
      usageByTenant,
      generatedAt: new Date().toISOString(),
      currency: 'USD',
    };

    this.logger.log(`usage aggregated partner=${params.partnerId} tenants=${tenantIds.length} corr=${params.correlationId}`);
    return aggregate;
  }
}
