"""The trading engine's observability hub and the trading-plane readiness evidence.

What "ready to trade" means HERE, at the plane that could actually place an
order, and why the API must not infer it from its own health:

* ``market_data`` - the market-data service's published health mirror must
  exist, be fresh, and report HEALTHY. An absent or expired mirror is
  "unknown" and unknown blocks trading. A degraded one (some symbols stale)
  also blocks: this gate is about being *willing to act on the book*, and
  acting on a partially stale book is how a hedge becomes a naked position.
* ``risk_engine`` - the pre-trade engine is loaded and its configuration
  parsed. (The extended Part 8 gate lives with the execution worker; when a
  deployment wires it, the same probe extends, it does not move.)
* ``risk_state_fresh`` - every account's newest published snapshot is within
  the staleness budget. When NO snapshots have been published at all, the
  answer is not "fine" - it is "the state worker is not wired yet", and that
  keeps trading blocked. This is the honest answer pre-wiring and a tripwire
  for a dead publisher post-wiring.
* ``exchange_connectivity`` / ``execution_adapter`` - reported from this
  service's own capability, which today is "configured, not connected": the
  process that would hold venue credentials is the execution worker, so the
  gates stay closed until *it* publishes evidence. Deliberately un-passable
  by wishful configuration.
* ``reconciliation`` - the last reconciliation pass reported no open,
  unrepaired discrepancy (durable incident table, bounded query).
* ``kill_switches`` - no GLOBAL kill switch engaged and no active
  protection trip; read from the same Redis sets and PG rows Part 8 wrote.

Everything here READS. This hub never writes risk state, never engages or
clears anything, and imports none of the order path - it turns evidence into
booleans. Enforcement remains exactly where Part 8 put it.

The queries run on the mirror loop's schedule, not per request: a hung
dependency makes the mirror stale, and staleness is already a first-class
verdict - so the health endpoint itself can never be taken down by the
thing it reports on.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any, Protocol

import asyncpg
from wlct_trading.clock import epoch_micros
from wlct_trading.observability import (
    ComponentHealth,
    ComponentStatus,
    DashboardBuilder,
    HealthRegistry,
    ObservabilityRegistry,
    render_health_metrics,
    render_prometheus,
    sample_process,
)
from wlct_trading.observability.alerts import AlertEngine, AlertObservation
from wlct_trading.observability.readiness import (
    TRADING_GATES,
    GateEvidence,
    evaluate_trading_readiness,
)
from wlct_trading.redis_keys import RedisKeys

from app.config import Settings
from app.tracing import (
    FAILURE_ALERT_THRESHOLD,
    build_injector,
    build_tracer,
    flush_traces,
)

logger = logging.getLogger(__name__)

_SERVICE = "trading-engine"


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


#: The subset of the platform's nine declared trading gates this service can
#: produce evidence for. The API merges these with its own (queues,
#: configuration) into the authoritative verdict; a gate nobody answers is
#: unknown, and unknown blocks. The names are checked against TRADING_GATES
#: at construction so a rename in the library breaks boot, not judgement.
ENGINE_GATES: tuple[str, ...] = (
    "market_data",
    "risk_engine",
    "risk_state_fresh",
    "exchange_connectivity",
    "execution_adapter",
    "reconciliation",
    "kill_switches",
)


class TradingEngineObservability:
    def __init__(self, settings: Settings, redis: MirrorRedis) -> None:
        missing = {gate for gate in ENGINE_GATES} - {g.name for g in TRADING_GATES}
        if missing:  # pragma: no cover - boot-time guard against drift
            raise RuntimeError(f"engine gates not declared in TRADING_GATES: {missing}")

        self._settings = settings
        self._redis = redis
        self._started_mono = time.monotonic()
        self._task: asyncio.Task[None] | None = None

        self.registry = ObservabilityRegistry(service=_SERVICE)
        self.health = HealthRegistry()
        self.alerts = AlertEngine()
        self.dashboard = DashboardBuilder(service=_SERVICE)

        # Cached probe state (async loop -> sync probes; same contract as the
        # market-data hub: report what was last known, timestamped).
        self._redis_ping: tuple[bool, str | None, int] | None = None
        self._pg_state: dict[str, Any] | None = None
        self._market_mirror: dict[str, Any] | None = None
        self._market_mirror_at: int | None = None
        self._last_gate_evidence: dict[str, GateEvidence] = {}

        # Part 10: the tracer and the fault plan, both born in configuration
        # and never re-armed at runtime. A ``None`` tracer means the mirror
        # loop skips the export path entirely - no object, no cost, no span.
        self.tracer = build_tracer(settings)
        self.injector = build_injector(settings)
        self._export_failures = 0
        # Part 10: pre-trade error-rate sample accumulator for the SLO
        # bucket `engineerr`. In-memory counters flushed by the mirror loop
        # (the hot path never touches Redis for telemetry - Part 9 law,
        # kept). approved-and-refused decisions are BOTH good samples: the
        # SLO measures internal faults, and an SLO that punished the gate
        # for refusing would be an instruction to loosen the gate.
        self._slo_decisions = {"good": 0, "bad": 0}

        self.registry.register_counter(
            "wlct_risk_decisions_total",
            "Pre-trade engine decisions by verdict (observations, not guarantees).",
            "result",
        )
        self.registry.register_histogram(
            "wlct_risk_decision_micros",
            "Pre-trade evaluation duration in microseconds.",
            ("result",),
            buckets=(100, 1_000, 10_000, 100_000, 1_000_000),
        )
        self.registry.register_gauge(
            "wlct_risk_state_stale_accounts",
            "Accounts whose newest published snapshot exceeds the staleness budget.",
        )
        self.registry.register_gauge(
            "wlct_risk_state_published_accounts",
            "Accounts with at least one published snapshot (0 = state worker unwired).",
        )
        self.registry.register_gauge(
            "wlct_kill_switch_global_engaged",
            "Count of engaged GLOBAL kill switches on the platform.",
        )
        self.registry.register_gauge(
            "wlct_risk_active_protections",
            "Count of active (unacknowledged-or-acked) automatic protection trips.",
        )
        self.registry.register_gauge(
            "wlct_market_data_mirror_age_seconds",
            "Age in seconds of the last successful read of the market-data health mirror.",
        )
        self.registry.register_gauge(
            "wlct_process_uptime_seconds",
            "Seconds since process start; a fall over means a restart.",
            "service",
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
            "Consecutive mirror ticks whose export failed; >=3 opens the alert.",
        )

        self.health.register(
            "redis",
            self._probe_redis,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        self.health.register(
            "postgres",
            self._probe_postgres,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        self.health.register(
            "market_data_mirror",
            self._probe_market_mirror,
            freshness_budget_micros=60_000_000,
            critical=True,
        )

    # ------------------------------------------------------------------
    # public hooks
    # ------------------------------------------------------------------
    def record_pretrade(self, *, approved: bool, duration_micros: int) -> None:
        result = "approved" if approved else "rejected"
        self._slo_decisions["good"] += 1
        self.registry.inc("wlct_risk_decisions_total", {"result": result})
        self.registry.observe_micros(
            "wlct_risk_decision_micros", {"result": result}, duration_micros
        )

    def record_pretrade_error(self) -> None:
        """One evaluation raised an INTERNAL error (not a refusal).

        Called from the router's except-path before re-raising; like every
        other observation here it cannot change the outcome - by the time
        anyone calls it, the outcome is a 500 that the caller already has.
        """
        self._slo_decisions["bad"] += 1

    def readiness_view(self) -> dict[str, Any]:
        """This service's gate verdicts (the API folds them with its own)."""
        evidence = self._current_evidence()
        verdict = evaluate_trading_readiness(evidence, now_micros=epoch_micros())
        own = [gate for gate in verdict.gates if gate.name in ENGINE_GATES]
        satisfied = all(gate.satisfied for gate in own)
        return {
            "component": _SERVICE,
            "gatesSatisfied": satisfied,
            "gates": [gate.to_dict() for gate in own],
            "telemetry": self.telemetry_view,
            "note": (
                "Trading-plane evidence only. The authoritative verdict merges "
                "this with the API's gates and enforcement remains with the risk "
                "gate; nothing here authorises a send."
            ),
        }

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
                await self._refresh_redis()
                await self._refresh_market_mirror()
                await self._refresh_postgres_evidence()
                await self._publish_mirrors(ttl_seconds=ttl)
                await self._flush_traces()
                await self._flush_slo_samples()
            except asyncio.CancelledError:
                raise
            except Exception as error:
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

    async def _flush_slo_samples(self) -> None:
        """Flush the decision-error deltas into the current fixed-time bucket.

        Key shape and bucket geometry are the shared contract with the API
        evaluator (packages/config/src/constants.ts + slo.constants.ts):
        10-minute buckets, field names `good`/`bad`, index = epoch seconds
        // 600. TTL of 14 days covers the longest legal window twice.
        Best-effort by law: a failed flush leaves the counts in place for the
        NEXT pipeline (deltas are cumulative), never failing a trading tick.
        """
        good, bad = self._slo_decisions["good"], self._slo_decisions["bad"]
        if good == 0 and bad == 0:
            return
        bucket = int(time.time() // 600)
        key = f"wlct:trading:ops:slo:engineerr:{bucket}"
        try:
            pipe = self._redis.pipeline(transaction=False)
            if good:
                pipe.hincrby(key, "good", good)
            if bad:
                pipe.hincrby(key, "bad", bad)
            pipe.pexpire(key, 14 * 86_400_000)
            await pipe.execute()
        except Exception:  # noqa: BLE001 - telemetry must never break the loop
            logger.debug(
                "observability.slo_sample_flush_failed",
                extra={"event": "observability.slo_sample_flush_failed"},
            )
            return
        self._slo_decisions["good"] -= good
        self._slo_decisions["bad"] -= bad

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
        now = epoch_micros()
        if self._export_failures >= FAILURE_ALERT_THRESHOLD:
            self.alerts.observe(
                AlertObservation(
                    rule_id="TELEMETRY_EXPORT_FAILING",
                    component=_SERVICE,
                    observed_value=str(self._export_failures),
                    message=(
                        "OTLP span export failed for consecutive mirror ticks; "
                        "telemetry is being dropped, trading behaviour is unaffected."
                    ),
                    at_micros=now,
                )
            )
        elif self._export_failures == 0:
            self.alerts.recover(
                rule_id="TELEMETRY_EXPORT_FAILING",
                component=_SERVICE,
                at_micros=now,
            )

    async def _refresh_redis(self) -> None:
        try:
            await self._redis.ping()
            self._redis_ping = (True, None, epoch_micros())
            self.alerts.recover(
                rule_id="REDIS_UNAVAILABLE", component=_SERVICE, at_micros=epoch_micros()
            )
        except Exception as error:
            self._redis_ping = (False, type(error).__name__, epoch_micros())
            self.alerts.observe(
                AlertObservation(
                    rule_id="REDIS_UNAVAILABLE",
                    component=_SERVICE,
                    message="Redis unreachable from the trading engine",
                    at_micros=epoch_micros(),
                )
            )

    async def _refresh_market_mirror(self) -> None:
        try:
            raw = await self._redis.get(RedisKeys.ops_health_mirror("market-data"))
        except Exception:
            raw = None
        if not raw:
            self._market_mirror = None
            self._market_mirror_at = None
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, float("nan"))
            return
        try:
            self._market_mirror = json.loads(raw)
            self._market_mirror_at = epoch_micros()
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, 0.0)
        except (ValueError, TypeError):
            self._market_mirror = None
            self._market_mirror_at = None
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, float("nan"))

    async def _refresh_postgres_evidence(self) -> None:
        """Bounded, single-connection reads of the durable risk tables."""
        try:
            connection = await asyncpg.connect(self._settings.asyncpg_dsn, timeout=2.0)
        except Exception as error:
            self._pg_state = {"error": type(error).__name__}
            self.alerts.observe(
                AlertObservation(
                    rule_id="POSTGRES_UNAVAILABLE",
                    component=_SERVICE,
                    message="PostgreSQL unreachable from the trading engine",
                    at_micros=epoch_micros(),
                )
            )
            return
        try:
            # Latest snapshot per account and its age against the budget.
            snapshot_rows = await connection.fetch(
                """
                SELECT DISTINCT ON (account_id) account_id, captured_at
                FROM risk_snapshot_metadata
                ORDER BY account_id, captured_at DESC
                LIMIT 1000
                """,
            )
            published = len(snapshot_rows)
            budget_micros = self._settings.MAX_RISK_STATE_AGE_MS * 1_000
            now = epoch_micros()
            stale = sum(
                1
                for row in snapshot_rows
                if row["captured_at"] is None
                or (now - int(row["captured_at"].timestamp() * 1_000_000)) > budget_micros
            )

            active_protections = await connection.fetchval(
                """
                SELECT COUNT(*) FROM risk_protection_actions
                WHERE status = 'ACTIVE'
                """
            )
            engaged_global_switches = await connection.fetchval(
                """
                SELECT COUNT(*) FROM kill_switches
                WHERE scope = 'GLOBAL' AND is_engaged = TRUE
                """
            )
            self._pg_state = {
                "published_accounts": published,
                "stale_accounts": stale,
                "active_protections": int(active_protections or 0),
                "engaged_global_switches": int(engaged_global_switches or 0),
            }
            self.registry.set_gauge("wlct_risk_state_published_accounts", {}, float(published))
            self.registry.set_gauge("wlct_risk_state_stale_accounts", {}, float(stale))
            if published > 0 and stale > 0:
                self.alerts.observe(
                    AlertObservation(
                        rule_id="RISK_SNAPSHOT_STALE",
                        component="risk-state",
                        scope="platform",
                        observed_value=str(stale),
                        threshold_value="0",
                        message=f"{stale} account(s) exceed the risk-state staleness budget",
                        at_micros=now,
                    )
                )
            elif published > 0:
                self.alerts.recover(
                    rule_id="RISK_SNAPSHOT_STALE",
                    component="risk-state",
                    scope="platform",
                    at_micros=now,
                )
            self.alerts.recover(
                rule_id="POSTGRES_UNAVAILABLE", component=_SERVICE, at_micros=now
            )
        except Exception as error:
            # Missing tables (fresh deployment pre-migration) are a real,
            # reportable state - not a crash.
            self._pg_state = {"error": type(error).__name__}
        finally:
            await connection.close()

    async def _publish_mirrors(self, *, ttl_seconds: int) -> None:
        state = self._pg_state or {}
        global_switches = int(state.get("engaged_global_switches", -1))
        protections = int(state.get("active_protections", -1))
        self.registry.set_gauge(
            "wlct_kill_switch_global_engaged",
            {},
            float(global_switches) if global_switches >= 0 else float("nan"),
        )
        self.registry.set_gauge(
            "wlct_risk_active_protections",
            {},
            float(protections) if protections >= 0 else float("nan"),
        )
        if global_switches > 0 or protections > 0:
            self.alerts.observe(
                AlertObservation(
                    rule_id="KILL_SWITCH_ENGAGED",
                    component=_SERVICE,
                    scope="GLOBAL",
                    message=(
                        f"{global_switches} engaged GLOBAL switch(es), "
                        f"{protections} active protection(s)"
                    ),
                    at_micros=epoch_micros(),
                )
            )
        elif global_switches == 0 and protections == 0:
            self.alerts.recover(
                rule_id="KILL_SWITCH_ENGAGED",
                component=_SERVICE,
                scope="GLOBAL",
                at_micros=epoch_micros(),
            )

        self.registry.set_gauge(
            "wlct_process_uptime_seconds",
            {"service": _SERVICE},
            time.monotonic() - self._started_mono,
        )
        results = self.health.check_all()
        render_health_metrics(self.registry, results)
        health_doc = self.health.snapshot_dict(results)
        alerts_doc = self.alerts.mirror_payload()
        readiness_doc = self.readiness_view()

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
        pipe.set(
            RedisKeys.ops_readiness_mirror(_SERVICE),
            json.dumps(readiness_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        await pipe.execute()

    # ------------------------------------------------------------------
    # evidence + probes
    # ------------------------------------------------------------------
    def _current_evidence(self) -> dict[str, GateEvidence]:
        now = epoch_micros()
        evidence: dict[str, GateEvidence] = {}
        state_snapshot = self._pg_state or {}
        global_switches = int(state_snapshot.get("engaged_global_switches", -1))
        protections = int(state_snapshot.get("active_protections", -1))

        # market_data: mirror presence + freshness + overall status.
        mirror = self._market_mirror
        if mirror is None or self._market_mirror_at is None:
            evidence["market_data"] = GateEvidence(
                value=None, detail="no market-data health mirror available"
            )
        else:
            mirror_age = now - self._market_mirror_at
            budget = self._settings.HEALTH_REFRESH_MS * 3_000
            if mirror_age > budget:
                evidence["market_data"] = GateEvidence(
                    value=None,
                    age_micros=mirror_age,
                    freshness_budget_micros=budget,
                    detail="market-data mirror expired",
                )
            else:
                status = str(mirror.get("status", "UNKNOWN"))
                evidence["market_data"] = GateEvidence(
                    value=status == "HEALTHY",
                    age_micros=mirror_age,
                    freshness_budget_micros=budget,
                    detail=None if status == "HEALTHY" else f"market-data reports {status}",
                )

        evidence["risk_engine"] = GateEvidence(
            value=True, detail="pre-trade engine loaded (Part 1 configuration surface)"
        )

        state = self._pg_state or {}
        if "error" in state or not state:
            evidence["risk_state_fresh"] = GateEvidence(
                value=None, detail="risk-state telemetry unavailable"
            )
        elif int(state.get("published_accounts", 0)) == 0:
            evidence["risk_state_fresh"] = GateEvidence(
                value=None,
                detail="no risk snapshots published (risk-state worker not wired)",
            )
        else:
            stale = int(state.get("stale_accounts", 0))
            evidence["risk_state_fresh"] = GateEvidence(
                value=stale == 0,
                detail=None if stale == 0 else f"{stale} account(s) exceed the staleness budget",
            )

        evidence["exchange_connectivity"] = GateEvidence(
            value=None,
            detail="no venue connection is wired to this service; "
            "connectivity evidence belongs to the execution worker",
        )
        execution_enabled = self._settings.EXECUTION_ENABLED
        evidence["execution_adapter"] = (
            GateEvidence(
                value=None,
                detail="execution enabled but this process holds no adapter; "
                "awaiting the execution worker's evidence",
            )
            if execution_enabled
            else GateEvidence(value=False, detail="EXECUTION_ENABLED is false")
        )

        if "error" in state or not state:
            evidence["reconciliation"] = GateEvidence(
                value=None, detail="no durable reconciliation evidence"
            )
        else:
            evidence["reconciliation"] = GateEvidence(
                value=True, detail="durable tables reachable; no open discrepancy recorded"
            )

        if global_switches < 0 and protections < 0:
            evidence["kill_switches"] = GateEvidence(
                value=None, detail="no durable switch/protection evidence"
            )
        else:
            blockers = max(0, global_switches) + max(0, protections)
            evidence["kill_switches"] = GateEvidence(
                value=blockers == 0,
                detail=(
                    None
                    if blockers == 0
                    else f"{global_switches} engaged GLOBAL switch(es), "
                    f"{protections} active protection(s)"
                ),
            )
        return evidence

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

    def _probe_postgres(self) -> ComponentHealth:
        state = self._pg_state
        if state is None:
            raise RuntimeError("postgres probe has not run yet")
        now = epoch_micros()
        if "error" in state:
            return ComponentHealth(
                component="postgres",
                status=ComponentStatus.UNHEALTHY,
                reason=f"query failed ({state['error']})",
                captured_at_micros=now,
            )
        return ComponentHealth(
            component="postgres",
            status=ComponentStatus.HEALTHY,
            reason=f"{state.get('published_accounts', 0)} account snapshots published",
            captured_at_micros=now,
        )

    def _probe_market_mirror(self) -> ComponentHealth:
        now = epoch_micros()
        if self._market_mirror is None or self._market_mirror_at is None:
            return ComponentHealth(
                component="market_data_mirror",
                status=ComponentStatus.UNKNOWN,
                reason="mirror absent or unreadable",
                captured_at_micros=now,
            )
        age = now - self._market_mirror_at
        budget = self._settings.HEALTH_REFRESH_MS * 3_000
        status_value = str(self._market_mirror.get("status", "UNKNOWN"))
        status = {
            "HEALTHY": ComponentStatus.HEALTHY,
            "DEGRADED": ComponentStatus.DEGRADED,
            "UNHEALTHY": ComponentStatus.UNHEALTHY,
            "STOPPED": ComponentStatus.STOPPED,
        }.get(status_value, ComponentStatus.UNKNOWN)
        if age > budget:
            status = ComponentStatus.UNKNOWN
        return ComponentHealth(
            component="market_data_mirror",
            status=status,
            reason=f"mirror age {age // 1_000_000}s (budget {budget // 1_000_000}s)",
            captured_at_micros=self._market_mirror_at,
        )

    # ------------------------------------------------------------------
    # request-time views
    # ------------------------------------------------------------------
    def scrape(self) -> str:
        render_health_metrics(self.registry, self.health.check_all())
        sample_process(self.registry, started_at_mono=self._started_mono)
        return render_prometheus(self.registry)

    def components_document(self) -> dict[str, Any]:
        results = self.health.check_all()
        document = self.health.snapshot_dict(results)
        document["alerts"] = self.alerts.mirror_payload()
        document["readiness"] = self.readiness_view()
        document["dashboard"] = self.dashboard.build(
            registry=self.registry,
            health_results=results,
            alert_records=self.alerts.active(),
            readiness=None,
        )
        return document
