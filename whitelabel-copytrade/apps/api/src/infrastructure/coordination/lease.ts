/**
 * Timed coordination on the Node side - the twin of
 * `wlct_trading/coordination/lease.py`.
 *
 * Same safety story as the Python module, and it is worth restating here
 * because the worker bootstrap will read exactly this file first: a lease
 * makes "usually exactly one" cheap to check; it does not make
 * "at most once" true. A holder cut off from Redis for a TTL plus a clock
 * skew can still be running while a newcomer takes over, so every effect
 * behind these classes must stay idempotent (deterministic BullMQ jobId,
 * compare-and-set state transitions, per-account execution locks). The
 * lease is throughput hygiene - it stops N replicas stampeding - not an
 * exactly-once guarantee, and nothing may be placed behind it that needs
 * the latter.
 *
 * The two Lua scripts are byte-copies of the Python claim scripts (their
 * texts and SHA-256 digests are committed in
 * docs/fixtures/coordination_fixtures.json and re-checked by the parity
 * spec), and they are value-generic: the elector stores its random token
 * where the claims store the member id, so one pair of compare-and-act
 * scripts covers both roles here just as it does in Python, where the
 * elector rides the execution lock port and the scripts are the same two
 * commands modulo whitespace.
 */

import { randomUUID } from 'node:crypto';

import {
  COORD_LEADER_KEY_PREFIX,
  COORD_MEMBERSHIP_KEY_PREFIX,
  COORD_PARTITION_KEY_PREFIX,
} from '@wlct/config';

// partitions.ts imports nothing from here, so this direction cannot cycle.
// Importing the member grammar instead of re-declaring it kills the second
// literal of the same regex that Part 11 shipped twice (Python kept one
// definition; this side is now symmetrical, and membership.ts joins on it).
import { MEMBER_TOKEN_RE } from './partitions';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateCoordinationName(name: string, what: string): string {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `${what} ${JSON.stringify(name)} is not a wire token: 1..64 chars of ` +
        'letters, digits, ".", "_" or "-", starting alphanumeric',
    );
  }
  return name;
}

/** Mirrors `RedisKeys.leader_lease` in wlct_trading/redis_keys.py. */
export function leaderLeaseKey(name: string): string {
  return `${COORD_LEADER_KEY_PREFIX}:${validateCoordinationName(name, 'lease name')}`;
}

/** Mirrors `RedisKeys.partition_claim`. */
export function partitionClaimKey(group: string, partition: number): string {
  validateCoordinationName(group, 'coordination group');
  if (!Number.isInteger(partition) || partition < 0) {
    throw new Error('partition indexes must be non-negative integers');
  }
  return `${COORD_PARTITION_KEY_PREFIX}:${group}:${partition}`;
}

/** Mirrors `RedisKeys.membership_registry` in wlct_trading/redis_keys.py:
 * one self-registration zset per coordinated group (Part 12). Deliberately
 * NOT tenant-scoped - fleet topology is operator-visible state, shared
 * across tenants by necessity; the staleness law lives in membership.ts. */
export function membershipRegistryKey(name: string): string {
  return `${COORD_MEMBERSHIP_KEY_PREFIX}:${name}`;
}

/** Pure twin of Python `renew_due_micros` - the whole clock law, fixture-
 * pinned row for row (`>=` on the interval: exactly one interval of
 * inactivity is already due; a zero/negative/non-integer interval is
 * rejected as the never-stop config it is; a BACKWARD clock step answers
 * DUE, because an NTP correction must never lull a holder into skipping
 * renewals, and raising from a timing rule would turn timekeeping hiccup
 * into coordination outage). Micros are bigint: the epoch values exceed
 * Number.MAX_SAFE_INTEGER and the boundary rows must be exact. */
export function renewDueMicros(input: {
  nowMicros: bigint;
  lastActionMicros: bigint;
  renewMillis: number;
}): boolean {
  if (!Number.isInteger(input.renewMillis) || input.renewMillis < 1) {
    throw new Error('renew intervals must be plain integer milliseconds >= 1');
  }
  const elapsed = input.nowMicros - input.lastActionMicros;
  if (elapsed < 0n) {
    return true;
  }
  return elapsed >= BigInt(input.renewMillis) * 1_000n;
}

export const CLAIM_RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
    return 0
end
`;

export const CLAIM_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
`;

/** The slice of a Redis client these primitives need, declared structurally
 * so the real client (ioredis via QueueModule's connection factory) is
 * adapted at construction and unit tests hand in a script-checking fake -
 * same rule as the Python `RedisLockClient` protocol: coordination code
 * never imports a client library. */
export interface CoordinationRedis {
  /** SET name value NX PX px  -> true when the key was taken. */
  setIfAbsent(name: string, value: string, pxMillis: number): Promise<boolean>;
  get(name: string): Promise<string | null>;
  eval(script: string, key: string, ...argv: string[]): Promise<number>;
}

export interface LeaseState {
  readonly leader: boolean;
  readonly token: string | null;
  readonly sinceMicros: bigint;
  readonly renewals: number;
  readonly demotions: number;
  readonly lastError: string | null;
}

const MICROS_PER_MILLI = 1_000n;

function nowMicrosFromClock(now: () => number): bigint {
  return BigInt(Math.round(now())) * MICROS_PER_MILLI;
}

/** Role gate ("who runs the sweep"), campaign/hold/step-aside. */
export class LeaderElector {
  readonly key: string;
  readonly ttlMillis: number;
  readonly renewMillis: number;
  readonly retryMillis: number;

  private token: string | null = null;
  private sinceMicros = 0n;
  private lastActionMicros = 0n;
  private renewals = 0;
  private demotions = 0;
  private lastError: string | null = null;

  constructor(
    private readonly client: CoordinationRedis,
    options: {
      readonly name: string;
      readonly ttlMillis?: number;
      readonly renewMillis?: number;
      readonly retryMillis?: number;
      /** Injectable for tests; Date.now() is fine for coordination timing
       * because the lease safety story never depends on clock agreement. */
      readonly now?: () => number;
    },
  ) {
    const ttl = options.ttlMillis ?? 30_000;
    if (!Number.isInteger(ttl) || ttl < 1_000) {
      throw new Error('lease TTLs below one second elect on network jitter');
    }
    const renew = options.renewMillis ?? Math.floor(ttl / 3);
    if (!Number.isInteger(renew) || renew < 250) {
      throw new Error('renew intervals below 250ms are a busy loop, not a cadence');
    }
    if (renew * 2 >= ttl) {
      throw new Error(
        'renew interval must be less than half the lease TTL - ' +
          'a single late renewal would hand leadership to the queue',
      );
    }
    this.key = leaderLeaseKey(options.name);
    this.ttlMillis = ttl;
    this.renewMillis = renew;
    this.retryMillis = options.retryMillis ?? Math.max(250, Math.floor(ttl / 8));
    this.now = options.now ?? Date.now;
  }

  private readonly now: () => number;

  get isLeader(): boolean {
    return this.token !== null;
  }

  get state(): LeaseState {
    return {
      leader: this.isLeader,
      token: this.token,
      sinceMicros: this.sinceMicros,
      renewals: this.renewals,
      demotions: this.demotions,
      lastError: this.lastError,
    };
  }

  /** Take (or keep) leadership once. Never waits; contention is `false`,
   * transport pain is `false` plus a recorded lastError - a coordination
   * outage must not crash the thing it is protecting. */
  async tryCampaign(): Promise<boolean> {
    if (this.token !== null) {
      return true;
    }
    const candidate = randomUUID();
    try {
      const took = await this.client.setIfAbsent(this.key, candidate, this.ttlMillis);
      if (!took) {
        return false;
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.name : 'Error';
      return false;
    }
    this.token = candidate;
    this.sinceMicros = nowMicrosFromClock(this.now);
    this.lastActionMicros = this.sinceMicros;
    this.lastError = null;
    return true;
  }

  /** Extend once; any refusal demotes immediately. A holder that cannot
   * prove it still holds is not a holder. */
  async renew(): Promise<boolean> {
    if (this.token === null) {
      return false;
    }
    let ok = false;
    try {
      ok =
        (await this.client.eval(
          CLAIM_RENEW_SCRIPT,
          this.key,
          this.token,
          String(this.ttlMillis),
        )) === 1;
    } catch (error) {
      this.lastError = error instanceof Error ? error.name : 'Error';
      ok = false;
    }
    if (ok) {
      // `sinceMicros` keeps telling the world when LEADERSHIP began; the
      // Redis-side expiry moved, our start stamp did not (Python mirror:
      // re-dating the handle, not the `since`). Only `lastActionMicros`
      // moves - it is what the timing law measures against.
      this.renewals += 1;
      this.lastActionMicros = nowMicrosFromClock(this.now);
      return true;
    }
    this.stepDown();
    return false;
  }

  /** Tick-safe renewal for loop-less callers (a worker renewing between
   * job batches): renews only when the pure timing law says due. True
   * means "still leader" - renewed, or not yet due. Mirrors Python
   * `LeaderElector.renew_if_due` exactly. */
  async renewIfDue(nowMicros?: bigint): Promise<boolean> {
    if (this.token === null) {
      return false;
    }
    const now = nowMicros ?? nowMicrosFromClock(this.now);
    if (!renewDueMicros({
      nowMicros: now,
      lastActionMicros: this.lastActionMicros,
      renewMillis: this.renewMillis,
    })) {
      return true;
    }
    return this.renew();
  }

  /** Hand the lease back instead of making candidates wait a TTL. */
  async resign(): Promise<boolean> {
    if (this.token === null) {
      return false;
    }
    let released = false;
    try {
      released =
        (await this.client.eval(CLAIM_RELEASE_SCRIPT, this.key, this.token)) === 1;
    } catch (error) {
      this.lastError = error instanceof Error ? error.name : 'Error';
    }
    // A voluntary resignation is a transition, not a demotion - the metric
    // counts times leadership was TAKEN (Python mirror: forced flag).
    this.stepDown(false);
    return released;
  }

  private stepDown(forced = true): void {
    if (this.token !== null) {
      if (forced) {
        this.demotions += 1;
      }
      this.token = null;
    }
  }
}

/** Partition gate ("this worker holds partitions 0 and 3 right now"),
 * valued by member identity so `holder` answers "who has it" from
 * outside - the difference that makes it its own class in Python too. */
export class PartitionClaims {
  constructor(
    private readonly client: CoordinationRedis,
    private readonly options: {
      readonly group: string;
      readonly member: string;
      readonly ttlMillis?: number;
    },
  ) {
    validateCoordinationName(options.group, 'coordination group');
    if (!MEMBER_TOKEN_RE.test(options.member)) {
      throw new Error(
        `member ${JSON.stringify(options.member)} is not a member token ` +
          "(letters, digits, '.', '_', ':' or '-'; 1..128 chars)",
      );
    }
    const ttl = options.ttlMillis ?? 15_000;
    if (!Number.isInteger(ttl) || ttl < 1_000) {
      throw new Error('claim TTLs below one second flap on network jitter');
    }
    this.claimTtlMillis = ttl;
  }

  private readonly claimTtlMillis: number;

  keyFor(partition: number): string {
    return partitionClaimKey(this.options.group, partition);
  }

  private get ttlMillis(): number {
    return this.claimTtlMillis;
  }

  /** Take a partition (fresh or already mine). A held partition belongs to
   * somebody else; waiting for it is a loop's job, not a command's. */
  async claim(partition: number): Promise<boolean> {
    const key = this.keyFor(partition);
    try {
      if (await this.client.setIfAbsent(key, this.options.member, this.ttlMillis)) {
        return true;
      }
      return (
        (await this.client.eval(
          CLAIM_RENEW_SCRIPT,
          key,
          this.options.member,
          String(this.ttlMillis),
        )) === 1
      );
    } catch {
      return false; // transport truth is a miss; the next tick retries
    }
  }

  async release(partition: number): Promise<boolean> {
    try {
      return (
        (await this.client.eval(
          CLAIM_RELEASE_SCRIPT,
          this.keyFor(partition),
          this.options.member,
        )) === 1
      );
    } catch {
      return false; // expiry is the safety net, same trade as Python
    }
  }

  async holder(partition: number): Promise<string | null> {
    return this.client.get(this.keyFor(partition));
  }

  /** One tick: claim what is wanted, return what is no longer wanted,
   * report what is actually held now. Contention shows up as an absent
   * partition, never as an exception. */
  async reconcile(wanted: readonly number[]): Promise<ReadonlySet<number>> {
    for (const partition of wanted) {
      // Non-negative integers only - the ceiling on the NUMBER of
      // partitions is enforced by the assignment math (MAX_PARTITIONS),
      // exactly as on the Python side, so a caller holding a partition
      // index from a smaller table stays valid rather than getting a
      // spurious error during a count change.
      if (!Number.isInteger(partition) || partition < 0) {
        throw new Error('partition indexes must be non-negative integers');
      }
    }
    const held = new Set<number>();
    for (const partition of [...wanted].sort((a, b) => a - b)) {
      if (await this.claim(partition)) {
        held.add(partition);
      }
    }
    return held;
  }
}
