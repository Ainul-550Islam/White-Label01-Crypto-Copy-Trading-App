"""USD-M futures placement risk guards.

Responsibility: the four compounding-shape invariants that the runtime holds
*after* the platform's generic risk engine and *before* anything crosses the
futures wire. A guard either returns a verdict the caller logs and enforces,
or raises :class:`FuturesGuardRefusal` when evaluation itself could not be
grounded - the asymmetry ("cannot evaluate" is a refusal outcome, not a skip)
is what makes this an enforcement surface rather than a linter.

The four guards (configurable via :class:`FuturesGuardPolicy`):

  1. ``leverage-ceiling`` - account/symbol leverage must not exceed the
     configured ceiling (default 3x; hard-18x venue cliff enforced by Binance).
  2. ``notional-ceiling`` - order notional, priced at the venue's mark or a
     caller-supplied reference, must stay within the USD ceiling (default
     250 000).
  3. ``liquidation-distance`` - estimated distance between entry/mark and the
     liquidation price implied by leverage and margin mode must stay above a
     floor in basis points (default 250 bps = 2.5%).
  4. ``funding-rate-headroom`` - opening/holding a position whose carry is
     adverse beyond a per-8h funding cap (default 75 bps) must be confirmed
     by a caller that explicitly accepts carry risk; otherwise refused.

All arithmetic is ``Decimal``; no guard touches I/O - mark price *observation*
is the caller's problem and a ``None`` mark price is a refusal input, not a
"skip this guard" signal.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable, Mapping

from wlct_trading.enums import OrderSide

__all__ = [
    "FuturesGuardPolicy",
    "FuturesGuardRefusal",
    "GuardVerdict",
    "GuardReport",
    "evaluate_futures_guards",
]


class FuturesGuardRefusal(RuntimeError):
    """Raised when a guard could not obtain the evidence needed to decide."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class FuturesGuardPolicy:
    """Numerical floors and ceilings. Defaults track the deployment contract:

    - leverage at most 3x (protects the copy-follower pool);
    - notional at most USD 250 000 per order;
    - implied liquidation distance at least 250 bps (2.5%);
    - adverse funding over 75 bps per 8h requires explicit carry acceptance.
    """

    max_leverage: Decimal = Decimal("3")
    max_notional_usdt: Decimal = Decimal("250000")
    min_liquidation_distance_bps: Decimal = Decimal("250")
    max_funding_rate_bps: Decimal = Decimal("75")
    #: Hard venue-side cliff: USD-M refuses leverage above this symbol bracket
    #: anywhere; guards enforce well below, but the upper bound documents what
    #: the exchange answer would be anyway.
    venue_hard_max_leverage: Decimal = Decimal("125")


@dataclass(frozen=True, slots=True)
class GuardVerdict:
    """One guard's answer. ``breached=False`` means the guard passed."""

    guard: str
    breached: bool
    #: Human-decimal detail for the audit log; no PHI, no keys.
    detail: str
    measured: Decimal | None
    limit: Decimal | None


@dataclass(frozen=True, slots=True)
class GuardReport:
    """Aggregate answer. ``admitted`` only when every guard passed."""

    admitted: bool
    verdicts: tuple[GuardVerdict, ...]
    #: Sum of small detail phrases joined for the breach log line.
    summary: str


def _d(value: Any, field: str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return Decimal(value)
    if isinstance(value, str):
        text = value.strip()
        if text and text != "None":
            return Decimal(text)
    raise FuturesGuardRefusal(
        "GUARD_INPUT", f"{field}: expected Decimal/decimal-string/int, got {type(value).__name__}"
    )


def check_leverage(
    requested_leverage: Decimal, policy: FuturesGuardPolicy
) -> GuardVerdict:
    """Guard 1: leverage ceiling."""
    limit = policy.max_leverage
    if requested_leverage <= 0:
        raise FuturesGuardRefusal("GUARD_INPUT", "leverage must be positive")
    breached = requested_leverage > limit
    return GuardVerdict(
        guard="leverage-ceiling",
        breached=breached,
        detail=(
            f"requested leverage {requested_leverage}x; ceiling {limit}x"
            + (" (BREACH)" if breached else "")
        ),
        measured=requested_leverage,
        limit=limit,
    )


def check_notional(
    *,
    quantity: Decimal,
    reference_price: Decimal | None,
    policy: FuturesGuardPolicy,
) -> GuardVerdict:
    """Guard 2: USD notional ceiling, priced off a trusted reference.

    A missing reference price is a refusal input - without a valuation the
    ceiling cannot be measured, and guessing a price invents risk.
    """
    if reference_price is None:
        raise FuturesGuardRefusal(
            "GUARD_INPUT",
            "notional ceiling requires a reference price; refusing to price risk off nothing",
        )
    if reference_price <= 0:
        raise FuturesGuardRefusal("GUARD_INPUT", "reference price must be positive")
    if quantity < 0:
        raise FuturesGuardRefusal("GUARD_INPUT", "quantity must be non-negative")
    notional = (quantity * reference_price).quantize(Decimal("0.00000001"))
    limit = policy.max_notional_usdt
    breached = notional > limit
    return GuardVerdict(
        guard="notional-ceiling",
        breached=breached,
        detail=f"notional {notional} USDT vs ceiling {limit} USDT" + (" (BREACH)" if breached else ""),
        measured=notional,
        limit=limit,
    )


def check_liquidation_distance(
    *,
    side: OrderSide,
    entry_or_mark_price: Decimal | None,
    leverage: Decimal,
    maintenance_margin_fraction: Decimal,
    policy: FuturesGuardPolicy,
) -> GuardVerdict:
    """Guard 3: estimated distance to liquidation in basis points.

    Model: one-way margin mode, marked position P with maintenance fraction m.
    For a LONG entry at price E with leverage L, liquidation approaches at
    ``E * (1 - 1/L + m)`` (roughly: entry less the basket of equity/maint.
    slope); SHORT mirrors. The platform's guard is conservative: the
    maintenance fraction enters only when it *tightens* distance (buffered
    view), so the verdict never overestimates room. Supplying a real
    venue-reported liquidation price bypasses this estimator upstream; this
    guard exists precisely for submission-time when only leverage and entry
    are known.
    """
    if entry_or_mark_price is None or entry_or_mark_price <= 0:
        raise FuturesGuardRefusal("GUARD_INPUT", "liquidation distance needs an entry/mark price")
    if leverage <= 0:
        raise FuturesGuardRefusal("GUARD_INPUT", "leverage must be positive")
    if maintenance_margin_fraction < 0 or maintenance_margin_fraction >= 1:
        raise FuturesGuardRefusal(
            "GUARD_INPUT", "maintenance margin fraction must be within [0, 1)"
        )

    inverse = Decimal(1) / leverage
    # The platform side vocabulary is BUY/SELL (LONG/SHORT are position
    # shapes, not order sides); both directions take the same conservative
    # estimator - the conservative buffer makes the formulae coincide.
    if side in (OrderSide.BUY, OrderSide.SELL):
        distance_fraction = inverse - maintenance_margin_fraction
    else:
        raise FuturesGuardRefusal(
            "GUARD_INPUT", f"side {side!r} is not a directional futures side"
        )

    if distance_fraction <= 0:
        # Negative distance means the position is already effectively
        # liquidated at entry - refuse at maximum severity.
        distance_bps = Decimal(-10000)
    else:
        distance_bps = (distance_fraction * Decimal(10000)).quantize(Decimal("0.01"))

    limit = policy.min_liquidation_distance_bps
    breached = distance_bps < limit
    return GuardVerdict(
        guard="liquidation-distance",
        breached=breached,
        detail=(
            f"estimated liquidation distance {distance_bps} bps; floor {limit} bps "
            f"(leverage {leverage}x, maint-margin {maintenance_margin_fraction})"
            + (" (BREACH)" if breached else "")
        ),
        measured=distance_bps,
        limit=limit,
    )


def check_funding_rate(
    *,
    projected_funding_rate_8h_bps: Decimal,
    carry_over_position: bool,
    accepts_carry_risk: bool,
    policy: FuturesGuardPolicy,
) -> GuardVerdict:
    """Guard 4: adverse funding headroom.

    A positive 8h payment for a LONG (negative for a SHORT) is carry risk;
    beyond the cap it requires the caller to have explicitly accepted carry
    exposure (``accepts_carry_risk=True``), else refused. The guard does not
    touch positions that merely *hold* through funding when the caller is
    already reducing; that is the caller's risk bookkeeping. However
    ``carry_over_position=False`` on a fresh opening ignores carry intent and
    stays subject to the cap.
    """
    limit = policy.max_funding_rate_bps
    adverse = projected_funding_rate_8h_bps
    if adverse <= 0:
        return GuardVerdict(
            guard="funding-rate-headroom",
            breached=False,
            detail=f"funding carry {adverse} bps is favourable; no breach possible",
            measured=adverse,
            limit=limit,
        )
    if carry_over_position and accepts_carry_risk:
        return GuardVerdict(
            guard="funding-rate-headroom",
            breached=False,
            detail=(
                f"funding carry {adverse} bps exceeds headroom {limit} bps but was "
                "explicitly accepted by the caller (carry_over_position + accepts_carry_risk)"
            ),
            measured=adverse,
            limit=limit,
        )
    breached = adverse > limit
    return GuardVerdict(
        guard="funding-rate-headroom",
        breached=breached,
        detail=(
            f"projected funding {adverse} bps; headroom {limit} bps"
            + (" (BREACH - carry not accepted)" if breached else "")
        ),
        measured=adverse,
        limit=limit,
    )


def evaluate_futures_guards(
    *,
    side: OrderSide,
    quantity: Any,
    reference_price: Any | None,
    leverage: Any,
    maintenance_margin_fraction: Any = Decimal("0"),
    projected_funding_rate_8h_bps: Any = Decimal("0"),
    carry_over_position: bool = False,
    accepts_carry_risk: bool = False,
    policy: FuturesGuardPolicy | None = None,
    guards: Iterable[str] | None = None,
) -> GuardReport:
    """Run the four guards (or a named subset) and aggregate the verdict.

    Any :class:`FuturesGuardRefusal` raised while gathering evidence fails the
    aggregate - "could not evaluate" is a refusal outcome, never a skip. This
    is what makes :func:`evaluate_futures_guards` an enforcement surface: it
    either admits an order with measured headroom, or refuses with a record.
    """
    active = policy or FuturesGuardPolicy()
    wanted = set(guards) if guards is not None else {
        "leverage-ceiling",
        "notional-ceiling",
        "liquidation-distance",
        "funding-rate-headroom",
    }
    verdicts: list[GuardVerdict] = []

    lev = _d(leverage, "leverage")
    if "leverage-ceiling" in wanted:
        verdicts.append(check_leverage(requested_leverage=lev, policy=active))

    if "notional-ceiling" in wanted:
        qty = _d(quantity, "quantity")
        ref = None if reference_price is None else _d(reference_price, "reference_price")
        verdicts.append(
            check_notional(quantity=qty, reference_price=ref, policy=active)
        )

    if "liquidation-distance" in wanted:
        ref = None if reference_price is None else _d(reference_price, "reference_price")
        mnt = _d(maintenance_margin_fraction, "maintenance_margin_fraction")
        verdicts.append(
            check_liquidation_distance(
                side=side,
                entry_or_mark_price=ref,
                leverage=lev,
                maintenance_margin_fraction=mnt,
                policy=active,
            )
        )

    if "funding-rate-headroom" in wanted:
        fr = _d(projected_funding_rate_8h_bps, "projected_funding_rate_8h_bps")
        verdicts.append(
            check_funding_rate(
                projected_funding_rate_8h_bps=fr,
                carry_over_position=carry_over_position,
                accepts_carry_risk=accepts_carry_risk,
                policy=active,
            )
        )

    breached = any(v.breached for v in verdicts)
    if not verdicts:
        # An empty guard selection means the caller selected nothing - treat
        # as a refusal rather than vacuously admitting: selecting zero guards
        # on a live path is a configuration smell, not a permission.
        raise FuturesGuardRefusal(
            "GUARD_INPUT", "no guards selected for evaluation on a futures placement path"
        )
    summary_parts = [
        f"{v.guard}={'BREACH' if v.breached else 'pass'}" for v in verdicts
    ]
    return GuardReport(
        admitted=not breached,
        verdicts=tuple(verdicts),
        summary="; ".join(summary_parts),
    )
