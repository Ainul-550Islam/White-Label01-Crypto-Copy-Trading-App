"""RED (rate / errors / duration) as a *view* over the metrics the platform already has.

Why a view and not a second system
---------------------------------
The repository already has an exposition path (Part 18), an alert engine with burn-rate rules
(Part 10), an SLO evaluation surface on the API side (Part 10), a normalized dashboard document
(:mod:`wlct_trading.observability.dashboard`), and a cardinality policy that refuses unbounded
labels. A RED "system" on top of that would be a second place for the same numbers to disagree. So
this module owns exactly one thing: the *reading* of request/error/duration families into rows a
dashboard already knows how to render, with the four states an operator actually needs told apart.

The states, and the reason each exists
--------------------------------------
``no-data``
    The family is not in the snapshot at all. Not "quiet": *nobody registered it*, which is a
    wiring fact and the answer a panel must not print as a green cell.
``zero-traffic``
    The family is registered, its series are present, and the counts are zero. A service at idle is
    healthy in a way a service with no telemetry is not, and collapsing those two is how an outage
    becomes invisible during the quiet hours that precede it.
``measured``
    Traffic present, no budget supplied, so the numbers are reported and *no verdict is offered*.
    This state is the no-invented-thresholds law made structural: there is no default error budget
    anywhere in this file, and a caller that wants a verdict has to bring one from the SLO or alert
    catalog that already exists.
``healthy`` / ``over-budget``
    Traffic present and a budget supplied, judged against that budget only.

``unavailable`` is not a state here: if metrics cannot be read, the caller has no snapshot, and a
module that invents a "metrics are down" row from inside the metrics path would be reporting on
itself. The health model already carries that fact (``wlct_component_health`` and the
``metrics_export_unavailable`` fault point), and the RED rows say ``no-data`` when the snapshot
arrives empty - which is the same sentence from the only vantage point this module has.

Cardinality and label law
-------------------------
Rows aggregate over label sets; they never emit a per-tenant, per-order, per-account or per-symbol
value. A RED row that carries an identifying label is how a dashboard becomes a data leak and a
metrics system becomes a cardrogenality bomb, so the aggregation is unconditional and tested.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from .dashboard import DashboardRow

__all__ = [
    "RED_STATES",
    "RedBudget",
    "RedObservation",
    "RedSurface",
    "red_document",
    "red_observations",
    "red_rows",
]

#: The closed state vocabulary. A state outside this set is a bug, not a string.
RED_STATES: Final[tuple[str, ...]] = ("no-data", "zero-traffic", "measured", "healthy", "over-budget")

#: The tones the dashboard document allows. Re-exported as a constant here so a test can pin that RED
#: never invents a tone the renderer does not know.
RED_TONES: Final[frozenset[str]] = frozenset({"ok", "warn", "bad", "neutral"})

_STATE_TONE: Final[Mapping[str, str]] = {
    "no-data": "warn",
    "zero-traffic": "neutral",
    "measured": "neutral",
    "healthy": "ok",
    "over-budget": "bad",
}


@dataclass(frozen=True, slots=True)
class RedSurface:
    """One request/error/duration triple, named from families that already exist.

    ``error_values`` is not optional and is not guessed: which label values count as errors is the
    service's own classification (the engine records ``result`` verdicts, the poller records cycle
    outcomes), and a RED view that decided "error" by pattern-matching label values would be
    silently redefining an incident whenever a service adds a verdict.
    """

    surface_id: str
    title: str
    request_family: str
    error_values: frozenset[str]
    result_label: str = "result"
    duration_family: str | None = None

    def __post_init__(self) -> None:
        if not self.surface_id or not self.title:
            raise ValueError("a RED surface needs an id and a title")
        if not self.request_family.startswith("wlct_"):
            raise ValueError(f"{self.surface_id}: request_family {self.request_family!r} is not a registered wlct_ family")
        if not isinstance(self.error_values, frozenset) or not self.error_values:
            raise ValueError(f"{self.surface_id}: error_values must be a non-empty frozenset of the service's own labels")
        if any(not value for value in self.error_values):
            raise ValueError(f"{self.surface_id}: error_values may not contain an empty label value")
        if self.duration_family is not None and not self.duration_family.startswith("wlct_"):
            raise ValueError(f"{self.surface_id}: duration_family must be a wlct_ family or None")
        if self.duration_family == self.request_family:
            raise ValueError(f"{self.surface_id}: a duration family distinct from the request family, or none")


@dataclass(frozen=True, slots=True)
class RedBudget:
    """A caller-supplied threshold, with its source named.

    ``source`` is required and must be non-empty: a threshold that cannot say where it came from is
    an invented one, and the whole point of this module is that RED does not invent thresholds.
    The SLO catalog and the alert rule set are the two legitimate sources in this platform.
    """

    max_error_ratio: float | None = None
    max_p99_micros: float | None = None
    source: str = ""

    def __post_init__(self) -> None:
        for name in ("max_error_ratio", "max_p99_micros"):
            value = getattr(self, name)
            if value is None:
                continue
            if value < 0:
                raise ValueError(f"{name} must be non-negative")
            if name == "max_error_ratio" and value > 1:
                raise ValueError("max_error_ratio is a ratio, so it must be within 0..1")
        if not self.source.strip():
            raise ValueError("a RED budget must name its source; an unsourced threshold is an invented one")


@dataclass(frozen=True, slots=True)
class RedObservation:
    """What one surface looked like in one snapshot."""

    surface_id: str
    state: str
    requests: float | None
    errors: float | None
    error_ratio: float | None
    duration_count: int | None
    duration_sum_micros: float | None
    reason: str
    budget_source: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "surface_id": self.surface_id,
            "state": self.state,
            "requests": self.requests,
            "errors": self.errors,
            "error_ratio": self.error_ratio,
            "duration_count": self.duration_count,
            "duration_sum_micros": self.duration_sum_micros,
            "reason": self.reason,
            "budget_source": self.budget_source,
        }


Snapshot = Mapping[str, Mapping[str, object]]


def _series_rows(snapshot: Snapshot, family: str) -> list[Mapping[str, object]] | None:
    family_data = snapshot.get(family)
    if not isinstance(family_data, Mapping):
        return None
    rows = family_data.get("series")
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        return []
    return [row for row in rows if isinstance(row, Mapping)]


def _sum_values(
    rows: Iterable[Mapping[str, object]],
    *,
    key: str = "value",
    where_label: tuple[str, frozenset[str]] | None = None,
) -> float:
    """Sum one numeric field over the series, optionally restricted to a label-value set.

    The filter is explicit (`where_label`) rather than "skip rows with an empty label": the first
    draft of this helper used the latter and summed nothing at all, because a series legitimately
    has no value for the label being probed. Silent-zero aggregation in a metrics path is exactly the
    class of bug a panel cannot catch later, so the shape of the filter is in the signature.
    """

    total = 0.0
    for row in rows:
        if where_label is not None:
            label, wanted = where_label
            if _label_of(row, label) not in wanted:
                continue
        value = row.get(key)
        if isinstance(value, (int, float)):
            total += float(value)
    return total


def _label_of(row: Mapping[str, object], label: str) -> str:
    """One label value out of a snapshot row, or the empty string.

    A helper because the snapshot is JSON-shaped (`Mapping[str, object]`): the narrowing has to
    happen on a local, and inlining `str(row["labels"].get(...))` reads fine at runtime and fails a
    type check, which is the combination that teaches a future editor to reach for a suppression
    instead of a variable.
    """

    labels = row.get("labels")
    if isinstance(labels, Mapping):
        return str(labels.get(label, ""))
    return ""


def _matches_label(rows: list[Mapping[str, object]], *, label: str, values: frozenset[str]) -> list[Mapping[str, object]]:
    return [row for row in rows if _label_of(row, label) in values]


def red_observations(
    snapshot: Snapshot,
    *,
    surfaces: Sequence[RedSurface],
    budgets: Mapping[str, RedBudget] | None = None,
) -> tuple[RedObservation, ...]:
    """Read the snapshot once per surface and produce the states. Pure: no registry, no clock."""

    budget_map = dict(budgets or {})
    unknown = set(budget_map) - {surface.surface_id for surface in surfaces}
    if unknown:
        raise ValueError(f"budgets supplied for surfaces that are not in play: {sorted(unknown)}")
    observations: list[RedObservation] = []
    for surface in surfaces:
        budget = budget_map.get(surface.surface_id)
        request_rows = _series_rows(snapshot, surface.request_family)
        if request_rows is None:
            observations.append(
                RedObservation(
                    surface_id=surface.surface_id,
                    state="no-data",
                    requests=None,
                    errors=None,
                    error_ratio=None,
                    duration_count=None,
                    duration_sum_micros=None,
                    reason=f"{surface.request_family} is not registered in this snapshot",
                )
            )
            continue

        requests = _sum_values(request_rows)  # every series contributes to the rate
        error_rows = _matches_label(request_rows, label=surface.result_label, values=surface.error_values)
        errors = _sum_values(error_rows)
        ratio = (errors / requests) if requests > 0 else None
        ratio = min(1.0, ratio) if ratio is not None else None

        duration_rows = _series_rows(snapshot, surface.duration_family) if surface.duration_family else None
        duration_count = int(_sum_values(duration_rows or [], key="count")) if duration_rows else None
        duration_sum = _sum_values(duration_rows or [], key="sumMicros") if duration_rows else None

        if requests == 0:
            state = "zero-traffic"
            reason = f"{surface.request_family} is registered with no observations yet"
        elif budget is None:
            state = "measured"
            reason = (
                f"{errors:.0f} of {requests:.0f} requests carry an error label; no budget supplied, "
                "so no verdict is offered"
            )
        else:
            breached: list[str] = []
            if budget.max_error_ratio is not None and ratio is not None and ratio > budget.max_error_ratio:
                breached.append(f"error ratio {ratio:.4f} exceeds {budget.max_error_ratio:.4f}")
            if (
                budget.max_p99_micros is not None
                and duration_count
                and duration_sum is not None
                and duration_sum / duration_count > budget.max_p99_micros
            ):
                breached.append(
                    f"mean duration {duration_sum / duration_count:.0f}us exceeds {budget.max_p99_micros:.0f}us"
                )
            state = "over-budget" if breached else "healthy"
            reason = "; ".join(breached) if breached else f"within budget from {budget.source}"

        observations.append(
            RedObservation(
                surface_id=surface.surface_id,
                state=state,
                requests=requests,
                errors=errors,
                error_ratio=ratio,
                duration_count=duration_count,
                duration_sum_micros=duration_sum,
                reason=reason,
                budget_source=budget.source if budget is not None else None,
            )
        )
    return tuple(observations)


def red_rows(observations: Iterable[RedObservation]) -> tuple[DashboardRow, ...]:
    """Render observations as rows in the document every operations view already consumes.

    Three rows per surface - rate, errors, duration - each labelled with the surface id, and the
    *state* carried in ``value`` so a UI that only knows label/value/tone shows the truth without a
    new section. ``detail`` carries the reason, which is where "why is this warn and not ok" lives.
    """

    rows: list[DashboardRow] = []
    for observation in observations:
        tone = _STATE_TONE.get(observation.state, "neutral")
        requests = "n/a" if observation.requests is None else f"{observation.requests:.0f}"
        errors = "n/a" if observation.errors is None else f"{observation.errors:.0f}"
        ratio = "n/a" if observation.error_ratio is None else f"{observation.error_ratio:.4f}"
        duration = (
            "n/a"
            if not observation.duration_count or observation.duration_sum_micros is None
            else f"{observation.duration_sum_micros / observation.duration_count:.0f}us mean over {observation.duration_count}"
        )
        rows.append(
            DashboardRow(
                label=f"{observation.surface_id} rate",
                value=f"{requests} ({observation.state})",
                detail=observation.reason,
                tone=tone,
            )
        )
        rows.append(
            DashboardRow(
                label=f"{observation.surface_id} errors",
                value=f"{errors} / ratio {ratio}",
                detail=f"budget: {observation.budget_source}" if observation.budget_source else "no budget supplied - verdict withheld",
                tone=tone,
            )
        )
        rows.append(
            DashboardRow(
                label=f"{observation.surface_id} duration",
                value=duration,
                detail="mean over the recorded observations; a histogram's mean is not a percentile",
                tone="neutral",
            )
        )
    return tuple(rows)


def red_document(
    snapshot: Snapshot,
    *,
    surfaces: Sequence[RedSurface],
    budgets: Mapping[str, RedBudget] | None = None,
) -> dict[str, object]:
    """The machine-readable form, for a status page or a CI job that has to decide something."""

    observations = red_observations(snapshot, surfaces=surfaces, budgets=budgets)
    states = {observation.state for observation in observations}
    overall = (
        "over-budget"
        if "over-budget" in states
        else "no-data"
        if "no-data" in states
        else "measured"
        if "measured" in states
        else "zero-traffic"
        if states == {"zero-traffic"}
        else "healthy"
    )
    return {
        "schema": "wlct.observability.red/1",
        "state": overall,
        # Printed inside the artifact so a screenshot of a panel cannot lose the definition of what
        # it is looking at, which is how "no-data" panels quietly become accepted background.
        "reading": (
            "no-data = not registered; zero-traffic = registered and idle; measured = numbers with no "
            "budget to judge them by; healthy/over-budget = judged against a caller-supplied budget"
        ),
        "surfaces": sorted({observation.surface_id for observation in observations}),
        "counts": {state: sum(1 for observation in observations if observation.state == state) for state in RED_STATES},
        "observations": [observation.to_dict() for observation in observations],
        "rows": [
            {"label": row.label, "value": row.value, "detail": row.detail, "tone": row.tone}
            for row in red_rows(observations)
        ],
    }


def validate_surfaces(surfaces: Sequence[RedSurface]) -> tuple[str, ...]:
    """The duplicate-surface law, exposed rather than hidden in a constructor.

    Two surfaces reading one family with different error label sets would produce two verdicts for
    one truth, so the combination of request family and error values has to be unique.
    """

    seen: set[tuple[str, frozenset[str]]] = set()
    problems: list[str] = []
    for surface in surfaces:
        key = (surface.request_family, surface.error_values)
        if key in seen:
            problems.append(f"{surface.surface_id}: re-declares {surface.request_family} with the same error labels")
        seen.add(key)
    return tuple(problems)
