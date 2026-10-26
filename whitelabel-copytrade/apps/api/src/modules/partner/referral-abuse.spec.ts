// # Cross-check that persisted referral velocity drives the deterministic score and review decision.
import { evaluateReferralAbuse } from './referral-abuse.rules';

describe('referral abuse risk review policy', () => {
  it('routes repeated referral velocity above the score threshold to human review', () => {
    const requestIdentifier = ['signup', 'velocity', 'case', 'one'].join('-');
    const result = evaluateReferralAbuse({
      referrerUserId: 'referrer-user',
      referredUserId: 'referred-user',
      referrerDeviceHash: 'referrer-device',
      referredDeviceHash: 'referred-device',
      referrerIpHash: 'referrer-ip',
      referredIpHash: 'referred-ip',
      idempotencyKey: requestIdentifier,
      velocity: {
        referrerAttemptsInWindow: 10,
        deviceReferralsInWindow: 0,
        ipReferralsInWindow: 0,
      },
    });

    expect(result.reasons).toContain('HIGH_REFERRER_VELOCITY');
    expect(result.riskScore).toBe(40);
    expect(result.decision).toBe('REVIEW');
    expect(result.reviewRequired).toBe(true);
  });
});
