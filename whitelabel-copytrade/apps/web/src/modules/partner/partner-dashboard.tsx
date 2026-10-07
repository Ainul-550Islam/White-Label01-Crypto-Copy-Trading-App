// # NEW — Displays partner tier, active referrals, volume, and accrued commissions
'use client';

import {
  PartnerDashboard,
  type PartnerDashboardProps,
} from '../../features/partner/partner-dashboard';

export { PartnerDashboard, type PartnerDashboardProps };

export interface PartnerTierThresholds {
  tier: 'BRONZE_IB' | 'SILVER_IB' | 'GOLD_IB' | 'INSTITUTIONAL_IB';
  minMonthlyVolumeUsd: number;
  rebateRateBps: number;
}

export const PARTNER_TIER_SCHEDULE: readonly PartnerTierThresholds[] = [
  { tier: 'BRONZE_IB', minMonthlyVolumeUsd: 0, rebateRateBps: 1500 },
  { tier: 'SILVER_IB', minMonthlyVolumeUsd: 250_000, rebateRateBps: 2000 },
  { tier: 'GOLD_IB', minMonthlyVolumeUsd: 1_000_000, rebateRateBps: 2500 },
  { tier: 'INSTITUTIONAL_IB', minMonthlyVolumeUsd: 5_000_000, rebateRateBps: 3500 },
] as const;

export default PartnerDashboard;
