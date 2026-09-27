"""Part 28: the development preflight (``scripts/staging/live_readiness.py``).

The preflight is the permissive twin of the staging rehearsal: SKIPPED counts
as success for credential-conditional prerequisites, and it is expected to run
on a developer box with no Redis, no Postgres and no vault. What the tests
pin is therefore not "it passes" - on a bare box it must NOT pass - but the
three things that would rot silently otherwise:

1. the grading is read off the engine's own ``LiveEnablementReport``, never
   re-derived from flags, so the preflight and the refusal cannot disagree;
2. the strict/soft boundary (which prerequisites may be SKIPPED, and only
   when no credential source is named) is the README's table, as code;
3. the tool refuses production, refuses unconfigured boot, and tells the
   truth in both text and JSON.

The script is imported by path (``scripts/staging`` is a tools directory, not
a package) and every test runs against the REAL composition root via the
shared conftest environment - the same no-mocks-under-the-money-path rule as
the rest of the suite.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "scripts" / "staging"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import live_readiness as preflight  # noqa: E402
from wlct_trading.execution.live_enablement import (  # noqa: E402
    LiveEnablementReport,
    LivePrerequisite,
)

# ---------------------------------------------------------------------------
# The vocabulary: order, membership, and the strict/soft boundary
# ---------------------------------------------------------------------------


class TestThePreflightVocabulary:
    def test_the_prerequisite_order_is_the_enum_declaration_order(self) -> None:
        # Report order = declaration order: a preflight line and the engine's
        # refusal sentence must list the same things in the same order, or
        # one of them is being translated twice.
        assert preflight.PREREQUISITE_ORDER == tuple(LivePrerequisite)

    def test_every_enum_member_is_graded_exactly_once(self) -> None:
        assert len(preflight.PREREQUISITE_ORDER) == len(set(preflight.PREREQUISITE_ORDER)) == 8

    def test_exactly_four_prerequisites_are_credential_conditional(self) -> None:
        assert preflight.CREDENTIAL_CONDITIONAL == frozenset(
            {
                LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
                LivePrerequisite.CREDENTIAL_FETCHER_WIRED,
                LivePrerequisite.VENUE_ATTESTOR_WIRED,
                LivePrerequisite.OPERATOR_CONFIRMATION_ACCEPTED,
            }
        )

    def test_the_credential_conditional_set_never_grows_silently(self) -> None:
        # A fifth member here is a change to what a developer box tolerates -
        # exactly the kind of decision that must be a reviewed edit to THIS
        # assertion instead of a quiet frozenset entry.
        assert len(preflight.CREDENTIAL_CONDITIONAL) == 4

    def test_the_status_vocabulary_is_exactly_three_outcomes(self) -> None:
        assert {status.value for status in preflight.PrerequisiteStatus} == {
            "PASS",
            "SKIPPED",
            "FAIL",
        }


# ---------------------------------------------------------------------------
# classify: the strict/soft boundary
# ---------------------------------------------------------------------------


def _report(
    satisfied: tuple[LivePrerequisite, ...],
    missing: tuple[LivePrerequisite, ...],
    credential_source: str = "none",
) -> LiveEnablementReport:
    return LiveEnablementReport(
        satisfied=satisfied, missing=missing, credential_source=credential_source
    )


class TestClassify:
    def test_a_satisfied_prerequisite_passes_regardless_of_kind(self) -> None:
        report = _report((LivePrerequisite.DURABLE_STORE_WIRED,), ())
        assert preflight.classify(LivePrerequisite.DURABLE_STORE_WIRED, report) is (
            preflight.PrerequisiteStatus.PASS
        )

    def test_a_required_prerequisite_missing_is_a_fail(self) -> None:
        report = _report((), (LivePrerequisite.DURABLE_STORE_WIRED,))
        assert preflight.classify(LivePrerequisite.DURABLE_STORE_WIRED, report) is (
            preflight.PrerequisiteStatus.FAIL
        )

    def test_a_credential_conditional_missing_with_no_source_is_skipped(self) -> None:
        report = _report((), (LivePrerequisite.VENUE_ATTESTOR_WIRED,), credential_source="none")
        assert preflight.classify(LivePrerequisite.VENUE_ATTESTOR_WIRED, report) is (
            preflight.PrerequisiteStatus.SKIPPED
        )

    def test_a_credential_conditional_missing_with_a_source_is_a_fail(self) -> None:
        # "environment" was named but the runtime graded it missing: a
        # configured-but-absent credential path is the one failure the
        # preflight must never smooth into a skip.
        report = _report(
            (),
            (LivePrerequisite.CREDENTIAL_FETCHER_WIRED,),
            credential_source="environment",
        )
        assert preflight.classify(LivePrerequisite.CREDENTIAL_FETCHER_WIRED, report) is (
            preflight.PrerequisiteStatus.FAIL
        )

    def test_the_source_prerequisite_itself_follows_the_same_rule(self) -> None:
        configured = _report((), (LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,), "secret-manager")
        assert preflight.classify(LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED, configured) is (
            preflight.PrerequisiteStatus.FAIL
        )
        unconfigured = _report((), (LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,), "none")
        assert preflight.classify(LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED, unconfigured) is (
            preflight.PrerequisiteStatus.SKIPPED
        )


class TestRunPreflight:
    def test_all_eight_are_graded_in_report_order(self) -> None:
        report = LiveEnablementReport(
            satisfied=(
                LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
                LivePrerequisite.DURABLE_STORE_WIRED,
            ),
            missing=tuple(
                p for p in LivePrerequisite if p not in (
                    LivePrerequisite.CREDENTIAL_SOURCE_CONFIGURED,
                    LivePrerequisite.DURABLE_STORE_WIRED,
                )
            ),
            credential_source="environment",
        )
        results = preflight.run_preflight(report)
        assert [r.prerequisite for r in results] == list(LivePrerequisite)
        by_name = {r.prerequisite: r.status for r in results}
        assert by_name[LivePrerequisite.DURABLE_STORE_WIRED] is preflight.PrerequisiteStatus.PASS
        assert by_name[LivePrerequisite.SIGNED_TRANSPORT_WIRED] is preflight.PrerequisiteStatus.FAIL

    def test_the_result_renders_as_data(self) -> None:
        result = preflight.ReadinessResult(
            prerequisite=LivePrerequisite.IP_ALLOWLIST_ENFORCED,
            status=preflight.PrerequisiteStatus.PASS,
            detail="graded from runtime objects",
        )
        assert result.to_dict() == {
            "prerequisite": "IP_ALLOWLIST_ENFORCED",
            "status": "PASS",
            "detail": "graded from runtime objects",
        }


# ---------------------------------------------------------------------------
# Environment loading and the production guard
# ---------------------------------------------------------------------------


class TestStagingEnvLoading:
    def test_load_staging_env_sets_unset_variables_and_returns_the_count(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        env_file = tmp_path / ".env.staging"
        env_file.write_text(
            "# comment line\n"
            "\n"
            "EXECUTION_MODE=simulated\n"
            'EXECUTION_DRY_RUN="true"\n'
            "EXECUTION_SIMULATED_MID='50000'\n",
            encoding="utf-8",
        )
        monkeypatch.delenv("EXECUTION_MODE", raising=False)
        monkeypatch.delenv("EXECUTION_DRY_RUN", raising=False)
        monkeypatch.delenv("EXECUTION_SIMULATED_MID", raising=False)
        loaded = preflight.load_staging_env(env_file)
        assert loaded == 3
        assert __import__("os").environ["EXECUTION_MODE"] == "simulated"
        assert __import__("os").environ["EXECUTION_DRY_RUN"] == "true"
        assert __import__("os").environ["EXECUTION_SIMULATED_MID"] == "50000"

    def test_an_already_exported_variable_wins_over_the_file(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        env_file = tmp_path / ".env.staging"
        env_file.write_text("EXECUTION_MODE=live\n", encoding="utf-8")
        monkeypatch.setenv("EXECUTION_MODE", "simulated")
        preflight.load_staging_env(env_file)
        assert __import__("os").environ["EXECUTION_MODE"] == "simulated"

    def test_a_missing_file_loads_nothing(self, tmp_path: Path) -> None:
        assert preflight.load_staging_env(tmp_path / "absent.env") == 0


class TestTheProductionGuard:
    def test_production_without_opt_in_refuses_with_exit_two(self, monkeypatch) -> None:
        monkeypatch.setenv("NODE_ENV", "production")
        assert preflight.main([]) == 2

    def test_the_guard_reads_the_environment_case_sensitively_lowercased(
        self, monkeypatch
    ) -> None:
        monkeypatch.setenv("NODE_ENV", "Production")
        assert preflight.main([]) == 2

    def test_non_production_environments_are_not_the_guarded_thing(
        self, monkeypatch
    ) -> None:
        # The guard fires on NODE_ENV, not on EXECUTION_MODE: a staging run
        # with simulated mode is the tool's whole purpose.
        assert not preflight._looks_like_production({"NODE_ENV": "staging"})
        assert not preflight._looks_like_production({"NODE_ENV": ""})
        assert not preflight._looks_like_production({})


# ---------------------------------------------------------------------------
# The real composition root, through main(): text and JSON
# ---------------------------------------------------------------------------


class TestPreflightAgainstTheRealRuntime:
    def test_a_bare_development_box_reports_fail_for_required_and_exits_one(
        self, capsys
    ) -> None:
        # BASE_ENV (conftest): memory store, in-memory locks, signed transport
        # wired. The preflight must say exactly that, in enum order.
        code = preflight.main([])
        output = capsys.readouterr().out
        lines = [line for line in output.splitlines() if line and not line.startswith((" ", "\t"))]
        statuses = {line.split()[1]: line.split()[0] for line in lines if len(line.split()) >= 2}
        assert statuses["DURABLE_STORE_WIRED"] == "FAIL"
        assert statuses["DISTRIBUTED_LOCKS_WIRED"] == "FAIL"
        assert statuses["SIGNED_TRANSPORT_WIRED"] == "PASS"
        assert statuses["IP_ALLOWLIST_ENFORCED"] == "PASS"
        for name in (
            "CREDENTIAL_SOURCE_CONFIGURED",
            "CREDENTIAL_FETCHER_WIRED",
            "VENUE_ATTESTOR_WIRED",
            "OPERATOR_CONFIRMATION_ACCEPTED",
        ):
            assert statuses[name] == "SKIPPED"
        assert "ready (preflight semantics): False" in output
        # The sentence that must survive every refactor of this tool.
        assert "live execution remains refused by code" in output
        assert code == 1

    def test_json_mode_is_a_single_payload_with_all_eight(self, capsys) -> None:
        code = preflight.main(["--json"])
        payload = json.loads(capsys.readouterr().out)
        assert payload["ready"] is False
        assert payload["liveRefused"] is True
        assert payload["credentialSource"] == "none"
        assert len(payload["prerequisites"]) == 8
        assert code == 1

    def test_json_mode_is_the_only_output_in_json_mode(self, capsys) -> None:
        preflight.main(["--json"])
        out = capsys.readouterr().out
        json.loads(out)  # raises if anything prose-shaped leaked in
        assert out.count("\n") == 1

    def test_an_unconfigured_boot_is_a_refusal_not_a_traceback(self, monkeypatch, capsys) -> None:
        # The service's fail-closed settings (no internal token) must surface
        # as an exit-2 answer, never a stack trace an operator has to parse.
        monkeypatch.delenv("EXECUTION_INTERNAL_TOKEN", raising=False)
        code = preflight.main([])
        assert code == 2
        assert "configuration refused" in capsys.readouterr().out

    def test_the_unconfigured_boot_answers_in_json_too(self, monkeypatch, capsys) -> None:
        monkeypatch.delenv("EXECUTION_INTERNAL_TOKEN", raising=False)
        code = preflight.main(["--json"])
        payload = json.loads(capsys.readouterr().out)
        assert payload == {
            "mode": None,
            "ready": False,
            "prerequisites": [],
            "error": payload["error"],
        }
        assert "configuration refused" in payload["error"]
        assert code == 2

    def test_staging_flag_without_a_file_changes_nothing(self, capsys) -> None:
        # No .env.staging in the repo (it is gitignored by design), so
        # --staging must be a no-op here, not a crash.
        code = preflight.main(["--staging", "--json"])
        assert code == 1
        assert json.loads(capsys.readouterr().out)["ready"] is False


# ---------------------------------------------------------------------------
# main() wiring details that should not silently change
# ---------------------------------------------------------------------------


class TestMainWiring:
    def test_unknown_arguments_are_argparse_errors(self) -> None:
        try:
            preflight.main(["--mode=live"])
        except SystemExit as exit_error:
            assert exit_error.code == 2
        else:  # pragma: no cover
            raise AssertionError("argparse accepted an unknown flag")

    def test_the_script_exposes_its_surface_for_the_readme(self) -> None:
        # The README documents both tools by these names; the integrity test
        # holds the files, and this holds the API.
        for name in preflight.__all__:
            assert hasattr(preflight, name), name

    def test_grading_is_not_recomputed_from_flags(self) -> None:
        # The report is THE source: run_preflight takes one, and nothing in
        # the module grading path reads os.environ. Pinned as a shape fact -
        # a second derivation from flags is exactly how the preflight and the
        # refusal would drift apart.
        import inspect

        source = inspect.getsource(preflight.classify)
        assert "os.environ" not in source
        assert "getenv" not in source
