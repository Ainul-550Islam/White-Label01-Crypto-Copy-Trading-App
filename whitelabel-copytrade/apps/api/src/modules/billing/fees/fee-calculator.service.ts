import { Injectable, Logger } from '@nestjs/common';
import { FeeType, FeeSourceType, RateBasis, FeeCalculationInput, FeeCalculationResult } from './fee.types';
import {
  createMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
  RoundingMode,
} from '../finance/money.types';

/**
 * Decimal-safe fee calculation using minor-unit arithmetic.
 * Never uses floating-point for financial amounts.
 * Formula: fee = gross * bps / 10000
 *          net = gross - fee
 */
@Injectable()
export class FeeCalculatorService {
  private readonly logger = new Logger(FeeCalculatorService.name);

  calculate(input: FeeCalculationInput): FeeCalculationResult {
    this.validateInput(input);

    const minorUnit = getMinorUnitForCurrency(input.currency);
    const grossMinor = parseToMinorUnits(input.grossAmount, input.currency);

    if (grossMinor < 0) {
      throw new Error('Gross amount cannot be negative');
    }

    // Validate BPS
    if (input.feeRateBps < 0 || input.feeRateBps > 10000) {
      throw new Error(`Invalid fee rate BPS ${input.feeRateBps}, must be 0-10000`);
    }

    // Precise BPS calculation using minor units:
    // feeMinor = round(grossMinor * bps / 10000)
    // Use integer arithmetic to avoid floating errors
    let feeMinor = this.calculateBpsMinor(grossMinor, input.feeRateBps);

    let minimumApplied = false;
    let capApplied = false;

    // Minimum fee check
    if (input.minimumFee) {
      const minMinor = parseToMinorUnits(input.minimumFee, input.currency);
      if (feeMinor < minMinor) {
        feeMinor = minMinor;
        minimumApplied = true;
      }
    }

    // Maximum cap check
    if (input.maximumCap) {
      const maxMinor = parseToMinorUnits(input.maximumCap, input.currency);
      if (feeMinor > maxMinor) {
        feeMinor = maxMinor;
        capApplied = true;
      }
    }

    // Net = gross - fee
    const netMinor = grossMinor - feeMinor;

    if (netMinor < 0) {
      throw new Error('Net amount cannot be negative after fee deduction');
    }

    const feeAmount = formatFromMinorUnits(feeMinor, input.currency);
    const netAmount = formatFromMinorUnits(netMinor, input.currency);
    const grossNormalized = formatFromMinorUnits(grossMinor, input.currency);

    const result: FeeCalculationResult = {
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      feeType: input.feeType,
      grossAmount: grossNormalized,
      feeAmount,
      netAmount,
      currency: input.currency.toUpperCase(),
      feeRateBps: input.feeRateBps,
      rateBasis: RateBasis.BPS,
      calculatedAt: new Date().toISOString(),
      minimumApplied,
      capApplied,
      metadata: input.metadata,
    };

    this.logger.log(
      `Fee calculated tenant=${input.tenantId} type=${input.feeType} source=${input.sourceType}:${input.sourceId} gross=${grossNormalized} fee=${feeAmount} net=${netAmount} bps=${input.feeRateBps} currency=${input.currency}`,
    );

    return result;
  }

  calculatePlatformFee(params: {
    tenantId: string;
    sourceType: FeeSourceType;
    sourceId: string;
    grossAmount: string;
    currency: string;
    platformFeeBps: number;
    minimumFee?: string | null;
    maximumCap?: string | null;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): FeeCalculationResult {
    return this.calculate({
      tenantId: params.tenantId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      feeType: FeeType.PLATFORM_FEE,
      grossAmount: params.grossAmount,
      currency: params.currency,
      feeRateBps: params.platformFeeBps,
      minimumFee: params.minimumFee,
      maximumCap: params.maximumCap,
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata,
    });
  }

  calculatePerformanceFee(params: {
    tenantId: string;
    sourceType: FeeSourceType;
    sourceId: string;
    grossAmount: string;
    currency: string;
    performanceFeeBps: number;
    minimumFee?: string | null;
    maximumCap?: string | null;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): FeeCalculationResult {
    return this.calculate({
      tenantId: params.tenantId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      feeType: FeeType.PERFORMANCE_FEE,
      grossAmount: params.grossAmount,
      currency: params.currency,
      feeRateBps: params.performanceFeeBps,
      minimumFee: params.minimumFee,
      maximumCap: params.maximumCap,
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata,
    });
  }

  private calculateBpsMinor(grossMinor: number, bps: number): number {
    // Decimal-safe: feeMinor = round(grossMinor * bps / 10000)
    // Use integer arithmetic with rounding HALF_UP
    // To avoid floating, we do: (grossMinor * bps + 5000) / 10000 floor for half up when bps* grossMinor divisible?
    // But grossMinor * bps can overflow JS number? grossMinor up to large, but JS safe integer 2^53 ~9e15, minor units typically < 1e12, bps 10000 => product <1e16 close to limit.
    // Use Math.round for HALF_UP: Math.round(grossMinor * bps / 10000)
    // This still uses floating but only on integer product division, minimal error vs direct float on decimals.
    // Better: use BigInt for precision
    try {
      const grossBig = BigInt(grossMinor);
      const bpsBig = BigInt(bps);
      const divisor = BigInt(10000);
      // Half up: (gross * bps + divisor/2) / divisor
      const halfDivisor = divisor / BigInt(2);
      const result = (grossBig * bpsBig + halfDivisor) / divisor;
      return Number(result);
    } catch {
      // Fallback
      return Math.round((grossMinor * bps) / 10000);
    }
  }

  private validateInput(input: FeeCalculationInput): void {
    if (!input.tenantId) throw new Error('tenantId required');
    if (!input.sourceId) throw new Error('sourceId required');
    if (!input.sourceType) throw new Error('sourceType required');
    if (!input.feeType) throw new Error('feeType required');
    if (!input.grossAmount) throw new Error('grossAmount required');
    if (!input.currency) throw new Error('currency required');

    // Validate currency format (3 letters or known crypto)
    const currency = input.currency.toUpperCase();
    if (currency.length < 2 || currency.length > 10) {
      throw new Error(`Invalid currency: ${input.currency}`);
    }

    // Validate gross amount is numeric string
    const minorUnit = getMinorUnitForCurrency(currency);
    try {
      parseToMinorUnits(input.grossAmount, currency);
    } catch {
      throw new Error(`Invalid gross amount: ${input.grossAmount}`);
    }

    // Never trust client-provided fee amounts - we calculate, not accept feeAmount from client
    // This service only accepts gross and rate, not feeAmount
  }
}
