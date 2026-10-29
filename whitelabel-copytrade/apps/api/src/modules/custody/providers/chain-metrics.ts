// # Responsibility: register and record custody chain-observation metric families on the scoped MetricsRegistry.
/**
 * Family names live in the chain surface here and nowhere else; labels are
 * restricted to the allow-list parity contract between `metrics.registry.ts`
 * (TS) and `labels.py` (Python): network, provider, result.
 *
 * Families (namespace `wlct_`, per platform convention):
 *   - wlct_custody_chain_rpc_requests_total {network, provider, result}
 *   - wlct_custody_chain_rpc_latency_seconds {network, provider} (histogram)
 *   - wlct_custody_chain_breaker_state {network, provider} (gauge: 1 open)
 *   - wlct_custody_chain_observations_total {network, provider}
 */

import { HTTP_BUCKETS_SECONDS, MetricsRegistry } from '../../../infrastructure/metrics/metrics.registry';

export const CHAIN_RPC_RESULTS = Object.freeze([
  'ok',
  'breaker_open',
  'transport_error',
  'protocol_error',
  'timeout',
  'config',
] as const);

export type ChainRpcResult = (typeof CHAIN_RPC_RESULTS)[number];

export interface ChainMetrics {
  recordRpc(opts: { network: string; provider: string; result: ChainRpcResult; latencySeconds?: number }): void;
  recordBreakerState(opts: { network: string; provider: string; open: boolean }): void;
  recordObservation(opts: { network: string; provider: string }): void;
}

const noopMetrics: ChainMetrics = {
  recordRpc: () => {},
  recordBreakerState: () => {},
  recordObservation: () => {},
};

/** Idempotent per-registry registration (safe on repeat boot materials). */
export function registerCustodyChainMetrics(registry: MetricsRegistry): ChainMetrics {
  if (!registry.hasFamily('wlct_custody_chain_rpc_requests_total')) {
    registry.registerCounter(
      'wlct_custody_chain_rpc_requests_total',
      'Chain RPC call outcomes by network and provider (observation-only surface).',
      ['network', 'provider', 'result'],
    );
    registry.registerHistogram(
      'wlct_custody_chain_rpc_latency_seconds',
      'Chain RPC round-trip latency in seconds per network and provider.',
      ['network', 'provider'],
      { buckets: HTTP_BUCKETS_SECONDS },
    );
    registry.registerGauge(
      'wlct_custody_chain_breaker_state',
      'Per-network RPC breaker state (1 = open/refusing, 0 = closed).',
      ['network', 'provider'],
    );
    registry.registerCounter(
      'wlct_custody_chain_observations_total',
      'Custody observations answered with chain evidence, by network and provider.',
      ['network', 'provider'],
    );
  }
  return wrap(registry);
}

/** Always-callable handle; recording is a no-op until a registry is supplied. */
export function getCustodyChainMetrics(registry?: MetricsRegistry | null): ChainMetrics {
  if (!registry) return noopMetrics;
  return wrap(registry);
}

function wrap(registry: MetricsRegistry): ChainMetrics {
  return {
    recordRpc: ({ network, provider, result, latencySeconds }) => {
      registry.inc('wlct_custody_chain_rpc_requests_total', { network, provider, result });
      if (typeof latencySeconds === 'number' && Number.isFinite(latencySeconds) && latencySeconds >= 0) {
        registry.observe('wlct_custody_chain_rpc_latency_seconds', { network, provider }, latencySeconds);
      }
    },
    recordBreakerState: ({ network, provider, open }) => {
      registry.setGauge('wlct_custody_chain_breaker_state', { network, provider }, open ? 1 : 0);
    },
    recordObservation: ({ network, provider }) => {
      registry.inc('wlct_custody_chain_observations_total', { network, provider });
    },
  };
}
