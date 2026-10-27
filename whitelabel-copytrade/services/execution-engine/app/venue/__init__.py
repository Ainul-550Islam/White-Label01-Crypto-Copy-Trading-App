"""Venue egress for Binance SPOT: transport, runtime assembly, live gates.

This package is the only path from this service to a real exchange. It is
composed only for ``EXECUTION_MODE=testnet|live``; the simulated default
never imports a venue adapter into the engine. Nothing here can enable
transmission on its own - composition decides, live gates refuse, and the
core engine's wiring law refuses again.
"""

from app.venue.binance_runtime import (
    BinanceVenueWiring,
    build_binance_runtime,
)
from app.venue.binance_transport import (
    ALLOWED_BASE_URLS,
    BinanceHttpTransport,
    VenueHostNotAllowed,
    VenueTransportError,
)
from app.venue.live_gates import ALL_LIVE_GATES, evaluate_live_gates
from app.venue.order_outcome import (
    OrderOutcome,
    OrderOutcomeResolver,
    client_order_id_for,
)

__all__ = [
    "ALL_LIVE_GATES",
    "ALLOWED_BASE_URLS",
    "BinanceHttpTransport",
    "BinanceVenueWiring",
    "OrderOutcome",
    "OrderOutcomeResolver",
    "VenueHostNotAllowed",
    "VenueTransportError",
    "build_binance_runtime",
    "client_order_id_for",
    "evaluate_live_gates",
]
