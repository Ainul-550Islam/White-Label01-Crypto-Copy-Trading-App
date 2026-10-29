// # Responsibility: observation-only custody provider for TRON over a configured TronGrid/full-node HTTP endpoint.
/**
 * TRON observation via the same ChainHttpClient chokepoint (allowlist,
 * timeout, cap, breaker). TronGrid endpoints used:
 *   - POST /wallet/getnowblock                -> chain tip (health + growth)
 *   - POST /wallet/gettransactionbyid         -> { txID, raw_data: {...} }
 *   - POST /wallet/gettransactioninfobyid     -> { fee, receipt, blockNumber }
 *   - POST /wallet/getaccount                 -> { balance } (TRX sun)
 *   - POST /wallet/triggerconstantcontract    -> TRC-20 balanceOf simulation
 *   - POST /v1/accounts/{address}/transactions -> account-scoped inbound list
 *
 * Capabilities: balances, transactions, receipts (TRON's "transaction info"),
 * address observation, confirmations. NO submission, no address generation.
 *
 * TRON quirks handled here:
 *   - TRON amounts are sun (1e-6 TRX); all arithmetic goes through
 *     chain-amount BigInt conversion;
 *   - addresses are base58check (34 chars, leading 'T') or hex (41-prefixed);
 *     conversion between them happens LOCALLY with the full base58check
 *     decode incl. double-SHA256 checksum verification - a wrong checksum
 *     refuses rather than simulating against fabricated bytes;
 *   - transaction info may lag the transaction itself (info-absent is
 *     reported as "not yet indexed" via ChainClientUnavailableError, never a
 *     fabricated zero-fee answer).
 */

import { createHash } from 'node:crypto';

import {
  BlockchainProvider,
  BlockchainProviderCapabilities,
  EstimateFeeParams,
  GetBalanceParams,
  GetTransactionParams,
  ObserveAddressParams,
} from '../blockchain-provider.interface';
import {
  BalanceObservation,
  CustodyTransactionState,
  FeeObservation,
  TransactionObservation,
} from '../custody.types';
import {
  ChainClientError,
  ChainClientProtocolError,
  ChainClientUnavailableError,
  ChainHttpClient,
} from './chain-http-client';
import { formatDecimalString, parseBaseUnit, sunToDecimalString } from './chain-amount';
import { ChainMetrics, ChainRpcResult } from './chain-metrics';
import { AssetResolver, ChainAssetIdentity } from './evm-json-rpc.provider';

export interface TronProviderConfig {
  readonly providerId: string;
  readonly providerName: string;
  readonly networkId: string;
  readonly endpointUrl: string;
  readonly client: ChainHttpClient;
  readonly resolveAsset: AssetResolver;
  readonly metrics?: ChainMetrics;
  readonly defaultRequiredConfirmations: number;
  /** Account transaction listing cap (TronGrid `limit`). */
  readonly addressObservationLimit?: number;
}

const TRON_BASE58_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TRON_HEX_ADDRESS_PATTERN = /^41[0-9a-fA-F]{40}$/;
const TRON_TX_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const TRON_ADDRESS_PREFIX = 0x41;

export class TronObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TronObservationError';
  }
}

export class TronGridProvider implements BlockchainProvider {
  readonly providerId: string;
  readonly providerName: string;
  private readonly networkId: string;
  private readonly endpointUrl: string;
  private readonly client: ChainHttpClient;
  private readonly resolveAsset: AssetResolver;
  private readonly metrics: ChainMetrics | undefined;
  private readonly defaultRequiredConfirmations: number;
  private readonly observationLimit: number;

  constructor(config: TronProviderConfig) {
    this.providerId = config.providerId;
    this.providerName = config.providerName;
    this.networkId = config.networkId;
    this.endpointUrl = config.endpointUrl.replace(/\/+$/, '');
    this.client = config.client;
    this.resolveAsset = config.resolveAsset;
    this.metrics = config.metrics;
    this.defaultRequiredConfirmations = config.defaultRequiredConfirmations;
    this.observationLimit = config.addressObservationLimit ?? 50;
  }

  getCapabilities(): Promise<BlockchainProviderCapabilities> {
    return Promise.resolve({
      canGetBalance: true,
      canObserveAddress: true,
      canSubmitTransaction: false,
      canGetTransaction: true,
      canGetReceipt: true,
      canGetBlock: true,
      canEstimateFee: true,
      canObserveConfirmations: true,
      canGenerateAddress: false,
      supportedNetworks: [this.networkId],
      supportedAssets: [],
    });
  }

  // ------------------------------------------------------------- getBalance
  async getBalance(params: GetBalanceParams): Promise<BalanceObservation> {
    const identity = await this.assetOrThrow(params.assetId, params.networkId);
    assertTronAddress(params.address, 'getBalance');

    let available: string;
    if (identity.isNative) {
      const account = await this.post<Record<string, unknown> | null>('/wallet/getaccount', {
        address: params.address,
        visible: false,
      });
      if (account && typeof account === 'object' && !Array.isArray(account)) {
        const balanceSun = account['balance'] ?? null;
        available = balanceSun === null ? '0.000000' : sunToDecimalString(String(balanceSun), identity.decimals);
      } else {
        // Account never activated on-chain: chain says zero, evidenced.
        available = '0.000000';
      }
    } else {
      available = await this.trc20BalanceOf(identity, params.address);
    }

    this.metrics?.recordObservation({ network: this.networkId, provider: this.providerId });
    return {
      assetId: params.assetId,
      assetSymbol: identity.symbol,
      networkId: params.networkId,
      walletId: params.walletId ?? 'external-observation',
      available,
      observationTimestamp: new Date().toISOString(),
      provider: this.providerId,
      sourceReference: `tron:${this.networkId}:${params.address.slice(0, 6)}…`,
      dataCompleteness: 'CHAIN_EVIDENCE',
    };
  }

  private async trc20BalanceOf(identity: ChainAssetIdentity, holder: string): Promise<string> {
    const response = await this.post<Record<string, unknown>>('/wallet/triggerconstantcontract', {
      owner_address: holder,
      contract_address: identity.contractAddress as string,
      function_selector: 'balanceOf(address)',
      parameter: tronAddressToHexParameter(holder),
      visible: true,
    });
    const constantResult = response?.['constant_result'];
    if (!Array.isArray(constantResult) || constantResult.length === 0) {
      throw new TronObservationError('triggerconstantcontract returned no constant_result for balanceOf');
    }
    return formatDecimalString(BigInt('0x' + String(constantResult[0])), identity.decimals);
  }

  // -------------------------------------------------------- getTransaction
  async getTransaction(params: GetTransactionParams): Promise<TransactionObservation | null> {
    assertTronHash(params.transactionHash, 'getTransaction');
    const tx = await this.post<Record<string, unknown> | null>('/wallet/gettransactionbyid', {
      value: params.transactionHash,
    });
    if (!tx || Object.keys(tx).length === 0) {
      return null;
    }
    if (typeof tx['Error'] === 'string') {
      throw new ChainClientProtocolError('gettransactionbyid answered an Error envelope');
    }
    return this.toTransactionObservation(params, tx);
  }

  async getTransactionReceipt(params: GetTransactionParams): Promise<{
    status: string;
    blockHash?: string | null;
    blockNumber?: string | null;
    gasUsed?: string | null;
    actualFee?: string | null;
  } | null> {
    assertTronHash(params.transactionHash, 'getTransactionReceipt');
    const info = await this.fetchInfo(params.transactionHash);
    if (!info) return null;
    const receiptEntry =
      info['receipt'] && typeof info['receipt'] === 'object' ? (info['receipt'] as Record<string, unknown>)['result'] : undefined;
    const blockNumber = typeof info['blockNumber'] === 'number' ? String(info['blockNumber']) : null;
    const feeSun = typeof info['fee'] === 'number' ? info['fee'] : null;
    return {
      status: receiptEntry === undefined ? 'success' : receiptEntry === 'SUCCESS' ? 'success' : 'failed',
      blockNumber,
      blockHash: null,
      gasUsed: feeSun !== null ? String(feeSun) : null,
      actualFee: feeSun !== null ? sunToDecimalString(String(feeSun), 6) : null,
    };
  }

  async getBlock(params: { networkId: string; blockHash?: string | null; blockNumber?: string | null }): Promise<{
    blockHash: string;
    blockNumber: string;
    timestamp: string;
    transactions: string[];
  } | null> {
    let body: Record<string, unknown>;
    if (params.blockNumber) {
      body = { id_or_num: params.blockNumber, detail: false };
    } else if (params.blockHash) {
      body = { id_or_num: params.blockHash, detail: false };
    } else {
      body = { detail: false };
    }
    const block = await this.post<Record<string, unknown> | null>('/wallet/getblock', body);
    if (!block || !block['blockID']) {
      return null;
    }
    const headerRaw = (block['block_header'] as Record<string, unknown> | undefined)?.['raw_data'] as
      | Record<string, unknown>
      | undefined;
    const number = headerRaw?.['number'];
    const timestamp = headerRaw?.['timestamp'];
    const txList = Array.isArray(block['transactions'])
      ? (block['transactions'] as Array<Record<string, unknown>>)
          .map((tx) => String(tx['txID'] ?? ''))
          .filter((t) => t.length > 0)
      : [];
    return {
      blockHash: String(block['blockID']),
      blockNumber: number !== undefined ? String(number) : '',
      timestamp: typeof timestamp === 'number' ? new Date(timestamp).toISOString() : new Date().toISOString(),
      transactions: txList,
    };
  }

  // --------------------------------------------------------------- observe
  async observeAddressTransactions(params: ObserveAddressParams): Promise<TransactionObservation[]> {
    assertTronAddress(params.address, 'observeAddressTransactions');
    const response = await this.post<Record<string, unknown>>(`/v1/accounts/${params.address}/transactions`, {
      limit: this.observationLimit,
    });
    const data = response?.['data'];
    if (!Array.isArray(data)) {
      throw new ChainClientProtocolError('TronGrid account transactions response missing data array');
    }
    const observations: TransactionObservation[] = [];
    for (const entry of data) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rawData = (entry as Record<string, unknown>)['raw_data'] as Record<string, unknown> | undefined;
      const contracts = rawData?.['contract'];
      if (!Array.isArray(contracts) || contracts.length === 0) continue;
      const contract = contracts[0] as Record<string, unknown>;
      const type = contract['type'];
      if (type !== 'TransferContract' && type !== 'TriggerSmartContract') {
        continue;
      }
      const value = (contract['parameter'] as Record<string, unknown> | undefined)?.['value'] as
        | Record<string, unknown>
        | undefined;
      const toAddress = value?.['to_address'] ?? value?.['contract_address'] ?? null;
      const hash = String((entry as Record<string, unknown>)['txID'] ?? '');
      if (!TRON_TX_HASH_PATTERN.test(hash)) continue;
      const amountRaw = value?.['amount'] ?? null;
      observations.push({
        transactionHash: hash,
        blockHash: null,
        blockNumber: null,
        fromAddress: typeof value?.['owner_address'] === 'string' ? String(value['owner_address']) : null,
        toAddress: typeof toAddress === 'string' ? toAddress : null,
        amount: amountRaw !== null ? sunToDecimalString(String(amountRaw), 6) : '0.000000',
        assetId: String((entry as Record<string, unknown>)['assetID'] ?? ''),
        networkId: this.networkId,
        confirmationCount: 0,
        requiredConfirmationCount: this.defaultRequiredConfirmations,
        status: CustodyTransactionState.OBSERVED,
        observedAt: new Date().toISOString(),
        providerReference: null,
        rawProviderData: { type },
      });
    }
    this.metrics?.recordObservation({ network: this.networkId, provider: this.providerId });
    return observations;
  }

  // -------------------------------------------------------- getConfirmations
  async getConfirmations(params: GetTransactionParams): Promise<{
    confirmationCount: number;
    blockNumber?: string | null;
    blockHash?: string | null;
    isFinal: boolean;
  }> {
    const obs = await this.getTransaction(params);
    if (!obs) {
      throw new TronObservationError(
        `transaction ${params.transactionHash.slice(0, 12)}… not observable on ${this.networkId}`,
      );
    }
    if (obs.blockNumber === null || obs.blockNumber === undefined || obs.blockNumber === '') {
      return { confirmationCount: 0, isFinal: false, blockNumber: null, blockHash: null };
    }
    const latest = await this.currentBlockNumber();
    const delta = latest - Number(obs.blockNumber) + 1;
    return {
      confirmationCount: delta > 0 ? delta : 0,
      blockNumber: obs.blockNumber,
      blockHash: obs.blockHash ?? null,
      isFinal: delta >= this.defaultRequiredConfirmations * 2,
    };
  }

  async estimateFee(params: EstimateFeeParams): Promise<FeeObservation> {
    // TRON TRX transfers are typically free for the first daily bytes; with
    // bandwidth exhausted the fee is 1000 sun/byte. Estimate the worst-case
    // 260-byte envelope: callers never under-fee reading this number.
    const identity = await this.assetOrThrow(params.assetId, params.networkId);
    const feeSun = 1000 * 260;
    return {
      estimatedFee: formatDecimalString(BigInt(feeSun), identity.decimals),
      actualFee: null,
      feeAsset: params.assetId,
      isActual: false,
    };
  }

  async isHealthy(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      await this.currentBlockNumber();
      return { healthy: true };
    } catch {
      return { healthy: false, reason: 'tron RPC endpoint unavailable or protocol violation' };
    }
  }

  // ------------------------------------------------------------------ core
  private async currentBlockNumber(): Promise<number> {
    const block = await this.post<Record<string, unknown>>('/wallet/getnowblock', {});
    const raw = (block?.['block_header'] as Record<string, unknown> | undefined)?.['raw_data'] as
      | Record<string, unknown>
      | undefined;
    const number = raw?.['number'];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
      throw new ChainClientProtocolError('getnowblock answer missing integer block number');
    }
    return number;
  }

  private async assetOrThrow(assetId: string, networkId: string): Promise<ChainAssetIdentity> {
    if (networkId !== this.networkId) {
      throw new TronObservationError(`provider ${this.providerId} observes ${this.networkId} only; refused ${networkId}`);
    }
    const identity = await this.resolveAsset(assetId, networkId);
    if (!identity) {
      throw new TronObservationError(`asset ${assetId} is not in the custody registry for ${networkId}`);
    }
    if (!identity.isNative) {
      const contract = identity.contractAddress;
      if (!contract || !(TRON_BASE58_PATTERN.test(contract) || TRON_HEX_ADDRESS_PATTERN.test(contract))) {
        throw new TronObservationError(
          `TRC-20 asset ${assetId} lacks a canonical contract address in the registry - observation refused (fail closed)`,
        );
      }
    }
    return identity;
  }

  private async fetchInfo(hash: string): Promise<Record<string, unknown> | null> {
    const info = await this.post<Record<string, unknown> | null>('/wallet/gettransactioninfobyid', { value: hash });
    if (!info || Object.keys(info).length === 0) {
      return null;
    }
    if (typeof info['Error'] === 'string') {
      // Not indexed yet: chain evidence of a mined-but-infoless transaction
      // shows up only through the tx lookup path.
      throw new ChainClientUnavailableError('transaction info not indexed yet');
    }
    return info;
  }

  private async toTransactionObservation(
    params: GetTransactionParams,
    tx: Record<string, unknown>,
  ): Promise<TransactionObservation> {
    const rawData = tx['raw_data'] as Record<string, unknown> | undefined;
    if (!rawData) {
      throw new ChainClientProtocolError('transaction raw_data missing');
    }
    const contracts = rawData['contract'];
    if (!Array.isArray(contracts) || contracts.length === 0) {
      throw new ChainClientProtocolError('transaction raw_data.contract empty');
    }
    const contract = contracts[0] as Record<string, unknown>;
    const value = (((contract['parameter'] as Record<string, unknown> | undefined)?.['value']) ?? {}) as Record<string, unknown>;
    const asset = params.assetId ? await this.resolveAsset(params.assetId, this.networkId) : null;
    const decimals = asset?.decimals ?? 6;
    const amountSun = value['amount'];
    const blockNumber = await this.lookupBlockNumber(params.transactionHash);

    return {
      transactionHash: params.transactionHash,
      blockHash: null,
      blockNumber: blockNumber !== null ? String(blockNumber) : null,
      fromAddress: typeof value['owner_address'] === 'string' ? String(value['owner_address']) : null,
      toAddress: typeof value['to_address'] === 'string' ? String(value['to_address']) : null,
      amount:
        amountSun !== undefined && amountSun !== null
          ? formatDecimalString(parseBaseUnit(String(amountSun), 'transaction amount'), decimals)
          : '0',
      assetId: params.assetId ?? 'TRX',
      networkId: this.networkId,
      confirmationCount: 0,
      requiredConfirmationCount: this.defaultRequiredConfirmations,
      status: blockNumber !== null ? CustodyTransactionState.CONFIRMING : CustodyTransactionState.SUBMITTED,
      observedAt: new Date().toISOString(),
      providerReference: null,
      rawProviderData: undefined,
    };
  }

  private async lookupBlockNumber(hash: string): Promise<number | null> {
    try {
      const info = await this.fetchInfo(hash);
      const blockNumber = info?.['blockNumber'];
      return typeof blockNumber === 'number' ? blockNumber : null;
    } catch (error) {
      if (error instanceof ChainClientUnavailableError) return null;
      throw error;
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const started = Date.now();
    let resultKind: ChainRpcResult = 'ok';
    try {
      const response = await this.client.postJson<T>(
        this.endpointUrl + path,
        body,
        `tron:${this.networkId}:${path}`,
      );
      return response.body;
    } catch (error) {
      if (error instanceof ChainClientError) {
        resultKind =
          error.code === 'CHAIN_UNAVAILABLE' ? 'transport_error' : error.code === 'CONFIG' ? 'config' : 'protocol_error';
      } else {
        resultKind = 'transport_error';
      }
      throw error;
    } finally {
      this.metrics?.recordRpc({
        network: this.networkId,
        provider: this.providerId,
        result: resultKind,
        latencySeconds: (Date.now() - started) / 1000,
      });
    }
  }
}

function assertTronAddress(address: string, operation: string): void {
  if (typeof address !== 'string' || !(TRON_BASE58_PATTERN.test(address) || TRON_HEX_ADDRESS_PATTERN.test(address))) {
    throw new TronObservationError(`${operation}: not a TRON address (base58check or 41-prefixed hex)`);
  }
}

function assertTronHash(hash: string, operation: string): void {
  if (typeof hash !== 'string' || !TRON_TX_HASH_PATTERN.test(hash)) {
    throw new TronObservationError(`${operation}: not a 32-byte transaction hash`);
  }
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Full base58check decode with checksum verification (double-SHA256).
 * TRON hex form = 0x41 || 20-byte account; base58check wraps that payload
 * with a 4-byte checksum. A wrong checksum = corrupted address: refuse.
 */
export function base58CheckDecodeTron(address: string): Buffer {
  let value = 0n;
  for (const ch of address) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new TronObservationError('TRON address: invalid base58 character');
    value = value * 58n + BigInt(idx);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let payload = Buffer.from(hex, 'hex');
  let leadingZeros = 0;
  for (const ch of address) {
    if (ch === '1') leadingZeros++;
    else break;
  }
  if (leadingZeros > 0) {
    payload = Buffer.concat([Buffer.alloc(leadingZeros), payload]);
  }
  if (payload.length !== 25) {
    throw new TronObservationError(
      `TRON address: decoded length ${payload.length} != 25 bytes (payload + checksum)`,
    );
  }
  const body = payload.subarray(0, 21);
  const checksum = payload.subarray(21);
  const first = createHash('sha256').update(body).digest();
  const second = createHash('sha256').update(first).digest();
  const expected = second.subarray(0, 4);
  if (!checksum.equals(expected) || body[0] !== TRON_ADDRESS_PREFIX) {
    throw new TronObservationError('TRON address: base58check checksum or network prefix mismatch');
  }
  return body;
}

function tronAddressToHexParameter(address: string): string {
  // balanceOf(address) ABI parameter: 32-byte word; the 21-byte TRON hex
  // address is right-aligned like an EVM address (strip the 0x41 prefix).
  if (TRON_HEX_ADDRESS_PATTERN.test(address)) {
    return address.slice(2).padStart(64, '0');
  }
  if (TRON_BASE58_PATTERN.test(address)) {
    const decoded = base58CheckDecodeTron(address);
    return decoded.subarray(1).toString('hex').padStart(64, '0');
  }
  throw new TronObservationError(
    'TRC-20 contract simulation requires a valid TRON address (base58check or 41-prefixed hex)',
  );
}

export const tronInternals = { tronAddressToHexParameter, base58CheckDecodeTron };
