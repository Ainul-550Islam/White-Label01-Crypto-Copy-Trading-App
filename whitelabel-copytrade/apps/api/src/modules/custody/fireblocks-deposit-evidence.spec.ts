import { matchIssuedEvmDeposit, type IssuedEvmDepositBinding } from './fireblocks-deposit-evidence';
import type { FireblocksEvmReceipt, FireblocksFinalTransaction } from './fireblocks-vault.client';

const source = `0x${'12'.repeat(20)}`;
const destination = `0x${'34'.repeat(20)}`;
const contract = `0x${'56'.repeat(20)}`;
const transactionHash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const transfer = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topic = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
const value = (amount: bigint) => `0x${amount.toString(16).padStart(64, '0')}`;

function binding(overrides: Partial<IssuedEvmDepositBinding> = {}): IssuedEvmDepositBinding {
  return { networkId: 'ethereum', chainId: '1', providerAssetId: 'USDC_ETH', providerNativeAssetId: 'ETH',
    vaultId: '42', customerRefId: 'account-ref', address: destination, decimals: 6, isNative: false, contractAddress: contract, ...overrides };
}
function tx(overrides: Partial<FireblocksFinalTransaction> = {}): FireblocksFinalTransaction {
  return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assetId: 'USDC_ETH', destinationVaultId: '42',
    destinationAddress: destination, destinationTag: null, sourceType: 'UNKNOWN', sourceId: null, sourceAddress: source,
    customerRefId: 'account-ref', subStatus: 'CONFIRMED',
    compliance: { status: null, aml: null, amlList: [], travelRule: null },
    transactionHash, netAmount: '1.000001', confirmationCount: 40, blockHash, blockNumber: '123', providerIndex: 2, ...overrides };
}
function receipt(overrides: Partial<FireblocksEvmReceipt> = {}): FireblocksEvmReceipt {
  return { transactionHash, blockHash, blockNumber: '123', transactionIndex: 3, from: source, to: contract,
    logs: [{ address: contract, topics: [transfer, topic(source), topic(destination)], data: value(1000001n), logIndex: 7 }], ...overrides };
}

describe('issued Ethereum deposit observation', () => {
  it('matches the exact token transfer without confusing the provider index or transaction index for the log index', () => {
    expect(matchIssuedEvmDeposit(binding(), tx(), receipt())).toEqual({
      status: 'OBSERVED', transactionId: tx().id, transactionHash, destinationAddress: destination, sourceAddress: source,
      providerAssetId: 'USDC_ETH', amount: '1.000001', rawUnits: '1000001', blockHash, blockNumber: '123',
      confirmationCount: 40, logIndex: 7, amountEvidence: 'TRANSFER_LOG_MATCHED',
    });
  });

  it('labels a native amount as provider-reported rather than a verified receipt value', () => {
    const b = binding({ providerAssetId: 'ETH', decimals: 18, isNative: true, contractAddress: null });
    const t = tx({ assetId: 'ETH', netAmount: '0.000000000000000001' });
    const r = receipt({ to: destination, logs: [] });
    expect(matchIssuedEvmDeposit(b, t, r)).toMatchObject({ status: 'OBSERVED', rawUnits: '1', logIndex: null,
      amountEvidence: 'PROVIDER_REPORTED' });
  });

  it.each([
    { networkId: 'arbitrum' }, { chainId: '2' }, { providerNativeAssetId: 'ETH_TEST' },
    { vaultId: '43' }, { providerAssetId: 'OTHER' }, { address: source },
    { customerRefId: 'different' }, { contractAddress: source }, { decimals: 2 },
  ])('refuses a different or inconsistent verified issuance: %j', (change) => {
    expect(() => matchIssuedEvmDeposit(binding(change), tx(), receipt())).toThrow();
  });

  it.each([
    { destinationVaultId: '43' }, { assetId: 'OTHER' }, { destinationAddress: source },
    { destinationTag: 'memo' }, { sourceAddress: null }, { sourceAddress: destination },
    { sourceType: 'VAULT_ACCOUNT' }, { customerRefId: 'other-account' },
    { transactionHash: `0x${'99'.repeat(32)}` }, { blockHash: `0x${'99'.repeat(32)}` },
    { blockNumber: '124' }, { confirmationCount: 0 }, { netAmount: '1.0000001' },
    { netAmount: '0' }, { netAmount: '-1' }, { netAmount: '1e3' },
  ])('refuses mismatched, internal, unconfirmed or inexact transaction data: %j', (change) => {
    expect(() => matchIssuedEvmDeposit(binding(), tx(change), receipt())).toThrow();
  });

  it('accepts only representable subunits, without truncating the precision', () => {
    const r = receipt({ logs: [{ ...receipt().logs[0]!, data: value(1000000n) }] });
    expect(matchIssuedEvmDeposit(binding(), tx({ netAmount: '1.000000000' }), r).rawUnits).toBe('1000000');
    expect(() => matchIssuedEvmDeposit(binding(), tx({ netAmount: '1.000000001' }), r)).toThrow();
  });

  it('refuses zero, multiple, wrong-contract, wrong-sender and wrong-amount transfer events', () => {
    const good = receipt().logs[0]!;
    for (const logs of [[], [good, { ...good, logIndex: 8 }], [{ ...good, address: source }],
      [{ ...good, topics: [transfer, topic(destination), topic(destination)] }], [{ ...good, data: value(1000000n) }],
      [{ ...good, topics: [transfer, '0x1', topic(destination)] }]]) {
      expect(() => matchIssuedEvmDeposit(binding(), tx(), receipt({ logs }))).toThrow();
    }
  });

  it('refuses a native transfer whose receipt is not from and to the bound addresses', () => {
    const b = binding({ providerAssetId: 'ETH', decimals: 18, isNative: true, contractAddress: null });
    const t = tx({ assetId: 'ETH', netAmount: '1' });
    expect(() => matchIssuedEvmDeposit(b, t, receipt({ to: source }))).toThrow();
    expect(() => matchIssuedEvmDeposit(b, t, receipt({ from: destination, to: destination }))).toThrow();
  });
});
