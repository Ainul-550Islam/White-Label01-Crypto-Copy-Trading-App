import { ConflictException, NotFoundException } from '@nestjs/common';

import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { RedisService } from '../../infrastructure/redis/redis.service';
import type { AuditService } from '../audit/audit.service';
import type { PinoLogger } from 'nestjs-pino';

import { AlertsService } from './alerts.service';
import type { IncidentsService } from './incidents.service';

/**
 * Deterministic tests for the durable alert fold: creation, dedupe (fold),
 * occurrence accounting, acknowledgement, recovery-observed resolution,
 * force-resolve discipline and the retention guards. Fakes instead of a
 * database because what is being pinned is the SERVICE's decision logic -
 * which rows are created, how counts merge, which transitions are legal and
 * which errors are typed - not Postgres' upsert semantics.
 */

interface AlertRecord {
  id: string;
  dedupeKey: string;
  ruleId: string;
  component: string;
  scope: string | null;
  severity: string;
  state: string;
  title: string;
  condition: string;
  message: string | null;
  observedValue: string | null;
  thresholdValue: string | null;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  links: Record<string, unknown> | null;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

class FakePrisma {
  readonly alerts = new Map<string, AlertRecord>();

  readonly deleteManyWhere: Array<Record<string, unknown>> = [];

  private seq = 0;

  opsAlert = {
    findUnique: async ({ where }: { where: { dedupeKey?: string; id?: string } }): Promise<AlertRecord | null> => {
      if (where.dedupeKey !== undefined) {
        return this.alerts.get(where.dedupeKey) ?? null;
      }
      return [...this.alerts.values()].find((row) => row.id === where.id) ?? null;
    },
    create: async ({ data }: { data: Record<string, unknown> }): Promise<AlertRecord> => {
      this.seq += 1;
      const row: AlertRecord = {
        id: `alert-${this.seq}`,
        dedupeKey: String(data.dedupeKey),
        ruleId: String(data.ruleId),
        component: String(data.component),
        scope: (data.scope as string | null | undefined) ?? null,
        severity: String(data.severity),
        state: String(data.state),
        title: String(data.title),
        condition: String(data.condition),
        message: (data.message as string | null | undefined) ?? null,
        observedValue: (data.observedValue as string | null | undefined) ?? null,
        thresholdValue: (data.thresholdValue as string | null | undefined) ?? null,
        occurrences: Number(data.occurrences ?? 1),
        firstSeenAt: data.firstSeenAt as Date,
        lastSeenAt: data.lastSeenAt as Date,
        acknowledgedBy: (data.acknowledgedBy as string | null | undefined) ?? null,
        acknowledgedAt: (data.acknowledgedAt as Date | null | undefined) ?? null,
        resolvedAt: (data.resolvedAt as Date | null | undefined) ?? null,
        resolution: (data.resolution as string | null | undefined) ?? null,
        links: (data.links as Record<string, unknown> | null | undefined) ?? null,
        tenantId: (data.tenantId as string | null | undefined) ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.alerts.set(row.dedupeKey, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }): Promise<AlertRecord> => {
      const row = [...this.alerts.values()].find((candidate) => candidate.id === where.id);
      if (row === undefined) {
        throw new Error('update of unknown row');
      }
      Object.assign(row, data);
      return row;
    },
    findMany: async ({ where }: { where: { state?: { in: string[] } } }): Promise<AlertRecord[]> => {
      const rows = [...this.alerts.values()];
      if (where.state?.in === undefined) {
        return rows;
      }
      return rows.filter((row) => where.state?.in?.includes(row.state) === true);
    },
    count: async (): Promise<number> => this.alerts.size,
    deleteMany: async ({ where }: { where: Record<string, unknown> }): Promise<{ count: number }> => {
      this.deleteManyWhere.push(where);
      const cutoff = (where.resolvedAt as { lt?: Date } | undefined)?.lt;
      let count = 0;
      for (const [key, row] of this.alerts) {
        if (row.state === 'RESOLVED' && row.resolvedAt !== null && cutoff !== undefined && row.resolvedAt < cutoff) {
          this.alerts.delete(key);
          count += 1;
        }
      }
      return { count };
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { dedupeKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<AlertRecord> => {
      const existing = this.alerts.get(where.dedupeKey);
      if (existing === undefined) {
        return this.opsAlert.create({ data: create });
      }
      const increment = (update.occurrences as { increment?: number } | undefined)?.increment;
      return this.opsAlert.update({
        where: { id: existing.id },
        data: {
          ...update,
          occurrences: increment === undefined ? undefined : existing.occurrences + increment,
          firstSeenAt: undefined,
          ...(update.resolvedAt === null ? { resolvedAt: null, resolution: null, firstSeenAt: new Date() } : {}),
        },
      });
    },
  };

  opsIncident = {
    findUnique: async (): Promise<null> => null,
    create: async (): Promise<{ id: string }> => ({ id: 'incident-1' }),
    update: async (_args: Record<string, unknown>): Promise<Record<string, unknown>> => ({}),
  };

  opsIncidentLink = {
    upsert: async (): Promise<Record<string, unknown>> => ({}),
  };

  $transaction = async <T,>(ops: Array<Promise<T>>): Promise<T[]> => Promise.all(ops);
}

const recordPayload = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  alertId: 'alert-engine-1',
  ruleId: 'MARKET_DATA_STALE',
  severity: 'CRITICAL',
  state: 'OPEN',
  component: 'market-data',
  scope: 'binance/BTCUSDT',
  title: 'Market data stale',
  condition: 'stream silent past budget',
  firstSeenAtMicros: 1_700_000_000_000_000,
  lastSeenAtMicros: 1_700_000_001_000_000,
  occurrences: 5,
  observedValue: '4.1',
  thresholdValue: '2',
  message: 'BTCUSDT: no fresh quote for 4s',
  links: { correlation_id: 'corr-77', risk_event: 're-1' },
  acknowledgedBy: null,
  acknowledgedAtMicros: null,
  resolvedAtMicros: null,
  resolution: null,
  ...overrides,
});

const alertsDocument = (records: Record<string, unknown>[]): string =>
  JSON.stringify({ active: records, counts: { CRITICAL: records.length } });

function build(): {
  service: AlertsService;
  prisma: FakePrisma;
  mirrors: Map<string, string>;
  audits: Array<Record<string, unknown>>;
} {
  const prisma = new FakePrisma();
  const mirrors = new Map<string, string>();
  const audits: Array<Record<string, unknown>> = [];

  const redis = {
    client: {
      get: async (key: string): Promise<string | null> => mirrors.get(key) ?? null,
    },
  } as unknown as RedisService;

  const config = {
    alertRetentionDays: 90,
    incidentRetentionDays: 365,
    queueAlertAgeMs: 120_000,
  } as unknown as AppConfigService;

  const audit = {
    recordImmediate: async (input: Record<string, unknown>): Promise<void> => {
      audits.push(input);
    },
  } as unknown as AuditService;

  const incidents = {
    linkAlert: async (): Promise<number> => 0,
  } as unknown as IncidentsService;

  const logger = {
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  } as unknown as PinoLogger;

  const service = new AlertsService(
    prisma as unknown as PrismaService,
    redis,
    config,
    audit,
    incidents,
    logger,
  );
  return { service, prisma, mirrors, audits };
}

describe('alert fold: creation, dedupe, storm accounting', () => {
  it('first mirror with records creates one row per alert, publisher-attributed', async () => {
    const { service, prisma, mirrors } = build();
    mirrors.set(
      'wlct:trading:ops:alerts:market-data',
      alertsDocument([recordPayload(), recordPayload({ alertId: 'alert-engine-2', scope: 'binance/ETHUSDT' })]),
    );

    const result = await service.syncFromMirrors();
    expect(result.inserted).toBe(2);
    expect(result.folded).toBe(0);
    expect(result.mirrorPresent['market-data']).toBe(true);

    const row = prisma.alerts.get('MARKET_DATA_STALE|market-data|binance/BTCUSDT');
    expect(row).toBeDefined();
    expect(row?.occurrences).toBe(5);
    expect(row?.links?.['publisher']).toBe('market-data');
    expect(row?.links?.['correlation_id']).toBe('corr-77');
    expect(row?.firstSeenAt.getTime()).toBe(1_700_000_000_000);
  });

  it('a storm folds: re-published counts update the SAME row (10_000 ticks, 1 row)', async () => {
    const { service, prisma, mirrors } = build();
    for (let occurrences = 1; occurrences <= 10_000; occurrences += 1) {
      mirrors.set(
        'wlct:trading:ops:alerts:market-data',
        alertsDocument([recordPayload({ occurrences, lastSeenAtMicros: 1_700_000_000_000_000 + occurrences * 1_000 })]),
      );
      const result = await service.syncFromMirrors();
      expect(result.inserted).toBe(occurrences === 1 ? 1 : 0);
      expect(result.folded).toBe(occurrences === 1 ? 0 : 1);
    }
    expect(prisma.alerts.size).toBe(1);
    const row = [...prisma.alerts.values()][0];
    expect(row?.occurrences).toBe(10_000);
    expect(row?.firstSeenAt.getTime()).toBe(1_700_000_000_000); // preserved from the very first tick
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(1_700_000_000_000);
  });

  it('a publisher restart does not erase durable history (max-guard on occurrences)', async () => {
    const { service, prisma, mirrors } = build();
    mirrors.set('wlct:trading:ops:alerts:market-data', alertsDocument([recordPayload({ occurrences: 999 })]));
    await service.syncFromMirrors();
    mirrors.set('wlct:trading:ops:alerts:market-data', alertsDocument([recordPayload({ occurrences: 2 })]));
    await service.syncFromMirrors();
    expect([...prisma.alerts.values()][0]?.occurrences).toBe(999);
  });

  it('absence of a mirror is NOT recovery; presence without the record IS', async () => {
    const { service, prisma, mirrors } = build();
    const key = 'wlct:trading:ops:alerts:market-data';
    mirrors.set(key, alertsDocument([recordPayload()]));
    await service.syncFromMirrors();
    const row = [...prisma.alerts.values()][0];
    expect(row?.state).toBe('OPEN');

    // publisher went quiet: rows stay as they are
    mirrors.delete(key);
    const quiet = await service.syncFromMirrors();
    expect(quiet.resolved).toBe(0);
    expect(quiet.mirrorPresent['market-data']).toBe(false);
    expect(prisma.alerts.get(row?.dedupeKey as string)?.state).toBe('OPEN');

    // publisher is alive and no longer reports it: recovery was OBSERVED
    mirrors.set(key, alertsDocument([]));
    const recovered = await service.syncFromMirrors();
    expect(recovered.resolved).toBe(1);
    const resolved = prisma.alerts.get(row?.dedupeKey as string);
    expect(resolved?.state).toBe('RESOLVED');
    expect(resolved?.resolution).toContain('recovered');

    // re-fire after resolution RE-ARMS the row rather than inserting a twin
    mirrors.set(key, alertsDocument([recordPayload({ occurrences: 1, firstSeenAtMicros: 1_700_000_002_000_000 })]));
    await service.syncFromMirrors();
    expect(prisma.alerts.size).toBe(1);
    expect(prisma.alerts.get(row?.dedupeKey as string)?.state).toBe('OPEN');
  });

  it('an unparseable mirror is treated as silence, never as "all clear"', async () => {
    const { service, prisma, mirrors } = build();
    const key = 'wlct:trading:ops:alerts:market-data';
    mirrors.set(key, alertsDocument([recordPayload()]));
    await service.syncFromMirrors();
    mirrors.set(key, '{"active": "this is not a list"}');
    const result = await service.syncFromMirrors();
    expect(result.resolved).toBe(0);
    expect(result.mirrorPresent['market-data']).toBe(false);
    expect([...prisma.alerts.values()][0]?.state).toBe('OPEN');
  });
});

type BuildEnv = Awaited<ReturnType<typeof build>> extends never ? never : ReturnType<typeof build>;

describe('alert lifecycle mutations: explicit transitions, audited', () => {
  // Engine publishers are platform services, so their folds create platform
  // rows (tenantId null) - mutable only by the platform role, the split the
  // last two cases in this block pin from both sides.
  const actor = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    platform: true,
    requestId: 'req-1',
    correlationId: 'corr-1',
  };

  async function openAlert(env: BuildEnv): Promise<string> {
    env.mirrors.set('wlct:trading:ops:alerts:market-data', alertsDocument([recordPayload({ scope: null })]));
    await env.service.syncFromMirrors();
    const first = [...env.prisma.alerts.values()][0];
    if (first === undefined) {
      throw new Error('fixture failed to open an alert');
    }
    return first.id;
  }

  it('acknowledge moves OPEN -> ACKNOWLEDGED, records the audit row, changes nothing else', async () => {
    const env = build();
    const id = await openAlert(env);
    const result = await env.service.acknowledge(actor, id, 'investigating venue feed');
    expect(result.alert.state).toBe('ACKNOWLEDGED');
    expect(result.alert.acknowledgedBy).toBe('user-1');
    expect(env.audits[0]?.action).toBe('OPS_ALERT_ACKNOWLEDGED');
    expect(env.audits[0]?.correlationId).toBe('corr-1');
    expect(env.audits[0]?.metadata).toEqual({
      ruleId: 'MARKET_DATA_STALE',
      component: 'market-data',
      scope: null,
    });
  });

  it('acknowledging a non-OPEN alert is a conflict (it is not a rubber stamp)', async () => {
    const env = build();
    const id = await openAlert(env);
    await env.service.acknowledge(actor, id, 'first ack');
    await expect(env.service.acknowledge(actor, id, 'second ack')).rejects.toBeInstanceOf(ConflictException);
  });

  it('unknown alerts and other tenants are NotFound; the existence of another tenant row is not information', async () => {
    const env = build();
    await env.prisma.opsAlert.create({
      data: {
        dedupeKey: 'RISK_SNAPSHOT_STALE|risk-state|tenant-9',
        ruleId: 'RISK_SNAPSHOT_STALE',
        component: 'risk-state',
        scope: 'tenant-9',
        severity: 'CRITICAL',
        state: 'OPEN',
        title: 't',
        condition: 'c',
        occurrences: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        tenantId: 'tenant-9',
        links: { publisher: 'trading-engine' },
      },
    });
    await expect(env.service.acknowledge(actor, 'missing-id', 'nope')).rejects.toBeInstanceOf(NotFoundException);

    const foreign = [...env.prisma.alerts.values()][0] as { id: string; tenantId: string | null };
    // a tenant-1 actor (non-platform) must not even learn the row exists
    await expect(
      env.service.get('tenant-1', foreign.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      env.service.acknowledge({ ...actor, platform: false }, foreign.id, 'peeking'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // the owning tenant can read and mutate its own row without platform rank
    await expect(env.service.get('tenant-9', foreign.id)).resolves.toMatchObject({ ruleId: 'RISK_SNAPSHOT_STALE' });
    await expect(
      env.service.acknowledge({ ...actor, platform: false, tenantId: 'tenant-9' }, foreign.id, 'own row'),
    ).resolves.toMatchObject({ alert: { state: 'ACKNOWLEDGED' } });
  });

  it('platform rows (tenant null) are readable by tenants but mutable only by the platform role', async () => {
    const env = build();
    const id = await openAlert(env); // scope null -> tenantId null (platform row)
    await expect(
      env.service.acknowledge({ ...actor, platform: false }, id, 'tenant touching platform row'),
    ).rejects.toMatchObject({
      response: { code: 'PLATFORM_ALERT_REQUIRES_PLATFORM_ROLE' },
    });
    const result = await env.service.acknowledge({ ...actor, platform: true }, id, 'platform ack');
    expect(result.alert.state).toBe('ACKNOWLEDGED');
  });

  it('force-resolve without the phrase is refused; with it, it resolves with provenance and audit', async () => {
    const env = build();
    const id = await openAlert(env);
    await expect(
      env.service.forceResolve(actor, id, 'condition proven gone by venue status page, promise', 'CLOSE PLEASE'),
    ).rejects.toBeInstanceOf(ConflictException);

    const result = await env.service.forceResolve(
      actor,
      id,
      'condition proven gone; venue status page incident closed at 14:02Z',
      'FORCE RESOLVE ALERT',
    );
    expect(result.alert.state).toBe('RESOLVED');
    expect(result.alert.resolution).toContain('force-resolved by user-1');
    expect(env.audits.some((entry) => entry.action === 'OPS_ALERT_FORCE_RESOLVED')).toBe(true);
    // an already-resolved row never resolves twice
    await expect(
      env.service.forceResolve(actor, id, 'trying to close it again with a long reason', 'FORCE RESOLVE ALERT'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('queue-alert policy (the API is its own publisher)', () => {
  it('backlog over policy upserts; recovery within policy resolves only API-published rows', async () => {
    const env = build();
    await env.service.applyQueueAlerts([
      { queue: 'trade-execution', oldestWaitingAgeMs: 70_000, alerting: true, critical: true },
      { queue: 'risk-control', oldestWaitingAgeMs: 10_000, alerting: false, critical: false },
    ]);
    const exec = env.prisma.alerts.get('EXECUTION_QUEUE_BACKLOG|queues|trade-execution');
    expect(exec).toBeDefined();
    expect(exec?.severity).toBe('CRITICAL');
    expect(exec?.thresholdValue).toBe('60000'); // half the 120s policy
    const risk = env.prisma.alerts.get('QUEUE_BACKLOG|queues|risk-control');
    expect(risk).toBeUndefined();

    await env.service.applyQueueAlerts([
      { queue: 'trade-execution', oldestWaitingAgeMs: 1_000, alerting: false, critical: true },
    ]);
    expect(env.prisma.alerts.get('EXECUTION_QUEUE_BACKLOG|queues|trade-execution')?.state).toBe('RESOLVED');
  });

  it('a second tick of the same backlog increments occurrences on the fold', async () => {
    const env = build();
    const sample = { queue: 'strategy-control', oldestWaitingAgeMs: 500_000, alerting: true, critical: false };
    await env.service.applyQueueAlerts([sample]);
    await env.service.applyQueueAlerts([sample]);
    const row = env.prisma.alerts.get('QUEUE_BACKLOG|queues|strategy-control');
    expect(row?.occurrences).toBe(2);
  });
});

describe('retention: only resolved history may age out', () => {
  it('prune only deletes RESOLVED rows past the window, and never touches OPEN ones', async () => {
    const env = build();
    env.mirrors.set('wlct:trading:ops:alerts:market-data', alertsDocument([recordPayload({ scope: null })]));
    await env.service.syncFromMirrors();
    const row = [...env.prisma.alerts.values()][0] as NonNullable<ReturnType<FakePrisma['opsAlert']['findUnique']> extends Promise<infer R> ? R : never>;

    // not resolved yet: prune must not even consider it
    await env.service.prune();
    expect(env.prisma.deleteManyWhere[0]).toMatchObject({
      state: 'RESOLVED',
      resolvedAt: { lt: expect.any(Date) },
    });

    row.state = 'RESOLVED';
    row.resolvedAt = new Date(Date.now() - 400 * 86_400_000);
    await env.service.prune();
    expect(env.prisma.alerts.size).toBe(0);
  });
});
