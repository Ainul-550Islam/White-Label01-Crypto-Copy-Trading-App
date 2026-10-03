"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fundingApi, isPositiveAmount } from "@/api/funding-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import {
  AccountSelect,
  accountAllows,
  useFundingAccounts,
} from "./account-select";

export function WithdrawalPage(): JSX.Element {
  const queryClient = useQueryClient();
  const accounts = useFundingAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USDT");
  const [dest, setDest] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

  const amountValid = isPositiveAmount(amount.trim());
  const currencyValid = /^[A-Z0-9]{2,10}$/.test(currency);
  const destValid = dest.trim().length >= 8;
  const canSubmit =
    Boolean(accountId) && amountValid && currencyValid && destValid;

  const handleWithdraw = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const res = await fundingApi.createWithdrawalRequest({
        accountId,
        amount: amount.trim(),
        currency,
        destinationAddress: dest.trim(),
      });
      setSuccess(
        `Withdrawal ${res.id.slice(0, 8)} requested (${res.state.replace(/_/g, " ").toLowerCase()}). Approval is not settlement: funds leave only after review and on-chain confirmation.`,
      );
      setConfirmOpen(false);
      setAmount("");
      setDest("");
      await queryClient.invalidateQueries({ queryKey: ["funding"] });
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "funding"],
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The withdrawal request could not be created.",
      );
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title="Withdraw"
      description="Secure withdrawal workflow with backend validation"
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
          description="Complete onboarding to open an account."
          action={{ label: "Onboarding", href: "/onboarding" }}
        />
      ) : (
        <div className="max-w-md space-y-3 rounded border bg-card p-4">
          <AccountSelect
            accounts={accounts.data ?? []}
            direction="WITHDRAWAL"
            value={accountId}
            onChange={setAccountId}
          />
          {!(accounts.data ?? []).some((a) =>
            accountAllows(a, "WITHDRAWAL"),
          ) && (
            <p className="text-xs text-muted">
              None of your accounts currently allows withdrawals. Contact
              support if this is unexpected.
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
            Destination address
            <input
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
            />
          </label>
          {error && <InlineError message={error} />}
          {success && (
            <p className="text-xs text-green-700" role="status">
              {success}
            </p>
          )}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canSubmit}
            className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Request Withdrawal
          </button>
          <p className="text-xs text-muted">
            Withdrawal requested does not mean completed. Settlement is
            backend-authoritative.
          </p>
        </div>
      )}
      <ConfirmationDialog
        open={confirmOpen}
        title="Confirm Withdrawal"
        description={`Withdraw ${amount} ${currency} to ${dest}? The request is reviewed (compliance, risk and account restrictions) before any funds move.`}
        variant="destructive"
        confirmLabel="Confirm Withdrawal"
        onConfirm={() => void handleWithdraw()}
        onCancel={() => setConfirmOpen(false)}
        isLoading={loading}
      />
    </PageContainer>
  );
}
