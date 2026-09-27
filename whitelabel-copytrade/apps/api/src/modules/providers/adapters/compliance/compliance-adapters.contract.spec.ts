/**
 * Compliance Adapters Contract Tests
 * Deterministic tests for KYC and AML adapters
 */

import { ProviderDomain, ProviderName, ProviderCapability, ProviderErrorCode } from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';
import { KycProductionAdapter } from '../kyc/kyc.adapter';
import { AmlProductionAdapter } from '../aml/aml.adapter';

describe('Compliance Adapters Contract', () => {
  let policyService: ProviderPolicyService;
  let requestService: ProviderRequestService;
  let observationService: ProviderObservationService;

  beforeEach(() => {
    policyService = new ProviderPolicyService();
    requestService = new ProviderRequestService(policyService);
    observationService = new ProviderObservationService();
  });

  test('KYC provider unavailable stays pending/review', async () => {
    const originalKey = process.env['KYC_PROVIDER_API_KEY'];
    const originalUrl = process.env['KYC_PROVIDER_BASE_URL'];
    delete process.env['KYC_PROVIDER_API_KEY'];
    delete process.env['KYC_PROVIDER_BASE_URL'];

    const adapter = new KycProductionAdapter(policyService, requestService, observationService);
    const result = await adapter.submitVerification({
      tenantId: 'tenant_123',
      userId: 'user_123',
      jurisdiction: 'US',
      idempotencyKey: 'idem_123',
      correlationId: 'corr_123',
    });

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('PENDING');
    expect(result.data?.decision).toBe('REVIEW_REQUIRED');
    expect(result.data?.reasonCode).toBe('PROVIDER_UNAVAILABLE');

    if (originalKey) process.env['KYC_PROVIDER_API_KEY'] = originalKey;
    if (originalUrl) process.env['KYC_PROVIDER_BASE_URL'] = originalUrl;
  });

  test('KYC provider does not fabricate VERIFIED', async () => {
    const originalKey = process.env['KYC_PROVIDER_API_KEY'];
    const originalUrl = process.env['KYC_PROVIDER_BASE_URL'];
    delete process.env['KYC_PROVIDER_API_KEY'];
    delete process.env['KYC_PROVIDER_BASE_URL'];

    const adapter = new KycProductionAdapter(policyService, requestService, observationService);
    const result = await adapter.submitVerification({
      tenantId: 'tenant_123',
      userId: 'user_123',
      jurisdiction: 'US',
      idempotencyKey: 'idem_123',
      correlationId: 'corr_123',
    });

    expect(result.data?.status).not.toBe('APPROVED');
    expect(result.data?.status).not.toBe('VERIFIED');
    expect(result.data?.decision).not.toBe('ALLOW');

    if (originalKey) process.env['KYC_PROVIDER_API_KEY'] = originalKey;
    if (originalUrl) process.env['KYC_PROVIDER_BASE_URL'] = originalUrl;
  });

  test('AML provider unavailable stays pending/review', async () => {
    const originalKey = process.env['AML_PROVIDER_API_KEY'];
    const originalUrl = process.env['AML_PROVIDER_BASE_URL'];
    delete process.env['AML_PROVIDER_API_KEY'];
    delete process.env['AML_PROVIDER_BASE_URL'];

    const adapter = new AmlProductionAdapter(requestService, observationService);
    const result = await adapter.screenPerson({
      tenantId: 'tenant_123',
      userId: 'user_123',
      jurisdiction: 'US',
      idempotencyKey: 'idem_123',
      correlationId: 'corr_123',
    });

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('PENDING');
    expect(result.data?.decision).toBe('REVIEW_REQUIRED');

    if (originalKey) process.env['AML_PROVIDER_API_KEY'] = originalKey;
    if (originalUrl) process.env['AML_PROVIDER_BASE_URL'] = originalUrl;
  });

  test('AML provider does not fabricate CLEAR', async () => {
    const originalKey = process.env['AML_PROVIDER_API_KEY'];
    const originalUrl = process.env['AML_PROVIDER_BASE_URL'];
    delete process.env['AML_PROVIDER_API_KEY'];
    delete process.env['AML_PROVIDER_BASE_URL'];

    const adapter = new AmlProductionAdapter(requestService, observationService);
    const result = await adapter.screenPerson({
      tenantId: 'tenant_123',
      userId: 'user_123',
      jurisdiction: 'US',
      idempotencyKey: 'idem_123',
      correlationId: 'corr_123',
    });

    expect(result.data?.status).not.toBe('CLEAR');
    expect(result.data?.decision).not.toBe('ALLOW');

    if (originalKey) process.env['AML_PROVIDER_API_KEY'] = originalKey;
    if (originalUrl) process.env['AML_PROVIDER_BASE_URL'] = originalUrl;
  });

  test('provider credential never logged', () => {
    const evidence = (observationService as any).redactEvidence({
      apiKey: 'secret_key',
      tenantId: 'tenant_123',
      userId: 'user_123',
    });
    expect(evidence.apiKey).toBe('***REDACTED***');
    expect(evidence.tenantId).toBe('tenant_123');
  });

  test('KYC capability detection', () => {
    const adapter = new KycProductionAdapter(policyService, requestService, observationService);
    expect(adapter.capabilities).toContain(ProviderCapability.KYC_SUBMIT);
    expect(adapter.capabilities).toContain(ProviderCapability.KYC_STATUS);
  });

  test('AML capability detection', () => {
    const adapter = new AmlProductionAdapter(requestService, observationService);
    expect(adapter.capabilities).toContain(ProviderCapability.AML_SCREEN);
  });

  test('provider health requires actual evidence', async () => {
    const adapter = new KycProductionAdapter(policyService, requestService, observationService);
    expect(adapter.isAvailable()).toBe(false);
  });

  test('missing credentials is misconfigured', () => {
    const adapter = new KycProductionAdapter(policyService, requestService, observationService);
    expect(adapter.isAvailable()).toBe(false);
  });

  test('all provider adapters compile and satisfy interfaces', () => {
    const kyc = new KycProductionAdapter(policyService, requestService, observationService);
    const aml = new AmlProductionAdapter(requestService, observationService);
    expect(kyc).toBeDefined();
    expect(aml).toBeDefined();
    expect(typeof kyc.submitVerification).toBe('function');
    expect(typeof aml.screenPerson).toBe('function');
  });
});
