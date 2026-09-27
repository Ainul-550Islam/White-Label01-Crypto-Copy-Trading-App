"""Partitioned work: the pure math that lets N identical workers share a
keyspace without anyone being in charge.

Two decisions carry the whole module, and both are about agreement rather
than cleverness:

* **The hash is CRC-32 over UTF-8, never ``hash()``.** Python's builtin hash
  is salted per process - every replica would compute a different partition
  for the same key, which is not a partition scheme but a rumour. CRC-32 is
  specified, tiny, and every runtime in this platform (CPython, Node) has an
  identical answer, which is why the fixture file can pin the table across
  languages.
* **Ownership is rendezvous hashing, not a consistent ring.** Membership here
  is tens of workers, not thousands of cache shards, so the O(members x
  partitions) scan runs at claim time and is free; there are no virtual
  nodes to tune, and - the property that actually matters operationally -
  adding or removing one worker moves exactly the partitions that worker won
  or lost, never a whole arc of the keyspace. A worker leaving mid-shift
  strands one partition's queue for one heartbeat, not a range of accounts.

Ordering property, stated because callers rely on it: all functions treat
``members`` as a SET - they sort first - so two processes that received the
membership list in different orders compute the same assignment. The
tie-break is the member string itself, ascending, so even equal CRC scores
resolve identically everywhere.

Nothing in this module touches Redis or any clock; this is arithmetic with
validation. The timed-claim half (who actually HOLDS a partition right now)
lives in :mod:`wlct_trading.coordination.lease` beside leader election,
because the renewal discipline is the same and one implementation of "check
the expiry, re-take if it is mine" is enough for the platform.
"""

from __future__ import annotations

import re
from typing import Mapping, Sequence

__all__ = [
    "MAX_PARTITIONS",
    "partition_for",
    "partition_owner",
    "assignment",
    "owns",
    "moved_by_membership",
]

#: A guard against `partition_count = 10**9` typos, not a scale limit: the
#: cost of one assignment is O(members x partitions), and beyond a few
#: thousand partitions a deployment has outgrown this scheme and should say
#: so loudly at boot rather than discover it in a slow tick.
MAX_PARTITIONS = 4096

_MEMBER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _score(member: str, partition: int) -> int:
    """Rendezvous weight: crc32("member|partition").

    The separator is '|' because member and partition are validated
    separately and no legal member contains '|', so ``a|b`` can never be
    re-parsed as some other (member, partition) pair.
    """
    import zlib  # local: keeps module import cost nil for pure users

    return zlib.crc32(f"{member}|{partition}".encode("utf-8"))


def _validated_key(key: str) -> str:
    if not isinstance(key, str) or key == "":
        raise ValueError("partition keys must be non-empty strings")
    return key


def _validated_count(count: int) -> int:
    if not isinstance(count, int) or isinstance(count, bool):
        raise ValueError("partition counts must be plain integers")
    if not 1 <= count <= MAX_PARTITIONS:
        raise ValueError(f"partition counts must be within 1..{MAX_PARTITIONS}")
    return count


def _sorted_members(members: Sequence[str]) -> tuple[str, ...]:
    if isinstance(members, str) or not isinstance(members, Sequence):
        raise ValueError("members must be a sequence of member tokens")
    out: list[str] = []
    for raw in members:
        if not isinstance(raw, str) or _MEMBER.fullmatch(raw) is None:
            raise ValueError(
                f"member {raw!r} is not a wire token (letters, digits, . _ : - ; "
                "1..128 chars; no '|' - rendezvous inputs must parse unambiguously)"
            )
        if "|" in raw:
            raise ValueError(f"member {raw!r} must not contain '|'")
        out.append(raw)
    if len(set(out)) != len(out):
        raise ValueError("member lists must not contain duplicates")
    return tuple(sorted(out))


def partition_for(key: str, count: int) -> int:
    """The partition a key belongs to. Pure, stable, cross-language.

    Keys are things like ``tenantId:accountId`` - whatever unit the caller
    needs serialised. Empty or over-long keys are rejected at the boundary
    so a mis-wired producer fails at the call, not as a silently skewed
    distribution.
    """
    _validated_key(key)
    count = _validated_count(count)
    import zlib

    return zlib.crc32(key.encode("utf-8")) % count


def partition_owner(
    members: Sequence[str], partition: int, *, count: int | None = None
) -> str | None:
    """Which member owns ``partition``, or None when no members exist.

    ``count`` is optional because rendezvous scoring does not depend on it -
    it is accepted (and validated) purely so callers can pass their group
    size for the guard that partition indexes are in range.
    """
    if not isinstance(partition, int) or isinstance(partition, bool):
        raise ValueError("partition indexes must be plain integers")
    if partition < 0:
        raise ValueError("partition indexes are non-negative")
    if count is not None:
        if partition >= _validated_count(count):
            raise ValueError("partition index exceeds the group's partition count")
    ordered = _sorted_members(members)
    if not ordered:
        return None
    best_member = ordered[0]
    best_score = _score(best_member, partition)
    for member in ordered[1:]:
        score = _score(member, partition)
        if score > best_score:
            best_member, best_score = member, score
        # equal scores: `ordered` is already ascending and the incumbent is
        # kept - "smaller member string wins" falls out of the scan order.
    return best_member


def assignment(
    members: Sequence[str], count: int
) -> Mapping[str, tuple[int, ...]]:
    """Full ownership table: member -> ascending tuple of partitions.

    Deterministic given the member SET (order-insensitive), complete (every
    partition appears exactly once across all members), and disjoint by
    construction. An empty membership list yields an empty mapping - the
    honest answer to "who owns things while nobody is up": nobody, and the
    workers' ``owns`` checks will (correctly) defer.
    """
    count = _validated_count(count)
    ordered = _sorted_members(members)
    if not ordered or count == 0:
        return {}
    table: dict[str, list[int]] = {member: [] for member in ordered}
    for partition in range(count):
        owner = partition_owner(ordered, partition)
        assert owner is not None  # ordered is non-empty
        table[owner].append(partition)
    return {member: tuple(parts) for member, parts in table.items() if parts}


def owns(table: Mapping[str, tuple[int, ...]], member: str, key: str, count: int) -> bool:
    """Does ``member`` own the partition of ``key`` in this assignment?

    Absent member -> False: a member not in the table owns nothing, which is
    exactly what a stale view should do (defer, campaign for claims, retry)
    instead of double-processing on the confidence of a list it did not
    compute.
    """
    return partition_for(_validated_key(key), count) in table.get(member, ())


def moved_by_membership(
    before: Sequence[str], after: Sequence[str], count: int
) -> Mapping[int, tuple[str | None, str | None]]:
    """Diagnostic: partition -> (owner_before, owner_after) for every
    partition where ownership CHANGED.

    This exists for two reasons. Tests use it to assert the rendezvous
    property (leaving a group moves only that member's partitions), and the
    worker console shows it during a rollout so "who moved where when node 3
    died" is a query with an obvious answer, not archaeology. The empty
    result for two orders of the same set is itself the order-independence
    proof operators are likely to want first.
    """
    count = _validated_count(count)
    left = assignment(before, count)
    right = assignment(after, count)
    def owners_of(
        table: Mapping[str, tuple[int, ...]],
    ) -> dict[int, str]:
        return {
            partition: member
            for member, parts in table.items()
            for partition in parts
        }

    before_owners, after_owners = owners_of(left), owners_of(right)
    return {
        partition: (before_owners.get(partition), after_owners.get(partition))
        for partition in range(count)
        if before_owners.get(partition) != after_owners.get(partition)
    }
