"""Part 8 risk configuration: hierarchy, versioning, digest, strict parsing.

Acceptance lines covered: deterministic limit hierarchy (spec test 30), risk
configuration versioning (31), plus the fail-closed parsing rules that make
"typo in a limit" a startup error instead of a trading decision.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import (
    PriceReferenceKind,
    ProtectionAction,
    RiskLimitScope,
    RiskLimitUnit,
    RiskRuleId,
)
from wlct_trading.risk.configuration import (
    RATE_WINDOW_ONE_MINUTE_MICROS,
    RATE_WINDOW_ONE_SECOND_MICROS,
    RiskConfiguration,
    RiskConfigurationError,
    RiskLimitEntry,
    ScopeContext,
    UnknownRiskRuleError,
)

NOW = 1_700_000_000_000_000


def entry(
    rule: RiskRuleId,
    value: str,
    scope: RiskLimitScope = RiskLimitScope.GLOBAL,
    target: str | None = None,
    *,
    unit: RiskLimitUnit | None = None,
    enabled: bool = True,
    priority: int = 0,
    window_micros: int | None = None,
    effective_from: int = 0,
    effective_until: int | None = None,
    version: int = 1,
) -> RiskLimitEntry:
    units = {
        RiskRuleId.MAX_ORDER_QUANTITY: RiskLimitUnit.BASE_QUANTITY,
        RiskRuleId.MAX_POSITION_QUANTITY: RiskLimitUnit.BASE_QUANTITY,
        RiskRuleId.MAX_ORDER_NOTIONAL: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_POSITION_NOTIONAL: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_SYMBOL_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_STRATEGY_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_ACCOUNT_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_EXCHANGE_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_CORRELATION_GROUP_EXPOSURE: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_TOTAL_VOLUME: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_FEE_BUDGET: RiskLimitUnit.QUOTE_NOTIONAL,
        RiskRuleId.MAX_DAILY_LOSS: RiskLimitUnit.LOSS,
        RiskRuleId.MAX_STRATEGY_DAILY_LOSS: RiskLimitUnit.LOSS,
        RiskRuleId.MAX_DRAWDOWN: RiskLimitUnit.PERCENT,
        RiskRuleId.MAX_LEVERAGE: RiskLimitUnit.LEVERAGE_X,
        RiskRuleId.MAX_PRICE_DEVIATION: RiskLimitUnit.BPS,
        RiskRuleId.MAX_STALE_DATA_AGE: RiskLimitUnit.AGE_MICROS,
    }
    default_window = None
    if rule in (RiskRuleId.MAX_ORDER_RATE, RiskRuleId.MAX_CANCEL_RATE):
        unit = unit or RiskLimitUnit.COUNT
        default_window = RATE_WINDOW_ONE_MINUTE_MICROS
    elif rule is RiskRuleId.MAX_OPEN_ORDERS:
        unit = unit or RiskLimitUnit.COUNT
    elif rule is RiskRuleId.MAX_CONSECUTIVE_LOSSES:
        unit = RiskLimitUnit.COUNT
    elif rule is RiskRuleId.MAX_ACTIVE_STRATEGIES:
        unit = RiskLimitUnit.COUNT
    resolved_unit = unit or units[rule]
    return RiskLimitEntry(
        rule_id=rule,
        scope=scope,
        target=target,
        enabled=enabled,
        value=Decimal(value),
        unit=resolved_unit,
        priority=priority,
        effective_from_micros=effective_from,
        effective_until_micros=effective_until,
        entry_version=version,
        window_micros=window_micros if window_micros is not None else default_window,
    )


def context(
    *,
    exchange: str | None = "binance",
    account: str | None = "acct-1",
    strategy: str | None = "strat-1",
    symbol: str | None = "BTC-USDT",
) -> ScopeContext:
    return ScopeContext(
        exchange=exchange,
        account_id=account,
        strategy_id=strategy,
        symbol=symbol,
        now_micros=NOW,
    )


class TestHierarchy:
    def test_most_restrictive_wins_at_every_level(self) -> None:
        # The exact worked example from the brief: 10000 / 5000 / 3000 -> 3000.
        config = RiskConfiguration(
            entries=[
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "10000",
                ),
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "5000",
                    RiskLimitScope.ACCOUNT,
                    "acct-1",
                ),
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "3000",
                    RiskLimitScope.STRATEGY,
                    "strat-1",
                ),
            ]
        )
        resolved = config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, context())
        assert resolved is not None
        assert resolved.value == Decimal("3000")
        assert resolved.entries[0].scope is RiskLimitScope.STRATEGY

    def test_child_cannot_widen_a_parent(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000"),
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "50000",
                    RiskLimitScope.STRATEGY,
                    "strat-1",
                ),
            ]
        )
        resolved = config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, context())
        assert resolved is not None
        assert resolved.value == Decimal("1000")
        # the wider child is recorded as applicable - visible, inert.
        assert len(resolved.entries) == 2

    def test_exchange_scope_only_applies_to_its_exchange(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "200",
                    RiskLimitScope.EXCHANGE,
                    "bybit",
                )
            ]
        )
        assert config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, context(exchange="binance")) is None
        resolved = config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, context(exchange="bybit"))
        assert resolved is not None and resolved.value == Decimal("200")

    def test_symbol_scope_requires_matching_symbol(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(
                    RiskRuleId.MAX_ORDER_QUANTITY,
                    "0.5",
                    RiskLimitScope.SYMBOL,
                    "BTC-USDT",
                )
            ]
        )
        assert config.resolve(RiskRuleId.MAX_ORDER_QUANTITY, context(symbol="ETH-USDT")) is None
        assert config.resolve(RiskRuleId.MAX_ORDER_QUANTITY, context()) is not None

    def test_disabled_entry_is_skipped_not_zeroed(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000", enabled=False)
            ]
        )
        assert config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, context()) is None

    def test_effective_window_bounds_applicability(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "500",
                    effective_from=NOW - 60_000_000,
                    effective_until=NOW + 60_000_000,
                ),
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "99999",
                    effective_from=NOW + 60_000_000,
                ),
            ]
        )
        resolved = config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, context())
        assert resolved is not None and resolved.value == Decimal("500")
        future = context()
        late_config = RiskConfiguration(
            entries=[
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "99999",
                    effective_from=NOW + 60_000_000,
                )
            ]
        )
        assert late_config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, future) is None

    def test_ties_broken_by_priority_then_scope_depth(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000", priority=5),
                entry(
                    RiskRuleId.MAX_ORDER_NOTIONAL,
                    "1000",
                    RiskLimitScope.ACCOUNT,
                    "acct-1",
                    priority=5,
                ),
            ]
        )
        resolved = config.resolve(RiskRuleId.MAX_ORDER_NOTIONAL, context())
        assert resolved is not None
        # equal value, equal priority: the shallower scope governs for
        # provenance stability (the account entry applies only to this
        # account; the global one applies everywhere - reporting the global
        # keeps the same decision explainable across accounts).
        assert resolved.entries[0].scope is RiskLimitScope.GLOBAL

    def test_resolve_all_returns_only_configured_rules_in_catalog_order(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(RiskRuleId.MAX_DRAWDOWN, "20"),
                entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000"),
            ]
        )
        resolved = config.resolve_all(context())
        # catalog order, not insertion order - the deterministic sequence the
        # gate (and any digest over its results) depends on.
        assert list(resolved) == [
            RiskRuleId.MAX_ORDER_NOTIONAL,
            RiskRuleId.MAX_DRAWDOWN,
        ]
        assert resolved[RiskRuleId.MAX_ORDER_NOTIONAL].value == Decimal("1000")


class TestVersioningAndDigest:
    def test_digest_is_content_addressed_and_excludes_version(self) -> None:
        entries = [entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000")]
        v1 = RiskConfiguration(entries=entries, config_version=1)
        v2 = RiskConfiguration(entries=entries, config_version=2)
        assert v1.digest == v2.digest
        assert v1.config_version != v2.config_version

    def test_value_change_changes_digest(self) -> None:
        a = RiskConfiguration(entries=[entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000")])
        b = RiskConfiguration(entries=[entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1001")])
        assert a.digest != b.digest

    def test_roundtrip_verifies_digest_and_rejects_tampering(self) -> None:
        config = RiskConfiguration(entries=[entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000")])
        payload = config.to_payload()
        rebuilt = RiskConfiguration.from_payload(payload)
        assert rebuilt.digest == config.digest
        # tamper with the content but keep the stale declared digest
        tampered = dict(payload)
        tampered["entries"] = [
            {**payload["entries"][0], "value": "999999999"}
        ]
        with pytest.raises(RiskConfigurationError, match="digest"):
            RiskConfiguration.from_payload(tampered)

    def test_float_in_payload_is_a_hard_error(self) -> None:
        payload = {
            "ruleId": "MAX_ORDER_NOTIONAL",
            "scope": "GLOBAL",
            "target": None,
            "enabled": True,
            "value": 1000.5,
            "unit": "QUOTE_NOTIONAL",
            "priority": 0,
            "effectiveFromMicros": 0,
            "effectiveUntilMicros": None,
            "entryVersion": 1,
            "windowMicros": None,
        }
        with pytest.raises(RiskConfigurationError, match="float"):
            RiskLimitEntry.from_payload(payload)

    def test_unknown_keys_are_rejected(self) -> None:
        config = RiskConfiguration(entries=[entry(RiskRuleId.MAX_ORDER_NOTIONAL, "1000")])
        payload = config.to_payload()
        payload["suspiciousExtra"] = True
        with pytest.raises(RiskConfigurationError, match="Unknown configuration keys"):
            RiskConfiguration.from_payload(payload)

    def test_unknown_rule_id_raises_the_dedicated_error(self) -> None:
        with pytest.raises(UnknownRiskRuleError, match="Unknown risk rule id"):
            RiskLimitEntry.from_payload(
                {
                    "ruleId": "MAX_NUMBER_OF_VIBES",
                    "scope": "GLOBAL",
                    "target": None,
                    "enabled": True,
                    "value": "10",
                    "unit": "COUNT",
                    "priority": 0,
                    "effectiveFromMicros": 0,
                    "effectiveUntilMicros": None,
                    "entryVersion": 1,
                    "windowMicros": None,
                }
            )


class TestEntryValidation:
    def test_unit_mismatch_is_refused(self) -> None:
        with pytest.raises(RiskConfigurationError, match="does not accept unit"):
            RiskLimitEntry(
                rule_id=RiskRuleId.MAX_ORDER_RATE,
                scope=RiskLimitScope.GLOBAL,
                target=None,
                enabled=True,
                value=Decimal("10"),
                unit=RiskLimitUnit.QUOTE_NOTIONAL,
                priority=0,
                effective_from_micros=0,
                effective_until_micros=None,
                entry_version=1,
                window_micros=RATE_WINDOW_ONE_MINUTE_MICROS,
            )

    def test_global_scope_may_not_carry_a_target(self) -> None:
        with pytest.raises(RiskConfigurationError, match="must not carry a target"):
            RiskLimitEntry(
                rule_id=RiskRuleId.MAX_ORDER_NOTIONAL,
                scope=RiskLimitScope.GLOBAL,
                target="accidentally-me",
                enabled=True,
                value=Decimal("10"),
                unit=RiskLimitUnit.QUOTE_NOTIONAL,
                priority=0,
                effective_from_micros=0,
                effective_until_micros=None,
                entry_version=1,
            )

    def test_non_global_scope_requires_a_target(self) -> None:
        with pytest.raises(RiskConfigurationError, match="non-empty target"):
            RiskLimitEntry(
                rule_id=RiskRuleId.MAX_ORDER_NOTIONAL,
                scope=RiskLimitScope.ACCOUNT,
                target=None,
                enabled=True,
                value=Decimal("10"),
                unit=RiskLimitUnit.QUOTE_NOTIONAL,
                priority=0,
                effective_from_micros=0,
                effective_until_micros=None,
                entry_version=1,
            )

    def test_rate_rules_require_one_of_two_windows(self) -> None:
        with pytest.raises(RiskConfigurationError, match="window_micros"):
            RiskLimitEntry(
                rule_id=RiskRuleId.MAX_ORDER_RATE,
                scope=RiskLimitScope.GLOBAL,
                target=None,
                enabled=True,
                value=Decimal("30"),
                unit=RiskLimitUnit.COUNT,
                priority=0,
                effective_from_micros=0,
                effective_until_micros=None,
                entry_version=1,
                window_micros=5_000_000,
            )
        ok = RiskLimitEntry(
            rule_id=RiskRuleId.MAX_ORDER_RATE,
            scope=RiskLimitScope.GLOBAL,
            target=None,
            enabled=True,
            value=Decimal("30"),
            unit=RiskLimitUnit.COUNT,
            priority=0,
            effective_from_micros=0,
            effective_until_micros=None,
            entry_version=1,
            window_micros=RATE_WINDOW_ONE_SECOND_MICROS,
        )
        assert ok.window_micros == RATE_WINDOW_ONE_SECOND_MICROS

    def test_zero_order_count_ceiling_is_legal_and_meaningful(self) -> None:
        # max_open_orders = 0 means "no orders at all"; refusing it would
        # force a deployment to express "stop" as an absent entry, which
        # means "no opinion" in every other context. Explicit zero stays.
        config = RiskConfiguration(
            entries=[entry(RiskRuleId.MAX_OPEN_ORDERS, "0")]
        )
        resolved = config.resolve(RiskRuleId.MAX_OPEN_ORDERS, context())
        assert resolved is not None and resolved.value == Decimal(0)

    def test_leverage_below_one_is_refused(self) -> None:
        with pytest.raises(RiskConfigurationError, match="below 1x"):
            entry(RiskRuleId.MAX_LEVERAGE, "0.5")

    def test_drawdown_percent_out_of_range_refused(self) -> None:
        with pytest.raises(RiskConfigurationError, match="Percent ceilings"):
            entry(RiskRuleId.MAX_DRAWDOWN, "150")


class TestConfigurationCrossChecks:
    def test_duplicate_identity_is_reported(self) -> None:
        config = RiskConfiguration(
            entries=[
                entry(RiskRuleId.MAX_ORDER_NOTIONAL, "100"),
                entry(RiskRuleId.MAX_ORDER_NOTIONAL, "100"),
            ]
        )
        assert any("Duplicate entry identity" in e for e in config.validate())

    def test_correlation_group_without_member_symbol_limits_is_reported(self) -> None:
        from wlct_trading.risk.correlation import CorrelationGroup

        config = RiskConfiguration(
            entries=[],
            correlation_groups=[
                CorrelationGroup(
                    name="majors",
                    exchange="binance",
                    members=frozenset({"BTC-USDT", "ETH-USDT"}),
                    max_notional=Decimal("5000"),
                )
            ],
        )
        errors = config.validate()
        assert any("MAX_SYMBOL_EXPOSURE" in error for error in errors)
        with pytest.raises(RiskConfigurationError):
            config.raise_if_invalid()

    def test_protection_policy_roundtrip(self) -> None:
        config = RiskConfiguration(
            entries=[entry(RiskRuleId.MAX_DAILY_LOSS, "500")],
        )
        payload = config.to_payload()
        rebuilt = RiskConfiguration.from_payload(payload)
        assert (
            rebuilt.protection_policy.daily_loss_action
            is ProtectionAction.BLOCK_NEW_RISK
        )
        assert (
            rebuilt.protection_policy.allow_risk_reducing_orders is True
        )

    def test_price_reference_choice_is_part_of_the_digest(self) -> None:
        a = RiskConfiguration(
            entries=[entry(RiskRuleId.MAX_PRICE_DEVIATION, "25")],
            price_deviation_reference=PriceReferenceKind.MID,
        )
        b = RiskConfiguration(
            entries=[entry(RiskRuleId.MAX_PRICE_DEVIATION, "25")],
            price_deviation_reference=PriceReferenceKind.SIDE_TOUCH,
        )
        assert a.digest != b.digest
