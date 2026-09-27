/**
 * Overage domain types: meter, threshold, excess quantity, unit, rate reference,
 * estimated amount, billing period, and overage state.
 */

import { MeterKey, MeterUnit } from './usage-metering.types';

export enum OverageStatus {
  DETECTED = 'DETECTED',
  CALCULATED = 'CALCULATED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  BILLABLE = 'BILLABLE',
  INVOICED = 'INVOICED',
  WAIVED = 'WAIVED',
  REVERSED = 'REVERSED',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
}

export interface OveragePolicy {
  meterKey: MeterKey;
  tenantId?: string;
  limitKey: string;
  allowedQuantity: number;
  overageRateBps?: number | null;
  overageRatePerUnit?: string | null;
  currency?: string;
  unit: MeterUnit;
  policyReference: string;
  isBillable: boolean;
  requiresReview: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface OverageRecord {
  id: string;
  tenantId: string;
  meterKey: MeterKey;
  limitKey: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  allowedQuantity: number;
  actualQuantity: number;
  excessQuantity: number;
  unit: MeterUnit;
  policyReference: string | null;
  rateReference: string | null;
  rateBps: number | null;
  estimatedAmount: string | null;
  currency: string | null;
  status: OverageStatus;
  idempotencyKey: string;
  calculationTimestamp: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface OverageCalculationInput {
  tenantId: string;
  meterKey: MeterKey;
  limitKey: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  allowedQuantity: number;
  actualQuantity: number;
  unit: MeterUnit;
  policy?: OveragePolicy | null;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface OverageCalculationResult {
  tenantId: string;
  meterKey: MeterKey;
  limitKey: string;
  periodId: string;
  allowedQuantity: number;
  actualQuantity: number;
  excessQuantity: number;
  unit: MeterUnit;
  policyReference: string | null;
  rateReference: string | null;
  rateBps: number | null;
  estimatedAmount: string | null;
  currency: string | null;
  status: OverageStatus;
  calculatedAt: string;
  isOverage: boolean;
  isBillable: boolean;
  requiresReview: boolean;
  notConfigured: boolean;
}
