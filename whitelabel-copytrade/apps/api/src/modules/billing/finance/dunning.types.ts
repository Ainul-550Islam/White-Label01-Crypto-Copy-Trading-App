import type { UUID } from '@wlct/shared-types';

/**
 * Dunning types: dunning case ID, payment, subscription, tenant, attempt,
 * max attempts, grace period, next retry at, status, action taken,
 * suspension, and resolution.
 */

export enum DunningStatus {
  ACTIVE = 'ACTIVE',
  RETRY_SCHEDULED = 'RETRY_SCHEDULED',
  RETRYING = 'RETRYING',
  RECOVERED = 'RECOVERED',
  FAILED = 'FAILED',
  SUSPENDED = 'SUSPENDED',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
}

export enum DunningAction {
  NONE = 'NONE',
  RETRY_PAYMENT = 'RETRY_PAYMENT',
  SEND_REMINDER = 'SEND_REMINDER',
  RESTRICT_ACCESS = 'RESTRICT_ACCESS',
  SUSPEND_SUBSCRIPTION = 'SUSPEND_SUBSCRIPTION',
  CANCEL_SUBSCRIPTION = 'CANCEL_SUBSCRIPTION',
  NOTIFY_ADMIN = 'NOTIFY_ADMIN',
  ESCALATE = 'ESCALATE',
}

export enum DunningTrigger {
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  SUBSCRIPTION_RENEWAL_FAILED = 'SUBSCRIPTION_RENEWAL_FAILED',
  MANUAL = 'MANUAL',
}

export interface DunningCase {
  id: UUID;
  tenantId: UUID;
  paymentId: UUID;
  subscriptionId: UUID | null;
  trigger: DunningTrigger;
  status: DunningStatus;
  attempt: number;
  maxAttempts: number;
  gracePeriodEndsAt: Date | null;
  nextRetryAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  actionTaken: DunningAction;
  suspendedAt: Date | null;
  recoveredAt: Date | null;
  failedAt: Date | null;
  canceledAt: Date | null;
  resolvedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDunningInput {
  tenantId: UUID;
  paymentId: UUID;
  subscriptionId?: UUID | null;
  trigger: DunningTrigger;
  maxAttempts?: number;
  gracePeriodDays?: number;
  metadata?: Record<string, unknown>;
}

export interface DunningRetryInput {
  dunningId: UUID;
  tenantId: UUID;
  error?: string;
  errorCode?: string;
  nextRetryAt?: Date;
  actionTaken?: DunningAction;
}

export interface DunningFilter {
  tenantId?: UUID;
  paymentId?: UUID;
  subscriptionId?: UUID;
  status?: DunningStatus;
  trigger?: DunningTrigger;
  actionTaken?: DunningAction;
  fromDate?: Date;
  toDate?: Date;
}

export interface DunningPolicy {
  maxAttempts: number;
  gracePeriodDays: number;
  retryIntervalsHours: number[];
  suspendAfterAttempts: number;
  cancelAfterAttempts: number;
  notifyOnAttempts: number[];
  restrictAccessAfterAttempts: number;
}

export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  maxAttempts: 4,
  gracePeriodDays: 7,
  retryIntervalsHours: [24, 72, 120, 168],
  suspendAfterAttempts: 3,
  cancelAfterAttempts: 4,
  notifyOnAttempts: [1, 2, 3],
  restrictAccessAfterAttempts: 2,
};

export const VALID_DUNNING_TRANSITIONS: Record<DunningStatus, DunningStatus[]> = {
  [DunningStatus.ACTIVE]: [DunningStatus.RETRY_SCHEDULED, DunningStatus.RECOVERED, DunningStatus.FAILED, DunningStatus.CANCELED, DunningStatus.SUSPENDED],
  [DunningStatus.RETRY_SCHEDULED]: [DunningStatus.RETRYING, DunningStatus.RECOVERED, DunningStatus.FAILED, DunningStatus.CANCELED, DunningStatus.SUSPENDED],
  [DunningStatus.RETRYING]: [DunningStatus.RETRY_SCHEDULED, DunningStatus.RECOVERED, DunningStatus.FAILED, DunningStatus.SUSPENDED],
  [DunningStatus.RECOVERED]: [],
  [DunningStatus.FAILED]: [DunningStatus.ACTIVE],
  [DunningStatus.SUSPENDED]: [DunningStatus.RECOVERED, DunningStatus.FAILED, DunningStatus.CANCELED, DunningStatus.EXPIRED],
  [DunningStatus.CANCELED]: [],
  [DunningStatus.EXPIRED]: [],
};

export function isValidDunningTransition(from: DunningStatus, to: DunningStatus): boolean {
  const allowed = VALID_DUNNING_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function calculateNextRetryAt(attempt: number, policy: DunningPolicy, baseDate: Date = new Date()): Date {
  const intervalIndex = Math.min(attempt, policy.retryIntervalsHours.length - 1);
  const intervalHours = policy.retryIntervalsHours[intervalIndex] || 24;

  const nextRetry = new Date(baseDate);
  nextRetry.setHours(nextRetry.getHours() + intervalHours);

  return nextRetry;
}

export function calculateGracePeriodEnd(gracePeriodDays: number, baseDate: Date = new Date()): Date {
  const graceEnd = new Date(baseDate);
  graceEnd.setDate(graceEnd.getDate() + gracePeriodDays);
  return graceEnd;
}
