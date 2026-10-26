// # Enforces minimum payout thresholds, hold periods, and idempotent settlement
import { PartnerPayoutService } from '../partners/partner-payout.service';
import {
  PartnerPayoutState,
  PARTNER_PAYOUT_TRANSITIONS,
  type PartnerPayout,
} from '../partners/partner.types';

export { PartnerPayoutService, PartnerPayoutState, PARTNER_PAYOUT_TRANSITIONS, type PartnerPayout };

export interface PartnerPayoutPolicyCheck {
  allowed: boolean;
  reason?: string;
}

export function evaluatePartnerPayoutThresholdAndHold(params: {
  amount: string;
  minPayoutThreshold: string;
  settlementLockedAtIso?: string | null;
  holdWindowHours?: number;
  nowMs?: number;
}): PartnerPayoutPolicyCheck {
  const amountMinor = exactDecimalUnits(params.amount);
  const minimumMinor = exactDecimalUnits(params.minPayoutThreshold);
  if (amountMinor === null || minimumMinor === null || amountMinor < minimumMinor) {
    return {
      allowed: false,
      reason: 'Payout amount is invalid or below the configured exact-decimal threshold.',
    };
  }
  if (params.settlementLockedAtIso && (params.holdWindowHours ?? 0) > 0) {
    const lockedMs = new Date(params.settlementLockedAtIso).getTime();
    const now = params.nowMs ?? Date.now();
    const elapsedMs = now - lockedMs;
    const requiredMs = (params.holdWindowHours ?? 0) * 3_600_000;
    if (!Number.isFinite(lockedMs) || elapsedMs < requiredMs) {
      return {
        allowed: false,
        reason: `Settlement hold window of ${params.holdWindowHours}h has not elapsed yet.`,
      };
    }
  }
  return { allowed: true };
}

/** Convert a plain decimal string to exact 10^-18 units without binary floats. */
function exactDecimalUnits(value: string): bigint | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}

export default PartnerPayoutService;
