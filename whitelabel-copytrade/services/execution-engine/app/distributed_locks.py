"""Distributed lock wiring for the execution engine (Part 21).

The core (:mod:`wlct_trading.execution.locks`) ships the lock managers; this
module is the wiring decision. ``build_distributed_lock_manager`` inspects the
configuration and either constructs a real Redis-backed manager with fencing
tokens, or returns an honest in-memory manager for simulated mode. The wiring
is derived from the objects actually built, not from a configuration flag:
``is_distributed`` on the constructed manager is the fact live-enablement
reads, so a deployment that claims distributed locks in settings but never
builds one is reported as exactly what it is.

Fail-closed rules, in the order they are checked:

1. ``enabled=True`` with no ``redis_url`` is a configuration error, not a
   silent fallback to memory - an operator who asked for distributed locks and
   silently got process-local ones would run a live-runtime claim protocol on
   a lie.
2. ``fencing_required=True`` (always, from the composition root) is honoured
   by wrapping the manager in :class:`FencedLockManager`: a lock released by a
   partitioned holder must not let a stale writer keep writing.
3. ``enabled=False`` builds memory and says so in ``describe()`` - absence
   stated, never implied.
"""

from __future__ import annotations

from dataclasses import dataclass

import redis.asyncio
from wlct_trading.execution.locks import (
    FencedLockManager,
    InMemoryLockManager,
    LockManager,
    RedisLockClient,
    RedisLockManager,
)

__all__ = [
    "DistributedLockConfig",
    "DistributedLockConfigError",
    "DistributedLockWiring",
    "build_distributed_lock_manager",
]


def _build_redis_client(url: str) -> RedisLockClient:
    """The Redis client the manager locks through, from a redis:// URL.

    ``redis.asyncio.Redis`` satisfies the core's :class:`RedisLockClient`
    protocol exactly (``set`` with ``nx``/``px``, ``get``, ``eval``), which is
    why this module - the only place the engine turns a URL into a lock
    client - is also the only place that imports the driver. Constructed
    eagerly at wiring time so a bad URL fails at boot, in the same refusal
    that validated it, rather than at the first contended order.
    """
    client: RedisLockClient = redis.asyncio.Redis.from_url(url)
    return client


class DistributedLockConfigError(ValueError):
    """Raised when the lock configuration cannot be honoured as asked."""


@dataclass(frozen=True)
class DistributedLockConfig:
    """What the operator asked for, straight from the settings object.

    Every field is the composed value the runtime would have to honour; the
    builder's job is to make the object that honours it or refuse.
    """

    enabled: bool
    redis_url: str
    lock_ttl_ms: int
    lock_acquisition_timeout_ms: int
    lock_renewal_ratio: float
    instance_id: str
    fencing_required: bool = True

    def describe(self) -> dict[str, object]:
        """Configuration without the URL's credentials (there should not be
        any - the secret-fetching rules ban user:pass authorities - but a
        describe() that renders URLs verbatim is one misconfig away from a
        leaked password in /status)."""
        return {
            "enabled": self.enabled,
            "lockTtlMs": self.lock_ttl_ms,
            "lockAcquisitionTimeoutMs": self.lock_acquisition_timeout_ms,
            "lockRenewalRatio": self.lock_renewal_ratio,
            "instanceId": self.instance_id,
            "fencingRequired": self.fencing_required,
        }


class DistributedLockWiring:
    """The manager plus the facts /status publishes about it."""

    def __init__(self, manager: LockManager, config: DistributedLockConfig) -> None:
        self._manager = manager
        self._config = config

    @property
    def manager(self) -> LockManager:
        return self._manager

    @property
    def is_distributed(self) -> bool:
        return bool(getattr(self._manager, "is_distributed", False))

    def describe(self) -> dict[str, object]:
        """The wiring view: what was built, from what, and whether it is
        actually distributed - derived from the object, not the flag."""
        manager_type = type(self._manager).__name__
        return {
            "distributed": self.is_distributed,
            "manager": manager_type,
            "mode": "redis" if self.is_distributed else "memory",
            "ttlMs": self._config.lock_ttl_ms,
            "acquisitionTimeoutMs": self._config.lock_acquisition_timeout_ms,
            "renewalRatio": self._config.lock_renewal_ratio,
            "instanceId": self._config.instance_id,
            "fencingRequired": self._config.fencing_required,
            "fenced": isinstance(self._manager, FencedLockManager),
        }


def build_distributed_lock_manager(
    config: DistributedLockConfig,
) -> DistributedLockWiring:
    """Build the lock manager the configuration names, or refuse.

    ``enabled=True`` with a blank URL refuses here, at the composition root,
    where the sentence reaches the operator - not at the first lock acquire
    three days into live trading.
    """
    if not isinstance(config, DistributedLockConfig):
        raise DistributedLockConfigError(
            "build_distributed_lock_manager requires a DistributedLockConfig"
        )
    if not config.enabled:
        return DistributedLockWiring(InMemoryLockManager(), config)

    url = (config.redis_url or "").strip()
    if not url:
        raise DistributedLockConfigError(
            "EXECUTION_DISTRIBUTED_LOCKS=true requires EXECUTION_REDIS_URL: "
            "falling back to process-local locks would run the claim protocol "
            "on a lie, so the composition refuses instead of guessing"
        )
    if url.startswith("redis://") is False and url.startswith("rediss://") is False:
        raise DistributedLockConfigError(
            "EXECUTION_REDIS_URL must be a redis:// or rediss:// URL; embed no "
            "credentials in it - authentication belongs to the URL's password "
            "component supplied by the secret manager, not to a describe()-visible string"
        )

    manager: LockManager
    inner = RedisLockManager(_build_redis_client(url))
    if config.fencing_required:
        manager = FencedLockManager(inner)
    else:
        # The composition root always requires fencing; a future caller that
        # does not gets the plain manager it asked for, stated in describe().
        manager = inner
    return DistributedLockWiring(manager, config)
