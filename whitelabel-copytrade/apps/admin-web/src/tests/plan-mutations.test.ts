import { apiClient } from '@/lib/api-client';
import { createPlan, updatePlan, updatePlanGrants, archivePlan } from '@/modules/billing/plans/plan-api';

jest.mock('@/lib/api-client', () => ({ apiClient: { post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const post = apiClient.post as jest.Mock;
const patch = apiClient.patch as jest.Mock;
const del = apiClient.delete as jest.Mock;
const key = 'plan-intent-key';
const plan = {
  id: 'plan-id', tenantId: null, code: 'growth', name: 'Growth', description: 'Details', audience: 'TENANT',
  price: '12.340000', currency: 'USD', interval: 'MONTHLY', trialDays: 3, performanceFeeBps: 10,
  platformFeeBps: 20, limits: { maxUsers: 4, customDomain: true, developer_applications: 5 },
  features: ['feature-a', 'feature-b'], isActive: true, sortOrder: 1,
  externalPriceId: 'price-provider-id', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const request = { code: 'growth', name: 'Growth', description: 'Details', audience: 'TENANT' as const,
  price: '12.34', currency: 'USD' as const, interval: 'MONTHLY' as const, trialDays: 3, performanceFeeBps: 10,
  platformFeeBps: 20, limits: { maxUsers: 4, customDomain: true }, features: ['feature-a', 'feature-b'],
  isActive: true, sortOrder: 1, externalPriceId: 'price-provider-id' };
afterEach(() => jest.resetAllMocks());

test('create verifies all submitted fields with decimal-safe price comparison and keeps the intent key', async () => {
  post.mockResolvedValue(plan);
  await expect(createPlan(request, key)).resolves.toMatchObject({ id: 'plan-id' });
  expect(post).toHaveBeenCalledWith('/billing/plans', request, { idempotencyKey: key });
});

test.each([
  ['description', { description: 'different' }], ['audience', { audience: 'END_USER' }],
  ['price', { price: '12.340001' }], ['currency', { currency: 'EUR' }], ['interval', { interval: 'YEARLY' }],
  ['trialDays', { trialDays: 4 }], ['performanceFeeBps', { performanceFeeBps: 11 }],
  ['platformFeeBps', { platformFeeBps: 21 }], ['limits', { limits: { maxUsers: 3, customDomain: true } }],
  ['features', { features: ['feature-a'] }], ['sortOrder', { sortOrder: 2 }],
  ['externalPriceId', { externalPriceId: undefined }],
])('does not claim a successful create when %s is not confirmed', async (_field, changed) => {
  post.mockResolvedValue({ ...plan, ...changed });
  await expect(createPlan(request, key)).rejects.toThrow('Invalid plan response');
});

test('rejects invalid-precision prices before making a mutation', async () => {
  await expect(createPlan({ ...request, price: '0.0000001' }, key)).rejects.toThrow('Invalid plan price');
  expect(post).not.toHaveBeenCalled();
});

test('update checks all fields, resource identity, partial limits and exact ordered features', async () => {
  const body = { price: '12.34', limits: { maxUsers: 4 }, features: ['feature-a', 'feature-b'], externalPriceId: 'price-provider-id' };
  patch.mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...plan, id: 'other-id' }).mockResolvedValueOnce({ ...plan, limits: { maxUsers: 5 } });
  await expect(updatePlan('plan-id', body, key)).resolves.toMatchObject({ id: 'plan-id' });
  await expect(updatePlan('plan-id', body, key)).rejects.toThrow('Invalid plan response');
  await expect(updatePlan('plan-id', body, key)).rejects.toThrow('Invalid plan response');
});

test('grant and archive acknowledgements must match the intended operation', async () => {
  patch.mockResolvedValueOnce(plan).mockResolvedValueOnce(plan);
  await expect(updatePlanGrants('plan-id', { developer_applications: 5 }, key)).resolves.toMatchObject({ id: 'plan-id' });
  await expect(updatePlanGrants('plan-id', { developer_applications: 6 }, key)).rejects.toThrow('Invalid grants response');
  del.mockResolvedValueOnce({ id: 'other', archived: true }).mockResolvedValueOnce({ id: 'plan-id', archived: true });
  await expect(archivePlan('plan-id', key)).rejects.toThrow('Invalid archive response');
  await expect(archivePlan('plan-id', key)).resolves.toEqual({ id: 'plan-id', archived: true });
});
