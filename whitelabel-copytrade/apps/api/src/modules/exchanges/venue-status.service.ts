// # Merges the venue's public status feed, this tenant's account health and an expiring manual override into one normalised venue status where an unreachable feed is UNKNOWN and never OPERATIONAL.
import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import {
  AuditActorType,
  AuditOutcome,
  ErrorCode,
  type AuthenticatedActor,
} from '@wlct/shared-types';

import { RedisService } from '../../infrastructure/redis/redis.service';
import { AppException } from '../../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import {
  ExchangeAccountRepository,
  type ExchangeAccountRecord,
} from './exchange-account.repository';
import {
  ExchangeAccountState,
  ExchangeConnectionState,
  ExchangeHealthState,
  ExchangeVenue,
} from './exchange.types';

/**
 * Venue status, normalised.
 *
 * WHY THIS IS NOT A PASS-THROUGH OF THE VENUE'S OWN PAGE
 * -----------------------------------------------------
 * A copy-trading customer needs one answer: "can the venue my leader trades on
 * take my orders right now". That answer has three inputs and none of them is
 * sufficient alone:
 *
 *   1. the venue's public status feed - authoritative about the venue, but it
 *      has no idea whether *our* key works, our clock is skewed, or our own
 *      user stream died;
 *   2. this tenant's account health - authoritative about us, but a healthy
 *      connection to a venue that is down is still a venue that is down;
 *   3. an operator's manual override - necessary when the feed lags (it does:
 *      exchanges announce maintenance minutes-to-hours late) and when the feed
 *      itself is the broken thing.
 *
 * An override wins, then the feed determines the venue state. Account health
 * can downgrade an otherwise operational feed but cannot upgrade it.
 *
 * THE RULE THAT MATTERS MOST
 * --------------------------
 * A feed that cannot be read is `UNKNOWN`. It is NEVER `OPERATIONAL`. The
 * distinction is the entire value of this surface: "we could not check" and
 * "everything is fine" produce the same silent screen if they are allowed to
 * collapse, and the banner that is supposed to warn a customer would then be
 * absent exactly when the monitoring is broken. The same rule applies to an
 * unrecognised status string from the feed: a venue that has invented a new
 * state in its payload is not thereby operating normally.
 *
 * Everything is bounded: an override carries an expiry (a `PUT` without one is
 * refused), and the account-health contribution is computed from the same rows
 * the dashboard uses, so this service never invents a probe of its own.
 */

/** The normalised vocabulary. Nothing else may leave this service. */
export type VenueOperationalState =
  | 'OPERATIONAL'
  | 'DEGRADED'
  | 'MAINTENANCE'
  | 'OUTAGE'
  | 'UNKNOWN';

/**
 * Machine-readable reasons. The UI maps these to sentences, so a code is a
 * contract; the `message` beside it is never the thing a client branches on.
 */
export type VenueStatusReason =
  | 'FEED_REPORTS_OPERATIONAL'
  | 'FEED_REPORTS_DEGRADED'
  | 'FEED_REPORTS_MAINTENANCE'
  | 'FEED_REPORTS_OUTAGE'
  | 'FEED_UNAVAILABLE'
  | 'FEED_STATUS_UNRECOGNISED'
  | 'FEED_SAMPLE_STALE'
  | 'MANUAL_OVERRIDE'
  | 'MANUAL_OVERRIDE_EXPIRED'
  | 'NO_FEED_CONFIGURED'
  | 'ACCOUNT_HEALTH_DEGRADED'
  | 'NO_SIGNAL';

export interface VenueStatusView {
  venue: ExchangeVenue;
  state: VenueOperationalState;
  reason: VenueStatusReason;
  /** When the state began, as far as the winning source knows. */
  since: string;
  messageCode: VenueStatusReason;
  /** Operator-facing sentence. Optional: a client that ignored it stays correct. */
  message: string;
  /** Which input decided this answer. */
  source: 'OVERRIDE' | 'FEED' | 'ACCOUNT_HEALTH' | 'NONE';
  /** False when the answer rests on no first-party evidence at all. */
  verified: boolean;
  /** The override in force, when one is; `null` otherwise. */
  override: VenueStatusOverride | null;
  checkedAt: string;
}

export interface VenueStatusOverride {
  venue: ExchangeVenue;
  state: VenueOperationalState;
  reason: string;
  setBy: string;
  setAt: string;
  expiresAt: string;
  /** Null when the operator removed it early. */
  revokedAt: string | null;
}

/** One sample from a venue's public status feed, already reduced. */
export interface VenueStatusFeedSample {
  venue: ExchangeVenue;
  /** The venue's own vocabulary, unmapped. Mapping is this service's job. */
  rawStatus: string;
  /** Optional human message from the feed. */
  message?: string | null;
  /** When the feed says the status began. */
  since?: string | null;
  /** When the sample was taken (age is checked against the staleness bound). */
  observedAt: string;
}

/**
 * The port a venue feed adapter implements. Deliberately narrow: one method, one
 * venue, `null` for "no sample". A thrown error and a `null` are treated the
 * same on purpose - from here both mean "no usable evidence", and pretending to
 * distinguish them would invite a caller to treat one as OPERATIONAL.
 */
export interface VenueStatusFeed {
  read(venue: ExchangeVenue): Promise<VenueStatusFeedSample | null>;
}

export const VENUE_STATUS_FEED = Symbol('VENUE_STATUS_FEED');

/** How long a feed sample may be believed. Longer than a probe interval, short
 * enough that a dead feed cannot report yesterday's maintenance as today's. */
export const FEED_SAMPLE_MAX_AGE_MS = 10 * 60_000;

/** The override ceiling. An override longer than this is a standing lie. */
export const OVERRIDE_MAX_TTL_SECONDS = 24 * 60 * 60;
export const OVERRIDE_DEFAULT_TTL_SECONDS = 2 * 60 * 60;

const OVERRIDE_KEY = (venue: string): string => `venue:status:override:${venue}`;

/**
 * The venue vocabularies, mapped onto ours.
 *
 * Only strings this platform has actually seen are listed. An unmapped string
 * is `UNKNOWN` with `FEED_STATUS_UNRECOGNISED`, which is the honest answer: the
 * venue knows something we do not, and a default of OPERATIONAL would turn our
 * ignorance into a customer-facing reassurance.
 */
const FEED_STATUS_MAP: Readonly<Record<string, VenueOperationalState>> = Object.freeze({
  // Binance (~ systemStatus: 0 normal, 1 maintenance)
  '0': 'OPERATIONAL',
  '1': 'MAINTENANCE',
  normal: 'OPERATIONAL',
  maintenance: 'MAINTENANCE',
  system_busy: 'DEGRADED',
  partial_outage: 'DEGRADED',
  major_outage: 'OUTAGE',
  // Bybit / OKX / Kraken / Coinbase style sentences
  operational: 'OPERATIONAL',
  online: 'OPERATIONAL',
  active: 'OPERATIONAL',
  trading: 'OPERATIONAL',
  post_only: 'DEGRADED',
  cancel_only: 'DEGRADED',
  maintenance_mode: 'MAINTENANCE',
  scheduled: 'MAINTENANCE',
  degraded: 'DEGRADED',
  degraded_performance: 'DEGRADED',
  partial_maintenance: 'MAINTENANCE',
  outage: 'OUTAGE',
  down: 'OUTAGE',
  unavailable: 'OUTAGE',
  halted: 'OUTAGE',
});

const STATE_SEVERITY: Readonly<Record<VenueOperationalState, number>> = Object.freeze({
  OPERATIONAL: 0,
  UNKNOWN: 1,
  DEGRADED: 2,
  MAINTENANCE: 3,
  OUTAGE: 4,
});

const MESSAGE: Readonly<Record<VenueStatusReason, string>> = Object.freeze({
  FEED_REPORTS_OPERATIONAL: 'The venue reports normal operation.',
  FEED_REPORTS_DEGRADED: 'The venue reports degraded performance.',
  FEED_REPORTS_MAINTENANCE: 'The venue is in maintenance.',
  FEED_REPORTS_OUTAGE: 'The venue reports an outage.',
  FEED_UNAVAILABLE: 'The venue status feed could not be read, so the venue state is unknown.',
  FEED_STATUS_UNRECOGNISED: 'The venue reported a state this platform does not recognise.',
  FEED_SAMPLE_STALE: 'The venue status feed has not produced a sample recently.',
  MANUAL_OVERRIDE: 'An operator has set this venue state.',
  MANUAL_OVERRIDE_EXPIRED: 'An operator override has expired; the feed is being used again.',
  NO_FEED_CONFIGURED: 'No venue status feed is wired in this deployment.',
  ACCOUNT_HEALTH_DEGRADED: 'This account’s connection to the venue is not healthy.',
  NO_SIGNAL: 'No evidence is available about this venue.',
});

@Injectable()
export class VenueStatusService {
  private readonly logger = new Logger(VenueStatusService.name);

  constructor(
    private readonly accounts: ExchangeAccountRepository,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Optional() @Inject(VENUE_STATUS_FEED) private readonly feed?: VenueStatusFeed | null,
  ) {}

  /**
   * Status for one tenant's venues.
   *
   * `requested` narrows the result; omitting it answers for every venue this
   * tenant has an account on, which is exactly the set a customer's trading
   * screens can be blocked by. A venue nobody in this tenant uses is not
   * reported at all: a banner about Kraken in front of a Binance-only tenant is
   * noise that trains people to ignore the banner.
   */
  async listForTenant(tenantId: string, requested?: readonly ExchangeVenue[]): Promise<VenueStatusView[]> {
    // A failed account read is not an empty venue list.
    const accounts = await this.loadAccounts(tenantId);
    const venues = requested && requested.length > 0
      ? [...new Set(requested)]
      : [...new Set(accounts.map((account) => account.venue))];
    const views: VenueStatusView[] = [];
    for (const venue of venues) {
      views.push(await this.statusFor(tenantId, venue));
    }
    return views;
  }

  /** One venue, for one tenant. */
  async statusFor(tenantId: string, venue: ExchangeVenue): Promise<VenueStatusView> {
    const now = new Date();
    const override = await this.readOverride(venue);
    const feedSample = await this.readFeed(venue);
    const accountHealth = await this.tenantAccountSignal(tenantId, venue);

    const base: Omit<VenueStatusView, 'state' | 'reason' | 'since' | 'messageCode' | 'message' | 'source' | 'verified'> = {
      venue,
      override: override.override,
      checkedAt: now.toISOString(),
    };

    // 1. A live override wins outright, including when it says OPERATIONAL: an
    //    operator who has confirmed "the feed is wrong, the venue is fine" is the
    //    one case where a human beats the feed in the permissive direction, and
    //    the audit row is what makes that reviewable.
    if (override.override) {
      return {
        ...base,
        state: override.override.state,
        reason: 'MANUAL_OVERRIDE',
        since: override.override.setAt,
        messageCode: 'MANUAL_OVERRIDE',
        message: override.override.reason || MESSAGE.MANUAL_OVERRIDE,
        source: 'OVERRIDE',
        verified: true,
      };
    }

    // 2. The feed.
    const feedVerdict = ((): { state: VenueOperationalState; reason: VenueStatusReason; since: string } | null => {
      if (!this.feed) return null;
      if (!feedSample) return null;
      if (!this.isFresh(feedSample, now)) {
        return {
          state: 'UNKNOWN',
          reason: 'FEED_SAMPLE_STALE',
          since: feedSample.observedAt,
        };
      }
      const mapped = this.normaliseFeedStatus(feedSample.rawStatus);
      if (!mapped) {
        return {
          state: 'UNKNOWN',
          reason: 'FEED_STATUS_UNRECOGNISED',
          since: feedSample.observedAt,
        };
      }
      return {
        state: mapped,
        reason: this.reasonForState(mapped),
        since: feedSample.since ?? feedSample.observedAt,
      };
    })();

    if (feedVerdict?.state === 'OPERATIONAL' && accountHealth.degraded) {
      return {
        ...base,
        state: 'DEGRADED',
        reason: 'ACCOUNT_HEALTH_DEGRADED',
        since: accountHealth.since,
        messageCode: 'ACCOUNT_HEALTH_DEGRADED',
        message: MESSAGE.ACCOUNT_HEALTH_DEGRADED,
        source: 'ACCOUNT_HEALTH',
        verified: true,
      };
    }

    if (feedVerdict) {
      // A feed that says OPERATIONAL but whose own sample is stale is UNKNOWN, and
      // it stays UNKNOWN even if our account looks healthy: "we could not check"
      // must not be upgraded by a different signal's optimism.
      return {
        ...base,
        state: feedVerdict.state,
        reason: feedVerdict.reason,
        since: feedVerdict.since,
        messageCode: feedVerdict.reason,
        message: feedSample?.message?.slice(0, 300) || MESSAGE[feedVerdict.reason],
        source: 'FEED',
        verified: feedVerdict.reason !== 'FEED_STATUS_UNRECOGNISED' && feedVerdict.reason !== 'FEED_SAMPLE_STALE',
      };
    }

    // 3. Account health, which can only ever make things worse than UNKNOWN, never
    //    better: a working socket to a venue is not evidence the venue is healthy.
    if (accountHealth.degraded) {
      return {
        ...base,
        state: 'DEGRADED',
        reason: 'ACCOUNT_HEALTH_DEGRADED',
        since: accountHealth.since,
        messageCode: 'ACCOUNT_HEALTH_DEGRADED',
        message: MESSAGE.ACCOUNT_HEALTH_DEGRADED,
        source: 'ACCOUNT_HEALTH',
        verified: true,
      };
    }

    const reason: VenueStatusReason = this.feed ? 'FEED_UNAVAILABLE' : 'NO_FEED_CONFIGURED';
    return {
      ...base,
      state: 'UNKNOWN',
      reason,
      since: base.checkedAt,
      messageCode: reason,
      message: MESSAGE[reason],
      source: this.feed ? 'FEED' : 'NONE',
      verified: false,
    };
  }

  /**
   * Set or replace an operator override.
   *
   * The expiry is mandatory and bounded. An override with no expiry is a
   * permanent lie about a venue, and the failure mode is not hypothetical: it
   * outlives the incident, outlives the operator's memory of it, and is
   * discovered by a customer whose orders were refused for a maintenance window
   * that ended last week.
   */
  async setOverride(
    actor: AuthenticatedActor,
    input: {
      venue: ExchangeVenue;
      state: VenueOperationalState;
      reason: string;
      ttlSeconds?: number;
      requestId?: string;
      ipHash?: string;
    },
  ): Promise<VenueStatusOverride> {
    const ttl = input.ttlSeconds ?? OVERRIDE_DEFAULT_TTL_SECONDS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > OVERRIDE_MAX_TTL_SECONDS) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `An override must expire within ${OVERRIDE_MAX_TTL_SECONDS} seconds.`,
      });
    }
    const reason = (input.reason ?? '').trim();
    if (reason.length < 8) {
      // A one-word reason ("down") is indistinguishable from a stale override
      // after the fact; the audit trail is the only thing that survives it.
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'An override needs a reason of at least 8 characters.',
      });
    }
    if (input.state === 'UNKNOWN') {
      // "Unknown" is the absence of evidence, not a state an operator can assert.
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'UNKNOWN cannot be set as an override; remove the override instead.',
      });
    }

    const now = new Date();
    const override: VenueStatusOverride = {
      venue: input.venue,
      state: input.state,
      reason: reason.slice(0, 300),
      setBy: actor.userId,
      setAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1_000).toISOString(),
      revokedAt: null,
    };
    // This override is the source of truth, not an optional cache. CacheService
    // deliberately swallows failures, so use Redis directly and fail the write.
    // Preserve the historic double-JSON encoding for rolling deployments.
    await this.redis.client.set(OVERRIDE_KEY(input.venue), JSON.stringify(JSON.stringify(override)), 'EX', ttl);
    // Awaited, not buffered: an override is a platform-wide assertion about a
    // venue, and "the audit row will follow in a second" is not good enough for
    // the one action that can silence a customer-facing warning.
    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: 'VENUE_STATUS_OVERRIDE_SET',
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Venue',
      resourceId: input.venue,
      description: `Venue status override set to ${input.state}.`,
      requestId: input.requestId ?? null,
      ipHash: input.ipHash ?? null,
      metadata: { state: input.state, reason: override.reason, expiresAt: override.expiresAt },
    });
    return override;
  }

  /** Remove an override before its expiry. */
  async clearOverride(
    actor: AuthenticatedActor,
    venue: ExchangeVenue,
    context: { requestId?: string; ipHash?: string } = {},
  ): Promise<{ cleared: boolean }> {
    const existing = await this.readOverride(venue);
    await this.redis.client.del(OVERRIDE_KEY(venue));
    if (existing.override) {
      await this.audit.recordImmediate({
        tenantId: actor.tenantId,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: 'VENUE_STATUS_OVERRIDE_CLEARED',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Venue',
        resourceId: venue,
        description: 'Venue status override cleared.',
        requestId: context.requestId ?? null,
        ipHash: context.ipHash ?? null,
        metadata: { state: existing.override.state, setBy: existing.override.setBy },
      });
    }
    return { cleared: Boolean(existing.override) };
  }

  /** An unreadable or corrupt override is unknown, not evidence of no halt. */
  private async readOverride(venue: ExchangeVenue): Promise<{ override: VenueStatusOverride | null }> {
    try {
      const raw = await this.redis.client.get(OVERRIDE_KEY(venue));
      if (raw === null) return { override: null };
      const stored: unknown = JSON.parse(raw);
      const parsed = (typeof stored === 'string' ? JSON.parse(stored) : stored) as VenueStatusOverride;
      if (!parsed || parsed.venue !== venue || !this.isOverState(parsed.state) ||
          typeof parsed.expiresAt !== 'string' || !Number.isFinite(Date.parse(parsed.expiresAt))) {
        throw new Error('Invalid stored venue override');
      }
      if (parsed.revokedAt || Date.parse(parsed.expiresAt) <= Date.now()) return { override: null };
      return { override: parsed };
    } catch (error) {
      this.logger.warn(`Venue override store unreadable for ${venue}: ${(error as Error)?.message ?? 'unknown error'}`);
      throw new ServiceUnavailableException('Venue status is temporarily unavailable.');
    }
  }

  private async readFeed(venue: ExchangeVenue): Promise<VenueStatusFeedSample | null> {
    if (!this.feed) return null;
    try {
      const sample = await this.feed.read(venue);
      if (!sample || sample.venue !== venue) return null;
      if (typeof sample.rawStatus !== 'string' || typeof sample.observedAt !== 'string') return null;
      return sample;
    } catch (error) {
      // Treated exactly like "no sample": the fall-through lands on UNKNOWN.
      this.logger.warn(`Venue status feed failed for ${venue}: ${(error as Error)?.message ?? 'unknown error'}`);
      return null;
    }
  }

  /**
   * This tenant's own connection health, reduced to "is anything degraded".
   *
   * Read from the account rows the dashboard already uses rather than by probing
   * here: one probe per venue per page render is how a status surface becomes an
   * outage of its own.
   */
  private async tenantAccountSignal(
    tenantId: string,
    venue: ExchangeVenue,
  ): Promise<{ degraded: boolean; since: string }> {
    try {
      const accounts = await this.loadAccounts(tenantId);
      const forVenue = accounts.filter((account) => account.venue === venue);
      // Only states that mean "this connection cannot trade". A `REVOKED`
      // account is a deliberate operator action, not a venue problem, and
      // reporting it as a degraded venue would send a customer to a status page
      // for something they can fix themselves.
      const unhealthy = forVenue.filter(
        (account) =>
          account.healthState === ExchangeHealthState.UNAVAILABLE ||
          account.healthState === ExchangeHealthState.DEGRADED ||
          account.healthState === ExchangeHealthState.AUTH_FAILED ||
          account.connectionState === ExchangeConnectionState.DISCONNECTED ||
          account.connectionState === ExchangeConnectionState.FAILED ||
          account.status === ExchangeAccountState.ERROR,
      );
      const since = unhealthy
        .map((account) => new Date(account.updatedAt ?? account.createdAt).toISOString())
        .sort()[0];
      return { degraded: unhealthy.length > 0, since: since ?? new Date().toISOString() };
    } catch (error) {
      this.logger.warn(`Tenant account health unreadable for ${tenantId}: ${(error as Error)?.message ?? 'unknown error'}`);
      throw new ServiceUnavailableException('Venue status is temporarily unavailable.');
    }
  }

  /**
   * The tenant's accounts, flattened.
   *
   * `listByTenant` paginates (default 20). A status surface that silently looked
   * at the first page would report "no venue" for a tenant whose only Binance
   * account is the 21st, so every page is read - bounded, because a tenant with
   * thousands of exchange accounts is a data problem, not a status problem.
   */
  private async loadAccounts(tenantId: string): Promise<ExchangeAccountRecord[]> {
    const pageSize = 100;
    const collected: ExchangeAccountRecord[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const result = await this.accounts.listByTenant(tenantId, { page, limit: pageSize });
      collected.push(...result.data);
      if (result.data.length < pageSize || collected.length >= result.total) {
        if (collected.length < result.total) {
          throw new ServiceUnavailableException('Venue status is temporarily unavailable.');
        }
        return collected;
      }
    }
    // Do not silently drop venues beyond the bounded scan.
    throw new ServiceUnavailableException('Venue status is temporarily unavailable.');
  }

  private isFresh(sample: VenueStatusFeedSample, now: Date): boolean {
    const observed = Date.parse(sample.observedAt);
    if (!Number.isFinite(observed)) return false;
    const age = now.getTime() - observed;
    // A future timestamp is as untrustworthy as a stale one.
    return age >= 0 && age <= FEED_SAMPLE_MAX_AGE_MS;
  }

  private normaliseFeedStatus(raw: string): VenueOperationalState | null {
    const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return FEED_STATUS_MAP[key] ?? null;
  }

  private reasonForState(state: VenueOperationalState): VenueStatusReason {
    switch (state) {
      case 'OPERATIONAL':
        return 'FEED_REPORTS_OPERATIONAL';
      case 'DEGRADED':
        return 'FEED_REPORTS_DEGRADED';
      case 'MAINTENANCE':
        return 'FEED_REPORTS_MAINTENANCE';
      case 'OUTAGE':
        return 'FEED_REPORTS_OUTAGE';
      default:
        return 'NO_SIGNAL';
    }
  }

  private isOverState(value: unknown): value is VenueOperationalState {
    return typeof value === 'string' && (value === 'UNKNOWN' || value in STATE_SEVERITY);
  }
}
