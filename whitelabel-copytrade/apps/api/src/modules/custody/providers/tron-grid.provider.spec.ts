// # Responsibility: TronGridProvider surface spec (decimal parity, address decoding, fail-closed).
/**
 * Real code paths: post envelopes, sun↔TRX, TRC-20 simulation, tx info
 * fallback semantics. Every refusal path asserted via explicit throws (single
 * arg expect only).
 */

import { ChainHttpClient } from './chain-http-client';
import { ChainMetrics, ChainRpcResult } from './chain-metrics';
import { AssetResolver, ChainAssetIdentity } from './evm-json-rpc.provider';
import { TronGridProvider, tronInternals } from './tron-grid.provider';

const NETWORK = 'tron';
const PROVIDER = 'tron-grid';

const TRX: ChainAssetIdentity = {
  assetId: 'TRX',
  networkId: NETWORK,
  symbol: 'TRX',
  decimals: 6,
  isNative: true,
  contractAddress: null,
};
const USDT: ChainAssetIdentity = {
  assetId: 'USDT',
  networkId: NETWORK,
  symbol: 'USDT',
  decimals: 6,
  isNative: false,
  contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
};

/** Real TRON address used across TRON documentation; checksum valid. */
const HOLDER = 'TA4Y62o6YC2Zsck9rZVGTvqW1AQ7X9zTnj';

class RecordingMetrics implements ChainMetrics {
  rpc: Array<{ result: ChainRpcResult }> = [];
  observations = 0;
  recordRpc(entry: { result: ChainRpcResult }): void {
    this.rpc.push(entry);
  }
  recordBreakerState(): void {}
  recordObservation(): void {
    this.observations++;
  }
}

function stubAnswers(answers: Record<string, Array<unknown>>): { client: ChainHttpClient } {
  const client = {
    nextRequestId: () => 1,
    isCircuitOpen: () => false,
    postJson: async (url: string, _body: unknown, _label: string) => {
      const path = url.replace('https://tron.internal.example', '');
      const queue = answers[path];
      if (!queue || queue.length === 0) {
        throw new Error(`spec fixture missing answer for ${path}`);
      }
      return { status: 200, body: queue.shift() as unknown, host: 'tron.internal.example', latencyMs: 0 };
    },
  } as unknown as ChainHttpClient;
  return { client };
}

function makeProvider(answers: Record<string, Array<unknown>>) {
  const metrics = new RecordingMetrics();
  const { client } = stubAnswers(answers);
  const resolver: AssetResolver = async (assetId) => [TRX, USDT].find((a) => a.assetId === assetId) ?? null;
  const provider = new TronGridProvider({
    providerId: PROVIDER,
    providerName: 'spec',
    networkId: NETWORK,
    endpointUrl: 'https://tron.internal.example',
    client,
    resolveAsset: resolver,
    metrics,
    defaultRequiredConfirmations: 3,
  });
  return { provider, metrics };
}

describe('TronGridProvider', () => {
  it('native TRX balance in sun -> decimal parity', async () => {
    const { provider } = makeProvider({
      '/wallet/getaccount': [{ balance: 123_456_789 }], // 123.456789 TRX
    });
    const obs = await provider.getBalance({ networkId: NETWORK, assetId: 'TRX', address: HOLDER });
    if (obs.available !== '123.456789') throw new Error(`got ${obs.available}`);
  });

  it('never-activated account answers zero balance (chain-evidenced absence)', async () => {
    const { provider } = makeProvider({ '/wallet/getaccount': [{}] });
    const obs = await provider.getBalance({ networkId: NETWORK, assetId: 'TRX', address: HOLDER });
    if (obs.available !== '0.000000') throw new Error(`got ${obs.available}`);
  });

  it('TRC-20 balance via triggerconstantcontract; decimals respected', async () => {
    const { provider } = makeProvider({
      '/wallet/triggerconstantcontract': [{ constant_result: ['00000000000000000000000000000000000000000000000000bc614e'] }], // 0xbc614e = 12345678
    });
    const obs = await provider.getBalance({ networkId: NETWORK, assetId: 'USDT', address: HOLDER });
    if (obs.available !== '12.345678') throw new Error(`got ${obs.available}`);
  });

  it('base58check decode verifies checksum against known TRON address', () => {
    const decoded = tronInternals.base58CheckDecodeTron('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    if (decoded.length !== 21) throw new Error('payload must be 21 bytes');
    if (decoded[0] !== 0x41) throw new Error('TRON prefix must be 0x41');
    if (decoded.subarray(1).toString('hex') !== 'a614f803b6fd780986a42c78ec9c7f77e6ded13c'.toLowerCase()) {
      throw new Error('checksum-verified payload mismatch');
    }
  });

  it('checksum-corrupted base58 refuses (never simulates on fabricated bytes)', () => {
    let refused = false;
    try {
      tronInternals.base58CheckDecodeTron('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'); // last char flipped
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('flipped checksum must refuse');
  });

  it('hex and base58check parameter encodings agree', () => {
    const fromBase58 = tronInternals.tronAddressToHexParameter('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    const fromHex = tronInternals.tronAddressToHexParameter('0x41a614f803b6fd780986a42c78ec9c7f77e6ded13c'.slice(2).padStart(42, '41'));
    // Compare only after 41-stripping — address layout parity, not padding.
    if (fromBase58.slice(-40) !== fromHex.slice(-40)) throw new Error('hex/base58 contract parameter mismatch');
  });

  it('observation list: non-transfers skipped, transfer amounts parsed', async () => {
    const { provider } = makeProvider({
      [`/v1/accounts/${HOLDER}/transactions`]: [
        {
          data: [
            {
              txID: 'aa'.repeat(32),
              raw_data: {
                contract: [
                  {
                    type: 'TransferContract',
                    parameter: { value: { owner_address: HOLDER, to_address: 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn', amount: 5_000_000 } },
                  },
                ],
              },
            },
            {
              txID: 'bb'.repeat(32),
              raw_data: { contract: [{ type: 'VoteWitnessContract', parameter: {} }] },
            },
          ],
        },
      ],
    });
    const list = await provider.observeAddressTransactions({ networkId: NETWORK, assetId: 'TRX', address: HOLDER });
    if (list.length !== 1) throw new Error(`expected 1 transfer observation, got ${list.length}`);
    if (list[0].amount !== '5.000000') throw new Error(`amount ${list[0].amount}`);
    if (list[0].status !== 'OBSERVED') throw new Error(`status ${list[0].status}`);
  });

  it('transaction info absent -> tx is unindexed, confirmations null (no fabrication)', async () => {
    const { provider } = makeProvider({
      '/wallet/gettransactionbyid': [
        {
          txID: 'aa'.repeat(32),
          raw_data: {
            contract: [
              { type: 'TransferContract', parameter: { value: { owner_address: HOLDER, to_address: 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn', amount: 100 } } },
            ],
          },
        },
      ],
      '/wallet/gettransactioninfobyid': [{}],
    });
    const obs = await provider.getTransaction({ networkId: NETWORK, transactionHash: 'aa'.repeat(32), assetId: 'TRX' });
    if (!obs) throw new Error('expected observation for on-chain tx');
    if (obs.blockNumber !== null) throw new Error('info-absent tx must not carry fabricated block');
  });

  it('getConfirmations against tip: numeric delta, FINAL beyond 2x policy', async () => {
    const { provider } = makeProvider({
      '/wallet/gettransactionbyid': [
        {
          txID: 'cc'.repeat(32),
          raw_data: {
            contract: [
              { type: 'TransferContract', parameter: { value: { owner_address: HOLDER, to_address: 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn', amount: 1 } } },
            ],
          },
        },
      ],
      '/wallet/gettransactioninfobyid': [{ blockNumber: 4200, fee: 0 }],
      '/wallet/getnowblock': [{ block_header: { raw_data: { number: 4208 } } }],
    });
    const conf = await provider.getConfirmations({ networkId: NETWORK, transactionHash: 'cc'.repeat(32) });
    if (conf.confirmationCount !== 9) throw new Error(`confirmations ${conf.confirmationCount} != 9`);
    if (!conf.isFinal) throw new Error('expected final past 6 (=2x3)');
  });

  it('no configured asset -> typed refusal via registry', async () => {
    const { provider } = makeProvider({});
    await expect(provider.getBalance({ networkId: NETWORK, assetId: 'XRP-TRC10', address: HOLDER })).rejects.toThrow(
      /not in the custody registry/,
    );
  });

  it('rpc metrics: one entry per TronGrid round-trip', async () => {
    const { provider, metrics } = makeProvider({ '/wallet/getaccount': [{ balance: 0 }] });
    await provider.getBalance({ networkId: NETWORK, assetId: 'TRX', address: HOLDER });
    if (metrics.rpc.length !== 1) throw new Error('rpc metric missing');
    if (metrics.observations !== 1) throw new Error('observation metric missing');
  });
});
