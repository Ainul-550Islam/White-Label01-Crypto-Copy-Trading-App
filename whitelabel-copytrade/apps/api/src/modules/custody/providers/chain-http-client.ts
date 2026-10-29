// # Responsibility: the single audited egress chokepoint for chain RPC calls; allowlist-locked, budgeted, breaker-guarded.
/**
 * Every request the custody chain providers make passes through this client.
 * Guarantees providers cannot individually re-derive cheaply:
 *
 *   - egress allowlist: only hosts on the deployment's allowlist; https only;
 *     redirects are NEVER followed (a redirect to a non-allowlisted host is
 *     indistinguishable from an exfiltration path);
 *   - request budget: hard timeout per attempt; a slow RPC degrades to
 *     unavailable, never to a stalled custody worker;
 *   - payload size cap: a response larger than the agreed cap is a protocol
 *     violation, not a truncated read we pretend succeeded;
 *   - circuit breaker: N consecutive failures open the circuit per endpoint;
 *     while open, calls refuse instantly without piling onto a dead node;
 *   - leak containment: error messages propagated upward carry the method and
 *     endpoint host, never request bodies (which can embed addresses),
 *     headers, or response text from the provider.
 *
 * requestImpl is a test-only seam mirroring node:https.request's shape so
 * surface tests drive deterministic failures; production passes the real one.
 */

import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import type { RequestOptions } from 'node:https';
import type { ClientRequest } from 'node:http';

export class ChainClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChainClientError';
    this.code = code;
  }
}

export class ChainClientUnavailableError extends ChainClientError {
  constructor(message: string) {
    super('CHAIN_UNAVAILABLE', message);
    this.name = 'ChainClientUnavailableError';
  }
}

export class ChainClientProtocolError extends ChainClientError {
  constructor(message: string) {
    super('PROTOCOL_VIOLATION', message);
    this.name = 'ChainClientProtocolError';
  }
}

export interface ChainHttpClientOptions {
  /** Exact, lower-case hostnames the client may call. */
  allowlistedHosts: readonly string[];
  timeoutMs: number;
  maxResponseBytes: number;
  /** Consecutive failures before the per-host circuit opens. */
  breakerThreshold: number;
  /** How long an opened circuit refuses (ms) before the probation attempt. */
  breakerCooldownMs?: number;
  /** Injectable for determinism in specs; defaults to Date.now(). */
  now?: () => number;
  /** Test seam: an injected request implementation (never required in prod). */
  requestImpl?: typeof httpsRequest;
}

interface BreakerState {
  consecutiveFailures: number;
  /** epoch ms until which the circuit refuses instantly; 0 = closed. */
  openUntil: number;
}

export interface ChainHttpResponse<T> {
  status: number;
  body: T;
  host: string;
  latencyMs: number;
}

export class ChainHttpClient {
  private readonly allowlist: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly nowFn: () => number;
  private readonly requestImpl: typeof httpsRequest;
  private readonly breakers = new Map<string, BreakerState>();

  constructor(options: ChainHttpClientOptions) {
    if (options.allowlistedHosts.length === 0) {
      throw new ChainClientError('CONFIG', 'Chain egress allowlist cannot be empty; refusing to build an unbounded client');
    }
    this.allowlist = new Set(
      options.allowlistedHosts.map((host) => {
        const normalised = host.trim().toLowerCase();
        if (!/^[a-z0-9.-]+$/.test(normalised) || normalised.includes('..')) {
          throw new ChainClientError('CONFIG', `Allowlist host ${JSON.stringify(host)} is not a valid bare hostname`);
        }
        return normalised;
      }),
    );
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes;
    this.breakerThreshold = options.breakerThreshold;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 30_000;
    this.nowFn = options.now ?? (() => Date.now());
    this.requestImpl = options.requestImpl ?? httpsRequest;
  }

  /** Process-unique, unpredictable JSON-RPC request id - never derived from request content. */
  nextRequestId(): number {
    return randomBytes(4).readUInt32BE(0);
  }

  isCircuitOpen(endpointUrl: string): boolean {
    const host = this.hostOf(endpointUrl);
    const state = this.breakers.get(host);
    return state !== undefined && state.openUntil > this.nowFn();
  }

  /** JSON-serialisable POST over https; throws the typed client errors. */
  async postJson<T>(endpointUrl: string, body: unknown, label: string): Promise<ChainHttpResponse<T>> {
    const url = this.assertEndpoint(endpointUrl);
    const host = url.host;

    const breaker = this.breakers.get(host);
    if (breaker && breaker.openUntil > this.nowFn()) {
      throw new ChainClientUnavailableError(
        `chain RPC breaker open for host ${host} until ${new Date(breaker.openUntil).toISOString()} (${label})`,
      );
    }

    const startedAt = this.nowFn();
    try {
      const payload = JSON.stringify(body);
      const response = await this.dispatchHttps(url, payload);
      const parsed = JSON.parse(response.body) as T;
      this.markSuccess(host);
      return {
        status: response.status,
        body: parsed,
        host,
        latencyMs: this.nowFn() - startedAt,
      };
    } catch (error) {
      if (error instanceof ChainClientError && error.code === 'PROTOCOL_VIOLATION') {
        // Protocol violations are facts about the upstream, not blast on it:
        // they do not count toward the breaker (a 413-cap answer is honest).
        throw error;
      }
      this.markFailure(host);
      throw error;
    }
  }

  private assertEndpoint(endpointUrl: string): URL {
    let url: URL;
    try {
      url = new URL(endpointUrl);
    } catch {
      throw new ChainClientError('CONFIG', 'chain endpoint is not a valid URL (host not logged: config material)');
    }
    if (url.protocol !== 'https:') {
      throw new ChainClientError('CONFIG', 'chain endpoint must be https: (http:// or other schemes are a refusal)');
    }
    if (url.username !== '' || url.password !== '') {
      throw new ChainClientError('CONFIG', 'chain endpoint must not embed userinfo credentials');
    }
    if (!this.allowlist.has(url.host.toLowerCase())) {
      throw new ChainClientError('CONFIG', `chain endpoint host ${url.host} is not on CUSTODY_CHAIN_HOST_ALLOWLIST`);
    }
    return url;
  }

  private dispatchHttps(url: URL, payload: string): Promise<{ status: number; body: string }> {
    const options: RequestOptions = {
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port === '' ? 443 : Number(url.port),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'user-agent': 'wlct-custody-observer/1.0 (+fail-closed)',
        // No auth headers here: observation RPC is caller-keyless by design.
      },
      agent: false,
      timeout: this.timeoutMs,
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: ChainClientError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      let req: ClientRequest;
      try {
        req = this.requestImpl(options, (res) => {
          const status = res.statusCode ?? 0;
          // Never follow redirects: 3xx on the egress path is a refusal.
          if (status >= 300 && status < 400) {
            fail(
              new ChainClientProtocolError(
                `chain RPC responded with redirect status ${status}; redirects are never followed`,
              ),
            );
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > this.maxResponseBytes) {
              res.destroy();
              fail(
                new ChainClientProtocolError(
                  `chain RPC response exceeded cap of ${this.maxResponseBytes} bytes; aborted`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (settled) {
              return;
            }
            const text = Buffer.concat(chunks).toString('utf8');
            if (status < 200 || status >= 300) {
              fail(new ChainClientError('HTTP_STATUS', `chain RPC answered HTTP ${status}`));
              return;
            }
            settled = true;
            resolve({ status, body: text });
          });
          res.on('error', () => fail(new ChainClientError('TRANSPORT', 'chain RPC aborted mid-response')));
        });
      } catch {
        fail(new ChainClientUnavailableError('chain RPC transport error (initiation)'));
        return;
      }

      req.on('timeout', () => {
        req.destroy();
        fail(new ChainClientUnavailableError(`chain RPC timed out after ${this.timeoutMs}ms`));
      });
      req.on('error', () => fail(new ChainClientUnavailableError('chain RPC transport error')));
      req.write(payload);
      req.end();
    });
  }

  private hostOf(endpointUrl: string): string {
    try {
      return new URL(endpointUrl).host.toLowerCase();
    } catch {
      return 'unknown';
    }
  }

  private markSuccess(host: string): void {
    this.breakers.set(host, { consecutiveFailures: 0, openUntil: 0 });
  }

  private markFailure(host: string): void {
    const previous = this.breakers.get(host) ?? { consecutiveFailures: 0, openUntil: 0 };
    const failures = previous.consecutiveFailures + 1;
    const openUntil = failures >= this.breakerThreshold ? this.nowFn() + this.breakerCooldownMs : 0;
    this.breakers.set(host, { consecutiveFailures: failures, openUntil });
  }
}
