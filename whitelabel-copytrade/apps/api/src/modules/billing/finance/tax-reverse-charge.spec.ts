/**
 * Tax on invoices: the customer's tax profile must reach the tax engine, and
 * B2B reverse charge (0% VAT) needs evidence for the VAT number.
 */
import { TaxService } from './tax.service';
import { InvoiceService } from './invoice.service';
import { TaxCategory } from './tax.types';
import { createMoney } from './money.types';
import type { VatCheckResult } from './vies-vat.client';

const ENV_KEYS = [
  'TAX_VAT_VALIDATION',
  'TAX_SUPPLIER_COUNTRY',
  'TAX_RATES_JSON',
  'TAX_UNKNOWN_COUNTRY',
  'TAX_VIES_REQUESTER_VAT',
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const noProvider = { getProvider: () => null } as any;

function taxService(prisma: any = {}, viesStatus?: VatCheckResult['status']) {
  const svc = new TaxService(prisma, noProvider);
  const check = jest.fn(async (country: string, vatNumber: string): Promise<VatCheckResult> => ({
    status: viesStatus ?? 'VALID',
    countryCode: country,
    vatNumber,
    source: 'vies',
    consultationNumber: viesStatus === 'VALID' ? 'WAPI123' : undefined,
    checkedAt: '2026-09-28T10:00:00.000Z',
  }));
  (svc as any).vatChecker = { check };
  return { svc, check };
}

const b2b = (overrides: Record<string, unknown> = {}) =>
  ({
    tenantId: 't1',
    amount: createMoney('100.00', 'EUR'),
    currency: 'EUR',
    billingCountry: 'DE',
    vatNumber: 'DE123456789',
    isBusinessCustomer: true,
    ...overrides,
  }) as any;

describe('reverse charge needs a verified VAT number', () => {
  it('format mode (default): a well-formed EU VAT number -> reverse charge, evidence attached', async () => {
    const { svc, check } = taxService();
    const r = await svc.calculateTax(b2b());
    expect(r.reverseCharge).toBe(true);
    expect(r.taxAmount.amount).toBe('0.00');
    expect(r.vatCheck).toMatchObject({ status: 'VALID', source: 'format' });
    expect(check).not.toHaveBeenCalled();
  });

  it('format mode: a malformed number is charged standard VAT (was: any string gave 0%)', async () => {
    const { svc } = taxService();
    const r = await svc.calculateTax(b2b({ vatNumber: 'not-a-vat' }));
    expect(r.reverseCharge).toBe(false);
    expect(r.taxRate).toBe(1900);
    expect(r.taxAmount.amount).toBe('19.00');
    expect(r.vatCheck?.status).toBe('INVALID');
  });

  it('vies mode: VALID -> reverse charge with the consultation number', async () => {
    process.env.TAX_VAT_VALIDATION = 'vies';
    const { svc, check } = taxService({}, 'VALID');
    const r = await svc.calculateTax(b2b());
    expect(check).toHaveBeenCalledWith('DE', 'DE123456789');
    expect(r.taxCategory).toBe(TaxCategory.REVERSE_CHARGE);
    expect(r.vatCheck?.consultationNumber).toBe('WAPI123');
  });

  it('vies mode: INVALID or UNAVAILABLE -> standard VAT (the seller cannot recover uncharged VAT)', async () => {
    process.env.TAX_VAT_VALIDATION = 'vies';
    for (const status of ['INVALID', 'UNAVAILABLE'] as const) {
      const { svc } = taxService({}, status);
      const r = await svc.calculateTax(b2b());
      expect(r.reverseCharge).toBe(false);
      expect(r.taxAmount.amount).toBe('19.00');
      expect(r.vatCheck?.status).toBe(status);
    }
  });

  it('same member state as the seller -> domestic VAT, no reverse charge, no check', async () => {
    process.env.TAX_SUPPLIER_COUNTRY = 'DE';
    process.env.TAX_VAT_VALIDATION = 'vies';
    const { svc, check } = taxService();
    const r = await svc.calculateTax(b2b());
    expect(r.reverseCharge).toBe(false);
    expect(r.taxRate).toBe(1900);
    expect(r.vatCheck).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it('consumers and non-EU customers never trigger reverse charge', async () => {
    const { svc } = taxService();
    expect((await svc.calculateTax(b2b({ isBusinessCustomer: false }))).reverseCharge).toBe(false);
    const gb = await svc.calculateTax(b2b({ billingCountry: 'GB', vatNumber: 'GB123456789' }));
    expect(gb.reverseCharge).toBe(false);
    expect(gb.taxRate).toBe(2000);
  });

  it('none mode keeps the historical trust-the-number behaviour, explicitly marked SKIPPED', async () => {
    process.env.TAX_VAT_VALIDATION = 'none';
    const { svc } = taxService();
    const r = await svc.calculateTax(b2b({ vatNumber: 'whatever' }));
    expect(r.reverseCharge).toBe(true);
    expect(r.vatCheck?.status).toBe('SKIPPED');
  });
});

describe('validateTaxId', () => {
  it('uses per-member-state formats for EU countries and VIES in vies mode', async () => {
    const { svc } = taxService();
    expect((await svc.validateTaxId('DE123456789', 'DE')).valid).toBe(true);
    expect((await svc.validateTaxId('NL123456789', 'NL')).valid).toBe(false);

    process.env.TAX_VAT_VALIDATION = 'vies';
    const unavailable = taxService({}, 'UNAVAILABLE').svc;
    const r = await unavailable.validateTaxId('DE123456789', 'DE');
    expect(r).toMatchObject({ valid: false, validationSource: 'vies_unavailable' });
  });
});

describe('invoice generation passes the tenant tax profile to the tax engine', () => {
  const STOP = new Error('stop after building the invoice input');

  function invoiceHarness(
    tenantRow: { countryCode: string | null; metadata: Record<string, unknown> } | null,
  ) {
    const prisma = {
      subscriptionPlan: {
        findUnique: jest.fn(async () => ({
          id: 'plan1',
          name: 'Pro',
          code: 'pro',
          price: '100.00',
          interval: 'MONTHLY',
        })),
      },
      tenant: {
        findUnique: jest.fn(async (args: any) =>
          args.select?.countryCode
            ? tenantRow && { id: 't1', ...tenantRow }
            : { id: 't1', name: 'Acme', slug: 'acme', contactEmail: 'billing@acme.test' },
        ),
      },
    };
    const tax = new TaxService(prisma as any, noProvider);
    (tax as any).vatChecker = { check: jest.fn() };
    const created: any[] = [];
    const repo = {
      findByPaymentId: jest.fn(async () => null),
      create: jest.fn(async (input: any) => {
        created.push(input);
        throw STOP;
      }),
    };
    const payments = {
      getPaymentById: jest.fn(async () => ({
        id: 'pay1',
        tenantId: 't1',
        planId: 'plan1',
        status: 'SUCCEEDED',
        currency: 'EUR',
        provider: 'STRIPE',
        subscriptionId: null,
        providerPaymentId: 'pi_1',
        paidAt: new Date('2026-09-28T00:00:00Z'),
      })),
    };
    const svc = new InvoiceService(
      prisma as any,
      repo as any,
      {} as any,
      tax,
      payments as any,
      {} as any,
      {} as any,
    );
    return { svc, created };
  }

  it('taxes a German consumer at 19% (was: country never selected -> "US" -> 0%)', async () => {
    const { svc, created } = invoiceHarness({ countryCode: 'DE', metadata: {} });
    await expect(svc.createInvoiceFromPayment('pay1')).rejects.toBe(STOP);
    const taxLine = created[0].lines.find((l: any) => l.type === 'TAX');
    expect(taxLine.amount.amount).toBe('19.00');
    expect(created[0].taxSummary[0]).toMatchObject({ taxRate: 1900, reverseCharge: false });
  });

  it('a French business with a VAT number: reverse charge, VAT number on the invoice, evidence in metadata', async () => {
    const { svc, created } = invoiceHarness({
      countryCode: 'FR',
      metadata: { isBusinessCustomer: true, vatNumber: 'FRXX123456789', taxId: 'FRXX123456789' },
    });
    await expect(svc.createInvoiceFromPayment('pay1')).rejects.toBe(STOP);
    expect(created[0].lines.find((l: any) => l.type === 'TAX')).toBeUndefined();
    expect(created[0].taxSummary[0]).toMatchObject({ reverseCharge: true, taxRate: 0 });
    expect(created[0].customer.vatNumber).toBe('FRXX123456789');
    expect(created[0].metadata.vatCheck).toMatchObject({
      status: 'VALID',
      source: 'format',
      countryCode: 'FR',
    });
  });

  it('a tax-exempt tenant is not charged', async () => {
    const { svc, created } = invoiceHarness({ countryCode: 'DE', metadata: { isTaxExempt: true } });
    await expect(svc.createInvoiceFromPayment('pay1')).rejects.toBe(STOP);
    expect(created[0].lines.find((l: any) => l.type === 'TAX')).toBeUndefined();
  });

  it('no country on file + TAX_UNKNOWN_COUNTRY=reject -> no invoice instead of an untaxed one', async () => {
    process.env.TAX_UNKNOWN_COUNTRY = 'reject';
    const { svc, created } = invoiceHarness({ countryCode: null, metadata: {} });
    await expect(svc.createInvoiceFromPayment('pay1')).rejects.toThrow(/Billing country required/);
    expect(created).toHaveLength(0);
  });

  it('tax profile unavailable -> no invoice', async () => {
    const { svc, created } = invoiceHarness(null);
    await expect(svc.createInvoiceFromPayment('pay1')).rejects.toThrow(
      /tax information unavailable/,
    );
    expect(created).toHaveLength(0);
  });
});
