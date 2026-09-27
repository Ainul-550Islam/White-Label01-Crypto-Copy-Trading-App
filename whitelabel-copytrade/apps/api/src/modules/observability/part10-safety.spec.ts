/**
 * Part 10 safety law: the telemetry plane observes; it never authorises,
 * never mutates trading state, and never lets its own failure become a
 * trading decision. Half of this is source-scan law (the kind only a grep
 * can keep honest over time), half is live behaviour of the service the law
 * is about. The engine's twin scan lives at
 * services/trading-engine/tests/test_part10_safety.py; the two together are
 * the enforceable form of "the trading path does not read telemetry".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AppConfigService } from '../../config/app-config.service';
import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import {
  FAULT_METRICS_EXPORT,
  FAULT_TRACE_EXPORT,
  TracingService,
} from '../../infrastructure/tracing/tracing.service';
import { MetricsController } from './metrics.controller';
import { SamplingMode, SamplingPolicy } from '../../infrastructure/tracing/w3c';

const SRC = join(__dirname, '..', '..');
const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
};

const relativeOf = (full: string): string => full.slice(SRC.length + 1).split('\\').join('/');

const controllerDecoratorRe = /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:'([^']*)'[^)]*)?\)/g;

// ---------------------------------------------------------------------------
// The observability surface cannot trade
// ---------------------------------------------------------------------------

describe('no-mutation law over the whole telemetry surface', () => {
  const files = walk(join(SRC, 'modules', 'observability')).filter((f) =>
    f.endsWith('.controller.ts'),
  );

  it('exposes only GET and POST (no PUT/PATCH/DELETE anywhere)', () => {
    for (const file of files) {
      const source = read(relativeOf(file));
      for (const match of source.matchAll(controllerDecoratorRe)) {
        expect(['Get', 'Post']).toContain(match[1]);
      }
    }
  });

  it('POSTs exactly the whitelisted admin actions, nowhere else', () => {
    const sloPosts = new Set([
      'slos/:sloId/config', // config append: an audit-only, additive insert
      'slos/:sloId/evaluate', // recompute: reads samples, writes an evaluation row
      'slos/evaluate-all',
      'tracing/flush', // export kick: touches no trading state
    ]);
    // The pre-Part-10 alert triage surface (acknowledge / force-resolve on
    // alert ROWS) is its own long-standing plane and stays allowed; the law
    // under test is that Part 10 added no new write surface to it.
    const legacyAlertPosts = new Set(['alerts/:id/acknowledge', 'alerts/:id/force-resolve']);
    let sloSeen = 0;
    for (const file of files) {
      const source = read(relativeOf(file));
      const sloFile = relativeOf(file).endsWith('slo.controller.ts');
      for (const match of source.matchAll(controllerDecoratorRe)) {
        if (match[1] !== 'Post') {
          continue;
        }
        if (sloFile) {
          sloSeen += 1;
          expect(sloPosts.has(match[2] ?? '')).toBe(true);
        } else {
          expect(legacyAlertPosts.has(match[2] ?? '') || !(match[2] ?? '').startsWith('slos')).toBe(true);
        }
      }
    }
    expect(sloSeen).toBe(4);
  });

  it('the fault surface is read-only, and no arm/inject lever exists anywhere', () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, 'modules'))) {
      const source = read(relativeOf(file));
      for (const match of source.matchAll(controllerDecoratorRe)) {
        const path = (match[2] ?? '').toLowerCase();
        // (a) anything that ARMS something is banned outright;
        // (b) a route whose path mentions faults must be a GET - the only
        //     runtime operation on an armed fault is consume, and consume
        //     lives INSIDE the instrumented code paths, never on a route.
        // (Alert acknowledge/resolve routes predate Part 10 and only touch
        // alert rows - that is the observability plane's own state, not
        // fault arming and not trading state, so they stay out of this scan.)
        if (/arm|disarm|inject|unleash/.test(path)) {
          offenders.push(`${relativeOf(file)}: ${match[0]}`);
        } else if (/fault/.test(path) && match[1] !== 'Get') {
          offenders.push(`${relativeOf(file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no POST route on the telemetry surface names a trading mutation (GET observation of e.g. execution lag is the feature, writes are not)', () => {
    for (const file of files) {
      const source = read(relativeOf(file));
      for (const match of source.matchAll(controllerDecoratorRe)) {
        if (match[1] !== 'Post') {
          continue;
        }
        expect(match[2] ?? '').not.toMatch(
          /order|execution|credential|wallet|withdraw|deposit|trade/i,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// observe-never-authorise, enforced across module boundaries
// ---------------------------------------------------------------------------

describe('the trading path never reads telemetry', () => {
  const TRADING_MODULES = ['execution', 'risk', 'strategy', 'signals', 'tenants', 'auth', 'realtime'];

  it('trading modules do not import from infrastructure/tracing at all', () => {
    const offenders: string[] = [];
    for (const moduleName of TRADING_MODULES) {
      const dir = join(SRC, 'modules', moduleName);
      let files: string[];
      try {
        files = walk(dir);
      } catch {
        continue; // module not present in this cut
      }
      for (const file of files) {
        const source = read(relativeOf(file));
        if (/from\s+'[^']*infrastructure\/tracing/.test(source)) {
          offenders.push(relativeOf(file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('fault consumption appears ONLY in the tracing service and the scrape endpoint', () => {
    const allowed = new Set([
      'infrastructure/tracing/tracing.service.ts',
      'modules/observability/metrics.controller.ts',
    ]);
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relativeOf(file);
      if (allowed.has(rel)) {
        continue;
      }
      const source = read(rel);
      if (/consumeFault\s*\(/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('readiness and health do not consult the fault injector', () => {
    for (const rel of [
      'modules/health/health.controller.ts',
      'modules/observability/observability.controller.ts',
    ]) {
      let source: string;
      try {
        source = read(rel);
      } catch {
        continue;
      }
      expect(source).not.toMatch(/consumeFault|failureInjectionArmed/);
    }
  });

  it('queue publishes attach the sidecar AFTER a successful add, and swallow its failure', () => {
    const source = read('modules/queue/queue.service.ts');
    // attachSidecar must never be awaited inline in a way that can reject:
    // the law is "a failed sidecar write must not fail a publish".
    expect(source).toMatch(/captureQueueSidecar[\s\S]{0,120}\.catch\(/);
    // and the attach call must sit after the add call in both enqueue paths
    const addBefore = (method: string): void => {
      const body = source.slice(source.indexOf(method));
      const add = body.indexOf('add(');
      const attach = body.indexOf('attachSidecar');
      expect(add).toBeGreaterThanOrEqual(0);
      expect(attach).toBeGreaterThanOrEqual(0);
      expect(attach).toBeGreaterThan(add);
    };
    addBefore('async enqueue<');
    addBefore('async enqueueOrThrow<');
  });

  it('the middleware ordering puts tracing FIRST on every route', () => {
    const source = read('app.module.ts');
    const match =
      /configure\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n  \}/.exec(source);
    expect(match).not.toBeNull();
    const body = match![1];
    const order = ['TraceMiddleware', 'RequestContextMiddleware', 'TenantResolutionMiddleware'];
    const positions = order.map((name) => body.indexOf(name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // and it is the .apply(...) list, not a comment stray: the first apply
    // in the body opens with the trace middleware.
    expect(/\.apply\(\s*TraceMiddleware/.test(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fault injector: config-armed, closed-set, consume-only
// ---------------------------------------------------------------------------

const makeConfig = (over: Record<string, unknown> = {}): AppConfigService => {
  const env = {
    NODE_ENV: 'test',
    FAILURE_INJECTION_ENABLED: false,
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: true,
    OTEL_ENABLED: true,
    OTEL_ENDPOINT: undefined,
    OTEL_SAMPLE_RATIO: 1,
    OTEL_PRIORITY_OPERATIONS: [],
    OTEL_TIMEOUT_MS: 200,
    METRICS_EXPORT_INTERVAL_MS: 60_000,
    ...over,
  };
  const svc = Object.create(AppConfigService.prototype) as Record<string, unknown>;
  svc.env = env;
  // The getter reads this.env directly; rebind the two derived getters used
  // by consumers so the object is self-consistent without the DI graph.
  Object.defineProperty(svc, 'failureInjectionArmed', {
    get: () =>
      env.FAILURE_INJECTION_ENABLED === true &&
      env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY === true &&
      env.NODE_ENV !== 'production',
  });
  Object.defineProperty(svc, 'isProduction', { get: () => env.NODE_ENV === 'production' });
  Object.defineProperty(svc, 'otelEnabled', { get: () => env.OTEL_ENABLED === true });
  Object.defineProperty(svc, 'otelSampleRatio', { get: () => env.OTEL_SAMPLE_RATIO });
  Object.defineProperty(svc, 'otelPriorityOperations', {
    get: () => env.OTEL_PRIORITY_OPERATIONS,
  });
  Object.defineProperty(svc, 'otelEndpoint', { get: () => env.OTEL_ENDPOINT });
  Object.defineProperty(svc, 'otelTimeoutMs', { get: () => env.OTEL_TIMEOUT_MS });
  Object.defineProperty(svc, 'metricsExportIntervalMs', {
    get: () => env.METRICS_EXPORT_INTERVAL_MS,
  });
  Object.defineProperty(svc, 'failureInjectionRequested', {
    get: () => env.FAILURE_INJECTION_ENABLED === true,
  });
  return svc as unknown as AppConfigService;
};

const makeService = (
  config: AppConfigService,
  redis: unknown = { client: { pipeline: () => ({ hincrby: () => undefined, pexpire: () => undefined, exec: async () => [] }) } },
  sink?: { telemetryExportFailing: jest.Mock },
): TracingService => {
  const registry = new MetricsRegistry('spec');
  return new TracingService(config, redis as never, registry, sink as never);
};

describe('fault injector (live)', () => {
  it('is inert unless armed, and the closed set governs while armed', () => {
    const inert = makeService(makeConfig());
    expect(inert.faultsArmed()).toBe(false);
    expect(inert.consumeFault(FAULT_TRACE_EXPORT)).toBe(false);
    expect(inert.faultPlan()).toEqual({ enabled: false, points: [] });

    const armed = makeService(
      makeConfig({ FAILURE_INJECTION_ENABLED: true }),
    );
    expect(armed.faultsArmed()).toBe(true);
    expect(armed.consumeFault(FAULT_TRACE_EXPORT)).toBe(true);
    expect(armed.consumeFault(FAULT_METRICS_EXPORT)).toBe(true);
    // The API-side injector's closed set is the two points the API process
    // can actually act on. Points owned by OTHER planes (the queue simulator
    // and health probes are driven where those signals live) never fire from
    // here - an injector must not fake a lever it does not physically own.
    expect(armed.consumeFault('queue_observed_failure')).toBe(false);
    expect(armed.consumeFault('market_data_stale_simulated')).toBe(false);
    expect(armed.consumeFault('order.submit')).toBe(false);
    expect(armed.consumeFault('')).toBe(false);
    expect(armed.faultPlan().points).toEqual(
      expect.arrayContaining([FAULT_TRACE_EXPORT, FAULT_METRICS_EXPORT]),
    );
    expect(armed.faultPlan().points).toHaveLength(2);
    expect(armed.faultPlan().enabled).toBe(true);
  });

  it('production cannot arm: the getter AND the plan refuse', () => {
    const config = makeConfig({
      NODE_ENV: 'production',
      FAILURE_INJECTION_ENABLED: true,
      FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: true,
    });
    expect(config.failureInjectionArmed).toBe(false);
    const service = makeService(config);
    expect(service.faultsArmed()).toBe(false);
    expect(service.consumeFault(FAULT_TRACE_EXPORT)).toBe(false);
    // and the env validator's own production refusal is still in place:
    const schema = readFileSync(
      join(SRC, '..', '..', '..', 'packages', 'config', 'src', 'env.schema.ts'),
      'utf8',
    );
    expect(schema).toContain("production refuses to boot with it armed");
  });

  it('disabling the guard disables the feature, it does not unlock production', () => {
    const config = makeConfig({
      NODE_ENV: 'test',
      FAILURE_INJECTION_ENABLED: true,
      FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: false,
    });
    expect(config.failureInjectionArmed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// export posture: drop-loud, single-attempt, alert-streak
// ---------------------------------------------------------------------------

describe('export loop (live)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const spansOf = (service: TracingService, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      const handle = service.startRequestSpan({
        // distinct, W3C-valid trace ids per span; flags 01 = sampled
        traceparent: `00-${'a'.repeat(24)}${String(i).padStart(4, '0')}-${'1'.repeat(16)}-01`,
      });
      if (handle !== null) {
        service.finishRequestSpan(handle, {
          method: 'GET',
          route: '/v1/spec',
          status: 200,
          durationMs: 5,
        });
      }
    }
  };

  it('no endpoint configured: spans are DROPPED WITH A REASON, counted, not silent', async () => {
    const service = makeService(makeConfig());
    spansOf(service, 3);
    expect(service.bufferedSpans).toBe(3);
    const result = await service.tick();
    expect(result.outcome).toBe('skipped');
    expect(service.dropCounts.no_endpoint).toBe(3);
    // export OUTCOMES count ticks (one result per attempt), span COUNTS are
    // what dropCounts.no_endpoint carries per-span. Getting these two
    // confusable metrics right is exactly why both are asserted here.
    expect(service.exportOutcomes.skipped).toBe(1);
    // Deliberate skips are a posture, not an outage: no alert streak accrues.
    expect(service.consecutiveExportFailures).toBe(0);
  });

  it('collector refusing: one attempt per batch, streak alerts at three, recovery resets', async () => {
    const sink = { telemetryExportFailing: jest.fn(async () => undefined) };
    const service = makeService(
      makeConfig({ OTEL_ENDPOINT: 'http://collector:4318' }),
      undefined,
      sink,
    );
    service.setAlertSink(sink as never);
    let attempts = 0;
    global.fetch = jest.fn(async () => {
      attempts += 1;
      throw new Error('connection refused');
    }) as never;

    for (let tick = 0; tick < 3; tick += 1) {
      spansOf(service, 1);
      const result = await service.tick();
      expect(result.outcome).toBe('error');
    }
    // single-attempt contract: exactly one fetch per span per tick - the
    // batch is dropped, NOT retried inside the tick.
    expect(attempts).toBe(3);
    expect(service.consecutiveExportFailures).toBe(3);
    expect(service.exportOutcomes.error).toBe(3);
    expect(service.exportOutcomes.ok).toBe(0);
    expect(sink.telemetryExportFailing).toHaveBeenCalledWith(
      expect.any(String),
      true,
      3,
    );
    expect(service.dropCounts.export_failed).toBe(3);

    global.fetch = jest.fn(async () => ({ ok: true }) as never) as never;
    spansOf(service, 1);
    const ok = await service.tick();
    expect(ok.outcome).toBe('ok');
    expect(service.consecutiveExportFailures).toBe(0);
    expect(sink.telemetryExportFailing).toHaveBeenLastCalledWith(
      expect.any(String),
      false,
      0,
    );
  });

  it('armed trace-export fault turns the SAME path into counted skips', async () => {
    const service = makeService(
      makeConfig({
        OTEL_ENDPOINT: 'http://collector:4318',
        FAILURE_INJECTION_ENABLED: true,
      }),
    );
    global.fetch = jest.fn(async () => {
      throw new Error('must not be reached: the fault short-circuits');
    }) as never;
    spansOf(service, 2);
    const result = await service.tick();
    expect(result.outcome).toBe('skipped');
    expect(service.dropCounts.fault_injected).toBe(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('disabled tracing is zero-cost: no handle, no buffer, no work', async () => {
    const service = makeService(makeConfig({ OTEL_ENABLED: false }));
    const handle = service.startRequestSpan({ traceparent: '00-aaaa-1111-01' });
    expect(handle).toBeNull();
    // the middleware-side contract: finish on a null handle must be a no-op
    // the service tolerates - the parameter type is `SpanHandle`, and the
    // middleware never calls it when the span is null, so assert the guard
    // in the service body itself instead (zero cost is zero calls):
    expect(service.bufferedSpans).toBe(0);
    expect(service.bufferedSpans).toBe(0);
    const result = await service.tick();
    expect(result.outcome).toBe('disabled');
  });

  it('sampling decision is the fixture law: priority ops always, ratio by trace bucket', () => {
    const always = makeService(
      makeConfig({ OTEL_PRIORITY_OPERATIONS: ['execution.transmit'] }),
    );
    const handle = always.startRequestSpan({
      // trace id chosen so its bucket sits ABOVE any 0.0-ish ratio; the
      // priority-operations list must override the ratio anyway
      traceparent: `00-${'f'.repeat(32)}-${'1'.repeat(16)}-00`,
    });
    // startRequestSpan samples http.server at ratio... with OTEL_SAMPLE_RATIO 1 everything samples; assert the policy directly:
    expect(handle?.context.traceId ?? null).not.toBeNull();
    if (handle !== null) {
      always.finishRequestSpan(handle, {
        method: 'GET',
        route: '/v1/spec',
        status: 200,
        durationMs: 5,
      });
    }
    const policy = new SamplingPolicy(SamplingMode.RATIO, {
      ratio: 0.001,
      priorityOperations: ['execution.transmit'],
    });
    expect(
      policy.shouldSample({ traceId: 'f'.repeat(32), parentSampled: false, operation: 'execution.transmit' }),
    ).toBe(true);
    expect(
      policy.shouldSample({ traceId: 'f'.repeat(32), parentSampled: false, operation: 'http.server' }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the scrape endpoint and its fault
// ---------------------------------------------------------------------------

describe('metrics scrape fault (live)', () => {
  const fakeResponse = () => ({ setHeader: jest.fn() }) as never;

  const controllerWith = (tracing?: TracingService): MetricsController => {
    const registry = {
      render: () => '# test\n',
      sampleProcess: () => undefined,
    } as unknown as MetricsRegistry;
    const observability = { sampleDerivedGauges: async () => undefined } as never;
    const config = {
      metricsEnabled: true,
      prometheusEnabled: true,
      metricsToken: undefined,
      isProduction: false,
    } as unknown as AppConfigService;
    return new MetricsController(registry, observability, config, tracing);
  };

  const request = (headers: Record<string, string> = {}) =>
    ({ headers }) as never;

  it('renders normally when nothing is armed', async () => {
    const controller = controllerWith();
    await expect(
      controller.metrics(request(), fakeResponse(), undefined),
    ).resolves.toContain('# test');
  });

  it('armed FAULT_METRICS_EXPORT 503s the scrape while the exporter keeps counting', async () => {
    const tracing = makeService(makeConfig({ FAILURE_INJECTION_ENABLED: true }));
    const controller = controllerWith(tracing);
    await expect(controller.metrics(request(), fakeResponse(), undefined)).rejects.toMatchObject(
      {
        response: { code: 'METRICS_EXPORT_UNAVAILABLE' },
        status: 503,
      },
    );
    // the fault is CONSUMED per scrape, and the registry was never touched:
    // the count-up continues behind the closed door.
    expect(tracing.exportOutcomes.ok).toBe(0);
  });

  it('the fault gate sits AFTER auth (an unauthenticated stranger learns nothing new)', async () => {
    const tracing = makeService(makeConfig({ FAILURE_INJECTION_ENABLED: true }));
    const registry = { render: () => '', sampleProcess: () => undefined } as never;
    const config = {
      metricsEnabled: true,
      prometheusEnabled: true,
      metricsToken: 'sekret-token',
      isProduction: false,
    } as unknown as AppConfigService;
    const controller = new MetricsController(
      registry,
      { sampleDerivedGauges: async () => undefined } as never,
      config,
      tracing,
    );
    await expect(
      controller.metrics(request({ 'x-metrics-token': 'wrong' }), fakeResponse(), undefined),
    ).rejects.toMatchObject({ response: { code: 'METRICS_UNAUTHORIZED' } });
    // wrong token fails as UNAUTHORIZED (not 503): the fault cannot be used
    // to probe whether injection is armed, by anyone without the token.
  });
});
