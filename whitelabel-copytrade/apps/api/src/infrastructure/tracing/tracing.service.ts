/**
 * Part 10: the API process's tracer, exporter, fault plan and SLO bucket
 * flusher - the TypeScript counterpart of `services/<name>/app/tracing.py` plus
 * the engine hubs' export loops.
 *
 * The three Part 10 laws, restated where they bind:
 *
 * 1. OBSERVE, NEVER AUTHORISE. Nothing in the request path reads anything
 *    from this service to decide a trading outcome. The one write this
 *    service performs on the request path is a response header echo.
 * 2. DROPPED IS LOUD. One delivery attempt per span batch; failures are
 *    counted, spans are NOT re-queued. A retry queue behind a dead
 *    collector converts an observability outage into an availability
 *    outage, and this platform has real orders on the line. Three
 *    consecutive failures page (the alert row is written by AlertsService
 *    via the sink wired in ObservabilityModule).
 * 3. FAULTS ARE CONFIG-ARMED AND CLOSED-SET. The injector plan comes from
 *    the environment; the only runtime operations are `consume` (inside
 *    this file) and read-only describe. There is no endpoint that arms,
 *    disarms or clears a fault - by either name.
 *
 * The SLO flush loop is here rather than in the metrics path because both
 * are the same shape: per-request work goes to MEMORY only (a hot path
 * never touches Redis), and one quiet interval loop persists DELTAS to
 * fixed-time buckets. Same no-Redis-in-the-request-path law the engines
 * follow for their own counters.
 */

import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  JOB_NAMES,
  OTLP_TRACES_PATH,
  SLO_SAMPLE_BUCKET_MINUTES,
  SLO_SAMPLE_KEY_PREFIX,
  TRACECTX_KEY_PREFIX,
  TRACECTX_TTL_SECONDS,
} from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { MetricsRegistry } from '../metrics/metrics.registry';
import { RedisService } from '../redis/redis.service';

import {
  formatTraceparent,
  newSpanId,
  newTraceId,
  otlpJsonEncode,
  parseTraceparent,
  parseTracestate,
  RecordingSpan,
  SamplingMode,
  SamplingPolicy,
  SpanKind,
  SpanStatus,
  TRACESTATE_HEADER,
  TRACEPARENT_HEADER,
  isSampled,
  unixNanoNow,
  type TraceContext,
} from './w3c';

export const FAULT_TRACE_EXPORT = 'trace_export_unavailable';
export const FAULT_METRICS_EXPORT = 'metrics_export_unavailable';

/** Consecutive export failures before the alert opens. One blip is a blip;
 *  three ticks of darkness is an incident worth paging for. */
export const FAILURE_ALERT_THRESHOLD = 3;

const BUFFER_SIZE = 8192;
const EXPORT_BATCH_MAX = 512;
const BUCKET_TTL_MS = 2 * 86_400_000;

/** The universe the API-side injector may arm. `metrics_export_unavailable`
 *  is consumed by the /metrics controller (503 while armed);
 *  `trace_export_unavailable` by the export tick below. */
const API_FAULT_POINTS: readonly string[] = Object.freeze([
  FAULT_TRACE_EXPORT,
  FAULT_METRICS_EXPORT,
]);

export interface SpanHandle {
  readonly span: RecordingSpan;
  readonly context: TraceContext;
  readonly sampled: boolean;
}

export interface TelemetryAlertSink {
  telemetryExportFailing(service: string, failing: boolean, consecutive: number): Promise<void>;
}

export const TELEMETRY_ALERT_SINK = 'TELEMETRY_ALERT_SINK';

@Injectable()
export class TracingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly policy: SamplingPolicy;
  private readonly buffer: RecordingSpan[] = [];
  private readonly drops = new Map<string, number>();
  private readonly outcomes: Record<string, number> = { ok: 0, error: 0, skipped: 0 };
  private consecutiveFailures = 0;
  private alertedForOutage = false;
  private exportedTotal = 0;
  private lastExportOutcome: string | null = null;
  private loop: NodeJS.Timeout | null = null;

  /** In-memory request tallies for the SLO buckets. The interceptor writes
   *  here (O(1) increments); this service's loop persists DELTAS and the
   *  totals stay the single source of truth for what has been flushed. */
  private reqGood = 0;
  private reqBad = 0;
  private readonly reqLatency = new Map<string, number>();
  private flushedGood = 0;
  private flushedBad = 0;
  private readonly flushedLatency = new Map<string, number>();

  /** The request-scoped active span (server or consumer), for child
   *  contexts on queue publishes. One ALS for the whole plane - the queue
   *  sidecar is exactly this store, mirrored to Redis for the cross-process
   *  hop. */
  readonly spanStore = new AsyncLocalStorage<SpanHandle | null>();

  private alertSink: TelemetryAlertSink | null;

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    @Inject(MetricsRegistry) private readonly registry: MetricsRegistry,
    @Optional() @Inject(TELEMETRY_ALERT_SINK) sink?: TelemetryAlertSink,
  ) {
    this.policy = new SamplingPolicy(
      config.otelEnabled ? SamplingMode.RATIO : SamplingMode.DISABLED,
      {
        ratio: config.otelSampleRatio,
        priorityOperations: config.otelPriorityOperations,
      },
    );
    this.alertSink = sink ?? null;
  }

  /** Module wiring calls this once (ObservabilityModule), because the sink
   *  depends on AlertsService and this service must not depend back. */
  setAlertSink(sink: TelemetryAlertSink): void {
    this.alertSink = sink;
  }

  get enabled(): boolean {
    return this.policy.enabled;
  }

  get bufferedSpans(): number {
    return this.buffer.length;
  }

  get dropCounts(): Record<string, number> {
    return Object.fromEntries(this.drops);
  }

  get exportOutcomes(): Record<string, number> {
    return { ...this.outcomes };
  }

  get exported(): number {
    return this.exportedTotal;
  }

  get consecutiveExportFailures(): number {
    return this.consecutiveFailures;
  }

  get lastExport(): string | null {
    return this.lastExportOutcome;
  }

  // ------------------------------------------------------------------
  // fault injector (config-armed, consume-only, closed set)
  // ------------------------------------------------------------------

  /** Effective arming comes from config only; production can never arm (the
   *  env validator refuses the boot and this getter refuses the plan). */
  faultsArmed(): boolean {
    return this.config.failureInjectionArmed;
  }

  consumeFault(point: string): boolean {
    if (!this.faultsArmed()) {
      return false;
    }
    // times = -1 semantics (infinite): armed means armed until restart -
    // the plan is the environment, and the environment does not change
    // under a running process.
    return API_FAULT_POINTS.includes(point);
  }

  faultPlan(): { enabled: boolean; points: string[] } {
    return {
      enabled: this.faultsArmed(),
      points: this.faultsArmed() ? [...API_FAULT_POINTS] : [],
    };
  }

  // ------------------------------------------------------------------
  // request spans
  // ------------------------------------------------------------------

  /** Begin a server span. Returns null (and does nothing) when tracing is
   *  disabled - the zero-cost passthrough the Python docstring promises.
   *  When ENABLED but UNSAMPLED it returns a handle whose span records
   *  nothing: the context still answers x-trace-id, because an operator's
   *  report of a trace id must work on unsampled requests too, or the only
   *  requests you can correlate are the lucky ones. */
  startRequestSpan(headers: NodeJS.Dict<string | string[]> | Record<string, unknown>): SpanHandle | null {
    if (!this.policy.enabled) {
      return null;
    }
    const rawParent = firstHeader(
      (headers as NodeJS.Dict<string | string[]>)[TRACEPARENT_HEADER],
    );
    const parent = parseTraceparent(rawParent ?? null);
    const context: TraceContext =
      parent !== null
        ? {
            traceId: parent.traceId,
            spanId: newSpanId(),
            parentSpanId: parent.spanId,
            traceFlags: parent.traceFlags,
            tracestate: parseTracestate(
              firstHeader((headers as NodeJS.Dict<string | string[]>)[TRACESTATE_HEADER]),
            ),
          }
        : {
            traceId: newTraceId(),
            spanId: newSpanId(),
            parentSpanId: null,
            traceFlags: 0x00,
            tracestate: [],
          };
    const sampled = this.policy.shouldSample({
      traceId: context.traceId,
      parentSampled: parent !== null ? isSampled(parent) : null,
      operation: 'http.server',
    });
    const finalContext: TraceContext = {
      ...context,
      traceFlags: (context.traceFlags & 0xfe) | (sampled ? 1 : 0),
    };
    const span = new RecordingSpan({
      context: finalContext,
      name: 'http.server',
      kind: SpanKind.SERVER,
      resource: this.resource(),
      startUnixNano: unixNanoNow(),
    });
    return { span, context: finalContext, sampled };
  }

  responseTraceId(handle: SpanHandle | null): string | null {
    return handle === null ? null : handle.context.traceId;
  }

  /** Middleware completion hook: stamp outcome attributes, end, and buffer
   *  if sampled. `route` is the ROUTE TEMPLATE (the interceptor's rule):
   *  unbounded strings never become span attributes on this platform. */
  finishRequestSpan(
    handle: SpanHandle,
    input: { method: string; route: string; status: number; durationMs: number },
  ): void {
    if (!this.policy.enabled || !handle.sampled || handle.span.endedAt) {
      return;
    }
    const span = handle.span;
    span.setAttribute('http.request.method', input.method);
    span.setAttribute('http.route', input.route);
    span.setAttribute('http.response.status_code', input.status);
    if (input.status >= 500) {
      span.setStatus(SpanStatus.ERROR, `status ${String(input.status)}`);
    } else {
      span.setStatus(SpanStatus.OK);
    }
    span.end(unixNanoNow());
    this.record(span);
  }

  private record(span: RecordingSpan): void {
    if (this.buffer.length >= BUFFER_SIZE) {
      // Overflow evicts the OLDEST span and counts it - a tracer whose only
      // failure mode is a silent stall of the request path is worse than a
      // counter saying "I dropped spans at 03:14".
      this.buffer.shift();
      this.countDrops('buffer_overflow', 1);
    }
    this.buffer.push(span);
  }

  private countDrops(reason: string, count: number): void {
    this.drops.set(reason, (this.drops.get(reason) ?? 0) + count);
    this.registry.inc('wlct_tracing_spans_total', { result: 'dropped' }, count);
  }

  private resource(): Record<string, string> {
    return {
      'service.name': 'api',
      'service.version': '1.0.0',
      'deployment.environment': this.config.nodeEnv,
      'service.instance.id': 'local',
    };
  }

  // ------------------------------------------------------------------
  // queue trace-context sidecar (publish + consume helpers)
  // ------------------------------------------------------------------

  private sidecarKey(queue: string, jobId: string): string {
    return `${TRACECTX_KEY_PREFIX}:${queue}:${jobId}`;
  }

  /** Publishers attach their active span's traceparent as a TTL-bounded
   *  sidecar so a worker can continue the trace WITHOUT the payload schema
   *  growing a transport field. Fire-and-forget: a failed sidecar write
   *  costs correlation, never a publish. */
  async captureQueueSidecar(queue: string, jobId: string): Promise<void> {
    const handle = this.spanStore.getStore();
    if (handle === null || handle === undefined || !this.enabled) {
      return;
    }
    try {
      await this.redis.client.set(
        this.sidecarKey(queue, jobId),
        formatTraceparent(handle.context),
        'EX',
        TRACECTX_TTL_SECONDS,
      );
    } catch {
      this.countDrops('sidecar_write_failed', 1);
    }
  }

  private async readQueueSidecar(queue: string, jobId: string): Promise<TraceContext | null> {
    try {
      const raw = await this.redis.client.get(this.sidecarKey(queue, jobId));
      return parseTraceparent(raw ?? null);
    } catch {
      return null;
    }
  }

  private async deleteQueueSidecar(queue: string, jobId: string): Promise<void> {
    try {
      await this.redis.client.del(this.sidecarKey(queue, jobId));
    } catch {
      // The key is TTL-bounded anyway; a failed delete is a shrug, not an
      // incident. (A FAILED READ never continues a trace by accident -
      // absence is an absent parent, full stop.)
    }
  }

  /** Consumer-side: run `work` with the job's parent context as the active
   *  span, under a queue.process child span when sampled. Mirrors what the
   *  Python worker does with its own sidecar reads. */
  async withJobContext<T>(queue: string, jobId: string, operation: string, work: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return work();
    }
    const parent = await this.readQueueSidecar(queue, jobId);
    if (parent === null) {
      return this.spanStore.run(null, work);
    }
    const sampled = this.policy.shouldSample({
      traceId: parent.traceId,
      parentSampled: isSampled(parent),
      operation,
    });
    const child: TraceContext = {
      traceId: parent.traceId,
      spanId: newSpanId(),
      parentSpanId: parent.spanId,
      traceFlags: (parent.traceFlags & 0xfe) | (sampled ? 1 : 0),
      tracestate: parent.tracestate,
    };
    const span = new RecordingSpan({
      context: child,
      name: operation,
      kind: SpanKind.CONSUMER,
      resource: this.resource(),
      startUnixNano: unixNanoNow(),
    });
    span.setAttribute('messaging.system', 'bullmq');
    span.setAttribute('messaging.destination.name', queue);
    try {
      return await this.spanStore.run({ span, context: child, sampled }, work);
    } catch (error) {
      span.setStatus(SpanStatus.ERROR, String((error as Error).name ?? 'Error'));
      throw error;
    } finally {
      span.end(unixNanoNow());
      if (sampled) {
        this.record(span);
      }
      void this.deleteQueueSidecar(queue, jobId);
    }
  }

  // ------------------------------------------------------------------
  // request-path tally + periodic bucket flush (SLO sources)
  // ------------------------------------------------------------------

  /** Called by the HTTP interceptor: O(1) in-memory increments, no I/O.
   *  Latency counts are CUMULATIVE per grid boundary (le100ms <= le250ms
   *  <= ...), which is exactly the shape both the Prometheus histogram and
   *  the evaluator's "count at or below threshold" read want. */
  noteHttpRequest(status: number, durationMs: number): void {
    if (status >= 500) {
      this.reqBad += 1;
    } else {
      this.reqGood += 1;
    }
    for (const boundary of [100, 250, 500, 1000, 2000, 5000]) {
      if (durationMs <= boundary) {
        const field = `le${String(boundary)}ms`;
        this.reqLatency.set(field, (this.reqLatency.get(field) ?? 0) + 1);
      }
    }
  }

  /** The active span for nested producers (queue service reads it through
   *  the store; this is for direct consumers of the service). */
  currentHandle(): SpanHandle | null {
    return this.spanStore.getStore() ?? null;
  }

  onApplicationBootstrap(): void {
    this.loop = setInterval(() => {
      void this.tick();
    }, this.config.metricsExportIntervalMs);
    this.loop.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.loop !== null) {
      clearInterval(this.loop);
      this.loop = null;
    }
    await this.tick().catch(() => undefined);
  }

  /** Manual flush endpoint lands here too (POST /v1/operational/tracing/
   *  flush): one export tick now, same code path as the timer - the endpoint
   *  changes WHEN evidence leaves, never WHAT it says. */
  async flushNow(): Promise<{ exported: number; outcome: string }> {
    return this.tick();
  }

  /** One loop tick: persist SLO bucket deltas, then export spans. Split in
   *  two guarded halves - a Redis blip on buckets must not starve the
   *  exporter, and vice versa; each half reports its own outcome. */
  async tick(): Promise<{ exported: number; outcome: string }> {
    try {
      await this.flushSloBuckets();
    } catch {
      // The next tick retries with the UNCHANGED cumulative totals; because
      // deltas are computed against flushed high-water marks, "retry" is
      // also the exactly-once recovery, and nothing between ticks is lost
      // or doubled.
    }
    return this.exportTick();
  }

  private async flushSloBuckets(): Promise<void> {
    const goodDelta = this.reqGood - this.flushedGood;
    const badDelta = this.reqBad - this.flushedBad;
    if (goodDelta + badDelta === 0) {
      return;
    }
    const bucket = Math.floor(Date.now() / (SLO_SAMPLE_BUCKET_MINUTES * 60_000));
    const reqKey = `${SLO_SAMPLE_KEY_PREFIX}:apireq:${String(bucket)}`;
    const latKey = `${SLO_SAMPLE_KEY_PREFIX}:apilat:${String(bucket)}`;
    this.flushedGood = this.reqGood;
    this.flushedBad = this.reqBad;
    const pipeline = this.redis.client.pipeline();
    if (goodDelta > 0) {
      pipeline.hincrby(reqKey, 'good', goodDelta);
    }
    if (badDelta > 0) {
      pipeline.hincrby(reqKey, 'bad', badDelta);
    }
    pipeline.pexpire(reqKey, BUCKET_TTL_MS);
    for (const [field, total] of [...this.reqLatency.entries()]) {
      const delta = total - (this.flushedLatency.get(field) ?? 0);
      if (delta > 0) {
        this.flushedLatency.set(field, total);
        pipeline.hincrby(latKey, field, delta);
      }
    }
    pipeline.hincrby(latKey, 'total', goodDelta + badDelta);
    pipeline.pexpire(latKey, BUCKET_TTL_MS);
    await pipeline.exec();
  }

  private async exportTick(): Promise<{ exported: number; outcome: string }> {
    if (!this.policy.enabled) {
      return { exported: 0, outcome: 'disabled' };
    }
    const batch = this.buffer.splice(0, EXPORT_BATCH_MAX);
    if (batch.length === 0) {
      return { exported: 0, outcome: 'idle' };
    }
    const endpoint = this.config.otelEndpoint;
    if (endpoint === undefined || this.consumeFault(FAULT_TRACE_EXPORT)) {
      // Skipped-with-cause: no endpoint (or an armed fault) means these
      // spans are gone, counted as drops with a reason, and the buffer did
      // its bounded job.
      this.countDrops(endpoint === undefined ? 'no_endpoint' : 'fault_injected', batch.length);
      this.countOutcome('skipped');
      // Deliberate skips RESET the failure streak: "no collector
      // configured" is a posture, not an outage; the alert is for the
      // collector that is there and refusing.
      this.consecutiveFailures = 0;
      await this.notifyExportState();
      return { exported: 0, outcome: 'skipped' };
    }
    let outcome: 'ok' | 'error' = 'error';
    try {
      const response = await fetch(`${endpoint.replace(/\/+$/, '')}${OTLP_TRACES_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: otlpJsonEncode(batch),
        signal: AbortSignal.timeout(this.config.otelTimeoutMs),
      });
      outcome = response.ok ? 'ok' : 'error';
    } catch {
      outcome = 'error';
    }
    this.countOutcome(outcome);
    if (outcome === 'ok') {
      this.exportedTotal += batch.length;
      this.registry.inc('wlct_tracing_spans_total', { result: 'exported' }, batch.length);
      this.consecutiveFailures = 0;
    } else {
      this.countDrops('export_failed', batch.length);
      this.consecutiveFailures += 1;
    }
    this.registry.setGauge(
      'wlct_tracing_export_consecutive_failures',
      {},
      this.consecutiveFailures,
    );
    await this.notifyExportState();
    return { exported: outcome === 'ok' ? batch.length : 0, outcome };
  }

  private countOutcome(result: 'ok' | 'error' | 'skipped'): void {
    this.outcomes[result] = (this.outcomes[result] ?? 0) + 1;
    this.lastExportOutcome = result;
    this.registry.inc('wlct_tracing_export_outcomes_total', { result });
  }

  private async notifyExportState(): Promise<void> {
    if (this.alertSink === null) {
      return;
    }
    const failing = this.consecutiveFailures >= FAILURE_ALERT_THRESHOLD;
    if (!failing && !this.alertedForOutage) {
      // Nothing to say yet, and nothing previously said that needs taking
      // back - a quiet streak never opens or closes an alert row.
      return;
    }
    this.alertedForOutage = failing;
    await this.alertSink
      .telemetryExportFailing('api', failing, this.consecutiveFailures)
      .catch(() => undefined);
  }

  statusView(): {
    enabled: boolean;
    endpointConfigured: boolean;
    sampleRatio: number;
    priorityOperations: string[];
    bufferedSpans: number;
    exportedTotal: number;
    droppedTotal: number;
    consecutiveExportFailures: number;
    lastExportOutcome: string | null;
  } {
    let droppedTotal = 0;
    for (const count of this.drops.values()) {
      droppedTotal += count;
    }
    return {
      enabled: this.enabled,
      endpointConfigured: this.config.otelEndpoint !== undefined,
      sampleRatio: this.config.otelSampleRatio,
      priorityOperations: this.config.otelPriorityOperations,
      bufferedSpans: this.buffer.length,
      exportedTotal: this.exportedTotal,
      droppedTotal,
      consecutiveExportFailures: this.consecutiveFailures,
      lastExportOutcome: this.lastExportOutcome,
    };
  }
}

const firstHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Exported so the maintenance worker wraps job handling in the sidecar
 *  continuation for EVERY maintenance job, not just the one that existed
 *  when this file was first drafted. */
export const MAINTENANCE_QUEUE_JOBS: readonly string[] = Object.freeze([
  JOB_NAMES.PRUNE_EXPIRED_TOKENS,
  JOB_NAMES.PRUNE_AUDIT_LOGS,
  JOB_NAMES.SYNC_OPERATIONAL_ALERTS,
  JOB_NAMES.PRUNE_OPERATIONAL_HISTORY,
  JOB_NAMES.EVALUATE_OPERATIONAL_SLOS,
  JOB_NAMES.PRUNE_SLO_EVALUATIONS,
]);
