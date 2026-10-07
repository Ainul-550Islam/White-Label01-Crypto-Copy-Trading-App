# Tracks submission state, exchange order ID, and idempotency
"""Orders submission module re-exporting canonical OMS submission preparation and idempotency tracking."""

from __future__ import annotations

from dataclasses import dataclass

from app.submission import (
    RATE_WINDOW_MICROS,
    PreparedSubmission,
    prepare_submission,
    record_submission,
)


@dataclass(frozen=True)
class SubmissionIdempotencyRecord:
    """Immutable idempotency record linking client_order_id to exchange_order_id."""

    tenant_id: str
    account_id: str
    client_order_id: str
    exchange_order_id: str | None
    rate_window_micros: int = RATE_WINDOW_MICROS


__all__ = [
    "RATE_WINDOW_MICROS",
    "PreparedSubmission",
    "SubmissionIdempotencyRecord",
    "prepare_submission",
    "record_submission",
]
