// # Verifies canonical payment webhook normalization preserves exact values and unknown evidence
import {
  normalizePaymentWebhookPayload,
  type PaymentWebhookPayloadInput,
} from '../payment.adapter';

describe('Canonical payment webhook normalizer', () => {
  const input = (overrides: Partial<PaymentWebhookPayloadInput> = {}): PaymentWebhookPayloadInput => ({
    provider: 'NOWPAYMENTS',
    id: 'payment-123',
    status: 'finished',
    amount: '1.230000000000000001',
    currency: 'usdt',
    confirmations: 12,
    timestamp: '2026-10-08T00:00:00.123456Z',
    ...overrides,
  });

  it('keeps the exact decimal amount and maps a recognized confirmed status', () => {
    expect(normalizePaymentWebhookPayload(input())).toEqual({
      provider: 'NOWPAYMENTS',
      externalPaymentId: 'payment-123',
      status: 'CONFIRMED',
      amount: '1.230000000000000001',
      currency: 'USDT',
      confirmations: 12,
      occurredAtIso: '2026-10-08T00:00:00.123Z',
    });
  });

  it('keeps an unrecognized status UNKNOWN rather than claiming it is pending', () => {
    expect(normalizePaymentWebhookPayload(input({ status: 'provider-added-state' })).status).toBe('UNKNOWN');
  });

  it('does not treat NOWPayments confirmation-in-progress as final settlement', () => {
    expect(normalizePaymentWebhookPayload(input({ status: 'confirmed' })).status).toBe('PENDING');
    expect(normalizePaymentWebhookPayload(input({ status: 'confirming' })).status).toBe('PENDING');
    expect(normalizePaymentWebhookPayload(input({ status: 'finished' })).status).toBe('CONFIRMED');
  });

  it('withholds absent confirmations and timestamps instead of inventing zero or now', () => {
    const event = normalizePaymentWebhookPayload(input({ confirmations: null, timestamp: null }));
    expect(event.confirmations).toBeNull();
    expect(event.occurredAtIso).toBeNull();
  });

  it('rejects a JavaScript number amount instead of coercing a possibly rounded float', () => {
    expect(() => normalizePaymentWebhookPayload(input({ amount: 1.1 as unknown as string }))).toThrow(
      /exact decimal string/,
    );
  });

  it('rejects malformed and negative amounts', () => {
    expect(() => normalizePaymentWebhookPayload(input({ amount: '1.2.3' }))).toThrow();
    expect(() => normalizePaymentWebhookPayload(input({ amount: '-0.01' }))).toThrow(/negative/);
  });

  it('rejects malformed identity, currency, confirmation count, or event time', () => {
    expect(() => normalizePaymentWebhookPayload(input({ id: '   ' }))).toThrow(/event id/);
    expect(() => normalizePaymentWebhookPayload(input({ currency: 'USDT/USDC' }))).toThrow(/currency/);
    expect(() => normalizePaymentWebhookPayload(input({ confirmations: 1.5 }))).toThrow(/safe integer/);
    expect(() => normalizePaymentWebhookPayload(input({ timestamp: 'not-a-time' }))).toThrow(/ISO-8601/);
  });
});
