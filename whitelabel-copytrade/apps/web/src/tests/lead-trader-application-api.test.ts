// # Responsibility: verifies typed customer API methods preserve the tenant-scoped route, submission payload, and returned decision history.

jest.mock('../api/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import { apiClient } from '../api/api-client';
import { tradingApi } from '../api/trading-api';

const application = {
  id: 'application-1',
  traderId: 'trader-1',
  status: 'REJECTED',
  version: 1,
  declaration: {
    yearsExperience: 4,
    markets: ['SPOT'],
    strategySummary: 'A documented approach with fixed risk limits and regular review procedures.',
    evidenceReferences: ['review-1'],
    riskAcknowledged: true,
  },
  submittedAt: '2026-10-05T10:00:00.000Z',
  reviewedAt: '2026-10-05T12:00:00.000Z',
  decisionReason: 'Please provide more detail about risk controls.',
};

const mockedGet = jest.mocked(apiClient.get);
const mockedPost = jest.mocked(apiClient.post);

describe('lead-trader application client', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads only the authenticated applicant application-history endpoint', async () => {
    mockedGet.mockResolvedValue({ data: [application] } as never);

    await expect(tradingApi.listMyLeadTraderApplications()).resolves.toMatchObject([
      { id: 'application-1', status: 'REJECTED', version: 1, decisionReason: application.decisionReason },
    ]);
    expect(mockedGet).toHaveBeenCalledWith('/v1/copy-trading/lead-trader-applications/mine');
  });

  it('submits a declaration with a stable caller-provided idempotency key', async () => {
    mockedPost.mockResolvedValue(application as never);
    const input = {
      idempotencyKey: 'lead-app-key-0001',
      yearsExperience: 4,
      markets: ['SPOT'] as Array<'SPOT' | 'USDT_PERPETUAL' | 'COIN_PERPETUAL'>,
      strategySummary: application.declaration.strategySummary,
      evidenceReferences: ['review-1'],
      riskAcknowledged: true,
    };

    await expect(tradingApi.submitLeadTraderApplication(input)).resolves.toMatchObject({ id: 'application-1' });
    expect(mockedPost).toHaveBeenCalledWith('/v1/copy-trading/lead-trader-applications', input);
  });
});
