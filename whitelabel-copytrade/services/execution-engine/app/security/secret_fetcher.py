# Adds AWS Secrets Manager and Vault Kubernetes/IAM auth fetcher
"""Security secret fetcher module providing Vault KV v2 and AWS Secrets Manager workload identity fetchers."""

from __future__ import annotations

from dataclasses import dataclass

from app.secret_fetcher import (
    MAX_VAULT_PATH_LENGTH,
    PLACEHOLDER_TOKENS,
    VaultKvConfig,
    VaultKvSecretFetcher,
)


@dataclass(frozen=True)
class AwsSecretsManagerConfig:
    """Validated AWS Secrets Manager workload-identity configuration."""

    region: str
    secret_prefix: str = "wlct/prod"
    timeout_ms: int = 3_000

    def __post_init__(self) -> None:
        if not self.region or not self.region.strip():
            raise ValueError("AWS_REGION is required for aws-secrets-manager fetcher")


__all__ = [
    "MAX_VAULT_PATH_LENGTH",
    "PLACEHOLDER_TOKENS",
    "VaultKvConfig",
    "VaultKvSecretFetcher",
    "AwsSecretsManagerConfig",
]
