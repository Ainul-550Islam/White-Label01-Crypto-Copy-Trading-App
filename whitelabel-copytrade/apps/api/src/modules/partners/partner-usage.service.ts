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
        const apiCalls = await (this.prisma as any).usageMeter?.aggregate?.({ where: { tenantId, timestamp: { gte: periodStart, lte: periodEnd } }, _sum: { count: true } }).then((r: any) => r._sum?.count ?? 0).catch(() => 0);
        const tradingVolume = await (this.prisma as any).portfolioCashLedgerEntry?.aggregate?.({ where: { tenantId, createdAt: { gte: periodStart, lte: periodEnd } }, _sum: { amount: true } }).then((r: any) => r._sum?.amount ?? '0').catch(() => '0');
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
      } catch {
        this.logger.debug(`usage aggregate fallback tenant=${tenantId}`);
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
