import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { compareCopyBudgetDecimals, copyOpsApi, parseCopyBudget } from '@/api/copy-ops-api';
import { AuthContext } from '@/auth/auth.store';
import { CopyBudgetSettings, normaliseBudgetInput } from '@/features/trading/copy-budget-settings';
import { copyBudgetCopy } from '@/features/trading/copy-budget-copy';
import { copyBudgetRetryKey } from '@/features/trading/copy-budget-intents';
import { webcrypto } from 'node:crypto';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;
const row = {
  tenantId: 'tenant-a', userId: 'user-a', currency: 'USDT',
  maxActiveExposure: '150', perTraderCap: '40', tenantCeiling: '100',
  effectiveCap: '100', committed: '125.25', exposureStatus: 'ALLOCATION_ESTIMATE', remaining: '0',
  utilisationBps: 12525, updatedAt: '2026-10-27T10:00:00.000Z',
};
const owner = { tenantId: 'tenant-a', userId: 'user-a' };
afterEach(() => jest.resetAllMocks());

test('maps real committed/basis-point fields and preserves effective versus personal caps', async () => {
  get.mockResolvedValue(row);
  const actual = await copyOpsApi.getBudget();
  expect(actual).toMatchObject({ maxActiveExposure: '150', effectiveCap: '100', tenantCeiling: '100', currentExposure: '125.25', utilisationBps: 12525 });
  expect(get).toHaveBeenCalledWith('/v1/copy-trading/budget');
});

test('keeps an absent cap absent instead of inventing zero or a currency', () => {
  const unlimited = { ...row, currency: null, maxActiveExposure: null, tenantCeiling: null, effectiveCap: null, remaining: null, utilisationBps: null };
  expect(parseCopyBudget(unlimited)).toMatchObject({ maxActiveExposure: null, effectiveCap: null, currentExposure: '125.25', currency: null });
  expect(() => parseCopyBudget({ ...unlimited, currency: undefined })).toThrow();
  expect(() => parseCopyBudget({ ...unlimited, maxActiveExposure: undefined })).toThrow();
});

test('keeps unverified allocation units unavailable instead of presenting a numeric estimate', () => {
  const unverified = { ...row, committed: null, remaining: null, utilisationBps: null, exposureStatus: 'UNAVAILABLE' };
  expect(parseCopyBudget(unverified)).toMatchObject({ currentExposure: null, remaining: null, exposureStatus: 'UNAVAILABLE' });
  expect(() => parseCopyBudget({ ...unverified, committed: '10' })).toThrow();
});

test.each([
  { ...row, committed: 1 }, { ...row, remaining: 'NaN' },
  { ...row, effectiveCap: '150' }, { ...row, utilisationBps: Number.MAX_SAFE_INTEGER + 1 },
  { ...row, tenantId: '' }, { ...row, updatedAt: 'not-a-date' },
])('rejects incomplete, rounded or inconsistent evidence %#', (value) => {
  expect(() => parseCopyBudget(value)).toThrow('Invalid budget response');
});

test('sends the exact cap, currency and request key and confirms the owner and current cap', async () => {
  const saved = { ...row, maxActiveExposure: '90', effectiveCap: '90', remaining: '0' };
  post.mockResolvedValue(saved);
  await expect(copyOpsApi.reduceBudget({ maxActiveExposure: '90.000000000000', currency: 'USDT' }, 'reduce-key-123', owner))
    .resolves.toMatchObject({ maxActiveExposure: '90', effectiveCap: '90' });
  expect(post).toHaveBeenCalledWith('/v1/copy-trading/budget/reduce',
    { maxActiveExposure: '90.000000000000', currency: 'USDT' }, { idempotencyKey: 'reduce-key-123' });
});

test.each([
  { ...row, maxActiveExposure: '150' },
  { ...row, tenantId: 'other', maxActiveExposure: '90', effectiveCap: '90' },
  { ...row, currency: 'BTC', maxActiveExposure: '90', effectiveCap: '90' },
])('never reports a mismatched or subsequently widened acknowledgement as success %#', async (ack) => {
  post.mockResolvedValue(ack);
  await expect(copyOpsApi.reduceBudget({ maxActiveExposure: '90', currency: 'USDT' }, 'reduce-key-123', owner)).rejects.toThrow();
});

test('retains a private, owner-scoped retry key across a page reload', async () => {
  const data = new Map<string, string>();
  const store: Storage = {
    get length() { return data.size; },
    clear: () => data.clear(), getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); }, setItem: (key, value) => { data.set(key, value); },
  };
  const input = { maxActiveExposure: '90.123', currency: 'USDT' };
  const first = await copyBudgetRetryKey(owner, input, store, webcrypto as unknown as Crypto);
  const afterReload = await copyBudgetRetryKey(owner, input, store, webcrypto as unknown as Crypto);
  const anotherUser = await copyBudgetRetryKey({ ...owner, userId: 'other' }, input, store, webcrypto as unknown as Crypto);
  expect(afterReload).toEqual(first);
  expect(anotherUser.key).not.toBe(first.key);
  expect(JSON.stringify([...data])).not.toMatch(/tenant-a|user-a|90.123|USDT/);
});

test('compares large decimals exactly and accepts Bengali and Arabic input digits', () => {
  expect(compareCopyBudgetDecimals('1234567890123456.000000000001', '1234567890123456.000000000002')).toBeLessThan(0);
  expect(normaliseBudgetInput('১২৩.৪৫')).toBe('123.45');
  expect(normaliseBudgetInput('٩٠٫٢٥')).toBe('90.25');
});

test('renders effective, personal and tenant caps and does not hide usage above 100 percent', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['copy-trading', 'budget', 'tenant-a', 'user-a'], parseCopyBudget(row));
  const session = { user: { id: 'user-a', tenantId: 'tenant-a', email: 'a@example.com', roles: [], permissions: [] }, tenant: { id: 'tenant-a', slug: 'a', name: 'A' }, entitlements: {}, isAuthenticated: true };
  const html = renderToStaticMarkup(<AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
    <QueryClientProvider client={queryClient}><CopyBudgetSettings /></QueryClientProvider>
  </AuthContext.Provider>);
  expect(html).toContain('Current effective limit');
  expect(html).toContain('Your limit');
  expect(html).toContain('Tenant ceiling');
  expect(html).toContain('125.25% calculated allocation-to-limit ratio (not live exposure)');
  expect(html).toContain('aria-valuenow="100"');
  expect(html).toContain('does not close existing positions');
  expect(html).toContain('not verified live exposure');
  expect(html).toContain('Copy orders with a configured budget are blocked');
  for (const locale of ['en', 'bn', 'ar', 'es', 'tr'] as const) {
    expect(copyBudgetCopy[locale].failed).toBeTruthy();
    expect(copyBudgetCopy[locale].enforcementUnavailable).toBeTruthy();
  }
});
