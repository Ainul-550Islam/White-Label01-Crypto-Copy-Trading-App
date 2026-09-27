/**
 * Production Provider Integration & External Service Adapter Control Plane
 * Canonical provider domains, states, capabilities, errors, and contracts
 *
 * This file defines the authoritative provider contracts that sit underneath
 * existing domain factories/interfaces. Existing domain services remain authoritative.
 */

export enum ProviderDomain {
  PAYMENT = 'PAYMENT',
  EXCHANGE = 'EXCHANGE',
  KYC = 'KYC',
  AML = 'AML',
  PAYOUT = 'PAYOUT',
  CUSTODY = 'CUSTODY',
  NOTIFICATION = 'NOTIFICATION',
  BLOCKCHAIN = 'BLOCKCHAIN',
}

export enum ProviderName {
  STRIPE = 'stripe',
  NOWPAYMENTS = 'nowpayments',
  BINANCE = 'binance',
  BYBIT = 'bybit',
  OKX = 'okx',
  KRAKEN = 'kraken',
  COINBASE = 'coinbase',
  KYC_GENERIC = 'kyc_generic',
  AML_GENERIC = 'aml_generic',
  PAYOUT_GENERIC = 'payout_generic',
  CUSTODY_GENERIC = 'custody_generic',
  EMAIL_GENERIC = 'email_generic',
}

export enum ProviderState {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  CONFIGURED = 'CONFIGURED',
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
  DEGRADED = 'DEGRADED',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum ProviderHealthState {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNAVAILABLE = 'UNAVAILABLE',
  MISCONFIGURED = 'MISCONFIGURED',
  UNKNOWN = 'UNKNOWN',
}

export enum ProviderCapability {
  BALANCE_READ = 'BALANCE_READ',
  POSITION_READ = 'POSITION_READ',
  ORDER_CREATE = 'ORDER_CREATE',
  ORDER_CANCEL = 'ORDER_CANCEL',
  ORDER_REPLACE = 'ORDER_REPLACE',
  ORDER_READ = 'ORDER_READ',
  FILL_READ = 'FILL_READ',
  SYMBOL_READ = 'SYMBOL_READ',
  ACCOUNT_HEALTH = 'ACCOUNT_HEALTH',
  PAYMENT_CREATE = 'PAYMENT_CREATE',
  PAYMENT_READ = 'PAYMENT_READ',
  REFUND = 'REFUND',
  WEBHOOK = 'WEBHOOK',
  KYC_SUBMIT = 'KYC_SUBMIT',
  KYC_STATUS = 'KYC_STATUS',
  AML_SCREEN = 'AML_SCREEN',
  PAYOUT_CREATE = 'PAYOUT_CREATE',
  PAYOUT_STATUS = 'PAYOUT_STATUS',
  CUSTODY_BALANCE = 'CUSTODY_BALANCE',
  CUSTODY_TRANSACTION_READ = 'CUSTODY_TRANSACTION_READ',
  CUSTODY_TRANSACTION_SUBMIT = 'CUSTODY_TRANSACTION_SUBMIT',
  CONFIRMATION_READ = 'CONFIRMATION_READ',
  NOTIFICATION_SEND = 'NOTIFICATION_SEND',
}

export enum ProviderErrorCode {
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  CAPABILITY_NOT_SUPPORTED = 'CAPABILITY_NOT_SUPPORTED',
  AUTH_FAILED = 'AUTH_FAILED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
  WEBHOOK_SIGNATURE_INVALID = 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_REPLAY = 'WEBHOOK_REPLAY',
  UNKNOWN = 'UNKNOWN',
}

export enum RetryClassification {
  SAFE_RETRY = 'SAFE_RETRY',
  UNSAFE_RETRY = 'UNSAFE_RETRY',
  NO_RETRY = 'NO_RETRY',
  RATE_LIMIT_RETRY = 'RATE_LIMIT_RETRY',
  AUTH_FAILURE = 'AUTH_FAILURE',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  TIMEOUT_UNKNOWN_RESULT = 'TIMEOUT_UNKNOWN_RESULT',
}

export enum WebhookState {
  RECEIVED = 'RECEIVED',
  SIGNATURE_VERIFIED = 'SIGNATURE_VERIFIED',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  REPLAY_DETECTED = 'REPLAY_DETECTED',
  PROCESSED = 'PROCESSED',
  DUPLICATE = 'DUPLICATE',
  FAILED = 'FAILED',
}

export enum ProviderOperationType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  WEBHOOK = 'WEBHOOK',
  HEALTH_CHECK = 'HEALTH_CHECK',
  RECONCILIATION = 'RECONCILIATION',
}

export interface ProviderRequestContext {
  tenantId?: string;
  userId?: string;
  accountId?: string;
  correlationId: string;
  idempotencyKey: string;
  operation: ProviderOperationType;
  domain: ProviderDomain;
  provider: ProviderName;
  timestamp: string;
  environment: string;
  isSandbox: boolean;
}

export interface NormalizedProviderError {
  code: ProviderErrorCode;
  message: string;
  provider: ProviderName;
  domain: ProviderDomain;
  isRetryable: boolean;
  retryClassification: RetryClassification;
  retryAfterMs?: number | null;
  httpStatus?: number;
  providerCode?: string;
  correlationId: string;
  safeEvidence: Record<string, unknown>;
}

export interface ProviderCapabilityInfo {
  capability: ProviderCapability;
  supported: boolean;
  reason?: string;
}

export interface ProviderHealthResult {
  provider: ProviderName;
  domain: ProviderDomain;
  state: ProviderHealthState;
  latencyMs: number;
  capabilities: ProviderCapabilityInfo[];
  lastCheckedAt: string;
  correlationId: string;
  evidence: Record<string, unknown>;
  error?: NormalizedProviderError;
  isMisconfigured: boolean;
}

export interface ProviderResult<T> {
  success: boolean;
  provider: ProviderName;
  domain: ProviderDomain;
  data?: T | null;
  error?: NormalizedProviderError | null;
  correlationId: string;
  providerReference?: string | null;
  timestamp: string;
  latencyMs: number;
  rawStatus?: string;
}

export interface NormalizedPaymentProviderResult {
  providerPaymentId: string;
  providerCheckoutId?: string | null;
  providerSessionId?: string | null;
  status: string;
  amount: string;
  currency: string;
  providerCustomerId?: string | null;
  checkoutUrl?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  safeMetadata: Record<string, unknown>;
}

export interface NormalizedExchangeOrderResult {
  providerOrderId: string | null;
  clientOrderId: string;
  symbol: string;
  exchangeSymbol: string;
  side: string;
  orderType: string;
  timeInForce?: string | null;
  requestedQuantity: string;
  executedQuantity: string;
  averagePrice: string | null;
  status: string;
  fee: string | null;
  feeAsset: string | null;
  timestamp: string;
  venue: string;
  isSimulated: boolean;
  safeRawStatus: string | null;
}

export interface NormalizedKycResult {
  providerReference: string;
  status: string;
  decision: string;
  reasonCode?: string | null;
  riskLevel?: string | null;
  timestamp: string;
  safeMetadata: Record<string, unknown>;
}

export interface NormalizedAmlResult {
  providerReference: string;
  status: string;
  decision: string;
  riskLevel?: string | null;
  matchedLists?: string[];
  reasonCode?: string | null;
  timestamp: string;
  safeMetadata: Record<string, unknown>;
}

export interface NormalizedPayoutResult {
  providerPayoutId: string;
  status: string;
  amount: string;
  currency: string;
  destination?: string | null;
  fee?: string | null;
  createdAt: string;
  completedAt?: string | null;
  safeMetadata: Record<string, unknown>;
}

export interface NormalizedCustodyResult {
  transactionHash: string | null;
  providerReference: string;
  networkId: string;
  assetId: string;
  assetSymbol: string;
  amount: string;
  fee: string | null;
  confirmationCount: number;
  requiredConfirmations: number;
  blockNumber?: string | null;
  blockHash?: string | null;
  status: string;
  isFinal: boolean;
  isReorg: boolean;
  timestamp: string;
  safeMetadata: Record<string, unknown>;
}

export interface NormalizedNotificationResult {
  providerMessageId: string | null;
  status: string;
  accepted: boolean;
  retryable: boolean;
  resultType: string;
  deliveredAt?: string | null;
  failureReason?: string | null;
  safeMetadata: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  verified: boolean;
  eventId: string;
  eventType: string;
  timestamp?: string;
  state: WebhookState;
  failureReason?: string;
  correlationId: string;
}

export interface ReconciliationMismatch {
  type:
    | 'LOCAL_MISSING_PROVIDER'
    | 'PROVIDER_MISSING_LOCAL'
    | 'STATUS_MISMATCH'
    | 'AMOUNT_MISMATCH'
    | 'CURRENCY_MISMATCH'
    | 'ASSET_MISMATCH'
    | 'NETWORK_MISMATCH'
    | 'EXTERNAL_REFERENCE_MISMATCH'
    | 'DUPLICATE_EVENT'
    | 'MISSING_WEBHOOK'
    | 'WEBHOOK_REPLAY'
    | 'UNKNOWN_PROVIDER_RESULT';
  localId?: string;
  providerReference?: string;
  localValue?: unknown;
  providerValue?: unknown;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  correlationId: string;
  detectedAt: string;
}

export interface ProviderObservation {
  observationId: string;
  provider: ProviderName;
  domain: ProviderDomain;
  operation: ProviderOperationType;
  correlationId: string;
  idempotencyKey: string;
  tenantId?: string;
  providerReference?: string | null;
  status: string;
  latencyMs: number;
  safeEvidence: Record<string, unknown>;
  createdAt: string;
}

export const CRITICAL_PROVIDER_DOMAINS = [
  ProviderDomain.PAYMENT,
  ProviderDomain.EXCHANGE,
  ProviderDomain.CUSTODY,
  ProviderDomain.PAYOUT,
];

export const PRODUCTION_REQUIRED_CAPABILITIES: Record<ProviderDomain, ProviderCapability[]> = {
  [ProviderDomain.PAYMENT]: [ProviderCapability.PAYMENT_CREATE, ProviderCapability.PAYMENT_READ, ProviderCapability.WEBHOOK],
  [ProviderDomain.EXCHANGE]: [ProviderCapability.BALANCE_READ, ProviderCapability.ORDER_READ, ProviderCapability.SYMBOL_READ, ProviderCapability.ACCOUNT_HEALTH],
  [ProviderDomain.KYC]: [ProviderCapability.KYC_SUBMIT, ProviderCapability.KYC_STATUS],
  [ProviderDomain.AML]: [ProviderCapability.AML_SCREEN],
  [ProviderDomain.PAYOUT]: [ProviderCapability.PAYOUT_CREATE, ProviderCapability.PAYOUT_STATUS],
  [ProviderDomain.CUSTODY]: [ProviderCapability.CUSTODY_BALANCE, ProviderCapability.CUSTODY_TRANSACTION_READ, ProviderCapability.CONFIRMATION_READ],
  [ProviderDomain.NOTIFICATION]: [ProviderCapability.NOTIFICATION_SEND],
  [ProviderDomain.BLOCKCHAIN]: [ProviderCapability.CUSTODY_BALANCE, ProviderCapability.CUSTODY_TRANSACTION_READ],
};
