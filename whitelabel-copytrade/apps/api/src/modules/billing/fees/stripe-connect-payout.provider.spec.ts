import {
  StripeConnectPayoutProvider,
  toStripeMinorUnits,
  FetchLike,
} from './stripe-connect-payout.provider';
import { BeneficiaryType, CreatePayoutInput, PayoutStatus } from './payout.types';

const input = (overrides: Partial<CreatePayoutInput> = {}): CreatePayoutInput => ({
  settlementId: 'set_1',
  beneficiaryId: 'user_1',
  beneficiaryType: BeneficiaryType.TRADER,
  tenantId: 'tenant_1',
  amount: '125.50',
  currency: 'USD',
  destination: {
    type: 'stripe_account',
    reference: 'acct_1Nabcdef',
    maskedReference: 'acct_****cdef',
    currency: 'USD',
  },
  idempotencyKey: 'payout_set_1_user_1_tenant_1',
  ...overrides,
});

function fakeFetch(response: { ok: boolean; status: number; body: any }) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  return { impl, calls };
}

const transfer = (extra: Record<string, unknown> = {}) => ({
  id: 'tr_1Nxyz',
  object: 'transfer',
  amount: 12550,
  amount_reversed: 0,
  currency: 'usd',
  destination: 'acct_1Nabcdef',
  reversed: false,
  livemode: false,
  created: 1_760_000_000,
  balance_transaction: 'txn_1',
  ...extra,
});

describe('toStripeMinorUnits', () => {
  it('converts exactly without floating point', () => {
    expect(toStripeMinorUnits('125.50', 'USD')).toBe(12550);
    expect(toStripeMinorUnits('0.1', 'usd')).toBe(10);
    expect(toStripeMinorUnits('19.990', 'eur')).toBe(1999);
    expect(toStripeMinorUnits('1000', 'JPY')).toBe(1000);
    expect(toStripeMinorUnits('1.230', 'KWD')).toBe(1230);
  });

  it('rejects sub-unit precision, zero, negatives and junk', () => {
    expect(() => toStripeMinorUnits('1.005', 'USD')).toThrow(/decimal places/);
    expect(() => toStripeMinorUnits('10.5', 'JPY')).toThrow(/decimal places/);
    expect(() => toStripeMinorUnits('1.235', 'KWD')).toThrow(/multiple of 0.010/);
    expect(() => toStripeMinorUnits('0.00', 'USD')).toThrow(/greater than zero/);
    expect(() => toStripeMinorUnits('-5', 'USD')).toThrow(/Invalid/);
    expect(() => toStripeMinorUnits('1e3', 'USD')).toThrow(/Invalid/);
  });
});

describe('StripeConnectPayoutProvider', () => {
  it('is unavailable without a secret/restricted key and never calls Stripe', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200, body: transfer() });
    for (const secretKey of ['', 'pk_live_abc', 'whsec_abc']) {
      const p = new StripeConnectPayoutProvider({ secretKey, fetchImpl: impl });
      expect(p.isAvailable()).toBe(false);
      await expect(p.createPayout(input())).rejects.toThrow(/not configured/);
    }
    expect(calls).toHaveLength(0);
  });

  it('creates a transfer with Idempotency-Key, minor units and the connected account', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200, body: transfer() });
    const p = new StripeConnectPayoutProvider({
      secretKey: 'sk_test_123',
      fetchImpl: impl,
      apiVersion: '2024-06-20',
    });
    const result = await p.createPayout(input());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/transfers');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['Idempotency-Key']).toBe('payout_set_1_user_1_tenant_1');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk_test_123');
    expect(calls[0].init.headers['Stripe-Version']).toBe('2024-06-20');
    const form = new URLSearchParams(calls[0].init.body);
    expect(form.get('amount')).toBe('12550');
    expect(form.get('currency')).toBe('usd');
    expect(form.get('destination')).toBe('acct_1Nabcdef');
    expect(form.get('transfer_group')).toBe('settlement_set_1');
    expect(form.get('metadata[tenant_id]')).toBe('tenant_1');

    expect(result.status).toBe(PayoutStatus.SUCCEEDED);
    expect(result.providerPayoutId).toBe('tr_1Nxyz');
    expect(JSON.stringify(result.rawResponse)).not.toContain('sk_test_123');
  });

  it('refuses non-Stripe destinations and missing idempotency keys before calling Stripe', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200, body: transfer() });
    const p = new StripeConnectPayoutProvider({ secretKey: 'sk_test_123', fetchImpl: impl });
    await expect(
      p.createPayout(
        input({
          destination: {
            type: 'bank_account',
            reference: 'x',
            maskedReference: '****',
            currency: 'USD',
          },
        }),
      ),
    ).rejects.toThrow(/stripe_account/);
    await expect(
      p.createPayout(
        input({
          destination: {
            type: 'stripe_account',
            reference: 'cus_123',
            maskedReference: '****',
            currency: 'USD',
          },
        }),
      ),
    ).rejects.toThrow(/acct_/);
    await expect(p.createPayout(input({ idempotencyKey: '' }))).rejects.toThrow(/idempotency/);
    expect(calls).toHaveLength(0);
  });

  it('surfaces Stripe errors as failures (never success) without leaking the key', async () => {
    const { impl } = fakeFetch({
      ok: false,
      status: 400,
      body: {
        error: {
          type: 'invalid_request_error',
          code: 'balance_insufficient',
          message: 'Insufficient funds',
        },
      },
    });
    const p = new StripeConnectPayoutProvider({ secretKey: 'sk_test_123', fetchImpl: impl });
    const err = (await p.createPayout(input()).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/400 balance_insufficient/);
    expect(err.message).not.toContain('sk_test_123');
  });

  it('rejects a 2xx body that is not a transfer', async () => {
    const { impl } = fakeFetch({ ok: true, status: 200, body: { object: 'charge', id: 'ch_1' } });
    const p = new StripeConnectPayoutProvider({ secretKey: 'sk_test_123', fetchImpl: impl });
    await expect(p.createPayout(input())).rejects.toThrow(/unexpected response/);
  });

  it('reads status back: reversed transfers are REVERSED', async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      status: 200,
      body: transfer({ reversed: true, amount_reversed: 12550 }),
    });
    const p = new StripeConnectPayoutProvider({ secretKey: 'rk_live_123', fetchImpl: impl });
    const status = await p.getPayoutStatus('tr_1Nxyz');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/transfers/tr_1Nxyz');
    expect(status.status).toBe(PayoutStatus.REVERSED);
    await expect(p.getPayoutStatus('manual_123')).rejects.toThrow(/Not a Stripe transfer id/);
  });
});
