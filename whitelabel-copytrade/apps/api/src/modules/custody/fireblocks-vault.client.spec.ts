import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import { FireblocksUnavailable, FireblocksVaultClient } from './fireblocks-vault.client';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const apiKey = 'api-key-for-tests';
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function client(fetcher: FetchLike, baseUrl = 'https://api.fireblocks.io'): FireblocksVaultClient {
  return new FireblocksVaultClient(apiKey, pem, baseUrl, fetcher);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('Fireblocks authenticated vault transport', () => {
  it('signs the exact URI, payload hash, unique nonce and short-lived RS256 claims', async () => {
    const fetcher = jest.fn<FetchLike>().mockImplementation(async () => json({ id: '17', name: 'vault-name', customerRefId: 'client-id' }));
    const transport = client(fetcher);
    await transport.createVault('vault-name', 'client-id', 'stable-key');
    await transport.createVault('vault-name', 'client-id', 'stable-key');
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.fireblocks.io/v1/vault/accounts');
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    const headers = options.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe(apiKey);
    expect(headers['Idempotency-Key']).toBe('stable-key');
    const [head, payload, signature] = headers.Authorization!.replace('Bearer ', '').split('.') as [string, string, string];
    expect(verify('RSA-SHA256', Buffer.from(`${head}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.uri).toBe('/v1/vault/accounts');
    expect(claims.sub).toBe(apiKey);
    expect(claims.exp - claims.iat).toBe(25);
    expect(claims.bodyHash).toBe(createHash('sha256').update(options.body as string).digest('hex'));
    const next = ((fetcher.mock.calls[1]![1].headers as Record<string, string>).Authorization!).split('.')[1]!;
    expect(JSON.parse(Buffer.from(next, 'base64url').toString()).nonce).not.toBe(claims.nonce);
  });

  it('signs pagination query strings and exhausts vault pages without accepting prefix matches', async () => {
    const fetcher = jest.fn<FetchLike>()
      .mockResolvedValueOnce(json({ accounts: [{ id: '1', name: 'target-other', customerRefId: 'owner' }], paging: { after: 'next+cursor' } }))
      .mockResolvedValueOnce(json({ accounts: [{ id: '2', name: 'target', customerRefId: 'owner' }], paging: {} }));
    await expect(client(fetcher).findVaultsByExactName('target')).resolves.toEqual([{ id: '2', name: 'target', customerRefId: 'owner' }]);
    const [url, init] = fetcher.mock.calls[1]!;
    const claims = JSON.parse(Buffer.from((init.headers as Record<string, string>).Authorization!.split('.')[1]!, 'base64url').toString());
    expect(claims.uri).toBe(new URL(url).pathname + new URL(url).search);
    expect(new URL(url).searchParams.get('after')).toBe('next+cursor');
    expect(claims.bodyHash).toBe(createHash('sha256').update('').digest('hex'));
  });

  it('rejects loops and malformed pages instead of treating them as a complete listing', async () => {
    const loop = jest.fn<FetchLike>().mockImplementation(async () => json({ accounts: [], paging: { after: 'again' } }));
    await expect(client(loop).findVaultsByExactName('target')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const malformed = jest.fn<FetchLike>().mockResolvedValue(json({ accounts: null, paging: {} }));
    await expect(client(malformed).findVaultsByExactName('target')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('refuses advertised or potentially truncated pages without a continuation cursor', async () => {
    const advertised = jest.fn<FetchLike>().mockResolvedValue(json({ accounts: [], paging: {}, nextUrl: 'https://elsewhere.test/next' }));
    await expect(client(advertised).findVaultsByExactName('target')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const fullPage = jest.fn<FetchLike>().mockResolvedValue(json({ addresses: Array.from({ length: 100 }, (_, i) => ({ assetId: 'ETH', address: `address-${i}` })), paging: {} }));
    await expect(client(fullPage).listAddresses('1', 'ETH')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('fails closed if 20 pages are insufficient', async () => {
    let page = 0;
    const fetcher = jest.fn<FetchLike>().mockImplementation(async () => json({ accounts: [], paging: { after: `p${++page}` } }));
    await expect(client(fetcher).findVaultsByExactName('target')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(20);
  });

  it('validates all address pages and never strips a required destination tag', async () => {
    const fetcher = jest.fn<FetchLike>()
      .mockResolvedValueOnce(json({ addresses: [{ assetId: 'ETH', address: '0xabc', tag: 'memo' }], paging: { after: 'b' } }))
      .mockResolvedValueOnce(json({ addresses: [{ assetId: 'ETH', address: '0xdef', tag: '' }], paging: {} }));
    await expect(client(fetcher).listAddresses('123', 'ETH')).resolves.toEqual([
      { assetId: 'ETH', address: '0xabc', tag: 'memo', customerRefId: null },
      { assetId: 'ETH', address: '0xdef', tag: null, customerRefId: null },
    ]);
    const mismatched = jest.fn<FetchLike>().mockResolvedValue(json({ addresses: [{ assetId: 'OTHER', address: '0xabc' }], paging: {} }));
    await expect(client(mismatched).listAddresses('123', 'ETH')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('checks response identity and validates the authoritative supported-asset list', async () => {
    const fetcher = jest.fn<FetchLike>().mockResolvedValue(json([{ id: 'ETH', type: 'BASE_ASSET', decimals: 18 },
      { id: 'USDT_ETH', type: 'ERC20', nativeAsset: 'ETH', contractAddress: '0x123', decimals: 6 }]));
    await expect(client(fetcher).listSupportedAssets()).resolves.toEqual([
      { id: 'ETH', type: 'BASE_ASSET', nativeAsset: null, contractAddress: null, decimals: 18 },
      { id: 'USDT_ETH', type: 'ERC20', nativeAsset: 'ETH', contractAddress: '0x123', decimals: 6 },
    ]);
    const duplicate = jest.fn<FetchLike>().mockResolvedValue(json([{ id: 'ETH', type: 'BASE_ASSET' }, { id: 'ETH', type: 'BASE_ASSET' }]));
    await expect(client(duplicate).listSupportedAssets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const wrong = jest.fn<FetchLike>().mockResolvedValue(json({ id: '17', name: 'other', customerRefId: 'owner' }));
    await expect(client(wrong).createVault('target', 'owner', 'key')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('distinguishes a provider 404 from provider/network failures without exposing response text', async () => {
    const notFound = jest.fn<FetchLike>().mockResolvedValue(json({ message: 'private' }, 404));
    await expect(client(notFound).getVaultAsset('10', 'ETH')).resolves.toBeNull();
    const failed = jest.fn<FetchLike>().mockResolvedValue(json({ message: 'secret response data' }, 500));
    await expect(client(failed).getVaultAsset('10', 'ETH')).rejects.toThrow('Custody provider unavailable');
    const crash = jest.fn<FetchLike>().mockRejectedValue(new Error('secret transport data'));
    await expect(client(crash).getVault('10')).rejects.toThrow('Custody provider unavailable');
  });

  it('rejects untrusted origins, weak keys, path injection and oversized idempotency keys before any request', async () => {
    const fetcher = jest.fn<FetchLike>();
    expect(() => client(fetcher, 'http://127.0.0.1')).toThrow(FireblocksUnavailable);
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => new FireblocksVaultClient(apiKey, weak, 'https://api.fireblocks.io', fetcher)).toThrow(FireblocksUnavailable);
    await expect(client(fetcher).getVault('10/../other')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(client(fetcher).createVaultAsset('10', 'ETH', 'x'.repeat(41))).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  describe('authenticated transaction evidence', () => {
    const id = '01a617c3-f9a7-432b-954d-1860c8e881b4';
    const completed = () => ({
      id, status: 'COMPLETED', operation: 'TRANSFER', assetId: 'USDT_ETH', txHash: '0xtransaction',
      source: { type: 'UNKNOWN' }, destination: { type: 'VAULT_ACCOUNT', id: '123' },
      destinationAddress: '0xaddress', destinationTag: '', amountInfo: { netAmount: '0.000001' },
      numOfConfirmations: 42, blockInfo: { blockHeight: '20830000', blockHash: '0xblock' }, index: 2,
    });

    it('returns exact single-transaction strings only after authenticated identity validation', async () => {
      const fetcher = jest.fn<FetchLike>().mockResolvedValue(json(completed()));
      await expect(client(fetcher).getFinalTransaction(id)).resolves.toEqual({
        id, assetId: 'USDT_ETH', destinationVaultId: '123', destinationAddress: '0xaddress', destinationTag: null,
        sourceType: 'UNKNOWN', sourceId: null, sourceAddress: null, customerRefId: null, subStatus: null, compliance: null,
        transactionHash: '0xtransaction', netAmount: '0.000001',
        confirmationCount: 42, blockHash: '0xblock', blockNumber: '20830000', providerIndex: 2,
      });
      const [url, options] = fetcher.mock.calls[0]!;
      expect(url).toBe(`https://api.fireblocks.io/v1/transactions/${id}`);
      expect(options.method).toBe('GET');
      const claims = JSON.parse(Buffer.from((options.headers as Record<string, string>).Authorization!.split('.')[1]!, 'base64url').toString());
      expect(claims.uri).toBe(`/v1/transactions/${id}`);
      expect(claims.bodyHash).toBe(createHash('sha256').update('').digest('hex'));
    });

    it.each(['PENDING', 'CONFIRMING', 'FAILED', 'CANCELLED', 'BLOCKED'])('does not treat %s as settled evidence', async (status) => {
      await expect(client(jest.fn<FetchLike>().mockResolvedValue(json({ ...completed(), status }))).getFinalTransaction(id))
        .rejects.toMatchObject({ code: 'NOT_FINAL' });
    });

    it.each([
      { id: 'c38698f7-366d-4e77-9f73-6474f1c1cfff' }, { amountInfo: { netAmount: '-1' } },
      { amountInfo: { netAmount: 1 } }, { amountInfo: { netAmount: '0.000000' } },
      { numOfConfirmations: 0 }, { numOfConfirmations: 1.5 }, { destination: { type: 'EXTERNAL_WALLET', id: '123' } },
      { destination: { type: 'VAULT_ACCOUNT', id: '../123' } }, { blockInfo: { blockHeight: '123', blockHash: '' } },
      { blockInfo: { blockHeight: '-1', blockHash: '0xblock' } }, { txHash: '' }, { index: -1 },
    ])('rejects incomplete or identity-inconsistent final records: %j', async (change) => {
      await expect(client(jest.fn<FetchLike>().mockResolvedValue(json({ ...completed(), ...change }))).getFinalTransaction(id))
        .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it.each([
      { destinations: [{ destination: { type: 'VAULT_ACCOUNT', id: '123' } }] },
      { networkRecords: [{}, {}] }, { networkRecords: [{ isDropped: true }] }, { networkRecords: [{ status: 'DROPPED' }] },
      { networkRecords: [{ txHash: 'another-hash' }] }, { networkRecords: [{ netAmount: '1' }] },
      { operation: 'CONTRACT_CALL' },
    ])('rejects ambiguous aggregate or dropped transaction records: %j', async (change) => {
      await expect(client(jest.fn<FetchLike>().mockResolvedValue(json({ ...completed(), ...change }))).getFinalTransaction(id))
        .rejects.toMatchObject({ code: 'AMBIGUOUS' });
    });

    it('retains narrowly scoped AML and travel-rule evidence without treating completion or bypass as approval', async () => {
      const raw = { ...completed(), customerRefId: 'account-id', subStatus: 'REJECTED_AML_SCREENING',
        sourceAddress: '0xsource', complianceResults: { status: 'PENDING',
          aml: { provider: 'CHAINALYSIS', screeningStatus: 'PENDING', verdict: 'ACCEPT', bypassReason: 'SERVICE_OUTAGE',
            risk: 'high', customerRefId: 'account-id', payload: { secret: 'must-not-leak' } },
          amlList: [{ provider: 'TRM', screeningStatus: 'COMPLETED', verdict: 'REJECT', risk: 'high' }],
          tr: { provider: 'NOTABENE', status: 'PENDING', verdict: 'WAIT' },
        } };
      const result = await client(jest.fn<FetchLike>().mockResolvedValue(json(raw))).getFinalTransaction(id);
      expect(result).toMatchObject({ sourceAddress: '0xsource', customerRefId: 'account-id', subStatus: 'REJECTED_AML_SCREENING',
        compliance: { status: 'PENDING', aml: { status: 'PENDING', verdict: 'ACCEPT', bypassReason: 'SERVICE_OUTAGE' },
          amlList: [{ provider: 'TRM', verdict: 'REJECT' }], travelRule: { status: 'PENDING', verdict: 'WAIT' } } });
      expect(JSON.stringify(result)).not.toContain('must-not-leak');
      expect(JSON.stringify(result)).not.toContain('payload');
    });

    it.each([{ amlList: {} }, { amlList: [null] }, { aml: { screeningStatus: 1 } }, { tr: [] }])
    ('rejects malformed compliance evidence: %j', async (complianceResults) => {
      await expect(client(jest.fn<FetchLike>().mockResolvedValue(json({ ...completed(), complianceResults }))).getFinalTransaction(id))
        .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('does not issue a provider request for a path or non-UUID transaction id', async () => {
      const fetcher = jest.fn<FetchLike>();
      await expect(client(fetcher).getFinalTransaction('../another')).rejects.toMatchObject({ code: 'CONFIGURATION' });
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('transaction history lookup by chain hash', () => {
    const txHash = `0x${'ab'.repeat(32)}`;
    const id1 = '01a617c3-f9a7-432b-954d-1860c8e881b4';
    const id2 = 'c38698f7-366d-4e77-9f73-6474f1c1cfff';
    const input = () => ({ vaultId: '123', assetId: 'USDT_ETH', transactionHash: txHash, afterMs: 1000, beforeMs: Date.now() });
    const row = (id: string) => ({ id, status: 'COMPLETED', assetId: 'USDT_ETH', txHash,
      destination: { type: 'VAULT_ACCOUNT', id: '123' } });
    const page = (value: unknown, next?: string) => new Response(JSON.stringify(value), { status: 200,
      headers: { 'content-type': 'application/json', ...(next ? { 'next-page': next } : {}) } });

    it('exhausts header cursors at the pinned provider origin and signs each exact query', async () => {
      const fetcher = jest.fn<FetchLike>().mockResolvedValueOnce(page([row(id1)], 'opaque+cursor/1'))
        .mockResolvedValueOnce(page([row(id2)]));
      await expect(client(fetcher).findTransactionsByHash(input())).resolves.toEqual([
        { id: id1, status: 'COMPLETED' }, { id: id2, status: 'COMPLETED' },
      ]);
      for (const [url, options] of fetcher.mock.calls) {
        const parsed = new URL(url);
        expect(parsed.origin).toBe('https://api.fireblocks.io');
        expect(parsed.searchParams.get('destId')).toBe('123');
        expect(parsed.searchParams.get('assets')).toBe('USDT_ETH');
        expect(parsed.searchParams.get('txHash')).toBe(txHash);
        const claims = JSON.parse(Buffer.from((options.headers as Record<string, string>).Authorization!.split('.')[1]!, 'base64url').toString());
        expect(claims.uri).toBe(parsed.pathname + parsed.search);
      }
      expect(new URL(fetcher.mock.calls[1]![0]).searchParams.get('next')).toBe('opaque+cursor/1');
    });

    it('fails closed on repeated cursors, truncated pages and foreign records', async () => {
      const loop = jest.fn<FetchLike>().mockImplementation(async () => page([], 'repeat'));
      await expect(client(loop).findTransactionsByHash(input())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      const full = jest.fn<FetchLike>().mockResolvedValue(page(Array.from({ length: 100 }, (_, i) =>
        row(`00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`))));
      await expect(client(full).findTransactionsByHash(input())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      const foreign = jest.fn<FetchLike>().mockResolvedValue(page([{ ...row(id1), destination: { type: 'VAULT_ACCOUNT', id: '456' } }]));
      await expect(client(foreign).findTransactionsByHash(input())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      const wrongHash = jest.fn<FetchLike>().mockResolvedValue(page([{ ...row(id1), txHash: `0x${'cd'.repeat(32)}` }]));
      await expect(client(wrongHash).findTransactionsByHash(input())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('rejects malformed search parameters without sending credentials', async () => {
      const fetcher = jest.fn<FetchLike>();
      await expect(client(fetcher).findTransactionsByHash({ ...input(), transactionHash: '../private' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
      await expect(client(fetcher).findTransactionsByHash({ ...input(), afterMs: 1000, beforeMs: 999 })).rejects.toMatchObject({ code: 'CONFIGURATION' });
      await expect(client(fetcher).findTransactionsByHash({ ...input(), assetId: '../private' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('EVM receipt evidence', () => {
    const txHash = `0x${'ab'.repeat(32)}`, blockHash = `0x${'cd'.repeat(32)}`;
    const sender = `0x${'12'.repeat(20)}`, target = `0x${'34'.repeat(20)}`, contract = `0x${'56'.repeat(20)}`;
    const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const log = () => ({ address: contract, topics: [topic, `0x${'0'.repeat(24)}${sender.slice(2)}`,
      `0x${'0'.repeat(24)}${target.slice(2)}`], data: `0x${'0'.repeat(63)}a`,
      logIndex: 5, removed: false, blockNumber: 123, transactionIndex: 2, transactionHash: txHash, blockHash });
    const receipt = () => ({ status: 1, transactionHash: txHash, blockHash, blockNumber: 123, transactionIndex: 2,
      from: sender, to: contract, logs: [log()] });

    it('authenticates the exact receipt request and retains real log indices and exact hex amounts', async () => {
      const fetcher = jest.fn<FetchLike>().mockResolvedValue(json(receipt()));
      await expect(client(fetcher).getEvmReceipt('ETH', txHash)).resolves.toEqual({
        transactionHash: txHash, blockHash, blockNumber: '123', transactionIndex: 2, from: sender, to: contract,
        logs: [{ address: contract, topics: log().topics, data: log().data, logIndex: 5 }],
      });
      const [url, options] = fetcher.mock.calls[0]!;
      expect(url).toBe(`https://api.fireblocks.io/v1/contract_interactions/base_asset_id/ETH/tx_hash/${txHash}/receipt`);
      const claims = JSON.parse(Buffer.from((options.headers as Record<string, string>).Authorization!.split('.')[1]!, 'base64url').toString());
      expect(claims.uri).toBe(new URL(url).pathname);
    });

    it.each([
      { transactionHash: `0x${'99'.repeat(32)}` }, { blockHash: 'bad' }, { blockNumber: 1.2 },
      { transactionIndex: -1 }, { from: 'not-an-address' }, { logs: null },
      { logs: [{ ...log(), removed: true }] }, { logs: [{ ...log(), blockHash: `0x${'99'.repeat(32)}` }] },
      { logs: [{ ...log(), transactionHash: `0x${'99'.repeat(32)}` }] }, { logs: [{ ...log(), transactionIndex: 3 }] },
      { logs: [{ ...log(), data: '0xabc' }] }, { logs: [{ ...log(), topics: ['0x1'] }] },
      { logs: [log(), log()] },
    ])('rejects malformed, contradictory or removed receipt evidence: %j', async (change) => {
      await expect(client(jest.fn<FetchLike>().mockResolvedValue(json({ ...receipt(), ...change }))).getEvmReceipt('ETH', txHash))
        .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('does not regard a failed transaction or untrusted path as deposit evidence', async () => {
      const failed = jest.fn<FetchLike>().mockResolvedValue(json({ ...receipt(), status: 0 }));
      await expect(client(failed).getEvmReceipt('ETH', txHash)).rejects.toMatchObject({ code: 'NOT_FINAL' });
      const fetcher = jest.fn<FetchLike>();
      await expect(client(fetcher).getEvmReceipt('ETH', '../bad')).rejects.toMatchObject({ code: 'CONFIGURATION' });
      await expect(client(fetcher).getEvmReceipt('../bad', txHash)).rejects.toMatchObject({ code: 'CONFIGURATION' });
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  it('rejects oversized and invalid JSON rather than consuming unbounded provider content', async () => {
    const large = jest.fn<FetchLike>().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-length': '2000000' } }));
    await expect(client(large).getVault('10')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const invalid = jest.fn<FetchLike>().mockResolvedValue(new Response('{', { status: 200 }));
    await expect(client(invalid).getVault('10')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
