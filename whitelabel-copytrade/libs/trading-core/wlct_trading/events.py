"""The trading event envelope and its payload types.

Every meaningful thing that happens in the data plane is emitted as a
:class:`TradingEvent`. The envelope is uniform so that one publisher, one
consumer loop and one audit path can handle all of them; the payload is a plain
dict so events survive a schema change in either direction without a
coordinated redeploy of every service.

Ordering and delivery are the transport's job (a Redis Stream), not this
module's. What this module guarantees is that an event carries enough context -
tenant, correlation id, causation id, emitting service - to reconstruct the
full causal chain from a market tick through to a fill.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import TradingEventType

__all__ = ["TradingEvent", "EventBus", "InMemoryEventBus", "EventHandler"]


@dataclass(slots=True, frozen=True)
class TradingEvent:
    """A single immutable fact about the trading system.

    ``correlation_id`` groups every event produced by one causal chain (a tick
    that produced a signal that produced an order that produced a fill).
    ``causation_id`` points at the immediate parent event, so the chain can be
    walked precisely rather than just grouped.
    """

    event_id: str
    event_type: TradingEventType
    tenant_id: str | None
    correlation_id: str
    causation_id: str | None
    source: str
    occurred_at: int
    payload: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        event_type: TradingEventType,
        *,
        source: str,
        payload: dict[str, Any],
        tenant_id: str | None = None,
        correlation_id: str | None = None,
        causation_id: str | None = None,
    ) -> "TradingEvent":
        event_id = str(uuid.uuid4())
        return cls(
            event_id=event_id,
            event_type=event_type,
            tenant_id=tenant_id,
            # An event that starts a chain is its own correlation root.
            correlation_id=correlation_id or event_id,
            causation_id=causation_id,
            source=source,
            occurred_at=epoch_micros(),
            payload=payload,
        )

    def derive(
        self,
        event_type: TradingEventType,
        *,
        source: str,
        payload: dict[str, Any],
    ) -> "TradingEvent":
        """Create a child event that inherits this event's causal context."""
        return TradingEvent(
            event_id=str(uuid.uuid4()),
            event_type=event_type,
            tenant_id=self.tenant_id,
            correlation_id=self.correlation_id,
            causation_id=self.event_id,
            source=source,
            occurred_at=epoch_micros(),
            payload=payload,
        )

    def to_wire(self) -> dict[str, Any]:
        """Flat dict suitable for a Redis Stream entry."""
        return {
            "eventId": self.event_id,
            "eventType": self.event_type.value,
            "tenantId": self.tenant_id or "",
            "correlationId": self.correlation_id,
            "causationId": self.causation_id or "",
            "source": self.source,
            "occurredAt": self.occurred_at,
            "payload": self.payload,
        }


EventHandler = Any


class EventBus:
    """Publisher interface implemented by the Redis and in-memory buses."""

    def publish(self, event: TradingEvent) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def subscribe(
        self, event_type: TradingEventType, handler: EventHandler
    ) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class InMemoryEventBus(EventBus):
    """Synchronous in-process bus.

    Used by the strategy runner inside a single process and by the test suite.
    A handler that raises does not prevent the remaining handlers from running:
    one broken consumer must not stop the position tracker from seeing a fill.
    Failures are collected and exposed on :attr:`handler_errors` so they are
    visible rather than swallowed.
    """

    __slots__ = ("_handlers", "_published", "handler_errors")

    def __init__(self) -> None:
        self._handlers: dict[TradingEventType, list[EventHandler]] = {}
        self._published: list[TradingEvent] = []
        self.handler_errors: list[tuple[str, BaseException]] = []

    def publish(self, event: TradingEvent) -> None:
        self._published.append(event)
        for handler in self._handlers.get(event.event_type, ()):
            try:
                handler(event)
            except BaseException as exc:  # noqa: BLE001 - isolation is the point
                self.handler_errors.append((event.event_id, exc))

    def subscribe(self, event_type: TradingEventType, handler: EventHandler) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    @property
    def published(self) -> tuple[TradingEvent, ...]:
        return tuple(self._published)

    def events_of(self, event_type: TradingEventType) -> tuple[TradingEvent, ...]:
        return tuple(e for e in self._published if e.event_type is event_type)

    def clear(self) -> None:
        self._published.clear()
        self.handler_errors.clear()
