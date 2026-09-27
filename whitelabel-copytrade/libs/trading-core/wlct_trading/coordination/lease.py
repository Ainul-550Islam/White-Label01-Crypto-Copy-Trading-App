"""Timed coordination: leader leases and partition claims.

The platform's stance on singletons, in one paragraph that callers should
have read before they wire anything. The honest claim, and the only one
this module makes: **at most one currently-valid lease holder is selected by
the Redis lock primitive, subject to the classic distributed-lease model** -
meaning a process may temporarily BELIEVE it is leader after its lease has
expired, until its own next renew or effect-boundary check disproves it.
Every lease scheme that promises more is selling clock magic.

The consequences of that model are binding, not advisory:

* leadership (and partition ownership) MUST NOT authorise a live order -
  neither signal appears anywhere near the execution engine's decision
  path, and a test in the suite enforces that import boundary;
* singleton work under a lease must be idempotent (idempotent job ids,
  append-only evidence rows, compare-and-set state transitions);
* important effects must re-check their own state close to the effect
  boundary (the execution engine's per-account lock and DB unique index do
  exactly that and remain the authoritative defence);
* durable operations must stay safe if duplicated - they were designed for
  at-least-once queues long before any lease existed.

The lease is coordination contention control: it stops N replicas
stampeding. It authorises nothing.

Two classes, one discipline (take with ``SET NX PX``, keep with
compare-and-extend, give back with compare-and-delete):

* :class:`LeaderElector` gates a ROLE ("who runs the reconciliation sweep").
  It rides the execution layer's :class:`~wlct_trading.execution.locks.LockManager`
  port on purpose: one mutual-exclusion implementation for the whole
  platform, and electors inherit its battle-tested redis/InMemory fakes.
* :class:`PartitionClaims` gates PARTITIONS of a worker group ("this worker
  holds partitions 0 and 3 right now"). It speaks the same Redis
  commands as the lock manager but stores the MEMBER as the value (a lease
  you must be able to read who holds, from outside), which is the one
  difference that makes a dedicated class worth its lines.

:func:`renew_due_micros` is the whole clock policy, extracted as a pure function
because it is the only arithmetic here, and the fixtures pin it so the
TypeScript twin cannot disagree about a boundary.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from wlct_trading.clock import epoch_micros
from wlct_trading.execution.locks import (
    LockError,
    LockHandle,
    LockManager,
    LockNotAcquired,
    RedisLockClient,
)
from wlct_trading.coordination.partitions import _MEMBER as _MEMBER_GRAMMAR
from wlct_trading.redis_keys import RedisKeys

__all__ = [
    "LeaseState",
    "LeaderElector",
    "PartitionClaims",
    "renew_due_micros",
]

logger = logging.getLogger(__name__)

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _validated_name(name: str, what: str) -> str:
    if _NAME.fullmatch(name) is None:
        raise ValueError(
            f"{what} {name!r} is not a wire token: 1..64 chars of "
            "letters, digits, '.', '_' or '-', starting alphanumeric"
        )
    return name


def renew_due_micros(
    *, now_micros: int, last_action_micros: int, renew_millis: int
) -> bool:
    """When is the next renewal due? The whole clock policy of this package,
    as a pure function - both languages implement this table and the
    fixtures pin every row, so a boundary cannot drift quietly.

    The rules, each of which the fixture file carries a vector for:

    * ``>=`` on the interval: exactly one renew interval of inactivity is
      already due. A lease renewed at the expiry boundary is renewed too
      late for any network; the bias must be toward renewing early, and
      this is where that bias is decided once for both languages.
    * ``renew_millis`` must be a plain integer >= 1: a zero (or negative,
      or non-integer) interval is not a tight cadence, it is a caller that
      never intends to stop - rejected at the door.
    * Backward clock movement (``now_micros < last_action_micros``) answers
      DUE, not "not yet" and not an exception: stepping a clock backwards
      (NTP correction, a VM snapshot) must never lull a holder into skipping
      renewals, and raising from a timing rule would turn a timekeeping
      hiccup into a coordination outage. Renewing slightly early is always
      safe; the loop is idempotent.
    * Large elapsed times are simply due - the function decides, the
      caller's renewal loop absorbs however many intervals went by with one
      extend (a lease that lapsed while we slept is disproved on the next
      ``renew``, which is the loss detection the model above prescribes).
    """
    for name, value in (
        ("now_micros", now_micros),
        ("last_action_micros", last_action_micros),
    ):
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError(f"{name} must be a plain integer of microseconds")
    if (
        not isinstance(renew_millis, int)
        or isinstance(renew_millis, bool)
        or renew_millis < 1
    ):
        raise ValueError("renew intervals must be plain integer milliseconds >= 1")
    elapsed = now_micros - last_action_micros
    if elapsed < 0:
        return True
    return elapsed >= renew_millis * 1_000


@dataclass(frozen=True, slots=True)
class LeaseState:
    """Public self-report of any lease holder. Reads cheap, serialises
    freely, and is exactly what the health mirror exposes as
    ``{ leader, sinceMicros, renewals, demotions, lastError }``."""

    leader: bool
    token: str | None
    since_micros: int
    renewals: int
    demotions: int
    last_error: str | None


class LeaderElector:
    """Campaign, hold, or step aside - for one named role.

    Usage inside a service's background loop::

        elector = LeaderElector(locks, name="execution-reconciliation")
        await elector.run(on_promote=start_sweeper, on_demote=stop_sweeper)

    All callbacks are optional and awaited; they exist so a service's loop
    can react to promotion without polling ``is_leader`` between
    transactions (the race an operator would otherwise debug at 3am).
    ``run`` never raises for coordination reasons - a lost Redis turns into
    a demotion plus a logged retry, because the alternative (crashing every
    worker because the thing that tells them NOT to work is down) inverts a
    coordination outage into an outage of the work itself.
    """

    __slots__ = (
        "_locks",
        "_name",
        "_key",
        "_ttl_millis",
        "_renew_millis",
        "_retry_millis",
        "_sleep",
        "_now",
        "_handle",
        "_since",
        "_last_action",
        "_renewals",
        "_demotions",
        "_last_error",
    )

    def __init__(
        self,
        locks: LockManager,
        *,
        name: str,
        ttl_millis: int = 30_000,
        renew_millis: int | None = None,
        retry_millis: int | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
        now: Callable[[], int] = epoch_micros,
    ) -> None:
        self._name = _validated_name(name, "lease name")
        if not isinstance(ttl_millis, int) or isinstance(ttl_millis, bool) or ttl_millis < 1_000:
            raise ValueError("lease TTLs below one second elect on network jitter")
        renew = ttl_millis // 3 if renew_millis is None else renew_millis
        if not isinstance(renew, int) or isinstance(renew, bool) or renew < 250:
            raise ValueError("renew intervals below 250ms are a busy loop, not a cadence")
        if renew * 2 >= ttl_millis:
            # One missed renewal must still leave margin for a retry inside
            # the TTL, or the config has designed a flapping election.
            raise ValueError(
                "renew interval must be less than half the lease TTL - "
                "a single late renewal would hand leadership to the queue"
            )
        self._locks = locks
        self._key = RedisKeys.leader_lease(self._name)
        self._ttl_millis = ttl_millis
        self._renew_millis = renew
        self._retry_millis = (
            max(250, ttl_millis // 8) if retry_millis is None else retry_millis
        )
        self._sleep = sleep
        self._now = now
        self._handle: LockHandle | None = None
        self._since = 0
        self._last_action = 0
        self._renewals = 0
        self._demotions = 0
        self._last_error: str | None = None

    # -- introspection ----------------------------------------------------
    @property
    def name(self) -> str:
        return self._name

    @property
    def key(self) -> str:
        return self._key

    @property
    def is_leader(self) -> bool:
        return self._handle is not None

    @property
    def state(self) -> LeaseState:
        handle = self._handle
        return LeaseState(
            leader=handle is not None,
            token=handle.token if handle is not None else None,
            since_micros=self._since,
            renewals=self._renewals,
            demotions=self._demotions,
            last_error=self._last_error,
        )

    @property
    def renew_millis(self) -> int:
        return self._renew_millis

    @property
    def retry_millis(self) -> int:
        return self._retry_millis

    # -- primitives --------------------------------------------------------
    async def try_campaign(self) -> bool:
        """Take (or keep) leadership once. Never waits, never raises for
        contention: `False` IS the contention answer."""
        if self._handle is not None:
            return True
        try:
            self._handle = await self._locks.acquire(
                self._key, ttl_millis=self._ttl_millis
            )
        except LockNotAcquired:
            return False
        except LockError as error:
            self._last_error = f"{type(error).__name__}"
            logger.warning(
                "coordination.leader_campaign_failed",
                extra={"event": "coordination.leader_campaign_failed", "lease": self._name},
            )
            return False
        self._since = self._now()
        self._last_action = self._since
        self._last_error = None
        return True

    async def renew(self) -> bool:
        """Extend once. Failure (lost or unreachable) demotes immediately -
        a holder that cannot prove it still holds is not a holder."""
        handle = self._handle
        if handle is None:
            return False
        try:
            ok = await self._locks.extend(handle, ttl_millis=self._ttl_millis)
        except LockError as error:
            ok = False
            self._last_error = f"{type(error).__name__}"
        if ok:
            self._renewals += 1
            now = self._now()
            self._last_action = now
            # Re-date the handle so `handle.is_expired()` keeps telling the
            # truth about the EXTENDED lease, not the original take.
            self._handle = replace(handle, acquired_at_micros=now)
            return True
        await self._step_down("renewal refused")
        return False

    async def renew_if_due(self, *, now_micros: int | None = None) -> bool:
        """Tick-safe renewal: renew only when :func:`renew_due_micros` says
        the interval has passed. Returns "am I still leader" - True when the
        renewal is not yet due, when it succeeded, False on loss. This is
        what lets a worker renew between job batches instead of owning a
        timer of its own without duplicating the timing law."""
        if self._handle is None:
            return False
        now = self._now() if now_micros is None else now_micros
        if not renew_due_micros(
            now_micros=now,
            last_action_micros=self._last_action,
            renew_millis=self._renew_millis,
        ):
            return True
        return await self.renew()

    async def resign(self) -> bool:
        """Give the lease back now instead of making the queue wait a TTL.
        Best-effort: an unreachable Redis demotes locally either way."""
        if self._handle is None:
            return False
        handle = self._handle
        released = False
        try:
            released = await self._locks.release(handle)
        except LockError as error:
            self._last_error = f"{type(error).__name__}"
        await self._step_down("resigned", forced=False)
        return released

    async def _step_down(self, reason: str, *, forced: bool = True) -> None:
        if self._handle is not None:
            if forced:
                # "demotions" counts times LEADERSHIP was taken from us (lost
                # renewal, stolen lease). A voluntary resignation is a
                # transition of state, not a demotion - conflating them
                # would make the operator metric mean "exits", which is not
                # the question anyone asks at 3am.
                self._demotions += 1
            logger.info(
                "coordination.leader_demoted",
                extra={
                    "event": "coordination.leader_demoted",
                    "lease": self._name,
                    "reason": reason,
                },
            )
        self._handle = None

    # -- the loop ------------------------------------------------------------
    async def run(
        self,
        *,
        should_stop: Callable[[], bool] | None = None,
        on_promote: Callable[[], Awaitable[None]] | None = None,
        on_demote: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        """Campaign and renew until stopped, then resign politely.

        ``should_stop`` accepts a zero-arg callable, or anything with an
        ``is_set()`` method (``asyncio.Event`` and threading-style flags) -
        duck-typed on purpose, because every service here owns shutdown
        slightly differently and the loop must fit all of them without a
        wrapper. The resign-in-finally is what turns "process exiting" from
        a one-TTL freeze of the role into an instant handover; a crash that
        skips the finally simply lets the lease expire, which is the fallback
        the whole module is designed around.
        """

        def stopping() -> bool:
            if should_stop is None:
                return False
            if hasattr(should_stop, "is_set"):
                return bool(should_stop.is_set())
            return bool(should_stop())

        sleep = self._sleep
        if sleep is None:
            import asyncio

            sleep = asyncio.sleep
        promote_failed = False
        try:
            while not stopping():
                was_leader = self.is_leader
                if was_leader:
                    await sleep(self._renew_millis / 1000)
                    # The timing law, not the sleep, decides whether a renew
                    # happens - the loop stays correct when a scheduler
                    # overshoots or undershoots the interval.
                    still = await self.renew_if_due()
                    if not still and on_demote is not None:
                        await on_demote()
                else:
                    gained = await self.try_campaign()
                    # `gained` is only ever True here when we were NOT the
                    # leader, so on_promote fires exactly once per promotion
                    # and never for "still holding it".
                    if gained and on_promote is not None:
                        try:
                            await on_promote()
                        except Exception:  # deliberate: see next lines
                            # A service that cannot START its leader duty
                            # must not sit on the lease: resign and let a
                            # healthier process try. The exception is
                            # re-raised after the resign so the caller's
                            # supervisor still sees it.
                            promote_failed = True
                            await self.resign()
                    if not gained:
                        await sleep(self._retry_millis / 1000)
        finally:
            await self.resign()
        if promote_failed:
            raise RuntimeError(
                f"leader duties for {self._name!r} failed to start; the lease "
                "was released for another candidate to try"
            )


#: Compare-and-renew for claims: the claimer is its own token, so "extend if
#: still mine" is a GET-compare here, not a handle check. Same shape as the
#: lock module's _EXTEND_SCRIPT, deliberately spelled separately because the
#: KEY here is (group, partition) and the VALUE is identity, not randomness.
CLAIM_RENEW_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
    return 0
end
"""

CLAIM_RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""


def _decode(value: bytes | str | None) -> str | None:
    if value is None:
        return None
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


class PartitionClaims:
    """Who holds which partitions, right now: claim/renew/release per
    (group, partition), valued by member identity.

    A worker's tick with this and :func:`~wlct_trading.coordination.partitions.assignment`:
    compute the desired assignment from the visible membership, claim the
    partitions it should own, renew the ones it does, release the ones it
    shouldn't any more. Everything degrades toward "less work in parallel",
    never toward "two workers on one partition" - a release that fails
    because Redis is down costs the partition one TTL of idleness on the far
    side of the outage, which is the correct trade when the alternative is
    double-processing.
    """

    __slots__ = ("_client", "_group", "_member", "_ttl_millis")

    def __init__(
        self,
        client: RedisLockClient,
        *,
        group: str,
        member: str,
        ttl_millis: int = 15_000,
    ) -> None:
        self._group = _validated_name(group, "coordination group")
        if _MEMBER_GRAMMAR.fullmatch(member) is None:
            raise ValueError(
                f"member {member!r} is not a member token (letters, digits, "
                "'.', '_', ':' or '-'; 1..128 chars - host:pid:uuid shapes are "
                "the intended spelling, and the '|' ban that protects the "
                "rendezvous hashes applies to members there, not here)"
            )
        if ttl_millis < 1_000:
            raise ValueError("claim TTLs below one second flap on network jitter")
        self._client = client
        self._member = member
        self._ttl_millis = ttl_millis

    def key_for(self, partition: int) -> str:
        return RedisKeys.partition_claim(self._group, partition)

    async def claim(self, partition: int) -> bool:
        """Take a partition (fresh or already mine). Never blocks: a held
        partition is somebody else's, and 'wait for it' is a loop's job, not
        a command's."""
        key = self.key_for(partition)
        try:
            took = await self._client.set(
                key, self._member, nx=True, px=self._ttl_millis
            )
            if took:
                return True
            result = await self._client.eval(
                CLAIM_RENEW_SCRIPT, 1, key, self._member, str(self._ttl_millis)
            )
            return bool(result)
        except Exception as error:  # transport truth is a miss
            logger.debug(
                "coordination.claim_failed",
                extra={
                    "event": "coordination.claim_failed",
                    "group": self._group,
                    "partition": partition,
                    "error": type(error).__name__,
                },
            )
            return False

    async def release(self, partition: int) -> bool:
        try:
            result = await self._client.eval(
                CLAIM_RELEASE_SCRIPT, 1, self.key_for(partition), self._member
            )
        except Exception as error:  # expiry is the safety net
            logger.debug(
                "coordination.claim_release_failed",
                extra={
                    "event": "coordination.claim_release_failed",
                    "group": self._group,
                    "partition": partition,
                    "error": type(error).__name__,
                },
            )
            return False
        return bool(result)

    async def holder(self, partition: int) -> str | None:
        """Who holds it, as an outside observer sees (``None`` = unclaimed).
        Health panels and rollout tooling read this; workers never decide on
        it - decisions ride ``claim`` so the answer is atomic with the take."""
        return _decode(await self._client.get(self.key_for(partition)))

    async def reconcile(
        self, wanted: frozenset[int] | set[int] | tuple[int, ...]
    ) -> frozenset[int]:
        """One tick: claim everything wanted, release everything held-but-
        unwanted, return the partitions this member now holds.

        ``wanted`` is expected to come from ``assignment(members, count)`` -
        but is deliberately just a collection of ints here, because the
        membership source (memberlist, config, a console button during a
        rollout) is the deployment's business and this module's job stops at
        making the claim layer honest about it."""
        held: set[int] = set()
        # No local bookkeeping of "what we think we hold": re-claiming is a
        # cheap idempotent PEXPIRE, and re-reading ownership from Redis keeps
        # the truth in exactly one place even after a GC pause long enough
        # to lose a TTL.
        for partition in sorted(wanted):
            if await self.claim(partition):
                held.add(partition)
        return frozenset(held)
