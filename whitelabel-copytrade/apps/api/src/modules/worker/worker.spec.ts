/**
 * Part 11 worker-plane specs: admission, deferral, forwarding, ack policy.
 *
 * The Redis under these tests is a faithful claim SERVER (SET NX with real
 * expiry semantics, the EXACT shipped Lua scripts matched by identity and
 * interpreted as their text says), and the engine under these tests is the
 * real EngineInternalClient over a mocked fetch returning real Response
 * objects. What is fake is only the network - never the decision logic:
 * the partition math, claim protocol, payload validation, defer accounting
 * and error taxonomy all run their shipped code.
 */

import { JOB_NAMES } from '@wlct/config';

import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';

import type { AppConfigService } from '../../config/app-config.service';
import { CLAIM_RELEASE_SCRIPT, CLAIM_RENEW_SCRIPT, membershipRegistryKey } from '../../infrastructure/coordination/lease';
import {
  MEMBERSHIP_PING_SCRIPT,
  MEMBERSHIP_RESIGN_SCRIPT,
  MEMBERSHIP_SNAPSHOT_SCRIPT,
} from '../../infrastructure/coordination/membership';
import { partitionOwner } from '../../infrastructure/coordination/partitions';
import type { RedisService } from '../../infrastructure/redis/redis.service';
import type { TracingService } from '../../infrastructure/tracing/tracing.service';
import { EngineInternalClient } from './engine-internal.client';
import { TradeExecutionProcessor } from './trade-execution.processor';
import { WorkerCoordinationService } from './worker-coordination.service';
import { createMetricsRegistry } from '../observability/metrics.registry.provider';

// --- the claim server --------------------------------------------------------

interface ExpiryRow {
  value: string;
  expiresAtMs: number;
}

/**
 * The fake speaks IOREDIS, not the coordination port: the production
 * IoredisCoordinationClient sits in between, so these tests exercise the
 * adapter too (argument order in SET, the eval key-count, the 'OK' vs null
 * reply). A fake at the port level would silently bless an adapter that
 * could not talk to a real server.
 */
class FakeCoordServer {
  readonly rows = new Map<string, ExpiryRow>();
  /** Part 12: the membership zsets, one per registry key, member ->
   * expiry-millis. Interpreted by script TEXT identity like the claim
   * scripts - the fake implements what the shipped Lua SAYS, including
   * the GT law and the read-only snapshot, so a rewritten script that
   * changes semantics falls off the face of this fake loudly. */
  readonly zsets = new Map<string, Map<string, number>>();
  /** Armed by the fallback tests: membership scripts fail while claim
   * scripts keep working - precisely the topology of "Redis is up but the
   * registry read is not", which the mode design must survive. */
  membershipBoom = false;
  evalCalls = 0;

  private nowMs(): number {
    return Date.now();
  }

  private flatZset(entries: Map<string, number>): unknown[] {
    const out: unknown[] = [];
    for (const [member, expiry] of entries) {
      out.push(member);
      out.push(String(expiry));
    }
    return out;
  }

  /** SET name value PX <ms> NX -> 'OK' | null, exactly as ioredis replies. */
  async set(...args: unknown[]): Promise<'OK' | null> {
    const [name, value, pxToken, px, nxToken] = args as [
      string,
      string,
      string,
      number,
      string,
    ];
    if (pxToken !== 'PX' || nxToken !== 'NX') {
      throw new Error(`fake redis only speaks SET name value PX ms NX, got ${JSON.stringify(args)}`);
    }
    const existing = this.rows.get(name);
    if (existing !== undefined && existing.expiresAtMs > this.nowMs()) {
      return null;
    }
    this.rows.set(name, { value, expiresAtMs: this.nowMs() + px });
    return 'OK';
  }

  async get(name: string): Promise<string | null> {
    const existing = this.rows.get(name);
    if (existing === undefined) {
      return null;
    }
    if (existing.expiresAtMs <= this.nowMs()) {
      this.rows.delete(name);
      return null;
    }
    return existing.value;
  }

  /** EVAL script numKeys key ...argv. numKeys is pinned to 1 (the adapter
   * hardcodes it); the two scripts the coordinator may run are matched by
   * exact text identity - anything else is a shipped-code bug and must
   * explode LOUDLY here, not quietly return a plausible number. */
  async eval(
    script: string,
    numKeys: number,
    key: string,
    ...argv: string[]
  ): Promise<number | unknown[]> {
    this.evalCalls += 1;
    if (numKeys !== 1) {
      throw new Error(`coordination scripts take exactly one key, got ${numKeys}`);
    }
    if (
      script === MEMBERSHIP_PING_SCRIPT ||
      script === MEMBERSHIP_SNAPSHOT_SCRIPT ||
      script === MEMBERSHIP_RESIGN_SCRIPT
    ) {
      if (this.membershipBoom) {
        throw new Error('registry unavailable');
      }
      if (script === MEMBERSHIP_PING_SCRIPT) {
        const now = Number(argv[0]);
        const expiry = Number(argv[1]);
        const member = argv[2];
        let entries = this.zsets.get(key);
        if (entries === undefined) {
          entries = new Map<string, number>();
          this.zsets.set(key, entries);
        }
        for (const [name, score] of entries) {
          if (score <= now) {
            entries.delete(name);
          }
        }
        const current = entries.get(member);
        if (current === undefined || expiry > current) {
          entries.set(member, expiry);
        }
        return this.flatZset(entries);
      }
      if (script === MEMBERSHIP_SNAPSHOT_SCRIPT) {
        const entries = this.zsets.get(key);
        if (entries === undefined || entries.size === 0) {
          return [];
        }
        return this.flatZset(entries);
      }
      const entries = this.zsets.get(key);
      if (entries === undefined) {
        return 0;
      }
      entries.delete(argv[0]);
      return entries.size;
    }
    const row = this.rows.get(key);
    const alive = row !== undefined && row.expiresAtMs > this.nowMs();
    if (script === CLAIM_RENEW_SCRIPT) {
      const [member, ttlRaw] = argv;
      if (alive && row !== undefined && row.value === member) {
        row.expiresAtMs = this.nowMs() + Number(ttlRaw);
        return 1;
      }
      return 0;
    }
    if (script === CLAIM_RELEASE_SCRIPT) {
      const [member] = argv;
      if (alive && row !== undefined && row.value === member) {
        this.rows.delete(key);
        return 1;
      }
      return 0;
    }
    throw new Error('unknown script reached the coordination server fake');
  }
}

// --- harness ----------------------------------------------------------------

type CfgOverrides = Partial<Record<string, unknown>>;

function fakeConfig(overrides: CfgOverrides = {}): AppConfigService {
  const base: Record<string, unknown> = {
    workerId: 'worker-alpha',
    workerMembership: ['worker-alpha'],
    workerMembershipMode: 'config',
    workerMembershipTtlMs: 10_000,
    workerPartitionCount: 8,
    workerPartitionLeaseTtlMs: 15_000,
    workerPartitionRetryMs: 250,
    workerDeferDelayMs: 2_000,
    workerMaxDefers: 3,
    executionEngineUrl: 'http://engine.test:8093',
    executionEngineToken: 'eng-tok-'.padEnd(40, 'x'),
    ...overrides,
  };
  return base as unknown as AppConfigService;
}

const quietLogger = () =>
  ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }) as never;

function makeCoordination(
  server: FakeCoordServer,
  overrides: CfgOverrides = {},
  metrics?: ReturnType<typeof createMetricsRegistry>,
): WorkerCoordinationService {
  const redis = { duplicate: () => server } as unknown as RedisService;
  return new WorkerCoordinationService(fakeConfig(overrides), redis, quietLogger(), metrics);
}

interface FakeJobSpec {
  name: string;
  data: unknown;
  id?: string;
  progress?: unknown;
}

function makeJob(spec: FakeJobSpec): {
  job: Job;
  delayed: number[];
  progresses: unknown[];
} {
  const delayed: number[] = [];
  const progresses: unknown[] = [];
  const job = {
    id: spec.id ?? 'job-1',
    name: spec.name,
    data: spec.data,
    attemptsMade: 0,
    progress: spec.progress ?? 0,
    updateProgress: jest.fn(async (value: unknown) => {
      progresses.push(value);
    }),
    moveToDelayed: jest.fn(async (when: number) => {
      delayed.push(when - Date.now());
    }),
  };
  return { job: job as unknown as Job, delayed, progresses };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'eng-corr-9' },
  });
}

const VERIFY_BODY = {
  tenantId: 'tenant-a',
  accountId: 'acct-1',
  requestedByUserId: 'user-1',
  requestedAt: '2026-09-13T00:00:00.000Z',
};

// --- coordination -------------------------------------------------------------

describe('WorkerCoordinationService', () => {
  it('a lone worker claims its whole partition table', async () => {
    const server = new FakeCoordServer();
    const coordination = makeCoordination(server);
    await coordination.tick();
    const snapshot = coordination.snapshot();
    expect(snapshot.heldPartitions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(snapshot.snapshotStale).toBe(false);
    expect(coordination.holds(3)).toBe(true);
    for (let partition = 0; partition < 8; partition += 1) {
      expect(await server.get(`wlct:trading:lock:partition:trade-execution:${partition}`)).toBe(
        'worker-alpha',
      );
    }
    await coordination.onModuleDestroy();
  });

  it('a two-member fleet splits the table with no overlap and full cover', async () => {
    const server = new FakeCoordServer();
    const members = ['worker-alpha', 'worker-beta'];
    const alpha = makeCoordination(server, { workerMembership: members });
    const beta = makeCoordination(server, {
      workerId: 'worker-beta',
      workerMembership: members,
    });
    await alpha.tick();
    await beta.tick();
    const heldAlpha = new Set(alpha.snapshot().heldPartitions);
    const heldBeta = new Set(beta.snapshot().heldPartitions);
    for (let partition = 0; partition < 8; partition += 1) {
      const owner = partitionOwner(members, partition);
      if (owner === 'worker-alpha') {
        expect(heldAlpha.has(partition)).toBe(true);
        expect(heldBeta.has(partition)).toBe(false);
      } else {
        expect(heldBeta.has(partition)).toBe(true);
        expect(heldAlpha.has(partition)).toBe(false);
      }
    }
    expect(heldAlpha.size + heldBeta.size).toBe(8);
    await alpha.onModuleDestroy();
    await beta.onModuleDestroy();
  });

  it('graceful stop releases every held claim', async () => {
    const server = new FakeCoordServer();
    const coordination = makeCoordination(server);
    await coordination.tick();
    expect(coordination.holds(0)).toBe(true);
    await coordination.onModuleDestroy();
    expect(await server.get('wlct:trading:lock:partition:trade-execution:0')).toBeNull();
    expect(coordination.holds(0)).toBe(false);
  });

  it('a worker absent from membership holds nothing (and staleness is visible)', async () => {
    const server = new FakeCoordServer();
    const outsider = makeCoordination(server, {
      workerId: 'worker-stray',
      workerMembership: ['worker-alpha'],
    });
    await outsider.tick();
    expect(outsider.snapshot().heldPartitions).toEqual([]);
    expect(outsider.holds(0)).toBe(false);
    // never successfully reconciled a single partition: the snapshot flags
    // itself stale from t=0, and that flag is what the processor's verdict
    // rides on.
    await outsider.onModuleDestroy();
  });

  it('a transport failure turns claims into misses - jobs defer, no eviction drama', async () => {
    const server = new FakeCoordServer();
    const coordination = makeCoordination(server);
    await coordination.tick();
    expect(coordination.holds(1)).toBe(true);
    // PartitionClaims swallows transport errors into `false` by design (the
    // Python side does the same), so a Redis blip below this service does
    // NOT throw upward - it reports the claims as failed. The held set
    // shrinks to what could not be re-asserted, which is exactly the
    // deferral trigger: fail closed, loudly counted nowhere new.
    server.set = async () => {
      throw new Error('transport down');
    };
    server.eval = async () => {
      throw new Error('transport down');
    };
    await coordination.tick();
    expect(coordination.snapshot().heldPartitions).toEqual([]);
    expect(coordination.holds(1)).toBe(false);
    expect(coordination.snapshot().snapshotStale).toBe(false); // the tick itself succeeded
    await coordination.onModuleDestroy();
  });

  it('a reconcile that cannot even run keeps the last verdict until it AGES past trust', async () => {
    const server = new FakeCoordServer();
    const coordination = makeCoordination(server, { workerPartitionRetryMs: 250 });
    await coordination.tick();
    expect(coordination.holds(1)).toBe(true);
    // Break the input ABOVE the claims layer: an unreadable membership
    // throws inside reconcile() before any Redis answer could rewrite the
    // held set. The service keeps its last verdict (the claims are almost
    // certainly still valid), counts the failure, and lets the verdict AGE.
    const config = (coordination as unknown as { config: Record<string, unknown> }).config;
    Object.defineProperty(config, 'workerMembership', {
      get() {
        throw new Error('membership source exploded');
      },
      configurable: true,
    });
    await coordination.tick();
    expect(coordination.snapshot().reconcileFailures).toBe(1);
    expect(coordination.holds(1)).toBe(true); // fresh: trust the last truth
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(coordination.holds(1)).toBe(false); // aged past 2x tick: fail closed
    expect(coordination.snapshot().snapshotStale).toBe(true);
    await coordination.onModuleDestroy();
  });

  it('the worker metric families count deferrals and claim transitions', async () => {
    const server = new FakeCoordServer();
    const registry = createMetricsRegistry();
    const coordination = makeCoordination(server, {}, registry);
    await coordination.tick();
    coordination.noteDeferral();
    coordination.noteDeferral();
    const rendered = registry.render();
    expect(rendered).toContain('wlct_worker_deferred_jobs_total{queue="trade-execution",service="api"} 2');
    expect(rendered).toContain('wlct_worker_coordination_events_total{result="claim_gained",service="api"} 8');
    await coordination.onModuleDestroy();
    expect(registry.render()).toContain('wlct_worker_coordination_events_total{result="released",service="api"} 8');
  });
});

// --- Part 12: registry-sourced membership -----------------------------------

describe('WorkerCoordinationService (registry membership)', () => {
  const REG_KEY = membershipRegistryKey('trade-execution');

  beforeEach(() => {
    // Faked clock, never advanced with advanceTimers: jest.setSystemTime
    // moves Date.now WITHOUT firing the service's fake setInterval, so
    // every tick in these tests is the one the test itself awaited.
    jest.useFakeTimers({ now: 1_700_000_000_000 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a registry ping registers the worker with expiry = now + ttl', async () => {
    const server = new FakeCoordServer();
    const alpha = makeCoordination(server, { workerMembershipMode: 'registry' });
    await alpha.tick();
    const snapshot = alpha.snapshot();
    expect(snapshot.membershipSource).toBe('registry');
    expect(snapshot.heldPartitions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const entries = server.zsets.get(REG_KEY);
    expect(entries).toBeDefined();
    expect([...(entries?.keys() ?? [])]).toEqual(['worker-alpha']);
    expect(entries?.get('worker-alpha')).toBe(1_700_000_000_000 + 10_000);
    await alpha.onModuleDestroy();
  });

  it('workers with DIFFERENT config lists still split - the registry reconciles them', async () => {
    // The flagship claim of self-registration: no coordinated membership
    // edit. Each worker boots believing IT is the whole fleet (its config
    // fallback), and within two ticks the shared registry has them split.
    const server = new FakeCoordServer();
    const alpha = makeCoordination(server, {
      workerMembershipMode: 'registry',
      workerMembership: ['worker-alpha'],
    });
    const beta = makeCoordination(server, {
      workerMembershipMode: 'registry',
      workerId: 'worker-beta',
      workerMembership: ['worker-beta'],
    });
    for (let round = 0; round < 2; round += 1) {
      await alpha.tick();
      await beta.tick();
    }
    const members = ['worker-alpha', 'worker-beta'];
    const heldAlpha = new Set(alpha.snapshot().heldPartitions);
    const heldBeta = new Set(beta.snapshot().heldPartitions);
    for (let partition = 0; partition < 8; partition += 1) {
      const owner = partitionOwner(members, partition);
      expect(heldAlpha.has(partition)).toBe(owner === 'worker-alpha');
      expect(heldBeta.has(partition)).toBe(owner === 'worker-beta');
    }
    expect(heldAlpha.size + heldBeta.size).toBe(8);
    await alpha.onModuleDestroy();
    await beta.onModuleDestroy();
  });

  it('a silent peer ages out of membership but NOT out of its live claims', async () => {
    const server = new FakeCoordServer();
    const alpha = makeCoordination(server, {
      workerMembershipMode: 'registry',
      workerMembership: ['worker-alpha', 'worker-beta'],
    });
    const beta = makeCoordination(server, {
      workerMembershipMode: 'registry',
      workerId: 'worker-beta',
      workerMembership: ['worker-alpha', 'worker-beta'],
    });
    for (let round = 0; round < 2; round += 1) {
      await alpha.tick();
      await beta.tick();
    }
    const members = ['worker-alpha', 'worker-beta'];
    const betaPartitions = [...Array(8).keys()].filter(
      (p) => partitionOwner(members, p) === 'worker-beta',
    );
    expect(betaPartitions.length).toBeGreaterThan(0);
    const heldBefore = [...alpha.snapshot().heldPartitions];

    // Past the membership TTL (10s), still inside the claim TTL (15s):
    // the registry no longer lists beta, so alpha WANTS beta's partitions -
    // but the claims are the authority and beta's are alive. Alpha holds
    // exactly what it held: wanting is not having.
    jest.setSystemTime(1_700_000_011_000);
    await alpha.tick();
    expect([...alpha.snapshot().membership]).toEqual(['worker-alpha']);
    expect([...alpha.snapshot().heldPartitions]).toEqual(heldBefore);
    for (const partition of betaPartitions) {
      expect(
        await server.get(`wlct:trading:lock:partition:trade-execution:${partition}`),
      ).toBe('worker-beta');
    }

    // Past the claim TTL too, the steals succeed and the table converges.
    jest.setSystemTime(1_700_000_016_000);
    await alpha.tick();
    expect(alpha.snapshot().heldPartitions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    await alpha.onModuleDestroy();
    // beta never resurfaces; its destroy path must tolerate the dead zset.
    await beta.onModuleDestroy();
  });

  it('registry outage falls back (counted), first to last-known then to config', async () => {
    const server = new FakeCoordServer();
    const registry = createMetricsRegistry();
    // Armed BEFORE construction: the fake answers synchronously, so a
    // service whose first tick must see the outage is built into the outage.
    server.membershipBoom = true;
    const alpha = makeCoordination(
      server,
      {
        workerMembershipMode: 'registry',
        workerMembership: ['worker-alpha', 'worker-ghost'],
      },
      registry,
    );
    // No successful ping yet: the fallback IS the config list, so alpha
    // claims its half of a two-member table (the ghost simply never
    // claims anything - Part 11 semantics, preserved as fallback).
    await alpha.tick();
    expect(registry.render()).toContain(
      'wlct_worker_coordination_events_total{result="membership_fallback",service="api"} 1',
    );
    const halfOnConfig = [...alpha.snapshot().heldPartitions];
    expect(halfOnConfig.length).toBeLessThan(8);
    expect([...alpha.snapshot().membership]).toEqual(['worker-alpha', 'worker-ghost']);

    // Registry recovers: the live set (alpha alone) REPLACES the config
    // view, the change is counted once, and alpha now wants - and holds -
    // everything the ghost's phantom membership was withholding.
    server.membershipBoom = false;
    await alpha.tick();
    expect(registry.render()).toContain(
      'wlct_worker_coordination_events_total{result="membership_updated",service="api"} 1',
    );
    expect(alpha.snapshot().heldPartitions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // Outage #2, with a last-known set: the fallback is the registry's own
    // last truth, not the (wrong) config list - assert by held set staying
    // complete AND membership reading ['worker-alpha'] despite config.
    server.membershipBoom = true;
    await alpha.tick();
    expect([...alpha.snapshot().membership]).toEqual(['worker-alpha']);
    expect(registry.render()).toContain(
      'wlct_worker_coordination_events_total{result="membership_fallback",service="api"} 2',
    );
    expect(alpha.holds(0)).toBe(true);
    await alpha.onModuleDestroy();
  });

  it('config mode never touches the registry zsets', async () => {
    const server = new FakeCoordServer();
    const registry = createMetricsRegistry();
    const alpha = makeCoordination(server, {}, registry);
    await alpha.tick();
    expect(server.zsets.size).toBe(0);
    expect(alpha.snapshot().membershipSource).toBe('config');
    // Regex on the SERIES LINES: the family's HELP text legitimately names
    // both values, so substring absence would be a false alarm even when
    // nothing counted them.
    const rendered = registry.render();
    expect(rendered).not.toMatch(/wlct_worker_coordination_events_total\{result="membership_fallback"/);
    expect(rendered).not.toMatch(/wlct_worker_coordination_events_total\{result="membership_updated"/);
    await alpha.onModuleDestroy();
  });

  it('graceful shutdown resigns from the registry before releasing claims', async () => {
    const server = new FakeCoordServer();
    const alpha = makeCoordination(server, { workerMembershipMode: 'registry' });
    await alpha.tick();
    expect(server.zsets.get(REG_KEY)?.size).toBe(1);
    await alpha.onModuleDestroy();
    // Peer-visible immediately: no TTL wait for the fleet to notice.
    expect(server.zsets.get(REG_KEY)?.size).toBe(0);
    expect(await server.get(`wlct:trading:lock:partition:trade-execution:0`)).toBeNull();
  });
});

// --- engine client taxonomy (real client, mocked network) --------------------

describe('EngineInternalClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function client(overrides: CfgOverrides = {}): EngineInternalClient {
    return new EngineInternalClient(fakeConfig(overrides));
  }

  it('attaches tenant + correlation headers and never the body twice', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ verified: true, note: 'ok', isSimulated: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const receipt = await client().executeAccountCommand(
      JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS,
      VERIFY_BODY,
      'corr-1',
    );
    expect(receipt.outcome).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://engine.test:8093/internal/v1/accounts/verify-credentials');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-tenant-id']).toBe('tenant-a');
    expect(headers['x-request-id']).toBe('corr-1');
    expect(headers['x-internal-token']).toBe('eng-tok-'.padEnd(40, 'x'));
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.tenantId).toBe('tenant-a');
    // The token rides in headers only - never in the body an engine might
    // echo into a log line:
    expect(String(init.body)).not.toContain('x-internal-token');
    expect(String(init.body)).not.toContain('eng-tok-');
  });

  it('classifies 5xx and transport failure retryable, 401/403/404/409/422/501 terminal', async () => {
    const statuses: Array<[number, 'retryable' | 'terminal']> = [
      [500, 'retryable'],
      [503, 'retryable'],
      [401, 'terminal'],
      [403, 'terminal'],
      [404, 'terminal'],
      [409, 'terminal'],
      [422, 'terminal'],
      [501, 'terminal'],
    ];
    for (const [status, kind] of statuses) {
      global.fetch = jest.fn(async () =>
        new Response(JSON.stringify({ code: `C${status}`, message: 'no' }), { status }),
      ) as unknown as typeof fetch;
      await expect(client().executeAccountCommand(JOB_NAMES.REFRESH_ACCOUNT_BALANCES, VERIFY_BODY, 'c')).rejects.toMatchObject({
        kind,
        status,
      });
    }
    global.fetch = jest.fn(async () => {
      throw new TypeError('connection refused');
    }) as unknown as typeof fetch;
    const error = await client()
      .executeAccountCommand(JOB_NAMES.REFRESH_ACCOUNT_BALANCES, VERIFY_BODY, 'c')
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as { kind: string }).kind).toBe('retryable');
    expect((error as { code: string }).code).toBe('ENGINE_UNREACHABLE');
  });

  it('refuses construction without a usable token or URL (no half-wired client)', () => {
    expect(() => client({ executionEngineToken: undefined })).toThrow(/EXECUTION_ENGINE_TOKEN/);
    expect(() => client({ executionEngineToken: 'short' })).toThrow(/EXECUTION_ENGINE_TOKEN/);
  });

  it('the compatibility gate rejects a non-simulated engine', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        instanceId: 'i',
        mode: 'live',
        dryRun: true,
        adapter: 'X',
        store: 'Y',
        storeDurable: true,
        locksDistributed: true,
        commands: ['cancel-order'],
      }),
    ) as unknown as typeof fetch;
    await expect(client().assertEngineCompatible()).rejects.toThrow(/mode "live"/);
  });

  // Part 13: the durable-store tripwire was the forcing function; the ack
  // policy re-review (docs/PART13_DURABLE_STORE.md §ack) closed it. These
  // three tests pin the reviewed contract in both directions.
  it('the compatibility gate ACCEPTS a durable postgres store (Part 13 re-review)', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        instanceId: 'i',
        mode: 'simulated',
        dryRun: true,
        adapter: 'PaperTradingAdapter',
        store: 'PostgresOrderStore',
        storeDurable: true,
        storeBackend: 'postgres',
        locksDistributed: false,
        commands: ['cancel-order'],
      }),
    ) as unknown as typeof fetch;
    const status = await client().assertEngineCompatible();
    expect(status.storeDurable).toBe(true);
    expect(status.storeBackend).toBe('postgres');
  });

  it('the gate refuses a durable claim without a postgres backend name (contradiction is unproven durability)', async () => {
    // Pre-Part-13 wire shape: durable true, no storeBackend at all -
    // 'unknown' must fail closed, never parse as an implicit memory.
    for (const backend of [undefined, 'memory', 'unknown']) {
      global.fetch = jest.fn(async () =>
        jsonResponse({
          instanceId: 'i',
          mode: 'simulated',
          dryRun: true,
          adapter: 'X',
          store: 'Y',
          storeDurable: true,
          ...(backend === undefined ? {} : { storeBackend: backend }),
          locksDistributed: false,
          commands: [],
        }),
      ) as unknown as typeof fetch;
      await expect(client().assertEngineCompatible()).rejects.toThrow(
        /without storeBackend "postgres"/,
      );
    }
  });

  it('a non-durable engine still passes exactly as before (memory backend unaffected)', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        instanceId: 'i',
        mode: 'simulated',
        dryRun: true,
        adapter: 'PaperTradingAdapter',
        store: 'InMemoryOrderStore',
        storeDurable: false,
        locksDistributed: false,
        commands: ['cancel-order'],
      }),
    ) as unknown as typeof fetch;
    const status = await client().assertEngineCompatible();
    expect(status.storeDurable).toBe(false);
    expect(status.storeBackend).toBe('unknown');
  });
});

// --- the processor: admission, deferral, ack policy ---------------------------

describe('TradeExecutionProcessor', () => {
  const originalFetch = global.fetch;
  let server: FakeCoordServer;
  let coordination: WorkerCoordinationService;
  let processor: TradeExecutionProcessor;
  let fetchMock: jest.Mock;
  let sloCalls: Array<[string, number, number]>;

  function buildProcessor(configOverrides: CfgOverrides = {}): void {
    server = new FakeCoordServer();
    coordination = makeCoordination(server, configOverrides);
    fetchMock = jest.fn(async () => jsonResponse({ ok: true, outcome: 'ACCEPTED' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const tracing = {
      withJobContext: (
        _queue: string,
        _jobId: string,
        _operation: string,
        work: () => Promise<unknown>,
      ) => work(),
    } as unknown as TracingService;
    const sloSamples = {
      recordCounters: async (kind: string, ok: number, failed: number) => {
        sloCalls.push([kind, ok, failed]);
      },
    } as unknown as import('../observability/slo-samples').SloSamplesService;
    sloCalls = [];
    processor = new TradeExecutionProcessor(
      fakeConfig(configOverrides),
      coordination,
      new EngineInternalClient(fakeConfig(configOverrides)),
      tracing,
      sloSamples,
      { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } as never,
    );
  }

  afterEach(async () => {
    global.fetch = originalFetch;
    await coordination.onModuleDestroy();
  });

  it('claims partitions, then forwards a verify command and completes', async () => {
    buildProcessor();
    await coordination.tick();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ verified: true, note: 'Simulated venue; fine.', isSimulated: true }),
    );
    const { job, delayed } = makeJob({ name: JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS, data: VERIFY_BODY });
    const result = await processor.process(job);
    expect(result).toMatchObject({ verified: true });
    expect(delayed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a job whose partition this worker does not own is DEFERRED, not completed', async () => {
    const members = ['worker-alpha', 'worker-beta'];
    buildProcessor({ workerMembership: members });
    await coordination.tick();
    // Find an account the OTHER member owns: partitionFor on the
    // `${tenant}:${account}` composition, scanned deterministically.
    let victim: { tenantId: string; accountId: string; partition: number } | undefined;
    for (let i = 0; i < 5000 && victim === undefined; i += 1) {
      const accountId = `acct-${i}`;
      const partition = coordination.partitionForAccount('tenant-a', accountId);
      if (partitionOwner(members, partition) === 'worker-beta') {
        victim = { tenantId: 'tenant-a', accountId, partition };
      }
    }
    if (victim === undefined) {
      throw new Error('the membership scan found no beta-owned account in 5000 candidates');
    }
    const { job, delayed, progresses } = makeJob({
      name: JOB_NAMES.REFRESH_ACCOUNT_BALANCES,
      data: { tenantId: victim.tenantId, accountId: victim.accountId },
    });
    const result = await processor.process(job);
    expect(result).toMatchObject({ deferred: true, partition: victim.partition });
    expect(delayed.length).toBe(1);
    expect(delayed[0]).toBeGreaterThanOrEqual(1_900); // config 2s, minus the call latency floor
    expect(progresses).toEqual([{ defers: 1 }]);
    expect(fetchMock).not.toHaveBeenCalled(); // NOT_owner forwards NOTHING
  });

  it('deferral is ceilinged: the last tolerated defer fails visibly instead of orbiting', async () => {
    const members = ['worker-alpha', 'worker-beta'];
    buildProcessor({ workerMembership: members, workerMaxDefers: 2 });
    await coordination.tick();
    let victim: string | undefined;
    for (let i = 0; i < 5000 && victim === undefined; i += 1) {
      const candidate = `acct-${i}`;
      if (partitionOwner(members, coordination.partitionForAccount('tenant-a', candidate)) === 'worker-beta') {
        victim = candidate;
      }
    }
    if (victim === undefined) {
      throw new Error('the membership scan found no beta-owned account in 5000 candidates');
    }
    const { job, delayed } = makeJob({
      name: JOB_NAMES.REFRESH_ACCOUNT_BALANCES,
      data: { tenantId: 'tenant-a', accountId: victim },
      progress: { defers: 2 },
    });
    await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(delayed).toEqual([]);
  });

  it('malformed and unknown payloads are Unrecoverable (never retried to dust)', async () => {
    buildProcessor();
    await coordination.tick();
    const bad = makeJob({ name: JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS, data: { tenantId: 42 } });
    await expect(processor.process(bad.job)).rejects.toBeInstanceOf(UnrecoverableError);
    const unknown = makeJob({ name: 'drop-database-please', data: VERIFY_BODY });
    await expect(processor.process(unknown.job)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('engine terminal answers fail the job with the engine reason attached', async () => {
    buildProcessor();
    await coordination.tick();
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ code: 'NOT_SUPPORTED', message: 'no stream' }), { status: 501 }),
    );
    const { job } = makeJob({ name: JOB_NAMES.RESYNC_PRIVATE_STREAM, data: VERIFY_BODY });
    await expect(processor.process(job)).rejects.toThrow(/NOT_SUPPORTED/);
  });

  it('engine 5xx stays retryable: the processor throws a plain Error, not Unrecoverable', async () => {
    buildProcessor();
    await coordination.tick();
    fetchMock.mockImplementation(async () => jsonResponse({ code: 'X', message: 'busy' }, 503));
    const { job } = makeJob({ name: JOB_NAMES.REFRESH_ACCOUNT_BALANCES, data: VERIFY_BODY });
    const error = await processor.process(job).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  it('200 + non-accepted cancel outcome is a COMPLETED job (a confident answer is the ack)', async () => {
    buildProcessor();
    await coordination.tick();
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        outcome: 'REJECTED_LOCALLY',
        clientOrderId: 'clord-1',
        orderStatus: 'CANCELLED',
        errorCode: 'ILLEGAL_STATE_TRANSITION',
        message: 'already terminal',
        latencyMicros: 41,
        isSimulated: true,
      }),
    );
    const { job } = makeJob({
      name: JOB_NAMES.CANCEL_ORDER,
      data: { ...VERIFY_BODY, orderId: 'ord-1', clientOrderId: 'clord-1', symbol: 'BTCUSDT' },
    });
    await expect(processor.process(job)).resolves.toMatchObject({ outcome: 'REJECTED_LOCALLY' });
  });

  it('same-account jobs in one process serialise through deferral, never interleaving', async () => {
    buildProcessor();
    await coordination.tick();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await gate;
      return jsonResponse({ verified: true, note: 'late', isSimulated: true });
    });
    const first = makeJob({ name: JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS, data: VERIFY_BODY });
    const second = makeJob({ name: JOB_NAMES.REFRESH_ACCOUNT_BALANCES, data: VERIFY_BODY });
    const firstPromise = processor.process(first.job);
    await new Promise((resolve) => setImmediate(resolve)); // let the first enter the engine call
    const secondResult = await processor.process(second.job);
    expect(secondResult).toMatchObject({ deferred: true });
    expect(second.delayed.length).toBe(1);
    release();
    await expect(firstPromise).resolves.toMatchObject({ verified: true });
  });

  it('an in-flight second job on a DIFFERENT account is not deferred', async () => {
    buildProcessor();
    await coordination.tick();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('refresh-balances')) {
        await gate;
      }
      return jsonResponse({ ok: true });
    });
    const slow = makeJob({
      name: JOB_NAMES.REFRESH_ACCOUNT_BALANCES,
      data: { ...VERIFY_BODY, accountId: 'acct-slow' },
    });
    const fast = makeJob({
      name: JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS,
      data: { ...VERIFY_BODY, accountId: 'acct-fast' },
    });
    const slowPromise = processor.process(slow.job);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(processor.process(fast.job)).resolves.toBeDefined();
    release();
    await slowPromise;
  });

  it('the queueproc SLO fold wires completed/failed onto the BullMQ worker events', () => {
    buildProcessor();
    // WorkerHost's `worker` is populated by the DI lifecycle in production;
    // injecting a fake emitter proves the listeners are wired at bootstrap
    // exactly as maintenance's are - one law for every queue in the fleet.
    const handlers = new Map<string, () => void>();
    Object.defineProperty(processor as object, 'worker', {
      value: { on: (event: string, handler: () => void) => handlers.set(event, handler) },
      configurable: true,
    });
    processor.onApplicationBootstrap();
    expect([...handlers.keys()].sort()).toEqual(['completed', 'failed']);
    handlers.get('completed')?.();
    handlers.get('failed')?.();
    expect(sloCalls).toEqual([
      ['queueproc', 1, 0],
      ['queueproc', 0, 1],
    ]);
  });
});
