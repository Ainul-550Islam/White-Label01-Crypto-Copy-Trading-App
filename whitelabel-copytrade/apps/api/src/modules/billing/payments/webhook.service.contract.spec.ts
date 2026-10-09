// # Contract-tests the signed billing webhook pipeline and exact payment normalization wiring
import { AppException } from '../../../common/errors/app.exception';
import { PaymentProvider, PaymentStatus } from './payment.types';
import { WebhookEventCategory, WebhookProcessingStatus } from './webhook.types';
import { stripeMinorUnitsToDecimalString } from './stripe.adapter';
import { WebhookService } from './webhook.service';

type WebhookEvent = Record<string, unknown>;

function nowPaymentsEvent(overrides: Record<string, unknown> = {}): WebhookEvent {
  return {
    payment_id: 'np-payment-123',
    order_id: 'order-123',
    payment_status: 'finished',
    price_amount: '1.230000000000000001',
    price_currency: 'usdt',
    confirmations: 8,
    created_at: '2026-10-08T00:00:00.123456Z',
    ...overrides,
  };
}

function normalizedProviderEvent(
  provider: PaymentProvider,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    provider,
    providerEventId: provider === PaymentProvider.NOWPAYMENTS ? 'np-payment-123' : 'evt-stripe-123',
    eventType: provider === PaymentProvider.NOWPAYMENTS ? 'finished' : 'checkout.session.completed',
    eventCategory: WebhookEventCategory.PAYMENT_SUCCEEDED,
    paymentStatus: PaymentStatus.PENDING,
    providerPaymentId: provider === PaymentProvider.NOWPAYMENTS ? 'np-payment-123' : 'pi-stripe-123',
    providerCheckoutId: provider === PaymentProvider.STRIPE ? 'cs-stripe-123' : undefined,
    amount: { amount: '1.23', currency: provider === PaymentProvider.NOWPAYMENTS ? 'USDT' : 'USD' },
    metadata: { tenantId: 'tenant-123', orderId: 'order-123' },
    rawEvent: { sanitized: true },
    receivedAt: new Date('2026-10-08T00:00:01.000Z'),
    providerCreatedAt: new Date('2026-10-08T00:00:00.000Z'),
    ...overrides,
  };
}

function buildHarness(options: {
  provider?: PaymentProvider;
  rawEvent?: WebhookEvent;
  verified?: boolean;
  payment?: Record<string, unknown> | null;
  providerNormalizedEvent?: Record<string, unknown>;
} = {}) {
  const provider = options.provider ?? PaymentProvider.NOWPAYMENTS;
  const rawEvent = options.rawEvent ?? nowPaymentsEvent();
  const providerAdapter = {
    normalizeWebhookEvent: jest.fn(async () =>
      options.providerNormalizedEvent ?? normalizedProviderEvent(provider),
    ),
  };
  const signatureService = {
    verifySignature: jest.fn(async () => options.verified === false
      ? {
          verified: false,
          provider,
          providerEventId: 'event-verified-by-signature-service',
          failureReason: 'Invalid signature',
        }
      : {
          verified: true,
          provider,
          providerEventId: provider === PaymentProvider.NOWPAYMENTS ? 'np-payment-123' : 'evt-stripe-123',
          eventType: provider === PaymentProvider.NOWPAYMENTS ? 'finished' : 'checkout.session.completed',
          rawEvent,
        }),
  };
  const eventRecord = { id: 'webhook-record-123' };
  const replayGuard = {
    recordEventReceived: jest.fn(async () => eventRecord),
    markEventVerified: jest.fn(async () => undefined),
    checkReplay: jest.fn(async (_event: unknown) => ({
      isDuplicate: false,
      isReplay: false,
      shouldProcess: true,
      reason: 'new event',
    })),
    markEventProcessing: jest.fn(async () => undefined),
    markEventProcessed: jest.fn(async () => undefined),
    markEventFailed: jest.fn(async () => undefined),
    markEventRejected: jest.fn(async () => undefined),
    markEventDuplicate: jest.fn(async () => undefined),
  };
  const payment = options.payment === undefined
    ? {
        id: 'internal-payment-123',
        tenantId: 'tenant-123',
        planId: 'plan-123',
        subscriptionId: 'subscription-123',
        userId: 'user-123',
        amount: '1.230000000000000001',
        currency: provider === PaymentProvider.NOWPAYMENTS ? 'USDT' : 'USD',
        providerPaymentId: provider === PaymentProvider.NOWPAYMENTS ? 'np-payment-123' : 'pi-stripe-123',
        providerCheckoutId: provider === PaymentProvider.STRIPE ? 'cs-stripe-123' : null,
        providerSessionId: null,
        providerInvoiceId: null,
        idempotencyKey: 'checkout-idempotency-123',
        orderId: 'order-123',
        planCode: 'PRO',
        planName: 'Pro',
        status: PaymentStatus.PENDING,
      }
    : options.payment;
  const paymentService = {
    getPaymentByProviderId: jest.fn(async () => payment),
    getPaymentByCheckoutId: jest.fn(async () => null),
    getPaymentByOrderId: jest.fn(async () => null),
    getPaymentByIdempotencyKey: jest.fn(async () => null),
    applyProviderResult: jest.fn(async (_paymentId: string, result: Record<string, unknown>) => ({
      ...payment,
      status: result.status,
    })),
  };
  const providerFactory = { getProvider: jest.fn(() => providerAdapter) };
  const subscriptionSync = { syncPaymentToSubscription: jest.fn(async () => undefined) };
  const audit = { logWebhookEvent: jest.fn(async () => undefined) };
  const service = new WebhookService(
    signatureService as any,
    replayGuard as any,
    paymentService as any,
    providerFactory as any,
    subscriptionSync as any,
    audit as any,
  );
  const payload = {
    provider,
    rawBody: Buffer.from(JSON.stringify(rawEvent)),
    signature: 'signed-provider-payload',
    headers: {},
  };
  return {
    service,
    payload,
    rawEvent,
    providerAdapter,
    signatureService,
    replayGuard,
    paymentService,
    providerFactory,
    subscriptionSync,
    audit,
  };
}

describe('Billing WebhookService canonical payment normalization contract', () => {
  it('converts safe Stripe minor-unit integers using the currency exponent without floating-point arithmetic', () => {
    expect(stripeMinorUnitsToDecimalString(12345, 'USD')).toBe('123.45');
    expect(stripeMinorUnitsToDecimalString(12345, 'JPY')).toBe('12345');
    expect(stripeMinorUnitsToDecimalString(12345, 'KWD')).toBe('12.345');
    expect(() => stripeMinorUnitsToDecimalString(1.5, 'USD')).toThrow(/safe integer/);
    expect(() => stripeMinorUnitsToDecimalString(100, 'ZZZ')).toThrow(/exponent is not configured/);
  });

  it('normalizes exact NOWPayments values only after signature verification and uses them for state application', async () => {
    const harness = buildHarness();
    const result = await harness.service.processWebhook(harness.payload as any);
    const verifiedAt = harness.signatureService.verifySignature.mock.invocationCallOrder[0];
    const normalizedAt = harness.providerAdapter.normalizeWebhookEvent.mock.invocationCallOrder[0];
    const replayEvent = harness.replayGuard.checkReplay.mock.calls[0][0];

    expect(verifiedAt).toBeLessThan(normalizedAt);
    expect(replayEvent).toMatchObject({
      provider: PaymentProvider.NOWPAYMENTS,
      paymentStatus: PaymentStatus.SUCCEEDED,
      eventCategory: WebhookEventCategory.PAYMENT_SUCCEEDED,
      providerPaymentId: 'np-payment-123',
      amount: { amount: '1.230000000000000001', currency: 'USDT' },
      metadata: {
        canonicalPaymentStatus: 'CONFIRMED',
        paymentConfirmations: 8,
        paymentOccurredAtIso: '2026-10-08T00:00:00.123Z',
      },
    });
    expect(harness.paymentService.applyProviderResult).toHaveBeenCalledWith(
      'internal-payment-123',
      expect.objectContaining({
        status: PaymentStatus.SUCCEEDED,
        amount: '1.230000000000000001',
      }),
    );
    expect(harness.subscriptionSync.syncPaymentToSubscription).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      processingStatus: WebhookProcessingStatus.PROCESSED,
      paymentId: 'internal-payment-123',
    });
  });

  it('converts Stripe integer minor units to exact decimal strings before applying the verified event', async () => {
    const created = Math.floor(Date.parse('2026-10-08T00:00:00.000Z') / 1000);
    const rawEvent = {
      id: 'evt-stripe-123',
      type: 'checkout.session.completed',
      created,
      data: {
        object: {
          id: 'cs-stripe-123',
          payment_intent: { id: 'pi-stripe-123' },
          payment_status: 'paid',
          amount_total: 12345,
          currency: 'usd',
        },
      },
    };
    const harness = buildHarness({
      provider: PaymentProvider.STRIPE,
      rawEvent,
      providerNormalizedEvent: normalizedProviderEvent(PaymentProvider.STRIPE, {
        providerPaymentId: { id: 'pi-stripe-123' },
        paymentStatus: PaymentStatus.PENDING,
        amount: { amount: '123.44999999999999', currency: 'USD' },
      }),
      payment: {
        id: 'internal-payment-123',
        tenantId: 'tenant-123',
        planId: 'plan-123',
        subscriptionId: 'subscription-123',
        userId: 'user-123',
        amount: '123.45',
        currency: 'USD',
        providerPaymentId: 'pi-stripe-123',
        providerCheckoutId: 'cs-stripe-123',
        providerSessionId: 'cs-stripe-123',
        providerInvoiceId: null,
        idempotencyKey: 'checkout-idempotency-123',
        orderId: 'order-123',
        planCode: 'PRO',
        planName: 'Pro',
        status: PaymentStatus.PENDING,
      },
    });

    await harness.service.processWebhook(harness.payload as any);

    const stripeReplayEvent = harness.replayGuard.checkReplay.mock.calls[0][0] as Record<string, unknown>;
    expect(stripeReplayEvent).toMatchObject({
      paymentStatus: PaymentStatus.SUCCEEDED,
      amount: { amount: '123.45', currency: 'USD' },
    });
    expect(stripeReplayEvent.providerCreatedAt).toEqual(new Date('2026-10-08T00:00:00.000Z'));
    expect(harness.paymentService.getPaymentByProviderId).toHaveBeenCalledWith(
      'pi-stripe-123',
      PaymentProvider.STRIPE,
    );
    expect(harness.paymentService.applyProviderResult).toHaveBeenCalledWith(
      'internal-payment-123',
      expect.objectContaining({ status: PaymentStatus.SUCCEEDED }),
    );
  });

  it('withholds a confirmed transition when exact amount or currency differs from the internal payment', async () => {
    const harness = buildHarness({
      payment: {
        id: 'internal-payment-123',
        tenantId: 'tenant-123',
        planId: 'plan-123',
        subscriptionId: 'subscription-123',
        userId: 'user-123',
        amount: '1.230000000000000002',
        currency: 'USDT',
        providerPaymentId: 'np-payment-123',
        providerCheckoutId: null,
        providerSessionId: null,
        providerInvoiceId: null,
        idempotencyKey: 'checkout-idempotency-123',
        orderId: 'order-123',
        planCode: 'PRO',
        planName: 'Pro',
        status: PaymentStatus.PENDING,
      },
    });

    await expect(harness.service.processWebhook(harness.payload as any)).rejects.toBeInstanceOf(AppException);
    expect(harness.paymentService.applyProviderResult).not.toHaveBeenCalled();
    expect(harness.subscriptionSync.syncPaymentToSubscription).not.toHaveBeenCalled();
    expect(harness.replayGuard.markEventFailed).toHaveBeenCalledWith(
      PaymentProvider.NOWPAYMENTS,
      'np-payment-123',
      expect.stringContaining('does not match'),
    );
  });

  it('withholds unknown provider states instead of treating them as pending or successful', async () => {
    const harness = buildHarness({
      rawEvent: nowPaymentsEvent({ payment_status: 'new-provider-state' }),
    });

    await expect(harness.service.processWebhook(harness.payload as any)).rejects.toBeInstanceOf(AppException);
    expect(harness.replayGuard.checkReplay.mock.calls[0][0]).toMatchObject({
      paymentStatus: PaymentStatus.UNKNOWN,
      eventCategory: WebhookEventCategory.UNKNOWN,
      metadata: { canonicalPaymentStatus: 'UNKNOWN' },
    });
    expect(harness.paymentService.getPaymentByProviderId).not.toHaveBeenCalled();
    expect(harness.paymentService.applyProviderResult).not.toHaveBeenCalled();
    expect(harness.replayGuard.markEventFailed).toHaveBeenCalledWith(
      PaymentProvider.NOWPAYMENTS,
      'np-payment-123',
      expect.stringContaining('Unrecognized provider payment status'),
    );
  });

  it('withholds a verified state transition when provider event time is absent', async () => {
    const harness = buildHarness({ rawEvent: nowPaymentsEvent({ created_at: null }) });

    await expect(harness.service.processWebhook(harness.payload as any)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Failed to normalize webhook event',
    });
    expect(harness.providerFactory.getProvider).not.toHaveBeenCalled();
    expect(harness.paymentService.applyProviderResult).not.toHaveBeenCalled();
    expect(harness.replayGuard.markEventFailed).toHaveBeenCalledWith(
      PaymentProvider.NOWPAYMENTS,
      'np-payment-123',
      expect.stringContaining('missing provider timestamp'),
    );
  });

  it('does not normalize or dispatch an invalid-signature payload', async () => {
    const harness = buildHarness({
      rawEvent: nowPaymentsEvent({ price_amount: 1.23 }),
      verified: false,
    });

    await expect(harness.service.processWebhook(harness.payload as any)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(harness.providerFactory.getProvider).not.toHaveBeenCalled();
    expect(harness.providerAdapter.normalizeWebhookEvent).not.toHaveBeenCalled();
    expect(harness.replayGuard.recordEventReceived).not.toHaveBeenCalled();
    expect(harness.paymentService.applyProviderResult).not.toHaveBeenCalled();
  });

  it('rejects lossy numeric provider amounts after verification rather than coercing them', async () => {
    const harness = buildHarness({ rawEvent: nowPaymentsEvent({ price_amount: 1.23 }) });

    await expect(harness.service.processWebhook(harness.payload as any)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Failed to normalize webhook event',
    });
    expect(harness.signatureService.verifySignature).toHaveBeenCalledTimes(1);
    expect(harness.providerAdapter.normalizeWebhookEvent).not.toHaveBeenCalled();
    expect(harness.paymentService.applyProviderResult).not.toHaveBeenCalled();
    expect(harness.replayGuard.markEventFailed).toHaveBeenCalledWith(
      PaymentProvider.NOWPAYMENTS,
      'np-payment-123',
      expect.stringContaining('exact decimal string'),
    );
  });
});
