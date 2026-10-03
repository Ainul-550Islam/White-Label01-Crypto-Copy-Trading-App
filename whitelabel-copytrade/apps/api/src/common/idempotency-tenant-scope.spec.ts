import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

import { InMemoryPrisma } from './__fixtures__/in-memory-prisma.fixture-spec';
import { PayoutRepository } from '../modules/billing/fees/payout.repository';
import { BillingLedgerRepository } from '../modules/billing/finance/billing-ledger.repository';
import { NotificationJobRepository } from '../modules/billing/notifications/notification-job.repository';
import { UsageEventRepository } from '../modules/billing/usage/usage-event.repository';
import { ComplianceCaseRepository } from '../modules/compliance/compliance-case.repository';
import { ClientProfileRepository } from '../modules/client-lifecycle/client-profile.repository';
import { CopyExecutionRepository } from '../modules/copy-trading/copy-execution.repository';
import { CopySubscriptionRepository } from '../modules/copy-trading/copy-subscription.repository';
import { WalletRepository } from '../modules/custody/wallet.repository';
import { AccountingEventRepository } from '../modules/portfolio-accounting/accounting-event.repository';

/**
 * Idempotency keys are scoped to the tenant (round 7, migration
 * 20260924000000_per_tenant_idempotency_keys):
 *
 *  1. behaviour - a key that tenant A already used, replayed by tenant B,
 *     creates tenant B's own row; it never returns (or mutates) tenant A's row,
 *     and it no longer fails on a platform-wide unique index. A replay by the
 *     same tenant still returns that tenant's original row.
 *  2. guard - every Prisma lookup in apps/api/src whose `where` uses an
 *     idempotency key carries `tenantId` as a TOP-LEVEL condition (inside an
 *     `OR` branch it would not scope the other branches), except the
 *     documented platform-level lookups;
 *  3. guard - schema.prisma has no field-level `idempotencyKey @unique` on a
 *     model whose tenantId is non-null; those models carry
 *     `@@unique([tenantId, idempotencyKey])`.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PER_TENANT = ['tenantId', 'idempotencyKey'];

interface ScopeCase {
  name: string;
  delegate: string;
  create: (prisma: any, tenantId: string, idempotencyKey: string, variant: string) => Promise<unknown>;
}

const CASES: ScopeCase[] = [
  {
    name: 'billing PayoutRepository.create',
    delegate: 'payout',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new PayoutRepository(prisma).create({
        settlementId: `settlement-${variant}`,
        beneficiaryId: `beneficiary-${variant}`,
        beneficiaryType: 'TRADER' as any,
        tenantId,
        amount: '10.00',
        currency: 'USD',
        destination: { type: 'BANK', reference: `dest-${variant}` } as any,
        provider: 'MANUAL' as any,
        status: 'PENDING' as any,
        idempotencyKey,
      }),
  },
  {
    name: 'billing BillingLedgerRepository.createEntry',
    delegate: 'billingLedgerEntry',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new BillingLedgerRepository(prisma).createEntry({
        tenantId,
        accountCategory: 'REVENUE' as any,
        entryType: 'CREDIT' as any,
        amount: { amount: '5.00', currency: 'USD' } as any,
        sourceType: 'INVOICE' as any,
        sourceId: `source-${variant}`,
        idempotencyKey,
        description: `entry ${variant}`,
      }),
  },
  {
    name: 'billing NotificationJobRepository.create',
    delegate: 'billingNotificationJob',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new NotificationJobRepository(prisma).create({
        tenantId,
        recipient: { email: `${variant}@demo.test` },
        eventKey: 'INVOICE_ISSUED' as any,
        channel: 'EMAIL' as any,
        templateKey: 'invoice-issued',
        locale: 'en',
        priority: 'NORMAL' as any,
        category: 'BILLING' as any,
        deliveryStatus: 'PENDING' as any,
        maxAttempts: 3,
        idempotencyKey,
        safePayload: {},
      }),
  },
  {
    name: 'billing UsageEventRepository.create',
    delegate: 'usageEvent',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new UsageEventRepository(prisma).create({
        tenantId,
        meterKey: 'api_calls' as any,
        scope: 'TENANT' as any,
        quantity: 1,
        unit: 'COUNT' as any,
        sourceType: 'test',
        sourceId: `source-${variant}`,
        sourceEventId: `event-${variant}`,
        periodId: '2026-10',
        periodType: 'MONTHLY' as any,
        periodStart: new Date('2026-10-01T00:00:00Z'),
        periodEnd: new Date('2026-11-01T00:00:00Z'),
        timestamp: new Date('2026-10-02T00:00:00Z'),
        idempotencyKey,
        processingState: 'PENDING' as any,
        dimensions: {},
      }),
  },
  {
    name: 'compliance ComplianceCaseRepository.createCase',
    delegate: 'complianceCase',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new ComplianceCaseRepository(prisma).createCase({
        tenantId,
        userId: `user-${variant}`,
        caseType: 'AML_REVIEW' as any,
        safeSummary: `case ${variant}`,
        idempotencyKey,
      }),
  },
  {
    name: 'client-lifecycle ClientProfileRepository.createProfile',
    delegate: 'clientProfile',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new ClientProfileRepository(prisma).createProfile({ tenantId, displayName: `client ${variant}`, idempotencyKey }),
  },
  {
    name: 'copy-trading CopySubscriptionRepository.create',
    delegate: 'copySubscription',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new CopySubscriptionRepository(prisma).create({
        tenantId,
        followerId: `follower-${variant}`,
        traderId: `trader-${variant}`,
        strategyId: `strategy-${variant}`,
        allocationMode: 'FIXED_AMOUNT' as any,
        allocationAmount: '100',
        idempotencyKey,
      }),
  },
  {
    name: 'copy-trading CopyExecutionRepository.create',
    delegate: 'copyExecution',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new CopyExecutionRepository(prisma).create({
        tenantId,
        leaderEventId: `leader-event-${variant}`,
        subscriptionId: `subscription-${variant}`,
        followerId: `follower-${variant}`,
        traderId: `trader-${variant}`,
        sizingMode: 'FIXED_AMOUNT' as any,
        leaderQuantity: '1',
        idempotencyKey,
      }),
  },
  {
    name: 'custody WalletRepository.createWallet',
    delegate: 'custodyWallet',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new WalletRepository(prisma).createWallet({ tenantId, assetId: `asset-${variant}`, networkId: `network-${variant}`, idempotencyKey }),
  },
  {
    name: 'portfolio-accounting AccountingEventRepository.createEvent',
    delegate: 'portfolioAccountingEvent',
    create: (prisma, tenantId, idempotencyKey, variant) =>
      new AccountingEventRepository(prisma).createEvent({
        tenantId,
        profileId: `profile-${variant}`,
        eventType: 'TRADE',
        sourceType: 'fill',
        sourceId: `fill-${variant}`,
        sourceTimestamp: new Date('2026-10-02T00:00:00Z'),
        calculationVersion: 'v1',
        policyVersion: 'v1',
        idempotencyKey,
      }),
  },
];

describe('idempotency keys are tenant-scoped', () => {
  describe.each(CASES)('$name', ({ delegate, create }) => {
    let prisma: any;

    beforeEach(() => {
      prisma = new InMemoryPrisma({ [delegate]: [PER_TENANT] });
    });

    it("creates tenant B's own row for a key tenant A already used, leaving tenant A's row untouched", async () => {
      await create(prisma, TENANT_A, 'k-shared', 'a');
      const rowA = { ...prisma.rows(delegate)[0] };
      expect(rowA).toMatchObject({ tenantId: TENANT_A, idempotencyKey: 'k-shared' });

      await create(prisma, TENANT_B, 'k-shared', 'b');

      const rows = prisma.rows(delegate);
      expect(rows).toHaveLength(2);
      const rowB = rows.find((row: any) => row.tenantId === TENANT_B);
      expect(rowB).toMatchObject({ tenantId: TENANT_B, idempotencyKey: 'k-shared' });
      expect(rowB.id).not.toBe(rowA.id);
      expect(rows.find((row: any) => row.id === rowA.id)).toEqual(rowA);
    });

    it("replays the same tenant's original row for its own repeated key", async () => {
      await create(prisma, TENANT_A, 'k-shared', 'a');
      await create(prisma, TENANT_B, 'k-shared', 'b');
      const rowA = prisma.rows(delegate).find((row: any) => row.tenantId === TENANT_A);

      await create(prisma, TENANT_A, 'k-shared', 'a');

      expect(prisma.rows(delegate)).toHaveLength(2);
      expect(prisma.rows(delegate).filter((row: any) => row.tenantId === TENANT_A)).toEqual([rowA]);
    });
  });
});

describe('CopySubscriptionRepository replay vs duplicate-active rule', () => {
  const input = (idempotencyKey: string) => ({
    tenantId: TENANT_A,
    followerId: 'follower-1',
    traderId: 'trader-1',
    strategyId: 'strategy-1',
    allocationMode: 'FIXED_AMOUNT' as any,
    allocationAmount: '100',
    idempotencyKey,
  });

  it('replays the original for a retry with the same key, but still refuses a second active subscription under a new key', async () => {
    const prisma: any = new InMemoryPrisma({ copySubscription: [PER_TENANT] });
    const repo = new CopySubscriptionRepository(prisma);
    const first = await repo.create(input('k-1'));

    await expect(repo.create(input('k-1'))).resolves.toMatchObject({ id: first.id });
    await expect(repo.create(input('k-2'))).rejects.toThrow(/Duplicate active subscription/);
    expect(prisma.rows('copySubscription')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Static guards
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..', '..');
const SRC = join(API_ROOT, 'src');

/**
 * Lookups that are legitimately key-only, with the reason. Anything else that
 * filters by an idempotency key without a top-level tenantId fails the guard.
 */
const PLATFORM_LEVEL_LOOKUPS: Record<string, string> = {
  'modules/billing/saas-admin/tenant-provisioning.service.ts:tenant':
    'the tenants table itself: provisioning runs before the tenant exists, the key lives in tenant.metadata',
};

const CALL = /(?:prisma|tx|client|this\.db|db)(?:\s+as\s+any\))?\??\.\s*(\w+)\??\.(findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|findMany|upsert|update|updateMany|delete|deleteMany|count)\s*\(/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('spec.ts')) out.push(path);
  }
  return out;
}

function balanced(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** The keys written at the top level of an object literal (`{ a, b: 1, ...c }` -> a, b). */
function topLevelKeys(objectText: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let token = '';
  for (let i = 0; i < objectText.length; i++) {
    const ch = objectText[i];
    if ('{[('.includes(ch)) {
      depth++;
      if (depth > 1) token = '';
      continue;
    }
    if ('}])'.includes(ch)) {
      if (depth === 1 && token.trim()) keys.push(token.trim());
      depth--;
      token = '';
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ':' || ch === ',') {
      if (token.trim()) keys.push(token.trim());
      token = '';
      if (ch === ':') {
        // skip the value up to the next top-level comma
        let d = 0;
        let j = i + 1;
        for (; j < objectText.length; j++) {
          const c = objectText[j];
          if ('{[('.includes(c)) d++;
          else if ('}])'.includes(c)) {
            if (d === 0) break;
            d--;
          } else if (c === ',' && d === 0) break;
        }
        i = j - 1;
      }
      continue;
    }
    token += ch;
  }
  return keys.map((key) => key.replace(/^\.\.\./, '').replace(/['"]/g, '')).filter((key) => /^\w+$/.test(key));
}

interface Lookup {
  file: string;
  line: number;
  model: string;
  method: string;
  scoped: boolean;
}

function idempotencyLookups(): Lookup[] {
  const lookups: Lookup[] = [];
  for (const path of sourceFiles(SRC)) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(CALL)) {
      const argStart = (match.index ?? 0) + match[0].length - 1;
      const args = text.slice(argStart, balanced(text, argStart, '(', ')') + 1);
      const where = /where\s*:\s*\{/.exec(args);
      if (!where) continue;
      const objectStart = where.index + where[0].length - 1;
      const objectText = args.slice(objectStart, balanced(args, objectStart, '{', '}') + 1);
      if (!/idempotencyKey/.test(objectText)) continue;
      lookups.push({
        file: relative(SRC, path).split('\\').join('/'),
        line: text.slice(0, match.index).split('\n').length,
        model: match[1],
        method: match[2],
        scoped: topLevelKeys(objectText).includes('tenantId'),
      });
    }
  }
  return lookups;
}

describe('idempotency tenant-scope guards', () => {
  it('finds the idempotency lookups at all (the scanner is not silently blind)', () => {
    const lookups = idempotencyLookups();
    expect(lookups.length).toBeGreaterThanOrEqual(80);
    expect(lookups.some((l) => l.model === 'payout')).toBe(true);
    expect(lookups.some((l) => l.model === 'mobileBuild')).toBe(true);
  });

  it('topLevelKeys sees an OR-nested tenantId as NOT scoping the lookup', () => {
    expect(topLevelKeys('{ OR: [{ idempotencyKey }, { snapshotId, tenantId }] }')).toEqual(['OR']);
    expect(topLevelKeys('{ tenantId, OR: [{ idempotencyKey }, { snapshotId }] }')).toEqual(['tenantId', 'OR']);
    expect(topLevelKeys('{ tenantId: params.tenantId ?? null, idempotencyKey }')).toEqual(['tenantId', 'idempotencyKey']);
    expect(topLevelKeys("{ metadata: { path: ['a'], equals: x } }")).toEqual(['metadata']);
  });

  it('every idempotency lookup carries a top-level tenantId, except the documented platform-level ones', () => {
    const unscoped = idempotencyLookups()
      .filter((lookup) => !lookup.scoped)
      .filter((lookup) => !PLATFORM_LEVEL_LOOKUPS[`${lookup.file}:${lookup.model}`])
      .map((lookup) => `${lookup.file}:${lookup.line} ${lookup.model}.${lookup.method}`);
    expect(unscoped).toEqual([]);
  });

  it('no idempotency lookup still uses findUnique on the key alone', () => {
    const keyOnlyUnique = idempotencyLookups().filter((lookup) => /^findUnique/.test(lookup.method));
    expect(keyOnlyUnique).toEqual([]);
  });

  it('schema: tenant-owned models carry @@unique([tenantId, idempotencyKey]) instead of a global key unique', () => {
    const schema = readFileSync(join(API_ROOT, 'prisma', 'schema.prisma'), 'utf8');
    const offenders: string[] = [];
    let perTenant = 0;
    for (const model of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
      const [, name, body] = model;
      const idem = /^\s+idempotencyKey\s+[^\n]*$/m.exec(body)?.[0];
      const tenant = /^\s+tenantId\s+String(\??)/m.exec(body);
      if (!idem || !tenant || tenant[1] === '?') continue;
      if (/\s@unique\b/.test(idem)) offenders.push(`${name}: field-level @unique on idempotencyKey`);
      if (/@@unique\(\[tenantId, idempotencyKey\]\)/.test(body)) perTenant++;
    }
    expect(offenders).toEqual([]);
    expect(perTenant).toBe(68);
  });

  it('the migration that moves the indexes exists and only swaps indexes', () => {
    const sql = readFileSync(
      join(API_ROOT, 'prisma', 'migrations', '20260924000000_per_tenant_idempotency_keys', 'migration.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const drops = statements.filter((statement) => /^DROP INDEX "\w+_idempotency_key_key"$/.test(statement));
    const creates = statements.filter((statement) =>
      /^CREATE UNIQUE INDEX "\w+" ON "\w+"\("tenant_id", "idempotency_key"\)$/.test(statement),
    );
    expect(drops).toHaveLength(68);
    expect(creates).toHaveLength(68);
    expect(statements).toHaveLength(136);
  });
});
