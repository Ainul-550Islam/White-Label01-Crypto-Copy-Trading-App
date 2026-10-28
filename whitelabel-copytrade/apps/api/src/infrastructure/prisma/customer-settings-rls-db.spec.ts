import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma.service';

const databaseUrl = process.env.BATCH02_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('mandatory customer-settings RLS', () => {
  let prisma: PrismaService;
  beforeAll(() => {
    prisma = new PrismaService({ databaseUrl, isProduction: false, databaseReadEnabled: false } as never,
      { warn() {}, debug() {}, error() {}, info() {} } as never);
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it('has exactly the expected tenant policy and forced RLS on both settings tables', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; enabled: boolean; forced: boolean;
      policy_count: bigint; matching_count: bigint }>>`
      SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
        count(p.oid)::bigint AS policy_count,
        count(p.oid) FILTER (WHERE p.polname = CASE c.relname
          WHEN 'copy_budgets' THEN 'copy_budget_tenant_isolation' ELSE 'tenant_isolation' END
          AND p.polpermissive AND p.polcmd = '*' AND p.polroles = ARRAY[0::oid]
          AND pg_get_expr(p.polqual, p.polrelid) = '(tenant_id = wlct_current_tenant_id())'
          AND pg_get_expr(p.polwithcheck, p.polrelid) = '(tenant_id = wlct_current_tenant_id())')::bigint AS matching_count
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public' AND c.relname IN ('copy_budgets', 'user_preferences')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity ORDER BY c.relname`;
    expect(rows).toEqual([
      { table_name: 'copy_budgets', enabled: true, forced: true, policy_count: 1n, matching_count: 1n },
      { table_name: 'user_preferences', enabled: true, forced: true, policy_count: 1n, matching_count: 1n },
    ]);
  });

  it('checks the live catalog for all modeled and SQL-only mandatory tenant policies', async () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'rls', 'batch02_mandatory_rls.json'), 'utf8')) as {
      modeled: Array<{ table: string; policy: string; predicate: string }>;
      sqlOnly: Array<{ table: string; policy: string; predicate: string }>;
    };
    const rows = await prisma.$queryRaw<Array<{ table_name: string; enabled: boolean; forced: boolean;
      policy_name: string | null; permissive: boolean; command: string; roles: string;
      using_expr: string | null; check_expr: string | null }>>`
      SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
        p.polname AS policy_name, p.polpermissive AS permissive, p.polcmd::text AS command,
        p.polroles::text AS roles, pg_get_expr(p.polqual, p.polrelid) AS using_expr,
        pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;
    for (const entry of [...manifest.modeled, ...manifest.sqlOnly]) {
      const matching = rows.filter((row) => row.table_name === entry.table);
      expect(matching).toHaveLength(1);
      const expected = entry.predicate === 'function' ? '(tenant_id = wlct_current_tenant_id())'
        : "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)";
      expect(matching[0]).toMatchObject({ enabled: true, forced: true, policy_name: entry.policy,
        permissive: true, command: '*', roles: '{0}', using_expr: expected, check_expr: expected });
    }
  });

  it('does not let the older Part 11 rollback disable newer mandatory tenant tables', () => {
    const rollback = readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'rls', 'disable.sql'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'rls', 'batch02_mandatory_rls.json'), 'utf8')) as {
      modeled: Array<{ table: string }>; sqlOnly: Array<{ table: string }>;
    };
    for (const table of [...manifest.modeled, ...manifest.sqlOnly].map((entry) => entry.table).concat('institutional_risk_policies')) {
      expect(rollback).not.toContain(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      expect(rollback).not.toContain(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
    }
  });
});
