/**
 * TEST-ONLY in-memory stand-in for the Prisma client delegates used through
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

export type Row = Record<string, any>;

function isPlainObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

function comparable(value: any): any {
  return value instanceof Date ? value.getTime() : value;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

export function rowMatches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === 'AND') {
      const all = Array.isArray(condition) ? condition : [condition];
      if (!all.every((c: Row) => rowMatches(row, c))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(condition as Row[]).some((c) => rowMatches(row, c))) return false;
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
      if ('in' in condition && !(condition.in as any[]).map(comparable).includes(comparable(value))) return false;
      if (isNullish(value) && ('lt' in condition || 'lte' in condition || 'gt' in condition || 'gte' in condition)) return false;
      if ('lt' in condition && !(comparable(value) < comparable(condition.lt))) return false;
      if ('lte' in condition && !(comparable(value) <= comparable(condition.lte))) return false;
      if ('gt' in condition && !(comparable(value) > comparable(condition.gt))) return false;
      if ('gte' in condition && !(comparable(value) >= comparable(condition.gte))) return false;
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
        if (typeof prop === 'symbol' || prop in target) return (target as any)[prop];
        return target.delegate(prop);
      },
    });
  }

  rows(delegate: string): Row[] {
    if (!this.tables.has(delegate)) this.tables.set(delegate, []);
    return this.tables.get(delegate)!;
  }

  seed(delegate: string, data: Row): Row {
    this.assertUnique(delegate, data);
    const row = { ...data };
    this.rows(delegate).push(row);
    return { ...row };
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
            return x === y ? 0 : x < y ? -sign : sign;
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
