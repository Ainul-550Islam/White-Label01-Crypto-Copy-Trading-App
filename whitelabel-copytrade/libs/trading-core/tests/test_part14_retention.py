"""Part 14: the retention law, pure.

These tests are the reason the deletion executor can be small: every
judgment call - what counts as settled, where the cutoff sits, which
tables must never be touched, what configuration nonsense cannot exist -
lives in ``wlct_trading.retention`` and is pinned HERE. The engine-side
tests then re-pin the SQL spelling of the same laws (drift parity), so a
change to either half goes red somewhere, not silently in production.

The clock law is tested as a structural fact too: a module whose cutoff
arithmetic is correct but which peeks at the wall clock inside a deletion
decision is nondeterministic exactly where determinism was the point. The
source scan that pins "no time imports in the law" costs nothing and
outlives every refactor.
"""

from __future__ import annotations

import ast
import dataclasses
from pathlib import Path
from typing import Any

import pytest

from wlct_trading.retention import (
    IMMUTABLE_RECORD_TABLES,
    MAX_BATCHES,
    MAX_BATCH_ROWS,
    MAX_EVENT_RETENTION_DAYS,
    MIN_BATCH_ROWS,
    MIN_EVENT_RETENTION_DAYS,
    PRUNABLE_JOURNAL,
    RETENTION_LEDGER_TABLE,
    RetentionError,
    RetentionPolicy,
)

US_PER_DAY = 86_400 * 1_000_000


def policy(days: int = 90, batch_rows: int = 2_000, max_batches: int = 50) -> RetentionPolicy:
    return RetentionPolicy(
        event_retention_days=days,
        batch_rows=batch_rows,
        max_batches=max_batches,
    )


class TestPolicyConstructionLaws:
    def test_default_shape_is_accepted(self) -> None:
        p = policy()
        assert p.event_retention_days == 90
        assert p.batch_rows == 2_000
        assert p.max_batches == 50

    @pytest.mark.parametrize("days", [0, -1, -36_500])
    def test_zero_or_negative_retention_cannot_exist(self, days: int) -> None:
        # The gun that erases every settled journal row is refused at
        # construction, not at first run.
        with pytest.raises(RetentionError, match="erases"):
            policy(days=days)

    def test_retention_beyond_a_century_is_refused_as_a_lie(self) -> None:
        assert MIN_EVENT_RETENTION_DAYS == 1
        assert MAX_EVENT_RETENTION_DAYS == 36_500
        policy(days=MAX_EVENT_RETENTION_DAYS)  # the boundary itself is legal
        with pytest.raises(RetentionError, match="pretends retention exists"):
            policy(days=MAX_EVENT_RETENTION_DAYS + 1)

    @pytest.mark.parametrize("batch_rows", [0, -5, MAX_BATCH_ROWS + 1])
    def test_batch_size_outside_the_lock_budget_is_refused(self, batch_rows: int) -> None:
        with pytest.raises(RetentionError, match="batch_rows"):
            policy(batch_rows=batch_rows)
        assert MIN_BATCH_ROWS == 1 and MAX_BATCH_ROWS == 10_000

    @pytest.mark.parametrize("max_batches", [0, -1, MAX_BATCHES + 1])
    def test_uncapped_run_is_refused(self, max_batches: int) -> None:
        with pytest.raises(RetentionError, match="max_batches"):
            policy(max_batches=max_batches)

    @pytest.mark.parametrize("value", [True, False, "90", 90.0, None])
    def test_only_plain_ints_no_bools_no_floats_no_strings(self, value: Any) -> None:
        # ``True`` as a one-day retention would be a Python joke with
        # database consequences; the float and str spellings mean a config
        # parser that never validated anything.
        with pytest.raises(RetentionError, match="plain int"):
            RetentionPolicy(event_retention_days=value, batch_rows=2, max_batches=2)

    def test_policy_is_immutable_value(self) -> None:
        p = policy()
        with pytest.raises(dataclasses.FrozenInstanceError):
            p.event_retention_days = 1
        assert not hasattr(p, "__dict__")  # slots: no quietly mutable bag


class TestCutoffArithmetic:
    def test_cutoff_is_days_back_in_micros(self) -> None:
        p = policy(days=90)
        now = 1_757_000_000_000_000  # a Tuesday in epoch micros
        assert p.event_cutoff_us(now) == now - 90 * US_PER_DAY

    def test_span_property_agrees_with_seconds_times_micros(self) -> None:
        # Recomputed through a DIFFERENT unit path on purpose: the class of
        # bug this catches is the unit slip (ms vs us vs s) that a
        # same-unit test cannot see.
        p = policy(days=13)
        assert p.event_cutoff_span_us == 13 * 86_400 * 1_000_000

    @pytest.mark.parametrize("now", [0, -1, 500])
    def test_pre_epoch_now_prunes_nothing_and_raises_nothing(self, now: int) -> None:
        # An absurd clock is the caller's bug; the SAFE outcome (prune
        # nothing, cutoff in the past-negative) is what a retention module
        # owes it. Loudness here would tempt someone to "fix" it with max().
        p = policy()
        assert p.event_cutoff_us(now) < 0

    @pytest.mark.parametrize("now", [True, "1", 2.5])
    def test_now_must_be_a_plain_int(self, now: Any) -> None:
        with pytest.raises(RetentionError, match="now_us"):
            policy().event_cutoff_us(now)


class TestPrunablePredicate:
    """Law 2 (the order keeps its whole story or none of it) row by row."""

    NOW = 100 * US_PER_DAY  # so a 90-day cutoff lands at day 10
    CUTOFF = NOW - 90 * US_PER_DAY

    def test_open_order_events_are_never_prunable(self) -> None:
        p = policy()
        assert p.event_is_prunable(
            order_terminal_at_us=None,
            event_occurred_at_us=0,  # an ancient event does not matter
            now_us=self.NOW,
        ) is False

    def test_recently_settled_order_keeps_its_whole_journal(self) -> None:
        # terminal_at AFTER the cutoff: the events may individually be old,
        # but the story just ended - deleting mid-investigation is the
        # exact failure this predicate exists to make unspellable.
        p = policy()
        assert p.event_is_prunable(
            order_terminal_at_us=self.CUTOFF + 1,
            event_occurred_at_us=0,
            now_us=self.NOW,
        ) is False

    def test_recent_event_under_old_settled_order_is_kept(self) -> None:
        p = policy()
        assert p.event_is_prunable(
            order_terminal_at_us=0,
            event_occurred_at_us=self.CUTOFF + 1,
            now_us=self.NOW,
        ) is False

    def test_both_older_than_the_cutoff_is_prunable(self) -> None:
        p = policy()
        assert p.event_is_prunable(
            order_terminal_at_us=self.CUTOFF - 1,
            event_occurred_at_us=self.CUTOFF - 1,
            now_us=self.NOW,
        ) is True

    def test_boundary_is_strictly_less_than(self) -> None:
        # An event exactly AT the cutoff is retained: the comparison is
        # `< cutoff`, and the engine SQL uses the same operator - an
        # `<=` drift on either side would silently widen every run by one
        # row-age bucket.
        p = policy()
        assert p.event_is_prunable(
            order_terminal_at_us=self.CUTOFF,
            event_occurred_at_us=self.CUTOFF,
            now_us=self.NOW,
        ) is False


class TestNamedLaws:
    def test_only_the_journal_is_prunable(self) -> None:
        assert PRUNABLE_JOURNAL == "engine_order_events"

    def test_the_money_tables_are_named_immutable(self) -> None:
        assert set(IMMUTABLE_RECORD_TABLES) == {"engine_orders", "engine_order_fills"}
        assert PRUNABLE_JOURNAL not in IMMUTABLE_RECORD_TABLES
        assert RETENTION_LEDGER_TABLE == "engine_retention_runs"

    def test_the_ledger_of_deletions_is_not_deletable_by_this_law(self) -> None:
        # The ledger is neither the journal (nothing prunes it) nor
        # otherwise named; what this pins is that the module carries NO
        # other engine_* string constant to reach for - the vocabulary of
        # deletable names is exactly {journal} plus a ledger that no
        # statement in this part deletes from.
        import wlct_trading.retention as mod

        table_constants = [
            value
            for name, value in vars(mod).items()
            if name.isupper() and isinstance(value, str) and value.startswith("engine_")
        ]
        assert sorted(table_constants) == sorted([PRUNABLE_JOURNAL, RETENTION_LEDGER_TABLE])


class TestModulePurity:
    """Structural pins, taken from the syntax tree rather than the prose
    (docstrings TALK about ``datetime.now`` and the status vocabulary in
    order to forbid them - an AST scan sees only the code that does):
    the law module must not be able to see a clock, a database driver, or
    the terminal-status set it deliberately does NOT re-derive.
    """

    SOURCE = Path(__file__).resolve().parents[1] / "wlct_trading" / "retention.py"

    def _code_names(self) -> tuple[set[str], set[str]]:
        tree = ast.parse(self.SOURCE.read_text(encoding="utf-8"))
        imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module)
        names = {
            node.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
        }
        attributes = {
            node.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute)
        }
        return imports, names | attributes

    def test_no_clock_no_io_no_status_vocabulary(self) -> None:
        imports, mentions = self._code_names()
        for forbidden in ("time", "datetime", "asyncpg", "psycopg", "sqlite3", "os"):
            assert forbidden not in imports, f"retention law imported {forbidden!r}"
        # The set this law refuses to re-derive, and the wall-clock calls
        # that would betray the injected-now discipline.
        assert "TERMINAL_ORDER_STATUSES" not in mentions
        assert not {"now", "time", "utcnow", "monotonic"} & mentions

    def test_injected_clock_is_the_only_time_source(self) -> None:
        # Grep-level counterpart: `now_us: int` is the parameter that
        # carries time in, and no default anywhere constructs a value that
        # could stand in for "now".
        source = self.SOURCE.read_text(encoding="utf-8")
        assert "now_us: int" in source
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                assert all(d is None for d in node.args.defaults), node.name
