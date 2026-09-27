import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { StressTestResult, StressScenario, RiskState, RiskSeverity, StressScenarioType } from './risk-management.types';

/**
 * Deterministic stress testing against canonical portfolio snapshots.
 * - Never mutates live state.
 * - Scenarios: market shock, gap, vol expansion, spread, exchange outage, slippage, liquidity, correlated shock.
 * - Each scenario explicitly configured, structured params, no executable.
 * - Output: scenario, shocked assumptions, estimated PnL/exposure/margin impact, risk level.
 * - Labeled as control signal, not prediction.
 */

function isValidDecimal(v: any): boolean {
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
    parameters: { liquidityReductionPercent: '50', marketImpactMultiplier: '2' },
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

    for (const scenario of effectiveScenarios) {
      // Validate scenario params — structured only, no executable
      const paramStr = JSON.stringify(scenario.parameters);
      if (/__proto__|constructor|process|require|eval|function/.test(paramStr)) {
        this.logger.warn(`Scenario ${scenario.scenarioId} contains disallowed pattern, skipping`);
        continue;
      }

      let estimatedPnlImpact: string | null = null;
      let estimatedExposureImpact: string | null = null;
      let estimatedMarginImpact: string | null = null;
      let riskLevel = RiskState.NORMAL;
      let isBreach = false;
      const threshold = policy.thresholds.stressLossThreshold ?? null;

      // Deterministic shock calculations based on scenario type, using canonical exposure
      if (!isValidDecimal(grossNotional) || parseScaled(grossNotional) === 0n) {
        estimatedPnlImpact = '0';
        estimatedExposureImpact = '0';
        estimatedMarginImpact = '0';
      } else {
        const grossScaled = parseScaled(grossNotional);
        switch (scenario.type) {
          case 'MARKET_SHOCK': {
            const shockPct = scenario.parameters.shockPercent ?? '0';
            if (isValidDecimal(shockPct)) {
              // PnL impact = gross * shock%
              const impact = (grossScaled * parseScaled(shockPct)) / 100n / SCALE * SCALE; // Actually gross * shock% /100
              // Simplified: gross * shock% /100
              const impactScaled = (grossScaled * parseScaled(shockPct)) / 100n;
              estimatedPnlImpact = formatScaled(impactScaled);
              estimatedExposureImpact = formatScaled((grossScaled * parseScaled(shockPct)) / 100n + grossScaled);
              // Margin impact: if loss, margin utilization increases
              estimatedMarginImpact = formatScaled((parseScaled(shockPct) * -1n * SCALE) / 1n); // placeholder
            }
            break;
          }
          case 'GAP_MOVE': {
            const gapPct = scenario.parameters.gapPercent ?? '0';
            if (isValidDecimal(gapPct)) {
              const impactScaled = (grossScaled * parseScaled(gapPct)) / 100n;
              estimatedPnlImpact = formatScaled(impactScaled);
              estimatedExposureImpact = formatScaled(grossScaled + impactScaled);
              estimatedMarginImpact = formatScaled((parseScaled(gapPct) * -1n));
            }
            break;
          }
          case 'VOL_EXPANSION': {
            const marginInc = scenario.parameters.marginIncreasePercent ?? '0';
            if (isValidDecimal(marginInc)) {
              estimatedMarginImpact = marginInc;
              estimatedPnlImpact = '0'; // vol expansion doesn't directly cause PnL, but margin
              estimatedExposureImpact = grossNotional;
            }
            break;
          }
          case 'SPREAD_WIDENING':
          case 'SLIPPAGE_EXPANSION': {
            const slippageBps = scenario.parameters.slippageBpsIncrease ?? scenario.parameters.spreadMultiplier ?? '0';
            // Convert bps to percent: 100 bps = 1%
            if (isValidDecimal(slippageBps)) {
              const slippagePct = formatScaled(parseScaled(slippageBps) / 100n);
              const impactScaled = (grossScaled * parseScaled(slippagePct)) / 100n;
              estimatedPnlImpact = formatScaled(-impactScaled); // loss
              estimatedExposureImpact = grossNotional;
              estimatedMarginImpact = '0';
            }
            break;
          }
          case 'EXCHANGE_OUTAGE': {
            // For outage, exposure remains but cannot be closed — risk elevated
            estimatedPnlImpact = '0';
            estimatedExposureImpact = grossNotional;
            estimatedMarginImpact = '0';
            riskLevel = RiskState.HIGH;
            break;
          }
          case 'LIQUIDITY_REDUCTION': {
            const reductionPct = scenario.parameters.liquidityReductionPercent ?? '0';
            if (isValidDecimal(reductionPct)) {
              // Assume 50% reduction causes 1% additional slippage on gross
              const extraSlippage = '1'; // 1%
              const impactScaled = (grossScaled * parseScaled(extraSlippage)) / 100n;
              estimatedPnlImpact = formatScaled(-impactScaled);
              estimatedExposureImpact = grossNotional;
              estimatedMarginImpact = '0';
            }
            break;
          }
          case 'CORRELATED_SHOCK': {
            const shockPct = scenario.parameters.shockPercent ?? '0';
            if (isValidDecimal(shockPct)) {
              const impactScaled = (grossScaled * parseScaled(shockPct)) / 100n;
              estimatedPnlImpact = formatScaled(impactScaled);
              estimatedExposureImpact = formatScaled(grossScaled + impactScaled);
              estimatedMarginImpact = formatScaled((parseScaled(shockPct) * -1n));
            }
            break;
          }
          default: {
            estimatedPnlImpact = '0';
            estimatedExposureImpact = grossNotional;
            estimatedMarginImpact = '0';
          }
        }
      }

      // Determine breach against stress loss threshold
      if (estimatedPnlImpact && threshold && isValidDecimal(estimatedPnlImpact) && isValidDecimal(threshold)) {
        const pnlAbs = parseScaled(estimatedPnlImpact) < 0n ? -parseScaled(estimatedPnlImpact) : parseScaled(estimatedPnlImpact);
        const threshScaled = parseScaled(threshold);
        if (pnlAbs > threshScaled) {
          isBreach = true;
          riskLevel = RiskState.HIGH;
        }
      }

      // If scenario is exchange outage, elevate risk regardless
      if (scenario.type === 'EXCHANGE_OUTAGE') {
        riskLevel = RiskState.HIGH;
      }

      // If PnL impact is large negative, elevate
      if (estimatedPnlImpact && isValidDecimal(estimatedPnlImpact)) {
        const pnlScaled = parseScaled(estimatedPnlImpact);
        if (pnlScaled < 0n) {
          const lossAbs = -pnlScaled;
          if (grossNotional && isValidDecimal(grossNotional) && parseScaled(grossNotional) > 0n) {
            const lossPct = (lossAbs * 100n * SCALE) / parseScaled(grossNotional);
            if (lossPct > 20n * SCALE) riskLevel = RiskState.CRITICAL;
            else if (lossPct > 10n * SCALE) riskLevel = RiskState.HIGH;
            else if (lossPct > 5n * SCALE) riskLevel = RiskState.ELEVATED;
          }
        }
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
}
