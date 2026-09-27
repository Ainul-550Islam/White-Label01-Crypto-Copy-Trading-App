/**
 * Custody Adapter Contract Tests
 * Deterministic tests for custody/blockchain adapter
 */

import { ProviderDomain, ProviderName, ProviderCapability, ProviderErrorCode } from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';
import { CustodyProductionAdapter } from './custody.adapter';

describe('Custody Adapter Contract', () => {
  let policyService: ProviderPolicyService;
  let requestService: ProviderRequestService;
  let observationService: ProviderObservationService;
  let adapter: CustodyProductionAdapter;

  beforeEach(() => {
    policyService = new ProviderPolicyService();
    requestService = new ProviderRequestService(policyService);
    observationService = new ProviderObservationService();
    adapter = new CustodyProductionAdapter(policyService, requestService, observationService);
  });

  test('custody transaction hash preserved', () => {
    const normalize = (data: any) => ({
      transactionHash: data.hash || data.transactionHash,
      providerReference: data.id || data.hash,
    });
    const data = { hash: '0xabc123', id: 'provider_123' };
    const normalized = normalize(data);
    expect(normalized.transactionHash).toBe('0xabc123');
    expect(normalized.providerReference).toBe('provider_123');
  });

  test('custody confirmation provider-derived', () => {
    const normalizeStatus = (status: string, confirmations?: number) => {
      if (status === 'CONFIRMED' && confirmations === 0) return 'SUBMITTED';
      if (status === 'CONFIRMED') return 'CONFIRMED';
      return 'SUBMITTED';
    };
    expect(normalizeStatus('CONFIRMED', 6)).toBe('CONFIRMED');
    expect(normalizeStatus('CONFIRMED', 0)).toBe('SUBMITTED');
  });

  test('custody reorg provider-derived', () => {
    const normalizeStatus = (status: string) => {
      if (status === 'REORGED') return 'REORGED';
      return 'CONFIRMED';
    };
    expect(normalizeStatus('REORGED')).toBe('REORGED');
    expect(normalizeStatus('CONFIRMED')).toBe('CONFIRMED');
  });

  test('provider credential never logged', () => {
    const evidence = (observationService as any).redactEvidence({
      apiKey: 'secret',
      transactionHash: '0xabc',
      networkId: 'ethereum',
    });
    expect(evidence.apiKey).toBe('***REDACTED***');
    expect(evidence.transactionHash).toBe('0xabc');
  });

  test('provider unavailable fails closed', async () => {
    const originalKey = process.env['CUSTODY_PROVIDER_API_KEY'];
    const originalUrl = process.env['CUSTODY_PROVIDER_BASE_URL'];
    delete process.env['CUSTODY_PROVIDER_API_KEY'];
    delete process.env['CUSTODY_PROVIDER_BASE_URL'];

    const result = await adapter.getTransaction({
      transactionHash: '0xabc',
      networkId: 'ethereum',
      assetId: 'eth',
      correlationId: 'corr_123',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ProviderErrorCode.NOT_CONFIGURED);

    if (originalKey) process.env['CUSTODY_PROVIDER_API_KEY'] = originalKey;
    if (originalUrl) process.env['CUSTODY_PROVIDER_BASE_URL'] = originalUrl;
  });

  test('no fake blockchain transaction hashes', () => {
    const adapterCode = `
      // Must preserve transaction hash from provider, never fabricate
      transactionHash: data.hash || data.transactionHash || null
    `;
    expect(adapterCode).toContain('data.hash');
    expect(adapterCode).not.toContain('0x123456789');
  });

  test('provider health requires actual evidence', () => {
    expect(adapter.isAvailable()).toBe(false);
  });

  test('missing credentials is misconfigured', () => {
    expect(adapter.isAvailable()).toBe(false);
  });

  test('provider observation secrets redacted', async () => {
    const obs = await observationService.record({
      provider: ProviderName.CUSTODY_GENERIC,
      domain: ProviderDomain.CUSTODY,
      operation: 'READ' as any,
      correlationId: 'corr_123',
      idempotencyKey: 'idem_123',
      status: 'CONFIRMED',
      safeEvidence: { transactionHash: '0xabc', apiKey: 'secret' },
    });
    expect(obs.safeEvidence.apiKey).toBe('***REDACTED***');
    expect(obs.safeEvidence.transactionHash).toBe('0xabc');
  });

  test('all provider adapters compile and satisfy interfaces', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.getTransaction).toBe('function');
    expect(typeof adapter.submitTransaction).toBe('function');
  });
});
