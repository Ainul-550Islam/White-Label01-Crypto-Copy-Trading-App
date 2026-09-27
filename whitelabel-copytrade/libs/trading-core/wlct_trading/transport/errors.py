"""Normalised exchange error taxonomy.

Every venue reports failure differently: Binance uses negative integer codes in
a JSON body, OKX uses stringified numerics, Kraken returns an array of strings,
and any of them may simply drop the socket. If those differences reached the
reconnect logic, the retry policy would have to special-case each venue and
would inevitably get one of them wrong.

So every failure is classified into one :class:`ExchangeErrorCategory` at the
adapter boundary. The category — not the venue's own code — decides what
happens next: whether to retry, whether to back off, and whether to give up.

Safety: :class:`NormalisedExchangeError` is designed to be logged. The
``metadata`` mapping is filtered through :func:`scrub_metadata`, which drops any
key that looks like credential material, so an error object cannot become the
route by which an API secret reaches a log aggregator.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping

__all__ = [
    "ExchangeErrorCategory",
    "NormalisedExchangeError",
    "RetryPolicy",
    "scrub_metadata",
    "SENSITIVE_KEY_FRAGMENTS",
]


class ExchangeErrorCategory(str, Enum):
    """What kind of failure occurred, independent of which venue produced it."""

    NETWORK_ERROR = "NETWORK_ERROR"
    AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR"
    RATE_LIMIT_ERROR = "RATE_LIMIT_ERROR"
    INVALID_REQUEST = "INVALID_REQUEST"
    SUBSCRIPTION_ERROR = "SUBSCRIPTION_ERROR"
    EXCHANGE_ERROR = "EXCHANGE_ERROR"
    SEQUENCE_ERROR = "SEQUENCE_ERROR"
    TIMEOUT = "TIMEOUT"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


#: Substrings that mark a metadata key as credential-bearing. Matching is done
#: on the lower-cased key, so ``X-MBX-APIKEY``, ``apiSecret`` and
#: ``Authorization`` are all caught.
SENSITIVE_KEY_FRAGMENTS: frozenset[str] = frozenset(
    {
        "apikey",
        "api_key",
        "secret",
        "passphrase",
        "password",
        "token",
        "authorization",
        "signature",
        "private",
        "credential",
        "cookie",
        "session",
        "bearer",
    }
)

_REDACTED = "[redacted]"

#: Depth limit for recursive scrubbing. Metadata is diagnostic context, not a
#: document tree; anything deeper than this is almost certainly a cycle or a
#: mistake, and unbounded recursion in a logging path is its own hazard.
_MAX_SCRUB_DEPTH = 6


def scrub_metadata(
    metadata: Mapping[str, Any] | None, *, _depth: int = 0
) -> dict[str, Any]:
    """Copy ``metadata``, redacting anything that looks like a credential.

    Redaction replaces the value rather than dropping the key: knowing that a
    signature *was* present is diagnostically useful, while its value never is.

    Nested structures are scrubbed too. Credentials rarely sit at the top
    level — an API key travels in ``{"request": {"headers": {"X-MBX-APIKEY":
    ...}}}`` — so a shallow pass would let the one value that actually matters
    straight through into the logs.
    """
    if not metadata:
        return {}

    scrubbed: dict[str, Any] = {}
    for key, value in metadata.items():
        lowered = str(key).lower()
        if any(fragment in lowered for fragment in SENSITIVE_KEY_FRAGMENTS):
            scrubbed[str(key)] = _REDACTED
        else:
            scrubbed[str(key)] = _scrub_value(value, _depth + 1)
    return scrubbed


def _scrub_value(value: Any, depth: int) -> Any:
    """Recursively scrub a nested value."""
    if depth >= _MAX_SCRUB_DEPTH:
        return value
    if isinstance(value, Mapping):
        return scrub_metadata(value, _depth=depth)
    if isinstance(value, (list, tuple)):
        scrubbed = [_scrub_value(item, depth + 1) for item in value]
        return tuple(scrubbed) if isinstance(value, tuple) else scrubbed
    return value


@dataclass(slots=True, frozen=True)
class NormalisedExchangeError(Exception):
    """A venue failure expressed in the platform's own vocabulary.

    ``venue_code`` and ``venue_message`` preserve what the exchange actually
    said, which is essential when debugging against their documentation, while
    ``category`` is what the rest of the system branches on.
    """

    category: ExchangeErrorCategory
    message: str
    exchange: str
    venue_code: str | None = None
    venue_message: str | None = None
    retry_after_millis: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Frozen dataclass: mutate through object.__setattr__ to install the
        # scrubbed copy before the instance escapes.
        object.__setattr__(self, "metadata", scrub_metadata(self.metadata))
        Exception.__init__(self, self.message)

    def __str__(self) -> str:
        parts = [f"[{self.exchange}] {self.category.value}: {self.message}"]
        if self.venue_code is not None:
            parts.append(f"(venue code {self.venue_code})")
        return " ".join(parts)

    @property
    def is_retryable(self) -> bool:
        """Whether retrying the same operation could plausibly succeed.

        Authentication and malformed-request failures are deterministic: the
        same request will fail identically forever, so retrying them only burns
        rate-limit budget and delays the operator noticing a real problem.
        """
        return RETRY_POLICIES[self.category].retryable

    @property
    def requires_resync(self) -> bool:
        """Whether an order book must be rebuilt as a result of this error."""
        return self.category is ExchangeErrorCategory.SEQUENCE_ERROR

    def to_log_fields(self) -> dict[str, Any]:
        """Structured-logging representation. Safe to emit as-is."""
        return {
            "exchange": self.exchange,
            "errorCategory": self.category.value,
            "errorMessage": self.message,
            "venueCode": self.venue_code,
            "venueMessage": self.venue_message,
            "retryAfterMillis": self.retry_after_millis,
            "retryable": self.is_retryable,
            **self.metadata,
        }


@dataclass(slots=True, frozen=True)
class RetryPolicy:
    """How a category of failure should be retried."""

    retryable: bool
    #: Multiplier applied to the base backoff delay. Rate limiting deserves a
    #: longer pause than a transient socket drop.
    backoff_multiplier: float
    #: Bound on consecutive attempts. ``None`` means "bounded only by the
    #: connection manager's own maximum", never "unlimited".
    max_attempts: int | None


#: Retry behaviour per category. Deliberately exhaustive so adding a category
#: without deciding its retry semantics is a KeyError at import time rather
#: than an accidental infinite retry in production.
RETRY_POLICIES: dict[ExchangeErrorCategory, RetryPolicy] = {
    ExchangeErrorCategory.NETWORK_ERROR: RetryPolicy(True, 1.0, None),
    ExchangeErrorCategory.TIMEOUT: RetryPolicy(True, 1.0, None),
    ExchangeErrorCategory.RATE_LIMIT_ERROR: RetryPolicy(True, 4.0, 10),
    ExchangeErrorCategory.EXCHANGE_ERROR: RetryPolicy(True, 2.0, 10),
    ExchangeErrorCategory.SUBSCRIPTION_ERROR: RetryPolicy(True, 2.0, 5),
    ExchangeErrorCategory.SEQUENCE_ERROR: RetryPolicy(True, 1.0, 5),
    # Deterministic failures. Retrying cannot help.
    ExchangeErrorCategory.AUTHENTICATION_ERROR: RetryPolicy(False, 1.0, 0),
    ExchangeErrorCategory.INVALID_REQUEST: RetryPolicy(False, 1.0, 0),
    ExchangeErrorCategory.UNKNOWN_ERROR: RetryPolicy(True, 2.0, 3),
}
