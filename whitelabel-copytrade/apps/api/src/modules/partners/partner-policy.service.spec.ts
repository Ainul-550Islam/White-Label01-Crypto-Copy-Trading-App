import { ConfigService } from '@nestjs/config';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerType } from './partner.types';

/**
 * Environment values reach ConfigService as strings. These cases pin that the
 * numeric partner knobs become real integers (they are persisted into JSON
 * policy snapshots and Int columns) and that a malformed value fails loudly.
 */
function serviceWith(values: Record<string, string | undefined>): PartnerPolicyService {
  return new PartnerPolicyService(new ConfigService(values));
}

describe('PartnerPolicyService numeric env knobs', () => {
  it('uses the documented defaults when unset', () => {
    const policy = serviceWith({}).resolvePolicy({ partnerType: PartnerType.RESELLER });
    expect(policy.discountRules.maxDiscountBasisPoints).toBe(3000);
    expect(policy.attributionWindowHours).toBe(720);
  });

  it('converts env strings into numbers rather than passing strings through', () => {
    const policy = serviceWith({
      PARTNER_MAX_DISCOUNT_BPS: '2500',
      PARTNER_ATTRIBUTION_WINDOW_HOURS: ' 48 ',
    }).resolvePolicy({ partnerType: PartnerType.AFFILIATE });
    expect(policy.discountRules.maxDiscountBasisPoints).toBe(2500);
    expect(typeof policy.discountRules.maxDiscountBasisPoints).toBe('number');
    expect(policy.attributionWindowHours).toBe(48);
    expect(typeof policy.attributionWindowHours).toBe('number');
  });

  it('treats a blank value as unset', () => {
    const policy = serviceWith({ PARTNER_ATTRIBUTION_WINDOW_HOURS: '' }).resolvePolicy({
      partnerType: PartnerType.AGENCY,
    });
    expect(policy.attributionWindowHours).toBe(720);
  });

  it('a stored policy still wins over the env default', () => {
    const policy = serviceWith({ PARTNER_ATTRIBUTION_WINDOW_HOURS: '48' }).resolvePolicy({
      partnerType: PartnerType.AGENCY,
      storedPolicy: { attributionWindowHours: 96 },
    });
    expect(policy.attributionWindowHours).toBe(96);
  });

  it.each([
    ['PARTNER_MAX_DISCOUNT_BPS', 'abc'],
    ['PARTNER_MAX_DISCOUNT_BPS', '10001'],
    ['PARTNER_MAX_DISCOUNT_BPS', '12.5'],
    ['PARTNER_ATTRIBUTION_WINDOW_HOURS', '0'],
    ['PARTNER_ATTRIBUTION_WINDOW_HOURS', '8761'],
  ])('rejects %s=%s at construction', (name, value) => {
    expect(() => serviceWith({ [name]: value })).toThrow(name);
  });
});
