"""Binance USD-M futures package (batch 03, item B).

Exports the observation-only market-data adapter, the signed trading/account
adapters, risk guards, and the keyed listen-key layer. Nothing in this package
performs I/O on construction: sockets are opened by the engine only after
``EXECUTION_MODE`` and ``EXECUTION_VENUE_MARKET`` composition plus the live
gates approve; default operation stays ``simulated``.

Contracts the package pins (tests, not prose):

- quantities/prices serialize via :func:`~wlct_trading.exchanges.binance.signing.format_decimal`
  and parse via ``Decimal`` only - float loses precision in the futures path;
- order sides/types/statuses route through the closed enum maps and refuse
  unknown venue strings rather than coercing them;
- ``BinanceFuturesTradingAdapter.is_simulated`` is always False - the truth
  about whether exposure is live lives in the engine's composition, not here.
"""

from wlct_trading.exchanges.binance_futures.adapter import (  # noqa: F401
    BinanceFuturesMarketData,
    FuturesClientError,
    FuturesRateLimited,
    build_futures_registry,
    read_last_funding_rate,
    read_mark_price,
)
from wlct_trading.exchanges.binance_futures.attestation import (  # noqa: F401
    BINANCE_FUTURES_REVIEW_SOURCE,
    BinanceFuturesPlacementAttestor,
    FuturesAccountFlagReader,
    FuturesKeyEvidence,
    FuturesVenueAccountFlags,
    futures_key_evidence_from_restrictions,
)
from wlct_trading.exchanges.binance_futures.capabilities import (  # noqa: F401
    BINANCE_FUTURES_CAPABILITIES,
    BINANCE_FUTURES_REST_BASE,
    BINANCE_FUTURES_TESTNET_REST_BASE,
    BINANCE_FUTURES_TESTNET_WS_BASE,
    BINANCE_FUTURES_WS_BASE,
    FUTURES_REST_WEIGHTS,
    futures_depth_endpoint_weight,
)
from wlct_trading.exchanges.binance_futures.parsers import (  # noqa: F401
    FuturesParseError,
    classify_futures_error,
    order_client_id,
    parse_decimal_strict,
    parse_futures_account_v2,
    parse_futures_order_status,
    parse_futures_order_type,
    parse_futures_time_in_force,
    parse_position_risk_entry,
)
from wlct_trading.exchanges.binance_futures.risk_guards import (  # noqa: F401
    FuturesGuardPolicy,
    FuturesGuardRefusal,
    GuardReport,
    GuardVerdict,
    check_funding_rate,
    check_leverage,
    check_liquidation_distance,
    check_notional,
    evaluate_futures_guards,
)
from wlct_trading.exchanges.binance_futures.trading import (  # noqa: F401
    BinanceFuturesAccountAdapter,
    BinanceFuturesTradingAdapter,
    FuturesTradingParams,
    to_futures_order_type,
)
from wlct_trading.exchanges.binance_futures.userstream import (  # noqa: F401
    FuturesListenKeyClient,
    FuturesUserStream,
    parse_account_update,
    parse_futures_execution_report,
)

__all__ = [
    "BINANCE_FUTURES_CAPABILITIES",
    "BINANCE_FUTURES_REVIEW_SOURCE",
    "BINANCE_FUTURES_REST_BASE",
    "BINANCE_FUTURES_TESTNET_REST_BASE",
    "BINANCE_FUTURES_TESTNET_WS_BASE",
    "BINANCE_FUTURES_WS_BASE",
    "BinanceFuturesAccountAdapter",
    "BinanceFuturesMarketData",
    "BinanceFuturesPlacementAttestor",
    "BinanceFuturesTradingAdapter",
    "FuturesAccountFlagReader",
    "FuturesClientError",
    "FuturesGuardPolicy",
    "FuturesGuardRefusal",
    "FuturesKeyEvidence",
    "FuturesListenKeyClient",
    "FuturesParseError",
    "FuturesRateLimited",
    "FuturesTradingParams",
    "FuturesUserStream",
    "FuturesVenueAccountFlags",
    "FUTURES_REST_WEIGHTS",
    "GuardReport",
    "GuardVerdict",
    "build_futures_registry",
    "check_funding_rate",
    "check_leverage",
    "check_liquidation_distance",
    "check_notional",
    "classify_futures_error",
    "evaluate_futures_guards",
    "futures_depth_endpoint_weight",
    "futures_key_evidence_from_restrictions",
    "order_client_id",
    "parse_account_update",
    "parse_decimal_strict",
    "parse_futures_account_v2",
    "parse_futures_execution_report",
    "parse_futures_order_status",
    "parse_futures_order_type",
    "parse_futures_time_in_force",
    "parse_position_risk_entry",
    "read_last_funding_rate",
    "read_mark_price",
    "to_futures_order_type",
]
