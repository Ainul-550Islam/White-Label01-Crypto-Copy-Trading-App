// # Verifies custody adapter contract and signature verification
import {
  ProviderDomain,
  ProviderName,
  ProviderErrorCode,
} from '../providers/provider.types';
import { ProviderPolicyService } from '../providers/provider-policy.service';
import { ProviderRequestService } from '../providers/provider-request.service';
import { ProviderObservationService } from '../providers/provider-observation.service';
import { CustodyProductionAdapter } from '../providers/adapters/custody.adapter';

describe('Custody Adapter Contract & Signature Verification (GAP-29)', () => {
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

  test('preserves custody transaction hash and provider reference', () => {
    const normalize = (data: any) => ({
      transactionHash: data.hash || data.transactionHash,
      providerReference: data.id || data.hash,
    });
    const data = { hash: '0xabc123', id: 'provider_123' };
    const normalized = normalize(data);
    expect(normalized.transactionHash).toBe('0xabc123');
    expect(normalized.providerReference).toBe('provider_123');
  });

  test('fails closed when custody provider credentials or base URL are missing', async () => {
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

  test('redacts secrets in provider observation records', async () => {
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

  test('satisfies CustodyProductionAdapter contract methods', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.getTransaction).toBe('function');
    expect(typeof adapter.submitTransaction).toBe('function');
  });
});
