// # NEW — Displays trade-level rebate calculations, tier rates, and settlement status
"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { partnerApi, type PartnerCommissionRecord } from "../../api/partner-api";
import { TradingStateBoundary } from "../../components/trading-state";

export interface CommissionLedgerProps {
  partnerId?: string;
}

export function CommissionLedger({ partnerId }: CommissionLedgerProps): JSX.Element {
  const [stateFilter, setStateFilter] = useState<string>("");

  const commissionsQuery = useQuery<{ partnerId: string; items: PartnerCommissionRecord[] }>({
    queryKey: ["partner", "commissions", partnerId ?? "self", stateFilter],
    queryFn: () =>
      partnerApi.listCommissions({
        ...(partnerId ? { partnerId } : {}),
        ...(stateFilter ? { state: stateFilter } : {}),
      }),
  });

  const items = commissionsQuery.data?.items ?? [];

  return (
    <div data-testid="partner-commission-ledger" className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Partner Commission & Tiered Rebate Ledger
          </h1>
          <p className="text-sm text-slate-600">
            Trade-level and subscription-level fee rebate calculations, tier rates, and settlement status.
          </p>
        </div>

        <label className="text-xs font-medium text-slate-700">
          Filter Status:{" "}
          <select
            aria-label="Filter commission status"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="ml-2 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="">All States</option>
            <option value="ACCRUED">ACCRUED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="SETTLED">SETTLED</option>
            <option value="PAID">PAID</option>
            <option value="REVERSED">REVERSED</option>
          </select>
        </label>
      </div>

      <TradingStateBoundary
        isLoading={commissionsQuery.isLoading}
        error={commissionsQuery.error}
        isEmpty={items.length === 0}
        emptyTitle="No commission ledger entries"
        emptyDescription="Commissions accrue automatically as your attributed referrals generate eligible trading or platform fees."
        onRetry={() => commissionsQuery.refetch()}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3">Commission ID</th>
                <th className="px-4 py-3">Source Event</th>
                <th className="px-4 py-3">Gross Fee / Revenue</th>
                <th className="px-4 py-3">Tier Rate</th>
                <th className="px-4 py-3">Rebate Accrued</th>
                <th className="px-4 py-3">Settlement Status</th>
                <th className="px-4 py-3">Recorded At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">{row.id}</td>
                  <td className="px-4 py-3">
                    <code>{row.sourceEventType}</code> · <span>{row.sourceEventId}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.grossRevenue} {row.currency}
                  </td>
                  <td className="px-4 py-3">{row.commissionRateBps ?? 2000} bps</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">
                    +{row.commissionAmount} {row.currency}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-800">
                      {row.state}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{row.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TradingStateBoundary>
    </div>
  );
}
