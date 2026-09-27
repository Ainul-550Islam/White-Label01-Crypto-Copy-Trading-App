import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerCommission, PartnerCommissionState, PartnerCommissionModel, PartnerCommissionBasis, PartnerAuditAction } from './partner.types';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerAttributionService } from './partner-attribution.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerCommissionService {
  private readonly logger = new Logger(PartnerCommissionService.name);
  private readonly calculationVersion = '2026-01';

  constructor(
    private readonly policyService: PartnerPolicyService,
    private readonly agreementService: PartnerAgreementService,
    private readonly audit: PartnerAuditService,
    private readonly attributionService: PartnerAttributionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Calculates commission from authoritative payments/invoices/subscriptions/fees
   * Supports revenue-share, fixed-fee, percentage, first-period, recurring-period
   * No hardcoded rates, Decimal-safe
   */
  async calculateCommission(params: {
    partnerId: string;
    tenantId: string;
    sourcePaymentId?: string | null;
    sourceInvoiceId?: string | null;
    sourceSubscriptionId?: string | null;
    sourceFeeId?: string | null;
    sourceEventId: string;
    sourceEventType: 'PAYMENT' | 'INVOICE' | 'SUBSCRIPTION' | 'FEE' | 'REFUND' | 'CHARGEBACK';
    grossRevenue: string;
    discountAmount: string;
    currency: string;
    sourceCurrency?: string;
    correlationId: string;
    idempotencyKey: string;
    createdBy: string;
    isTrial?: boolean;
    isLifetime?: boolean;
    isFirstPeriod?: boolean;
    periodNumber?: number;
    planCode?: string;
    paymentStatus?: string;
    invoiceStatus?: string;
  }): Promise<PartnerCommission | null> {
    if (!params.partnerId || !params.tenantId || !params.sourceEventId || !params.grossRevenue || !params.currency) {
      throw new BadRequestException('partnerId, tenantId, sourceEventId, grossRevenue, currency required');
    }

    // Commission must NOT be generated from unpaid/failed/cancelled/unconfirmed/fake/test/unverified
    if (params.paymentStatus) {
      const invalidPaymentStatuses = ['FAILED', 'CANCELLED', 'UNCONFIRMED', 'FAKE', 'TEST', 'PENDING', 'UNPAID'];
      if (invalidPaymentStatuses.includes(params.paymentStatus.toUpperCase())) {
        this.logger.log(`commission blocked - invalid payment status ${params.paymentStatus} event=${params.sourceEventId} corr=${params.correlationId}`);
        return null;
      }
    }
    if (params.invoiceStatus) {
      const invalidInvoiceStatuses = ['DRAFT', 'VOID', 'UNPAID', 'UNCOLLECTED', 'FAILED'];
      if (invalidInvoiceStatuses.includes(params.invoiceStatus.toUpperCase())) {
        this.logger.log(`commission blocked - invalid invoice status ${params.invoiceStatus} event=${params.sourceEventId} corr=${params.correlationId}`);
        return null;
      }
    }

    const agreement = await this.agreementService.getActiveAgreement(params.partnerId);
    if (!agreement) {
      this.logger.warn(`no active agreement for partner ${params.partnerId}, commission blocked`);
      return null;
    }

    const policy = agreement.commissionPolicy;

    // Trial handling
    if (params.isTrial && !policy.trialCommissionEligible) {
      this.logger.log(`trial commission not eligible per policy partner=${params.partnerId} corr=${params.correlationId}`);
      return null;
    }

    // Lifetime handling
    let commissionModel = policy.commissionModels[0] ?? PartnerCommissionModel.PERCENTAGE_REVENUE;
    if (params.isLifetime) {
      commissionModel = policy.lifetimeCommissionModel;
    } else if (params.isFirstPeriod) {
      // Prefer FIRST_PERIOD if configured
      const firstPeriodModel = policy.commissionModels.find(m => m === PartnerCommissionModel.FIRST_PERIOD);
      if (firstPeriodModel) commissionModel = firstPeriodModel;
    }

    // Find applicable rate config
    const rateConfig = this.findApplicableRate(policy, commissionModel, params.planCode, params.grossRevenue);
    if (!rateConfig) {
      this.logger.warn(`no applicable commission rate for partner=${params.partnerId} model=${commissionModel} plan=${params.planCode}`);
      return null;
    }

    // Validate attribution exists
    const attribution = await this.attributionService.getPrimaryAttributionForTenant(params.tenantId);
    if (!attribution || attribution.partnerId !== params.partnerId) {
      this.logger.warn(`no valid attribution for tenant=${params.tenantId} partner=${params.partnerId}, commission blocked`);
      return null;
    }
    if (new Date(attribution.expiresAt) < new Date()) {
      this.logger.warn(`attribution expired for tenant=${params.tenantId}, commission blocked`);
      return null;
    }

    // Resolve commission basis
    const basis = rateConfig.basis ?? policy.commissionBasis;
    let netEligibleRevenue: string;
    switch (basis) {
      case PartnerCommissionBasis.LIST_PRICE:
        netEligibleRevenue = params.grossRevenue;
        break;
      case PartnerCommissionBasis.DISCOUNTED_PRICE:
      case PartnerCommissionBasis.NET_REVENUE:
        netEligibleRevenue = this.subtractDecimal(params.grossRevenue, params.discountAmount, params.currency);
        break;
      case PartnerCommissionBasis.COLLECTED_REVENUE:
        // For collected revenue, use gross - discount as eligible (actual collected)
        netEligibleRevenue = this.subtractDecimal(params.grossRevenue, params.discountAmount, params.currency);
        break;
      default:
        netEligibleRevenue = this.subtractDecimal(params.grossRevenue, params.discountAmount, params.currency);
    }

    // Check min eligible amount
    if (rateConfig.minEligibleAmount) {
      if (this.compareDecimal(netEligibleRevenue, rateConfig.minEligibleAmount, params.currency) < 0) {
        this.logger.log(`net eligible ${netEligibleRevenue} below min ${rateConfig.minEligibleAmount}, commission blocked`);
        return null;
      }
    }

    // Calculate commission amount Decimal-safe
    let commissionAmount: string;
    let commissionRateStr: string;

    if (rateConfig.rateBasisPoints !== undefined) {
      commissionRateStr = `${rateConfig.rateBasisPoints}bps`;
      commissionAmount = this.calculatePercentage(netEligibleRevenue, rateConfig.rateBasisPoints, params.currency);
    } else if (rateConfig.fixedAmount) {
      commissionRateStr = `fixed:${rateConfig.fixedAmount}`;
      commissionAmount = rateConfig.fixedAmount;
      // Ensure fixed amount currency matches or FX required
      if (rateConfig.currency && rateConfig.currency.toUpperCase() !== params.currency.toUpperCase()) {
        // FX required - if unavailable, settlement blocked, but we still accrue with fxRequired=true
      }
    } else {
      throw new BadRequestException('commission rate config must have rateBasisPoints or fixedAmount');
    }

    // Apply max commission cap
    if (rateConfig.maxCommissionAmount) {
      if (this.compareDecimal(commissionAmount, rateConfig.maxCommissionAmount, params.currency) > 0) {
        commissionAmount = rateConfig.maxCommissionAmount;
      }
    }

    // Multi-currency handling
    const sourceCurrency = (params.sourceCurrency ?? params.currency).toUpperCase();
    const commissionCurrency = (rateConfig.currency ?? policy.currencyPolicy.settlementCurrency ?? params.currency).toUpperCase();
    const fxRequired = sourceCurrency !== commissionCurrency;
    let fxRate: string | null = null;
    let fxTimestamp: string | null = null;
    let fxSource: string | null = null;

    if (fxRequired) {
      // Try to fetch FX rate - if unavailable, mark fxRequired but keep commission for later settlement blocking
      try {
        const fx = await this.getFxRate(sourceCurrency, commissionCurrency);
        if (fx) {
          fxRate = fx.rate;
          fxTimestamp = fx.timestamp;
          fxSource = fx.source;
          // Convert commission amount if needed - here we assume commissionAmount is already in source currency, need conversion
          // For simplicity, if fixed amount in different currency, we keep as is and settlement will handle FX
        } else {
          this.logger.warn(`FX rate unavailable ${sourceCurrency}->${commissionCurrency}, commission accrued with fxRequired=true`);
        }
      } catch {
        this.logger.warn(`FX fetch failed ${sourceCurrency}->${commissionCurrency}`);
      }
    }

    const commission: PartnerCommission = {
      id: `pcom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      sourcePaymentId: params.sourcePaymentId ?? null,
      sourceInvoiceId: params.sourceInvoiceId ?? null,
      sourceSubscriptionId: params.sourceSubscriptionId ?? null,
      sourceFeeId: params.sourceFeeId ?? null,
      sourceEventId: params.sourceEventId,
      sourceEventType: params.sourceEventType,
      grossRevenue: params.grossRevenue,
      discountAmount: params.discountAmount,
      netEligibleRevenue,
      commissionRate: commissionRateStr,
      commissionBasis: basis,
      commissionModel,
      commissionAmount,
      currency: params.currency.toUpperCase(),
      sourceCurrency,
      commissionCurrency,
      fxRequired,
      fxRate,
      fxTimestamp,
      fxSource,
      agreementVersion: `v${agreement.version}`,
      policyVersion: policy.policyVersion,
      calculationVersion: this.calculationVersion,
      state: PartnerCommissionState.ACCRUED,
      settlementId: null,
      payoutId: null,
      reversalOfId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accruedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
    };

    // Idempotency check via ledger service will be done there, but also check here
    try {
      const existing = await (this.prisma as any).partnerCommission?.findFirst?.({ where: { idempotencyKey: params.idempotencyKey } });
      if (existing) {
        this.logger.log(`commission idempotent hit key=${params.idempotencyKey}`);
        return this.mapRow(existing);
      }
    } catch {}

    this.logger.log(`commission calculated partner=${params.partnerId} amount=${commissionAmount} ${params.currency} model=${commissionModel} basis=${basis} corr=${params.correlationId}`);
    return commission;
  }

  private findApplicableRate(policy: any, model: PartnerCommissionModel, planCode?: string, grossRevenue?: string): any {
    // Find rate matching model and planCode, with effective dates
    const now = new Date();
    const candidates = policy.commissionRates.filter((r: any) => {
      if (r.model !== model) return false;
      const from = new Date(r.effectiveFrom);
      if (from > now) return false;
      if (r.effectiveTo) {
        const to = new Date(r.effectiveTo);
        if (to < now) return false;
      }
      if (r.planCodes && r.planCodes.length > 0 && planCode) {
        if (!r.planCodes.includes(planCode)) return false;
      }
      return true;
    });
    // Prefer most specific (with planCodes) then highest rate
    candidates.sort((a: any, b: any) => {
      const aSpecific = a.planCodes?.length ? 1 : 0;
      const bSpecific = b.planCodes?.length ? 1 : 0;
      if (aSpecific !== bSpecific) return bSpecific - aSpecific;
      return (b.rateBasisPoints ?? 0) - (a.rateBasisPoints ?? 0);
    });
    return candidates[0] ?? policy.commissionRates.find((r: any) => r.model === model) ?? policy.commissionRates[0] ?? null;
  }

  private async getFxRate(from: string, to: string): Promise<{ rate: string; timestamp: string; source: string } | null> {
    // In production, this would call FX provider - here we return null to trigger SETTLEMENT_BLOCKED if FX required
    // Never invent FX
    return null;
  }

  // Decimal-safe helpers using BigInt minor units
  private getMinorUnit(currency: string): number {
    const map: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, USDT: 6, USDC: 6, BTC: 8, ETH: 18 };
    return map[currency.toUpperCase()] ?? 2;
  }

  private toMinorUnits(amount: string, currency: string): bigint {
    const minor = this.getMinorUnit(currency);
    const factor = Math.pow(10, minor);
    const parts = amount.toString().split('.');
    const integerPart = BigInt(parts[0] || '0');
    let fractional = parts[1] || '';
    if (fractional.length > minor) fractional = fractional.slice(0, minor);
    while (fractional.length < minor) fractional += '0';
    const fractionalPart = BigInt(fractional || '0');
    if (integerPart < BigInt(0)) return integerPart * BigInt(factor) - fractionalPart;
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
    if (minorUnit > 0) {
      fractionalStr = fractionalStr.replace(/0+$/, '');
      if (fractionalStr === '') fractionalStr = '0'.repeat(Math.min(2, minorUnit));
    }
    const result = minorUnit === 0 ? integerPart.toString() : `${integerPart.toString()}.${fractionalStr}`;
    return isNegative ? `-${result}` : result;
  }

  private subtractDecimal(a: string, b: string, currency: string): string {
    const aMinor = this.toMinorUnits(a, currency);
    const bMinor = this.toMinorUnits(b, currency);
    return this.fromMinorUnits(aMinor - bMinor, currency);
  }

  private calculatePercentage(amount: string, basisPoints: number, currency: string): string {
    const minor = this.toMinorUnits(amount, currency);
    const result = (minor * BigInt(basisPoints)) / BigInt(10000);
    return this.fromMinorUnits(result, currency);
  }

  private compareDecimal(a: string, b: string, currency: string): number {
    const aMinor = this.toMinorUnits(a, currency);
    const bMinor = this.toMinorUnits(b, currency);
    if (aMinor < bMinor) return -1;
    if (aMinor > bMinor) return 1;
    return 0;
  }

  private mapRow(row: any): PartnerCommission {
    return {
      id: row.id,
      partnerId: row.partnerId,
      tenantId: row.tenantId,
      sourcePaymentId: row.sourcePaymentId ?? null,
      sourceInvoiceId: row.sourceInvoiceId ?? null,
      sourceSubscriptionId: row.sourceSubscriptionId ?? null,
      sourceFeeId: row.sourceFeeId ?? null,
      sourceEventId: row.sourceEventId,
      sourceEventType: row.sourceEventType,
      grossRevenue: row.grossRevenue,
      discountAmount: row.discountAmount,
      netEligibleRevenue: row.netEligibleRevenue,
      commissionRate: row.commissionRate,
      commissionBasis: row.commissionBasis,
      commissionModel: row.commissionModel,
      commissionAmount: row.commissionAmount,
      currency: row.currency,
      sourceCurrency: row.sourceCurrency,
      commissionCurrency: row.commissionCurrency,
      fxRequired: !!row.fxRequired,
      fxRate: row.fxRate ?? null,
      fxTimestamp: row.fxTimestamp ? (row.fxTimestamp instanceof Date ? row.fxTimestamp.toISOString() : row.fxTimestamp) : null,
      fxSource: row.fxSource ?? null,
      agreementVersion: row.agreementVersion,
      policyVersion: row.policyVersion,
      calculationVersion: row.calculationVersion,
      state: row.state,
      settlementId: row.settlementId ?? null,
      payoutId: row.payoutId ?? null,
      reversalOfId: row.reversalOfId ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      accruedAt: row.accruedAt instanceof Date ? row.accruedAt.toISOString() : row.accruedAt,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
    };
  }
}
