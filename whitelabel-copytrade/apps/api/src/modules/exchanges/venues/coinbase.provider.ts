import * as crypto from 'crypto';
import {
  ExchangeVenue,
  ExchangeEnvironment,
  ExchangeCapability,
  ExchangeOrderType,
  ExchangeBalance,
  ExchangePosition,
  ExchangeOrder,
  ExchangeFill,
  ExchangeSymbol,
  ExchangeCapabilityDiscovery,
  ExchangePositionSide,
  ExchangeOrderStatus,
  ExchangeOrderSide,
  ExchangeConnectivityResult,
} from '../exchange.types';
import {
  ExchangeProviderError,
  ExchangeProviderErrorCode,
  ExchangeProviderContext,
  ExchangeServerTime,
  ExchangeAccountMetadata,
} from '../exchange-provider.interface';
import {
  BaseExchangeProvider,
  addDecimalStrings,
  isDecimalString,
  isoToMicros,
  nowMicros,
  precisionOfStep,
} from '../base-exchange-provider';

function dec(value: unknown): string {
  return isDecimalString(value) ? value : '0';
}

function decOrNull(value: unknown): string | null {
  return isDecimalString(value) ? value : null;
}

const MAX_PAGES = 10;
/** PKCS#8 DER prefix for a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Loads a Coinbase Developer Platform (CDP) API secret as a private key.
 * Accepts both key families CDP issues: an EC P-256 PEM ("-----BEGIN EC PRIVATE
 * KEY-----", often stored with literal "\n" escapes) and an Ed25519 secret
 * delivered as base64 of 64 bytes (seed || public key).
 */
export function loadCoinbaseKey(secret: string): { key: crypto.KeyObject; alg: 'ES256' | 'EdDSA' } {
  const normalized = secret.includes('\\n') ? secret.replace(/\\n/g, '\n') : secret;
  if (normalized.includes('-----BEGIN')) {
    const key = crypto.createPrivateKey(normalized);
    const type = key.asymmetricKeyType;
    if (type === 'ec') return { key, alg: 'ES256' };
    if (type === 'ed25519') return { key, alg: 'EdDSA' };
    throw new Error(`unsupported Coinbase key type ${type}`);
  }
  const raw = Buffer.from(normalized.trim(), 'base64');
  if (raw.length !== 64 && raw.length !== 32) throw new Error('Coinbase Ed25519 secret must be base64 of 32 or 64 bytes');
  const key = crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
  return { key, alg: 'EdDSA' };
}

/**
 * Builds the short-lived bearer JWT Coinbase Advanced Trade requires on every
 * private request: `sub`/`kid` = API key name, `iss` = "cdp", a two-minute
 * validity window, and `uri` = "METHOD host/path" binding the token to exactly
 * one endpoint (query string excluded, as the venue specifies).
 */
export function buildCoinbaseJwt(keyName: string, secret: string, method: string, host: string, path: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const { key, alg } = loadCoinbaseKey(secret);
  const header = { alg, kid: keyName, nonce: crypto.randomBytes(16).toString('hex'), typ: 'JWT' };
  const payload = { iss: 'cdp', sub: keyName, nbf: nowSeconds, exp: nowSeconds + 120, uri: `${method.toUpperCase()} ${host}${path}` };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature =
    alg === 'ES256'
      ? crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
      : crypto.sign(null, Buffer.from(signingInput), key);
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Coinbase Advanced Trade API (v3 brokerage), read side.
 *
 * Authentication is a per-request ES256/EdDSA JWT built from a CDP API key
 * (key name + private key); there is no passphrase. The sandbox
 * (api-sandbox.coinbase.com) serves static responses and accepts no
 * authentication, so sandbox calls are sent without a token rather than with
 * a token signed by a key the sandbox cannot verify.
 */
export class CoinbaseProvider extends BaseExchangeProvider {
  readonly venue = ExchangeVenue.COINBASE;
  readonly displayName: string;
  readonly supportedEnvironments: ExchangeEnvironment[] = [ExchangeEnvironment.LIVE, ExchangeEnvironment.SANDBOX];
  readonly supportedCapabilities: ExchangeCapability[] = [
    ExchangeCapability.SPOT,
    ExchangeCapability.FUTURES,
    ExchangeCapability.MARKET_DATA,
    ExchangeCapability.BALANCES,
    ExchangeCapability.POSITIONS,
    ExchangeCapability.ORDERS,
    ExchangeCapability.TRADES,
  ];

  constructor(
    private readonly urls: { liveRest: string; sandboxRest: string; liveWs: string; sandboxWs: string },
    displayName = 'Coinbase Advanced Trade',
  ) {
    super();
    this.displayName = displayName;
  }

  protected getLiveRestUrl(): string {
    return this.urls.liveRest;
  }
  protected getTestnetRestUrl(): string {
    return this.urls.sandboxRest;
  }
  protected getSandboxRestUrl(): string {
    return this.urls.sandboxRest;
  }
  protected getLiveWsUrl(): string {
    return this.urls.liveWs;
  }
  protected getTestnetWsUrl(): string {
    return this.urls.sandboxWs;
  }
  protected getSandboxWsUrl(): string {
    return this.urls.sandboxWs;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  private async privateGet(context: ExchangeProviderContext, path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
    const base = this.getRestBaseUrlForEnv(context.environment);
    const query = this.buildQuery(params);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (context.environment === ExchangeEnvironment.LIVE) {
      this.requireCredentials(context);
      let token: string;
      try {
        token = buildCoinbaseJwt(context.credentials.apiKey, context.credentials.apiSecret, 'GET', new URL(base).host, path);
      } catch (e: any) {
        throw new ExchangeProviderError(
          ExchangeProviderErrorCode.INVALID_CREDENTIALS,
          `Coinbase API secret is not a usable CDP private key (${String(e?.message ?? e).slice(0, 120)})`,
          context.venue,
          context.environment,
          false,
        );
      }
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      return await this.httpGet(`${base}${path}${query ? `?${query}` : ''}`, headers);
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  async getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime> {
    let data: any;
    try {
      data = await this.httpGet(`${this.getRestBaseUrlForEnv(context.environment)}/api/v3/brokerage/time`, { Accept: 'application/json' });
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
    const ms = Number(data?.epochMillis ?? (data?.epochSeconds !== undefined ? Number(data.epochSeconds) * 1000 : NaN));
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, 'Coinbase server time missing from response', context.venue, context.environment, true);
    }
    return this.serverTimeFromMs(ms);
  }

  async testConnectivity(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult> {
    return this.connectivityFromMetadata(context);
  }

  async getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata> {
    const data = await this.privateGet(context, '/api/v3/brokerage/key_permissions');
    const permissions: string[] = [];
    if (data?.can_view) permissions.push('view');
    if (data?.can_trade) permissions.push('trade');
    if (data?.can_transfer) permissions.push('transfer');
    return {
      accountId: context.accountId,
      venue: context.venue,
      environment: context.environment,
      isSandbox: context.isSandbox,
      canTrade: data?.can_trade === true,
      canRead: data?.can_view === true,
      // `can_transfer` is Coinbase's "move funds out" permission; anything but
      // an explicit false is treated as present (fail closed).
      canWithdraw: data?.can_transfer !== false,
      ipRestricted: false,
      permissions,
      uid: data?.portfolio_uuid ? String(data.portfolio_uuid) : null,
      email: null,
    };
  }

  async getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery> {
    return {
      venue: context.venue,
      environment: context.environment,
      capabilities: this.supportedCapabilities,
      supportedOrderTypes: [ExchangeOrderType.MARKET, ExchangeOrderType.LIMIT, ExchangeOrderType.STOP_LIMIT],
      supportedEnvironments: this.supportedEnvironments,
      apiVersion: 'v3',
      restAvailable: true,
      websocketAvailable: true,
      rateLimitModel: 'REQUEST_COUNT',
      authenticationModel: 'JWT_ES256',
      symbolFormat: 'BTC-USD',
      timestamp: new Date().toISOString(),
    };
  }

  async getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]> {
    const rows: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await this.privateGet(context, '/api/v3/brokerage/accounts', { limit: 250, cursor });
      rows.push(...(Array.isArray(data?.accounts) ? data.accounts : []));
      if (!data?.has_next || !data?.cursor) break;
      cursor = String(data.cursor);
    }
    const timestampMicros = nowMicros();
    return rows
      .map((a) => {
        const free = dec(a?.available_balance?.value);
        const locked = dec(a?.hold?.value);
        return {
          asset: String(a?.currency ?? a?.available_balance?.currency ?? ''),
          free,
          locked,
          total: addDecimalStrings(free, locked),
          providerReference: a?.uuid ? String(a.uuid) : null,
          timestampMicros,
          source: 'REST',
          isSimulated: context.isSandbox,
        };
      })
      .filter((b) => b.asset !== '' && (!/^0(\.0+)?$/.test(b.total)));
  }

  /**
   * Coinbase spot holds balances, not positions, so a spot-only portfolio
   * truthfully has none. Futures (CFM) positions are read when the portfolio
   * has a futures account; the venue answers 4xx for one that does not, which
   * is the "no futures account" fact, not an error to surface.
   */
  async getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]> {
    let data: any;
    try {
      data = await this.privateGet(context, '/api/v3/brokerage/cfm/positions');
    } catch (e: any) {
      const status = e?.originalError?.status;
      if (e instanceof ExchangeProviderError && [400, 404].includes(status)) return [];
      throw e;
    }
    const positions: any[] = Array.isArray(data?.positions) ? data.positions : [];
    return positions
      .filter((p) => isDecimalString(p?.number_of_contracts) && !/^0(\.0+)?$/.test(p.number_of_contracts))
      .map((p) => ({
        providerPositionId: p?.product_id ? String(p.product_id) : null,
        symbol: String(p?.product_id ?? ''),
        exchangeSymbol: String(p?.product_id ?? ''),
        side: String(p?.side).toUpperCase() === 'SHORT' ? ExchangePositionSide.SHORT : ExchangePositionSide.LONG,
        quantity: String(p.number_of_contracts).replace(/^-/, ''),
        entryPrice: decOrNull(p?.avg_entry_price),
        markPrice: decOrNull(p?.current_price),
        liquidationPrice: null,
        leverage: null,
        unrealizedPnl: decOrNull(p?.unrealized_pnl),
        realizedPnl: decOrNull(p?.daily_realized_pnl),
        timestampMicros: nowMicros(),
        isSimulated: context.isSandbox,
      }));
  }

  private async listOrders(context: ExchangeProviderContext, params: Record<string, string | number | undefined>, maxItems: number): Promise<any[]> {
    const rows: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES && rows.length < maxItems; page += 1) {
      const data = await this.privateGet(context, '/api/v3/brokerage/orders/historical/batch', { ...params, cursor });
      rows.push(...(Array.isArray(data?.orders) ? data.orders : []));
      if (!data?.has_next || !data?.cursor) break;
      cursor = String(data.cursor);
    }
    return rows.slice(0, maxItems);
  }

  async getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]> {
    const rows = await this.listOrders(context, { order_status: 'OPEN', product_ids: symbol?.toUpperCase(), limit: 100 }, 1000);
    return rows.map((o) => this.mapOrder(context, o));
  }

  async getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeOrder[]> {
    const rows = await this.listOrders(context, { product_ids: symbol?.toUpperCase(), limit: Math.min(limit, 100) }, limit);
    return rows.map((o) => this.mapOrder(context, o));
  }

  async getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit = 50): Promise<ExchangeFill[]> {
    const data = await this.privateGet(context, '/api/v3/brokerage/orders/historical/fills', { product_ids: symbol?.toUpperCase(), limit: Math.min(limit, 100) });
    const fills: any[] = Array.isArray(data?.fills) ? data.fills : [];
    return fills.slice(0, limit).map((f) => {
      const product = String(f?.product_id ?? '');
      return {
        providerTradeId: String(f?.trade_id ?? f?.entry_id),
        providerOrderId: f?.order_id ? String(f.order_id) : null,
        clientOrderId: null,
        symbol: product,
        side: String(f?.side).toUpperCase() === 'SELL' ? ExchangeOrderSide.SELL : ExchangeOrderSide.BUY,
        price: dec(f?.price),
        quantity: dec(f?.size),
        quoteQuantity: f?.size_in_quote === true ? dec(f?.size) : null,
        fee: decOrNull(f?.commission),
        feeCurrency: product.includes('-') ? product.split('-')[1] : null,
        isMaker: f?.liquidity_indicator === 'MAKER' ? true : f?.liquidity_indicator === 'TAKER' ? false : null,
        timestampMicros: isoToMicros(f?.trade_time) ?? nowMicros(),
        isSimulated: context.isSandbox,
      };
    });
  }

  async getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]> {
    const data = await this.privateGet(context, '/api/v3/brokerage/products', { product_type: 'SPOT' });
    const products: any[] = Array.isArray(data?.products) ? data.products : [];
    return products
      .filter((p) => p?.status === 'online' && !p?.trading_disabled && !p?.is_disabled && !p?.cancel_only)
      .map((p) => {
        const tick = String(p?.price_increment ?? p?.quote_increment ?? '0.01');
        const step = String(p?.base_increment ?? '0.00000001');
        return {
          canonicalSymbol: `${p.base_currency_id}-${p.quote_currency_id}`,
          exchangeSymbol: String(p.product_id),
          baseAsset: String(p.base_currency_id),
          quoteAsset: String(p.quote_currency_id),
          contractType: 'SPOT',
          tickSize: tick,
          quantityStep: step,
          minQuantity: decOrNull(p?.base_min_size),
          maxQuantity: decOrNull(p?.base_max_size),
          minNotional: decOrNull(p?.quote_min_size),
          maxNotional: decOrNull(p?.quote_max_size),
          pricePrecision: precisionOfStep(tick),
          quantityPrecision: precisionOfStep(step),
          minLeverage: null,
          maxLeverage: null,
          isTradeable: true,
        };
      });
  }

  private mapOrder(context: ExchangeProviderContext, o: any): ExchangeOrder {
    const config = o?.order_configuration ?? {};
    const variant: any = Object.values(config)[0] ?? {};
    const orderType = String(o?.order_type ?? '');
    let type: ExchangeOrderType;
    if (orderType === 'MARKET') type = ExchangeOrderType.MARKET;
    else if (orderType === 'STOP_LIMIT') type = ExchangeOrderType.STOP_LIMIT;
    else if (orderType === 'STOP') type = ExchangeOrderType.STOP;
    else if (variant?.post_only === true) type = ExchangeOrderType.LIMIT_MAKER;
    else type = ExchangeOrderType.LIMIT;
    const product = String(o?.product_id ?? '');
    return {
      clientOrderId: o?.client_order_id ? String(o.client_order_id) : String(o?.order_id),
      providerOrderId: o?.order_id ? String(o.order_id) : null,
      symbol: product,
      exchangeSymbol: product,
      side: String(o?.side).toUpperCase() === 'SELL' ? ExchangeOrderSide.SELL : ExchangeOrderSide.BUY,
      type,
      status: CoinbaseProvider.mapOrderStatus(String(o?.status ?? ''), dec(o?.filled_size)),
      providerRawStatus: o?.status ? String(o.status) : null,
      quantity: decOrNull(variant?.base_size) ?? decOrNull(variant?.quote_size) ?? dec(o?.filled_size),
      price: decOrNull(variant?.limit_price),
      stopPrice: decOrNull(variant?.stop_price),
      filledQuantity: dec(o?.filled_size),
      averagePrice: isDecimalString(o?.average_filled_price) && !/^0(\.0+)?$/.test(o.average_filled_price) ? o.average_filled_price : null,
      fee: decOrNull(o?.total_fees),
      feeCurrency: product.includes('-') ? product.split('-')[1] : null,
      createdAtMicros: isoToMicros(o?.created_time),
      updatedAtMicros: isoToMicros(o?.last_fill_time) ?? isoToMicros(o?.created_time),
      isSimulated: context.isSandbox,
    };
  }

  static mapOrderStatus(status: string, filled = '0'): ExchangeOrderStatus {
    const executed = !/^0(\.0+)?$/.test(filled);
    switch (status) {
      case 'PENDING':
      case 'QUEUED':
      case 'OPEN':
        return executed ? ExchangeOrderStatus.PARTIALLY_FILLED : ExchangeOrderStatus.NEW;
      case 'FILLED':
        return ExchangeOrderStatus.FILLED;
      case 'CANCELLED':
        return ExchangeOrderStatus.CANCELED;
      case 'CANCEL_QUEUED':
        return ExchangeOrderStatus.PENDING_CANCEL;
      case 'EXPIRED':
        return ExchangeOrderStatus.EXPIRED;
      case 'FAILED':
        return ExchangeOrderStatus.REJECTED;
      default:
        return ExchangeOrderStatus.NEW;
    }
  }
}
