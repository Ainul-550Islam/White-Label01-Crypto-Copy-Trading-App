"""The chaos / failover probe matrix: documented invariants, graded honestly or not at all.

Why this module exists
----------------------
``faults.py`` is deliberately blunt about its own limit: *"Anything broader is chaos engineering,
which this repository's roadmap explicitly still lists as open work; calling this file 'chaos'
would be marketing."* The broader work has two halves. One is the infrastructure - killing a
worker, promoting a replica - and no file in a repository can do that. The other half is the
*specification of what should be observed while it happens*, and that this file does: for each
scenario in the Part 11/12/13 runbooks, the fault points that emulate its symptoms, the invariant
that must hold, the observation that proves it, the recovery step, the timeout budget and the
cleanup. Before this, those sentences lived in prose in ``docs/PART11_WORKER_SCALING.md`` sec. 18
and nowhere else, which meant a staging run could "do the chaos exercise" without ever being asked
which invariant it was testing.

The grading law, and why it is the interesting part
---------------------------------------------------
Every outcome is one of five closed grades: ``pass``, ``fail``, ``unverified``, ``planned``,
``skipped``. A run in this repository produces ``unverified`` for every probe, because nothing here
can reach a Redis primary or a running worker - and reporting anything else would be the exact
failure mode the platform's status surfaces are built to avoid. ``pass`` requires a
caller-supplied check, which arrives from a harness, and the outcome then carries
``source="harness"`` so that a green cell is never readable as "production survived a failover".
An absent dependency grades ``unverified``, never ``pass`` and never ``fail``: not knowing is not
the same as having broken something.

What this module never does
---------------------------
It does not sleep, thread, or spawn (so a matrix run cannot make CI a candle, the same law
``faults.py`` states for the injector); it does not arm anything (the injector is constructed by
validated configuration and is read-only here); it does not import trading-path code, and nothing
in the trading path imports it; and it has no lever on a real system - no shell, no HTTP, no
"run this command from a config file". The timeout budgets it reports are *declarations for the
operator running the real drill*, enforced by whoever owns the process, and a test pins that this
module imports no clock at all.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Final

from .faults import FAULT_POINTS, FailureInjector, disabled_injector

__all__ = [
    "CHAOS_GRADES",
    "CHAOS_MATRIX",
    "INFRASTRUCTURE",
    "ChaosProbe",
    "ChaosRefusedError",
    "MatrixReport",
    "ProbeOutcome",
    "render_text",
    "run_matrix",
]

#: The five grades, spelled once. ``planned`` exists for the rehearsal runner's vocabulary to line
#: up with this one: a step that describes an intent is not a step that describes an outcome.
CHAOS_GRADES: Final[tuple[str, ...]] = ("pass", "fail", "unverified", "planned", "skipped")

#: The infrastructure a probe may declare as required. A closed set, because "requires: whatever the
#: operator typed" would let a typo read as an unavailable dependency and quietly turn a red drill
#: into an unverified shrug.
INFRASTRUCTURE: Final[frozenset[str]] = frozenset(
    {
        "exchange",
        "postgres_primary",
        "redis_cluster",
        "redis_primary",
        "worker_process",
        "engine_process",
        "object_store",
    }
)

_TIMEOUT_BOUNDS: Final[tuple[int, int]] = (5, 900)


class ChaosRefusedError(RuntimeError):
    """Raised when the matrix is asked to run where it must not.

    The message names the reason rather than the remedy: whoever hits this is in a deployment
    context, and the deployment context is exactly where the answer is "no".
    """


@dataclass(frozen=True, slots=True)
class ChaosProbe:
    """One scenario, stated as the eight things a drill needs.

    ``fault_points`` must be a subset of :data:`~wlct_trading.observability.faults.FAULT_POINTS`:
    the injection universe is closed, and a chaos matrix that invented new fault points would be
    smuggling an extension to that closed set in through the back door. Where a scenario's real
    cause has no fault point (a killed process, a promoted replica), the list holds the *symptom*
    points the observability layer can see, and the requirement names what a harness must supply to
    cause the real thing.

    ``check`` is the only path to a ``pass``. It returns True/False; exceptions are graded ``fail``
    with the exception text as the reason, because a probe that raises is a probe that found
    something - except ``ChaosRefusedError``, which propagates: a refusal is not a result.
    """

    probe_id: str
    title: str
    requires: frozenset[str]
    fault_points: tuple[str, ...]
    setup: str
    injection: str
    expected_invariant: str
    observation: str
    recovery: str
    cleanup: str
    timeout_seconds: int
    check: Callable[[], bool] | None = field(default=None, compare=False, repr=False)

    def __post_init__(self) -> None:
        if not self.probe_id or not self.probe_id.replace("_", "").isalnum():
            raise ValueError(f"probe_id {self.probe_id!r} must be a snake_case identifier")
        for name in ("title", "setup", "injection", "expected_invariant", "observation", "recovery", "cleanup"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{self.probe_id}: {name} must be a non-empty sentence")
        if not isinstance(self.requires, frozenset) or not self.requires:
            raise ValueError(f"{self.probe_id}: requires must name at least one infrastructure member")
        unknown_requires = set(self.requires) - INFRASTRUCTURE
        if unknown_requires:
            raise ValueError(
                f"{self.probe_id}: requires {sorted(unknown_requires)} is not in the infrastructure vocabulary "
                f"{sorted(INFRASTRUCTURE)}"
            )
        unknown_points = set(self.fault_points) - FAULT_POINTS
        if unknown_points:
            raise ValueError(
                f"{self.probe_id}: fault points {sorted(unknown_points)} are outside the closed universe"
            )
        low, high = _TIMEOUT_BOUNDS
        if not low <= self.timeout_seconds <= high:
            raise ValueError(f"{self.probe_id}: timeout_seconds must be within {low}..{high} seconds")


@dataclass(frozen=True, slots=True)
class ProbeOutcome:
    """What one probe concluded, and the whole reason it concluded that."""

    probe_id: str
    grade: str
    reason: str
    #: "harness" when a supplied check ran, "none" when nothing could. A report whose source is
    #: "none" cannot contain a pass, and that is enforced rather than promised.
    source: str
    checks_run: int
    evidence: Mapping[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "probe_id": self.probe_id,
            "grade": self.grade,
            "reason": self.reason,
            "source": self.source,
            "checks_run": self.checks_run,
            "evidence": dict(self.evidence),
        }


@dataclass(frozen=True, slots=True)
class MatrixReport:
    """The whole run, as data. No clock of its own: ``generated_at`` arrives from the caller, so a
    report can be reproduced byte for byte in a test and in a post-mortem."""

    tool: str
    environment: str
    generated_at: str
    injector_enabled: bool
    armed_points: tuple[str, ...]
    availability: frozenset[str]
    outcomes: tuple[ProbeOutcome, ...]
    grade: str

    @property
    def counts(self) -> dict[str, int]:
        counts = {grade: 0 for grade in CHAOS_GRADES}
        for outcome in self.outcomes:
            counts[outcome.grade] = counts.get(outcome.grade, 0) + 1
        return counts

    def to_dict(self) -> dict[str, object]:
        return {
            "schema": "wlct.chaos.matrix/1",
            "tool": self.tool,
            "environment": self.environment,
            "generated_at": self.generated_at,
            "injection": {"enabled": self.injector_enabled, "armed_points": list(self.armed_points)},
            "availability_declared": sorted(self.availability),
            "grade": self.grade,
            "counts": self.counts,
            # The law, printed in the artifact itself: a reader who skips the docs still meets this
            # sentence before any grade.
            "reading": (
                "unverified means this run had no way to know; it is not a failure and never a pass. "
                "A pass carries source=harness: it is evidence about a harness, not about a production failover."
            ),
            "probes": [outcome.to_dict() for outcome in self.outcomes],
        }

    def render_text(self) -> str:
        marks = {"pass": "PASS", "fail": "FAIL", "unverified": "UNVER", "planned": "PLAN", "skipped": "SKIP"}
        lines = [
            f"chaos matrix {self.tool} - {self.grade.upper()} - environment {self.environment} "
            f"({self.generated_at}, injector {'armed' if self.injector_enabled else 'off'})",
        ]
        for outcome in self.outcomes:
            lines.append(
                f"[{marks.get(outcome.grade, '?')}] {outcome.probe_id:<24} {outcome.source:<7} {outcome.reason}"
            )
        counts = self.counts
        lines.append(
            "grades: " + ", ".join(f"{grade}={count}" for grade, count in counts.items() if count) + " - "
            "an absent dependency is unverified by law, never pass"
        )
        return "\n".join(lines)


def _build(
    probe_id: str,
    title: str,
    *,
    requires: Iterable[str],
    fault_points: Iterable[str],
    setup: str,
    injection: str,
    expected_invariant: str,
    observation: str,
    recovery: str,
    cleanup: str,
    timeout_seconds: int,
) -> ChaosProbe:
    return ChaosProbe(
        probe_id=probe_id,
        title=title,
        requires=frozenset(requires),
        fault_points=tuple(sorted(set(fault_points))),
        setup=setup,
        injection=injection,
        expected_invariant=expected_invariant,
        observation=observation,
        recovery=recovery,
        cleanup=cleanup,
        timeout_seconds=timeout_seconds,
    )


#: The matrix. Ten scenarios, in the order an operator would run them on a staging plane: the
#: outside world first, then the coordination layers, then the processes, then the message path.
#: Each one's expected invariant is the sentence the runbook already asserts - the unit tests named
#: in ``observation`` are where that sentence is pinned today - so a staging run checks a claim the
#: repository has already committed to, not a new one invented here.
CHAOS_MATRIX: Final[tuple[ChaosProbe, ...]] = (
    _build(
        "exchange_outage",
        "A - the exchange stops answering",
        requires=("exchange",),
        fault_points=("market_data_stale_simulated", "reconciliation_delay_simulated"),
        setup="A warm feed with a live book, a strategy that would place, and an open position",
        injection="Cut the exchange (or arm market_data_stale_simulated) for longer than the staleness budget",
        expected_invariant="No order is placed on stale data; the gate refuses and says why, and recovery is observed rather than assumed",
        observation="Risk-gate refusal reason, the staleness field in the dashboard document, and the recovery alert",
        recovery="Reconnect, let the book re-sync, confirm the feed is inside budget before placements resume",
        cleanup="Disarm the fault point; nothing persists in it, so cleanup is the disarm itself",
        timeout_seconds=120,
    ),
    _build(
        "redis_failover",
        "B - Redis primary fails over",
        requires=("redis_primary", "redis_cluster"),
        fault_points=("redis_health_probe_unavailable",),
        setup="A fleet of two or more workers with claims held, jobs in flight, reservations open",
        injection="Promote the replica (or arm redis_health_probe_unavailable) for one lease period",
        expected_invariant="Held sets age; verdicts fail closed to not-mine; claims that survive re-assert without eviction; no job is lost, only delayed",
        observation="Worker coordination view member list, the deferral counter, and the queue gauges",
        recovery="Let the lease TTL expire, confirm partitions land on the surviving members by rendezvous",
        cleanup="Re-check membership; do not clear held sets by hand",
        timeout_seconds=300,
    ),
    _build(
        "postgres_failover",
        "C - Postgres primary fails over",
        requires=("postgres_primary",),
        fault_points=("postgres_health_probe_unavailable",),
        setup="A durable store with pending rows and an in-flight migration audit",
        injection="Fail the primary over (or arm postgres_health_probe_unavailable) mid-write",
        expected_invariant="Writes fail closed with no partial commit; the durable record trail either contains a row or does not, never half of one",
        observation="Store errors surfaced as health, the _prisma_migrations audit, and the pending-row gauge",
        recovery="Reconnect to the promoted primary, re-run the audit, replay nothing that the durable store already holds",
        cleanup="Nothing to undo; the ledger rows written during the blip are the record",
        timeout_seconds=300,
    ),
    _build(
        "worker_kill",
        "D - a worker is killed mid-batch",
        requires=("worker_process",),
        fault_points=("queue_observed_failure",),
        setup="A worker with an active claim and a batch in flight, load running",
        injection="kill -9 the worker process between two queue acknowledgements",
        expected_invariant="Claims expire within the lease TTL; unacked jobs redeliver by at-least-once; the killed worker's partitions move and only its partitions",
        observation="Lease expiry timing, the redelivery count, and the invariant that a deferred job is delayed rather than failed",
        recovery="Restart the worker with the same WORKER_ID and membership list; no manual reclaim",
        cleanup="Confirm the dead member is absent from the coordination view before calling it done",
        timeout_seconds=600,
    ),
    _build(
        "restart_mid_flight",
        "E - a clean restart during in-flight work",
        requires=("worker_process",),
        fault_points=("queue_observed_delay",),
        injection="Send SIGTERM while a batch is mid-drain",
        setup="A worker holding claims, with a batch that takes longer than the drain window",
        expected_invariant="The drain sequence completes or the work is left unacked for redelivery; no ack is written for work that did not finish",
        observation="The drain log ordering, ack counts before/after, and the queue depth returning to baseline",
        recovery="Restart and confirm the same job is not double-applied (idempotency by dedupe key)",
        cleanup="None beyond restart; do not flush queues to make the numbers look clean",
        timeout_seconds=600,
    ),
    _build(
        "membership_change",
        "F - the membership set changes",
        requires=("redis_cluster", "worker_process"),
        fault_points=("redis_health_probe_unavailable", "queue_observed_delay"),
        setup="A fleet at N members, all with WORKER_MEMBERSHIP set to the same list",
        injection="Roll the fleet to N+1 (or N-1) with the new list on every member",
        expected_invariant="Rendezvous moves only the changed member's partitions; non-owners defer, owners keep processing; nothing double-processes during the roll",
        observation="Per-partition owner in the coordination view, before and after; the deferral counter as the only expected blip",
        recovery="Confirm every member reports the identical membership list; a member with a stale list is a partition with two owners",
        cleanup="Restart any member that failed to pick up the new list; never edit the held sets",
        timeout_seconds=900,
    ),
    _build(
        "transport_timeout",
        "G - the transport answers late",
        requires=("exchange",),
        fault_points=("queue_observed_delay", "market_data_stale_simulated"),
        injection="Arm the delay point so observed latency exceeds the configured timeout budget",
        setup="A transport with a finite timeout budget and a retry policy that distinguishes retryable from terminal",
        expected_invariant="The budget is honoured: a late answer is a timeout, not an indefinite wait, and the classification (retryable versus terminal) is what the durable record says",
        observation="Observed latency against budget, the retry/terminal split, and the correlation id surviving the retry",
        recovery="Disarm; confirm the latency histogram returns to its pre-injection shape",
        cleanup="Disarm the point; the injected delay is observed-value only and touches nothing it delays",
        timeout_seconds=120,
    ),
    _build(
        "engine_restart",
        "H - the execution engine restarts",
        requires=("engine_process",),
        fault_points=("metrics_export_unavailable",),
        setup="An engine with posture state, an incident table, and a worker gate depending on /internal/v1/status",
        injection="Restart the engine process while a command is in flight",
        expected_invariant="The store is durable across the restart; posture reads survive; an incident read still raises rather than returning an empty answer; the worker gate does not treat a refused read as a pass",
        observation="The status document before/after, the gate's terminal-status handling, and IncidentReadError still being raised on a read",
        recovery="No operator action if the store is durable; if not, that is the finding",
        cleanup="Confirm the instance id changed and nothing downstream cached the old posture as truth",
        timeout_seconds=300,
    ),
    _build(
        "stale_coordination",
        "I - coordination state goes stale",
        requires=("redis_cluster", "worker_process"),
        fault_points=("redis_health_probe_unavailable", "queue_observed_failure"),
        setup="Workers with held sets and a coordination view that ages",
        injection="Isolate Redis long enough for held sets to age past the freshness bound, then restore it",
        expected_invariant="Verdicts fail closed while state is stale; a stale 'mine' is never acted on; recovery re-asserts rather than reseeds",
        observation="The fail-closed branch counters, and the fact that no partition was processed by two members in the window",
        recovery="Let held sets re-populate; do not write them by hand",
        cleanup="Disarm and re-check the coordination view for a single owner per partition",
        timeout_seconds=600,
    ),
    _build(
        "redelivery",
        "J - a delivered job arrives twice",
        requires=("worker_process",),
        fault_points=("queue_observed_failure", "queue_observed_delay"),
        setup="A consumer with a dedupe key and an idempotent apply path",
        injection="Refuse the ack for a delivered job so it redelivers (or crash after apply, before ack)",
        expected_invariant="At-least-once delivery is real: the second delivery is applied exactly once in effect, and the dedupe evidence is in the durable record, not in memory",
        observation="Apply count per dedupe key, the audit table, and the absence of a duplicate side effect",
        recovery="Nothing to recover; confirm the second delivery changed no state",
        cleanup="Purge the test job by dedupe key after the drill, and record that you did",
        timeout_seconds=300,
    ),
)

#: The id order is the run order for a staging drill; a test pins that nobody reorders it casually,
#: because the sequence is the dependency chain (you cannot learn anything about redelivery while
#: Redis is still isolated).
MATRIX_ORDER: Final[tuple[str, ...]] = tuple(probe.probe_id for probe in CHAOS_MATRIX)


def _evidence(probe: ChaosProbe) -> dict[str, str]:
    return {
        "title": probe.title,
        "setup": probe.setup,
        "injection": probe.injection,
        "expected_invariant": probe.expected_invariant,
        "observation": probe.observation,
        "recovery": probe.recovery,
        "cleanup": probe.cleanup,
        "timeout_seconds": str(probe.timeout_seconds),
        "requires": ", ".join(sorted(probe.requires)),
        "fault_points": ", ".join(probe.fault_points) or "none",
    }


def run_matrix(
    *,
    injector: FailureInjector | None = None,
    availability: Iterable[str] = (),
    environment: str,
    generated_at: str,
    checks: Mapping[str, Callable[[], bool]] | None = None,
    tool: str = "wlct_trading.observability.chaos/1",
) -> MatrixReport:
    """Grade every probe in the matrix. Read-only, deterministic, and boring on purpose.

    ``availability`` is what the caller declares is reachable; it is a *set of names*, not a
    connection - the matrix has no idea how to reach anything and must never acquire the ability.
    ``checks`` maps probe id to a callable a harness owns. Passing a check that returns True grades
    ``pass`` with ``source="harness"``, which is the most a harness may claim.
    """

    if environment.strip().lower() in {"production", "prod"}:
        raise ChaosRefusedError(
            "the chaos matrix refuses to run in production: a failover probe is an outage, and the "
            "injection layer is read-only and construction-time-disabled there by Part 10's law"
        )
    if environment.strip().lower() not in {"local", "dev", "test", "ci", "staging", "simulation"}:
        raise ChaosRefusedError(
            f"unknown environment {environment!r}; the matrix names its playground so a typo cannot "
            "read as production-on-by-accident"
        )

    active = injector if injector is not None else disabled_injector()
    declared = frozenset(availability)
    unknown = declared - INFRASTRUCTURE
    if unknown:
        raise ChaosRefusedError(
            f"availability {sorted(unknown)} is outside the infrastructure vocabulary {sorted(INFRASTRUCTURE)}"
        )
    supplied = dict(checks or {})
    unknown_checks = set(supplied) - set(MATRIX_ORDER)
    if unknown_checks:
        raise ChaosRefusedError(f"checks supplied for unknown probes {sorted(unknown_checks)}")

    outcomes: list[ProbeOutcome] = []
    for probe in CHAOS_MATRIX:
        missing = sorted(probe.requires - declared)
        if missing:
            outcomes.append(
                ProbeOutcome(
                    probe_id=probe.probe_id,
                    grade="unverified",
                    reason="required infrastructure not available: " + ", ".join(missing),
                    source="none",
                    checks_run=0,
                    evidence=_evidence(probe),
                )
            )
            continue
        check = supplied.get(probe.probe_id)
        if check is None:
            armed = [point for point in probe.fault_points if active.is_armed(point)]
            outcomes.append(
                ProbeOutcome(
                    probe_id=probe.probe_id,
                    grade="planned",
                    reason=(
                        "no check supplied; the scenario is specified and its fault points are "
                        + ("armed" if armed else "not armed")
                        + " - a run without a check is a plan, not a result"
                    ),
                    source="none",
                    checks_run=0,
                    evidence=_evidence(probe),
                )
            )
            continue
        try:
            verdict = bool(check())
        except ChaosRefusedError:
            raise
        # A probe that raises has found something: the invariant it was checking did not hold, and
        # the exception text is the finding. Broad by design - a harness check may fail in whatever
        # way the thing it wraps fails - and ChaosRefusedError above is the one exception that is a
        # refusal rather than a result, so it propagates instead of being graded.
        except Exception as error:
            outcomes.append(
                ProbeOutcome(
                    probe_id=probe.probe_id,
                    grade="fail",
                    reason=f"check raised {type(error).__name__}: {error}",
                    source="harness",
                    checks_run=1,
                    evidence=_evidence(probe),
                )
            )
            continue
        outcomes.append(
            ProbeOutcome(
                probe_id=probe.probe_id,
                grade="pass" if verdict else "fail",
                reason="harness check returned " + ("true" if verdict else "false"),
                source="harness",
                checks_run=1,
                evidence=_evidence(probe),
            )
        )

    grades = {outcome.grade for outcome in outcomes}
    if "fail" in grades:
        overall = "fail"
    elif "unverified" in grades:
        overall = "unverified"
    elif "planned" in grades:
        overall = "planned"
    elif grades == {"skipped"} or not grades:
        overall = "skipped"
    else:
        overall = "pass"

    return MatrixReport(
        tool=tool,
        environment=environment,
        generated_at=generated_at,
        injector_enabled=active.enabled,
        armed_points=active.active_points(),
        availability=declared,
        outcomes=tuple(outcomes),
        grade=overall,
    )


def render_text(report: MatrixReport) -> str:
    """The human view. One line per probe, the grade law restated at the bottom."""

    return report.render_text()


_GRADE_EXIT: Final[Mapping[str, int]] = {"pass": 0, "fail": 1, "unverified": 2, "planned": 0, "skipped": 0}


def main(argv: list[str] | None = None) -> int:
    """``python3 -m wlct_trading.observability.chaos`` - a matrix run with no infrastructure.

    Which means: always unverified here, on purpose. The CLI exists so a staging harness can drive
    the same code path a human reads, and so "what would this platform check?" is answerable from a
    terminal instead of from a document. Exit codes follow the RLS helper's convention (0 pass, 1
    fail, 2 unverified) so one shell idiom reads every operational script here.
    """

    import argparse
    import json

    parser = argparse.ArgumentParser(prog="python3 -m wlct_trading.observability.chaos", description=__doc__.split("\n")[0])
    parser.add_argument("--environment", default="local")
    parser.add_argument("--availability", default="", help="comma-separated names from " + ", ".join(sorted(INFRASTRUCTURE)))
    parser.add_argument("--at", dest="generated_at", default=None, help="ISO timestamp for the report (default: caller supplies one)")
    parser.add_argument("--json", action="store_true", help="emit the machine-readable document")
    parser.add_argument("--list", action="store_true", help="print the matrix's scenarios and exit")
    args = parser.parse_args(argv)

    if args.list:
        for probe in CHAOS_MATRIX:
            print(f"{probe.probe_id:<24} requires={','.join(sorted(probe.requires)):<32} {probe.expected_invariant[:72]}…")
        return 0

    if args.generated_at is None:
        # No clock import in this module (the injector's law: no sleeping, no threading, and no
        # implicit "now" that would make a report unreproducible). A caller that wants a real
        # timestamp passes --at; a caller that does not gets an explicit marker.
        args.generated_at = "not-supplied"

    availability = frozenset(name.strip() for name in args.availability.split(",") if name.strip())
    try:
        report = run_matrix(
            environment=args.environment,
            generated_at=args.generated_at,
            availability=availability,
        )
    except ChaosRefusedError as error:
        print(f"refused: {error}")
        return 3
    if args.json:
        print(json.dumps(report.to_dict(), sort_keys=True))
    else:
        print(report.render_text())
    return _GRADE_EXIT.get(report.grade, 1)


if __name__ == "__main__":
    raise SystemExit(main())
