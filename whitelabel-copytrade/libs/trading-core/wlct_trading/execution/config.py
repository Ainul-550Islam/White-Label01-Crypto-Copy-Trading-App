"""Execution configuration and the live-trading safety rules.

Two properties matter more than anything else in this file:

1. **Omission is never permission.** Every switch that could move real money
   defaults to the safe value, and the resolved mode is computed from an
   explicit agreement between several independent settings. A missing variable,
   a typo, or a half-finished deployment yields ``DISABLED``.
2. **Ambiguity is rejected, never resolved silently.** ``LIVE_TRADING_ENABLED``
   together with ``DRY_RUN`` is a contradiction: one says transmit, the other
   says do not. Guessing either way would be wrong, so startup fails with a
   message naming both settings.

The trading-mode decision itself is delegated to the Part 2
:class:`~wlct_trading.risk.TradingModeResolver`, which already requires three
settings to agree. This module adds the execution-side switches around it
rather than reimplementing the decision.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from wlct_trading.enums import TradingMode
from wlct_trading.risk import TradingModeResolver

__all__ = [
    "ExecutionSettings",
    "InvalidExecutionSettings",
    "UnsafeExecutionConfiguration",
]


class InvalidExecutionSettings(ValueError):
    """A setting is malformed or out of range."""


class UnsafeExecutionConfiguration(InvalidExecutionSettings):
    """The settings are individually valid but dangerous in combination.

    Raised at startup so an operator sees it in a deployment log, not at 3am in
    an order-rejection storm.
    """


def _parse_bool(raw: str | None, default: bool, *, name: str) -> bool:
    """Strict boolean parsing.

    Anything unrecognised raises rather than defaulting. On a switch that gates
    real-money trading, reading ``"ture"`` as ``False`` and carrying on is not
    acceptable behaviour even though ``False`` is the safe direction — the
    operator's intent is unknown and must be clarified.
    """
    if raw is None or raw.strip() == "":
        return default
    lowered = raw.strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise InvalidExecutionSettings(
        f"{name} must be a boolean (true/false); got {raw!r}."
    )


def _parse_int(
    raw: str | None,
    default: int,
    *,
    name: str,
    minimum: int,
    maximum: int,
) -> int:
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = int(raw.strip())
        except ValueError as exc:
            raise InvalidExecutionSettings(
                f"{name} must be an integer; got {raw!r}."
            ) from exc
    if not minimum <= value <= maximum:
        raise InvalidExecutionSettings(
            f"{name} must be between {minimum} and {maximum}; got {value}."
        )
    return value


@dataclass(frozen=True, slots=True)
class ExecutionSettings:
    """Everything that governs whether and how an order may be transmitted.

    Contains no credentials. Secrets are resolved through a
    :class:`~wlct_trading.execution.credentials.CredentialProvider` at the point
    of use, so this object can be logged in full — and
    :meth:`to_public_dict` is used for exactly that at startup.
    """

    # --- Mode switches -------------------------------------------------
    #: Master switch. Even ``True`` is not sufficient on its own: the Part 2
    #: resolver additionally requires TRADING_MODE=LIVE and
    #: LIVE_TRADING_CONFIRMED=true.
    live_trading_enabled: bool = False
    #: Build, validate and risk-check the order, then stop before transmission.
    dry_run: bool = True
    #: Route to the simulated venue.
    paper_trading: bool = True

    #: Feeds the Part 2 TradingModeResolver.
    trading_mode_setting: str = ""
    trading_enabled: bool = False
    live_trading_confirmed: bool = False

    # --- Timeouts and intervals ----------------------------------------
    order_request_timeout_ms: int = 10_000
    order_reconciliation_interval_ms: int = 60_000
    exchange_time_sync_interval_ms: int = 300_000
    #: How long to wait before reconciling an order whose fate is unknown. Long
    #: enough for the venue to have finished processing, short enough that the
    #: position is not a mystery for minutes.
    order_unknown_reconciliation_delay_ms: int = 2_000
    execution_idempotency_ttl_seconds: int = 86_400
    private_stream_reconnect_enabled: bool = True
    private_stream_listen_key_refresh_ms: int = 1_800_000

    # --- Safety envelopes ----------------------------------------------
    max_clock_skew_ms: int = 1_000
    recv_window_ms: int = 5_000
    #: Refuse to submit if the risk snapshot is older than this.
    max_risk_state_age_ms: int = 5_000
    #: Bound on submission retries for genuinely retryable failures. Never
    #: applied to an ambiguous result — that path reconciles instead.
    max_submit_attempts: int = 1
    #: Part 8: require the extended risk gate to be wired before the engine
    #: will construct. The core Part 2 gate is *always* mandatory regardless
    #: of this flag - there is no setting that skips risk evaluation. What
    #: this governs is whether the deployment additionally demands the
    #: rule-catalog layer (hierarchical config, protections, reservation
    #: ledger). ``from_env`` maps ``RISK_ENGINE_ENABLED`` onto it with a
    #: default of **true**, so an environment-configured worker that forgot
    #: to wire the gate fails at startup; direct constructions (tests,
    #: embedders) keep the conservative-by-behaviour default of false
    #: because they *are* the callers that decide their own wiring.
    risk_gate_required: bool = False
    #: Micros a crash-stranded budget reservation may block capacity before
    #: Redis reclaims it. Bounded above by the reconciliation window; a longer
    #: TTL is not "safer", it is a longer outage of trading capacity.
    risk_reservation_ttl_micros: int = 300_000_000

    def __post_init__(self) -> None:
        self._assert_safe_combination()

    # ------------------------------------------------------------------
    # Safety rules
    # ------------------------------------------------------------------
    def _assert_safe_combination(self) -> None:
        """Reject contradictory or dangerous combinations.

        Documented rules, in the order they are checked:

        1. ``LIVE_TRADING_ENABLED=true`` with ``DRY_RUN=true`` is **rejected**.
           They are direct opposites and there is no defensible default.
        2. ``LIVE_TRADING_ENABLED=true`` with ``PAPER_TRADING=true`` is
           **rejected** for the same reason.
        3. ``LIVE_TRADING_ENABLED=true`` requires ``TRADING_MODE=LIVE``,
           ``TRADING_ENABLED=true`` and ``LIVE_TRADING_CONFIRMED=true``. Any
           disagreement is rejected, rather than quietly downgrading to paper —
           a silent downgrade hides a production misconfiguration.
        4. ``recvWindow`` above Binance's 60 000 ms cap is rejected.
        """
        if self.live_trading_enabled and self.dry_run:
            raise UnsafeExecutionConfiguration(
                "LIVE_TRADING_ENABLED=true and DRY_RUN=true contradict each "
                "other: one says transmit orders, the other says never "
                "transmit. Refusing to guess. Set DRY_RUN=false to trade live, "
                "or LIVE_TRADING_ENABLED=false to keep dry-run."
            )
        if self.live_trading_enabled and self.paper_trading:
            raise UnsafeExecutionConfiguration(
                "LIVE_TRADING_ENABLED=true and PAPER_TRADING=true contradict "
                "each other. Set PAPER_TRADING=false to trade live, or "
                "LIVE_TRADING_ENABLED=false to keep paper trading."
            )
        if self.live_trading_enabled:
            missing: list[str] = []
            if self.trading_mode_setting.strip().upper() != TradingMode.LIVE.value:
                missing.append("TRADING_MODE=LIVE")
            if not self.trading_enabled:
                missing.append("TRADING_ENABLED=true")
            if not self.live_trading_confirmed:
                missing.append("LIVE_TRADING_CONFIRMED=true")
            if missing:
                raise UnsafeExecutionConfiguration(
                    "LIVE_TRADING_ENABLED=true but the following are not set: "
                    + ", ".join(missing)
                    + ". Live trading requires every one of them to agree, so "
                    "that no single misconfigured variable can start real "
                    "trading."
                )
        if not 0 < self.recv_window_ms <= 60_000:
            raise InvalidExecutionSettings(
                f"recv_window_ms must be between 1 and 60000; got "
                f"{self.recv_window_ms}."
            )
        if self.max_submit_attempts < 1:
            raise InvalidExecutionSettings("max_submit_attempts must be at least 1.")
        if not 0 < self.risk_reservation_ttl_micros <= 3_600_000_000:
            raise InvalidExecutionSettings(
                "risk_reservation_ttl_micros must be within (0, 3_600_000_000]; "
                "an hour is already far beyond any legitimate submit-and-record "
                "cycle, and longer holds are an availability wound dressed as "
                "safety."
            )

    # ------------------------------------------------------------------
    # Derived state
    # ------------------------------------------------------------------
    @property
    def trading_mode(self) -> TradingMode:
        """Effective mode, via the Part 2 resolver.

        Paper trading is reported as ``PAPER`` only when the resolver agrees;
        ``PAPER_TRADING=true`` alone does not start a trading engine, it only
        selects the simulated venue if one is started.
        """
        return TradingModeResolver(
            mode=self.trading_mode_setting,
            trading_enabled=self.trading_enabled,
            live_confirmed=self.live_trading_confirmed,
        ).resolve()

    @property
    def will_transmit_orders(self) -> bool:
        """Whether any order can reach a real exchange with these settings.

        The single question an operator most needs answered, computed from every
        relevant switch rather than from the master flag alone.
        """
        return (
            self.live_trading_enabled
            and not self.dry_run
            and not self.paper_trading
            and self.trading_mode is TradingMode.LIVE
        )

    @property
    def mode_description(self) -> str:
        if self.will_transmit_orders:
            return (
                "LIVE — orders WILL be transmitted to the real exchange with "
                "real funds."
            )
        if self.dry_run:
            return (
                "DRY RUN — orders are built, validated and risk-checked, then "
                "discarded. Nothing is transmitted."
            )
        if self.trading_mode is TradingMode.PAPER:
            return "PAPER — orders route to the simulated venue. All fills are simulated."
        return "DISABLED — no orders are produced."

    def to_public_dict(self) -> dict[str, object]:
        """Log-safe rendering. There are no secrets in this object."""
        return {
            "tradingMode": self.trading_mode.value,
            "liveTradingEnabled": self.live_trading_enabled,
            "dryRun": self.dry_run,
            "paperTrading": self.paper_trading,
            "willTransmitOrders": self.will_transmit_orders,
            "modeDescription": self.mode_description,
            "orderRequestTimeoutMs": self.order_request_timeout_ms,
            "orderReconciliationIntervalMs": self.order_reconciliation_interval_ms,
            "exchangeTimeSyncIntervalMs": self.exchange_time_sync_interval_ms,
            "orderUnknownReconciliationDelayMs": (
                self.order_unknown_reconciliation_delay_ms
            ),
            "executionIdempotencyTtlSeconds": self.execution_idempotency_ttl_seconds,
            "privateStreamReconnectEnabled": self.private_stream_reconnect_enabled,
            "maxClockSkewMs": self.max_clock_skew_ms,
            "recvWindowMs": self.recv_window_ms,
            "maxRiskStateAgeMs": self.max_risk_state_age_ms,
            "riskGateRequired": self.risk_gate_required,
            "riskReservationTtlMicros": self.risk_reservation_ttl_micros,
        }

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def from_env(
        cls, environ: Mapping[str, str] | None = None
    ) -> "ExecutionSettings":
        """Build from the environment, with safe defaults throughout."""
        env = os.environ if environ is None else environ
        return cls(
            live_trading_enabled=_parse_bool(
                env.get("LIVE_TRADING_ENABLED"), False, name="LIVE_TRADING_ENABLED"
            ),
            dry_run=_parse_bool(env.get("DRY_RUN"), True, name="DRY_RUN"),
            paper_trading=_parse_bool(
                env.get("PAPER_TRADING"), True, name="PAPER_TRADING"
            ),
            trading_mode_setting=(env.get("TRADING_MODE") or "").strip(),
            trading_enabled=_parse_bool(
                env.get("TRADING_ENABLED"), False, name="TRADING_ENABLED"
            ),
            live_trading_confirmed=_parse_bool(
                env.get("LIVE_TRADING_CONFIRMED"),
                False,
                name="LIVE_TRADING_CONFIRMED",
            ),
            order_request_timeout_ms=_parse_int(
                env.get("ORDER_REQUEST_TIMEOUT_MS"),
                10_000,
                name="ORDER_REQUEST_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            order_reconciliation_interval_ms=_parse_int(
                env.get("ORDER_RECONCILIATION_INTERVAL_MS"),
                60_000,
                name="ORDER_RECONCILIATION_INTERVAL_MS",
                minimum=1_000,
                maximum=3_600_000,
            ),
            exchange_time_sync_interval_ms=_parse_int(
                env.get("EXCHANGE_TIME_SYNC_INTERVAL_MS"),
                300_000,
                name="EXCHANGE_TIME_SYNC_INTERVAL_MS",
                minimum=1_000,
                maximum=3_600_000,
            ),
            order_unknown_reconciliation_delay_ms=_parse_int(
                env.get("ORDER_UNKNOWN_RECONCILIATION_DELAY_MS"),
                2_000,
                name="ORDER_UNKNOWN_RECONCILIATION_DELAY_MS",
                minimum=0,
                maximum=300_000,
            ),
            execution_idempotency_ttl_seconds=_parse_int(
                env.get("EXECUTION_IDEMPOTENCY_TTL_SECONDS"),
                86_400,
                name="EXECUTION_IDEMPOTENCY_TTL_SECONDS",
                minimum=60,
                maximum=2_592_000,
            ),
            private_stream_reconnect_enabled=_parse_bool(
                env.get("PRIVATE_STREAM_RECONNECT_ENABLED"),
                True,
                name="PRIVATE_STREAM_RECONNECT_ENABLED",
            ),
            private_stream_listen_key_refresh_ms=_parse_int(
                env.get("PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS"),
                1_800_000,
                name="PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS",
                minimum=60_000,
                maximum=3_300_000,
            ),
            max_clock_skew_ms=_parse_int(
                env.get("EXCHANGE_MAX_CLOCK_SKEW_MS"),
                1_000,
                name="EXCHANGE_MAX_CLOCK_SKEW_MS",
                minimum=10,
                maximum=30_000,
            ),
            recv_window_ms=_parse_int(
                env.get("EXCHANGE_RECV_WINDOW_MS"),
                5_000,
                name="EXCHANGE_RECV_WINDOW_MS",
                minimum=100,
                maximum=60_000,
            ),
            max_risk_state_age_ms=_parse_int(
                env.get("MAX_RISK_STATE_AGE_MS"),
                5_000,
                name="MAX_RISK_STATE_AGE_MS",
                minimum=100,
                maximum=300_000,
            ),
            risk_gate_required=_parse_bool(
                env.get("RISK_ENGINE_ENABLED"),
                True,
                name="RISK_ENGINE_ENABLED",
            ),
            risk_reservation_ttl_micros=_parse_int(
                env.get("RISK_RESERVATION_TTL_MS"),
                300_000,
                name="RISK_RESERVATION_TTL_MS",
                minimum=1_000,
                maximum=3_600_000,
            )
            * 1_000,
            max_submit_attempts=_parse_int(
                env.get("MAX_SUBMIT_ATTEMPTS"),
                1,
                name="MAX_SUBMIT_ATTEMPTS",
                minimum=1,
                maximum=3,
            ),
        )
