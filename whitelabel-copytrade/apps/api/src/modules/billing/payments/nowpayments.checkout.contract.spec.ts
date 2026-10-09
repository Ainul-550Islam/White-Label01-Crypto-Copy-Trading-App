// # Contract-tests NOWPayments invoice creation against exact amount serialization.
import { AppException } from '../../../common/errors/app.exception';
import { NowPaymentsAdapter } from './nowpayments.adapter';

function checkoutInput(price: string): Record<string, unknown> {
  return {
    planId: 'plan-123',
    planCode: 'PRO',
    planName: 'Pro',
    price,
    currency: 'USD',
    interval: 'MONTHLY',
    tenantId: 'tenant-123',
    userId: 'user-123',
    subscriptionId: null,
    idempotencyKey: 'checkout-idempotency-123',
    successUrl: 'https://app.example.test/billing/success',
    cancelUrl: 'https://app.example.test/billing/cancel',
    metadata: {},
    references: { tenantId: 'tenant-123', planId: 'plan-123', idempotencyKey: 'checkout-idempotency-123' },
    amount: { amount: price, currency: 'USD', amountInSmallestUnit: 0 },
  };
}

describe('NOWPayments checkout exact amount contract', () => {
  it('serializes a lossless invoice JSON number while retaining the authoritative amount string', async () => {
    const config = {
      getNowPaymentsApiKey: jest.fn(() => 'test-api-key'),
      nowpayments: { apiBaseUrl: 'https://api.nowpayments.io/v1' },
    };
    const adapter = new NowPaymentsAdapter(config as any);
    const makeApiRequest = jest.spyOn(adapter as any, 'makeApiRequest').mockResolvedValue({
      id: 'invoice-123',
      payment_id: 'payment-123',
      invoice_url: 'https://pay.example.test/invoice-123',
      expiration_estimate_date: '2026-10-08T01:00:00.000Z',
    });

    const result = await adapter.createCheckout(checkoutInput('49.99') as any);
    const [, requestOptions] = makeApiRequest.mock.calls[0] as unknown as [string, { body: string }];
    const requestBody = JSON.parse(requestOptions.body) as Record<string, unknown>;

    expect(requestBody.price_amount).toBe(49.99);
    expect(result.providerInvoiceId).toBe('invoice-123');
    expect(result.providerPaymentId).toBe('payment-123');
    expect(result.checkoutUrl).toBe('https://pay.example.test/invoice-123');
    expect(makeApiRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects a price that would change when converted to the provider-required JSON number', async () => {
    const config = {
      getNowPaymentsApiKey: jest.fn(() => 'test-api-key'),
      nowpayments: { apiBaseUrl: 'https://api.nowpayments.io/v1' },
    };
    const adapter = new NowPaymentsAdapter(config as any);
    const makeApiRequest = jest.spyOn(adapter as any, 'makeApiRequest');

    await expect(adapter.createCheckout(checkoutInput('1.230000000000000001') as any)).rejects.toBeInstanceOf(AppException);
    await expect(adapter.createCheckout(checkoutInput('1.230000000000000001') as any)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(makeApiRequest).not.toHaveBeenCalled();
  });
});
