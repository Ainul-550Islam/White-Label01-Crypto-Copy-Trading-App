"""Per-instance strategy identity and runtime state.

A "strategy instance" is one running copy of one strategy version, trading one
symbol, for one tenant, on one exchange, under one configuration version. That
five-part identity is what :class:`StrategyInstanceKey` captures, and it is
what guarantees isolation: two instances that differ in *any* component get
different keys, different state objects and different feature engines.

The state itself is intentionally boring - a typed key/value map with snapshot
and restore. Strategies that need richer structures build them on top; keeping
the persisted surface flat is what makes a snapshot comparable across restarts
and safe to store in Redis as hot state.

Nothing in this module performs I/O. Persistence is the host service's job: it
takes a :meth:`StrategyState.snapshot` and writes it wherever it belongs. The
hot path never blocks on a database.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Iterator, Mapping

from wlct_trading.enums import ExchangeId, MarketType

__all__ = [
    "StrategyInstanceKey",
    "StrategyState",
    "StrategyStateError",
    "StrategyStateStore",
]

#: The value types a strategy may keep in persisted state. Deliberately narrow:
#: everything here must survive a round trip through JSON or a Redis hash
#: without losing precision or type.
StateValue = str | int | bool | Decimal


class StrategyStateError(ValueError):
    """Raised when state is written or restored with an unusable value."""


@dataclass(slots=True, frozen=True)
class StrategyInstanceKey:
    """The five-part identity of one running strategy instance.

    ``instance_id`` is derived, not assigned: it is a deterministic hash of the
    five components, so the same logical instance gets the same id on every
    machine and across restarts. That makes it usable as a Redis key and as a
    correlation id in logs without a central allocator.
    """

    tenant_id: str
    strategy_key: str
    strategy_version: str
    exchange: ExchangeId
    symbol: str
    configuration_version: str = "1"
    market_type: MarketType = MarketType.SPOT

    def __post_init__(self) -> None:
        for name in (
            "tenant_id",
            "strategy_key",
            "strategy_version",
            "symbol",
            "configuration_version",
        ):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"StrategyInstanceKey.{name} must be a non-empty string.")

    @property
    def instance_id(self) -> str:
        """Stable 32-hex-character identity derived from the components."""
        digest = hashlib.sha256(self.fingerprint_source().encode("utf-8")).hexdigest()
        return digest[:32]

    def fingerprint_source(self) -> str:
        """The exact string that is hashed. Contains no secret material."""
        return "|".join(
            (
                self.tenant_id,
                self.strategy_key,
                self.strategy_version,
                self.exchange.value,
                self.market_type.value,
                self.symbol,
                self.configuration_version,
            )
        )

    @property
    def redis_namespace(self) -> str:
        """Namespace for this instance's hot state.

        Tenant first so that a tenant's keys can be enumerated, expired or
        audited as a unit, matching the convention used elsewhere in the
        platform.
        """
        return f"strategy:{self.tenant_id}:{self.instance_id}"

    def describe(self) -> str:
        return (
            f"{self.strategy_key}@{self.strategy_version} "
            f"{self.symbol} on {self.exchange.value} "
            f"(tenant={self.tenant_id}, config={self.configuration_version})"
        )

    def to_dict(self) -> dict[str, str]:
        return {
            "instanceId": self.instance_id,
            "tenantId": self.tenant_id,
            "strategyKey": self.strategy_key,
            "strategyVersion": self.strategy_version,
            "exchange": self.exchange.value,
            "marketType": self.market_type.value,
            "symbol": self.symbol,
            "configurationVersion": self.configuration_version,
        }


@dataclass(slots=True)
class StrategyState:
    """Isolated mutable state belonging to exactly one instance.

    Deterministic initialisation: a freshly constructed state, and a state that
    has been :meth:`reset`, are indistinguishable. That property is what makes
    a backtest reproducible after the engine has been reused.
    """

    key: StrategyInstanceKey
    _values: dict[str, StateValue] = field(default_factory=dict, init=False, repr=False)
    _version: int = field(default=0, init=False, repr=False)

    # -- access --------------------------------------------------------
    def get(self, name: str, default: StateValue | None = None) -> StateValue | None:
        return self._values.get(name, default)

    def get_decimal(self, name: str, default: Decimal | None = None) -> Decimal | None:
        value = self._values.get(name)
        if value is None:
            return default
        if isinstance(value, Decimal):
            return value
        if isinstance(value, bool):
            raise StrategyStateError(f"State {name!r} holds a boolean, not a decimal.")
        try:
            return Decimal(str(value))
        except InvalidOperation as exc:  # pragma: no cover - guarded by set()
            raise StrategyStateError(
                f"State {name!r} does not hold a decimal value."
            ) from exc

    def get_int(self, name: str, default: int = 0) -> int:
        value = self._values.get(name)
        if value is None:
            return default
        if isinstance(value, bool):
            raise StrategyStateError(f"State {name!r} holds a boolean, not an integer.")
        if isinstance(value, int):
            return value
        raise StrategyStateError(f"State {name!r} does not hold an integer value.")

    def get_bool(self, name: str, default: bool = False) -> bool:
        value = self._values.get(name)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        raise StrategyStateError(f"State {name!r} does not hold a boolean value.")

    def set(self, name: str, value: StateValue) -> None:
        """Write one value. Rejects unusable types and non-finite decimals."""
        if not name:
            raise StrategyStateError("State keys must be non-empty.")
        if isinstance(value, float):
            raise StrategyStateError(
                f"State {name!r}: floats are refused; use Decimal so precision "
                "survives persistence."
            )
        if isinstance(value, Decimal) and not value.is_finite():
            raise StrategyStateError(f"State {name!r}: refusing a non-finite Decimal.")
        if not isinstance(value, (str, int, bool, Decimal)):
            raise StrategyStateError(
                f"State {name!r}: unsupported type {type(value).__name__}."
            )
        self._values[name] = value
        self._version += 1

    def increment(self, name: str, amount: int = 1) -> int:
        current = self.get_int(name, 0)
        updated = current + amount
        self.set(name, updated)
        return updated

    def delete(self, name: str) -> None:
        if name in self._values:
            del self._values[name]
            self._version += 1

    def __contains__(self, name: object) -> bool:
        return name in self._values

    def __len__(self) -> int:
        return len(self._values)

    def __iter__(self) -> Iterator[str]:
        return iter(self._values)

    @property
    def version(self) -> int:
        """Monotonic write counter. Useful for detecting a no-op tick."""
        return self._version

    # -- lifecycle -----------------------------------------------------
    def reset(self) -> None:
        """Clear every value. The state returns to its initial condition."""
        self._values.clear()
        self._version = 0

    def snapshot(self) -> dict[str, str]:
        """Serialise to a flat string map.

        Strings throughout so the snapshot can be written to Redis, persisted
        as JSON, or embedded in an audit record with no further encoding. Type
        information is preserved by prefixing: ``d:`` decimal, ``i:`` integer,
        ``b:`` boolean, ``s:`` string.
        """
        out: dict[str, str] = {}
        for name, value in sorted(self._values.items()):
            if isinstance(value, bool):
                out[name] = f"b:{'1' if value else '0'}"
            elif isinstance(value, Decimal):
                out[name] = f"d:{value}"
            elif isinstance(value, int):
                out[name] = f"i:{value}"
            else:
                out[name] = f"s:{value}"
        return out

    def restore(self, snapshot: Mapping[str, str]) -> None:
        """Replace the current state with a previously taken snapshot.

        Restoring is all-or-nothing: the snapshot is decoded into a fresh dict
        first, so a corrupt entry leaves the existing state untouched rather
        than half-overwritten. A strategy resuming from partially applied state
        is exactly the corrupted-state case the failure policy exists to avoid.
        """
        decoded: dict[str, StateValue] = {}
        for name, encoded in snapshot.items():
            if not isinstance(encoded, str) or len(encoded) < 2 or encoded[1] != ":":
                raise StrategyStateError(
                    f"State snapshot entry {name!r} is not a tagged value."
                )
            tag, raw = encoded[0], encoded[2:]
            if tag == "d":
                try:
                    decimal_value = Decimal(raw)
                except InvalidOperation as exc:
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not a valid decimal."
                    ) from exc
                if not decimal_value.is_finite():
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not finite."
                    )
                # The finite check runs on the concrete Decimal before the
                # value widens back to StateValue; checking is_finite() on the
                # union would be a type error and an unconditional pass, not
                # a guard.
                value: StateValue = decimal_value
            elif tag == "i":
                try:
                    value = int(raw)
                except ValueError as exc:
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not a valid integer."
                    ) from exc
            elif tag == "b":
                if raw not in ("0", "1"):
                    raise StrategyStateError(
                        f"State snapshot entry {name!r} is not a valid boolean."
                    )
                value = raw == "1"
            elif tag == "s":
                value = raw
            else:
                raise StrategyStateError(
                    f"State snapshot entry {name!r} has unknown tag {tag!r}."
                )
            decoded[name] = value

        self._values = decoded
        self._version += 1

    def as_dict(self) -> dict[str, Any]:
        """Plain copy for logging. Values are stringified."""
        return {name: str(value) for name, value in sorted(self._values.items())}


class StrategyStateStore:
    """In-memory registry of per-instance state.

    The isolation guarantee lives here: :meth:`for_instance` returns the state
    object belonging to one key and never shares an object between keys. There
    is no global namespace a strategy could reach into.
    """

    __slots__ = ("_states",)

    def __init__(self) -> None:
        self._states: dict[str, StrategyState] = {}

    def for_instance(self, key: StrategyInstanceKey) -> StrategyState:
        state = self._states.get(key.instance_id)
        if state is None:
            state = StrategyState(key=key)
            self._states[key.instance_id] = state
        return state

    def has(self, key: StrategyInstanceKey) -> bool:
        return key.instance_id in self._states

    def drop(self, key: StrategyInstanceKey) -> None:
        self._states.pop(key.instance_id, None)

    def reset_all(self) -> None:
        for state in self._states.values():
            state.reset()

    def clear(self) -> None:
        self._states.clear()

    @property
    def instance_count(self) -> int:
        return len(self._states)

    def snapshot_all(self) -> dict[str, dict[str, str]]:
        return {
            instance_id: state.snapshot()
            for instance_id, state in sorted(self._states.items())
        }
