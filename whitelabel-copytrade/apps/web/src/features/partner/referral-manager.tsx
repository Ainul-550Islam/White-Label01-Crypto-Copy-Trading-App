// # NEW — Creates referral links/codes and displays attribution funnel
"use client";
import type { JSX } from 'react';

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerApi, type PartnerReferralsResponse } from "../../api/partner-api";
import { TradingStateBoundary } from "../../components/trading-state";

export interface ReferralManagerProps {
  partnerId?: string;
}

export function ReferralManager({ partnerId }: ReferralManagerProps): JSX.Element {
  const queryClient = useQueryClient();
  const [code, setCode] = useState<string>("");
  const [campaignId, setCampaignId] = useState<string>("camp-default");
  const [maxUses, setMaxUses] = useState<string>("500");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const referralsQuery = useQuery<PartnerReferralsResponse>({
    queryKey: ["partner", "referrals", partnerId ?? "self"],
    queryFn: () => partnerApi.listReferrals(partnerId ? { partnerId } : undefined),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      partnerApi.createReferral({
        partnerId: referralsQuery.data?.partnerId ?? partnerId ?? "partner-default",
        campaignId,
        code: code.trim().toUpperCase(),
        maxUses: Number(maxUses) || 500,
        createdBy: "partner-portal",
        correlationId: `corr_${Date.now()}`,
        idempotencyKey: `ref_${code.trim().toUpperCase()}`,
      }),
    onSuccess: (created) => {
      setCode("");
      setStatusMessage(`Referral code ${created.code} created.`);
      queryClient.invalidateQueries({ queryKey: ["partner", "referrals"] });
    },
  });

  const referrals = referralsQuery.data?.referrals ?? [];
  const attributions = referralsQuery.data?.attributions ?? [];

  return (
    <div data-testid="referral-manager" className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Referral Links & Campaign Funnel</h1>
        <p className="text-sm text-slate-600">
          Create tracked referral codes and monitor signup-to-active-follower attribution.
        </p>
      </div>

      <form
        data-testid="create-referral-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length >= 3) {
            createMutation.mutate();
          }
        }}
        className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4"
      >
        <label className="text-xs font-medium text-slate-700">
          Referral Code
          <input
            aria-label="Referral code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. ALPHA2026"
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Campaign ID
          <input
            aria-label="Campaign ID"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Max Uses
          <input
            aria-label="Max uses"
            type="number"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={createMutation.isPending || code.trim().length < 3}
            className="w-full rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create Referral Link"}
          </button>
        </div>
      </form>

      {statusMessage && (
        <div role="status" className="text-xs font-medium text-emerald-700">
          {statusMessage}
        </div>
      )}

      <TradingStateBoundary
        isLoading={referralsQuery.isLoading}
        error={referralsQuery.error}
        isEmpty={referrals.length === 0 && attributions.length === 0}
        emptyTitle="No referrals or attributions yet"
        emptyDescription="Generate a referral code above and share the link to start earning tiered trading rebates."
        onRetry={() => referralsQuery.refetch()}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Active Referral Codes</h2>
            <ul className="mt-3 divide-y divide-slate-100 text-xs">
              {referrals.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-mono font-semibold text-slate-900">{r.code}</span>
                    <span className="ml-2 text-slate-500">({r.state})</span>
                  </div>
                  <div className="text-slate-600">
                    Uses: {r.usesCount ?? 0} / {r.maxUses ?? "∞"}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Attributed Signups</h2>
            <ul className="mt-3 divide-y divide-slate-100 text-xs">
              {attributions.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div>
                    <code className="font-semibold text-slate-800">{a.tenantId}</code>
                    <span className="ml-2 text-slate-500">via {a.referralCode ?? a.attributionSource}</span>
                  </div>
                  <div className="text-slate-500">{a.capturedAt}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </TradingStateBoundary>
    </div>
  );
}
