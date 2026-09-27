"""Part 13: cross-language drift trap - store SQL vs the owning schema.

The Python service builds statements against tables whose DDL lives in the
Node world (apps/api/prisma). That split is a drift invitation, so this
file closes it mechanically: every column the store references must exist
in BOTH schema.prisma (model + @@map + @map spellings) and the Part 13
migration SQL, every conflict-target must name a constraint that exists,
and the bounded column widths must cover the wire validators that feed
them. Add a column to one side only and a test goes red here, not in a
stack trace at 3am.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse

from app import store_sql

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = ROOT / "apps" / "api" / "prisma" / "schema.prisma"
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql"
)


def _model_block(text: str, model: str) -> str:
    match = re.search(rf"^model {model} \{{(.*?)^\}}", text, re.DOTALL | re.MULTILINE)
    assert match is not None, f"model {model} missing from schema.prisma"
    return match.group(1)


def _create_table_block(sql: str, table: str) -> str:
    match = re.search(
        rf'CREATE TABLE "{table}" \((.*?)\n\);', sql, re.DOTALL
    )
    assert match is not None, f"CREATE TABLE {table} missing from the migration"
    return match.group(1)


@pytest.fixture(scope="module")
def schema_text() -> str:
    return SCHEMA.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def migration_text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


class TestOrdersColumnsExistInBothArtifacts:
    def test_every_store_column_is_a_migration_column(self, migration_text: str) -> None:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        declared = set(re.findall(r'^\s+"([a-z_]+)"', block, re.MULTILINE))
        missing = set(store_sql._ORDER_COLUMNS) - declared
        assert not missing, (
            f"store references columns the migration never creates: {sorted(missing)}"
        )

    def test_every_migration_order_column_is_known_to_the_store(self, migration_text: str) -> None:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        declared = set(re.findall(r'^\s+"([a-z_]+)"', block, re.MULTILINE))
        unknown = declared - set(store_sql._ORDER_COLUMNS)
        # A column in the table the store does not know is also drift - it
        # will silently never be written by this adapter.
        assert not unknown, f"migration columns the store codec does not cover: {sorted(unknown)}"

    def test_schema_column_set_equals_the_store_column_set(self, schema_text: str) -> None:
        """Parse each field's effective column name (@map wins, else field
        name) and demand EXACT set equality with the SQL codec - in both
        directions, so a renamed, added or dropped column on either side
        fails here."""
        block = _model_block(schema_text, "ExecutionOrder")
        columns: set[str] = set()
        for line in block.splitlines():
            line = line.strip()
            match = re.match(r"(\w+)\s+\S+", line)
            if match is None or line.startswith("//") or line.startswith("@@"):
                continue
            mapped = re.search(r'@map\("([^"]+)"\)', line)
            columns.add(mapped.group(1) if mapped else match.group(1))
        declared = {c for c in columns if not c.startswith(("tenant ", "events ", "fills "))}
        # relation fields (tenant, events, lists) name no column
        declared -= {"tenant", "events", "fills"}
        assert declared == set(store_sql._ORDER_COLUMNS), (
            f"only-in-schema: {sorted(declared - set(store_sql._ORDER_COLUMNS))} "
            f"only-in-sql: {sorted(set(store_sql._ORDER_COLUMNS) - declared)}"
        )


class TestChildTablesParity:
    def test_fill_statement_columns_match_the_migration(self, migration_text: str) -> None:
        insert = store_sql._RECORD_FILL_SQL
        sql_columns = insert.split("(", 1)[1].split(")", 1)[0]
        referenced = {c.strip() for c in sql_columns.split(",")}
        declared = set(
            re.findall(
                r'^\s+"([a-z_]+)"',
                _create_table_block(migration_text, store_sql.TABLE_FILLS),
                re.MULTILINE,
            )
        )
        assert referenced - {"seq"} <= declared

    def test_event_statement_columns_match_the_migration(self, migration_text: str) -> None:
        insert = store_sql._RECORD_EVENT_SQL
        sql_columns = insert.split("(", 1)[1].split(")", 1)[0]
        referenced = {c.strip() for c in sql_columns.split(",")}
        declared = set(
            re.findall(
                r'^\s+"([a-z_]+)"',
                _create_table_block(migration_text, store_sql.TABLE_EVENTS),
                re.MULTILINE,
            )
        )
        assert referenced - {"seq"} <= declared

    def test_select_lists_use_only_declared_child_columns(self, migration_text: str) -> None:
        for table, sql in (
            (store_sql.TABLE_EVENTS, store_sql._LIST_EVENTS_SQL),
            (store_sql.TABLE_FILLS, store_sql._LIST_FILLS_SQL),
        ):
            selected = {
                c.strip() for c in sql.split("SELECT", 1)[1].split("FROM", 1)[0].split(",")
            }
            declared = set(
                re.findall(
                    r'^\s+"([a-z_]+)"',
                    _create_table_block(migration_text, table),
                    re.MULTILINE,
                )
            )
            assert selected <= declared, (
                f"{table}: selected {sorted(selected - declared)} not in migration"
            )


class TestLiteralsAgreeWithTheParamsTuple:
    """The SQL text is literal (no interpolation); the tuple is the param
    order. These glue the two so neither can drift from the migration."""

    def test_insert_column_list_equals_the_params_tuple(self) -> None:
        assert tuple(c.strip() for c in store_sql._ORDER_COLUMN_LIST.split(",")) == (
            store_sql._ORDER_COLUMNS
        )

    def test_select_prefix_reads_the_same_columns_in_order(self) -> None:
        head = store_sql._ORDER_SELECT.split("SELECT ", 1)[1].split(", COALESCE", 1)[0]
        assert tuple(c.strip().removeprefix("o.") for c in head.split(",")) == (
            store_sql._ORDER_COLUMNS
        )

    def test_upsert_assigns_every_column_but_the_composite_key(self) -> None:
        assign_part = store_sql._SAVE_UPSERT_SQL.split("DO UPDATE SET ", 1)[1]
        assigned = tuple(
            piece.split(" = ")[0].strip() for piece in assign_part.split(", ")
        )
        assert assigned == tuple(
            c for c in store_sql._ORDER_COLUMNS if c not in ("tenant_id", "order_id")
        )

    def test_table_name_constants_appear_where_sql_hardcodes_them(self) -> None:
        # the constants exist (pg_store's preflight uses them); the SQL
        # literals must name exactly those tables.
        assert store_sql.TABLE_ORDERS == "engine_orders"
        assert store_sql.TABLE_EVENTS == "engine_order_events"
        assert store_sql.TABLE_FILLS == "engine_order_fills"
        for sql in (
            store_sql.RESERVE_INSERT_SQL,
            store_sql._SAVE_UPSERT_SQL,
            store_sql._SELECT_BY_ORDER_SQL,
            store_sql._SET_RECON_SQL,
            store_sql._GET_RECON_SQL,
        ):
            assert "engine_orders" in sql
        assert store_sql.TABLE_EVENTS in store_sql._RECORD_EVENT_SQL
        assert store_sql.TABLE_FILLS in store_sql._RECORD_FILL_SQL


class TestConstraintsTheSqlReliesOn:
    def test_reservation_needs_the_tenant_client_unique(
        self, migration_text: str, schema_text: str
    ) -> None:
        assert (
            'CREATE UNIQUE INDEX "engine_orders_tenant_client_key" '
            'ON "engine_orders"("tenant_id", "client_order_id")'
            in migration_text
        )
        assert "@@unique([tenantId, clientOrderId]" in _model_block(schema_text, "ExecutionOrder")

    def test_fill_replay_protection_needs_the_tenant_fill_unique(
        self, migration_text: str, schema_text: str
    ) -> None:
        assert (
            'CREATE UNIQUE INDEX "engine_order_fills_tenant_fill_key" '
            'ON "engine_order_fills"("tenant_id", "fill_id")'
            in migration_text
        )
        assert "@@unique([tenantId, fillId]" in _model_block(schema_text, "ExecutionOrderFill")

    def test_open_order_predicate_needs_the_composite_index(self, migration_text: str) -> None:
        assert (
            'CREATE INDEX "engine_orders_tenant_id_account_id_status_idx" '
            'ON "engine_orders"("tenant_id", "account_id", "status")'
            in migration_text
        )

    def test_child_fk_composite_targets_the_composite_pk(self, migration_text: str) -> None:
        for table in (store_sql.TABLE_EVENTS, store_sql.TABLE_FILLS):
            pattern = (
                rf'ALTER TABLE "{table}" ADD CONSTRAINT .*FOREIGN KEY \("tenant_id", "order_id"\) '
                rf'REFERENCES "engine_orders"\("tenant_id", "order_id"\)'
            )
            assert re.search(pattern, migration_text, re.DOTALL), f"{table} lost its composite FK"

    def test_parent_identity_is_composite_never_global(
        self, schema_text: str, migration_text: str
    ) -> None:
        assert "@@id([tenantId, orderId])" in _model_block(schema_text, "ExecutionOrder")
        assert (
            'CONSTRAINT "engine_orders_pkey" PRIMARY KEY ("tenant_id", "order_id")'
            in migration_text
        )


class TestWidthLawsMatchTheWireValidators:
    """Column bounds must cover what the service's wire schemas accept.

    Parsed from the TEXT of app/schemas.py rather than imported Field
    objects: the point is that the two declarations - one enforced at the
    HTTP boundary, one at the table - stay consistent, and text-scan says
    so even for fields declared inside request models.
    """

    WIRE = ROOT / "services" / "execution-engine" / "app" / "schemas.py"

    def _wire_bound(self, field: str) -> int:
        text = self.WIRE.read_text(encoding="utf-8")
        match = re.search(rf'"{field}".*?max_length=(\d+)', text) or re.search(
            rf"{field}: str.*?max_length=(\d+)", text
        )
        assert match is not None, (
            f"{field} has no max_length on the wire schema anymore - "
            "re-examine this parity test"
        )
        return int(match.group(1))

    def _column_width(self, migration_text: str, column: str) -> int:
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        match = re.search(rf'"{column}" VARCHAR\((\d+)\)', block)
        assert match is not None, f"{column} is not a bounded column in the migration"
        return int(match.group(1))

    def test_identifiers_fit(self, migration_text: str) -> None:
        for column in ("order_id", "client_order_id", "symbol"):
            assert self._column_width(migration_text, column) >= self._wire_bound(column), column

    def test_tenant_law_is_the_uuid_check_not_a_width(self, migration_text: str) -> None:
        # tenant_id has a wire bound (64) but a DB TYPE (uuid): the parity
        # there is the store's canonical-UUID refusal, asserted in the
        # store suite; the migration must simply keep the column typed.
        block = _create_table_block(migration_text, store_sql.TABLE_ORDERS)
        assert '"tenant_id" UUID NOT NULL' in block


class TestTenantGucAcrossPlanes:
    """The RLS contract has TWO callers: Node's PrismaService.withTenantRls
    and this store's _TenantTransaction. If either side edits the statement
    the other's rows vanish (policies match on the GUC), and the break is
    silent until enablement day. Python's test is the one that reads the
    TypeScript source - the direction that nobody would think to run
    during a Node refactor."""

    PRISMA_SERVICE = (
        ROOT / "apps" / "api" / "src" / "infrastructure" / "prisma" / "prisma.service.ts"
    )

    def test_node_sets_the_same_guc_the_store_sets(self) -> None:
        source = self.PRISMA_SERVICE.read_text(encoding="utf-8")
        match = re.search(
            r"set_config\('app\.tenant_id', \$\{tenantId\}, (true|false)\)", source
        )
        assert match is not None, (
            "PrismaService.withTenantRls changed its set_config call shape; "
            "re-derive PostgresOrderStore's SET_TENANT_SQL to match, or the "
            "generated policies silently admit different rows per plane"
        )
        assert match.group(1) == "true", "withTenantRls is no longer transaction-local"
        assert store_sql.SET_TENANT_SQL == "SELECT set_config('app.tenant_id', $1, true)"

    def test_migration_function_reads_the_same_guc(self, migration_text: str) -> None:
        part11 = (
            ROOT / "apps" / "api" / "prisma" / "migrations"
            / "20260923090000_part11_row_level_security" / "migration.sql"
        ).read_text(encoding="utf-8")
        assert "current_setting('app.tenant_id', true)" in part11
        assert 'CREATE OR REPLACE FUNCTION wlct_current_tenant_id() RETURNS uuid' in part11
        # the engine tables are in the covered list of the coverage JSON the
        # generator emits (auto-extension, checked here as the dependency
        # the store's design relies on).
        coverage = json.loads(
            (ROOT / "apps" / "api" / "prisma" / "rls" / "rls_coverage.json").read_text(
                encoding="utf-8"
            )
        )
        covered = {entry["table"] for entry in coverage["covered"]}
        assert {store_sql.TABLE_ORDERS, store_sql.TABLE_EVENTS, store_sql.TABLE_FILLS} <= covered


class TestSqlglotMigrationParses:
    def test_migration_file_is_valid_postgres(self, migration_text: str) -> None:
        # No importorskip: the dependency is declared in requirements-dev.txt, and
        # an optional import here would turn "the parser is missing" into a green
        # run that tested nothing - which is the failure mode Part 14's own drift
        # test avoided by importing at module level. A missing dep must be a loud
        # collection error, not a skip that reads as assurance.
        statements = [s for s in sqlglot_parse(migration_text, read="postgres") if s is not None]
        kinds = {type(s).__name__ for s in statements}
        assert {"Create", "Alter"} <= kinds
        assert len(statements) == 13  # 3 tables, 7 indexes, 3 FK alters
