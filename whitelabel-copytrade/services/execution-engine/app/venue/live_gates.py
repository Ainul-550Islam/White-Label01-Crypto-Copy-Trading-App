"""The complete set of conditions under which this service may go live.

Responsibility: one pure function - no I/O, no clocks, no globals - that
grades a prospective live runtime and names *every* gate it fails. Pure, so
the refusal an operator reads can be reproduced in a test from the settings
alone; exhaustive, so fixing one gate never reveals the next one at 3am.

The gates are deliberately redundant with protections elsewhere (the core's
``evaluate_live_enablement`` grading, the engine's wiring law, the placement
review). Live money is the one place where "the same check twice" is a
feature: each layer was written against a different failure story.

- ``ENABLEMENT_REPORT`` - the repository's typed live-enablement grading
  (credential source and fetcher wired, venue attestor wired, operator
  confirmation accepted, durable store, distributed locks, IP allowlist,
  signed transport) has nothing missing.
- ``OPERATOR_CONFIRMATION`` - the scoped, HMAC-verified operator
  confirmation passed verification in this process. Restated as its own
  gate so a passing report can never stand in for a confirmation nobody
  checked here.
- ``IP_ALLOWLIST`` - ``EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=true``: a key
  whose venue-side IP allowlist cannot be proven does not place.
- ``CREDENTIAL_SOURCE`` - credentials come from the secret manager
  (``secret-manager`` + ``vault-kv2`` fetcher). Environment-carried keys are
  a refusal, always: env is readable by every co-tenant of the process and
  shows up in crash dumps.
- ``KEY_AGE_POLICY`` - a finite maximum key age is configured, so key
  rotation is a policy with a number, not an intention.
- ``DURABLE_STORE`` - orders, events and fills persist in Postgres; the
  in-memory store is a live refusal.
- ``DRY_RUN_EXPLICIT_OFF`` - ``EXECUTION_DRY_RUN=false`` was *set*, not
  merely defaulted. ``model_fields_set`` distinguishes an operator decision
  from an absent line in an env file.
- ``KILL_SWITCH_READABLE`` - the operator kill-switch state was read and is
  not engaged. Unreadable (``None``) and engaged (``True``) both refuse;
  only an explicit ``False`` passes.

Futures-only gates (batch 03, item B) - consulted ONLY when
``EXECUTION_VENUE_MARKET=usdm_futures`` so the spot gate matrix is
byte-identical:

- ``FUTURES_ISOLATED_ONLY`` - the margin mode reads ``isolated``; anything
  else is refused before any venue call.
- ``FUTURES_LEVERAGE_CAP`` - ``EXECUTION_FUTURES_MAX_LEVERAGE`` is within the
  platform's 1..20 envelope. (Boot validation already bounds it; the gate
  restates it because live is where the reading matters.)
- ``FUTURES_LIQUIDATION_GUARD`` - a positive liquidation-distance floor and a
  bounded funding cap are configured; both are what stops an opening order
  from entering a book one funding tick from forced unwind.
- ``FUTURES_KEY_PERMISSIONS`` - the venue attestation environment is the
  futures one: the market selector is futures, the mode is live, and the
  placement review (which consults ``enableFutures`` through the futures
  attestor) is attestation-backed. In practice this means the existing
  ``ENABLEMENT_REPORT`` must be clean and the runtime must have an
  attestation surface: a futures wire without key evidence is refused here
  rather than at the venue.
"""

from __future__ import annotations

from typing import Protocol

from wlct_trading.execution.live_enablement import LiveEnablementReport

from app.config import Settings

__all__ = [
    "ALL_FUTURES_GATES",
    "ALL_LIVE_GATES",
    "GATE_CREDENTIAL_SOURCE",
    "GATE_DRY_RUN_EXPLICIT_OFF",
    "GATE_DURABLE_STORE",
    "GATE_ENABLEMENT_REPORT",
    "GATE_FUTURES_ISOLATED_ONLY",
    "GATE_FUTURES_KEY_PERMISSIONS",
    "GATE_FUTURES_LEVERAGE_CAP",
    "GATE_FUTURES_LIQUIDATION_GUARD",
    "GATE_IP_ALLOWLIST",
    "GATE_KEY_AGE_POLICY",
    "GATE_KILL_SWITCH_READABLE",
    "GATE_OPERATOR_CONFIRMATION",
    "evaluate_futures_gates",
    "evaluate_live_gates",
]

GATE_ENABLEMENT_REPORT = "ENABLEMENT_REPORT"
GATE_OPERATOR_CONFIRMATION = "OPERATOR_CONFIRMATION"
GATE_IP_ALLOWLIST = "IP_ALLOWLIST"
GATE_CREDENTIAL_SOURCE = "CREDENTIAL_SOURCE"
GATE_KEY_AGE_POLICY = "KEY_AGE_POLICY"
GATE_DURABLE_STORE = "DURABLE_STORE"
GATE_DRY_RUN_EXPLICIT_OFF = "DRY_RUN_EXPLICIT_OFF"
GATE_KILL_SWITCH_READABLE = "KILL_SWITCH_READABLE"

#: Futures-only gates. NOT members of ALL_LIVE_GATES: they apply when the
#: venue market is ``usdm_futures`` and must never appear in the spot gate
#: matrix (the spot matrix is byte-identical by mandate). They are exposed
#: separately and merged by :func:`evaluate_live_gates` for a futures runtime.
GATE_FUTURES_ISOLATED_ONLY = "FUTURES_ISOLATED_ONLY"
GATE_FUTURES_LEVERAGE_CAP = "FUTURES_LEVERAGE_CAP"
GATE_FUTURES_LIQUIDATION_GUARD = "FUTURES_LIQUIDATION_GUARD"
GATE_FUTURES_KEY_PERMISSIONS = "FUTURES_KEY_PERMISSIONS"

ALL_LIVE_GATES = (
    GATE_ENABLEMENT_REPORT,
    GATE_OPERATOR_CONFIRMATION,
    GATE_IP_ALLOWLIST,
    GATE_CREDENTIAL_SOURCE,
    GATE_KEY_AGE_POLICY,
    GATE_DURABLE_STORE,
    GATE_DRY_RUN_EXPLICIT_OFF,
    GATE_KILL_SWITCH_READABLE,
)

#: The futures gate set, in a stable diffable order.
ALL_FUTURES_GATES = (
    GATE_FUTURES_ISOLATED_ONLY,
    GATE_FUTURES_LEVERAGE_CAP,
    GATE_FUTURES_LIQUIDATION_GUARD,
    GATE_FUTURES_KEY_PERMISSIONS,
)


class _DurabilityProbe(Protocol):
    @property
    def is_durable(self) -> bool: ...


def evaluate_live_gates(
    settings: Settings,
    report: LiveEnablementReport,
    confirmation_accepted: bool,
    store: _DurabilityProbe,
) -> list[str]:
    """Return the names of every live gate this configuration fails.

    An empty list is the only pass. The order is the declaration order of
    :data:`ALL_LIVE_GATES`, so refusals are stable and diffable.
    """
    failed: list[str] = []
    if report.blocks_live:
        failed.append(GATE_ENABLEMENT_REPORT)
    if not confirmation_accepted:
        failed.append(GATE_OPERATOR_CONFIRMATION)
    if not settings.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST:
        failed.append(GATE_IP_ALLOWLIST)
    if not (
        settings.EXECUTION_CREDENTIAL_SOURCE == "secret-manager"
        and settings.EXECUTION_CREDENTIAL_FETCHER == "vault-kv2"
    ):
        failed.append(GATE_CREDENTIAL_SOURCE)
    if settings.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS <= 0:
        failed.append(GATE_KEY_AGE_POLICY)
    if not store.is_durable:
        failed.append(GATE_DURABLE_STORE)
    if (
        settings.EXECUTION_DRY_RUN
        or "EXECUTION_DRY_RUN" not in settings.model_fields_set
    ):
        failed.append(GATE_DRY_RUN_EXPLICIT_OFF)
    if settings.EXECUTION_LIVE_KILL_SWITCH_ENGAGED is not False:
        failed.append(GATE_KILL_SWITCH_READABLE)
    # Futures market: the spot matrix above is unaltered by construction, and
    # a USD-M runtime adds its own gates on top of it. Every futures gate is
    # a *restatement at the live boundary* of something composition also
    # enforces - on money paths, the same check twice is a feature.
    if settings.EXECUTION_VENUE_MARKET == "usdm_futures":
        failed.extend(evaluate_futures_gates(settings, report))
    return failed


def evaluate_futures_gates(
    settings: Settings,
    report: LiveEnablementReport,
) -> list[str]:
    """The futures-only gate list, empty only when every one passes.

    Separate from :data:`ALL_LIVE_GATES` so a spot deployment's gate output -
    and any tooling diffing it - cannot change shape by adding a futures
    capability it never enabled.
    """
    failed: list[str] = []
    if settings.EXECUTION_FUTURES_MARGIN_MODE != "isolated":
        failed.append(GATE_FUTURES_ISOLATED_ONLY)
    if not 1 <= settings.EXECUTION_FUTURES_MAX_LEVERAGE <= 20:
        failed.append(GATE_FUTURES_LEVERAGE_CAP)
    if (
        settings.EXECUTION_FUTURES_MIN_LIQUIDATION_DISTANCE_BPS <= 0
        or settings.EXECUTION_FUTURES_MAX_FUNDING_RATE_BPS <= 0
    ):
        failed.append(GATE_FUTURES_LIQUIDATION_GUARD)
    # The futures key-permission line is a *venue* answer, gathered by the
    # placement review through the futures attestor; what can be gated here is
    # that an attestation surface exists at all. A missing or blocking report
    # means the review has nothing to consult, which is the futures-facing
    # form of "no key evidence". (The field-level check - enableFutures true,
    # enableWithdrawals false - happens per order, not at boot, because a key
    # can change underneath a running process.)
    if report.missing or report.blocks_live:
        failed.append(GATE_FUTURES_KEY_PERMISSIONS)
    return failed
