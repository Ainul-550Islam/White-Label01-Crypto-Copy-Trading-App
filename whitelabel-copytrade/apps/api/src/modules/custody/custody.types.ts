/**
 * Part 21 — Institutional Treasury, Custody & On-Chain Settlement Control Plane
 * Canonical custody states, wallet states, transaction states, deposit/withdrawal states,
 * confirmation states, reserve states, sweep states, settlement states, network/asset capability types,
 * custody scopes, provider results, and explicit transition maps.
 *
 * Rules:
 * - Never mark an on-chain transaction CONFIRMED without authoritative provider/chain evidence.
 * - Never invent transaction hashes, block hashes, confirmation counts, network fees, blockchain balances.
 * - Never mark withdrawal completed merely because approved internally.
 * - Never mark deposit confirmed merely because address generated.
 * - Decimal-safe arithmetic mandatory, token decimals from authoritative metadata, integer base-unit for providers.
 * - All provider calls idempotent where supported, internal operations deterministic idempotency.
 * - Never store raw private keys in plaintext, never expose seeds/private keys/secrets.
 * - Network and asset identifiers must always be explicit.
 * - Never mutate external chain state via DB shortcut, never silent network/asset substitution.
 */

import { createHash } from 'crypto';

export enum CustodyWalletState {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  RESTRICTED = 'RESTRICTED',
  SUSPENDED = 'SUSPENDED',
  CLOSURE_PENDING = 'CLOSURE_PENDING',
  CLOSED = 'CLOSED',
}

export enum CustodyWalletAddressState {
  GENERATING = 'GENERATING',
  ACTIVE = 'ACTIVE',
  RESERVED = 'RESERVED',
  DEPRECATED = 'DEPRECATED',
  BLOCKED = 'BLOCKED',
}

export enum CustodyDepositState {
  EXPECTED = 'EXPECTED',
  OBSERVED = 'OBSERVED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  REORGED = 'REORGED',
  REJECTED = 'REJECTED',
}

export enum CustodyWithdrawalState {
  REQUESTED = 'REQUESTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  QUEUED = 'QUEUED',
  SUBMITTED = 'SUBMITTED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  REORGED = 'REORGED',
}

export enum CustodyTransactionState {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  OBSERVED = 'OBSERVED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  FINAL = 'FINAL',
  FAILED = 'FAILED',
  DROPPED = 'DROPPED',
  REPLACED = 'REPLACED',
  REORGED = 'REORGED',
}

export enum CustodyConfirmationState {
  OBSERVED = 'OBSERVED',
  REQUIRED = 'REQUIRED',
  CONFIRMED = 'CONFIRMED',
  FINAL = 'FINAL',
  FAILED = 'FAILED',
  REORGED = 'REORGED',
}

export enum CustodyInternalTransferState {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  SETTLING = 'SETTLING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum CustodyReserveState {
  ACTIVE = 'ACTIVE',
  INSUFFICIENT = 'INSUFFICIENT',
  SUFFICIENT = 'SUFFICIENT',
  LOCKED = 'LOCKED',
  PENDING = 'PENDING',
}

export enum CustodySweepState {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  SUBMITTING = 'SUBMITTING',
  SETTLING = 'SETTLING',
  CONFIRMING = 'CONFIRMING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum CustodySettlementState {
  PENDING = 'PENDING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  REORGED = 'REORGED',
}

export enum CustodyScope {
  CLIENT = 'CLIENT',
  TENANT_OWNER = 'TENANT_OWNER',
  TREASURY_OPERATOR = 'TREASURY_OPERATOR',
  COMPLIANCE_REVIEWER = 'COMPLIANCE_REVIEWER',
  RISK_REVIEWER = 'RISK_REVIEWER',
  SECURITY_ADMIN = 'SECURITY_ADMIN',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
  ACCOUNT = 'ACCOUNT',
  WALLET = 'WALLET',
}

export enum CustodyReconciliationType {
  WALLET_WITHOUT_PROVIDER_RECORD = 'WALLET_WITHOUT_PROVIDER_RECORD',
  PROVIDER_WALLET_WITHOUT_INTERNAL_RECORD = 'PROVIDER_WALLET_WITHOUT_INTERNAL_RECORD',
  ADDRESS_OWNERSHIP_MISMATCH = 'ADDRESS_OWNERSHIP_MISMATCH',
  DEPOSIT_WITHOUT_TRANSACTION = 'DEPOSIT_WITHOUT_TRANSACTION',
  TRANSACTION_WITHOUT_DEPOSIT = 'TRANSACTION_WITHOUT_DEPOSIT',
  WITHDRAWAL_WITHOUT_TRANSACTION = 'WITHDRAWAL_WITHOUT_TRANSACTION',
  TRANSACTION_WITHOUT_WITHDRAWAL = 'TRANSACTION_WITHOUT_WITHDRAWAL',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  ASSET_MISMATCH = 'ASSET_MISMATCH',
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',
  TRANSACTION_STATUS_MISMATCH = 'TRANSACTION_STATUS_MISMATCH',
  CONFIRMATION_MISMATCH = 'CONFIRMATION_MISMATCH',
  FEE_MISMATCH = 'FEE_MISMATCH',
  BALANCE_MISMATCH = 'BALANCE_MISMATCH',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  DUPLICATE_EXTERNAL_REFERENCE = 'DUPLICATE_EXTERNAL_REFERENCE',
  REORG_DETECTED = 'REORG_DETECTED',
  RESERVE_MISMATCH = 'RESERVE_MISMATCH',
  SETTLEMENT_MISSING = 'SETTLEMENT_MISSING',
  WALLET = 'WALLET',
  TRANSACTION = 'TRANSACTION',
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  BALANCE = 'BALANCE',
  RESERVE = 'RESERVE',
  FEE = 'FEE',
  CONFIRMATION = 'CONFIRMATION',
  SETTLEMENT = 'SETTLEMENT',
}

export enum CustodyAuditAction {
  WALLET_CREATED = 'WALLET_CREATED',
  WALLET_ACTIVATED = 'WALLET_ACTIVATED',
  WALLET_RESTRICTED = 'WALLET_RESTRICTED',
  WALLET_SUSPENDED = 'WALLET_SUSPENDED',
  WALLET_CLOSED = 'WALLET_CLOSED',
  WALLET_ACTIVE = 'WALLET_ACTIVE',
  WALLET_PENDING = 'WALLET_PENDING',
  WALLET_RESTRICTED_ACTION = 'WALLET_RESTRICTED_ACTION',
  WALLET_SUSPENDED_ACTION = 'WALLET_SUSPENDED_ACTION',
  WALLET_CLOSURE_PENDING = 'WALLET_CLOSURE_PENDING',
  WALLET_CLOSED_ACTION = 'WALLET_CLOSED_ACTION',
  ADDRESS_GENERATED = 'ADDRESS_GENERATED',
  ADDRESS_VERIFIED = 'ADDRESS_VERIFIED',
  ADDRESS_STATUS_CHANGED = 'ADDRESS_STATUS_CHANGED',
  DEPOSIT_OBSERVED = 'DEPOSIT_OBSERVED',
  DEPOSIT_CONFIRMED = 'DEPOSIT_CONFIRMED',
  DEPOSIT_REORGED = 'DEPOSIT_REORGED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_SUBMITTED = 'WITHDRAWAL_SUBMITTED',
  WITHDRAWAL_CONFIRMED = 'WITHDRAWAL_CONFIRMED',
  WITHDRAWAL_FAILED = 'WITHDRAWAL_FAILED',
  TRANSACTION_CREATED = 'TRANSACTION_CREATED',
  TRANSACTION_OBSERVED = 'TRANSACTION_OBSERVED',
  TRANSACTION_CONFIRMED = 'TRANSACTION_CONFIRMED',
  TRANSACTION_FINAL = 'TRANSACTION_FINAL',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  TRANSACTION_REORGED = 'TRANSACTION_REORGED',
  TRANSACTION_SUBMITTED = 'TRANSACTION_SUBMITTED',
  TRANSACTION_CONFIRMING = 'TRANSACTION_CONFIRMING',
  CONFIRMATION_OBSERVED = 'CONFIRMATION_OBSERVED',
  INTERNAL_TRANSFER_CREATED = 'INTERNAL_TRANSFER_CREATED',
  INTERNAL_TRANSFER_APPROVED = 'INTERNAL_TRANSFER_APPROVED',
  INTERNAL_TRANSFER_SETTLED = 'INTERNAL_TRANSFER_SETTLED',
  SWEEP_REQUESTED = 'SWEEP_REQUESTED',
  SWEEP_APPROVED = 'SWEEP_APPROVED',
  SWEEP_SETTLED = 'SWEEP_SETTLED',
  RESERVE_CREATED = 'RESERVE_CREATED',
  RESERVE_UPDATED = 'RESERVE_UPDATED',
  RECONCILIATION_RUN = 'RECONCILIATION_RUN',
  RECONCILIATION_FINDING = 'RECONCILIATION_FINDING',
  RECONCILIATION_RESOLVED = 'RECONCILIATION_RESOLVED',
  SETTLEMENT_FINALIZED = 'SETTLEMENT_FINALIZED',
  SETTLEMENT_REORGED = 'SETTLEMENT_REORGED',
}

// Explicit transition maps — do not permit arbitrary transitions

export const WALLET_VALID_TRANSITIONS: Record<CustodyWalletState, CustodyWalletState[]> = {
  [CustodyWalletState.PENDING]: [CustodyWalletState.ACTIVE, CustodyWalletState.CLOSED],
  [CustodyWalletState.ACTIVE]: [CustodyWalletState.RESTRICTED, CustodyWalletState.SUSPENDED, CustodyWalletState.CLOSURE_PENDING],
  [CustodyWalletState.RESTRICTED]: [CustodyWalletState.ACTIVE, CustodyWalletState.SUSPENDED, CustodyWalletState.CLOSURE_PENDING],
  [CustodyWalletState.SUSPENDED]: [CustodyWalletState.ACTIVE, CustodyWalletState.CLOSURE_PENDING, CustodyWalletState.CLOSED],
  [CustodyWalletState.CLOSURE_PENDING]: [CustodyWalletState.CLOSED, CustodyWalletState.ACTIVE],
  [CustodyWalletState.CLOSED]: [],
};

export const ADDRESS_VALID_TRANSITIONS: Record<CustodyWalletAddressState, CustodyWalletAddressState[]> = {
  [CustodyWalletAddressState.GENERATING]: [CustodyWalletAddressState.ACTIVE, CustodyWalletAddressState.BLOCKED],
  [CustodyWalletAddressState.ACTIVE]: [CustodyWalletAddressState.RESERVED, CustodyWalletAddressState.DEPRECATED, CustodyWalletAddressState.BLOCKED],
  [CustodyWalletAddressState.RESERVED]: [CustodyWalletAddressState.ACTIVE, CustodyWalletAddressState.DEPRECATED],
  [CustodyWalletAddressState.DEPRECATED]: [CustodyWalletAddressState.BLOCKED],
  [CustodyWalletAddressState.BLOCKED]: [],
};

export const DEPOSIT_VALID_TRANSITIONS: Record<CustodyDepositState, CustodyDepositState[]> = {
  [CustodyDepositState.EXPECTED]: [CustodyDepositState.OBSERVED, CustodyDepositState.FAILED, CustodyDepositState.REJECTED],
  [CustodyDepositState.OBSERVED]: [CustodyDepositState.CONFIRMING, CustodyDepositState.FAILED, CustodyDepositState.REJECTED],
  [CustodyDepositState.CONFIRMING]: [CustodyDepositState.CONFIRMED, CustodyDepositState.FAILED, CustodyDepositState.REORGED],
  [CustodyDepositState.CONFIRMED]: [CustodyDepositState.REORGED], // reorg handling
  [CustodyDepositState.FAILED]: [],
  [CustodyDepositState.REORGED]: [CustodyDepositState.CONFIRMING, CustodyDepositState.FAILED],
  [CustodyDepositState.REJECTED]: [],
};

export const WITHDRAWAL_VALID_TRANSITIONS: Record<CustodyWithdrawalState, CustodyWithdrawalState[]> = {
  [CustodyWithdrawalState.REQUESTED]: [CustodyWithdrawalState.UNDER_REVIEW, CustodyWithdrawalState.REJECTED, CustodyWithdrawalState.CANCELLED],
  [CustodyWithdrawalState.UNDER_REVIEW]: [CustodyWithdrawalState.APPROVED, CustodyWithdrawalState.REJECTED, CustodyWithdrawalState.CANCELLED],
  [CustodyWithdrawalState.APPROVED]: [CustodyWithdrawalState.QUEUED, CustodyWithdrawalState.CANCELLED],
  [CustodyWithdrawalState.QUEUED]: [CustodyWithdrawalState.SUBMITTED, CustodyWithdrawalState.FAILED, CustodyWithdrawalState.CANCELLED],
  [CustodyWithdrawalState.SUBMITTED]: [CustodyWithdrawalState.CONFIRMING, CustodyWithdrawalState.FAILED],
  [CustodyWithdrawalState.CONFIRMING]: [CustodyWithdrawalState.CONFIRMED, CustodyWithdrawalState.FAILED, CustodyWithdrawalState.REORGED],
  [CustodyWithdrawalState.CONFIRMED]: [CustodyWithdrawalState.REORGED],
  [CustodyWithdrawalState.FAILED]: [CustodyWithdrawalState.REORGED, CustodyWithdrawalState.CANCELLED],
  [CustodyWithdrawalState.REJECTED]: [],
  [CustodyWithdrawalState.CANCELLED]: [],
  [CustodyWithdrawalState.REORGED]: [CustodyWithdrawalState.CONFIRMING, CustodyWithdrawalState.FAILED],
};

export const TRANSACTION_VALID_TRANSITIONS: Record<CustodyTransactionState, CustodyTransactionState[]> = {
  [CustodyTransactionState.PENDING]: [CustodyTransactionState.SUBMITTED, CustodyTransactionState.FAILED],
  [CustodyTransactionState.SUBMITTED]: [CustodyTransactionState.OBSERVED, CustodyTransactionState.FAILED, CustodyTransactionState.DROPPED],
  [CustodyTransactionState.OBSERVED]: [CustodyTransactionState.CONFIRMING, CustodyTransactionState.FAILED, CustodyTransactionState.REPLACED],
  [CustodyTransactionState.CONFIRMING]: [CustodyTransactionState.CONFIRMED, CustodyTransactionState.FAILED, CustodyTransactionState.REORGED],
  [CustodyTransactionState.CONFIRMED]: [CustodyTransactionState.FINAL, CustodyTransactionState.REORGED],
  [CustodyTransactionState.FINAL]: [CustodyTransactionState.REORGED], // reorg can still happen after final in some chains
  [CustodyTransactionState.FAILED]: [],
  [CustodyTransactionState.DROPPED]: [CustodyTransactionState.PENDING], // retry allowed
  [CustodyTransactionState.REPLACED]: [CustodyTransactionState.OBSERVED, CustodyTransactionState.CONFIRMING],
  [CustodyTransactionState.REORGED]: [CustodyTransactionState.CONFIRMING, CustodyTransactionState.FAILED, CustodyTransactionState.OBSERVED],
};

export const INTERNAL_TRANSFER_VALID_TRANSITIONS: Record<CustodyInternalTransferState, CustodyInternalTransferState[]> = {
  [CustodyInternalTransferState.REQUESTED]: [CustodyInternalTransferState.APPROVED, CustodyInternalTransferState.CANCELLED],
  [CustodyInternalTransferState.APPROVED]: [CustodyInternalTransferState.SETTLING, CustodyInternalTransferState.CANCELLED],
  [CustodyInternalTransferState.SETTLING]: [CustodyInternalTransferState.SETTLED, CustodyInternalTransferState.FAILED],
  [CustodyInternalTransferState.SETTLED]: [],
  [CustodyInternalTransferState.FAILED]: [CustodyInternalTransferState.REQUESTED],
  [CustodyInternalTransferState.CANCELLED]: [],
};

export const SWEEP_VALID_TRANSITIONS: Record<CustodySweepState, CustodySweepState[]> = {
  [CustodySweepState.REQUESTED]: [CustodySweepState.APPROVED, CustodySweepState.CANCELLED],
  [CustodySweepState.APPROVED]: [CustodySweepState.SUBMITTING, CustodySweepState.SETTLING, CustodySweepState.CANCELLED],
  [CustodySweepState.SUBMITTING]: [CustodySweepState.CONFIRMING, CustodySweepState.SETTLING, CustodySweepState.FAILED],
  [CustodySweepState.SETTLING]: [CustodySweepState.SETTLED, CustodySweepState.FAILED, CustodySweepState.CONFIRMING],
  [CustodySweepState.CONFIRMING]: [CustodySweepState.SETTLED, CustodySweepState.FAILED],
  [CustodySweepState.SETTLED]: [],
  [CustodySweepState.FAILED]: [],
  [CustodySweepState.CANCELLED]: [],
};

export const RESERVE_VALID_TRANSITIONS: Record<CustodyReserveState, CustodyReserveState[]> = {
  [CustodyReserveState.ACTIVE]: [CustodyReserveState.INSUFFICIENT, CustodyReserveState.SUFFICIENT, CustodyReserveState.LOCKED, CustodyReserveState.PENDING],
  [CustodyReserveState.INSUFFICIENT]: [CustodyReserveState.SUFFICIENT, CustodyReserveState.ACTIVE, CustodyReserveState.LOCKED],
  [CustodyReserveState.SUFFICIENT]: [CustodyReserveState.INSUFFICIENT, CustodyReserveState.ACTIVE, CustodyReserveState.LOCKED],
  [CustodyReserveState.LOCKED]: [CustodyReserveState.ACTIVE, CustodyReserveState.SUFFICIENT],
  [CustodyReserveState.PENDING]: [CustodyReserveState.ACTIVE, CustodyReserveState.SUFFICIENT, CustodyReserveState.INSUFFICIENT],
};

export const CALCULATION_VERSION = 'custody-v1.0.0';
export const POLICY_VERSION_DEFAULT = 'custody-policy-v1.0.0';

export const DECIMAL_SCALE = 12;
export const SCALE_FACTOR = BigInt(10 ** DECIMAL_SCALE);

export function isValidDecimal(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

export function parseScaled(value: string): bigint {
  if (!isValidDecimal(value)) throw new Error(`Invalid decimal: ${value}`);
  const [intPart, fracPart = ''] = value.replace('-', '').split('.');
  const isNeg = value.startsWith('-');
  const paddedFrac = (fracPart + '0'.repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE);
  const scaled = BigInt(intPart) * SCALE_FACTOR + BigInt(paddedFrac || '0');
  return isNeg ? -scaled : scaled;
}

export function formatScaled(scaled: bigint): string {
  const isNeg = scaled < 0n;
  const abs = isNeg ? -scaled : scaled;
  const intPart = abs / SCALE_FACTOR;
  const fracPart = abs % SCALE_FACTOR;
  let fracStr = fracPart.toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '');
  const result = fracStr ? `${intPart.toString()}.${fracStr}` : intPart.toString();
  return isNeg ? `-${result}` : result;
}

export function add(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}

export function sub(a: string, b: string): string {
  return formatScaled(parseScaled(a) - parseScaled(b));
}

export function mul(a: string, b: string): string {
  return formatScaled((parseScaled(a) * parseScaled(b)) / SCALE_FACTOR);
}

export function cmp(a: string, b: string): number {
  const aS = parseScaled(a);
  const bS = parseScaled(b);
  if (aS < bS) return -1;
  if (aS > bS) return 1;
  return 0;
}

export function deterministicIdempotencyKey(params: {
  type: string;
  tenantId: string;
  walletId?: string;
  assetId?: string;
  networkId?: string;
  externalRef?: string;
  timestampBucket?: string;
}): string {
  const bucket = params.timestampBucket ?? new Date().toISOString().slice(0, 10);
  const raw = [params.type, params.tenantId, params.walletId ?? '', params.assetId ?? '', params.networkId ?? '', params.externalRef ?? '', bucket].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

// Secrets redaction — never expose seeds, private keys, signing secrets, custody API secrets, etc.
const SECRET_PATTERNS = [
  /private[_-]?key/i,
  /seed/i,
  /mnemonic/i,
  /secret/i,
  /password/i,
  /token/i,
  /api[_-]?key/i,
  /signing/i,
  /credential/i,
  /passphrase/i,
  /auth/i,
  /bearer/i,
  /wallet[_-]?secret/i,
  /provider[_-]?secret/i,
  /webhook[_-]?secret/i,
  /encryption[_-]?key/i,
];

export function redactSecrets<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (input.length > 20 && /[A-Za-z0-9+/=]{20,}/.test(input)) return '[REDACTED]' as unknown as T;
    return input;
  }
  if (Array.isArray(input)) return input.map((v) => redactSecrets(v)) as unknown as T;
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const isSecret = SECRET_PATTERNS.some((p) => p.test(k.toLowerCase()));
      result[k] = isSecret ? '[REDACTED]' : redactSecrets(v);
    }
    return result as unknown as T;
  }
  return input;
}

export interface AssetIdentity {
  assetId: string;
  assetSymbol: string;
  networkId: string;
  chainId?: string | null;
  contractAddress?: string | null;
  tokenStandard?: string | null;
  decimals: number;
}

export interface NetworkIdentity {
  networkId: string;
  chainId?: string | null;
  name: string;
  nativeAssetSymbol?: string | null;
}

export interface TransactionObservation {
  transactionHash: string;
  blockHash?: string | null;
  blockNumber?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  amount: string;
  assetId: string;
  networkId: string;
  confirmationCount: number;
  requiredConfirmationCount: number;
  status: CustodyTransactionState;
  fee?: string | null;
  feeAsset?: string | null;
  observedAt: string;
  providerReference?: string | null;
  rawProviderData?: any;
}

export interface BalanceObservation {
  assetId: string;
  assetSymbol: string;
  networkId: string;
  walletId: string;
  available: string;
  pendingIn?: string | null;
  pendingOut?: string | null;
  locked?: string | null;
  reserved?: string | null;
  total?: string | null;
  observationTimestamp: string;
  provider: string;
  sourceReference: string;
  dataCompleteness: string;
}

export interface FeeObservation {
  estimatedFee: string | null;
  actualFee: string | null;
  feeAsset: string;
  providerReference?: string | null;
  isActual: boolean;
}
