// # Contract-tests exact Stripe billing minor-unit amounts and reject invalid precision before SDK use.
import { AppException } from '../../../common/errors/app.exception';
import { StripeAdapter } from './stripe.adapter';
import type { CreateCheckoutInput } from './payment-provider.interface';

interface StripeAdapterTestHarness {
  loadStripeSdk(): Promise<unknown>;
}

function checkoutInput(price: string, amountInSmallestUnit: number): CreateCheckoutInput {
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
    references: {
      tenantId: 'tenant-123',
      planId: 'plan-123',
      userId: 'user-123',
      idempotencyKey: 'checkout-idempotency-123',
      orderId: 'order-123',
    },
    amount: { amount: price, currency: 'USD', amountInSmallestUnit },
  };
}

function adapterWithConfig(): StripeAdapter {
  const config = {
    getStripeSecretKey: jest.fn(() => 'sk_test_contract'),
    stripe: {
      apiVersion: '2023-10-16',
      maxNetworkRetries: 2,
      timeoutMs: 1000,
    },
    checkout: { expirationMinutes: 30 },
  };
  return new StripeAdapter(config as never);
}

describe('Stripe billing checkout exact amount contract', () => {
  it('sends an exact integer minor-unit amount to Stripe', async () => {
    const adapter = adapterWithConfig();
    const createSession = jest.fn().mockResolvedValue({
      id: 'cs-123',
      payment_intent: 'pi-123',
      customer: 'cus-123',
      url: 'https://checkout.example.test/session',
      expires_at: null,
    });

    class FakeStripe {
      readonly checkout = { sessions: { create: createSession } };

      constructor(_secretKey: string, _options: Record<string, unknown>) {}
    }

    const loadStripeSdk = jest
      .spyOn(adapter as unknown as StripeAdapterTestHarness, 'loadStripeSdk')
      .mockResolvedValue(FakeStripe);

    const result = await adapter.createCheckout(checkoutInput('49.99', 4999));
    const sessionParams = createSession.mock.calls[0][0] as {
      line_items: Array<{ price_data: { unit_amount: number } }>;
    };

    expect(sessionParams.line_items[0].price_data.unit_amount).toBe(4999);
    expect(result.providerCheckoutId).toBe('cs-123');
    expect(result.checkoutUrl).toBe('https://checkout.example.test/session');
    expect(loadStripeSdk).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('rejects precision beyond the Stripe currency scale before loading the SDK', async () => {
    const adapter = adapterWithConfig();
    const loadStripeSdk = jest.spyOn(adapter as unknown as StripeAdapterTestHarness, 'loadStripeSdk');

    await expect(adapter.createCheckout(checkoutInput('10.001', 0))).rejects.toBeInstanceOf(AppException);
    await expect(adapter.createCheckout(checkoutInput('10.001', 0))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect(loadStripeSdk).not.toHaveBeenCalled();
  });
});
