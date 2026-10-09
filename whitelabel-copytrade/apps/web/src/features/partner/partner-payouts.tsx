// # NEW — Submits payout requests and displays approval/settlement timeline
"use client";
import type { JSX } from 'react';

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerApi, type PartnerPayoutRecord } from "../../api/partner-api";
import { TradingStateBoundary } from "../../components/trading-state";

export interface PartnerPayoutsProps {
  partnerId?: string;
}

export function PartnerPayouts({ partnerId }: PartnerPayoutsProps): JSX.Element {
  const queryClient = useQueryClient();
  const [settlementId, setSettlementId] = useState<string>("stl-latest");
  const [amount, setAmount] = useState<string>("250.00");
  const [currency, setCurrency] = useState<string>("USDT");
  const [method, setMethod] = useState<string>("USDT_ERC20");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const payoutsQuery = useQuery<{ partnerId: string; items: PartnerPayoutRecord[] }>({
    queryKey: ["partner", "payouts", partnerId ?? "self"],
    queryFn: () => partnerApi.listPayouts(partnerId ? { partnerId } : undefined),
  });

  const requestMutation = useMutation({
    mutationFn: () =>
      partnerApi.requestPayout({
        partnerId: payoutsQuery.data?.partnerId ?? partnerId ?? "partner-default",
        settlementId: settlementId.trim(),
        amount: amount.trim(),
        currency,
        method,
        requestedBy: "partner-portal",
        correlationId: `corr_${Date.now()}`,
        idempotencyKey: `payout_${settlementId.trim()}_${amount.trim()}`,
      }),
    onSuccess: (created) => {
      setStatusMessage(`Payout request ${created.id} submitted (${created.state}).`);
      queryClient.invalidateQueries({ queryKey: ["partner", "payouts"] });
    },
  });

  const items = payoutsQuery.data?.items ?? [];

  return (
    <div data-testid="partner-payouts" className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Partner Payout Requests & Settlement History
        </h1>
        <p className="text-sm text-slate-600">
          Submit payout requests against approved commission settlements and track payout disbursement status.
        </p>
      </div>

      <form
        data-testid="partner-payout-request-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (Number(amount) > 0 && settlementId.trim()) {
            requestMutation.mutate();
          }
        }}
        className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-5"
      >
        <label className="text-xs font-medium text-slate-700">
          Settlement ID
          <input
            aria-label="Settlement ID"
            value={settlementId}
            onChange={(e) => setSettlementId(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Amount
          <input
            aria-label="Payout amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Currency
          <select
            aria-label="Payout currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="USDT">USDT</option>
            <option value="USDC">USDC</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">
          Payout Method
          <select
            aria-label="Payout method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="USDT_ERC20">USDT (ERC-20)</option>
            <option value="USDC_ERC20">USDC (ERC-20)</option>
            <option value="BANK_WIRE">Bank Wire</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={requestMutation.isPending || Number(amount) <= 0}
            className="w-full rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {requestMutation.isPending ? "Submitting…" : "Submit Payout Request"}
          </button>
        </div>
      </form>

      {statusMessage && (
        <div role="status" className="text-xs font-medium text-emerald-700">
          {statusMessage}
        </div>
      )}

      <TradingStateBoundary
        isLoading={payoutsQuery.isLoading}
        error={payoutsQuery.error}
        isEmpty={items.length === 0}
        emptyTitle="No partner payouts recorded"
        emptyDescription="Submit a payout request above once your commission settlement period is approved."
        onRetry={() => payoutsQuery.refetch()}
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3">Payout ID</th>
                <th className="px-4 py-3">Settlement</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Reference / Note</th>
                <th className="px-4 py-3">Requested At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">{row.id}</td>
                  <td className="px-4 py-3 font-mono">{row.settlementId}</td>
                  <td className="px-4 py-3 font-semibold">
                    {row.amount} {row.currency}
                  </td>
                  <td className="px-4 py-3">{row.method}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-800">
                      {row.state}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.providerReference ?? row.failureReason ?? "—"}
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
