// # Responsibility: custody integration surface - providers are wired ONLY through the gateway, master switch is fail-closed.
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { MetricsRegistry } from '../../../infrastructure/metrics/metrics.registry';
import { ConfirmationService } from '../confirmation.service';
import {
  ChainObservationService,
  EVM_CHAIN_PROVIDER_ID,
  TRON_CHAIN_PROVIDER_ID,
} from './chain-observation.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function configWith(overrides: Record<string, unknown>): AppConfigService {
  const base: Record<string, unknown> = {
    custodyChainProvidersEnabled: false,
    custodyChainEthereumRpcUrl: undefined,
    custodyChainBscRpcUrl: undefined,
    custodyChainPolygonRpcUrl: undefined,
    custodyChainArbitrumRpcUrl: undefined,
    custodyChainTronRpcUrl: undefined,
    custodyChainHostAllowlist: [],
    custodyChainHttpTimeoutMs: 5000,
    custodyChainMaxResponseBytes: 1048576,
    custodyChainBreakerThreshold: 5,
    ...overrides,
  };
  return base as unknown as AppConfigService;
}

describe('custody chain-provider integration (fail-closed master switch)', () => {
  it('disabled deployment: getProviderForNetwork refuses with a typed contract', () => {
    const gateway = new ChainObservationService(
      configWith({}),
      { getAsset: async () => null } as never,
      null,
    );
    try {
      gateway.getProviderForNetwork('ethereum');
      throw new Error('must refuse');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        const body = error.getResponse() as { code?: string };
        if (body.code !== 'CHAIN_PROVIDERS_DISABLED') {
          throw new Error(`typed code mismatch: ${body.code}`);
        }
      } else {
        throw error;
      }
    }
  });

  it('disabled deployment refuses even when endpoints are configured', () => {
    const gateway = new ChainObservationService(
      configWith({
        custodyChainEthereumRpcUrl: 'https://rpc.internal.example',
        custodyChainHostAllowlist: ['rpc.internal.example'],
      }),
      { getAsset: async () => null } as never,
      null,
    );
    expect(() => gateway.getProviderForNetwork('ethereum')).toThrow(/CHAIN_PROVIDERS|disabled/i);
  });

  it('enabled without endpoints: provider surface is empty, network-specific refusal', () => {
    const gateway = new ChainObservationService(
      configWith({ custodyChainProvidersEnabled: true }),
      { getAsset: async () => null } as never,
      null,
    );
    expect(() => gateway.getProviderForNetwork('arbitrum')).toThrow(/CHAIN_PROVIDER_UNAVAILABLE/);
  });

  it('enabled + endpoints: providers are keyed per network with stable ids', async () => {
    const gateway = new ChainObservationService(
      configWith({
        custodyChainProvidersEnabled: true,
        custodyChainEthereumRpcUrl: 'https://rpc.internal.example',
        custodyChainBscRpcUrl: 'https://rpc.internal.example',
        custodyChainTronRpcUrl: 'https://tron.internal.example',
        custodyChainHostAllowlist: ['rpc.internal.example', 'tron.internal.example'],
      }),
      { getAsset: async () => null } as never,
      null,
    );
    expect(gateway.getProviderForNetwork('ethereum').providerId).toBe(EVM_CHAIN_PROVIDER_ID);
    expect(gateway.getProviderForNetwork('bsc').providerId).toBe(EVM_CHAIN_PROVIDER_ID);
    expect(gateway.getProviderForNetwork('tron').providerId).toBe(TRON_CHAIN_PROVIDER_ID);
    expect(gateway.hasProviderForNetwork('polygon')).toBe(false);

    const availability = await gateway.describeAvailability();
    expect(availability.enabled).toBe(true);
    expect(availability.networks.map((n) => n.networkId).sort()).toEqual(['bsc', 'ethereum', 'tron']);
  });

  it('metrics registry boundaries: family registration happens, guard counter family present', async () => {
    const registry = new MetricsRegistry('wlct-api');
    const gateway = new ChainObservationService(
      configWith({
        custodyChainProvidersEnabled: true,
        custodyChainEthereumRpcUrl: 'https://rpc.internal.example',
        custodyChainHostAllowlist: ['rpc.internal.example'],
      }),
      { getAsset: async () => null } as never,
      registry,
    );
    expect(gateway).toBeInstanceOf(ChainObservationService);
    const names = registry.hasFamily('wlct_custody_chain_rpc_requests_total');
    expect(names).toBe(true);
    expect(registry.hasFamily('wlct_custody_chain_breaker_state')).toBe(true);
    expect(registry.hasFamily('wlct_custody_chain_observations_total')).toBe(true);
  });

  it('confirmation.service: without a chain surface the refresh refuses, ledger untouched', async () => {
    const svc = new (ConfirmationService as unknown as {
      new (
        prisma: unknown,
        custodyPolicyService: unknown,
        auditService: unknown,
        chainObservation?: unknown,
      ): ConfirmationService;
    })(
      { query: async () => [], execute: async () => 1 },
      { getRequiredConfirmations: async () => 12 },
      { recordConfirmationObserved: async () => {} },
      // chainObservation intentionally absent
    );
    try {
      await svc.refreshConfirmationsFromChain({ tenantId: TENANT, transactionId: 'tx-1' });
      throw new Error('must refuse');
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
    }
  });
});
