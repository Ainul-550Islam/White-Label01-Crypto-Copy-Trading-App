/**
 * Part 20 — the engine's self-report on the operator's panel.
 *
 * The laws these pin, in order of how much they cost to get wrong: an engine that does
 * not answer must never be rendered as health; a secret-shaped value inside the status
 * document must not reach the panel text; and the panel's rows must be the engine's own
 * words, typed and defaulted by the shared contract, with no value invented here.
 */

import {
  ENGINE_POSTURE_CLIENT,
  EnginePostureService,
  type EnginePostureView,
} from './engine-posture.service';
import { ObservabilityService } from './observability.service';
import { EngineCallError, EngineInternalClient } from '../worker/engine-internal.client';
import { createEnginePostureClient } from './observability.module';
import { parseEngineStatus } from '../worker/engine-status-contract';

/** A complete reply from the shipped default deployment, taken field for field from
 * `build_runtime(get_settings()).describe()` output on the tree this part changed - not a
 * sketch. If the engine's own answer changes shape, the contract spec fails first; this
 * fixture is here to say what the panel does with a real one. */
const reportedBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  instanceId: 'exec-a',
  mode: 'simulated',
  dryRun: true,
  adapter: 'PaperTradingAdapter',
  store: 'InMemoryOrderStore',
  storeDurable: false,
  storeBackend: 'unknown',
  retentionEnabled: false,
  retentionEventDays: 90,
  enablementMaxAgeDays: 30,
  credentialSource: 'none',
  credentialFetcher: null,
  operatorConfirmation: false,
  liveEnablement: {
    liveRefused: true,
    missing: ['SIGNED_TRANSPORT_WIRED'],
    satisfied: ['IP_ALLOWLIST_ENFORCED'],
    missingCodes: ['LIVE_SIGNED_TRANSPORT_WIRED'],
    hardBlockersPresent: true,
    credentialSource: 'none',
  },
  placement: {
    label: 'placement-review',
    mode: 'local',
    requiresVenueAttestation: false,
    cacheTtlMillis: 300_000,
    attestorSource: 'local:in-process',
    policy: { requireOperatorConfirmation: false, maxKeyAgeDays: 90 },
    cache: { hits: 0, misses: 0 },
    confirmationConfigured: false,
    // A 12-char digest prefix the engine publishes for correlation. It is on the wire and
    // must NOT be on the page, which is what the secret scan below is for.
    operatorConfirmation: {
      required: false,
      keyConfigured: false,
      recordPresent: false,
      expiresAtMicros: 0,
      fingerprint: 'deadbeefcafe',
    },
  },
  incidents: { durable: false, sink: 'InMemoryIncidentRecorder', stats: {} },
  metricsConfigured: true,
  locksDistributed: false,
  commands: ['cancel-order'],
  simulated: true,
  ...overrides,
});

const serviceWith = (body: unknown | null): EnginePostureService => {
  const service = new EnginePostureService(
    (body === null
      ? null
      : ({
          // The real parser, on purpose: the panel's rows are only tested against what
          // `getStatus` would actually hand back, which is a parsed contract object (with
          // `unmappedKeys`), never the raw body.
          getStatus: async () => parseEngineStatus(body),
          statusFetchedAtMs: () => Date.now() - 1_500,
        } as unknown as EngineInternalClient)),
  );
  return service;
};

const row = (
  rows: { label: string; value: string; detail?: string; tone: string }[],
  label: string,
): { value: string; detail?: string; tone: string } => {
  const found = rows.find((candidate) => candidate.label === label);
  if (found === undefined) {
    throw new Error(`no row labelled ${JSON.stringify(label)}; labels were: ${rows.map((r) => r.label).join(', ')}`);
  }
  return found;
};

describe('EnginePostureService - an engine that cannot answer is never health', () => {
  it('renders unconfigured without a client, naming the environment it needs', async () => {
    const view = await serviceWith(null).read();
    expect(view.state).toBe('unconfigured');
    expect(view.code).toBe('UNCONFIGURED');
    expect(view.reason).toMatch(/EXECUTION_ENGINE_TOKEN/);
    expect(view.reason).toMatch(/EXECUTION_ENGINE_URL/);
    const rows = (await serviceWith(null).section()).rows;
    expect(row(rows, 'engine posture').value).toBe('unconfigured');
    expect(row(rows, 'engine last answered').value).toBe('never');
  });

  it('renders a transport failure as unverified, with the engine code attached', async () => {
    const failing: EnginePostureService = new EnginePostureService({
        getStatus: async () => {
          throw new EngineCallError({
            kind: 'retryable',
            status: null,
            code: 'ENGINE_UNREACHABLE',
            message: 'connect ECONNREFUSED 127.0.0.1:8093',
          });
        },
        statusFetchedAtMs: () => null,
      } as unknown as EngineInternalClient);
    const view = await failing.read();
    expect(view.state).toBe('unverified');
    expect(view.code).toBe('ENGINE_UNREACHABLE');
    expect(view.reason).toMatch(/ECONNREFUSED/);
    expect(failing.wired).toBe(true);
  });

  it('carries a shape refusal through as its own code, because it is a different fault', async () => {
    const service = new EnginePostureService({
        getStatus: async () => {
          throw new EngineCallError({
            kind: 'terminal',
            status: null,
            code: 'ENGINE_STATUS_SHAPE',
            message: 'execution engine /status declares "placement" as required',
          });
        },
        statusFetchedAtMs: () => Date.now() - 60_000,
      } as unknown as EngineInternalClient);
    const view = await service.read();
    expect(view.state).toBe('unverified');
    expect(view.code).toBe('ENGINE_STATUS_SHAPE');
    // The last ANSWER's age still rides along: "unknown for 60s" and "never known" are
    // different incidents and an operator reads them differently.
    expect(view.checkedAtMs).not.toBeNull();
    const rows = (await service.section()).rows;
    expect(row(rows, 'engine last answered').value).toMatch(/this read did not answer/);
  });

  it('gives up on a hung engine inside the panel budget instead of blocking the request', async () => {
    const service = new EnginePostureService({
      getStatus: () => new Promise(() => undefined),
      statusFetchedAtMs: () => null,
    } as unknown as EngineInternalClient);
    const started = Date.now();
    const view = await service.read();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(view.state).toBe('unverified');
    expect(view.code).toBe('PANEL_BUDGET');
    expect(view.reason).toMatch(/still running/);
  });

  it('never renders a tone of ok for a view that is not reported', async () => {
    for (const service of [serviceWith(null), await unreachableService()]) {
      for (const section of [await service.section()]) {
        expect(section.rows.every((candidate) => candidate.tone !== 'ok')).toBe(true);
        expect(section.rows.length).toBeGreaterThan(0);
      }
    }
  });
});

const unreachableService = async (): Promise<EnginePostureService> =>
  new EnginePostureService({
    getStatus: async () => {
      throw new Error('socket hang up');
    },
    statusFetchedAtMs: () => null,
  } as unknown as EngineInternalClient);

describe('EnginePostureService - a reported engine, row by row', () => {
  const sectionOf = async (overrides: Record<string, unknown> = {}) => {
    const service = serviceWith(reportedBody(overrides));
    const section = await service.section();
    expect(section.title).toBe('ENGINE POSTURE');
    return section.rows;
  };

  it('shows identity, store, and locks as facts rather than verdicts', async () => {
    const rows = await sectionOf();
    expect(row(rows, 'engine instance').value).toBe('exec-a');
    expect(row(rows, 'engine instance').detail).toBe('mode=simulated dryRun=true commands=1');
    expect(row(rows, 'engine instance').tone).toBe('neutral');
    expect(row(rows, 'durable store').value).toBe('InMemoryOrderStore, as configured');
    expect(row(rows, 'distributed locks').value).toBe('in-process');
    expect(row(rows, 'journal retention').value).toBe('off');
    expect(row(rows, 'journal retention').detail).toBe('enablement evidence window 30d');
  });

  it('marks the durable-claim contradiction bad, in the worker\'s own words', async () => {
    const rows = await sectionOf({ storeDurable: true, storeBackend: 'memory' });
    expect(row(rows, 'durable store').tone).toBe('bad');
    expect(row(rows, 'durable store').value).toBe('durable (memory)');
    expect(row(rows, 'durable store').detail).toMatch(/refuses to forward/);
    const honest = await sectionOf({ storeDurable: true, storeBackend: 'postgres' });
    expect(row(honest, 'durable store').tone).toBe('neutral');
  });

  it('names the credential reader when there is one, and says none when there is not', async () => {
    expect(row(await sectionOf(), 'credential source').value).toBe('none');
    expect(row(await sectionOf(), 'credential source').tone).toBe('neutral');
    const vault = await sectionOf({
      credentialSource: 'vault',
      credentialFetcher: 'VaultKvSecretFetcher',
    });
    expect(row(vault, 'credential source').value).toBe('vault via VaultKvSecretFetcher');
    expect(row(vault, 'credential source').tone).toBe('ok');
  });

  it('keeps "asked for" and "can satisfy" apart on the confirmation row', async () => {
    const notAsked = await sectionOf();
    expect(row(notAsked, 'operator confirmation').value).toBe('not wired');
    expect(row(notAsked, 'operator confirmation').tone).toBe('neutral');

    const askedAndMissing = await sectionOf({
      placement: {
        ...(reportedBody().placement as Record<string, unknown>),
        policy: { requireOperatorConfirmation: true },
        confirmationConfigured: false,
      },
    });
    expect(row(askedAndMissing, 'operator confirmation').value).toBe('asked for and absent');
    expect(row(askedAndMissing, 'operator confirmation').tone).toBe('bad');
    expect(row(askedAndMissing, 'operator confirmation').detail).toMatch(/every order/);

    const held = await sectionOf({ operatorConfirmation: true });
    expect(row(held, 'operator confirmation').value).toBe('verifier wired');
    expect(row(held, 'operator confirmation').tone).toBe('ok');
    // The nested flag alone counts as held: two sources for one fact is exactly what
    // Part 19 called a refusal, and a panel that demanded both would be a third.
    const nestedOnly = await sectionOf({
      operatorConfirmation: false,
      placement: {
        ...(reportedBody().placement as Record<string, unknown>),
        confirmationConfigured: true,
      },
    });
    expect(row(nestedOnly, 'operator confirmation').value).toBe('verifier wired');
  });

  it('treats a missing self-grading as worse than an unfavourable one', async () => {
    const designed = await sectionOf();
    expect(row(designed, 'live enablement').value).toBe('refused; 1 missing, 1 satisfied');
    expect(row(designed, 'live enablement').tone).toBe('neutral');
    expect(row(designed, 'live enablement').detail).toBe('LIVE_SIGNED_TRANSPORT_WIRED');

    const silent = await sectionOf({ liveEnablement: null });
    expect(row(silent, 'live enablement').value).toBe('not reported by this engine');
    expect(row(silent, 'live enablement').tone).toBe('warn');

    const almost = await sectionOf({
      liveEnablement: {
        liveRefused: false,
        missing: [],
        satisfied: ['IP_ALLOWLIST_ENFORCED'],
        missingCodes: [],
        hardBlockersPresent: false,
        credentialSource: 'vault',
      },
    });
    expect(row(almost, 'live enablement').tone).toBe('warn');
    expect(row(almost, 'live enablement').value).toBe('not refused; 0 missing, 1 satisfied');
  });

  it('reports the incident sink and the instrumentation as the durable/visible halves they are', async () => {
    const rows = await sectionOf();
    expect(row(rows, 'incident sink').value).toBe('InMemoryIncidentRecorder, process-local');
    expect(row(rows, 'incident sink').tone).toBe('neutral');
    expect(row(rows, 'instrumented').value).toBe('/metrics wired');
    const dark = await sectionOf({ metricsConfigured: false });
    expect(row(dark, 'instrumented').tone).toBe('warn');
    const old = await sectionOf({ incidents: null });
    expect(row(old, 'incident sink').tone).toBe('warn');
  });

  it('shows the review\'s own label and source, and nothing else from its block', async () => {
    const rows = await sectionOf();
    expect(row(rows, 'placement review').value).toBe('placement-review via local:in-process');
  });

  it('reports keys it could not mirror instead of quietly ignoring them', async () => {
    const rows = await sectionOf({ zetaFutureFact: 1 });
    const unmapped = row(rows, 'keys this build does not mirror');
    expect(unmapped.value).toBe('1');
    expect(unmapped.tone).toBe('warn');
    expect(unmapped.detail).toMatch(/parity spec/);
    const clean = await sectionOf();
    expect(clean.some((candidate) => candidate.label === 'keys this build does not mirror')).toBe(
      false,
    );
  });

  it('prints the age of the answer, never the age of the read', async () => {
    const rows = await sectionOf();
    expect(row(rows, 'engine last answered').value).toMatch(/ms since the engine answered/);
  });

  it('renders no secret-shaped value, including the confirmation fingerprint on the wire', async () => {
    const section = await serviceWith(reportedBody()).section();
    const text = JSON.stringify(section);
    expect(text).not.toMatch(/deadbeefcafe/);
    expect(text).not.toMatch(/[A-Za-z0-9+/]{40,}/);
    expect(text.toLowerCase()).not.toContain('bearer');
    expect(text.toLowerCase()).not.toContain('x-internal-token');
  });

  it('walks every state and keeps the tone law: ok only for a reported fact', async () => {
    const states: EnginePostureView[] = [
      { state: 'unconfigured', checkedAtMs: null, status: null, reason: 'r', code: 'UNCONFIGURED' },
      { state: 'unverified', checkedAtMs: null, status: null, reason: 'r', code: 'ENGINE_UNREACHABLE' },
    ];
    for (const view of states) {
      const rows = serviceWith(null).rows(view);
      expect(rows.every((candidate) => candidate.tone === 'warn')).toBe(true);
    }
    const reported = serviceWith(reportedBody()).rows(
      await serviceWith(reportedBody()).read(),
    );
    expect(reported.some((candidate) => candidate.tone === 'ok')).toBe(true);
    expect(reported.every((candidate) => ['ok', 'warn', 'bad', 'neutral'].includes(candidate.tone))).toBe(
      true,
    );
  });
});

describe('Part 20 wiring - the panel section and the module that provides it', () => {
  it('the binding rule returns a client only for a deployment that can carry one', () => {
    // No token, no client - and not a client whose constructor throws while a panel is
    // asking a read-only question. Both halves are the same law, seen from either side.
    // The reference-deployment shape, first: NEITHER name present. This is the case the
    // compose comment leans on when it promises the API still boots without them, and in
    // JavaScript it is not obviously safe - `engineInternalClientConfigured` runs a RegExp
    // over `config.executionEngineUrl`, and a value that is `undefined` rather than `''`
    // could have thrown instead of failing to match. It does not: the pattern is tested
    // against the coerced string "undefined", which is not an http(s) URL, so the answer
    // is null and the panel says `unconfigured`. Pinned here so the promise cannot become
    // an accident of coercion.
    expect(
      createEnginePostureClient({
        executionEngineUrl: undefined,
        executionEngineToken: undefined,
      } as never),
    ).toBeNull();
    expect(
      createEnginePostureClient({
        executionEngineUrl: 'http://engine:8093',
        executionEngineToken: undefined,
      } as never),
    ).toBeNull();
    expect(
      createEnginePostureClient({
        executionEngineUrl: 'http://engine:8093',
        executionEngineToken: 'short',
      } as never),
    ).toBeNull();
    expect(
      createEnginePostureClient({
        executionEngineUrl: 'not-a-url',
        executionEngineToken: 't'.repeat(40),
      } as never),
    ).toBeNull();
    expect(
      createEnginePostureClient({
        executionEngineUrl: 'http://engine:8093',
        executionEngineToken: 't'.repeat(40),
      } as never),
    ).toBeInstanceOf(EngineInternalClient);
    // And when no client is bound, the panel still answers - with `unconfigured`.
    expect(ENGINE_POSTURE_CLIENT).toBe('ENGINE_POSTURE_CLIENT');
    expect(serviceWith(null).wired).toBe(false);
  });

  it('executionPanel appends the posture section after its own rows, in that order', async () => {
    const service = new ObservabilityService(
      { client: {} } as never,
      {
        order: { groupBy: async () => [{ status: 'FILLED', _count: { _all: 2 } }] },
        executionIncident: { count: async () => 0 },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { section: async () => ({ title: 'ENGINE POSTURE', rows: [{ label: 'l', value: 'v', tone: 'neutral' as const }] }) } as never,
      { setContext: () => undefined } as never,
    );
    jest.spyOn(service as unknown as { tradingReadiness: () => unknown }, 'tradingReadiness').mockResolvedValue({
      gates: [],
    } as never);
    const sections = await service.executionPanel('tenant-a');
    expect(sections.map((section) => section.title)).toEqual(['EXECUTION', 'ENGINE POSTURE']);
    expect(sections[0]?.rows.some((candidate) => candidate.label === 'orders 24h [FILLED]')).toBe(
      true,
    );
    expect(sections[1]?.rows).toEqual([{ label: 'l', value: 'v', tone: 'neutral' }]);
  });
});
