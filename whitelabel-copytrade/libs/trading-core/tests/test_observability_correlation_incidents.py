"""Correlation context and incident grouping.

The properties under test are the ones the integration story depends on:
ids survive async boundaries and queue hops, refuse anything that is not an
identifier, never clobber each other across tasks - and incidents link to
records without absorbing them.
"""

from __future__ import annotations

import asyncio
import logging

import pytest

from wlct_trading.observability.correlation import (
    CORRELATION_FIELDS,
    CorrelationContext,
    LoggingCorrelationFilter,
    bind,
    current_context,
    from_queue_payload,
    to_log_fields,
)
from wlct_trading.observability.incidents import (
    IncidentContext,
    IncidentLink,
    IncidentLinkKind,
    IncidentStatus,
    build_incident,
    links_from_events,
)

NOW = 1_700_000_000_000_000


# ---------------------------------------------------------------------------
# correlation
# ---------------------------------------------------------------------------
def test_fields_are_the_specified_set() -> None:
    assert set(CORRELATION_FIELDS) == {
        "request_id",
        "correlation_id",
        "operation_id",
        "tenant_id",
        "account_id",
        "strategy_id",
        "order_id",
        "risk_decision_id",
    }


def test_bind_nests_and_restores() -> None:
    assert current_context() == CorrelationContext()
    with bind(correlation_id="corr-1") as outer:
        assert outer.correlation_id == "corr-1"
        with bind(order_id="ord-77"):
            assert current_context().order_id == "ord-77"
            assert current_context().correlation_id == "corr-1"
        assert current_context().order_id is None
    assert current_context().correlation_id is None


def test_none_updates_are_noops_not_clearings() -> None:
    with bind(tenant_id="t-1"):
        inner = current_context().merged(tenant_id=None)
        assert inner.tenant_id == "t-1"


def test_arbitrary_keys_are_refused() -> None:
    with pytest.raises(KeyError, match="allow-listed"):
        CorrelationContext().merged(password="hunter2")


@pytest.mark.parametrize(
    "value",
    ["", "has space", "line\nbreak", "x" * 65, "quote'd", 'tab\there'],
)
def test_malicious_or_unbounded_values_refused(value: str) -> None:
    with pytest.raises(ValueError, match="wire token"):
        CorrelationContext().merged(correlation_id=value)


def test_queue_payload_roundtrip() -> None:
    ctx = CorrelationContext(
        request_id="req-1",
        correlation_id="corr-1",
        operation_id="op-1",
        tenant_id="ten-1",
        order_id="ord-1",
        risk_decision_id="rd-1",
    )
    payload = ctx.to_queue_payload()
    assert payload["correlationId"] == "corr-1"
    assert "strategyId" not in payload  # absent stays absent
    back = from_queue_payload(payload)
    assert back == {
        "request_id": "req-1",
        "correlation_id": "corr-1",
        "operation_id": "op-1",
        "tenant_id": "ten-1",
        "order_id": "ord-1",
        "risk_decision_id": "rd-1",
    }


def test_queue_extraction_drops_only_bad_fields() -> None:
    payload = {"correlationId": "corr-1", "requestId": "not a token!!", "tenantId": "t-1"}
    out = from_queue_payload(payload)
    assert out == {"correlation_id": "corr-1", "tenant_id": "t-1"}


def test_queue_extraction_tolerates_garbage_envelopes() -> None:
    assert from_queue_payload(None) == {}
    assert from_queue_payload("nonsense") == {}
    assert from_queue_payload({"unrelated": 1}) == {}


def test_logging_filter_injects_without_clobbering_explicit_fields() -> None:
    record = logging.LogRecord(
        name="x", level=logging.INFO, pathname="", lineno=0, msg="hi",
        args=(), exc_info=None,
    )
    record_extra = logging.LogRecord(
        name="x", level=logging.INFO, pathname="", lineno=0, msg="hi",
        args=(), exc_info=None,
    )
    setattr(record_extra, "correlation_id", "explicit-wins")
    filter_ = LoggingCorrelationFilter()
    with bind(correlation_id="ambient", tenant_id="t-9"):
        assert filter_.filter(record)
        assert filter_.filter(record_extra)
    assert getattr(record, "correlation_id") == "ambient"
    assert getattr(record, "tenant_id") == "t-9"
    assert getattr(record_extra, "correlation_id") == "explicit-wins"


def test_filter_is_passive_outside_request_scopes() -> None:
    record = logging.LogRecord(
        name="x", level=logging.INFO, pathname="", lineno=0, msg="hi", args=(), exc_info=None
    )
    assert LoggingCorrelationFilter().filter(record)
    assert not hasattr(record, "correlation_id")


def test_log_fields_use_snake_case_only_present_ids() -> None:
    with bind(correlation_id="c1", strategy_id="s1"):
        fields = to_log_fields()
    assert fields == {"correlation_id": "c1", "strategy_id": "s1"}


def test_tasks_do_not_bleed_contexts() -> None:
    # The repository convention for async is an explicit asyncio.run in a
    # sync test; contextvars propagation across tasks is exactly what this
    # covers, so no pytest-asyncio needed.
    seen: dict[str, str | None] = {}

    async def worker(tag: str, correlation: str) -> None:
        with bind(correlation_id=correlation):
            await asyncio.sleep(0.01)  # force interleaving
            seen[tag] = current_context().correlation_id

    async def scenario() -> None:
        await asyncio.gather(worker("a", "corr-a"), worker("b", "corr-b"))

    asyncio.run(scenario())
    assert seen == {"a": "corr-a", "b": "corr-b"}


# ---------------------------------------------------------------------------
# incidents
# ---------------------------------------------------------------------------
def test_link_target_validation() -> None:
    IncidentLink(kind=IncidentLinkKind.ORDER, target_id="ord_01ABC")
    with pytest.raises(ValueError, match="identifiers only"):
        IncidentLink(kind=IncidentLinkKind.ORDER, target_id="order one; DROP")
    with pytest.raises(ValueError, match="bounded"):
        IncidentLink(kind=IncidentLinkKind.ORDER, target_id="")


def test_build_incident_is_deterministic_and_sorted() -> None:
    links = [
        IncidentLink(IncidentLinkKind.RISK_EVENT, "re-2"),
        IncidentLink(IncidentLinkKind.ALERT, "al-1"),
        IncidentLink(IncidentLinkKind.RISK_EVENT, "re-1"),
    ]
    first = build_incident(
        title="stale book cascade", links=links, opened_at_micros=NOW, correlation_id="corr-1"
    )
    second = build_incident(
        title="stale book cascade",
        links=list(reversed(links)),
        opened_at_micros=NOW,
        correlation_id="corr-1",
    )
    assert first == second
    pairs = [(link.kind, link.target_id) for link in first.links]
    assert pairs == sorted(pairs, key=lambda item: (item[0].value, item[1]))
    assert first.grouping_key == "correlation:corr-1"


def test_grouping_without_correlation_falls_back_to_link_digest() -> None:
    links = [IncidentLink(IncidentLinkKind.ALERT, "al-1")]
    a = build_incident(title="t", links=links, opened_at_micros=NOW)
    b = build_incident(title="t", links=list(reversed(links)), opened_at_micros=NOW)
    assert a.grouping_key == b.grouping_key
    assert a.incident_id == b.incident_id
    assert a.grouping_key.startswith("links:")


def test_link_method_dedupes_and_extends() -> None:
    base = build_incident(
        title="t", links=[IncidentLink(IncidentLinkKind.ALERT, "al-1")], opened_at_micros=NOW
    )
    same = base.link(IncidentLink(IncidentLinkKind.ALERT, "al-1"))
    assert same is base
    grown = base.link(IncidentLink(IncidentLinkKind.ORDER, "or-9"))
    assert len(grown.links) == 2
    assert isinstance(grown, IncidentContext)


def test_status_transition_by_replacement() -> None:
    base = build_incident(title="t", links=[], opened_at_micros=NOW)
    assert base.status is IncidentStatus.OPEN
    reviewing = base.with_status(IncidentStatus.REVIEWING)
    assert reviewing.status is IncidentStatus.REVIEWING
    assert base.status is IncidentStatus.OPEN  # immutable; no mutation


def test_links_from_events_skips_malformed_rows() -> None:
    events = [{"id": "e1"}, {"id": ""}, {"other": "x"}, {"id": "e2"}]
    links = links_from_events(IncidentLinkKind.RISK_EVENT, events)
    assert [link.target_id for link in links] == ["e1", "e2"]


def test_link_volume_is_bounded() -> None:
    links = [IncidentLink(IncidentLinkKind.QUEUE_JOB, f"j{i}") for i in range(513)]
    with pytest.raises(ValueError, match="at most 512"):
        build_incident(title="too many", links=links, opened_at_micros=NOW)


def test_serialisation_roundtrip() -> None:
    incident = build_incident(
        title="t",
        links=[IncidentLink(IncidentLinkKind.AUDIT, "au-1", note="context only")],
        opened_at_micros=NOW,
        correlation_id="c",
        operation_id="o",
    )
    payload = incident.to_dict()
    assert payload["links"][0]["kind"] == "AUDIT"
    assert payload["links"][0]["note"] == "context only"
    assert IncidentLink.from_dict(payload["links"][0]) == incident.links[0]


def test_incident_holds_no_payloads() -> None:
    # The fields on IncidentContext are ids and strings only; a dict-valued
    # field would mean the class grew a payload-carrying hole. This is a
    # compile-of-the-design check: adding a Mapping field must fail review.
    for field_obj in IncidentContext.__dataclass_fields__.values():
        assert field_obj.type in {
            "str",
            "str | None",
            "int",
            "IncidentStatus",
            "tuple[IncidentLink, ...]",
        }, f"incident field {field_obj.name} gained type {field_obj.type}"
