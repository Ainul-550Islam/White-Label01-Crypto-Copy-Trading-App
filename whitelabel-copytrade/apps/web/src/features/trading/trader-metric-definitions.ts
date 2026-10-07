// # NEW — Defines canonical metric formulas, units, and ACTUAL vs ESTIMATED provenance explanations
import type { TraderPerformance } from "@/api/trading-api";

export interface TraderMetricDefinition {
  key: keyof TraderPerformance | "winLossRatio";
  label: string;
  unit: "CURRENCY" | "PERCENT" | "RATIO" | "COUNT" | "DAYS";
  formula: string;
  description: string;
  provenanceNote: string;
}

export const TRADER_METRIC_DEFINITIONS: Record<string, TraderMetricDefinition> = {
  realizedPnl: {
    key: "realizedPnl",
    label: "Realized PnL",
    unit: "CURRENCY",
    formula: "Σ (Closed Sell Proceeds − FIFO Matched Buy Cost)",
    description:
      "Cumulative realized profit or loss across closed fills matched using canonical FIFO lot accounting.",
    provenanceNote: "Derived strictly from executed canonical fills; never client-supplied.",
  },
  unrealizedPnl: {
    key: "unrealizedPnl",
    label: "Unrealized PnL",
    unit: "CURRENCY",
    formula: "Σ ((Current Mark Price − Average Entry Price) × Open Position Quantity)",
    description:
      "Open mark-to-market profit or loss across active positions held on connected trading accounts.",
    provenanceNote: "Calculated from canonical open positions and latest mark prices.",
  },
  maxDrawdown: {
    key: "maxDrawdown",
    label: "Max Drawdown",
    unit: "CURRENCY",
    formula: "max(Peak Cumulative Realized PnL − Trough Cumulative Realized PnL)",
    description:
      "Largest peak-to-trough decline observed across the trader's cumulative realized PnL curve.",
    provenanceNote: "Measured from historical fill progression; null when no drawdown has occurred.",
  },
  winRate: {
    key: "winRate",
    label: "Win Rate",
    unit: "PERCENT",
    formula: "(Winning Closed Trades ÷ Total Closed Trades) × 100",
    description: "Percentage of closed round-trip trades that resulted in positive realized PnL.",
    provenanceNote: "Computed from canonical closed trade outcomes.",
  },
  profitFactor: {
    key: "profitFactor",
    label: "Profit Factor",
    unit: "RATIO",
    formula: "Gross Winning PnL ÷ |Gross Losing PnL|",
    description:
      "Ratio of gross profit from winning trades to gross loss from losing trades. Values above 1.0 indicate positive expectancy.",
    provenanceNote: "Derived from canonical fill-matched trade wins and losses.",
  },
  averageTrade: {
    key: "averageTrade",
    label: "Average Trade PnL",
    unit: "CURRENCY",
    formula: "Realized PnL ÷ Closed Trade Count",
    description: "Mean realized profit or loss per closed round-trip trade.",
    provenanceNote: "Computed from canonical realized PnL and closed trade count.",
  },
  totalVolume: {
    key: "totalVolume",
    label: "Total Executed Volume",
    unit: "CURRENCY",
    formula: "Σ (Fill Quantity × Fill Price)",
    description: "Aggregate quote notional volume executed across all canonical fills.",
    provenanceNote: "Summed directly from verified exchange fill records.",
  },
  historyLengthDays: {
    key: "historyLengthDays",
    label: "Track Record Length",
    unit: "DAYS",
    formula: "floor((Now − First Canonical Fill Timestamp) ÷ 86,400s)",
    description: "Number of calendar days since the trader's first recorded canonical fill.",
    provenanceNote: "Anchored to the earliest canonical fill timestamp in the ledger.",
  },
};

export function describeDataProvenance(performance: Pick<TraderPerformance, "isActual" | "source">): {
  badgeLabel: "ACTUAL" | "ESTIMATED";
  sourceLabel: string;
  explanation: string;
} {
  const badgeLabel = performance.isActual ? "ACTUAL" : "ESTIMATED";
  const sourceLabel = performance.source || "FILLS";
  const explanation = performance.isActual
    ? `Verified ACTUAL ledger metrics computed from canonical ${sourceLabel} records. No synthetic or self-reported ROI is permitted.`
    : `ESTIMATED metrics derived from ${sourceLabel} snapshots pending full settlement reconciliation.`;
  return { badgeLabel, sourceLabel, explanation };
}

export function formatWinRatePercent(winRate: string | null | undefined): string {
  if (!winRate) return "—";
  const n = Number(winRate);
  if (!Number.isFinite(n)) return "—";
  const pct = n <= 1 && n >= 0 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}
