"""The credential seam (Part 16): where key material comes from, and what this
process is willing to say about it.

Two gaps met here, because they are the same gap. The placement review can
attest anything it likes about symbols and clocks, but every one of its
strongest facts is a signed call, and a signed call needs a key - so "the live
credential provider and the authenticated order-placement review are unfinished"
was one sentence describing one missing wire.

What this module owns is the *selection* and the *contract*, not the secret
material:

* ``none`` (the default) wires a provider that refuses every lookup. That is not
  a stub: a paper process that reaches for a key is a bug, and the fastest way
  to see it is a refusal with a reason attached. ``NullCredentialProvider`` is
  also what makes the placement review's "no evidence" verdict arrive as an
  audit line rather than as a silent pass.
* ``environment`` reads exactly two variables for exactly one (tenant, account)
  pair. The core labels this development-only, and ``app.config`` enforces the
  label at boot - production is refused outright, because an environment cannot
  scope a secret per tenant, is copied into every crash report, and does not
  rotate. That refusal lives in the settings validator and not here so that no
  path which builds a Settings object can skip it; this module's own refusal is
  the narrower one it is the only party to: the named variables exist.
* ``secret-manager`` is the multi-tenant path, and it needs an injected fetcher:
  the platform's key custody lives in the API service's encrypted store, and an
  execution engine that reached into another service's database for secrets
  would be a second, undocumented trust boundary. So the wiring exists, the
  contract is explicit, and boot refuses the combination that has no fetcher -
  which is the honest version of "not wired yet", because it is said in the
  error message rather than discovered in a log at 03:00.

The caching wrapper is unconditional for real sources. A provider that reads an
environment variable costs nothing per call, but the one that reads a secret
manager does, and an order path that hits it per submission turns a venue rate
limit into a vault rate limit - two different outages with one shared symptom.

Nothing here renders a secret. ``describe()`` and every log line are built from
the provider's *label* and the (tenant, account) it serves; the core's
:class:`~wlct_trading.execution.credentials.ExchangeCredentials` already
refuses to survive ``repr``, ``str``, pickling and traceback formatting, and
this module does not reintroduce what that class exists to prevent.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from wlct_trading.enums import ExchangeId
from wlct_trading.execution.credentials import (
    CachingCredentialProvider,
    CredentialProvider,
    EnvironmentCredentialProvider,
    NullCredentialProvider,
    SecretFetcher,
    SecretManagerCredentialProvider,
)

from app.config import Settings
from app.secret_fetcher import VaultKvConfig, VaultKvSecretFetcher

__all__ = [
    "CREDENTIAL_ENV_SUFFIXES",
    "CredentialWiring",
    "SecretFetcher",
    "build_credential_provider",
    "credential_env_names",
]

logger = logging.getLogger(__name__)

#: The two suffixes an ``environment`` source needs, in the order they are
#: reported when one is missing. Kept as a constant because the refusal message
#: and the boot check must agree, and a check that looks for one name while the
#: error names another sends an operator hunting for the wrong variable.
CREDENTIAL_ENV_SUFFIXES: Final[tuple[str, str]] = ("API_KEY", "API_SECRET")

#: Re-exported so a deployment types its fetcher against the contract the
#: provider consumes rather than against a copy that can drift. ``None`` from a
#: fetcher means "this (tenant, account) has no key configured", which the core
#: turns into ``CredentialNotFound``: an absent secret is an answer, not a crash,
#: and the difference is what lets the placement review distinguish "no key" from
#: "vault unreachable" instead of reporting both as one outage.
__all__ = [*__all__, "SecretFetcher"]


def credential_env_names(prefix: str) -> tuple[str, str]:
    """The two variable names an ``environment`` source will read.

    Mirrors :class:`~wlct_trading.execution.credentials
    .EnvironmentCredentialProvider` exactly - upper-cased, no trailing
    separator, ``_<SUFFIX>`` appended - because this function exists to check
    the variables BEFORE the provider resolves them. A name that differs from
    the provider's own is worse than no check at all: boot would pass on a
    variable nobody reads, and the first order would fail on the one nobody
    set. The parity is pinned by a test that reads the provider's refusal
    message, so the day the core changes its spelling this file is told.
    """
    # No rstrip, no lower-casing of the caller's underscores: whatever the
    # provider would compute is what this returns, double underscores included.
    # A prefix that produces an ugly name is refused at boot (see app.config),
    # which is the right place to be helpful - this function's only job is to
    # agree with the code that will actually read the variables.
    cleaned = prefix.strip().upper() or "BINANCE"
    key_suffix, secret_suffix = CREDENTIAL_ENV_SUFFIXES
    return (f"{cleaned}_{key_suffix}", f"{cleaned}_{secret_suffix}")


@dataclass(frozen=True, slots=True)
class CredentialWiring:
    """A provider plus everything this service may say about it.

    The provider is the collaborator; the rest is the description. They are
    returned together because a runtime that can hand ``/status`` a provider but
    not say where its keys came from has published a wiring it cannot
    diagnose - and because a caller must not be able to describe one provider
    while using another.
    """

    provider: CredentialProvider
    source: str
    cache_seconds: int | None
    tenant_id: str | None = None
    account_id: str | None = None
    note: str = ""
    #: Which secret reader the ``secret-manager`` source was given, or None when the
    #: source reads no external store. Named as a field rather than inferred from
    #: ``providerSource``, because a cached wrapper reports the wrapper's own label and
    #: the reader beneath it is the thing an operator needs to see to know whether this
    #: deployment can resolve a second tenant at all.
    fetcher_source: str | None = None

    def describe(self) -> dict[str, object]:
        """The non-secret view. Safe for ``/status``, logs and the console.

        ``providerSource`` is read back off the provider rather than echoed from
        the setting: if a future wiring wraps, caches or replaces the provider,
        the description has to follow what is actually installed, or the status
        endpoint becomes the most misleading documentation in the build.
        """
        return {
            "source": self.source,
            "providerSource": self.provider.source,
            "cacheSeconds": self.cache_seconds,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "note": self.note,
            "fetcherSource": self.fetcher_source,
        }


def build_credential_provider(
    settings: Settings,
    *,
    environ: Mapping[str, str] | None = None,
    secret_fetcher: SecretFetcher | None = None,
    exchange: ExchangeId = ExchangeId.BINANCE,
) -> CredentialWiring:
    """Construct the provider the deployment asked for, or refuse at boot.

    Every refusal here is a boot failure rather than a first-order failure on
    purpose: a deployment that starts and then cannot trade looks like a venue
    incident, while a deployment that refuses to start says "check your
    configuration" in the one place an operator is guaranteed to read it.
    """
    # ``environ`` is injectable so a test can prove the boot check without
    # mutating the process environment (which would leak into every later test).
    environment = dict(os.environ) if environ is None else dict(environ)
    source = settings.EXECUTION_CREDENTIAL_SOURCE
    cache_seconds = settings.EXECUTION_CREDENTIAL_CACHE_SECONDS

    if source == "none":
        # The default, and the correct one for every runtime this build ships.
        # The reason string is what the placement review's audit line carries, so
        # it is written for the person reading the refusal hours later.
        provider: CredentialProvider = NullCredentialProvider(
            "EXECUTION_CREDENTIAL_SOURCE=none: this runtime holds no key and "
            "will not acquire one at run time."
        )
        return CredentialWiring(
            provider=provider,
            source="none",
            cache_seconds=None,
            note="no credential source configured; every authenticated call refuses",
        )

    if source == "environment":
        key_name, secret_name = credential_env_names(settings.EXECUTION_CREDENTIAL_ENV_PREFIX)
        missing = [
            name
            for name in (key_name, secret_name)
            if not environment.get(name, "").strip()
        ]
        if missing:
            raise ValueError(
                f"EXECUTION_CREDENTIAL_SOURCE=environment needs "
                f"{' and '.join(missing)} to be set and non-empty. A named "
                "variable that is absent is not 'no key yet': the provider would "
                "resolve it per order and report a credential failure, which is a "
                "slower and vaguer way of saying what this message says at boot."
            )
        provider = EnvironmentCredentialProvider(
            environment,
            exchange=exchange,
            tenant_id=settings.EXECUTION_CREDENTIAL_TENANT_ID,
            account_id=settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
            prefix=settings.EXECUTION_CREDENTIAL_ENV_PREFIX,
        )
        provider = CachingCredentialProvider(provider, ttl_seconds=cache_seconds)
        logger.info(
            "execution_engine.credentials_selected",
            extra={
                "event": "execution_engine.credentials_selected",
                # ``provider*`` and not ``credential*`` on purpose: the platform's log
                # redactor scrubs any record key whose NAME is credential-shaped, so a
                # field called ``credentialSource`` would print [REDACTED] and the boot
                # line would say nothing. The values published on /status keep their
                # names (they are API vocabulary, and the redactor never sees them);
                # only the log spelling had to move out of the scrubber's way.
                "providerSource": "environment",
                "providerVariableNames": [key_name, secret_name],
                # The NAMES only. Printing a value - masked or not - is how
                # secrets end up in log aggregators, and a masked suffix is
                # still a fingerprint an attacker can brute-force.
                "cacheSeconds": cache_seconds,
            },
        )
        return CredentialWiring(
            provider=provider,
            source="environment",
            cache_seconds=cache_seconds,
            tenant_id=settings.EXECUTION_CREDENTIAL_TENANT_ID,
            account_id=settings.EXECUTION_CREDENTIAL_ACCOUNT_ID,
            note=f"single-tenant provider reading {key_name}",
        )

    # ``secret-manager``: the multi-tenant path. The core's provider is complete
    # and tested; what a deployment must supply is the fetcher, because the
    # choice of backend (Vault, cloud SM, the API service's own encrypted store)
    # is an infrastructure decision, and an execution engine that hard-codes one
    # has silently decided which customers may trade.
    fetcher_source: str | None = None
    if secret_fetcher is None:
        # Part 19 added the one concrete reader this service is willing to build by
        # itself, selected by name. The selector default is "none", so this branch is
        # the SAME refusal Part 16 shipped for every deployment that did not opt in -
        # only now it says which opt-in exists, which is the difference between a
        # message an operator can act on and a message that quotes the design doc.
        if settings.EXECUTION_CREDENTIAL_FETCHER == "vault-kv2":
            secret_fetcher = VaultKvSecretFetcher(
                # Constructed through Settings so the boot validator and the runtime
                # read the same values: a second mapping here would be a second
                # opinion about which variable means what, and Part 16's env-prefix
                # check is the last time this repository wanted that.
                VaultKvConfig(
                    addr=settings.EXECUTION_VAULT_ADDR or "",
                    mount=settings.EXECUTION_VAULT_MOUNT,
                    path_template=settings.EXECUTION_VAULT_PATH_TEMPLATE,
                    token_env=settings.EXECUTION_VAULT_TOKEN_ENV,
                    namespace=settings.EXECUTION_VAULT_NAMESPACE,
                    timeout_ms=settings.EXECUTION_VAULT_TIMEOUT_MS,
                    verify_tls=settings.EXECUTION_VAULT_TLS_VERIFY,
                    max_response_bytes=settings.EXECUTION_VAULT_MAX_RESPONSE_BYTES,
                ),
                environ=environment,
            )
            fetcher_source = secret_fetcher.source
        else:
            raise ValueError(
                "EXECUTION_CREDENTIAL_SOURCE=secret-manager needs a secret fetcher. "
                "Two ways to give this process one: set "
                "EXECUTION_CREDENTIAL_FETCHER=vault-kv2 (this service's own reader for "
                "HashiCorp Vault KV v2, which then needs EXECUTION_VAULT_ADDR and the "
                "token variable), or inject one at composition "
                "(build_credential_provider(secret_fetcher=...)) for any other store. "
                "Neither is optional, and no fallback exists on purpose: key custody "
                "for this platform lives with whoever owns the encrypted store, and a "
                "runtime that went looking for a signing key in a place it had not been "
                "told to trust would be trading on someone else's credential. Until a "
                "fetcher is wired, run simulated."
            )
    else:
        fetcher_source = "injected"
    provider = CachingCredentialProvider(
        SecretManagerCredentialProvider(secret_fetcher, exchange=exchange),
        ttl_seconds=cache_seconds,
    )
    logger.info(
        "execution_engine.credentials_selected",
        extra={
            "event": "execution_engine.credentials_selected",
            "providerSource": "secret-manager",
            "providerFetcher": fetcher_source,
            # No path, no tenant identifiers, and nothing from any response: the
            # selection event is a boot line, and boot lines are the most reliably
            # collected lines there are.
            "cacheSeconds": cache_seconds,
        },
    )
    return CredentialWiring(
        provider=provider,
        source="secret-manager",
        cache_seconds=cache_seconds,
        fetcher_source=fetcher_source,
        # tenant_id / account_id stay unset here on purpose, unlike the
        # ``environment`` branch: a secret-manager fetcher is keyed per
        # (tenant, account) at lookup time, so naming the configured pair would
        # publish "this process serves exactly one tenant" - a claim that is true
        # of the environment provider and false of everything the fetcher can do.
        note=(
            f"{fetcher_source} fetcher; per-tenant scoped by (tenant, account)"
            if fetcher_source == "vault-kv2"
            else "deployment-provided fetcher; per-tenant scoped by (tenant, account)"
        ),
    )
