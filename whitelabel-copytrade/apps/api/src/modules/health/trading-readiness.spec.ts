import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { RedisService } from '../../infrastructure/redis/redis.service';
import type { QueueService, QueueDepth } from '../queue/queue.service';
import type { PinoLogger } from 'nestjs-pino';

import { TradingReadinessService } from './trading-readiness.service';

/**
 * The trading-readiness merge, pinned. The two properties worth more than
 * the rest:
 *
 * 1. FAIL-CLOSED. Every way evidence can be missing - no mirror, expired
 *    mirror, unreadable queue backend, unreachable Postgres with no engine
 *    fallback - must produce NOT ready. There is no combination of
 *    outages that yields a false "ready".
 *
 * 2. INDEPENDENCE FROM API READINESS. The engine mirror answering is
 *    neither required for these routes to be up nor sufficient for
 *    trading: readiness reads the trading plane; the trading plane never
 *    reads readiness back.
 */

const ENGINE_GATES = [
  'market_data',
  'risk_engine',
  'risk_state_fresh',
  'exchange_connectivity',
  'execution_adapter',
  'reconciliation',
  'kill_switches',
] as const;

function engineMirrorDocument(overrides: Partial<Record<string, boolean>> = {}): string {
  return JSON.stringify({
    component: 'trading-engine',
    gatesSatisfied: Object.values(overrides).every((value) => value !== false),
    gates: ENGINE_GATES.map((gate) => ({
      gate,
      satisfied: overrides[gate] ?? true,
      critical: true,
      reason: (overrides[gate] ?? true) ? null : `${gate} reported false`,
    })),
    note: 'engine view',
  });
}

const depth = (name: string, oldestWaitingAgeMs: number | null): QueueDepth => ({
  name: name as QueueDepth['name'],
  waiting: oldestWaitingAgeMs === null ? 0 : 3,
  active: 0,
  delayed: 0,
  failed: 0,
  completed: 0,
  paused: false,
  oldestWaitingAgeMs,
});

function build(options: {
  mirror?: string | null;
  queueDepths?: QueueDepth[];
  queueError?: boolean;
  killCount?: number;
  protectionCount?: number;
  killQueryFails?: boolean;
} = {}): { service: TradingReadinessService; reads: string[] } {
  const reads: string[] = [];
  const redis = {
    client: {
      get: async (key: string): Promise<string | null> => {
        reads.push(key);
        return options.mirror === undefined ? null : options.mirror;
      },
    },
  } as unknown as RedisService;

  const queues = {
    getDepths: async (): Promise<QueueDepth[]> => {
      if (options.queueError === true) {
        throw new Error('redis down');
      }
      return options.queueDepths ?? [depth('strategy-control', 1_000), depth('trade-execution', 2_000)];
    },
  } as unknown as QueueService;

  const prisma = {
    killSwitch: {
      count: async (): Promise<number> => {
        if (options.killQueryFails === true) {
          throw new Error('pool timeout');
        }
        return options.killCount ?? 0;
      },
    },
    riskProtectionTrip: {
      count: async (): Promise<number> => options.protectionCount ?? 0,
    },
  } as unknown as PrismaService;

  const config = {
    healthRefreshMs: 5_000,
    queueAlertAgeMs: 120_000,
  } as unknown as AppConfigService;

  const logger = {
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  } as unknown as PinoLogger;

  return {
    service: new TradingReadinessService(redis, prisma, queues, config, logger),
    reads,
  };
}

describe('trading readiness merge', () => {
  it('all evidence green => ready, with per-gate sources', async () => {
    const { service, reads } = build({ mirror: engineMirrorDocument() });
    const view = await service.evaluate();
    expect(view.tradingReady).toBe(true);
    expect(view.status).toBe('HEALTHY');
    expect(view.blockingGates).toEqual([]);
    expect(view.enginesReporting).toEqual(['trading-engine']);
    const byGate = new Map(view.gates.map((gate) => [gate.gate, gate]));
    expect(byGate.get('market_data')?.source).toBe('trading-engine');
    expect(byGate.get('queues')?.source).toBe('api');
    expect(byGate.get('configuration')?.reason).toMatch(/environment parsed/);
    // The kill-switch gate must come from the DURABLE table, not the mirror;
    // the reason string proves which source answered.
    expect(byGate.get('kill_switches')?.reason).toMatch(/durable: no engaged/);
    expect(reads).toContain('wlct:trading:ops:readiness:trading-engine');
  });

  it('no engine mirror at all => every engine gate unknown and trading NOT ready', async () => {
    const { service } = build({ mirror: null });
    const view = await service.evaluate();
    expect(view.tradingReady).toBe(false);
    for (const gate of ENGINE_GATES) {
      const verdict = view.gates.find((candidate) => candidate.gate === gate);
      if (gate === 'kill_switches') {
        // the API supplies this one from the durable tables; it stays green
        // even with the engine silent - and that asymmetry is the point of
        // the merge.
        expect(verdict?.satisfied).toBe(true);
        continue;
      }
      expect(verdict?.satisfied).toBe(false);
      expect(verdict?.reason).toMatch(/no trading-engine readiness mirror/);
    }
  });

  it('a single blocked engine gate blocks trading, and names itself honestly', async () => {
    const { service } = build({
      mirror: engineMirrorDocument({ risk_state_fresh: false }),
    });
    const view = await service.evaluate();
    expect(view.tradingReady).toBe(false);
    expect(view.blockingGates).toEqual(['risk_state_fresh']);
    const status = view.status;
    expect(['DEGRADED', 'UNHEALTHY']).toContain(status);
  });

  it('engaged durable kill switch blocks even a fully-green engine mirror', async () => {
    const { service } = build({ mirror: engineMirrorDocument(), killCount: 1 });
    const view = await service.evaluate();
    expect(view.tradingReady).toBe(false);
    expect(view.blockingGates).toContain('kill_switches');
  });

  it('active protection trips block the same way (kill switches not blocking includes protections)', async () => {
    const { service } = build({ mirror: engineMirrorDocument(), protectionCount: 2 });
    const view = await service.evaluate();
    expect(view.tradingReady).toBe(false);
    expect(view.gates.find((g) => g.gate === 'kill_switches')?.reason).toContain('2 active protection');
  });

  it('unreadable durable tables fall back to the engine view and SAY so', async () => {
    const { service } = build({
      mirror: engineMirrorDocument(),
      killQueryFails: true,
    });
    const view = await service.evaluate();
    const kill = view.gates.find((g) => g.gate === 'kill_switches');
    expect(kill?.satisfied).toBe(true); // engine mirror said OK
    expect(kill?.reason).toMatch(/durable table unreadable .*engine mirror view used instead/);
    // the fallback is reported, not hidden: trading stays ready ONLY because
    // the engine mirror exists and said so; drop it and the gate goes unknown.
    const noMirror = await build({ killQueryFails: true }).service.evaluate();
    expect(noMirror.tradingReady).toBe(false);
    expect(noMirror.gates.find((g) => g.gate === 'kill_switches')?.reason).toMatch(/no source available/);
  });

  it('queue policy: execution queue fires at HALF the age and blocks readiness', async () => {
    const { service } = build({
      mirror: engineMirrorDocument(),
      queueDepths: [depth('risk-control', 119_000), depth('trade-execution', 61_000)],
    });
    const view = await service.evaluate();
    // risk-control is under 120s; trade-execution over its 60s half.
    expect(view.tradingReady).toBe(false);
    expect(view.blockingGates).toContain('queues');
    expect(view.gates.find((g) => g.gate === 'queues')?.reason).toContain('trade-execution');
  });

  it('unreachable queue backend is UNKNOWN evidence, which blocks (fail closed)', async () => {
    const { service } = build({ mirror: engineMirrorDocument(), queueError: true });
    const view = await service.evaluate();
    expect(view.tradingReady).toBe(false);
    expect(view.gates.find((g) => g.gate === 'queues')?.reason).toMatch(/queue backend unreadable/);
  });

  it('the verdict never authorises: the note says enforcement lives elsewhere', async () => {
    const { service } = build({ mirror: engineMirrorDocument() });
    const view = await service.evaluate();
    expect(view.note).toMatch(/risk gate's job/i);
  });
});

describe('queueAlertSamples mirrors the readiness queue policy exactly', () => {
  it('flags the execution queue at half age, control queues at full age', async () => {
    const { service } = build({
      queueDepths: [depth('strategy-control', 119_000), depth('trade-execution', 61_000), depth('datasets-control', null)],
    });
    const samples = await service.queueAlertSamples();
    const byQueue = new Map(samples.map((sample) => [sample.queue, sample]));
    expect(byQueue.get('strategy-control')?.alerting).toBe(false);
    expect(byQueue.get('trade-execution')?.alerting).toBe(true);
    expect(byQueue.get('trade-execution')?.critical).toBe(true);
    expect(byQueue.get('datasets-control')?.alerting).toBe(false);
  });

  it('an unreachable queue backend yields NO samples (never a false all-clear)', async () => {
    const { service } = build({ queueError: true });
    expect(await service.queueAlertSamples()).toEqual([]);
  });
});
