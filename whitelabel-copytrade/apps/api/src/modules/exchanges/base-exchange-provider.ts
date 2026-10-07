// # Shared request signing, timeout, rate-limit, and error normalization helpers
import { Logger } from '@nestjs/common';
import {
  ExchangeVenue,
  ExchangeEnvironment,
  ExchangeCapability,
  ExchangeBalance,
  ExchangePosition,
  ExchangeOrder,
  ExchangeFill,
  ExchangeSymbol,
  ExchangeCapabilityDiscovery,
  ExchangeConnectivityResult,
  ExchangeConnectionState,
} from './exchange.types';
import {
  ExchangeProvider,
  ExchangeProviderError,
  ExchangeProviderErrorCode,
  ExchangeProviderContext,
  ExchangeServerTime,
  ExchangeAccountMetadata,
} from './exchange-provider.interface';

// ---------------------------------------------------------------------------
// Base provider with common HTTP and safety utilities - no secret logging.
//
// Lives in its own module (it used to be private to exchange-provider.factory.ts)
// so that the per-venue providers under ./venues can extend it without an
// import cycle through the factory that registers them.
// ---------------------------------------------------------------------------

export interface ProviderHttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/** Epoch microseconds for "now", as the decimal string every DTO carries. */
export function nowMicros(): string {
  return (BigInt(Date.now()) * 1000n).toString();
}

/** Converts epoch milliseconds (number or numeric string) to an epoch-micros string. */
export function msToMicros(ms: number | string | null | undefined): string | null {
  if (ms === null || ms === undefined || ms === '') return null;
  const text = typeof ms === 'number' ? Math.trunc(ms).toString() : String(ms).trim();
  if (!/^\d+$/.test(text)) return null;
  return (BigInt(text) * 1000n).toString();
}

/** Converts epoch seconds with an optional fraction ("1700000000.1234") to an epoch-micros string. */
export function secondsToMicros(seconds: number | string | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds === '') return null;
  const text = typeof seconds === 'number' ? seconds.toFixed(6) : String(seconds).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const frac = BigInt(((match[2] ?? '') + '000000').slice(0, 6));
  return (whole * 1_000_000n + frac).toString();
}

/** Converts an ISO-8601 timestamp to an epoch-micros string (millisecond resolution). */
export function isoToMicros(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return (BigInt(ms) * 1000n).toString();
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** True when the value is a plain decimal string ("12", "-0.5"); no exponent, no whitespace. */
export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_RE.test(value);
}

function splitDecimal(value: string): { units: bigint; scale: number } {
  const negative = value.startsWith('-');
  const clean = negative ? value.slice(1) : value;
  const [whole, frac = ''] = clean.split('.');
  const units = BigInt(`${whole}${frac}` || '0');
  return { units: negative ? -units : units, scale: frac.length };
}

function joinDecimal(units: bigint, scale: number): string {
  const negative = units < 0n;
  let digits = (negative ? -units : units).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const frac = digits.slice(digits.length - scale).replace(/0+$/, '');
    digits = frac ? `${whole}.${frac}` : whole;
  }
  if (digits === '0') return '0';
  return negative ? `-${digits}` : digits;
}

/**
 * Exact decimal addition over strings. Venue amounts are decimal strings and
 * must stay exact: `parseFloat('0.1') + parseFloat('0.2')` is not 0.3, and a
 * balance total that drifts in the 17th digit is a reconciliation break.
 * A non-decimal operand is a venue payload we do not understand - it throws
 * rather than being treated as zero.
 */
export function addDecimalStrings(...values: string[]): string {
  let scale = 0;
  const parts = values.map((value) => {
    if (!isDecimalString(value)) throw new Error(`not a decimal string: ${JSON.stringify(value)}`);
    const part = splitDecimal(value);
    scale = Math.max(scale, part.scale);
    return part;
  });
  let total = 0n;
  for (const part of parts) total += part.units * 10n ** BigInt(scale - part.scale);
  return joinDecimal(total, scale);
}

/** `a - b` over decimal strings, exact. */
export function subtractDecimalStrings(a: string, b: string): string {
  if (!isDecimalString(b)) throw new Error(`not a decimal string: ${JSON.stringify(b)}`);
  return addDecimalStrings(a, b.startsWith('-') ? b.slice(1) : `-${b}`);
}

/** Absolute value of a decimal string. */
export function absDecimalString(value: string): string {
  if (!isDecimalString(value)) throw new Error(`not a decimal string: ${JSON.stringify(value)}`);
  return value.startsWith('-') ? value.slice(1) : value;
}

/** Sign of a decimal string: -1, 0 or 1. */
export function signOfDecimalString(value: string): -1 | 0 | 1 {
  if (!isDecimalString(value)) throw new Error(`not a decimal string: ${JSON.stringify(value)}`);
  const { units } = splitDecimal(value);
  return units < 0n ? -1 : units > 0n ? 1 : 0;
}

/** Number of fractional digits a step/tick string implies ("0.001" -> 3, "1" -> 0, "1e-8" -> 8). */
export function precisionOfStep(step: string | null | undefined, fallback = 8): number {
  if (!step) return fallback;
  const text = String(step).trim();
  const exp = /^\d+(?:\.\d+)?e-(\d+)$/i.exec(text);
  if (exp) return Number(exp[1]);
  if (!isDecimalString(text)) return fallback;
  const frac = text.split('.')[1];
  if (!frac) return 0;
  const trimmed = frac.replace(/0+$/, '');
  return trimmed.length;
}

/**
 * Quote assets recognised when a venue reports a concatenated symbol
 * ("BTCUSDT"), longest first so "USDT" wins over "USD". A symbol with no
 * recognised quote is returned unchanged rather than split at a guess.
 */
const KNOWN_QUOTES = ['FDUSD', 'USDT', 'USDC', 'USDE', 'TUSD', 'BUSD', 'EUR', 'USD', 'GBP', 'TRY', 'BRL', 'JPY', 'AUD', 'BTC', 'ETH', 'DAI', 'BNB', 'SOL'];

export function canonicalFromConcatenated(exchangeSymbol: string): string {
  const upper = String(exchangeSymbol || '').toUpperCase();
  for (const quote of KNOWN_QUOTES) {
    if (upper.length > quote.length && upper.endsWith(quote)) {
      return `${upper.slice(0, upper.length - quote.length)}-${quote}`;
    }
  }
  return upper;
}

export abstract class BaseExchangeProvider implements ExchangeProvider {
  abstract readonly venue: ExchangeVenue;
  abstract readonly displayName: string;
  abstract readonly supportedEnvironments: ExchangeEnvironment[];
  abstract readonly supportedCapabilities: ExchangeCapability[];

  protected readonly logger = new Logger(this.constructor.name);

  protected getRestBaseUrlForEnv(environment: ExchangeEnvironment): string {
    switch (environment) {
      case ExchangeEnvironment.LIVE:
        return this.getLiveRestUrl();
      case ExchangeEnvironment.TESTNET:
        return this.getTestnetRestUrl();
      case ExchangeEnvironment.SANDBOX:
        return this.getSandboxRestUrl();
      default:
        return this.getLiveRestUrl();
    }
  }

  protected abstract getLiveRestUrl(): string;
  protected abstract getTestnetRestUrl(): string;
  protected abstract getSandboxRestUrl(): string;
  protected abstract getLiveWsUrl(): string;
  protected abstract getTestnetWsUrl(): string;
  protected abstract getSandboxWsUrl(): string;

  validateEnvironmentBinding(environment: ExchangeEnvironment, isSandbox: boolean): boolean {
    if (environment === ExchangeEnvironment.LIVE && isSandbox) return false;
    if ((environment === ExchangeEnvironment.TESTNET || environment === ExchangeEnvironment.SANDBOX) && !isSandbox) return false;
    return this.supportedEnvironments.includes(environment);
  }

  getRestBaseUrl(environment: ExchangeEnvironment): string {
    return this.getRestBaseUrlForEnv(environment);
  }

  getWebsocketBaseUrl(environment: ExchangeEnvironment): string {
    switch (environment) {
      case ExchangeEnvironment.LIVE:
        return this.getLiveWsUrl();
      case ExchangeEnvironment.TESTNET:
        return this.getTestnetWsUrl();
      case ExchangeEnvironment.SANDBOX:
        return this.getSandboxWsUrl();
      default:
        return this.getLiveWsUrl();
    }
  }

  protected async httpGet(url: string, headers: Record<string, string> = {}, timeoutMs = 5000): Promise<any> {
    return this.httpRequest({ method: 'GET', url, headers, timeoutMs });
  }

  /**
   * One HTTP exchange with a hard timeout. A non-2xx answer throws an Error
   * carrying `status`, `headers` and the parsed `data`, which is exactly the
   * shape {@link normalizeError} classifies. Nothing about the request
   * (headers carry signatures and keys) is ever put on the error message.
   */
  protected async httpRequest(request: ProviderHttpRequest): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 5000);
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.headers ?? {},
        body: request.body,
        signal: controller.signal,
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.headers = Object.fromEntries(res.headers.entries());
        err.data = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Throws AUTH_FAILED when the context carries no key material at all. */
  protected requireCredentials(context: ExchangeProviderContext, needPassphrase = false): void {
    if (!context.credentials?.apiKey || !context.credentials?.apiSecret) {
      throw new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, 'Missing credentials', context.venue, context.environment, false);
    }
    if (needPassphrase && !context.credentials.passphrase) {
      throw new ExchangeProviderError(
        ExchangeProviderErrorCode.INVALID_CREDENTIALS,
        `${this.venue} requires an API passphrase in addition to key and secret`,
        context.venue,
        context.environment,
        false,
      );
    }
  }

  protected normalizeError(e: any, venue: ExchangeVenue, environment: ExchangeEnvironment): ExchangeProviderError {
    if (e instanceof ExchangeProviderError) return e;
    const status = e.status || 0;
    const msg = (e.message || '').toLowerCase();
    const data = e.data;

    if (status === 401 || status === 403 || msg.includes('api key') || msg.includes('signature') || msg.includes('auth') || (data && (data.code === -2015 || data.code === -2014))) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.AUTH_FAILED, `Authentication failed for ${venue}`, venue, environment, false, null, e);
    }
    if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || (data && data.code === -1003)) {
      const retryAfter = e.headers?.['retry-after'] ? parseInt(e.headers['retry-after'], 10) * 1000 : 1000;
      return new ExchangeProviderError(ExchangeProviderErrorCode.RATE_LIMITED, `Rate limited for ${venue}`, venue, environment, true, retryAfter, e);
    }
    if (msg.includes('timeout') || msg.includes('aborted') || status === 504) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.TIMEOUT, `Timeout for ${venue}`, venue, environment, true, 1000, e);
    }
    if (status >= 500) {
      return new ExchangeProviderError(ExchangeProviderErrorCode.SERVER_ERROR, `Server error for ${venue}: ${status}`, venue, environment, true, 1000, e);
    }
    return new ExchangeProviderError(ExchangeProviderErrorCode.UNKNOWN, e.message || `Unknown error for ${venue}`, venue, environment, false, null, e);
  }

  /**
   * The shared connectivity proof for venues that expose key permissions:
   * server time (clock drift), one authenticated read (the key works), and a
   * refusal when the key can withdraw - the platform never accepts a key that
   * could move funds off the venue, whatever else it can do.
   */
  protected async connectivityFromMetadata(context: ExchangeProviderContext): Promise<ExchangeConnectivityResult> {
    const start = Date.now();
    try {
      const serverTime = await this.getServerTime(context);
      const metadata = await this.getAccountMetadata(context);
      if (metadata.canWithdraw) {
        throw new ExchangeProviderError(ExchangeProviderErrorCode.WITHDRAWAL_NOT_ALLOWED, 'Withdrawal permission detected', context.venue, context.environment, false);
      }
      return {
        connected: true,
        degraded: !metadata.canTrade,
        state: metadata.canTrade ? ExchangeConnectionState.CONNECTED : ExchangeConnectionState.DEGRADED,
        latencyMs: Date.now() - start,
        serverTimeMicros: serverTime.serverTimeMicros,
        clockDriftMs: serverTime.driftMs,
        capabilities: this.supportedCapabilities,
        failureCode: null,
        failureReason: metadata.canTrade ? null : 'API key is read-only: balances and history sync, order placement will be refused by the venue',
        isSimulated: context.isSandbox,
        environment: context.environment,
      };
    } catch (e: any) {
      throw this.normalizeError(e, context.venue, context.environment);
    }
  }

  protected serverTimeFromMs(serverTimeMs: number): ExchangeServerTime {
    const localMs = Date.now();
    return {
      serverTimeMicros: (BigInt(Math.trunc(serverTimeMs)) * 1000n).toString(),
      localTimeMicros: (BigInt(localMs) * 1000n).toString(),
      driftMs: localMs - Math.trunc(serverTimeMs),
    };
  }

  abstract testConnectivity(context: ExchangeProviderContext): Promise<any>;
  abstract getServerTime(context: ExchangeProviderContext): Promise<ExchangeServerTime>;
  abstract getAccountMetadata(context: ExchangeProviderContext): Promise<ExchangeAccountMetadata>;
  abstract getCapabilities(context: ExchangeProviderContext): Promise<ExchangeCapabilityDiscovery>;
  abstract getBalances(context: ExchangeProviderContext): Promise<ExchangeBalance[]>;
  abstract getPositions(context: ExchangeProviderContext): Promise<ExchangePosition[]>;
  abstract getOpenOrders(context: ExchangeProviderContext, symbol?: string): Promise<ExchangeOrder[]>;
  abstract getOrderHistory(context: ExchangeProviderContext, symbol?: string, limit?: number): Promise<ExchangeOrder[]>;
  abstract getTradeHistory(context: ExchangeProviderContext, symbol?: string, limit?: number): Promise<ExchangeFill[]>;
  abstract getSymbols(context: ExchangeProviderContext): Promise<ExchangeSymbol[]>;
}
