# Resolves KMS/Vault envelope credentials at runtime without caching plaintext to disk
"""Exchanges credential resolution module re-exporting canonical runtime credential wiring."""

from __future__ import annotations

from dataclasses import dataclass

from app.credentials import (
    CREDENTIAL_ENV_SUFFIXES,
    CredentialWiring,
    SecretFetcher,
    build_credential_provider,
    credential_env_names,
)


@dataclass(frozen=True)
class RuntimeCredentialDescriptor:
    """Non-secret runtime credential descriptor safe for status endpoints and structured logs."""

    source: str
    fetcher_source: str | None
    cache_seconds: int | None
    persists_to_disk: bool = False


__all__ = [
    "CREDENTIAL_ENV_SUFFIXES",
    "CredentialWiring",
    "RuntimeCredentialDescriptor",
    "SecretFetcher",
    "build_credential_provider",
    "credential_env_names",
]
