// # Verifies user-data stream health: lifecycle transitions, a stale event making the stream DEGRADED, another tenant's account being invisible, and an unreachable engine reporting UNKNOWN rather than CONNECTED.
import { ExchangeUserStreamService, USER_STREAM_EVENT_STALE_MS, USER_STREAM_LISTEN_KEY_TTL_MS, USER_STREAM_RECONNECT_WARN_COUNT, classifyUserStream, type EngineStreamReader } from './exchange-user-stream.service';

const NOW = new Date('2026-10-26T09:00:00.000Z');
const micros = (date: Date) => (BigInt(date.getTime()) * 1000n).toString();

function build(options: {
  account?: { id: string; tenantId: string } | null;
  session?: Record<string, unknown> | null;
  engine?: EngineStreamReader | null;
} = {}) {
  const account = options.account === undefined ? { id: 'acct-1', tenantId: 'tenant-1' } : options.account;
  const prisma = {
    tradingAccount: {
      findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => (account && account.id === args.where.id && account.tenantId === args.where.tenantId ? account : null)),
      findMany: jest.fn(async () => (account ? [{ id: account.id }] : [])),
    },
    exchangeStreamSession: {
      findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
        if (!options.session) return null;
        return options.session.accountId === args.where.accountId && options.session.tenantId === args.where.tenantId
          ? options.session
          : null;
      }),
    },
  };
  return new ExchangeUserStreamService(prisma as never, options.engine === undefined ? undefined : (options.engine as never));
}

function reader(report: Awaited<ReturnType<EngineStreamReader['readStreamStatus']>>): EngineStreamReader {
  return { readStreamStatus: jest.fn(async () => report) };
}

const session = {
  tenantId: 'tenant-1',
  accountId: 'acct-1',
  status: 'CONNECTED',
  venue: 'BINANCE',
  lastEventAt: new Date(NOW.getTime() - 30_000),
  reconnectCount: 0,
  listenKeyCreatedAt: new Date(NOW.getTime() - 60_000),
};

describe('ExchangeUserStreamService', () => {
  it('reports CONNECTED only when the engine says it is subscribed and events are recent', async () => {
    const service = build({
      session,
      engine: reader({
        subscribed: true,
        lastEventAtMicros: micros(new Date(NOW.getTime() - 10_000)),
        listenKeyAgeMs: 60_000,
        reconnectCount: 0,
      }),
    });

    const health = await service.getHealth({ tenantId: 'tenant-1', accountId: 'acct-1', now: NOW });

    expect(health).toMatchObject({
      state: 'CONNECTED',
      reasonCode: 'SUBSCRIBED_AND_RECENT',
      venue: 'BINANCE',
      engineReported: true,
      reconnectCount: 0,
      lastEventAgeMs: 10_000,
    });
    expect(health!.lastEventAt).toBe(new Date(NOW.getTime() - 10_000).toISOString());
  });

  it('is DEGRADED when the last event is older than the freshness window', async () => {
    const service = build({
      session,
      engine: reader({
        subscribed: true,
        lastEventAtMicros: micros(new Date(NOW.getTime() - USER_STREAM_EVENT_STALE_MS - 1)),
        listenKeyAgeMs: 60_000,
        reconnectCount: 0,
      }),
    });

    const health = await service.getHealth({ tenantId: 'tenant-1', accountId: 'acct-1', now: NOW });
    expect(health).toMatchObject({ state: 'DEGRADED', reasonCode: 'NO_RECENT_EVENTS' });
  });

  it('is DEGRADED when the listen key is near expiry or the stream keeps reconnecting', async () => {
    const nearExpiry = build({
      session,
      engine: reader({
        subscribed: true,
        lastEventAtMicros: micros(new Date(NOW.getTime() - 1_000)),
        listenKeyAgeMs: USER_STREAM_LISTEN_KEY_TTL_MS - 60_000,
        reconnectCount: 0,
      }),
    });
    expect((await nearExpiry.getHealth({ tenantId: 'tenant-1', accountId: 'acct-1', now: NOW }))!.reasonCode)
      .toBe('LISTEN_KEY_NEAR_EXPIRY');

    const flapping = build({
      session,
      engine: reader({
        subscribed: true,
        lastEventAtMicros: micros(new Date(NOW.getTime() - 1_000)),
        listenKeyAgeMs: 60_000,
        reconnectCount: USER_STREAM_RECONNECT_WARN_COUNT + 1,
      }),
    });
    expect((await flapping.getHealth({ tenantId: 'tenant-1', accountId: 'acct-1', now: NOW }))!.reasonCode)
      .toBe('EXCESSIVE_RECONNECTS');
  });

  it('is DISCONNECTED when the engine reports no subscription', async () => {
    const service = build({
      session: { ...session, status: 'DISCONNECTED' },
      engine: reader({
        subscribed: false,
        lastEventAtMicros: micros(new Date(NOW.getTime() - 900_000)),
        listenKeyAgeMs: null,
        reconnectCount: 2,
      }),
    });
    expect((await service.getHealth({ tenantId: 'tenant-1', accountId: 'acct-1', now: NOW }))!.state).toBe('DISCONNECTED');
  });

  it('is UNKNOWN - never CONNECTED - when the engine cannot be reached', async () => {
    const failingEngine: EngineStreamReader = {
      readStreamStatus: jest.fn(async () => { throw new Error('connect ECONNREFUSED'); }),
    };
    const service = build({ session, engine: failingEngine });

    const health = await service.getHealth({ tenantId: 'tenant-1', accountId: 'acct-1', now: NOW });
    expect(health).toMatchObject({ state: 'UNKNOWN', reasonCode: 'ENGINE_UNREACHABLE', engineReported: false });
    // The persisted row says CONNECTED; the answer is still UNKNOWN, because the
    // row is a memory of the last time the engine spoke, not a measurement.
    expect(health!.persistedStatus).toBe('CONNECTED');
    expect(health!.state).not.toBe('CONNECTED');
  });

  it('is UNKNOWN when no engine reader is wired at all', async () => {
    const service = build({ session });
    const health = await service.getHealth({ tenantId: 'tenant-1', accountId: 'acct-1', now: NOW });
    expect(health).toMatchObject({ state: 'UNKNOWN', reasonCode: 'ENGINE_UNREACHABLE' });
  });

  it("returns null for another tenant's account so the controller can 404", async () => {
    const service = build({ session, engine: reader({ subscribed: true, lastEventAtMicros: micros(NOW), listenKeyAgeMs: 1, reconnectCount: 0 }) });
    expect(await service.getHealth({ tenantId: 'tenant-2', accountId: 'acct-1', now: NOW })).toBeNull();
  });

  it('shows a fresh connect with no events yet as CONNECTED rather than stale', () => {
    const classified = classifyUserStream({
      report: { subscribed: true, lastEventAtMicros: null, listenKeyAgeMs: 1_000, reconnectCount: 0 },
      persistedStatus: 'CONNECTING',
      now: NOW,
    });
    expect(classified.state).toBe('CONNECTED');
    expect(classified.reasonCode).toBe('SUBSCRIBED_AND_RECENT');
    expect(classified.lastEventAgeMs).toBeNull();
  });

  it('lists every account of the tenant with the same rules', async () => {
    const service = build({
      session,
      engine: reader({ subscribed: true, lastEventAtMicros: micros(new Date(NOW.getTime() - 1_000)), listenKeyAgeMs: 1_000, reconnectCount: 0 }),
    });
    const rows = await service.listHealth({ tenantId: 'tenant-1', now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: 'acct-1', state: 'CONNECTED' });
  });
});
