import { apiClient } from '@/api/api-client';
import { fundingApi } from '@/api/funding-api';

jest.mock('@/api/api-client', () => ({ apiClient: { post: jest.fn() } }));
const post = apiClient.post as jest.Mock;
const input = { accountId: 'account', amount: '10.000001', currency: 'USDT', destinationAddress: '0xabc', destinationType: 'ETHEREUM', idempotencyKey: 'withdrawal-intent' };
const response = { id: 'withdrawal', accountId: 'account', requestedAmount: '10.000001', currency: 'USDT', state: 'REQUESTED' };
afterEach(() => jest.resetAllMocks());

test('withdrawal request retains the exact decimal and idempotency key', async () => {
  post.mockResolvedValue(response);
  await expect(fundingApi.createWithdrawalRequest(input)).resolves.toMatchObject({ id: 'withdrawal', state: 'REQUESTED', amount: '10.000001' });
  expect(post).toHaveBeenCalledWith('/v1/client-lifecycle/withdrawals', {
    accountId: 'account', requestedAmount: '10.000001', currency: 'USDT', destinationAddress: '0xabc', destinationType: 'ETHEREUM',
  }, { idempotencyKey: 'withdrawal-intent' });
});

test.each([
  { ...response, requestedAmount: '11' }, { ...response, currency: 'BTC' },
  { ...response, accountId: 'other' }, { ...response, id: '' },
  { ...response, state: 'FAILED' }, { ...response, state: 'CONFIRMED' },
])('does not claim a request from an unconfirmed response %#', async (value) => {
  post.mockResolvedValue(value);
  await expect(fundingApi.createWithdrawalRequest(input)).rejects.toThrow('Invalid withdrawal response');
});
