"""Resolving the fate of an order whose placement answer never arrived.

Responsibility: when an order-placement POST times out, the connection
resets, or the venue answers 5xx, the order may or may not exist at Binance.
Retrying the POST blindly risks a duplicate position; abandoning the order
risks an untracked one. The only safe move is to *ask*: ``GET /api/v3/order``
looked up by ``origClientOrderId``. That works because the
``clientOrderId`` is deterministic - it derives from the order intent via
:func:`wlct_trading.idempotency.build_client_order_id`, so the resubmission
question "did the first attempt land?" has a venue-checkable answer.

The resolver is deliberately conservative:

- venue returns the order        -> ``exists``  (never resubmit; adopt it)
- venue answers ``-2013``        -> ``absent``  (the only state in which a
  resubmission cannot duplicate anything)
- anything else - connection failure, rate limit, a rejection of the *query*
  itself, an unparseable answer   -> ``unknown`` (never resubmit; reconcile)

Cancellation uses the same identity: cancels are issued by
``origClientOrderId`` (the adapter does this), so a cancel does not need a
venue order id the placement response may never have delivered.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Protocol

from wlct_trading.adapters.base import AdapterError
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.orders import Order, OrderIntent

logger = logging.getLogger(__name__)

__all__ = [
    "OrderOutcome",
    "OrderOutcomeKind",
    "OrderOutcomeResolver",
    "OrderReader",
    "client_order_id_for",
]

OrderOutcomeKind = Literal["exists", "absent", "unknown"]


def client_order_id_for(intent: OrderIntent) -> str:
    """The deterministic venue ``clientOrderId`` for an intent.

    Delegates to the core's single derivation so the placement path and the
    outcome lookup can never disagree about an order's identity.
    """
    return build_client_order_id(intent)


class OrderReader(Protocol):
    """The slice of the trading adapter outcome resolution needs."""

    async def fetch_order_for(self, order: Order) -> Order | None: ...


@dataclass(frozen=True, slots=True)
class OrderOutcome:
    """The resolver's answer - and, for ``exists``, the order itself."""

    kind: OrderOutcomeKind
    order: Order | None
    client_order_id: str
    detail: str

    @property
    def resubmission_safe(self) -> bool:
        """True only when the venue proved no such order exists."""
        return self.kind == "absent"


class OrderOutcomeResolver:
    """``GET /api/v3/order`` by ``origClientOrderId``, classified fail-closed."""

    __slots__ = ("_adapter",)

    def __init__(self, adapter: OrderReader) -> None:
        self._adapter = adapter

    async def resolve(self, order: Order) -> OrderOutcome:
        """Ask the venue about ``order`` (identified by its client order id).

        ``order.client_order_id`` is the venue lookup key; the adapter
        resolves it to ``origClientOrderId``. Only Binance's explicit
        ``-2013`` (order does not exist), which the adapter surfaces as
        ``None``, may be read as ``absent``.
        """
        client_order_id = order.client_order_id or ""
        if not client_order_id:
            return OrderOutcome(
                kind="unknown",
                order=None,
                client_order_id="",
                detail=(
                    "order carries no client_order_id; its fate cannot be "
                    "queried by origClientOrderId"
                ),
            )
        return await self._resolve(order, client_order_id)

    async def resolve_for_intent(
        self, intent: OrderIntent
    ) -> OrderOutcome:
        """Resolve an intent whose placement never produced an ``Order``.

        The client order id is derived exactly as the placement path derived
        it, then the same venue query runs against a transient lookup order.
        """
        client_order_id = intent.client_order_id or client_order_id_for(intent)
        lookup = Order.from_intent(intent, client_order_id=client_order_id)
        return await self._resolve(lookup, client_order_id)

    async def _resolve(self, order: Order, client_order_id: str) -> OrderOutcome:
        try:
            fetched = await self._adapter.fetch_order_for(order)
        except AdapterError as exc:
            # The query itself failed (connection, rate limit, or the venue
            # rejected the question). Nothing was proven about the order.
            logger.warning(
                "order outcome unknown: venue query failed for "
                "client_order_id=%s error=%s",
                client_order_id,
                type(exc).__name__,
            )
            return OrderOutcome(
                kind="unknown",
                order=None,
                client_order_id=client_order_id,
                detail=f"venue outcome query failed: {type(exc).__name__}: {exc}",
            )
        except Exception as exc:  # noqa: BLE001 - fail closed, never resubmit
            logger.warning(
                "order outcome unknown: unexpected failure for "
                "client_order_id=%s error=%s",
                client_order_id,
                type(exc).__name__,
            )
            return OrderOutcome(
                kind="unknown",
                order=None,
                client_order_id=client_order_id,
                detail=f"outcome resolution failed unexpectedly: {type(exc).__name__}",
            )
        if fetched is None:
            return OrderOutcome(
                kind="absent",
                order=None,
                client_order_id=client_order_id,
                detail="venue reports no order for this origClientOrderId (-2013)",
            )
        return OrderOutcome(
            kind="exists",
            order=fetched,
            client_order_id=client_order_id,
            detail=(
                f"venue order {fetched.exchange_order_id} in status "
                f"{fetched.status}"
            ),
        )
