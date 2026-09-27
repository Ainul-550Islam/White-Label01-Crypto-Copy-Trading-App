"""Connection state machine and per-connection health.

Two separate concerns live here and it is worth keeping them distinct:

* :class:`ConnectionState` is what the socket *is* doing. It is a small state
  machine with an explicit legal-transition table, for the same reason the OMS
  has one — an out-of-order callback must not be able to drive the connection
  into a nonsensical state such as CONNECTED-after-STOPPED.
* :class:`ConnectionHealth` is what the operator needs to *know*: when the last
  message arrived, how many times we have reconnected, whether data has gone
  stale, what failed last. It is a snapshot value object, published to Redis
  and surfaced by the control plane.

A connection can be CONNECTED and simultaneously unhealthy. That combination is
the single most dangerous failure mode in market data — the socket is open, the
heartbeat is answered, and no book updates have arrived for thirty seconds — so
the two are tracked independently and :attr:`ConnectionHealth.is_healthy`
requires both.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import Enum

from wlct_trading.clock import epoch_micros

__all__ = [
    "ConnectionState",
    "CONNECTION_STATE_TRANSITIONS",
    "is_legal_connection_transition",
    "InvalidConnectionTransition",
    "ConnectionHealth",
    "LatencyStats",
]


class ConnectionState(str, Enum):
    """Lifecycle of a single websocket connection."""

    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    RECONNECTING = "RECONNECTING"
    ERROR = "ERROR"
    #: Terminal. Reached only by an explicit operator/shutdown request; the
    #: manager will not reconnect out of it.
    STOPPED = "STOPPED"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


#: Legal transitions. Notes on the non-obvious edges:
#:
#: * ``CONNECTING -> RECONNECTING`` — the initial connect attempt failed and the
#:   manager is backing off rather than giving up.
#: * ``ERROR -> RECONNECTING`` — a retryable error; the manager resumes.
#: * ``ERROR -> STOPPED`` — a non-retryable error (bad credentials, malformed
#:   subscription) or the attempt cap was exhausted.
#: * Every non-terminal state may go to ``STOPPED``, because shutdown must
#:   always be possible.
#: * Nothing leaves ``STOPPED``. Restarting means constructing a new manager,
#:   which guarantees no stale timers or buffers survive.
CONNECTION_STATE_TRANSITIONS: dict[ConnectionState, frozenset[ConnectionState]] = {
    ConnectionState.DISCONNECTED: frozenset(
        {ConnectionState.CONNECTING, ConnectionState.STOPPED}
    ),
    ConnectionState.CONNECTING: frozenset(
        {
            ConnectionState.CONNECTED,
            ConnectionState.ERROR,
            ConnectionState.RECONNECTING,
            ConnectionState.DISCONNECTED,
            ConnectionState.STOPPED,
        }
    ),
    ConnectionState.CONNECTED: frozenset(
        {
            ConnectionState.DISCONNECTED,
            ConnectionState.RECONNECTING,
            ConnectionState.ERROR,
            ConnectionState.STOPPED,
        }
    ),
    ConnectionState.RECONNECTING: frozenset(
        {
            ConnectionState.CONNECTING,
            ConnectionState.CONNECTED,
            ConnectionState.ERROR,
            ConnectionState.STOPPED,
        }
    ),
    ConnectionState.ERROR: frozenset(
        {
            ConnectionState.RECONNECTING,
            ConnectionState.CONNECTING,
            ConnectionState.STOPPED,
        }
    ),
    ConnectionState.STOPPED: frozenset(),
}


def is_legal_connection_transition(
    current: ConnectionState, target: ConnectionState
) -> bool:
    """Whether ``current -> target`` is permitted."""
    return target in CONNECTION_STATE_TRANSITIONS.get(current, frozenset())


class InvalidConnectionTransition(Exception):
    """Raised on an attempt to make an illegal connection-state transition."""

    def __init__(
        self, name: str, current: ConnectionState, target: ConnectionState
    ) -> None:
        self.connection_name = name
        self.current = current
        self.target = target
        super().__init__(
            f"Connection {name} cannot move from {current.value} to {target.value}."
        )


@dataclass(slots=True, frozen=True)
class LatencyStats:
    """Observed round-trip and processing latency for one connection.

    These are measurements of what happened. Nothing here is a guarantee or a
    target, and the platform makes no claim about achievable latency.
    """

    last_ping_rtt_micros: int | None = None
    min_ping_rtt_micros: int | None = None
    max_ping_rtt_micros: int | None = None
    #: Exchange-event-timestamp to local-receive-timestamp on the last message.
    #: Includes venue-side delay and clock skew, so it is indicative only.
    last_feed_lag_micros: int | None = None

    def with_ping(self, rtt_micros: int) -> "LatencyStats":
        return LatencyStats(
            last_ping_rtt_micros=rtt_micros,
            min_ping_rtt_micros=(
                rtt_micros
                if self.min_ping_rtt_micros is None
                else min(self.min_ping_rtt_micros, rtt_micros)
            ),
            max_ping_rtt_micros=(
                rtt_micros
                if self.max_ping_rtt_micros is None
                else max(self.max_ping_rtt_micros, rtt_micros)
            ),
            last_feed_lag_micros=self.last_feed_lag_micros,
        )

    def with_feed_lag(self, lag_micros: int) -> "LatencyStats":
        return replace(self, last_feed_lag_micros=lag_micros)


@dataclass(slots=True, frozen=True)
class ConnectionHealth:
    """Immutable health snapshot for one exchange connection.

    Published to Redis and read by the control plane and the risk engine. It is
    frozen so a consumer cannot mutate the copy another consumer is reading.
    """

    exchange: str
    connection_name: str
    state: ConnectionState
    #: Wall-clock microseconds; ``None`` until the event has occurred.
    connected_at: int | None = None
    last_message_at: int | None = None
    last_heartbeat_at: int | None = None
    last_error_at: int | None = None
    last_error_category: str | None = None
    last_error_message: str | None = None
    reconnect_count: int = 0
    subscription_count: int = 0
    messages_received: int = 0
    #: True when the socket is up but data has stopped arriving.
    is_stale: bool = False
    latency: LatencyStats = field(default_factory=LatencyStats)
    observed_at: int = field(default_factory=epoch_micros)

    @property
    def is_connected(self) -> bool:
        return self.state is ConnectionState.CONNECTED

    @property
    def is_healthy(self) -> bool:
        """Connected *and* receiving data.

        Both halves are required. A socket that is open but silent is not
        healthy, and treating it as such is how a strategy ends up trading on a
        frozen book.
        """
        return self.is_connected and not self.is_stale

    def age_of_last_message_micros(self, *, now_micros: int | None = None) -> int | None:
        """How long since the last message, or ``None`` if none ever arrived."""
        if self.last_message_at is None:
            return None
        now = epoch_micros() if now_micros is None else now_micros
        return now - self.last_message_at

    def to_log_fields(self) -> dict[str, object]:
        """Structured-logging representation. Contains no credential material."""
        return {
            "exchange": self.exchange,
            "connection": self.connection_name,
            "state": self.state.value,
            "healthy": self.is_healthy,
            "stale": self.is_stale,
            "reconnectCount": self.reconnect_count,
            "subscriptionCount": self.subscription_count,
            "messagesReceived": self.messages_received,
            "lastErrorCategory": self.last_error_category,
            "lastPingRttMicros": self.latency.last_ping_rtt_micros,
            "lastFeedLagMicros": self.latency.last_feed_lag_micros,
        }
