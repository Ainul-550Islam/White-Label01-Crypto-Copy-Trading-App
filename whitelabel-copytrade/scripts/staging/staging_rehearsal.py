#!/usr/bin/env python3
"""Staging rehearsal for live-readiness (Part 29).

The **strict** counterpart to ``live_readiness.py``. Where the preflight
tolerates a developer box (SKIPPED counts as success), staging verifies all
eight prerequisites from actual runtime objects, plus the infrastructure they
sit on: PostgreSQL persistence (write, re-open, read back) and Redis locks
(acquire, reject a second owner, advance a fencing token).

Semantics, stated once because the whole tool is this table:

* PASS   - verified from a runtime object or a real round-trip.
* FAIL   - configured and reachable, but the check failed.
* BLOCKED- infrastructure the check needs is configured but unreachable.
* UNVERIFIED - configured, but this tool cannot verify it (credentials).
* SKIPPED- not configured at all.

Readiness is strict: the four required prerequisites
(DURABLE_STORE_WIRED, DISTRIBUTED_LOCKS_WIRED, SIGNED_TRANSPORT_WIRED,
IP_ALLOWLIST_ENFORCED) must be PASS, and a SKIPPED or UNVERIFIED on required
infrastructure blocks staging readiness exactly as a FAIL would. The four
credential-conditional prerequisites may be SKIPPED when no credential source
is configured.

Safety guarantees (the same seven the staging README lists):

1. Never submits an order - the rehearsal reads and probes its own rows only.
2. Never enables live execution - ``EXECUTION_MODE=live`` is refused by the
   composition root before this script runs any check, and the gate check
   asserts the refusal report says so.
3. Never changes production configuration - the only writes are a clearly
   named probe row (deleted in a ``finally``) and Redis keys under a
   rehearsal-only prefix (deleted the same way).
4. Never prints secrets - DSNs and Redis URLs are rendered as "configured",
   never verbatim.
5. Uses runtime evidence - configuration flags alone cannot produce a PASS;
   the runtime grades come from the objects ``build_runtime`` built.
6. Production guard - refuses to run against ``NODE_ENV=production`` without
   an explicit ``--allow-production``.
7. Strict semantics - SKIPPED is not PASS.

Exit codes: 0 ready, 1 a check FAILed (or a required SKIPPED/UNVERIFIED),
2 infrastructure BLOCKED (or the production guard fired).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import ssl
import sys
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from urllib.parse import urlsplit

# Same layout assumption as the preflight: this script sits in
# <repo>/scripts/staging and inspects the tree it ships in.
REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_ROOT = REPO_ROOT / "services" / "execution-engine"
for _candidate in (str(ENGINE_ROOT), str(REPO_ROOT / "libs" / "trading-core")):
    if _candidate not in sys.path:
        sys.path.insert(0, _candidate)

from wlct_trading.clock import epoch_micros  # noqa: E402
from wlct_trading.execution.live_enablement import (  # noqa: E402
    LiveEnablementReport,
    LivePrerequisite,
)
from wlct_trading.execution.locks import (  # noqa: E402
    FencedLockManager,
    LockNotAcquired,
    RedisLockManager,
)

__all__ = [
    "REQUIRED_PREREQUISITES",
    "CREDENTIAL_CONDITIONAL_PREREQUISITES",
    "CheckStatus",
    "CheckResult",
    "strict_ready",
    "exit_code_for",
    "main",
]

#: Prerequisites staging cannot open the doors without, verbatim from the
#: README's table. Everything else on the enum is credential-conditional.
REQUIRED_PREREQUISITES: frozenset[LivePrerequisite] = frozenset(
    {
        LivePrerequisite.DURABLE_STORE_WIRED,
        LivePrerequisite.DISTRIBUTED_LOCKS_WIRED,
        LivePrerequisite.SIGNED_TRANSPORT_WIRED,
        LivePrerequisite.IP_ALLOWLIST_ENFORCED,
    }
)

#: May be SKIPPED when the deployment named no credential source.
CREDENTIAL_CONDITIONAL_PREREQUISITES: frozenset[LivePrerequisite] = frozenset(
    {
        LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
        LivePrerequisite.CREDENTIAL_FETCHER_WIRED,
        LivePrerequisite.VENUE_ATTESTOR_WIRED,
        LivePrerequisite.OPERATOR_CONFIRMATION_ACCEPTED,
    }
)

#: The Postgres tables Part 13 promised. The rehearsal checks existence
#: before it writes its probe row, so a missing migrations run is a BLOCKED
#: with a name in it rather than a syntax error from an INSERT.
_ENGINE_TABLES: tuple[str, ...] = (
    "engine_orders",
    "engine_order_events",
    "engine_order_fills",
)

_PROBE_TENANT_ID = "00000000-0000-4000-8000-00000000beef"
#: Every Redis key the rehearsal touches lives under this prefix, so a
#: crashed run leaves at most a few expiring keys and never touches a
#: production lock.
_PROBE_LOCK_PREFIX = "staging-rehearsal:"

#: Dependency connections get this long to prove themselves. A staging
#: Postgres that takes half a minute to refuse a connection is down, not slow.
_CONNECT_TIMEOUT_SECONDS = 10.0


class CheckStatus(str, Enum):
    """The five rehearsal outcomes - the README's table, as an enum."""

    PASS = "PASS"  # noqa: S105 - a grading label, not a credential
    FAIL = "FAIL"  # noqa: S105
    BLOCKED = "BLOCKED"  # noqa: S105
    UNVERIFIED = "UNVERIFIED"  # noqa: S105
    SKIPPED = "SKIPPED"  # noqa: S105


@dataclass(frozen=True)
class CheckResult:
    """One check's answer, as data: group, name, status, and why."""

    group: str
    name: str
    status: CheckStatus
    detail: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "group": self.group,
            "name": self.name,
            "status": self.status.value,
            "detail": self.detail,
        }


def strict_ready(checks: list[CheckResult]) -> bool:
    """Whether staging may open the doors, under strict semantics.

    Every check must be PASS, except credential-conditional prerequisites,
    which may be SKIPPED when the deployment named no credential source. A
    SKIPPED or UNVERIFIED anywhere on required infrastructure blocks, which
    is the difference between this tool and the preflight.
    """
    for check in checks:
        if check.status is CheckStatus.PASS:
            continue
        if check.status is CheckStatus.SKIPPED and check.group == "runtime":
            name = check.name.removeprefix("runtime.")
            try:
                prerequisite = LivePrerequisite(name)
            except ValueError:
                return False
            if (
                prerequisite in CREDENTIAL_CONDITIONAL_PREREQUISITES
                and check.detail.startswith("no credential source")
            ):
                continue
        return False
    return True


def exit_code_for(checks: list[CheckResult]) -> int:
    """0 ready, 2 any BLOCKED, 1 everything else that is not ready.

    BLOCKED outranks FAIL on the exit code because the remedy is different:
    a FAIL means fix the wiring, a BLOCKED means fix the infrastructure the
    wiring points at. CI wiring both to "not ready" loses that distinction.
    """
    if strict_ready(checks):
        return 0
    if any(check.status is CheckStatus.BLOCKED for check in checks):
        return 2
    return 1


# ---------------------------------------------------------------------------
# Minimal Redis client (RESP-2 over asyncio streams)
# ---------------------------------------------------------------------------
# The engine's RedisLockManager speaks a three-method protocol (set/get/eval)
# and the service deliberately carries no redis package. Rather than add a
# dependency for one rehearsal, this client speaks just enough RESP to satisfy
# that protocol: AUTH/SELECT on connect, PING, SET-with-NX/PX, GET, EVAL.
# Commands are one-in-flight; a rehearsal does not need pipelining.


class StagingRedisClient:
    """Just enough RESP for the lock checks, and honest about it."""

    __slots__ = ("_reader", "_writer", "host", "port", "password", "db", "use_tls")

    def __init__(self, url: str) -> None:
        parsed = urlsplit(url)
        if parsed.scheme not in ("redis", "rediss"):
            raise ValueError("EXECUTION_REDIS_URL must be redis:// or rediss://")
        if not parsed.hostname:
            raise ValueError("EXECUTION_REDIS_URL names no host")
        self.host = parsed.hostname
        self.port = parsed.port or 6379
        # redis://:password@host puts the password in the password field;
        # redis://user:pass@host puts it in the password too for this scheme.
        self.password = parsed.password or ""
        path = (parsed.path or "").strip("/")
        self.db = int(path) if path.isdigit() else 0
        self.use_tls = parsed.scheme == "rediss"
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None

    async def connect(self) -> None:
        tls = ssl.create_default_context() if self.use_tls else None
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port, ssl=tls),
            timeout=_CONNECT_TIMEOUT_SECONDS,
        )
        if self.password:
            await self.command("AUTH", self.password)
        if self.db:
            await self.command("SELECT", str(self.db))

    async def close(self) -> None:
        if self._writer is not None:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except (ConnectionError, OSError):
                pass
            self._reader = None
            self._writer = None

    async def command(self, *parts: str | bytes) -> object:
        if self._reader is None or self._writer is None:
            raise RuntimeError("not connected")
        payload = b"".join(
            b"$"
            + str(len(part)).encode()
            + b"\r\n"
            + (part if isinstance(part, bytes) else part.encode())
            + b"\r\n"
            for part in parts
        )
        request = b"*" + str(len(parts)).encode() + b"\r\n" + payload
        self._writer.write(request)
        await self._writer.drain()
        return await self._read_reply()

    async def _read_reply(self) -> object:
        assert self._reader is not None
        line = await asyncio.wait_for(self._reader.readline(), timeout=_CONNECT_TIMEOUT_SECONDS)
        if not line:
            raise RuntimeError("Redis closed the connection")
        marker, body = line[:1], line[1:-2]
        if marker == b"+":
            return body.decode()
        if marker == b"-":
            raise RuntimeError(f"Redis error: {body.decode()}")
        if marker == b":":
            return int(body)
        if marker == b"$":
            length = int(body)
            if length == -1:
                return None
            data = await asyncio.wait_for(
                self._reader.readexactly(length + 2), timeout=_CONNECT_TIMEOUT_SECONDS
            )
            return data[:-2]
        if marker == b"*":
            count = int(body)
            if count == -1:
                return None
            return [await self._read_reply() for _ in range(count)]
        raise RuntimeError(f"unknown Redis reply marker {marker!r}")

    # -- the RedisLockClient protocol ------------------------------------

    async def set(
        self, name: str, value: str, *, nx: bool = False, px: int | None = None
    ) -> object:
        parts: list[str | bytes] = ["SET", name, value]
        if nx:
            parts.append("NX")
        if px is not None:
            parts.extend(("PX", str(px)))
        return await self.command(*parts)

    async def get(self, name: str) -> bytes | str | None:
        return await self.command("GET", name)

    async def eval(self, script: str, numkeys: int, *args: str) -> object:
        return await self.command("EVAL", script, str(numkeys), *args)

    async def ping(self) -> object:
        return await self.command("PING")

    async def delete(self, *names: str) -> object:
        return await self.command("DEL", *names)


# ---------------------------------------------------------------------------
# Dependency checks: PostgreSQL
# ---------------------------------------------------------------------------


async def check_postgres(settings: object) -> list[CheckResult]:
    """PostgreSQL connectivity, schema, and persistence recovery.

    The persistence check is the rehearsal's heart: write a probe row through
    one pool, read it back through a *second, separately opened* pool, delete
    it. A store that only works inside one connection was Part 13's whole
    reason to exist, so the check re-opens rather than re-uses.
    """
    results: list[CheckResult] = []
    dsn = getattr(settings, "EXECUTION_POSTGRES_DSN", None)
    backend = getattr(settings, "EXECUTION_STORE_BACKEND", "memory")

    if not dsn or backend != "postgres":
        detail = (
            f"EXECUTION_STORE_BACKEND={backend!r}"
            + ("" if dsn else " and EXECUTION_POSTGRES_DSN is unset")
            + "; staging sets both in .env.staging"
        )
        results.append(
            CheckResult(
                "dependency-postgresql", "postgres.connectivity", CheckStatus.SKIPPED, detail
            )
        )
        results.append(
            CheckResult("dependency-postgresql", "postgres.schema", CheckStatus.SKIPPED, detail)
        )
        results.append(
            CheckResult(
                "dependency-postgresql",
                "postgres.persistence_recovery",
                CheckStatus.SKIPPED,
                detail,
            )
        )
        return results

    # The DSN is never rendered - "configured" is the most a log line needs.
    configured = "configured (DSN not rendered)"

    import asyncpg

    conn = None
    try:
        conn = await asyncio.wait_for(asyncpg.connect(dsn), timeout=_CONNECT_TIMEOUT_SECONDS)
    except Exception as error:
        blocked = CheckResult(
            "dependency-postgresql",
            "postgres.connectivity",
            CheckStatus.BLOCKED,
            f"Postgres unreachable: {type(error).__name__}",
        )
        results.append(blocked)
        results.append(
            CheckResult(
                "dependency-postgresql", "postgres.schema", CheckStatus.SKIPPED, "no connection"
            )
        )
        results.append(
            CheckResult(
                "dependency-postgresql",
                "postgres.persistence_recovery",
                CheckStatus.SKIPPED,
                "no connection",
            )
        )
        return results

    results.append(
        CheckResult(
            "dependency-postgresql", "postgres.connectivity", CheckStatus.PASS, configured
        )
    )

    # -- schema ------------------------------------------------------------
    missing: list[str] = []
    for table in _ENGINE_TABLES:
        row = await conn.fetchval("SELECT to_regclass($1::text)", f"public.{table}")
        if row is None:
            missing.append(table)
    if missing:
        results.append(
            CheckResult(
                "dependency-postgresql",
                "postgres.schema",
                CheckStatus.FAIL,
                f"missing tables (run migrations): {', '.join(missing)}",
            )
        )
        results.append(
            CheckResult(
                "dependency-postgresql",
                "postgres.persistence_recovery",
                CheckStatus.SKIPPED,
                "schema incomplete",
            )
        )
        await conn.close()
        return results
    results.append(
        CheckResult(
            "dependency-postgresql",
            "postgres.schema",
            CheckStatus.PASS,
            f"all {len(_ENGINE_TABLES)} engine tables present",
        )
    )

    # -- persistence recovery ------------------------------------------------
    probe_order_id = "staging-rehearsal-" + secrets.token_hex(8)
    probe_client_order_id = "staging-rehearsal-" + uuid.uuid4().hex
    # Same clock the engine's own rows use.
    now_micros = epoch_micros()
    insert_sql = """
        INSERT INTO engine_orders
            (tenant_id, order_id, client_order_id, account_id, exchange, symbol,
             side, order_type, time_in_force, is_simulated, status, quantity,
             filled_quantity, cumulative_fee, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    """
    probe_values = (
        uuid.UUID(_PROBE_TENANT_ID),
        probe_order_id,
        probe_client_order_id,
        "staging-rehearsal",
        "BINANCE",
        "BTCUSDT",
        "BUY",
        "LIMIT",
        "GTC",
        True,
        "REJECTED",
        "1",
        "0",
        "0",
        now_micros,
        now_micros,
    )
    pool_two = None
    try:
        await conn.execute(insert_sql, *probe_values)
        # A NEW pool is the point: "the process restarted and opened the
        # store again" is the failure mode durability exists for.
        pool_two = await asyncio.wait_for(
            asyncpg.create_pool(dsn, min_size=1, max_size=1),
            timeout=_CONNECT_TIMEOUT_SECONDS,
        )
        async with pool_two.acquire() as second:
            read_back = await second.fetchval(
                "SELECT count(*) FROM engine_orders WHERE tenant_id = $1 AND client_order_id = $2",
                uuid.UUID(_PROBE_TENANT_ID),
                probe_client_order_id,
            )
        if int(read_back) == 1:
            results.append(
                CheckResult(
                    "dependency-postgresql",
                    "postgres.persistence_recovery",
                    CheckStatus.PASS,
                    "probe row written through one pool, read through a second",
                )
            )
        else:
            results.append(
                CheckResult(
                    "dependency-postgresql",
                    "postgres.persistence_recovery",
                    CheckStatus.FAIL,
                    f"second pool read back {int(read_back)} rows, expected 1",
                )
            )
    except Exception as error:
        results.append(
            CheckResult(
                "dependency-postgresql",
                "postgres.persistence_recovery",
                CheckStatus.FAIL,
                f"probe round-trip failed: {type(error).__name__}: {error}",
            )
        )
    finally:
        try:
            await conn.execute(
                "DELETE FROM engine_orders WHERE tenant_id = $1 AND order_id = $2",
                uuid.UUID(_PROBE_TENANT_ID),
                probe_order_id,
            )
        except Exception:  # noqa: S110 - probe cleanup is best-effort
            pass
        if pool_two is not None:
            await pool_two.close()
        await conn.close()
    return results


# ---------------------------------------------------------------------------
# Dependency checks: Redis (connectivity, lock round-trip, fencing)
# ---------------------------------------------------------------------------


async def check_redis(settings: object) -> list[CheckResult]:
    """Redis connectivity plus a real lock round-trip with fencing.

    Three facts in one probe: a lock can be acquired, a second owner is
    rejected while it is held (stale-ownership rejection at the source), and
    fencing tokens advance monotonically across acquisitions with the stale
    handle refused. All keys live under the rehearsal prefix and are deleted
    on the way out.
    """
    results: list[CheckResult] = []
    redis_url = getattr(settings, "EXECUTION_REDIS_URL", None)
    locks_enabled = getattr(settings, "EXECUTION_DISTRIBUTED_LOCKS", False)

    if not locks_enabled or not redis_url:
        detail = (
            "EXECUTION_DISTRIBUTED_LOCKS is false"
            + ("" if redis_url else " and EXECUTION_REDIS_URL is unset")
            + "; staging sets both in .env.staging"
        )
        results.append(
            CheckResult("dependency-redis", "redis.connectivity", CheckStatus.SKIPPED, detail)
        )
        results.append(
            CheckResult("dependency-redis", "redis.lock_roundtrip", CheckStatus.SKIPPED, detail)
        )
        return results

    client = StagingRedisClient(redis_url)
    try:
        await client.connect()
    except Exception as error:
        detail = f"Redis unreachable: {type(error).__name__}"
        results.append(
            CheckResult("dependency-redis", "redis.connectivity", CheckStatus.BLOCKED, detail)
        )
        results.append(
            CheckResult(
                "dependency-redis", "redis.lock_roundtrip", CheckStatus.SKIPPED, "no connection"
            )
        )
        return results

    pong = await client.ping()
    if pong != "PONG":
        await client.close()
        results.append(
            CheckResult(
                "dependency-redis",
                "redis.connectivity",
                CheckStatus.FAIL,
                f"PING answered {pong!r}, expected PONG",
            )
        )
        results.append(
            CheckResult(
                "dependency-redis", "redis.lock_roundtrip", CheckStatus.SKIPPED, "PING failed"
            )
        )
        return results
    results.append(
        CheckResult(
            "dependency-redis", "redis.connectivity", CheckStatus.PASS, "PING answered PONG"
        )
    )

    manager = RedisLockManager(client)
    fenced = FencedLockManager(manager, fencing_client=client)
    lock_key = _PROBE_LOCK_PREFIX + "lock-roundtrip:" + secrets.token_hex(4)
    fencing_key = lock_key + ":fencing"
    try:
        handle = await manager.acquire(lock_key, ttl_millis=10_000)
        # Stale ownership rejection: a second acquire while held, with no
        # wait budget, must be refused rather than silently shared.
        rejected = False
        try:
            await manager.acquire(lock_key, ttl_millis=10_000, wait_millis=0)
        except LockNotAcquired:
            rejected = True
        await manager.release(handle)
        if not rejected:
            results.append(
                CheckResult(
                    "dependency-redis",
                    "redis.lock_roundtrip",
                    CheckStatus.FAIL,
                    "second acquire while held succeeded; the lock is not exclusive",
                )
            )
            return results
        # Fencing advancement: two sequential acquisitions under the fenced
        # wrapper must mint strictly increasing tokens (the counter is never
        # reset), and the first handle must be refused as stale once the
        # second exists.
        first = await fenced.acquire(lock_key, ttl_millis=10_000)
        await fenced.release(first)
        second = await fenced.acquire(lock_key, ttl_millis=10_000)
        stale_refused = False
        try:
            await fenced.validate_fencing(first)
        except Exception:
            stale_refused = True
        await fenced.release(second)
        if second.fencing_token <= first.fencing_token:
            results.append(
                CheckResult(
                    "dependency-redis",
                    "redis.lock_roundtrip",
                    CheckStatus.FAIL,
                    f"fencing token did not advance "
                    f"({first.fencing_token} -> {second.fencing_token})",
                )
            )
        elif not stale_refused:
            results.append(
                CheckResult(
                    "dependency-redis",
                    "redis.lock_roundtrip",
                    CheckStatus.FAIL,
                    "a stale fencing token validated; fencing is decorative",
                )
            )
        else:
            results.append(
                CheckResult(
                    "dependency-redis",
                    "redis.lock_roundtrip",
                    CheckStatus.PASS,
                    f"acquire, second-owner rejection, and fencing advance "
                    f"({first.fencing_token} -> {second.fencing_token}) all verified",
                )
            )
    except Exception as error:
        results.append(
            CheckResult(
                "dependency-redis",
                "redis.lock_roundtrip",
                CheckStatus.FAIL,
                f"lock round-trip failed: {type(error).__name__}: {error}",
            )
        )
    finally:
        try:
            await client.delete(lock_key, fencing_key)
        except Exception:  # noqa: S110 - probe-key cleanup is best-effort
            pass
        await client.close()
    return results


# ---------------------------------------------------------------------------
# Runtime checks: the eight prerequisites, graded strictly
# ---------------------------------------------------------------------------


def grade_runtime_prerequisites(
    report: LiveEnablementReport,
) -> list[CheckResult]:
    """Turn the enablement report into strict rehearsal statuses.

    PASS from the report's satisfied set. A required prerequisite that is
    missing is FAIL - staging has no tolerated absence. A credential-
    conditional one is SKIPPED when no source is configured and UNVERIFIED
    when a source is named but the runtime could not prove it (no fetcher, no
    attestor), which blocks exactly like a FAIL.
    """
    results: list[CheckResult] = []
    for prerequisite in (
        LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
        LivePrerequisite.CREDENTIAL_FETCHER_WIRED,
        LivePrerequisite.VENUE_ATTESTOR_WIRED,
        LivePrerequisite.OPERATOR_CONFIRMATION_ACCEPTED,
        LivePrerequisite.DURABLE_STORE_WIRED,
        LivePrerequisite.DISTRIBUTED_LOCKS_WIRED,
        LivePrerequisite.IP_ALLOWLIST_ENFORCED,
        LivePrerequisite.SIGNED_TRANSPORT_WIRED,
    ):
        name = f"runtime.{prerequisite.value}"
        if prerequisite in report.satisfied:
            results.append(
                CheckResult("runtime", name, CheckStatus.PASS, "graded from runtime objects")
            )
            continue
        if prerequisite in CREDENTIAL_CONDITIONAL_PREREQUISITES:
            if report.credential_source == "none":
                results.append(
                    CheckResult(
                        "runtime",
                        name,
                        CheckStatus.SKIPPED,
                        "no credential source configured (acceptable for credentials only)",
                    )
                )
            else:
                results.append(
                    CheckResult(
                        "runtime",
                        name,
                        CheckStatus.UNVERIFIED,
                        f"credential source {report.credential_source!r} is configured but "
                        "the runtime could not verify this prerequisite",
                    )
                )
            continue
        results.append(
            CheckResult(
                "runtime",
                name,
                CheckStatus.FAIL,
                "required prerequisite missing from the runtime grading",
            )
        )
    return results


def check_live_mode_gate(report: LiveEnablementReport) -> CheckResult:
    """The gate must refuse. A readiness tool that could green-light live
    mode would be the one file in the repository that must never exist."""
    if report.blocks_live:
        return CheckResult(
            "runtime",
            "runtime.LIVE_MODE_GATE",
            CheckStatus.PASS,
            "live enablement report blocks live execution",
        )
    return CheckResult(
        "runtime",
        "runtime.LIVE_MODE_GATE",
        CheckStatus.FAIL,
        "live enablement report does not block live execution; staging must not run",
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _looks_like_production(env: dict[str, str]) -> bool:
    mode = (env.get("NODE_ENV") or "").strip().lower()
    return mode == "production"


def _load_env_file(path: Path) -> int:
    """Load ``name=value`` lines; environment variables already set win."""
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


async def _run_checks(args: argparse.Namespace) -> list[CheckResult]:
    from app.config import Settings

    try:
        settings = Settings()
    except Exception as error:
        # The service's own fail-closed settings refusal, rendered as the
        # BLOCKED answer it is rather than a traceback.
        first = str(error).splitlines()
        detail = first[1].strip() if len(first) > 1 else str(error)
        return [
            CheckResult(
                "runtime",
                "runtime.bootstrap",
                CheckStatus.BLOCKED,
                f"service configuration refused: {detail}",
            )
        ]

    checks: list[CheckResult] = []

    if not args.check_runtime:
        checks.extend(await check_postgres(settings))
        checks.extend(await check_redis(settings))

    if not args.check_dependencies:
        from app.composition import build_runtime

        try:
            runtime = build_runtime(settings)
        except Exception as error:
            # A boot refusal is an answer: live mode, or wiring that cannot
            # stand up. Render the refusal as the FAIL it is.
            checks.append(
                CheckResult(
                    "runtime",
                    "runtime.bootstrap",
                    CheckStatus.FAIL,
                    f"runtime construction refused: {type(error).__name__}: {error}",
                )
            )
            return checks
        report = runtime.live_enablement
        if report is None:
            checks.append(
                CheckResult(
                    "runtime",
                    "runtime.bootstrap",
                    CheckStatus.FAIL,
                    "runtime built without a live-enablement report",
                )
            )
            return checks
        checks.append(
            CheckResult(
                "runtime", "runtime.bootstrap", CheckStatus.PASS, "build_runtime succeeded"
            )
        )
        checks.extend(grade_runtime_prerequisites(report))
        checks.append(check_live_mode_gate(report))

    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Strict staging rehearsal for the live-readiness "
        "prerequisites. Reads the runtime, probes its own rows/keys only, "
        "never submits an order, never enables live execution."
    )
    parser.add_argument(
        "--staging",
        action="store_true",
        help="load .env.staging from the repository root first (already-set "
        "environment variables win)",
    )
    parser.add_argument(
        "--check-dependencies",
        action="store_true",
        help="verify PostgreSQL and Redis only",
    )
    parser.add_argument(
        "--check-runtime",
        action="store_true",
        help="verify the eight prerequisites and the live gate only",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--allow-production",
        action="store_true",
        help="explicit opt-in required to run against NODE_ENV=production",
    )
    args = parser.parse_args(argv)

    if args.check_dependencies and args.check_runtime:
        parser.error("--check-dependencies and --check-runtime are mutually exclusive")

    if args.staging:
        _load_env_file(REPO_ROOT / ".env.staging")

    if _looks_like_production(os.environ) and not args.allow_production:
        print(
            "refusing to run against NODE_ENV=production without --allow-production",
            file=sys.stderr,
        )
        return 2

    checks = asyncio.run(_run_checks(args))
    ready = strict_ready(checks)
    code = exit_code_for(checks)

    if args.json:
        print(
            json.dumps(
                {
                    "stagingReady": ready,
                    "exitCode": code,
                    "checks": [check.to_dict() for check in checks],
                }
            )
        )
    else:
        for check in checks:
            print(f"[{check.group}] {check.status.value:10} {check.name}: {check.detail}")
        print()
        print(f"staging ready (strict semantics): {ready}")
        print("live execution remains refused by code regardless of this answer.")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
