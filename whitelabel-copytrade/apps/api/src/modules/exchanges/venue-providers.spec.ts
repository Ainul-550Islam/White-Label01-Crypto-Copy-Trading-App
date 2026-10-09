// # NEW — Verifies live/paper mode selection, signing, and fail-closed error handling for all 5 venues
import * as crypto from 'crypto';
import {
  ExchangeEnvironment,
  ExchangeVenue,
  ExchangeOrderStatus,
  ExchangePositionSide,
  ExchangeOrderSide,
  ExchangeConnectionState,
  ExchangeOrderType,
  VENUE_CAPABILITIES_MATRIX,
} from './exchange.types';
import {
  ExchangeProviderContext,
  ExchangeProviderError,
  ExchangeProviderErrorCode,
} from './exchange-provider.interface';
import { BybitProvider } from './providers/bybit.provider';
import { OkxProvider, okxCanonical } from './providers/okx.provider';
import {
  KrakenProvider,
  krakenAsset,
  krakenPairParts,
  KRAKEN_WITHDRAW_PROBE_KEY,
} from './providers/kraken.provider';
import {
  CoinbaseProvider,
  buildCoinbaseJwt,
  loadCoinbaseKey,
} from './providers/coinbase.provider';
import {
  canonicalFromConcatenated,
  addDecimalStrings,
  subtractDecimalStrings,
} from './base-exchange-provider';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeRegistryService } from './exchange-registry.service';

describe('Venue Capability Matrix & Multi-Venue Provider Parity (GAP-21 & GAP-22)', () => {
  test('defines explicit VenueCapabilities matrix for all 5 primary venues', () => {
    for (const venue of [
      ExchangeVenue.BINANCE,
      ExchangeVenue.BYBIT,
      ExchangeVenue.OKX,
      ExchangeVenue.KRAKEN,
      ExchangeVenue.COINBASE,
    ]) {
      const cap = VENUE_CAPABILITIES_MATRIX[venue];
      expect(cap).toBeDefined();
      expect(cap.venue).toBe(venue);
      expect(cap.spotSupported).toBe(true);
      expect(cap.liveReadSupported).toBe(true);
      expect(cap.liveOrderExecutionGated).toBe(true);
      expect(cap.withdrawalPermissionMustBeDisabled).toBe(true);
      expect(cap.supportedOrderTypes.length).toBeGreaterThan(0);
    }
    expect(VENUE_CAPABILITIES_MATRIX[ExchangeVenue.OKX].requiresPassphrase).toBe(true);
  });

  test('registers all 5 live/testnet/sandbox venue adapters and enforces environment binding', () => {
    const registry = new ExchangeRegistryService();
    const factory = new ExchangeProviderFactory(registry);
    factory.onModuleInit();

    expect(factory.getProvider(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      BybitProvider,
    );
    expect(factory.getProvider(ExchangeVenue.OKX, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      OkxProvider,
    );
    expect(factory.getProvider(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      KrakenProvider,
    );
    expect(factory.getProvider(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE)).toBeInstanceOf(
      CoinbaseProvider,
    );

    expect(() =>
      factory.validateEnvironmentBinding(ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE, true),
    ).toThrow(/Environment mismatch/);
    expect(() =>
      factory.validateEnvironmentBinding(ExchangeVenue.BYBIT, ExchangeEnvironment.TESTNET, false),
    ).toThrow(/Environment mismatch/);
  });
});

type Route = (url: string, init: any) => { status?: number; body: any } | undefined;

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(route: Route): FetchCall[] {
  const calls: FetchCall[] = [];
  jest.spyOn(global as any, 'fetch').mockImplementation(async (...args: any[]) => {
    const url = String(args[0]);
    const init = args[1] ?? {};
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const answer = route(url, init);
    if (!answer) throw new Error(`unrouted fetch ${url}`);
    const status = answer.status ?? 200;
    const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: new Map<string, string>(),
      text: async () => text,
    } as any;
  });
  return calls;
}

function ctx(venue: ExchangeVenue, environment: ExchangeEnvironment, passphrase?: string, secret = 'test-secret'): ExchangeProviderContext {
  return {
    tenantId: 'tenant-1',
    accountId: 'acct-1',
    venue,
    environment,
    isSandbox: environment !== ExchangeEnvironment.LIVE,
    credentials: { apiKey: 'test-key', apiSecret: secret, passphrase } as any,
    credentialRef: null,
  };
}

async function expectCode(promise: Promise<unknown>, code: ExchangeProviderErrorCode): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ExchangeProviderError);
  expect((caught as ExchangeProviderError).code).toBe(code);
}

const URLS = {
  liveRest: 'https://live.example',
  testnetRest: 'https://testnet.example',
  sandboxRest: 'https://sandbox.example',
  liveWs: 'wss://live.example',
  testnetWs: 'wss://testnet.example',
  sandboxWs: 'wss://sandbox.example',
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('shared helpers', () => {
  test('canonicalFromConcatenated prefers the longest known quote', () => {
    expect(canonicalFromConcatenated('BTCUSDT')).toBe('BTC-USDT');
    expect(canonicalFromConcatenated('ETHUSDC')).toBe('ETH-USDC');
    expect(canonicalFromConcatenated('SOLBTC')).toBe('SOL-BTC');
  });

  test('decimal string arithmetic is exact', () => {
    expect(addDecimalStrings('0.1', '0.2')).toBe('0.3');
    expect(subtractDecimalStrings('1.00000001', '0.00000001')).toMatch(/^1(\.0*)?$/);
  });
});

describe('BybitProvider', () => {
  const provider = new BybitProvider(URLS);

  test('signature is HMAC-SHA256 hex over timestamp+key+recvWindow+query', () => {
    const expected = crypto.createHmac('sha256', 's').update('1700000000000k5000a=1&b=2').digest('hex');
    expect(BybitProvider.sign('s', '1700000000000', 'k', '5000', 'a=1&b=2')).toBe(expected);
  });

  test('signed request carries V5 headers and a verifiable signature', async () => {
    const calls = installFetch((url) =>
      url.includes('/v5/account/wallet-balance')
        ? { body: { retCode: 0, result: { list: [{ accountType: 'UNIFIED', coin: [{ coin: 'USDT', walletBalance: '100.5', locked: '0.5' }, { coin: 'BTC', walletBalance: '0', locked: '0' }] }] } } }
        : undefined,
    );
    const balances = await provider.getBalances(ctx(ExchangeVenue.BYBIT, ExchangeEnvironment.TESTNET));
    expect(calls[0].url.startsWith('https://testnet.example/v5/account/wallet-balance?accountType=UNIFIED')).toBe(true);
    const h = calls[0].headers;
    const query = calls[0].url.split('?')[1];
    expect(h['X-BAPI-SIGN']).toBe(BybitProvider.sign('test-secret', h['X-BAPI-TIMESTAMP'], 'test-key', h['X-BAPI-RECV-WINDOW'], query));
    expect(balances).toEqual([
      expect.objectContaining({ asset: 'USDT', total: '100.5', locked: '0.5', free: '100', isSimulated: true }),
    ]);
  });

  test.each([
    [10003, ExchangeProviderErrorCode.AUTH_FAILED],
    [10005, ExchangeProviderErrorCode.PERMISSION_DENIED],
    [10002, ExchangeProviderErrorCode.CLOCK_DRIFT],
    [10006, ExchangeProviderErrorCode.RATE_LIMITED],
    [10016, ExchangeProviderErrorCode.SERVER_ERROR],
    [99999, ExchangeProviderErrorCode.UNKNOWN],
  ])('retCode %s is classified, never returned as empty data', async (retCode, code) => {
    installFetch(() => ({ body: { retCode, retMsg: 'nope' } }));
    await expectCode(provider.getBalances(ctx(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE)), code);
  });

  test('withdraw-capable key is refused by testConnectivity', async () => {
    installFetch((url) => {
      if (url.includes('/v5/market/time')) return { body: { retCode: 0, result: { timeSecond: String(Math.floor(Date.now() / 1000)) } } };
      if (url.includes('/v5/user/query-api')) return { body: { retCode: 0, result: { readOnly: 0, permissions: { Spot: ['SpotTrade'], Wallet: ['AccountTransfer', 'Withdraw'] } } } };
      return undefined;
    });
    await expectCode(provider.testConnectivity(ctx(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE)), ExchangeProviderErrorCode.WITHDRAWAL_NOT_ALLOWED);
  });

  test('read-only key connects degraded; trade key connects', async () => {
    let readOnly = 1;
    installFetch((url) => {
      if (url.includes('/v5/market/time')) return { body: { retCode: 0, result: { timeNano: String(BigInt(Date.now()) * 1_000_000n) } } };
      if (url.includes('/v5/user/query-api')) return { body: { retCode: 0, result: { readOnly, permissions: { Spot: ['SpotTrade'] }, userID: 42 } } };
      return undefined;
    });
    const degraded = await provider.testConnectivity(ctx(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE));
    expect(degraded.degraded).toBe(true);
    expect(degraded.state).toBe(ExchangeConnectionState.DEGRADED);
    readOnly = 0;
    const ok = await provider.testConnectivity(ctx(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE));
    expect(ok.connected).toBe(true);
    expect(ok.degraded).toBe(false);
  });

  test('positions follow the cursor and map side/quantity', async () => {
    const calls = installFetch((url) => {
      if (!url.includes('/v5/position/list')) return undefined;
      if (url.includes('settleCoin=USDT') && !url.includes('cursor=')) {
        return { body: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT', side: 'Sell', size: '0.5', avgPrice: '60000', positionIdx: 0, updatedTime: '1700000000000' }], nextPageCursor: 'p2' } } };
      }
      if (url.includes('cursor=p2')) {
        return { body: { retCode: 0, result: { list: [{ symbol: 'ETHUSDT', side: 'Buy', size: '2', positionIdx: 0 }], nextPageCursor: '' } } };
      }
      return { body: { retCode: 0, result: { list: [{ symbol: 'SOLUSDC', side: 'Buy', size: '0' }], nextPageCursor: '' } } };
    });
    const positions = await provider.getPositions(ctx(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE));
    expect(calls.filter((c) => c.url.includes('/v5/position/list'))).toHaveLength(3);
    expect(positions.map((p) => [p.symbol, p.side, p.quantity])).toEqual([
      ['BTC-USDT', ExchangePositionSide.SHORT, '0.5'],
      ['ETH-USDT', ExchangePositionSide.LONG, '2'],
    ]);
    expect(positions[0].timestampMicros).toBe('1700000000000000');
  });

  test('order status mapping', () => {
    expect(BybitProvider.mapOrderStatus('New')).toBe(ExchangeOrderStatus.NEW);
    expect(BybitProvider.mapOrderStatus('PartiallyFilled')).toBe(ExchangeOrderStatus.PARTIALLY_FILLED);
    expect(BybitProvider.mapOrderStatus('Filled')).toBe(ExchangeOrderStatus.FILLED);
    expect(BybitProvider.mapOrderStatus('Cancelled')).toBe(ExchangeOrderStatus.CANCELED);
    expect(BybitProvider.mapOrderStatus('Rejected')).toBe(ExchangeOrderStatus.REJECTED);
  });

  test('HTTP 401 is AUTH_FAILED', async () => {
    installFetch(() => ({ status: 401, body: { retCode: 10003 } }));
    await expectCode(provider.getOpenOrders(ctx(ExchangeVenue.BYBIT, ExchangeEnvironment.LIVE)), ExchangeProviderErrorCode.AUTH_FAILED);
  });
});

describe('OkxProvider', () => {
  const provider = new OkxProvider(URLS);

  test('signature is base64 HMAC-SHA256 over ts+METHOD+path+body', () => {
    const expected = crypto.createHmac('sha256', 's').update('2024-01-01T00:00:00.000ZGET/api/v5/account/balance').digest('base64');
    expect(OkxProvider.sign('s', '2024-01-01T00:00:00.000Z', 'get', '/api/v5/account/balance')).toBe(expected);
  });

  test('passphrase is mandatory', async () => {
    installFetch(() => ({ body: { code: '0', data: [] } }));
    await expectCode(provider.getBalances(ctx(ExchangeVenue.OKX, ExchangeEnvironment.LIVE)), ExchangeProviderErrorCode.INVALID_CREDENTIALS);
  });

  test('demo environments send x-simulated-trading; live does not', async () => {
    const calls = installFetch(() => ({ body: { code: '0', data: [{ uTime: '1700000000000', details: [{ ccy: 'USDT', availBal: '10', frozenBal: '2', cashBal: '12' }] }] } }));
    const demo = await provider.getBalances(ctx(ExchangeVenue.OKX, ExchangeEnvironment.SANDBOX, 'pp'));
    await provider.getBalances(ctx(ExchangeVenue.OKX, ExchangeEnvironment.LIVE, 'pp'));
    expect(calls[0].headers['x-simulated-trading']).toBe('1');
    expect(calls[1].headers['x-simulated-trading']).toBeUndefined();
    const h = calls[0].headers;
    expect(h['OK-ACCESS-PASSPHRASE']).toBe('pp');
    expect(h['OK-ACCESS-SIGN']).toBe(OkxProvider.sign('test-secret', h['OK-ACCESS-TIMESTAMP'], 'GET', '/api/v5/account/balance'));
    expect(demo).toEqual([expect.objectContaining({ asset: 'USDT', free: '10', locked: '2', total: '12' })]);
  });

  test.each([
    ['50111', ExchangeProviderErrorCode.AUTH_FAILED],
    ['50120', ExchangeProviderErrorCode.PERMISSION_DENIED],
    ['50102', ExchangeProviderErrorCode.CLOCK_DRIFT],
    ['50011', ExchangeProviderErrorCode.RATE_LIMITED],
    ['50001', ExchangeProviderErrorCode.SERVER_ERROR],
  ])('code %s is classified', async (code, expected) => {
    installFetch(() => ({ body: { code, msg: 'x', data: [] } }));
    await expectCode(provider.getBalances(ctx(ExchangeVenue.OKX, ExchangeEnvironment.LIVE, 'pp')), expected);
  });

  test('metadata derives permissions from account/config perm', async () => {
    installFetch(() => ({ body: { code: '0', data: [{ perm: 'read_only,trade', uid: '77', ip: '1.2.3.4' }] } }));
    const meta = await provider.getAccountMetadata(ctx(ExchangeVenue.OKX, ExchangeEnvironment.LIVE, 'pp'));
    expect(meta).toEqual(expect.objectContaining({ canTrade: true, canWithdraw: false, canRead: true, ipRestricted: true, uid: '77' }));
  });

  test('instrument ids are canonicalized', () => {
    expect(okxCanonical('BTC-USDT-SWAP')).toBe('BTC-USDT');
    expect(okxCanonical('eth-usdc')).toBe('ETH-USDC');
  });

  test('order state mapping', () => {
    expect(OkxProvider.mapOrderStatus('live')).toBe(ExchangeOrderStatus.NEW);
    expect(OkxProvider.mapOrderStatus('partially_filled')).toBe(ExchangeOrderStatus.PARTIALLY_FILLED);
    expect(OkxProvider.mapOrderStatus('filled')).toBe(ExchangeOrderStatus.FILLED);
    expect(OkxProvider.mapOrderStatus('canceled')).toBe(ExchangeOrderStatus.CANCELED);
  });
});

describe('KrakenProvider', () => {
  const provider = new KrakenProvider({ liveRest: 'https://api.kraken.test', liveWs: 'wss://ws.kraken.test' });
  const secret = Buffer.from('kraken-secret-bytes-0123456789').toString('base64');

  test('signature matches the published algorithm (path bytes || sha256(nonce+postdata))', () => {
    const nonce = '1700000000000000';
    const post = `nonce=${nonce}`;
    const digest = crypto.createHash('sha256').update(nonce + post).digest();
    const expected = crypto.createHmac('sha512', Buffer.from(secret, 'base64')).update(Buffer.concat([Buffer.from('/0/private/Balance'), digest])).digest('base64');
    expect(KrakenProvider.sign(secret, '/0/private/Balance', nonce, post)).toBe(expected);
  });

  test('only LIVE is supported', async () => {
    installFetch(() => ({ body: { error: [], result: {} } }));
    await expectCode(provider.getBalances(ctx(ExchangeVenue.KRAKEN, ExchangeEnvironment.SANDBOX, undefined, secret)), ExchangeProviderErrorCode.NOT_SUPPORTED);
    expect(provider.supportedEnvironments).toEqual([ExchangeEnvironment.LIVE]);
  });

  test('balances: BalanceEx mapped, legacy asset codes normalized, signature verifiable, nonces increase', async () => {
    const calls = installFetch((url) =>
      url.endsWith('/0/private/BalanceEx')
        ? { body: { error: [], result: { XXBT: { balance: '1.5', hold_trade: '0.5' }, ZUSD: { balance: '100.0000', hold_trade: '0' }, XETH: { balance: '0', hold_trade: '0' } } } }
        : undefined,
    );
    const c = ctx(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE, undefined, secret);
    const balances = await provider.getBalances(c);
    await provider.getBalances(c);
    expect(balances).toEqual([
      expect.objectContaining({ asset: 'BTC', total: '1.5', locked: '0.5', free: '1' }),
      expect.objectContaining({ asset: 'USD', total: '100.0000', locked: '0' }),
    ]);
    const nonce1 = new URLSearchParams(calls[0].body!).get('nonce')!;
    const nonce2 = new URLSearchParams(calls[1].body!).get('nonce')!;
    expect(BigInt(nonce2) > BigInt(nonce1)).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['API-Sign']).toBe(KrakenProvider.sign(secret, '/0/private/BalanceEx', nonce1, calls[0].body!));
  });

  test.each([
    ['EAPI:Invalid key', ExchangeProviderErrorCode.AUTH_FAILED],
    ['EAPI:Invalid nonce', ExchangeProviderErrorCode.CLOCK_DRIFT],
    ['EGeneral:Permission denied', ExchangeProviderErrorCode.PERMISSION_DENIED],
    ['EAPI:Rate limit exceeded', ExchangeProviderErrorCode.RATE_LIMITED],
    ['EService:Unavailable', ExchangeProviderErrorCode.SERVER_ERROR],
  ])('error %s is classified', async (err, code) => {
    installFetch(() => ({ body: { error: [err] } }));
    await expectCode(provider.getOpenOrders(ctx(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE, undefined, secret)), code);
  });

  test('permission probes: withdraw refused + trade refused => read-only, safe', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/0/private/Balance')) return { body: { error: [], result: {} } };
      if (url.endsWith('/0/private/WithdrawInfo')) return { body: { error: ['EGeneral:Permission denied'] } };
      if (url.endsWith('/0/private/AddOrder')) return { body: { error: ['EGeneral:Permission denied'] } };
      return undefined;
    });
    const meta = await provider.getAccountMetadata(ctx(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE, undefined, secret));
    expect(meta.canWithdraw).toBe(false);
    expect(meta.canTrade).toBe(false);
    const withdrawCall = calls.find((c) => c.url.endsWith('/0/private/WithdrawInfo'))!;
    expect(new URLSearchParams(withdrawCall.body!).get('key')).toBe(KRAKEN_WITHDRAW_PROBE_KEY);
    const orderCall = calls.find((c) => c.url.endsWith('/0/private/AddOrder'))!;
    expect(new URLSearchParams(orderCall.body!).get('validate')).toBe('true');
  });

  test('permission probes fail closed: an unknown-key answer counts as withdraw-capable', async () => {
    installFetch((url) => {
      if (url.endsWith('/0/private/Balance')) return { body: { error: [], result: {} } };
      if (url.endsWith('/0/private/WithdrawInfo')) return { body: { error: ['EFunding:Unknown withdraw key'] } };
      if (url.endsWith('/0/private/AddOrder')) return { body: { error: [], result: { descr: { order: 'validated' } } } };
      if (url.endsWith('/0/public/Time')) return { body: { error: [], result: { unixtime: Math.floor(Date.now() / 1000) } } };
      return undefined;
    });
    const c = ctx(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE, undefined, secret);
    const meta = await provider.getAccountMetadata(c);
    expect(meta.canWithdraw).toBe(true);
    expect(meta.canTrade).toBe(true);
    await expectCode(provider.testConnectivity(c), ExchangeProviderErrorCode.WITHDRAWAL_NOT_ALLOWED);
  });

  test('pairs and assets normalize in every Kraken spelling', () => {
    expect(krakenAsset('XXBT')).toBe('BTC');
    expect(krakenAsset('XDG')).toBe('DOGE');
    expect(krakenAsset('ZUSD')).toBe('USD');
    expect(krakenAsset('ETH.F')).toBe('ETH.F');
    expect(krakenPairParts('XXBTZUSD')).toEqual({ base: 'BTC', quote: 'USD' });
    expect(krakenPairParts('XBTUSD')).toEqual({ base: 'BTC', quote: 'USD' });
    expect(krakenPairParts('XBT/EUR')).toEqual({ base: 'BTC', quote: 'EUR' });
    expect(krakenPairParts('SOLUSDT')).toEqual({ base: 'SOL', quote: 'USDT' });
  });

  test('open orders mapping keeps decimal strings and stop semantics', async () => {
    installFetch(() => ({
      body: {
        error: [],
        result: {
          open: {
            'OABC-1': { status: 'open', opentm: 1700000000.5, vol: '1.0', vol_exec: '0.25', price: '0', descr: { pair: 'XBTUSD', type: 'sell', ordertype: 'stop-loss-limit', price: '50000', price2: '49900' } },
          },
        },
      },
    }));
    const [order] = await provider.getOpenOrders(ctx(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE, undefined, secret));
    expect(order).toEqual(
      expect.objectContaining({
        providerOrderId: 'OABC-1',
        symbol: 'BTC-USD',
        side: ExchangeOrderSide.SELL,
        type: ExchangeOrderType.STOP_LIMIT,
        status: ExchangeOrderStatus.PARTIALLY_FILLED,
        stopPrice: '50000',
        price: '49900',
        filledQuantity: '0.25',
        averagePrice: null,
        createdAtMicros: '1700000000500000',
      }),
    );
  });

  test('server time from /0/public/Time', async () => {
    const now = Math.floor(Date.now() / 1000);
    installFetch(() => ({ body: { error: [], result: { unixtime: now } } }));
    const t = await provider.getServerTime(ctx(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE, undefined, secret));
    expect(t.serverTimeMicros).toBe((BigInt(now) * 1_000_000n).toString());
  });
});

describe('CoinbaseProvider', () => {
  const provider = new CoinbaseProvider({ liveRest: 'https://api.coinbase.test', sandboxRest: 'https://api-sandbox.coinbase.test', liveWs: 'wss://a', sandboxWs: 'wss://b' });
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecPem = ec.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  const keyName = 'organizations/org-1/apiKeys/key-1';

  function decodeJwt(token: string) {
    const [h, p, s] = token.split('.');
    const json = (part: string) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return { header: json(h), payload: json(p), signingInput: `${h}.${p}`, signature: Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64') };
  }

  test('ES256 JWT has the CDP claims and verifies with the public key', () => {
    const token = buildCoinbaseJwt(keyName, ecPem.replace(/\n/g, '\\n'), 'GET', 'api.coinbase.com', '/api/v3/brokerage/accounts', 1_700_000_000);
    const { header, payload, signingInput, signature } = decodeJwt(token);
    expect(header).toEqual(expect.objectContaining({ alg: 'ES256', kid: keyName, typ: 'JWT' }));
    expect(header.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(payload).toEqual({ iss: 'cdp', sub: keyName, nbf: 1_700_000_000, exp: 1_700_000_120, uri: 'GET api.coinbase.com/api/v3/brokerage/accounts' });
    expect(signature).toHaveLength(64);
    expect(crypto.verify('sha256', Buffer.from(signingInput), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(true);
  });

  test('Ed25519 raw base64 secret is accepted and signs EdDSA', () => {
    const ed = crypto.generateKeyPairSync('ed25519');
    const der = ed.privateKey.export({ type: 'pkcs8', format: 'der' });
    const seed = der.subarray(der.length - 32);
    const pub = ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
    const raw = Buffer.concat([seed, pub]).toString('base64');
    expect(loadCoinbaseKey(raw).alg).toBe('EdDSA');
    const token = buildCoinbaseJwt(keyName, raw, 'GET', 'api.coinbase.com', '/api/v3/brokerage/time');
    const { header, signingInput, signature } = decodeJwt(token);
    expect(header.alg).toBe('EdDSA');
    expect(crypto.verify(null, Buffer.from(signingInput), ed.publicKey, signature)).toBe(true);
  });

  test('unusable secret is INVALID_CREDENTIALS, not a crash', async () => {
    installFetch(() => ({ body: {} }));
    await expectCode(provider.getBalances(ctx(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE, undefined, 'not-a-key')), ExchangeProviderErrorCode.INVALID_CREDENTIALS);
  });

  test('balances paginate by cursor, sign each request for its own path, and add free+hold exactly', async () => {
    const calls = installFetch((url) => {
      if (!url.includes('/api/v3/brokerage/accounts')) return undefined;
      if (!url.includes('cursor=')) {
        return { body: { accounts: [{ uuid: 'u1', currency: 'BTC', available_balance: { value: '0.1', currency: 'BTC' }, hold: { value: '0.2', currency: 'BTC' } }], has_next: true, cursor: 'c2' } };
      }
      return { body: { accounts: [{ uuid: 'u2', currency: 'USD', available_balance: { value: '0', currency: 'USD' }, hold: { value: '0', currency: 'USD' } }], has_next: false, cursor: '' } };
    });
    const balances = await provider.getBalances(ctx(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE, undefined, ecPem));
    expect(calls).toHaveLength(2);
    expect(balances).toEqual([expect.objectContaining({ asset: 'BTC', free: '0.1', locked: '0.2', total: '0.3', providerReference: 'u1' })]);
    const auth = calls[0].headers['Authorization'];
    expect(auth.startsWith('Bearer ')).toBe(true);
    expect(decodeJwt(auth.slice(7)).payload.uri).toBe('GET api.coinbase.test/api/v3/brokerage/accounts');
  });

  test('sandbox calls carry no token (the static sandbox accepts none)', async () => {
    const calls = installFetch(() => ({ body: { accounts: [], has_next: false } }));
    await provider.getBalances(ctx(ExchangeVenue.COINBASE, ExchangeEnvironment.SANDBOX, undefined, 'irrelevant'));
    expect(calls[0].url.startsWith('https://api-sandbox.coinbase.test/')).toBe(true);
    expect(calls[0].headers['Authorization']).toBeUndefined();
  });

  test('key permissions: can_transfer => withdraw-capable => connectivity refused', async () => {
    installFetch((url) => {
      if (url.includes('/brokerage/time')) return { body: { epochMillis: String(Date.now()) } };
      if (url.includes('/brokerage/key_permissions')) return { body: { can_view: true, can_trade: true, can_transfer: true, portfolio_uuid: 'p1' } };
      return undefined;
    });
    await expectCode(provider.testConnectivity(ctx(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE, undefined, ecPem)), ExchangeProviderErrorCode.WITHDRAWAL_NOT_ALLOWED);
  });

  test('no futures account (404) is zero positions; 5xx is surfaced', async () => {
    installFetch(() => ({ status: 404, body: { error: 'NOT_FOUND' } }));
    await expect(provider.getPositions(ctx(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE, undefined, ecPem))).resolves.toEqual([]);
    jest.restoreAllMocks();
    installFetch(() => ({ status: 503, body: {} }));
    await expectCode(provider.getPositions(ctx(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE, undefined, ecPem)), ExchangeProviderErrorCode.SERVER_ERROR);
  });

  test('order mapping reads order_configuration', async () => {
    installFetch(() => ({
      body: {
        orders: [
          {
            order_id: 'o1',
            client_order_id: 'c1',
            product_id: 'ETH-USD',
            side: 'BUY',
            status: 'OPEN',
            order_type: 'LIMIT',
            filled_size: '0',
            order_configuration: { limit_limit_gtc: { base_size: '2', limit_price: '3000', post_only: true } },
            created_time: '2024-01-01T00:00:00Z',
          },
        ],
        has_next: false,
      },
    }));
    const [o] = await provider.getOpenOrders(ctx(ExchangeVenue.COINBASE, ExchangeEnvironment.LIVE, undefined, ecPem));
    expect(o).toEqual(expect.objectContaining({ clientOrderId: 'c1', providerOrderId: 'o1', symbol: 'ETH-USD', type: ExchangeOrderType.LIMIT_MAKER, quantity: '2', price: '3000', status: ExchangeOrderStatus.NEW }));
  });

  test('status mapping', () => {
    expect(CoinbaseProvider.mapOrderStatus('OPEN', '1')).toBe(ExchangeOrderStatus.PARTIALLY_FILLED);
    expect(CoinbaseProvider.mapOrderStatus('FILLED')).toBe(ExchangeOrderStatus.FILLED);
    expect(CoinbaseProvider.mapOrderStatus('CANCELLED')).toBe(ExchangeOrderStatus.CANCELED);
    expect(CoinbaseProvider.mapOrderStatus('FAILED')).toBe(ExchangeOrderStatus.REJECTED);
    expect(CoinbaseProvider.mapOrderStatus('EXPIRED')).toBe(ExchangeOrderStatus.EXPIRED);
  });
});

describe('ExchangeProviderFactory registration', () => {
  test('every named venue gets its dedicated provider; OTHER_CONFIGURED refuses data calls', async () => {
    const registry = new ExchangeRegistryService();
    const factory = new ExchangeProviderFactory(registry);
    factory.onModuleInit();
    expect(factory.getProvider(ExchangeVenue.BYBIT, ExchangeEnvironment.TESTNET)).toBeInstanceOf(BybitProvider);
    expect(factory.getProvider(ExchangeVenue.OKX, ExchangeEnvironment.LIVE)).toBeInstanceOf(OkxProvider);
    expect(factory.getProvider(ExchangeVenue.KRAKEN, ExchangeEnvironment.LIVE)).toBeInstanceOf(KrakenProvider);
    expect(factory.getProvider(ExchangeVenue.COINBASE, ExchangeEnvironment.SANDBOX)).toBeInstanceOf(CoinbaseProvider);
    expect(() => factory.getProvider(ExchangeVenue.KRAKEN, ExchangeEnvironment.SANDBOX)).toThrow(ExchangeProviderError);

    const coinbase = registry.getVenue(ExchangeVenue.COINBASE)!;
    expect(coinbase.requiresPassphrase).toBe(false);
    expect(coinbase.authenticationModel).toBe('JWT_ES256');
    expect(coinbase.baseRestUrlSandbox).toBe('https://api-sandbox.coinbase.com');

    if (factory.hasProvider(ExchangeVenue.OTHER_CONFIGURED)) {
      const other = factory.getProvider(ExchangeVenue.OTHER_CONFIGURED, ExchangeEnvironment.LIVE);
      await expectCode(other.getBalances(ctx(ExchangeVenue.OTHER_CONFIGURED, ExchangeEnvironment.LIVE)), ExchangeProviderErrorCode.NOT_SUPPORTED);
      await expectCode(other.getPositions(ctx(ExchangeVenue.OTHER_CONFIGURED, ExchangeEnvironment.LIVE)), ExchangeProviderErrorCode.NOT_SUPPORTED);
    }
  });
});
