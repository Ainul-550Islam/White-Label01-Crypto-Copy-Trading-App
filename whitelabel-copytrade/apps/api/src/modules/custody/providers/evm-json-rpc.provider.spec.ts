// # Responsibility: EvmJsonRpcProvider surface spec (decimal parity, fail-closed, red-path coverage).
/**
 * All chain answers are stubbed through an in-memory ChainHttpClient stub so
 * the provider runs the REAL code path: envelope validation, hex parity via
 * chain-amount, receipts, blocks, breaker-metric recording, no fabricated
 * balances. Test assertions use explicit `throw` checks to avoid the
 * multi-argument `expect` TS pattern that the repo's jest config rejects.
 */

import { ChainAmountError } from './chain-amount';
import { ChainHttpClient } from './chain-http-client';
import { ChainMetrics, ChainRpcResult } from './chain-metrics';
import { AssetResolver, ChainAssetIdentity, EvmJsonRpcProvider, evmInternals } from './evm-json-rpc.provider';

const NETWORK = 'ethereum';
const PROVIDER = 'evm-json-rpc';

const ETH: ChainAssetIdentity = {
  assetId: '00000000-0000-0000-0000-000000000001',
  networkId: NETWORK,
  symbol: 'ETH',
  decimals: 18,
  isNative: true,
  contractAddress: null,
};
const USDT: ChainAssetIdentity = {
  assetId: '00000000-0000-0000-0000-000000000002',
  networkId: NETWORK,
  symbol: 'USDT',
  decimals: 6,
  isNative: false,
  contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};

class RecordingMetrics implements ChainMetrics {
  rpc: Array<{ network: string; provider: string; result: ChainRpcResult; latencySeconds?: number }> = [];
  observations = 0;
  recordRpc(entry: { network: string; provider: string; result: ChainRpcResult; latencySeconds?: number }): void {
    this.rpc.push(entry);
  }
  recordBreakerState(): void {}
  recordObservation(): void {
    this.observations++;
  }
}

interface RpcAnswer { result?: unknown; error?: { code: number }; raw?: unknown }

function stubSequential(answers: Record<string, RpcAnswer[]>): {
  client: ChainHttpClient;
} {
  const client = {
    nextRequestId: () => 1,
    postJson: async (_url: string, body: unknown, _label: string) => {
      const method = (body as { method: string }).method;
      const queue = answers[method];
      if (!queue || queue.length === 0) {
        throw new Error(`spec fixture missing answer for ${method}`);
      }
      const answer = queue.shift()!;
      if ('raw' in answer) {
        return { status: 200, body: { jsonrpc: '2.0', id: 1, result: answer.raw } as unknown, host: 'x', latencyMs: 0 };
      }
      if ('error' in answer) {
        return { status: 200, body: { jsonrpc: '2.0', id: 1, error: answer.error } as unknown, host: 'x', latencyMs: 0 };
      }
      return { status: 200, body: { jsonrpc: '2.0', id: 1, result: answer.result } as unknown, host: 'x', latencyMs: 0 };
    },
    isCircuitOpen: () => false,
  } as unknown as ChainHttpClient;
  return { client };
}

function makeProvider(answers: Record<string, RpcAnswer[]>) {
  const metrics = new RecordingMetrics();
  const { client } = stubSequential(answers);
  const resolver: AssetResolver = async (assetId, networkId) => {
    for (const asset of [ETH, USDT]) {
      if (asset.assetId === assetId && asset.networkId === networkId) return asset;
    }
    return null;
  };
  const provider = new EvmJsonRpcProvider({
    providerId: PROVIDER,
    providerName: 'spec',
    networkId: NETWORK,
    endpointUrl: 'https://rpc.internal.example/x',
    client,
    resolveAsset: resolver,
    metrics,
    defaultRequiredConfirmations: 2,
  });
  return { provider, metrics };
}

describe('EvmJsonRpcProvider', () => {
  it('native balance: canonical 18 decimals, six-part string, observed', async () => {
    const { provider } = makeProvider({ eth_getBalance: [{ result: '0xde0b6b3a7640000' }] }); // 1 ETH
    const obs = await provider.getBalance({
      networkId: NETWORK,
      assetId: ETH.assetId,
      address: '0x' + 'ab'.repeat(20),
    });
    if (obs.available !== '1.000000000000000000') {
      throw new Error(`expected 1.000000000000000000 got ${obs.available}`);
    }
    if (obs.dataCompleteness !== 'CHAIN_EVIDENCE') throw new Error('observation must be marked chain-evidenced');
  });

  it('token balance via eth_call balanceOf: 6-decimal registry scale', async () => {
    // 12.345678 USDT = 12345678 in 6dp.
    const { provider } = makeProvider({
      eth_call: [{ result: '0x' + (12345678).toString(16).padStart(64, '0') }],
    });
    const obs = await provider.getBalance({
      networkId: NETWORK,
      assetId: USDT.assetId,
      address: '0x' + 'ab'.repeat(20),
    });
    if (obs.available !== '12.345678') throw new Error(`expected 12.345678 got ${obs.available}`);
  });

  it('refuses malformed EVM addresses before the wire', async () => {
    const { provider } = makeProvider({});
    await expect(
      provider.getBalance({ networkId: NETWORK, assetId: ETH.assetId, address: 'not-an-address' }),
    ).rejects.toThrow(/EVM address/);
  });

  it('refuses networks the provider is not bound to', async () => {
    const { provider } = makeProvider({});
    await expect(
      provider.getBalance({ networkId: 'bsc', assetId: ETH.assetId, address: '0x' + 'ab'.repeat(20) }),
    ).rejects.toThrow(/observes ethereum only/);
  });

  it('token without a canonical contract address refuses (registry truth wins)', async () => {
    const { client } = stubSequential({});
    const provider = new EvmJsonRpcProvider({
      providerId: PROVIDER,
      providerName: 'spec',
      networkId: NETWORK,
      endpointUrl: 'https://rpc.internal.example/x',
      client,
      resolveAsset: async () => ({ ...USDT, contractAddress: null }),
      defaultRequiredConfirmations: 2,
    });
    await expect(
      provider.getBalance({ networkId: NETWORK, assetId: USDT.assetId, address: '0x' + 'ab'.repeat(20) }),
    ).rejects.toThrow(/canonical contract address/);
  });

  it('JSON-RPC fault codes are protocol violations; message text never leaks upstream', async () => {
    const { provider } = makeProvider({ eth_getBalance: [{ error: { code: -32000 } }] });
    await expect(
      provider.getBalance({ networkId: NETWORK, assetId: ETH.assetId, address: '0x' + 'ab'.repeat(20) }),
    ).rejects.toThrow(/fault code=-32000/);
  });

  it('unmined transaction reports SUBMITTED with zero confirmations', async () => {
    const hash = '0x' + '11'.repeat(32);
    const { provider } = makeProvider({
      eth_getTransactionByHash: [
        {
          result: {
            hash,
            blockNumber: null,
            blockHash: null,
            from: '0x' + 'aa'.repeat(20),
            to: '0x' + 'bb'.repeat(20),
            value: '0xde0b6b3a7640000',
          },
        },
      ],
    });
    const obs = await provider.getTransaction({ networkId: NETWORK, transactionHash: hash, assetId: ETH.assetId });
    if (!obs) throw new Error('expected an observation for unmined tx');
    if (obs.status !== 'SUBMITTED') throw new Error(`unmined tx status ${obs.status}`);
    if (obs.confirmationCount !== 0) throw new Error('unmined tx cannot carry confirmations');
  });

  it('mined tx + receipt + block tip produce deterministic confirmations and fee', async () => {
    const hash = '0x' + '11'.repeat(32);
    const { provider } = makeProvider({
      eth_getTransactionByHash: [
        {
          result: {
            hash,
            blockNumber: '0x64', // 100
            blockHash: '0x' + 'aa'.repeat(32),
            from: '0x' + 'aa'.repeat(20),
            to: '0x' + 'bb'.repeat(20),
            value: '0xde0b6b3a7640000',
          },
        },
      ],
      eth_getTransactionReceipt: [{ result: { status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00' } }],
      eth_blockNumber: [{ result: '0x68' }], // 104 -> 5 confirmations
    });
    const obs = await provider.getTransaction({ networkId: NETWORK, transactionHash: hash, assetId: ETH.assetId });
    if (!obs) throw new Error('expected observation');
    if (obs.confirmationCount !== 5) throw new Error(`confirmations ${obs.confirmationCount} != 5`);
    if (obs.status !== 'FINAL') throw new Error(`expected FINAL (>=4 with policy 2), got ${obs.status}`);
    if (obs.fee !== '0.000021000000000000') throw new Error(`fee ${obs.fee} mismatch`);
  });

  it('canonical hex quantity parity rejects padded/0x08-shaped provider answers', async () => {
    const { provider } = makeProvider({
      eth_getBalance: [{ result: '0x08' }],
    });
    try {
      await provider.getBalance({ networkId: NETWORK, assetId: ETH.assetId, address: '0x' + 'ab'.repeat(20) });
      throw new Error('must refuse padded hex');
    } catch (error) {
      if (!(error instanceof ChainAmountError) && !/leading zer/i.test(String((error as Error).message))) {
        throw error;
      }
    }
  });

  it('rpc metrics recorded per call with latency and result', async () => {
    const { provider, metrics } = makeProvider({ eth_getBalance: [{ result: '0x0' }] });
    await provider.getBalance({ networkId: NETWORK, assetId: ETH.assetId, address: '0x' + 'ab'.repeat(20) });
    if (metrics.rpc.length !== 1) throw new Error('rpc metric not recorded');
    if (metrics.rpc[0].result !== 'ok') throw new Error(`result ${metrics.rpc[0].result}`);
    if (metrics.observations !== 1) throw new Error('observation counter not incremented');
  });

  it('estimateFee uses eth_gasPrice x 21,000 (native transfer envelope)', async () => {
    const { provider } = makeProvider({ eth_gasPrice: [{ result: '0x77359400' }] }); // 2 gwei
    const fee = await provider.estimateFee({
      networkId: NETWORK,
      assetId: ETH.assetId,
      fromAddress: '0x' + 'aa'.repeat(20),
      toAddress: '0x' + 'bb'.repeat(20),
      amount: '1.0',
    });
    if (fee.estimatedFee !== '0.000042000000000000') throw new Error(`fee ${fee.estimatedFee} mismatch`);
  });

  it('padToTopicAddress + topicToAddress round-trip', () => {
    const addr = '0x' + 'ab'.repeat(20);
    const topic = evmInternals.padToTopicAddress(addr);
    if (topic.length !== 66) throw new Error('topic must be 32 bytes hex');
    const decoded = evmInternals.topicToAddress(topic);
    if (decoded !== addr.toLowerCase()) throw new Error('address round-trip failed');
  });
});
