"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tradingApi, type CopySizingMode } from "@/api/trading-api";
import { ApiError } from "@/api/api-errors";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

const DECIMAL = /^\d+(\.\d+)?$/;

const MODES: Array<{ value: CopySizingMode; label: string; hint: string }> = [
  { value: "FIXED", label: "Fixed amount", hint: "Allocate a fixed amount of your balance" },
  { value: "PROPORTIONAL", label: "Proportional", hint: "Mirror the trader's position sizes by a ratio" },
  { value: "PERCENTAGE_BALANCE", label: "% of balance", hint: "Allocate a percentage of your balance" },
];

/**
 * Opens a copy subscription. The API needs the trader id as well as the
 * strategy id and an allocation mode (the old form sent neither, plus a
 * `sizingMode` field the API rejects). Amounts stay decimal strings.
 */
export function CopySubscriptionFlow({ strategyId, traderId }: { strategyId: string; traderId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<string>("");
  const [mode, setMode] = useState<CopySizingMode>("FIXED");
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  const amountValid = DECIMAL.test(amount) && Number(amount) > 0;
  const mutation = useMutation({
    mutationFn: () => tradingApi.createCopySubscription({ traderId, strategyId, allocationMode: mode, allocationAmount: amount }),
    onSuccess: (sub) => {
      setSuccess(`Copy subscription created (${sub.state.toLowerCase()}).`);
      setError("");
      setConfirmOpen(false);
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["copy-subs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "copy", "subscriptions"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.getUserMessage() : "Could not create the copy subscription.");
      setConfirmOpen(false);
    },
  });

  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Copy This Strategy</h3>
      <p className="text-xs text-muted">
        No trusted values submitted from the browser: the server re-checks eligibility, compliance, plan limits and your
        available balance before anything is copied.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          aria-label="Allocation mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as CopySizingMode)}
          className="rounded border px-3 py-2 text-sm"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.hint}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          value={amount}
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value.trim())}
          placeholder={mode === "PERCENTAGE_BALANCE" ? "Percent (e.g. 10)" : mode === "PROPORTIONAL" ? "Ratio (e.g. 0.1)" : "Amount"}
          className="rounded border px-3 py-2 text-sm"
        />
        <button
          onClick={() => {
            setSuccess("");
            setConfirmOpen(true);
          }}
          disabled={!amountValid || mutation.isPending}
          className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Copy
        </button>
      </div>
      {amount !== "" && !amountValid && <p className="mt-2 text-xs text-red-600">Enter a positive number, e.g. 250 or 0.5.</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {success && <p className="mt-2 text-xs text-green-600">{success}</p>}
      <ConfirmationDialog
        open={confirmOpen}
        title="Confirm Copy Subscription"
        description={`Copy this strategy with ${MODES.find((m) => m.value === mode)?.label.toLowerCase()} ${amount}? The server validates eligibility, risk and compliance.`}
        confirmLabel="Confirm Copy"
        onConfirm={() => mutation.mutate()}
        onCancel={() => setConfirmOpen(false)}
        isLoading={mutation.isPending}
      />
    </div>
  );
}
