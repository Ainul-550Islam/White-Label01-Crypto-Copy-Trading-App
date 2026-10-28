import { apiClient } from '@/api/api-client';
import { depositAddressApi } from '@/api/deposit-address-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const get = apiClient.get as jest.Mock, post = apiClient.post as jest.Mock;
const requestId = '20000000-0000-4000-8000-000000000001', accountId = '20000000-0000-4000-8000-000000000002';
const option = { assetId: 'ETH', networkId: 'ethereum', currency: 'ETH', networkName: 'Ethereum', tokenStandard: null, contractAddress: null };
const view = { fundingRequestId: requestId, accountId, assetId: 'ETH', networkId: 'ethereum', currency: 'ETH', address: `0x${'a'.repeat(40)}`,
  status: 'ADDRESS_VERIFIED', settlementStatus: 'NOT_CONFIRMED', monitoringStatus: 'NOT_CONNECTED', verifiedAt: '2026-10-27T00:00:00.000Z' };
const path = `/v1/client-lifecycle/funding/${requestId}/deposit-address`;
afterEach(() => jest.resetAllMocks());

test('reads customer-scoped configured choices and provider-verified addresses', async () => {
  get.mockResolvedValueOnce([option]).mockResolvedValueOnce(view);
  await expect(depositAddressApi.listAssets(requestId)).resolves.toEqual([option]);
  await expect(depositAddressApi.get(requestId, option)).resolves.toEqual(view);
  expect(get).toHaveBeenNthCalledWith(1, `${path}/assets`);
  expect(get).toHaveBeenNthCalledWith(2, path, { searchParams: { assetId: 'ETH', networkId: 'ethereum' } });
});

test('issues with the exact intent and retained idempotency key', async () => {
  post.mockResolvedValue(view);
  await expect(depositAddressApi.issue(requestId, option, 'same-retry-key')).resolves.toEqual(view);
  expect(post).toHaveBeenCalledWith(path, { assetId: 'ETH', networkId: 'ethereum' }, { idempotencyKey: 'same-retry-key' });
});

test.each([
  { ...view, fundingRequestId: 'other' }, { ...view, accountId: 'not-a-uuid' }, { ...view, assetId: 'USDT' },
  { ...view, networkId: 'testnet' }, { ...view, currency: 'BTC' }, { ...view, address: `0x${'0'.repeat(40)}` },
  { ...view, status: 'CONFIRMED' }, { ...view, settlementStatus: 'CONFIRMED' }, { ...view, monitoringStatus: 'CONNECTED' },
  { ...view, verifiedAt: 'invalid' },
])('refuses mismatched or overstated address response %#', async (invalid) => {
  post.mockResolvedValue(invalid);
  await expect(depositAddressApi.issue(requestId, option, 'same-retry-key')).rejects.toThrow();
});

test.each([
  { ...option, networkId: 'testnet' }, { ...option, contractAddress: '0xabc' },
  { ...option, tokenStandard: 'ERC20', contractAddress: null }, { ...option, currency: 'eth' },
])('refuses malformed asset option %#', async (invalid) => {
  get.mockResolvedValue([invalid]);
  await expect(depositAddressApi.listAssets(requestId)).rejects.toThrow();
});

test('looks up only the selected address and reports observation, never settlement', async () => {
  const transactionHash = `0x${'c'.repeat(64)}`;
  const result = { status: 'OBSERVED', fundingRequestId: requestId, assetId: 'ETH', currency: 'ETH',
    transactionHash, destinationAddress: view.address, amount: '1.000000000000000001', rawUnits: '1000000000000000001',
    confirmationCount: 40, logIndex: null, amountEvidence: 'PROVIDER_REPORTED', settlementStatus: 'NOT_CONFIRMED',
    monitoringStatus: 'LOOKUP_ONLY', complianceStatus: 'NOT_EVALUATED' };
  get.mockResolvedValue(result);
  await expect(depositAddressApi.observeTransfer(requestId, option, view.address, transactionHash)).resolves.toEqual(result);
  expect(get).toHaveBeenCalledWith(`${path}/transactions/${transactionHash}`,
    { searchParams: { assetId: 'ETH', networkId: 'ethereum' } });
});

test.each([
  { status: 'SETTLED' }, { fundingRequestId: accountId }, { assetId: 'USDT' }, { currency: 'USDT' },
  { destinationAddress: `0x${'b'.repeat(40)}` }, { transactionHash: `0x${'d'.repeat(64)}` },
  { amount: '0.000000000000000000' }, { amount: '1e3' }, { rawUnits: '0' }, { confirmationCount: 0 },
  { amountEvidence: 'TRANSFER_LOG_MATCHED', logIndex: null }, { settlementStatus: 'CONFIRMED' },
  { monitoringStatus: 'CONNECTED' }, { complianceStatus: 'APPROVED' },
])('refuses mismatched or overstated transfer observation %#', async (change) => {
  const transactionHash = `0x${'c'.repeat(64)}`;
  get.mockResolvedValue({ status: 'OBSERVED', fundingRequestId: requestId, assetId: 'ETH', currency: 'ETH', transactionHash,
    destinationAddress: view.address, amount: '1', rawUnits: '1000000000000000000', confirmationCount: 12, logIndex: null,
    amountEvidence: 'PROVIDER_REPORTED', settlementStatus: 'NOT_CONFIRMED', monitoringStatus: 'LOOKUP_ONLY',
    complianceStatus: 'NOT_EVALUATED', ...change });
  await expect(depositAddressApi.observeTransfer(requestId, option, view.address, transactionHash)).rejects.toThrow();
});

test('rejects an invalid transaction hash before it can affect a URL', async () => {
  await expect(depositAddressApi.observeTransfer(requestId, option, view.address, '../invalid')).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});

test('does not accept an interpolated or non-UUID request identity', async () => {
  await expect(depositAddressApi.listAssets('../other')).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
