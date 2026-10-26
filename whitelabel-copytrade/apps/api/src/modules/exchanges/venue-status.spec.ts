// # Proves venue status normalisation, feed-outage-to-UNKNOWN, override precedence and expiry, and that the override route is refused without permission.
import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '@wlct/shared-types';

import { VenueStatusController } from './venue-status.controller';
import { ExchangeVenue } from './exchange.types';
import {
  FEED_SAMPLE_MAX_AGE_MS,
  OVERRIDE_MAX_TTL_SECONDS,
  VenueStatusService,
  type VenueStatusFeed,
  type VenueStatusFeedSample,
} from './venue-status.service';

const TENANT = 'tenant-a';
const ACTOR = { userId: 'operator-1', tenantId: TENANT, sessionId: 'session-1' } as never;

interface Account {
  venue: ExchangeVenue;
  healthState: string;
  connectionState: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    venue: ExchangeVenue.BINANCE,
    healthState: 'HEALTHY',
    connectionState: 'CONNECTED',
    status: 'ACTIVE',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface Harness {
  service: VenueStatusService;
  store: Map<string, string>;
  audit: { recordImmediate: jest.Mock<Promise<void>, unknown[]> };
  feed: VenueStatusFeed | undefined;
}

function harness(options: { accounts?: Account[]; feed?: VenueStatusFeed | 'absent'; store?: Map<string, string> } = {}): Harness {
  const accounts = options.accounts ?? [account()];
  const store = options.store ?? new Map<string, string>();
  const audit = { recordImmediate: jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined) };

  const repository = {
    listByTenant: jest.fn(async (_tenantId: string, filters?: { page?: number; limit?: number }) => {
      const page = filters?.page ?? 1;
      const limit = filters?.limit ?? 20;
      const start = (page - 1) * limit;
      return { data: accounts.slice(start, start + limit), total: accounts.length };
    }),
  };
  const cache = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, String(value));
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };

  const feed = options.feed === 'absent' ? undefined : (options.feed as VenueStatusFeed | undefined);
  const service = new VenueStatusService(
    repository as never,
    cache as never,
    audit as never,
    feed as never,
  );
  return { service, store, audit, feed };
}

function sample(rawStatus: string, overrides: Partial<VenueStatusFeedSample> = {}): VenueStatusFeedSample {
  return {
    venue: ExchangeVenue.BINANCE,
    rawStatus,
    observedAt: new Date().toISOString(),
    since: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

function feedOf(result: VenueStatusFeedSample | null | Error): VenueStatusFeed {
  return {
    read: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function overrideInStore(store: Map<string, string>, payload: Record<string, unknown>): void {
  store.set(`venue:status:override:${ExchangeVenue.BINANCE}`, JSON.stringify(payload));
}

describe('VenueStatusService', () => {
  describe('feed normalisation', () => {
    const table: Array<[string, string]> = [
      ['0', 'OPERATIONAL'],
      ['1', 'MAINTENANCE'],
      ['normal', 'OPERATIONAL'],
      ['OPERATIONAL', 'OPERATIONAL'],
      ['system_busy', 'DEGRADED'],
      ['post-only', 'DEGRADED'],
      ['cancel_only', 'DEGRADED'],
      ['maintenance', 'MAINTENANCE'],
      ['scheduled', 'MAINTENANCE'],
      ['major_outage', 'OUTAGE'],
      ['halted', 'OUTAGE'],
    ];

    it.each(table)('maps %s to %s', async (rawStatus, expected) => {
      const { service } = harness({ feed: feedOf(sample(rawStatus)) });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe(expected);
      expect(view.source).toBe('FEED');
      expect(view.verified).toBe(true);
    });

    it('maps an unrecognised status to UNKNOWN rather than to OPERATIONAL', async () => {
      const { service } = harness({ feed: feedOf(sample('totally_new_state')) });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
      expect(view.reason).toBe('FEED_STATUS_UNRECOGNISED');
      expect(view.verified).toBe(false);
    });

    it('carries the feed message through, bounded', async () => {
      const { service } = harness({
        feed: feedOf(sample('maintenance', { message: 'x'.repeat(500) })),
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.message.length).toBeLessThanOrEqual(300);
    });
  });

  describe('a feed that cannot be believed is UNKNOWN', () => {
    it('a throwing feed is UNKNOWN, never OPERATIONAL', async () => {
      const { service } = harness({ feed: feedOf(new Error('feed 503')) });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
      expect(view.reason).toBe('FEED_UNAVAILABLE');
      expect(view.verified).toBe(false);
    });

    it('a null sample is UNKNOWN', async () => {
      const { service } = harness({ feed: feedOf(null) });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
      expect(view.verified).toBe(false);
    });

    it('a stale sample is UNKNOWN even when it says operational', async () => {
      const stale = new Date(Date.now() - FEED_SAMPLE_MAX_AGE_MS - 60_000).toISOString();
      const { service } = harness({ feed: feedOf(sample('operational', { observedAt: stale })) });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
      expect(view.reason).toBe('FEED_SAMPLE_STALE');
    });

    it('a sample stamped in the future is not trusted', async () => {
      const future = new Date(Date.now() + 60 * 60_000).toISOString();
      const { service } = harness({ feed: feedOf(sample('operational', { observedAt: future })) });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
    });

    it('a sample for another venue is discarded', async () => {
      const { service } = harness({
        feed: feedOf(sample('operational', { venue: ExchangeVenue.OKX })),
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
    });

    it('no configured feed reports UNKNOWN with NO_FEED_CONFIGURED', async () => {
      const { service } = harness({ feed: 'absent' });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
      expect(view.reason).toBe('NO_FEED_CONFIGURED');
      expect(view.source).toBe('NONE');
    });
  });

  describe('account health can only make the answer worse', () => {
    it('an unhealthy account with no feed degrades the venue', async () => {
      const { service } = harness({
        feed: 'absent',
        accounts: [account({ healthState: 'UNAVAILABLE', connectionState: 'DISCONNECTED' })],
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('DEGRADED');
      expect(view.reason).toBe('ACCOUNT_HEALTH_DEGRADED');
      expect(view.source).toBe('ACCOUNT_HEALTH');
    });

    it('a healthy account does not upgrade a failed feed to OPERATIONAL', async () => {
      const { service } = harness({
        accounts: [account({ healthState: 'HEALTHY' })],
        feed: feedOf(new Error('feed down')),
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('UNKNOWN');
      expect(view.source).toBe('FEED');
    });

    it('a healthy account does not override a feed outage', async () => {
      const { service } = harness({
        accounts: [account({ healthState: 'HEALTHY' })],
        feed: feedOf(sample('outage')),
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('OUTAGE');
    });

    it('another venue being down does not touch this one', async () => {
      const { service } = harness({
        feed: feedOf(sample('operational')),
        accounts: [
          account(),
          account({ venue: ExchangeVenue.OKX, healthState: 'UNAVAILABLE', connectionState: 'DISCONNECTED' }),
        ],
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('OPERATIONAL');
    });
  });

  describe('tenant scoping', () => {
    it('reports only the venues this tenant has accounts on', async () => {
      const { service } = harness({
        feed: feedOf(sample('operational')),
        accounts: [account(), account({ venue: ExchangeVenue.OKX })],
      });

      const views = await service.listForTenant(TENANT);

      expect(views.map((view) => view.venue).sort()).toEqual([ExchangeVenue.BINANCE, ExchangeVenue.OKX]);
    });

    it('reports nothing at all for a tenant with no accounts', async () => {
      const { service } = harness({ accounts: [], feed: feedOf(sample('operational')) });

      await expect(service.listForTenant(TENANT)).resolves.toEqual([]);
    });

    it('honours an explicit request even when the tenant has no such account', async () => {
      const { service } = harness({ accounts: [], feed: feedOf(sample('operational')) });

      const views = await service.listForTenant(TENANT, [ExchangeVenue.KRAKEN]);

      expect(views).toHaveLength(1);
      expect(views[0].venue).toBe(ExchangeVenue.KRAKEN);
    });

    it('reads every page of accounts rather than the first page only', async () => {
      const many = Array.from({ length: 205 }, (_, index) =>
        account({ venue: index === 204 ? ExchangeVenue.COINBASE : ExchangeVenue.BINANCE }),
      );
      const { service } = harness({ accounts: many, feed: feedOf(sample('operational')) });

      const views = await service.listForTenant(TENANT);

      expect(views.map((view) => view.venue).sort()).toEqual([ExchangeVenue.BINANCE, ExchangeVenue.COINBASE]);
    });
  });

  describe('operator override', () => {
    it('wins over the feed and is audited immediately', async () => {
      const { service, audit } = harness({ feed: feedOf(sample('outage')) });

      await service.setOverride(ACTOR, {
        venue: ExchangeVenue.BINANCE,
        state: 'OPERATIONAL',
        reason: 'feed is wrong, orders are filling',
        ttlSeconds: 900,
      });
      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.state).toBe('OPERATIONAL');
      expect(view.source).toBe('OVERRIDE');
      expect(view.override?.setBy).toBe('operator-1');
      expect(audit.recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VENUE_STATUS_OVERRIDE_SET', outcome: 'SUCCESS' }),
      );
    });

    it('expires: an elapsed override stops deciding the answer', async () => {
      const { service, store } = harness({ feed: feedOf(sample('outage')) });
      overrideInStore(store, {
        venue: ExchangeVenue.BINANCE,
        state: 'OPERATIONAL',
        reason: 'stale override from last week',
        setBy: 'operator-1',
        setAt: '2026-10-01T00:00:00.000Z',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        revokedAt: null,
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.source).toBe('FEED');
      expect(view.state).toBe('OUTAGE');
      expect(view.override).toBeNull();
    });

    it('refuses an override with no meaningful reason', async () => {
      const { service } = harness();

      await expect(
        service.setOverride(ACTOR, { venue: ExchangeVenue.BINANCE, state: 'OUTAGE', reason: 'down' }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('refuses an override TTL above the ceiling', async () => {
      const { service } = harness();

      await expect(
        service.setOverride(ACTOR, {
          venue: ExchangeVenue.BINANCE,
          state: 'MAINTENANCE',
          reason: 'scheduled venue maintenance',
          ttlSeconds: OVERRIDE_MAX_TTL_SECONDS + 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('refuses UNKNOWN as an asserted state', async () => {
      const { service } = harness();

      await expect(
        service.setOverride(ACTOR, {
          venue: ExchangeVenue.BINANCE,
          state: 'UNKNOWN',
          reason: 'we do not know what is happening',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('clearing removes it and lets the feed decide again', async () => {
      const { service, audit } = harness({ feed: feedOf(sample('degraded')) });
      await service.setOverride(ACTOR, {
        venue: ExchangeVenue.BINANCE,
        state: 'OPERATIONAL',
        reason: 'override to be cleared by the test',
      });

      const cleared = await service.clearOverride(ACTOR, ExchangeVenue.BINANCE);
      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(cleared.cleared).toBe(true);
      expect(view.source).toBe('FEED');
      expect(view.state).toBe('DEGRADED');
      expect(audit.recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'VENUE_STATUS_OVERRIDE_CLEARED' }),
      );
    });

    it('an unreadable store is no override, never an invented one', async () => {
      const { service, store } = harness({ feed: feedOf(sample('operational')) });
      store.set(`venue:status:override:${ExchangeVenue.BINANCE}`, 'not json at all');

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.source).toBe('FEED');
      expect(view.override).toBeNull();
    });

    it('an override stored for another venue is ignored', async () => {
      const { service, store } = harness({ feed: feedOf(sample('operational')) });
      overrideInStore(store, {
        venue: ExchangeVenue.OKX,
        state: 'OUTAGE',
        reason: 'stored under the wrong key by a bad writer',
        setBy: 'operator-1',
        setAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        revokedAt: null,
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.source).toBe('FEED');
    });
  });

  describe('the status view itself', () => {
    it('always carries a machine-readable reason and a message', async () => {
      const { service } = harness({ feed: feedOf(sample('operational')) });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.messageCode).toBe(view.reason);
      expect(view.message.length).toBeGreaterThan(0);
      expect(Date.parse(view.checkedAt)).toBeGreaterThan(0);
      expect(Date.parse(view.since)).toBeGreaterThan(0);
    });

    it('reports since from the feed when the feed says when', async () => {
      const { service } = harness({
        feed: feedOf(sample('maintenance', { since: '2026-10-20T08:00:00.000Z' })),
      });

      const view = await service.statusFor(TENANT, ExchangeVenue.BINANCE);

      expect(view.since).toBe('2026-10-20T08:00:00.000Z');
    });
  });
});

describe('VenueStatusController', () => {
  it('rejects an unknown venue with a 400 rather than defaulting to any venue', async () => {
    const controller = new VenueStatusController({ statusFor: jest.fn() } as never);

    await expect(controller.one(TENANT, 'not_a_venue')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown venue in the list filter', async () => {
    const controller = new VenueStatusController({ listForTenant: jest.fn() } as never);

    await expect(controller.list(TENANT, 'BINANCE,NOPE')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('takes the tenant from the resolved principal, never from the query', async () => {
    const listForTenant = jest.fn().mockResolvedValue([]);
    const controller = new VenueStatusController({ listForTenant } as never);

    await controller.list(TENANT, undefined);

    expect(listForTenant).toHaveBeenCalledWith(TENANT, undefined);
  });

  it('the admin override is guarded by a platform permission and a step-up action', async () => {
    // The decorators ARE the gate, so they are read exactly the way the guards
    // read them: by metadata key, from the handler. A refactor that drops one of
    // them must fail here rather than in production.
    const { VenueStatusAdminController } = await import('./venue-status-admin.controller');
    const { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } = await import('../../common/constants/metadata.constants');
    const { REQUIRE_STEP_UP_KEY } = await import('../auth/step-up/require-step-up.decorator');

    for (const handler of [VenueStatusAdminController.prototype.set, VenueStatusAdminController.prototype.clear]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['platform:manage']);
      expect(Reflect.getMetadata(PERMISSIONS_MODE_KEY, handler)).toBe('all');
      expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, handler)).toBe('VENUE_STATUS_OVERRIDE');
    }

    // The customer reads are permission-decorated too, and are NOT step-up gated:
    // needing a TOTP code to see whether a venue is up would be a lock on the
    // fire exit.
    for (const handler of [VenueStatusController.prototype.list, VenueStatusController.prototype.one]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
        'exchange_account:read',
        'execution:read',
        'order:read',
      ]);
      expect(Reflect.getMetadata(PERMISSIONS_MODE_KEY, handler)).toBe('any');
      expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, handler)).toBeUndefined();
    }
  });
});
