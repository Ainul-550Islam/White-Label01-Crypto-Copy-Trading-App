"""The mandated end-to-end observability chain, on the real Part 8 gate.

    market data goes stale -> risk rejects -> execution is blocked ->
    alert opens -> operator acknowledges (which resolves nothing) ->
    data recovers -> recovery observed -> alert resolved -> incident shows
    the whole chain by id

This is deliberately an *integration* test: it wires the genuine RiskGate
(simulated mode, deterministic clock), the health registry, the alert engine,
the readiness evaluator, the correlation context, the Prometheus renderer and
the incident builder together the way the trading-engine service does, and
asserts the operator-visible consequences at each step. It also asserts the
two negative properties that matter most: acknowledgement is not approval,
and no observability artefact carries an identifier the cardinality policy
forbids.
"""

from __future__ import annotations

from decimal import Decimal

from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderBookHealth,
    OrderSide,
    OrderType,
    RiskDecisionCode,
    RiskLimitScope,
    RiskLimitUnit,
    RiskRuleId,
    TradingMode,
)
from wlct_trading.observability.alerts import AlertEngine, AlertObservation, AlertState
from wlct_trading.observability.correlation import bind, current_context
from wlct_trading.observability.dashboard import DashboardBuilder
from wlct_trading.observability.health import (
    ComponentHealth,
    ComponentStatus,
    HealthRegistry,
)
from wlct_trading.observability.incidents import (
    IncidentLink,
    IncidentLinkKind,
    build_incident,
    links_from_events,
)
from wlct_trading.observability.metrics import (
    ObservabilityRegistry,
    render_prometheus,
)
from wlct_trading.observability.readiness import GateEvidence, evaluate_trading_readiness
from wlct_trading.orders import OrderIntent
from wlct_trading.risk.configuration import RiskConfiguration, RiskLimitEntry
from wlct_trading.risk.events import InMemoryRiskEventSink
from wlct_trading.risk.evaluator import RiskGate
from wlct_trading.risk.freshness import FreshnessBudget
from wlct_trading.risk.snapshot import (
    RiskAccountState,
    RiskMarketDataState,
    RiskStateSnapshot,
    RiskStrategyState,
)

NOW = 1_700_000_000_000_000
SYMBOL = "BTC-USDT"
STALE_AGE_MICROS = 61_000_000  # past the 60s budget in the baseline limits


def _limit(rule: RiskRuleId, value: str, unit: RiskLimitUnit) -> RiskLimitEntry:
    return RiskLimitEntry(
        rule_id=rule,
        scope=RiskLimitScope.GLOBAL,
        target=None,
        enabled=True,
        value=Decimal(value),
        unit=unit,
        priority=0,
        effective_from_micros=0,
        effective_until_micros=None,
        entry_version=1,
        window_micros=None,
    )


BASELINE_LIMITS = (
    _limit(RiskRuleId.MAX_ORDER_QUANTITY, "1000", RiskLimitUnit.BASE_QUANTITY),
    _limit(RiskRuleId.MAX_ORDER_NOTIONAL, "1000000", RiskLimitUnit.QUOTE_NOTIONAL),
    _limit(RiskRuleId.MAX_POSITION_QUANTITY, "1000", RiskLimitUnit.BASE_QUANTITY),
    _limit(RiskRuleId.MAX_POSITION_NOTIONAL, "1000000", RiskLimitUnit.QUOTE_NOTIONAL),
    _limit(RiskRuleId.MAX_SYMBOL_EXPOSURE, "1000000", RiskLimitUnit.QUOTE_NOTIONAL),
    _limit(RiskRuleId.MAX_STRATEGY_EXPOSURE, "1000000", RiskLimitUnit.QUOTE_NOTIONAL),
    _limit(RiskRuleId.MAX_ACCOUNT_EXPOSURE, "1000000", RiskLimitUnit.QUOTE_NOTIONAL),
    _limit(RiskRuleId.MAX_EXCHANGE_EXPOSURE, "1000000", RiskLimitUnit.QUOTE_NOTIONAL),
    _limit(RiskRuleId.MAX_OPEN_ORDERS, "100", RiskLimitUnit.COUNT),
    _limit(RiskRuleId.MAX_DAILY_LOSS, "1000000", RiskLimitUnit.LOSS),
    _limit(RiskRuleId.MAX_STRATEGY_DAILY_LOSS, "1000000", RiskLimitUnit.LOSS),
    _limit(RiskRuleId.MAX_DRAWDOWN, "99", RiskLimitUnit.PERCENT),
    _limit(RiskRuleId.MAX_STALE_DATA_AGE, "60000000", RiskLimitUnit.AGE_MICROS),
)


def snapshot(*, quote_age_micros: int, version: int = 11) -> RiskStateSnapshot:
    market = RiskMarketDataState(
        exchange=ExchangeId.BINANCE,
        symbol=SYMBOL,
        best_bid=Decimal("99.5"),
        best_ask=Decimal("100.5"),
        best_bid_quantity=Decimal("10"),
        best_ask_quantity=Decimal("10"),
        last_trade_price=Decimal("100"),
        last_trade_timestamp_micros=NOW - 100_000,
        quote_timestamp_micros=NOW - quote_age_micros,
        book_health=OrderBookHealth.OK if quote_age_micros < STALE_AGE_MICROS else OrderBookHealth.STALE,
        book_sequence=1000,
        feed_connected=quote_age_micros < STALE_AGE_MICROS,
        simulated=True,
    )
    return RiskStateSnapshot(
        snapshot_id="snap-scenario",
        version=version,
        tenant_id="tenant-1",
        account_id="acct-1",
        created_at_micros=NOW,
        trading_day="2023-11-14",
        config_digest=None,
        config_version=None,
        account=RiskAccountState(
            tenant_id="tenant-1",
            account_id="acct-1",
            exchange=ExchangeId.BINANCE,
            equity=Decimal("10000"),
            available=Decimal("9000"),
            reserved=Decimal("1000"),
            source_timestamp_micros=NOW,
        ),
        positions=(),
        open_orders=(),
        market=(market,),
        strategies=(
            RiskStrategyState(
                strategy_id="strat-1",
                realised_pnl_today=Decimal("0"),
                unrealised_pnl=Decimal("0"),
                open_order_count=0,
                consecutive_losses=0,
                is_enabled=True,
                source_timestamp_micros=NOW,
            ),
        ),
        realised_pnl_today=Decimal("0"),
        unrealised_pnl_today=Decimal("0"),
        fees_today=Decimal("0"),
        traded_notional_today=Decimal("0"),
        consecutive_losses=0,
        peak_equity=Decimal("10000"),
        market_type=MarketType.SPOT,
        rate=None,
        missing_sources=frozenset(),
        advisories=frozenset(),
        produced_by="scenario",
        is_simulated=True,
    )


def intent(client_order_id: str) -> OrderIntent:
    return OrderIntent(
        tenant_id="tenant-1",
        account_id="acct-1",
        strategy_id="strat-1",
        exchange=ExchangeId.BINANCE,
        symbol=SYMBOL,
        side=OrderSide.BUY,
        order_type=OrderType.LIMIT,
        quantity=Decimal("1"),
        price=Decimal("100"),
        reduce_only=False,
        client_order_id=client_order_id,
    )


class Harness:
    """One scenario process: gate + registry + health + alerts + readiness."""

    def __init__(self) -> None:
        self.events = InMemoryRiskEventSink()
        self.gate = RiskGate(
            configuration=RiskConfiguration(entries=list(BASELINE_LIMITS)),
            simulated=True,
            events=self.events,
            kill_switches=None,
            freshness=FreshnessBudget(max_snapshot_age_micros=5_000_000),
        )
        self.registry = ObservabilityRegistry(service="trading-engine")
        self.registry.register_counter(
            "wlct_risk_decisions_total", "Risk decisions, by verdict.", "result"
        )
        self.registry.register_gauge(
            "wlct_market_feed_connected", "Feed connected per venue.", "exchange"
        )
        self.registry.register_histogram(
            "wlct_risk_decision_micros",
            "Gate decision path duration (observation, not a guarantee).",
            ("result", "risk_code"),
            buckets=(1_000, 10_000, 100_000),
        )
        self.alerts = AlertEngine()
        self.health = HealthRegistry()
        self.market_age_micros = STALE_AGE_MICROS
        self.feed_connected = False
        self._attempt_seq = 0
        self.health.register(
            "market_data",
            self._probe_market_data,
            freshness_budget_micros=10_000_000,
            readiness=True,
            critical=True,
        )
        self.health.register(
            "risk_engine",
            lambda: (ComponentStatus.HEALTHY, "gate loaded"),
            freshness_budget_micros=60_000_000,
            critical=True,
        )

    def _probe_market_data(self) -> ComponentHealth:
        if not self.feed_connected:
            return ComponentHealth(
                component="market_data",
                status=ComponentStatus.UNHEALTHY,
                reason=f"no messages for {self.market_age_micros // 1_000_000}s",
                captured_at_micros=NOW - self.market_age_micros,
            )
        return ComponentHealth(
            component="market_data",
            status=ComponentStatus.HEALTHY,
            last_success_at_micros=NOW - self.market_age_micros,
            captured_at_micros=NOW,
        )

    def readiness(self) -> object:
        results = {r.component: r for r in self.health.check_all()}
        market = results["market_data"]
        market_ok = (
            market.status is ComponentStatus.HEALTHY
            and market.is_fresh(10_000_000, now_micros=NOW)
        )
        engine_ok = results["risk_engine"].status is ComponentStatus.HEALTHY
        stale_accounts = 0 if market_ok else 1
        return evaluate_trading_readiness(
            {
                "market_data": GateEvidence(
                    value=market_ok, detail=market.reason or "connected"
                ),
                "risk_engine": GateEvidence(value=engine_ok),
                "risk_state_fresh": GateEvidence(
                    value=stale_accounts == 0,
                    detail=f"{stale_accounts} accounts stale",
                ),
                "exchange_connectivity": GateEvidence(value=self.feed_connected),
                "execution_adapter": GateEvidence(value=True, detail="ready"),
                "reconciliation": GateEvidence(value=True, detail="last pass clean"),
                "queues": GateEvidence(value=True, detail="oldest job 2s"),
                "kill_switches": GateEvidence(value=True, detail="none engaged"),
                "configuration": GateEvidence(value=True),
            },
            now_micros=NOW,
        )

    def attempt(self, client_order_id: str) -> RiskDecisionCode:
        self._attempt_seq += 1
        with bind(
            correlation_id="c-scenario",
            tenant_id="tenant-1",
            account_id="acct-1",
            strategy_id="strat-1",
            order_id=client_order_id,
        ) as ctx:
            outcome = self.gate.evaluate(
                intent(client_order_id),
                state=snapshot(
                    quote_age_micros=self.market_age_micros,
                    version=11 + self._attempt_seq,
                ),
                request_id="req-" + client_order_id,
                trading_mode=TradingMode.PAPER,
                now_micros=NOW,
            )
            decision = outcome.decision
            code = decision.code
            result = "approved" if decision.approved else "rejected"
            self.registry.inc("wlct_risk_decisions_total", {"result": result})
            self.registry.observe_micros(
                "wlct_risk_decision_micros",
                {"result": result, "risk_code": code.value},
                4_200,
            )
            if not decision.approved:
                recent_events = self.events.events
                self.alerts.observe(
                    AlertObservation(
                        rule_id="MARKET_DATA_STALE",
                        component="market-data",
                        scope="binance/BTCUSDT",
                        observed_value=str(self.market_age_micros),
                        threshold_value="60000000",
                        message=(
                            f"risk refused {code.value} while the book was stale "
                            f"(ctx {ctx.correlation_id})"
                        ),
                        at_micros=NOW,
                        links={
                            "correlation_id": ctx.correlation_id or "",
                            "operation_id": ctx.order_id or "",
                            "risk_event": recent_events[-1].event_id
                            if recent_events
                            else "unavailable",
                        },
                    )
                )
            return code


def test_market_staleness_rejection_chains_to_alert_and_blocked_readiness() -> None:
    harness = Harness()

    code = harness.attempt("ord-stale-1")
    assert code is RiskDecisionCode.STALE_MARKET_DATA

    # Execution blocked: risk refused, and readiness says so independently.
    verdict = harness.readiness()
    assert verdict.ready is False
    assert "market_data" in verdict.blocking_gates

    # The alert exists, deduped across further attempts.
    first = harness.alerts.active()
    assert len(first) == 1
    assert first[0].rule_id == "MARKET_DATA_STALE"
    assert first[0].state is AlertState.OPEN

    harness.attempt("ord-stale-2")
    harness.attempt("ord-stale-3")
    folded = harness.alerts.active()[0]
    assert folded.occurrences == 3
    assert len({r.alert_id for r in (first[0], folded)}) == 1  # one record, not three


def test_acknowledgement_does_not_resolve_or_unlock() -> None:
    harness = Harness()
    harness.attempt("ord-stale-1")
    harness.alerts.acknowledge(
        rule_id="MARKET_DATA_STALE",
        component="market-data",
        scope="binance/BTCUSDT",
        actor="ops@example",
        at_micros=NOW + 1,
    )
    still_blocked = harness.attempt("ord-stale-2")
    assert still_blocked is RiskDecisionCode.STALE_MARKET_DATA
    record = harness.alerts.active()[0]
    assert record.state is AlertState.ACKNOWLEDGED
    assert record.occurrences == 2
    assert harness.readiness().ready is False  # ack is not a key


def test_recovery_observed_resolves_alert_and_readiness() -> None:
    harness = Harness()
    for client_id in ("ord-stale-1", "ord-stale-2"):
        harness.attempt(client_id)

    # Feed comes back: fresh quote, connected.
    harness.feed_connected = True
    harness.market_age_micros = 50_000
    code = harness.attempt("ord-recovered")
    assert code is RiskDecisionCode.APPROVED

    resolved = harness.alerts.recover(
        rule_id="MARKET_DATA_STALE",
        component="market-data",
        scope="binance/BTCUSDT",
        at_micros=NOW + 10,
        note="feed fresh again",
    )
    assert resolved is not None
    assert resolved.state is AlertState.RESOLVED
    assert resolved.occurrences == 2  # history preserved, not erased
    assert harness.alerts.active() == ()
    assert harness.readiness().ready is True


def test_incident_links_the_whole_chain_by_correlation() -> None:
    harness = Harness()
    harness.attempt("ord-stale-1")
    harness.attempt("ord-stale-2")
    harness.alerts.acknowledge(
        rule_id="MARKET_DATA_STALE", component="market-data",
        scope="binance/BTCUSDT", actor="ops@example", at_micros=NOW + 2,
    )
    harness.feed_connected = True
    harness.market_age_micros = 40_000
    harness.attempt("ord-after")
    resolved = harness.alerts.recover(
        rule_id="MARKET_DATA_STALE", component="market-data",
        scope="binance/BTCUSDT", at_micros=NOW + 3,
    )
    assert resolved is not None

    incident = build_incident(
        title="stale book -> repeated risk refusals -> ack -> recovery",
        links=[
            *links_from_events(IncidentLinkKind.RISK_EVENT, harness.events.events, id_field="event_id"),
            IncidentLink(IncidentLinkKind.ALERT, resolved.alert_id),
        ],
        correlation_id="c-scenario",
        operation_id=None,
        opened_at_micros=NOW,
    )
    # Every risk refusal produced an event; the incident points at all of
    # them plus the resolved alert, keyed by the correlation id.
    assert incident.grouping_key == "correlation:c-scenario"
    assert sum(1 for link in incident.links if link.kind is IncidentLinkKind.ALERT) == 1
    # Part 8 event dedupe is content-addressed per *condition*: repeated
    # refusals of the same stale-book violation collapse to one risk event,
    # while the alert engine's occurrence count carries the repetition. The
    # incident links that single event and the alert - two dedupe scopes,
    # each honest about its own job.
    assert len([link for link in incident.links if link.kind is IncidentLinkKind.RISK_EVENT]) >= 1
    assert all(link.target_id for link in incident.links)

    rendered = incident.to_dict()
    flat = repr(rendered)
    # Incident rows carry references, never payloads: no order ids leak in
    # (the correlation ids are the join keys; client ids stay in the records
    # they point at).
    assert "ord-stale-1" not in flat


def test_prometheus_view_stays_clean_of_forbidden_cardinality() -> None:
    harness = Harness()
    harness.attempt("ord-secret-lookalike-9f3k2")
    harness.attempt("ord-another-1")
    text = render_prometheus(harness.registry)
    for forbidden in ("ord-secret-lookalike-9f3k2", "req-", "c-scenario", "tenant-1", "acct-1"):
        assert forbidden not in text, f"{forbidden} leaked into exposition"
    assert "wlct_risk_decisions_total{result=\"rejected\",service=\"trading-engine\"} 2" in text
    assert 'risk_code="STALE_MARKET_DATA"' in text
    assert "# TYPE wlct_risk_decision_micros histogram" in text


def test_dashboard_document_is_complete_and_marked_derived() -> None:
    harness = Harness()
    harness.attempt("ord-stale-1")
    document = DashboardBuilder(service="trading-engine").build(
        registry=harness.registry,
        health_results=harness.health.check_all(),
        alert_records=harness.alerts.active(),
        readiness=harness.readiness(),
    )
    assert set(document["sections"]) == {
        "SYSTEM",
        "MARKET_DATA",
        "STRATEGIES",
        "RISK",
        "EXECUTION",
        "ORDERS",
        "POSITIONS",
        "QUEUES",
        "DATASETS",
        "ALERTS",
    }
    assert document["note"]
    system_rows = {row["label"]: row for row in document["sections"]["SYSTEM"]}
    assert system_rows["market_data"]["tone"] == "bad"
    assert system_rows["tradingReady"]["value"] == "false"
    alerts_rows = document["sections"]["ALERTS"]
    assert alerts_rows and alerts_rows[0]["value"] == "CRITICAL x1"
    # Correlation ids belong in log fields; assert the ambient context is
    # still usable at the end of the scenario (no leaking between attempts).
    assert current_context().correlation_id is None
