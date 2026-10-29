// # Responsibility: build the chain-provider registry from validated env, expose per-network observation handles, fail closed.
/**
 * Master switch: CUSTODY_CHAIN_PROVIDERS_ENABLED (default false). While
 * false, every method refuses - the custody surface stays exactly as the
 * internal-ledger posture describes: deposits unverifiable on chain,
 * confirmation refresh impossible, no fabrication of either.
 *
 * When enabled the gateway constructs ONE allowlist-locked ChainHttpClient
 * and, per configured endpoint (https + allowlisted host - boot validation
 * already refused others), one provider. An enabled-but-empty registry means
 * "this deployment does not read that chain"; callers receive a typed
 * refusal rather than an invented observation.
 *
 * Provider ids are stable for observability: 'evm-json-rpc' and 'tron-grid'.
 */

import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { MetricsRegistry } from '../../../infrastructure/metrics/metrics.registry';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AssetRegistryService } from '../asset-registry.service';
import { BlockchainProvider } from '../blockchain-provider.interface';
import { ChainHttpClient, ChainHttpClientOptions } from './chain-http-client';
import { ChainMetrics, getCustodyChainMetrics, registerCustodyChainMetrics } from './chain-metrics';
import { ChainAssetIdentity, EvmJsonRpcProvider } from './evm-json-rpc.provider';
import { TronGridProvider } from './tron-grid.provider';

export const EVM_CHAIN_PROVIDER_ID = 'evm-json-rpc';
export const TRON_CHAIN_PROVIDER_ID = 'tron-grid';

export interface ChainObservationAvailability {
  enabled: boolean;
  networks: Array<{ networkId: string; providerId: string; healthy: boolean; reason?: string }>;
}

@Injectable()
export class ChainObservationService {
  private readonly logger = new Logger(ChainObservationService.name);
  private readonly metrics: ChainMetrics;
  private readonly providers: Map<string, BlockchainProvider> = new Map();
  private readonly enabled: boolean;

  constructor(
    private readonly config: AppConfigService,
    private readonly assetRegistry: AssetRegistryService,
    @Optional() private readonly registry: MetricsRegistry | null = null,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.metrics = this.registry ? registerCustodyChainMetrics(this.registry) : getCustodyChainMetrics(null);
    this.enabled = this.config.custodyChainProvidersEnabled;

    if (!this.enabled) {
      // Master switch off: keep zero provider material in memory.
      return;
    }

    const endpointEntries: Array<{ networkId: string; endpointUrl: string | undefined; kind: 'evm' | 'tron' }> = [
      { networkId: 'ethereum', endpointUrl: this.config.custodyChainEthereumRpcUrl, kind: 'evm' },
      { networkId: 'bsc', endpointUrl: this.config.custodyChainBscRpcUrl, kind: 'evm' },
      { networkId: 'polygon', endpointUrl: this.config.custodyChainPolygonRpcUrl, kind: 'evm' },
      { networkId: 'arbitrum', endpointUrl: this.config.custodyChainArbitrumRpcUrl, kind: 'evm' },
      { networkId: 'tron', endpointUrl: this.config.custodyChainTronRpcUrl, kind: 'tron' },
    ];

    if (endpointEntries.every((e) => !e.endpointUrl) || this.config.custodyChainHostAllowlist.length === 0) {
      // Enabled-with-empty-surface is a WARN, not a boot crash: zero-network
      // deployments are a legitimate rehearsal posture; every caller still
      // refuses via getProviderForNetwork.
      this.logger.warn(
        'CUSTODY_CHAIN_PROVIDERS_ENABLED=true yet no endpoint configured or empty host allowlist; chain observation surface is empty',
      );
      return;
    }

    const options: ChainHttpClientOptions = {
      allowlistedHosts: this.config.custodyChainHostAllowlist,
      timeoutMs: this.config.custodyChainHttpTimeoutMs,
      maxResponseBytes: this.config.custodyChainMaxResponseBytes,
      breakerThreshold: this.config.custodyChainBreakerThreshold,
    };
    const client = new ChainHttpClient(options);

    const resolveAsset = async (assetId: string, networkId: string): Promise<ChainAssetIdentity | null> => {
      const asset = await this.assetRegistry.getAsset({ assetId });
      if (!asset) return null;
      return {
        assetId: String(asset.assetId),
        networkId: String(asset.networkId ?? ''),
        symbol: String(asset.symbol),
        decimals: Number(asset.decimals),
        isNative: Boolean(asset.isNative),
        contractAddress: asset.contractAddress ?? null,
      };
    };

    for (const { networkId, endpointUrl, kind } of endpointEntries) {
      if (!endpointUrl) continue;
      const provider =
        kind === 'evm'
          ? new EvmJsonRpcProvider({
              providerId: EVM_CHAIN_PROVIDER_ID,
              providerName: `EVM JSON-RPC observation (${networkId})`,
              networkId,
              endpointUrl,
              client,
              resolveAsset,
              metrics: this.metrics,
              defaultRequiredConfirmations: 12,
            })
          : new TronGridProvider({
              providerId: TRON_CHAIN_PROVIDER_ID,
              providerName: `TronGrid observation (${networkId})`,
              networkId,
              endpointUrl,
              client,
              resolveAsset,
              metrics: this.metrics,
              defaultRequiredConfirmations: 19,
            });
      this.providers.set(networkId, provider);
    }
  }

  /** Observation provider for a network; refuses the entire surface when disabled/unconfigured. */
  getProviderForNetwork(networkId: string): BlockchainProvider {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        code: 'CHAIN_PROVIDERS_DISABLED',
        message:
          'CUSTODY_CHAIN_PROVIDERS_ENABLED=false: chain observation is disabled for this deployment. ' +
          'Custody flows must treat every chain read as unavailable; there is no silent fallback.',
      });
    }
    const provider = this.providers.get(networkId);
    if (!provider) {
      throw new ServiceUnavailableException({
        code: 'CHAIN_PROVIDER_UNAVAILABLE',
        message: `CHAIN_PROVIDER_UNAVAILABLE: no chain observation provider configured for network ${networkId}; the deployment keeps this network unverifiable rather than fabricating balances`,
      });
    }
    return provider;
  }

  hasProviderForNetwork(networkId: string): boolean {
    return this.enabled && this.providers.has(networkId);
  }

  async describeAvailability(): Promise<ChainObservationAvailability> {
    const networks: ChainObservationAvailability['networks'] = [];
    for (const [networkId, provider] of this.providers) {
      const health = await provider.isHealthy?.();
      networks.push({
        networkId,
        providerId: provider.providerId,
        healthy: health?.healthy ?? false,
        reason: health?.reason,
      });
    }
    return { enabled: this.enabled, networks };
  }
}
