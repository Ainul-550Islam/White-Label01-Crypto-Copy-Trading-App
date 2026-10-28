/**
 * Part 11: the row-level-security coverage trap.
 *
 * The historic Part 11 artefacts describe the DBA-managed surface. Newer
 * tables are protected by their own mandatory migrations, not by that legacy
 * rollback script. This spec independently derives schema coverage and checks
 * the union, verifies each newer policy's complete tenant predicate, and makes
 * sure the legacy rollback cannot disable mandatory protection. The old
 * generator must not be run unmodified against mandatory tables: its inverse
 * rollback would remove their security.
 *
 * The second half is the withTenantRls helper's own contract: validated UUID
 * before anything touches SQL, SET LOCAL (never session-level), bind
 * parameter (never interpolation), transaction-first statement order.
 */

import { readdirSync, readFileSync } from 'node:fs';
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
type MandatoryPolicy = { table: string; policy: string; predicate: 'function' | 'guc' };
const mandatory = JSON.parse(readFileSync(
  join(repoRoot, 'apps', 'api', 'prisma', 'rls', 'batch02_mandatory_rls.json'), 'utf8',
)) as { schema: string; modeled: Array<MandatoryPolicy & { model: string }>; sqlOnly: MandatoryPolicy[] };

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
const migrationsDirectory = join(repoRoot, 'apps', 'api', 'prisma', 'migrations');
const part11MigrationEntries = readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{14}_(?:part11_row_level_security|rls_policy_gap_close)$/.test(entry.name)
    && entry.name.slice(0, 14) <= coverage.stamp)
  .sort((left, right) => left.name.localeCompare(right.name));
const part11MigrationTexts = part11MigrationEntries
  .map((entry) => readFileSync(join(migrationsDirectory, entry.name, 'migration.sql'), 'utf8'));
const allMigrationText = part11MigrationTexts.join('\n');

function collectMigrationSql(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectMigrationSql(fullPath);
    return entry.isFile() && entry.name === 'migration.sql' ? [readFileSync(fullPath, 'utf8')] : [];
  });
}
const allMigrationSqlFiles = collectMigrationSql(migrationsDirectory);
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
    const combined = [...coverage.covered, ...mandatory.modeled].map((c) => [c.table, c.model]).sort();
    expect(combined).toEqual(truth.covered);
    expect(new Set(combined.map(([table]) => table)).size).toBe(combined.length);
    expect(coverage.excluded.map((c) => [c.table, c.model])).toEqual(truth.excluded);
    expect(coverage.covered.length).toBeGreaterThanOrEqual(38);
    expect(mandatory.schema).toBe('batch02-mandatory-tenant-rls-v1');
  });

  it('every covered table has exactly one additive policy across migration history, and no excluded table has any', () => {
    const allMigrationSql = sqlOnly(allMigrationText);
    for (const { table } of coverage.covered) {
      const pattern = new RegExp(
        `CREATE POLICY ${coverage.policyName} ON "${table}"\\s+AS PERMISSIVE\\s+FOR ALL\\s+TO PUBLIC\\s+USING \\(tenant_id = ${coverage.functionName}\\(\\)\\)\\s+WITH CHECK \\(tenant_id = ${coverage.functionName}\\(\\)\\);`,
      );
      expect(allMigrationText.match(pattern) ?? []).toHaveLength(1);
    }
    for (const [table] of truth.excluded) {
      expect(allMigrationSql).not.toContain(`ON "${table}"`);
    }
    expect([...allMigrationText.matchAll(/CREATE POLICY /g)]).toHaveLength(coverage.covered.length);

    const earlierMigrationTexts = part11MigrationEntries
      .filter((entry) => entry.name.slice(0, 14) < coverage.stamp)
      .map((entry) => readFileSync(join(migrationsDirectory, entry.name, 'migration.sql'), 'utf8'));
    const policyTablePattern = /CREATE POLICY \w+ ON "([^"]+)"/g;
    const earlierPolicyTables = new Set(
      earlierMigrationTexts.flatMap((text) => [...sqlOnly(text).matchAll(policyTablePattern)].map((match) => match[1] as string)),
    );
    const expectedPolicyDelta = coverage.covered
      .map(({ table }) => table)
      .filter((table) => !earlierPolicyTables.has(table))
      .sort();
    const currentPolicyTables = [...sqlOnly(migrationText).matchAll(policyTablePattern)]
      .map((match) => match[1] as string)
      .sort();
    expect(currentPolicyTables).toEqual(expectedPolicyDelta);
  });

  it('requires a policy for every table enabled by a migration or the DBA enable script', () => {
    const migrationSql = allMigrationSqlFiles.map(sqlOnly).join('\n');
    const policySql = allMigrationSqlFiles.map(sqlOnly).join('\n');
    const policyTables = new Set(
      [...policySql.matchAll(/CREATE\s+POLICY\s+"?\w+"?\s+ON\s+(?:public\.)?"([^"]+)"/gi)].map((match) => match[1] as string),
    );
    const enabledTables = new Set(
      [...migrationSql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY/g)].map((match) => match[1] as string),
    );
    const dbaEnabledTables = new Set(
      [...enableSql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY/g)].map((match) => match[1] as string),
    );

    for (const table of new Set([...enabledTables, ...dbaEnabledTables])) {
      expect(policyTables.has(table)).toBe(true);
    }
  });

  it('inventories tenant-owned SQL tables that are not represented in Prisma', () => {
    const sql = allMigrationSqlFiles.map(sqlOnly).join('\n');
    const known = new Set([...coverage.covered, ...mandatory.modeled, ...mandatory.sqlOnly].map((entry) => entry.table));
    const required = new Set<string>();
    for (const match of sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?);/gi)) {
      if (/"?tenant_id"?\s+uuid\s+NOT\s+NULL/i.test(match[2] as string)) required.add(match[1] as string);
    }
    // Do not silently exclude unmodeled pre-auth or public-capability tables:
    // they need a reviewed, safe access contract before becoming exceptions.
    expect([...required].filter((table) => !known.has(table)).sort()).toEqual([]);
  });

  it('protects every mandatory table with one exact all-command tenant policy and forced RLS', () => {
    const sql = allMigrationSqlFiles.map(sqlOnly).join('\n');
    const entries = [...mandatory.modeled, ...mandatory.sqlOnly];
    expect(new Set(entries.map((entry) => entry.table)).size).toBe(entries.length);
    for (const { table, policy, predicate } of entries) {
      expect(['function', 'guc']).toContain(predicate);
      const statements = [...sql.matchAll(new RegExp(
        `CREATE\\s+POLICY\\s+"?\\w+"?\\s+ON\\s+"${table}"\\s+[\\s\\S]*?;`, 'gi',
      ))].map((match) => match[0].replace(/"/g, '').replace(/\s+/g, ' ').trim());
      expect(statements).toHaveLength(1);
      const check = predicate === 'function'
        ? 'tenant_id = wlct_current_tenant_id()'
        : "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid";
      const escaped = check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(statements[0]).toMatch(new RegExp(
        `^CREATE POLICY ${policy} ON ${table} (?:AS PERMISSIVE )?(?:FOR ALL )?(?:TO PUBLIC )?USING \\(${escaped}\\) WITH CHECK \\(${escaped}\\);$`, 'i',
      ));
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      expect(sql).not.toMatch(new RegExp(`ALTER\\s+TABLE\\s+"${table}"\\s+(?:NO FORCE|DISABLE)\\s+ROW LEVEL SECURITY`, 'i'));
      expect(sql).not.toMatch(new RegExp(`(?:DROP|ALTER)\\s+POLICY\\s+"?\\w+"?\\s+ON\\s+"${table}"`, 'i'));
      expect(disableSql).not.toMatch(new RegExp(`ALTER\\s+TABLE\\s+"${table}"\\s+(?:NO FORCE|DISABLE)\\s+ROW LEVEL SECURITY`, 'i'));
    }
  });

  it('keeps lead-trader applications in the generated tenant-RLS surface', () => {
    const application = truth.covered.find(([table]) => table === 'lead_trader_applications');
    expect(application).toEqual(['lead_trader_applications', 'LeadTraderApplication']);
    expect(coverage.covered).toContainEqual({ table: 'lead_trader_applications', model: 'LeadTraderApplication' });
    const policy = new RegExp(`CREATE POLICY ${coverage.policyName} ON "lead_trader_applications"`, 'g');
    expect([...allMigrationText.matchAll(policy)]).toHaveLength(1);
    expect(enableText).toContain('ALTER TABLE "lead_trader_applications" ENABLE ROW LEVEL SECURITY;');
    expect(enableText).toContain('ALTER TABLE "lead_trader_applications" FORCE ROW LEVEL SECURITY;');
    expect(disableText).toContain('ALTER TABLE "lead_trader_applications" NO FORCE ROW LEVEL SECURITY;');
    expect(disableText).toContain('ALTER TABLE "lead_trader_applications" DISABLE ROW LEVEL SECURITY;');
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

  it('the historic DBA enable script pairs ENABLE with FORCE and never touches exclusions', () => {
    for (const { table } of coverage.covered) {
      expect(enableText).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(enableText).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    }
    for (const [table] of truth.excluded) {
      expect(enableSql).not.toContain(`ALTER TABLE "${table}" ENABLE`);
    }
    const listed = [...enableSql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY;/g)]
      .map((match) => match[1]).sort();
    expect(listed).toEqual(coverage.covered.map(({ table }) => table).sort());
    // The two role facts that decide whether any of this is real defence.
    expect(enableText).toContain('rolbypassrls');
    expect(enableText).toContain('rolsuper');
  });

  it('the historic DBA disable script reverses that optional surface only', () => {
    for (const { table } of coverage.covered) {
      expect(disableText).toContain(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;`);
      expect(disableText).toContain(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
    const listed = [...disableSql.matchAll(/ALTER TABLE "([^"]+)" DISABLE ROW LEVEL SECURITY;/g)]
      .map((match) => match[1]).sort();
    expect(listed).toEqual(coverage.covered.map(({ table }) => table).sort());
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
