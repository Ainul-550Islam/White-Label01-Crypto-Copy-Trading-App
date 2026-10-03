import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { FeeAccrualRepository } from '../../modules/billing/fees/fee-accrual.repository';
import { FeeSettlementRepository } from '../../modules/billing/fees/fee-settlement.repository';
import { PayoutRepository } from '../../modules/billing/fees/payout.repository';
import { UsageEventRepository } from '../../modules/billing/usage/usage-event.repository';
import { PaymentRepository } from '../../modules/billing/payments/payment.repository';
import { InvoiceRepository } from '../../modules/billing/finance/invoice.repository';
import { AccountingAdjustmentService } from '../../modules/portfolio-accounting/accounting-adjustment.service';
import { AccountingReconciliationService } from '../../modules/portfolio-accounting/accounting-reconciliation.service';
import { AttributionService } from '../../modules/portfolio-accounting/attribution.service';
import { AccountingPeriodService } from '../../modules/portfolio-accounting/accounting-period.service';
import { PortfolioSnapshotService } from '../../modules/portfolio-accounting/portfolio-snapshot.service';
import { PeriodCloseService } from '../../modules/portfolio-accounting/period-close.service';
import { CustodyReconciliationService } from '../../modules/custody/custody-reconciliation.service';
import { CopyReconciliationService } from '../../modules/copy-trading/copy-reconciliation.service';
import { TransactionMonitoringService } from '../../modules/compliance/transaction-monitoring.service';
import { LifecycleNotificationService } from '../../modules/client-lifecycle/lifecycle-notification.service';

/**
 * Persistence contract: the services below call Prisma through `(prisma as any)`,
 * so the compiler cannot check their writes. This fake Prisma client validates
 * every create/update against the generated DMMF the way the real client does
 * (unknown argument, missing required argument, wrong scalar type, invalid enum
 * value, plain null for a Json column) and keeps rows in memory so the services'
 * read paths run against what was actually written.
 */

type Row = Record<string, any>;
type DmmfField = (typeof Prisma.dmmf.datamodel.models)[number]['fields'][number];

const MODELS = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name.charAt(0).toLowerCase() + model.name.slice(1),
    { name: model.name, fields: new Map(model.fields.map((f) => [f.name, f])) },
  ]),
);
const ENUMS = new Map(
  Prisma.dmmf.datamodel.enums.map((e) => [e.name, new Set(e.values.map((v) => v.name))]),
);
const UPDATE_OPERATORS = new Set([
  'set',
  'increment',
  'decrement',
  'multiply',
  'divide',
  'push',
  'unset',
]);

class PrismaValidationError extends Error {}

function isPlainObject(value: unknown): value is Record<string, any> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function checkScalar(model: string, field: DmmfField, value: unknown): void {
  const where = `${model}.${field.name}`;
  if (field.isList) {
    if (!Array.isArray(value))
      throw new PrismaValidationError(`${where}: expected a list, got ${typeof value}`);
    for (const item of value) checkScalar(model, { ...field, isList: false } as DmmfField, item);
    return;
  }
  if (field.kind === 'enum') {
    const allowed = ENUMS.get(field.type);
    if (typeof value !== 'string' || !allowed?.has(value))
      throw new PrismaValidationError(
        `${where}: invalid enum value ${JSON.stringify(value)} for ${field.type}`,
      );
    return;
  }
  switch (field.type) {
    case 'String':
      if (typeof value !== 'string')
        throw new PrismaValidationError(
          `${where}: expected String, got ${Array.isArray(value) ? 'array' : typeof value}`,
        );
      return;
    case 'Int':
      if (typeof value !== 'number' || !Number.isInteger(value))
        throw new PrismaValidationError(`${where}: expected Int, got ${JSON.stringify(value)}`);
      return;
    case 'Float':
    case 'Decimal':
      if (typeof value !== 'number' && typeof value !== 'string')
        throw new PrismaValidationError(`${where}: expected ${field.type}`);
      return;
    case 'BigInt':
      if (typeof value !== 'bigint' && typeof value !== 'number')
        throw new PrismaValidationError(`${where}: expected BigInt`);
      return;
    case 'Boolean':
      if (typeof value !== 'boolean')
        throw new PrismaValidationError(`${where}: expected Boolean, got ${typeof value}`);
      return;
    case 'DateTime':
      if (
        !(value instanceof Date) &&
        !(typeof value === 'string' && !Number.isNaN(Date.parse(value)))
      )
        throw new PrismaValidationError(`${where}: expected DateTime`);
      return;
    case 'Json':
      return;
    default:
      return;
  }
}

function validateWrite(delegate: string, data: Row, mode: 'create' | 'update'): void {
  const model = MODELS.get(delegate)!;
  if (!isPlainObject(data))
    throw new PrismaValidationError(`${model.name}.${mode}: data must be an object`);
  for (const [key, value] of Object.entries(data)) {
    const field = model.fields.get(key);
    if (!field)
      throw new PrismaValidationError(`${model.name}.${mode}: Unknown argument \`${key}\``);
    if (value === undefined || field.kind === 'object') continue;
    if (value === Prisma.DbNull || value === Prisma.JsonNull) {
      if (field.type !== 'Json' || field.isRequired)
        throw new PrismaValidationError(
          `${model.name}.${key}: DbNull/JsonNull only valid for optional Json`,
        );
      continue;
    }
    if (value === null) {
      if (field.type === 'Json')
        throw new PrismaValidationError(
          `${model.name}.${key}: null is not valid for a Json column (use Prisma.DbNull)`,
        );
      if (field.isRequired)
        throw new PrismaValidationError(`${model.name}.${key}: required, got null`);
      continue;
    }
    if (
      mode === 'update' &&
      field.type !== 'Json' &&
      isPlainObject(value) &&
      Object.keys(value).every((k) => UPDATE_OPERATORS.has(k))
    )
      continue;
    checkScalar(model.name, field, value);
  }
  if (mode === 'create') {
    const satisfied = new Set<string>();
    for (const field of model.fields.values()) {
      if (field.kind === 'object' && data[field.name] !== undefined)
        for (const fk of field.relationFromFields ?? []) satisfied.add(fk);
    }
    for (const field of model.fields.values()) {
      if (
        field.kind === 'object' ||
        !field.isRequired ||
        field.hasDefaultValue ||
        field.isUpdatedAt
      )
        continue;
      if (
        (data[field.name] === undefined || data[field.name] === null) &&
        !satisfied.has(field.name)
      ) {
        throw new PrismaValidationError(
          `${model.name}.create: Argument \`${field.name}\` is missing`,
        );
      }
    }
  }
}

function applyDefaults(delegate: string, data: Row): Row {
  const model = MODELS.get(delegate)!;
  const row: Row = {};
  for (const field of model.fields.values()) {
    if (field.kind === 'object') continue;
    if (data[field.name] !== undefined) continue;
    if (field.isUpdatedAt) row[field.name] = new Date();
    else if (field.hasDefaultValue) {
      const def: any = field.default;
      if (def && typeof def === 'object' && 'name' in def) {
        // DMMF names look like 'now', 'uuid(4)', 'cuid', 'dbgenerated'.
        if (def.name === 'now') row[field.name] = new Date();
        else if (/^(uuid|cuid|dbgenerated)/.test(def.name) && field.type === 'String')
          row[field.name] = randomUUID();
      } else if (field.type === 'Json' && typeof def === 'string')
        row[field.name] = JSON.parse(def);
      else if (def !== undefined) row[field.name] = def;
    } else row[field.name] = null;
  }
  for (const [key, value] of Object.entries(data)) {
    const field = model.fields.get(key);
    if (!field || field.kind === 'object') continue;
    row[key] =
      value === Prisma.DbNull || value === Prisma.JsonNull
        ? null
        : field.type === 'DateTime' && typeof value === 'string'
          ? new Date(value)
          : value;
  }
  return row;
}

function toComparable(value: any): any {
  return value instanceof Date ? value.getTime() : value;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === 'AND') {
      if (!(Array.isArray(condition) ? condition : [condition]).every((c) => matches(row, c)))
        return false;
      continue;
    }
    if (key === 'OR') {
      if (!(condition as Row[]).some((c) => matches(row, c))) return false;
      continue;
    }
    if (key === 'NOT') {
      if ((Array.isArray(condition) ? condition : [condition]).some((c) => matches(row, c)))
        return false;
      continue;
    }
    if (!(key in row)) continue; // relation or JSON-path filter: not modelled
    const value = row[key];
    if (isPlainObject(condition)) {
      if ('path' in condition) continue;
      if ('equals' in condition && toComparable(value) !== toComparable(condition.equals))
        return false;
      if (
        'in' in condition &&
        !(condition.in as any[]).map(toComparable).includes(toComparable(value))
      )
        return false;
      if (
        'notIn' in condition &&
        (condition.notIn as any[]).map(toComparable).includes(toComparable(value))
      )
        return false;
      if ('not' in condition && toComparable(value) === toComparable(condition.not)) return false;
      if ('lt' in condition && !(toComparable(value) < toComparable(condition.lt))) return false;
      if ('lte' in condition && !(toComparable(value) <= toComparable(condition.lte))) return false;
      if ('gt' in condition && !(toComparable(value) > toComparable(condition.gt))) return false;
      if ('gte' in condition && !(toComparable(value) >= toComparable(condition.gte))) return false;
      continue;
    }
    if (toComparable(value) !== toComparable(condition)) return false;
  }
  return true;
}

class FakePrisma {
  readonly tables = new Map<string, Row[]>();

  constructor() {
    return new Proxy(this, {
      get: (target, prop: string) => {
        if (prop in target) return (target as any)[prop];
        if (MODELS.has(prop)) return target.delegate(prop);
        return undefined;
      },
    });
  }

  rows(delegate: string): Row[] {
    if (!this.tables.has(delegate)) this.tables.set(delegate, []);
    return this.tables.get(delegate)!;
  }

  seed(delegate: string, data: Row): Row {
    validateWrite(delegate, data, 'create');
    const row = applyDefaults(delegate, data);
    this.rows(delegate).push(row);
    return { ...row };
  }

  async $transaction(arg: any): Promise<any> {
    return typeof arg === 'function' ? arg(this) : Promise.all(arg);
  }

  private delegate(name: string) {
    const table = () => this.rows(name);
    const update = (row: Row, data: Row) => {
      validateWrite(name, data, 'update');
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        const field = MODELS.get(name)!.fields.get(key)!;
        if (field.kind === 'object') continue;
        row[key] =
          value === Prisma.DbNull || value === Prisma.JsonNull
            ? null
            : field.type === 'DateTime' && typeof value === 'string'
              ? new Date(value)
              : value;
      }
    };
    return {
      create: async ({ data }: { data: Row }) => this.seed(name, data),
      findFirst: async ({ where }: { where?: Row } = {}) => {
        const found = [...table()].reverse().find((row) => matches(row, where));
        return found ? { ...found } : null;
      },
      findUnique: async ({ where }: { where: Row }) => {
        const found = table().find((row) => matches(row, where));
        return found ? { ...found } : null;
      },
      findMany: async ({ where }: { where?: Row } = {}) =>
        table()
          .filter((row) => matches(row, where))
          .map((row) => ({ ...row })),
      count: async ({ where }: { where?: Row } = {}) =>
        table().filter((row) => matches(row, where)).length,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = table().find((r) => matches(r, where));
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        update(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
        const targets = table().filter((row) => matches(row, where));
        validateWrite(name, data, 'update');
        for (const row of targets) update(row, data);
        return { count: targets.length };
      },
      groupBy: async () => [],
      aggregate: async () => ({ _sum: {}, _count: 0 }),
    };
  }
}

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const PROFILE = randomUUID();
const OPERATOR = randomUUID();
const policy = {
  calculationVersion: 'calc-v1',
  policyVersion: 'policy-v1',
  baseCurrency: 'USD',
  feeTreatment: 'NET',
  closeRules: { allowIncompleteValuation: false },
};
const policyService = () => ({ resolvePolicy: jest.fn().mockResolvedValue(policy) }) as any;

describe('Prisma persistence contract (writes validated against the DMMF)', () => {
  let prisma: FakePrisma;

  beforeEach(() => {
    prisma = new FakePrisma();
  });

  describe('billing', () => {
    it('FeeAccrual: create writes model columns and round-trips the accrual fields', async () => {
      const repo = new FeeAccrualRepository(prisma as any);
      const accrual = await repo.create({
        tenantId: TENANT,
        sourceType: 'COPY_TRADE_PROFIT' as any,
        sourceId: 'trade-1',
        feeType: 'PERFORMANCE_FEE' as any,
        feeRateBps: 2000,
        rateBasis: 'PROFIT' as any,
        grossAmount: '100.00',
        feeAmount: '20.00',
        netAmount: '80.00',
        currency: 'USD',
        status: 'ACCRUED' as any,
        settlementState: 'UNSETTLED' as any,
        idempotencyKey: 'fee-1',
        policySnapshot: { rate: 2000 },
        calculationTimestamp: new Date('2026-09-01T00:00:00Z').toISOString(),
        metadata: { note: 'x' },
      });
      const row = prisma.rows('feeAccrual')[0];
      expect(row).toMatchObject({
        feeSourceType: 'COPY_TRADE_PROFIT',
        sourceAmount: '100.00',
        rateBps: 2000,
        rateReference: 'PROFIT',
      });
      expect(accrual).toMatchObject({
        sourceType: 'COPY_TRADE_PROFIT',
        grossAmount: '100.00',
        netAmount: '80.00',
        feeRateBps: 2000,
        metadata: { note: 'x' },
      });

      const updated = await repo.updateStatus(accrual.id, {
        payoutState: 'PENDING' as any,
        payoutId: 'payout-1',
        ledgerTransactionId: 'ledger-1',
      });
      expect(updated).toMatchObject({
        payoutState: 'PENDING',
        payoutId: 'payout-1',
        ledgerTransactionId: 'ledger-1',
        netAmount: '80.00',
      });
      expect(await repo.findBySource(TENANT, 'COPY_TRADE_PROFIT' as any, 'trade-1')).toMatchObject({
        id: accrual.id,
      });
    });

    it('FeeSettlement and Payout: create without calculatedAt/requestedAt columns and keep them readable', async () => {
      const settlements = new FeeSettlementRepository(prisma as any);
      const settlement = await settlements.createSettlement({
        tenantId: TENANT,
        currency: 'USD',
        grossFeeAmount: '20.00',
        finalSettlementAmount: '20.00',
        numberOfAccruals: 1,
        feeType: 'PERFORMANCE_FEE' as any,
        status: 'CALCULATED' as any,
        idempotencyKey: 'settle-1',
        accrualIds: ['a-1'],
        metadata: null,
      });
      expect(settlement.calculatedAt).toEqual(expect.any(String));

      const payouts = new PayoutRepository(prisma as any);
      const payout = await payouts.create({
        settlementId: settlement.id,
        beneficiaryId: randomUUID(),
        beneficiaryType: 'TRADER' as any,
        tenantId: TENANT,
        amount: '20.00',
        currency: 'USD',
        destination: { type: 'STRIPE_CONNECT', accountId: 'acct_1' } as any,
        provider: 'STRIPE_CONNECT' as any,
        status: 'PENDING' as any,
        idempotencyKey: 'payout-1',
        metadata: null,
        safeMetadata: null,
      });
      expect(payout.requestedAt).toEqual(expect.any(String));
    });

    it('UsageEvent: create stores an Int quantity and keeps the exact quantity/scope', async () => {
      const repo = new UsageEventRepository(prisma as any);
      const event = await repo.create({
        tenantId: TENANT,
        meterKey: 'API_REQUESTS' as any,
        scope: 'TENANT' as any,
        subjectId: 'user-1',
        quantity: 2.5,
        unit: 'REQUEST' as any,
        sourceType: 'api',
        sourceId: 'req-1',
        periodId: '2026-09',
        periodType: 'MONTHLY' as any,
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-10-01T00:00:00Z'),
        timestamp: new Date('2026-09-15T00:00:00Z'),
        idempotencyKey: 'usage-1',
        processingState: 'PENDING' as any,
        dimensions: { route: '/v1/x' },
      });
      expect(Number.isInteger(prisma.rows('usageEvent')[0].quantity)).toBe(true);
      expect(event).toMatchObject({ quantity: 2.5, scope: 'TENANT', subjectId: 'user-1' });
    });

    it('Payment: create writes only Payment columns', async () => {
      const repo = new PaymentRepository(prisma as any);
      const payment = await repo.create({
        tenantId: TENANT,
        planId: randomUUID(),
        currency: 'USD',
        provider: 'STRIPE' as any,
        amount: { amount: '49.00', currency: 'USD', amountInSmallestUnit: 4900 },
        references: {
          tenantId: TENANT,
          planId: randomUUID(),
          idempotencyKey: 'pay-1',
          orderId: 'order-1',
          userId: OPERATOR,
        },
        metadata: { planCode: 'pro', billingInterval: 'MONTHLY' as any },
        providerReference: {
          providerCheckoutId: 'cs_1',
          checkoutUrl: 'https://checkout.example/cs_1',
        } as any,
        idempotencyKey: 'pay-1',
      } as any);
      expect(prisma.rows('payment')).toHaveLength(1);
      expect(payment.id).toBe(prisma.rows('payment')[0].id);
    });

    it('Invoice: create persists lines as JSON plus customer and taxSummary', async () => {
      const repo = new InvoiceRepository(prisma as any);
      const invoice = await repo.create({
        tenantId: TENANT,
        currency: 'USD',
        idempotencyKey: 'inv-1',
        customer: { tenantId: TENANT, billingName: 'Acme', billingEmail: 'billing@acme.test' },
        taxSummary: [
          {
            taxType: 'VAT',
            rate: 20,
            taxableAmount: { amount: '100.00', currency: 'USD' },
            taxAmount: { amount: '20.00', currency: 'USD' },
          },
        ] as any,
        billingPeriod: {
          start: new Date('2026-09-01T00:00:00Z'),
          end: new Date('2026-10-01T00:00:00Z'),
          interval: 'MONTHLY' as any,
        },
        lines: [
          {
            type: 'SUBSCRIPTION' as any,
            description: 'Pro plan',
            quantity: 1,
            unitPrice: { amount: '100.00', currency: 'USD' },
            amount: { amount: '100.00', currency: 'USD' },
            taxRate: 20,
            taxAmount: { amount: '20.00', currency: 'USD' },
          },
        ],
      } as any);
      const row = prisma.rows('invoice')[0];
      expect(Array.isArray(row.lines)).toBe(true);
      expect(row.customer).toMatchObject({ billingName: 'Acme' });
      expect(row.taxSummary).toHaveLength(1);
      expect(invoice.id).toBe(row.id);
    });
  });

  describe('portfolio accounting', () => {
    it('adjustments: create, reverse, and event reversal use existing columns', async () => {
      const service = new AccountingAdjustmentService(prisma as any, policyService());
      const manual = await service.createAdjustment({
        tenantId: TENANT,
        profileId: PROFILE,
        adjustmentType: 'MANUAL_ADJUSTMENT' as any,
        reason: 'Opening balance correction',
        adjustedAmount: '15.5',
        operatorId: OPERATOR,
      } as any);
      expect(manual).toMatchObject({
        adjustedAmount: '15.5',
        operatorId: OPERATOR,
        isReversed: false,
      });

      const reversed = await service.reverseAdjustment({
        tenantId: TENANT,
        adjustmentId: manual.id,
        operatorId: OPERATOR,
        reason: 'Entered twice',
      });
      expect(reversed).toMatchObject({
        isReversed: true,
        reversedBy: OPERATOR,
        reversalReason: 'Entered twice',
      });
      await expect(
        service.reverseAdjustment({
          tenantId: TENANT,
          adjustmentId: manual.id,
          operatorId: OPERATOR,
          reason: 'again',
        }),
      ).rejects.toThrow('already reversed');

      const event = prisma.seed('portfolioAccountingEvent', {
        tenantId: TENANT,
        profileId: PROFILE,
        eventType: 'DEPOSIT',
        sourceType: 'FUNDING',
        sourceId: 'dep-1',
        sourceTimestamp: new Date(),
        idempotencyKey: 'evt-1',
        fingerprint: 'fp-1',
        calculationVersion: 'calc-v1',
        policyVersion: 'policy-v1',
      });
      await service.createAdjustment({
        tenantId: TENANT,
        profileId: PROFILE,
        originalEventId: event.id,
        adjustmentType: 'REVERSAL' as any,
        reason: 'Deposit bounced',
        operatorId: OPERATOR,
      } as any);
      const storedEvent = prisma.rows('portfolioAccountingEvent')[0];
      expect(storedEvent.isReversed).toBe(true);
      expect(storedEvent.metadata.reversal).toMatchObject({
        reversedBy: OPERATOR,
        reason: 'Deposit bounced',
      });
    });

    it('reconciliation and attribution persist with required columns', async () => {
      const reconciliation = new AccountingReconciliationService(prisma as any, policyService());
      jest.spyOn(reconciliation, 'reconcilePeriod').mockResolvedValue({
        hasCriticalFailure: true,
        discrepancies: [{ type: 'DUPLICATE_EVENT', severity: 'CRITICAL', details: { count: 2 } }],
      });
      const recon = await reconciliation.runReconciliation({
        tenantId: TENANT,
        profileId: PROFILE,
        scope: 'PERIOD',
        trigger: 'MANUAL',
        requestedBy: OPERATOR,
      });
      expect(prisma.rows('portfolioAccountingReconciliation')[0]).toMatchObject({
        reconciliationType: 'PERIOD',
        isCritical: true,
        summary: expect.stringContaining('DUPLICATE_EVENT'),
      });
      expect(recon).toMatchObject({
        scope: 'PERIOD',
        hasCriticalFailure: true,
        requestedBy: OPERATOR,
        discrepancies: [expect.objectContaining({ type: 'DUPLICATE_EVENT' })],
      });

      const attribution = new AttributionService(prisma as any, policyService());
      const record = await attribution.persistAttribution({
        tenantId: TENANT,
        profileId: PROFILE,
        dimension: 'ASSET' as any,
        dimensionValue: 'BTC',
        pnl: '42.1',
        percentage: '60',
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        baseCurrency: 'USD',
        calculationVersion: 'calc-v1',
        policyVersion: 'policy-v1',
        evidence: {},
      });
      expect(record).toMatchObject({ dimensionValue: 'BTC', pnl: '42.1', percentage: '60' });
    });

    function snapshotDeps() {
      return {
        nav: {
          calculateNav: jest.fn().mockResolvedValue({
            nav: '1000',
            grossAssetValue: '1000',
            grossLiability: '0',
            cash: '50',
            dataCompleteness: 'COMPLETE',
            canPublish: true,
            evidences: [],
            sourceReferences: [],
            methodology: 'MARK_TO_MARKET',
          }),
        },
        pnl: {
          calculateNetPnl: jest
            .fn()
            .mockResolvedValue({
              netPnl: '10',
              grossPnl: '12',
              fees: '2',
              evidence: { gross: { realized: '8', unrealized: '4' } },
            }),
          calculateRealizedPnl: jest.fn().mockResolvedValue({ realizedPnl: '8' }),
        },
        performance: {
          calculateTWR: jest
            .fn()
            .mockResolvedValue({
              returnPercent: '1.5',
              evidence: {
                startingNav: '985',
                endingNav: '1000',
                externalCashFlows: [],
                dataCompleteness: 'COMPLETE',
                sourceReferences: [],
              },
            }),
          persistPerformanceRecord: jest.fn().mockResolvedValue({}),
        },
        positions: { getHoldings: jest.fn().mockResolvedValue([]) },
        cash: {
          getCashBalance: jest
            .fn()
            .mockResolvedValue({
              asset: 'USD',
              balance: '50',
              currency: 'USD',
              baseCurrency: 'USD',
              baseCurrencyBalance: '50',
            }),
        },
      };
    }

    it('snapshot: fees is a decimal string and performance data is kept in performanceMetrics', async () => {
      const deps = snapshotDeps();
      const service = new PortfolioSnapshotService(
        prisma as any,
        deps.nav as any,
        deps.pnl as any,
        deps.performance as any,
        deps.positions as any,
        deps.cash as any,
        policyService(),
      );
      const snapshot = await service.createSnapshot({
        tenantId: TENANT,
        profileId: PROFILE,
        timestamp: new Date('2026-09-30T00:00:00Z'),
        baseCurrency: 'USD',
        scope: 'TENANT',
        scopeId: PROFILE,
      });
      expect(prisma.rows('portfolioSnapshot')[0].fees).toBe('2');
      expect(snapshot).toMatchObject({
        nav: '1000',
        methodology: 'MARK_TO_MARKET',
        fingerprint: expect.any(String),
      });
      expect(
        await service.verifySnapshotImmutability(snapshot.snapshotId, snapshot.fingerprint),
      ).toBe(true);
    });

    it('period close: a failed validation can be retried and the period closes with its figures', async () => {
      const deps = snapshotDeps();
      const policies = policyService();
      const periods = new AccountingPeriodService(prisma as any, policies);
      const snapshots = new PortfolioSnapshotService(
        prisma as any,
        deps.nav as any,
        deps.pnl as any,
        deps.performance as any,
        deps.positions as any,
        deps.cash as any,
        policies,
      );
      const reconciliation = {
        reconcilePeriod: jest
          .fn()
          .mockResolvedValueOnce({
            hasCriticalFailure: true,
            discrepancies: [{ type: 'DUPLICATE_EVENT', severity: 'CRITICAL', details: {} }],
          })
          .mockResolvedValue({ hasCriticalFailure: false, discrepancies: [] }),
      };
      const close = new PeriodCloseService(
        prisma as any,
        periods,
        deps.nav as any,
        deps.pnl as any,
        deps.performance as any,
        snapshots,
        reconciliation as any,
        policies,
      );

      const period = await periods.createPeriod({
        tenantId: TENANT,
        profileId: PROFILE,
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        periodType: 'MONTHLY',
      });
      expect(period.closeMetadata).toMatchObject({ periodType: 'MONTHLY' });

      await expect(
        close.initiateClose({ tenantId: TENANT, periodId: period.id, operatorId: OPERATOR }),
      ).rejects.toThrow('RECONCILIATION_NO_CRITICAL');
      expect((await periods.getPeriod({ tenantId: TENANT, periodId: period.id })).state).toBe(
        'OPEN',
      );
      expect(prisma.rows('portfolioAccountingClose')[0].failureEvidence).toMatchObject({
        state: 'FAILED',
      });

      const closed = await close.initiateClose({
        tenantId: TENANT,
        periodId: period.id,
        operatorId: OPERATOR,
      });
      expect(closed).toMatchObject({ state: 'CLOSED', nav: '1000', validationPassed: true });
      expect(prisma.rows('portfolioAccountingClose')).toHaveLength(1);
      expect(prisma.rows('portfolioAccountingClose')[0].failureEvidence).toBeNull();
      const finalPeriod = await periods.getPeriod({ tenantId: TENANT, periodId: period.id });
      expect(finalPeriod).toMatchObject({
        state: 'CLOSED',
        closingNav: '1000',
        netPnl: '10',
        returnPercent: '1.5',
      });
      expect(finalPeriod.closeMetadata).toMatchObject({
        periodType: 'MONTHLY',
        closedBy: OPERATOR,
      });
    });
  });

  describe('custody, copy trading, compliance, client lifecycle', () => {
    it('custody finding: detailed type maps to the enum category and resolves through isResolved', async () => {
      const service = new CustodyReconciliationService(
        prisma as any,
        {} as any,
        { log: jest.fn() } as any,
      );
      const finding = await (service as any).createFinding({
        tenantId: TENANT,
        assetId: 'USDT',
        networkId: 'TRON',
        type: 'DEPOSIT_WITHOUT_TRANSACTION',
        description: 'Deposit d-1 without custody transaction',
        evidence: { depositId: 'd-1' },
      });
      expect(prisma.rows('custodyReconciliation')[0]).toMatchObject({
        reconciliationType: 'DEPOSIT',
        discrepancyType: 'DEPOSIT_WITHOUT_TRANSACTION',
        depositId: 'd-1',
        isResolved: false,
      });
      expect(finding).toMatchObject({
        type: 'DEPOSIT_WITHOUT_TRANSACTION',
        severity: 'HIGH',
        assetId: 'USDT',
        resolved: false,
      });

      const resolved = await service.resolveFinding({
        tenantId: TENANT,
        reconciliationId: finding.id,
        operatorId: OPERATOR,
        resolutionNote: 'Provider confirmed',
        correctiveAction: 'none',
      });
      expect(resolved).toMatchObject({
        resolved: true,
        resolvedBy: OPERATOR,
        resolutionNote: 'Provider confirmed',
      });
      const listed = await service.listFindings({
        tenantId: TENANT,
        type: 'DEPOSIT_WITHOUT_TRANSACTION',
        resolved: true,
      });
      expect(listed.total).toBe(1);
    });

    it('copy reconciliation: resolveRecord is tenant-scoped before writing', async () => {
      const service = new CopyReconciliationService(prisma as any, {} as any, {} as any);
      const record = prisma.seed('copyReconciliationRecord', {
        tenantId: TENANT,
        leaderEventId: 'le-1',
        category: Array.from(ENUMS.get('CopyReconciliationCategory')!)[0],
        severity: Array.from(ENUMS.get('CopyReconciliationSeverity')!)[0],
      });
      expect(await service.resolveRecord(OTHER_TENANT, record.id, OPERATOR, 'not mine')).toBeNull();
      expect(prisma.rows('copyReconciliationRecord')[0].resolved).toBe(false);

      const resolved = await service.resolveRecord(TENANT, record.id, OPERATOR, 'checked');
      expect(resolved).toMatchObject({ resolved: true, resolvedBy: OPERATOR });
      expect(resolved.actual._resolution).toEqual({ notes: 'checked' });
    });

    it("transaction monitoring: resolveSignal cannot resolve another tenant's signal", async () => {
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const service = new TransactionMonitoringService(
        prisma as any,
        {} as any,
        audit as any,
        {} as any,
      );
      const signal = prisma.seed('transactionMonitoringSignal', {
        tenantId: TENANT,
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        ruleId: 'LARGE_DEPOSIT',
        riskLevel: Array.from(ENUMS.get('ComplianceRiskLevel')!)[0],
        safeSummary: 'Large deposit',
        idempotencyKey: 'sig-1',
      });
      expect(await service.resolveSignal(signal.id, OTHER_TENANT, OPERATOR, 'n/a')).toBeNull();
      expect(prisma.rows('transactionMonitoringSignal')[0].resolved).toBe(false);
      expect(
        await service.resolveSignal(signal.id, TENANT, OPERATOR, 'false positive'),
      ).toMatchObject({ resolved: true });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: OPERATOR, action: 'MONITORING_SIGNAL_RESOLVED' }),
      );
    });

    it('lifecycle notifications: write a valid Notification for a recipient, none without one', async () => {
      const service = new LifecycleNotificationService(prisma as any);
      await service.notifySuspension({
        tenantId: TENANT,
        accountId: 'acc-1',
        reason: 'Compliance review',
        recipientId: OPERATOR,
      });
      await service.notifySuspension({
        tenantId: TENANT,
        accountId: 'acc-2',
        reason: 'No recipient',
      });
      const rows = prisma.rows('notification');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: OPERATOR,
        type: 'CLIENT_LIFECYCLE_ACCOUNT_SUSPENDED',
        title: 'Account suspended',
        body: expect.stringContaining('Compliance review'),
      });
    });
  });

  it('the fake rejects what Prisma rejects', () => {
    expect(() =>
      prisma.seed('custodySweep', { tenantId: TENANT, settlementReference: 'x' }),
    ).toThrow('Unknown argument `settlementReference`');
    expect(() =>
      prisma.seed('portfolioSnapshot', {
        tenantId: TENANT,
        profileId: PROFILE,
        snapshotId: 's',
        timestamp: new Date(),
        baseCurrency: 'USD',
        cash: '0',
        nav: '0',
        calculationVersion: 'c',
        policyVersion: 'p',
        idempotencyKey: 'k',
        fees: [],
      }),
    ).toThrow('expected String, got array');
    expect(() =>
      prisma.seed('usageEvent', {
        tenantId: TENANT,
        meterKey: 'm',
        eventType: 'e',
        sourceId: 's',
        sourceType: 't',
        quantity: 1.5,
        periodId: 'p',
        idempotencyKey: 'k',
        status: 'PENDING',
      }),
    ).toThrow('expected Int');
    expect(() =>
      prisma.seed('notification', { tenantId: TENANT, type: 't', title: 't', body: 'b' }),
    ).toThrow('Argument `userId` is missing');
  });
});
