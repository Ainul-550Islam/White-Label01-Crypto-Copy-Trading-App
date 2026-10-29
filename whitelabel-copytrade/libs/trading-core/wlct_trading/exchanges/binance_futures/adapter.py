"""Binance USD-M futures market-data adapter (keyless observation).

Responsibility: the public-side bridge to ``/fapi`` for everything that does
not require credentials - server time, exchange info, premium index (mark
price + last funding rate), funding history and partial depth. It carries NO
API key on purpose: public market data must never require custody of secret
material, and the fewer classes holding keys the smaller the blast radius of
a leak.

Share-nothing with spot
-----------------------
The spot adapter and this adapter intentionally do not share instances: the
batches' "spot byte-identical" contract rules out any edit to spot files, so
futures code either composes spot primitives (signing module, transport
layer) or re-implements its surface here. Composed primitives are reused;
lifecycle objects (HTTP send callables, registries, symbol maps) are built
futures-side with the futures capability declaration.

Injection
---------
``send`` is an injected callable producing
:class:`~wlct_trading.exchanges.binance.trading.HttpResponse`-shaped results;
in production it is threaded through from the execution engine venue stack,
in tests it is a list of canned responses. The adapter itself performs no
socket I/O of its own.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Awaitable, Callable, Mapping, Sequence

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, MarketType
from wlct_trading.exchanges.binance.trading import (
    HttpResponse,
    SignedRequestSender,
)
from wlct_trading.exchanges.binance_futures.capabilities import (
    BINANCE_FUTURES_CAPABILITIES,
    BINANCE_FUTURES_REST_BASE,
    BINANCE_FUTURES_TESTNET_REST_BASE,
    FUTURES_REST_WEIGHTS,
    futures_depth_endpoint_weight,
)
from wlct_trading.exchanges.binance_futures.parsers import (
    FuturesParseError,
    classify_futures_error,
    parse_decimal_strict,
    parse_futures_order_status,
    order_client_id,
    parse_futures_account_v2,
    parse_funding_rate_history_entry,
    parse_premium_index,
    parse_position_risk_entry,
)
from wlct_trading.transport.errors import (
    ExchangeErrorCategory,
    NormalisedExchangeError,
)
from wlct_trading.transport.ratelimit import RateLimitRegistry

__all__ = [
    "FuturesClientError",
    "FuturesRateLimited",
    "BinanceFuturesMarketData",
    "build_futures_registry",
    "read_mark_price",
    "read_last_funding_rate",
]


class FuturesClientError(RuntimeError):
    """A futures endpoint refused or mis-answered; never a raw HTTP blob."""

    def __init__(
        self,
        code: int | None,
        http_status: int | None,
        category: ExchangeErrorCategory,
        message: str,
        retry_after_millis: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.category = category
        self.retry_after_millis = retry_after_millis


class FuturesRateLimited(FuturesClientError):
    """418/429 from Binance futures - the caller must back off."""


def build_futures_registry() -> RateLimitRegistry:
    """Construct the futures rate-limit registry from the capability table."""
    return RateLimitRegistry.from_rules(BINANCE_FUTURES_CAPABILITIES.rate_limit_rules)


class BinanceFuturesMarketData:
    """Read-only futures market observation against ``/fapi/v1`` public routes."""

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        rate_limits: RateLimitRegistry | None = None,
        testnet: bool = False,
        rest_base: str | None = None,
    ) -> None:
        base = rest_base or (
            BINANCE_FUTURES_TESTNET_REST_BASE if testnet else BINANCE_FUTURES_REST_BASE
        )
        cleaned = base.strip().rstrip("/")
        if not cleaned.startswith("https://"):
            raise ValueError(
                f"Futures rest_base must be HTTPS; got {base!r}. Observation "
                "over plaintext leaks which addresses/positions are queried."
            )
        if "data-api.binance.vision" in cleaned or "data-stream" in cleaned:
            raise ValueError(
                f"{cleaned} is the spot public mirror and answers no futures endpoint."
            )
        self._send = send
        self._rest_base = cleaned
        self._limits = rate_limits or build_futures_registry()

    @property
    def rest_base(self) -> str:
        return self._rest_base

    def _reserve(self, weight: int) -> None:
        allowed, decisions = self._limits.try_acquire_all(
            {"FUTURES_REQUEST_WEIGHT": weight, "FUTURES_RAW_REQUESTS": 1}
        )
        if not allowed:
            blocking = next((d for d in decisions if not d.allowed), decisions[0])
            raise FuturesRateLimited(
                code=None,
                http_status=None,
                category=ExchangeErrorCategory.RATE_LIMIT_ERROR,
                message=(
                    f"Futures rate budget exhausted for {blocking.rule.name}; "
                    f"retry in {blocking.retry_after_millis} ms"
                ),
                retry_after_millis=blocking.retry_after_millis,
            )

    async def _public(self, path: str, params: Sequence[tuple[str, Any]] = (), *, weight: int = 1) -> Any:
        self._reserve(weight)
        query = "&".join(f"{k}={v}" for k, v in params)
        url = self._rest_base + path + ("?" + query if query else "")
        response: HttpResponse = await self._send(
            method="GET",
            url=url,
            headers={},
        )
        return self._decode(response, weight)

    def _decode(self, response: HttpResponse, weight: int) -> Any:
        status = response.status
        text = response.body_text
        if status >= 400:
            code: int | None = None
            try:
                parsed = __import__("json").loads(text, parse_float=str)
                if isinstance(parsed, Mapping):
                    raw_code = parsed.get("code")
                    code = raw_code if isinstance(raw_code, int) else None
            except Exception:
                pass
            category = classify_futures_error(code, status)
            if status in (418, 429):
                retry = response.retry_after_millis
                raise FuturesRateLimited(
                    code=code,
                    http_status=status,
                    category=category,
                    message=f"Futures venue rate-limited (HTTP {status}, code={code}); back off",
                    retry_after_millis=retry,
                )
            raise FuturesClientError(
                code=code,
                http_status=status,
                category=category,
                message=(
                    f"Futures request refused: http={status} code={code}; "
                    "body redacted upstream by transport sanitisation"
                ),
            )
        try:
            return __import__("json").loads(text, parse_float=str)
        except Exception as exc:
            raise FuturesParseError(
                f"futures HTTP body is not valid JSON (weight={weight})"
            ) from exc

    async def fetch_server_time_micros(self) -> int:
        """``GET /fapi/v1/time`` - venue clock, millis -> micros."""
        result = await self._public("/fapi/v1/time", weight=FUTURES_REST_WEIGHTS["time"])
        if not isinstance(result, Mapping) or "serverTime" not in result:
            raise FuturesParseError("futures time response missing serverTime")
        return int(result["serverTime"]) * 1_000

    async def fetch_premium_index(self, symbol: str) -> dict[str, Any]:
        return parse_premium_index(
            await self._public(
                "/fapi/v1/premiumIndex",
                (("symbol", symbol),),
                weight=FUTURES_REST_WEIGHTS["premium_index_symbol"],
            )
        )

    async def fetch_funding_rate_history(
        self, symbol: str, *, limit: int = 3
    ) -> list[dict[str, Any]]:
        raw = await self._public(
            "/fapi/v1/fundingRate",
            (("symbol", symbol), ("limit", limit)),
            weight=FUTURES_REST_WEIGHTS["funding_rate"],
        )
        if not isinstance(raw, list):
            raise FuturesParseError("fundingRate history is not an array")
        return [parse_funding_rate_history_entry(entry) for entry in raw if isinstance(entry, Mapping)]

    async def fetch_price_ticker(self, symbol: str) -> dict[str, Any]:
        """``GET /fapi/v1/ticker/price``: last traded price snapshot."""
        raw = await self._public(
            "/fapi/v1/ticker/price", (("symbol", symbol),), weight=1
        )
        if not isinstance(raw, Mapping):
            raise FuturesParseError("ticker/price is not an object")
        return {
            "symbol": raw.get("symbol"),
            "price": parse_decimal_strict(raw.get("price"), "price"),
            "time_micros": int(raw.get("time", 0)) * 1_000,
        }

    async def fetch_depth_snapshot(self, symbol: str, *, limit: int = 20) -> dict[str, Any]:
        if limit not in (5, 10, 20, 50, 100, 500, 1_000):
            raise FuturesParseError(
                f"fapi depth accepts limits 5/10/20/50/100/500/1000, got {limit}"
            )
        raw = await self._public(
            "/fapi/v1/depth",
            (("symbol", symbol), ("limit", limit)),
            weight=futures_depth_endpoint_weight(limit),
        )
        if not isinstance(raw, Mapping):
            raise FuturesParseError("depth response is not an object")
        if "lastUpdateId" not in raw:
            raise FuturesParseError("depth snapshot missing lastUpdateId")
        bids = raw.get("bids")
        asks = raw.get("asks")
        if not isinstance(bids, list) or not isinstance(asks, list):
            raise FuturesParseError("depth snapshot missing bids/asks")
        return {
            "symbol": symbol,
            "last_update_id": int(raw["lastUpdateId"]),
            "bids": [
                (parse_decimal_strict(p, "bid.price"), parse_decimal_strict(q, "bid.qty"))
                for p, q, *_ in bids
            ],
            "asks": [
                (parse_decimal_strict(p, "ask.price"), parse_decimal_strict(q, "ask.qty"))
                for p, q, *_ in asks
            ],
        }

    async def read_mark_price(self, symbol: str) -> Decimal:
        """Convenience: current mark price via premium index."""
        index = await self.fetch_premium_index(symbol)
        return index["mark_price"]

    async def read_last_funding_rate_8h_bps(self, symbol: str) -> Decimal:
        """Convenience: last 8h funding rate in basis points (sign preserved)."""
        index = await self.fetch_premium_index(symbol)
        return (index["last_funding_rate"] * Decimal(10000)).quantize(Decimal("0.01"))


#: Convenience wrappers used by the outcome resolver & guards; module-level
#: so adapters/tests can patch a single seam without touching the class.
async def read_mark_price(adapter: BinanceFuturesMarketData, symbol: str) -> Decimal:
    return await adapter.read_mark_price(symbol)


async def read_last_funding_rate(adapter: BinanceFuturesMarketData, symbol: str) -> Decimal:
    return await adapter.read_last_funding_rate_8h_bps(symbol)


# Re-exported here so callers importing from the futures package never have to
# grep the spot tree for the primitives this adapter composes.
__all__ += [
    "HttpResponse",
    "SignedRequestSender",
    "parse_futures_account_v2",
    "parse_position_risk_entry",
    "parse_futures_order_status",
    "order_client_id",
    "NormalisedExchangeError",
    "epoch_micros",
]
