/**
 * Part 11: the row-level-security coverage trap.
 *
 * The RLS artefacts are GENERATED from schema.prisma (scripts/gen_part11_rls.py);
 * this spec re-derives the same truth from the schema at test time and refuses
 * any difference. The failure it exists to prevent is the silent one: a later
 * part adds a tenant table, ships without a policy, and the defence layer
 * quietly covers one table less than every document claims. Here that schema
 * edit turns this file red until the generator is rerun - and rerunning the
 * generator is one command with no judgement calls.
 *
 * The second half is the withTenantRls helper's own contract: validated UUID
 * before anything touches SQL, SET LOCAL (never session-level), bind
 * parameter (never interpolation), transaction-first statement order.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaService } from './prisma.service';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
const schemaText = readFileSync(join(repoRoot, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8');
const coverage = JSON.parse(
  readFileSync(join(repoRoot, 'apps', 'api', 'prisma', 'rls', 'rls_coverage.json'), 'utf8'),
) as {
  schema: string;
  stamp: string;
  policyName: string;
  functionName: string;
  covered: Array<{ table: string; model: string }>;
  excluded: Array<{ table: string; model: string }>;
};

const migrationPath = join(
  repoRoot,
  'apps',
  'api',
  'prisma',
  'migrations',
  `${coverage.stamp}_part11_row_level_security`,
  'migration.sql',
);
const migrationText = readFileSync(migrationPath, 'utf8');
const enableText = readFileSync(join(repoRoot, 'apps', 'api', 'prisma', 'rls', 'enable.sql'), 'utf8');
const disableText = readFileSync(join(repoRoot, 'apps', 'api', 'prisma', 'rls', 'disable.sql'), 'utf8');

/** The same classification rule the generator applies - duplicated on
 * purpose: if generator and spec ever disagree about WHAT is tenant-scoped,
 * one of them goes red; a shared import would let both drift together. */
function parseSchema(): { covered: Array<[string, string]>; excluded: Array<[string, string]> } {
  const covered: Array<[string, string]> = [];
  const excluded: Array<[string, string]> = [];
  const re = /^model (\w+) \{([\s\S]*?)^\}/gm;
  for (let m = re.exec(schemaText); m !== null; m = re.exec(schemaText)) {
    const name = m[1] as string;
    const body = m[2] as string;
    const mapMatch = /@@map\("([^"]+)"\)/.exec(body);
    if (mapMatch === null) {
      continue;
    }
    const table = mapMatch[1] as string;
    if (/^\s*tenantId\s+String\s+@/m.test(body)) {
      covered.push([table, name]);
    } else if (/^\s*tenantId\s+String\?\s+@/m.test(body)) {
      excluded.push([table, name]);
    }
  }
  return { covered: covered.sort(), excluded: excluded.sort() };
}

/** Strip `--` comment lines: the artefacts' headers EXPLAIN the banned
 * statements in prose, and a substring check over prose would test the
 * comment wording instead of the SQL. */
function sqlOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}
const migrationSql = sqlOnly(migrationText);
const enableSql = sqlOnly(enableText);
const disableSql = sqlOnly(disableText);

describe('Part 11 RLS coverage - the schema is the source of truth', () => {
  const truth = parseSchema();

  it('coverage JSON matches the live schema exactly (drift trap)', () => {
    expect(coverage.covered.map((c) => [c.table, c.model])).toEqual(truth.covered);
    expect(coverage.excluded.map((c) => [c.table, c.model])).toEqual(truth.excluded);
    expect(coverage.covered.length).toBeGreaterThanOrEqual(38);
  });

  it('every covered table has exactly one policy, and no excluded table has any', () => {
    for (const [table] of truth.covered) {
      const pattern = new RegExp(
        `CREATE POLICY ${coverage.policyName} ON "${table}"\\s+AS PERMISSIVE\\s+FOR ALL\\s+TO PUBLIC\\s+USING \\(tenant_id = ${coverage.functionName}\\(\\)\\)\\s+WITH CHECK \\(tenant_id = ${coverage.functionName}\\(\\)\\);`,
      );
      expect(migrationText).toMatch(pattern);
    }
    for (const [table] of truth.excluded) {
      expect(migrationSql).not.toContain(`ON "${table}"`);
    }
    expect([...migrationText.matchAll(/CREATE POLICY /g)]).toHaveLength(truth.covered.length);
  });

  it('the GUC name the function reads is the name the service helper writes', () => {
    expect(migrationText).toContain("current_setting('app.tenant_id', true)");
    // The helper's statement is asserted below on the mock; here the pin is
    // that both artefacts speak the identical setting name, so a rename on
    // one side cannot survive the suite.
    expect(readFileSync(join(__dirname, 'prisma.service.ts'), 'utf8')).toContain(
      "set_config('app.tenant_id',",
    );
  });

  it('the additive migration contains no destructive statements, anywhere', () => {
    for (const banned of ['DROP TABLE', 'DELETE FROM', 'TRUNCATE', 'UPDATE "', 'ALTER TABLE', 'DROP POLICY', 'DROP FUNCTION']) {
      expect(migrationSql).not.toContain(banned);
    }
    // ...and it deliberately does NOT enable RLS; that is enable.sql's job.
    expect(migrationSql).not.toContain('ENABLE ROW LEVEL SECURITY');
    expect(migrationText).toContain('Deliberately NOT enabled here');
  });

  it('enable.sql pairs ENABLE with FORCE per table and never touches exclusions', () => {
    for (const [table] of truth.covered) {
      expect(enableText).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(enableText).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    }
    for (const [table] of truth.excluded) {
      expect(enableSql).not.toContain(`ALTER TABLE "${table}" ENABLE`);
    }
    // The two role facts that decide whether any of this is real defence.
    expect(enableText).toContain('rolbypassrls');
    expect(enableText).toContain('rolsuper');
  });

  it('disable.sql is the exact inverse - every ENABLE has its DISABLE', () => {
    for (const [table] of truth.covered) {
      expect(disableText).toContain(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;`);
      expect(disableText).toContain(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
    expect(disableSql).not.toContain('DROP POLICY');
    expect(disableSql).not.toContain('DROP TABLE');
  });
});

describe('PrismaService.withTenantRls', () => {
  const GOOD = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  function serviceWithMock(): {
    svc: PrismaService;
    tx: { $executeRaw: jest.Mock };
    transactionSpy: jest.Mock;
  } {
    const svc = new PrismaService(
      {
        isProduction: true,
        // The constructor validates the datasource URL shape; nothing here
        // ever connects, but it must not be undefined for construction.
        databaseUrl: 'postgresql://unit-test:test@127.0.0.1:59999/wlct_unit',
        databaseReadEnabled: false,
        databaseReadUrl: undefined,
        databaseLogQueries: false,
      } as never,
      { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() } as never,
    );
    const tx = { $executeRaw: jest.fn(async () => 1) };
    const transactionSpy = jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    (svc as unknown as { $transaction: unknown }).$transaction = transactionSpy;
    return { svc, tx, transactionSpy };
  }

  it('refuses a non-UUID tenant without opening a transaction at all', async () => {
    const { svc, transactionSpy } = serviceWithMock();
    await expect(svc.withTenantRls('anything-at-all; DROP TABLE users', () => Promise.resolve(1))).rejects.toThrow(
      /canonical tenant UUID/,
    );
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('sets the GUC transaction-locally, as a bound parameter, before the work', async () => {
    const { svc, tx } = serviceWithMock();
    const order: string[] = [];
    tx.$executeRaw.mockImplementation(async () => {
      order.push('set_config');
      return 1;
    });
    const value = await svc.withTenantRls(GOOD, async () => {
      order.push('work');
      return 42;
    });
    expect(value).toBe(42);
    expect(order).toEqual(['set_config', 'work']);
    const call = tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    // A tagged template splits around each interpolation: the set_config
    // call has exactly one parameter, so exactly two literal fragments.
    expect(call[0]).toHaveLength(2);
    expect(call[0][0]).toContain("set_config('app.tenant_id',");
    expect(call[0][1]).toBe(', true)'); // is_local: the GUC cannot outlive the tx
    expect(call[1]).toBe(GOOD); // bound parameter, never string-concatenated
    expect(call[2]).toBeUndefined();
  });
});
