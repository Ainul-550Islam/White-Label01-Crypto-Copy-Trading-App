"""Self-registering worker membership (Part 12).

The coordination package's Part 11 law was: **membership says who WANTS a
partition; claims decide who HAS one.** Membership itself was config-declared
- correct, but it made fleet changes a coordinated config edit. This module
replaces the SOURCE of membership with a Redis-backed self-registration:
each worker heartbeats its id into one shared sorted set scored by expiry,
and live membership is that set pruned by the clock. Nothing else about the
law changes - claims remain the entire authority, and a stale or lying
membership entry can want a partition it cannot take.

The unit is MILLISECONDS here, not microseconds: the registry shares Redis's
own PTTL world (the claim TTLs are milliseconds too), and keeping one unit
inside the zset's score domain is worth the second time unit in the module -
the renewal law next door stays micros-pure. Mixed units meet only at the
caller's clock, which every runtime already reads in ms.

Design choices, each deliberate:

* **One port, three scripts.** The registry needs exactly ``EVAL`` with one
  key - the same structural surface the lock module defines - so production
  clients satisfy it without importing anything. No ``KEYS``/``SCAN``: key-
  space enumeration in scripts is non-determinism, and a fleet that scans is
  a fleet that argues with the cluster.
* **Staleness is Python law, not Lua luck.** ``members()`` returns the RAW
  scored set and :func:`live_members` applies the expiry rule. The pruning
  inside the ping script is housekeeping, never correctness: a caller that
  fetched the whole zset through ``redis-cli`` and applied this function gets
  the same answer the library computes. A rule locked inside a Lua script
  can only be tested by faking an interpreter; a pure function is pinned by
  fixtures against its TypeScript twin.
* **Failure degrades to fallback, never to a throw.** ``ping()``/``members()``
  answer ``None`` on transport trouble (claims-law: a blip costs deferrals,
  not an exception on the money-adjacent path), and ``resign()`` answers
  ``False`` with expiry as the safety net - the same trades PartitionClaims
  makes, for the same reasons.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from wlct_trading.coordination import lease as _lease
from wlct_trading.coordination import partitions as _partitions
from wlct_trading.redis_keys import RedisKeys

# The identity grammar is ONE rule for the whole coordination plane: names a
# worker puts in a zset must be names the claim scripts already accept. Both
# borrows go to the module where the rule is DEFINED (partitions owns the
# token regex, lease owns the name validator); reaching them through module
# attributes instead of re-importing keeps lease's re-export chain honest -
# membership consumes the internals, it does not get to widen anyone's public
# surface.
_MEMBER_GRAMMAR = _partitions._MEMBER
_validated_name = _lease._validated_name

__all__ = [
    "MEMBERSHIP_PING_SCRIPT",
    "MEMBERSHIP_RESIGN_SCRIPT",
    "MEMBERSHIP_SNAPSHOT_SCRIPT",
    "MembershipRegistry",
    "heartbeat_expiry",
    "live_members",
]


class MembershipEvalClient(Protocol):
    """The structural subset a registry needs: EVAL with one key, any reply.

    Declared separately from the lock port on purpose - membership is not
    mutual exclusion, and borrowing that protocol would invite someone to
    "simplify" the two into one surface. They evolve apart.
    """

    async def eval(self, script: str, numkeys: int, *args: str) -> object: ...


#: Prune expired, register (strictly-forward so a delayed replay cannot
#: shorten a fresher heartbeat), then return the live set - one round trip
#: per tick. ZADD's GT flag needs Redis 6.2+, which the platform's own pins
#: already require elsewhere; the fake interprets by exact text, same law.
MEMBERSHIP_PING_SCRIPT = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZADD', KEYS[1], 'GT', ARGV[2], ARGV[3])
return redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
"""

#: A pure read: EXISTS-guarded so an absent group never even touches the
#: read path's write-intent, and no pruning - reads never mutate, whatever
#: the housekeeping in the ping script does.
MEMBERSHIP_SNAPSHOT_SCRIPT = """
if redis.call('EXISTS', KEYS[1]) == 0 then
    return {}
end
return redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
"""

#: Best-effort leave. The expiry law already handles everything a lost ZREM
#: would have done; this only removes the wait.
MEMBERSHIP_RESIGN_SCRIPT = """
redis.call('ZREM', KEYS[1], ARGV[1])
return redis.call('ZCARD', KEYS[1])
"""


def heartbeat_expiry(now_millis: int, ttl_millis: int) -> int:
    """The score a heartbeat carries: when this member stops being live.

    The plain-integer law mirrors :func:`renew_due_micros`'s discipline -
    bools are rejected, because ``True`` as a TTL is a config bug that must
    die at construction, not age into a 1-millisecond membership.
    """
    for name, value in (("now_millis", now_millis), ("ttl_millis", ttl_millis)):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{name} must be a plain integer of milliseconds, got {value!r}")
    if now_millis < 0:
        raise ValueError("now_millis must be a non-negative epoch in milliseconds")
    if ttl_millis < 1_000:
        raise ValueError("membership TTLs below one second flap on network jitter")
    # now and ttl share the millisecond domain (unlike the renewal law, whose
    # interval is millis against a micros clock): expiry is plain addition.
    # The fixture generator caught this exact unit confusion on first run -
    # which is what generator-side verification of pinned rows is for.
    return now_millis + ttl_millis


def live_members(
    scored: Iterable[tuple[str, int]], now_millis: int
) -> tuple[str, ...]:
    """Apply the expiry law to a raw ``ZRANGE ... WITHSCORES`` reply.

    Entries are ``(member, expiry_millis)``; a member is live while its
    expiry is STRICTLY greater than now - expiring exactly at the sampling
    instant means expired, which is the conservative reading and the one the
    fixtures pin. Duplicates (a pathological reply from a replicating
    replica) resolve to the member's maximum expiry, so a fleet reading at
    slightly different times sees the same superset logic, and the result is
    sorted: membership must be order-insensitive exactly as
    :func:`~wlct_trading.coordination.partitions.partition_owner` requires it
    to be.
    """
    if isinstance(now_millis, bool) or not isinstance(now_millis, int):
        raise ValueError(f"now_millis must be a plain integer of milliseconds, got {now_millis!r}")
    best: dict[str, int] = {}
    for entry in scored:
        if (
            not isinstance(entry, tuple)
            or len(entry) != 2
            or not isinstance(entry[0], str)
            or isinstance(entry[1], bool)
            or not isinstance(entry[1], int)
        ):
            raise ValueError(f"membership entry must be a (str, int) pair, got {entry!r}")
        member, expiry = entry
        if _MEMBER_GRAMMAR.fullmatch(member) is None:
            raise ValueError(f"membership entry {member!r} is not a member token")
        current = best.get(member)
        if current is None or expiry > current:
            best[member] = expiry
    return tuple(sorted(name for name, expiry in best.items() if expiry > now_millis))


class MembershipRegistry:
    """Heartbeat-based self-registration for one member of one group.

    Each worker: ``ping()`` once per coordination tick, read the reply (or
    ``members()`` between its own ticks), feed the live set to
    :func:`~wlct_trading.coordination.partitions.assignment`. A worker that
    stops heartbeating ages out within the TTL and the fleet reassigns
    AROUND it - the departure moves only its partitions, which is the
    rendezvous property Part 11 pinned in ``moved_by_membership``.

    TTL law (the caller's config must enforce the pairing, as the schema's
    cross-field rule does): the TTL must exceed two full tick cadences, or a
    single lost ping demotes a live worker from membership while its claims
    are still fresh - churn with no safety gain.
    """

    __slots__ = ("_client", "_group", "_member", "_ttl_millis")

    def __init__(
        self,
        client: MembershipEvalClient,
        *,
        group: str,
        member: str,
        ttl_millis: int = 15_000,
    ) -> None:
        self._client = client
        self._group = _validated_name(group, "coordination group")
        if _MEMBER_GRAMMAR.fullmatch(member) is None:
            raise ValueError(
                f"member {member!r} is not a member token (letters, digits, "
                "'.', '_', '-' or ':'; 1..128 chars - the same grammar claims use)"
            )
        self._member = member  # validated above by the grammar check
        if isinstance(ttl_millis, bool) or not isinstance(ttl_millis, int):
            raise ValueError("membership TTL must be a plain integer of milliseconds")
        if ttl_millis < 1_000:
            raise ValueError("membership TTLs below one second flap on network jitter")
        self._ttl_millis = ttl_millis

    @property
    def key(self) -> str:
        return RedisKeys.membership_registry(self._group)

    async def ping(self, now_millis: int) -> tuple[str, ...]:
        """Heartbeat and return the live membership from the same reply.

        Unlike :meth:`members`, ``ping`` PROPAGATES transport errors: it
        runs inside the worker's coordination tick, where a failed
        heartbeat is exactly the fact that must trigger the caller's
        config-fallback path (and its log line). Swallowing it here would
        turn "the registry is down" into "I appear to be the only member" -
        the one misreading this class must never enable.
        """
        expiry = heartbeat_expiry(now_millis, self._ttl_millis)
        reply = await self._client.eval(
            MEMBERSHIP_PING_SCRIPT,
            1,
            self.key,
            str(now_millis),
            str(expiry),
            self._member,
        )
        return _parse_member_reply(reply, now_millis)

    async def members(self, now_millis: int) -> tuple[str, ...] | None:
        """Live membership, or ``None`` when the read failed.

        ``None`` means UNKNOWN - the caller must fall back to its last
        known set (or config), and the claims layer stays the authority.
        An empty tuple means the fleet is exactly this reader, or nothing
        else is heartbeating: different fact, different response.
        """
        try:
            # No now-argument: the read is raw, and the clock law is applied
            # client-side by live_members - passing an ARGV the script never
            # reads would imply a Lua-side staleness decision that does not
            # (and must not) exist.
            reply = await self._client.eval(MEMBERSHIP_SNAPSHOT_SCRIPT, 1, self.key)
        except Exception:
            return None
        return _parse_member_reply(reply, now_millis)

    async def resign(self) -> bool:
        """Leave, best-effort: expiry is the safety net for a lost ZREM."""
        try:
            await self._client.eval(MEMBERSHIP_RESIGN_SCRIPT, 1, self.key, self._member)
        except Exception:
            return False
        return True


def _parse_member_reply(reply: object, now_millis: int) -> tuple[str, ...]:
    """Coerce an EVAL reply (flat ``[name, score, ...]``; bytes or str,
    int or str scores) into the pair form :func:`live_members` lawfully
    consumes. Byte-decode tolerance exists because redis-py's
    ``decode_responses`` is the caller's choice, not this module's."""
    if reply is None:
        return ()
    if not isinstance(reply, (list, tuple)):
        raise ValueError(f"membership reply must be a flat array, got {reply!r}")
    items = list(reply)
    if len(items) % 2 != 0:
        raise ValueError("membership reply has an odd number of elements")
    pairs: list[tuple[str, int]] = []
    for raw_name, raw_score in zip(items[0::2], items[1::2], strict=True):
        name = raw_name.decode("ascii") if isinstance(raw_name, bytes) else str(raw_name)
        score = int(raw_score)
        pairs.append((name, score))
    return live_members(pairs, now_millis)
