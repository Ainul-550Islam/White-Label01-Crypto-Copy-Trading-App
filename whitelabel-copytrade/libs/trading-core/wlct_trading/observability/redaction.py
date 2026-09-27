"""The platform's one and only redactor for the Python side.

Background, stated honestly: each service used to carry its own small
``RedactionFilter`` with a key-name regex - and those filters had two holes.
They scrubbed *keys* but not credential-shaped *values* (a dict passed as
``logger.info({"payload": raw_exchange_reply})`` could contain a signed query
string that no key-name regex would ever catch), and they did not recurse into
lists. The services now delegate to this module, and this module is tested
against the same cases as the TypeScript redactor in ``packages/utils`` via
``docs/fixtures/observability_fixtures.json``. One policy, two languages, one
fixture.

This module never mutates its input: it rebuilds. The caller's structure is
untouched, which keeps log-time redaction safe to run on shared state.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence, Set
from typing import Any

__all__ = [
    "REDACTED",
    "SENSITIVE_KEY_PATTERN",
    "redact_value",
    "redact_mapping",
    "redact_text",
    "redact_exception",
    "is_sensitive_key",
]

REDACTED = "[REDACTED]"

#: Key names that are always replaced, matched on a normalised form so
#: ``apiSecret``, ``api_secret`` and ``API-SECRET`` all hit the same rule.
SENSITIVE_KEY_PATTERN = re.compile(
    r"(api[_-]?secret|api[_-]?key|password|passphrase|private[_-]?key|token|jwt|authorization"
    r"|secret|credential|signature|signed[_-]?query|dsn|connection[_-]?string|database[_-]?url)",
    re.IGNORECASE,
)

#: Substrings checked against the *normalised* (lower-cased, separators
#: stripped) key name - the same shape of rule the TypeScript redactor uses,
#: kept in sync by fixture.
_KEY_SUBSTRINGS: tuple[str, ...] = (
    "apikey",
    "apisecret",
    "secret",
    "password",
    "passphrase",
    "privatekey",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "credential",
    "dsn",
    "connectionstring",
    "databaseurl",
)

#: Maximum structural depth before a subtree is replaced whole. Deep enough
#: for any payload the platform logs, shallow enough to terminate on a cycle
#: or a hostile nesting.
_MAX_DEPTH = 8

#: Credential-shaped *values*, independent of the key they sit under.
_VALUE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # JWT / bearer style tokens (also catches the ``Authorization: Bearer`` text form).
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}"),
    # Stripe-style publishable/secret keys.
    re.compile(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b"),
    # Private key material.
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    # Connection strings with embedded credentials: scheme://user:pass@host
    re.compile(r"\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^@\s]+@"),
    # Query-string signatures as exchanges use them: &signature=...
    re.compile(r"(?i)[?&](?:signature|sig|api[_-]?key|access[_-]?token)=[^&\s]+"),
    # AWS-style access key ids, the classic "innocuous-looking" 20-char token.
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
)

_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (_VALUE_PATTERNS[4], REDACTED + "@"),
)


def is_sensitive_key(key: object) -> bool:
    """Whether a mapping key names something that must never be logged."""
    if not isinstance(key, str):
        return False
    if SENSITIVE_KEY_PATTERN.search(key):
        return True
    normalised = re.sub(r"[-_\s]", "", key.lower())
    return any(sub in normalised for sub in _KEY_SUBSTRINGS)


def _replacement_for(pattern: re.Pattern[str]) -> str:
    for source, replacement in _REPLACEMENTS:
        if source is pattern:
            return replacement
    return REDACTED


def redact_text(text: str) -> str:
    """Replace credential-shaped runs inside free text.

    The connection-string rule keeps the host visible after its ``@`` (it is
    already public topology information) but replaces ``scheme://user:pass``
    outright - the same trade-off the Node pino serializers make.
    """
    output = text
    for pattern in _VALUE_PATTERNS:
        output = pattern.sub(_replacement_for(pattern), output)
    return output


def redact_value(value: Any, _depth: int = 0) -> Any:
    """Recursively rebuild ``value`` with sensitive material replaced.

    Dicts, lists, tuples, sets and mappings are traversed; anything exotic is
    reduced through a bounded string coercion so unknown objects cannot smuggle
    a ``__str__`` containing a secret. Scalars pass through unchanged.
    """
    if _depth > _MAX_DEPTH:
        return REDACTED
    if isinstance(value, str):
        return redact_text(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (bytes, bytearray)):
        return REDACTED
    if isinstance(value, Mapping):
        return {
            key: REDACTED if is_sensitive_key(key) else redact_value(item, _depth + 1)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, Set)):
        return [redact_value(item, _depth + 1) for item in value]
    if isinstance(value, Sequence) and not isinstance(value, str):
        return [redact_value(item, _depth + 1) for item in value]
    return redact_text(str(value))


def redact_mapping(payload: Mapping[Any, Any] | None) -> dict[Any, Any] | None:
    """Redact a logging ``extra`` mapping, preserving ``None``."""
    if payload is None:
        return None
    redacted = redact_value(dict(payload))
    result: dict[Any, Any] = redacted if isinstance(redacted, dict) else {}
    return result


def redact_exception(error: BaseException) -> dict[str, Any]:
    """A loggable, non-leaking summary of an exception.

    Only the type name and a redacted message are kept. Exception messages from
    driver libraries routinely embed DSNs, and the previous per-service filters
    never looked at exception text at all.
    """
    return {
        "type": type(error).__name__,
        "message": redact_text(str(error)),
    }
