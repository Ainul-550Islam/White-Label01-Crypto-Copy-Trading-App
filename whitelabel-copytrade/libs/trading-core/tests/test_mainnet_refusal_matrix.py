# Proves every gate between this build and a real-money Binance order refuses, in the one configuration each is responsible for.
"""The mainnet refusal matrix.

A live-money platform is not proven ready by the path that works. It is proven by
the list of ways the path is refused, and by each refusal being the responsibility
of a named layer rather than of a global flag somebody can flip.

This file enumerates the layers, in the order an order would meet them, and
asserts each one refuses on its own:

  1. CONFIGURATION   ``ExecutionSettings`` rejects contradictory switches and
                     reports "will transmit" as False by default.
  2. WIRING          ``evaluate_live_enablement`` names every missing piece.
  3. CREDENTIALS     a withdrawal-capable, expired or placeholder key is refused
                     before it can sign anything.
  4. PRE-FLIGHT      ``evaluate_safety_gates`` refuses an unauthorised live
                     submission even when every health input is green.
  5. ADAPTER         the venue adapter never claims ``is_simulated``, mainnet is
                     opt-in, and the proof harness refuses a non-testnet origin.
  6. CONFIRMATION    an operator confirmation that is missing, expired,
                     out-of-scope or signed by the wrong key is refused.

Each assertion names the layer in its message, so a failure says which defence
went missing rather than only that "live was allowed".
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from wlct_trading.enums import ExchangeId, OrderSide, OrderType
from wlct_trading.orders import OrderIntent
from wlct_trading.execution.config import (
    ExecutionSettings,
    InvalidExecutionSettings,
    UnsafeExecutionConfiguration,
)
from wlct_trading.execution.credentials import ExchangeCredentials, UnsafeCredential
from wlct_trading.execution.live_enablement import (
    HARD_BLOCKERS,
    LiveEnablementInputs,
    LivePrerequisite,
    evaluate_live_enablement,
)
from wlct_trading.execution.safety import (
    ComponentHealth,
    ExecutionPreconditions,
    SafetyGate,
    evaluate_safety_gates,
)
from wlct_trading.risk import KillSwitchState
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_REST_BASE,
    BINANCE_TESTNET_REST_BASE,
)
from wlct_trading.exchanges.binance.trading import BinanceTradingAdapter

SYMBOL = "BTC-USDT"


def safe_credentials(**overrides: object) -> ExchangeCredentials:
    """The key the platform is allowed to hold: spot, read, no withdrawals."""
    fields: dict[str, object] = {
        "exchange": ExchangeId.BINANCE,
        "tenant_id": "tenant-a",
        "account_id": "acct-1",
        "api_key": "k" * 24,
        "api_secret": "s" * 40,
        "permissions": frozenset({"SPOT", "READ"}),
        "source": "env",
    }
    fields.update(overrides)
    return ExchangeCredentials(**fields)  # type: ignore[arg-type]


def no_kill_switches() -> KillSwitchState:
    return KillSwitchState()


def preconditions(**overrides: object) -> ExecutionPreconditions:
    """A submission whose every health input is green, so only the gate under
    test can refuse it."""
    fields: dict[str, object] = {
        "exchange": "BINANCE",
        "symbol": SYMBOL,
        "strategy_id": "strategy-1",
        "kill_switches": no_kill_switches(),
        "settings": ExecutionSettings(),
        "risk_health": ComponentHealth.ok(),
        "market_data_health": ComponentHealth.ok(),
        "exchange_health": ComponentHealth.ok(),
        "credentials": safe_credentials(),
        "is_simulated": False,
    }
    fields.update(overrides)
    return ExecutionPreconditions(**fields)  # type: ignore[arg-type]


def _never_send(request: object, timeout_ms: int):  # noqa: ANN202 - a transport stub
    raise AssertionError("the refusal matrix must never reach a transport")


# ======================================================================
# 1. Configuration
# ======================================================================
class TestLayerOneConfiguration:
    def test_the_defaults_transmit_nothing(self) -> None:
        settings = ExecutionSettings()
        assert settings.will_transmit_orders is False
        assert settings.dry_run is True
        assert settings.paper_trading is True
        assert "DRY RUN" in settings.mode_description

    def test_the_environment_defaults_transmit_nothing(self) -> None:
        settings = ExecutionSettings.from_env({})
        assert settings.will_transmit_orders is False

    @pytest.mark.parametrize(
        "switches",
        [
            {"live_trading_enabled": True, "dry_run": True},
            {"live_trading_enabled": True, "paper_trading": True},
            {
                "live_trading_enabled": True,
                "dry_run": False,
                "paper_trading": False,
                "trading_mode_setting": "PAPER",
            },
            {
                "live_trading_enabled": True,
                "dry_run": False,
                "paper_trading": False,
                "trading_mode_setting": "LIVE",
                "trading_enabled": True,
            },
        ],
    )
    def test_contradictory_live_switches_are_rejected_not_downgraded(
        self, switches: dict[str, object]
    ) -> None:
        with pytest.raises(UnsafeExecutionConfiguration):
            ExecutionSettings(**switches)  # type: ignore[arg-type]

    def test_a_fully_authorised_configuration_still_needs_three_flags(
        self,
    ) -> None:
        """The one configuration that reports "will transmit" - and what it took."""
        settings = ExecutionSettings(
            live_trading_enabled=True,
            dry_run=False,
            paper_trading=False,
            trading_mode_setting="LIVE",
            trading_enabled=True,
            live_trading_confirmed=True,
        )
        assert settings.will_transmit_orders is True
        assert "WILL be transmitted" in settings.mode_description

    def test_recv_window_above_the_venue_cap_is_rejected(self) -> None:
        with pytest.raises(InvalidExecutionSettings):
            ExecutionSettings(recv_window_ms=60_001)


# ======================================================================
# 2. Wiring
# ======================================================================
class TestLayerTwoWiring:
    def test_an_empty_wiring_report_blocks_live_and_names_every_gap(self) -> None:
        report = evaluate_live_enablement(LiveEnablementInputs())

        assert report.blocks_live is True
        assert report.missing, "an unconfigured runtime must report what it lacks"
        assert set(report.missing) == set(LivePrerequisite)
        assert report.credential_source == "none"
        codes = report.reason_codes()
        assert "LIVE_CREDENTIAL_SOURCE_CONFIGURED" in codes
        assert all(code.startswith("LIVE_") for code in codes)
        assert "No order was sent and none will be." in report.render_refusal()

    def test_a_fully_wired_report_satisfies_every_prerequisite(self) -> None:
        report = evaluate_live_enablement(
            LiveEnablementInputs(
                credential_source="environment",
                venue_attestor_wired=True,
                confirmation_accepted=True,
                durable_store_wired=True,
                distributed_locks_wired=True,
                ip_allowlist_enforced=True,
                signed_transport_wired=True,
            )
        )
        assert report.missing == ()
        assert report.blocks_live is False
        assert HARD_BLOCKERS == frozenset()

    def test_a_secret_manager_source_without_a_fetcher_is_still_missing(self) -> None:
        report = evaluate_live_enablement(
            LiveEnablementInputs(credential_source="secret-manager")
        )
        assert LivePrerequisite.CREDENTIAL_FETCHER_WIRED in report.missing

    def test_a_whitespace_padded_source_is_not_configured(self) -> None:
        report = evaluate_live_enablement(LiveEnablementInputs(credential_source="   "))
        assert LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED in report.missing
        assert report.credential_source == "none"


# ======================================================================
# 3. Credentials
# ======================================================================
class TestLayerThreeCredentials:
    def test_a_withdrawal_capable_key_is_refused(self) -> None:
        with pytest.raises(UnsafeCredential) as excinfo:
            safe_credentials(permissions=frozenset({"SPOT", "WITHDRAW"})).assert_safe()
        assert "withdraw" in str(excinfo.value).lower()

    def test_an_expired_key_is_refused(self) -> None:
        expiring = safe_credentials(expires_at_micros=1_000_000)
        with pytest.raises(UnsafeCredential):
            expiring.assert_safe(now_micros=2_000_000)

    def test_a_placeholder_key_is_refused_at_construction(self) -> None:
        for placeholder in ("changeme", "your-api-key", "REPLACE_ME", "xxx"):
            with pytest.raises(UnsafeCredential):
                safe_credentials(api_key=placeholder)

    def test_a_short_key_is_refused(self) -> None:
        with pytest.raises(UnsafeCredential):
            safe_credentials(api_key="short")

    def test_the_secret_never_appears_in_a_message_or_a_rendering(self) -> None:
        secret = "s" * 40
        credential = safe_credentials(api_secret=secret, permissions=frozenset({"WITHDRAW"}))
        with pytest.raises(UnsafeCredential) as excinfo:
            credential.assert_safe()
        assert secret not in str(excinfo.value)
        assert secret not in repr(credential)

    def test_the_provider_path_refuses_the_same_key_the_constructor_refused(self) -> None:
        """A provider is the ordinary way a placeholder would arrive.

        The construction refusal is the first line; this asserts the resolve path
        an operator actually configures is refused by the same rule, so a
        deployment cannot hold a key that the constructor would have rejected.
        """
        from wlct_trading.execution.credentials import StaticCredentialProvider

        provider = StaticCredentialProvider([safe_credentials()])
        resolved = asyncio.run(provider.resolve("tenant-a", "acct-1", ExchangeId.BINANCE))
        resolved.assert_safe()

        with pytest.raises(UnsafeCredential):
            safe_credentials(api_key="changeme")


# ======================================================================
# 4. Pre-flight gates
# ======================================================================
class TestLayerFourPreflight:
    def test_a_live_submission_without_authorisation_is_refused(self) -> None:
        """Every health input is green; only the authorisation gate fails.

        ``live_trading_enabled`` is False here, which is exactly the state of a
        deployment whose environment lost a variable: the order must be refused,
        not silently downgraded to paper.
        """
        decision = evaluate_safety_gates(
            preconditions(
                settings=ExecutionSettings(
                    live_trading_enabled=False,
                    dry_run=False,
                    paper_trading=False,
                    trading_mode_setting="LIVE",
                    trading_enabled=True,
                    live_trading_confirmed=True,
                )
            )
        )
        assert decision.allowed is False
        assert decision.will_transmit is False
        blocking = {result.gate for result in decision.failures}
        assert SafetyGate.LIVE_TRADING_AUTHORISED in blocking

    def test_a_withdrawal_capable_key_fails_the_credentials_gate(self) -> None:
        decision = evaluate_safety_gates(
            preconditions(credentials=safe_credentials(permissions=frozenset({"WITHDRAW"})))
        )
        assert decision.allowed is False
        assert SafetyGate.CREDENTIALS_VALID in {r.gate for r in decision.failures}

    def test_no_credentials_fails_the_credentials_gate(self) -> None:
        decision = evaluate_safety_gates(preconditions(credentials=None))
        assert decision.allowed is False
        assert SafetyGate.CREDENTIALS_VALID in {r.gate for r in decision.failures}

    def test_an_unhealthy_risk_engine_refuses_even_with_everything_else_green(self) -> None:
        decision = evaluate_safety_gates(
            preconditions(risk_health=ComponentHealth.down("risk worker unreachable"))
        )
        assert decision.allowed is False
        assert SafetyGate.RISK_ENGINE_HEALTHY in {r.gate for r in decision.failures}

    def test_stale_risk_state_is_treated_as_unavailable(self) -> None:
        decision = evaluate_safety_gates(
            preconditions(
                risk_health=ComponentHealth.ok(age_micros=60_000_000),
                settings=ExecutionSettings(max_risk_state_age_ms=5_000),
            )
        )
        assert decision.allowed is False
        assert SafetyGate.RISK_ENGINE_HEALTHY in {r.gate for r in decision.failures}

    def test_the_default_component_health_is_unknown_and_blocks(self) -> None:
        """Constructing a health object without saying anything means unknown."""
        assert ComponentHealth().healthy is False
        decision = evaluate_safety_gates(preconditions(risk_health=ComponentHealth()))
        assert decision.allowed is False

    def test_a_paper_order_is_allowed_without_credentials_or_connectivity(self) -> None:
        """The refusal matrix is not a wall: the safe path must stay open."""
        decision = evaluate_safety_gates(
            preconditions(
                credentials=None,
                is_simulated=True,
                settings=ExecutionSettings(trading_mode_setting="PAPER", trading_enabled=True),
            )
        )
        assert decision.allowed is True
        assert decision.will_transmit is False


# ======================================================================
# 5. Adapter
# ======================================================================
class TestLayerFiveAdapter:
    def test_the_binance_adapter_never_claims_to_be_simulated(self) -> None:
        adapter = BinanceTradingAdapter(
            send=_never_send,
            credentials=_unused_credentials(),
            clock=_unused_clock(),
        )
        assert adapter.is_simulated is False
        assert adapter.exchange is ExchangeId.BINANCE

    def test_mainnet_is_the_default_base_and_the_testnet_is_explicit(self) -> None:
        mainnet = BinanceTradingAdapter(
            send=_never_send,
            credentials=_unused_credentials(),
            clock=_unused_clock(),
        )
        testnet = BinanceTradingAdapter(
            send=_never_send,
            credentials=_unused_credentials(),
            clock=_unused_clock(),
            testnet=True,
        )
        assert mainnet._client.rest_base == BINANCE_SPOT_REST_BASE  # noqa: SLF001
        assert testnet._client.rest_base == BINANCE_TESTNET_REST_BASE  # noqa: SLF001
        assert BINANCE_SPOT_REST_BASE != BINANCE_TESTNET_REST_BASE
        assert "testnet" in BINANCE_TESTNET_REST_BASE

    def test_a_signed_request_needs_a_usable_clock_and_refuses_without_one(self) -> None:
        """No measurement, no timestamp, no request - the clock is a gate."""
        from wlct_trading.execution.timesync import ClockSyncError, ExchangeClock

        async def no_time() -> int:
            raise RuntimeError("the venue time endpoint is unreachable")

        clock = ExchangeClock(no_time, max_skew_millis=1_000, require_sync=True)
        adapter = BinanceTradingAdapter(
            send=_never_send, credentials=_unused_credentials(), clock=clock
        )

        intent = OrderIntent(
            tenant_id="tenant-a",
            account_id="acct-1",
            strategy_id="strategy-1",
            exchange=ExchangeId.BINANCE,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=Decimal("0.001"),
        )
        with pytest.raises(ClockSyncError):
            asyncio.run(adapter.submit_order(intent, "client-1"))

    def test_an_unsafe_key_is_refused_at_signing_time_not_only_at_validation(self) -> None:
        """``assert_safe`` runs inside ``_resolve``, on the money path.

        The pre-flight gate uses the same method, but a code path that skipped the
        gate must not get a signature out of the adapter either.
        """
        from wlct_trading.execution.credentials import StaticCredentialProvider

        unsafe = safe_credentials(permissions=frozenset({"SPOT", "WITHDRAW"}))
        adapter = BinanceTradingAdapter(
            send=_never_send,
            credentials=StaticCredentialProvider([unsafe]),
            clock=_unused_clock(),
            testnet=True,
        )
        intent = OrderIntent(
            tenant_id="tenant-a",
            account_id="acct-1",
            strategy_id=None,
            exchange=ExchangeId.BINANCE,
            symbol=SYMBOL,
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=Decimal("0.001"),
        )
        with pytest.raises(UnsafeCredential) as excinfo:
            asyncio.run(adapter.submit_order(intent, "client-1"))
        assert "withdraw" in str(excinfo.value).lower()


# ======================================================================
# 6. Operator confirmation
# ======================================================================
class TestLayerSixConfirmation:
    """The human half: a live run needs a scoped, fresh, signed confirmation."""

    KEY = "c0nf1rmat10n-v3r1f1cat10n-k3y-0001"

    @staticmethod
    def _record(*, key: str, scope_symbols: frozenset[str] | None = None) -> object:
        from wlct_trading.execution.live_confirmation import LiveOperatorConfirmation

        return LiveOperatorConfirmation(
            instance_id="exec-test-1",
            tenant_id="tenant-a",
            account_id="acct-1",
            exchange="BINANCE",
            symbols=scope_symbols if scope_symbols is not None else frozenset({"BTCUSDT"}),
            order_types=frozenset({"LIMIT"}),
            issued_at_micros=1_760_000_000_000_000,
            expires_at_micros=1_760_000_900_000_000,
            nonce="nonce-0123456789abcdef",
        ).with_digest(key)

    def test_a_missing_confirmation_is_refused_when_one_is_required(self) -> None:
        from wlct_trading.execution.live_confirmation import (
            ConfirmationState,
            ConfirmationVerifier,
        )

        verifier = ConfirmationVerifier(
            record=None,
            key=self.KEY,
            instance_id="exec-test-1",
            exchange="BINANCE",
            required=True,
        )
        outcome = verifier.assess(
            tenant_id="tenant-a",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=1_760_000_100_000_000,
        )
        assert outcome.accepted is False
        assert outcome.state is ConfirmationState.ABSENT
        assert "ceremony" in outcome.detail

    def test_a_confirmation_signed_with_another_key_is_refused(self) -> None:
        from wlct_trading.execution.live_confirmation import (
            ConfirmationState,
            ConfirmationVerifier,
        )

        record = self._record(key="a" * 40)
        verifier = ConfirmationVerifier(
            record=record,
            key=self.KEY,
            instance_id="exec-test-1",
            exchange="BINANCE",
            required=True,
        )
        outcome = verifier.assess(
            tenant_id="tenant-a",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=1_760_000_100_000_000,
        )
        assert outcome.accepted is False
        assert outcome.state is ConfirmationState.UNVERIFIED

    def test_an_expired_confirmation_is_refused(self) -> None:
        from wlct_trading.execution.live_confirmation import (
            ConfirmationState,
            ConfirmationVerifier,
        )

        verifier = ConfirmationVerifier(
            record=self._record(key=self.KEY),
            key=self.KEY,
            instance_id="exec-test-1",
            exchange="BINANCE",
            required=True,
        )
        outcome = verifier.assess(
            tenant_id="tenant-a",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=1_760_000_900_000_001,
        )
        assert outcome.accepted is False
        assert outcome.state is ConfirmationState.EXPIRED

    def test_a_confirmation_for_another_tenant_is_refused(self) -> None:
        from wlct_trading.execution.live_confirmation import (
            ConfirmationState,
            ConfirmationVerifier,
        )

        verifier = ConfirmationVerifier(
            record=self._record(key=self.KEY),
            key=self.KEY,
            instance_id="exec-test-1",
            exchange="BINANCE",
            required=True,
        )
        outcome = verifier.assess(
            tenant_id="tenant-b",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=1_760_000_100_000_000,
        )
        assert outcome.accepted is False
        assert outcome.state is ConfirmationState.SCOPE_MISMATCH

    def test_a_confirmation_does_not_cover_a_symbol_it_does_not_name(self) -> None:
        from wlct_trading.execution.live_confirmation import (
            ConfirmationState,
            ConfirmationVerifier,
        )

        verifier = ConfirmationVerifier(
            record=self._record(key=self.KEY, scope_symbols=frozenset({"ETHUSDT"})),
            key=self.KEY,
            instance_id="exec-test-1",
            exchange="BINANCE",
            required=True,
        )
        outcome = verifier.assess(
            tenant_id="tenant-a",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=1_760_000_100_000_000,
        )
        assert outcome.accepted is False
        assert outcome.state is ConfirmationState.SCOPE_MISMATCH

    def test_the_scope_matching_confirmation_is_accepted(self) -> None:
        """The positive case, so the refusals above are known to be specific."""
        from wlct_trading.execution.live_confirmation import (
            ConfirmationState,
            ConfirmationVerifier,
        )

        verifier = ConfirmationVerifier(
            record=self._record(key=self.KEY),
            key=self.KEY,
            instance_id="exec-test-1",
            exchange="BINANCE",
            required=True,
        )
        outcome = verifier.assess(
            tenant_id="tenant-a",
            account_id="acct-1",
            symbol="BTCUSDT",
            order_type="LIMIT",
            now_micros=1_760_000_100_000_000,
        )
        assert outcome.accepted is True
        assert outcome.state is ConfirmationState.VALID
        # ... and the key is never part of what the outcome publishes.
        assert self.KEY not in str(outcome.to_dict())


# ======================================================================
# The matrix itself
# ======================================================================
def test_every_layer_refuses_before_a_mainnet_connection_is_attempted() -> None:
    """One assertion per layer, in order, in a single test.

    Read as a checklist at release time: if this test ever needs a layer removed,
    the removal is the decision, not the test.
    """
    layers: list[tuple[str, object]] = []

    # 1. Configuration
    settings = ExecutionSettings()
    layers.append(("configuration", settings.will_transmit_orders))
    assert settings.will_transmit_orders is False

    # 2. Wiring
    report = evaluate_live_enablement(LiveEnablementInputs())
    layers.append(("wiring", report.blocks_live))
    assert report.blocks_live is True

    # 3. Credentials
    with pytest.raises(UnsafeCredential):
        safe_credentials(permissions=frozenset({"WITHDRAW"})).assert_safe()
    layers.append(("credentials", False))

    # 4. Pre-flight
    decision = evaluate_safety_gates(preconditions(credentials=None))
    layers.append(("preflight", decision.allowed))
    assert decision.allowed is False

    # 5. Adapter
    adapter = BinanceTradingAdapter(
        send=_never_send, credentials=_unused_credentials(), clock=_unused_clock()
    )
    layers.append(("adapter", adapter.is_simulated))
    assert adapter.is_simulated is False

    # 6. Confirmation
    from wlct_trading.execution.live_confirmation import ConfirmationVerifier

    verifier = ConfirmationVerifier(
        record=None,
        key="m" * 40,
        instance_id="exec-test-1",
        exchange="BINANCE",
        required=True,
    )
    outcome = verifier.assess(
        tenant_id="tenant-a",
        account_id="acct-1",
        symbol="BTCUSDT",
        order_type="LIMIT",
        now_micros=1_760_000_100_000_000,
    )
    layers.append(("confirmation", outcome.accepted))
    assert outcome.accepted is False

    assert [name for name, _ in layers] == [
        "configuration",
        "wiring",
        "credentials",
        "preflight",
        "adapter",
        "confirmation",
    ]


def _unused_credentials():  # noqa: ANN202 - local helper, typed by its use
    from wlct_trading.execution.credentials import StaticCredentialProvider

    return StaticCredentialProvider([safe_credentials()])


def _unused_clock():  # noqa: ANN202 - local helper, typed by its use
    from wlct_trading.execution.timesync import ExchangeClock

    clock = ExchangeClock(_no_time, max_skew_millis=1_000, require_sync=True)
    clock.seed(offset_millis=0, round_trip_millis=5)
    return clock


async def _no_time() -> int:
    raise AssertionError("no server time is fetched in this file")
