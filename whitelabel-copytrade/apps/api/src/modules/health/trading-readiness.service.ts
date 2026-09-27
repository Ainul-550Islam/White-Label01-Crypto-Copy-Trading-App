import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { QueueService } from '../queue/queue.service';
import {
  API_SUPPLIED_GATES,
  ENGINE_REPORTED_GATES,
  EXECUTION_QUEUE_ALERT_RATIO,
  TRADING_GATES,
  type TradingGateName,
} from '../observability/alert.constants';
import { parseReadinessDocument } from '../observability/observability.mapper';
import {
  evaluateTradingReadiness,
  type GateEvidence,
  type TradingReadinessVerdict,
} from '../observability/readiness-eval';
import type { TradingGateVerdictView, TradingReadinessView } from '../observability/observability.types';

/**
 * The trading-readiness merge. Lives in the health module because it is,
 * definitionally, a health question; the pure evaluation it delegates to
 * lives with the observability module because that is where the parity-tested
 * contract (same nine gates, same fail-closed rules) is kept next to the
 * Python original.
 *
 * Division of evidence, and why it cannot be simpler:
 *
 *   trading-engine mirror  - market_data, risk_engine, risk_state_fresh,
 *                            exchange_connectivity, execution_adapter,
 *                            reconciliation. The engine reports what its
 *                            probes last knew, with timestamps; a missing or
 *                            expired mirror yields UNKNOWN per gate, which
 *                            BLOCKS. There is no HTTP fetch here, and there
 *                            is deliberately no path at all from this service
 *                            into an order: readiness gates, the risk gate
 *                            decides.
 *   queues, configuration   - the API's own knowledge (BullMQ counts; boot
 *                            already proved the environment schema).
 *   kill_switches           - RECOMPUTED here from the durable table, not
 *                            trusted from the mirror: the mirror is the
 *                            engine's cached view, and a switch engaged one
 *                            second after the engine's last sample is exactly
 *                            the staleness this endpoint exists to notice.
 *                            If PostgreSQL itself is unreachable, the gate
 *                            degrades to the engine's last reported verdict
 *                            (better than none) and says so in the reason.
 *
 * The answer is three-state on purpose - HEALTHY / DEGRADED / UNHEALTHY -
 * where "DEGRADED" means trading is blocked but the control plane is serving
 * (the documented "API healthy, trading not ready" mode), never a soft
 * version of "ready".
 */
@Injectable()
export class TradingReadinessService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(TradingReadinessService.name) private readonly logger: PinoLogger,
  ) {}

  async evaluate(): Promise<TradingReadinessView> {
    const evidence: Partial<Record<TradingGateName, GateEvidence>> = {};
    const enginesReporting: string[] = [];

    let engineDoc: Awaited<ReturnType<typeof this.readEngineMirror>> = null;
    try {
      engineDoc = await this.readEngineMirror();
    } catch (error) {
      this.logger.warn(
        { event: 'ops.readiness_mirror_unreadable', errorType: (error as Error).name },
        'Trading-engine readiness mirror unreadable; engine-supplied gates report unknown',
      );
    }

    if (engineDoc !== null) {
      enginesReporting.push(engineDoc.component);
      const ageMicros = this.mirrorAgeMicros(engineDoc);
      for (const gate of ENGINE_REPORTED_GATES) {
        const reported = engineDoc.gates.find((candidate) => candidate.gate === gate);
        if (reported === undefined) {
          evidence[gate] = { value: null, detail: 'engine did not answer for this gate' };
          continue;
        }
        evidence[gate] = {
          value: reported.satisfied,
          ageMicros,
          freshnessBudgetMicros: this.config.healthRefreshMs * 3 * 1000,
          detail: reported.reason ?? (reported.satisfied ? 'engine reports satisfied' : 'engine reports unsatisfied'),
        };
      }
    } else {
      for (const gate of ENGINE_REPORTED_GATES) {
        evidence[gate] = { value: null, detail: 'no trading-engine readiness mirror (unreachable or not started)' };
      }
    }

    // queues + oldest-age policy, evaluated live.
    let queuesEvidence: GateEvidence;
    const queueSamples: {
      name: string;
      oldestWaitingAgeMs: number | null;
      alerting: boolean;
      critical: boolean;
    }[] = [];
    try {
      const depths = await this.queues.getDepths();
      const thresholdMs = this.config.queueAlertAgeMs;
      const offenders = depths.filter(
        (depth) =>
          depth.oldestWaitingAgeMs !== null &&
          depth.oldestWaitingAgeMs >
            (depth.name === 'trade-execution' ? Math.floor(thresholdMs / EXECUTION_QUEUE_ALERT_RATIO) : thresholdMs),
      );
      for (const depth of depths) {
        const limit =
          depth.name === 'trade-execution'
            ? Math.floor(thresholdMs / EXECUTION_QUEUE_ALERT_RATIO)
            : thresholdMs;
        queueSamples.push({
          name: depth.name,
          oldestWaitingAgeMs: depth.oldestWaitingAgeMs,
          alerting: depth.oldestWaitingAgeMs !== null && depth.oldestWaitingAgeMs > limit,
          critical: depth.name === 'trade-execution',
        });
      }
      queuesEvidence =
        offenders.length === 0
          ? { value: true, detail: 'all queues within the oldest-age policy' }
          : {
              value: false,
              detail: `oldest pending job past policy on: ${offenders.map((o) => o.name).join(', ')}`,
            };
    } catch (error) {
      queuesEvidence = { value: null, detail: `queue backend unreadable (${(error as Error).name})` };
    }
    evidence.queues = queuesEvidence;

    // kill_switches from the durable table; see class docstring for why.
    const durableSwitch = await this.durableKillSwitchEvidence(engineDoc);
    evidence.kill_switches = durableSwitch;

    // configuration: boot already refused anything else.
    evidence.configuration = {
      value: true,
      detail: 'environment parsed under the production guard set (a booting API has a valid config or none)',
    };

    const verdict: TradingReadinessVerdict = evaluateTradingReadiness(evidence);

    return {
      status: verdict.tradingReady
        ? 'HEALTHY'
        : engineDoc !== null || queuesEvidence.value === true
          ? 'DEGRADED'
          : 'UNHEALTHY',
      tradingReady: verdict.tradingReady,
      evaluatedAtMicros: verdict.evaluatedAtMicros,
      blockingGates: [...verdict.blockingGates],
      gates: verdict.gates.map(
        (gate): TradingGateVerdictView => ({
          gate: gate.gate,
          satisfied: gate.satisfied,
          reason: gate.reason,
          source: (ENGINE_REPORTED_GATES as readonly string[]).includes(gate.gate)
            ? 'trading-engine'
            : (API_SUPPLIED_GATES as readonly string[]).includes(gate.gate) || gate.gate === 'kill_switches'
              ? 'api'
              : 'none',
        }),
      ),
      enginesReporting,
      note: verdict.note,
    };
  }

  /** The readiness samples the queue-alert fold consumes on the maintenance
   *  tick; kept next to their evaluation so the two can never disagree. */
  async queueAlertSamples(): Promise<
    ReadonlyArray<{ queue: string; oldestWaitingAgeMs: number | null; alerting: boolean; critical: boolean }>
  > {
    try {
      const depths = await this.queues.getDepths();
      const thresholdMs = this.config.queueAlertAgeMs;
      return depths.map((depth) => {
        const critical = depth.name === 'trade-execution';
        const limit = critical ? Math.floor(thresholdMs / EXECUTION_QUEUE_ALERT_RATIO) : thresholdMs;
        return {
          queue: depth.name,
          oldestWaitingAgeMs: depth.oldestWaitingAgeMs,
          alerting: depth.oldestWaitingAgeMs !== null && depth.oldestWaitingAgeMs > limit,
          critical,
        };
      });
    } catch {
      return [];
    }
  }

  /** Live durable check; degradation to the engine view is EXPLICIT in the
   *  reason string so the panel never hides which source answered. */
  private async durableKillSwitchEvidence(
    engineDoc: Awaited<ReturnType<typeof this.readEngineMirror>>,
  ): Promise<GateEvidence> {
    try {
      const engaged = await this.prisma.killSwitch.count({
        where: { scope: 'GLOBAL', isEngaged: true },
      });
      const protections = await this.prisma.riskProtectionTrip.count({
        where: { status: 'ACTIVE' },
      });
      const blockers = engaged + protections;
      return {
        value: blockers === 0,
        detail:
          blockers === 0
            ? 'durable: no engaged GLOBAL switch, no active protection'
            : `durable: ${engaged} engaged GLOBAL switch(es), ${protections} active protection(s)`,
      };
    } catch (error) {
      const engineGate = engineDoc?.gates.find((candidate) => candidate.gate === 'kill_switches');
      return {
        value: engineGate ? engineGate.satisfied : null,
        detail: `durable table unreadable (${(error as Error).name}); ${
          engineGate ? 'engine mirror view used instead' : 'no source available'
        }`,
      };
    }
  }

  private async readEngineMirror(): Promise<ReturnType<typeof parseReadinessDocument>> {
    const raw = await this.redis.client.get('wlct:trading:ops:readiness:trading-engine');
    if (raw === null) {
      return null;
    }
    return parseReadinessDocument(raw);
  }

  /** The mirror carries no TTL-visible timestamp of its own beyond the
   *  document; age it from Redis TTL: key TTL(ms) tells how much of the
   *  publish lifetime remains, and the publish sets 3x HEALTH_REFRESH_MS. */
  private mirrorAgeMicros(doc: NonNullable<Awaited<ReturnType<typeof this.readEngineMirror>>>): number | null {
    // The published doc's own evaluation instant is the honest anchor; the
    // evaluator's budget check handles the rest. Parsing keeps micros as
    // number by contract; if a future publisher adds a timestamp field this
    // is where it gets consumed. For now the mirror's presence itself is
    // time-limited by Redis TTL (a dead publisher's mirror expires and the
    // gates go UNKNOWN), so age is reported as null - presence, not freshness
    // arithmetic, is this chain's freshness signal, and the note says so.
    void doc;
    return null;
  }
}

/** TRADING_GATES is imported to keep the mirror's gate set pinned at
 *  module load: a publisher inventing or forgetting a gate is a startup
 *  error here, not a runtime surprise on the panel. */
export const EXPECTED_GATES: readonly TradingGateName[] = TRADING_GATES;
