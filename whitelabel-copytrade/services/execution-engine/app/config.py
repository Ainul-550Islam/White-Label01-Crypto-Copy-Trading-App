"""Configuration for the execution engine.

Every value comes from the environment. There are no defaults for secrets:
a missing or placeholder internal token stops the process rather than
starting a service that silently cannot authenticate its callers.

The field types are all defaulted so ``Settings()`` constructs cleanly under
mypy strict; the requirement that critical values EXIST is enforced in the
model validator, not by missing defaults, and the error messages name the
environment variable so a boot failure is self-explaining.
"""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from wlct_trading.enablement import EnablementError, EnablementPolicy
from wlct_trading.execution.live_confirmation import (
    LiveConfirmationError,
    LiveOperatorConfirmation,
)
from wlct_trading.execution.placement_attestor import (
    MAX_ATTESTER_TTL_MS,
    MIN_ATTESTER_TTL_MS,
)
from wlct_trading.execution.placement_review import (
    MAX_KEY_AGE_DAYS,
    MIN_KEY_AGE_DAYS,
    PlacementReviewError,
    PlacementReviewPolicy,
)
from wlct_trading.retention import RetentionError, RetentionPolicy

from app.secret_fetcher import VaultKvConfig

__all__ = ["Settings", "get_settings"]

#: Placeholder spellings rejected everywhere on this platform. A token that
#: reads "changeme" is the same as no token, and discovering that during an
#: incident is how incidents get longer.
#: Exact values that can never be a real secret, and the prefixes that mark
#: "this was a template nobody filled in" ("changeme-64-xs" is as placeholder
#: as "changeme" - suffix noise does not launder it).
_PLACEHOLDERS = frozenset(
    {
        "changeme",
        "change-me",
        "replace_me",
        "replace-me",
        "secret",
        "todo",
        "none",
        "null",
        "undefined",
        "example",
    }
)
_PLACEHOLDER_PREFIXES = ("changeme", "change-me", "replace_me", "replace-me")


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    # ------------------------------------------------------------------
    # Observability (Part 18)
    #
    # Same name, same meaning as in services/trading-engine and
    # services/market-data: a platform knob is not re-spelled per service, and
    # production refuses to parse with it off. What differs is only what this
    # service exposes - one Prometheus scrape of the engine's own instruments,
    # with no Redis mirror and no alert stream, because this process's evidence
    # lives in its durable tables and on /internal/v1/status.
    # ------------------------------------------------------------------
    OBSERVABILITY_ENABLED: bool = True

    # --- Identity and transport ------------------------------------------
    #: Names this instance in logs, the health surface and (later) the
    #: worker registry. Not a secret; not a credential; useful in a
    #: postmortem that says "which process thought it was leader".
    EXECUTION_INSTANCE_ID: str | None = None
    SERVICE_PORT: int = 8093
    #: Loopback by default: this process must be explicitly re-bound (env)
    #: to serve another container, and deployments that do so keep it on an
    #: internal network - the token is authentication, not segmentation.
    EXECUTION_ENGINE_HOST: str = "127.0.0.1"
    #: Shared secret with the Node worker. Minimum 32 characters, constant
    #: time compared in app.security, never logged.
    EXECUTION_INTERNAL_TOKEN: str | None = None

    # --- Mode ---------------------------------------------------------------
    #: "simulated" is the only mode this build transmits in. "live" parses
    #: (so a staged config does not fail boot for a syntax reason while it
    #: fails a safety reason) but startup refuses it with MODE_NOT_WIRED.
    EXECUTION_MODE: Literal["simulated", "live"] = "simulated"
    #: When true, order SUBMISSION stops before transmission. Cancellation
    #: is not a new position and stays available either way - failing to
    #: cancel a resting order is the larger risk of the two.
    EXECUTION_DRY_RUN: bool = True
    #: Per-request venue timeout handed to the core engine settings.
    EXECUTION_REQUEST_TIMEOUT_MS: int = 5_000
    #: Lease TTL for the core's own account/order locks (milliseconds).
    EXECUTION_LOCK_TTL_MS: int = 15_000
    #: Lock acquisition timeout (milliseconds). How long to wait for a lock
    #: before giving up. Shorter means faster failure; longer means less
    #: contention under load.
    EXECUTION_LOCK_ACQUISITION_TIMEOUT_MS: int = 5_000
    #: Lock renewal interval as a fraction of TTL (0.1–0.9). The renewal
    #: fires at TTL * ratio, giving two attempts before expiry at 1/3.
    EXECUTION_LOCK_RENEWAL_RATIO: float = 1.0 / 3.0
    #: Whether to use Redis-backed distributed locks. When false (default),
    #  the in-memory lock manager is used (simulated mode only). When true,
    #  EXECUTION_REDIS_URL must be set and reachable.
    EXECUTION_DISTRIBUTED_LOCKS: bool = False
    #: Redis URL for distributed locks, e.g. redis://localhost:6379/0.
    #: Required when EXECUTION_DISTRIBUTED_LOCKS=true.
    EXECUTION_REDIS_URL: str | None = None
    # --- Venue attestation (Part 22) -----------------------------------------
    #: Whether to include account-level checks in venue attestation
    #: (queries /api/v3/account for canTrade). Adds 20 weight units per
    #: attestation; disable for weight-constrained deployments.
    EXECUTION_VENUE_ATTESTATION_INCLUDE_ACCOUNT: bool = False
    #: Whether the venue is Binance testnet. Changes the REST base URL.
    EXECUTION_VENUE_ATTESTATION_TESTNET: bool = False
    #: Attestation cache TTL in milliseconds. Bounds enforced by the core's
    #: CachingPlacementAttestor (1000..3600000).
    EXECUTION_VENUE_ATTESTATION_CACHE_TTL_MS: int = 300_000

    # --- Simulated venue shaping -------------------------------------------
    #: Fixed mid used as top-of-book for any symbol. Unset means the paper
    #: book is empty: submissions are refused for lack of price, which is
    #: the honest default for a deployment that configured nothing.
    EXECUTION_SIMULATED_MID: str | None = None
    #: Comma-separated `ASSET=QUANTITY` seed balances for the simulated
    #: account. Balances are labelled simulated wherever they surface.
    EXECUTION_PAPER_BALANCES: str = "USDT=100000"

    # --- Durable state (Part 13) --------------------------------------------
    #: "memory" keeps the process-local reference store (everything this
    #: service did before Part 13; readiness honestly reports
    #: storeDurable=false). "postgres" requires the engine tables (owned by
    #: apps/api/prisma, applied by the API's migration job) and a DSN, and
    #: refuses startup without either - a store configured but unreachable
    #: is "not running", never "running degraded": the moment this process
    #: cannot durably record an order it must stop taking commands.
    EXECUTION_STORE_BACKEND: Literal["memory", "postgres"] = "memory"
    #: DSN for the engine store, e.g. postgresql://user:pass@db:5432/wlct.
    #: A credential: env-only, never logged, never in to_public_dict, and
    #: like every DSN on this platform it belongs to a dedicated role, not
    #: the owner. The engine sets app.tenant_id per transaction (the same
    #: contract as the API's withTenantRls), so these tables are RLS-safe
    #: from the day the operator flips policies on.
    EXECUTION_POSTGRES_DSN: str | None = None

    # --- Retention (Part 14) -----------------------------------------------
    #: The apply switch. False (the default) leaves every retention call in
    #: DRY-RUN: inspection always works, deletion never happens, and an
    #: apply request is refused with the config named. A maintenance job
    #: that destroys data does not run because a compose file once existed.
    #: It also does not run on a schedule nobody reviewed: the intended
    #: first use is inspect (disabled) -> scheduled dry-run -> one manual
    #: apply against a fresh backup -> enable (docs/PART14_RETENTION.md).
    EXECUTION_RETENTION_ENABLED: bool = False
    #: Days of journal kept beyond an order's own settlement (the cutoff
    #: applies to the event AND the order's terminal stamp - core law 2).
    #: Bounds are enforced by constructing the core policy below; this
    #: service has no second arithmetic for them.
    EXECUTION_RETENTION_EVENT_DAYS: int = 90
    #: Rows per DELETE statement, and statements per run. Together they
    #: cap one run at batch_rows * max_batches deletions - the ceiling a
    #: busy deployment tunes, and the reason a first prune after long
    #: dormancy is many small transactions instead of one huge one.
    EXECUTION_RETENTION_BATCH_ROWS: int = 2_000
    EXECUTION_RETENTION_MAX_BATCHES: int = 50

    # --- RLS enablement verification (Part 15) -----------------------------
    #: How long an enablement audit may sit before it stops counting as
    #: evidence. This is NOT enforcement - the audit is read-only and this
    #: service cannot fail closed over another service's row-level security -
    #: it is the freshness the response reports and the evidence ledger
    #: checks. A deployment that re-audits nightly keeps the number
    #: meaningless-in-a-good-way; one that never re-audits sees it go stale.
    #: Bounds (1..36,500 days) are the core's law, validated at boot below.
    EXECUTION_ENABLEMENT_MAX_AGE_DAYS: int = 30

    # --- placement review and the credential source (Part 16) --------------
    # There is deliberately no EXECUTION_PLACEMENT_REVIEW_ENABLED. A switch that
    # turns off "did the venue say this key may place this order" is not a
    # feature flag, it is a bypass, and this repository's guards do not ship
    # bypasses. What IS configurable is where the evidence comes from and how
    # expensive it may be - every field below is about cost or staleness, none
    # about permission.
    #: Where a live runtime would read key material from. ``none`` is the
    #: default and the only value a simulated deployment should have: it wires a
    #: provider that refuses every lookup, so an accidental authenticated call
    #: from a paper process fails loudly instead of finding a stray key in the
    #: environment. ``environment`` is development-only (see the refusal in
    #: ``_validate``); ``secret-manager`` is the multi-tenant path and takes its
    #: fetcher from the deployment's own secret backend, not from an env var.
    EXECUTION_CREDENTIAL_SOURCE: Literal["none", "environment", "secret-manager"] = "none"
    #: Prefix for the two variables ``environment`` reads. The core appends
    #: ``_API_KEY`` / ``_API_SECRET`` to it, so this carries NO trailing
    #: underscore: a prefix of ``WLCT_BINANCE_`` would look for
    #: ``WLCT_BINANCE__API_KEY``, which nobody ever sets, and the boot check
    #: below (which reads the same names this module computes) would pass while
    #: every order failed on a missing credential. Named here rather than
    #: hard-coded because a host that already injects ``BINANCE_*`` keys for
    #: another process must not have this one read them by accident.
    EXECUTION_CREDENTIAL_ENV_PREFIX: str = "WLCT_BINANCE"
    #: The single (tenant, account) an ``environment`` provider serves. The
    #: environment has no way to key a secret per customer, so a deployment that
    #: needs more than one pair of keys needs ``secret-manager`` - a limitation
    #: of the mechanism, stated rather than papered over.
    EXECUTION_CREDENTIAL_TENANT_ID: str = "tenant-1"
    EXECUTION_CREDENTIAL_ACCOUNT_ID: str = "account-1"
    #: How long a resolved credential may be cached before the provider goes
    #: back to its source. Zero is not offered: a cache with a zero TTL still
    #: pays the wrapper's bookkeeping and buys nothing.
    EXECUTION_CREDENTIAL_CACHE_SECONDS: int = 300
    #: How long a gathered placement attestation may be reused. This IS the
    #: freshness bound the review applies (one number, so the cache and the law
    #  cannot disagree about what "recent" means), and it is also why a burst of
    #  orders for one account costs one venue round trip rather than one per
    #  order. Bounds (1s..1h) are the core's law, enforced at boot below.
    EXECUTION_PLACEMENT_ATTESTATION_TTL_MS: int = 300_000
    #: How old a key may be and still trade. Rotation is an operator habit this
    #  platform can only encourage by refusing to trade on a key nobody has
    #  rotated in a year; bounds (1..36,500 days) are the core's law.
    EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS: int = 90
    #: Whether the venue must report an IP allowlist on the key. Default true,
    #  and ``false`` is refused outright for a live mode: a key that answers from
    #  any address is a key that is one leaked env file away from being someone
    #  else's trading account.
    EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST: bool = True

    # --- live credential fetcher and the operator confirmation (Part 19) --------
    # Two more things the live path needed and this service did not have: a concrete
    # reader for the ``secret-manager`` credential source, and a typed confirmation that
    # a human authorised this scope. Neither is a permission. The selector below picks
    # an implementation, and the confirmation block below feeds a check that can only
    # add refusals. ``EXECUTION_MODE=live`` still refuses at startup, with these two
    # additions named among the reasons.
    #: Which fetcher backs ``EXECUTION_CREDENTIAL_SOURCE=secret-manager``. ``none`` is
    #: the default and keeps every existing deployment byte-identical: the source then
    #: has no reader, and the boot refusal says so. ``vault-kv2`` is this service's own
    #: implementation over HashiCorp Vault's KV v2 API (see app/secret_fetcher.py); a
    #: deployment on a different KMS injects its own fetcher instead, which is the
    #: choice Part 16 left open and Part 19 deliberately did not close for anybody.
    EXECUTION_CREDENTIAL_FETCHER: Literal["none", "vault-kv2"] = "none"
    #: e.g. https://vault.internal:8200 . Required by vault-kv2. Credentials embedded
    #: in a URL (``user:pass@host``) are refused, not honoured.
    EXECUTION_VAULT_ADDR: str | None = None
    #: The KV v2 mount, one path segment (``secret`` in Vault's own quickstart).
    EXECUTION_VAULT_MOUNT: str = "secret"
    #: The lookup path, relative to ``/data/`` under the mount. The three placeholders
    #: are filled from this deployment's own identifiers, never from a request.
    EXECUTION_VAULT_PATH_TEMPLATE: str = "wlct/{tenant}/{account}/{exchange}"
    #: NAME of the environment variable holding the Vault token. The token is read from
    #: the process environment by the fetcher and is NEVER a field on this object, so
    #: no ``model_dump``, no ``to_public_dict`` and no debugger can surface it.
    EXECUTION_VAULT_TOKEN_ENV: str = "EXECUTION_VAULT_TOKEN"
    #: Vault enterprise namespace header. ``None`` sends no header.
    EXECUTION_VAULT_NAMESPACE: str | None = None
    EXECUTION_VAULT_TIMEOUT_MS: int = 3_000
    #: TLS verification of the Vault endpoint. ``false`` is refused in production, and
    #: the endpoint must be https in every mode (see VaultKvConfig).
    EXECUTION_VAULT_TLS_VERIFY: bool = True
    EXECUTION_VAULT_MAX_RESPONSE_BYTES: int = 65_536
    #: Require a verified operator confirmation on every placement review. Default
    #: false, and that default is the point: turning the check on is a deployment
    #: decision, and leaving it off must not change any verdict that exists today.
    #: This is NOT ``ALLOW_LIVE`` under another name - it cannot enable live mode, it
    #: cannot relax a review, and when it is on with nothing to verify, every order is
    #: refused as OPERATOR_CONFIRMATION_ABSENT.
    EXECUTION_REQUIRE_OPERATOR_CONFIRMATION: bool = False
    #: The confirmation record, inline as JSON. Mutually exclusive with the file form,
    #: because a deployment that has two sources of truth for one ceremony has two
    #: ceremonies.
    EXECUTION_OPERATOR_CONFIRMATION_JSON: str | None = None
    #: ...or the path to a file containing it. The record carries identities and a
    #: window and an HMAC tag, and no key material, so reading it off disk is a
    #: convenience rather than a secret-handling exception.
    EXECUTION_OPERATOR_CONFIRMATION_FILE: str | None = None
    #: NAME of the environment variable holding the HMAC key that verifies the record.
    #: Env-only, for the same reason as the Vault token, and checked for presence at
    #: boot by app/placement.py, which is where the verifier is assembled.
    EXECUTION_CONFIRMATION_KEY_ENV: str = "EXECUTION_CONFIRMATION_HMAC_KEY"

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> Settings:
        if self.NODE_ENV == "production" and not self.OBSERVABILITY_ENABLED:
            raise ValueError(
                "OBSERVABILITY_ENABLED=false in production: a process that can "
                "hold a venue key and place an order must expose what it measured "
                "while doing so. The stage histograms and the placement-review "
                "counters are how a refusal is distinguished from an outage "
                "without shell access; development may turn them off freely, a "
                "deployment holding real money may not."
            )
        return self

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if self.EXECUTION_INTERNAL_TOKEN is None or not self.EXECUTION_INTERNAL_TOKEN.strip():
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN is required (>= 32 chars); this "
                "service never starts unauthenticated"
            )
        if len(self.EXECUTION_INTERNAL_TOKEN) < 32:
            raise ValueError("EXECUTION_INTERNAL_TOKEN must be at least 32 characters")
        lowered = self.EXECUTION_INTERNAL_TOKEN.strip().lower()
        if lowered in _PLACEHOLDERS or lowered.startswith(_PLACEHOLDER_PREFIXES):
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN must not be a placeholder value "
                "(exact match or changeme-style prefix)"
            )
        if self.EXECUTION_INSTANCE_ID is None or not self.EXECUTION_INSTANCE_ID.strip():
            raise ValueError(
                "EXECUTION_INSTANCE_ID is required - every leader claim, log "
                "line and incident must be attributable to a process"
            )
        if len(self.EXECUTION_INSTANCE_ID) > 64:
            raise ValueError("EXECUTION_INSTANCE_ID must be at most 64 characters")
        if self.SERVICE_PORT < 1 or self.SERVICE_PORT > 65_535:
            raise ValueError("SERVICE_PORT must be a valid TCP port")
        if self.EXECUTION_REQUEST_TIMEOUT_MS < 250:
            raise ValueError(
                "EXECUTION_REQUEST_TIMEOUT_MS below 250 tests the venue, not the network"
            )
        if self.EXECUTION_LOCK_TTL_MS < 1_000:
            raise ValueError(
                "EXECUTION_LOCK_TTL_MS below one second elects on network jitter"
            )
        if self.EXECUTION_LOCK_ACQUISITION_TIMEOUT_MS < 100:
            raise ValueError(
                "EXECUTION_LOCK_ACQUISITION_TIMEOUT_MS below 100ms cannot "
                "reliably acquire a lock across a network"
            )
        if not 0.1 <= self.EXECUTION_LOCK_RENEWAL_RATIO <= 0.9:
            raise ValueError(
                "EXECUTION_LOCK_RENEWAL_RATIO must be between 0.1 and 0.9"
            )
        renewal_ms = int(self.EXECUTION_LOCK_TTL_MS * self.EXECUTION_LOCK_RENEWAL_RATIO)
        if renewal_ms >= self.EXECUTION_LOCK_TTL_MS:
            raise ValueError(
                f"Lock renewal interval ({renewal_ms}ms) must be strictly "
                f"less than lock TTL ({self.EXECUTION_LOCK_TTL_MS}ms)"
            )
        if self.EXECUTION_DISTRIBUTED_LOCKS:
            redis_url = (self.EXECUTION_REDIS_URL or "").strip()
            if not redis_url:
                raise ValueError(
                    "EXECUTION_DISTRIBUTED_LOCKS=true requires EXECUTION_REDIS_URL; "
                    "a distributed lock manager without a Redis URL is a "
                    "configuration that believes it is distributed while having "
                    "nowhere to lock"
                )
            if not redis_url.startswith(("redis://", "rediss://", "unix://")):
                raise ValueError(
                    "EXECUTION_REDIS_URL must start with redis://, rediss://, "
                    "or unix://; a malformed URL would fail at the first lock "
                    "acquisition rather than at startup"
                )
        if self.EXECUTION_SIMULATED_MID is not None:
            _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, sep, amount = part.partition("=")
            if not sep or not asset.strip():
                raise ValueError(
                    "EXECUTION_PAPER_BALANCES must be comma-separated ASSET=QUANTITY pairs"
                )
            _parse_decimal(amount, f"balance {asset.strip()!r}")
        # An EMPTY/whitespace DSN is treated as "unset" everywhere (compose
        # passes ${VAR:-} defaults; "" must not arm the mismatch law below).
        dsn = (self.EXECUTION_POSTGRES_DSN or "").strip()
        if self.EXECUTION_STORE_BACKEND == "postgres":
            if not dsn:
                raise ValueError(
                    "EXECUTION_STORE_BACKEND=postgres requires EXECUTION_POSTGRES_DSN; "
                    "a durable store that was configured but cannot connect is a "
                    "startup failure, never a degraded start"
                )
            if not dsn.startswith(("postgresql://", "postgresql+asyncpg://", "postgres://")):
                raise ValueError(
                    "EXECUTION_POSTGRES_DSN must be a postgresql:// connection string"
                )
        elif dsn:
            # A DSN present while the memory backend is selected means
            # somebody INTENDED durability and the setting silently did not
            # apply - the worst of both worlds (restart loses orders,
            # operator believes it cannot). Refuse the mismatched intent.
            raise ValueError(
                "EXECUTION_POSTGRES_DSN is set but EXECUTION_STORE_BACKEND=memory; "
                "either switch the backend to postgres or remove the DSN - a "
                "half-configured durable store is not a store"
            )
        # Retention bounds exist ONCE, in the core law; constructing the
        # policy here means a config typo names its env var at boot, and
        # an invalid policy can never reach a DELETE statement at all.
        try:
            RetentionPolicy(
                event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
                batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
                max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
            )
        except RetentionError as error:
            raise ValueError(
                f"retention configuration rejected by the core law: {error} "
                "(EXECUTION_RETENTION_EVENT_DAYS / _BATCH_ROWS / _MAX_BATCHES)"
            ) from error
        # Same discipline for the evidence window: the bound-checking law has
        # exactly one home (the core), boot fails on a typo, and the audit
        # endpoint can never receive a policy that "every evidence is fresh".
        try:
            EnablementPolicy(max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS)
        except EnablementError as error:
            raise ValueError(
                f"enablement configuration rejected by the core law: {error} "
                "(EXECUTION_ENABLEMENT_MAX_AGE_DAYS)"
            ) from error
        self._validate_placement()
        self._validate_live_wiring()
        return self

    def _validate_placement(self) -> None:
        """Part 16's own refusals, kept apart for the same reason the rest of
        this file is a validator rather than a pile of defaults: a deployment
        must not be able to start in a state where it believes it is guarded.
        """
        prefix = self.EXECUTION_CREDENTIAL_ENV_PREFIX.strip()
        if prefix.endswith("_"):
            # Refused rather than normalised. Silently stripping a trailing
            # underscore would make this module's boot check agree with itself
            # while the provider it is guarding looked for a different name
            # entirely, which is precisely the failure the check exists to
            # prevent - and an operator who wrote "ACME_" meant "ACME".
            raise ValueError(
                "EXECUTION_CREDENTIAL_ENV_PREFIX must not end in an underscore: "
                "the core appends the separator, so 'ACME_' resolves "
                "ACME__API_KEY. Drop the trailing underscore."
            )
        if self.EXECUTION_CREDENTIAL_SOURCE == "environment":
            if not prefix:
                raise ValueError(
                    "EXECUTION_CREDENTIAL_ENV_PREFIX is required when "
                    "EXECUTION_CREDENTIAL_SOURCE=environment; reading a "
                    "conventionally-named BINANCE_API_KEY from a shared "
                    "environment is how one service ends up trading on another "
                    "service's key"
                )
            if self.is_production:
                raise ValueError(
                    "EXECUTION_CREDENTIAL_SOURCE=environment is refused in "
                    "production (NODE_ENV=production): process-wide key material "
                    "cannot be scoped per tenant, is visible in every crash "
                    "dump, and does not rotate. Use secret-manager."
                )
        for name, value in (
            ("EXECUTION_CREDENTIAL_TENANT_ID", self.EXECUTION_CREDENTIAL_TENANT_ID),
            ("EXECUTION_CREDENTIAL_ACCOUNT_ID", self.EXECUTION_CREDENTIAL_ACCOUNT_ID),
        ):
            if not value.strip():
                raise ValueError(f"{name} must not be blank")
            if len(value) > 64:
                raise ValueError(f"{name} must be at most 64 characters")
        if self.EXECUTION_CREDENTIAL_CACHE_SECONDS < 1:
            raise ValueError(
                "EXECUTION_CREDENTIAL_CACHE_SECONDS must be at least 1; a "
                "credential cache that expires every second is a per-order "
                "secret lookup with extra steps"
            )
        ttl = self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS
        if not MIN_ATTESTER_TTL_MS <= ttl <= MAX_ATTESTER_TTL_MS:
            raise ValueError(
                f"EXECUTION_PLACEMENT_ATTESTATION_TTL_MS must be within "
                f"{MIN_ATTESTER_TTL_MS}..{MAX_ATTESTER_TTL_MS}; got {ttl}. "
                "Below one second every order pays for a venue round trip; above "
                "an hour the venue's console has had time to revoke the key and "
                "this process would not know"
            )
        if not MIN_KEY_AGE_DAYS <= self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS <= MAX_KEY_AGE_DAYS:
            raise ValueError(
                f"EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS must be within "
                f"{MIN_KEY_AGE_DAYS}..{MAX_KEY_AGE_DAYS}; got "
                f"{self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS}"
            )
        if (
            self.EXECUTION_MODE == "live"
            and not self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST
        ):
            raise ValueError(
                "EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST=false is refused in "
                "live mode. The IP allowlist is the one control on a leaked key "
                "that the venue enforces for us; a live deployment without it "
                "has decided that availability outranks that"
            )
        # "live but no credential source" is deliberately NOT refused here, even
        # though it is fatal: this validator's job is whether a value is
        # coherent, and "none" is a perfectly coherent answer that happens to be
        # wrong for live. The composition owns the whole picture - it is where the
        # runtime, the reviewer and the store come together - and its refusal
        # says what is missing instead of naming one variable, which is the
        # message an operator actually needs. Two places refusing the same
        # configuration means two messages, and only one of them explains.
        # The core's law is the last word, exactly as with retention and
        # enablement: the service checks the env var's shape, the policy object
        # checks the semantics, and the endpoint can never be handed a policy
        # that treats every attestation as fresh.
        try:
            PlacementReviewPolicy(
                max_attestation_age_ms=self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
                max_key_age_days=self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
                require_ip_allowlist=self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            )
        except PlacementReviewError as error:
            raise ValueError(
                f"placement review rejected by the core law: {error} "
                "(EXECUTION_PLACEMENT_ATTESTATION_TTL_MS / "
                "EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS)"
            ) from error

    def _validate_live_wiring(self) -> None:
        """Part 19's own refusals: the fetcher selector and the confirmation record.

        Kept apart from ``_validate_placement`` for the same reason that block is
        separate - one law per method, so a review of "what can a deployment
        configure about live mode" is a review of two named methods rather than of a
        five-hundred-line validator - and built on the same discipline: the shape rules
        live on the objects themselves (:class:`VaultKvConfig`,
        :class:`LiveOperatorConfirmation`), and this method only translates their
        refusals into a startup failure that names the environment variable.

        Deliberately NOT checked here, with the reasons:

        * **Presence of the Vault token.** That is the fetcher's boot check, in
          ``app/credentials.py``, which is also where an injectable ``environ`` lets a
          test prove it. Two places reading the same variable means two opinions about
          whether it is set.
        * **Whether the confirmation has expired.** A deployment whose record lapsed
          while it was running must still start: the process has reconciliation,
          cancellation and an audit trail to serve, and the per-order assessment
          refuses with ``OPERATOR_CONFIRMATION_EXPIRED`` (which is louder, per order,
          than a crash loop that also stops the cancel path). Boot checks the shape of
          the ceremony; the review checks its currency, every order.
        * **"Live mode needs both of these."** The composition root owns that whole
          picture and grades it with the core's ``evaluate_live_enablement``, which
          produces one message instead of two.
        """
        fetcher = self.EXECUTION_CREDENTIAL_FETCHER
        source = self.EXECUTION_CREDENTIAL_SOURCE
        if fetcher != "none" and source != "secret-manager":
            raise ValueError(
                f"EXECUTION_CREDENTIAL_FETCHER={fetcher} with "
                f"EXECUTION_CREDENTIAL_SOURCE={source!r}: the fetcher is consulted only "
                "by the secret-manager provider, so this combination is a deployment "
                "that believes it has credential plumbing it does not use. Either point "
                "the source at secret-manager or set the fetcher back to none."
            )
        if fetcher == "vault-kv2":
            try:
                # Bound to a name on purpose: constructing the object IS the check,
                # and this line's value is the exception it can raise. Reading the
                # property (rather than building a VaultKvConfig inline here) keeps the
                # field mapping in one place, so boot and runtime cannot disagree about
                # which settings feed the fetcher.
                validated_vault_config = self.vault_config
                if validated_vault_config.mount != self.EXECUTION_VAULT_MOUNT.strip("/"):
                    raise ValueError(
                        "the Vault mount did not normalise to one segment; this "
                        "deployment's EXECUTION_VAULT_MOUNT is being read differently "
                        "by the check that validates it and the object that uses it"
                    )
            except ValueError as error:
                raise ValueError(
                    f"vault-kv2 credential fetcher rejected at boot: {error}"
                ) from error
        inline = (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
        path = (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
        if inline and path:
            raise ValueError(
                "EXECUTION_OPERATOR_CONFIRMATION_JSON and _FILE are both set. One "
                "ceremony, one source of truth: a deployment that can load a "
                "confirmation from two places has two confirmations, and only one of "
                "them will be the one that is current when it matters."
            )
        if self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION and not (inline or path):
            raise ValueError(
                "EXECUTION_REQUIRE_OPERATOR_CONFIRMATION=true supplies no confirmation "
                "record, which would refuse every order in the deployment with "
                "OPERATOR_CONFIRMATION_ABSENT - a gate that only ever returns false is "
                "not a gate, it is an outage with extra labels. Supply the record, or "
                "turn the requirement off."
            )
        if self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION and not (
            self.EXECUTION_CONFIRMATION_KEY_ENV or ""
        ).strip():
            raise ValueError(
                "EXECUTION_CONFIRMATION_KEY_ENV names the variable holding the HMAC "
                "key and must not be blank; an empty name cannot be looked up, and a "
                "confirmation nothing can verify is a decoration."
            )
        # Parse the record now, so a malformed or forged-looking payload is a boot
        # failure rather than a first-order surprise. An absent record is not an error
        # here: the requirement above already refused the case that matters.
        record = self.operator_confirmation
        if record is not None and record.instance_id.strip() != (
            self.EXECUTION_INSTANCE_ID or ""
        ).strip():
            raise ValueError(
                f"the operator confirmation names instance {record.instance_id!r} and "
                f"this process is {self.EXECUTION_INSTANCE_ID!r}. The per-order review "
                "would refuse every submission for it, which is the right answer with "
                "the wrong timing: a template copied between deployments is a "
                "deployment starting with a ceremony it cannot complete, and that is a "
                "boot message."
            )

    @property
    def vault_config(self) -> VaultKvConfig:
        """The validated fetcher configuration (constructed, never stored).

        The shape rules live on :class:`VaultKvConfig` itself and this property only
        moves values, so a bad address or an unknown template placeholder is refused by
        one implementation and reported identically by boot and by the runtime. The
        Vault token is absent from this list because it is absent from this object:
        the fetcher reads it from the process environment, by the name below.
        """
        return VaultKvConfig(
            addr=self.EXECUTION_VAULT_ADDR or "",
            mount=self.EXECUTION_VAULT_MOUNT,
            path_template=self.EXECUTION_VAULT_PATH_TEMPLATE,
            token_env=self.EXECUTION_VAULT_TOKEN_ENV,
            namespace=self.EXECUTION_VAULT_NAMESPACE,
            timeout_ms=self.EXECUTION_VAULT_TIMEOUT_MS,
            verify_tls=self.EXECUTION_VAULT_TLS_VERIFY,
            max_response_bytes=self.EXECUTION_VAULT_MAX_RESPONSE_BYTES,
        )

    @property
    def operator_confirmation(self) -> LiveOperatorConfirmation | None:
        """The operator's record, parsed and validated, or None.

        Re-read on every access, like the other policy objects: the confirmation is
        deployment input, not process state, and a cached copy would be a second
        answer to "what did we confirm" that could outlive the file it came from.
        """
        inline = (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
        path = (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
        raw = inline
        if not raw and path:
            try:
                raw = Path(path).read_text(encoding="utf-8").strip()
            except OSError as error:
                raise ValueError(
                    f"EXECUTION_OPERATOR_CONFIRMATION_FILE could not be read: "
                    f"{type(error).__name__}. A required ceremony document that cannot "
                    "be opened is a boot failure, not a runtime one - the alternative "
                    "is a process that comes up 'unconfirmed' and refuses orders for a "
                    "reason its own logs do not mention."
                ) from error
        if not raw:
            return None
        try:
            payload = json.loads(raw)
        except ValueError as error:
            raise ValueError(
                f"the operator confirmation is not valid JSON: {type(error).__name__}"
            ) from error
        if not isinstance(payload, dict):
            raise ValueError(
                "the operator confirmation must be a JSON object with the fields "
                "instanceId, tenantId, accountId, exchange, symbols, orderTypes, "
                "issuedAtMicros, expiresAtMicros, nonce and digest"
            )
        try:
            return LiveOperatorConfirmation.from_payload(dict(payload))
        except LiveConfirmationError as error:
            raise ValueError(f"operator confirmation rejected: {error}") from error

    @property
    def placement_policy(self) -> PlacementReviewPolicy:
        """The core's validated review policy, built from this service's fields.

        Constructed, never stored - the same discipline as ``retention_policy``.
        The clock-skew and ``recvWindow`` bounds are deliberately not exposed
        here: they are the venue's signature protocol, not a deployment
        preference, and they default from the same constants
        :class:`~wlct_trading.execution.config.ExecutionSettings` uses. A
        deployment that believes it needs a wider window has a clock to fix, not
        a knob to turn, and a knob for it would be a documented way to trade on a
        clock nobody trusts.
        """
        return PlacementReviewPolicy(
            max_attestation_age_ms=self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
            max_key_age_days=self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
            require_ip_allowlist=self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            require_operator_confirmation=self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION,
        )

    @property
    def retention_policy(self) -> RetentionPolicy:
        """The core's validated policy, built from this service's fields.

        Constructed (not stored) so Settings stays a plain env reader and
        the bound-checking law has exactly one home; the startup validator
        above calls this to fail boot on a nonsensical configuration.
        """
        return RetentionPolicy(
            event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
            batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
            max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
        )

    @property
    def enablement_policy(self) -> EnablementPolicy:
        """The core's validated evidence policy, built from this service's
        field (constructed, never stored - same reason as
        ``retention_policy``: Settings stays a plain env reader)."""
        return EnablementPolicy(
            max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS
        )

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def simulated_mid(self) -> Decimal | None:
        if self.EXECUTION_SIMULATED_MID is None:
            return None
        return _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")

    @property
    def paper_balances(self) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, _, amount = part.partition("=")
            out[asset.strip().upper()] = _parse_decimal(amount, "balance")
        return out

    def to_public_dict(self) -> dict[str, object]:
        # A Vault address is topology, and a mount is configuration: both are only
        # meaningful when a fetcher is actually selected, and publishing defaults that
        # nothing reads is how a status page starts describing a deployment that does
        # not exist. This is the same reason ``credentialTarget`` is null for every
        # source but ``environment``.
        fetcher_wired = self.EXECUTION_CREDENTIAL_FETCHER != "none"
        """Everything except secrets - safe for the status endpoint and logs.

        The internal token is the one value this object must never leak, and
        the whitelist shape (constructing the view field by field) is how
        that stays true when fields are added later: a new secret appears in
        the public view only if someone adds it there deliberately.
        """
        return {
            "nodeEnv": self.NODE_ENV,
            "instanceId": self.EXECUTION_INSTANCE_ID,
            "servicePort": self.SERVICE_PORT,
            "mode": self.EXECUTION_MODE,
            "dryRun": self.EXECUTION_DRY_RUN,
            "requestTimeoutMillis": self.EXECUTION_REQUEST_TIMEOUT_MS,
            "lockTtlMillis": self.EXECUTION_LOCK_TTL_MS,
            "lockAcquisitionTimeoutMillis": self.EXECUTION_LOCK_ACQUISITION_TIMEOUT_MS,
            "distributedLocksEnabled": self.EXECUTION_DISTRIBUTED_LOCKS,
            "redisUrlConfigured": (self.EXECUTION_REDIS_URL or "").strip() != "",
            "simulatedMidConfigured": self.EXECUTION_SIMULATED_MID is not None,
            "paperBalanceAssets": sorted(self.paper_balances),
            # The DSN itself never appears here (whitelist law); the boolean
            # says "a credential is present" without saying anything about it.
            "storeBackend": self.EXECUTION_STORE_BACKEND,
            "postgresDsnConfigured": (self.EXECUTION_POSTGRES_DSN or "").strip() != "",
            # Retention is configuration an operator must be able to SEE
            # from the outside (is apply enabled? what does "days" mean
            # here?) - all four values are non-secret by construction.
            "retentionEnabled": self.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.EXECUTION_RETENTION_EVENT_DAYS,
            "retentionBatchRows": self.EXECUTION_RETENTION_BATCH_ROWS,
            "retentionMaxBatches": self.EXECUTION_RETENTION_MAX_BATCHES,
            # The enablement window is non-secret and operationally
            # load-bearing (it is what "stale" means HERE), so it is
            # published next to the retention knobs.
            "enablementMaxAgeDays": self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS,
            # Part 16. The credential *source* is published, never anything
            # derived from the material itself: "environment" or "none" is an
            # operational fact an operator needs in order to explain a refusal,
            # and it is also the only way to see from outside that a simulated
            # deployment is not quietly holding live keys.
            # Part 18: whether the scrape endpoint exists is a deployment fact a
            # monitoring pipeline needs in order to tell "no orders" from "no
            # exposition", and it is configuration, so it belongs in the same
            # whitelist as every other non-secret switch on this view.
            "observabilityEnabled": self.OBSERVABILITY_ENABLED,
            "credentialSource": self.EXECUTION_CREDENTIAL_SOURCE,
            "credentialCacheSeconds": self.EXECUTION_CREDENTIAL_CACHE_SECONDS,
            "credentialTarget": (
                f"{self.EXECUTION_CREDENTIAL_TENANT_ID}/"
                f"{self.EXECUTION_CREDENTIAL_ACCOUNT_ID}"
                if self.EXECUTION_CREDENTIAL_SOURCE == "environment"
                else None
            ),
            "placementAttestationTtlMillis": self.EXECUTION_PLACEMENT_ATTESTATION_TTL_MS,
            "placementMaxKeyAgeDays": self.EXECUTION_PLACEMENT_MAX_KEY_AGE_DAYS,
            "placementRequireIpAllowlist": self.EXECUTION_PLACEMENT_REQUIRE_IP_ALLOWLIST,
            # Part 19. The fetcher's IDENTITY and address are published, its token is
            # not even reachable from here (it lives only in the environment), and the
            # variable NAME is published precisely so an operator can see which name a
            # deployment is looking at without the value appearing anywhere.
            "credentialFetcher": self.EXECUTION_CREDENTIAL_FETCHER,
            "vaultMount": self.EXECUTION_VAULT_MOUNT if fetcher_wired else None,
            "vaultPathTemplate": (
                self.EXECUTION_VAULT_PATH_TEMPLATE if fetcher_wired else None
            ),
            "vaultTokenEnvVar": self.EXECUTION_VAULT_TOKEN_ENV if fetcher_wired else None,
            "vaultTlsVerify": self.EXECUTION_VAULT_TLS_VERIFY if fetcher_wired else None,
            # The confirmation's existence is configuration an operator must be able to
            # see from outside; its content is rendered by the reviewer's own describe()
            # (one home for the record's rendering), and its key never appears here.
            "requireOperatorConfirmation": self.EXECUTION_REQUIRE_OPERATOR_CONFIRMATION,
            "operatorConfirmationSource": (
                "inline"
                if (self.EXECUTION_OPERATOR_CONFIRMATION_JSON or "").strip()
                else "file"
                if (self.EXECUTION_OPERATOR_CONFIRMATION_FILE or "").strip()
                else None
            ),
            "confirmationKeyEnvVar": self.EXECUTION_CONFIRMATION_KEY_ENV,
        }


def _parse_decimal(raw: str, what: str) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except InvalidOperation as error:
        raise ValueError(f"{what} must be a decimal number") from error
    if not value.is_finite():
        raise ValueError(f"{what} must be finite")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()
