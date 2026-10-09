import { WebhookReplayGuard } from './webhook.replay-guard';
import { WebhookProcessingStatus } from './webhook.types';
import { PaymentProvider } from './payment.types';

type Row = Record<string, any>;

/** Minimal in-memory webhookEvent delegate honouring equality and `{ not }` filters. */
function fakeWebhookEvents() {
  const rows: Row[] = [];
  let clock = 1_700_000_000_000;
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (cond !== null && typeof cond === 'object' && 'not' in cond) {
        return row[key] !== cond.not;
      }
      return row[key] === cond;
    });
  const delegate = {
    rows,
    create: jest.fn(async ({ data }: { data: Row }) => {
      clock += 1000;
      const row = {
        processingAttempts: 0,
        processingStatus: WebhookProcessingStatus.RECEIVED,
        createdAt: new Date(clock),
        updatedAt: new Date(clock),
        ...data,
      };
      rows.push(row);
      return row;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
      const hits = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt === 'desc') {
        hits.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return hits[0] ?? null;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of rows) {
        if (!matches(row, where)) {
          continue;
        }
        count += 1;
        for (const [key, value] of Object.entries(data)) {
          if (value !== null && typeof value === 'object' && 'increment' in value) {
            row[key] = (row[key] ?? 0) + value.increment;
          } else if (value !== undefined) {
            row[key] = value;
          }
        }
      }
      return { count };
    }),
  };
  return delegate;
}

const EVENT = {
  provider: PaymentProvider.STRIPE,
  providerEventId: 'evt_123',
  eventType: 'invoice.paid',
  eventCategory: 'PAYMENT',
  paymentStatus: 'SUCCEEDED',
  // Inside the guard's 24h replay window: an older event is refused for age,
  // which would hide what these tests are about.
  receivedAt: new Date(),
  providerCreatedAt: new Date(),
  metadata: {},
} as any;

describe('WebhookReplayGuard (durable replay protection)', () => {
  let events: ReturnType<typeof fakeWebhookEvents>;
  let guard: WebhookReplayGuard;
  const cache = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };

  beforeEach(() => {
    events = fakeWebhookEvents();
    cache.get.mockClear();
    cache.set.mockClear();
    guard = new WebhookReplayGuard({ webhookEvent: events } as any, cache as any);
  });

  /** The order WebhookService uses for one delivery. */
  async function deliver(): Promise<boolean> {
    await guard.recordEventReceived(EVENT, { id: EVENT.providerEventId }, 'sig');
    await guard.markEventVerified(EVENT.provider, EVENT.providerEventId);
    const check = await guard.checkReplay(EVENT);
    if (!check.shouldProcess) {
      if (check.isDuplicate) {
        await guard.markEventDuplicate(EVENT.provider, EVENT.providerEventId);
      }
      return false;
    }
    await guard.markEventProcessing(EVENT.provider, EVENT.providerEventId);
    await guard.markEventProcessed(EVENT.provider, EVENT.providerEventId, 'pay_1', 'tenant-1');
    return true;
  }

  it('processes the first delivery', async () => {
    await expect(deliver()).resolves.toBe(true);
    expect(
      events.rows.filter((r) => r.processingStatus === WebhookProcessingStatus.PROCESSED),
    ).toHaveLength(1);
  });

  it('refuses a replay from the database once the cache entry has expired', async () => {
    await deliver();
    // cache.get always returns null here: the Redis entry is gone.
    await expect(deliver()).resolves.toBe(false);
    await expect(deliver()).resolves.toBe(false);
  });

  it('never downgrades the PROCESSED row when later deliveries are marked', async () => {
    await deliver();
    await deliver();
    await guard.markEventFailed(EVENT.provider, EVENT.providerEventId, 'late failure');
    await guard.markEventProcessing(EVENT.provider, EVENT.providerEventId);
    const processed = events.rows.filter(
      (r) => r.processingStatus === WebhookProcessingStatus.PROCESSED,
    );
    expect(processed).toHaveLength(1);
    expect(processed[0].paymentId).toBe('pay_1');
  });

  it('excludes PROCESSED rows in every non-terminal status update', async () => {
    await guard.markEventVerified(EVENT.provider, EVENT.providerEventId);
    await guard.markEventProcessing(EVENT.provider, EVENT.providerEventId);
    await guard.markEventFailed(EVENT.provider, EVENT.providerEventId, 'x');
    await guard.markEventDuplicate(EVENT.provider, EVENT.providerEventId);
    expect(events.updateMany).toHaveBeenCalledTimes(4);
    for (const [args] of events.updateMany.mock.calls) {
      expect(args.where).toEqual({
        provider: EVENT.provider,
        providerEventId: EVENT.providerEventId,
        processingStatus: { not: WebhookProcessingStatus.PROCESSED },
      });
    }
  });

  it('answers from the PROCESSED row even when a newer row exists', async () => {
    await deliver();
    await guard.recordEventReceived(EVENT, { id: EVENT.providerEventId }, 'sig');
    const check = await guard.checkReplay(EVENT);
    expect(check.shouldProcess).toBe(false);
    expect(check.isDuplicate).toBe(true);
    expect(check.existingRecord?.processingStatus).toBe(WebhookProcessingStatus.PROCESSED);
  });

  it('allows a retry after a failed attempt', async () => {
    await guard.recordEventReceived(EVENT, { id: EVENT.providerEventId }, 'sig');
    await guard.markEventProcessing(EVENT.provider, EVENT.providerEventId);
    await guard.markEventFailed(EVENT.provider, EVENT.providerEventId, 'provider timeout');
    const check = await guard.checkReplay(EVENT);
    expect(check.shouldProcess).toBe(true);
  });

  it('does not invent a provider timestamp when replay-age evidence is absent', async () => {
    const check = await guard.checkReplay({ ...EVENT, providerCreatedAt: null });
    expect(check).toMatchObject({ isDuplicate: false, isReplay: false, shouldProcess: true });
  });

  it('short-circuits on the cache fast path', async () => {
    cache.get.mockResolvedValueOnce({ processedAt: 'x' } as never);
    const check = await guard.checkReplay(EVENT);
    expect(check).toMatchObject({ isDuplicate: true, shouldProcess: false });
    expect(events.findFirst).not.toHaveBeenCalled();
  });
});
