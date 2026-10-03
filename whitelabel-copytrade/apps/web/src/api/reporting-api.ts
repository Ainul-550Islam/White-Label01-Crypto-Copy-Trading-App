import { apiClient } from "./api-client";

/**
 * Account statements (/v1/portfolio-accounting/statements).
 *
 * Statements are generated and persisted by the backend; this client only reads
 * them. They are addressed by their `statementId` (not the row id), the list is
 * filtered server-side to the caller's own profiles, and an export returns the
 * file content inline (`{ csv, filename }` or `{ json, filename }`), which the
 * browser turns into a download. There is no PDF or signed-URL endpoint.
 */

export type StatementExportFormat = "CSV" | "JSON";

export interface StatementHolding {
  symbol: string;
  asset: string | null;
  quantity: string;
  classification: string | null;
  costBasis: string | null;
}

export interface Statement {
  /** The statementId: the key used by every statement route. */
  id: string;
  recordId: string;
  profileId: string;
  periodId: string | null;
  periodStart: string;
  periodEnd: string;
  state: string;
  currency: string;
  openingNav: string | null;
  closingNav: string | null;
  netPnl: string | null;
  returnPercent: string | null;
  returnMethodology: string | null;
  finalizedAt: string | null;
  createdAt: string;
}

export interface StatementDetail extends Statement {
  deposits: string | null;
  withdrawals: string | null;
  transfers: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  grossPnl: string | null;
  feesTotal: string | null;
  cash: string | null;
  benchmarkReturn: string | null;
  reconciliationStatus: string | null;
  tradeCount: number | null;
  endingHoldings: StatementHolding[];
}

export interface StatementList {
  data: Statement[];
  total: number;
  page: number;
  limit: number;
}

interface BackendStatement {
  id: string;
  statementId: string;
  profileId: string;
  periodId?: string | null;
  state: string;
  periodStart: string;
  periodEnd: string;
  openingNav?: string | null;
  closingNav?: string | null;
  deposits?: string | null;
  withdrawals?: string | null;
  transfers?: string | null;
  tradingActivity?: { count?: unknown } | null;
  realizedPnl?: string | null;
  unrealizedPnl?: string | null;
  fees?: { total?: string | null; grossPnl?: string | null } | null;
  netPnl?: string | null;
  returnMethodology?: string | null;
  returnPercent?: string | null;
  benchmarkReturn?: string | null;
  endingHoldings?: unknown;
  cash?: string | null;
  reconciliationStatus?: string | null;
  baseCurrency: string;
  finalizedAt?: string | null;
  createdAt: string;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function toStatement(raw: BackendStatement): Statement {
  return {
    id: raw.statementId,
    recordId: raw.id,
    profileId: raw.profileId,
    periodId: raw.periodId ?? null,
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    state: raw.state,
    currency: raw.baseCurrency,
    openingNav: text(raw.openingNav),
    closingNav: text(raw.closingNav),
    netPnl: text(raw.netPnl),
    returnPercent: text(raw.returnPercent),
    returnMethodology: text(raw.returnMethodology),
    finalizedAt: raw.finalizedAt ?? null,
    createdAt: raw.createdAt,
  };
}

export function toStatementHoldings(value: unknown): StatementHolding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      symbol: text(item.symbol) ?? text(item.asset) ?? "—",
      asset: text(item.asset),
      quantity: text(item.quantity) ?? "0",
      classification: text(item.classification),
      costBasis: text(item.costBasis),
    }));
}

export function toStatementDetail(raw: BackendStatement): StatementDetail {
  const count = raw.tradingActivity?.count;
  return {
    ...toStatement(raw),
    deposits: text(raw.deposits),
    withdrawals: text(raw.withdrawals),
    transfers: text(raw.transfers),
    realizedPnl: text(raw.realizedPnl),
    unrealizedPnl: text(raw.unrealizedPnl),
    grossPnl: text(raw.fees?.grossPnl),
    feesTotal: text(raw.fees?.total),
    cash: text(raw.cash),
    benchmarkReturn: text(raw.benchmarkReturn),
    reconciliationStatus: text(raw.reconciliationStatus),
    tradeCount:
      typeof count === "number" && Number.isFinite(count) ? count : null,
    endingHoldings: toStatementHoldings(raw.endingHoldings),
  };
}

/** File content of an export response as a Blob plus its filename. */
export function toExportFile(
  response: { csv?: string; json?: unknown; filename?: string },
  statementId: string,
  format: StatementExportFormat,
): { blob: Blob; filename: string } {
  const filename =
    response.filename ?? `statement_${statementId}.${format.toLowerCase()}`;
  if (format === "CSV") {
    return {
      blob: new Blob([response.csv ?? ""], { type: "text/csv;charset=utf-8" }),
      filename,
    };
  }
  return {
    blob: new Blob([JSON.stringify(response.json ?? null, null, 2)], {
      type: "application/json",
    }),
    filename,
  };
}

export const reportingApi = {
  listStatements: async (params?: {
    profileId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<StatementList> => {
    const page = await apiClient.get<{
      data: BackendStatement[];
      total: number;
      page?: number;
      limit?: number;
    }>("/v1/portfolio-accounting/statements", {
      searchParams: {
        profileId: params?.profileId,
        from: params?.from,
        to: params?.to,
        page: params?.page,
        limit: params?.limit,
      },
    });
    return {
      data: (page.data ?? []).map(toStatement),
      total: page.total ?? 0,
      page: page.page ?? params?.page ?? 1,
      limit: page.limit ?? params?.limit ?? 50,
    };
  },

  getStatement: async (statementId: string): Promise<StatementDetail> =>
    toStatementDetail(
      await apiClient.get<BackendStatement>(
        `/v1/portfolio-accounting/statements/${encodeURIComponent(statementId)}`,
      ),
    ),

  exportStatement: async (
    statementId: string,
    format: StatementExportFormat = "CSV",
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get<{
      csv?: string;
      json?: unknown;
      filename?: string;
    }>(
      `/v1/portfolio-accounting/statements/${encodeURIComponent(statementId)}/export`,
      { searchParams: { format } },
    );
    return toExportFile(response, statementId, format);
  },
};
