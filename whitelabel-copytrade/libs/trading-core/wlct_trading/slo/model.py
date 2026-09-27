"""The SLO model: definitions, indicator universe, canonical checksum.

Numbers, stated once so the whole package (and its TypeScript twin) is
honest about them:

* Objectives are DECIMAL strings in every persisted or wire form, bounded
  0 < objective < 100 with at most 4 decimal places. 100.0 is not a legal
  objective - a 100% SLO has an empty error budget by definition, and an
  evaluator that divides by "allowed failure" must never pretend otherwise.
  Deployments that want "zero tolerance" get it via `SloState.EXHAUSTED on
  the first bad event` (allowed_ppm = 0 handling below), not by 100.
* Every ratio is reduced to integer parts-per-million (ppm) before any
  comparison. Decimal is used for input parsing and human display only. Two
  languages, one integer grid: this is what makes the committed parity
  fixture possible without a floating-point conversation.
* Windows are whole minutes, bounded [5, 10080] (a week). SLOs with windows
  measured in seconds are latency dashboards, and this platform already has
  those; SLO evaluation is a minute-cadence discipline.

Insufficient-data honesty is the model's core value: an evaluation state of
`HEALTHY` requires evidence that good things happened AND nothing said they
didn't. `UNKNOWN` is a first-class state (the dashboard shows it, burn
alerts do not fire from it, and readiness does not read it) because the
alternative - counting telemetry gaps as successes - is how SLOs quietly
become fiction.

This module imports nothing from the trading packages, and nothing from the
trading path imports it (the Part 10 boundary test pins both directions).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

__all__ = [
    "SloIndicator",
    "SloState",
    "SloWindowKind",
    "SloDefinition",
    "objective_to_ppm",
    "canonical_slo_json",
    "slo_checksum",
    "MIN_WINDOW_MINUTES",
    "MAX_WINDOW_MINUTES",
]

MIN_WINDOW_MINUTES = 5
MAX_WINDOW_MINUTES = 10_080  # a week


class SloIndicator(str, Enum):
    """The nine bounded indicator types (spec Section 5). Each maps to a
    fixed evaluation shape in :mod:`wlct_trading.slo.evaluate`; there is no
    generic "custom expression" escape hatch, because an SLO language you
    can extend is an SLO language your TS replica cannot follow."""

    AVAILABILITY = "availability"
    REQUEST_SUCCESS_RATIO = "request_success_ratio"
    QUEUE_PROCESSING_SUCCESS = "queue_processing_success"
    QUEUE_FRESHNESS = "queue_freshness"
    MARKET_DATA_FRESHNESS = "market_data_freshness"
    RISK_STATE_FRESHNESS = "risk_state_freshness"
    RECONCILIATION_FRESHNESS = "reconciliation_freshness"
    LATENCY_THRESHOLD_COMPLIANCE = "latency_threshold_compliance"
    ERROR_RATE_COMPLIANCE = "error_rate_compliance"


COUNT_INDICATORS: frozenset[SloIndicator] = frozenset(
    {
        SloIndicator.AVAILABILITY,
        SloIndicator.REQUEST_SUCCESS_RATIO,
        SloIndicator.QUEUE_PROCESSING_SUCCESS,
        SloIndicator.LATENCY_THRESHOLD_COMPLIANCE,
        SloIndicator.ERROR_RATE_COMPLIANCE,
    }
)

FRESHNESS_INDICATORS: frozenset[SloIndicator] = frozenset(
    {
        SloIndicator.QUEUE_FRESHNESS,
        SloIndicator.MARKET_DATA_FRESHNESS,
        SloIndicator.RISK_STATE_FRESHNESS,
        SloIndicator.RECONCILIATION_FRESHNESS,
    }
)


class SloState(str, Enum):
    """Five states; the order is the display order, not a severity ladder
    (UNKNOWN sits last because it is orthogonal, not mild)."""

    HEALTHY = "HEALTHY"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    EXHAUSTED = "EXHAUSTED"
    UNKNOWN = "UNKNOWN"


class SloWindowKind(str, Enum):
    SHORT = "short"
    LONG = "long"


_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,62}$")
_OWNER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@-]{0,63}$")


def _decimal_string(value: object, *, field_name: str) -> str:
    """Accept a Decimal or a canonical decimal STRING; reject float outright.

    The float rejection is the same rule the risk configuration enforces
    (and for the same reason): a percentage that has been through IEEE-754
    is not the percentage anyone configured, and silently tolerating floats
    in an SLO document is how a 99.9 becomes 99.90000000000000036 and every
    checksum downstream moves.
    """
    if isinstance(value, float):
        raise ValueError(f"{field_name} must be a decimal string or Decimal, not float")
    if isinstance(value, Decimal):
        normalized = value.normalize()
    else:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a decimal string or Decimal")
        try:
            normalized = Decimal(value).normalize()
        except InvalidOperation as error:
            raise ValueError(f"{field_name} is not a finite decimal string") from error
    if not normalized.is_finite():
        raise ValueError(f"{field_name} must be finite")
    exponent = normalized.as_tuple().exponent
    if isinstance(exponent, int) and exponent > 0:
        # 1E+2 style: render plain so canonical strings never contain E+.
        # The isinstance guard is not paranoia about mypy only: a non-finite
        # Decimal reaches this tuple with an 'n'/'N'/'F' exponent, and the
        # finiteness check above is what keeps that unreachable - the guard
        # documents the invariant rather than trusting it.
        normalized = normalized.quantize(Decimal(1))
    return str(normalized)


def objective_to_ppm(objective: str) -> int:
    """Objective percentage string -> compliance target in ppm (0..10^6).

    99.5 -> 995000 exactly. Raises for anything outside (0, 100); the
    equality-at-100 exclusion is deliberate per the module docstring.
    """
    try:
        value = Decimal(objective)
    except (InvalidOperation, TypeError) as error:
        # One error type for one contract: "not a decimal string" is a
        # caller bug, not an arithmetic event; never leak InvalidOperation.
        raise ValueError("objective is not a decimal string") from error
    if not Decimal(0) < value < Decimal(100):
        raise ValueError("objective must satisfy 0 < objective < 100")
    exponent = value.as_tuple().exponent
    if isinstance(exponent, int) and -exponent > 4:
        raise ValueError("objective supports at most 4 decimal places")
    ppm = (value * 10_000).to_integral_value()
    return int(ppm)


@dataclass(frozen=True, slots=True)
class SloDefinition:
    """One versioned service-level objective.

    ``good_event``/``bad_event`` are human bounded descriptions of the
    counting rule the source collector applies (which status classes are
    good, which ages count as fresh, what a queue failure is); they travel
    in the payload so the checksum commits the HUMAN definition alongside
    the numbers - changing the prose of a good-event rule changes the
    version identity, which is the point of having both here.
    """

    slo_id: str
    service: str
    description: str
    owner: str
    indicator: SloIndicator
    objective: str  # canonical decimal string, e.g. "99.5"
    window_minutes: int
    short_window_minutes: int
    good_event: str
    bad_event: str
    warning_burn_ppm: int = 1_000_000  # 1.0x burn
    critical_burn_ppm: int = 2_000_000  # 2.0x burn
    enabled: bool = True
    version: int = 1
    # Freshness indicators carry the age threshold; latency compliance carries
    # the threshold bucket. Both absent for pure-count indicators, enforced
    # by validate().
    max_age_micros: int | None = None
    latency_threshold_micros: int | None = None

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not _ID_PATTERN.fullmatch(self.slo_id):
            errors.append("slo_id must be a bounded lowercase identifier")
        if not _ID_PATTERN.fullmatch(self.service):
            errors.append("service must be a bounded lowercase identifier")
        if not _OWNER_PATTERN.fullmatch(self.owner):
            errors.append("owner must be a bounded team identifier")
        if not self.description or len(self.description) > 200:
            errors.append("description must be 1..200 characters")
        if not 1 <= len(self.good_event) <= 200 or not 1 <= len(self.bad_event) <= 200:
            errors.append("good_event/bad_event must be 1..200 characters")
        if not MIN_WINDOW_MINUTES <= self.window_minutes <= MAX_WINDOW_MINUTES:
            errors.append("window_minutes out of bounds")
        if not MIN_WINDOW_MINUTES <= self.short_window_minutes <= self.window_minutes:
            errors.append("short_window_minutes must sit inside the window")
        if self.version < 1:
            errors.append("version must be >= 1")
        if self.warning_burn_ppm <= 0 or self.critical_burn_ppm <= 0:
            errors.append("burn thresholds must be positive ppm")
        if self.critical_burn_ppm < self.warning_burn_ppm:
            errors.append("critical burn threshold must be >= warning burn threshold")
        try:
            objective_to_ppm(self.objective)
        except ValueError as error:
            errors.append(str(error))
        if self.indicator in FRESHNESS_INDICATORS:
            if self.max_age_micros is None or self.max_age_micros <= 0:
                errors.append(f"{self.indicator.value} requires max_age_micros > 0")
            if self.latency_threshold_micros is not None:
                errors.append(f"{self.indicator.value} must not carry latency_threshold_micros")
        elif self.indicator is SloIndicator.LATENCY_THRESHOLD_COMPLIANCE:
            if self.latency_threshold_micros is None or self.latency_threshold_micros <= 0:
                errors.append("latency compliance requires latency_threshold_micros > 0")
            if self.max_age_micros is not None:
                errors.append("latency compliance must not carry max_age_micros")
        else:
            if self.max_age_micros is not None or self.latency_threshold_micros is not None:
                errors.append("count indicators carry no thresholds; use a threshold indicator")
        return errors

    def canonical_payload(self) -> dict[str, Any]:
        """The checksummed view of the definition. Version and enabled are
        EXCLUDED from the digest by intent: flipping enablement or bumping
        the version counter must not change the identity of the OBJECTIVE -
        the same rule Part 8 applied to config_version. Everything that
        changes what the promise MEANS moves the digest."""
        return {
            "sloId": self.slo_id,
            "service": self.service,
            "description": self.description,
            "owner": self.owner,
            "indicator": self.indicator.value,
            "objective": self.objective,
            "windowMinutes": self.window_minutes,
            "shortWindowMinutes": self.short_window_minutes,
            "goodEvent": self.good_event,
            "badEvent": self.bad_event,
            "warningBurnPpm": self.warning_burn_ppm,
            "criticalBurnPpm": self.critical_burn_ppm,
            "maxAgeMicros": self.max_age_micros,
            "latencyThresholdMicros": self.latency_threshold_micros,
        }

    def __post_init__(self) -> None:
        # Normalize decimal inputs at construction so two definitions that
        # mean the same thing cannot have two spellings (and two checksums).
        object.__setattr__(self, "objective", _decimal_string(self.objective, field_name="objective"))
        errors = self.validate()
        if errors:
            raise ValueError(f"SloDefinition {self.slo_id}: " + "; ".join(errors))


def canonical_slo_json(payload: dict[str, Any]) -> str:
    """Compact, sorted, ASCII-escaped JSON. Mirrors the Part 8 canonicaliser
    so the TS replica (which reuses ``risk.digest.ts``) can reproduce it."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def slo_checksum(definition: SloDefinition) -> str:
    return hashlib.sha256(canonical_slo_json(definition.canonical_payload()).encode("utf-8")).hexdigest()
