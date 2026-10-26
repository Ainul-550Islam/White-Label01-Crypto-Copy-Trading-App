// # Reports the health of one exchange account's private user-data stream: CONNECTED, DEGRADED, DISCONNECTED or UNKNOWN - and UNKNOWN, never CONNECTED, when the engine cannot be reached.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * The private user-data stream is how the platform learns that an order filled
 * without asking the venue. When it dies, orders do not stop - the platform
 * simply stops hearing about them, and a copy-trading customer sees a position
 * that "never filled" while the venue has already taken their money.
 *
 * So the state of that socket is a first-class fact, not a log line:
 *
 *   CONNECTED    - the engine reports a live subscription AND a recent event
 *                  (or a recent successful reconnect with nothing to report).
 *   DEGRADED     - connected but the last event is older than the freshness
 *                  window, or the listen key is close to expiry, or the stream
 *                  has reconnected more than the tolerated count.
 *   DISCONNECTED - the engine reports no subscription, or a closed one.
 *   UNKNOWN      - nobody can tell: the engine is unreachable, its answer is
 *                  malformed, or there is no session row at all.
 *
 * The direction of the last rule is the important one. A health endpoint that
 * reports CONNECTED because the process that would have told it otherwise is
 * down is exactly the endpoint that hides an outage during an outage.
 */

export const EXCHANGE_STREAM_ENGINE_READER = 'EXCHANGE_STREAM_ENGINE_READER';

export type ExchangeStreamState = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'UNKNOWN';

/** What the engine says about one account's stream. */
export interface EngineStreamReport {
  /** The engine's own view: is a socket currently subscribed? */
  subscribed: boolean;
  /** Engine clock, microseconds since epoch, for the last event it saw. */
  lastEventAtMicros: string | null;
  listenKeyAgeMs: number | null;
  reconnectCount: number;
  /** Reserved for a future venue that exposes its queued message depth. */
  droppedEvents?: number | null;
}

export interface EngineStreamReader {
  /**
   * Read the engine's view of one account's stream. MUST throw when the engine
   * cannot be reached: a reader that returns a default on failure is the bug
   * this interface is designed to make visible.
   */
  readStreamStatus(input: { tenantId: string; accountId: string }): Promise<EngineStreamReport>;
}

export interface ExchangeUserStreamHealth {
  tenantId: string;
  accountId: string;
  venue: string | null;
  state: ExchangeStreamState;
  /** Why the state is what it is. A code, because operators grep for these. */
  reasonCode: string;
  /** ISO time of the newest event, from the engine when it answers, else the row. */
  lastEventAt: string | null;
  /** Age of that event in ms, or null when there is none. */
  lastEventAgeMs: number | null;
  reconnectCount: number | null;
  /** Age of the current listen key in ms, or null when the venue has none. */
  listenKeyAgeMs: number | null;
  /** Durable facts as last written by the engine to `exchange_stream_sessions`. */
  persistedStatus: string | null;
  evaluatedAt: string;
  /** True only when the engine answered and the socket is live. Never inferred. */
  engineReported: boolean;
}

/** An event older than this while subscribed means the socket is quiet, not healthy. */
export const USER_STREAM_EVENT_STALE_MS = 5 * 60_000;
/** A listen key within this window of its expiry is renewed too late to be safe. */
export const USER_STREAM_LISTEN_KEY_EXPIRY_WARN_MS = 10 * 60_000;
/** Beyond this many reconnects in a session, something is wrong with the link. */
export const USER_STREAM_RECONNECT_WARN_COUNT = 3;
/** Venues renew listen keys every 30 minutes; the key itself lasts 60. */
export const USER_STREAM_LISTEN_KEY_TTL_MS = 60 * 60_000;

function microsToIso(micros: string | null | undefined): string | null {
  if (typeof micros !== 'string' || !/^\d+$/.test(micros)) return null;
  try {
    return new Date(Number(BigInt(micros) / 1000n)).toISOString();
  } catch {
    return null;
  }
}

/**
 * The classifier, as a pure function so the lifecycle can be tested without a
 * clock, a database or an engine.
 */
export function classifyUserStream(input: {
  report: EngineStreamReport | null;
  persistedStatus: string | null;
  now: Date;
}): { state: ExchangeStreamState; reasonCode: string; lastEventAt: string | null; lastEventAgeMs: number | null } {
  const { report, persistedStatus, now } = input;

  if (report === null) {
    return { state: 'UNKNOWN', reasonCode: 'ENGINE_UNREACHABLE', lastEventAt: null, lastEventAgeMs: null };
  }
  if (!report.subscribed) {
    const lastEventAt = microsToIso(report.lastEventAtMicros);
    return {
      state: 'DISCONNECTED',
      reasonCode: 'NOT_SUBSCRIBED',
      lastEventAt,
      lastEventAgeMs: lastEventAt ? Math.max(0, now.getTime() - Date.parse(lastEventAt)) : null,
    };
  }

  const lastEventAt = microsToIso(report.lastEventAtMicros) ?? null;
  const lastEventAgeMs = lastEventAt === null ? null : Math.max(0, now.getTime() - Date.parse(lastEventAt));

  if (report.reconnectCount > USER_STREAM_RECONNECT_WARN_COUNT) {
    return { state: 'DEGRADED', reasonCode: 'EXCESSIVE_RECONNECTS', lastEventAt, lastEventAgeMs };
  }
  if (report.listenKeyAgeMs !== null && report.listenKeyAgeMs > USER_STREAM_LISTEN_KEY_TTL_MS - USER_STREAM_LISTEN_KEY_EXPIRY_WARN_MS) {
    return { state: 'DEGRADED', reasonCode: 'LISTEN_KEY_NEAR_EXPIRY', lastEventAt, lastEventAgeMs };
  }
  // A freshly connected socket has no event yet; that is not staleness. Anything
  // older than the window while subscribed is.
  if (lastEventAgeMs !== null && lastEventAgeMs > USER_STREAM_EVENT_STALE_MS) {
    return { state: 'DEGRADED', reasonCode: 'NO_RECENT_EVENTS', lastEventAt, lastEventAgeMs };
  }
  if (persistedStatus === 'ERROR' || persistedStatus === 'EXPIRED') {
    return { state: 'DEGRADED', reasonCode: `PERSISTED_${persistedStatus}`, lastEventAt, lastEventAgeMs };
  }
  return { state: 'CONNECTED', reasonCode: 'SUBSCRIBED_AND_RECENT', lastEventAt, lastEventAgeMs };
}

@Injectable()
export class ExchangeUserStreamService {
  private readonly logger = new Logger(ExchangeUserStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(EXCHANGE_STREAM_ENGINE_READER) private readonly engineReader?: EngineStreamReader,
  ) {}

  /**
   * One account's stream health.
   *
   * The account is resolved tenant-first: an account belonging to another tenant
   * is reported as `null` (the controller turns that into a 404) rather than as a
   * stream whose state merely looks unknown. "Not yours" and "we cannot see it"
   * are different answers and must not share a response.
   */
  async getHealth(input: { tenantId: string; accountId: string; now?: Date }): Promise<ExchangeUserStreamHealth | null> {
    const now = input.now ?? new Date();
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: input.accountId, tenantId: input.tenantId, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!account) return null;

    const session = await this.prisma.exchangeStreamSession.findFirst({
      where: { tenantId: input.tenantId, accountId: input.accountId },
      orderBy: { updatedAt: 'desc' },
      select: {
        status: true,
        venue: true,
        lastEventAt: true,
        reconnectCount: true,
        listenKeyCreatedAt: true,
      },
    });

    let report: EngineStreamReport | null = null;
    if (this.engineReader) {
      try {
        report = await this.engineReader.readStreamStatus({ tenantId: input.tenantId, accountId: input.accountId });
      } catch (error) {
        // Deliberately swallowed into UNKNOWN, and logged with the account so a
        // silent engine is visible to an operator even though the response is a
        // state rather than an error.
        this.logger.warn(
          `User stream status unavailable tenant=${input.tenantId} account=${input.accountId}: ${(error as Error)?.message ?? 'unknown error'}`,
        );
        report = null;
      }
    }

    const persistedStatus = session ? String(session.status) : null;
    const classified = classifyUserStream({ report: report ?? null, persistedStatus, now });

    const persistedLastEventAt = session?.lastEventAt ? session.lastEventAt.toISOString() : null;
    const listenKeyAgeMs = report?.listenKeyAgeMs
      ?? (session?.listenKeyCreatedAt ? Math.max(0, now.getTime() - session.listenKeyCreatedAt.getTime()) : null);

    return {
      tenantId: input.tenantId,
      accountId: input.accountId,
      venue: session ? String(session.venue) : null,
      state: classified.state,
      reasonCode: classified.reasonCode,
      lastEventAt: classified.lastEventAt ?? persistedLastEventAt,
      lastEventAgeMs: classified.lastEventAgeMs,
      reconnectCount: report?.reconnectCount ?? (session ? session.reconnectCount : null),
      listenKeyAgeMs,
      persistedStatus,
      evaluatedAt: now.toISOString(),
      engineReported: report !== null,
    };
  }

  /** Every account of one tenant, for the operator table. Same rules, one call. */
  async listHealth(input: { tenantId: string; now?: Date }): Promise<ExchangeUserStreamHealth[]> {
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { tenantId: input.tenantId, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const results: ExchangeUserStreamHealth[] = [];
    for (const account of accounts) {
      const health = await this.getHealth({ tenantId: input.tenantId, accountId: account.id, now: input.now });
      if (health) results.push(health);
    }
    return results;
  }
}
