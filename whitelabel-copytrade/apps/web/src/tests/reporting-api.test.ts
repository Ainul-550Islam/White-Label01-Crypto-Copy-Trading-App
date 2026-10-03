/**
 * Mapping of persisted PortfolioStatement rows (GET /v1/portfolio-accounting/statements)
 * into the statement views, and of export responses into downloadable files.
 */
import {
  toExportFile,
  toStatement,
  toStatementDetail,
  toStatementHoldings,
} from "../api/reporting-api";

const row = {
  id: "row-uuid-1",
  statementId: "stmt-2026-09",
  profileId: "profile-1",
  periodId: "period-9",
  state: "FINALIZED",
  periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-09-30T23:59:59.999Z",
  openingNav: "10000.00",
  closingNav: "10450.25",
  deposits: "500",
  withdrawals: "0",
  transfers: "-25.5",
  tradingActivity: { count: 12, deposits: [], withdrawals: [], transfers: [] },
  realizedPnl: "120.10",
  unrealizedPnl: "-4.35",
  fees: { total: "3.20", grossPnl: "115.75" },
  netPnl: "112.55",
  returnMethodology: "TWR",
  returnPercent: "1.0912",
  benchmarkReturn: null,
  endingHoldings: [
    {
      symbol: "BTCUSDT",
      asset: "BTC",
      quantity: "0.15",
      classification: "SPOT",
      costBasis: "9100.00",
    },
    { asset: "ETH", quantity: "2", classification: "SPOT", costBasis: null },
  ],
  cash: "1200.00",
  reconciliationStatus: "MATCHED",
  baseCurrency: "USDT",
  finalizedAt: "2026-10-01T00:05:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("reporting-api mappers", () => {
  test("list rows are keyed by statementId, not the database id", () => {
    const statement = toStatement(row);
    expect(statement.id).toBe("stmt-2026-09");
    expect(statement.recordId).toBe("row-uuid-1");
    expect(statement.currency).toBe("USDT");
    expect(statement.closingNav).toBe("10450.25");
    expect(statement.netPnl).toBe("112.55");
    expect(statement.returnPercent).toBe("1.0912");
  });

  test("detail exposes cash flows, PnL, fees, trade count and holdings verbatim", () => {
    const detail = toStatementDetail(row);
    expect(detail).toMatchObject({
      id: "stmt-2026-09",
      deposits: "500",
      withdrawals: "0",
      transfers: "-25.5",
      realizedPnl: "120.10",
      unrealizedPnl: "-4.35",
      grossPnl: "115.75",
      feesTotal: "3.20",
      cash: "1200.00",
      benchmarkReturn: null,
      reconciliationStatus: "MATCHED",
      tradeCount: 12,
    });
    expect(detail.endingHoldings).toEqual([
      {
        symbol: "BTCUSDT",
        asset: "BTC",
        quantity: "0.15",
        classification: "SPOT",
        costBasis: "9100.00",
      },
      {
        symbol: "ETH",
        asset: "ETH",
        quantity: "2",
        classification: "SPOT",
        costBasis: null,
      },
    ]);
  });

  test("missing or malformed Json columns degrade to empty values, never invented numbers", () => {
    const detail = toStatementDetail({
      ...row,
      openingNav: null,
      fees: null,
      tradingActivity: { count: "twelve" },
      endingHoldings: "not-an-array",
    });
    expect(detail.openingNav).toBeNull();
    expect(detail.feesTotal).toBeNull();
    expect(detail.grossPnl).toBeNull();
    expect(detail.tradeCount).toBeNull();
    expect(detail.endingHoldings).toEqual([]);
    expect(toStatementHoldings([null, 7, { quantity: "1" }])).toEqual([
      {
        symbol: "—",
        asset: null,
        quantity: "1",
        classification: null,
        costBasis: null,
      },
    ]);
  });

  test("CSV export becomes a text/csv file with the backend filename", async () => {
    const file = toExportFile(
      { csv: "a,b\n1,2", filename: "statement_stmt-2026-09.csv" },
      "stmt-2026-09",
      "CSV",
    );
    expect(file.filename).toBe("statement_stmt-2026-09.csv");
    expect(file.blob.type).toBe("text/csv;charset=utf-8");
    await expect(file.blob.text()).resolves.toBe("a,b\n1,2");
  });

  test("JSON export is serialised and falls back to a derived filename", async () => {
    const file = toExportFile(
      { json: { statementId: "stmt-2026-09" } },
      "stmt-2026-09",
      "JSON",
    );
    expect(file.filename).toBe("statement_stmt-2026-09.json");
    expect(file.blob.type).toBe("application/json");
    expect(JSON.parse(await file.blob.text())).toEqual({
      statementId: "stmt-2026-09",
    });
  });
});
