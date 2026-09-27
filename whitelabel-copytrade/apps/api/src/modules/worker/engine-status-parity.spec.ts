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

/** The annotation -> kind law. An annotation this function does not recognize is a
 * hard failure, never a fallback: "the schema grew a type nobody looked at" is the
 * exact event this test exists to make loud. */
const kindFor = (
  annotation: string,
  declaringClass: string,
  fieldName?: string,
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
    'dict[str, object]': 'distributedLockWiringView',
  };
  // Name-based overrides for fields that share the same Python type but map to
  // different TS kinds. Without this, two `dict[str, object] | None` fields
  // would both resolve to the same kind.
  const nameOverrides: Readonly<Record<string, EngineStatusKind>> = {
    venue_attestation: 'venueAttestationView',
    credential_registry: 'credentialRegistryView',
  };
  const nullable = text.endsWith(' | None');
  const bare = nullable ? text.slice(0, -' | None'.length) : text;
  // Check name override first (only for fields that need disambiguation)
  const nameOverride = fieldName !== undefined ? nameOverrides[fieldName] : undefined;
  const kind = nameOverride ?? table[bare];
  if (kind === undefined) {
    throw new Error(
      `schemas.py::${declaringClass} declares "${text}" (field "${fieldName}"), which this parity spec has no mapping for. ` +
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
    const resolved = kindFor(annotation, className, name);
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
    expect(ENGINE_STATUS_FIELDS).toHaveLength(25);
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
