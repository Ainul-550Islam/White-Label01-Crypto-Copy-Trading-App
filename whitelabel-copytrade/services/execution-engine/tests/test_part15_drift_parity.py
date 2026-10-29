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
from typing import cast

import pytest
from sqlglot import parse as sqlglot_parse
from starlette.routing import Route
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
MIGRATION_DIRECTORY = ROOT / "apps" / "api" / "prisma" / "migrations"
# The policy history is THREE stamp families: the part11 generations, the
# gap-close generations the same generator emits when only a few tables are
# missing policies, and the batch-03 coverage reconcile generation
# (20261228000000_rls_coverage_reconcile), which scripts/gen_part11_rls.py
# already reads as prior policy history when picking up new tables.
# Stamp-prefixed directory names sort chronologically, so a
# plain path sort keeps the concatenation in application order.
MIGRATION_FILES = sorted(
    [
        *MIGRATION_DIRECTORY.glob("*_part11_row_level_security/migration.sql"),
        *MIGRATION_DIRECTORY.glob("*_rls_policy_gap_close/migration.sql"),
        *MIGRATION_DIRECTORY.glob("*_rls_coverage_reconcile/migration.sql"),
    ]
)
assert MIGRATION_FILES, "the Part 11 RLS migration history is missing"
PRISMA_SERVICE = ROOT / "apps" / "api" / "src" / "infrastructure" / "prisma" / "prisma.service.ts"
ENGINE_APP = ROOT / "services" / "execution-engine" / "app"
ENGINE_CLIENT = (
    ROOT / "apps" / "api" / "src" / "modules" / "worker" / "engine-internal.client.ts"
)


def rls_artifact(name: str) -> str:
    return (RLS_DIR / name).read_text(encoding="utf-8")


def coverage_manifest() -> dict[str, object]:
    return cast(
        "dict[str, object]",
        json.loads((RLS_DIR / "rls_coverage.json").read_text(encoding="utf-8")),
    )


def manifest_tables(manifest: dict[str, object], key: str) -> list[str]:
    """The table names under one manifest key, shape-asserted.

    The manifest is generated JSON; reading it through ``object`` and
    asserting the shape here keeps a malformed regeneration a test failure
    with a location, not an AttributeError three asserts later.
    """
    entries = manifest[key]
    assert isinstance(entries, list), f"manifest[{key!r}] is not a list"
    tables: list[str] = []
    for entry in entries:
        assert isinstance(entry, dict), f"manifest[{key!r}] entry is not an object"
        table = entry.get("table")
        assert isinstance(table, str), f"manifest[{key!r}] entry has no table name"
        tables.append(table)
    return tables


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
MIGRATION_SQL = "\n".join(path.read_text(encoding="utf-8") for path in MIGRATION_FILES)


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
        assert len(covered_tables(ENABLE)) == len(manifest_tables(manifest, "covered"))
        assert set(manifest_tables(manifest, "covered")) == set(covered_tables(ENABLE))
        # The historical count reached 182 after the regeneration that followed
        # the domain-persistence migration (20260923085000): the previous 161
        # (the Part 28 set of 153 at stamp 20260923090000 plus the eight
        # developer_* tenant tables from 20260923080000) plus the 21
        # tenant-owned billing, governance and partner tables. Six new
        # platform-scoped tables (nullable tenant_id) joined the exclusion list.
        # Part 11 production SSO (20260923089000) added four tenant-owned tables
        # and brought coverage to 186; the two developer-platform tables in
        # migration 20261006120000 brought it to 188, UserPositionLimit
        # (20261007130000) to 189, OutboxEvent (20261008130000) to 190, and
        # partner_referral_abuse_reviews (20261115100000) to 191 - the referral
        # abuse review queue is tenant-owned, so the generator picked it up on the
        # next rerun and enable.sql, disable.sql and rls_coverage.json all moved
        # together. The exclusion list remains 30. The merged batch03+batch04
        # schema (20261201000000, 20261215000000) then added eight tenant-owned
        # tables - copy_budgets, withdrawal_destinations, login_devices,
        # account_recovery_tokens, public_share_links, profit_share_statements,
        # user_preferences, policy_acceptances - for 199, and fee_schedule_versions
        # (nullable tenant_id: platform-published schedule versions) took
        # exclusions to 31; the regeneration at stamp 20261220000000 picked all
        # of them up. Batch 03's reconcile stamp (20261228000000) then added the
        # five tenant-owned tables the additive sweeps had missed -
        # copy_budget_reduction_intents, developer_mutation_intents,
        # governance_audit_export_intents, mobile_push_attempts and
        # mobile_push_devices - for 204; the exclusion list stays 31, and the
        # reconcile generation carries their policies, so no enabled table is
        # without one. The current count is pinned
        # rather than derived because the pairing tests must detect disagreement
        # among enable.sql, disable.sql, rls_coverage.json and the stated count;
        # a pin that is stale by exactly one table is the signal that a migration
        # added a tenant table without anyone re-reading this file.
        assert len(covered_tables(ENABLE)) == 204
        assert len(manifest_tables(coverage_manifest(), "excluded")) == 31

    def test_every_covered_table_has_a_policy_in_the_migration_history(self) -> None:
        policies = migrated_tables(MIGRATION_SQL)
        for table in covered_tables(ENABLE):
            assert table in policies, f"{table} is enabled but has no policy"
            assert "USING (tenant_id = wlct_current_tenant_id())" in policies[table]
            assert "WITH CHECK (tenant_id = wlct_current_tenant_id())" in policies[table]

    def test_platform_scoped_set_matches_the_migrations_exclusion_list(self) -> None:
        # Every generated migration restates the WHOLE exclusion list as of
        # its stamp, so the newest block in the history is the current
        # statement and the earlier ones are superseded generations of it.
        blocks = re.findall(
            r"-- Excluded by design.*?\n(.*?)-- Their tenant-bearing rows",
            MIGRATION_SQL,
            re.DOTALL,
        )
        assert blocks, "the migration's exclusion list moved; update this test"
        listed = set(re.findall(r"^--\s+([a-z_]+)\s+\(", blocks[-1], re.MULTILINE))
        assert PLATFORM_SCOPED_TABLES == frozenset(listed)
        assert listed.isdisjoint(covered_tables(ENABLE))

    def test_the_coverage_manifest_is_the_same_source_as_its_own_schema(self) -> None:
        manifest = coverage_manifest()
        assert manifest["schema"] == "part11-rls-coverage-v1"
        assert manifest["policyName"] == "tenant_isolation"
        assert manifest["functionName"] == "wlct_current_tenant_id"
        assert set(manifest_tables(manifest, "excluded")) == PLATFORM_SCOPED_TABLES


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
        paths = [
            route.path
            for route in enablement_router.router.routes
            if isinstance(route, Route)
        ]
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
        paths = [
            route.path
            for route in enablement_router.router.routes
            if isinstance(route, Route)
        ]
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
