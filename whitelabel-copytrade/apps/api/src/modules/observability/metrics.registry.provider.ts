import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { SSO_FAILURE_STAGES, SSO_LOGIN_RESULTS } from '../security/sso-flow.types';



/**
 * The one registry provider for the API process, configured with exactly the
 * families Part 9 documents. Registration lives in a factory function (not
 * the class constructor) because the class is generic infrastructure while
 * the FAMILY SET is this application's policy; the safety spec asserts the
 * registered label universe against the fixture.
 */
export const METRICS_SERVICE_NAME = 'api';

export function createMetricsRegistry(): MetricsRegistry {
  const registry = new MetricsRegistry(METRICS_SERVICE_NAME);

  registry.registerCounter('wlct_http_requests_total', 'HTTP requests by method, route template and status class.', [
    'method',
    'route',
    'status_class',
  ]);
  registry.registerHistogram(
    'wlct_http_request_duration_seconds',
    'HTTP request duration in seconds. Observations of this process; not a latency guarantee.',
    ['method', 'route', 'status_class'],
  );
  registry.registerGauge(
    'wlct_ops_alert_open_count',
    'Open operational alerts by severity, sampled at scrape time.',
    ['severity'],
    { bounds: { severity: new Set(['INFO', 'WARNING', 'CRITICAL', 'EMERGENCY']) } },
  );
  registry.registerGauge(
    'wlct_queue_waiting_jobs',
    'BullMQ waiting jobs per queue, sampled at scrape time.',
    ['queue'],
  );
  registry.registerGauge(
    'wlct_queue_oldest_waiting_age_ms',
    'Oldest waiting job age per queue in milliseconds (-1 = none).',
    ['queue'],
  );
  registry.registerCounter(
    'wlct_ops_alert_folds_total',
    'Alert-fold outcomes applied by the maintenance sync.',
    ['result'],
  );

  // --- Part 10: reliability families --------------------------------------
  // Tracing outcomes first: the exporter must be able to report darkness
  // even when nothing else about telemetry is configured.
  registry.registerCounter(
    'wlct_tracing_export_outcomes_total',
    'Trace export outcomes of this process (ok | error | skipped | idle).',
    ['result'],
  );
  registry.registerCounter(
    'wlct_tracing_spans_total',
    'Spans finished by this process, by export disposition (exported | dropped).',
    ['result'],
  );
  registry.registerGauge(
    'wlct_tracing_export_consecutive_failures',
    'Consecutive trace export failures (alert threshold at 3; reset by any success or deliberate skip).',
    [],
  );
  // SLO evaluation output. Gauges, not histograms: the evaluation tick IS
  // the sample, and re-deriving a time series from Prometheus here would
  // duplicate (and de-authorise) the durable evaluation rows.
  registry.registerGauge(
    'wlct_slo_state',
    'Latest evaluated SLO state per objective, encoded 0=HEALTHY 1=WARNING 2=CRITICAL 3=EXHAUSTED 4=UNKNOWN.',
    ['component', 'slo'],
    {
      // `component` is the closed service universe of the SLO plane; `slo`
      // is deliberately UNBOUNDED because custom objectives are the point:
      // its cardinality is bounded by the versioned table (and the write
      // path's sloId regex), not by a registry list that a legitimate new
      // objective would silently fall off of.
      bounds: {
        component: new Set(['api', 'queues', 'market-data', 'trading-engine']),
      },
    },
  );
  registry.registerGauge(
    'wlct_slo_error_budget_remaining_ppm',
    'Remaining error-budget ratio of the latest evaluation tick, ppm (0..1_000_000).',
    ['slo'],
  );
  registry.registerGauge(
    'wlct_slo_burn_rate_ppm',
    'Burn-rate of the latest evaluation tick per window, ppm. A gauge: the '
      + 'evaluation row is the authority; this exposes the same number for '
      + 'scrape-side dashboards that must not re-implement the math.',
    ['slo', 'window_kind'],
  );

  // --- Part 11: worker plane + read-replica routing ------------------------
  // Both families exist so the two NEW failure shapes of this part - a job
  // orbiting partitions and a fleet silently pinned to the primary - are
  // numbers with names, not vibes with dashboards. Labels are bounded at
  // registration exactly like every other family here: the ONLY legal
  // values are enumerated, so a bug cannot mint a new series per tenant.
  registry.registerCounter(
    'wlct_worker_deferred_jobs_total',
    'Jobs parked by the worker because this process does not hold the '
      + 'partition (a routing fact, not an execution failure).',
    ['queue'],
    { bounds: { queue: new Set(['trade-execution']) } },
  );
  registry.registerCounter(
    'wlct_worker_coordination_events_total',
    'Partition-claim transitions and coordination failures of this worker '
      + 'process (claim_gained | claim_lost | reconcile_failed | released | '
      + 'membership_updated | membership_fallback). The dimension rides the '
      + 'shared `result` label: the Part 9 label universe is closed and '
      + 'cross-language pinned, and adding a synonym label to it is how two '
      + 'dashboards diverge forever. The two membership_* values (Part 12) '
      + 'count registry-set changes and fallback-to-config ticks respectively '
      + '- an alerting-grade signal for "the registry is being leaned on".',
    ['result'],
    {
      bounds: {
        result: new Set([
          'claim_gained',
          'claim_lost',
          'reconcile_failed',
          'released',
          'membership_updated',
          'membership_fallback',
        ]),
      }
    },
  );
  registry.registerCounter(
    'wlct_read_routing_decisions_total',
    'Read-replica routing decisions (primary | replica | stale_fallback). '
      + 'A healthy replica fleet that is always stale looks identical to '
      + 'no replica from the application\'s point of view - this family is '
      + 'what makes that difference visible. Same closed label universe: '
      + '`result`, bounded.',
    ['result'],
    { bounds: { result: new Set(['primary', 'replica', 'stale_fallback']) } },
  );
  // Part 11 - single sign-on. Both families reuse the closed label universe
  // (`result`, `stage`) with enumerated values only: no tenant, provider
  // name, issuer, subject, email, state or any credential ever becomes a
  // label value.
  registry.registerCounter(
    'wlct_sso_logins_total',
    'SSO login attempts by outcome (started | succeeded | denied). '
      + '`succeeded` counts both sessions and 2FA challenges issued after a verified IdP response.',
    ['result'],
    { bounds: { result: new Set<string>(SSO_LOGIN_RESULTS) } },
  );
  registry.registerCounter(
    'wlct_sso_failures_total',
    'Refused SSO logins by the stage that refused them (state | nonce | pkce | token_validation | '
      + 'saml_verification | replay | identity_mapping | session_issuance | provider_outage | config). '
      + 'Reason codes live in the durable sso_audit_events table, not here.',
    ['stage'],
    { bounds: { stage: new Set<string>(SSO_FAILURE_STAGES) } },
  );

  return registry;
}
