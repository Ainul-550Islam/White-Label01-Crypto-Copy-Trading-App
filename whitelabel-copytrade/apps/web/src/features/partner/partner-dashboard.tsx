// # NEW — Displays partner tier, active referrals, volume, and accrued commissions
"use client";
import type { JSX } from 'react';

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { partnerApi, type PartnerProfileResponse, type PartnerReferralsResponse } from "../../api/partner-api";
import { TradingStateBoundary } from "../../components/trading-state";

export interface PartnerDashboardProps {
  partnerId?: string;
}

export function PartnerDashboard({ partnerId }: PartnerDashboardProps): JSX.Element {
  const profileQuery = useQuery<PartnerProfileResponse>({
    queryKey: ["partner", "profile", partnerId ?? "self"],
    queryFn: () => partnerApi.getProfile(partnerId ? { partnerId } : undefined),
  });

  const referralsQuery = useQuery<PartnerReferralsResponse>({
    queryKey: ["partner", "referrals", partnerId ?? "self"],
    queryFn: () => partnerApi.listReferrals(partnerId ? { partnerId } : undefined),
  });

  const profile = profileQuery.data?.profile;
  const summary = profileQuery.data?.summary;
  const referrals = referralsQuery.data?.referrals ?? [];
  const attributions = referralsQuery.data?.attributions ?? [];

  return (
    <div data-testid="partner-dashboard" className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Partner & Introducing Broker Portal
          </h1>
          <p className="text-sm text-slate-600">
            Track referral attribution, tiered trading fee rebates, commission ledger accruals, and settlements.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/partner/referrals"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            Manage Referral Links
          </Link>
          <Link
            href="/partner/commissions"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            Commission Ledger
          </Link>
          <Link
            href="/partner/payouts"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Request Payout
          </Link>
        </div>
      </div>

      <TradingStateBoundary
        isLoading={profileQuery.isLoading}
        error={profileQuery.error}
        isEmpty={!profile}
        emptyTitle="Partner profile not provisioned"
        emptyDescription="Apply for an Introducing Broker or Affiliate agreement to unlock referral links and fee rebates."
        onRetry={() => profileQuery.refetch()}
      >
        {profile && (
          <>
            <div
              data-testid="partner-tier-summary"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs font-medium uppercase text-slate-500">Partner Tier</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {summary?.tierName ?? profile.tier ?? profile.type}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Code: <code>{profile.code}</code> · Status: {profile.state}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs font-medium uppercase text-slate-500">Active Referrals</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {summary?.activeReferralsCount ?? attributions.length}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {referrals.length} active referral codes
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs font-medium uppercase text-slate-500">Referred Volume</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  ${summary?.referredTradingVolumeUsd ?? "0.00"}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Rebate Rate: {summary?.rebateRateBps ?? 2000} bps
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs font-medium uppercase text-slate-500">
                  Accrued Commissions
                </div>
                <div className="mt-1 text-lg font-bold text-emerald-700">
                  {summary?.accruedCommissionsAmount ?? "0.00"} {profile.currency}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Available for Payout: {summary?.availablePayoutBalance ?? "0.00"} {profile.currency}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Recent Referral Codes & Attribution Funnel
              </h2>
              {referrals.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  No referral links generated yet. Visit Referral Manager to create your first code.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2 pr-4">Referral Code</th>
                        <th className="py-2 pr-4">Campaign</th>
                        <th className="py-2 pr-4">Signups / Max Uses</th>
                        <th className="py-2 pr-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {referrals.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 pr-4 font-mono font-semibold">{r.code}</td>
                          <td className="py-2 pr-4">{r.campaignId ?? "DEFAULT"}</td>
                          <td className="py-2 pr-4">
                            {r.usesCount ?? 0} / {r.maxUses ?? "∞"}
                          </td>
                          <td className="py-2 pr-4">{r.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </TradingStateBoundary>
    </div>
  );
}
