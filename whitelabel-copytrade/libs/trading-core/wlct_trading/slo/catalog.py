"""The default SLO catalog: nine indicators, nine concrete promises.

Why defaults live in code rather than only in the database: the database
stores the *current* configuration (versioned, checksummed, editable through
the operations API); this catalog is what a fresh deployment evaluates and -
more importantly - what the parity fixtures cover first. An operator who
deletes every custom version returns to these numbers, and CI compares these
numbers against the TypeScript mirror, so "we always meant 99.5 and forgot to
write it down" cannot happen quietly.

The thresholds are stated with their weaknesses on purpose (see each entry's
description): an SLO whose measurement has a known blind spot is only honest
when the blind spot is written on it.

Objectives are deliberately modest for a platform that has explicitly made no
latency or uptime guarantees anywhere: these measure and alarm; they do not
promise a customer anything until a contract says so, and nothing in this
repository writes such a contract.
"""

from __future__ import annotations

from .model import SloDefinition, SloIndicator

__all__ = ["DEFAULT_SLO_CATALOG", "default_definitions"]

# Freshness thresholds: 2x the Part 8 platform budgets (MAX_RISK_STATE_AGE_MS
# default 2000 -> SLO allows 4s of age before counting a sample bad), so the
# SLO measures sustained staleness while the GATE keeps refusing on the
# tighter live budget. The gate is the safety; the SLO is the trend.
_RISK_FRESHNESS_MAX_AGE_MICROS = 4_000_000
_MARKET_FRESHNESS_MAX_AGE_MICROS = 30_000_000
_RECONCILIATION_MAX_AGE_MICROS = 900_000_000  # 15 minutes between clean passes
_QUEUE_AGE_MAX_MICROS = 240_000_000  # 4 min oldest waiting; alerting policy is Part 9's
_API_LATENCY_THRESHOLD_MICROS = 500_000  # server-side handling, not venue time


def _definitions() -> tuple[SloDefinition, ...]:
    return (
        SloDefinition(
            slo_id="api.availability",
            service="api",
            description=(
                "Share of evaluation ticks the API's own readiness probes (Postgres+Redis) "
                "answered ready. Does not measure client-perceived availability."
            ),
            owner="platform-sre",
            indicator=SloIndicator.AVAILABILITY,
            objective="99.5",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="readiness check passed within the tick",
            bad_event="readiness check failed or timed out within the tick",
        ),
        SloDefinition(
            slo_id="api.request-success",
            service="api",
            description="Non-5xx share of served HTTP requests (route-template labels only).",
            owner="platform-sre",
            indicator=SloIndicator.REQUEST_SUCCESS_RATIO,
            objective="99.5",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="status class 2xx/3xx/4xx",
            bad_event="status class 5xx",
        ),
        SloDefinition(
            slo_id="queues.processing-success",
            service="queues",
            description=(
                "Share of BullMQ jobs that completed without entering 'failed' across "
                "the platform queues; control queues included, the execution queue's "
                "tighter policy lives in Part 9 alerting."
            ),
            owner="platform-sre",
            indicator=SloIndicator.QUEUE_PROCESSING_SUCCESS,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="job moved to completed",
            bad_event="job moved to failed after its final attempt",
        ),
        SloDefinition(
            slo_id="queues.freshness",
            service="queues",
            description="Oldest waiting job within 4 minutes on every sampled queue.",
            owner="platform-sre",
            indicator=SloIndicator.QUEUE_FRESHNESS,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="sampled tick: every queue's oldest-waiting age within 240000000 micros",
            bad_event="sampled tick: any queue over 240000000 micros (unknown reads as bad here: a stalled collector is not freshness)",
            max_age_micros=_QUEUE_AGE_MAX_MICROS,
        ),
        SloDefinition(
            slo_id="market-data.freshness",
            service="market-data",
            description=(
                "Published health mirror reports HEALTHY (all tracked symbols within the "
                "cache budget) at the sampled tick."
            ),
            owner="trading-platform",
            indicator=SloIndicator.MARKET_DATA_FRESHNESS,
            objective="99.5",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="mirror present with status HEALTHY",
            bad_event="mirror present with DEGRADED/UNHEALTHY/STOPPED status",
            max_age_micros=_MARKET_FRESHNESS_MAX_AGE_MICROS,
        ),
        SloDefinition(
            slo_id="risk-state.freshness",
            service="trading-engine",
            description=(
                "Every account's newest published snapshot within twice the live gate's "
                "staleness budget. The GATE still refuses beyond 1x; a red SLO here means "
                "the refusals are chronic."
            ),
            owner="trading-platform",
            indicator=SloIndicator.RISK_STATE_FRESHNESS,
            objective="99.9",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="engine probe report: zero stale accounts",
            bad_event="engine probe report: one or more stale accounts, or no published snapshots at all",
            max_age_micros=_RISK_FRESHNESS_MAX_AGE_MICROS,
        ),
        SloDefinition(
            slo_id="execution.reconciliation-freshness",
            service="trading-engine",
            description=(
                "A clean reconciliation pass within 15 minutes for the durable view. "
                "Blindness counts bad on purpose: 'we do not know' is operationally "
                "'we did not run'."
            ),
            owner="trading-platform",
            indicator=SloIndicator.RECONCILIATION_FRESHNESS,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="last clean pass age within 900000000 micros",
            bad_event="last clean pass older than 900000000 micros or never observed",
            max_age_micros=_RECONCILIATION_MAX_AGE_MICROS,
        ),
        SloDefinition(
            slo_id="api.latency-compliance",
            service="api",
            description=(
                "Share of served requests whose SERVER-SIDE handling finished under "
                "500ms. Venue round-trips and network time are excluded: the histogram "
                "observes this process, not a promise about any other."
            ),
            owner="platform-sre",
            indicator=SloIndicator.LATENCY_THRESHOLD_COMPLIANCE,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="duration within 500000 micros",
            bad_event="duration over 500000 micros",
            latency_threshold_micros=_API_LATENCY_THRESHOLD_MICROS,
        ),
        SloDefinition(
            slo_id="trading-engine.error-rate",
            service="trading-engine",
            description=(
                "Share of pre-trade evaluations that ended in an internal fault, not a "
                "risk refusal. Refusals are never counted bad: an SLO must not punish "
                "the gate for doing its job."
            ),
            owner="trading-platform",
            indicator=SloIndicator.ERROR_RATE_COMPLIANCE,
            objective="99.9",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="evaluation returned a decision (approved or refused)",
            bad_event="evaluation raised an internal error",
        ),
    )


DEFAULT_SLO_CATALOG: tuple[SloDefinition, ...] = _definitions()


def default_definitions() -> tuple[SloDefinition, ...]:
    """Fresh copies of the default catalog; the dataclasses are frozen, but
    callers sometimes layer edits on top, and handing out a shared tuple is
    how 'edits' become global state."""
    return DEFAULT_SLO_CATALOG
