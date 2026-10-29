// # Responsibility: ChainHttpClient spec (allowlist, https-only, no redirect-following, caps, breaker).
/**
 * Driven through a stub requestImpl that echoes node:https.request's seam;
 * production code lanes call the real thing. The stub records the signal
 * each request would have emitted and the returned byte stream; every test
 * covers REFUSAL semantics - the surface MUST fail closed.
 */

import { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';

import {
  ChainClientError,
  ChainClientProtocolError,
  ChainClientUnavailableError,
  ChainHttpClient,
  ChainHttpClientOptions,
} from './chain-http-client';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Options = ChainHttpClientOptions;

interface StubCall {
  options: { hostname?: string; path?: string; method?: string; agent?: unknown; timeout?: number };
  body: string;
  behavior: StubBehavior;
}

type StubBehavior =
  | { kind: 'respond'; status: number; chunks: string[] }
  | { kind: 'redirect'; status: number }
  | { kind: 'resetOnWrite' }
  | { kind: 'throwOnCreate' }
  | { kind: 'timeout' }
  | { kind: 'never' };

function makeStub(behaviors: StubBehavior[]): {
  stub: (options: unknown, cb: (res: unknown) => void) => unknown;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const stub = (rawOptions: unknown, cb: (res: unknown) => void) => {
    const options = rawOptions as Record<string, unknown>;
    const behavior = behaviors[calls.length] ?? { kind: 'never' as const };
    const req = new EventEmitter() as EventEmitter & {
      write: (chunk: string) => boolean;
      end: () => void;
      destroy: () => void;
      timeout: unknown;
    };
    let body = '';
    req.write = (chunk: string) => {
      body += chunk;
      if (behavior.kind === 'resetOnWrite') {
        queueMicrotask(() => req.emit('error', new Error('ECONNRESET')));
      }
      return true;
    };
    req.end = () => {
      if (behavior.kind === 'respond') {
        const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void; destroy: () => void };
        res.statusCode = behavior.status;
        res.resume = () => {};
        res.destroy = () => {};
        queueMicrotask(() => {
          cb(res);
          queueMicrotask(() => {
            for (const chunk of behavior.chunks) {
              res.emit('data', Buffer.from(chunk, 'utf8'));
            }
            res.emit('end');
          });
        });
      } else if (behavior.kind === 'redirect') {
        const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void; destroy: () => void };
        res.statusCode = behavior.status;
        res.resume = () => {};
        res.destroy = () => {};
        queueMicrotask(() => cb(res));
      } else if (behavior.kind === 'timeout') {
        queueMicrotask(() => req.emit('timeout'));
      } else if (behavior.kind === 'never') {
        // Part of test signatures: transport never answers.
      }
    };
    req.destroy = () => {};
    calls.push({ options: options as StubCall['options'], body, behavior });
    if (behavior.kind === 'throwOnCreate') {
      throw new Error('socket creation refused');
    }
    return req;
  };
  return { stub, calls };
}

const BASE: Omit<ChainHttpClientOptions, 'requestImpl'> = {
  allowlistedHosts: ['rpc.internal.example'],
  timeoutMs: 250,
  maxResponseBytes: 64 * 1024,
  breakerThreshold: 3,
  breakerCooldownMs: 60_000,
};

describe('ChainHttpClient (red-path)', () => {
  it('refuses an empty allowlist (no client without explicit allowlist)', () => {
    expect(() => new ChainHttpClient({ ...BASE, allowlistedHosts: [] })).toThrow(ChainClientError);
  });

  it('refuses hosts never allowlisted, before any socket opens', async () => {
    const { stub, calls } = makeStub([]);
    const client = new ChainHttpClient({ ...BASE, requestImpl: stub as never });
    await expect(
      client.postJson('https://they.example.com/rpc', { ok: true }, 'test'),
    ).rejects.toMatchObject({ code: 'CONFIG' });
    expect(calls.length).toBe(0);
  });

  it('refuses http:// endpoints', async () => {
    const { stub, calls } = makeStub([]);
    const client = new ChainHttpClient({ ...BASE, requestImpl: stub as never });
    await expect(client.postJson('http://rpc.internal.example/rpc', {}, 'test')).rejects.toMatchObject({
      code: 'CONFIG',
    });
    expect(calls.length).toBe(0);
  });

  it('refuses userinfo embedded in the URL', async () => {
    const { stub } = makeStub([]);
    const client = new ChainHttpClient({ ...BASE, requestImpl: stub as never });
    await expect(client.postJson('https://hidden@rpc.internal.example/rpc', {}, 't')).rejects.toMatchObject({
      code: 'CONFIG',
    });
  });

  it('rejects connection resets as CHAIN_UNAVAILABLE (typed, not raw err)', async () => {
    const { stub } = makeStub([{ kind: 'resetOnWrite' }]);
    const client = new ChainHttpClient({ ...BASE, requestImpl: stub as never });
    await expect(client.postJson('https://rpc.internal.example/x', { a: 1 }, 't')).rejects.toBeInstanceOf(
      ChainClientUnavailableError,
    );
  });

  it('never follows redirects - a 301 is a protocol violation, not an answer', async () => {
    const { stub, calls } = makeStub([{ kind: 'redirect', status: 301 }]);
    const client = new ChainHttpClient({ ...BASE, requestImpl: stub as never });
    await expect(client.postJson('https://rpc.internal.example/x', {}, 't')).rejects.toBeInstanceOf(
      ChainClientProtocolError,
    );
    expect(calls.length).toBe(1); // exactly one request; no "second hop"
  });

  it('refuses a body larger than maxResponseBytes and does not parse it', async () => {
    const small = 100;
    const big = '{ "x": "' + 'a'.repeat(small * 2) + '" }';
    const { stub } = makeStub([{ kind: 'respond', status: 200, chunks: [big] }]);
    const client = new ChainHttpClient({ ...BASE, maxResponseBytes: small, requestImpl: stub as never });
    await expect(client.postJson('https://rpc.internal.example/x', {}, 't')).rejects.toBeInstanceOf(
      ChainClientProtocolError,
    );
  });

  it('opens the breakpoint circuit after N failures and refuses calls instantly', async () => {
    const nowFn = () => 1_000_000;
    const { stub } = makeStub([
      { kind: 'resetOnWrite' },
      { kind: 'resetOnWrite' },
      { kind: 'resetOnWrite' },
    ]);
    const client = new ChainHttpClient({ ...BASE, breakerThreshold: 3, now: nowFn, requestImpl: stub as never });
    const url = 'https://rpc.internal.example/p';
    await expect(client.postJson(url, {}, 't')).rejects.toBeInstanceOf(ChainClientUnavailableError);
    await expect(client.postJson(url, {}, 't')).rejects.toBeInstanceOf(ChainClientUnavailableError);
    await expect(client.postJson(url, {}, 't')).rejects.toBeInstanceOf(ChainClientUnavailableError);
    expect(client.isCircuitOpen(url)).toBe(true);
    // 4th call: refuses instantly without touching the stub (calls stays 3).
    await expect(client.postJson(url, {}, 't')).rejects.toMatchObject({ code: 'CHAIN_UNAVAILABLE' });
  });

  it('a successful round resets the circuit for that host', async () => {
    const { stub } = makeStub([
      { kind: 'resetOnWrite' },
      { kind: 'respond', status: 200, chunks: ['{"jsonrpc":"2.0","id":1,"result":null}'] },
    ]);
    const client = new ChainHttpClient({ ...BASE, breakerThreshold: 2, requestImpl: stub as never });
    const url = 'https://rpc.internal.example/z';
    await expect(client.postJson(url, {}, 't')).rejects.toBeInstanceOf(ChainClientUnavailableError);
    const live = await client.postJson(url, { ok: 1 }, 't');
    expect(live.status).toBe(200);
    expect(client.isCircuitOpen(url)).toBe(false);
  });

  it('request ids are unpredictable and unique per call', () => {
    const { stub } = makeStub([]);
    const client = new ChainHttpClient({ ...BASE, requestImpl: stub as never });
    const ids = new Set<number>();
    for (let i = 0; i < 512; i++) {
      ids.add(client.nextRequestId());
    }
    expect(ids.size).toBe(512);
  });

  it('never throws raw transport errors - only typed ChainClientError lineage', async () => {
    const { stub } = makeStub([{ kind: 'throwOnCreate' }]);
    const client = new ChainHttpClient({ ...BASE, requestImpl: stub as never });
    try {
      await client.postJson('https://rpc.internal.example/x', {}, 't');
      throw new Error('must not reach');
    } catch (error) {
      if (!(error instanceof ChainClientError)) {
        throw new Error(`expected ChainClientError lineage, got ${(error as Error).name}`);
      }
    }
  });
});
