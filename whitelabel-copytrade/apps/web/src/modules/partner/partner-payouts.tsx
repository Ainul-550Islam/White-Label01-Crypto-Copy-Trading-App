// # NEW — Submits payout requests and displays approval/settlement timeline
'use client';

import {
  PartnerPayouts,
  type PartnerPayoutsProps,
} from '../../features/partner/partner-payouts';

export { PartnerPayouts, type PartnerPayoutsProps };

export const MINIMUM_PARTNER_PAYOUT_AMOUNT = 50;

export function isEligibleForPartnerPayout(
  availableBalance: string | number,
  requestedAmount: string | number,
): { eligible: boolean; reason?: string } {
  const available = Number(availableBalance);
  const requested = Number(requestedAmount);
  if (!Number.isFinite(requested) || requested < MINIMUM_PARTNER_PAYOUT_AMOUNT) {
    return {
      eligible: false,
      reason: `Minimum partner payout threshold is ${MINIMUM_PARTNER_PAYOUT_AMOUNT} USDT.`,
    };
  }
  if (!Number.isFinite(available) || requested > available) {
    return {
      eligible: false,
      reason: 'Requested payout exceeds settled available partner balance.',
    };
  }
  return { eligible: true };
}

export default PartnerPayouts;
