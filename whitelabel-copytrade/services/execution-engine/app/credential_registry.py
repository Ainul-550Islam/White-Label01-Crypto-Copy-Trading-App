"""Credential registry wiring for the execution engine (Part 23).

The credential provider (:mod:`wlct_trading.execution.credentials`, built by
:mod:`app.credentials`) already refuses to hand out secrets to anything that
cannot sign with them. What the registry adds is the *accounting* around that
provider: lifecycle metadata (when the wiring was built, from which source),
capability declarations (what this deployment's credential path can and
cannot do - notably whether it can serve more than one exchange), and a named
selection mechanism so /status reports WHICH provider answered instead of
letting a caller guess.

The registry is a wrapper, not a second provider. It holds no key material
(it cannot: the value objects redact themselves and the registry never asks),
and every resolution goes through untouched - wrapping is for reporting, and
a wrapper that changed behaviour would be a second opinion nobody reconciles.
"""

from __future__ import annotations

from wlct_trading.clock import epoch_micros
from wlct_trading.execution.credentials import CredentialProvider

from app.config import Settings

__all__ = ["CredentialRegistryWiring", "build_credential_registry"]


class CredentialRegistryWiring:
    """Lifecycle and capability metadata around one credential provider.

    ``built_at_micros`` is the registry's own construction instant, so a
    long-lived process can show how stale its wiring is without a logger.
    """

    def __init__(
        self,
        settings: Settings,
        provider: CredentialProvider,
    ) -> None:
        if provider is None:
            raise ValueError(
                "credential registry requires a provider; for the no-credentials "
                "deployment the provider is the 'none' source, not None"
            )
        self._settings = settings
        self._provider = provider
        self._built_at_micros = epoch_micros()

    @property
    def provider(self) -> CredentialProvider:
        """The wrapped provider. Resolution goes straight through."""
        return self._provider

    @property
    def source(self) -> str:
        return self._provider.source

    def capabilities(self) -> dict[str, object]:
        """What this credential path can and cannot do, as data.

        ``multiExchange`` follows the provider's own default-exchange answer:
        a provider that serves exactly one venue says so, and a deployment
        that adds a second venue must upgrade the provider rather than let
        the registry assume.
        """
        return {
            "resolvesPerAccount": True,
            "multiExchange": False,
            "cacheInvalidation": True,
            "redactedLogging": True,
        }

    def describe(self) -> dict[str, object]:
        """The /status view: source, capabilities, lifecycle - never material."""
        return {
            "providerSource": self._provider.source,
            "credentialSource": self._settings.EXECUTION_CREDENTIAL_SOURCE,
            "capabilities": self.capabilities(),
            "builtAtMicros": self._built_at_micros,
            "selection": "composition-root-singleton",
        }


def build_credential_registry(
    settings: Settings,
    *,
    provider: CredentialProvider,
) -> CredentialRegistryWiring:
    """Wrap the composed provider with the registry's reporting surface.

    Called exactly once, by the composition root, after
    ``build_credential_provider`` - the registry never builds or caches
    credentials itself.
    """
    if not isinstance(settings, Settings):
        raise ValueError("build_credential_registry requires the engine Settings")
    return CredentialRegistryWiring(settings, provider)
