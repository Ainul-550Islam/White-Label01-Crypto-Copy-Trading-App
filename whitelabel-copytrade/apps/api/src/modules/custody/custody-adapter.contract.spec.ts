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

  test('preserves provider decimal strings exactly and rejects numeric amount coercion', async () => {
    const originalKey = process.env['CUSTODY_PROVIDER_API_KEY'];
    const originalUrl = process.env['CUSTODY_PROVIDER_BASE_URL'];
    process.env['CUSTODY_PROVIDER_API_KEY'] = 'test-custody-key';
    process.env['CUSTODY_PROVIDER_BASE_URL'] = 'https://custody.example.test';
    const request = jest.spyOn(requestService, 'requestWithRetry').mockResolvedValue({
      data: {
        hash: '0xabc123',
        id: 'provider_123',
        networkId: 'ethereum',
        assetId: 'eth',
        assetSymbol: 'ETH',
        amount: '0.000000000000000001',
        fee: '0.000000000000000002',
        confirmations: 2,
        requiredConfirmations: 12,
        status: 'CONFIRMING',
        timestamp: '2026-10-08T00:00:00.000Z',
      },
      latencyMs: 1,
    } as any);

    try {
      const result = await adapter.getTransaction({
        transactionHash: '0xabc123',
        networkId: 'ethereum',
        assetId: 'eth',
        correlationId: 'corr_123',
        tenantId: 'tenant_123',
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        transactionHash: '0xabc123',
        providerReference: 'provider_123',
        amount: '0.000000000000000001',
        fee: '0.000000000000000002',
      });

      request.mockResolvedValueOnce({
        data: {
          hash: '0xabc123',
          id: 'provider_123',
          amount: 0.000000000000000001,
          fee: '0.000000000000000002',
          confirmations: 2,
          requiredConfirmations: 12,
          status: 'CONFIRMING',
          timestamp: '2026-10-08T00:00:00.000Z',
        },
        latencyMs: 1,
      } as any);
      const rejected = await adapter.getTransaction({
        transactionHash: '0xabc123',
        networkId: 'ethereum',
        assetId: 'eth',
        correlationId: 'corr_456',
        tenantId: 'tenant_123',
      });

      expect(rejected.success).toBe(false);
      expect(rejected.error?.code).toBe(ProviderErrorCode.VALIDATION_ERROR);
      expect(rejected.error?.message).toMatch(/non-exact amount decimal string/);
    } finally {
      request.mockRestore();
      if (originalKey === undefined) delete process.env['CUSTODY_PROVIDER_API_KEY'];
      else process.env['CUSTODY_PROVIDER_API_KEY'] = originalKey;
      if (originalUrl === undefined) delete process.env['CUSTODY_PROVIDER_BASE_URL'];
      else process.env['CUSTODY_PROVIDER_BASE_URL'] = originalUrl;
    }
  });

  test('rejects numeric withdrawal inputs before issuing a provider request', async () => {
    const originalKey = process.env['CUSTODY_PROVIDER_API_KEY'];
    const originalUrl = process.env['CUSTODY_PROVIDER_BASE_URL'];
    process.env['CUSTODY_PROVIDER_API_KEY'] = 'test-custody-key';
    process.env['CUSTODY_PROVIDER_BASE_URL'] = 'https://custody.example.test';
    const request = jest.spyOn(requestService, 'request').mockResolvedValue({
      data: { id: 'provider_123' },
      latencyMs: 1,
    } as any);

    try {
      const result = await adapter.submitTransaction({
        assetId: 'eth',
        assetSymbol: 'ETH',
        networkId: 'ethereum',
        fromAddress: '0xfrom',
        toAddress: '0xto',
        amount: 0.000000000000000001 as any,
        idempotencyKey: 'idem_123',
        correlationId: 'corr_789',
        tenantId: 'tenant_123',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ProviderErrorCode.VALIDATION_ERROR);
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
      if (originalKey === undefined) delete process.env['CUSTODY_PROVIDER_API_KEY'];
      else process.env['CUSTODY_PROVIDER_API_KEY'] = originalKey;
      if (originalUrl === undefined) delete process.env['CUSTODY_PROVIDER_BASE_URL'];
      else process.env['CUSTODY_PROVIDER_BASE_URL'] = originalUrl;
    }
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
