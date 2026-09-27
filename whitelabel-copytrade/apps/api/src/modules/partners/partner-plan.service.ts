import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerPlanService {
  private readonly logger = new Logger(PartnerPlanService.name);

  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly agreementService: PartnerAgreementService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolves which existing subscription plans a partner may sell
   * Never duplicates plan definitions, never hardcodes prices
   */
  async getEligiblePlans(partnerId: string): Promise<any[]> {
    const profile = await this.profileService.getProfile(partnerId);
    const agreement = await this.agreementService.getActiveAgreement(partnerId);
    if (!agreement) throw new BadRequestException(`partner ${partnerId} has no active agreement`);

    // Fetch canonical plans from existing catalog
    let canonicalPlans: any[] = [];
    try {
      canonicalPlans = await (this.prisma as any).subscriptionPlan?.findMany?.({
        where: { deletedAt: null, isActive: true },
        take: 200,
        orderBy: { createdAt: 'asc' },
      }) ?? [];
    } catch {
      this.logger.debug('canonical plans fetch fallback');
    }

    if (canonicalPlans.length === 0) {
      this.logger.warn(`no canonical plans found for partner ${partnerId}`);
      return [];
    }

    // Filter by pricingRules from agreement
    const allowedPlanCodes = new Set(
      agreement.pricingRules.filter(r => r.allowed).map(r => r.planCode)
    );

    // If pricingRules empty, allow all (policy-driven)
    const eligible = allowedPlanCodes.size === 0
      ? canonicalPlans
      : canonicalPlans.filter((p: any) => allowedPlanCodes.has(p.code) || allowedPlanCodes.has(p.id));

    this.logger.log(`eligible plans partner=${partnerId} total=${eligible.length} corr=plan-eligibility`);
    return eligible.map((p: any) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      interval: p.interval,
      isActive: p.isActive,
      trialDays: p.trialDays,
      // Never expose hardcoded prices from partner module - return from canonical source
      price: p.price ?? p.amount ?? null,
      currency: p.currency ?? 'USD',
      limits: p.limits,
      features: p.features,
      agreementVersion: `v${agreement.version}`,
      policyVersion: agreement.commissionPolicy.policyVersion,
    }));
  }

  async isPlanEligible(partnerId: string, planCode: string): Promise<boolean> {
    const eligible = await this.getEligiblePlans(partnerId);
    return eligible.some(p => p.code === planCode || p.id === planCode);
  }

  async assertPlanEligible(partnerId: string, planCode: string): Promise<void> {
    const eligible = await this.isPlanEligible(partnerId, planCode);
    if (!eligible) throw new BadRequestException(`plan ${planCode} not eligible for partner ${partnerId}`);
  }
}
