// # NEW — Creates referral links/codes and displays attribution funnel
'use client';

import {
  ReferralManager,
  type ReferralManagerProps,
} from '../../features/partner/referral-manager';

export { ReferralManager, type ReferralManagerProps };

export function buildPartnerReferralShareUrl(
  baseOrigin: string,
  referralCode: string,
  campaignId?: string,
): string {
  const cleanOrigin = baseOrigin.replace(/\/+$/, '');
  const params = new URLSearchParams({ ref: referralCode.trim().toUpperCase() });
  if (campaignId && campaignId.trim()) {
    params.set('utm_campaign', campaignId.trim());
  }
  return `${cleanOrigin}/register?${params.toString()}`;
}

export default ReferralManager;
