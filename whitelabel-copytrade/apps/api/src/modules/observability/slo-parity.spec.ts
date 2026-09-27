/**
 * Part 10 cross-language parity: the committed fixtures under
 * docs/fixtures/reliability_fixtures.json are GENERATED from the Python
 * modules (libs/trading-core/scripts/gen_part10_fixtures.py executes
 * wlct_trading.observability.tracing/redaction/faults and wlct_trading.slo)
 * and this spec replays every vector through the TypeScript twins. The
 * guarantee this buys is the one the SLO plane lives or dies by: a burn
 * rate, a checksum, a sampled trace id, or an OTLP payload computed here is
 * the SAME number the engine's own tooling computes there - digit for
 * digit, byte for byte.
 *
 * If a vector fails, do NOT regenerate the fixture to make it pass: fix the
 * side that drifted, regenerate from Python, and let both move.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RecordingSpan,
  SamplingMode,
  SamplingPolicy,
  SpanKind,
  SpanStatus,
  formatTraceparent,
  formatTracestate,
  otlpJsonEncode,
  parseTraceparent,
  parseTracestate,
  safeAttribute,
  sha256Hex,
} from '../../infrastructure/tracing/w3c';
import {
  buildSloDefinition,
  canonicalSloJson,
  objectiveToPpm,
  sloChecksum,
} from './slo.canonical';
import { DEFAULT_SLO_CATALOG, SLO_INDICATORS, SLO_STATES } from './slo.constants';
import { computeBudget, evaluateBurn, evaluateSlo } from './slo.eval';
import { SloFaultPoint, SloIndicator, SloState, SloWindowKind } from '@wlct/shared-types';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..');

/* Typed view of the fixture file. Declared (not `any`) so the parity
 * assertions fail at COMPILE time when the fixture's shape drifts, and the
 * eslint no-explicit-any rule stays a live wire in the one file where `any`
 * would be most corrosive: the cross-language contract itself. */
interface FixtureEnums {
  sloStates: string[];
  sloIndicators: string[];
  sloWindowKinds: string[];
  samplingModes: string[];
  faultPoints: string[];
}
interface TraceparentValidRow {
  header: string;
  traceId: string;
  spanId: string;
  flags: number;
  sampled: boolean;
  reformat: string;
}
interface TracestateRow {
  header: string;
  members: Array<[string, string]>;
  reformat: string;
}
interface SamplingRow {
  mode: string;
  ratio: number;
  ratioPpm: number;
  traceId: string;
  parentSampled: boolean | null;
  operation: string;
  priorityOperations: string[];
  enabled: boolean;
  expected: boolean;
}
interface HygieneRow {
  key: string;
  value: string | number | boolean | null;
  kept: boolean;
  renderedKey: string;
  renderedValue: string | number | boolean;
}
interface WindowInput {
  good: number;
  bad: number;
  dataComplete: boolean;
  note: string | null;
}
interface BudgetRow {
  objective: string;
  good: number;
  bad: number;
  budget: Record<string, unknown>;
}
interface BurnRow {
  shortBurnPpm: number;
  longBurnPpm: number;
  fastThresholdPpm: number;
  slowThresholdPpm: number;
  expected: Record<string, unknown>;
}
interface CatalogRow {
  sloId: string;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: number | null;
  latencyThresholdMicros: number | null;
  checksum: string;
}
interface ChecksumVector {
  canonicalJson: string;
  engineChecksum: string;
  sha256: string;
}
interface EvalDefRow {
  sloid: string;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  windowminutes: number;
  shortwindowminutes: number;
  goodevent: string;
  badevent: string;
}
interface EvalRow {
  name: string;
  definition: EvalDefRow;
  longWindow: WindowInput;
  shortWindow: WindowInput;
  fastMultiplierPpm: number;
  slowMultiplierPpm: number;
  expected: Record<string, unknown> & { evaluatedAtMicros: string };
}
interface ReliabilityFixtures {
  enums: FixtureEnums;
  traceparent: {
    valid: TraceparentValidRow[];
    invalid: string[];
    tracestate: TracestateRow[];
  };
  sampling: { rows: SamplingRow[] };
  attributeHygiene: HygieneRow[];
  otlpJson: Record<string, string>;
  budgetRows: BudgetRow[];
  burnRows: BurnRow[];
  slo: {
    catalog: CatalogRow[];
    checksumVectors: ChecksumVector[];
    evaluations: EvalRow[];
  };
}
const fixtures = JSON.parse(
  readFileSync(join(repoRoot, 'docs', 'fixtures', 'reliability_fixtures.json'), 'utf8'),
) as ReliabilityFixtures;

describe('Part 10 enums (fixture-pinned)', () => {
  it('mirrors the SLO state universe', () => {
    expect([...SLO_STATES]).toEqual(
      expect.arrayContaining(fixtures.enums.sloStates),
    );
    expect(SLO_STATES.length).toBe(fixtures.enums.sloStates.length);
    expect(Object.values(SloState).sort()).toEqual([...fixtures.enums.sloStates].sort());
  });

  it('mirrors the indicator universe', () => {
    expect([...SLO_INDICATORS].sort()).toEqual([...fixtures.enums.sloIndicators].sort());
    expect(Object.values(SloIndicator).sort()).toEqual(
      [...fixtures.enums.sloIndicators].sort(),
    );
  });

  it('mirrors the window kinds', () => {
    expect(Object.values(SloWindowKind).sort()).toEqual(
      [...fixtures.enums.sloWindowKinds].sort(),
    );
  });

  it('mirrors the sampling modes', () => {
    expect(Object.values(SamplingMode).sort()).toEqual(
      [...fixtures.enums.samplingModes].sort(),
    );
  });

  it('mirrors the fault-point universe', () => {
    expect(Object.values(SloFaultPoint).sort()).toEqual(
      [...fixtures.enums.faultPoints].sort(),
    );
  });
});

describe('traceparent / tracestate (fixture-pinned)', () => {
  for (const row of fixtures.traceparent.valid) {
    it(`parses and reformats ${row.header}`, () => {
    const parsed = parseTraceparent(row.header);
    expect(parsed).not.toBeNull();
    expect(parsed!.traceId).toBe(row.traceId);
    expect(parsed!.spanId).toBe(row.spanId);
    expect(parsed!.traceFlags).toBe(row.flags);
    expect(formatTraceparent(parsed!)).toBe(row.reformat);
    });
  }

  for (const header of fixtures.traceparent.invalid) {
    it(`refuses ${JSON.stringify(header)}`, () => {
      expect(parseTraceparent(header)).toBeNull();
    });
  }

  it('round-trips tracestate members under the same keep/cap law', () => {
    for (const row of fixtures.traceparent.tracestate) {
      const members = parseTracestate(row.header);
      expect(members.map(([k, v]) => [k, v])).toEqual(row.members);
      expect(formatTracestate(members)).toBe(row.reformat);
    }
  });
});

describe('sampling policy (fixture-pinned)', () => {
  const knownModes: string[] = fixtures.enums.samplingModes;
  for (const row of fixtures.sampling.rows) {
    if (!knownModes.includes(row.mode)) {
      // A deliberately fabricated row (see the fixture generator's note):
      // its mode string is outside the enum ON PURPOSE, and its ratio/
      // ratioPpm pair is not constructible through the policy, so it cannot
      // go through the policy constructor in either language. What it pins
      // is the pure arithmetic under the threshold comparison - bucket <
      // ratioPpm * 2^64 / 10^6 - with the all-zero trace id that
      // Tracer.start_span would never let reach sampling. Assert exactly
      // that claim, in BigInt, no floats:
      it(`pure threshold arithmetic for the fabricated ${row.mode} row`, () => {
        const threshold = (1n << 64n) * BigInt(row.ratioPpm) / 1_000_000n;
        const bucket = BigInt(`0x${row.traceId.slice(0, 16)}`);
        expect(bucket < threshold).toBe(row.expected);
      });
      continue;
    }
    it(`samples ${row.mode}/${row.traceId.slice(0, 8)}/${row.operation}`, () => {
    const policy = new SamplingPolicy(row.mode as SamplingMode, {
      ratio: row.ratio,
      priorityOperations: row.priorityOperations,
    });
    expect(policy.enabled).toBe(row.enabled);
    expect(policy.ratioPpm).toBe(row.ratioPpm);
    expect(
      policy.shouldSample({
        traceId: row.traceId,
        parentSampled: row.parentSampled,
        operation: row.operation,
      }),
    ).toBe(row.expected);
    });
  }
  // The fixture's `bucket` values are deliberately NOT re-asserted here:
  // they exceed 2^53, which JSON.parse cannot carry exactly, and a float-
  // approximate parity check is worse than none. The verdict assertions
  // above re-derive each bucket through shouldSample's BigInt comparison,
  // so the arithmetic is under test; only its raw echo relies on the
  // generator.
});

describe('attribute hygiene (fixture-pinned)', () => {
  for (const row of fixtures.attributeHygiene) {
    it(`hygiene ${row.key}`, () => {
    const kept = safeAttribute(row.key, row.value);
    if (row.kept) {
      expect(kept).not.toBeNull();
      expect(kept!.key).toBe(row.renderedKey);
      expect(kept!.value).toBe(row.renderedValue);
    } else {
      expect(kept).toBeNull();
    }
    });
  }
});

describe('OTLP/JSON encoding (byte-exact fixtures)', () => {
  // The vectors were produced by the Python encoder over these exact span
  // shapes (the generator's make_span calls). Rebuilding them here - rather
  // than copying the strings - is the point: the encoder, not the test, is
  // what is being checked.
  const baseAttrs = {
    'trade.symbol': 'BTCUSDT',
    'risk.simulated': 'false',
    'risk.event_count': 0,
    approved: true,
  };
  const baseResource = { 'service.name': 'trading-engine', 'deployment.environment': 'test' };

  const makeBase = (over: Partial<ConstructorParameters<typeof RecordingSpan>[0]> = {}) =>
    new RecordingSpan({
      context: {
        traceId: 'a'.repeat(32),
        spanId: '1234567890abcdef',
        parentSpanId: null,
        traceFlags: 1,
        tracestate: [],
      },
      name: 'risk.evaluate',
      kind: SpanKind.INTERNAL,
      resource: { ...baseResource },
      startUnixNano: 1_700_000_000_000_000_000n,
      ...over,
    });

  const finish = (span: RecordingSpan, endNano: string) => {
    span.end(BigInt(endNano));
    return span;
  };

  it('empty', () => {
    expect(otlpJsonEncode([])).toBe(fixtures.otlpJson.empty);
  });

  it('single', () => {
    const span = makeBase();
    span.setAttribute('trade.symbol', 'BTCUSDT');
    span.setAttribute('risk.simulated', 'false');
    span.setAttribute('risk.event_count', 0);
    span.setAttribute('approved', true);
    span.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    span.setStatus(SpanStatus.OK);
    finish(span, '1700000000000001500');
    expect(otlpJsonEncode([span])).toBe(fixtures.otlpJson.single);
  });

  it('twoSpansOneResource', () => {
    const single = makeBase();
    for (const [k, v] of Object.entries(baseAttrs)) {
      single.setAttribute(k, v as string | number | boolean);
    }
    single.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    single.setStatus(SpanStatus.OK);
    finish(single, '1700000000000001500');

    const child = makeBase({
      context: {
        traceId: 'b'.repeat(32),
        spanId: 'fedcba0987654321',
        parentSpanId: '1234567890abcdef',
        traceFlags: 1,
        tracestate: [
          ['vendor', 'v=1'],
          ['solo', ''],
        ],
      },
      name: 'execution.transmit',
      kind: SpanKind.CLIENT,
    });
    for (const [k, v] of Object.entries(baseAttrs)) {
      child.setAttribute(k, v as string | number | boolean);
    }
    child.addEvent(
      'exception',
      {
        'exception.type': 'ConnectionError',
        'exception.message': '[REDACTED]@db:5432 down',
      },
      '1700000000000999999',
    );
    child.setStatus(SpanStatus.ERROR, 'connect postgres://u:p@db failed "quoted" \\n');
    child.droppedAttributes = 3;
    child.droppedEvents = 1;
    finish(child, '1700000000000001500');

    expect(otlpJsonEncode([child, single])).toBe(fixtures.otlpJson.twoSpansOneResource);
  });

  it('int64Edge', () => {
    const span = makeBase({
      context: {
        traceId: 'c'.repeat(32),
        spanId: 'ffffffffffffffff',
        parentSpanId: null,
        traceFlags: 1,
        tracestate: [],
      },
      startUnixNano: 9_223_372_036_854_775_807n,
    });
    span.setAttribute('big.count', 9_007_199_254_740_993n);
    span.setAttribute('neg', -7);
    span.setAttribute('zero', 0);
    span.setStatus(SpanStatus.UNSET);
    finish(span, '9223372036854775808');
    expect(otlpJsonEncode([span])).toBe(fixtures.otlpJson.int64Edge);
  });

  it('twoResources (grouped by sorted resource, spans by (start, trace, span))', () => {
    const single = makeBase();
    for (const [k, v] of Object.entries(baseAttrs)) {
      single.setAttribute(k, v as string | number | boolean);
    }
    single.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    single.setStatus(SpanStatus.OK);
    finish(single, '1700000000000001500');

    const child = makeBase({
      context: {
        traceId: 'b'.repeat(32),
        spanId: 'fedcba0987654321',
        parentSpanId: '1234567890abcdef',
        traceFlags: 1,
        tracestate: [
          ['vendor', 'v=1'],
          ['solo', ''],
        ],
      },
      name: 'execution.transmit',
      kind: SpanKind.CLIENT,
    });
    for (const [k, v] of Object.entries(baseAttrs)) {
      child.setAttribute(k, v as string | number | boolean);
    }
    child.addEvent(
      'exception',
      {
        'exception.type': 'ConnectionError',
        'exception.message': '[REDACTED]@db:5432 down',
      },
      '1700000000000999999',
    );
    child.setStatus(SpanStatus.ERROR, 'connect postgres://u:p@db failed "quoted" \\n');
    child.droppedAttributes = 3;
    child.droppedEvents = 1;
    finish(child, '1700000000000001500');

    const api = makeBase({
      context: {
        traceId: 'd'.repeat(32),
        spanId: 'abcdabcdabcdabcd',
        parentSpanId: null,
        traceFlags: 1,
        tracestate: [],
      },
      resource: { 'service.name': 'api' },
    });
    for (const [k, v] of Object.entries(baseAttrs)) {
      api.setAttribute(k, v as string | number | boolean);
    }
    api.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    api.setStatus(SpanStatus.OK);
    finish(api, '1700000000000001500');

    expect(otlpJsonEncode([api, single, child])).toBe(fixtures.otlpJson.twoResources);
  });
});

describe('error budget tables (fixture-pinned)', () => {
  for (const row of fixtures.budgetRows) {
    it(`budget ${row.objective} ${row.good}/${row.bad}`, () => {
    const budget = computeBudget(row.objective, { good: row.good, bad: row.bad });
    const expected = row.budget;
    expect({
      objectivePpm: budget.objectivePpm,
      allowedPpm: budget.allowedPpm,
      totalEvents: budget.totalEvents,
      goodEvents: budget.goodEvents,
      badEvents: budget.badEvents,
      failurePpm: budget.failurePpm,
      compliancePpm: budget.compliancePpm,
      budgetTotalEvents: budget.budgetTotalEvents,
      budgetConsumedEvents: budget.budgetConsumedEvents,
      budgetRemainingEvents: budget.budgetRemainingEvents,
      remainingRatioPpm: budget.remainingRatioPpm,
      burnPpm: budget.burnPpm,
      budgetZero: budget.budgetZero,
    }).toEqual(expected);
    });
  }
});

describe('burn-rate alerting (fixture-pinned)', () => {
  for (const row of fixtures.burnRows) {
    it(`burn ${String(row.shortBurnPpm)}/${String(row.longBurnPpm)}`, () => {
    const state = evaluateBurn({
      shortBurnPpm: row.shortBurnPpm,
      longBurnPpm: row.longBurnPpm,
      fastMultiplierPpm: row.fastThresholdPpm,
      slowMultiplierPpm: row.slowThresholdPpm,
    });
    expect({
      kind: state.kind,
      shortBurnPpm: state.shortBurnPpm,
      longBurnPpm: state.longBurnPpm,
      fastThresholdPpm: state.fastThresholdPpm,
      slowThresholdPpm: state.slowThresholdPpm,
    }).toEqual(row.expected);
    });
  }
});

describe('SLO canonicalisation and checksums (fixture-pinned)', () => {
  it('canonical JSON is idempotent on the Python spelling and hashes equal', () => {
    for (const vector of fixtures.slo.checksumVectors) {
      const reparsed = canonicalSloJson(JSON.parse(vector.canonicalJson));
      expect(reparsed).toBe(vector.canonicalJson);
      expect(sha256Hex(vector.canonicalJson)).toBe(vector.sha256);
      expect(vector.engineChecksum).toBe(vector.sha256);
    }
  });

  it('objectiveToPpm matches the Python conversion', () => {
    for (const entry of fixtures.slo.catalog) {
      expect(objectiveToPpm(entry.objective)).toBe(entry.objectivePpm);
    }
    expect(() => objectiveToPpm('100')).toThrow(/0 < objective < 100/);
    expect(() => objectiveToPpm('99.99999')).toThrow(/at most 4 decimal/);
  });

  it('every default catalog definition reproduces its Python checksum (which pins text too)', () => {
    const byId = new Map<string, CatalogRow>(fixtures.slo.catalog.map((e) => [e.sloId, e]));
    expect(DEFAULT_SLO_CATALOG.length).toBe(fixtures.slo.catalog.length);
    for (const entry of DEFAULT_SLO_CATALOG) {
      const vector = byId.get(entry.sloId);
      if (vector === undefined) {
        // Throwing (not a soft expect) keeps the compiler honest about the
        // rest of the block AND fails the test loudly if the fixture ever
        // loses a catalog entry: both languages pin the SAME nine ids.
        throw new Error(`fixture has no catalog entry for ${entry.sloId}`);
      }
      const definition = buildSloDefinition({
        sloId: entry.sloId,
        service: entry.service,
        description: entry.description,
        owner: entry.owner,
        indicator: entry.indicator,
        objective: entry.objective,
        windowMinutes: entry.windowMinutes,
        shortWindowMinutes: entry.shortWindowMinutes,
        goodEvent: entry.goodEvent,
        badEvent: entry.badEvent,
        maxAgeMicros: entry.maxAgeMicros,
        latencyThresholdMicros: entry.latencyThresholdMicros,
      });
      // The checksum covers description/goodEvent/badEvent, so this single
      // assertion is also the TEXT parity check: a reworded TS description
      // changes the digest and fails here.
      expect(sloChecksum(definition)).toBe(vector.checksum);
      expect(definition.objectivePpm).toBe(vector.objectivePpm);
      expect(1_000_000 - definition.objectivePpm).toBe(vector.allowedPpm);
      expect(definition.warningBurnPpm).toBe(vector.warningBurnPpm);
      expect(definition.criticalBurnPpm).toBe(vector.criticalBurnPpm);
      expect(definition.maxAgeMicros).toBe(
        vector.maxAgeMicros === null ? null : String(vector.maxAgeMicros),
      );
      expect(definition.latencyThresholdMicros).toBe(
        vector.latencyThresholdMicros === null
          ? null
          : String(vector.latencyThresholdMicros),
      );
    }
  });
});

describe('evaluation rows (fixture-pinned end to end)', () => {
  for (const row of fixtures.slo.evaluations) {
    it(`evaluate ${row.name}`, () => {
    const d: EvalDefRow = row.definition;
    // The generator serialised the dataclass fields lower-cased; map them
    // back to the canonical names the builder consumes.
    const definition = buildSloDefinition({
      sloId: d.sloid,
      service: d.service,
      description: d.description,
      owner: d.owner,
      indicator: d.indicator,
      objective: d.objective,
      windowMinutes: d.windowminutes,
      shortWindowMinutes: d.shortwindowminutes,
      goodEvent: d.goodevent,
      badEvent: d.badevent,
    });
    const checksum = sloChecksum(definition);
    const evaluation = evaluateSlo({
      definition,
      checksum,
      longWindow: {
        good: row.longWindow.good,
        bad: row.longWindow.bad,
        dataComplete: row.longWindow.dataComplete,
        note: row.longWindow.note,
      },
      shortWindow: {
        good: row.shortWindow.good,
        bad: row.shortWindow.bad,
        dataComplete: row.shortWindow.dataComplete,
        note: row.shortWindow.note,
      },
      evaluatedAtMicros: BigInt(row.expected.evaluatedAtMicros),
      fastMultiplierPpm: row.fastMultiplierPpm,
      slowMultiplierPpm: row.slowMultiplierPpm,
    });
    const expected = row.expected;
    expect({
      sloId: evaluation.sloId,
      version: evaluation.version,
      checksum: evaluation.checksum,
      indicator: evaluation.indicator,
      service: evaluation.service,
      state: evaluation.state,
      evaluatedAtMicros: evaluation.evaluatedAtMicros,
      windowMinutes: evaluation.windowMinutes,
      shortWindowMinutes: evaluation.shortWindowMinutes,
      targetPpm: evaluation.targetPpm,
      actualPpm: evaluation.actualPpm,
      budgetTotalEvents: evaluation.budgetTotalEvents,
      budgetConsumedEvents: evaluation.budgetConsumedEvents,
      budgetRemainingEvents: evaluation.budgetRemainingEvents,
      remainingRatioPpm: evaluation.remainingRatioPpm,
      longBurnPpm: evaluation.longBurnPpm,
      shortBurnPpm: evaluation.shortBurnPpm,
      alertKind: evaluation.alertKind,
      samplesGood: evaluation.samplesGood,
      samplesBad: evaluation.samplesBad,
      dataComplete: evaluation.dataComplete,
    }).toEqual(expected);
    });
  }
});
