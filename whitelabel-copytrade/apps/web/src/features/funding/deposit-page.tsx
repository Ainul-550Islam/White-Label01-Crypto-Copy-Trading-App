"use client";

import type { JSX } from 'react';
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fundingApi,
  isPositiveAmount,
  type FundingRequest,
} from "@/api/funding-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { FundingStatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import {
  AccountSelect,
  accountAllows,
  useFundingAccounts,
} from "./account-select";

export function DepositPage(): JSX.Element {
  const queryClient = useQueryClient();
  const accounts = useFundingAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USDT");
  const [reference, setReference] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [created, setCreated] = useState<FundingRequest | null>(null);

  const amountValid = isPositiveAmount(amount.trim());
  const currencyValid = /^[A-Z0-9]{2,10}$/.test(currency);
  const canSubmit =
    Boolean(accountId) && amountValid && currencyValid && !loading;

  const handleSubmit = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const request = await fundingApi.createDepositRequest({
        accountId,
        amount: amount.trim(),
        currency,
        externalReference: reference.trim() || undefined,
      });
      setCreated(request);
      setAmount("");
      setReference("");
      await queryClient.invalidateQueries({ queryKey: ["funding"] });
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "funding"],
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The deposit request could not be created.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title="Deposit"
      description="Request a deposit to one of your accounts"
    >
      {accounts.isLoading ? (
        <LoadingState message="Loading accounts..." />
      ) : accounts.error ? (
        <ErrorState
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
        />
      ) : (accounts.data ?? []).length === 0 ? (
        <EmptyState
          title="No account yet"
          description="Complete onboarding to open an account before depositing."
          action={{ label: "Onboarding", href: "/onboarding" }}
        />
      ) : (
        <div className="max-w-md space-y-3 rounded border bg-card p-4">
          <AccountSelect
            accounts={accounts.data ?? []}
            direction="DEPOSIT"
            value={accountId}
            onChange={setAccountId}
          />
          {!(accounts.data ?? []).some((a) => accountAllows(a, "DEPOSIT")) && (
            <p className="text-xs text-muted">
              None of your accounts currently accepts deposits. Contact support
              if this is unexpected.
            </p>
          )}
          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              Amount
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <label className="block w-28 text-sm">
              Currency
              <input
                value={currency}
                onChange={(e) =>
                  setCurrency(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
                maxLength={10}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
          </div>
          {amount && !amountValid && (
            <p className="text-xs text-red-600">
              Enter an amount greater than zero, using digits and an optional
              decimal point.
            </p>
          )}
          <label className="block text-sm">
            Transfer reference (optional)
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          {error && <InlineError message={error} />}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Request deposit"}
          </button>
          <p className="text-xs text-muted">
            A deposit request records the transfer you intend to make. Your
            balance is credited only after operations confirm the funds were
            received. Pending does not mean completed.
          </p>
          {created && (
            <div className="rounded border p-3 text-sm" role="status">
              <div className="flex items-center justify-between">
                <span>
                  Deposit of{" "}
                  <Money value={created.amount} currency={created.currency} />
                </span>
                <FundingStatusBadge state={created.state} />
              </div>
              <p className="mt-1 text-xs text-muted">
                Reference {created.id.slice(0, 8)} — track it in the funding
                history.
              </p>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
