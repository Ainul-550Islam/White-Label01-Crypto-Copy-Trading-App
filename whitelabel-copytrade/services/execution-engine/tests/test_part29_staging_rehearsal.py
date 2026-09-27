"""Part 29: the staging rehearsal (``scripts/staging/staging_rehearsal.py``).

The strict twin of Part 28's preflight. SKIPPED is NOT success here, BLOCKED
is its own exit code, and the readiness table (PASS/FAIL/BLOCKED/UNVERIFIED/
SKIPPED) is the contract the README publishes and CI consumes. The tests pin:

1. the readiness arithmetic - which combinations open the doors and which
   exit codes they produce, including BLOCKED outranking FAIL;
2. the required/credential-conditional split, as data, byte-equal to the
   README's table;
3. the runtime grading, against a synthetic enablement report so every
   status cell is reachable without infrastructure;
4. the Redis client's URL grammar and the fail-closed config handling;
5. the live-mode gate: a report that does NOT block live execution is the
   one FAIL this tool must never be talked out of.

Dependency probes that need real PostgreSQL/Redis are exercised only on
their not-configured paths here - the live paths are the staging box's job,
and faking a Redis behind a fake protocol would test the fake.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "scripts" / "staging"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import staging_rehearsal as rehearsal  # noqa: E402
from wlct_trading.execution.live_enablement import (  # noqa: E402
    LiveEnablementReport,
    LivePrerequisite,
)

ALL_PREREQUISITES: tuple[LivePrerequisite, ...] = tuple(LivePrerequisite)

REQUIRED: frozenset[LivePrerequisite] = frozenset(
    {
        LivePrerequisite.DURABLE_STORE_WIRED,
        LivePrerequisite.DISTRIBUTED_LOCKS_WIRED,
        LivePrerequisite.SIGNED_TRANSPORT_WIRED,
        LivePrerequisite.IP_ALLOWLIST_ENFORCED,
    }
)
CREDENTIAL_CONDITIONAL: frozenset[LivePrerequisite] = frozenset(ALL_PREREQUISITES) - REQUIRED


def _check(
    name: str,
    status: rehearsal.CheckStatus,
    *,
    group: str = "runtime",
    detail: str = "",
) -> rehearsal.CheckResult:
    return rehearsal.CheckResult(group=group, name=name, status=status, detail=detail)


# ---------------------------------------------------------------------------
# The vocabulary, as data
# ---------------------------------------------------------------------------


class TestTheRehearsalVocabulary:
    def test_the_status_table_is_exactly_the_readme_s_five_outcomes(self) -> None:
        assert {status.value for status in rehearsal.CheckStatus} == {
            "PASS",
            "FAIL",
            "BLOCKED",
            "UNVERIFIED",
            "SKIPPED",
        }

    def test_the_required_set_is_exactly_the_readme_s_four(self) -> None:
        assert rehearsal.REQUIRED_PREREQUISITES == REQUIRED

    def test_the_conditional_set_is_the_complement(self) -> None:
        assert rehearsal.CREDENTIAL_CONDITIONAL_PREREQUISITES == CREDENTIAL_CONDITIONAL
        assert rehearsal.REQUIRED_PREREQUISITES.isdisjoint(
            rehearsal.CREDENTIAL_CONDITIONAL_PREREQUISITES
        )

    def test_every_prerequisite_is_classified_exactly_once(self) -> None:
        assert REQUIRED | CREDENTIAL_CONDITIONAL == frozenset(ALL_PREREQUISITES)
        assert len(ALL_PREREQUISITES) == 8

    def test_the_result_renders_as_data(self) -> None:
        assert _check("x", rehearsal.CheckStatus.PASS, detail="d").to_dict() == {
            "group": "runtime",
            "name": "x",
            "status": "PASS",
            "detail": "d",
        }

    def test_the_engine_tables_probe_names_part_13_s_three_tables(self) -> None:
        # The schema check refuses to write its probe row unless all three
        # tables exist; a fourth name would be a migration that never ran.
        assert rehearsal._ENGINE_TABLES == (
            "engine_orders",
            "engine_order_events",
            "engine_order_fills",
        )


# ---------------------------------------------------------------------------
# strict_ready: the arithmetic staging opens the doors by
# ---------------------------------------------------------------------------


def _ready_checks() -> list[rehearsal.CheckResult]:
    checks = [_check(f"runtime.{p.value}", rehearsal.CheckStatus.PASS) for p in ALL_PREREQUISITES]
    checks.append(_check("runtime.LIVE_MODE_GATE", rehearsal.CheckStatus.PASS))
    checks.append(_check("runtime.bootstrap", rehearsal.CheckStatus.PASS))
    return checks


class TestStrictReady:
    def test_all_pass_is_ready(self) -> None:
        assert rehearsal.strict_ready(_ready_checks()) is True

    def test_a_credential_conditional_skip_with_no_source_is_ready(self) -> None:
        checks = _ready_checks()
        checks[
            next(
                i
                for i, c in enumerate(checks)
                if c.name == "runtime.CREDENTIAL_SOURCE_CONFIGURED"
            )
        ] = _check(
            "runtime.CREDENTIAL_SOURCE_CONFIGURED",
            rehearsal.CheckStatus.SKIPPED,
            detail="no credential source configured (acceptable for credentials only)",
        )
        assert rehearsal.strict_ready(checks) is True

    def test_a_dependency_skip_is_not_ready_even_with_detail_match(self) -> None:
        # The no-credential-skip belongs to runtime prerequisites ONLY: a
        # skipped Postgres check is staging infrastructure that was never
        # verified, whatever its detail string says.
        checks = _ready_checks()
        checks.append(
            _check(
                "postgres.connectivity",
                rehearsal.CheckStatus.SKIPPED,
                group="dependency-postgresql",
                detail="no credential source configured (acceptable for credentials only)",
            )
        )
        assert rehearsal.strict_ready(checks) is False

    def test_a_runtime_skip_with_a_mismatched_detail_is_not_ready(self) -> None:
        # Only the exact "no credential source" answer may skip; a skip with
        # any other excuse is an unverified required thing wearing a costume.
        checks = _ready_checks()
        checks[
            next(
                i
                for i, c in enumerate(checks)
                if c.name == "runtime.CREDENTIAL_SOURCE_CONFIGURED"
            )
        ] = _check(
            "runtime.CREDENTIAL_SOURCE_CONFIGURED",
            rehearsal.CheckStatus.SKIPPED,
            detail="operator said it was fine",
        )
        assert rehearsal.strict_ready(checks) is False

    def test_a_required_skip_is_not_ready(self) -> None:
        checks = _ready_checks()
        checks[
            next(i for i, c in enumerate(checks) if c.name == "runtime.DURABLE_STORE_WIRED")
        ] = _check(
            "runtime.DURABLE_STORE_WIRED",
            rehearsal.CheckStatus.SKIPPED,
            detail="no credential source configured (acceptable for credentials only)",
        )
        assert rehearsal.strict_ready(checks) is False

    def test_any_fail_is_not_ready(self) -> None:
        checks = _ready_checks()
        checks.append(
            _check("redis.lock_roundtrip", rehearsal.CheckStatus.FAIL, group="dependency-redis")
        )
        assert rehearsal.strict_ready(checks) is False

    def test_any_blocked_is_not_ready(self) -> None:
        checks = _ready_checks()
        checks.append(
            _check(
                "postgres.connectivity",
                rehearsal.CheckStatus.BLOCKED,
                group="dependency-postgresql",
            )
        )
        assert rehearsal.strict_ready(checks) is False

    def test_any_unverified_is_not_ready(self) -> None:
        checks = _ready_checks()
        checks[
            next(
                i
                for i, c in enumerate(checks)
                if c.name == "runtime.VENUE_ATTESTOR_WIRED"
            )
        ] = _check(
            "runtime.VENUE_ATTESTOR_WIRED",
            rehearsal.CheckStatus.UNVERIFIED,
            detail="credential source 'secret-manager' is configured but "
            "the runtime could not verify this prerequisite",
        )
        assert rehearsal.strict_ready(checks) is False


# ---------------------------------------------------------------------------
# exit codes: 0 ready, 1 fail, 2 blocked
# ---------------------------------------------------------------------------


class TestExitCodes:
    def test_ready_is_zero(self) -> None:
        assert rehearsal.exit_code_for(_ready_checks()) == 0

    def test_a_fail_is_one(self) -> None:
        checks = _ready_checks()
        checks.append(
            _check("redis.lock_roundtrip", rehearsal.CheckStatus.FAIL, group="dependency-redis")
        )
        assert rehearsal.exit_code_for(checks) == 1

    def test_blocked_outranks_fail(self) -> None:
        # Different remedies: fix the wiring (FAIL) vs fix the infrastructure
        # the wiring points at (BLOCKED). CI maps both to "not ready"; the
        # exit code must still let a human tell them apart.
        checks = _ready_checks()
        checks.append(
            _check("redis.lock_roundtrip", rehearsal.CheckStatus.FAIL, group="dependency-redis")
        )
        checks.append(
            _check(
                "postgres.connectivity",
                rehearsal.CheckStatus.BLOCKED,
                group="dependency-postgresql",
            )
        )
        assert rehearsal.exit_code_for(checks) == 2

    def test_blocked_alone_is_two(self) -> None:
        checks = _ready_checks()
        checks.append(
            _check(
                "postgres.connectivity",
                rehearsal.CheckStatus.BLOCKED,
                group="dependency-postgresql",
            )
        )
        assert rehearsal.exit_code_for(checks) == 2

    def test_an_unverified_counts_as_one_not_two(self) -> None:
        checks = _ready_checks()
        checks[
            next(i for i, c in enumerate(checks) if c.name == "runtime.DURABLE_STORE_WIRED")
        ] = _check("runtime.DURABLE_STORE_WIRED", rehearsal.CheckStatus.UNVERIFIED)
        assert rehearsal.exit_code_for(checks) == 1


# ---------------------------------------------------------------------------
# The runtime grading, against synthetic reports
# ---------------------------------------------------------------------------


def _report(
    satisfied: tuple[LivePrerequisite, ...],
    missing: tuple[LivePrerequisite, ...],
    credential_source: str = "none",
) -> LiveEnablementReport:
    return LiveEnablementReport(
        satisfied=satisfied, missing=missing, credential_source=credential_source
    )


class TestGradeRuntimePrerequisites:
    def test_all_satisfied_grades_all_pass(self) -> None:
        results = rehearsal.grade_runtime_prerequisites(_report(ALL_PREREQUISITES, ()))
        assert all(r.status is rehearsal.CheckStatus.PASS for r in results)
        assert len(results) == 8

    def test_a_required_missing_is_a_fail_not_a_skip(self) -> None:
        results = rehearsal.grade_runtime_prerequisites(
            _report((), (LivePrerequisite.DURABLE_STORE_WIRED,))
        )
        by_name = {r.name: r.status for r in results}
        assert by_name["runtime.DURABLE_STORE_WIRED"] is rehearsal.CheckStatus.FAIL

    def test_conditional_missing_with_no_source_is_skipped(self) -> None:
        missing = tuple(rehearsal.CREDENTIAL_CONDITIONAL_PREREQUISITES)
        results = rehearsal.grade_runtime_prerequisites(_report((), missing))
        by_name = {r.name: r.status for r in results}
        assert by_name["runtime.CREDENTIAL_SOURCE_CONFIGURED"] is rehearsal.CheckStatus.SKIPPED
        assert by_name["runtime.VENUE_ATTESTOR_WIRED"] is rehearsal.CheckStatus.SKIPPED

    def test_conditional_missing_with_a_source_is_unverified(self) -> None:
        missing = tuple(rehearsal.CREDENTIAL_CONDITIONAL_PREREQUISITES)
        results = rehearsal.grade_runtime_prerequisites(
            _report((), missing, credential_source="secret-manager")
        )
        by_name = {r.name: r.status for r in results}
        assert by_name["runtime.CREDENTIAL_FETCHER_WIRED"] is rehearsal.CheckStatus.UNVERIFIED

    def test_mixed_report_lands_each_prerequisite_in_its_own_cell(self) -> None:
        satisfied = (
            LivePrerequisite.DURABLE_STORE_WIRED,
            LivePrerequisite.DISTRIBUTED_LOCKS_WIRED,
            LivePrerequisite.SIGNED_TRANSPORT_WIRED,
            LivePrerequisite.IP_ALLOWLIST_ENFORCED,
            LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
        )
        missing = tuple(p for p in ALL_PREREQUISITES if p not in satisfied)
        results = rehearsal.grade_runtime_prerequisites(
            _report(satisfied, missing, credential_source="environment")
        )
        by_name = {r.name: r.status for r in results}
        assert by_name["runtime.DURABLE_STORE_WIRED"] is rehearsal.CheckStatus.PASS
        assert by_name["runtime.CREDENTIAL_SOURCE_CONFIGURED"] is rehearsal.CheckStatus.PASS
        assert by_name["runtime.CREDENTIAL_FETCHER_WIRED"] is rehearsal.CheckStatus.UNVERIFIED


class TestTheLiveModeGate:
    def test_a_blocking_report_passes_the_gate(self) -> None:
        report = _report((), (LivePrerequisite.SIGNED_TRANSPORT_WIRED,))
        result = rehearsal.check_live_mode_gate(report)
        assert result.status is rehearsal.CheckStatus.PASS

    def test_a_report_that_stops_blocking_is_the_one_unacceptable_answer(self) -> None:
        report = _report(ALL_PREREQUISITES, ())
        result = rehearsal.check_live_mode_gate(report)
        assert result.status is rehearsal.CheckStatus.FAIL
        assert result.name == "runtime.LIVE_MODE_GATE"


# ---------------------------------------------------------------------------
# The minimal Redis client: URL grammar before any socket is opened
# ---------------------------------------------------------------------------


class TestStagingRedisClientUrlGrammar:
    def test_a_plain_url_parses(self) -> None:
        client = rehearsal.StagingRedisClient("redis://redis:6379/0")
        assert (client.host, client.port, client.password, client.db, client.use_tls) == (
            "redis",
            6379,
            "",
            0,
            False,
        )

    def test_the_default_port_is_6379(self) -> None:
        client = rehearsal.StagingRedisClient("redis://redis")
        assert client.port == 6379

    def test_a_password_only_url_parses_the_compose_form(self) -> None:
        # docker-compose writes redis://:password@host - empty user, password
        # in the password field. The grammar the staging overlay actually
        # produces is the grammar that must parse.
        client = rehearsal.StagingRedisClient("redis://:s3cret@redis:6379/2")
        assert client.password == "s3cret"  # noqa: S105 - a URL-grammar fixture
        assert client.db == 2

    def test_a_user_password_url_parses_too(self) -> None:
        client = rehearsal.StagingRedisClient("redis://default:s3cret@redis:6380")
        assert client.password == "s3cret"  # noqa: S105 - a URL-grammar fixture
        assert client.db == 0

    def test_rediss_selects_tls(self) -> None:
        client = rehearsal.StagingRedisClient("rediss://:s3cret@redis:6379")
        assert client.use_tls is True

    def test_a_non_redis_scheme_is_refused_before_any_connection(self) -> None:
        try:
            rehearsal.StagingRedisClient("http://redis:6379")
        except ValueError as error:
            assert "redis://" in str(error)
        else:  # pragma: no cover
            raise AssertionError("http:// was accepted")

    def test_a_hostless_url_is_refused(self) -> None:
        try:
            rehearsal.StagingRedisClient("redis:///0")
        except ValueError as error:
            assert "host" in str(error)
        else:  # pragma: no cover
            raise AssertionError("a hostless URL was accepted")

    def test_commands_before_connect_are_a_runtime_error_not_a_hang(self) -> None:
        client = rehearsal.StagingRedisClient("redis://redis:6379")
        try:
            asyncio.run(client.ping())
        except RuntimeError as error:
            assert "not connected" in str(error)
        else:  # pragma: no cover
            raise AssertionError("ping before connect did not refuse")


# ---------------------------------------------------------------------------
# Dependency checks on their not-configured paths (no services needed)
# ---------------------------------------------------------------------------


class TestDependencyChecksNotConfigured:
    def test_memory_backend_skips_all_three_postgres_checks(self) -> None:
        settings = SimpleNamespace(
            EXECUTION_STORE_BACKEND="memory", EXECUTION_POSTGRES_DSN=None
        )
        results = asyncio.run(rehearsal.check_postgres(settings))
        assert [r.name for r in results] == [
            "postgres.connectivity",
            "postgres.schema",
            "postgres.persistence_recovery",
        ]
        assert all(r.status is rehearsal.CheckStatus.SKIPPED for r in results)

    def test_a_postgres_backend_without_a_dsn_still_skips(self) -> None:
        # The config refuses postgres-without-DSN at boot; the rehearsal's
        # skip must not depend on which half of the misconfiguration it sees.
        settings = SimpleNamespace(
            EXECUTION_STORE_BACKEND="postgres", EXECUTION_POSTGRES_DSN=None
        )
        results = asyncio.run(rehearsal.check_postgres(settings))
        assert all(r.status is rehearsal.CheckStatus.SKIPPED for r in results)

    def test_disabled_locks_skip_both_redis_checks(self) -> None:
        settings = SimpleNamespace(
            EXECUTION_DISTRIBUTED_LOCKS=False, EXECUTION_REDIS_URL=None
        )
        results = asyncio.run(rehearsal.check_redis(settings))
        assert [r.name for r in results] == ["redis.connectivity", "redis.lock_roundtrip"]
        assert all(r.status is rehearsal.CheckStatus.SKIPPED for r in results)

    def test_locks_enabled_without_a_url_still_skip(self) -> None:
        settings = SimpleNamespace(
            EXECUTION_DISTRIBUTED_LOCKS=True, EXECUTION_REDIS_URL=None
        )
        results = asyncio.run(rehearsal.check_redis(settings))
        assert all(r.status is rehearsal.CheckStatus.SKIPPED for r in results)

    def test_skips_never_render_the_dsn_or_url(self) -> None:
        # "Configured" is the most a detail line may say about a connection
        # string; a password that leaks through a status tool is a breach the
        # tool itself committed.
        settings = SimpleNamespace(
            EXECUTION_STORE_BACKEND="postgres",
            EXECUTION_POSTGRES_DSN="postgresql://user:sup3rs3cret@db:5432/wlct",
        )
        rendered = json.dumps(
            [r.to_dict() for r in asyncio.run(rehearsal.check_postgres(settings))]
        )
        assert "sup3rs3cret" not in rendered
        settings = SimpleNamespace(
            EXECUTION_DISTRIBUTED_LOCKS=False,
            EXECUTION_REDIS_URL="redis://:anothers3cret@redis:6379/0",
        )
        rendered = json.dumps([r.to_dict() for r in asyncio.run(rehearsal.check_redis(settings))])
        assert "anothers3cret" not in rendered


# ---------------------------------------------------------------------------
# Env loading, the production guard, and main() wiring
# ---------------------------------------------------------------------------


class TestMainWiring:
    def test_the_production_guard_refuses_with_exit_two(self, monkeypatch) -> None:
        monkeypatch.setenv("NODE_ENV", "production")
        assert rehearsal.main([]) == 2

    def test_check_flags_are_mutually_exclusive(self) -> None:
        try:
            rehearsal.main(["--check-dependencies", "--check-runtime"])
        except SystemExit as exit_error:
            assert exit_error.code == 2
        else:  # pragma: no cover
            raise AssertionError("contradictory flags were accepted")

    def test_an_unconfigured_boot_is_blocked_not_a_traceback(self, monkeypatch) -> None:
        monkeypatch.delenv("EXECUTION_INTERNAL_TOKEN", raising=False)
        code = rehearsal.main(["--check-runtime", "--json"])
        assert code == 2

    def test_json_payload_carries_the_contract_keys(self, capsys) -> None:
        code = rehearsal.main(["--check-runtime", "--json"])
        payload = json.loads(capsys.readouterr().out)
        assert set(payload) == {"stagingReady", "exitCode", "checks"}
        assert payload["stagingReady"] is False
        assert payload["exitCode"] == code
        # bootstrap + 8 prerequisites + the live gate, whatever the grading.
        names = [c["name"] for c in payload["checks"]]
        assert names[0] == "runtime.bootstrap"
        assert names[-1] == "runtime.LIVE_MODE_GATE"
        assert len([n for n in names if n.startswith("runtime.")]) == 10

    def test_a_development_box_runtime_check_exits_one(self) -> None:
        # BASE_ENV (conftest): memory store, in-memory locks -> the two
        # required prerequisites FAIL under strict semantics. Exactly the
        # "you are not in staging anymore" answer the tool exists to give.
        assert rehearsal.main(["--check-runtime"]) == 1

    def test_the_prose_output_names_every_check_and_the_gate_sentence(
        self, capsys
    ) -> None:
        rehearsal.main(["--check-runtime"])
        out = capsys.readouterr().out
        assert "[runtime]" in out
        assert "runtime.DURABLE_STORE_WIRED" in out
        assert "runtime.LIVE_MODE_GATE" in out
        assert "staging ready (strict semantics): False" in out
        assert "live execution remains refused by code" in out

    def test_the_staging_flag_without_a_file_is_a_no_op(self) -> None:
        # .env.staging is gitignored by design; the flag must tolerate its
        # absence and simply run on the ambient environment.
        assert rehearsal.main(["--staging", "--check-runtime", "--json"]) == 1


class TestEnvFileLoading:
    def test_load_env_file_sets_unset_variables(self, tmp_path: Path, monkeypatch) -> None:
        env_file = tmp_path / ".env.staging"
        env_file.write_text(
            "# staging\n"
            "POSTGRES_PASSWORD=staging-pg\n"
            "REDIS_PASSWORD='staging-redis'\n"
            "\n"
            "broken-line\n",
            encoding="utf-8",
        )
        monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
        monkeypatch.delenv("REDIS_PASSWORD", raising=False)
        loaded = rehearsal._load_env_file(env_file)
        assert loaded == 2
        import os

        assert os.environ["POSTGRES_PASSWORD"] == "staging-pg"  # noqa: S105
        assert os.environ["REDIS_PASSWORD"] == "staging-redis"  # noqa: S105

    def test_already_exported_variables_win(self, tmp_path: Path, monkeypatch) -> None:
        env_file = tmp_path / ".env.staging"
        env_file.write_text("REDIS_PASSWORD=from-file\n", encoding="utf-8")
        monkeypatch.setenv("REDIS_PASSWORD", "from-shell")  # noqa: S105
        rehearsal._load_env_file(env_file)
        import os

        assert os.environ["REDIS_PASSWORD"] == "from-shell"  # noqa: S105

    def test_a_missing_file_loads_nothing(self, tmp_path: Path) -> None:
        assert rehearsal._load_env_file(tmp_path / "absent.env") == 0


class TestTheReadmeContract:
    def test_the_module_exposes_the_surface_the_readme_documents(self) -> None:
        for name in rehearsal.__all__:
            assert hasattr(rehearsal, name), name

    def test_connect_timeout_is_bounded_so_a_dead_box_fails_fast(self) -> None:
        # A rehearsal against a black-holed host must answer in seconds, not
        # hang CI until the runner timeout - the constant is the promise.
        assert 0 < rehearsal._CONNECT_TIMEOUT_SECONDS <= 30
