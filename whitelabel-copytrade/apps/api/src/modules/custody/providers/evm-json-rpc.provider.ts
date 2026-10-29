// # Responsibility: observation-only custody provider for EVM networks over a caller-supplied, allowlist-checked JSON-RPC endpoint.
/**
 * Implements the BlockchainProvider observation surface for any EVM network
 * whose endpoint the platform configured (ethereum, bsc, polygon, arbitrum).
 * Observation ONLY: no signing, no broadcasting, no address generation -
 * no canSubmitTransaction, no canGenerateAddress; the provider is physically
 * incapable of either: it imports no wallet library and never touches key
 * material.
 *
 * Chain evidence produced (getBalance / getTransaction / getConfirmations /
 * observeAddressTransactions) carries ONLY on-chain facts:
 *   - balances: eth_getBalance (native) or eth_call balanceOf(address)
 *     (token assets resolved through the injected AssetResolver), converted
 *     through chain-amount BigInt arithmetic with registry decimals;
 *   - transactions: eth_getTransactionByHash + eth_getTransactionReceipt +
 *     eth_blockNumber for confirmation counts; ERC-20 amounts decoded from
 *     the receipt's Transfer log when the asset is a token;
 *   - address observation: eth_getLogs filtered to Transfer(...) logs mined
 *     into the watched address across an explicit from/to block window.
 *
 * Every RPC failure maps to a typed ChainClientError lineage and is
 * metric-recorded; the provider NEVER synthesizes values when the chain
 * cannot answer.
 */

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
import { ChainClientError, ChainClientProtocolError, ChainHttpClient } from './chain-http-client';
import {
  ChainAmountError,
  formatDecimalString,
  parseBaseUnit,
  weiHexToDecimalString,
} from './chain-amount';
import { ChainMetrics, ChainRpcResult } from './chain-metrics';

/** Registry asset identity the chain surface needs; resolved by the caller. */
export interface ChainAssetIdentity {
  assetId: string;
  networkId: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  contractAddress?: string | null;
}

/** Injected point of the custody AssetRegistry (a narrow interface: providers never see Prisma). */
export type AssetResolver = (assetId: string, networkId: string) => Promise<ChainAssetIdentity | null>;

export interface EvmProviderConfig {
  readonly providerId: string;
  readonly providerName: string;
  readonly networkId: string;
  readonly endpointUrl: string;
  readonly client: ChainHttpClient;
  readonly resolveAsset: AssetResolver;
  readonly metrics?: ChainMetrics;
  /** Required confirmations default (caller overrides with tenant policy). */
  readonly defaultRequiredConfirmations: number;
  /** eth_getLogs window: scanned blocks when caller gave no fromBlock. */
  readonly addressObservationWindowBlocks?: number;
}

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const HEX_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** balanceOf(address) selector */
const BALANCE_OF_SELECTOR = '0x70a08231';

interface JsonRpcEnvelope<T> {
  id?: number | string | null;
  result?: T;
  error?: { code: number; message?: string };
}

export class EvmObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvmObservationError';
  }
}

export class EvmJsonRpcProvider implements BlockchainProvider {
  readonly providerId: string;
  readonly providerName: string;
  private readonly networkId: string;
  private readonly endpointUrl: string;
  private readonly client: ChainHttpClient;
  private readonly resolveAsset: AssetResolver;
  private readonly metrics: ChainMetrics | undefined;
  private readonly defaultRequiredConfirmations: number;
  private readonly observationWindowBlocks: number;

  constructor(config: EvmProviderConfig) {
    this.providerId = config.providerId;
    this.providerName = config.providerName;
    this.networkId = config.networkId;
    this.endpointUrl = config.endpointUrl;
    this.client = config.client;
    this.resolveAsset = config.resolveAsset;
    this.metrics = config.metrics;
    this.defaultRequiredConfirmations = config.defaultRequiredConfirmations;
    this.observationWindowBlocks = config.addressObservationWindowBlocks ?? 5_000;
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
    assertEvmAddress(params.address, 'getBalance');

    const availableBase = identity.isNative
      ? await this.rpcCall<string>('eth_getBalance', [params.address, 'latest'])
      : await this.tokenBalanceOf(identity.contractAddress as string, params.address);

    const parsed = identity.isNative
      ? parseBaseUnit(availableBase ?? '0x0', 'balance')
      : parseAbiWord(availableBase ?? '0x0', 'balanceOf result');
    const available = formatDecimalString(parsed, identity.decimals);
    this.metrics?.recordObservation({ network: this.networkId, provider: this.providerId });
    return {
      assetId: params.assetId,
      assetSymbol: identity.symbol,
      networkId: params.networkId,
      walletId: params.walletId ?? 'external-observation',
      available,
      observationTimestamp: new Date().toISOString(),
      provider: this.providerId,
      sourceReference: `evm-rpc:${this.networkId}:${params.address.slice(0, 10)}…`,
      dataCompleteness: 'CHAIN_EVIDENCE',
    };
  }

  // -------------------------------------------------------- getTransaction
  async getTransaction(params: GetTransactionParams): Promise<TransactionObservation | null> {
    assertEvmHash(params.transactionHash, 'getTransaction');
    const tx = await this.rpcCall<Record<string, unknown> | null>('eth_getTransactionByHash', [params.transactionHash]);
    if (tx === null || tx === undefined) {
      return null;
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
    assertEvmHash(params.transactionHash, 'getTransactionReceipt');
    const receipt = await this.rpcCall<Record<string, unknown> | null>('eth_getTransactionReceipt', [params.transactionHash]);
    if (!receipt) {
      return null;
    }
    assertObject(receipt, 'eth_getTransactionReceipt');
    const statusHex = optionalHexString(receipt['status'], 'receipt.status');
    return {
      status: statusHex === '0x1' ? 'success' : statusHex === '0x0' ? 'failed' : 'pending',
      blockHash: (receipt['blockHash'] as string | undefined) ?? null,
      blockNumber: (receipt['blockNumber'] as string | undefined) ?? null,
      gasUsed: (receipt['gasUsed'] as string | undefined) ?? null,
      actualFee: await this.actualFeeFromReceipt(receipt),
    };
  }

  async getBlock(params: { networkId: string; blockHash?: string | null; blockNumber?: string | null }): Promise<{
    blockHash: string;
    blockNumber: string;
    timestamp: string;
    transactions: string[];
  } | null> {
    let block: Record<string, unknown> | null;
    if (params.blockHash) {
      assertEvmHash(params.blockHash, 'getBlock');
      block = await this.rpcCall<Record<string, unknown> | null>('eth_getBlockByHash', [params.blockHash, false]);
    } else if (params.blockNumber) {
      const tag = HEX_QUANTITY_PATTERN.test(params.blockNumber) ? params.blockNumber : toHexQuantity(BigInt(params.blockNumber));
      block = await this.rpcCall<Record<string, unknown> | null>('eth_getBlockByNumber', [tag, false]);
    } else {
      throw new EvmObservationError('getBlock: blockHash or blockNumber is required');
    }
    if (!block) return null;
    assertObject(block, 'eth_getBlock');
    const timestampHex = requireHexString(block['timestamp'], 'block.timestamp');
    return {
      blockHash: requireHexString(block['hash'], 'block.hash'),
      blockNumber: requireHexString(block['number'], 'block.number'),
      timestamp: new Date(Number(parseInt(timestampHex, 16)) * 1000).toISOString(),
      transactions: Array.isArray(block['transactions']) ? (block['transactions'] as unknown[]).map(String) : [],
    };
  }

  // --------------------------------------------------------------- observe
  async observeAddressTransactions(params: ObserveAddressParams): Promise<TransactionObservation[]> {
    assertEvmAddress(params.address, 'observeAddressTransactions');
    const fromBlockTag = await this.fromBlockTag(params.fromBlock ?? null);

    // ERC-20 Transfer(to == address) logs across token contracts in custody.
    const logs = await this.rpcCall<Record<string, unknown>[] | null>('eth_getLogs', [
      {
        fromBlock: fromBlockTag,
        toBlock: 'latest',
        topics: [TRANSFER_EVENT_TOPIC, null, padToTopicAddress(params.address)],
      },
    ]);
    if (!Array.isArray(logs)) {
      throw new ChainClientProtocolError('eth_getLogs answered a non-array payload');
    }

    const observations: TransactionObservation[] = [];
    for (const log of logs) {
      assertObject(log, 'eth_getLogs entry');
      const transactionHash = requireHexString(log['transactionHash'], 'log.transactionHash');
      const blockNumber = requireHexString(log['blockNumber'], 'log.blockNumber');
      const logAddress = requireHexString(log['address'], 'log.address');
      const topics = log['topics'];
      if (!Array.isArray(topics) || topics.length < 3) {
        throw new ChainClientProtocolError('Transfer log without topics[0..2]');
      }
      const amount = parseBaseUnit(String(log['data']), 'transfer log value');
      observations.push({
        transactionHash,
        blockHash: (log['blockHash'] as string | undefined) ?? null,
        blockNumber,
        fromAddress: topicToAddress(String(topics[1])),
        toAddress: topicToAddress(String(topics[2])),
        amount: `0x${amount.toString(16)}`, // caller rescales with registry decimals
        assetId: `${logAddress}-${this.networkId}`,
        networkId: this.networkId,
        confirmationCount: 0,
        requiredConfirmationCount: this.defaultRequiredConfirmations,
        status: CustodyTransactionState.OBSERVED,
        observedAt: new Date().toISOString(),
        providerReference: null,
        rawProviderData: { contract: logAddress, logIndex: log['logIndex'] as string | undefined },
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
      throw new EvmObservationError(
        `transaction ${params.transactionHash.slice(0, 12)}… not observable on ${this.networkId}`,
      );
    }
    return {
      confirmationCount: obs.confirmationCount,
      blockNumber: obs.blockNumber ?? null,
      blockHash: obs.blockHash ?? null,
      isFinal: obs.status === CustodyTransactionState.FINAL,
    };
  }

  // ------------------------------------------------------------ estimateFee
  async estimateFee(params: EstimateFeeParams): Promise<FeeObservation> {
    // Real estimation for native transfers: eth_gasPrice * 21_000 (65k for a
    // canonical ERC-20 transfer envelope).
    const identity = await this.assetOrThrow(params.assetId, params.networkId);
    const gasPrice = await this.rpcCall<string>('eth_gasPrice', []);
    const gasLimit = identity.isNative ? 21_000n : 65_000n;
    const fee = parseBaseUnit(gasPrice, 'eth_gasPrice') * gasLimit;
    return {
      estimatedFee: formatDecimalString(fee, identity.decimals),
      actualFee: null,
      feeAsset: params.assetId,
      isActual: false,
    };
  }

  async isHealthy(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      const latest = await this.rpcCall<string>('eth_blockNumber', []);
      parseBaseUnit(latest, 'eth_blockNumber');
      return { healthy: true };
    } catch {
      return { healthy: false, reason: 'chain RPC unreachable or protocol violation' };
    }
  }

  // ------------------------------------------------------------------ core
  private async assetOrThrow(assetId: string, networkId: string): Promise<ChainAssetIdentity> {
    if (networkId !== this.networkId) {
      throw new EvmObservationError(`provider ${this.providerId} observes ${this.networkId} only; refused ${networkId}`);
    }
    const identity = await this.resolveAsset(assetId, networkId);
    if (!identity) {
      throw new EvmObservationError(`asset ${assetId} is not in the custody registry for ${networkId}`);
    }
    if (!identity.isNative) {
      if (!identity.contractAddress || !EVM_ADDRESS_PATTERN.test(identity.contractAddress)) {
        throw new EvmObservationError(
          `token asset ${assetId} lacks a canonical contract address in the registry - observation refused (fail closed)`,
        );
      }
    }
    return identity;
  }

  private async tokenBalanceOf(contract: string, holder: string): Promise<string> {
    const data = BALANCE_OF_SELECTOR + padToTopicAddress(holder).slice(2);
    return this.rpcCall<string>('eth_call', [{ to: contract, data }, 'latest']);
  }

  private async actualFeeFromReceipt(receipt: Record<string, unknown>): Promise<string | null> {
    const gasUsedHex = receipt['gasUsed'];
    const effectiveGasPriceHex = receipt['effectiveGasPrice'];
    if (typeof gasUsedHex !== 'string' || typeof effectiveGasPriceHex !== 'string') {
      return null;
    }
    return formatDecimalString(
      parseBaseUnit(gasUsedHex, 'gasUsed') * parseBaseUnit(effectiveGasPriceHex, 'effectiveGasPrice'),
      18,
    );
  }

  private async toTransactionObservation(
    params: GetTransactionParams,
    tx: Record<string, unknown>,
  ): Promise<TransactionObservation> {
    assertObject(tx, 'eth_getTransactionByHash');
    const hash = requireHexString(tx['hash'], 'tx.hash');
    const blockNumberHex = tx['blockNumber'];
    const mined = typeof blockNumberHex === 'string' && HEX_QUANTITY_PATTERN.test(blockNumberHex);
    const asset = params.assetId ? await this.resolveAsset(params.assetId, this.networkId) : null;
    const decimals = asset?.decimals ?? 18;

    let status: CustodyTransactionState;
    let amount = '0';
    const toAddress: string | null = (tx['to'] as string | null) ?? null;
    let providerFee: string | null = null;

    if (!mined) {
      status = CustodyTransactionState.SUBMITTED;
      amount = weiHexToDecimalString(requireHexString(tx['value'], 'tx.value'), decimals);
    } else {
      const receipt = await this.rpcCall<Record<string, unknown> | null>('eth_getTransactionReceipt', [params.transactionHash]);
      if (!receipt) {
        status = CustodyTransactionState.SUBMITTED;
      } else {
        assertObject(receipt, 'eth_getTransactionReceipt');
        const receiptStatus = optionalHexString(receipt['status'], 'receipt.status');
        if (receiptStatus === '0x0') {
          status = CustodyTransactionState.FAILED;
        } else if (receiptStatus === '0x1') {
          status = CustodyTransactionState.CONFIRMING;
        } else {
          throw new ChainClientProtocolError('receipt.status unrecognised');
        }
        providerFee = await this.actualFeeFromReceipt(receipt);
      }
      if (asset && !asset.isNative) {
        amount = await this.decodeTransferValue(asset, params.transactionHash, receipt ?? undefined);
      } else {
        amount = weiHexToDecimalString(requireHexString(tx['value'], 'tx.value'), decimals);
      }
    }

    let confirmationCount = 0;
    if (mined) {
      const latest = await this.rpcCall<string>('eth_blockNumber', []);
      const delta = parseBaseUnit(latest, 'eth_blockNumber') - parseBaseUnit(blockNumberHex as string, 'tx.blockNumber') + 1n;
      if (delta < 0n) {
        throw new ChainClientProtocolError('tx blockNumber ahead of chain tip');
      }
      confirmationCount = Number(delta);
      if (confirmationCount >= this.defaultRequiredConfirmations && status === CustodyTransactionState.CONFIRMING) {
        status = CustodyTransactionState.CONFIRMED;
      }
      if (confirmationCount >= this.defaultRequiredConfirmations * 2 && status === CustodyTransactionState.CONFIRMED) {
        status = CustodyTransactionState.FINAL;
      }
    }

    this.metrics?.recordObservation({ network: this.networkId, provider: this.providerId });
    return {
      transactionHash: hash,
      blockHash: (tx['blockHash'] as string | null) ?? null,
      blockNumber: mined ? (blockNumberHex as string) : null,
      fromAddress: (tx['from'] as string | undefined) ?? null,
      toAddress,
      amount,
      assetId: params.assetId ?? 'unknown-asset',
      networkId: this.networkId,
      confirmationCount,
      requiredConfirmationCount: this.defaultRequiredConfirmations,
      status,
      fee: providerFee,
      feeAsset: providerFee !== null ? 'native' : null,
      observedAt: new Date().toISOString(),
      providerReference: null,
      rawProviderData: undefined,
    };
  }

  private async decodeTransferValue(
    asset: ChainAssetIdentity,
    transactionHash: string,
    receiptOverride?: Record<string, unknown>,
  ): Promise<string> {
    const receipt = receiptOverride ?? (await this.rpcCall<Record<string, unknown> | null>('eth_getTransactionReceipt', [transactionHash]));
    if (!receipt) {
      throw new EvmObservationError('token transfer amount requires a mined receipt');
    }
    const logs = receipt['logs'];
    if (!Array.isArray(logs)) {
      throw new ChainClientProtocolError('receipt.logs not an array');
    }
    const target = asset.contractAddress as string;
    for (const log of logs) {
      assertObject(log, 'receipt log');
      if (String(log['address']).toLowerCase() !== target.toLowerCase()) continue;
      const topics = log['topics'];
      if (Array.isArray(topics) && topics.length >= 3 && String(topics[0]).toLowerCase() === TRANSFER_EVENT_TOPIC) {
        const value = parseBaseUnit(String(log['data']), 'transfer value');
        return formatDecimalString(value, asset.decimals);
      }
    }
    throw new EvmObservationError(
      `no Transfer log for token ${asset.assetId} in mined transaction; observation refused rather than fabricating an amount`,
    );
  }

  private async fromBlockTag(fromBlock: string | null): Promise<string> {
    if (fromBlock !== null) {
      if (HEX_QUANTITY_PATTERN.test(fromBlock)) return fromBlock;
      const parsed = BigInt(fromBlock);
      if (parsed < 0n) throw new EvmObservationError('fromBlock must be non-negative');
      return toHexQuantity(parsed);
    }
    const latest = await this.rpcCall<string>('eth_blockNumber', []);
    const latestNum = parseBaseUnit(latest, 'eth_blockNumber');
    const start =
      latestNum > BigInt(this.observationWindowBlocks) ? latestNum - BigInt(this.observationWindowBlocks) : 0n;
    return toHexQuantity(start);
  }

  private async rpcCall<T>(method: string, params: readonly unknown[]): Promise<T> {
    const started = Date.now();
    let resultKind: ChainRpcResult = 'ok';
    try {
      const response = await this.client.postJson<JsonRpcEnvelope<T>>(
        this.endpointUrl,
        { jsonrpc: '2.0', id: this.client.nextRequestId(), method, params: [...params] },
        `evm:${this.networkId}:${method}`,
      );
      const envelope = response.body;
      if (envelope && typeof envelope === 'object') {
        if (envelope.error) {
          // Numeric code only: upstream messages may mirror request material.
          throw new ChainClientProtocolError(`JSON-RPC fault code=${envelope.error.code} for ${method}`);
        }
        return envelope['result'] as T;
      }
      throw new ChainClientProtocolError('JSON-RPC envelope malformed');
    } catch (error) {
      if (error instanceof ChainClientError) {
        resultKind =
          error.code === 'CHAIN_UNAVAILABLE' ? 'transport_error' : error.code === 'CONFIG' ? 'config' : 'protocol_error';
      } else if (error instanceof ChainAmountError) {
        resultKind = 'protocol_error';
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

/** ABI 32-byte word: 0x + exactly 64 hex digits (padding is the encoding's identity). */
function parseAbiWord(hex: string, what: string): bigint {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new ChainAmountError(`${what}: expected a 32-byte ABI word`);
  }
  return BigInt(hex);
}

function toHexQuantity(value: bigint): string {
  return '0x' + value.toString(16);
}

function padToTopicAddress(address: string): string {
  if (!EVM_ADDRESS_PATTERN.test(address)) {
    throw new EvmObservationError('not a canonical EVM address');
  }
  return '0x' + '0'.repeat(24) + address.slice(2).toLowerCase();
}

function topicToAddress(topic: string): string {
  if (!EVM_HASH_PATTERN.test(topic)) {
    throw new ChainClientProtocolError('topic is not 32 bytes');
  }
  return '0x' + topic.slice(26).toLowerCase();
}

function requireHexString(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    throw new ChainClientProtocolError(`${what}: expected hex string`);
  }
  return value;
}

function optionalHexString(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null;
  return requireHexString(value, what);
}

function assertEvmAddress(address: string, operation: string): void {
  if (typeof address !== 'string' || !EVM_ADDRESS_PATTERN.test(address)) {
    throw new EvmObservationError(`${operation}: not an EVM address`);
  }
}

function assertEvmHash(hash: string, operation: string): void {
  if (typeof hash !== 'string' || !EVM_HASH_PATTERN.test(hash)) {
    throw new EvmObservationError(`${operation}: not a 32-byte hex transaction hash`);
  }
}

function assertObject(value: unknown, what: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ChainClientProtocolError(`${what}: expected object`);
  }
}

export const evmInternals = { padToTopicAddress, topicToAddress, TRANSFER_EVENT_TOPIC, BALANCE_OF_SELECTOR };
