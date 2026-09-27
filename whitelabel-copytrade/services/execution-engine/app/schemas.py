"""Request and response models for the internal execution API.

Alias conventions match the trading engine: fields are snake_case
internally, camelCase on the wire, populated by name on input so a worker
cannot smuggle a mistyped payload past validation by coincidence.

Everything here is a CONTROL shape. No model accepts an order to place;
no model returns a credential, key or signed payload. Decimal-valued
fields serialise as decimal STRINGS: a JSON float for a
quantity or balance is a silent rounding decision, and money never takes
one of those on the platform's behalf.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = [
    "AccountCommandRequest",
    "BalanceView",
    "BalancesResponse",
    "CancelOrderRequest",
    "CancelOrderResponse",
    "CommandRejected",
    "DiscrepancyView",
    "EnablementAuditResponse",
    "EnablementProbeView",
    "EnablementRequest",
    "EnablementRoleView",
    "PlacementAttestRequest",
    "PlacementAttestResponse",
    "PlacementFindingView",
    "ReconcileResponse",
    "RetentionInspectRequest",
    "RetentionInspectResponse",
    "RetentionRunRequest",
    "RetentionRunResponse",
    "RetentionRunView",
    "StatusResponse",
    "VerifyResponse",
]

_TENANT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

#: An int that refuses coercion - the one spelling (annotated VALUE type)
#: that makes strictness apply inside a dict, as the enablement seed counts
#: require.
_StrictInt = Annotated[int, Field(strict=True)]
_ACCOUNT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def _to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


class _WireModel(BaseModel):
    """Base for every model on this wire: camelCase aliases (the platform's
    API style, matched by the trading engine), snake_case fields (the
    core's style), ``extra=forbid`` so a payload containing fields BEYOND
    the contract - a venue key slipped in by a buggy producer, say - is a
    422 rather than a silently ignored surprise."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid"
    )


class AccountCommandRequest(_WireModel):
    """Payload for the three account commands.

    ``tenantId``/``accountId`` echo the job payload; the router still
    enforces the TENANT header match - a body that agrees with the header
    is provenance, a body that merely exists is not.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class CancelOrderRequest(_WireModel):
    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    client_order_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=32)
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class VerifyResponse(_WireModel):
    verified: bool
    note: str
    is_simulated: bool = True


class BalanceView(_WireModel):
    asset: str
    free: str
    locked: str

    @field_validator("free", "locked")
    @classmethod
    def _decimalish(cls, value: str) -> str:
        from decimal import Decimal, InvalidOperation

        try:
            parsed = Decimal(value)
        except InvalidOperation as error:
            raise ValueError("balances must serialise as decimal strings") from error
        if not parsed.is_finite():
            raise ValueError("balances must be finite")
        return value


class BalancesResponse(_WireModel):
    balances: list[BalanceView]
    is_simulated: bool = True


class DiscrepancyView(_WireModel):
    discrepancy_type: str
    summary: str
    order_id: str | None
    repaired: bool


class ReconcileResponse(_WireModel):
    tenant_id: str
    account_id: str
    exchange: str
    orders_checked: int
    fills_recovered: int
    discrepancy_count: int
    discrepancies: list[DiscrepancyView]
    error: str | None
    started_at_micros: int
    finished_at_micros: int


class CancelOrderResponse(_WireModel):
    """The engine's honest verdict on a cancel request.

    ``outcome`` carries ExecutionEngine vocabulary (ACCEPTED,
    REJECTED_LOCALLY, REJECTED_BY_EXCHANGE, DUPLICATE, DRY_RUN, UNKNOWN);
    the worker's ack policy reads THIS, not the HTTP code: 200 +
    REJECTED_LOCALLY is a completed job, 5xx is a retryable failure, and
    conflating the two is how cancelled-twice becomes cancelled-never.
    """

    outcome: str
    client_order_id: str
    order_status: str
    error_code: str | None
    message: str | None
    latency_micros: int
    is_simulated: bool


class CommandRejected(_WireModel):
    """Error body shared by 403/404/501 paths."""

    code: str
    message: str


class PlacementStatusView(_WireModel):
    """The placement review as ``/status`` publishes it.

    A typed model rather than the raw ``dict`` ``PlacementWiring.describe()``
    returns, for one reason: ``extra="forbid"`` on this base means a field that
    ``describe()`` grows without a decision here is a loud failure at the first
    status request, not a silently unpublished fact. The counterpart test in the
    service suite asserts the two key sets agree, so the loud failure is caught in
    CI and can never actually reach an operator.

    ``policy`` and ``cache`` are mappings of numbers, not declared fields, and the
    asymmetry is the safety property: those blocks can carry bounds, counters and
    a boolean, and nothing that could be a key. The strings live only in the three
    labels below, which are the module's own constants and are asserted not to
    contain credential material.
    """

    #: ``placement-review`` - what an operator greps for (REVIEW_ENDPOINT_LABEL).
    label: str
    #: ``local`` for a runtime that cannot transmit; the mode is part of the
    #: verdict digest upstream, so publishing it here lets a reader check that
    #: the engine answering and the engine that refused are the same engine.
    mode: str
    #: Whether this wiring would REFUSE for want of a venue answer. Published
    #: because an operator comparing two deployments has to see which one would
    #: have blocked the order the other one took.
    requires_venue_attestation: bool
    #: How long a gathered attestation is reused, as configured (not as
    #: achieved - ``cache`` below says what the reuse actually did).
    cache_ttl_millis: int
    #: The gatherer's provenance label: ``unattested``, ``local``, ``binance``
    #: or ``cached(<inner>)``.
    attestor_source: str
    policy: dict[str, int | bool]
    #: Present only when the gatherer reports its own statistics - the absence is
    #: the honest signal that the attestor in use is not a caching one.
    cache: dict[str, int] | None = None
    #: Part 19: whether an operator-confirmation verifier is installed at all. A
    #: separate top-level fact from ``policy.requireOperatorConfirmation``, because
    #: "the deployment asked for the check" and "the deployment can satisfy it" are
    #: the two halves of the outage this service must not confuse.
    confirmation_configured: bool = False
    #: The verifier's own summary, deliberately the SHAPE rather than the scope:
    #: this block is copied verbatim into ``/health/ready``, which is
    #: unauthenticated, and a confirmation's tenant, account and symbol list are
    #: identities a probe has no need of. See
    #: :meth:`~wlct_trading.execution.live_confirmation.ConfirmationVerifier.public_summary`.
    operator_confirmation: dict[str, bool | int | str] = {}


class LiveEnablementView(_WireModel):
    """The live-enablement grading, as ``/status`` publishes it (Part 19).

    Rendered from the report the composition root computed over the objects it
    actually built, which is the whole point of the type existing: the same data that
    produced the ``EXECUTION_MODE=live`` refusal, so the answer an operator reads
    after a failed boot and the answer in front of a successful one are the same
    answer. It cannot be turned into a permission by any caller - there is no field
    here that says "set this to true and trade", only which names are missing.
    """

    #: Always true in this build. See ``HARD_BLOCKERS`` in the core: the live
    #: transport is not wired, so no grading can come back empty and no reader can
    #: use this block to conclude that live mode is one setting away.
    live_refused: bool
    #: The prerequisite names still unsatisfied, in the order the enum declares
    #: them - a stable list, so a deployment watching it shrink over successive
    #: parts is watching progress rather than a reshuffle.
    missing: list[str] = []
    satisfied: list[str] = []
    #: The same list in the refusal vocabulary (``LIVE_`` prefixed), for a caller
    #: that matches on codes rather than on prose.
    missing_codes: list[str] = []
    #: Whether any missing item is one this build cannot satisfy by configuration.
    #: The honest "you are waiting for a part, not for a value" flag.
    hard_blockers_present: bool = True
    credential_source: str = "none"


class IncidentSinkView(_WireModel):
    """The incident sink as ``/status`` publishes it (Part 17).

    Same typing argument as ``PlacementStatusView``: the sink's name and its
    durability are the two facts that explain why an incident list is empty, and
    ``extra="forbid"`` means a field added to the runtime's description has to be
    decided here before it reaches an internal caller.

    ``stats`` is a mapping of counts, always present and empty when the sink has
    no accounting to give: the in-memory sink has nothing to report, and publishing
    ``{}`` says that in the same shape the durable one uses. A missing key would
    force every reader to distinguish "no stats" from "this engine is too old to
    have stats", which is the distinction the outer ``incidents is null`` already
    makes - one place, one meaning. Counts only, never labels: a label is where a
    secret would have to go, and this block has no business carrying one.
    """

    #: ``PostgresIncidentRecorder`` or ``InMemoryIncidentRecorder`` - the class the
    #: runtime was built with, which is the answer to "where did my incidents go".
    sink: str
    #: The sink's own claim, not the config's: a deployment that set
    #: ``EXECUTION_STORE_BACKEND=postgres`` and still has a memory sink says
    #: ``durable: false`` here, and composition refuses that pairing outright.
    durable: bool
    stats: dict[str, int] = Field(default_factory=dict)


class StatusResponse(_WireModel):
    instance_id: str
    mode: str
    dry_run: bool
    adapter: str
    store: str
    store_durable: bool
    #: "memory" | "postgres" as the SERVICE was configured - independent of
    #: store_durable on purpose: the worker can tell "class name says
    #: Postgres, config says memory" (impossible wiring) apart from either
    #: alone. Defaults to "unknown" (not "memory") so a response from a
    #: pre-Part-13 engine reads as unproven, never as a claimed fact.
    store_backend: str = "unknown"
    #: Retention visibility on the SAME surface the worker asserts against:
    #: "is a prune possible from this engine, and what does 'days' mean
    #: here" are questions an operator asks the status endpoint, not the
    #: source. Defaults state the shipped config (disabled, 90) so a
    #: pre-Part-14 engine's response cannot be read as "retention ran".
    retention_enabled: bool = False
    retention_event_days: int = 90
    #: Part 15's evidence window, visible on the assert-before-forward
    #: surface for the same reason retention is: "how stale is too stale" is
    #: a per-deployment answer. The default mirrors the shipped config, and
    #: a PRE-Part-15 engine's response therefore says "the window nobody
    #: enforced was 30 days", not "freshness was checked".
    enablement_max_age_days: int = 30
    #: Part 16's posture, on the same surface for the same reason: "which key
    #: source was this process willing to read, and what was it willing to
    #: believe about an order" are the two questions an operator asks when a
    #: placement is refused, and neither may require reading the source or
    #: shell-ing into the container. The SOURCE is published, never a credential.
    #: The defaults describe an engine too old to answer rather than an engine
    #: with nothing wired, so a pre-Part-16 response reads as unproven - the
    #: same convention ``store_backend`` set - and ``placement is None`` is
    #: distinguishable from ``attestorSource == "unattested"``, which is a
    #: deployment that HAS the review and has no venue behind it.
    credential_source: str = "none"
    #: Part 19's two additions to the same posture: which reader backs the
    #: credential source (None when the source needs none), and whether an operator
    #: confirmation is wired. Neither is a permission, and neither can be read as
    #: "live is available": the block below is what says that, and it says it for
    #: every deployment this build starts.
    credential_fetcher: str | None = None
    operator_confirmation: bool = False
    live_enablement: LiveEnablementView | None = None
    placement: PlacementStatusView | None = None
    #: Part 18's instrument posture, on the assert-before-forward surface for the
    #: reason everything else on it is there: a scrape that reads all zeros needs an
    #: answer to "is this process measuring anything", and the answer belongs in the
    #: document the worker already reads rather than in a second system. Defaults
    #: False, which is what a pre-Part-18 engine actually was - nothing was wired -
    #: so an old response cannot be misread as "instrumented but idle".
    metrics_configured: bool = False
    #: Part 17's posture, on the same surface for the same reason: "does this
    #: process keep the records that explain its own failures" is the first
    #: question an operator asks after a restart, and ``None`` reads as "an
    #: engine too old to answer" rather than as "no incidents" - the convention
    #: every other block on this model uses.
    incidents: IncidentSinkView | None = None
    locks_distributed: bool
    #: Part 20: signed transport posture. Whether the composition root
    #: constructed a real key registry and transport client/verifier.
    signed_transport_wired: bool = False
    key_registry_configured: bool = False
    #: Part 21: distributed lock wiring posture. The detailed wiring
    #: metadata for the lock manager.
    distributed_lock_wiring: dict[str, object] | None = None
    #: Part 22: venue attestation posture. Whether a real Binance placement
    #: attestor was constructed and wired into the placement reviewer.
    venue_attestation: dict[str, object] | None = None
    #: Part 23: credential registry posture. Provider selection, capabilities,
    #: and credential metadata (no secrets).
    credential_registry: dict[str, object] | None = None
    commands: list[str]
    simulated: bool = True


class RetentionRunRequest(_WireModel):
    """The run command's body. ``dryRun`` DEFAULTS TRUE: the field a typo
    could flip is the one that DELETES, so deletion requires an explicit
    ``"dryRun": false``, and even that only reaches the DELETE statements
    when EXECUTION_RETENTION_ENABLED says the deployment means it."""

    tenant_id: str = _TENANT
    dry_run: bool = True


class RetentionInspectRequest(_WireModel):
    """The read-only sibling: current count + recent runs, no deletion."""

    tenant_id: str = _TENANT


class RetentionRunResponse(_WireModel):
    """One run's account, mirroring the ledger row it just wrote.

    ``ledgerWritten`` is part of the contract because the ledger failure
    path is a real one (deletes landed, record did not): an operator
    reading `false` here knows the HTTP body IS the durable-ish copy and
    must reconcile against the log line before scheduling more.
    """

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


class RetentionRunView(_WireModel):
    """A ledger row as read back; every field is a number or a label."""

    seq: int
    started_at: int
    finished_at: int
    dry_run: bool
    event_cutoff_us: int
    rows_deleted: int
    batches: int
    exhausted: bool
    instance_id: str


class RetentionInspectResponse(_WireModel):
    enabled: bool
    event_retention_days: int
    batch_rows: int
    max_batches: int
    cutoff_us: int
    prunable_now: int
    runs: list[RetentionRunView]


class EnablementRequest(_WireModel):
    """Body of ``POST /internal/v1/enablement/audit`` (Part 15).

    The only required field is the tenant whose rows the scoped count will
    see - there is no ``deleteOlderThanDays``-style danger field here,
    because there is no write path to protect. ``seedCounts`` is the
    operator's claim about how many rows that tenant should see per table;
    leaving it out is the honest unknown-seed mode (the catalogue posture
    then carries the finding), and passing a table this service does not
    probe is a refusal, not an ignore: a silently dropped key is how an
    audit starts reporting on tables that were never read.
    """

    tenant_id: str = _TENANT
    #: A row count arrives as an integer or the request is refused - no
    #: silent conversion, ever. The strictness lives on the DICT VALUE
    #: because that is the only spelling that works: a field-level
    #: ``strict=True`` on a ``dict[str, int]`` does not reach inside the
    #: values in pydantic 2.9 (verified by test), and non-strict coercion
    #: would accept ``"3"`` and, worse, ``true`` as 1 - handing the audit a
    #: seed the operator never wrote and a PASS that was earned by a cast.
    seed_counts: dict[str, _StrictInt] | None = None
    #: The coverage manifest's table count, when the caller wants the run
    #: graded against the WHOLE platform rather than against this service's
    #: own plane. Anything other than ``None``/that exact count grades
    #: UNVERIFIED, which is the point. The bounds mirror the core's
    #: (0..MAX_PROBED_TABLES) so a nonsense number is refused on the wire;
    #: the core still re-validates, because a bound stated twice in a test
    #: is a fact and a bound stated twice in code is a drift risk - which
    #: the parity test pins.
    covered_expected: int | None = Field(default=None, ge=0, le=4096)

    @field_validator("seed_counts")
    @classmethod
    def _seed_counts_are_rows(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        for name, count in value.items():
            if isinstance(count, bool) or not isinstance(count, int):
                raise ValueError(f"seedCounts[{name!r}] must be an integer row count")
            if count < 0:
                raise ValueError(f"seedCounts[{name!r}] must be non-negative")
        return value


class EnablementProbeView(_WireModel):
    """One table's raw observations. Counts, not booleans, so a second
    operator can re-audit the report against the database itself."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    table: str
    policy_exists: bool
    rls_enabled: bool
    rls_forced: bool
    scoped_rows: int
    bare_rows: int
    seeded_expected_rows: int
    absent: bool
    grade: str
    skip_reason: str | None = None


class EnablementRoleView(_WireModel):
    """The role the audit ran AS - the field that makes a "pass" either
    meaningful or worthless, so it is on the wire in the same body."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    rolname: str
    bypassrls: bool
    superuser: bool


class EnablementAuditResponse(_WireModel):
    """The whole run. ``grade`` is the ONLY field a dashboard may colour,
    and ``fullPlatform`` is the field that keeps it honest: a pass over
    four engine tables is not a pass over 42, and a report that says
    otherwise has to be able to be caught saying so."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True, extra="forbid")

    ran_at_us: int
    grade: str
    full_platform: bool
    #: See ``EnablementAudit``: one boolean can honestly say two different
    #: things only if they are two different fields.
    engine_plane_complete: bool
    probed: int
    role: EnablementRoleView
    summary: dict[str, Any]
    probes: list[EnablementProbeView]


class PlacementFindingView(_WireModel):
    """One line of the review's answer.

    ``field`` names the attestation field the code is about (``withdrawalPermitted``)
    or is ``None`` when the finding is about the review itself (``ATTESTATION_
    UNREACHABLE`` has no field to point at). It is published because a code with
    no field is a code an operator has to interpret; the field turns
    interpretation into a check.
    """

    code: str
    severity: str
    field: str | None
    message: str


class PlacementAttestRequest(_WireModel):
    """Body of ``POST /internal/v1/placement/attest`` (Part 16).

    There is no quantity, price or side here, and that is the whole design: this
    endpoint asks "would this be permitted", never "place this". The order shape
    is present only because the venue's answer depends on it - a symbol that
    accepts LIMIT may reject STOP_LIMIT, and a review that ignored the shape would
    be reporting a permission the order does not have.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    symbol: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9/_-]+$")
    order_type: str = Field(default="LIMIT", min_length=3, max_length=24)
    time_in_force: str = Field(default="GTC", min_length=2, max_length=12)

    @field_validator("symbol", "order_type", "time_in_force")
    @classmethod
    def _upper(cls, value: str) -> str:
        """Normalise case, and refuse a value that is only case.

        ``" limit "`` means LIMIT and is accepted after the strip; ``"  "`` means
        nothing and would otherwise reach the reviewer as a two-character symbol
        whose venue answer is guaranteed to be "not found" - a refusal an operator
        would then read as a permissions problem rather than as a typo.
        """
        cleaned = value.strip().upper()
        if not cleaned:
            raise ValueError("must not be blank after trimming")
        return cleaned


class PlacementAttestResponse(_WireModel):
    """The review's verdict, in the shape the engine records.

    ``allowed`` is a 200 either way: "the venue refused" is the answer to the
    question, not a failure of the endpoint (Part 15 established the same rule
    for a FAIL grade, for the same reason - an error status would bury the
    evidence under the transport).

    ``transmitted`` is present as a constant ``false`` so a client can assert it
    rather than trust the documentation. It says what this endpoint did NOT do;
    a caller that reads ``true`` here has been answered by something else, and a
    check that can fail is worth more than a sentence that cannot be verified.
    """

    allowed: bool
    verdict_id: str
    #: Every code the review produced, in the law's deterministic order, and the
    #: subset that actually refused. Both are published because they answer
    #: different questions: "what did the venue say" and "what stood in the way".
    codes: list[str]
    blocking_codes: list[str]
    #: "Re-run it" versus "a human must act at the venue" - the distinction the
    #: worker needs and cannot infer from a refusal alone.
    retryable: bool
    venue_backed: bool
    venue_trading_permitted: bool
    no_known_withdrawal_path: bool
    review_required_at_micros: int
    attested_at_micros: int
    summary: str
    findings: list[PlacementFindingView]
    #: Mirrors the durable event payload's spelling of the same claims, so a
    #: console comparing an operator's ad-hoc review with an order's audit line
    #: is comparing one contract rather than two near-identical ones.
    payload: dict[str, str]
    transmitted: bool = False
    #: Which gatherer answered, from the runtime's wiring description. A verdict
    #: without its provenance is a opinion; with it, it is evidence.
    mode: str
    attestor_source: str


class IncidentListRequest(_WireModel):
    """Body of ``POST /internal/v1/incidents/list`` (Part 17).

    A read, expressed as a POST with a body, because that is how this service
    already asks a tenant-scoped question: ``retention/inspect`` and
    ``enablement/audit`` both carry ``tenantId`` so the header match in
    ``require_tenant_match`` has something to compare against. A query string
    would have made the tenant a client-chosen default.
    """

    tenant_id: str = _TENANT
    account_id: str | None = Field(
        default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    #: The store's bound, not the caller's: an unbounded read of an audit table is
    #: a way to turn an operator endpoint into an availability incident.
    limit: int = Field(default=100, ge=1, le=1000)


class IncidentView(_WireModel):
    """One incident, in the field set ``ExecutionIncident.to_dict()`` publishes.

    The list is literal and the test asserts it: ``details`` is the one field a
    writer might have stuffed a request body into, and the core scrubs it on
    construction. Re-declaring the shape here is what makes "no credential can
    reach this response" a property of the contract rather than of the scrubber's
    mood, and a renamed core field becomes a broken test instead of a silently
    absent column.
    """

    incident_id: str
    tenant_id: str
    account_id: str | None
    type: str
    severity: str
    summary: str
    exchange: str | None
    symbol: str | None
    order_id: str | None
    client_order_id: str | None
    error_code: str | None
    details: dict[str, str]
    occurred_at_micros: int
    resolved: bool
    resolution_note: str | None


class IncidentListResponse(_WireModel):
    """The open incidents this runtime can show, plus what showing them cost.

    ``source`` is the sink's class name and ``durable`` is its own claim, because
    "there are no open incidents" and "there are no open incidents in this
    process's memory" are different answers to the question an operator asked; the
    pair is what lets a caller tell them apart without reading the deployment.
    """

    tenant_id: str
    source: str
    durable: bool
    limit: int
    returned: int
    incidents: list[IncidentView]
