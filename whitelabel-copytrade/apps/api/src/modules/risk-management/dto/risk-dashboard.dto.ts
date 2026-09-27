/**
 * Risk dashboard DTO — safe overall state/exposure/margin/leverage/drawdown/daily loss/concentration/liquidation warnings/VaR/stress/breakers/kill-switch/freshness/timestamp.
 * No secrets, no credentials, no raw balances with account numbers.
 */

export class RiskDashboardDto {
  tenantId!: string;
  asOf!: string;
  policyVersion!: string;
  overallState!: string;
  grossExposure!: string | null;
  netExposure!: string | null;
  notionalUtilizationPercent!: string | null;
  marginUtilizationPercent!: string | null;
  leverageGross!: string | null;
  leverageNet!: string | null;
  drawdownPercent!: string | null;
  drawdownAbs!: string | null;
  dailyPnl!: string | null;
  dailyLossRemainingBudget!: string | null;
  concentration!: Array<{ dimension: string; key: string; percent: string; threshold: string; isBreach: boolean }>;
  liquidationWarnings!: Array<{ symbol: string; distancePercent: string | null; isCritical: boolean; reason: string }>;
  varEstimate!: { value: string | null; percent: string | null; confidence: string; label: string; isBreach: boolean } | null;
  stressSummary!: Array<{ scenarioId: string; type: string; pnlImpact: string | null; riskLevel: string; isBreach: boolean }>;
  breakers!: Array<{ scope: string; scopeId: string; state: string; reason: string }>;
  killSwitch!: { isEngaged: boolean; scope: string | null; reason: string | null } | null;
  freshness!: { exposureAgeMs: number | null; marginAgeMs: number | null; marketDataStale: boolean; exchangeHealthStale: boolean };
  warnings!: string[];
  timestamp!: string;
  note!: string; // VaR/stress disclaimer
}

export class AccountRiskDto {
  accountId!: string;
  venue!: string;
  state!: string;
  grossExposure!: string;
  marginUtilization!: string | null;
  leverageGross!: string | null;
  drawdownPercent!: string | null;
  dailyPnl!: string | null;
  concentrationBreaches!: number;
  liquidationWarnings!: number;
  breakerOpen!: boolean;
  killSwitchEngaged!: boolean;
  timestamp!: string;
}

export class TraderRiskDto {
  traderId!: string;
  state!: string;
  grossExposure!: string;
  drawdownPercent!: string | null;
  dailyPnl!: string | null;
  followerCount!: number;
  timestamp!: string;
}
