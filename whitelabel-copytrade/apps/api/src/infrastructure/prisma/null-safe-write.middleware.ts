import { Prisma } from '@prisma/client';

/**
 * Null-safe writes for Json and scalar-list columns.
 *
 * Prisma refuses a plain `null` for a Json field ("use Prisma.DbNull or
 * Prisma.JsonNull") and for a scalar list. Service code across billing,
 * governance and partners writes `metadata: input.metadata ?? null`,
 * `payload: raw ? sanitize(raw) : null`, `affectedSubjects: hold.affectedSubjects`
 * and similar - natural TypeScript that Prisma rejects at runtime. Those
 * writes sit inside `try { ... } catch { logger.debug('persist skipped') }`
 * blocks, so the rejection was silent: the row was simply never written.
 *
 * Rewriting every call site would touch dozens of files for one rule, so the
 * rule lives here, once, driven by the generated schema metadata:
 *
 *   - optional Json   + null -> Prisma.DbNull (SQL NULL, what the caller meant)
 *   - required Json   + null -> key dropped on create (column default applies),
 *                               key dropped on update (value unchanged)
 *   - scalar list     + null -> key dropped on create (default `[]` applies),
 *                               `[]` on update (an explicit "clear")
 *
 * Only top-level `data` keys of create/createMany/update/updateMany/upsert are
 * touched. Values other than a literal `null` pass through unchanged, so a
 * caller that already uses Prisma.DbNull / Prisma.JsonNull is unaffected.
 */

export type NullableFieldKind = 'json-optional' | 'json-required' | 'list';

/** model name -> field name -> kind, for the fields this middleware rewrites. */
export type NullSafeFieldIndex = ReadonlyMap<string, ReadonlyMap<string, NullableFieldKind>>;

interface DmmfFieldLike {
  readonly name: string;
  readonly kind: string;
  readonly type: string;
  readonly isList: boolean;
  readonly isRequired: boolean;
}

interface DmmfModelLike {
  readonly name: string;
  readonly fields: readonly DmmfFieldLike[];
}

export function buildNullSafeFieldIndex(models: readonly DmmfModelLike[]): NullSafeFieldIndex {
  const index = new Map<string, Map<string, NullableFieldKind>>();
  for (const model of models) {
    const fields = new Map<string, NullableFieldKind>();
    for (const field of model.fields) {
      if (field.kind === 'object') {
        continue;
      }
      if (field.isList) {
        fields.set(field.name, 'list');
      } else if (field.type === 'Json') {
        fields.set(field.name, field.isRequired ? 'json-required' : 'json-optional');
      }
    }
    if (fields.size > 0) {
      index.set(model.name, fields);
    }
  }
  return index;
}

type WriteMode = 'create' | 'update';

function normaliseData(
  data: unknown,
  fields: ReadonlyMap<string, NullableFieldKind>,
  mode: WriteMode,
): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  let copy: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value !== null) {
      continue;
    }
    const kind = fields.get(key);
    if (kind === undefined) {
      continue;
    }
    copy ??= { ...(data as Record<string, unknown>) };
    if (kind === 'json-optional') {
      copy[key] = Prisma.DbNull;
    } else if (kind === 'json-required') {
      delete copy[key];
    } else if (mode === 'create') {
      delete copy[key];
    } else {
      copy[key] = [];
    }
  }
  return copy ?? data;
}

/** Pure rewrite of one middleware `params.args`; exported for tests. */
export function normaliseWriteArgs(
  index: NullSafeFieldIndex,
  model: string | undefined,
  action: string,
  args: unknown,
): unknown {
  if (model === undefined || args === null || typeof args !== 'object') {
    return args;
  }
  const fields = index.get(model);
  if (fields === undefined) {
    return args;
  }
  const a = args as Record<string, unknown>;
  switch (action) {
    case 'create':
      return { ...a, data: normaliseData(a.data, fields, 'create') };
    case 'createMany':
    case 'createManyAndReturn':
      return {
        ...a,
        data: Array.isArray(a.data)
          ? a.data.map((row) => normaliseData(row, fields, 'create'))
          : normaliseData(a.data, fields, 'create'),
      };
    case 'update':
    case 'updateMany':
      return { ...a, data: normaliseData(a.data, fields, 'update') };
    case 'upsert':
      return {
        ...a,
        create: normaliseData(a.create, fields, 'create'),
        update: normaliseData(a.update, fields, 'update'),
      };
    default:
      return args;
  }
}

interface MiddlewareParamsLike {
  model?: string;
  action: string;
  args: unknown;
}

export function createNullSafeWriteMiddleware(index: NullSafeFieldIndex) {
  return async <P extends MiddlewareParamsLike, T>(
    params: P,
    next: (params: P) => Promise<T>,
  ): Promise<T> =>
    next({ ...params, args: normaliseWriteArgs(index, params.model, params.action, params.args) });
}

/** The index for the generated client, or null when the runtime has no DMMF
 * (a mocked @prisma/client in unit tests). */
export function nullSafeFieldIndexFromClient(): NullSafeFieldIndex | null {
  const dmmf = (
    Prisma as unknown as { dmmf?: { datamodel?: { models?: readonly DmmfModelLike[] } } }
  ).dmmf;
  const models = dmmf?.datamodel?.models;
  return Array.isArray(models) ? buildNullSafeFieldIndex(models) : null;
}
