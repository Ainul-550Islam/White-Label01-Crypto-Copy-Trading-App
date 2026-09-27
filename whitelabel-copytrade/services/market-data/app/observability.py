"""The market-data service's observability hub.

One process-level bundle: metric registry, health registry, alert engine,
dashboard builder, and the periodic task that mirrors all three into Redis
for the API to persist. Durable PostgreSQL ownership stays with the API -
this service never writes an alert row itself; the fold into the alert table
is one writer (the API's maintenance job).

The hub is deliberately outside the poller's hot path except for two integer
increments per cycle; everything else reads state the service already keeps
or runs on the mirror task's schedule. If Redis dies, probes report UNKNOWN,
the mirror simply stops being written, and the last published document ages
out by TTL - the API's sync job treats an absent mirror as "publisher
unreachable", never as "recovered". Fail-closed is a property of the whole
chain, not just of the trading path.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any, Protocol

from wlct_trading.clock import epoch_micros
from wlct_trading.observability import (
    AlertEngine,
    AlertObservation,
    ComponentHealth,
    ComponentStatus,
    DashboardBuilder,
    HealthRegistry,
    ObservabilityRegistry,
    render_health_metrics,
    render_prometheus,
    sample_process,
)
from wlct_trading.redis_keys import RedisKeys

from app.config import Settings
from app.services.quote_cache import quote_key
from app.tracing import (
    build_injector,
    build_tracer,
    flush_traces,
)

logger = logging.getLogger(__name__)

_SERVICE = "market-data"


class MirrorRedis(Protocol):
    """The exact Redis surface the hub needs, stated as a protocol.

    A real ``redis.asyncio.Redis`` satisfies it, the service tests hand in a
    scripted fake, and mypy strict checks both structurally - no casts, no
    suppressions, and if the hub ever reaches for a new command the protocol
    has to grow first, which is the review hook that keeps the surface small.

    The shape (positional keys, keyword-only ``ex``/``transaction``) is the
    exact call surface the hub uses, matched to how redis-py's async client
    is typed (plain ``def`` returning ``Awaitable[X] | X`` unions). The hub
    awaits the results as usual; declaring more than this would over-refine
    the library, declaring less is what the protocol exists to prevent.
    """

    def get(self, name: str, /) -> Any: ...

    def set(self, name: str, value: str, /, *, ex: int | None = ...) -> Any: ...

    def ping(self) -> Any: ...

    def pipeline(self, /, *, transaction: bool = ...) -> Any: ...



class MarketDataObservability:
    """Hub lifecycle: start in the FastAPI lifespan, stop in its finally."""

    def __init__(self, settings: Settings, redis: MirrorRedis) -> None:
        self._settings = settings
        self._redis = redis
        self._started_mono = time.monotonic()
        self._task: asyncio.Task[None] | None = None

        self.registry = ObservabilityRegistry(service=_SERVICE)
        self.health = HealthRegistry()
        self.alerts = AlertEngine()
        self.dashboard = DashboardBuilder(service=_SERVICE)

        self._last_cycle_ok: bool | None = None
        self._quote_age_by_symbol: dict[str, float | None] = {
            symbol: None for symbol in self._settings.symbols
        }
        self._redis_ping: tuple[bool, str | None, int] | None = None

        # Part 10: tracer + config-armed fault plan (see the trading engine's
        # twin for the full contract). Export outcomes are counted here; the
        # paging alert for sustained failure is opened by the engine hub, the
        # alerting service that owns the stream.
        self.tracer = build_tracer(settings)
        self.injector = build_injector(settings)
        self._export_failures = 0

        # --- families -------------------------------------------------
        self.registry.register_counter(
            "wlct_market_poll_cycles_total",
            "Quote-poller cycles by outcome.",
            "result",
        )
        self.registry.register_counter(
            "wlct_market_quotes_updated_total",
            "Quotes successfully refreshed into the cache.",
        )
        self.registry.register_counter(
            "wlct_tracing_export_outcomes_total",
            "OTLP trace-export ticks by outcome (idle/ok/error/injected/skipped).",
            "result",
        )
        self.registry.register_counter(
            "wlct_tracing_spans_total",
            "Spans handed to the exporter by disposition (exported/dropped).",
            "result",
        )
        self.registry.register_gauge(
            "wlct_tracing_export_consecutive_failures",
            "Consecutive mirror ticks whose export failed.",
        )
        self.registry.register_gauge(
            "wlct_market_quote_age_seconds",
            "Age of the freshest cached quote per tracked symbol.",
            "symbol",
            # Symbols are an enumerated, operator-owned config set - the only
            # condition under which the platform allows a symbol label.
            bounds={"symbol": frozenset(self._settings.symbols)},
        )
        self.registry.register_gauge(
            "wlct_market_alert_active",
            "Active alerts by severity (1 = open now).",
            "severity",
            bounds={"severity": frozenset({"INFO", "WARNING", "CRITICAL", "EMERGENCY"})},
        )
        self.registry.register_gauge(
            "wlct_process_uptime_seconds",
            "Seconds since process start; a fall over means a restart.",
            "service",
        )

        # --- health providers ----------------------------------------
        self.health.register(
            "redis",
            self._probe_redis,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        poller_budget = max(60_000_000, settings.HEALTH_REFRESH_MS * 3_000)
        self.health.register(
            "poller",
            self._probe_poller,
            freshness_budget_micros=poller_budget,
            critical=True,
        )
        self.health.register(
            "quote_freshness",
            self._probe_quote_freshness,
            freshness_budget_micros=poller_budget,
            critical=True,
        )

    # ------------------------------------------------------------------
    # wiring called by other modules
    # ------------------------------------------------------------------
    def record_cycle(self, updated: int, ok: bool) -> None:
        """The poller's per-cycle hook. O(1), no I/O, never raises."""
        self.registry.inc(
            "wlct_market_poll_cycles_total", {"result": "ok" if ok else "failed"}
        )
        if updated > 0:
            self.registry.inc(
                "wlct_market_quotes_updated_total", {}, float(updated)
            )
        if self._last_cycle_ok and not ok:
            self.alerts.observe(
                AlertObservation(
                    rule_id="MARKET_DATA_STALE",
                    component="poller",
                    scope="all-symbols",
                    message="poller cycle failed; cached quotes now age unserved",
                    at_micros=epoch_micros(),
                )
            )
        if not self._last_cycle_ok and ok:
            self.alerts.recover(
                rule_id="MARKET_DATA_STALE",
                component="poller",
                scope="all-symbols",
                at_micros=epoch_micros(),
                note="cycle recovered",
            )
        self._last_cycle_ok = ok

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._mirror_loop(), name="ops-mirror")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _mirror_loop(self) -> None:
        interval = self._settings.HEALTH_REFRESH_MS / 1000.0
        ttl = max(30, self._settings.HEALTH_REFRESH_MS * 3 // 1000)
        while True:
            try:
                await self._refresh_redis_ping()
                await self._refresh_quotes_age()
                await self._publish_mirrors(ttl_seconds=ttl)
                await self._flush_traces()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # The mirror loop must never kill the service it observes.
                logger.warning(
                    "observability.mirror_failed",
                    extra={
                        "event": "observability.mirror_failed",
                        "error_type": type(error).__name__,
                    },
                )
            await asyncio.sleep(interval)

    @property
    def telemetry_view(self) -> dict[str, object]:
        """Compact export posture for the health/readiness documents.

        Deliberately small and deliberately present even when tracing is off:
        an operator reading "tracingEnabled: false" should be able to tell
        "off" from "broken" without grepping env.
        """
        if self.tracer is None:
            return {
                "tracingEnabled": False,
                "bufferedSpans": 0,
                "droppedByReason": {},
                "exportConsecutiveFailures": 0,
                "faultInjection": self.injector.describe(),
            }
        return {
            "tracingEnabled": True,
            "bufferedSpans": self.tracer.buffered_spans,
            "droppedByReason": dict(sorted(self.tracer.drop_counts.items())),
            "exportConsecutiveFailures": self._export_failures,
            "faultInjection": self.injector.describe(),
        }

    async def _flush_traces(self) -> None:
        """One export tick: drain, one attempt, count, alert. Never raise.

        Spans lost here are lost loudly (counters + gauge + alert), because
        the alternative - an unbounded retry queue behind a dead collector -
        converts an observability outage into a memory outage in the process
        that keeps orders alive.
        """
        if self.tracer is None:
            return
        report = await flush_traces(
            self.tracer,
            endpoint=self._settings.OTEL_ENDPOINT,
            timeout_ms=self._settings.OTEL_TIMEOUT_MS,
            injector=self.injector,
        )
        outcome = str(report["outcome"])
        if outcome != "idle":
            self.registry.inc("wlct_tracing_export_outcomes_total", {"result": outcome})
            exported = int(report["exported"])
            failed = int(report["failed"])
            if exported:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "exported"}, float(exported)
                )
            if failed:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "dropped"}, float(failed)
                )
        if outcome in ("ok", "idle"):
            self._export_failures = 0
        else:
            # error / injected / skipped: spans were lost this tick, and a
            # missing endpoint is a configuration fault, not an absence of
            # one - telemetry that is enabled but homeless stays dark.
            self._export_failures += 1
        self.registry.set_gauge(
            "wlct_tracing_export_consecutive_failures", {}, float(self._export_failures)
        )

    async def _refresh_redis_ping(self) -> None:
        started = time.perf_counter()
        try:
            await self._redis.ping()
            self._redis_ping = (True, None, epoch_micros())
        except Exception as error:
            latency_note = f"after {int((time.perf_counter() - started) * 1000)}ms"
            self._redis_ping = (False, type(error).__name__, epoch_micros())
            logger.warning(
                "dependency.redis_unavailable",
                extra={"event": "dependency.redis_unavailable", "detail": latency_note},
            )

    async def _refresh_quotes_age(self) -> None:
        """Read the cache the readers read, so health is the same truth.

        Absent, unparseable and error reads all collapse to ``None`` =
        "unknown" - the panel and the alert message say exactly that. A
        corrupt entry is not "infinitely old"; it is unreadable, and the
        difference matters when deciding whether to trust the numbers.
        """
        budget = float(self._settings.MARKET_DATA_CACHE_TTL_SECONDS)
        now = epoch_micros()
        for symbol in self._settings.symbols:
            age_value: float | None = None
            try:
                raw = await self._redis.get(quote_key(symbol))
                if raw:
                    payload = json.loads(raw)
                    as_of = payload.get("asOf")
                    if isinstance(as_of, str):
                        stamp = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
                        age_value = max(
                            0.0, (datetime.now(UTC) - stamp).total_seconds()
                        )
            except (ValueError, TypeError):
                age_value = None
            except Exception as error:  # transport trouble: unknown, not stale
                logger.warning(
                    "observability.quote_read_failed",
                    extra={
                        "event": "observability.quote_read_failed",
                        "symbol": symbol,
                        "error_type": type(error).__name__,
                    },
                )
                age_value = None

            self._quote_age_by_symbol[symbol] = age_value
            self.registry.set_gauge(
                "wlct_market_quote_age_seconds",
                {"symbol": symbol},
                age_value if age_value is not None else float("nan"),
            )
            if age_value is None or age_value > 2.0 * budget:
                self.alerts.observe(
                    AlertObservation(
                        rule_id="MARKET_DATA_STALE",
                        component="quote-cache",
                        scope=symbol,
                        observed_value="unknown" if age_value is None else f"{age_value:.1f}",
                        threshold_value=f"{2.0 * budget:.1f}",
                        message=(
                            f"{symbol}: no usable quote in the cache"
                            if age_value is None
                            else f"{symbol}: no fresh quote for {age_value:.0f}s"
                        ),
                        at_micros=now,
                    )
                )
            else:
                self.alerts.recover(
                    rule_id="MARKET_DATA_STALE",
                    component="quote-cache",
                    scope=symbol,
                    at_micros=now,
                )

    async def _publish_mirrors(self, *, ttl_seconds: int) -> None:
        self.registry.set_gauge(
            "wlct_process_uptime_seconds",
            {"service": _SERVICE},
            time.monotonic() - self._started_mono,
        )
        for severity in ("INFO", "WARNING", "CRITICAL", "EMERGENCY"):
            self.registry.set_gauge(
                "wlct_market_alert_active",
                {"severity": severity},
                float(self.alerts.counts().get(severity, 0)),
            )
        results = self.health.check_all()
        render_health_metrics(self.registry, results)
        health_doc = self.health.snapshot_dict(results)
        alerts_doc = self.alerts.mirror_payload()
        pipe = self._redis.pipeline(transaction=False)
        pipe.set(
            RedisKeys.ops_health_mirror(_SERVICE),
            json.dumps(health_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        pipe.set(
            RedisKeys.ops_alerts_mirror(_SERVICE),
            json.dumps(alerts_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        await pipe.execute()

    # ------------------------------------------------------------------
    # probes (sync reads of cached state; see module docstring for why)
    # ------------------------------------------------------------------
    def _probe_redis(self) -> ComponentHealth:
        snapshot = self._redis_ping
        if snapshot is None:
            raise RuntimeError("redis ping has not run yet")
        ok, error_name, at = snapshot
        return ComponentHealth(
            component="redis",
            status=ComponentStatus.HEALTHY if ok else ComponentStatus.UNHEALTHY,
            reason=None if ok else f"ping failed ({error_name})",
            captured_at_micros=at,
        )

    def _probe_poller(self) -> ComponentHealth:
        if self._last_cycle_ok is None:
            return ComponentHealth(
                component="poller",
                status=ComponentStatus.UNKNOWN,
                reason="no cycle completed yet",
                captured_at_micros=epoch_micros(),
            )
        if self._last_cycle_ok:
            return ComponentHealth(
                component="poller",
                status=ComponentStatus.HEALTHY,
                reason="last cycle refreshed quotes",
                captured_at_micros=epoch_micros(),
            )
        return ComponentHealth(
            component="poller",
            status=ComponentStatus.DEGRADED,
            reason="last cycle failed; cached quotes may still be fresh",
            captured_at_micros=epoch_micros(),
        )

    def _probe_quote_freshness(self) -> ComponentHealth:
        ages = self._quote_age_by_symbol
        budget = float(self._settings.MARKET_DATA_CACHE_TTL_SECONDS)
        unknown = [s for s, a in ages.items() if a is None]
        stale = [s for s, a in ages.items() if a is not None and a > budget]
        now = epoch_micros()
        if not ages:
            return ComponentHealth(
                component="quote_freshness",
                status=ComponentStatus.STOPPED,
                reason="no symbols configured",
                captured_at_micros=now,
            )
        if stale or unknown:
            status = (
                ComponentStatus.UNHEALTHY
                if len(stale) + len(unknown) == len(ages)
                else ComponentStatus.DEGRADED
            )
            parts = []
            if stale:
                parts.append("stale: " + ",".join(sorted(stale)))
            if unknown:
                parts.append("missing: " + ",".join(sorted(unknown)))
            return ComponentHealth(
                component="quote_freshness",
                status=status,
                reason="; ".join(parts),
                captured_at_micros=now,
            )
        return ComponentHealth(
            component="quote_freshness",
            status=ComponentStatus.HEALTHY,
            reason=f"all {len(ages)} symbols within the {budget:.0f}s budget",
            captured_at_micros=now,
        )

    # ------------------------------------------------------------------
    # request-time views
    # ------------------------------------------------------------------
    def scrape(self) -> str:
        """The Prometheus exposition for this process (sync, cheap)."""
        render_health_metrics(self.registry, self.health.check_all())
        sample_process(self.registry, started_at_mono=self._started_mono)
        return render_prometheus(self.registry)

    def components_document(self) -> dict[str, object]:
        """/health/components payload: the operator view, derived on demand."""
        results = self.health.check_all()
        document = self.health.snapshot_dict(results)
        document["alerts"] = self.alerts.mirror_payload()
        document["telemetry"] = self.telemetry_view
        document["dashboard"] = self.dashboard.build(
            registry=self.registry,
            health_results=results,
            alert_records=self.alerts.active(),
            readiness=None,
        )
        return document
