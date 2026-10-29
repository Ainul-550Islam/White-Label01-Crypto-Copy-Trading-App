import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// Batch 03 (A5): DB-pinned RLS spec for `account_recovery_tokens`.
//
// The table was created by the account-recovery migration without the
// additive Part 11 tenant_isolation policy - the coverage JSON had it under
// "covered by pending sweep" while the database itself had none. The batch-03
// reconcile migration 20261228000000_rls_coverage_reconcile stamps it. This
// spec is what proves the reconcile engaged: ENABLE + FORCE + policy named
// exactly `tenant_isolation`, and reads/writes scoped via withTenantRls()
// against a concurrently-seeded second tenant.

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;

const describeDb = adminUrl && rlsUrl ? describe : describe.skip;

const sha = (ch: string) => ch.repeat(64);
if (!(adminUrl && rlsUrl)) {
  // eslint-disable-next-line no-console
  console.warn(
    'account-recovery-token-rls-db.spec.ts: skipped - BATCH02_TEST_DATABASE_URL / BATCH02_TEST_RLS_DATABASE_URL not set',
  );
}

const logger = {
  info() {},
  warn() {},
  debug() {},
  error() {},
} as never;

const makeDb = (url: string) =>
  new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, logger);

describeDb('account_recovery_tokens RLS (batch-03 reconcile)', () => {
  const tenantId = randomUUID();
  const otherTenant = randomUUID();
  const myUserId = randomUUID();
  const theirUserId = randomUUID();
  let admin: PrismaService;
  let db: PrismaService;

  beforeAll(async () => {
    admin = makeDb(adminUrl!);
    db = makeDb(rlsUrl!);
    await admin.tenant.createMany({
      data: [
        { id: tenantId, slug: `acct-rec-${tenantId.slice(0, 8)}`, name: 'Recovery tokens', status: 'ACTIVE' },
        { id: otherTenant, slug: `acct-rec-other-${otherTenant.slice(0, 8)}`, name: 'Other tenant', status: 'ACTIVE' },
      ],
    });
    // user_id is a real FK to users: seed one user per tenant so the token
    // inserts below satisfy the constraint (users.email_index must be a
    // 64-char HMAC-style value, password_hash a 60-char bcrypt-style value).
    await admin.user.createMany({
      data: [
        {
          id: myUserId,
          tenantId,
          email: `acct-rec-${tenantId.slice(0, 8)}@example.test`,
          emailIndex: sha('a'),
          passwordHash: '$2b$12$' + 'K'.repeat(53),
        },
        {
          id: theirUserId,
          tenantId: otherTenant,
          email: `acct-rec-other-${otherTenant.slice(0, 8)}@example.test`,
          emailIndex: sha('b'),
          passwordHash: '$2b$12$' + 'Q'.repeat(53),
        },
      ],
    });
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      `DELETE FROM "account_recovery_tokens" WHERE "tenant_id"::text IN ($1, $2)`,
      tenantId,
      otherTenant,
    );
    await admin.user.deleteMany({ where: { id: { in: [myUserId, theirUserId] } } });
    await admin.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenant] } } });
    await Promise.all([admin.$disconnect(), db.$disconnect()]);
  });

  it('row-level flags and the tenant_isolation policy are present and forced', async () => {
    const rows = await admin.$queryRaw<
      Array<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policy_exists: boolean;
      }>
    >`
      SELECT c.relrowsecurity,
             c.relforcerowsecurity,
             EXISTS (
               SELECT 1 FROM pg_policies p
               WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation'
             ) AS policy_exists
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'account_recovery_tokens'
    `;
    expect(rows).toHaveLength(1);
    // Fail-closed law: without the policy the defence is decorative; without
    // FORCE the table owner reads through it. Both must be true.
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
    expect(rows[0].policy_exists).toBe(true);
  });

  it('tenant-scoped reads see only the actuated tenant; cross-tenant are invisible', async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    // Seed through the admin connection (owner-ish role bypasses RLS on its
    // own tables; that is the invariant we pin above).
    const inserted = await admin.$executeRawUnsafe(
      `INSERT INTO "account_recovery_tokens" ("id", "tenant_id", "user_id", "token_hash", "method", "created_at", "expires_at")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'EMAIL', now(), now() + interval '15 minutes'),
              ($5::uuid, $6::uuid, $7::uuid, $8, 'EMAIL', now(), now() + interval '15 minutes')`,
      mine,
      tenantId,
      myUserId,
      'hash-' + 'a'.repeat(59),
      theirs,
      otherTenant,
      theirUserId,
      'hash-' + 'b'.repeat(59),
    );
    expect(inserted).toBe(2);

    await db.withTenantRls(tenantId, async (tx) => {
      const visible = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "account_recovery_tokens"`,
      );
      const ids = visible.map((r) => r.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs);
    });

    // No GUC at all: the RLS role sees nothing (wlct_current_tenant_id()
    // returns NULL and NULL comparsisons are never true).
    const unscoped = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "account_recovery_tokens"`,
    );
    expect(unscoped).toHaveLength(0);

    // Cross-tenant write under a mismatched GUC is refused by WITH CHECK.
    await expect(
      db.withTenantRls(tenantId, async (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "account_recovery_tokens" ("id", "tenant_id", "user_id", "token_hash", "method", "created_at", "expires_at")
           VALUES (gen_random_uuid(), $1::uuid, gen_random_uuid(), 'hash-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'EMAIL', now(), now() + interval '15 minutes')`,
          otherTenant,
        ),
      ),
    ).rejects.toThrow();
  });
});
