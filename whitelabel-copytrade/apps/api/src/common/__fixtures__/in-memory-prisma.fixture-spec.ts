// # Responsibility: model scoped test persistence with typed rows, filters, unique constraints, and ordering.
/**
 * # Responsibility: TEST-ONLY in-memory stand-in for Prisma delegates used through
 * `(prisma as any).<model>`. Excluded from the production build by the
 * `**\/*spec.ts` pattern of tsconfig.build.json and not collected by jest
 * (the testRegex only matches `.spec.ts`).
 *
 * It models the parts of Prisma 5 that tenant-scoping depends on:
 *  - `update({ where })` matches EVERY field of `where` (extended unique
 *    where), so `{ id, tenantId }` with the wrong tenant raises P2025 exactly
 *    like the real client instead of updating the row;
 *  - `create` enforces the unique indexes passed to the constructor (P2002),
 *    the way the database's unique indexes do: a string entry is a
 *    single-column unique, a string[] entry a composite unique (for example
 *    `['tenantId', 'idempotencyKey']`, the per-tenant idempotency index). As
 *    in PostgreSQL, a row with NULL in any indexed column never conflicts;
 *  - `create` assigns a random UUID `id` when the data has none, like the
 *    schema's `@default(uuid())` (`seed` stores exactly what it is given);
 *  - `findMany` honours `orderBy` (single field), `skip` and `take`;
 *  - filters: equality, `null`, `not`, `lt`/`lte`/`gt`/`gte`, `in`, `OR`, `AND`.
 */

import { randomUUID } from 'crypto';

export type Row = Record<string, unknown>;

function isPlainObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Preserve JavaScript scalar comparison semantics without asserting arbitrary rows are numbers. */
function numericScalar(value: unknown): number | bigint | undefined {
  if (typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return Number(value);
  return undefined;
}

function matchesComparison(left: unknown, right: unknown, operator: 'lt' | 'lte' | 'gt' | 'gte'): boolean {
  const x = comparable(left);
  const y = comparable(right);
  if (typeof x === 'string' && typeof y === 'string') {
    if (operator === 'lt') return x < y;
    if (operator === 'lte') return x <= y;
    if (operator === 'gt') return x > y;
    return x >= y;
  }
  const a = numericScalar(x);
  const b = numericScalar(y);
  if (a === undefined || b === undefined) return false;
  if (operator === 'lt') return a < b;
  if (operator === 'lte') return a <= b;
  if (operator === 'gt') return a > b;
  return a >= b;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

export function rowMatches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === 'AND') {
      const all = isList(condition) ? condition : [condition];
      if (!all.every((c) => isPlainObject(c) && rowMatches(row, c))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!isList(condition) || !condition.some((c) => isPlainObject(c) && rowMatches(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (condition === null) {
      if (!isNullish(value)) return false;
      continue;
    }
    if (isPlainObject(condition)) {
      if ('not' in condition) {
        if (condition.not === null ? isNullish(value) : comparable(value) === comparable(condition.not)) return false;
      }
      if ('in' in condition && (!isList(condition.in) || !condition.in.map(comparable).includes(comparable(value)))) return false;
      if (isNullish(value) && ('lt' in condition || 'lte' in condition || 'gt' in condition || 'gte' in condition)) return false;
      if ('lt' in condition && !matchesComparison(value, condition.lt, 'lt')) return false;
      if ('lte' in condition && !matchesComparison(value, condition.lte, 'lte')) return false;
      if ('gt' in condition && !matchesComparison(value, condition.gt, 'gt')) return false;
      if ('gte' in condition && !matchesComparison(value, condition.gte, 'gte')) return false;
      continue;
    }
    if (comparable(value) !== comparable(condition)) return false;
  }
  return true;
}

export class InMemoryPrisma {
  private readonly tables = new Map<string, Row[]>();

  /**
   * @param uniques per delegate, its unique indexes: a column name for a
   *   single-column unique, a column list for a composite unique.
   */
  constructor(private readonly uniques: Record<string, Array<string | string[]>> = {}) {
    return new Proxy(this, {
      get: (target, prop: string | symbol) => {
        if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop);
        return target.delegate(prop);
      },
    });
  }

  /** Typed delegate access for new tests; the proxy remains compatible with existing repository fixtures. */
  model(delegate: string) {
    return this.delegate(delegate);
  }

  rows(delegate: string): Row[] {
    if (!this.tables.has(delegate)) this.tables.set(delegate, []);
    return this.tables.get(delegate)!;
  }

  seed<T extends Row>(delegate: string, data: T): T {
    this.assertUnique(delegate, data);
    const row = { ...data };
    this.rows(delegate).push(row);
    return { ...row };
  }

  /** Test-only transaction wrapper for repositories that require tenant RLS. */
  async withTenantRls<T>(tenantId: string, work: (transaction: InMemoryPrisma) => Promise<T>): Promise<T> {
    if (!tenantId.trim()) throw new Error('tenantId is required for the in-memory RLS transaction');
    return work(this);
  }

  private assertUnique(delegate: string, data: Row): void {
    for (const index of this.uniques[delegate] ?? []) {
      const columns = Array.isArray(index) ? index : [index];
      if (columns.some((column) => isNullish(data[column]))) continue;
      const clash = this.rows(delegate).some((row) =>
        columns.every((column) => comparable(row[column]) === comparable(data[column])),
      );
      if (clash) {
        const fields = columns.map((column) => `\`${column}\``).join(',');
        throw Object.assign(new Error(`Unique constraint failed on the fields: (${fields})`), {
          code: 'P2002',
          meta: { target: [...columns] },
        });
      }
    }
  }

  private delegate(name: string) {
    const table = () => this.rows(name);
    return {
      create: async ({ data }: { data: Row }) => this.seed(name, data.id === undefined ? { id: randomUUID(), ...data } : data),
      findFirst: async ({ where }: { where?: Row } = {}) => {
        const found = table().find((row) => rowMatches(row, where));
        return found ? { ...found } : null;
      },
      findMany: async ({ where, orderBy, skip, take }: { where?: Row; orderBy?: Row; skip?: number; take?: number } = {}) => {
        let result = table().filter((row) => rowMatches(row, where)).map((row) => ({ ...row }));
        if (orderBy) {
          const [field, direction] = Object.entries(orderBy)[0];
          const sign = direction === 'desc' ? -1 : 1;
          result = result.sort((a, b) => {
            const x = comparable(a[field]);
            const y = comparable(b[field]);
            return x === y ? 0 : matchesComparison(x, y, 'lt') ? -sign : sign;
          });
        }
        const start = skip ?? 0;
        return result.slice(start, take === undefined ? undefined : start + take);
      },
      count: async ({ where }: { where?: Row } = {}) => table().filter((row) => rowMatches(row, where)).length,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = table().find((r) => rowMatches(r, where));
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        const targets = table().filter((row) => rowMatches(row, where));
        for (const row of targets) Object.assign(row, data);
        return { count: targets.length };
      },
    };
  }
}
