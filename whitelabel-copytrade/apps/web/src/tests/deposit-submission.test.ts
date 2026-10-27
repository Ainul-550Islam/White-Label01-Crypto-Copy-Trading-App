import { apiClient } from '@/api/api-client';
import { fundingApi } from '@/api/funding-api';

jest.mock('@/api/api-client', () => ({ apiClient: { post: jest.fn() } }));
const post = apiClient.post as jest.Mock;
const input = { accountId: 'account', amount: '10.000001', currency: 'USDT', externalReference: 'bank-ref', idempotencyKey: 'deposit-intent' };
const response = { id: 'deposit', accountId: 'account', requestedAmount: '10.000001', currency: 'USDT', state: 'REQUESTED' };
afterEach(() => jest.resetAllMocks());

test('deposit request sends the exact decimal and stable mutation key', async () => {
  post.mockResolvedValue(response);
  await expect(fundingApi.createDepositRequest(input)).resolves.toMatchObject({ id: 'deposit', state: 'REQUESTED', amount: '10.000001' });
  expect(post).toHaveBeenCalledWith('/v1/client-lifecycle/funding', {
    accountId: 'account', requestedAmount: '10.000001', currency: 'USDT', externalReference: 'bank-ref',
  }, { idempotencyKey: 'deposit-intent' });
});

test('rejects an empty reference locally without sending a mutation', async () => {
  await expect(fundingApi.createDepositRequest({ ...input, externalReference: '  ' })).rejects.toThrow('Invalid deposit reference');
  expect(post).not.toHaveBeenCalled();
});

test.each([
  { ...response, requestedAmount: '11' }, { ...response, currency: 'BTC' },
  { ...response, accountId: 'other' }, { ...response, id: '' },
  { ...response, state: 'FAILED' }, { ...response, state: 'CONFIRMED' },
])('rejects an unconfirmed acknowledgement %#', async (value) => {
  post.mockResolvedValue(value);
  await expect(fundingApi.createDepositRequest(input)).rejects.toThrow('Invalid deposit response');
});
