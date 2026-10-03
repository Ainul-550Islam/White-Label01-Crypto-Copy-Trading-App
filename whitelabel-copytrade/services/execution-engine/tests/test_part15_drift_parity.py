"""Part 15 drift traps: the probe's SQL against the platform's own RLS
artifacts, in both directions.

An enablement audit is worth exactly as much as its agreement with reality.
The SQL in ``app/rls_probe.py`` is written against three artifacts nobody in
this service owns - the Part 11 migration (policies and the GUC function),
the generated ``enable.sql``/``disable.sql`` pair, and ``rls_coverage.json``.
Every one of them can move without anyone touching the probe: a new covered
table, a renamed policy, a predicate that stops mentioning the GUC. Each
would leave this audit cheerfully verifying the wrong thing, which is worse
than not verifying at all, because a green grade is what stops people
looking.

So every claim the executor makes is re-derived from those artifacts here:
the table list from the DDL (not from the module that grades it), the policy
name from the coverage manifest, the predicate shape from the migration, the
GUC name from the service that sets it, and the exclusions from the same
manifest the operator reads. The reverse direction is pinned too: the
artifacts must still claim what the probe claims, and the module must still
be a reader.

Part 14's parity file pins a WRITE's blast radius; this one pins a READ's
completeness - the same discipline, opposite hazard.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse
from wlct_trading.enablement import (
    EVIDENCE_LEDGER_TABLE,
    MAX_EVIDENCE_AGE_DAYS,
    MAX_PROBED_TABLES,
    MIN_EVIDENCE_AGE_DAYS,
    PLATFORM_SCOPED_TABLES,
    TENANT_GUC,
)

from app import rls_probe
from app.rls_probe import (
    BARE_COUNT_SQL,
    POLICY_POSTURE_SQL,
    PROBE_TABLES,
    ROLE_ATTRS_SQL,
    SCOPED_COUNT_SQL,
    TABLE_EXISTS_SQL,
)
from app.routers import enablement as enablement_router
from app.schemas import EnablementRequest

ROOT = Path(__file__).resolve().parents[3]
RLS_DIR = ROOT / "apps" / "api" / "prisma" / "rls"
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260923090000_part11_row_level_security"
    / "migration.sql"
)
PRISMA_SERVICE = ROOT / "apps" / "api" / "src" / "infrastructure" / "prisma" / "prisma.service.ts"
ENGINE_APP = ROOT / "services" / "execution-engine" / "app"
ENGINE_CLIENT = (
    ROOT / "apps" / "api" / "src" / "modules" / "worker" / "engine-internal.client.ts"
)


def rls_artifact(name: str) -> str:
    return (RLS_DIR / name).read_text(encoding="utf-8")


def coverage_manifest() -> dict[str, object]:
    return json.loads((RLS_DIR / "rls_coverage.json").read_text(encoding="utf-8"))


def covered_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" ENABLE ROW LEVEL SECURITY;', text)))


def forced_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" FORCE ROW LEVEL SECURITY;', text)))


def unforced_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" NO FORCE ROW LEVEL SECURITY;', text)))


def disabled_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" DISABLE ROW LEVEL SECURITY;', text)))


def migrated_tables(migration: str) -> dict[str, str]:
    """table -> the CREATE POLICY block that covers it."""
    blocks: dict[str, str] = {}
    for match in re.finditer(
        r'CREATE POLICY (\w+) ON "([a-z_]+)"(.*?);', migration, re.DOTALL
    ):
        blocks[match.group(2)] = f"{match.group(1)}{match.group(3)}"
    return blocks


#: The heads of a statement a driver would actually run. Deliberately
#: includes the write verbs: a constant that STARTS like a write is the thing
#: this file is looking for.
_SQL_HEAD_RE = re.compile(
    r"^(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|SET)\b",
    re.IGNORECASE,
)
READ_ONLY = "SET TRANSACTION READ ONLY"

ENABLE = rls_artifact("enable.sql")
DISABLE = rls_artifact("disable.sql")
MIGRATION_SQL = MIGRATION.read_text(encoding="utf-8")


class TestProbeTableSetMatchesTheArtifacts:
    def test_probe_tables_are_exactly_the_engine_plane_of_enable_sql(self) -> None:
        # Not "a subset", not "the ones we got to": if Part 11 covers a new
        # engine table and the probe does not read it, the audit's PASS is a
        # lie about a table it never touched. Re-deriving from the DDL (not
        # from a shared constant) is the whole point of this file.
        engine_plane = {name for name in covered_tables(ENABLE) if name.startswith("engine_")}
        assert set(PROBE_TABLES) == engine_plane
        assert len(PROBE_TABLES) == len(engine_plane)  # no duplicates

    def test_the_ledger_table_name_agrees_with_the_part14_owner(self) -> None:
        from app import retention as retention_module

        assert EVIDENCE_LEDGER_TABLE == retention_module.TABLE_RETENTION_RUNS
        assert EVIDENCE_LEDGER_TABLE in PROBE_TABLES

    def test_enable_and_disable_are_an_exact_pair(self) -> None:
        assert covered_tables(ENABLE) == forced_tables(ENABLE)
        assert unforced_tables(DISABLE) == disabled_tables(DISABLE) == covered_tables(ENABLE)
        # The probe asserts FORCE as a per-table fact; an unpaired ENABLE
        # (owner bypasses policies) is precisely what that assertion is for.
        manifest = coverage_manifest()
        assert len(covered_tables(ENABLE)) == len(manifest["covered"])
        assert {entry["table"] for entry in manifest["covered"]} == set(covered_tables(ENABLE))
        # The number the docs quote, in a test that reads the artifacts: 182
        # after the regeneration that followed the domain-persistence table
        # migration (20260923085000): the previous 161 (the Part 28 set of 153
        # at stamp 20260923090000 plus the eight developer_* tenant tables from
        # 20260923080000) plus the 21 tenant-owned billing, governance and
        # partner tables. The six new platform-scoped tables (nullable
        # tenant_id) joined the exclusion list, which is now 30.
        # 186 after Part 11 production SSO (20260923089000): the four
        # tenant-owned tables sso_auth_transactions, sso_identities,
        # sso_assertion_replays and sso_audit_events; exclusions unchanged.
        # It is pinned rather than derived because the whole point of the
        # pairing tests is that enable.sql, disable.sql, rls_coverage.json and
        # the prose agree - a number computed from one of them cannot show the
        # other three disagree.
        assert len(covered_tables(ENABLE)) == 186
        assert len(coverage_manifest()["excluded"]) == 30

    def test_every_covered_table_has_a_policy_in_the_migration(self) -> None:
        policies = migrated_tables(MIGRATION_SQL)
        for table in covered_tables(ENABLE):
            assert table in policies, f"{table} is enabled but has no policy"
            assert "USING (tenant_id = wlct_current_tenant_id())" in policies[table]
            assert "WITH CHECK (tenant_id = wlct_current_tenant_id())" in policies[table]

    def test_platform_scoped_set_matches_the_migrations_exclusion_list(self) -> None:
        excluded = re.search(
            r"-- Excluded by design.*?\n(.*?)-- Their tenant-bearing rows",
            MIGRATION_SQL,
            re.DOTALL,
        )
        assert excluded is not None, "the migration's exclusion list moved; update this test"
        listed = set(re.findall(r"^--\s+([a-z_]+)\s+\(", excluded.group(1), re.MULTILINE))
        assert PLATFORM_SCOPED_TABLES == frozenset(listed)
        assert listed.isdisjoint(covered_tables(ENABLE))

    def test_the_coverage_manifest_is_the_same_source_as_its_own_schema(self) -> None:
        manifest = coverage_manifest()
        assert manifest["schema"] == "part11-rls-coverage-v1"
        assert manifest["policyName"] == "tenant_isolation"
        assert manifest["functionName"] == "wlct_current_tenant_id"
        assert {entry["table"] for entry in manifest["excluded"]} == PLATFORM_SCOPED_TABLES


class TestProbeSqlAgreesWithTheLaw:
    def test_the_policy_query_names_the_policy_the_manifest_names(self) -> None:
        # The executor hard-codes the policy name because a permissive
        # policy with any other name would still pass a naive "some policy
        # exists" check while isolating nothing.
        assert f"policyname = '{coverage_manifest()['policyName']}'" in POLICY_POSTURE_SQL

    def test_the_guc_the_probe_reads_is_the_guc_the_api_sets(self) -> None:
        api = PRISMA_SERVICE.read_text(encoding="utf-8")
        assert f"set_config('{TENANT_GUC}'" in api
        assert f"position('{TENANT_GUC}' in p.qual)" in POLICY_POSTURE_SQL
        # and the policy predicate itself never mentions the GUC directly:
        # it goes through the STABLE function, which is the fail-closed half
        # of the design.
        assert TENANT_GUC not in migrated_tables(MIGRATION_SQL)["engine_orders"]

    def test_the_function_the_probe_trusts_is_the_one_the_migration_defines(self) -> None:
        # The STABLE-marked uuid function is the fail-closed half of Part 11
        # (nullif + a bare comparison => no GUC, no rows). If it is ever
        # redefined volatile, non-uuid, or without the nullif, the audit's
        # trust in `policy_exists`/`scoped` is misplaced, so pin its shape.
        definition = re.search(
            r"CREATE OR REPLACE FUNCTION wlct_current_tenant_id\(\)(.*?)\$\$;\n",
            MIGRATION_SQL,
            re.DOTALL,
        )
        assert definition is not None, "the tenant function's definition moved"
        body = definition.group(1)
        # exactly one opener inside the captured body; the terminator is
        # what the regex stopped at
        assert "AS $$" in body and body.count("$$") == 1
        assert "RETURNS uuid" in body
        assert "LANGUAGE sql STABLE" in body
        assert "nullif(current_setting('app.tenant_id', true), '')" in body

    def test_both_count_statements_parse_and_target_the_probe_tables(self) -> None:
        for table in PROBE_TABLES:
            scoped = SCOPED_COUNT_SQL.format(table=table)
            bare = BARE_COUNT_SQL.format(table=table)
            for statement in (scoped, bare):
                parsed = sqlglot_parse(statement, dialect="postgres")
                assert len(parsed) == 1
                assert f"FROM {table}" in statement
            assert scoped.endswith("WHERE tenant_id = $1")
            assert "$1" not in bare

    def test_the_catalogue_reads_are_single_statements(self) -> None:
        for statement in (ROLE_ATTRS_SQL, TABLE_EXISTS_SQL, POLICY_POSTURE_SQL):
            assert len(sqlglot_parse(statement, read="postgres")) == 1
        # to_regclass is how the store proves a table exists; the audit uses
        # exactly that one spelling, and takes the name as a bind parameter
        # rather than interpolating it.
        assert TABLE_EXISTS_SQL == "SELECT to_regclass($1) AS regclass"

    def test_the_probe_module_is_a_reader_full_stop(self) -> None:
        # The strongest claim Part 15 makes, and it is verified over the
        # shipped files rather than over a list of constants someone could
        # forget to add to. Scanned from the SYNTAX TREE: the strings that
        # matter are the ones the module could actually execute (module-level
        # assignments and calls' literal arguments). Prose is not SQL -
        # Part 14's router docstring says "ledger INSERT" as English, and a
        # scan that flagged that would train people to skip this test.
        for path, expect_sql in (
            (ENGINE_APP / "rls_probe.py", True),
            # the router holds NO statement at all: a route that starts
            # growing its own SQL is a route bypassing the executor's allow-
            # list check, and an empty set there is the finding, not a
            # missing-constant accident.
            (ENGINE_APP / "routers" / "enablement.py", False),
        ):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            candidates: list[str] = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    value = node.value.strip()
                    if _SQL_HEAD_RE.match(value):
                        candidates.append(value)
            if expect_sql:
                assert candidates, f"{path.name}: an SQL-shaped constant should exist"
            else:
                assert candidates == [], f"{path.name} grew SQL: {candidates[:1]}"
            for stmt in candidates:
                assert stmt.startswith("SELECT") or stmt == READ_ONLY, (
                    f"{path.name}: non-read statement {stmt[:60]!r}"
                )
        # and the executor's own SQL is a closed set: exactly the catalogue
        # reads plus the two counts plus the read-only flag
        executed = sorted(
            value
            for value in vars(rls_probe).values()
            if isinstance(value, str) and _SQL_HEAD_RE.match(value.strip())
        )
        assert executed == sorted(
            [
                BARE_COUNT_SQL,
                POLICY_POSTURE_SQL,
                READ_ONLY,
                ROLE_ATTRS_SQL,
                SCOPED_COUNT_SQL,
                TABLE_EXISTS_SQL,
                rls_probe.TABLE_POSTURE_SQL,
            ]
        )


class TestTheManifestPointsAtThisEngine:
    """The DR manifest's rlsEvidence block (Part 15) is the platform's ONE
    statement of "how old may an enablement claim be, and where is the
    record". It names this service's endpoint; a pointer that no longer
    points is the failure a test like this exists for, because nothing else
    in the repository reads the manifest and the route together."""

    MANIFEST = json.loads((ROOT / "docs" / "dr" / "manifest.json").read_text(encoding="utf-8"))

    def test_the_verifier_is_this_routes_path(self) -> None:
        evidence = self.MANIFEST["rlsEvidence"]
        paths = [route.path for route in enablement_router.router.routes]
        assert evidence["verifier"] in paths
        assert evidence["requiredGrade"] == "pass"

    def test_the_evidence_ledger_is_the_ledger_the_cli_writes(self) -> None:
        evidence = self.MANIFEST["rlsEvidence"]
        assert evidence["evidenceLedger"] == "docs/dr/rls-evidence.jsonl"
        # and the command it names exists (the manifest's own validator also
        # checks this; asserting it from the ENGINE side means a rename that
        # touches one file and not the other goes red in whichever suite runs)
        script = evidence["command"].split()[-1]
        assert (ROOT / script).exists(), script

    def test_the_shipped_evidence_window_is_inside_the_cores_bounds(self) -> None:
        # Boot validation makes this true for any deployment; the DEFAULT
        # must satisfy it too, or a stack started with no env override has an
        # audit that grades every run as stale.
        from app.config import Settings

        days = Settings.model_fields["EXECUTION_ENABLEMENT_MAX_AGE_DAYS"].default
        assert MIN_EVIDENCE_AGE_DAYS <= days <= MAX_EVIDENCE_AGE_DAYS

    def test_the_manifest_cadence_is_no_looser_than_the_default_window(self) -> None:
        # A weekly re-audit and a monthly freshness window are two opinions
        # about the same clock. The cadence may be TIGHTER (re-audit often),
        # never looser than what this service will accept as fresh: otherwise
        # the platform's own docs would age out the evidence on purpose and
        # every --check-rls after the first month is a false alarm.
        hours = self.MANIFEST["rlsEvidence"]["cadenceHours"]
        from app.config import Settings

        default_days = Settings.model_fields["EXECUTION_ENABLEMENT_MAX_AGE_DAYS"].default
        assert hours <= default_days * 24

    def test_the_declared_scope_is_the_probe_table_set(self) -> None:
        # Two directions, because an assurance can rot either way: the
        # manifest may not claim more than the executor can see, and the
        # executor may not quietly grow while the manifest still says
        # "engine plane only". The overclaim phrases are refused by the
        # validator; THIS pins the specific names.
        scope = self.MANIFEST["rlsEvidence"]["scope"]
        assert "engine plane" in scope
        for banned in ("all tables", "every table", "entire database"):
            assert banned not in scope
        for table in PROBE_TABLES:
            assert table in scope, f"{table} probed but not declared in rlsEvidence.scope"


class TestRouteSurfaceStaysInternal:
    def test_the_route_lives_only_on_the_internal_prefix(self) -> None:
        assert enablement_router.router.prefix == "/internal/v1"
        paths = [route.path for route in enablement_router.router.routes]
        assert paths == ["/internal/v1/enablement/audit"]

    def test_the_forwarding_surface_never_reaches_it(self) -> None:
        # The engine's internal plane is reachable by exactly one caller: the
        # API's worker client, whose path list IS the surface. Part 14 kept
        # retention out of it for the same reason Part 15 keeps enablement
        # out: an operator's audit is not a job a scheduler should be able to
        # enqueue, and a defence-posture report is not something a public
        # request can be made to trigger.
        client = ENGINE_CLIENT.read_text(encoding="utf-8")
        paths = set(re.findall(r"'(/internal/v1/[a-z0-9/_-]+)'", client))
        assert paths, "the client's internal paths moved shape; re-derive this"
        assert "/internal/v1/enablement/audit" not in paths
        assert "/internal/v1/retention/run" not in paths
        assert all("/internal/v1/" in p for p in paths)

    def test_the_coverage_bound_matches_the_cores_ceiling(self) -> None:
        field = EnablementRequest.model_fields["covered_expected"]
        bounds = {
            bound
            for meta in field.metadata
            for bound in (getattr(meta, "le", None), getattr(meta, "ge", None))
            if bound is not None
        }
        assert bounds == {0, MAX_PROBED_TABLES}


@pytest.mark.parametrize("table", PROBE_TABLES)
def test_each_probe_table_is_named_in_both_directions(table: str) -> None:
    assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY;' in ENABLE
    assert f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY;' in ENABLE
    assert f'CREATE POLICY tenant_isolation ON "{table}"' in MIGRATION_SQL
    assert BARE_COUNT_SQL.format(table=table).endswith(table)
