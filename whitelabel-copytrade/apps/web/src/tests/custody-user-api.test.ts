// # Responsibility: pins every customer custody route the funding screens call, including the POSTs that carry an idempotency key and the wallet path that must be encoded.

import { apiClient } from '@/api/api-client';
import { custodyUserApi } from '@/api/custody-user-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;

beforeEach(() => {
  get.mockResolvedValue({ data: [], total: 0 });
  post.mockResolvedValue({ id: 'row-1' });
});
afterEach(() => jest.resetAllMocks());

const BASE = '/v1/custody';

describe('reads', () => {
  it.each([
    ['listWallets', () => custodyUserApi.listWallets(), `${BASE}/wallets`],
    ['getWallet', () => custodyUserApi.getWallet('wallet-1'), `${BASE}/wallets/wallet-1`],
    ['getWalletBalance', () => custodyUserApi.getWalletBalance('wallet-1'), `${BASE}/balances/wallet/wallet-1`],
    ['listAddresses', () => custodyUserApi.listAddresses({ walletId: 'wallet-1' }), `${BASE}/addresses`],
    ['listTransactions', () => custodyUserApi.listTransactions({ status: 'CONFIRMED' }), `${BASE}/transactions`],
    ['getTransaction', () => custodyUserApi.getTransaction('tx-1'), `${BASE}/transactions/tx-1`],
    ['getConfirmations', () => custodyUserApi.getConfirmations('tx-1'), `${BASE}/confirmations/tx-1`],
    ['getActualFee', () => custodyUserApi.getActualFee('tx-1'), `${BASE}/fees/tx-1`],
    ['getPolicy', () => custodyUserApi.getPolicy(), `${BASE}/policy`],
    ['listAssets', () => custodyUserApi.listAssets(), `${BASE}/assets`],
    ['listNetworks', () => custodyUserApi.listNetworks(), `${BASE}/networks`],
    ['getProviderHealth', () => custodyUserApi.getProviderHealth(), `${BASE}/providers/health`],
  ])('%s reads %s', async (_name, call, path) => {
    await call();

    expect(get.mock.calls[0]?.[0]).toBe(path);
  });

  it('encodes ids and forwards transaction filters as search params', async () => {
    await custodyUserApi.getTransaction('tx/with slash');
    await custodyUserApi.listTransactions({ walletId: 'wallet-1', direction: 'DEPOSIT', page: 2, limit: 50 });

    expect(get).toHaveBeenNthCalledWith(1, `${BASE}/transactions/tx%2Fwith%20slash`);
    expect(get).toHaveBeenNthCalledWith(2, `${BASE}/transactions`, { searchParams: { walletId: 'wallet-1', direction: 'DEPOSIT', page: 2, limit: 50 } });
  });
});

describe('writes', () => {
  it.each([
    ['getOrCreateDepositAddress', () => custodyUserApi.getOrCreateDepositAddress({ walletId: 'wallet-1' }, 'key-a'), `${BASE}/deposit-addresses/get-or-create`],
    ['observeDeposit', () => custodyUserApi.observeDeposit({ walletId: 'wallet-1', txHash: '0xhash', amount: '1.000000000000', assetId: 'USDT', networkId: 'ethereum' }, 'key-b'), `${BASE}/deposits/observe`],
    ['pollTransaction', () => custodyUserApi.pollTransaction('tx-1', 'key-c'), `${BASE}/transactions/tx-1/poll`],
    ['estimateFee', () => custodyUserApi.estimateFee({ assetId: 'USDT', networkId: 'ethereum', amount: '10' }, 'key-d'), `${BASE}/fees/estimate`],
  ])('%s posts to %s with an idempotency key', async (_name, call, path) => {
    await call();

    const [calledPath, , options] = post.mock.calls[0] as [string, unknown, { idempotencyKey: string }];
    expect(calledPath).toBe(path);
    expect(options.idempotencyKey).toMatch(/^key-/);
  });

  it('sends the deposit amount as a decimal string, never a number', async () => {
    await custodyUserApi.observeDeposit({ walletId: 'wallet-1', txHash: '0xhash', amount: '0.000000000001', assetId: 'USDT', networkId: 'ethereum' }, 'key-e');

    expect(post.mock.calls[0]?.[1]).toMatchObject({ amount: '0.000000000001' });
  });
});
