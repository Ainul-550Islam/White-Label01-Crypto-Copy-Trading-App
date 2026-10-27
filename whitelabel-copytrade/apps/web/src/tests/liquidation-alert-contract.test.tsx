import { renderToStaticMarkup } from 'react-dom/server';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { copyOpsApi, parseLiquidationAlerts } from '@/api/copy-ops-api';
import CopyTradingSettingsPage from '@/app/copy-trading/settings/page';
import { LiquidationRiskAlert } from '@/features/trading/liquidation-risk-alert';
import { liquidationCopy } from '@/features/trading/liquidation-copy';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('@/auth/auth.store', () => ({ useAuth: () => ({ isAuthenticated: true, session: { tenant: { id: 'tenant-a' }, user: { id: 'user-a' } } }) }));
jest.mock('@/auth/auth.guard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('@/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('@/layout/page-container', () => ({ PageContainer: ({ children, title, description }: { children: React.ReactNode; title: string; description: string }) => <main><h1>{title}</h1><p>{description}</p>{children}</main> }));
jest.mock('@/features/trading/copy-budget-settings', () => ({ CopyBudgetSettings: () => <div>Budget controls</div> }));

const owner = { tenantId: 'tenant-a', userId: 'user-a' };
const row = { positionId: 'position-a', accountId: 'account-a', symbol: 'BTC-USDT', side: 'LONG', quantity: '1.25',
  bucket: 'UNKNOWN', distancePercent: null, liquidationPrice: null, markPrice: '100', reason: 'not authoritative', severity: 'UNKNOWN',
  sourceUpdatedAt: '2026-10-27T10:00:00.000Z', containsSimulatedFills: false };
const page = { ...owner, data: [row], total: 1, unknownCount: 1 };
const get = apiClient.get as jest.Mock;
const useQueryMock = useQuery as jest.Mock;
afterEach(() => jest.resetAllMocks());

test('accepts only the owner-scoped controller envelope and keeps unknown evidence unknown', async () => {
  get.mockResolvedValue(page);
  const alerts = await copyOpsApi.listLiquidationAlerts(owner);
  expect(get).toHaveBeenCalledWith('/v1/risk/liquidation-alerts');
  expect(alerts).toMatchObject([{ positionId: 'position-a', quantity: '1.25', bucket: 'UNKNOWN', distancePercent: null }]);
  const html = renderToStaticMarkup(<LiquidationRiskAlert alerts={alerts} />);
  expect(html).toContain('Liquidation distance cannot be verified');
  expect(html).not.toContain('not authoritative'); // raw server prose is never rendered
  expect(html).not.toContain('comfortably away');
});

test.each([
  null, {}, [], { ...page, data: undefined }, { ...page, total: 0 },
  { ...page, unknownCount: 0 }, { ...page, userId: 'other-user' },
  { ...page, data: [{ ...row, quantity: 1.25 }] },
  { ...page, data: [{ ...row, bucket: 'SAFE' }], unknownCount: 0 },
  { ...page, data: [row, row], total: 2, unknownCount: 2 },
])('rejects malformed, ambiguous, missing or wrong-owner response %#', (value) => {
  expect(() => parseLiquidationAlerts(value, owner)).toThrow('Invalid liquidation response');
});

test('renders an empty result only after a complete successful response, with a live-data caveat', () => {
  const alerts = parseLiquidationAlerts({ ...owner, data: [], total: 0, unknownCount: 0 }, owner);
  const html = renderToStaticMarkup(<LiquidationRiskAlert alerts={alerts} />);
  expect(html).toContain('No open positions in available records.');
  expect(html).toContain('does not confirm your live account exposure');
});

test('does not render a no-positions state on loading or on a failed refresh with stale empty data', () => {
  useQueryMock.mockReturnValueOnce({ isError: false, data: undefined });
  const loading = renderToStaticMarkup(<CopyTradingSettingsPage />);
  expect(loading).toContain('Loading position records');
  expect(loading).not.toContain('No open positions');
  useQueryMock.mockReturnValueOnce({ isError: true, data: [], refetch: jest.fn() });
  const failure = renderToStaticMarkup(<CopyTradingSettingsPage />);
  expect(failure).toContain('Liquidation risk is unavailable');
  expect(failure).not.toContain('No open positions');
});

test('keys the query by tenant and user and requests the same owner', async () => {
  useQueryMock.mockReturnValue({ isError: false, data: undefined });
  renderToStaticMarkup(<CopyTradingSettingsPage />);
  const options = useQueryMock.mock.calls[0][0];
  expect(options.queryKey).toEqual(['liquidation-alerts', 'tenant-a', 'user-a']);
  expect(options.enabled).toBe(true);
  expect(options.placeholderData).toBeUndefined();
  get.mockResolvedValue({ ...owner, data: [], total: 0, unknownCount: 0 });
  await expect(options.queryFn()).resolves.toEqual([]);
});

test('supplies risk, error and empty-state copy for all five locales', () => {
  for (const locale of ['en', 'bn', 'ar', 'es', 'tr'] as const) {
    const html = renderToStaticMarkup(<LiquidationRiskAlert alerts={[]} locale={locale} />);
    expect(html).toContain(liquidationCopy[locale].empty);
    expect(html).toContain(liquidationCopy[locale].emptyHint);
    expect(liquidationCopy[locale].unavailable).toBeTruthy();
  }
});
