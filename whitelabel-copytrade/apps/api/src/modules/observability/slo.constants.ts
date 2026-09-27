/**
 * Part 10 - SLO domain constants. Mirror of the Python single source of truth
 * at `wlct_trading/slo/` (model.py bounds, catalog.py defaults). The parity
 * spec (slo-parity.spec.ts) compares DEFAULT_SLO_CATALOG against
 * docs/fixtures/reliability_fixtures.json entry by entry, entry including the
 * descriptions: an SLO whose text drifts from the engine's is a different SLO
 * wearing the same id (its checksum would prove it).
 */

export const MIN_WINDOW_MINUTES = 5;
export const MAX_WINDOW_MINUTES = 10_080; // a week
export const DEFAULT_WARNING_BURN_PPM = 1_000_000; // 1.0x burn
export const DEFAULT_CRITICAL_BURN_PPM = 2_000_000; // 2.0x burn
export const DEFAULT_FAST_BURN_MULTIPLIER_PPM = 14_400_000;
export const DEFAULT_SLOW_BURN_MULTIPLIER_PPM = 6_000_000;

export const SLO_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}$/;
export const SLO_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@-]{0,63}$/;

export const SLO_INDICATORS = [
  'availability',
  'request_success_ratio',
  'queue_processing_success',
  'queue_freshness',
  'market_data_freshness',
  'risk_state_freshness',
  'reconciliation_freshness',
  'latency_threshold_compliance',
  'error_rate_compliance',
] as const;

export type SloIndicatorValue = (typeof SLO_INDICATORS)[number];

/** FRESHNESS_INDICATORS in model.py: shape law - these carry maxAgeMicros and
 *  must not carry a latency threshold. */
export const FRESHNESS_INDICATORS: ReadonlySet<SloIndicatorValue> = new Set([
  'queue_freshness',
  'market_data_freshness',
  'risk_state_freshness',
  'reconciliation_freshness',
]);

/** The five states, in the engine's declaration order (also the panel's
 *  severity order: UNKNOWN last, never first). */
export const SLO_STATES = ['HEALTHY', 'WARNING', 'CRITICAL', 'EXHAUSTED', 'UNKNOWN'] as const;
export type SloStateValue = (typeof SLO_STATES)[number];

// ---------------------------------------------------------------------------
// Sample bucket geometry (shared by the Python hub writer and this reader)
// ---------------------------------------------------------------------------

/** Minutes per sample bucket; buckets are whole multiples of this from the
 *  epoch, so both languages compute identical keys without calendars.
 */
export const SLO_SAMPLE_BUCKET_MINUTES = 10;

export const sloBucketIndex = (epochMillis: number): number =>
  Math.floor(epochMillis / (SLO_SAMPLE_BUCKET_MINUTES * 60_000));

export const sloBucketKey = (source: string, bucketIndex: number): string =>
  `wlct:trading:ops:slo:${source}:${bucketIndex}`;

/** Buckets outlive the longest window they can be read for by a factor of
 *  two; the storage is a couple of hashes an hour, not a time series. */
export const SLO_BUCKET_TTL_SECONDS = 2 * 7 * 86_400;

/** The latency-grid boundaries (ms) the API flush loop publishes. A
 *  definition whose threshold sits exactly on the grid (the catalog's 500ms
 *  does) measures exactly; elsewhere the evaluator uses the largest
 *  boundary not exceeding the threshold and says so in the row's reason -
 *  an honest approximation, never a silent one. */
export const SLO_LATENCY_GRID_MS = [100, 250, 500, 1000, 2000, 5000] as const;

/** Tick-ratio completeness: a window is "complete" when at least 95% of the
 *  ticks its source normally emits are present in the buckets. A fresh
 *  deployment therefore reports UNKNOWN for exactly one window - the
 *  honest answer to "what happened before we started looking". */
export const SLO_TICK_COMPLETENESS_RATIO_PPM = 950_000;

// ---------------------------------------------------------------------------
// The default catalog (values verbatim from catalog.py; see parity spec)
// ---------------------------------------------------------------------------

export interface SloCatalogEntry {
  readonly sloId: string;
  readonly service: string;
  readonly owner: string;
  readonly indicator: SloIndicatorValue;
  readonly objective: string;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly goodEvent: string;
  readonly badEvent: string;
  readonly description: string;
  readonly maxAgeMicros: string | null;
  readonly latencyThresholdMicros: string | null;
}

const RISK_FRESHNESS_MAX_AGE_MICROS = '4000000';
const MARKET_FRESHNESS_MAX_AGE_MICROS = '30000000';
const RECONCILIATION_MAX_AGE_MICROS = '900000000';
const QUEUE_AGE_MAX_MICROS = '240000000';
const API_LATENCY_THRESHOLD_MICROS = '500000';

export const DEFAULT_SLO_CATALOG: readonly SloCatalogEntry[] = Object.freeze([
  {
    sloId: 'api.availability',
    service: 'api',
    owner: 'platform-sre',
    indicator: 'availability',
    objective: '99.5',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'readiness check passed within the tick',
    badEvent: 'readiness check failed or timed out within the tick',
    description:
      "Share of evaluation ticks the API's own readiness probes (Postgres+Redis) " +
      'answered ready. Does not measure client-perceived availability.',
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'api.request-success',
    service: 'api',
    owner: 'platform-sre',
    indicator: 'request_success_ratio',
    objective: '99.5',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'status class 2xx/3xx/4xx',
    badEvent: 'status class 5xx',
    description: 'Non-5xx share of served HTTP requests (route-template labels only).',
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'queues.processing-success',
    service: 'queues',
    owner: 'platform-sre',
    indicator: 'queue_processing_success',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'job moved to completed',
    badEvent: 'job moved to failed after its final attempt',
    description:
      'Share of BullMQ jobs that completed without entering \'failed\' across ' +
      'the platform queues; control queues included, the execution queue\'s ' +
      "tighter policy lives in Part 9 alerting.",
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'queues.freshness',
    service: 'queues',
    owner: 'platform-sre',
    indicator: 'queue_freshness',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: "sampled tick: every queue's oldest-waiting age within 240000000 micros",
    badEvent:
      'sampled tick: any queue over 240000000 micros (unknown reads as bad here: ' +
      'a stalled collector is not freshness)',
    description: 'Oldest waiting job within 4 minutes on every sampled queue.',
    maxAgeMicros: QUEUE_AGE_MAX_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'market-data.freshness',
    service: 'market-data',
    owner: 'trading-platform',
    indicator: 'market_data_freshness',
    objective: '99.5',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'mirror present with status HEALTHY',
    badEvent: 'mirror present with DEGRADED/UNHEALTHY/STOPPED status',
    description:
      'Published health mirror reports HEALTHY (all tracked symbols within the ' +
      'cache budget) at the sampled tick.',
    maxAgeMicros: MARKET_FRESHNESS_MAX_AGE_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'risk-state.freshness',
    service: 'trading-engine',
    owner: 'trading-platform',
    indicator: 'risk_state_freshness',
    objective: '99.9',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'engine probe report: zero stale accounts',
    badEvent: 'engine probe report: one or more stale accounts, or no published snapshots at all',
    description:
      "Every account's newest published snapshot within twice the live gate's " +
      'staleness budget. The GATE still refuses beyond 1x; a red SLO here means ' +
      'the refusals are chronic.',
    maxAgeMicros: RISK_FRESHNESS_MAX_AGE_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'execution.reconciliation-freshness',
    service: 'trading-engine',
    owner: 'trading-platform',
    indicator: 'reconciliation_freshness',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'last clean pass age within 900000000 micros',
    badEvent: 'last clean pass older than 900000000 micros or never observed',
    description:
      'A clean reconciliation pass within 15 minutes for the durable view. ' +
      "Blindness counts bad on purpose: 'we do not know' is operationally " +
      "'we did not run'.",
    maxAgeMicros: RECONCILIATION_MAX_AGE_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'api.latency-compliance',
    service: 'api',
    owner: 'platform-sre',
    indicator: 'latency_threshold_compliance',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'duration within 500000 micros',
    badEvent: 'duration over 500000 micros',
    description:
      'Share of served requests whose SERVER-SIDE handling finished under ' +
      '500ms. Venue round-trips and network time are excluded: the histogram ' +
      'observes this process, not a promise about any other.',
    maxAgeMicros: null,
    latencyThresholdMicros: API_LATENCY_THRESHOLD_MICROS,
  },
  {
    sloId: 'trading-engine.error-rate',
    service: 'trading-engine',
    owner: 'trading-platform',
    indicator: 'error_rate_compliance',
    objective: '99.9',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'evaluation returned a decision (approved or refused)',
    badEvent: 'evaluation raised an internal error',
    description:
      'Share of pre-trade evaluations that ended in an internal fault, not a ' +
      'risk refusal. Refusals are never counted bad: an SLO must not punish ' +
      'the gate for doing its job.',
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
] satisfies readonly SloCatalogEntry[]);

/** The per-indicator sample bucket source names (the evaluator maps indicator
 *  -> sources; a source with no writer is an honest UNKNOWN, never a zero). */
export const SLO_SAMPLE_SOURCES: Readonly<Record<SloIndicatorValue, string>> = Object.freeze({
  availability: 'apiavail',
  request_success_ratio: 'apireq',
  queue_processing_success: 'queueproc',
  queue_freshness: 'queuefresh',
  market_data_freshness: 'mdfresh',
  risk_state_freshness: 'riskfresh',
  reconciliation_freshness: 'reconfresh',
  latency_threshold_compliance: 'apilat',
  error_rate_compliance: 'engineerr',
});

/** The alert rules the evaluator feeds into the durable fold (same ids the
 *  engine's alert catalog registers; the API writes rows because the API
 *  owns the table). */
export const SLO_ALERT_RULES = Object.freeze({
  fast: 'SLO_BURN_FAST',
  slow: 'SLO_BURN_SLOW',
  exhausted: 'SLO_BUDGET_EXHAUSTED',
  /// The measurement itself failed (collector silent, mirrors missing).
  /// Its own rule, deliberately WARNING, deliberately not a burn alert:
  /// "we stopped seeing it" must never read as "it stopped happening", and
  /// it must never read as a reliability failure of the OBJECTIVE either -
  /// it is a reliability failure of the EVIDENCE, and the panel says so.
  telemetryGap: 'SLO_TELEMETRY_GAP',
  exportFailing: 'TELEMETRY_EXPORT_FAILING',
} as const);
