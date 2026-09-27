/**
 * Part 20 — the `/status` mirror is a parser, not a preference.
 *
 * These tests are the reason the table in `engine-status-contract.ts` can be trusted:
 * a required key that arrives absent is a refusal naming the key, an optional key that
 * arrives absent is the engine's documented "too old to answer" value, and a key that
 * arrives with the wrong type is a refusal even when a lax reader could have coerced it.
 * The last law is the one a `String(x ?? '')`-style reader breaks silently, and it is
 * the reason the whole file exists.
 */

import {
  ENGINE_STATUS_KEYS,
  EngineStatusShapeError,
  parseEngineStatus,
} from './engine-status-contract';

/** The smallest reply a real engine can send: the eight keys `StatusResponse` declares
 * without a default. Every other key in these tests is either absent (and must read as
 * the documented default) or present (and must be checked). */
const requiredOnly = (): Record<string, unknown> => ({
  instanceId: 'exec-a',
  mode: 'simulated',
  dryRun: true,
  adapter: 'PaperTradingAdapter',
  store: 'InMemoryOrderStore',
  storeDurable: false,
  locksDistributed: false,
  commands: ['cancel-order'],
});

describe('engine status contract - the required eight', () => {
  it('reads a required-only reply without inventing a single value', () => {
    const status = parseEngineStatus(requiredOnly());
    expect(status.mode).toBe('simulated');
    expect(status.commands).toEqual(['cancel-order']);
    // The Part 13/14/15/16/18/19 additions all read as "this engine did not say".
    expect(status.storeBackend).toBe('unknown');
    expect(status.retentionEnabled).toBe(false);
    expect(status.retentionEventDays).toBe(90);
    expect(status.enablementMaxAgeDays).toBe(30);
    expect(status.credentialSource).toBe('none');
    expect(status.credentialFetcher).toBeNull();
    expect(status.operatorConfirmation).toBe(false);
    expect(status.liveEnablement).toBeNull();
    expect(status.placement).toBeNull();
    expect(status.incidents).toBeNull();
    expect(status.metricsConfigured).toBe(false);
    expect(status.simulated).toBe(true);
  });

  it('refuses a missing required key by name, for every one of the eight', () => {
    for (const key of [
      'instanceId',
      'mode',
      'dryRun',
      'adapter',
      'store',
      'storeDurable',
      'locksDistributed',
      'commands',
    ]) {
      const body = requiredOnly();
      delete body[key];
      let thrown: unknown = null;
      try {
        parseEngineStatus(body);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EngineStatusShapeError);
      expect((thrown as EngineStatusShapeError).field).toBe(key);
      expect((thrown as EngineStatusShapeError).why).toBe('missing');
      // The message is operator-facing: it must say what to do about it, not just
      // that something failed.
      expect((thrown as Error).message).toMatch(/older than the contract/);
    }
  });

  it('refuses a wrongly typed required key rather than coercing it', () => {
    for (const [key, value] of [
      ['mode', 7],
      ['dryRun', 'true'],
      ['commands', 'cancel-order'],
      ['storeDurable', 1],
    ] as const) {
      const body = { ...requiredOnly(), [key]: value };
      expect(() => parseEngineStatus(body)).toThrow(EngineStatusShapeError);
      try {
        parseEngineStatus(body);
      } catch (error) {
        expect((error as EngineStatusShapeError).why).toBe('type');
        expect((error as EngineStatusShapeError).field).toBe(key);
      }
    }
  });

  it('a null in place of a required string is a refusal, not an empty string', () => {
    // `String(body.instanceId ?? '')` - the reader this part replaced - accepted this
    // and reported an engine with no identity.
    expect(() => parseEngineStatus({ ...requiredOnly(), instanceId: null })).toThrow(
      EngineStatusShapeError,
    );
  });
});

describe('engine status contract - optional keys keep their documented meaning', () => {
  it('a wrong type on an optional key is still a refusal', () => {
    // Absent means "too old to answer". Present-and-wrong means the engine is lying
    // about something the reader will act on, so it cannot be defaulted away.
    for (const [key, value] of [
      ['retentionEventDays', '90'],
      ['credentialSource', null],
      ['metricsConfigured', 'yes'],
      ['simulated', 1],
    ] as const) {
      expect(() => parseEngineStatus({ ...requiredOnly(), [key]: value })).toThrow(
        EngineStatusShapeError,
      );
    }
  });

  it('a non-array commands is refused even though Array.isArray would have hidden it', () => {
    expect(() => parseEngineStatus({ ...requiredOnly(), commands: { a: 1 } })).toThrow(
      EngineStatusShapeError,
    );
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), commands: ['ok', 3] }),
    ).toThrow(/expected stringArray/);
  });
});

describe('engine status contract - the three sub-documents', () => {
  const placement = {
    label: 'placement-review',
    mode: 'local',
    requiresVenueAttestation: false,
    cacheTtlMillis: 5_000,
    attestorSource: 'unattested',
    policy: { requireOperatorConfirmation: false },
  };

  it('parses a placement block and defaults its three optional keys', () => {
    const status = parseEngineStatus({ ...requiredOnly(), placement });
    expect(status.placement).not.toBeNull();
    expect(status.placement?.attestorSource).toBe('unattested');
    expect(status.placement?.cache).toBeNull();
    expect(status.placement?.confirmationConfigured).toBe(false);
    expect(status.placement?.operatorConfirmation).toEqual({});
  });

  it('refuses a placement block missing one of its own required keys', () => {
    const broken = { ...placement } as Record<string, unknown>;
    delete broken.requiresVenueAttestation;
    let thrown: EngineStatusShapeError | null = null;
    try {
      parseEngineStatus({ ...requiredOnly(), placement: broken });
    } catch (error) {
      thrown = error as EngineStatusShapeError;
    }
    expect(thrown).toBeInstanceOf(EngineStatusShapeError);
    // The nested path is named, so the reader learns WHICH half of the engine
    // answered badly rather than "placement is wrong".
    expect(thrown?.field).toBe('placement.requiresVenueAttestation');
  });

  it('tells the two same-named keys apart: top-level bool, nested dict', () => {
    expect(ENGINE_STATUS_KEYS).toContain('operatorConfirmation');
    const bare = parseEngineStatus(requiredOnly());
    expect(bare.operatorConfirmation).toBe(false);
    const withView = parseEngineStatus({
      ...requiredOnly(),
      operatorConfirmation: true,
      placement: { ...placement, operatorConfirmation: { windowMillis: 60_000 } },
    });
    expect(withView.operatorConfirmation).toBe(true);
    expect(withView.placement?.operatorConfirmation).toEqual({ windowMillis: 60_000 });
    // A bool where a dict belongs, and vice versa, are both refusals: this is the
    // collision the contract module warns about in its own comment.
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), placement: { ...placement, operatorConfirmation: true } }),
    ).toThrow(EngineStatusShapeError);
    expect(() => parseEngineStatus({ ...requiredOnly(), operatorConfirmation: {} })).toThrow(
      EngineStatusShapeError,
    );
  });

  it('parses the live-enablement block and refuses a fabricated permission', () => {
    const status = parseEngineStatus({
      ...requiredOnly(),
      liveEnablement: {
        liveRefused: true,
        missing: ['SIGNED_TRANSPORT_WIRED'],
        satisfied: ['IP_ALLOWLIST_ENFORCED'],
        missingCodes: ['LIVE_SIGNED_TRANSPORT_WIRED'],
        hardBlockersPresent: true,
        credentialSource: 'vault',
      },
    });
    expect(status.liveEnablement?.missing).toEqual(['SIGNED_TRANSPORT_WIRED']);
    expect(status.liveEnablement?.credentialSource).toBe('vault');
    // A string where a list belongs would let a producer's mistake read as "nothing
    // is missing", which is the one thing this block must never appear to say.
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), liveEnablement: { liveRefused: true, missing: 'none' } }),
    ).toThrow(/liveEnablement.missing/);
  });

  it('parses the incident sink and its default-empty stats', () => {
    const status = parseEngineStatus({
      ...requiredOnly(),
      incidents: { durable: true, sink: 'postgres' },
    });
    expect(status.incidents).toEqual({ durable: true, sink: 'postgres', stats: {} });
    expect(() =>
      parseEngineStatus({ ...requiredOnly(), incidents: { durable: 'yes', sink: 'postgres' } }),
    ).toThrow(/incidents.durable/);
  });

  it('refuses a sub-document that arrives as an array or a scalar', () => {
    for (const value of [[], 'placement', 3] as const) {
      expect(() => parseEngineStatus({ ...requiredOnly(), placement: value })).toThrow(
        /expected an object at "placement"/,
      );
    }
  });
});

describe('engine status contract - what the engine starts saying later', () => {
  it('tolerates an unknown key and reports it instead of dropping it', () => {
    const status = parseEngineStatus({ ...requiredOnly(), zetaNewFact: 1, alphaNewFact: 2 });
    expect(status.unmappedKeys).toEqual(['alphaNewFact', 'zetaNewFact']);
    expect(status.mode).toBe('simulated');
  });

  it('reports nothing unmapped for a contract-shaped reply', () => {
    expect(parseEngineStatus(requiredOnly()).unmappedKeys).toEqual([]);
  });

  it('refuses a body that is not an object at all (the proxy-page case)', () => {
    for (const body of ['<html>502</html>', null, [], 42] as const) {
      expect(() => parseEngineStatus(body)).toThrow(EngineStatusShapeError);
    }
  });

  it('is a frozen result, so a panel cannot edit the mirror into a different answer', () => {
    const status = parseEngineStatus(requiredOnly());
    expect(Object.isFrozen(status)).toBe(true);
    expect(() => {
      (status as { mode: string }).mode = 'live';
    }).toThrow(TypeError);
  });
});
