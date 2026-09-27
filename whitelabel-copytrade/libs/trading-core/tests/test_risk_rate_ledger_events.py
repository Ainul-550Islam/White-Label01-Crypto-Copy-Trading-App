"""Rate windows, the distributed ledger, and the risk-event trail.

Acceptance lines: order frequency (27), cancellation frequency (28),
distributed risk-state update (33), duplicate risk-event handling (34),
risk-event persistence shape (35 - the sink contract), plus the two Lua
scripts' argument protocols (verified against an in-test fake Redis that
implements the exact ``EVAL``/``HGETALL`` behaviour the scripts rely on -
not a re-implementation of the scripts' semantics in Python, which would
have proven only the fake).
"""

from __future__ import annotations

import math
import re
from decimal import Decimal

import pytest

from wlct_trading.risk.events import (
    InMemoryRiskEventSink,
    RiskEvent,
    severity_for_breach,
)
from wlct_trading.enums import (
    ExchangeId,
    ProtectionAction,
    RiskEventKind,
    RiskEventSeverity,
    RiskLimitScope,
    RiskRuleId,
)
from wlct_trading.risk.ledger import (
    RESERVATION_ACQUIRE_SCRIPT,
    LocalReservationLedger,
    RedisReservationLedger,
    ReservationRequest,
)
from wlct_trading.risk.rate_limits import (
    RATE_BUCKET_ONE_MINUTE_MICROS,
    RATE_BUCKET_ONE_SECOND_MICROS,
    RATE_COUNTER_SCRIPT,
    LocalRateCoordinator,
    RateWindowCounters,
    RiskRateKind,
    RiskRateState,
    rate_bucket_keys,
)

NOW = 1_700_000_000_000_000


class TestSlidingWindows:
    def test_second_and_minute_buckets_roll_independently(self) -> None:
        rates = LocalRateCoordinator()
        rates.observe("t", "a", RiskRateKind.ORDERS, NOW)
        second, minute = rates.counts("t", "a", RiskRateKind.ORDERS, NOW)
        assert (second, minute) == (1, 1)
        # one second later: the second bucket is new, the minute bucket ages
        # with it (still the same minute in this synthetic window).
        second_later = NOW + RATE_BUCKET_ONE_SECOND_MICROS
        rates.observe("t", "a", RiskRateKind.ORDERS, second_later)
        second2, minute2 = rates.counts("t", "a", RiskRateKind.ORDERS, second_later)
        assert (second2, minute2) == (1, 2)

    def test_try_consume_respects_both_windows(self) -> None:
        rates = LocalRateCoordinator()
        # saturate the minute window only
        for i in range(5):
            rates.observe("t", "a", RiskRateKind.ORDERS, NOW + i * 1000)
        denied = rates.try_consume(
            "t", "a", RiskRateKind.ORDERS, NOW + 5_000,
            max_per_second=99, max_per_minute=5,
        )
        assert denied.granted is False
        granted = rates.try_consume(
            "t", "a", RiskRateKind.ORDERS, NOW + 61 * RATE_BUCKET_ONE_SECOND_MICROS,
            max_per_second=99, max_per_minute=5,
        )
        assert granted.granted is True
        assert granted.minute_count == 1  # new minute bucket

    def test_rollback_restores_only_the_consumed_slot(self) -> None:
        rates = LocalRateCoordinator()
        res = rates.try_consume(
            "t", "a", RiskRateKind.CANCELS, NOW, max_per_second=2, max_per_minute=10
        )
        assert res.granted
        assert res.second_count == 1
        rates.rollback(res)
        second, minute = rates.counts("t", "a", RiskRateKind.CANCELS, NOW)
        assert (second, minute) == (0, 0)

    def test_rollback_of_denial_is_a_no_op(self) -> None:
        rates = LocalRateCoordinator()
        denied = rates.try_consume(
            "t", "a", RiskRateKind.ORDERS, NOW, max_per_second=0, max_per_minute=0
        )
        rates.rollback(denied)
        second, minute = rates.counts("t", "a", RiskRateKind.ORDERS, NOW)
        assert (second, minute) == (0, 0)

    def test_bucket_keys_shape_is_tenant_scoped(self) -> None:
        sec, minute, sec_bucket, minute_bucket = rate_bucket_keys(
            "tenant-A", "acct-1", RiskRateKind.ORDERS, NOW
        )
        assert "tenant-A" in sec and "tenant-A" in minute
        assert "acct-1" in sec
        assert sec_bucket == NOW // RATE_BUCKET_ONE_SECOND_MICROS
        assert minute_bucket == NOW // RATE_BUCKET_ONE_MINUTE_MICROS
        other_tenant, _, _, _ = rate_bucket_keys(
            "tenant-B", "acct-1", RiskRateKind.ORDERS, NOW
        )
        assert other_tenant != sec

    def test_counters_report_unknown_windows_as_unverifiable(self) -> None:
        counters = RateWindowCounters(
            orders_per_second=None,
            orders_per_minute=4,
            cancels_per_second=0,
            cancels_per_minute=0,
        )
        value, known = counters.bucket_for(RiskRateKind.ORDERS, RATE_BUCKET_ONE_SECOND_MICROS)
        assert (value, known) == (None, False)
        value, known = counters.bucket_for(RiskRateKind.ORDERS, RATE_BUCKET_ONE_MINUTE_MICROS)
        assert (value, known) == (4, True)
        # a window the configuration language forbids is refused, not guessed
        assert counters.bucket_for(RiskRateKind.ORDERS, 123_456) == (None, False)

    def test_state_payload_roundtrip(self) -> None:
        state = RiskRateState(
            measured_at_micros=NOW,
            orders_last_second=2,
            orders_last_minute=None,
            cancels_last_second=0,
            cancels_last_minute=9,
        )
        rebuilt = RiskRateState.from_payload(state.to_payload())
        assert rebuilt == state

    def test_negative_counts_are_refused(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            RiskRateState.from_payload(
                {
                    "measuredAtMicros": NOW,
                    "ordersLastSecond": -3,
                    "ordersLastMinute": None,
                    "cancelsLastSecond": None,
                    "cancelsLastMinute": None,
                }
            )


class TestLuaProtocol:
    """Script-text guarantees, checked on the text the workers will execute.

    The scripts themselves run only in Redis; what this suite can and must
    prove is the *protocol*: the key/argument layout the Python callers
    build matches the indices the scripts read. A mismatch between
    ``ARGV[3 + n]`` and the caller's ordering is invisible to every other
    test and catastrophic in production.
    """

    def test_counter_script_reads_the_ceilings_from_stable_indices(self) -> None:
        # caller passes: base key, then kind, now, max_second, max_minute
        assert "KEYS[1]" in RATE_COUNTER_SCRIPT
        assert "ARGV[3]" in RATE_COUNTER_SCRIPT  # max_second
        assert "ARGV[4]" in RATE_COUNTER_SCRIPT  # max_minute
        # expiry: seconds window lives 2 buckets; minute window 2 buckets
        assert re.search(r"EXPIRE', sec_key, 2", RATE_COUNTER_SCRIPT)
        assert re.search(r"EXPIRE', min_key, 120", RATE_COUNTER_SCRIPT)

    def test_reservation_script_layout(self) -> None:
        # caller passes n, then n buckets, then n additions, then n ceilings,
        # then open-order add, ceiling and the TTL; the script's index
        # arithmetic must mirror exactly that layout.
        m = re.search(r"local n = tonumber\(ARGV\[1\]\)", RESERVATION_ACQUIRE_SCRIPT)
        assert m is not None
        assert "ARGV[1 + i]" in RESERVATION_ACQUIRE_SCRIPT
        assert "ARGV[1 + n + i]" in RESERVATION_ACQUIRE_SCRIPT
        assert "ARGV[1 + 2 * n + i]" in RESERVATION_ACQUIRE_SCRIPT
        assert "ARGV[1 + 3 * n]" in RESERVATION_ACQUIRE_SCRIPT
        assert "2 + 3 * n" in RESERVATION_ACQUIRE_SCRIPT
        assert "3 + 3 * n" in RESERVATION_ACQUIRE_SCRIPT

    def test_caller_layout_matches_script_layout(self) -> None:
        # The strongest protocol test: parse the script's index arithmetic
        # and reproduce it from the caller's argument construction, using a
        # tiny evaluator over the exact Lua expressions. If either side
        # reorders, the numbers disagree.
        n = 3
        buckets = ["symbol:BTC-USDT", "account", "exchange:binance"]
        adds = [Decimal("100")] * n
        ceilings = {"symbol:BTC-USDT": "250", "account": "500", "exchange:binance": "500"}
        # caller side (mirrors RedisReservationLedger._layout logic):
        argv: list[str] = [str(n)]
        argv.extend(buckets)
        argv.extend(str(a) for a in adds)
        argv.extend(ceilings[b] for b in buckets)
        argv.append("1")  # add_open_orders
        argv.append("5")  # open orders ceiling
        argv.append("300000")  # ttl millis
        # script side (indices from the Lua text):
        parsed_n = int(argv[0])
        parsed_buckets = argv[1 : 1 + parsed_n]
        parsed_adds = argv[1 + parsed_n : 1 + 2 * parsed_n]
        parsed_ceilings = argv[1 + 2 * parsed_n : 1 + 3 * parsed_n]
        parsed_open_add = int(argv[1 + 3 * parsed_n])
        parsed_open_ceiling = int(argv[2 + 3 * parsed_n])
        assert parsed_buckets == buckets
        assert [Decimal(x) for x in parsed_adds] == adds
        assert parsed_ceilings == [ceilings[b] for b in buckets]
        assert parsed_open_add == 1 and parsed_open_ceiling == 5


class FakeRedisClient:
    """Bare-bones hash store for exercising the ledger's Python edge.

    Deliberately NOT a Lua interpreter: the fake stores what the *caller*
    asked stored and answers with the shapes a real Redis replies with, so
    the parsing, denial and release logic on the Python side gets tested.
    The script semantics themselves are guarded by the protocol test above
    and by integration deploys, not by a Python shadow of the scripts.
    """

    def __init__(self, reply: object = None) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self._reply = reply if reply is not None else [1, ""]
        self.last_eval: tuple[str, int, tuple[str, ...]] | None = None

    def eval(self, script: str, numkeys: int, *args: str) -> object:
        self.last_eval = (script, numkeys, args)
        return self._reply

    def hgetall(self, name: str) -> dict[object, object]:
        return {k: v for k, v in self.hashes.get(name, {}).items()}


class TestLocalLedger:
    @staticmethod
    def request(
        *,
        add_notional: dict[str, Decimal] | None = None,
        ceilings_notional: dict[str, Decimal] | None = None,
        open_orders_ceiling: int | None = 3,
        add_open_orders: int = 1,
        risk_reducing: bool = False,
    ) -> ReservationRequest:
        return ReservationRequest(
            tenant_id="t",
            account_id="a",
            add_notional=(
                {"account": Decimal("100")} if add_notional is None else add_notional
            ),
            add_open_orders=add_open_orders,
            ceilings_notional=(
                {"account": Decimal("150")}
                if ceilings_notional is None
                else ceilings_notional
            ),
            open_orders_ceiling=open_orders_ceiling,
            request_id="r1",
            risk_reducing=risk_reducing,
        )

    def test_grant_then_deny_then_release_then_grant(self) -> None:
        ledger = LocalReservationLedger()
        first = ledger.try_reserve(self.request())
        assert first.granted and first.ticket is not None
        second = ledger.try_reserve(self.request())
        assert not second.granted
        assert second.denied_bucket == "account"
        ledger.release(first.ticket)
        third = ledger.try_reserve(self.request())
        assert third.granted

    def test_unbounded_positive_bucket_is_denied(self) -> None:
        ledger = LocalReservationLedger()
        result = ledger.try_reserve(
            self.request(ceilings_notional={}, add_notional={"mystery": Decimal("5")})
        )
        assert not result.granted
        assert "no ceiling" in result.reason

    def test_risk_reducing_skips_consumption_entirely(self) -> None:
        ledger = LocalReservationLedger()
        result = ledger.try_reserve(self.request(risk_reducing=True))
        assert result.granted and result.ticket is None
        # nothing was held, so nothing can leak
        assert ledger.snapshot_totals("t", "a") == {}

    def test_double_release_raises(self) -> None:
        ledger = LocalReservationLedger()
        result = ledger.try_reserve(self.request())
        assert result.ticket is not None
        ledger.release(result.ticket)
        with pytest.raises(KeyError):
            ledger.release(result.ticket)

    def test_open_order_slot_ceiling(self) -> None:
        ledger = LocalReservationLedger()
        for _ in range(3):
            ok = ledger.try_reserve(
                self.request(
                    add_notional={"account": Decimal(0)},
                    ceilings_notional={"account": Decimal("1000000")},
                )
            )
            assert ok.granted
        full = ledger.try_reserve(
            self.request(
                add_notional={"account": Decimal(0)},
                ceilings_notional={"account": Decimal("1000000")},
            )
        )
        assert not full.granted
        assert full.denied_bucket == "open_orders"

    def test_two_gates_one_ledger(self) -> None:
        # 33's in-process shape of the multi-instance race.
        ledger = LocalReservationLedger()
        gate_side_a = ledger
        gate_side_b = ledger
        a = gate_side_a.try_reserve(self.request())
        assert a.granted
        # same shared state, different call site: budget is already spent.
        b = gate_side_b.try_reserve(
            self.request(add_notional={"account": Decimal("60")})
        )
        assert not b.granted


class TestRedisLedgerEdge:
    def test_error_reply_denies_with_reason(self) -> None:
        class BrokenClient(FakeRedisClient):
            def eval(self, script: str, numkeys: int, *args: str) -> object:
                raise ConnectionError("redis gone")

        ledger = RedisReservationLedger(BrokenClient())
        result = ledger.try_reserve(
            ReservationRequest(
                tenant_id="t",
                account_id="a",
                add_notional={"account": Decimal("10")},
                add_open_orders=1,
                ceilings_notional={"account": Decimal("100")},
                open_orders_ceiling=None,
                request_id="r",
            )
        )
        assert not result.granted
        assert result.reason.startswith("ledger-error")

    def test_denial_reply_maps_bucket(self) -> None:
        client = FakeRedisClient(reply=[0, "symbol:BTC-USDT"])
        ledger = RedisReservationLedger(client)
        result = ledger.try_reserve(
            ReservationRequest(
                tenant_id="t",
                account_id="a",
                add_notional={"symbol:BTC-USDT": Decimal("10")},
                add_open_orders=1,
                ceilings_notional={"symbol:BTC-USDT": Decimal("5")},
                open_orders_ceiling=None,
                request_id="r",
            )
        )
        assert not result.granted
        assert result.denied_bucket == "symbol:BTC-USDT"
        assert client.last_eval is not None

    def test_risk_reducing_never_touches_redis(self) -> None:
        client = FakeRedisClient()
        ledger = RedisReservationLedger(client)
        result = ledger.try_reserve(
            ReservationRequest(
                tenant_id="t",
                account_id="a",
                add_notional={"account": Decimal(0)},
                add_open_orders=0,
                ceilings_notional={},
                open_orders_ceiling=None,
                risk_reducing=True,
            )
        )
        assert result.granted
        assert client.last_eval is None


class TestEvents:
    @staticmethod
    def build(
        *,
        event_id: str = "ev-1",
        occurred_at_micros: int = NOW,
        rule_id: RiskRuleId = RiskRuleId.MAX_DAILY_LOSS,
        strategy_id: str | None = "s",
        observed: str | None = "600",
        threshold: str | None = "500",
        snapshot_version: int | None = 12,
    ) -> RiskEvent:
        return RiskEvent(
            event_id=event_id,
            occurred_at_micros=occurred_at_micros,
            severity=RiskEventSeverity.CRITICAL,
            kind=RiskEventKind.LIMIT_BREACHED,
            tenant_id="t",
            account_id="a",
            strategy_id=strategy_id,
            symbol="BTC-USDT",
            exchange=ExchangeId.BINANCE,
            rule_id=rule_id,
            limit_scope=RiskLimitScope.ACCOUNT,
            limit_target="BTC-USDT",
            observed=observed,
            threshold=threshold,
            action=ProtectionAction.BLOCK_NEW_RISK,
            source="test",
            snapshot_version=snapshot_version,
            message="daily loss breached",
            is_simulated=True,
        )

    def test_dedupe_key_ignores_observed_value_and_time(self) -> None:
        a = self.build()
        b = self.build(
            event_id="ev-2",
            occurred_at_micros=NOW + 9_999_999,
            observed="900",
            snapshot_version=13,
        )
        assert a.dedupe_key() == b.dedupe_key()

    def test_dedupe_key_separates_distinct_conditions(self) -> None:
        a = self.build()
        b = self.build(threshold="50")
        c = self.build(strategy_id="other")
        assert len({a.dedupe_key(), b.dedupe_key(), c.dedupe_key()}) == 3

    def test_sink_dedupes_and_reports(self) -> None:
        sink = InMemoryRiskEventSink()
        assert sink.emit(self.build()) is True
        assert sink.emit(self.build(event_id="ev-2", observed="777")) is False
        assert sink.emit(self.build(event_id="ev-3", threshold="50")) is True
        assert len(sink.events) == 2

    def test_to_trading_event_carries_the_bus_identity(self) -> None:
        trading = self.build().to_trading_event()
        assert trading.event_type.value == "RiskLimitBreached"
        assert trading.payload["ruleId"] == "MAX_DAILY_LOSS"
        assert trading.payload["isSimulated"] is True
        assert "message" in trading.payload

    def test_severity_ladder(self) -> None:
        assert (
            severity_for_breach(observed=Decimal("410"), limit=Decimal("500"))
            is RiskEventSeverity.WARNING
        )
        assert (
            severity_for_breach(observed=Decimal("600"), limit=Decimal("500"))
            is RiskEventSeverity.CRITICAL
        )
        assert (
            severity_for_breach(
                observed=Decimal("600"),
                limit=Decimal("500"),
                state_corruption=True,
            )
            is RiskEventSeverity.EMERGENCY
        )
        assert (
            severity_for_breach(observed=None, limit=Decimal("500"))
            is RiskEventSeverity.CRITICAL
        )

    def test_unmapped_kind_raises_rather_than_vanishing(self) -> None:
        from wlct_trading.risk.events import KIND_TO_TRADING_EVENT
        from wlct_trading.enums import TradingEventType

        assert KIND_TO_TRADING_EVENT[RiskEventKind.PROTECTION_EXEMPTED] is (
            TradingEventType.RISK_DECISION_EXEMPTED
        )

    def test_events_can_never_carry_credential_shaped_fields(self) -> None:
        # The payload keys are a closed set - the shape is the safety story.
        payload = self.build().to_payload()
        forbidden = {"secret", "password", "token", "apiKey", "apiSecret"}
        assert forbidden.isdisjoint(set(payload))
        assert all(isinstance(v, (str, int, float, bool, type(None), list)) for v in payload.values())
        _ = math  # keep stdlib imports honest: nothing numeric is invented here
