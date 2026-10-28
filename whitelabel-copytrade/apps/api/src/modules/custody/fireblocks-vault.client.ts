import { createHash, createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';

/**
 * A narrowly scoped Fireblocks vault client. It never signs or submits a
 * blockchain transaction and does not claim a balance/settlement capability.
 * Responses are validated as evidence by the caller before an address can be
 * shown to a customer. Raw HTTP responses, authentication tokens, and provider
 * error bodies must not escape this boundary.
 */
export class FireblocksUnavailable extends Error {
  constructor(readonly code: 'CONFIGURATION' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NOT_FOUND' | 'AMBIGUOUS' | 'NOT_FINAL') {
    super(`Custody provider ${code.toLowerCase().replace('_', ' ')}`);
    this.name = 'FireblocksUnavailable';
  }
}

export interface FireblocksAsset {
  id: string;
  type: string;
  nativeAsset: string | null;
  contractAddress: string | null;
  decimals: number | null;
}

export interface FireblocksVault {
  id: string;
  name: string;
  customerRefId: string | null;
}

export interface FireblocksAddress {
  assetId: string;
  address: string;
  tag: string | null;
  customerRefId: string | null;
}

/** Narrow, non-payload compliance evidence. Absence or bypass is not approval. */
export interface FireblocksScreeningEvidence {
  provider: string | null;
  status: string | null;
  verdict: string | null;
  risk: string | null;
  bypassReason: string | null;
  customerRefId: string | null;
}

export interface FireblocksComplianceEvidence {
  status: string | null;
  aml: FireblocksScreeningEvidence | null;
  amlList: FireblocksScreeningEvidence[];
  travelRule: FireblocksScreeningEvidence | null;
}

export interface FireblocksTransactionSearchHit {
  id: string;
  status: string;
}

export interface FireblocksEvmLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
}

/** A provider-supplied EVM receipt, not independent finality or a credit. */
export interface FireblocksEvmReceipt {
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
  transactionIndex: number;
  from: string;
  to: string | null;
  logs: FireblocksEvmLog[];
}

/** Authenticated single-destination transaction evidence, not a credit. */
export interface FireblocksFinalTransaction {
  id: string;
  assetId: string;
  destinationVaultId: string;
  destinationAddress: string;
  destinationTag: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceAddress: string | null;
  customerRefId: string | null;
  subStatus: string | null;
  compliance: FireblocksComplianceEvidence | null;
  transactionHash: string;
  netAmount: string;
  confirmationCount: number;
  blockHash: string;
  blockNumber: string;
  /** Fireblocks' index is not independently established as an EVM log index. */
  providerIndex: number | null;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const BASE_URLS = new Set([
  'https://api.fireblocks.io',
  'https://eu-api.fireblocks.io',
  'https://eu2-api.fireblocks.io',
  'https://sandbox-api.fireblocks.io',
]);
const MAX_BODY_BYTES = 1_500_000;
const MAX_PAGES = 20;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NUMERIC_ID = /^(?:0|[1-9][0-9]{0,30})$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVM_TX_HASH = /^0x[0-9a-f]{64}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new FireblocksUnavailable('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, max = 255): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new FireblocksUnavailable('INVALID_RESPONSE');
  }
  return value;
}

function optionalText(value: unknown, max = 255): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, max);
}

function screeningEvidence(value: unknown, statusField: 'screeningStatus' | 'status'): FireblocksScreeningEvidence | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  return {
    provider: optionalText(row.provider, 128),
    status: optionalText(row[statusField], 128),
    verdict: optionalText(row.verdict, 128),
    risk: optionalText(row.risk, 128),
    bypassReason: optionalText(row.bypassReason, 256),
    customerRefId: optionalText(row.customerRefId, 128),
  };
}

function complianceEvidence(value: unknown): FireblocksComplianceEvidence | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (row.amlList != null && (!Array.isArray(row.amlList) || row.amlList.length > 100)) {
    throw new FireblocksUnavailable('INVALID_RESPONSE');
  }
  const amlList = (row.amlList ?? []) as unknown[];
  return {
    status: optionalText(row.status, 128),
    aml: screeningEvidence(row.aml, 'screeningStatus'),
    amlList: amlList.map((entry) => {
      const parsed = screeningEvidence(entry, 'screeningStatus');
      if (!parsed) throw new FireblocksUnavailable('INVALID_RESPONSE');
      return parsed;
    }),
    travelRule: screeningEvidence(row.tr, 'status'),
  };
}

function assetIdentifier(value: string): string {
  if (!ID.test(value)) throw new FireblocksUnavailable('CONFIGURATION');
  return encodeURIComponent(value);
}

function vaultIdentifier(value: string): string {
  if (!NUMERIC_ID.test(value)) throw new FireblocksUnavailable('INVALID_RESPONSE');
  return value;
}

function parseVault(value: unknown): FireblocksVault {
  const row = record(value);
  return { id: vaultIdentifier(requiredText(row.id, 31)), name: requiredText(row.name, 128), customerRefId: optionalText(row.customerRefId) };
}

function parseAddress(value: unknown, assetId: string): FireblocksAddress {
  const row = record(value);
  const result = {
    assetId: requiredText(row.assetId, 128),
    address: requiredText(row.address, 512),
    tag: optionalText(row.tag),
    customerRefId: optionalText(row.customerRefId),
  };
  if (result.assetId !== assetId) throw new FireblocksUnavailable('INVALID_RESPONSE');
  return result;
}

/** Only a fixed Fireblocks origin is allowed; tenant input can never choose a host. */
export class FireblocksVaultClient {
  readonly credentialFingerprint: string;
  readonly baseUrl: string;
  private readonly key: KeyObject;

  constructor(
    private readonly apiKey: string,
    privateKeyPem: string,
    baseUrl: string,
    private readonly fetcher: FetchLike = globalThis.fetch,
  ) {
    if (!BASE_URLS.has(baseUrl) || typeof apiKey !== 'string' || !/^[A-Za-z0-9._-]{8,256}$/.test(apiKey) || typeof fetcher !== 'function') {
      throw new FireblocksUnavailable('CONFIGURATION');
    }
    try {
      this.key = createPrivateKey(privateKeyPem);
      if (this.key.asymmetricKeyType !== 'rsa' || (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
        throw new Error('not a sufficiently strong RSA key');
      }
    } catch {
      throw new FireblocksUnavailable('CONFIGURATION');
    }
    this.baseUrl = baseUrl;
    this.credentialFingerprint = createHash('sha256').update(`${baseUrl}\0${apiKey}`).digest('hex');
  }

  /** Production and sandbox addresses must never be confused. */
  get isSandbox(): boolean {
    return this.baseUrl === 'https://sandbox-api.fireblocks.io';
  }

  async listSupportedAssets(): Promise<FireblocksAsset[]> {
    const raw = await this.request('GET', '/v1/supported_assets');
    if (!Array.isArray(raw) || raw.length > 50_000) throw new FireblocksUnavailable('INVALID_RESPONSE');
    const seen = new Set<string>();
    return raw.map((value) => {
      const row = record(value);
      const id = requiredText(row.id, 128);
      if (!ID.test(id) || seen.has(id)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      seen.add(id);
      const decimals = row.decimals === undefined || row.decimals === null ? null : row.decimals;
      if (decimals !== null && (!Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 36)) {
        throw new FireblocksUnavailable('INVALID_RESPONSE');
      }
      return {
        id,
        type: requiredText(row.type, 80),
        nativeAsset: optionalText(row.nativeAsset, 128),
        contractAddress: optionalText(row.contractAddress),
        decimals: decimals as number | null,
      };
    });
  }

  async getVault(vaultId: string): Promise<FireblocksVault> {
    return parseVault(await this.request('GET', `/v1/vault/accounts/${vaultIdentifier(vaultId)}`));
  }

  /** Exhaust pagination and refuse repeated cursors or an unfinished listing. */
  async findVaultsByExactName(name: string): Promise<FireblocksVault[]> {
    if (!ID.test(name)) throw new FireblocksUnavailable('CONFIGURATION');
    const result: FireblocksVault[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ namePrefix: name, limit: '100' });
      if (after !== null) query.set('after', after);
      const raw = record(await this.request('GET', `/v1/vault/accounts_paged?${query.toString()}`));
      if (!Array.isArray(raw.accounts)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      for (const value of raw.accounts) {
        const vault = parseVault(value);
        if (vault.name === name) result.push(vault);
      }
      after = this.nextCursor(raw.paging);
      // Never follow provider URLs with credentials, and never treat a page
      // that advertises continuation (or a full page without a cursor) as complete.
      if (after === null && (raw.nextUrl || raw.accounts.length >= 100)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      if (after === null) return result;
      if (seen.has(after)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      seen.add(after);
    }
    throw new FireblocksUnavailable('INVALID_RESPONSE');
  }

  async createVault(name: string, customerRefId: string, idempotencyKey: string): Promise<FireblocksVault> {
    if (!ID.test(name) || !ID.test(customerRefId)) throw new FireblocksUnavailable('CONFIGURATION');
    const row = parseVault(await this.request('POST', '/v1/vault/accounts', {
      name, customerRefId, hiddenOnUI: false, autoFuel: false,
    }, idempotencyKey));
    if (row.name !== name || row.customerRefId !== customerRefId) throw new FireblocksUnavailable('INVALID_RESPONSE');
    return row;
  }

  /** Read the wallet, distinguishing a genuine provider 404 from unavailable evidence. */
  async getVaultAsset(vaultId: string, assetId: string): Promise<Record<string, unknown> | null> {
    try {
      return record(await this.request('GET', `/v1/vault/accounts/${vaultIdentifier(vaultId)}/${assetIdentifier(assetId)}`));
    } catch (error) {
      if (error instanceof FireblocksUnavailable && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  async createVaultAsset(vaultId: string, assetId: string, idempotencyKey: string): Promise<void> {
    record(await this.request('POST', `/v1/vault/accounts/${vaultIdentifier(vaultId)}/${assetIdentifier(assetId)}`, {}, idempotencyKey));
  }

  async listAddresses(vaultId: string, assetId: string): Promise<FireblocksAddress[]> {
    const result: FireblocksAddress[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: '100' });
      if (after !== null) query.set('after', after);
      const raw = record(await this.request('GET', `/v1/vault/accounts/${vaultIdentifier(vaultId)}/${assetIdentifier(assetId)}/addresses_paginated?${query.toString()}`));
      if (!Array.isArray(raw.addresses)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      for (const row of raw.addresses) result.push(parseAddress(row, assetId));
      after = this.nextCursor(raw.paging);
      if (after === null && (raw.nextUrl || raw.addresses.length >= 100)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      if (after === null) return result;
      if (seen.has(after)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      seen.add(after);
    }
    throw new FireblocksUnavailable('INVALID_RESPONSE');
  }

  /**
   * Discover provider transaction ids for one Ethereum hash and vault. The
   * caller still fetches each id independently and binds its full record to
   * the issued address; a search hit is not confirmation or a credit.
   */
  async findTransactionsByHash(input: {
    vaultId: string; assetId: string; transactionHash: string; afterMs: number; beforeMs: number;
  }): Promise<FireblocksTransactionSearchHit[]> {
    const vaultId = vaultIdentifier(input.vaultId);
    assetIdentifier(input.assetId);
    if (!EVM_TX_HASH.test(input.transactionHash) || !Number.isSafeInteger(input.afterMs) || !Number.isSafeInteger(input.beforeMs) ||
        input.afterMs < 0 || input.beforeMs <= input.afterMs || input.beforeMs > Date.now() + 300_000) {
      throw new FireblocksUnavailable('CONFIGURATION');
    }
    const hits: FireblocksTransactionSearchHit[] = [];
    const seenCursors = new Set<string>();
    const seenIds = new Set<string>();
    let next: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ destType: 'VAULT_ACCOUNT', destId: vaultId, assets: input.assetId,
        txHash: input.transactionHash, after: String(input.afterMs), before: String(input.beforeMs),
        orderBy: 'createdAt', sort: 'ASC', limit: '100' });
      if (next !== null) query.set('next', next);
      const paging: { next: string | null } = { next: null };
      const raw = await this.request('GET', `/v1/transactions?${query.toString()}`, undefined, undefined, paging);
      if (!Array.isArray(raw) || raw.length > 100) throw new FireblocksUnavailable('INVALID_RESPONSE');
      for (const item of raw) {
        const row = record(item);
        const id = requiredText(row.id, 36).toLowerCase();
        const status = requiredText(row.status, 64);
        const destination = record(row.destination);
        if (!UUID.test(id) || seenIds.has(id) || !/^[A-Z][A-Z0-9_]{1,63}$/.test(status) ||
            row.assetId !== input.assetId || destination.type !== 'VAULT_ACCOUNT' || destination.id !== vaultId ||
            typeof row.txHash !== 'string' || row.txHash.toLowerCase() !== input.transactionHash.toLowerCase()) {
          throw new FireblocksUnavailable('INVALID_RESPONSE');
        }
        seenIds.add(id);
        hits.push({ id, status });
      }
      next = paging.next;
      // A full page without a continuation cannot prove that the history was
      // exhausted. Never follow provider-supplied URLs, only opaque cursors.
      if (next === null && raw.length === 100) throw new FireblocksUnavailable('INVALID_RESPONSE');
      if (next === null) return hits;
      if (seenCursors.has(next)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      seenCursors.add(next);
    }
    throw new FireblocksUnavailable('INVALID_RESPONSE');
  }

  /** Read a successful Ethereum receipt and retain actual log indices. */
  async getEvmReceipt(baseAssetId: string, transactionHash: string): Promise<FireblocksEvmReceipt> {
    const asset = assetIdentifier(baseAssetId);
    if (!EVM_TX_HASH.test(transactionHash)) throw new FireblocksUnavailable('CONFIGURATION');
    const row = record(await this.request('GET', `/v1/contract_interactions/base_asset_id/${asset}/tx_hash/${transactionHash}/receipt`));
    if (row.status !== 1) throw new FireblocksUnavailable('NOT_FINAL');
    const hash = requiredText(row.transactionHash, 66);
    const blockHash = requiredText(row.blockHash, 66);
    const from = requiredText(row.from, 42);
    const to = optionalText(row.to, 42);
    if (!EVM_TX_HASH.test(hash) || hash.toLowerCase() !== transactionHash.toLowerCase() || !EVM_TX_HASH.test(blockHash) ||
        !EVM_ADDRESS.test(from) || (to !== null && !EVM_ADDRESS.test(to)) ||
        !Number.isSafeInteger(row.blockNumber) || (row.blockNumber as number) < 0 ||
        !Number.isSafeInteger(row.transactionIndex) || (row.transactionIndex as number) < 0 ||
        !Array.isArray(row.logs) || row.logs.length > 10_000) {
      throw new FireblocksUnavailable('INVALID_RESPONSE');
    }
    const logIndices = new Set<number>();
    const logs = row.logs.map((value): FireblocksEvmLog => {
      const log = record(value);
      const address = requiredText(log.address, 42);
      const data = requiredText(log.data, 65_538);
      if (!EVM_ADDRESS.test(address) || !/^0x(?:[0-9a-f]{2})*$/i.test(data) ||
          !Array.isArray(log.topics) || log.topics.length > 4 ||
          !log.topics.every((topic) => typeof topic === 'string' && EVM_TX_HASH.test(topic)) ||
          !Number.isSafeInteger(log.logIndex) || (log.logIndex as number) < 0 || logIndices.has(log.logIndex as number) ||
          log.removed !== false || log.blockNumber !== row.blockNumber || log.transactionIndex !== row.transactionIndex ||
          typeof log.transactionHash !== 'string' || log.transactionHash.toLowerCase() !== hash.toLowerCase() ||
          typeof log.blockHash !== 'string' || log.blockHash.toLowerCase() !== blockHash.toLowerCase()) {
        throw new FireblocksUnavailable('INVALID_RESPONSE');
      }
      logIndices.add(log.logIndex as number);
      return { address, topics: log.topics as string[], data, logIndex: log.logIndex as number };
    });
    return { transactionHash: hash, blockHash, blockNumber: String(row.blockNumber),
      transactionIndex: row.transactionIndex as number, from, to, logs };
  }

  /**
   * Fetch independently from Fireblocks; an operator-supplied id is only a
   * lookup key. Reject multi-destination/aggregate transactions because their
   * single amount/address fields cannot prove an individual customer's credit.
   * The consumer must still bind vault, asset, chain, address, ownership,
   * compliance, confirmation policy and accounting before recording funds.
   */
  async getFinalTransaction(transactionId: string): Promise<FireblocksFinalTransaction> {
    if (!UUID.test(transactionId)) {
      throw new FireblocksUnavailable('CONFIGURATION');
    }
    const row = record(await this.request('GET', `/v1/transactions/${transactionId}`));
    if (requiredText(row.id, 36).toLowerCase() !== transactionId.toLowerCase()) throw new FireblocksUnavailable('INVALID_RESPONSE');
    if (row.status !== 'COMPLETED') throw new FireblocksUnavailable('NOT_FINAL');
    if (row.operation !== 'TRANSFER' || (row.destinations != null && (!Array.isArray(row.destinations) || row.destinations.length !== 0))) {
      throw new FireblocksUnavailable('AMBIGUOUS');
    }
    const destination = record(row.destination), source = record(row.source), amountInfo = record(row.amountInfo), block = record(row.blockInfo);
    if (destination.type !== 'VAULT_ACCOUNT') throw new FireblocksUnavailable('INVALID_RESPONSE');
    const assetId = requiredText(row.assetId, 128);
    if (!ID.test(assetId)) throw new FireblocksUnavailable('INVALID_RESPONSE');
    const amount = requiredText(amountInfo.netAmount, 64);
    if (!/^(?:0|[1-9]\d{0,39})(?:\.\d{1,36})?$/.test(amount) || !/[1-9]/.test(amount)) {
      throw new FireblocksUnavailable('INVALID_RESPONSE');
    }
    const blockNumber = requiredText(block.blockHeight, 64);
    if (!/^\d{1,64}$/.test(blockNumber)) throw new FireblocksUnavailable('INVALID_RESPONSE');
    const confirmations = row.numOfConfirmations;
    if (!Number.isSafeInteger(confirmations) || (confirmations as number) <= 0 || (confirmations as number) > 2_147_483_647) {
      throw new FireblocksUnavailable('INVALID_RESPONSE');
    }
    const index = row.index == null ? null : row.index;
    if (index !== null && (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) > 2_147_483_647)) {
      throw new FireblocksUnavailable('INVALID_RESPONSE');
    }
    const txHash = requiredText(row.txHash, 255);
    const address = requiredText(row.destinationAddress, 512);
    const vaultId = vaultIdentifier(requiredText(destination.id, 31));
    if (row.networkRecords != null) {
      if (!Array.isArray(row.networkRecords) || row.networkRecords.length > 1) throw new FireblocksUnavailable('AMBIGUOUS');
      if (row.networkRecords.length === 1) {
        const network = record(row.networkRecords[0]);
        if (network.isDropped === true || network.status === 'DROPPED' || (network.txHash != null && network.txHash !== txHash) ||
            (network.assetId != null && network.assetId !== assetId) ||
            (network.destinationAddress != null && network.destinationAddress !== address) ||
            (network.netAmount != null && network.netAmount !== amount)) throw new FireblocksUnavailable('AMBIGUOUS');
      }
    }
    return {
      id: transactionId.toLowerCase(), assetId, destinationVaultId: vaultId, destinationAddress: address,
      destinationTag: optionalText(row.destinationTag), sourceType: requiredText(source.type, 80),
      sourceId: optionalText(source.id), sourceAddress: optionalText(row.sourceAddress, 512),
      customerRefId: optionalText(row.customerRefId, 128), subStatus: optionalText(row.subStatus, 128),
      compliance: complianceEvidence(row.complianceResults), transactionHash: txHash, netAmount: amount,
      confirmationCount: confirmations as number, blockHash: requiredText(block.blockHash, 255), blockNumber,
      providerIndex: index as number | null,
    };
  }

  private nextCursor(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const paging = record(value);
    const cursor = optionalText(paging.after, 1024);
    return cursor;
  }

  private async request(method: 'GET' | 'POST', uri: string, body?: Record<string, unknown>, idempotencyKey?: string,
    page?: { next: string | null }): Promise<unknown> {
    if (!uri.startsWith('/v1/') || uri.startsWith('//') || /[\r\n#]/.test(uri)) throw new FireblocksUnavailable('CONFIGURATION');
    if (method === 'POST' && (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey))) throw new FireblocksUnavailable('CONFIGURATION');
    const payload = method === 'POST' ? JSON.stringify(body ?? {}) : '';
    const now = Math.floor(Date.now() / 1000);
    const encodedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const encodedClaims = Buffer.from(JSON.stringify({
      uri, nonce: randomUUID(), iat: now, exp: now + 25, sub: this.apiKey,
      bodyHash: createHash('sha256').update(payload).digest('hex'),
    })).toString('base64url');
    const unsigned = `${encodedHeader}.${encodedClaims}`;
    const token = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), this.key).toString('base64url')}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8_000);
    timer.unref?.();
    try {
      const headers: Record<string, string> = { 'X-API-Key': this.apiKey, Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        headers['Idempotency-Key'] = idempotencyKey!;
      }
      const response = await this.fetcher(`${this.baseUrl}${uri}`, { method, headers, ...(method === 'POST' ? { body: payload } : {}), redirect: 'error', signal: abort.signal });
      if (response.status === 404) throw new FireblocksUnavailable('NOT_FOUND');
      if (!response.ok) throw new FireblocksUnavailable('UNAVAILABLE');
      if (page) page.next = optionalText(response.headers.get('next-page'), 2048);
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) throw new FireblocksUnavailable('INVALID_RESPONSE');
      if (!response.body) throw new FireblocksUnavailable('INVALID_RESPONSE');
      const reader = response.body.getReader();
      const pieces: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new FireblocksUnavailable('INVALID_RESPONSE');
        }
        pieces.push(part.value);
      }
      try {
        return JSON.parse(Buffer.concat(pieces.map((part) => Buffer.from(part))).toString('utf8')) as unknown;
      } catch {
        throw new FireblocksUnavailable('INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof FireblocksUnavailable) throw error;
      throw new FireblocksUnavailable('UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}
