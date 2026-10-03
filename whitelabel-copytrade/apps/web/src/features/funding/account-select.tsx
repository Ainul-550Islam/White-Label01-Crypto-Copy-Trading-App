"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fundingApi, type FundingAccount } from "@/api/funding-api";

export function useFundingAccounts() {
  return useQuery({
    queryKey: ["funding", "accounts"],
    queryFn: () => fundingApi.listAccounts(),
  });
}

/** An account can take the request when it is active and the capability is enabled. */
export function accountAllows(
  account: FundingAccount,
  direction: "DEPOSIT" | "WITHDRAWAL",
): boolean {
  if (account.state !== "ACTIVE") return false;
  return direction === "DEPOSIT"
    ? account.isFundingEnabled
    : account.isWithdrawalEnabled;
}

/**
 * Account picker for funding forms. Accounts that cannot take the request are
 * listed but disabled, so the user sees why instead of getting a 400.
 */
export function AccountSelect({
  accounts,
  direction,
  value,
  onChange,
}: {
  accounts: FundingAccount[];
  direction: "DEPOSIT" | "WITHDRAWAL";
  value: string;
  onChange: (accountId: string) => void;
}): JSX.Element {
  const usable = accounts.filter((a) => accountAllows(a, direction));

  useEffect(() => {
    if (!value && usable.length === 1 && usable[0]) onChange(usable[0].id);
  }, [value, usable, onChange]);

  return (
    <label className="block text-sm">
      Account
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border px-3 py-2 text-sm"
      >
        <option value="">Select an account</option>
        {accounts.map((a) => {
          const allowed = accountAllows(a, direction);
          const why =
            a.state !== "ACTIVE"
              ? a.state.replace(/_/g, " ").toLowerCase()
              : direction === "DEPOSIT"
                ? "deposits disabled"
                : "withdrawals disabled";
          return (
            <option key={a.id} value={a.id} disabled={!allowed}>
              {a.label}
              {allowed ? "" : ` (${why})`}
            </option>
          );
        })}
      </select>
    </label>
  );
}
