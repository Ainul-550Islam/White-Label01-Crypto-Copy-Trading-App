import { TRADING_GATES, type TradingGateName } from './alert.constants';

/**
 * Trading-readiness evaluation, TypeScript side. The semantics are a
 * deliberate copy of ``wlct_trading.observability.readiness`` and the jest
 * safety spec replays the shared fixture's full truth table (512 rows) plus
 * the unknown- and stale-evidence tables against this function - so the two
 * evaluators cannot drift into disagreeing verdicts, which would be the most
 * confusing possible failure for an operator reading both panels.
 *
 * The rules worth stating at the top of the code, because they are the whole
 * design in three lines:
 *   1. Missing evidence is not "satisfied by default". It is `unknown` and
 *      it BLOCKS trading.
 *   2. Fresh evidence that aged past its budget flips to blocked by
 *      arithmetic, not by anyone noticing.
 *   3. The verdict reports. The risk gate decides. Nothing in the trading
 *      path reads anything in this file.
 */

export interface GateEvidence {
  /** null/undefined encodes "no evidence" - distinct from `false`. */
  readonly value: boolean | null;
  readonly ageMicros?: number | null;
  readonly freshnessBudgetMicros?: number | null;
  readonly detail?: string | null;
}

export interface GateVerdict {
  readonly gate: TradingGateName;
  readonly satisfied: boolean;
  readonly reason: string;
}

export interface TradingReadinessVerdict {
  readonly tradingReady: boolean;
  readonly evaluatedAtMicros: string; // BigInt-as-string, platform discipline
  readonly blockingGates: readonly TradingGateName[];
  readonly gates: readonly GateVerdict[];
  readonly note: string;
}

const isStale = (evidence: GateEvidence): boolean =>
  typeof evidence.ageMicros === 'number' &&
  typeof evidence.freshnessBudgetMicros === 'number' &&
  evidence.ageMicros > evidence.freshnessBudgetMicros;

export function evaluateTradingReadiness(
  evidence: Readonly<Partial<Record<TradingGateName, GateEvidence>>>,
  nowMicros: () => string = (): string => String(BigInt(Date.now()) * 1000n),
): TradingReadinessVerdict {
  const declared = new Set<string>(TRADING_GATES);
  for (const key of Object.keys(evidence)) {
    if (!declared.has(key)) {
      throw new Error(
        `evidence for undeclared gate "${key}"; add the gate to TRADING_GATES first, in code, with a description`,
      );
    }
  }

  const gates: GateVerdict[] = [];
  let ready = true;
  for (const gate of TRADING_GATES) {
    const entry = evidence[gate];
    let satisfied: boolean;
    let reason: string;
    if (entry === undefined) {
      satisfied = false;
      reason = 'unknown (no evidence supplied)';
    } else if (entry.value === null || entry.value === undefined) {
      satisfied = false;
      reason = entry.detail ?? 'unknown (provider could not answer)';
    } else if (isStale(entry)) {
      satisfied = false;
      const ageSeconds = Math.floor((entry.ageMicros ?? 0) / 1_000_000);
      reason = `stale (last observation ${ageSeconds}s ago)`;
    } else if (entry.value) {
      satisfied = true;
      reason = entry.detail ?? 'ok';
    } else {
      satisfied = false;
      reason = entry.detail ?? 'reported false';
    }
    gates.push({ gate, satisfied, reason });
    if (!satisfied) {
      ready = false;
    }
  }

  return {
    tradingReady: ready,
    evaluatedAtMicros: nowMicros(),
    blockingGates: gates.filter((g) => !g.satisfied).map((g) => g.gate),
    gates,
    note:
      'This verdict is an operational signal derived from trading-plane evidence. ' +
      'Enforcement of trading safety is the risk gate\'s job and lives elsewhere; ' +
      'a stale or missing mirror here never authorises a send, exactly as it never blocks one.',
  };
}
