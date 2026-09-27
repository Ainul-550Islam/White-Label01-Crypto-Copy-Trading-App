"""The decision-code vocabulary, kept in one table.

Three concerns live here, and they are all *translation* concerns - this
module decides nothing:

1. :data:`RULE_TO_DECISION_CODE` binds each catalogued rule to the stable
   machine code its breach reports under. A risk event row, a violation on a
   ``RiskDecision`` and an admin badge must agree on that string, so the
   mapping is defined once.
2. :data:`DECISION_CODE_ALIASES` records how the Part 8 specification's
   example names (``ALLOW``, ``KILL_SWITCH_ACTIVE``, ``MAX_DAILY_LOSS``, ...)
   resolve onto the Part 2 codes that already ship in production tables. The
   old names stay canonical; the spec examples become lookups. Renaming wire
   values that a thousand rows already carry would be a migration dressed up
   as a rename.
3. :func:`decision_code_for_rule` fails loudly on an unrecognised rule id
   instead of defaulting - an unknown rule is exactly the "unknown becomes
   an approval" bug this package exists to prevent.
"""

from __future__ import annotations

from typing import Final

from wlct_trading.enums import RiskDecisionCode, RiskRuleId

__all__ = [
    "RULE_TO_DECISION_CODE",
    "DECISION_CODE_ALIASES",
    "decision_code_for_rule",
    "is_failure_code",
]


#: The single authority for "rule X refuses with code Y". Total over
#: ``RiskRuleId`` - a new rule without an entry here is a KeyError at import
#: of this table's completeness test, which is precisely when it should be
#: noticed.
RULE_TO_DECISION_CODE: Final[dict[RiskRuleId, RiskDecisionCode]] = {
    RiskRuleId.MAX_ORDER_QUANTITY: RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED,
    RiskRuleId.MAX_ORDER_NOTIONAL: RiskDecisionCode.MAX_ORDER_NOTIONAL_EXCEEDED,
    RiskRuleId.MAX_POSITION_QUANTITY: RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED,
    RiskRuleId.MAX_POSITION_NOTIONAL: RiskDecisionCode.MAX_POSITION_NOTIONAL_EXCEEDED,
    RiskRuleId.MAX_ACCOUNT_EXPOSURE: RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED,
    RiskRuleId.MAX_SYMBOL_EXPOSURE: RiskDecisionCode.MAX_SYMBOL_EXPOSURE_EXCEEDED,
    RiskRuleId.MAX_STRATEGY_EXPOSURE: RiskDecisionCode.MAX_STRATEGY_EXPOSURE_EXCEEDED,
    RiskRuleId.MAX_EXCHANGE_EXPOSURE: RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED,
    RiskRuleId.MAX_OPEN_ORDERS: RiskDecisionCode.MAX_OPEN_ORDERS_EXCEEDED,
    RiskRuleId.MAX_DAILY_LOSS: RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED,
    RiskRuleId.MAX_STRATEGY_DAILY_LOSS: RiskDecisionCode.STRATEGY_LOSS_LIMIT_BREACHED,
    RiskRuleId.MAX_DRAWDOWN: RiskDecisionCode.MAX_DRAWDOWN_EXCEEDED,
    RiskRuleId.MAX_LEVERAGE: RiskDecisionCode.MAX_LEVERAGE_EXCEEDED,
    RiskRuleId.MAX_ORDER_RATE: RiskDecisionCode.ORDER_RATE_EXCEEDED,
    RiskRuleId.MAX_CANCEL_RATE: RiskDecisionCode.CANCEL_RATE_EXCEEDED,
    RiskRuleId.MAX_PRICE_DEVIATION: RiskDecisionCode.PRICE_DEVIATION_EXCEEDED,
    RiskRuleId.MAX_STALE_DATA_AGE: RiskDecisionCode.STALE_MARKET_DATA,
    RiskRuleId.MAX_CONSECUTIVE_LOSSES: RiskDecisionCode.MAX_CONSECUTIVE_LOSSES_EXCEEDED,
    RiskRuleId.MAX_ACTIVE_STRATEGIES: RiskDecisionCode.TOO_MANY_ACTIVE_STRATEGIES,
    RiskRuleId.MAX_TOTAL_VOLUME: RiskDecisionCode.MAX_VOLUME_EXCEEDED,
    RiskRuleId.MAX_FEE_BUDGET: RiskDecisionCode.FEE_BUDGET_EXCEEDED,
    RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE: (
        RiskDecisionCode.CORRELATION_GROUP_EXPOSURE_EXCEEDED
    ),
}

#: Part 8 spec example name -> the stable code that serves it. Operators paste
#: these into runbooks and dashboards; the table documents the equivalence so
#: nobody re-introduces "KILL_SWITCH_ACTIVE" as a second spelling of
#: "KILL_SWITCH_ENGAGED".
DECISION_CODE_ALIASES: Final[dict[str, RiskDecisionCode]] = {
    "ALLOW": RiskDecisionCode.APPROVED,
    "KILL_SWITCH_ACTIVE": RiskDecisionCode.KILL_SWITCH_ENGAGED,
    "GLOBAL_KILL_SWITCH": RiskDecisionCode.KILL_SWITCH_ENGAGED,
    "EXCHANGE_KILL_SWITCH": RiskDecisionCode.KILL_SWITCH_ENGAGED,
    "STRATEGY_KILL_SWITCH": RiskDecisionCode.KILL_SWITCH_ENGAGED,
    "SYMBOL_KILL_SWITCH": RiskDecisionCode.KILL_SWITCH_ENGAGED,
    "ACCOUNT_KILL_SWITCH": RiskDecisionCode.KILL_SWITCH_ENGAGED,
    "RISK_KILL_SWITCH": RiskDecisionCode.KILL_SWITCH_ENGAGED,
    "RISK_STATE_STALE": RiskDecisionCode.STALE_RISK_STATE,
    "MAX_ORDER_SIZE": RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED,
    "MAX_POSITION_SIZE": RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED,
    "MAX_NOTIONAL": RiskDecisionCode.MAX_ORDER_NOTIONAL_EXCEEDED,
    "MAX_EXPOSURE": RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED,
    "MAX_DAILY_LOSS": RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED,
    "MAX_STRATEGY_LOSS": RiskDecisionCode.STRATEGY_LOSS_LIMIT_BREACHED,
    "RATE_LIMIT_EXCEEDED": RiskDecisionCode.ORDER_RATE_EXCEEDED,
    "PRICE_DEVIATION": RiskDecisionCode.PRICE_DEVIATION_EXCEEDED,
    "STALE_MARKET_DATA": RiskDecisionCode.STALE_MARKET_DATA,
    "INVALID_ACCOUNT_STATE": RiskDecisionCode.INVALID_ACCOUNT_STATE,
    "INVALID_POSITION_STATE": RiskDecisionCode.INVALID_POSITION_STATE,
    "INVALID_REQUEST": RiskDecisionCode.INVALID_INTENT,
    "INSUFFICIENT_BALANCE": RiskDecisionCode.INSUFFICIENT_BALANCE,
    "UNKNOWN_RISK_STATE": RiskDecisionCode.RISK_STATE_UNAVAILABLE,
}


def decision_code_for_rule(rule: RiskRuleId) -> RiskDecisionCode:
    """The code a breach of ``rule`` reports under. Raises on unknown rules."""
    try:
        return RULE_TO_DECISION_CODE[rule]
    except KeyError as exc:  # fail closed at the definition site
        raise ValueError(f"Risk rule {rule!r} has no decision-code mapping.") from exc


def is_failure_code(code: RiskDecisionCode) -> bool:
    """``False`` only for the one approval code. Everything else is a refusal.

    Written as a predicate rather than ``code is not APPROVED`` so that any
    future informational code is *included* in failure tallies by default -
    the fail-closed bias applies to the counters too.
    """
    return code is not RiskDecisionCode.APPROVED
