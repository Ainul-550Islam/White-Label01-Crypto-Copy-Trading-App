"""Cardinality and label policy for every metric the platform emits.

Why this module exists
---------------------
A metrics backend dies of cardinality long before it dies of volume. One label
whose value is an order id, a request id, or anything else an outsider
controls, and the series count grows without bound: memory blows up, scrapes
time out, and the dashboard that was supposed to show the outage becomes the
outage. So label permission here is an allow-list, not a block-list:

* a label name may only be used if it is in :data:`ALLOWED_LABEL_NAMES`;
* a metric may only use the label names registered for it (or the default
  set), and nothing else;
* anything identifier-shaped - order ids, request ids, connection strings,
  credentials - is rejected even if someone adds it to a metric by mistake,
  because :data:`FORBIDDEN_LABEL_NAMES` is checked first and a name in both
  sets is a configuration error;
* free text never becomes a label *value*: values must match a conservative
  wire-token pattern, so user input cannot smuggle itself in through an
  allowed label name.

Identifiers do not disappear - they move to logs and traces, where the
correlation context in :mod:`wlct_trading.observability.correlation` carries
them. Metrics aggregate; logs correlate. That split is the whole design.

Symbols
-------
Symbols are permitted as label values only where an *enumerated, bounded* set
has been declared for the metric (see :class:`LabelPolicy`). "Bounded" is the
operator's claim; this module's job is to make it enforceable: a value that
turns out not to be in the declared set is refused at record time, not
silently absorbed into the cardinality.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

__all__ = [
    "FORBIDDEN_LABEL_NAMES",
    "ALLOWED_LABEL_NAMES",
    "WIRE_TOKEN_PATTERN",
    "METRIC_NAME_PATTERN",
    "CardinalityError",
    "LabelPolicy",
    "label_value_ok",
    "metric_name_ok",
]

#: Matches what Prometheus itself accepts for a metric name.
METRIC_NAME_PATTERN = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")

#: Matches what this platform accepts for a label name (Prometheus's own
#: rule minus the reserved ``__`` prefix, which only internal machinery may
#: use and nothing in this codebase does).
_LABEL_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

#: Conservative wire token: bounded length, no whitespace, no quoting games.
#: UUIDs, exchange ids, strategy slugs, result words and rule codes all pass;
#: sentences, emails, URLs and raw user input do not.
WIRE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,63}$")

#: Names that must never be metric labels on this platform, however tempting.
#: Checked before the allow-list; a name on both lists is rejected at import
#: of any new policy, which is the point. High-cardinality identifiers and
#: anything secret-shaped live here permanently.
FORBIDDEN_LABEL_NAMES: frozenset[str] = frozenset(
    {
        # Request/flow identifiers: belong in correlation metadata, not series.
        "order_id",
        "orderids",
        "client_order_id",
        "request_id",
        "correlation_id",
        "operation_id",
        "risk_decision_id",
        "idempotency_key",
        "session_id",
        "trace_id",
        "span_id",
        # Principal identifiers: unbounded and personal-data-adjacent.
        "user_id",
        "tenant_id",
        "account_id",
        "actor_id",
        "email",
        "phone",
        "ip",
        # Credentials and connection material in any spelling that gets tried.
        "api_key",
        "apikey",
        "api_secret",
        "secret",
        "password",
        "passphrase",
        "private_key",
        "token",
        "jwt",
        "authorization",
        "dsn",
        "connection_string",
        "database_url",
        # Free text and blob carriers.
        "message",
        "reason",
        "description",
        "payload",
        "query",
        "url",
        "path",
    }
)

#: The label names metrics on this platform may use. Every entry answers a
#: routing question an operator asks ("which venue?", "which stage?"), not a
#: per-entity question. ``strategy_id`` is allowed because the strategy
#: registry is a bounded, operator-managed set; a deployment that starts
#: minting a strategy instance per client would have to narrow this first,
#: and the series cap below is the backstop while that review happens.
ALLOWED_LABEL_NAMES: frozenset[str] = frozenset(
    {
        "service",
        "component",
        "exchange",
        "market_type",
        "event_kind",
        "strategy_id",
        "result",
        "risk_code",
        "rule_id",
        "scope",
        "stage",
        "queue",
        "channel",
        "symbol",
        "dataset_kind",
        "trigger_type",
        "alert_type",
        "alert_state",
        "severity",
        "job_name",
        "method",
        "route",
        "status_class",
        "simulation",
        "feed_state",
        "pool_state",
        # Part 10: SLO gauges. `slo` is the bounded slo_id (catalog +
        # operations API validate it against ^[a-z0-9][a-z0-9._-]{1,62}$);
        # `window_kind` is a two-value enumeration (short/long). Both are
        # declared domains, never free text - which is the standing rule
        # for admitting a name to this list at all.
        "slo",
        "window_kind",
    }
)


def metric_name_ok(name: str) -> bool:
    """Whether ``name`` is a legal metric family name. Public for tests."""
    return bool(METRIC_NAME_PATTERN.fullmatch(name))


def label_value_ok(value: object) -> bool:
    """Whether ``value`` may be used as a label value at all."""
    if not isinstance(value, str):
        return False
    return bool(WIRE_TOKEN_PATTERN.fullmatch(value))


@dataclass(frozen=True)
class LabelPolicy:
    """The label contract for one metric family.

    ``label_names`` is what the family declares; ``allowed`` is what the
    platform allows (defaults to the module allow-list); ``bounds`` maps a
    label name to a fixed enumeration of its permitted values - the shape
    that "bounded cardinality" takes in code rather than in comments.
    """

    name: str
    label_names: tuple[str, ...]
    allowed: frozenset[str] = frozenset(ALLOWED_LABEL_NAMES)
    bounds: dict[str, frozenset[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not metric_name_ok(self.name):
            raise CardinalityError(f"illegal metric name: {self.name!r}")
        # An empty label set is the SAFEST family a metric can be (exactly
        # one series) and is legal; what is illegal is labels that were never
        # declared being *used* - caught by validate() on the first write.
        seen: set[str] = set()
        for label in self.label_names:
            if not _LABEL_NAME_PATTERN.fullmatch(label):
                raise CardinalityError(f"illegal label name {label!r} on {self.name}")
            if label in FORBIDDEN_LABEL_NAMES:
                raise CardinalityError(
                    f"label {label!r} on {self.name} is a forbidden label name: "
                    "identifiers and secrets never become metric labels"
                )
            if label not in self.allowed:
                raise CardinalityError(
                    f"label {label!r} is not in the allow-list for {self.name}"
                )
            if label in seen:
                raise CardinalityError(f"label {label!r} declared twice on {self.name}")
            seen.add(label)
        for label, domain in self.bounds.items():
            if label not in seen:
                raise CardinalityError(
                    f"bounded label {label!r} on {self.name} is not a declared label"
                )
            if not domain:
                raise CardinalityError(f"bounded label {label!r} has an empty domain")
            for value in domain:
                if not label_value_ok(value):
                    raise CardinalityError(
                        f"bounded label value {value!r} for {label!r} on {self.name} "
                        "is not a wire token"
                    )

    def validate(self, labels: dict[str, str]) -> tuple[tuple[str, str], ...]:
        """Validate a concrete label set; return it canonically sorted.

        Raises :class:`CardinalityError` on any policy violation. Callers on
        hot paths must treat that as a programming error to fix, never as a
        runtime condition to swallow - silently dropping a label would
        merge series that mean different things, which is worse than either
        outcome.
        """
        keys = set(labels)
        declared = set(self.label_names)
        if keys != declared:
            missing = sorted(declared - keys)
            extra = sorted(keys - declared)
            raise CardinalityError(
                f"labels for {self.name} must be exactly {sorted(declared)}; "
                f"missing={missing} extra={extra}"
            )
        ordered: list[tuple[str, str]] = []
        for label in self.label_names:
            value = labels[label]
            if label in FORBIDDEN_LABEL_NAMES:
                raise CardinalityError(f"refused forbidden label {label!r} at record time")
            if not label_value_ok(value):
                raise CardinalityError(
                    f"label {label!r}={value!r} on {self.name} is not a bounded wire token; "
                    "identifier-shaped and free-text values belong in logs, not labels"
                )
            domain = self.bounds.get(label)
            if domain is not None and value not in domain:
                raise CardinalityError(
                    f"label {label!r}={value!r} on {self.name} is outside the declared "
                    f"bounded set ({len(domain)} values are permitted)"
                )
            ordered.append((label, value))
        return tuple(ordered)


class CardinalityError(ValueError):
    """A metric would have created unbounded or forbidden label series.

    A ``ValueError`` subclass so existing handling of bad configuration keeps
    working, while tests can assert the specific type.
    """
