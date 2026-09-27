"""The normalized dashboard document every operations view consumes.

Who reads what
--------------
The admin dashboard must not reach into Redis or Postgres directly (the spec
rule and the platform's own older rule, restated here in one place). It reads
*this* document, produced by whichever service owns the underlying state, in
a shape all services agree on: ten fixed sections, each a list of rows of
scalar fields. No nesting beyond that: a UI that has to walk a tree is a UI
that silently misses the third item of a page, and a JSON tree is where
undocumented fields go to accumulate secrets.

Section contract
----------------
Every row carries a ``label`` and a ``value`` (already string-shaped -
Decimals as strings, per platform discipline), optionally ``detail`` and
``tone`` (``"ok" | "warn" | "bad" | "neutral"``). Rows are capped per section
(``max_rows``, default 100): a truncation is itself a row saying so, because
a panel that quietly shows the first 100 of 4,000 stale feeds tells a
comfortable lie.

The document is *derived* state: built on request from a registry snapshot,
a health result set, the alert engine's active records and a readiness
verdict. It owns none of them, caches none of them, and its absence changes
nothing about trading - by construction, since nothing in the trading path
imports this module.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .redaction import redact_value

__all__ = ["SECTIONS", "DashboardBuilder", "DashboardRow"]

#: The fixed section list. Order is the panel order; adding a section is a
#: spec change, not a feature.
SECTIONS: tuple[str, ...] = (
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
)

_TONES: frozenset[str] = frozenset({"ok", "warn", "bad", "neutral"})


@dataclass(frozen=True, slots=True)
class DashboardRow:
    label: str
    value: str
    detail: str | None = None
    tone: str = "neutral"

    def to_dict(self) -> dict[str, str]:
        return {
            "label": self.label,
            "value": self.value,
            "detail": self.detail or "",
            "tone": self.tone,
        }


def _row(
    label: str, value: object, *, detail: object = None, tone: str = "neutral"
) -> DashboardRow:
    if tone not in _TONES:
        raise ValueError(f"unknown dashboard tone {tone!r}")
    redacted_value = redact_value("" if value is None else str(value))
    redacted_detail = redact_value(None if detail is None else str(detail))
    return DashboardRow(
        label=label,
        value=redacted_value if isinstance(redacted_value, str) else "[REDACTED]",
        detail=redacted_detail if isinstance(redacted_detail, str) else None,
        tone=tone,
    )


def _tone_for_status(status: Any) -> str:
    value = getattr(status, "value", status)
    return {
        "HEALTHY": "ok",
        "DEGRADED": "warn",
        "UNHEALTHY": "bad",
        "STOPPED": "neutral",
        "UNKNOWN": "warn",
    }.get(str(value), "neutral")


class DashboardBuilder:
    """Compose the document from the parts the service already has.

    Each ``build_*`` input is duck-typed against a narrow surface
    (``snapshot()``, ``results``, ``active()``, ``to_dict()``) so this module
    stays free of imports from the packages it reports on - the same
    one-way-dependency discipline used by the replay module in Part 8.
    """

    def __init__(self, *, service: str, max_rows_per_section: int = 100) -> None:
        if max_rows_per_section < 10:
            raise ValueError("max_rows_per_section must be at least 10")
        self._service = service
        self._max_rows = max_rows_per_section

    # ------------------------------------------------------------------
    def build(
        self,
        *,
        registry: Any,
        health_results: Sequence[Any] = (),
        alert_records: Sequence[Any] = (),
        readiness: Any = None,
        extras: Mapping[str, Sequence[DashboardRow]] | None = None,
    ) -> dict[str, Any]:
        """The full document. Empty inputs produce empty sections, not errors.

        A dashboard for a service with nothing registered yet is legitimately
        empty; refusing to render that would push the operator to read raw
        dumps instead, which is the one outcome worse than a blank panel.
        """
        snapshot = registry.snapshot() if registry is not None else {}
        sections: dict[str, list[DashboardRow]] = {name: [] for name in SECTIONS}

        self._fill_system(sections["SYSTEM"], health_results, readiness)
        self._fill_metrics_sections(sections, snapshot)
        self._fill_alerts(sections["ALERTS"], alert_records)
        if extras:
            for name, rows in extras.items():
                if name not in sections:
                    raise KeyError(f"extras name {name!r} is not a dashboard section")
                sections[name].extend(rows)

        rendered: dict[str, Any] = {}
        for name in SECTIONS:
            rows = sections[name]
            if len(rows) > self._max_rows:
                kept = rows[: self._max_rows]
                kept.append(
                    _row(
                        "truncated",
                        str(len(rows) - self._max_rows),
                        detail="rows beyond the section cap; query the source APIs",
                        tone="warn",
                    )
                )
                rows = kept
            rendered[name] = [row.to_dict() for row in rows]

        return {
            "service": self._service,
            "sections": rendered,
            "note": (
                "Derived operational view. Every value here is a mirror of "
                "engine state at scrape time; this document is not a source "
                "of financial truth and grants nothing."
            ),
        }

    # ------------------------------------------------------------------
    def _fill_system(
        self, rows: list[DashboardRow], health_results: Sequence[Any], readiness: Any
    ) -> None:
        for result in health_results:
            rows.append(
                _row(
                    str(result.component),
                    str(getattr(result.status, "value", result.status)),
                    detail=getattr(result, "reason", None),
                    tone=_tone_for_status(result.status),
                )
            )
        if readiness is not None:
            rows.append(
                _row(
                    "tradingReady",
                    "true" if readiness.ready else "false",
                    detail="; ".join(f"{g.name}: {g.reason}" for g in readiness.gates if not g.satisfied)
                    or "all gates satisfied",
                    tone="ok" if readiness.ready else "bad",
                )
            )

    def _fill_metrics_sections(self, sections: dict[str, list[DashboardRow]], snapshot: Mapping[str, Any]) -> None:
        """Route the registry's families into sections by name prefix.

        ``wlct_market_*`` -> MARKET_DATA and so on. The routing table is
        *here*, explicit, rather than being derived from label values -
        "which section does this metric belong to" is product knowledge and
        lives with the product.
        """
        route = {
            "wlct_market_": "MARKET_DATA",
            "wlct_strategy_": "STRATEGIES",
            "wlct_risk_": "RISK",
            "wlct_execution_": "EXECUTION",
            "wlct_orders_": "ORDERS",
            "wlct_positions_": "POSITIONS",
            "wlct_queue_": "QUEUES",
            "wlct_dataset_": "DATASETS",
        }
        for name, family in snapshot.items():
            for prefix, section in route.items():
                if not name.startswith(prefix):
                    continue
                for series in family["series"]:
                    labels = series["labels"]
                    label_bits = "/".join(
                        value for value in labels.values() if value not in ("live", "simulated")
                    )
                    if family["type"] == "histogram":
                        rows_label = f"{name.split('_', 2)[-1]} [{label_bits}]"
                        rows_label = rows_label.replace("/simulated", " (simulated)").replace(
                            "/live", " (live)"
                        )
                        sections[section].append(
                            _row(
                                rows_label,
                                f"n={series['count']}",
                                detail=f"sum micros {series['sumMicros']}",
                            )
                        )
                    else:
                        suffix = label_bits or name
                        sections[section].append(
                            _row(name.split("_", 2)[-1], str(series["value"]), detail=suffix)
                        )

    def _fill_alerts(self, rows: list[DashboardRow], alert_records: Sequence[Any]) -> None:
        for record in alert_records:
            severity = str(getattr(record.severity, "value", record.severity))
            tone = {
                "INFO": "neutral",
                "WARNING": "warn",
                "CRITICAL": "bad",
                "EMERGENCY": "bad",
            }.get(severity, "neutral")
            scope = record.scope or "platform"
            rows.append(
                _row(
                    f"{record.rule_id} [{record.component}/{scope}]",
                    f"{severity} x{record.occurrences}",
                    detail=record.message,
                    tone=tone,
                )
            )
