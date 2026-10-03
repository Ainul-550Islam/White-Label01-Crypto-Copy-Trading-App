import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { Prisma } from '@prisma/client';

// Loaded with Node's own require so ts-jest does not try to transform the plain-JS CI script.
const nodeRequire = createRequire(__filename);
const { scan } = nodeRequire('../../../scripts/check-prisma-literals') as {
  scan: (dir: string, dmmf: unknown) => string[];
};

const SRC_DIR = path.resolve(__dirname, '..', '..');

function scanSnippet(source: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-literals-'));
  try {
    fs.writeFileSync(path.join(dir, 'fixture.service.ts'), source);
    return scan(dir, Prisma.dmmf);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-prisma-literals', () => {
  it('finds no unknown fields, missing required fields or invalid enum values in src', () => {
    expect(scan(SRC_DIR, Prisma.dmmf)).toEqual([]);
  });

  it('reports unknown data and where keys', () => {
    const findings = scanSnippet(`
      export async function run(prisma: any) {
        await prisma.custodySweep.update({ where: { id: 'x' }, data: { settledAt: new Date(), settlementReference: 'ref' } });
        await prisma.operationalMaintenanceWindow.findFirst({ where: { status: 'ACTIVE' } });
      }
    `);
    expect(findings).toEqual([
      'fixture.service.ts:3 CustodySweep.update data.settlementReference',
      'fixture.service.ts:4 OperationalMaintenanceWindow.findFirst where.status',
    ]);
  });

  it('reports missing required fields on create', () => {
    const findings = scanSnippet(`
      export async function run(prisma: any, tenantId: string) {
        await prisma.portfolioAccountingClose.create({ data: { tenantId, periodId: 'p', idempotencyKey: 'k' } });
      }
    `);
    expect(findings).toEqual([
      'fixture.service.ts:3 PortfolioAccountingClose.create MISSING.calculationVersion',
      'fixture.service.ts:3 PortfolioAccountingClose.create MISSING.policyVersion',
    ]);
  });

  it('reports enum literals that are not enum values (direct, cast, conditional, in-filter)', () => {
    const findings = scanSnippet(`
      export async function run(prisma: any, tenantId: string, ok: boolean) {
        await prisma.custodySweep.update({ where: { id: 'x' }, data: { state: 'SETTLING' as any } });
        await prisma.custodySweep.update({ where: { id: 'x' }, data: { state: ok ? 'SETTLED' : 'BROKEN' } });
        await prisma.operationalMaintenanceWindow.findFirst({ where: { tenantId, state: 'ACTIVE', scope: { in: ['PLATFORM', 'TREASURY'] } } });
      }
    `);
    expect(findings).toEqual([
      'fixture.service.ts:3 CustodySweep.update ENUM.state=SETTLING',
      'fixture.service.ts:4 CustodySweep.update ENUM.state=BROKEN',
      'fixture.service.ts:5 OperationalMaintenanceWindow.findFirst ENUM.scope=TREASURY',
    ]);
  });

  it('checks keys inside conditional spreads', () => {
    const findings = scanSnippet(`
      export async function run(prisma: any, tenantId: string, accountId?: string) {
        await prisma.omsReconciliation.findMany({ where: { tenantId, ...(accountId ? { accountId } : {}), resolved: false } });
        await prisma.portfolioAccountingPeriod.update({ where: { id: 'p' }, data: { ...(accountId ? { closedAt: new Date(), closedBy: accountId } : {}) } });
      }
    `);
    expect(findings).toEqual([
      'fixture.service.ts:3 OmsReconciliation.findMany where.accountId',
      'fixture.service.ts:4 PortfolioAccountingPeriod.update data.closedBy',
    ]);
  });

  it('accepts valid calls: relations, _count, compound unique selectors, relation filters and valid enums', () => {
    const findings = scanSnippet(`
      export async function run(prisma: any, tenantId: string, accountId?: string) {
        await prisma.plan.findMany({ select: { id: true, _count: { select: { features: true } } } });
        await prisma.role.findFirst({ where: { tenantId_key: { tenantId, key: 'admin' } } });
        await prisma.omsReconciliation.findMany({ where: { tenantId, ...(accountId ? { orderIntent: { is: { accountId } } } : {}) } });
        await prisma.operationalMaintenanceWindow.findFirst({
          where: { state: 'ACTIVE', OR: [{ tenantId }, { tenantId: null }], scope: { in: ['PLATFORM', 'TENANT', 'TRADING_CAPABILITY'] } },
        });
        await prisma.custodySweep.update({ where: { id: 'x' }, data: { state: 'CONFIRMING', providerReference: 'ref' } });
      }
    `);
    expect(findings).toEqual([]);
  });
});
