// # Responsibility: typed admin console client for the custody controller and the withdrawal-destination audit controller.
//
// Every function here maps to exactly one route that exists in
// `apps/api/src/modules/custody/custody.controller.ts` or
// `apps/api/src/modules/custody/withdrawal-destination-admin.controller.ts` at
// this commit - same HTTP method, same path, same body keys the handler reads.
// Nothing is invented: a route that is not on those two controllers has no
// function here.
//
// Money never leaves this module as a number. Every amount, fee and balance is
// the decimal string the API returned; parsing happens only for presentation,
// and presentation lives in the shared `features/shared/money.ts` helper.
//
// Step-up: `POST custody/addresses`, `POST custody/deposit-addresses/get-or-create`
// and the three sweep mutations are decorated `@RequireStepUp(...)` on the
// controller. Those calls take a proof id issued by `requestStepUp` seconds
// earlier; the API consumes the proof, so the verification happens immediately
// before the mutation and is never cached.
import { assertStepUpProof } from './step-up-proof';
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

/** A page of rows exactly as the custody list routes return them. */
export interface CustodyPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export type CustodyWalletState =
  | 'PENDING'
  | 'ACTIVE'
  | 'RESTRICTED'
  | 'SUSPENDED'
  | 'CLOSURE_PENDING'
  | 'CLOSED';

export type CustodySweepState =
  | 'REQUESTED'
  | 'APPROVED'
  | 'SUBMITTING'
  | 'SETTLING'
  | 'CONFIRMING'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED';

export type CustodyReserveState = 'ACTIVE' | 'INSUFFICIENT' | 'SUFFICIENT' | 'LOCKED' | 'PENDING';

export type CustodyTransactionState =
  | 'PENDING'
  | 'SUBMITTED'
  | 'OBSERVED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'FINAL'
  | 'FAILED'
  | 'DROPPED'
  | 'REPLACED'
  | 'REORGED';

export type CustodyInternalTransferState =
  | 'REQUESTED'
  | 'APPROVED'
  | 'SETTLING'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED';

/** `GET custody/wallets` rows. Secret references are stripped server-side. */
export interface CustodyWallet {
  id: string;
  tenantId: string;
  clientProfileId: string | null;
  accountId: string | null;
  walletType: string;
  state: CustodyWalletState;
  scope: string;
  assetId: string | null;
  networkId: string | null;
  provider: string | null;
  providerReference: string | null;
  ownerId: string | null;
  ownerType: string | null;
  isActive: boolean;
  metadata: unknown;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET custody/addresses` rows. */
export interface CustodyAddress {
  id: string;
  tenantId: string;
  walletId: string;
  address: string;
  memo: string | null;
  status: string;
  assetId: string | null;
  networkId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET custody/transactions` and `GET custody/transactions/:id` rows. */
export interface CustodyTransaction {
  id: string;
  tenantId: string;
  walletId: string | null;
  assetId: string;
  networkId: string;
  direction: string;
  amount: string;
  transactionHash: string | null;
  blockHash: string | null;
  blockNumber: string | null;
  providerReference: string | null;
  status: CustodyTransactionState;
  confirmationCount: number;
  requiredConfirmationCount: number;
  estimatedFee: string | null;
  actualFee: string | null;
  feeAsset: string | null;
  feeReference: string | null;
  sourceWorkflowType: string | null;
  sourceWorkflowId: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET custody/sweeps` rows. */
export interface CustodySweep {
  id: string;
  tenantId: string;
  sourceWalletId: string;
  destinationWalletId: string;
  assetId: string;
  networkId: string;
  amount: string;
  state: CustodySweepState;
  providerReference: string | null;
  transactionId: string | null;
  operatorId: string | null;
  approvedBy: string | null;
  reason: string | null;
  estimatedFee: string | null;
  actualFee: string | null;
  requestedAt: string;
  approvedAt: string | null;
  updatedAt: string;
}

/** `GET custody/reserves` rows. */
export interface CustodyReserve {
  id: string;
  tenantId: string;
  walletId: string | null;
  assetId: string;
  networkId: string | null;
  reserveType: string;
  requiredAmount: string;
  availableAmount: string | null;
  reservedAmount: string | null;
  lockedAmount: string | null;
  state: CustodyReserveState;
  policyVersion: string | null;
  calculationVersion: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST custody/reserves/evaluate` result: sufficiency for one wallet/asset. */
export interface ReserveEvaluation {
  sufficient: boolean;
  requiredAmount: string;
  availableAmount: string | null;
  shortfall: string | null;
  state: CustodyReserveState;
  reasons: string[];
}

/** One provider balance reading. `available: null` means "not measured", never zero. */
export interface BalanceObservation {
  assetId: string;
  assetSymbol: string;
  networkId: string;
  walletId: string;
  available: string | null;
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

/** `GET custody/balances/treasury`. Completeness is part of the answer, not a footnote. */
export interface TreasuryBalance {
  totalAvailable: string | null;
  balances: BalanceObservation[];
  dataCompleteness: 'PROVIDER_DERIVED' | 'PARTIAL_UNKNOWN' | 'UNKNOWN_NO_WALLET';
}

/** `GET custody/confirmations/:transactionId`. */
export interface ConfirmationObservation {
  id: string;
  transactionId: string;
  state: string;
  confirmationCount: number;
  requiredConfirmationCount: number;
  blockHash: string | null;
  blockNumber: string | null;
  observedAt: string | null;
  providerReference: string | null;
}

/** `GET custody/fees/:transactionId` and `POST custody/fees/estimate`. */
export interface CustodyFee {
  estimatedFee: string | null;
  actualFee: string | null;
  feeAsset: string;
  providerReference?: string | null;
  isActual: boolean;
}

/** `GET custody/internal-transfers` rows. */
export interface CustodyInternalTransfer {
  id: string;
  tenantId: string;
  sourceWalletId: string;
  destinationWalletId: string;
  assetId: string;
  networkId: string;
  amount: string;
  state: CustodyInternalTransferState;
  reason: string | null;
  approvedBy: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET custody/reconciliation/findings` rows. */
export interface CustodyFinding {
  id: string;
  tenantId: string;
  reconciliationType: string;
  walletId: string | null;
  transactionId: string | null;
  depositId: string | null;
  withdrawalId: string | null;
  expected: unknown;
  actual: unknown;
  discrepancyType: string | null;
  discrepancyDetails: unknown;
  isCritical: boolean;
  isResolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
}

/** `POST custody/reconciliation/run`. Nulls mean "not measurable", not zero. */
export interface ReconciliationRunResult {
  runId: string | null;
  findingsCreated: number;
  walletsChecked: number;
  transactionsChecked: number;
  depositsChecked: number;
  unverifiable: number;
  startedAt: string;
  completedAt: string;
  dataCompleteness: 'PROVIDER_DERIVED' | 'PARTIAL_UNKNOWN' | 'UNKNOWN_NO_WALLET';
}

/** `GET custody/audits` rows. */
export interface CustodyAuditEntry {
  id: string;
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  correlationId: string | null;
  detail: unknown;
  createdAt: string;
}

/** `POST custody/audits/export`: the archive plus the digest that makes it checkable. */
export interface CustodyAuditExport {
  id: string;
  tenantId: string;
  format: string;
  recordCount: number;
  fileHash: string;
  fileContents: string;
  periodStart: string;
  periodEnd: string;
}

/** `GET custody/policy`. */
export interface CustodyPolicy {
  supportedAssets: string[];
  supportedNetworks: string[];
  confirmationRequirements: Record<string, number>;
  withdrawalLimits: {
    maxSingleWithdrawal?: string | null;
    maxDailyWithdrawal?: string | null;
    maxPendingWithdrawals: number;
  };
  reserveRequirements: {
    operationalReserveBps?: number | null;
    withdrawalReserveBps?: number | null;
    gasReserveAmount?: string | null;
  };
  addressAllowlisting: {
    requireAllowlist: boolean;
    cooldownHours?: number | null;
  };
}

/** `GET custody/assets`. */
export interface CustodyAsset {
  assetId: string;
  symbol: string;
  name?: string | null;
  decimals: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `GET custody/networks`. */
export interface CustodyNetwork {
  networkId: string;
  name?: string | null;
  assetId?: string | null;
  chainId?: string | null;
  status: string;
  confirmationPolicy: unknown;
  createdAt: string;
  updatedAt: string;
}

/** `GET custody/providers/health`. */
export interface ProviderHealth {
  providerId: string;
  providerName: string;
  healthy: boolean;
  reason?: string;
}

/** `POST custody/withdrawals/evaluate`: the policy verdict and its individual checks. */
export interface WithdrawalEligibility {
  eligible: boolean;
  blockingReasons: string[];
  checks: Array<{ check: string; passed: boolean; reason?: string }>;
}

/** `POST custody/withdrawals/submit`: the custody withdrawal row after submission. */
export interface CustodyWithdrawal {
  id: string;
  tenantId: string;
  accountId: string | null;
  walletId: string | null;
  assetId: string;
  networkId: string;
  amount: string;
  destinationAddress: string;
  state: string;
  operatorId: string | null;
  providerReference: string | null;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET admin/custody/destinations` rows (tenant-wide, read-only). */
export interface DestinationAuditView {
  id: string;
  tenantId: string;
  userId: string;
  network: string;
  address: string;
  label: string;
  status: string;
  activatesAt: string;
  revokedAt: string | null;
  createdAt: string;
  remainingCooldownMs: number;
  decisions: Array<{ at: string; decision: string; reason: string }>;
}

/* ------------------------------------------------------------------ inputs */

export interface ListQuery {
  page?: number;
  limit?: number;
}

export interface WalletListQuery extends ListQuery {
  clientProfileId?: string;
  accountId?: string;
  assetId?: string;
  networkId?: string;
  state?: string;
}

export interface AddressListQuery extends ListQuery {
  walletId?: string;
  assetId?: string;
  networkId?: string;
  status?: string;
  accountId?: string;
  clientProfileId?: string;
}

export interface TransactionListQuery extends ListQuery {
  walletId?: string;
  assetId?: string;
  networkId?: string;
  status?: string;
  direction?: string;
  sourceWorkflowId?: string;
}

export interface SweepListQuery extends ListQuery {
  sourceWalletId?: string;
  destinationWalletId?: string;
  assetId?: string;
  state?: string;
}

export interface ReserveListQuery extends ListQuery {
  walletId?: string;
  assetId?: string;
  networkId?: string;
  reserveType?: string;
  state?: string;
}

export interface TransferListQuery extends ListQuery {
  walletId?: string;
  state?: string;
}

export interface FindingListQuery extends ListQuery {
  walletId?: string;
  assetId?: string;
  networkId?: string;
  type?: string;
  resolved?: boolean;
}

export interface AuditListQuery extends ListQuery {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  correlationId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface BalanceQuery {
  assetId: string;
  networkId?: string;
}

export interface CreateWalletInput {
  assetId: string;
  networkId: string;
  clientProfileId?: string | null;
  accountId?: string | null;
  walletType?: string;
  scope?: string;
  provider?: string | null;
  ownerId?: string | null;
  ownerType?: string | null;
  operatorId?: string | null;
  correlationId?: string | null;
}

export interface TransitionWalletInput {
  walletId: string;
  toState: CustodyWalletState;
  operatorId: string;
  reason: string;
  correlationId?: string | null;
}

export interface CreateAddressInput {
  walletId: string;
  address: string;
  assetId: string;
  networkId: string;
  memo?: string | null;
  status?: string;
  label?: string | null;
  operatorId?: string | null;
}

export interface DepositAddressInput {
  walletId?: string | null;
  accountId?: string | null;
  clientProfileId?: string | null;
  assetId: string;
  networkId: string;
}

export interface ObserveDepositInput {
  walletId: string;
  assetId: string;
  networkId: string;
  amount: string;
  transactionHash: string;
  blockNumber?: string | null;
  providerReference?: string | null;
}

export interface DepositorConfirmationsInput {
  confirmationCount: number;
  blockHash?: string | null;
  blockNumber?: string | null;
  providerReference?: string | null;
}

export interface CreateTransactionInput {
  walletId: string;
  assetId: string;
  networkId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  amount: string;
  transactionHash?: string | null;
  sourceWorkflowType?: string | null;
  sourceWorkflowId?: string | null;
  providerReference?: string | null;
}

export interface TransitionTransactionInput {
  transactionId: string;
  toState: CustodyTransactionState;
  blockHash?: string | null;
  blockNumber?: string | null;
  confirmationCount?: number;
  actualFee?: string | null;
  failureReason?: string | null;
  operatorId?: string | null;
  correlationId?: string | null;
}

export interface EstimateFeeInput {
  assetId: string;
  networkId: string;
  amount: string;
  destinationAddress?: string;
  walletId?: string | null;
}

export interface CreateInternalTransferInput {
  sourceWalletId: string;
  destinationWalletId: string;
  assetId: string;
  networkId: string;
  amount: string;
  reason?: string | null;
  operatorId?: string | null;
}

export interface CreateReserveInput {
  assetId: string;
  reserveType: string;
  requiredAmount: string;
  walletId?: string | null;
  networkId?: string | null;
  availableAmount?: string | null;
  reservedAmount?: string | null;
  lockedAmount?: string | null;
  policyVersion?: string | null;
}

export interface CreateSweepInput {
  sourceWalletId: string;
  destinationWalletId: string;
  assetId: string;
  networkId: string;
  amount: string;
  reason: string;
  operatorId?: string | null;
  estimatedFee?: string | null;
}

export interface RunReconciliationInput {
  walletId?: string | null;
  assetId?: string | null;
  networkId?: string | null;
  observedAt?: string;
}

export interface ResolveFindingInput {
  findingId: string;
  reason: string;
  resolution: string;
  operatorId?: string | null;
}

export interface ExportAuditsInput {
  fromDate: string;
  toDate: string;
  format: 'JSON' | 'CSV';
}

export interface EvaluateWithdrawalInput {
  assetId: string;
  networkId: string;
  amount: string;
  destinationAddress: string;
  walletId?: string | null;
  accountId?: string | null;
  operatorId?: string | null;
}

export interface SubmitWithdrawalInput {
  custodyWithdrawalId: string;
  operatorId: string;
  correlationId?: string | null;
}

/** The three custody actions the API decorates with `@RequireStepUp`. */
export type CustodyStepUpAction = 'CUSTODY_ADDRESS_ISSUE' | 'CUSTODY_SWEEP' | 'PAYOUT_APPROVE';

export type StepUpMethod = 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE';

/* ---------------------------------------------------------------- helpers */

const API_BASE = '/v1/custody';

/** Drops undefined/empty search params so a blank filter is not sent as `=`. */
function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  const cleaned: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

/* ------------------------------------------------------------------ client */

export const custodyAdminApi = {
  /* wallets */
  createWallet: (input: CreateWalletInput, idempotencyKey: string) =>
    apiClient.post<CustodyWallet>(`${API_BASE}/wallets`, input, { idempotencyKey }),

  transitionWallet: (input: TransitionWalletInput, idempotencyKey: string) =>
    apiClient.post<CustodyWallet>(`${API_BASE}/wallets/transition`, input, { idempotencyKey }),

  listWallets: (query: WalletListQuery = {}) =>
    apiClient.get<CustodyPage<CustodyWallet>>(`${API_BASE}/wallets`, { searchParams: params({ ...query }) }),

  getWallet: (walletId: string) =>
    apiClient.get<CustodyWallet | null>(`${API_BASE}/wallets/${segment(walletId)}`),

  /* addresses */
  createAddress: (input: CreateAddressInput, idempotencyKey: string) =>
    apiClient.post<CustodyAddress>(`${API_BASE}/addresses`, input, { idempotencyKey }),

  listAddresses: (query: AddressListQuery = {}) =>
    apiClient.get<CustodyPage<CustodyAddress>>(`${API_BASE}/addresses`, { searchParams: params({ ...query }) }),

  getOrCreateDepositAddress: (input: DepositAddressInput, idempotencyKey: string) =>
    apiClient.post<CustodyAddress>(`${API_BASE}/deposit-addresses/get-or-create`, input, { idempotencyKey }),

  /* deposits */
  observeDeposit: (input: ObserveDepositInput, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/deposits/observe`, input, { idempotencyKey }),

  updateDepositConfirmations: (depositId: string, input: DepositorConfirmationsInput, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/deposits/${segment(depositId)}/confirmations`, input, { idempotencyKey }),

  handleDepositReorg: (depositId: string, input: { reason: string; providerReference?: string | null }, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/deposits/${segment(depositId)}/reorg`, input, { idempotencyKey }),

  /* withdrawals */
  // An evaluation changes nothing, but it is a POST the operator may retry after a timeout: the key
  // keeps the retry the same request instead of a second evaluation against a moved balance.
  evaluateWithdrawal: (input: EvaluateWithdrawalInput, idempotencyKey: string) =>
    apiClient.post<WithdrawalEligibility>(`${API_BASE}/withdrawals/evaluate`, input, { idempotencyKey }),

  submitWithdrawal: (input: SubmitWithdrawalInput, idempotencyKey: string) =>
    apiClient.post<CustodyWithdrawal>(`${API_BASE}/withdrawals/submit`, input, { idempotencyKey }),

  finalizeWithdrawalSettlement: (input: { custodyWithdrawalId: string; operatorId: string; correlationId?: string | null }, idempotencyKey: string) =>
    apiClient.post<CustodyWithdrawal>(`${API_BASE}/settlement/withdrawal/finalize`, input, { idempotencyKey }),

  finalizeDepositSettlement: (input: { depositId: string; operatorId: string; correlationId?: string | null }, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/settlement/deposit/finalize`, input, { idempotencyKey }),

  /* transactions */
  createTransaction: (input: CreateTransactionInput, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/transactions`, input, { idempotencyKey }),

  transitionTransaction: (input: TransitionTransactionInput, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/transactions/transition`, input, { idempotencyKey }),

  listTransactions: (query: TransactionListQuery = {}) =>
    apiClient.get<CustodyPage<CustodyTransaction>>(`${API_BASE}/transactions`, { searchParams: params({ ...query }) }),

  getTransaction: (transactionId: string) =>
    apiClient.get<CustodyTransaction | null>(`${API_BASE}/transactions/${segment(transactionId)}`),

  pollTransaction: (transactionId: string, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/transactions/${segment(transactionId)}/poll`, undefined, { idempotencyKey }),

  handleTransactionReorg: (
    transactionId: string,
    input: { reason: string; newBlockHash?: string | null; newBlockNumber?: string | null },
    idempotencyKey: string,
  ) => apiClient.post<CustodyTransaction>(`${API_BASE}/transactions/${segment(transactionId)}/reorg`, input, { idempotencyKey }),

  /* confirmations & fees */
  observeConfirmation: (input: { transactionId: string; confirmationCount: number; blockHash?: string | null; blockNumber?: string | null; providerReference?: string | null }, idempotencyKey: string) =>
    apiClient.post<ConfirmationObservation>(`${API_BASE}/confirmations/observe`, input, { idempotencyKey }),

  getConfirmations: (transactionId: string) =>
    apiClient.get<ConfirmationObservation[]>(`${API_BASE}/confirmations/${segment(transactionId)}`),

  estimateFee: (input: EstimateFeeInput, idempotencyKey: string) =>
    apiClient.post<CustodyFee>(`${API_BASE}/fees/estimate`, input, { idempotencyKey }),

  getActualFee: (transactionId: string) =>
    apiClient.get<CustodyFee>(`${API_BASE}/fees/${segment(transactionId)}`),

  /* internal transfers */
  createInternalTransfer: (input: CreateInternalTransferInput, idempotencyKey: string) =>
    apiClient.post<CustodyInternalTransfer>(`${API_BASE}/internal-transfers`, input, { idempotencyKey }),

  approveInternalTransfer: (input: { transferId: string; approverId: string; reason?: string | null }, idempotencyKey: string) =>
    apiClient.post<CustodyInternalTransfer>(`${API_BASE}/internal-transfers/approve`, input, { idempotencyKey }),

  settleInternalTransfer: (input: { transferId: string; operatorId: string; providerReference?: string | null }, idempotencyKey: string) =>
    apiClient.post<CustodyInternalTransfer>(`${API_BASE}/internal-transfers/settle`, input, { idempotencyKey }),

  listInternalTransfers: (query: TransferListQuery = {}) =>
    apiClient.get<CustodyPage<CustodyInternalTransfer>>(`${API_BASE}/internal-transfers`, { searchParams: params({ ...query }) }),

  /* balances */
  getWalletBalance: (walletId: string, query: BalanceQuery) =>
    apiClient.get<BalanceObservation>(`${API_BASE}/balances/wallet/${segment(walletId)}`, { searchParams: params({ ...query }) }),

  getTreasuryBalance: (query: BalanceQuery) =>
    apiClient.get<TreasuryBalance>(`${API_BASE}/balances/treasury`, { searchParams: params({ ...query }) }),

  /* reserves */
  createReserve: (input: CreateReserveInput, idempotencyKey: string) =>
    apiClient.post<CustodyReserve>(`${API_BASE}/reserves`, input, { idempotencyKey }),

  listReserves: (query: ReserveListQuery = {}) =>
    apiClient.get<CustodyPage<CustodyReserve>>(`${API_BASE}/reserves`, { searchParams: params({ ...query }) }),

  evaluateReserve: (input: { walletId?: string | null; assetId: string; networkId?: string | null; requiredAmount: string }, idempotencyKey: string) =>
    apiClient.post<ReserveEvaluation>(`${API_BASE}/reserves/evaluate`, input, { idempotencyKey }),

  /* sweeps */
  createSweep: (input: CreateSweepInput, idempotencyKey: string) =>
    apiClient.post<CustodySweep>(`${API_BASE}/sweeps`, input, { idempotencyKey }),

  approveSweep: (input: { sweepId: string; approverId: string; reason?: string | null }, idempotencyKey: string) =>
    apiClient.post<CustodySweep>(`${API_BASE}/sweeps/approve`, input, { idempotencyKey }),

  executeSweep: (input: { sweepId: string; operatorId: string }, idempotencyKey: string) =>
    apiClient.post<CustodySweep>(`${API_BASE}/sweeps/execute`, input, { idempotencyKey }),

  listSweeps: (query: SweepListQuery = {}) =>
    apiClient.get<CustodyPage<CustodySweep>>(`${API_BASE}/sweeps`, { searchParams: params({ ...query }) }),

  /* reconciliation */
  runReconciliation: (input: RunReconciliationInput, idempotencyKey: string) =>
    apiClient.post<ReconciliationRunResult>(`${API_BASE}/reconciliation/run`, input, { idempotencyKey }),

  listFindings: (query: FindingListQuery = {}) =>
    apiClient.get<CustodyPage<CustodyFinding>>(`${API_BASE}/reconciliation/findings`, { searchParams: params({ ...query }) }),

  resolveFinding: (input: ResolveFindingInput, idempotencyKey: string) =>
    apiClient.post<CustodyFinding>(`${API_BASE}/reconciliation/resolve`, input, { idempotencyKey }),

  /* audit */
  listAudits: (query: AuditListQuery = {}) =>
    apiClient.get<CustodyPage<CustodyAuditEntry>>(`${API_BASE}/audits`, { searchParams: params({ ...query }) }),

  exportAudits: (input: ExportAuditsInput, idempotencyKey: string) =>
    apiClient.post<CustodyAuditExport>(`${API_BASE}/audits/export`, input, { idempotencyKey }),

  /* policy and registries */
  getPolicy: (query: { walletId?: string; accountId?: string } = {}) =>
    apiClient.get<CustodyPolicy>(`${API_BASE}/policy`, { searchParams: params({ ...query }) }),

  listAssets: (query: ListQuery & { isActive?: boolean } = {}) =>
    apiClient.get<CustodyPage<CustodyAsset>>(`${API_BASE}/assets`, { searchParams: params({ ...query }) }),

  listNetworks: (query: ListQuery & { status?: string } = {}) =>
    apiClient.get<CustodyPage<CustodyNetwork>>(`${API_BASE}/networks`, { searchParams: params({ ...query }) }),

  getProvidersHealth: () => apiClient.get<ProviderHealth[]>(`${API_BASE}/providers/health`),

  /* withdrawal destinations (operator read-only audit surface) */
  listDestinations: (query: { limit?: number } = {}) =>
    apiClient.get<{ data: DestinationAuditView[]; total: number }>('/v1/admin/custody/destinations', { searchParams: params({ ...query }) }),

  /**
   * Mints a single-use proof for one custody action. The API consumes the proof
   * on the mutation that follows, so the caller must verify immediately before
   * calling it - never at the start of a form.
   */
  requestStepUp: async (action: CustodyStepUpAction, method: StepUpMethod, value: string, idempotencyKey: string) => {
    const payload =
      method === 'TOTP'
        ? { action, method, code: value }
        : method === 'PASSWORD'
          ? { action, method, password: value }
          : { action, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, action, method);
  },
};
