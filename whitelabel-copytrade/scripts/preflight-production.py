#!/usr/bin/env python3
# Extends Python preflight checks for execution-engine and risk-engine
"""Production preflight validator for Python execution-engine and risk-engine services."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

PLACEHOLDERS = {
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


def run_python_preflight(environ: dict[str, str] | None = None) -> dict[str, Any]:
    env = dict(os.environ) if environ is None else dict(environ)
    checks: list[dict[str, Any]] = []

    node_env = env.get("NODE_ENV", "development")

    # 1. Internal service authentication token
    internal_token = env.get("EXECUTION_INTERNAL_TOKEN", "").strip()
    token_ok = (
        len(internal_token) >= 32
        and internal_token.lower() not in PLACEHOLDERS
        and not internal_token.lower().startswith("changeme")
    )
    checks.append(
        {
            "name": "execution_engine.internal_token",
            "passed": token_ok,
            "detail": (
                "EXECUTION_INTERNAL_TOKEN present and >= 32 chars"
                if token_ok
                else "EXECUTION_INTERNAL_TOKEN missing, short (<32), or placeholder"
            ),
        }
    )

    # 2. Credential backend check
    cred_source = env.get("EXECUTION_CREDENTIAL_SOURCE", "none").strip()
    cred_fetcher = env.get("EXECUTION_CREDENTIAL_FETCHER", "none").strip()
    if node_env == "production" and cred_source == "environment":
        cred_ok = False
        cred_detail = "EXECUTION_CREDENTIAL_SOURCE=environment is forbidden in production"
    elif cred_source == "secret-manager" and cred_fetcher == "vault-kv2":
        vault_addr = env.get("EXECUTION_VAULT_ADDR", "").strip()
        cred_ok = vault_addr.startswith("https://")
        cred_detail = (
            f"Vault KV v2 configured ({vault_addr})"
            if cred_ok
            else "EXECUTION_VAULT_ADDR must use https:// when vault-kv2 is selected"
        )
    else:
        cred_ok = cred_source in ("none", "environment", "secret-manager")
        cred_detail = f"Credential source={cred_source} fetcher={cred_fetcher}"

    checks.append(
        {
            "name": "execution_engine.credential_backend",
            "passed": cred_ok,
            "detail": cred_detail,
        }
    )

    # 3. Risk engine kill-switch fail-closed default
    kill_switch_fail_closed = env.get("RISK_FAIL_CLOSED", "true").lower() == "true"
    checks.append(
        {
            "name": "risk_engine.fail_closed_gate",
            "passed": kill_switch_fail_closed,
            "detail": (
                "Risk engine configured fail-closed"
                if kill_switch_fail_closed
                else "RISK_FAIL_CLOSED must remain true"
            ),
        }
    )

    ready = all(c["passed"] for c in checks)
    return {
        "ready": ready,
        "environment": node_env,
        "checks": checks,
    }


if __name__ == "__main__":
    report = run_python_preflight()
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["ready"] else 1)
