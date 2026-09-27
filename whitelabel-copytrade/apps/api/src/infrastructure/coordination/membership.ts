/**
 * Self-registering worker membership (Part 12) - TypeScript twin of
 * `wlct_trading/coordination/membership.py`.
 *
 * The Part 11 law stands: **membership says who WANTS a partition; claims
 * decide who HAS one.** This module replaces only the SOURCE of membership:
 * each worker heartbeats its id into one shared zset scored by expiry, and
 * live membership is that zset pruned by the clock. Config lists become the
 * fallback, not the authority.
 *
 * Cross-language contract, enforced by docs/fixtures/coordination_fixtures.json:
 * - the three Lua scripts are byte-identical to the Python module's
 *   (the spec replays the fixture's sha256 for each);
 * - staleness is applied HERE and in Python by the same pure function over
 *   the same rows (`liveMembers` in the fixture) - the scripts ship no
 *   clock law beyond housekeeping;
 * - validation error texts match the fixture where the fixture can express
 *   them (Python repr tails like `got ('ok-1', True)` are language-shaped
 *   and the spec compares the language-neutral prefix before ", got ").
 *
 * Units: milliseconds throughout - the zset score domain is Redis's own
 * (PTTL world), shared with the claim TTLs. `host:pid:uuid` member tokens
 * fit the exported member grammar exactly.
 */

import { Buffer } from 'node:buffer';

import { membershipRegistryKey, validateCoordinationName } from './lease';
import { MEMBER_TOKEN_RE } from './partitions';

/** Mirrors `MEMBERSHIP_PING_SCRIPT`: prune expired, register with the GT
 * law (a delayed replay can never shorten a fresher heartbeat), read the
 * live set back - one round trip per tick. ARGV order: now, expiry, member. */
export const MEMBERSHIP_PING_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZADD', KEYS[1], 'GT', ARGV[2], ARGV[3])
return redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
`;

/** Mirrors `MEMBERSHIP_SNAPSHOT_SCRIPT`: a pure, EXISTS-guarded read. Reads
 * never mutate - the pruning inside ping is housekeeping, not law. */
export const MEMBERSHIP_SNAPSHOT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
    return {}
end
return redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
`;

/** Mirrors `MEMBERSHIP_RESIGN_SCRIPT`: best-effort leave; the expiry law
 * already handles everything a lost ZREM would have done. */
export const MEMBERSHIP_RESIGN_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
return redis.call('ZCARD', KEYS[1])
`;

/** The registry needs EVAL with one key and the RAW reply - no numeric
 * coercion, because the ping/snapshot answers are flat member/score arrays.
 * Declared apart from `CoordinationRedis` for the same reason the Python
 * protocol is: membership is not mutual exclusion, and the two surfaces
 * evolve separately. */
export interface MembershipEvalRedis {
  evalFlat(script: string, key: string, ...argv: string[]): Promise<unknown>;
}

function assertMillisInteger(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a plain integer of milliseconds, got ${JSON.stringify(value)}`);
  }
}

/** Mirrors `heartbeat_expiry`: the score a heartbeat carries. */
export function heartbeatExpiry(nowMillis: number, ttlMillis: number): number {
  assertMillisInteger('now_millis', nowMillis);
  assertMillisInteger('ttl_millis', ttlMillis);
  if (nowMillis < 0) {
    throw new Error('now_millis must be a non-negative epoch in milliseconds');
  }
  if (ttlMillis < 1_000) {
    throw new Error('membership TTLs below one second flap on network jitter');
  }
  // now and ttl share the millisecond domain (unlike the renewal law, whose
  // interval is millis against a micros clock): expiry is plain addition.
  return nowMillis + ttlMillis;
}

/** Mirrors `live_members`: apply the expiry law to a raw ZRANGE WITHSCORES
 * shape. A member is live while expiry > now (STRICTLY - expiring exactly at
 * the sampling instant means expired); duplicates resolve to the maximum
 * expiry; the result is sorted so membership is order-insensitive, exactly
 * as the assignment functions require. */
export function liveMembers(
  entries: Iterable<readonly [unknown, unknown]>,
  nowMillis: number,
): readonly string[] {
  assertMillisInteger('now_millis', nowMillis);
  const best = new Map<string, number>();
  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'number' ||
      !Number.isSafeInteger(entry[1])
    ) {
      throw new Error(`membership entry must be a (str, int) pair, got ${JSON.stringify(entry)}`);
    }
    const member = entry[0];
    const expiry = entry[1];
    if (!MEMBER_TOKEN_RE.test(member)) {
      throw new Error(`membership entry '${member}' is not a member token`);
    }
    const current = best.get(member);
    if (current === undefined || expiry > current) {
      best.set(member, expiry);
    }
  }
  return [...best.entries()]
    .filter(([, expiry]) => expiry > nowMillis)
    .map(([member]) => member)
    .sort();
}

/** Mirrors `_parse_member_reply`: coerce a raw EVAL reply (flat array of
 * string|Buffer members alternating with numeric|string scores - whatever
 * shape the client's decode setting produces) into live membership. A
 * malformed reply is a LOUD bug, never a plausible answer: odd length or a
 * garbage element throws instead of silently shrinking the fleet. */
export function parseMemberReply(reply: unknown, nowMillis: number): readonly string[] {
  if (reply === null || reply === undefined) {
    return [];
  }
  if (!Array.isArray(reply)) {
    throw new Error(`membership reply must be a flat array, got ${JSON.stringify(reply)}`);
  }
  if (reply.length % 2 !== 0) {
    throw new Error('membership reply has an odd number of elements');
  }
  const pairs: Array<readonly [string, number]> = [];
  for (let i = 0; i < reply.length; i += 2) {
    const rawName = reply[i];
    const rawScore = reply[i + 1];
    const name = Buffer.isBuffer(rawName)
      ? rawName.toString('utf8')
      : typeof rawName === 'string'
        ? rawName
        : null;
    if (name === null) {
      throw new Error(`membership entry must be a (str, int) pair, got [${JSON.stringify(rawName)}, ...]`);
    }
    let expiry: number | null = null;
    if (typeof rawScore === 'number' && Number.isSafeInteger(rawScore)) {
      expiry = rawScore;
    } else {
      const text = Buffer.isBuffer(rawScore) ? rawScore.toString('ascii') : rawScore;
      if (typeof text === 'string' && /^\d+$/.test(text)) {
        const parsed = Number(text);
        if (Number.isSafeInteger(parsed)) {
          expiry = parsed;
        }
      }
    }
    if (expiry === null) {
      throw new Error(`membership entry must be a (str, int) pair, got ['${name}', ...]`);
    }
    pairs.push([name, expiry] as const);
  }
  return liveMembers(pairs, nowMillis);
}

export interface MembershipRegistryOptions {
  /** The coordinated group, e.g. 'trade-execution'. Wire token grammar. */
  readonly group: string;
  /** This worker's stable identity token (host:pid:uuid is the convention). */
  readonly member: string;
  /** How long a missed heartbeat survives; >= 1000ms, pair it with at most
   * half the coordination tick via the config cross-law. Default 15s. */
  readonly ttlMillis?: number;
}

/**
 * Heartbeat-based self-registration for ONE member of ONE group.
 *
 * The failure law is the interesting part, mirrored verbatim from Python:
 * - `ping` PROPAGATES transport errors. It runs inside the worker's
 *   coordination tick, where "the registry is down" must reach the caller's
 *   fallback branch (and its log line); swallowing it here would turn
 *   "registry unreachable" into "I appear to be the only member".
 * - `members` answers `null` on any read failure: UNKNOWN, which callers
 *   must treat as "keep the last known set", never as "empty fleet".
 * - `resign` answers `false` and moves on: best-effort leave, with the
 *   expiry law as the net that catches every lost ZREM.
 */
export class MembershipRegistry {
  private readonly ttl: number;

  public constructor(
    private readonly client: MembershipEvalRedis,
    private readonly options: MembershipRegistryOptions,
  ) {
    validateCoordinationName(options.group, 'coordination group');
    if (!MEMBER_TOKEN_RE.test(options.member)) {
      throw new Error(
        `member ${JSON.stringify(options.member)} is not a member token ` +
          "(letters, digits, '.', '_', '-' or ':'; 1..128 chars - the same grammar claims use)",
      );
    }
    const ttl = options.ttlMillis ?? 15_000;
    assertMillisInteger('ttl_millis', ttl);
    if (ttl < 1_000) {
      throw new Error('membership TTLs below one second flap on network jitter');
    }
    this.ttl = ttl;
  }

  public get key(): string {
    return membershipRegistryKey(this.options.group);
  }

  /** Heartbeat (registering this member) and return the live set read in
   * the same reply. Errors propagate - see the class contract. */
  public async ping(nowMillis: number): Promise<readonly string[]> {
    const expiry = heartbeatExpiry(nowMillis, this.ttl);
    const reply = await this.client.evalFlat(
      MEMBERSHIP_PING_SCRIPT,
      this.key,
      String(nowMillis),
      String(expiry),
      this.options.member,
    );
    return parseMemberReply(reply, nowMillis);
  }

  /** Live membership via a read-only snapshot, or null when the read failed
   * (UNKNOWN; the claims layer stays the authority either way). */
  public async members(nowMillis: number): Promise<readonly string[] | null> {
    let reply: unknown;
    try {
      // No now-argument: the read is raw, and the clock law is applied
      // client-side by liveMembers - passing an ARGV the script never reads
      // would imply a Lua-side staleness decision that does not exist.
      reply = await this.client.evalFlat(MEMBERSHIP_SNAPSHOT_SCRIPT, this.key);
    } catch {
      return null;
    }
    return parseMemberReply(reply, nowMillis);
  }

  /** Leave the registry now instead of at expiry; false on any failure,
   * because the TTL already committed to handling that case. */
  public async resign(): Promise<boolean> {
    try {
      await this.client.evalFlat(MEMBERSHIP_RESIGN_SCRIPT, this.key, this.options.member);
    } catch {
      return false;
    }
    return true;
  }
}
