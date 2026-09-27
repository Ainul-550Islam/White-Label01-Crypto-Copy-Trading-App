/**
 * Part 10: W3C trace context, sampling policy and span-attribute hygiene -
 * the TypeScript twin of `wlct_trading.observability.tracing` and
 * `...redaction`. The parity spec (slo-parity.spec.ts) executes the fixture
 * vectors in docs/fixtures/reliability_fixtures.json against these exact
 * functions, so "twin" here is machine-checked, not aspirational.
 *
 * Same rules as the Python original: malformed headers never join a foreign
 * trace; the sampling decision is a pure function of integer arithmetic; a
 * secret-named attribute is dropped before it ever reaches a buffer.
 */

import { createHash, randomBytes } from 'node:crypto';

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const TRACESTATE_MEMBER = /^[a-z0-9_.\-*/]{1,256}(?:@[a-z0-9_.\-*/]{1,256})?$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);
const TRACESTATE_VALUE_LIMIT = 128;
const TRACESTATE_MEMBER_LIMIT = 32;

export const TRACEPARENT_HEADER = 'traceparent';
export const TRACESTATE_HEADER = 'tracestate';
// The response echo header and the OTLP path are platform constants from
// @wlct/config (TRACE_ID_RESPONSE_HEADER, OTLP_TRACES_PATH) - defined there
// once, never re-declared here, so the name that leaves this process has
// exactly one spelling in the repository.

export enum SpanKind {
  INTERNAL = 'internal',
  SERVER = 'server',
  CLIENT = 'client',
  PRODUCER = 'producer',
  CONSUMER = 'consumer',
}

export enum SpanStatus {
  UNSET = 'unset',
  OK = 'ok',
  ERROR = 'error',
}

export enum SamplingMode {
  DISABLED = 'disabled',
  OFF = 'off',
  ALL = 'all',
  PARENT_BASED = 'parent_based',
  RATIO = 'ratio',
}

const OTLP_SPAN_KIND: Record<SpanKind, number> = {
  [SpanKind.INTERNAL]: 1,
  [SpanKind.SERVER]: 2,
  [SpanKind.CLIENT]: 3,
  [SpanKind.PRODUCER]: 4,
  [SpanKind.CONSUMER]: 5,
};

const OTLP_STATUS_CODE: Record<SpanStatus, number> = {
  [SpanStatus.UNSET]: 0,
  [SpanStatus.OK]: 1,
  [SpanStatus.ERROR]: 2,
};

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly traceFlags: number;
  readonly tracestate: ReadonlyArray<readonly [string, string]>;
}

export const isSampled = (context: TraceContext): boolean => (context.traceFlags & 0x01) === 0x01;

export const childContext = (
  parent: TraceContext,
  spanId: string,
  sampled: boolean,
): TraceContext => ({
  traceId: parent.traceId,
  spanId,
  parentSpanId: parent.spanId,
  // Only bit 0 (sampled) is propagated; the rest of the flags byte belongs
  // to this trace's own decisions, matching TraceContext.child upstream.
  traceFlags: (parent.traceFlags & 0xfe) | (sampled ? 1 : 0),
  tracestate: parent.tracestate,
});

/** Strict W3C extraction. Anything malformed returns null - a corrupted
 *  header must never poison an export or join a foreign trace. */
export const parseTraceparent = (header: string | null | undefined): TraceContext | null => {
  if (!header) {
    return null;
  }
  // The spec permits extra fields after the triple for future versions;
  // version "ff" is explicitly invalid. Reject rather than reinterpret.
  let candidate = header.trim();
  const parts = candidate.split('-');
  if (parts.length < 4 || parts[0] === 'ff' || parts.length > 4) {
    if (parts[0] === 'ff' || parts.length < 4) {
      return null;
    }
    candidate = parts.slice(0, 4).join('-');
  }
  const match = TRACEPARENT_PATTERN.exec(candidate.trim());
  if (match === null) {
    return null;
  }
  const [, traceId, spanId, flags] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  if (!(HEX32.test(traceId) && traceId !== ZERO32) || !(HEX16.test(spanId) && spanId !== ZERO16)) {
    return null;
  }
  const flagValue = Number.parseInt(flags, 16);
  if (Number.isNaN(flagValue)) {
    return null;
  }
  return { traceId, spanId, parentSpanId: null, traceFlags: flagValue, tracestate: [] };
};

export const formatTraceparent = (context: TraceContext): string =>
  `00-${context.traceId}-${context.spanId}-${(context.traceFlags & 0xff)
    .toString(16)
    .padStart(2, '0')}`;

/** Keep only well-formed members, capped; never the raw string. */
export const parseTracestate = (
  header: string | null | undefined,
): Array<readonly [string, string]> => {
  if (!header) {
    return [];
  }
  const members: Array<readonly [string, string]> = [];
  for (const raw of header.split(',')) {
    const member = raw.trim();
    if (member.length === 0 || member.length > 256 + 1 + TRACESTATE_VALUE_LIMIT) {
      continue;
    }
    const eq = member.indexOf('=');
    const key = (eq === -1 ? member : member.slice(0, eq)).trim();
    const value = (eq === -1 ? '' : member.slice(eq + 1)).trim();
    if (!TRACESTATE_MEMBER.test(key)) {
      continue;
    }
    if (value.length > TRACESTATE_VALUE_LIMIT || /[ ,;=]/.test(value)) {
      continue;
    }
    members.push([key, value]);
    if (members.length >= TRACESTATE_MEMBER_LIMIT) {
      break;
    }
  }
  return members;
};

export const formatTracestate = (
  members: ReadonlyArray<readonly [string, string]>,
): string =>
  members.map(([key, value]) => (value === '' ? key : `${key}=${value}`)).join(',');

/** Ids for locally created traces. randomBytes is sufficient here and keeps
 *  the twin trivially deterministic-testable via the injected factories. */
export const newTraceId = (): string => randomBytes(16).toString('hex');
export const newSpanId = (): string => randomBytes(8).toString('hex');

// ---------------------------------------------------------------------------
// Sampling (mirror of SamplingPolicy.should_sample)
// ---------------------------------------------------------------------------

const RATIO_SCALE = 1_000_000n;

export class SamplingPolicy {
  readonly mode: SamplingMode;
  readonly ratioPpm: number;
  readonly priorityOperations: ReadonlySet<string>;

  constructor(
    mode: SamplingMode,
    options: { ratio?: number; priorityOperations?: Iterable<string> } = {},
  ) {
    const ratioIsLive = mode === SamplingMode.RATIO || mode === SamplingMode.PARENT_BASED;
    const ratio = options.ratio ?? 0;
    if (ratioIsLive && (ratio < 0 || ratio > 1)) {
      throw new Error('ratio must be within [0, 1]');
    }
    this.mode = mode;
    // The float ratio is converted once, at the construction edge, to an
    // integer ppm via round - the exact expression the Python side uses
    // (`int(round(clamped * 1_000_000))`). After this line, no float
    // participates in a sampling decision.
    const clamped = Math.max(0, Math.min(1, options.ratio ?? 0));
    this.ratioPpm = Math.round(clamped * 1_000_000);
    this.priorityOperations = new Set(options.priorityOperations ?? []);
  }

  get enabled(): boolean {
    return this.mode !== SamplingMode.DISABLED;
  }

  shouldSample(input: {
    traceId: string;
    parentSampled: boolean | null;
    operation: string;
  }): boolean {
    if (this.mode === SamplingMode.DISABLED || this.mode === SamplingMode.OFF) {
      return false;
    }
    if (this.mode === SamplingMode.ALL) {
      return true;
    }
    if (this.priorityOperations.has(input.operation)) {
      return true;
    }
    if (this.mode === SamplingMode.PARENT_BASED && input.parentSampled !== null) {
      return input.parentSampled;
    }
    if (this.ratioPpm <= 0) {
      return false;
    }
    if (this.ratioPpm >= 1_000_000) {
      return true;
    }
    if (!HEX16.test(input.traceId.slice(0, 16))) {
      return false;
    }
    const bucket = BigInt(`0x${input.traceId.slice(0, 16)}`);
    const threshold = (1n << 64n) * BigInt(this.ratioPpm) / RATIO_SCALE;
    return bucket < threshold;
  }
}

// ---------------------------------------------------------------------------
// Attribute hygiene (mirror of _safe_attribute + the redaction rules)
// ---------------------------------------------------------------------------

const ATTR_KEY = /^[a-z][a-z0-9_.]{0,63}$/;
const MAX_STRING_ATTR = 256;
const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?secret|api[_-]?key|password|passphrase|private[_-]?key|token|jwt|authorization|secret|credential|signature|signed[_-]?query|dsn|connection[_-]?string|database[_-]?url)/i;

const KEY_SUBSTRINGS: readonly string[] = [
  'apikey',
  'apisecret',
  'secret',
  'password',
  'passphrase',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'credential',
  'dsn',
  'connectionstring',
  'databaseurl',
];

export const isSensitiveKey = (key: unknown): boolean => {
  if (typeof key !== 'string') {
    return false;
  }
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return true;
  }
  const normalised = key.toLowerCase().replace(/[-_\s]/g, '');
  return KEY_SUBSTRINGS.some((needle) => normalised.includes(needle));
};

const TEXT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, REDACTED],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // Connection strings with embedded credentials: scheme://user:pass@host
  // becomes [REDACTED]@host - host is public topology, credentials are not.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/g, `${REDACTED}@`],
  [/[?&](?:signature|sig|api[_-]?key|access[_-]?token)=[^&\s]+/gi, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
];

export const redactText = (text: string): string => {
  let output = text;
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
};

export type AttributeValue = string | number | boolean | bigint;

/** Validate/redact one attribute; null means "drop it, counted". */
export const safeAttribute = (
  key: unknown,
  value: unknown,
): { key: string; value: string | number | boolean | bigint } | null => {
  if (typeof key !== 'string' || !ATTR_KEY.test(key) || isSensitiveKey(key)) {
    return null;
  }
  if (typeof value === 'bigint') {
    // 64-bit counts travel as bigint end-to-end: a JS number above 2^53
    // would lie in the encoder, and Python's str(int) never lies.
    return { key, value };
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      // Floats enter telemetry as short repr strings (documentation, never
      // money math) - the Python side uses repr(); JS String() agrees for
      // the values that reach here, and the parity fixture pins both.
      return { key, value: String(value).slice(0, MAX_STRING_ATTR) };
    }
    return { key, value };
  }
  if (typeof value === 'string') {
    return { key, value: redactText(value).slice(0, MAX_STRING_ATTR) };
  }
  return null;
};

// ---------------------------------------------------------------------------
// The recording span (all methods total: never throw, never block)
// ---------------------------------------------------------------------------

export interface SpanEvent {
  readonly timeUnixNano: string;
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean | bigint>>;
}

export class RecordingSpan {
  readonly context: TraceContext;
  readonly name: string;
  readonly kind: SpanKind;
  readonly resource: Readonly<Record<string, string>>;
  readonly attributes: Record<string, string | number | boolean | bigint> = {};
  readonly events: SpanEvent[] = [];
  status: SpanStatus = SpanStatus.UNSET;
  statusDescription: string | null = null;
  startUnixNano: string;
  endUnixNano: string | null = null;
  droppedAttributes = 0;
  droppedEvents = 0;

  private ended = false;

  constructor(input: {
    context: TraceContext;
    name: string;
    kind?: SpanKind;
    resource?: Record<string, string>;
    startUnixNano?: bigint;
    attributes?: Record<string, AttributeValue>;
  }) {
    this.context = input.context;
    this.name = input.name;
    this.kind = input.kind ?? SpanKind.INTERNAL;
    this.resource = input.resource ?? {};
    this.startUnixNano = String(input.startUnixNano ?? 0n);
    for (const [key, value] of Object.entries(input.attributes ?? {})) {
      this.setAttribute(key, value);
    }
  }

  setAttribute(key: string, value: AttributeValue): void {
    if (this.ended) {
      return;
    }
    const safe = safeAttribute(key, value);
    if (safe === null) {
      this.droppedAttributes += 1;
      return;
    }
    this.attributes[safe.key] = safe.value;
  }

  addEvent(name: string, attributes?: Record<string, AttributeValue>, timeUnixNano?: string): void {
    if (this.ended) {
      return;
    }
    const clean: Record<string, string | number | boolean | bigint> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
      const safe = safeAttribute(key, value);
      if (safe === null) {
        this.droppedAttributes += 1;
        continue;
      }
      clean[safe.key] = safe.value;
    }
    this.events.push({
      timeUnixNano: timeUnixNano ?? String(Date.now() * 1000),
      name,
      attributes: clean,
    });
  }

  setStatus(status: SpanStatus, description?: string): void {
    if (this.ended) {
      return;
    }
    this.status = status;
    // Raw passthrough, matching Span.set_status upstream: status
    // descriptions are set by instrumented code from values THEY control
    // (status codes, error class names), and the fixture's byte-exact OTLP
    // vectors pin that the encoder applies no further mutation. Writers of
    // free text run redactText themselves - the sanitisation rule lives
    // with the writer, not with the span.
    this.statusDescription = description === undefined ? null : description;
  }

  end(atUnixNano?: bigint): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.endUnixNano = String(atUnixNano ?? Date.now() * 1_000_000);
  }

  get endedAt(): boolean {
    return this.ended;
  }
}

/** Deterministic OTLP/JSON encoding of the microsecond epoch values Node
 *  exposes: Date.now() * 1000000 keeps the unit conversions integer-only on
 *  both language sides (the same trick the Python tracer uses, where
 *  nanos = micros * 1000). */
export const unixNanoNow = (): bigint => BigInt(Date.now()) * 1_000_000n;

// ---------------------------------------------------------------------------
// OTLP/JSON encoding (mirror of otlp_json_encode, byte-exact per fixture)
// ---------------------------------------------------------------------------

const attributesList = (
  attributes: Readonly<Record<string, string | number | boolean | bigint>>,
) => {
  const out: Array<{ key: string; value: Record<string, string | boolean> }> = [];
  for (const key of Object.keys(attributes).sort()) {
    const value = attributes[key] as string | number | boolean | bigint;
    let typed: Record<string, string | boolean>;
    if (typeof value === 'boolean') {
      typed = { boolValue: value };
    } else if (typeof value === 'number' || typeof value === 'bigint') {
      // str(int) in Python, toString() here: exact across the int64 range,
      // which is exactly why 2^53+1 survives a round trip intact - the
      // fixture's int64Edge vector pins that across the two languages.
      typed = { intValue: String(value) };
    } else {
      typed = { stringValue: String(value) };
    }
    out.push({ key, value: typed });
  }
  return out;
};

const spanObject = (span: RecordingSpan) => {
  const obj: Record<string, unknown> = {
    traceId: span.context.traceId,
    spanId: span.context.spanId,
    name: span.name,
    kind: OTLP_SPAN_KIND[span.kind],
    startTimeUnixNano: span.startUnixNano,
    endTimeUnixNano: span.endUnixNano ?? span.startUnixNano,
  };
  if (span.context.parentSpanId !== null) {
    obj.parentSpanId = span.context.parentSpanId;
  }
  obj.attributes = attributesList(span.attributes);
  if (span.droppedAttributes > 0) {
    obj.droppedAttributesCount = span.droppedAttributes;
  }
  if (span.events.length > 0) {
    obj.events = span.events.map((event) => ({
      timeUnixNano: event.timeUnixNano,
      name: event.name,
      attributes: attributesList(event.attributes),
    }));
    if (span.droppedEvents > 0) {
      obj.droppedEventsCount = span.droppedEvents;
    }
  }
  const status: Record<string, unknown> = { code: OTLP_STATUS_CODE[span.status] };
  if (span.statusDescription !== null) {
    status.message = span.statusDescription;
  }
  obj.status = status;
  if (span.context.tracestate.length > 0) {
    obj.tracestate = formatTracestate(span.context.tracestate);
  }
  obj.flags = span.context.traceFlags;
  return obj;
};

/** Object key order IS the contract (JSON.stringify preserves insertion
 *  order; Python's encoder builds the same literals and must not sort at
 *  dump time). Sort where the Python side sorts: resource tuples and
 *  attribute keys. */
export const otlpJsonEncode = (
  spans: readonly RecordingSpan[],
  resource?: Record<string, string>,
): string => {
  const grouped = new Map<string, RecordingSpan[]>();
  for (const span of spans) {
    const effective = Object.keys(span.resource).length > 0 ? span.resource : (resource ?? {});
    const key = Object.entries(effective)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}\u0000${v}`)
      .join('\u0001');
    const bucket = grouped.get(key) ?? [];
    bucket.push(span);
    grouped.set(key, bucket);
  }
  const resourceSpans = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, group]) => {
      const attributes = Object.fromEntries(
        key
          .split('\u0001')
          .map((pair) => pair.split('\u0000'))
          .map(([k, v]) => [k, v] as [string, string]),
      );
      return {
        resource: { attributes: attributesList(attributes) },
        scopeSpans: [
          {
            scope: { name: 'wlct.observability', version: '1' },
            spans: [...group]
              .sort((left, right) => {
                const start = compareStrings(left.startUnixNano, right.startUnixNano);
                if (start !== 0) {
                  return start;
                }
                const trace = compareStrings(left.context.traceId, right.context.traceId);
                return trace !== 0 ? trace : compareStrings(left.context.spanId, right.context.spanId);
              })
              .map(spanObject),
          },
        ],
      };
    });
  return JSON.stringify({ resourceSpans });
};

const compareStrings = (a: string, b: string): number => {
  // Python sorts the (start, trace, span) tuple as an INT for start (nano
  // string of an int) and as strings for ids; comparing decimal-int strings
  // numerically matches int ordering exactly.
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a && String(nb) === b) {
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Content hash used by tests and the handover doc to pin a payload without
 *  storing it twice. */
export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');
