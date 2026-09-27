import { createHash } from 'node:crypto';

import { SENSITIVE_FIELD_NAMES } from '@wlct/config';

/** Value shapes that must never appear as label values, mirrored from the
 *  platform redactor's VALUE_PATTERNS so one regex list governs logs and
 *  metrics alike in spirit: if it looks like a credential or a URL, it does
 *  not belong in a series identity. */
const VALUE_LEAK_PATTERNS: readonly RegExp[] = Object.freeze([
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/, // Stripe-style keys
  /:\/\//, // URL-shaped anything
]);

/**
 * The API-process counterpart of the Python platform registry
 * (`wlct_trading.observability.metrics`). One registry per process; the API
 * registers what it can honestly measure about itself - HTTP shape, process
 * facts, alert and queue gauges derived at scrape time - and renders the
 * Prometheus 0.0.4 text exposition.
 *
 * The policy here is not a re-translation for its own sake: the rules (label
 * allow-list, forbidden identifier names, wire-token values, fixed buckets,
 * a hard per-family series cap) mirror the Python package, and the jest
 * safety spec pins THREE things - this registry against the shared fixture's
 * exact rendered text, the label policy constants against the Python
 * package's live source, and the source-scan rules that keep order ids and
 * secrets out of labels entirely. Metrics aggregate; identifiers belong in
 * logs, which is what `correlationId` on audit rows and the
 * `x-correlation-id` header are for.
 *
 * Recording is never thrown at the request path: `record*` methods refuse
 * policy-violating label sets by COUNTING the refusal and returning, because
 * a metric must never be able to 500 a live call. Registration-time errors,
 * by contrast, throw loudly at boot - those are programmer errors, and a
 * service that starts with a broken family map has already lost the plot.
 */

export type MetricType = 'counter' | 'gauge' | 'histogram';

/** The shape `wlct_registry_series_overflow_total` uses on both sides. */
const OVERFLOW_NAME = 'wlct_registry_series_overflow_total';

/** Mirrors ``wlct_trading.observability.labels.WIRE_TOKEN_PATTERN``. */
const WIRE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,63}$/;
/** Mirrors ``labels.METRIC_NAME_PATTERN``. */
const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
/** Mirrors the label-name rule in ``labels.py``. */
const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Mirrors ``labels.FORBIDDEN_LABEL_NAMES`` (parity-tested against source). */
export const FORBIDDEN_LABEL_NAMES: ReadonlySet<string> = new Set([
  'order_id',
  'orderids',
  'client_order_id',
  'request_id',
  'correlation_id',
  'operation_id',
  'risk_decision_id',
  'idempotency_key',
  'session_id',
  'trace_id',
  'span_id',
  'user_id',
  'tenant_id',
  'account_id',
  'actor_id',
  'email',
  'phone',
  'ip',
  'api_key',
  'apikey',
  'api_secret',
  'secret',
  'password',
  'passphrase',
  'private_key',
  'token',
  'jwt',
  'authorization',
  'dsn',
  'connection_string',
  'database_url',
  'message',
  'reason',
  'description',
  'payload',
  'query',
  'url',
  'path',
]);

/** Mirrors ``labels.ALLOWED_LABEL_NAMES`` (parity-tested against source). */
export const ALLOWED_LABEL_NAMES: ReadonlySet<string> = new Set([
  'service',
  'component',
  'exchange',
  'market_type',
  'event_kind',
  'strategy_id',
  'result',
  'risk_code',
  'rule_id',
  'scope',
  'stage',
  'queue',
  'channel',
  'symbol',
  'dataset_kind',
  'trigger_type',
  'alert_type',
  'alert_state',
  'severity',
  'job_name',
  'method',
  'route',
  'status_class',
  'simulation',
  'feed_state',
  'pool_state',
  // Part 10 (reliability): SLO identity and window family. Added to the
  // Python allow-list in the same change; the parity spec reads the source
  // and will fail the build if either side forgets the other.
  'slo',
  'window_kind',
]);

/** Histogram buckets in SECONDS for HTTP-family latencies: 1ms .. 10s.
 *  Prometheus convention keeps HTTP histograms in seconds; the platform's
 *  microsecond families (pipeline transitions) keep microseconds. */
export const HTTP_BUCKETS_SECONDS: readonly number[] = Object.freeze([
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);

export class MetricPolicyError extends Error {}

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[-_\s]/g, '');
const SENSITIVE_LOOKUP = new Set(SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase()));

const isSensitiveKey = (key: string): boolean => {
  if (SENSITIVE_LOOKUP.has(key.toLowerCase())) {
    return true;
  }
  const normalised = normaliseKey(key);
  return (
    normalised.includes('password') ||
    normalised.includes('secret') ||
    normalised.includes('privatekey') ||
    normalised.includes('apikey') ||
    normalised.includes('accesstoken') ||
    normalised.includes('refreshtoken')
  );
};

interface RegisteredFamily {
  readonly name: string;
  readonly type: MetricType;
  readonly help: string;
  readonly labels: readonly string[];
  readonly buckets: readonly number[];
  /** Declared finite domains (e.g. a service's symbol set). */
  readonly bounds: Readonly<Record<string, ReadonlySet<string>>>;
  readonly series: Map<string, SeriesState>;
}

interface SeriesState {
  labels: ReadonlyMap<string, string>;
  value: number;
  buckets: number[];
  sum: number;
  count: number;
  /** sha-derived key for the map; canonical text for rendering order. */
  key: string;
  canonical: string;
}

interface RegisterOptions {
  bounds?: Record<string, ReadonlySet<string>>;
  buckets?: readonly number[];
}

const validateMetricName = (name: string): void => {
  if (!METRIC_NAME_PATTERN.test(name)) {
    throw new MetricPolicyError(`illegal metric name: ${JSON.stringify(name)}`);
  }
};

const validateLabelNames = (name: string, labels: readonly string[]): void => {
  const seen = new Set<string>();
  for (const label of labels) {
    if (!LABEL_NAME_PATTERN.test(label)) {
      throw new MetricPolicyError(`illegal label name ${JSON.stringify(label)} on ${name}`);
    }
    if (FORBIDDEN_LABEL_NAMES.has(label)) {
      throw new MetricPolicyError(
        `label ${JSON.stringify(label)} on ${name} is a forbidden label name: identifiers and ` +
          'secrets never become metric labels',
      );
    }
    if (!ALLOWED_LABEL_NAMES.has(label)) {
      throw new MetricPolicyError(`label ${JSON.stringify(label)} is not in the allow-list for ${name}`);
    }
    if (seen.has(label)) {
      throw new MetricPolicyError(`label ${JSON.stringify(label)} declared twice on ${name}`);
    }
    seen.add(label);
  }
};

const formatValue = (value: number): string => {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '+Inf' : '-Inf';
  }
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return String(value);
  }
  return String(value);
};

const escapeHelp = (text: string): string => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

export class MetricsRegistry {
  private readonly families = new Map<string, RegisteredFamily>();

  private refusals = 0;

  private readonly startedMs = Date.now();

  constructor(private readonly service: string) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(service)) {
      throw new MetricPolicyError(`service name ${JSON.stringify(service)} is not a wire token`);
    }
  }

  // ------------------------------------------------------------------
  // registration (boot-time; policy violations THROW)
  // ------------------------------------------------------------------
  registerCounter(name: string, help: string, labels: readonly string[], options: RegisterOptions = {}): void {
    this.register(name, 'counter', help, labels, Object.freeze([]), options);
  }

  registerGauge(name: string, help: string, labels: readonly string[], options: RegisterOptions = {}): void {
    this.register(name, 'gauge', help, labels, Object.freeze([]), options);
  }

  registerHistogram(
    name: string,
    help: string,
    labels: readonly string[],
    options: RegisterOptions = {},
  ): void {
    const buckets = options.buckets ?? HTTP_BUCKETS_SECONDS;
    const asArray = [...buckets];
    if (
      asArray.length === 0 ||
      asArray.some((value, index) => index > 0 && !(value > (asArray[index - 1] as number)))
    ) {
      throw new MetricPolicyError(`histogram ${name} needs strictly increasing bucket bounds`);
    }
    this.register(name, 'histogram', help, labels, Object.freeze(asArray), options);
  }

  private register(
    name: string,
    type: MetricType,
    help: string,
    labels: readonly string[],
    buckets: readonly number[],
    options: RegisterOptions,
  ): void {
    validateMetricName(name);
    if (this.families.has(name)) {
      throw new MetricPolicyError(`metric ${name} registered twice`);
    }
    validateLabelNames(name, labels);
    for (const [label, domain] of Object.entries(options.bounds ?? {})) {
      if (!labels.includes(label)) {
        throw new MetricPolicyError(`bounded label ${JSON.stringify(label)} on ${name} is not a declared label`);
      }
      if (domain.size === 0) {
        throw new MetricPolicyError(`bounded label ${JSON.stringify(label)} has an empty domain`);
      }
      for (const value of domain) {
        if (!WIRE_TOKEN_PATTERN.test(value)) {
          throw new MetricPolicyError(`bounded label value ${JSON.stringify(value)} for ${label} on ${name} is not a wire token`);
        }
      }
    }
    this.families.set(name, {
      name,
      type,
      help,
      labels: Object.freeze([...labels]),
      buckets,
      bounds: options.bounds ?? {},
      series: new Map<string, SeriesState>(),
    });
  }

  // ------------------------------------------------------------------
  // recording (request-time; policy violations REFUSE, never throw)
  // ------------------------------------------------------------------
  private resolveSeries(familyName: string, labels: Record<string, string>): SeriesState | undefined {
    const family = this.families.get(familyName);
    if (!family) {
      this.refusals += 1;
      return undefined;
    }
    const keys = Object.keys(labels);
    const same =
      keys.length === family.labels.length &&
      family.labels.every((label) => keys.includes(label));
    if (!same) {
      this.refusals += 1;
      return undefined;
    }
    for (const label of family.labels) {
      const value = labels[label];
      if (typeof value !== 'string' || !WIRE_TOKEN_PATTERN.test(value)) {
        this.refusals += 1;
        return undefined;
      }
      const domain = family.bounds[label];
      if (domain !== undefined && !domain.has(value)) {
        this.refusals += 1;
        return undefined;
      }
    }
    const canonical = family.labels
      .map((label) => `${label}\u0000${labels[label] as string}`)
      .join('\u0001');
    const key = createHash('sha256').update(canonical).digest('hex').slice(0, 24);
    const existing = family.series.get(key);
    if (existing) {
      return existing;
    }
    if (family.series.size >= MetricsRegistry.MAX_SERIES_PER_FAMILY) {
      this.refusals += 1;
      return undefined;
    }
    const created: SeriesState = {
      labels: new Map(family.labels.map((label) => [label, labels[label] as string])),
      value: 0,
      buckets: family.buckets.map(() => 0),
      sum: 0,
      count: 0,
      key,
      canonical,
    };
    family.series.set(key, created);
    return created;
  }

  static readonly MAX_SERIES_PER_FAMILY = 4096;

  inc(name: string, labels: Record<string, string>, amount = 1): void {
    if (amount < 0) {
      return; // counters never decrease; refuse silently at record time
    }
    const series = this.resolveSeries(name, labels);
    if (series) {
      series.value += amount;
    }
  }

  setGauge(name: string, labels: Record<string, string>, value: number): void {
    const series = this.resolveSeries(name, labels);
    if (series) {
      series.value = value;
    }
  }

  observe(name: string, labels: Record<string, string>, value: number): void {
    const family = this.families.get(name);
    if (family === undefined || family.type !== 'histogram') {
      this.refusals += 1;
      return;
    }
    const series = this.resolveSeries(name, labels);
    if (series === undefined) {
      return;
    }
    series.sum += value;
    series.count += 1;
    for (let index = 0; index < family.buckets.length; index += 1) {
      if (value <= (family.buckets[index] as number)) {
        series.buckets[index] = (series.buckets[index] as number) + 1;
        return;
      }
    }
  }

  /** Whether a family+label set WOULD be accepted; for tests and guards. */
  wouldAccept(name: string, labels: Record<string, string>): boolean {
    const family = this.families.get(name);
    if (!family) {
      return false;
    }
    const keys = Object.keys(labels);
    if (keys.length !== family.labels.length || !family.labels.every((label) => keys.includes(label))) {
      return false;
    }
    return family.labels.every((label) => {
      const value = labels[label];
      if (typeof value !== 'string' || !WIRE_TOKEN_PATTERN.test(value)) {
        return false;
      }
      const domain = family.bounds[label];
      return domain === undefined || domain.has(value);
    });
  }

  hasFamily(name: string): boolean {
    return this.families.has(name);
  }

  familyNames(): string[] {
    return [...this.families.keys()].sort();
  }

  /** Renders the 0.0.4 exposition. Deterministic: families sorted, series
   *  sorted by their canonical label text, `service` appended like the
 *  Python renderer. */
  render(): string {
    const lines: string[] = [];
    lines.push(
      `# HELP ${OVERFLOW_NAME} New label sets refused by the per-family series cap.`,
      `# TYPE ${OVERFLOW_NAME} counter`,
      `${OVERFLOW_NAME}{service="${this.service}"} ${this.refusals}`,
    );
    for (const name of this.familyNames()) {
      const family = this.families.get(name) as RegisteredFamily;
      if (family.series.size === 0) {
        continue;
      }
      lines.push(`# HELP ${name} ${escapeHelp(family.help)}`);
      lines.push(`# TYPE ${name} ${family.type}`);
      const rows = [...family.series.values()].sort((a, b) => (a.canonical < b.canonical ? -1 : 1));
      for (const series of rows) {
        const rendered: Record<string, string> = { service: this.service };
        for (const [label, value] of series.labels) {
          rendered[label] = value;
        }
        const labelList = Object.keys(rendered)
          .sort()
          .map((label) => `${label}="${escapeLabelValue(rendered[label] as string)}"`)
          .join(',');
        const suffix = `{${labelList}}`;
        if (family.type === 'histogram') {
          let cumulative = 0;
          for (let index = 0; index < family.buckets.length; index += 1) {
            cumulative += series.buckets[index] as number;
            lines.push(
              `${name}_bucket{le="${formatValue(family.buckets[index] as number)}",${labelList}} ${cumulative}`,
            );
          }
          lines.push(`${name}_bucket{le="+Inf",${labelList}} ${series.count}`);
          lines.push(`${name}_sum${suffix} ${formatValue(series.sum)}`);
          lines.push(`${name}_count${suffix} ${series.count}`);
        } else {
          lines.push(`${name}${suffix} ${formatValue(series.value)}`);
        }
      }
    }
    return `${lines.join('\n')}\n`;
  }

  /** Node process facts, sampled at scrape time. Deliberately tiny: only
   *  what the process can measure honestly about itself. Restart detection
   *  is the uptime gauge FALLING in the scrape history - a counter the
   *  process keeps of its own restarts would be fiction, since the counter
   *  dies with the process. */
  sampleProcess(): void {
    this.ensureGauge('wlct_process_uptime_seconds', 'Seconds since process start; a fall over means a restart.', ['service']);
    this.setGauge('wlct_process_uptime_seconds', { service: this.service }, (Date.now() - this.startedMs) / 1000);

    this.ensureGauge('wlct_process_memory_rss_bytes', 'Resident set size in bytes.', ['service']);
    this.setGauge('wlct_process_memory_rss_bytes', { service: this.service }, process.memoryUsage().rss);

    this.ensureGauge('wlct_process_cpu_seconds_total', 'Process CPU seconds consumed (user + system), monotonic per process.', ['service']);
    const cpu = process.cpuUsage();
    this.setGauge(
      'wlct_process_cpu_seconds_total',
      { service: this.service },
      (cpu.user + cpu.system) / 1_000_000,
    );

    this.ensureGauge('wlct_process_open_handles', 'libuv active handles and requests.', ['service']);
    type WithHandles = typeof process & {
      _getActiveHandles?: () => unknown[];
      _getActiveRequests?: () => unknown[];
    };
    const proc = process as WithHandles;
    const handles =
      (proc._getActiveHandles?.().length ?? 0) + (proc._getActiveRequests?.().length ?? 0);
    this.setGauge('wlct_process_open_handles', { service: this.service }, handles);
  }

  /** Scans a would-be label set for anything secret-shaped or identifier-
   *  shaped BEFORE it is used; used by the module's own record helpers so
   *  misuse becomes a counted refusal, never an accidental high-cardinality
   *  series. Exported for the safety spec. */
  static assertLabelValuesSafe(labels: Record<string, string>): void {
    for (const [key, value] of Object.entries(labels)) {
      if (isSensitiveKey(key)) {
        throw new MetricPolicyError(`label ${JSON.stringify(key)} names a secret field`);
      }
      if (typeof value === 'string' && VALUE_LEAK_PATTERNS.some((pattern) => pattern.test(value))) {
        throw new MetricPolicyError(`label ${JSON.stringify(key)} must never carry URL- or credential-shaped values`);
      }
    }
  }

  private ensureGauge(name: string, help: string, labels: string[]): void {
    if (!this.families.has(name)) {
      this.register(name, 'gauge', help, labels, Object.freeze([]), {});
    }
  }
}
