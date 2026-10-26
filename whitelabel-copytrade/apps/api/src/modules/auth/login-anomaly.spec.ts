// # Responsibility: prove each login-anomaly rule fires on its boundary, never on a repeated known device, and never persists a raw address.
import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  InMemoryLoginAnomalyRepository,
  LoginAnomalyService,
  type LoginContext,
} from './login-anomaly.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const KEY = 'unit-test-hash-key-0123456789';

/** Dhaka, then London: ~8 000 km apart, which no 90-minute flight covers. */
const DHAKA = { latitude: 23.8103, longitude: 90.4125, country: 'BD' };
const LONDON = { latitude: 51.5072, longitude: -0.1276, country: 'GB' };

function context(overrides: Partial<LoginContext> = {}): LoginContext {
  return {
    tenantId: TENANT,
    userId: USER,
    deviceFingerprint: 'ua=unit/1.0;tz=Asia/Dhaka',
    ipAddress: '203.0.113.7',
    countryCode: DHAKA.country,
    latitude: DHAKA.latitude,
    longitude: DHAKA.longitude,
    at: new Date('2026-10-26T12:00:00.000Z'),
    ...overrides,
  };
}

describe('Login anomaly detection', () => {
  let repository: InMemoryLoginAnomalyRepository;
  let service: LoginAnomalyService;

  beforeEach(() => {
    repository = new InMemoryLoginAnomalyRepository();
    service = new LoginAnomalyService(repository, { hashKey: KEY });
  });

  async function establishDevice(ctx = context()): Promise<void> {
    await service.recordSuccess(ctx, false);
  }

  it('treats a first-ever sign-in as a new device and never as safe', async () => {
    const result = await service.evaluate(context());

    expect(result.level).toBe('MEDIUM');
    expect(result.reasons).toEqual(['NEW_DEVICE']);
    expect(result.isNewDevice).toBe(true);
    expect(result.summary).toMatch(/has not used before/);
  });

  it('does not flag the same device signing in twice', async () => {
    await establishDevice();
    const result = await service.evaluate(context());

    expect(result.level).toBe('NONE');
    expect(result.reasons).toEqual(['KNOWN_DEVICE']);
    expect(result.isNewDevice).toBe(false);
  });

  it('reports a trusted device as NONE with an explicit reason', async () => {
    await establishDevice();
    const ctx = context();
    await service.setTrusted({
      tenantId: TENANT,
      userId: USER,
      fingerprintHash: service.fingerprintHash(TENANT, ctx.deviceFingerprint),
      trusted: true,
    });

    const result = await service.evaluate(ctx);

    expect(result.level).toBe('NONE');
    expect(result.reasons).toEqual(['TRUSTED_DEVICE']);
  });

  it('flags a country the account has never signed in from', async () => {
    await establishDevice();
    const result = await service.evaluate(context({ countryCode: LONDON.country }));

    expect(result.reasons).toContain('NEW_COUNTRY');
    expect(result.level).toBe('MEDIUM');
  });

  it('does not flag a country change on an account with no country history', async () => {
    await establishDevice(context({ countryCode: null, latitude: null, longitude: null }));
    const result = await service.evaluate(context({ countryCode: 'GB' }));

    expect(result.reasons).not.toContain('NEW_COUNTRY');
  });

  it('flags travel that would need a commercial flight to beat the clock', async () => {
    await establishDevice(context({ at: new Date('2026-10-26T10:00:00.000Z') }));
    const result = await service.evaluate(
      context({
        deviceFingerprint: 'ua=unit/1.0;tz=Europe/London',
        countryCode: LONDON.country,
        latitude: LONDON.latitude,
        longitude: LONDON.longitude,
        at: new Date('2026-10-26T11:30:00.000Z'),
      }),
    );

    expect(result.reasons).toContain('IMPOSSIBLE_TRAVEL');
    expect(result.level).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('accepts the same journey given enough time', async () => {
    await establishDevice(context({ at: new Date('2026-10-26T00:00:00.000Z') }));
    const result = await service.evaluate(
      context({
        deviceFingerprint: 'ua=unit/1.0;tz=Europe/London',
        countryCode: LONDON.country,
        latitude: LONDON.latitude,
        longitude: LONDON.longitude,
        // 14 hours later: ~570 km/h, which is a real itinerary.
        at: new Date('2026-10-26T14:00:00.000Z'),
      }),
    );

    expect(result.reasons).not.toContain('IMPOSSIBLE_TRAVEL');
  });

  it('does not judge travel when the two sign-ins are effectively simultaneous', async () => {
    await establishDevice(context({ at: new Date('2026-10-26T12:00:00.000Z') }));
    const result = await service.evaluate(
      context({
        deviceFingerprint: 'other-device',
        countryCode: LONDON.country,
        latitude: LONDON.latitude,
        longitude: LONDON.longitude,
        at: new Date('2026-10-26T12:00:30.000Z'),
      }),
    );

    // A 30-second gap is clock skew, not evidence.
    expect(result.reasons).not.toContain('IMPOSSIBLE_TRAVEL');
  });

  it('does not judge travel without coordinates', async () => {
    await establishDevice();
    const result = await service.evaluate(context({ latitude: null, longitude: null, countryCode: 'BD' }));

    expect(result.reasons).not.toContain('IMPOSSIBLE_TRAVEL');
  });

  it('flags a failure burst at the threshold and not below it', async () => {
    await establishDevice();

    repository.failures = 4;
    expect((await service.evaluate(context())).reasons).not.toContain('FAILURE_BURST');

    repository.failures = 5;
    const result = await service.evaluate(context());
    expect(result.reasons).toContain('FAILURE_BURST');
    expect(result.summary).toMatch(/failed attempts/);
  });

  it('combines a new device with a new country into HIGH', async () => {
    await establishDevice();
    const result = await service.evaluate(
      context({ deviceFingerprint: 'fresh-device', countryCode: LONDON.country }),
    );

    expect(result.reasons).toEqual(expect.arrayContaining(['NEW_DEVICE', 'NEW_COUNTRY']));
    expect(result.level).toBe('HIGH');
  });

  it('scores deterministically for the same context', async () => {
    await establishDevice();
    const first = await service.evaluate(context({ deviceFingerprint: 'fresh' }));
    const second = await service.evaluate(context({ deviceFingerprint: 'fresh' }));

    expect(second.level).toBe(first.level);
    expect(second.score).toBe(first.score);
    expect(second.reasons).toEqual(first.reasons);
  });

  it('never stores the raw address or the raw fingerprint', async () => {
    const ctx = context();
    await service.recordSuccess(ctx);

    const stored = JSON.stringify(await repository.listDevices({ tenantId: TENANT, userId: USER }));

    expect(stored).not.toContain('203.0.113.7');
    expect(stored).not.toContain('unit/1.0');
    // What IS stored is a keyed digest, which is what makes the row useless to a
    // reader who wants to reconstruct the address.
    expect(stored).toContain(service.fingerprintHash(TENANT, ctx.deviceFingerprint));
  });

  it('hashes the same fingerprint differently in another tenant', async () => {
    const a = service.fingerprintHash(TENANT, 'shared-device');
    const b = service.fingerprintHash(OTHER_TENANT, 'shared-device');

    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it('keeps one user’s devices out of another user’s history', async () => {
    await establishDevice();

    const other = await service.evaluate(context({ userId: OTHER_USER }));

    expect(other.isNewDevice).toBe(true);
    expect(other.reasons).toEqual(['NEW_DEVICE']);
  });

  it('does not let a failed attempt teach the account that a device is familiar', async () => {
    // `evaluate` is what runs on an attempt; only `recordSuccess` writes a device.
    await service.evaluate(context());
    const again = await service.evaluate(context());

    expect(again.isNewDevice).toBe(true);
    expect(await repository.listDevices({ tenantId: TENANT, userId: USER })).toHaveLength(0);
  });

  it('does not promote a device to trusted merely by seeing it again', async () => {
    await establishDevice();
    await establishDevice();
    const ctx = context();
    await service.setTrusted({
      tenantId: TENANT,
      userId: USER,
      fingerprintHash: service.fingerprintHash(TENANT, ctx.deviceFingerprint),
      trusted: true,
    });
    await establishDevice();

    const devices = await repository.listDevices({ tenantId: TENANT, userId: USER });
    expect(devices).toHaveLength(1);
    expect(devices[0].trusted).toBe(true);
  });

  it('refuses to construct without a usable hash key', () => {
    expect(() => new LoginAnomalyService(repository, { hashKey: '' })).toThrow(/hash key/);
    expect(() => new LoginAnomalyService(repository, { hashKey: 'short' })).toThrow(/hash key/);
  });

  it('honours a configured travel bound and failure threshold', async () => {
    const strict = new LoginAnomalyService(repository, {
      hashKey: KEY,
      maxTravelSpeedKmh: 100,
      failureBurstThreshold: 1,
    });
    await strict.recordSuccess(context({ at: new Date('2026-10-26T00:00:00.000Z') }));
    repository.failures = 1;

    const result = await strict.evaluate(
      context({
        deviceFingerprint: 'x',
        at: new Date('2026-10-26T10:00:00.000Z'),
        countryCode: LONDON.country,
        latitude: LONDON.latitude,
        longitude: LONDON.longitude,
      }),
    );

    expect(result.reasons).toEqual(expect.arrayContaining(['IMPOSSIBLE_TRAVEL', 'FAILURE_BURST']));
  });
});
