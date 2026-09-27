/**
 * Usage alert domain types: threshold percentage, absolute threshold,
 * feature/limit key, severity, cooldown, delivery state.
 */

import { MeterKey } from './usage-metering.types';

export enum AlertThresholdType {
  PERCENTAGE = 'PERCENTAGE',
  ABSOLUTE = 'ABSOLUTE',
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum AlertState {
  ACTIVE = 'ACTIVE',
  TRIGGERED = 'TRIGGERED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
  SUPPRESSED = 'SUPPRESSED',
  DISABLED = 'DISABLED',
}

export interface UsageAlertConfig {
  id: string;
  tenantId: string;
  meterKey: MeterKey;
  limitKey: string;
  thresholdType: AlertThresholdType;
  thresholdValue: number;
  severity: AlertSeverity;
  enabled: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface UsageAlertEvent {
  id: string;
  tenantId: string;
  configId: string;
  meterKey: MeterKey;
  limitKey: string;
  thresholdType: AlertThresholdType;
  thresholdValue: number;
  currentValue: number;
  maximumValue: number | null;
  utilizationPercent: number | null;
  severity: AlertSeverity;
  state: AlertState;
  periodId: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  deliveryState: 'PENDING' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED';
  idempotencyKey: string;
  safeMetadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AlertEvaluationInput {
  tenantId: string;
  meterKey: MeterKey;
  limitKey: string;
  currentValue: number;
  maximumValue: number | null;
  utilizationPercent: number | null;
  periodId: string;
}

export interface AlertEvaluationResult {
  shouldAlert: boolean;
  matchedConfigs: UsageAlertConfig[];
  highestSeverity: AlertSeverity | null;
  reason: string;
}
