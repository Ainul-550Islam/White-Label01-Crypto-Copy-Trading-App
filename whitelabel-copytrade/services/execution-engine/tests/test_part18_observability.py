"""Part 18: the execution engine's scrape, and the laws the exposition must keep.

Six things are pinned here, in the order they would hurt if they broke:

1. **The exporter cannot fall behind the instrument.** The counter families are
   derived from ``ExecutionCounters``' fields and the test asserts equality in both
   directions, so a counter added in the core with no matching entry here is
   impossible, and a family invented here without an instrument is caught. This is
   the specific failure this repository has now hit three times with hand-written
   lists, and it is the one thing a metrics adapter is uniquely good at hiding.
2. **Mirroring is a delta, and a decrease is an event.** ``inc`` refuses a negative
   amount by platform law, so the hub adds the difference; when the source goes
   backwards (``reset()``, or a fresh process) the hub re-baselines and COUNTS that
   instead of drawing a cliff or reporting a negative rate.
3. **An unrecorded stage is absent, not zero.** A histogram of zeros reads as
   "everything was instantaneous"; the truth is "nobody measured", and the exposition
   is exactly where that distinction gets lost.
4. **Nothing identifying is in the text** - not because the render filters it, but
   because the core's cardinality law refuses such labels at registration, which is
   asserted here by trying to register one and being told no.
5. **Reading does not write.** A scrape leaves the engine's own instruments alone.
6. **The route's plane.** Unauthenticated like the health endpoints beside it, absent
   from the OpenAPI document, invisible to the worker's forwarding list, and a 404
   rather than an apology when exposition is disabled.
"""

from __future__ import annotations

import re
from contextlib import ExitStack
from dataclasses import fields
from typing import cast

import pytest
from fastapi.testclient import TestClient
from wlct_trading.metrics import (
    EXECUTION_STAGES,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
)
from wlct_trading.observability.labels import CardinalityError

from app.composition import EngineRuntime
from app.observability import (
    COUNTER_FAMILIES,
    LATENCY_FAMILY,
    RESETS_FAMILY,
    WIRING_GAUGE,
    ExecutionEngineObservability,
    counter_families,
)
from tests.conftest import auth_headers
from tests.test_execution_engine import settings_for
from tests.test_part14_retention import postgres_client
from tests.test_part15_drift_parity import ENGINE_CLIENT


class FakeMetrics:
    """An ``ExecutionMetrics``-shaped source, holding the core's real histograms.

    Not a fake histogram: the adapter the hub mirrors through refuses a source
    whose bucket edges differ from the exposed family, and that check is exactly
    the kind of contract a test double would smooth over. A real
    ``LatencyHistogram`` also keeps ``count`` honest without reimplementing it.
    """


    def __init__(self, **counters: int) -> None:
        self.counters = ExecutionCounters(**counters)
        self._stages: dict[str, LatencyHistogram] = {}
        self.asked_for: list[str] = []

    def stage(self, name: str) -> LatencyHistogram | None:
        self.asked_for.append(name)
        return self._stages.get(name)

    def record_stage(self, name: str, micros: int = 1_000, samples: int = 1) -> None:
        histogram = LatencyHistogram()
        for _ in range(samples):
            histogram.observe(micros)
        self._stages[name] = histogram


class FakeEngine:
    """The only thing the hub reads off an engine: the metrics port it holds."""

    def __init__(self, metrics: FakeMetrics | None) -> None:
        self.metrics = metrics


class FakeRuntime:
    """Enough of ``EngineRuntime`` for the hub: an engine, and a description."""

    def __init__(
        self, metrics: FakeMetrics | None, described: dict[str, object] | None = None
    ) -> None:
        self.engine = FakeEngine(metrics)
        self._described: dict[str, object] = described if described is not None else {}

    def describe(self) -> dict[str, object]:
        return dict(self._described)


def hub_for(
    metrics: FakeMetrics | None = None,
    described: dict[str, object] | None = None,
) -> ExecutionEngineObservability:
    return ExecutionEngineObservability(cast(EngineRuntime, FakeRuntime(metrics, described)))


def render_value(body: str, family: str) -> float | None:
    """The value of a label-free series of ``family`` in the rendered text.

    Matching on the family plus ``{`` rather than a space because the registry
    stamps every series with its ``service`` label: the line is
    ``wlct_execution_..._total{service="execution-engine"} 5``, and a parser that
    assumed a bare name would report "absent" for a metric that is right there -
    the most misleading kind of test failure.
    """
    for line in body.splitlines():
        if line.startswith(family + "{") or line.startswith(family + " "):
            return float(line.rsplit(" ", 1)[1])
    return None


# ---------------------------------------------------------------------------
# 1. the family set is derived, in both directions
# ---------------------------------------------------------------------------


class TestFamilyDerivation:
    def test_the_exported_counters_are_exactly_the_instruments_fields(self) -> None:
        expected = tuple(
            f"wlct_execution_{field.name}_total" for field in fields(ExecutionCounters)
        )
        assert COUNTER_FAMILIES == expected
        assert counter_families() == expected

    def test_the_hub_registers_every_one_of_them(self) -> None:
        hub = hub_for(FakeMetrics())
        missing = set(COUNTER_FAMILIES) - set(hub.family_names)
        assert not missing, f"declared but not registered: {sorted(missing)}"

    def test_the_hub_invents_no_counter_of_its_own(self) -> None:
        hub = hub_for(FakeMetrics())
        exported = {n for n in hub.family_names if n.startswith("wlct_execution_")}
        allowed = set(COUNTER_FAMILIES) | {LATENCY_FAMILY, WIRING_GAUGE, RESETS_FAMILY}
        assert exported <= allowed, exported - allowed

    def test_the_latency_wiring_and_reset_families_exist(self) -> None:
        hub = hub_for(FakeMetrics())
        assert LATENCY_FAMILY in hub.family_names
        assert WIRING_GAUGE in hub.family_names
        assert RESETS_FAMILY in hub.family_names


# ---------------------------------------------------------------------------
# 2. mirroring: deltas, resets, and the values a panel will read
# ---------------------------------------------------------------------------


class TestMirroring:
    def test_a_scrape_reports_the_sources_total(self) -> None:
        metrics = FakeMetrics(orders_submitted=7, placement_reviews=3)
        body = hub_for(metrics).scrape()
        assert render_value(body, "wlct_execution_orders_submitted_total") == 7
        assert render_value(body, "wlct_execution_placement_reviews_total") == 3

    def test_two_scrapes_do_not_double_a_counter(self) -> None:
        # The single most likely bug in a mirror: the source is cumulative and the
        # registry only adds, so a naive per-scrape inc would make the second scrape
        # of an idle process report twice the work that happened.
        metrics = FakeMetrics(orders_submitted=4)
        hub = hub_for(metrics)
        first = render_value(hub.scrape(), "wlct_execution_orders_submitted_total")
        second = render_value(hub.scrape(), "wlct_execution_orders_submitted_total")
        assert first == 4 and second == 4

    def test_the_delta_between_scrapes_is_what_gets_added(self) -> None:
        metrics = FakeMetrics(orders_submitted=4)
        hub = hub_for(metrics)
        hub.scrape()
        metrics.counters.orders_submitted = 10
        assert render_value(hub.scrape(), "wlct_execution_orders_submitted_total") == 10

    def test_a_source_that_moves_backwards_is_re_baselined_and_counted(self) -> None:
        metrics = FakeMetrics(orders_submitted=9)
        hub = hub_for(metrics)
        hub.scrape()
        metrics.counters.orders_submitted = 2  # the core's test-only reset()
        body = hub.scrape()
        # 11, not 2, and that is the deliberate choice rather than a slip. The
        # registry refuses a negative increment (correctly: a Prometheus counter
        # that decreases breaks rate() for every consumer), so the mirror is
        # monotone across a source reset and the EVENT is what carries the truth -
        # both as a rendered series and as the hub's own count. A production
        # restart is not this path at all: it is a new process with a new registry
        # and a series that legitimately starts at zero, which is exactly what
        # rate() expects to see. Nothing in the shipped services calls reset();
        # the case exists because the port allows it and a mirror must not be
        # surprised by a source it is told to follow.
        assert render_value(body, "wlct_execution_orders_submitted_total") == 11
        assert render_value(body, RESETS_FAMILY) == 1
        assert hub.reset_count == 1
        # ...and the tracking re-baselined, so what comes next is measured right:
        metrics.counters.orders_submitted = 5
        assert (
            render_value(hub.scrape(), "wlct_execution_orders_submitted_total") == 14
        )

    def test_a_counter_that_has_never_moved_is_absent_from_the_text(self) -> None:
        # The registry's own rendering law, which this hub inherits instead of
        # arguing with: a family with no series is omitted (Part 9 pinned that for
        # the case of a registered-but-unused counter, and the same shape keeps a
        # scrape from having to invent zeros). So "absent" means "nothing has been
        # written to it in this process", and the presence of the wiring gauges -
        # always set, because they describe the wiring rather than the traffic - is
        # what distinguishes that from a service that is not measuring at all.
        body = hub_for(FakeMetrics()).scrape()
        assert render_value(body, "wlct_execution_orders_submitted_total") is None
        assert WIRING_GAUGE in body
        assert "# TYPE wlct_execution_wiring gauge" in body


# ---------------------------------------------------------------------------
# 3. stages
# ---------------------------------------------------------------------------


class TestStageExposition:
    def test_a_recorded_stage_appears_with_its_buckets(self) -> None:
        metrics = FakeMetrics()
        metrics.record_stage("risk", micros=1200, samples=3)
        body = hub_for(metrics).scrape()
        assert '_count{service="execution-engine",stage="risk"} 3' in body
        assert '_sum{service="execution-engine",stage="risk"} 3600' in body

    def test_an_unrecorded_stage_is_absent_rather_than_zeroed(self) -> None:
        metrics = FakeMetrics()
        metrics.record_stage("risk")
        body = hub_for(metrics).scrape()
        assert 'stage="risk"' in body
        for stage in EXECUTION_STAGES:
            if stage == "risk":
                continue
            assert f'stage="{stage}"' not in body, (
                f"{stage} was never observed and must not render as a zero "
                "histogram: that reads as instantaneous, not as unmeasured"
            )

    def test_the_hub_only_asks_for_declared_stages(self) -> None:
        # The mechanism, not just the outcome: the loop walks the vocabulary, so an
        # observation made under a name nobody declared can never be exported as a
        # series the family bounds would have refused anyway.
        metrics = FakeMetrics()
        hub_for(metrics).scrape()
        assert set(metrics.asked_for) == set(EXECUTION_STAGES)

    def test_a_stage_label_outside_the_vocabulary_is_refused(self) -> None:
        hub = hub_for(FakeMetrics())
        with pytest.raises(CardinalityError):
            hub.registry.set_gauge(LATENCY_FAMILY, {"stage": "invented_stage"}, 1.0)


# ---------------------------------------------------------------------------
# 4. what may not appear
# ---------------------------------------------------------------------------


class TestNothingIdentifyingLeaves:
    def test_the_cardinality_law_is_enforced_not_just_documented(self) -> None:
        hub = hub_for(FakeMetrics())
        with pytest.raises(CardinalityError, match="tenant_id"):
            hub.registry.register_counter(
                "wlct_execution_per_tenant_total",
                "would be a disclosure channel",
                "tenant_id",
            )

    def test_the_rendered_text_carries_no_principal_and_no_credential(self) -> None:
        described = {
            "storeDurable": True,
            "locksDistributed": False,
            "retentionEnabled": True,
            "placement": {"label": "placement-attest", "requiresVenueAttestation": True},
            "incidents": {"durable": True},
        }
        body = hub_for(FakeMetrics(orders_submitted=1), described).scrape()
        for needle in (
            "tenant_id",
            "tenant-1",
            "account_id",
            "account-1",
            "order_id",
            "client_order_id",
            "api_secret",
            "private_key",
            "dsn",
            "postgresql://",
        ):
            assert needle not in body, (
                f"{needle!r} reached a scrape that is served without authentication"
            )

    def test_the_scrape_does_not_mutate_the_engine_instrument(self) -> None:
        metrics = FakeMetrics(orders_submitted=5)
        metrics.record_stage("validation", micros=20, samples=2)
        hub = hub_for(metrics)
        before = (metrics.counters.orders_submitted, metrics.stage("validation").count)
        hub.scrape()
        hub.scrape()
        after = (metrics.counters.orders_submitted, metrics._stages["validation"].count)
        assert before == (5, 2)
        assert after == (5, 2)

    def test_a_hub_with_no_instrumentation_says_so_by_omission(self) -> None:
        body = hub_for(None).scrape()
        assert "wlct_execution_orders_submitted_total" not in body
        assert "wlct_process_uptime_seconds" in body  # process families always render


# ---------------------------------------------------------------------------
# 5. wiring gauges, read from the runtime's own description
# ---------------------------------------------------------------------------


class TestWiringGauges:
    def lines(self, body: str) -> dict[str, float]:
        out: dict[str, float] = {}
        for line in body.splitlines():
            match = re.match(
                rf'{WIRING_GAUGE}\{{component="([a-z_]+)",service="[^"]+"\}} ([0-9.]+)',
                line,
            )
            if match:
                out[match.group(1)] = float(match.group(2))
        return out

    def test_every_advertised_component_is_rendered(self) -> None:
        body = hub_for(FakeMetrics()).scrape()
        assert set(self.lines(body)) == {
            "durable_store",
            "durable_incidents",
            "placement_review",
            "venue_attestation",
            "distributed_locks",
            "journal_retention",
            # Part 19's two, added to the same literal set rather than to a
            # separately-maintained count: a component that appeared in the table and
            # not here would pass a count-based assertion and be invisible on a
            # dashboard, which is the failure the set form was chosen to avoid.
            "live_credential_fetcher",
            "operator_confirmation",
            "engine_instrumented",
        }

    def test_a_describe_dict_becomes_the_gauges_a_panel_needs(self) -> None:
        body = hub_for(
            FakeMetrics(),
            {
                "storeDurable": True,
                "locksDistributed": True,
                "retentionEnabled": False,
                "placement": {"label": "placement-attest", "requiresVenueAttestation": False},
                "incidents": {"durable": True},
                "metricsConfigured": True,
            },
        ).scrape()
        values = self.lines(body)
        assert values["durable_store"] == 1
        assert values["durable_incidents"] == 1
        assert values["placement_review"] == 1
        assert values["venue_attestation"] == 0
        assert values["distributed_locks"] == 1
        assert values["journal_retention"] == 0
        assert values["engine_instrumented"] == 1

    def test_a_missing_description_key_publishes_zero_rather_than_a_guess(self) -> None:
        # The point of reading describe() instead of the settings is that when the
        # runtime stops saying something, the panel has to show the gap. Defaulting
        # to True would be the exposition layer making the engine's claim for it.
        body = hub_for(FakeMetrics(), {"storeDurable": None}).scrape()
        assert self.lines(body)["durable_store"] == 0
        # Thirteen parts of this service would have answered 0 here, correctly:
        # no instrument was ever handed to the engine, and the gauge says so.
        assert self.lines(body)["engine_instrumented"] == 0


# ---------------------------------------------------------------------------
# 6. the route, on a booted app
# ---------------------------------------------------------------------------


class TestMetricsRoute:
    def test_the_scrape_needs_no_token(self, client: TestClient) -> None:
        response = client.get("/metrics")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")
        assert "version=0.0.4" in response.headers["content-type"]

    def test_the_engine_counters_are_on_it(self, client: TestClient) -> None:
        body = client.get("/metrics").text
        assert f"# HELP {WIRING_GAUGE}" in body
        assert "# TYPE wlct_execution_wiring gauge" in body
        assert "# TYPE wlct_process_uptime_seconds gauge" in body
        # An idle runtime has written nothing, so the counter families are absent
        # (the renderer's law, not a bug). The line below is the end-to-end proof
        # that a number the engine holds reaches the text: it goes through the
        # public metrics port on the REAL runtime, not through a fake, so a hub
        # wired to the wrong attribute would fail here rather than in production.
        engine = client.app.state.runtime.engine
        assert engine.metrics is not None
        engine.metrics.counters.orders_submitted = 1
        after = client.get("/metrics").text
        assert (
            'wlct_execution_orders_submitted_total{service="execution-engine"} 1' in after
        )

    def test_the_service_hands_its_engine_an_instrument(self, client: TestClient) -> None:
        # The gap this part was written to close, stated as an assertion: the
        # metrics port has been optional on ExecutionEngine since Part 5 and this
        # service never supplied one, so the counters every document describes were
        # accumulated by nothing. Nothing here is new machinery - it is the line
        # that connects the machinery to the process.
        engine = client.app.state.runtime.engine
        instrument = engine.metrics
        assert isinstance(instrument, ExecutionMetrics)
        # The instrument carries the adapter's own id: this runtime is simulated,
        # and labelling its timings with the venue it simulates would be a lie.
        assert instrument.to_dict()["exchange"] == "paper"
        assert set(instrument.to_dict()["stages"]) == set()  # nothing measured yet

    def test_the_status_document_agrees_with_the_gauge(self, client: TestClient) -> None:
        # /status is the plane the worker asserts against, /metrics the plane a
        # dashboard reads; this test is the only thing that keeps them telling the
        # same story, which is why the value is read off both rather than asserted
        # twice against one source.
        status = client.get(
            "/internal/v1/status", headers=auth_headers()
        ).json()
        assert status["metricsConfigured"] is True
        line = next(
            line
            for line in client.get("/metrics").text.splitlines()
            if 'component="engine_instrumented"' in line
        )
        assert line.endswith(" 1")

    def test_ready_reports_it_too(self, client: TestClient) -> None:
        # /health/ready splats the description, so a new wiring fact is visible on
        # the unauthenticated plane as well; pinned because that splat is the only
        # reason the two planes cannot drift, and a splat can be replaced by a
        # hand-written dict without any test noticing until an operator asks.
        assert client.get("/health/ready").json()["metricsConfigured"] is True

    def test_it_is_absent_from_the_openapi_document(self, client: TestClient) -> None:
        assert "/metrics" not in client.get("/openapi.json").json()["paths"]

    def test_reading_metrics_changes_nothing_the_command_plane_sees(
        self, client: TestClient
    ) -> None:
        wiring = client.app.state.runtime.describe()
        client.get("/metrics")
        client.get("/metrics")
        assert client.app.state.runtime.describe() == wiring

    def test_the_diagnostic_review_is_not_counted_as_a_gated_review(
        self, client: TestClient
    ) -> None:
        # The end-to-end claim Part 18 can honestly make about THIS process: the
        # service composes an engine but serves no submission command, so the
        # counters are expected to sit at zero - and the placement endpoint is a
        # question, not an order. If a future change made ``attest`` increment
        # ``placement_reviews``, this assertion is where somebody notices that the
        # dashboard's "reviews" no longer means "orders the gate looked at".
        before = client.get("/metrics").text
        assert render_value(before, "wlct_execution_placement_reviews_total") is None
        reviewed = client.post(
            "/internal/v1/placement/attest",
            headers=auth_headers("tenant-a"),
            json={
                "tenantId": "tenant-a",
                "accountId": "account-1",
                "symbol": "BTCUSDT",
                "orderType": "LIMIT",
                "timeInForce": "GTC",
            },
        )
        assert reviewed.status_code == 200
        after = client.get("/metrics").text
        assert render_value(after, "wlct_execution_placement_reviews_total") is None
        # ...and the review's existence is visible where it should be: on the
        # wiring gauges, which is the whole reason they exist beside the counters.
        rendered = (
            'wlct_execution_wiring{component="placement_review",'
            'service="execution-engine"} 1'
        )
        assert rendered in after

    def test_production_refuses_to_parse_without_exposition(self) -> None:
        with pytest.raises(ValueError, match="OBSERVABILITY_ENABLED=false in production"):
            settings_for(("NODE_ENV", "production"), ("OBSERVABILITY_ENABLED", "false"))

    def test_the_switch_is_published_on_the_configs_safe_view(self) -> None:
        # Same convention as Parts 14 and 15: every non-secret knob appears in the
        # config's public view, which is the contract the logs and any future status
        # surface read. The /status document itself stays the WIRING view - the
        # knob is not a wiring fact, and conflating the two is how a deployment
        # starts reporting its configuration as its state.
        assert settings_for().to_public_dict()["observabilityEnabled"] is True

    def test_a_disabled_exposition_is_a_404_not_a_paragraph(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.config import get_settings
        from app.main import create_app

        monkeypatch.setenv("OBSERVABILITY_ENABLED", "false")
        get_settings.cache_clear()
        try:
            with TestClient(create_app()) as client:
                assert client.get("/metrics").status_code == 404
                # ...and the rest of the plane is untouched, which is the point of
                # gating the mount rather than the handler: a disabled scrape must
                # not be able to affect anything a caller depends on.
                assert client.get("/health").status_code == 200
                assert client.get("/health/ready").status_code == 200
        finally:
            get_settings.cache_clear()

    def test_the_worker_never_forwards_the_scrape(self) -> None:
        # Same guard Parts 14, 15 and 17 wrote for their own routes: the worker
        # client's path list IS the public-facing surface of this service, and a
        # metrics scrape must not be reachable through a tenant's request.
        assert "/metrics" not in ENGINE_CLIENT.read_text(encoding="utf-8")

    def test_the_durable_plane_reports_both_durabilities(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _conn = postgres_client(monkeypatch, stack, [[]])
            body = client.get("/metrics").text
            assert (
                'wlct_execution_wiring{component="durable_store",'
                'service="execution-engine"} 1' in body
            )
            assert (
                'wlct_execution_wiring{component="durable_incidents",'
                'service="execution-engine"} 1' in body
            )
