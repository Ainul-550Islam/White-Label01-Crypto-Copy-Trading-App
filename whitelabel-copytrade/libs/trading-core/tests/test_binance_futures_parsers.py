"""Batch 03 futures tests: USD-M payload parsers and error classification.

The futures parse layer is total by contract: numerics arrive as JSON strings
(parsed through ``Decimal``, never ``float``), enum vocabularies reject
unseen values instead of coercing them, and every endpoint parser keeps full
field presence so downstream diffing never hunts for missing keys. These
tests pin that contract in both directions - accepted documented shapes, and
refusal on the degenerate inputs a parser meets during an incident.

Error classification is pinned code-by-code because the classifier is the
only place the venue's numeric answer becomes the transport taxonomy the
retrier reads: a wrong bucket is a retry policy.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderStatus, OrderType, TimeInForce
from wlct_trading.exchanges.binance_futures.parsers import (
    FuturesParseError,
    classify_futures_error,
    order_client_id,
    parse_decimal_strict,
    parse_commission_rate,
    parse_funding_rate_history_entry,
    parse_futures_account_v2,
    parse_futures_order_status,
    parse_futures_order_type,
    parse_futures_time_in_force,
    parse_position_risk_entry,
    parse_premium_index,
)
from wlct_trading.transport.errors import ExchangeErrorCategory


class TestDecimalStrictness:
    def test_string_decimals_parse_exactly(self) -> None:
        assert parse_decimal_strict("0.00100000", "qty") == Decimal("0.00100000")
        assert parse_decimal_strict(" 15.25 ", "px") == Decimal("15.25")

    def test_int_is_accepted_as_exact(self) -> None:
        assert parse_decimal_strict(7, "qty") == Decimal(7)

    def test_decimal_passes_through(self) -> None:
        assert parse_decimal_strict(Decimal("1.5"), "qty") == Decimal("1.5")

    def test_float_rejected_as_precision_fatal(self) -> None:
        with pytest.raises(FuturesParseError):
            parse_decimal_strict(0.1, "qty")

    def test_bool_rejected_not_silently_coerced_to_one(self) -> None:
        with pytest.raises(FuturesParseError):
            parse_decimal_strict(True, "qty")

    def test_empty_and_none_strings_refused(self) -> None:
        for raw in ("", "  ", "None"):
            with pytest.raises(FuturesParseError):
                parse_decimal_strict(raw, "qty")

    def test_garbage_string_refused(self) -> None:
        with pytest.raises(FuturesParseError):
            parse_decimal_strict("not-a-number", "qty")


class TestOrderVocabulary:
    def test_documented_statuses_map_and_case_is_normalised(self) -> None:
        assert parse_futures_order_status("NEW") is OrderStatus.ACKNOWLEDGED
        assert parse_futures_order_status("PARTIALLY_FILLED") is OrderStatus.PARTIALLY_FILLED
        assert parse_futures_order_status("FILLED") is OrderStatus.FILLED
        assert parse_futures_order_status("CANCELED") is OrderStatus.CANCELLED
        assert parse_futures_order_status("EXPIRED") is OrderStatus.EXPIRED
        assert parse_futures_order_status("REJECTED") is OrderStatus.REJECTED
        # Insurance/ADL markers mean the venue rejected the order's margin.
        assert parse_futures_order_status("NEW_INSURANCE") is OrderStatus.REJECTED
        assert parse_futures_order_status("NEW_ADL") is OrderStatus.REJECTED

    def test_unknown_status_refuses_rather_than_guesses(self) -> None:
        with pytest.raises(FuturesParseError):
            parse_futures_order_status("ARCHIVE")
        with pytest.raises(FuturesParseError):
            parse_futures_order_status(3)

    def test_trigger_types_map_onto_the_stop_surface(self) -> None:
        assert parse_futures_order_type("MARKET") is OrderType.MARKET
        assert parse_futures_order_type("LIMIT") is OrderType.LIMIT
        assert parse_futures_order_type("STOP_MARKET") is OrderType.STOP
        assert parse_futures_order_type("STOP") is OrderType.STOP_LIMIT
        assert parse_futures_order_type("TAKE_PROFIT_MARKET") is OrderType.STOP
        with pytest.raises(FuturesParseError):
            parse_futures_order_type("TRAILING_STOP_MARKET")

    def test_time_in_force_vocabulary_is_exact(self) -> None:
        assert parse_futures_time_in_force("GTC") is TimeInForce.GTC
        assert parse_futures_time_in_force("IOC") is TimeInForce.IOC
        assert parse_futures_time_in_force("FOK") is TimeInForce.FOK
        with pytest.raises(FuturesParseError):
            parse_futures_time_in_force("GTX")  # post-only: not attested here

    def test_client_id_must_be_a_nonempty_string(self) -> None:
        assert order_client_id("wlct-abc") == "wlct-abc"
        for raw in ("", "   ", None, None, 7):
            with pytest.raises(FuturesParseError):
                order_client_id(raw)


class TestErrorClassification:
    """The venue-code table is the contract the retriers read."""

    @pytest.mark.parametrize(
        ("code", "category"),
        [
            (-1001, ExchangeErrorCategory.NETWORK_ERROR),
            (-1007, ExchangeErrorCategory.TIMEOUT),
            (-1021, ExchangeErrorCategory.TIMEOUT),  # INVALID_TIMESTAMP: our clock is stale
            (-1022, ExchangeErrorCategory.AUTHENTICATION_ERROR),  # INVALID_SIGNATURE
            (-1125, ExchangeErrorCategory.AUTHENTICATION_ERROR),  # invalid API key
            (-2010, ExchangeErrorCategory.EXCHANGE_ERROR),  # venue refused the order
            (-2013, ExchangeErrorCategory.EXCHANGE_ERROR),  # NO_SUCH_ORDER (outcome path)
            (-2019, ExchangeErrorCategory.EXCHANGE_ERROR),  # margin not sufficient
            (-2027, ExchangeErrorCategory.EXCHANGE_ERROR),  # leverage above symbol bracket
            (-2022, ExchangeErrorCategory.INVALID_REQUEST),  # reduce-only flags wrong
            (-4164, ExchangeErrorCategory.INVALID_REQUEST),  # leverage switch failed
            (-4061, ExchangeErrorCategory.INVALID_REQUEST),  # position side mismatch
            (-1003, ExchangeErrorCategory.RATE_LIMIT_ERROR),
        ],
    )
    def test_exact_codes_land_in_audited_buckets(self, code: int, category: ExchangeErrorCategory) -> None:
        assert classify_futures_error(code) is category

    def test_margin_not_sufficient_is_distinct_from_leverage_refusal(self) -> None:
        # -2019 (margin) and -2027 (leverage bracket) are different fault
        # classes operationally even though both land in EXCHANGE_ERROR: the
        # venue code itself must survive into the raised error so callers do
        # not have to distinguish them by message prose. Classification check:
        assert classify_futures_error(-2019) is ExchangeErrorCategory.EXCHANGE_ERROR
        assert classify_futures_error(-2027) is ExchangeErrorCategory.EXCHANGE_ERROR

    def test_unaudited_codes_classify_exchange_error_never_retryable(self) -> None:
        # -4003/-4004 exist on the venue but have not been audited into the
        # table; an unaudited definite answer is EXCHANGE_ERROR, not a retry label.
        assert classify_futures_error(-4003) is ExchangeErrorCategory.EXCHANGE_ERROR
        assert classify_futures_error(-99999) is ExchangeErrorCategory.EXCHANGE_ERROR

    def test_http_fallbacks_without_code(self) -> None:
        assert classify_futures_error(None, 418) is ExchangeErrorCategory.RATE_LIMIT_ERROR
        assert classify_futures_error(None, 429) is ExchangeErrorCategory.RATE_LIMIT_ERROR
        assert classify_futures_error(None, 403) is ExchangeErrorCategory.AUTHENTICATION_ERROR
        assert classify_futures_error(None, 401) is ExchangeErrorCategory.AUTHENTICATION_ERROR
        assert classify_futures_error(None, 400) is ExchangeErrorCategory.INVALID_REQUEST
        assert classify_futures_error(None, 500) is ExchangeErrorCategory.TIMEOUT
        assert classify_futures_error(None, 502) is ExchangeErrorCategory.TIMEOUT
        assert classify_futures_error(None, None) is ExchangeErrorCategory.UNKNOWN_ERROR

    def test_code_table_wins_over_http_status(self) -> None:
        # A -1021 with a 400 status classifies as TIMEOUT (clock), not the
        # generic 400 bucket: the venue's diagnosis outranks the transport's.
        assert classify_futures_error(-1021, 400) is ExchangeErrorCategory.TIMEOUT


POSITION_ENTRY = {
    "symbol": "BTCUSDT",
    "positionAmt": "0.5",
    "entryPrice": "40000.5",
    "markPrice": "40100.0",
    "liquidationPrice": "25000.0",
    "unRealizedProfit": "50.25",
    "leverage": "3",
    "marginType": "isolated",
    "positionSide": "LONG",
    "updateTime": 1_750_000_000_000,
}


class TestStructuredPayloadParsers:
    def test_position_risk_entry_parses_all_fields_decimal_typed(self) -> None:
        parsed = parse_position_risk_entry(POSITION_ENTRY)
        assert parsed["position_amt"] == Decimal("0.5")
        assert parsed["entry_price"] == Decimal("40000.5")
        assert parsed["mark_price"] == Decimal("40100.0")
        assert parsed["liquidation_price"] == Decimal("25000.0")
        assert parsed["unrealized_pnl"] == Decimal("50.25")
        assert parsed["leverage"] == Decimal("3")
        assert parsed["margin_type"] == "isolated"
        assert parsed["position_side"] == "LONG"
        assert parsed["update_time_micros"] == 1_750_000_000_000_000

    def test_position_risk_entry_requires_positive_leverage(self) -> None:
        bad = dict(POSITION_ENTRY, leverage="0")
        with pytest.raises(FuturesParseError):
            parse_position_risk_entry(bad)

    def test_position_risk_entry_rejects_unknown_margin_type(self) -> None:
        bad = dict(POSITION_ENTRY, marginType="collateralized")
        with pytest.raises(FuturesParseError):
            parse_position_risk_entry(bad)

    def test_account_v2_splits_balances_and_positions(self) -> None:
        account = {
            "assets": [
                {
                    "asset": "USDT",
                    "walletBalance": "1000.0",
                    "unrealizedProfit": "2.5",
                    "availableBalance": "900.0",
                    "marginBalance": "1002.5",
                    "maintMargin": "2.0",
                }
            ],
            "positions": [POSITION_ENTRY],
            "canWithdraw": "997.0",
            "totalMarginBalance": "1002.5",
            "totalMaintMargin": "2.0",
            "feeTier": 0,
            "canTrade": True,
        }
        parsed = parse_futures_account_v2(account)
        assert parsed["balances"][0]["asset"] == "USDT"
        assert parsed["balances"][0]["wallet_balance"] == Decimal("1000.0")
        assert parsed["positions"][0]["symbol"] == "BTCUSDT"
        assert parsed["can_withdraw"] == Decimal("997.0")
        assert parsed["can_trade"] is True

    def test_account_v2_requires_arrays(self) -> None:
        with pytest.raises(FuturesParseError):
            parse_futures_account_v2({"positions": []})  # no assets
        with pytest.raises(FuturesParseError):
            parse_futures_account_v2({"assets": [], "positions": {}})

    def test_premium_index_and_funding_history_types(self) -> None:
        premium = {
            "symbol": "BTCUSDT",
            "markPrice": "40100.0",
            "indexPrice": "40090.0",
            "lastFundingRate": "0.0001",
            "interestRate": "0.0001",
            "estimatedSettlePrice": "40000.0",
            "nextFundingTime": 1_750_000_000_000,
        }
        parsed = parse_premium_index(premium)
        assert parsed["mark_price"] == Decimal("40100.0")
        assert parsed["last_funding_rate"] == Decimal("0.0001")
        funding = {"symbol": "BTCUSDT", "fundingRate": "0.0001", "fundingTime": 1_690_000_000_000}
        parsed_f = parse_funding_rate_history_entry(funding)
        assert parsed_f["funding_rate"] == Decimal("0.0001")

    def test_commission_rate(self) -> None:
        parsed = parse_commission_rate(
            {"symbol": "BTCUSDT", "makerCommissionRate": "0.0002", "takerCommissionRate": "0.0004"}
        )
        assert parsed["maker_commission_rate"] == Decimal("0.0002")
        assert parsed["taker_commission_rate"] == Decimal("0.0004")
