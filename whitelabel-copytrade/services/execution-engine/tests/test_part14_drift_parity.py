"""Part 14 drift traps: the retention ledger's three spellings, and the
deletion-target law across the whole engine app.

Nothing in a codebase is as trustworthy as a re-derivation. These tests
rebuild the ledger table's shape from three artifacts written by three
different steps (the migration SQL, the Prisma model, the executor's
INSERT constant) and refuse to pass unless they agree; and they scan
EVERY Python file in the service for a DELETE statement, because "only
the journal is deletable" is only a law if nobody can write the second
one without a test going red first.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse

from app import retention
from app.store_sql import TABLE_EVENTS

ROOT = Path(__file__).resolve().parents[3]
APP_DIR = ROOT / "services" / "execution-engine" / "app"
SCHEMA = ROOT / "apps" / "api" / "prisma" / "schema.prisma"


def part14_migration() -> str:
    return (
        ROOT
        / "apps"
        / "api"
        / "prisma"
        / "migrations"
        / "20260914160000_part14_retention_ledger"
        / "migration.sql"
    ).read_text(encoding="utf-8")


def part13_migration() -> str:
    return (
        ROOT
        / "apps"
        / "api"
        / "prisma"
        / "migrations"
        / "20260914120000_part13_execution_store"
        / "migration.sql"
    ).read_text(encoding="utf-8")


def migration_columns(text: str, table: str) -> list[str]:
    block = re.search(
        rf'CREATE TABLE "{table}" \((.*?)\n\);', text, re.DOTALL
    )
    assert block is not None, f"no CREATE TABLE {table} in the migration"
    # column definition lines ONLY (a bare "name" TYPE pattern): the
    # CONSTRAINT clause's quoted name must not masquerade as a column.
    return re.findall(
        r'^\s+"([a-z_]+)"\s+(?:UUID|BIGSERIAL|BIGINT|BOOLEAN|INTEGER|VARCHAR)',
        block.group(1),
        re.MULTILINE,
    )


def schema_model_columns(model: str) -> list[str]:
    block = re.search(
        rf"model {model} \{{(.*?)\n\}}", SCHEMA.read_text(encoding="utf-8"), re.DOTALL
    )
    assert block is not None, f"model {model} missing from schema.prisma"
    columns: list[str] = []
    for line in block.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("//", "@@", "tenant ", "order ")):
            continue
        name = stripped.split()[0]
        mapped = re.search(r'@map\("([a-z_]+)"\)', stripped)
        columns.append(mapped.group(1) if mapped else name)
    return columns


class TestLedgerShapeAgreement:
    def test_migration_prisma_and_executor_agree_on_the_columns(self) -> None:
        migration_cols = set(
            migration_columns(part14_migration(), "engine_retention_runs")
        )
        prisma_cols = set(schema_model_columns("ExecutionRetentionRun"))
        head = retention.INSERT_RUN_SQL.split("(", 1)[1].split(")", 1)[0]
        insert_cols = {c.strip() for c in head.split(",")}
        assert migration_cols == prisma_cols
        # The insert covers the table MINUS the identity column: every
        # other column is supplied explicitly, so no DEFAULT can silently
        # paper over a forgotten value (the table's single default,
        # `exhausted false`, is always written by the executor anyway).
        assert insert_cols == migration_cols - {"seq"}

    def test_index_names_match_across_artifacts(self) -> None:
        text = part14_migration()
        assert 'CREATE INDEX "engine_retention_runs_tenant_id_seq_idx"' in text
        schema_text = SCHEMA.read_text(encoding="utf-8")
        index_map = '@@index([tenantId, seq], map: "engine_retention_runs_tenant_id_seq_idx")'
        assert index_map in schema_text

    def test_instance_id_width_matches_the_instance_id_law(self) -> None:
        # config.py caps EXECUTION_INSTANCE_ID at 64 characters; the column
        # must fit the widest legal value or a long-but-legal id truncates
        # (or errors, on a stricter client) at ledger write time.
        assert '"instance_id" VARCHAR(64) NOT NULL' in part14_migration()

    def test_the_predicate_columns_exist_where_the_sql_assumes_them(self) -> None:
        old = part13_migration()
        assert '"occurred_at" BIGINT NOT NULL' in old  # events: the cutoff target
        assert '"terminal_at" BIGINT' in old  # orders: nullable, and IS NOT NULL-checked
        assert '"tenant_id" UUID NOT NULL' in old

    def test_migration_is_three_valid_postgres_statements(self) -> None:
        statements = sqlglot_parse(part14_migration(), read="postgres")
        assert len(statements) == 3
        kinds = [type(s).__name__ for s in statements]
        assert kinds == ["Create", "Create", "Alter"]

    def test_tenant_fk_is_restrict_like_every_engine_table(self) -> None:
        fk = (
            'ALTER TABLE "engine_retention_runs" ADD CONSTRAINT '
            '"engine_retention_runs_tenant_id_fkey"\n'
            '    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT'
        )
        assert fk in part14_migration()


class TestDeletionTargetLaw:
    def test_the_whole_app_deletes_from_exactly_one_table(self) -> None:
        targets: set[str] = set()
        for path in sorted(APP_DIR.rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            targets.update(re.findall(r"DELETE FROM ([a-z_]+)", text))
        assert targets == {TABLE_EVENTS}

    def test_the_core_law_names_the_tables_this_executor_respects(self) -> None:
        from wlct_trading.retention import (
            IMMUTABLE_RECORD_TABLES,
            PRUNABLE_JOURNAL,
            RETENTION_LEDGER_TABLE,
        )

        assert PRUNABLE_JOURNAL == TABLE_EVENTS
        assert RETENTION_LEDGER_TABLE == retention.TABLE_RETENTION_RUNS
        assert retention.TABLE_RETENTION_RUNS not in IMMUTABLE_RECORD_TABLES
        # the executor's module carries no DELETE constant touching a
        # table in the immutable set (belt over the belt):
        for name, value in vars(retention).items():
            if isinstance(value, str) and value.startswith("DELETE FROM"):
                for table in IMMUTABLE_RECORD_TABLES:
                    assert table not in value, f"{name} deletes from immutable {table}"


class TestRlsCoverageIncludesTheLedger:
    def test_coverage_json_lists_the_table_and_model(self) -> None:
        coverage = json.loads(
            (ROOT / "apps" / "api" / "prisma" / "rls" / "rls_coverage.json").read_text(
                encoding="utf-8"
            )
        )
        covered = {entry["table"]: entry["model"] for entry in coverage["covered"]}
        assert covered.get(retention.TABLE_RETENTION_RUNS) == "ExecutionRetentionRun"
        assert coverage["covered"] and len(covered) == len(coverage["covered"])

    def test_enable_and_disable_mention_the_ledger_symmetrically(self) -> None:
        rls_dir = ROOT / "apps" / "api" / "prisma" / "rls"
        enable = (rls_dir / "enable.sql").read_text(encoding="utf-8")
        disable = (rls_dir / "disable.sql").read_text(encoding="utf-8")
        table = retention.TABLE_RETENTION_RUNS
        assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY;' in enable
        assert f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY;' in enable
        assert f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY;' in disable

    @pytest.mark.parametrize("table", ["engine_retention_runs"])
    def test_part11_policy_migration_covers_the_new_table(self, table: str) -> None:
        part11 = (
            ROOT
            / "apps"
            / "api"
            / "prisma"
            / "migrations"
            / "20260923090000_part11_row_level_security"
            / "migration.sql"
        ).read_text(encoding="utf-8")
        assert f'CREATE POLICY tenant_isolation ON "{table}"' in part11
