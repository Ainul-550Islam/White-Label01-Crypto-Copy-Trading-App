/**
 * Part 10 (reliability) wire types for the SLO surface.
 *
 * The engine-side authority for all of this is the Python package
 * `wlct_trading.slo` (model.py, budget.py, burn.py, evaluate.py,
 * catalog.py); these TypeScript declarations mirror it and are
 * parity-tested against the committed vectors in
 * `docs/fixtures/reliability_fixtures.json`. Two rules travel with every
 * number here:
 *
 * 1. Every comparable quantity is an INTEGER in ppm or a canonical DECIMAL
 *    STRING - never a float. The same discipline as money everywhere else on
 *    this platform; the reason is identical (checksums must not wobble).
 * 2. These views MEASURE and PAGE. They never authorise: nothing on this
 *    surface can widen, unlock, or resume anything. A red SLO is a question
 *    for a human, answered elsewhere.
 */

/** The five evaluation states (mirror of wlct_trading.slo.model.SloState). */
export enum SloState {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  EXHAUSTED = 'EXHAUSTED',
  /** Measurement missing or incomplete. Renders as UNKNOWN in the panel -
   *  never as HEALTHY ("no data" is not "all good") and never as a failure
   *  count. */
  UNKNOWN = 'UNKNOWN',
}

/** The nine closed indicator families (mirror of SloIndicator). No generic
 *  expression escape hatch exists on either side by design. */
export enum SloIndicator {
  AVAILABILITY = 'availability',
  REQUEST_SUCCESS_RATIO = 'request_success_ratio',
  QUEUE_PROCESSING_SUCCESS = 'queue_processing_success',
  QUEUE_FRESHNESS = 'queue_freshness',
  MARKET_DATA_FRESHNESS = 'market_data_freshness',
  RISK_STATE_FRESHNESS = 'risk_state_freshness',
  RECONCILIATION_FRESHNESS = 'reconciliation_freshness',
  LATENCY_THRESHOLD_COMPLIANCE = 'latency_threshold_compliance',
  ERROR_RATE_COMPLIANCE = 'error_rate_compliance',
}

/** Which window a burn-rate number belongs to (mirror of SloWindowKind). */
export enum SloWindowKind {
  SHORT = 'short',
  LONG = 'long',
}

/** The AND-window alert verdict for one evaluation tick. `fast` and `slow`
 *  map to their paging rules; `both` is what a >= fast breach reports when
 *  the fast threshold is at or above the slow one (documented degeneracy of
 *  the classic multi-window design, parity-pinned). */
export enum SloBurnAlertKind {
  NONE = 'none',
  FAST = 'fast',
  SLOW = 'slow',
  BOTH = 'both',
}

/** The closed fault-point universe (mirror of wlct_trading.observability.
 *  faults.FAULT_POINTS). Listing these is READ-ONLY documentation of what
 *  a configuration could arm in a non-production deployment; there is no
 *  API that arms anything, by either name, at runtime. */
export enum SloFaultPoint {
  METRICS_EXPORT_UNAVAILABLE = 'metrics_export_unavailable',
  TRACE_EXPORT_UNAVAILABLE = 'trace_export_unavailable',
  REDIS_HEALTH_PROBE_UNAVAILABLE = 'redis_health_probe_unavailable',
  POSTGRES_HEALTH_PROBE_UNAVAILABLE = 'postgres_health_probe_unavailable',
  QUEUE_OBSERVED_DELAY = 'queue_observed_delay',
  QUEUE_OBSERVED_FAILURE = 'queue_observed_failure',
  MARKET_DATA_STALE_SIMULATED = 'market_data_stale_simulated',
  RISK_SNAPSHOT_STALE_SIMULATED = 'risk_snapshot_stale_simulated',
  RECONCILIATION_DELAY_SIMULATED = 'reconciliation_delay_simulated',
  ALERT_PERSISTENCE_FAILURE = 'alert_persistence_failure',
}

/** One SLO definition as the panel renders it. `objective` is the canonical
 *  decimal STRING exactly as the engine stores it ("99.5"); ppm integers
 *  carry the derived quantities. */
export interface SloDefinitionView {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: SloIndicator;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  /** Microseconds as decimal strings (the platform 64-bit rule), null
   *  exactly when the indicator shape forbids the field. */
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

/** One evaluation row. Null ppm fields mean "undefined for this window",
 *  never zero. */
export interface SloEvaluationView {
  sloId: string;
  version: number;
  checksum: string;
  indicator: SloIndicator;
  service: string;
  state: SloState;
  evaluatedAtMicros: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  targetPpm: number;
  actualPpm: number | null;
  budgetTotalEvents: number;
  budgetConsumedEvents: number;
  budgetRemainingEvents: number;
  remainingRatioPpm: number | null;
  longBurnPpm: number | null;
  shortBurnPpm: number | null;
  alertKind: SloBurnAlertKind;
  samplesGood: number;
  samplesBad: number;
  dataComplete: boolean;
  reason: string | null;
}

/** Definition plus its latest evaluation (and the burn alert that follows
 *  from it), the unit the panel table renders. */
export interface SloStatusView {
  definition: SloDefinitionView;
  latest: SloEvaluationView | null;
  /** True when the latest evaluation's burn verdict pages (both-window AND). */
  burnAlerting: boolean;
}

/** The scorecard rollup: counts, the worst remaining budget, and which SLOs
 *  currently fail. Feeds the observability panel; feeds nothing else. */
export interface SloReadinessView {
  evaluatedAtMicros: string;
  total: number;
  byState: Record<SloState, number>;
  /** Minimum remaining-budget ratio across evidenced SLOs (ppm), null when
   *  nothing is evidenced. The floor, not the average: one exhausted
   *  objective is the headline. */
  worstRemainingRatioPpm: number | null;
  /** Maximum long-window burn across evidenced SLOs (ppm). */
  maxLongBurnPpm: number | null;
  /** sloIds in a paging state right now (CRITICAL/EXHAUSTED or alerting). */
  pagingSloIds: string[];
  /** sloIds whose latest tick is UNKNOWN - a measurement gap, listed so it
   *  cannot be silently averaged away. */
  unmeasuredSloIds: string[];
  /** Always present; always says the quiet part: these numbers may measure
   *  and page, they never authorise. */
  note: string;
}

/** Command body accepted by POST /v1/operational/slos/:sloId/config. The
 *  objective travels as a string for the reasons stated at the top of this
 *  file; the server re-canonicalises and re-checksums. */
export interface SloConfigUpdateDto {
  objective: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  owner: string;
  description: string;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm?: number;
  criticalBurnPpm?: number;
  maxAgeMicros?: string | null;
  latencyThresholdMicros?: string | null;
  enabled?: boolean;
}

/** Result envelope for a published definition or a manual evaluation. */
export interface SloCommandResultView {
  accepted: boolean;
  sloId: string;
  version: number;
  checksum: string;
  evaluation: SloEvaluationView | null;
}

/** Tracing posture of the API process (and, via the mirrored engines, of
 *  the plane - this view reports what THIS process knows). */
export interface TracingStatusView {
  enabled: boolean;
  endpointConfigured: boolean;
  sampleRatio: number;
  priorityOperations: string[];
  bufferedSpans: number;
  exportedTotal: number;
  droppedTotal: number;
  consecutiveExportFailures: number;
  lastExportOutcome: string | null;
}

/** The current request's trace identity, for the console's "copy trace id"
 *  affordance and nothing else. */
export interface CurrentTraceView {
  traceparent: string | null;
  traceId: string | null;
  spanId: string | null;
  sampled: boolean;
}

/** Fault-injection posture (read-only describe of the config-armed plan;
 *  `enabled` here reflects what the environment armed, nothing more). */
export interface FaultsStatusView {
  enabled: boolean;
  production: boolean;
  activePoints: SloFaultPoint[];
}
