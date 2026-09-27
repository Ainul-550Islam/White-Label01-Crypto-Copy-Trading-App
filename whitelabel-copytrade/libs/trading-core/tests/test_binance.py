"""Binance wire-format normalisation.

Payloads below are real Binance message shapes. Parsing is where a venue's
quirks either get contained or leak into the rest of the platform, so these
tests pin down the details that matter: precision, timestamp units, aggressor
side, and refusal to guess when a payload is malformed.
"""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from wlct_trading.enums import ExchangeId, OrderSide
from wlct_trading.exchanges.binance.adapter import (
    BinanceMarketDataAdapter,
    channel_suffix,
    classify_binance_error,
)
from wlct_trading.exchanges.binance.parsers import (
    BinanceParseError,
    parse_book_ticker,
    parse_depth_delta,
    parse_depth_snapshot,
    parse_exchange_info,
    parse_kline,
    parse_rest_kline,
    parse_trade,
    stream_name,
    unwrap_combined_stream,
)
from wlct_trading.exchanges.symbols import SymbolMapping
from wlct_trading.market_data import SymbolRef
from wlct_trading.transport.errors import ExchangeErrorCategory
from wlct_trading.transport.subscriptions import MarketDataChannel

SYMBOL = "BTC-USDT"

DEPTH_SNAPSHOT = {
    "lastUpdateId": 1_027_024,
    "bids": [["4.00000000", "431.00000000"], ["3.90000000", "12.00000000"]],
    "asks": [["4.00000200", "12.00000000"], ["4.10000000", "8.00000000"]],
}

DEPTH_DELTA = {
    "e": "depthUpdate",
    "E": 1_672_515_782_136,
    "s": "BTCUSDT",
    "U": 157,
    "u": 160,
    "b": [["0.0024", "10"]],
    "a": [["0.0026", "100"]],
}

TRADE = {
    "e": "trade",
    "E": 1_672_515_782_136,
    "s": "BTCUSDT",
    "t": 12_345,
    "p": "0.001",
    "q": "100",
    "T": 1_672_515_782_136,
    "m": True,
    "M": True,
}

BOOK_TICKER = {
    "u": 400_900_217,
    "s": "BTCUSDT",
    "b": "25.35190000",
    "B": "31.21000000",
    "a": "25.36520000",
    "A": "40.66000000",
}

KLINE = {
    "e": "kline",
    "E": 1_672_515_782_136,
    "s": "BTCUSDT",
    "k": {
        "t": 1_672_515_780_000,
        "T": 1_672_515_839_999,
        "s": "BTCUSDT",
        "i": "1m",
        "o": "0.0010",
        "c": "0.0020",
        "h": "0.0025",
        "l": "0.0015",
        "v": "1000",
        "n": 100,
        "x": False,
    },
}


# ----------------------------------------------------------------------
# Depth
# ----------------------------------------------------------------------
def test_depth_snapshot_parses_into_decimals() -> None:
    snapshot = parse_depth_snapshot(DEPTH_SNAPSHOT, SYMBOL)
    assert snapshot.exchange is ExchangeId.BINANCE
    assert snapshot.symbol == SYMBOL
    assert snapshot.last_update_id == 1_027_024
    assert snapshot.bids[0].price == Decimal("4.00000000")
    assert isinstance(snapshot.bids[0].quantity, Decimal)


def test_depth_delta_preserves_the_update_id_range() -> None:
    """The U/u range is what the book's sequence validation depends on."""
    delta = parse_depth_delta(DEPTH_DELTA, SYMBOL)
    assert delta.first_update_id == 157
    assert delta.final_update_id == 160
    assert delta.previous_final_update_id is None


def test_depth_delta_converts_milliseconds_to_microseconds() -> None:
    """Binance publishes milliseconds; the platform standardised on micros."""
    delta = parse_depth_delta(DEPTH_DELTA, SYMBOL)
    assert delta.exchange_timestamp == 1_672_515_782_136 * 1_000


def test_zero_quantity_levels_are_preserved_as_deletions() -> None:
    """A zero level means 'remove this price'.

    Dropping it in the parser leaves a stale level resting in the book forever.
    """
    payload = {**DEPTH_DELTA, "b": [["0.0024", "0"]]}
    delta = parse_depth_delta(payload, SYMBOL)
    assert delta.bids[0].quantity == Decimal(0)


def test_inverted_update_range_is_rejected() -> None:
    with pytest.raises(BinanceParseError, match="inverted"):
        parse_depth_delta({**DEPTH_DELTA, "U": 200, "u": 100}, SYMBOL)


def test_missing_required_field_is_rejected_not_defaulted() -> None:
    """Substituting a default here would inject a fabricated price."""
    payload = {k: v for k, v in DEPTH_DELTA.items() if k != "u"}
    with pytest.raises(BinanceParseError, match="'u'"):
        parse_depth_delta(payload, SYMBOL)


def test_float_input_is_rejected_because_precision_is_already_lost() -> None:
    """Binance sends strings precisely so precision survives.

    A float means the JSON was parsed lossily upstream; accepting it would
    silently corrupt prices.
    """
    with pytest.raises(BinanceParseError, match="float"):
        parse_depth_delta({**DEPTH_DELTA, "b": [[0.0024, "10"]]}, SYMBOL)


def test_malformed_level_is_rejected() -> None:
    with pytest.raises(BinanceParseError, match="malformed"):
        parse_depth_delta({**DEPTH_DELTA, "b": [["0.0024"]]}, SYMBOL)


# ----------------------------------------------------------------------
# Trades
# ----------------------------------------------------------------------
def test_buyer_maker_true_means_the_seller_was_the_aggressor() -> None:
    """The single easiest field on the venue to get backwards.

    ``m: true`` means the buyer was the maker, so the taker — the aggressor —
    was the seller. Inverting this flips every order-flow signal.
    """
    trade = parse_trade(TRADE, SYMBOL)
    assert trade.aggressor_side is OrderSide.SELL


def test_buyer_maker_false_means_the_buyer_was_the_aggressor() -> None:
    trade = parse_trade({**TRADE, "m": False}, SYMBOL)
    assert trade.aggressor_side is OrderSide.BUY


def test_trade_price_and_quantity_are_decimals() -> None:
    trade = parse_trade(TRADE, SYMBOL)
    assert trade.price == Decimal("0.001")
    assert trade.quantity == Decimal("100")
    assert trade.notional == Decimal("0.1")


def test_non_boolean_maker_flag_is_rejected() -> None:
    with pytest.raises(BinanceParseError, match="isBuyerMaker"):
        parse_trade({**TRADE, "m": "true"}, SYMBOL)


def test_aggregate_trade_id_is_accepted() -> None:
    payload = {k: v for k, v in TRADE.items() if k != "t"}
    trade = parse_trade({**payload, "a": 999}, SYMBOL)
    assert trade.trade_id == "999"


# ----------------------------------------------------------------------
# Tickers and candles
# ----------------------------------------------------------------------
def test_book_ticker_has_no_last_price() -> None:
    """The stream carries no trade price, so none is invented."""
    ticker = parse_book_ticker(BOOK_TICKER, SYMBOL)
    assert ticker.bid_price == Decimal("25.35190000")
    assert ticker.ask_price == Decimal("25.36520000")
    assert ticker.last_price is None
    assert ticker.mid_price == Decimal("25.35855")


def test_kline_marks_unclosed_bars() -> None:
    """Only closed bars may be persisted; an open bar is revised repeatedly."""
    candle = parse_kline(KLINE, SYMBOL)
    assert candle.is_closed is False
    assert candle.interval == "1m"
    assert candle.open == Decimal("0.0010")
    assert candle.close == Decimal("0.0020")
    assert candle.trade_count == 100


def test_closed_kline_is_flagged() -> None:
    payload = {**KLINE, "k": {**KLINE["k"], "x": True}}
    assert parse_kline(payload, SYMBOL).is_closed is True


def test_rest_kline_row_is_parsed_positionally() -> None:
    row = [
        1_672_515_780_000,
        "0.0010",
        "0.0025",
        "0.0015",
        "0.0020",
        "1000",
        1_672_515_839_999,
        "2.5",
        100,
    ]
    candle = parse_rest_kline(row, SYMBOL, "1m")
    assert candle.high == Decimal("0.0025")
    assert candle.low == Decimal("0.0015")
    assert candle.is_closed is True


def test_short_rest_kline_row_is_rejected() -> None:
    with pytest.raises(BinanceParseError):
        parse_rest_kline([1, "2", "3"], SYMBOL, "1m")


# ----------------------------------------------------------------------
# exchangeInfo
# ----------------------------------------------------------------------
EXCHANGE_INFO = {
    "symbols": [
        {
            "symbol": "BTCUSDT",
            "status": "TRADING",
            "baseAsset": "BTC",
            "quoteAsset": "USDT",
            "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": "0.01000000"},
                {
                    "filterType": "LOT_SIZE",
                    "stepSize": "0.00001000",
                    "minQty": "0.00001000",
                    "maxQty": "9000.00000000",
                },
                {"filterType": "NOTIONAL", "minNotional": "5.00000000"},
            ],
        },
        {
            "symbol": "HALTEDUSDT",
            "status": "BREAK",
            "baseAsset": "HALTED",
            "quoteAsset": "USDT",
            "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": "0.10000000"},
                {"filterType": "LOT_SIZE", "stepSize": "1.00000000", "minQty": "1"},
            ],
        },
        {
            "symbol": "BROKENUSDT",
            "status": "TRADING",
            "baseAsset": "BROKEN",
            "quoteAsset": "USDT",
            "filters": [],
        },
    ]
}


def test_exchange_info_yields_authoritative_specifications() -> None:
    specifications = parse_exchange_info(EXCHANGE_INFO)
    by_symbol = {s.symbol: s for s in specifications}

    btc = by_symbol["BTC-USDT"]
    assert btc.venue_symbol == "BTCUSDT"
    assert btc.base_asset == "BTC"
    assert btc.quote_asset == "USDT"
    assert btc.price_tick == Decimal("0.01000000")
    assert btc.min_notional == Decimal("5.00000000")
    assert btc.is_tradeable is True


def test_precision_is_derived_from_the_tick_not_the_string_length() -> None:
    """``0.01000000`` means 2 decimal places, not 8."""
    btc = {s.symbol: s for s in parse_exchange_info(EXCHANGE_INFO)}["BTC-USDT"]
    assert btc.price_precision == 2
    assert btc.quantity_precision == 5


def test_non_trading_symbols_are_marked_untradeable_not_dropped() -> None:
    halted = {s.symbol: s for s in parse_exchange_info(EXCHANGE_INFO)}["HALTED-USDT"]
    assert halted.is_tradeable is False


def test_symbols_with_unreadable_filters_are_skipped() -> None:
    """A fabricated tick size produces orders the venue rejects."""
    symbols = {s.symbol for s in parse_exchange_info(EXCHANGE_INFO)}
    assert "BROKEN-USDT" not in symbols


def test_exchange_info_without_symbols_is_rejected() -> None:
    with pytest.raises(BinanceParseError):
        parse_exchange_info({})


# ----------------------------------------------------------------------
# Stream naming and framing
# ----------------------------------------------------------------------
def test_stream_names_are_lower_case() -> None:
    """An upper-case stream name is accepted and then never delivers data."""
    assert stream_name("BTCUSDT", "depth@100ms") == "btcusdt@depth@100ms"


def test_channel_suffixes_match_binance_stream_names() -> None:
    assert channel_suffix(MarketDataChannel.ORDER_BOOK) == "depth@100ms"
    assert channel_suffix(MarketDataChannel.TRADES) == "trade"
    assert channel_suffix(MarketDataChannel.BOOK_TICKER) == "bookTicker"
    assert channel_suffix(MarketDataChannel.CANDLES, interval="5m") == "kline_5m"


def test_combined_stream_payload_is_unwrapped() -> None:
    stream, payload = unwrap_combined_stream(
        {"stream": "btcusdt@trade", "data": TRADE}
    )
    assert stream == "btcusdt@trade"
    assert payload["e"] == "trade"


def test_raw_stream_payload_passes_through_unchanged() -> None:
    stream, payload = unwrap_combined_stream(TRADE)
    assert stream is None
    assert payload is TRADE


# ----------------------------------------------------------------------
# Error classification
# ----------------------------------------------------------------------
def test_binance_rate_limit_code_maps_to_the_rate_limit_category() -> None:
    error = ValueError("Too many requests")
    error.code = -1003  # type: ignore[attr-defined]
    assert (
        classify_binance_error(error).category
        is ExchangeErrorCategory.RATE_LIMIT_ERROR
    )


def test_http_418_is_treated_as_a_rate_limit_ban() -> None:
    """418 is Binance's 'you ignored 429 and are now banned'."""
    normalised = classify_binance_error(RuntimeError("banned"), http_status=418)
    assert normalised.category is ExchangeErrorCategory.RATE_LIMIT_ERROR
    assert normalised.is_retryable is True


def test_bad_api_key_maps_to_a_non_retryable_auth_error() -> None:
    error = ValueError("Invalid API-key")
    error.code = -2015  # type: ignore[attr-defined]
    normalised = classify_binance_error(error)
    assert normalised.category is ExchangeErrorCategory.AUTHENTICATION_ERROR
    assert normalised.is_retryable is False


def test_unknown_error_defaults_to_network_not_to_silent_success() -> None:
    normalised = classify_binance_error(OSError("connection reset"))
    assert normalised.category is ExchangeErrorCategory.NETWORK_ERROR


def test_classified_errors_never_carry_credentials() -> None:
    error = ValueError("rejected")
    error.code = -2014  # type: ignore[attr-defined]
    normalised = classify_binance_error(error)
    rendered = str(normalised.to_log_fields()).lower()
    assert "secret" not in rendered


# ----------------------------------------------------------------------
# Adapter framing
# ----------------------------------------------------------------------
def build_adapter() -> BinanceMarketDataAdapter:
    async def http_get(url: str, params: dict[str, object]) -> dict[str, object]:
        return {}

    return BinanceMarketDataAdapter(http_get)


def register_ref(
    adapter: BinanceMarketDataAdapter, base: str, quote: str = "USDT"
) -> SymbolRef:
    """Register a symbol with the adapter and return its reference."""
    mapping = adapter.symbol_registry.register(
        SymbolMapping(
            canonical=f"{base}-{quote}",
            venue_symbol=f"{base}{quote}",
            exchange=ExchangeId.BINANCE,
            base_asset=base,
            quote_asset=quote,
        )
    )
    return mapping.to_symbol_ref()


def test_subscribe_frames_are_batched_to_respect_the_message_cap() -> None:
    """Five inbound messages per second: one frame per stream disconnects us."""
    adapter = build_adapter()
    subscriptions = tuple(
        adapter.build_subscription(
            register_ref(adapter, f"SYM{index}"), MarketDataChannel.TRADES
        )
        for index in range(250)
    )

    frames = adapter.build_subscribe_frames(subscriptions)
    assert len(frames) == 2
    first = json.loads(frames[0])
    assert first["method"] == "SUBSCRIBE"
    assert len(first["params"]) == 200
    assert first["id"] != json.loads(frames[1])["id"]


def test_combined_stream_url_names_every_stream() -> None:
    """Subscribing via the URL removes the open-but-silent window."""
    adapter = build_adapter()
    ref = register_ref(adapter, "BTC")

    subscriptions = (
        adapter.build_subscription(ref, MarketDataChannel.ORDER_BOOK),
        adapter.build_subscription(ref, MarketDataChannel.TRADES),
    )
    url = adapter.stream_url(subscriptions)
    assert url.startswith("wss://stream.binance.com:9443/stream?streams=")
    assert "btcusdt@depth@100ms" in url
    assert "btcusdt@trade" in url


def test_testnet_uses_the_testnet_endpoints() -> None:
    async def http_get(url: str, params: dict[str, object]) -> dict[str, object]:
        return {}

    adapter = BinanceMarketDataAdapter(http_get, testnet=True)
    assert adapter.is_testnet is True
    assert "testnet" in adapter.stream_url(())
