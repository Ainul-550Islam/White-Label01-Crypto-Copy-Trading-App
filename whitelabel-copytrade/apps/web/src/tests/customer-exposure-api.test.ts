// # Responsibility: pins the web client to the routes the API actually mounts - trader exposure is read from `trader-exposure/:traderId`, not the `/traders/:id/exposure` path that no controller ever served.

import { customerExposureApi } from '../api/customer-exposure-api';
import type { TraderExposureView } from '../api/customer-exposure-api';

jest.mock('../api/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

const { apiClient } = jest.requireMock('../api/api-client') as {
  apiClient: { get: jest.Mock };
};

/**
 * Why this test exists.
 *
 * `customerExposureApi.getTraderExposure` requested
 * `/v1/risk-management/traders/<id>/exposure`. No controller ever mounted that path - the API
 * serves `GET /v1/risk-management/trader-exposure/:traderId` - so the call was a 404 in
 * production while both of its panels rendered "unavailable". `npm run check:web-api-contract`
 * is the gate that found it; this test pins the string next to the code so a hand edit cannot
 * silently reintroduce a path that does not exist, and pins the sibling call too.
 */
describe('customerExposureApi', () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    apiClient.get.mockResolvedValue(undefined);
  });

  it('reads trader exposure from the mounted route with the identifier bound to the path', async () => {
    await customerExposureApi.getTraderExposure('trader-1');

    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith('/v1/risk-management/trader-exposure/trader-1');
  });

  it('never calls the unrouted /traders/<id>/exposure shape', async () => {
    await customerExposureApi.getTraderExposure('trader-1');

    const calledWith = apiClient.get.mock.calls.map((call) => String(call[0]));
    expect(calledWith).not.toContain('/v1/risk-management/traders/trader-1/exposure');
    expect(calledWith.every((path) => path.startsWith('/v1/risk-management/trader-exposure/'))).toBe(
      true,
    );
  });

  it('encodes an identifier so it cannot break out of its path segment', async () => {
    await customerExposureApi.getTraderExposure('trader/../../admin?x=1');

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/risk-management/trader-exposure/${encodeURIComponent('trader/../../admin?x=1')}`,
    );
  });

  it('reads the caller-scoped exposure from the route that exists', async () => {
    await customerExposureApi.getMyExposure();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/risk-management/my-exposure');
  });

  it('returns the API payload unchanged rather than converting financial values in the browser', async () => {
    const payload = {
      tenantId: 'tenant-1',
      traderId: 'trader-1',
      asOf: '2026-10-07T00:00:00.000Z',
      state: 'EMPTY',
      eligibleAccountCount: 0,
      lines: [],
      totalsByQuoteAsset: [],
      staleSymbols: [],
      unknownSymbols: [],
      cashBalancesIncluded: false,
      currencyTreatment: 'SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION',
      priceMethodology: 'LATEST_1M_CANDLE_CLOSE_WITH_POLICY_FRESHNESS',
      notice: 'No eligible positions.',
      dataScope: 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
    } as unknown as TraderExposureView;
    apiClient.get.mockResolvedValue(payload);

    await expect(customerExposureApi.getTraderExposure('trader-1')).resolves.toBe(payload);
  });
});
