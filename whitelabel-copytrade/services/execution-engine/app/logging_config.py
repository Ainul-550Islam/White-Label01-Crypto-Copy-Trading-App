"""Structured JSON logging, using the shared Part 9 redactor and correlation.

Same policy as every other Python service: redaction lives in exactly one
place (``wlct_trading.observability.redaction``), this module only adapts it
to the logging machinery. The engine's log stream is where venue errors,
credential-adjacent exceptions and order payloads pass close by - the
redactor is what makes "logs are safe to ship" true rather than plausible.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from pythonjsonlogger import jsonlogger
from wlct_trading.observability.correlation import LoggingCorrelationFilter
from wlct_trading.observability.redaction import (
    REDACTED,
    is_sensitive_key,
    redact_exception,
    redact_text,
    redact_value,
)

__all__ = ["REDACTED", "RedactionFilter", "ServiceJsonFormatter", "configure_logging"]

#: Record attributes that belong to the logging machinery itself and must
#: never be treated as payload.
_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class RedactionFilter(logging.Filter):
    """Scrub credential-shaped keys AND values from every record.

    Runs after the correlation filter (mirrors the trading engine exactly):
    the ids the correlation filter injects are validated wire tokens, and
    scrubbing second means even a malformed injection is cleaned before
    serialisation.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in list(record.__dict__.items()):
            if key in _RESERVED:
                continue
            if is_sensitive_key(key):
                record.__dict__[key] = REDACTED
            elif isinstance(value, str):
                record.__dict__[key] = redact_text(value)
            elif isinstance(value, dict | list | tuple):
                record.__dict__[key] = redact_value(value)
        if record.exc_info and record.exc_info[1] is not None:
            # Replace the exception context with a safe summary: the raw
            # message can embed DSNs, and the formatter prints exc_text.
            summary = redact_exception(record.exc_info[1])
            record.exc_text = f"{summary['type']}: {summary['message']}"
            record.exc_info = None
        return True


class ServiceJsonFormatter(jsonlogger.JsonFormatter):
    """Adds the fields the platform log pipeline expects on every line."""

    def __init__(self, fmt: str, *, timestamp: bool = False) -> None:
        # An explicitly typed constructor: pythonjsonlogger ships no stubs,
        # so an inherited __init__ is untyped to mypy and every construction
        # site would be a "call to untyped function" in a strict context.
        # Declaring the signature here is typing, not suppression, and it
        # documents the one kwarg this service actually uses.
        super().__init__(fmt, timestamp=timestamp)

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record.setdefault("service", "execution-engine")
        log_record["level"] = record.levelname.lower()
        log_record["logger"] = record.name


def configure_logging(level: str) -> None:
    """Installs the JSON handler on the root logger."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        ServiceJsonFormatter("%(asctime)s %(level)s %(name)s %(message)s", timestamp=True)
    )
    handler.addFilter(LoggingCorrelationFilter())
    handler.addFilter(RedactionFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Uvicorn installs its own handlers; route them through ours instead.
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
