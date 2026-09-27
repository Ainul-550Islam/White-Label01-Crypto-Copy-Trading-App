"""Production ``WebSocketTransport`` backed by the ``websockets`` library.

This is the concrete implementation of the three-method protocol Part 3 defined
in :mod:`wlct_trading.transport.websocket`. It is the *only* module in the
library that imports a websocket client, and nothing imports it except the
service wiring — so the rest of trading-core remains installable and testable
with no network stack present.

What this class is responsible for
----------------------------------
Framing and error translation, and nothing else. Reconnection, backoff, state
transitions, subscription replay and heartbeat policy already exist in
:class:`~wlct_trading.transport.websocket.WebSocketConnectionManager`; adding
any of them here would create the second implementation this codebase has
consistently refused to grow.

The one subtlety worth stating: the library's own ``ConnectionClosed`` family is
translated into the platform's
:class:`~wlct_trading.transport.websocket.ConnectionClosed`, because that is the
exact type the existing manager's read loop catches to distinguish "peer went
away" (reconnect) from "something is broken" (classify and decide).

Ping/pong
---------
Binance sends a server ping every three minutes and expects a pong within ten.
The ``websockets`` library answers those automatically, which is why the Binance
adapter leaves ``build_ping_frame`` unset — an application-level ping would
consume the venue's five-inbound-messages-per-second budget for nothing. The
client-side ``ping_interval`` configured here is the reverse direction: it
detects a peer that has silently gone away.
"""

from __future__ import annotations

import asyncio
import ssl
from typing import Any, Callable

from wlct_trading.clock import epoch_micros
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.normalise import normalise_network_exception
from wlct_trading.transport.websocket import ConnectionClosed, WebSocketTransport

__all__ = [
    "WebsocketsTransport",
    "WebsocketsTransportFactory",
    "InsecureWebSocketUrl",
]


class InsecureWebSocketUrl(ValueError):
    """Raised when a non-TLS websocket URL is supplied.

    Refused outright rather than warned about. Market data received over a
    plaintext socket can be modified in flight, and a book built from modified
    data is worse than no book at all.
    """


class WebsocketsTransport(WebSocketTransport):
    """Adapts a ``websockets`` client connection to the Part 3 protocol.

    Instances are single-use and owned by one connection generation. The manager
    discards a transport on disconnect and asks the factory for a new one, which
    is what keeps generation fencing meaningful.
    """

    __slots__ = (
        "_connection",
        "_receive_timeout_seconds",
        "_closed",
        "_bytes_received",
        "_messages_received",
        "_on_bytes",
    )

    def __init__(
        self,
        connection: Any,
        *,
        receive_timeout_seconds: float,
        on_bytes: Callable[[int], None] | None = None,
    ) -> None:
        self._connection = connection
        self._receive_timeout_seconds = receive_timeout_seconds
        self._closed = False
        self._bytes_received = 0
        self._messages_received = 0
        self._on_bytes = on_bytes

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------
    @property
    def bytes_received(self) -> int:
        return self._bytes_received

    @property
    def messages_received(self) -> int:
        return self._messages_received

    @property
    def is_closed(self) -> bool:
        return self._closed

    # ------------------------------------------------------------------
    # WebSocketTransport protocol
    # ------------------------------------------------------------------
    async def send(self, message: str) -> None:
        """Send one text frame.

        Used for SUBSCRIBE/UNSUBSCRIBE control frames. Errors are normalised so
        the manager's subscription bookkeeping sees a platform error rather than
        a library one.
        """
        if self._closed:
            raise ConnectionClosed("Transport is already closed; cannot send.")
        try:
            await self._connection.send(message)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - normalised below
            if _is_library_closed(exc):
                self._closed = True
                raise ConnectionClosed(
                    f"Send failed because the peer closed the connection: {exc}"
                ) from exc
            raise normalise_network_exception(exc, context="websocket send") from exc

    async def receive(self) -> str:
        """Await the next text frame.

        A bounded wait, never an indefinite one. The timeout is a backstop below
        the manager's heartbeat: it catches a socket that is wedged in a way the
        application layer cannot see. Exceeding it is reported as a normalised
        ``TIMEOUT``, which the existing retry policy treats as retryable.

        Binary frames are decoded as UTF-8. Binance sends text, but a venue that
        switches to compressed binary should surface as a decode error rather
        than a silent drop.
        """
        if self._closed:
            raise ConnectionClosed("Transport is already closed; cannot receive.")
        try:
            raw = await asyncio.wait_for(
                self._connection.recv(), timeout=self._receive_timeout_seconds
            )
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError as exc:
            raise normalise_network_exception(
                exc,
                context=(
                    f"websocket receive exceeded "
                    f"{self._receive_timeout_seconds:.0f}s"
                ),
            ) from exc
        except BaseException as exc:  # noqa: BLE001 - normalised below
            if _is_library_closed(exc):
                self._closed = True
                raise ConnectionClosed(f"Peer closed the connection: {exc}") from exc
            raise normalise_network_exception(
                exc, context="websocket receive"
            ) from exc

        if isinstance(raw, bytes):
            self._bytes_received += len(raw)
            if self._on_bytes is not None:
                self._on_bytes(len(raw))
            self._messages_received += 1
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise normalise_network_exception(
                    exc, context="websocket frame is not valid UTF-8"
                ) from exc

        text = str(raw)
        size = len(text.encode("utf-8", errors="ignore"))
        self._bytes_received += size
        if self._on_bytes is not None:
            self._on_bytes(size)
        self._messages_received += 1
        return text

    async def close(self) -> None:
        """Close the socket. Idempotent, and never raises.

        Shutdown must not fail. A transport that throws while closing turns an
        orderly stop into a leaked connection, so every error here is swallowed
        after the socket has been marked closed.
        """
        if self._closed:
            return
        self._closed = True
        try:
            await self._connection.close()
        except asyncio.CancelledError:
            raise
        except BaseException:  # noqa: BLE001 - closing must not fail
            return


def _is_library_closed(exc: BaseException) -> bool:
    """Whether an exception means "the peer closed the connection"."""
    return type(exc).__name__ in (
        "ConnectionClosed",
        "ConnectionClosedOK",
        "ConnectionClosedError",
    )


class WebsocketsTransportFactory:
    """Builds :class:`WebsocketsTransport` instances for the manager.

    Satisfies the existing ``TransportFactory`` signature
    (``Callable[[str], Awaitable[WebSocketTransport]]``) by being callable.
    Implemented as a class rather than a closure so that connection attempts and
    failures can be counted without a mutable default hiding in a function.

    TLS uses Python's default verification. There is no switch here to disable
    certificate checking, by design — such a flag inevitably ends up set in a
    production ``.env``.
    """

    __slots__ = (
        "_settings",
        "_connect",
        "_ssl_context",
        "attempts",
        "successes",
        "failures",
        "last_connected_at",
        "_on_bytes",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        connect: Callable[..., Any] | None = None,
        ssl_context: ssl.SSLContext | None = None,
        on_bytes: Callable[[int], None] | None = None,
    ) -> None:
        self._settings = settings
        self._connect = connect
        self._ssl_context = ssl_context
        self._on_bytes = on_bytes
        self.attempts = 0
        self.successes = 0
        self.failures = 0
        self.last_connected_at: int | None = None

    def _resolve_connect(self) -> Callable[..., Any]:
        """Import the websocket client lazily.

        Deferred so that importing :mod:`wlct_trading.net` does not require the
        optional dependency, and so the failure message names the extra to
        install instead of surfacing a bare ``ModuleNotFoundError``.
        """
        if self._connect is not None:
            return self._connect
        try:
            from websockets.asyncio.client import connect
        except ImportError as exc:  # pragma: no cover - depends on install
            raise ImportError(
                "The 'websockets' package is required for the live websocket "
                "transport. Install it with: pip install 'wlct-trading-core[live]'"
            ) from exc
        # ``connect`` arrives untyped (optional dependency); pin the local to
        # the attribute's declared type so the function returns exactly what
        # its signature promises instead of ``Any``.
        factory: Callable[..., Any] = connect
        self._connect = factory
        return factory

    async def __call__(self, url: str) -> WebSocketTransport:
        """Open one connection and wrap it."""
        if not url.startswith("wss://"):
            raise InsecureWebSocketUrl(
                f"Refusing to open a non-TLS websocket to {url!r}. "
                f"Exchange market data must travel over wss://."
            )

        connect = self._resolve_connect()
        self.attempts += 1

        settings = self._settings
        options: dict[str, Any] = {
            "open_timeout": settings.ws_connect_timeout_ms / 1000,
            "ping_interval": settings.ws_ping_interval_ms / 1000,
            "ping_timeout": settings.ws_ping_timeout_ms / 1000,
            "close_timeout": settings.ws_close_timeout_ms / 1000,
            "max_size": settings.ws_max_frame_bytes,
            # Binance does not negotiate permessage-deflate on the public
            # market-data streams, and leaving compression enabled costs CPU on
            # the hot path for no benefit.
            "compression": None,
            "user_agent_header": "wlct-trading-core",
        }
        if self._ssl_context is not None:
            options["ssl"] = self._ssl_context
        # When no context is supplied the argument is omitted entirely rather
        # than passed as None: the library reads an explicit ssl=None on a
        # wss:// URI as "disable TLS" and refuses. Omitting it selects the
        # default verifying context, which is what is wanted.

        try:
            connection = await connect(url, **options)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - normalised for the manager
            self.failures += 1
            raise normalise_network_exception(
                exc, context=f"websocket connect to {url.split('?', 1)[0]}"
            ) from exc

        self.successes += 1
        self.last_connected_at = epoch_micros()
        return WebsocketsTransport(
            connection,
            receive_timeout_seconds=settings.ws_receive_timeout_ms / 1000,
            on_bytes=self._on_bytes,
        )

    def stats(self) -> dict[str, int | None]:
        """Connection-attempt counters for the metrics layer."""
        return {
            "attempts": self.attempts,
            "successes": self.successes,
            "failures": self.failures,
            "lastConnectedAt": self.last_connected_at,
        }
