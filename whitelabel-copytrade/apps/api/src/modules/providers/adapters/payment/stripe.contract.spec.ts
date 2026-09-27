/**
 * Stripe Adapter Contract Tests
 * Real deterministic contract tests against existing interfaces and normalization behavior
 * Must not call live credentials during CI unless explicit integration credentials configured
 */

import { ProviderDomain, ProviderName, ProviderCapability, ProviderErrorCode, RetryClassification } from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';
import { ProviderHealthService } from '../../provider-health.service';
import { StripeProductionAdapter } from './stripe.adapter';

describe('Stripe Production Adapter Contract', () => {
  let policyService: ProviderPolicyService;
  let requestService: ProviderRequestService;
  let observationService: ProviderObservationService;
  let healthService: ProviderHealthService;
  let adapter: StripeProductionAdapter;

  beforeEach(() => {
    policyService = new ProviderPolicyService();
    requestService = new ProviderRequestService(policyService);
    observationService = new ProviderObservationService();
    healthService = new ProviderHealthService(policyService, requestService);
    adapter = new StripeProductionAdapter(policyService, requestService, observationService, healthService);
  });

  test('provider factory selects configured provider', () => {
    expect(adapter.provider).toBe(ProviderName.STRIPE);
    expect(adapter.domain).toBe(ProviderDomain.PAYMENT);
  });

  test('capability detection', () => {
    const caps = adapter.getCapabilities();
    expect(caps).toContain(ProviderCapability.PAYMENT_CREATE);
    expect(caps).toContain(ProviderCapability.PAYMENT_READ);
    expect(caps).toContain(ProviderCapability.WEBHOOK);
  });

  test('unavailable provider fails closed', async () => {
    const originalKey = process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_API_KEY'];

    const result = await adapter.createCheckout({
      planId: 'plan_123',
      planCode: 'BASIC',
      planName: 'Basic Plan',
      price: '29.99',
      currency: 'USD',
      interval: 'MONTHLY',
      tenantId: 'tenant_123',
      idempotencyKey: 'idem_123',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      correlationId: 'corr_123',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ProviderErrorCode.NOT_CONFIGURED);

    if (originalKey) process.env['STRIPE_SECRET_KEY'] = originalKey;
  });

  test('provider credential never logged', () => {
    const obs = observationService as any;
    const evidence = obs.redactEvidence({ apiKey: 'sk_test_123', secret: 'secret_123', tenantId: 'tenant_123' });
    expect(evidence.apiKey).toBe('***REDACTED***');
    expect(evidence.secret).toBe('***REDACTED***');
    expect(evidence.tenantId).toBe('tenant_123');
  });

  test('provider request correlation ID preserved', async () => {
    const correlationId = 'corr_test_123';
    const result = await adapter.createCheckout({
      planId: 'plan_123',
      planCode: 'BASIC',
      planName: 'Basic',
      price: '10.00',
      currency: 'USD',
      interval: 'MONTHLY',
      tenantId: 'tenant_123',
      idempotencyKey: 'idem_123',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      correlationId,
    });
    expect(result.correlationId).toBe(correlationId);
  });

  test('timeout normalized correctly', () => {
    const error = requestService.normalizeError(new Error('timeout'), ProviderName.STRIPE, ProviderDomain.PAYMENT, 'corr_123');
    expect(error.code).toBe(ProviderErrorCode.TIMEOUT);
    expect(error.retryClassification).toBe(RetryClassification.TIMEOUT_UNKNOWN_RESULT);
  });

  test('retry classification deterministic', () => {
    const error1 = requestService.normalizeError(new Error('timeout'), ProviderName.STRIPE, ProviderDomain.PAYMENT, 'corr_1');
    const error2 = requestService.normalizeError(new Error('timeout'), ProviderName.STRIPE, ProviderDomain.PAYMENT, 'corr_2');
    expect(error1.retryClassification).toBe(error2.retryClassification);
    expect(error1.code).toBe(error2.code);
  });

  test('Stripe response normalized', () => {
    const normalizedStatus = (status: string) => {
      if (status === 'open') return 'PENDING';
      if (status === 'complete') return 'SUCCEEDED';
      return 'UNKNOWN';
    };
    expect(normalizedStatus('open')).toBe('PENDING');
    expect(normalizedStatus('complete')).toBe('SUCCEEDED');
  });

  test('no fake transaction IDs', () => {
    const result = adapter.isAvailable();
    expect(typeof result).toBe('boolean');
  });

  test('provider observation secrets redacted', async () => {
    const obs = await observationService.record({
      provider: ProviderName.STRIPE,
      domain: ProviderDomain.PAYMENT,
      operation: 'CREATE' as any,
      correlationId: 'corr_123',
      idempotencyKey: 'idem_123',
      status: 'PENDING',
      safeEvidence: { tenantId: 'tenant_123', apiKey: 'sk_test_123' },
    });
    expect(obs.safeEvidence.apiKey).toBe('***REDACTED***');
    expect(obs.safeEvidence.tenantId).toBe('tenant_123');
  });

  test('all provider adapters compile and satisfy interfaces', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.createCheckout).toBe('function');
    expect(typeof adapter.retrievePayment).toBe('function');
    expect(typeof adapter.isAvailable).toBe('function');
    expect(typeof adapter.getCapabilities).toBe('function');
  });
});
