"""The Part 8 rule catalog: twenty-two ceiling rules with explicit applicability.

Three invariants hold across every rule here, and they are the reason the
catalog is a module and not a bag of ``if`` statements in the gate:

1. **Every rule answers one of exactly four things.** ``PASS`` (checked and
   satisfied), ``BREACH`` (checked and violated), ``NOT_APPLICABLE`` (this
   rule does not speak to this instrument/order/scope - it was *declared*
   inapplicable, which is different from being unconfigured), and
   ``UNVERIFIABLE`` (the rule is applicable but the state it needs is
   missing, unparseable or contradictory). The gate treats ``UNVERIFIABLE``
   as a rejection - uncertainty is a refusal, the governing principle of the
   whole engine. ``NOT_APPLICABLE`` is not a pass either: it is recorded,
   reported and replayed as "this rule did not run, and here is why."

2. **New-risk rules exempt risk-reducing orders; integrity rules never
   do.** Daily loss, drawdown, consecutive losses, rate limits, strategy
   count, volume and fee budget guard against *adding* exposure; a reduce-
   only order, or any order whose projection strictly lowers absolute
   exposure, passes them (the exemption is recorded, not silent). Order
   size, notional, price deviation, staleness, position/exposure ceilings
   and open-order count apply to every order regardless of direction - a
   closing order can still be fat-fingered, stale or enormous.

3. **No rule computes a fact.** Prices, PnL, exposure, counts: all arrive
   in the snapshot, validated by it. A rule's job is the comparison against
   a *resolved configuration limit* - nothing else - which keeps every one
   of them unit-testable in isolation and keeps the whole catalog honest to
   the "separate calculation from persistence and I/O" brief.

Decimal arithmetic only; comparisons use exact ``Decimal`` ordering; no
float enters or leaves this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Callable, Mapping

from wlct_trading.enums import (
    RISK_RULE_ORDER,
    MarketType,
    PriceReferenceKind,
    RiskLimitUnit,
    RiskRuleId,
)
from wlct_trading.market_data import BookTop
from wlct_trading.orders import OrderIntent
from wlct_trading.risk.configuration import RiskConfiguration, ResolvedLimit
from wlct_trading.risk.exposure import ExposureBreakdown, ExposureDimension
from wlct_trading.risk.rate_limits import (
    RateWindowCounters,
    RiskRateKind,
)
from wlct_trading.risk.snapshot import (
    RiskMarketDataState,
    RiskStateSnapshot,
    RiskStrategyState,
)

__all__ = [
    "RuleStatus",
    "RuleOutcome",
    "ProjectionResult",
    "RuleInputs",
    "evaluate_rules",
    "NEW_RISK_RULES",
    "INTEGRITY_RULES",
]

_ZERO = Decimal(0)
_TEN_THOUSAND = Decimal(10000)


class RuleStatus(str, Enum):
    """The four answers a rule may give. There is no fifth; ``SKIPPED`` for
    "the rule crashed" is banned by construction - evaluators are total
    functions and the gate wraps the call sites so a raise becomes
    ``UNVERIFIABLE`` at the gate level, never an absent outcome."""

    PASS = "PASS"
    BREACH = "BREACH"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    UNVERIFIABLE = "UNVERIFIABLE"


#: Rules that guard *adding* risk and therefore exempt provably
#: risk-reducing orders (invariant 2 above). Membership is by rule id, and
#: the gate asserts this set matches the evaluator implementations so a new
#: rule cannot quietly join the wrong side of the list.
NEW_RISK_RULES = frozenset(
    {
        RiskRuleId.MAX_DAILY_LOSS,
        RiskRuleId.MAX_STRATEGY_DAILY_LOSS,
        RiskRuleId.MAX_DRAWDOWN,
        RiskRuleId.MAX_ORDER_RATE,
        RiskRuleId.MAX_CANCEL_RATE,
        RiskRuleId.MAX_CONSECUTIVE_LOSSES,
        RiskRuleId.MAX_ACTIVE_STRATEGIES,
        RiskRuleId.MAX_TOTAL_VOLUME,
        RiskRuleId.MAX_FEE_BUDGET,
    }
)

#: Rules evaluated for every order, risk-reducing included.
INTEGRITY_RULES = frozenset(
    {
        RiskRuleId.MAX_ORDER_QUANTITY,
        RiskRuleId.MAX_ORDER_NOTIONAL,
        RiskRuleId.MAX_POSITION_QUANTITY,
        RiskRuleId.MAX_POSITION_NOTIONAL,
        RiskRuleId.MAX_SYMBOL_EXPOSURE,
        RiskRuleId.MAX_STRATEGY_EXPOSURE,
        RiskRuleId.MAX_EXCHANGE_EXPOSURE,
        RiskRuleId.MAX_ACCOUNT_EXPOSURE,
        RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE,
        RiskRuleId.MAX_OPEN_ORDERS,
        RiskRuleId.MAX_STALE_DATA_AGE,
        RiskRuleId.MAX_PRICE_DEVIATION,
        RiskRuleId.MAX_LEVERAGE,
    }
)


@dataclass(slots=True, frozen=True)
class RuleOutcome:
    """One rule's verdict, with the evidence a decision record must carry."""

    rule_id: RiskRuleId
    status: RuleStatus
    observed: Decimal | None = None
    limit: Decimal | None = None
    unit: RiskLimitUnit | None = None
    detail: str = ""
    #: Set when a policy exemption was applied (e.g. risk-reducing under a
    #: breached loss limit). An exemption recorded is an exemption auditable;
    #: a silent one is a hole with extra steps.
    exemption: str | None = None

    @property
    def blocks(self) -> bool:
        return self.status in (RuleStatus.BREACH, RuleStatus.UNVERIFIABLE)

    def to_payload(self) -> dict[str, object]:
        return {
            "ruleId": self.rule_id.value,
            "status": self.status.value,
            "observed": None if self.observed is None else str(self.observed),
            "limit": None if self.limit is None else str(self.limit),
            "unit": None if self.unit is None else self.unit.value,
            "detail": self.detail,
            "exemption": self.exemption,
        }


def _ceiling_outcome(
    rule: RiskRuleId,
    projected: Decimal,
    current: Decimal,
    limit: Decimal,
    unit: RiskLimitUnit,
    *,
    label: str,
) -> RuleOutcome:
    """Compare a projected figure to a ceiling, crediting improvement.

    The second clause is what makes over-cap accounts escapable: an order
    that moves projected exposure *toward* the cap is never blocked by it,
    because blocking the trade that reduces an over-cap position would pin
    the account at its worst state. Equal-and-still-over is a refusal (the
    order changes nothing while above cap); strictly better passes with the
    exemption recorded, never silently.
    """
    if projected <= limit:
        return RuleOutcome(
            rule_id=rule,
            status=RuleStatus.PASS,
            observed=projected,
            limit=limit,
            unit=unit,
            detail=f"{label} {projected} within limit {limit} {unit.value}.",
        )
    if projected < current:
        return RuleOutcome(
            rule_id=rule,
            status=RuleStatus.PASS,
            observed=projected,
            limit=limit,
            unit=unit,
            detail=(
                f"{label} {projected} still above the limit {limit}, but "
                f"strictly improving on the current {current}: reducing an "
                "over-cap exposure is never blocked by the cap it reduces."
            ),
            exemption="REDUCING_UNDER_CAP",
        )
    return RuleOutcome(
        rule_id=rule,
        status=RuleStatus.BREACH,
        observed=projected,
        limit=limit,
        unit=unit,
        detail=(
            f"{label} {projected} exceeds the limit {limit} {unit.value} "
            "without improving on the current projection."
        ),
    )


@dataclass(slots=True, frozen=True)
class ProjectionResult:
    """Pre-computed projected state, shared by the projection rules.

    The gate computes it once - position after reservations after the
    candidate - so "the projection every rule agreed on" is structurally
    guaranteed rather than hoped for. ``symbol_gross_after`` folds the
    candidate into the symbol bucket exactly the way
    :func:`~wlct_trading.risk.exposure.build_breakdown` would, and
    ``account_gross_after`` does the same for the account; two call sites,
    one projection.
    """

    current_signed: Decimal
    projected_signed: Decimal
    new_delta: Decimal
    is_risk_increasing: bool
    #: Valuation price used for notionals; ``None`` when no reference exists,
    #: in which case every notional-shaped rule reports UNVERIFIABLE.
    valuation_price: Decimal | None
    symbol_gross_after: Decimal | None
    account_gross_after: Decimal | None
    exchange_gross_after: Decimal | None
    #: Reservation exposure the strategy already has + this order, valued at
    # ``valuation_price``. None when the order cannot be valued at all.
    strategy_exposure_after: Decimal | None
    #: Signed change in absolute gross exposure this order causes at its
    # symbol: positive when increasing, negative when reducing, relative to
    # the position *after all reservations*. Every gross-cap rule compares
    # ``current_gross + exposure_delta`` - which is why a closing order can
    # never be blocked by the exposure ceiling its own account needs to
    # breach it. A gross that is already over cap must remain reducible.
    exposure_delta: Decimal | None = None
    #: ``current`` peers of every *_after figure, used by the reducing-
    # under-cap rule in :func:`_ceiling_outcome`. Improvements must be
    # measured against the same bucket the cap compares, so they are
    # computed once here rather than re-derived per rule.
    after_reservations_abs: Decimal | None = None
    symbol_gross_current: Decimal | None = None
    account_gross_current: Decimal | None = None
    exchange_gross_current: Decimal | None = None
    strategy_exposure_current: Decimal | None = None


@dataclass(slots=True, frozen=True)
class RuleInputs:
    """Everything a rule evaluation may read. Constructed once per decision."""

    intent: OrderIntent
    now_micros: int
    snapshot: RiskStateSnapshot
    config: RiskConfiguration
    resolved: Mapping[RiskRuleId, ResolvedLimit]
    projection: ProjectionResult
    market: RiskMarketDataState | None
    strategy: RiskStrategyState | None
    rates: RateWindowCounters
    book_top: BookTop | None
    #: Leverage requested by the *request layer* (order metadata); ``None``
    #: when the caller has no leverage concept at all (spot-only paths),
    #: which the leverage rule reads as "the venue cannot express leverage",
    #: not as "leverage of zero".
    requested_leverage: Decimal | None


def _limit_for(inputs: RuleInputs, rule: RiskRuleId) -> ResolvedLimit | None:
    return inputs.resolved.get(rule)


def _unavailable(rule: RiskRuleId, limit: ResolvedLimit | None, why: str) -> RuleOutcome:
    return RuleOutcome(
        rule_id=rule,
        status=RuleStatus.UNVERIFIABLE,
        limit=None if limit is None else limit.value,
        unit=None if limit is None else limit.unit,
        detail=why,
    )


def _not_applicable(rule: RiskRuleId, why: str, *, exemption: str | None = None) -> RuleOutcome:
    return RuleOutcome(
        rule_id=rule, status=RuleStatus.NOT_APPLICABLE, detail=why, exemption=exemption
    )


def _new_risk_exemption(inputs: RuleInputs, rule: RiskRuleId) -> RuleOutcome | None:
    """If this rule is new-risk gated and the order is risk-reducing, return
    the exempt outcome; otherwise ``None`` so the caller proceeds."""
    if rule in NEW_RISK_RULES and not inputs.projection.is_risk_increasing:
        return RuleOutcome(
            rule_id=rule,
            status=RuleStatus.PASS,
            detail="Order does not increase risk; new-risk rule does not apply.",
            exemption="RISK_REDUCING",
        )
    return None


def _compare_ceiling(
    rule: RiskRuleId,
    observed: Decimal,
    limit: Decimal,
    unit: RiskLimitUnit,
    *,
    strict: bool = False,
    label: str = "observed",
) -> RuleOutcome:
    breached = observed > limit if strict else observed >= limit
    return RuleOutcome(
        rule_id=rule,
        status=RuleStatus.BREACH if breached else RuleStatus.PASS,
        observed=observed,
        limit=limit,
        unit=unit,
        detail=(
            f"{label} {observed} {'>' if strict else '>='} limit {limit} {unit.value}."
            if breached
            else f"{label} {observed} within limit {limit} {unit.value}."
        ),
    )


# ---------------------------------------------------------------------------
# Individual rules. Each is a pure function of RuleInputs, returning an
# outcome; registration order and short names are the evaluator's business,
# not the rules'.
# ---------------------------------------------------------------------------


def _max_order_quantity(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_ORDER_QUANTITY
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_ORDER_QUANTITY entry applies.")
    return _compare_ceiling(
        rule, inputs.intent.quantity, limit.value, limit.unit, strict=True,
        label="Requested quantity",
    )


def _max_order_notional(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_ORDER_NOTIONAL
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_ORDER_NOTIONAL entry applies.")
    price = inputs.projection.valuation_price
    if price is None:
        return _unavailable(rule, limit, "No reference price to value the order notional.")
    notional = inputs.intent.quantity * price
    return _compare_ceiling(
        rule, notional, limit.value, limit.unit, strict=True, label="Order notional"
    )


def _max_position_quantity(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_POSITION_QUANTITY
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_POSITION_QUANTITY entry applies.")
    current = (
        inputs.projection.after_reservations_abs
        if inputs.projection.after_reservations_abs is not None
        else abs(inputs.projection.current_signed)
    )
    return _ceiling_outcome(
        rule,
        abs(inputs.projection.projected_signed),
        current,
        limit.value,
        limit.unit,
        label="Projected position (after open-order reservations)",
    )


def _max_position_notional(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_POSITION_NOTIONAL
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_POSITION_NOTIONAL entry applies.")
    price = inputs.projection.valuation_price
    if price is None:
        return _unavailable(rule, limit, "No reference price to value the projected position.")
    projected = abs(inputs.projection.projected_signed) * price
    current = (
        abs(
            inputs.projection.after_reservations_abs
            if inputs.projection.after_reservations_abs is not None
            else inputs.projection.current_signed
        )
        * price
    )
    return _ceiling_outcome(
        rule, projected, current, limit.value, limit.unit,
        label="Projected position notional",
    )


def _max_symbol_exposure(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_SYMBOL_EXPOSURE
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_SYMBOL_EXPOSURE entry applies.")
    gross = inputs.projection.symbol_gross_after
    if gross is None:
        return _unavailable(rule, limit, "Symbol exposure cannot be valued.")
    current = (
        inputs.projection.symbol_gross_current
        if inputs.projection.symbol_gross_current is not None
        else gross
    )
    return _ceiling_outcome(
        rule, gross, current, limit.value, limit.unit,
        label="Projected symbol gross exposure",
    )


def _max_strategy_exposure(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_STRATEGY_EXPOSURE
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_STRATEGY_EXPOSURE entry applies.")
    if inputs.intent.strategy_id is None:
        return _unavailable(
            rule, limit, "Order carries no strategy attribution; strategy exposure is unknown."
        )
    after = inputs.projection.strategy_exposure_after
    if after is None:
        return _unavailable(rule, limit, "Strategy exposure cannot be valued.")
    current = (
        inputs.projection.strategy_exposure_current
        if inputs.projection.strategy_exposure_current is not None
        else after
    )
    return _ceiling_outcome(
        rule, after, current, limit.value, limit.unit,
        label="Projected strategy exposure (reservations + this order)",
    )


def _max_exchange_exposure(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_EXCHANGE_EXPOSURE
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_EXCHANGE_EXPOSURE entry applies.")
    gross = inputs.projection.exchange_gross_after
    if gross is None:
        return _unavailable(rule, limit, "Exchange exposure cannot be valued.")
    current = (
        inputs.projection.exchange_gross_current
        if inputs.projection.exchange_gross_current is not None
        else gross
    )
    return _ceiling_outcome(
        rule, gross, current, limit.value, limit.unit,
        label="Projected exchange gross exposure",
    )


def _max_account_exposure(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_ACCOUNT_EXPOSURE
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_ACCOUNT_EXPOSURE entry applies.")
    gross = inputs.projection.account_gross_after
    if gross is None:
        return _unavailable(rule, limit, "Account exposure cannot be valued.")
    current = (
        inputs.projection.account_gross_current
        if inputs.projection.account_gross_current is not None
        else gross
    )
    return _ceiling_outcome(
        rule, gross, current, limit.value, limit.unit,
        label="Projected account gross exposure",
    )


def _max_correlation_group_exposure(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(
            rule, "No MAX_CORRELATION_GROUP_EXPOSURE entry applies to this scope."
        )
    groups = inputs.config.group_registry.groups_for(
        inputs.intent.exchange.value, inputs.intent.symbol
    )
    if not groups:
        return _not_applicable(
            rule, f"{inputs.intent.symbol} is not a member of any correlation group."
        )
    if inputs.projection.valuation_price is None:
        return _unavailable(rule, limit, "Group exposure cannot be valued.")
    breakdown = build_breakdown_from(inputs)
    delta = (
        inputs.projection.exposure_delta
        if inputs.projection.exposure_delta is not None
        else _ZERO
    )
    worst: RuleOutcome | None = None
    for group in groups:
        if group.max_notional is None:
            continue
        observed = _ZERO
        for member in sorted(group.members):
            bucket = breakdown.bucket(ExposureDimension.SYMBOL, member)
            observed += bucket.gross_notional if bucket is not None else _ZERO
        current = observed
        if inputs.intent.symbol in group.members:
            observed += delta
        outcome = _ceiling_outcome(
            rule,
            observed,
            current,
            group.max_notional,
            RiskLimitUnit.QUOTE_NOTIONAL,
            label=f"Projected exposure of correlation group {group.name}",
        )
        if outcome.status is RuleStatus.BREACH:
            return outcome
        worst = outcome if worst is None else worst
    if worst is None:
        return _not_applicable(
            rule, "Groups containing this symbol define no group ceiling."
        )
    return worst


def _max_open_orders(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_OPEN_ORDERS
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_OPEN_ORDERS entry applies.")
    # +1 for the candidate: it is not yet in the snapshot, and counting
    # "already at cap" rather than "the cap this order would exceed" would
    # let a cap of 5 hold six open orders.
    observed = Decimal(len(inputs.snapshot.open_orders) + 1)
    return _compare_ceiling(
        rule, observed, limit.value, limit.unit, strict=False,
        label="Open orders including this one",
    )


def _order_cancel_rate(inputs: RuleInputs, rule: RiskRuleId) -> RuleOutcome:
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, f"No {rule.value} entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    kind = RiskRateKind.ORDERS if rule is RiskRuleId.MAX_ORDER_RATE else RiskRateKind.CANCELS
    if limit.window_micros is None:
        return _unavailable(rule, limit, "Rate entry arrived without a window; configuration bug.")
    count, known = inputs.rates.bucket_for(kind, limit.window_micros)
    if not known or count is None:
        return _unavailable(
            rule, limit, "The rate source could not measure this window; refusing on stale-free grounds."
        )
    return _compare_ceiling(
        rule,
        Decimal(count),
        limit.value,
        limit.unit,
        strict=False,
        label=(
            "orders in window" if kind == RiskRateKind.ORDERS else "cancels in window"
        ),
    )


def _max_daily_loss(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_DAILY_LOSS
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_DAILY_LOSS entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    net = daily_net_pnl(inputs)
    if net is None:
        return _unavailable(
            rule, limit, "Daily PnL inputs incomplete; a loss limit cannot be enforced blind."
        )
    loss = max(_ZERO, -net)
    return _compare_ceiling(
        rule, loss, limit.value, limit.unit, strict=False, label="Net daily loss"
    )


def _max_strategy_daily_loss(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_STRATEGY_DAILY_LOSS
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_STRATEGY_DAILY_LOSS entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    if inputs.intent.strategy_id is None:
        return _unavailable(rule, limit, "Order has no strategy; strategy loss cannot be attributed.")
    if inputs.strategy is None or inputs.strategy.realised_pnl_today is None:
        return _unavailable(rule, limit, "Strategy PnL was not reported by the account layer.")
    loss = max(_ZERO, -inputs.strategy.realised_pnl_today)
    return _compare_ceiling(
        rule, loss, limit.value, limit.unit, strict=False, label="Strategy net daily loss"
    )


def _max_drawdown(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_DRAWDOWN
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_DRAWDOWN entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    account = inputs.snapshot.account
    peak = inputs.snapshot.peak_equity
    if account is None or account.equity is None or peak is None or peak <= _ZERO:
        return _unavailable(
            rule, limit, "Equity or peak equity missing; drawdown is unknown, not zero."
        )
    drawdown_percent = (peak - account.equity) / peak * Decimal(100)
    if drawdown_percent < _ZERO:
        drawdown_percent = _ZERO
    return _compare_ceiling(
        rule, drawdown_percent, limit.value, limit.unit, strict=False,
        label="Drawdown from peak equity",
    )


def _max_consecutive_losses(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_CONSECUTIVE_LOSSES
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_CONSECUTIVE_LOSSES entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    count: int | None
    if inputs.intent.strategy_id is not None and inputs.strategy is not None:
        count = inputs.strategy.consecutive_losses
    else:
        count = inputs.snapshot.consecutive_losses
    if count is None:
        return _unavailable(rule, limit, "The loss-streak source reported nothing for this scope.")
    return _compare_ceiling(
        rule, Decimal(count), limit.value, limit.unit, strict=False,
        label="Consecutive realised losses",
    )


def _max_active_strategies(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_ACTIVE_STRATEGIES
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_ACTIVE_STRATEGIES entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    enabled = {s.strategy_id for s in inputs.snapshot.strategies if s.is_enabled}
    candidate = inputs.intent.strategy_id
    projected_count = len(enabled) + (0 if candidate is None or candidate in enabled else 1)
    return _compare_ceiling(
        rule, Decimal(projected_count), limit.value, limit.unit, strict=False,
        label="Simultaneously enabled strategies (including this one)",
    )


def _max_total_volume(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_TOTAL_VOLUME
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_TOTAL_VOLUME entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    traded = inputs.snapshot.traded_notional_today
    price = inputs.projection.valuation_price
    if traded is None or price is None:
        return _unavailable(
            rule, limit, "Daily turnover or the valuation price is missing; volume cap cannot run."
        )
    observed = traded + inputs.intent.quantity * price
    return _compare_ceiling(
        rule, observed, limit.value, limit.unit, strict=True,
        label="Projected daily traded notional",
    )


def _max_fee_budget(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_FEE_BUDGET
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_FEE_BUDGET entry applies.")
    exempt = _new_risk_exemption(inputs, rule)
    if exempt is not None:
        return exempt
    fees = inputs.snapshot.fees_today
    rate = inputs.config.fee_rate_bps
    price = inputs.projection.valuation_price
    if fees is None:
        return _unavailable(rule, limit, "Daily fee total was not reported.")
    if rate is None or price is None:
        return _unavailable(
            rule,
            limit,
            "No authoritative fee rate configured; the gate does not guess a venue's fee.",
        )
    projected = fees + inputs.intent.quantity * price * rate / _TEN_THOUSAND
    return _compare_ceiling(
        rule, projected, limit.value, limit.unit, strict=True,
        label="Projected daily fees (this order estimated at the configured rate)",
    )


def _max_price_deviation(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_PRICE_DEVIATION
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_PRICE_DEVIATION entry applies.")
    if inputs.intent.price is None:
        return _not_applicable(
            rule,
            "Market orders carry no requested price to deviate; the staleness and "
            "touch-valuation rules govern their pricing instead.",
        )
    reference = deviation_reference(inputs)
    if reference is None or reference[0] <= _ZERO:
        return _unavailable(
            rule,
            limit,
            f"No authoritative {reference_kind_label(inputs)} available for "
            f"{inputs.intent.exchange.value}:{inputs.intent.symbol}.",
        )
    price, kind = reference
    deviation_bps = abs(inputs.intent.price - price) / price * _TEN_THOUSAND
    return _compare_ceiling(
        rule, deviation_bps, limit.value, limit.unit, strict=True,
        label=f"Deviation from {kind}",
    )


def _max_stale_data_age(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_STALE_DATA_AGE
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _not_applicable(rule, "No MAX_STALE_DATA_AGE entry applies.")
    market = inputs.market
    if market is None or market.quote_timestamp_micros is None:
        return _unavailable(
            rule, limit, "Market data for this symbol is missing; staleness cannot be "
            "measured, and an unmeasurable quote is exactly what this rule exists to block."
        )
    age = Decimal(max(inputs.now_micros - market.quote_timestamp_micros, 0))
    return _compare_ceiling(
        rule, age, limit.value, limit.unit, strict=False, label="Quote age"
    )


def _max_leverage(inputs: RuleInputs) -> RuleOutcome:
    rule = RiskRuleId.MAX_LEVERAGE
    if inputs.snapshot.market_type is MarketType.SPOT:
        if inputs.requested_leverage is None or inputs.requested_leverage == _ZERO or (
            inputs.requested_leverage == Decimal(1)
        ):
            return _not_applicable(
                rule,
                "Spot market: no leverage concept; nothing to check and nothing to assume.",
            )
        limit = _limit_for(inputs, rule)
        return RuleOutcome(
            rule_id=rule,
            status=RuleStatus.BREACH,
            observed=inputs.requested_leverage,
            limit=None if limit is None else limit.value,
            unit=None if limit is None else limit.unit,
            detail=(
                "A leverage request on a spot account is refused whatever the "
                "ceiling says: this deployment has not enabled margin, and an "
                "order that needs leverage it does not have is a bug, not a trade."
            ),
        )
    limit = _limit_for(inputs, rule)
    if limit is None:
        return _unavailable(
            rule,
            None,
            f"Market type {inputs.snapshot.market_type.value} requires a "
            "MAX_LEVERAGE ceiling; there is no default leverage for a venue "
            "this engine has not been configured for.",
        )
    if inputs.requested_leverage is None:
        return _unavailable(
            rule, limit, "Non-spot market without a leverage figure on the request."
        )
    return _compare_ceiling(
        rule, inputs.requested_leverage, limit.value, limit.unit, strict=False,
        label="Requested leverage",
    )


# ---------------------------------------------------------------------------
# Shared helpers for the evaluators above.
# ---------------------------------------------------------------------------


def daily_net_pnl(inputs: RuleInputs) -> Decimal | None:
    """Net daily PnL per the configuration's inclusion rules.

    Realised is always in. Fees are subtracted when
    ``daily_loss_includes_fees`` (default true: fee bleed is a real loss).
    Unrealised is added only when ``daily_loss_includes_unrealized`` is set,
    because *mark-to-market is not a daily-loss oracle*: a config that
    counts open marks is a config that halts on price moves, and the flag
    must be flipped on purpose, never by default.

    Returns ``None`` (unknown) when the mandatory realised input is missing;
    an optional input marked included-but-missing also yields ``None`` -
    "includes unrealized" with no unrealized number is not permission to
    evaluate against a partial definition.
    """
    snapshot = inputs.snapshot
    config = inputs.config
    if snapshot.realised_pnl_today is None:
        return None
    total = snapshot.realised_pnl_today
    if config.daily_loss_includes_fees:
        if snapshot.fees_today is None:
            return None
        total -= snapshot.fees_today
    if config.daily_loss_includes_unrealized:
        if snapshot.unrealised_pnl_today is None:
            return None
        total += snapshot.unrealised_pnl_today
    return total


def deviation_reference(inputs: RuleInputs) -> tuple[Decimal, str] | None:
    """(price, label) for the configured reference kind, from live state."""
    kind = inputs.config.price_deviation_reference
    market = inputs.market
    if kind is PriceReferenceKind.MID and market is not None:
        mid = market.mid_price
        return (mid, "mid") if mid is not None else None
    if kind is PriceReferenceKind.BEST_BID:
        if market is not None and market.best_bid is not None:
            return market.best_bid, "best bid"
        if inputs.book_top is not None and inputs.book_top.best_bid is not None:
            return inputs.book_top.best_bid, "best bid"
        return None
    if kind is PriceReferenceKind.BEST_ASK:
        if market is not None and market.best_ask is not None:
            return market.best_ask, "best ask"
        if inputs.book_top is not None and inputs.book_top.best_ask is not None:
            return inputs.book_top.best_ask, "best ask"
        return None
    if kind is PriceReferenceKind.SIDE_TOUCH:
        # Buy against the ask (the price it pays now), sell against the bid:
        # the touch the order would cross. Deviating from the *mid* on a
        # wide-spread book lets a marketable-looking limit pay a hidden
        # spread; the side touch is the price the trader is actually asking
        # to trade at, and the honest yardstick for "abnormal".
        if market is None:
            if inputs.book_top is None:
                return None
            if inputs.intent.side.value == "BUY":
                return (
                    (inputs.book_top.best_ask, "best ask (touch)")
                    if inputs.book_top.best_ask is not None
                    else None
                )
            return (
                (inputs.book_top.best_bid, "best bid (touch)")
                if inputs.book_top.best_bid is not None
                else None
            )
        if inputs.intent.side.value == "BUY":
            return (market.best_ask, "best ask (touch)") if market.best_ask is not None else None
        return (market.best_bid, "best bid (touch)") if market.best_bid is not None else None
    if kind is PriceReferenceKind.LAST_TRADE:
        if market is not None and market.last_trade_price is not None:
            return market.last_trade_price, "last trade"
        return None
    return None


def reference_kind_label(inputs: RuleInputs) -> str:
    return inputs.config.price_deviation_reference.value.lower().replace("_", " ")


def build_breakdown_from(inputs: RuleInputs) -> ExposureBreakdown:
    """The *current* (pre-order) exposure breakdown, shared with correlation."""
    from wlct_trading.risk.exposure import build_breakdown

    return build_breakdown(inputs.snapshot.projecting_context())



def _max_order_rate(inputs: RuleInputs) -> RuleOutcome:
    return _order_cancel_rate(inputs, RiskRuleId.MAX_ORDER_RATE)


def _max_cancel_rate(inputs: RuleInputs) -> RuleOutcome:
    return _order_cancel_rate(inputs, RiskRuleId.MAX_CANCEL_RATE)


_EVALUATORS: dict[RiskRuleId, Callable[[RuleInputs], RuleOutcome]] = {
    RiskRuleId.MAX_ORDER_QUANTITY: _max_order_quantity,
    RiskRuleId.MAX_ORDER_NOTIONAL: _max_order_notional,
    RiskRuleId.MAX_POSITION_QUANTITY: _max_position_quantity,
    RiskRuleId.MAX_POSITION_NOTIONAL: _max_position_notional,
    RiskRuleId.MAX_SYMBOL_EXPOSURE: _max_symbol_exposure,
    RiskRuleId.MAX_STRATEGY_EXPOSURE: _max_strategy_exposure,
    RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE: _max_correlation_group_exposure,
    RiskRuleId.MAX_EXCHANGE_EXPOSURE: _max_exchange_exposure,
    RiskRuleId.MAX_ACCOUNT_EXPOSURE: _max_account_exposure,
    RiskRuleId.MAX_OPEN_ORDERS: _max_open_orders,
    RiskRuleId.MAX_ORDER_RATE: _max_order_rate,
    RiskRuleId.MAX_CANCEL_RATE: _max_cancel_rate,
    RiskRuleId.MAX_DAILY_LOSS: _max_daily_loss,
    RiskRuleId.MAX_STRATEGY_DAILY_LOSS: _max_strategy_daily_loss,
    RiskRuleId.MAX_DRAWDOWN: _max_drawdown,
    RiskRuleId.MAX_CONSECUTIVE_LOSSES: _max_consecutive_losses,
    RiskRuleId.MAX_ACTIVE_STRATEGIES: _max_active_strategies,
    RiskRuleId.MAX_TOTAL_VOLUME: _max_total_volume,
    RiskRuleId.MAX_FEE_BUDGET: _max_fee_budget,
    RiskRuleId.MAX_STALE_DATA_AGE: _max_stale_data_age,
    RiskRuleId.MAX_PRICE_DEVIATION: _max_price_deviation,
    RiskRuleId.MAX_LEVERAGE: _max_leverage,
}


def rule_evaluator(rule: RiskRuleId) -> Callable[[RuleInputs], RuleOutcome]:
    """The evaluator for one rule id. Raises on an unknown rule (fail closed)."""
    try:
        return _EVALUATORS[rule]
    except KeyError as exc:
        raise LookupError(
            f"No evaluator is registered for risk rule {rule.value}; the "
            "catalog and the evaluator table must be extended together."
        ) from exc


def assert_catalog_coherence() -> None:
    """Called at gate construction; the import-time proof of invariants.

    Every rule in the order has an evaluator, every evaluator belongs to
    exactly one of the two behaviour classes, and no evaluator exists for a
    rule nobody ordered. Cheaper than an incident and impossible to forget,
    because :class:`~wlct_trading.risk.evaluator.RiskGate` calls it.
    """
    missing_evaluator = [rule.value for rule in RISK_RULE_ORDER if rule not in _EVALUATORS]
    if missing_evaluator:
        raise RuntimeError(
            f"Rules without evaluators (refusing to build a gate that would "
            f"silently skip them): {missing_evaluator}"
        )
    extra = [rule.value for rule in _EVALUATORS if rule not in RISK_RULE_ORDER]
    if extra:
        raise RuntimeError(f"Evaluators outside the rule order: {extra}")
    classes = NEW_RISK_RULES | INTEGRITY_RULES
    if classes != frozenset(_EVALUATORS):
        gap = frozenset(_EVALUATORS) ^ classes
        raise RuntimeError(
            "Every rule must be declared new-risk or integrity exactly once; "
            f"misclassified: {sorted(gap)}"
        )


def evaluate_rules(
    inputs: RuleInputs,
    *,
    on_error: Callable[[RiskRuleId, Exception], RuleOutcome] | None = None,
) -> tuple[RuleOutcome, ...]:
    """Run the whole catalog in declared order, one outcome per rule.

    ``on_error`` decides what a raising evaluator becomes; the gate passes a
    builder that produces ``UNVERIFIABLE`` (and records the exception in a
    risk event), so an internal bug denies orders instead of - by omitting
    the outcome - approving them. The default raises, because *tests* want
    the traceback.
    """
    outcomes: list[RuleOutcome] = []
    for rule in RISK_RULE_ORDER:
        evaluator = rule_evaluator(rule)
        try:
            outcomes.append(evaluator(inputs))
        except Exception as exc:  # the one deliberate catch in the catalog
            if on_error is None:
                raise
            outcomes.append(on_error(rule, exc))
    return tuple(outcomes)
