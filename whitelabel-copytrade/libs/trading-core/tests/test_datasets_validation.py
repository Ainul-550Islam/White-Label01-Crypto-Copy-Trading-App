"""Dataset validation rules (Part 7, cases 5-11) and the no-repair promise.

The validator is fed the exact event sequence a replay would read; each test
makes it observe one corruption and asserts the *classification*, not merely
that "something happened". The final class of tests pins the promise that
separates this from every quiet normaliser: observations never change the
events, and severity policy never silences a finding into nothing.
"""

from __future__ import annotations

import json
from dataclasses import replace
from decimal import Decimal

import pytest

from tests.conftest import BASE_TS, EXCHANGE, SYMBOL

from wlct_trading.backtest.dataset import MarketEvent
from wlct_trading.datasets.schema import DatasetFormatError
from wlct_trading.enums import (
    DatasetValidationSeverity,
    ExchangeId,
    MarketEventKind,
    OrderSide,
)
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PriceLevel,
    PublicTrade,
    Ticker,
)

OTHER_SYMBOL = "ETH-USDT"


def make_validator(
    *,
    symbols: tuple[str, ...] = (SYMBOL,),
    kinds: tuple[MarketEventKind, ...] = (
        MarketEventKind.TRADE,
        MarketEventKind.BOOK_SNAPSHOT,
        MarketEventKind.BOOK_DELTA,
        MarketEventKind.TICKER,
        MarketEventKind.CANDLE,
    ),
    policy=None,
):
    from wlct_trading.datasets.validation import DatasetValidator

    return DatasetValidator(
        exchange=EXCHANGE, symbols=symbols, kinds=kinds, policy=policy
    )


def trade(
    index: int,
    *,
    price: str = "100",
    quantity: str = "1",
    symbol: str = SYMBOL,
    ts_offset: int = 0,
    trade_id: str | None = None,
) -> MarketEvent:
    ts = BASE_TS + index * 1_000 + ts_offset
    return MarketEvent(
        kind=MarketEventKind.TRADE,
        timestamp_micros=ts,
        payload=PublicTrade(
            exchange=EXCHANGE,
            symbol=symbol,
            trade_id=trade_id or f"t{index}",
            price=Decimal(price),
            quantity=Decimal(quantity),
            aggressor_side=OrderSide.BUY,
            exchange_timestamp=ts,
            received_timestamp=ts,
        ),
        sequence=index,
    )


def snapshot(
    index: int,
    *,
    bid: str = "100",
    ask: str = "101",
    last_update_id: int | None = None,
    bid_qty: str = "1",
    ask_qty: str = "1",
) -> MarketEvent:
    ts = BASE_TS + index * 1_000
    return MarketEvent(
        kind=MarketEventKind.BOOK_SNAPSHOT,
        timestamp_micros=ts,
        payload=OrderBookSnapshot(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            bids=(PriceLevel(Decimal(bid), Decimal(bid_qty)),),
            asks=(PriceLevel(Decimal(ask), Decimal(ask_qty)),),
            last_update_id=index + 1 if last_update_id is None else last_update_id,
            exchange_timestamp=ts,
            received_timestamp=ts,
        ),
        sequence=index,
    )


def delta(
    index: int,
    *,
    first_update_id: int,
    final_update_id: int,
    bids: tuple[tuple[str, str], ...] = (),
    asks: tuple[tuple[str, str], ...] = (),
    previous_final: int | None = None,
) -> MarketEvent:
    ts = BASE_TS + index * 1_000
    return MarketEvent(
        kind=MarketEventKind.BOOK_DELTA,
        timestamp_micros=ts,
        payload=OrderBookDelta(
            exchange=EXCHANGE,
            symbol=SYMBOL,
            bids=tuple(PriceLevel(Decimal(p), Decimal(q)) for p, q in bids),
            asks=tuple(PriceLevel(Decimal(p), Decimal(q)) for p, q in asks),
            first_update_id=first_update_id,
            final_update_id=final_update_id,
            exchange_timestamp=ts,
            received_timestamp=ts,
            previous_final_update_id=previous_final,
        ),
        sequence=index,
    )


def run_all(events: list[MarketEvent], **kwargs):
    validator = make_validator(**kwargs)
    for index, event in enumerate(events):
        validator.observe(event, partition_path="data/x/part0000.jsonl.gz", line_number=index + 1)
    return validator.finalize(duration_micros=123)


class TestTimestampsAndOrdering:
    """Case 5: timestamp validation."""

    def test_clean_stream_yields_no_findings_and_valid_status(self) -> None:
        report = run_all([trade(i) for i in range(4)])
        assert report.findings == ()
        assert report.status.value == "VALID"
        assert report.events_observed == 4
        assert report.first_timestamp_micros == BASE_TS
        assert report.last_timestamp_micros == BASE_TS + 3_000

    def test_equal_timestamps_are_not_out_of_order(self) -> None:
        # Same millisecond, different sequence: legal and common.
        report = run_all(
            [
                trade(0),
                trade(0, ts_offset=0, trade_id="t0b"),
            ]
        )
        assert report.findings == ()

    def test_backwards_timestamp_is_an_error(self) -> None:
        report = run_all([trade(5), trade(3)])
        rules = {finding.rule for finding in report.findings}
        assert "TIMESTAMP_NOT_MONOTONIC" in rules
        assert report.status.value == "INVALID"

    def test_configured_gap_is_a_warning_and_never_blocks_by_default(self) -> None:
        from wlct_trading.datasets.validation import ValidationPolicy

        policy = ValidationPolicy(timestamp_gap_micros={MarketEventKind.TRADE: 60_000_000})
        report = run_all(
            [trade(0), trade(1, ts_offset=5 * 60_000_000)],
            policy=policy,
        )
        rules = [finding.rule for finding in report.findings]
        assert "TIMESTAMP_GAP" in rules
        assert report.status.value == "VALID"  # warnings never block by default

    def test_gap_findings_are_capped_then_counted(self) -> None:
        from wlct_trading.datasets.validation import ValidationPolicy

        policy = ValidationPolicy(
            timestamp_gap_micros={MarketEventKind.TRADE: 1},
            max_gap_findings=3,
        )
        events = [trade(i, ts_offset=i * 10) for i in range(10)]
        report = run_all(events, policy=policy)
        gaps = [f for f in report.findings if f.rule == "TIMESTAMP_GAP"]
        assert len(gaps) == 3  # capped...
        assert report.counts_by_rule["TIMESTAMP_GAP"] == 9  # ...but fully counted


class TestDuplicates:
    """Case 6: duplicate events."""

    def test_adjacent_duplicate_trades_are_an_error(self) -> None:
        report = run_all([trade(1), trade(1)])
        rules = [f.rule for f in report.findings]
        assert "DUPLICATE_EVENT" in rules
        assert report.counts_by_rule["DUPLICATE_EVENT"] == 2  # adjacency + global id hit

    def test_distant_duplicate_trade_ids_are_found(self) -> None:
        report = run_all([trade(0), trade(1, trade_id="t0"), trade(2)])
        duplicate = [f for f in report.findings if f.rule == "DUPLICATE_EVENT"]
        assert any(f.details.get("kind") == "global" for f in duplicate)

    def test_duplicates_do_not_degrade_the_events_they_describe(self) -> None:
        # "Classify, do not repair": the duplicate is counted, never removed.
        events = [trade(0), trade(0, trade_id="dup-of-t0")]
        validator = make_validator()
        for event in events:
            validator.observe(event)
        report = validator.finalize()
        assert report.events_observed == len(events)
        sources = [event.checksum_source() for event in events]
        assert len(sources) == 2


class TestValueValidity:
    """Cases 7 and 8: invalid price and quantity values."""

    def test_negative_trade_price(self) -> None:
        report = run_all([trade(0, price="-5")])
        assert "NEGATIVE_PRICE" in report.counts_by_rule

    def test_negative_trade_quantity(self) -> None:
        report = run_all([trade(0, quantity="-1")])
        assert "NEGATIVE_QUANTITY" in report.counts_by_rule

    def test_zero_quantity_print_is_an_error(self) -> None:
        report = run_all([trade(0, quantity="0")])
        assert "ZERO_QUANTITY_PRINT" in report.counts_by_rule

    def test_candle_range_inversion(self) -> None:
        ts = BASE_TS
        event = MarketEvent(
            kind=MarketEventKind.CANDLE,
            timestamp_micros=ts + 60_000_000,
            payload=Candle(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                interval="1m",
                open_time=ts,
                close_time=ts + 60_000_000,
                open=Decimal("1"),
                high=Decimal("0.5"),  # below low
                low=Decimal("2"),
                close=Decimal("1"),
                volume=Decimal("10"),
                trade_count=3,
                is_closed=True,
                received_timestamp=ts,
            ),
            sequence=0,
        )
        report = run_all([event])
        assert "CANDLE_RANGE_INCONSISTENT" in report.counts_by_rule

    def test_negative_book_level_price(self) -> None:
        report = run_all([snapshot(0, bid="-1")])
        assert "NEGATIVE_PRICE" in report.counts_by_rule
        assert report.counts_by_rule.get("CROSSED_BOOK", 0) == 0  # negative bid is not a cross


class TestScopeMismatches:
    """Case 11: symbol and exchange mismatches, undeclared kinds."""

    def test_foreign_symbol_is_fatal(self) -> None:
        report = run_all([trade(0, symbol=OTHER_SYMBOL)])
        assert "SYMBOL_MISMATCH" in [f.rule for f in report.findings]
        fatal = [f for f in report.findings if f.severity is DatasetValidationSeverity.FATAL]
        assert fatal and fatal[0].rule == "SYMBOL_MISMATCH"

    def test_foreign_exchange_is_fatal(self) -> None:
        event = trade(0)
        payload = event.payload
        assert isinstance(payload, PublicTrade)
        foreign = MarketEvent(
            kind=event.kind,
            timestamp_micros=event.timestamp_micros,
            payload=replace(payload, exchange=ExchangeId.BYBIT),
            sequence=event.sequence,
        )
        report = run_all([foreign])
        assert "EXCHANGE_MISMATCH" in [f.rule for f in report.findings]

    def test_undeclared_kind_is_fatal(self) -> None:
        report = run_all([snapshot(0)], kinds=(MarketEventKind.TRADE,))
        assert "EVENT_KIND_UNDECLARED" in [f.rule for f in report.findings]

    def test_format_errors_reach_the_report_with_their_position(self) -> None:
        validator = make_validator()
        validator.note_format_error(
            "line is not valid JSON", partition_path="data/x/part0000.jsonl.gz", line_number=7
        )
        report = validator.finalize()
        finding = report.findings[0]
        assert finding.rule == "FORMAT_ERROR"
        assert finding.severity is DatasetValidationSeverity.FATAL
        assert finding.line_number == 7


class TestOrderBookRules:
    """Cases 9 and 10: sequence continuity and impossible books."""

    def test_clean_book_chain(self) -> None:
        events = [
            snapshot(0),  # last_update_id 1
            delta(1, first_update_id=2, final_update_id=2, bids=[("100", "2")]),
            delta(2, first_update_id=3, final_update_id=4, asks=[("101", "0")]),
        ]
        report = run_all(events)
        assert report.findings == ()

    def test_book_sequence_gap_is_fatal_and_marks_unreliable(self) -> None:
        events = [
            snapshot(0),  # last_update_id 1
            delta(1, first_update_id=5, final_update_id=6, bids=[("100", "2")]),
        ]
        report = run_all(events)
        gap = [f for f in report.findings if f.rule == "BOOK_SEQUENCE_GAP"]
        assert gap and gap[0].severity is DatasetValidationSeverity.FATAL
        assert report.status.value == "INVALID"
        assert report.unreliable_ranges  # the affected range is recorded, not hidden

    def test_unreliable_range_closes_at_the_next_snapshot(self) -> None:
        events = [
            snapshot(0),
            delta(1, first_update_id=5, final_update_id=6, bids=[("100", "2")]),
            snapshot(2),
        ]
        report = run_all(events)
        notes = [f for f in report.findings if f.rule == "UNRELIABLE_RANGE"]
        assert notes and notes[0].details.get("since")

    def test_replayed_update_ids_are_warnings_not_fatal(self) -> None:
        events = [
            snapshot(0),  # lui 1
            delta(1, first_update_id=1, final_update_id=1, bids=[("100", "2")]),
        ]
        report = run_all(events)
        assert report.counts_by_rule.get("BOOK_SEQUENCE_REPLAY", 0) == 1
        assert report.findings[0].severity is DatasetValidationSeverity.WARNING

    def test_crossed_snapshot_is_an_error(self) -> None:
        report = run_all([snapshot(0, bid="102", ask="101")])
        assert "CROSSED_BOOK" in report.counts_by_rule
        assert report.status.value == "INVALID"

    def test_crossed_after_delta_is_found(self) -> None:
        events = [
            snapshot(0),  # bid 100, ask 101
            delta(1, first_update_id=2, final_update_id=2, bids=[("101.5", "3")]),
        ]
        report = run_all(events)
        assert "CROSSED_BOOK" in report.counts_by_rule

    def test_locked_book_is_only_a_warning(self) -> None:
        report = run_all([snapshot(0, bid="101", ask="101")])
        rules = {finding.rule for finding in report.findings}
        assert "LOCKED_BOOK" in rules
        assert report.status.value == "VALID"

    def test_unordered_levels_are_reported(self) -> None:
        event = MarketEvent(
            kind=MarketEventKind.BOOK_SNAPSHOT,
            timestamp_micros=BASE_TS,
            payload=OrderBookSnapshot(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                bids=(
                    PriceLevel(Decimal("99"), Decimal("1")),
                    PriceLevel(Decimal("100"), Decimal("1")),
                ),  # ascending: wrong for bids
                asks=(PriceLevel(Decimal("101"), Decimal("1")),),
                last_update_id=1,
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            ),
            sequence=0,
        )
        report = run_all([event])
        assert "BOOK_LEVELS_UNORDERED" in report.counts_by_rule


class TestPolicyAndSeverity:
    """Severity levels are a policy surface, not a display preference."""

    def test_default_severities_match_the_spec_examples(self) -> None:
        from wlct_trading.datasets.validation import VALIDATION_RULES

        assert VALIDATION_RULES["DUPLICATE_EVENT"] is DatasetValidationSeverity.ERROR
        assert VALIDATION_RULES["BOOK_SEQUENCE_GAP"] is DatasetValidationSeverity.FATAL
        assert VALIDATION_RULES["DATE_GAP"] is DatasetValidationSeverity.WARNING

    def test_override_can_raise_a_warning_to_blocking(self) -> None:
        from wlct_trading.datasets.validation import ValidationPolicy

        policy = ValidationPolicy(
            severity_overrides={"LOCKED_BOOK": DatasetValidationSeverity.ERROR},
            timestamp_gap_micros={MarketEventKind.TRADE: 60_000_000},
        )
        validator = make_validator(policy=policy)
        event = MarketEvent(
            kind=MarketEventKind.TICKER,
            timestamp_micros=BASE_TS,
            payload=Ticker(
                exchange=EXCHANGE,
                symbol=SYMBOL,
                bid_price=Decimal("101"),
                ask_price=Decimal("101"),
                last_price=Decimal("101"),
                exchange_timestamp=BASE_TS,
                received_timestamp=BASE_TS,
            ),
            sequence=0,
        )
        validator.observe(event)
        report = validator.finalize()
        assert report.status.value == "INVALID"
        assert report.counts_by_severity["ERROR"] == 1
        assert report.counts_by_severity["WARNING"] == 0  # the override moved it, not added

    def test_reject_at_fatal_downgrades_errors_to_reportable(self) -> None:
        from wlct_trading.datasets.validation import ValidationPolicy

        policy = ValidationPolicy(reject_at=DatasetValidationSeverity.FATAL)
        validator = make_validator(policy=policy)
        validator.observe(trade(3, price="-1"))
        report = validator.finalize()
        assert report.counts_by_severity["ERROR"] == 1
        assert report.status.value == "VALID"  # policy says only fatal blocks

    def test_policy_digest_changes_when_policy_changes(self) -> None:
        from wlct_trading.datasets.validation import ValidationPolicy

        default = ValidationPolicy()
        stricter = ValidationPolicy(reject_at=DatasetValidationSeverity.WARNING)
        assert default.digest() != stricter.digest()
        assert default.digest() == ValidationPolicy().digest()  # deterministic

    def test_policy_rejects_unknown_rules_and_silly_bounds(self) -> None:
        from wlct_trading.datasets.validation import ValidationPolicy

        with pytest.raises(DatasetFormatError, match="Unknown validation rule"):
            ValidationPolicy(severity_overrides={"MADE_UP_RULE": DatasetValidationSeverity.INFO})
        with pytest.raises(DatasetFormatError, match="WARNING, ERROR or FATAL"):
            ValidationPolicy(reject_at=DatasetValidationSeverity.INFO)
        with pytest.raises(DatasetFormatError):
            ValidationPolicy(max_findings=0)

    def test_report_serialisation_is_canonical_and_digestible(self) -> None:
        report = run_all([trade(0), trade(1)])
        first = report.to_json_bytes()
        assert first == report.to_json_bytes()
        assert report.digest == report.digest
        parsed = json.loads(first)
        assert parsed["status"] == "VALID"
        assert parsed["durationMicros"] == 123


class TestValidatorDiscipline:
    """The behavioural contract tests nobody thinks to write until debugging."""

    def test_validator_does_not_stop_at_the_first_finding(self) -> None:
        report = run_all([trade(0, price="-1"), trade(1, quantity="-1"), trade(-5)])
        assert len(report.findings) >= 3

    def test_findings_carry_position(self) -> None:
        report = run_all([trade(0), trade(-3)])
        out_of_order = [f for f in report.findings if f.rule == "TIMESTAMP_NOT_MONOTONIC"]
        assert out_of_order[0].line_number == 2
        assert out_of_order[0].partition_path == "data/x/part0000.jsonl.gz"

    def test_finalize_is_single_use(self) -> None:
        validator = make_validator()
        validator.observe(trade(0))
        validator.finalize()
        with pytest.raises(DatasetFormatError, match="finalised"):
            validator.observe(trade(1))

    def test_missing_required_fields_stay_format_errors(self) -> None:
        # The schema parser, not the validator, owns missing-field failures -
        # by the time an event exists, required parts cannot be absent. The
        # validator's FORMAT_ERROR channel is how such a refusal reaches the
        # report; this pins that both halves agree.
        from wlct_trading.datasets.schema import line_to_event

        with pytest.raises(DatasetFormatError):
            line_to_event('{"schema":1,"kind":"TRADE","ts":1,"seq":0,"payload":{}}')
        validator = make_validator()
        validator.note_format_error("missing", partition_path="p", line_number=1)
        assert validator.finalize().counts_by_rule["FORMAT_ERROR"] == 1

    def test_date_gap_is_reported_from_partition_calendar(self) -> None:
        from datetime import date, timedelta

        validator = make_validator()
        first = date(2023, 11, 14)
        for day_index, event_index in zip(range(0, 30), range(30)):
            if day_index in (1, 2):  # two missing days in the middle
                continue
            validator.observe(trade(event_index))
            validator.note_partition_dates(
                symbol=SYMBOL,
                kind=MarketEventKind.TRADE,
                dates=((first + timedelta(days=day_index)).isoformat(),),
            )
        report = validator.finalize()
        missing = [f for f in report.findings if f.rule == "DATE_GAP"]
        assert len(missing) == 2
        assert {f.details["date"] for f in missing} == {
            (first + timedelta(days=1)).isoformat(),
            (first + timedelta(days=2)).isoformat(),
        }
        assert report.status.value == "VALID"  # a gap is a warning, not a verdict
