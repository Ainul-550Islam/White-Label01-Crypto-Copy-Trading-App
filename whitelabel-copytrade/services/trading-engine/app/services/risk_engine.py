"""Pre-trade risk evaluation.

This is the last gate before any exchange call would ever be made. It is
deliberately implemented and enforced in Part 1 even though execution itself is
switched off, so that the safety layer exists *before* the code that needs it -
never the other way round.

The engine returns a decision; it never places an order and never touches an
exchange credential.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from app.config import Settings
from app.schemas import OrderIntent, OrderType, RiskDecision
from app.services.exchange_registry import ExchangeRegistry

logger = logging.getLogger(__name__)


class RiskEngine:
    """Applies configured guard rails to a proposed order."""

    def __init__(self, settings: Settings, registry: ExchangeRegistry) -> None:
        self._settings = settings
        self._registry = registry

    def evaluate(self, intent: OrderIntent, reference_price: Decimal | None) -> RiskDecision:
        reasons: list[str] = []

        if not self._registry.is_enabled(intent.exchange):
            reasons.append(f"Exchange {intent.exchange.value} is not enabled for this deployment.")

        if intent.leverage > self._settings.MAX_LEVERAGE:
            reasons.append(
                f"Requested leverage {intent.leverage}x exceeds the configured maximum "
                f"of {self._settings.MAX_LEVERAGE}x."
            )

        if intent.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and intent.price is None:
            reasons.append(f"{intent.order_type.value} orders require a price.")

        price = intent.price or reference_price
        if price is None:
            reasons.append("No price is available to value this order.")
        else:
            notional = (intent.quantity * price).quantize(Decimal("0.000001"))
            max_notional = Decimal(str(self._settings.MAX_ORDER_NOTIONAL_USD))
            if notional > max_notional:
                reasons.append(
                    f"Order notional {notional} exceeds the per-order maximum of {max_notional}."
                )

        approved = not reasons
        execution_enabled = self._settings.EXECUTION_ENABLED

        logger.info(
            "risk.evaluated",
            extra={
                "event": "risk.evaluated",
                "tenant_id": intent.tenant_id,
                "exchange": intent.exchange.value,
                "symbol": intent.symbol,
                "approved": approved,
                "execution_enabled": execution_enabled,
                "reason_count": len(reasons),
            },
        )

        return RiskDecision(
            approved=approved,
            reasons=reasons,
            executionEnabled=execution_enabled,
            # Even a fully approved intent does not execute while the kill
            # switch is off. Both conditions must hold.
            wouldExecute=approved and execution_enabled,
        )
