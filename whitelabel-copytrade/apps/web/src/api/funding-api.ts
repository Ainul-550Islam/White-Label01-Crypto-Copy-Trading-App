import { apiClient } from "./api-client";

/**
 * Customer deposits and withdrawals (/v1/client-lifecycle/funding, /withdrawals).
 *
 * Both are *requests* against one of the caller's accounts: operators review
 * them, and only a CONFIRMED request means money moved. The backend filters
 * every list to the caller's own accounts (tenant isolation plus ownership),
 * validates the amount (> 0), the currency against the tenant funding policy,
 * account restrictions and compliance/risk holds. Custody wallets and deposit
 * addresses are an operator surface and are not called from here.
 */

export type FundingDirection = "DEPOSIT" | "WITHDRAWAL";

export type FundingState =
  | "REQUESTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED"
  | "REVERSED"
  | "CANCELLED";

/** States in which a request is still open (not money movement yet). */
export const OPEN_FUNDING_STATES: readonly string[] = [
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "SUBMITTED",
];

export interface FundingAccount {
  id: string;
  label: string;
  accountType: string;
  state: string;
  clientProfileId: string | null;
  isFundingEnabled: boolean;
  isWithdrawalEnabled: boolean;
}

export interface FundingRequest {
  id: string;
  type: FundingDirection;
  accountId: string;
  state: string;
  /** Requested amount (what the customer asked for). */
  amount: string;
  approvedAmount: string | null;
  confirmedAmount: string | null;
  settledAmount: string | null;
  currency: string;
  /** Alias of `currency`, kept for existing callers. */
  asset: string;
  destinationAddress: string | null;
  externalReference: string | null;
  failureReason: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FundingPage {
  data: FundingRequest[];
  total: number;
}

type Raw = Record<string, unknown>;

function optStr(value: unknown): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function rows(value: unknown): Raw[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Raw => typeof item === "object" && item !== null,
      )
    : [];
}

export function toFundingAccount(raw: Raw): FundingAccount {
  const id = String(raw.id ?? "");
  const accountType = String(raw.accountType ?? "ACCOUNT");
  return {
    id,
    label:
      optStr(raw.displayName) ??
      `${accountType.replace(/_/g, " ").toLowerCase()} ${id.slice(0, 8)}`,
    accountType,
    state: String(raw.state ?? "UNKNOWN"),
    clientProfileId: optStr(raw.clientProfileId),
    isFundingEnabled: raw.isFundingEnabled === true,
    isWithdrawalEnabled: raw.isWithdrawalEnabled === true,
  };
}

export function toFundingRequest(
  raw: Raw,
  type: FundingDirection,
): FundingRequest {
  const currency = String(raw.currency ?? "");
  const requestedAt = String(raw.requestedAt ?? raw.createdAt ?? "");
  return {
    id: String(raw.id ?? ""),
    type,
    accountId: String(raw.accountId ?? ""),
    state: String(raw.state ?? "UNKNOWN"),
    amount: String(raw.requestedAmount ?? "0"),
    approvedAmount: optStr(raw.approvedAmount),
    confirmedAmount: optStr(raw.confirmedAmount),
    settledAmount: optStr(raw.settledAmount),
    currency,
    asset: currency,
    destinationAddress: optStr(raw.destinationAddress),
    externalReference: optStr(raw.externalReference),
    failureReason: optStr(raw.failureReason),
    requestedAt,
    confirmedAt: optStr(raw.confirmedAt),
    failedAt: optStr(raw.failedAt),
    createdAt: String(raw.createdAt ?? requestedAt),
    updatedAt: String(raw.updatedAt ?? raw.createdAt ?? requestedAt),
  };
}

/** Deposits and withdrawals interleaved newest first (display only; totals are summed). */
export function mergeFundingHistory(
  deposits: FundingPage,
  withdrawals: FundingPage,
  limit: number,
): FundingPage {
  const data = [...deposits.data, ...withdrawals.data]
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
    .slice(0, limit);
  return { data, total: deposits.total + withdrawals.total };
}

/** UX pre-check only; the backend applies the authoritative validation. */
export function isPositiveAmount(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

type ListParams = {
  accountId?: string;
  state?: string;
  currency?: string;
  page?: number;
  limit?: number;
};

async function listPage(
  path: string,
  type: FundingDirection,
  params?: ListParams,
): Promise<FundingPage> {
  const res = await apiClient.get<{ data?: Raw[]; total?: number }>(path, {
    searchParams: {
      accountId: params?.accountId,
      state: params?.state,
      currency: params?.currency,
      page: params?.page,
      limit: params?.limit,
    },
  });
  const data = rows(res.data).map((raw) => toFundingRequest(raw, type));
  return { data, total: res.total ?? data.length };
}

export const fundingApi = {
  /** Accounts the caller owns or may act for (filtered by the backend). */
  listAccounts: async (): Promise<FundingAccount[]> => {
    const res = await apiClient.get<{ data?: Raw[] }>(
      "/v1/client-lifecycle/accounts",
      { searchParams: { limit: 100 } },
    );
    return rows(res.data).map(toFundingAccount);
  },

  listFundingRequests: (params?: ListParams): Promise<FundingPage> =>
    listPage("/v1/client-lifecycle/funding", "DEPOSIT", params),

  listWithdrawalRequests: (params?: ListParams): Promise<FundingPage> =>
    listPage("/v1/client-lifecycle/withdrawals", "WITHDRAWAL", params),

  listHistory: async (params?: {
    accountId?: string;
    limit?: number;
  }): Promise<FundingPage> => {
    const limit = params?.limit ?? 20;
    const [deposits, withdrawals] = await Promise.all([
      listPage("/v1/client-lifecycle/funding", "DEPOSIT", {
        accountId: params?.accountId,
        page: 1,
        limit,
      }),
      listPage("/v1/client-lifecycle/withdrawals", "WITHDRAWAL", {
        accountId: params?.accountId,
        page: 1,
        limit,
      }),
    ]);
    return mergeFundingHistory(deposits, withdrawals, limit);
  },

  createDepositRequest: async (data: {
    accountId: string;
    amount: string;
    currency: string;
    externalReference?: string;
  }): Promise<FundingRequest> =>
    toFundingRequest(
      await apiClient.post<Raw>("/v1/client-lifecycle/funding", {
        accountId: data.accountId,
        requestedAmount: data.amount,
        currency: data.currency,
        ...(data.externalReference
          ? { externalReference: data.externalReference }
          : {}),
      }),
      "DEPOSIT",
    ),

  createWithdrawalRequest: async (data: {
    accountId: string;
    amount: string;
    currency: string;
    destinationAddress: string;
    destinationType?: string;
  }): Promise<FundingRequest> =>
    toFundingRequest(
      await apiClient.post<Raw>("/v1/client-lifecycle/withdrawals", {
        accountId: data.accountId,
        requestedAmount: data.amount,
        currency: data.currency,
        destinationAddress: data.destinationAddress,
        ...(data.destinationType
          ? { destinationType: data.destinationType }
          : {}),
      }),
      "WITHDRAWAL",
    ),
};
