"""Execution locks.

Two workers must never submit for the same order, and two reconciliation passes
must never repair the same account at the same time. The idempotency key stops
a *duplicate order* reaching the venue; a lock stops the more subtle failure
where two workers interleave reads and writes of the same order's state and
each overwrites the other's conclusion.

The abstraction is a small port with two implementations:

* :class:`InMemoryLockManager` — single process. Correct within one event loop
  and honest about its limits: it says so in :attr:`is_distributed`.
* :class:`RedisLockManager` — the real one. ``SET key token NX PX ttl`` to
  acquire, and a compare-and-delete to release so a lock whose TTL expired
  mid-work cannot be released by its original (now stale) owner and handed to
  a third party.

Every lock carries a TTL. A lock without one survives the crash of the process
holding it and blocks the account forever, which in a trading system means an
open position nobody can close.
"""

from __future__ import annotations

import asyncio
import secrets
from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Awaitable, Callable, Protocol, runtime_checkable

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId
from wlct_trading.redis_keys import RedisKeys

__all__ = [
    "LockError",
    "LockNotAcquired",
    "LockHandle",
    "LockManager",
    "InMemoryLockManager",
    "RedisLockManager",
    "RedisLockClient",
    "FencingClient",
    "order_lock_key",
    "account_lock_key",
    "reconciliation_lock_key",
    "FencedLockManager",
]


class LockError(Exception):
    """Base class for locking failures."""


class LockNotAcquired(LockError):
    """The lock is held elsewhere and was not acquired within the timeout.

    Treated as a hard stop by the execution engine. Proceeding without the lock
    would mean two workers acting on one order.
    """

    def __init__(self, key: str, holder_hint: str | None = None) -> None:
        self.key = key
        self.holder_hint = holder_hint
        suffix = f" (held by {holder_hint})" if holder_hint else ""
        super().__init__(
            f"Could not acquire execution lock {key!r}{suffix}. Another worker is "
            f"already acting on this order or account; refusing to proceed "
            f"concurrently."
        )


# ----------------------------------------------------------------------
# Key builders
# ----------------------------------------------------------------------
# Thin aliases over the central key registry. Every Redis key in the platform is
# built in one module; these exist so the execution code reads naturally without
# a second place where key strings are spelled out.


def order_lock_key(tenant_id: str, order_id: str) -> str:
    """Serialises all state changes for one order."""
    return RedisKeys.order_lock(tenant_id, order_id)


def account_lock_key(tenant_id: str, account_id: str) -> str:
    """Serialises submission for one account.

    Held only for the duration of a submit, never across a whole strategy tick,
    or one slow venue would stall an entire account's throughput.
    """
    return RedisKeys.account_lock(tenant_id, account_id)


def reconciliation_lock_key(
    tenant_id: str, account_id: str, exchange: ExchangeId
) -> str:
    """Ensures exactly one reconciliation pass per account at a time."""
    return RedisKeys.reconciliation_lock(tenant_id, account_id, exchange)


@dataclass(frozen=True, slots=True)
class LockHandle:
    """Proof of ownership.

    The ``token`` is what makes release safe: only the holder that wrote this
    exact token may delete the key.

    The optional ``fencing_token`` is a monotonically increasing integer that
    advances with each acquisition of the same lock key. A stale worker that
    resumes with an old fencing token can be detected and rejected because the
    token value will be lower than the current generation.
    """

    key: str
    token: str
    acquired_at_micros: int
    ttl_millis: int
    fencing_token: int = 0

    @property
    def expires_at_micros(self) -> int:
        return self.acquired_at_micros + self.ttl_millis * 1_000

    def is_expired(self, *, now_micros: int | None = None) -> bool:
        now = epoch_micros() if now_micros is None else now_micros
        return now >= self.expires_at_micros


@runtime_checkable
class RedisLockClient(Protocol):
    """The subset of a Redis client this module needs.

    Declared structurally so ``redis.asyncio.Redis`` satisfies it without
    trading-core taking a dependency on the redis package.
    """

    async def set(
        self,
        name: str,
        value: str,
        *,
        nx: bool = False,
        px: int | None = None,
    ) -> bool | None:
        ...

    async def get(self, name: str) -> bytes | str | None:
        ...

    async def eval(self, script: str, numkeys: int, *args: str) -> object:
        ...


@runtime_checkable
class FencingClient(Protocol):
    """The one Redis verb fencing tokens need: a counter via EVAL.

    Structural, like :class:`RedisLockClient`, so ``redis.asyncio.Redis``
    (and the staging rehearsal's minimal client) satisfy it without this
    module importing a driver. Declared because the fencing client was
    typed ``object`` - which told mypy nothing and told a reader less.
    """

    async def eval(self, script: str, numkeys: int, *args: str) -> object:
        ...


class LockManager(ABC):
    """Port for mutual exclusion across execution workers."""

    @property
    @abstractmethod
    def is_distributed(self) -> bool:
        """Whether this manager is safe across processes.

        Checked at startup: a multi-worker live deployment running on an
        in-memory manager is a correctness bug waiting for its first duplicate
        submission, and the engine refuses to start in that combination.
        """

    @abstractmethod
    async def acquire(
        self,
        key: str,
        *,
        ttl_millis: int = 10_000,
        wait_millis: int = 0,
    ) -> LockHandle:
        """Acquire ``key`` or raise :class:`LockNotAcquired`."""

    @abstractmethod
    async def release(self, handle: LockHandle) -> bool:
        """Release a held lock. Returns whether this holder still owned it."""

    @abstractmethod
    async def extend(self, handle: LockHandle, *, ttl_millis: int) -> bool:
        """Extend a held lock's TTL. Returns whether the extension applied."""

    @asynccontextmanager
    async def hold(
        self,
        key: str,
        *,
        ttl_millis: int = 10_000,
        wait_millis: int = 0,
    ) -> AsyncIterator[LockHandle]:
        """Scoped acquire/release.

        Release runs in a ``finally`` and never raises: a failure to release is
        logged by the caller but must not mask the exception that caused the
        unwinding, and the TTL will clean up regardless.
        """
        handle = await self.acquire(key, ttl_millis=ttl_millis, wait_millis=wait_millis)
        try:
            yield handle
        finally:
            try:
                await self.release(handle)
            except Exception:  # noqa: BLE001 - never mask the original error
                pass


class InMemoryLockManager(LockManager):
    """Single-process lock manager.

    Backed by an expiry-aware dict rather than :class:`asyncio.Lock` so that TTL
    semantics match the Redis implementation exactly and tests exercise the same
    expiry behaviour.
    """

    __slots__ = ("_held", "_guard")

    def __init__(self) -> None:
        self._held: dict[str, LockHandle] = {}
        self._guard = asyncio.Lock()

    @property
    def is_distributed(self) -> bool:
        return False

    async def acquire(
        self,
        key: str,
        *,
        ttl_millis: int = 10_000,
        wait_millis: int = 0,
    ) -> LockHandle:
        if ttl_millis <= 0:
            raise ValueError("Locks must have a positive TTL.")
        deadline_micros = epoch_micros() + wait_millis * 1_000
        while True:
            async with self._guard:
                now = epoch_micros()
                existing = self._held.get(key)
                if existing is None or existing.is_expired(now_micros=now):
                    handle = LockHandle(
                        key=key,
                        token=secrets.token_hex(16),
                        acquired_at_micros=now,
                        ttl_millis=ttl_millis,
                    )
                    self._held[key] = handle
                    return handle
            if epoch_micros() >= deadline_micros:
                raise LockNotAcquired(key)
            await asyncio.sleep(0.005)

    async def release(self, handle: LockHandle) -> bool:
        async with self._guard:
            existing = self._held.get(handle.key)
            if existing is not None and existing.token == handle.token:
                del self._held[handle.key]
                return True
            return False

    async def extend(self, handle: LockHandle, *, ttl_millis: int) -> bool:
        async with self._guard:
            existing = self._held.get(handle.key)
            if existing is None or existing.token != handle.token:
                return False
            self._held[handle.key] = LockHandle(
                key=handle.key,
                token=handle.token,
                acquired_at_micros=epoch_micros(),
                ttl_millis=ttl_millis,
            )
            return True


#: Compare-and-delete. Deleting without checking the token would let a holder
#: whose lock already expired delete a lock now legitimately owned by someone
#: else — the classic distributed-lock foot-gun.
_RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""

#: Compare-and-extend, same reasoning.
_EXTEND_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
    return 0
end
"""


class RedisLockManager(LockManager):
    """Distributed lock over a single Redis instance.

    Deliberately not Redlock. Redlock's multi-instance quorum buys protection
    against a single Redis failing, at the cost of complexity and a well-known
    dependence on bounded clock drift. This platform already treats Redis as
    hot state with PostgreSQL as the durable record, and the lock is a
    performance guard in front of two authoritative defences — the unique index
    on ``(tenant_id, client_order_id)`` and the venue's own idempotency. A
    single-instance lock is the right amount of machinery for that role.
    """

    __slots__ = ("_client", "_sleep")

    def __init__(
        self,
        client: RedisLockClient,
        *,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        self._client = client
        self._sleep = sleep or asyncio.sleep

    @property
    def is_distributed(self) -> bool:
        return True

    async def acquire(
        self,
        key: str,
        *,
        ttl_millis: int = 10_000,
        wait_millis: int = 0,
    ) -> LockHandle:
        if ttl_millis <= 0:
            raise ValueError("Locks must have a positive TTL.")
        token = secrets.token_hex(16)
        deadline_micros = epoch_micros() + wait_millis * 1_000

        while True:
            try:
                acquired = await self._client.set(
                    key, token, nx=True, px=ttl_millis
                )
            except Exception as exc:  # noqa: BLE001
                raise LockError(
                    f"Redis rejected a lock acquisition for {key!r}: "
                    f"{type(exc).__name__}. Refusing to proceed without the lock."
                ) from exc

            if acquired:
                return LockHandle(
                    key=key,
                    token=token,
                    acquired_at_micros=epoch_micros(),
                    ttl_millis=ttl_millis,
                )

            if epoch_micros() >= deadline_micros:
                holder = None
                try:
                    raw = await self._client.get(key)
                    if raw is not None:
                        # A token, not a secret; safe to include in the error.
                        holder = (
                            raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
                        )
                except Exception:  # noqa: BLE001 - diagnostics only
                    holder = None
                raise LockNotAcquired(key, holder)

            await self._sleep(0.01)

    async def release(self, handle: LockHandle) -> bool:
        try:
            result = await self._client.eval(
                _RELEASE_SCRIPT, 1, handle.key, handle.token
            )
        except Exception as exc:  # noqa: BLE001
            raise LockError(
                f"Failed to release lock {handle.key!r}: {type(exc).__name__}. "
                f"The lock will expire after its TTL."
            ) from exc
        return bool(result)

    async def extend(self, handle: LockHandle, *, ttl_millis: int) -> bool:
        try:
            result = await self._client.eval(
                _EXTEND_SCRIPT, 1, handle.key, handle.token, str(ttl_millis)
            )
        except Exception as exc:  # noqa: BLE001
            raise LockError(
                f"Failed to extend lock {handle.key!r}: {type(exc).__name__}."
            ) from exc
        return bool(result)


# -----------------------------------------------------------------------
# Fencing token support
# -----------------------------------------------------------------------
# A fencing token is a monotonically increasing counter stored alongside
# each lock key. When a lock is acquired, the counter is incremented and
# the new value is returned as part of the LockHandle. Every subsequent
# operation that depends on the lock must present the fencing token; if
# the current counter has advanced beyond the presented value, the
# operation is rejected because another owner has since acquired the lock.
#
# The fencing counter is stored at ``{lock_key}:fencing`` in Redis and is
# never reset — it only goes up. This means a crashed worker that resumes
# with an old fencing token will be correctly rejected.

_FENCING_INCR_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
return current
"""

_FENCING_GET_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if current == false then
    return 0
end
return current
"""


class FencedLockManager(LockManager):
    """A lock manager wrapper that adds fencing tokens.

    Wraps an existing :class:`LockManager` and augments each acquisition
    with a monotonically increasing fencing token. The fencing counter
    is stored in Redis (for :class:`RedisLockManager`) or in memory
    (for :class:`InMemoryLockManager`).

    A proper subclass of the port, not a duck-typed lookalike: the engine's
    ``locks`` slot and the wiring's ``manager`` are typed ``LockManager``, and
    a wrapper that fails isinstance is a wrapper a deployment cannot install
    without lying about types. Every method delegates, so behaviour is
    unchanged; the subclassing only makes the types tell the truth.

    Usage::

        fenced = FencedLockManager(redis_lock_manager, fencing_client)
        handle = await fenced.acquire("my-lock", ttl_millis=10000)
        print(handle.fencing_token)  # e.g. 1
        # ... do work ...
        await fenced.validate_fencing(handle)  # raises if stale
        await fenced.release(handle)
    """

    __slots__ = ("_inner", "_fencing_client", "_counters", "_lock")

    def __init__(
        self,
        inner: LockManager,
        *,
        fencing_client: FencingClient | None = None,
    ) -> None:
        self._inner = inner
        self._fencing_client = fencing_client
        self._counters: dict[str, int] = {}
        self._lock = asyncio.Lock()

    @property
    def is_distributed(self) -> bool:
        return self._inner.is_distributed

    async def acquire(
        self,
        key: str,
        *,
        ttl_millis: int = 10_000,
        wait_millis: int = 0,
    ) -> LockHandle:
        """Acquire the lock and issue a fencing token."""
        handle = await self._inner.acquire(key, ttl_millis=ttl_millis, wait_millis=wait_millis)
        fencing_value = await self._next_fencing_token(key)
        return LockHandle(
            key=handle.key,
            token=handle.token,
            acquired_at_micros=handle.acquired_at_micros,
            ttl_millis=handle.ttl_millis,
            fencing_token=fencing_value,
        )

    async def release(self, handle: LockHandle) -> bool:
        return await self._inner.release(handle)

    async def extend(self, handle: LockHandle, *, ttl_millis: int) -> bool:
        return await self._inner.extend(handle, ttl_millis=ttl_millis)

    async def validate_fencing(self, handle: LockHandle) -> None:
        """Validate that the handle's fencing token is still current.

        Raises :class:`LockError` if the token is stale.
        """
        current = await self._current_fencing_token(handle.key)
        if handle.fencing_token < current:
            raise LockError(
                f"Stale fencing token for {handle.key!r}: presented "
                f"{handle.fencing_token}, current is {current}. "
                f"Another worker has acquired the lock since this "
                f"handle was issued."
            )

    async def _next_fencing_token(self, key: str) -> int:
        """Generate the next fencing token for a lock key."""
        fencing_key = f"{key}:fencing"
        if self._fencing_client is not None:
            try:
                result = await self._fencing_client.eval(
                    _FENCING_INCR_SCRIPT, 1, fencing_key
                )
                if isinstance(result, int):
                    return result
                return int(str(result))
            except Exception:
                # Fall through to in-memory if Redis is unavailable
                pass
        async with self._lock:
            current = self._counters.get(fencing_key, 0)
            next_val = current + 1
            self._counters[fencing_key] = next_val
            return next_val

    async def _current_fencing_token(self, key: str) -> int:
        """Read the current fencing token for a lock key."""
        fencing_key = f"{key}:fencing"
        if self._fencing_client is not None:
            try:
                result = await self._fencing_client.eval(
                    _FENCING_GET_SCRIPT, 1, fencing_key
                )
                if isinstance(result, int):
                    return result
                return int(str(result)) if result else 0
            except Exception:
                pass
        async with self._lock:
            return self._counters.get(fencing_key, 0)
