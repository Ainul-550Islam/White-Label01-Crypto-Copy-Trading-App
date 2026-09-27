"""Strongly typed, versioned, hierarchically resolved risk configuration.

Resolution rule (the whole thing, stated once):

* an entry applies when its ``scope`` target matches the evaluation context
  (GLOBAL always; EXCHANGE/ACCOUNT/STRATEGY/SYMBOL only when the named target
  matches) **and** it is enabled **and** the decision time falls inside its
  effective window;
* among applicable entries for one rule, the **minimum value** wins, for
  every rule in this catalog - all 22 rules are upper bounds;
* ties on the value are broken deterministically by ``priority`` (lower
  first), then scope depth, then entry ``version``, so two deployments with
  equal data produce byte-identical ``ResolvedLimit.entries`` provenance.

A child scope can tighten and can never widen: because the effective value
is the minimum over *all* applicable entries, a strategy entry of 3000
against a global 10000 yields 3000, and a strategy entry of 50000 against a
global 10000 still yields 10000. The 50000 is not an error - it is simply
inert - and the resolution provenance shows which entry actually governed.

Immutability and versioning follow the Part 7 dataset discipline: a
configuration document carries a content ``digest`` that is recomputed and
cross-checked on load, and edits produce a new ``config_version``. A stale
snapshot (one whose ``config_version`` predates the live pointer) is refused
by the gate; there is no in-place mutation anywhere in this module.

Decimal discipline: every value is a ``Decimal`` parsed from strings or
integers. A ``float`` in a payload is a hard validation error, because a
limit expressed as ``1000.1`` must not quietly become ``1000.0999999999999``.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Final, Mapping, Sequence

from wlct_trading.enums import (
    RISK_LIMIT_SCOPE_PRIORITY,
    RISK_RULE_ORDER,
    RISK_RULE_UNITS,
    PriceReferenceKind,
    RiskLimitScope,
    RiskLimitUnit,
    RiskRuleId,
)
from wlct_trading.risk.correlation import CorrelationGroup, CorrelationGroupRegistry
from wlct_trading.risk.protections import AutomaticProtectionPolicy

__all__ = [
    "RiskLimitEntry",
    "RiskConfiguration",
    "ResolvedLimit",
    "ScopeContext",
    "RiskConfigurationError",
    "UnknownRiskRuleError",
    "RATE_WINDOW_ONE_SECOND_MICROS",
    "RATE_WINDOW_ONE_MINUTE_MICROS",
]

#: Rate rules are expressed against one of exactly two windows. More window
#: sizes would need a bucket algebra; two windows cover per-second and
#: per-minute policy, which is what the exchange limits and the incident
#: history actually use.
RATE_WINDOW_ONE_SECOND_MICROS: Final[int] = 1_000_000
RATE_WINDOW_ONE_MINUTE_MICROS: Final[int] = 60_000_000
_RATE_WINDOWS: Final[frozenset[int]] = frozenset(
    {RATE_WINDOW_ONE_SECOND_MICROS, RATE_WINDOW_ONE_MINUTE_MICROS}
)

_RATE_RULES: Final[frozenset[RiskRuleId]] = frozenset(
    {RiskRuleId.MAX_ORDER_RATE, RiskRuleId.MAX_CANCEL_RATE}
)


class RiskConfigurationError(ValueError):
    """The configuration document is malformed, contradictory or invalid."""


class UnknownRiskRuleError(RiskConfigurationError):
    """The document references a rule id that does not exist in the catalog.

    A separate class because the operator remediation differs: "fix your
    number" versus "this build does not know that rule" - the latter means a
    worker is running behind the control plane, and trading on a worker that
    cannot see a rule is exactly the bypass this error exists to catch.
    """


def _decimal_from_raw(raw: object, *, where: str) -> Decimal:
    """Parse a strict ``Decimal``; refuse floats and anything lossy."""
    if isinstance(raw, Decimal):
        value = raw
    elif isinstance(raw, int):
        value = Decimal(raw)
    elif isinstance(raw, float):
        raise RiskConfigurationError(
            f"{where}: float {raw!r} is not accepted as a risk limit; encode "
            "the exact decimal as a string. Binary floats cannot represent "
            "money precisely, and a limit rounded at construction is a "
            "limit nobody configured."
        )
    elif isinstance(raw, str):
        try:
            value = Decimal(raw)
        except InvalidOperation as exc:
            raise RiskConfigurationError(
                f"{where}: {raw!r} is not a decimal number."
            ) from exc
    else:
        raise RiskConfigurationError(
            f"{where}: expected a decimal value, got {type(raw).__name__}."
        )
    if not value.is_finite():
        raise RiskConfigurationError(f"{where}: {value} is not finite.")
    return value


@dataclass(slots=True, frozen=True)
class RiskLimitEntry:
    """One configured ceiling: a rule, a scope, a value, a version."""

    rule_id: RiskRuleId
    scope: RiskLimitScope
    #: GLOBAL entries must not set a target; every other scope must.
    target: str | None
    enabled: bool
    #: The ceiling itself. Stored normalised (``normalize()``) so "3000.0"
    #: and "3000" compare and hash identically.
    value: Decimal
    unit: RiskLimitUnit
    #: Tie-breaker among entries with the same value. Lower wins; equal
    #> priorities are broken by scope depth and version, never by insertion.
    priority: int
    #: Microsecond epoch bounds of applicability; ``None`` end = open-ended.
    effective_from_micros: int
    effective_until_micros: int | None
    #: Per-entry revision, for humans. The document-level ``config_version``
    #: is what snapshots bind to.
    entry_version: int
    #: Only for rate rules: the window ``value`` is measured over.
    window_micros: int | None = None

    def __post_init__(self) -> None:
        value = self.value.normalize()
        if value != self.value:
            object.__setattr__(self, "value", value)
        self._validate()

    # -- validation ------------------------------------------------------
    def _validate(self) -> None:
        allowed_units = RISK_RULE_UNITS.get(self.rule_id)
        if allowed_units is None:
            raise UnknownRiskRuleError(f"Unknown risk rule {self.rule_id!r}.")
        if self.unit not in allowed_units:
            raise RiskConfigurationError(
                f"Rule {self.rule_id.value} does not accept unit "
                f"{self.unit.value}; expected one of "
                f"{sorted(u.value for u in allowed_units)}."
            )
        if self.scope is RiskLimitScope.GLOBAL:
            if self.target is not None:
                raise RiskConfigurationError(
                    "GLOBAL entries must not carry a target."
                )
        elif not self.target:
            raise RiskConfigurationError(
                f"{self.scope.value} entries require a non-empty target."
            )
        if self.effective_until_micros is not None:
            if self.effective_until_micros <= self.effective_from_micros:
                raise RiskConfigurationError(
                    "effective_until_micros must be after effective_from_micros."
                )
        if self.entry_version < 1:
            raise RiskConfigurationError("entry_version must be >= 1.")
        if self.rule_id in _RATE_RULES:
            if self.window_micros not in _RATE_WINDOWS:
                raise RiskConfigurationError(
                    f"{self.rule_id.value} requires window_micros of exactly "
                    f"{RATE_WINDOW_ONE_SECOND_MICROS} (1s) or "
                    f"{RATE_WINDOW_ONE_MINUTE_MICROS} (60s)."
                )
            if self.value < 0:
                raise RiskConfigurationError("Rate ceilings must be >= 0.")
        elif self.window_micros is not None:
            raise RiskConfigurationError(
                "window_micros is only meaningful on rate rules."
            )
        self._validate_value_domain()

    def _validate_value_domain(self) -> None:
        match self.unit:
            case RiskLimitUnit.COUNT:
                if self.value < 0:
                    raise RiskConfigurationError("Count ceilings must be >= 0.")
                if self.value != self.value.to_integral_value():
                    raise RiskConfigurationError("Count ceilings must be integral.")
            case RiskLimitUnit.LEVERAGE_X:
                if self.value < 1:
                    raise RiskConfigurationError(
                        "A leverage ceiling below 1x cannot be satisfied by "
                        "any position; configure the rule disabled instead."
                    )
            case RiskLimitUnit.AGE_MICROS:
                if self.value <= 0:
                    raise RiskConfigurationError("Staleness budgets must be > 0.")
            case RiskLimitUnit.PERCENT:
                if not Decimal(0) < self.value <= Decimal(100):
                    raise RiskConfigurationError(
                        "Percent ceilings are configured in (0, 100]."
                    )
            case RiskLimitUnit.BPS:
                if self.value < 0:
                    raise RiskConfigurationError("Basis-point ceilings must be >= 0.")
            case (
                RiskLimitUnit.BASE_QUANTITY
                | RiskLimitUnit.QUOTE_NOTIONAL
                | RiskLimitUnit.LOSS
            ):
                if self.value <= 0:
                    raise RiskConfigurationError(
                        "Quantity, notional and loss ceilings must be > 0."
                    )

    def applies_at(self, context: "ScopeContext") -> bool:
        """Scope, enablement and time-window applicability, in that order."""
        if not self.enabled:
            return False
        if not self.window_covers(context.now_micros):
            return False
        match self.scope:
            case RiskLimitScope.GLOBAL:
                return True
            case RiskLimitScope.EXCHANGE:
                return context.exchange is not None and self.target == context.exchange
            case RiskLimitScope.ACCOUNT:
                return context.account_id is not None and self.target == context.account_id
            case RiskLimitScope.STRATEGY:
                return (
                    context.strategy_id is not None
                    and self.target == context.strategy_id
                )
            case RiskLimitScope.SYMBOL:
                return context.symbol is not None and self.target == context.symbol
        raise RiskConfigurationError(f"Unhandled limit scope {self.scope!r}.")

    def window_covers(self, now_micros: int) -> bool:
        if now_micros < self.effective_from_micros:
            return False
        return self.effective_until_micros is None or now_micros < (
            self.effective_until_micros
        )

    # -- wire form -------------------------------------------------------
    def to_payload(self) -> dict[str, Any]:
        return {
            "ruleId": self.rule_id.value,
            "scope": self.scope.value,
            "target": self.target,
            "enabled": self.enabled,
            "value": str(self.value),
            "unit": self.unit.value,
            "priority": self.priority,
            "effectiveFromMicros": self.effective_from_micros,
            "effectiveUntilMicros": self.effective_until_micros,
            "entryVersion": self.entry_version,
            "windowMicros": self.window_micros,
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "RiskLimitEntry":
        keys = set(payload)
        expected = {
            "ruleId",
            "scope",
            "target",
            "enabled",
            "value",
            "unit",
            "priority",
            "effectiveFromMicros",
            "effectiveUntilMicros",
            "entryVersion",
            "windowMicros",
        }
        unknown = keys - expected
        missing = expected - keys
        if unknown:
            raise RiskConfigurationError(
                f"Unknown limit-entry keys: {sorted(unknown)}. Risk entries "
                "are a closed vocabulary; silently ignoring unrecognised "
                "fields is how a typo becomes an unenforced limit."
            )
        if missing:
            raise RiskConfigurationError(f"Missing limit-entry keys: {sorted(missing)}.")
        rule_raw = payload["ruleId"]
        try:
            rule_id = RiskRuleId(rule_raw)
        except ValueError as exc:
            raise UnknownRiskRuleError(
                f"Unknown risk rule id {rule_raw!r}; this build cannot "
                "evaluate it, so it must not be ignored."
            ) from exc
        scope_raw = payload["scope"]
        unit_raw = payload["unit"]
        try:
            scope = RiskLimitScope(scope_raw)
            unit = RiskLimitUnit(unit_raw)
        except ValueError as exc:
            raise RiskConfigurationError(
                f"Unknown scope {scope_raw!r} or unit {unit_raw!r}."
            ) from exc
        window_raw = payload["windowMicros"]
        if window_raw is not None and not isinstance(window_raw, int):
            raise RiskConfigurationError("windowMicros must be an int or null.")
        for name in ("priority", "effectiveFromMicros", "entryVersion"):
            if not isinstance(payload[name], int) or isinstance(payload[name], bool):
                raise RiskConfigurationError(f"{name} must be an integer.")
        until_raw = payload["effectiveUntilMicros"]
        if until_raw is not None and (
            not isinstance(until_raw, int) or isinstance(until_raw, bool)
        ):
            raise RiskConfigurationError("effectiveUntilMicros must be an int or null.")
        if not isinstance(payload["enabled"], bool):
            raise RiskConfigurationError("enabled must be a boolean.")
        target_raw = payload["target"]
        if target_raw is not None and not isinstance(target_raw, str):
            raise RiskConfigurationError("target must be a string or null.")
        return cls(
            rule_id=rule_id,
            scope=scope,
            target=target_raw,
            enabled=payload["enabled"],
            value=_decimal_from_raw(payload["value"], where=f"entry[{rule_id.value}]"),
            unit=unit,
            priority=int(payload["priority"]),
            effective_from_micros=int(payload["effectiveFromMicros"]),
            effective_until_micros=None if until_raw is None else int(until_raw),
            entry_version=int(payload["entryVersion"]),
            window_micros=None if window_raw is None else int(window_raw),
        )

    @property
    def scope_depth(self) -> int:
        return RISK_LIMIT_SCOPE_PRIORITY.index(self.scope)


@dataclass(slots=True, frozen=True)
class ScopeContext:
    """What a decision is being made *for*: the chain of scope targets."""

    exchange: str | None
    account_id: str | None
    strategy_id: str | None
    symbol: str | None
    now_micros: int


@dataclass(slots=True, frozen=True)
class ResolvedLimit:
    """The governing value for one rule and the provenance behind it."""

    rule_id: RiskRuleId
    value: Decimal
    unit: RiskLimitUnit
    #: Every applicable entry, most-restrictive first. The first is the one
    #: that governed; the rest are recorded so an operator can see the whole
    #: chain (and spot the strategy entry that would have widened the limit
    #: if widening were possible).
    entries: tuple[RiskLimitEntry, ...]
    #: Rate rules only: the window the value governs.
    window_micros: int | None

    def to_payload(self) -> dict[str, Any]:
        return {
            "ruleId": self.rule_id.value,
            "value": str(self.value),
            "unit": self.unit.value,
            "windowMicros": self.window_micros,
            "governing": {
                "scope": self.entries[0].scope.value,
                "target": self.entries[0].target,
                "entryVersion": self.entries[0].entry_version,
            },
            "applicableEntryCount": len(self.entries),
        }


class RiskConfiguration:
    """One immutable, versioned, digest-checked risk configuration document.

    ``config_version`` is assigned by the control plane (the API bumps it on
    every accepted mutation; there is no way to publish a version here).
    ``digest`` is content-addressed over everything that affects decisions
    and excludes the version number itself - two revisions that restore an
    older policy must be distinguishable by version but identical by digest,
    and conflating the two would make "same limits, new revision" look like
    a new policy.
    """

    __slots__ = (
        "_entries",
        "_config_version",
        "_groups",
        "_group_registry",
        "_protection_policy",
        "_daily_loss_includes_unrealized",
        "_daily_loss_includes_fees",
        "_price_deviation_reference",
        "_fee_rate_bps",
        "_notes",
        "_digest",
        "_by_rule",
    )

    def __init__(
        self,
        *,
        entries: Sequence[RiskLimitEntry],
        config_version: int = 1,
        correlation_groups: Sequence[CorrelationGroup] = (),
        protection_policy: AutomaticProtectionPolicy | None = None,
        daily_loss_includes_unrealized: bool = False,
        daily_loss_includes_fees: bool = True,
        price_deviation_reference: PriceReferenceKind = PriceReferenceKind.SIDE_TOUCH,
        fee_rate_bps: Decimal | None = None,
        notes: str = "",
    ) -> None:
        if config_version < 1:
            raise RiskConfigurationError("config_version must be >= 1.")
        if fee_rate_bps is not None and fee_rate_bps < 0:
            raise RiskConfigurationError("fee_rate_bps must be >= 0 when set.")
        if fee_rate_bps is not None and not fee_rate_bps.is_finite():
            raise RiskConfigurationError("fee_rate_bps must be finite.")
        if len(notes) > 500:
            raise RiskConfigurationError("notes must stay within 500 characters.")
        ordered = tuple(
            sorted(
                entries,
                key=lambda e: (
                    RISK_RULE_ORDER.index(e.rule_id),
                    e.scope_depth,
                    e.target or "",
                    -e.priority,
                    e.value,
                    e.entry_version,
                ),
            )
        )
        self._entries = ordered
        self._config_version = config_version
        self._groups = tuple(correlation_groups)
        self._group_registry = CorrelationGroupRegistry(self._groups)
        self._protection_policy = (
            protection_policy
            if protection_policy is not None
            else AutomaticProtectionPolicy()
        )
        self._daily_loss_includes_unrealized = daily_loss_includes_unrealized
        self._daily_loss_includes_fees = daily_loss_includes_fees
        self._price_deviation_reference = price_deviation_reference
        self._fee_rate_bps = fee_rate_bps
        self._notes = notes
        self._digest = self._compute_digest()
        by_rule: dict[RiskRuleId, list[RiskLimitEntry]] = {}
        for entry in ordered:
            by_rule.setdefault(entry.rule_id, []).append(entry)
        self._by_rule: Mapping[RiskRuleId, tuple[RiskLimitEntry, ...]] = {
            rule: tuple(values) for rule, values in by_rule.items()
        }

    # -- properties -------------------------------------------------------
    @property
    def entries(self) -> tuple[RiskLimitEntry, ...]:
        return self._entries

    @property
    def config_version(self) -> int:
        return self._config_version

    @property
    def digest(self) -> str:
        return self._digest

    @property
    def correlation_groups(self) -> tuple[CorrelationGroup, ...]:
        return self._groups

    @property
    def group_registry(self) -> CorrelationGroupRegistry:
        return self._group_registry

    @property
    def protection_policy(self) -> AutomaticProtectionPolicy:
        return self._protection_policy

    @property
    def daily_loss_includes_unrealized(self) -> bool:
        return self._daily_loss_includes_unrealized

    @property
    def daily_loss_includes_fees(self) -> bool:
        return self._daily_loss_includes_fees

    @property
    def price_deviation_reference(self) -> PriceReferenceKind:
        return self._price_deviation_reference

    @property
    def fee_rate_bps(self) -> Decimal | None:
        return self._fee_rate_bps

    @property
    def notes(self) -> str:
        return self._notes

    # -- validation --------------------------------------------------------
    def validate(self) -> list[str]:
        """Structural errors across the whole document (entries self-check).

        Entry-level validation has already run in each constructor; this
        covers cross-entry and cross-field problems: duplicate identity,
        rule coverage sanity and group/limit coherence.
        """
        errors: list[str] = []
        seen: set[tuple[str, str, str, int]] = set()
        for entry in self._entries:
            identity = (
                entry.rule_id.value,
                entry.scope.value,
                entry.target or "",
                entry.entry_version,
            )
            if identity in seen:
                errors.append(
                    f"Duplicate entry identity {identity}: identical rule, "
                    "scope, target and version. Two entries nobody can "
                    "distinguish are one entry with an audit problem."
                )
            seen.add(identity)
        group_names = [group.name for group in self._groups]
        if len(group_names) != len(set(group_names)):
            errors.append("Correlation group names must be unique.")
        for group in self._groups:
            has_symbol_limits = any(
                entry.rule_id is RiskRuleId.MAX_SYMBOL_EXPOSURE
                and entry.scope is RiskLimitScope.SYMBOL
                and entry.target in group.members
                for entry in self._entries
            )
            if group.max_notional is not None and not has_symbol_limits:
                errors.append(
                    f"Correlation group {group.name} has a notional ceiling "
                    "but none of its members carries MAX_SYMBOL_EXPOSURE at "
                    "SYMBOL scope. A group ceiling is a cap on the union, "
                    "not a replacement for per-symbol limits; refusing a "
                    "shape that could be read as either."
                )
        return errors

    def raise_if_invalid(self) -> None:
        errors = self.validate()
        if errors:
            raise RiskConfigurationError("; ".join(errors))

    # -- resolution ---------------------------------------------------------
    def applicable_entries(self, rule: RiskRuleId, context: ScopeContext) -> tuple[
        RiskLimitEntry, ...
    ]:
        """All enabled, in-window, scope-matching entries for ``rule``.

        Sorted most-restrictive first. An entry whose rule id this build does
        not know cannot reach here (construction rejects it), so "unknown
        rule" is a configuration error, never a silent skip.
        """
        candidates = [
            entry
            for entry in self._by_rule.get(rule, ())
            if entry.applies_at(context)
        ]
        candidates.sort(
            key=lambda e: (e.value, e.priority, e.scope_depth, -e.entry_version)
        )
        return tuple(candidates)

    def resolve(self, rule: RiskRuleId, context: ScopeContext) -> ResolvedLimit | None:
        """The governing ceiling for ``rule``, or ``None`` when unconfigured."""
        entries = self.applicable_entries(rule, context)
        if not entries:
            return None
        winner = entries[0]
        return ResolvedLimit(
            rule_id=rule,
            value=winner.value,
            unit=winner.unit,
            entries=entries,
            window_micros=winner.window_micros,
        )

    def resolve_all(self, context: ScopeContext) -> dict[RiskRuleId, ResolvedLimit]:
        """Every rule with at least one applicable entry, in catalog order."""
        out: dict[RiskRuleId, ResolvedLimit] = {}
        for rule in RISK_RULE_ORDER:
            resolved = self.resolve(rule, context)
            if resolved is not None:
                out[rule] = resolved
        return out

    # -- digest and wire form ------------------------------------------------
    def canonical_payload(self) -> dict[str, Any]:
        """The exact dict the digest is computed over. ``config_version`` is
        metadata, deliberately excluded (see the class docstring)."""
        return {
            "entries": [entry.to_payload() for entry in self._entries],
            "correlationGroups": [
                {
                    "name": g.name,
                    "exchange": g.exchange,
                    "members": sorted(g.members),
                    "maxNotional": None if g.max_notional is None else str(g.max_notional),
                    "rationale": g.rationale,
                }
                for g in sorted(self._groups, key=lambda g: (g.exchange, g.name))
            ],
            "protectionPolicy": self._protection_policy.to_payload(),
            "dailyLossIncludesUnrealized": self._daily_loss_includes_unrealized,
            "dailyLossIncludesFees": self._daily_loss_includes_fees,
            "priceDeviationReference": self._price_deviation_reference.value,
            "feeRateBps": None if self._fee_rate_bps is None else str(self._fee_rate_bps),
        }

    def canonical_json(self) -> str:
        return json.dumps(
            self.canonical_payload(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )

    def _compute_digest(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def to_payload(self) -> dict[str, Any]:
        payload = self.canonical_payload()
        payload["configVersion"] = self._config_version
        payload["digest"] = self._digest
        payload["notes"] = self._notes
        return payload

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "RiskConfiguration":
        """Strict load with digest self-verification (manifest discipline).

        A document that disagrees with its own ``digest`` was tampered with
        or truncated; the load fails rather than trusting the content.
        """
        keys = set(payload)
        expected = {
            "entries",
            "correlationGroups",
            "protectionPolicy",
            "dailyLossIncludesUnrealized",
            "dailyLossIncludesFees",
            "priceDeviationReference",
            "feeRateBps",
            "configVersion",
            "digest",
            "notes",
        }
        unknown = keys - expected
        missing = expected - keys
        if unknown:
            raise RiskConfigurationError(
                f"Unknown configuration keys: {sorted(unknown)}."
            )
        if missing:
            raise RiskConfigurationError(
                f"Missing configuration keys: {sorted(missing)}."
            )
        raw_entries = payload["entries"]
        if not isinstance(raw_entries, list):
            raise RiskConfigurationError("entries must be a list.")
        entries = tuple(
            RiskLimitEntry.from_payload(_require_mapping(entry))
            for entry in raw_entries
        )
        raw_groups = payload["correlationGroups"]
        if not isinstance(raw_groups, list):
            raise RiskConfigurationError("correlationGroups must be a list.")
        groups = tuple(
            _group_from_payload(_require_mapping(item)) for item in raw_groups
        )
        version_raw = payload["configVersion"]
        if not isinstance(version_raw, int) or isinstance(version_raw, bool):
            raise RiskConfigurationError("configVersion must be an integer.")
        flags = {
            name: payload[name]
            for name in ("dailyLossIncludesUnrealized", "dailyLossIncludesFees")
        }
        for name, value in flags.items():
            if not isinstance(value, bool):
                raise RiskConfigurationError(f"{name} must be a boolean.")
        reference_raw = payload["priceDeviationReference"]
        try:
            reference = PriceReferenceKind(reference_raw)
        except ValueError as exc:
            raise RiskConfigurationError(
                f"Unknown price deviation reference {reference_raw!r}."
            ) from exc
        fee_raw = payload["feeRateBps"]
        fee = None if fee_raw is None else _decimal_from_raw(fee_raw, where="feeRateBps")
        notes_raw = payload["notes"]
        if not isinstance(notes_raw, str):
            raise RiskConfigurationError("notes must be a string.")
        config = cls(
            entries=entries,
            config_version=version_raw,
            correlation_groups=groups,
            protection_policy=AutomaticProtectionPolicy.from_payload(
                _require_mapping(payload["protectionPolicy"])
            ),
            daily_loss_includes_unrealized=flags["dailyLossIncludesUnrealized"],
            daily_loss_includes_fees=flags["dailyLossIncludesFees"],
            price_deviation_reference=reference,
            fee_rate_bps=fee,
            notes=notes_raw,
        )
        declared_digest = payload["digest"]
        if not isinstance(declared_digest, str) or not _is_sha256_hex(declared_digest):
            raise RiskConfigurationError(
                "digest must be a lowercase sha256 hex string."
            )
        if declared_digest != config.digest:
            raise RiskConfigurationError(
                "Configuration digest mismatch: the document does not match "
                "the configuration it claims to be. Refusing to load it."
            )
        config.raise_if_invalid()
        return config


def _require_mapping(item: object) -> Mapping[str, Any]:
    if not isinstance(item, dict):
        raise RiskConfigurationError(
            f"Expected an object in the configuration payload, got {type(item).__name__}."
        )
    return item


def _is_sha256_hex(value: str) -> bool:
    if len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
        return False
    return True


def _group_from_payload(payload: Mapping[str, Any]) -> CorrelationGroup:
    keys = set(payload)
    expected = {"name", "exchange", "members", "maxNotional", "rationale"}
    if keys - expected or expected - keys:
        raise RiskConfigurationError(
            "Correlation group payload keys must be exactly "
            f"{sorted(expected)}; got {sorted(keys)}."
        )
    members_raw = payload["members"]
    if not isinstance(members_raw, list) or not all(
        isinstance(m, str) for m in members_raw
    ):
        raise RiskConfigurationError("members must be a list of strings.")
    max_raw = payload["maxNotional"]
    max_notional = None if max_raw is None else _decimal_from_raw(max_raw, where="group.maxNotional")
    name = payload["name"]
    exchange = payload["exchange"]
    rationale = payload["rationale"]
    if not isinstance(name, str) or not isinstance(exchange, str) or not isinstance(
        rationale, str
    ):
        raise RiskConfigurationError(
            "Group name, exchange and rationale must be strings."
        )
    return CorrelationGroup(
        name=name,
        exchange=exchange,
        members=frozenset(m.upper() for m in members_raw if isinstance(m, str)),
        max_notional=max_notional,
        rationale=rationale,
    )
