"""Credential resolution and the secret-access boundary.

This module is the *only* place in the trading core that holds exchange secret
material in memory, and it is deliberately small enough to audit in one sitting.

The rules it enforces structurally rather than by convention:

* A secret is never in a ``repr``, a ``str``, an f-string, an exception message
  or a log record. :class:`ExchangeCredentials` overrides every dunder that
  could leak one, including the pickle hooks — a credential that can be
  serialised is a credential that ends up in a queue payload.
* Nothing above the adapter boundary ever receives one. The strategy engine,
  the signal engine, the risk engine, the API layer and the websocket gateway
  all deal in ``account_id``; only a :class:`CredentialProvider` can turn that
  into signing material, and only the exchange adapter holds a provider.
* There is no plaintext database provider here, and there is not going to be
  one. The persistence-backed provider takes an injected *decryptor* so the
  key-management decision (KMS, Vault, envelope encryption with a KEK) is made
  by the deployment, not baked into the library.

The platform is non-custodial, so a key with withdrawal permission is refused
outright rather than warned about — see :meth:`ExchangeCredentials.assert_safe`.
"""

from __future__ import annotations

import hmac
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Iterable, Mapping

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId

__all__ = [
    "REDACTED",
    "CredentialError",
    "CredentialNotFound",
    "UnsafeCredential",
    "CredentialPermission",
    "ExchangeCredentials",
    "SigningContext",
    "CredentialProvider",
    "StaticCredentialProvider",
    "EnvironmentCredentialProvider",
    "SecretManagerCredentialProvider",
    "CachingCredentialProvider",
    "NullCredentialProvider",
    "redact_secrets",
]

#: What a secret looks like anywhere it might be rendered.
REDACTED = "[redacted]"

_MIN_KEY_LENGTH = 16
_MIN_SECRET_LENGTH = 16

#: Values an operator might paste into a ``.env`` while wiring things up. A key
#: that is really one of these must fail at startup, not at the first order.
_PLACEHOLDER_VALUES = frozenset(
    {
        "",
        "-",
        "changeme",
        "change_me",
        "change-me",
        "placeholder",
        "your_api_key",
        "your_api_secret",
        "your-api-key",
        "your-api-secret",
        "api_key",
        "api_secret",
        "secret",
        "test",
        "xxx",
        "todo",
        "none",
        "null",
        "undefined",
    }
)


class CredentialError(Exception):
    """Base class for credential resolution failures.

    Subclasses never include secret material in their message.
    """


class CredentialNotFound(CredentialError):
    """No credential is configured for the requested account."""


class UnsafeCredential(CredentialError):
    """The credential exists but must not be used.

    Raised for a withdrawal-capable key, a placeholder value, or a key that is
    too short to be genuine.
    """


class CredentialPermission(str):
    """A permission the venue reports for a key.

    A plain ``str`` subclass rather than an enum: venues invent permission
    names, and an unknown one must be preservable rather than dropped on the
    floor. The three the platform reasons about are named below.
    """

    __slots__ = ()


#: Permissions the platform actively cares about.
PERMISSION_READ = CredentialPermission("READ")
PERMISSION_SPOT_TRADE = CredentialPermission("SPOT_TRADE")
PERMISSION_WITHDRAW = CredentialPermission("WITHDRAW")


def redact_secrets(text: str, secrets: Iterable[str]) -> str:
    """Replace every occurrence of a secret in ``text``.

    A defence in depth, not the primary control. The primary control is that
    secrets are never put into a string in the first place; this exists for the
    one place that cannot be avoided — a venue error body echoing back part of a
    request — and for tests that assert the property holds.
    """
    redacted = text
    for secret in secrets:
        if secret and len(secret) >= 8:
            redacted = redacted.replace(secret, REDACTED)
    return redacted


@dataclass(frozen=True)
class ExchangeCredentials:
    """Signing material for one exchange account.

    Not a ``slots`` dataclass, because the redaction overrides below need to be
    the only way this object renders and ``slots=True`` combined with the
    frozen-dataclass ``__repr__`` generation makes that harder to guarantee.

    ``api_secret`` is readable — the signer needs it — but the object cannot be
    printed, formatted, logged, pickled, copied into a dict or compared in a way
    that reveals it.
    """

    exchange: ExchangeId
    tenant_id: str
    account_id: str
    api_key: str
    api_secret: str
    permissions: frozenset[str] = field(default_factory=frozenset)
    #: Set when the venue or the operator has given the key an expiry.
    expires_at_micros: int | None = None
    #: Free-form, non-secret provenance for audit ("env", "vault:path", "kms").
    source: str = "unspecified"

    # ------------------------------------------------------------------
    # Leak prevention
    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"ExchangeCredentials(exchange={self.exchange.value!r}, "
            f"tenant_id={self.tenant_id!r}, account_id={self.account_id!r}, "
            f"api_key={self.masked_api_key!r}, api_secret={REDACTED!r}, "
            f"source={self.source!r})"
        )

    def __str__(self) -> str:
        return self.__repr__()

    def __format__(self, _spec: str) -> str:
        # Without this, f"{credentials:>10}" would bypass __str__ formatting
        # rules on some paths.
        return self.__repr__()

    def __reduce__(self) -> tuple[object, ...]:
        raise TypeError(
            "ExchangeCredentials must not be pickled or serialised. Pass the "
            "account id and resolve the credential at the point of use."
        )

    def __getstate__(self) -> dict[str, object]:
        raise TypeError(
            "ExchangeCredentials must not be serialised; it holds secret material."
        )

    # ------------------------------------------------------------------
    # Safe accessors
    # ------------------------------------------------------------------
    @property
    def masked_api_key(self) -> str:
        """Last four characters only, which is what the UI and audit log show.

        Enough to tell two keys apart during an incident, useless to an
        attacker who reads a log.
        """
        if len(self.api_key) <= 4:
            return REDACTED
        return f"****{self.api_key[-4:]}"

    @property
    def api_key_last_four(self) -> str:
        return self.api_key[-4:] if len(self.api_key) >= 4 else ""

    @property
    def can_trade(self) -> bool:
        return PERMISSION_SPOT_TRADE in self.permissions

    @property
    def can_withdraw(self) -> bool:
        return PERMISSION_WITHDRAW in self.permissions

    def is_expired(self, *, now_micros: int | None = None) -> bool:
        if self.expires_at_micros is None:
            return False
        now = epoch_micros() if now_micros is None else now_micros
        return now >= self.expires_at_micros

    def matches_secret(self, candidate: str) -> bool:
        """Constant-time secret comparison, for rotation checks.

        ``hmac.compare_digest`` rather than ``==`` so the comparison does not
        leak the length of the common prefix through timing.
        """
        return hmac.compare_digest(self.api_secret, candidate)

    def to_log_fields(self) -> dict[str, object]:
        """Everything about this credential that is safe to log."""
        return {
            "exchange": self.exchange.value,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "apiKeyLastFour": self.api_key_last_four,
            "permissions": sorted(self.permissions),
            "source": self.source,
            "expiresAtMicros": self.expires_at_micros,
        }

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    def assert_safe(self, *, now_micros: int | None = None) -> None:
        """Refuse a credential that must not be used. Raises, never warns.

        Withdrawal permission is fatal. The platform is non-custodial: it has no
        legitimate use for a key that can move funds off the exchange, and
        holding one turns a compromise of this service into a theft.
        """
        if self.can_withdraw:
            raise UnsafeCredential(
                f"API key {self.masked_api_key} for account {self.account_id} has "
                f"WITHDRAW permission enabled. This platform is non-custodial and "
                f"refuses withdrawal-capable keys. Disable withdrawals on the key "
                f"at the exchange, then re-add it."
            )
        if self.is_expired(now_micros=now_micros):
            raise UnsafeCredential(
                f"API key {self.masked_api_key} for account {self.account_id} has "
                f"expired. Rotate it at the exchange and update the stored secret."
            )

    def __post_init__(self) -> None:
        key = self.api_key.strip()
        secret = self.api_secret.strip()
        if key.lower() in _PLACEHOLDER_VALUES or secret.lower() in _PLACEHOLDER_VALUES:
            raise UnsafeCredential(
                f"The credential configured for account {self.account_id} is a "
                f"placeholder value, not a real key. Configure a real API key or "
                f"leave it unset."
            )
        if len(key) < _MIN_KEY_LENGTH:
            raise UnsafeCredential(
                f"The API key configured for account {self.account_id} is "
                f"{len(key)} characters, which is too short to be genuine."
            )
        if len(secret) < _MIN_SECRET_LENGTH:
            raise UnsafeCredential(
                f"The API secret configured for account {self.account_id} is too "
                f"short to be genuine."
            )
        if key != self.api_key or secret != self.api_secret:
            # Surrounding whitespace in a pasted key produces a signature
            # mismatch that is very hard to diagnose from the venue's error.
            raise UnsafeCredential(
                f"The credential for account {self.account_id} has leading or "
                f"trailing whitespace. Strip it before storing."
            )


@dataclass(frozen=True)
class SigningContext:
    """Short-lived signing handle handed to an adapter.

    Satisfies the ``object`` return of the Part 2 ``CredentialResolver``
    protocol while giving the adapter a typed handle. It exists so that the
    lifetime of decrypted material is explicit: an adapter asks for one per
    request batch and drops it, rather than caching a secret for the life of
    the process.
    """

    credentials: ExchangeCredentials
    issued_at_micros: int = field(default_factory=epoch_micros)
    ttl_micros: int = 60_000_000

    @property
    def api_key(self) -> str:
        return self.credentials.api_key

    def is_stale(self, *, now_micros: int | None = None) -> bool:
        now = epoch_micros() if now_micros is None else now_micros
        return now - self.issued_at_micros >= self.ttl_micros

    def __repr__(self) -> str:
        return (
            f"SigningContext(account_id={self.credentials.account_id!r}, "
            f"api_key={self.credentials.masked_api_key!r}, secret={REDACTED!r})"
        )

    __str__ = __repr__


class CredentialProvider(ABC):
    """Resolves an ``(tenant, account)`` pair to signing material.

    Implements the Part 2 ``CredentialResolver`` protocol
    (:meth:`signing_context`) so an adapter written against the original
    contract accepts any of these without change.
    """

    @property
    @abstractmethod
    def source(self) -> str:
        """Non-secret description of where credentials come from, for audit."""

    @abstractmethod
    async def resolve(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ExchangeCredentials:
        """Return credentials, or raise :class:`CredentialNotFound`."""

    async def signing_context(self, tenant_id: str, account_id: str) -> SigningContext:
        """Part 2 ``CredentialResolver`` entry point.

        The exchange is not a parameter of the original protocol, so
        implementations that serve more than one venue should be wrapped
        per-venue. :meth:`resolve` is the richer entry point.
        """
        credentials = await self.resolve(tenant_id, account_id, self.default_exchange)
        credentials.assert_safe()
        return SigningContext(credentials=credentials)

    @property
    def default_exchange(self) -> ExchangeId:
        """Venue assumed by :meth:`signing_context`."""
        return ExchangeId.BINANCE

    async def invalidate(self, tenant_id: str, account_id: str) -> None:
        """Drop any cached material. Default is a no-op."""
        return None


class StaticCredentialProvider(CredentialProvider):
    """Credentials supplied directly at construction.

    For tests and for a single-account deployment configured entirely from a
    secret manager at boot. Holds no I/O.
    """

    __slots__ = ("_by_key", "_default_exchange")

    def __init__(
        self,
        credentials: Iterable[ExchangeCredentials] = (),
        *,
        default_exchange: ExchangeId = ExchangeId.BINANCE,
    ) -> None:
        self._by_key: dict[tuple[str, str, str], ExchangeCredentials] = {}
        self._default_exchange = default_exchange
        for credential in credentials:
            self.add(credential)

    @property
    def source(self) -> str:
        return "static"

    @property
    def default_exchange(self) -> ExchangeId:
        return self._default_exchange

    def add(self, credential: ExchangeCredentials) -> None:
        key = (credential.tenant_id, credential.account_id, credential.exchange.value)
        self._by_key[key] = credential

    async def resolve(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ExchangeCredentials:
        credential = self._by_key.get((tenant_id, account_id, exchange.value))
        if credential is None:
            raise CredentialNotFound(
                f"No {exchange.value} credential is configured for account "
                f"{account_id} in tenant {tenant_id}."
            )
        return credential


class EnvironmentCredentialProvider(CredentialProvider):
    """Reads credentials from environment variables. **Development only.**

    Suitable for a developer machine and for a single-account container where
    the orchestrator injects secrets as environment variables from a secret
    manager. It is *not* suitable for multi-tenant production: one process-wide
    key cannot serve many tenants' accounts, so this provider refuses to answer
    for an account other than the one it was bound to.

    Variable names default to ``BINANCE_API_KEY`` / ``BINANCE_API_SECRET``.
    """

    __slots__ = ("_environ", "_exchange", "_tenant_id", "_account_id", "_prefix")

    def __init__(
        self,
        environ: Mapping[str, str],
        *,
        exchange: ExchangeId = ExchangeId.BINANCE,
        tenant_id: str,
        account_id: str,
        prefix: str | None = None,
    ) -> None:
        self._environ = environ
        self._exchange = exchange
        self._tenant_id = tenant_id
        self._account_id = account_id
        self._prefix = (prefix or exchange.value).upper()

    @property
    def source(self) -> str:
        return "environment"

    @property
    def default_exchange(self) -> ExchangeId:
        return self._exchange

    async def resolve(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ExchangeCredentials:
        if (tenant_id, account_id) != (self._tenant_id, self._account_id):
            raise CredentialNotFound(
                f"The environment credential provider is bound to a single "
                f"account and cannot serve account {account_id}. Use a secret "
                f"manager backed provider for multi-account deployments."
            )
        if exchange is not self._exchange:
            raise CredentialNotFound(
                f"The environment credential provider is bound to "
                f"{self._exchange.value} and cannot serve {exchange.value}."
            )

        key_name = f"{self._prefix}_API_KEY"
        secret_name = f"{self._prefix}_API_SECRET"
        api_key = (self._environ.get(key_name) or "").strip()
        api_secret = (self._environ.get(secret_name) or "").strip()

        if not api_key or not api_secret:
            raise CredentialNotFound(
                f"{key_name} and {secret_name} must both be set to use "
                f"authenticated {exchange.value} endpoints. They are unset, which "
                f"is the correct default: without them the platform runs in "
                f"public-market-data mode."
            )

        permissions = _parse_permissions(
            self._environ.get(f"{self._prefix}_API_PERMISSIONS")
        )
        return ExchangeCredentials(
            exchange=exchange,
            tenant_id=tenant_id,
            account_id=account_id,
            api_key=api_key,
            api_secret=api_secret,
            permissions=permissions,
            source="environment",
        )


def _parse_permissions(raw: str | None) -> frozenset[str]:
    """Parse a comma-separated permission list.

    Defaults to read plus spot trading — never withdrawal, which must be an
    explicit, and therefore auditable, act of configuration before
    :meth:`ExchangeCredentials.assert_safe` refuses it.
    """
    if raw is None or not raw.strip():
        return frozenset({PERMISSION_READ, PERMISSION_SPOT_TRADE})
    return frozenset(
        item.strip().upper() for item in raw.split(",") if item.strip()
    )


#: Fetches encrypted-at-rest material and returns the *decrypted* pair. The
#: implementation lives in the host service so the key-management architecture
#: (KMS, Vault transit, envelope encryption under a KEK) is a deployment
#: decision. It must never be backed by plaintext storage.
SecretFetcher = Callable[[str, str, ExchangeId], Awaitable["ResolvedSecret"]]


@dataclass(frozen=True)
class ResolvedSecret:
    """What a secret manager returns.

    A dedicated type rather than a tuple so that adding a field later cannot
    silently reorder an unpacking at a call site.
    """

    api_key: str
    api_secret: str
    permissions: frozenset[str] = field(default_factory=frozenset)
    expires_at_micros: int | None = None
    source: str = "secret-manager"

    def __repr__(self) -> str:
        return f"ResolvedSecret(api_key={REDACTED!r}, api_secret={REDACTED!r})"

    __str__ = __repr__


class SecretManagerCredentialProvider(CredentialProvider):
    """Production provider: delegates to an injected secret manager.

    The library deliberately does not implement the fetch. Whether the material
    lives in AWS Secrets Manager, GCP Secret Manager, Vault, or in PostgreSQL
    encrypted under a KMS-held KEK is a deployment decision, and hard-coding one
    here would guarantee the wrong one for somebody.

    What the library *does* enforce is that whatever comes back is validated
    (:meth:`ExchangeCredentials.assert_safe`) before it can sign anything.
    """

    __slots__ = ("_fetch", "_exchange", "_source")

    def __init__(
        self,
        fetch: SecretFetcher,
        *,
        exchange: ExchangeId = ExchangeId.BINANCE,
        source: str = "secret-manager",
    ) -> None:
        self._fetch = fetch
        self._exchange = exchange
        self._source = source

    @property
    def source(self) -> str:
        return self._source

    @property
    def default_exchange(self) -> ExchangeId:
        return self._exchange

    async def resolve(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ExchangeCredentials:
        try:
            resolved = await self._fetch(tenant_id, account_id, exchange)
        except CredentialError:
            raise
        except Exception as exc:  # noqa: BLE001 - normalised, never re-raised raw
            # The underlying exception may embed a decrypted value or a KMS
            # request body, so only the type is surfaced.
            raise CredentialNotFound(
                f"The secret manager could not supply a credential for account "
                f"{account_id}: {type(exc).__name__}."
            ) from None

        return ExchangeCredentials(
            exchange=exchange,
            tenant_id=tenant_id,
            account_id=account_id,
            api_key=resolved.api_key,
            api_secret=resolved.api_secret,
            permissions=resolved.permissions,
            expires_at_micros=resolved.expires_at_micros,
            source=resolved.source or self._source,
        )


class CachingCredentialProvider(CredentialProvider):
    """Short-TTL cache in front of another provider.

    A KMS decrypt on every signed request is both slow and expensive, and the
    per-request latency lands directly in the order path. The TTL is short and
    the cache is explicitly invalidatable so a rotated or revoked key stops
    working promptly.

    Entries are dropped as soon as they expire rather than served stale.
    """

    __slots__ = ("_inner", "_ttl_micros", "_cache", "_max_entries")

    def __init__(
        self,
        inner: CredentialProvider,
        *,
        ttl_seconds: int = 300,
        max_entries: int = 512,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive.")
        self._inner = inner
        self._ttl_micros = ttl_seconds * 1_000_000
        self._max_entries = max_entries
        self._cache: dict[tuple[str, str, str], tuple[int, ExchangeCredentials]] = {}

    @property
    def source(self) -> str:
        return f"cached({self._inner.source})"

    @property
    def inner(self) -> CredentialProvider:
        """The wrapped provider.

        Public because ``source`` already reports the wrapper
        (``cached(environment:...)``), and a status surface or a test that can
        see the label but not the object behind it cannot tell a wired provider
        from a *second* wrapper. Every cache in this platform that changes what
        callers observe says what it is sitting on.
        """
        return self._inner

    @property
    def default_exchange(self) -> ExchangeId:
        return self._inner.default_exchange

    async def resolve(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ExchangeCredentials:
        key = (tenant_id, account_id, exchange.value)
        now = epoch_micros()

        cached = self._cache.get(key)
        if cached is not None:
            stored_at, credentials = cached
            if now - stored_at < self._ttl_micros and not credentials.is_expired(
                now_micros=now
            ):
                return credentials
            del self._cache[key]

        credentials = await self._inner.resolve(tenant_id, account_id, exchange)

        if len(self._cache) >= self._max_entries:
            # Evict the oldest rather than growing without bound. A credential
            # cache that grows with tenant count is a memory leak with secrets
            # in it.
            oldest = min(self._cache, key=lambda k: self._cache[k][0])
            del self._cache[oldest]

        self._cache[key] = (now, credentials)
        return credentials

    async def invalidate(self, tenant_id: str, account_id: str) -> None:
        """Forget every cached credential for an account, across venues."""
        for key in [k for k in self._cache if k[0] == tenant_id and k[1] == account_id]:
            del self._cache[key]
        await self._inner.invalidate(tenant_id, account_id)

    def clear(self) -> None:
        self._cache.clear()

    @property
    def size(self) -> int:
        return len(self._cache)


class NullCredentialProvider(CredentialProvider):
    """Refuses every request. The default wiring.

    Paper and market-data services are constructed with this, so an attempt to
    reach an authenticated endpoint from a component that should never do so
    fails immediately and loudly instead of finding a key that happened to be in
    the environment.
    """

    __slots__ = ("_reason",)

    def __init__(
        self,
        reason: str = (
            "No credential provider is configured. Authenticated exchange "
            "endpoints are unavailable, which is the default."
        ),
    ) -> None:
        self._reason = reason

    @property
    def source(self) -> str:
        return "none"

    async def resolve(
        self, tenant_id: str, account_id: str, exchange: ExchangeId
    ) -> ExchangeCredentials:
        raise CredentialNotFound(self._reason)


#: Matches a long unbroken alphanumeric run — the shape of an API key, a secret,
#: a listen key or a signature. The floor is 32 characters: below that the false
#: positive rate against ordinary identifiers becomes annoying, and above it a
#: 32-character key would slip through. Hyphenated UUIDs do not match, so order
#: ids and incident ids survive scrubbing intact and remain useful in a log.
SECRET_LIKE_PATTERN = re.compile(r"\b[A-Za-z0-9]{32,128}\b")

#: Matches a sensitive value introduced by its own parameter name, which catches
#: the cases the length heuristic cannot: a short secret, a signature split
#: across a query string, a token pasted into a message.
SENSITIVE_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)\b("
    r"api[_-]?secret|api[_-]?key|secret|signature|listen[_-]?key|"
    r"password|passwd|token|authorization|bearer|private[_-]?key"
    r")\b\s*[=:]\s*[\"\']?([^\s\"\'&,}}]+)"
)


def scrub_secret_like(text: str) -> str:
    """Redact anything shaped like an API key, secret, signature or token.

    A last-resort net beneath :func:`redact_secrets`, used wherever the platform
    does not know which specific secret to look for — venue error bodies,
    exception messages, incident details.

    Two passes, because neither alone is sufficient. The assignment pass catches
    ``secret=abc123`` regardless of length; the length pass catches a bare key
    that arrived with no label. Over-redaction is the intended failure mode: a
    redacted identifier costs someone five minutes, a leaked secret costs
    considerably more.
    """
    scrubbed = SENSITIVE_ASSIGNMENT_PATTERN.sub(
        lambda match: f"{match.group(1)}={REDACTED}", text
    )
    return SECRET_LIKE_PATTERN.sub(REDACTED, scrubbed)
