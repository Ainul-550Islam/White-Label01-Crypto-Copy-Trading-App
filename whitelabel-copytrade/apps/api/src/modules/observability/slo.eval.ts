/**
 * Part 10 - error-budget arithmetic, burn-rate alerting, and the evaluation
 * tick. Pure functions; every formula is the mirror of the Python module of
 * the same name, and the parity spec replays the fixture tables
 * (docs/fixtures/reliability_fixtures.json: budgetRows, burnRows,
 * slo.evaluations) through THESE functions with bit-exact expectations.
 *
 * Floors, not rounds, everywhere; None/null means "undefined for this
 * window", never zero; completeness is a claim the INPUT makes. Same law as
 * budget.py's docstring - two languages agree because both floor positive
 * integer divisions, and nothing here ever sees a float.
 */

import { objectiveToPpm } from './slo.canonical';
import type { SloDefinition } from './slo.canonical';

const MILLION = 1_000_000;

export interface WindowCounts {
  readonly good: number;
  readonly bad: number;
}

export function validateCounts(good: number, bad: number): { total: number } {
  if (!Number.isSafeInteger(good) || !Number.isSafeInteger(bad)) {
    throw new TypeError('good/bad must be integers');
  }
  if (good < 0 || bad < 0) {
    throw new Error('good/bad counts must be non-negative');
  }
  return { total: good + bad };
}

export interface ErrorBudget {
  readonly objectivePpm: number;
  readonly allowedPpm: number;
  readonly totalEvents: number;
  readonly goodEvents: number;
  readonly badEvents: number;
  readonly failurePpm: number | null;
  readonly compliancePpm: number | null;
  readonly budgetTotalEvents: number;
  readonly budgetConsumedEvents: number;
  readonly budgetRemainingEvents: number;
  readonly remainingRatioPpm: number | null;
  readonly burnPpm: number | null;
  readonly budgetZero: boolean;
}

export function computeBudget(objective: string, counts: WindowCounts): ErrorBudget {
  const objectivePpm = objectiveToPpm(objective);
  const allowedPpm = MILLION - objectivePpm;
  const { total } = validateCounts(counts.good, counts.bad);

  if (total === 0) {
    // No events, therefore no exhaustion claim, and every derived ratio is
    // undefined rather than zero - the caller decides what UNKNOWN means.
    return {
      objectivePpm,
      allowedPpm,
      totalEvents: 0,
      goodEvents: 0,
      badEvents: 0,
      failurePpm: null,
      compliancePpm: null,
      budgetTotalEvents: 0,
      budgetConsumedEvents: 0,
      budgetRemainingEvents: 0,
      remainingRatioPpm: null,
      burnPpm: null,
      budgetZero: false,
    };
  }

  const failurePpm = Math.floor((counts.bad * MILLION) / total);
  const compliancePpm = MILLION - failurePpm;
  const budgetTotal = Math.floor((total * allowedPpm) / MILLION);
  const consumed = Math.min(counts.bad, budgetTotal);
  const remaining = Math.max(0, budgetTotal - counts.bad);
  const remainingRatio = budgetTotal > 0 ? Math.floor((remaining * MILLION) / budgetTotal) : 0;
  if (allowedPpm > 0) {
    const burnPpm = Math.floor((failurePpm * MILLION) / allowedPpm);
    // budget_zero mirrors budget.py exactly: remaining hit zero while bad
    // events PROVED the burn; an all-zero window with no failures is not
    // exhaustion, it is an empty register.
    const budgetZero = budgetTotal > 0 && remaining === 0 && counts.bad > 0;
    return {
      objectivePpm,
      allowedPpm,
      totalEvents: total,
      goodEvents: counts.good,
      badEvents: counts.bad,
      failurePpm,
      compliancePpm,
      budgetTotalEvents: budgetTotal,
      budgetConsumedEvents: consumed,
      budgetRemainingEvents: remaining,
      remainingRatioPpm: remainingRatio,
      burnPpm,
      budgetZero,
    };
  }
  // Unreachable while objective < 100 is enforced upstream (objectiveToPpm);
  // kept defined rather than absent so a future model change fails loudly
  // here instead of dividing by zero at a call site. Python's twin comment
  // is here verbatim in spirit: dead-but-defined.
  return {
    objectivePpm,
    allowedPpm,
    totalEvents: total,
    goodEvents: counts.good,
    badEvents: counts.bad,
    failurePpm,
    compliancePpm,
    budgetTotalEvents: budgetTotal,
    budgetConsumedEvents: consumed,
    budgetRemainingEvents: remaining,
    remainingRatioPpm: remainingRatio,
    burnPpm: null,
    budgetZero: true,
  };
}

// ---------------------------------------------------------------------------
// burn alerting (mirror of burn.py)
// ---------------------------------------------------------------------------

export type BurnAlertKind = 'none' | 'fast' | 'slow' | 'both';

export interface BurnAlertState {
  readonly kind: BurnAlertKind;
  readonly shortBurnPpm: number | null;
  readonly longBurnPpm: number | null;
  readonly fastThresholdPpm: number;
  readonly slowThresholdPpm: number;
}

export function evaluateBurn(input: {
  shortBurnPpm: number | null;
  longBurnPpm: number | null;
  fastMultiplierPpm: number;
  slowMultiplierPpm: number;
}): BurnAlertState {
  if (input.fastMultiplierPpm <= 0 || input.slowMultiplierPpm <= 0) {
    throw new Error('burn multipliers must be positive ppm values');
  }
  if (input.slowMultiplierPpm > input.fastMultiplierPpm) {
    throw new Error('slow multiplier must not exceed the fast multiplier');
  }
  const fast =
    input.shortBurnPpm !== null &&
    input.longBurnPpm !== null &&
    input.shortBurnPpm >= input.fastMultiplierPpm &&
    input.longBurnPpm >= input.fastMultiplierPpm;
  const slow =
    input.shortBurnPpm !== null &&
    input.longBurnPpm !== null &&
    input.shortBurnPpm >= input.slowMultiplierPpm &&
    input.longBurnPpm >= input.slowMultiplierPpm;
  const kind: BurnAlertKind = fast && slow ? 'both' : fast ? 'fast' : slow ? 'slow' : 'none';
  return {
    kind,
    shortBurnPpm: input.shortBurnPpm,
    longBurnPpm: input.longBurnPpm,
    fastThresholdPpm: input.fastMultiplierPpm,
    slowThresholdPpm: input.slowMultiplierPpm,
  };
}

// ---------------------------------------------------------------------------
// the evaluation tick (mirror of evaluate.py::evaluate_slo)
// ---------------------------------------------------------------------------

export interface SloWindowSample {
  readonly good: number;
  readonly bad: number;
  /** Completeness is a claim the collector makes, never a courtesy the
   *  evaluator assumes (defaults must be set explicitly at the call site). */
  readonly dataComplete: boolean;
  readonly note?: string | null;
}

export type SloStateValue = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED' | 'UNKNOWN';

export interface SloEvaluationRow {
  readonly sloId: string;
  readonly version: number;
  readonly checksum: string;
  readonly indicator: string;
  readonly service: string;
  readonly evaluatedAtMicros: string;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly targetPpm: number;
  readonly state: SloStateValue;
  readonly actualPpm: number | null;
  readonly budgetTotalEvents: number;
  readonly budgetConsumedEvents: number;
  readonly budgetRemainingEvents: number;
  readonly remainingRatioPpm: number | null;
  readonly longBurnPpm: number | null;
  readonly shortBurnPpm: number | null;
  readonly alertKind: BurnAlertKind;
  readonly samplesGood: number;
  readonly samplesBad: number;
  readonly dataComplete: boolean;
  readonly reason: string | null;
}

export interface EvaluateSloInput {
  definition: SloDefinition;
  checksum: string;
  longWindow: SloWindowSample;
  shortWindow: SloWindowSample;
  evaluatedAtMicros: bigint;
  fastMultiplierPpm: number;
  slowMultiplierPpm: number;
}

export function evaluateSlo(input: EvaluateSloInput): SloEvaluationRow {
  const { definition, checksum } = input;
  const targetPpm = objectiveToPpm(definition.objective);

  const longBudget = computeBudget(definition.objective, {
    good: input.longWindow.good,
    bad: input.longWindow.bad,
  });
  const shortBudget = computeBudget(definition.objective, {
    good: input.shortWindow.good,
    bad: input.shortWindow.bad,
  });

  const base = {
    sloId: definition.sloId,
    version: definition.version,
    checksum,
    indicator: definition.indicator,
    service: definition.service,
    evaluatedAtMicros: input.evaluatedAtMicros.toString(),
    windowMinutes: definition.windowMinutes,
    shortWindowMinutes: definition.shortWindowMinutes,
    targetPpm,
  };

  const complete = input.longWindow.dataComplete && input.shortWindow.dataComplete;
  if (!complete) {
    const reasons: string[] = [];
    if (!input.longWindow.dataComplete) {
      reasons.push('long-window collector incomplete');
    }
    if (!input.shortWindow.dataComplete) {
      reasons.push('short-window collector incomplete');
    }
    if (input.longWindow.note !== null && input.longWindow.note !== undefined) {
      reasons.push(`long: ${input.longWindow.note}`);
    }
    return {
      ...base,
      state: 'UNKNOWN',
      actualPpm: null,
      budgetTotalEvents: 0,
      budgetConsumedEvents: 0,
      budgetRemainingEvents: 0,
      remainingRatioPpm: null,
      longBurnPpm: null,
      shortBurnPpm: null,
      alertKind: 'none',
      samplesGood: input.longWindow.good,
      samplesBad: input.longWindow.bad,
      dataComplete: false,
      reason: reasons.join('; '),
    };
  }

  if (longBudget.totalEvents === 0) {
    return {
      ...base,
      state: 'UNKNOWN',
      actualPpm: null,
      budgetTotalEvents: 0,
      budgetConsumedEvents: 0,
      budgetRemainingEvents: 0,
      remainingRatioPpm: null,
      longBurnPpm: null,
      shortBurnPpm: null,
      alertKind: 'none',
      samplesGood: 0,
      samplesBad: 0,
      dataComplete: true,
      reason:
        'no samples in the evaluation window; absence of failures is not evidence of success',
    };
  }

  const alert = evaluateBurn({
    shortBurnPpm: shortBudget.burnPpm,
    longBurnPpm: longBudget.burnPpm,
    fastMultiplierPpm: input.fastMultiplierPpm,
    slowMultiplierPpm: input.slowMultiplierPpm,
  });

  const state = resolveState(definition, longBudget);
  return {
    ...base,
    state,
    actualPpm: longBudget.compliancePpm,
    budgetTotalEvents: longBudget.budgetTotalEvents,
    budgetConsumedEvents: longBudget.budgetConsumedEvents,
    budgetRemainingEvents: longBudget.budgetRemainingEvents,
    remainingRatioPpm: longBudget.remainingRatioPpm,
    longBurnPpm: longBudget.burnPpm,
    shortBurnPpm: shortBudget.burnPpm,
    alertKind: alert.kind,
    samplesGood: longBudget.goodEvents,
    samplesBad: longBudget.badEvents,
    dataComplete: true,
    reason: stateReason(state, longBudget, shortBudget, alert),
  };
}

/** EXHAUSTED first (remaining hit zero with proven bad events), then the
 *  definition's own burn thresholds, then HEALTHY iff evidenced. Mirror of
 *  _resolve_state - ordering included, because it is the semantics. */
export function resolveState(definition: SloDefinition, budget: ErrorBudget): SloStateValue {
  if (budget.budgetTotalEvents > 0 && budget.budgetRemainingEvents === 0 && budget.badEvents > 0) {
    return 'EXHAUSTED';
  }
  if (budget.burnPpm !== null && budget.burnPpm >= definition.criticalBurnPpm) {
    return 'CRITICAL';
  }
  if (budget.burnPpm !== null && budget.burnPpm >= definition.warningBurnPpm) {
    return 'WARNING';
  }
  if (budget.totalEvents > 0) {
    return 'HEALTHY';
  }
  return 'UNKNOWN';
}

function stateReason(
  state: SloStateValue,
  longBudget: ErrorBudget,
  shortBudget: ErrorBudget,
  alert: BurnAlertState,
): string {
  const alerting = alert.kind !== 'none';
  if (alerting) {
    return (
      `burn-rate alert (${alert.kind}): short ${String(shortBudget.burnPpm)}ppm / ` +
      `long ${String(longBudget.burnPpm)}ppm against fast ${String(alert.fastThresholdPpm)}ppm`
    );
  }
  if (state === 'EXHAUSTED') {
    return `error budget exhausted at ${String(longBudget.failurePpm)}ppm failure`;
  }
  if (state === 'CRITICAL') {
    return `burn ${String(longBudget.burnPpm)}ppm at or beyond the critical threshold`;
  }
  if (state === 'WARNING') {
    return `burn ${String(longBudget.burnPpm)}ppm at or beyond the warning threshold`;
  }
  return `compliance ${String(longBudget.compliancePpm)}ppm against target ${String(longBudget.objectivePpm)}ppm`;
}
