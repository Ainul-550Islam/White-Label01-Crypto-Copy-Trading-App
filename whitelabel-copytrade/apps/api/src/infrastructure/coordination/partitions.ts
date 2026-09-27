/**
 * Partitioned work - the TypeScript twin of
 * `wlct_trading/coordination/partitions.py`.
 *
 * Same contract, same hash (IEEE CRC-32 over UTF-8), same rendezvous
 * scoring, same validation. It exists because the Node API enqueues the
 * work this splits and the BullMQ workers consume it, and a producer that
 * stamps jobs with partition N while the workers compute partition N' from
 * their own arithmetic is worse than no partitioning at all: every job
 * looks claimed and none are. The parity spec replays the committed
 * fixture vectors against both languages on every test run, so the twins
 * cannot drift quietly.
 */

import { crc32Utf8 } from './crc32';

/** Mirrors `MAX_PARTITIONS` in partitions.py: an O(members x partitions)
 * scan happens at claim time, so a bigger group size than this is a config
 * mistake, not a scale plan. */
export const MAX_PARTITIONS = 4096;

/** Mirrors `_MEMBER` in partitions.py: the member-token grammar for the
 * whole coordination plane (claim values, registry zset members). Exported
 * for membership.ts - one rule, defined exactly once, imported nowhere else
 * as a fresh literal. */
export const MEMBER_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type PartitionTable = Readonly<Record<string, readonly number[]>>;

export interface MovedOwnership {
  readonly before: string | null;
  readonly after: string | null;
}

function assertKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('partition keys must be non-empty strings');
  }
}

function assertCount(count: number): void {
  // Two messages, same as the Python twin: "is it even an integer" is a
  // different mistake from "is it in range", and the rejects fixture maps
  // each non-number / out-of-range spelling to its own expected text.
  if (typeof count !== 'number' || !Number.isInteger(count)) {
    throw new Error('partition counts must be plain integers');
  }
  if (count < 1 || count > MAX_PARTITIONS) {
    throw new Error(`partition counts must be within 1..${MAX_PARTITIONS}`);
  }
}

function sortMembers(members: readonly string[]): string[] {
  if (!Array.isArray(members)) {
    throw new Error('members must be a sequence of member tokens');
  }
  for (const member of members) {
    if (typeof member !== 'string' || !MEMBER_TOKEN_RE.test(member)) {
      throw new Error(
        `member ${JSON.stringify(member)} is not a wire token (letters, digits, ` +
          "'.', '_', ':' or '-'; 1..128 chars)",
      );
    }
  }
  if (new Set(members).size !== members.length) {
    throw new Error('member lists must not contain duplicates');
  }
  return [...members].sort();
}

/** The partition a key belongs to: `crc32(utf8(key)) % count`. */
export function partitionFor(key: string, count: number): number {
  assertKey(key);
  assertCount(count);
  return crc32Utf8(key) % count;
}

function rendezvousScore(member: string, partition: number): number {
  return crc32Utf8(`${member}|${partition}`);
}

/** Which member owns `partition` (rendezvous hashing; ascending member
 * order is part of the contract, ties go to the lexicographically
 * smallest member). Empty membership -> null. */
export function partitionOwner(
  members: readonly string[],
  partition: number,
  count?: number,
): string | null {
  if (!Number.isInteger(partition) || partition < 0) {
    throw new Error('partition indexes must be non-negative integers');
  }
  if (count !== undefined) {
    assertCount(count);
    if (partition >= count) {
      throw new Error("partition index exceeds the group's partition count");
    }
  }
  const ordered = sortMembers(members);
  const first = ordered[0];
  if (first === undefined) {
    return null;
  }
  let best = first;
  let bestScore = rendezvousScore(best, partition);
  for (const member of ordered.slice(1)) {
    const score = rendezvousScore(member, partition);
    if (score > bestScore) {
      best = member;
      bestScore = score;
    }
  }
  return best;
}

/** Full ownership table, member -> ascending partitions. The Python
 * `assignment` mirrored exactly: members sort first, so the table depends
 * on the member SET, not the order it arrived in; every partition appears
 * exactly once. */
export function assignment(
  members: readonly string[],
  count: number,
): PartitionTable {
  assertCount(count);
  const ordered = sortMembers(members);
  const table = new Map<string, number[]>();
  for (const member of ordered) {
    table.set(member, []);
  }
  if (ordered.length === 0) {
    return {};
  }
  for (let partition = 0; partition < count; partition += 1) {
    const owner = partitionOwner(ordered, partition);
    const bucket = owner === null ? undefined : table.get(owner);
    if (bucket !== undefined) {
      bucket.push(partition);
    }
  }
  const out: Record<string, number[]> = {};
  for (const [member, parts] of table) {
    if (parts.length > 0) {
      out[member] = parts;
    }
  }
  return out;
}

/** Does `member` own the partition of `key` in `table`? A member absent
 * from the table owns nothing - stale views defer, they never race. */
export function owns(
  table: PartitionTable,
  member: string,
  key: string,
  count: number,
): boolean {
  assertKey(key);
  assertCount(count);
  const parts = table[member];
  if (parts === undefined) {
    return false;
  }
  return parts.includes(partitionFor(key, count));
}

/** Diagnostic twin of Python `moved_by_membership`: every partition whose
 * ownership differs between the two membership lists. Rollouts read this;
 * the parity spec asserts the empty result for reordered sets. */
export function movedByMembership(
  before: readonly string[],
  after: readonly string[],
  count: number,
): Readonly<Record<number, MovedOwnership>> {
  assertCount(count);
  const owners = (table: PartitionTable): Map<number, string> => {
    const map = new Map<number, string>();
    for (const [member, parts] of Object.entries(table)) {
      for (const partition of parts) {
        map.set(partition, member);
      }
    }
    return map;
  };
  const beforeOwners = owners(assignment(before, count));
  const afterOwners = owners(assignment(after, count));
  const moved: Record<number, MovedOwnership> = {};
  for (let partition = 0; partition < count; partition += 1) {
    const b = beforeOwners.get(partition) ?? null;
    const a = afterOwners.get(partition) ?? null;
    if (b !== a) {
      moved[partition] = { before: b, after: a };
    }
  }
  return moved;
}
