import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerPolicyService } from './partner-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface EffectivePrice {
  platformListPrice: string;
  partnerDiscount: string;
  customerNetPrice: string;
  currency: string;
  pricingPolicyVersion: string;
  agreementVersion: string;
  planCode: string;
  discountBasisPoints?: number;
  calculationVersion: string;
}

@Injectable()
export class PartnerPricingService {
  private readonly logger = new Logger(PartnerPricingService.name);

  constructor(
    private readonly agreementService: PartnerAgreementService,
    private readonly policyService: PartnerPolicyService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolves effective customer price from canonical SubscriptionPlan + approved partner pricing/discount policy
   * Uses Decimal-safe arithmetic and preserves original platform price, discount, net customer price
   */
  async resolveEffectivePrice(params: {
    partnerId: string;
    planCode: string;
    currency?: string;
    campaignId?: string;
    discountCode?: string;
  }): Promise<EffectivePrice> {
    if (!params.partnerId || !params.planCode) throw new BadRequestException('partnerId and planCode required');

    const agreement = await this.agreementService.getActiveAgreement(params.partnerId);
    if (!agreement) throw new BadRequestException(`no active agreement for partner ${params.partnerId}`);

    // Fetch canonical plan price - never hardcode
    let canonicalPlan: any = null;
    try {
      canonicalPlan = await (this.prisma as any).subscriptionPlan?.findFirst?.({ where: { code: params.planCode, deletedAt: null } })
        ?? await (this.prisma as any).subscriptionPlan?.findFirst?.({ where: { id: params.planCode } });
    } catch {
      this.logger.debug(`canonical plan fetch fallback planCode=${params.planCode}`);
    }

    if (!canonicalPlan) throw new BadRequestException(`canonical plan ${params.planCode} not found`);

    const platformListPrice = (canonicalPlan.price ?? canonicalPlan.amount ?? '0').toString();
    const planCurrency = (canonicalPlan.currency ?? 'USD').toUpperCase();
    const targetCurrency = (params.currency ?? planCurrency).toUpperCase();

    if (targetCurrency !== planCurrency) {
      // Multi-currency must remain explicit - check policy
      this.policyService.validateCurrency(agreement.commissionPolicy, targetCurrency);
    }

    // Resolve pricing rule from agreement
    const pricingRule = agreement.pricingRules.find(r => r.planCode === params.planCode || r.planCode === canonicalPlan.code);
    let partnerDiscount = '0';
    let discountBps = 0;

    if (pricingRule) {
      if (!pricingRule.allowed) throw new BadRequestException(`plan ${params.planCode} not allowed per agreement`);
      if (pricingRule.partnerPriceOverride) {
        // Partner price override - calculate discount as difference
        const override = pricingRule.partnerPriceOverride;
        partnerDiscount = this.subtractDecimal(platformListPrice, override, planCurrency);
        if (this.isNegative(partnerDiscount)) partnerDiscount = '0';
      } else if (pricingRule.discountBasisPoints) {
        discountBps = pricingRule.discountBasisPoints;
        this.policyService.validateDiscount(agreement.commissionPolicy, discountBps, targetCurrency);
        partnerDiscount = this.calculatePercentage(platformListPrice, discountBps, planCurrency);
      }
    }

    // Campaign discount if provided - must not mutate invoice directly
    if (params.campaignId) {
      try {
        const campaign = await (this.prisma as any).partnerCampaign?.findUnique?.({ where: { id: params.campaignId } });
        if (campaign && campaign.partnerId === params.partnerId && campaign.state === 'ACTIVE') {
          const now = new Date();
          const startsAt = new Date(campaign.startsAt);
          const endsAt = campaign.endsAt ? new Date(campaign.endsAt) : null;
          if (now >= startsAt && (!endsAt || now <= endsAt)) {
            if (campaign.discountType === 'PERCENTAGE' && campaign.discountValue) {
              const campBps = Math.round(parseFloat(campaign.discountValue) * 100);
              if (!agreement.commissionPolicy.discountRules.stackingAllowed && discountBps > 0) {
                throw new BadRequestException('discount stacking not allowed per policy');
              }
              const campDiscount = this.calculatePercentage(platformListPrice, campBps, planCurrency);
              partnerDiscount = this.addDecimal(partnerDiscount, campDiscount, planCurrency);
              discountBps += campBps;
            } else if (campaign.discountType === 'FIXED_AMOUNT' && campaign.discountValue) {
              if (!agreement.commissionPolicy.discountRules.stackingAllowed && this.compareDecimal(partnerDiscount, '0', planCurrency) > 0) {
                throw new BadRequestException('discount stacking not allowed');
              }
              partnerDiscount = this.addDecimal(partnerDiscount, campaign.discountValue, planCurrency);
            }
          }
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        this.logger.debug(`campaign discount lookup skipped campaignId=${params.campaignId}`);
      }
    }

    const customerNetPrice = this.subtractDecimal(platformListPrice, partnerDiscount, planCurrency);
    if (this.isNegative(customerNetPrice)) throw new BadRequestException('discount exceeds platform price');

    const effective: EffectivePrice = {
      platformListPrice,
      partnerDiscount,
      customerNetPrice,
      currency: targetCurrency,
      pricingPolicyVersion: agreement.commissionPolicy.policyVersion,
      agreementVersion: `v${agreement.version}`,
      planCode: canonicalPlan.code ?? params.planCode,
      discountBasisPoints: discountBps || undefined,
      calculationVersion: `calc_${agreement.commissionPolicy.policyVersion}_${agreement.version}`,
    };

    this.logger.log(`effective price partner=${params.partnerId} plan=${params.planCode} list=${platformListPrice} discount=${partnerDiscount} net=${customerNetPrice} corr=pricing`);
    return effective;
  }

  // Decimal-safe arithmetic using minor units to avoid floating point
  private getMinorUnit(currency: string): number {
    const map: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, USDT: 6, USDC: 6, BTC: 8, ETH: 18 };
    return map[currency.toUpperCase()] ?? 2;
  }

  private toMinorUnits(amount: string, currency: string): bigint {
    const minor = this.getMinorUnit(currency);
    const factor = Math.pow(10, minor);
    // Parse string safely
    const parts = amount.toString().split('.');
    const integerPart = BigInt(parts[0] || '0');
    let fractional = parts[1] || '';
    if (fractional.length > minor) fractional = fractional.slice(0, minor);
    while (fractional.length < minor) fractional += '0';
    const fractionalPart = BigInt(fractional || '0');
    if (integerPart < BigInt(0)) {
      return integerPart * BigInt(factor) - fractionalPart;
    }
    return integerPart * BigInt(factor) + fractionalPart;
  }

  private fromMinorUnits(minor: bigint, currency: string): string {
    const minorUnit = this.getMinorUnit(currency);
    const factor = BigInt(Math.pow(10, minorUnit));
    const isNegative = minor < BigInt(0);
    const abs = isNegative ? -minor : minor;
    const integerPart = abs / factor;
    const fractionalPart = abs % factor;
    let fractionalStr = fractionalPart.toString().padStart(minorUnit, '0');
    // Trim trailing zeros but keep at least 2 decimals for USD-like
    if (minorUnit > 0) {
      fractionalStr = fractionalStr.replace(/0+$/, '');
      if (fractionalStr === '') fractionalStr = '0'.repeat(Math.min(2, minorUnit));
      else if (fractionalStr.length < 2 && ['USD', 'EUR', 'GBP'].includes(currency.toUpperCase())) {
        fractionalStr = fractionalStr.padEnd(2, '0');
      }
    }
    const result = minorUnit === 0 ? integerPart.toString() : `${integerPart.toString()}.${fractionalStr}`;
    return isNegative ? `-${result}` : result;
  }

  private addDecimal(a: string, b: string, currency: string): string {
    const aMinor = this.toMinorUnits(a, currency);
    const bMinor = this.toMinorUnits(b, currency);
    return this.fromMinorUnits(aMinor + bMinor, currency);
  }

  private subtractDecimal(a: string, b: string, currency: string): string {
    const aMinor = this.toMinorUnits(a, currency);
    const bMinor = this.toMinorUnits(b, currency);
    return this.fromMinorUnits(aMinor - bMinor, currency);
  }

  private calculatePercentage(amount: string, basisPoints: number, currency: string): string {
    const minor = this.toMinorUnits(amount, currency);
    // basisPoints / 10000
    const result = (minor * BigInt(basisPoints)) / BigInt(10000);
    return this.fromMinorUnits(result, currency);
  }

  private isNegative(amount: string): boolean {
    return amount.trim().startsWith('-');
  }

  private compareDecimal(a: string, b: string, currency: string): number {
    const aMinor = this.toMinorUnits(a, currency);
    const bMinor = this.toMinorUnits(b, currency);
    if (aMinor < bMinor) return -1;
    if (aMinor > bMinor) return 1;
    return 0;
  }
}
