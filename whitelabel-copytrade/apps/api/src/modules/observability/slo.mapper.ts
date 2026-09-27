/**
 * Part 10 - row-to-view mapping. Every 64-bit column crosses the wire as a
 * decimal STRING (the platform-wide BigInt rule), every ppm stays an integer,
 * and no view ever recomputes what the evaluator already decided: the row is
 * the record, the view is the window.
 */

import type {
  SloDefinitionView,
  SloEvaluationView,
  SloReadinessView,
  SloState,
  SloStatusView,
} from '@wlct/shared-types';
import { SloIndicator, SloState as SloStateEnum } from '@wlct/shared-types';
import type { Prisma } from '@prisma/client';

import { objectiveToPpm } from './slo.canonical';

type ConfigRow = Prisma.SloConfigurationVersionGetPayload<object>;
type EvaluationRow = Prisma.SloEvaluationGetPayload<object>;

export const SLO_READINESS_NOTE =
  'Error budgets measure and page. They never authorise: no number on this ' +
  'panel opens, resumes, or unlocks anything. Enforcement lives in the risk ' +
  'gate. Risk controls reduce operational risk but cannot guarantee against ' +
  'all losses.';

export function definitionView(row: ConfigRow): SloDefinitionView {
  const objective = row.objective;
  const objectivePpm = objectiveToPpm(objective);
  return {
    sloId: row.sloId,
    version: row.version,
    service: serviceForIndicator(row.indicator, row.payload),
    owner: row.owner,
    description: row.description,
    indicator: row.indicator as SloIndicator,
    objective,
    objectivePpm,
    allowedPpm: 1_000_000 - objectivePpm,
    windowMinutes: row.windowMinutes,
    shortWindowMinutes: row.shortWindowMinutes,
    goodEvent: row.goodEvent,
    badEvent: row.badEvent,
    warningBurnPpm: row.warningBurnPpm,
    criticalBurnPpm: row.criticalBurnPpm,
    maxAgeMicros: row.maxAgeMicros === null ? null : row.maxAgeMicros.toString(),
    latencyThresholdMicros:
      row.latencyThresholdMicros === null ? null : row.latencyThresholdMicros.toString(),
    enabled: row.enabled,
    checksum: row.checksum,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `service` is part of the checksummed identity, so the canonical payload
 *  is the authority for it (the column set deliberately does not duplicate
 *  what the digest already covers). */
const serviceForIndicator = (indicator: string, payload: Prisma.JsonValue): string => {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const service = (payload as Record<string, unknown>).service;
    if (typeof service === 'string' && service.length > 0) {
      return service;
    }
  }
  // A payload without a service key cannot be produced by this codebase (the
  // canonicaliser always writes one); mapping it to the indicator's owning
  // domain keeps the panel readable rather than 500-ing on legacy rows.
  return indicator;
};

export function evaluationView(row: EvaluationRow): SloEvaluationView {
  return {
    sloId: row.sloId,
    version: row.version,
    checksum: row.checksum,
    indicator: row.indicator as SloIndicator,
    service: row.service,
    state: row.state as SloState,
    evaluatedAtMicros: row.evaluatedAtMicros.toString(),
    windowMinutes: row.windowMinutes,
    shortWindowMinutes: row.shortWindowMinutes,
    targetPpm: row.targetPpm,
    actualPpm: row.actualPpm,
    budgetTotalEvents: row.budgetTotalEvents,
    budgetConsumedEvents: row.budgetConsumedEvents,
    budgetRemainingEvents: row.budgetRemainingEvents,
    remainingRatioPpm: row.remainingRatioPpm,
    longBurnPpm: row.longBurnPpm,
    shortBurnPpm: row.shortBurnPpm,
    alertKind: row.alertKind as SloEvaluationView['alertKind'],
    samplesGood: row.samplesGood,
    samplesBad: row.samplesBad,
    dataComplete: row.dataComplete,
    reason: row.reason,
  };
}

export function statusView(
  definitionRow: ConfigRow,
  latestEvaluation: EvaluationRow | null,
): SloStatusView {
  const latest = latestEvaluation === null ? null : evaluationView(latestEvaluation);
  return {
    definition: definitionView(definitionRow),
    latest,
    burnAlerting: latest !== null && latest.alertKind !== 'none',
  };
}

const SLO_STATE_ORDER: readonly SloState[] = [
  SloStateEnum.HEALTHY,
  SloStateEnum.WARNING,
  SloStateEnum.CRITICAL,
  SloStateEnum.EXHAUSTED,
  SloStateEnum.UNKNOWN,
];

export const sloStateCode = (state: SloState | string): number => {
  const index = SLO_STATE_ORDER.indexOf(state as SloState);
  return index === -1 ? SLO_STATE_ORDER.length - 1 : index;
};

/** The scorecard rollup. Aggregates over the LATEST evaluation per
 *  definition, which is exactly what "right now, per what was last
 *  measured" means on this platform; evaluations older than the current
 *  tick are the truth until a newer tick replaces them, never a guess. */
export function readinessView(
  statuses: readonly SloStatusView[],
  evaluatedAtMicros: bigint,
): SloReadinessView {
  const byState = {
    HEALTHY: 0,
    WARNING: 0,
    CRITICAL: 0,
    EXHAUSTED: 0,
    UNKNOWN: 0,
  } as Record<SloState, number>;
  let worstRemaining: number | null = null;
  let maxLongBurn: number | null = null;
  const paging: string[] = [];
  const unmeasured: string[] = [];
  for (const status of statuses) {
    const latest = status.latest;
    if (latest === null) {
      unmeasured.push(status.definition.sloId);
      byState[SloStateEnum.UNKNOWN] += 1;
      continue;
    }
    byState[latest.state] += 1;
    if (latest.state === SloStateEnum.UNKNOWN) {
      unmeasured.push(status.definition.sloId);
    }
    if (latest.remainingRatioPpm !== null) {
      worstRemaining =
        worstRemaining === null ? latest.remainingRatioPpm : Math.min(worstRemaining, latest.remainingRatioPpm);
    }
    if (latest.longBurnPpm !== null) {
      maxLongBurn = maxLongBurn === null ? latest.longBurnPpm : Math.max(maxLongBurn, latest.longBurnPpm);
    }
    const pagingState =
      latest.state === SloStateEnum.CRITICAL ||
      latest.state === SloStateEnum.EXHAUSTED ||
      status.burnAlerting;
    if (pagingState) {
      paging.push(status.definition.sloId);
    }
  }
  return {
    evaluatedAtMicros: evaluatedAtMicros.toString(),
    total: statuses.length,
    byState,
    worstRemainingRatioPpm: worstRemaining,
    maxLongBurnPpm: maxLongBurn,
    pagingSloIds: paging.sort(),
    unmeasuredSloIds: unmeasured.sort(),
    note: SLO_READINESS_NOTE,
  };
}
