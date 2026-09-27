import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerSettlementService } from './partner-settlement.service';
import { PartnerPayoutService } from './partner-payout.service';
import { PartnerPerformanceService } from './partner-performance.service';
import { PartnerAnalyticsService } from './partner-analytics.service';
import { PartnerDiscountService } from './partner-discount.service';
import { PartnerReferralService } from './partner-referral.service';

@Injectable()
export class PartnerPortalService {
  private readonly logger = new Logger(PartnerPortalService.name);

  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly tenantService: PartnerTenantService,
    private readonly commissionLedger: PartnerCommissionLedgerService,
    private readonly settlementService: PartnerSettlementService,
    private readonly payoutService: PartnerPayoutService,
    private readonly performanceService: PartnerPerformanceService,
    private readonly analyticsService: PartnerAnalyticsService,
    private readonly discountService: PartnerDiscountService,
    private readonly referralService: PartnerReferralService,
  ) {}

  /**
   * Produces partner-safe portal data, enforcing partner scope
   * Partner only sees authorized tenants, revenue, commissions, analytics, campaigns, payout info
   */
  async getPortalData(params: {
    partnerId: string;
    userId: string;
    correlationId: string;
    currency?: string;
    periodStart?: string;
    periodEnd?: string;
  }) {
    if (!params.partnerId || !params.userId) throw new BadRequestException('partnerId and userId required');

    const profile = await this.profileService.getProfile(params.partnerId);
    const relationships = await this.tenantService.listTenantsForPartner(params.partnerId);
    const activeTenants = relationships.filter(r => r.state === 'ACTIVE');

    const currency = (params.currency ?? profile.currency ?? 'USD').toUpperCase();

    const [commissions, settlements, payouts, campaigns, referrals] = await Promise.all([
      this.commissionLedger.listCommissions(params.partnerId, { currency }),
      this.settlementService.listSettlements(params.partnerId, { currency }),
      this.payoutService.listPayouts(params.partnerId),
      this.discountService.listCampaigns(params.partnerId),
      this.referralService.listReferrals(params.partnerId),
    ]);

    const performance = await this.performanceService.calculatePerformance({
      partnerId: params.partnerId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      currency,
      correlationId: params.correlationId,
    });

    // Filter to only authorized data - partner cannot see another partner's customers
    // Already filtered by partnerId in services

    const portalData = {
      partner: {
        id: profile.id,
        code: profile.code,
        name: profile.name,
        type: profile.type,
        state: profile.state,
        currency: profile.currency,
        policyVersion: profile.policyVersion,
        agreementVersion: profile.agreementVersion,
      },
      tenants: {
        total: relationships.length,
        active: activeTenants.length,
        list: activeTenants.map(r => ({
          tenantId: r.tenantId,
          relationshipType: r.relationshipType,
          state: r.state,
          assignedAt: r.assignedAt,
          isPrimary: r.isPrimary,
        })),
      },
      revenue: {
        grossAttributedRevenue: performance.grossAttributedRevenue,
        netEligibleRevenue: performance.netEligibleRevenue,
        mrrAttributed: performance.mrrAttributed,
        currency,
      },
      commissions: {
        accrued: performance.commissionAccrued,
        reversed: performance.commissionReversed,
        payable: performance.commissionPayable,
        paid: performance.commissionPaid,
        pendingSettlement: performance.pendingSettlement,
        pendingPayout: performance.pendingPayout,
        count: commissions.length,
        recent: commissions.slice(0, 10).map(c => ({
          id: c.id,
          tenantId: c.tenantId,
          amount: c.commissionAmount,
          currency: c.currency,
          state: c.state,
          accruedAt: c.accruedAt,
          basis: c.commissionBasis,
          model: c.commissionModel,
        })),
      },
      settlements: {
        total: settlements.length,
        pending: settlements.filter(s => ['OPEN', 'RECONCILING', 'RECONCILED', 'VALIDATED'].includes(s.state)).length,
        recent: settlements.slice(0, 5).map(s => ({
          id: s.id,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          currency: s.currency,
          state: s.state,
          totalPayable: s.totalCommissionPayable,
          commissionCount: s.commissionCount,
        })),
      },
      payouts: {
        total: payouts.length,
        pending: payouts.filter(p => ['REQUESTED', 'APPROVED', 'SUBMITTED', 'PROCESSING'].includes(p.state)).length,
        recent: payouts.slice(0, 5).map(p => ({
          id: p.id,
          settlementId: p.settlementId,
          amount: p.amount,
          currency: p.currency,
          state: p.state,
          method: p.method,
          requestedAt: p.requestedAt,
        })),
      },
      campaigns: {
        total: campaigns.length,
        active: campaigns.filter(c => c.state === 'ACTIVE').length,
        list: campaigns.slice(0, 10).map(c => ({
          id: c.id,
          code: c.code,
          name: c.name,
          state: c.state,
          discountType: c.discountType,
          discountValue: c.discountValue,
          currentUses: c.currentUses,
          maxUses: c.maxUses,
        })),
      },
      referrals: {
        total: referrals.length,
        active: referrals.filter(r => r.state === 'ACTIVE').length,
        list: referrals.slice(0, 10).map(r => ({
          id: r.id,
          code: r.code,
          state: r.state,
          currentUses: r.currentUses,
          maxUses: r.maxUses,
          expiresAt: r.expiresAt,
        })),
      },
      performance: {
        referredTenants: performance.referredTenants,
        activeTenants: performance.activeTenants,
        conversionRate: performance.conversionRate,
        churnRate: performance.churnRate,
        retentionRate: performance.customerRetentionRate,
        activeSubscriptions: performance.activeSubscriptions,
        refunds: performance.refunds,
        chargebacks: performance.chargebacks,
      },
      generatedAt: new Date().toISOString(),
      correlationId: params.correlationId,
    };

    this.logger.log(`portal data generated partner=${params.partnerId} tenants=${activeTenants.length} corr=${params.correlationId}`);
    return portalData;
  }

  async assertPartnerScope(userId: string, partnerId: string, tenantId?: string): Promise<void> {
    // Backend must resolve partner scope from authenticated identity and persisted relationships
    // Never trust x-tenant-id, partnerId query param, URL path, localStorage
    if (tenantId) {
      const relationships = await this.tenantService.listTenantsForPartner(partnerId);
      const hasAccess = relationships.some(r => r.tenantId === tenantId && r.state === 'ACTIVE');
      if (!hasAccess) throw new BadRequestException(`partner ${partnerId} has no access to tenant ${tenantId}`);
    }
  }
}
