import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { OverageRepository } from './overage.repository';
import { OveragePolicy, OverageStatus, OverageCalculationInput, OverageCalculationResult } from './overage.types';
import { MeterKey, MeterUnit } from './usage-metering.types';
import { parseToMinorUnits, formatFromMinorUnits } from '../finance/money.types';
import { BillingEventService } from '../notifications/billing-event.service';

/**
 * Calculates usage above configured limits ONLY when explicit overage policy exists.
 * Never invents rates, never charges automatically without policy.
 * If no policy, returns NOT_CONFIGURED deterministically.
 */
@Injectable()
export class OverageService {
  private readonly logger = new Logger(OverageService.name);

  constructor(
    private readonly overageRepository: OverageRepository,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async calculateOverage(input: OverageCalculationInput): Promise<OverageCalculationResult> {
    const excessQuantity = Math.max(0, input.actualQuantity - input.allowedQuantity);
    const isOverage = excessQuantity > 0;

    const idempotencyKey = input.idempotencyKey || `overage_${input.tenantId}_${input.meterKey}_${input.periodId}`;

    // Check existing
    const existing = await this.overageRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.logger.log(`Idempotent overage return by key: ${idempotencyKey}`);
      return this.mapRecordToResult(existing, isOverage);
    }

    if (!isOverage) {
      // No overage
      const result: OverageCalculationResult = {
        tenantId: input.tenantId,
        meterKey: input.meterKey,
        limitKey: input.limitKey,
        periodId: input.periodId,
        allowedQuantity: input.allowedQuantity,
        actualQuantity: input.actualQuantity,
        excessQuantity: 0,
        unit: input.unit,
        policyReference: input.policy?.policyReference || null,
        rateReference: null,
        rateBps: null,
        estimatedAmount: null,
        currency: null,
        status: OverageStatus.DETECTED,
        calculatedAt: new Date().toISOString(),
        isOverage: false,
        isBillable: false,
        requiresReview: false,
        notConfigured: false,
      };
      return result;
    }

    // Overage detected, check policy
    if (!input.policy) {
      this.logger.log(`Overage detected but no policy configured tenant=${input.tenantId} meter=${input.meterKey} excess=${excessQuantity}`);

      // Persist NOT_CONFIGURED record for audit
      const notConfiguredRecord = await this.overageRepository.create({
        tenantId: input.tenantId,
        meterKey: input.meterKey,
        limitKey: input.limitKey,
        periodId: input.periodId,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        allowedQuantity: input.allowedQuantity,
        actualQuantity: input.actualQuantity,
        excessQuantity,
        unit: input.unit,
        policyReference: null,
        rateReference: null,
        rateBps: null,
        estimatedAmount: null,
        currency: null,
        status: OverageStatus.NOT_CONFIGURED,
        idempotencyKey,
        calculationTimestamp: new Date(),
        metadata: input.metadata,
      });

      return {
        tenantId: input.tenantId,
        meterKey: input.meterKey,
        limitKey: input.limitKey,
        periodId: input.periodId,
        allowedQuantity: input.allowedQuantity,
        actualQuantity: input.actualQuantity,
        excessQuantity,
        unit: input.unit,
        policyReference: null,
        rateReference: null,
        rateBps: null,
        estimatedAmount: null,
        currency: null,
        status: OverageStatus.NOT_CONFIGURED,
        calculatedAt: new Date().toISOString(),
        isOverage: true,
        isBillable: false,
        requiresReview: false,
        notConfigured: true,
      };
    }

    // Policy exists - calculate estimated amount with Decimal-safe arithmetic if rate exists
    let estimatedAmount: string | null = null;
    let rateReference: string | null = null;
    let rateBps: number | null = null;
    let currency: string | null = input.policy.currency || null;
    let status: OverageStatus = OverageStatus.DETECTED;

    if (input.policy.overageRateBps && input.policy.overageRateBps > 0) {
      // If policy has BPS rate, calculate amount: excess * rate? But overage for count meters typically per-unit price
      // For count overage, if rateBps is present, we interpret as per-unit price in minor units? No, we need explicit ratePerUnit
      // For this implementation, if overageRateBps exists, we do NOT invent dollar price - we store rate reference
      // Estimated amount calculation only if overageRatePerUnit exists
      rateBps = input.policy.overageRateBps;
      rateReference = `BPS:${rateBps}`;
      status = OverageStatus.CALCULATED;

      if (input.policy.overageRatePerUnit) {
        try {
          // Decimal-safe: estimated = excess * ratePerUnit
          const rateMinor = parseToMinorUnits(input.policy.overageRatePerUnit, currency || 'USD');
          const estimatedMinor = rateMinor * excessQuantity;
          estimatedAmount = formatFromMinorUnits(estimatedMinor, currency || 'USD');
          rateReference = input.policy.overageRatePerUnit;
        } catch (e) {
          this.logger.warn(`Failed to calculate overage amount: ${(e as Error).message}`);
        }
      }
    } else if (input.policy.overageRatePerUnit) {
      // Per-unit rate
      try {
        const rateMinor = parseToMinorUnits(input.policy.overageRatePerUnit, currency || 'USD');
        const estimatedMinor = rateMinor * excessQuantity;
        estimatedAmount = formatFromMinorUnits(estimatedMinor, currency || 'USD');
        rateReference = input.policy.overageRatePerUnit;
        status = OverageStatus.CALCULATED;
      } catch (e) {
        this.logger.warn(`Failed to calculate overage amount: ${(e as Error).message}`);
      }
    }

    if (input.policy.isBillable) {
      status = input.policy.requiresReview ? OverageStatus.REVIEW_REQUIRED : OverageStatus.BILLABLE;
    } else {
      status = OverageStatus.DETECTED;
    }

    // If no rate at all, status is DETECTED but not billable
    if (!input.policy.overageRateBps && !input.policy.overageRatePerUnit) {
      status = OverageStatus.DETECTED;
    }

    const record = await this.overageRepository.create({
      tenantId: input.tenantId,
      meterKey: input.meterKey,
      limitKey: input.limitKey,
      periodId: input.periodId,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      allowedQuantity: input.allowedQuantity,
      actualQuantity: input.actualQuantity,
      excessQuantity,
      unit: input.unit,
      policyReference: input.policy.policyReference,
      rateReference,
      rateBps,
      estimatedAmount,
      currency,
      status,
      idempotencyKey,
      calculationTimestamp: new Date(),
      metadata: input.metadata,
    });

    const result: OverageCalculationResult = {
      tenantId: input.tenantId,
      meterKey: input.meterKey,
      limitKey: input.limitKey,
      periodId: input.periodId,
      allowedQuantity: input.allowedQuantity,
      actualQuantity: input.actualQuantity,
      excessQuantity,
      unit: input.unit,
      policyReference: input.policy.policyReference,
      rateReference,
      rateBps,
      estimatedAmount,
      currency,
      status,
      calculatedAt: new Date().toISOString(),
      isOverage: true,
      isBillable: input.policy.isBillable,
      requiresReview: input.policy.requiresReview,
      notConfigured: false,
    };

    this.logger.log(
      `Overage calculated tenant=${input.tenantId} meter=${input.meterKey} allowed=${input.allowedQuantity} actual=${input.actualQuantity} excess=${excessQuantity} status=${status} estimated=${estimatedAmount || 'N/A'}`,
    );

    if (isOverage && this.billingEventService) {
      this.billingEventService.onUsageOverageDetected({
        tenantId: input.tenantId,
        meterKey: input.meterKey,
        limitKey: input.limitKey,
        currentUsage: input.actualQuantity,
        maxLimit: input.allowedQuantity,
        overageQuantity: excessQuantity,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      }).catch((e) => this.logger.warn(`Failed to trigger overage notification: ${e.message}`));
    }

    return result;
  }

  async resolveOveragePolicy(tenantId: string, meterKey: MeterKey, limitKey: string): Promise<OveragePolicy | null> {
    // In real implementation, would check tenant-specific overage policy config or global policy
    // For now, check env or tenant metadata for explicit policy
    // Never invent default dollar price

    // Check if overage policy is configured via env: OVERAGE_POLICY_{METER_KEY}
    // Example: OVERAGE_POLICY_USERS_RATE_PER_UNIT=1.00
    // This is explicit configurable policy, not hardcoded commercial rate

    const envKey = `OVERAGE_POLICY_${meterKey}_RATE_PER_UNIT`;
    const envRate = process.env[envKey];
    const envCurrency = process.env[`OVERAGE_POLICY_${meterKey}_CURRENCY`] || 'USD';
    const envBillable = process.env[`OVERAGE_POLICY_${meterKey}_BILLABLE`] === 'true';

    if (envRate) {
      return {
        meterKey,
        tenantId,
        limitKey,
        allowedQuantity: 0, // Will be overridden by actual limit
        overageRatePerUnit: envRate,
        currency: envCurrency,
        unit: this.getUnitForMeter(meterKey),
        policyReference: `env:${envKey}`,
        isBillable: envBillable,
        requiresReview: true,
      };
    }

    // No policy configured - return null to trigger NOT_CONFIGURED
    return null;
  }

  async detectOverage(params: {
    tenantId: string;
    meterKey: MeterKey;
    limitKey: string;
    periodId: string;
    periodStart: string;
    periodEnd: string;
    allowedQuantity: number;
    actualQuantity: number;
    unit: MeterUnit;
    idempotencyKey?: string;
  }): Promise<OverageCalculationResult> {
    const policy = await this.resolveOveragePolicy(params.tenantId, params.meterKey, params.limitKey);

    return this.calculateOverage({
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      limitKey: params.limitKey,
      periodId: params.periodId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      allowedQuantity: params.allowedQuantity,
      actualQuantity: params.actualQuantity,
      unit: params.unit,
      policy,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async listOverages(
    tenantId: string,
    filter?: { meterKey?: MeterKey; periodId?: string; status?: OverageStatus; fromDate?: Date; toDate?: Date; limit?: number; offset?: number },
  ): Promise<any[]> {
    return this.overageRepository.listByTenant(tenantId, filter);
  }

  private mapRecordToResult(record: any, isOverage: boolean): OverageCalculationResult {
    return {
      tenantId: record.tenantId,
      meterKey: record.meterKey,
      limitKey: record.limitKey,
      periodId: record.periodId,
      allowedQuantity: record.allowedQuantity,
      actualQuantity: record.actualQuantity,
      excessQuantity: record.excessQuantity,
      unit: record.unit,
      policyReference: record.policyReference,
      rateReference: record.rateReference,
      rateBps: record.rateBps,
      estimatedAmount: record.estimatedAmount,
      currency: record.currency,
      status: record.status,
      calculatedAt: record.calculationTimestamp,
      isOverage,
      isBillable: record.status === OverageStatus.BILLABLE || record.status === OverageStatus.INVOICED,
      requiresReview: record.status === OverageStatus.REVIEW_REQUIRED,
      notConfigured: record.status === OverageStatus.NOT_CONFIGURED,
    };
  }

  private getUnitForMeter(meterKey: MeterKey): MeterUnit {
    switch (meterKey) {
      case MeterKey.USERS:
      case MeterKey.TRADERS:
      case MeterKey.FOLLOWERS:
      case MeterKey.EXCHANGE_ACCOUNTS:
      case MeterKey.COPY_SUBSCRIPTIONS:
      case MeterKey.ORDERS:
      case MeterKey.FILLS:
        return MeterUnit.COUNT;
      case MeterKey.API_REQUESTS:
        return MeterUnit.REQUEST;
      case MeterKey.WEBSOCKET_CONNECTIONS:
        return MeterUnit.CONNECTION;
      case MeterKey.TRADING_VOLUME:
      case MeterKey.COPY_TRADING_VOLUME:
      case MeterKey.PLATFORM_FEE_VOLUME:
      case MeterKey.PERFORMANCE_FEE_VOLUME:
        return MeterUnit.VOLUME_USD;
      default:
        return MeterUnit.COUNT;
    }
  }
}
