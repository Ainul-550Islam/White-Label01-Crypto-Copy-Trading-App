// # Contract-tests that NOWPayments IPNs fail closed and require a valid HMAC before normalization
import { createHmac } from 'crypto';
import { PaymentProvider } from './payment.types';
import { NowPaymentsAdapter } from './nowpayments.adapter';

const IPN_SECRET = 'contract-test-ipn-secret';
const CANONICAL_BODY = '{"details":{"a":"first","z":"last"},"payment_id":"np-payment-123","payment_status":"finished","price_amount":"1.23","price_currency":"USD"}';

function signCanonicalBody(body: string): string {
  return createHmac('sha512', IPN_SECRET).update(body, 'utf8').digest('hex');
}

function adapterWithSecret(secret: string | undefined): NowPaymentsAdapter {
  return new NowPaymentsAdapter({
    getNowPaymentsIpnSecret: () => secret,
  } as any);
}

describe('NOWPayments webhook signature contract', () => {
  const payload = {
    price_currency: 'USD',
    payment_status: 'finished',
    details: { z: 'last', a: 'first' },
    price_amount: '1.23',
    payment_id: 'np-payment-123',
  };

  it('accepts the recursively key-sorted HMAC and returns the signed event evidence', async () => {
    const adapter = adapterWithSecret(IPN_SECRET);
    const result = await adapter.verifyWebhookSignature({
      rawBody: JSON.stringify(payload),
      signature: signCanonicalBody(CANONICAL_BODY),
    });

    expect(result).toMatchObject({
      verified: true,
      eventId: 'np-payment-123',
      eventType: 'finished',
      rawEvent: payload,
    });
  });

  it('normalizes webhook amounts as exact decimal strings and refuses numeric coercion', async () => {
    const adapter = adapterWithSecret(IPN_SECRET);
    const normalized = await adapter.normalizeWebhookEvent({
      provider: PaymentProvider.NOWPAYMENTS,
      rawEvent: payload,
    });

    expect(normalized.amount).toEqual({ amount: '1.23', currency: 'USD' });
    expect(normalized.providerCreatedAt).toBeNull();
    await expect(adapter.normalizeWebhookEvent({
      provider: PaymentProvider.NOWPAYMENTS,
      rawEvent: { ...payload, price_amount: 1.23 },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects structurally valid payloads when the IPN secret is not configured', async () => {
    const adapter = adapterWithSecret(undefined);
    const result = await adapter.verifyWebhookSignature({
      rawBody: JSON.stringify(payload),
      signature: signCanonicalBody(CANONICAL_BODY),
    });

    expect(result).toMatchObject({
      verified: false,
      failureReason: 'NOWPayments IPN secret is not configured',
    });
  });

  it('rejects a missing signature even when the secret exists', async () => {
    const adapter = adapterWithSecret(IPN_SECRET);
    const result = await adapter.verifyWebhookSignature({
      rawBody: JSON.stringify(payload),
      signature: '',
    });

    expect(result).toMatchObject({
      verified: false,
      failureReason: 'NOWPayments IPN signature is missing',
    });
  });

  it('rejects malformed and incorrect signatures without throwing', async () => {
    const adapter = adapterWithSecret(IPN_SECRET);
    const malformed = await adapter.verifyWebhookSignature({
      rawBody: JSON.stringify(payload),
      signature: 'not-a-hex-hmac',
    });
    const mismatch = await adapter.verifyWebhookSignature({
      rawBody: JSON.stringify(payload),
      signature: signCanonicalBody(CANONICAL_BODY.replace('1.23', '9.99')),
    });

    expect(malformed).toMatchObject({ verified: false, failureReason: 'NOWPayments IPN signature has an invalid format' });
    expect(mismatch).toMatchObject({ verified: false, failureReason: 'Invalid NOWPayments IPN signature' });
  });

  it('rejects a validly signed event without an event id or provider status', async () => {
    const adapter = adapterWithSecret(IPN_SECRET);
    const noIdentity = { payment_status: 'finished', price_amount: '1.23', price_currency: 'USD' };
    const missingStatus = { payment_id: 'np-payment-123', price_amount: '1.23', price_currency: 'USD' };
    const canonical = (body: Record<string, unknown>) => JSON.stringify(body);
    const sign = (body: string) => createHmac('sha512', IPN_SECRET).update(body, 'utf8').digest('hex');

    const noIdentityResult = await adapter.verifyWebhookSignature({
      rawBody: JSON.stringify(noIdentity),
      signature: sign(canonical(noIdentity)),
    });
    const missingStatusResult = await adapter.verifyWebhookSignature({
      rawBody: JSON.stringify(missingStatus),
      signature: sign(canonical(missingStatus)),
    });

    expect(noIdentityResult).toMatchObject({ verified: false, failureReason: 'NOWPayments IPN event id or status is missing' });
    expect(missingStatusResult).toMatchObject({ verified: false, failureReason: 'NOWPayments IPN event id or status is missing' });
  });
});
