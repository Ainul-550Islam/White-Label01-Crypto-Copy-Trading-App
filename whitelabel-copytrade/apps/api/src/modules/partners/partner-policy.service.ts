import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PartnerPolicy,
  PartnerType,
  PartnerCommissionModel,
  PartnerCommissionBasis,
  PartnerDiscountType,
  CommissionRateConfig,
} from './partner.types';

@Injectable()
export class PartnerPolicyService {
  private readonly logger = new Logger(PartnerPolicyService.name);
  private readonly policyVersion: string;
  private readonly defaultCommissionBasis: PartnerCommissionBasis;
  private readonly settlementCurrency: string;
  private readonly allowedCurrencies: string[];

  constructor(private readonly config: ConfigService) {
    this.policyVersion = this.config.get<string>('PARTNER_POLICY_VERSION', '2026-01') ?? '2026-01';
    const basisRaw = this.config.get<string>('PARTNER_COMMISSION_BASIS', PartnerCommissionBasis.COLLECTED_REVENUE);
    this.defaultCommissionBasis = (basisRaw as PartnerCommissionBasis) ?? PartnerCommissionBasis.COLLECTED_REVENUE;
    this.settlementCurrency = this.config.get<string>('PARTNER_SETTLEMENT_CURRENCY', 'USD') ?? 'USD';
    const currenciesRaw = this.config.get<string>('PARTNER_ALLOWED_CURRENCIES', 'USD,EUR,GBP,USDT,USDC') ?? 'USD,EUR,GBP,USDT,USDC';
    this.allowedCurrencies = currenciesRaw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  }

  getPolicyVersion(): string {
    return this.policyVersion;
  }

  /**
   * Resolves partner policy from platform/tenant configuration.
   * Never invents values - all rates come from config/database.
   */
  resolvePolicy(params: {
    partnerType: PartnerType;
    tenantId?: string | null;
    agreementVersion?: string;
    storedPolicy?: Partial<PartnerPolicy>;
  }): PartnerPolicy {
    if (!params.partnerType) throw new BadRequestException('partnerType required');
    if (!Object.values(PartnerType).includes(params.partnerType)) {
      throw new BadRequestException(`invalid partnerType ${params.partnerType}`);
    }

    // Base policy from configuration - never hardcoded percentages
    const baseRates = this.getCommissionRatesFromConfig(params.partnerType);
    
    const policy: PartnerPolicy = {
      partnerType: params.partnerType,
      allowedPartnerTypes: this.getAllowedTypes(params.partnerType),
      onboardingRequirements: this.getOnboardingRequirements(params.partnerType),
      commissionBasis: params.storedPolicy?.commissionBasis ?? this.defaultCommissionBasis,
      commissionModels: params.storedPolicy?.commissionModels ?? this.getCommissionModels(params.partnerType),
      commissionRates: params.storedPolicy?.commissionRates ?? baseRates,
      discountRules: params.storedPolicy?.discountRules ?? {
        maxDiscountBasisPoints: this.config.get<number>('PARTNER_MAX_DISCOUNT_BPS', 3000) ?? 3000,
        allowedDiscountTypes: [PartnerDiscountType.PERCENTAGE, PartnerDiscountType.FIXED_AMOUNT, PartnerDiscountType.CAMPAIGN],
        stackingAllowed: false,
        requiresApproval: true,
        allowedCurrencies: this.allowedCurrencies,
        maxActiveDiscounts: 10,
      },
      attributionWindowHours: params.storedPolicy?.attributionWindowHours ?? this.config.get<number>('PARTNER_ATTRIBUTION_WINDOW_HOURS', 720) ?? 720,
      settlementSchedule: params.storedPolicy?.settlementSchedule ?? {
        frequency: 'MONTHLY',
        dayOfMonth: 1,
        minPayoutAmount: this.config.get<string>('PARTNER_MIN_PAYOUT_AMOUNT', '50.00') ?? '50.00',
        currency: this.settlementCurrency,
        autoSettlement: false,
      },
      payoutRequirements: params.storedPolicy?.payoutRequirements ?? {
        minPayoutAmount: this.config.get<string>('PARTNER_MIN_PAYOUT_AMOUNT', '50.00') ?? '50.00',
        allowedMethods: ['BANK_TRANSFER', 'CRYPTO', 'PAYPAL'],
        requiresApproval: true,
        kycRequired: true,
      },
      subPartnerAllowed: params.storedPolicy?.subPartnerAllowed ?? (params.partnerType === PartnerType.INSTITUTIONAL_DISTRIBUTOR),
      currencyPolicy: params.storedPolicy?.currencyPolicy ?? {
        allowedCurrencies: this.allowedCurrencies,
        settlementCurrency: this.settlementCurrency,
        fxRequired: false,
        allowMultiCurrency: false,
      },
      terminationRules: params.storedPolicy?.terminationRules ?? {
        noticePeriodDays: 30,
        settlementOnTermination: true,
        commissionForfeiture: false,
      },
      policyVersion: this.policyVersion,
      agreementVersion: params.agreementVersion ?? 'v1',
      trialCommissionEligible: params.storedPolicy?.trialCommissionEligible ?? false,
      lifetimeCommissionModel: params.storedPolicy?.lifetimeCommissionModel ?? PartnerCommissionModel.FIXED_AMOUNT,
      refundPolicy: params.storedPolicy?.refundPolicy ?? {
        reversalRequired: true,
        reversalBasis: 'PROPORTIONAL',
        deductionFromFutureSettlement: true,
      },
      chargebackPolicy: params.storedPolicy?.chargebackPolicy ?? {
        reversalRequired: true,
        recoveryRequired: true,
        deductionFromFutureSettlement: true,
        createsOutstandingBalance: true,
      },
    };

    this.validatePolicy(policy);
    return policy;
  }

  private getAllowedTypes(partnerType: PartnerType): PartnerType[] {
    // Policy-driven allowed sub-types
    switch (partnerType) {
      case PartnerType.INSTITUTIONAL_DISTRIBUTOR:
        return [PartnerType.RESELLER, PartnerType.AGENCY, PartnerType.AFFILIATE, PartnerType.REFERRAL_PARTNER];
      case PartnerType.MANAGED_SERVICE_PROVIDER:
        return [PartnerType.RESELLER, PartnerType.AGENCY];
      default:
        return [];
    }
  }

  private getOnboardingRequirements(partnerType: PartnerType): string[] {
    const base = ['KYC', 'BUSINESS_VERIFICATION', 'TAX_FORM'];
    if ([PartnerType.WHITE_LABEL_PARTNER, PartnerType.INSTITUTIONAL_DISTRIBUTOR].includes(partnerType)) {
      return [...base, 'AGREEMENT_SIGNED', 'TECHNICAL_REVIEW'];
    }
    return base;
  }

  private getCommissionModels(partnerType: PartnerType): PartnerCommissionModel[] {
    switch (partnerType) {
      case PartnerType.AFFILIATE:
      case PartnerType.REFERRAL_PARTNER:
        return [PartnerCommissionModel.PERCENTAGE_REVENUE, PartnerCommissionModel.FIRST_PERIOD];
      case PartnerType.RESELLER:
      case PartnerType.AGENCY:
        return [PartnerCommissionModel.PERCENTAGE_REVENUE, PartnerCommissionModel.RECURRING_PERIOD, PartnerCommissionModel.FIXED_AMOUNT];
      case PartnerType.WHITE_LABEL_PARTNER:
      case PartnerType.MANAGED_SERVICE_PROVIDER:
      case PartnerType.INSTITUTIONAL_DISTRIBUTOR:
        return [PartnerCommissionModel.PERCENTAGE_REVENUE, PartnerCommissionModel.RECURRING_PERIOD, PartnerCommissionModel.HYBRID];
      default:
        return [PartnerCommissionModel.PERCENTAGE_REVENUE];
    }
  }

  private getCommissionRatesFromConfig(partnerType: PartnerType): CommissionRateConfig[] {
    // Rates must come from config/database, never hardcoded
    // We read from env var PARTNER_COMMISSION_RATES_JSON if provided, else empty - caller must provide via agreement
    const raw = this.config.get<string>('PARTNER_COMMISSION_RATES_JSON', '');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((r: any) => ({
            model: r.model,
            basis: r.basis ?? this.defaultCommissionBasis,
            rateBasisPoints: r.rateBasisPoints,
            fixedAmount: r.fixedAmount,
            currency: r.currency ?? this.settlementCurrency,
            firstPeriodOnly: r.firstPeriodOnly,
            recurringPeriods: r.recurringPeriods,
            minEligibleAmount: r.minEligibleAmount,
            maxCommissionAmount: r.maxCommissionAmount,
            planCodes: r.planCodes,
            effectiveFrom: r.effectiveFrom ?? new Date().toISOString(),
            effectiveTo: r.effectiveTo ?? null,
          }));
        }
      } catch {
        this.logger.warn('Failed to parse PARTNER_COMMISSION_RATES_JSON, using empty rates - agreement must provide rates');
      }
    }
    // Return empty - forces agreement to provide explicit rates, never invent
    return [];
  }

  private validatePolicy(policy: PartnerPolicy): void {
    if (!policy.commissionBasis) throw new BadRequestException('commissionBasis required');
    if (!Object.values(PartnerCommissionBasis).includes(policy.commissionBasis)) {
      throw new BadRequestException(`invalid commissionBasis ${policy.commissionBasis}`);
    }
    if (policy.attributionWindowHours <= 0 || policy.attributionWindowHours > 8760 * 2) {
      throw new BadRequestException('attributionWindowHours must be 1-17520');
    }
    if (policy.commissionRates.length > 0) {
      for (const rate of policy.commissionRates) {
        if (rate.rateBasisPoints !== undefined && (rate.rateBasisPoints < 0 || rate.rateBasisPoints > 10000)) {
          throw new BadRequestException(`invalid rateBasisPoints ${rate.rateBasisPoints}`);
        }
        if (rate.fixedAmount !== undefined) {
          const amt = parseFloat(rate.fixedAmount);
          if (isNaN(amt) || amt < 0) throw new BadRequestException(`invalid fixedAmount ${rate.fixedAmount}`);
        }
      }
    }
    if (!policy.currencyPolicy.allowedCurrencies.includes(policy.currencyPolicy.settlementCurrency)) {
      throw new BadRequestException('settlementCurrency must be in allowedCurrencies');
    }
  }

  resolveCommissionBasis(policy: PartnerPolicy): PartnerCommissionBasis {
    return policy.commissionBasis;
  }

  isTrialCommissionEligible(policy: PartnerPolicy): boolean {
    return policy.trialCommissionEligible;
  }

  getAttributionWindowHours(policy: PartnerPolicy): number {
    return policy.attributionWindowHours;
  }

  isSubPartnerAllowed(policy: PartnerPolicy): boolean {
    return policy.subPartnerAllowed;
  }

  validateDiscount(policy: PartnerPolicy, discountBasisPoints: number, currency: string, fixedAmount?: string): void {
    if (discountBasisPoints > policy.discountRules.maxDiscountBasisPoints) {
      throw new BadRequestException(`discount ${discountBasisPoints}bps exceeds max ${policy.discountRules.maxDiscountBasisPoints}bps`);
    }
    if (!policy.discountRules.allowedCurrencies.includes(currency.toUpperCase())) {
      throw new BadRequestException(`currency ${currency} not allowed for discounts`);
    }
    if (fixedAmount) {
      const amt = parseFloat(fixedAmount);
      if (isNaN(amt) || amt < 0) throw new BadRequestException('invalid fixed discount amount');
      if (policy.discountRules.maxDiscountFixedAmount) {
        const max = parseFloat(policy.discountRules.maxDiscountFixedAmount);
        if (amt > max) throw new BadRequestException(`fixed discount ${amt} exceeds max ${max}`);
      }
    }
  }

  validateCurrency(policy: PartnerPolicy, currency: string): void {
    if (!policy.currencyPolicy.allowedCurrencies.includes(currency.toUpperCase())) {
      throw new BadRequestException(`currency ${currency} not allowed`);
    }
  }

  getSettlementCurrency(policy: PartnerPolicy): string {
    return policy.currencyPolicy.settlementCurrency;
  }
}
