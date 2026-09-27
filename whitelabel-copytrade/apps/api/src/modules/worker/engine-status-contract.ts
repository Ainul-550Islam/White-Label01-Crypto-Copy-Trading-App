/**
 * The `/internal/v1/status` contract, mirrored once and read strictly.
 *
 * Why this file exists. The execution engine answers `GET /internal/v1/status`
 * from a Pydantic model (`services/execution-engine/app/schemas.py::StatusResponse`)
 * that is declared `extra="forbid"`, so its field set is the whole contract and it
 * cannot grow in silence. Before Part 20 the only reader in this repository
 * hand-picked nine of its twenty keys out of the parsed body with `?? ''`-style
 * defaults, which produced two failures at once: a key the engine stopped
 * publishing read as an empty string or `false` — a value the startup gate then
 * judged as if it were an answer — and the other eleven keys
 * (`credentialSource`, `credentialFetcher`, `operatorConfirmation`,
 * `liveEnablement`, `placement`, `incidents`, `metricsConfigured`,
 * `retentionEnabled`, `retentionEventDays`, `enablementMaxAgeDays`, `simulated`)
 * were published, transported, validated by the engine, and dropped at the
 * boundary. The operations panel is built in this process, and until now not one
 * of those facts could reach it.
 *
 * The law this file installs, in one sentence: **a declared key that is missing is
 * an error when the engine declares it required, and the documented "an engine too
 * old to answer" value when it declares a default.** That is not a restatement of
 * leniency — it is the engine's own convention, imported. `storeBackend` defaults to
 * `"unknown"` precisely so a pre-Part-13 reply reads as unproven rather than as
 * `memory`; `placement` defaults to `None` so "no review wired" stays distinguishable
 * from "an engine that has never heard of reviews". A mirror that defaulted a
 * REQUIRED key would be answering a question this process stopped asking, which is
 * the exact thing the status route refuses to do to its own `describe()` output.
 *
 * Unknown keys are tolerated and REPORTED (`unmappedKeys`) rather than fatal. The
 * asymmetry is deliberate: a missing required key means the engine behind this
 * worker is older than the contract this worker was built against, which invalidates
 * an assert, while an extra key means it is newer, which invalidates none. Newer is
 * not this process's problem at 03:00; it is a human's problem in CI, and
 * `engine-status-parity.spec.ts` is what makes CI the place it gets noticed.
 *
 * Nothing here makes a decision. The gate that refuses to forward lives in
 * `engine-internal.client.ts`, and this module's only power is that a fact now
 * arrives with the shape the engine said it has, or the read fails.
 */

export type EngineStatusKind =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'stringArray'
  | 'scalarMap'
  | 'integerMap'
  | 'placementView'
  | 'liveEnablementView'
  | 'incidentSinkView'
  | 'distributedLockWiringView'
  | 'venueAttestationView'
  | 'credentialRegistryView';

export interface EngineStatusField {
  /** The wire name, i.e. the camelCase alias Pydantic emits. */
  readonly key: string;
  readonly kind: EngineStatusKind;
  /** Whether `StatusResponse` declares the field without a default. */
  readonly required: boolean;
  /** What a reply that predates this field means. `undefined` here together with
   * `required: true` is the refusal path; for the optional fields this is the
   * engine's own default, copied, never invented. */
  readonly absentAs?: unknown;
  /** Whether the Python annotation is `X | None`, i.e. the engine may send an explicit
   * null as its answer rather than omitting the key. These are different facts and the
   * mirror has to tell them apart: `credentialFetcher: null` means "the source in use
   * needs no reader", while a reply with no `credentialFetcher` key at all means "an
   * engine from before Part 19". A parser that conflated them would read a legitimate
   * answer as an old engine, which is how a wire contract quietly loses its meaning. */
  readonly nullable?: boolean;
}

/** `PlacementStatusView`. Two of its keys share their names with keys on the top
 * level document and carry different types (`operatorConfirmation` is a dict here
 * and a bool above; `credentialSource` is a string here, and the enablement view
 * has its own copy). That collision is the reason these sub-documents are parsed
 * against their own tables instead of being flattened into one bag of keys, and the
 * reason `engine-status-contract.spec.ts` asserts the two top-level types by name. */
export interface EnginePlacementView {
  readonly label: string;
  readonly mode: string;
  readonly requiresVenueAttestation: boolean;
  readonly cacheTtlMillis: number;
  readonly attestorSource: string;
  readonly policy: Readonly<Record<string, number | boolean>>;
  readonly cache: Readonly<Record<string, number>> | null;
  readonly confirmationConfigured: boolean;
  readonly operatorConfirmation: Readonly<Record<string, number | boolean | string>>;
}

export interface EngineLiveEnablementView {
  readonly liveRefused: boolean;
  readonly missing: readonly string[];
  readonly satisfied: readonly string[];
  readonly missingCodes: readonly string[];
  readonly hardBlockersPresent: boolean;
  readonly credentialSource: string;
}

export interface EngineIncidentSinkView {
  readonly durable: boolean;
  readonly sink: string;
  readonly stats: Readonly<Record<string, number>>;
}

export interface EngineDistributedLockWiringView {
  readonly distributed: boolean;
  readonly fencingEnabled: boolean;
  readonly ownerId: string;
  readonly renewalIntervalMs: number;
  readonly lockTtlMs: number;
  readonly acquisitionTimeoutMs: number;
  readonly description: string;
}

export interface EngineVenueAttestationView {
  readonly wired: boolean;
  readonly source: string;
  readonly restBase: string;
  readonly includesAccountFlags: boolean;
}

export interface EngineCredentialRegistryView {
  readonly selectedProvider: string;
  readonly multiTenant: boolean;
  readonly requiresNetwork: boolean;
  readonly registeredCount: number;
  readonly registeredProviders: readonly string[];
}

export interface EngineStatus {
  readonly instanceId: string;
  readonly mode: string;
  readonly dryRun: boolean;
  readonly adapter: string;
  readonly store: string;
  readonly storeDurable: boolean;
  /**
   * "memory" | "postgres" as the ENGINE's config declares, or "unknown"
   * when the field is absent (a pre-Part-13 engine). Parsed never-defaulted
   * so the compatibility gate can tell "not durable, as configured" from
   * "durable, but says nothing about how" - the latter is a contradiction
   * this worker refuses to forward into.
   */
  readonly storeBackend: string;
  readonly locksDistributed: boolean;
  readonly commands: readonly string[];
  // --- Part 20: the eleven keys the mirror used to drop -----------------------
  readonly credentialSource: string;
  readonly credentialFetcher: string | null;
  readonly operatorConfirmation: boolean;
  readonly liveEnablement: EngineLiveEnablementView | null;
  // --- Part 21: distributed lock wiring ---------------------------------------
  readonly distributedLockWiring: EngineDistributedLockWiringView | null;
  // --- Part 22: venue attestation ---------------------------------------------
  readonly venueAttestation: EngineVenueAttestationView | null;
  // --- Part 23: credential registry -------------------------------------------
  readonly credentialRegistry: EngineCredentialRegistryView | null;
  readonly placement: EnginePlacementView | null;
  readonly incidents: EngineIncidentSinkView | null;
  readonly metricsConfigured: boolean;
  readonly retentionEnabled: boolean;
  readonly retentionEventDays: number;
  readonly enablementMaxAgeDays: number;
  readonly signedTransportWired: boolean;
  readonly keyRegistryConfigured: boolean;
  readonly simulated: boolean;
  /** Keys the engine published that this contract does not name. Not an error, and
   * never silently discarded either: the panel prints the count, so "the engine
   * started saying something new" is visible at the reading end too. */
  readonly unmappedKeys: readonly string[];
}

export class EngineStatusShapeError extends Error {
  public readonly field: string;
  public readonly why: 'missing' | 'type';

  public constructor(field: string, why: 'missing' | 'type', detail: string) {
    super(`execution engine /status ${detail}`);
    this.name = 'EngineStatusShapeError';
    this.field = field;
    this.why = why;
  }
}

export const PLACEMENT_VIEW_FIELDS: readonly EngineStatusField[] = Object.freeze([
  { key: 'label', kind: 'string', required: true },
  { key: 'mode', kind: 'string', required: true },
  { key: 'requiresVenueAttestation', kind: 'boolean', required: true },
  { key: 'cacheTtlMillis', kind: 'integer', required: true },
  { key: 'attestorSource', kind: 'string', required: true },
  { key: 'policy', kind: 'scalarMap', required: true },
  { key: 'cache', kind: 'integerMap', required: false, absentAs: null, nullable: true },
  { key: 'confirmationConfigured', kind: 'boolean', required: false, absentAs: false },
  { key: 'operatorConfirmation', kind: 'scalarMap', required: false, absentAs: {} },
]);

export const LIVE_ENABLEMENT_VIEW_FIELDS: readonly EngineStatusField[] = Object.freeze([
  { key: 'liveRefused', kind: 'boolean', required: true },
  { key: 'missing', kind: 'stringArray', required: false, absentAs: [] },
  { key: 'satisfied', kind: 'stringArray', required: false, absentAs: [] },
  { key: 'missingCodes', kind: 'stringArray', required: false, absentAs: [] },
  { key: 'hardBlockersPresent', kind: 'boolean', required: false, absentAs: true },
  { key: 'credentialSource', kind: 'string', required: false, absentAs: 'none' },
]);

export const INCIDENT_SINK_VIEW_FIELDS: readonly EngineStatusField[] = Object.freeze([
  { key: 'durable', kind: 'boolean', required: true },
  { key: 'sink', kind: 'string', required: true },
  { key: 'stats', kind: 'integerMap', required: false, absentAs: {} },
]);

/** The whole document. Order here is this module's own convenience - a JSON object
 * carries no sequence law, and the parity spec compares sets and per-field properties,
 * never position. The table IS the parser: a field added here is read, and a field
 * added to the engine without appearing here shows up in `unmappedKeys` and fails the
 * parity spec. */
export const ENGINE_STATUS_FIELDS: readonly EngineStatusField[] = Object.freeze([
  { key: 'instanceId', kind: 'string', required: true },
  { key: 'mode', kind: 'string', required: true },
  { key: 'dryRun', kind: 'boolean', required: true },
  { key: 'adapter', kind: 'string', required: true },
  { key: 'store', kind: 'string', required: true },
  { key: 'storeDurable', kind: 'boolean', required: true },
  { key: 'storeBackend', kind: 'string', required: false, absentAs: 'unknown' },
  { key: 'retentionEnabled', kind: 'boolean', required: false, absentAs: false },
  { key: 'retentionEventDays', kind: 'integer', required: false, absentAs: 90 },
  { key: 'enablementMaxAgeDays', kind: 'integer', required: false, absentAs: 30 },
  { key: 'credentialSource', kind: 'string', required: false, absentAs: 'none' },
  { key: 'credentialFetcher', kind: 'string', required: false, absentAs: null, nullable: true },
  { key: 'operatorConfirmation', kind: 'boolean', required: false, absentAs: false },
  { key: 'liveEnablement', kind: 'liveEnablementView', required: false, absentAs: null, nullable: true },
  { key: 'placement', kind: 'placementView', required: false, absentAs: null, nullable: true },
  { key: 'incidents', kind: 'incidentSinkView', required: false, absentAs: null, nullable: true },
  { key: 'metricsConfigured', kind: 'boolean', required: false, absentAs: false },
  { key: 'locksDistributed', kind: 'boolean', required: true },
  // Part 20: signed transport posture
  { key: 'signedTransportWired', kind: 'boolean', required: false, absentAs: false },
  { key: 'keyRegistryConfigured', kind: 'boolean', required: false, absentAs: false },
  // Part 21: distributed lock wiring posture
  { key: 'distributedLockWiring', kind: 'distributedLockWiringView', required: false, absentAs: null, nullable: true },
  // Part 22: venue attestation posture
  { key: 'venueAttestation', kind: 'venueAttestationView', required: false, absentAs: null, nullable: true },
  // Part 23: credential registry posture
  { key: 'credentialRegistry', kind: 'credentialRegistryView', required: false, absentAs: null, nullable: true },
  { key: 'commands', kind: 'stringArray', required: true },
  { key: 'simulated', kind: 'boolean', required: false, absentAs: true },
]);

/** Every key the contract names, for the parity spec and for nothing else. */
export const ENGINE_STATUS_KEYS: readonly string[] = Object.freeze(
  ENGINE_STATUS_FIELDS.map((field) => field.key),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const checkOne = (kind: EngineStatusKind, value: unknown): boolean => {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'stringArray':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'scalarMap':
      return isRecord(value)
        ? Object.values(value).every(
            (item) =>
              typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
          )
        : false;
    case 'integerMap':
      return isRecord(value)
        ? Object.values(value).every((item) => typeof item === 'number' && Number.isInteger(item))
        : false;
    case 'placementView':
    case 'liveEnablementView':
    case 'incidentSinkView':
    case 'distributedLockWiringView':
    case 'venueAttestationView':
    case 'credentialRegistryView':
      return isRecord(value);
  }
};

const DISTRIBUTED_LOCK_WIRING_VIEW_FIELDS: readonly EngineStatusField[] = Object.freeze([
  { key: 'distributed', kind: 'boolean', required: true },
  { key: 'fencingEnabled', kind: 'boolean', required: true },
  { key: 'ownerId', kind: 'string', required: true },
  { key: 'renewalIntervalMs', kind: 'integer', required: true },
  { key: 'lockTtlMs', kind: 'integer', required: true },
  { key: 'acquisitionTimeoutMs', kind: 'integer', required: true },
  { key: 'description', kind: 'string', required: true },
]);

const VENUE_ATTESTATION_VIEW_FIELDS: readonly EngineStatusField[] = Object.freeze([
  { key: 'wired', kind: 'boolean', required: true },
  { key: 'source', kind: 'string', required: true },
  { key: 'restBase', kind: 'string', required: true },
  { key: 'includesAccountFlags', kind: 'boolean', required: true },
]);

const CREDENTIAL_REGISTRY_VIEW_FIELDS: readonly EngineStatusField[] = Object.freeze([
  { key: 'selectedProvider', kind: 'string', required: true },
  { key: 'multiTenant', kind: 'boolean', required: true },
  { key: 'requiresNetwork', kind: 'boolean', required: true },
  { key: 'registeredCount', kind: 'integer', required: true },
  { key: 'registeredProviders', kind: 'stringArray', required: true },
]);

const viewFieldsFor = (kind: EngineStatusKind): readonly EngineStatusField[] | null => {
  if (kind === 'placementView') return PLACEMENT_VIEW_FIELDS;
  if (kind === 'liveEnablementView') return LIVE_ENABLEMENT_VIEW_FIELDS;
  if (kind === 'incidentSinkView') return INCIDENT_SINK_VIEW_FIELDS;
  if (kind === 'distributedLockWiringView') return DISTRIBUTED_LOCK_WIRING_VIEW_FIELDS;
  if (kind === 'venueAttestationView') return VENUE_ATTESTATION_VIEW_FIELDS;
  if (kind === 'credentialRegistryView') return CREDENTIAL_REGISTRY_VIEW_FIELDS;
  return null;
};

/** Parse one table against one object. `where` prefixes the error text so a nested
 * refusal names its document (`placement.cacheTtlMillis`), because the operator
 * reading a worker failure needs to know WHICH half of the engine is lying. */
const parseTable = (
  body: Record<string, unknown>,
  fields: readonly EngineStatusField[],
  where: string,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const label = where === '' ? field.key : `${where}.${field.key}`;
    const raw = body[field.key];
    if (raw === null && field.nullable === true) {
      // An explicit null is the engine's answer, not a gap in the reply, so it is
      // carried through as null rather than replaced by the absent-key default.
      out[field.key] = null;
      continue;
    }
    if (raw === undefined) {
      if (field.required) {
        throw new EngineStatusShapeError(
          label,
          'missing',
          `declares "${label}" as required and the reply did not carry it - this engine is older than the contract this worker was built against`,
        );
      }
      out[field.key] = field.absentAs;
      continue;
    }
    if (viewFieldsFor(field.kind) !== null) {
      if (raw === null) {
        if (field.nullable !== true) {
          throw new EngineStatusShapeError(label, 'type', `found a null at "${label}" for a sub-document the schema does not allow to be null`);
        }
        out[field.key] = null;
        continue;
      }
      const nested = isRecord(raw) ? raw : undefined;
      if (nested === undefined) {
        throw new EngineStatusShapeError(
          label,
          'type',
          `expected an object at "${label}" and found ${Array.isArray(raw) ? 'an array' : typeof raw}`,
        );
      }
      out[field.key] = parseTable(nested, viewFieldsFor(field.kind)!, label);
      continue;
    }
    if (!checkOne(field.kind, raw)) {
      throw new EngineStatusShapeError(
        label,
        'type',
        `expected ${field.kind} at "${label}" and found ${Array.isArray(raw) ? 'an array' : typeof raw}`,
      );
    }
    out[field.key] = raw;
  }
  return out;
};

const unmapped = (
  body: Record<string, unknown>,
  fields: readonly EngineStatusField[],
): string[] => {
  const named = new Set(fields.map((field) => field.key));
  return Object.keys(body)
    .filter((key) => !named.has(key))
    .sort();
};

/** The single entry point: the parsed `/status` body in, a typed `EngineStatus`
 * out, or an `EngineStatusShapeError` naming the first key that failed. */
export const parseEngineStatus = (body: unknown): EngineStatus => {
  if (!isRecord(body)) {
    throw new EngineStatusShapeError(
      '(body)',
      'type',
      `expected an object and found ${Array.isArray(body) ? 'an array' : typeof body}`,
    );
  }
  const parsed = parseTable(body, ENGINE_STATUS_FIELDS, '') as unknown as EngineStatus;
  return Object.freeze({ ...parsed, unmappedKeys: unmapped(body, ENGINE_STATUS_FIELDS) });
};
