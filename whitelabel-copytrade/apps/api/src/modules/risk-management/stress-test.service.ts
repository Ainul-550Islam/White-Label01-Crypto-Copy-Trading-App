import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { StressTestResult, StressScenario, RiskState, RiskSeverity, StressScenarioType, PortfolioExposure, SymbolExposure } from './risk-management.types';

/**
 * Deterministic stress testing against canonical portfolio snapshots.
 * - Never mutates live state.
 * - Scenarios: market shock, gap, vol expansion, spread, exchange outage, slippage, liquidity, correlated shock.
 * - Each scenario explicitly configured, structured params, no executable.
 * - Output: scenario, shocked assumptions, estimated PnL/exposure/margin impact, risk level.
 * - Labeled as control signal, not prediction.
 */

function isValidDecimal(v: any): v is string {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
}
const SCALE = 1_000_000_000_000n;
function parseScaled(s: string): bigint {
  const neg = s.startsWith('-');
  const clean = neg ? s.slice(1) : s;
  const [intP = '0', fracP = ''] = clean.split('.');
  const frac = (fracP + '0'.repeat(12)).slice(0, 12);
  const val = BigInt(intP) * SCALE + BigInt(frac || '0');
  return neg ? -val : val;
}
function formatScaled(b: bigint): string {
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const intP = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(12, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (fracStr ? `${intP}.${fracStr}` : `${intP}`);
}
function mul(a: string, b: string): string {
  return formatScaled((parseScaled(a) * parseScaled(b)) / SCALE);
}
function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

const DEFAULT_SCENARIOS: StressScenario[] = [
  {
    scenarioId: 'MARKET_SHOCK_10_PCT',
    type: 'MARKET_SHOCK',
    name: 'Market Shock -10%',
    description: 'Uniform -10% price shock across all symbols',
    parameters: { shockPercent: '-10', uniform: 'true' },
    shockedAssets: [],
  },
  {
    scenarioId: 'MARKET_SHOCK_20_PCT',
    type: 'MARKET_SHOCK',
    name: 'Market Shock -20%',
    description: 'Uniform -20% price shock across all symbols',
    parameters: { shockPercent: '-20', uniform: 'true' },
    shockedAssets: [],
  },
  {
    scenarioId: 'GAP_MOVE_15_PCT',
    type: 'GAP_MOVE',
    name: 'Gap Move -15%',
    description: 'Instant gap move -15% without intermediate fills',
    parameters: { gapPercent: '-15', instant: 'true' },
    shockedAssets: [],
  },
  {
    scenarioId: 'VOL_EXPANSION_2X',
    type: 'VOL_EXPANSION',
    name: 'Volatility Expansion 2x',
    description: 'Volatility doubles, margin requirements increase 50%',
    parameters: { volMultiplier: '2', marginIncreasePercent: '50' },
    shockedAssets: [],
  },
  {
    scenarioId: 'SPREAD_WIDENING_5X',
    type: 'SPREAD_WIDENING',
    name: 'Spread Widening 5x',
    description: 'Bid-ask spread widens 5x, slippage increases',
    parameters: { spreadMultiplier: '5', slippageBpsIncrease: '100' },
    shockedAssets: [],
  },
  {
    scenarioId: 'EXCHANGE_OUTAGE_BINANCE',
    type: 'EXCHANGE_OUTAGE',
    name: 'Exchange Outage — Binance',
    description: 'Binance venue unavailable, positions cannot be closed',
    parameters: { venue: 'BINANCE', outageDurationMinutes: '60' },
    shockedAssets: [],
  },
  {
    scenarioId: 'SLIPPAGE_EXPANSION_100BPS',
    type: 'SLIPPAGE_EXPANSION',
    name: 'Slippage Expansion +100bps',
    description: 'Slippage increases by 100 bps on all executions',
    parameters: { slippageBpsIncrease: '100' },
    shockedAssets: [],
  },
  {
    scenarioId: 'LIQUIDITY_REDUCTION_50_PCT',
    type: 'LIQUIDITY_REDUCTION',
    name: 'Liquidity Reduction -50%',
    description: 'Available liquidity reduced by 50%, market impact doubles',
    // baseMarketImpactBps is the assumed normal-market cost of liquidating the
    // book; the scenario multiplies it. Stated here, not buried in the math.
    parameters: { liquidityReductionPercent: '50', marketImpactMultiplier: '2', baseMarketImpactBps: '25' },
    shockedAssets: [],
  },
  {
    scenarioId: 'CORRELATED_SHOCK_BTC_ETH',
    type: 'CORRELATED_SHOCK',
    name: 'Correlated Shock BTC/ETH -15%',
    description: 'BTC and ETH correlated -15% shock',
    parameters: { shockPercent: '-15', correlation: '0.9' },
    shockedAssets: ['BTC-USDT', 'ETH-USDT'],
  },
];

@Injectable()
export class StressTestService {
  private readonly logger = new Logger(StressTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
    private readonly exposureService: PortfolioExposureService,
  ) {}

  async runStressTests(params: {
    tenantId: string;
    accountId?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
    scenarios?: StressScenario[];
  }): Promise<StressTestResult[]> {
    const { tenantId, accountId, traderId, strategyId, followerId, scenarios } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const exposure = await this.exposureService.calculateExposure({
      tenantId,
      accountId,
      traderId,
      strategyId,
      followerId,
    });

    const effectiveScenarios = scenarios && scenarios.length > 0 ? scenarios : DEFAULT_SCENARIOS;
    const nowIso = new Date().toISOString();
    const results: StressTestResult[] = [];

    // Gross exposure for scaling
    const grossNotional = exposure.grossExposure;
    // Equity of the evaluated scope (balances + unrealised PnL), the base
    // every margin-impact percentage is expressed against. Null when there
    // are no balances to measure - margin impact is then unknown, not zero.
    const equity = await this.computeEquity(tenantId, accountId);

    for (const scenario of effectiveScenarios) {
      // Validate scenario params — structured only, no executable
      const paramStr = JSON.stringify(scenario.parameters);
      if (/__proto__|constructor|process|require|eval|function/.test(paramStr)) {
        this.logger.warn(`Scenario ${scenario.scenarioId} contains disallowed pattern, skipping`);
        continue;
      }

      let riskLevel = RiskState.NORMAL;
      let isBreach = false;
      const threshold = policy.thresholds.stressLossThreshold ?? null;

      // Deterministic shock calculations based on scenario type, using canonical exposure
      const impact = computeScenarioImpact(scenario, exposure, equity);
      const estimatedPnlImpact = impact.pnl;
      const estimatedExposureImpact = impact.exposure;
      const estimatedMarginImpact = impact.margin;
      if (impact.elevate) riskLevel = RiskState.HIGH;

      // Determine breach against stress loss threshold. Only a LOSS can
      // breach; a stressed gain larger than the threshold is not a risk.
      const pnlScaled = estimatedPnlImpact !== null && isValidDecimal(estimatedPnlImpact) ? parseScaled(estimatedPnlImpact) : null;
      if (pnlScaled !== null && pnlScaled < 0n && threshold && isValidDecimal(threshold)) {
        if (-pnlScaled > parseScaled(threshold)) {
          isBreach = true;
          riskLevel = raiseRisk(riskLevel, RiskState.HIGH);
        }
      }

      // An exchange outage elevates risk whenever exposure is trapped on the
      // venue (impact.elevate, applied above); a venue holding nothing is not a risk.

      // Loss size relative to gross exposure raises (never lowers) the level.
      if (pnlScaled !== null && pnlScaled < 0n && isValidDecimal(grossNotional) && parseScaled(grossNotional) > 0n) {
        const lossPct = (-pnlScaled * 100n * SCALE) / parseScaled(grossNotional);
        if (lossPct > 20n * SCALE) riskLevel = raiseRisk(riskLevel, RiskState.CRITICAL);
        else if (lossPct > 10n * SCALE) riskLevel = raiseRisk(riskLevel, RiskState.HIGH);
        else if (lossPct > 5n * SCALE) riskLevel = raiseRisk(riskLevel, RiskState.ELEVATED);
      }

      // A loss scenario whose PnL could not be estimated (missing parameter or
      // price data) is UNKNOWN, never reported as NORMAL.
      if (estimatedPnlImpact === null && scenario.type !== 'EXCHANGE_OUTAGE' && riskLevel === RiskState.NORMAL) {
        riskLevel = RiskState.UNKNOWN;
      }

      results.push({
        tenantId,
        scenario,
        asOf: nowIso,
        policyVersion: policy.effectiveVersion,
        shockedAssumptions: scenario.parameters,
        estimatedPnlImpact,
        estimatedExposureImpact,
        estimatedMarginImpact,
        riskLevel,
        isBreach,
        threshold,
        ruleId: 'STRESS_LOSS_LIMIT',
        reason: `Stress scenario ${scenario.scenarioId} (${scenario.type}) estimated PnL impact ${estimatedPnlImpact ?? 'unknown'} — RISK_ESTIMATE, not prediction`,
        severity: isBreach ? RiskSeverity.WARNING : RiskSeverity.INFO,
        note: 'Stress test is a control signal and analytics estimate, not a guaranteed future loss or prediction. Do not use as investment advice.',
      });
    }

    return results;
  }

  /** Wallet balances plus unrealised PnL for the scope, or null when no balance rows exist. */
  private async computeEquity(tenantId: string, accountId?: string): Promise<bigint | null> {
    const balances = await this.prisma.accountBalanceSnapshot.findMany({ where: { tenantId, ...(accountId ? { accountId } : {}) } });
    if (balances.length === 0) return null;
    const positions = await this.prisma.position.findMany({ where: { tenantId, ...(accountId ? { accountId } : {}) } });
    let total = 0n;
    for (const b of balances) {
      const v = b.total?.toString();
      if (isValidDecimal(v)) total += parseScaled(v);
    }
    for (const p of positions) {
      const v = p.unrealisedPnl?.toString();
      if (v && isValidDecimal(v)) total += parseScaled(v);
    }
    return total;
  }
}

const RISK_RANK: Record<string, number> = {
  [RiskState.NORMAL]: 0,
  [RiskState.WATCH]: 1,
  [RiskState.UNKNOWN]: 1,
  [RiskState.STALE]: 1,
  [RiskState.ELEVATED]: 2,
  [RiskState.HIGH]: 3,
  [RiskState.CRITICAL]: 4,
  [RiskState.BLOCKED]: 5,
};

function raiseRisk(current: RiskState, candidate: RiskState): RiskState {
  return (RISK_RANK[candidate] ?? 0) > (RISK_RANK[current] ?? 0) ? candidate : current;
}

export interface ScenarioImpact {
  pnl: string | null;
  exposure: string | null;
  margin: string | null;
  /** Scenario-specific reason to raise the risk level regardless of PnL. */
  elevate: boolean;
}

/** Share of equity a loss would consume, in percent; null when equity is unknown or not positive. */
function lossAsPercentOfEquity(pnlScaled: bigint, equity: bigint | null): string | null {
  if (equity === null || equity <= 0n) return null;
  if (pnlScaled >= 0n) return '0';
  return formatScaled((-pnlScaled * 100n * SCALE) / equity);
}

function symbolInScope(sym: SymbolExposure, shocked: string[]): boolean {
  if (!shocked || shocked.length === 0) return true;
  const wanted = shocked.map((s) => s.toUpperCase());
  const symbol = sym.symbol.toUpperCase();
  const compact = symbol.replace(/[-/]/g, '');
  return wanted.some((w) => w === symbol || w.replace(/[-/]/g, '') === compact || (sym.baseAsset !== null && w === sym.baseAsset.toUpperCase()));
}

/**
 * Pure, deterministic scenario model over a canonical exposure snapshot.
 *
 * - Directional scenarios (MARKET_SHOCK, GAP_MOVE, CORRELATED_SHOCK) move the
 *   price of every in-scope symbol by the shock and revalue the SIGNED net
 *   position: longs lose on a down move, shorts gain. Linear instruments are
 *   assumed (spot / linear perpetuals); `shockedAssets` limits the shock to
 *   the listed symbols or base assets, empty means all.
 * - Cost scenarios (SPREAD_WIDENING, SLIPPAGE_EXPANSION, LIQUIDITY_REDUCTION)
 *   price the cost of liquidating the whole gross book under the stated
 *   parameters. A missing parameter makes the estimate null (unknown).
 * - VOL_EXPANSION raises margin, not PnL. The added margin needs the book's
 *   current initial-margin rate (`initialMarginRatePercent`); the platform
 *   holds no per-position leverage, so without it the impact is null.
 * - EXCHANGE_OUTAGE traps the named venue's gross exposure: PnL is not
 *   estimated, the exposure impact is the trapped notional.
 *
 * Margin impact for loss scenarios = share of equity the loss consumes.
 */
export function computeScenarioImpact(scenario: StressScenario, exposure: PortfolioExposure, equity: bigint | null): ScenarioImpact {
  const params = scenario.parameters ?? {};
  const grossNotional = exposure.grossExposure;
  if (!isValidDecimal(grossNotional) || parseScaled(grossNotional) === 0n) {
    return { pnl: '0', exposure: '0', margin: equity === null ? null : '0', elevate: false };
  }
  const grossScaled = parseScaled(grossNotional);

  switch (scenario.type) {
    case 'MARKET_SHOCK':
    case 'GAP_MOVE':
    case 'CORRELATED_SHOCK': {
      const shockPct = scenario.type === 'GAP_MOVE' ? params.gapPercent : params.shockPercent;
      if (!isValidDecimal(shockPct)) return { pnl: null, exposure: null, margin: null, elevate: false };
      const shock = parseScaled(shockPct);
      let pnl = 0n;
      let shockedGross = 0n;
      let affectedGross = 0n;
      for (const sym of exposure.symbolExposures ?? []) {
        if (!symbolInScope(sym, scenario.shockedAssets)) continue;
        if (!isValidDecimal(sym.netNotional) || !isValidDecimal(sym.grossNotional)) continue;
        const net = parseScaled(sym.netNotional);
        const gross = parseScaled(sym.grossNotional);
        pnl += (net * shock) / (100n * SCALE);
        affectedGross += gross;
        shockedGross += gross + (gross * shock) / (100n * SCALE);
      }
      if (exposure.symbolExposures === undefined || exposure.symbolExposures.length === 0) {
        // No per-symbol breakdown: revalue the net book as one position.
        if (!isValidDecimal(exposure.netExposure)) return { pnl: null, exposure: null, margin: null, elevate: false };
        pnl = (parseScaled(exposure.netExposure) * shock) / (100n * SCALE);
        affectedGross = grossScaled;
        shockedGross = grossScaled + (grossScaled * shock) / (100n * SCALE);
      }
      const exposureAfter = grossScaled - affectedGross + shockedGross;
      return { pnl: formatScaled(pnl), exposure: formatScaled(exposureAfter), margin: lossAsPercentOfEquity(pnl, equity), elevate: false };
    }
    case 'SPREAD_WIDENING':
    case 'SLIPPAGE_EXPANSION': {
      const bps = params.slippageBpsIncrease;
      if (!isValidDecimal(bps)) return { pnl: null, exposure: grossNotional, margin: null, elevate: false };
      const cost = (grossScaled * parseScaled(bps)) / (10_000n * SCALE);
      return { pnl: formatScaled(-cost), exposure: grossNotional, margin: lossAsPercentOfEquity(-cost, equity), elevate: false };
    }
    case 'LIQUIDITY_REDUCTION': {
      const baseBps = params.baseMarketImpactBps;
      const multiplier = params.marketImpactMultiplier;
      if (!isValidDecimal(baseBps) || !isValidDecimal(multiplier)) return { pnl: null, exposure: grossNotional, margin: null, elevate: false };
      const cost = (((grossScaled * parseScaled(baseBps)) / (10_000n * SCALE)) * parseScaled(multiplier)) / SCALE;
      return { pnl: formatScaled(-cost), exposure: grossNotional, margin: lossAsPercentOfEquity(-cost, equity), elevate: false };
    }
    case 'VOL_EXPANSION': {
      const increase = params.marginIncreasePercent;
      const imRate = params.initialMarginRatePercent;
      if (!isValidDecimal(increase) || !isValidDecimal(imRate) || equity === null || equity <= 0n) {
        return { pnl: '0', exposure: grossNotional, margin: null, elevate: false };
      }
      const currentMargin = (grossScaled * parseScaled(imRate)) / (100n * SCALE);
      const extraMargin = (currentMargin * parseScaled(increase)) / (100n * SCALE);
      return { pnl: '0', exposure: grossNotional, margin: formatScaled((extraMargin * 100n * SCALE) / equity), elevate: false };
    }
    case 'EXCHANGE_OUTAGE': {
      const venue = String(params.venue ?? '').toUpperCase();
      const venueRow = (exposure.venueExposures ?? []).find((v) => v.venue.toUpperCase() === venue);
      const trapped = venueRow && isValidDecimal(venueRow.grossNotional) ? venueRow.grossNotional : venue ? '0' : grossNotional;
      return { pnl: null, exposure: trapped, margin: null, elevate: parseScaled(trapped) > 0n };
    }
    default:
      return { pnl: null, exposure: grossNotional, margin: null, elevate: false };
  }
}
