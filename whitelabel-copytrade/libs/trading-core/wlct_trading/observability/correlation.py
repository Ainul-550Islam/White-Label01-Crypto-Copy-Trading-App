"""Correlation context: the identifiers that must travel, and nothing else.

The chain this supports
----------------------
``HTTP request -> service -> queue job -> strategy -> risk -> execution ->
audit`` - one ``correlation_id`` across the whole ride, an ``operation_id``
per logical unit of work inside it (a batch, a session, a single order
attempt), and the entity ids (tenant, account, strategy, order, risk
decision) filled in as they become known. The Node side sets the same
headers and the same field names (``correlationId`` on the wire,
``correlation_id`` in structured logs); fixtures pin the shared patterns.

Rules, enforced here rather than hoped for:

* **Allow-listed keys.** The context has fields, not arbitrary attachments -
  an open dict would end up with a secret in it by lunchtime.
* **Wire-token validation.** Every bound value must match the same bounded
  pattern used for metric labels; log-injection through a "correlation id"
  that contains newlines, control bytes or a payload is refused at bind
  time, loudly.
* **Immutable context, copy-on-bind.** ``with bind(...)`` layers ids for a
  scope; nothing mutates a shared one across tasks.
* **contextvars.** Task-local by construction, so asyncio fan-out cannot
  bleed one request's ids into another's log lines - the failure mode of a
  module-global dict that "just remembers" the current request.

A deliberately small thing, so a full tracing backend (OpenTelemetry) can
be laid over it later: the payload here is the *minimum* the OTel
propagators carry anyway, and ``to_queue_payload`` / ``from_queue_payload``
mark exactly where an OTel context would ride alongside.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, fields, replace
from typing import Any, Iterator

__all__ = [
    "CORRELATION_FIELDS",
    "CorrelationContext",
    "current_context",
    "bind",
    "to_log_fields",
    "LoggingCorrelationFilter",
    "from_queue_payload",
]

#: Value pattern shared with the metric-label policy: bounded, no
#: whitespace, no control characters. UUIDs and platform ids pass; free
#: text and adversarial input do not.
_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,63}$")

#: The only fields that exist. Extending this tuple is a deliberate,
#: reviewed act (it widens what can ride through every boundary).
CORRELATION_FIELDS: tuple[str, ...] = (
    "request_id",
    "correlation_id",
    "operation_id",
    "tenant_id",
    "account_id",
    "strategy_id",
    "order_id",
    "risk_decision_id",
)


@dataclass(frozen=True, slots=True)
class CorrelationContext:
    """One immutable snapshot of "where am I" for the code reading the logs."""

    request_id: str | None = None
    correlation_id: str | None = None
    operation_id: str | None = None
    tenant_id: str | None = None
    account_id: str | None = None
    strategy_id: str | None = None
    order_id: str | None = None
    risk_decision_id: str | None = None

    def merged(self, **updates: str | None) -> "CorrelationContext":
        """Copy with non-``None`` updates; validated. Never mutates ``self``.

        Passing ``None`` for a field leaves it untouched - "clear" is not an
        operation the context supports, because the only safe clearing is
        exiting the ``with bind(...)`` scope that set it.
        """
        clean: dict[str, str] = {}
        for key, value in updates.items():
            if value is None:
                continue
            if key not in CORRELATION_FIELDS:
                raise KeyError(
                    f"{key!r} is not a correlation field; correlation context is "
                    "allow-listed and never carries arbitrary attachments"
                )
            if not _VALUE_PATTERN.fullmatch(value):
                raise ValueError(
                    f"{key!r}={value!r} is not a bounded wire token; identifiers "
                    "go in the clear only in their platform-owned form"
                )
            clean[key] = value
        return replace(self, **clean) if clean else self

    def to_log_fields(self) -> dict[str, str]:
        """The snake_case extras every structured log line may carry."""
        return {
            f.name: getattr(self, f.name)
            for f in fields(self)
            if getattr(self, f.name) is not None
        }

    def to_queue_payload(self) -> dict[str, str]:
        """The camelCase wire form injected into a queue job payload.

        Key name is fixed - the Node producer (``AuditContextInterceptor``
        era) and the Python consumer both speak ``x-correlation`` so neither
        has to guess; an OpenTelemetry context would be added *here*, next
        to it, in a future that has a tracer.
        """
        payload: dict[str, str] = {}
        if self.request_id is not None:
            payload["requestId"] = self.request_id
        if self.correlation_id is not None:
            payload["correlationId"] = self.correlation_id
        if self.operation_id is not None:
            payload["operationId"] = self.operation_id
        if self.tenant_id is not None:
            payload["tenantId"] = self.tenant_id
        if self.account_id is not None:
            payload["accountId"] = self.account_id
        if self.strategy_id is not None:
            payload["strategyId"] = self.strategy_id
        if self.order_id is not None:
            payload["orderId"] = self.order_id
        if self.risk_decision_id is not None:
            payload["riskDecisionId"] = self.risk_decision_id
        return payload


_EMPTY = CorrelationContext()

_CONTEXT: ContextVar[CorrelationContext] = ContextVar("wlct_correlation", default=_EMPTY)


def current_context() -> CorrelationContext:
    """The active context; an empty one outside any request, never ``None``."""
    return _CONTEXT.get()


@contextmanager
def bind(**ids: str | None) -> Iterator[CorrelationContext]:
    """Enter a scope with additional correlation ids bound.

    Nesting layers; leaving restores exactly the previous context via the
    contextvar token - no global-state whack-a-mole, no leaked ids across
    tasks.
    """
    updated = _CONTEXT.get().merged(**ids)
    token: Token[CorrelationContext] = _CONTEXT.set(updated)
    try:
        yield updated
    finally:
        _CONTEXT.reset(token)


def to_log_fields() -> dict[str, str]:
    """Convenience: current context's fields for ``extra=`` dicts."""
    return _CONTEXT.get().to_log_fields()


class LoggingCorrelationFilter(logging.Filter):
    """Injects correlation fields into every record that passes through.

    Attached once in each service's ``configure_logging``; provider code
    never sprinkles ids by hand again. Values already present on the record
    win - an explicit ``extra`` at the call site is closer to the truth than
    ambient context - and the redaction of anything else the record carries
    stays the redaction filter's job, not this one's.
    """

    def __init__(self, name: str = "") -> None:
        super().__init__(name)

    def filter(self, record: logging.LogRecord) -> bool:
        context = _CONTEXT.get()
        if context is _EMPTY:
            return True
        for key, value in context.to_log_fields().items():
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


def from_queue_payload(payload: Mapping[str, Any] | None) -> dict[str, str | None]:
    """Extract correlation ids from a queue job payload, defensively.

    Unknown shapes yield an empty dict - a job produced before this part
    exists carries nothing, and that is normal, not an error. Values that
    fail the token pattern are dropped *individually* rather than rejecting
    the whole envelope: one poisoned field must not blind the log line of
    the other seven.
    """
    if not isinstance(payload, Mapping):
        return {}
    wire = {
        "request_id": "requestId",
        "correlation_id": "correlationId",
        "operation_id": "operationId",
        "tenant_id": "tenantId",
        "account_id": "accountId",
        "strategy_id": "strategyId",
        "order_id": "orderId",
        "risk_decision_id": "riskDecisionId",
    }
    out: dict[str, str | None] = {}
    for field_name, key in wire.items():
        value = payload.get(key)
        if isinstance(value, str) and _VALUE_PATTERN.fullmatch(value):
            out[field_name] = value
    return out
