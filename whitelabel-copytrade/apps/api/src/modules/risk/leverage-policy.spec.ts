// # Responsibility: covers leverage ceilings, unavailable venue evidence, and fail-closed capability handling.

import { LeveragePolicyService } from './leverage-policy.service';

describe('LeveragePolicyService', () => {
  const service = new LeveragePolicyService();

  it('allows only requests at or below the lower of policy and verified venue ceilings', () => {
    expect(service.evaluate({ requestedLeverage: 5, maximumAllowed: 10, venueMaximum: 8, marginMode: 'ISOLATED', accountCanTrade: true })).toMatchObject({ allowed: true, effectiveMaximum: 8 });
    expect(service.evaluate({ requestedLeverage: 9, maximumAllowed: 10, venueMaximum: 8, marginMode: 'CROSS', accountCanTrade: true })).toMatchObject({ allowed: false, effectiveMaximum: 8 });
  });

  it('fails closed when trade permission or venue capability is unknown', () => {
    expect(service.evaluate({ requestedLeverage: 2, maximumAllowed: 10, venueMaximum: null, marginMode: 'CROSS', accountCanTrade: true }).allowed).toBe(false);
    expect(service.evaluate({ requestedLeverage: 2, maximumAllowed: 10, venueMaximum: 10, marginMode: 'CROSS', accountCanTrade: false }).allowed).toBe(false);
  });
});
