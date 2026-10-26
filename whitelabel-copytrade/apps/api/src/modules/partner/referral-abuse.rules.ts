// # Deterministic referral-abuse rules: velocity, explainable risk scoring, and human-review thresholds.
export type ReferralAbuseReason =
  | 'SELF_REFERRAL'
  | 'SAME_DEVICE'
  | 'SAME_IP_HASH'
  | 'INCOMPLETE_EVIDENCE'
  | 'HIGH_REFERRER_VELOCITY'
  | 'REPEATED_DEVICE_VELOCITY'
  | 'REPEATED_IP_VELOCITY';

export type ReferralAbuseDecision = 'ALLOW' | 'REVIEW' | 'REFUSE' | 'IDEMPOTENT_REPLAY';

export interface ReferralVelocityCounts {
  referrerAttemptsInWindow: number;
  deviceReferralsInWindow: number;
  ipReferralsInWindow: number;
}

export interface ReferralAbuseInput {
  referrerUserId: string;
  referredUserId: string;
  referrerDeviceHash: string;
  referredDeviceHash: string;
  referrerIpHash: string;
  referredIpHash: string;
  idempotencyKey: string;
  velocity?: Partial<ReferralVelocityCounts>;
  existingAttributionId?: string | null;
}

export interface ReferralAbuseResult {
  decision: ReferralAbuseDecision;
  reasons: ReferralAbuseReason[];
  riskScore: number;
  reviewRequired: boolean;
  existingAttributionId: string | null;
}

export const REFERRER_VELOCITY_REVIEW_THRESHOLD = 5;
export const REFERRER_VELOCITY_HIGH_THRESHOLD = 10;
export const SHARED_DEVICE_REVIEW_THRESHOLD = 3;
export const SHARED_DEVICE_HIGH_THRESHOLD = 5;
export const SHARED_IP_REVIEW_THRESHOLD = 5;
export const SHARED_IP_HIGH_THRESHOLD = 10;
export const REFERRAL_ABUSE_REVIEW_SCORE = 30;
export const REFERRAL_ABUSE_MAX_SCORE = 100;

function boundedScore(score: number): number {
  return Math.min(REFERRAL_ABUSE_MAX_SCORE, Math.max(0, score));
}

export function evaluateReferralAbuse(input: ReferralAbuseInput): ReferralAbuseResult {
  if (input.existingAttributionId) {
    return {
      decision: 'IDEMPOTENT_REPLAY',
      reasons: [],
      riskScore: 0,
      reviewRequired: false,
      existingAttributionId: input.existingAttributionId,
    };
  }

  const reasons: ReferralAbuseReason[] = [];
  let score = 0;
  let hardRefusal = false;

  if (
    !input.idempotencyKey.trim() ||
    !input.referrerUserId.trim() ||
    !input.referredUserId.trim()
  ) {
    reasons.push('INCOMPLETE_EVIDENCE');
    score += REFERRAL_ABUSE_MAX_SCORE;
    hardRefusal = true;
  }

  if (input.referrerUserId && input.referrerUserId === input.referredUserId) {
    reasons.push('SELF_REFERRAL');
    score += REFERRAL_ABUSE_MAX_SCORE;
    hardRefusal = true;
  }

  const sameDevice =
    Boolean(input.referrerDeviceHash) &&
    Boolean(input.referredDeviceHash) &&
    input.referrerDeviceHash === input.referredDeviceHash;
  if (sameDevice) {
    reasons.push('SAME_DEVICE');
    score += 60;
  }

  const sameIpHash =
    Boolean(input.referrerIpHash) &&
    Boolean(input.referredIpHash) &&
    input.referrerIpHash === input.referredIpHash;
  if (sameIpHash) {
    reasons.push('SAME_IP_HASH');
    score += 25;
  }

  // A shared device and keyed IP together are deterministic identity reuse,
  // not merely an elevated-risk signal; refuse attribution and retain evidence.
  if (sameDevice && sameIpHash) hardRefusal = true;

  const velocity = {
    referrerAttemptsInWindow: Math.max(0, input.velocity?.referrerAttemptsInWindow ?? 0),
    deviceReferralsInWindow: Math.max(0, input.velocity?.deviceReferralsInWindow ?? 0),
    ipReferralsInWindow: Math.max(0, input.velocity?.ipReferralsInWindow ?? 0),
  };

  if (velocity.referrerAttemptsInWindow >= REFERRER_VELOCITY_REVIEW_THRESHOLD) {
    reasons.push('HIGH_REFERRER_VELOCITY');
    score += velocity.referrerAttemptsInWindow >= REFERRER_VELOCITY_HIGH_THRESHOLD ? 40 : 25;
  }
  if (velocity.deviceReferralsInWindow >= SHARED_DEVICE_REVIEW_THRESHOLD) {
    reasons.push('REPEATED_DEVICE_VELOCITY');
    score += velocity.deviceReferralsInWindow >= SHARED_DEVICE_HIGH_THRESHOLD ? 40 : 25;
  }
  if (velocity.ipReferralsInWindow >= SHARED_IP_REVIEW_THRESHOLD) {
    reasons.push('REPEATED_IP_VELOCITY');
    score += velocity.ipReferralsInWindow >= SHARED_IP_HIGH_THRESHOLD ? 30 : 20;
  }

  const hasCompleteIdentityEvidence = Boolean(
    input.referrerDeviceHash &&
    input.referredDeviceHash &&
    input.referrerIpHash &&
    input.referredIpHash,
  );
  if (!hasCompleteIdentityEvidence && !reasons.includes('INCOMPLETE_EVIDENCE')) {
    reasons.push('INCOMPLETE_EVIDENCE');
    score += 30;
  }

  const riskScore = boundedScore(score);
  const decision: ReferralAbuseDecision = hardRefusal
    ? 'REFUSE'
    : riskScore >= REFERRAL_ABUSE_REVIEW_SCORE
      ? 'REVIEW'
      : 'ALLOW';

  return {
    decision,
    reasons,
    riskScore,
    reviewRequired: decision === 'REVIEW',
    existingAttributionId: null,
  };
}
