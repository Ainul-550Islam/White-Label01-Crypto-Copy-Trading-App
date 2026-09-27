#!/usr/bin/env python3
"""Development preflight for live-readiness prerequisites (Part 28).

Quick verification for development environments: build the runtime the way
the service would, grade the eight live prerequisites from the objects that
were actually constructed, and print the answer. SKIPPED counts as success
here - a developer box without a vault, Redis or Postgres is not wrong, it is
just not staging.

What this is NOT:

* It is not the staging rehearsal (that is ``staging_rehearsal.py``, which is
  strict: SKIPPED and UNVERIFIED on required infrastructure block readiness).
* It never submits an order, never enables live execution, and never writes to
  a persistent store. ``EXECUTION_MODE=live`` is refused by the composition
  root before this script could do anything with it.
* It never prints secret material. Everything it renders about credentials is
  the source label the enablement report already publishes for audit.

The grading is not re-implemented here. The script reads the same
``LiveEnablementReport`` the composition root computed from the wiring it
built, so a preflight line and the engine's own refusal sentence can never
disagree about what is missing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

# The script lives in <repo>/scripts/staging; the engine it inspects lives in
# <repo>/services/execution-engine, the library it speaks in
# <repo>/libs/trading-core. Path-resolved rather than installed so the check
# always grades the tree it is sitting in.
REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_ROOT = REPO_ROOT / "services" / "execution-engine"
for _candidate in (str(ENGINE_ROOT), str(REPO_ROOT / "libs" / "trading-core")):
    if _candidate not in sys.path:
        sys.path.insert(0, _candidate)

from wlct_trading.execution.live_enablement import (  # noqa: E402
    LiveEnablementReport,
    LivePrerequisite,
)

__all__ = [
    "PREREQUISITE_ORDER",
    "CREDENTIAL_CONDITIONAL",
    "PrerequisiteStatus",
    "ReadinessResult",
    "classify",
    "run_preflight",
    "load_staging_env",
    "main",
]

#: Report order = declaration order of the enum, so a preflight line and the
#: engine's own refusal sentence always list the same things in the same order.
PREREQUISITE_ORDER: tuple[LivePrerequisite, ...] = (
    LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
    LivePrerequisite.CREDENTIAL_FETCHER_WIRED,
    LivePrerequisite.VENUE_ATTESTOR_WIRED,
    LivePrerequisite.OPERATOR_CONFIRMATION_ACCEPTED,
    LivePrerequisite.DURABLE_STORE_WIRED,
    LivePrerequisite.DISTRIBUTED_LOCKS_WIRED,
    LivePrerequisite.IP_ALLOWLIST_ENFORCED,
    LivePrerequisite.SIGNED_TRANSPORT_WIRED,
)

#: Prerequisites whose absence a development environment tolerates. Their
#: status degrades to SKIPPED when no credential source is configured, and
#: SKIPPED is preflight success - the exact opposite of the rehearsal's rule,
#: and the reason there are two tools instead of one with a flag.
CREDENTIAL_CONDITIONAL: frozenset[LivePrerequisite] = frozenset(
    {
        LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
        LivePrerequisite.CREDENTIAL_FETCHER_WIRED,
        LivePrerequisite.VENUE_ATTESTOR_WIRED,
        LivePrerequisite.OPERATOR_CONFIRMATION_ACCEPTED,
    }
)


class PrerequisiteStatus(str, Enum):
    """The three preflight outcomes, and no fourth.

    PASS - the runtime object proving it was constructed.
    SKIPPED - not configured, which development tolerates.
    FAIL - configured but not wired, or wired but graded missing: the only
    preflight outcome that exits non-zero.
    """

    PASS = "PASS"  # noqa: S105 - a grading label, not a credential
    SKIPPED = "SKIPPED"  # noqa: S105
    FAIL = "FAIL"  # noqa: S105


@dataclass(frozen=True)
class ReadinessResult:
    """One prerequisite's preflight answer, as data."""

    prerequisite: LivePrerequisite
    status: PrerequisiteStatus
    detail: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "prerequisite": self.prerequisite.value,
            "status": self.status.value,
            "detail": self.detail,
        }


def classify(
    prerequisite: LivePrerequisite,
    report: LiveEnablementReport,
) -> PrerequisiteStatus:
    """Grade one prerequisite the preflight way.

    Satisfied is PASS. Anything else is SKIPPED for credential-conditional
    items when no credential source is configured at all, and FAIL for
    everything else - a configured-but-missing credential fetcher is exactly
    the difference this repository has actually been bitten by, so it is
    never smoothed into a skip. The report carries the credential source it
    graded against, so the decision reads the grading's own input rather than
    re-reading the environment.
    """
    if prerequisite in report.satisfied:
        return PrerequisiteStatus.PASS
    if prerequisite in CREDENTIAL_CONDITIONAL and report.credential_source == "none":
        return PrerequisiteStatus.SKIPPED
    return PrerequisiteStatus.FAIL


def run_preflight(report: LiveEnablementReport) -> list[ReadinessResult]:
    """Grade all eight prerequisites, in report order."""
    return [
        ReadinessResult(
            prerequisite=prerequisite,
            status=classify(prerequisite, report),
            detail="graded from runtime objects",
        )
        for prerequisite in PREREQUISITE_ORDER
    ]


def load_staging_env(path: Path) -> int:
    """Load ``name=value`` lines from a staging env file into the environment.

    ``setdefault``, not assignment: an operator who exported a value on the
    command line wins over the file. Returns the number of variables set.
    """
    loaded = 0
    if not path.is_file():
        return loaded
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if not name:
            continue
        if name not in os.environ:
            os.environ[name] = value
            loaded += 1
    return loaded


def _looks_like_production(env: dict[str, str]) -> bool:
    mode = (env.get("NODE_ENV") or "").strip().lower()
    return mode == "production"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Development preflight for the eight live-readiness "
        "prerequisites. Reads only; never submits an order; never enables "
        "live execution."
    )
    parser.add_argument(
        "--staging",
        action="store_true",
        help="load .env.staging from the repository root before building the "
        "runtime (variables already set in the environment win)",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--allow-production",
        action="store_true",
        help="explicit opt-in required to run against NODE_ENV=production",
    )
    args = parser.parse_args(argv)

    if args.staging:
        load_staging_env(REPO_ROOT / ".env.staging")

    if _looks_like_production(os.environ) and not args.allow_production:
        print(
            "refusing to run against NODE_ENV=production without --allow-production",
            file=sys.stderr,
        )
        return 2

    # Imported after sys.path is set up and the staging values are loaded:
    # Settings must be constructed from the environment the operator asked
    # for, not the one the process happened to start with.
    from app.composition import build_runtime  # noqa: E402
    from app.config import Settings  # noqa: E402

    try:
        settings = Settings()
    except Exception as error:
        # The service's own fail-closed settings refusal (missing internal
        # token, bad mode, ...) is an answer, not a crash: render it and
        # exit BLOCKED.
        first = str(error).splitlines()
        detail = first[1].strip() if len(first) > 1 else str(error)
        payload = {
            "mode": None,
            "ready": False,
            "prerequisites": [],
            "error": f"service configuration refused: {detail}",
        }
        if args.json:
            print(json.dumps(payload))
        else:
            print(payload["error"])
        return 2

    try:
        runtime = build_runtime(settings)
    except Exception as error:  # a boot refusal IS the readiness answer
        payload = {
            "mode": settings.EXECUTION_MODE,
            "ready": False,
            "prerequisites": [],
            "error": f"{type(error).__name__}: {error}",
        }
        if args.json:
            print(json.dumps(payload))
        else:
            print(f"runtime construction refused: {payload['error']}")
        return 1

    report = runtime.live_enablement
    if report is None:
        print("runtime built without a live-enablement report", file=sys.stderr)
        return 1

    results = run_preflight(report)
    ready = all(
        result.status in (PrerequisiteStatus.PASS, PrerequisiteStatus.SKIPPED)
        for result in results
    )
    if args.json:
        print(
            json.dumps(
                {
                    "mode": settings.EXECUTION_MODE,
                    "ready": ready,
                    "liveRefused": report.blocks_live,
                    "credentialSource": report.credential_source,
                    "prerequisites": [result.to_dict() for result in results],
                }
            )
        )
    else:
        for result in results:
            print(f"{result.status.value:8} {result.prerequisite.value}")
        print()
        print(f"ready (preflight semantics): {ready}")
        print("live execution remains refused by code regardless of this answer.")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
