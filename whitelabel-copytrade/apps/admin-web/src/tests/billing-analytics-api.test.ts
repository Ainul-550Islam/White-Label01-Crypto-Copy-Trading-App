import { billingAnalyticsApi as api, customerRows, planRows } from '@/api/billing-analytics-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const base = '/v1/billing/analytics';

afterEach(() => jest.clearAllMocks());

/**
 * All 25 routes of analytics.controller, asserted one at a time. `calls` counts
 * the expectations so a route silently dropped from the client fails here.
 */
describe('every analytics route is wrapped exactly once', () => {
  let calls = 0;
  const expectGet = (index: number, path: string, query?: Record<string, unknown>): void => {
    calls += 1;
    if (query) expect(apiClient.get).toHaveBeenNthCalledWith(index, path, { searchParams: query });
    else expect(apiClient.get).toHaveBeenNthCalledWith(index, path);
  };

  it('covers revenue, recurring revenue, subscriptions, plans, cohorts, cashflow, customers, recognition, reporting, reconciliation, cache and health', () => {
    void api.getRevenueOverview({ currency: 'USD', periodType: 'MONTH' });                       // 1
    void api.getRevenueSnapshot({ startDate: '2026-10-01' });                                    // 2
    void api.getMrr({ currency: 'USD' });                                                        // 3
    void api.getTenantMrr({ currency: 'EUR' });                                                  // 4
    void api.getArr({ currency: 'USD', asOfDate: '2026-10-29' });                                // 5
    void api.getSubscriptionKpis({ currency: 'USD' });                                           // 6
    void api.getPlanDistribution({ currency: 'USD' });                                           // 7
    void api.getIntervalDistribution({ currency: 'USD' });                                       // 8
    void api.getChurn({ currency: 'USD' });                                                      // 9
    void api.getRetention({ currency: 'USD' });                                                  // 10
    void api.getPlanPerformance({ limit: 10 });                                                  // 11
    void api.getTopPlans({ limit: 5 });                                                          // 12
    void api.getCohorts({ retentionPeriods: 12 });                                               // 13
    void api.getBillingHealth({ currency: 'USD' });                                              // 14
    void api.getCashflow({ currency: 'USD' });                                                   // 15
    void api.getOutstanding({ currency: 'USD' });                                                // 16
    void api.getCustomerValue({ limit: 20 });                                                    // 17
    void api.getArpu({ currency: 'USD' });                                                       // 18
    void api.getTopCustomers({ limit: 10 });                                                     // 19
    void api.getRecognition({ currency: 'USD' });                                                // 20
    void api.getDeferred({ currency: 'USD' });                                                   // 21
    void api.getFinancialReport({ currency: 'USD' });                                            // 22
    void api.getReconciliation({ currency: 'USD' });                                             // 23
    void api.invalidateCache('revenue', 'mrr');                                                  // 24
    void api.getHealth();                                                                        // 25

    expectGet(1, `${base}/revenue/overview`, { currency: 'USD', periodType: 'MONTH' });
    expectGet(2, `${base}/revenue/snapshot`, { startDate: '2026-10-01' });
    expectGet(3, `${base}/mrr`, { currency: 'USD' });
    expectGet(4, `${base}/mrr/tenant`, { currency: 'EUR' });
    expectGet(5, `${base}/arr`, { currency: 'USD', asOfDate: '2026-10-29' });
    expectGet(6, `${base}/subscriptions/kpis`, { currency: 'USD' });
    expectGet(7, `${base}/subscriptions/plan-distribution`, { currency: 'USD' });
    expectGet(8, `${base}/subscriptions/interval-distribution`, { currency: 'USD' });
    expectGet(9, `${base}/churn`, { currency: 'USD' });
    expectGet(10, `${base}/retention`, { currency: 'USD' });
    expectGet(11, `${base}/plans/performance`, { limit: 10 });
    expectGet(12, `${base}/plans/top`, { limit: 5 });
    expectGet(13, `${base}/cohorts`, { retentionPeriods: 12 });
    expectGet(14, `${base}/billing/health`, { currency: 'USD' });
    expectGet(15, `${base}/cashflow`, { currency: 'USD' });
    expectGet(16, `${base}/cashflow/outstanding`, { currency: 'USD' });
    expectGet(17, `${base}/customers/value`, { limit: 20 });
    expectGet(18, `${base}/customers/arpu`, { currency: 'USD' });
    expectGet(19, `${base}/customers/top`, { limit: 10 });
    expectGet(20, `${base}/recognition`, { currency: 'USD' });
    expectGet(21, `${base}/recognition/deferred`, { currency: 'USD' });
    expectGet(22, `${base}/reports/financial`, { currency: 'USD' });
    expectGet(23, `${base}/reconciliation`, { currency: 'USD' });
    expectGet(24, `${base}/cache/invalidate`, { scope: 'revenue', metric: 'mrr' });
    expectGet(25, `${base}/health`);

    expect(calls).toBe(25);
    expect(apiClient.get).toHaveBeenCalledTimes(25);
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.put).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it('drops blank and undefined query values rather than sending them', () => {
    void api.getRevenueOverview({ currency: '', planId: undefined, periodType: 'YEAR' });

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/revenue/overview`, { searchParams: { periodType: 'YEAR' } });
  });

  it('invalidates the cache without fabricating another verb', () => {
    void api.invalidateCache('all');

    expect(apiClient.get).toHaveBeenCalledWith(`${base}/cache/invalidate`, { searchParams: { scope: 'all' } });
  });
});

describe('list shapes', () => {
  it('reads plans from either envelope the service can return', () => {
    expect(planRows({ plans: [{ planId: 'p', activeSubscriptions: 1, mrr: '10.00' }] })).toHaveLength(1);
    expect(planRows({ data: [{ planId: 'p', activeSubscriptions: 1, mrr: '10.00' }] })).toHaveLength(1);
    expect(planRows(null)).toEqual([]);
  });

  it('reads customers from either envelope', () => {
    expect(customerRows({ customers: [{ customerId: 'c', revenue: '5.00' }] })).toHaveLength(1);
    expect(customerRows({ data: [{ customerId: 'c', revenue: '5.00' }] })).toHaveLength(1);
    expect(customerRows(null)).toEqual([]);
  });
});
