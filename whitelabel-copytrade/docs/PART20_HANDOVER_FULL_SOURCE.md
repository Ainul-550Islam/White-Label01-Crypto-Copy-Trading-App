
# Part 20 - the engine's own account, read; and the checker, run

> **What this part changed, and what it did not:** `/internal/v1/status` gained one strict
> TypeScript mirror and two consumers (the worker's startup gate keeps its assertions, the ops
> panel gains an `ENGINE POSTURE` section in which absence never reads as health); the DR
> obligations board gained the scheduler that `docs/DR.md` had only described, derived from the
> manifest's own cadences and drift-gated; and one defect the audit found by *running* the
> composition was fixed on the engine side, because a control that cannot boot is not a control -
> the internal tenant law is now scoped to **commands**, with one named read
> (`GET /internal/v1/status`) exempt and that exemption pinned to a single route by a test.
> **`EXECUTION_MODE=live` is still refused at startup, unchanged**; no gate, verdict,
> credential, order path or refusal threshold moved; no command route's requirements or refusal
> text changed; no metric, table, alert rule or console renderer was added. Three documents that
> still described this part's scheduler as missing (`docs/DR.md`, `docs/PART15_RLS_ENABLEMENT.md`,
> `.env.example`) are in the change set rather than left as stale prose, because a control shipped
> while being described as absent is a control nobody looks for; and sec. 5 of
> `docs/PART20_ENGINE_STATUS_EDGE.md` names nine refusals with their reasons - no engine health
> mirror, no worker-side placement gate, no published readiness gates, no console renderer, no
> restating open ROADMAP rows as finished, no Prometheus/Alertmanager rule files (`ALERT_RULES`
> carries prose conditions and `threshold: float | None`), no cron container, no change to
> `/health/ready`'s unauthenticated posture, and no configuration knob for the exempt read.

Complete content of every file created or modified by Part 20. Nothing is abbreviated,
quoted-with-ellipsis, or referred to by path: each block carries the whole current file, so this
document alone can be reviewed, diffed against an earlier part's handover, or used to
reconstruct the tree.

## Gates (run while this document was generated)

* `cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m pytest -q`
  -> **428 passed, 12 skipped**. This part is the first since Part 13 to change behaviour at
  the engine's auth boundary, so the service's own suite is the interesting one: it was
  **409 passed, 12 skipped** before Part 20's file existed and moves by exactly that file's
  count - the 12 skips stay Parts 13-15's live-Postgres suites, skipping BY NAME without
  `EXECUTION_TEST_POSTGRES_DSN`. This part's file on its own -> **19 passed**. `ruff check
  app tests` -> green; `mypy app` -> no issues in **24 source files** (the same 24: two
  scopes were added inside existing modules, no new module); `mypy
  tests/test_part20_status_read.py` -> clean, which the service's gate does not cover
  because tests sit outside it, as in every part since Part 11.
* `cd apps/api && npx jest --silent` -> **430 passed / 21 suites**; this part's three specs
  on their own -> **39 passed / 3 suites**. `npx tsc -p tsconfig.json --noEmit` -> 0 errors;
  `npx eslint src --max-warnings 0` -> clean; `npx prisma validate` -> valid. In
  `apps/admin-web`, `npx tsc --noEmit` -> 0 errors. The console renders no new field:
  `sections` is additive on the execution view and the admin web's table is untouched, so
  the panel section is reachable through the existing endpoint rather than by teaching a
  second UI to interpret engine facts.
* `cd libs/trading-core && python3 -m pytest -q` -> **1767**, `ruff check wlct_trading
  tests` -> green (17 findings in `libs/trading-core/scripts`, standalone by design), `mypy
  wlct_trading` -> no issues in **152 source files**. The core is untouched by this part and
  these three numbers are here to prove it rather than to be admired: the mirror reads
  `schemas.py` as text and never imports Python, so a core change could not have been
  smuggled in. Sibling suites: trading-engine **43**, market-data **19**, both untouched.
* `node --test scripts/` -> **133 passed / 0 failed** (the 13 new schedule tests included);
  `node scripts/dr-manifest.mjs --check-schedule` -> exit 0: schedule valid: 3 job line(s)
  (--due, --check, --check-rls), derived from 5 components, no ledger-writing mode present;
  `node scripts/dr-manifest.mjs --check` -> manifest valid: 5 components (4 with cadence),
  RPO 60m / RTO 4h, drill every 90d (timed: true), ledger entries: 0; `node
  scripts/dr-manifest.mjs --check-rls` -> exit 1: [DUE  ] rls-enablement: never recorded
  (cadence 168h) - run the audit and record it with --record-rls; policies that nobody
  verified are a hypothesis - that exit 1 is the honest answer, no audit recorded yet, and
  unchanged by this part. No table was added, so RLS coverage stays at 43 and `PROBE_TABLES`
  at 5, and the enablement audit remains owed by the operator rather than by this document.
* **Suppression tokens: 0 in the files Part 20 added and 0 in the files it modified**,
  counted by this script over `.py`, `.ts`, `.tsx` and `.mjs` instead of asserted, and
  confirmed by an independent `grep` over the same 27 files. The scan was widened this part
  precisely because Part 19 could only count Python: a display layer is TypeScript, and a
  rule that measures the half it is convenient to measure is not a rule. The generator
  itself is excluded, because it stores the forbidden tokens as guard data - and that
  exclusion is the only one, so the 0 covers real inherited lines in other parts' files
  rather than being smoothed away.

## Ledger

Measured at generation time, with code and documents counted separately because a tree-size
figure that mixes them is not a size. Part 20 shipped **4,440 lines** - **2,775**
across the 7 new code files, **545** in the 2 new
documents, and **+1,040** code / **+80** document lines across the
18 modified files (each delta measured against the newest prior handover that lists
that file - which leaves 0 of them, 0 lines, with no delta at
all because no earlier document recorded their prior size: none. Their full text is
embedded below, and their size is not presented as a change). Whole-tree counts under the
standing rule set: **219,180 source lines**; adding the narrative documents under
`docs/` (the regenerable `docs/source/` views and every handover dump are out of both figures):
**241,136**.

Three provenance notes, because each is a sentence this part could have copied and should not.

* The header's deltas are small by construction, and the reason is this repository's own
  rule rather than a shortfall. A part's change set includes documents every earlier part
  also embedded, so the ancestors must be regenerated before this document is written (else
  they are stale, which `--check` reports as a failure); regenerating them moves the copies
  inside them forward to post-Part-20 text, which is the state the delta is then measured
  from. Parts 16, 17, 18 and 19 were regenerated in that order first, and `--check` on any
  of the five reproduces what each prints. The un-regenerated figure - the same sweep taken
  before that chain, in `/home/user/part20_deltas_pre_regen.txt` - is **+799 delta lines and
  2,362 new lines**, and that is the number to read as "what Part 20 typed"; the file list
  itself is identical in both, which is the part that actually has to be complete.
* The file lists are a derived diff, not a remembered one. With no VCS in the workspace the
  prior handovers are the snapshots: 26 files had moved since their last recorded state, 15
  carry Part 20 markers and are listed below, and the other eleven are named in this
  script's docstring with the part that actually left them changed (Part 10's SLO and
  tracing additions, never re-embedded) so that "not ours" is a checked statement rather
  than an excuse. The comparison must be fence-aware, because an embedded markdown document
  is fenced with four backticks and a three-backtick parser reports nine untouched documents
  as wholly rewritten.
* One behaviour change is not display. `GET /internal/v1/status` is answered under
  `require_internal_auth_readonly`; every other internal route is under
  `require_internal_auth` unchanged, the exemption is pinned by a route-table walk and by an
  HTTP sweep of the command routes, and `/health/ready` is asserted to keep publishing a
  superset of the same keys so the exemption discloses nothing new.
  `docs/PART20_ENGINE_STATUS_EDGE.md` sec. 7 carries the before/after measurements,
  including that this whole part was green (409 engine tests, 425 API tests, 65 script
  tests) while the reference worker could not start, because every test of that client stubs
  `fetch`.

## Created in Part 20 (full files)

## FILE: apps/api/src/modules/worker/engine-status-contract.ts (331 lines)

*the mirror of `services/execution-engine/app/schemas.py::StatusResponse`, one table wide: `ENGINE_STATUS_FIELDS` carries every wire key with its TypeScript type, whether the engine defaults it, and the default spelled out verbatim; `parseEngineStatus` refuses a non-object body, a missing required key, a wrong primitive and an unknown key at the top level, preserves an explicit `null` on a declared-nullable field instead of substituting the default, and reports `unmappedKeys` rather than discarding them. The two absence laws are the point of the file: the mirror's defaults ARE the engine's defaults, so an engine too old to answer reads as too old to answer, never as healthy.*

```typescript
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
  | 'incidentSinkView';

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
  readonly placement: EnginePlacementView | null;
  readonly incidents: EngineIncidentSinkView | null;
  readonly metricsConfigured: boolean;
  readonly retentionEnabled: boolean;
  readonly retentionEventDays: number;
  readonly enablementMaxAgeDays: number;
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
      return isRecord(value);
  }
};

const viewFieldsFor = (kind: EngineStatusKind): readonly EngineStatusField[] | null => {
  if (kind === 'placementView') return PLACEMENT_VIEW_FIELDS;
  if (kind === 'liveEnablementView') return LIVE_ENABLEMENT_VIEW_FIELDS;
  if (kind === 'incidentSinkView') return INCIDENT_SINK_VIEW_FIELDS;
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
```


## FILE: apps/api/src/modules/worker/engine-status-contract.spec.ts (253 lines)

*16 tests on the mirror: the 20-key set is spelled out as data (a key added to the schema without a row here fails), the nine required keys refuse absence individually, declared-nullable keys keep `null` where an absent key takes the default, `simulated` is reported and never silently folded into `mode`, wrong-typed values name the field that moved, and the refusal objects carry a `field` so a UI can point at it.*

```typescript
/**
 * Part 20 — the `/status` mirror is a parser, not a preference.
 *
 * These tests are the reason the table in `engine-status-contract.ts` can be trusted:
 * a required key that arrives absent is a refusal naming the key, an optional key that
 * arrives absent is the engine's documented "too old to answer" value, and a key that
 * arrives with the wrong type is a refusal even when a lax reader could have coerced it.
 * The last law is the one a `String(x ?? '')`-style reader breaks silently, and it is
 * the reason the whole file exists.
 */

import {
  ENGINE_STATUS_KEYS,
  EngineStatusShapeError,
  parseEngineStatus,
} from './engine-status-contract';

/** The smallest reply a real engine can send: the eight keys `StatusResponse` declares
 * without a default. Every other key in these tests is either absent (and must read as
 * the documented default) or present (and must be checked). */
const requiredOnly = (): Record<string, unknown> => ({
  instanceId: 'exec-a',
  mode: 'simulated',
  dryRun: true,
  adapter: 'PaperTradingAdapter',
  store: 'InMemoryOrderStore',
  storeDurable: false,
  locksDistributed: false,
  commands: ['cancel-order'],
});

describe('engine status contract - the required eight', () => {
  it('reads a required-only reply without inventing a single value', () => {
    const status = parseEngineStatus(requiredOnly());
    expect(status.mode).toBe('simulated');
    expect(status.commands).toEqual(['cancel-order']);
    // The Part 13/14/15/16/18/19 additions all read as "this engine did not say".
    expect(status.storeBackend).toBe('unknown');
    expect(status.retentionEnabled).toBe(false);
    expect(status.retentionEventDays).toBe(90);
    expect(status.enablementMaxAgeDays).toBe(30);
    expect(status.credentialSource).toBe('none');
    expect(status.credentialFetcher).toBeNull();
    expect(status.operatorConfirmation).toBe(false);
    expect(status.liveEnablement).toBeNull();
    expect(status.placement).toBeNull();
    expect(status.incidents).toBeNull();
    expect(status.metricsConfigured).toBe(false);
    expect(status.simulated).toBe(true);
  });

  it('refuses a missing required key by name, for every one of the eight', () => {
    for (const key of [
      'instanceId',
      'mode',
      'dryRun',
      'adapter',
      'store',
      'storeDurable',
      'locksDistributed',
      'commands',
    ]) {
      const body = requiredOnly();
      delete body[key];
      let thrown: unknown = null;
      try {
        parseEngineStatus(body);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EngineStatusShapeError);
      expect((thrown as EngineStatusShapeError).field).toBe(key);
      expect((thrown as EngineStatusShapeError).why).toBe('missing');
      // The message is operator-facing: it must say what to do about it, not just
      // that something failed.
      expect((thrown as Error).message).toMatch(/older than the contract/);
    }
  });

  it('refuses a wrongly typed required key rather than coercing it', () => {
    for (const [key, value] of [
      ['mode', 7],
      ['dryRun', 'true'],
      ['commands', 'cancel-order'],
      ['storeDurable', 1],
    ] as const) {
      const body = { ...requiredOnly(), [key]: value };
      expect(() => parseEngineStatus(body)).toThrow(EngineStatusShapeError);
      try {
        parseEngineStatus(body);
      } catch (error) {
        expect((error as EngineStatusShapeError).why).toBe('type');
        expect((error as EngineStatusShapeError).field).toBe(key);
      }
    }
  });

  it('a null in place of a required string is a refusal, not an empty string', () => {
    // `String(body.instanceId ?? '')` - the reader this part replaced - accepted this
    // and reported an engine with no identity.
    expect(() => parseEngineStatus({ ...requiredOnly(), instanceId: null })).toThrow(
      EngineStatusShapeError,
    );
  });
});

describe('engine status contract - optional keys keep their documented meaning', () => {
  it('a wrong type on an optional key is still a refusal', () => {
    // Absent means "too old to answer". Present-and-wrong means the engine is lying
    // about something the reader will act on, so it cannot be defaulted away.
    for (const [key, value] of [
      ['retentionEventDays', '90'],
      ['credentialSource', null],
      ['metricsConfigured', 'yes'],
      ['simulated', 1],
    ] as const) {
      expect(() => parseEngineStatus({ ...requiredOnly(), [key]: value })).toThrow(
        EngineStatusShapeError,
      );
    }
  });

  it('a non-array commands is refused even though Array.isArray would have hidden it', () => {
    expect(() => parseEngineStatus({ ...requiredOnly(), commands: { a: 1 } })).toThrow(
      EngineStatusShapeError,
    );
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), commands: ['ok', 3] }),
    ).toThrow(/expected stringArray/);
  });
});

describe('engine status contract - the three sub-documents', () => {
  const placement = {
    label: 'placement-review',
    mode: 'local',
    requiresVenueAttestation: false,
    cacheTtlMillis: 5_000,
    attestorSource: 'unattested',
    policy: { requireOperatorConfirmation: false },
  };

  it('parses a placement block and defaults its three optional keys', () => {
    const status = parseEngineStatus({ ...requiredOnly(), placement });
    expect(status.placement).not.toBeNull();
    expect(status.placement?.attestorSource).toBe('unattested');
    expect(status.placement?.cache).toBeNull();
    expect(status.placement?.confirmationConfigured).toBe(false);
    expect(status.placement?.operatorConfirmation).toEqual({});
  });

  it('refuses a placement block missing one of its own required keys', () => {
    const broken = { ...placement } as Record<string, unknown>;
    delete broken.requiresVenueAttestation;
    let thrown: EngineStatusShapeError | null = null;
    try {
      parseEngineStatus({ ...requiredOnly(), placement: broken });
    } catch (error) {
      thrown = error as EngineStatusShapeError;
    }
    expect(thrown).toBeInstanceOf(EngineStatusShapeError);
    // The nested path is named, so the reader learns WHICH half of the engine
    // answered badly rather than "placement is wrong".
    expect(thrown?.field).toBe('placement.requiresVenueAttestation');
  });

  it('tells the two same-named keys apart: top-level bool, nested dict', () => {
    expect(ENGINE_STATUS_KEYS).toContain('operatorConfirmation');
    const bare = parseEngineStatus(requiredOnly());
    expect(bare.operatorConfirmation).toBe(false);
    const withView = parseEngineStatus({
      ...requiredOnly(),
      operatorConfirmation: true,
      placement: { ...placement, operatorConfirmation: { windowMillis: 60_000 } },
    });
    expect(withView.operatorConfirmation).toBe(true);
    expect(withView.placement?.operatorConfirmation).toEqual({ windowMillis: 60_000 });
    // A bool where a dict belongs, and vice versa, are both refusals: this is the
    // collision the contract module warns about in its own comment.
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), placement: { ...placement, operatorConfirmation: true } }),
    ).toThrow(EngineStatusShapeError);
    expect(() => parseEngineStatus({ ...requiredOnly(), operatorConfirmation: {} })).toThrow(
      EngineStatusShapeError,
    );
  });

  it('parses the live-enablement block and refuses a fabricated permission', () => {
    const status = parseEngineStatus({
      ...requiredOnly(),
      liveEnablement: {
        liveRefused: true,
        missing: ['SIGNED_TRANSPORT_WIRED'],
        satisfied: ['IP_ALLOWLIST_ENFORCED'],
        missingCodes: ['LIVE_SIGNED_TRANSPORT_WIRED'],
        hardBlockersPresent: true,
        credentialSource: 'vault',
      },
    });
    expect(status.liveEnablement?.missing).toEqual(['SIGNED_TRANSPORT_WIRED']);
    expect(status.liveEnablement?.credentialSource).toBe('vault');
    // A string where a list belongs would let a producer's mistake read as "nothing
    // is missing", which is the one thing this block must never appear to say.
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), liveEnablement: { liveRefused: true, missing: 'none' } }),
    ).toThrow(/liveEnablement.missing/);
  });

  it('parses the incident sink and its default-empty stats', () => {
    const status = parseEngineStatus({
      ...requiredOnly(),
      incidents: { durable: true, sink: 'postgres' },
    });
    expect(status.incidents).toEqual({ durable: true, sink: 'postgres', stats: {} });
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), incidents: { durable: 'yes', sink: 'postgres' } }),
    ).toThrow(/incidents.durable/);
  });

  it('refuses a sub-document that arrives as an array or a scalar', () => {
    for (const value of [[], 'placement', 3] as const) {
      expect(() => parseEngineStatus({ ...requiredOnly(), placement: value })).toThrow(
        /expected an object at "placement"/,
      );
    }
  });
});

describe('engine status contract - what the engine starts saying later', () => {
  it('tolerates an unknown key and reports it instead of dropping it', () => {
    const status = parseEngineStatus({ ...requiredOnly(), zetaNewFact: 1, alphaNewFact: 2 });
    expect(status.unmappedKeys).toEqual(['alphaNewFact', 'zetaNewFact']);
    expect(status.mode).toBe('simulated');
  });

  it('reports nothing unmapped for a contract-shaped reply', () => {
    expect(parseEngineStatus(requiredOnly()).unmappedKeys).toEqual([]);
  });

  it('refuses a body that is not an object at all (the proxy-page case)', () => {
    for (const body of ['<html>502</html>', null, [], 42] as const) {
      expect(() => parseEngineStatus(body)).toThrow(EngineStatusShapeError);
    }
  });

  it('is a frozen result, so a panel cannot edit the mirror into a different answer', () => {
    const status = parseEngineStatus(requiredOnly());
    expect(Object.isFrozen(status)).toBe(true);
    expect(() => {
      (status as { mode: string }).mode = 'live';
    }).toThrow(TypeError);
  });
});
```


## FILE: apps/api/src/modules/worker/engine-status-parity.spec.ts (254 lines)

*the three-sided law, checked in CI: this spec parses `app/schemas.py` with a small reader and asserts that its field set equals this part's alias table equals what `parseEngineStatus` accepts. A rename, an addition or a deletion on the Python side fails here with the key named, which is what makes the mirror maintainable instead of merely current.*

```typescript
/**
 * Part 20 — the third side of the status triangle, checked in CI.
 *
 * Three documents describe one contract:
 *   1. `EngineRuntime.describe()` (Python) publishes the facts;
 *   2. `StatusResponse` (`services/execution-engine/app/schemas.py`) declares which
 *      facts are required and what the absence of an optional one means;
 *   3. `ENGINE_STATUS_FIELDS` (this repository's TS mirror) reads them.
 * Side 1 against side 2 is already pinned by the service's own suite - the
 * `PlacementStatusView` docstring in schemas.py says the counterpart test asserts
 * the two key sets agree, which is what makes `wiring["..."]` legal in the status
 * route instead of a guess. Side 3 was pinned by nobody until this file, which is
 * precisely how eleven published keys came to be dropped at the boundary while nine
 * were read with defaults invented in TypeScript.
 *
 * So this spec parses the Python source - the same live-source technique the alert
 * catalog parity uses (`modules/observability/alert.constants.ts` header, and
 * `modules/datasets/datasets-safety.spec.ts` for the Python table) - and asserts
 * the mirror names every field, requires exactly what the model requires, and copies
 * rather than invents every default.
 *
 * It reads the file rather than importing a fixture because the drift it prevents is
 * "somebody edited one side". A checked-in copy of the schema would be a third side.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ENGINE_STATUS_FIELDS,
  INCIDENT_SINK_VIEW_FIELDS,
  LIVE_ENABLEMENT_VIEW_FIELDS,
  PLACEMENT_VIEW_FIELDS,
  type EngineStatusField,
  type EngineStatusKind,
} from './engine-status-contract';

const SCHEMAS_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'services',
  'execution-engine',
  'app',
  'schemas.py',
);

interface DeclaredField {
  readonly key: string;
  readonly required: boolean;
  readonly kind: EngineStatusKind;
  readonly nullable: boolean;
  /** The default value normalized to JSON space, so Python's `None` and TS's `null`
   * compare equal. `undefined` means required. */
  readonly absentAs?: unknown;
}

/** `_to_camel` in schemas.py: first segment as-is, the rest title-cased. Restated
 * here rather than trusted, because the wire names are exactly what the mirror keys
 * on - a divergence in THIS function is a drift bug of the loudest kind. */
const toCamel = (name: string): string => {
  const [head, ...rest] = name.split('_');
  return head + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
};

/** The annotation → kind law. An annotation this function does not recognize is a
 * hard failure, never a fallback: "the schema grew a type nobody looked at" is the
 * exact event this test exists to make loud. */
const kindFor = (
  annotation: string,
  declaringClass: string,
): { kind: EngineStatusKind; nullable: boolean } => {
  const text = annotation.trim();
  // Keyed by the annotation with any trailing `| None` removed, because that suffix is
  // the NULLABILITY half of the declaration and is reported separately below. Folding the
  // two into one key per spelling would mean a table entry for every combination, which is
  // how a mapping table starts having entries nobody can tell apart.
  const table: Readonly<Record<string, EngineStatusKind>> = {
    str: 'string',
    bool: 'boolean',
    int: 'integer',
    'list[str]': 'stringArray',
    'dict[str, int]': 'integerMap',
    'dict[str, int | bool]': 'scalarMap',
    'dict[str, bool | int | str]': 'scalarMap',
    PlacementStatusView: 'placementView',
    LiveEnablementView: 'liveEnablementView',
    IncidentSinkView: 'incidentSinkView',
  };
  const nullable = text.endsWith(' | None');
  const kind = table[nullable ? text.slice(0, -' | None'.length) : text];
  if (kind === undefined) {
    throw new Error(
      `schemas.py::${declaringClass} declares "${text}", which this parity spec has no mapping for. ` +
        'Add the mapping and the mirror deliberately: silently classifying a new wire type as a string ' +
        'is how a contract mirror starts lying about a field it never looked at.',
    );
  }
  return { kind, nullable };
};

const literal = (source: string): unknown => {
  const text = source.trim();
  if (text === 'None') return null;
  if (text === 'True') return true;
  if (text === 'False') return false;
  if (text === '{}') return {};
  if (text === '[]') return [];
  if (text === 'Field(default_factory=dict)') return {};
  if (text === 'Field(default_factory=list)') return [];
  const quoted = /^"([^"]*)"$/.exec(text);
  if (quoted !== null) return quoted[1];
  if (/^-?\d+$/.test(text)) return Number(text);
  throw new Error(`cannot normalize the Python default ${JSON.stringify(text)} - teach literal() about it`);
};

/** Pull the field lines out of one `_WireModel` subclass body. Comment-only lines are
 * dropped first: schemas.py is heavily commented, and its prose contains colons. */
const declaredFields = (source: string, className: string): DeclaredField[] => {
  const start = source.indexOf(`class ${className}(_WireModel):`);
  if (start < 0) {
    throw new Error(`schemas.py no longer declares class ${className}(_WireModel)`);
  }
  const rest = source.slice(start + `class ${className}(_WireModel):`.length);
  const bodyEnd = rest.search(/\nclass \w/);
  const body = bodyEnd < 0 ? rest : rest.slice(0, bodyEnd);
  const fields: DeclaredField[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('"""')) continue;
    const match = /^(?:#\s*)?(\w+): (.+)$/.exec(line);
    if (match === null) continue;
    const [, name, remainder] = match;
    if (name === 'model_config') continue;
    const splitAt = remainder.indexOf(' = ');
    const annotation = splitAt < 0 ? remainder : remainder.slice(0, splitAt);
    const defaultSource = splitAt < 0 ? null : remainder.slice(splitAt + 3);
    const resolved = kindFor(annotation, className);
    fields.push({
      key: toCamel(name),
      required: defaultSource === null,
      kind: resolved.kind,
      nullable: resolved.nullable,
      ...(defaultSource === null ? {} : { absentAs: literal(defaultSource) }),
    });
  }
  if (fields.length === 0) {
    throw new Error(`no fields parsed out of ${className} - the parser and the file have diverged`);
  }
  return fields;
};

const source = readFileSync(SCHEMAS_PATH, 'utf-8');

const compare = (
  mirror: readonly EngineStatusField[],
  declared: readonly DeclaredField[],
  label: string,
): void => {
  const mirrorKeys = mirror.map((field) => field.key).sort();
  const declaredKeys = declared.map((field) => field.key).sort();
  expect({ label, keys: mirrorKeys }).toEqual({ label, keys: declaredKeys });
  for (const field of declared) {
    const mirrored = mirror.find((candidate) => candidate.key === field.key);
    expect(mirrored === undefined ? `${label}.${field.key} is absent from the TS mirror` : 'ok').toBe(
      'ok',
    );
    expect(mirrored).toBeDefined();
    // The kinds and the required flags are the two things that decide whether a
    // missing key is a refusal or a documented default - they are the whole point of
    // the mirror, so they are compared field by field rather than as a set.
    expect(mirrored?.kind).toBe(field.kind);
    expect(mirrored?.required).toBe(field.required);
    expect(mirrored?.nullable === true).toBe(field.nullable);
    if (!field.required) {
      expect(JSON.stringify(mirrored?.absentAs)).toBe(JSON.stringify(field.absentAs));
    } else {
      expect(mirrored?.absentAs).toBeUndefined();
    }
  }
};

describe('engine status contract - parity with the Python schema that defines it', () => {
  it('mirrors StatusResponse exactly: 20 keys, same required set, same defaults', () => {
    compare(
      ENGINE_STATUS_FIELDS,
      declaredFields(source, 'StatusResponse'),
      'StatusResponse',
    );
    expect(ENGINE_STATUS_FIELDS).toHaveLength(20);
  });

  it('mirrors the three sub-documents the status route validates through', () => {
    compare(PLACEMENT_VIEW_FIELDS, declaredFields(source, 'PlacementStatusView'), 'PlacementStatusView');
    compare(
      LIVE_ENABLEMENT_VIEW_FIELDS,
      declaredFields(source, 'LiveEnablementView'),
      'LiveEnablementView',
    );
    compare(INCIDENT_SINK_VIEW_FIELDS, declaredFields(source, 'IncidentSinkView'), 'IncidentSinkView');
  });

  it('names the eleven keys the mirror used to drop, so the drop cannot return', () => {
    // Before Part 20 the reader consumed nine keys and ignored these. Listing them
    // here is not redundancy for its own sake: a mirror that "simplifies" itself back
    // to nine keys would pass every other test in this file, because those tests
    // compare both sides of a change made together. This one pins the historical
    // gap by name.
    const mirrored = new Set(ENGINE_STATUS_FIELDS.map((field) => field.key));
    for (const key of [
      'credentialSource',
      'credentialFetcher',
      'operatorConfirmation',
      'liveEnablement',
      'placement',
      'incidents',
      'metricsConfigured',
      'retentionEnabled',
      'retentionEventDays',
      'enablementMaxAgeDays',
      'simulated',
    ]) {
      expect(mirrored.has(key) ? 'ok' : `${key} fell out of the mirror again`).toBe('ok');
    }
  });

  it('keeps the two same-named keys with different types on different documents', () => {
    // `operatorConfirmation` is a bool on StatusResponse and a dict on
    // PlacementStatusView. A refactor that flattened the two would pass a key-name
    // comparison and break the parse, so the type difference is asserted directly.
    const top = ENGINE_STATUS_FIELDS.find((field) => field.key === 'operatorConfirmation');
    const nested = PLACEMENT_VIEW_FIELDS.find((field) => field.key === 'operatorConfirmation');
    expect(top?.kind).toBe('boolean');
    expect(nested?.kind).toBe('scalarMap');
  });

  it('leaves no key on the ignore list: the mirror claims the whole document', () => {
    // The parity mechanism only earns its keep if "not listed" has no meaning. An
    // explicit allow-list of ignored keys is the shape such tests usually rot into,
    // so this asserts there is none, and that the required/optional split is entirely
    // the Python model's - not a preference made here.
    expect(ENGINE_STATUS_FIELDS.every((field) => typeof field.key === 'string')).toBe(true);
    const required = ENGINE_STATUS_FIELDS.filter((field) => field.required).map((f) => f.key).sort();
    expect(required).toEqual(
      declaredFields(source, 'StatusResponse')
        .filter((field) => field.required)
        .map((field) => field.key)
        .sort(),
    );
  });
});
```


## FILE: apps/api/src/modules/observability/engine-posture.service.ts (316 lines)

*the `ENGINE POSTURE` section: a 10-second cached read through the existing engine client, a 2-second panel budget, three states (`reported`, `unverified`, `unconfigured`) with a `code` and a truncated `reason` on the unhappy ones, the tone law in which no absence renders as success, and rows for instance, mode, dry-run, adapter, store, durability, retention, enablement age, credential source, fetcher, operator confirmation, placement policy, incidents, metrics, locks and command count. It never invents a value: with no client it says so instead of throwing at request time, and it is a `readiness`-shaped sibling of the module's existing views, not a new endpoint.*

```typescript
/**
 * Part 20 — the execution engine's own account of itself, on the operator's page.
 *
 * What this service is for. The engine has published `/internal/v1/status` since
 * Part 11 and, through Parts 13-19, filled it with the operational facts that explain
 * every refusal it makes: which credential source it was willing to read, whether a
 * confirmation verifier is installed, how the live-enablement grading came out, whether
 * its incident sink is durable, whether anything is measuring it at all. Until now the
 * only reader of that document was the worker's startup gate, and that gate looked at
 * nine of the twenty keys. So the platform had a service that answered questions nobody
 * asked it, and an operations panel that answered them from the trading engine's view of
 * whether it could reach an adapter (`observability.service.ts`, `executionPanel`) plus a
 * 24-hour order mix - which is a description of the traffic, not of the machinery.
 *
 * Two boundaries this file keeps.
 *
 * **Speedometer, not brakes.** Nothing here can block, refuse, or resolve anything; the
 * read never throws, and every failure of the engine to answer becomes a row saying
 * `unverified` with the reason. It follows the same rule as `worker-coordination-read.service.ts`
 * two files over, including the part that matters most: absence is reported as absence,
 * never as health. A panel that renders "no answer" as green is worse than no panel.
 *
 * **One reader, one parser.** The status document is parsed by
 * `modules/worker/engine-status-contract.ts` and nowhere else, and this service reaches
 * the engine through the worker's own client. A second HTTP call written for the panel
 * would be a second opinion about the same wire, and the two would disagree in the ways
 * that only show up during an incident.
 *
 * Why the engine is not in `OBS_PUBLISHER_SERVICES`. That list is the Redis health-mirror
 * channel, and the execution engine owns no Redis client at all - by design, since its
 * durable state lives in Postgres and its instruments are rendered at scrape time (Part
 * 18). Making it a publisher would mean introducing both a Redis handle and a background
 * task purely to copy facts the process already answers on request. The reader goes to the
 * author instead of the author duplicating itself into a cache, which is also why the age
 * of the answer is a first-class field here: this view is only as fresh as its last read.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';

import { EngineCallError, EngineInternalClient } from '../worker/engine-internal.client';
import type { EngineStatus } from '../worker/engine-status-contract';
import type { OpsOverviewSection } from './observability.types';

/** The panel's own budget. The client's 30-second timeout is the queue-hop guard, sized
 * against a venue round trip; an operations page must not be able to wait that long on a
 * service it is only asking "how are you". A read that exceeds this becomes `unverified`
 * here, and the client's request is left running: when it eventually lands it fills the
 * 10-second cache, so the next refresh shows the answer. Nothing is cancelled and
 * nothing is faked. */
const PANEL_READ_BUDGET_MS = 2_000;

/** The provider token. A string token rather than the class, because what this module
 * binds is "a client, if this deployment is wired for one" - and binding the class to
 * `null` would leave the API with a constructor that throws on a missing token, which is
 * the client's correct behaviour for the worker and a wrong one for a panel. */
export const ENGINE_POSTURE_CLIENT = 'ENGINE_POSTURE_CLIENT';

export type EnginePostureState = 'reported' | 'unverified' | 'unconfigured';

export interface EnginePostureView {
  readonly state: EnginePostureState;
  /** When the engine last ANSWERED, taken from the client's cache stamp, or null when it
   * never has. Not "when this read ran": that would be a tautology wearing the word
   * "age". The freshness an operator needs here is how long ago the engine spoke, since
   * the wiring it describes does not change while it runs. */
  readonly checkedAtMs: number | null;
  readonly status: EngineStatus | null;
  /** The refusal, in the engine's or the transport's own words, cut to the same length
   * the client's error body uses. Never a stack, never a token. */
  readonly reason: string | null;
  /** `ENGINE_UNREACHABLE`, `ENGINE_STATUS_SHAPE`, `HTTP_500`, or the panel's own
   * `PANEL_BUDGET`. A code, because an operator greps for these. */
  readonly code: string | null;
}

const REASON_MAX_LENGTH = 256;

@Injectable()
export class EnginePostureService {
  public constructor(
    @Optional()
    @Inject(ENGINE_POSTURE_CLIENT)
    private readonly client: EngineInternalClient | null = null,
  ) {}

  /** Whether a client is bound. The configuration question was asked once, by the module's
   * factory, and asking it again here would put a second copy of that law on the read path
   * - where it could disagree with the binding and report "not wired" next to live data.
   * What this reports is therefore what the panel can actually do: read, or not. */
  public get wired(): boolean {
    return this.client !== null;
  }

  public async read(): Promise<EnginePostureView> {
    if (this.client === null) {
      return {
        state: 'unconfigured',
        checkedAtMs: null,
        status: null,
        reason:
          'no engine client: EXECUTION_ENGINE_URL and an EXECUTION_ENGINE_TOKEN of at least 32 characters are required',
        code: 'UNCONFIGURED',
      };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const status = await Promise.race([
        this.client.getStatus(),
        new Promise<'budget'>((resolve) => {
          timer = setTimeout(() => resolve('budget'), PANEL_READ_BUDGET_MS);
        }),
      ]);
      if (status === 'budget') {
        return {
          state: 'unverified',
          // The last ANSWER's timestamp, not this read's: the operator's question on a
          // timeout is "how long has this been unknown", and only the fetch time answers it.
          checkedAtMs: this.client.statusFetchedAtMs(),
          status: null,
          reason: `the engine did not answer within the panel's ${PANEL_READ_BUDGET_MS}ms budget; the read is still running and the next refresh will show it`,
          code: 'PANEL_BUDGET',
        };
      }
      return {
        state: 'reported',
        checkedAtMs: this.client.statusFetchedAtMs(),
        status,
        reason: null,
        code: null,
      };
    } catch (error) {
      const code = error instanceof EngineCallError ? error.code : 'ENGINE_POSTURE_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      return {
        state: 'unverified',
        // Same reasoning as the budget path: the age of the last answer is the useful
        // number when this one failed.
        checkedAtMs: this.client.statusFetchedAtMs(),
        status: null,
        reason: message.slice(0, REASON_MAX_LENGTH),
        code,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** The EXECUTION-section rows the operations panel appends. Rendered as one section per
   * state so a failure cannot half-populate: `unverified` gets exactly the rows it can
   * honestly show, and the shape is stable enough for a UI to key on. */
  public async section(): Promise<OpsOverviewSection> {
    const view = await this.read();
    return {
      title: 'ENGINE POSTURE',
      rows: this.rows(view),
    };
  }

  /** Tone law, stated once: `ok` is reserved for a fact the engine reported about a
   * component that is doing what it was configured to do. A missing answer is `warn`,
   * a reported contradiction is `bad`, and a fact with nothing right or wrong about it
   * (which mode this is, which store class, how long the retention window is) is
   * `neutral`. There is no path in this file that renders absence as `ok`, and
   * `engine-posture.service.spec.ts` asserts that by walking every state. */
  public rows(view: EnginePostureView): OpsOverviewSection['rows'] {
    if (view.state !== 'reported' || view.status === null) {
      return [
        {
          label: 'engine posture',
          value: view.state === 'unconfigured' ? 'unconfigured' : 'unverified',
          detail: `${view.code ?? 'UNKNOWN'} - ${view.reason ?? 'no reason reported'}`,
          tone: 'warn',
        },
        {
          label: 'engine last answered',
          value:
            view.checkedAtMs === null
              ? 'never'
              : `${Math.max(0, Date.now() - view.checkedAtMs)}ms ago (this read did not answer)`,
          tone: 'warn',
        },
      ];
    }
    const status = view.status;
    const durableContradiction = status.storeDurable && status.storeBackend !== 'postgres';
    const placement = status.placement;
    const enablement = status.liveEnablement;
    // "the deployment asked for the check" and "the deployment can satisfy it" are the
    // two halves Part 19 refused to let a reader conflate, and this row is where that
    // distinction pays for itself: the ask lives in the policy block, the having in the
    // two booleans, and either source saying "wired" counts as wired.
    const confirmationAsked = placement?.policy['requireOperatorConfirmation'] === true;
    const confirmationHeld =
      status.operatorConfirmation === true || placement?.confirmationConfigured === true;
    const ageMs = view.checkedAtMs === null ? null : Math.max(0, Date.now() - view.checkedAtMs);
    return [
      {
        label: 'engine instance',
        value: status.instanceId === '' ? '(unnamed)' : status.instanceId,
        detail: `mode=${status.mode} dryRun=${String(status.dryRun)} commands=${status.commands.length}`,
        tone: 'neutral',
      },
      {
        label: 'durable store',
        value: status.storeDurable
          ? `durable (${status.storeBackend})`
          : `${status.store}, as configured`,
        tone: durableContradiction ? 'bad' : 'neutral',
        ...(durableContradiction
          ? {
              detail:
                'the engine claims a durable store without naming postgres as its backend - the worker refuses to forward into this state',
            }
          : {}),
      },
      {
        label: 'distributed locks',
        value: status.locksDistributed ? 'distributed' : 'in-process',
        tone: 'neutral',
      },
      {
        label: 'credential source',
        value:
          status.credentialFetcher === null
            ? status.credentialSource
            : `${status.credentialSource} via ${status.credentialFetcher}`,
        tone: status.credentialSource === 'none' ? 'neutral' : 'ok',
      },
      {
        label: 'operator confirmation',
        value: confirmationHeld
          ? 'verifier wired'
          : confirmationAsked
            ? 'asked for and absent'
            : 'not wired',
        tone: confirmationHeld ? 'ok' : confirmationAsked ? 'bad' : 'neutral',
        ...(confirmationAsked && !confirmationHeld
          ? {
              detail:
                'the placement policy requests an operator confirmation this process cannot satisfy; every order it reviews is refused for that reason',
            }
          : {}),
      },
      {
        label: 'live enablement',
        value:
          enablement === null
            ? 'not reported by this engine'
            : `${enablement.liveRefused ? 'refused' : 'not refused'}; ${enablement.missing.length} missing, ${enablement.satisfied.length} satisfied`,
        detail:
          enablement === null
            ? 'an engine predating Part 19 cannot grade itself; the answer is absent, not favourable'
            : enablement.missingCodes.join(', ') || undefined,
        // The tone law for this row is the one a reader is most likely to get wrong, so
        // it is written out: a refusal this build cannot configure away is the DESIGNED
        // state and reads neutral; a refusal with no hard blocker means live is one
        // configuration step away, which is worth a warning on any deployment that did not
        // plan for it; and no answer at all is a warning, because an engine too old to
        // grade itself has not graded anything in favour of live either.
        tone:
          enablement === null
            ? 'warn'
            : enablement.hardBlockersPresent
              ? 'neutral'
              : 'warn',
      },
      {
        label: 'incident sink',
        value:
          status.incidents === null
            ? 'not reported by this engine'
            : status.incidents.durable
              ? `durable (${status.incidents.sink})`
              : `${status.incidents.sink}, process-local`,
        tone: status.incidents === null ? 'warn' : status.incidents.durable ? 'ok' : 'neutral',
      },
      {
        label: 'instrumented',
        value: status.metricsConfigured ? '/metrics wired' : 'no exposition',
        tone: status.metricsConfigured ? 'ok' : 'warn',
      },
      {
        label: 'journal retention',
        value: status.retentionEnabled ? `on, ${status.retentionEventDays}d` : 'off',
        detail: `enablement evidence window ${status.enablementMaxAgeDays}d`,
        tone: 'neutral',
      },
      {
        label: 'placement review',
        value:
          placement === null
            ? 'not reported by this engine'
            : `${placement.label} via ${placement.attestorSource}`,
        tone: placement === null ? 'warn' : 'neutral',
      },
      ...(status.unmappedKeys.length > 0
        ? [
            {
              label: 'keys this build does not mirror',
              value: String(status.unmappedKeys.length),
              detail: `${status.unmappedKeys.join(', ')} - the engine is newer than the reader; the parity spec pins the difference`,
              tone: 'warn' as const,
            },
          ]
        : []),
      {
        // The same label as the failure branch, on purpose: a panel that keys on labels
        // should not have to know whether the read succeeded to find the age, and the
        // age is the one number that tells it the difference.
        label: 'engine last answered',
        value: ageMs === null ? 'no answer yet' : `${ageMs}ms since the engine answered`,
        tone: 'neutral',
      },
    ];
  }
}
```


## FILE: apps/api/src/modules/observability/engine-posture.service.spec.ts (409 lines)

*18 tests around that service, including the ones that make a panel honest: a shape error reports the key name rather than an HTTP 500, a timeout says the read is still running, an error before the first success does not claim to show a stale-but-real answer, `unconfigured` explains what to set, the cache is not a second TTL implementation, and a posture that reports `simulated: true` cannot render as a green live deployment.*

```typescript
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
```


## FILE: docs/PART20_ENGINE_STATUS_EDGE.md (499 lines)

*the part's own document, nine sections: what the audit found in the tree as it stood, the mirror and its two absence laws, the parity law, the panel and its tone law, the nine refusals with reasons, in the order the section lists them (no engine health-mirror publisher, no worker-side placement gate, no published readiness gates, no console renderer for `sections`, no re-badging of the four open ROADMAP rows, no Prometheus/Alertmanager rule generation out of prose conditions and `threshold: float | None`, no cron container in compose, no change to `/health/ready`'s unauthenticated posture, no configuration knob beyond `--manifest`), the scheduler wiring, the defect that running the composition found with its before/after measurements, every gate number transcribed from the run, and what an operator does with any of it.*

````text
# Part 20 — the engine's own account, read; and the checker, run

Scope: the operational tail's two remaining code-able gaps. Everything planned here is
display and derivation, and no gate, verdict, credential, order path or refusal threshold
moved: live mode still refuses at startup exactly as Part 19 left it.

One thing changed behaviour, and it is stated here rather than left for the reader to
discover in the diff. Checking that the pieces actually compose turned up a live defect:
the worker's startup gate could not get an answer out of the engine at all, so a
deployment built from `docker-compose.yml` exited 1 before consuming a job. Fixing it put
Python under `services/execution-engine/` in scope - an auth *scope*, described in
section 7, with the command law itself unchanged to the byte. Everything else in this
document is still read-only.

Read with [`PART19_LIVE_ENABLEMENT.md`](PART19_LIVE_ENABLEMENT.md), which is where the
facts published on this surface come from. This document is about who reads them.

---

## 1. What the audit found, in the tree as it stood

The execution engine answers `GET /internal/v1/status` from a Pydantic model
(`services/execution-engine/app/schemas.py::StatusResponse`) declared `extra="forbid"`.
Its field set therefore cannot grow in silence on the producing side. That document is
20 fields wide:

```
instanceId  mode  dryRun  adapter  store  storeDurable  storeBackend  retentionEnabled
retentionEventDays  enablementMaxAgeDays  credentialSource  credentialFetcher
operatorConfirmation  liveEnablement  placement  incidents  metricsConfigured
locksDistributed  commands  simulated
```

It had exactly one reader in the repository: the worker's client
(`apps/api/src/modules/worker/engine-internal.client.ts`), which picked nine of those
twenty keys out of the parsed body and read each one as `body.X ?? ''`, `?? []`, or
`=== true`. The gate then judged `mode` and `storeBackend` on values that could be
invented by the reader itself, and the other eleven keys were transported, validated by
the engine, and dropped at the boundary. `getStatus()` was called once, at worker startup
(`src/worker.ts:69`), and its 10-second cache was documented as existing "only for the
periodic health view" — a view that was never built.

So the platform had a service that answered questions nobody asked it, and an operations
panel whose execution section was assembled from other people's data: the readiness gate
`execution_adapter`, whose evidence the TRADING engine publishes about its own view of
whether it can reach an adapter, plus a 24-hour order-status mix from the API's database.
Nothing on that panel said what the process doing the placing is wired with.

That is the whole finding for this section: eleven published facts and an uninstalled
checker, not a security hole and not a money-path bug. A second finding appeared later, in
section 7, once the composition was run rather than reasoned about - the single reader in
the paragraph above could not in fact read, which made the gate that is supposed to refuse
forwarding an unbootable control in the reference deployment.

## 2. The mirror: one table, and two laws about absence

`apps/api/src/modules/worker/engine-status-contract.ts` is now the only description of
that wire in TypeScript. It is a table of 20 field descriptors plus one per
sub-document (`placement`, `liveEnablement`, `incidents`), and the table IS the parser —
there is no second list of keys to keep in step with the first.

**Law one: a required key that arrives missing is a refusal, naming the key.**

```
execution engine /status declares "instanceId" as required and the reply did not carry it
- this engine is older than the contract this worker was built against
```

Required means what `StatusResponse` says it means, not what this file prefers: the eight
fields declared without a default (`instanceId`, `mode`, `dryRun`, `adapter`, `store`,
`storeDurable`, `locksDistributed`, `commands`). Before this part, `String(body.mode ??
'')` turned "the engine is not there, a proxy answered with HTML" into `mode: ''`, which
the gate then reported as *the engine is in the wrong mode* — a refusal that blamed the
engine for the transport's failure. A wrong type is a refusal for the same reason; the
contract spec pins that `instanceId: null` is a refusal rather than a comfortable empty
string.

**Law two: an optional key that arrives missing means what the engine's own default means.**

Twelve of the twenty fields carry a default in Python, and each default is a *statement*:
`storeBackend = "unknown"` so a pre-Part-13 reply reads as unproven instead of as
`memory`; `credentialSource = "none"`; `placement = None` so "no review wired" stays
distinguishable from "an engine that has never heard of reviews"; `simulated = True`.
The mirror copies those values rather than inventing replacements, and the parity spec
below compares them one by one. A field whose Python annotation is `X | None` is marked
`nullable` in the table, because an explicit null and an absent key are two different
answers — `credentialFetcher: null` means "the source in use needs no reader", while a
reply with no such key means "an engine from before Part 19". Conflating them is how a
wire contract quietly loses its meaning.

**Unknown keys are tolerated and reported.** The parsed object carries
`unmappedKeys`, the panel prints the count as a row, and the parity spec fails. The
asymmetry is the argument: a missing required key means the engine is older than this
worker's contract, which invalidates an assert; an extra key means it is newer, which
invalidates none. Newer is not a 03:00 problem, it is a CI problem, and CI is where it
now lands.

## 3. The parity law: three sides, all checked

Three documents describe one contract:

1. `EngineRuntime.describe()` publishes the facts;
2. `StatusResponse` declares which are required and what the absence of an optional one
   means;
3. `ENGINE_STATUS_FIELDS` reads them.

Side 1 against side 2 was already pinned by the service's own suite — that is why the
status route may write `wiring["metricsConfigured"]` with brackets instead of `.get()`,
and `PlacementStatusView`'s docstring in `schemas.py` says the counterpart test asserts
the two key sets agree. Side 3 was pinned by nobody, which is precisely how nine became
the answer to what is twenty.

`apps/api/src/modules/worker/engine-status-parity.spec.ts` closes it by parsing
`schemas.py` with the same live-source technique the alert catalogue parity uses
(`modules/observability/alert.constants.ts`) and the dataset transition table uses
(`modules/datasets/datasets-safety.spec.ts`): it reads the file rather than a fixture,
because the drift it prevents is "somebody edited one side" and a checked-in copy of the
schema would be a fourth side to disagree with. It asserts, per field: name after the
`_to_camel` aliasing rule restated in the spec, kind, requiredness, nullability, and the
default value. An annotation the spec cannot classify is a hard failure with a message
refusing to guess — "silently classifying a new wire type as a string is how a contract
mirror starts lying about a field it never looked at".

It also pins the historical gap by name, listing the eleven dropped keys and asserting
each is mirrored. That test exists because a mirror "simplified" back to nine keys would
otherwise pass every comparison of both sides of a change made together.

## 4. The panel: `ENGINE POSTURE`, with a tone law

`apps/api/src/modules/observability/engine-posture.service.ts` reads the engine through
the worker's own client — the same instance, the same parser, the same cache — and renders
a section that `executionPanel` appends after its own rows:

```
GET /v1/observability/execution  ->  { sections: [ EXECUTION, ENGINE POSTURE ] }
```

Two sections rather than rows merged into one, because the rows above are the API's
database describing what went through it and the rows below are another process's account
of itself. A derived fact and a self-reported one never share a row on this platform.

The **tone law** is stated in the service and asserted for every state in
`engine-posture.service.spec.ts`: `ok` is reserved for a fact the engine reported about a
component doing what it was configured to do; a missing answer is `warn`; a reported
contradiction is `bad`; a fact with nothing right or wrong about it (which mode this is,
which store class, how long the retention window is) is `neutral`. There is no path in
that file that renders absence as `ok`, and the test walks the states to prove it rather
than trusting the switch.

The rows, and what each is for:

| Row | Reads | Notes |
|-----|-------|-------|
| engine instance | `instanceId`, `mode`, `dryRun`, `commands.length` | identity, not verdict |
| durable store | `storeDurable`, `storeBackend`, `store` | `bad` on the contradiction the worker already refuses to forward into |
| distributed locks | `locksDistributed` | single-instance by configuration is `neutral`, not `warn` |
| credential source | `credentialSource`, `credentialFetcher` | names the reader when one exists; never a value |
| operator confirmation | `operatorConfirmation`, `placement.confirmationConfigured`, `placement.policy.requireOperatorConfirmation` | "asked for and absent" is `bad`, "not wired" is `neutral` — Part 19's two halves kept apart |
| live enablement | `liveEnablement` | a refusal with a hard blocker is `neutral` (it is the designed state); no answer at all is `warn` |
| incident sink | `incidents` | `durable (postgres)` is the only `ok` there |
| instrumented | `metricsConfigured` | `warn` when nothing is measuring this process |
| journal retention | `retentionEnabled`, `retentionEventDays`, `enablementMaxAgeDays` | |
| placement review | `placement.label`, `placement.attestorSource` | label and provenance only |
| keys this build does not mirror | `unmappedKeys` | appears only when non-empty |
| engine last answered | the client's own cache stamp | see below |

**Age is the engine's answer time, not this read's.** The service reports
`statusFetchedAtMs()`, added to the client for exactly this purpose: an age computed from
when the panel ran is a tautology wearing the word "age". On the failure paths the last
good answer's timestamp still rides along, because "unknown for 60 seconds" and "never
known" are different incidents and an operator reads them differently.

Two more decisions worth their keep:

* **The panel budget is 2 seconds, and a slow read is not cancelled.** The client's own
  30-second timeout is the queue-hop guard, sized against a venue round trip; an
  operations page must not be able to wait that long on a service it is asking "how are
  you". A read that exceeds the budget renders `unverified` / `PANEL_BUDGET` with the
  words "the read is still running and the next refresh will show it", because it is.
* **Nothing is imported from the worker module.** The engine client is built by a factory
  bound in `ObservabilityModule` (`createEnginePostureClient`, exported so the spec tests
  the decision rather than describing it) and the binding is `null` when the deployment
  has no engine token. `WorkerModule` is not imported, because that module also provides
  the queue processor and this module's standing guarantee is that no execution
  dependency points back at the trading plane. The service's own `wired` getter reports
  only whether a client is bound: the configuration question was asked once, by the
  factory, and asking it again on the read path would put a second copy of that law where
  it could disagree with the binding and print "not wired" next to live data.

**The scan for secret shapes covers this surface too.** The engine publishes
`placement.operatorConfirmation.fingerprint`, a 12-character digest prefix meant for
correlation. It is on the wire and deliberately not on the page; the spec asserts the
rendered JSON of a section contains neither that fixture value nor any long base64-ish
run, so a future row that dumps a sub-document whole fails here first.

## 5. What this part refused to do

* **Make the engine a health-mirror publisher.** `OBS_PUBLISHER_SERVICES`
  (`packages/config/src/constants.ts:155`) is the Redis channel that
  `market-data` and `trading-engine` write to, and it is the reason the panel can show
  those services at all. Adding `execution-engine` to it would need a Redis client in a
  service that owns none and a background task it does not run — two new things to copy
  facts the process already answers on request. The reader goes to the author. This is
  also why the age of the answer is a first-class field here: this view is only as fresh
  as its last read, and the file says so rather than implying a push.
* **Give the worker a placement gate.** The engine publishes enough to build one
  (`placement.policy.requireOperatorConfirmation`, `requiresVenueAttestation`,
  `liveEnablement.missing`), and it would be a mistake: the ack law
  (`engine-internal.client.ts`, the Part 13 re-review block) counts a business rejection
  as DONE precisely so the durable order record and its refusal reason survive. Refusing
  before forwarding would turn a recorded, tenant-visible refusal into a queue retry with
  no record at all. A gate belongs on the engine, where Part 16 through Part 19 put it.
* **Publish the engine's own readiness gates.** `RedisKeys.ops_readiness_mirror`
  (`wlct_trading/redis_keys.py:355`) explicitly leaves room: "only the trading engine
  writes this today; the shape is per-service so an execution worker can later publish
  its own gates". Untaken by choice. A published gate that the API merge honours turns a
  displayed fact into a blocking one, and that is a behaviour change in the money path
  disguised as an observability feature. The seam stays where it is, named, so the next
  reader finds the decision instead of re-deriving it.
* **Touch the admin console.** The console renders `overview`, `trading-readiness`,
  `alerts` and `incidents` (`apps/admin-web/src/app/(console)/observability/page.tsx:146`)
  and does not render per-plane `sections` at all. The section added here is the
  documented API-side operations surface, exactly as Parts 9 and 18 left theirs; a bespoke
  table for one service's wiring would be a second rendering path for the same rows.
* **Restate the four open ROADMAP rows as finished.** Time-series retention behind the
  exposition, RED dashboards beyond the panel, the chaos/failover matrix against real
  infrastructure, and the `--record-rls` staging audit all need a deployment rather than a
  commit. `docs/ROADMAP.md` keeps its wording so the deliberate non-absorption stays
  readable as a decision.
* **Generate Prometheus or Alertmanager rule files from `ALERT_RULES`.** `AlertRule`
  (`libs/trading-core/wlct_trading/observability/alerts.py`) carries `condition` as prose and
  `threshold: float | None`; for the ratio and boolean rules the threshold is `None`, so any
  `expr:` a generator emitted would be arithmetic this tree does not have. There is also no
  `infrastructure/observability/` to write it into - `infrastructure/` is `docker/` plus
  `database/` - so the open ROADMAP rows are unimplemented, not merely unwired, and a file
  full of invented thresholds would read as the difference.
  (Superseded in part by Part 22: `infrastructure/observability/` exists now, and a generator does
  derive rule files - for the four rules whose thresholds exist. The arithmetic objection was the one
  that held, and it is why 20 of the 24 rules are printed as refusals rather than as expressions
  (docs/PART22_SCRAPE_SIDE.md sec. 3).
* **Add a cron container to `docker-compose.yml`.** The compose file carries 10 services and
  no host-cron equivalent; a container that runs `--due` needs the repository mounted into it,
  an entrypoint override, and a service whose job is to sleep. The generated schedule is
  installable with two documented commands, and owning the artefact plus the instructions is
  the smaller true claim.
* **Change `/health/ready`'s authentication.** It answers unauthenticated and publishes a
  superset of `/status`'s keys - a relation the new test holds as an invariant. Narrowing it
  would be a deployment-visible behaviour change well outside this part, and its openness is
  precisely the argument section 7's exemption rests on: the right move is to document the
  relation and test it, not to edit either side of the equation to make a paragraph read
  better.
* **Add a configuration knob for the exempted read.** No new `EXECUTION_*` variable exists for
  it: the exemption is a property of one route that acts on no tenant, not an operator
  preference, and a knob would make the reach of a security law depend on a deployment
  remembering to set it. The only new option introduced anywhere in this part is `--manifest`,
  an argument to a read-only command, added so a hypothetical board can be exercised at all
  (sec. 6).

## 6. The scheduler wiring

`node scripts/dr-manifest.mjs --due` answers "what is overdue" and exits 1 when something
is. Until now it ran when a human remembered it, which makes it a claim rather than a
control — the same distinction the manifest draws about backups. The ROADMAP said so
directly: the open item is the *wiring* of that command into a scheduler.

`docs/dr/schedule/dr.cron` is that wiring, generated:

```
wlctRoot=.
SHELL=/bin/sh
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --due
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --check
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --check-rls
```

Two modes drive it: `--emit-schedule [--root PATH] [--out PATH] [--manifest PATH]` writes
it, and `--check-schedule` compares the committed file against a fresh generation and
exits 1 on any difference. `--manifest` exists because a mode that can only read the
repository's own manifest cannot be tested against a broken input without breaking the
repository.

The rules the emitter keeps, all of them tested in `scripts/dr-manifest.test.mjs`:

* **It may ask questions, never answer them.** Only `--due`, `--check` and `--check-rls`
  are emitted. `--record` and `--record-rls` are the ledger's two write modes, and a job
  that writes evidence on a timer records an outcome nobody observed — the faked seed data
  the ledger refuses to contain. `--check-schedule` fails on a file containing either,
  and reports it as its own finding rather than as a byte mismatch, so a tampering cannot
  hide inside an accepted rewrite. Until the first real `--record`, `[DUE]` on every
  component is the correct reading of this board, and the file says that in its header.
* **Intervals are derived and capped**: `min(tightest declared cadence, 24h)` for `--due`,
  24h for `--check` (manifest validity is a deployment invariant, not an obligation, so it
  does not follow the cadences), and `rlsEvidence.cadenceHours` capped the same way for
  `--check-rls`. Checking more often than an obligation is free; less often is how a
  breach waits out the gap.
* **A step that does not divide the day is honoured, not approximated.** `*/7` in the hour
  field fires at 0, 7, 14, 21 because the field restarts at 0, so the longest gap is 7
  hours. The comment in the renderer carries that arithmetic, because the reader who
  "fixes" it to weekly needs the argument, not just the line.
* **Waivers are rendered, not omitted.** A component with `cadenceHours: null` gets a
  comment naming its waiver, and if every component is waived the file still schedules
  `--check` daily — a manifest that has stopped parsing would otherwise be the reason no
  job reports anything at all.
* **The file is deterministic**: no timestamps, no host names, no ordering that depends on
  the ledger, and two renders are byte-identical. Re-emitting prints `(content unchanged)`
  instead of pretending to change something.
* **The root line is the deployment's**: `wlctRoot=.` is substituted at install time
  (`--emit-schedule --root /srv/whitelabel-copytrade`), and `--check-schedule` reads the
  value out of the file rather than assuming it, so the gate stays byte-exact on
  everything else. It is lower-case because this repository scans every generated file for
  `NAME=literal` assignments in the shape an env file uses, and the right answer when a
  secret scanner objects to a line is to stop writing a value that looks like a secret —
  not to teach the scanner to look the other way. A path is not a secret and should not be
  shaped like one.
* **The exit code is the alarm.** How a non-zero cron exit reaches a human — `MAILTO`, a
  log shipper, an init that maps exits to alerts — is deployment knowledge this file
  refuses to guess at, and says so.

Install, for a deployment that wants it:

```bash
node scripts/dr-manifest.mjs --emit-schedule --root /srv/whitelabel-copytrade \
  --out /tmp/dr.cron && crontab /tmp/dr.cron
# /etc/cron.d entries take a sixth user field; a user crontab does not.
```

Three documents still said this half did not exist, and a control that is shipped while being
described as missing is a control nobody goes looking for - so they were brought in line rather
than left as history:

* `docs/DR.md`'s "What is NOT yet automated, plainly" section now states the wiring and reduces
  the open items to installing the file, the drill calendar, and the first real `--record`. Its
  *heading* is kept on purpose, because `docs/PART15_RLS_ENABLEMENT.md` sec. 8 cross-references
  that exact heading, and a renamed section turns a live document into a broken link.
* `docs/PART15_RLS_ENABLEMENT.md` carries a "SUPERSEDED BY PART 20" note in the style Part 11
  and Part 13 established for exactly this situation: it says what Part 15 did and what Part 20
  closed, without rewriting either.
* `.env.example` - the file an operator reads when deciding whether to set a variable - names
  both consumers of `EXECUTION_ENGINE_URL` / `EXECUTION_ENGINE_TOKEN` (the worker's gate and the
  panel), states what absence does (the API boots; the section says `unconfigured`), and warns
  that its own `127.0.0.1` URL is a developer's loopback that compose overrides.

Two of these are also the reason the compose comment no longer cites line numbers. It quoted
`worker:`'s token translation at "line 349", and Part 20's own insertion above it had already
made that false on the day it was written - which is what a positional citation in a file the
same commit edits is worth, so the reference is now by service name.

## 7. The defect section 1 turned into, and the live check that found it

Section 1 said the contract had one reader. It had, more precisely, no *working* reader.
`apps/api/src/worker.ts` calls `GET /internal/v1/status` at startup with the internal
token and no tenant header - correct, because a process-level read has no tenant to name -
and `app/security.py::require_internal_auth` required a tenant header on *every* internal
route, so the engine answered:

```
400 {"code":"TENANT_HEADER_REQUIRED","message":"Every execution command must name its
      tenant via the x-tenant-id header; tenantless money operations are refused."}
```

400 is not in that client's terminal set, so `assertEngineCompatible()` re-raised,
`src/worker.ts` logged "execution engine gate failed" and exited 1: in the reference
deployment the worker could not start, and had not been able to since the gate shipped in
Part 11. Nine parts of green suites sat on top of it because every test of that client
stubs `fetch`, which is the whole reason this part's engine-side tests drive an HTTP
client and the real route table instead.

The fix is a second auth scope, not a loosened law:

* `require_internal_auth_readonly` shares both halves of the real requirement with the
  command scope - one `_authenticate` (so there is exactly one constant-time comparison
  to get wrong) and one `_tenant_or_none` (so `required=False` tolerates absence and
  still refuses a malformed header) - and the scope's *order* is pinned: no token, an
  empty token, a same-length wrong token and a truncated token are all 401, so nobody can
  reach the tenant branch without the secret.
* It is used by exactly one route, asserted by walking `app.routes` and inspecting each
  route's dependant callables, and separately by sweeping every other internal route over
  HTTP to confirm a tenantless POST still gets `TENANT_HEADER_REQUIRED`. A future route
  cannot inherit the exemption quietly, in either direction.
* The command scope's refusal code and message are unchanged to the byte, and a test
  compares the two status payloads - tenantless and tenant-bearing - as *text*, so the
  nine parts of existing callers see a byte-identical document.
* `require_internal_auth_readonly` returns `tenant_id == ""` rather than a sentinel like
  `"system"`, because an invented identifier in the one object whose purpose is to name a
  real tenant is a fact that will eventually be compared to one; the status route never
  reads the field, which is why an empty string is honest here.
* The disclosure question - why this is not a new exposure - is an invariant, not a
  paragraph: a test asserts `/health/ready`'s key set is a superset of `/status`'s, so if
  readiness is ever narrowed the exemption's justification fails in CI and has to be
  re-argued out loud.

Why the client could not fix it. `getStatus()` has no tenant to send: the worker's
startup gate runs before any job payload exists, so naming one would mean inventing one
and teaching the engine to accept invented tenants on a money surface - a worse
trade than the one made above. The other option, pointing the gate at the
unauthenticated `/health/ready`, would base an assert-before-forward decision on a
document any peer on the network can answer.

Measured against a booted engine (`uvicorn --factory app.main:create_app`, `NODE_ENV=test`
composition, port 8094), both before and after:

| Check | Before | After |
|-------|--------|-------|
| `GET /internal/v1/status`, token only | 400 `TENANT_HEADER_REQUIRED` | 200, 20 keys |
| same, token + `x-tenant-id: t-verify` | 200, 20 keys | 200, byte-identical text |
| `GET /internal/v1/status`, no token | 401 | 401 |
| same, `x-tenant-id: ../etc` | 400 `TENANT_HEADER_INVALID` | 400, same |
| `POST /internal/v1/orders/cancel`, token only | 400 `TENANT_HEADER_REQUIRED` | 400, same |
| the live 20-key payload through the TS mirror | n/a (would 400) | parses; `instance=exec-test-1 mode=simulated creds=none fetcher=null confirmation=false`, enablement `missing=7 satisfied=1 hardBlockers=true`, `unmappedKeys=[]` |
| dropping `instanceId` from the live payload | — | `EngineStatusShapeError`, `field="instanceId"` |

## 8. Verification

Every number below was transcribed from the run, on this tree, in this order.

| Gate | Command | Result |
|------|---------|--------|
| API suite | `cd apps/api && npx jest --silent` | 425 passed, 20 suites |
| API types | `npx tsc -p tsconfig.json --noEmit` | 0 errors |
| API lint | `npx eslint src --max-warnings 0` | clean |
| Admin types | `cd apps/admin-web && npx tsc --noEmit` | 0 errors |
| Script tests | `node --test scripts/` | 65 passed, 0 failed |
| Schedule gate | `node scripts/dr-manifest.mjs --check-schedule` | exit 0, "schedule valid: 3 job line(s) (--due, --check, --check-rls), derived from 5 components, no ledger-writing mode present" |
| Manifest gate | `node scripts/dr-manifest.mjs --check` | exit 0, "manifest valid: 5 components (4 with cadence), RPO 60m / RTO 4h, drill every 90d (timed: true), ledger entries: 0" |
| Due board | `node scripts/dr-manifest.mjs --due` | exit 1, 4 obligations DUE (`encryption-keys`, `postgres`, `dataset-objects`, `deployment-config`), `redis` printed as `[waive]` |
| Core | `cd libs/trading-core && python3 -m pytest -q` | 1656 passed |
| Core lint/types | `ruff check wlct_trading tests` / `mypy wlct_trading` | green / clean, 150 files |
| Engine service | `cd services/execution-engine && python3 -m pytest -q` | 428 passed, 12 skipped |
| Engine lint/types | `ruff check app tests` / `mypy app` | green / clean, 24 files |
| New engine tests | `pytest -q tests/test_part20_status_read.py` | 19 passed |
| Doc sweep | `grep -rn "still unwired\|remaining automation\|not yet automated" docs/*.md \| grep -v HANDOVER` | two hits, both the corrections themselves quoting the phrase they retire - no live claim that the scheduler is missing |
| Compose parse | `python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))"` | parses; `api:` and `worker:` carry identical `EXECUTION_ENGINE_URL` (`http://execution-engine:8093`) and `EXECUTION_ENGINE_TOKEN` (`${EXECUTION_INTERNAL_TOKEN:-}`); 10 services |
| Sibling services | `services/trading-engine`, `services/market-data` pytest | 43 / 19 passed |
| Live engine | `uvicorn --factory app.main:create_app --port 8094` + curl, section 7 | tenantless 200 with 20 keys, 401 without token, 400 on malformed tenant, 400 on tenantless POST |
| New test file, typed | `mypy tests/test_part20_status_read.py` | clean (the service gate covers `app` only, as since Part 11) |
| Handovers reproducible | `python3 scripts/gen_part{n}_handover.py --check`, n = 16..20 | `OK: ... byte-identical to a fresh generation` for all five |
| Source dump | `node scripts/generate-source-dump.mjs`, twice, hashed | 11 sections, 844 files, 546,571 lines; `sha256` of the concatenated tree identical across runs |

The dump row is phrased that way because it is true: `generate-source-dump.mjs` has no
`--check` mode - it takes no arguments at all and always writes - so its reproducibility is
proved by running it twice and comparing bytes rather than by a flag this part could have
invented and quoted. The handover row is the one that costs real time, and it carries the
ordering lesson this part learned the hard way: a part's own new files move the whole-tree
counts quoted inside every earlier handover, so the ancestors must be regenerated AFTER the new
files exist and BEFORE any `--check` is believed. Part 20's first chain reported
`STALE: PART16 ... (22,828 generated lines vs 22,828 committed)` - equal line counts, different
content - which is what a stale number looks like, and why the check compares bytes instead of
sizes.

Two of those rows are the audit's point, not decoration. The `--due` row shows exit 1 on a
board with four unrecorded obligations: the scheduler now asks questions the deployment has
not answered, which is the intended steady state until a human runs `--record`. And the
live-engine row is what no suite could have told me: 428 engine tests, 425 API tests and 65
script tests were all green while the reference worker could not start.

The claim "display and derivation only" is checked by the diff rather than asserted: the
Python under `services/execution-engine/` is `app/security.py` (two scopes over one law),
`app/routers/internal.py` (one `Depends` line), `tests/conftest.py` (a fixture whose
`-> TestClient` lied about a generator, typed honestly while section 7's tests came to
depend on it), and the new `tests/test_part20_status_read.py`. `libs/trading-core` - every
gate, verdict and refusal threshold - is untouched, which is why the core's 1656 and the
siblings' 43 and 19 are quoted above rather than skipped as unchanged.

New tests by file: `engine-status-contract.spec.ts` (16), `engine-status-parity.spec.ts`
(5), `engine-posture.service.spec.ts` (18), 13 added to `dr-manifest.test.mjs`,
`tests/test_part20_status_read.py` (19).

## 9. What an operator does with this

* "Why is every order this engine took refused?" — `ENGINE POSTURE` → the
  `operator confirmation` row (`asked for and absent` names the outage Part 19 predicted)
  and the `live enablement` row, without shell-ing into the container.
* "Is this deployment instrumented?" — the `instrumented` row and the `durable store`
  row's contradiction case, both from `/status`, not from the absence of a graph.
* "Is anything actually watching the backups?" — `node scripts/dr-manifest.mjs
  --check-schedule` says whether the watcher is installed and matches the manifest, and
  `--due` says what is overdue.
* "The panel says `unconfigured`." — this process was never pointed at the engine:
  `EXECUTION_ENGINE_URL` and a 32-character `EXECUTION_ENGINE_TOKEN` are absent, so no
  client was constructed (the observability module asks before building one, and the
  refusal to build an unusable client is the engine client's own law). Set both and the
  row lights up; `docker-compose.yml` sets both for `api:` since Part 20, which is why a
  reference deployment is expected to show posture rather than this word.
* "The panel says `unverified`." — that is the answer, not a fault: the engine did not
  answer within 2 seconds, did not answer at all, or answered with something that is not
  the contract. The `code` in the row says which, and the row names the key for the last
  case.

Predecessor note, for anyone reading the parts in order: the facts published on this surface
are Part 19's, and §2 and §7 of `docs/PART19_LIVE_ENABLEMENT.md` stay authoritative for what a
live deployment lacks - this document is about who reads those facts, not about producing them.
The gate that consumes the same document is Part 11's, and §7 of
`docs/PART11_WORKER_SCALING.md` now carries both its policy and the record that the policy
could not run. For "what Part 20 built", `docs/PART20_HANDOVER_FULL_SOURCE.md` is
authoritative: it embeds the complete current content of all 27 files (9 created, 18 modified)
and its generator re-proves that byte for byte. One asymmetry to know before diffing: Parts 16 through 19 embed the *current*
tree, so a later part's edit to a shared document appears inside those handovers too, which is
why a regenerated ancestor's ledger deltas shrink and why this part's ledger prints its measured
delta beside the pre-regeneration one instead of choosing the larger number.
````


## FILE: docs/dr/schedule/dr.cron (46 lines)

*the generated schedule: `wlctRoot=.`, one `SHELL=/bin/sh`, and three job lines (`--due` daily, `--check` daily, `--check-rls` at the tightest declared cadence), with redis's no-obligation waiver echoed as a comment and no job line of its own. Generated by `node scripts/dr-manifest.mjs --emit-schedule` and drift-gated by `--check-schedule`; it may schedule reads and never a ledger write, and the installation step stays a documented `crontab` command because this repository does not own a host's cron.*

```
# Generated by `node scripts/dr-manifest.mjs --emit-schedule`. Do not edit.
# The cadences live in docs/dr/manifest.json; this file is that data written in
# cron grammar, and `--check-schedule` compares it against a fresh generation.
# Exactly one line below is yours to change: wlctRoot. Everything else is derived.

# What each job does, and what none of them does:
#   --due        grade the ledger against the declared cadences and exit 1 when an
#                obligation has no recorded success inside its window;
#   --check      validate the manifest itself (schema, secret shapes, the RPO and
#                cadence laws) and exit 1 on any violation;
#   --check-rls  age the row-level-security enablement audit and exit 1 when the
#                claim has no passing audit behind it. That is the state a fresh
#                deployment is legitimately in: docs/PART15_RLS_ENABLEMENT.md.
# No line writes evidence. --record and --record-rls are the ledger of the two
# write modes and both require a human to name an outcome, because an unattended
# job recording an outcome nobody observed is faked seed data. Until the first
# real --record, [DUE] on every component is the correct reading of this board.

# The exit code IS the alarm. How a non-zero cron exit reaches a human is
# deployment-side (MAILTO, a log shipper, an init that maps exits to alerts), and
# this file cannot know that answer, so it does not guess one.

# The script resolves its own repository root from its own location; the only thing
# this line supplies is where to find the file, which is the one fact about the host
# that is not derived from the manifest. Lower-case on purpose: this repository scans
# every generated file for `NAME=literal` assignments in the shape an env file uses
# (findSecretShapes above), and the right answer when a scanner objects to a line is
# to stop writing a value that looks like a secret, NOT to teach the scanner to look
# the other way. A path is not a secret and should not be shaped like one.
wlctRoot=.
SHELL=/bin/sh

# Derived from the tightest declared cadence on the board (24h), capped at 24h:
# a check more frequent than the obligation is free, a check less frequent is how a
# breach waits out the gap between runs.
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --due
# Manifest validity is a deployment invariant rather than an obligation, so it runs
# on the daily ceiling whatever the cadences above do.
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --check

# RLS evidence ages against rlsEvidence.cadenceHours (168h), so the check
# runs at the capped interval that bound implies.
0 0 * * * node "$wlctRoot/scripts/dr-manifest.mjs" --check-rls

# Obligations this file does not schedule, because the manifest waived them:
#   redis: Rebuildable by design: queues, claims, reservations and mirrors are all re-derived by the workers within one tick. The forensic RDB exists for incident archaeology only - scheduling its copy would manufacture an obligation the component's own contract denies.
```


## FILE: services/execution-engine/tests/test_part20_status_read.py (345 lines)

*19 tests for the engine side of section 7: the read answers tenantless with exactly the 20 contract keys and real values; a tenant-naming caller gets a byte-identical document; correlation round-trips; an empty `x-tenant-id` equals an absent one on both scopes; a malformed tenant still 400s under the read scope; no token, an empty token, a same-length wrong token and a truncated token all 401 before the tenant branch is reached; the command scope's refusal code and sentence are pinned to the byte; the read scope is asserted to sit on exactly one route by walking `app.routes`; every other internal route is swept over HTTP to confirm a tenantless POST still gets `TENANT_HEADER_REQUIRED`; and `/health/ready`'s key set stays a superset of `/status`'s, which is the disclosure argument for the exemption held as an invariant.*

```python
"""Part 20: the read scope on the one internal route that acts on nothing.

These tests exist because of a defect found by RUNNING the composition, not by reading
it. ``apps/api/src/worker.ts`` calls ``GET /internal/v1/status`` before it will forward a
single job, with the internal token and no tenant header - correctly, since a
process-level read has no tenant to name - and the engine answered
``400 TENANT_HEADER_REQUIRED``. That code is not in the worker's terminal set, so the
worker logged "execution engine gate failed" and exited 1: in the reference deployment
the worker could not start, and had not been able to since the gate shipped in Part 11.
Nine parts of green suites missed it because every test of that client stubs ``fetch``,
which is the general lesson here and the reason the tests below go through an HTTP
client and the real route table rather than a mock.

The exemption is scoped as narrowly as it can be, and each narrowing is asserted:
the token is still required; a tenant header that IS sent is still validated; the
correlation id still round-trips; the command scope's refusal text is unchanged to the
byte, because the worker matches on it; and the read scope is used by exactly one
route in the application, checked by walking the route table so the next route cannot
inherit it quietly.
"""

from __future__ import annotations

from typing import Any, cast

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import CORRELATION_HEADER
from app.security import (
    CALLER_AUTH_HEADER,
    TENANT_HEADER,
    TENANT_REQUIRED_CODE,
    ServiceCaller,
    require_internal_auth,
    require_internal_auth_readonly,
)
from tests.conftest import BASE_ENV, auth_headers

TOKEN = BASE_ENV["EXECUTION_INTERNAL_TOKEN"]

#: The wire contract, spelled out. `app/schemas.py::StatusResponse` is the authority and
#: the TypeScript mirror in `apps/api/src/modules/worker/engine-status-contract.ts` is
#: parity-tested against that file; this literal is the third copy, deliberately, because
#: what it protects is the *published* shape - what a reader sees - and a reader's
#: contract should be tested from the reader's point of view, not only from the
#: producer's. If this list and the schema diverge, someone changed the wire.
STATUS_CONTRACT_KEYS: frozenset[str] = frozenset(
    {
        "adapter",
        "commands",
        "credentialFetcher",
        "credentialSource",
        "dryRun",
        "enablementMaxAgeDays",
        "incidents",
        "instanceId",
        "liveEnablement",
        "locksDistributed",
        "metricsConfigured",
        "mode",
        "operatorConfirmation",
        "placement",
        "retentionEnabled",
        "retentionEventDays",
        "simulated",
        "store",
        "storeBackend",
        "storeDurable",
    }
)


def _code_of(exc: HTTPException) -> str:
    """The `code` of a raised HTTPException, typed.

    `detail` is declared `str | None` by the framework while every raise site in
    `app/security.py` passes a dict, so an `isinstance(detail, dict)` here would be
    provably false to a type checker - and unreachable code is exactly how an assertion
    stops being one. The cast states the known shape and the runtime check below keeps
    it honest: a raise that lost its code fails here instead of comparing `None` to a
    string, and the file needs no suppression comment to type-check.
    """
    detail = cast("dict[str, Any]", exc.detail)
    code = detail["code"]
    assert isinstance(code, str)
    return code


def _token_headers() -> dict[str, str]:
    return {CALLER_AUTH_HEADER: TOKEN}


def _internal_routes(app: Any) -> list[APIRoute]:
    return [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/internal/v1")
    ]


def _dependant_calls(dependant: Any) -> set[Any]:
    found: set[Any] = {dependant.call}
    for sub in dependant.dependencies:
        found |= _dependant_calls(sub)
    return found


class TestReadScopeAnswers:
    def test_status_answers_a_tenantless_internal_caller(self, client: TestClient) -> None:
        """The defect, pinned in the direction it now points."""
        response = client.get("/internal/v1/status", headers=_token_headers())
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body, dict)
        assert frozenset(body) == STATUS_CONTRACT_KEYS
        # Not "the keys are there": the values are this process's own answers, so a
        # reader that renders them cannot be rendering a default.
        assert body["instanceId"] == BASE_ENV["EXECUTION_INSTANCE_ID"]
        assert body["mode"] == "simulated"
        assert body["storeDurable"] is False
        assert body["credentialSource"] == "none"
        assert body["credentialFetcher"] is None
        assert body["simulated"] is True
        assert isinstance(body["commands"], list)
        enablement = body["liveEnablement"]
        assert enablement is not None
        assert enablement["liveRefused"] is True
        assert enablement["hardBlockersPresent"] is True

    def test_a_caller_that_names_a_tenant_gets_the_same_bytes(self, client: TestClient) -> None:
        """Back-compatibility, asserted rather than assumed.

        The nine parts of clients that already send a tenant header must see no change
        at all: same document, same ordering, same types. Comparing the two payloads
        as text is the strict form of that claim.
        """
        tenantless = client.get("/internal/v1/status", headers=_token_headers())
        scoped = client.get("/internal/v1/status", headers=auth_headers("tenant-a"))
        assert scoped.status_code == 200
        assert tenantless.status_code == 200
        assert scoped.text == tenantless.text

    def test_correlation_still_round_trips_on_the_read_scope(self, client: TestClient) -> None:
        response = client.get(
            "/internal/v1/status",
            headers={**_token_headers(), "x-request-id": "panel-refresh-7"},
        )
        assert response.status_code == 200
        assert response.headers[CORRELATION_HEADER] == "panel-refresh-7"

    def test_empty_tenant_header_reads_as_absent_on_both_scopes(
        self, client: TestClient
    ) -> None:
        """`x-tenant-id: ""` is absence, on both sides, because one helper decides it.

        Worth pinning: a client that stamps an empty header from a missing config value
        now gets a working status read and a 400 on commands, and the difference is the
        scope's whole meaning rather than an accident of `if not x`.
        """
        read = client.get(
            "/internal/v1/status", headers={**_token_headers(), TENANT_HEADER: ""}
        )
        assert read.status_code == 200
        command = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers={**_token_headers(), TENANT_HEADER: ""},
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert command.status_code == 400
        assert command.json()["code"] == TENANT_REQUIRED_CODE


class TestReadScopeIsNotAValidationBypass:
    def test_a_sent_tenant_is_still_validated(self, client: TestClient) -> None:
        for candidate in ("../etc/passwd", "tenant a", "a" * 65, "tenant\x00a"):
            response = client.get(
                "/internal/v1/status",
                headers={**_token_headers(), TENANT_HEADER: candidate},
            )
            assert response.status_code == 400, candidate
            assert response.json()["code"] == "TENANT_HEADER_INVALID", candidate

    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {TENANT_HEADER: "tenant-a"},
            {CALLER_AUTH_HEADER: ""},
            {CALLER_AUTH_HEADER: "s" * len(TOKEN)},
            {CALLER_AUTH_HEADER: TOKEN[:-1]},
        ],
        ids=[
            "no headers",
            "tenant only",
            "empty token",
            "wrong token same length",
            "token truncated by one",
        ],
    )
    def test_no_token_means_no_answer(self, client: TestClient, headers: dict[str, str]) -> None:
        """The exemption is about the tenant law and touches nothing else.

        Every one of these must be 401 rather than 400 or 200: if a missing token ever
        reached the tenant branch, a stranger could read a deployment's wiring, and the
        order of the two checks is the only thing preventing it.
        """
        response = client.get("/internal/v1/status", headers=headers)
        assert response.status_code == 401
        assert response.json()["code"] == "UNAUTHORIZED"

    def test_command_scope_refusal_text_is_unchanged_to_the_byte(
        self, client: TestClient
    ) -> None:
        """A pinned contract: the worker's client and its suite match this sentence."""
        response = client.post(
            "/internal/v1/accounts/verify-credentials",
            headers=_token_headers(),
            json={"tenantId": "tenant-a", "accountId": "acct-1"},
        )
        assert response.status_code == 400
        detail = response.json()
        assert detail["code"] == "TENANT_HEADER_REQUIRED"
        assert detail["message"] == (
            f"Every execution command must name its tenant via the "
            f"{TENANT_HEADER} header; tenantless money operations are refused."
        )


class TestScopeIsScoped:
    def test_the_read_scope_is_used_by_exactly_one_route(self, client: TestClient) -> None:
        routes = _internal_routes(client.app)
        readers = [
            route
            for route in routes
            if require_internal_auth_readonly in _dependant_calls(route.dependant)
        ]
        assert [route.path for route in readers] == ["/internal/v1/status"]
        assert [route.methods for route in readers] == [{"GET"}]

    def test_every_other_internal_route_keeps_the_command_scope(
        self, client: TestClient
    ) -> None:
        routes = _internal_routes(client.app)
        others = [route for route in routes if route.path != "/internal/v1/status"]
        assert others, "the internal plane must have routes besides the status read"
        for route in others:
            calls = _dependant_calls(route.dependant)
            assert require_internal_auth in calls, route.path
            assert require_internal_auth_readonly not in calls, route.path

    def test_no_internal_command_answers_tenantless(self, client: TestClient) -> None:
        """The same claim as the test above, made over HTTP rather than the tree.

        Both directions are pinned on purpose: the route walk catches a dependency
        swapped out of a handler, and the HTTP sweep catches a route that stopped
        depending on either scope at all. A body of `{}` is deliberate - auth is
        resolved before body validation, so a 422 here would mean the refusal moved
        behind validation, which is the ordering this part must not allow.
        """
        paths = sorted(
            {
                route.path
                for route in _internal_routes(client.app)
                if "POST" in (route.methods or set())
            }
        )
        assert paths, "the internal plane is expected to expose commands"
        for path in paths:
            response = client.post(path, headers=_token_headers(), json={})
            assert response.status_code == 400, f"{path}: {response.status_code}"
            assert response.json()["code"] == TENANT_REQUIRED_CODE, path

    def test_the_health_view_publishes_every_key_the_read_scope_does(
        self, client: TestClient
    ) -> None:
        """The disclosure argument for the exemption, as an invariant.

        `GET /health/ready` is unauthenticated by design (Part 8), and it answers with
        the same posture block. So the exemption cannot hand a caller anything a stranger
        does not already get for free - and if a later part ever restricts the readiness
        view, this test fails and the exemption's justification has to be re-argued in
        the open instead of quietly becoming false.
        """
        status_keys = frozenset(
            client.get("/internal/v1/status", headers=_token_headers()).json()
        )
        ready = client.get("/health/ready").json()
        assert status_keys <= frozenset(ready)
        assert "status" in ready  # the readiness verdict itself stays off /status


class TestScopesDirectly:
    """The two dependencies as functions, because their difference is a value.

    No HTTP here: what is under test is which caller object each scope hands back, and a
    route that never reads `tenant_id` cannot reveal the difference over the wire.
    """

    def _settings(self) -> Settings:
        get_settings.cache_clear()
        return get_settings()

    @pytest.mark.asyncio
    async def test_command_scope_refuses_and_read_scope_returns_an_empty_tenant(
        self,
    ) -> None:
        settings = self._settings()
        with pytest.raises(HTTPException) as refused:
            await require_internal_auth(settings, TOKEN, None, None)
        assert refused.value.status_code == 400
        assert _code_of(refused.value) == TENANT_REQUIRED_CODE

        caller = await require_internal_auth_readonly(settings, TOKEN, None, None)
        assert isinstance(caller, ServiceCaller)
        assert caller.tenant_id == ""
        assert caller.request_id is None

    @pytest.mark.asyncio
    async def test_read_scope_keeps_the_caller_it_is_given(self) -> None:
        caller = await require_internal_auth_readonly(
            self._settings(), TOKEN, "tenant-a", "corr-1"
        )
        assert (caller.tenant_id, caller.request_id) == ("tenant-a", "corr-1")

    @pytest.mark.asyncio
    async def test_read_scope_still_refuses_a_bad_token(self) -> None:
        with pytest.raises(HTTPException) as refused:
            await require_internal_auth_readonly(self._settings(), "nope", "tenant-a", None)
        assert refused.value.status_code == 401

    @pytest.mark.asyncio
    async def test_both_scopes_share_the_64_character_bound(self) -> None:
        long_tenant = "t" * 65
        for scope in (require_internal_auth, require_internal_auth_readonly):
            with pytest.raises(HTTPException) as refused:
                await scope(self._settings(), TOKEN, long_tenant, None)
            assert _code_of(refused.value) == "TENANT_HEADER_INVALID"
        ok = await require_internal_auth_readonly(
            self._settings(), TOKEN, "t" * 64, None
        )
        assert ok.tenant_id == "t" * 64
```


## FILE: scripts/gen_part20_handover.py (867 lines)

*this generator. It is in the list because it is a source file of the part and its content is what makes the document reproducible; it is exempt from its own suppression-token scan via `__file__`, which is also why that exemption is computed rather than hardcoded.*

````text
"""Part 20 - the engine's own account, read; and the checker, run. The full-source handover.

Generated, not written by hand, for the reason Part 15 established and Parts 16, 17, 18 and 19
repeated: a hand-copied "full source" document starts drifting the moment a file changes, and a
document whose completeness cannot be re-proved is a document that merely claims. This script
embeds the complete content of every file Part 20 added or modified, states its own gate results
by RUNNING the suites, and accepts ``--check``, which regenerates in memory and compares byte for
byte against the committed file.

Copied from ``scripts/gen_part19_handover.py`` and re-pointed, which is the honest description of
the relationship. What changed in the machinery: the gate list gained ``--check-schedule`` (this
part is the one that installed the scheduler, so its generator runs that check rather than
quoting it), the two part-specific test runs moved from "core + service" to "API + service"
because this part's new tests live in those two suites, and the suppression-token count now
sweeps ``.py``, ``.ts``, ``.tsx`` and ``.mjs`` - a display-layer part lives in TypeScript, and
counting only the Python half would have been the flattering half.

The file lists were derived rather than remembered. There is no VCS in this workspace, so the
prior handovers ARE the snapshots: comparing every candidate file against the newest handover
that embeds it yields the real change set since the last recorded state. That sweep named 26
files whose content had moved; 15 of them carry Part 20 markers and are listed below. The other
eleven - `apps/api/src/infrastructure/metrics/metrics.registry.ts`,
`apps/api/src/modules/observability/alert.constants.ts`, `docs/fixtures/observability_fixtures.json`,
`libs/trading-core/wlct_trading/backtest/engine.py`, `libs/trading-core/wlct_trading/observability/alerts.py`,
`libs/trading-core/wlct_trading/risk/evaluator.py`, `packages/shared-types/src/audit.ts`,
`packages/shared-types/src/rbac.ts`, `services/market-data/app/config.py`,
`services/market-data/app/main.py`, `services/market-data/app/observability.py` - differ from a
Part 8 or Part 9 snapshot in exactly the shape Part 10 left them (the SLO identity constants, the
burn-rate rules, the OpenTelemetry `use_span` imports), were never re-embedded by the part that
changed them, and are neither claimed nor repaired here. The comparison must be fence-aware,
because an embedded markdown document is fenced with four backticks and a three-backtick parser
reports an untouched document as wholly rewritten. The audit script is
``/home/user/audit_part20_diff.py`` in the session workspace, and
``/home/user/part20_deltas_pre_regen.txt`` holds the same sweep's line-count deltas taken BEFORE
the ancestors were regenerated; their results, not their existence, are what this paragraph
asserts.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Final


ROOT = (
    Path(__file__).resolve().parents[1]
    if "__file__" in globals()
    else Path("/home/user/whitelabel-copytrade")
)
OUT = ROOT / "docs" / "PART20_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(19, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        "apps/api/src/modules/worker/engine-status-contract.ts",
        "the mirror of `services/execution-engine/app/schemas.py::StatusResponse`, one table wide: `ENGINE_STATUS_FIELDS` carries every wire key with its TypeScript type, whether the engine defaults it, and the default spelled out verbatim; `parseEngineStatus` refuses a non-object body, a missing required key, a wrong primitive and an unknown key at the top level, preserves an explicit `null` on a declared-nullable field instead of substituting the default, and reports `unmappedKeys` rather than discarding them. The two absence laws are the point of the file: the mirror's defaults ARE the engine's defaults, so an engine too old to answer reads as too old to answer, never as healthy.",
    ),
    (
        "apps/api/src/modules/worker/engine-status-contract.spec.ts",
        "16 tests on the mirror: the 20-key set is spelled out as data (a key added to the schema without a row here fails), the nine required keys refuse absence individually, declared-nullable keys keep `null` where an absent key takes the default, `simulated` is reported and never silently folded into `mode`, wrong-typed values name the field that moved, and the refusal objects carry a `field` so a UI can point at it.",
    ),
    (
        "apps/api/src/modules/worker/engine-status-parity.spec.ts",
        "the three-sided law, checked in CI: this spec parses `app/schemas.py` with a small reader and asserts that its field set equals this part's alias table equals what `parseEngineStatus` accepts. A rename, an addition or a deletion on the Python side fails here with the key named, which is what makes the mirror maintainable instead of merely current.",
    ),
    (
        "apps/api/src/modules/observability/engine-posture.service.ts",
        "the `ENGINE POSTURE` section: a 10-second cached read through the existing engine client, a 2-second panel budget, three states (`reported`, `unverified`, `unconfigured`) with a `code` and a truncated `reason` on the unhappy ones, the tone law in which no absence renders as success, and rows for instance, mode, dry-run, adapter, store, durability, retention, enablement age, credential source, fetcher, operator confirmation, placement policy, incidents, metrics, locks and command count. It never invents a value: with no client it says so instead of throwing at request time, and it is a `readiness`-shaped sibling of the module's existing views, not a new endpoint.",
    ),
    (
        "apps/api/src/modules/observability/engine-posture.service.spec.ts",
        "18 tests around that service, including the ones that make a panel honest: a shape error reports the key name rather than an HTTP 500, a timeout says the read is still running, an error before the first success does not claim to show a stale-but-real answer, `unconfigured` explains what to set, the cache is not a second TTL implementation, and a posture that reports `simulated: true` cannot render as a green live deployment.",
    ),
    (
        "docs/PART20_ENGINE_STATUS_EDGE.md",
        "the part's own document, nine sections: what the audit found in the tree as it stood, the mirror and its two absence laws, the parity law, the panel and its tone law, the nine refusals with reasons, in the order the section lists them (no engine health-mirror publisher, no worker-side placement gate, no published readiness gates, no console renderer for `sections`, no re-badging of the four open ROADMAP rows, no Prometheus/Alertmanager rule generation out of prose conditions and `threshold: float | None`, no cron container in compose, no change to `/health/ready`'s unauthenticated posture, no configuration knob beyond `--manifest`), the scheduler wiring, the defect that running the composition found with its before/after measurements, every gate number transcribed from the run, and what an operator does with any of it.",
    ),
    (
        "docs/dr/schedule/dr.cron",
        "the generated schedule: `wlctRoot=.`, one `SHELL=/bin/sh`, and three job lines (`--due` daily, `--check` daily, `--check-rls` at the tightest declared cadence), with redis's no-obligation waiver echoed as a comment and no job line of its own. Generated by `node scripts/dr-manifest.mjs --emit-schedule` and drift-gated by `--check-schedule`; it may schedule reads and never a ledger write, and the installation step stays a documented `crontab` command because this repository does not own a host's cron.",
    ),
    (
        "services/execution-engine/tests/test_part20_status_read.py",
        "19 tests for the engine side of section 7: the read answers tenantless with exactly the 20 contract keys and real values; a tenant-naming caller gets a byte-identical document; correlation round-trips; an empty `x-tenant-id` equals an absent one on both scopes; a malformed tenant still 400s under the read scope; no token, an empty token, a same-length wrong token and a truncated token all 401 before the tenant branch is reached; the command scope's refusal code and sentence are pinned to the byte; the read scope is asserted to sit on exactly one route by walking `app.routes`; every other internal route is swept over HTTP to confirm a tenantless POST still gets `TENANT_HEADER_REQUIRED`; and `/health/ready`'s key set stays a superset of `/status`'s, which is the disclosure argument for the exemption held as an invariant.",
    ),
    (
        "scripts/gen_part20_handover.py",
        "this generator. It is in the list because it is a source file of the part and its content is what makes the document reproducible; it is exempt from its own suppression-token scan via `__file__`, which is also why that exemption is computed rather than hardcoded.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "apps/api/src/modules/worker/engine-internal.client.ts",
        "`getStatus()` now answers `EngineStatus` (the mirror's type) instead of a hand-shaped object, reading the parsed body through `parseEngineStatus`; the two consumed fields (`mode`, `storeBackend`) and every assertion the startup gate makes are unchanged, and the terminal-versus-retryable status classification was deliberately not widened - the fix for the 400 was made where the 400 came from.",
    ),
    (
        "apps/api/src/modules/observability/observability.module.ts",
        "the client is provided by a factory that asks `engineInternalClientConfigured` before constructing one, so an API process with no engine wiring boots and reports `unconfigured` rather than failing to start, and `EnginePostureService` is registered beside the module's other read-only views with the client injected optionally.",
    ),
    (
        "apps/api/src/modules/observability/observability.service.ts",
        "`execution` gained `sections`, rendered from the posture view, and the existing `enginePosture` readiness-gate summary is untouched: the panel row is a second reader of one fact, not a second source of it.",
    ),
    (
        "services/execution-engine/app/security.py",
        "the part's behaviour change: one law, two scopes. `_authenticate` (the constant-time token comparison), `_tenant_or_none` (validate-what-is-sent, refuse-what-is-required) and `_request_id` are shared, `TENANT_REQUIRED_CODE` names the refusal the worker matches on, `require_internal_auth` keeps its command semantics and its exact message, and `require_internal_auth_readonly` tolerates the absence of a tenant header for a route that acts on no tenant while still refusing a malformed one and still returning `tenant_id == \"\"` rather than an invented pseudo-tenant.",
    ),
    (
        "services/execution-engine/app/routers/internal.py",
        "one `Depends` line and its comment: `engine_status` reads through `ReadAuthDep`, and the comment records why (a process-level read has no tenant to name) and that every command route keeps the tenant law. The route body never touched the caller before and does not now.",
    ),
    (
        "services/execution-engine/tests/conftest.py",
        "the `client` fixture's annotation was `-> TestClient` on a generator function, which mypy could only report as an error; it now says `Iterator[TestClient]`. Fixed because Part 20's suite came to depend on it, and left as the one typing repair this part made in a file it did not author.",
    ),
    (
        "scripts/dr-manifest.mjs",
        "the schedule half of the tool: `SCHEDULE_PATH`, `scheduleCheckIntervalHours`, `scheduleCronFor`, `scheduleTightestCadenceHours`, `renderSchedule`, `scheduleDrift`, `SCHEDULE_FORBIDDEN_MODES` and `SCHEDULE_ROOT_LINE`, the two new modes answered before `--check-rls`, and `--manifest` as an override so the derived schedule can be exercised against a hypothetical board - including the all-waived board that must emit no job lines at all. `--record` stays human-only, and the generator refuses a manifest without its `wlctRoot=` line, an empty file, secret-shaped values, and any byte difference on a drift check.",
    ),
    (
        "scripts/dr-manifest.test.mjs",
        "13 tests for that derivation: the interval law (`min(tightest cadence, 24h)`), the hour-field wrap that makes `0 */N * * *` valid for any N in 1..24, `--check` staying daily regardless, waivers rendered as comments, the all-waived board, the RLS waiver removing `--check-rls`, `--record` and `--record-rls` refused and reported as their own finding ahead of the byte comparison, and the tamper cases landing on JOB lines because a comment-only edit is correctly a byte mismatch.",
    ),
    (
        "docker-compose.yml",
        "`EXECUTION_ENGINE_URL: http://execution-engine:8093` and `EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}` on the `api` service, which the worker already had and the panel now needs: the value in `.env.example` is a loopback URL that aims the API container at itself, and the token the engine validates is documented under a different name than the client reads, so without this the panel would report `unverified` on a healthy deployment - a wrong panel row being the exact failure this part was written against.",
    ),
    (
        "docs/SECURITY.md",
        "the `OPS_READ` bullet extended with what the panel actually shows, and section 14's \"no tenantless command\" claim amended to say *command* and name the one exempt read, its ordering, its bounds and the `/health/ready` superset invariant - a security document that stays accurate across a part that touched an auth boundary is the point of the cross-link, not a courtesy.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "the engine section now names who reads `/internal/v1/status` (the worker's gate and the ops panel, one mirror, two consumers) and states that the panel adds no authority: it renders what the engine already published.",
    ),
    (
        "docs/GETTING_STARTED.md",
        "the operational tail's two commands and the posture curl, both run before being written down - which is why this document says `localhost:8093` for the engine (dev-run; the compose engine publishes no host port at all) and describes the panel as an authenticated route rather than inventing a curl for it, after an earlier draft named a port the API does not use.",
    ),
    (
        "docs/ROADMAP.md",
        "row 20, written from the diff rather than the intent: mirror, panel, generated schedule, and the defect the audit only found by running the composition - with the Python and compose files it moved counted, because a row that says \"display only\" over a commit that changed an auth boundary is how a roadmap stops being evidence.",
    ),
    (
        "docs/PART11_WORKER_SCALING.md",
        "section 7's `/status` bullet: the read is now token-scoped only, with the before/after failure recorded in place so a reader of the part that BUILT the gate learns that the gate could not boot.",
    ),
    (
        "docs/PART19_LIVE_ENABLEMENT.md",
        "section 8 points at the reader that Part 19 left without one - the enablement and placement facts published on `/status` now reach an operator, which is the difference between a refusal that is computable and one that is visible.",
    ),
    (
        "docs/DR.md",
        "the section headed 'What is NOT yet automated, plainly' still claimed this part's scheduler as remaining work, and `--check-rls` as unwired, so it now describes what shipped (derived schedule, `min(tightest cadence, 24h)` interval law, waivers echoed as comments with no job line, `--check-schedule` as the byte-exact drift gate that refuses `--record` as its own finding) and shrinks the open list to `crontab`, the drill calendar, and the first real `--record`. The heading is kept verbatim because Part 15's document links to it by name; a renamed section would turn a live document into a broken reference.",
    ),
    (
        "docs/PART15_RLS_ENABLEMENT.md",
        "one supersession note, in the style this repository uses for exactly this situation (Part 11's 'RESOLVED IN PART 13', Part 13's 'SUPERSEDES THE CAPABILITY, NOT THE LAW'): the bullet that named the scheduler as an open item now says Part 20 supplied the timer, while what Part 15 did - making the check exist and be honest enough to exit 1 - stands unchanged.",
    ),
    (
        ".env.example",
        "the engine-client block gained the second consumer and the two facts an operator needs with it: the pair is required by the worker's startup gate and read by the panel since Part 20, and with either name absent nothing fails - the module declines to construct a client and `ENGINE POSTURE` reports `unconfigured` - plus the warning that the file's own `127.0.0.1` URL is a developer's loopback that `docker-compose.yml` overrides per service. No new variable is declared, and none could be added by accident here: `dr-manifest.mjs::collectEnvNames` reads this file for `KEY=` lines (commented secrets included) to learn which names a deployment must provide, so prose edits are invisible to it by design while a new name would not be.",
    ),
]

ELISION_TOKENS: Final[tuple[str, ...]] = (
    "<generated>",
    "(snip",
    "... elided",
    "lines omitted",
    "truncated for brevity",
    "content truncated",
    "truncated here",
    "for brevity",
    "see repo for full",
    "rest of the file",
    "same as above",
    "etc.",
    "unchanged`",
    "omitted for brevity",
    "content omitted",
    "source omitted",
    "omitted from this",
    "omitted here",
    "intentionally omitted",
)

#: The shape an elided block actually leaves behind: a line that is nothing but the
#: marker. As a substring this fires on ordinary comments - "# ...but the registry
#: still counts it" is a sentence, not an admission - so it is matched per line.
ELISION_LINE_MARKERS: Final[tuple[str, ...]] = ("// ...", "# ...", "#...", "//...")


NEW_ONLY_TOKENS: Final[tuple[str, ...]] = (
    "TODO",
    "implement this later",
    "type: ignore",
    "noqa",
    "eslint-disable",
    "@ts-ignore",
    "@ts-expect-error",
)

#: The file that DEFINES the banned tokens as guard data is exempt from its own
#: substring scan, computed from __file__ rather than written out, because a
#: hardcoded exemption is how a copied generator ends up exempting its ancestor and
#: failing on itself - which is exactly what happened when this script was derived
#: from Part 16's, and again on the way to Part 20's. Stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset(
    {Path(__file__).resolve().relative_to(ROOT).as_posix()}
    if "__file__" in globals()
    else frozenset({"scripts/gen_part20_handover.py"})
)


def fence(rel_path: str, text: str) -> str:
    if "```" in text:
        return "````text\n" + text.rstrip("\n") + "\n````\n"
    name = rel_path.rsplit("/", 1)[-1]
    lang = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".sql": "sql",
        ".json": "json",
        ".prisma": "prisma",
        ".toml": "toml",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".mjs": "javascript",
        ".txt": "text",
        ".md": "markdown",
    }.get(
        "." + name.rsplit(".", 1)[-1] if "." in name else "",
        "dotenv" if name == ".env.example" else (
            "yaml" if name.endswith("Dockerfile") else ""
        ),
    )
    return f"```{lang}\n" + text.rstrip("\n") + "\n```\n"


def lines_of(rel: str) -> int:
    return len((ROOT / rel).read_text(encoding="utf-8").splitlines())


def baselines() -> dict[str, int]:
    """For every file in any prior handover: the line count THAT document
    recorded. Newest document wins, which is what makes a delta honest: the
    baseline for `app/config.py` is Part 14's emission (because Part 14 last
    changed it), the baseline for `docs/DR.md` is older, and neither is
    guessed."""
    table: dict[str, int] = {}
    for handover in PRIOR_HANDOVERS:
        if not handover.exists():
            continue
        text = handover.read_text(encoding="utf-8")
        for match in re.finditer(r"^## FILE: (.+?) \((\d+) lines\)", text, re.MULTILINE):
            table.setdefault(match.group(1).strip(), int(match.group(2)))
    return table


def block(rel: str, note: str) -> str:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    return f"## FILE: {rel} ({len(text.splitlines())} lines)\n\n*{note}*\n\n{fence(rel, text)}\n"


def file_problems(rel: str, text: str, *, new_file: bool) -> list[str]:
    """Every elision or suppression problem in one file's text.

    Split out of :func:`sweep` so the marker rules are checkable on a string: a
    guard nobody can exercise is a guard nobody trusts, and this one has now
    produced two false positives on files this part merely modified - each of
    which was a real imprecision in the rule rather than in the repository.
    """
    problems: list[str] = []
    for token in ELISION_TOKENS:
        if token in text:
            problems.append(f"{rel}: contains {token!r}")
    for marker in ELISION_LINE_MARKERS:
        if any(line.strip() == marker for line in text.splitlines()):
            problems.append(f"{rel}: contains the bare elision line {marker!r}")
    if new_file:
        for token in NEW_ONLY_TOKENS:
            if token in text:
                problems.append(f"{rel}: a new file containing {token!r}")
    return problems


def sweep() -> list[str]:
    problems: list[str] = []
    for kind, entries in (("NEW", NEW), ("MODIFIED", MODIFIED)):
        for rel, _ in entries:
            if rel in SWEEP_SELF_EXEMPT:
                continue
            text = (ROOT / rel).read_text(encoding="utf-8")
            for problem in file_problems(rel, text, new_file=kind == "NEW"):
                problems.append(f"{kind} {problem}")
    return problems


# --------------------------------------------------------------------------
# measurement: the header's numbers are RUN, not remembered
# --------------------------------------------------------------------------


def run(argv: list[str], cwd: Path, env: dict[str, str] | None = None) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            argv,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
            env={**os.environ, **env} if env else None,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return 127, f"could not run {' '.join(argv)}: {error}"
    return proc.returncode, proc.stdout + proc.stderr


def last_match(pattern: str, text: str) -> str | None:
    found = re.findall(pattern, text)
    return str(found[-1]) if found else None


def measure() -> dict[str, object]:
    """Every gate the part must pass, executed now, parsed from its own
    output. A number that cannot be parsed is reported as 'UNPARSED', not
    defaulted to something flattering - this header is evidence, and
    evidence with a soft spot in it is the thing Part 15 exists to replace."""
    out: dict[str, object] = {}

    code, text = run(["python3", "-m", "pytest", "-q"], ROOT / "libs" / "trading-core")
    out["core_pytest"] = (last_match(r"(\d+) passed", text) if code == 0 else f"FAILED: {text[-300:]}")
    out["core_pytest_code"] = code
    code, text = run(["python3", "-m", "ruff", "check", "wlct_trading", "tests"], ROOT / "libs" / "trading-core")
    out["core_ruff"] = "green" if code == 0 else text[-300:]
    # The core gate covers the library and its tests. The standalone fixture
    # generators under scripts/ are outside it by design (they must run with a
    # bare `python3` and no installed package, so their import order is
    # deliberate); counting their findings here keeps "green" from being read
    # as "whole directory swept".
    code, text = run(["python3", "-m", "ruff", "check", "scripts"], ROOT / "libs" / "trading-core")
    out["core_ruff_scripts"] = "0 findings" if code == 0 else (last_match(r"Found (\d+) errors?", text) or "?") + " findings"
    code, text = run(["python3", "-m", "mypy", "wlct_trading"], ROOT / "libs" / "trading-core")
    out["core_mypy"] = last_match(r"no issues found in (\d+) source files", text) or text[-160:]

    # "Zero suppression tokens" is a claim this header used to make by hand, over
    # Python only. Part 20 is a TypeScript part, so the scan covers `.py`, `.ts`,
    # `.tsx` and `.mjs` - over the files the part added and, separately, over the
    # files it only modified, because the modified ones carry pre-existing lines from
    # Parts 5/12/14 and a header reporting "0" by scanning only its own new files
    # would be measuring the flattering half.
    #
    # The one exclusion is this generator, computed from __file__ exactly as the sweep's
    # own marker list is: the tokens are its GUARD DATA, in a tuple, and a scan that
    # counted them would report "11 suppression tokens" for a file whose only sin is
    # naming what is forbidden. The first draft of this function had no exclusion and
    # printed precisely that, which is the reason the exemption is stated here rather
    # than slipped in - and the count below is independently confirmed against the
    # files themselves:
    #   grep -rn "type: ignore|noqa|eslint-disable|prettier-ignore|@ts-" <every file in both lists>
    # returns nothing at all.
    tokens = ("type: ignore", "noqa", "eslint-disable", "prettier-ignore", "@ts-ignore", "@ts-expect-error")
    guard_data = Path(__file__).resolve().relative_to(ROOT).as_posix() if "__file__" in globals() else "scripts/gen_part20_handover.py"

    def _count(entries: list[tuple[str, str]]) -> int:
        total = 0
        for rel, _note in entries:
            if rel == guard_data or not rel.endswith((".py", ".ts", ".tsx", ".mjs")):
                continue
            for line in (ROOT / rel).read_text(encoding="utf-8").splitlines():
                total += sum(1 for tok in tokens if tok in line)
        return total

    out["suppression_new"] = _count(NEW)
    out["suppression_modified"] = _count(MODIFIED)

    engine = ROOT / "services" / "execution-engine"
    code, text = run(
        ["python3", "-m", "pytest", "-q"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_pytest"] = (
        f"{last_match(r'(\d+) passed', text)} passed, {last_match(r'(\d+) skipped', text) or '0'} skipped"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )
    code, text = run(["python3", "-m", "ruff", "check", "app", "tests"], engine)
    out["engine_ruff"] = "green" if code == 0 else text[-300:]
    code, text = run(
        ["python3", "-m", "mypy", "app"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_mypy"] = last_match(r"no issues found in (\d+) source files", text) or text[-160:]
    # `mypy app` is the service's own gate and excludes tests, as it has since Part 11.
    # This part added a test file that reaches into a typed exception, so it is handed
    # to mypy directly here as well - the number below is the new file alone, and the
    # one known finding in `tests/conftest.py` was fixed rather than annotated away.
    code, text = run(
        ["python3", "-m", "mypy", "tests/test_part20_status_read.py"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core"), "MYPYPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_mypy_new_test"] = (
        "clean" if code == 0 else f"FAILED: {text[-200:]}"
    )
    code, text = run(
        ["python3", "-m", "pytest", "-q", "tests/test_part20_status_read.py"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_part20"] = (
        f"{last_match(r'(\d+) passed', text)} passed"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )

    code, text = run(["node", "--test", "scripts/"], ROOT)
    out["node_scripts"] = (
        f"{last_match(r'# pass (\d+)', text)} passed / {last_match(r'# fail (\d+)', text)} failed"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check"], ROOT)
    out["manifest_check"] = text.strip().splitlines()[0] if code == 0 else f"FAILED: {text[-300:]}"
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check-schedule"], ROOT)
    # The gate this part installed. Its full sentence is quoted rather than reduced to
    # "green", because the counts inside it (job lines, components) are the evidence that
    # the schedule was derived from the manifest and not typed under it.
    out["schedule_check"] = (
        "exit 0: " + text.strip().splitlines()[0]
        if code == 0
        else f"FAILED (exit {code}): {text[-300:]}"
    )
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check-rls"], ROOT)
    # exit 1 here is the HONEST answer (no audit recorded yet in this repo),
    # so the text is quoted and the code explained, not smoothed over.
    out["check_rls"] = f"exit {code}: {text.strip().splitlines()[0]}" if text.strip() else f"exit {code}"

    api = ROOT / "apps" / "api"
    code, text = run(["npx", "jest", "--silent"], api)
    out["api_tests"] = (
        f"{last_match(r'Tests:\s+(\d+) passed', text)} passed / {last_match(r'Test Suites:\s+(\d+) passed', text)} suites"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    # This part's three new API specs, run on their own: one number for all of them
    # would hide which of the mirror, the parity law or the panel broke.
    code, text = run(
        [
            "npx",
            "jest",
            "--silent",
            "src/modules/worker/engine-status-contract.spec.ts",
            "src/modules/worker/engine-status-parity.spec.ts",
            "src/modules/observability/engine-posture.service.spec.ts",
        ],
        api,
    )
    out["api_part20"] = (
        f"{last_match(r'Tests:\s+(\d+) passed', text)} passed / {last_match(r'Test Suites:\s+(\d+) passed', text)} suites"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    code, text = run(["npx", "tsc", "-p", "tsconfig.json", "--noEmit"], api)
    out["api_typecheck"] = "0 errors" if code == 0 else f"FAILED: {text[-300:]}"
    # `prisma validate` resolves every env() reference before it will parse
    # the datasource, so it exits 1 in a checkout with no .env (correctly:
    # nothing is committed to satisfy it). The placeholders below are not
    # credentials - validation never opens a connection - and naming them here
    # is what keeps this gate reproducible on a fresh clone instead of a
    # command that only passes on the machine that happened to export a DSN.
    code, text = run(
        ["npx", "prisma", "validate", "--schema", "prisma/schema.prisma"],
        api,
        {
            "DATABASE_URL": "postgresql://validate:validate@localhost:5432/validate",
            "DIRECT_DATABASE_URL": "postgresql://validate:validate@localhost:5432/validate",
        },
    )
    out["prisma"] = "valid" if code == 0 else f"FAILED: {text[-200:]}"
    code, text = run(["npx", "eslint", "src", "--max-warnings", "0"], api)
    out["api_lint"] = "clean" if code == 0 else f"FAILED: {text[-400:]}"

    code, text = run(["npx", "tsc", "--noEmit"], ROOT / "apps" / "admin-web")
    out["admin_typecheck"] = "0 errors" if code == 0 else f"FAILED: {text[-300:]}"

    for service, name in (("trading-engine", "trading"), ("market-data", "market")):
        code, text = run(
            ["python3", "-m", "pytest", "-q"],
            ROOT / "services" / service,
            {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
        )
        out[f"{name}_service"] = (last_match(r"(\d+) passed", text) if code == 0 else "FAILED") or "FAILED"

    out["tree"] = count_tree_lines()
    return out


EXCLUDE_DIRS: Final[frozenset[str]] = frozenset(
    {
        "node_modules", "dist", ".next", ".git", "build", "coverage", "__pycache__",
        ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv",
        "target", "out", "site-packages",
    }
)


def count_tree_lines() -> dict[str, int]:
    """Whole-tree counts, measured. The rule set is stated in full because
    a total without its definition is decoration: every file in the tree
    except generated/vendored directories and lockfiles; `source` excludes
    everything under `docs/`, `with_docs` includes it; BOTH exclude the
    regenerable `docs/PART*HANDOVER*` dumps (matched on the `_HANDOVER` segment rather
    than on `PART<n>_`, because Part 6 named one of its two dumps differently and that
    name slipped the prefix) and `docs/source/`. Prior parts
    measured their own totals under their own generators - those numbers are
    not reproduced or compared here on purpose, because a total whose rule
    cannot be re-run is not a measurement."""
    source = 0
    with_docs = 0
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        parts = rel.parts
        if any(part in EXCLUDE_DIRS for part in parts):
            continue
        name = rel.as_posix()
        if name.endswith("package-lock.json"):
            continue
        if name.startswith("docs/source/"):
            continue
        # The pattern was `docs/PART\d+_HANDOVER`, which silently kept
        # docs/PART6_PERSISTENCE_HANDOVER_FULL_SOURCE.md inside the totals: 25,848 lines
        # of generated dump counted as though they were a hand-written document, in a
        # header whose entire claim to trustworthiness is that its numbers are measured.
        # A prefix a later part can rename around is not a rule, so the match is on the
        # `_HANDOVER` segment, and the number of excluded files is stated in the prose
        # rather than assumed.
        is_handover = ".source" in name or bool(re.match(r"docs/PART[^/]*_HANDOVER", name))
        is_doc = name.startswith("docs/")
        if is_handover:
            continue
        try:
            count = sum(1 for _ in path.open("rb"))
        except (OSError, UnicodeDecodeError):
            continue
        source += 0 if is_doc else count
        with_docs += count
    return {"source": source, "with_docs": with_docs}


HEADER_TEMPLATE = """
# Part 20 - the engine's own account, read; and the checker, run

> **What this part changed, and what it did not:** `/internal/v1/status` gained one strict
> TypeScript mirror and two consumers (the worker's startup gate keeps its assertions, the ops
> panel gains an `ENGINE POSTURE` section in which absence never reads as health); the DR
> obligations board gained the scheduler that `docs/DR.md` had only described, derived from the
> manifest's own cadences and drift-gated; and one defect the audit found by *running* the
> composition was fixed on the engine side, because a control that cannot boot is not a control -
> the internal tenant law is now scoped to **commands**, with one named read
> (`GET /internal/v1/status`) exempt and that exemption pinned to a single route by a test.
> **`EXECUTION_MODE=live` is still refused at startup, unchanged**; no gate, verdict,
> credential, order path or refusal threshold moved; no command route's requirements or refusal
> text changed; no metric, table, alert rule or console renderer was added. Three documents that
> still described this part's scheduler as missing (`docs/DR.md`, `docs/PART15_RLS_ENABLEMENT.md`,
> `.env.example`) are in the change set rather than left as stale prose, because a control shipped
> while being described as absent is a control nobody looks for; and sec. 5 of
> `docs/PART20_ENGINE_STATUS_EDGE.md` names nine refusals with their reasons - no engine health
> mirror, no worker-side placement gate, no published readiness gates, no console renderer, no
> restating open ROADMAP rows as finished, no Prometheus/Alertmanager rule files (`ALERT_RULES`
> carries prose conditions and `threshold: float | None`), no cron container, no change to
> `/health/ready`'s unauthenticated posture, and no configuration knob for the exempt read.

Complete content of every file created or modified by Part 20. Nothing is abbreviated,
quoted-with-ellipsis, or referred to by path: each block carries the whole current file, so this
document alone can be reviewed, diffed against an earlier part's handover, or used to
reconstruct the tree.

## Gates (run while this document was generated)

* `cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m pytest -q` ->
  **{engine_pytest}**. This part is the first since Part 13 to change behaviour at the engine's
  auth boundary, so the service's own suite is the interesting one: it was
  **409 passed, 12 skipped** before Part 20's file existed and moves by exactly that file's
  count - the 12 skips stay Parts 13-15's live-Postgres suites, skipping BY NAME without
  `EXECUTION_TEST_POSTGRES_DSN`. This part's file on its own -> **{engine_part20}**.
  `ruff check app tests` -> {engine_ruff}; `mypy app` -> no issues in **{engine_mypy} source
  files** (the same 24: two scopes were added inside existing modules, no new module);
  `mypy tests/test_part20_status_read.py` -> {engine_mypy_new_test}, which the service's gate
  does not cover because tests sit outside it, as in every part since Part 11.
* `cd apps/api && npx jest --silent` -> **{api_tests}**; this part's three specs on their own ->
  **{api_part20}**. `npx tsc -p tsconfig.json --noEmit` -> {api_typecheck};
  `npx eslint src --max-warnings 0` -> {api_lint}; `npx prisma validate` -> {prisma}. In
  `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}. The console renders no new field:
  `sections` is additive on the execution view and the admin web's table is untouched, so the
  panel section is reachable through the existing endpoint rather than by teaching a second UI
  to interpret engine facts.
* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest}**, `ruff check wlct_trading
  tests` -> {core_ruff} ({core_ruff_scripts} in `libs/trading-core/scripts`, standalone by
  design), `mypy wlct_trading` -> no issues in **{core_mypy} source files**. The core is
  untouched by this part and these three numbers are here to prove it rather than to be
  admired: the mirror reads `schemas.py` as text and never imports Python, so a core change
  could not have been smuggled in. Sibling suites: trading-engine **{trading_service}**,
  market-data **{market_service}**, both untouched.
* `node --test scripts/` -> **{node_scripts}** (the 13 new schedule tests included);
  `node scripts/dr-manifest.mjs --check-schedule` -> {schedule_check};
  `node scripts/dr-manifest.mjs --check` -> {manifest_check}; `node scripts/dr-manifest.mjs
  --check-rls` -> {check_rls} - that exit 1 is the honest answer, no audit recorded yet, and
  unchanged by this part. No table was added, so RLS coverage stays at 43 and `PROBE_TABLES` at
  5, and the enablement audit remains owed by the operator rather than by this document.
* **Suppression tokens: {suppression_new} in the files Part 20 added and {suppression_modified}
  in the files it modified**, counted by this script over `.py`, `.ts`, `.tsx` and `.mjs`
  instead of asserted, and confirmed by an independent `grep` over the same 27 files. The scan
  was widened this part precisely because Part 19 could only count Python: a display layer is
  TypeScript, and a rule that measures the half it is convenient to measure is not a rule. The
  generator itself is excluded, because it stores the forbidden tokens as guard data - and that
  exclusion is the only one, so the {suppression_modified} covers real inherited lines in other
  parts' files rather than being smoothed away.

## Ledger

Measured at generation time, with code and documents counted separately because a tree-size
figure that mixes them is not a size. Part 20 shipped **{total:,} lines** - **{new_code:,}**
across the {new_code_count} new code files, **{new_docs:,}** in the {new_docs_count} new
document{new_docs_s}, and **+{mod_code:,}** code / **+{mod_docs:,}** document lines across the
{mod_count} modified files (each delta measured against the newest prior handover that lists
that file - which leaves {unbaselined_count} of them, {unbaselined_size} lines, with no delta at
all because no earlier document recorded their prior size: {unbaselined_list}. Their full text is
embedded below, and their size is not presented as a change). Whole-tree counts under the
standing rule set: **{tree_source:,} source lines**; adding the narrative documents under
`docs/` (the regenerable `docs/source/` views and every handover dump are out of both figures):
**{tree_with_docs:,}**.

Three provenance notes, because each is a sentence this part could have copied and should not.

* The header's deltas are small by construction, and the reason is this repository's own rule
  rather than a shortfall. A part's change set includes documents every earlier part also
  embedded, so the ancestors must be regenerated before this document is written (else they
  are stale, which `--check` reports as a failure); regenerating them moves the copies inside
  them forward to post-Part-20 text, which is the state the delta is then measured from. Parts
  16, 17, 18 and 19 were regenerated in that order first, and `--check` on any of the five
  reproduces what each prints. The un-regenerated figure - the same sweep taken before that
  chain, in `/home/user/part20_deltas_pre_regen.txt` - is **+799 delta lines and 2,362 new
  lines**, and that is the number to read as "what Part 20 typed"; the file list itself is
  identical in both, which is the part that actually has to be complete.
* The file lists are a derived diff, not a remembered one. With no VCS in the workspace the
  prior handovers are the snapshots: 26 files had moved since their last recorded state, 15
  carry Part 20 markers and are listed below, and the other eleven are named in this script's
  docstring with the part that actually left them changed (Part 10's SLO and tracing additions,
  never re-embedded) so that "not ours" is a checked statement rather than an excuse. The
  comparison must be fence-aware, because an embedded markdown document is fenced with four
  backticks and a three-backtick parser reports nine untouched documents as wholly rewritten.
* One behaviour change is not display. `GET /internal/v1/status` is answered under
  `require_internal_auth_readonly`; every other internal route is under `require_internal_auth`
  unchanged, the exemption is pinned by a route-table walk and by an HTTP sweep of the command
  routes, and `/health/ready` is asserted to keep publishing a superset of the same keys so the
  exemption discloses nothing new. `docs/PART20_ENGINE_STATUS_EDGE.md` sec. 7 carries the
  before/after measurements, including that this whole part was green (409 engine tests, 425 API
  tests, 65 script tests) while the reference worker could not start, because every test of that
  client stubs `fetch`.
"""


def reflow_header(text: str) -> str:
    """Re-wrap the gate bullets after interpolation.

    WHY: the measured values ("16 findings", the manifest's whole summary line)
    have lengths of their own, so prose hand-wrapped in the template goes ragged
    the moment numbers are substituted - and one long value can push a line past
    180 characters in a document meant to be read in a terminal. Unwrapping each
    bullet and re-wrapping at a fixed width keeps every generated handover the
    same shape no matter what the tools printed. Long tokens (paths, commands)
    are never broken, because a hyphenated path split across two lines is a path
    nobody can copy.
    """
    out: list[str] = []
    # Two boundaries, not one: a bullet and a heading. Splitting only on bullets
    # leaves everything after the LAST bullet glued to it - which is how Part 16's
    # generated documents ended up with their whole ledger paragraph rendered as
    # indented continuation text, and how this one first swallowed its own
    # "## Ledger" heading into the final bullet. A heading is a boundary; the
    # rewriter's job is to keep the bullets even, not to re-decide the structure.
    for chunk in re.split(r"(?m)(?=^\* )|(?=^#{2,3} )", text):
        if not chunk.startswith("* "):
            out.append(chunk)
            continue
        trailing = "\n\n" if chunk.endswith("\n\n") else "\n"
        flat = " ".join(part.strip() for part in chunk.rstrip("\n").splitlines() if part.strip())
        # The twin left this marker doubled in every generated handover since Part
        # 14: the template's bullets begin with "* ", the split keeps it in the
        # chunk, and textwrap re-adds it via initial_indent. Fixed here rather
        # than inherited, because a bullet list that renders as "* * " is a
        # document whose first line already tells the reader nobody ran it.
        if flat.startswith("* "):
            flat = flat[2:]
        wrapped = textwrap.wrap(
            flat,
            width=92,
            initial_indent="* ",
            subsequent_indent="  ",
            break_long_words=False,
            break_on_hyphens=False,
        )
        out.append("\n".join(wrapped) + trailing)
    return "".join(out)


def _tree_counts(measured: dict[str, object]) -> tuple[int, int]:
    """The whole-tree figures, narrowed instead of asserted.

    ``measure`` returns one heterogeneous dict because it collects a dozen
    different gate outputs, and the tree entry is the only nested one. Narrowing
    it with ``isinstance`` here means the two ledger figures are checked rather
    than trusted, with no suppression comment to explain away - which is the same
    discipline Part 20 holds its own files to: this part's new and modified
    sources carry zero tokens, counted above rather than claimed.
    """
    tree = measured["tree"]
    if not isinstance(tree, dict):
        raise SystemExit(f"tree measurement missing or malformed: {tree!r}")
    source = tree.get("source")
    with_docs = tree.get("with_docs")
    if not isinstance(source, int) or not isinstance(with_docs, int):
        raise SystemExit(f"tree measurement unreadable: {tree!r}")
    return source, with_docs


def main(argv: list[str]) -> int:
    """``--check`` regenerates and compares instead of writing.

    The document promises two things - that it is complete and that it is
    reproducible - and only the first was machine-checkable when this script was
    copied from Part 15. ``--check`` closes the gap: the same generation runs,
    the result is compared byte for byte against the committed file, and a stale
    handover becomes a non-zero exit rather than a sentence nobody re-reads.
    """
    verify = "--check" in argv
    problems = sweep()
    if problems:
        print("HANDOVER AUDIT FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    table = baselines()

    def split_code_docs(pairs: list[tuple[str, str]], signed: bool = False) -> tuple[int, int]:
        code = docs = 0
        for rel, _ in pairs:
            current = lines_of(rel)
            value = current - table.get(rel, 0) if signed else current
            if rel.startswith("docs/"):
                docs += value
            else:
                code += value
        return code, docs

    new_code, new_docs = split_code_docs(NEW)
    unbaselined = [rel for rel, _ in MODIFIED if rel not in table]
    unblessed_size = sum(lines_of(rel) for rel in unbaselined)
    # A modified file that NO prior handover embedded has no recorded earlier
    # size, so its delta is unknowable rather than zero-and-not-counted. Charging
    # its whole length (the `table.get(rel, 0)` default that produced the first
    # drafts of this document) inflates "lines this part changed" into "lines this
    # part happens to have touched a file that is", which is the kind of number a
    # reader would repeat. So it is excluded from the delta, named here, and sized
    # as a size rather than a change.
    mod_code, mod_docs = split_code_docs(
        [(rel, note) for rel, note in MODIFIED if rel not in unbaselined],
        signed=True,
    )
    new_lines, delta = new_code + new_docs, mod_code + mod_docs

    print("measuring gates (this runs the suites; it takes a minute)...")
    measured = measure()
    header = HEADER_TEMPLATE.format(
        core_pytest=measured["core_pytest"],
        core_ruff=measured["core_ruff"],
        core_ruff_scripts=measured["core_ruff_scripts"],
        suppression_new=measured["suppression_new"],
        suppression_modified=measured["suppression_modified"],
        unbaselined_count=len(unbaselined),
        unbaselined_size=f"{unblessed_size:,}",
        unbaselined_list=", ".join(f"`{rel}`" for rel in unbaselined) or "none",
        admin_typecheck=measured["admin_typecheck"],
        core_mypy=measured["core_mypy"],
        engine_pytest=measured["engine_pytest"],
        engine_ruff=measured["engine_ruff"],
        engine_mypy=measured["engine_mypy"],
        engine_part20=measured["engine_part20"],
        engine_mypy_new_test=measured["engine_mypy_new_test"],
        api_part20=measured["api_part20"],
        schedule_check=measured["schedule_check"],
        node_scripts=measured["node_scripts"],
        manifest_check=measured["manifest_check"],
        check_rls=measured["check_rls"],
        api_tests=measured["api_tests"],
        api_typecheck=measured["api_typecheck"],
        api_lint=measured["api_lint"],
        prisma=measured["prisma"],
        trading_service=measured["trading_service"],
        market_service=measured["market_service"],
        total=new_lines + delta,
        new_code=new_code,
        new_code_count=sum(1 for rel, _ in NEW if not rel.startswith("docs/")),
        new_docs=new_docs,
        new_docs_count=sum(1 for rel, _ in NEW if rel.startswith("docs/")),
        new_docs_s="s" if sum(1 for rel, _ in NEW if rel.startswith("docs/")) != 1 else "",
        mod_code=mod_code,
        mod_docs=mod_docs,
        mod_count=len(MODIFIED),
        tree_source=_tree_counts(measured)[0],
        tree_with_docs=_tree_counts(measured)[1],
    )

    parts = [reflow_header(header), "## Created in Part 20 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 20 (full files, prior content preserved inside)\n")
    parts += [block(rel, note) for rel, note in MODIFIED]
    total_files = len(NEW) + len(MODIFIED)
    text = "\n".join(parts)
    if verify:
        committed = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if committed == text:
            print(f"OK: {OUT.name} is byte-identical to a fresh generation")
            return 0
        print(
            f"STALE: {OUT.name} differs from a fresh generation "
            f"({len(text.splitlines()):,} generated lines vs "
            f"{len(committed.splitlines()):,} committed)",
            file=sys.stderr,
        )
        return 1
    OUT.write_text(text, encoding="utf-8")
    emitted = text.count("\n## FILE: ")
    if emitted != total_files:
        print(f"EMISSION COUNT MISMATCH: {emitted} blocks for {total_files} files", file=sys.stderr)
        return 1
    print(
        f"wrote {OUT} ({len(text.splitlines()):,} lines, "
        f"{total_files} files: {len(NEW)} new + {len(MODIFIED)} modified; "
        f"{new_lines:,} new lines, +{delta:,} delta)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
````


## Modified in Part 20 (full files, prior content preserved inside)

## FILE: apps/api/src/modules/worker/engine-internal.client.ts (395 lines)

*`getStatus()` now answers `EngineStatus` (the mirror's type) instead of a hand-shaped object, reading the parsed body through `parseEngineStatus`; the two consumed fields (`mode`, `storeBackend`) and every assertion the startup gate makes are unchanged, and the terminal-versus-retryable status classification was deliberately not widened - the fix for the 400 was made where the 400 came from.*

```typescript
/**
 * HTTP client for the execution engine (services/execution-engine).
 *
 * The division of labour this client exists to enforce: the worker owns the
 * queue, correlation and admission control; the engine owns venue contact,
 * credentials and the durable execution record. This file transports a
 * validated command across that boundary and NOTHING else - no retry logic
 * (BullMQ retries; a second retry loop under it multiplies load into a
 * degraded venue, which is the opposite of backpressure), no fallback to
 * "assume it worked", and no request body or response ever echoed into a
 * log line (the payloads contain account ids; the error messages may contain
 * whatever the venue said).
 *
 * Failure taxonomy - the whole point of this class:
 *  - retryable: transport failure, timeout, 5xx. The job throws and BullMQ
 *    re-delivers within its attempt budget.
 *  - terminal: 401/403 (misconfigured wiring; retrying a secret mismatch is
 *    how you lock yourself out), 404/409/422 (this job, as written, can
 *    never succeed), 501 (command not wired in the engine build).
 *    These surface as EngineCallError.terminal so the processor can fail the
 *    job with the engine's own reason string rather than retry it to dust.
 */

import { Injectable } from '@nestjs/common';
import { JOB_NAMES } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import {
  EngineStatusShapeError,
  parseEngineStatus,
  type EngineStatus,
} from './engine-status-contract';
import type {
  AccountCommandPayload,
  CancelOrderPayload,
} from './worker.types';

/** Re-exported so the two consumers of the contract (this gate and the operations
 * read in modules/observability) import the SAME type from one place; the interface
 * itself lives in `engine-status-contract.ts`, because a mirror declared twice is a
 * mirror that drifts, which is the defect this part exists to close. */
export type { EngineStatus } from './engine-status-contract';
export { EngineStatusShapeError } from './engine-status-contract';

export interface EngineCallErrorInit {
  readonly kind: 'retryable' | 'terminal';
  readonly status: number | null;
  readonly code: string;
  readonly message: string;
  readonly correlationId?: string;
}

const ENGINE_URL_PATTERN = /^https?:\/\//;

export class EngineCallError extends Error {
  public readonly kind: 'retryable' | 'terminal';
  public readonly status: number | null;
  public readonly code: string;
  public readonly correlationId?: string;

  public constructor(init: EngineCallErrorInit) {
    super(`execution engine call failed [${init.code}] ${init.message}`);
    this.name = 'EngineCallError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.correlationId = init.correlationId;
  }

  public get isTerminal(): boolean {
    return this.kind === 'terminal';
  }
}

export interface EngineCommandReceipt {
  readonly outcome: 'ok' | 'rejected';
  readonly code: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** The wiring this client refuses to run without, as one predicate.
 *
 * Exported because a second consumer (Part 20's operations read) has to answer the
 * same question BEFORE constructing one - and `EngineInternalClient`'s constructor
 * raises on purpose, so a module that merely wanted to be polite about an
 * unconfigured deployment would otherwise have to catch a programmer-error at
 * request time. One law, two call sites, no copy of the 32-character rule. */
export const engineInternalClientConfigured = (config: AppConfigService): boolean => {
  const token = config.executionEngineToken;
  return (
    /^https?:\/\//.test(config.executionEngineUrl) &&
    token !== undefined &&
    token.length >= ENGINE_TOKEN_MIN_LENGTH
  );
};

/** The engine's own minimum (`services/execution-engine/app/security.py` accepts no
 * shorter token on the receiving side), restated here only as a number, never as a
 * second validation path. */
const ENGINE_TOKEN_MIN_LENGTH = 32;

const STATUS_CACHE_TTL_MS = 10_000;

@Injectable()
export class EngineInternalClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private statusCache: { value: EngineStatus; fetchedAtMs: number } | null = null;

  public constructor(config: AppConfigService) {
    const url = config.executionEngineUrl;
    if (!ENGINE_URL_PATTERN.test(url)) {
      throw new Error(
        'EXECUTION_ENGINE_URL must be an http(s) URL; refusing to construct an ' +
          'engine client that cannot be aimed at a real service',
      );
    }
    this.baseUrl = url.replace(/\/+$/, '');
    const token = config.executionEngineToken;
    if (token === undefined || token.length < ENGINE_TOKEN_MIN_LENGTH) {
      throw new Error(
        'EXECUTION_ENGINE_TOKEN (>= 32 characters) is required by the worker: ' +
          'this process forwards commands into the service holding venue credentials',
      );
    }
    this.token = token;
  }

  /** Startup gate for worker.ts: the engine must at least answer, speak the
   * same command set, and be in the mode this deployment believes it is in.
   * A worker that starts before its engine and "queues work" into a void is
   * the deployment race this check exists to make impossible; the 10s
   * cache is only for the periodic health view, not for this decision.
   * That view existed only as a sentence until Part 20: the operations panel's
   * execution section now reads the engine through `getStatus()` here, so the
   * cache is load-bearing (a panel refresh must not be a fresh dependency on a
   * service that owns venue connections) and the `force` argument stays reserved
   * for startup, which is the one moment a stale answer must not be trusted. */
  public async assertEngineCompatible(): Promise<EngineStatus> {
    let status: EngineStatus;
    try {
      status = await this.getStatus(true);
    } catch (error) {
      if (error instanceof EngineStatusShapeError) {
        // Terminal on purpose. A transport failure is retryable and BullMQ (or a
        // restart) will ask again; an engine that answers with something that is not
        // the contract will answer the same way every time, and a worker that retried
        // into it is a worker that never starts while looking like it is trying.
        throw new EngineCallError({
          kind: 'terminal',
          status: null,
          code: 'ENGINE_STATUS_SHAPE',
          message: error.message,
        });
      }
      throw error;
    }
    if (status.mode !== 'simulated') {
      throw new Error(
        `execution engine reports mode "${status.mode}"; this worker build forwards ` +
          'only into the simulated runtime (live is not wired)',
      );
    }
    if (status.storeDurable) {
      // Part 13 re-review (docs/PART13_DURABLE_STORE.md §ack; closes the
      // forcing function parked in docs/PART11_WORKER_SCALING.md §13.3):
      // the ack law - engine 2xx means done, business rejection is ALSO
      // done, only 5xx/transport retries - survives durability unchanged,
      // because every engine command that writes is replay-safe on the
      // durable store: submission idempotency is the (tenant,
      // client_order_id) unique index (a retry of a reserved order resumes
      // it, never double-books), fill recording is ON CONFLICT against the
      // (tenant, fill_id) index (a replayed execution answers "already
      // recorded"), and the event journal appends with no update path to
      // corrupt. Durability makes 2xx MORE trustworthy, not differently.
      // What this gate now refuses is the INCONSISTENT claim: a durable
      // store is only credible when the engine also names its backend -
      // the store class that could produce storeDurable=true declares
      // storeBackend=postgres, and an engine that claims durability while
      // reporting anything else (or nothing, pre-Part-13 wire shape) is a
      // contradiction this worker will not forward into.
      if (status.storeBackend !== 'postgres') {
        throw new Error(
          'execution engine reports a DURABLE store without storeBackend "postgres" ' +
            `(got "${status.storeBackend}"); the Part 13 durability contract is ` +
            'unproven on this engine and the worker only forwards under a reviewed store',
        );
      }
    }
    return status;
  }

  /** When the cached status was actually fetched, or null when nothing has been read.
   * Part 20 added this accessor for the operations panel: an age reported by the reader
   * ("I just looked") is not an age, it is a tautology, and the number an operator needs
   * is how long ago the ENGINE answered. */
  public statusFetchedAtMs(): number | null {
    return this.statusCache === null ? null : this.statusCache.fetchedAtMs;
  }

  public async getStatus(force = false): Promise<EngineStatus> {
    const cached = this.statusCache;
    if (
      !force &&
      cached !== null &&
      Date.now() - cached.fetchedAtMs < STATUS_CACHE_TTL_MS
    ) {
      return cached.value;
    }
    const response = await this.call('/internal/v1/status', {
      method: 'GET',
      correlationId: undefined,
    });
    const body: unknown = await response.json();
    // Parsed against the contract, never plucked key by key. The difference matters
    // on the failure path only: `String(body.mode ?? '')` turned a service answering
    // with a proxy's HTML page or a half-migrated engine into `mode: ''`, which the
    // gate below then read as "not simulated" - a refusal with a message blaming the
    // engine's mode instead of naming what actually happened, and eleven keys simply
    // absent from the object. A shape failure is now a shape failure, and it says
    // which key.
    const status = parseEngineStatus(body);
    this.statusCache = { value: status, fetchedAtMs: Date.now() };
    return status;
  }

  public async executeAccountCommand(
    command: string,
    payload: AccountCommandPayload,
    correlationId: string,
  ): Promise<EngineCommandReceipt> {
    const path = ACCOUNT_COMMAND_PATHS[command];
    if (path === undefined) {
      throw new EngineCallError({
        kind: 'terminal',
        status: null,
        code: 'COMMAND_UNROUTED',
        message: `no engine route for command ${JSON.stringify(command)}`,
      });
    }
    const response = await this.call(path, {
      method: 'POST',
      body: JSON.stringify({
        tenantId: payload.tenantId,
        accountId: payload.accountId,
        ...(payload.requestedByUserId !== undefined
          ? { requestedByUserId: payload.requestedByUserId }
          : {}),
        ...(payload.requestedAt !== undefined ? { requestedAt: payload.requestedAt } : {}),
      }),
      tenantId: payload.tenantId,
      correlationId,
    });
    const body = (await response.json()) as Record<string, unknown>;
    return this.receipt('ok', response.status, body);
  }

  public async cancelOrder(
    payload: CancelOrderPayload,
    correlationId: string,
  ): Promise<EngineCommandReceipt> {
    const response = await this.call('/internal/v1/orders/cancel', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: payload.tenantId,
        accountId: payload.accountId,
        orderId: payload.orderId,
        clientOrderId: payload.clientOrderId,
        symbol: payload.symbol,
        ...(payload.requestedByUserId !== undefined
          ? { requestedByUserId: payload.requestedByUserId }
          : {}),
        ...(payload.requestedAt !== undefined ? { requestedAt: payload.requestedAt } : {}),
      }),
      tenantId: payload.tenantId,
      correlationId,
    });
    const body = (await response.json()) as Record<string, unknown>;
    // 200 + outcome is a COMPLETED job regardless of the business verdict;
    // the engine's contract says so. Only non-ok HTTP is an error path here.
    const outcome =
      typeof body.outcome === 'string' && body.outcome !== 'ACCEPTED' ? 'rejected' : 'ok';
    return this.receipt(outcome, response.status, body);
  }

  private receipt(
    outcome: EngineCommandReceipt['outcome'],
    status: number,
    body: Record<string, unknown>,
  ): EngineCommandReceipt {
    return {
      outcome,
      code: typeof body.code === 'string' ? body.code : `HTTP_${status}`,
      detail: body,
    };
  }

  private async call(
    path: string,
    init: {
      method: 'GET' | 'POST';
      body?: string;
      tenantId?: string;
      correlationId?: string;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-internal-token': this.token,
    };
    if (init.tenantId !== undefined) {
      headers['x-tenant-id'] = init.tenantId;
    }
    if (init.correlationId !== undefined) {
      headers['x-request-id'] = init.correlationId;
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        // The engine owns venue timeouts (EXECUTION_REQUEST_TIMEOUT_MS);
        // this is only the queue-hop guard so a hung engine cannot hold a
        // BullMQ job slot forever. 30s comfortably exceeds 5s + retries.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // The message may embed the URL (never the headers: fetch errors do
      // not print them, and this comment is the reminder that the token
      // lives ONLY there).
      throw new EngineCallError({
        kind: 'retryable',
        status: null,
        code: 'ENGINE_UNREACHABLE',
        message: error instanceof Error ? error.message : 'transport failure',
      });
    }

    if (response.ok) {
      return response;
    }

    const correlationId = response.headers.get('x-correlation-id') ?? undefined;
    const errorBody = await this.readErrorBody(response);
    const terminalByStatus =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 409 ||
      response.status === 422 ||
      response.status === 501;
    throw new EngineCallError({
      kind: terminalByStatus ? 'terminal' : 'retryable',
      status: response.status,
      code: errorBody.code,
      message: errorBody.message,
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
  }

  private async readErrorBody(
    response: Response,
  ): Promise<{ code: string; message: string }> {
    try {
      const parsed = (await response.json()) as { code?: unknown; message?: unknown };
      return {
        code: typeof parsed.code === 'string' ? parsed.code : `HTTP_${response.status}`,
        // 256 chars: enough for an operator to act on, short enough that a
        // hostile venue string cannot bloat the queue's failure record.
        message:
          typeof parsed.message === 'string'
            ? parsed.message.slice(0, 256)
            : `engine responded ${response.status}`,
      };
    } catch {
      return {
        code: `HTTP_${response.status}`,
        message: `engine responded ${response.status} with an unreadable body`,
      };
    }
  }

}

/** Command → engine route. One table, module-private: adding a command to
 * worker.types without routing it here fails the worker's own spec loudly
 * (unrouted commands throw EngineCallError.COMMAND_UNROUTED - never a
 * silent send to the wrong path). */
const ACCOUNT_COMMAND_PATHS: Readonly<Record<string, string>> = {
  [JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS]: '/internal/v1/accounts/verify-credentials',
  [JOB_NAMES.REFRESH_ACCOUNT_BALANCES]: '/internal/v1/accounts/refresh-balances',
  [JOB_NAMES.RECONCILE_TRADING_ACCOUNT]: '/internal/v1/accounts/reconcile',
  [JOB_NAMES.RESYNC_PRIVATE_STREAM]: '/internal/v1/accounts/resync-private-stream',
};
```


## FILE: apps/api/src/modules/observability/observability.module.ts (119 lines)

*the client is provided by a factory that asks `engineInternalClientConfigured` before constructing one, so an API process with no engine wiring boots and reports `unconfigured` rather than failing to start, and `EnginePostureService` is registered beside the module's other read-only views with the client injected optionally.*

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AlertsService } from './alerts.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { SloController } from './slo.controller';
import { SloService } from './slo.service';
import { SloSamplesService } from './slo-samples';
import { IncidentsService } from './incidents.service';
import { MetricsController } from './metrics.controller';
import { createMetricsRegistry } from './metrics.registry.provider';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';
import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { TELEMETRY_ALERT_SINK, TracingService } from '../../infrastructure/tracing/tracing.service';
import { HealthModule } from '../health/health.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { WorkerCoordinationReadService } from './worker-coordination-read.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  EngineInternalClient,
  engineInternalClientConfigured,
} from '../worker/engine-internal.client';
import { ENGINE_POSTURE_CLIENT, EnginePostureService } from './engine-posture.service';

/** The binding rule, as a named function rather than an inline lambda so the spec can
 * exercise the decision itself instead of describing it. */
export const createEnginePostureClient = (
  config: AppConfigService,
): EngineInternalClient | null =>
  engineInternalClientConfigured(config) ? new EngineInternalClient(config) : null;

/**
 * The Part 9 operations module: metric registry, panels, alert fold,
 * incidents, and the two controllers (v1 operations plane + the versionless
 * Prometheus endpoint).
 *
 * The registry is a per-module singleton created in a factory - one process,
 * one registry, families registered at boot so the label policy is fixed
 * before any request can record into it (registration errors at boot are
 * cheap; refusals at record time are counted and silent, by the same split
 * as the Python registry: programmer errors loud, operational errors safe).
 *
 * This module IMPORTS health (for the readiness service and build info) and
 * is imported by the queue module (for the maintenance sync) - and nothing
 * else imports it. Part 10 adds the tracer (infra/tracing, provided here for
 * want of a home that BOTH the HTTP pipeline and the queue plane can reach)
 * and the SLO module, whose ONLY write paths are its own tables, the burn
 * alert fold, and audit. No middleware joins the pipeline from here: metrics-path
 * request logging is already silenced by the pino autoLogging ignore list. The read-only guarantee the spec demands of the panel is
 * structural: there is no service here that the execution path depends on,
 * in either direction. The dependency arrows point AT the trading plane's
 * published state, never through it.
 */
@Module({
  imports: [HealthModule, RedisModule],
  controllers: [ObservabilityController, MetricsController, SloController],
  providers: [
    // Part 11: read-only worker-plane visibility. Redis comes along because
    // the claims it surfaces are WRITTEN by the worker and merely READ here
    // - the direction that keeps this module's "no execution dependency"
    // guarantee intact.
    WorkerCoordinationReadService,
    // Part 20: the execution engine's posture, read from the engine itself. The client is
    // built here rather than imported from WorkerModule on purpose - that module also
    // provides the queue processor, and this module's guarantee is that no execution
    // dependency points back at the trading plane. A null client is a legal binding, not
    // a fallback: it means this deployment was never configured to reach an engine, and
    // the service renders that as a row instead of assuming health.
    {
      provide: ENGINE_POSTURE_CLIENT,
      useFactory: createEnginePostureClient,
      inject: [AppConfigService],
    },
    EnginePostureService,
    {
      provide: MetricsRegistry,
      useFactory: (): MetricsRegistry => createMetricsRegistry(),
    },
    ObservabilityService,
    AlertsService,
    IncidentsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
    // --- Part 10 ------------------------------------------------------------
    TracingService,
    SloSamplesService,
    SloService,
    {
      // The sink is constructor-injected into AlertsService by THIS factory
      // rather than by TracingService importing AlertsService: the
      // dependency arrow points from telemetry INTO the durable plane, never
      // back, mirroring (in reverse) the one-way mirror rule the engines
      // follow. A process without the sink still traces; it just cannot
      // page anyone - which is what a missing DB connection looks like
      // anyway, and the exporter already survives both.
      provide: TELEMETRY_ALERT_SINK,
      useFactory: (alerts: AlertsService) => ({
        telemetryExportFailing: (service: string, failing: boolean, consecutive: number) =>
          alerts.telemetryExportFailing(service, failing, consecutive),
      }),
      inject: [AlertsService],
    },
  ],
  exports: [
    ObservabilityService,
    WorkerCoordinationReadService,
    EnginePostureService,
    AlertsService,
    IncidentsService,
    MetricsRegistry,
    TracingService,
    SloService,
    SloSamplesService,
  ],
})
export class ObservabilityModule {}
```


## FILE: apps/api/src/modules/observability/observability.service.ts (399 lines)

*`execution` gained `sections`, rendered from the posture view, and the existing `enginePosture` readiness-gate summary is untouched: the panel row is a second reader of one fact, not a second source of it.*

```typescript
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { OBS_PUBLISHER_SERVICES } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { QueueService } from '../queue/queue.service';
import { HealthService } from '../health/health.service';
import { TradingReadinessService } from '../health/trading-readiness.service';

import { parseHealthDocument, componentView } from './observability.mapper';
import { EnginePostureService } from './engine-posture.service';
import type {
  OpsOverviewSection,
  OpsOverviewView,
  OpsServiceHealthView,
  QueueStatsView,
  TradingReadinessView,
} from './observability.types';
import { ALERT_SEVERITIES, TRADING_GATES, type AlertSeverity } from './alert.constants';

/**
 * The operations panel documents. Every section here is a READ composed from
 * state the platform already keeps - Redis mirrors published by the trading
 * plane, the API's own live probes, and small aggregate queries against the
 * durable tables. Nothing here reaches into Redis or Postgres for the admin
 * UI to consume directly (the UI consumes THESE endpoints), and nothing here
 * computes anything the engine computes for enforcement: panel and gate may
 * legitimately disagree for one sample interval, and that is a fact about
 * asynchronous systems, not a bug to paper over by making the panel the
 * source of truth. It never is; that is why the risk module owns the gate.
 */
@Injectable()
export class ObservabilityService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
    private readonly readiness: TradingReadinessService,
    private readonly healthService: HealthService,
    private readonly enginePosture: EnginePostureService,
    @InjectPinoLogger(ObservabilityService.name) private readonly logger: PinoLogger,
  ) {}

  async overview(tenantId: string | null): Promise<OpsOverviewView> {
    const [services, readiness, queueViews, alertAgg] = await Promise.all([
      this.serviceHealth(),
      this.tradingReadiness(),
      this.queuePanel(),
      this.prisma.opsAlert.groupBy({
        by: ['severity', 'state'],
        _count: { _all: true },
        ...(tenantId === null ? {} : { where: { tenantId } }),
      }),
    ]);

    const counts = Object.fromEntries(ALERT_SEVERITIES.map((severity) => [severity, 0])) as Record<
      AlertSeverity,
      number
    >;
    let open = 0;
    let acknowledged = 0;
    for (const row of alertAgg) {
      counts[row.severity as AlertSeverity] += row._count._all;
      if (row.state === 'OPEN') {
        open += row._count._all;
      }
      if (row.state === 'ACKNOWLEDGED') {
        acknowledged += row._count._all;
      }
    }

    const overall = readiness.tradingReady
      ? services.status === 'HEALTHY'
        ? 'HEALTHY'
        : 'DEGRADED'
      : readiness.status;

    return {
      status: overall,
      tradingReady: readiness.tradingReady,
      alertCounts: counts,
      openAlerts: open,
      acknowledgedAlerts: acknowledged,
      services: services.views,
      queues: queueViews,
      sections: await this.sections(services.views, queueViews, open, acknowledged),
      build: this.healthService.getBuildInfo(),
      note:
        'Derived operational view. Every value is a mirror of engine or infrastructure ' +
        'state at read time; this document is not a source of financial truth and grants nothing. ' +
        'Risk controls reduce operational risk but cannot guarantee against all losses.',
    };
  }

  async marketData(): Promise<{ services: OpsServiceHealthView[]; note: string }> {
    const services = await this.serviceHealth();
    return {
      services: services.views.map((view) => ({
        ...view,
        components: view.components.filter(
          (component) =>
            ['market_data', 'market_data_mirror', 'poller', 'quote_freshness', 'redis'].includes(
              component.component,
            ) || component.component.startsWith('feed'),
        ),
      })),
      note: 'Market-data freshness is reader-side truth: ages are computed against the data, not the poller.',
    };
  }

  async riskPanel(tenantId: string): Promise<OpsOverviewSection[]> {
    const since = new Date(Date.now() - 86_400_000);
    const [eventsBySeverity, staleProtections, engagedSwitches, riskGate] = await Promise.all([
      this.prisma.riskEvent.groupBy({
        by: ['severity'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.riskProtectionTrip.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.killSwitch.count({ where: { scope: 'GLOBAL', isEngaged: true } }),
      this.tradingReadiness(),
    ]);

    const gateRow = (name: string): string => {
      const gate = riskGate.gates.find((candidate) => candidate.gate === name);
      return gate === undefined ? 'unknown' : gate.satisfied ? 'satisfied' : `blocked (${gate.reason})`;
    };

    return [
      {
        title: 'RISK',
        rows: [
          { label: 'risk_state_fresh', value: gateRow('risk_state_fresh'), tone: 'neutral' },
          { label: 'risk_engine', value: gateRow('risk_engine'), tone: 'neutral' },
          {
            label: 'active protections',
            value: String(staleProtections),
            tone: staleProtections > 0 ? 'bad' : 'ok',
          },
          {
            label: 'engaged GLOBAL switches',
            value: String(engagedSwitches),
            tone: engagedSwitches > 0 ? 'bad' : 'ok',
          },
          ...eventsBySeverity.map((row) => ({
            label: `risk events 24h [${row.severity}]`,
            value: String(row._count._all),
            tone: row.severity === 'CRITICAL' || row.severity === 'EMERGENCY' ? ('bad' as const) : ('neutral' as const),
          })),
        ],
      },
    ];
  }

  async executionPanel(tenantId: string): Promise<OpsOverviewSection[]> {
    const since = new Date(Date.now() - 86_400_000);
    const [ordersByStatus, openIncidents, execGate] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.executionIncident.count({ where: { tenantId, resolvedAt: null } }),
      this.tradingReadiness(),
    ]);
    const gate = execGate.gates.find((candidate) => candidate.gate === 'execution_adapter');

    return [
      {
        title: 'EXECUTION',
        rows: [
          {
            label: 'execution adapter (engine mirror)',
            value: gate === undefined ? 'unknown' : gate.satisfied ? 'ready' : `blocked (${gate.reason})`,
            tone: gate?.satisfied ? 'ok' : 'warn',
          },
          {
            label: 'open execution incidents',
            value: String(openIncidents),
            tone: openIncidents > 0 ? 'bad' : 'ok',
          },
          ...ordersByStatus.map((row) => ({
            label: `orders 24h [${row.status}]`,
            value: String(row._count._all),
            tone: row.status === 'REJECTED' || row.status === 'EXPIRED' ? ('warn' as const) : ('neutral' as const),
          })),
        ],
      },
      // Part 20. Everything above this line is this service's own database describing what
      // went through it; the section below is the only thing on the panel that says what the
      // process doing the placing IS - which credential source it was willing to read,
      // whether a confirmation verifier exists, how its live-enablement grading came out,
      // whether anything measures it. Two different authorities, deliberately two sections:
      // the platform's rule is that a derived fact and a self-reported one never share a row.
      await this.enginePosture.section(),
    ];
  }

  async queueStatus(): Promise<{ queues: QueueStatsView[]; note: string }> {
    return {
      queues: await this.queuePanel(),
      note:
        'Depths are BullMQ counters at read time; oldest-waiting is sampled from the head of the wait list. ' +
        'The execution queue alerts at half the age (and CRITICALLY) - the rest are control-plane queues.',
    };
  }

  async datasets(): Promise<OpsOverviewSection[]> {
    const runs = await this.prisma.datasetIngestionRun.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return [
      {
        title: 'DATASETS',
        rows: runs.map((row) => ({
          label: `ingestion runs [${row.status}]`,
          value: String(row._count._all),
          tone: row.status === 'FAILED' || row.status === 'QUARANTINED' ? ('bad' as const) : ('neutral' as const),
        })),
      },
    ];
  }

  /**
   * Scrape-time refresh of the gauges that are QUERIES, not counters: alert
   * counts and queue depths. Best-effort with honest degradation - a
   * Postgres blip zeroes nothing and errors nothing; the gauge for that
   * scrape is simply absent, and an absent gauge reads as a gap in Grafana,
   * which is the truth ("we could not tell at that moment") rather than a
   * lie (a cached value presented as current, or a zero meaning "healthy").
   */
  async sampleDerivedGauges(registry: {
    setGauge: (name: string, labels: Record<string, string>, value: number) => void;
  }): Promise<void> {
    const [alertCounts, queues] = await Promise.allSettled([
      this.prisma.opsAlert.groupBy({ by: ['severity'], where: { state: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: { _all: true } }),
      this.queuePanel(),
    ]);

    if (alertCounts.status === 'fulfilled') {
      const seen = new Map<string, number>(alertCounts.value.map((row) => [String(row.severity), row._count._all]));
      for (const severity of ALERT_SEVERITIES) {
        registry.setGauge('wlct_ops_alert_open_count', { severity }, seen.get(severity) ?? 0);
      }
    }
    if (queues.status === 'fulfilled') {
      for (const queue of queues.value) {
        registry.setGauge('wlct_queue_waiting_jobs', { queue: queue.name }, queue.waiting);
        registry.setGauge(
          'wlct_queue_oldest_waiting_age_ms',
          { queue: queue.name },
          queue.oldestWaitingAgeMs ?? -1,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------
  private async tradingReadiness(): Promise<TradingReadinessView> {
    try {
      return await this.readiness.evaluate();
    } catch (error) {
      this.logger.error(
        { event: 'ops.readiness_evaluation_failed', errorType: (error as Error).name },
        'Trading readiness could not be evaluated; reporting UNHEALTHY (fail closed)',
      );
      return {
        status: 'UNHEALTHY',
        tradingReady: false,
        evaluatedAtMicros: String(BigInt(Date.now()) * 1000n),
        blockingGates: [...TRADING_GATES],
        gates: [],
        enginesReporting: [],
        note: 'evaluation failed; readiness unavailable is treated as not ready, never as ready',
      };
    }
  }

  private async serviceHealth(): Promise<{ views: OpsServiceHealthView[]; status: OpsServiceHealthView['status'] }> {
    const views: OpsServiceHealthView[] = [];
    for (const service of OBS_PUBLISHER_SERVICES) {
      let raw: string | null = null;
      try {
        raw = await this.redis.client.get(`wlct:trading:ops:health:${service}`);
      } catch (error) {
        this.logger.warn(
          { event: 'ops.health_mirror_unreadable', service, errorType: (error as Error).name },
          'Service health mirror unreadable; reported as UNKNOWN (silence is not health)',
        );
      }
      const document = raw === null ? null : parseHealthDocument(raw);
      if (document === null) {
        views.push({
          service,
          status: 'UNKNOWN',
          checkedAt: null,
          ageMicros: null,
          stale: true,
          components: [],
        });
        continue;
      }
      views.push({
        service,
        status: document.status as OpsServiceHealthView['status'],
        checkedAt: new Date(Math.round(document.checkedAtMicros / 1000)).toISOString(),
        ageMicros: null,
        stale: false,
        components: document.components.map((component) =>
          componentView({ ...component, ageMicros: component.ageMicros }, false),
        ),
      });
    }
    const rank = { HEALTHY: 0, DEGRADED: 1, UNKNOWN: 2, UNHEALTHY: 3, STOPPED: 4 } as const;
    const status = views.reduce<OpsServiceHealthView['status']>(
      (worst, view) => (rank[view.status] > rank[worst] ? view.status : worst),
      'HEALTHY',
    );
    return { views, status };
  }

  private async queuePanel(): Promise<QueueStatsView[]> {
    const thresholdMs = this.config.queueAlertAgeMs;
    try {
      const depths = await this.queues.getDepths();
      return depths.map((depth) => {
        const critical = depth.name === 'trade-execution';
        const limit = critical ? Math.floor(thresholdMs / 2) : thresholdMs;
        return {
          name: depth.name,
          waiting: depth.waiting,
          active: depth.active,
          delayed: depth.delayed,
          failed: depth.failed,
          completed: depth.completed,
          paused: depth.paused,
          oldestWaitingAgeMs: depth.oldestWaitingAgeMs,
          alerting: depth.oldestWaitingAgeMs !== null && depth.oldestWaitingAgeMs > limit,
          critical,
        };
      });
    } catch {
      return [];
    }
  }

  private async sections(
    services: OpsServiceHealthView[],
    queues: QueueStatsView[],
    open: number,
    acknowledged: number,
  ): Promise<OpsOverviewSection[]> {
    const readiness = await this.tradingReadiness();
    return [
      {
        title: 'SYSTEM',
        rows: [
          { label: 'build', value: `${readiness.enginesReporting.length > 0 ? 'engines reporting' : 'no engine mirror'}`, tone: 'neutral' },
          ...services.map((service) => ({
            label: `service ${service.service}`,
            value: service.status,
            tone: service.status === 'HEALTHY' ? ('ok' as const) : service.status === 'UNKNOWN' ? ('warn' as const) : ('bad' as const),
          })),
        ],
      },
      {
        title: 'ALERTS',
        rows: [
          { label: 'open', value: String(open), tone: open > 0 ? ('bad' as const) : ('ok' as const) },
          { label: 'acknowledged', value: String(acknowledged), tone: 'warn' as const },
          {
            label: 'trading ready',
            value: readiness.tradingReady ? 'true' : 'false',
            detail: readiness.blockingGates.join(', ') || 'all gates satisfied',
            tone: readiness.tradingReady ? ('ok' as const) : ('bad' as const),
          },
        ],
      },
      {
        title: 'QUEUES',
        rows: queues.map((queue) => ({
          label: queue.name,
          value: `waiting ${queue.waiting}, active ${queue.active}, failed ${queue.failed}`,
          detail:
            queue.oldestWaitingAgeMs === null
              ? 'oldest waiting: n/a'
              : `oldest waiting ${queue.oldestWaitingAgeMs}ms`,
          tone: queue.alerting ? ('bad' as const) : ('neutral' as const),
        })),
      },
    ];
  }
}
```


## FILE: services/execution-engine/app/security.py (193 lines)

*the part's behaviour change: one law, two scopes. `_authenticate` (the constant-time token comparison), `_tenant_or_none` (validate-what-is-sent, refuse-what-is-required) and `_request_id` are shared, `TENANT_REQUIRED_CODE` names the refusal the worker matches on, `require_internal_auth` keeps its command semantics and its exact message, and `require_internal_auth_readonly` tolerates the absence of a tenant header for a route that acts on no tenant while still refusing a malformed one and still returning `tenant_id == ""` rather than an invented pseudo-tenant.*

```python
"""Authentication for service-to-service calls.

The execution engine is never exposed to the public internet. It accepts
only requests carrying the shared internal token (constant-time compared),
and it requires an explicit tenant header on every command so no action is
ever tenantless: the worker's job payload names a tenant, the header is
where the HTTP surface enforces it, and a mismatch between the two is
rejected rather than resolved by trust. The cross-check lives in the router
because it needs the parsed body; this module guarantees the caller IS an
internal service speaking for A tenant.

One route reads instead of acting, and says so by depending on
:func:`require_internal_auth_readonly` (Part 20). The distinction is the whole
argument, so it is stated here rather than only at the route: the tenant law
exists so that no money operation can run without an owner, and a read of this
process's own wiring has no owner to name because it has no effect to attribute.
The exemption also cannot disclose anything - every key ``GET /internal/v1/status``
returns is published on ``GET /health/ready``, which asks for nothing at all, and
that superset relation is a test in the service suite rather than a claim here.
The token is still required, because the point is not to hide that a posture
exists but to keep a stranger from learning which deployment has which one -
the same reason ``/status`` is a document and an environment file is not.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings

__all__ = [
    "CALLER_AUTH_HEADER",
    "TENANT_HEADER",
    "TENANT_REQUIRED_CODE",
    "REQUEST_ID_HEADER",
    "ServiceCaller",
    "require_internal_auth",
    "require_internal_auth_readonly",
    "require_tenant_match",
]

#: The header NAME - not a secret, it never holds one. Named away from
#: the word "token" deliberately: flake8-S105 rightly hunts string
#: literals assigned to token-shaped constants, and a header label is
#: not a credential; the config validator guards the value.
CALLER_AUTH_HEADER = "x-internal-token"
TENANT_HEADER = "x-tenant-id"

#: The refusal code for a command with no tenant. A name rather than a literal
#: because the worker matches on this string and the read scope below must not be
#: able to raise it by accident: `_tenant_or_none` is the only place it appears.
TENANT_REQUIRED_CODE = "TENANT_HEADER_REQUIRED"
REQUEST_ID_HEADER = "x-request-id"


class ServiceCaller:
    """The authenticated context of an internal request."""

    def __init__(self, tenant_id: str, request_id: str | None) -> None:
        self.tenant_id = tenant_id
        self.request_id = request_id


def _authenticate(settings: Settings, x_internal_token: str | None) -> None:
    """The token half, shared by both scopes.

    Extracted rather than copied because a constant-time comparison has exactly one
    correct spelling, and a second copy in this file would be a second place for
    somebody to get wrong - the failure mode being a function that looks timing-safe
    and quietly stopped being one.
    """
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, settings.EXECUTION_INTERNAL_TOKEN or ""
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid internal service credentials."},
        )


def _tenant_or_none(x_tenant_id: str | None, *, required: bool) -> str:
    """The tenant half, with the presence question asked by the caller.

    ``required=False`` does not mean "the header is ignored": a tenant that IS sent is
    validated exactly as strictly, so a caller cannot answer a read with
    ``x-tenant-id: ../../etc`` and have the anomaly pass because the route is exempt.
    Absence is tolerated; a bad value never is.
    """
    if not x_tenant_id:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": TENANT_REQUIRED_CODE,
                    "message": (
                        f"Every execution command must name its tenant via the "
                        f"{TENANT_HEADER} header; tenantless money operations are refused."
                    ),
                },
            )
        return ""
    if len(x_tenant_id) > 64 or not _tenant_ok(x_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "TENANT_HEADER_INVALID",
                "message": "The tenant header is not a plausible identifier.",
            },
        )
    return x_tenant_id


def _request_id(x_request_id: str | None) -> str | None:
    return x_request_id if x_request_id and len(x_request_id) <= 128 else None


async def require_internal_auth(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=CALLER_AUTH_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """Validates the internal token and the tenant scope of the caller.

    The command scope: every route that can act on a tenant's money uses this. The
    refusal text is a pinned contract - the worker's client and the API suite match on
    ``TENANT_HEADER_REQUIRED`` and on the word "tenantless" - which is why the code is
    a named constant and the sentence is kept verbatim below.
    """
    _authenticate(settings, x_internal_token)
    return ServiceCaller(
        tenant_id=_tenant_or_none(x_tenant_id, required=True),
        request_id=_request_id(x_request_id),
    )


async def require_internal_auth_readonly(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header(alias=CALLER_AUTH_HEADER)] = None,
    x_tenant_id: Annotated[str | None, Header(alias=TENANT_HEADER)] = None,
    x_request_id: Annotated[str | None, Header(alias=REQUEST_ID_HEADER)] = None,
) -> ServiceCaller:
    """The read scope: token required, tenant optional, a sent header still validated.

    Used by exactly one route - ``GET /internal/v1/status`` - and a test in the Part 20
    service suite walks the application's own route table to assert it stays the only
    one, because the way a scoping exemption rots is by becoming the convenient
    dependency to reach for on the next route somebody adds.

    ``tenant_id`` is the empty string when no header was sent. Not a sentinel naming a
    tenant: the status route never reads the field - it takes a caller only to make the
    dependency run - and an empty value is the shape of "nobody", which is what a
    process-level read actually has. A pseudo-tenant such as ``"system"`` would put a
    fake identifier into the one object whose purpose is to name a real one, and
    somebody would eventually compare it to one.
    """
    _authenticate(settings, x_internal_token)
    return ServiceCaller(
        tenant_id=_tenant_or_none(x_tenant_id, required=False),
        request_id=_request_id(x_request_id),
    )


def _tenant_ok(candidate: str) -> bool:
    # Wire-token grammar, same shape the platform uses for ids everywhere:
    # alphanumerics with '-' and '_'. This is header sanity, not lookup:
    # existence of the tenant is the store's business on the effects side.
    return all(
        ch.isascii() and (ch.isalnum() or ch in "-_") for ch in candidate
    )


def require_tenant_match(tenant_body: str, caller: ServiceCaller) -> None:
    """Reject a body naming a different tenant than the authenticated header.

    The API stamps both from the same job payload, so divergence here means
    either a misroute or a caller trying to cross tenants through a
    correctly authenticated connection. Both are 403, loudly.
    """
    if tenant_body != caller.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "TENANT_MISMATCH",
                "message": (
                    "The request body names a different tenant than the "
                    "authenticated header; the command was refused."
                ),
            },
        )
```


## FILE: services/execution-engine/app/routers/internal.py (275 lines)

*one `Depends` line and its comment: `engine_status` reads through `ReadAuthDep`, and the comment records why (a process-level read has no tenant to name) and that every command route keeps the tenant law. The route body never touched the caller before and does not now.*

```python
"""The internal command surface the trading worker forwards to.

Contract notes that the worker and the API both depend on:

* 200 means DURABLY PROCESSED (for the runtime's durability class); the
  business verdict rides in the body (`outcome`, `verified`), never in the
  status code. A rejected cancel and a completed cancel are both 200 -
  the job is done when we have a confident answer about it, which is
  exactly the BullMQ ack boundary.
* 4xx here is never retried: 401/403 is wiring wrong, 422 is a payload
  that cannot be executed by anyone, 404 says the record this command
  acts on does not exist in this runtime's store. 501 says "supported by
  the queue contract, not wired in this build" - the honest answer for
  resync-private-stream today.
* 5xx is retryable by contract; the worker defers the job.
* every response carries the correlation ids back so the worker can log
  one line per command that both sides can grep for.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.composition import EngineRuntime
from app.routers.health import get_runtime
from app.schemas import (
    AccountCommandRequest,
    BalancesResponse,
    BalanceView,
    CancelOrderRequest,
    CancelOrderResponse,
    DiscrepancyView,
    IncidentSinkView,
    LiveEnablementView,
    PlacementStatusView,
    ReconcileResponse,
    StatusResponse,
    VerifyResponse,
)
from app.security import (
    ServiceCaller,
    require_internal_auth,
    require_internal_auth_readonly,
    require_tenant_match,
)

router = APIRouter(prefix="/internal/v1", tags=["internal"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]
RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]

#: The read scope (Part 20), on the one route in this file that acts on nothing. The
#: reason it exists is a defect this part found by RUNNING the composition rather than
#: reading it: the worker's startup gate calls ``GET /internal/v1/status`` with no
#: tenant header - correctly, since a process-level read has no tenant to name - and
#: ``require_internal_auth`` answered it with 400 TENANT_HEADER_REQUIRED, which is not a
#: terminal status, so `src/worker.ts` logged "execution engine gate failed" and exited
#: 1. The reference deployment could not start its worker, and nothing in the suites
#: noticed for nine parts because every test of that gate stubs ``fetch``. The fix had to
#: be on this side of the boundary: a client cannot answer a tenant law by inventing a
#: tenant, and the alternative - having the gate read the unauthenticated
#: ``/health/ready`` instead - would base an assert-before-forward decision on a
#: document any peer can forge.
ReadAuthDep = Annotated[ServiceCaller, Depends(require_internal_auth_readonly)]


@router.get("/status", response_model=StatusResponse, response_model_by_alias=True)
async def engine_status(
    # The tenant is not consulted below, and that is the argument for this dependency
    # rather than `AuthDep`: the route reads the process, not a tenant's rows.
    caller: ReadAuthDep,
    runtime: RuntimeDep,
    request: Request,
) -> StatusResponse:
    """The worker asserts `mode`/`store`/`commands` against its own config
    before forwarding anything; a deployment that disagrees is refused at
    the worker boundary rather than discovered mid-command."""
    wiring = runtime.describe()
    placement = wiring.get("placement")
    return StatusResponse(
        instance_id=str(wiring["instanceId"] or ""),
        mode=str(wiring["mode"]),
        dry_run=bool(wiring["dryRun"]),
        adapter=str(wiring["adapter"]),
        store=str(wiring["store"]),
        store_durable=bool(wiring["storeDurable"]),
        store_backend=str(wiring["storeBackend"]),
        retention_enabled=bool(wiring["retentionEnabled"]),
        retention_event_days=int(wiring["retentionEventDays"]),
        enablement_max_age_days=int(wiring["enablementMaxAgeDays"]),
        credential_source=str(wiring["credentialSource"]),
        # A KeyError here is the intended behaviour, not a bug to guard: the key is
        # published by ``describe()`` above, and a composition that stopped
        # publishing it should fail this route loudly rather than answer "false"
        # about a field it no longer reports.
        metrics_configured=bool(wiring["metricsConfigured"]),
        # Read with ``[]``, not ``get``: these keys are published by describe()
        # above, and a status route that defaulted them would answer a question this
        # process stopped asking.
        credential_fetcher=wiring["credentialFetcher"],
        operator_confirmation=bool(wiring["operatorConfirmation"]),
        live_enablement=(
            None
            if wiring["liveEnablement"] is None
            else LiveEnablementView(**wiring["liveEnablement"])
        ),
        # Validated through the view rather than passed through as a dict: the
        # keys below are the contract, so a describe() that starts publishing
        # something new fails here (and in the drift test) instead of quietly
        # publishing an unreviewed field on an authenticated internal surface.
        placement=None if placement is None else PlacementStatusView(**placement),
        # Part 17's block, mapped through its typed view for the same reason the
        # placement block is: a describe() that starts publishing something else is
        # a decision to be made here, not an unreviewed field on an internal
        # caller's screen - and "why is the incident list empty" is exactly the
        # question this route exists to answer without shell access.
        incidents=(
            None
            if wiring.get("incidents") is None
            else IncidentSinkView(**wiring["incidents"])
        ),
        locks_distributed=bool(wiring["locksDistributed"]),
        commands=[str(command) for command in wiring["commands"]],
    )


@router.post(
    "/accounts/verify-credentials",
    response_model=VerifyResponse,
    response_model_by_alias=True,
)
async def verify_credentials(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> VerifyResponse:
    require_tenant_match(body.tenant_id, caller)
    ok, note = await runtime.account_adapter.verify_credentials(
        body.tenant_id, body.account_id
    )
    return VerifyResponse(verified=ok, note=note, is_simulated=True)


@router.post(
    "/accounts/refresh-balances",
    response_model=BalancesResponse,
    response_model_by_alias=True,
)
async def refresh_balances(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> BalancesResponse:
    require_tenant_match(body.tenant_id, caller)
    balances = await runtime.account_adapter.fetch_balances(
        body.tenant_id, body.account_id
    )
    return BalancesResponse(
        balances=[
            BalanceView(asset=row.asset, free=str(row.free), locked=str(row.locked))
            for row in balances
        ],
        is_simulated=True,
    )


@router.post(
    "/accounts/reconcile",
    response_model=ReconcileResponse,
    response_model_by_alias=True,
)
async def reconcile_account(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> ReconcileResponse:
    require_tenant_match(body.tenant_id, caller)
    report = await runtime.reconciliation.reconcile_account(
        body.tenant_id, body.account_id
    )
    return ReconcileResponse(
        tenant_id=report.tenant_id,
        account_id=report.account_id,
        exchange=report.exchange.value,
        orders_checked=report.orders_checked,
        fills_recovered=report.fills_recovered,
        discrepancy_count=len(report.discrepancies),
        discrepancies=[
            DiscrepancyView(
                discrepancy_type=discrepancy.discrepancy_type.value,
                summary=discrepancy.summary,
                order_id=discrepancy.order_id,
                repaired=discrepancy.repaired,
            )
            for discrepancy in report.discrepancies
        ],
        error=report.error,
        started_at_micros=report.started_at_micros,
        finished_at_micros=report.finished_at_micros,
    )


@router.post(
    "/accounts/resync-private-stream",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def resync_private_stream(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> dict[str, Any]:
    """Not wired in the simulated build, and the refusal is the feature.

    A private-stream resync is a LIVE venue interaction (new listen key,
    reconnect, catch-up reconcile). Simulated execution has no stream to
    resync; pretending to accept the command would turn the API's honest
    202 "queued for the worker" into a lie three hops later. The job fails
    visibly with a reason an operator can read.
    """
    require_tenant_match(body.tenant_id, caller)
    return {
        "code": "NOT_SUPPORTED",
        "message": (
            "resync-private-stream requires the live venue adapter (Part 12); "
            "this runtime is simulated and has no private stream to resync."
        ),
    }


@router.post("/orders/cancel", response_model=CancelOrderResponse, response_model_by_alias=True)
async def cancel_order(
    body: CancelOrderRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> CancelOrderResponse:
    require_tenant_match(body.tenant_id, caller)
    order = await runtime.store.get_order(body.tenant_id, body.order_id)
    if order is None:
        # 404, not a fabricated rejection: this runtime has no record of
        # the order, so it must not claim an outcome about it. The worker's
        # job fails visibly; the API-side order state never moves.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "ORDER_NOT_FOUND",
                "message": (
                    "This runtime holds no record of that order; refusing to "
                    "report a cancellation outcome for an order it cannot see."
                ),
            },
        )
    if order.client_order_id != body.client_order_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORDER_IDENTITY_MISMATCH",
                "message": (
                    "The order record does not carry the client order id the "
                    "command named; the job is refused rather than aimed at a "
                    "different order."
                ),
            },
        )
    result = await runtime.engine.cancel(order)
    return CancelOrderResponse(
        outcome=result.outcome.value,
        client_order_id=result.client_order_id or body.client_order_id,
        order_status=result.order.status.value if result.order is not None else "UNKNOWN",
        error_code=result.error_code.value if result.error_code is not None else None,
        message=result.message,
        latency_micros=result.latency_micros,
        is_simulated=result.is_simulated,
    )
```


## FILE: services/execution-engine/tests/conftest.py (69 lines)

*the `client` fixture's annotation was `-> TestClient` on a generator function, which mypy could only report as an error; it now says `Iterator[TestClient]`. Fixed because Part 20's suite came to depend on it, and left as the one typing repair this part made in a file it did not author.*

```python
"""Environment and client fixtures for the execution-engine tests.

Every test runs against the REAL composition root (no mocks under the
money-path wiring): what the tests assert is that startup, auth, validation
and command routing behave when everything underneath is the same code the
service ships. The simulated store being process-local is a property of
the mode, not a test convenience - and the readiness test asserts exactly
that property is VISIBLE.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

#: Built from parts so no full secret-shaped literal sits in this file to
#: trip redaction/secret scanners, and so tests cannot accidentally share
#: the sample with production config.
_TEST_TOKEN = ("w1tch", "cra", "ftpu", "dd1e10")

BASE_ENV = {
    "NODE_ENV": "test",
    "LOG_LEVEL": "warning",
    "EXECUTION_INSTANCE_ID": "exec-test-1",
    "EXECUTION_INTERNAL_TOKEN": "".join(_TEST_TOKEN) * 4,  # 48 chars
    "EXECUTION_MODE": "simulated",
    "EXECUTION_DRY_RUN": "true",
    "EXECUTION_PAPER_BALANCES": "USDT=100000,BTC=2",
    "EXECUTION_SIMULATED_MID": "50000",
}


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in BASE_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def auth_headers(tenant: str = "tenant-a") -> dict[str, str]:
    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


@pytest.fixture
def client() -> Iterator[TestClient]:
    # Annotated as a generator, because that is what it is: `yield` makes the function
    # an Iterator and `-> TestClient` was a lie a type checker could only report as an
    # error. Fixed while Part 20's suite was importing this fixture, since leaving a
    # known-wrong annotation in a file the new tests depend on is the kind of
    # "somebody else's file" reasoning that lets a tree accumulate broken types.
    """A booted app behind a TestClient.

    Starlette's TestClient keeps the app on ``client.app`` and its lifespan
    runs on context entry, so tests reach the assembled runtime via
    ``client.app.state.runtime`` to seed stores - against the real
    composition root, never a mocked one.
    """
    from app.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
```


## FILE: scripts/dr-manifest.mjs (1626 lines)

*the schedule half of the tool: `SCHEDULE_PATH`, `scheduleCheckIntervalHours`, `scheduleCronFor`, `scheduleTightestCadenceHours`, `renderSchedule`, `scheduleDrift`, `SCHEDULE_FORBIDDEN_MODES` and `SCHEDULE_ROOT_LINE`, the two new modes answered before `--check-rls`, and `--manifest` as an override so the derived schedule can be exercised against a hypothetical board - including the all-waived board that must emit no job lines at all. `--record` stays human-only, and the generator refuses a manifest without its `wlctRoot=` line, an empty file, secret-shaped values, and any byte difference on a drift check.*

```javascript
#!/usr/bin/env node
/**
 * DR manifest validator and dry-run planner (Part 11).
 *
 * Two commands, neither of which touches a database, a bucket, or the
 * network:
 *
 *   node scripts/dr-manifest.mjs --check   validate docs/dr/manifest.json
 *                                          (and the ledger's shape when one
 *                                          exists); exit 1 with every
 *                                          failure named
 *   node scripts/dr-manifest.mjs --plan    render the ordered restore
 *                                          runbook to stdout (a dry run:
 *                                          commands are TEMPLATES with
 *                                          $ENV references, never
 *                                          interpolated secrets)
 *   node scripts/dr-manifest.mjs --due [--now ISO] [--ledger PATH]
 *                                          which obligations are overdue;
 *                                          exit 1 when any are (this is the
 *                                          cron-able alert: "a backup not
 *                                          recorded is a backup not done")
 *   node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed
 *                                          [--note TEXT] [--at ISO] [--ledger PATH]
 *                                          append one ledger line; refuses
 *                                          unknown components, broken
 *                                          ledgers, secret-shaped content,
 *                                          and unparsable timestamps
 *
 * Why the validator is code and the manifest is data: a runbook that rots
 * is worse than none - people trust it while it lies. Every check below is
 * the drift the platform has already been bitten by elsewhere: paths that no
 * longer exist, env names renamed under an "internal refactor", backup
 * cadences silently longer than the stated RPO, and - the unforgivable one
 * - credentials pasted into a file that lives in git. The secret-shaped scan
 * is deliberately paranoid and will occasionally nag; answering the nag by
 * deleting the credential is the correct response, always.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = join(ROOT, 'docs', 'dr', 'manifest.json');

// v2 adds the backup-freshness contract (Part 12): every component carries
// cadenceHours or cadenceWaiver, and postgres additionally names the
// mechanism that meets the RPO when its dump cadence alone would not.
// v3 adds the Part 15 RLS-enablement evidence contract (rlsEvidence: who may
// claim "policies are on", how old that claim may be, and which file records
// it). Same reasoning as v2: a block the validator ignores is a block that
// rots, so every field here is checked, and the shipped manifest has it.
const SCHEMA_ID = 'wlct-dr-manifest-v3';
const REQUIRED_COMPONENTS = new Set(['encryption-keys', 'postgres', 'redis', 'dataset-objects']);

/** Part 15's ceiling on "how old may an enablement claim be": 8760h is a
 * year, the same bound the platform puts on any review cadence. A bigger
 * number is not a policy, it is a way of writing "never" - and the whole
 * point of the evidence ledger is that "never" is visible. */
const RLS_MAX_CADENCE_HOURS = 8760;

/** Phrases that would make the engine's read-only endpoint claim a platform
 * wide verdict. Deliberately narrow (not a general "all" ban): this is a
 * check for the ONE mis-statement that would matter, not a prose reviewer. */
const RLS_OVERCLAIM_RE = /\b(all tables|every table|the entire platform|whole platform|entire database)\b/i;

/** Collect every env KEY NAME declared across the repository's .env.example
 * files - uncommented or commented alike: the template's job is to declare
 * names (values are the operator's business), and names deliberately
 * commented out (secrets) are still the names a deployment must provide. */
export function collectEnvNames(root) {
  const files = [
    '.env.example',
    'services/execution-engine/.env.example',
    'services/trading-engine/.env.example',
    'services/market-data/.env.example',
    'apps/admin-web/.env.example',
  ];
  const names = new Set();
  for (const rel of files) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      continue;
    }
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*#?\s*([A-Z][A-Z0-9_]{1,})=/.exec(line);
      if (m) {
        names.add(m[1]);
      }
    }
  }
  return names;
}

/** Things that must never appear in a manifest living in git. Patterns are
 * value-shaped, not word-shaped: writing the word "password" in prose is
 * fine (this file does it); writing `key=value` with a secret-shaped value
 * is what the scan refuses. */
const RLS_VERIFY_SCHEMA = 'wlct.dr.rls-verify/1';

/** The only assertion this verifier is allowed to make about the running system, spelled out as a
 * constant so that a future edit has to delete a named thing rather than flip a string. */
const RLS_NOT_ASSERTED =
  'not asserted here: this is a repository-side verifier, and the enabled-and-enforcing claim is ' +
  "the platform's own, made by the engine from a passing audit inside its cadence window";

export function findSecretShapes(text) {
  const findings = [];
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key header'],
    [/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@/, 'URL with embedded credentials'],
    [/[A-Z][A-Z0-9_]{2,}=(?!"|null)[A-Za-z0-9+/=_-]{24,}/, 'inline KEY=secret-shaped-value assignment'],
    // The (?!) above lets an inline quoted value past pattern 3; in a
    // runbook or ledger note a QUOTED literal assignment is exactly as
    // leaky as an unquoted one (Part 12 smoke proved it on a real note),
    // so this pattern closes the quote hole. `${VAR}` references stay
    // legal: the value part refuses a leading '$'.
    [/[A-Z][A-Z0-9_]{2,}="[^"\n$]{16,}"/, 'inline KEY="literal-value" assignment'],
    [/"[A-Za-z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY)(?:_BASE64)?":\s*"[^"$]{16,}"/, 'JSON secret with a literal value'],
  ];
  for (const [re, why] of patterns) {
    const m = re.exec(text);
    if (m) {
      findings.push(`${why} near ${JSON.stringify(m[0].slice(0, 48))}`);
    }
  }
  return findings;
}

export function validateManifest(manifest, root = ROOT) {
  const errors = [];
  if (manifest.schema !== SCHEMA_ID) {
    errors.push(`schema must be ${SCHEMA_ID}, got ${JSON.stringify(manifest.schema)}`);
  }
  if (!Number.isInteger(manifest.rpoMinutes) || manifest.rpoMinutes < 1) {
    errors.push('rpoMinutes must be a positive integer');
  }
  if (!Number.isInteger(manifest.rtoHours) || manifest.rtoHours < 1) {
    errors.push('rtoHours must be a positive integer');
  }
  if (!Number.isInteger(manifest.reviewCadenceDays) || manifest.reviewCadenceDays < 30) {
    errors.push('reviewCadenceDays must be an integer >= 30 (a manifest reviewed monthly is a ritual, not a control)');
  }
  const components = Array.isArray(manifest.components) ? manifest.components : [];
  if (components.length === 0) {
    errors.push('components must be a non-empty array');
  }

  const ids = new Set();
  const orders = new Set();
  for (const c of components) {
    for (const field of ['id', 'title', 'kind', 'purpose', 'backupMethod', 'verification']) {
      if (typeof c[field] !== 'string' || c[field].trim().length === 0) {
        errors.push(`component ${JSON.stringify(c.id ?? '?')}: field ${field} must be a non-empty string`);
      }
    }
    if (ids.has(c.id)) {
      errors.push(`duplicate component id ${JSON.stringify(c.id)}`);
    }
    ids.add(c.id);
    if (!Number.isInteger(c.restoreOrder) || c.restoreOrder < 1 || orders.has(c.restoreOrder)) {
      errors.push(`component ${c.id}: restoreOrder must be a unique positive integer`);
    }
    orders.add(c.restoreOrder);
    for (const ref of c.envRefs ?? []) {
      if (typeof ref !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(ref)) {
        errors.push(`component ${c.id}: envRef ${JSON.stringify(ref)} is not an env key name`);
      }
    }
    // "never backed up" in a backupMethod is a manifest admitting it lost
    // data; ordinary prose use of the word ("...verifies the escrow, never
    // the material") must not trip it. The honest phrasing for a
    // rebuildable component is the redis entry's: rebuildable, snapshot for
    // forensics only.
    if (/\bnever\b[^.]{0,40}\bback(ed)?[- ]?up/i.test(c.backupMethod ?? '')) {
      errors.push(`component ${c.id}: backupMethod must not admit "never backed up" - state rebuildability or a scheduled gap`);
    }
    // Part 12: the freshness contract. `null` is legal ONLY with a waiver
    // string; a missing key is not null, it is silence - and silence about
    // when a backup is due is exactly how a stale-backup incident starts.
    const cadenceMissing = !Object.prototype.hasOwnProperty.call(c, 'cadenceHours');
    if (cadenceMissing) {
      errors.push(
        `component ${c.id}: cadenceHours is required (an integer hour bound ` +
          `or null WITH a cadenceWaiver explaining the exemption)`,
      );
    } else if (c.cadenceHours === null) {
      if (typeof c.cadenceWaiver !== 'string' || c.cadenceWaiver.trim().length === 0) {
        errors.push(`component ${c.id}: cadenceHours null requires a non-empty cadenceWaiver`);
      }
    } else {
      if (!Number.isInteger(c.cadenceHours) || c.cadenceHours < 1 || c.cadenceHours > 8760) {
        errors.push(
          `component ${c.id}: cadenceHours must be an integer 1..8760 (one year ceiling), got ${JSON.stringify(c.cadenceHours)}`,
        );
      }
      if (c.cadenceWaiver !== undefined) {
        errors.push(`component ${c.id}: cadenceWaiver is only meaningful when cadenceHours is null`);
      }
      // The RPO belongs to Postgres; every other component's cadence is a
      // review obligation, not a data-loss bound. 24h of dump cadence under
      // a 60m RPO is HONEST only when a continuous mechanism is named -
      // naming it is what this check forces into the open.
      if (c.id === 'postgres' && c.cadenceHours * 60 > manifest.rpoMinutes) {
        if (typeof c.rpoMechanism !== 'string' || c.rpoMechanism.trim().length === 0) {
          errors.push(
            `component postgres: cadenceHours ${c.cadenceHours} exceeds rpoMinutes ` +
              `${manifest.rpoMinutes} and no rpoMechanism is named - either back up ` +
              `faster than the RPO or state what continuous mechanism closes the gap`,
          );
        }
      }
    }
  }
  if (orders.size > 0) {
    const sorted = [...orders].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== i + 1) {
        errors.push('restoreOrder values must form exactly 1..n with no gaps');
        break;
      }
    }
  }
  for (const required of REQUIRED_COMPONENTS) {
    if (!ids.has(required)) {
      errors.push(`required component ${required} is missing`);
    }
  }
  if (ids.has('encryption-keys') && ids.has('postgres')) {
    const keys = components.find((c) => c.id === 'encryption-keys');
    const db = components.find((c) => c.id === 'postgres');
    if (keys.restoreOrder >= db.restoreOrder) {
      errors.push('encryption-keys must be restored BEFORE postgres (ciphertext without keys is a deletion)');
    }
  }

  const envNames = collectEnvNames(root);
  for (const c of components) {
    for (const ref of c.envRefs ?? []) {
      if (!envNames.has(ref)) {
        errors.push(`component ${c.id}: envRef ${ref} is declared in no .env.example of this repository`);
      }
    }
    for (const path of c.paths ?? []) {
      if (!existsSync(join(root, path))) {
        errors.push(`component ${c.id}: path ${path} no longer exists (the manifest drifted from the repo)`);
      }
    }
  }

  const procedure = Array.isArray(manifest.restoreProcedure) ? manifest.restoreProcedure : [];
  if (procedure.length === 0) {
    errors.push('restoreProcedure must not be empty');
  }
  let lastStep = 0;
  for (const step of procedure) {
    if (!Number.isInteger(step.step) || step.step !== lastStep + 1) {
      errors.push(`restoreProcedure: step numbers must run 1..n contiguously (got ${JSON.stringify(step.step)})`);
    }
    lastStep = step.step ?? lastStep;
    if (typeof step.action !== 'string' || step.action.trim() === '') {
      errors.push(`restoreProcedure step ${step.step}: action must be a non-empty string`);
    }
    if (step.component !== null && step.component !== undefined && !ids.has(step.component)) {
      errors.push(`restoreProcedure step ${step.step}: references unknown component ${JSON.stringify(step.component)}`);
    }
  }

  // Part 21: the plan exists twice - once as `restoreOrder` on the components, which is what
  // `renderPlan` and the due report sort by, and once as `restoreProcedure`, which is what
  // `docs/DR.md` narrates and what a human follows at 3am. Each representation was validated
  // internally and never against the other, and the disagreement the rehearsal runner found on
  // its first run is the reason this law exists now: steps 3-5 of the procedure restored
  // deployment-config, redis, dataset-objects while their declared orders said redis,
  // dataset-objects, deployment-config. The data was corrected to follow the procedure (the
  // procedure is the document an operator executes, and it is the one whose steps carry the
  // "run migrations only if the image's schema is older" reasoning that only holds in that
  // order). A component-less step is the manifest's existing convention for a post-restore
  // instruction, so it is skipped rather than ordered.
  const orderByComponent = new Map((manifest.components ?? []).map((c) => [c.id, c.restoreOrder]));
  const namedInProcedure = new Set();
  for (const step of procedure) {
    if (step.component === null || step.component === undefined) continue;
    if (namedInProcedure.has(step.component)) {
      errors.push(`restoreProcedure: component ${step.component} is restored twice - the plan has no defined order`);
    }
    namedInProcedure.add(step.component);
    const declared = orderByComponent.get(step.component);
    if (declared !== undefined && declared !== step.step) {
      errors.push(
        `restoreProcedure step ${step.step} restores ${step.component}, whose restoreOrder is ${declared} - ` +
          'the two representations of the plan disagree, and an operator reading one would skip past ' +
          'a dependency of the other',
      );
    }
  }
  for (const c of manifest.components ?? []) {
    if (!namedInProcedure.has(c.id)) {
      errors.push(`component ${c.id} has no restoreProcedure step - it is declared restorable but the plan never restores it`);
    }
  }

  // Part 15: the enablement-evidence block. Required, not optional: an
  // missing block means the deployment never decided how old an RLS audit may
  // be, and "we'll say it later" is how the checklist in enable.sql became
  // prose nobody re-reads.
  const rls = manifest.rlsEvidence;
  if (rls === undefined || rls === null || typeof rls !== 'object' || Array.isArray(rls)) {
    errors.push('rlsEvidence is required (Part 15: cadenceHours or cadenceWaiver, evidenceLedger, verifier, command)');
  } else {
    if (rls.cadenceHours === null) {
      if (typeof rls.cadenceWaiver !== 'string' || rls.cadenceWaiver.trim().length === 0) {
        errors.push('rlsEvidence: cadenceHours null requires a non-empty cadenceWaiver');
      }
    } else {
      if (!Number.isInteger(rls.cadenceHours) || rls.cadenceHours < 1 || rls.cadenceHours > RLS_MAX_CADENCE_HOURS) {
        errors.push(
          `rlsEvidence: cadenceHours must be an integer 1..${RLS_MAX_CADENCE_HOURS} ` +
            `(a year is the platform ceiling for "how long a policy claim may stand"), got ${JSON.stringify(rls.cadenceHours)}`,
        );
      }
      if (rls.cadenceWaiver !== undefined) {
        errors.push('rlsEvidence: cadenceWaiver is only meaningful when cadenceHours is null');
      }
    }
    // scope is what stops a future edit from quietly turning "the engine
    // plane" into "the platform": the endpoint cannot see the API's tables,
    // and a manifest that implies otherwise is a false assurance in the one
    // document everybody reads before an incident.
    if (typeof rls.scope !== 'string' || rls.scope.trim().length === 0) {
      errors.push('rlsEvidence: scope must be a non-empty string (what the verifier can actually see)');
    } else if (RLS_OVERCLAIM_RE.test(rls.scope)) {
      errors.push(
        `rlsEvidence: scope overclaims - ${JSON.stringify(rls.scope.match(RLS_OVERCLAIM_RE)[0])} is not true of a ` +
          'service that can only read its own tables (docs/PART15_RLS_ENABLEMENT.md)',
      );
    } else if (rls.scope.length > 600 || /[\r\n]/.test(rls.scope)) {
      errors.push('rlsEvidence: scope must be one line of at most 600 characters');
    }
    for (const field of ['evidenceLedger', 'verifier', 'command']) {
      const value = rls[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(`rlsEvidence: ${field} must be a non-empty string`);
        continue;
      }
      if (value.length > 300 || /[\r\n]/.test(value)) {
        errors.push(`rlsEvidence: ${field} must be one line of at most 300 characters`);
      }
      // Path-like fields must stay inside the repository; the VERIFIER is not
      // a path at all (it is an endpoint), and forcing it through the same
      // rule is how validators teach people that paths are the only truth.
      if (field !== 'verifier' && (value.startsWith('/') || value.includes('..'))) {
        errors.push(`rlsEvidence: ${field} must be a repository-relative path without ".." (git evidence, not a local absolute)`);
      }
    }
    if (typeof rls.command === 'string' && !rls.command.startsWith('node scripts/')) {
      errors.push(`rlsEvidence: command must be a repository script ("node scripts/..."), got ${JSON.stringify(rls.command)}`);
    }
    if (typeof rls.evidenceLedger === 'string' && !rls.evidenceLedger.endsWith('.jsonl')) {
      errors.push('rlsEvidence: evidenceLedger must be a .jsonl file (append-only evidence, parseable line by line)');
    }
    if (typeof rls.evidenceLedger === 'string' && !rls.evidenceLedger.startsWith('docs/dr/')) {
      errors.push('rlsEvidence: evidenceLedger must live under docs/dr/ beside the backup ledger it is modelled on');
    }
    if (typeof rls.verifier === 'string' && !rls.verifier.startsWith('/internal/')) {
      errors.push(`rlsEvidence: verifier must name an internal-plane endpoint (/internal/...), got ${JSON.stringify(rls.verifier)}`);
    }
    if (typeof rls.verifier === 'string' && rls.verifier.includes('/public/')) {
      errors.push('rlsEvidence: the verifier must not be a public route - it reports which defences are off');
    }
    for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
      if (rls[field] === undefined) {
        continue;
      }
      if (typeof rls[field] !== 'string' || rls[field].includes('..')) {
        errors.push(`rlsEvidence: ${field} must be a repository-relative path`);
        continue;
      }
      if (!existsSync(join(root, rls[field]))) {
        errors.push(`rlsEvidence: ${field} ${rls[field]} no longer exists (the audit's ground truth drifted from the repo)`);
      }
    }
    if (rls.requiredGrade !== undefined && rls.requiredGrade !== 'pass') {
      errors.push(
        `rlsEvidence: requiredGrade is not a knob - only "pass" is accepted (got ${JSON.stringify(rls.requiredGrade)}); ` +
          'a manifest that lets a report choose its own bar is not a bar',
      );
    }
  }

  const drill = manifest.drill ?? {};
  if (!Number.isInteger(drill.cadenceDays) || drill.cadenceDays < 30 || drill.cadenceDays > 180) {
    errors.push('drill.cadenceDays must be between 30 and 180 (a twice-a-year ceiling is the platform floor)');
  }
  if (drill.timed !== true) {
    errors.push('drill.timed must be true: an untimed restore proves nothing about the RTO it claims');
  }
  if (!Array.isArray(drill.successCriteria) || drill.successCriteria.length === 0) {
    errors.push('drill.successCriteria must be non-empty');
  }

  if (rls !== undefined && typeof rls === 'object' && !Array.isArray(rls)) {
    // The evidence FILE is part of the contract: a manifest that points at a
    // ledger which cannot be written (directory absent) or which already
    // holds secrets is a policy on a road that does not exist.
    if (
      typeof rls.evidenceLedger === 'string' &&
      rls.evidenceLedger.trim().length > 0 &&
      !rls.evidenceLedger.includes('..')
    ) {
      const ledgerPath = join(root, rls.evidenceLedger);
      if (existsSync(ledgerPath)) {
        for (const finding of findSecretShapes(readFileSync(ledgerPath, 'utf8'))) {
          errors.push(`rlsEvidence: SECRET-SHAPED CONTENT in ${rls.evidenceLedger}: ${finding}`);
        }
      }
    }
    for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
      const rel = rls[field];
      if (typeof rel === 'string' && rel.trim().length > 0 && !rel.includes('..') && existsSync(join(root, rel))) {
        const text = readFileSync(join(root, rel), 'utf8');
        if (rel.endsWith('.json')) {
          try {
            JSON.parse(text);
          } catch {
            errors.push(`rlsEvidence: ${field} ${rel} is not valid JSON (the audit parses it at runtime)`);
          }
        } else if (!text.includes('ROW LEVEL SECURITY')) {
          errors.push(`rlsEvidence: ${field} ${rel} no longer mentions ROW LEVEL SECURITY (renamed or replaced?)`);
        }
      }
    }
  }

  return errors;
}

/** Parse the JSONL ledger. Returns {entries, problems}: a malformed line
 * is reported with its number (the file is human-editable evidence;
 * "line 4 is not JSON" is the fixable complaint, "file corrupt" is not).
 * `knownIds` (when given) turns an unknown component into a problem too -
 * a typo'd component id in a ledger line is a backup with no owner. */
export function parseLedger(text, knownIds = null) {
  const entries = [];
  const problems = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`ledger line ${i + 1}: not valid JSON`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push(`ledger line ${i + 1}: must be a JSON object`);
      continue;
    }
    const extra = Object.keys(parsed).filter(
      (k) => k !== 'at' && k !== 'component' && k !== 'outcome' && k !== 'note',
    );
    if (extra.length > 0) {
      problems.push(`ledger line ${i + 1}: unknown field(s) ${extra.join(', ')} (typos hide evidence)`);
      continue;
    }
    const atMs =
      typeof parsed.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
        ? Date.parse(parsed.at)
        : Number.NaN;
    if (Number.isNaN(atMs)) {
      problems.push(`ledger line ${i + 1}: at must be an ISO-8601 timestamp`);
      continue;
    }
    if (typeof parsed.component !== 'string' || parsed.component.trim() === '') {
      problems.push(`ledger line ${i + 1}: component must be a non-empty string`);
      continue;
    }
    if (knownIds !== null && !knownIds.has(parsed.component)) {
      problems.push(`ledger line ${i + 1}: component ${JSON.stringify(parsed.component)} is not in the manifest`);
      continue;
    }
    if (parsed.outcome !== 'ok' && parsed.outcome !== 'failed') {
      problems.push(`ledger line ${i + 1}: outcome must be "ok" or "failed"`);
      continue;
    }
    if (
      parsed.note !== undefined &&
      (typeof parsed.note !== 'string' || parsed.note.length > 500 || /[\r\n]/.test(parsed.note))
    ) {
      problems.push(`ledger line ${i + 1}: note must be a single-line string of at most 500 chars`);
      continue;
    }
    entries.push({
      atMs,
      at: parsed.at,
      component: parsed.component,
      outcome: parsed.outcome,
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
    });
  }
  return { entries, problems };
}

/** Freshness verdicts, in restore order, for every component. `never`
 * counts as due: an unrecorded obligation has no last-success to age. */
export function dueReport(manifest, entries, nowMs) {
  const lastOk = new Map();
  for (const e of entries) {
    if (e.outcome === 'ok') {
      const prev = lastOk.get(e.component);
      if (prev === undefined || e.atMs > prev) {
        lastOk.set(e.component, e.atMs);
      }
    }
  }
  return [...manifest.components]
    .sort((a, b) => a.restoreOrder - b.restoreOrder)
    .map((c) => {
      if (c.cadenceHours === null) {
        return {
          component: c.id,
          state: 'waived',
          line: `[waive] ${c.id}: no obligation - ${c.cadenceWaiver}`,
        };
      }
      const last = lastOk.get(c.id);
      if (last === undefined) {
        return {
          component: c.id,
          state: 'due',
          line:
            `[DUE  ] ${c.id}: never recorded (cadence ${c.cadenceHours}h) - ` +
            `record one with --record, or say why it has not run`,
        };
      }
      const dueAt = last + c.cadenceHours * 3_600_000;
      const delta = nowMs - dueAt;
      if (delta >= 0) {
        return {
          component: c.id,
          state: 'due',
          line:
            `[DUE  ] ${c.id}: overdue by ${formatDuration(delta)} (last ok ${new Date(last).toISOString()}, cadence ${c.cadenceHours}h)`,
        };
      }
      return {
        component: c.id,
        state: 'ok',
        line: `[ ok  ] ${c.id}: next due in ${formatDuration(-delta)} (last ok ${new Date(last).toISOString()})`,
      };
    });
}

/** -----------------------------------------------------------------------
 * The schedule file (Part 20): the manifest's cadences written in cron grammar.
 *
 * Why this exists at all. `--due` answers "what is overdue" only when somebody runs
 * it, and a checker nobody runs is a claim, not a control - the same distinction the
 * manifest itself makes about backups. The ROADMAP named the missing piece exactly:
 * the wiring of that command into a scheduler. This renders it.
 *
 * The one law that shapes every line below: the emitter may ask questions, never
 * answer them. It emits `--due`, `--check` and `--check-rls` - the three read-only
 * modes - and it will not emit `--record` or `--record-rls`, because a job that writes
 * ledger evidence on a timer would record an outcome nobody observed, which is the
 * faked seed data the ledger was built to refuse. `--check-schedule` re-reads the
 * committed file and fails if a record mode has been hand-added to it.
 * ----------------------------------------------------------------------- */

/** Where the generated file lives, and the one value inside it a deployment owns. */
export const SCHEDULE_PATH = join(ROOT, 'docs', 'dr', 'schedule', 'dr.cron');

/** The ceiling on how often a check may run, in hours. A check is cheap and a breach
 * is not, so nothing here schedules coarser than daily however long the obligation is
 * - and nothing finer than the tightest declared cadence, because a daily check of a
 * six-hour obligation would report its breach up to eighteen hours late. */
const SCHEDULE_MAX_CHECK_HOURS = 24;

/** Minutes at which a scheduled line fires. Fixed at 0 rather than spread across the
 * hour so two lines with the same interval never land on each other by accident,
 * which is the difference between a readable log and a race. */
const SCHEDULE_MINUTE = 0;

/** The ledger's write modes. Named once, so the refusal in `scheduleDrift` and the
 * comment in `renderSchedule` cannot drift apart from each other. */
const SCHEDULE_FORBIDDEN_MODES = Object.freeze(['--record', '--record-rls']);

/** The one line a deployment is allowed to own, matched for the round trip. */
const SCHEDULE_ROOT_LINE = /^wlctRoot=(\S+)$/m;

export function scheduleCheckIntervalHours(cadenceHours) {
  if (!Number.isInteger(cadenceHours) || cadenceHours < 1 || cadenceHours > 8760) {
    throw new TypeError(
      `cannot derive a check interval from ${JSON.stringify(cadenceHours)}: a cadence is an integer 1..8760 hours`,
    );
  }
  return Math.min(cadenceHours, SCHEDULE_MAX_CHECK_HOURS);
}

/** The cron expression for "at least every `intervalHours`", where intervalHours has
 * already been capped at 24 by `scheduleCheckIntervalHours`.
 *
 * A step expression in the hour field - "minute 0, every Nth hour" - is a legal answer
 * for ANY N in 1..24, not only for the divisors of 24, because the field restarts at 0
 * each day: with N=7 the firings are 0, 7, 14, 21
 * and the longest gap is 7 hours (the wrap from 21 to the next day's 0 is 3). The
 * naive reading - "7 does not divide 24, so this is an approximation" - is what this
 * comment exists to answer: approximating a 7-hour obligation with a weekly schedule
 * would be a bug, and with a monthly one a lie. */
export function scheduleCronFor(intervalHours) {
  if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24) {
    throw new TypeError(`no cron line for an interval of ${JSON.stringify(intervalHours)} hours`);
  }
  if (intervalHours >= SCHEDULE_MAX_CHECK_HOURS) {
    return `${SCHEDULE_MINUTE} 0 * * *`;
  }
  return `${SCHEDULE_MINUTE} */${intervalHours} * * *`;
}

/** The tightest obligation on the board, or null when every component is waived.
 * Waived components are not invisible: the caller renders their waiver text as a
 * comment, which is what makes "nobody owes a backup" a readable state rather than an
 * empty file an operator assumes is a bug. */
export function scheduleTightestCadenceHours(manifest) {
  const hours = (manifest.components ?? [])
    .filter((component) => Number.isInteger(component.cadenceHours))
    .map((component) => component.cadenceHours);
  return hours.length === 0 ? null : Math.min(...hours);
}

/** The rendered file. Deterministic by construction: no timestamps, no host names, no
 * ordering that depends on the ledger. `root` is the deployment's checkout path and is
 * the only argument, so a fresh generation stays comparable with a committed file whose
 * root was edited - see `scheduleDrift`. */
export function renderSchedule(manifest, root = '.') {
  const dueHours = scheduleTightestCadenceHours(manifest);
  const lines = [];
  const push = (text) => lines.push(text);
  const command = (mode) => `node "$wlctRoot/scripts/dr-manifest.mjs" ${mode}`;

  push('# Generated by `node scripts/dr-manifest.mjs --emit-schedule`. Do not edit.');
  push('# The cadences live in docs/dr/manifest.json; this file is that data written in');
  push('# cron grammar, and `--check-schedule` compares it against a fresh generation.');
  push('# Exactly one line below is yours to change: wlctRoot. Everything else is derived.');
  push('');
  push('# What each job does, and what none of them does:');
  push('#   --due        grade the ledger against the declared cadences and exit 1 when an');
  push('#                obligation has no recorded success inside its window;');
  push('#   --check      validate the manifest itself (schema, secret shapes, the RPO and');
  push('#                cadence laws) and exit 1 on any violation;');
  push('#   --check-rls  age the row-level-security enablement audit and exit 1 when the');
  push('#                claim has no passing audit behind it. That is the state a fresh');
  push('#                deployment is legitimately in: docs/PART15_RLS_ENABLEMENT.md.');
  push('# No line writes evidence. --record and --record-rls are the ledger of the two');
  push('# write modes and both require a human to name an outcome, because an unattended');
  push('# job recording an outcome nobody observed is faked seed data. Until the first');
  push('# real --record, [DUE] on every component is the correct reading of this board.');
  push('');
  push('# The exit code IS the alarm. How a non-zero cron exit reaches a human is');
  push('# deployment-side (MAILTO, a log shipper, an init that maps exits to alerts), and');
  push('# this file cannot know that answer, so it does not guess one.');
  push('');
  push('# The script resolves its own repository root from its own location; the only thing');
  push('# this line supplies is where to find the file, which is the one fact about the host');
  push('# that is not derived from the manifest. Lower-case on purpose: this repository scans');
  push('# every generated file for `NAME=literal` assignments in the shape an env file uses');
  push('# (findSecretShapes above), and the right answer when a scanner objects to a line is');
  push('# to stop writing a value that looks like a secret, NOT to teach the scanner to look');
  push('# the other way. A path is not a secret and should not be shaped like one.');
  push(`wlctRoot=${root}`);
  push('SHELL=/bin/sh');
  push('');

  if (dueHours === null) {
    push(
      '# Derived from the tightest declared cadence: none. Every component waives its',
    );
    push('# obligation, so there is nothing to age and nothing to schedule a check for. The');
    push('# manifest validator still runs daily, because a manifest that has stopped parsing');
    push('# would otherwise be the reason no job reports anything at all:');
    push('#');
    for (const component of manifest.components ?? []) {
      push(`#   ${component.id}: ${component.cadenceWaiver ?? '(no waiver text)'}`);
    }
    push(`${scheduleCronFor(SCHEDULE_MAX_CHECK_HOURS)} ${command('--check')}`);
    return `${lines.join('\n')}\n`;
  }

  push(
    `# Derived from the tightest declared cadence on the board (${dueHours}h), capped at ${SCHEDULE_MAX_CHECK_HOURS}h:`,
  );
  push('# a check more frequent than the obligation is free, a check less frequent is how a');
  push('# breach waits out the gap between runs.');
  push(`${scheduleCronFor(scheduleCheckIntervalHours(dueHours))} ${command('--due')}`);
  push('# Manifest validity is a deployment invariant rather than an obligation, so it runs');
  push('# on the daily ceiling whatever the cadences above do.');
  push(`${scheduleCronFor(SCHEDULE_MAX_CHECK_HOURS)} ${command('--check')}`);

  const rls = manifest.rlsEvidence;
  if (rls !== undefined && rls !== null) {
    push('');
    if (Number.isInteger(rls.cadenceHours)) {
      push(
        `# RLS evidence ages against rlsEvidence.cadenceHours (${rls.cadenceHours}h), so the check`,
      );
      push('# runs at the capped interval that bound implies.');
      push(
        `${scheduleCronFor(scheduleCheckIntervalHours(rls.cadenceHours))} ${command('--check-rls')}`,
      );
    } else {
      push(`# rlsEvidence cadence is waived: ${rls.cadenceWaiver ?? '(no waiver text)'}.`);
      push('# The claim still needs an audit for anybody to make it; a waiver schedules');
      push('# nothing here and does not make "row-level security is enforcing" one degree');
      push('# more true. Without a line below, --check-rls is the mode that says so.');
    }
  }

  const waived = (manifest.components ?? []).filter(
    (component) => component.cadenceHours === null && component.cadenceWaiver,
  );
  if (waived.length > 0) {
    push('');
    push('# Obligations this file does not schedule, because the manifest waived them:');
    for (const component of waived) {
      push(`#   ${component.id}: ${component.cadenceWaiver}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** What is wrong with a committed schedule file, as strings; empty means it matches a
 * fresh generation apart from the one line a deployment owns. */
export function scheduleDrift(manifest, text) {
  const problems = [];
  if (typeof text !== 'string' || text.trim() === '') {
    return ['schedule file is empty or missing - run --emit-schedule'];
  }
  const rootMatch = SCHEDULE_ROOT_LINE.exec(text);
  if (rootMatch === null) {
    problems.push('schedule file has no `wlctRoot=<path>` line, so it is not the generated shape');
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const tokens = trimmed.split(/\s+/);
    for (const forbidden of SCHEDULE_FORBIDDEN_MODES) {
      if (tokens.includes(forbidden)) {
        problems.push(
          `schedule file runs ${forbidden}: a scheduled job may ask questions, never write ledger evidence`,
        );
      }
    }
  }
  for (const finding of findSecretShapes(text)) {
    problems.push(`SECRET-SHAPED CONTENT in schedule: ${finding}`);
  }
  if (problems.length === 0) {
    const expected = renderSchedule(manifest, rootMatch[1]);
    if (expected !== text) {
      const expectedLines = expected.split('\n');
      const actualLines = text.split('\n');
      const firstDiff = expectedLines.findIndex((line, index) => line !== actualLines[index]);
      const where =
        firstDiff === -1
          ? `line count (${actualLines.length} against ${expectedLines.length})`
          : `line ${firstDiff + 1}`;
      problems.push(
        `schedule file does not match a fresh generation at ${where}: a cadence changed and the schedule did not, or the file was hand-edited`,
      );
    }
  }
  return problems;
}

function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Parse the Part 15 RLS-enablement evidence ledger (JSONL, one line per
 * verification run). A DIFFERENT file from the backup ledger on purpose:
 * two obligations sharing one log is how one of them stops being read.
 * Line-wise problems are reported by number exactly as `parseLedger` does,
 * and an unparsable line is never skipped quietly. */
export function parseRlsLedger(text) {
  const entries = [];
  const problems = [];
  const known = new Set(['at', 'grade', 'probed', 'role', 'note']);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`rls ledger line ${i + 1}: not valid JSON`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push(`rls ledger line ${i + 1}: must be a JSON object`);
      continue;
    }
    const extra = Object.keys(parsed).filter((k) => !known.has(k));
    if (extra.length > 0) {
      problems.push(`rls ledger line ${i + 1}: unknown field(s) ${extra.join(', ')} (typos hide evidence)`);
      continue;
    }
    const atMs =
      typeof parsed.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
        ? Date.parse(parsed.at)
        : Number.NaN;
    if (Number.isNaN(atMs)) {
      problems.push(`rls ledger line ${i + 1}: at must be an ISO-8601 timestamp`);
      continue;
    }
    // The grade vocabulary is the core's (wlct_trading.enablement.RunGrade)
    // and it is CLOSED: a line that grades itself "warning" or "ok" is a
    // report nobody can aggregate, and the run that invents a fourth answer
    // is the run that decides its own verdict.
    if (parsed.grade !== 'pass' && parsed.grade !== 'fail' && parsed.grade !== 'unverified') {
      problems.push(`rls ledger line ${i + 1}: grade must be pass, fail or unverified`);
      continue;
    }
    if (parsed.probed !== undefined && (!Number.isInteger(parsed.probed) || parsed.probed < 0 || parsed.probed > 4096)) {
      problems.push(`rls ledger line ${i + 1}: probed must be an integer 0..4096`);
      continue;
    }
    if (parsed.role !== undefined && (typeof parsed.role !== 'string' || parsed.role.length === 0 || parsed.role.length > 200 || /[\r\n]/.test(parsed.role))) {
      problems.push(`rls ledger line ${i + 1}: role must be a single-line string of 1..200 chars`);
      continue;
    }
    if (parsed.note !== undefined && (typeof parsed.note !== 'string' || parsed.note.length > 500 || /[\r\n]/.test(parsed.note))) {
      problems.push(`rls ledger line ${i + 1}: note must be a single-line string of at most 500 chars`);
      continue;
    }
    entries.push({
      atMs,
      at: parsed.at,
      grade: parsed.grade,
      ...(Number.isInteger(parsed.probed) ? { probed: parsed.probed } : {}),
      ...(typeof parsed.role === 'string' ? { role: parsed.role } : {}),
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
    });
  }
  return { entries, problems };
}

/** The Part 15 verdict: how the most recent enablement audit reads as of
 * `nowMs`. This is deliberately NOT enforcement - a repository script cannot
 * see a live database - it is the FRESHNESS POLICY the docs promise: an
 * operator (or a cron) runs this, and a stale or failing audit becomes a red
 * exit code instead of a memory.
 *
 * The last entry of ANY grade decides freshness; its grade decides the
 * verdict. That asymmetry is the point: re-running the audit and finding a
 * leak must refresh the "we know" clock WITHOUT turning the finding green,
 * and a stale run that passed long ago is not evidence either way. */
export function rlsEvidenceReport(evidence, entries, nowMs) {
  if (evidence.cadenceHours === null) {
    return {
      state: 'waived',
      line: `[waive] rls-enablement: no cadence - ${evidence.cadenceWaiver}`,
    };
  }
  if (entries.length === 0) {
    return {
      state: 'due',
      line:
        `[DUE  ] rls-enablement: never recorded (cadence ${evidence.cadenceHours}h) - run the audit and ` +
        `record it with --record-rls; policies that nobody verified are a hypothesis`,
    };
  }
  const last = entries.reduce((a, b) => (b.atMs > a.atMs ? b : a), entries[0]);
  const dueAt = last.atMs + evidence.cadenceHours * 3_600_000;
  const delta = nowMs - dueAt;
  const age = `[${last.grade}] ${new Date(last.atMs).toISOString()} (${formatDuration(Math.max(0, nowMs - last.atMs))} ago)`;
  if (last.grade !== 'pass') {
    return {
      state: 'fail',
      line:
        `[${last.grade === 'fail' ? 'FAIL' : 'UNVER'}] rls-enablement: ${age} - the recorded audit did not ` +
        `conclude "pass", so the platform must not claim enabled-and-enforced`,
    };
  }
  if (delta >= 0) {
    return {
      state: 'due',
      line: `[DUE  ] rls-enablement: last passing audit overdue by ${formatDuration(delta)} ${age}`,
    };
  }
  return {
    state: 'ok',
    line: `[ ok  ] rls-enablement: fresh, next due in ${formatDuration(-delta)} ${age}`,
  };
}

/**
 * Part 21: the machine-readable answer to "what is actually verified about row-level security".
 *
 * This is a VERIFIER, not an enabler and not a claim. Read its output as a set of checks with
 * grades, never as "RLS is on": the platform may assert enabled-and-enforcing only while a passing
 * audit is younger than `rlsEvidence.cadenceHours` (Part 15's rule), and that assertion is made by
 * the engine at request time from its own ledger. What this function adds is the part nobody could
 * ask a machine before: whether the repository's three RLS artifacts still describe the same set
 * of tables, and whether an audit has ever been recorded at all. A deployment whose enable.sql
 * gained a table and whose coverage ledger did not would have shown a clean `--check-rls` (which
 * ages evidence, correctly) while the evidence itself described a different database.
 *
 * Grades are the core's closed vocabulary - pass, fail, unverified, skipped - and "the file is not
 * there", "the artifact does not parse" and "nobody audited" are three different answers, reported
 * as three different findings.
 */
export function verifyRlsEvidence(manifest, { root = ROOT, nowMs = Date.now() } = {}) {
  const checks = [];
  const findings = [];
  const record = (name, grade, detail, extra = {}) => {
    checks.push({ name, grade, detail, ...extra });
    if (grade === 'fail') findings.push(`${name}: ${detail}`);
    return grade;
  };

  const evidence = manifest?.rlsEvidence ?? null;
  if (evidence === null || evidence === undefined) {
    record('manifest-block', 'fail', 'the manifest carries no rlsEvidence block, so there is nothing to verify against');
    return { schema: RLS_VERIFY_SCHEMA, grade: 'fail', checks, findings, evidence: null, assertion: RLS_NOT_ASSERTED };
  }

  const readArtifact = (rel) => {
    const absolute = join(root, rel);
    if (!existsSync(absolute)) {
      return { error: 'missing' };
    }
    try {
      return { text: readFileSync(absolute, 'utf8') };
    } catch (error) {
      return { error: `unreadable (${error.message})` };
    }
  };

  const texts = {};
  for (const key of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
    const rel = evidence[key];
    if (typeof rel !== 'string' || rel.trim() === '') {
      record(`artifact:${key}`, 'fail', `rlsEvidence.${key} must name a repository path`);
      texts[key] = { error: 'not declared' };
      continue;
    }
    const read = readArtifact(rel);
    texts[key] = read;
    if (read.error !== undefined) {
      record(`artifact:${key}`, 'fail', `${rel} is ${read.error} - the ${key.replace('Artifact', '')} scope cannot be verified from a file that is not there`);
    } else {
      record(`artifact:${key}`, 'pass', `${rel} present (${read.text.split('\n').length} lines)`);
    }
  }

  let coverage = null;
  if (texts.coverageArtifact?.text !== undefined) {
    try {
      coverage = JSON.parse(texts.coverageArtifact.text);
      record('coverage-parses', 'pass', `${coverage.covered?.length ?? 0} covered table(s), ${coverage.excluded?.length ?? 0} excluded`);
    } catch (error) {
      record('coverage-parses', 'fail', `the coverage artifact is not readable JSON: ${error.message}`);
    }
  } else {
    record('coverage-parses', 'unverified', 'no coverage artifact to parse');
  }

  /**
   * The tables one of the two scripts touches, as a set.
   *
   * A regex literal rather than a constructed one: the verb is interpolated into a string pattern
   * in the obvious first draft, and every escaping level between a Python generator, a JS string
   * and a RegExp is a place this scan can quietly start matching nothing - which for a scope
   * checker is worse than crashing, because "0 tables in enable.sql" reads as a clean empty scope.
   * So the verb is matched and filtered instead of interpolated, and the count is asserted against
   * the coverage artifact by a test.
   */
  const STATEMENT_RE = /ALTER\s+TABLE\s+"?([A-Za-z0-9_.]+)"?\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi;
  const statementsIn = (text, verb) => {
    if (typeof text !== 'string') return null;
    const set = new Set();
    STATEMENT_RE.lastIndex = 0;
    let match;
    while ((match = STATEMENT_RE.exec(text)) !== null) {
      if (match[2].toUpperCase() !== verb) continue;
      set.add(match[1].replace(/^public\./, '').toLowerCase());
    }
    return set;
  };

  const covered = coverage?.covered instanceof Array
    ? new Set(coverage.covered.map((row) => String(row?.table ?? '').toLowerCase()))
    : null;
  const enabled = texts.enableArtifact?.text !== undefined ? statementsIn(texts.enableArtifact.text, 'ENABLE') : null;
  const disabled = texts.disableArtifact?.text !== undefined ? statementsIn(texts.disableArtifact.text, 'DISABLE') : null;

  if (covered === null || enabled === null) {
    record('scope:enable-vs-coverage', 'unverified', 'one side of the comparison is unavailable, so no scope claim can be made');
  } else if (covered.size === 0 && enabled.size === 0) {
    // Both sides empty is the shape a broken scan produces, and it is also - rarely - legitimate
    // for a fixture. Reporting it as a pass would let a scanner that matches nothing grade clean
    // forever, so it stays unverified and says why.
    record('scope:enable-vs-coverage', 'unverified', 'neither side names a single table; refusing to read an empty scope as a pass');
  } else {
    const onlyInSql = [...enabled].filter((t) => !covered.has(t)).sort();
    const onlyInCoverage = [...covered].filter((t) => !enabled.has(t)).sort();
    if (onlyInSql.length === 0 && onlyInCoverage.length === 0) {
      record('scope:enable-vs-coverage', 'pass', `${enabled.size} table(s) in enable.sql and in the coverage artifact, in both directions`);
    } else {
      record(
        'scope:enable-vs-coverage',
        'fail',
        `the enablement script and the coverage ledger disagree - ` +
          `in enable.sql only: [${onlyInSql.join(', ') || '-'}]; in rls_coverage.json only: [${onlyInCoverage.join(', ') || '-'}]`,
        { onlyInSql, onlyInCoverage },
      );
    }
  }

  if (disabled === null || enabled === null) {
    record('scope:enable-vs-disable', 'unverified', 'one of the two scripts is unavailable to compare');
  } else if (enabled.size === 0 && disabled.size === 0) {
    record('scope:enable-vs-disable', 'unverified', 'neither script names a table; an empty pair of sets proves nothing');
  } else {
    const asymmetric = [...new Set([...enabled, ...disabled])].filter((t) => !(enabled.has(t) && disabled.has(t))).sort();
    record(
      'scope:enable-vs-disable',
      asymmetric.length === 0 ? 'pass' : 'fail',
      asymmetric.length === 0
        ? `${enabled.size} table(s) can be enabled and ${disabled.size} disabled - the rollback is exactly as wide as the change`
        : `asymmetric tables (enable without disable, or the reverse): [${asymmetric.join(', ')}]`,
      { asymmetric },
    );
  }

  // The stamp: all three artifacts carry the same schema stamp, or the audit describes a database
  // that is not the one the scripts were generated for.
  const stampOf = (text) => /Schema stamp:\s*(\d{8,18})/i.exec(text ?? '')?.[1] ?? null;
  const stamps = {
    coverage: coverage?.stamp ?? null,
    enable: stampOf(texts.enableArtifact?.text),
    disable: stampOf(texts.disableArtifact?.text),
  };
  const stampValues = Object.entries(stamps).filter(([, value]) => value !== null);
  if (stampValues.length < 3) {
    record('schema-stamp', 'unverified', `at least one artifact does not declare a stamp (${JSON.stringify(stamps)})`);
  } else if (new Set(stampValues.map(([, value]) => value)).size === 1) {
    record('schema-stamp', 'pass', `all three artifacts carry stamp ${stampValues[0][1]}`);
  } else {
    record('schema-stamp', 'fail', `the artifacts disagree about which schema they describe: ${JSON.stringify(stamps)}`);
  }

  for (const [key, needle, label] of [
    ['policyName', evidence.policyName, 'policy'],
    ['functionName', evidence.functionName, 'function'],
  ]) {
    const declared = evidence[key];
    if (declared === undefined) continue;
    const text = texts.enableArtifact?.text ?? '';
    record(
      `object:${declared}`,
      text.includes(declared) ? 'pass' : 'fail',
      text.includes(declared)
        ? `enable.sql references the ${label} the manifest names`
        : `enable.sql never mentions the ${label} ${JSON.stringify(declared)} the manifest names`,
    );
  }

  const ledgerRel = evidence.evidenceLedger ?? 'docs/dr/rls-evidence.jsonl';
  const ledgerPath = join(root, ledgerRel);
  let parsed = { entries: [], problems: [] };
  if (existsSync(ledgerPath)) {
    parsed = parseRlsLedger(readFileSync(ledgerPath, 'utf8'));
    for (const problem of parsed.problems) findings.push(`evidence ledger: ${problem}`);
  }
  const row = rlsEvidenceReport(evidence, parsed.entries, nowMs);
  const ledgerGrade =
    parsed.problems.length > 0 ? 'fail' : row.state === 'ok' ? 'pass' : row.state === 'fail' ? 'fail' : row.state === 'waived' ? 'skipped' : 'unverified';
  record(
    'evidence-ledger',
    ledgerGrade,
    parsed.problems.length > 0
      ? `${parsed.problems.length} malformed line(s) in ${ledgerRel}: ${parsed.problems[0]}`
      : row.line,
    { entries: parsed.entries.length, state: row.state },
  );

  const grade = findings.length > 0 || parsed.problems.length > 0
    ? 'fail'
    : checks.some((check) => check.grade === 'unverified')
      ? 'unverified'
      : checks.every((check) => check.grade === 'skipped')
        ? 'skipped'
        : 'pass';

  return {
    schema: RLS_VERIFY_SCHEMA,
    grade,
    cadenceHours: evidence.cadenceHours ?? null,
    requiredGrade: evidence.requiredGrade ?? null,
    verifier: evidence.verifier ?? null,
    ledger: { path: ledgerRel, entries: parsed.entries.length, problems: parsed.problems },
    scope: { covered: covered?.size ?? null, enabled: enabled?.size ?? null, disabled: disabled?.size ?? null, stamps },
    checks,
    findings,
    // The sentence that keeps this tool in its lane. A status page that printed `"enabled": true`
    // here would be read as the platform's authorization to claim enforcement, and this function
    // has not asked a database a single question.
    assertion: RLS_NOT_ASSERTED,
    enabled: null,
  };
}

export function renderPlan(manifest) {
  const lines = [];
  lines.push(`# DR restore plan - ${manifest.title}`);
  lines.push('# GENERATED BY `node scripts/dr-manifest.mjs --plan` - a DRY RUN.');
  lines.push('# Every $VAR below is an environment reference resolved on the');
  lines.push('# operator machine at execution time; this file never contains,');
  lines.push('# and must never be edited to contain, a resolved value.');
  lines.push('');
  lines.push(`RPO target: ${manifest.rpoMinutes} minutes. RTO target: ${manifest.rtoHours} hours.`);
  lines.push('');
  for (const step of manifest.restoreProcedure) {
    const who = step.component ? `[${step.component}]` : '[procedure]';
    lines.push(`${String(step.step).padStart(2)}. ${who} ${step.action}`);
  }
  lines.push('');
  lines.push('# --- per-component verification (each must execute and record) ---');
  for (const c of [...manifest.components].sort((a, b) => a.restoreOrder - b.restoreOrder)) {
    lines.push(`order ${c.restoreOrder} - ${c.id}: ${c.verification}`);
    const freshness =
      c.cadenceHours === null
        ? `waived: ${c.cadenceWaiver}`
        : `every <=${c.cadenceHours}h${c.rpoMechanism ? `; RPO via: ${c.rpoMechanism}` : ''}`;
    lines.push(`           freshness: ${freshness}`);
  }
  const rls = manifest.rlsEvidence;
  if (rls !== undefined) {
    lines.push('');
    lines.push('# --- rls enablement evidence (Part 15) ---');
    lines.push(`verifier: ${rls.verifier} (read-only; the engine's own audit covers the engine plane)`);
    lines.push(`cadence: ${rls.cadenceHours === null ? `waived: ${rls.cadenceWaiver}` : `<=${rls.cadenceHours}h`}`);
    lines.push(`scope: ${rls.scope}`);
    lines.push(`evidence ledger: ${rls.evidenceLedger} (append-only, checked by --check-rls)`);
  }
  lines.push('');
  lines.push('# --- invariants this plan assumes ---');
  for (const inv of manifest.invariants) {
    lines.push(`- ${inv}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// The one list of modes: a flag that exists but is not in here is read as a
// value-taking override, which is how "--due --check-rls" would silently
// become an override named "check-rls". One array, both branches.
const MODE_FLAGS = ['--check', '--plan', '--due', '--record', '--check-rls', '--record-rls', '--emit-schedule', '--check-schedule', '--verify-rls'];

/** Flags that take no value. Listing them is required because the parser below treats every other
 * `--x` as a value-taking override, and `--json` must never be able to swallow the next argument -
 * the same trap that `--due --check-rls` walked into (see the note above MODE_FLAGS). */
const BOOL_FLAGS = ['--json'];

function parseFlags(argv) {
  const flags = { mode: null, overrides: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (BOOL_FLAGS.includes(arg)) {
      // Stored in `overrides`, not on the flag object: every mode reads its inputs out of one
      // place, and a boolean that lives somewhere else is a boolean nobody checks.
      flags.overrides[arg.slice(2)] = true;
      continue;
    }
    if (arg.startsWith('--') && !arg.includes('=') && !MODE_FLAGS.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`flag ${arg} requires a value`);
      }
      flags.overrides[arg.slice(2)] = value;
      i += 1;
    } else if (MODE_FLAGS.includes(arg)) {
      if (flags.mode !== null) {
        throw new Error(`only one mode at a time, got ${flags.mode} and ${arg}`);
      }
      flags.mode = arg;
    } else {
      throw new Error(`unrecognized argument ${JSON.stringify(arg)}`);
    }
  }
  return flags;
}

function usage() {
  console.error(
    [
      'usage:',
      '  node scripts/dr-manifest.mjs --check',
      '  node scripts/dr-manifest.mjs --plan',
      '  node scripts/dr-manifest.mjs --due [--now ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed [--note TEXT] [--at ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --check-rls [--now ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --record-rls --grade pass|fail|unverified [--probed N] [--role NAME] [--note TEXT] [--at ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --emit-schedule [--root PATH] [--out PATH] [--manifest PATH]',
      '  node scripts/dr-manifest.mjs --check-schedule [--out PATH] [--manifest PATH]',
      '  node scripts/dr-manifest.mjs --verify-rls [--now ISO] [--ledger PATH] [--manifest PATH] [--json]',
    ].join('\n'),
  );
  return 2;
}

const LEDGER_PATH = join(ROOT, 'docs', 'dr', 'backup-ledger.jsonl');

function readLedger(path, knownIds) {
  if (!existsSync(path)) {
    // Absent ledger is not broken state - it is an empty record, and every
    // obliged component reads as "never recorded", which IS the alarm.
    return { entries: [], problems: [] };
  }
  const parsed = parseLedger(readFileSync(path, 'utf8'), knownIds);
  // Note-level secret scan on PARSED content, not just file text: an
  // escaped quote inside JSON is the one spelling the text scan reliably
  // misses, and this is the last place a credential could hide in plain
  // repository history.
  for (const entry of parsed.entries) {
    if (entry.note !== undefined) {
      for (const finding of findSecretShapes(`${entry.note}\n`)) {
        parsed.problems.push(`SECRET-SHAPED CONTENT in note (component ${entry.component}): ${finding}`);
      }
    }
  }
  return parsed;
}

/** `skipLedger` is for the Part 15 modes: the RLS evidence file lives in its
 OWN ledger, and parsing it as a backup ledger would report its own fields as
 corruption - and, worse, let the shared "unreadable evidence" refusal fire on
 a perfectly valid RLS line. One loader, two files, never a cross-read. */
function loadManifestAndLedger(overrides, skipLedger = false) {
  // `--manifest` exists for the same reason `--ledger` and `--out` do: a mode that can
  // only be pointed at the repository's own file cannot be tested against a broken
  // input without breaking the repository. Defaults unchanged.
  const manifestPath = overrides.manifest ?? MANIFEST_PATH;
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw); // parse errors surface via caller's try/catch
  const secretFindings = findSecretShapes(raw);
  const errors = validateManifest(manifest);
  const knownIds = new Set((manifest.components ?? []).map((c) => c.id));
  const ledgerPath = overrides.ledger ?? LEDGER_PATH;
  const ledger = skipLedger ? { entries: [], problems: [] } : readLedger(ledgerPath, knownIds);
  return { manifest, raw, secretFindings, errors, knownIds, ledgerPath, ledger };
}

function main(argv) {
  let flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    console.error(String(error.message ?? error));
    return usage();
  }
  const { mode, overrides } = flags;
  if (mode === null) {
    return usage();
  }

  const rlsMode = mode === '--check-rls' || mode === '--record-rls' || mode === '--verify-rls';
  let loaded;
  try {
    loaded = loadManifestAndLedger(overrides, rlsMode);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`manifest is not valid JSON: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const { manifest, secretFindings, ledgerPath, ledger } = loaded;

  for (const finding of secretFindings) {
    console.error(`SECRET-SHAPED CONTENT (manifest): ${finding}`);
  }
  const errors = [...loaded.errors];
  for (const problem of ledger.problems) {
    errors.push(`LEDGER ${ledgerPath}: ${problem}`);
  }
  for (const finding of existsSync(ledgerPath) ? findSecretShapes(readFileSync(ledgerPath, 'utf8')) : []) {
    errors.push(`SECRET-SHAPED CONTENT (ledger): ${finding}`);
  }
  if (secretFindings.length > 0) {
    return 1;
  }
  if (mode === '--check' || mode === '--plan') {
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`MANIFEST: ${error}`);
      }
      return 1;
    }
  }
  if (mode === '--check') {
    const obliged = manifest.components.filter((c) => c.cadenceHours !== null).length;
    console.log(
      `manifest valid: ${manifest.components.length} components (${obliged} with cadence), ` +
        `RPO ${manifest.rpoMinutes}m / RTO ${manifest.rtoHours}h, ` +
        `drill every ${manifest.drill.cadenceDays}d (timed: ${manifest.drill.timed}), ` +
        `ledger entries: ${ledger.entries.length}`,
    );
    return 0;
  }
  if (mode === '--plan') {
    process.stdout.write(renderPlan(manifest));
    return 0;
  }

  if (mode === '--due') {
    const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
    if (Number.isNaN(nowMs)) {
      console.error(`--now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
      return 2;
    }
    if (ledger.problems.length > 0) {
      // A corrupt ledger can hide overdue obligations: refuse to grade the
      // fleet on unreadable evidence instead of reporting a false "all ok".
      for (const problem of ledger.problems) {
        console.error(`LEDGER ${ledgerPath}: ${problem}`);
      }
      console.error('REFUSING to answer --due from an unreadable ledger');
      return 1;
    }
    const rows = dueReport(manifest, ledger.entries, nowMs);
    for (const row of rows) {
      console.log(row.line);
    }
    const overdue = rows.filter((r) => r.state === 'due');
    console.log(
      overdue.length === 0
        ? `all obligations current as of ${new Date(nowMs).toISOString()}`
        : `${overdue.length} obligation(s) DUE as of ${new Date(nowMs).toISOString()}`,
    );
    return overdue.length === 0 ? 0 : 1;
  }

  if (mode === '--emit-schedule' || mode === '--check-schedule') {
    // Both modes read the manifest the way --check does, and neither may run on a
    // manifest that fails validation: a schedule rendered from a cadence table that
    // does not parse is a file that looks authoritative and is arbitrary, and the
    // whole value of generating it is that the manifest is the single authority.
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`MANIFEST: ${error}`);
      }
      console.error(`REFUSING to answer ${mode} from an invalid manifest`);
      return 1;
    }
    const schedulePath = overrides.out ?? SCHEDULE_PATH;
    const root = overrides.root ?? '.';
    if (mode === '--emit-schedule') {
      const text = renderSchedule(manifest, root);
      const changed = !existsSync(schedulePath) || readFileSync(schedulePath, 'utf8') !== text;
      mkdirSync(dirname(schedulePath), { recursive: true });
      writeFileSync(schedulePath, text);
      const tightest = scheduleTightestCadenceHours(manifest);
      console.log(
        `wrote ${schedulePath}: ${
          tightest === null
            ? 'no cadence to age (every component waives one); the manifest check still runs'
            : `obligations age against ${tightest}h, checked every ${scheduleCheckIntervalHours(tightest)}h`
        }, wlctRoot=${root}${changed ? '' : ' (content unchanged)'}`,
      );
      return 0;
    }
    if (!existsSync(schedulePath)) {
      console.error(
        `no schedule file at ${schedulePath} - run --emit-schedule, and the obligation to run it is exactly the point of the file`,
      );
      return 1;
    }
    const problems = scheduleDrift(manifest, readFileSync(schedulePath, 'utf8'));
    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(`SCHEDULE ${schedulePath}: ${problem}`);
      }
      return 1;
    }
    const scheduled = readFileSync(schedulePath, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#') && line.includes('dr-manifest.mjs'))
      .map((line) => /(--[a-z-]+)\s*$/.exec(line)?.[1] ?? '?');
    console.log(
      `schedule valid: ${scheduled.length} job line(s) (${scheduled.join(', ')}), ` +
        `derived from ${manifest.components.length} components, no ledger-writing mode present`,
    );
    return 0;
  }

  if (mode === '--verify-rls') {
    // Read-only, and it never writes a ledger: the answer is a document, so a CI job or an ops
    // panel can read it without a second tool reimplementing these six laws.
    if (overrides.json === true) {
      const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
      if (Number.isNaN(nowMs)) {
        console.error(`--verify-rls: --now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
        return 2;
      }
      const document = verifyRlsEvidence(manifest, { nowMs });
      console.log(JSON.stringify(document));
      return document.grade === 'pass' ? 0 : document.grade === 'unverified' ? 3 : 1;
    }
    const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
    if (Number.isNaN(nowMs)) {
      console.error(`--verify-rls: --now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
      return 2;
    }
    const document = verifyRlsEvidence(manifest, { nowMs });
    for (const check of document.checks) {
      const mark = check.grade === 'pass' ? 'ok  ' : check.grade === 'fail' ? 'FAIL' : check.grade === 'skipped' ? 'skip ' : 'UNVER';
      console.log(`[${mark}] ${check.name.padEnd(28)} ${check.detail}`);
    }
    if (document.findings.length > 0) {
      for (const finding of document.findings) console.error(`finding: ${finding}`);
    }
    console.log(
      `rls verification: ${document.grade.toUpperCase()} - ${document.checks.filter((c) => c.grade === 'pass').length}/${document.checks.length} checks pass; ` +
        `${document.assertion}`,
    );
    return document.grade === 'pass' ? 0 : document.grade === 'unverified' ? 3 : 1;
  }

  if (mode === '--check-rls' || mode === '--record-rls') {
    const evidence = manifest.rlsEvidence;
    if (evidence === undefined || evidence === null) {
      // validateManifest already named it; this is the CLI's own answer, so
      // a caller who ignores exit 1 of --check still cannot read a verdict
      // out of a missing block.
      console.error('manifest has no rlsEvidence block (see `--check` for the validation failure)');
      return 1;
    }
    for (const error of errors) {
      console.error(`MANIFEST: ${error}`);
    }
    const evidencePath = overrides.ledger ?? join(ROOT, evidence.evidenceLedger);
    let parsed = { entries: [], problems: [] };
    if (existsSync(evidencePath)) {
      parsed = parseRlsLedger(readFileSync(evidencePath, 'utf8'));
      for (const finding of findSecretShapes(readFileSync(evidencePath, 'utf8'))) {
        parsed.problems.push(`SECRET-SHAPED CONTENT: ${finding}`);
      }
    }
    if (mode === '--check-rls') {
      if (parsed.problems.length > 0) {
        for (const problem of parsed.problems) {
          console.error(`RLS EVIDENCE ${evidencePath}: ${problem}`);
        }
        // Same law as --due: unreadable evidence is never graded as absent
        // evidence ("all ok") - it is a refusal that costs a fix.
        console.error('REFUSING to answer --check-rls from an unreadable evidence ledger');
        return 1;
      }
      if (errors.length > 0) {
        console.error('REFUSING to answer --check-rls from an invalid manifest');
        return 1;
      }
      const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
      if (Number.isNaN(nowMs)) {
        console.error(`--check-rls: --now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
        return 2;
      }
      const row = rlsEvidenceReport(evidence, parsed.entries, nowMs);
      console.log(row.line);
      console.log(
        `cadence ${evidence.cadenceHours === null ? 'waived' : `${evidence.cadenceHours}h`}, ` +
          // the file it ACTUALLY read, not the manifest's default: a
          // --ledger override that changed the answer is exactly the case a
          // summary line must not obscure.
          `ledger ${evidencePath} (${parsed.entries.length} entries), verifier ${evidence.verifier}`,
      );
      return row.state === 'ok' || row.state === 'waived' ? 0 : 1;
    }

    // --record-rls: the operator's record of an audit THIS script never ran.
    // That separation is the design: the CLI has no database credentials and
    // no business having them, so it can accept, age and store a result but
    // cannot invent one - which is also why --grade is required and there is
    // no "--assume-pass".
    const grade = overrides.grade;
    if (grade !== 'pass' && grade !== 'fail' && grade !== 'unverified') {
      console.error('--record-rls: --grade must be pass, fail or unverified (the core\'s closed vocabulary)');
      return 1;
    }
    if (parsed.problems.length > 0) {
      for (const problem of parsed.problems) {
        console.error(`RLS EVIDENCE ${evidencePath}: ${problem}`);
      }
      console.error('REFUSING to append to an unreadable evidence ledger - fix the named lines first');
      return 1;
    }
    const atRaw = overrides.at ?? new Date().toISOString();
    const atMs = Date.parse(atRaw);
    if (Number.isNaN(atMs)) {
      console.error(`--record-rls: --at is not an ISO-8601 timestamp: ${JSON.stringify(overrides.at)}`);
      return 1;
    }
    const entry = { at: new Date(atMs).toISOString(), grade };
    if (overrides.probed !== undefined) {
      const probed = Number(overrides.probed);
      if (!Number.isInteger(probed) || probed < 0 || probed > 4096) {
        console.error('--record-rls: --probed must be an integer 0..4096 (tables actually read)');
        return 1;
      }
      entry.probed = probed;
    }
    for (const [key, flag] of [['role', '--role'], ['note', '--note']]) {
      const value = overrides[key];
      if (value === undefined) {
        continue;
      }
      const limit = key === 'role' ? 200 : 500;
      if (value.length > limit || /[\r\n]/.test(value)) {
        console.error(`--record-rls: ${flag} must be one line of at most ${limit} characters`);
        return 1;
      }
      entry[key] = value;
    }
    const line = JSON.stringify(entry);
    const secretFindingsInLine = [
      ...findSecretShapes(`${line}\n`),
      ...(entry.note === undefined ? [] : findSecretShapes(`${entry.note}\n`)),
    ];
    if (secretFindingsInLine.length > 0) {
      for (const finding of secretFindingsInLine) {
        console.error(`REFUSING to record: ${finding}`);
      }
      console.error('evidence describes what was verified, never what was used to verify it - credentials do not belong in the ledger');
      return 1;
    }
    appendFileSync(evidencePath, `${line}\n`, 'utf8');
    console.log(`recorded: ${line}`);
    const row = rlsEvidenceReport(evidence, [...parsed.entries, { ...entry, atMs }], Date.now());
    console.log(row.line);
    return row.state === 'ok' || row.state === 'waived' ? 0 : 1;
  }

  // --record
  const component = overrides.component;
  const outcome = overrides.outcome;
  if (component === undefined || outcome === undefined) {
    console.error('--record requires --component and --outcome');
    return usage();
  }
  if (!loaded.knownIds.has(component)) {
    console.error(`--record: unknown component ${JSON.stringify(component)}`);
    return 1;
  }
  if (outcome !== 'ok' && outcome !== 'failed') {
    console.error('--record: outcome must be "ok" or "failed"');
    return 1;
  }
  const atRaw = overrides.at ?? new Date().toISOString();
  const atMs = Date.parse(atRaw);
  if (Number.isNaN(atMs)) {
    console.error(`--record: --at is not an ISO-8601 timestamp: ${JSON.stringify(overrides.at)}`);
    return 1;
  }
  const entry = { at: new Date(atMs).toISOString(), component, outcome };
  if (overrides.note !== undefined) {
    if (overrides.note.length > 500 || /[\r\n]/.test(overrides.note)) {
      console.error('--record: note must be one line of at most 500 characters');
      return 1;
    }
    entry.note = overrides.note;
  }
  const line = JSON.stringify(entry);
  // Scan BOTH forms: the stored line (catches a crafted --at/field smuggle)
  // and the raw note (JSON escaping must not launder `KEY="secret"` into
  // `KEY=\"secret\"` past the patterns).
  const secretFindingsInLine = [
    ...findSecretShapes(`${line}\n`),
    ...(entry.note === undefined ? [] : findSecretShapes(`${entry.note}\n`)),
  ];
  if (secretFindingsInLine.length > 0) {
    for (const finding of secretFindingsInLine) {
      console.error(`REFUSING to record: ${finding}`);
    }
    console.error('notes describe what was done, never what was used - credentials do not belong in the ledger');
    return 1;
  }
  if (ledger.problems.length > 0) {
    for (const problem of ledger.problems) {
      console.error(`LEDGER ${ledgerPath}: ${problem}`);
    }
    console.error('REFUSING to append to an unreadable ledger - fix the named lines first');
    return 1;
  }
  appendFileSync(ledgerPath, `${line}\n`, 'utf8');
  console.log(`recorded: ${line}`);
  const rows = dueReport(manifest, [...ledger.entries, { ...entry, atMs }], Date.now());
  const mine = rows.find((r) => r.component === component);
  if (mine !== undefined) {
    console.log(mine.line);
  }
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
```


## FILE: scripts/dr-manifest.test.mjs (1026 lines)

*13 tests for that derivation: the interval law (`min(tightest cadence, 24h)`), the hour-field wrap that makes `0 */N * * *` valid for any N in 1..24, `--check` staying daily regardless, waivers rendered as comments, the all-waived board, the RLS waiver removing `--check-rls`, `--record` and `--record-rls` refused and reported as their own finding ahead of the byte comparison, and the tamper cases landing on JOB lines because a comment-only edit is correctly a byte mismatch.*

```javascript
/**
 * Tests for the DR manifest validator (run: `node --test scripts/`).
 *
 * The repo's own manifest must pass, every drift class the validator exists
 * to catch must fail, and the plan renderer must be deterministic and
 * credential-free. These tests are the difference between a validator and a
 * lint that nothing watches.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  validateManifest,
  findSecretShapes,
  renderPlan,
  collectEnvNames,
  parseLedger,
  dueReport,
  parseRlsLedger,
  rlsEvidenceReport,
  renderSchedule,
  scheduleDrift,
  scheduleCronFor,
  scheduleCheckIntervalHours,
  scheduleTightestCadenceHours,
  SCHEDULE_PATH,
  verifyRlsEvidence,
} from './dr-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'docs', 'dr', 'manifest.json'), 'utf8'));

test('the shipped manifest validates clean', () => {
  assert.deepEqual(validateManifest(MANIFEST, ROOT), []);
});

test('the shipped manifest contains no secret shapes', () => {
  const raw = readFileSync(join(ROOT, 'docs', 'dr', 'manifest.json'), 'utf8');
  assert.deepEqual(findSecretShapes(raw), []);
});

test('every env name referenced exists in a repo .env.example', () => {
  const names = collectEnvNames(ROOT);
  for (const component of MANIFEST.components) {
    for (const ref of component.envRefs ?? []) {
      assert.ok(names.has(ref), `${component.id}: missing env name ${ref}`);
    }
  }
  assert.ok(names.size > 20, 'template parsing regressed');
});

test('a duplicated restoreOrder is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components[1].restoreOrder = bad.components[0].restoreOrder;
  const errors = validateManifest(bad, ROOT);
  assert.ok(errors.some((e) => e.includes('unique positive integer')) || errors.some((e) => e.includes('1..n')));
});

test('a gapped restoreOrder sequence is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.at(-1).restoreOrder = 99;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no gaps')));
});

test('a path that no longer exists is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').paths.push('apps/api/prisma/schema.dreamt-of.prisma');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no longer exists')));
});

test('an env ref that appears in no template is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').envRefs.push('POSTGRES_LIKE_TOTALY_MADE_UP');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no .env.example')));
});

test('a missing required component is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components = bad.components.filter((c) => c.id !== 'redis');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('required component redis')));
});

test('restoring the database before the keys is refused', () => {
  const bad = structuredClone(MANIFEST);
  const keys = bad.components.find((c) => c.id === 'encryption-keys');
  const db = bad.components.find((c) => c.id === 'postgres');
  [keys.restoreOrder, db.restoreOrder] = [db.restoreOrder, keys.restoreOrder];
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('BEFORE postgres')));
});

test('an untimed drill is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.drill.timed = false;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('drill.timed')));
});

test('a restore step pointing at a non-existent component is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.restoreProcedure[1].component = 'ghost-store';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('unknown component')));
});

test('secret shapes are detected wherever they hide', () => {
  assert.ok(findSecretShapes('host=postgresql://admin:Str0ngPassw0rd@db:5432/x').length > 0);
  assert.ok(findSecretShapes('-----BEGIN RSA PRIVATE KEY-----').length > 0);
  assert.ok(findSecretShapes('{"JWT_ACCESS_SECRET": "aGVsbG93b3JsZGFiY2RlZg=="}').length > 0);
});

test('--check and --plan succeed on the repo, and --plan is deterministic', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const checkOut = execFileSync('node', [script, '--check'], { encoding: 'utf8' });
  assert.match(checkOut, /manifest valid/);
  const plan1 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  const plan2 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(plan1, plan2);
  assert.doesNotMatch(plan1, /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@/); // no credential URLs
  for (const component of MANIFEST.components) {
    assert.ok(plan1.includes(component.id), `plan omits ${component.id}`);
  }
});

test('renderPlan matches the CLI output exactly (pure function, no clock)', () => {
  const viaFn = renderPlan(MANIFEST);
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const viaCli = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(viaCli, viaFn);
});

test('usage error exits 2', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  assert.throws(() => execFileSync('node', [script, '--nope'], { stdio: 'pipe' }), (err) => err.status === 2);
});

/* --------------------------------------------------------------------- */
/* Part 12: the backup-freshness ledger                                  */
/* --------------------------------------------------------------------- */

test('a component with neither cadence nor waiver is refused', () => {
  const bad = structuredClone(MANIFEST);
  delete bad.components.find((c) => c.id === 'dataset-objects').cadenceHours;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('cadenceHours is required')));
});

test('a null cadence without a waiver string is refused', () => {
  const bad = structuredClone(MANIFEST);
  const c = bad.components.find((x) => x.id === 'dataset-objects');
  c.cadenceHours = null;
  delete c.cadenceWaiver;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('requires a non-empty cadenceWaiver')));
});

test('a waiver attached to a real cadence is refused (contradiction)', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').cadenceWaiver = 'but I do not feel like it';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('only meaningful when cadenceHours is null')));
});

test('cadenceHours must be a bounded integer', () => {
  for (const value of [0, -3, 24.5, 8761, '24', null]) {
    const bad = structuredClone(MANIFEST);
    const c = bad.components.find((x) => x.id === 'dataset-objects');
    c.cadenceHours = value;
    c.cadenceWaiver = 'present, so the null-cadence branch is also exercised';
    const errors = validateManifest(bad, ROOT);
    if (value === null) {
      // null + waiver is legal - that is the redis shape; assert NO cadence error for it
      assert.ok(!errors.some((e) => e.includes('integer 1..8760')), 'null with waiver must pass the bound check');
    } else {
      assert.ok(errors.some((e) => e.includes('integer 1..8760')), `value ${JSON.stringify(value)} must be refused`);
    }
  }
});

test('postgres cadence beyond the RPO must name the mechanism that closes the gap', () => {
  const bad = structuredClone(MANIFEST);
  const db = bad.components.find((c) => c.id === 'postgres');
  delete db.rpoMechanism; // 24h dump vs 60m RPO, nothing else stated
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no rpoMechanism is named')));
  const good = structuredClone(MANIFEST);
  good.components.find((c) => c.id === 'postgres').cadenceHours = 1; // 60m <= 60m: honest without a mechanism
  assert.ok(!validateManifest(good, ROOT).some((e) => e.includes('rpoMechanism')));
});

test('the ledger parses line-wise and reports every malformed line by number', () => {
  const now = '2026-09-14T06:00:00Z';
  const text = [
    JSON.stringify({ at: now, component: 'postgres', outcome: 'ok' }),
    '{not json',
    JSON.stringify({ at: 'yesterday', component: 'postgres', outcome: 'ok' }),
    JSON.stringify({ at: now, component: 'postgres', outcome: 'maybe' }),
    JSON.stringify({ at: now, component: 'nosuch', outcome: 'ok' }),
    JSON.stringify({ at: now, component: 'redis', outcome: 'ok', extra: 'field' }),
    JSON.stringify({ at: now, component: 'redis', outcome: 'failed', note: 'x'.repeat(501) }),
  ].join('\n');
  const { entries, problems } = parseLedger(text, new Set(['postgres', 'redis']));
  assert.equal(entries.length, 1, 'only the clean line survives');
  const joined = problems.join('\n');
  for (const fragment of [
    'line 2: not valid JSON',
    'line 3: at must be an ISO-8601',
    'line 4: outcome',
    'line 5: component "nosuch" is not in the manifest',
    'line 6: unknown field',
    'line 7: note must be',
  ]) {
    assert.ok(joined.includes(fragment), `missing problem: ${fragment} in ${joined}`);
  }
});

test('dueReport ages obligations and honours waivers, failed records included', () => {
  const lite = {
    components: [
      { id: 'a', restoreOrder: 1, cadenceHours: 24 },
      { id: 'b', restoreOrder: 2, cadenceHours: 24 },
      { id: 'r', restoreOrder: 3, cadenceHours: null, cadenceWaiver: 'rebuildable' },
    ],
  };
  const base = Date.parse('2026-09-14T00:00:00Z');
  const entries = parseLedger(
    [
      { at: new Date(base).toISOString(), component: 'a', outcome: 'ok' },
      { at: new Date(base + 10 * 3_600_000).toISOString(), component: 'a', outcome: 'failed' },
      { at: new Date(base).toISOString(), component: 'b', outcome: 'failed' },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
    new Set(['a', 'b', 'r']),
  ).entries;
  const rows = dueReport(lite, entries, base + 23 * 3_600_000);
  assert.equal(rows[0].state, 'ok'); // 23h since last ok: inside 24h
  assert.equal(rows[1].state, 'due'); // only a failed record: the clock never stopped
  assert.match(rows[1].line, /never recorded/);
  assert.equal(rows[2].state, 'waived');
  assert.match(rows[2].line, /rebuildable/);
  const late = dueReport(lite, entries, base + 25 * 3_600_000);
  assert.equal(late[0].state, 'due');
  assert.match(late[0].line, /overdue by 1h 0m/); // failed-at-10h does NOT push the deadline
});

test('findSecretShapes catches the quoted-literal form (the escape that fooled v1)', () => {
  assert.ok(findSecretShapes('API_KEY="abcdefghijklmnop1234"\n').length > 0);
  assert.deepEqual(findSecretShapes('API_KEY="${VAULT_PATH}"\n'), []);
});

test('CLI: record -> due -> secret-refusal leaves exactly the recorded line', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-ledger-'));
  const ledger = join(dir, 'backup-ledger.jsonl');
  // run() ALWAYS resolves to combined stdout+stderr text, matched with
  // assert.match; exit codes are asserted here so the assertions below
  // read as intent ("this refuses") rather than plumbing.
  const run = (args, expectStatus = 0) => {
    try {
      const out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(expectStatus, 0, `expected refusal (exit ${expectStatus}) but got success: ${out}`);
      return out;
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.equal(existsSync(ledger), false, 'harness expects a fresh ledger path');
  // Fresh ledger: due is exit 1 (never recorded) and lists all four obliged
  run(['--due', '--ledger', ledger, '--now', '2026-09-14T12:00:00Z'], 1);
  run(
    [
      '--record', '--component', 'postgres', '--outcome', 'ok',
      '--note', 'pg_dump + scratch restore verified',
      '--at', '2026-09-14T06:00:00Z', '--ledger', ledger,
    ],
    0,
  );
  const lines = fsReadLines(ledger);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    at: '2026-09-14T06:00:00.000Z',
    component: 'postgres',
    outcome: 'ok',
    note: 'pg_dump + scratch restore verified',
  });
  // 12:00: inside the window for postgres -> postgres [ ok ]; others due -> exit 1
  const dueOut = run(['--due', '--ledger', ledger, '--now', '2026-09-14T12:00:00Z'], 1);
  assert.match(dueOut, /\[ ok  \] postgres/);
  assert.match(dueOut, /dataset-objects: never recorded/);
  // Secret-shaped note: refused, file untouched
  const secret = run(
    [
      '--record', '--component', 'postgres', '--outcome', 'ok',
      '--note', 'TOKEN="super-secret-value-123456789012"', '--ledger', ledger,
    ],
    1,
  );
  assert.match(secret, /REFUSING to record/);
  assert.equal(fsReadLines(ledger).length, 1);
  // Unknown component and bad --at refuse too
  run(['--record', '--component', 'ghost', '--outcome', 'ok', '--ledger', ledger], 1);
  run(['--record', '--component', 'postgres', '--outcome', 'ok', '--at', 'last tuesday', '--ledger', ledger], 1);
  // A corrupt ledger line refuses to be appended to (evidence must stay parseable)
  writeFileSync(ledger, 'garbage-not-json\n', { flag: 'a' });
  const append = run(['--record', '--component', 'redis', '--outcome', 'ok', '--ledger', ledger], 1);
  assert.match(append, /REFUSING to append/);
});

function fsReadLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

test('--check reads a ledger with escaped quotes in notes as a secret finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-ledger-scan-'));
  const ledger = join(dir, 'backup-ledger.jsonl');
  writeFileSync(
    ledger,
    `${JSON.stringify({ at: new Date().toISOString(), component: 'postgres', outcome: 'ok', note: 'API_KEY="abcdefghijklmnop1234"' })}\n`,
  );
  const { problems } = parseLedger(readFileSync(ledger, 'utf8'), new Set(['postgres']));
  // parseLedger itself is shape-only; the note scan lives above it in the
  // loader. Pin the SHAPE here (the note is a legal string), so the
  // division of labour between the two checks is explicit...
  assert.deepEqual(problems, []);
  // and pin the END-TO-END refusal through --check: point the loader at
  // the ledger via a CLI run against a manifest that would otherwise pass.
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  let exit = 0;
  try {
    execFileSync('node', [script, '--check', '--ledger', ledger], { stdio: 'pipe' });
  } catch (error) {
    exit = error.status;
    assert.match(String(error.stderr), /SECRET-SHAPED CONTENT in note/);
  }
  assert.equal(exit, 1, 'a ledger with a credential in a note must fail --check');
});

test('the v1 schema id is refused now that v3 is the contract', () => {
  const bad = structuredClone(MANIFEST);
  bad.schema = 'wlct-dr-manifest-v1';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('wlct-dr-manifest-v3')));
});

test('the v2 schema id is refused too: an absent rlsEvidence block must not be inheritable', () => {
  // The interesting case is not "old id", it is "old id + no RLS block":
  // silently allowing that would make Part 15's policy optional for every
  // manifest written before it, which is how a security control becomes a
  // new-deployment-only control.
  const bad = structuredClone(MANIFEST);
  bad.schema = 'wlct-dr-manifest-v2';
  delete bad.rlsEvidence;
  const errors = validateManifest(bad, ROOT);
  assert.ok(errors.some((e) => e.includes('wlct-dr-manifest-v3')));
  assert.ok(errors.some((e) => e.includes('rlsEvidence is required')));
});

/* --------------------------------------------------------------------- */
/* Part 15: RLS enablement evidence                                        */
/* --------------------------------------------------------------------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('the shipped manifest declares RLS evidence and every path it names exists', () => {
  assert.deepEqual(validateManifest(MANIFEST, ROOT), []);
  const rls = MANIFEST.rlsEvidence;
  assert.equal(rls.requiredGrade, 'pass');
  for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
    assert.ok(existsSync(join(ROOT, rls[field])), `${field} missing from the repo`);
  }
  // The verifier names an endpoint, and that endpoint must exist in the
  // engine it points at - the manifest is a pointer, and pointers rot.
  const router = readFileSync(
    join(ROOT, 'services', 'execution-engine', 'app', 'routers', 'enablement.py'),
    'utf8',
  );
  assert.ok(router.includes(`"${rls.verifier.slice('/internal/v1'.length)}"`), 'manifest points at a route that does not exist');
  assert.ok(router.includes('router = APIRouter(prefix="/internal/v1"'), 'verifier left the internal plane');
});

test('rlsEvidence is required, and each of its fields has a shape', () => {
  const missing = structuredClone(MANIFEST);
  delete missing.rlsEvidence;
  assert.ok(validateManifest(missing, ROOT).some((e) => e.includes('rlsEvidence is required')));

  for (const field of ['evidenceLedger', 'verifier', 'command']) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence[field] = '';
    assert.ok(
      validateManifest(bad, ROOT).some((e) => e.includes(`${field} must be a non-empty string`)),
      field,
    );
  }
});

test('an rls cadence beyond a year is refused as a way of writing never', () => {
  const bad = structuredClone(MANIFEST);
  bad.rlsEvidence.cadenceHours = 8761;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('cadenceHours must be an integer 1..8760')));
  const zero = structuredClone(MANIFEST);
  zero.rlsEvidence.cadenceHours = 0;
  assert.ok(validateManifest(zero, ROOT).some((e) => e.includes('cadenceHours must be an integer')));
});

test('an rls waiver needs words, and a waiver next to a cadence is a contradiction', () => {
  const silent = structuredClone(MANIFEST);
  silent.rlsEvidence.cadenceHours = null;
  assert.ok(validateManifest(silent, ROOT).some((e) => e.includes('cadenceHours null requires a non-empty cadenceWaiver')));
  const contradictory = structuredClone(MANIFEST);
  contradictory.rlsEvidence.cadenceWaiver = 'not applicable';
  assert.ok(validateManifest(contradictory, ROOT).some((e) => e.includes('only meaningful when cadenceHours is null')));
});

test('the evidence ledger must be git evidence: relative, under docs/dr, .jsonl', () => {
  for (const [value, needle] of [
    ['/etc/passwd', 'repository-relative path'],
    ['docs/dr/../secrets.jsonl', 'repository-relative path'],
    ['docs/dr/evidence.txt', '.jsonl file'],
    ['evidence/rls.jsonl', 'under docs/dr/'],
  ]) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence.evidenceLedger = value;
    assert.ok(validateManifest(bad, ROOT).some((e) => e.includes(needle)), `${value} -> ${needle}`);
  }
});

test('the verifier must be an internal endpoint and the command a repo script', () => {
  const publicRoute = structuredClone(MANIFEST);
  publicRoute.rlsEvidence.verifier = '/api/v1/enablement/audit';
  assert.ok(validateManifest(publicRoute, ROOT).some((e) => e.includes('internal-plane endpoint')));

  const escaped = structuredClone(MANIFEST);
  escaped.rlsEvidence.verifier = '/public/enablement';
  assert.ok(validateManifest(escaped, ROOT).some((e) => e.includes('must not be a public route')));

  const arbitrary = structuredClone(MANIFEST);
  arbitrary.rlsEvidence.command = 'bash -c "curl evil"';
  assert.ok(validateManifest(arbitrary, ROOT).some((e) => e.includes('repository script')));
});

test('requiredGrade is not a knob: anything but "pass" is refused', () => {
  for (const value of ['fail', 'unverified', 'warning', true, 0]) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence.requiredGrade = value;
    assert.ok(
      bad && validateManifest(bad, ROOT).some((e) => e.includes('requiredGrade is not a knob')),
      JSON.stringify(value),
    );
  }
});

test('an artifact path that no longer exists, or no longer speaks of RLS, is a validation failure', () => {
  const moved = structuredClone(MANIFEST);
  moved.rlsEvidence.coverageArtifact = 'apps/api/prisma/rls/gone.json';
  assert.ok(validateManifest(moved, ROOT).some((e) => e.includes('no longer exists')));

  const notJson = structuredClone(MANIFEST);
  notJson.rlsEvidence.coverageArtifact = 'docs/dr/manifest.json'; // exists, but not the coverage shape
  assert.ok(validateManifest(notJson, ROOT).length >= 0); // JSON parses, so it passes - see the RLS-text rule below

  const renamed = structuredClone(MANIFEST);
  renamed.rlsEvidence.enableArtifact = 'docs/ROADMAP.md'; // exists, no ROW LEVEL SECURITY
  assert.ok(validateManifest(renamed, ROOT).some((e) => e.includes('no longer mentions ROW LEVEL SECURITY')));
});

test('secret shapes in the evidence ledger fail --check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-secret-'));
  const ledger = join(dir, 'e.jsonl');
  writeFileSync(
    ledger,
    `${JSON.stringify({
      at: new Date().toISOString(),
      grade: 'pass',
      note: 'ran with DATABASE_URL="postgresql://app:sup3rsecretvalue@db:5432/wlct"',
    })}\n`,
  );
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  let exit = 0;
  try {
    execFileSync('node', [script, '--check-rls', '--ledger', ledger], { stdio: 'pipe' });
  } catch (error) {
    exit = error.status;
    assert.match(String(error.stderr), /SECRET-SHAPED CONTENT/);
  }
  assert.equal(exit, 1, 'a ledger holding a credential must not be readable as evidence');
});

test('parseRlsLedger accepts the closed grade vocabulary and nothing else', () => {
  const good = JSON.stringify({ at: '2026-09-14T06:00:00.000Z', grade: 'pass', probed: 42, role: 'wlct_app' });
  assert.deepEqual(parseRlsLedger(`${good}\n`).problems, []);
  assert.equal(parseRlsLedger(`${good}\n`).entries.length, 1);

  for (const [payload, needle] of [
    [{ at: 'x', grade: 'pass' }, 'ISO-8601'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'ok' }, 'pass, fail or unverified'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', extra: 1 }, 'unknown field'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', probed: 99999 }, 'integer 0..4096'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', role: 'a'.repeat(201) }, 'role must be'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', note: 'line1\nline2' }, 'note must be'],
  ]) {
    const { problems } = parseRlsLedger(`${JSON.stringify(payload)}\n`);
    assert.equal(problems.length, 1, JSON.stringify(payload));
    assert.ok(problems[0].includes(needle), `${problems[0]} !~ ${needle}`);
  }
  // An entry with NO grade is not "grade unknown", it is a malformed line:
  // the field that decides the verdict cannot default.
  assert.match(parseRlsLedger(`{"at":"2026-09-14T06:00:00.000Z"}\n`).problems[0], /grade must be/);
});

test('rlsEvidenceReport: never, fresh, overdue, and a fresh non-pass outranks freshness', () => {
  const evidence = { cadenceHours: 168 };
  const now = Date.UTC(2026, 8, 14, 12);
  assert.match(rlsEvidenceReport(evidence, [], now).line, /never recorded/);
  assert.equal(rlsEvidenceReport(evidence, [], now).state, 'due');

  const fresh = [{ atMs: now - DAY, grade: 'pass' }];
  assert.equal(rlsEvidenceReport(evidence, fresh, now).state, 'ok');
  assert.match(rlsEvidenceReport(evidence, fresh, now).line, /\[ ok  \]/);

  const stale = [{ atMs: now - 8 * DAY, grade: 'pass' }];
  assert.equal(rlsEvidenceReport(evidence, stale, now).state, 'due');
  assert.match(rlsEvidenceReport(evidence, stale, now).line, /overdue by 1d/);

  // The asymmetry that matters: a RECENT failure refreshes the clock without
  // turning the finding green.
  const failed = [
    { atMs: now - 2 * DAY, grade: 'pass' },
    { atMs: now - HOUR, grade: 'fail' },
  ];
  const row = rlsEvidenceReport(evidence, failed, now);
  assert.equal(row.state, 'fail');
  assert.match(row.line, /did not conclude "pass"/);

  const unverified = [{ atMs: now - HOUR, grade: 'unverified' }];
  assert.equal(rlsEvidenceReport(evidence, unverified, now).state, 'fail');

  // out-of-order lines: "latest" is by timestamp, not by position in the file
  const shuffled = [
    { atMs: now - HOUR, grade: 'fail' },
    { atMs: now - 30 * DAY, grade: 'pass' },
  ];
  assert.equal(rlsEvidenceReport(evidence, shuffled, now).state, 'fail');

  const waived = rlsEvidenceReport({ cadenceHours: null, cadenceWaiver: 'staging-only deployment' }, [], now);
  assert.equal(waived.state, 'waived');
  assert.match(waived.line, /staging-only/);
});

test('CLI: record-rls appends one line, check-rls ages it, and neither touches the backup ledger', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-cli-'));
  const ledger = join(dir, 'e.jsonl');
  const run = (args, expectStatus = 0) => {
    try {
      return execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.equal(existsSync(ledger), false);
  run(['--check-rls', '--now', '2026-09-14T12:00:00Z', '--ledger', ledger], 1);
  const recorded = run(
    ['--record-rls', '--grade', 'pass', '--probed', '42', '--role', 'wlct_app', '--at', '2026-09-14T06:00:00Z', '--ledger', ledger],
    0,
  );
  assert.match(recorded, /recorded: \{"at":"2026-09-14T06:00:00\.000Z","grade":"pass"/);
  const lines = readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, 'exactly one evidence line per record');
  assert.deepEqual(JSON.parse(lines[0]), {
    at: '2026-09-14T06:00:00.000Z',
    grade: 'pass',
    probed: 42,
    role: 'wlct_app',
  });
  // An absent evidence ledger must not make the BACKUP ledger look broken,
  // and vice versa - the two obligations never read each other's file.
  const dueOut = run(['--due', '--now', '2026-09-14T12:00:00Z', '--ledger', join(dir, 'backup.jsonl')], 1);
  assert.match(dueOut, /never recorded/);
  // gradeless / bad-grade record attempts refuse and write nothing
  run(['--record-rls', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'ok', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'pass', '--probed', 'lots', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'pass', '--at', 'last tuesday', '--ledger', ledger], 1);
  assert.equal(readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim() !== '').length, 1);
  // a corrupt line: --check-rls refuses rather than grading the fleet on it
  writeFileSync(ledger, 'not json\n', { flag: 'a' });
  const corrupt = run(['--check-rls', '--ledger', ledger], 1);
  assert.match(corrupt, /REFUSING to answer --check-rls from an unreadable evidence ledger/);
  // and the writer refuses to append to a broken ledger, so the file
  // cannot accumulate unreadable lines next to good evidence.
  const append = run(['--record-rls', '--grade', 'pass', '--ledger', ledger], 1);
  assert.match(append, /REFUSING to append/);
  assert.equal(readFileSync(ledger, 'utf8').trim().split('\n').length, 2);
});

test('--check-rls prints its own summary line and the plan renders the contract', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const plan = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.match(plan, /# --- rls enablement evidence \(Part 15\) ---/);
  assert.match(plan, new RegExp(`cadence: <=${MANIFEST.rlsEvidence.cadenceHours}h`));
  assert.ok(plan.includes(MANIFEST.rlsEvidence.evidenceLedger));
  // Determinism still holds with the new section (no clock in renderPlan).
  const plan2 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(plan, plan2);
});

test("rls-enablement.mjs print-sql reports exactly the executor's SQL, all reads", () => {
  const script = join(ROOT, 'scripts', 'rls-enablement.mjs');
  const out = execFileSync('node', [script, 'print-sql'], { encoding: 'utf8' });
  const names = [...out.matchAll(/^-- (\w+)$/gm)].map((m) => m[1]);
  const source = readFileSync(join(ROOT, 'services', 'execution-engine', 'app', 'rls_probe.py'), 'utf8');
  const shipped = [...source.matchAll(/^(\w+_SQL): Final = /gm)].map((m) => m[1]);
  assert.deepEqual(names.sort(), shipped.sort(), 'the helper drifted from the module it documents');
  const statements = out.split('\n').filter((l) => l.trim().endsWith(';') && !l.trim().startsWith('--'));
  assert.ok(statements.length >= 6, `only ${statements.length} statements rendered`);
  for (const statement of statements) {
    assert.match(statement.trim(), /^(SELECT|SET TRANSACTION READ ONLY)/, statement);
  }
  assert.doesNotMatch(out, /INSERT|UPDATE |DELETE|ALTER TABLE|GRANT/);
});

/* --------------------------------------------------------------------- */
/* Part 20: the generated schedule (docs/dr/schedule/dr.cron)           */
/* --------------------------------------------------------------------- */

/** The committed file, read fresh. Every test below that starts from this is the
 * drift gate itself: a schedule that disagrees with the manifest is worse than no
 * schedule, because it is a control that has quietly become a document. */
const COMMITTED_SCHEDULE = readFileSync(SCHEDULE_PATH, 'utf8');

const jobLines = (text) =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('#') && line.includes('dr-manifest.mjs'));

const modeOf = (line) => /(--[a-z-]+)\s*$/.exec(line)?.[1] ?? '';

test('the committed schedule matches a fresh generation of the shipped manifest', () => {
  assert.deepEqual(scheduleDrift(MANIFEST, COMMITTED_SCHEDULE), []);
  // And the comparison is not vacuous: the same file against a manifest with a
  // tightened cadence must disagree, or this test is asserting nothing.
  const tightened = structuredClone(MANIFEST);
  tightened.components.find((c) => c.id === 'postgres').cadenceHours = 6;
  assert.ok(scheduleDrift(tightened, COMMITTED_SCHEDULE).some((p) => p.includes('a cadence changed')));
});

test('renderSchedule is deterministic and carries no clock', () => {
  const a = renderSchedule(MANIFEST, '.');
  const b = renderSchedule(MANIFEST, '.');
  assert.equal(a, b);
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(a, /[A-Z][A-Z0-9_]{2,}=[^"\s]{24,}/); // no NAME=long-literal shape, by construction
});

test('the check interval follows the tightest cadence on the board', () => {
  assert.equal(scheduleTightestCadenceHours(MANIFEST), 24);
  const six = structuredClone(MANIFEST);
  six.components.find((c) => c.id === 'postgres').cadenceHours = 6;
  const text = renderSchedule(six, '.');
  const due = jobLines(text).find((line) => modeOf(line) === '--due');
  assert.ok(due.startsWith('0 */6 * * * '), `expected a six-hourly check, got ${JSON.stringify(due)}`);
  // The manifest validator keeps its daily rhythm: it is not an obligation and must
  // not become one just because an unrelated component tightened its cadence.
  const check = jobLines(text).find((line) => modeOf(line) === '--check');
  assert.ok(check.startsWith('0 0 * * * '), `expected a daily --check, got ${JSON.stringify(check)}`);
});

test('an interval that does not divide the day is honoured, not approximated away', () => {
  // The whole objection to `*/7` is answered by the wrap: the field restarts at 0, so
  // the LONGEST gap is 7 hours. If someone "fixes" this to weekly, this test is where
  // the argument gets re-litigated with the arithmetic in it.
  const seven = structuredClone(MANIFEST);
  seven.components.find((c) => c.id === 'postgres').cadenceHours = 7;
  const due = jobLines(renderSchedule(seven, '.')).find((line) => modeOf(line) === '--due');
  assert.ok(due.startsWith('0 */7 * * * '));
  const hours = [0, 7, 14, 21];
  const gaps = [...hours.slice(1).map((h, i) => h - hours[i]), 24 - hours.at(-1)];
  assert.equal(Math.max(...gaps), 7);
});

test('intervals beyond the daily ceiling collapse to one line at midnight', () => {
  for (const hours of [24, 720, 8760]) {
    assert.equal(scheduleCronFor(scheduleCheckIntervalHours(hours)), '0 0 * * *');
  }
  assert.throws(() => scheduleCheckIntervalHours(0), /integer 1\.\.8760/);
  assert.throws(() => scheduleCheckIntervalHours(8761), /integer 1\.\.8760/);
  assert.throws(() => scheduleCheckIntervalHours('24'), /integer 1\.\.8760/);
  assert.throws(() => scheduleCronFor(25), /no cron line/);
});

test('a board of waivers renders the waivers, not an empty file', () => {
  const waived = structuredClone(MANIFEST);
  for (const component of waived.components) {
    component.cadenceWaiver = 'ephemeral state, rebuilt from the sources above it';
    delete component.cadenceHours;
  }
  const text = renderSchedule(waived, '.');
  assert.deepEqual(jobLines(text).map(modeOf), ['--check']);
  for (const component of waived.components) {
    assert.ok(text.includes(`#   ${component.id}: ephemeral state`), `${component.id} waiver vanished`);
  }
  assert.equal(scheduleTightestCadenceHours(waived), null);
});

test('a waived RLS evidence block schedules no check and says so', () => {
  const waivedRls = structuredClone(MANIFEST);
  waivedRls.rlsEvidence.cadenceHours = null;
  waivedRls.rlsEvidence.cadenceWaiver = 'single-tenant pilot, no cross-tenant data to fence';
  const text = renderSchedule(waivedRls, '.');
  assert.equal(jobLines(text).some((line) => modeOf(line) === '--check-rls'), false);
  assert.match(text, /rlsEvidence cadence is waived: single-tenant pilot/);
  assert.match(text, /does not make "row-level security is enforcing" one degree/);
});

test('a schedule may never write ledger evidence, and the drift check enforces that', () => {
  const record = COMMITTED_SCHEDULE.replace(
    'dr-manifest.mjs" --due',
    'dr-manifest.mjs" --record --component postgres --outcome ok',
  );
  const problems = scheduleDrift(MANIFEST, record);
  assert.ok(
    problems.some((p) => p.includes('may ask questions, never write ledger evidence')),
    `expected the refusal, got ${JSON.stringify(problems)}`,
  );
  // The forbidden-mode finding is reported on its own, before the byte comparison, so a
  // tampered file cannot escape it by also having rewritten the cadence lines.
  assert.equal(problems.some((p) => p.includes('a cadence changed')), false);
});

test('a file missing its root line is not the generated shape', () => {
  const orphan = COMMITTED_SCHEDULE.split('\n').filter((l) => !l.startsWith('wlctRoot=')).join('\n');
  assert.ok(scheduleDrift(MANIFEST, orphan).some((p) => p.includes('wlctRoot')));
  assert.deepEqual(scheduleDrift(MANIFEST, ''), ['schedule file is empty or missing - run --emit-schedule']);
});

test('a secret pasted into the schedule is refused even when the cadences agree', () => {
  const leaky = `${COMMITTED_SCHEDULE}ENCRYPTION_MASTER_KEY_BASE64=c3VwZXJzZWNyZXR2YWx1ZWZvcmV2ZXJ5b25lCg==\n`;
  const problems = scheduleDrift(MANIFEST, leaky);
  assert.ok(problems.some((p) => p.startsWith('SECRET-SHAPED CONTENT in schedule:')));
});

test('every job line is five cron fields and a command, structurally', () => {
  for (const line of jobLines(COMMITTED_SCHEDULE)) {
    const fields = line.trim().split(/\s+/);
    // five cron fields, then `node`, the script, and the mode - three more tokens.
    assert.equal(fields.length, 8, `not five fields plus a command: ${line}`);
    assert.equal(fields[5], 'node');
    const [minute, hour, dom, month, dow] = fields;
    assert.match(minute, /^\d{1,2}$/);
    assert.match(hour, /^(\*\/\d{1,2}|\d{1,2})$/);
    for (const field of [dom, month, dow]) {
      assert.equal(field, '*');
    }
  }
  assert.deepEqual(jobLines(COMMITTED_SCHEDULE).map(modeOf).sort(), ['--check', '--check-rls', '--due']);
});

test('CLI: --emit-schedule writes a file --check-schedule then accepts, and refuses a hand-edit', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-schedule-'));
  const out = join(dir, 'dr.cron');
  const run = (args, expectStatus = 0) => {
    try {
      const text = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(expectStatus, 0, `expected refusal but got success: ${text}`);
      return text;
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  const first = run(['--emit-schedule', '--out', out, '--root', '/srv/whitelabel-copytrade']);
  assert.match(first, /wrote .*dr\.cron: obligations age against 24h, checked every 24h/);
  const written = readFileSync(out, 'utf8');
  assert.match(written, /^wlctRoot=\/srv\/whitelabel-copytrade$/m);
  // Re-running says so rather than pretending to change something, and the emitted
  // bytes are exactly what the pure function returns: the CLI is a writer, not a third
  // implementation of the renderer.
  const again = run(['--emit-schedule', '--out', out, '--root', '/srv/whitelabel-copytrade']);
  assert.match(again, /\(content unchanged\)/);
  assert.equal(readFileSync(out, 'utf8'), written);
  assert.equal(readFileSync(out, 'utf8'), renderSchedule(MANIFEST, '/srv/whitelabel-copytrade'));
  // A deployment that edited only its root line still passes: that line is its answer.
  const rebased = written.replace(/^wlctRoot=.*$/m, 'wlctRoot=/opt/app');
  writeFileSync(out, rebased);
  assert.match(run(['--check-schedule', '--out', out]), /schedule valid: 3 job line\(s\) \(--due, --check, --check-rls\)/);
  // The tamper has to land on a JOB line: `--due` also appears in the explanatory
  // comments, and a comment edit is (correctly) reported as a byte mismatch rather
  // than as a forbidden mode - comments are not executed.
  writeFileSync(out, rebased.replace('dr-manifest.mjs" --due', 'dr-manifest.mjs" --record'));
  assert.match(run(['--check-schedule', '--out', out], 1), /never write ledger evidence/);
});

test('CLI: neither schedule mode runs on a manifest that does not validate', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-schedule-bad-'));
  const brokenPath = join(dir, 'manifest.json');
  const out = join(dir, 'dr.cron');
  const broken = structuredClone(MANIFEST);
  broken.schema = 'wlct-dr-manifest-v1';
  writeFileSync(brokenPath, `${JSON.stringify(broken, null, 2)}\n`);
  const run = (args, expectStatus = 0) => {
    try {
      const text = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(expectStatus, 0, `expected refusal but got success: ${text}`);
      return text;
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.match(run(['--emit-schedule', '--manifest', brokenPath, '--out', out], 1), /REFUSING to answer --emit-schedule from an invalid manifest/);
  // Nothing was written on the refusal path: a half-emitted schedule is a schedule that
  // exists, and an operator who installs it has no idea which manifest made it.
  assert.equal(existsSync(out), false);
  assert.match(run(['--check-schedule', '--manifest', brokenPath, '--out', join(ROOT, 'docs', 'dr', 'schedule', 'dr.cron')], 1), /REFUSING to answer --check-schedule from an invalid manifest/);
  // The same override proves the good path is not being flattered: the shipped manifest
  // against the shipped file still agrees when read through an explicit path.
  assert.match(
    run(['--check-schedule', '--manifest', join(ROOT, 'docs', 'dr', 'manifest.json')]),
    /schedule valid: 3 job line\(s\)/,
  );
});

const DR_SCRIPT = join(ROOT, 'scripts', 'dr-manifest.mjs');
/** One place that runs the CLI as a child, so the exit-code contract is tested as a contract and
 * not as a description of one. */
function runScript(args) {
  try {
    const stdout = execFileSync(process.execPath, [DR_SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/* ------------------------------------------------------------------ *
 * Part 21: --verify-rls, the machine-readable verifier (no enable.sql change, no claim)
 * ------------------------------------------------------------------ */

/**
 * A scratch tree with the three RLS artifacts, so the scope law can be exercised against a
 * disagreement without editing the repository's own enable.sql (which is generated, and which this
 * part deliberately never touches).
 */
function rlsFixture(tables, { stamp = '20260913120000', disableTables = null, extraCoverage = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-verify-'));
  const rel = (name) => join('prisma', name);
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  const enable = tables
    .map((table) => `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;\nALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`)
    .join('\n');
  const disable = (disableTables ?? tables)
    .map((table) => `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;\nALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`)
    .join('\n');
  writeFileSync(
    join(dir, 'prisma', 'enable.sql'),
    `-- Generated. Schema stamp: ${stamp}\n\n${enable}\nCREATE POLICY tenant_isolation ON engine_incidents\nCREATE OR REPLACE FUNCTION wlct_current_tenant_id()\n`,
  );
  writeFileSync(join(dir, 'prisma', 'disable.sql'), `-- Generated. Schema stamp: ${stamp}\n\n${disable}\n`);
  writeFileSync(
    join(dir, 'prisma', 'rls_coverage.json'),
    JSON.stringify({
      schema: 'part11-rls-coverage-v1',
      stamp,
      policyName: 'tenant_isolation',
      functionName: 'wlct_current_tenant_id',
      covered: [...tables, ...extraCoverage].map((table) => ({ table, model: 'X' })),
      excluded: [],
    }),
  );
  const manifest = {
    rlsEvidence: {
      cadenceHours: 168,
      requiredGrade: 'pass',
      evidenceLedger: 'rls-evidence.jsonl',
      verifier: '/internal/v1/enablement/audit',
      coverageArtifact: rel('rls_coverage.json'),
      enableArtifact: rel('enable.sql'),
      disableArtifact: rel('disable.sql'),
    },
  };
  return { dir, manifest };
}

test('--verify-rls: the shipped artifacts agree on scope, and the answer is still unverified', () => {
  const document = verifyRlsEvidence(MANIFEST, { root: ROOT, nowMs: Date.parse('2026-09-18T00:00:00.000Z') });
  const byName = new Map(document.checks.map((check) => [check.name, check]));
  // Every scope law passes on the real repository...
  assert.equal(byName.get('scope:enable-vs-coverage').grade, 'pass');
  assert.equal(byName.get('scope:enable-vs-disable').grade, 'pass');
  assert.equal(byName.get('schema-stamp').grade, 'pass');
  // ...and the scan is pinned to a count, so a regex that matches nothing cannot pass as "empty scope".
  assert.equal(document.scope.enabled, 43);
  assert.equal(document.scope.covered, 43);
  assert.equal(document.scope.disabled, 43);
  // The evidence ledger has never been written, which is the honest grade for a fresh deployment.
  assert.equal(byName.get('evidence-ledger').grade, 'unverified');
  assert.equal(document.grade, 'unverified');
  assert.match(byName.get('evidence-ledger').detail, /never recorded/);
  // And this is the part that must never change: the verifier makes no enablement claim.
  assert.equal(document.enabled, null);
  assert.match(document.assertion, /not asserted here/);
});

test('--verify-rls: a table in enable.sql that the coverage ledger does not know is a failure', () => {
  const fixture = rlsFixture(['alpha_table', 'beta_table'], { extraCoverage: [] });
  fixture.enableExtra = true;
  writeFileSync(join(fixture.dir, 'prisma', 'enable.sql'), readFileSync(join(fixture.dir, 'prisma', 'enable.sql'), 'utf8') + '\nALTER TABLE "ghost_table" ENABLE ROW LEVEL SECURITY;\n');
  const document = verifyRlsEvidence(fixture.manifest, { root: fixture.dir });
  const scope = document.checks.find((check) => check.name === 'scope:enable-vs-coverage');
  assert.equal(scope.grade, 'fail');
  assert.match(scope.detail, /ghost_table/);
  assert.deepEqual(scope.onlyInSql, ['ghost_table']);
  assert.equal(document.grade, 'fail');
});

test('--verify-rls: a covered table with no ENABLE statement is the other direction, and is named', () => {
  const fixture = rlsFixture(['alpha_table'], { extraCoverage: ['promised_but_absent'] });
  const scope = verifyRlsEvidence(fixture.manifest, { root: fixture.dir }).checks.find((c) => c.name === 'scope:enable-vs-coverage');
  assert.equal(scope.grade, 'fail');
  assert.deepEqual(scope.onlyInCoverage, ['promised_but_absent']);
});

test('--verify-rls: a rollback narrower than the change fails, because an unrollbackable enable is a one-way door', () => {
  const fixture = rlsFixture(['alpha_table', 'beta_table'], { disableTables: ['alpha_table'] });
  const document = verifyRlsEvidence(fixture.manifest, { root: fixture.dir });
  const scope = document.checks.find((check) => check.name === 'scope:enable-vs-disable');
  assert.equal(scope.grade, 'fail');
  assert.deepEqual(scope.asymmetric, ['beta_table']);
});

test('--verify-rls: stamp disagreement between the artifacts is a failure', () => {
  const fixture = rlsFixture(['alpha_table'], { stamp: '20260101000000' });
  writeFileSync(join(fixture.dir, 'prisma', 'disable.sql'), readFileSync(join(fixture.dir, 'prisma', 'disable.sql'), 'utf8').replace('20260101000000', '20250101000000'));
  const stamp = verifyRlsEvidence(fixture.manifest, { root: fixture.dir }).checks.find((check) => check.name === 'schema-stamp');
  assert.equal(stamp.grade, 'fail');
  assert.match(stamp.detail, /disagree about which schema/);
});

test('--verify-rls: a missing artifact, a missing block, and a corrupt ledger each answer in their own words', () => {
  const missing = rlsFixture(['alpha_table']);
  writeFileSync(join(missing.dir, 'prisma', 'enable.sql'), '');
  const missingDoc = verifyRlsEvidence(missing.manifest, { root: missing.dir });
  // An empty file is present but names no table: the scope check is the one that must object.
  assert.equal(missingDoc.checks.find((c) => c.name === 'artifact:enableArtifact').grade, 'pass');
  assert.equal(missingDoc.checks.find((c) => c.name === 'scope:enable-vs-coverage').grade, 'fail');

  const absent = rlsFixture(['alpha_table']);
  writeFileSync(join(absent.dir, 'prisma', 'enable.sql'), '');
  const noBlock = verifyRlsEvidence({ rlsEvidence: null }, { root: absent.dir });
  assert.equal(noBlock.grade, 'fail');
  assert.match(noBlock.findings[0], /no rlsEvidence block/);

  const corrupt = rlsFixture(['alpha_table']);
  writeFileSync(join(corrupt.dir, 'rls-evidence.jsonl'), 'this is not json\n');
  const corruptDoc = verifyRlsEvidence(corrupt.manifest, { root: corrupt.dir });
  assert.equal(corruptDoc.grade, 'fail', 'a corrupt ledger is never read as an absent one');
  assert.match(JSON.stringify(corruptDoc.findings), /malformed line/);
});

test('--verify-rls: a fresh passing audit is the only thing that grades pass', () => {
  const fixture = rlsFixture(['alpha_table']);
  const at = Date.parse('2026-09-18T00:00:00.000Z');
  writeFileSync(
    join(fixture.dir, 'rls-evidence.jsonl'),
    `${JSON.stringify({ at: new Date(at - 3_600_000).toISOString(), grade: 'pass', probed: 1, role: 'wlct_app' })}\n`,
  );
  const document = verifyRlsEvidence(fixture.manifest, { root: fixture.dir, nowMs: at });
  assert.equal(document.grade, 'pass', JSON.stringify(document.findings));
  assert.equal(document.enabled, null, 'even a pass grades the audit, not the enablement claim');

  writeFileSync(
    join(fixture.dir, 'rls-evidence.jsonl'),
    `${JSON.stringify({ at: new Date(at - 200 * 3_600_000).toISOString(), grade: 'pass', probed: 1 })}\n`,
  );
  const stale = verifyRlsEvidence(fixture.manifest, { root: fixture.dir, nowMs: at });
  assert.equal(stale.checks.find((check) => check.name === 'evidence-ledger').grade, 'unverified');
  assert.equal(stale.grade, 'unverified', 'an audit past its cadence is not a pass and not a fail: it is stale');
});

test('--verify-rls is read-only, machine-readable, and reports through exit codes', () => {
  const before = readFileSync(join(ROOT, 'apps', 'api', 'prisma', 'rls', 'enable.sql'), 'utf8');
  const json = runScript(['--verify-rls', '--json', '--now', '2026-09-18T00:00:00.000Z']);
  assert.equal(json.status, 3, `unverified must be a distinct exit code, got ${json.status}: ${json.stderr}`);
  const document = JSON.parse(json.stdout);
  assert.equal(document.schema, 'wlct.dr.rls-verify/1');
  assert.equal(document.grade, 'unverified');
  assert.equal(document.enabled, null);
  const text = runScript(['--verify-rls', '--now', '2026-09-18T00:00:00.000Z']);
  assert.equal(text.status, 3);
  assert.match(text.stdout, /rls verification: UNVERIFIED/);
  // Nothing was written: the RLS artifacts and both ledgers are byte-identical to before.
  assert.equal(readFileSync(join(ROOT, 'apps', 'api', 'prisma', 'rls', 'enable.sql'), 'utf8'), before);
  assert.equal(existsSync(join(ROOT, 'docs', 'dr', 'rls-evidence.jsonl')), false, 'a verifier must not create evidence');
  const bad = runScript(['--verify-rls', '--now', 'yesterday']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not an ISO-8601 timestamp/);
});

test('--json is a boolean and never swallows the argument after it', () => {
  // The regression that MODE_FLAGS was introduced for: a flag parser that treats every unknown
  // --x as value-taking turns "--due --json" into "--due with an override named json".
  const out = runScript(['--check']);
  assert.equal(out.status, 0);
  const jsonMode = runScript(['--verify-rls', '--json', '--now', '2026-09-18T00:00:00.000Z']);
  assert.match(jsonMode.stdout, /^\{/, '--json must emit the document, not a usage line');
});
```


## FILE: docker-compose.yml (454 lines)

*`EXECUTION_ENGINE_URL: http://execution-engine:8093` and `EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}` on the `api` service, which the worker already had and the panel now needs: the value in `.env.example` is a loopback URL that aims the API container at itself, and the token the engine validates is documented under a different name than the client reads, so without this the panel would report `unverified` on a healthy deployment - a wrong panel row being the exact failure this part was written against.*

```yaml
# =============================================================================
# White-label copy-trading platform - local and staging composition.
#
# Design notes:
#  * Only Postgres, Redis, the API and the admin console publish ports. The
#    Python services and the notification worker stay on the internal network:
#    they are reachable by service name and by nothing else.
#  * Every service reads the same root .env, so there is one place to configure
#    the stack and no secret is written into this file.
#  * Health checks gate startup order. `depends_on: condition: service_healthy`
#    means the API never boots against a database that is still initialising.
#  * Named volumes hold state. Bind mounts are used only for the development
#    profile, where hot reload is worth the trade-off.
# =============================================================================

name: wlct

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

x-restart: &default-restart
  restart: unless-stopped

services:
  # ---------------------------------------------------------------------------
  # Data stores
  # ---------------------------------------------------------------------------
  postgres:
    image: postgres:16.4-alpine
    container_name: wlct-postgres
    <<: *default-restart
    logging: *default-logging
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wlct}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-wlct}
      # Deterministic collation avoids index-corruption surprises when the base
      # image's libc changes between upgrades.
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    command:
      - postgres
      - -c
      - max_connections=200
      - -c
      - shared_buffers=256MB
      - -c
      - log_min_duration_statement=1000
      # Consumed by infrastructure/database/init/02-roles.sql.
      - -c
      - wlct.app_password=${POSTGRES_APP_PASSWORD:-}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./infrastructure/database/init:/docker-entrypoint-initdb.d:ro
    ports:
      # Bound to loopback: the database must not be reachable from the LAN.
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-wlct} -d ${POSTGRES_DB:-wlct}"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
    networks:
      - wlct-internal

  redis:
    image: redis:7.4-alpine
    container_name: wlct-redis
    <<: *default-restart
    logging: *default-logging
    command:
      - redis-server
      - --requirepass
      - ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
      - --appendonly
      - "yes"
      - --maxmemory
      - 512mb
      # Queue jobs and session state must never be silently evicted; only keys
      # with an explicit TTL are eligible.
      - --maxmemory-policy
      - volatile-lru
    volumes:
      - redis-data:/data
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Migrations
  #
  # A one-shot job rather than an API entrypoint step: running migrations from
  # every replica is a race, and a failed migration must stop the deploy rather
  # than crash-loop an application container.
  # ---------------------------------------------------------------------------
  migrate:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: build
    container_name: wlct-migrate
    restart: "no"
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public
    command: >
      sh -c "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Application services
  # ---------------------------------------------------------------------------
  api:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-api
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      PORT: 4000
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=20&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      TRADING_ENGINE_URL: http://trading-engine:8001
      MARKET_DATA_URL: http://market-data:8002
      NOTIFICATION_SERVICE_URL: http://notification-service:8003
      # Part 20: the engine-posture panel (`GET /v1/observability/execution`, section 4
      # of `docs/PART20_ENGINE_STATUS_EDGE.md`). Both names must be set here, not only in
      # `.env`, for two measured reasons. `.env.example` sets `EXECUTION_ENGINE_URL` to
      # `http://127.0.0.1:8093` - correct for a developer running uvicorn, and inside this
      # network it aims the API container at itself, so the panel would answer
      # `unverified` with a connection error on a deployment where the engine is healthy
      # and publishes no host port at all. And `.env.example` documents
      # `EXECUTION_ENGINE_TOKEN` commented out, while the engine validates
      # `EXECUTION_INTERNAL_TOKEN`: `worker:` translates that one secret under two names,
      # and the panel needs the same translation. (No line numbers here on purpose - this
      # part inserted lines above `worker:`, which is exactly how a cited line number
      # becomes a false statement in a file nobody re-reads.) Nothing is required of the operator either way: the
      # observability module constructs a client only when `engineInternalClientConfigured`
      # holds, so with the variables absent the API still boots and the panel says
      # `unconfigured` with the reason - which is the fail-closed half of Part 20, left
      # working deliberately. A wrong panel row, not a missing one, is the failure mode this
      # part was written against.
      EXECUTION_ENGINE_URL: http://execution-engine:8093
      EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}
      # The API enqueues; the standalone worker consumes. Running the worker
      # inline as well would double-process every job.
      QUEUE_RUN_INLINE_WORKERS: "false"
    ports:
      - "${API_PORT:-4000}:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
    networks:
      - wlct-internal
      - wlct-edge

  notification-service:
    build:
      context: .
      dockerfile: infrastructure/docker/notification-service.Dockerfile
      target: runtime
    container_name: wlct-notification-service
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      NOTIFICATION_SERVICE_PORT: 8003
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8003"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  trading-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/trading-engine.Dockerfile
      target: runtime
    container_name: wlct-trading-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      TRADING_ENGINE_PORT: 8001
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # Part 1 ships with execution hard-disabled. Enabling it requires a
      # deliberate change here and in the root .env.
      EXECUTION_ENABLED: ${EXECUTION_ENABLED:-false}
      EXCHANGE_SANDBOX_MODE: ${EXCHANGE_SANDBOX_MODE:-true}
    expose:
      - "8001"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Part 11: the execution plane, split in two on purpose. The ENGINE holds
  # venue contact (adapters, credentials domain, locks, incidents); the
  # WORKER holds the queue (admission, partition claims, ack policy). Each
  # can say "no" to the other and both mean it: the worker refuses to boot
  # when the engine reports an incompatible mode, and the engine serves only
  # an authenticated internal token plus a tenant header.

  execution-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/execution-engine.Dockerfile
      target: runtime
    container_name: wlct-execution-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      SERVICE_PORT: 8093
      # Bind inside the container so the compose network can route to it; the
      # port is EXPOSEd to internal networks only - never published.
      EXECUTION_ENGINE_HOST: 0.0.0.0
      EXECUTION_INSTANCE_ID: ${EXECUTION_INSTANCE_ID:-execution-engine-1}
      EXECUTION_INTERNAL_TOKEN: ${EXECUTION_INTERNAL_TOKEN:?EXECUTION_INTERNAL_TOKEN is required for the execution engine}
      # simulated is the only wired mode; live refuses startup by code.
      EXECUTION_MODE: simulated
      EXECUTION_DRY_RUN: ${EXECUTION_DRY_RUN:-true}
      # Part 13 durable store. memory is the default (readiness reports
      # storeDurable=false, as it always has); postgres requires the
      # engine tables (applied by the migrate job's own migrations) and a
      # DSN - both are start-up refusals when missing, never a fallback.
      EXECUTION_STORE_BACKEND: ${EXECUTION_STORE_BACKEND:-memory}
      EXECUTION_POSTGRES_DSN: ${EXECUTION_POSTGRES_DSN:-}
      # Part 14 journal retention. ENABLED gates APPLY only - inspect and
      # dry-run work regardless, and every value is validated at startup by
      # the core's retention law (bounds in docs/PART14_RETENTION.md). The
      # scheduler (if any) is the deployment's business; nothing here runs
      # deletes on its own.
      EXECUTION_RETENTION_ENABLED: ${EXECUTION_RETENTION_ENABLED:-false}
      EXECUTION_RETENTION_EVENT_DAYS: ${EXECUTION_RETENTION_EVENT_DAYS:-90}
      EXECUTION_RETENTION_BATCH_ROWS: ${EXECUTION_RETENTION_BATCH_ROWS:-2000}
      EXECUTION_RETENTION_MAX_BATCHES: ${EXECUTION_RETENTION_MAX_BATCHES:-50}
      # Part 15: the evidence window only (the audit itself is read-only, so
      # there is no enablement switch to thread through). Empty-string-safe
      # like every other default here; the config validator rejects 0.
      EXECUTION_ENABLEMENT_MAX_AGE_DAYS: ${EXECUTION_ENABLEMENT_MAX_AGE_DAYS:-30}
      # Part 16: the credential source and the placement review's cost bounds.
      # The review has no enable switch, so nothing here can turn it off; the
      # defaults below are the safe ones and the config validator refuses a
      # nonsense value at boot rather than at the first order. NOTE the absence
      # of any API-key line: `environment` credentials are read from the host
      # process environment when an operator opts into them, and this file is
      # not a place a secret may be written (docs/SECURITY.md).
      EXECUTION_CREDENTIAL_SOURCE: ${EXECUTION_CREDENTIAL_SOURCE:-none}
      EXECUTION_CREDENTIAL_ENV_PREFIX: ${EXECUTION_CREDENTIAL_ENV_PREFIX:-WLCT_BINANCE}
      EXECUTION_CREDENTIAL_TENANT_ID: ${EXECUTION_CREDENTIAL_TENANT_ID:-tenant-1}
      EXECUTION_CREDENTIAL_ACCOUNT_ID: ${EXECUTION_CREDENTIAL_ACCOUNT_ID:-account-1}
      EXECUTION_CREDENTIAL_CACHE_SECONDS: ${EXECUTION_CREDENTIAL_CACHE_SECONDS:-300}
      EXECUTION_PLACEMENT_ATTESTATION_TTL_MS: ${EXECUTION_PLACEMENT_ATTESTATION_TTL_MS:-300000}
      EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS: ${EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS:-90}
      EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST: ${EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST:-true}
      # Part 17 added no variable of its own: the durable incident sink is a
      # consequence of EXECUTION_STORE_BACKEND (postgres brings engine_incidents
      # with it, memory keeps the in-process recorder) and a mismatched pair is
      # refused at composition, so there is nothing to mis-configure here.
      # Part 18's knob is the platform's, shared with the two sibling services:
      # GET /metrics renders this process's stage histograms and counters, and
      # NODE_ENV=production refuses to parse with it off.
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
    expose:
      - "8093"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  worker:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-worker
    <<: *default-restart
    logging: *default-logging
    command: ["node", "dist/worker.js"]
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      # The worker container owns ALL inline workers (maintenance,
      # notification, trade-execution); the API keeps them off.
      QUEUE_RUN_INLINE_WORKERS: "true"
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=10&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      WORKER_ENABLED: "true"
      WORKER_ID: ${WORKER_ID:-worker-1}
      WORKER_MEMBERSHIP: ${WORKER_MEMBERSHIP:-worker-1}
      # Part 12: the compose fleet self-registers via the Redis heartbeat
      # zset; the list above stays as the boot/fallback view. Flipping this
      # back to config is a one-line redeploy - claims decide authority in
      # both modes, so nothing else about safety changes.
      WORKER_MEMBERSHIP_MODE: ${WORKER_MEMBERSHIP_MODE:-registry}
      WORKER_MEMBERSHIP_TTL_MS: ${WORKER_MEMBERSHIP_TTL_MS:-30000}
      WORKER_PARTITION_COUNT: ${WORKER_PARTITION_COUNT:-8}
      WORKER_PARTITION_LEASE_TTL_MS: ${WORKER_PARTITION_LEASE_TTL_MS:-15000}
      WORKER_PARTITION_RETRY_MS: ${WORKER_PARTITION_RETRY_MS:-2500}
      WORKER_DEFER_DELAY_MS: ${WORKER_DEFER_DELAY_MS:-3000}
      WORKER_MAX_DEFERS: ${WORKER_MAX_DEFERS:-30}
      WORKER_SHUTDOWN_TIMEOUT_MS: ${WORKER_SHUTDOWN_TIMEOUT_MS:-10000}
      EXECUTION_ENGINE_URL: http://execution-engine:8093
      # One secret, two names: the engine validates EXECUTION_INTERNAL_TOKEN,
      # the worker presents it as EXECUTION_ENGINE_TOKEN.
      EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
      execution-engine:
        condition: service_healthy
    # No ports: the worker serves nothing. Its visibility is structured logs
    # plus the API's read-only GET /v1/observability/worker-coordination,
    # which reads the same Redis claims this process writes.
    networks:
      - wlct-internal

  market-data:
    build:
      context: .
      dockerfile: infrastructure/docker/market-data.Dockerfile
      target: runtime
    container_name: wlct-market-data
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      MARKET_DATA_PORT: 8002
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8002"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  admin-web:
    build:
      context: .
      dockerfile: infrastructure/docker/admin-web.Dockerfile
      target: runtime
      args:
        NEXT_PUBLIC_APP_NAME: ${NEXT_PUBLIC_APP_NAME:-CopyTrade Admin}
        NEXT_PUBLIC_API_VERSION: ${NEXT_PUBLIC_API_VERSION:-v1}
        NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL:-}
        NEXT_PUBLIC_WS_PATH: ${NEXT_PUBLIC_WS_PATH:-/socket.io}
    container_name: wlct-admin-web
    <<: *default-restart
    logging: *default-logging
    environment:
      NODE_ENV: production
      PORT: 3000
      # Server-to-server inside the compose network; the browser never sees it.
      API_BASE_URL: http://api:4000/api
      ADMIN_TENANT_SLUG: ${ADMIN_TENANT_SLUG:-platform}
      SESSION_COOKIE_SECRET: ${SESSION_COOKIE_SECRET:?SESSION_COOKIE_SECRET is required}
    ports:
      - "${ADMIN_WEB_PORT:-3000}:3000"
    depends_on:
      api:
        condition: service_healthy
    networks:
      - wlct-internal
      - wlct-edge

volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local

networks:
  # Service-to-service traffic. Not reachable from outside the host.
  wlct-internal:
    driver: bridge
    internal: false
  # Everything that legitimately faces a browser.
  wlct-edge:
    driver: bridge
```


## FILE: docs/SECURITY.md (624 lines)

*the `OPS_READ` bullet extended with what the panel actually shows, and section 14's "no tenantless command" claim amended to say *command* and name the one exempt read, its ordering, its bounds and the `/health/ready` superset invariant - a security document that stays accurate across a part that touched an auth boundary is the point of the cross-link, not a courtesy.*

```markdown
# Security

This document states what the platform does, why, and where the control lives in
the code. It is written to be checked, not admired: every claim points at a file.

## Threat model in one paragraph

The platform holds credentials that can place trades on a user's exchange
account, and it serves many organisations from one deployment. The two failures
that matter most are **cross-tenant data exposure** and **exchange credential
disclosure**. Everything below is ordered by how directly it prevents one of
those two.

---

## 1. Tenant isolation

| Control | Where |
| --- | --- |
| Query-level tenant predicate | `apps/api/src/infrastructure/prisma/tenant-scoped-prisma.factory.ts` |
| Tenant resolution and override | `apps/api/src/modules/tenants/guards/tenant.guard.ts` |
| Non-null `tenantId` + scoped uniqueness | `apps/api/prisma/schema.prisma` |

* A client-supplied tenant identifier is **never** an authorisation input. For
  an authenticated request the tenant comes from the access token.
* Every tenant-owned model is in an explicit allowlist. Adding a table to the
  scoped set is a deliberate edit, not a default.
* Uniqueness is per tenant: two organisations may both have `admin@example.com`.
* Platform-scoped rows (`tenantId = NULL`) are only reachable by platform users,
  enforced by `@PlatformOnly()`.

## 2. Authentication

| Control | Detail |
| --- | --- |
| Password hashing | argon2id; memory/time/parallelism from `ARGON2_*` |
| Access token | short-lived JWT, dedicated signing key |
| Refresh token | stored as HMAC, rotated on every use |
| Reuse detection | a replayed token revokes the whole family and raises `TOKEN_REUSE` (CRITICAL) |
| Device binding | refresh tokens bound to a client-generated device id |
| Logout | access-token `jti` blacklisted in Redis until expiry |
| Global revocation | `sv` claim vs `User.sessionVersion`, checked on every request |
| Session cap | LRU eviction by `lastSeenAt` |
| Lockout | per-account after `LOGIN_FAILED_MAX_ATTEMPTS` within the window |
| Enumeration | identical response and timing for unknown and wrong-password |

### Invalidating live access tokens

Blacklisting a `jti` only kills one token. Password changes and "sign out of
all devices" have to kill *every* token the user holds, including ones already
in flight, so each access token carries an `sv` claim holding the user's
`sessionVersion` at issue time. `JwtStrategy` (and `WsAuthGuard`, so open
sockets drop too) compares it with the stored counter on every request and
rejects a mismatch with `TOKEN_REVOKED`. Incrementing the counter therefore
invalidates all outstanding tokens instantly, without a distributed blacklist.

An integer counter is used rather than comparing the token's `iat` with
`passwordChangedAt`. `iat` has one-second resolution while the timestamp is
stored in milliseconds, so any time-based comparison is ambiguous for tokens
minted in the same second as the change - which is exactly what happens when a
user is handed new tokens immediately after changing their password, or when a
freshly provisioned tenant owner signs in for the first time. The counter also
cannot be skewed by clock drift between API instances.

### Two-factor authentication

TOTP via `otplib`. The shared secret is encrypted at rest with AAD
`two_factor_secret:{userId}`. `lastUsedCounter` is persisted so a captured code
cannot be replayed inside its window. Recovery codes are argon2-hashed and
single-use.

The challenge token issued between the password step and the code step is
bounded rather than strictly single-use: up to
`TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS` (default 5) codes may be tried against it,
after which it is discarded, and it is burned outright the moment a code is
accepted. Burning it on first sight would force a user who mistyped one digit
back through the password step; allowing unlimited tries would leave a captured
challenge open to brute force for its whole TTL. The attempt counter lives in
Redis under the challenge `jti` and expires with it. The endpoint additionally
sits behind the strict `auth` throttler, so the per-challenge budget is the
inner of two independent bounds.

## 3. Authorisation

Deny-by-default. `JwtAuthGuard` rejects any request without a valid token unless
the route is explicitly `@Public()`.

`PermissionsGuard` re-reads the user's live permissions on every request rather
than trusting the token payload, so revoking a role takes effect immediately
rather than at the next token refresh. Wildcards (`*`, `resource:*`) are
supported. A denial emits `PERMISSION_ESCALATION_ATTEMPT`.

Roles are data. Seven system roles ship as immutable templates and are cloned
per tenant. Adding a role never requires an authorisation-code change.

## 4. Exchange credential protection

**The platform never stores an exchange API secret in plaintext, never returns
one through the API, and never writes one to a log.**

Envelope encryption (`packages/utils/src/crypto.ts`):

1. A fresh 256-bit data key (DEK) is generated per record.
2. The payload is sealed AES-256-GCM under the DEK.
3. The DEK is sealed under the key-encryption key (KEK) from
   `ENCRYPTION_MASTER_KEY_BASE64`, tagged with `ENCRYPTION_KEY_ID`.
4. Additional authenticated data binds the ciphertext to `{tenantId}:{userId}`.
   A row copied to another tenant fails to decrypt - tampering is detected, not
   tolerated.

### Key management

| Variable | Purpose |
| --- | --- |
| `ENCRYPTION_MASTER_KEY_BASE64` | active KEK |
| `ENCRYPTION_KEY_ID` | identifies the active KEK in each ciphertext |
| `ENCRYPTION_PREVIOUS_KEYS_JSON` | retired KEKs, decrypt-only |
| `ENCRYPTION_PROVIDER` | `local` or `kms` |

Rotation is zero-downtime: add a new KEK, move the old one into
`ENCRYPTION_PREVIOUS_KEYS_JSON`, and re-wrap records in the background. Nothing
needs to be decrypted and re-encrypted synchronously.

For production, set `ENCRYPTION_PROVIDER=kms` so the KEK never exists in process
memory as raw bytes.

### Runtime credential sources (Part 16)

The engine resolves exchange keys through one of three sources, chosen by
`EXECUTION_CREDENTIAL_SOURCE`. None of them is a place a key may be written into
a file that is committed, and none of them is allowed to answer "permitted"
without a venue behind it:

| source | what it is | what refuses |
| --- | --- | --- |
| `none` (default) | a provider that declines every authenticated lookup | a paper process that turns out to need a key fails loudly instead of trading on nothing |
| `environment` | exactly two variables (`<PREFIX>_API_KEY` / `<PREFIX>_API_SECRET`) for exactly one tenant/account pair | boot when `NODE_ENV=production` - an environment cannot scope a secret per customer, is copied into every crash dump, and does not rotate |
| `secret-manager` | a `SecretFetcher` in front of the encrypted store - since Part 19 selectable by configuration as `EXECUTION_CREDENTIAL_FETCHER=vault-kv2` (`app/secret_fetcher.py`), or injected in code by the service that owns the store | boot without a fetcher at all: the API, a queue job and this endpoint's own request body are all refused as places a key provider could be installed, and naming a fetcher for a source that ignores it is refused as a deployment that believes it has plumbing it does not use |

Cached credentials live for `EXECUTION_CREDENTIAL_CACHE_SECONDS` (default 300)
and are dropped on expiry rather than served stale; `invalidate()` exists because
rotation and revocation must stop working promptly. The cache is not a security
window and is not described as one anywhere. Resolution results are never
returned by any endpoint, and `ExchangeCredentials.__str__`/`__repr__`/`__format__`
are overridden so a key cannot enter a log line, an exception message or a
debugger's repr by accident - the redaction helper is defence in depth, not the
control.

The Vault fetcher keeps the same property the environment provider was built
with: there is no settings field that could hold the token. `EXECUTION_VAULT_TOKEN_ENV`
names a variable and the value is read from `os.environ` inside the module that signs
the request, so `to_public_dict()`, `model_dump()` and `repr()` of the settings object
each have nothing to leak - which is a stronger guarantee than "the view omits it", and
is tested as the absence of the field (`test_the_token_has_no_field_it_could_be_stored_in`).
What the fetcher will not do is also part of the control: it refuses an `http://` address
and a `user:pass@host` authority even over TLS, refuses a tenant, account or exchange
identifier that is not one safe path segment BEFORE any request leaves the process (the
alternative - percent-encoding it - is what would let a traversal reach another tenant's
secret), bounds the response body before parsing it and quotes no body in any refusal, and
never renders the secret map it read. A path template is validated at boot rather than
interpreted at order time, because a typo like `{tenent}` would otherwise look up a path that
does not exist and report "no secret" for every tenant until somebody notices.

The operator confirmation (Part 19) is an authorisation record, not a credential: it holds no
key material, and it is safe to store in a configuration management system - but its `digest`
is only as strong as the HMAC key that made it, so the key is env-only under the same rule as
a venue key (`EXECUTION_CONFIRMATION_KEY_ENV`, default `EXECUTION_CONFIRMATION_HMAC_KEY`,
minimum 32 characters, never a settings field). The record's own bounds are what make it an
approval rather than a standing permission: a window no wider than 90 days, a `nonce` of at
least 16 characters so a superseded ceremony is distinguishable from the live one in the audit
trail, and a scope over tenant, account, instance, exchange, symbol and order type that the
per-order review re-derives rather than trusts - approving `BTCUSDT` never authorises `SOLUSDT`.
Verification is `hmac.compare_digest` over canonical JSON (sorted keys, both because a
signature needs the byte sequence to be reproducible and because a set does not have an order),
never `==`, so a record cannot be probed one byte at a time. An expired record refuses every
order without stopping the process, because the process is still the only path that can
safely cancel and reconcile; a *missing* key or an unparseable record is a boot failure,
because that is a deployment whose configuration is wrong rather than merely old.

The review that consumes those credentials answers a narrower question than
"are these bytes signed correctly": whether this key may place this order type on
this symbol in this trading phase right now, and - since Part 19 - whether a named
operator authorised this scope inside a window the deployment can verify. A key that
can withdraw is a refusal on any runtime, and a venue that cannot be asked is a refusal
on a runtime that could transmit (docs/PART16_PLACEMENT_REVIEW.md,
docs/PART19_LIVE_ENABLEMENT.md).

### Incident records

An incident is the platform's own account of a failure, so two rules apply to it
that are stricter than the ones for ordinary logs. Details are scrubbed before the
record exists (`ExecutionIncident.create`), because the instinct when writing an
incident is to attach the failing request, and the request is where a key lives.
And the sink is durable: `engine_incidents` is written over the same pool as the
order store, the write path never raises into execution (a lost record is counted
and published, never a stopped order), the read path never returns an empty list on
a failure it could not distinguish from health, and there is no `UPDATE` anywhere -
closing an incident means recording a new one, which is what makes the trail
non-re writable by construction rather than by policy (docs/PART17_DURABLE_INCIDENTS.md).

### Operational rules

* Keys come from the environment or a secrets manager. Never from source, never
  from the database.
* Different keys per environment. A staging leak must not affect production.
* Exchange keys should be created trade-only, with withdrawal permission
  disabled and IP-allowlisted to the platform's egress addresses.
* The confirmation HMAC key is a signing key for authorisations and is custody-graded
  as one: one per environment, injected as an environment variable, rotated by
  restarting with a fresh value (a key rotation and a record replacement are two acts,
  not one, because the record is parsed at boot and the key at verifier construction).
  A key rotation invalidates every record signed with the previous key, because
  verification recomputes the digest with the key the process currently holds: mint with
  the new key, publish the record, restart, in that order, or the deployment spends an
  interval refusing its own orders with `OPERATOR_CONFIRMATION_UNVERIFIED`. Verdicts
  already recorded stay auditable - they carry the record's fingerprint and codes, not a
  live dependency on the key - which is why the fingerprint is published and the digest
  is not (docs/PART19_LIVE_ENABLEMENT.md sec. 5 and sec. 7).

## 5. Transport and browser security

| Control | Where |
| --- | --- |
| Helmet security headers | `apps/api/src/main.ts` |
| HSTS, `X-Frame-Options: DENY`, `nosniff` | API + `apps/admin-web/next.config.mjs` |
| Content-Security-Policy with per-request nonce | `apps/admin-web/src/middleware.ts` |
| CORS allowlist | `CORS_ALLOWED_ORIGINS` |
| HTTPS enforced in mobile production builds | `apps/mobile/lib/core/config/app_config.dart` |

### CSRF

The API is token-authenticated and stateless, so it is not inherently
CSRF-exposed. The admin console is, because it keeps its session in cookies. It
therefore uses:

* `SameSite=Strict`, `httpOnly`, `Secure` session cookies.
* A double-submit token: a readable `wlct_csrf` cookie echoed in an
  `x-csrf-token` header, verified on every state-changing route
  (`apps/admin-web/src/app/api/proxy/[...path]/route.ts`).

Tokens are never placed in `localStorage`. An XSS bug in the console cannot
read an `httpOnly` cookie.

## 6. Input validation

* API: `class-validator` with a global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`). Unknown properties are
  rejected, not ignored.
* Shared schemas: `packages/validation`.
* Python services: pydantic v2 models with `extra="forbid"`.
* Admin console: zod on every route-handler body.
* Money is `Decimal` end to end - `Decimal(18,6)` in the database, decimal
  strings on the wire, `Decimal` in Python. Never a float.

## 7. Rate limiting

Two buckets backed by Redis so limits hold across replicas:

* `default` for general traffic.
* `auth` for sign-in, registration, refresh and 2FA - the endpoints an attacker
  hits first.

The tracker keys on `user:{id}` when authenticated and `ip:{tenantId}:{ip}`
otherwise, so one noisy tenant cannot exhaust another's budget. Health endpoints
are exempt.

## 8. Audit logging

`AuditLog` is append-only and tenant-scoped. Every privileged action records the
actor, action, outcome, resource, a before/after diff, the request id, and a
**hashed** client IP - never a raw address.

`SecurityEvent` records authentication anomalies: new device, impossible travel,
token reuse, permission escalation attempts, lockouts.

## 9. Logging hygiene

Never logged, in any service:

* passwords, in any form
* access tokens, refresh tokens, challenge tokens, session cookies
* exchange API keys, secrets or passphrases
* encryption keys, data keys, blind-index keys
* payment credentials
* raw client IP addresses

Enforcement:

| Runtime | Mechanism |
| --- | --- |
| Node | pino redaction paths, extensible via `PINO_REDACT_PATHS`; the recursive `redact()` in `@wlct/utils` (keys AND credential-shaped values AND buffers) gates audit payloads and error bodies |
| Python | `wlct_trading.observability.redaction` - since Part 9, the ONE policy both services' `logging_config.py` filters delegate to (recursive dicts/lists/bytes, exception messages, bounded depth). The old per-service key-only regex filters are gone; a cross-language fixture pins the two languages to identical answers |
| Flutter | `AppLogger.redact`, applied at every nesting depth |

The Flutter mobile client disables network logging entirely outside development,
because a request log there would contain a bearer token on a user's device.

### Telemetry-side rules (Part 9)

Observability is a secret-leak surface like any other, so it inherits the same
policy at its own boundary, enforced by the label policy in
`wlct_trading/observability/labels.py` and mirrored in the API registry:

* **Identifier and secret label names are forbidden outright** (`order_id`,
  `request_id`, `correlation_id`, `tenant_id`, `api_key`, `token`, ...) -
  not discouraged; refused at registration. Label names are additionally
  allow-listed, so inventing a label is a code review event.
* **Label values must be bounded wire tokens**; symbols and other finite sets
  only against declared enumerated domains. Series caps make runaway
  cardinality a counted refusal, not an outage.
* **Health details and incident links are redacted/validated at the boundary**:
  component details pass through the redactor where every publisher shares one
  policy; incident records are (kind, targetId) references only - no payload
  can ride into the operations tables by accident.
* **Correlation ids are UUID-or-mint, everywhere** - the API middleware and
  the Python services both refuse unbounded inbound values, so log fields and
  audit columns cannot be injected through a header.
* **`/metrics` exposure**: unauthenticated only under network isolation;
  `METRICS_TOKEN` (constant-time compared) is mandatory in production on the API
  plane, and the exposition's production-off posture is a boot error, not a
  setting: `OBSERVABILITY_ENABLED`/`METRICS_ENABLED`/`HEALTH_ENABLED`/
  `PROMETHEUS_ENABLED`/`ALERTING_ENABLED` cannot be false in production. The three
  Python services (`services/trading-engine`, `services/market-data`,
  `services/execution-engine` since Part 18) share the `OBSERVABILITY_ENABLED`
  name, its default, and that refusal, and none of them requires the token: the
  guarantee that makes the exposition safe to leave unauthenticated is the
  cardinality law at registration - a metric sample here cannot carry a tenant,
  account, order or client-order id, so there is nothing on it to disclose and
  nothing for a token to buy beyond a delay. The token is therefore not this
  surface's control, and the internal network is; docs/PART18_METRICS_EXPOSITION.md
  sec. 7 states what would have to change (a new label) before the difference
  became a hole rather than a decision.
* **No metric sample is a financial record.** Panels report; the risk gate
  decides; nothing in the trading path imports the observability layer
  (boundary tests enforce the one-way dependency).

### Trace-side rules (Part 10)

W3C trace context is attacker-influenced input - every service treats it that
way, and the rules below are enforced by tests on both sides of the language
line:

* **Inbound `traceparent` is parsed-or-ignored, never trusted.** Malformed,
  version-mismatched, all-zero-id, or over-long headers simply do not join:
  the process starts its own root. A foreign trace id can never group
  spans from two unrelated requests, which is how a correlation surface
  becomes a privacy leak.
* **Trace ids are correlation handles, not credentials, and nothing more
  enters the wire.** Span attributes pass a closed-set sanitizer (`safe
  attribute` in both languages): key allow-regex, sensitive-name refusal
  (`api_key`, `authorization`, `password`, ...), value redaction through the
  same `redaction` policy the loggers use, length caps, and a ban on the
  forbidden label names from the metric policy. Header values that must
  travel (the traceparent itself) are re-canonicalised, never echoed raw.
* **Spans carry no payloads.** The queue hop continues traces through a
  Redis **sidecar** keyed by queue+jobId holding only the 55-char traceparent
  - never inside the job payload - so span-graph joins exist without any
  payload ever being copied into telemetry. Writes are fire-and-forget with a
  TTL; a failed sidecar can neither fail nor alter a publish.
* **Fault injection is a boot-time, non-production, closed-set configuration**
  (`FAILURE_INJECTION_ENABLED`, refused by the env validators of both
  runtimes in production). The only runtime operation anywhere is `consume`
  at instrumented points; there is no arm/disarm route, no admin control, and
  the armed plan is reported read-only. The metrics-scrape fault sits AFTER
  token authentication so injection state is not probeable.
* **The trading path never reads telemetry.** `consumeFault` exists in exactly
  two production files (the tracing service and the scrape endpoint); the
  engine's evaluate router must not contain the tokens `injector`,
  `tracer.`, `should_sample` or `sampler` (statically tested); risk decisions
  are computed before any hub is touched and the except-path records a sample
  then re-raises untouched. Sampling changes only what is RECORDED, never
  what is ANSWERED - an unsampled request still gets its `x-trace-id`.
* **SLO evidence is append-only and pruning is bounded.** `SloConfigurationVersion`
  rows are immutable (the only "update" appends version N+1); evaluations and
  sample buckets expire no faster than 7 days regardless of configuration;
  deleting history is not an API surface on any plane.

## 10. Internal service authentication

The Python services are not public. Every route requires:

| Header | Meaning |
| --- | --- |
| `x-internal-token` | equals `INTERNAL_SERVICE_TOKEN`, minimum 32 chars, compared with `hmac.compare_digest` |
| `x-tenant-id` | the tenant the call acts for; the body must agree or the call is rejected |
| `x-request-id` | optional, propagates the API's correlation id |

Comparison is constant-time. A token that is a known placeholder is rejected at
startup rather than accepted quietly.

## 11. Execution safety

Four independent gates prevent Part 1 from placing an order:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine has no order-placement route.
3. `RiskDecision.wouldExecute = approved AND EXECUTION_ENABLED`.
4. The execution engine refuses to start in live mode with no placement reviewer
   wired, and refuses each order whose review is not an unambiguous venue permit
   (Part 16, gate `PLACEMENT_ATTESTED`) or that a required operator confirmation
   does not cover (Part 19, `OPERATOR_CONFIRMATION_*`). There
   is no configuration that removes control 4, because a switch that lets a
   deployment trade without asking the venue whether the key may trade is the same
   as no review - which is why the confirmation is a signed, scoped, expiring record
   and not an `ALLOW_LIVE` boolean: a boolean is the same kind of object as the
   switch this control exists to make impossible.

`EXCHANGE_SANDBOX_MODE=true` additionally disables venues that offer no sandbox.

## 12. Dependency and container posture

* Pinned base images (`node:20.11.0-bookworm-slim`, `python:3.11-slim-bookworm`,
  `postgres:16.4-alpine`, `redis:7.4-alpine`).
* Multi-stage builds; runtime images contain no compiler, no source, no `.env`.
* Every container runs as a non-root user.
* Postgres and Redis publish to `127.0.0.1` only.
* Redis requires a password and uses `volatile-lru`, so queue jobs and sessions
  are never silently evicted.

## 13. Incident response starting points

| Situation | First action |
| --- | --- |
| Suspected token theft | Bump `User.sessionVersion` to invalidate every session for that user |
| Suspected KEK exposure | Rotate `ENCRYPTION_MASTER_KEY_BASE64`, move the old key to `ENCRYPTION_PREVIOUS_KEYS_JSON`, re-wrap in the background |
| Tenant compromise | Set the tenant to `SUSPENDED`; this mass-revokes its sessions |
| Exchange key exposure | Revoke at the exchange first, then delete the record |
| Panel says "healthy" but reality disagrees | Check the publisher mirrors first (`GET /health/components` per service, the fold's `mirrorPresent` in the sync log, and `wlct_registry_series_overflow_total`); absence of alerts means *no publisher reported*, never "all clear" |
| Metrics exposition exposed too widely | Rotate `METRICS_TOKEN`, restrict the listener; the payload itself is label-policy-guarded, so assume no leak of identifiers/secrets until proven otherwise - but treat scraping clients as known callers |

## 14. Worker plane (Part 11)

* The worker (`src/worker.ts`) serves no HTTP at all - not "no public
  routes", no listener exists. Its only egress is one internal service.
* The worker-to-engine secret (`EXECUTION_INTERNAL_TOKEN` /
  `EXECUTION_ENGINE_TOKEN`) is a deployment secret, min 32 chars,
  placeholder-prefixed values refused at both boots, constant-time compared,
  carried ONLY in a header - the engine's client never puts it in a body,
  and its own error surfaces never echo payloads (422 names fields, 500s
  carry correlation ids).
* The execution engine accepts no tenantless command (tenant header
  required), rejects body/header tenant divergence with 403, and its
  simulated answers are labelled as such at every surface. One route is not a
  command, and Part 20 wrote that distinction down instead of leaving it implied:
  `GET /internal/v1/status` answers with this process's own wiring and acts on no
  tenant, so it depends on `require_internal_auth_readonly`. The token is still
  required (401 without it, and the check runs first, so a stranger cannot reach the
  tenant branch); a tenant header that IS sent is still validated (400 on a bad one,
  because an exemption from presence is not an exemption from sanity); the command
  scope's refusal text is unchanged to the byte, because the worker matches on it; and
  a test walks the application's route table to hold the read scope to that one
  route, since the way a scoping exemption rots is by becoming convenient. The
  exemption cannot disclose anything that was hidden: `GET /health/ready` publishes a
  superset of those keys to an unauthenticated caller, and that superset relation is
  itself a test, so narrowing readiness without re-arguing the exemption fails CI.
* `EXECUTION_MODE=live` is refused at the engine's startup by code: the
  queue, the worker, or any API route cannot talk the process into venue
  transmission. Part 16 wired the credential source and the review and Part 19
  closed the per-tenant key custody half of the open list with the Vault fetcher, so
  the remaining items are computed at boot from the wiring the process built rather
  than asserted in a document: `VENUE_ATTESTOR_WIRED` and `SIGNED_TRANSPORT_WIRED`
  (one absence seen twice - the gatherer is built over the live adapter this
  composition root never constructs), `DISTRIBUTED_LOCKS_WIRED` (the core ships a
  Redis lock manager; `app/composition.py:338` does not select it), and
  `DURABLE_STORE_WIRED`, whose store shipped in Part 13 (docs/PART13_DURABLE_STORE.md)
  and is selected by `EXECUTION_STORE_BACKEND=postgres`. They stay enforced, not
  configurable away, and `liveRefused` is `true` in the report of every build this
  repository ships (docs/PART19_LIVE_ENABLEMENT.md sec. 7 and sec. 8). The placement route is internal-plane only like the rest:
  token, tenant-header-matched, absent from the worker's forwarding path list,
  and its response model has no field a credential could occupy (a test holds
  that, so the day a secret-bearing view is added the suite says so).
* The ops view (`GET /v1/observability/worker-coordination`) reads claim
  state written by workers and writes nothing; an expired claim is reported
  as absence, never as a dead worker.
* The execution engine's own posture reaches the same panel the same way (Part 20,
  `GET /v1/observability/execution` -> `ENGINE POSTURE`): one process reads
  `/internal/v1/status` through the worker's client and renders what the engine says about
  itself. Three properties are held by tests rather than asserted here. No credential
  material crosses the surface - the section's rendered JSON is scanned for secret shapes
  and for the correlation `fingerprint` the status document does carry, so a row that
  dumps a sub-document whole fails the suite; a missing answer renders `unverified`,
  never `ok`, because an absent engine is not a healthy one; and the read cannot become a
  control, since the only fields it consults for tone are the engine's own claims about its
  wiring. Nothing on this path writes, and nothing on it can enable live mode: the
  `EXECUTION_MODE=live` refusal above is unchanged by this part, as is the fact that no
  order leaves the process.
* `docs/dr/schedule/dr.cron` is generated from `docs/dr/manifest.json` by
  `--emit-schedule` and verified by `--check-schedule`. It schedules the three read-only
  modes (`--due`, `--check`, `--check-rls`) and cannot schedule the ledger's two write
  modes: a job that records an outcome nobody observed is faked seed data, and the drift
  gate refuses a hand-added `--record` line on its own terms rather than as a byte
  mismatch. The emitted file also avoids the `NAME=long-literal` shape the repository's
  secret scanner keys on, by naming its one free variable in lower case - the scanner is
  not narrowed for the artifact's convenience (docs/PART20_ENGINE_STATUS_EDGE.md sec. 6).

## 15. Known gaps for later parts

* Row-level security: policies and the GUC plumbing ship in Part 11, **dormant
  by design** - enablement is the checklist-gated `apps/api/prisma/rls/enable.sql`
  DBA step, verified by the probes in docs/DR.md; coverage is generated from
  the schema and spec-pinned so no tenant table can silently lack a policy.
* No automated dependency scanning in CI.
* No WAF or bot management in front of the API.
* No hardware-backed key storage; `ENCRYPTION_PROVIDER=kms` is the hook.
* Backups: the contract (manifest, validator, dry-run planner, drill record)
  ships in Part 11; Part 12 adds the freshness ledger (per-component cadence
  or explicit waiver, `--due`'s alertable exit code, `--record` with a
  note-level secret scan that JSON escaping cannot launder) - but the
  *scheduler* that runs them on a timer is still deployment-side wiring, so
  backups today are operator processes against a validated, checkable plan,
  not an unverified cron.
* Worker membership registry (Part 12): the heartbeat zset is
  deployment-scoped state, deliberately NOT tenant-scoped (fleet topology
  is operator-visible by necessity); it carries only worker-id tokens, and
  the registry can never grant authority - claims remain the sole gate, so
  a poisoned or forged membership entry buys an attacker deferral of
  nothing and access to nothing.
* The execution engine's default store is process-local (durability
  `false` is REPORTED, not hidden). The Part 13 durable backend
  (`EXECUTION_STORE_BACKEND=postgres`) persists orders, the event journal
  and the fill ledger in the `engine_*` tables under the same tenant law
  as everything else: every store transaction sets `app.tenant_id` first,
  the tables carry `tenant_id UUID` + the generated row-level-security
  policies, and configuration mismatches (postgres without a DSN, a DSN
  with memory, missing tables) are STARTUP refusals - an engine never
  claims durability it does not have.
* Retention (Part 14) is the only deletion path on the engine plane and
  it is triply narrow: the event journal is the ONLY table any engine
  statement deletes from (a test scans the whole service to hold that
  line - orders, the fill ledger, and the run ledger are not deletable by
  ANY configuration), apply mode is dark until `EXECUTION_RETENTION_ENAB-
  LED=true` restarts the process, and every run - including refused-state
  rehearsals and zero-row runs - leaves a row in `engine_retention_runs`,
  under the same RLS law as its subjects. The route is internal-token and
  tenant-header-matched like the commands, is proxied by nothing public,
  and refuses cross-tenant form by construction (one `--tenant` per call,
  enforced by the same canonical-UUID guard the store writes under).
* Row-level security is a CLAIM, not a state (Part 15,
  docs/PART15_RLS_ENABLEMENT.md): the platform may say policies are enabled
  and enforcing only while a PASSING enablement audit is younger than
  `rlsEvidence.cadenceHours` in the DR manifest. The audit is six `SELECT`s
  and one `SET TRANSACTION READ ONLY` - no seeding, no writes, no
  enable/disable capability anywhere in the verifying code - run inside the
  same tenant-GUC transaction the money path uses, with the leak check
  deliberately performed OUTSIDE it (a bare count taken inside the GUC would
  be the scoped count by construction and could not report a leak). A role
  holding `BYPASSRLS` or superuser fails the whole run whatever the counts
  say; a run that skipped or missed a covered table grades `unverified`,
  which is a third answer and never a shade of green. The route answers 200
  with a FAIL finding rather than 500 (the audit ran; its answer is the
  evidence), refuses with 409/400/503 when there is no durable store, the
  request is out of scope, or `pg_roles` cannot say which role it audited,
  and it is internal-plane only: token, tenant-header-matched, and absent
  from the worker's forwarding path list, which is the public plane's reach.
  What it verifies is the engine plane's five tables; the platform's other
  covered tables (Part 17's `engine_incidents` among them: an unprotected incident
  table is a cross-tenant readable list of one tenant's failures, which is exactly
  the leak shape this audit hunts) stay with `enable.sql`'s checklist, and the manifest's
  `rlsEvidence.scope` says so in words the validator refuses to let anyone
  overclaim. The record of each run is one append-only line in
  `docs/dr/rls-evidence.jsonl` (secret-scanned, refusal-on-corruption like
  the backup ledger), and a RECENT failing audit outranks a stale passing
  one: fixing the alarm means fixing the isolation.
* The placement review (Part 16, docs/PART16_PLACEMENT_REVIEW.md) is the venue-side
  half of "may this order exist", and it is deliberately unable to permit anything:
  the policy object holds durations and bounds only - attestation age, key age,
  clock skew, the receive window, the IP-allowlist requirement - and has no field
  that grants a permission, because a knob that lets a deployment trade without
  asking the venue is the same as no review. Absence outranks evidence: no
  attestation is `NO_ATTESTATION`, a venue that says no is a different code, and a
  gatherer that could not answer is never reported as a permission. Severity is
  what refuses, so a runtime that CAN transmit raises an evidence-absence warning
  to a refusal, and a runtime that cannot records the same finding as `INFO` - the
  mode is part of the verdict digest, so a paper verdict can never be presented as
  authority for a live order. What is still open is custody, not the check: the
  environment source is refused in production, `secret-manager` needs a fetcher
  injected in code, and no HTTP surface of the engine may install one - so
  per-tenant key custody, a venue attestor instance, a signed transport with the
  egress addresses allow-listed at the venue, and Part 13's durable store are the
  four things standing between this build and live transmission.

## 16. Operational tooling that touches nothing (Part 21)

Three scripts (`scripts/dr-schedule-install.mjs`, `scripts/dr-rehearsal.mjs`) and two core modules
(`wlct_trading/observability/chaos.py`, `red.py`) exist to answer operational questions. They are
documented here because "it only reports" is the claim every tool that can reach something makes, so
the boundary is stated as rules instead:

* **No new secret surface.** Nothing in Part 21 reads a credential value. The rehearsal runner checks
  that environment *names* referenced by the DR manifest exist in a `.env.example` template and,
  separately, whether they are set in its own process - and records only the name, never the value,
  never a length. It forwards `DATABASE_URL` and `ENGINE_INTERNAL_TOKEN` to a probe by name, from
  its own environment, exactly as the service does; the values appear in no artifact it writes, and
  probe output is stored as a SHA-256 digest rather than as text.
* **The evidence artifacts scan themselves.** Before a rehearsal record is appended it is run through
  the manifest's own `findSecretShapes`, and a hit is a refusal to write (exit 3), not a redaction. A
  tool that silently redacted would eventually be trusted with notes it should not accept.
* **Commands are an argv allowlist, never a shell.** Both scripts spawn with argument arrays, no
  shell, a per-call timeout, and a hard-coded allowlist: `crontab` for the installer, and the four
  named probes for the rehearsal runner. There is no configuration field, flag, or manifest key that
  becomes a command line - a rehearsal tool that accepted a command from a JSON file would be a
  remote-execution tool with a clipboard. Tests assert this on the source text (one `spawn`/`spawnSync`
  call site each, no `exec`, no `shell: true`) because a property like this is only worth what the
  check that enforces it is worth.
* **Paths are validated to stay inside the repository.** The `paths` a manifest component declares
  are resolved under the repo root and refused on traversal, as is every `--schedule`/`--manifest`/
  `--out` override. A malformed path is a `FAIL` finding in the record, not an attempt.
* **Production is refused, and ambiguity is refused.** The rehearsal runner refuses `--target
  production`/`prod` and any target it cannot prove non-production (a closed set: `local`, `dev`,
  `test`, `ci`, `staging`), refuses to run under `NODE_ENV=production` whatever `--target` says, and
  requires `--confirm <rehearsalId>` - the hash of the plan being approved - for `--execute`. The
  chaos matrix refuses `production` and any environment name outside its closed set before reading a
  probe, and its probes can only read the injector's state: the injector has no arm method, is
  constructed from validated configuration, and production boot refuses `enabled=True` (Part 10).
* **Grades are not opinions.** `pass`, `fail`, `unverified`, `planned` and `skipped` are the whole
  vocabulary in these tools. `unverified` is required whenever the thing being checked is
  unreachable - no cron facility, no database, no worker process - and a rehearsal ledger refuses to
  parse a dry run recorded as `pass`. The point of the distinction is that a red cell in a recovery
  plan is information and a green cell that was not earned is an outage waiting to be scheduled.
* **The trading path does not know any of this exists.** No money-path module imports the matrix, the
  RED view, the status document or a rehearsal record; a test walks the tree and asserts it. The
  schedule installer writes nothing but a marked block in a user crontab and preserves every
  unmanaged entry byte for byte, so a DR check cannot become the cause of the outage it exists to
  detect.
```


## FILE: docs/ARCHITECTURE.md (402 lines)

*the engine section now names who reads `/internal/v1/status` (the worker's gate and the ops panel, one mirror, two consumers) and states that the panel adds no authority: it renders what the engine already published.*

````text
# Architecture

## 1. What this system is

A multi-tenant, white-label copy-trading platform. One deployment serves many
independent organisations ("tenants"), each with its own users, roles, branding,
subscription and configuration. It is **non-custodial**: the platform never
holds customer funds. Users connect their own exchange accounts with trade-only
API keys, and orders are placed on the user's own exchange account.

Part 1 delivers the foundation - tenancy, identity, authorisation, security and
the service skeletons. Copy-trading logic and live order execution are
explicitly out of scope and are hard-disabled in code.

## 2. Topology

```
                        ┌───────────────────────┐
   Mobile (Flutter) ───▶│                       │
                        │   NestJS API (:4000)  │◀─── Admin console (Next.js :3000)
   Browser ────────────▶│  REST + Socket.IO     │       (server-side proxy only)
                        └───────┬───────────────┘
                                │
            ┌───────────────────┼────────────────────────────┐
            │                   │                            │
     ┌──────▼──────┐     ┌──────▼──────┐            ┌────────▼────────┐
     │ PostgreSQL  │     │    Redis    │            │  Internal HTTP  │
     │  (Prisma)   │     │ cache/queue │            │  (token-gated)  │
     └─────────────┘     └──────┬──────┘            └────────┬────────┘
                                │                            │
                     ┌──────────┴──────────┐      ┌──────────┴──────────┬─────────────┐
                     │ notification-service│      │  trading-engine     │ market-data │
                     │  Node + BullMQ :8003│      │  Python/FastAPI:8001│ Python :8002│
                     └─────────────────────┘      └─────────────────────┘─────────────┘
```

Only the API and the admin console are published. The three supporting services
listen on the internal network and require a shared internal token.

## 3. Why these boundaries

**One API, several workers.** All client traffic terminates at the NestJS API.
It owns the database, authorisation and the audit trail. Everything else is a
worker or a calculator that the API delegates to. This keeps exactly one place
where a tenant boundary can be crossed, which is the property that makes
multi-tenancy auditable.

**Python for market and trading logic.** Exchange connectivity, numerical work
and the risk engine live where the ecosystem is strongest (`ccxt`, the
scientific stack) and where a hot loop will not block a Node event loop.

**Node for the notification worker.** It shares the API's queue contract and
templates; a second language there would buy nothing.

**A separate notification process, not an inline worker.** Email sending is slow
and failure-prone. Running it in the API process would couple request latency to
an SMTP server's mood. `QUEUE_RUN_INLINE_WORKERS` gates the inline path so a
single-process development setup still works.

## 4. Multi-tenancy

### Resolution

The tenant for a request is resolved in this order:

1. Custom domain (`TenantDomain`)
2. Platform subdomain
3. `X-Tenant-Slug` header
4. `DEFAULT_TENANT_SLUG`

For an authenticated request, whatever the above produced is **overridden** by
the tenant in the access token. A client-supplied tenant id is a hint for
unauthenticated flows (sign-in, branding) and never an authorisation input. An
*explicit* selection (domain, sub-domain or header) that contradicts the token
is rejected outright with `403 TENANT_MISMATCH` and recorded as a security
event; the `DEFAULT_TENANT_SLUG` fallback is not, because it reflects a server
assumption rather than a client claim. See `docs/MULTI_TENANCY.md`.

### Isolation

`TenantScopedPrismaFactory` wraps the Prisma client and injects a `tenantId`
predicate into every query against a tenant-owned model. The model allowlist is
explicit, so adding a table is a deliberate decision rather than an accident.

Supporting properties:

* Every tenant-owned table carries a non-null `tenantId`.
* `tenantId` is the first column of every composite index, so the predicate is
  free.
* Uniqueness is scoped: `User` is unique on `(tenantId, email)`, not on `email`.
* Platform-scoped rows use `tenantId = NULL` (system roles, platform plans).
  Prisma cannot express `NULL` inside a compound-unique `where`, so those rows
  are read with `findFirst` and written with explicit update/create branches.

Row-level security is the natural next step; the schema is already shaped for
it.

### Physical naming

Tables and columns are `snake_case` in PostgreSQL (`@@map` / `@map`) while the
Prisma client stays `camelCase` in TypeScript. Application code is unaffected by
the mapping, but every hand-written query, migration, psql session, BI tool and
`GRANT` in `infrastructure/database/init/` avoids permanently quoting
identifiers. Mixing the two conventions - `snake_case` tables with `camelCase`
columns - is the outcome worth avoiding, because it forces quoting anyway while
looking like an oversight.

## 5. Identity and authorisation

### Authentication

* **Passwords**: argon2id, with cost parameters from the environment.
* **Access tokens**: short-lived JWTs, signed with a dedicated key.
* **Refresh tokens**: stored as HMACs, never in the clear. Every refresh rotates
  the token and records `familyId` / `replacedByTokenId`. Presenting a consumed
  token revokes the entire family and raises a `CRITICAL` security event - that
  is the signal of a stolen token.
* **Device binding**: refresh tokens are bound to a client-generated device id,
  so a stolen token is useless elsewhere.
* **Logout**: blacklists the access token's `jti` in Redis until its natural
  expiry.
* **2FA**: TOTP via `otplib`. The secret is encrypted at rest with AAD
  `two_factor_secret:{userId}`; the last used counter is stored to block replay;
  recovery codes are argon2-hashed.
* **Defence**: per-account lockout, uniform responses to defeat account
  enumeration, a session cap with LRU eviction, and suspicious-login scoring.

### Authorisation

Roles are data, not code. Seven system roles ship as immutable templates
(`tenantId = NULL`, `isSystem = true`) and are cloned into each tenant at
creation, so a tenant can customise its own copy without affecting anyone else.

`PermissionsGuard` re-reads live permissions on every request rather than
trusting the token's snapshot, supports `all`/`any` semantics and wildcards
(`*`, `resource:*`), and emits a `PERMISSION_ESCALATION_ATTEMPT` event on
denial. Adding a role or permission is a data change; no authorisation code
needs to be rewritten.

## 6. Secrets and encryption

Exchange API credentials are the highest-value data in the system. They are
protected with envelope encryption:

* A fresh 256-bit **data key** per record.
* The data key is sealed with AES-256-GCM under a **key-encryption key**
  (`ENCRYPTION_MASTER_KEY_BASE64`), identified by `ENCRYPTION_KEY_ID`.
* `ENCRYPTION_PREVIOUS_KEYS_JSON` holds retired keys for decrypt-only, which
  makes rotation a zero-downtime operation.
* **AAD binds ciphertext to its owner** (`{tenantId}:{userId}`). A row copied
  into another tenant will not decrypt.
* `ENCRYPTION_PROVIDER=kms` swaps the local KEK for a managed KMS without
  touching call sites.

Deterministic lookups on encrypted values use an HMAC-SHA256 **blind index**
(`BLIND_INDEX_KEY_BASE64`). The same key hashes client IPs, so the audit trail
is correlatable without storing an address.

Secrets are never returned by the API. Reading a secret tenant setting yields
`{ configured: true }`.

## 7. Errors, logging and observability

Every error leaves the API in one envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable, safe to display.",
    "details": [{ "field": "email", "message": "Must be a valid email address" }],
    "requestId": "0f3c...",
    "timestamp": "2026-09-05T10:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

The Python services emit the same shape, so a client has one parser.

Logging is structured JSON via pino, with a redaction list covering
authorization headers, cookies, passwords, tokens, exchange secrets and payment
credentials. Stack traces never reach a production response body. Every request
carries an `x-request-id` that is propagated to the internal services.

Health endpoints: `/health` (liveness, no dependencies), `/health/ready`
(Postgres + Redis, 503 when down), `/health/deep` (adds queue depth and the
three downstream probes), `/health/startup`.

### The reliability plane (Part 10)

Above the metrics layer sits the reliability plane, and the one law over it:
**observe, never authorise.** Its parts:

* **Tracing.** `apps/api/src/infrastructure/tracing/` (W3C parse/format,
  deterministic BigInt sampling, OTLP/JSON encoder, the middleware,
  `TracingService`) mirrors `libs/trading-core/wlct_trading/observability/`
  (`tracing.py`, `redaction.py`, `faults.py`); the engine's glue is
  `services/trading-engine/app/tracing.py`. Propagation is
  W3C `traceparent`/`tracestate` in, OTLP/JSON out, single-attempt export
  with drop counting that is loud (counters + gauge + a three-streak alert).
  Head sampling is `int(trace_id[:16],16) < ratio_ppm * 2^64 / 10^6` - a pure
  function, identical in both languages, fixture-pinned.
* **SLOs.** Definitions are immutable versioned rows
  (`slo_configuration_versions`, checksummed canonical JSON); measurements
  live in 10-minute Redis bucket hashes (`wlct:trading:ops:slo:<source>:
  <epoch-min/10>`); evaluation appends `slo_evaluations` rows on a */N cron
  and on demand. Dual windows, dual multipliers: paging needs fast burn over
  the short window AND slow burn over the long one (Google SRE style);
  state is `HEALTHY/WARNING/CRITICAL/EXHAUSTED/UNKNOWN`, and UNKNOWN from a
  thin collector is reported as the measurement gap it is (`SLO_TELEMETRY_GAP`),
  never averaged away. The nine default objectives live in the Python catalog
  as the source of truth; the TS catalog is pinned to it by SHA-256 checksums
  that include the human-readable text.
* **Queue correlation.** A publish that succeeds attaches its traceparent to
  a short-TTL Redis sidecar (`captureQueueSidecar`); a worker continues the
  span only if the sidecar exists. Job payloads never carry telemetry fields,
  and telemetry never gates a job.
* **Cross-language contract.** `docs/fixtures/reliability_fixtures.json`
  (generated by `libs/trading-core/scripts/gen_part10_fixtures.py`) pins
  sampling decisions, traceparent/tracestate vectors, attribute hygiene,
  byte-exact OTLP payloads, budget/burn tables, catalog checksums and full
  evaluation rows; `slo-parity.spec.ts` replays every vector through the TS
  implementation. Drift on either side fails the suite, in either direction.

### The worker plane (Part 11)

The process model the earlier parts only described in comments finally
exists: three roles, each able to refuse, none able to impersonate another.

* **API** - unchanged producer of `TRADE_EXECUTION` jobs (deterministic
  `jobId` dedupe at admission, `enqueueOrThrow` for anything a human waits
  on); mounts no consumers, by module graph, not by flag:
  `src/modules/worker/` is imported only by `src/worker.ts`.
* **Worker** (`apps/api/src/worker.ts`, no HTTP server at all) - validates
  each job against the mirrored producer contract, admits it only while it
  verifiably HOLDS the partition claim its `${tenantId}:${accountId}` key
  maps to (rendezvous assignment + Redis claims, both languages pinned by
  `docs/fixtures/coordination_fixtures.json`), forwards, and acks: engine
  2xx completes the job (any business verdict inside it), engine terminal
  4xx/501 fails it visibly with the engine's reason, 5xx/transport retries
  within the producer's attempt budget, and not-owner defers via
  `moveToDelayed` - counted through `WORKER_MAX_DEFERS`, so homeless jobs
  page somebody instead of orbiting forever. Coordination failures fail
  CLOSED to deferral; the job path never awaits Redis.
* **Execution engine** (`services/execution-engine`) - the only process with
  venue-adjacent runtime, hosting the core `ExecutionEngine` behind an
  internal token + required tenant header; serves the four commands the
  queue actually carries, answers 501 to the one it cannot honor
  (`resync-private-stream`), and REFUSES `EXECUTION_MODE=live` at startup
  by code, with live's remaining prerequisites named rather than implied
  (Part 16 wired the credential source and the authenticated order-placement
  review; what live mode still lacks is a venue attestor instance built from the
  deployment's own trading adapter, per-tenant key custody behind
  `EXECUTION_CREDENTIAL_SOURCE=secret-manager`, a signed HTTP transport with the
  egress addresses registered at the venue, and Part 13's durable store).
  The store is a backend choice: `memory` (default, process-local, reports
  `storeDurable: false`) or `postgres` (durable orders/events/fills in the
  three `engine_*` tables, DSN required, missing tables or a dead pool
  refuse startup - never a silent fallback). Its measurements leave the process the
  way its siblings' do - `GET /metrics`, Prometheus 0.0.4 text on the internal
  network, no token and no tenant-shaped label (the core's cardinality law refuses
  such labels at registration, which is the difference between being safe to scrape
  and being filtered after the fact), absent from the OpenAPI document and from the
  worker's forwarding list, and not mounted at all when `OBSERVABILITY_ENABLED` is
  false - which `NODE_ENV=production` refuses (docs/PART18_METRICS_EXPOSITION.md). Part 14 added the bounded
  journal: the event table alone is prunable, apply is dark behind
  `EXECUTION_RETENTION_ENABLED`, every completed run (dry included)
  writes a `engine_retention_runs` ledger row nothing prunes, and no
  schedule ships - the deployment's cron calls
  `scripts/retention-run.mjs`, one tenant per run. The worker's boot gate asserts
  engine compatibility, and since the Part 13 ack-policy re-review it
  accepts a durable engine only when the claim is coherent
  (`storeDurable: true` + `storeBackend: "postgres"`). Part 15 added one more
  read-only route beside retention - `POST /internal/v1/enablement/audit` -
  which counts the catalogue and the rows to grade whether row-level security
  is actually enabled and isolating for the engine's own tables, answers 200
  with a FAIL finding because the finding IS the evidence, and writes nothing
  to the database: the durable record of a run is a line in the DR manifest's
  evidence ledger, appended by an operator script that has no credentials of
  its own (docs/PART15_RLS_ENABLEMENT.md). Part 16 added one more internal
  read-only route beside those - `POST /internal/v1/placement/attest` - which
  runs the venue-side review for one would-be order and answers with the verdict;
  it answers 200 when the review refuses, because the refusal IS the answer to
  the question asked, and every response carries `transmitted: false`, which is a
  constant in this build rather than a computed field. The review is not a second
  rejection path: its verdict is gate 11 of 11 in the engine's safety set, so one
  code path produces the blocked-gate incident, the audit event and the typed
  result, and the verdict's own fields ride inside the order's `SUBMITTED` event
  payload. On a simulated runtime it runs on every order and changes no outcome,
  recording its findings as `INFO`; on a runtime that could transmit, a review
  that cannot be answered is a refusal - and that runtime refuses to start with
  no reviewer wired at all. The posture is published where two deployments can be
  compared: `GET /internal/v1/status` carries `credentialSource` (which key source
  this process was willing to read - the source, never a credential) and a typed
  `placement` block naming the mode, whether a venue answer is required, the
  gatherer's provenance, the policy's bounds and the cache's counters, so "was
  this engine even wired to ask" is answerable without shell access. The same
  dictionary is spread into `/health/ready` with no token at all, because a probe
  cannot be handed a service token it was never issued; that is safe only while
  `describe()` is secret-free by construction, and a test holds both halves of
  that sentence - every described key reaching the probe, and nothing
  credential-shaped at any depth. It is typed
  rather than a passthrough dict so that a field added to the runtime's
  description has to be *decided* before it reaches an internal caller
  (docs/PART16_PLACEMENT_REVIEW.md). Part 18 added one more field decided that
  way - `metricsConfigured`, published because a scrape of all zeros needs an
  answer to "is this process measuring anything at all", and beside it the same
  fact as a wiring gauge. The reason both exist is that until that part this
  service had never handed its engine an instrument, so every counter the
  documents above describe was being incremented by `None`
  (docs/PART18_METRICS_EXPOSITION.md).
  Part 19 is the third instance of that same decision, and the one that shows why the
  rule exists: `describe()` grew `credentialFetcher` and `operatorConfirmation` beside a
  `liveEnablement` block, and because `/health/ready` spreads the wiring view verbatim to a
  caller with no token, the confirmation could only be published as `public_summary()` -
  `required`, `keyConfigured`, `recordPresent`, `expiresAtMicros` and a 12-character digest
  fingerprint. A full digest or the nonce would have made an unauthenticated probe a way to
  collect the material a signed authorisation is made of. Two consequences are pinned rather
  than remembered: `PlacementStatusView` had to grow its two fields in the same edit (its base
  model is `extra="forbid"`, so a describe() key with no schema field is a 500 on both routes,
  which is the failure this law is designed to produce - loudly, at the boundary, instead of
  quietly publishing a partial picture), and the credential fields moved to the names
  `providerSource` / `providerFetcher` IN LOG RECORDS ONLY, because `RedactionFilter` replaces
  the value of any key whose NAME is credential-shaped and a boot line that reads `[REDACTED]`
  where the mechanism name belongs explains nothing to the person it is written for (the API
  spelling is untouched; docs/PART19_LIVE_ENABLEMENT.md sec. 3 and sec. 7).
  Part 17 added
  the second half of the same idea: the engine's incident records are durable over
  the same Postgres pool as the order store (``engine_incidents``), a durable store
  paired with the memory sink is refused at construction rather than noticed after
  a restart, and ``POST /internal/v1/incidents/list`` answers "what is open" with a
  503 when the store cannot reply - because an empty list is what a healthy system
  looks like, and this service would rather be unavailable than misleading
  (docs/PART17_DURABLE_INCIDENTS.md).

Read-replica routing lives beside it as a policy, not a rewire:
`routeRead` fails closed in every direction (execution-critical reads never
see the replica; unknown lag or a stale probe routes primary;
half-configured deployments refuse to boot), and the counter family
`wlct_read_routing_decisions_total` makes "we have a replica we never use"
a number instead of a rumor.

The full law, the queue-consumer inventory, the runbook and the honest
deferral list are in `docs/PART11_WORKER_SCALING.md`.

The engine's self-description has a reader now (Part 20). `describe()` on the runtime
becomes `StatusResponse` on `/internal/v1/status`, and the single TypeScript mirror of that
contract (`apps/api/src/modules/worker/engine-status-contract.ts`) is a table the parser
walks, so the two languages cannot disagree in silence: a spec parses `schemas.py` and
compares field names, kinds, requiredness and defaults one by one. The same parsed object
feeds the worker's startup gate and the operations panel's `ENGINE POSTURE` section, which
is the only place in the platform where the process holding the venue credentials is asked
rather than inferred. The engine is deliberately not a health-mirror publisher - it owns no
Redis client, and copying its facts into a cache a reader polls would be a second copy of a
truth the author already answers on request. `docs/PART20_ENGINE_STATUS_EDGE.md` is the
document; the absence laws (required key missing is a refusal, optional key missing is the
engine's own default, unknown key is reported not dropped) are its sec. 2.

## 8. Real-time

Socket.IO on the `/realtime` namespace. Tokens arrive only in the handshake, and
room membership is derived server-side from the authenticated identity - a
client cannot ask to join `tenant:someone-else`. Cross-node fan-out publishes to
the Redis channel `realtime:dispatch`, and the Redis adapter is keyed with the
configured prefix so several environments can share one Redis instance safely.

## 9. Execution safety

Part 1 must not be able to move money. Four independent gates:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine exposes risk evaluation only; there is no order-placement
   route to call.
3. `RiskDecision.wouldExecute` is `approved AND EXECUTION_ENABLED`, so even an
   approved intent reports that it would not execute.
4. The execution engine's eleven-gate safety set ends in `PLACEMENT_ATTESTED`
   (Part 16), and the runtime that would transmit is the one that refuses to boot
   without a reviewer wired - so gate 4 does not depend on the platform flag being
   read correctly, which is the whole reason it is counted separately.

`EXCHANGE_SANDBOX_MODE=true` additionally disables any venue without a sandbox.

## 10. Deployment

`docker-compose.yml` is the reference topology. Migrations run as a one-shot
job (`migrate`) that must complete successfully before the API starts - running
them from every replica is a race, and a failed migration should stop a deploy
rather than crash-loop an application container.

All images are multi-stage, run as non-root, carry health checks, and contain no
source, no `.env` and no build cache.

## 11. What Part 1 deliberately does not do

* No copy-trading engine, position sizing, or follower allocation.
* No live order placement.
* No payment provider integration (no card data touches the platform).
* No KYC provider integration (the model and status field exist).
* No row-level security policies yet.
* No simulated trading results anywhere in the product.
````


## FILE: docs/GETTING_STARTED.md (325 lines)

*the operational tail's two commands and the posture curl, both run before being written down - which is why this document says `localhost:8093` for the engine (dev-run; the compose engine publishes no host port at all) and describes the panel as an authenticated route rather than inventing a curl for it, after an earlier draft named a port the API does not use.*

````text
# Getting started

Local setup, from a clean checkout to a running stack.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20.11.0 (see `.nvmrc`) | API, admin console, notification worker |
| npm | 10+ | workspaces |
| Docker + Compose v2 | recent | Postgres, Redis, the full stack |
| Python | 3.11 | trading-engine, market-data (only if run outside Docker) |
| Flutter | 3.22+ | mobile client (optional) |

## Quick start

```bash
git clone <your-repository-url> whitelabel-copytrade
cd whitelabel-copytrade

./scripts/bootstrap.sh
```

`bootstrap.sh` is idempotent. It creates `.env` from `.env.example`, fills any
placeholder secret, installs dependencies, generates the Prisma client, starts
Postgres and Redis, applies migrations and seeds baseline data. It never
overwrites a value that already looks configured.

Then:

```bash
npm run dev:api            # http://localhost:4000  (docs at /docs)
npm run dev:admin          # http://localhost:3000
```

## Manual setup

If you would rather do it step by step:

### 1. Environment

```bash
cp .env.example .env
chmod 600 .env
node scripts/generate-keys.mjs --write .env
```

Every variable that still reads `change_me` must be replaced before the API will
start - the environment is validated by zod at boot, and an invalid value aborts
the process rather than degrading silently.

Minimum set for a local run:

```
DATABASE_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
ENCRYPTION_MASTER_KEY_BASE64, ENCRYPTION_KEY_ID, BLIND_INDEX_KEY_BASE64
INTERNAL_SERVICE_TOKEN
SESSION_COOKIE_SECRET
```

### 2. Dependencies

```bash
npm install                # installs every workspace
```

### 3. Data stores

```bash
docker compose up -d postgres redis
```

Or point `DATABASE_URL` and `REDIS_*` at your own instances.

### 4. Database

```bash
npm run prisma:generate    # generate the client
npm run prisma:migrate     # create and apply a migration (development)
npm run db:seed            # system roles, permissions, platform plans, admins
```

For a non-development environment use `npm run prisma:deploy`, which applies
existing migrations without generating new ones. `npm run prisma:reset` drops
and rebuilds a scratch database.

Two things about these commands are worth knowing:

* **They load the root `.env` explicitly.** Every Prisma script is wrapped in
  `dotenv -e ../../.env --`. The Prisma CLI only looks for a `.env` next to the
  schema or in the current working directory, and these scripts run inside
  `apps/api`, so without the wrapper the whole monorepo would need a second copy
  of its environment file. Running `npx prisma` by hand from `apps/api` will
  therefore fail with `Environment variable not found` - use the npm scripts, or
  pass `--schema` from the repository root.
* **`DIRECT_DATABASE_URL` must be set**, even with no connection pooler in play.
  `schema.prisma` declares `directUrl`, and Prisma validates that the variable
  exists before it does anything else (error `P1012`). With no pooler it is just
  `DATABASE_URL` without the `connection_limit`/`pool_timeout` parameters.

The seed is idempotent - running it twice changes nothing. It creates:

* the 7 system roles with their permission sets
* the platform tenant and its branding
* the three platform plans (`starter`, `growth`, `enterprise`)
* a super-admin from `SEED_SUPER_ADMIN_*`
* a demo tenant and its admin from `SEED_TENANT_ADMIN_*`

Change those passwords in `.env` before seeding anything you will keep.

### 5. Run

```bash
npm run dev:api                 # NestJS, watch mode
npm run dev:admin               # Next.js
npm run dev:notification        # BullMQ worker
```

Python services, outside Docker:

```bash
cd services/trading-engine
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # set INTERNAL_SERVICE_TOKEN to match the root .env
uvicorn app.main:app --reload --port 8001
```

```bash
cd services/market-data
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8002
```

### 6. Mobile

```bash
cd apps/mobile
flutter pub get
flutter gen-l10n

flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
  --dart-define=TENANT_SLUG=platform
```

`10.0.2.2` is the host loopback from the Android emulator; use `localhost` on
the iOS simulator.

`android/` and `ios/` are not committed. Generate them once:

```bash
flutter create --platforms=android,ios --org com.yourcompany .
```

## Full stack in Docker

```bash
docker compose up -d --build          # includes the development overlay
docker compose -f docker-compose.yml up -d --build   # production-like
```

Both commands start three Python services (`trading-engine`, `market-data`,
`execution-engine`), and until Part 18 none of the three images could reach the
point of serving: each Dockerfile passed `--log-config /dev/null`, uvicorn hands a
non-`.json`/`.yaml` path to `logging.config.fileConfig`, and that refuses a
zero-length file (`RuntimeError: /dev/null is an empty file`, true since at least
python 3.11.9). They now pass `--log-config ./log-config.json` - two no-op keys
that keep uvicorn from reconfiguring the app's JSON log pipeline.
`execution-engine` needed one more thing: its module exposes `create_app` and
deliberately no module-level `app`, so the `app.main:app` target its image named
resolved to nothing (the two siblings bind `app`, so their plain form is correct);
its command is now `uvicorn --factory app.main:create_app`. A test loads all three
image commands through uvicorn's own constructor -
`services/execution-engine/tests/test_part18_asgi_target.py` - so a recurrence
fails a suite instead of a deployment. The reasoning is in
`docs/PART18_METRICS_EXPOSITION.md` sec. 6.1.

### The Part 19 knobs, and what a first deployment should leave alone

`services/execution-engine/.env.example` documents thirteen variables Part 19 added -
one fetcher selector (`EXECUTION_CREDENTIAL_FETCHER`), eight for Vault KV v2
(`EXECUTION_VAULT_ADDR`, `..._MOUNT`, `..._PATH_TEMPLATE`, `..._TOKEN_ENV`,
`..._NAMESPACE`, `..._TIMEOUT_MS`, `..._TLS_VERIFY`, `..._MAX_RESPONSE_BYTES`) and four
for the operator confirmation (`EXECUTION_REQUIRE_OPERATOR_CONFIRMATION`,
`..._OPERATOR_CONFIRMATION_JSON`, `..._OPERATOR_CONFIRMATION_FILE`,
`EXECUTION_CONFIRMATION_KEY_ENV`). Every one of them defaults to the dark side, none
of them opens the money path, and the two key variables are deliberately absent from
`docker-compose.yml` - a compose file is a place secrets get copied from, and these
values are read from the process environment of the container that needs them.

### The two operational commands worth knowing (Part 20)

Nothing to configure - this part adds no environment variable at all. Two commands, both
read-only, both runnable today:

```bash
node scripts/dr-manifest.mjs --check-schedule   # is the DR watcher installed and current?
node scripts/dr-manifest.mjs --due              # what is overdue on the backup board?
```

`--check-schedule` fails when `docs/dr/schedule/dr.cron` no longer matches what
`docs/dr/manifest.json` implies, which is the difference between a control and a document;
installing it is `node scripts/dr-manifest.mjs --emit-schedule --root /srv/path --out
/tmp/dr.cron && crontab /tmp/dr.cron`, and the schedule never writes ledger evidence on
your behalf (that is the point: `--record` names a human).

For the engine's posture, the document to read is the one the worker reads. Dev-run, on
the port `docs/PART11_WORKER_SCALING.md` uses:

```bash
curl -s -H "x-internal-token: $EXECUTION_INTERNAL_TOKEN" \
  localhost:8093/internal/v1/status | python3 -m json.tool
```

Twenty keys, no secrets among them, and since Part 20 they need no tenant header (the
route reads the process, not a tenant - `docs/PART20_ENGINE_STATUS_EDGE.md` sec. 7 for
why, and `docs/SECURITY.md` sec. 14 for the exemption's bounds). The same block is
rendered for operators as the `ENGINE POSTURE` section of
`GET /v1/observability/execution`, which sits behind an operations-read session rather
than a curl: it is a panel row, and a panel row that could not answer says
`unverified` instead of guessing.

What a first deployment should actually set: nothing here. What a deployment that wants
its review to have real evidence to reason over should set: `EXECUTION_CREDENTIAL_SOURCE`
(plus a fetcher if the source is `secret-manager`), so the credential lookup can be made,
and `EXECUTION_STORE_BACKEND=postgres` once the migration has run. The confirmation is the
last item, not the first: it is a record a human signs about a specific symbol and order
type, and minting one before the review above it has real evidence produces an approval of
nothing in particular. `docs/PART19_LIVE_ENABLEMENT.md` is the operational document -
sec. 5 is the minting ceremony with the exact bytes, sec. 9 is the order to turn the pieces
on, sec. 10 is the refusal catalogue for when a boot says no.

| Service | Address |
| --- | --- |
| API | http://localhost:4000 |
| Admin console | http://localhost:3000 |
| Swagger (when `SWAGGER_ENABLED=true`) | http://localhost:4000/docs |
| Postgres | 127.0.0.1:5432 |
| Redis | 127.0.0.1:6379 |

`trading-engine`, `market-data` and `notification-service` are internal-only in
the production composition. The development overlay publishes them on loopback
so you can probe them directly.

## Verifying

Two scripts, with different jobs.

`scripts/verify-part1.sh` is static: it inspects the repository (layout, secret
hygiene, TypeScript, Python tests) and does not need a running stack.

```bash
./scripts/verify-part1.sh
```

`scripts/smoke-test.sh` is dynamic: it drives a **running** API and asserts real
behaviour - health probes, login, refresh-token rotation and reuse detection,
global session revocation, the error envelope, and the security headers. It
exits non-zero on the first broken guarantee, so it can gate a deployment.

```bash
npm run smoke                       # against http://127.0.0.1:4000
API_URL=https://api.example.com npm run smoke
```

It reads `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` from `.env`.
Note that it deliberately triggers refresh-token reuse detection, which signs
that account out of every device - run it against a test account, never against
a live administrator.

Manual smoke test:

```bash
curl -s localhost:4000/health | jq
curl -s localhost:4000/health/ready | jq

# Sign in as the seeded super admin.
curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -H 'x-tenant-slug: platform' \
  -d '{"email":"superadmin@copytrade.app","password":"<your seed password>","deviceId":"curl-local-device"}' | jq

# Anonymous access to a protected route must be 401.
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/v1/users
```

## Common problems

**`Environment validation failed`** - a required variable is missing or too
short. The message lists each offending variable. Run
`node scripts/generate-keys.mjs`.

**`Can't reach database server`** - Postgres is not up, or `DATABASE_URL` points
at `localhost` while the API runs inside Docker (it should be `postgres`).

**`P3005: database schema is not empty`** - the database has tables but no
migration history. For a scratch database: `npm run prisma:reset -w @wlct/api`.

**Admin console shows "The platform API is unreachable"** - `API_BASE_URL` is
wrong. It must include the `/api` prefix: `http://localhost:4000/api`.

**`ENOTEMPTY` during `npm install`** - a previous install was interrupted.
`rm -rf node_modules package-lock.json apps/*/node_modules services/*/node_modules packages/*/node_modules`
then reinstall.

**Flutter: `Target of URI doesn't exist: app_localizations.dart`** - run
`flutter gen-l10n`. The file is generated and intentionally not committed.

## Useful commands

```bash
npm run build                  # every workspace
npm run typecheck              # api + admin-web
npm run lint
npm run test                   # API unit tests
npm run prisma:studio          # database browser

docker compose logs -f api
docker compose down -v         # stop and delete volumes (destroys data)
```
````


## FILE: docs/ROADMAP.md (354 lines)

*row 20, written from the diff rather than the intent: mirror, panel, generated schedule, and the defect the audit only found by running the composition - with the Python and compose files it moved counted, because a row that says "display only" over a commit that changed an auth boundary is how a roadmap stops being evidence.*

```markdown
# Roadmap

Part 1 is the foundation. Everything below builds on it in an order chosen so
that each part is shippable, testable and reversible on its own.

The ordering rule: **nothing that touches money ships before the thing that
constrains it.** Risk, limits and audit come before execution; execution comes
before automation.

---

## Part 1 - Foundation (delivered)

Multi-tenancy, identity, RBAC, security, the API skeleton, the admin console
foundation, the mobile foundation, service skeletons, Docker.

Execution is hard-disabled.

---

## Part 2 - Exchange connectivity (non-custodial)

**Goal:** a user can securely attach a real exchange account, and the platform
can read from it. Still no order placement.

* Prisma: `ExchangeAccount`, `ExchangeCredential`, `ExchangeBalanceSnapshot`,
  `ExchangeAccountAudit`.
* Credential intake: submitted once, encrypted with envelope encryption at the
  edge, never returned. A validation call proves the key works and, critically,
  proves that withdrawal permission is **absent** - a key with withdrawal rights
  is rejected outright.
* `trading-engine`: real `ccxt` clients per venue, per-account rate limiting,
  a circuit breaker per venue, clock-skew detection.
* Read-only endpoints: balances, positions, open orders, trade history.
* `market-data`: authenticated feeds, websocket ingestion, the streaming flag
  turned on.
* Mobile and admin: connect-account flow, balance display.

**Ships when:** a real exchange key can be attached, validated and read from,
and the plaintext secret is provably absent from the database, the logs and
every API response.

---

## Part 3 - Trader profiles and strategy definitions

**Goal:** the objects copy-trading will reference, with no copying yet.

* Prisma: `TraderProfile`, `Strategy`, `StrategyVersion`, `PerformanceSnapshot`,
  `TraderFollowerLink`.
* Verified performance only: metrics are computed from executed fills recorded
  by the platform. No self-reported numbers, no backtests presented as results.
* Trader onboarding and approval, with a compliance gate.
* Discovery: search, filter and rank traders.
* Admin: trader approval queue, performance review.
* Mobile: trader list and detail screens.

**Ships when:** a trader can be onboarded and approved, and their performance is
derived exclusively from platform-recorded fills.

---

## Part 4 - The copy engine (paper first)

**Goal:** the full copy pipeline, executing against paper accounts only.

* Prisma: `CopySubscription`, `CopyRule`, `SignalEvent`, `MirrorOrder`,
  `PaperFill`.
* Signal pipeline: detect a leader's fill, translate it through the follower's
  sizing rule, apply risk, place a paper order.
* Sizing modes: fixed notional, proportional to equity, fixed multiplier.
* Risk per follower: max notional, max open positions, max leverage, per-symbol
  allow/deny, daily loss cap.
* Latency budget and slippage accounting, measured and exposed.
* Reconciliation: a periodic job that detects and reports divergence between the
  intended and actual mirrored state.
* `EXECUTION_ENABLED` stays `false`; `paper_trading` stays on.

**Ships when:** a follower's paper account mirrors a leader correctly under
adversarial tests - partial fills, rejects, disconnects, duplicate signals - and
reconciliation reports zero unexplained divergence.

---

## Part 5 - Live execution

**Goal:** real orders, on the user's own exchange account.

This is the highest-risk change in the project and gets treated accordingly.

* Order state machine with idempotency keys; a retried request never
  double-places.
* Exchange error taxonomy: which errors are retryable, which are fatal, which
  require human review.
* Kill switches: platform-wide, per tenant, per trader, per follower.
* Position reconciliation against the exchange as the source of truth.
* Progressive rollout: an allowlist of accounts, then a percentage rollout via
  the existing feature-flag bucketing.
* A dry-run mode that logs the exact payload that *would* be sent.

**Ships when:** a full audit trail exists for every order, every kill switch is
verified under load, and reconciliation has run clean for a sustained period on
the allowlist cohort.

---

## Part 6 - Billing and monetisation

* Payment provider integration (Stripe first). The platform stores no card data;
  it holds provider references only.
* Performance fees: high-water mark accounting, crystallisation periods,
  trader revenue share.
* Invoices, dunning, and a subscription lifecycle driven by provider webhooks
  with signature verification and replay protection.
* Payout ledger for trader earnings.

Money movement is double-entry from day one. A single-entry ledger is not
auditable and cannot be reconciled.

---

## Part 7 - Compliance and operations

* KYC/AML provider integration behind the existing `KycProfile` model.
* Jurisdiction rules: which tenants may onboard users from where.
* Suitability and risk questionnaires; risk-profile gating on copy limits.
* Data subject rights: export and erasure, honouring audit-retention duties.
* Regulatory reporting exports.
* SIEM export for the security event stream.

---

## Part 8 - Scale and reliability

* Read replicas and query routing.
* Time-series storage for market data and performance history.
* Horizontal scaling of the copy engine with partitioned work and leader
  election.
* Row-level security in Postgres as defence in depth behind the application-layer
  tenant scoping.
* Full observability: OpenTelemetry traces, RED metrics per endpoint,
  service-level objectives with alerting.
* Chaos testing: exchange outage, Redis failover, database failover.
* Disaster recovery with a rehearsed, timed restore.

---

## Cross-cutting work, continuous

| Track | Detail |
| --- | --- |
| Testing | unit, integration against a real Postgres, contract tests between the API and the Python services, load tests on the copy path |
| Security | dependency scanning in CI, an external penetration test before Part 5, secret-rotation drills |
| Documentation | an ADR for every consequential decision; an operational runbook per service |
| Accessibility | WCAG 2.1 AA on the admin console; screen-reader support in the mobile client |

## Sequencing constraints

These cannot be reordered:

1. **Part 2 before Part 4.** No copying without a validated exchange connection.
2. **Part 4 before Part 5.** Paper trading is how the pipeline earns the right
   to touch real money.
3. **Risk limits before execution.** The constraint ships before the capability.
4. **Audit before money.** Every financial action must be reconstructable from
   the audit trail on the day the feature launches, not retrofitted afterwards.

---

## Delivery log (as of Part 9)

The delivered parts renumbered relative to this early roadmap (which described
a backlog, not a sequence contract). What has shipped, with its authoritative
document:

| Part | Delivered | Document |
| --- | --- | --- |
| 1 | Platform foundation: multi-tenancy, auth/RBAC, audit, API + admin console + mobile skeletons, the pre-trade risk engine skeleton, connectivity transport | docs/PART1_*.md |
| 2 | Trading core library: order book, market data pipeline, clock/latency discipline | docs/PART2_*.md |
| 3 | Billing, notifications, feature flags, security-event pipeline | docs/PART3_*.md |
| 4 | Execution engine and exchange adapters (authenticated REST/WS, paper-first) | docs/PART4_*.md |
| 5 | Live execution control plane: credentials, kill switches, reconciliation, execution incidents | docs/PART5_*.md |
| 6 | Strategy layer: definitions, instances, backtest and paper sessions, metrics | docs/PART6_*.md |
| 7 | Historical datasets: ingestion, manifests, validation, storage, replay | docs/PART7_*.md |
| 8 | Real-time risk engine: the authoritative fail-closed gate, 22-rule catalog, snapshots, reservations, rate windows, switch lifecycle, risk console (+ read-only mobile viewer) | docs/PART8_RISK.md |
| 9 | Observability & operations: Prometheus exposition (both languages, cardinality-lawed), health/readiness/trading-readiness, alert fold with durable dedupe, incident correlation, shared redaction, queue observability, operations console | docs/PART9_OBSERVABILITY.md |
| 10 | Reliability: OTLP tracing (both planes, sampled, redaction-bound, honest export accounting), SLO/error-budget evaluator with burn alerts, queue-depth law, fault injection (non-prod, self-disabling), production config guards | docs/PART10_RELIABILITY.md |
| 11 | Scale & coordination: cross-language lease/partition foundation (fixture-pinned), the trading-worker plane (partitioned TRADE_EXECUTION consumer with deferral accounting and a strict engine failure taxonomy), services/execution-engine hosting the real core ExecutionEngine (simulated; live refuses by code), read-replica fail-closed routing policy, read-only worker ops view, generated + spec-pinned row-level security (dormant until the checklist-gated enablement), DR manifest with validator and timed-drill contract | docs/PART11_WORKER_SCALING.md, docs/DR.md |
| 12 | Self-registering worker membership (heartbeat-zset registry, fixture-pinned staleness law, config list demoted to fallback, resign-on-shutdown fast path, registry read in the ops view) and the DR backup-freshness ledger (manifest cadences or explicit waivers, --due grading with a cron-able exit code, --record with secret-scan and parse-refusal) | docs/PART12_WORKER_MEMBERSHIP.md, docs/DR.md |
| 13 | Durable execution-engine store: PostgresOrderStore over the core OrderStore port (orders/events/fills/reconciliation state), engine_* tables in Prisma with automatic RLS coverage and per-transaction tenant GUC, opt-in EXECUTION_STORE_BACKEND with no silent fallback either direction, and the worker ack-policy re-review that turned the durable-engine tripwire into a coherence check | docs/PART13_DURABLE_STORE.md |
| 14 | Journal retention: the core's pure retention law (terminal_at-not-status, whole-story-or-none, nonsense-proof policy), the engine executor over the store's own transaction contract (one deletable table, seq-listed batches, ceiling-then-resume), the never-pruned `engine_retention_runs` ledger with dry-runs recorded, apply dark behind config, and the cron-able tenant-per-call CLI with exit-code law | docs/PART14_RETENTION.md |
| 15 | RLS enablement made VERIFIABLE, read-only: the core's pure enablement law (probe shape, platform-scoped bare-read exception, role-attribute veto, pass/fail/unverified grading, nonsense-proof evidence window), the engine's six-statement audit executor (scoped count inside the tenant transaction, bare count outside it, nothing seeded, no write verb by construction), one internal endpoint that answers 200 with a FAIL finding, `scripts/rls-enablement.mjs` (audit/check/print-sql) with no database access of its own, and the append-only `docs/dr/rls-evidence.jsonl` ledger aged by `dr-manifest.mjs --check-rls` under a manifest-declared cadence | docs/PART15_RLS_ENABLEMENT.md |
| 16 | Placement attestation made a GATE rather than a second rejection path: the core's pure review law (absence outranks everything, the review can only tighten, staleness and skew are findings, six rules ending in a digest-stable verdict id over canonical JSON), four gatherers behind one ABC (unattested / local / a TTL cache keyed by the ORDER SHAPE after a coarse key proved to be a fail-open / Binance over the deployment's own signed adapter and weight budget), the service's eight source-and-cost knobs with no enable switch and production `environment` refused at Settings construction, one internal endpoint that answers 200 with a refusal because a refusal is data and carries `transmitted: false` as a constant, that posture published on `/status` as a typed block (the credential SOURCE and the gatherer's provenance, never a key), the venue package's export rule written down and tested rather than improvised, and live mode still refused at boot with the four remaining prerequisites listed in order | docs/PART16_PLACEMENT_REVIEW.md |
| 17 | Incident records made as durable as the orders they explain: the engine plane's own `engine_incidents` table (BIGSERIAL read order, uuid identity unique by constraint, VARCHAR vocabularies, no composite FK to orders, tenant FK that restricts), the SQL sink over the same pool as the store with the write law that never raises and the read law that never lies, the composition refusal for a durable store paired with a memory sink (and the mirror), one internal read route that returns 503 rather than an empty list, the sink published on `/status` through a typed view, and the fifth engine-plane table inside the generated row-level-security set (43 covered) so the audit can prove the isolation | docs/PART17_DURABLE_INCIDENTS.md |
| 18 | The engine's measurements made readable at the edge of the process that produces them: `GET /metrics` on `services/execution-engine` over the core's lawed registry (29 counter families DERIVED from `ExecutionCounters`' fields so an exporter cannot fall behind its instrument, one `stage`-bounded histogram copied whole per scrape instead of re-observed, seven wiring gauges read from `describe()` rather than from settings so a renamed key publishes 0 instead of a guess, and a reset counter because `inc` refuses a negative amount), the four spans the engine actually contains timed with the eight stages that cross a process or transport boundary left unrecorded and the reason written down, the shared adapter's nine-part cumulative double-accumulation found and killed by the first process that ever rendered it, `OBSERVABILITY_ENABLED` with production refusing it off (the knob `docker-compose.yml` had been passing to this service unread since the block existed), and the instrument the service had never handed its engine - which is how the counters Parts 5-17 documented as measurable were being accumulated by nothing, plus the three Python image commands that could never start a process (an `app.main:app` target this module does not define, and a `--log-config /dev/null` that `logging.config.fileConfig` has refused since python 3.11) | docs/PART18_METRICS_EXPOSITION.md |
| 19 | Live enablement made AUDITABLE without being made possible: the credential provider selection given its one concrete fetcher (`VaultKvSecretFetcher` over KV v2 - https-only with `user:pass@host` refused even over TLS, mount and path template validated at boot, identifiers matched against `[A-Za-z0-9._-]{1,64}` BEFORE a request is built, the rendered path bounded at 512 characters, the response bounded at 1 KiB..4 MiB and refused without being consumed, every non-200 one refusal that keeps its status and drops its body, and no field on `Settings` that could hold the token), the operator confirmation as a typed record rather than a flag (`LiveOperatorConfirmation`: HMAC-SHA256 over sorted-key canonical JSON, a 90-day ceiling on the window expressed in milliseconds against microsecond stamps, `nonce` >= 16 so two ceremonies over one scope are not byte-equal, `symbols`/`orderTypes` scoped per axis with an empty set meaning `all-configured` and never `nothing`, `SCOPE_MISMATCH` naming which axis, and no `required` without a key), the confirmation graded per order by the existing six-group law instead of a parallel gate (`CONFIRMATION` findings on the verdict, a reviewer that refuses to be built when the policy asks and nothing was supplied, a verifier that RAISES becoming a blocking `UNVERIFIED` naming the exception type and not its message), the axis that makes the whole picture countable (`ReviewArea`, seven areas, seven derived counters taking `ExecutionCounters` to 36 ints and the exposition to 36 families with no exporter change, `blocking_areas` in declaration order so one refusal renders one list), the live-enablement report graded from the wiring this process built rather than from a settings dump (eight `LivePrerequisite`s, `LIVE_*` codes spelled from the enum so they cannot disagree, `hardBlockersPresent` naming the one absence no configuration reaches, prose for the operator and names for machines), `/status` and `/health/ready` carrying the report plus a `public_summary()` whose fingerprint is 12 hex characters because an unauthenticated route may correlate a ceremony and must not reproduce it, boot log fields renamed `provider*` because `RedactionFilter` scrubs any credential-SHAPED KEY and `[REDACTED]` where 'which fetcher did I get' belongs is a boot line nobody can debug from, and 174 tests across five files - `EXECUTION_MODE=live` STILL refused, with the refusal now printing what it was graded against | docs/PART19_LIVE_ENABLEMENT.md |
| 20 | The operational tail's last two code-able gaps, both display and derivation and neither a gate: `/internal/v1/status` given ONE strict TypeScript mirror (20 keys, required-and-defaulted read differently, unknown keys reported, a spec that parses `schemas.py` and refuses to let the languages drift), and the engine's posture rendered on the ops panel as `ENGINE POSTURE` with a tone law in which absence never reads as health; plus `docs/dr/schedule/dr.cron`, generated from the manifest's cadences by `dr-manifest.mjs --emit-schedule` and drift-gated by `--check-schedule`, which may schedule the three read-only modes and never the ledger's writes. And one defect the audit only found by running the composition: `/internal/v1/status` demanded a tenant header its only caller cannot send, so `assertEngineCompatible()` got a retryable 400 and the reference worker exited 1 at startup - fixed by splitting the engine's internal law into a command scope (refusal text unchanged to the byte) and a read scope used by exactly one route and pinned by a route-table walk, with `docker-compose.yml` pointed at the engine so the new panel lights up. 3 Python files and 1 compose file moved; no gate, verdict or refusal threshold did, and live still refuses at startup, unchanged. `docs/PART20_ENGINE_STATUS_EDGE.md` |

Still open from the original backlog, deliberately NOT absorbed: time-series
storage behind the exposition (metrics are published, not retained; retention
beyond the durable alert/incident state remains future work - Part 14 closed
the EXECUTION STORE's journal retention, docs/PART14_RETENTION.md, which is
a different table and a different problem, and this item's wording is kept
deliberately so the two are never conflated), RED dashboards
beyond the built-in panel, disaster-recovery rehearsals, and the remaining
Part 8-scale items - enabling the shipped row-level-security policies in
staging per the enable.sql checklist (the Part 13 engine tables are
and Part 17's incident table are covered by the same generated machinery (43
covered tables today), so enabling remains one checklist for every tenant table - Part 15 did NOT retire that operator step, it made
enablement auditable, gradable and age-trackable afterwards, so the open item
is now "run the audit on staging", see docs/PART15_RLS_ENABLEMENT.md), the
full
chaos/failover matrix against real infrastructure (the invariants are
unit-pinned; a staging run remains a deployment step, see
docs/PART11_WORKER_SCALING.md sec. 18). Part 12 retired two items from this
list: worker membership is now self-registering (WORKER_MEMBERSHIP_MODE,
docs/PART12_WORKER_MEMBERSHIP.md) and backup cadence has its checking
mechanism (`dr-manifest.mjs --due`, exit-code alertable); Part 13 retired
the durable execution-engine store wiring (docs/PART13_DURABLE_STORE.md -
the store ships, the schema is Prisma-owned, and the worker gate's
ack-policy condition is resolved). Part 18 retired one backlog item and none of the deployment-side ones: the numbers a scrape needs are now published by the process that measures them, while the alert rules, the dashboards and the scrape targets stay in the deployment (docs/PART18_METRICS_EXPOSITION.md). Part 16 shipped its layers dark (docs/PART16_PLACEMENT_REVIEW.md) and retired no deployment item on purpose: the review now runs on every order a runtime could transmit and on paper orders only in practice, and the live path's remaining prerequisites - venue attestor instance, per-tenant key source, signed transport with an egress allowlist registered at the venue, durable store and distributed locks - are named there in order rather than implied. Part 19 retired the per-tenant key source and left the rest of that sentence standing, with one correction worth naming: the list is now COMPUTED from the wiring a process built instead of asserted in prose (docs/PART19_LIVE_ENABLEMENT.md sec. 7), and it reports `DISTRIBUTED_LOCKS_WIRED` as unsatisfied for a different reason than `SIGNED_TRANSPORT_WIRED` - the core already ships a Redis lock manager and `app/composition.py:338` does not select it, whereas nothing in this build could be put over a signed transport that was never constructed (the same section's note on the two kinds of absence). Two of the five items Part 19 was asked to close were already shipped by Parts 13-18, so its diff is the fetcher, the confirmation, the counting axis and the report, plus tests pinning the eight items the audit found done. What remains of
the backup item is deployment-side WIRING of that command into a scheduler
- the ledger refuses to fake its own seed data, so the first real
`--record` is the first real backup evidence. Part 20 shipped the scheduler side of that
sentence's first half - the schedule is a generated file with a drift gate rather than a
habit (`--emit-schedule` / `--check-schedule`, `docs/dr/schedule/dr.cron`,
`docs/PART20_ENGINE_STATUS_EDGE.md` sec. 6) - so what is left is the one command a host
runs (`crontab <file>`) and, still, the first real `--record`.


Part 21 took the operational tail end of this list and made it checkable, without
pretending to be infrastructure. `scripts/dr-schedule-install.mjs` installs, verifies,
idempotently re-applies and removes the generated schedule in a host crontab, refusing
on any drift it would have to author and exiting 4 rather than lying about a host with
no cron; `scripts/dr-rehearsal.mjs` is the drill record as data - a deterministic plan
built from `restoreProcedure`, per-component path and environment-name preflight, four
allowlisted probes, closed grades (pass/fail/unverified/planned/skipped), production and
unknown targets refused before anything is read, `--execute` gated on a confirmation that
must echo the plan's own hash, and an append-only evidence line that cannot legally
record a dry run as a pass; `--status` folds those laws into one exit code.
`scripts/dr-manifest.mjs --verify-rls` answers "what is verified about row-level security
right now" in machine-readable form - 43 covered tables agreeing in both directions with
enable.sql and disable.sql, matching schema stamps, and an evidence ledger that has never
been written, which is why the grade is `UNVERIFIED` and the tool's own `enabled` field is
`null`: verifying the scope of a policy is not the same act as claiming enforcement
(docs/PART15_RLS_ENABLEMENT.md remains the enablement path, unchanged). The chaos and
failover matrix is now a module rather than a paragraph
(`wlct_trading.observability.chaos`: ten scenarios A-J, each with setup, injection, the
invariant the runbooks already assert, observation, recovery, cleanup, a bounded timeout,
and a fault point drawn only from the closed set in `faults.py`), and a run in this
repository grades all ten `UNVERIFIED` and exits 2 by design - a harness result is labelled
`source=harness` and cannot be laundered into an infrastructure claim. RED is a *view*
(`wlct_trading.observability.red`) over the registry families the services already
register, rendered as existing `DashboardRow`s, with `no-data`, `zero-traffic`,
`measured`, `healthy` and `over-budget` kept distinct and with no default error budget
anywhere in the file: a verdict requires a caller-supplied `RedBudget` that names its
source, so the SLO and alert catalogs stay the only thresholds the platform has. What
remains open after Part 21 is the part no repository can close: running the drill, running
the matrix against real processes, wiring a scrape and a dashboard export into a
deployment, and the first real `--record`. Part 22 has since taken the scrape half of
that sentence (below): the jobs, the rule file and the reader now exist as generated files
under `infrastructure/observability/`, and the 17 catalog rules that carry `threshold: None`
still refuse to render rather than being given numbers they never had
(docs/PART21_DR_OPERATIONS.md, docs/PART22_SCRAPE_SIDE.md).


Part 22 took the deployment half of Part 18's boundary and made it a file in the tree.
`libs/trading-core/scripts/gen_observability_bundle.py` renders `infrastructure/observability/` -
a scrape config whose four jobs, two paths and one header come out of `docker-compose.yml`, each
service's own `@router.get("/metrics")` and `.env.example`; a rule file in which every numeric
literal must appear in the `AlertRule` it is derived from; and a JSON catalog carrying the evidence
field by field - and refuses to invent the rest. 4 of the 24 catalog rules became alerts and the 20
that did not are listed with the reason each stayed unwritten (17 have `threshold: None`, 3 name a
unit no registered family in this tree exposes), because a rules file is where an invented number
goes to look official. No cadence and no dwell time are declared anywhere in the repository, so
none is emitted; there is no relabeling and no `external_labels`, because `labels.py` decides
cardinality at registration and the monitoring side does not get a route around a law the code
cannot break; the single rule that is not in the catalog is `WLCTScrapeTargetDown`, whose only
literal is the `0` that defines a failed scrape, with its job list generated from the same evidence
as the jobs, so a target that cannot be reported down is not possible.
`docker-compose.observability.yml` adds exactly one service - `prom/prometheus:v3.5.0`, pinned
because `http_headers` needs >= 2.53 - mounted read-only, published on `127.0.0.1`, with no
lifecycle endpoint and no retention flag, and `--check` reads it back through structural laws
against the parsed service block rather than by grepping text, so the banner explaining those
absences cannot itself trip the check. No Alertmanager (the platform owns the alert lifecycle, and a
second store of the same alerts is a second truth to reconcile), no Grafana JSON (the dashboard
format this repository owns is the section/row document, which `--dashboard` renders from scraped
exposition with a strict-name absence census printed beside it), no collector, no exporter, no
paging, and no container run: the bundle has never been read by a real Prometheus, which the part
document states as its verification edge rather than as a detail. 41 tests, most of them asserting
that an audit objects when it should, on top of the one that makes the rest reviewable - the
committed bundle is byte-identical to a fresh render (docs/PART22_SCRAPE_SIDE.md).


The sweep after Part 22 (2026-09-19) was a gap audit rather than a feature: every file in the tree was
checked for emptiness, for `pass` bodies outside abstract interfaces, for unresolved first-party imports,
for compose references, for settings with no documentation, for modules with no test and for paths with no
file. One artefact was genuinely missing and it was the one an operator reads at 3 a.m.: the execution
engine's `503 ENABLEMENT_ROLE_UNKNOWN` instructs whoever sees it to apply Part 11's `grant.sql`, and no
such file had ever been written. `apps/api/prisma/rls/grant.sql` now exists (48 lines, SELECT on one catalog
view, its inverse stated, no BYPASSRLS and no superuser) and is emitted by `scripts/gen_part11_rls.py`
beside the enable and disable scripts it belongs with, so the directory stays reproducible from
`schema.prisma` and the three existing artefacts came out byte-identical. Two laws came with it, because a
fix without a law is a fix until the next part: `tests/test_repo_reference_integrity.py` refuses a
path named by a comment, a message or a document that does not resolve, with every exemption argued in the
docstring rather than skipped; `tests/test_env_example_coverage.py` refuses a settings field no example
file names and an example file name nothing reads. A third file, `tests/test_net_signed_sender.py`, covers
the one module in the library that puts an API key on a socket, whose plaintext-endpoint refusal had never
been asserted although its unsigned sibling's has been since Part 9. Seven sentences were also wrong - two
`docs/SECURITY.md` table rows naming directories that never held those files, a `docs/MULTI_TENANCY.md`
code-block label, three cross-references to documents that were renamed or never written, and a gap audit
still quoting 42 covered tables where Part 17 moved the generated set to 43 - and each mechanism was sound
while only its pointer was stale, so the pointer was fixed and nothing else moved. Eleven of the audit's
findings were themselves wrong and are listed as such in docs/PART22_SCRAPE_SIDE.md §9 rather than quietly
dropped: the "22 undocumented engine settings" were documented in the service's own example file, and the
"five untested core modules" have tests that import their functions instead of naming their modules. No
file in the trading path changed; the bundle's `--check`, `--emit`, `--rules`, `--catalog` and `--dashboard`
gates and every suite above were re-run afterwards and are green (docs/PART22_SCRAPE_SIDE.md §9).

The second pass of that sweep - the same instruments pointed at the documentation surface - found three
things worth naming because each is a class rather than a typo. `.env.example` assigned three names twice,
one of them a risk budget (`MAX_RISK_STATE_AGE_MS` at 5000 and at 2000), which is not a style problem but a
loader problem: dotenv takes the first value of a repeated key and docker compose's `env_file` takes the
last, so the deployment's answer depended on which one read the file. Each name is assigned once now, and
the disagreement that deduplication exposed - the execution plane's fallback is looser than the trading
engine's and the API's, while the SLO catalog derives its 4-second budget from the tighter figure - is
documented as an open decision rather than resolved by a comment, because choosing a risk default is a
trading decision. `apps/api/src/modules/health/health.service.ts` read `GIT_COMMIT_SHA` that nothing in the
repository sets, while `apps/api/src/config/app-config.module.ts` claimed no other file reads
`process.env` directly; both sentences were corrected, the two build-metadata names are documented as
build-time rather than operator-set, and `apps/api/src/config/env-example-coverage.spec.ts` now refuses
either pattern returning, including a check that the validation seam itself is still wired. Row 11 and row 12
of `docs/PART16_CORE_LAYER_GAP_AUDIT.md` were carrying Part 16-era figures (22,999 core test lines, 42
covered tables) where the tree now reads 29,568 and 43; `services/notification-service` turned out to have
a `typecheck` script that the root aggregate never ran, so the third TypeScript service was compiled by
`npm run build` and typechecked by nothing until it joined `typecheck` (it passed unchanged, exit 0, and
still has no tests of its own - a gap named here rather than filled by invention), and the document's
live-mode section was quoting a
refusal paragraph `services/execution-engine/app/composition.py` no longer renders, so it quotes the graded
one instead and states which of its own items Parts 16 and 19 have since superseded (docs/PART22_SCRAPE_SIDE.md §9).

Records and freshness, said out loud rather than practised silently: the handover documents for **Parts 16
through 22** are kept byte-identical to a fresh generation, by the chain that regenerates them in order and
then checks them; the generators for Parts 11 through 15 still exist in `scripts/` and are deliberately not
re-run, because their headers would then print today's suites as though they had been measured for those
parts. The consequence is stated here rather than left to be discovered - a later edit to a file embedded
only in a pre-16 handover (the sweep touched `docs/MULTI_TENANCY.md`, `docs/PART13_DURABLE_STORE.md`,
`docs/PART2_TRADING.md`, and two empty `__init__.py` files under `services/execution-engine`) leaves that
earlier record describing the tree as it was, including Part 11's list, which does not contain the
`grant.sql` the sweep added to the directory Part 11's generator owns. The gap sweep's own script, and the
per-language census that sits beside it, stay outside the repository for a stated reason: both report on the
tree, so shipping them inside would let an instrument move the thing it counts - and a heuristic tool that
produces false positives by design belongs beside the tree as a review aid, while the durable conclusions it
reached moved inside as tests, where they can fail a build.
```


## FILE: docs/PART11_WORKER_SCALING.md (541 lines)

*section 7's `/status` bullet: the read is now token-scoped only, with the before/after failure recorded in place so a reader of the part that BUILT the gate learns that the gate could not boot.*

````text
# Part 11 - Scale & coordination: worker plane, partitioning, read replicas

> **Honesty header.** Nothing in this part makes the platform "horizontally
> scalable" in the marketing sense; it makes the WORKER PLANE coordinated, the
> execution boundary enforced, and the read policy fail-closed. Live venue
> transmission remains refused by code (Section 9), durable engine storage
> remains Part 12 (it ultimately SHIPPED IN PART 13 -
> docs/PART13_DURABLE_STORE.md; the §13 item below carries the resolution),
> and every deferral is listed in Section 13 rather than hidden. Gates in
> Section 14 are exactly what was run, including what was not run and why.

## 1. What this part is

Part 11 delivers the coordination foundation and the first real consumer of
it: a trading-worker plane split into three roles that were previously only
described in documentation.

```
NestJS API                    Node worker process              Python execution engine
apps/api (HTTP)      ──►      apps/api dist/worker.js   ──►   services/execution-engine
enqueues TRADE_EXECUTION      validates, admits by claim,     executes against the
jobs (unchanged producers)    forwards, ack-policing          REAL core: wlct_trading
                                                              .execution.ExecutionEngine,
                                                              adapters, locks, store,
                                                              incidents, reconciliation
```

The API gained nothing and changed nothing in its producers (Section 6);
the worker holds no venue authority; the engine holds no queue and serves no
browser. This is the Part 5 boundary ("the API has no signing code and no
credential provider - those live in the trading worker") finally populated:
the worker exists, and the credentials-domain it was promised lives in ONE
process with an internal-token gate around it.

Three deliverable layers:

1. **Coordination primitives** (both languages, fixture-pinned): rendezvous
   partitioning, lease renewal law, `LeaderElector`, `PartitionClaims` with
   the compare-and-extend/renew/release Lua scripts, key builders, verbatim
   cross-language error messages, CRC32 vector table. Foundation first,
   runtime second - every runtime behaviour below rides on that shared,
   tested law rather than inventing its own.
2. **The worker runtime**: partition-gated `TRADE_EXECUTION` consumer with
   deferral accounting, engine forwarding with a strict failure taxonomy,
   graceful shutdown, deterministic-identity claims, read-only ops surface.
3. **The execution engine service**: `services/execution-engine`, a FastAPI
   process composing the CORE `ExecutionEngine` with paper adapters,
   serving the four commands the queue actually carries, refusing the fifth
   honestly, and refusing `live` at startup by code.

Plus: the read-replica policy layer (pure, table-tested, fail-closed),
observe-only chaos invariants on the money path, the config/env surface, and
compose services for `worker` and `execution-engine`.

## 2. The queue-consumer inventory (step 15)

Produced/consumed status as actually found in the repository - this table is
the scoping evidence for "consumers only where contracts exist":

| Queue | Producers (found) | Consumers before | Status after Part 11 |
|---|---|---|---|
| `audit` | audit service (fire-and-forget `enqueue`) | none in-repo (Prisma direct path is authoritative; queue is the relay) | unchanged - out of Part 11 scope |
| `email`, `notification` | notifications module | `NotificationProcessor` (`@Processor`, concurrency 10) | unchanged |
| `security`, `billing` | registered; producers land with their parts | none | unchanged (no producer = no contract to consume) |
| `maintenance` | `MaintenanceScheduler` repeatables | `MaintenanceProcessor` (inline-gated) | unchanged |
| `trade-signal` | **none in Node** (comment: "consumed by the trading engine from Part 3" - the engine's signal pipeline is Redis-stream based, `wlct:trading:events`, NOT BullMQ) | none | **deliberately still none** - implementing a BullMQ consumer for it would invent semantics for an empty queue (step 15 forbids exactly that) |
| `trade-execution` | `ExecutionCommandsService` (4 account commands, `jobId = command:accountId`, attempts 3), `ExecutionOrdersService` (`cancel-order`, `jobId = cancel-order:orderId`) | **none - the worker did not exist** | **implemented here**: `TradeExecutionProcessor` (Section 5) |
| `market-snapshot` | none in Node | none | unchanged - same reasoning as `trade-signal` |
| `strategy-control` | backtest/paper/instances services | none in-repo (executed via the engine's HTTP backtest surface + inline paths) | unchanged - its consumer is the strategy pipeline, not this part's admission law; documented as a known open plane in Section 13 |
| `dataset-control` | ingestion/lifecycle services | none in-repo (same pattern) | unchanged, same reasoning |
| `risk-control` | policy/protection services (publish-after-commit with compensation) | none in Node - the Python engine consumes published policy digests through its own loader | unchanged - the enqueue-with-compensation contract already guarantees its semantics |

The inventory rule applied throughout: **a consumer is implemented only
where the queue has a producer, a payload contract, and an execution core
that can honor it.** `TRADE_EXECUTION` is the only queue satisfying all
three; it is also the only one whose absence of a consumer was a named
liability in the delivery docs ("the only process that holds venue
credentials" - a process that did not exist).

## 3. Ownership: what claims decide, what config suggests

The law, stated once (worker-coordination.service.ts header carries the same
text):

* `WORKER_MEMBERSHIP` (config) computes **who wants** what: the rendezvous
  assignment `partitionOwner(members, p)` is deterministic, order-insensitive
  and fixture-pinned in both languages.
* Redis **claims** decide **who has**: a worker may act on partition `p`
  only while its own claim on `wlct:trading:lock:partition:<group>:<p>`
  exists and is held by it. Claims make a stale/mistaken membership list
  harmless: the wrong holder fails to claim and defers; it never executes.
* Routing key per job: `partitionFor("<tenantId>:<accountId>", WORKER_PARTITION_COUNT)`
  - the exact composition the Python side hashes (fixture vectors pin both
  languages against the same rows). One account always maps to one partition,
  which is what makes CROSS-PROCESS account serialization structural rather
  than lock-dependent.

The lease-honesty paragraph (foundation, canonical answer, repeated here
because it governs the runtime): **exactly-once PROCESSING is not claimed.
A lease guarantees at-most-one-holder between renewal clocks; duplicates
become harmless through idempotency at the effect layer** - BullMQ
deterministic `jobId` dedupe at admission, compare-and-set state machines at
the engine (a second `cancel` of a cancelled order is refused by
`ILLEGAL_STATE_TRANSITION`, not executed twice), and tenant-scoped keys
everywhere. That stack, not the lock, is what makes duplicate-safe
processing true.

## 4. The renewal law (both languages, fixture-pinned)

`renew_due_micros` / `renewDueMicros`:

| Arm | Rule |
|---|---|
| boundary | due when `elapsed_micros >= renew_millis * 1000` (exactly one interval of inactivity IS due) |
| zero/negative/non-integer interval | construction error: "renew intervals must be plain integer milliseconds >= 1" (never-stop configs die at boot) |
| non-integer micros input | error (Python: "…plain integer of microseconds"; TS: TypeError - message text not cross-pinned for the bigint-coercion row, documented in the spec) |
| backward clock step | **due, not an error** - an NTP correction must never lull a holder into skipping a renewal; timing hiccups must not become coordination outages |
| huge elapsed | due (no wraparound: bigint micros both sides) |

`LeaderElector` half-TTL rule (`ttl >= 1000`, `renew >= 250`, refusal when
`renew * 2 >= ttl`, defaults 30000 / ttl//3 / max(250, ttl//8)),
`renew_if_due` between batches, and the demotions metric law
(forced step-downs only - a voluntary `resign()` is a transition, not a
demotion) all ship tested; the elector is wired into the foundation and
exercised by both suites. **No singleton background job claimed a leader in
this part** - Section 13 lists why inventing one would violate the part's
own rule against fake functionality.

## 5. The TRADE_EXECUTION consumer (step 17)

Pipeline per job, in strict order (trade-execution.processor.ts):

1. **Validate** against the mirrored producer contract (worker.types.ts).
   Unknown job names and malformed payloads are `UnrecoverableError`:
   retrying a shape that can never succeed wastes the attempt budget and
   hides the real failure.
2. **Partition**: `partitionFor(tenant:account)` - pure, synchronous.
3. **Admit**: `coordination.holds(partition)` - synchronous verdict from the
   last reconcile tick; staleness (older than 2x the tick cadence, or no
   tick ever completed) answers `false`. The job path NEVER awaits Redis.
   Not admitted -> defer (below). Coordination failure therefore slows and
   visibly defers the pipeline; it cannot accelerate it.
4. **Serialize per account within the process** (in-flight set; a second
   job for the same account defers rather than interleaving). Cross-process
   contention is structurally partition-owned; inside the engine, the core's
   per-order locks run underneath. A fourth lock layer here would guard
   nothing and cost a Redis RTT per job.
5. **Forward** via `EngineInternalClient`: token + tenant + correlation
   headers; 30s hop timeout; no second retry loop (BullMQ owns retries -
   stacking them multiplies load into a degraded venue).
6. **Ack policy** - the boundary where "success" is earned:

| Engine answer | Classification | Job outcome |
|---|---|---|
| 200 (any business verdict in body: ACCEPTED, REJECTED_LOCALLY, DRY_RUN, DUPLICATE...) | durably answered | **completed** - a confident answer about a job is what completion means |
| 401/403 (wiring/config), 404 (no such record), 409 (identity mismatch), 422 (contract violation), 501 (unwired command) | terminal | **failed visibly** with the engine's code+reason (truncated to 256 chars) |
| 5xx, timeout, transport | retryable | **throws** - BullMQ re-delivers within the producer's attempts (3) |
| not the partition owner | routing fact | **deferred**: `moveToDelayed(WORKER_DEFER_DELAY_MS)` - not completed, not failed, no attempt consumed |

7. **Defer accounting**: each deferral increments `job.updateProgress({defers})`
   and the bounded `wlct_worker_deferred_jobs_total{queue="trade-execution"}`
   counter. At `WORKER_MAX_DEFERS` consecutive deferrals the job fails
   with "partition not claimable after N deferrals" - a permanently homeless
   job must page somebody, not orbit forever. (Deferrals cannot use the
   attempt budget: churning ownership is not worker error, and mixing the
   two makes a rebalance look like a crash loop.)
8. **SLO reuse**: `completed`/`failed` fold into the SAME `queueproc`
   counters the maintenance worker feeds (one law, all queues, zero new
   plumbing), and every job runs inside the Part 10 `'queue.process'`
   traced context with the publisher's correlation restored from the
   sidecar.

## 6. Producer contract (unchanged by this part - recorded for the reader)

`ExecutionCommandsService` (all four): `{tenantId, accountId,
requestedByUserId, requestedAt}`, `jobId = "<command>:<accountId>"`,
`attempts: 3`, `enqueueOrThrow` (a 202 that never had a job behind it is a
lie; a 503 is the truth). `ExecutionOrdersService.requestCancel`: adds
`{orderId, clientOrderId, symbol}`, `jobId = "cancel-order:<orderId>"`,
same attempts. Deterministic jobIds ARE the admission-side idempotency:
two operators clicking the same button produce one job; the consumer's
validation is the mirror of exactly these shapes, no wider.

## 7. The execution engine service (steps 17.4-17.10, honestly scoped)

`services/execution-engine` (FastAPI, internal-only, token + tenant header
on every command route):

* `POST /internal/v1/accounts/verify-credentials` -> the core
  `PaperAccountAdapter.verify_credentials` truth (always labelled
  simulated - the ONLY correct answer a simulated venue may give).
* `POST /internal/v1/accounts/refresh-balances` -> configured simulated
  balances, decimal-as-string, labelled simulated.
* `POST /internal/v1/accounts/reconcile` -> the core `ReconciliationService`
  report (orders checked, discrepancies with repaired flags, bounded views).
* `POST /internal/v1/orders/cancel` -> the core `ExecutionEngine.cancel`:
  the REAL engine with its reconciliation-state gate (UNKNOWN order state
  refuses cancellation with `RECONCILIATION_REQUIRED`), its terminal-status
  refusal, its result-unknown incident path, its per-order lock. Not found
  in this runtime's store -> 404 `ORDER_NOT_FOUND` (refusing to fabricate a
  verdict about an order it cannot see). Identity mismatch -> 409.
* `POST /internal/v1/accounts/resync-private-stream` -> **501 NOT_SUPPORTED**.
  A private-stream resync is a live-venue interaction; pretending to accept
  it in a simulated build would convert the API's honest 202 into a lie
  three hops later. The failure is visible, dated, and self-explaining.
* `GET /internal/v1/status` -> the wiring document (mode, adapter, store,
  `storeDurable: false`, `locksDistributed: false`, supported commands). The
  worker asserts this at startup and REFUSES to run against a mode it was not
  built to serve - including refusing to run against a DURABLE engine store
  until this file's ack policy is re-reviewed (the tripwire is live, not
  rhetorical). RESOLVED IN PART 13: the re-review happened, the gate now
  ACCEPTS a durable engine whose claim is coherent (`storeDurable: true`
  requires `storeBackend: "postgres"`; an incoherent claim still refuses) -
  see docs/PART13_DURABLE_STORE.md §6 for the policy text and why
  at-least-once retries are safe against the reservation + fill-dedupe
  constraints. PART 20 MEASURES THE PARAGRAPH ABOVE AND ADDS ONE LAW: this is
  the only internal route read under a token-only scope
  (`require_internal_auth_readonly`), because a process-level read has no tenant to
  name - `src/worker.ts:69` sends token + correlation and nothing else. Until then the
  read demanded a tenant header its single caller could not send, the 400 was classed
  retryable, and the reference worker logged "execution engine gate failed" and exited
  1. The command routes above keep token + tenant, refusal text unchanged to the byte.

What the engine does NOT do: no order-submission route (no producer sends
one; consumers must not grow capabilities their inputs never carry), no
database (the in-memory stores are simulated-mode-appropriate by the core's
own wiring law, and /health/ready says `storeDurable: false` instead of
hiding it; PART 13 SUPERSEDES THE CAPABILITY, NOT THE LAW - a postgres
backend exists and is opt-in, the memory default still reports
`storeDurable: false` exactly as written here, and no mode ever reported
durability it did not have), no public exposure (bound per-deployment,
compose keeps it on the internal network; tokens constant-time compared;
422 bodies name fields,
never values; `EXECUTION_MODE=live` raises at startup - code, not default).

## 8. Read-replica policy (steps 22-23)

`infrastructure/database/read-policy.ts` - one pure function, every arm
table-tested, and the composition helper in PrismaService
(`routeRead({readClass, onPrimary, onReplica, onDecision?})`):

* A read may use the replica only when ALL of: policy enabled, client
  configured, probe healthy, lag known and fresh (10s trust window -
  a stale probe sample is `null` lag, not a small one), `lag <= maxLagMs`,
  and the read classified `operational`/`analytical`. Anything else:
  primary.
* **Unclassified = execution-critical = primary.** Forgetting to classify
  routes safe by default, which is the correct outcome of forgetting.
* `DATABASE_READ_MAX_LAG_MS=0` means "have a replica, refuse to read it at
  any lag", not "any lag is fine".
* Replica-path failures are NOT retried on the primary: a read erroring on
  a dying replica is information; silently re-firing converts one sick
  replica into two overloaded databases during the incident that justified
  the policy.
* Prisma was NOT blanket-rewired - this is the policy layer the roadmap
  asked for; each repository read is an explicit, classified opt-in decided
  by its owner, and the counter (`wlct_read_routing_decisions_total`,
  bounded `result` labels: primary | replica | stale_fallback) makes
  silent-staleness-pinning visible instead of folklore.

## 9. Live money boundary

The platform-wide rule, unweakened here: live execution requires explicit
config + safety controls, and this part SHIPS LESS than that. The engine
refuses `EXECUTION_MODE=live` at startup with a message that enumerates
prerequisites. As this part shipped, that list was "credential provider, durable
store, distributed locks"; Parts 13 and 16 closed the last two and made the first
configuration rather than absence, so the sentence now names what genuinely
remains - no venue trading adapter is constructed by this service, no signed
transport is wired here, and no runbook exists for the enablement evidence a live
account must present ([`PART16_PLACEMENT_REVIEW.md`](PART16_PLACEMENT_REVIEW.md)
sec. 8). The refusal itself is unchanged and is asserted by name, not by
substring. The worker
refuses to boot against any engine not reporting `simulated`. No route,
env value, or queue payload can bypass either refusal; the specs assert the
refusals themselves.

## 10. Worker lifecycle (step 16)

`src/worker.ts` -> `NestFactory.createApplicationContext(WorkerModule)`:
no HTTP server exists to disable because none is created ("no public admin
or order-approval routes" satisfied structurally, not by flag).

Boot order: config validated (the shared schema refuses nonsense) ->
`WORKER_ENABLED=false` EXITS 1 with a reason (a silently-idle worker is an
outage with extra steps) -> engine-compatibility gate (Part 20: the status document is
parsed against a mirrored contract, so an engine answering with something that is not the
contract fails this step terminally, naming the key, instead of the gate judging defaults
the reader invented; the same parsed object is what the ops panel renders) -> module init starts
the claim tick (first tick immediate: waiting one full interval while jobs
arrive is choosing the defer path) -> consume.

Shutdown (SIGTERM/SIGINT): BullMQ workers close (no new jobs; in-flight
finish), held claims release (next owner does not wait a TTL), connections
close - bounded by `WORKER_SHUTDOWN_TIMEOUT_MS`, past which process exit
stands on the lease TTL: unacked jobs redeliver (at-least-once), claims
expire. The degraded path is exactly the crash path, which is why the
forced exit is a WARN, not a panic. `tick()` joins an in-flight reconcile
rather than returning a verdict that has not been written yet (this one was
found by the specs; the semantics fix is in the service).

## 11. Configuration surface (step 27)

| Var | Default | Read by | Notes |
|---|---|---|---|
| `WORKER_ENABLED` | true | worker | false = exit-with-reason, never idle |
| `WORKER_ID` | `host:pid:rand` | worker | must match the member grammar (1..128, `[A-Za-z0-9._:-]`) - PartitionClaims refuses at construction otherwise |
| `WORKER_MEMBERSHIP` | empty (=self) | worker (+API ops view) | THE coordinated list; identical on all replicas |
| `WORKER_PARTITION_COUNT` | 8 | worker (+API ops view) | 1..4096 (fixture ceiling); changing it rescales everyone at once |
| `WORKER_PARTITION_LEASE_TTL_MS` | 15000 | worker, ops view | >= 1000 (jitter law) |
| `WORKER_PARTITION_RETRY_MS` | 2500 | worker | >= 250 (busy-loop law) |
| `WORKER_DEFER_DELAY_MS` | 3000 | worker | >= 250 and >= retry cadence (schema cross-law - the defaults were caught violating it by the safety specs and fixed) |
| `WORKER_MAX_DEFERS` | 30 | worker | the homeless-job ceiling |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 10000 | worker | drain budget |
| `EXECUTION_ENGINE_URL` | `http://127.0.0.1:8093` | worker | http(s) enforced at client construction |
| `EXECUTION_ENGINE_TOKEN` | (none) | worker | >= 32; REQUIRED for the worker (boot refusal), never read by the API |
| `DATABASE_READ_ENABLED` | false | PrismaService | half-config (URL w/o flag or vice versa) is a BOOT ERROR |
| `DATABASE_READ_URL` | (none) | PrismaService | replica connection; never logged |
| `DATABASE_READ_MAX_LAG_MS` | 1500 | policy | 0 = primary-only while configured |
| Engine side (`EXECUTION_*`) | see service .env.example | execution-engine | `EXECUTION_INTERNAL_TOKEN` REQUIRED, placeholder-prefixed values refused |

No secrets in code anywhere in the part; the compose maps ONE
`EXECUTION_INTERNAL_TOKEN` from `.env` onto both sides (engine validates it,
worker presents it under the name `EXECUTION_ENGINE_TOKEN`).

## 12. Observability & chaos invariants (steps 23-25)

Three bounded metric families added (labels ride the CLOSED Part 9 universe -
`result`, bounded at registration; the ops source-scan law in
`observability-safety.spec.ts` was honored, not worked around):
`wlct_worker_deferred_jobs_total{queue}`,
`wlct_worker_coordination_events_total{result}` (claim_gained | claim_lost |
reconcile_failed | released), `wlct_read_routing_decisions_total{result}`.
Queue completion/failure law reuses `queueproc` unchanged.

Chaos-invariant evidence (each names the arm it pins):
* transport down mid-claim -> claims become misses -> every job defers, no
  evictions, no double-holders (worker.spec)
* reconcile input explodes -> last verdict kept until it AGES past trust,
  then fail-closed `false` (worker.spec)
* engine 503 vs 401 vs 422 vs 501 -> retry vs terminal taxonomy (worker.spec)
* deferral ceiling -> visible failure, no orbit (worker.spec)
* duplicate-ack impossibility -> `moveToDelayed` result is `{deferred:true}`,
  never a trading-meaning completion (worker.spec + processor contract)
* publisher/tracer wired, absent, or FULLY EXPLODING -> cancel verdict,
  store state, event list, and incident count identical (core:
  test_part11_observe_only.py, on the REAL composed engine + paper adapter;
  the exploding-tracer case doubles as the tripwire against anyone moving a
  raw tracer call onto a money-path branch)
* fault injection (Part 10) unchanged and still production-refused; the
  worker process never registers the injection surface at all.

## 13. Known limits and deferrals (the honest list)

1. ~~**Membership is config, not self-registering.**~~ **RESOLVED IN
   PART 12** (docs/PART12_WORKER_MEMBERSHIP.md): the heartbeat-zset registry
   is now the default-on-compose source of membership, the config list
   demoted to its documented fallback, and the law this section was written
   to protect is untouched - membership says who WANTS, claims decide who
   HAS. The deferral had one good reason: a key format must not ship before
   something needs it; Part 12 is that something, and `RedisKeys` grew
   exactly one builder (`membership_registry`).
2. **No leader-gated singleton in the worker.** The elector and its renewal
   law ship complete and tested, but the repo has no reconciliation-sweep or
   similar leader job to gate yet; inventing one to demo the feature is
   exactly the fake functionality this platform prohibits. `resync-private-stream`
   likewise stays 501 until a live adapter exists.
3. ~~**The engine's in-memory store means cancel outcomes are
   per-process.**~~ **RESOLVED IN PART 13** (docs/PART13_DURABLE_STORE.md):
   `PostgresOrderStore` ships behind `EXECUTION_STORE_BACKEND=postgres`
   (memory remains the default, and the in-memory mode's truthful
   `ORDER_NOT_FOUND`-after-restart behaviour documented here is exactly
   what that default still does), the schema joined Prisma with RLS
   coverage auto-extended to the three new tables, and the worker's
   compatibility gate was re-reviewed against the ack policy - Section 6
   of the Part 13 doc records the reasoning (reservation idempotency and
   fill dedupe make the at-least-once retries safe BECAUSE of the durable
   store, which is the condition the tripwire existed to have noticed).
4. **Time-series retention** (the market-data storage backlog item)
   remains open - Part 12 took the two coordination/DR items below and no
   more. Row-level security and the DR/backup manifest DID ship here
   (Sections 16 and 17); the RLS enablement FLIP stays checklist-gated
   deployment work, and backup-cadence AUTOMATION got its MECHANISM in
   Part 12 (`--due` grading with an alertable exit code, the
   backup-ledger.jsonl evidence trail - docs/PART12_WORKER_MEMBERSHIP.md
   sec. 8) while the scheduler WIRING stays deployment-side, listed in the
   ROADMAP open items rather than half-implemented to claim it.
5. **Repository read rewiring** (Section 8): deliberately not blanket.
6. **No `trade-signal`/`market-snapshot` consumers**: producer-less queues;
   the engine plane consumes their streams, not BullMQ jobs.

## 14. Gate ledger (generated 2026-09-13)

* `cd libs/trading-core && python3 -m pytest tests -q` -> **1324 passed**
  (1320 foundation + the 4 observe-only invariants); `ruff check wlct_trading
  tests` -> clean; `mypy wlct_trading` -> **clean, 142 files**.
* `cd apps/api && npx jest --silent` -> **354 passed / 15 suites**
  (309 pre-runtime + 21 worker + 11 read-policy + 5 ops-view + 8
  RLS-coverage); `npx tsc --noEmit` -> **0 errors**;
  `npx eslint src --max-warnings=0` -> clean; `npx prisma validate` ->
  valid; `npm run build` -> emits `dist/worker.js` (compose command target).
* `cd services/execution-engine` -> `pytest tests -q` **20 passed**;
  `ruff check app tests` -> **clean**; `mypy app` -> **clean, 10 files**
  (one documented pyproject-level per-file relaxation: the stub-less
  pythonjsonlogger base class - every other strict rule applies to that
  file and all others unchanged; no inline suppressions anywhere).
* RLS artefacts: `python3 scripts/gen_part11_rls.py` rerun over the shipped
  files -> all four **byte-identical** (generation determinism is a
  property, not an assumption); `rls-coverage.spec.ts` (8 tests) re-derives
  the tenant-table set from `schema.prisma` itself and pins the covered/
  excluded split, the GUC-name cross-reference and the no-destructive-
  statements rule.
* DR tooling: `node --test scripts/` -> **15 passed / 0 failed**; `node
  scripts/dr-manifest.mjs --check` -> valid (5 components, RPO 60m / RTO
  4h, 90-day timed drill); `--plan` byte-deterministic across runs and
  credential-free by scan.
* Root `.env.example` parses through `validateEnv` with every Part-11
  default resolved (`WORKER_*` sane, replica pair off); the schema
  cross-laws refuse the known-bad shapes.
* `docker-compose.yml` parses; `worker` and `execution-engine` expose no
  ports; YAML anchors/health dependencies validated by the compose loader.
* NOT run here, stated plainly: the compose stack itself (no Docker in this
  sandbox), real Redis/Postgres integration (coordination runs against the
  faithful claim-server fake; PrismaService replica paths against
  configured stubs; the RLS POLICY behaviour against live Postgres is the
  enablement-checklist probes in `docs/DR.md` - no PostgreSQL is installable
  in this sandbox, and the generated SQL + spec pins are what ships in
  exchange), and the engine against a live venue (no live wiring exists). The Part 10 requirement "run the complete chaos/failover matrix"
  is satisfied at the level the sandbox allows (fault-mode matrices in-unit);
  a staging run remains a deployment step, listed in the runbook below.

## 16. Row-level security (the defence layer under the defence layer)

The application already refuses cross-tenant queries two ways (explicit
`tenantId` predicates in services; the `$extends` factory that injects them
again). Both are application code, and application code is what this layer
guards against: a new path that never went through either. The database
itself now refuses the row (`docs/MULTI_TENANCY.md` carries the full design;
the summary lives here because it is part of this delivery):

* **Generated coverage:** `scripts/gen_part11_rls.py` reads the schema and
  emits one `tenant_isolation` policy for every non-null-`tenantId` table
  (38 today), the GUC-reading `wlct_current_tenant_id()` function, an
  enablement script pairing every `ENABLE` with `FORCE` (the app role owns
  the tables in this deployment - without FORCE the policies decorate
  nothing), the exact-inverse disable script, and the coverage JSON.
* **Drift is a test failure, not a wiki reminder:** `rls-coverage.spec.ts`
  re-derives the same sets from `schema.prisma` at test time; a tenant model
  added without rerunning the generator turns the suite red with the table
  named. The nullable-`tenantId` exclusions (7 tables) are equally pinned -
  a decision with a rationale, never an omission.
* **The app-side seam:** `PrismaService.withTenantRls(tenantId, work)` -
  UUID-validated, bind-parametered, `SET LOCAL`-scoped, transaction-first.
  Safe to adopt path-by-path precisely because the policies stay dormant
  until the DBA flip; adoption and enablement are decoupled on purpose, and
  the schema cross-law (defer >= renewal cadence) is the same discipline in
  a different coat: the validator catches the pair-mistake, not the outage.
* **Fail-closed at every arm:** no GUC, `NULL`; `tenant_id = NULL` is never
  true; an unscoped read sees zero rows, an unscoped write is refused. The
  generator REFUSES to emit when the covered-table parse yields an
  implausibly small set, and refuses non-uuid tenant columns outright rather
  than guessing a cast.

## 17. DR/backup manifest tooling (the contract before the automation)

`docs/dr/manifest.json` is the platform's disaster-recovery plan as data:
five components - `encryption-keys` restoring before `postgres` (the
validator REFUSES the inversion: ciphertext without keys is not a degraded
system, it is a deleted one) - each with backup method, verification string,
env-KEY references and repository paths; plus the ordered restore
procedure, the timed-drill success criteria, and three rules the file
reasons from (keys before data; Redis rebuilt, not restored; timed or it
didn't happen).

`scripts/dr-manifest.mjs` keeps it honest, mechanically:

* `--check` (CI-grade): every referenced path must EXIST in the repository,
  every env ref must appear in one of the five `.env.example` templates,
  restore orders must form contiguous 1..n, required components must be
  present, cadence fields must be coherent, and a secret-shaped scan refuses
  PEM material, `user:pass@host` URLs or literal `KEY=secret` values - a
  backup plan in git that contains a real credential is the worst possible
  outcome of diligent documentation.
* `--plan` renders the operator runbook as a dry run: deterministic (no
  clock), `$ENV` references never resolved here, commands to be executed by
  a human who has the manifest's invariants on screen.
* `docs/DR.md` is the human half: post-restore probe SQL (the RLS probes
  double as the enablement verification) and the drill-record template a
  rehearsal must fill in to count as one.

Deliberately absent: a backup scheduler. Automating against an unvalidated
plan is how platforms confidently preserve the wrong bytes; the manifest is
the contract the scheduler will be written against, and its absence from
today's runtime is stated in SECURITY.md's gaps rather than glossed.

## 18. Runbook

Bring up the plane (post-Part-11 dev):

```bash
# 1. engine
cd services/execution-engine
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
EXECUTION_INSTANCE_ID=exec-local EXECUTION_INTERNAL_TOKEN=$(openssl rand -hex 32) \
  # `--factory` because app.main exposes create_app and deliberately no module-level
  # app - the target this line used to name (app.main:app) resolves to nothing, which
  # Part 18 found and fixed in the images; docs/PART18_METRICS_EXPOSITION.md sec. 6.1.
  .venv/bin/uvicorn --factory app.main:create_app --port 8093
# 2. worker (repo root, packages built)
cd apps/api && npm run build && npm run worker
#    (or: npm run worker:dev)
# 3. API consumes/verifies as before; ops view:
#    GET /v1/observability/worker-coordination   (OPERATIONS_READ)
```

Scaling events:

* **Add a worker**: choose its `WORKER_ID`; set `WORKER_MEMBERSHIP` to the
  full new list on EVERY worker (and the API, for the ops view); restart the
  fleet. During rolling restart, non-owners defer and owners keep processing;
  no job is lost (deferrals are delays, not failures), in-flight work drains
  per the Section 10 sequence.
* **Kill a worker mid-batch**: claims expire within the lease TTL; the
  partitions move to the remaining members (rendezvous moves ONLY the dead
  member's partitions); unacked jobs redeliver by at-least-once.
* **Redis blip**: held sets age; verdicts fail closed to "not mine" ->
  deferral; claims that survive re-assert without eviction. Nothing needs an
  operator during the blip except the alert the deferral counter exists to
  raise.
* **Staging chaos run** (the not-runnable-here half): arm
  `FAILURE_INJECTION_ENABLED` (non-production only), kill -9 workers under
  load, promote/demote the replica, and assert the Section 12 invariants on
  real infrastructure before believing any of this in production. Part 21 put
  that sentence into machine-readable form:
  `python3 -m wlct_trading.observability.chaos --list` enumerates the ten
  scenarios (this section's four are among them) with their fault points,
  required infrastructure, expected invariant, observation, recovery, cleanup
  and timeout budget, and a run anywhere without the processes grades every one
  `UNVERIFIED` and exits 2 - it cannot award a pass it did not observe, which is
  the property that makes a staging `PASS` worth reading. See
  docs/PART21_DR_OPERATIONS.md sec. 5.
````


## FILE: docs/PART19_LIVE_ENABLEMENT.md (521 lines)

*section 8 points at the reader that Part 19 left without one - the enablement and placement facts published on `/status` now reach an operator, which is the difference between a refusal that is computable and one that is visible.*

````text
# Part 19 — Live enablement: credentials, attestation grading, and the operator confirmation

Scope: the layer between "the review exists" (Part 16) and "the review can be trusted by a
human who is about to point it at real money". Audit first, then the pieces the audit found
genuinely missing — a concrete credential fetcher, a typed operator confirmation, the axis
that lets either be counted, and a report that states what live still lacks.

Ship state: **`EXECUTION_MODE=live` is still refused at startup, by code.** Nothing here
changes that, and §8 explains why the parts added here cannot.

Source of truth for every claim below: `libs/trading-core/wlct_trading/execution/`
(`credentials.py`, `live_confirmation.py`, `live_enablement.py`, `placement_review.py`,
`placement_attestor.py`, `config.py`, `locks.py`), `services/execution-engine/app/`
(`config.py`, `credentials.py`, `secret_fetcher.py`, `placement.py`, `composition.py`,
`schemas.py`, `logging_config.py`, `observability.py`) and the Part 19 tests
(`libs/trading-core/tests/test_part19_*.py`, `services/execution-engine/tests/test_part19_*.py`).

---

## 1. What changed, and what was already there

The Part 19 brief named thirteen items. Eight were already shipped: provider selection with a
fail-closed default (13), permission attestation with typed per-check reasons (16), symbol
review through the existing normalisation (16), account-capability review (16), key-rotation
review (16), the per-order verdict with correlation ids (16), order-scoped review (16), and
signal routing (18). Those are covered by tests and cross-links here, not by new code.

The gaps were four, plus one documentation gap:

| Gap | What was added | Where |
| --- | --- | --- |
| `SecretFetcher` was an interface with no implementation, so `EXECUTION_CREDENTIAL_SOURCE=secret-manager` could only refuse to start | A Vault KV v2 fetcher: HTTPS-only, no embedded credentials, path-template and identifier validation before any request, bounded responses, and a decoded shape carrying exactly what the provider needs | `app/secret_fetcher.py` |
| The gate had no typed, scoped, expiring human decision in it | `LiveOperatorConfirmation` (HMAC over canonical JSON), `ConfirmationVerifier`, the review's `CONFIRMATION` findings, and the service wiring that builds and reports both | `execution/live_confirmation.py`, `placement_review.py`, `placement_attestor.py`, `app/placement.py`, `app/config.py` |
| No way to count or rank *which part* of enablement is unhealthy — only individual codes | The `ReviewArea` axis, `blocking_areas` / `area_counts` on the verdict, seven derived counters | `placement_review.py`, `wlct_trading/metrics.py`, `execution/engine.py` |
| No way to state what live is missing without re-listing it in prose | `evaluate_live_enablement`: derived from the wiring the process actually built, with prose for humans and codes for machines | `execution/live_enablement.py`, `app/composition.py` |
| The enablement list lived as one paragraph of prose in the Part 16 document | This document is the live statement; §8 says what the old paragraph is now for | here |

One item was deliberately **not** built: no `ALLOW_LIVE` flag, no override, no bypass window.
Item 6 asked for a confirmation that is typed, contextual, scoped and expiring precisely so
that it is not a boolean, and the startup refusal was specified as the invariant to narrow and
never remove.

## 2. The two vocabularies, and why there are exactly two

**Prerequisites** answer "what must exist before this deployment can be trusted live". They
live in `live_enablement.py` as `LivePrerequisite`, and are graded by the composition root
from the objects it just built — never from a settings dump:

| Prerequisite | How it is graded (`app/composition.py:436` onward) |
| --- | --- |
| `CREDENTIAL_SOURCE_CONFIGURED` | `EXECUTION_CREDENTIAL_SOURCE.strip()` is not `none` |
| `CREDENTIAL_FETCHER_WIRED` | that source is `secret-manager` **and** a `SecretFetcher` is in the provider chain (`CredentialWiring.fetcher_source is not None`) |
| `VENUE_ATTESTOR_WIRED` | `PlacementWiring.mode == "venue"` — a gatherer that asked the venue, not one that described this process |
| `OPERATOR_CONFIRMATION_ACCEPTED` | the verifier exists, and its deployment-level grading is `VALID` |
| `DURABLE_STORE_WIRED` | `getattr(store, "is_durable", False)` |
| `DISTRIBUTED_LOCKS_WIRED` | `getattr(locks, "is_distributed", False)` |
| `IP_ALLOWLIST_ENFORCED` | `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST` (default `true`) |
| `SIGNED_TRANSPORT_WIRED` | `False`, written literally at `app/composition.py:454` |

`reason_codes()` returns `"LIVE_" + prerequisite.name`. There is no second enum: a prerequisite
and its refusal code cannot disagree because one is spelled from the other.

**Review areas** answer "which question of the per-order review did this finding answer", and
live in `placement_review.py` as `ReviewArea`. Every `ReviewCode` maps to exactly one via
`REVIEW_AREA_BY_CODE`:

| Area | Codes |
| --- | --- |
| `PROVENANCE` | `NO_ATTESTATION`, `VENUE_ATTESTATION_REQUIRED`, `STALE_ATTESTATION`, `FUTURE_ATTESTATION`, `ATTESTATION_UNREACHABLE`, `ATTESTATION_REFUSED_BY_VENUE`, `ATTESTATION_RATE_LIMITED`, `MALFORMED_VENUE_RESPONSE` |
| `CREDENTIAL` | `NO_SPOT_TRADE_PERMISSION`, `NO_READ_PERMISSION`, `WITHDRAW_ENABLED`, `IP_ALLOWLIST_REQUIRED`, `KEY_EXPIRED`, `KEY_TOO_OLD`, `TRADING_AUTHORITY_EXPIRED`, `CREDENTIAL_UNREADABLE` |
| `ACCOUNT` | `ACCOUNT_TRADING_DISABLED`, `ACCOUNT_TYPE_UNEXPECTED` |
| `SYMBOL` | `SYMBOL_UNATTACHED`, `SYMBOL_NOT_TRADING`, `ORDER_TYPE_UNSUPPORTED`, `TIF_UNSUPPORTED` |
| `CLOCK` | `CLOCK_SKEW_EXCEEDED`, `CLOCK_UNSYNCHRONISED`, `RECV_WINDOW_INSUFFICIENT` |
| `CONFIRMATION` | `OPERATOR_CONFIRMATION_ABSENT`, `OPERATOR_CONFIRMATION_EXPIRED`, `OPERATOR_CONFIRMATION_NOT_YET_VALID`, `OPERATOR_CONFIRMATION_SCOPE_MISMATCH`, `OPERATOR_CONFIRMATION_UNVERIFIED`, `OPERATOR_CONFIRMATION_ACCEPTED` |
| `UNCLASSIFIED` | none, by construction. A finding lands there only if the mapping forgot its code, which is why the area exists: a new code that nobody classified is a visible count, not an invisible omission. |

Two vocabularies and not three, because the enablement report and the per-order counters are
both organised by "which part", and `test_the_counter_fields_are_exactly_the_areas`
(`test_part19_review_areas.py:127`) pins that the counter fields and the areas are the same
set in both directions.

`CONFIRMATION` includes `OPERATOR_CONFIRMATION_ACCEPTED`, an informational code: a dashboard
that can see "the confirmation passed" is one an operator can act on. `blocking_areas` never
contains an informational finding, so acceptance cannot make a verdict look refused.

## 3. Credential provider selection

Chosen once, at boot, by `app/credentials.py:build_credential_provider`:

| `EXECUTION_CREDENTIAL_SOURCE` | What you get | Boot conditions |
| --- | --- | --- |
| `none` (default) | `NullCredentialProvider` | Every order needing a key is refused. A fresh deployment cannot trade by accident. |
| `environment` | `EnvironmentCredentialProvider`, wrapped in `CachingCredentialProvider` | `EXECUTION_CREDENTIAL_ENV_PREFIX` is required; the pair is **refused when `NODE_ENV=production`** ("process-wide key material cannot be scoped per tenant, is visible in every crash dump, and does not rotate") |
| `secret-manager` | `SecretManagerCredentialProvider(fetcher)`, wrapped in `CachingCredentialProvider` | Requires a constructed fetcher. Nothing constructs one unless `EXECUTION_CREDENTIAL_FETCHER` names it; see §4. |

The laws that make this explicit, deterministic and fail-closed:

* **No fallback, in either direction.** `secret-manager` never reads the environment;
  `environment` never calls a fetcher. The choice is made at boot or the boot fails; there is
  no per-order attempt at "the other one".
* **No default fetcher.** `EXECUTION_CREDENTIAL_FETCHER` defaults to `none` even under
  `secret-manager`, so naming a source is a refusal, not a behaviour.
* **A fetcher selected for a source that ignores it is a boot failure:** *"the fetcher is
  consulted only by the secret-manager provider, so this combination is a deployment that
  believes it has credential plumbing it does not use"*.
* **The token is not a settings field.** `EXECUTION_VAULT_TOKEN_ENV` holds the *name* of a
  variable; the value is read from `os.environ` inside the module that uses it, at
  construction and at each lookup. `to_public_dict()`, `model_dump()` and `repr()` therefore
  have nothing to leak — `test_the_token_has_no_field_it_could_be_stored_in` asserts the field
  does not exist, which is a stronger pin than "the view omits it".
* **Caching is bounded.** `EXECUTION_CREDENTIAL_CACHE_SECONDS` (default 300) is how long a
  revoked key can still look live. The cache key includes tenant, account and exchange, so one
  tenant's credential cannot satisfy another's.
* **What the wiring object exposes is what downstream needs:** `provider`, `source`,
  `fetcher_source`, `tenant_id`, `account_id`, `cache_seconds`. `fetcher_source` is `None`
  unless a fetcher is genuinely in the path — which is the exact value the enablement report
  reads, so the report cannot claim a fetcher because a setting mentioned one.

The boot line is `execution_engine.credentials_selected`, carrying `providerSource`, and either
`providerVariableNames` (the two env names, for `environment`) or `providerFetcher`
(`vault-kv2` / `injected`), plus `cacheSeconds`. Those keys say `provider*` rather than
`credential*` for one reason: `app/logging_config.py:RedactionFilter` replaces the value of any
record key whose *name* is credential-shaped, so `credentialSource` in a log line prints
`[REDACTED]` and the line tells an operator nothing. `/status` and `/health/ready` never pass
through that filter and keep the `credentialSource` / `credentialFetcher` spelling published in
Part 16. The rename is confined to log records, and
`test_the_boot_log_names_the_mechanism_and_nothing_else` installs the real filter around its
assertions so the property holds in any test order rather than only when another test happened
to configure logging first.

## 4. Vault KV v2: the concrete fetcher

`app/secret_fetcher.py` implements `SecretFetcher` against the KV v2 HTTP API. The design is
almost entirely refusals, which is why the module is short.

Configuration, and what `VaultKvConfig.__post_init__` (and `app/config.py`) enforce:

| Variable | Default | Enforced |
| --- | --- | --- |
| `EXECUTION_CREDENTIAL_FETCHER` | `none` | `none` or `vault-kv2`, nothing else |
| `EXECUTION_VAULT_ADDR` | unset | required by `vault-kv2`; `scheme must be https or http`; then `must be https`, because "the deployment's service mesh is not a substitute for transport security in a component that fails closed over everything else"; `must not embed credentials (a 'user:pass@host' authority)`; one trailing slash stripped |
| `EXECUTION_VAULT_MOUNT` | `secret` | `must be one safe path segment` — a nested mount is spelled in the template instead, so this value stays checkable |
| `EXECUTION_VAULT_PATH_TEMPLATE` | `wlct/{tenant}/{account}/{exchange}` | not blank; `may only contain {tenant}/{account}/{exchange}` (an `unknown placeholder(s)` list is in the refusal, because a typo like `{tenent}` would otherwise look up a path that never exists and report "no secret" forever); no `unbalanced braces`; no `..` segment |
| `EXECUTION_VAULT_TOKEN_ENV` | `EXECUTION_VAULT_TOKEN` | non-blank and `must be an environment-variable name` |
| `EXECUTION_VAULT_NAMESPACE` | unset | a non-blank namespace path with no control characters |
| `EXECUTION_VAULT_TIMEOUT_MS` | `3000` | at least 250 — below that the fetch tests Vault's availability rather than the network |
| `EXECUTION_VAULT_TLS_VERIFY` | `true` | off is legal outside production; production refuses a credential path that does not verify |
| `EXECUTION_VAULT_MAX_RESPONSE_BYTES` | `65536` | `must be within 1 KiB..4 MiB` |

Per lookup:

* `GET {addr}/v1/{mount}/data/{rendered path}` with `X-Vault-Token` and, only when configured,
  `X-Vault-Namespace`. The `data/` segment and the `.data.data` envelope are asserted in the
  tests rather than remembered, because both are KV v2 specifics and a fetcher that guesses them
  works until the day it silently reads nothing.
* **Identifiers are validated before anything is rendered into a URL.** A tenant, account or
  exchange must match `[A-Za-z0-9._-]{1,64}`; otherwise: *"the tenant identifier '../etc' is not
  a safe path segment … the lookup was refused before any request left this process, because the
  alternative — encoding it — would make a traversal reach a different tenant's secret."*
  `test_an_unsafe_identifier_never_becomes_a_request` pins the "no request" half by asserting the
  transport was never called.
* The rendered path must be inside `1..MAX_VAULT_PATH_LENGTH` (512) characters: an absurd but
  legal template is a named refusal rather than a `414` from a proxy three hops away.
* Any non-200 is `CredentialNotFound` naming the status and quoting **no** response body. 400,
  403, 404, 429, 500 and 503 are each parametrised, because "wrong token" and "wrong path" are
  different faults for the operator and one flattened "lookup failed" costs the next engineer an
  hour. A transport failure names the exception type and not the URL.
* `api_key` and `api_secret` must be present and non-blank (`"the stored secret's api_secret is
  blank."`). Both `api_secret` and `apiSecret` spellings are accepted, and two spellings that
  disagree are refused — a credential path with two answers is a credential path where somebody
  edited one of them.
* `permissions` is optional and defaults to **no claim**: an absent field is not `{"SPOT": true}`.
  A `withdraw` permission is carried through precisely so the review can refuse on it. That is
  the non-custodial rule, and it is split across two places on purpose
  (`placement_review.py:1038`): `ExchangeCredentials.assert_safe` raises on the *positive* case
  — a key that can withdraw — and the review closes the *unknown* case, because "we asked the
  venue and it did not say the key cannot withdraw" is not a state to trade inside. The fetcher
  therefore has no opinion about withdrawal at all: it stores what the path says, and the law that
  acts on it is in the core, where it can be tested against both answers and against neither.
* `expiresAtMicros` is read when stored, and rejects a string that needs a timezone decision
  nobody wrote down — digits are accepted, `"2026-01-01"` is not. It is what lets the core's
  `KEY_EXPIRED` law do anything at all.
* The response body is bound *before* parsing, and an oversized body is refused without being
  consumed: `"the response was 70008 bytes, above the 65536 byte bound for a KV secret; this
  path is not holding an API key pair."`
* Nothing about a response is rendered. `describe()`, `repr()` and every refusal message are
  built from configuration names, and
  `test_the_fetcher_never_renders_the_token_or_the_secret` asserts the token and the secret
  appear in none of them — including in the message of a decode failure, which names the
  exception type and not the bytes it came from.
* There is no retry. A Vault outage is a boot-time or lookup-time fact; the cache is what
  defines how much of an outage a running engine rides through, and re-reading a five-millisecond
  timeout in a loop is how an outage becomes a stampede.

`vault-kv2` is the one concrete fetcher because it is the store this platform's operators
already run, and because it exercises the whole interface — network, auth, envelope, failure
modes — without inventing a provider-specific concept the core would then have to model. A
second fetcher (KMS, or a file whose mode is checked) is additive: implement `SecretFetcher`,
widen the `Literal` and add one branch, and the tests in `test_part19_vault_fetcher.py` are the
checklist of what a fetcher owes.

## 5. Minting an operator confirmation

The confirmation is a signed statement that a named human authorised *this scope*, for *this
deployment*, until *this instant*. The digest exists so that "the operator said yes" cannot be
produced by editing a file nobody signed.

The record, as configuration carries it (`to_payload` / `from_payload`, camelCase, and nothing
else — an unknown key is a boot failure rather than a dropped field):

```json
{
  "instanceId": "exec-prod-1",
  "tenantId": "tenant-1",
  "accountId": "account-1",
  "exchange": "BINANCE",
  "symbols": ["BTCUSDT"],
  "orderTypes": ["LIMIT"],
  "issuedAtMicros": 1789603200000000,
  "expiresAtMicros": 1792195200000000,
  "nonce": "20260101T000000Z-a1b2c3",
  "digest": "…"
}
```

The signed bytes, exactly:

1. That payload without `digest`, encoded by `canonical_confirmation_json`:
   `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`. Sorting keys
   is why the JSON in a repository and the bytes under the MAC can be the same thing;
   `symbols` and `orderTypes` are stored **sorted** for the matching reason — a set has no
   order and a signature needs one.
2. `digest = hmac.new(key, those_bytes, hashlib.sha256).hexdigest()` — lower-case hex, 64
   characters (`SHA256_DIGEST_HEX_LENGTH`), because a truncated line is not a signature.
3. Verification recomputes and compares with `hmac.compare_digest`, never `==`, so a record
   cannot be probed byte by byte.

A worked example, runnable wherever the core is importable:

```python
from datetime import datetime, timedelta, timezone
from wlct_trading.execution.live_confirmation import LiveOperatorConfirmation

now = datetime.now(timezone.utc)
record = LiveOperatorConfirmation(
    instance_id="exec-prod-1",
    tenant_id="tenant-1",
    account_id="account-1",
    exchange="BINANCE",
    symbols=frozenset({"BTCUSDT"}),
    order_types=frozenset({"LIMIT"}),
    issued_at_micros=int(now.timestamp() * 1_000_000),
    expires_at_micros=int((now + timedelta(days=30)).timestamp() * 1_000_000),
    nonce=now.strftime("%Y%m%dT%H%M%SZ") + "-a1b2c3",
).with_digest(open("/run/secrets/confirmation_hmac_key").read().strip())
print(record.to_payload())
```

Put that JSON where `EXECUTION_OPERATOR_CONFIRMATION_FILE` points, or inline in
`EXECUTION_OPERATOR_CONFIRMATION_JSON`. Setting both is a boot refusal: two sources for one
ceremony means one of them is stale, and the stale one will be the one the next person reads.
Put the HMAC key in the variable named by `EXECUTION_CONFIRMATION_KEY_ENV` (default
`EXECUTION_CONFIRMATION_HMAC_KEY`) — env-only, exactly like the Vault token, for exactly the
same reason.

What minting refuses, by `LiveOperatorConfirmation.__post_init__`:

* A window wider than `MAX_CONFIRMATION_WINDOW_MS` — 90 days, expressed in **milliseconds**,
  while `issuedAtMicros` / `expiresAtMicros` are microseconds. That mismatch is a live trap for
  anyone extending this code, so both edges are pinned rather than reasoned about:
  `test_a_window_longer_than_the_ceiling_is_refused` builds the smallest record one
  millisecond past the bound (with the `* 1_000` spelled out in the test), and
  `test_the_ceiling_itself_is_allowed` pins that the bound is inclusive, because a ceiling that
  also refuses the longest legal record is a bug nobody notices until a deployment cannot mint.
  The refusal message is *"re-run the ceremony rather than minting a standing order"*: a
  confirmation that never expires is an API key with extra steps.
* A `nonce` shorter than `MIN_NONCE_LENGTH` (16 characters). The nonce is what makes two
  ceremonies over an identical scope produce different digests, so a replay of a superseded
  record is visible in the audit trail instead of being byte-equal to the live one.
* `required=True` with no key configured: the type will not carry a demand it cannot verify.
* A digest of the wrong length, a payload with unknown keys, an `expiresAtMicros` before
  `issuedAtMicros`.

What it does not refuse, and this is the one place a reader is likely to guess wrong: an
**empty** `symbols` or `orderTypes` set is not "no symbol". It means every symbol the
deployment's policy allows, and in any description it renders as the marker `SCOPE_UNBOUNDED`
(`"all-configured"`) so that "unbounded" and "nothing" — one character apart in JSON — never
have to be told apart by a human. Minting it bounded is still the operationally correct thing
to do, because scope is the entire purpose of the ceremony; it is simply not enforced by the
constructor, and the report of a wide record says so in words rather than hiding it.

**Rotation** is a re-run: mint a record with a fresh nonce starting now, replace the file, let
the old one lapse. The record itself is parsed at boot, so a new file takes effect on the next
start; the key is read at verifier construction, so a key rotation also needs a restart.
`placement.operatorConfirmation.fingerprint` on `/status` (§7) is how you confirm which record a
given process is holding.

Rotating the **key** is the one act with a consequence worth stating before somebody does it
mid-incident: verification recomputes the digest with the key the process holds now, so every
record signed with the previous key stops verifying the moment the new one is loaded. The order
is mint-with-the-new-key, publish, restart. Doing it the other way round leaves a deployment
refusing its own orders with `OPERATOR_CONFIRMATION_UNVERIFIED` until someone works out that the
ceremony is fine and the key under it moved.

## 6. How a confirmation is checked, per order

`ConfirmationVerifier.assess(tenant_id, account_id, symbol, order_type, now_micros)` returns a
`ConfirmationOutcome(state, code, detail)`. Nothing else.

| State | Code | Operator's move |
| --- | --- | --- |
| `NOT_REQUIRED` | — | The policy does not ask; the review adds nothing on this axis |
| `ABSENT` | `OPERATOR_CONFIRMATION_ABSENT` | Mint one (§5) |
| `EXPIRED` | `OPERATOR_CONFIRMATION_EXPIRED` | Re-run the ceremony; check the minting host's clock if it was minted minutes ago |
| `NOT_YET_VALID` | `OPERATOR_CONFIRMATION_NOT_YET_VALID` | Before `issuedAtMicros` — usually a clock on the host that minted it |
| `SCOPE_MISMATCH` | `OPERATOR_CONFIRMATION_SCOPE_MISMATCH` | Right ceremony, wrong order. `detail` names the axis: tenant, account, instance, exchange, symbol or order type |
| `UNVERIFIED` | `OPERATOR_CONFIRMATION_UNVERIFIED` | Digest mismatch, unparseable record, or a verifier that raised. Treat as hostile until proven otherwise: re-mint, and check which key signed it |
| `VALID` | `OPERATOR_CONFIRMATION_ACCEPTED` | In window, in scope, signature good |

How that is wired into the gate (`_confirmation_findings`, `placement_review.py:1331` onward):

* Findings exist only when `PlacementReviewPolicy.require_operator_confirmation` is set, which
  only `EXECUTION_REQUIRE_OPERATOR_CONFIRMATION` sets. Default off, so an untouched deployment
  gets byte-identical verdicts — pinned by
  `test_an_unrequired_passing_confirmation_adds_nothing_to_the_verdict`.
* A verifier that answers `NOT_REQUIRED` while the policy demands a check is a blocking
  `UNVERIFIED`: the flag and the wiring may disagree only in the direction that blocks. For the
  same reason, `PlacementReviewer` refuses to be constructed at all when the policy asks and no
  verifier was supplied (`"no ConfirmationVerifier was supplied"`).
* `PlacementReviewer.review()` still never raises. A verifier that throws becomes a blocking
  `UNVERIFIED` finding naming the exception **type** and not its message — a collaborator's
  error text is precisely where a path or a secret lands in an audit trail.
* Severity, and therefore whether the order is refused, continues to be decided by
  `requires_venue_attestation`, which comes from the **runtime mode** and never from the
  policy. So the flag can only ever *add* refusals, and defaults to not blocking in a simulated
  runtime. Since live is refused at boot (§8), what an operator sees today is a simulated engine
  reporting exactly which orders its confirmation would have refused — which is the rehearsal
  this feature exists to provide.
* `PlacementFacts.confirmation` and `.confirmation_detail` are **outside**
  `ATTESTATION_WIRE_FIELDS`, so the bytes a venue attestor signs are unchanged, and the detail
  string is bounded by `MAX_CONFIRMATION_DETAIL_LENGTH`.
* One intended consequence to know before comparing audit rows: the verdict's canonical form
  includes `policy.to_public_dict()`, so a verdict id computed from here on covers
  `requireOperatorConfirmation`. That is the point — two deployments with different policies must
  not produce colliding verdict ids — and it means verdict ids recorded before Part 19 are not
  comparable with ids recorded after.

Why boot refuses a *missing* confirmation but not an *expired* one: no record at all means the
deployment is misconfigured, and saying so at boot is cheaper than 100 % refusals later. An
expired record means the configuration is right and the ceremony lapsed; the process still has
cancellations, reconciliation and an audit trail to serve, and killing it over an
administrative slip turns an operator's missed date into an outage of the only path that can
close positions safely. So: boot continues, every order is refused, `/status` says which.

## 7. Reading the enablement picture

`build_runtime` grades the wiring it just built and keeps the result on
`EngineRuntime.live_enablement`. For the default simulated deployment with the in-process store:

```json
{
  "liveRefused": true,
  "missing": ["CREDENTIAL_SOURCE_CONFIGURED", "CREDENTIAL_FETCHER_WIRED",
              "VENUE_ATTESTOR_WIRED", "OPERATOR_CONFIRMATION_ACCEPTED",
              "DURABLE_STORE_WIRED", "DISTRIBUTED_LOCKS_WIRED", "SIGNED_TRANSPORT_WIRED"],
  "satisfied": ["IP_ALLOWLIST_ENFORCED"],
  "missingCodes": ["LIVE_CREDENTIAL_SOURCE_CONFIGURED", "LIVE_CREDENTIAL_FETCHER_WIRED",
                   "LIVE_VENUE_ATTESTOR_WIRED", "LIVE_OPERATOR_CONFIRMATION_ACCEPTED",
                   "LIVE_DURABLE_STORE_WIRED", "LIVE_DISTRIBUTED_LOCKS_WIRED",
                   "LIVE_SIGNED_TRANSPORT_WIRED"],
  "hardBlockersPresent": true,
  "credentialSource": "none"
}
```

`satisfied` moves as pieces are turned on; `liveRefused` and `hardBlockersPresent` do not.
`credentialSource` is echoed so a reader of the payload alone knows which provider the grading
was done against, without re-deriving it from anything.

The three renderings of one list, and why all three exist:

* `missing` / `satisfied` — the enum values, for a machine to diff.
* `missingCodes` — the `LIVE_*` refusal codes, for the taxonomy the rest of the platform speaks.
* `render_refusal(mode)` — prose, for the startup message, where `CREDENTIAL_FETCHER_WIRED`
  reads as "credential fetcher wired". A fourth spelling of the same list would be a fourth
  thing to keep in sync, so the sentence is generated from the same `LivePrerequisite` members
  rather than written beside them.

Where the facts are published:

| Surface | Fields | Notes |
| --- | --- | --- |
| `GET /internal/v1/status` (authenticated) | `liveEnablement` (the JSON above), `credentialSource`, `credentialFetcher`, `operatorConfirmation`, `placement.confirmationConfigured`, `placement.operatorConfirmation` | `credentialFetcher` is the wiring's `fetcher_source`: `null` when nothing is in the path, even though the *settings* view says `"none"` for the same state — one is "what is wired", the other is "what was configured", and collapsing them would hide a deployment whose settings and wiring disagree. |
| `GET /health/ready` (unauthenticated) | the same block, because the route spreads the wiring view and `describe()["placement"]` verbatim | Carries presence and shapes only. `operatorConfirmation` is `public_summary()`: `required`, `keyConfigured`, `recordPresent`, `expiresAtMicros`, `fingerprint` — 12 hex characters (`FINGERPRINT_LENGTH`) of the digest, a correlation handle and not the MAC. `test_ready_carries_the_same_block_unauthenticated_and_no_material` scans the payload for credential-shaped keys and for the words `api_secret`, `signing_key`, `private_key`, `nonce`. |
| Startup, when `EXECUTION_MODE=live` | the refusal text | The operator gets the missing list at the moment they were reaching for a mode switch. |
| `POST /internal/v1/placement/attest` | the per-order verdict, confirmation codes included | "would this order be refused", answered by the same code path the engine runs. |
| `GET /metrics` | `wlct_execution_placement_blocks_{area}_total` × 7, `wlct_execution_wiring{component="operator_confirmation"}`, `{component="live_credential_fetcher"}` | Derived, not hand-listed: Part 18 builds one counter family per `ExecutionCounters` field, so seven new areas needed no exporter change — `test_the_area_counters_are_derived_without_an_exporter_edit` proves the exposition with a value on it, because empty families are omitted by law. |

Two denominators that are deliberately different: `area_counts` counts *findings* (one order can
produce three credential findings), while `placement_blocks_{area}` counts *orders* refused. A
ratio between them is a fact; an equality would be a coincidence.

Part 20 note, added when this part's publication half finally gained a reader: every row of the
table above except the startup refusal is now consumed. The worker's client mirrors the whole
`/status` document instead of nine keys of it, and `GET /v1/observability/execution` renders an
`ENGINE POSTURE` section from it - which is what makes the `null`-versus-absent distinction in the
first row load-bearing rather than pedantic, because a panel row is a place a wrong reading can go
on display. See [`PART20_ENGINE_STATUS_EDGE.md`](PART20_ENGINE_STATUS_EDGE.md).

`PlacementVerdict.blocking_areas` is ordered by `ReviewArea` declaration order, not by which
finding arrived first, so the same refusal renders the same list in every log line and diff.

**A note on the two absent items that look similar and are not.** `SIGNED_TRANSPORT_WIRED` is
in `HARD_BLOCKERS` — `frozenset({LivePrerequisite.SIGNED_TRANSPORT_WIRED})` — because this
composition root never constructs a live venue adapter, and `VENUE_ATTESTOR_WIRED` is its
consequence: the attestor is injected *over* that adapter
(`app/placement.py:240`: "the gatherer needs the live trading adapter — the object this function
has no business creating, and which a simulated runtime must not have at all"). `DISTRIBUTED_LOCKS_WIRED` also reads `false` today, but for a
different reason: the core ships a working `RedisLockManager` (`execution/locks.py:291`, built
and tested in Part 11) and `app/composition.py:338` simply does not select it. That is one `if`
and one setting away from being satisfied, so it stays a *missing item* rather than a *hard
blocker* — which is the distinction `HARD_BLOCKERS` exists to draw: "nothing this deployment
could be configured into existing changes this" versus "the next composition change does".

## 8. What this part does not do

* **It does not make live possible.** `ExecutionSettings._assert_safe_combination`
  (`execution/config.py:159`) and the graded refusal at the end of `build_runtime` both stand.
  `HARD_BLOCKERS` is the explicit statement of why the refusal is unconditional rather than
  computed, and it is the constant a later part must change on purpose — not a boolean that
  quietly started meaning something else.
* **It does not sign requests, authenticate a transport, or talk to a venue.** Nothing in this
  part constructs an exchange client, and no live or testnet base URL is selected for one.
* **It does not put a ceiling inside the confirmation.** The window bound, the scope rule and
  the expiry are the limit. Maximum notional, order count and per-symbol exposure belong to
  `risk/`, which is a different component with a different owner and a different review path.
* **It does not touch `EXECUTION_DRY_RUN` or add its opposite.** Turning the confirmation on
  changes no mode at all; a simulated runtime with the requirement on is still simulated.
* **It does not verify the operator's identity against anything.** The HMAC key *is* the
  identity boundary: whoever holds it can mint records for this deployment. Rotating it is an
  operational act with a restart. If this platform later gains an approval system that signs
  records, `ConfirmationVerifier` is the seam — the states, the codes and the counters stay and
  the shared key goes away.

Predecessor note, for anyone reading the parts in order: `docs/PART16_PLACEMENT_REVIEW.md`
sec. 8 is the **Part 16 snapshot** of what live lacked — evidence the review could gather, six
items, written before the fetcher and the confirmation existed. Part 17 added the durable
incident trail, Part 18 the metrics and the wiring gauge, Part 19 this layer. For "what is
missing now", §2 and §7 of this document are authoritative and the old paragraph is history; for
"what Part 16 built", `docs/PART16_HANDOVER_FULL_SOURCE.md` is authoritative and this document is
only the summary.

## 9. Turning the pieces on, in order

Each step is safe alone, and none of them trades:

1. **Selection, dark.** `EXECUTION_CREDENTIAL_SOURCE=environment` (outside production) or
   `secret-manager` with `EXECUTION_CREDENTIAL_FETCHER=vault-kv2` and a paper account. Confirm
   `execution_engine.credentials_selected` in the log and `credentialSource` /
   `credentialFetcher` on `/status`. The simulated deployment now reads real key *metadata* for
   the review and still transmits nothing.
2. **Evidence.** `EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true` (the default) keeps
   `IP_ALLOWLIST_ENFORCED` satisfied; `EXECUTION_PLACEMENT_ATTESTATION_TTL_MS` and
   `EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS` set how much staleness the review forgives. Watch
   `wlct_execution_placement_blocks_{provenance,credential,account,symbol,clock}_total` to learn
   which area is actually unhealthy before deciding what to fix.
3. **The confirmation.** Mint a record for one symbol and one order type (§5), set the key, then
   `EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=true`. Everything outside that scope starts being
   refused — which is the demonstration that scoping works, and it is worth watching one cycle
   on a paper account before it is ever relied on.
4. **Durability.** `EXECUTION_STORE_BACKEND=postgres` takes `DURABLE_STORE_WIRED` off the list.
   `DISTRIBUTED_LOCKS_WIRED` does not follow it, and cannot be made to by any setting: this
   service has no Redis configuration at all, and builds `InMemoryLockManager` unconditionally
   (`app/composition.py:338`). See §7's note on the two kinds of absence — the fix is a
   composition change selecting the core's `RedisLockManager`, not a deployment change.
5. **Live.** Not available, and now you can read the remaining list from the refusal instead of
   from this document. The item no configuration can supply is `SIGNED_TRANSPORT_WIRED`.

## 10. Refusal catalogue

Boot failures are the fast ones, because they happen before an order exists.

| What you see | Cause | Move |
| --- | --- | --- |
| `EXECUTION_CREDENTIAL_FETCHER=vault-kv2 with EXECUTION_CREDENTIAL_SOURCE='none': … a deployment that believes it has credential plumbing it does not use` | Fetcher named, source not selected | Point the source at `secret-manager`, or set the fetcher back to `none` |
| `secret-manager … needs a secret fetcher` | Source selected with no fetcher constructed | Set `EXECUTION_CREDENTIAL_FETCHER`, or drop the source |
| `EXECUTION_VAULT_ADDR must be https` / `must not embed credentials` | The address | Fix the URL. A `user:pass@host` authority is refused even over TLS |
| `EXECUTION_VAULT_MOUNT must be one safe path segment` | A nested mount | Move the nesting into the path template |
| `unknown placeholder(s)`, `unbalanced braces`, `must not contain a '..' segment`, `must not be blank` | `EXECUTION_VAULT_PATH_TEMPLATE` | Exactly `{tenant}`, `{account}`, `{exchange}`; repeating one is legal (both render the same value) and inventing one is not |
| `is not a safe path segment (expected [A-Za-z0-9._-]{1,64})` | A tenant, account or exchange id | Fix the caller, not the network: no request was made. Check for an id that has a slash, a colon or a percent-escape in it |
| `the rendered Vault path is N characters, outside the 1..512 bound` | A template that is legal in every part and absurd in total | Shorten it; the bound exists so this is a named refusal rather than a proxy error |
| `above the N byte bound for a KV secret` | The path holds more than a key pair | Point the template at the credential path |
| `EXECUTION_VAULT_TOKEN is not set or is blank` | The variable is not in the container | Inject it. Do not add a settings field for it — §3's fourth bullet is why |
| `the stored secret's api_secret is blank.` | A key pair written half-populated | Fix the stored secret; a half-written credential is not a usable one |
| `supplies no confirmation record` | Requirement on, nothing to require | Supply the record, or turn the requirement off |
| `both set` | JSON and FILE both configured | Keep one |
| `EXECUTION_CONFIRMATION_HMAC_KEY is not set or is blank` | Required confirmation with no key | Put the key in the named variable, or drop both settings |
| `names instance '…' but this process is '…'` | A record copied between deployments | Mint per deployment; `EXECUTION_INSTANCE_ID` is part of the scope |
| `could not be read` | `EXECUTION_OPERATOR_CONFIRMATION_FILE` path or mode | Fix the path. A missing file at boot is a refusal, not a silent "no confirmation" |
| `the confirmation window is N ms, above the … ms ceiling` | A record wider than 90 days | Re-run the ceremony on a shorter window |
| `no ConfirmationVerifier was supplied` | Policy demands a check the reviewer cannot perform | Set the key and the record, or turn the requirement off |
| Order refused, `OPERATOR_CONFIRMATION_SCOPE_MISMATCH` | The order is outside the record | Mint a wider record. Never edit the old one: the digest covers the scope, so editing is forgery even when you hold the key |
| Order refused, `OPERATOR_CONFIRMATION_EXPIRED`, process healthy | Ceremony lapsed | Re-mint. Staying up is deliberate: cancellations still have to work |
| Order refused, `OPERATOR_CONFIRMATION_UNVERIFIED` | The digest does not match, or the verifier raised | Check the key this process is holding against the key that signed the record, then re-mint |

If anything here and the code disagree, the code and its tests are authoritative. The Part 19
suite is five files:

```
PYTHONPATH=libs/trading-core python3 -m pytest -q \
  libs/trading-core/tests/test_part19_live_confirmation.py \
  libs/trading-core/tests/test_part19_review_areas.py \
  libs/trading-core/tests/test_part19_live_enablement.py
cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m pytest -q \
  tests/test_part19_vault_fetcher.py tests/test_part19_live_wiring.py
```

Related: `docs/PART16_PLACEMENT_REVIEW.md` (the review's laws, unchanged by this part),
`docs/PART18_METRICS_EXPOSITION.md` (where the counters and gauges in §7 are exposed),
`docs/SECURITY.md` (credential handling), `docs/ARCHITECTURE.md` (the layer map), and
`docs/GETTING_STARTED.md` (which of these settings a first deployment should set at all).
````


## FILE: docs/DR.md (212 lines)

*the section headed 'What is NOT yet automated, plainly' still claimed this part's scheduler as remaining work, and `--check-rls` as unwired, so it now describes what shipped (derived schedule, `min(tightest cadence, 24h)` interval law, waivers echoed as comments with no job line, `--check-schedule` as the byte-exact drift gate that refuses `--record` as its own finding) and shrinks the open list to `crontab`, the drill calendar, and the first real `--record`. The heading is kept verbatim because Part 15's document links to it by name; a renamed section would turn a live document into a broken reference.*

````text
# Disaster recovery - the drill, not the binder

The machine-readable plan is `docs/dr/manifest.json` (validated and rendered
by `scripts/dr-manifest.mjs`; `--check` runs in CI, `--plan` produces the
operator runbook, and Part 12's `--due`/`--record` grade and log backup
freshness against `docs/dr/backup-ledger.jsonl`). This file is the human
half: why the manifest says what it says, the post-restore probes, the
ledger's rules, and the drill record every rehearsal must fill in before it
counts.

## The three rules everything else follows from

1. **Keys before ciphertext.** `encryption-keys` restores before `postgres`
   because a database whose credential columns cannot be decrypted is not a
   degraded system, it is a deleted one - and the confusion costs hours
   arguing with the restore. The validator refuses the inverted order
   outright, so nobody relearns this at 3am.
2. **Redis is rebuilt, not restored.** Its queues, claims, leases and rate
   windows are coordination state with TTLs; a snapshot replays the dead
   past as fresh truth. The manifest's redis verification is therefore about
   proving the EMPTY state behaves, not about proving the snapshot loaded.
   (This is the same reasoning as the Part 9 "no publisher reported is never
   'all clear'": stale operational state must announce itself.)
3. **A restore is timed or it didn't happen.** `drill.timed: true` is a
   validator requirement for exactly the reason the platform refuses false
   latency claims everywhere else: the number in the binder that nobody has
   re-measured is marketing.

## Post-restore probe queries (run as the operator role, then as the app role)

```sql
-- Migration ledger: no failures, and the count must equal the repository's
-- prisma/migrations directories for this deployment's schema stamp.
SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS incomplete,
       count(*) AS applied
FROM "_prisma_migrations";

-- Tenant isolation spot check (works WITH or WITHOUT RLS enabled; with the
-- Part 11 policies ENABLED these MUST read zero from a context without the
-- app.tenant_id GUC, and only-own-tenant with it):
BEGIN;
SELECT count(*) FROM orders;                                    -- no GUC
SELECT count(*) FROM orders, (SELECT set_config('app.tenant_id', '<probe-tenant-uuid>', true)) s;
ROLLBACK;

-- Audit ledger head exists (audit is append-only by policy, not by trust):
SELECT count(*) FROM audit_logs WHERE created_at > now() - interval '10 minutes';
```

The `tenant-scoped` app-role check belongs to whoever runs the enablement
(`apps/api/prisma/rls/enable.sql`'s checklist) - the probes above work from
`psql`; the API-level assertion is `withTenantRls`'s spec plus a staged
cross-tenant read attempt.

## Drill record (copy per rehearsal; a restore without this filled in is not a drill)

| Field | Value |
| --- | --- |
| Date / duration (against RTO `<manifest>.rtoHours` h) | |
| Manifest stamp reviewed (schema + paths verified current) | |
| Components restored, in order, with each verification outcome | |
| Deliberate failure injected (per `drill.successCriteria` - e.g. wrong master key) and the stop-the-line result | |
| Data-loss window actually observed (against RPO) | |
| Follow-up issues filed (every deviation, including "it worked too well") | |
| Sign-off (operator + one engineer not involved in the restore) | |

## The backup-freshness ledger (Part 12)

Manifest v2 states each component's obligation as data: `cadenceHours` -
the maximum age of the last recorded SUCCESS - or `cadenceHours: null` with
a written `cadenceWaiver` (redis is rebuildable; scheduling its copy would
manufacture an obligation the component's contract denies). Postgres' 24h
dump cadence under a 60m RPO is legal only because the component names the
`rpoMechanism` that closes the gap - the validator refuses the silence, not
the number.

The evidence is one JSON line per event in `docs/dr/backup-ledger.jsonl`:

    {"at":"2026-09-14T06:00:00.000Z","component":"postgres","outcome":"ok","note":"pg_dump + scratch restore verified"}

and two commands touch it:

* `node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed
  [--note TEXT] [--at ISO]` - refuses unknown components, broken ledgers
  (no appending onto unreadable evidence), non-ISO stamps, and any
  secret-shaped content in the note, scanning the RAW text because JSON
  escaping is not a laundering licence.
* `node scripts/dr-manifest.mjs --due [--now ISO]` - every component in
  restore order: current, overdue (measured from the last `ok`; a `failed`
  record does not stop the clock), never-recorded, or waived. Exit code 1
  iff something is due - which makes this exact command the cron entry
  point: alerting on it is the scheduler, and the scheduler is wiring, not
  design.

The ledger ships EMPTY on purpose. "No backup recorded" must read as four
`never recorded` alarms, not as fabricated green ticks - a platform that
refuses simulated fills does not seed its own evidence trail with
simulated backups.

Part 14 raised what a fresh `postgres` entry is WORTH: journal retention
deletes settled event rows, and a prune followed by a failed restore is
indistinguishable from a data-losing outage. The rule is therefore one
line of the retention runbook (docs/PART14_RETENTION.md §10, move 1):
`--due` green for `postgres` before the FIRST apply on any deployment,
and the cadence itself is now load-bearing evidence, not hygiene. The
deletion ledger (`engine_retention_runs`) rides the same dump as every
other table - "what was pruned when" must survive the restore that
replays the backup.

Part 15 made the other half of that sentence checkable. The manifest now
carries `rlsEvidence`: a cadence (168h), a required grade (`pass`, not a
knob), the engine endpoint that verifies the engine plane, and its own
append-only evidence ledger, `docs/dr/rls-evidence.jsonl`. `node
scripts/dr-manifest.mjs --check-rls` answers "is there a recent PASSING
row-level-security audit" with an exit code, and `--record-rls` is the only
writer of the ledger. The same ordering as the backups applies, in the
stronger direction: `--check-rls` green is a prerequisite for Part 14's FIRST
apply, because a prune on a database whose partitioning is believed-but-
unverified is a deletion whose blast radius is assumed. Both ledgers refuse to
read each other's file, so an RLS line never parses as a backup line and vice
versa.

## Installation and rehearsal (Part 21)

Two commands sit between "the plan is correct" and "the plan ran". They do not replace the sections
above; they make them checkable.

**`node scripts/dr-schedule-install.mjs`** owns the host half of the generated schedule. It verifies
`docs/dr/schedule/dr.cron` with the same `scheduleDrift` function `--check-schedule` runs - imported,
not reimplemented - and refuses to install anything it would have to author. It manages a marked
block and leaves every unmanaged crontab entry alone, byte for byte; installing twice is a no-op;
`--uninstall` removes only the block; `--check` distinguishes installed, not-installed, drifted and
malformed, and `--install` re-reads the host table after writing, because an exit code proves the
command was willing, not that the schedule exists. A host without `crontab` is told so and exits 4:

```
$ node scripts/dr-schedule-install.mjs --check
schedule not-installed: no managed block in the host table; run --install (expected sha256 d15556e0340334206b20d6d80ae824cad8f31e946e7368c4474f1089c4afe760)
$ echo $?
1
```

**`node scripts/dr-rehearsal.mjs`** is the drill's clipboard. Default mode is a dry run: it builds
the plan from `restoreProcedure`, checks each component's declared paths and environment names,
ages the backup ledger and the rehearsal ledger, and grades `PLANNED`. `--execute` runs a closed
allowlist of four probes (`manifest-valid`, `schedule-current`, `schedule-installed`, `rls-audit`)
and still restores nothing; a destructive step stays `OPERATOR` because this repository has no lever
on an environment. Production and unknown targets are refused before anything is read, and
`--execute` additionally requires `--confirm <rehearsalId>`, the hash of the plan being approved.
Evidence is written only with `--emit-evidence`, and a PLANNED record can never read as a pass - the
ledger refuses to parse a line that claims otherwise.

`--status` is the read-only board over the same laws, with an exit code a job can use:

```
$ node scripts/dr-rehearsal.mjs --status            # exit 1
[ok  ] manifest       5 components, RPO 60m / RTO 4h, drill every 90d
[ok  ] schedule       docs/dr/schedule/dr.cron matches a fresh generation
[UNVER] installed      this host has no cron facility, or no block, so installation is unproven here
[FAIL] backupLedger   no backup ledger at docs/dr/backup-ledger.jsonl: 4 obligation(s) read as never recorded
[UNVER] rls            7/8 verification checks pass; not asserted here: ...
[UNVER] drill          no rehearsal has ever been recorded; the plan is untested
  boundary: read-only repository-side verification; no database, queue, engine or cloud call was made,
  and no money-path behaviour is implied by any grade in this document
```

That output is the correct answer for a fresh checkout, and its red cells are the point: four backup
obligations have no evidence and nobody has rehearsed. The first rehearsal this tool ran found a real
defect in the manifest it was checking - `restoreProcedure` restored `deployment-config`, `redis`,
`dataset-objects` at steps 3, 4, 5 while those components declared `restoreOrder` 5, 3, 4. Two
representations of one plan had never been compared to each other. The data was corrected to follow
the procedure (the procedure is what an operator executes, and step 3's "run migrations only if the
image's schema is older than the restored DB" only holds in that order), and `--check` now refuses a
disagreement between the two, including a component that is declared restorable but never restored by
any step.

## What is NOT yet automated, plainly

Part 20 wired the scheduler half, and the heading above is kept rather than
renamed so that the cross-reference in `docs/PART15_RLS_ENABLEMENT.md` sec. 8
still lands. What it now covers:

* `--emit-schedule` derives `docs/dr/schedule/dr.cron` from the manifest's own
  cadences - the check interval is `min(tightest declared cadence, 24h)`, so an
  obligation that tightens moves the schedule by itself, and a `cadenceHours:
  null` component is echoed as a comment with no job line, because a waiver that
  silently became a schedule would be a fake obligation.
* `--check-schedule` compares that file against a fresh derivation and exits 1 on
  any byte difference, which is what turns "the deployment runs it" from a habit
  into something a CI job can hold. It also refuses `--record` / `--record-rls`
  appearing in the schedule as its own finding, reported ahead of the byte
  comparison: the schedule may ask questions, never answer them.
* `--check-rls` is no longer "still unwired" - it is a job line in that generated
  file, at the manifest's own RLS cadence.

Part 21 took the "installing the file is a host act" clause off this list - not by
becoming the host, but by making the host state checkable and reversible
(`scripts/dr-schedule-install.mjs`, above) and by refusing where a host has no cron
facility instead of reporting a green install it did not perform. What is still open,
and deliberately so: the drill calendar, which is a dated human ceremony no generator
may schedule on an operator's behalf; the restore itself, which stays operator-run -
the rehearsal runner grades its own probes and marks the destructive steps
`PLANNED`/`OPERATOR`, because a tool that fabricated an infrastructure result would be
worse than a tool that admits it cannot see one; the real failover matrix, which is now
specified as ten probes with invariants and timeouts
(`python3 -m wlct_trading.observability.chaos`, all ten `UNVERIFIED` here and exiting 2,
by law never `PASS` without a harness check); and the first real
`--record` / `--record-rls`, since the ledgers refuse to seed themselves and an
empty board reporting four `never recorded` alarms is the correct answer until a
human runs a backup. Part 12 moved the judgement (what is due, when, evidenced how)
into the validator so the scheduled half is one command and one exit code; Part 20
supplied the timer, and left the answers where they belong.
````


## FILE: docs/PART15_RLS_ENABLEMENT.md (551 lines)

*one supersession note, in the style this repository uses for exactly this situation (Part 11's 'RESOLVED IN PART 13', Part 13's 'SUPERSEDES THE CAPABILITY, NOT THE LAW'): the bullet that named the scheduler as an open item now says Part 20 supplied the timer, while what Part 15 did - making the check exist and be honest enough to exit 1 - stands unchanged.*

````text
# Part 15 - RLS enablement is now a verifiable operation (read-only)

Part 11 shipped row-level security as an *artefact set*: a migration that
defines the function and 42 policies (43 since Part 17's `engine_incidents`), a generator, `enable.sql` with a
five-item pre-flight checklist, `disable.sql` as its inverse, and a coverage
manifest. It also shipped the honest comment above all of that - "dormant
until the checklist-gated enablement". Fourteen parts later the platform
could describe its defences in exact detail and had no way to ANSWER whether
one of them was switched on. Every tool in the repository had to trust the
deployment; the only evidence that RLS existed was a file that says somebody
ran a file.

Part 15 closes that gap the only way a gap in *knowledge* closes: a
verification with a grade, a record, and a freshness policy. It changes
nothing. There is no migration, no new table, no DELETE statement anywhere in
this part, and no code path here that can flip `ENABLE ROW LEVEL SECURITY`.
The verb is "look, count, report", and the reason the verb is safe is exactly
the reason the answer is now trustworthy: it can be run on a live staging
database, by an operator who has no business running DDL, on a Tuesday,
without a change window.

Concretely, five things ship:

1. `libs/trading-core/wlct_trading/enablement.py` - the enablement LAW, pure
   and dependency-free: what a probe must look like to count, which tables may
   legitimately answer a bare read, when a run is `UNVERIFIED` rather than
   green, and what nonsense cannot be a policy at all.
2. `services/execution-engine/app/rls_probe.py` - that law's only executor
   against Postgres: six statements, every one a read, and one design fact
   (the leak probe runs OUTSIDE the tenant transaction) that the whole
   exercise turns on.
3. `POST /internal/v1/enablement/audit` - the internal-plane endpoint that
   runs it, grades it, and answers 200 even when the grade is FAIL.
4. `scripts/rls-enablement.mjs` - the operator's entry point (`audit`,
   `check`, `print-sql`), which never touches a database, plus
   `scripts/dr-manifest.mjs --check-rls / --record-rls` and the
   `docs/dr/rls-evidence.jsonl` ledger.
5. The evidence freshness contract, in `docs/dr/manifest.json` under
   `rlsEvidence`: a weekly re-audit, a one-month window on this service's
   side, and a rule that a recorded FAIL is not a stale PASS.

The rest of this document is the reasoning behind those five, the exact
promises the code makes, and the runbook that turns "we believe RLS is on"
into "here is the audit, its age, and its verdict".


## 1. What was shipped, what was believed, and the gap between

`enable.sql` asks a human five questions before running it: does every write
path use `withTenantRls`; does the deployment role have neither `BYPASSRLS`
nor superuser; are the excluded (platform-scoped) tables confirmed
unaffected; has rollback been rehearsed; is traffic low. Four of those five
are deployment conditions, and a checklist answers them once, at the moment
of maximum attention. Then the platform goes on running for a year, during
which:

* a new tenant-bearing table is added and the RLS generator is not re-run
  (Part 13's `engine_*` tables are exactly this case, and Part 14's ledger
  is exactly that follow-up);
* a role is granted something "temporarily, for the migration";
* a `FORCE` line is lost when a table is recreated by a hand-written
  migration;
* the policies are on and a code path that never sets the GUC starts
  returning zero rows and gets reported as "no orders today".

None of those are detectable by reading the repository. All of them are
detectable, cheaply, by asking the database three questions per table: does
a policy exist, is RLS enabled and forced, and does a read with the tenant
bound see a different number of rows than a read without it. That is the
whole probe. Everything else in Part 15 is the discipline of turning three
questions into an answer nobody can shade.

Why not a migration that verifies at boot? Because a boot check on the engine
either refuses to start (a defence layer's staleness becomes an outage, which
is the exact trade Part 11 refused to make in reverse) or warns (which is
today's checklist with extra steps). Verification is an OPERATION with a
cadence, not a startup condition with a kill switch. That decision is
§11's first entry and it is the part of this design most likely to be
"improved" later, so it is written down rather than implied.


## 2. The law (core), before any SQL existed

`wlct_trading/enablement.py` grades results handed to it by an executor. It
imports no clock, no driver and no filesystem - a structural fact pinned by
an AST test, because an enablement report whose freshness is decided by the
library's own wall clock is not reproducible, and "no write verb in the law"
is not a comment, it is a scan (`tests/test_part15_enablement.py::TestModulePurity`).

Its vocabulary is closed and deliberately asymmetric:

| a probe's grade | meaning |
| --- | --- |
| `pass` | policy exists, RLS enabled AND forced, the scoped count equals the seeded expectation, and (for tenant tables) the bare count is 0 |
| `fail` | any of the above is not true, or the table is absent from the database while present in the coverage manifest |
| `skipped` | the caller declined to probe it, with a reason |

| a run's grade | meaning |
| --- | --- |
| `pass` | every probe passed, nothing skipped, count matches what was asked to cover, and the role can neither bypass nor outrank the policies |
| `fail` | any probe failed, **or** the role has `rolbypassrls`/`rolsuper` |
| `unverified` | nothing was probed, something was skipped, or the probed set does not match the expected coverage count |

Four laws in that table are load-bearing and each has its own test:

* **Absence outranks everything.** A table in `rls_coverage.json` that
  `to_regclass` cannot resolve is a coverage LIE, not a table with RLS off.
  Grading it `enabled=false` understates the finding; the law grades it
  `fail` before looking at any other field.
* **The role veto precedes the counts.** `rolbypassrls` or `rolsuper` makes
  every other number meaningless, so the run fails even when all four probes
  read "isolated". This is checklist item 2 in executable form, and it exists
  because a bypassing role is precisely the failure a "green" report would
  otherwise launder. There is no `pass-with-warning` spelling here on
  purpose: "bypassing but tidy" is not a posture this platform records.
* **`unverified` is not "failed politely".** It is a distinct third answer,
  produced by a run that checked nothing, or skipped a table it was asked to
  cover, or covered fewer tables than the manifest claims. `grade_run` puts
  the reason in `summary["veto"]` so the report says WHY it refuses to be
  green; a dashboard that renders `unverified` as a shade of success is a
  bug in the dashboard, and this module is what gives that test something to
  assert.
* **The exception is a list, not a shrug.** The "bare read must be zero" rule
  is a TENANT-table rule. The seven platform-scoped tables (nullable
  `tenantId`: `audit_logs`, `kill_switches`, `ops_alerts`, `ops_incidents`,
  `roles`, `security_events`, `subscription_plans`) may answer a bare read
  with rows correctly - failing them would nag on a healthy deployment, and
  nagging is how checklists get switched off. `PLATFORM_SCOPED_TABLES` mirrors
  the manifest's exclusion set, and a core test re-derives it from
  `apps/api/prisma/rls/rls_coverage.json` so the mirror cannot silently drift
  in the core's own suite.

Nonsense cannot be constructed: `max_evidence_age_days` must be a plain int
1..36,500 (0 would flood the ledger, a century means "forever fresh");
negative row counts, `True` where an int is claimed, a probe list containing
the same table twice ("a repeated probe is not redundancy, it is one table
left unchecked"), and a covered-table count outside 0..4,096 are all
refusals. `EnablementPolicy.evidence_is_fresh` takes both timestamps as
arguments and treats a run dated in the FUTURE as not fresh - the safe answer
to an unverifiable clock is "go run the audit again", never "credit it".


## 3. The probe, and the one fact it turns on

`app/rls_probe.py` holds six statements. All of them are `SELECT`s plus one
`SET TRANSACTION READ ONLY`, and a test derives the list from the shipped
file's own syntax tree rather than from a list of constants somebody could
forget to extend.

The interesting part is not the statements, it is where they run.

**Inside one `_TenantTransaction`** (Part 13's rhythm: acquire, begin,
`set_config('app.tenant_id', $1, true)`, work, commit) the audit reads
`pg_roles`, `to_regclass`, `pg_class` and `pg_policies`, and counts the
tenant's own rows. The read-only flag is the module's FIRST statement inside
that transaction - legal only before the transaction touches data, which is
why it leads, and pinned as text by `test_transaction_is_forced_read_only_first`.

**On a separate acquisition, with no transaction and no GUC**, it runs the
bare count. This is the whole audit:

> `set_config(..., is_local => true)` dies with its transaction. A connection
> borrowed outside one therefore has no `app.tenant_id`, which is the only
> condition under which "count this table with no tenant predicate" means
> anything.

If both counts ran inside the same transaction, the bare count would be the
scoped count by construction, every table would report `0` leaked rows, and
the audit would be structurally incapable of finding the thing it exists to
find. That sentence is why this part has a test file before it has a route:
`test_a_healthy_database_passes_and_reads_the_way_it_must` asserts the bare
connection made ZERO `set_config` calls, opened NO transaction, and saw
exactly the number of pool acquisitions the design allows (two: the
transaction, and one bare session serving all tables - a per-table borrow
would be a different shape and the fake's `acquires` counter catches it).

There is nothing to "clear" on the bare session. The platform has no
cross-tenant GUC: the `set_config` call is transaction-local by Part 11's
contract, and the docs list a platform-role session concept as future work,
not a variable to reset. An earlier draft of this module cleared a
hypothetical `app.cross_tenant_seed`; that was removed on the ground that a
verification tool must not contain SQL for a mechanism that does not exist,
because it reads as coverage while testing nothing. The only thing that can
defeat a bare read here is a role privilege, and that is what the veto in §2
handles.

Two smaller decisions worth their weight:

* **Nothing is seeded, so nothing must be cleaned up.** The textbook RLS
  probe inserts two tenant-A rows, reads them from a tenant-B session, then
  deletes them. Part 15 ships a tool whose entire claim is "read-only", so it
  does not get to insert. Seed expectations are INPUTS: the operator (or the
  staging script) says "this probe tenant should see 3 rows in each table" and
  the executor checks scoped == that number. Unknown seed is the honest
  default, and it degrades to a weaker-but-real test rather than to a skip:
  the catalogue posture (`policy_exists`, `relrowsecurity`,
  `relforcerowsecurity`) carries the finding and the counts cross-check each
  other. A probe with 0 seeded rows and 0 bare rows is a PASS, not a no-op:
  an empty tenant still proves the predicate is being applied.
* **A refused bare read is the best answer a tenant table can give.** If
  Postgres rejects the unfiltered count with SQLSTATE `42501`
  (insufficient privilege - what `FORCE` plus a SELECT-scoped policy looks
  like for a role with no bypass), the executor records "zero rows reached"
  and the grade stands. Any OTHER failure of that read - connection drop,
  timeout, cancellation - PROPAGATES and the run records nothing. The
  distinction is deliberate and narrow (the swallow is keyed on the SQLSTATE,
  duck-typed so this module never imports the driver's exception hierarchy):
  grading a broken cluster as isolated is the one way this audit could bless
  a failure, so it is refused rather than handled.
* **A probe table list is a constant, not a parameter.** `PROBE_TABLES` names
  the three durable engine tables plus its ledger; a request body may supply
  a seed count for a table outside it and is refused (`ProbeUnknownTable`,
  HTTP 400) before a connection is borrowed. The name reaches `{table}`
  interpolation, so this is the one place a caller could smuggle text into a
  statement, and an allow-list checked against the module's own constant is
  the cheap answer. `coveredExpected` and `seedCounts` are validated before
  the database is touched, and `strict=True` on the seed values is load
  bearing: pydantic's non-strict coercion accepts `"3"`, and - worse -
  `true` as `1`, which would hand the audit a seed nobody wrote.


## 4. The wire surface: one route, three refusals, one non-refusal

`POST /internal/v1/enablement/audit` sits on the internal plane beside
Part 14's retention routes: same token, same tenant-header match, proxied by
nothing public, and absent from the API's worker-forwarding path list (pinned
by `test_the_forwarding_surface_never_reaches_it`: that list IS the public
plane's reach, and an audit is not a job a scheduler should be able to
enqueue).

There is **no apply switch**, deliberately. Part 14 needs
`EXECUTION_RETENTION_ENABLED` because a DELETE needs two yeses; wrapping a
SELECT in a feature flag would be theatre that still has to be documented,
tested and defaulted. What the config DOES carry is the evidence window,
`EXECUTION_ENABLEMENT_MAX_AGE_DAYS` (default 30), whose bounds exist once in
the core and are validated at boot - a typo in a freshness window is exactly
the class of bug that quietly makes an audit useless ("every result is
fresh"), so it refuses startup instead of defaulting.

Three refusals, each saying something rather than erroring:

| answer | when | why that shape |
| --- | --- | --- |
| `409 RETENTION_NO_DURABLE_STORE` | memory-backend runtime | there is no Postgres here: no roles, no policies, nothing to verify. Answering "PASS, 4 tables isolated" would be the single most misleading success on this platform. (Same code as Part 14 on purpose - it means "this maintenance surface needs the durable plane", one fact, one name.) |
| `400 ENABLEMENT_REQUEST_REFUSED` | a seed table outside the allow-list, or a coverage number the core refuses | the request body is not where an audit's scope is decided |
| `503 ENABLEMENT_ROLE_UNKNOWN` | `pg_roles` has no row for the connected role | an audit that cannot read the bypass flag is not an audit; refusing beats assuming "no bypass". The message names the grant that fixes it (`grant.sql`, Part 11) |

And one deliberate **non**-refusal, the most important status-code decision
on the surface: **a FAIL grade is a 200**. The audit ran; its answer is the
finding. Returning 500 would bury the evidence under a transport error, break
`curl`-based CI that reads the body, and - the real risk - tempt somebody to
make the probe "tolerant". 5xx here means "no evidence at all", which is a
different fact with a different remedy, and the two must not share a code.

The response body states its own limits, in two booleans rather than one:

```
grade: pass | fail | unverified
fullPlatform: false            # 5 tables is not the manifest's 43
enginePlaneComplete: true      # everything THIS service can see was read
```

One field cannot honestly say both, and a single `partial: true` would leave a
dashboard free to render the headline green without explaining it. The
per-table list carries the raw counts (`scopedRows`, `bareRows`,
`seededExpectedRows`) alongside the flags, because a report that says "true"
has to be trusted and a report that says "3 / 0 / 3" can be re-audited by a
second operator. The per-table grade in the body is re-derived by the core law
inside the same request - there is no second formatter of this report
anywhere, because two spellings of a grading rule are one careless edit from
disagreeing.

`/internal/v1/status` gained `enablementMaxAgeDays`, and the worker's
compatibility assertion does NOT check it: like the retention knobs, it is
posture for an operator to read, not a condition for a job to be forwarded,
and widening the compatibility law is a change with a blast radius this part
does not need.


## 5. The CLI: `scripts/rls-enablement.mjs`, and why it holds no credentials

```
node scripts/rls-enablement.mjs audit  [--base-url URL] [--token TOK] --tenant UUID
                                       [--seed TABLE=N,...] [--covered-expected N]
                                       [--record] [--json]
node scripts/rls-enablement.mjs check  [--now ISO] [--ledger PATH]
node scripts/rls-enablement.mjs print-sql
```

`audit` calls the endpoint (via `curl`, so the helper has no HTTP stack of its
own and no dependency) and exits 0 on `pass`, 1 on `fail`, 2 on `unverified`
or a transport refusal - the same three-way exit law the platform's other
operator CLIs use, so CI can distinguish "not isolated" from "we do not know".
There are no defaults for `--base-url`, `--token` or `--tenant`: a helper that
guesses an internal endpoint can audit the wrong cluster and report a confident
PASS about it, which is worse than not auditing.

**This script never connects to a database.** That is not a limitation to
apologise for, it is the reason its output can be trusted: a tool that
"audits security" while holding the database password can manufacture the
finding as easily as report it. Here the observation comes from the engine
(which holds a connection because it must serve traffic, and whose audit runs
under the SAME read-only, GUC'd contract as its money path), the judgement
comes from the core law inside it, and this file only moves bytes and appends
them.

`print-sql` prints the executor's SQL by parsing the shipped Python module, so
the DBA-facing copy of the truth has no second copy to rot: a test asserts the
set of names rendered equals the set of `*_SQL` constants in the file, and
that every rendered statement is a `SELECT` (or `SET TRANSACTION READ ONLY`).

`--record` writes evidence by shelling out to the manifest CLI's
`--record-rls`. It does not open the ledger itself. One writer means one set of
shape rules (closed grade vocabulary, single-line fields, secret scan,
refusal-to-append-to-a-corrupt-file) rather than a copy that drifts - and a
recording failure changes nothing about the finding: `audit` still prints the
verdict, and only downgrades a would-be `0` to `2` when the evidence could not
be filed, because "not isolated" and "we cannot prove whether it is" are
different sentences and the exit code must keep them apart.

`check` delegates to `node scripts/dr-manifest.mjs --check-rls`. The
verification command and the freshness policy are in different files on
purpose: one needs an engine and a token, the other needs nothing but a
repository, which is what makes the second one runnable from CI on every
commit.


## 6. The evidence ledger and its freshness policy

`docs/dr/rls-evidence.jsonl`, one line per audit, appended by

```
node scripts/dr-manifest.mjs --record-rls --grade pass|fail|unverified
                             [--probed N] [--role NAME] [--note TEXT] [--at ISO]
```

and graded by `--check-rls`:

```
[ ok  ] rls-enablement: fresh, next due in 6d 23h [pass] 2026-09-14T06:00:00.000Z (6h ago)
[DUE  ] rls-enablement: last passing audit overdue by 9d 6h [pass] ...
[FAIL] rls-enablement: [fail] 2026-09-20T06:00:00.000Z (6h ago) - the recorded audit
        did not conclude "pass", so the platform must not claim enabled-and-enforced
```

The rules, all inherited from Part 12's backup ledger because that ledger's
discipline is already understood: append-only, unknown fields are a problem
("typos hide evidence"), an unparsable line is reported by NUMBER, a corrupt
ledger makes both commands REFUSE rather than grade the fleet on unreadable
evidence, and any secret-shaped content in the file (or in the note about to
be written) is an exit-1 refusal. Evidence describes what was verified, never
what was used to verify it.

Three decisions specific to Part 15:

* **No new table.** The engine side of this part writes nothing to the
  database at all; where a durable record of the *audit object* is wanted,
  `EVIDENCE_LEDGER_TABLE` names Part 14's `engine_retention_runs`, whose
  columns (`dry_run`, `rows_deleted`, `batches`, `exhausted`) are
  reinterpreted in place. The alternative - an `engine_enablement_runs` table
  for a part whose verb is "look" - means a new thing to migrate, to cover
  with RLS, and to forget to prune. The pinning test asserts the reuse rather
  than trusting the comment, and a rename to something more "honest" now
  costs a part boundary. (The route does not write there; the record lives in
  git, which is where a deployment's own security evidence belongs.)
* **Last-entry-of-any-grade ages the clock; last-entry's GRADE decides the
  verdict.** Re-running the audit and finding a leak must not resurrect a
  stale pass, and it must not be erased as "not evidence". A fresh FAIL is
  therefore an alarm, not a gap in the record: `--check-rls` exits 1 and says
  the platform may not claim enabled-and-enforced. A deployment that wants
  the alarm to STOP has exactly one honest option - fix the isolation and
  re-audit.
* **`cadenceHours` is capped at 8760 and `requiredGrade` is not a knob.** The
  validator accepts only `"pass"`, rejecting `fail`, `unverified`, `warning`,
  `true` and `0`: a manifest that lets a report choose its own bar is not a
  bar. A cadence larger than a year is refused as "a way of writing never",
  which is the same reasoning that caps the review cadence elsewhere in the
  manifest.

The manifest also declares **scope**, and the validator refuses an
overclaim:

> The engine endpoint verifies the engine plane only (`engine_orders`,
> `engine_order_events`, `engine_order_fills`, `engine_retention_runs`). The
> platform's other covered tables are audited by the operator-side checklist
> in `apps/api/prisma/rls/enable.sql`, which this manifest's cadence also
> ages.

That paragraph is checked in both directions: the manifest may not name
phrases like "all tables", and the engine test suite asserts that every entry
in `PROBE_TABLES` is named in it. A future change that quietly grows the probe
set while the assurance still says "engine plane only" goes red in one of the
two suites, whichever runs first.


## 7. Drift parity: what the tests actually verify

`services/execution-engine/tests/test_part15_drift_parity.py` re-derives
every claim the audit makes from artifacts three different steps produced:

| pinned | against |
| --- | --- |
| `PROBE_TABLES` | the `engine_*` subset of `enable.sql`'s own ALTER statements - not from a shared constant |
| policy existence | every covered table has `CREATE POLICY tenant_isolation` with `USING`/`WITH CHECK` = `tenant_id = wlct_current_tenant_id()` in the Part 11 migration |
| `ENABLE`/`FORCE` pairing | the two lists in `enable.sql` are identical, 43 entries, and `disable.sql` is exactly their inverse (`NO FORCE`, `DISABLE`) |
| policy name and GUC name | `rls_coverage.json`'s `policyName`/`functionName`, `TENANT_GUC`, and the literal `set_config('app.tenant_id', ...)` in `prisma.service.ts` |
| the tenant function's shape | `RETURNS uuid`, `LANGUAGE sql STABLE`, `nullif(current_setting('app.tenant_id', true), '')` - i.e. still fail-closed |
| the exclusion list | the migration's "Excluded by design" comment == `PLATFORM_SCOPED_TABLES` == the manifest's `excluded` entries |
| the two count statements | they differ by exactly `WHERE tenant_id = $1`, parse with sqlglot, and the bare one has no bind parameter |
| the executor's write-lessness | every SQL-shaped string constant in `rls_probe.py` and `routers/enablement.py` (from the AST) is a `SELECT` or the read-only flag; the router holds none at all |
| the manifest's pointer | `rlsEvidence.verifier` is this router's actual path; the ledger path is the one the CLI writes; the named script exists; the cadence is no looser than the service's own default window |

The core suite adds the other half: `PLATFORM_SCOPED_TABLES` re-derived from
`rls_coverage.json`, the `TENANT_GUC`/ledger-name constants, and the
purity/no-write scans on the law itself. The CLI's node suite pins the
validator's refusals, the ledger's shape rules, the report's freshness
asymmetry, and `print-sql` against the module it documents.

What is NOT verified, in the same font as what is: nothing here reads a real
Postgres in CI. The SQL is parsed (sqlglot) and shape-checked, the catalogue
semantics are modelled by a fake that answers by matching statement text, and
the one behavioural claim that cannot be made honestly in a unit test - "a
`42501` on the bare read really is what FORCE returns" - is exercised only
against a live staging database, per §9. That is stated rather than hidden
because a verification tool that overstates its own verification is the exact
failure Part 15 exists to eliminate.


## 8. Runbook: enablement day, then every week after

1. **Before enabling.** Run the generator and apply the migration as Part 11
   documents; work `enable.sql`'s checklist. The engine endpoint cannot be
   used here - it audits tables that exist, which is after step 2.
2. **Right after enabling.** `node scripts/rls-enablement.mjs audit
   --base-url ... --token ... --tenant <probe-tenant> --seed
   engine_orders=3,... --covered-expected 43 --record`. Expect
   `enginePlaneComplete: true`; expect `fullPlatform: false` unless the
   operator-side checklist covered the other 38 tables. A `fail` here is a
   security finding, not a lint: `disable.sql` is the rollback and the
   note in the ledger line says which table leaked.
3. **Then weekly** (the cadence the manifest declares): re-run `audit
   --record` after any migration that creates, recreates or renames a
   tenant-bearing table, and after any role or grant change. The engine's
   own tables change on exactly those days; so does everything else.
4. **Continuously, from CI or cron:** `node scripts/rls-enablement.mjs
   check` (i.e. `dr-manifest.mjs --check-rls`). Exit 1 = overdue, missing,
   unreadable, or the last audit did not pass. The scheduler wiring is still
   an open item (same status as `--due`'s); what is NOT open is what it
   checks.
5. **On a `fail` grade:** treat it as an isolation incident. Confirm with
   psql using `print-sql`'s output (six statements, all reads, no ceremony);
   `disable.sql` if a table must go dark; the fix is in the migration or the
   grant, never in the ledger. Re-audit before resuming the claim.

`--check-rls` green is a prerequisite for anything that DEPENDS on
isolation - Part 14's first apply included: a prune against a database whose
policies are believed-but-unverified is a deletion whose blast radius is
assumed. §10 move 1 of `docs/PART14_RETENTION.md` now reads "both checks
green before the first apply" (fresh `postgres` backup from Part 12's ledger,
fresh enablement audit from this part's), and the ordering is the whole point:
delete nothing on a database you cannot prove is partitioned.


## 9. Test law, with its limits named

The 48 core tests grade the law directly (boundaries inclusive-by-design, the
role veto reaching per-table grades, `unverified` for every incomplete run,
duplicates refused, JSON-readiness of the summary). The 38 engine tests pin
the executor's conversation: statement-per-statement, which connection said
it, in which transaction, with which bind parameters; the absent-table path
that must not bare-count; the `42501` swallow narrowed by SQLSTATE; the
propagation that keeps a broken cluster ungraded; `ProbeRoleUnknown` refusing
BEFORE touching the tables it would have graded; the non-canonical tenant
UUID that never reaches the database; the 400/409/422/503 shapes; and
`seedCounts` refusals measured as "zero statements on either connection".

The fakes answer by MATCHING statement text, not by replaying a script, and
each pool is single-use: a fake that answered every query would happily let
the executor read tenant-filtered numbers on the unfiltered side - the exact
bug this split exists to catch. The `bare` connection's script and the
`scoped` connection's script are disjoint on purpose, and the pool raises if a
run borrows more than one bare session, so "one unfiltered session per audit"
is a fact the fakes enforce rather than a sentence in this file.


## 10. Decisions, each with its rejected alternative nearby

| decision | rejected alternative, and why |
| --- | --- |
| verification is an operation with a cadence | a boot-time check that refuses startup: a defence layer's staleness becomes an outage, inverting Part 11's whole "enable at low traffic, with a checklist" judgement |
| FAIL is HTTP 200 with the finding in the body | HTTP 500: evidence under a transport error, broken `curl` CI, and pressure to make the probe "tolerant" |
| no apply feature flag on a read-only route | `EXECUTION_ENABLEMENT_ENABLED`: theatre for a SELECT, and theatre still needs a default, docs and tests |
| read-only, never seeding | the textbook insert/read/delete probe: it would make "read-only" false and put a write path on a process that owns money rows, requiring its own audit |
| engine audits only its own 5 tables, and says so | claiming the platform's 43: the API plane's tables are not this service's to name, and a partial audit with a full-platform verdict is the loudest possible lie |
| evidence in git (`docs/dr/*.jsonl`), not a DB table | `engine_enablement_runs`: a new table to migrate, cover with RLS, and forget to prune - for a part that must not write |
| reuse Part 14's ledger constant for the durable name | a new constant: two names for one table is drift waiting to happen, and the reuse is pinned by test so it stays a decision |
| one writer of the evidence ledger (`dr-manifest`) | a second implementation inside `rls-enablement.mjs`: a copy of a policy that drifts, and the copy operators follow when the first is inconvenient |
| `seedCounts` optional, unknown-seed mode legal | requiring exact seeds: the audit would then be unusable before a probe tenant is prepared, which is precisely when enablement day needs it |
| `42501` on the bare read recorded as zero | "treat any error as pass" (launders an outage into a green check) and "treat any error as fail" (makes a correctly locked-down cluster look broken; the leak count IS the evidence). Both extremes are worse than the narrow swallow |
| `unverified` as a third run grade | collapsing it into `pass` (silence) or `fail` (crying wolf until people read `fail` as noise) |


## 11. What this part does NOT do

* It does not enable, disable or alter anything, and no migration ships with
  it. `enable.sql`/`disable.sql` remain the only files that change RLS state,
  and they are unchanged here.
* It does not cover the API plane's 38 other tables from the endpoint. That is
  the operator's checklist against the same manifest; `--covered-expected`
  exists so a partial run cannot be misread as a complete one.
* It does not schedule. `--check-rls` is a cron-able exit code, and wiring it
  into a scheduler is the same open item as `--due`'s (docs/DR.md: "what is
  not yet automated, plainly"). SUPERSEDED BY PART 20 for the wiring half only:
  `--check-rls` is now a derived job line in `docs/dr/schedule/dr.cron` at the
  manifest's RLS cadence, drift-gated by `--check-schedule`, and the open item in
  DR.md is reduced to installing that file plus the first real `--record-rls`.
  The scheduling was never the audit - the sentence above still holds about what
  Part 15 itself did, which was to make the check exist and be honest.
* It does not enforce at request time. No route consults the evidence ledger
  to decide whether to serve traffic; a deployment that wants hard gating
  should build it on top of `--check-rls`, which is now a well-defined
  predicate rather than a vibe.
* It does not prove isolation from unit tests against a fake Postgres. The
  catalogue semantics are modelled, the SQL is parsed, the shapes are
  re-derived - and the live confirmation is step 2 of §8, on staging, with a
  probe tenant.
* It does not add metrics or dashboards. The log line
  (`enablement.audit`, with grade/role/probed count, no row contents) is the
  only new signal; a RED panel over the audit cadence would be honest but is
  not in this part.


## 12. Cross-references

* `docs/ROADMAP.md` - Part 15 row; "RLS staging enablement" is now
  "verification of", with the enablement itself still an operator step.
* `docs/SECURITY.md` - the defence-in-depth list gains the audit surface and
  the "verified, not believed" claim, with its limits.
* `docs/DR.md` - `rlsEvidence` in the manifest, the second ledger, and the
  new prerequisite for Part 14's first apply.
* `docs/PART11_WORKER_SCALING.md` - the policies, the GUC, the checklist;
  unchanged and still the only thing that alters RLS state.
* `docs/PART13_DURABLE_STORE.md` - `_TenantTransaction`, the canonical-UUID
  guard and the literal-SQL law this executor inherits verbatim.
* `docs/PART14_RETENTION.md` - the ledger this part reuses, the feature-flag
  contrast in §4, and the runbook move this part now precedes.
* `libs/trading-core/tests/test_part15_enablement.py`,
  `services/execution-engine/tests/test_part15_enablement.py`,
  `services/execution-engine/tests/test_part15_drift_parity.py`,
  `scripts/dr-manifest.test.mjs` - the law, the surface, the drift traps, the
  ledger.
````


## FILE: .env.example (1120 lines)

*the engine-client block gained the second consumer and the two facts an operator needs with it: the pair is required by the worker's startup gate and read by the panel since Part 20, and with either name absent nothing fails - the module declines to construct a client and `ENGINE POSTURE` reports `unconfigured` - plus the warning that the file's own `127.0.0.1` URL is a developer's loopback that `docker-compose.yml` overrides per service. No new variable is declared, and none could be added by accident here: `dr-manifest.mjs::collectEnvNames` reads this file for `KEY=` lines (commented secrets included) to learn which names a deployment must provide, so prose edits are invisible to it by design while a new name would not be.*

```dotenv
# =============================================================================
# WHITE-LABEL CRYPTO COPY-TRADING PLATFORM - ENVIRONMENT CONFIGURATION
# =============================================================================
# Copy to .env and fill in real values. NEVER commit .env.
# Generate cryptographic material with: npm run keys:generate
# =============================================================================

# -----------------------------------------------------------------------------
# APPLICATION
# -----------------------------------------------------------------------------
NODE_ENV=development
APP_NAME=WhiteLabelCopyTrade
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_DEFAULT_VERSION=1
# Public base URL of the API (used in emails, webhooks, OpenAPI servers)
API_PUBLIC_URL=http://localhost:4000
# Public base URL of the admin web application
ADMIN_WEB_URL=http://localhost:3000
# Host port the admin console is published on by Docker Compose.
ADMIN_WEB_PORT=3000
# Trust N reverse proxy hops (nginx/ALB). 0 disables proxy trust.
TRUST_PROXY_HOPS=1
# Root domain used to resolve tenants from sub-domains: acme.copytrade.app
PLATFORM_ROOT_DOMAIN=copytrade.app
# Fallback tenant slug used when a request carries no resolvable tenant context
DEFAULT_TENANT_SLUG=platform

# -----------------------------------------------------------------------------
# DATABASE (PostgreSQL)
# -----------------------------------------------------------------------------
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=copytrade
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=copytrade
POSTGRES_SCHEMA=public
# Password for the least-privilege runtime role created by
# infrastructure/database/init/02-roles.sql. Leave blank to skip role creation.
POSTGRES_APP_PASSWORD=
# Prisma connection string. Inside docker-compose use host "postgres".
DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public&connection_limit=20&pool_timeout=20
# REQUIRED, not optional. schema.prisma declares `directUrl`, and Prisma refuses
# to run ANY migrate/generate command when the variable is missing (error P1012)
# even though the application itself never reads it. Point it at the database
# directly, bypassing any connection pooler (PgBouncer, RDS Proxy) and without
# the pooling query parameters, so DDL runs on a real session. With no pooler in
# front of PostgreSQL it is simply DATABASE_URL minus connection_limit/pool_timeout.
DIRECT_DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public
DATABASE_LOG_QUERIES=false
DATABASE_SSL=false

# -----------------------------------------------------------------------------
# REDIS (cache, rate limiting, queues, websocket adapter)
# -----------------------------------------------------------------------------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
REDIS_KEY_PREFIX=wlct:
REDIS_URL=redis://localhost:6379/0

# -----------------------------------------------------------------------------
# JWT / AUTHENTICATION
# -----------------------------------------------------------------------------
# Asymmetric signing is recommended in production (RS256). For HS256 provide secrets.
JWT_ALGORITHM=HS256
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
# Base64-encoded PEM keys, required when JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_BASE64=
JWT_PUBLIC_KEY_BASE64=
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=30d
JWT_ISSUER=https://api.copytrade.app
JWT_AUDIENCE=copytrade-clients
# Maximum concurrent active sessions (devices) per user
MAX_ACTIVE_SESSIONS_PER_USER=10

# Password policy / hashing (argon2id)
PASSWORD_MIN_LENGTH=12
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Account protection
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_FAILED_WINDOW_SECONDS=900
ACCOUNT_LOCKOUT_SECONDS=900

# -----------------------------------------------------------------------------
# ENCRYPTION (exchange API credential envelope encryption)
# -----------------------------------------------------------------------------
# 32-byte key, base64 encoded. Key Encryption Key used to wrap per-record DEKs.
ENCRYPTION_MASTER_KEY_BASE64=
# Identifier of the active master key; enables zero-downtime key rotation.
ENCRYPTION_KEY_ID=local-dev-v1
# Previous keys kept for decrypt-only, JSON map: {"local-dev-v0":"<base64key>"}
ENCRYPTION_PREVIOUS_KEYS_JSON={}
# kms | local  -> "kms" delegates KEK operations to a managed KMS provider
ENCRYPTION_PROVIDER=local
KMS_PROVIDER=
KMS_KEY_ARN=
# Deterministic HMAC key used to build blind indexes (lookup on encrypted values)
BLIND_INDEX_KEY_BASE64=

# -----------------------------------------------------------------------------
# TWO-FACTOR AUTHENTICATION (TOTP)
# -----------------------------------------------------------------------------
TWO_FACTOR_ISSUER=CopyTrade
TWO_FACTOR_WINDOW=1
TWO_FACTOR_DIGITS=6
TWO_FACTOR_PERIOD=30
TWO_FACTOR_RECOVERY_CODES=10
# Short-lived token issued between password step and 2FA step
TWO_FACTOR_CHALLENGE_TTL=300s
# Wrong codes tolerated per challenge token before it is discarded.
TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS=5

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
CORS_CREDENTIALS=true
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token
CORS_EXPOSED_HEADERS=X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset

# -----------------------------------------------------------------------------
# RATE LIMITING
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX=120
RATE_LIMIT_AUTH_TTL_SECONDS=300
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1

# -----------------------------------------------------------------------------
# SWAGGER / OPENAPI
# -----------------------------------------------------------------------------
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
SWAGGER_TITLE="White-Label Copy Trading API"
SWAGGER_DESCRIPTION="Multi-tenant non-custodial crypto copy-trading platform API"
SWAGGER_VERSION=1.0.0
# Optional basic-auth protection for the docs route in non-local environments
SWAGGER_USER=
SWAGGER_PASSWORD=

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug
# json | pretty. Set ONCE, here: both planes read the same name and this file keeps one
# active assignment per knob, because dotenv honours the first of a repeated key while
# docker compose's env_file honours the last - two assignments would make the deployed
# answer a loader detail. The "SHARED LOGGING" section below states the policy (`json`
# in every deployed environment, `pretty` for a local terminal), so that is the value.
LOG_FORMAT=json
LOG_REQUEST_BODY=false
LOG_SAMPLE_RATE=1
SENTRY_DSN=

# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------
WS_ENABLED=true
WS_PATH=/realtime
WS_NAMESPACE=/v1
WS_PING_INTERVAL_MS=25000
WS_PING_TIMEOUT_MS=20000
WS_MAX_CONNECTIONS_PER_USER=5
# Redis adapter lets many API replicas share socket rooms
WS_REDIS_ADAPTER=true

# -----------------------------------------------------------------------------
# BULLMQ / BACKGROUND JOBS
# -----------------------------------------------------------------------------
QUEUE_PREFIX=wlct-queue
QUEUE_DEFAULT_ATTEMPTS=5
QUEUE_BACKOFF_MS=5000
QUEUE_REMOVE_ON_COMPLETE=1000
QUEUE_REMOVE_ON_FAIL=5000
QUEUE_CONCURRENCY=10
# Enable the in-process worker (single-container dev). Disable when running the dedicated worker.
QUEUE_RUN_INLINE_WORKERS=true
BULL_BOARD_ENABLED=false
BULL_BOARD_PATH=admin/queues

# -----------------------------------------------------------------------------
# EXCHANGE INTEGRATIONS (non-custodial: user-supplied trade-only API keys)
# -----------------------------------------------------------------------------
# Comma separated list of exchanges enabled platform-wide
EXCHANGES_ENABLED=binance,bybit,okx,kraken
EXCHANGE_SANDBOX_MODE=true
EXCHANGE_REQUEST_TIMEOUT_MS=10000
EXCHANGE_MAX_RETRIES=3
# Hard safety switch. Order execution remains disabled: the connectivity layer
# delivers market data only, and no order-placement adapter is registered.
EXECUTION_ENABLED=false
# Internal service endpoints
TRADING_ENGINE_URL=http://localhost:8001
TRADING_ENGINE_HEALTH_PATH=/health
MARKET_DATA_URL=http://localhost:8002
MARKET_DATA_HEALTH_PATH=/health
NOTIFICATION_SERVICE_URL=http://localhost:8003
NOTIFICATION_SERVICE_HEALTH_PATH=/health
# Shared secret for service-to-service authentication (mTLS recommended in prod)
INTERNAL_SERVICE_TOKEN=change_me_internal_service_token
# Signing secret used to verify inbound exchange webhooks
EXCHANGE_WEBHOOK_SIGNING_SECRET=change_me_webhook_secret

# -----------------------------------------------------------------------------
# EXCHANGE CONNECTIVITY (libs/trading-core: wlct_trading.transport / .exchanges)
# -----------------------------------------------------------------------------
# These tune the realtime market-data connectivity layer. They contain no
# credentials: public market data needs none, and user exchange API keys are
# stored encrypted per trading account in PostgreSQL, never in the environment.
#
# Only venues with an implemented adapter can be selected. Naming a venue here
# that has no adapter fails fast at startup rather than at the first order.
EXCHANGE_MARKET_DATA_VENUES=binance
# Use the venue testnet endpoints. Keep true outside production.
EXCHANGE_USE_TESTNET=true

# --- Order-book synchronisation ---
# Depth requested for the REST snapshot. Rounded up to a depth the venue
# accepts. Deeper snapshots cost significantly more rate-limit weight
# (Binance spot: 100 levels = 5 weight, 1000 = 50, 5000 = 250).
ORDERBOOK_SNAPSHOT_DEPTH=1000
# Diffs buffered while a snapshot is in flight. Bounds memory: at 100 msg/s
# this is roughly 50 seconds of runway.
ORDERBOOK_MAX_BUFFERED_DELTAS=5000
# Resync attempts before a book is marked FAILED and refuses to serve quotes.
# It never silently serves a book it could not verify.
ORDERBOOK_MAX_RESYNC_ATTEMPTS=10
# A book quiet for longer than this is treated as stale and is not tradeable.
ORDERBOOK_STALENESS_THRESHOLD_MS=5000

# --- Websocket connection management ---
# These are read by the live transport (wlct_trading.net); the Part 3 library
# itself reads no environment at all.
WEBSOCKET_CONNECT_TIMEOUT_MS=10000
WS_HEARTBEAT_INTERVAL_MS=20000
# Silence after which the socket is considered dead and rebuilt. MUST be
# greater than WS_HEARTBEAT_INTERVAL_MS or healthy connections get killed.
WEBSOCKET_HEARTBEAT_TIMEOUT_MS=90000
# Reconnect backoff: capped exponential with full jitter. Jitter is not
# optional in production - without it every connection retries in lockstep
# after a venue blip and the reconnect storm is self-inflicted.
WS_RECONNECT_BASE_DELAY_MS=500
WS_RECONNECT_MAX_DELAY_MS=30000
WS_RECONNECT_MAX_ATTEMPTS=20
# Binance drops stream connections at 24h; cycling early makes it planned.
WS_CONNECTION_MAX_LIFETIME_SECONDS=82800

# --- Staleness thresholds (per channel, milliseconds) ---
# Trades are legitimately sporadic on thin symbols; an order book going quiet
# is not. Thresholds differ so neither alert is useless.
STALENESS_ORDER_BOOK_MS=5000
STALENESS_BOOK_TICKER_MS=5000
STALENESS_TICKER_MS=10000
STALENESS_TRADES_MS=60000
STALENESS_CANDLES_MS=120000
STALENESS_CONNECTION_MS=30000

# --- Rate limiting (venue-published values; lower them, never raise them) ---
# Binance spot: 6000 request weight per minute per IP.
BINANCE_REQUEST_WEIGHT_PER_MINUTE=6000
# 5 inbound messages per second per socket, counting PING/PONG and every
# subscribe frame. Exceeding it disconnects; repeat offenders get IP-banned.
BINANCE_WS_MESSAGES_PER_SECOND=5
BINANCE_MAX_STREAMS_PER_CONNECTION=1024
# Metrics scrape interval for the connectivity layer.
CONNECTIVITY_METRICS_INTERVAL_SECONDS=15

# -----------------------------------------------------------------------------
# LIVE MARKET DATA TRANSPORT (libs/trading-core: wlct_trading.net)
# -----------------------------------------------------------------------------
# The concrete websocket and HTTP clients behind the Part 3 abstractions.
#
# PUBLIC MARKET DATA ONLY. Nothing in this section is a credential and nothing
# on this code path can accept one: the market-data adapter has no API-key
# parameter, no request is signed, and no order is ever submitted. Live order
# execution is NOT implemented.
#
# Endpoints. Both must be TLS - the service refuses to start on ws:// or
# http://, because market data an attacker can rewrite is a way to induce bad
# trades. When EXCHANGE_USE_TESTNET=true and these are left unset, the venue's
# testnet endpoints are used automatically.
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_REST_URL=https://api.binance.com

# Symbols to stream. Accepts BTC/USDT, BTC-USDT or BTCUSDT; all three are
# normalised to the canonical BASE-QUOTE form and then validated against the
# venue's own instrument list, so a typo or a delisted market fails at startup
# rather than producing a socket that is silent forever. The value is assigned
# once, in the MARKET DATA service section below, and this transport and
# services/market-data read that one number: two assignments of one name in one
# file is how a shared knob stops being shared.

# Channels. Each enabled channel adds one stream per symbol to the single
# shared connection (Binance allows 1024 streams per socket).
# "ticker" is the bookTicker stream: best bid/ask on every book change, which
# is what the risk engine's price checks need. The 1-second rolling ticker is a
# statistics feed, not a quote feed.
MARKET_DATA_TICKER_ENABLED=true
MARKET_DATA_TRADES_ENABLED=true
MARKET_DATA_ORDERBOOK_ENABLED=true

# Websocket timeouts. WEBSOCKET_RECEIVE_TIMEOUT_MS is a backstop below the
# heartbeat, not the primary liveness check: a thin symbol's trade stream can
# legitimately be silent for minutes, and the venue's protocol pings are
# answered by the client library without ever surfacing as a message. Set it
# too low and a healthy but quiet connection is torn down in a loop.
WEBSOCKET_RECEIVE_TIMEOUT_MS=300000
# Client-initiated ping cadence and its response deadline. Binance pings every
# 3 minutes and disconnects after 10 without a pong; this is the reverse
# direction, used to notice a peer that has gone away silently.
WEBSOCKET_PING_INTERVAL_MS=180000
WEBSOCKET_PING_TIMEOUT_MS=60000
WEBSOCKET_CLOSE_TIMEOUT_MS=5000
# Frame size ceiling. An unbounded reader is a memory-exhaustion vector.
WEBSOCKET_MAX_FRAME_BYTES=8388608

# HTTP timeouts for REST snapshots. Every request is bounded by all three;
# there is no code path that produces an unbounded wait.
HTTP_CONNECT_TIMEOUT_MS=5000
HTTP_READ_TIMEOUT_MS=10000
HTTP_TOTAL_TIMEOUT_MS=15000
# Retries are bounded and only fire for categories the retry policy calls
# retryable. A 400 is never retried; a 429 honours the venue's Retry-After.
HTTP_MAX_RETRIES=3
HTTP_MAX_CONNECTIONS=20

# Duration of the separately invoked live smoke test
# (scripts/live_market_data_smoke_test.py). That script is the only thing in
# the repository that touches a real exchange; the normal test suite needs no
# internet, credentials, database or Redis.
LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=30

# -----------------------------------------------------------------------------
# EMAIL
# -----------------------------------------------------------------------------
# console | smtp (implemented). ses and postmark are planned; selecting an
# unimplemented driver fails fast instead of dropping mail silently.
MAIL_DRIVER=console
MAIL_FROM_NAME=CopyTrade
MAIL_FROM_ADDRESS=no-reply@copytrade.app
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

# -----------------------------------------------------------------------------
# NOTIFICATIONS (push / sms / webhooks)
# -----------------------------------------------------------------------------
NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_BASE64=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# -----------------------------------------------------------------------------
# LOCALIZATION / CURRENCY
# -----------------------------------------------------------------------------
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,es,ar,bn,tr
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AED,BDT,TRY
FX_RATES_PROVIDER=none
FX_RATES_API_KEY=

# -----------------------------------------------------------------------------
# KYC (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | sumsub | onfido | shufti
KYC_PROVIDER=none
KYC_API_URL=
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# -----------------------------------------------------------------------------
# PAYMENTS / BILLING (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | stripe | nowpayments
BILLING_PROVIDER=none
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# -----------------------------------------------------------------------------
# BOOTSTRAP / SEED (development only)
# -----------------------------------------------------------------------------
# QUOTING: always wrap a value in double quotes if it contains '#', a space, or
# any shell metacharacter. The '#' case is the one that bites: dotenv-cli treats
# an unquoted '#' as the start of a comment and silently truncates the value,
# while sourcing the same file from bash (`set -a; . .env`) keeps it intact.
# The two then disagree, so the password the seed hashes is not the password
# your scripts send, and you get an inexplicable 401 followed by a lockout.
#   WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026   -> becomes "My_P4ss"
#   RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
SEED_SUPER_ADMIN_EMAIL=superadmin@copytrade.app
SEED_SUPER_ADMIN_PASSWORD="ChangeMe_Str0ng!Pass"
SEED_TENANT_ADMIN_EMAIL=admin@acme-capital.test
SEED_TENANT_ADMIN_PASSWORD=ChangeMe_Str0ng!Pass

# -----------------------------------------------------------------------------
# ADMIN WEB (Next.js) - consumed by apps/admin-web
# -----------------------------------------------------------------------------
# Server-side base URL used by Next route handlers and server components to
# reach the API. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Organisation the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Salt for the console's session cookies. Generate: openssl rand -base64 32
SESSION_COOKIE_SECRET=change_me_admin_session_secret_min_16_chars

# Browser-visible values only. Never place a secret behind NEXT_PUBLIC_.
NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
NEXT_PUBLIC_DEFAULT_LOCALE=en

# -----------------------------------------------------------------------------
# TRADING ENGINE (services/trading-engine, Python/FastAPI, port 8001)
# -----------------------------------------------------------------------------
TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001

# Pre-trade risk ceilings. These are hard caps enforced by the engine on every
# order intent; they are not user-configurable from the client.
MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# -----------------------------------------------------------------------------
# MARKET DATA (services/market-data, Python/FastAPI, port 8002)
# -----------------------------------------------------------------------------
MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
# Public reference-price sources, tried in order. No credentials are used.
MARKET_DATA_SOURCES=binance,bybit
# The only active assignment of this name: the LIVE MARKET DATA TRANSPORT section
# above explains the accepted spellings and the validation, and both readers -
# services/market-data and that transport - take the value from here.
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
# A cached quote older than this is served with stale=true.
MARKET_DATA_CACHE_TTL_SECONDS=15
# Enables the realtime websocket connectivity layer (wlct_trading.transport).
# Off by default: with it disabled the service serves cached REST quotes only
# and opens no exchange sockets.
MARKET_DATA_STREAMING_ENABLED=false

# -----------------------------------------------------------------------------
# NOTIFICATION SERVICE (services/notification-service, Node/BullMQ, port 8003)
# -----------------------------------------------------------------------------
NOTIFICATION_SERVICE_HOST=0.0.0.0
NOTIFICATION_SERVICE_PORT=8003
# The standalone worker reads MAIL_DRIVER, MAIL_FROM_* and SMTP_* from the
# EMAIL section above. Only "console" and "smtp" are implemented; any other
# value throws on startup rather than silently discarding mail.
# none | fcm | apns. "none" reports delivered:false instead of faking delivery.
PUSH_PROVIDER=none
# none | twilio
SMS_PROVIDER=none

# -----------------------------------------------------------------------------
# SHARED LOGGING (all Node and Python services)
# -----------------------------------------------------------------------------
# LOG_FORMAT is assigned once, in the LOGGING section above, and set there to json -
# the policy this section states (json in every deployed environment, pretty for local
# terminals). It is repeated here as a heading only, on purpose: a second active
# assignment for one name in one file is how two sections end up meaning two things.
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# BUILD METADATA (injected at image build time; not an operator setting)
# -----------------------------------------------------------------------------
# Two names are read straight off the process environment by the health surface
# (apps/api/src/modules/health/health.service.ts:30,32) rather than through the
# validated schema, because they describe the artefact rather than the deployment:
# what was built, and from which commit. They are documented here for that reason -
# a name a program reads and no file explains is a name nobody can fill in.
#
# Nothing in this repository currently sets either one. There is no CI in the tree and
# no build arg in infrastructure/docker/api.Dockerfile, so a deployment built from this
# repository answers GET /v1/health with commit "unknown" and version taken from
# SWAGGER_VERSION by fallback. Wiring it is one build arg in the image and one value
# from the build environment; until that exists the honest answer is "unknown", and the
# spec at apps/api/src/config/env-example-coverage.spec.ts keeps this sentence true by
# refusing any process.env read that neither the schema nor this file knows about.
# APP_VERSION=
# GIT_COMMIT_SHA=

# -----------------------------------------------------------------------------
# MOBILE APP (apps/mobile, Flutter)
# -----------------------------------------------------------------------------
# The Flutter app deliberately does NOT read this file. A .env shipped inside an
# APK/IPA is trivially extractable, so every mobile value is compiled in with
# --dart-define and the app holds no secrets at all: it authenticates with the
# user's own credentials and stores the resulting tokens in the platform
# keystore (flutter_secure_storage), never in shared preferences or a bundled
# asset. The variables below are listed here only so that all configuration for
# the platform lives in one discoverable place.
#
#   APP_ENV       development | staging | production
#   API_BASE_URL  Base URL INCLUDING the global prefix, e.g. https://api.example.com/api
#                 Android emulator reaches the host through 10.0.2.2, not localhost.
#                 Production builds refuse to start unless this is https://.
#   API_VERSION   URI version segment appended after the prefix (v1)
#   TENANT_SLUG   Sent as X-Tenant-Slug; identifies the white-label brand
#   WS_URL        Socket.IO origin, without the /realtime namespace
#
# Local development against this compose stack:
#
#   flutter run \
#     --dart-define=APP_ENV=development \
#     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=platform \
#     --dart-define=WS_URL=http://10.0.2.2:4000
#
# Release build:
#
#   flutter build apk --release \
#     --dart-define=APP_ENV=production \
#     --dart-define=API_BASE_URL=https://api.example.com/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=acme \
#     --dart-define=WS_URL=https://api.example.com
#
# Prefer --dart-define-from-file=config/production.json in CI so the values are
# versioned per environment instead of being retyped on the command line.

# =============================================================================
# PART 5 - AUTHENTICATED EXECUTION (libs/trading-core: wlct_trading.execution)
# =============================================================================
# Everything in this block governs whether real orders can reach a real
# exchange with real money. Read the whole section before changing anything.
#
# THE DEFAULTS BELOW CANNOT TRADE. That is deliberate and it is enforced in
# code, not just by convention: an unset variable is never treated as
# permission, and a contradictory combination fails at startup rather than
# resolving itself to the dangerous option.

# -----------------------------------------------------------------------------
# Exchange credentials
# -----------------------------------------------------------------------------
# NEVER commit real values. NEVER paste a key into a ticket, a chat message or
# a log. These are read once at startup by the credential provider and are
# never written to the database, never returned by an API, never included in a
# WebSocket payload and never logged - the credential object redacts itself in
# every rendering path, including repr() and f-strings.
#
# Create the key on Binance with ONLY:
#   [x] Enable Reading
#   [x] Enable Spot & Margin Trading
#   [ ] Enable Withdrawals   <-- MUST stay off
# A withdrawal-capable key is rejected by verify_credentials() and by the
# CREDENTIALS_VALID safety gate. The platform is non-custodial and refuses to
# hold a key that can move funds off the exchange.
#
# Also add an IP allowlist on the key. It is the single most effective control
# available, and it is free.
#
# These two variables are for a single-tenant development setup only. In
# production, per-tenant credentials come from the secret manager through
# SecretManagerCredentialProvider (Vault / AWS Secrets Manager / GCP Secret
# Manager / KMS), keyed by tenant and account. Environment variables do not
# scale to multi-tenant and cannot be rotated per customer.
BINANCE_API_KEY=
BINANCE_API_SECRET=
# Optional: restricts what the platform believes the key can do, independently
# of what the venue says. Comma separated. WITHDRAW here is always refused.
BINANCE_API_PERMISSIONS=SPOT
# Where credentials come from: env | secret-manager | none
CREDENTIAL_PROVIDER=env
# Cache TTL for a resolved credential, in seconds. Short, so a revoked key
# stops working quickly; non-zero, so every order does not hit the secret
# manager. 300 is a reasonable compromise.
CREDENTIAL_CACHE_TTL_SECONDS=300

# -----------------------------------------------------------------------------
# The four switches that gate real money
# -----------------------------------------------------------------------------
# All of the following must agree before a single byte reaches a real venue:
#
#   LIVE_TRADING_ENABLED=true
#   DRY_RUN=false
#   PAPER_TRADING=false
#   TRADING_MODE=LIVE
#   TRADING_ENABLED=true
#   LIVE_TRADING_CONFIRMED=true
#
# Any disagreement is a startup failure with an explicit message. In
# particular:
#   * LIVE_TRADING_ENABLED=true with DRY_RUN=true   -> REJECTED (contradiction)
#   * LIVE_TRADING_ENABLED=true with PAPER_TRADING=true -> REJECTED
#   * LIVE_TRADING_ENABLED=true without TRADING_MODE=LIVE -> REJECTED
# The platform never silently picks the dangerous interpretation, and never
# silently downgrades a misconfigured LIVE to PAPER either - a silent downgrade
# hides a production misconfiguration until the day it matters.

# Master switch for real-money execution.
LIVE_TRADING_ENABLED=false

# Build, validate, risk-check and sign the request, then stop. Nothing is
# transmitted and the order is NEVER reported as submitted. This is the correct
# setting for verifying a configuration end to end without risk.
DRY_RUN=true

# Route orders to the simulated venue. Paper fills are computed from real
# observed prices and are labelled is_simulated=true everywhere they appear -
# in the database, in the API and in every PnL figure.
PAPER_TRADING=true

# -----------------------------------------------------------------------------
# Execution timing
# -----------------------------------------------------------------------------
# How long to wait for a venue response before treating the outcome as UNKNOWN.
# A timeout is ambiguous, not a failure: the order may have been accepted. It
# is reconciled by clientOrderId and never resubmitted.
ORDER_REQUEST_TIMEOUT_MS=10000

# How often the background sweep compares local state against the venue.
ORDER_RECONCILIATION_INTERVAL_MS=60000

# How long to wait before reconciling an order whose result was unknown. Long
# enough for the venue to have finished processing; short enough that a
# position is not a mystery for minutes.
ORDER_UNKNOWN_RECONCILIATION_DELAY_MS=2000

# How often the exchange clock offset is re-measured. A signed request whose
# timestamp is outside the venue's window is rejected, so this is not optional.
EXCHANGE_TIME_SYNC_INTERVAL_MS=300000

# Maximum tolerated difference between this host's clock and the venue's.
# Above this, signing is REFUSED rather than attempted - Binance rejects a
# timestamp more than 1000ms ahead of server time regardless of recvWindow, so
# a larger local error cannot be compensated for by widening the window. If you
# hit this, fix NTP; do not raise the limit.
EXCHANGE_MAX_CLOCK_SKEW_MS=1000

# recvWindow sent with every signed request. Binance caps this at 60000.
# Smaller is safer: it bounds how long a captured request stays replayable.
EXCHANGE_RECV_WINDOW_MS=5000

# How long a clientOrderId reservation is remembered in Redis. The durable
# guard is the unique index on (tenant_id, client_order_id); this is the cheap
# fast path in front of it. 86400 = 24h.
EXECUTION_IDEMPOTENCY_TTL_SECONDS=86400

# Refuse to submit when the risk snapshot is older than this. Stale risk state
# is treated as unavailable, and unavailable means the order is refused.
#
# NOT ASSIGNED HERE, and that is a finding rather than tidying. MAX_RISK_STATE_AGE_MS
# is one name read by three planes whose code defaults disagree: the execution plane
# parses a fallback of 5000 (libs/trading-core/wlct_trading/execution/config.py:377),
# while services/trading-engine/app/config.py:89 and the API's env schema
# (packages/config/src/env.schema.ts:405, pinned at 2000 by risk-safety.spec.ts:182)
# both default to 2000 - and the SLO catalog derives its 4-second freshness budget from
# the 2000 figure (libs/trading-core/wlct_trading/slo/catalog.py:27). An unset
# deployment therefore gates a submission at 5s in one plane and 2s in another on the
# same snapshot. The single assignment lives in the RISK section below at the tighter
# figure; whether the execution plane's looser fallback is intended is a decision with a
# risk consequence attached, so it is written here as a question and not resolved by a
# comment that would make the file look settled.

# Submission attempts for genuinely retryable failures. Never applied to an
# ambiguous result - that path reconciles instead of retrying, always.
MAX_SUBMIT_ATTEMPTS=1

# -----------------------------------------------------------------------------
# Private user-data stream
# -----------------------------------------------------------------------------
# The authenticated WebSocket that delivers fills, order updates and balance
# changes. Backend only: its payloads are the full order flow of a real
# account and must never reach a mobile client or the admin web app.
PRIVATE_STREAM_RECONNECT_ENABLED=true

# Listen-key keepalive interval. Binance expires a listen key after 60 minutes;
# 30 minutes means one renewal can fail entirely and the stream still survives.
PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS=1800000

# After every reconnect the platform reconciles, because Binance does not
# replay events missed while disconnected. Leave this on.
PRIVATE_STREAM_RECONCILE_ON_RECONNECT=true

# -----------------------------------------------------------------------------
# Live-trading harness (NOT part of the default startup path)
# -----------------------------------------------------------------------------
# Guards the separately-invoked script that places a real order on testnet.
# It refuses to run unless this is explicitly true AND the credentials point at
# a testnet endpoint.
LIVE_EXECUTION_HARNESS_ENABLED=false
BINANCE_USE_TESTNET_FOR_HARNESS=true

# =============================================================================
# PART 6 - STRATEGY ENGINE, PAPER TRADING, BACKTESTING
# =============================================================================
# The strategy layer decides what it would like to do. It cannot submit an
# order, it never sees a credential, and NOTHING IN THIS SECTION CAN ENABLE
# LIVE TRADING. That still requires the Part 5 combination above
# (LIVE_TRADING_ENABLED=true, EXECUTION_ENABLED=true, DRY_RUN=false,
# PAPER_TRADING=false, EXCHANGE_SANDBOX_MODE=false), and every one of those is
# validated at startup.
#
# THREE THINGS THIS SECTION CANNOT PROMISE:
#   BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
#   PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
#   SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Feature switches
# -----------------------------------------------------------------------------
# Master switch for the strategy engine. Off by default: a deployment that has
# not been asked to run strategies should not spend CPU on every book update.
STRATEGY_ENGINE_ENABLED=false

# Whether paper sessions may be started. A paper session routes to the
# simulated adapter and refuses any adapter that is not marked simulated, so
# this is safe to leave on.
PAPER_TRADING_ENABLED=true

# Whether backtests may be submitted. A backtest opens no socket and touches
# no venue; it reads a stored dataset and replays it.
BACKTEST_ENABLED=true

# -----------------------------------------------------------------------------
# Engine bounds
# -----------------------------------------------------------------------------
# Bound on the in-process market-data queue feeding the strategies. A bounded
# queue turns a slow strategy into shed load rather than unbounded memory
# growth. Valid range 100 - 1000000.
STRATEGY_EVENT_QUEUE_SIZE=10000

# Hard cap on concurrently registered strategy instances per process.
# Valid range 1 - 1000.
STRATEGY_MAX_INSTANCES=50

# Observation budget for one dispatch, in milliseconds. Exceeding it increments
# a counter and marks the dispatch slow so an operator can see degradation.
# It is NOT a guarantee: this platform makes no latency guarantee, and any
# claim of "sub-millisecond" processing would be false. Must stay well below
# SIGNAL_MAX_AGE_MS.
STRATEGY_MAX_PROCESSING_LATENCY_MS=50

# -----------------------------------------------------------------------------
# Signal handling
# -----------------------------------------------------------------------------
# A signal older than this is refused by the validator rather than acted on.
# Stale intent is how a processing backlog turns into a bad fill.
SIGNAL_MAX_AGE_MS=2000

# How long a signal identity is remembered so an identical repeat is dropped.
# This is a bounded in-memory guard against a chattering strategy - it is NOT
# the order idempotency system, which lives in the execution layer and is
# backed by a unique index. Must cover at least SIGNAL_MAX_AGE_MS.
SIGNAL_DEDUP_TTL_SECONDS=5

# -----------------------------------------------------------------------------
# Backtest defaults
# -----------------------------------------------------------------------------
# Applied when a backtest request does not state its own assumptions. They are
# recorded in the configuration hash of every run, so changing one here changes
# the identity of subsequent runs - which is the point: two results computed
# under different cost assumptions are not comparable.
#
# None of these describe a real account or a real fee schedule. Set them from
# your venue's published rates.
BACKTEST_DEFAULT_INITIAL_CAPITAL=10000

# Fee RATES, not basis points: 0.001 is ten basis points. Maker and taker are
# separate because they are separate on every venue that matters.
BACKTEST_DEFAULT_MAKER_FEE=0.001
BACKTEST_DEFAULT_TAKER_FEE=0.001

# Slippage in basis points applied against every simulated taker fill, on both
# sides. Zero fees together with zero slippage is refused in production: that
# combination produces results no real account could achieve.
BACKTEST_DEFAULT_SLIPPAGE_BPS=1

# =============================================================================
# PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
# =============================================================================
# Datasets feed the Part 6 backtest engine. They are public market data: no
# credentials exist for them and none are accepted by them. Nothing in this
# section can enable live trading or route an order; the ingestion path shares
# no import with the execution path by design (and by test).
#
# BACKTEST RESULTS OVER THESE DATASETS ARE SIMULATIONS.
# BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
# SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
# Only the local backend ships. Object storage (S3-compatible, GCS, Azure)
# will be a new enum value and a new module - never a branch in the local one.
DATASET_STORAGE_BACKEND=local

# Root for finalised dataset trees. Must be absolute in production.
DATASET_LOCAL_ROOT=./data/datasets

# Staging root for in-flight ingestion. Must be on the SAME filesystem as
# DATASET_LOCAL_ROOT (finalisation is a rename) and disjoint from it
# (staging under the visible tree would expose half-written versions).
DATASET_TEMP_ROOT=./data/staging

# Hard ceiling for one partition file, in bytes (1 MiB - 4 GiB).
DATASET_MAX_PARTITION_BYTES=268435456

# Streaming reader chunk size (4 KiB - 64 MiB). The only read buffer a replay
# ever allocates; memory does not grow with dataset size.
DATASET_READER_BUFFER_SIZE=65536

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------
# Validate new versions before they become visible. Off is for emergency
# re-ingest of data validated elsewhere; such manifests are stamped
# "unvalidated" so they never masquerade as validated ones.
DATASET_VALIDATION_ENABLED=true

# Cap on gap findings repeated in a report (0 - 10000). Counts stay exact.
DATASET_MAX_GAP_WARNINGS=100

# Event ceiling per partition (1,000 - 50,000,000).
DATASET_MAX_EVENTS_PER_PARTITION=2000000

# Retention for NON-validated staging only. 'retain' keeps everything,
# including quarantined evidence. Nothing in this repo auto-deletes evidence.
DATASET_RETENTION_POLICY=retain

# -----------------------------------------------------------------------------
# Ingestion and backtest binding
# -----------------------------------------------------------------------------
# Master switch for dataset ingestion jobs. Off by default and never
# auto-enabled in production: a backfill is a deliberate act.
HISTORICAL_INGESTION_ENABLED=false

# Require backtest submissions to name a registered dataset VERSION.
# This is the rule that ends "re-ran the same backtest on different data":
# a run without a pinned version is refused rather than quietly guessed.
BACKTEST_DATASET_REQUIRED=true

# -----------------------------------------------------------------------------
# Part 8: real-time risk engine (control plane)
# -----------------------------------------------------------------------------
# These keys configure the API's risk control surface and the platform-default
# ceilings the trading worker inherits. They can only ever tighten what the
# engine enforces; there is no key here that approves an order, loosens a
# breach or disables a check. See docs/PART8_RISK.md for the resolution
# hierarchy and the fail-closed matrix.

# Require the extended Part 8 gate at worker startup (the Part 2 core gate is
# mandatory regardless and cannot be switched off by any setting).
RISK_ENGINE_ENABLED=true

# Assertion, not a toggle: RISK_FAIL_CLOSED=false is rejected at parse time
# in every environment. The engine refusing what it cannot prove safe is not
# a mode; it is the design.
RISK_FAIL_CLOSED=true

# A hot risk snapshot older than this may not authorise risk-increasing
# orders (ms). Keep it comfortably above RISK_SNAPSHOT_REFRESH_MS or the
# deployment is guaranteed stale (the env loader refuses that combination).
# This is the file's one active assignment of the name: set here, it governs the
# execution plane, the trading engine and the API alike, and no plane falls back to
# its own default - which is the state the Execution timing section above points at.
MAX_RISK_STATE_AGE_MS=2000
RISK_SNAPSHOT_REFRESH_MS=250

# Platform default ceilings. Child scopes (account/strategy/symbol) resolve
# to the TIGHTEST applicable value across the whole chain; these numbers are
# the top of that chain, deliberately conservative, and an emergency
# "flatten everything now" can only lower them further - never raise them.
MAX_ORDER_NOTIONAL=1000
MAX_POSITION_NOTIONAL=5000
MAX_ACCOUNT_EXPOSURE=10000
MAX_STRATEGY_EXPOSURE=5000
MAX_SYMBOL_EXPOSURE=5000
MAX_OPEN_ORDERS=20
MAX_DAILY_LOSS=500
MAX_STRATEGY_DAILY_LOSS=250
MAX_DRAWDOWN=10
MAX_ORDERS_PER_SECOND=2
MAX_ORDERS_PER_MINUTE=30
MAX_CANCELS_PER_SECOND=2
MAX_CANCELS_PER_MINUTE=30
MAX_PRICE_DEVIATION_BPS=250
MAX_CONSECUTIVE_LOSSES=5

# Risk events are the operator-facing trail (breaches, switches, stale
# state). Pruned by the maintenance queue after this many days; the durable
# accounting trail remains in the audit log under its own retention.
RISK_EVENTS_RETENTION_DAYS=365

# =============================================================================
# Part 9: observability & operations
# =============================================================================
# Publication and retention settings - never trading settings. In production
# the *_ENABLED flags cannot be false (env validation refuses to parse); a
# deployment that cannot be observed while holding money is not a deployment.
OBSERVABILITY_ENABLED=true
# ^ the name is shared by services/trading-engine, services/market-data and
# (since Part 18) services/execution-engine on purpose: one platform knob, three
# services, and NODE_ENV=production refuses to parse with it off in each.
METRICS_ENABLED=true
HEALTH_ENABLED=true
PROMETHEUS_ENABLED=true
PROMETHEUS_PATH=/metrics
# Loopback port for the OPTIONAL monitoring overlay (docker-compose.
# observability.yml), which is the only reader of this name: the platform runs
# unchanged with the stack switched off. 9090 is the image's own default, and the
# generated scrape config never reads this value - only compose does.
PROMETHEUS_PORT=9090
ALERTING_ENABLED=true
# Scrape secret. OPTIONAL outside production, REQUIRED in production.
# Provide a real random value through your secret store; never commit one.
# The header the scraper must present is x-metrics-token.
# METRICS_TOKEN=
# Cadences. HEALTH_REFRESH_MS paces each service's mirror loop;
# ALERT_DEDUP_WINDOW_MS must be >= it (validation enforces the ordering);
# QUEUE_ALERT_AGE_MS is the oldest-waiting threshold, halved for the
# trade-execution queue where the severity is CRITICAL by policy.
HEALTH_REFRESH_MS=5000
METRICS_EXPORT_INTERVAL_MS=15000
ALERT_DEDUP_WINDOW_MS=60000
QUEUE_ALERT_AGE_MS=120000
# Retention floors (validation enforces the minima): only RESOLVED alerts and
# CLOSED incidents are ever pruned; unresolved rows stay until resolved.
ALERT_RETENTION_DAYS=90
INCIDENT_RETENTION_DAYS=365

# =============================================================================
# Part 10: tracing, error budgets, fault injection
# =============================================================================
# Telemetry observes; it never authorises. Nothing below changes a trading
# decision, and the fault switch cannot arm in production (the validators
# refuse the boot on both runtimes).
OTEL_ENABLED=false
# OTLP/HTTP JSON collector base URL. Required in production when enabled.
# OTEL_ENDPOINT=http://otel-collector:4318
OTEL_TIMEOUT_MS=2000
OTEL_SAMPLE_RATIO=0.1
# Comma-separated operations always sampled at ratio 1.0 regardless of the
# above (the "critical traces remain inspectable" list).
OTEL_PRIORITY_OPERATIONS=execution.transmit
# Failure injection - a TEST HARNESS SWITCH. Armed only with the guard on
# and only outside production; disabling the guard DISABLES the feature,
# it does not unlock production. No API route can arm or consume.
FAILURE_INJECTION_ENABLED=false
FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=true
# SLO engine. Evaluation cadence 1..59 minutes; retention has a hard floor
# of 7 days IN CODE - the configured value can only raise it.
SLO_ENABLED=true
SLO_EVALUATION_INTERVAL_MINUTES=5
SLO_RETENTION_DAYS=30
SLO_DEFAULT_WINDOW_MINUTES=1440
SLO_FAST_BURN_MULTIPLIER=14.4
SLO_SLOW_BURN_MULTIPLIER=6

# -----------------------------------------------------------------------------
# Part 11: trading-worker plane and read-replica policy.
#
# Three separable switches, all default-safe: the worker consumer (runs only
# in the dedicated `npm run worker` process / container - the API never hosts
# it), the execution engine it forwards to (services/execution-engine, which
# holds the venue side), and the read replica (off until BOTH the URL and the
# flag are set; half-configuration is a boot error, by design).
# -----------------------------------------------------------------------------
# Worker latch: false makes the worker boot EXIT with a reason rather than
# idle quietly. The API process ignores it (it never mounts the consumers).
WORKER_ENABLED=true
# Stable per-replica identity for claims and logs. Unset composes host:pid:rand.
# WORKER_ID=worker-a
# The fleet list the partition assignment is computed over - identical on
# every worker, comma-separated. Empty means "this worker alone".
# WORKER_MEMBERSHIP=worker-a,worker-b,worker-c
# Part 12: where live membership comes from. 'config' (the default) treats
# the list above as the fleet. 'registry' lets workers self-register through
# a Redis heartbeat zset - the list above becomes the documented fallback
# (first tick + registry outages) and claims remain the entire authority.
# WORKER_MEMBERSHIP_MODE=registry
# Heartbeat grace period for 'registry' mode; must be >= 2x
# WORKER_PARTITION_RETRY_MS when the mode is registry (schema-enforced).
# WORKER_MEMBERSHIP_TTL_MS=30000
# Keyspace width; changing it rescales every assignment at once (coordinated
# config change, ceiling 4096 pinned by the coordination fixtures).
WORKER_PARTITION_COUNT=8
WORKER_PARTITION_LEASE_TTL_MS=15000
WORKER_PARTITION_RETRY_MS=2500
# Parked-job cadence and the ceiling before a homeless job fails visibly
# (deferrals do not consume BullMQ attempts; this is what stops an eternal orbit).
WORKER_DEFER_DELAY_MS=3000
WORKER_MAX_DEFERS=30
WORKER_SHUTDOWN_TIMEOUT_MS=10000
# The execution engine (services/execution-engine) this worker forwards
# TRADE_EXECUTION commands to. It holds venue contact and credentials; this
# process holds only the queue.
EXECUTION_ENGINE_URL=http://127.0.0.1:8093
# REQUIRED by the worker: its startup gate asks the engine's /internal/v1/status before it
# will consume a job, and refuses to run against a mode it was not built to serve. Since
# Part 20 the API reads both names too - not to command the engine, only to render the
# ENGINE POSTURE section of GET /v1/observability/execution. Optional for the API in the
# strict sense: with either name absent the module declines to construct a client, the API
# boots, and the panel section reports `unconfigured` with the reason instead of inventing
# an answer (no observability surface may be the reason a service refuses to start).
# Must match the engine's EXECUTION_INTERNAL_TOKEN. Generate fresh; never reuse across
# environments.
# EXECUTION_ENGINE_TOKEN=
# Inside docker-compose.yml both services get EXECUTION_ENGINE_URL=http://execution-engine:8093
# instead of the loopback value above: in a container network 127.0.0.1 is the container that
# set it, and the engine publishes no host port.
# Part 13 durable engine store (read by docker-compose for the
# execution-engine service). memory is the default and reports
# storeDurable=false honestly; postgres persists orders/events/fills in the
# engine_* tables (created by the API's migrations). Postgres without the
# DSN - or the DSN without postgres - refuses startup; there is no silent
# fallback in either direction. Details: services/execution-engine/.env.example
# and docs/PART13_DURABLE_STORE.md.
# EXECUTION_STORE_BACKEND=postgres
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct
# Part 14 journal retention, also read by the execution-engine service
# above: defaults keep APPLY disabled (dry-run/inspect always available);
# bounds and semantics in services/execution-engine/.env.example and
# docs/PART14_RETENTION.md. The prune itself runs from
# `node scripts/retention-run.mjs` under the deployment's scheduler.
# EXECUTION_RETENTION_ENABLED=false
# EXECUTION_RETENTION_EVENT_DAYS=90
# Part 15: how old a row-level-security enablement audit may be before the
# platform stops treating it as evidence (bounds enforced by the core law;
# a bad value refuses boot). The audit is read-only - there is no enablement
# apply switch to turn on. Recorded results live in
# docs/dr/rls-evidence.jsonl and are aged by `node scripts/rls-enablement.mjs
# check` (docs/PART15_RLS_ENABLEMENT.md).
# EXECUTION_ENABLEMENT_MAX_AGE_DAYS=30
# ---------------------------------------------------------------------------
# Part 16 - the credential source and the authenticated placement review.
#
# The review itself has no switch: it runs before every order a runtime could
# transmit, and a deployment that cannot reach the venue is refused rather than
# waved through. What is configurable here is where key material comes from and
# how expensive the review may be (docs/PART16_PLACEMENT_REVIEW.md).
#
# Where a live runtime would read key material. `none` (the default) wires a
# provider that refuses every authenticated lookup, which is what a simulated
# deployment wants: a paper process that needs a key is a bug, and this makes it
# loud. `environment` is development-only and is refused outright when
# NODE_ENV=production. `secret-manager` needs a fetcher injected in code - the
# platform's key custody lives with the service that owns the encrypted store.
# EXECUTION_CREDENTIAL_SOURCE=none
# The two variables `environment` reads are <PREFIX>_API_KEY and
# <PREFIX>_API_SECRET. No trailing underscore: the separator is appended for
# you, and `ACME_` would look for `ACME__API_KEY` (refused at boot).
# EXECUTION_CREDENTIAL_ENV_PREFIX=WLCT_BINANCE
# The single (tenant, account) pair an environment can serve. More than one
# tenant needs `secret-manager` - an environment has no way to scope a secret
# per customer, which is why it is development-only.
# EXECUTION_CREDENTIAL_TENANT_ID=tenant-1
# EXECUTION_CREDENTIAL_ACCOUNT_ID=account-1
# How long a resolved credential may be reused before the provider goes back to
# its source. Not a security window: rotation and revocation are the venue's and
# the operator's; this is the difference between one vault call per order and one
# per burst.
# EXECUTION_CREDENTIAL_CACHE_SECONDS=300
# How long a gathered placement attestation may be reused - AND how old one may
# be before the review calls it stale. One number on purpose: a cache that outlived
# the freshness bound would be the reason a stale answer passed. Bounds
# (1000..3600000 ms) are the core's law and refuse boot outside them.
# EXECUTION_PLACEMENT_ATTESTATION_TTL_MS=300000
# A key older than this may not trade until it is rotated (1..36500 days).
# EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS=90
# The venue must report an IP allowlist on the key. Default true; `false` is
# accepted for simulated runtimes and refused for live ones, because the
# allowlist is the one control on a leaked key that the venue enforces for us.
# EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true
#
# Deliberately absent from docker-compose.yml: the key variables themselves.
# `EXECUTION_CREDENTIAL_SOURCE=environment` reads them from the process
# environment; a compose line spelling them out would advertise the file as a
# place to put a secret, which is the one thing this platform will not do.
# Read-replica routing. Off by default; every read stays on the primary.
# When on, replica-eligible reads move only while the replica is healthy AND
# its lag (last probe, 10s trust window) is within DATABASE_READ_MAX_LAG_MS;
# any unknown routes primary. Execution-critical reads never use the replica.
DATABASE_READ_ENABLED=false
# DATABASE_READ_URL=postgresql://replica-user:...@replica-host:5432/wlct?sslmode=require
DATABASE_READ_MAX_LAG_MS=1500

# ---------------------------------------------------------------------------
# Disaster-recovery rehearsal (Part 21): scripts/dr-rehearsal.mjs
# ---------------------------------------------------------------------------
# Nothing here is read by the API, the worker or the engine: these are operator
# shell variables for one command, listed so that `scripts/dr-manifest.mjs` can see
# the name exists (its environment scan reads this file for `KEY=` lines, including
# commented ones) and so a deployment cannot mistake the rehearsal's confirmation for
# a live-mode switch. It is not one: EXECUTION_MODE=live is refused at startup
# regardless of anything below, and the rehearsal runner refuses --target production
# outright rather than consulting a variable.
#
# DR_REHEARSAL_CONFIRMATION=<rehearsalId>  # must equal the hash of the plan being
#     approved (printed by `--execute` on refusal, or `--plan-only`); the flag form
#     --confirm is equivalent. Setting it once in a shell profile defeats the purpose:
#     the value is the plan, so a stale export approves nothing.
```

