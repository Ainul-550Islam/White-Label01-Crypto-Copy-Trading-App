// # Verifies liquidation alert dispatch: per-(position,bucket) dedupe for 15 minutes, preference respect, and a recorded failure instead of a silently dropped alert.
import { LiquidationRiskNotificationProcessor, LIQUIDATION_ALERT_DEDUPE_SECONDS, type LiquidationRiskAlertPayload } from './liquidation-risk-notification.processor';
import { LiquidationBucket } from '../../risk/liquidation-distance';

function payload(overrides: Partial<LiquidationRiskAlertPayload> = {}): LiquidationRiskAlertPayload {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    positionId: 'pos-1',
    accountId: 'acct-1',
    symbol: 'BTC-USDT',
    side: 'LONG',
    quantity: '0.5',
    bucket: LiquidationBucket.DANGER,
    distancePercent: '5.4',
    distanceBps: '540',
    liquidationPrice: '90000',
    markPrice: '95000',
    evaluationId: 'eval-1',
    ...overrides,
  };
}

interface NotificationCreateData {
  body: string;
  type: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

interface NotificationUpdateData {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

function build(options: {
  existingClaim?: boolean;
  preference?: { enabled: boolean } | null;
  failInsert?: boolean;
  failPublish?: boolean;
} = {}) {
  const set = jest.fn(async (..._args: unknown[]) => (options.existingClaim ? null : 'OK'));
  const publish = options.failPublish
    ? jest.fn(async () => { throw new Error('redis publish failed'); })
    : jest.fn(async () => 1);
  const created: NotificationCreateData[] = [];
  const updated: NotificationUpdateData[] = [];
  const tx = {
      notification: {
        createMany: jest.fn(async ({ data }: { data: NotificationCreateData }) => {
          if (options.failInsert) throw new Error('insert failed');
          created.push(data);
          return { count: 1 };
        }),
        create: jest.fn(async ({ data }: { data: NotificationCreateData }) => {
          created.push(data);
          return { id: 'notification-1' };
        }),
        findFirst: jest.fn(async () => ({ id: 'notification-1' })),
        updateMany: jest.fn(async (args: NotificationUpdateData) => { updated.push(args); return { count: 1 }; }),
      },
  };
  const prisma = {
    notificationPreference: {
      findFirst: jest.fn(async () => options.preference ?? null),
    },
    withTenantRls: jest.fn(async (_tenantId: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const redis = { client: { set }, publisher: { publish } };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    processor: new LiquidationRiskNotificationProcessor(prisma as never, redis as never, logger as never),
    set, publish, created, updated, logger,
  };
}

describe('LiquidationRiskNotificationProcessor', () => {
  it('dispatches a DANGER alert once and dedupes the same position and bucket for 15 minutes', async () => {
    const h = build();
    const first = await h.processor.dispatch(payload());
    expect(first.dispatched).toBe(true);
    expect(h.set).toHaveBeenCalledWith('liquidation-alert:pos-1:DANGER', 'tenant-1', 'EX', LIQUIDATION_ALERT_DEDUPE_SECONDS, 'NX');
    expect(LIQUIDATION_ALERT_DEDUPE_SECONDS).toBe(900);

    const second = build({ existingClaim: true });
    const deduped = await second.processor.dispatch(payload());
    expect(deduped).toEqual({ dispatched: false, skippedReason: 'DEDUPED', notificationId: null, failureRecorded: false });
    expect(second.created).toHaveLength(0);
  });

  it('does not let a DANGER alert suppress a CRITICAL alert for the same position', async () => {
    const h = build();
    await h.processor.dispatch(payload({ bucket: LiquidationBucket.DANGER, evaluationId: 'eval-1' }));
    await h.processor.dispatch(payload({ bucket: LiquidationBucket.CRITICAL, evaluationId: 'eval-2' }));
    expect(h.set.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'liquidation-alert:pos-1:DANGER',
      'liquidation-alert:pos-1:CRITICAL',
    ]);
    expect(h.created).toHaveLength(2);
  });

  it('alerts on UNKNOWN because "we cannot see it" is a margin-health warning', async () => {
    const h = build();
    const result = await h.processor.dispatch(payload({
      bucket: LiquidationBucket.UNKNOWN,
      distancePercent: null,
      distanceBps: null,
      liquidationPrice: null,
    }));
    expect(result.dispatched).toBe(true);
    expect(h.created[0].body).toContain('unknown');
    expect(h.created[0].data).toMatchObject({ bucket: 'UNKNOWN', distancePercent: null });
  });

  it('does not alert on a SAFE bucket', async () => {
    const h = build();
    const result = await h.processor.dispatch(payload({ bucket: LiquidationBucket.SAFE }));
    expect(result.skippedReason).toBe('NOT_AN_ALERT_BUCKET');
    expect(h.set).not.toHaveBeenCalled();
  });

  it('respects a disabled liquidation_risk preference without losing the row', async () => {
    const h = build({ preference: { enabled: false } });
    const result = await h.processor.dispatch(payload());
    expect(result).toEqual({ dispatched: false, skippedReason: 'PREFERENCE_DISABLED', notificationId: null, failureRecorded: false });
    expect(h.created).toHaveLength(0);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('delivers when no preference row exists (absence is not an opt-out)', async () => {
    const h = build({ preference: null });
    expect((await h.processor.dispatch(payload())).dispatched).toBe(true);
  });

  it('records a failed insert instead of dropping the alert', async () => {
    const h = build({ failInsert: true });
    const result = await h.processor.dispatch(payload());
    expect(result.dispatched).toBe(false);
    expect(result.failureRecorded).toBe(true);
    // The failure row carries failedAt and a reason; it is not an empty catch.
    expect(h.created[0]).toMatchObject({ type: 'LIQUIDATION_RISK_DANGER', data: { positionId: 'pos-1', undelivered: true } });
    expect(h.created[0].failedAt).toBeInstanceOf(Date);
    expect(h.created[0].failureReason).toContain('insert failed');
    expect(h.logger.error).toHaveBeenCalled();
  });

  it('marks the delivered row as failed when the realtime publish fails', async () => {
    const h = build({ failPublish: true });
    const result = await h.processor.dispatch(payload());
    expect(result).toMatchObject({ dispatched: false, notificationId: 'notification-1', failureRecorded: true });
    expect(h.updated[0]).toMatchObject({
      where: { id: 'notification-1', tenantId: 'tenant-1' },
      data: { deliveredAt: null },
    });
    expect(h.updated[0].data.failureReason).toContain('publish failed');
  });

  it('suppresses rather than storms when the dedupe store is unavailable', async () => {
    const h = build();
    h.set.mockImplementationOnce(async () => { throw new Error('redis down'); });
    const result = await h.processor.dispatch(payload());
    expect(result).toEqual({ dispatched: false, skippedReason: 'DEDUPED', notificationId: null, failureRecorded: false });
    expect(h.logger.warn).toHaveBeenCalled();
  });
});
