import { InvoiceNumberService } from './invoice-number.service';

/** invoiceCounter delegate with INSERT ... ON CONFLICT DO UPDATE semantics. */
function fakeCounters() {
  const rows = new Map<string, number>();
  return {
    rows,
    upsert: jest.fn(
      async (args: {
        where: { scope: string };
        create: { scope: string; sequence: number };
        update: { sequence: { increment: number } };
      }) => {
        const current = rows.get(args.where.scope);
        const next =
          current === undefined ? args.create.sequence : current + args.update.sequence.increment;
        rows.set(args.where.scope, next);
        return { sequence: next };
      },
    ),
  };
}

const TENANT = 'abcd1234-0000-0000-0000-000000000000';

describe('InvoiceNumberService database fallback', () => {
  const cache = { get: jest.fn(), set: jest.fn() };
  const redisDown = {
    client: {
      incr: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      expire: jest.fn(),
    },
  };

  function build(invoiceCounter: unknown, invoices: unknown[] = []) {
    const prisma = {
      invoiceCounter,
      invoice: {
        findFirst: jest.fn(
          async ({ where }: any) =>
            invoices.find((i: any) => i.invoiceNumber === where.invoiceNumber) ?? null,
        ),
      },
    };
    return new InvoiceNumberService(prisma as any, cache as any, redisDown as any);
  }

  it('draws sequential numbers from one atomic upsert per call when Redis is down', async () => {
    const counters = fakeCounters();
    const service = build(counters);
    const first = await service.generateInvoiceNumberWithTenantPrefix(TENANT);
    const second = await service.generateInvoiceNumberWithTenantPrefix(TENANT);
    expect(first).toMatch(/^INV-ABCD-\d{6}-000001$/);
    expect(second).toMatch(/^INV-ABCD-\d{6}-000002$/);
    expect(counters.upsert).toHaveBeenCalledTimes(2);
    expect(counters.upsert).toHaveBeenCalledWith({
      where: { scope: TENANT },
      create: { scope: TENANT, sequence: 1 },
      update: { sequence: { increment: 1 } },
      select: { sequence: true },
    });
  });

  it('gives concurrent callers distinct, gap-free numbers', async () => {
    const counters = fakeCounters();
    const service = build(counters);
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => service.generateInvoiceNumberWithTenantPrefix(TENANT)),
    );
    const seqs = numbers.map((n) => Number(n.split('-').pop())).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(10);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('keeps separate counters for the global and per-tenant scopes', async () => {
    const counters = fakeCounters();
    const service = build(counters);
    await service.generateInvoiceNumber(TENANT);
    await service.generateInvoiceNumber(TENANT);
    expect(counters.rows.get('global')).toBe(2);
    expect(counters.rows.get(TENANT)).toBe(2);
  });

  it('never uses a find-then-create pair (the old race)', async () => {
    const counters = {
      ...fakeCounters(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    const service = build(counters);
    await service.generateInvoiceNumberWithTenantPrefix(TENANT);
    expect(counters.findUnique).not.toHaveBeenCalled();
    expect(counters.findFirst).not.toHaveBeenCalled();
    expect(counters.create).not.toHaveBeenCalled();
    expect(counters.update).not.toHaveBeenCalled();
  });

  it('still returns a number when the database is unreachable too', async () => {
    const broken = {
      upsert: jest.fn(async () => {
        throw new Error('db down');
      }),
    };
    const service = build(broken);
    await expect(service.generateInvoiceNumberWithTenantPrefix(TENANT)).resolves.toMatch(/^INV-/);
  });

  it('uses Redis and never touches the counter table when Redis is healthy', async () => {
    const counters = fakeCounters();
    let n = 0;
    const redisUp = { client: { incr: jest.fn(async () => ++n), expire: jest.fn(async () => 1) } };
    const prisma = { invoiceCounter: counters, invoice: { findFirst: jest.fn(async () => null) } };
    const service = new InvoiceNumberService(prisma as any, cache as any, redisUp as any);
    await expect(service.generateInvoiceNumberWithTenantPrefix(TENANT)).resolves.toMatch(
      /-000001$/,
    );
    expect(counters.upsert).not.toHaveBeenCalled();
  });
});
