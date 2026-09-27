/**
 * Payout domain types: beneficiary, amount, currency, status, destination reference,
 * provider reference, batch state, failure states.
 */

export enum PayoutProvider {
  NONE = 'NONE',
  STRIPE = 'STRIPE',
  MANUAL = 'MANUAL',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CRYPTO = 'CRYPTO',
  INTERNAL = 'INTERNAL',
}

export enum PayoutStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REVERSED = 'REVERSED',
}

export enum BeneficiaryType {
  TRADER = 'TRADER',
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
  AFFILIATE = 'AFFILIATE',
}

export interface PayoutDestination {
  type: 'bank_account' | 'crypto_wallet' | 'internal_account' | 'stripe_account';
  reference: string; // Safe reference, never private key or credentials
  maskedReference: string; // e.g., ****1234 or 0x1234...abcd
  currency: string;
  country?: string;
  metadata?: Record<string, unknown>;
}

export interface Payout {
  id: string;
  settlementId: string;
  beneficiaryId: string;
  beneficiaryType: BeneficiaryType;
  tenantId: string;
  amount: string;
  currency: string;
  destination: PayoutDestination;
  provider: PayoutProvider;
  providerPayoutId: string | null;
  providerReference: string | null;
  status: PayoutStatus;
  failureReason: string | null;
  idempotencyKey: string;
  requestedAt: string;
  processedAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  metadata: Record<string, unknown> | null;
  safeMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePayoutInput {
  settlementId: string;
  beneficiaryId: string;
  beneficiaryType: BeneficiaryType;
  tenantId: string;
  amount: string;
  currency: string;
  destination: PayoutDestination;
  provider?: PayoutProvider;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface PayoutProviderResult {
  providerPayoutId: string;
  providerReference?: string;
  status: PayoutStatus;
  rawResponse?: unknown;
  failureReason?: string;
}

export interface PayoutStatusResult {
  providerPayoutId: string;
  status: PayoutStatus;
  failureReason?: string;
  processedAt?: string;
  rawResponse?: unknown;
}
