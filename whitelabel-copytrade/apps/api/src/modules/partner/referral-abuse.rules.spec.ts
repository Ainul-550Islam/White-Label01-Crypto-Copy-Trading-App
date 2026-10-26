// # Regression assertions for deterministic self-referral, velocity, score, review, and idempotency behavior.
import {
  evaluateReferralAbuse,
  REFERRAL_ABUSE_REVIEW_SCORE,
  type ReferralAbuseInput,
} from './referral-abuse.rules';

const baseline: ReferralAbuseInput = {
  referrerUserId: 'referrer-user',
  referredUserId: 'referred-user',
  referrerDeviceHash: 'device-hash-a',
  referredDeviceHash: 'device-hash-b',
  referrerIpHash: 'ip-hash-a',
  referredIpHash: 'ip-hash-b',
  idempotencyKey: 'signup-once-1',
};

describe('referral abuse rules', () => {
  it('allows a complete first referral with a zero, explainable score', () => {
    expect(evaluateReferralAbuse(baseline)).toEqual({
      decision: 'ALLOW',
      reasons: [],
      riskScore: 0,
      reviewRequired: false,
      existingAttributionId: null,
    });
  });

  it('refuses self-referral with a maximum score', () => {
    const result = evaluateReferralAbuse({ ...baseline, referredUserId: baseline.referrerUserId });
    expect(result.decision).toBe('REFUSE');
    expect(result.reasons).toContain('SELF_REFERRAL');
    expect(result.riskScore).toBe(100);
    expect(result.reviewRequired).toBe(false);
  });

  it('queues a shared device for human review without labelling it a fraud conclusion', () => {
    const result = evaluateReferralAbuse({
      ...baseline,
      referredDeviceHash: baseline.referrerDeviceHash,
    });
    expect(result.decision).toBe('REVIEW');
    expect(result.reasons).toContain('SAME_DEVICE');
    expect(result.riskScore).toBe(60);
    expect(result.reviewRequired).toBe(true);
  });

  it('scores a shared keyed IP below the review threshold unless another rule adds risk', () => {
    const result = evaluateReferralAbuse({ ...baseline, referredIpHash: baseline.referrerIpHash });
    expect(result.reasons).toContain('SAME_IP_HASH');
    expect(result.riskScore).toBe(25);
    expect(result.decision).toBe('ALLOW');
  });

  it('refuses attribution when both device and keyed IP evidence are shared', () => {
    const result = evaluateReferralAbuse({
      ...baseline,
      referredDeviceHash: baseline.referrerDeviceHash,
      referredIpHash: baseline.referrerIpHash,
    });

    expect(result.decision).toBe('REFUSE');
    expect(result.reviewRequired).toBe(false);
    expect(result.reasons).toEqual(['SAME_DEVICE', 'SAME_IP_HASH']);
    expect(result.riskScore).toBe(85);
  });

  it('applies fixed referral velocity thresholds and returns the same score for the same evidence', () => {
    const input: ReferralAbuseInput = {
      ...baseline,
      velocity: {
        referrerAttemptsInWindow: 5,
        deviceReferralsInWindow: 3,
        ipReferralsInWindow: 4,
      },
    };
    const result = evaluateReferralAbuse(input);
    expect(result).toEqual(evaluateReferralAbuse(input));
    expect(result.reasons).toEqual(['HIGH_REFERRER_VELOCITY', 'REPEATED_DEVICE_VELOCITY']);
    expect(result.riskScore).toBe(50);
    expect(result.decision).toBe('REVIEW');
    expect(result.reviewRequired).toBe(true);
  });

  it('uses the documented high-volume score bands and caps combined risk at one hundred', () => {
    const result = evaluateReferralAbuse({
      ...baseline,
      velocity: {
        referrerAttemptsInWindow: 10,
        deviceReferralsInWindow: 5,
        ipReferralsInWindow: 10,
      },
    });
    expect(result.reasons).toEqual([
      'HIGH_REFERRER_VELOCITY',
      'REPEATED_DEVICE_VELOCITY',
      'REPEATED_IP_VELOCITY',
    ]);
    expect(result.riskScore).toBe(100);
    expect(result.decision).toBe('REVIEW');
  });

  it('places incomplete identity telemetry into review and refuses missing core identity/idempotency evidence', () => {
    const missingTelemetry = evaluateReferralAbuse({
      ...baseline,
      referredIpHash: '',
    });
    expect(missingTelemetry.decision).toBe('REVIEW');
    expect(missingTelemetry.riskScore).toBe(30);
    expect(missingTelemetry.reasons).toContain('INCOMPLETE_EVIDENCE');

    const missingIdentity = evaluateReferralAbuse({ ...baseline, referredUserId: '' });
    expect(missingIdentity.decision).toBe('REFUSE');
    expect(missingIdentity.riskScore).toBe(100);
    expect(missingIdentity.reasons).toContain('INCOMPLETE_EVIDENCE');
  });

  it('returns an existing attribution before running score or velocity rules', () => {
    expect(
      evaluateReferralAbuse({
        ...baseline,
        referredUserId: baseline.referrerUserId,
        velocity: { referrerAttemptsInWindow: 20 },
        existingAttributionId: 'attribution-1',
      }),
    ).toEqual({
      decision: 'IDEMPOTENT_REPLAY',
      reasons: [],
      riskScore: 0,
      reviewRequired: false,
      existingAttributionId: 'attribution-1',
    });
  });

  it('queues a score exactly at the documented review boundary', () => {
    const atThreshold = evaluateReferralAbuse({
      ...baseline,
      velocity: { ipReferralsInWindow: 10 },
    });
    expect(atThreshold.riskScore).toBe(REFERRAL_ABUSE_REVIEW_SCORE);
    expect(atThreshold.decision).toBe('REVIEW');
    expect(atThreshold.reviewRequired).toBe(true);
  });
});
