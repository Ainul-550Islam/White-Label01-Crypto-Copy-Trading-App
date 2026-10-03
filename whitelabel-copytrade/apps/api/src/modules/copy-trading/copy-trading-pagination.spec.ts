import 'reflect-metadata';

import { ValidationException } from '../../common/errors/app.exception';

import { CopyTradingController } from './copy-trading.controller';

/**
 * The traders and rankings lists (called by the customer web and the mobile
 * app) read pagination from an untyped query with parseInt: `?page=0` became a
 * negative skip (Prisma UnknownRequestError -> HTTP 500) and `?page=abc` NaN
 * (a generic 400). Now the controller answers with a field-level validation
 * error before any service or database call.
 */
describe('CopyTradingController pagination of untyped list queries', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const req = { user: { userId: 'follower-1', tenantId: TENANT, roles: ['FOLLOWER'] }, headers: {} };

  function build() {
    const traderProfileService = { listPublicProfiles: jest.fn(async () => ({ data: [], total: 0 })) };
    const traderRankingService = { getRanking: jest.fn(async () => ({ data: [], total: 0 })) };
    const none = {};
    const controller = new CopyTradingController(
      ...([
        traderProfileService,
        none,
        none,
        none,
        none,
        none,
        traderRankingService,
        none,
        none,
        none,
      ] as unknown as ConstructorParameters<typeof CopyTradingController>),
    );
    return { controller, traderProfileService, traderRankingService };
  }

  it.each([{ page: 'abc' }, { page: '0' }, { page: '-3' }, { limit: '0' }, { limit: '500' }, { limit: 'ten' }])(
    'GET traders?%o is a validation error and never reaches the service',
    async (query) => {
      const { controller, traderProfileService } = build();
      await expect(controller.listTraders(req, query)).rejects.toBeInstanceOf(ValidationException);
      expect(traderProfileService.listPublicProfiles).not.toHaveBeenCalled();
    },
  );

  it('GET traders passes valid pagination through as integers and defaults the rest', async () => {
    const { controller, traderProfileService } = build();
    await controller.listTraders(req, { page: '2', limit: '50', search: 'alice' });
    expect(traderProfileService.listPublicProfiles).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ page: 2, limit: 50, search: 'alice' }),
    );
    await controller.listTraders(req, {});
    expect(traderProfileService.listPublicProfiles).toHaveBeenLastCalledWith(
      TENANT,
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it('GET rankings rejects a malformed page and accepts a valid one', async () => {
    const { controller, traderRankingService } = build();
    await expect(controller.getRankings(req, { page: 'x' })).rejects.toBeInstanceOf(ValidationException);
    expect(traderRankingService.getRanking).not.toHaveBeenCalled();
    await controller.getRankings(req, { page: '3', limit: '10', sortBy: 'score' });
    expect(traderRankingService.getRanking).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ page: 3, limit: 10, sortBy: 'score' }),
    );
  });
});
