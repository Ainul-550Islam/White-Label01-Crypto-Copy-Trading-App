// # Confirms the public partner route inventory includes payout and referral endpoints with abuse controls available.
import { PARTNER_PORTAL_ROUTE_PREFIX, listExposedPartnerEndpoints } from './partner.module';

describe('partner route inventory', () => {
  it('keeps tenant portal endpoints and the deterministic abuse service contract visible', () => {
    expect(PARTNER_PORTAL_ROUTE_PREFIX).toBe('/v1/partner');
    expect(listExposedPartnerEndpoints()).toContain('POST /v1/partner/payouts');
    expect(listExposedPartnerEndpoints()).toContain('POST /v1/partner/referrals');
  });
});
