"""Incident context: grouping correlated evidence without owning it.

An *alert* is one condition on one component; an *incident* is the story an
operator reads: "the BTC book went stale, so risk refused the next three
sends, the execution queue backed up behind retries, and here are the
ids of all of it, in order." Building that story by hand during an outage is
how outages get longer, so the engine assembles a skeleton at fault time and
the persistence layer (Part 9's API tables) stores the links.

Design constraints, in order of how much they matter:

* **Audit-only.** This module reads and groups; it never triggers actions.
  No import from ``wlct_trading.execution``, ``.risk``, or ``.adapters`` -
  a package-boundary test enforces it, because an "observability" module
  that can reach the trading path is a bypass waiting to be discovered.
* **References, never copies.** Links carry ``kind`` + ``target_id``: the
  risk event's id, the audit row's id, the order's id. The incident does
  not embed payloads - payloads are where the money-shaped secrets live, and
  an incident table that copies them is an unredacted shadow log.
* **Correlation identity.** An incident is keyed by ``correlation_id`` when
  one exists (the chain built by :mod:`.correlation`), falling back to a
  deterministic digest of its member links, so the same grouping from the
  same evidence is reproducible - which is exactly what the integration test
  pins and what an operator cross-referencing log lines needs.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from enum import Enum
from typing import Any

__all__ = [
    "IncidentLinkKind",
    "IncidentStatus",
    "IncidentLink",
    "IncidentContext",
    "build_incident",
    "links_from_events",
]


class IncidentLinkKind(str, Enum):
    """What an incident may point at. Mirrors the PG enum exactly."""

    ALERT = "ALERT"
    RISK_EVENT = "RISK_EVENT"
    AUDIT = "AUDIT"
    ORDER = "ORDER"
    EXECUTION_INCIDENT = "EXECUTION_INCIDENT"
    STRATEGY_EVENT = "STRATEGY_EVENT"
    MARKET_DATA_FAULT = "MARKET_DATA_FAULT"
    QUEUE_JOB = "QUEUE_JOB"


class IncidentStatus(str, Enum):
    OPEN = "OPEN"
    REVIEWING = "REVIEWING"
    CLOSED = "CLOSED"


_ID_PATTERN_CHARS = set(
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ._:/-"
)


@dataclass(frozen=True, slots=True)
class IncidentLink:
    kind: IncidentLinkKind
    target_id: str
    note: str | None = None

    def __post_init__(self) -> None:
        if not self.target_id or len(self.target_id) > 128:
            raise ValueError("link target ids are required and bounded (<=128 chars)")
        if any(char not in _ID_PATTERN_CHARS for char in self.target_id):
            raise ValueError(
                "link target ids are identifiers only - no whitespace, no "
                "free text: this field is rendered in the incident panel"
            )
        if self.note is not None and len(self.note) > 255:
            raise ValueError("link notes are bounded to 255 characters")

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "targetId": self.target_id,
            "note": self.note,
        }

    @staticmethod
    def from_dict(payload: Mapping[str, Any]) -> "IncidentLink":
        return IncidentLink(
            kind=IncidentLinkKind(str(payload["kind"])),
            target_id=str(payload["targetId"]),
            note=payload.get("note"),
        )


@dataclass(frozen=True, slots=True)
class IncidentContext:
    """The assembled correlation skeleton for one operational story."""

    incident_id: str
    title: str
    status: IncidentStatus
    correlation_id: str | None
    operation_id: str | None
    opened_at_micros: int
    links: tuple[IncidentLink, ...]
    #: Dedupe key the persistence layer upserts against: one incident per
    #: story, occurrences folded - same philosophy as the alert engine.
    grouping_key: str

    def link(self, link: IncidentLink) -> "IncidentContext":
        """Add a link if not already present; return the (possibly new) value."""
        if any(
            existing.kind is link.kind and existing.target_id == link.target_id
            for existing in self.links
        ):
            return self
        return replace(self, links=(*self.links, link))

    def with_status(self, status: IncidentStatus) -> "IncidentContext":
        return replace(self, status=status)

    def to_dict(self) -> dict[str, Any]:
        return {
            "incidentId": self.incident_id,
            "title": self.title,
            "status": self.status.value,
            "correlationId": self.correlation_id,
            "operationId": self.operation_id,
            "openedAtMicros": self.opened_at_micros,
            "groupingKey": self.grouping_key,
            "links": [link.to_dict() for link in self.links],
        }


def links_from_events(
    kind: IncidentLinkKind,
    events: Iterable[Mapping[str, Any] | object],
    *,
    id_field: str = "id",
) -> tuple[IncidentLink, ...]:
    """Map a batch of events to links, tolerating absent ids.

    Producers differ in shape - some hand dicts with ``incidentId``, others
    hand frozen dataclasses with ``event_id`` - so mapping rows use ``get``
    and objects use attribute access. Entries without the named field are
    skipped, and skipping is visible as a count difference, never hidden.
    """
    links: list[IncidentLink] = []
    for event in events:
        target = event.get(id_field) if isinstance(event, Mapping) else getattr(event, id_field, None)
        if isinstance(target, str) and target:
            try:
                links.append(IncidentLink(kind=kind, target_id=target))
            except ValueError:
                # An id-shaped-but-invalid value means someone's payload is
                # malformed; dropping the link (not the batch) keeps one bad
                # row from losing the rest of the story.
                continue
    return tuple(links)


def _digest_grouping(links: Sequence[IncidentLink]) -> str:
    h = hashlib.sha256()
    for link in sorted(links, key=lambda item: (item.kind.value, item.target_id)):
        h.update(f"{link.kind.value}|{link.target_id};".encode("utf-8"))
    return h.hexdigest()[:24]


def build_incident(
    *,
    title: str,
    links: Sequence[IncidentLink],
    correlation_id: str | None = None,
    operation_id: str | None = None,
    opened_at_micros: int,
    status: IncidentStatus = IncidentStatus.OPEN,
) -> IncidentContext:
    """Assemble one incident from its links.

    ``title`` is the panel headline only; anything secret-shaped belongs in
    the linked records, not here (bounded check below keeps it honest).
    """
    if not title or len(title) > 200:
        raise ValueError("incident titles are required and bounded to 200 characters")
    if len(links) > 512:
        raise ValueError(
            "an incident links to at most 512 records; beyond that the story is"
            " a dataset and should be queried as one"
        )
    ordered = tuple(sorted(links, key=lambda item: (item.kind.value, item.target_id)))
    grouping = (
        f"correlation:{correlation_id}"
        if correlation_id is not None
        else f"links:{_digest_grouping(ordered)}"
    )
    ident_source = f"{grouping}|{opened_at_micros}"
    incident_id = f"inc_{hashlib.sha256(ident_source.encode('utf-8')).hexdigest()[:20]}"
    return IncidentContext(
        incident_id=incident_id,
        title=title,
        status=status,
        correlation_id=correlation_id,
        operation_id=operation_id,
        opened_at_micros=opened_at_micros,
        links=ordered,
        grouping_key=grouping,
    )
