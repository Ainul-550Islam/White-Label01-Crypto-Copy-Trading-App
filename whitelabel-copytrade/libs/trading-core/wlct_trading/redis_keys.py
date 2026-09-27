"""Centralised Redis key construction for trading hot state.

Every key the trading data plane touches is built here. Scattering key strings
across services is how two components end up disagreeing about where state
lives, so this module is the single source of truth.

Tenancy
-------
Keys that hold tenant-owned state embed the tenant id, so a bug in one service
cannot read another tenant's positions or orders. Keys that hold genuinely
shared market data (order books, tickers) are deliberately *not* tenant-scoped:
the best bid for BTC-USDT is the same fact for everyone, and duplicating it per
tenant would multiply memory and feed load for no isolation benefit.

Kill switches are global infrastructure controls and are likewise not
tenant-scoped, except for the strategy switch which names a tenant-owned
strategy id.
"""

from __future__ import annotations

from wlct_trading.enums import ExchangeId, KillSwitchScope

__all__ = ["RedisKeys", "TRADING_STREAM", "TRADING_PUBSUB_CHANNEL"]

#: Redis Stream carrying the ordered trading event log.
TRADING_STREAM = "wlct:trading:events"

#: Pub/sub channel used to fan events out to the API's websocket gateway.
TRADING_PUBSUB_CHANNEL = "wlct:trading:dispatch"

_NS = "wlct:trading"


class RedisKeys:
    """Builders for every trading key. All methods are pure and static."""

    #: The shared prefix. Exposed so the execution layer can build lock keys in
    #: the same namespace without re-declaring the string, and so an operator
    #: can scope a ``SCAN`` or a ``FLUSH`` to trading state alone.
    NAMESPACE = _NS

    # -- shared market data (not tenant-scoped) ------------------------
    @staticmethod
    def book_top(exchange: ExchangeId, symbol: str) -> str:
        return f"{_NS}:book:{exchange.value}:{symbol}:top"

    @staticmethod
    def book_sequence(exchange: ExchangeId, symbol: str) -> str:
        return f"{_NS}:book:{exchange.value}:{symbol}:seq"

    @staticmethod
    def book_health(exchange: ExchangeId, symbol: str) -> str:
        return f"{_NS}:book:{exchange.value}:{symbol}:health"

    @staticmethod
    def ticker(exchange: ExchangeId, symbol: str) -> str:
        return f"{_NS}:ticker:{exchange.value}:{symbol}"

    @staticmethod
    def last_trade(exchange: ExchangeId, symbol: str) -> str:
        return f"{_NS}:trade:{exchange.value}:{symbol}"

    @staticmethod
    def symbol_registry(exchange: ExchangeId) -> str:
        return f"{_NS}:symbols:{exchange.value}"

    # -- kill switches (infrastructure controls) -----------------------
    @staticmethod
    def kill_switch(scope: KillSwitchScope, target: str | None = None) -> str:
        if scope is KillSwitchScope.GLOBAL:
            return f"{_NS}:killswitch:global"
        if target is None:
            raise ValueError(f"{scope.value} kill switch requires a target.")
        return f"{_NS}:killswitch:{scope.value.lower()}:{target}"

    @staticmethod
    def kill_switch_set(scope: KillSwitchScope) -> str:
        """Set of engaged targets for a scope, for a single-round-trip read."""
        return f"{_NS}:killswitch:{scope.value.lower()}:engaged"

    # -- tenant-scoped trading state -----------------------------------
    @staticmethod
    def position(tenant_id: str, account_id: str, exchange: ExchangeId, symbol: str) -> str:
        return f"{_NS}:t:{tenant_id}:pos:{account_id}:{exchange.value}:{symbol}"

    @staticmethod
    def account_positions(tenant_id: str, account_id: str) -> str:
        return f"{_NS}:t:{tenant_id}:pos:{account_id}:index"

    @staticmethod
    def open_orders(tenant_id: str, account_id: str) -> str:
        return f"{_NS}:t:{tenant_id}:orders:{account_id}:open"

    @staticmethod
    def order(tenant_id: str, order_id: str) -> str:
        return f"{_NS}:t:{tenant_id}:order:{order_id}"

    @staticmethod
    def client_order_id(tenant_id: str, client_order_id: str) -> str:
        """Idempotency marker. SET NX on this key is the cross-worker guard."""
        return f"{_NS}:t:{tenant_id}:coid:{client_order_id}"

    @staticmethod
    def order_rate(tenant_id: str, account_id: str, minute_bucket: int) -> str:
        """Per-minute order counter; the bucket makes expiry trivial."""
        return f"{_NS}:t:{tenant_id}:rate:{account_id}:{minute_bucket}"

    @staticmethod
    def daily_pnl(tenant_id: str, account_id: str, day: str) -> str:
        return f"{_NS}:t:{tenant_id}:pnl:{account_id}:{day}"

    @staticmethod
    def strategy_daily_pnl(tenant_id: str, strategy_id: str, day: str) -> str:
        return f"{_NS}:t:{tenant_id}:pnl:strategy:{strategy_id}:{day}"

    @staticmethod
    def strategy_state(tenant_id: str, strategy_id: str) -> str:
        return f"{_NS}:t:{tenant_id}:strategy:{strategy_id}:state"

    @staticmethod
    def session(tenant_id: str, session_id: str) -> str:
        return f"{_NS}:t:{tenant_id}:session:{session_id}"

    # -- Part 5: authenticated execution --------------------------------
    # Redis holds coordination state and hot caches for these. It is never the
    # permanent source of truth: every one of these keys can be lost without
    # losing a record, because PostgreSQL holds the durable copy.

    @staticmethod
    def idempotency(tenant_id: str, client_order_id: str) -> str:
        """TTL'd marker proving a clientOrderId has been used.

        Distinct from :meth:`client_order_id`, which is the permanent hot-state
        pointer. This one expires after EXECUTION_IDEMPOTENCY_TTL_SECONDS and
        exists to make the duplicate check cheap; the authoritative guard is
        the unique index on ``(tenant_id, client_order_id)``.
        """
        return f"{_NS}:t:{tenant_id}:idem:{client_order_id}"

    @staticmethod
    def order_lock(tenant_id: str, order_id: str) -> str:
        """Serialises all state changes for one order."""
        return f"{_NS}:lock:order:{tenant_id}:{order_id}"

    @staticmethod
    def account_lock(tenant_id: str, account_id: str) -> str:
        """Serialises order submission for one exchange account."""
        return f"{_NS}:lock:account:{tenant_id}:{account_id}"

    @staticmethod
    def reconciliation_lock(
        tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> str:
        """Ensures one reconciliation pass per account at a time."""
        return f"{_NS}:lock:reconcile:{tenant_id}:{account_id}:{exchange.value}"

    # -- coordination (Part 11) -------------------------------------------
    # Under :data:`NAMESPACE`'s lock namespace on purpose: one
    # ``SCAN wlct:trading:lock:*`` must show EVERY mutual-exclusion edge the
    # platform trusts - order locks, account locks, and the leader/partition
    # leases below - because a leader lease that lived somewhere an operator
    # could not see would be exactly the kind of invisible control state this
    # project has refused since Part 1.

    @staticmethod
    def leader_lease(name: str) -> str:
        """The single-writer lease gating a singleton loop (leader election).

        ``name`` is a bounded wire token identifying the ROLE being elected
        for (``execution-reconciliation``, ``copy-dispatch``, ...), never a
        tenant or a user id: leadership is a deployment-level fact. The value
        stored is the holder's fencing token; the TTL is the lease itself -
        there is no other release protocol and none is needed.
        """
        return f"{_NS}:lock:leader:{name}"

    @staticmethod
    def membership_registry(name: str) -> str:
        """The self-registration zset for a coordinated worker group (Part 12).

        One key per group; members are the zset's values and heartbeat-expiry
        epochs (unix millis) are its scores. Deliberately NOT tenant-scoped -
        membership is fleet topology, and fleet topology is operator-visible
        state, shared across every tenant by necessity. The staleness law
        lives in :mod:`wlct_trading.coordination.membership`, not here.
        """
        return f"{_NS}:coord:members:{name}"

    @staticmethod
    def partition_claim(name: str, partition: int) -> str:
        """One timed claim per partition of a coordinated worker group.

        ``(name, partition)`` is the unit of exclusion and the VALUE stored
        is the claiming member's identity (a ``host:pid:uuid`` token), the
        same GET-compare-release shape as the leader lease: a member renewing
        its own claim succeeds silently, a stranger cannot extend it, and an
        expired claim simply becomes claimable. A claim passing hands is a
        liveness event (work pauses for at most one TTL), never a safety one,
        because partition work is idempotent by the same rule that makes the
        order locks a guard rather than an authority.
        """
        if partition < 0:
            raise ValueError("partition indexes are non-negative")
        return f"{_NS}:lock:partition:{name}:{partition:d}"

    @staticmethod
    def reconciliation_cursor(
        tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> str:
        """When the last successful pass finished.

        Read by the health endpoint: "reconciliation has not completed for an
        hour" is itself an alertable condition, and it is invisible without a
        recorded cursor.
        """
        return f"{_NS}:t:{tenant_id}:reconcile:{account_id}:{exchange.value}:cursor"

    @staticmethod
    def pending_reconciliation(tenant_id: str) -> str:
        """Set of order ids whose venue state is not known."""
        return f"{_NS}:t:{tenant_id}:reconcile:pending"

    @staticmethod
    def listen_key_state(
        tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> str:
        """Private-stream key **metadata** — never the key itself.

        Holds the creation time, renewal count and masked identifier so an
        operator can see the stream's health. Storing the listen key here would
        put a bearer credential in a datastore that is deliberately not
        encrypted at rest.
        """
        return f"{_NS}:t:{tenant_id}:stream:{account_id}:{exchange.value}:meta"

    @staticmethod
    def clock_offset(exchange: ExchangeId) -> str:
        """Measured offset against a venue's clock, shared between workers."""
        return f"{_NS}:clock:{exchange.value}:offset"

    @staticmethod
    def execution_incident(tenant_id: str, incident_id: str) -> str:
        """Hot copy of an incident. The durable record is in PostgreSQL."""
        return f"{_NS}:t:{tenant_id}:incident:{incident_id}"

    @staticmethod
    def open_incidents(tenant_id: str) -> str:
        """Set of unresolved incident ids, for the admin dashboard badge."""
        return f"{_NS}:t:{tenant_id}:incidents:open"

    @staticmethod
    def exchange_health(exchange: ExchangeId) -> str:
        """Last observed venue health, consumed by the EXCHANGE_HEALTHY gate."""
        return f"{_NS}:health:exchange:{exchange.value}"

    # -- Part 8: real-time risk engine ----------------------------------
    # Hot *risk* state. Like the Part 5 keys, Redis is never the source of
    # truth for anything permanent: configuration versions and risk events
    # are durable in PostgreSQL, and every key here can be lost without
    # losing a record - the cost of a loss is that the next decision fails
    # closed until state is rebuilt, which is the intended behaviour, not an
    # incident.

    @staticmethod
    def risk_snapshot(tenant_id: str, account_id: str) -> str:
        """Latest assembled risk snapshot (JSON string with version field)."""
        return f"{_NS}:t:{tenant_id}:risk:{account_id}:snapshot"

    @staticmethod
    def risk_snapshot_version(tenant_id: str, account_id: str) -> str:
        """Monotonic snapshot version counter. ``INCR`` on every update.

        Readers must take the version and the payload from the SAME pipeline
        reply; a snapshot whose version disagrees with the counter is treated
        as corrupted and fails closed.
        """
        return f"{_NS}:t:{tenant_id}:risk:{account_id}:version"

    @staticmethod
    def risk_config_version(tenant_id: str, account_id: str) -> str:
        """Configuration version pointer.

        A config change bumps this; snapshots carrying an older
        ``configVersion`` are stale by definition and are refused. That is
        the invalidation channel: the writer never reaches into readers.
        """
        return f"{_NS}:t:{tenant_id}:risk:{account_id}:config:version"

    @staticmethod
    def risk_reservation(tenant_id: str, account_id: str) -> str:
        """Hash of atomically reserved risk budget for one account.

        Fields mirror the exposure dimensions the reservation ledger
        guards (notional per symbol/strategy/group/account, open-order
        count). ``HINCRBYFLOAT``/``HINCRBY`` inside Lua is the
        check-and-reserve primitive that keeps two engine instances from
        both concluding a spent budget is still available.
        """
        return f"{_NS}:t:{tenant_id}:risk:{account_id}:reserved"

    @staticmethod
    def risk_rate(
        tenant_id: str,
        account_id: str,
        kind: str,
        bucket_seconds: int,
        bucket: int,
    ) -> str:
        """Rate counter for ``order``/``cancel`` over a fixed bucket.

        ``bucket`` is ``now_micros // bucket_seconds`` in microseconds, so
        the key itself encodes the window and expiry is trivial. One key per
        (kind, bucket size) - the minute bucket is not derived from seconds
        at read time because per-key TTL drift would make the derived figure
        lie during exactly the bursts the counter exists to catch.
        """
        return f"{_NS}:t:{tenant_id}:rate:{account_id}:{kind}:{bucket_seconds}:{bucket}"

    @staticmethod
    def risk_event_idem(tenant_id: str, dedupe_key: str) -> str:
        """Idempotency marker for one risk event (SET NX + TTL).

        The dedupe key is content-addressed, so the same breach observed by
        two workers collapses to one emitted event without coordination.
        """
        return f"{_NS}:t:{tenant_id}:risk:event:{dedupe_key}"

    @staticmethod
    def risk_events_stream(tenant_id: str) -> str:
        """Per-tenant stream of normalised risk events for durable sinks."""
        return f"{_NS}:t:{tenant_id}:risk:events"

    # ------------------------------------------------------------------
    # Part 9: observability hot state (mirrors, never sources of truth)
    # ------------------------------------------------------------------
    @staticmethod
    def ops_alerts_mirror(service: str) -> str:
        """Active alert records published by one service for API persistence.

        A HASH keyed by alert dedupe key holding the engine's exact
        ``mirror_payload()`` JSON. The API's maintenance job folds it into
        durable rows; if the key is absent the last mirror simply ages -
        alerts never resolve from absence alone, because "the publisher is
        down" is an infra incident, not a recovery.
        """
        return f"{_NS}:ops:alerts:{service}"

    @staticmethod
    def ops_health_mirror(service: str) -> str:
        """Latest component health document published by one service."""
        return f"{_NS}:ops:health:{service}"

    @staticmethod
    def ops_readiness_mirror(service: str) -> str:
        """Latest trading-plane gate verdicts published by one service.

        Only the trading engine writes this today; the shape is per-service
        so an execution worker can later publish its own gates and the API
        merge treats absent documents as unknown (fail-closed), never as
        agreement.
        """
        return f"{_NS}:ops:readiness:{service}"
