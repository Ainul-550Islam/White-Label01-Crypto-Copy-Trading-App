import { Prisma } from '@prisma/client';
import { StatementService, sumLedgerAmounts } from './statement.service';
import { ReportExportService } from './report-export.service';
import { validateDeveloperEventPayload } from '../developer-platform/event-schemas/developer-event-schemas';

/**
 * The statement is written with an untyped Prisma client, so nothing but this
 * spec ties the payload to the schema. Prisma rejects unknown fields and
 * missing required columns at runtime; the previous payload did both and every
 * statement generation failed.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const PROFILE = '33333333-3333-4333-8333-333333333333';
const PERIOD = '44444444-4444-4444-8444-444444444444';

const statementModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'PortfolioStatement');

function buildService(created: { data?: any }) {
  const tx: any = {
    portfolioStatement: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        created.data = data;
        return { id: 'row-1', ...data };
      }),
    },
  };
  const prisma: any = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    portfolioStatement: tx.portfolioStatement,
    portfolioSnapshot: {
      findFirst: jest.fn(async () => ({ id: 'snap-1', nav: '1000.5', cash: '120.25', sourceReferences: ['ledger:1'], dataCompleteness: 'COMPLETE' })),
    },
    portfolioAccountingReconciliation: { findFirst: jest.fn(async () => ({ state: 'MATCHED' })) },
  };
  const periodService: any = {
    getPeriod: jest.fn(async () => ({
      id: PERIOD,
      profileId: PROFILE,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T23:59:59Z'),
      periodType: 'MONTHLY',
      baseCurrency: 'USD',
    })),
  };
  const policyService: any = {
    resolvePolicy: jest.fn(async () => ({ returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'calc-1', policyVersion: 'policy-1' })),
  };
  const cashLedger: any = {
    listCashEntries: jest.fn(async () => ({
      data: [
        { cashFlowType: 'DEPOSIT', amount: '500.10', currency: 'USD', occurredAt: new Date('2026-08-02') },
        { cashFlowType: 'DEPOSIT', amount: '0.20', currency: 'USD', occurredAt: new Date('2026-08-03') },
        { cashFlowType: 'WITHDRAWAL', amount: '50', currency: 'USD', occurredAt: new Date('2026-08-10') },
        { cashFlowType: 'TRANSFER_IN', amount: '30', currency: 'USD', occurredAt: new Date('2026-08-11') },
        { cashFlowType: 'TRANSFER_OUT', amount: '12.5', currency: 'USD', occurredAt: new Date('2026-08-12') },
        { cashFlowType: 'TRADE_SETTLEMENT_BUY', amount: '100', currency: 'USD', occurredAt: new Date('2026-08-13') },
      ],
      total: 6,
    })),
  };
  const positionAccounting: any = {
    getHoldings: jest.fn(async () => [{ symbol: 'BTCUSDT', asset: 'BTC', quantity: '0.01', classification: 'SPOT', costBasis: '600' }]),
  };
  const pnlService: any = {
    calculateNetPnl: jest.fn(async () => ({ netPnl: '41.5', grossPnl: '43', fees: '1.5', evidence: { gross: { realized: '20', unrealized: '23' } } })),
  };
  const performanceService: any = {
    calculateTWR: jest.fn(async () => ({ returnPercent: '4.1', canCalculate: true, evidence: {} })),
    calculateMWR: jest.fn(async () => ({ returnPercent: '3.9', canCalculate: true, evidence: {} })),
  };
  const snapshotService: any = {};
  const outbox = {
    append: jest.fn(async (_transaction: unknown, _input: Record<string, unknown>) => undefined),
  };
  const service = new StatementService(
    prisma,
    policyService,
    periodService,
    snapshotService,
    pnlService,
    performanceService,
    cashLedger,
    positionAccounting,
    outbox as never,
  );
  return { service, prisma, tx, outbox };
}

describe('Statement persistence matches the PortfolioStatement model', () => {
  it('finds the model in the generated client', () => {
    expect(statementModel).toBeDefined();
  });

  it('writes statement.generated in the same tenant transaction with the generated artifact identity', async () => {
    const created: { data?: any } = {};
    const { service, prisma, tx, outbox } = buildService(created);
    const statement = await service.generateStatement({ tenantId: TENANT, profileId: PROFILE, periodId: PERIOD, operatorId: 'admin-1' });

    expect(prisma.withTenantRls).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(tx, expect.objectContaining({
      tenantId: TENANT,
      aggregateType: 'statement',
      aggregateId: 'row-1',
      eventType: 'statement.generated',
      payload: expect.objectContaining({
        statementId: statement.statementId,
        generatedAt: expect.any(String),
      }),
    }));
    const event = outbox.append.mock.calls[0]?.[1];
    expect(validateDeveloperEventPayload('statement.generated', event?.payload)).toEqual({ valid: true, errors: [] });
  });

  it('writes only model columns, with every required column and the right scalar types', async () => {
    const created: { data?: any } = {};
    const { service } = buildService(created);
    await service.generateStatement({ tenantId: TENANT, profileId: PROFILE, periodId: PERIOD, operatorId: 'admin-1' });

    const data = created.data;
    expect(data).toBeDefined();
    const fields = new Map(statementModel!.fields.map((f) => [f.name, f]));

    const unknown = Object.keys(data).filter((key) => !fields.has(key) || fields.get(key)!.kind === 'object');
    expect(unknown).toEqual([]);

    const required = statementModel!.fields
      .filter((f) => f.kind !== 'object' && f.isRequired && !f.hasDefaultValue && !f.isUpdatedAt)
      .map((f) => f.name);
    const missing = required.filter((name) => data[name] === undefined || data[name] === null);
    expect(missing).toEqual([]);

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;
      const field = fields.get(key)!;
      if (field.kind === 'scalar' && field.type === 'String') expect({ key, type: typeof value }).toEqual({ key, type: 'string' });
      if (field.kind === 'scalar' && field.type === 'DateTime') expect({ key, isDate: value instanceof Date }).toEqual({ key, isDate: true });
    }
  });

  it('stores decimal-exact totals and keeps the line items and evidence', async () => {
    const created: { data?: any } = {};
    const { service } = buildService(created);
    await service.generateStatement({ tenantId: TENANT, profileId: PROFILE, periodId: PERIOD, operatorId: 'admin-1' });
    const data = created.data;
    expect(data.deposits).toBe('500.3');
    expect(data.withdrawals).toBe('50');
    expect(data.transfers).toBe('17.5');
    expect(data.returnPercent).toBe('4.1');
    expect(data.cash).toBe('120.25');
    expect(data.fees).toEqual({ total: '1.5', grossPnl: '43' });
    expect(data.endingHoldings).toHaveLength(1);
    expect(data.tradingActivity.count).toBe(1);
    expect(data.tradingActivity.deposits).toHaveLength(2);
    expect(data.evidence.dataCompleteness).toBe('COMPLETE');
    expect(data.evidence.createdBy).toBe('admin-1');
  });

  it('sums ledger amounts without float error and skips non-decimal values', () => {
    expect(sumLedgerAmounts([{ amount: '0.1' }, { amount: '0.2' }])).toBe('0.3');
    expect(sumLedgerAmounts([{ amount: '10' }, { amount: '2.5', type: 'TRANSFER_OUT' }])).toBe('7.5');
    expect(sumLedgerAmounts([{ amount: 'abc' }, { amount: null }, { amount: '1' }])).toBe('1');
  });

  it('exports a CSV row with one value per header, in header order', async () => {
    const statement = {
      statementId: 'stmt-1',
      profileId: PROFILE,
      periodId: PERIOD,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T23:59:59Z'),
      openingNav: '1000',
      closingNav: '1041.5',
      realizedPnl: '20',
      unrealizedPnl: '23',
      fees: { total: '1.5', grossPnl: '43' },
      netPnl: '41.5',
      baseCurrency: 'USD',
      returnMethodology: 'TIME_WEIGHTED_RETURN',
      calculationVersion: 'calc-1',
      policyVersion: 'policy-1',
      evidence: { dataCompleteness: 'COMPLETE' },
    };
    const exporter = new ReportExportService({} as any, { getStatement: jest.fn(async () => statement) } as any, {} as any);
    const { csv } = await exporter.exportStatementCsv({ tenantId: TENANT, statementId: 'stmt-1' });
    const [headerLine, rowLine] = csv.split('\n');
    const headers = headerLine!.split(',');
    const values = rowLine!.split('","').map((v) => v.replace(/^"|"$/g, ''));
    expect(values).toHaveLength(headers.length);
    const byHeader = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    expect(byHeader).toMatchObject({
      portfolioId: PROFILE,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T23:59:59.000Z',
      openingNav: '1000',
      closingNav: '1041.5',
      grossPnl: '43',
      fees: '1.5',
      netPnl: '41.5',
      dataCompleteness: 'COMPLETE',
    });
  });
});
