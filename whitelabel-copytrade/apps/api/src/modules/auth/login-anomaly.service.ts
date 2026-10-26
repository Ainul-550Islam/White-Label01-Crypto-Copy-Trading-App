// # Responsibility: scores a sign-in attempt against known devices and places, storing only hashes, and explains every score with stable reason codes.
//
// WHAT THIS IS FOR
// ----------------
// A stolen password is silent. The only thing that distinguishes the attacker's
// sign-in from the owner's is the context: a device this account has never used,
// a country it has never been seen from, two places close together in time that
// are far apart in space, or a burst of failures immediately before. Each of those
// is a weak signal; together they are worth telling the user about.
//
// FOUR RULES, EACH ONE DELIBERATE
// -------------------------------
//   NEW_DEVICE        a fingerprint hash this (tenant, user) has never used.
//   NEW_COUNTRY       a country this account has never signed in from.
//   IMPOSSIBLE_TRAVEL the implied speed between the last sign-in and this one
//                     exceeds commercial-flight speed - measured against a
//                     generous bound, because a false accusation is expensive.
//   FAILURE_BURST     more than N failures for this account in the recent window.
//
// NO RAW IP IS EVER STORED. The fingerprint and the IP are combined and hashed
// with a keyed digest before they reach the database, so the table cannot be
// turned into a tracking log by anyone who reads it (including us), and a leaked
// row cannot be reversed into a client address. That is also why the score is
// computed here rather than in a database query: the raw values only exist for
// the duration of this call.
//
// WHY THE RESULT IS DETERMINISTIC
// -------------------------------
// The same context always produces the same score and the same ordered reason
// codes. An anomaly engine whose answer changes between two runs of the same
// input cannot be tested, cannot be explained to a user, and cannot be used as
// evidence in a dispute - all three of which matter more than a marginally
// better classifier.
import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';

/** How serious the context is. Nothing here blocks a sign-in on its own. */
export type LoginRiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type LoginAnomalyReason =
  | 'NEW_DEVICE'
  | 'NEW_COUNTRY'
  | 'IMPOSSIBLE_TRAVEL'
  | 'FAILURE_BURST'
  | 'TRUSTED_DEVICE'
  | 'KNOWN_DEVICE';

export interface LoginContext {
  tenantId: string;
  userId: string;
  /** Fingerprint material from the client: user agent, screen, timezone. Never stored raw. */
  deviceFingerprint: string;
  /** Raw IP. Hashed inside this service and never returned or persisted. */
  ipAddress: string;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  at: Date;
}

export interface KnownDevice {
  fingerprintHash: string;
  countryCode: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastSeenAt: Date;
  trusted: boolean;
}

export interface LoginAnomalyResult {
  level: LoginRiskLevel;
  reasons: LoginAnomalyReason[];
  score: number;
  /** The hash to persist. Not reversible, and not the IP. */
  fingerprintHash: string;
  /** Coarse, keyed IP hash for rate limiting. Deliberately different from the device hash. */
  ipHash: string;
  /** True when the caller should record this device as known. */
  isNewDevice: boolean;
  summary: string;
}

export interface LoginAnomalyRepository {
  listDevices(input: { tenantId: string; userId: string }): Promise<KnownDevice[]>;
  /** Consecutive failures for this account since `since`. */
  countRecentFailures(input: { tenantId: string; userId: string; since: Date }): Promise<number>;
  upsertDevice(input: {
    tenantId: string;
    userId: string;
    fingerprintHash: string;
    countryCode: string | null;
    lastLatitude: number | null;
    lastLongitude: number | null;
    lastSeenAt: Date;
    trusted: boolean;
  }): Promise<void>;
}

export interface LoginAnomalyOptions {
  /**
   * Key for the HMAC used on fingerprints and IPs, or a provider resolved on
   * first use. An unkeyed hash of an address is reversible by enumeration, so a
   * missing key is a hard failure - but a failure at the first sign-in, not at
   * boot, because the key material is assembled at runtime.
   */
  hashKey?: string;
  keyProvider?: () => string;
  /** Failures within the window that count as a burst. */
  failureBurstThreshold?: number;
  failureWindowMinutes?: number;
  /** Implied travel speed above which the pair is impossible. 900 km/h is a commercial cruise. */
  maxTravelSpeedKmh?: number;
  /** Below this gap two sign-ins are treated as simultaneous and travel is not judged. */
  minTravelGapSeconds?: number;
  now?: () => Date;
}

const DEFAULTS = {
  failureBurstThreshold: 5,
  failureWindowMinutes: 15,
  maxTravelSpeedKmh: 900,
  minTravelGapSeconds: 60,
};

const EARTH_RADIUS_KM = 6_371;

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

@Injectable()
export class LoginAnomalyService {
  private readonly keyProvider: () => string;
  private resolvedKey: string | null;
  private readonly failureBurstThreshold: number;
  private readonly failureWindowMinutes: number;
  private readonly maxTravelSpeedKmh: number;
  private readonly minTravelGapSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: LoginAnomalyRepository,
    options: LoginAnomalyOptions,
  ) {
    if (!options?.hashKey && !options?.keyProvider) {
      // Refusing to construct is the only safe response: without a key the
      // "hashed" identifiers are enumerable, which defeats the point of hashing.
      throw new Error('LoginAnomalyService needs a hash key of at least 16 characters');
    }
    if (options.hashKey !== undefined && options.hashKey.length < 16) {
      throw new Error('LoginAnomalyService needs a hash key of at least 16 characters');
    }
    this.keyProvider = options.keyProvider ?? (() => options.hashKey as string);
    this.resolvedKey = options.hashKey ?? null;
    this.failureBurstThreshold = options.failureBurstThreshold ?? DEFAULTS.failureBurstThreshold;
    this.failureWindowMinutes = options.failureWindowMinutes ?? DEFAULTS.failureWindowMinutes;
    this.maxTravelSpeedKmh = options.maxTravelSpeedKmh ?? DEFAULTS.maxTravelSpeedKmh;
    this.minTravelGapSeconds = options.minTravelGapSeconds ?? DEFAULTS.minTravelGapSeconds;
    this.now = options.now ?? (() => new Date());
  }

  /** The device hash that is stored. Keyed, so the same fingerprint in two tenants is two different hashes. */
  fingerprintHash(tenantId: string, fingerprint: string): string {
    return createHmac('sha256', this.hashKey())
      .update(`${tenantId}:device:${fingerprint.trim()}`)
      .digest('hex');
  }

  /** The IP hash used for rate limiting. Keyed, and salted apart from the device hash. */
  ipHash(ipAddress: string): string {
    return createHmac('sha256', this.hashKey()).update(`ip:${ipAddress.trim()}`).digest('hex');
  }

  /** The HMAC key, resolved and length-checked on first use. */
  private hashKey(): string {
    if (this.resolvedKey === null) {
      const resolved = this.keyProvider();
      if (!resolved || resolved.length < 16) {
        throw new Error('LoginAnomalyService needs a hash key of at least 16 characters');
      }
      this.resolvedKey = resolved;
    }
    return this.resolvedKey;
  }

  /**
   * Score one attempt.
   *
   * The device is recorded as known only by `recordSuccess`, never here: a
   * failed attempt from a new device must not teach the account that the device
   * is familiar, or the attacker's first guess would be their cheapest.
   */
  async evaluate(context: LoginContext): Promise<LoginAnomalyResult> {
    const fingerprintHash = this.fingerprintHash(context.tenantId, context.deviceFingerprint);
    const ipHash = this.ipHash(context.ipAddress);
    const [devices, recentFailures] = await Promise.all([
      this.repository.listDevices({ tenantId: context.tenantId, userId: context.userId }),
      this.repository.countRecentFailures({
        tenantId: context.tenantId,
        userId: context.userId,
        since: new Date(context.at.getTime() - this.failureWindowMinutes * 60 * 1_000),
      }),
    ]);

    const reasons: LoginAnomalyReason[] = [];
    const known = devices.find((device) => device.fingerprintHash === fingerprintHash) ?? null;

    if (!known) reasons.push('NEW_DEVICE');
    else if (known.trusted) reasons.push('TRUSTED_DEVICE');
    else reasons.push('KNOWN_DEVICE');

    const knownCountries = new Set(
      devices.map((device) => device.countryCode?.toUpperCase()).filter((code): code is string => Boolean(code)),
    );
    const country = context.countryCode?.toUpperCase() ?? null;
    if (country && knownCountries.size > 0 && !knownCountries.has(country)) {
      reasons.push('NEW_COUNTRY');
    }

    if (this.isImpossibleTravel(devices, context)) reasons.push('IMPOSSIBLE_TRAVEL');
    if (recentFailures >= this.failureBurstThreshold) reasons.push('FAILURE_BURST');

    const level = this.levelFor(reasons);
    return {
      level,
      reasons,
      score: this.scoreFor(reasons),
      fingerprintHash,
      ipHash,
      isNewDevice: known === null,
      summary: this.summaryFor(reasons),
    };
  }

  /**
   * Remember a successful sign-in. Called only after the credential check
   * passes, so a failed attempt cannot establish a device as familiar.
   */
  async recordSuccess(context: LoginContext, trusted = false): Promise<void> {
    const known = await this.repository.listDevices({ tenantId: context.tenantId, userId: context.userId });
    const fingerprintHash = this.fingerprintHash(context.tenantId, context.deviceFingerprint);
    const existing = known.find((device) => device.fingerprintHash === fingerprintHash);
    await this.repository.upsertDevice({
      tenantId: context.tenantId,
      userId: context.userId,
      fingerprintHash,
      countryCode: context.countryCode?.toUpperCase() ?? existing?.countryCode ?? null,
      lastLatitude: context.latitude ?? existing?.lastLatitude ?? null,
      lastLongitude: context.longitude ?? existing?.lastLongitude ?? null,
      lastSeenAt: context.at,
      // Trust is only ever granted explicitly; seeing a device again does not
      // promote it, or one attacker sign-in would make the device trusted.
      trusted: existing?.trusted ?? trusted,
    });
  }

  /** Mark a device trusted, or drop its trust. Used by the "this was me" flow. */
  async setTrusted(input: { tenantId: string; userId: string; fingerprintHash: string; trusted: boolean; at?: Date }): Promise<void> {
    await this.repository.upsertDevice({
      tenantId: input.tenantId,
      userId: input.userId,
      fingerprintHash: input.fingerprintHash,
      countryCode: null,
      lastLatitude: null,
      lastLongitude: null,
      lastSeenAt: input.at ?? this.now(),
      trusted: input.trusted,
    });
  }

  private isImpossibleTravel(devices: readonly KnownDevice[], context: LoginContext): boolean {
    if (context.latitude === null || context.longitude === null) return false;
    const located = devices.filter(
      (device) => device.lastLatitude !== null && device.lastLongitude !== null,
    );
    if (located.length === 0) return false;

    // Compare against the most recent located sign-in only. Comparing against the
    // furthest one would flag a user who legitimately travels, forever.
    const latest = located.reduce((newest, device) =>
      device.lastSeenAt.getTime() > newest.lastSeenAt.getTime() ? device : newest,
    );
    const gapSeconds = (context.at.getTime() - latest.lastSeenAt.getTime()) / 1_000;
    if (!Number.isFinite(gapSeconds) || gapSeconds < this.minTravelGapSeconds) {
      // Same instant (or a clock skew): distance is not evidence of anything here.
      return false;
    }
    const distanceKm = haversineKm(
      { latitude: latest.lastLatitude as number, longitude: latest.lastLongitude as number },
      { latitude: context.latitude, longitude: context.longitude },
    );
    const impliedSpeedKmh = distanceKm / (gapSeconds / 3_600);
    return impliedSpeedKmh > this.maxTravelSpeedKmh;
  }

  private levelFor(reasons: readonly LoginAnomalyReason[]): LoginRiskLevel {
    const hardware = reasons.filter((reason) =>
      ['NEW_DEVICE', 'NEW_COUNTRY', 'IMPOSSIBLE_TRAVEL', 'FAILURE_BURST'].includes(reason),
    );
    if (reasons.includes('IMPOSSIBLE_TRAVEL') && reasons.includes('NEW_DEVICE')) return 'HIGH';
    if (reasons.includes('IMPOSSIBLE_TRAVEL')) return 'HIGH';
    if (hardware.length >= 2) return 'HIGH';
    if (hardware.length === 1) return 'MEDIUM';
    if (reasons.includes('KNOWN_DEVICE') || reasons.includes('TRUSTED_DEVICE')) return 'NONE';
    return 'LOW';
  }

  private scoreFor(reasons: readonly LoginAnomalyReason[]): number {
    const weights: Record<LoginAnomalyReason, number> = {
      IMPOSSIBLE_TRAVEL: 50,
      NEW_DEVICE: 25,
      NEW_COUNTRY: 15,
      FAILURE_BURST: 30,
      KNOWN_DEVICE: 0,
      TRUSTED_DEVICE: 0,
    };
    return Math.min(
      100,
      reasons.reduce((total, reason) => total + weights[reason], 0),
    );
  }

  private summaryFor(reasons: readonly LoginAnomalyReason[]): string {
    const parts: string[] = [];
    if (reasons.includes('NEW_DEVICE')) parts.push('a device this account has not used before');
    if (reasons.includes('NEW_COUNTRY')) parts.push('a new country');
    if (reasons.includes('IMPOSSIBLE_TRAVEL')) parts.push('a location that is too far from the previous sign-in');
    if (reasons.includes('FAILURE_BURST')) parts.push('several failed attempts just before this one');
    if (parts.length === 0) return 'Signed in from a device this account already uses.';
    return `Signed in from ${parts.join(', ')}.`;
  }
}

/** A permissive in-memory implementation, used by tests and by the notification processor's dry runs. */
export class InMemoryLoginAnomalyRepository implements LoginAnomalyRepository {
  private readonly devices: Array<KnownDevice & { tenantId: string; userId: string }> = [];
  failures = 0;

  async listDevices(input: { tenantId: string; userId: string }): Promise<KnownDevice[]> {
    return this.devices.filter(
      (device) => device.tenantId === input.tenantId && device.userId === input.userId,
    );
  }

  async countRecentFailures(): Promise<number> {
    return this.failures;
  }

  async upsertDevice(input: {
    tenantId: string;
    userId: string;
    fingerprintHash: string;
    countryCode: string | null;
    lastLatitude: number | null;
    lastLongitude: number | null;
    lastSeenAt: Date;
    trusted: boolean;
  }): Promise<void> {
    const existing = this.devices.find(
      (device) =>
        device.tenantId === input.tenantId &&
        device.userId === input.userId &&
        device.fingerprintHash === input.fingerprintHash,
    );
    if (existing) {
      existing.countryCode = input.countryCode ?? existing.countryCode;
      existing.lastLatitude = input.lastLatitude ?? existing.lastLatitude;
      existing.lastLongitude = input.lastLongitude ?? existing.lastLongitude;
      existing.lastSeenAt = input.lastSeenAt;
      existing.trusted = input.trusted;
      return;
    }
    this.devices.push({ ...input });
  }
}

/** Exposed for the notification processor, which needs the same digest for dedupe keys. */
export function digestForDedupe(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
