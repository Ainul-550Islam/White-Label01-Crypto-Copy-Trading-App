# Validates and executes order placement against venue adapter
"""Orders placement module re-exporting canonical placement review and execution wiring."""

from __future__ import annotations

from dataclasses import dataclass

from app.placement import (
    REVIEW_ENDPOINT_LABEL,
    PlacementWiring,
    build_confirmation_verifier,
    build_placement_reviewer,
    review_placement,
)


@dataclass(frozen=True)
class OrderPlacementAuditSummary:
    """Structured audit summary for an order placement review decision."""

    venue: str
    symbol: str
    approved: bool
    simulated: bool
    endpoint_label: str = REVIEW_ENDPOINT_LABEL


__all__ = [
    "REVIEW_ENDPOINT_LABEL",
    "PlacementWiring",
    "OrderPlacementAuditSummary",
    "build_confirmation_verifier",
    "build_placement_reviewer",
    "review_placement",
]
