// # Enforces minimum payout thresholds, hold periods, and idempotent settlement
import { PartnerPayoutService } from '../partners/partner-payout.service';
import {
  PartnerPayoutState,
  PARTNER_PAYOUT_TRANSITIONS,
  type PartnerPayout,
} from '../partners/partner.types';

export {
  PartnerPayoutService,
  PartnerPayoutState,
  PARTNER_PAYOUT_TRANSITIONS,
  type PartnerPayout,
};

export interface PartnerPayoutPolicyCheck {
  allowed: boolean;
  reason?: string;
}

export function evaluatePartnerPayoutThresholdAndHold(params: {
  amount: string | number;
  minPayoutThreshold: number;
  settlementLockedAtIso?: string | null;
  holdWindowHours?: number;
  nowMs?: number;
}): PartnerPayoutPolicyCheck {
  const numericAmount = Number(params.amount);
  if (!Number.isFinite(numericAmount) || numericAmount < params.minPayoutThreshold) {
    return {
      allowed: false,
      reason: `Payout amount ${params.amount} is below minimum threshold ${params.minPayoutThreshold}.`,
    };
  }
  if (params.settlementLockedAtIso && (params.holdWindowHours ?? 0) > 0) {
    const lockedMs = new Date(params.settlementLockedAtIso).getTime();
    const now = params.nowMs ?? Date.now();
    const elapsedHours = (now - lockedMs) / (1_000 * 60 * 60);
    if (elapsedHours < (params.holdWindowHours ?? 0)) {
      return {
        allowed: false,
        reason: `Settlement hold window of ${params.holdWindowHours}h has not elapsed yet.`,
      };
    }
  }
  return { allowed: true };
}

export default PartnerPayoutService;
