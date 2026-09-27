# Part 14 - journal retention: full source handover

> **Risk note, unchanged and deliberately unsoftened:** Part 14 puts the
> platform's first DELETE near money records, and every layer is shaped by
> that - one deletable table under an app-wide test, apply dark behind both
> the engine's config and the script's flag, and a run ledger that nothing
> prunes. Live venue transmission remains refused by startup code; this
> part neither advances nor weakens that refusal.

Complete content of every file created or modified by Part 14. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their Part-13 state is recoverable
from `docs/PART13_HANDOVER_FULL_SOURCE.md` (and earlier documents for files
that predate it), which list every one of them with its then-current line
count - `apps/api/prisma/schema.prisma` included, so its baseline is the
Part 13 emission (4,139 lines) and the delta below is real, not estimated.

All quality gates at generation time (2026-09-14):

* `cd libs/trading-core && python3 -m pytest -q` -> **1377 passed** (+35
  Part-14 retention-law tests); `python3 -m ruff check wlct_trading tests`
  -> green; `python3 -m mypy wlct_trading` -> **no issues, 144 source
  files**, zero suppressions in any part file (the sweep below audits it).
* `cd services/execution-engine && python3 -m pytest -q` -> **133 passed,
  12 skipped** (all seven Part-13 live tests plus the five Part-14 live
  tests, skipping BY NAME without `EXECUTION_TEST_POSTGRES_DSN` - the
  honest shape stated in docs/PART14_RETENTION.md section 9);
  `python3 -m ruff check app tests` -> green; `python3 -m mypy app` ->
  **no issues, 14 source files**.
* `cd apps/api && npx jest --silent` -> **386 passed / 17 suites** (the
  worker side needed NO change for this part - and its rls-coverage spec
  RE-DERIVES the schema, which is why it went from 41 to 42 covered tables
  without a single spec edit); `npx tsc --noEmit` -> 0 errors;
  `npx eslint src --max-warnings 0` -> clean; `npx prisma validate` ->
  valid.
* `node --test scripts/` -> **37 passed / 0 failed** (+11 CLI tests,
  including full-process runs against an in-test fake engine and the
  token-never-printed assertion); `node scripts/dr-manifest.mjs --check`
  unchanged and green.
* `python3 scripts/gen_part11_rls.py` regenerated all four artifacts for
  42 covered tables (the ledger picked up with NO generator change),
  byte-identical across consecutive runs.
* Sibling Python services re-verified untouched: trading-engine **43
  passed**, market-data **19 passed**.
* Line ledger (measured, this script): Part 14 shipped **3,531 lines** -
  3,265 across the 12 new files (this generator included) and +266 across
  the 17 modified files (delta against the newest handover document that
  lists each file - the regenerated RLS artifacts and the four doc edits
  keep that number modest; growth here is concentrated in law and tests,
  which is the correct place for a part whose production surface is one
  module, one router and one script). Whole-tree counts under the standing
  rule set (everything except node_modules/dist/lockfiles, `docs/source/`,
  and the PART*HANDOVER documents): **179,979 source lines**; adding the
  full docs tree (narrative documents and the regenerable docs/source
  views, minus every handover dump): **527,314**; prior parts' totals used
  the same rule
  (176,806 at Part 13 close) and all numbers here are re-measured, never
  extrapolated.

## Created in Part 14 (full files)

## FILE: libs/trading-core/wlct_trading/retention.py (196 lines)

*the pure retention law: named constants for the one prunable table, the immutable records and the ledger; the nonsense-proof RetentionPolicy (bool-rejecting int checks, 1..36,500 days, lock-budget batch bounds); cutoff arithmetic that takes its clock as an argument; and the two-sided prunable predicate - the module imports no time, no driver and the status vocabulary it deliberately does not re-derive.*

```python
"""The retention law for the durable execution store (Part 14).

The engine's durable store (``services/execution-engine/app/store_sql.py``)
keeps three kinds of record, and this module's whole job is to state which
of them may ever be deleted: exactly one. ``engine_orders`` is the order
record, ``engine_order_fills`` is the money ledger, and
``engine_order_events`` is the append-only journal - the journal is the
only artifact whose loss does not change any balance or verdict, and it is
the only artifact with unbounded growth (every transition appends; a busy
resting order can journal ten rows a minute).

The laws, each enforced here in the pure layer so every executor (the
engine's SQL path today, a future maintenance job tomorrow) inherits them:

1. **Terminality is a timestamp, not a status lookup.** An order's
   transition into a terminal status stamps ``terminal_at`` (orders.py);
   retention prunes only what that stamp says is settled. Re-deriving a
   terminal SET here (from ``TERMINAL_ORDER_STATUSES`` or anything else)
   would create a second definition of "done" that can drift from the
   first - the writer already decided, per store, for every row.
   ``terminal_at IS NULL`` means retained, full stop, even for a status an
   operator considers terminal: a row the engine never stamped is a row
   whose settlement is unproven, and unproven is kept.

2. **The order keeps its whole story or none of it.** An event is
   prunable only when the event AND its order's ``terminal_at`` are both
   older than the cutoff. Pruning events under an order that reached its
   terminal state yesterday would amputate the recent history of a live
   investigation subject; the second comparison is what makes "90 days of
   journal" mean "90 days after the story ended", not "90 days ago".

3. **Bounded by construction.** The policy is a value type with rejected
   nonsense baked in: a zero or negative retention (a typo that would
   erase every settled journal row), a batch of zero (a loop that never
   progresses) or of hundreds of thousands (one statement holding locks
   across a whole shard), a batch count with no ceiling (a run that never
   ends under sustained load). The executor may only USE a policy, never
   repair one.

4. **Nothing here touches the money.** ``IMMUTABLE_RECORD_TABLES`` is a
   named law, not a comment: the engine's drift test asserts no statement
   its retention module can emit deletes from a table in this set, and the
   store's composite FKs are ``ON DELETE RESTRICT`` at the database level
   too. Deletion here has TWO guards with different failure modes, which
   is the point.

Timestamps everywhere are epoch microseconds (the platform time law), and
every function takes ``now_us`` as an argument: retention decisions belong
to a clock the caller names, never to a ``datetime.now()`` buried in a
library that claims determinism.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

__all__ = [
    "IMMUTABLE_RECORD_TABLES",
    "MAX_BATCHES",
    "MAX_BATCH_ROWS",
    "MAX_EVENT_RETENTION_DAYS",
    "MIN_BATCH_ROWS",
    "MIN_EVENT_RETENTION_DAYS",
    "PRUNABLE_JOURNAL",
    "RETENTION_LEDGER_TABLE",
    "RetentionError",
    "RetentionPolicy",
]

#: The one table from which rows may be deleted. Named, so an executor that
#: reaches for another one is a visible deviation, not a style choice.
PRUNABLE_JOURNAL: Final = "engine_order_events"

#: Tables whose rows no retention run may delete. ``engine_order_fills`` is
#: the ledger the reconciliation and the fees ride; ``engine_orders`` is the
#: record every later command (cancel, reconcile) looks up. The store's
#: child FKs are RESTRICT, so this set is also physically enforced - here
#: it is stated FIRST, so a future "cleanup" is written against a law and
#: not past one.
IMMUTABLE_RECORD_TABLES: Final[frozenset[str]] = frozenset(
    {
        "engine_orders",
        "engine_order_fills",
    }
)

#: The run ledger records what was pruned. It is itself outside the
#: pruneable set (it is not the journal), and it is tiny: one row per run.
#: Naming it here keeps "the ledger of deletions is not deleted" a law with
#: an identifier rather than a paragraph.
RETENTION_LEDGER_TABLE: Final = "engine_retention_runs"

#: Bound reasons, stated once: one day minimum because a zero-day policy
#: is a loaded gun pointed at yesterday; a century maximum because a value
#: that large is a sign-up to never prune, which is what omitting the
#: feature is for - a policy that lies about its intent is worse than no
#: policy.
MIN_EVENT_RETENTION_DAYS: Final = 1
MAX_EVENT_RETENTION_DAYS: Final = 36_500

#: Batch shape: 1..10,000 rows per statement, 1..1,000 batches per run.
#: At the caps one run removes at most ten million journal rows and holds
#: at most a page of locks at a time - a maintenance job, not an outage.
MIN_BATCH_ROWS: Final = 1
MAX_BATCH_ROWS: Final = 10_000
MAX_BATCHES: Final = 1_000

_US_PER_DAY: Final = 86_400 * 1_000_000


class RetentionError(ValueError):
    """A policy that cannot be honored. Raised at construction, never at
    deletion time: an invalid RetentionPolicy is not allowed to exist, so
    no executor can be mid-loop when it discovers one."""


@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    """Validated, immutable retention parameters.

    Constructed from configuration (the engine validates its env values by
    constructing THIS class - the bound law has exactly one definition and
    a config typo fails at boot with the field named, not at the first run
    with rows gone). All three fields are plain ints; booleans are
    rejected explicitly, because Python's ``True`` IS a valid one-day
    retention and that joke has no place in a deletion path.
    """

    event_retention_days: int
    batch_rows: int
    max_batches: int

    def __post_init__(self) -> None:
        for name in ("event_retention_days", "batch_rows", "max_batches"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int):
                raise RetentionError(
                    f"{name} must be a plain int, got {type(value).__name__}"
                )
        if not MIN_EVENT_RETENTION_DAYS <= self.event_retention_days <= MAX_EVENT_RETENTION_DAYS:
            raise RetentionError(
                f"event_retention_days must be between {MIN_EVENT_RETENTION_DAYS} and "
                f"{MAX_EVENT_RETENTION_DAYS}; {self.event_retention_days!r} either erases "
                "recent history or pretends retention exists when it does not"
            )
        if not MIN_BATCH_ROWS <= self.batch_rows <= MAX_BATCH_ROWS:
            raise RetentionError(
                f"batch_rows must be between {MIN_BATCH_ROWS} and {MAX_BATCH_ROWS}; "
                "a zero batch never progresses and an unbounded batch holds locks "
                "across the whole shard"
            )
        if not 1 <= self.max_batches <= MAX_BATCHES:
            raise RetentionError(
                f"max_batches must be between 1 and {MAX_BATCHES}; an uncapped prune "
                "loop under sustained load is a self-inflicted incident"
            )

    @property
    def event_cutoff_span_us(self) -> int:
        """The retention window in microseconds (pure arithmetic; the test
        pins it against a seconds-times-1e6 recomputation so a unit slip
        cannot hide behind a same-unit mistake)."""
        return self.event_retention_days * _US_PER_DAY

    def event_cutoff_us(self, now_us: int) -> int:
        """Rows older than this (and settled before it) are prunable.

        A cutoff below the epoch simply prunes nothing - possible when the
        clock fed in is itself pre-1970, which is a caller bug this
        function reports no louder than its zero-row result because the
        result is SAFE. A nonsensical now is the caller's clock to fix;
        retention has no business deleting MORE because the clock is odd.
        """
        if isinstance(now_us, bool) or not isinstance(now_us, int):
            raise RetentionError(f"now_us must be a plain int, got {type(now_us).__name__}")
        return now_us - self.event_cutoff_span_us

    def event_is_prunable(
        self,
        *,
        order_terminal_at_us: int | None,
        event_occurred_at_us: int,
        now_us: int,
    ) -> bool:
        """Law 2 as a predicate: the SQL executor expresses exactly this
        conjunction in its WHERE clause, and the core test row and the
        engine statement-shape pin are how the two spellings stay one law.

        ``order_terminal_at_us is None`` (open, or terminal-but-never-
        stamped by a pre-Part-13 writer) answers False: unproven, kept.
        """
        if order_terminal_at_us is None:
            return False
        cutoff = self.event_cutoff_us(now_us)
        return event_occurred_at_us < cutoff and order_terminal_at_us < cutoff
```


## FILE: libs/trading-core/tests/test_part14_retention.py (251 lines)

*35 tests: the construction-law matrix, the cutoff recomputed through a second unit path, the predicate boundary rows on both strict-less-than edges, the table-naming laws, and the AST purity scan (imports and name/attribute sets - docstrings may TALK about datetime.now, the code may not reach for it).*

```python
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
```


## FILE: services/execution-engine/app/retention.py (282 lines)

*the executor: five literal SQL constants (shared prune predicate pinned by literal identity, seq-ANY delete with RETURNING, the ledger insert), the dry-run count path, the bounded batch loop with its three exits, the per-batch reuse of the store's _TenantTransaction (GUC and UUID guard free), and the ledger-failure path that flips ledger_written and raises carrying the full counts.*

```python
"""Event-journal pruning over the durable store (Part 14).

The judgment lives in the core (``wlct_trading.retention``); this module is
its only executor against Postgres, and it is deliberately small. Four
rules make "a DELETE statement near money data" survivable:

1. **One target, three guards.** Events older than the cutoff under orders
   that were settled before the cutoff: that is the whole deletion set,
   spelled once in two statements (count and batch-select) that share the
   predicate text-by-text so no drift can make the rehearsal lie about the
   execution. Every statement carries the tenant id in its WHERE clause
   (the belt), runs inside ``_TenantTransaction`` (the GUC, so RLS means
   what it says the moment policies are enabled, and the canonical-UUID
   guard fires before the pool is touched), and the deletes are by
   explicit seq list - never by a predicate the database evaluates alone.

2. **Batched to a stop, never to a drain.** A run is at most
   ``max_batches`` batches of at most ``batch_rows`` rows, each batch its
   own transaction. A run that hits the ceiling reports ``exhausted`` and
   leaves the rest for the next scheduled run: retention competes with the
   command path for locks, and the command path must win. The batch loop
   deliberately does not retry races: a seq that another conn deleted
   first simply isn't in the RETURNING count.

3. **Dry-run is the default and is also recorded.** Inspect (count +
   recent runs) is available with the feature disabled; an APPLY requires
   ``EXECUTION_RETENTION_ENABLED=true`` and the refusal to say so is the
   point of the default. Dry runs write a ledger row too - the rehearsal's
   answer is evidence for the execution.

4. **The ledger is written after the deletes, and its failure is loud.**
   Rows are already gone when the record-writing transaction runs, so a
   ledger failure cannot roll back a lie - it surfaces as
   ``RetentionLedgerLost`` (HTTP 500 to the operator, ERROR line in the
   log with every count the ledger would have held). Ordering the ledger
   FIRST would instead record deletions that then failed; between an
   under-record and an over-record, the platform under-records loudly and
   never over-records quietly.

Refusals (memory backend, apply disabled) happen where the request stands
- in the router, before this module is reached - because both are about
CONFIGURATION, and this module takes configuration as given: a pool it did
not create, a policy the settings validator already admitted to exist.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any, Final

from wlct_trading.clock import epoch_micros
from wlct_trading.retention import PRUNABLE_JOURNAL, RetentionPolicy

from app.store_sql import PgPool, _TenantTransaction

__all__ = [
    "TABLE_RETENTION_RUNS",
    "RetentionLedgerLost",
    "RetentionRunReport",
    "inspect_event_store",
    "run_event_retention",
]

logger = logging.getLogger("app.retention")

#: Named for the drift tests and the docs; the statements below carry the
#: same literal text on purpose (Part 13's law: SQL constants are literal,
#: not assembled from names).
TABLE_RETENTION_RUNS = "engine_retention_runs"

#: The pruneable predicate, written out (never concatenated - Part 13's
#: literal law) in both statements that use it. The name exists for the
#: test that pins the two spellings are the SAME text: rehearsal and
#: execution share their meaning by identity of characters, verified - not
#: by a helper both call, which is only one careless edit from not shared.
PRUNABLE_WHERE: Final = (
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2"
)

COUNT_PRUNABLE_SQL: Final = (
    "SELECT count(*)::bigint AS n FROM engine_order_events e "
    "JOIN engine_orders o ON o.tenant_id = e.tenant_id AND o.order_id = e.order_id "
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2"
)

SELECT_DOOMED_SEQS_SQL: Final = (
    "SELECT e.seq FROM engine_order_events e "
    "JOIN engine_orders o ON o.tenant_id = e.tenant_id AND o.order_id = e.order_id "
    "WHERE e.tenant_id = $1 AND o.terminal_at IS NOT NULL AND o.terminal_at < $2 "
    "AND e.occurred_at < $2 ORDER BY e.seq LIMIT $3"
)

#: Explicit-seq delete: the WHERE a single-row predicate would need twice
#: the thought ("what is still prunable when this statement runs?") - the
#: seq list came from the same transaction, so this can only delete what
#: the count rehearsal counted. RETURNING 1 lets the rowcount come back as
#: actual rows, not as a status-string parse.
DELETE_BY_SEQS_SQL: Final = (
    "DELETE FROM engine_order_events WHERE tenant_id = $1 AND seq = ANY($2::bigint[]) "
    "RETURNING 1"
)

INSERT_RUN_SQL: Final = (
    "INSERT INTO engine_retention_runs (tenant_id, started_at, finished_at, dry_run, "
    "event_cutoff_us, rows_deleted, batches, exhausted, instance_id) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
)

SELECT_RECENT_RUNS_SQL: Final = (
    "SELECT seq, started_at, finished_at, dry_run, event_cutoff_us, rows_deleted, "
    "batches, exhausted, instance_id FROM engine_retention_runs WHERE tenant_id = $1 "
    "ORDER BY seq DESC LIMIT $2"
)


class RetentionLedgerLost(RuntimeError):
    """The prune happened; its RECORD did not. Carrying the full report on
    the exception is what lets the operator (and the 500 body) still see
    the counts the ledger row failed to reach."""

    def __init__(self, report: RetentionRunReport) -> None:
        super().__init__(
            "retention run completed but its ledger row failed to write; the "
            "log line 'retention.ledger_write_failed' carries the counts"
        )
        self.report = report


@dataclass(frozen=True, slots=True)
class RetentionRunReport:
    """One run's outcome as the ledger row will state it."""

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


async def run_event_retention(
    pool: PgPool,
    tenant_id: str,
    policy: RetentionPolicy,
    *,
    dry_run: bool,
    instance_id: str,
    clock: Callable[[], int] = epoch_micros,
) -> RetentionRunReport:
    """Prune the journal (or rehearse it) for ONE tenant.

    The pool is the store's pool - the same one ``PostgresOrderStore`` uses,
    because the same connection law (per-transaction GUC, tenant in every
    WHERE) must hold for deletions that for inserts. ``clock`` is a test
    seam: every timestamp here is the caller's clock, never a hidden one.
    """
    started_at = clock()
    cutoff = policy.event_cutoff_us(started_at)
    deleted = 0
    batches = 0
    exhausted = False

    if dry_run:
        async with _TenantTransaction(pool, tenant_id) as conn:
            rows = await conn.fetch(COUNT_PRUNABLE_SQL, tenant_id, cutoff)
        deleted = int(rows[0]["n"]) if rows else 0
    else:
        while True:
            async with _TenantTransaction(pool, tenant_id) as conn:
                seq_rows = await conn.fetch(
                    SELECT_DOOMED_SEQS_SQL, tenant_id, cutoff, policy.batch_rows
                )
                seqs = [int(r["seq"]) for r in seq_rows]
                if seqs:
                    doomed = await conn.fetch(DELETE_BY_SEQS_SQL, tenant_id, seqs)
                    deleted += len(doomed)
                    batches += 1
            if not seqs:
                break  # journal fully considered; nothing left THIS cutoff
            if len(seqs) < policy.batch_rows:
                break  # partial batch: the end of the work, not the ceiling
            if batches >= policy.max_batches:
                exhausted = True
                break

    report = RetentionRunReport(
        dry_run=dry_run,
        cutoff_us=cutoff,
        rows_reported=deleted,
        batches_run=batches,
        exhausted=exhausted,
        ledger_written=True,
    )
    try:
        async with _TenantTransaction(pool, tenant_id) as conn:
            await conn.execute(
                INSERT_RUN_SQL,
                tenant_id,
                started_at,
                clock(),
                dry_run,
                cutoff,
                deleted,
                batches,
                exhausted,
                instance_id,
            )
    except Exception as error:
        logger.error(
            "retention.ledger_write_failed",
            extra={
                "event": "retention.ledger_write_failed",
                "tenant_id": tenant_id,
                "dry_run": dry_run,
                "cutoff_us": cutoff,
                "rows_reported": deleted,
                "batches_run": batches,
                "exhausted": exhausted,
                "error_type": type(error).__name__,
            },
        )
        # The report an operator receives must not claim a ledger row that
        # failed to write: replace() re-states the one field that changed.
        raise RetentionLedgerLost(replace(report, ledger_written=False)) from error

    logger.info(
        "retention.run.completed",
        extra={
            "event": "retention.run.completed",
            "tenant_id": tenant_id,
            "instance_id": instance_id,
            "dry_run": dry_run,
            "cutoff_us": cutoff,
            "rows_reported": deleted,
            "batches_run": batches,
            "exhausted": exhausted,
        },
    )
    return report


async def inspect_event_store(
    pool: PgPool,
    tenant_id: str,
    policy: RetentionPolicy,
    *,
    limit: int,
    clock: Callable[[], int] = epoch_micros,
) -> dict[str, Any]:
    """One transaction holding both reads: the count NOW and the last few
    ledger rows, consistent with each other (a run completing between the
    two queries is exactly the race that makes an inspect answer lie)."""
    cutoff = policy.event_cutoff_us(clock())
    async with _TenantTransaction(pool, tenant_id) as conn:
        count_rows = await conn.fetch(COUNT_PRUNABLE_SQL, tenant_id, cutoff)
        run_rows = await conn.fetch(SELECT_RECENT_RUNS_SQL, tenant_id, limit)
    prunable = int(count_rows[0]["n"]) if count_rows else 0
    runs = [
        {
            "seq": int(r["seq"]),
            "started_at": int(r["started_at"]),
            "finished_at": int(r["finished_at"]),
            "dry_run": bool(r["dry_run"]),
            "event_cutoff_us": int(r["event_cutoff_us"]),
            "rows_deleted": int(r["rows_deleted"]),
            "batches": int(r["batches"]),
            "exhausted": bool(r["exhausted"]),
            "instance_id": str(r["instance_id"]),
        }
        for r in run_rows
    ]
    return {"cutoffUs": cutoff, "prunableNow": prunable, "runs": runs}


#: Re-exported for the test that pins "this module deletes from exactly one
#: table" - the core's PRUNABLE_JOURNAL constant, reachable from here so the
#: executor's law and the law's name are shown to be the same object.
PRUNABLE_TABLE = PRUNABLE_JOURNAL
```


## FILE: services/execution-engine/app/routers/retention.py (163 lines)

*two POSTs on the internal prefix: run (dry by default in the SCHEMA, apply gated on config) and inspect (one transaction, count + five ledger rows); every refusal (no durable store, apply disabled, ledger lost) answered in the engine's flat code/message envelope before a single statement exists.*

```python
"""The retention command surface (Part 14): inspect always, prune only when
the deployment has said so twice (endpoint reached AND
EXECUTION_RETENTION_ENABLED).

These two routes are the ONLY way journal rows ever get deleted, and they
are internal-plane by construction: same token authentication as every
other ``/internal/v1`` route, same tenant-header match (a body that names
another tenant's id is refused at the door, not "handled" downstream), and
deliberately absent from anything the public API proxies. The worker does
not forward here; the intended caller is a scheduler running the platform
retention script, one tenant per call.

Error-shape law, restated because the stakes differ: every refusal on this
surface is a 4xx that is NOT retried (the deployment configuration is the
thing to change), every store failure is a 5xx the caller will try again
against a still-consistent store (deletes are batched and the predicate is
idempotent: deleted rows stop matching it). The one shape with no clean
class is RETENTION_LEDGER_LOST - deletions happened, the record failed -
and it is answered 500 with the counts IN the body, because "unknown
outcome" on a deletion endpoint would force an operator to go read raw
database state at incident hours.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import get_settings
from app.retention import RetentionLedgerLost, inspect_event_store, run_event_retention
from app.schemas import (
    RetentionInspectRequest,
    RetentionInspectResponse,
    RetentionRunRequest,
    RetentionRunResponse,
    RetentionRunView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["retention"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]

#: How many ledger rows inspect returns. A page, not a history - the
#: history is readable from the table by an operator with a psql session
#: and a purpose; an endpoint is not a query language.
INSPECT_RUN_LIMIT = 5


def _durable_pool(request: Request) -> Any:
    """The store's pool, or the refusal that says why retention is not
    available. Memory-mode runtimes HAVE no journal growth problem (the
    restart bounds them), which is exactly why this answer is 409-with-
    reasoning rather than an empty success."""
    pool = getattr(request.app.state, "store_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_NO_DURABLE_STORE",
                "message": (
                    "event retention prunes the durable journal; this runtime's store "
                    "is process memory, which restarts bound - there is nothing here to "
                    "prune, and answering a maintenance command as though there were is "
                    "the failure mode, not the fallback. Configure "
                    "EXECUTION_STORE_BACKEND=postgres (docs/PART13_DURABLE_STORE.md)."
                ),
            },
        )
    return pool


@router.post("/retention/run", response_model=RetentionRunResponse, response_model_by_alias=True)
async def retention_run(
    body: RetentionRunRequest,
    caller: AuthDep,
    request: Request,
) -> RetentionRunResponse:
    """Prune (or rehearse pruning) one tenant's settled journal rows."""
    require_tenant_match(body.tenant_id, caller)
    pool = _durable_pool(request)
    settings = get_settings()
    if not body.dry_run and not settings.EXECUTION_RETENTION_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_APPLY_DISABLED",
                "message": (
                    "this deployment is dry-run only: EXECUTION_RETENTION_ENABLED=false. "
                    "Inspect the answer first, confirm a fresh backup, then set the env "
                    "and restart - a data-deleting capability is never flipped by the "
                    "request that exercises it (docs/PART14_RETENTION.md)."
                ),
            },
        )
    report = None
    try:
        report = await run_event_retention(
            pool,
            body.tenant_id,
            settings.retention_policy,
            dry_run=body.dry_run,
            instance_id=str(settings.EXECUTION_INSTANCE_ID or ""),
        )
    except RetentionLedgerLost as lost:
        report = lost.report
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "RETENTION_LEDGER_LOST",
                "message": (
                    f"the prune completed ({report.rows_reported} rows, dry-run "
                    f"{str(report.dry_run).lower()}) but its ledger row failed to write; "
                    "this body is the only place those counts exist outside the log line "
                    "'retention.ledger_write_failed' - fix the store before scheduling "
                    "another run"
                ),
                "rowsReported": report.rows_reported,
                "cutoffUs": str(report.cutoff_us),
                "batchesRun": report.batches_run,
                "exhausted": report.exhausted,
            },
        ) from None
    return RetentionRunResponse(
        dry_run=report.dry_run,
        cutoff_us=report.cutoff_us,
        rows_reported=report.rows_reported,
        batches_run=report.batches_run,
        exhausted=report.exhausted,
        ledger_written=report.ledger_written,
    )


@router.post(
    "/retention/inspect",
    response_model=RetentionInspectResponse,
    response_model_by_alias=True,
)
async def retention_inspect(
    body: RetentionInspectRequest,
    caller: AuthDep,
    request: Request,
) -> RetentionInspectResponse:
    """What WOULD be pruned right now, and the last runs that were."""
    require_tenant_match(body.tenant_id, caller)
    pool = _durable_pool(request)
    settings = get_settings()
    view = await inspect_event_store(
        pool,
        body.tenant_id,
        settings.retention_policy,
        limit=INSPECT_RUN_LIMIT,
    )
    return RetentionInspectResponse(
        enabled=settings.EXECUTION_RETENTION_ENABLED,
        event_retention_days=settings.EXECUTION_RETENTION_EVENT_DAYS,
        batch_rows=settings.EXECUTION_RETENTION_BATCH_ROWS,
        max_batches=settings.EXECUTION_RETENTION_MAX_BATCHES,
        cutoff_us=view["cutoffUs"],
        prunable_now=view["prunableNow"],
        runs=[RetentionRunView(**row) for row in view["runs"]],
    )
```


## FILE: services/execution-engine/tests/test_part14_retention.py (655 lines)

*33 tests: statement-literal pins, the scripted conversations for every branch (transaction boundaries counted, Eat() markers to pin WHICH statement a failure rides), and the HTTP matrix over a booted app with the lifespan's pool seam patched - including statements == [] on the refused apply and the status route's two new fields.*

```python
"""Part 14: the retention executor and its HTTP surface.

Two layers, mirroring the store's test discipline (the same recording
FakeConn family, including per-transaction begin/commit counters, because
"each batch is its own transaction" is the lock-safety law the executor is
allowed to claim):

1. the executor against scripted fakes - exact statement-per-transaction
   conversation for every branch (rehearse, partial batch, full batches to
   the ceiling, empty journal, lost-race count, ledger failure, pool
   error), the shared-prune-predicate literal pins, the sqlglot parse of
   every statement, and "the only DELETE targets engine_order_events"
   scanned off the module's own strings;
2. the routes through a booted TestClient over a fake POOL (lifespan
   patched at its seam, exactly as the part-13 config tests patch the
   store) - the memory 409, the apply-disabled 409 that must not emit a
   single statement, dry run and apply answers, inspect's read, the
   ledger-lost 500 carrying counts, the tenant-match law, and the status
   surface's two new fields.
"""

from __future__ import annotations

import asyncio
from contextlib import ExitStack
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlglot import parse as sqlglot_parse
from wlct_trading.execution.store import OrderStoreError
from wlct_trading.retention import RetentionPolicy

from app import retention
from app.config import get_settings
from app.retention import (
    COUNT_PRUNABLE_SQL,
    DELETE_BY_SEQS_SQL,
    INSERT_RUN_SQL,
    PRUNABLE_WHERE,
    SELECT_DOOMED_SEQS_SQL,
    SELECT_RECENT_RUNS_SQL,
    RetentionLedgerLost,
    inspect_event_store,
    run_event_retention,
)
from app.store_sql import PostgresOrderStore

TENANT = str(uuid4())
POLICY = RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3)
US_PER_DAY = 86_400 * 1_000_000


class Eat:
    """Script marker consumed by the NEXT statement of either kind without
    answering it: how a test pins WHICH statement an injected failure
    rides (the ledger INSERT, not the SET that precedes it)."""


class FakeConn:
    """Records every statement with its args; answers fetch() from a
    script; tracks transaction boundaries (begins/commits/rollbacks) and
    groups the statements by the transaction they ran inside. A script
    entry is either an Eat() marker (consumed by any statement), an
    exception (raised at the next statement), or a list (the answer for
    the next fetch; execute statements never consume answers)."""

    _UNSET = object()

    def __init__(self, script: list[Any] | None = None) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self.txes: list[list[str]] = [[]]  # statement list per transaction
        self.script = list(script or [])
        self.cursor = 0
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0

    def _step(self, query: str, args: tuple[object, ...], *, allow_response: bool) -> Any:
        self.statements.append((query, args))
        self.txes[-1].append(query)
        if self.cursor < len(self.script):
            entry = self.script[self.cursor]
            if isinstance(entry, Eat):
                self.cursor += 1
            elif isinstance(entry, BaseException):
                self.cursor += 1
                raise entry
            if allow_response:
                self.cursor += 1
                return entry
        return self._UNSET

    async def execute(self, query: str, *args: object) -> str:
        self._step(query, args, allow_response=False)
        return "OK 1"

    async def fetch(self, query: str, *args: object) -> list[Any]:
        entry = self._step(query, args, allow_response=True)
        if entry is not self._UNSET:
            return list(entry) if isinstance(entry, list) else []
        return []

    async def fetchrow(self, query: str, *args: object) -> Any:
        entry = self._step(query, args, allow_response=True)
        return None if entry is self._UNSET else entry

    def transaction(self) -> FakeTx:
        return FakeTx(self)


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1
        self._conn.txes.append([])  # statements land in THIS transaction

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> FakeConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        return FakeAcquire(self.conn)

    async def close(self) -> None:
        # the lifespan closes whatever pool it was handed - the fake proves
        # the retention tests' app shuts down through the REAL path.
        self.closed = True


def pair(script: list[Any]) -> tuple[FakePool, FakeConn]:
    conn = FakeConn(script)
    return FakePool(conn), conn


def call_run(
    pool: FakePool,
    *,
    dry_run: bool,
    instance_id: str = "exec-test-1",
    now_us: int = 1_757_000_000_000_000,
    policy: RetentionPolicy = POLICY,
    tenant: str = TENANT,
) -> Any:
    return asyncio.run(
        run_event_retention(
            cast(Any, pool),
            tenant,
            policy,
            dry_run=dry_run,
            instance_id=instance_id,
            clock=lambda: now_us,
        )
    )


def queries(conn: FakeConn) -> list[str]:
    return [query for query, _ in conn.statements]


class TestStatementLaws:
    def test_shared_predicate_is_the_same_literal_in_both_reads(self) -> None:
        # Rehearsal and execution share meaning by CHARACTER identity:
        # if either statement's WHERE drifts, the dry-run answer was a lie
        # about what the apply would delete.
        assert PRUNABLE_WHERE in COUNT_PRUNABLE_SQL
        assert PRUNABLE_WHERE in SELECT_DOOMED_SEQS_SQL
        assert "o.terminal_at < $2" in COUNT_PRUNABLE_SQL
        assert "e.occurred_at < $2" in COUNT_PRUNABLE_SQL
        assert "o.terminal_at IS NOT NULL" in COUNT_PRUNABLE_SQL
        # ONE cutoff parameter serves both comparisons - a second cutoff
        # would be a second law the core never validated.
        assert COUNT_PRUNABLE_SQL.count("$2") == 2
        assert "LIMIT $3" in SELECT_DOOMED_SEQS_SQL and "ORDER BY e.seq" in SELECT_DOOMED_SEQS_SQL

    def test_only_the_journal_is_deletable(self) -> None:
        deleters = [
            value
            for value in vars(retention).values()
            if isinstance(value, str) and "DELETE FROM" in value
        ]
        assert deleters
        for stmt in deleters:
            assert "DELETE FROM engine_order_events" in stmt
            assert "DELETE FROM engine_orders " not in stmt
            assert "DELETE FROM engine_order_fills" not in stmt
            assert "DELETE FROM engine_retention_runs" not in stmt

    def test_delete_is_an_explicit_seq_list_belted_by_tenant(self) -> None:
        assert DELETE_BY_SEQS_SQL.startswith("DELETE FROM engine_order_events")
        assert "tenant_id = $1" in DELETE_BY_SEQS_SQL
        assert "seq = ANY($2::bigint[])" in DELETE_BY_SEQS_SQL
        assert "RETURNING 1" in DELETE_BY_SEQS_SQL

    def test_every_statement_parses_as_postgres(self) -> None:
        for stmt in (
            COUNT_PRUNABLE_SQL,
            SELECT_DOOMED_SEQS_SQL,
            DELETE_BY_SEQS_SQL,
            INSERT_RUN_SQL,
            SELECT_RECENT_RUNS_SQL,
        ):
            parsed = sqlglot_parse(stmt, read="postgres")
            assert parsed and parsed[0] is not None

    def test_ledger_insert_columns_match_the_migration_in_order(self) -> None:
        head = INSERT_RUN_SQL.split("(", 1)[1].split(")", 1)[0]
        assert head.split(", ") == [
            "tenant_id",
            "started_at",
            "finished_at",
            "dry_run",
            "event_cutoff_us",
            "rows_deleted",
            "batches",
            "exhausted",
            "instance_id",
        ]
        assert "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)" in INSERT_RUN_SQL


class TestDryRun:
    def test_count_then_ledger_in_two_transactions(self) -> None:
        pool, conn = pair([[{"n": 42}]])
        report = call_run(pool, dry_run=True, now_us=1_757_000_000_000_000)
        assert report.rows_reported == 42
        assert report.cutoff_us == 1_757_000_000_000_000 - 90 * US_PER_DAY
        assert report.batches_run == 0 and report.exhausted is False
        assert report.ledger_written is True
        assert conn.tx_begins == 2 and conn.tx_commits == 2 and conn.tx_rollbacks == 0
        assert queries(conn) == [
            "SELECT set_config('app.tenant_id', $1, true)",
            COUNT_PRUNABLE_SQL,
            "SELECT set_config('app.tenant_id', $1, true)",
            INSERT_RUN_SQL,
        ]
        # the count is asked under the tenant arg and the cutoff - nothing else
        assert conn.statements[1][1] == (TENANT, report.cutoff_us)

    def test_the_ledger_row_records_the_rehearsal_as_a_fact(self) -> None:
        pool, conn = pair([[{"n": 7}]])
        report = call_run(pool, dry_run=True)
        insert_args = conn.statements[3][1]
        assert insert_args[0] == TENANT
        assert insert_args[3] is True  # dry_run column
        assert insert_args[5] == 7  # rows_deleted holds the prunable count
        assert insert_args[4] == report.cutoff_us  # the cutoff is part of the fact
        assert insert_args[8] == "exec-test-1"

    def test_empty_answer_to_count_is_zero_not_absent(self) -> None:
        pool, _ = pair([[]])
        report = call_run(pool, dry_run=True)
        assert report.rows_reported == 0


class TestApplyBatches:
    def test_partial_batch_is_the_last_batch(self) -> None:
        pool, conn = pair(
            [
                [{"seq": 7}, {"seq": 9}],  # 2 < batch_rows 4 -> the end
                [{"seq": 7}, {"seq": 9}],  # delete actually removed both
            ]
        )
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run, report.exhausted) == (2, 1, False)
        assert conn.tx_begins == 2  # one work tx + one ledger tx
        assert conn.statements[1][1] == (TENANT, report.cutoff_us, 4)
        assert conn.statements[2][1] == (TENANT, [7, 9])  # explicit seq list

    def test_full_batches_run_until_the_ceiling_and_say_so(self) -> None:
        script: list[Any] = []
        for batch in range(3):  # max_batches = 3, every batch FULL
            rows = [{"seq": batch * 4 + i} for i in range(4)]
            script.extend([rows, rows])
        pool, conn = pair(script)
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run) == (12, 3)
        assert report.exhausted is True  # "more may remain" - the scheduler's cue
        # no fourth select: the ceiling stops the loop, it does not slow it
        assert queries(conn).count(SELECT_DOOMED_SEQS_SQL) == 3

    def test_batch_limit_flows_from_the_policy_not_a_hardcode(self) -> None:
        pool, conn = pair([[]])
        call_run(
            pool,
            dry_run=False,
            policy=RetentionPolicy(event_retention_days=5, batch_rows=17, max_batches=2),
        )
        assert conn.statements[1][1][2] == 17

    def test_empty_journal_still_writes_a_zero_run_row(self) -> None:
        # a recorded no-op is what proves the schedule ran at all.
        pool, conn = pair([[]])
        report = call_run(pool, dry_run=False)
        assert (report.rows_reported, report.batches_run, report.exhausted) == (0, 0, False)
        assert queries(conn)[-2] == "SELECT set_config('app.tenant_id', $1, true)"
        assert queries(conn)[-1] == INSERT_RUN_SQL
        assert conn.statements[-1][1][5] == 0

    def test_lost_races_shrink_the_count_never_the_safety(self) -> None:
        # select saw three doomed seqs; another conn deleted two first.
        # The RETURNING rowcount is the ONLY thing reported.
        pool, _ = pair(
            [[{"seq": 1}, {"seq": 2}, {"seq": 3}], [{"seq": 1}]]
        )
        report = call_run(pool, dry_run=False)
        assert report.rows_reported == 1
        assert report.batches_run == 1  # partial delete is still a complete batch

    def test_each_batch_is_its_own_transaction_each_with_a_guc(self) -> None:
        script: list[Any] = []
        for _ in range(3):
            rows = [{"seq": i} for i in range(4)]
            script.extend([rows, rows])
        pool, conn = pair(script)
        report = call_run(pool, dry_run=False)
        gucs = [q for q in queries(conn) if q.startswith("SELECT set_config")]
        assert len(gucs) == conn.tx_begins == 4  # 3 work + 1 ledger
        assert report.batches_run == 3
        for tx in conn.txes[1:4]:  # each work transaction: GUC, select, delete
            assert len(tx) == 3 and tx[0].startswith("SELECT set_config")


class TestFailurePaths:
    def test_ledger_failure_loses_the_record_not_the_truth(self) -> None:
        pool, conn = pair(
            [
                [{"seq": 1}],
                [{"seq": 1}],
                Eat(),  # the ledger transaction's SET...
                RuntimeError("disk full mid insert"),  # ...then its INSERT fails
            ]
        )
        with pytest.raises(RetentionLedgerLost) as caught:
            call_run(pool, dry_run=False)
        lost = caught.value.report
        assert lost.rows_reported == 1 and lost.batches_run == 1
        assert lost.ledger_written is False  # the field the failure FLIPS
        assert conn.tx_rollbacks == 1 and conn.tx_commits == 1  # work committed, ledger did not

    def test_pool_error_mid_batch_propagates_and_rolls_back(self) -> None:
        pool, conn = pair([Eat(), RuntimeError("connection reset")])
        with pytest.raises(RuntimeError, match="connection reset"):
            call_run(pool, dry_run=False)
        assert conn.tx_rollbacks == 1

    def test_the_tenant_guard_burns_before_the_pool_is_borrowed(self) -> None:
        conn = FakeConn([])
        pool = FakePool(conn)
        with pytest.raises(OrderStoreError, match="canonical UUID"):
            asyncio.run(
                run_event_retention(
                    cast(Any, pool),
                    "tenant-label-not-uuid",
                    POLICY,
                    dry_run=True,
                    instance_id="exec-test-1",
                )
            )
        assert pool.acquires == 0 and conn.statements == []


class TestInspect:
    def test_both_reads_share_one_transaction(self) -> None:
        row = {
            "seq": 3,
            "started_at": 100,
            "finished_at": 200,
            "dry_run": True,
            "event_cutoff_us": 99,
            "rows_deleted": 7,
            "batches": 0,
            "exhausted": False,
            "instance_id": "exec-test-1",
        }
        conn = FakeConn([[{"n": 7}], [row]])
        view = asyncio.run(
            inspect_event_store(
                cast(Any, FakePool(conn)), TENANT, POLICY, limit=5, clock=lambda: 1_000
            )
        )
        assert conn.tx_begins == 1  # ONE transaction, both reads, one GUC
        assert conn.statements[1][1] == (TENANT, 1_000 - 90 * US_PER_DAY)
        assert conn.statements[2][0] == SELECT_RECENT_RUNS_SQL
        assert conn.statements[2][1] == (TENANT, 5)
        assert view["prunableNow"] == 7
        assert view["cutoffUs"] == 1_000 - 90 * US_PER_DAY
        assert view["runs"][0]["rows_deleted"] == 7
        assert view["runs"][0]["dry_run"] is True

    def test_view_values_are_plain_ints_and_bools(self) -> None:
        # ledger bigints arrive as int already; the view must not pass a
        # Decimal through to JSON (float coercion would lie about micros).
        conn = FakeConn([[{"n": 0}], []])
        view = asyncio.run(
            inspect_event_store(cast(Any, FakePool(conn)), TENANT, POLICY, limit=5, clock=lambda: 1)
        )
        assert isinstance(view["prunableNow"], int)
        assert view["runs"] == []


class TestConfigSurface:
    def test_policy_property_constructs_the_core_value(self) -> None:
        settings = get_settings()
        assert settings.retention_policy == RetentionPolicy(
            event_retention_days=90, batch_rows=2_000, max_batches=50
        )

    def test_absurd_retention_fails_boot_naming_the_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_RETENTION_EVENT_DAYS", "0")
        get_settings.cache_clear()
        with pytest.raises(Exception, match="EXECUTION_RETENTION_EVENT_DAYS"):
            get_settings()
        get_settings.cache_clear()

    def test_public_view_carries_retention_posture(self) -> None:
        public = get_settings().to_public_dict()
        assert public["retentionEnabled"] is False
        assert public["retentionEventDays"] == 90
        assert public["retentionBatchRows"] == 2_000
        assert public["retentionMaxBatches"] == 50


def postgres_client(
    monkeypatch: pytest.MonkeyPatch,
    stack: ExitStack,
    script: list[Any],
    *,
    enabled: str = "false",
) -> tuple[TestClient, FakeConn]:
    """A booted app with the postgres backend and FAKE pool: the lifespan
    seam (app.main.open_durable_store) is the patch point, so the app under
    test is the real composition - router, deps, config, store wiring."""
    monkeypatch.setenv("EXECUTION_STORE_BACKEND", "postgres")
    monkeypatch.setenv("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct")
    monkeypatch.setenv("EXECUTION_RETENTION_ENABLED", enabled)
    get_settings.cache_clear()
    pool, conn = pair(script)
    from app.main import create_app

    async def fake_open(settings: Any) -> tuple[FakePool, PostgresOrderStore]:
        return pool, PostgresOrderStore(cast(Any, pool))

    monkeypatch.setattr("app.main.open_durable_store", fake_open)
    client = stack.enter_context(TestClient(create_app()))
    return client, conn


def headers(tenant: str = TENANT) -> dict[str, str]:
    from tests.conftest import BASE_ENV

    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


class TestRoutesMemoryMode:
    def test_run_refused_with_reason_not_fabricated_success(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/retention/run",
            json={"tenantId": TENANT},
            headers=headers(),
        )
        assert response.status_code == 409
        body = response.json()  # the engine's flat {code,message} envelope
        assert body["code"] == "RETENTION_NO_DURABLE_STORE"
        assert "restarts bound" in body["message"]

    def test_inspect_refused_too(self, client: TestClient) -> None:
        response = client.post(
            "/internal/v1/retention/inspect",
            json={"tenantId": TENANT},
            headers=headers(),
        )
        assert response.status_code == 409
        assert response.json()["code"] == "RETENTION_NO_DURABLE_STORE"

    def test_status_reports_the_shipped_retention_defaults(self, client: TestClient) -> None:
        body = client.get("/internal/v1/status", headers=headers()).json()
        assert body["retentionEnabled"] is False
        assert body["retentionEventDays"] == 90


class TestRoutesDurableMode:
    def test_dry_run_always_available_and_answers_camel_case(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[{"n": 5}]])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["dryRun"] is True
            assert body["rowsReported"] == 5
            assert body["batchesRun"] == 0
            assert body["ledgerWritten"] is True
            assert isinstance(body["cutoffUs"], int)  # micros stay integers on the wire
            assert len(conn.statements) == 4

    def test_apply_refused_before_any_statement_when_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            assert response.status_code == 409
            assert response.json()["code"] == "RETENTION_APPLY_DISABLED"
            assert conn.statements == []  # not even a GUC: refused at the door

    def test_apply_executes_when_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(
                monkeypatch,
                stack,
                [[{"seq": 2}], [{"seq": 2}]],
                enabled="true",
            )
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            body = response.json()
            assert response.status_code == 200
            assert body["dryRun"] is False
            assert body["rowsReported"] == 1

    def test_ledger_failure_surfaces_counts_in_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(
                monkeypatch,
                stack,
                [
                    [{"seq": 2}],
                    [{"seq": 2}],
                    Eat(),
                    RuntimeError("ledger insert died"),
                ],
                enabled="true",
            )
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "dryRun": False},
                headers=headers(),
            )
            assert response.status_code == 500
            body = response.json()
            assert body["code"] == "RETENTION_LEDGER_LOST"
            assert body["rowsReported"] == 1
            assert "retention.ledger_write_failed" in body["message"]

    def test_inspect_reads_count_and_recent_runs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        row = {
            "seq": 1,
            "started_at": 10,
            "finished_at": 11,
            "dry_run": False,
            "event_cutoff_us": 9,
            "rows_deleted": 3,
            "batches": 1,
            "exhausted": True,
            "instance_id": "exec-test-1",
        }
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [[{"n": 8}], [row]])
            response = client.post(
                "/internal/v1/retention/inspect",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["prunableNow"] == 8
            assert body["enabled"] is False
            assert body["eventRetentionDays"] == 90
            assert body["maxBatches"] == 50
            assert body["runs"][0]["rowsDeleted"] == 3
            assert body["runs"][0]["exhausted"] is True
            assert conn.tx_begins == 1  # one read transaction, not three

    def test_body_tenant_must_match_the_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, conn = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": str(uuid4())},
                headers=headers(),
            )
            assert response.status_code == 403
            assert response.json()["code"] == "TENANT_MISMATCH"
            assert conn.statements == []

    def test_no_token_no_route(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run", json={"tenantId": TENANT}
            )
            assert response.status_code == 401

    def test_unknown_fields_are_rejected_on_the_run_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _ = postgres_client(monkeypatch, stack, [])
            response = client.post(
                "/internal/v1/retention/run",
                json={"tenantId": TENANT, "apiKey": "nope"},
                headers=headers(),
            )
            assert response.status_code == 422
```


## FILE: services/execution-engine/tests/test_part14_drift_parity.py (190 lines)

*11 re-derivations: migration columns vs the Prisma model vs the executor's insert list (identity column excepted), index names, Part 13 DDL hosting the predicate's columns, sqlglot parse of the ledger migration, the app-wide scan finding exactly one DELETE FROM target, and RLS coverage/enable/disable symmetry for the new table.*

```python
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
            / "20260913120000_part11_row_level_security"
            / "migration.sql"
        ).read_text(encoding="utf-8")
        assert f'CREATE POLICY tenant_isolation ON "{table}"' in part11
```


## FILE: services/execution-engine/tests/test_part14_retention_live.py (392 lines)

*5 real-Postgres tests (skipped by name without the DSN env): the joined predicate matching the prose row-for-row, a rehearsal recording without touching a row, ceiling-stop-then-resume with the remainder intact across two runs, tenant B untouched by tenant A's run despite identical shapes, and the live RLS probe on the ledger - bare session sees zero, the GUC transaction sees its row.*

```python
"""Part 14: retention against a REAL Postgres - when one is provided.

Same law as the part-13 live suite: without ``EXECUTION_TEST_POSTGRES_DSN``
the module skips with a visible reason; with it, the deletion executes
against the migrated tables and the assertions are the database's answer,
not a fake's. What a fake cannot certify and this file can:

- the JOINed prune predicate actually MATCHES the rows the prose says it
  matches (settled-old under settled-old, keeps recent under settled,
  keeps everything under open) - an executor whose fake scripts its own
  answers can never discover that its SQL selects the wrong rows;
- ``seq = ANY(...)`` deletes exactly the selected rows and RETURNING
  counts exactly those;
- the batch ceiling interrupts a big prune with the remainder INTACT, and
  the next run resumes - "exhausted means run again" is load-bearing;
- a second tenant's identical-looking rows survive a first tenant's run;
- under real ENABLE/FORCE ROW LEVEL SECURITY on the ledger table, the
  executor's own transaction (GUC set) writes and reads its rows while a
  bare session sees nothing - the RLS argument, executed for the newest
  table too.

Ages are anchored to the real clock (the cutoffs are relative): a live
suite that freezes "now" would be testing a fantasy calendar.
"""

from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import cast

import asyncpg
import pytest
from wlct_trading.retention import RetentionPolicy

from app.retention import inspect_event_store, run_event_retention
from app.store_sql import PgPool

pytestmark = pytest.mark.skipif(
    os.environ.get("EXECUTION_TEST_POSTGRES_DSN") is None,
    reason="EXECUTION_TEST_POSTGRES_DSN not set; real-Postgres retention suite "
    "skipped (the scripted suite pins statements and conversations instead)",
)

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914120000_part13_execution_store"
    / "migration.sql",
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260914160000_part14_retention_ledger"
    / "migration.sql",
)

DAY_US = 86_400 * 1_000_000
TENANT_A = "4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
TENANT_B = "5b2c3d4e-6f70-4b8c-9d0e-1f2a3b4c5d6e"

_TRUNCATES = (
    # Literal table names throughout (S608-clean by construction: no
    # f-strings near SQL, even a constant-fed one).
    "DELETE FROM engine_retention_runs",
    "DELETE FROM engine_order_fills",
    "DELETE FROM engine_order_events",
    "DELETE FROM engine_orders",
)

_LEDGER_POLICY_SETUP = (
    'CREATE POLICY tenant_isolation ON "engine_retention_runs" '
    "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)",
    'ALTER TABLE "engine_retention_runs" ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE "engine_retention_runs" FORCE ROW LEVEL SECURITY',
)
_LEDGER_POLICY_TEARDOWN = (
    'ALTER TABLE "engine_retention_runs" NO FORCE ROW LEVEL SECURITY',
    'ALTER TABLE "engine_retention_runs" DISABLE ROW LEVEL SECURITY',
    'DROP POLICY tenant_isolation ON "engine_retention_runs"',
)


_MIGRATIONS_APPLIED = False


def _statements_for(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    body = "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("--")
    )
    return [s.strip() for s in body.split(";") if s.strip()]


@pytest.fixture
async def conn() -> AsyncIterator[asyncpg.Connection]:
    """One session per test; the migration files themselves are the DDL
    (a fresh CI database gets part-13 THEN part-14 applied here, a
    fully-migrated one is left alone, and a half-migrated one - orders
    without the ledger, or the reverse - is refused as the broken state
    it is, rather than silently patched)."""
    global _MIGRATIONS_APPLIED
    dsn = os.environ["EXECUTION_TEST_POSTGRES_DSN"]
    async with asyncpg.connect(dsn=dsn, timeout=10.0) as connection:
        if not _MIGRATIONS_APPLIED:
            await connection.execute(
                'CREATE TABLE IF NOT EXISTS "tenants" ("id" UUID PRIMARY KEY)'
            )
            have_orders = (
                await connection.fetchval("SELECT to_regclass('public.engine_orders')")
                is not None
            )
            have_ledger = (
                await connection.fetchval(
                    "SELECT to_regclass('public.engine_retention_runs')"
                )
                is not None
            )
            if not have_orders and not have_ledger:
                for path in MIGRATIONS:
                    for statement in _statements_for(path):
                        await connection.execute(statement)
            elif have_orders and not have_ledger:
                for statement in _statements_for(MIGRATIONS[1]):
                    await connection.execute(statement)
            else:
                pytest.fail(
                    "half-migrated CI database (engine_retention_runs without "
                    "engine_orders); drop public.engine_* and the tenants stub "
                    "and rerun - this suite refuses to guess the missing half"
                )
            _MIGRATIONS_APPLIED = True
        await connection.execute(
            "INSERT INTO tenants(id) VALUES ($1),($2) ON CONFLICT DO NOTHING",
            TENANT_A,
            TENANT_B,
        )
        for statement in _TRUNCATES:
            await connection.execute(statement)
        yield connection


class _SingleConnectionPool:
    """One shared session for pool + raw queries (see part-13 live suite for
    why the shim, not a real pool, is what makes GUC assertions possible)."""

    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    def acquire(self) -> object:
        connection = self._connection

        class _Acquire:
            async def __aenter__(self) -> asyncpg.Connection:
                return connection

            async def __aexit__(self, *exc: object) -> bool:
                return False

        return _Acquire()

    async def close(self) -> None:
        return None


def now_us() -> int:
    return int(time.time() * 1_000_000)


async def seed_order(
    conn: asyncpg.Connection,
    tenant: str,
    order_id: str,
    *,
    terminal_at_us: int | None,
) -> None:
    """One minimal real order row (status is irrelevant to the prune -
    terminality is the timestamp, per the core law; the row carries
    FILLED-style values anyway because the schema's NOT NULLs earned them)."""
    await conn.execute(
        "INSERT INTO engine_orders (tenant_id, order_id, client_order_id, account_id, "
        "exchange, symbol, side, order_type, time_in_force, is_simulated, status, "
        "quantity, filled_quantity, cumulative_fee, created_at, updated_at, terminal_at) "
        "VALUES ($1, $2, $2, 'acct-1', 'binance', 'BTCUSDT', 'BUY', 'LIMIT', 'GTC', "
        "true, 'FILLED', '1', '1', '0', $3, $3, $4)",
        tenant,
        order_id,
        (terminal_at_us or now_us()) - 400 * DAY_US,
        terminal_at_us,
    )


async def seed_event(
    conn: asyncpg.Connection,
    tenant: str,
    order_id: str,
    event_id: str,
    *,
    occurred_at_us: int,
) -> None:
    await conn.execute(
        "INSERT INTO engine_order_events (tenant_id, order_id, event_id, status, "
        "occurred_at, payload) VALUES ($1, $2, $3, 'ACCEPTED', $4, '{}'::jsonb)",
        tenant,
        order_id,
        event_id,
        occurred_at_us,
    )


async def event_ids(conn: asyncpg.Connection, tenant: str) -> list[str]:
    rows = await conn.fetch(
        "SELECT event_id FROM engine_order_events WHERE tenant_id = $1 ORDER BY seq",
        tenant,
    )
    return [row["event_id"] for row in rows]


async def ledger_rows(conn: asyncpg.Connection, tenant: str) -> list[asyncpg.Record]:
    return await conn.fetch(
        "SELECT dry_run, rows_deleted, batches, exhausted FROM engine_retention_runs "
        "WHERE tenant_id = $1 ORDER BY seq",
        tenant,
    )


async def seed_fill(conn: asyncpg.Connection, tenant: str, order_id: str) -> None:
    await conn.execute(
        "INSERT INTO engine_order_fills (tenant_id, order_id, fill_id, trade_id, price, "
        "quantity, fee, fee_currency, is_maker, is_simulated, exchange_timestamp, "
        "received_timestamp) VALUES ($1, $2, 'fill-1', 'trade-1', '1000', '1', '0.1', "
        "'USDT', true, true, 1, 1)",
        tenant,
        order_id,
    )


class TestRealPrune:
    async def test_the_predicate_selects_exactly_the_prose_rows(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        # A: settled long ago. Old event under it is the ONLY pruneable row.
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-new", occurred_at_us=cutoff + DAY_US)
        # B: settled RECENTLY, event OLD - law 2 keeps the whole journal.
        await seed_order(conn, TENANT_A, "ord-b", terminal_at_us=cutoff + DAY_US)
        await seed_event(conn, TENANT_A, "ord-b", "b-old", occurred_at_us=cutoff - DAY_US)
        # C: open, ancient events - nothing settled, nothing goes.
        await seed_order(conn, TENANT_A, "ord-c", terminal_at_us=None)
        await seed_event(conn, TENANT_A, "ord-c", "c-ancient", occurred_at_us=now - 999 * DAY_US)
        await seed_fill(conn, TENANT_A, "ord-a")

        pool = _SingleConnectionPool(conn)
        report = await run_event_retention(
            cast(PgPool, pool),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert report.rows_reported == 1
        assert await event_ids(conn, TENANT_A) == ["a-new", "b-old", "c-ancient"]
        orders = await conn.fetch("SELECT order_id FROM engine_orders ORDER BY order_id")
        assert [r["order_id"] for r in orders] == ["ord-a", "ord-b", "ord-c"]
        fills = await conn.fetch("SELECT fill_id FROM engine_order_fills")
        assert [r["fill_id"] for r in fills] == ["fill-1"]  # money survives everything
        ledger = await ledger_rows(conn, TENANT_A)
        truth = [(r["dry_run"], r["rows_deleted"], r["batches"], r["exhausted"]) for r in ledger]
        assert truth == [(False, 1, 1, False)]

    async def test_dry_run_changes_nothing_yet_records_itself(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        report = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
            dry_run=True,
            instance_id="exec-live-1",
        )
        assert report.rows_reported == 1
        assert await event_ids(conn, TENANT_A) == ["a-old"]  # untouched
        ledger = await ledger_rows(conn, TENANT_A)
        assert (ledger[0]["dry_run"], ledger[0]["rows_deleted"]) == (True, 1)

    async def test_the_ceiling_stops_mid_prune_and_the_next_run_resumes(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        for i in range(10):  # 10 prunable, one run can eat 4 x 2 = 8
            await seed_event(conn, TENANT_A, "ord-a", f"e{i:02d}", occurred_at_us=cutoff - DAY_US)
        policy = RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=2)
        first = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            policy,
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert (first.rows_reported, first.exhausted) == (8, True)
        assert len(await event_ids(conn, TENANT_A)) == 2
        second = await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            policy,
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert (second.rows_reported, second.exhausted) == (2, False)
        assert await event_ids(conn, TENANT_A) == []
        ledger = await ledger_rows(conn, TENANT_A)
        assert [(r["rows_deleted"], r["exhausted"]) for r in ledger] == [(8, True), (2, False)]

    async def test_a_prune_never_breaches_another_tenant(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        for tenant in (TENANT_A, TENANT_B):
            await seed_order(conn, tenant, "ord-a", terminal_at_us=cutoff - DAY_US)
            await seed_event(conn, tenant, "ord-a", "old", occurred_at_us=cutoff - DAY_US)
        await run_event_retention(
            cast(PgPool, _SingleConnectionPool(conn)),
            TENANT_A,
            RetentionPolicy(event_retention_days=90, batch_rows=8, max_batches=1),
            dry_run=False,
            instance_id="exec-live-1",
        )
        assert await event_ids(conn, TENANT_A) == []
        assert await event_ids(conn, TENANT_B) == ["old"]  # untouched, same shape
        assert await ledger_rows(conn, TENANT_B) == []  # not even a record for them


class TestLedgerUnderRls:
    async def test_enabled_policies_see_the_run_through_the_guc_only(
        self, conn: asyncpg.Connection
    ) -> None:
        now = now_us()
        cutoff = now - 90 * DAY_US
        await seed_order(conn, TENANT_A, "ord-a", terminal_at_us=cutoff - DAY_US)
        await seed_event(conn, TENANT_A, "ord-a", "a-old", occurred_at_us=cutoff - DAY_US)
        for statement in _LEDGER_POLICY_SETUP:
            await conn.execute(statement)
        try:
            await run_event_retention(
                cast(PgPool, _SingleConnectionPool(conn)),
                TENANT_A,
                RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
                dry_run=False,
                instance_id="exec-live-1",
            )
            # the tx-local GUC is gone post-commit: a bare session (what a
            # leaked read or a future cron without the contract looks like)
            # sees NOTHING - not an error, nothing.
            bare = await conn.fetchval(
                "SELECT count(*) FROM engine_retention_runs WHERE tenant_id = $1",
                TENANT_A,
            )
            assert int(bare) == 0
            async with conn.transaction():
                await conn.execute("SELECT set_config('app.tenant_id', $1, true)", TENANT_A)
                seen = await conn.fetchval(
                    "SELECT count(*) FROM engine_retention_runs WHERE tenant_id = $1",
                    TENANT_A,
                )
            assert int(seen) == 1  # the store's own contract reads it back
            view = await inspect_event_store(
                cast(PgPool, _SingleConnectionPool(conn)),
                TENANT_A,
                RetentionPolicy(event_retention_days=90, batch_rows=4, max_batches=3),
                limit=5,
            )
            assert view["runs"][0]["rows_deleted"] == 1  # inspect works under policies too
        finally:
            for statement in _LEDGER_POLICY_TEARDOWN:
                await conn.execute(statement)
```


## FILE: apps/api/prisma/migrations/20260914160000_part14_retention_ledger/migration.sql (47 lines)

*the run ledger's DDL: BIGSERIAL seq identity, tenant UUID with Restrict FK, the counts and the cutoff, dry_run/exhausted booleans, instance attribution, the latest-N index, and the header comments stating WHY refusals have no rows here and why this table is never pruned.*

```sql
-- Part 14 - retention ledger for the durable execution store.
--
-- What this table is: the append-only RECORD of pruning runs against
-- engine_order_events (the one table retention may delete from). Rows are
-- written by services/execution-engine/app/retention.py in the
-- transaction that follows the batch loop - one row per COMPLETED run,
-- dry runs included, because "we rehearsed a prune on this date and the
-- answer was 41,902 rows" is exactly the sentence an incident review
-- needs and nobody will remember.
--
-- What refuses are NOT: refusals (memory backend, apply-disabled config)
-- happen before any store handle is reachable, so they never reach this
-- table; there is therefore no outcome/status column and the CHECK that a
-- status column would want is deliberately absent - every row here is a
-- fact that happened, not a report of an attempt.
--
-- This ledger is itself never pruned. It grows by one row per scheduled
-- run (a nightly job: 365 rows per tenant-year), and it is the only
-- defense against "what was deleted and when" being unanswerable.
--
-- Ownership law unchanged from Part 13: this migration is the DDL source
-- of truth, kept in lockstep with apps/api/prisma/schema.prisma (the
-- ExecutionRetentionRun model); the RLS policy for it is generated by the
-- Part 11 machinery from that schema, no hand-written GRANT/RLC here.

CREATE TABLE "engine_retention_runs" (
    "seq" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT NOT NULL,
    "dry_run" BOOLEAN NOT NULL,
    "event_cutoff_us" BIGINT NOT NULL,
    "rows_deleted" BIGINT NOT NULL,
    "batches" INTEGER NOT NULL,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "instance_id" VARCHAR(64) NOT NULL,
    CONSTRAINT "engine_retention_runs_pkey" PRIMARY KEY ("seq")
);

-- "the last five runs for this tenant" is the only read the inspect
-- endpoint has; seq DESC over the tenant prefix is that query's shape.
CREATE INDEX "engine_retention_runs_tenant_id_seq_idx" ON "engine_retention_runs"("tenant_id", "seq");

-- Restrict, same law as the store tables: the pruning record survives
-- every argument about the tenant it describes.
ALTER TABLE "engine_retention_runs" ADD CONSTRAINT "engine_retention_runs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```


## FILE: scripts/retention-run.mjs (197 lines)

*the operator CLI: dry unless told otherwise, --inspect for the read, one canonical --tenant per call enforced locally, the engine's exit-code contract mirrored (0/1/2), token env-only and scrubbed from every printed line including echoed error bodies.*

```javascript
#!/usr/bin/env node
/**
 * Retention runner for the durable execution store (Part 14).
 *
 * One command, one tenant, and a default that cannot delete:
 *
 *   EXECUTION_ENGINE_URL=http://execution-engine:8093 \
 *   EXECUTION_ENGINE_TOKEN=... \
 *     node scripts/retention-run.mjs --tenant <uuid>          # DRY RUN
 *     node scripts/retention-run.mjs --tenant <uuid> --apply  # prune
 *     node scripts/retention-run.mjs --tenant <uuid> --inspect
 *
 * Exit codes, cron-able exactly like `dr-manifest.mjs --due`:
 *   0  the run completed (dry, apply, or inspect) - summary on stdout
 *   1  the engine refused (disabled apply, no durable store) or failed
 *      (store error, ledger-lost) - the engine's code and message are echoed
 *   2  local misuse or no reachable engine (bad args, bad tenant id,
 *      connection error, timeout) - the engine was never asked
 *
 * What this script deliberately is NOT: a scheduler (deployment wires the
 * cadence, same stance as the DR ledger's --due), a fleet sweep (one
 * --tenant per call, because the store's own law refuses tenant-less
 * pruning and a script that looped tenants would just be that refusal
 * with more blast radius), or a new authority (every capability here is
 * the engine's endpoint's; flip nothing by wanting it - EXECUTION_RE-
 * TENTION_ENABLED lives in the engine's environment for a reason).
 *
 * The token is read from the environment, sent in a header, and scrubbed
 * from every line this script prints - including engine error bodies,
 * which are echoed for the operator's convenience and could echo anything.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class RetentionCliError extends Error {}

/** Remove the token from any text about to be printed. The engine never
 * echoes it back today; "today" is not a security property, so the scrub
 * stays even when the caller is well-behaved. */
export function scrubToken(text, token) {
  if (!token || token.length === 0) return String(text);
  return String(text).split(token).join('[REDACTED]');
}

export function parseArgs(argv, env = process.env) {
  const out = {
    tenant: null,
    mode: 'dry', // 'dry' | 'apply' | 'inspect'
    url: env.EXECUTION_ENGINE_URL ?? 'http://127.0.0.1:8093',
    token: env.EXECUTION_ENGINE_TOKEN ?? null,
    timeoutMs: 15_000,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tenant') {
      out.tenant = argv[(i += 1)];
    } else if (arg === '--apply') {
      if (out.mode !== 'dry') throw new RetentionCliError('modes are exclusive: --apply after --inspect');
      out.mode = 'apply';
    } else if (arg === '--inspect') {
      if (out.mode !== 'dry') throw new RetentionCliError('modes are exclusive: --inspect twice');
      out.mode = 'inspect';
    } else if (arg === '--url') {
      out.url = argv[(i += 1)];
    } else if (arg === '--timeout-ms') {
      const raw = argv[(i += 1)];
      const ms = Number(raw);
      if (!Number.isInteger(ms) || ms < 250 || ms > 600_000) {
        throw new RetentionCliError('--timeout-ms must be an integer in 250..600000');
      }
      out.timeoutMs = ms;
    } else if (arg === '--json') {
      out.json = true;
    } else {
      throw new RetentionCliError(`unknown argument: ${arg}`);
    }
  }
  if (!out.tenant) throw new RetentionCliError('--tenant <uuid> is required (one tenant per run, always)');
  if (!CANONICAL_UUID.test(out.tenant)) {
    throw new RetentionCliError(
      `--tenant must be a canonical lowercase UUID, got ${JSON.stringify(out.tenant)}`,
    );
  }
  if (!out.token) {
    throw new RetentionCliError(
      'EXECUTION_ENGINE_TOKEN is not set: this script will not ask an authenticated ' +
        'endpoint for a deletion while holding no credential',
    );
  }
  if (!/^https?:\/\//.test(out.url)) {
    throw new RetentionCliError('--url must be an http(s) URL');
  }
  return out;
}

/** The one request shape the engine accepts for these routes; tenantId in
 * the body AND x-tenant-id header (the engine 403s a mismatch - both are
 * sent from the same value here, so a refusal on match means an engine
 * with different wiring than this call assumed, which is worth seeing). */
export function requestFor(mode, tenant) {
  const path = mode === 'inspect' ? '/internal/v1/retention/inspect' : '/internal/v1/retention/run';
  const body = mode === 'inspect' ? { tenantId: tenant } : { tenantId: tenant, dryRun: mode !== 'apply' };
  return { path, body };
}

export function summarize(mode, payload) {
  if (mode === 'inspect') {
    const last = (payload.runs ?? [])[0];
    const lastText = last
      ? `last run: seq=${last.seq} ${last.dryRun ? 'dry ' : ''}rows=${last.rowsDeleted}`
      : 'no recorded runs yet';
    return `retention[inspect] prunable=${payload.prunableNow} cutoff=${payload.cutoffUs} (${lastText})`;
  }
  const verb = payload.dryRun ? 'prunable' : 'deleted';
  return (
    `retention[${payload.dryRun ? 'dry' : 'apply'}] rows=${payload.rowsReported} (${verb}) ` +
    `batches=${payload.batchesRun} exhausted=${payload.exhausted ? 'yes (more remain - schedule again)' : 'no'} ` +
    `ledger=${payload.ledgerWritten ? 'written' : 'LOST - reconcile against the log before scheduling more'}`
  );
}

async function callEngine({ url, token, tenant, mode, timeoutMs }, fetchImpl = globalThis.fetch) {
  const { path, body } = requestFor(mode, tenant);
  let response;
  try {
    response = await fetchImpl(url.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': token,
        'x-tenant-id': tenant,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RetentionCliError(
      `cannot reach the engine at ${url}: ${scrubToken(error?.message ?? error, token)} - ` +
        'the engine was never asked to delete anything',
    );
  }
  let payload = null;
  const text = await response.text();
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    payload = { code: `HTTP_${response.status}`, message: text.slice(0, 400) };
  }
  return { status: response.status, payload };
}

export async function main(argv, { env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  let args;
  try {
    args = parseArgs(argv, env);
  } catch (error) {
    log(`usage error: ${error.message}`);
    return 2;
  }
  let status;
  let payload;
  try {
    ({ status, payload } = await callEngine(args, fetchImpl));
  } catch (error) {
    // callEngine wraps only UNREACHED-engine states (connect/timeout); by
    // definition nothing was asked, so 2 is the whole story.
    log(scrubToken(error.message, args.token));
    return 2;
  }
  if (status >= 200 && status < 300) {
    if (args.json) log(JSON.stringify(payload));
    else log(summarize(args.mode, payload));
    return 0;
  }
  // Engine answered - refusal or failure. Echo code+message (scrubbed),
  // exit 1 so the scheduler's alert path sees it.
  const code = payload?.code ?? `HTTP_${status}`;
  const message = scrubToken(payload?.message ?? '(no message)', args.token);
  log(`engine answered ${status}: ${code}: ${message}`);
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'rowsReported')) {
    // The ledger-lost 500 carries the counts the record is missing; the
    // operator reading stdout needs them more than the prettifying.
    log(
      `  counts from the refused-to-record run: rows=${payload.rowsReported} ` +
        `batches=${payload.batchesRun} exhausted=${payload.exhausted}`,
    );
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
```


## FILE: scripts/retention-run.test.mjs (253 lines)

*11 node tests: arg law and exclusivity, request shape, the scrub function, and full-process runs against an in-test local HTTP fake engine (async spawn, because the server shares the parent loop) asserting headers, bodies, exit codes, and the token's non-appearance.*

```javascript
/**
 * Tests for the retention CLI (run: `node --test scripts/`).
 *
 * Two layers: the pure parts (arg law, request shape, summarization, the
 * token scrub) are unit-called; the CLI itself runs as a real process
 * against a real localhost HTTP fake of the engine, asserting exit codes
 * the scheduler will key on, header/body correctness the engine will key
 * on, and the one property an echo-happy CLI most easily breaks: nothing
 * prints the token, not even an error body that contains it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { parseArgs, requestFor, scrubToken, summarize } from './retention-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'retention-run.mjs');
const TENANT = '4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TOKEN = 'tok-cli-test-0123456789abcdef0123456789abcdef';

const execFileAsync = promisify(execFile);

// ASYNC on purpose: the fake engine listens on THIS process's event loop,
// and a synchronous child spawn would freeze the loop the server needs to
// answer - the test would "hang" exactly like a wedged deployment.
async function runCli(args, env = {}) {
  const full = { ...process.env, EXECUTION_ENGINE_TOKEN: TOKEN, ...env };
  try {
    const { stdout } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
      env: full,
      encoding: 'utf8',
    });
    return { code: 0, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    return {
      code: error.code,
      stdout: (error.stdout ?? '').toString().trim(),
      stderr: (error.stderr ?? '').toString().trim(),
    };
  }
}

function withServer(handler, fn) {
  return new Promise((resolvePromise, reject) => {
    const seen = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body.length > 0 ? JSON.parse(body) : null,
        });
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        await fn({ url, seen });
        resolvePromise();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test('the dry-run default is not negotiable by omission', () => {
  const args = parseArgs(['--tenant', TENANT], { EXECUTION_ENGINE_TOKEN: TOKEN });
  assert.equal(args.mode, 'dry');
  const { path, body } = requestFor(args.mode, args.tenant);
  assert.equal(path, '/internal/v1/retention/run');
  assert.equal(body.dryRun, true);
});

test('--apply and --inspect cannot coexist and the tenant must be canonical', () => {
  assert.throws(
    () => parseArgs(['--tenant', TENANT, '--apply', '--inspect'], { EXECUTION_ENGINE_TOKEN: TOKEN }),
    /exclusive/,
  );
  assert.throws(
    () => parseArgs(['--tenant', 'Tenant-1', '--apply'], { EXECUTION_ENGINE_TOKEN: TOKEN }),
    /canonical lowercase UUID/,
  );
  assert.throws(() => parseArgs(['--apply'], { EXECUTION_ENGINE_TOKEN: TOKEN }), /--tenant/);
});

test('no token in the environment is a usage error, not an anonymous ask', () => {
  assert.throws(
    () => parseArgs(['--tenant', TENANT], {}),
    /will not ask an authenticated endpoint/,
  );
});

test('scrubToken removes every occurrence of a reflected credential', () => {
  const evil = `engine exploded on ${TOKEN} while inserting`;
  const clean = scrubToken(evil, TOKEN);
  assert.ok(!clean.includes(TOKEN));
  assert.ok(clean.includes('[REDACTED]'));
});

test('summarize speaks both modes and both ledger fates', () => {
  const line = summarize('dry', {
    dryRun: true,
    rowsReported: 5,
    batchesRun: 0,
    exhausted: false,
    ledgerWritten: true,
  });
  assert.match(line, /retention\[dry\] rows=5 \(prunable\)/);
  assert.match(line, /ledger=written/);
  const lost = summarize('apply', {
    dryRun: false,
    rowsReported: 9,
    batchesRun: 2,
    exhausted: true,
    ledgerWritten: false,
  });
  assert.match(lost, /ledger=LOST/);
  assert.match(lost, /more remain - schedule again/);
  const inspect = summarize('inspect', {
    prunableNow: 42,
    cutoffUs: 1,
    runs: [{ seq: 7, dryRun: true, rowsDeleted: 42 }],
  });
  assert.match(inspect, /prunable=42/);
  assert.match(inspect, /last run: seq=7 dry rows=42/);
});

test('a successful dry run exits 0 and the engine sees a matching tenant pair', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          dryRun: true,
          cutoffUs: 1750000000000000,
          rowsReported: 5,
          batchesRun: 0,
          exhausted: false,
          ledgerWritten: true,
        }),
      );
    },
    async ({ url, seen }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url], { EXECUTION_ENGINE_URL: url });
      assert.equal(result.code, 0);
      assert.match(result.stdout, /retention\[dry\] rows=5 \(prunable\)/);
      assert.equal(seen[0].headers['x-internal-token'], TOKEN);
      assert.equal(seen[0].headers['x-tenant-id'], TENANT);
      assert.deepEqual(seen[0].body, { tenantId: TENANT, dryRun: true });
    },
  );
});

test('--apply flips exactly the one field the engine gates on', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          dryRun: false,
          cutoffUs: 1,
          rowsReported: 12,
          batchesRun: 2,
          exhausted: false,
          ledgerWritten: true,
        }),
      );
    },
    async ({ url }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--apply']);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /retention\[apply\] rows=12 \(deleted\)/);
    },
  );
});

test('an engine refusal exits 1 with its code and message echoed', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'RETENTION_APPLY_DISABLED', message: 'this deployment is dry-run only' }));
    },
    async ({ url }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--apply']);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /409: RETENTION_APPLY_DISABLED/);
      assert.match(result.stdout, /dry-run only/);
    },
  );
});

test('the ledger-lost 500 surfaces the counts stdout is now the only copy of', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 'RETENTION_LEDGER_LOST',
          message: `failed writing while ${TOKEN}`, // evil echo: must not print
          rowsReported: 3,
          batchesRun: 1,
          exhausted: false,
        }),
      );
    },
    async ({ url }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--apply']);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /rows=3/);
      assert.ok(!result.stdout.includes(TOKEN));
      assert.ok(!result.stderr.includes(TOKEN));
    },
  );
});

test('an unreachable engine is exit 2 and asks nothing of nobody', async () => {
  // Port 1 refuses instantly on loopback; no server needed.
  const result = await runCli(['--tenant', TENANT, '--url', 'http://127.0.0.1:1']);
  assert.equal(result.code, 2);
  assert.match(result.stdout + result.stderr, /cannot reach the engine/);
});

test('--url and body tenant arrive at the engine together', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ prunableNow: 0, cutoffUs: 9, runs: [] }));
    },
    async ({ url, seen }) => {
      const result = await runCli(['--tenant', TENANT, '--url', url, '--inspect']);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /prunable=0/);
      assert.equal(seen[0].url, '/internal/v1/retention/inspect');
      assert.equal(seen[0].body.tenantId, TENANT);
      assert.ok(!('dryRun' in seen[0].body)); // inspect has no such field; extra=forbid would 422 it
    },
  );
});
```


## FILE: docs/PART14_RETENTION.md (320 lines)

*the part's authoritative document: the growth analysis that picks the one prunable table, the four laws with their reasons, the executor's invariants, the ledger's two honest edges, the refusal matrix, the wire surface, the scheduling stance, the RLS argument, the test law with its limits in the same font, the four-move runbook, and the decisions ledger with each rejected alternative nearby.*

```markdown
# Part 14 - journal retention: pruning the one table that may be pruned

> **Risk note, deliberately unsoftened:** this part puts a DELETE statement
> on the money-adjacent plane, and everything about it is shaped by that.
> One table is deletable (the event journal), by two independent guards;
> the capability is dark by default at BOTH ends (engine config refuses
> apply, script refuses to ask for it); and every run - including the ones
> that delete nothing, and the rehearsals - leaves a row in a ledger that
> nothing prunes. Live venue transmission is unaffected by this document:
> it remains refused at engine startup (Part 13 §1; credential provider
> and placement review still open).

## 1. What Part 13 left standing, and why it bends

The durable store ships three tables. Two of them are correct to keep
forever: `engine_orders` is one modest row per order (the record every
later command looks up), and `engine_order_fills` is the money ledger -
fees and aggregates reconcile against it, and Part 13 deliberately made
its child FK `ON DELETE RESTRICT` so that deleting an order with fills is
not a retention setting, it is a schema change. The third -
`engine_order_events` - grows without law: every transition appends,
payload included,
and a churning resting order can write a dozen rows a minute for hours.
Unbounded growth next to money is how operations get "we must vacuum the
audit table" conversations, and the wrong resolution (prune by age alone)
is how the story behind a disputed fill quietly disappears.

So the scope of this part, exactly: **the journal is prunable, everything
else is not, and both halves are enforced rather than promised.**

## 2. The law (core), before any SQL existed

`libs/trading-core/wlct_trading/retention.py` is pure and knows no
database. Four laws, each with a reason:

1. **Terminality is `terminal_at`, never a status re-derivation.** The
   core's transition table stamps `terminal_at` when an order reaches a
   terminal status (orders.py), and the store persists the stamp
   (Part 13). Retention asks the stamp, not the status list - a second
   definition of "done" would be a second thing to drift. A row whose
   stamp is NULL is UNPROVEN-settled and kept, whatever an operator
   believes its status means.
2. **An order keeps its whole story or none of it.** An event is prunable
   only when BOTH the event and its order's `terminal_at` are older than
   the cutoff. Without the second comparison, "90-day retention" would
   erase the history of an order that settled yesterday while the order
   row itself remains - the exact window an investigation is open in.
3. **Nonsense cannot exist.** `RetentionPolicy` refuses at construction:
   days outside 1..36,500 (zero is a loaded gun; a century is a lie about
   intent), batch rows outside 1..10,000, batches outside 1..1,000, and
   booleans (Python's `True` IS `1` day - a joke with database
   consequences). The engine's config validator constructs the policy at
   BOOT, so a typo names its env var in a startup failure instead of
   naming it in an incident.
4. **Timestamps arrive as arguments.** `now_us` is a parameter on every
   law-bearing function; the module imports no clock (a purity test walks
   the syntax tree and refuses imports of `time`/`datetime` and any
   `now()`-shaped call). A deletion path that cannot be given a fake clock
   is a deletion path that cannot be tested at the boundary.

`PRUNABLE_JOURNAL` and `IMMUTABLE_RECORD_TABLES` are named constants
because "obviously only the journal" survives one confident refactor only
as an identifier something can test against.

## 3. The executor: small, literal, and boring on purpose

`services/execution-engine/app/retention.py` holds five SQL constants
(hand-assembled adjacent literals - Part 13's law continues to bind) and
two coroutines:

- `run_event_retention(pool, tenant_id, policy, dry_run, instance_id)` -
  dry runs execute ONE count statement; applies loop over
  batch-select → delete-by-explicit-seq-list until the journal is
  considered, the work ends mid-batch, or the ceiling stops the run
  (`exhausted: true`, "schedule again" - a maintenance job yields to the
  command path, it does not drain a shard in one statement);
- `inspect_event_store(...)` - count + last five ledger rows, in ONE
  transaction, because two queries at different times are two answers.

The invariants the tests pin character-for-character:

- every statement carries `tenant_id = $n` in its WHERE (the belt) and
  runs inside the store's OWN `_TenantTransaction` - the GUC first
  statement, the canonical-UUID guard before the pool is borrowed, the
  per-transaction rhythm. Retention got zero new connection handling
  because every law Part 13's tests pin for writes extends to deletes for
  free;
- the count and the batch-select embed the SAME predicate text (a test
  pins that the shared WHERE constant is present in both), so a rehearsal
  cannot mean something different than the execution;
- deletes name explicit `seq = ANY($2::bigint[])` lists - never a
  predicate the database re-evaluates at delete time, never a USING-join
  shortcut - and `RETURNING 1` makes the reported count the rows ACTUALLY
  removed, so losing a race to a concurrent delete shrinks the number and
  nothing else;
- each batch is its own committed transaction (locks held per batch, a
  crash mid-run loses only the un-ledgered remainder, and the predicate
  makes the next run resume by construction - already-deleted rows simply
  stop matching);
- no retries anywhere in the loop. A store error propagates; the scheduler
  will try again, against idempotent statements. That is the same
  at-least-once contract the worker's command path earned in Part 11.

## 4. The ledger: `engine_retention_runs`

One row per COMPLETED run, written after the deletes, in its own
transaction: tenant, started/finished (micros), the applied cutoff,
`rows_deleted` (for dry rows: the prunable count - the column's name is
read as "reported", `dry_run` makes which one it is unambiguous),
`batches`, `exhausted`, and the `instance_id` that performed it. The
table lives by the same ownership law as the store's three: Prisma model
+ migration DDL in `apps/api/prisma`, RLS coverage via the generator
(now 42 covered tables), composite tenant FK with `Restrict` - the
deletion record survives arguments about the tenant.

Two honest edges, stated:

- **Refusals do not reach the ledger.** They happen at the router, in
  front of any store handle, and they return their code over HTTP - an
  operator wanting "who tried to prune against a dry-run-only deployment"
  gets it from the engine's log lines, not from a table that only the
  durable path could write. A "refused" row that requires the store would
  not exist precisely when memory mode refuses for want of a store.
- **The ledger insert is the one write that can fail after the deletes.**
  The design chose that ordering on purpose (recording first would
  over-record deletions that then failed to happen) and made the
  consequence survivable: a ledger failure surfaces as
  `RetentionLedgerLost` carrying the FULL counts, logged at ERROR
  (`retention.ledger_write_failed`) and echoed in the 500 body - the
  operator reading the response, or the script's stdout, holds exactly
  what the missing row would have. Between an under-record and an
  over-record, the platform under-records LOUDLY.

## 5. Configuration: dark at both ends

| Variable | Default | Law |
| --- | --- | --- |
| `EXECUTION_RETENTION_ENABLED` | `false` | Gates APPLY only. Inspect/dry-run need nothing. |
| `EXECUTION_RETENTION_EVENT_DAYS` | `90` | Constructed into the core policy at boot; out-of-bounds refuses startup. |
| `EXECUTION_RETENTION_BATCH_ROWS` | `2000` | ditto |
| `EXECUTION_RETENTION_MAX_BATCHES` | `50` | ditto |

Compose passes all four with `${VAR:-default}` (the `:-` form means an
EMPTY override resolves to the default - the Part 13 empty-DSN trap cannot
recur). The public config view exposes all four (non-secret by
construction); `/health/ready` and `/internal/v1/status` carry
`retentionEnabled`/`retentionEventDays` so the posture is readable, and
`describe()`'s new fields travel to the worker's status assertion without
joining its compatibility law (the worker does not gate on retention -
its commands do not touch the journal).

## 6. The wire surface: two POSTs, five answers

Both routes live on the internal prefix, behind the same token auth and
the same body-vs-header tenant match as the command routes. The error
envelope is the engine's existing flat `{code, message}`:

- `409 RETENTION_NO_DURABLE_STORE` - memory mode, both routes. The message
  says WHY it is not an empty success: memory journals are bounded by
  restart; pretending to prune them would be answering a maintenance
  command with a fiction.
- `409 RETENTION_APPLY_DISABLED` - apply attempted while ENABLED=false,
  and (pinned) not ONE statement reached the pool.
- `409` from the store's own UUID guard path is not applicable (the
  executor borrows the store's guard, refusing before touching the pool -
  `pool.acquires == 0` is asserted).
- `500 RETENTION_LEDGER_LOST` - section 4's loud under-record, counts in
  the body.
- `200` otherwise: `{"dryRun","cutoffUs","rowsReported","batchesRun","exhausted","ledgerWritten"}`
  for run; config view + `prunableNow` + recent `runs[]` for inspect.

The routes are reachable ONLY with the internal token, compose keeps the
engine on the internal network, and nothing on the public API proxies
here. A tenant cannot prune itself out of its audit trail; an operator
with the token and a scheduler can prune a tenant that asked them to -
which is the standing trust model of every engine command, restated
because the verb here is DELETE.

## 7. The CLI, and what scheduling means here

`node scripts/retention-run.mjs --tenant <uuid> [--inspect|--apply]` is
the only way this part intends deletion to happen unprompted:

- exit 0 completed / 1 engine refused or failed (code+message echoed,
  counts included for ledger-lost) / 2 misuse or unreachable engine - the
  exit-code contract a cron or systemd timer alerts on, matching
  `dr-manifest.mjs --due`'s precedent;
- one tenant per invocation, ALWAYS - a `--all-tenants` flag would be the
  cross-tenant sweep the store exists to refuse, wearing a CLI;
- the token is env-only and scrubbed from every line printed, including
  echoed error bodies (a test makes the fake engine reflect the token
  inside a 500 message and asserts it never reaches stdout);
- `--inspect` and dry-run are the defaults' friends: with no mode flag the
  call is a rehearsal, and the rehearsal is what the cron entry SHOULD be.

Deployment owns the cadence (a timer per tenant, or a loop calling the
script); the platform owns refusing to invent one. Compose ships no cron
sidecar: a schedule that exists is a promise about evidence and freshness
the deployment - and only the deployment - can keep, same reasoning as the
DR ledger staying unwired.

## 8. RLS and the cross-tenant proof

The ledger table was picked up by the Part 11 generator with no generator
change (coverage 41 → 42), so the enablement checklist remains one
document for every tenant table. The live suite (gated, honest, same
pattern as Part 13's) executes the whole argument on a real database: an
apply prunes tenant A's rows and touches NOTHING belonging to B - same
shapes, same cutoffs, same tables; and with policies ENABLE/FORCED on the
ledger, the executor's own transaction sees its new row while a bare
session sees zero rows, because the GUC is transaction-local and the law
of Part 13 §3 binds deletes as tightly as it binds writes.

## 9. Test law, with its limits in the same font

- `libs/trading-core/tests/test_part14_retention.py` - 35 tests: the
  construction law matrix, cutoff arithmetic recomputed through a second
  unit path, the prunable-predicate boundary rows (both strict-`<` edges
  included), the table-naming laws, and the AST-level purity scan (no
  clock, no driver, no status vocabulary - prose mentions are legal,
  imports are not).
- `services/execution-engine/tests/test_part14_retention.py` - 33 tests:
  five statement-literal pins (shared predicate, single delete target
  scanned off the module's own strings, sqlglot parse, ledger columns in
  migration order), the scripted conversations (dry/apply/ceiling/empty/
  race/ledger-failure/pool-error, transaction boundaries counted, GUC
  before every statement, zero pool acquires when the guard fires), and
  the HTTP matrix over a patched-pool booted app (including
  `statements == []` on the refused apply).
- `services/execution-engine/tests/test_part14_drift_parity.py` - 11
  tests: migration ⇄ Prisma model ⇄ executor INSERT re-derived to agree
  (minus the identity column, deliberately), the index name in both
  artifacts, the predicate columns existing in Part 13's DDL, the
  whole-app scan that finds exactly one `DELETE FROM` target, and RLS
  coverage/enable/disable symmetry for the new table.
- `services/execution-engine/tests/test_part14_retention_live.py` - 5
  tests against a REAL Postgres when `EXECUTION_TEST_POSTGRES_DSN` is
  set (skipped-by-name otherwise, exactly as disclosed for Part 13): the
  predicate matching the prose row-for-row, dry-run recording without
  touching a row, ceiling-stop-then-resume with the remainder intact
  across two runs, tenant isolation under identical shapes, and the
  live RLS probe on the ledger.
- `scripts/retention-run.test.mjs` - 11 node tests: arg law (dry default,
  exclusive modes, canonical-uuid refusal, no-token refusal), request
  shape, the scrub function, and full-process CLI runs against a real
  local fake engine asserting exit codes, header/body pairs, and the
  token never surfacing even when the server echoes it back.

The limits, plainly: the sandbox has no Postgres server, so the live
layer was verified to SKIP (12 skips across both live files, by name, in
the final ledger); its claims about the database are the CI database's to
confirm, same stance as Part 13 §9. The scripted fakes pin the SHAPE of
every statement and conversation; the live file is what pins their SUB-
STANCE. Both halves of that sentence are load-bearing.

## 10. The runbook (four moves, in order, with the reason each exists)

1. **Back up first, provably.** `node scripts/dr-manifest.mjs --due`
   green for the `postgres` component before any apply - a prune followed
   by a failed restore is indistinguishable from a data-losing outage.
   (The check exists since Part 12; this part makes its first real
   consequence one a deletion could worsen.)
2. **Inspect on the staging tenant set.** `--inspect` answers "what WOULD
   go, and when did we last run" in one transaction; read the cutoff it
   prints and make sure it is the cutoff you meant.
3. **Schedule the rehearsal.** A cron line running the default (dry) mode
   per tenant writes ledger rows that become the numbers you judge the
   first apply against. "Prune nothing for a week, watch the count" is a
   real safety feature with a 0-cost rollout.
4. **Enable, apply, verify.** Set `EXECUTION_RETENTION_ENABLED=true`
   (restart - the flip is deliberately not hot), run one `--apply` per
   tenant, read the ledger row back via `--inspect`
   (`rowsDeleted`/`exhausted`), and let the scheduler take it from there.
   A `dryRun=false, rows_deleted=0` row at steady state is a healthy run.

Rollback of a mistake is out of scope by the same law as the deletion:
Postgres point-in-time recovery from a verified backup - the DR runbook
(docs/DR.md), not a feature flag. That is why move 1 is the first move.

## 11. Decisions, each with its rejected alternative nearby

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Prune events only; orders and fills are permanent | Age-pruning orders too (with CASCADE-deleting fills, or re-RESTRICTing to Cascade) | The order row is the audit spine commands look up; fills are money. Growth was only ever in the journal; deleting what does not grow buys risk for nothing |
| `terminal_at` stamp as the settledness law | Re-deriving from `TERMINAL_ORDER_STATUSES` at prune time | Two definitions of "done" drift; the writer already decided, per row |
| Cutoff compares event AND order settlement | Pruning any event by its own age | Law 2: the recent history of a just-closed order is the active case |
| Explicit seq lists for DELETE | `DELETE ... USING` with the predicate re-evaluated | The rehearsal's rows are exactly the deleted rows; concurrent activity can only shrink the count, never retarget the delete |
| Ledger written after the deletes | Write-ahead "started" row + update (or refusals recorded too) | An update path that can half-write is worse; refusals lack the very handle a ledger row needs; the loud 500 carries the record forward instead |
| Dry runs recorded | Rehearsals being ephemeral | The scheduled rehearsal's ledger row IS the evidence the first apply is judged on |
| Engine endpoint + thin CLI, no scheduler in compose | Engine-side cron loop (self-firing deletes) | A process that deletes on its own schedule cannot be paused by pausing the schedule; deployment-owned cadence can |
| Bounded batches + `exhausted` resume | Unbounded "clean everything" | Retention competes with the money path for locks; losing that race must be structurally impossible |
| Refusal at router before any store touch | Executor-internal guards | One code path where "0 statements" is testable; the module stays about SQL, not config archaeology |

## 12. Cross-references

- Part 13: `docs/PART13_DURABLE_STORE.md` - the store whose transaction
  helper this part reuses verbatim, and whose §13 open-items list this part
  amends (journal retention closed; metrics time-series retention stays
  open - different table, different part, never conflate them).
- Part 11: `docs/PART11_WORKER_SCALING.md` §13 - the "no database" law
  this part extends without contradicting (the default still reports
  `storeDurable: false`; retention simply cannot be pointed at it).
- `docs/DR.md` - backup freshness is now load-bearing for deletion safety,
  not only for disaster size; and `docs/SECURITY.md` / `docs/ARCHITECTURE.md` carry the updated bullets.
- `docs/ROADMAP.md` - delivery-log row 14; the journal-retention entry is
  struck from the open list.

## 13. What this part does NOT do

It does not delete anything by itself, ever (no schedule ships, no
self-firing job); does not prune orders, fills, reconciliation state, or
its own ledger (structurally - one DELETE target, scanned app-wide by
test); does not grow the worker or the public API (no proxy, no queue
command, and the worker's gate remains what Part 13 made it); does not
touch live mode (startup still refuses it for the missing provider and
review, and a prune run against a live engine would still just be a
prune); does not pretend memory mode has a growth problem (it says so,
in the 409's own words); and does not add a fleet-wide sweep - `--tenant`
is required, the store's tenant law with a CLI bolted on, which is the
only kind of retention call this platform will make.
```


## FILE: scripts/gen_part14_handover.py (319 lines)

*this generator - included, per the rule that every Part-14 file appears complete.*

````text
"""One-shot generator for docs/PART14_HANDOVER_FULL_SOURCE.md.

Runs from anywhere. Same standing rule as the Part 11, 12 and 13
generators it clones: every listed file is emitted COMPLETE - the entire
final file, no diffs, no elisions - and the generator AUDITS its own
emission (placeholder-elision tokens refused everywhere in the set,
suppression tokens refused in every NEW file; a hit fails the build, naming
the token and the file). The Part 13 baseline for comparison lives in
docs/PART13_HANDOVER_FULL_SOURCE.md; modified files shown HERE are shown
there too, so the two documents are diffable by construction.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Final

ROOT = (
    Path(__file__).resolve().parents[1]
    if "__file__" in globals()
    else Path("/home/user/whitelabel-copytrade")
)
OUT = ROOT / "docs" / "PART14_HANDOVER_FULL_SOURCE.md"

NEW: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/retention.py",
        "the pure retention law: named constants for the one prunable table, the immutable records and the ledger; the nonsense-proof RetentionPolicy (bool-rejecting int checks, 1..36,500 days, lock-budget batch bounds); cutoff arithmetic that takes its clock as an argument; and the two-sided prunable predicate - the module imports no time, no driver and the status vocabulary it deliberately does not re-derive.",
    ),
    (
        "libs/trading-core/tests/test_part14_retention.py",
        "35 tests: the construction-law matrix, the cutoff recomputed through a second unit path, the predicate boundary rows on both strict-less-than edges, the table-naming laws, and the AST purity scan (imports and name/attribute sets - docstrings may TALK about datetime.now, the code may not reach for it).",
    ),
    (
        "services/execution-engine/app/retention.py",
        "the executor: five literal SQL constants (shared prune predicate pinned by literal identity, seq-ANY delete with RETURNING, the ledger insert), the dry-run count path, the bounded batch loop with its three exits, the per-batch reuse of the store's _TenantTransaction (GUC and UUID guard free), and the ledger-failure path that flips ledger_written and raises carrying the full counts.",
    ),
    (
        "services/execution-engine/app/routers/retention.py",
        "two POSTs on the internal prefix: run (dry by default in the SCHEMA, apply gated on config) and inspect (one transaction, count + five ledger rows); every refusal (no durable store, apply disabled, ledger lost) answered in the engine's flat code/message envelope before a single statement exists.",
    ),
    (
        "services/execution-engine/tests/test_part14_retention.py",
        "33 tests: statement-literal pins, the scripted conversations for every branch (transaction boundaries counted, Eat() markers to pin WHICH statement a failure rides), and the HTTP matrix over a booted app with the lifespan's pool seam patched - including statements == [] on the refused apply and the status route's two new fields.",
    ),
    (
        "services/execution-engine/tests/test_part14_drift_parity.py",
        "11 re-derivations: migration columns vs the Prisma model vs the executor's insert list (identity column excepted), index names, Part 13 DDL hosting the predicate's columns, sqlglot parse of the ledger migration, the app-wide scan finding exactly one DELETE FROM target, and RLS coverage/enable/disable symmetry for the new table.",
    ),
    (
        "services/execution-engine/tests/test_part14_retention_live.py",
        "5 real-Postgres tests (skipped by name without the DSN env): the joined predicate matching the prose row-for-row, a rehearsal recording without touching a row, ceiling-stop-then-resume with the remainder intact across two runs, tenant B untouched by tenant A's run despite identical shapes, and the live RLS probe on the ledger - bare session sees zero, the GUC transaction sees its row.",
    ),
    (
        "apps/api/prisma/migrations/20260914160000_part14_retention_ledger/migration.sql",
        "the run ledger's DDL: BIGSERIAL seq identity, tenant UUID with Restrict FK, the counts and the cutoff, dry_run/exhausted booleans, instance attribution, the latest-N index, and the header comments stating WHY refusals have no rows here and why this table is never pruned.",
    ),
    (
        "scripts/retention-run.mjs",
        "the operator CLI: dry unless told otherwise, --inspect for the read, one canonical --tenant per call enforced locally, the engine's exit-code contract mirrored (0/1/2), token env-only and scrubbed from every printed line including echoed error bodies.",
    ),
    (
        "scripts/retention-run.test.mjs",
        "11 node tests: arg law and exclusivity, request shape, the scrub function, and full-process runs against an in-test local HTTP fake engine (async spawn, because the server shares the parent loop) asserting headers, bodies, exit codes, and the token's non-appearance.",
    ),
    (
        "docs/PART14_RETENTION.md",
        "the part's authoritative document: the growth analysis that picks the one prunable table, the four laws with their reasons, the executor's invariants, the ledger's two honest edges, the refusal matrix, the wire surface, the scheduling stance, the RLS argument, the test law with its limits in the same font, the four-move runbook, and the decisions ledger with each rejected alternative nearby.",
    ),
    (
        "scripts/gen_part14_handover.py",
        "this generator - included, per the rule that every Part-14 file appears complete.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "services/execution-engine/app/config.py",
        "the four retention fields (dark-by-default apply switch, days, batch rows, batches), boot-time validation by CONSTRUCTING the core policy (the bound law has one home; an invalid config names its env var at startup), the retention_policy property, and the four values added to the public view - non-secret by construction.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "five retention wire models (run/inspect requests, the run answer mirroring the ledger row, the run view, the inspect answer) on the same _WireModel law - camelCase aliases, extra=forbid - and StatusResponse's two new fields defaulting to the shipped posture so a pre-Part-14 engine cannot be read as having run retention.",
    ),
    (
        "services/execution-engine/app/composition.py",
        "describe() grows retentionEnabled/retentionEventDays beside the store posture - visible to the worker's status read, deliberately NOT added to its compatibility law (commands do not touch the journal).",
    ),
    (
        "services/execution-engine/app/main.py",
        "two lines: the retention router import and its include; the lifespan was already pool-owning since Part 13, and this part consumes that seam rather than widening it.",
    ),
    (
        "apps/api/prisma/schema.prisma",
        "the ExecutionRetentionRun model (seq identity, micros law, dry-run-is-evidence comment, cutoff frozen into the row, batches accounting, instance attribution, Restrict tenant FK, the latest-N index) and the Tenant back-relation; prisma format again left every pre-existing byte in place.",
    ),
    (
        "apps/api/prisma/migrations/20260913120000_part11_row_level_security/migration.sql",
        "regenerated by the generator, not hand-edited: coverage 41 -> 42 tables, the ledger's policy included, byte-deterministic.",
    ),
    (
        "apps/api/prisma/rls/enable.sql",
        "regenerated: the ledger joins the pre-flight checklist and the ENABLE/FORCE sequence - one checklist for all 42.",
    ),
    (
        "apps/api/prisma/rls/disable.sql",
        "regenerated: the exact inverse covers the new table the same day enable does.",
    ),
    (
        "apps/api/prisma/rls/rls_coverage.json",
        "regenerated: covered 41 -> 42; the Node rls-coverage spec (which RE-DERIVES the schema rather than pinning a count) passed unchanged at the new number.",
    ),
    (
        "docker-compose.yml",
        "the four EXECUTION_RETENTION_* passthroughs with ${VAR:-default} spellings (an empty override resolves to the default - the Part 13 lesson applied before it could recur) and the comment stating that compose ships no scheduler.",
    ),
    (
        ".env.example",
        "the retention note under the engine block: defaults, the pointer to the service example and the part doc, and the line that the prune runs from scripts/retention-run.mjs under the deployment's scheduler.",
    ),
    (
        "services/execution-engine/.env.example",
        "the retention block: the two guards in prose (dark apply, never-pruned orders/fills/ledger), the both-sides cutoff law in one sentence, and the batch-ceiling semantics (exhausted means resume, not incident).",
    ),
    (
        "docs/PART13_DURABLE_STORE.md",
        "section 13's PART 14 AMENDMENT: the journal-growth implication this part left unnamed is now answered, and the metrics time-series retention item is called out as DIFFERENT by name so the two are never conflated.",
    ),
    (
        "docs/DR.md",
        "the backup-freshness section gains the Part 14 consequence: --due green before the first apply, the deletion ledger riding the same dump, and the one-line reason a prune followed by a failed restore is indistinguishable from an outage.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "the engine bullet's store paragraph extended: bounded journal, dark-by-default apply, the never-pruned run ledger, and no shipped schedule.",
    ),
    (
        "docs/SECURITY.md",
        "the retention bullet: the only deletion path on the engine plane, triply narrow (one table under an app-wide scan, config-dark, internal-only and tenant-per-call), with every run leaving a row under the same RLS law as its subjects.",
    ),
    (
        "docs/ROADMAP.md",
        "Part 14's delivery-log row and the open-list clarification (journal retention closed; the backlog's time-series metrics item - different table, different part - deliberately still open).",
    ),
]

#: Tokens whose mere presence means content was cut somewhere. A hit in ANY
#: listed file fails the build - the rule the Part 11-13 documents shipped
#: under, unchanged.
ELISION_TOKENS: Final[tuple[str, ...]] = (
    "# existing code",
    "# rest of code",
    "// rest of code",
    "// implementation omitted",
    "... (rest",
    "(snip)",
    "truncated for brevity",
    "identical to",
    "same as above",
    "etc.",
    "omitted",
    "unchanged`",
)

NEW_ONLY_TOKENS: Final[tuple[str, ...]] = (
    "TODO",
    "implement this later",
    "type: ignore",
    "noqa",
    "eslint-disable",
    "@ts-ignore",
    "@ts-expect-error",
)

#: Files that DEFINE the banned tokens as guard data and are therefore exempt
#: from the substring scan - stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset({"scripts/gen_part14_handover.py"})


def fence(rel_path: str, text: str) -> str:
    if "```" in text:
        return "````text\n" + text.rstrip("\n") + "\n````\n"
    name = rel_path.rsplit("/", 1)[-1]
    lang = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".sql": "sql",
        ".json": "json",
        ".prisma": "prisma",
        ".toml": "toml",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".mjs": "javascript",
        ".txt": "text",
        ".md": "markdown",
    }.get(
        "." + name.rsplit(".", 1)[-1] if "." in name else "",
        "dotenv" if name == ".env.example" else ("dockerfile" if name.endswith("Dockerfile") else ""),
    )
    return f"```{lang}\n" + text.rstrip("\n") + "\n```\n"


def block(rel: str, note: str) -> str:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    lines = len(text.splitlines())
    return f"## FILE: {rel} ({lines} lines)\n\n*{note}*\n\n{fence(rel, text)}\n"


def sweep() -> list[str]:
    problems: list[str] = []
    for rel, _ in NEW:
        if rel in SWEEP_SELF_EXEMPT:
            continue
        text = (ROOT / rel).read_text(encoding="utf-8")
        for token in ELISION_TOKENS + NEW_ONLY_TOKENS:
            if token in text:
                problems.append(f"NEW {rel}: contains {token!r}")
    for rel, _ in MODIFIED:
        if rel in SWEEP_SELF_EXEMPT:
            continue
        text = (ROOT / rel).read_text(encoding="utf-8")
        for token in ELISION_TOKENS:
            if token in text:
                problems.append(f"MODIFIED {rel}: contains {token!r}")
    return problems


HEADER = """# Part 14 - journal retention: full source handover

> **Risk note, unchanged and deliberately unsoftened:** Part 14 puts the
> platform's first DELETE near money records, and every layer is shaped by
> that - one deletable table under an app-wide test, apply dark behind both
> the engine's config and the script's flag, and a run ledger that nothing
> prunes. Live venue transmission remains refused by startup code; this
> part neither advances nor weakens that refusal.

Complete content of every file created or modified by Part 14. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their Part-13 state is recoverable
from `docs/PART13_HANDOVER_FULL_SOURCE.md` (and earlier documents for files
that predate it), which list every one of them with its then-current line
count - `apps/api/prisma/schema.prisma` included, so its baseline is the
Part 13 emission (4,139 lines) and the delta below is real, not estimated.

All quality gates at generation time (2026-09-14):

* `cd libs/trading-core && python3 -m pytest -q` -> **1377 passed** (+35
  Part-14 retention-law tests); `python3 -m ruff check wlct_trading tests`
  -> green; `python3 -m mypy wlct_trading` -> **no issues, 144 source
  files**, zero suppressions in any part file (the sweep below audits it).
* `cd services/execution-engine && python3 -m pytest -q` -> **133 passed,
  12 skipped** (all seven Part-13 live tests plus the five Part-14 live
  tests, skipping BY NAME without `EXECUTION_TEST_POSTGRES_DSN` - the
  honest shape stated in docs/PART14_RETENTION.md section 9);
  `python3 -m ruff check app tests` -> green; `python3 -m mypy app` ->
  **no issues, 14 source files**.
* `cd apps/api && npx jest --silent` -> **386 passed / 17 suites** (the
  worker side needed NO change for this part - and its rls-coverage spec
  RE-DERIVES the schema, which is why it went from 41 to 42 covered tables
  without a single spec edit); `npx tsc --noEmit` -> 0 errors;
  `npx eslint src --max-warnings 0` -> clean; `npx prisma validate` ->
  valid.
* `node --test scripts/` -> **37 passed / 0 failed** (+11 CLI tests,
  including full-process runs against an in-test fake engine and the
  token-never-printed assertion); `node scripts/dr-manifest.mjs --check`
  unchanged and green.
* `python3 scripts/gen_part11_rls.py` regenerated all four artifacts for
  42 covered tables (the ledger picked up with NO generator change),
  byte-identical across consecutive runs.
* Sibling Python services re-verified untouched: trading-engine **43
  passed**, market-data **19 passed**.
* Line ledger (measured, this script): Part 14 shipped **3,531 lines** -
  3,265 across the 12 new files (this generator included) and +266 across
  the 17 modified files (delta against the newest handover document that
  lists each file - the regenerated RLS artifacts and the four doc edits
  keep that number modest; growth here is concentrated in law and tests,
  which is the correct place for a part whose production surface is one
  module, one router and one script). Whole-tree counts under the standing
  rule set (everything except node_modules/dist/lockfiles, `docs/source/`,
  and the PART*HANDOVER documents): **179,979 source lines**; adding the
  full docs tree (narrative documents and the regenerable docs/source
  views, minus every handover dump): **527,314**; prior parts' totals used
  the same rule
  (176,806 at Part 13 close) and all numbers here are re-measured, never
  extrapolated.
"""


def main() -> int:
    problems = sweep()
    if problems:
        print("HANDOVER AUDIT FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    parts = [HEADER, "## Created in Part 14 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 14 (full files, prior content preserved inside)\n")
    parts += [block(rel, note) for rel, note in MODIFIED]
    total_files = len(NEW) + len(MODIFIED)
    text = "\n".join(parts)
    OUT.write_text(text, encoding="utf-8")
    emitted = text.count("\n## FILE: ")
    if emitted != total_files:
        print(f"EMISSION COUNT MISMATCH: {emitted} blocks for {total_files} files", file=sys.stderr)
        return 1
    print(
        f"wrote {OUT} ({len(text.splitlines()):,} lines, "
        f"{total_files} files: {len(NEW)} new + {len(MODIFIED)} modified)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
````


## Modified in Part 14 (full files, prior content preserved inside)

## FILE: services/execution-engine/app/config.py (298 lines)

*the four retention fields (dark-by-default apply switch, days, batch rows, batches), boot-time validation by CONSTRUCTING the core policy (the bound law has one home; an invalid config names its env var at startup), the retention_policy property, and the four values added to the public view - non-secret by construction.*

```python
"""Configuration for the execution engine.

Every value comes from the environment. There are no defaults for secrets:
a missing or placeholder internal token stops the process rather than
starting a service that silently cannot authenticate its callers.

The field types are all defaulted so ``Settings()`` constructs cleanly under
mypy strict; the requirement that critical values EXIST is enforced in the
model validator, not by missing defaults, and the error messages name the
environment variable so a boot failure is self-explaining.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from wlct_trading.retention import RetentionError, RetentionPolicy

__all__ = ["Settings", "get_settings"]

#: Placeholder spellings rejected everywhere on this platform. A token that
#: reads "changeme" is the same as no token, and discovering that during an
#: incident is how incidents get longer.
#: Exact values that can never be a real secret, and the prefixes that mark
#: "this was a template nobody filled in" ("changeme-64-xs" is as placeholder
#: as "changeme" - suffix noise does not launder it).
_PLACEHOLDERS = frozenset(
    {
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
)
_PLACEHOLDER_PREFIXES = ("changeme", "change-me", "replace_me", "replace-me")


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    # --- Identity and transport ------------------------------------------
    #: Names this instance in logs, the health surface and (later) the
    #: worker registry. Not a secret; not a credential; useful in a
    #: postmortem that says "which process thought it was leader".
    EXECUTION_INSTANCE_ID: str | None = None
    SERVICE_PORT: int = 8093
    #: Loopback by default: this process must be explicitly re-bound (env)
    #: to serve another container, and deployments that do so keep it on an
    #: internal network - the token is authentication, not segmentation.
    EXECUTION_ENGINE_HOST: str = "127.0.0.1"
    #: Shared secret with the Node worker. Minimum 32 characters, constant
    #: time compared in app.security, never logged.
    EXECUTION_INTERNAL_TOKEN: str | None = None

    # --- Mode ---------------------------------------------------------------
    #: "simulated" is the only mode this build transmits in. "live" parses
    #: (so a staged config does not fail boot for a syntax reason while it
    #: fails a safety reason) but startup refuses it with MODE_NOT_WIRED.
    EXECUTION_MODE: Literal["simulated", "live"] = "simulated"
    #: When true, order SUBMISSION stops before transmission. Cancellation
    #: is not a new position and stays available either way - failing to
    #: cancel a resting order is the larger risk of the two.
    EXECUTION_DRY_RUN: bool = True
    #: Per-request venue timeout handed to the core engine settings.
    EXECUTION_REQUEST_TIMEOUT_MS: int = 5_000
    #: Lease TTL for the core's own account/order locks (milliseconds).
    EXECUTION_LOCK_TTL_MS: int = 15_000

    # --- Simulated venue shaping -------------------------------------------
    #: Fixed mid used as top-of-book for any symbol. Unset means the paper
    #: book is empty: submissions are refused for lack of price, which is
    #: the honest default for a deployment that configured nothing.
    EXECUTION_SIMULATED_MID: str | None = None
    #: Comma-separated `ASSET=QUANTITY` seed balances for the simulated
    #: account. Balances are labelled simulated wherever they surface.
    EXECUTION_PAPER_BALANCES: str = "USDT=100000"

    # --- Durable state (Part 13) --------------------------------------------
    #: "memory" keeps the process-local reference store (everything this
    #: service did before Part 13; readiness honestly reports
    #: storeDurable=false). "postgres" requires the engine tables (owned by
    #: apps/api/prisma, applied by the API's migration job) and a DSN, and
    #: refuses startup without either - a store configured but unreachable
    #: is "not running", never "running degraded": the moment this process
    #: cannot durably record an order it must stop taking commands.
    EXECUTION_STORE_BACKEND: Literal["memory", "postgres"] = "memory"
    #: DSN for the engine store, e.g. postgresql://user:pass@db:5432/wlct.
    #: A credential: env-only, never logged, never in to_public_dict, and
    #: like every DSN on this platform it belongs to a dedicated role, not
    #: the owner. The engine sets app.tenant_id per transaction (the same
    #: contract as the API's withTenantRls), so these tables are RLS-safe
    #: from the day the operator flips policies on.
    EXECUTION_POSTGRES_DSN: str | None = None

    # --- Retention (Part 14) -----------------------------------------------
    #: The apply switch. False (the default) leaves every retention call in
    #: DRY-RUN: inspection always works, deletion never happens, and an
    #: apply request is refused with the config named. A maintenance job
    #: that destroys data does not run because a compose file once existed.
    #: It also does not run on a schedule nobody reviewed: the intended
    #: first use is inspect (disabled) -> scheduled dry-run -> one manual
    #: apply against a fresh backup -> enable (docs/PART14_RETENTION.md).
    EXECUTION_RETENTION_ENABLED: bool = False
    #: Days of journal kept beyond an order's own settlement (the cutoff
    #: applies to the event AND the order's terminal stamp - core law 2).
    #: Bounds are enforced by constructing the core policy below; this
    #: service has no second arithmetic for them.
    EXECUTION_RETENTION_EVENT_DAYS: int = 90
    #: Rows per DELETE statement, and statements per run. Together they
    #: cap one run at batch_rows * max_batches deletions - the ceiling a
    #: busy deployment tunes, and the reason a first prune after long
    #: dormancy is many small transactions instead of one huge one.
    EXECUTION_RETENTION_BATCH_ROWS: int = 2_000
    EXECUTION_RETENTION_MAX_BATCHES: int = 50

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if self.EXECUTION_INTERNAL_TOKEN is None or not self.EXECUTION_INTERNAL_TOKEN.strip():
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN is required (>= 32 chars); this "
                "service never starts unauthenticated"
            )
        if len(self.EXECUTION_INTERNAL_TOKEN) < 32:
            raise ValueError("EXECUTION_INTERNAL_TOKEN must be at least 32 characters")
        lowered = self.EXECUTION_INTERNAL_TOKEN.strip().lower()
        if lowered in _PLACEHOLDERS or lowered.startswith(_PLACEHOLDER_PREFIXES):
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN must not be a placeholder value "
                "(exact match or changeme-style prefix)"
            )
        if self.EXECUTION_INSTANCE_ID is None or not self.EXECUTION_INSTANCE_ID.strip():
            raise ValueError(
                "EXECUTION_INSTANCE_ID is required - every leader claim, log "
                "line and incident must be attributable to a process"
            )
        if len(self.EXECUTION_INSTANCE_ID) > 64:
            raise ValueError("EXECUTION_INSTANCE_ID must be at most 64 characters")
        if self.SERVICE_PORT < 1 or self.SERVICE_PORT > 65_535:
            raise ValueError("SERVICE_PORT must be a valid TCP port")
        if self.EXECUTION_REQUEST_TIMEOUT_MS < 250:
            raise ValueError(
                "EXECUTION_REQUEST_TIMEOUT_MS below 250 tests the venue, not the network"
            )
        if self.EXECUTION_LOCK_TTL_MS < 1_000:
            raise ValueError(
                "EXECUTION_LOCK_TTL_MS below one second elects on network jitter"
            )
        if self.EXECUTION_SIMULATED_MID is not None:
            _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, sep, amount = part.partition("=")
            if not sep or not asset.strip():
                raise ValueError(
                    "EXECUTION_PAPER_BALANCES must be comma-separated ASSET=QUANTITY pairs"
                )
            _parse_decimal(amount, f"balance {asset.strip()!r}")
        # An EMPTY/whitespace DSN is treated as "unset" everywhere (compose
        # passes ${VAR:-} defaults; "" must not arm the mismatch law below).
        dsn = (self.EXECUTION_POSTGRES_DSN or "").strip()
        if self.EXECUTION_STORE_BACKEND == "postgres":
            if not dsn:
                raise ValueError(
                    "EXECUTION_STORE_BACKEND=postgres requires EXECUTION_POSTGRES_DSN; "
                    "a durable store that was configured but cannot connect is a "
                    "startup failure, never a degraded start"
                )
            if not dsn.startswith(("postgresql://", "postgresql+asyncpg://", "postgres://")):
                raise ValueError(
                    "EXECUTION_POSTGRES_DSN must be a postgresql:// connection string"
                )
        elif dsn:
            # A DSN present while the memory backend is selected means
            # somebody INTENDED durability and the setting silently did not
            # apply - the worst of both worlds (restart loses orders,
            # operator believes it cannot). Refuse the mismatched intent.
            raise ValueError(
                "EXECUTION_POSTGRES_DSN is set but EXECUTION_STORE_BACKEND=memory; "
                "either switch the backend to postgres or remove the DSN - a "
                "half-configured durable store is not a store"
            )
        # Retention bounds exist ONCE, in the core law; constructing the
        # policy here means a config typo names its env var at boot, and
        # an invalid policy can never reach a DELETE statement at all.
        try:
            RetentionPolicy(
                event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
                batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
                max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
            )
        except RetentionError as error:
            raise ValueError(
                f"retention configuration rejected by the core law: {error} "
                "(EXECUTION_RETENTION_EVENT_DAYS / _BATCH_ROWS / _MAX_BATCHES)"
            ) from error
        return self

    @property
    def retention_policy(self) -> RetentionPolicy:
        """The core's validated policy, built from this service's fields.

        Constructed (not stored) so Settings stays a plain env reader and
        the bound-checking law has exactly one home; the startup validator
        above calls this to fail boot on a nonsensical configuration.
        """
        return RetentionPolicy(
            event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
            batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
            max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
        )

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def simulated_mid(self) -> Decimal | None:
        if self.EXECUTION_SIMULATED_MID is None:
            return None
        return _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")

    @property
    def paper_balances(self) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, _, amount = part.partition("=")
            out[asset.strip().upper()] = _parse_decimal(amount, "balance")
        return out

    def to_public_dict(self) -> dict[str, object]:
        """Everything except secrets - safe for the status endpoint and logs.

        The internal token is the one value this object must never leak, and
        the whitelist shape (constructing the view field by field) is how
        that stays true when fields are added later: a new secret appears in
        the public view only if someone adds it there deliberately.
        """
        return {
            "nodeEnv": self.NODE_ENV,
            "instanceId": self.EXECUTION_INSTANCE_ID,
            "servicePort": self.SERVICE_PORT,
            "mode": self.EXECUTION_MODE,
            "dryRun": self.EXECUTION_DRY_RUN,
            "requestTimeoutMillis": self.EXECUTION_REQUEST_TIMEOUT_MS,
            "lockTtlMillis": self.EXECUTION_LOCK_TTL_MS,
            "simulatedMidConfigured": self.EXECUTION_SIMULATED_MID is not None,
            "paperBalanceAssets": sorted(self.paper_balances),
            # The DSN itself never appears here (whitelist law); the boolean
            # says "a credential is present" without saying anything about it.
            "storeBackend": self.EXECUTION_STORE_BACKEND,
            "postgresDsnConfigured": (self.EXECUTION_POSTGRES_DSN or "").strip() != "",
            # Retention is configuration an operator must be able to SEE
            # from the outside (is apply enabled? what does "days" mean
            # here?) - all four values are non-secret by construction.
            "retentionEnabled": self.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.EXECUTION_RETENTION_EVENT_DAYS,
            "retentionBatchRows": self.EXECUTION_RETENTION_BATCH_ROWS,
            "retentionMaxBatches": self.EXECUTION_RETENTION_MAX_BATCHES,
        }


def _parse_decimal(raw: str, what: str) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except InvalidOperation as error:
        raise ValueError(f"{what} must be a decimal number") from error
    if not value.is_finite():
        raise ValueError(f"{what} must be finite")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()
```


## FILE: services/execution-engine/app/schemas.py (236 lines)

*five retention wire models (run/inspect requests, the run answer mirroring the ledger row, the run view, the inspect answer) on the same _WireModel law - camelCase aliases, extra=forbid - and StatusResponse's two new fields defaulting to the shipped posture so a pre-Part-14 engine cannot be read as having run retention.*

```python
"""Request and response models for the internal execution API.

Alias conventions match the trading engine: fields are snake_case
internally, camelCase on the wire, populated by name on input so a worker
cannot smuggle a mistyped payload past validation by coincidence.

Everything here is a CONTROL shape. No model accepts an order to place;
no model returns a credential, key or signed payload. Decimal-valued
fields serialise as decimal STRINGS: a JSON float for a
quantity or balance is a silent rounding decision, and money never takes
one of those on the platform's behalf.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = [
    "AccountCommandRequest",
    "BalanceView",
    "BalancesResponse",
    "CancelOrderRequest",
    "CancelOrderResponse",
    "CommandRejected",
    "DiscrepancyView",
    "ReconcileResponse",
    "RetentionInspectRequest",
    "RetentionInspectResponse",
    "RetentionRunRequest",
    "RetentionRunResponse",
    "RetentionRunView",
    "StatusResponse",
    "VerifyResponse",
]

_TENANT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
_ACCOUNT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def _to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


class _WireModel(BaseModel):
    """Base for every model on this wire: camelCase aliases (the platform's
    API style, matched by the trading engine), snake_case fields (the
    core's style), ``extra=forbid`` so a payload containing fields BEYOND
    the contract - a venue key slipped in by a buggy producer, say - is a
    422 rather than a silently ignored surprise."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid"
    )


class AccountCommandRequest(_WireModel):
    """Payload for the three account commands.

    ``tenantId``/``accountId`` echo the job payload; the router still
    enforces the TENANT header match - a body that agrees with the header
    is provenance, a body that merely exists is not.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class CancelOrderRequest(_WireModel):
    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    client_order_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=32)
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class VerifyResponse(_WireModel):
    verified: bool
    note: str
    is_simulated: bool = True


class BalanceView(_WireModel):
    asset: str
    free: str
    locked: str

    @field_validator("free", "locked")
    @classmethod
    def _decimalish(cls, value: str) -> str:
        from decimal import Decimal, InvalidOperation

        try:
            parsed = Decimal(value)
        except InvalidOperation as error:
            raise ValueError("balances must serialise as decimal strings") from error
        if not parsed.is_finite():
            raise ValueError("balances must be finite")
        return value


class BalancesResponse(_WireModel):
    balances: list[BalanceView]
    is_simulated: bool = True


class DiscrepancyView(_WireModel):
    discrepancy_type: str
    summary: str
    order_id: str | None
    repaired: bool


class ReconcileResponse(_WireModel):
    tenant_id: str
    account_id: str
    exchange: str
    orders_checked: int
    fills_recovered: int
    discrepancy_count: int
    discrepancies: list[DiscrepancyView]
    error: str | None
    started_at_micros: int
    finished_at_micros: int


class CancelOrderResponse(_WireModel):
    """The engine's honest verdict on a cancel request.

    ``outcome`` carries ExecutionEngine vocabulary (ACCEPTED,
    REJECTED_LOCALLY, REJECTED_BY_EXCHANGE, DUPLICATE, DRY_RUN, UNKNOWN);
    the worker's ack policy reads THIS, not the HTTP code: 200 +
    REJECTED_LOCALLY is a completed job, 5xx is a retryable failure, and
    conflating the two is how cancelled-twice becomes cancelled-never.
    """

    outcome: str
    client_order_id: str
    order_status: str
    error_code: str | None
    message: str | None
    latency_micros: int
    is_simulated: bool


class CommandRejected(_WireModel):
    """Error body shared by 403/404/501 paths."""

    code: str
    message: str


class StatusResponse(_WireModel):
    instance_id: str
    mode: str
    dry_run: bool
    adapter: str
    store: str
    store_durable: bool
    #: "memory" | "postgres" as the SERVICE was configured - independent of
    #: store_durable on purpose: the worker can tell "class name says
    #: Postgres, config says memory" (impossible wiring) apart from either
    #: alone. Defaults to "unknown" (not "memory") so a response from a
    #: pre-Part-13 engine reads as unproven, never as a claimed fact.
    store_backend: str = "unknown"
    #: Retention visibility on the SAME surface the worker asserts against:
    #: "is a prune possible from this engine, and what does 'days' mean
    #: here" are questions an operator asks the status endpoint, not the
    #: source. Defaults state the shipped config (disabled, 90) so a
    #: pre-Part-14 engine's response cannot be read as "retention ran".
    retention_enabled: bool = False
    retention_event_days: int = 90
    locks_distributed: bool
    commands: list[str]
    simulated: bool = True


class RetentionRunRequest(_WireModel):
    """The run command's body. ``dryRun`` DEFAULTS TRUE: the field a typo
    could flip is the one that DELETES, so deletion requires an explicit
    ``"dryRun": false``, and even that only reaches the DELETE statements
    when EXECUTION_RETENTION_ENABLED says the deployment means it."""

    tenant_id: str = _TENANT
    dry_run: bool = True


class RetentionInspectRequest(_WireModel):
    """The read-only sibling: current count + recent runs, no deletion."""

    tenant_id: str = _TENANT


class RetentionRunResponse(_WireModel):
    """One run's account, mirroring the ledger row it just wrote.

    ``ledgerWritten`` is part of the contract because the ledger failure
    path is a real one (deletes landed, record did not): an operator
    reading `false` here knows the HTTP body IS the durable-ish copy and
    must reconcile against the log line before scheduling more.
    """

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


class RetentionRunView(_WireModel):
    """A ledger row as read back; every field is a number or a label."""

    seq: int
    started_at: int
    finished_at: int
    dry_run: bool
    event_cutoff_us: int
    rows_deleted: int
    batches: int
    exhausted: bool
    instance_id: str


class RetentionInspectResponse(_WireModel):
    enabled: bool
    event_retention_days: int
    batch_rows: int
    max_batches: int
    cutoff_us: int
    prunable_now: int
    runs: list[RetentionRunView]
```


## FILE: services/execution-engine/app/composition.py (270 lines)

*describe() grows retentionEnabled/retentionEventDays beside the store posture - visible to the worker's status read, deliberately NOT added to its compatibility law (commands do not touch the journal).*

```python
"""The single composition root of the execution plane.

Everything the engine touches - adapter, store, locks, incidents, risk - is
built exactly once, here, and every choice is mode-gated at construction
rather than at first use. This is the same discipline
:class:`wlct_trading.execution.engine.ExecutionEngine` applies internally
(:meth:`_assert_wiring_is_safe` refuses unsafe combinations), lifted from
"the library you wire" to "the service you deploy": a misconfiguration kills
startup, not the first customer order.

What is deliberately absent:

* no live venue adapter - ``EXECUTION_MODE=live`` is refused here even
  though the core supports it: as of Part 13 the durable store ships and
  distributed locks exist in the core, but the live credential provider and
  the venue-ordering audit for authenticated order placement have not
  completed their review, so refusing is still the honest wiring. The
  refusal is code, not a default, and no environment value talks the
  process into it;
* no order-submission endpoint - the platform's producers enqueue account
  maintenance and cancellation today (see the queue-consumer inventory in
  docs/PART11_WORKER_SCALING.md); a worker must not grow capabilities its
  producers never send;
* no silently-degraded store - ``EXECUTION_STORE_BACKEND=memory`` keeps
  the process-local simulated store (readiness reports ``storeDurable:
  false``, exactly as before), and ``postgres`` only starts when the
  lifespan hands ``build_runtime`` a live pool whose tables exist. A
  durable mode that could not reach its database kills startup; it never
  "falls back to memory", because silent fallback is how a durability
  incident becomes a data-loss incident.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from wlct_trading.adapters.base import AccountAdapter, TradingAdapter
from wlct_trading.adapters.paper import PaperAccountAdapter, PaperTradingAdapter
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.engine import ExecutionEngine
from wlct_trading.execution.incidents import InMemoryIncidentRecorder
from wlct_trading.execution.locks import InMemoryLockManager, LockManager
from wlct_trading.execution.reconciliation import ReconciliationService
from wlct_trading.execution.store import InMemoryOrderStore, OrderStore
from wlct_trading.market_data import BookTop
from wlct_trading.risk import RiskEngine, RiskLimits

from app.config import Settings

__all__ = [
    "SUPPORTED_COMMANDS",
    "EngineRuntime",
    "ExecutionUnavailable",
    "build_runtime",
]

logger = logging.getLogger(__name__)

#: Commands this runtime executes end to end. The worker's processor checks
#: membership against this set (fetched from /status at startup and again on
#: every request path via the 501 response) rather than hardcoding a
#: parallel list - one place decides what is supported, and it decides at
#: boot, not by accident of which file was edited last.
SUPPORTED_COMMANDS: frozenset[str] = frozenset(
    {
        "verify-exchange-credentials",
        "refresh-account-balances",
        "reconcile-trading-account",
        "cancel-order",
    }
)

#: Conservative numeric limits for the simulated runtime, matching the
#: harness the core's own execution tests pin against. All-`None` limits
#: would also construct; they would also mean the one process holding the
#: money path ships without speed bumps, and "simulated" is not a reason to
#: practise with the guards off.
SIMULATED_LIMITS = RiskLimits(
    max_order_quantity=Decimal("1000"),
    max_order_notional=Decimal("1000000"),
    max_position_quantity=Decimal("5000000"),
    max_symbol_exposure_notional=Decimal("5000000"),
    max_account_exposure_notional=Decimal("10000000"),
    max_open_orders=100,
    max_orders_per_minute=100,
    max_daily_loss=Decimal("1000000"),
    max_price_deviation_percent=Decimal("50"),
    max_market_data_age_micros=60_000_000,
)


class ExecutionUnavailable(RuntimeError):
    """The runtime cannot serve in the current wiring.

    Surfaced as 503 (or a startup refusal): "not wired yet" is an
    operational fact callers can act on - retry later, alert a human -
    which a raw ``NoneType`` is not.
    """


@dataclass(slots=True)
class EngineRuntime:
    """The assembled execution plane, shared by all request handlers.

    The engine, store, recorder and reconciler are the same objects for the
    process lifetime: :class:`ExecutionEngine` documents itself as safe to
    share across tenants because every store/lock call is tenant-scoped,
    while a second instance would silently double any in-memory ledger - the
    one failure mode a "just build another one" refactor introduces.
    """

    engine: ExecutionEngine
    store: OrderStore
    locks: LockManager
    incidents: InMemoryIncidentRecorder
    trading_adapter: TradingAdapter
    account_adapter: AccountAdapter
    reconciliation: ReconciliationService
    settings: Settings

    def describe(self) -> dict[str, Any]:
        """Public, secret-free description of the wiring, for /status and
        for the worker to assert against before forwarding anything."""
        return {
            "mode": self.settings.EXECUTION_MODE,
            "dryRun": self.settings.EXECUTION_DRY_RUN,
            "instanceId": self.settings.EXECUTION_INSTANCE_ID,
            "adapter": type(self.trading_adapter).__name__,
            "store": type(self.store).__name__,
            "storeBackend": self.settings.EXECUTION_STORE_BACKEND,
            # getattr mirrors the core engine reading this OPTIONAL port
            # attribute the same duck-typed way (OrderStore documents it as a
            # MAY); defaulting False means "unproven durable" - fail-closed.
            "storeDurable": bool(getattr(self.store, "is_durable", False)),
            # Retention posture travels with the store posture: a durable
            # store nobody prunes and a prune that cannot reach a memory
            # store are both states the caller should see, not infer.
            "retentionEnabled": self.settings.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.settings.EXECUTION_RETENTION_EVENT_DAYS,
            "locksDistributed": self.locks.is_distributed,
            "commands": sorted(SUPPORTED_COMMANDS),
        }


def make_paper_book_provider(
    mid: Decimal | None,
) -> Callable[[ExchangeId, str], BookTop | None]:
    """The book function the paper adapter prices against.

    A fixed mid when configured, an empty book otherwise. The empty book is
    not an oversight: "no reference price" makes the adapter refuse rather
    than invent, which is the correct behaviour for a simulated venue nobody
    configured. Every price that DOES exist here is simulated by
    construction; nothing in this function pretends to be a market.
    """

    def provider(exchange: ExchangeId, symbol: str) -> BookTop | None:
        if mid is None:
            return None
        return BookTop(
            exchange=exchange,
            symbol=symbol,
            best_bid=mid,
            best_bid_quantity=Decimal("1"),
            best_ask=mid,
            best_ask_quantity=Decimal("1"),
            sequence=0,
            exchange_timestamp=0,
            received_timestamp=0,
        )

    return provider


def build_runtime(settings: Settings, store: OrderStore | None = None) -> EngineRuntime:
    """Construct the execution plane, or refuse loudly at startup.

    ``store`` is the durable adapter's injection point: the lifespan owns
    the pool (it must create it before any request can be served and close
    it on shutdown, and it verifies the tables exist), while this function
    owns the WIRING - which combinations may exist at all. A postgres
    backend reached without an injected store, or an injected store under a
    memory backend, is a bug in the composition path, and bugs in this path
    die here rather than in the first order that quietly went unsaved.
    """
    if settings.EXECUTION_MODE == "live":
        raise ExecutionUnavailable(
            "EXECUTION_MODE=live is not wired in this build: the durable "
            "store landed in Part 13 and the core ships distributed locks, "
            "but the live credential provider and the authenticated "
            "order-placement review are unfinished - the core engine "
            "itself still guards live transmission. Simulated mode is "
            "available now; live refuses at startup rather than failing at "
            "the first order."
        )
    if settings.EXECUTION_STORE_BACKEND == "postgres" and store is None:
        raise ExecutionUnavailable(
            "EXECUTION_STORE_BACKEND=postgres requires the lifespan-injected "
            "pool store; a postgres-wired engine built over a memory store "
            "would report durability it does not have"
        )
    if settings.EXECUTION_STORE_BACKEND == "memory" and store is not None:
        raise ExecutionUnavailable(
            "an injected durable store under EXECUTION_STORE_BACKEND=memory "
            "means the config and the wiring disagree; refusing to guess "
            "which one the operator meant"
        )
    if store is None:
        store = InMemoryOrderStore()

    trading = PaperTradingAdapter(make_paper_book_provider(settings.simulated_mid))
    account = PaperAccountAdapter(settings.paper_balances)
    locks = InMemoryLockManager()
    incidents = InMemoryIncidentRecorder()
    risk_engine = RiskEngine(SIMULATED_LIMITS)
    reconciliation = ReconciliationService(
        trading=trading,
        account=account,
        store=store,
        incidents=incidents,
        locks=locks,
    )

    engine_settings = ExecutionSettings(
        live_trading_enabled=False,
        dry_run=settings.EXECUTION_DRY_RUN,
        paper_trading=True,
        trading_mode_setting="PAPER",
        trading_enabled=True,
        live_trading_confirmed=False,
        order_request_timeout_ms=settings.EXECUTION_REQUEST_TIMEOUT_MS,
    )
    engine = ExecutionEngine(
        adapter=trading,
        settings=engine_settings,
        risk_engine=risk_engine,
        store=store,
        locks=locks,
        incidents=incidents,
        default_lock_ttl_millis=settings.EXECUTION_LOCK_TTL_MS,
    )
    logger.info(
        "execution_engine.runtime_built",
        extra={
            "event": "execution_engine.runtime_built",
            "wiring": {
                "store": type(store).__name__,
                "storeBackend": settings.EXECUTION_STORE_BACKEND,
                "locks": type(locks).__name__,
                "adapter": type(trading).__name__,
                "dryRun": engine_settings.dry_run,
                "simulatedMidConfigured": settings.simulated_mid is not None,
            },
        },
    )
    return EngineRuntime(
        engine=engine,
        store=store,
        locks=locks,
        incidents=incidents,
        trading_adapter=trading,
        account_adapter=account,
        reconciliation=reconciliation,
        settings=settings,
    )
```


## FILE: services/execution-engine/app/main.py (162 lines)

*two lines: the retention router import and its include; the lifespan was already pool-owning since Part 13, and this part consumes that seam rather than widening it.*

```python
"""Execution engine application factory.

The process owns the money path's runtime and nothing else: no public
routes, no admin surface, no UI. Startup is where wiring mistakes die -
``build_runtime`` refuses live mode, ``get_settings`` refuses missing or
placeholder secrets - so the first request ever served meets either a fully
composed engine or no process at all.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.composition import build_runtime
from app.config import get_settings
from app.logging_config import configure_logging
from app.pg_store import open_durable_store
from app.routers import health, internal, retention
from app.security import REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

#: Response header echoing the correlation id, matching the platform's
#: convention so a worker log line and an engine log line join on it.
CORRELATION_HEADER = "x-correlation-id"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Raises through startup on any refused combination - live mode,
        # catalog incoherence - which is the whole safety design: a process
        # that cannot state its wiring does not serve traffic.
        store = None
        pool = None
        if settings.EXECUTION_STORE_BACKEND == "postgres":
            pool, store = await open_durable_store(settings)
        app.state.runtime = build_runtime(settings, store=store)
        app.state.store_pool = pool
        logger.info(
            "execution_engine.started",
            extra={
                "event": "execution_engine.started",
                "instance_id": settings.EXECUTION_INSTANCE_ID,
                "version": __version__,
                "wiring": (app.state.runtime.describe() if hasattr(app.state, "runtime") else {}),
            },
        )
        yield
        if pool is not None:
            await pool.close()
        logger.info("execution_engine.stopped", extra={"event": "execution_engine.stopped"})

    app = FastAPI(
        title="wlct execution engine",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    @app.middleware("http")
    async def correlation(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Best-effort id continuity: honour a well-formed incoming id (the
        # worker sends its job's x-request-id), mint one otherwise. Capped
        # at 128 chars so a hostile header cannot bloat every log line.
        incoming = request.headers.get(REQUEST_ID_HEADER)
        correlation_id = (
            incoming
            if incoming is not None and 0 < len(incoming) <= 128 and _printable(incoming)
            else f"eng-{uuid.uuid4().hex[:20]}"
        )
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers[CORRELATION_HEADER] = correlation_id
        return response

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field locations only, never values: a rejected payload may contain
        # exactly the thing it should not, and 422 bodies get screenshotted.
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_FAILED",
                "message": "The command payload does not satisfy the contract.",
                "fields": [
                    {"location": ".".join(str(part) for part in err.get("loc", ())),
                     "type": str(err.get("type", "value_error"))}
                    for err in exc.errors()
                ],
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        raw_detail: object = exc.detail
        if isinstance(raw_detail, dict):
            content: dict[str, object] = raw_detail
        else:
            content = {
                "code": f"HTTP_{exc.status_code}",
                "message": str(raw_detail),
            }
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "execution_engine.unhandled",
            extra={
                "event": "execution_engine.unhandled",
                "path": request.url.path,
                "correlation_id": getattr(request.state, "correlation_id", None),
            },
        )
        # The message is for the logs; the client gets a retryable 500 with
        # the correlation id - never an exception string, which is how
        # internal shapes leak and secrets travel.
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "The command failed inside the engine; retry is permitted.",
                "correlationId": getattr(request.state, "correlation_id", ""),
            },
        )

    app.include_router(health.router)
    app.include_router(internal.router)
    app.include_router(retention.router)
    return app


def _printable(candidate: str) -> bool:
    return all(32 <= ord(ch) < 127 for ch in candidate)


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.EXECUTION_ENGINE_HOST,
        port=settings.SERVICE_PORT,
        log_config=None,  # uvicorn's default logging would bypass the redaction pipeline
    )
```


## FILE: apps/api/prisma/schema.prisma (4181 lines)

*the ExecutionRetentionRun model (seq identity, micros law, dry-run-is-evidence comment, cutoff frozen into the row, batches accounting, instance attribution, Restrict tenant FK, the latest-N index) and the Tenant back-relation; prisma format again left every pre-existing byte in place.*

```prisma
// =============================================================================
// White-Label Crypto Copy-Trading Platform - Prisma schema (Part 1 foundation)
// =============================================================================
// Design rules enforced here:
//  * UUID primary keys everywhere (no sequential ids leaking volume/ordering).
//  * Every tenant-scoped table carries `tenantId` as the FIRST column of its
//    composite indexes and unique constraints, so a query that forgets the
//    tenant filter cannot accidentally hit another brand's rows through an
//    index scan, and uniqueness is always per tenant.
//  * `deletedAt` soft deletion on aggregates that must survive for audit or
//    billing reasons; hard delete for ephemeral rows (tokens, sessions).
//  * Cascade deletes only downwards from an aggregate root (tenant -> user ->
//    session). Audit rows never cascade: they outlive their subject.
//  * Trading tables are intentionally NOT defined yet; the `TenantSetting`,
//    `FeatureFlag` and role/permission tables are generic enough that Part 2
//    can add them without touching this file's semantics.
// =============================================================================

generator client {
  provider        = "prisma-client-js"
  binaryTargets   = ["native"]
  previewFeatures = []
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

enum TenantStatus {
  PENDING
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum TenantDomainStatus {
  PENDING_DNS
  PENDING_CERTIFICATE
  ACTIVE
  FAILED
}

enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
  LOCKED
  DEACTIVATED
}

enum KycStatus {
  NOT_STARTED
  PENDING
  IN_REVIEW
  APPROVED
  REJECTED
  EXPIRED
}

enum RoleScope {
  PLATFORM
  TENANT
}

enum TwoFactorMethod {
  TOTP
  EMAIL
  SMS
}

enum TwoFactorStatus {
  PENDING_ACTIVATION
  ACTIVE
  DISABLED
}

enum TokenStatus {
  ACTIVE
  ROTATED
  REVOKED
  EXPIRED
}

enum AuditActorType {
  USER
  SYSTEM
  SERVICE
  API_KEY
}

enum AuditOutcome {
  SUCCESS
  FAILURE
  DENIED
}

enum SecurityEventType {
  SUSPICIOUS_LOGIN
  NEW_DEVICE_LOGIN
  IMPOSSIBLE_TRAVEL
  BRUTE_FORCE_SUSPECTED
  CREDENTIAL_STUFFING_SUSPECTED
  TOKEN_REUSE
  RATE_LIMIT_ABUSE
  PERMISSION_ESCALATION_ATTEMPT
  TENANT_ISOLATION_VIOLATION
  ENCRYPTION_FAILURE
}

enum SecuritySeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum BillingInterval {
  MONTHLY
  QUARTERLY
  YEARLY
  LIFETIME
}

enum PlanAudience {
  TENANT
  END_USER
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
  PAUSED
}

enum VerificationTokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  INVITATION
  EMAIL_CHANGE
}

enum NotificationChannel {
  IN_APP
  EMAIL
  PUSH
  SMS
  WEBHOOK
  TELEGRAM
}

// -----------------------------------------------------------------------------
// Tenancy
// -----------------------------------------------------------------------------

model Tenant {
  id        String       @id @default(uuid()) @db.Uuid
  slug      String       @unique @db.VarChar(63)
  name      String       @db.VarChar(120)
  legalName String?      @map("legal_name") @db.VarChar(160)
  status    TenantStatus @default(PENDING)

  ownerUserId String? @map("owner_user_id") @db.Uuid

  contactEmail String? @map("contact_email") @db.VarChar(254)
  contactPhone String? @map("contact_phone") @db.VarChar(20)
  countryCode  String? @map("country_code") @db.Char(2)

  defaultLocale       String   @default("en") @map("default_locale") @db.VarChar(8)
  supportedLocales    String[] @default(["en"])
  defaultCurrency     String   @default("USD") @map("default_currency") @db.VarChar(3)
  supportedCurrencies String[] @default(["USD"])
  timezone            String   @default("UTC") @db.VarChar(64)

  // Commercial configuration expressed in basis points to avoid float drift.
  platformFeeBps    Int @default(0) @map("platform_fee_bps")
  performanceFeeBps Int @default(2000) @map("performance_fee_bps")

  maxUsers   Int? @map("max_users")
  maxTraders Int? @map("max_traders")

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  branding       TenantBranding?
  settings       TenantSetting[]
  domains        TenantDomain[]
  users          User[]
  roles          Role[]
  subscriptions  TenantSubscription[]
  plans          SubscriptionPlan[]
  featureFlags   TenantFeatureFlag[]
  auditLogs      AuditLog[]
  securityEvents SecurityEvent[]
  apiKeys        TenantApiKey[]
  notifications  Notification[]
  kycProfiles    KycProfile[]

  // Part 2 - trading control plane. Every trading aggregate is tenant-scoped
  // so the isolation invariant established in Part 1 extends unchanged into
  // the trading domain.
  tradingAccounts           TradingAccount[]
  tradingSymbols            TradingSymbol[]
  strategies                Strategy[]
  orders                    Order[]
  positions                 Position[]
  riskConfigurations        RiskConfiguration[]
  riskEvents                RiskEvent[]
  // Part 8 back-relations (cascade mirrors riskConfigurations' shape).
  riskConfigurationVersions RiskConfigurationVersion[]
  riskSnapshotMetadata      RiskSnapshotMetadata[]
  riskProtectionActions     RiskProtectionTrip[]

  // Part 9 - operations. Alerts and incidents are tenant-scoped where the
  // condition is; platform-wide infrastructure conditions carry a null
  // tenant and are visible to every console that may read operations.
  // SetNull on tenant removal: operational history outlives the tenant
  // relationship on purpose - it is evidence, not configuration.
  opsAlerts       OpsAlert[]
  opsIncidents    OpsIncident[]
  tradingSessions TradingSession[]
  killSwitches    KillSwitch[]

  // Part 5 - authenticated execution. Same rule: every aggregate that can be
  // traced back to a customer's money is tenant-scoped, so a query that forgets
  // the tenant filter fails to compile rather than leaking across tenants.
  accountBalances        AccountBalanceSnapshot[]
  exchangeStreamSessions ExchangeStreamSession[]
  reconciliationRuns     ReconciliationRun[]
  executionIncidents     ExecutionIncident[]

  // Part 6 - strategy layer. The definition catalogue and its versions are
  // platform-level (they describe code that ships with the release, not
  // customer data) and are deliberately absent here. Everything that records
  // what a tenant's strategy actually did is tenant-scoped.
  strategyRuns         StrategyRun[]
  strategyCheckpoints  StrategyCheckpoint[]
  strategyIncidents    StrategyIncident[]
  backtestRuns         BacktestRun[]
  backtestMetrics      BacktestMetric[]
  backtestTrades       BacktestTrade[]
  paperTradingSessions PaperTradingSession[]
  paperPortfolioSnaps  PaperPortfolioSnapshot[]

  // Part 13 - durable execution engine store. The engine service writes
  // these tables directly (asyncpg, app/store_sql.py); this schema owns
  // their DDL (migration + Prisma validate + the RLS coverage generator),
  // and the API reads them only for ops surfaces, never as a command path.
  // Restrict (not Cascade) on purpose: execution records are the audit of
  // money movement - a tenant with durable orders cannot be deleted out
  // from under its own history, and an accident at the FK is louder than a
  // silent delete.
  executionOrders        ExecutionOrder[]
  executionRetentionRuns ExecutionRetentionRun[]

  @@index([status])
  @@index([deletedAt])
  @@index([createdAt])
  @@map("tenants")
}

model TenantBranding {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @unique @map("tenant_id") @db.Uuid

  appName         String  @map("app_name") @db.VarChar(64)
  logoUrl         String? @map("logo_url") @db.VarChar(2048)
  logoDarkUrl     String? @map("logo_dark_url") @db.VarChar(2048)
  faviconUrl      String? @map("favicon_url") @db.VarChar(2048)
  primaryColor    String  @default("#1B2A4A") @map("primary_color") @db.VarChar(9)
  secondaryColor  String  @default("#0F172A") @map("secondary_color") @db.VarChar(9)
  accentColor     String  @default("#22C55E") @map("accent_color") @db.VarChar(9)
  backgroundColor String  @default("#FFFFFF") @map("background_color") @db.VarChar(9)
  textColor       String  @default("#0B1220") @map("text_color") @db.VarChar(9)
  fontFamily      String  @default("Inter") @map("font_family") @db.VarChar(64)
  themeMode       String  @default("system") @map("theme_mode") @db.VarChar(10)

  supportEmail String? @map("support_email") @db.VarChar(254)
  supportUrl   String? @map("support_url") @db.VarChar(2048)
  termsUrl     String? @map("terms_url") @db.VarChar(2048)
  privacyUrl   String? @map("privacy_url") @db.VarChar(2048)
  customCss    String? @map("custom_css") @db.Text
  socialLinks  Json    @default("{}") @map("social_links")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("tenant_branding")
}

model TenantSetting {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  key      String  @db.VarChar(64)
  value    Json
  category String  @default("general") @db.VarChar(32)
  /// When true the value column holds an encrypted envelope, never plaintext.
  isSecret Boolean @default(false) @map("is_secret")

  description String? @db.VarChar(240)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, key])
  @@index([tenantId, category])
  @@map("tenant_settings")
}

model TenantDomain {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  domain            String             @unique @db.VarChar(253)
  isPrimary         Boolean            @default(false) @map("is_primary")
  status            TenantDomainStatus @default(PENDING_DNS)
  verificationToken String             @map("verification_token") @db.VarChar(64)
  verifiedAt        DateTime?          @map("verified_at") @db.Timestamptz(6)
  certificateExpiry DateTime?          @map("certificate_expiry") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, isPrimary])
  @@index([status])
  @@map("tenant_domains")
}

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

model User {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  email        String  @db.VarChar(254)
  /// HMAC of the lowercase email; enables constant-time lookup and analytics
  /// without exposing the address in indexes shared with third-party tooling.
  emailIndex   String  @map("email_index") @db.VarChar(64)
  passwordHash String  @map("password_hash") @db.VarChar(255)
  phone        String? @db.VarChar(20)

  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz(6)
  phoneVerifiedAt DateTime? @map("phone_verified_at") @db.Timestamptz(6)

  status    UserStatus @default(PENDING_VERIFICATION)
  kycStatus KycStatus  @default(NOT_STARTED) @map("kyc_status")

  /// Platform staff (super admins) are attached to the platform tenant and can
  /// be authorised across tenants; ordinary users never can.
  isPlatformUser Boolean @default(false) @map("is_platform_user")

  twoFactorEnabled Boolean @default(false) @map("two_factor_enabled")

  failedLoginAttempts Int       @default(0) @map("failed_login_attempts")
  lockedUntil         DateTime? @map("locked_until") @db.Timestamptz(6)
  lastLoginAt         DateTime? @map("last_login_at") @db.Timestamptz(6)
  lastLoginIpHash     String?   @map("last_login_ip_hash") @db.VarChar(64)
  passwordChangedAt   DateTime  @default(now()) @map("password_changed_at") @db.Timestamptz(6)
  /// Bumped on password change / global logout to invalidate live access tokens.
  sessionVersion      Int       @default(0) @map("session_version")

  referralCode   String? @unique @map("referral_code") @db.VarChar(16)
  referredByCode String? @map("referred_by_code") @db.VarChar(16)

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant             Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile            UserProfile?
  roles              UserRole[]
  refreshTokens      RefreshToken[]
  sessions           UserSession[]
  twoFactor          TwoFactorAuth?
  recoveryCodes      TwoFactorRecoveryCode[]
  verificationTokens VerificationToken[]
  loginAttempts      LoginAttempt[]
  securityEvents     SecurityEvent[]
  notifications      Notification[]
  notificationPrefs  NotificationPreference[]
  kycProfile         KycProfile?
  assignedRoles      UserRole[]               @relation("RoleAssignedBy")

  /// Part 2 - exchange connections this user owns. Non-custodial: the user
  /// supplies their own trade-enabled, withdrawal-disabled API key.
  tradingAccounts TradingAccount[]

  @@unique([tenantId, email])
  @@unique([tenantId, emailIndex])
  @@index([tenantId, status])
  @@index([tenantId, createdAt])
  @@index([tenantId, deletedAt])
  @@index([emailIndex])
  @@map("users")
}

model UserProfile {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  firstName   String? @map("first_name") @db.VarChar(64)
  lastName    String? @map("last_name") @db.VarChar(64)
  displayName String? @map("display_name") @db.VarChar(64)
  avatarUrl   String? @map("avatar_url") @db.VarChar(2048)
  bio         String? @db.VarChar(500)
  countryCode String? @map("country_code") @db.Char(2)
  timezone    String  @default("UTC") @db.VarChar(64)
  locale      String  @default("en") @db.VarChar(8)

  preferredCurrency String  @default("USD") @map("preferred_currency") @db.VarChar(3)
  marketingOptIn    Boolean @default(false) @map("marketing_opt_in")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}

// -----------------------------------------------------------------------------
// RBAC
// -----------------------------------------------------------------------------

model Role {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId marks a platform-provided system role template.
  tenantId String? @map("tenant_id") @db.Uuid

  key         String    @db.VarChar(64)
  name        String    @db.VarChar(120)
  description String?   @db.VarChar(500)
  scope       RoleScope @default(TENANT)
  isSystem    Boolean   @default(false) @map("is_system")
  isDefault   Boolean   @default(false) @map("is_default")
  priority    Int       @default(100)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant      Tenant?          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  permissions RolePermission[]
  users       UserRole[]

  @@unique([tenantId, key])
  @@index([tenantId, scope])
  @@index([isSystem])
  @@map("roles")
}

model Permission {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  resource    String  @db.VarChar(48)
  action      String  @db.VarChar(32)
  description String? @db.VarChar(500)
  /// Permissions flagged dangerous require re-authentication before granting.
  isDangerous Boolean @default(false) @map("is_dangerous")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  roles RolePermission[]

  @@index([resource])
  @@map("permissions")
}

model RolePermission {
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([permissionId])
  @@map("role_permissions")
}

model UserRole {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  roleId String @map("role_id") @db.Uuid

  /// Denormalised for tenant-scoped index locality and defence in depth.
  tenantId String @map("tenant_id") @db.Uuid

  assignedById String?   @map("assigned_by_id") @db.Uuid
  assignedAt   DateTime  @default(now()) @map("assigned_at") @db.Timestamptz(6)
  expiresAt    DateTime? @map("expires_at") @db.Timestamptz(6)

  user       User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role  @relation(fields: [roleId], references: [id], onDelete: Cascade)
  assignedBy User? @relation("RoleAssignedBy", fields: [assignedById], references: [id], onDelete: SetNull)

  @@unique([userId, roleId])
  @@index([tenantId, roleId])
  @@index([userId])
  @@index([expiresAt])
  @@map("user_roles")
}

// -----------------------------------------------------------------------------
// Sessions, tokens and 2FA
// -----------------------------------------------------------------------------

model UserSession {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  deviceId   String  @map("device_id") @db.VarChar(128)
  deviceName String? @map("device_name") @db.VarChar(64)
  platform   String? @db.VarChar(16)
  appVersion String? @map("app_version") @db.VarChar(32)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  /// Coarse geo label ("BD/Dhaka") derived at login for impossible-travel checks.
  geoLabel   String? @map("geo_label") @db.VarChar(64)
  trusted    Boolean @default(false)

  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  lastSeenAt   DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]

  @@index([userId, revokedAt])
  @@index([tenantId, userId])
  @@index([expiresAt])
  @@index([deviceId])
  @@map("user_sessions")
}

model RefreshToken {
  id        String @id @default(uuid()) @db.Uuid
  userId    String @map("user_id") @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  sessionId String @map("session_id") @db.Uuid

  /// HMAC-SHA512 of the token. The raw value only ever exists in the response.
  tokenHash String      @unique @map("token_hash") @db.VarChar(128)
  /// Rotation family: reuse of any consumed token revokes the whole family.
  familyId  String      @map("family_id") @db.Uuid
  status    TokenStatus @default(ACTIVE)

  replacedByTokenId String? @map("replaced_by_token_id") @db.Uuid

  issuedAt     DateTime  @default(now()) @map("issued_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt       DateTime? @map("used_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)

  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  session UserSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([familyId])
  @@index([expiresAt])
  @@index([tenantId, userId])
  @@map("refresh_tokens")
}

model TwoFactorAuth {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  method TwoFactorMethod @default(TOTP)
  status TwoFactorStatus @default(PENDING_ACTIVATION)

  /// Envelope-encrypted TOTP secret: { ciphertext, iv, authTag, wrappedKey, keyId }.
  secretCiphertext Json   @map("secret_ciphertext")
  encryptionKeyId  String @map("encryption_key_id") @db.VarChar(64)

  lastVerifiedAt  DateTime? @map("last_verified_at") @db.Timestamptz(6)
  /// Last accepted TOTP counter, blocks replay of the same code.
  lastUsedCounter BigInt?   @map("last_used_counter")
  failedAttempts  Int       @default(0) @map("failed_attempts")
  activatedAt     DateTime? @map("activated_at") @db.Timestamptz(6)
  disabledAt      DateTime? @map("disabled_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("two_factor_auth")
}

model TwoFactorRecoveryCode {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  /// Argon2 hash of a single-use recovery code.
  codeHash   String    @map("code_hash") @db.VarChar(255)
  usedAt     DateTime? @map("used_at") @db.Timestamptz(6)
  usedIpHash String?   @map("used_ip_hash") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, usedAt])
  @@map("two_factor_recovery_codes")
}

model VerificationToken {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  type      VerificationTokenType
  tokenHash String                @unique @map("token_hash") @db.VarChar(128)
  payload   Json                  @default("{}")

  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(6)
  consumedAt DateTime? @map("consumed_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@index([expiresAt])
  @@map("verification_tokens")
}

model LoginAttempt {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String  @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  emailIndex String  @map("email_index") @db.VarChar(64)
  successful Boolean
  reason     String? @db.VarChar(64)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  deviceId   String? @map("device_id") @db.VarChar(128)
  geoLabel   String? @map("geo_label") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, emailIndex, createdAt])
  @@index([ipHash, createdAt])
  @@index([createdAt])
  @@map("login_attempts")
}

// -----------------------------------------------------------------------------
// Governance: audit, security, API keys
// -----------------------------------------------------------------------------

model AuditLog {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  actorType  AuditActorType @default(USER) @map("actor_type")
  actorId    String?        @map("actor_id") @db.Uuid
  actorEmail String?        @map("actor_email") @db.VarChar(254)

  action       String       @db.VarChar(64)
  outcome      AuditOutcome @default(SUCCESS)
  resourceType String?      @map("resource_type") @db.VarChar(64)
  resourceId   String?      @map("resource_id") @db.VarChar(64)
  description  String?      @db.VarChar(500)

  /// { field: { before, after } } with sensitive fields already redacted.
  changes  Json?
  metadata Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  /// Part 9: correlation metadata. requestId answers "which HTTP call",
  /// correlationId answers "which operational chain" (one user action, one
  /// engine sequence, one incident - whatever spans services), operationId
  /// answers "which unit of work within it". All three are bounded tokens;
  /// none of them is ever a secret. Additive columns: every pre-Part-9 row
  /// reads null, and no existing query changes meaning.
  correlationId String? @map("correlation_id") @db.VarChar(64)
  operationId   String? @map("operation_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([tenantId, action, createdAt])
  @@index([actorId, createdAt])
  @@index([resourceType, resourceId])
  @@index([createdAt])
  @@index([correlationId, createdAt])
  @@map("audit_logs")
}

model SecurityEvent {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  type        SecurityEventType
  severity    SecuritySeverity  @default(LOW)
  description String            @db.VarChar(500)
  metadata    Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  resolved     Boolean   @default(false)
  resolvedAt   DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedById String?   @map("resolved_by_id") @db.Uuid
  resolution   String?   @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
  @@index([severity, resolved])
  @@index([type, createdAt])
  @@map("security_events")
}

model TenantApiKey {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  name       String @db.VarChar(120)
  /// Public, non-secret identifier shown in dashboards.
  keyId      String @unique @map("key_id") @db.VarChar(48)
  /// HMAC of the secret half. The secret is displayed once at creation time.
  secretHash String @map("secret_hash") @db.VarChar(128)

  scopes      String[] @default([])
  ipAllowlist String[] @default([])

  lastUsedAt DateTime? @map("last_used_at") @db.Timestamptz(6)
  expiresAt  DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz(6)

  createdById String?  @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, revokedAt])
  @@map("tenant_api_keys")
}

// -----------------------------------------------------------------------------
// Commercial: plans, subscriptions, feature flags
// -----------------------------------------------------------------------------

model SubscriptionPlan {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId = platform catalogue plan sold to tenants.
  tenantId String? @map("tenant_id") @db.Uuid

  code        String       @db.VarChar(48)
  name        String       @db.VarChar(120)
  description String?      @db.VarChar(500)
  audience    PlanAudience @default(TENANT)

  price     Decimal         @db.Decimal(18, 6)
  currency  String          @default("USD") @db.VarChar(3)
  interval  BillingInterval @default(MONTHLY)
  trialDays Int             @default(0) @map("trial_days")

  performanceFeeBps Int @default(0) @map("performance_fee_bps")
  platformFeeBps    Int @default(0) @map("platform_fee_bps")

  limits   Json     @default("{}")
  features String[] @default([])

  isActive  Boolean @default(true) @map("is_active")
  sortOrder Int     @default(0) @map("sort_order")

  externalPriceId String? @map("external_price_id") @db.VarChar(128)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant        Tenant?              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscriptions TenantSubscription[]

  @@unique([tenantId, code])
  @@index([audience, isActive])
  @@map("subscription_plans")
}

model TenantSubscription {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  planId   String @map("plan_id") @db.Uuid

  status SubscriptionStatus @default(TRIALING)

  currentPeriodStart DateTime  @default(now()) @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd   DateTime  @map("current_period_end") @db.Timestamptz(6)
  trialEndsAt        DateTime? @map("trial_ends_at") @db.Timestamptz(6)

  cancelAtPeriodEnd Boolean   @default(false) @map("cancel_at_period_end")
  canceledAt        DateTime? @map("canceled_at") @db.Timestamptz(6)
  cancelReason      String?   @map("cancel_reason") @db.VarChar(500)

  seatsPurchased Int @default(1) @map("seats_purchased")

  externalCustomerId     String? @map("external_customer_id") @db.VarChar(128)
  externalSubscriptionId String? @map("external_subscription_id") @db.VarChar(128)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan   SubscriptionPlan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@index([tenantId, status])
  @@index([status, currentPeriodEnd])
  @@map("tenant_subscriptions")
}

model FeatureFlag {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  name        String  @db.VarChar(120)
  description String? @db.VarChar(500)

  isGlobalDefault   Boolean @default(false) @map("is_global_default")
  rolloutPercentage Int     @default(100) @map("rollout_percentage")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenantOverrides TenantFeatureFlag[]

  @@map("feature_flags")
}

model TenantFeatureFlag {
  id            String @id @default(uuid()) @db.Uuid
  tenantId      String @map("tenant_id") @db.Uuid
  featureFlagId String @map("feature_flag_id") @db.Uuid

  enabled           Boolean @default(false)
  rolloutPercentage Int?    @map("rollout_percentage")
  metadata          Json    @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  featureFlag FeatureFlag @relation(fields: [featureFlagId], references: [id], onDelete: Cascade)

  @@unique([tenantId, featureFlagId])
  @@index([tenantId, enabled])
  @@map("tenant_feature_flags")
}

// -----------------------------------------------------------------------------
// Compliance and notifications (foundation only)
// -----------------------------------------------------------------------------

model KycProfile {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @unique @map("user_id") @db.Uuid

  status              KycStatus @default(NOT_STARTED)
  provider            String?   @db.VarChar(32)
  /// Identifier issued by the KYC vendor; no document data is stored locally.
  externalApplicantId String?   @map("external_applicant_id") @db.VarChar(128)
  levelName           String?   @map("level_name") @db.VarChar(64)

  submittedAt     DateTime? @map("submitted_at") @db.Timestamptz(6)
  reviewedAt      DateTime? @map("reviewed_at") @db.Timestamptz(6)
  expiresAt       DateTime? @map("expires_at") @db.Timestamptz(6)
  rejectionReason String?   @map("rejection_reason") @db.VarChar(500)

  riskScore Int? @map("risk_score")
  metadata  Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
  @@map("kyc_profiles")
}

model Notification {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @map("user_id") @db.Uuid

  channel NotificationChannel @default(IN_APP)
  type    String              @db.VarChar(64)
  title   String              @db.VarChar(160)
  body    String              @db.VarChar(1000)
  data    Json                @default("{}")

  readAt        DateTime? @map("read_at") @db.Timestamptz(6)
  deliveredAt   DateTime? @map("delivered_at") @db.Timestamptz(6)
  failedAt      DateTime? @map("failed_at") @db.Timestamptz(6)
  failureReason String?   @map("failure_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId, createdAt])
  @@index([userId, readAt])
  @@map("notifications")
}

model NotificationPreference {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  category String              @db.VarChar(48)
  channel  NotificationChannel
  enabled  Boolean             @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, category, channel])
  @@map("notification_preferences")
}

// =============================================================================
// PART 2 - ALGORITHMIC TRADING DOMAIN
// =============================================================================
// Everything below models the trading *control plane*: configuration, audit and
// the durable record of what was decided and what happened. It deliberately
// does NOT model the hot path. Order books, live quotes and in-flight risk
// counters live in process memory and Redis; putting them here would force a
// PostgreSQL round trip into the market-data loop, which is exactly what the
// architecture forbids.
//
// What is persisted, and why:
//  * Orders, fills, positions and risk events - the financial record. Must
//    survive a crash and be auditable years later.
//  * Strategies, symbols, accounts, risk configuration - operator intent.
//  * MarketDataRecord - OHLCV candles ONLY. Individual ticks are not stored:
//    they arrive thousands per second per symbol, are worthless individually,
//    and would destroy write throughput for no analytical gain.
//
// Naming follows the Part 1 convention: camelCase in the Prisma client,
// snake_case in PostgreSQL via @map/@@map.
// =============================================================================

// -----------------------------------------------------------------------------
// Trading enums
// -----------------------------------------------------------------------------

enum TradingVenue {
  BINANCE
  BYBIT
  OKX
  KRAKEN
  /// Simulated venue. Fills produced against it are always flagged simulated.
  PAPER
}

enum TradingMarketType {
  SPOT
  MARGIN
  FUTURES_USDT
  FUTURES_COIN
}

enum TradingAccountStatus {
  PENDING_VALIDATION
  ACTIVE
  DISABLED
  CREDENTIALS_INVALID
  /// The stored key has withdrawal permission; refused on principle.
  WITHDRAWAL_ENABLED_REJECTED
}

enum TradingModeSetting {
  DISABLED
  PAPER
  LIVE
}

enum StrategyStatus {
  DRAFT
  ENABLED
  DISABLED
  ERROR
}

enum OrderSideEnum {
  BUY
  SELL
}

enum OrderTypeEnum {
  MARKET
  LIMIT
  STOP
  STOP_LIMIT
}

enum TimeInForceEnum {
  GTC
  IOC
  FOK
  DAY
}

enum OrderStatusEnum {
  PENDING
  SUBMITTED
  ACKNOWLEDGED
  PARTIALLY_FILLED
  FILLED
  CANCEL_REQUESTED
  CANCELLED
  REJECTED
  EXPIRED
  FAILED
}

enum PositionSideEnum {
  LONG
  SHORT
  FLAT
}

enum RiskEventType {
  LIMIT_BREACHED
  ORDER_REJECTED
  KILL_SWITCH_ENGAGED
  KILL_SWITCH_RELEASED
  STALE_MARKET_DATA
  RISK_STATE_UNAVAILABLE
  DUPLICATE_ORDER_BLOCKED
  ORDER_BOOK_RESYNC

  // Part 8: the real-time risk engine's trail. Values mirror
  // ``RiskEventKind`` in ``wlct_trading/enums.py`` exactly; the parity spec
  // (risk-safety.spec.ts) reads both sources and refuses drift, because an
  // unmapped kind silently drops an event at the write.
  KILL_SWITCH_TRIGGERED
  KILL_SWITCH_ACKNOWLEDGED
  KILL_SWITCH_CLEARED
  STALE_RISK_STATE
  PROTECTION_TRIGGERED
  PROTECTION_CLEARED
  PROTECTION_EXEMPTED
  DAILY_LOSS_BREACHED
  ORDER_RATE_BREACHED
  CANCEL_RATE_BREACHED
  CONSECUTIVE_LOSSES_BREACHED
  CONFIG_CHANGED
}

enum RiskEventSeverity {
  INFO
  WARNING
  CRITICAL
  /// Part 8: the safety system itself is degraded (corrupted snapshot,
  /// unreadable configuration). Distinct from CRITICAL, which is "the
  /// system worked and refused". Alerting must be able to tell those apart.
  EMERGENCY
}

enum KillSwitchScopeEnum {
  GLOBAL
  EXCHANGE
  STRATEGY
  SYMBOL
  // Part 8: account-level halt (one trading account, rest of tenant keeps
  // trading) and the engine's own RISK switch (automatic protection lands
  // here). Same rule as the four originals: engaged means halted; a narrow
  // switch can never release a broad one. The engine-side ordering is
  // ``KILL_SWITCH_SCOPE_PRIORITY`` in ``wlct_trading/enums.py``.
  ACCOUNT
  RISK
}

/// Part 8: kill-switch lifecycle. ``TRIGGERED`` records never auto-clear;
/// the engine's transition table (``RISK_SWITCH_TRANSITIONS``) and this
/// column's service-side guards are the same rules in two languages, held
/// in parity by the jest source-parsed test.
enum RiskSwitchStatus {
  INACTIVE
  ACTIVE
  TRIGGERED
  ACKNOWLEDGED
  CLEARED
}

/// Part 8: scope at which a limit entry is expressed in the hierarchy.
enum RiskLimitScope {
  GLOBAL
  EXCHANGE
  ACCOUNT
  STRATEGY
  SYMBOL
}

/// Part 8: what automatic protection does on a severe breach. Every member
/// removes capability; there is no liquidation member by design - forcing
/// position closure is a separately authorised subsystem, never a policy
/// checkbox.
enum RiskProtectionAction {
  BLOCK_NEW_RISK
  BLOCK_SYMBOL
  BLOCK_STRATEGY
  BLOCK_ACCOUNT
  BLOCK_EXCHANGE
  GLOBAL_TRADING_STOP
}

enum TradingSessionStatus {
  STARTING
  RUNNING
  DEGRADED
  STOPPING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// Exchange - platform-level venue registry
// -----------------------------------------------------------------------------
// Not tenant-scoped: "Binance supports SPOT and has a 6000/min weight limit" is
// a fact about the world, identical for every tenant. Tenants opt in to a venue
// through TradingAccount, not by redefining the venue.
// -----------------------------------------------------------------------------

model Exchange {
  id        String       @id @default(uuid()) @db.Uuid
  venue     TradingVenue @unique
  name      String       @db.VarChar(64)
  isEnabled Boolean      @default(false) @map("is_enabled")

  /// Whether this deployment may route live orders here. Independent of
  /// isEnabled so market data can be consumed from a venue we do not trade.
  tradingEnabled Boolean @default(false) @map("trading_enabled")

  supportedMarketTypes TradingMarketType[] @map("supported_market_types")

  restBaseUrl    String  @map("rest_base_url") @db.VarChar(255)
  wsBaseUrl      String  @map("ws_base_url") @db.VarChar(255)
  sandboxRestUrl String? @map("sandbox_rest_url") @db.VarChar(255)
  sandboxWsUrl   String? @map("sandbox_ws_url") @db.VarChar(255)

  requiresPassphrase Boolean @default(false) @map("requires_passphrase")
  supportsSandbox    Boolean @default(false) @map("supports_sandbox")

  weightLimitPerMinute Int @default(1200) @map("weight_limit_per_minute")
  maxOrdersPerSecond   Int @default(5) @map("max_orders_per_second")
  maxLeverage          Int @default(1) @map("max_leverage")

  /// Default depth requested when initialising an order book.
  defaultBookDepth Int @default(50) @map("default_book_depth")

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  accounts TradingAccount[]
  symbols  TradingSymbol[]

  @@index([isEnabled])
  @@map("exchanges")
}

// -----------------------------------------------------------------------------
// TradingSymbol - instruments the platform may trade
// -----------------------------------------------------------------------------
// Tenant-scoped because whether a tenant is allowed to trade a given instrument
// is a commercial decision, and the per-symbol risk caps below differ per brand.
// -----------------------------------------------------------------------------

model TradingSymbol {
  id         String @id @default(uuid()) @db.Uuid
  tenantId   String @map("tenant_id") @db.Uuid
  exchangeId String @map("exchange_id") @db.Uuid

  /// Canonical platform form, e.g. "BTC-USDT".
  symbol      String @db.VarChar(32)
  /// Whatever the venue calls it, e.g. "BTCUSDT".
  venueSymbol String @map("venue_symbol") @db.VarChar(32)

  baseAsset  String            @map("base_asset") @db.VarChar(16)
  quoteAsset String            @map("quote_asset") @db.VarChar(16)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  isTradeable  Boolean @default(false) @map("is_tradeable")
  isSubscribed Boolean @default(false) @map("is_subscribed")

  // Venue trading rules. Validated locally before submission so an order that
  // would certainly be rejected never consumes a rate-limit slot.
  priceTick    Decimal  @map("price_tick") @db.Decimal(28, 12)
  quantityStep Decimal  @map("quantity_step") @db.Decimal(28, 12)
  minQuantity  Decimal  @map("min_quantity") @db.Decimal(28, 12)
  maxQuantity  Decimal? @map("max_quantity") @db.Decimal(28, 12)
  minNotional  Decimal  @map("min_notional") @db.Decimal(18, 6)

  pricePrecision    Int @default(8) @map("price_precision")
  quantityPrecision Int @default(8) @map("quantity_precision")

  /// Per-symbol ceiling, layered under the account and strategy limits.
  maxOrderNotional Decimal? @map("max_order_notional") @db.Decimal(18, 6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)

  orders            Order[]
  positions         Position[]
  marketDataRecords MarketDataRecord[]

  @@unique([tenantId, exchangeId, symbol, marketType])
  @@index([tenantId, isTradeable])
  @@index([tenantId, isSubscribed])
  @@index([exchangeId, symbol])
  @@map("trading_symbols")
}

// -----------------------------------------------------------------------------
// TradingAccount - a tenant's connection to a venue
// -----------------------------------------------------------------------------
// SECURITY: the API secret is never stored in plaintext and never leaves the
// server. It is sealed with the Part 1 envelope-encryption helper
// (packages/utils/src/crypto.ts): a per-record 256-bit DEK encrypted under the
// master KEK, with the AAD bound to "trading_account:{tenantId}:{accountId}" so
// a ciphertext lifted into another tenant's row fails to decrypt.
//
// apiKeyBlindIndex is an HMAC of the public key portion, letting us detect the
// same key registered twice without ever storing or comparing the secret.
//
// No column here is ever serialised into an API response, a log line or a
// mobile payload. The API exposes only apiKeyLastFour and status.
// -----------------------------------------------------------------------------

model TradingAccount {
  id         String  @id @default(uuid()) @db.Uuid
  tenantId   String  @map("tenant_id") @db.Uuid
  exchangeId String  @map("exchange_id") @db.Uuid
  /// Owning user. Null for a tenant-level house account.
  userId     String? @map("user_id") @db.Uuid

  label String @db.VarChar(80)

  status     TradingAccountStatus @default(PENDING_VALIDATION)
  marketType TradingMarketType    @default(SPOT) @map("market_type")

  /// Paper by default. Reaching LIVE additionally requires the deployment-level
  /// env safeguards to agree; this column alone is never sufficient.
  tradingMode TradingModeSetting @default(PAPER) @map("trading_mode")

  isSandbox Boolean @default(true) @map("is_sandbox")

  // --- encrypted credential material -------------------------------------
  /// Envelope-encrypted API key. Ciphertext only.
  /// Null when `credentialSource` is not ENVELOPE_DB - a secret-manager-backed
  /// account keeps no key material here at all.
  apiKeyCiphertext     String? @map("api_key_ciphertext") @db.Text
  /// Envelope-encrypted API secret. Ciphertext only. Null under SECRET_MANAGER.
  apiSecretCiphertext  String? @map("api_secret_ciphertext") @db.Text
  /// Envelope-encrypted passphrase, for venues that require one (OKX).
  passphraseCiphertext String? @map("passphrase_ciphertext") @db.Text
  /// Wrapped data encryption key for this row.
  encryptedDataKey     String? @map("encrypted_data_key") @db.Text
  /// Which KEK generation sealed the DEK, so keys can be rotated.
  encryptionKeyId      String? @map("encryption_key_id") @db.VarChar(64)
  /// HMAC of the public key portion for duplicate detection.
  apiKeyBlindIndex     String  @map("api_key_blind_index") @db.VarChar(64)
  /// Last four characters of the public key, safe to display.
  apiKeyLastFour       String  @map("api_key_last_four") @db.VarChar(4)

  // --- verified venue permissions ----------------------------------------
  canTrade     Boolean @default(false) @map("can_trade")
  canReadData  Boolean @default(false) @map("can_read_data")
  /// Must remain false. A withdrawal-capable key is rejected outright.
  canWithdraw  Boolean @default(false) @map("can_withdraw")
  ipRestricted Boolean @default(false) @map("ip_restricted")

  lastVerifiedAt      DateTime? @map("last_verified_at") @db.Timestamptz(6)
  lastFailureAt       DateTime? @map("last_failure_at") @db.Timestamptz(6)
  /// Venue error class only - never the venue's raw response.
  lastFailureCode     String?   @map("last_failure_code") @db.VarChar(64)
  consecutiveFailures Int       @default(0) @map("consecutive_failures")

  // --- Part 5: where the credential actually lives -----------------------
  // Part 1 stored every credential as envelope-encrypted ciphertext in the
  // columns above. That is correct for a self-hosted single-tenant install and
  // wrong for a managed multi-tenant one, where the secret should never enter
  // the application database at all. Rather than a second credential table -
  // which would mean two places to look and two ways to get it wrong - the
  // source is recorded here and the ciphertext columns become optional.
  credentialSource CredentialSource @default(ENVELOPE_DB) @map("credential_source")

  /// Pointer into the external secret store: a Vault path, an AWS Secrets
  /// Manager ARN, a GCP resource name. NOT a secret, and safe to display to an
  /// operator - it names a location, it does not unlock it.
  credentialRef String? @map("credential_ref") @db.VarChar(512)

  /// Permissions the venue itself reported at last verification, normalised.
  /// Recorded so an operator can see what a key can do without re-querying,
  /// and so a key that silently gains WITHDRAW is detected on the next check.
  verifiedPermissions String[] @default([]) @map("verified_permissions")

  credentialRotatedAt DateTime? @map("credential_rotated_at") @db.Timestamptz(6)
  /// Set when the venue key has a known expiry. Signing is refused past it.
  credentialExpiresAt DateTime? @map("credential_expires_at") @db.Timestamptz(6)

  /// Whether this account's private user-data stream should be maintained.
  privateStreamEnabled Boolean @default(false) @map("private_stream_enabled")

  /// Admin control. Independent of `status`: an account can be healthy and
  /// verified and still be barred from live trading by an operator.
  liveTradingEnabled Boolean @default(false) @map("live_trading_enabled")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)
  user     User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  orders                    Order[]
  positions                 Position[]
  riskConfiguration         RiskConfiguration?
  // Part 8: the durable risk trail per account.
  riskConfigurationVersions RiskConfigurationVersion[]
  riskSnapshotMetadata      RiskSnapshotMetadata[]
  riskProtectionActions     RiskProtectionTrip[]
  strategies                Strategy[]
  sessions                  TradingSession[]

  balances           AccountBalanceSnapshot[]
  streamSessions     ExchangeStreamSession[]
  reconciliationRuns ReconciliationRun[]
  executionIncidents ExecutionIncident[]

  @@unique([tenantId, apiKeyBlindIndex])
  @@index([tenantId, status])
  @@index([tenantId, userId])
  @@index([exchangeId])
  @@index([deletedAt])
  @@map("trading_accounts")
}

// -----------------------------------------------------------------------------
// Strategy + StrategyConfiguration
// -----------------------------------------------------------------------------
// Split into two tables on purpose: Strategy is identity and lifecycle, which
// changes rarely; StrategyConfiguration is versioned parameters, which change
// often. Keeping them apart means a parameter tweak produces a new config row
// and an audit trail rather than overwriting history.
// -----------------------------------------------------------------------------

model Strategy {
  id        String  @id @default(uuid()) @db.Uuid
  tenantId  String  @map("tenant_id") @db.Uuid
  /// Account this strategy trades through. Null while still a draft.
  accountId String? @map("account_id") @db.Uuid

  name    String @db.VarChar(80)
  /// Registry key of the implementing class, e.g. "spread_capture".
  kind    String @db.VarChar(64)
  version String @db.VarChar(20)

  status  StrategyStatus @default(DRAFT)
  /// Runtime toggle, independent of status. An operator flips this to pause a
  /// strategy without discarding its configuration.
  enabled Boolean        @default(false)

  venue      TradingVenue
  /// Canonical symbols this strategy subscribes to.
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  description String? @db.VarChar(500)

  // --- per-strategy risk profile ------------------------------------------
  // Layered UNDER the account and platform limits; the tightest always wins.
  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxDailyLoss        Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxOpenOrders       Int     @default(5) @map("max_open_orders")
  maxOrdersPerMinute  Int     @default(30) @map("max_orders_per_minute")

  lastStartedAt DateTime? @map("last_started_at") @db.Timestamptz(6)
  lastStoppedAt DateTime? @map("last_stopped_at") @db.Timestamptz(6)
  /// Exception class name only - never a message that might carry data.
  lastErrorCode String?   @map("last_error_code") @db.VarChar(64)

  // --- Part 6: this row IS the strategy instance ---------------------------
  // A separate `StrategyInstance` model was considered and rejected. This
  // table already carries the tenant, the account, the venue, the symbols and
  // the per-strategy risk profile - everything an instance is. Adding a second
  // table with the same meaning would create two answers to "is this strategy
  // running", which is the kind of ambiguity that ends with an operator
  // disabling the wrong row. The Part 6 columns below extend it instead.

  /// Catalogue entry this instance runs. Null for a Part 2 strategy created
  /// before the catalogue existed.
  definitionId String? @map("definition_id") @db.Uuid
  /// The exact published version. Behaviour cannot change under a fixed
  /// version: a change means a new version row.
  versionId    String? @map("version_id") @db.Uuid

  /// Deterministic 32-hex instance fingerprint computed by the engine from
  /// tenant + strategy key + version + exchange + market type + symbol +
  /// configuration version. It is what namespaces per-instance state, so it is
  /// stored rather than recomputed: if it ever disagrees with the engine's
  /// value, the state namespace has moved and that must be visible.
  instanceKey String? @map("instance_key") @db.VarChar(32)

  /// Active configuration version, denormalised from StrategyConfiguration so
  /// the instance fingerprint can be verified without a join.
  configVersion Int @default(1) @map("config_version")

  /// What the engine does when this instance raises. There is deliberately no
  /// "continue anyway" option: a strategy that threw has unknown state.
  failurePolicy StrategyFailurePolicy @default(STOP_INSTANCE) @map("failure_policy")

  /// Operational health, distinct from `status` and `enabled`. An instance can
  /// be ENABLED and UNHEALTHY at the same time, and hiding that behind a
  /// single flag is how a dead strategy looks fine on a dashboard.
  health StrategyHealth @default(UNKNOWN)

  /// Last time the engine reported this instance alive. Null means the engine
  /// has never reported, which is not the same as unhealthy.
  lastHeartbeatAt   DateTime? @map("last_heartbeat_at") @db.Timestamptz(6)
  consecutiveErrors Int       @default(0) @map("consecutive_errors")

  /// Set when the failure policy has taken the instance out of service. Only
  /// an explicit operator action clears it.
  quarantinedAt    DateTime? @map("quarantined_at") @db.Timestamptz(6)
  quarantineReason String?   @map("quarantine_reason") @db.VarChar(500)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  definition    StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  /// Named `versionRecord` rather than `version` because `version` is already
  /// the semantic version string on this model. Two different meanings under
  /// one name is how someone ends up comparing a string to a row.
  versionRecord StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  configurations StrategyConfiguration[]
  orders         Order[]
  riskEvents     RiskEvent[]
  sessions       TradingSession[]

  runs          StrategyRun[]
  checkpoints   StrategyCheckpoint[]
  incidents     StrategyIncident[]
  backtestRuns  BacktestRun[]
  paperSessions PaperTradingSession[]

  @@unique([tenantId, name])
  /// The engine's per-instance state namespace must be unique inside a tenant.
  @@unique([tenantId, instanceKey])
  @@index([tenantId, enabled])
  @@index([tenantId, status])
  @@index([tenantId, accountId])
  @@index([tenantId, health])
  @@index([tenantId, definitionId])
  @@index([versionId])
  @@index([deletedAt])
  @@map("strategies")
}

model StrategyConfiguration {
  id         String @id @default(uuid()) @db.Uuid
  strategyId String @map("strategy_id") @db.Uuid

  /// Monotonically increasing per strategy.
  version Int

  /// Strategy-specific parameters. Schema-validated in the API layer against
  /// the strategy kind's declared parameter schema before it is written.
  parameters Json @default("{}")

  // --- Part 6 --------------------------------------------------------------

  /// The published version whose parameter schema these values were validated
  /// against. Without it, a parameter set is uninterpretable after the schema
  /// changes.
  strategyVersionId String? @map("strategy_version_id") @db.Uuid

  /// sha256 over the canonical parameter encoding. Two configurations with the
  /// same hash are the same configuration, which is what lets a backtest result
  /// be tied to the exact parameters that produced it. Parameters never contain
  /// a credential - the parameter schema refuses credential-shaped names - so
  /// this hash covers no secret.
  configurationHash String? @map("configuration_hash") @db.VarChar(64)

  /// Exactly one configuration per strategy may be active at a time; enforced
  /// by the partial unique index in the migration.
  isActive Boolean @default(false) @map("is_active")

  activatedAt   DateTime? @map("activated_at") @db.Timestamptz(6)
  deactivatedAt DateTime? @map("deactivated_at") @db.Timestamptz(6)

  createdByUserId String? @map("created_by_user_id") @db.Uuid
  changeNote      String? @map("change_note") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  strategy        Strategy         @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  strategyVersion StrategyVersion? @relation(fields: [strategyVersionId], references: [id], onDelete: SetNull)

  @@unique([strategyId, version])
  @@index([strategyId, isActive])
  @@index([strategyVersionId])
  @@map("strategy_configurations")
}

// -----------------------------------------------------------------------------
// Order + OrderEvent + Fill
// -----------------------------------------------------------------------------

model Order {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String  @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  symbolId   String  @map("symbol_id") @db.Uuid

  /// Deterministic idempotency key sent to the venue. The unique constraint
  /// below is the authoritative cross-worker duplicate guard.
  clientOrderId   String  @map("client_order_id") @db.VarChar(36)
  /// Venue-assigned id. Null until the venue acknowledges.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)
  /// Signal that produced this order, for attribution.
  signalId        String? @map("signal_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  side        OrderSideEnum
  orderType   OrderTypeEnum   @map("order_type")
  timeInForce TimeInForceEnum @default(GTC) @map("time_in_force")
  status      OrderStatusEnum @default(PENDING)

  quantity  Decimal  @db.Decimal(28, 12)
  price     Decimal? @db.Decimal(28, 12)
  stopPrice Decimal? @map("stop_price") @db.Decimal(28, 12)

  reduceOnly Boolean @default(false) @map("reduce_only")

  // --- execution state, derived from fills only --------------------------
  filledQuantity   Decimal  @default(0) @map("filled_quantity") @db.Decimal(28, 12)
  averageFillPrice Decimal? @map("average_fill_price") @db.Decimal(28, 12)
  cumulativeFee    Decimal  @default(0) @map("cumulative_fee") @db.Decimal(28, 12)
  feeCurrency      String?  @map("fee_currency") @db.VarChar(16)

  /// True when produced by the paper venue. Carried into every report so a
  /// simulated result can never be presented as a real one.
  isSimulated Boolean @default(false) @map("is_simulated")

  rejectionCode   String? @map("rejection_code") @db.VarChar(64)
  rejectionReason String? @map("rejection_reason") @db.VarChar(500)

  /// Risk decision that authorised this order. Every order has one.
  riskDecisionId String? @map("risk_decision_id") @db.Uuid

  /// Measured, not promised. Null until the venue acknowledges.
  submitLatencyMicros Int? @map("submit_latency_micros")

  // --- Part 5: how much the local record can be trusted ------------------
  // Deliberately NOT folded into `status`. `status` is what the venue believes
  // and has a strict legal-transition table; this is what we believe about our
  // own knowledge. An order whose submission response was lost stays SUBMITTED
  // - which is true, we did submit it - and is marked UNKNOWN here.
  reconciliationState  OrderReconciliationState @default(IN_SYNC) @map("reconciliation_state")
  /// Why the state is not IN_SYNC. Operator-facing, never a raw venue body.
  reconciliationDetail String?                  @map("reconciliation_detail") @db.VarChar(500)
  lastReconciledAt     DateTime?                @map("last_reconciled_at") @db.Timestamptz(6)

  /// Free-form annotation from the originating intent: the copy-trade leader
  /// this mirrors, a correlation id, a rebalance run. Excluded from the
  /// idempotency fingerprint on purpose - two orders differing only in metadata
  /// are the same trade, and hashing it would defeat duplicate detection.
  metadata Json @default("{}")

  /// Set to true only for an order that was fully built, validated and
  /// risk-checked under DRY_RUN and then deliberately not transmitted. Kept so
  /// a dry-run order is never mistaken for a real one in any report.
  wasDryRun Boolean @default(false) @map("was_dry_run")

  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  terminalAt  DateTime? @map("terminal_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)
  strategy  Strategy?      @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  events OrderEvent[]
  fills  Fill[]

  reconciliationDiscrepancies ReconciliationDiscrepancy[]
  executionIncidents          ExecutionIncident[]

  @@unique([tenantId, clientOrderId])
  @@index([tenantId, status, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([tenantId, strategyId, createdAt])
  @@index([tenantId, symbol, createdAt])
  @@index([exchangeOrderId])
  @@index([createdAt])
  /// Drives the reconciliation sweep: find every order whose state is not
  /// trusted, oldest first. Without this the sweep is a full table scan on a
  /// table that only ever grows.
  @@index([reconciliationState, lastReconciledAt])
  @@index([tenantId, accountId, reconciliationState])
  @@map("orders")
}

model OrderEvent {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  previousStatus OrderStatusEnum? @map("previous_status")
  status         OrderStatusEnum

  reason String? @db.VarChar(500)

  /// Structured context. Never contains credentials or venue signatures.
  payload Json @default("{}")

  /// Microsecond wall-clock time the event occurred, preserving sub-millisecond
  /// ordering that a Timestamptz(6) round trip would blur.
  occurredAtMicros BigInt @map("occurred_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, occurredAtMicros])
  @@index([createdAt])
  @@map("order_events")
}

model Fill {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  /// Venue's execution id. Unique per order; the guard against double-counting
  /// a replayed user-data message.
  venueTradeId String @map("venue_trade_id") @db.VarChar(64)

  price       Decimal @db.Decimal(28, 12)
  quantity    Decimal @db.Decimal(28, 12)
  fee         Decimal @default(0) @db.Decimal(28, 12)
  feeCurrency String  @default("USDT") @map("fee_currency") @db.VarChar(16)

  isMaker     Boolean @default(false) @map("is_maker")
  /// Always true for paper fills. Never mutated after insert.
  isSimulated Boolean @default(false) @map("is_simulated")

  exchangeTimestampMicros BigInt @map("exchange_timestamp_micros")
  receivedTimestampMicros BigInt @map("received_timestamp_micros")

  // --- Part 5: venue attribution -----------------------------------------
  // Denormalised from the parent order on purpose. A fill arriving on the
  // private stream can be routed to the position manager without a join, and a
  // PnL query over millions of rows does not need one either.
  symbol String?        @db.VarChar(32)
  side   OrderSideEnum?
  venue  TradingVenue?

  /// Quote-asset amount as the venue computed it. Kept rather than recomputed:
  /// the venue's rounding is authoritative for settlement, and price * quantity
  /// can disagree in the last decimal place.
  quoteQuantity Decimal? @map("quote_quantity") @db.Decimal(28, 12)

  /// The venue's order id, when the execution report carries it. Lets a fill
  /// that arrives before the submit response is processed still be matched.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  /// Which route delivered this fill. The same execution legitimately arrives
  /// twice - once on the stream, once from reconciliation - and the unique
  /// constraint above deduplicates it. Recording the source is what lets an
  /// operator tell "the stream is healthy" from "reconciliation is carrying us".
  source FillSource @default(PRIVATE_STREAM)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([orderId, venueTradeId])
  @@index([orderId, receivedTimestampMicros])
  @@index([createdAt])
  @@index([exchangeOrderId])
  @@index([symbol, receivedTimestampMicros])
  @@map("fills")
}

// -----------------------------------------------------------------------------
// Position - derived from fills, never from a venue snapshot
// -----------------------------------------------------------------------------

model Position {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  symbolId  String @map("symbol_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  /// Signed: positive long, negative short, zero flat.
  quantity Decimal          @default(0) @db.Decimal(28, 12)
  side     PositionSideEnum @default(FLAT)

  averageEntryPrice Decimal? @map("average_entry_price") @db.Decimal(28, 12)
  markPrice         Decimal? @map("mark_price") @db.Decimal(28, 12)

  realisedPnl   Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Snapshot at last mark. Null when no mark price was available - never
  /// defaulted to zero, which would misreport a position as break-even.
  unrealisedPnl Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  cumulativeFee Decimal  @default(0) @map("cumulative_fee") @db.Decimal(18, 6)
  feeCurrency   String?  @map("fee_currency") @db.VarChar(16)

  /// True if ANY contributing fill was simulated. Sticky once set.
  containsSimulatedFills Boolean @default(false) @map("contains_simulated_fills")

  fillCount Int @default(0) @map("fill_count")

  openedAt   DateTime? @map("opened_at") @db.Timestamptz(6)
  closedAt   DateTime? @map("closed_at") @db.Timestamptz(6)
  lastFillAt DateTime? @map("last_fill_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  @@unique([accountId, symbolId])
  @@index([tenantId, accountId])
  @@index([tenantId, symbol])
  @@index([tenantId, side])
  @@map("positions")
}

// -----------------------------------------------------------------------------
// RiskConfiguration - per-account limits
// -----------------------------------------------------------------------------
// One row per trading account. Platform limits come from environment
// configuration and strategy limits from the Strategy row; this is the middle
// layer. The effective limit is the tightest of the three.
// -----------------------------------------------------------------------------

model RiskConfiguration {
  id        String @id @default(uuid()) @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  accountId String @unique @map("account_id") @db.Uuid

  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)

  maxSymbolExposureNotional  Decimal @map("max_symbol_exposure_notional") @db.Decimal(18, 6)
  maxAccountExposureNotional Decimal @map("max_account_exposure_notional") @db.Decimal(18, 6)

  maxOpenOrders      Int @default(10) @map("max_open_orders")
  maxOrdersPerMinute Int @default(60) @map("max_orders_per_minute")

  maxDailyLoss    Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxStrategyLoss Decimal @map("max_strategy_loss") @db.Decimal(18, 6)

  maxPriceDeviationPercent Decimal @default(2) @map("max_price_deviation_percent") @db.Decimal(8, 4)
  /// Market data older than this may not be used to price an order.
  maxMarketDataAgeMicros   Int     @default(5000000) @map("max_market_data_age_micros")

  /// Account-level halt. Independent of the four kill-switch scopes.
  tradingHalted Boolean   @default(true) @map("trading_halted")
  haltedReason  String?   @map("halted_reason") @db.VarChar(500)
  haltedAt      DateTime? @map("halted_at") @db.Timestamptz(6)

  // ---------------------------------------------------------------------
  // Part 8: the extended risk configuration.
  //
  // The scalars above remain the *effective* view the Part 2 core engine and
  // older consumers read. The Part 8 document is `policyJson`: the full
  // hierarchical entry set (GLOBAL..SYMBOL with priorities, units,
  // effective windows) as emitted by ``wlct_trading.risk.configuration``.
  // The two are kept in sync by the API's risk service - a config write
  // derives the scalars from the resolved view of the document, so a stale
  // scalar can never be *wider* than the document it shadows, and the
  // worker binds to `digest` rather than to either copy.
  //
  // `version` increments with every accepted mutation; `digest` is the
  // content hash the engine's snapshot binding check compares. They answer
  // different questions ("which revision is this" vs "does the payload
  // match what it claims") and neither substitutes for the other.
  // ---------------------------------------------------------------------
  version        Int     @default(1) @map("config_version")
  digest         String? @map("config_digest") @db.VarChar(64)
  policyJson     Json?   @map("policy_json")
  protectionJson Json?   @map("protection_json")

  /// Definition of the daily-loss rule, stored as booleans rather than
  /// buried in JSON so the effective policy is visible in a plain SELECT.
  dailyLossIncludesUnrealized Boolean @default(false) @map("daily_loss_includes_unrealized")
  allowRiskReducingOrders     Boolean @default(true) @map("allow_risk_reducing_orders")

  updatedByUserId String? @map("updated_by_user_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("risk_configurations")
}

// -----------------------------------------------------------------------------
// RiskEvent - the audit trail of every refusal
// -----------------------------------------------------------------------------
// Written for every rejection, breach and kill-switch action. This is the table
// an operator reads after an incident, so it records the limit, the observed
// value and the decision id that links back to the order.
// -----------------------------------------------------------------------------

model RiskEvent {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  orderId    String? @map("order_id") @db.Uuid

  eventType RiskEventType     @map("event_type")
  severity  RiskEventSeverity @default(WARNING)

  /// RiskDecisionCode from the engine, e.g. MAX_ORDER_SIZE_EXCEEDED.
  code    String @db.VarChar(64)
  message String @db.VarChar(1000)

  /// Stringified so the exact decimal is preserved for the audit record.
  limitValue    String? @map("limit_value") @db.VarChar(64)
  observedValue String? @map("observed_value") @db.VarChar(64)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  riskDecisionId String? @map("risk_decision_id") @db.Uuid
  correlationId  String? @map("correlation_id") @db.Uuid

  // Part 8: the structured rule trail. `ruleId` names the catalogued rule
  // (RiskRuleId), `scope`/`scopeTarget` say which hierarchy level governed,
  // `action` records what protection (if any) the breach proposed or
  // applied, `source` is the emitting component, and `snapshotVersion`
  // binds the event to the exact state the decision was taken from.
  // `dedupeKey` is the engine's content hash of the *condition* (not the
  // observed value): the partial unique index below makes repeated
  // identical breaches idempotent writes while distinct conditions never
  // collide.
  ruleId          String? @map("rule_id") @db.VarChar(64)
  scope           String? @db.VarChar(24)
  scopeTarget     String? @map("scope_target") @db.VarChar(64)
  action          String? @db.VarChar(32)
  source          String? @db.VarChar(64)
  snapshotVersion BigInt? @map("snapshot_version")
  isSimulated     Boolean @default(false) @map("is_simulated")
  dedupeKey       String? @map("dedupe_key") @db.VarChar(64)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@unique([tenantId, dedupeKey])
  @@index([tenantId, createdAt])
  @@index([tenantId, eventType, createdAt])
  @@index([tenantId, severity, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([orderId])
  @@map("risk_events")
}

// -----------------------------------------------------------------------------
// KillSwitch - durable record of the four halt scopes
// -----------------------------------------------------------------------------
// The live switch is read from Redis on the hot path; this table is the durable
// mirror so a Redis flush cannot silently re-enable trading, and so every
// engage/release is attributable to a person.
// -----------------------------------------------------------------------------

model KillSwitch {
  id       String  @id @default(uuid()) @db.Uuid
  /// Null for the platform-wide GLOBAL switch.
  tenantId String? @map("tenant_id") @db.Uuid

  scope  KillSwitchScopeEnum
  /// Venue, strategy id or symbol. Null only for GLOBAL.
  target String?             @db.VarChar(64)

  isEngaged Boolean @default(false) @map("is_engaged")
  reason    String? @db.VarChar(500)

  engagedByUserId  String?   @map("engaged_by_user_id") @db.Uuid
  engagedAt        DateTime? @map("engaged_at") @db.Timestamptz(6)
  releasedByUserId String?   @map("released_by_user_id") @db.Uuid
  releasedAt       DateTime? @map("released_at") @db.Timestamptz(6)

  // Part 8: lifecycle alongside the boolean, never replacing it. The
  // engine's hot path reads Redis; this table remains the durable mirror
  // (a Redis flush cannot silently re-enable trading, per the Part 5 rule),
  // and `status` carries the trigger/acknowledge/clear history the boolean
  // cannot express. `isEngaged` stays true for ACTIVE, TRIGGERED *and*
  // ACKNOWLEDGED - the three blocking states - so every pre-Part 8 reader
  // keeps the exact same semantics.
  status                RiskSwitchStatus   @default(INACTIVE)
  triggeredByRule       String?            @map("triggered_by_rule") @db.VarChar(64)
  triggeredAt           DateTime?          @map("triggered_at") @db.Timestamptz(6)
  severity              RiskEventSeverity? @map("trigger_severity")
  requiresExplicitClear Boolean            @default(false) @map("requires_explicit_clear")
  acknowledgedByUserId  String?            @map("acknowledged_by_user_id") @db.Uuid
  acknowledgedAt        DateTime?          @map("acknowledged_at") @db.Timestamptz(6)
  acknowledgementReason String?            @map("acknowledgement_reason") @db.VarChar(500)
  clearedByUserId       String?            @map("cleared_by_user_id") @db.Uuid
  clearedAt             DateTime?          @map("cleared_at") @db.Timestamptz(6)
  clearedReason         String?            @map("cleared_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, scope, isEngaged])
  @@index([scope, isEngaged])
  @@map("kill_switches")
}

// -----------------------------------------------------------------------------
// TradingSession - one run of the engine
// -----------------------------------------------------------------------------

model TradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid

  status      TradingSessionStatus @default(STARTING)
  /// Resolved mode for this run, recorded so a historical session can be read
  /// back with certainty about whether its fills were real.
  tradingMode TradingModeSetting   @map("trading_mode")

  /// Hostname or pod name of the worker that owns the session.
  workerId String @map("worker_id") @db.VarChar(128)

  startedAt   DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  endedAt     DateTime? @map("ended_at") @db.Timestamptz(6)
  heartbeatAt DateTime  @default(now()) @map("heartbeat_at") @db.Timestamptz(6)

  // --- observability counters -------------------------------------------
  signalsGenerated Int @default(0) @map("signals_generated")
  ordersRequested  Int @default(0) @map("orders_requested")
  ordersSubmitted  Int @default(0) @map("orders_submitted")
  ordersFilled     Int @default(0) @map("orders_filled")
  ordersRejected   Int @default(0) @map("orders_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  bookResyncs      Int @default(0) @map("book_resyncs")

  /// Measured percentiles over the session, in microseconds. Observed values
  /// only; the platform makes no latency guarantee.
  medianDecisionLatencyMicros Int? @map("median_decision_latency_micros")
  p99DecisionLatencyMicros    Int? @map("p99_decision_latency_micros")

  stopReason String? @map("stop_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account  TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  strategy Strategy?       @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([heartbeatAt])
  @@map("trading_sessions")
}

// -----------------------------------------------------------------------------
// MarketDataRecord - OHLCV candles only
// -----------------------------------------------------------------------------
// Deliberately NOT a tick store. Individual quotes and trades arrive at
// thousands per second per symbol; persisting them would saturate write
// throughput and produce a table nobody can query usefully. Candles are the
// aggregation that is actually used for charting and post-trade analysis.
//
// Not tenant-scoped: a BTC-USDT candle is the same fact for every tenant, and
// duplicating it per tenant would multiply storage for no isolation benefit.
// Access is mediated by the API, which checks the caller's tenant is
// subscribed to the symbol.
// -----------------------------------------------------------------------------

model MarketDataRecord {
  id       String @id @default(uuid()) @db.Uuid
  symbolId String @map("symbol_id") @db.Uuid

  venue    TradingVenue
  symbol   String       @db.VarChar(32)
  /// "1m", "5m", "1h", "1d".
  interval String       @db.VarChar(8)

  openTime  DateTime @map("open_time") @db.Timestamptz(6)
  closeTime DateTime @map("close_time") @db.Timestamptz(6)

  open   Decimal @db.Decimal(28, 12)
  high   Decimal @db.Decimal(28, 12)
  low    Decimal @db.Decimal(28, 12)
  close  Decimal @db.Decimal(28, 12)
  volume Decimal @db.Decimal(28, 12)

  quoteVolume Decimal? @map("quote_volume") @db.Decimal(28, 12)
  tradeCount  Int      @default(0) @map("trade_count")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  symbolRef TradingSymbol @relation(fields: [symbolId], references: [id], onDelete: Cascade)

  @@unique([symbolId, interval, openTime])
  @@index([venue, symbol, interval, openTime])
  @@index([openTime])
  @@map("market_data_records")
}

// =============================================================================
// PART 5 - AUTHENTICATED EXECUTION
// =============================================================================
// Everything below records what happened on the money path: where a credential
// lives (never the credential itself), what the private stream did, what
// reconciliation found, and what an operator needs to look at.
//
// One rule governs the whole section: nothing here is ever updated to hide a
// disagreement. A reconciliation that finds a difference writes a discrepancy
// row; it does not quietly correct the order and move on. An audit that can be
// edited is not an audit.
// =============================================================================

/// Where an account's key material actually lives.
enum CredentialSource {
  /// Envelope-encrypted in `trading_accounts`. Correct for self-hosted and
  /// single-tenant installs; the Part 1 default.
  ENVELOPE_DB
  /// Held by Vault / AWS Secrets Manager / GCP Secret Manager / KMS. The
  /// database stores only a pointer. Correct for managed multi-tenant.
  SECRET_MANAGER
  /// Process environment. Development only - it does not scale past one tenant
  /// and cannot be rotated per customer.
  ENVIRONMENT
}

/// How much the local record of an order can be trusted.
enum OrderReconciliationState {
  IN_SYNC
  /// The submission outcome was never observed. The order may or may not exist
  /// at the venue. It must be queried by clientOrderId, never resubmitted.
  UNKNOWN
  PENDING_RECONCILIATION
  /// Reconciliation found a difference it could not repair automatically.
  DIVERGED
}

/// Which route delivered a fill.
enum FillSource {
  PRIVATE_STREAM
  /// Returned inline in the order-placement response (newOrderRespType=FULL).
  ORDER_RESPONSE
  RECONCILIATION
  /// Produced by the paper venue. Always paired with isSimulated = true.
  SIMULATOR
}

enum StreamSessionStatus {
  CONNECTING
  CONNECTED
  RECONNECTING
  DISCONNECTED
  /// The venue invalidated the listen key. A new key is required; reconnecting
  /// with the old one yields a socket that silently delivers nothing.
  KEY_EXPIRED
  FAILED
  STOPPED
}

enum ReconciliationRunStatus {
  RUNNING
  COMPLETED
  /// Another pass held the lock. Not an error.
  SKIPPED
  FAILED
}

enum ReconciliationDiscrepancyType {
  ORDER_STATUS_MISMATCH
  ORDER_MISSING_LOCALLY
  ORDER_MISSING_AT_VENUE
  MISSED_FILL
  QUANTITY_MISMATCH
  BALANCE_MISMATCH
  POSITION_MISMATCH
  UNKNOWN_ORDER_RESOLVED
  UNKNOWN_ORDER_NEVER_PLACED
}

enum ExecutionIncidentType {
  UNKNOWN_ORDER_RESULT
  ORDER_STATE_MISMATCH
  MISSING_FILL
  UNEXPECTED_ORDER
  BALANCE_MISMATCH
  POSITION_MISMATCH
  ILLEGAL_TRANSITION
  CREDENTIAL_FAILURE
  CLOCK_SKEW
  PRIVATE_STREAM_FAILURE
  RATE_LIMIT_BREACH
  RECONCILIATION_FAILURE
  SAFETY_GATE_BLOCK
}

enum ExecutionIncidentSeverity {
  INFO
  WARNING
  /// Money or position integrity is at stake. Page someone.
  CRITICAL
}

// -----------------------------------------------------------------------------
// AccountBalanceSnapshot - what the venue says the account holds
// -----------------------------------------------------------------------------
// A snapshot, not a ledger. The platform does not maintain its own running
// balance: it would inevitably drift from the venue's, and a drifting balance
// is worse than no balance because it looks authoritative.
//
// Latest-per-asset is an upsert on the unique key. History is kept in
// `AccountBalanceSnapshot` rows only for assets whose value changed, which is
// what makes the table bounded on an account holding hundreds of dust balances.
// -----------------------------------------------------------------------------

model AccountBalanceSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  asset String @db.VarChar(24)

  /// Available to trade.
  free   Decimal @default(0) @db.Decimal(28, 12)
  /// Reserved against resting orders.
  locked Decimal @default(0) @db.Decimal(28, 12)
  /// Stored, not computed, so a historical row reads back exactly as the venue
  /// reported it even if the free/locked split is later revised.
  total  Decimal @default(0) @db.Decimal(28, 12)

  /// Venue's own update timestamp, when it supplies one.
  venueUpdatedAtMicros BigInt? @map("venue_updated_at_micros")
  observedAtMicros     BigInt  @map("observed_at_micros")

  /// True for a paper account. Carried so a simulated balance can never appear
  /// in a report alongside real ones without being marked.
  isSimulated Boolean @default(false) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, asset])
  @@index([tenantId, accountId])
  @@index([tenantId, asset])
  @@index([observedAtMicros])
  @@map("account_balance_snapshots")
}

// -----------------------------------------------------------------------------
// ExchangeStreamSession - one private user-data stream connection
// -----------------------------------------------------------------------------
// Distinct from TradingSession, which is a strategy run. This is the socket:
// when it connected, how many times it dropped, whether its listen key is still
// valid. Kept because "we have not received a fill in twenty minutes" is only
// actionable if you can tell a quiet market from a dead socket.
//
// The listen key is NEVER stored. It is a bearer credential: anyone holding it
// can read the account's entire order flow. Only the masked form is kept.
// -----------------------------------------------------------------------------

model ExchangeStreamSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status StreamSessionStatus @default(CONNECTING)

  /// Masked listen key, e.g. "pqia...65a1". Enough to correlate two log lines,
  /// useless to an attacker. The full key is never written anywhere.
  listenKeyMasked String? @map("listen_key_masked") @db.VarChar(32)

  listenKeyCreatedAt       DateTime? @map("listen_key_created_at") @db.Timestamptz(6)
  listenKeyRenewedAt       DateTime? @map("listen_key_renewed_at") @db.Timestamptz(6)
  listenKeyRenewals        Int       @default(0) @map("listen_key_renewals")
  listenKeyRenewalFailures Int       @default(0) @map("listen_key_renewal_failures")

  connectedAt    DateTime? @map("connected_at") @db.Timestamptz(6)
  disconnectedAt DateTime? @map("disconnected_at") @db.Timestamptz(6)
  lastEventAt    DateTime? @map("last_event_at") @db.Timestamptz(6)

  reconnectCount   Int @default(0) @map("reconnect_count")
  eventsReceived   Int @default(0) @map("events_received")
  executionReports Int @default(0) @map("execution_reports")
  parseErrors      Int @default(0) @map("parse_errors")

  /// Set after each reconnect, because Binance does not replay events missed
  /// while disconnected - so every reconnect is a correctness event.
  lastReconciledAt DateTime? @map("last_reconciled_at") @db.Timestamptz(6)

  /// Hostname or pod name of the worker holding the socket.
  workerId String @map("worker_id") @db.VarChar(128)

  /// Error class only. Never a venue response body, which could echo the URL
  /// and therefore the listen key.
  lastErrorCode String? @map("last_error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId, status])
  @@index([tenantId, status])
  @@index([lastEventAt])
  @@map("exchange_stream_sessions")
}

// -----------------------------------------------------------------------------
// ReconciliationRun + ReconciliationDiscrepancy
// -----------------------------------------------------------------------------
// Split into a run and its findings for the same reason Strategy and
// StrategyConfiguration are split: a run is a fact about an execution, a
// discrepancy is a fact about the world, and the second outlives the first.
//
// A run row is written even when it finds nothing, and even when it fails. "No
// reconciliation has completed for an hour" is itself an alertable condition
// and is invisible if only successful runs are recorded.
// -----------------------------------------------------------------------------

model ReconciliationRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status ReconciliationRunStatus @default(RUNNING)

  /// What prompted this pass: SCHEDULED, STREAM_RECONNECT, UNKNOWN_ORDER,
  /// MANUAL. A free-form column rather than an enum because the set of triggers
  /// grows with operational experience and a migration per trigger is friction
  /// for no safety gain.
  trigger String @default("SCHEDULED") @db.VarChar(32)

  startedAt      DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt     DateTime? @map("finished_at") @db.Timestamptz(6)
  durationMicros BigInt?   @map("duration_micros")

  ordersChecked         Int @default(0) @map("orders_checked")
  fillsRecovered        Int @default(0) @map("fills_recovered")
  discrepanciesFound    Int @default(0) @map("discrepancies_found")
  discrepanciesRepaired Int @default(0) @map("discrepancies_repaired")

  /// Error class and message. Never a credential, never a signature.
  error String? @db.VarChar(500)

  workerId String @map("worker_id") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  discrepancies ReconciliationDiscrepancy[]

  @@index([tenantId, accountId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([startedAt])
  @@map("reconciliation_runs")
}

model ReconciliationDiscrepancy {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  runId   String  @map("run_id") @db.Uuid
  /// Null for a discrepancy about an order this platform does not know - which
  /// is precisely the most serious kind.
  orderId String? @map("order_id") @db.Uuid

  discrepancyType ReconciliationDiscrepancyType @map("discrepancy_type")

  symbol        String? @db.VarChar(32)
  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// What we believed and what the venue said. Strings rather than typed
  /// columns because the compared value is a status here and a quantity there,
  /// and a discrepancy record is read by a human, not summed by a query.
  localValue String? @map("local_value") @db.VarChar(120)
  venueValue String? @map("venue_value") @db.VarChar(120)

  summary String @db.VarChar(1000)

  /// Whether local state was changed to match. False for everything the
  /// service refuses to auto-correct: balances, positions, and any order the
  /// platform did not place.
  repaired Boolean @default(false)

  detectedAtMicros BigInt @map("detected_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  run   ReconciliationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  order Order?            @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, discrepancyType, createdAt])
  @@index([runId])
  @@index([orderId])
  @@index([tenantId, repaired, createdAt])
  @@map("reconciliation_discrepancies")
}

// -----------------------------------------------------------------------------
// ExecutionIncident - the things a human needs to know about
// -----------------------------------------------------------------------------
// Deliberately rare. A risk engine declining an oversized order is the system
// working and produces nothing here. An order whose fate is unknown, a
// credential that stopped working, an order at the venue that this platform did
// not place - those produce a row.
//
// Immutable except for resolution. An incident is closed by setting
// `resolvedAt` and a note; its facts are never edited.
// -----------------------------------------------------------------------------

model ExecutionIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String? @map("account_id") @db.Uuid
  orderId   String? @map("order_id") @db.Uuid

  incidentType ExecutionIncidentType     @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// Normalised execution error code from the platform taxonomy, e.g.
  /// RESULT_UNKNOWN, CREDENTIALS_INVALID, STATE_MISMATCH. A VarChar rather than
  /// an enum: the taxonomy is expected to grow, and a code the database has
  /// never seen must be recordable rather than rejected at insert time.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context. Every value is passed through the secret scrubber
  /// before it gets here - incident payloads are the single most likely place
  /// for a credential to escape, because the instinct when writing one is to
  /// attach the whole failing request.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  /// Set when an alert was actually delivered, so a repeated incident does not
  /// re-page and a missed page is visible.
  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  order   Order?          @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, accountId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([orderId])
  @@index([createdAt])
  @@map("execution_incidents")
}

// =============================================================================
// PART 6 - STRATEGY LAYER: catalogue, runs, backtests, paper trading
// =============================================================================
// Three properties hold across everything below.
//
//   1. NOTHING HERE IS WRITTEN PER TICK. A strategy processes thousands of book
//      updates a minute; none of them reach PostgreSQL. What is stored is
//      configuration, lifecycle transitions, periodic checkpoints, completed
//      backtests, periodic paper snapshots and incidents. Hot state lives in
//      the engine's memory, and Redis is never the source of financial truth.
//
//   2. EVERY SIMULATED ROW SAYS SO. `BacktestRun`, `BacktestTrade`,
//      `PaperTradingSession` and `PaperPortfolioSnapshot` all describe results
//      that no real account achieved. Backtest performance is not indicative of
//      future performance; paper performance is not indicative of live
//      performance; simulation does not guarantee real execution quality.
//
//   3. NO ROW HERE CAN AUTHORISE AN ORDER. Enabling a strategy makes it emit
//      signals. Whether a signal becomes an order is decided by the risk engine
//      and the Part 5 execution gates, none of which read these tables.
// =============================================================================

enum StrategyVersionStatus {
  /// Registered but not runnable. An instance cannot bind to it.
  DRAFT
  /// Runnable. Behaviour is frozen: a change requires a new version.
  PUBLISHED
  /// Still runnable for existing instances, refused for new ones.
  DEPRECATED
  /// Refused everywhere, including for running instances at next start.
  DISABLED
}

enum StrategyFailurePolicy {
  /// Stop the instance that failed. Siblings keep running.
  STOP_INSTANCE
  /// Stop every instance in the engine. For a failure that suggests the
  /// problem is not confined to one strategy.
  HALT_ALL
}

enum StrategyHealth {
  /// The engine has not reported on this instance. Not the same as unhealthy.
  UNKNOWN
  HEALTHY
  /// Running, but something is wrong: errors, slow dispatches, stale data.
  DEGRADED
  /// Running is no longer trusted.
  UNHEALTHY
  /// Taken out of service by the failure policy. Only an operator clears it.
  QUARANTINED
}

enum StrategyRunStatus {
  STARTING
  RUNNING
  /// Ended cleanly, by operator action or shutdown.
  STOPPED
  /// Ended because the instance raised.
  FAILED
  /// Ended because HALT_ALL stopped the whole engine.
  HALTED
}

enum StrategyIncidentType {
  /// The strategy raised inside a handler or in evaluate().
  STRATEGY_ERROR
  /// Feature calculation raised. The features are discarded, not guessed.
  FEATURE_ERROR
  /// An unusual volume of rejected signals: the strategy is fighting the
  /// validator, which usually means a parameter is wrong.
  SIGNAL_REJECTED_BURST
  /// Risk state was unavailable, so signals were refused. Fail-closed working
  /// as designed, and still worth a human knowing about.
  RISK_STATE_UNAVAILABLE
  /// Dispatch exceeded the observation budget repeatedly.
  PROCESSING_LATENCY_BREACH
  /// The failure policy removed the instance from service.
  INSTANCE_QUARANTINED
  /// A configuration was refused by the parameter schema.
  CONFIGURATION_REJECTED
  /// A state checkpoint could not be written or could not be restored.
  CHECKPOINT_FAILURE
}

enum BacktestRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum PaperSessionStatus {
  STARTING
  RUNNING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// StrategyDefinition - the catalogue of implementations that ship with the code
// -----------------------------------------------------------------------------
// Platform-level and deliberately NOT tenant-scoped: a definition describes a
// class in `wlct_trading.strategies.implementations`, which is the same class
// for every tenant. It holds no customer data, so there is nothing to isolate.
// Tenant scoping starts at Strategy (the instance).
//
// Reserved-but-unimplemented ids live here too, flagged, so that the well-known
// names cannot be quietly taken by something that is not what an operator
// expects.
// -----------------------------------------------------------------------------

model StrategyDefinition {
  id String @id @default(uuid()) @db.Uuid

  /// Stable registry key, e.g. DETERMINISTIC_IMBALANCE_V1. Never reused for a
  /// different implementation.
  key String @unique @db.VarChar(64)

  displayName String  @map("display_name") @db.VarChar(120)
  description String  @db.VarChar(1000)
  category    String? @db.VarChar(40)

  /// False for a reserved name with no code behind it. An instance cannot bind
  /// to an unimplemented definition.
  isImplemented Boolean @default(false) @map("is_implemented")
  /// True for the four spec-reserved ids (MARKET_MAKING_V1, MOMENTUM_V1,
  /// MEAN_REVERSION_V1, MICROSTRUCTURE_V1) that exist to protect the namespace.
  isReserved    Boolean @default(false) @map("is_reserved")

  /// What this strategy does NOT claim. Rendered verbatim in the admin UI so a
  /// catalogue entry can never read like a performance promise.
  riskNotes String @default("No profitability claim is made or implied.") @map("risk_notes") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  versions  StrategyVersion[]
  instances Strategy[]
  backtests BacktestRun[]

  @@index([isImplemented])
  @@map("strategy_definitions")
}

// -----------------------------------------------------------------------------
// StrategyVersion - frozen behaviour
// -----------------------------------------------------------------------------
// The point of this table is that behaviour cannot change silently under one
// version. `behaviourHash` covers the implementation id and the parameter
// schema; if either changes, the hash changes, and the platform requires a new
// version row rather than mutating this one.
// -----------------------------------------------------------------------------

model StrategyVersion {
  id           String @id @default(uuid()) @db.Uuid
  definitionId String @map("definition_id") @db.Uuid

  /// Semantic version of the implementation, e.g. "1.0.0".
  version String @db.VarChar(20)

  status StrategyVersionStatus @default(DRAFT)

  /// Module-qualified class path, e.g.
  /// wlct_trading.strategies.implementations.deterministic_example:DeterministicImbalanceStrategy
  implementationId String @map("implementation_id") @db.VarChar(200)

  /// Declared parameter schema: name, type, bounds, default. Used to validate
  /// every configuration before it is written. Credential-shaped parameter
  /// names are refused by the engine, so a schema can never ask for a secret.
  parameterSchema   Json @default("{}") @map("parameter_schema")
  defaultParameters Json @default("{}") @map("default_parameters")

  /// sha256 over implementationId + canonical parameter schema.
  behaviourHash String @map("behaviour_hash") @db.VarChar(64)

  changeNote String? @map("change_note") @db.VarChar(1000)

  publishedAt  DateTime? @map("published_at") @db.Timestamptz(6)
  deprecatedAt DateTime? @map("deprecated_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  definition StrategyDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)

  instances      Strategy[]
  configurations StrategyConfiguration[]
  backtests      BacktestRun[]

  @@unique([definitionId, version])
  @@index([definitionId, status])
  @@map("strategy_versions")
}

// -----------------------------------------------------------------------------
// StrategyRun - one continuous period of an instance being alive
// -----------------------------------------------------------------------------
// Written on transition only: start, stop, failure. The counters are a snapshot
// taken when the run ends (or at checkpoint time), not a running total updated
// per event - that would be a write per tick by another name.
// -----------------------------------------------------------------------------

model StrategyRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String @map("strategy_id") @db.Uuid

  /// PAPER or LIVE. A backtest is not a run: it has its own table, because a
  /// backtest has a dataset and a window and a run does not.
  runMode TradingModeSetting @default(PAPER) @map("run_mode")

  status StrategyRunStatus @default(STARTING)

  /// Copied from the instance at start, so a historical run stays readable
  /// after the instance is reconfigured.
  instanceKey     String @map("instance_key") @db.VarChar(32)
  configVersion   Int    @map("config_version")
  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  startedAt DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt DateTime? @map("stopped_at") @db.Timestamptz(6)

  /// Free-text reason for a clean stop, e.g. "operator disabled".
  stopReason String? @map("stop_reason") @db.VarChar(500)
  /// Exception class name only. Never a message, which could carry data.
  errorCode  String? @map("error_code") @db.VarChar(64)

  /// End-of-run counters: events processed, signals generated / accepted /
  /// rejected / deduplicated, strategy errors, feature errors, risk
  /// rejections, slow dispatches. Stored as JSON because the counter set grows
  /// with the engine and a column per counter would mean a migration each time.
  counters Json @default("{}")

  /// Timestamp of the last market event this run processed, in microseconds.
  lastEventAtMicros BigInt? @map("last_event_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  checkpoints StrategyCheckpoint[]
  incidents   StrategyIncident[]

  @@index([tenantId, strategyId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([strategyId, status])
  @@index([startedAt])
  @@map("strategy_runs")
}

// -----------------------------------------------------------------------------
// StrategyCheckpoint - periodic, resumable instance state
// -----------------------------------------------------------------------------
// On a schedule and on clean stop. Never per tick.
//
// A checkpoint is what allows an instance to resume after a restart instead of
// silently starting from a blank rolling window while behaving as though it had
// history. `stateHash` makes a corrupted or partially written checkpoint
// detectable: restore verifies it and refuses rather than resuming from
// nonsense.
// -----------------------------------------------------------------------------

model StrategyCheckpoint {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String  @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  /// Monotonically increasing per strategy.
  sequence Int

  instanceKey String @map("instance_key") @db.VarChar(32)

  /// Serialised instance state as produced by the engine's snapshot(). Feature
  /// windows, cooldown state, the signal counter. No credential can appear
  /// here: the context that produces it has no field for one.
  state Json @default("{}")

  /// sha256 over the canonical encoding of `state`.
  stateHash String @map("state_hash") @db.VarChar(64)

  capturedAtMicros BigInt @map("captured_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy     @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@unique([strategyId, sequence])
  @@index([tenantId, strategyId, capturedAtMicros])
  @@index([runId])
  @@map("strategy_checkpoints")
}

// -----------------------------------------------------------------------------
// StrategyIncident - what a human needs to know about the strategy layer
// -----------------------------------------------------------------------------
// Same discipline as ExecutionIncident, and the same severity enum rather than
// a parallel one: a WARNING means the same thing in both places, and two
// enums with identical members is duplication waiting to drift.
//
// Rare by design. A validator rejecting one stale signal is the system working
// and produces nothing here.
// -----------------------------------------------------------------------------

model StrategyIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String? @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  incidentType StrategyIncidentType      @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  /// Normalised code, e.g. STRATEGY_ERROR, SIGNAL_STALE, VALIDATION_STATE_
  /// UNAVAILABLE. VarChar rather than an enum: the taxonomy grows, and a code
  /// the database has not seen must be recordable rather than rejected.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context, scrubbed before it arrives. Feature values and
  /// parameters may appear; a credential cannot, because no strategy object
  /// holds one.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy?    @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, strategyId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([runId])
  @@map("strategy_incidents")
}

// -----------------------------------------------------------------------------
// BacktestRun - a completed simulation over stored data
// -----------------------------------------------------------------------------
// SIMULATED. Every figure in this table was produced by a model that ignores
// queue position, market impact, venue rejections and latency variance, and is
// therefore systematically optimistic.
//
// BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
//
// Two columns make a result reproducible rather than merely plausible:
// `configurationHash` (strategy, version, implementation id, parameters,
// execution assumptions, dataset identity and initial capital) and the dataset
// identity columns including `datasetChecksum`. Re-running with the same hash
// against the same checksum must produce the same `runIdentifier`. It hashes no
// secret: none of its inputs can contain one.
// -----------------------------------------------------------------------------

model BacktestRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  /// Who asked for it. Null for a scheduled or system-initiated run.
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// The instance this was run for, when it was run for one. A backtest can
  /// also be run against a definition alone, before any instance exists.
  strategyId   String? @map("strategy_id") @db.Uuid
  definitionId String? @map("definition_id") @db.Uuid
  versionId    String? @map("version_id") @db.Uuid

  /// Denormalised so a historical result stays readable after the catalogue
  /// changes underneath it.
  strategyKey      String @map("strategy_key") @db.VarChar(64)
  strategyVersion  String @map("strategy_version") @db.VarChar(20)
  implementationId String @map("implementation_id") @db.VarChar(200)

  status BacktestRunStatus @default(QUEUED)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  // --- dataset identity ----------------------------------------------------
  datasetId         String  @map("dataset_id") @db.VarChar(120)
  datasetSource     String  @map("dataset_source") @db.VarChar(120)
  datasetChecksum   String? @map("dataset_checksum") @db.VarChar(64)
  granularity       String? @db.VarChar(20)
  windowStartMicros BigInt  @map("window_start_micros")
  windowEndMicros   BigInt  @map("window_end_micros")
  eventCount        Int     @default(0) @map("event_count")

  /// Part 7: the exact registered dataset VERSION this run replays. Nullable
  /// for back-compatibility with Part 6 runs, but a deployment with
  /// BACKTEST_DATASET_REQUIRED=true (the default) refuses submissions that
  /// leave it null. This is the column that ends "latest mutable data": the
  /// run points at an immutable version row, and the version row points at
  /// the content checksum the worker verified.
  datasetVersionId String? @map("dataset_version_id") @db.Uuid

  /// The walk-forward window this run belongs to, when it is part of a split:
  /// TRAINING, VALIDATION or TEST. Null for a plain single-window run.
  walkForwardSegment String? @map("walk_forward_segment") @db.VarChar(20)

  // --- assumptions ---------------------------------------------------------
  initialCapital Decimal @map("initial_capital") @db.Decimal(18, 6)
  makerFeeRate   Decimal @map("maker_fee_rate") @db.Decimal(9, 6)
  takerFeeRate   Decimal @map("taker_fee_rate") @db.Decimal(9, 6)
  slippageBps    Decimal @map("slippage_bps") @db.Decimal(9, 4)
  latencyMicros  BigInt  @default(0) @map("latency_micros")

  /// Parameters exactly as validated and used. Never a credential.
  parameters  Json @default("{}")
  /// The full assumption set as recorded by the engine, including the ones
  /// with no column of their own (minimum fill quantity, partial fill policy).
  assumptions Json @default("{}")

  // --- results (null until COMPLETED) --------------------------------------
  finalEquity  Decimal? @map("final_equity") @db.Decimal(18, 6)
  netPnl       Decimal? @map("net_pnl") @db.Decimal(18, 6)
  grossProfit  Decimal? @map("gross_profit") @db.Decimal(18, 6)
  grossLoss    Decimal? @map("gross_loss") @db.Decimal(18, 6)
  feesPaid     Decimal? @map("fees_paid") @db.Decimal(18, 6)
  slippageCost Decimal? @map("slippage_cost") @db.Decimal(18, 6)

  totalReturnPercent Decimal? @map("total_return_percent") @db.Decimal(12, 6)
  maxDrawdown        Decimal? @map("max_drawdown") @db.Decimal(18, 6)
  maxDrawdownPercent Decimal? @map("max_drawdown_percent") @db.Decimal(12, 6)

  totalTrades   Int @default(0) @map("total_trades")
  winningTrades Int @default(0) @map("winning_trades")
  losingTrades  Int @default(0) @map("losing_trades")

  /// Null rather than zero when there were no trades. A strategy that never
  /// traded does not have a 0% win rate, and storing one would be a lie a
  /// dashboard would happily repeat.
  winRate      Decimal? @map("win_rate") @db.Decimal(9, 6)
  averageTrade Decimal? @map("average_trade") @db.Decimal(18, 6)
  largestWin   Decimal? @map("largest_win") @db.Decimal(18, 6)
  largestLoss  Decimal? @map("largest_loss") @db.Decimal(18, 6)
  profitFactor Decimal? @map("profit_factor") @db.Decimal(18, 8)

  /// Risk-adjusted figures, withheld (null) below the engine's minimum
  /// observation count and on zero dispersion.
  sharpeRatio  Decimal? @map("sharpe_ratio") @db.Decimal(18, 8)
  sortinoRatio Decimal? @map("sortino_ratio") @db.Decimal(18, 8)

  /// False when the run had too few observations for the risk-adjusted
  /// figures to mean anything. Stored explicitly so a consumer cannot mistake
  /// a null for "not calculated yet".
  hasSufficientObservations Boolean @default(false) @map("has_sufficient_observations")

  exposurePercent Decimal? @map("exposure_percent") @db.Decimal(9, 6)
  turnover        Decimal? @map("turnover") @db.Decimal(18, 6)

  // --- identity ------------------------------------------------------------
  /// Engine-assigned deterministic run id, "bt-" + 24 hex.
  runIdentifier     String @map("run_identifier") @db.VarChar(32)
  /// sha256 over strategy, version, implementation id, parameters, assumptions,
  /// dataset identity and initial capital. Hashes no secret.
  configurationHash String @map("configuration_hash") @db.VarChar(64)
  engineVersion     String @map("engine_version") @db.VarChar(20)

  /// False when the dataset carried no checksum, which means this result
  /// cannot be proven to have come from that data.
  isReproducible Boolean @default(false) @map("is_reproducible")

  /// Always true. A column rather than an assumption, so that a consumer
  /// reading a row in isolation cannot mistake it for a live result.
  isSimulated Boolean @default(true) @map("is_simulated")

  jobId String? @map("job_id") @db.VarChar(64)

  queuedAt    DateTime  @default(now()) @map("queued_at") @db.Timestamptz(6)
  startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
  durationMs  Int?      @map("duration_ms")

  errorCode    String? @map("error_code") @db.VarChar(64)
  errorSummary String? @map("error_summary") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy   Strategy?           @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  definition StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  version    StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  historicalVersion HistoricalDatasetVersion? @relation(fields: [datasetVersionId], references: [id], onDelete: SetNull)

  metrics BacktestMetric[]
  trades  BacktestTrade[]

  /// The engine's run id is deterministic, so the same inputs re-submitted
  /// inside one tenant collide here rather than producing a second row that
  /// claims to be a different result.
  @@unique([tenantId, runIdentifier])
  @@index([tenantId, status, queuedAt])
  @@index([tenantId, strategyId, queuedAt])
  @@index([tenantId, configurationHash])
  @@index([tenantId, symbol, queuedAt])
  @@index([definitionId])
  @@index([versionId])
  @@index([queuedAt])
  @@index([datasetVersionId])
  @@map("backtest_runs")
}

// -----------------------------------------------------------------------------
// BacktestMetric - one named figure, with its own honesty flag
// -----------------------------------------------------------------------------
// The headline numbers have columns on BacktestRun. This table exists for the
// long tail, and for one property the columns cannot express: every metric
// carries `observationCount` and `isSufficient`, so a consumer can tell the
// difference between "0.0" and "not enough data to say".
// -----------------------------------------------------------------------------

model BacktestMetric {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  name  String   @db.VarChar(64)
  /// Null when the metric could not be computed meaningfully. Never coerced
  /// to zero.
  value Decimal? @db.Decimal(28, 12)
  unit  String   @default("RATIO") @db.VarChar(16)

  observationCount Int     @default(0) @map("observation_count")
  isSufficient     Boolean @default(false) @map("is_sufficient")

  /// Why a value is absent, when it is, e.g. "fewer than 20 return
  /// observations" or "zero dispersion".
  note String? @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, name])
  @@index([tenantId, name])
  @@map("backtest_metrics")
}

// -----------------------------------------------------------------------------
// BacktestTrade - one simulated round trip
// -----------------------------------------------------------------------------
// SIMULATED. These fills were never sent anywhere.
//
// `isWin` is net of fees: a trade profitable before costs and unprofitable
// after is a loss. A round trip that realised exactly zero is still recorded,
// because it still paid fees, and omitting it would quietly improve the win
// rate of every strategy in the platform.
// -----------------------------------------------------------------------------

model BacktestTrade {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  /// Position in the run, from 1. Deterministic.
  sequence Int

  symbol    String           @db.VarChar(32)
  direction PositionSideEnum

  quantity   Decimal @db.Decimal(28, 12)
  entryPrice Decimal @map("entry_price") @db.Decimal(28, 12)
  exitPrice  Decimal @map("exit_price") @db.Decimal(28, 12)

  grossPnl Decimal @map("gross_pnl") @db.Decimal(18, 6)
  fees     Decimal @default(0) @db.Decimal(18, 6)
  netPnl   Decimal @map("net_pnl") @db.Decimal(18, 6)

  /// Net of fees. See the note above.
  isWin Boolean @map("is_win")

  openedAtMicros BigInt @map("opened_at_micros")
  closedAtMicros BigInt @map("closed_at_micros")
  holdingMicros  BigInt @map("holding_micros")

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, sequence])
  @@index([tenantId, backtestRunId])
  @@index([backtestRunId, closedAtMicros])
  @@map("backtest_trades")
}

// -----------------------------------------------------------------------------
// PaperTradingSession - a strategy against the real feed, with simulated fills
// -----------------------------------------------------------------------------
// SIMULATED. The prices are real, the decisions are real, the fills are not.
//
// PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. The simulator fills
// at the observed top of book without queue position or market impact, so it
// systematically flatters any strategy that would in reality have waited, been
// partially filled, or moved the price.
//
// A session cannot reach a live adapter: the session object refuses to be
// constructed with one. That is enforced in the engine, not here - this table
// only records what happened.
// -----------------------------------------------------------------------------

model PaperTradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId        String? @map("strategy_id") @db.Uuid
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// Engine-assigned session id, unique inside the tenant.
  sessionIdentifier String @map("session_identifier") @db.VarChar(64)

  status PaperSessionStatus @default(STARTING)

  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  initialCapital Decimal  @map("initial_capital") @db.Decimal(18, 6)
  currentEquity  Decimal? @map("current_equity") @db.Decimal(18, 6)
  realisedPnl    Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked. Never coerced to zero.
  unrealisedPnl  Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid       Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  maxDrawdown    Decimal? @map("max_drawdown") @db.Decimal(18, 6)

  signalsGenerated Int @default(0) @map("signals_generated")
  signalsAccepted  Int @default(0) @map("signals_accepted")
  signalsRejected  Int @default(0) @map("signals_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  simulatedOrders  Int @default(0) @map("simulated_orders")
  simulatedFills   Int @default(0) @map("simulated_fills")
  strategyErrors   Int @default(0) @map("strategy_errors")

  /// Always true. Present as a column so a row read in isolation, or exported
  /// to a spreadsheet, still says what it is.
  isSimulated Boolean @default(true) @map("is_simulated")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt  DateTime? @map("stopped_at") @db.Timestamptz(6)
  stopReason String?   @map("stop_reason") @db.VarChar(500)
  errorCode  String?   @map("error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  snapshots PaperPortfolioSnapshot[]

  @@unique([tenantId, sessionIdentifier])
  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([startedAt])
  @@map("paper_trading_sessions")
}

// -----------------------------------------------------------------------------
// PaperPortfolioSnapshot - the simulated equity curve, sampled
// -----------------------------------------------------------------------------
// Sampled on a slow schedule and on stop. NOT written per fill and certainly
// not per tick: a snapshot per event would put the database in the hot path,
// which is the one thing the data plane is not allowed to do.
// -----------------------------------------------------------------------------

model PaperPortfolioSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  sessionId String @map("session_id") @db.Uuid

  /// Monotonically increasing per session.
  sequence Int

  capturedAtMicros BigInt @map("captured_at_micros")

  cash             Decimal  @db.Decimal(18, 6)
  positionQuantity Decimal  @default(0) @map("position_quantity") @db.Decimal(28, 12)
  positionValue    Decimal? @map("position_value") @db.Decimal(18, 6)
  equity           Decimal  @db.Decimal(18, 6)
  realisedPnl      Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked.
  unrealisedPnl    Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid         Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  drawdown         Decimal  @default(0) @db.Decimal(18, 6)

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session PaperTradingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])
  @@index([tenantId, sessionId, capturedAtMicros])
  @@map("paper_portfolio_snapshots")
}

// =============================================================================
// PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
// =============================================================================
// These tables are the control-plane projection of dataset files that live in
// dataset storage (local now, object storage later). PostgreSQL holds
// METADATA ONLY - manifests, checksums, file receipts, validation verdicts,
// ingestion progress. Event payloads never land here: millions of rows per
// capture would put a database in the replay hot path, and a replay that
// reads the same semantic content twice through two stores is a second truth
// waiting to disagree.
//
// TENANCY NOTE, stated rather than hidden: a historical dataset is public
// market data - the same tape any visitor of the venue archive would fetch.
// There is no per-tenant data in these tables to isolate, so these models
// deliberately carry no tenantId column, and adding one would imply an
// isolation the data does not have. Cross-tenant leakage protection lives on
// the doors instead: every read needs dataset:read, every mutation needs a
// named operator, and audit records carry the requesting tenant. A backtest
// run row (tenant-scoped, Part 6) REFERENCES a dataset version; that
// reference is where a tenant's results and platform data meet, and it is
// read-only from the tenant side forever.
//
// Immutability is a service-layer invariant with schema support: version
// rows are insert-only in practice (the API exposes no payload-mutating
// route), the unique (datasetId, version) constraint makes a version
// addressable exactly once, and the content checksum column is the identity
// the replay verifies. Status transitions - quarantine, archive - move a
// version OUT of use; nothing moves data INTO a published version.
//
// No endpoint here can reach a venue or an order. Datasets belong to
// BACKTEST. The live and paper paths never read these tables.

enum DatasetStatus {
  CREATED     @map("created")
  INGESTING   @map("ingesting")
  VALIDATING  @map("validating")
  VALID       @map("valid")
  INVALID     @map("invalid")
  QUARANTINED @map("quarantined")
  ARCHIVED    @map("archived")

  @@map("dataset_status")
}

enum DatasetCompleteness {
  COMPLETE @map("complete")
  PARTIAL  @map("partial")
  UNKNOWN  @map("unknown")

  @@map("dataset_completeness")
}

enum DatasetValidationRunStatus {
  RUNNING @map("running")
  PASSED  @map("passed")
  FAILED  @map("failed")
  ERROR   @map("error")

  @@map("dataset_validation_run_status")
}

enum DatasetIngestionRunStatus {
  PENDING     @map("pending")
  RUNNING     @map("running")
  VALIDATING  @map("validating")
  FINALIZING  @map("finalizing")
  SUCCEEDED   @map("succeeded")
  FAILED      @map("failed")
  QUARANTINED @map("quarantined")

  @@map("dataset_ingestion_run_status")
}

enum HistoricalSourceKind {
  BINANCE_PUBLIC_DATA   @map("binance_public_data")
  LOCAL_FILES           @map("local_files")
  OBJECT_STORAGE_EXPORT @map("object_storage_export")
  DATABASE_EXPORT       @map("database_export")
  STREAM_CAPTURE        @map("stream_capture")

  @@map("historical_source_kind")
}

/// Mirrors wlct_trading's MarketEventKind wire values exactly. No separate
/// "dataset event type" enum exists: one vocabulary, reused, per the part's
/// whole point.
enum DatasetEventKind {
  TICKER        @map("TICKER")
  TRADE         @map("TRADE")
  BOOK_SNAPSHOT @map("BOOK_SNAPSHOT")
  BOOK_DELTA    @map("BOOK_DELTA")
  CANDLE        @map("CANDLE")

  @@map("dataset_event_kind")
}

model HistoricalDataset {
  id String @id @default(uuid()) @db.Uuid

  /// The derived identity: hst-<32 hex>, a SHA-256 prefix of the dataset's
  /// CONTRACT (source kind + label, venue, market type, sorted symbol set,
  /// sorted event-kind set, requested window, granularity, canonical schema
  /// version). It changes when any of those change and ONLY then: two
  /// captures of one contract share a key and are distinguished by version
  /// and content checksum, which is the versioning story the files tell.
  datasetKey String @unique @map("dataset_key") @db.VarChar(64)

  name String @db.VarChar(120)

  venue      TradingVenue
  symbols    String[]
  marketType TradingMarketType  @default(SPOT) @map("market_type")
  eventKinds DatasetEventKind[] @map("event_kinds")

  granularity String? @db.VarChar(20)

  /// The REQUESTED window. Observed bounds live per version and per file,
  /// because a refresh may legitimately find more data than the first run.
  startMicros BigInt @map("start_micros")
  endMicros   BigInt @map("end_micros")

  /// Rollup of the newest version's status, denormalised for list pages.
  /// A version row remains the authority for any decision.
  status        DatasetStatus @default(CREATED)
  latestVersion Int?          @map("latest_version")

  /// Schema lineage: a change to either version means old manifests are not
  /// to be reinterpreted by the new reader; the reader must know both.
  schemaVersion          Int @default(1) @map("schema_version")
  canonicalSchemaVersion Int @default(1) @map("canonical_schema_version")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  versions      HistoricalDatasetVersion[]
  ingestionRuns DatasetIngestionRun[]

  @@index([venue, marketType, status])
  @@index([status, createdAt])
  @@index([startMicros, endMicros])
  @@map("historical_datasets")
}

model HistoricalDatasetVersion {
  id        String @id @default(uuid()) @db.Uuid
  datasetId String @map("dataset_id") @db.Uuid

  /// Monotone within a dataset. The pair (datasetKey, version) is the
  /// reproducibility handle printed in every backtest result.
  version Int

  status DatasetStatus

  /// SHA-256 over the canonical checksum_source of every event in replay
  /// merge order - the Part 6 content semantics. Two versions with different
  /// bytes never share this; a backtest citing a version is citing this.
  contentChecksum  String  @map("content_checksum") @db.VarChar(64)
  manifestChecksum String? @map("manifest_checksum") @db.VarChar(64)

  /// Relative location of the manifest inside dataset storage:
  /// "<datasetKey>/v<version>". Relative BY RULE: the storage layer refuses
  /// absolute paths and traversal, and the API never constructs a filesystem
  /// path at all, so a stored value can never smuggle either. Credentials
  /// cannot ride here because URIs here carry no authority component.
  storageUri String @map("storage_uri") @db.VarChar(500)

  compression String? @db.VarChar(16)

  fileCount  Int    @default(0) @map("file_count")
  eventCount Int    @default(0) @map("event_count")
  totalBytes BigInt @default(0) @map("total_bytes")

  /// Observed bounds for THIS version's actual contents.
  startMicros BigInt @map("start_micros")
  endMicros   BigInt @map("end_micros")

  completeness DatasetCompleteness @default(UNKNOWN)

  /// Provenance, denormalised from the manifest for query: which kind of
  /// source produced this, and its label. Public by construction - the
  /// ingestion adapters accept no credentials, and the label is checked
  /// against the credential pattern on write.
  sourceKind  HistoricalSourceKind @map("source_kind")
  sourceLabel String               @map("source_label") @db.VarChar(200)

  /// The stored manifest bytes as recorded at registration. Verifiers
  /// recompute the derived key from this JSON and compare - an edited row
  /// is visible without reading a single data file.
  manifestJson Json  @default("{}") @map("manifest_json")
  qualityJson  Json? @map("quality_json")

  validatedAt DateTime? @map("validated_at") @db.Timestamptz(6)
  finalizedAt DateTime? @map("finalized_at") @db.Timestamptz(6)

  creatorJobId    String? @map("creator_job_id") @db.VarChar(80)
  createdByUserId String? @map("created_by_user_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  dataset     HistoricalDataset             @relation(fields: [datasetId], references: [id], onDelete: Cascade)
  files       HistoricalDatasetFile[]
  validations HistoricalDatasetValidation[]
  backtests   BacktestRun[]

  @@unique([datasetId, version])
  @@index([contentChecksum])
  @@index([status, finalizedAt])
  @@map("historical_dataset_versions")
}

/// Per-partition file receipts: what a reader must find on disk for the
/// version to be what its manifest says. Integrity-checking data, not the
/// data itself.
model HistoricalDatasetFile {
  id        String @id @default(uuid()) @db.Uuid
  versionId String @map("version_id") @db.Uuid

  partitionPath String           @map("partition_path") @db.VarChar(400)
  symbol        String           @db.VarChar(32)
  eventKind     DatasetEventKind @map("event_kind")

  events Int
  bytes  BigInt
  sha256 String @db.VarChar(64)

  firstTsMicros BigInt @map("first_ts_micros")
  lastTsMicros  BigInt @map("last_ts_micros")

  compression String? @db.VarChar(16)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  version HistoricalDatasetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([versionId, partitionPath])
  @@index([versionId, eventKind, symbol])
  @@map("historical_dataset_files")
}

/// Validation runs against a version. The report body lives beside the
/// dataset (report.json); this row keeps the verdict, the counts that drove
/// it, and the digests that bind it to the exact manifest it judged.
model HistoricalDatasetValidation {
  id        String @id @default(uuid()) @db.Uuid
  versionId String @map("version_id") @db.Uuid

  status DatasetValidationRunStatus @default(RUNNING)

  infoCount    Int @default(0) @map("info_count")
  warningCount Int @default(0) @map("warning_count")
  errorCount   Int @default(0) @map("error_count")
  fatalCount   Int @default(0) @map("fatal_count")

  /// Finding-rule counts, exact even when the retained findings list was
  /// capped: report brevity must never corrupt the arithmetic.
  countsByRule Json? @map("counts_by_rule")

  reportUri      String? @map("report_uri") @db.VarChar(500)
  reportSha256   String? @map("report_sha256") @db.VarChar(64)
  policyDigest   String? @map("policy_digest") @db.VarChar(64)
  durationMicros BigInt? @map("duration_micros")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)

  version HistoricalDatasetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([versionId, status])
  @@map("historical_dataset_validations")
}

/// One ingestion attempt, end to end. A run never marks its version VALID -
/// finalisation is the pipeline's atomic act on storage; this row tracks the
/// JOB so an operator can see stuck, failed and quarantined attempts without
/// reading a queue. paramsJson is validated credential-free on write.
model DatasetIngestionRun {
  id String @id @default(uuid()) @db.Uuid

  /// Null until the first finalisation names a dataset; the hint keeps
  /// in-flight runs attributable to the key they are writing toward.
  datasetId      String? @map("dataset_id") @db.Uuid
  datasetKeyHint String? @map("dataset_key_hint") @db.VarChar(64)
  version        Int?

  status       DatasetIngestionRunStatus @default(PENDING)
  stage        String?                   @db.VarChar(40)
  progressJson Json                      @default("{}") @map("progress_json")

  /// Redacted, operator-facing failure text. Set by the worker from the
  /// exception CLASS and message only; stack traces and response bodies
  /// (which can carry request context) are deliberately not stored.
  errorText String? @map("error_text") @db.Text

  /// The staging area this run owns. Unique so two live jobs can never
  /// write one staging tree - the resume story assumes one owner per key.
  stagingKey String @unique @map("staging_key") @db.VarChar(80)

  sourceKind HistoricalSourceKind @map("source_kind")
  paramsJson Json                 @default("{}") @map("params_json")

  bytesDownloaded BigInt @default(0) @map("bytes_downloaded")
  eventsWritten   Int    @default(0) @map("events_written")

  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  startedAt  DateTime? @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  dataset HistoricalDataset? @relation(fields: [datasetId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([datasetId, version])
  @@map("dataset_ingestion_runs")
}

// -----------------------------------------------------------------------------
// Part 8: real-time risk engine - durable control-plane tables.
//
// Division of labour, restated at the schema because a table is where the
// next implementer looks: PostgreSQL holds what must survive a Redis flush
// (configuration versions, protection actions, event trail, periodic
// snapshot METADATA). Hot risk state - the per-account snapshot the gate
// reads for every decision - deliberately has NO table: it lives in Redis
// (``wlct:trading:t:<tenant>:risk:<account>:snapshot``) and is rebuilt from
// the authoritative sources when missing. A missing rebuild fails closed; a
// missing row never decides anything.
// -----------------------------------------------------------------------------

/// One immutable revision of an account's risk configuration document.
///
/// `RiskConfiguration` above is the *current* view; this is the history.
/// A version row is written before the pointer moves and is never updated:
/// "what were the limits when that order was approved" must be answerable
/// years later, and an UPDATE here is the audit lie the table exists to
/// prevent. `@@unique([accountId, version])` makes a double-publish
/// impossible, and the checksum cross-check (`digest` vs the engine's
/// recomputation of `policyJson`) makes a half-write visible.
model RiskConfigurationVersion {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  version   Int
  digest    String @db.VarChar(64)

  policyJson     Json  @map("policy_json")
  protectionJson Json? @map("protection_json")

  changedByUserId  String  @map("changed_by_user_id") @db.Uuid
  changeReason     String  @map("change_reason") @db.VarChar(500)
  /// Whether this revision widened any effective ceiling relative to its
  /// predecessor, computed by the service on write. Stored denormalised so
  /// "show me every loosening" is one indexed query, not a JSON diff of the
  /// whole history.
  loosenedCeilings Boolean @default(false) @map("loosened_ceilings")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, version])
  @@index([tenantId, createdAt])
  @@map("risk_configuration_versions")
}

/// Periodic metadata of the engine's hot risk snapshots. Metadata only -
/// NEVER the state itself, and never per tick.
///
/// Written by the risk-state sync job (queue ``risk-control``), at the
/// configured cadence or on event, not on market updates. It exists so an
/// operator can answer "when did exposure last refresh, and against which
/// config" from SQL without reading Redis, and so a stale-state incident has
/// a durable timeline. ``completenessJson`` records the snapshot's own
/// self-assessment (missing sources, advisories) exactly as the engine saw
/// it - risk's honesty is preserved by copying its words, not re-deriving.
model RiskSnapshotMetadata {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId       String  @map("account_id") @db.Uuid
  snapshotId      String  @map("snapshot_id") @db.VarChar(64)
  snapshotVersion BigInt  @map("snapshot_version")
  tradingDay      String  @map("trading_day") @db.VarChar(10)
  configDigest    String? @map("config_digest") @db.VarChar(64)
  stateDigest     String? @map("state_digest") @db.VarChar(64)

  equity               Decimal? @db.Decimal(28, 8)
  accountGrossNotional Decimal? @map("account_gross_notional") @db.Decimal(28, 8)
  netDailyPnl          Decimal? @map("net_daily_pnl") @db.Decimal(28, 8)
  openOrderCount       Int      @map("open_order_count")
  staleSources         Json?    @map("stale_sources")
  advisories           Json?
  isComplete           Boolean  @default(false) @map("is_complete")
  isSimulated          Boolean  @default(false) @map("is_simulated")

  capturedAt DateTime @map("captured_at") @db.Timestamptz(6)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, snapshotVersion])
  @@index([tenantId, capturedAt])
  @@index([tenantId, isComplete, capturedAt])
  @@map("risk_snapshot_metadata")
}

/// One automatic-protection trip and its clearance. The switch row
/// (``kill_switches``) carries the live halt; THIS row is the protection's
/// own story: why it fired, on what rule, who acknowledged it, under what
/// reason it was cleared. A triggered protection that improved out of it
/// (PnL recovered) does NOT clear - the service layer has no method that
/// writes `clearedAt` without a user id and a reason, and this table is
/// where that promise is written down.
model RiskProtectionTrip {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String?        @map("account_id") @db.Uuid
  scope     RiskLimitScope
  target    String?        @db.VarChar(64)

  action RiskProtectionAction
  ruleId String?              @map("rule_id") @db.VarChar(64)
  reason String               @db.VarChar(500)
  status String               @default("ACTIVE") @db.VarChar(16)

  triggeredAtDateTime  DateTime  @default(now()) @map("triggered_at") @db.Timestamptz(6)
  acknowledgedByUserId String?   @map("acknowledged_by_user_id") @db.Uuid
  acknowledgedAt       DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  clearedByUserId      String?   @map("cleared_by_user_id") @db.Uuid
  clearedAt            DateTime? @map("cleared_at") @db.Timestamptz(6)
  clearedReason        String?   @map("cleared_reason") @db.VarChar(500)

  snapshotVersion BigInt? @map("snapshot_version")
  isSimulated     Boolean @default(false) @map("is_simulated")

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, status, triggeredAtDateTime])
  @@index([tenantId, accountId])
  @@map("risk_protection_actions")
}

// ===========================================================================
// Part 9: observability & operations
// ===========================================================================

/// Alert severity. The four levels exist because "warning" and "critical"
/// alone collapse every judgement into "page someone"; INFO and EMERGENCY
/// restore the middle and the ceiling of the ladder. EMERGENCY is reserved
/// for conditions the platform treats as stop-and-read-now (the engine's own
/// rule catalog in wlct_trading.observability.alerts owns which is which;
/// the parity test keeps this list and that one telling the same story).
enum OpsAlertSeverity {
  INFO
  WARNING
  CRITICAL
  EMERGENCY
}

/// The explicit alert states. There is no CLOSED and no CANCELLED: OPEN ->
/// ACKNOWLEDGED -> (observed recovery or typed force-resolve) -> RESOLVED is
/// the whole machine, matching the engine-side state machine one for one.
enum OpsAlertState {
  OPEN
  ACKNOWLEDGED
  RESOLVED
}

enum OpsIncidentStatus {
  OPEN
  REVIEWING
  CLOSED
}

/// What an incident may link to. The set mirrors the engine-side
/// ``IncidentLinkKind`` exactly; the parity test enforces it.
enum OpsIncidentLinkKind {
  ALERT
  RISK_EVENT
  AUDIT
  ORDER
  EXECUTION_INCIDENT
  STRATEGY_EVENT
  MARKET_DATA_FAULT
  QUEUE_JOB
}

/// One deduplicated, currently-tracked operational condition.
///
/// Rows are FOLDED, never fanned out: the whole table is keyed by
/// ``dedupeKey`` = ``<ruleId>|<component>|<scope>``, and repeats from the
/// engine's mirror bump ``occurrences`` and ``lastSeenAt`` instead of
/// inserting. This is what lets a night of ten thousand identical stale-feed
/// ticks stay one row - and why ``occurrences``, ``firstSeenAt`` and
/// ``lastSeenAt`` are non-nullable columns rather than something to
/// reconstruct: the magnitude of an alert is part of the alert, not an
/// afterthought.
///
/// Resolution discipline: RESOLVED is written by the sync job only on
/// observed recovery (publisher mirror present, record gone) or by an
/// operator force-resolve carrying the typed confirmation phrase - each
/// force-resolve gets its own audit row, and never deletes this one.
model OpsAlert {
  id String @id @default(uuid()) @db.Uuid

  /// The engine's dedupe key. Unique, so the fold is an upsert, not a race.
  dedupeKey String           @unique @map("dedupe_key") @db.VarChar(191)
  ruleId    String           @map("rule_id") @db.VarChar(64)
  component String           @db.VarChar(64)
  scope     String?          @db.VarChar(128)
  severity  OpsAlertSeverity
  state     OpsAlertState    @default(OPEN)
  title     String           @db.VarChar(255)
  condition String           @db.VarChar(500)
  message   String?          @db.VarChar(500)

  /// Decimal-as-string discipline for any comparable quantity; observed and
  /// threshold are display facts, never computed with in SQL.
  observedValue  String? @map("observed_value") @db.VarChar(64)
  thresholdValue String? @map("threshold_value") @db.VarChar(64)

  occurrences Int      @default(1) @map("occurrences")
  firstSeenAt DateTime @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt  DateTime @map("last_seen_at") @db.Timestamptz(6)

  acknowledgedBy String?   @map("acknowledged_by") @db.VarChar(64)
  acknowledgedAt DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  /// How it ended: 'recovered' (observed), 'recovered (note)', or
  /// 'force-resolved by <actor>: <reason>'. Never null once RESOLVED.
  resolution     String?   @db.VarChar(500)

  /// The engine-side correlation links carried by the fold (alertId,
  /// risk event ids, correlationId, ...). References, never payloads - the
  /// same rule the incidents follow.
  links Json?

  /// Null = platform-wide infrastructure condition. Tenant rows are visible
  /// to that tenant's console; platform rows are readable everywhere the
  /// read permission reaches but mutable only by the platform role.
  tenantId String? @map("tenant_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([state, lastSeenAt])
  @@index([severity, state])
  @@index([tenantId, lastSeenAt])
  @@map("ops_alerts")
}

/// An incident is the operator's story across several correlated records.
/// It owns no copies: links are (kind, targetId) pairs into the tables that
/// hold the truth, so an incident cannot drift from its evidence or leak a
/// payload. The sync job creates one per grouping key (correlation id when
/// present, digest of links otherwise) and folds repeats - the same
/// storm-proof discipline as alerts, applied one level up.
model OpsIncident {
  id String @id @default(uuid()) @db.Uuid

  /// The engine-side deterministic id (inc_<digest>), unique so re-publish
  /// of the same story folds instead of duplicating.
  incidentId  String            @unique @map("incident_id") @db.VarChar(64)
  /// 'correlation:<id>' or 'links:<digest>' - the dedupe identity itself,
  /// kept as a column so the panel can show why two incidents are one.
  groupingKey String            @unique @map("grouping_key") @db.VarChar(191)
  title       String            @db.VarChar(200)
  status      OpsIncidentStatus @default(OPEN)
  severity    OpsAlertSeverity?

  correlationId String? @map("correlation_id") @db.VarChar(64)
  operationId   String? @map("operation_id") @db.VarChar(64)

  openedAt  DateTime  @map("opened_at") @db.Timestamptz(6)
  closedAt  DateTime? @map("closed_at") @db.Timestamptz(6)
  /// Only ever written with a note: closing without saying why is exactly
  /// the "silently marked resolved" failure the spec forbids for alerts,
  /// extended here by the same logic.
  closeNote String?   @map("close_note") @db.VarChar(500)

  tenantId String? @map("tenant_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant?           @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  links  OpsIncidentLink[]

  @@index([status, openedAt])
  @@index([correlationId])
  @@map("ops_incidents")
}

model OpsIncidentLink {
  id         String              @id @default(uuid()) @db.Uuid
  incidentId String              @map("incident_id") @db.Uuid
  kind       OpsIncidentLinkKind
  targetId   String              @map("target_id") @db.VarChar(128)
  note       String?             @db.VarChar(255)
  createdAt  DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)

  incident OpsIncident @relation(fields: [incidentId], references: [id], onDelete: Cascade)

  @@unique([incidentId, kind, targetId])
  @@index([kind, targetId])
  @@map("ops_incident_links")
}

// ===========================================================================
// Part 10: reliability - SLO configuration versions and evaluation rows.
//
// Same versioned-appendix discipline as the risk catalog (Part 8): a change
// to an SLO definition INSERTS a new (sloId, version) row and never updates
// an old one, so every evaluation can say exactly which version of the
// promise it measured. The checksum is sha256 over the engine's canonical
// JSON of the objective (version and enabled are excluded by design: the
// identity of the PROMISE moves only when the promise changes).
//
// These tables are platform-operational, not tenant data: no tenantId, no
// tenant relation, reads gated by permission. Evaluations are an append-only
// evidence log - the maintenance job prunes by age within the retention
// floor, and nothing in the trading path reads either table.
// ===========================================================================

enum SloEvaluationState {
  HEALTHY
  WARNING
  CRITICAL
  EXHAUSTED
  UNKNOWN
}

model SloConfigurationVersion {
  id String @id @default(uuid()) @db.Uuid

  /// Catalog identity: the engine's `slo_id` bounded lowercase token.
  sloId   String @map("slo_id") @db.VarChar(64)
  version Int

  /// The objective exactly as configured: a canonical DECIMAL STRING
  /// ("99.5"), never a float column. Floats in an SLO document are how
  /// every downstream checksum quietly moves.
  objective String @db.VarChar(16)

  windowMinutes      Int @map("window_minutes")
  shortWindowMinutes Int @map("short_window_minutes")

  /// The nine closed indicator types live in the engine (SloIndicator);
  /// VarChar rather than a DB enum on purpose: the engine's enum is the
  /// authority, and a new indicator must not require a migration to store
  /// evaluations of an objective the database has never heard of.
  indicator String @db.VarChar(48)

  owner       String @db.VarChar(64)
  description String @db.VarChar(200)

  /// The human counting rule, committed into the digest on the engine side
  /// and persisted verbatim here so the panel can show what "good" meant.
  goodEvent String @map("good_event") @db.VarChar(200)
  badEvent  String @map("bad_event") @db.VarChar(200)

  warningBurnPpm  Int @map("warning_burn_ppm")
  criticalBurnPpm Int @map("critical_burn_ppm")

  /// Freshness indicators carry an age budget; latency compliance carries a
  /// threshold bucket. Micros in BigInt, serialized to strings on the wire
  /// (the platform-wide 64-bit rule), null exactly when the indicator shape
  /// forbids the field.
  maxAgeMicros           BigInt? @map("max_age_micros")
  latencyThresholdMicros BigInt? @map("latency_threshold_micros")

  /// Flipping enablement never moves the checksum (it is not part of the
  /// objective's identity) - which is precisely why it is a column here
  /// rather than a new version of the promise.
  enabled Boolean @default(true)

  /// Full canonical payload the digest was taken over: stored so a checksum
  /// can be re-verified byte-for-byte without trusting the writer.
  payload  Json
  checksum String @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([sloId, version])
  @@index([sloId])
  @@map("slo_configuration_versions")
}

/// One evaluation tick's full verdict, appended by the maintenance job (or a
/// manual evaluation call) and read by the panel. `UNKNOWN` is a first-class
/// state, not a gap: a row saying UNKNOWN with dataComplete=false IS the
/// record that measurement failed - the alternative (no row) is
/// indistinguishable from "nobody looked".
model SloEvaluation {
  id String @id @default(uuid()) @db.Uuid

  sloId    String @map("slo_id") @db.VarChar(64)
  version  Int
  checksum String @db.VarChar(64)

  indicator String @db.VarChar(48)
  service   String @db.VarChar(64)

  state SloEvaluationState

  /// Evaluation timestamp in microseconds (BigInt in, string on the wire).
  evaluatedAtMicros BigInt @map("evaluated_at_micros")

  windowMinutes      Int @map("window_minutes")
  shortWindowMinutes Int @map("short_window_minutes")

  targetPpm Int  @map("target_ppm")
  /// Null exactly when the window had no samples: "no evidence" renders as
  /// null, never as 100% or 0%.
  actualPpm Int? @map("actual_ppm")

  budgetTotalEvents     Int  @default(0) @map("budget_total_events")
  budgetConsumedEvents  Int  @default(0) @map("budget_consumed_events")
  budgetRemainingEvents Int  @default(0) @map("budget_remaining_events")
  remainingRatioPpm     Int? @map("remaining_ratio_ppm")

  longBurnPpm  Int? @map("long_burn_ppm")
  shortBurnPpm Int? @map("short_burn_ppm")

  /// 'none' | 'fast' | 'slow' | 'both' - the AND-window alert verdict for
  /// this tick. Bounded literal; the burn-rate rule ids derive from it.
  alertKind String @map("alert_kind") @db.VarChar(8)

  samplesGood Int @map("samples_good")
  samplesBad  Int @map("samples_bad")

  /// The collector's completeness claim for BOTH windows (AND-ed by the
  /// engine). False here means the row documents a measurement gap.
  dataComplete Boolean @map("data_complete")

  reason String? @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([sloId, createdAt])
  @@index([state, createdAt])
  @@map("slo_evaluations")
}

// ---------------------------------------------------------------------------
// Part 13 - durable execution-engine store (libs/trading-core OrderStore port)
// ---------------------------------------------------------------------------
// Written by services/execution-engine over asyncpg (app/store_sql.py); the
// DDL lives HERE so one mechanism owns every table, every tenant column, and
// the RLS policy set. Shape notes, each a decision rather than an accident:
//  * Quantities, prices and fees are TEXT, not NUMERIC. Python `Decimal` is
//    arbitrary precision (average_fill_price is a division; cumulative sums
//    inherit the deepest scale of their inputs) and NUMERIC(p,s) RESCALES -
//    a rounded stored aggregate would make the durable record disagree with
//    the domain's own derivation, which is exactly the class of lie this
//    platform refuses. Decimal-as-text is already the wire law
//    (services/execution-engine/app/schemas.py); these tables keep it
//    end-to-end, and the store's codec round-trips scale-exactly.
//  * Timestamps are epoch MICROSECONDS in BIGINT (the platform's int-time
//    law), not Timestamptz: the engine's clock discipline lives in micros
//    and a DB-side timezone conversion must never edit execution history.
//  * Enums are VARCHAR with the engine validating on read (the store's
//    codec raises on unknown values - fail-closed). They are NOT Postgres
//    ENUM types: the vocabulary lives in wlct_trading.enums and evolves
//    with the library; a mirrored CREATE TYPE here would be a second
//    source of truth with a drift bug waiting to happen.
//  * The child tables' FKs reference the composite (tenant_id, order_id)
//    key, so a fill or event physically cannot belong to order and tenant
//    pair that do not go together - cross-tenant child rows are a
//    constraint violation, not a code review item.
//  * reconciliation_state NULL means IN_SYNC (the reference store DELETES
//    its entry on sync; one fact gets exactly one spelling here too).

model ExecutionOrder {
  tenantId String @map("tenant_id") @db.Uuid

  /// Engine-minted order id. Composite PK with tenant below: order ids are
  /// only claimed unique WITHIN a tenant, and every query must carry the
  /// tenant - a global order_id primary key would tempt a tenant-less read.
  orderId       String  @map("order_id") @db.VarChar(64)
  clientOrderId String  @map("client_order_id") @db.VarChar(128)
  accountId     String  @map("account_id") @db.VarChar(64)
  strategyId    String? @map("strategy_id") @db.VarChar(64)

  exchange    String  @db.VarChar(32)
  symbol      String  @db.VarChar(32)
  side        String  @db.VarChar(8)
  /// OrderType value ("LIMIT", "STOP_LOSS_LIMIT", ...).
  orderType   String  @map("order_type") @db.VarChar(32)
  /// TimeInForce value ("GTC", "IOC", "FOK", "GTX").
  timeInForce String  @map("time_in_force") @db.VarChar(8)
  reduceOnly  Boolean @default(false) @map("reduce_only")
  signalId    String? @map("signal_id") @db.VarChar(64)

  /// The simulated-fill label, carried on the row so a paper order can
  /// never be laundered into a real one by a restart and re-read.
  isSimulated Boolean @map("is_simulated")

  /// OrderStatus value. Terminal statuses are decided by the engine's
  /// transition table at write time; nothing here re-derives them.
  status          String  @db.VarChar(24)
  /// The venue's own id, when observed. Never used as a lookup key without
  /// tenant context, even though the exchange promises uniqueness.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  quantity         String  @db.VarChar(40)
  price            String? @db.VarChar(40)
  stopPrice        String? @map("stop_price") @db.VarChar(40)
  filledQuantity   String  @map("filled_quantity") @db.VarChar(40)
  averageFillPrice String? @map("average_fill_price") @db.VarChar(64)
  cumulativeFee    String  @map("cumulative_fee") @db.VarChar(64)
  feeCurrency      String? @map("fee_currency") @db.VarChar(16)

  rejectionReason String? @map("rejection_reason") @db.VarChar(500)

  createdAt   BigInt  @map("created_at")
  updatedAt   BigInt  @map("updated_at")
  submittedAt BigInt? @map("submitted_at")
  terminalAt  BigInt? @map("terminal_at")

  /// ReconciliationState value or NULL (= IN_SYNC). See ReconciliationState
  /// in the store module: PENDING_RECONCILIATION / UNKNOWN / DIVERGED.
  reconciliationState String? @map("reconciliation_state") @db.VarChar(24)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  events ExecutionOrderEvent[]
  fills  ExecutionOrderFill[]

  @@id([tenantId, orderId])
  /// The cross-worker idempotency constraint the port documents: one client
  /// order id, one order, database-enforced. The reservation statement's ON
  /// CONFLICT rides this index.
  @@unique([tenantId, clientOrderId], map: "engine_orders_tenant_client_key")
  @@index([tenantId, accountId, status])
  @@index([reconciliationState])
  @@map("engine_orders")
}

model ExecutionOrderEvent {
  /// Insertion order IS the journal order (the port appends, never
  /// re-sorts); a monotonic global sequence is the only faithful ordering
  /// key, and it doubles as the row identity.
  seq BigInt @id @default(autoincrement())

  tenantId String @map("tenant_id") @db.Uuid
  orderId  String @map("order_id") @db.VarChar(64)

  /// OrderEvent.event_id: engine-minted, unique per order but NOT globally
  /// (the in-memory store never checks it), so NO unique constraint here -
  /// record_event appends unconditionally by port contract, and a DB
  /// constraint stricter than that would reject rows the reference store
  /// accepts. Indexed for correlation; seq keeps list_events deterministic.
  eventId          String  @map("event_id") @db.VarChar(64)
  previousStatus   String? @map("previous_status") @db.VarChar(24)
  status           String  @db.VarChar(24)
  reason           String? @db.VarChar(500)
  occurredAtMicros BigInt  @map("occurred_at")

  /// OrderEvent.payload - dict[str, str], canonical-JSON-encoded into jsonb.
  payload Json @map("payload")

  order ExecutionOrder @relation(fields: [tenantId, orderId], references: [tenantId, orderId], onDelete: Restrict)

  @@index([tenantId, orderId, seq])
  @@index([tenantId, eventId])
  @@map("engine_order_events")
}

model ExecutionOrderFill {
  seq BigInt @id @default(autoincrement())

  tenantId String @map("tenant_id") @db.Uuid
  orderId  String @map("order_id") @db.VarChar(64)

  /// The venue's fill/trade identity within the engine's namespace. Unique
  /// per tenant by constraint: record_fill's ON CONFLICT DO NOTHING reads
  /// the same index, which is what makes an at-least-once delivery replay a
  /// no-op instead of a double count.
  fillId  String @map("fill_id") @db.VarChar(128)
  tradeId String @map("trade_id") @db.VarChar(128)

  price    String @db.VarChar(40)
  quantity String @db.VarChar(40)
  fee      String @db.VarChar(64)

  feeCurrency String  @map("fee_currency") @db.VarChar(16)
  isMaker     Boolean @map("is_maker")
  isSimulated Boolean @map("is_simulated")

  exchangeTimestamp BigInt @map("exchange_timestamp")
  receivedTimestamp BigInt @map("received_timestamp")

  // -- Venue attribution (nullable: fills predate the attribution fields) --
  symbol          String? @db.VarChar(32)
  side            String? @db.VarChar(8)
  exchange        String? @db.VarChar(32)
  quoteQuantity   String? @map("quote_quantity") @db.VarChar(64)
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  order ExecutionOrder @relation(fields: [tenantId, orderId], references: [tenantId, orderId], onDelete: Restrict)

  @@unique([tenantId, fillId], map: "engine_order_fills_tenant_fill_key")
  @@index([tenantId, orderId, seq])
  @@map("engine_order_fills")
}

model ExecutionRetentionRun {
  /// Run identity and insertion order share one BIGSERIAL (the journal
  /// pattern from the event/fill tables): "last five runs" is a seq-DESC
  /// scan, and the row order on disk is the run order, always.
  seq BigInt @id @default(autoincrement())

  tenantId String @map("tenant_id") @db.Uuid

  /// Epoch micros, engine clock (the platform time law). started_at and
  /// finished_at bracket the WHOLE run - batch loop and ledger write - so
  /// a long run is visible as long, not as missing.
  startedAt  BigInt @map("started_at")
  finishedAt BigInt @map("finished_at")

  /// Dry runs are recorded too: a rehearsal's answer ("N rows prunable as
  /// of cutoff X") is evidence, and the row that says nobody deleted
  /// anything is what makes the next apply trustworthy. On such rows
  /// rowsDeleted holds the PRUNABLE COUNT, not a deletion.
  dryRun Boolean @map("dry_run")

  /// The cutoff the run applied, kept so "what did '90 days' mean on that
  /// date" is answerable after a config change redefines the number.
  eventCutoffUs BigInt @map("event_cutoff_us")
  rowsDeleted   BigInt @map("rows_deleted")

  /// Batch accounting: how many statements the run spent, and whether it
  /// hit EXECUTION_RETENTION_MAX_BATCHES with work remaining (exhausted
  /// true means "run again" - the scheduler's job, not this row's).
  batches   Int
  exhausted Boolean @default(false)

  /// Which engine process performed (or rehearsed) the run - the
  /// attribution field the platform's instance-id law requires.
  instanceId String @map("instance_id") @db.VarChar(64)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@index([tenantId, seq], map: "engine_retention_runs_tenant_id_seq_idx")
  @@map("engine_retention_runs")
}
```


## FILE: apps/api/prisma/migrations/20260913120000_part11_row_level_security/migration.sql (372 lines)

*regenerated by the generator, not hand-edited: coverage 41 -> 42 tables, the ledger's policy included, byte-deterministic.*

```sql
-- Part 11 (migration: functions + policies (NOT enabling)). Generated by scripts/gen_part11_rls.py - do not hand-edit;
-- rerun the generator. Schema stamp: 20260913120000.
--
-- Row-level security is the layer BELOW the tenant-scoped Prisma factory: the
-- factory cannot forget its WHERE, and even if a path bypassed the factory,
-- the database would still refuse the row. No GUC means no rows:
-- `wlct_current_tenant_id()` returns NULL when `app.tenant_id` is unset, and
-- `tenant_id = NULL` is never true - fail-closed, which is the only
-- acceptable default for a defence layer.

-- The single source of the request's tenant, read from the transaction-local
-- GUC that PrismaService.withTenantRls() sets via set_config(..., true).
-- STABLE so the planner evaluates it once per query, not per row.
CREATE OR REPLACE FUNCTION wlct_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- AccountBalanceSnapshot
CREATE POLICY tenant_isolation ON "account_balance_snapshots"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- BacktestMetric
CREATE POLICY tenant_isolation ON "backtest_metrics"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- BacktestRun
CREATE POLICY tenant_isolation ON "backtest_runs"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- BacktestTrade
CREATE POLICY tenant_isolation ON "backtest_trades"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ExecutionOrderEvent
CREATE POLICY tenant_isolation ON "engine_order_events"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ExecutionOrderFill
CREATE POLICY tenant_isolation ON "engine_order_fills"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ExecutionOrder
CREATE POLICY tenant_isolation ON "engine_orders"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ExecutionRetentionRun
CREATE POLICY tenant_isolation ON "engine_retention_runs"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ExchangeStreamSession
CREATE POLICY tenant_isolation ON "exchange_stream_sessions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ExecutionIncident
CREATE POLICY tenant_isolation ON "execution_incidents"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- KycProfile
CREATE POLICY tenant_isolation ON "kyc_profiles"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- LoginAttempt
CREATE POLICY tenant_isolation ON "login_attempts"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- Notification
CREATE POLICY tenant_isolation ON "notifications"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- Order
CREATE POLICY tenant_isolation ON "orders"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- PaperPortfolioSnapshot
CREATE POLICY tenant_isolation ON "paper_portfolio_snapshots"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- PaperTradingSession
CREATE POLICY tenant_isolation ON "paper_trading_sessions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- Position
CREATE POLICY tenant_isolation ON "positions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ReconciliationDiscrepancy
CREATE POLICY tenant_isolation ON "reconciliation_discrepancies"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ReconciliationRun
CREATE POLICY tenant_isolation ON "reconciliation_runs"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- RefreshToken
CREATE POLICY tenant_isolation ON "refresh_tokens"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- RiskConfigurationVersion
CREATE POLICY tenant_isolation ON "risk_configuration_versions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- RiskConfiguration
CREATE POLICY tenant_isolation ON "risk_configurations"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- RiskEvent
CREATE POLICY tenant_isolation ON "risk_events"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- RiskProtectionTrip
CREATE POLICY tenant_isolation ON "risk_protection_actions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- RiskSnapshotMetadata
CREATE POLICY tenant_isolation ON "risk_snapshot_metadata"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- Strategy
CREATE POLICY tenant_isolation ON "strategies"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- StrategyCheckpoint
CREATE POLICY tenant_isolation ON "strategy_checkpoints"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- StrategyIncident
CREATE POLICY tenant_isolation ON "strategy_incidents"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- StrategyRun
CREATE POLICY tenant_isolation ON "strategy_runs"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TenantApiKey
CREATE POLICY tenant_isolation ON "tenant_api_keys"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TenantBranding
CREATE POLICY tenant_isolation ON "tenant_branding"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TenantDomain
CREATE POLICY tenant_isolation ON "tenant_domains"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TenantFeatureFlag
CREATE POLICY tenant_isolation ON "tenant_feature_flags"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TenantSetting
CREATE POLICY tenant_isolation ON "tenant_settings"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TenantSubscription
CREATE POLICY tenant_isolation ON "tenant_subscriptions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TradingAccount
CREATE POLICY tenant_isolation ON "trading_accounts"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TradingSession
CREATE POLICY tenant_isolation ON "trading_sessions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- TradingSymbol
CREATE POLICY tenant_isolation ON "trading_symbols"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- UserRole
CREATE POLICY tenant_isolation ON "user_roles"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- UserSession
CREATE POLICY tenant_isolation ON "user_sessions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- User
CREATE POLICY tenant_isolation ON "users"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- VerificationToken
CREATE POLICY tenant_isolation ON "verification_tokens"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- Deliberately NOT enabled here. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
-- (and FORCE) is the prisma/rls/enable.sql DBA step, run only after the
-- pre-flight checklist there passes - enabling before every write path
-- adopts withTenantRls() turns defence into outage, and that trade is made
-- once, on purpose, by a human with the checklist.
--
-- Excluded by design (nullable tenantId; platform-scoped rows):

--   audit_logs                         (AuditLog)
--   kill_switches                      (KillSwitch)
--   ops_alerts                         (OpsAlert)
--   ops_incidents                      (OpsIncident)
--   roles                              (Role)
--   security_events                    (SecurityEvent)
--   subscription_plans                 (SubscriptionPlan)
-- Their tenant-bearing rows remain filtered by the tenant-scoped factory;
-- a strict policy here would hide the NULL-tenant platform rows that are
-- nobody's cross-tenant secret. The exclusion is a decision, listed in
-- rls_coverage.json and pinned by rls-coverage.spec.ts - never an oversight.
```


## FILE: apps/api/prisma/rls/enable.sql (135 lines)

*regenerated: the ledger joins the pre-flight checklist and the ENABLE/FORCE sequence - one checklist for all 42.*

```sql
-- Part 11 (enable: the DBA step). Generated by scripts/gen_part11_rls.py - do not hand-edit;
-- rerun the generator. Schema stamp: 20260913120000.
--
-- Row-level security is the layer BELOW the tenant-scoped Prisma factory: the
-- factory cannot forget its WHERE, and even if a path bypassed the factory,
-- the database would still refuse the row. No GUC means no rows:
-- `wlct_current_tenant_id()` returns NULL when `app.tenant_id` is unset, and
-- `tenant_id = NULL` is never true - fail-closed, which is the only
-- acceptable default for a defence layer.

-- PRE-FLIGHT CHECKLIST - all of it, or do not run this file:
--
--  1. Every API write/read path for a covered table runs inside
--     PrismaService.withTenantRls(tenantId, ...) (which issues
--     set_config('app.tenant_id', $1, true) as the transaction's first
--     statement). Grep the module for direct prisma.<model> usage outside
--     the scoped client as part of the review.
--  2. The application role has neither BYPASSRLS nor superuser:
--        SELECT rolname, rolbypassrls, rolsuper
--        FROM pg_roles WHERE rolname = current_user;
--     FORCE below covers the table OWNER; it does not cover those two
--     privileges, and a role that has them makes the whole exercise
--     theatre. Deployment roles get exactly what they need, nothing more.
--  3. Queue-side writers (audit, alerts, incidents - the excluded nullable
--     tables) are confirmed unaffected: they are not covered here.
--  4. Rollback rehearsed: prisma/rls/disable.sql returns to today's state
--     exactly (NO FORCE, DISABLE, then the migration's objects stay
--     defined and inert).
--  5. Run at low traffic. Enabling is a catalog flip per table; in-flight
--     transactions without the GUC start seeing zero rows immediately -
--     which is the point, and the reason it is a scheduled operation.

-- --- covered tables (42) -------------------------------------------
ALTER TABLE "account_balance_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_balance_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "positions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" FORCE ROW LEVEL SECURITY;

-- --- post-enable verification (manual, expect each count to match the
-- --- seeded tenant's own rows under that tenant's GUC, and zero without) --
-- BEGIN; SELECT set_config('app.tenant_id', '<tenant-uuid>', true);
--   SELECT count(*) FROM "account_balance_snapshots";
--   SELECT count(*) FROM "backtest_metrics";
--   SELECT count(*) FROM "backtest_runs";
-- ROLLBACK;
-- Without the GUC, every covered table must read 0 rows as the app role.

-- Excluded (platform-scoped, nullable tenantId) - intentionally untouched:
--   audit_logs (AuditLog)
--   kill_switches (KillSwitch)
--   ops_alerts (OpsAlert)
--   ops_incidents (OpsIncident)
--   roles (Role)
--   security_events (SecurityEvent)
--   subscription_plans (SubscriptionPlan)
```


## FILE: apps/api/prisma/rls/disable.sql (97 lines)

*regenerated: the exact inverse covers the new table the same day enable does.*

```sql
-- Part 11 (disable: the exact inverse of enable.sql). Generated by scripts/gen_part11_rls.py - do not hand-edit;
-- rerun the generator. Schema stamp: 20260913120000.
--
-- Row-level security is the layer BELOW the tenant-scoped Prisma factory: the
-- factory cannot forget its WHERE, and even if a path bypassed the factory,
-- the database would still refuse the row. No GUC means no rows:
-- `wlct_current_tenant_id()` returns NULL when `app.tenant_id` is unset, and
-- `tenant_id = NULL` is never true - fail-closed, which is the only
-- acceptable default for a defence layer.

-- Policies and the GUC function remain defined (inert while RLS is off), so
-- this file is one-way reversible by re-running enable.sql once the
-- checklist passes again.
ALTER TABLE "account_balance_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_balance_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "positions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "positions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategies" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" DISABLE ROW LEVEL SECURITY;
```


## FILE: apps/api/prisma/rls/rls_coverage.json (206 lines)

*regenerated: covered 41 -> 42; the Node rls-coverage spec (which RE-DERIVES the schema rather than pinning a count) passed unchanged at the new number.*

```json
{
  "schema": "part11-rls-coverage-v1",
  "stamp": "20260913120000",
  "policyName": "tenant_isolation",
  "functionName": "wlct_current_tenant_id",
  "covered": [
    {
      "table": "account_balance_snapshots",
      "model": "AccountBalanceSnapshot"
    },
    {
      "table": "backtest_metrics",
      "model": "BacktestMetric"
    },
    {
      "table": "backtest_runs",
      "model": "BacktestRun"
    },
    {
      "table": "backtest_trades",
      "model": "BacktestTrade"
    },
    {
      "table": "engine_order_events",
      "model": "ExecutionOrderEvent"
    },
    {
      "table": "engine_order_fills",
      "model": "ExecutionOrderFill"
    },
    {
      "table": "engine_orders",
      "model": "ExecutionOrder"
    },
    {
      "table": "engine_retention_runs",
      "model": "ExecutionRetentionRun"
    },
    {
      "table": "exchange_stream_sessions",
      "model": "ExchangeStreamSession"
    },
    {
      "table": "execution_incidents",
      "model": "ExecutionIncident"
    },
    {
      "table": "kyc_profiles",
      "model": "KycProfile"
    },
    {
      "table": "login_attempts",
      "model": "LoginAttempt"
    },
    {
      "table": "notifications",
      "model": "Notification"
    },
    {
      "table": "orders",
      "model": "Order"
    },
    {
      "table": "paper_portfolio_snapshots",
      "model": "PaperPortfolioSnapshot"
    },
    {
      "table": "paper_trading_sessions",
      "model": "PaperTradingSession"
    },
    {
      "table": "positions",
      "model": "Position"
    },
    {
      "table": "reconciliation_discrepancies",
      "model": "ReconciliationDiscrepancy"
    },
    {
      "table": "reconciliation_runs",
      "model": "ReconciliationRun"
    },
    {
      "table": "refresh_tokens",
      "model": "RefreshToken"
    },
    {
      "table": "risk_configuration_versions",
      "model": "RiskConfigurationVersion"
    },
    {
      "table": "risk_configurations",
      "model": "RiskConfiguration"
    },
    {
      "table": "risk_events",
      "model": "RiskEvent"
    },
    {
      "table": "risk_protection_actions",
      "model": "RiskProtectionTrip"
    },
    {
      "table": "risk_snapshot_metadata",
      "model": "RiskSnapshotMetadata"
    },
    {
      "table": "strategies",
      "model": "Strategy"
    },
    {
      "table": "strategy_checkpoints",
      "model": "StrategyCheckpoint"
    },
    {
      "table": "strategy_incidents",
      "model": "StrategyIncident"
    },
    {
      "table": "strategy_runs",
      "model": "StrategyRun"
    },
    {
      "table": "tenant_api_keys",
      "model": "TenantApiKey"
    },
    {
      "table": "tenant_branding",
      "model": "TenantBranding"
    },
    {
      "table": "tenant_domains",
      "model": "TenantDomain"
    },
    {
      "table": "tenant_feature_flags",
      "model": "TenantFeatureFlag"
    },
    {
      "table": "tenant_settings",
      "model": "TenantSetting"
    },
    {
      "table": "tenant_subscriptions",
      "model": "TenantSubscription"
    },
    {
      "table": "trading_accounts",
      "model": "TradingAccount"
    },
    {
      "table": "trading_sessions",
      "model": "TradingSession"
    },
    {
      "table": "trading_symbols",
      "model": "TradingSymbol"
    },
    {
      "table": "user_roles",
      "model": "UserRole"
    },
    {
      "table": "user_sessions",
      "model": "UserSession"
    },
    {
      "table": "users",
      "model": "User"
    },
    {
      "table": "verification_tokens",
      "model": "VerificationToken"
    }
  ],
  "excluded": [
    {
      "table": "audit_logs",
      "model": "AuditLog"
    },
    {
      "table": "kill_switches",
      "model": "KillSwitch"
    },
    {
      "table": "ops_alerts",
      "model": "OpsAlert"
    },
    {
      "table": "ops_incidents",
      "model": "OpsIncident"
    },
    {
      "table": "roles",
      "model": "Role"
    },
    {
      "table": "security_events",
      "model": "SecurityEvent"
    },
    {
      "table": "subscription_plans",
      "model": "SubscriptionPlan"
    }
  ]
}
```


## FILE: docker-compose.yml (408 lines)

*the four EXECUTION_RETENTION_* passthroughs with ${VAR:-default} spellings (an empty override resolves to the default - the Part 13 lesson applied before it could recur) and the comment stating that compose ships no scheduler.*

```yaml
# =============================================================================
# White-label copy-trading platform - local and staging composition.
#
# Design notes:
#  * Only Postgres, Redis, the API and the admin console publish ports. The
#    Python services and the notification worker stay on the internal network:
#    they are reachable by service name and by nothing else.
#  * Every service reads the same root .env, so there is one place to configure
#    the stack and no secret is written into this file.
#  * Health checks gate startup order. `depends_on: condition: service_healthy`
#    means the API never boots against a database that is still initialising.
#  * Named volumes hold state. Bind mounts are used only for the development
#    profile, where hot reload is worth the trade-off.
# =============================================================================

name: wlct

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

x-restart: &default-restart
  restart: unless-stopped

services:
  # ---------------------------------------------------------------------------
  # Data stores
  # ---------------------------------------------------------------------------
  postgres:
    image: postgres:16.4-alpine
    container_name: wlct-postgres
    <<: *default-restart
    logging: *default-logging
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wlct}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-wlct}
      # Deterministic collation avoids index-corruption surprises when the base
      # image's libc changes between upgrades.
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    command:
      - postgres
      - -c
      - max_connections=200
      - -c
      - shared_buffers=256MB
      - -c
      - log_min_duration_statement=1000
      # Consumed by infrastructure/database/init/02-roles.sql.
      - -c
      - wlct.app_password=${POSTGRES_APP_PASSWORD:-}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./infrastructure/database/init:/docker-entrypoint-initdb.d:ro
    ports:
      # Bound to loopback: the database must not be reachable from the LAN.
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-wlct} -d ${POSTGRES_DB:-wlct}"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
    networks:
      - wlct-internal

  redis:
    image: redis:7.4-alpine
    container_name: wlct-redis
    <<: *default-restart
    logging: *default-logging
    command:
      - redis-server
      - --requirepass
      - ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
      - --appendonly
      - "yes"
      - --maxmemory
      - 512mb
      # Queue jobs and session state must never be silently evicted; only keys
      # with an explicit TTL are eligible.
      - --maxmemory-policy
      - volatile-lru
    volumes:
      - redis-data:/data
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Migrations
  #
  # A one-shot job rather than an API entrypoint step: running migrations from
  # every replica is a race, and a failed migration must stop the deploy rather
  # than crash-loop an application container.
  # ---------------------------------------------------------------------------
  migrate:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: build
    container_name: wlct-migrate
    restart: "no"
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public
    command: >
      sh -c "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Application services
  # ---------------------------------------------------------------------------
  api:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-api
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      PORT: 4000
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=20&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      TRADING_ENGINE_URL: http://trading-engine:8001
      MARKET_DATA_URL: http://market-data:8002
      NOTIFICATION_SERVICE_URL: http://notification-service:8003
      # The API enqueues; the standalone worker consumes. Running the worker
      # inline as well would double-process every job.
      QUEUE_RUN_INLINE_WORKERS: "false"
    ports:
      - "${API_PORT:-4000}:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
    networks:
      - wlct-internal
      - wlct-edge

  notification-service:
    build:
      context: .
      dockerfile: infrastructure/docker/notification-service.Dockerfile
      target: runtime
    container_name: wlct-notification-service
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      NOTIFICATION_SERVICE_PORT: 8003
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8003"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  trading-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/trading-engine.Dockerfile
      target: runtime
    container_name: wlct-trading-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      TRADING_ENGINE_PORT: 8001
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # Part 1 ships with execution hard-disabled. Enabling it requires a
      # deliberate change here and in the root .env.
      EXECUTION_ENABLED: ${EXECUTION_ENABLED:-false}
      EXCHANGE_SANDBOX_MODE: ${EXCHANGE_SANDBOX_MODE:-true}
    expose:
      - "8001"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Part 11: the execution plane, split in two on purpose. The ENGINE holds
  # venue contact (adapters, credentials domain, locks, incidents); the
  # WORKER holds the queue (admission, partition claims, ack policy). Each
  # can say "no" to the other and both mean it: the worker refuses to boot
  # when the engine reports an incompatible mode, and the engine serves only
  # an authenticated internal token plus a tenant header.

  execution-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/execution-engine.Dockerfile
      target: runtime
    container_name: wlct-execution-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      SERVICE_PORT: 8093
      # Bind inside the container so the compose network can route to it; the
      # port is EXPOSEd to internal networks only - never published.
      EXECUTION_ENGINE_HOST: 0.0.0.0
      EXECUTION_INSTANCE_ID: ${EXECUTION_INSTANCE_ID:-execution-engine-1}
      EXECUTION_INTERNAL_TOKEN: ${EXECUTION_INTERNAL_TOKEN:?EXECUTION_INTERNAL_TOKEN is required for the execution engine}
      # simulated is the only wired mode; live refuses startup by code.
      EXECUTION_MODE: simulated
      EXECUTION_DRY_RUN: ${EXECUTION_DRY_RUN:-true}
      # Part 13 durable store. memory is the default (readiness reports
      # storeDurable=false, as it always has); postgres requires the
      # engine tables (applied by the migrate job's own migrations) and a
      # DSN - both are start-up refusals when missing, never a fallback.
      EXECUTION_STORE_BACKEND: ${EXECUTION_STORE_BACKEND:-memory}
      EXECUTION_POSTGRES_DSN: ${EXECUTION_POSTGRES_DSN:-}
      # Part 14 journal retention. ENABLED gates APPLY only - inspect and
      # dry-run work regardless, and every value is validated at startup by
      # the core's retention law (bounds in docs/PART14_RETENTION.md). The
      # scheduler (if any) is the deployment's business; nothing here runs
      # deletes on its own.
      EXECUTION_RETENTION_ENABLED: ${EXECUTION_RETENTION_ENABLED:-false}
      EXECUTION_RETENTION_EVENT_DAYS: ${EXECUTION_RETENTION_EVENT_DAYS:-90}
      EXECUTION_RETENTION_BATCH_ROWS: ${EXECUTION_RETENTION_BATCH_ROWS:-2000}
      EXECUTION_RETENTION_MAX_BATCHES: ${EXECUTION_RETENTION_MAX_BATCHES:-50}
    expose:
      - "8093"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  worker:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-worker
    <<: *default-restart
    logging: *default-logging
    command: ["node", "dist/worker.js"]
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      # The worker container owns ALL inline workers (maintenance,
      # notification, trade-execution); the API keeps them off.
      QUEUE_RUN_INLINE_WORKERS: "true"
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=10&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      WORKER_ENABLED: "true"
      WORKER_ID: ${WORKER_ID:-worker-1}
      WORKER_MEMBERSHIP: ${WORKER_MEMBERSHIP:-worker-1}
      # Part 12: the compose fleet self-registers via the Redis heartbeat
      # zset; the list above stays as the boot/fallback view. Flipping this
      # back to config is a one-line redeploy - claims decide authority in
      # both modes, so nothing else about safety changes.
      WORKER_MEMBERSHIP_MODE: ${WORKER_MEMBERSHIP_MODE:-registry}
      WORKER_MEMBERSHIP_TTL_MS: ${WORKER_MEMBERSHIP_TTL_MS:-30000}
      WORKER_PARTITION_COUNT: ${WORKER_PARTITION_COUNT:-8}
      WORKER_PARTITION_LEASE_TTL_MS: ${WORKER_PARTITION_LEASE_TTL_MS:-15000}
      WORKER_PARTITION_RETRY_MS: ${WORKER_PARTITION_RETRY_MS:-2500}
      WORKER_DEFER_DELAY_MS: ${WORKER_DEFER_DELAY_MS:-3000}
      WORKER_MAX_DEFERS: ${WORKER_MAX_DEFERS:-30}
      WORKER_SHUTDOWN_TIMEOUT_MS: ${WORKER_SHUTDOWN_TIMEOUT_MS:-10000}
      EXECUTION_ENGINE_URL: http://execution-engine:8093
      # One secret, two names: the engine validates EXECUTION_INTERNAL_TOKEN,
      # the worker presents it as EXECUTION_ENGINE_TOKEN.
      EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
      execution-engine:
        condition: service_healthy
    # No ports: the worker serves nothing. Its visibility is structured logs
    # plus the API's read-only GET /v1/observability/worker-coordination,
    # which reads the same Redis claims this process writes.
    networks:
      - wlct-internal

  market-data:
    build:
      context: .
      dockerfile: infrastructure/docker/market-data.Dockerfile
      target: runtime
    container_name: wlct-market-data
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      MARKET_DATA_PORT: 8002
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8002"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  admin-web:
    build:
      context: .
      dockerfile: infrastructure/docker/admin-web.Dockerfile
      target: runtime
      args:
        NEXT_PUBLIC_APP_NAME: ${NEXT_PUBLIC_APP_NAME:-CopyTrade Admin}
        NEXT_PUBLIC_API_VERSION: ${NEXT_PUBLIC_API_VERSION:-v1}
        NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL:-}
        NEXT_PUBLIC_WS_PATH: ${NEXT_PUBLIC_WS_PATH:-/socket.io}
    container_name: wlct-admin-web
    <<: *default-restart
    logging: *default-logging
    environment:
      NODE_ENV: production
      PORT: 3000
      # Server-to-server inside the compose network; the browser never sees it.
      API_BASE_URL: http://api:4000/api
      ADMIN_TENANT_SLUG: ${ADMIN_TENANT_SLUG:-platform}
      SESSION_COOKIE_SECRET: ${SESSION_COOKIE_SECRET:?SESSION_COOKIE_SECRET is required}
    ports:
      - "${ADMIN_WEB_PORT:-3000}:3000"
    depends_on:
      api:
        condition: service_healthy
    networks:
      - wlct-internal
      - wlct-edge

volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local

networks:
  # Service-to-service traffic. Not reachable from outside the host.
  wlct-internal:
    driver: bridge
    internal: false
  # Everything that legitimately faces a browser.
  wlct-edge:
    driver: bridge
```


## FILE: .env.example (989 lines)

*the retention note under the engine block: defaults, the pointer to the service example and the part doc, and the line that the prune runs from scripts/retention-run.mjs under the deployment's scheduler.*

```dotenv
# =============================================================================
# WHITE-LABEL CRYPTO COPY-TRADING PLATFORM - ENVIRONMENT CONFIGURATION
# =============================================================================
# Copy to .env and fill in real values. NEVER commit .env.
# Generate cryptographic material with: npm run keys:generate
# =============================================================================

# -----------------------------------------------------------------------------
# APPLICATION
# -----------------------------------------------------------------------------
NODE_ENV=development
APP_NAME=WhiteLabelCopyTrade
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_DEFAULT_VERSION=1
# Public base URL of the API (used in emails, webhooks, OpenAPI servers)
API_PUBLIC_URL=http://localhost:4000
# Public base URL of the admin web application
ADMIN_WEB_URL=http://localhost:3000
# Host port the admin console is published on by Docker Compose.
ADMIN_WEB_PORT=3000
# Trust N reverse proxy hops (nginx/ALB). 0 disables proxy trust.
TRUST_PROXY_HOPS=1
# Root domain used to resolve tenants from sub-domains: acme.copytrade.app
PLATFORM_ROOT_DOMAIN=copytrade.app
# Fallback tenant slug used when a request carries no resolvable tenant context
DEFAULT_TENANT_SLUG=platform

# -----------------------------------------------------------------------------
# DATABASE (PostgreSQL)
# -----------------------------------------------------------------------------
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=copytrade
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=copytrade
POSTGRES_SCHEMA=public
# Password for the least-privilege runtime role created by
# infrastructure/database/init/02-roles.sql. Leave blank to skip role creation.
POSTGRES_APP_PASSWORD=
# Prisma connection string. Inside docker-compose use host "postgres".
DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public&connection_limit=20&pool_timeout=20
# REQUIRED, not optional. schema.prisma declares `directUrl`, and Prisma refuses
# to run ANY migrate/generate command when the variable is missing (error P1012)
# even though the application itself never reads it. Point it at the database
# directly, bypassing any connection pooler (PgBouncer, RDS Proxy) and without
# the pooling query parameters, so DDL runs on a real session. With no pooler in
# front of PostgreSQL it is simply DATABASE_URL minus connection_limit/pool_timeout.
DIRECT_DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public
DATABASE_LOG_QUERIES=false
DATABASE_SSL=false

# -----------------------------------------------------------------------------
# REDIS (cache, rate limiting, queues, websocket adapter)
# -----------------------------------------------------------------------------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
REDIS_KEY_PREFIX=wlct:
REDIS_URL=redis://localhost:6379/0

# -----------------------------------------------------------------------------
# JWT / AUTHENTICATION
# -----------------------------------------------------------------------------
# Asymmetric signing is recommended in production (RS256). For HS256 provide secrets.
JWT_ALGORITHM=HS256
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
# Base64-encoded PEM keys, required when JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_BASE64=
JWT_PUBLIC_KEY_BASE64=
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=30d
JWT_ISSUER=https://api.copytrade.app
JWT_AUDIENCE=copytrade-clients
# Maximum concurrent active sessions (devices) per user
MAX_ACTIVE_SESSIONS_PER_USER=10

# Password policy / hashing (argon2id)
PASSWORD_MIN_LENGTH=12
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Account protection
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_FAILED_WINDOW_SECONDS=900
ACCOUNT_LOCKOUT_SECONDS=900

# -----------------------------------------------------------------------------
# ENCRYPTION (exchange API credential envelope encryption)
# -----------------------------------------------------------------------------
# 32-byte key, base64 encoded. Key Encryption Key used to wrap per-record DEKs.
ENCRYPTION_MASTER_KEY_BASE64=
# Identifier of the active master key; enables zero-downtime key rotation.
ENCRYPTION_KEY_ID=local-dev-v1
# Previous keys kept for decrypt-only, JSON map: {"local-dev-v0":"<base64key>"}
ENCRYPTION_PREVIOUS_KEYS_JSON={}
# kms | local  -> "kms" delegates KEK operations to a managed KMS provider
ENCRYPTION_PROVIDER=local
KMS_PROVIDER=
KMS_KEY_ARN=
# Deterministic HMAC key used to build blind indexes (lookup on encrypted values)
BLIND_INDEX_KEY_BASE64=

# -----------------------------------------------------------------------------
# TWO-FACTOR AUTHENTICATION (TOTP)
# -----------------------------------------------------------------------------
TWO_FACTOR_ISSUER=CopyTrade
TWO_FACTOR_WINDOW=1
TWO_FACTOR_DIGITS=6
TWO_FACTOR_PERIOD=30
TWO_FACTOR_RECOVERY_CODES=10
# Short-lived token issued between password step and 2FA step
TWO_FACTOR_CHALLENGE_TTL=300s
# Wrong codes tolerated per challenge token before it is discarded.
TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS=5

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
CORS_CREDENTIALS=true
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token
CORS_EXPOSED_HEADERS=X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset

# -----------------------------------------------------------------------------
# RATE LIMITING
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX=120
RATE_LIMIT_AUTH_TTL_SECONDS=300
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1

# -----------------------------------------------------------------------------
# SWAGGER / OPENAPI
# -----------------------------------------------------------------------------
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
SWAGGER_TITLE="White-Label Copy Trading API"
SWAGGER_DESCRIPTION="Multi-tenant non-custodial crypto copy-trading platform API"
SWAGGER_VERSION=1.0.0
# Optional basic-auth protection for the docs route in non-local environments
SWAGGER_USER=
SWAGGER_PASSWORD=

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug
# json | pretty
LOG_FORMAT=pretty
LOG_REQUEST_BODY=false
LOG_SAMPLE_RATE=1
SENTRY_DSN=

# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------
WS_ENABLED=true
WS_PATH=/realtime
WS_NAMESPACE=/v1
WS_PING_INTERVAL_MS=25000
WS_PING_TIMEOUT_MS=20000
WS_MAX_CONNECTIONS_PER_USER=5
# Redis adapter lets many API replicas share socket rooms
WS_REDIS_ADAPTER=true

# -----------------------------------------------------------------------------
# BULLMQ / BACKGROUND JOBS
# -----------------------------------------------------------------------------
QUEUE_PREFIX=wlct-queue
QUEUE_DEFAULT_ATTEMPTS=5
QUEUE_BACKOFF_MS=5000
QUEUE_REMOVE_ON_COMPLETE=1000
QUEUE_REMOVE_ON_FAIL=5000
QUEUE_CONCURRENCY=10
# Enable the in-process worker (single-container dev). Disable when running the dedicated worker.
QUEUE_RUN_INLINE_WORKERS=true
BULL_BOARD_ENABLED=false
BULL_BOARD_PATH=admin/queues

# -----------------------------------------------------------------------------
# EXCHANGE INTEGRATIONS (non-custodial: user-supplied trade-only API keys)
# -----------------------------------------------------------------------------
# Comma separated list of exchanges enabled platform-wide
EXCHANGES_ENABLED=binance,bybit,okx,kraken
EXCHANGE_SANDBOX_MODE=true
EXCHANGE_REQUEST_TIMEOUT_MS=10000
EXCHANGE_MAX_RETRIES=3
# Hard safety switch. Order execution remains disabled: the connectivity layer
# delivers market data only, and no order-placement adapter is registered.
EXECUTION_ENABLED=false
# Internal service endpoints
TRADING_ENGINE_URL=http://localhost:8001
TRADING_ENGINE_HEALTH_PATH=/health
MARKET_DATA_URL=http://localhost:8002
MARKET_DATA_HEALTH_PATH=/health
NOTIFICATION_SERVICE_URL=http://localhost:8003
NOTIFICATION_SERVICE_HEALTH_PATH=/health
# Shared secret for service-to-service authentication (mTLS recommended in prod)
INTERNAL_SERVICE_TOKEN=change_me_internal_service_token
# Signing secret used to verify inbound exchange webhooks
EXCHANGE_WEBHOOK_SIGNING_SECRET=change_me_webhook_secret

# -----------------------------------------------------------------------------
# EXCHANGE CONNECTIVITY (libs/trading-core: wlct_trading.transport / .exchanges)
# -----------------------------------------------------------------------------
# These tune the realtime market-data connectivity layer. They contain no
# credentials: public market data needs none, and user exchange API keys are
# stored encrypted per trading account in PostgreSQL, never in the environment.
#
# Only venues with an implemented adapter can be selected. Naming a venue here
# that has no adapter fails fast at startup rather than at the first order.
EXCHANGE_MARKET_DATA_VENUES=binance
# Use the venue testnet endpoints. Keep true outside production.
EXCHANGE_USE_TESTNET=true

# --- Order-book synchronisation ---
# Depth requested for the REST snapshot. Rounded up to a depth the venue
# accepts. Deeper snapshots cost significantly more rate-limit weight
# (Binance spot: 100 levels = 5 weight, 1000 = 50, 5000 = 250).
ORDERBOOK_SNAPSHOT_DEPTH=1000
# Diffs buffered while a snapshot is in flight. Bounds memory: at 100 msg/s
# this is roughly 50 seconds of runway.
ORDERBOOK_MAX_BUFFERED_DELTAS=5000
# Resync attempts before a book is marked FAILED and refuses to serve quotes.
# It never silently serves a book it could not verify.
ORDERBOOK_MAX_RESYNC_ATTEMPTS=10
# A book quiet for longer than this is treated as stale and is not tradeable.
ORDERBOOK_STALENESS_THRESHOLD_MS=5000

# --- Websocket connection management ---
# These are read by the live transport (wlct_trading.net); the Part 3 library
# itself reads no environment at all.
WEBSOCKET_CONNECT_TIMEOUT_MS=10000
WS_HEARTBEAT_INTERVAL_MS=20000
# Silence after which the socket is considered dead and rebuilt. MUST be
# greater than WS_HEARTBEAT_INTERVAL_MS or healthy connections get killed.
WEBSOCKET_HEARTBEAT_TIMEOUT_MS=90000
# Reconnect backoff: capped exponential with full jitter. Jitter is not
# optional in production - without it every connection retries in lockstep
# after a venue blip and the reconnect storm is self-inflicted.
WS_RECONNECT_BASE_DELAY_MS=500
WS_RECONNECT_MAX_DELAY_MS=30000
WS_RECONNECT_MAX_ATTEMPTS=20
# Binance drops stream connections at 24h; cycling early makes it planned.
WS_CONNECTION_MAX_LIFETIME_SECONDS=82800

# --- Staleness thresholds (per channel, milliseconds) ---
# Trades are legitimately sporadic on thin symbols; an order book going quiet
# is not. Thresholds differ so neither alert is useless.
STALENESS_ORDER_BOOK_MS=5000
STALENESS_BOOK_TICKER_MS=5000
STALENESS_TICKER_MS=10000
STALENESS_TRADES_MS=60000
STALENESS_CANDLES_MS=120000
STALENESS_CONNECTION_MS=30000

# --- Rate limiting (venue-published values; lower them, never raise them) ---
# Binance spot: 6000 request weight per minute per IP.
BINANCE_REQUEST_WEIGHT_PER_MINUTE=6000
# 5 inbound messages per second per socket, counting PING/PONG and every
# subscribe frame. Exceeding it disconnects; repeat offenders get IP-banned.
BINANCE_WS_MESSAGES_PER_SECOND=5
BINANCE_MAX_STREAMS_PER_CONNECTION=1024
# Metrics scrape interval for the connectivity layer.
CONNECTIVITY_METRICS_INTERVAL_SECONDS=15

# -----------------------------------------------------------------------------
# LIVE MARKET DATA TRANSPORT (libs/trading-core: wlct_trading.net)
# -----------------------------------------------------------------------------
# The concrete websocket and HTTP clients behind the Part 3 abstractions.
#
# PUBLIC MARKET DATA ONLY. Nothing in this section is a credential and nothing
# on this code path can accept one: the market-data adapter has no API-key
# parameter, no request is signed, and no order is ever submitted. Live order
# execution is NOT implemented.
#
# Endpoints. Both must be TLS - the service refuses to start on ws:// or
# http://, because market data an attacker can rewrite is a way to induce bad
# trades. When EXCHANGE_USE_TESTNET=true and these are left unset, the venue's
# testnet endpoints are used automatically.
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_REST_URL=https://api.binance.com

# Symbols to stream. Accepts BTC/USDT, BTC-USDT or BTCUSDT; all three are
# normalised to the canonical BASE-QUOTE form and then validated against the
# venue's own instrument list, so a typo or a delisted market fails at startup
# rather than producing a socket that is silent forever.
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT

# Channels. Each enabled channel adds one stream per symbol to the single
# shared connection (Binance allows 1024 streams per socket).
# "ticker" is the bookTicker stream: best bid/ask on every book change, which
# is what the risk engine's price checks need. The 1-second rolling ticker is a
# statistics feed, not a quote feed.
MARKET_DATA_TICKER_ENABLED=true
MARKET_DATA_TRADES_ENABLED=true
MARKET_DATA_ORDERBOOK_ENABLED=true

# Websocket timeouts. WEBSOCKET_RECEIVE_TIMEOUT_MS is a backstop below the
# heartbeat, not the primary liveness check: a thin symbol's trade stream can
# legitimately be silent for minutes, and the venue's protocol pings are
# answered by the client library without ever surfacing as a message. Set it
# too low and a healthy but quiet connection is torn down in a loop.
WEBSOCKET_RECEIVE_TIMEOUT_MS=300000
# Client-initiated ping cadence and its response deadline. Binance pings every
# 3 minutes and disconnects after 10 without a pong; this is the reverse
# direction, used to notice a peer that has gone away silently.
WEBSOCKET_PING_INTERVAL_MS=180000
WEBSOCKET_PING_TIMEOUT_MS=60000
WEBSOCKET_CLOSE_TIMEOUT_MS=5000
# Frame size ceiling. An unbounded reader is a memory-exhaustion vector.
WEBSOCKET_MAX_FRAME_BYTES=8388608

# HTTP timeouts for REST snapshots. Every request is bounded by all three;
# there is no code path that produces an unbounded wait.
HTTP_CONNECT_TIMEOUT_MS=5000
HTTP_READ_TIMEOUT_MS=10000
HTTP_TOTAL_TIMEOUT_MS=15000
# Retries are bounded and only fire for categories the retry policy calls
# retryable. A 400 is never retried; a 429 honours the venue's Retry-After.
HTTP_MAX_RETRIES=3
HTTP_MAX_CONNECTIONS=20

# Duration of the separately invoked live smoke test
# (scripts/live_market_data_smoke_test.py). That script is the only thing in
# the repository that touches a real exchange; the normal test suite needs no
# internet, credentials, database or Redis.
LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=30

# -----------------------------------------------------------------------------
# EMAIL
# -----------------------------------------------------------------------------
# console | smtp (implemented). ses and postmark are planned; selecting an
# unimplemented driver fails fast instead of dropping mail silently.
MAIL_DRIVER=console
MAIL_FROM_NAME=CopyTrade
MAIL_FROM_ADDRESS=no-reply@copytrade.app
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

# -----------------------------------------------------------------------------
# NOTIFICATIONS (push / sms / webhooks)
# -----------------------------------------------------------------------------
NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_BASE64=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# -----------------------------------------------------------------------------
# LOCALIZATION / CURRENCY
# -----------------------------------------------------------------------------
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,es,ar,bn,tr
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AED,BDT,TRY
FX_RATES_PROVIDER=none
FX_RATES_API_KEY=

# -----------------------------------------------------------------------------
# KYC (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | sumsub | onfido | shufti
KYC_PROVIDER=none
KYC_API_URL=
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# -----------------------------------------------------------------------------
# PAYMENTS / BILLING (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | stripe | nowpayments
BILLING_PROVIDER=none
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# -----------------------------------------------------------------------------
# BOOTSTRAP / SEED (development only)
# -----------------------------------------------------------------------------
# QUOTING: always wrap a value in double quotes if it contains '#', a space, or
# any shell metacharacter. The '#' case is the one that bites: dotenv-cli treats
# an unquoted '#' as the start of a comment and silently truncates the value,
# while sourcing the same file from bash (`set -a; . .env`) keeps it intact.
# The two then disagree, so the password the seed hashes is not the password
# your scripts send, and you get an inexplicable 401 followed by a lockout.
#   WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026   -> becomes "My_P4ss"
#   RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
SEED_SUPER_ADMIN_EMAIL=superadmin@copytrade.app
SEED_SUPER_ADMIN_PASSWORD="ChangeMe_Str0ng!Pass"
SEED_TENANT_ADMIN_EMAIL=admin@acme-capital.test
SEED_TENANT_ADMIN_PASSWORD=ChangeMe_Str0ng!Pass

# -----------------------------------------------------------------------------
# ADMIN WEB (Next.js) - consumed by apps/admin-web
# -----------------------------------------------------------------------------
# Server-side base URL used by Next route handlers and server components to
# reach the API. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Organisation the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Salt for the console's session cookies. Generate: openssl rand -base64 32
SESSION_COOKIE_SECRET=change_me_admin_session_secret_min_16_chars

# Browser-visible values only. Never place a secret behind NEXT_PUBLIC_.
NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
NEXT_PUBLIC_DEFAULT_LOCALE=en

# -----------------------------------------------------------------------------
# TRADING ENGINE (services/trading-engine, Python/FastAPI, port 8001)
# -----------------------------------------------------------------------------
TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001

# Pre-trade risk ceilings. These are hard caps enforced by the engine on every
# order intent; they are not user-configurable from the client.
MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# -----------------------------------------------------------------------------
# MARKET DATA (services/market-data, Python/FastAPI, port 8002)
# -----------------------------------------------------------------------------
MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
# Public reference-price sources, tried in order. No credentials are used.
MARKET_DATA_SOURCES=binance,bybit
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
# A cached quote older than this is served with stale=true.
MARKET_DATA_CACHE_TTL_SECONDS=15
# Enables the realtime websocket connectivity layer (wlct_trading.transport).
# Off by default: with it disabled the service serves cached REST quotes only
# and opens no exchange sockets.
MARKET_DATA_STREAMING_ENABLED=false

# -----------------------------------------------------------------------------
# NOTIFICATION SERVICE (services/notification-service, Node/BullMQ, port 8003)
# -----------------------------------------------------------------------------
NOTIFICATION_SERVICE_HOST=0.0.0.0
NOTIFICATION_SERVICE_PORT=8003
# The standalone worker reads MAIL_DRIVER, MAIL_FROM_* and SMTP_* from the
# EMAIL section above. Only "console" and "smtp" are implemented; any other
# value throws on startup rather than silently discarding mail.
# none | fcm | apns. "none" reports delivered:false instead of faking delivery.
PUSH_PROVIDER=none
# none | twilio
SMS_PROVIDER=none

# -----------------------------------------------------------------------------
# SHARED LOGGING (all Node and Python services)
# -----------------------------------------------------------------------------
# json in every deployed environment; pretty is for local terminals only.
LOG_FORMAT=json
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# MOBILE APP (apps/mobile, Flutter)
# -----------------------------------------------------------------------------
# The Flutter app deliberately does NOT read this file. A .env shipped inside an
# APK/IPA is trivially extractable, so every mobile value is compiled in with
# --dart-define and the app holds no secrets at all: it authenticates with the
# user's own credentials and stores the resulting tokens in the platform
# keystore (flutter_secure_storage), never in shared preferences or a bundled
# asset. The variables below are listed here only so that all configuration for
# the platform lives in one discoverable place.
#
#   APP_ENV       development | staging | production
#   API_BASE_URL  Base URL INCLUDING the global prefix, e.g. https://api.example.com/api
#                 Android emulator reaches the host through 10.0.2.2, not localhost.
#                 Production builds refuse to start unless this is https://.
#   API_VERSION   URI version segment appended after the prefix (v1)
#   TENANT_SLUG   Sent as X-Tenant-Slug; identifies the white-label brand
#   WS_URL        Socket.IO origin, without the /realtime namespace
#
# Local development against this compose stack:
#
#   flutter run \
#     --dart-define=APP_ENV=development \
#     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=platform \
#     --dart-define=WS_URL=http://10.0.2.2:4000
#
# Release build:
#
#   flutter build apk --release \
#     --dart-define=APP_ENV=production \
#     --dart-define=API_BASE_URL=https://api.example.com/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=acme \
#     --dart-define=WS_URL=https://api.example.com
#
# Prefer --dart-define-from-file=config/production.json in CI so the values are
# versioned per environment instead of being retyped on the command line.

# =============================================================================
# PART 5 - AUTHENTICATED EXECUTION (libs/trading-core: wlct_trading.execution)
# =============================================================================
# Everything in this block governs whether real orders can reach a real
# exchange with real money. Read the whole section before changing anything.
#
# THE DEFAULTS BELOW CANNOT TRADE. That is deliberate and it is enforced in
# code, not just by convention: an unset variable is never treated as
# permission, and a contradictory combination fails at startup rather than
# resolving itself to the dangerous option.

# -----------------------------------------------------------------------------
# Exchange credentials
# -----------------------------------------------------------------------------
# NEVER commit real values. NEVER paste a key into a ticket, a chat message or
# a log. These are read once at startup by the credential provider and are
# never written to the database, never returned by an API, never included in a
# WebSocket payload and never logged - the credential object redacts itself in
# every rendering path, including repr() and f-strings.
#
# Create the key on Binance with ONLY:
#   [x] Enable Reading
#   [x] Enable Spot & Margin Trading
#   [ ] Enable Withdrawals   <-- MUST stay off
# A withdrawal-capable key is rejected by verify_credentials() and by the
# CREDENTIALS_VALID safety gate. The platform is non-custodial and refuses to
# hold a key that can move funds off the exchange.
#
# Also add an IP allowlist on the key. It is the single most effective control
# available, and it is free.
#
# These two variables are for a single-tenant development setup only. In
# production, per-tenant credentials come from the secret manager through
# SecretManagerCredentialProvider (Vault / AWS Secrets Manager / GCP Secret
# Manager / KMS), keyed by tenant and account. Environment variables do not
# scale to multi-tenant and cannot be rotated per customer.
BINANCE_API_KEY=
BINANCE_API_SECRET=
# Optional: restricts what the platform believes the key can do, independently
# of what the venue says. Comma separated. WITHDRAW here is always refused.
BINANCE_API_PERMISSIONS=SPOT
# Where credentials come from: env | secret-manager | none
CREDENTIAL_PROVIDER=env
# Cache TTL for a resolved credential, in seconds. Short, so a revoked key
# stops working quickly; non-zero, so every order does not hit the secret
# manager. 300 is a reasonable compromise.
CREDENTIAL_CACHE_TTL_SECONDS=300

# -----------------------------------------------------------------------------
# The four switches that gate real money
# -----------------------------------------------------------------------------
# All of the following must agree before a single byte reaches a real venue:
#
#   LIVE_TRADING_ENABLED=true
#   DRY_RUN=false
#   PAPER_TRADING=false
#   TRADING_MODE=LIVE
#   TRADING_ENABLED=true
#   LIVE_TRADING_CONFIRMED=true
#
# Any disagreement is a startup failure with an explicit message. In
# particular:
#   * LIVE_TRADING_ENABLED=true with DRY_RUN=true   -> REJECTED (contradiction)
#   * LIVE_TRADING_ENABLED=true with PAPER_TRADING=true -> REJECTED
#   * LIVE_TRADING_ENABLED=true without TRADING_MODE=LIVE -> REJECTED
# The platform never silently picks the dangerous interpretation, and never
# silently downgrades a misconfigured LIVE to PAPER either - a silent downgrade
# hides a production misconfiguration until the day it matters.

# Master switch for real-money execution.
LIVE_TRADING_ENABLED=false

# Build, validate, risk-check and sign the request, then stop. Nothing is
# transmitted and the order is NEVER reported as submitted. This is the correct
# setting for verifying a configuration end to end without risk.
DRY_RUN=true

# Route orders to the simulated venue. Paper fills are computed from real
# observed prices and are labelled is_simulated=true everywhere they appear -
# in the database, in the API and in every PnL figure.
PAPER_TRADING=true

# -----------------------------------------------------------------------------
# Execution timing
# -----------------------------------------------------------------------------
# How long to wait for a venue response before treating the outcome as UNKNOWN.
# A timeout is ambiguous, not a failure: the order may have been accepted. It
# is reconciled by clientOrderId and never resubmitted.
ORDER_REQUEST_TIMEOUT_MS=10000

# How often the background sweep compares local state against the venue.
ORDER_RECONCILIATION_INTERVAL_MS=60000

# How long to wait before reconciling an order whose result was unknown. Long
# enough for the venue to have finished processing; short enough that a
# position is not a mystery for minutes.
ORDER_UNKNOWN_RECONCILIATION_DELAY_MS=2000

# How often the exchange clock offset is re-measured. A signed request whose
# timestamp is outside the venue's window is rejected, so this is not optional.
EXCHANGE_TIME_SYNC_INTERVAL_MS=300000

# Maximum tolerated difference between this host's clock and the venue's.
# Above this, signing is REFUSED rather than attempted - Binance rejects a
# timestamp more than 1000ms ahead of server time regardless of recvWindow, so
# a larger local error cannot be compensated for by widening the window. If you
# hit this, fix NTP; do not raise the limit.
EXCHANGE_MAX_CLOCK_SKEW_MS=1000

# recvWindow sent with every signed request. Binance caps this at 60000.
# Smaller is safer: it bounds how long a captured request stays replayable.
EXCHANGE_RECV_WINDOW_MS=5000

# How long a clientOrderId reservation is remembered in Redis. The durable
# guard is the unique index on (tenant_id, client_order_id); this is the cheap
# fast path in front of it. 86400 = 24h.
EXECUTION_IDEMPOTENCY_TTL_SECONDS=86400

# Refuse to submit when the risk snapshot is older than this. Stale risk state
# is treated as unavailable, and unavailable means the order is refused.
MAX_RISK_STATE_AGE_MS=5000

# Submission attempts for genuinely retryable failures. Never applied to an
# ambiguous result - that path reconciles instead of retrying, always.
MAX_SUBMIT_ATTEMPTS=1

# -----------------------------------------------------------------------------
# Private user-data stream
# -----------------------------------------------------------------------------
# The authenticated WebSocket that delivers fills, order updates and balance
# changes. Backend only: its payloads are the full order flow of a real
# account and must never reach a mobile client or the admin web app.
PRIVATE_STREAM_RECONNECT_ENABLED=true

# Listen-key keepalive interval. Binance expires a listen key after 60 minutes;
# 30 minutes means one renewal can fail entirely and the stream still survives.
PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS=1800000

# After every reconnect the platform reconciles, because Binance does not
# replay events missed while disconnected. Leave this on.
PRIVATE_STREAM_RECONCILE_ON_RECONNECT=true

# -----------------------------------------------------------------------------
# Live-trading harness (NOT part of the default startup path)
# -----------------------------------------------------------------------------
# Guards the separately-invoked script that places a real order on testnet.
# It refuses to run unless this is explicitly true AND the credentials point at
# a testnet endpoint.
LIVE_EXECUTION_HARNESS_ENABLED=false
BINANCE_USE_TESTNET_FOR_HARNESS=true

# =============================================================================
# PART 6 - STRATEGY ENGINE, PAPER TRADING, BACKTESTING
# =============================================================================
# The strategy layer decides what it would like to do. It cannot submit an
# order, it never sees a credential, and NOTHING IN THIS SECTION CAN ENABLE
# LIVE TRADING. That still requires the Part 5 combination above
# (LIVE_TRADING_ENABLED=true, EXECUTION_ENABLED=true, DRY_RUN=false,
# PAPER_TRADING=false, EXCHANGE_SANDBOX_MODE=false), and every one of those is
# validated at startup.
#
# THREE THINGS THIS SECTION CANNOT PROMISE:
#   BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
#   PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
#   SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Feature switches
# -----------------------------------------------------------------------------
# Master switch for the strategy engine. Off by default: a deployment that has
# not been asked to run strategies should not spend CPU on every book update.
STRATEGY_ENGINE_ENABLED=false

# Whether paper sessions may be started. A paper session routes to the
# simulated adapter and refuses any adapter that is not marked simulated, so
# this is safe to leave on.
PAPER_TRADING_ENABLED=true

# Whether backtests may be submitted. A backtest opens no socket and touches
# no venue; it reads a stored dataset and replays it.
BACKTEST_ENABLED=true

# -----------------------------------------------------------------------------
# Engine bounds
# -----------------------------------------------------------------------------
# Bound on the in-process market-data queue feeding the strategies. A bounded
# queue turns a slow strategy into shed load rather than unbounded memory
# growth. Valid range 100 - 1000000.
STRATEGY_EVENT_QUEUE_SIZE=10000

# Hard cap on concurrently registered strategy instances per process.
# Valid range 1 - 1000.
STRATEGY_MAX_INSTANCES=50

# Observation budget for one dispatch, in milliseconds. Exceeding it increments
# a counter and marks the dispatch slow so an operator can see degradation.
# It is NOT a guarantee: this platform makes no latency guarantee, and any
# claim of "sub-millisecond" processing would be false. Must stay well below
# SIGNAL_MAX_AGE_MS.
STRATEGY_MAX_PROCESSING_LATENCY_MS=50

# -----------------------------------------------------------------------------
# Signal handling
# -----------------------------------------------------------------------------
# A signal older than this is refused by the validator rather than acted on.
# Stale intent is how a processing backlog turns into a bad fill.
SIGNAL_MAX_AGE_MS=2000

# How long a signal identity is remembered so an identical repeat is dropped.
# This is a bounded in-memory guard against a chattering strategy - it is NOT
# the order idempotency system, which lives in the execution layer and is
# backed by a unique index. Must cover at least SIGNAL_MAX_AGE_MS.
SIGNAL_DEDUP_TTL_SECONDS=5

# -----------------------------------------------------------------------------
# Backtest defaults
# -----------------------------------------------------------------------------
# Applied when a backtest request does not state its own assumptions. They are
# recorded in the configuration hash of every run, so changing one here changes
# the identity of subsequent runs - which is the point: two results computed
# under different cost assumptions are not comparable.
#
# None of these describe a real account or a real fee schedule. Set them from
# your venue's published rates.
BACKTEST_DEFAULT_INITIAL_CAPITAL=10000

# Fee RATES, not basis points: 0.001 is ten basis points. Maker and taker are
# separate because they are separate on every venue that matters.
BACKTEST_DEFAULT_MAKER_FEE=0.001
BACKTEST_DEFAULT_TAKER_FEE=0.001

# Slippage in basis points applied against every simulated taker fill, on both
# sides. Zero fees together with zero slippage is refused in production: that
# combination produces results no real account could achieve.
BACKTEST_DEFAULT_SLIPPAGE_BPS=1

# =============================================================================
# PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
# =============================================================================
# Datasets feed the Part 6 backtest engine. They are public market data: no
# credentials exist for them and none are accepted by them. Nothing in this
# section can enable live trading or route an order; the ingestion path shares
# no import with the execution path by design (and by test).
#
# BACKTEST RESULTS OVER THESE DATASETS ARE SIMULATIONS.
# BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
# SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
# Only the local backend ships. Object storage (S3-compatible, GCS, Azure)
# will be a new enum value and a new module - never a branch in the local one.
DATASET_STORAGE_BACKEND=local

# Root for finalised dataset trees. Must be absolute in production.
DATASET_LOCAL_ROOT=./data/datasets

# Staging root for in-flight ingestion. Must be on the SAME filesystem as
# DATASET_LOCAL_ROOT (finalisation is a rename) and disjoint from it
# (staging under the visible tree would expose half-written versions).
DATASET_TEMP_ROOT=./data/staging

# Hard ceiling for one partition file, in bytes (1 MiB - 4 GiB).
DATASET_MAX_PARTITION_BYTES=268435456

# Streaming reader chunk size (4 KiB - 64 MiB). The only read buffer a replay
# ever allocates; memory does not grow with dataset size.
DATASET_READER_BUFFER_SIZE=65536

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------
# Validate new versions before they become visible. Off is for emergency
# re-ingest of data validated elsewhere; such manifests are stamped
# "unvalidated" so they never masquerade as validated ones.
DATASET_VALIDATION_ENABLED=true

# Cap on gap findings repeated in a report (0 - 10000). Counts stay exact.
DATASET_MAX_GAP_WARNINGS=100

# Event ceiling per partition (1,000 - 50,000,000).
DATASET_MAX_EVENTS_PER_PARTITION=2000000

# Retention for NON-validated staging only. 'retain' keeps everything,
# including quarantined evidence. Nothing in this repo auto-deletes evidence.
DATASET_RETENTION_POLICY=retain

# -----------------------------------------------------------------------------
# Ingestion and backtest binding
# -----------------------------------------------------------------------------
# Master switch for dataset ingestion jobs. Off by default and never
# auto-enabled in production: a backfill is a deliberate act.
HISTORICAL_INGESTION_ENABLED=false

# Require backtest submissions to name a registered dataset VERSION.
# This is the rule that ends "re-ran the same backtest on different data":
# a run without a pinned version is refused rather than quietly guessed.
BACKTEST_DATASET_REQUIRED=true

# -----------------------------------------------------------------------------
# Part 8: real-time risk engine (control plane)
# -----------------------------------------------------------------------------
# These keys configure the API's risk control surface and the platform-default
# ceilings the trading worker inherits. They can only ever tighten what the
# engine enforces; there is no key here that approves an order, loosens a
# breach or disables a check. See docs/PART8_RISK.md for the resolution
# hierarchy and the fail-closed matrix.

# Require the extended Part 8 gate at worker startup (the Part 2 core gate is
# mandatory regardless and cannot be switched off by any setting).
RISK_ENGINE_ENABLED=true

# Assertion, not a toggle: RISK_FAIL_CLOSED=false is rejected at parse time
# in every environment. The engine refusing what it cannot prove safe is not
# a mode; it is the design.
RISK_FAIL_CLOSED=true

# A hot risk snapshot older than this may not authorise risk-increasing
# orders (ms). Keep it comfortably above RISK_SNAPSHOT_REFRESH_MS or the
# deployment is guaranteed stale (the env loader refuses that combination).
MAX_RISK_STATE_AGE_MS=2000
RISK_SNAPSHOT_REFRESH_MS=250

# Platform default ceilings. Child scopes (account/strategy/symbol) resolve
# to the TIGHTEST applicable value across the whole chain; these numbers are
# the top of that chain, deliberately conservative, and an emergency
# "flatten everything now" can only lower them further - never raise them.
MAX_ORDER_NOTIONAL=1000
MAX_POSITION_NOTIONAL=5000
MAX_ACCOUNT_EXPOSURE=10000
MAX_STRATEGY_EXPOSURE=5000
MAX_SYMBOL_EXPOSURE=5000
MAX_OPEN_ORDERS=20
MAX_DAILY_LOSS=500
MAX_STRATEGY_DAILY_LOSS=250
MAX_DRAWDOWN=10
MAX_ORDERS_PER_SECOND=2
MAX_ORDERS_PER_MINUTE=30
MAX_CANCELS_PER_SECOND=2
MAX_CANCELS_PER_MINUTE=30
MAX_PRICE_DEVIATION_BPS=250
MAX_CONSECUTIVE_LOSSES=5

# Risk events are the operator-facing trail (breaches, switches, stale
# state). Pruned by the maintenance queue after this many days; the durable
# accounting trail remains in the audit log under its own retention.
RISK_EVENTS_RETENTION_DAYS=365

# =============================================================================
# Part 9: observability & operations
# =============================================================================
# Publication and retention settings - never trading settings. In production
# the *_ENABLED flags cannot be false (env validation refuses to parse); a
# deployment that cannot be observed while holding money is not a deployment.
OBSERVABILITY_ENABLED=true
METRICS_ENABLED=true
HEALTH_ENABLED=true
PROMETHEUS_ENABLED=true
PROMETHEUS_PATH=/metrics
ALERTING_ENABLED=true
# Scrape secret. OPTIONAL outside production, REQUIRED in production.
# Provide a real random value through your secret store; never commit one.
# The header the scraper must present is x-metrics-token.
# METRICS_TOKEN=
# Cadences. HEALTH_REFRESH_MS paces each service's mirror loop;
# ALERT_DEDUP_WINDOW_MS must be >= it (validation enforces the ordering);
# QUEUE_ALERT_AGE_MS is the oldest-waiting threshold, halved for the
# trade-execution queue where the severity is CRITICAL by policy.
HEALTH_REFRESH_MS=5000
METRICS_EXPORT_INTERVAL_MS=15000
ALERT_DEDUP_WINDOW_MS=60000
QUEUE_ALERT_AGE_MS=120000
# Retention floors (validation enforces the minima): only RESOLVED alerts and
# CLOSED incidents are ever pruned; unresolved rows stay until resolved.
ALERT_RETENTION_DAYS=90
INCIDENT_RETENTION_DAYS=365

# =============================================================================
# Part 10: tracing, error budgets, fault injection
# =============================================================================
# Telemetry observes; it never authorises. Nothing below changes a trading
# decision, and the fault switch cannot arm in production (the validators
# refuse the boot on both runtimes).
OTEL_ENABLED=false
# OTLP/HTTP JSON collector base URL. Required in production when enabled.
# OTEL_ENDPOINT=http://otel-collector:4318
OTEL_TIMEOUT_MS=2000
OTEL_SAMPLE_RATIO=0.1
# Comma-separated operations always sampled at ratio 1.0 regardless of the
# above (the "critical traces remain inspectable" list).
OTEL_PRIORITY_OPERATIONS=execution.transmit
# Failure injection - a TEST HARNESS SWITCH. Armed only with the guard on
# and only outside production; disabling the guard DISABLES the feature,
# it does not unlock production. No API route can arm or consume.
FAILURE_INJECTION_ENABLED=false
FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=true
# SLO engine. Evaluation cadence 1..59 minutes; retention has a hard floor
# of 7 days IN CODE - the configured value can only raise it.
SLO_ENABLED=true
SLO_EVALUATION_INTERVAL_MINUTES=5
SLO_RETENTION_DAYS=30
SLO_DEFAULT_WINDOW_MINUTES=1440
SLO_FAST_BURN_MULTIPLIER=14.4
SLO_SLOW_BURN_MULTIPLIER=6

# -----------------------------------------------------------------------------
# Part 11: trading-worker plane and read-replica policy.
#
# Three separable switches, all default-safe: the worker consumer (runs only
# in the dedicated `npm run worker` process / container - the API never hosts
# it), the execution engine it forwards to (services/execution-engine, which
# holds the venue side), and the read replica (off until BOTH the URL and the
# flag are set; half-configuration is a boot error, by design).
# -----------------------------------------------------------------------------
# Worker latch: false makes the worker boot EXIT with a reason rather than
# idle quietly. The API process ignores it (it never mounts the consumers).
WORKER_ENABLED=true
# Stable per-replica identity for claims and logs. Unset composes host:pid:rand.
# WORKER_ID=worker-a
# The fleet list the partition assignment is computed over - identical on
# every worker, comma-separated. Empty means "this worker alone".
# WORKER_MEMBERSHIP=worker-a,worker-b,worker-c
# Part 12: where live membership comes from. 'config' (the default) treats
# the list above as the fleet. 'registry' lets workers self-register through
# a Redis heartbeat zset - the list above becomes the documented fallback
# (first tick + registry outages) and claims remain the entire authority.
# WORKER_MEMBERSHIP_MODE=registry
# Heartbeat grace period for 'registry' mode; must be >= 2x
# WORKER_PARTITION_RETRY_MS when the mode is registry (schema-enforced).
# WORKER_MEMBERSHIP_TTL_MS=30000
# Keyspace width; changing it rescales every assignment at once (coordinated
# config change, ceiling 4096 pinned by the coordination fixtures).
WORKER_PARTITION_COUNT=8
WORKER_PARTITION_LEASE_TTL_MS=15000
WORKER_PARTITION_RETRY_MS=2500
# Parked-job cadence and the ceiling before a homeless job fails visibly
# (deferrals do not consume BullMQ attempts; this is what stops an eternal orbit).
WORKER_DEFER_DELAY_MS=3000
WORKER_MAX_DEFERS=30
WORKER_SHUTDOWN_TIMEOUT_MS=10000
# The execution engine (services/execution-engine) this worker forwards
# TRADE_EXECUTION commands to. It holds venue contact and credentials; this
# process holds only the queue.
EXECUTION_ENGINE_URL=http://127.0.0.1:8093
# REQUIRED by the worker (optional for the API). Must match the engine's
# EXECUTION_INTERNAL_TOKEN. Generate fresh; never reuse across environments.
# EXECUTION_ENGINE_TOKEN=
# Part 13 durable engine store (read by docker-compose for the
# execution-engine service). memory is the default and reports
# storeDurable=false honestly; postgres persists orders/events/fills in the
# engine_* tables (created by the API's migrations). Postgres without the
# DSN - or the DSN without postgres - refuses startup; there is no silent
# fallback in either direction. Details: services/execution-engine/.env.example
# and docs/PART13_DURABLE_STORE.md.
# EXECUTION_STORE_BACKEND=postgres
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct
# Part 14 journal retention, also read by the execution-engine service
# above: defaults keep APPLY disabled (dry-run/inspect always available);
# bounds and semantics in services/execution-engine/.env.example and
# docs/PART14_RETENTION.md. The prune itself runs from
# `node scripts/retention-run.mjs` under the deployment's scheduler.
# EXECUTION_RETENTION_ENABLED=false
# EXECUTION_RETENTION_EVENT_DAYS=90
# Read-replica routing. Off by default; every read stays on the primary.
# When on, replica-eligible reads move only while the replica is healthy AND
# its lag (last probe, 10s trust window) is within DATABASE_READ_MAX_LAG_MS;
# any unknown routes primary. Execution-critical reads never use the replica.
DATABASE_READ_ENABLED=false
# DATABASE_READ_URL=postgresql://replica-user:...@replica-host:5432/wlct?sslmode=require
DATABASE_READ_MAX_LAG_MS=1500
```


## FILE: services/execution-engine/.env.example (72 lines)

*the retention block: the two guards in prose (dark apply, never-pruned orders/fills/ledger), the both-sides cutoff law in one sentence, and the batch-ceiling semantics (exhausted means resume, not incident).*

```dotenv
# execution-engine - Part 11 worker plane
# Copy to .env and fill real values. NEVER commit the result. The platform
# validator (packages/config env.schema.ts) rejects known sample values in
# committed env files; this file carries samples deliberately - that is why
# it is named .env.example and excluded from validation.

# --- identity / transport ---------------------------------------------------
NODE_ENV=development
LOG_LEVEL=info
# Names this process in logs, health and worker assertions. Any stable id.
EXECUTION_INSTANCE_ID=execution-engine-local
# Loopback by default; container deployments set this to 0.0.0.0 and keep
# the port on the internal network only.
EXECUTION_ENGINE_HOST=127.0.0.1
SERVICE_PORT=8093
# REQUIRED, no default: shared secret with the Node worker, min 32 chars.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
EXECUTION_INTERNAL_TOKEN=replace-me-with-64-hex-characters-generated-fresh

# --- mode -------------------------------------------------------------------
# simulated is the only executable mode in this build. Setting live is a
# STARTUP REFUSAL by design (live venue adapter, credential provider and
# durable store land in Part 12) - a refusal to lift, not a placeholder.
EXECUTION_MODE=simulated
# true = submissions stop before transmission; cancel stays available.
EXECUTION_DRY_RUN=true
# Venue request timeout (core engine setting) and lock lease TTL.
EXECUTION_REQUEST_TIMEOUT_MS=5000
EXECUTION_LOCK_TTL_MS=15000

# --- simulated venue ----------------------------------------------------------
# Fixed mid used as top-of-book for any symbol. Leave unset for an empty
# book (submissions refuse for lack of price - the honest default).
# EXECUTION_SIMULATED_MID=50000
# Seed balances for the simulated account, ASSET=QUANTITY pairs. Always
# surfaced labelled simulated.
EXECUTION_PAPER_BALANCES=USDT=100000

# --- durable store (Part 13) --------------------------------------------------
# memory: process-local simulated store, lost on restart (readiness says so:
# storeDurable=false). postgres: durable engine store over the engine_orders /
# engine_order_events / engine_order_fills tables - they are owned by
# apps/api/prisma (migrations), so run the migrate job first; the service
# verifies the tables exist at startup and refuses if they do not.
# EXECUTION_STORE_BACKEND never silently degrades: postgres without a DSN,
# or a DSN without postgres, is a startup refusal.
EXECUTION_STORE_BACKEND=memory
# DSN for the durable store. A credential: env-only, never logged. Set this
# ONLY with EXECUTION_STORE_BACKEND=postgres (the config refuses the
# mismatch). The engine sets app.tenant_id per transaction, so these tables
# are ready for the platform's row-level-security policies from day one.
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct

# --- journal retention (Part 14) ----------------------------------------------
# The durable store's event journal (engine_order_events) is the one table
# retention prunes; orders and fills are never deleted, at any age, under
# any config. The four values below are bounded by the core's law
# (wlct_trading/retention.py) and a nonsensical combination refuses BOOT.
#   EXECUTION_RETENTION_ENABLED: false = dry-run only. Inspect and dry-run
#     always work; an apply request is answered 409 naming this variable.
#     Turn it on only after (a) an inspect, (b) a scheduled dry-run whose
#     ledger row you read, and (c) a fresh verified backup - docs/DR.md and
#     docs/PART14_RETENTION.md carry the runbook.
#   EXECUTION_RETENTION_EVENT_DAYS: journal rows are prunable only when BOTH
#     the row and its order's terminal stamp are older than this. 90 default.
#   EXECUTION_RETENTION_BATCH_ROWS / _MAX_BATCHES: per-statement and
#     per-run ceilings. A run that hits the ceiling reports "exhausted" and
#     the next scheduled run resumes - partial progress is the design.
# EXECUTION_RETENTION_ENABLED=true
# EXECUTION_RETENTION_EVENT_DAYS=90
# EXECUTION_RETENTION_BATCH_ROWS=2000
# EXECUTION_RETENTION_MAX_BATCHES=50
```


## FILE: docs/PART13_DURABLE_STORE.md (380 lines)

*section 13's PART 14 AMENDMENT: the journal-growth implication this part left unnamed is now answered, and the metrics time-series retention item is called out as DIFFERENT by name so the two are never conflated.*

```markdown
# Part 13 - The durable execution-engine store

Status: shipped. Every file in this part is reproduced in full in
`docs/PART13_HANDOVER_FULL_SOURCE.md`.

## 1. What this part is

`libs/trading-core` has defined the order-persistence PORT since Part 2 -
`wlct_trading.execution.store.OrderStore` - and its only implementations
were the in-memory reference and nothing else. The execution engine service
therefore recorded orders, fills, events and reconciliation state in
process memory: `storeDurable: false` at readiness, a truthful claim the
whole platform made sure to publish rather than hide (SECURITY has always
said the simulated store is process-local, and the numbers said so too).

Part 13 ships the durable adapter the port's docstring promised:
`services/execution-engine/app/store_sql.py` implements the same ABC over
Postgres, the DDL joins the schema that owns every table (Prisma, with the
generated row-level-security machinery covering the new tables
automatically), and the worker's startup tripwire - "refuse a durable
engine until the ack policy is re-reviewed" - got that re-review and is
documented in Section 6.

What did NOT change, deliberately:

* `EXECUTION_MODE=live` is still refused by code. Durability was ONE of
  live's prerequisites (credential provider and the authenticated
  order-placement review remain open); shipping the store did not sneak
  live closer by implication.
* The default backend is `memory`. Deployments opt into durability;
  nothing degrades silently in either direction (Section 5).
* The engine still serves the same four commands and answers 501 to
  everything else; a store backend is not a capability expansion.

## 2. The adapter

`PostgresOrderStore(OrderStore)` - thirteen port methods, one design:

* **Driver-free.** The store talks to a two-method protocol
  (`PgPool.acquire`, `PgPool.close`; `PgConnection.execute/fetch/fetchrow/
  transaction`). `app/pg_store.py` is the one module that imports `asyncpg`
  (the mypy override list says so, and a source-scan test pins that no
  other app module may import the driver). This keeps the semantics suite
  DB-free and the seam for a different driver one file deep.
* **Stateless over the tables.** There is no in-process projection to
  "replay" - every read is a query, so restart recovery is Postgres
  recovery. The reducer-shaped replay worry that motivates event-store
  designs elsewhere does not apply: the tables ARE the projection, written
  by transactional statements.
* **Fidelity first, strictness where SQL must be louder.** Reservation
  answers (win / resume / lost-race-with-holder), `record_fill`'s
  already-recorded `False`, `IN_SYNC`-erases-state, append-only events: all
  mirror the in-memory reference, which the port documents as the contract.
  Two places SQL is STRICTER by design, both documented at the statement
  and tested: `save_order` of an order claiming a client id held by a
  DIFFERENT order raises the unique violation instead of the reference's
  silent keep-the-first-mapping; and the reservation INSERT carries
  `reconciliation_state = UNKNOWN` (the reference store cannot express the
  crash-between-reserve-and-submit question at all - losing the process also
  loses the order - so the durable store states the true answer: unknown).
* **The one refusal.** `list_orders_needing_reconciliation` is the port's
  single cross-tenant method. Tenant-scoped answers to a fleet-wide
  question would be the "no orders need reconciliation" lie, and under this
  store's own GUC law a fleet-wide query is impossible by construction - so
  the durable adapter raises `CrossTenantSweepUnsupported` (an
  `OrderStoreError`, and the service has no route that reaches the
  reference store's sweep either). The platform's reconciliation runs
  per-account through the `reconcile-trading-account` command, which is
  tenant-scoped and fully supported.

## 3. Schema law

Three tables, owned by `apps/api/prisma/schema.prisma` +
`migrations/20260914120000_part13_execution_store/migration.sql`:
`engine_orders` (composite primary key `(tenant_id, order_id)`; unique
`(tenant_id, client_order_id)`), `engine_order_events` and
`engine_order_fills` (children keyed `(tenant, order)` by a composite
foreign key, so a child row cannot pair one tenant with another tenant's
order - cross-tenant children are a constraint violation, not a review
item).

Shape decisions the codebase will be asked to defend, and the answers:

* **DECIMALS AS TEXT.** `quantity`, `price`, fees and derived aggregates
  are `VARCHAR` columns holding the canonical `Decimal.__str__` output.
  Postgres `NUMERIC(p,s)` RESCALES - `average_fill_price` is a division
  with arbitrary residue (`0.100000000000000000000001` in the tests) - and
  a rounded stored aggregate would make the durable record disagree with
  the domain's own derivation. Decimal-as-text is already the wire law of
  this service's response schemas; the tables keep it end to end. The
  codec's round-trip test asserts string-level scale preservation, not
  just numeric equality.
* **MICROSECONDS AS BIGINT.** The platform's int-time law (the same one
  the leases and SLO rows obey); no Timestamptz on the execution plane, so
  no server timezone can ever edit history.
* **ENUM VOCABULARIES ARE VARCHAR, NOT CREATE TYPE.** The status/side/
  type/time-in-force values are owned by `wlct_trading.enums` and move with
  the library; a mirrored Postgres enum type would be a second source of
  truth with a drift bug waiting. The codec CONSTRUCTS the enum on read, so
  a row outside the vocabulary is a hard decode error (fail-closed), and
  tests pin that corrupt rows raise rather than default.
* **`seq BIGSERIAL` on both journals.** The in-memory store returns fills
  and events in insertion order; microsecond timestamps tie routinely
  (three transitions in one tick), so only a monotonic column reproduces
  "append order". It doubles as the row identity.
* **`reconciliation_state NULL` = IN_SYNC.** The reference store DELETES
  its map entry on sync; one fact gets exactly one spelling in the table
  too, and `engine_orders_reconciliation_state_idx` makes the flagged
  subset cheap.
* **Event `event_id` has NO unique constraint.** The port appends
  unconditionally; a constraint stricter than the contract would reject
  rows the reference store accepts. Indexed for correlation, not for
  dedup (Section 2's strictness list is exhaustive on purpose).
* **`ON DELETE RESTRICT` from tenant.** Operational tables elsewhere use
  Cascade or SetNull; execution records are the audit of money movement
  and must not vanish as a side effect of tenant deletion - not even by an
  admin's deliberate hard delete, which fails loudly instead.

`@@map` names are the SQL names (`engine_orders`, ...) so the RLS
generator's schema parse - "models whose non-nullable `tenantId` column is
`@db.Uuid`" - picked all three tables up WITHOUT any generator change:
coverage went 38 -> 41 covered tables on the next deterministic regeneration
(migration, enable.sql, disable.sql, coverage JSON), the coverage spec
re-derived and passed, and the enablement checklist's probes cover the new
tables exactly like the old ones.

## 4. The tenant law: one GUC, one transaction, every statement

Every port method runs `acquire -> transaction -> set_config('app.tenant_
id', $1, true) -> statements` - the character-identical contract of
`PrismaService.withTenantRls` on the Node side (bound parameter, local
scope, first statement in the transaction). Tests pin the law three ways:
every operation's first recorded statement is the GUC with the right
tenant bound; every operation opens and closes exactly one transaction;
and a statement error rolls back and propagates (never swallowed).

Consequences that matter:

* **RLS day one.** When an operator flips the generated policies on
  (Part 11's checklist-gated `enable.sql` step), the engine needs no code
  change - its tables were covered by the policy generation and its
  connections carry the GUC. A store whose queries could not satisfy the
  policies would make the enablement checklist a trap; this one makes
  enabling a no-op for the engine.
* **Malformed tenants fail before the connection.** The tenant column is
  `uuid`, so `PostgresOrderStore` refuses any `tenant_id` that is not the
  canonical 8-4-4-4-12 form, naming the reason, instead of letting the
  driver raise "invalid input syntax" mid-command. The wire header's own
  pattern is looser; the DB type is the stricter contract and the store
  states it.
* **Pool hygiene.** `_TenantTransaction` releases the connection in a
  `finally`, so the error paths cannot leak pool slots (test-pinned
  against the scripted fake).

## 5. Mode and backend: no silent anything

`EXECUTION_STORE_BACKEND=memory|postgres`, default `memory`:

* `postgres` without `EXECUTION_POSTGRES_DSN` (or with a non-`postgresql://`
  one) is a SETTINGS validation failure - the process does not start.
* A DSN set while the backend is `memory` is also a refusal ("a
  half-configured durable store is not a store"): the commonest silent
  failure in this space is someone believing durability was on. An EMPTY
  DSN string counts as unset (compose's `${VAR:-}` defaults must not arm
  the mismatch law).
* `postgres` + pool connect failure or a missing table is a STARTUP
  refusal: `app/pg_store.py` verifies `to_regclass('public.engine_orders')`
  (and the two journals) and names the migration in the error. There is no
  fallback to memory - "configured durable, running memory" is exactly the
  lie the `storeDurable` honesty rule exists to prevent, and the health
  surface would have no way to report it truthfully after boot.
* `build_runtime(settings, store=...)` accepts a store ONLY under the
  postgres backend (and demands one), so the composition function itself
  refuses any wiring where describe() would have to lie.
* Readiness and `/internal/v1/status` now carry `storeBackend` as well as
  `storeDurable`; the DSN never appears in `to_public_dict`, logs, or
  responses (whitelist law; the test asserts the literal credential
  substring is absent from the public view).

## 6. The worker ack-policy re-review (the tripwire's condition)

`docs/PART11_WORKER_SCALING.md` parked a forcing function: the worker's
startup gate REFUSED any engine reporting `storeDurable: true` until the
ack policy had been re-read against durability. That review happened now;
here is its result and the evidence behind it.

The policy under review (unchanged since Part 11): a TRADE_EXECUTION job
acks when the engine answers 2xx REGARDLESS of business outcome (a
receipt of `rejected` is a completed command - the decision is recorded,
not the queue's problem); 5xx/transport failures retry (BullMQ at-least-
once), and a retry may REPLAY a command that already applied. In-memory
that replay was harmless because a lost reply usually meant the process was
gone; durable, replays land next to the originals, so each replayable
command must be idempotent AGAINST THE TABLES:

1. **Credential verification / balance refresh**: read-only from the
   queue's view (the paper account adapter is still process-memory; its
   mirror rows are the API's, written via their own idempotent upserts).
   Replaying these changes nothing per-call. No store reservation.
2. **cancel-order**: transitions the order through the legal-transition
   table via the store; a replay either re-saves the same terminal state
   (upsert: idempotent) or finds the order already terminal and answers a
   `rejected` receipt (a record, not a second action). The store never
   DELETES, so no replay can resurrect history.
3. **reconcile-trading-account**: fills are recorded through
   `ON CONFLICT (tenant_id, fill_id) DO NOTHING` - a replayed execution
   answers "already recorded" and the order's aggregates are untouched
   (the bool `False` is the dedupe signal the engine's caller path uses);
   event appends carry the venue's event ids and the journal is append-only.
4. **The submission reservation** - the mechanism the whole Part 2
   `DuplicateOrderGuard` grew from - is now database-enforced: the unique
   `(tenant_id, client_order_id)` index. A redelivered submit resumes the
   reserved order (the ReservationOutcome contract) instead of creating a
   second position. This is ALSO the answer to the deeper question the
   tripwire was guarding: at-least-once delivery meets at-most-once
   EFFECTS through the reservation, which only BECOMES real on a durable
   store. The store's existence is what makes the retry taxonomy SAFE, not
   risky - the refusal had to be reviewed to notice that.

The gate therefore flips from "refuse durable" to "accept durable,
provided the engine's claim is coherent": `storeDurable: true` requires
`storeBackend: "postgres"` in the same status payload. A durable claim
without a named backend (an engine too old to send the field included -
'unknown' by parse) stays a startup REFUSAL: unproven durability is
unproven, and this worker only forwards under the reviewed contract. The
mode check keeps precedence (a live-mode engine is refused on mode before
anything else). Three new tests in `worker.spec.ts` pin accept-coherent,
refuse-incoherent (undefined/memory/unknown backend spellings), and
non-durable-passes-unchanged.

## 7. Engine restart: what actually survives

With the postgres backend: order rows, the event journal, fill ledger,
reservations (as rows) and reconciliation state all survive; a cancel
after restart finds its order instead of answering a truthful 404 (that
limitation is retired in Section 13's item list below, from Part 11).
Reconciliation state as-of-crash reads `UNKNOWN` for reserved-but-un-
submitted orders - which the engine treats as "query by clientOrderId,
never resubmit", the behavior the state was invented for.

What does NOT survive (and says so): the incident recorder and the account
balances of the paper adapter remain process-memory (they are simulated-
venue state, not the audit record; the API's account mirrors keep their
own durable path). Locks are in-memory per process - the distributed
RedisLockManager exists in the core for deployments that wire it; nothing
in Part 13 claimed otherwise, and `locksDistributed` still reports the
truth.

## 8. Configuration surfaces

* `services/execution-engine/.env.example`: the block (backend + DSN, with
  the "never a fallback" note).
* Root `.env.example`: a short discoverability note beside
  `EXECUTION_ENGINE_URL` (compose reads the root env).
* `docker-compose.yml` execution-engine service: `EXECUTION_STORE_BACKEND:
  ${EXECUTION_STORE_BACKEND:-memory}`, `EXECUTION_POSTGRES_DSN:
  ${EXECUTION_POSTGRES_DSN:-}`. The service's existing `depends_on:
  postgres: service_healthy` already orders the database; migrations are
  the migrate job's (they belong to the API's schema, and nothing else
  owns engine DDL).
* `requirements.txt` pins `asyncpg==0.29.0`, same pin as the trading
  engine (one upgrade sweep rule).

## 9. Test law (and its honest limits)

Three layers, all deterministic in-repo:

1. **`test_part13_postgres_store.py`** - statement-shape golden pins
   (reservation insert targets NO conflict clause; upsert assigns
   everything but the composite key; fill insert rides the unique index;
   the journal is append-only UPDATE/DELETE-free; child JSON is
   COALESCE'd and seq-ordered; the terminal-status array is IMPORTED from
   the shared enum, sorted for parameter determinism, never retyped;
   character-for-character the Node contract; every
   constant parses with sqlglot's postgres dialect) plus the
   reference-semantics mirror against a scripted connection, plus a full
   codec round-trip through an ECHO connection that captures INSERT
   parameters and answers the matching SELECTs from them (so column order,
   null spelling and scale survive the same values twice), plus
   strictness-divergence pins (unique violation propagates; the failed
   transaction rolls back), and the tenant-refusal-before-connection law.
2. **`test_part13_drift_parity.py`** - the cross-artifact trap: store SQL
   literals vs the migration's declared columns (both directions), vs the
   Prisma model's effective column set (exact set equality), the three
   constraints the semantics RIDE (client-id unique, fill-id unique,
   composite FK), and the width laws vs the wire validators.
3. **`test_part13_postgres_store_live.py`** - the real-database suite,
   SKIPPING by name unless `EXECUTION_TEST_POSTGRES_DSN` is provided:
   it applies the actual migration file, round-trips every port method,
   and SIMULATES ENABLEMENT: creates the tenant policies + ENABLE + FORCE
   on the three tables, then asserts the store's queries still return
   their tenant's rows (because of the GUC law), while a raw query on the
   same connection with no GUC sees ZERO rows and tenant A with its GUC
   cannot reach tenant B's row. That is the whole RLS argument, executed.

Limits, stated plainly: the sandbox where this part shipped has no
Postgres server (apt locked, no root), so layer 3 was verified to SKIP
correctly, not run; the SQL was verified with a real parser and exact
echo-round-trip fakes instead. The live file runs on the CI database with
the env var set, and Section 4's claims that depend on real query
behaviour (child JSON ordering, ON CONFLICT outcomes, policy interaction)
have no assertions anywhere else pretending they were executed here.

## 10. Operator runbook (durability on, in four moves)

1. Run the migrate job (applies
   `20260914120000_part13_execution_store` alongside the rest).
2. Set `EXECUTION_STORE_BACKEND=postgres` and `EXECUTION_POSTGRES_DSN` in
   the root env (a role with the same grants the API role has; no GRANT
   statements ship in the migration, matching the platform's existing
   single-role topology - a split-role deployment grants the three
   `engine_*` tables like every other table).
3. Restart the engine; if the tables are missing it REFUSES to start and
   says which ones. Verify `GET /health/ready` reports
   `storeBackend: "postgres", storeDurable: true` - the flag combination
   the worker's gate now accepts (Section 6).
4. Rolling restart with the backend on: commands in flight during the
   restart window are retried by the worker against the durable store -
   Section 6 is the contract that makes this boring.

To go back: unset both variables (memory + no DSN validates; memory +
lingering DSN does not). Old engine rows stay in the tables - nothing in
this part deletes anything, ever.

## 11. Decisions ledger

| Decision | Choice | Why not the alternative |
| --- | --- | --- |
| Where the adapter lives | service, not core | core is a pure library by law; the port's docstring pre-decided this |
| Projection | state tables, read-as-queried | an event-projection would add a fold with no benefit; the tables ARE durable state |
| Decimals | text | NUMERIC rescales; the record must equal the domain's derivation byte-scale |
| Enums | VARCHAR + codec | no mirrored CREATE TYPE to drift |
| Child ordering | `seq` | timestamp ties are the norm mid-tick |
| `save_order` on foreign client id | unique violation | silent keep-first is a foot-gun only memory can afford |
| Reservation recon state | UNKNOWN at reserve | durable stores must answer the crash question honestly |
| Cross-tenant sweep | raise `CrossTenantSweepUnsupported` | empty-list under RLS is a lie; per-account is the supported shape |
| Worker gate | accept coherent durable claims, refuse incoherent ones | the tripwire's condition was the re-review; it passed with the reservation mechanism as the reason |
| Backend default | memory | durability is opt-in; defaults that grab databases are how outages get made |
| `postgres` failure handling | startup refusal only, never fallback | a half-durable engine is the exact "false durability" this platform bans |
| Driver location | `app/pg_store.py` only | testability + one seam for driver changes |
| Tenant uuid check | store-side, pre-connection | self-explaining refusal beats a driver cast error at 3am |

## 12. Cross-references

* Port + reference implementation: `libs/trading-core/wlct_trading/
  execution/store.py` (unchanged in this part - the contract that made
  this addable without touching the engine's core).
* Ack policy + the retired tripwire: `docs/PART11_WORKER_SCALING.md`
  §13 items and the startup-gate paragraph (amended with the RESOLVED
  marker, in the Part 12 convention).
* RLS machinery: `docs/PART11_ROW_LEVEL_SECURITY.md` (enablement checklist
  now includes the engine tables via the 41-cover regeneration).
* SECURITY: the two amended bullets (engine store no longer "process-local
  by design" in postgres mode; live refusal now names only the missing
  prerequisites).
* ROADMAP: part row 13; open-list entry "durable execution-engine store"
  retired.

## 13. Open items this part closes and leaves

CLOSED: "durable execution-engine store wiring (Part 11 refuses live mode
until it exists)" - the store ships and the worker gate condition is
resolved. PARTIAL against the live-mode prerequisite list: durability yes,
credential provider + authenticated order-placement review still no, and
live still refuses at startup (Section 1).

Still open after this part (unchanged provenance): RLS enablement FLIP in
staging per checklist; `--due` scheduler wiring; time-series retention;
the full chaos/failover matrix on real infrastructure; the leader-gated
singleton job (item 2 above - Part 13 added no sweep to gate).

PART 14 AMENDMENT: the unbounded growth of `engine_order_events` that this
part shipped - implicit in section 2's journal design, unnamed in the list
above - is answered by Part 14 (docs/PART14_RETENTION.md): the journal is
the single prunable table, orders/fills/ledger are not, and the ledger
records every run. "Time-series retention" in the list above MEANS the
metrics plane (time-series storage behind the Prometheus exposition,
Part 9's open item) and stays open; engine journal retention and metrics
retention are different tables with different parts, and deployments
should not read either document as answering the other.
```


## FILE: docs/DR.md (118 lines)

*the backup-freshness section gains the Part 14 consequence: --due green before the first apply, the deletion ledger riding the same dump, and the one-line reason a prune followed by a failed restore is indistinguishable from an outage.*

````text
# Disaster recovery - the drill, not the binder

The machine-readable plan is `docs/dr/manifest.json` (validated and rendered
by `scripts/dr-manifest.mjs`; `--check` runs in CI, `--plan` produces the
operator runbook, and Part 12's `--due`/`--record` grade and log backup
freshness against `docs/dr/backup-ledger.jsonl`). This file is the human
half: why the manifest says what it says, the post-restore probes, the
ledger's rules, and the drill record every rehearsal must fill in before it
counts.

## The three rules everything else follows from

1. **Keys before ciphertext.** `encryption-keys` restores before `postgres`
   because a database whose credential columns cannot be decrypted is not a
   degraded system, it is a deleted one - and the confusion costs hours
   arguing with the restore. The validator refuses the inverted order
   outright, so nobody relearns this at 3am.
2. **Redis is rebuilt, not restored.** Its queues, claims, leases and rate
   windows are coordination state with TTLs; a snapshot replays the dead
   past as fresh truth. The manifest's redis verification is therefore about
   proving the EMPTY state behaves, not about proving the snapshot loaded.
   (This is the same reasoning as the Part 9 "no publisher reported is never
   'all clear'": stale operational state must announce itself.)
3. **A restore is timed or it didn't happen.** `drill.timed: true` is a
   validator requirement for exactly the reason the platform refuses false
   latency claims everywhere else: the number in the binder that nobody has
   re-measured is marketing.

## Post-restore probe queries (run as the operator role, then as the app role)

```sql
-- Migration ledger: no failures, and the count must equal the repository's
-- prisma/migrations directories for this deployment's schema stamp.
SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS incomplete,
       count(*) AS applied
FROM "_prisma_migrations";

-- Tenant isolation spot check (works WITH or WITHOUT RLS enabled; with the
-- Part 11 policies ENABLED these MUST read zero from a context without the
-- app.tenant_id GUC, and only-own-tenant with it):
BEGIN;
SELECT count(*) FROM orders;                                    -- no GUC
SELECT count(*) FROM orders, (SELECT set_config('app.tenant_id', '<probe-tenant-uuid>', true)) s;
ROLLBACK;

-- Audit ledger head exists (audit is append-only by policy, not by trust):
SELECT count(*) FROM audit_logs WHERE created_at > now() - interval '10 minutes';
```

The `tenant-scoped` app-role check belongs to whoever runs the enablement
(`apps/api/prisma/rls/enable.sql`'s checklist) - the probes above work from
`psql`; the API-level assertion is `withTenantRls`'s spec plus a staged
cross-tenant read attempt.

## Drill record (copy per rehearsal; a restore without this filled in is not a drill)

| Field | Value |
| --- | --- |
| Date / duration (against RTO `<manifest>.rtoHours` h) | |
| Manifest stamp reviewed (schema + paths verified current) | |
| Components restored, in order, with each verification outcome | |
| Deliberate failure injected (per `drill.successCriteria` - e.g. wrong master key) and the stop-the-line result | |
| Data-loss window actually observed (against RPO) | |
| Follow-up issues filed (every deviation, including "it worked too well") | |
| Sign-off (operator + one engineer not involved in the restore) | |

## The backup-freshness ledger (Part 12)

Manifest v2 states each component's obligation as data: `cadenceHours` -
the maximum age of the last recorded SUCCESS - or `cadenceHours: null` with
a written `cadenceWaiver` (redis is rebuildable; scheduling its copy would
manufacture an obligation the component's contract denies). Postgres' 24h
dump cadence under a 60m RPO is legal only because the component names the
`rpoMechanism` that closes the gap - the validator refuses the silence, not
the number.

The evidence is one JSON line per event in `docs/dr/backup-ledger.jsonl`:

    {"at":"2026-09-14T06:00:00.000Z","component":"postgres","outcome":"ok","note":"pg_dump + scratch restore verified"}

and two commands touch it:

* `node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed
  [--note TEXT] [--at ISO]` - refuses unknown components, broken ledgers
  (no appending onto unreadable evidence), non-ISO stamps, and any
  secret-shaped content in the note, scanning the RAW text because JSON
  escaping is not a laundering licence.
* `node scripts/dr-manifest.mjs --due [--now ISO]` - every component in
  restore order: current, overdue (measured from the last `ok`; a `failed`
  record does not stop the clock), never-recorded, or waived. Exit code 1
  iff something is due - which makes this exact command the cron entry
  point: alerting on it is the scheduler, and the scheduler is wiring, not
  design.

The ledger ships EMPTY on purpose. "No backup recorded" must read as four
`never recorded` alarms, not as fabricated green ticks - a platform that
refuses simulated fills does not seed its own evidence trail with
simulated backups.

Part 14 raised what a fresh `postgres` entry is WORTH: journal retention
deletes settled event rows, and a prune followed by a failed restore is
indistinguishable from a data-losing outage. The rule is therefore one
line of the retention runbook (docs/PART14_RETENTION.md §10, move 1):
`--due` green for `postgres` before the FIRST apply on any deployment,
and the cadence itself is now load-bearing evidence, not hygiene. The
deletion ledger (`engine_retention_runs`) rides the same dump as every
other table - "what was pruned when" must survive the restore that
replays the backup.

## What is NOT yet automated, plainly

The scheduler that runs `--due` on a timer and the drill calendar are the
remaining automation, and they are deliberately thin: Part 12 moved the
judgement (what is due, when, evidenced how) into the validator so the
scheduled half is one command and one exit code. This ordering is how the
rest of this platform ships: the contract and its validation come before
the automation that depends on them, so the automation has something honest
to check against on day one.
````


## FILE: docs/ARCHITECTURE.md (314 lines)

*the engine bullet's store paragraph extended: bounded journal, dark-by-default apply, the never-pruned run ledger, and no shipped schedule.*

````text
# Architecture

## 1. What this system is

A multi-tenant, white-label copy-trading platform. One deployment serves many
independent organisations ("tenants"), each with its own users, roles, branding,
subscription and configuration. It is **non-custodial**: the platform never
holds customer funds. Users connect their own exchange accounts with trade-only
API keys, and orders are placed on the user's own exchange account.

Part 1 delivers the foundation - tenancy, identity, authorisation, security and
the service skeletons. Copy-trading logic and live order execution are
explicitly out of scope and are hard-disabled in code.

## 2. Topology

```
                        ┌───────────────────────┐
   Mobile (Flutter) ───▶│                       │
                        │   NestJS API (:4000)  │◀─── Admin console (Next.js :3000)
   Browser ────────────▶│  REST + Socket.IO     │       (server-side proxy only)
                        └───────┬───────────────┘
                                │
            ┌───────────────────┼────────────────────────────┐
            │                   │                            │
     ┌──────▼──────┐     ┌──────▼──────┐            ┌────────▼────────┐
     │ PostgreSQL  │     │    Redis    │            │  Internal HTTP  │
     │  (Prisma)   │     │ cache/queue │            │  (token-gated)  │
     └─────────────┘     └──────┬──────┘            └────────┬────────┘
                                │                            │
                     ┌──────────┴──────────┐      ┌──────────┴──────────┬─────────────┐
                     │ notification-service│      │  trading-engine     │ market-data │
                     │  Node + BullMQ :8003│      │  Python/FastAPI:8001│ Python :8002│
                     └─────────────────────┘      └─────────────────────┘─────────────┘
```

Only the API and the admin console are published. The three supporting services
listen on the internal network and require a shared internal token.

## 3. Why these boundaries

**One API, several workers.** All client traffic terminates at the NestJS API.
It owns the database, authorisation and the audit trail. Everything else is a
worker or a calculator that the API delegates to. This keeps exactly one place
where a tenant boundary can be crossed, which is the property that makes
multi-tenancy auditable.

**Python for market and trading logic.** Exchange connectivity, numerical work
and the risk engine live where the ecosystem is strongest (`ccxt`, the
scientific stack) and where a hot loop will not block a Node event loop.

**Node for the notification worker.** It shares the API's queue contract and
templates; a second language there would buy nothing.

**A separate notification process, not an inline worker.** Email sending is slow
and failure-prone. Running it in the API process would couple request latency to
an SMTP server's mood. `QUEUE_RUN_INLINE_WORKERS` gates the inline path so a
single-process development setup still works.

## 4. Multi-tenancy

### Resolution

The tenant for a request is resolved in this order:

1. Custom domain (`TenantDomain`)
2. Platform subdomain
3. `X-Tenant-Slug` header
4. `DEFAULT_TENANT_SLUG`

For an authenticated request, whatever the above produced is **overridden** by
the tenant in the access token. A client-supplied tenant id is a hint for
unauthenticated flows (sign-in, branding) and never an authorisation input. An
*explicit* selection (domain, sub-domain or header) that contradicts the token
is rejected outright with `403 TENANT_MISMATCH` and recorded as a security
event; the `DEFAULT_TENANT_SLUG` fallback is not, because it reflects a server
assumption rather than a client claim. See `docs/MULTI_TENANCY.md`.

### Isolation

`TenantScopedPrismaFactory` wraps the Prisma client and injects a `tenantId`
predicate into every query against a tenant-owned model. The model allowlist is
explicit, so adding a table is a deliberate decision rather than an accident.

Supporting properties:

* Every tenant-owned table carries a non-null `tenantId`.
* `tenantId` is the first column of every composite index, so the predicate is
  free.
* Uniqueness is scoped: `User` is unique on `(tenantId, email)`, not on `email`.
* Platform-scoped rows use `tenantId = NULL` (system roles, platform plans).
  Prisma cannot express `NULL` inside a compound-unique `where`, so those rows
  are read with `findFirst` and written with explicit update/create branches.

Row-level security is the natural next step; the schema is already shaped for
it.

### Physical naming

Tables and columns are `snake_case` in PostgreSQL (`@@map` / `@map`) while the
Prisma client stays `camelCase` in TypeScript. Application code is unaffected by
the mapping, but every hand-written query, migration, psql session, BI tool and
`GRANT` in `infrastructure/database/init/` avoids permanently quoting
identifiers. Mixing the two conventions - `snake_case` tables with `camelCase`
columns - is the outcome worth avoiding, because it forces quoting anyway while
looking like an oversight.

## 5. Identity and authorisation

### Authentication

* **Passwords**: argon2id, with cost parameters from the environment.
* **Access tokens**: short-lived JWTs, signed with a dedicated key.
* **Refresh tokens**: stored as HMACs, never in the clear. Every refresh rotates
  the token and records `familyId` / `replacedByTokenId`. Presenting a consumed
  token revokes the entire family and raises a `CRITICAL` security event - that
  is the signal of a stolen token.
* **Device binding**: refresh tokens are bound to a client-generated device id,
  so a stolen token is useless elsewhere.
* **Logout**: blacklists the access token's `jti` in Redis until its natural
  expiry.
* **2FA**: TOTP via `otplib`. The secret is encrypted at rest with AAD
  `two_factor_secret:{userId}`; the last used counter is stored to block replay;
  recovery codes are argon2-hashed.
* **Defence**: per-account lockout, uniform responses to defeat account
  enumeration, a session cap with LRU eviction, and suspicious-login scoring.

### Authorisation

Roles are data, not code. Seven system roles ship as immutable templates
(`tenantId = NULL`, `isSystem = true`) and are cloned into each tenant at
creation, so a tenant can customise its own copy without affecting anyone else.

`PermissionsGuard` re-reads live permissions on every request rather than
trusting the token's snapshot, supports `all`/`any` semantics and wildcards
(`*`, `resource:*`), and emits a `PERMISSION_ESCALATION_ATTEMPT` event on
denial. Adding a role or permission is a data change; no authorisation code
needs to be rewritten.

## 6. Secrets and encryption

Exchange API credentials are the highest-value data in the system. They are
protected with envelope encryption:

* A fresh 256-bit **data key** per record.
* The data key is sealed with AES-256-GCM under a **key-encryption key**
  (`ENCRYPTION_MASTER_KEY_BASE64`), identified by `ENCRYPTION_KEY_ID`.
* `ENCRYPTION_PREVIOUS_KEYS_JSON` holds retired keys for decrypt-only, which
  makes rotation a zero-downtime operation.
* **AAD binds ciphertext to its owner** (`{tenantId}:{userId}`). A row copied
  into another tenant will not decrypt.
* `ENCRYPTION_PROVIDER=kms` swaps the local KEK for a managed KMS without
  touching call sites.

Deterministic lookups on encrypted values use an HMAC-SHA256 **blind index**
(`BLIND_INDEX_KEY_BASE64`). The same key hashes client IPs, so the audit trail
is correlatable without storing an address.

Secrets are never returned by the API. Reading a secret tenant setting yields
`{ configured: true }`.

## 7. Errors, logging and observability

Every error leaves the API in one envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable, safe to display.",
    "details": [{ "field": "email", "message": "Must be a valid email address" }],
    "requestId": "0f3c...",
    "timestamp": "2026-09-05T10:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

The Python services emit the same shape, so a client has one parser.

Logging is structured JSON via pino, with a redaction list covering
authorization headers, cookies, passwords, tokens, exchange secrets and payment
credentials. Stack traces never reach a production response body. Every request
carries an `x-request-id` that is propagated to the internal services.

Health endpoints: `/health` (liveness, no dependencies), `/health/ready`
(Postgres + Redis, 503 when down), `/health/deep` (adds queue depth and the
three downstream probes), `/health/startup`.

### The reliability plane (Part 10)

Above the metrics layer sits the reliability plane, and the one law over it:
**observe, never authorise.** Its parts:

* **Tracing.** `apps/api/src/infrastructure/tracing/` (W3C parse/format,
  deterministic BigInt sampling, OTLP/JSON encoder, the middleware,
  `TracingService`) mirrors `libs/trading-core/wlct_trading/observability/`
  (`tracing.py`, `redaction.py`, `faults.py`); the engine's glue is
  `services/trading-engine/app/tracing.py`. Propagation is
  W3C `traceparent`/`tracestate` in, OTLP/JSON out, single-attempt export
  with drop counting that is loud (counters + gauge + a three-streak alert).
  Head sampling is `int(trace_id[:16],16) < ratio_ppm * 2^64 / 10^6` - a pure
  function, identical in both languages, fixture-pinned.
* **SLOs.** Definitions are immutable versioned rows
  (`slo_configuration_versions`, checksummed canonical JSON); measurements
  live in 10-minute Redis bucket hashes (`wlct:trading:ops:slo:<source>:
  <epoch-min/10>`); evaluation appends `slo_evaluations` rows on a */N cron
  and on demand. Dual windows, dual multipliers: paging needs fast burn over
  the short window AND slow burn over the long one (Google SRE style);
  state is `HEALTHY/WARNING/CRITICAL/EXHAUSTED/UNKNOWN`, and UNKNOWN from a
  thin collector is reported as the measurement gap it is (`SLO_TELEMETRY_GAP`),
  never averaged away. The nine default objectives live in the Python catalog
  as the source of truth; the TS catalog is pinned to it by SHA-256 checksums
  that include the human-readable text.
* **Queue correlation.** A publish that succeeds attaches its traceparent to
  a short-TTL Redis sidecar (`captureQueueSidecar`); a worker continues the
  span only if the sidecar exists. Job payloads never carry telemetry fields,
  and telemetry never gates a job.
* **Cross-language contract.** `docs/fixtures/reliability_fixtures.json`
  (generated by `libs/trading-core/scripts/gen_part10_fixtures.py`) pins
  sampling decisions, traceparent/tracestate vectors, attribute hygiene,
  byte-exact OTLP payloads, budget/burn tables, catalog checksums and full
  evaluation rows; `slo-parity.spec.ts` replays every vector through the TS
  implementation. Drift on either side fails the suite, in either direction.

### The worker plane (Part 11)

The process model the earlier parts only described in comments finally
exists: three roles, each able to refuse, none able to impersonate another.

* **API** - unchanged producer of `TRADE_EXECUTION` jobs (deterministic
  `jobId` dedupe at admission, `enqueueOrThrow` for anything a human waits
  on); mounts no consumers, by module graph, not by flag:
  `src/modules/worker/` is imported only by `src/worker.ts`.
* **Worker** (`apps/api/src/worker.ts`, no HTTP server at all) - validates
  each job against the mirrored producer contract, admits it only while it
  verifiably HOLDS the partition claim its `${tenantId}:${accountId}` key
  maps to (rendezvous assignment + Redis claims, both languages pinned by
  `docs/fixtures/coordination_fixtures.json`), forwards, and acks: engine
  2xx completes the job (any business verdict inside it), engine terminal
  4xx/501 fails it visibly with the engine's reason, 5xx/transport retries
  within the producer's attempt budget, and not-owner defers via
  `moveToDelayed` - counted through `WORKER_MAX_DEFERS`, so homeless jobs
  page somebody instead of orbiting forever. Coordination failures fail
  CLOSED to deferral; the job path never awaits Redis.
* **Execution engine** (`services/execution-engine`) - the only process with
  venue-adjacent runtime, hosting the core `ExecutionEngine` behind an
  internal token + required tenant header; serves the four commands the
  queue actually carries, answers 501 to the one it cannot honor
  (`resync-private-stream`), and REFUSES `EXECUTION_MODE=live` at startup
  by code (durability shipped in Part 13; the credential provider and the
  authenticated order-placement review remain live's open prerequisites).
  The store is a backend choice: `memory` (default, process-local, reports
  `storeDurable: false`) or `postgres` (durable orders/events/fills in the
  three `engine_*` tables, DSN required, missing tables or a dead pool
  refuse startup - never a silent fallback). Part 14 added the bounded
  journal: the event table alone is prunable, apply is dark behind
  `EXECUTION_RETENTION_ENABLED`, every completed run (dry included)
  writes a `engine_retention_runs` ledger row nothing prunes, and no
  schedule ships - the deployment's cron calls
  `scripts/retention-run.mjs`, one tenant per run. The worker's boot gate asserts
  engine compatibility, and since the Part 13 ack-policy re-review it
  accepts a durable engine only when the claim is coherent
  (`storeDurable: true` + `storeBackend: "postgres"`).

Read-replica routing lives beside it as a policy, not a rewire:
`routeRead` fails closed in every direction (execution-critical reads never
see the replica; unknown lag or a stale probe routes primary;
half-configured deployments refuse to boot), and the counter family
`wlct_read_routing_decisions_total` makes "we have a replica we never use"
a number instead of a rumor.

The full law, the queue-consumer inventory, the runbook and the honest
deferral list are in `docs/PART11_WORKER_SCALING.md`.

## 8. Real-time

Socket.IO on the `/realtime` namespace. Tokens arrive only in the handshake, and
room membership is derived server-side from the authenticated identity - a
client cannot ask to join `tenant:someone-else`. Cross-node fan-out publishes to
the Redis channel `realtime:dispatch`, and the Redis adapter is keyed with the
configured prefix so several environments can share one Redis instance safely.

## 9. Execution safety

Part 1 must not be able to move money. Three independent gates:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine exposes risk evaluation only; there is no order-placement
   route to call.
3. `RiskDecision.wouldExecute` is `approved AND EXECUTION_ENABLED`, so even an
   approved intent reports that it would not execute.

`EXCHANGE_SANDBOX_MODE=true` additionally disables any venue without a sandbox.

## 10. Deployment

`docker-compose.yml` is the reference topology. Migrations run as a one-shot
job (`migrate`) that must complete successfully before the API starts - running
them from every replica is a race, and a failed migration should stop a deploy
rather than crash-loop an application container.

All images are multi-stage, run as non-root, carry health checks, and contain no
source, no `.env` and no build cache.

## 11. What Part 1 deliberately does not do

* No copy-trading engine, position sizing, or follower allocation.
* No live order placement.
* No payment provider integration (no card data touches the platform).
* No KYC provider integration (the model and status field exist).
* No row-level security policies yet.
* No simulated trading results anywhere in the product.
````


## FILE: docs/SECURITY.md (391 lines)

*the retention bullet: the only deletion path on the engine plane, triply narrow (one table under an app-wide scan, config-dark, internal-only and tenant-per-call), with every run leaving a row under the same RLS law as its subjects.*

```markdown
# Security

This document states what the platform does, why, and where the control lives in
the code. It is written to be checked, not admired: every claim points at a file.

## Threat model in one paragraph

The platform holds credentials that can place trades on a user's exchange
account, and it serves many organisations from one deployment. The two failures
that matter most are **cross-tenant data exposure** and **exchange credential
disclosure**. Everything below is ordered by how directly it prevents one of
those two.

---

## 1. Tenant isolation

| Control | Where |
| --- | --- |
| Query-level tenant predicate | `apps/api/src/infrastructure/database/tenant-scoped-prisma.factory.ts` |
| Tenant resolution and override | `apps/api/src/common/guards/tenant.guard.ts` |
| Non-null `tenantId` + scoped uniqueness | `apps/api/prisma/schema.prisma` |

* A client-supplied tenant identifier is **never** an authorisation input. For
  an authenticated request the tenant comes from the access token.
* Every tenant-owned model is in an explicit allowlist. Adding a table to the
  scoped set is a deliberate edit, not a default.
* Uniqueness is per tenant: two organisations may both have `admin@example.com`.
* Platform-scoped rows (`tenantId = NULL`) are only reachable by platform users,
  enforced by `@PlatformOnly()`.

## 2. Authentication

| Control | Detail |
| --- | --- |
| Password hashing | argon2id; memory/time/parallelism from `ARGON2_*` |
| Access token | short-lived JWT, dedicated signing key |
| Refresh token | stored as HMAC, rotated on every use |
| Reuse detection | a replayed token revokes the whole family and raises `TOKEN_REUSE` (CRITICAL) |
| Device binding | refresh tokens bound to a client-generated device id |
| Logout | access-token `jti` blacklisted in Redis until expiry |
| Global revocation | `sv` claim vs `User.sessionVersion`, checked on every request |
| Session cap | LRU eviction by `lastSeenAt` |
| Lockout | per-account after `LOGIN_FAILED_MAX_ATTEMPTS` within the window |
| Enumeration | identical response and timing for unknown and wrong-password |

### Invalidating live access tokens

Blacklisting a `jti` only kills one token. Password changes and "sign out of
all devices" have to kill *every* token the user holds, including ones already
in flight, so each access token carries an `sv` claim holding the user's
`sessionVersion` at issue time. `JwtStrategy` (and `WsAuthGuard`, so open
sockets drop too) compares it with the stored counter on every request and
rejects a mismatch with `TOKEN_REVOKED`. Incrementing the counter therefore
invalidates all outstanding tokens instantly, without a distributed blacklist.

An integer counter is used rather than comparing the token's `iat` with
`passwordChangedAt`. `iat` has one-second resolution while the timestamp is
stored in milliseconds, so any time-based comparison is ambiguous for tokens
minted in the same second as the change - which is exactly what happens when a
user is handed new tokens immediately after changing their password, or when a
freshly provisioned tenant owner signs in for the first time. The counter also
cannot be skewed by clock drift between API instances.

### Two-factor authentication

TOTP via `otplib`. The shared secret is encrypted at rest with AAD
`two_factor_secret:{userId}`. `lastUsedCounter` is persisted so a captured code
cannot be replayed inside its window. Recovery codes are argon2-hashed and
single-use.

The challenge token issued between the password step and the code step is
bounded rather than strictly single-use: up to
`TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS` (default 5) codes may be tried against it,
after which it is discarded, and it is burned outright the moment a code is
accepted. Burning it on first sight would force a user who mistyped one digit
back through the password step; allowing unlimited tries would leave a captured
challenge open to brute force for its whole TTL. The attempt counter lives in
Redis under the challenge `jti` and expires with it. The endpoint additionally
sits behind the strict `auth` throttler, so the per-challenge budget is the
inner of two independent bounds.

## 3. Authorisation

Deny-by-default. `JwtAuthGuard` rejects any request without a valid token unless
the route is explicitly `@Public()`.

`PermissionsGuard` re-reads the user's live permissions on every request rather
than trusting the token payload, so revoking a role takes effect immediately
rather than at the next token refresh. Wildcards (`*`, `resource:*`) are
supported. A denial emits `PERMISSION_ESCALATION_ATTEMPT`.

Roles are data. Seven system roles ship as immutable templates and are cloned
per tenant. Adding a role never requires an authorisation-code change.

## 4. Exchange credential protection

**The platform never stores an exchange API secret in plaintext, never returns
one through the API, and never writes one to a log.**

Envelope encryption (`packages/utils/src/crypto.ts`):

1. A fresh 256-bit data key (DEK) is generated per record.
2. The payload is sealed AES-256-GCM under the DEK.
3. The DEK is sealed under the key-encryption key (KEK) from
   `ENCRYPTION_MASTER_KEY_BASE64`, tagged with `ENCRYPTION_KEY_ID`.
4. Additional authenticated data binds the ciphertext to `{tenantId}:{userId}`.
   A row copied to another tenant fails to decrypt - tampering is detected, not
   tolerated.

### Key management

| Variable | Purpose |
| --- | --- |
| `ENCRYPTION_MASTER_KEY_BASE64` | active KEK |
| `ENCRYPTION_KEY_ID` | identifies the active KEK in each ciphertext |
| `ENCRYPTION_PREVIOUS_KEYS_JSON` | retired KEKs, decrypt-only |
| `ENCRYPTION_PROVIDER` | `local` or `kms` |

Rotation is zero-downtime: add a new KEK, move the old one into
`ENCRYPTION_PREVIOUS_KEYS_JSON`, and re-wrap records in the background. Nothing
needs to be decrypted and re-encrypted synchronously.

For production, set `ENCRYPTION_PROVIDER=kms` so the KEK never exists in process
memory as raw bytes.

### Operational rules

* Keys come from the environment or a secrets manager. Never from source, never
  from the database.
* Different keys per environment. A staging leak must not affect production.
* Exchange keys should be created trade-only, with withdrawal permission
  disabled and IP-allowlisted to the platform's egress addresses.

## 5. Transport and browser security

| Control | Where |
| --- | --- |
| Helmet security headers | `apps/api/src/main.ts` |
| HSTS, `X-Frame-Options: DENY`, `nosniff` | API + `apps/admin-web/next.config.mjs` |
| Content-Security-Policy with per-request nonce | `apps/admin-web/src/middleware.ts` |
| CORS allowlist | `CORS_ALLOWED_ORIGINS` |
| HTTPS enforced in mobile production builds | `apps/mobile/lib/core/config/app_config.dart` |

### CSRF

The API is token-authenticated and stateless, so it is not inherently
CSRF-exposed. The admin console is, because it keeps its session in cookies. It
therefore uses:

* `SameSite=Strict`, `httpOnly`, `Secure` session cookies.
* A double-submit token: a readable `wlct_csrf` cookie echoed in an
  `x-csrf-token` header, verified on every state-changing route
  (`apps/admin-web/src/app/api/proxy/[...path]/route.ts`).

Tokens are never placed in `localStorage`. An XSS bug in the console cannot
read an `httpOnly` cookie.

## 6. Input validation

* API: `class-validator` with a global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`). Unknown properties are
  rejected, not ignored.
* Shared schemas: `packages/validation`.
* Python services: pydantic v2 models with `extra="forbid"`.
* Admin console: zod on every route-handler body.
* Money is `Decimal` end to end - `Decimal(18,6)` in the database, decimal
  strings on the wire, `Decimal` in Python. Never a float.

## 7. Rate limiting

Two buckets backed by Redis so limits hold across replicas:

* `default` for general traffic.
* `auth` for sign-in, registration, refresh and 2FA - the endpoints an attacker
  hits first.

The tracker keys on `user:{id}` when authenticated and `ip:{tenantId}:{ip}`
otherwise, so one noisy tenant cannot exhaust another's budget. Health endpoints
are exempt.

## 8. Audit logging

`AuditLog` is append-only and tenant-scoped. Every privileged action records the
actor, action, outcome, resource, a before/after diff, the request id, and a
**hashed** client IP - never a raw address.

`SecurityEvent` records authentication anomalies: new device, impossible travel,
token reuse, permission escalation attempts, lockouts.

## 9. Logging hygiene

Never logged, in any service:

* passwords, in any form
* access tokens, refresh tokens, challenge tokens, session cookies
* exchange API keys, secrets or passphrases
* encryption keys, data keys, blind-index keys
* payment credentials
* raw client IP addresses

Enforcement:

| Runtime | Mechanism |
| --- | --- |
| Node | pino redaction paths, extensible via `PINO_REDACT_PATHS`; the recursive `redact()` in `@wlct/utils` (keys AND credential-shaped values AND buffers) gates audit payloads and error bodies |
| Python | `wlct_trading.observability.redaction` - since Part 9, the ONE policy both services' `logging_config.py` filters delegate to (recursive dicts/lists/bytes, exception messages, bounded depth). The old per-service key-only regex filters are gone; a cross-language fixture pins the two languages to identical answers |
| Flutter | `AppLogger.redact`, applied at every nesting depth |

The Flutter mobile client disables network logging entirely outside development,
because a request log there would contain a bearer token on a user's device.

### Telemetry-side rules (Part 9)

Observability is a secret-leak surface like any other, so it inherits the same
policy at its own boundary, enforced by the label policy in
`wlct_trading/observability/labels.py` and mirrored in the API registry:

* **Identifier and secret label names are forbidden outright** (`order_id`,
  `request_id`, `correlation_id`, `tenant_id`, `api_key`, `token`, ...) -
  not discouraged; refused at registration. Label names are additionally
  allow-listed, so inventing a label is a code review event.
* **Label values must be bounded wire tokens**; symbols and other finite sets
  only against declared enumerated domains. Series caps make runaway
  cardinality a counted refusal, not an outage.
* **Health details and incident links are redacted/validated at the boundary**:
  component details pass through the redactor where every publisher shares one
  policy; incident records are (kind, targetId) references only - no payload
  can ride into the operations tables by accident.
* **Correlation ids are UUID-or-mint, everywhere** - the API middleware and
  the Python services both refuse unbounded inbound values, so log fields and
  audit columns cannot be injected through a header.
* **`/metrics` exposure**: unauthenticated only under network isolation;
  `METRICS_TOKEN` (constant-time compared) is mandatory in production, and
  the exposition's production-off posture is a boot error, not a setting:
  `OBSERVABILITY_ENABLED`/`METRICS_ENABLED`/`HEALTH_ENABLED`/
  `PROMETHEUS_ENABLED`/`ALERTING_ENABLED` cannot be false in production.
* **No metric sample is a financial record.** Panels report; the risk gate
  decides; nothing in the trading path imports the observability layer
  (boundary tests enforce the one-way dependency).

### Trace-side rules (Part 10)

W3C trace context is attacker-influenced input - every service treats it that
way, and the rules below are enforced by tests on both sides of the language
line:

* **Inbound `traceparent` is parsed-or-ignored, never trusted.** Malformed,
  version-mismatched, all-zero-id, or over-long headers simply do not join:
  the process starts its own root. A foreign trace id can never group
  spans from two unrelated requests, which is how a correlation surface
  becomes a privacy leak.
* **Trace ids are correlation handles, not credentials, and nothing more
  enters the wire.** Span attributes pass a closed-set sanitizer (`safe
  attribute` in both languages): key allow-regex, sensitive-name refusal
  (`api_key`, `authorization`, `password`, ...), value redaction through the
  same `redaction` policy the loggers use, length caps, and a ban on the
  forbidden label names from the metric policy. Header values that must
  travel (the traceparent itself) are re-canonicalised, never echoed raw.
* **Spans carry no payloads.** The queue hop continues traces through a
  Redis **sidecar** keyed by queue+jobId holding only the 55-char traceparent
  - never inside the job payload - so span-graph joins exist without any
  payload ever being copied into telemetry. Writes are fire-and-forget with a
  TTL; a failed sidecar can neither fail nor alter a publish.
* **Fault injection is a boot-time, non-production, closed-set configuration**
  (`FAILURE_INJECTION_ENABLED`, refused by the env validators of both
  runtimes in production). The only runtime operation anywhere is `consume`
  at instrumented points; there is no arm/disarm route, no admin control, and
  the armed plan is reported read-only. The metrics-scrape fault sits AFTER
  token authentication so injection state is not probeable.
* **The trading path never reads telemetry.** `consumeFault` exists in exactly
  two production files (the tracing service and the scrape endpoint); the
  engine's evaluate router must not contain the tokens `injector`,
  `tracer.`, `should_sample` or `sampler` (statically tested); risk decisions
  are computed before any hub is touched and the except-path records a sample
  then re-raises untouched. Sampling changes only what is RECORDED, never
  what is ANSWERED - an unsampled request still gets its `x-trace-id`.
* **SLO evidence is append-only and pruning is bounded.** `SloConfigurationVersion`
  rows are immutable (the only "update" appends version N+1); evaluations and
  sample buckets expire no faster than 7 days regardless of configuration;
  deleting history is not an API surface on any plane.

## 10. Internal service authentication

The Python services are not public. Every route requires:

| Header | Meaning |
| --- | --- |
| `x-internal-token` | equals `INTERNAL_SERVICE_TOKEN`, minimum 32 chars, compared with `hmac.compare_digest` |
| `x-tenant-id` | the tenant the call acts for; the body must agree or the call is rejected |
| `x-request-id` | optional, propagates the API's correlation id |

Comparison is constant-time. A token that is a known placeholder is rejected at
startup rather than accepted quietly.

## 11. Execution safety

Three independent gates prevent Part 1 from placing an order:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine has no order-placement route.
3. `RiskDecision.wouldExecute = approved AND EXECUTION_ENABLED`.

`EXCHANGE_SANDBOX_MODE=true` additionally disables venues that offer no sandbox.

## 12. Dependency and container posture

* Pinned base images (`node:20.11.0-bookworm-slim`, `python:3.11-slim-bookworm`,
  `postgres:16.4-alpine`, `redis:7.4-alpine`).
* Multi-stage builds; runtime images contain no compiler, no source, no `.env`.
* Every container runs as a non-root user.
* Postgres and Redis publish to `127.0.0.1` only.
* Redis requires a password and uses `volatile-lru`, so queue jobs and sessions
  are never silently evicted.

## 13. Incident response starting points

| Situation | First action |
| --- | --- |
| Suspected token theft | Bump `User.sessionVersion` to invalidate every session for that user |
| Suspected KEK exposure | Rotate `ENCRYPTION_MASTER_KEY_BASE64`, move the old key to `ENCRYPTION_PREVIOUS_KEYS_JSON`, re-wrap in the background |
| Tenant compromise | Set the tenant to `SUSPENDED`; this mass-revokes its sessions |
| Exchange key exposure | Revoke at the exchange first, then delete the record |
| Panel says "healthy" but reality disagrees | Check the publisher mirrors first (`GET /health/components` per service, the fold's `mirrorPresent` in the sync log, and `wlct_registry_series_overflow_total`); absence of alerts means *no publisher reported*, never "all clear" |
| Metrics exposition exposed too widely | Rotate `METRICS_TOKEN`, restrict the listener; the payload itself is label-policy-guarded, so assume no leak of identifiers/secrets until proven otherwise - but treat scraping clients as known callers |

## 14. Worker plane (Part 11)

* The worker (`src/worker.ts`) serves no HTTP at all - not "no public
  routes", no listener exists. Its only egress is one internal service.
* The worker-to-engine secret (`EXECUTION_INTERNAL_TOKEN` /
  `EXECUTION_ENGINE_TOKEN`) is a deployment secret, min 32 chars,
  placeholder-prefixed values refused at both boots, constant-time compared,
  carried ONLY in a header - the engine's client never puts it in a body,
  and its own error surfaces never echo payloads (422 names fields, 500s
  carry correlation ids).
* The execution engine accepts no tenantless command (tenant header
  required), rejects body/header tenant divergence with 403, and its
  simulated answers are labelled as such at every surface.
* `EXECUTION_MODE=live` is refused at the engine's startup by code: the
  queue, the worker, or any API route cannot talk the process into venue
  transmission; the credential provider and the authenticated
  order-placement review remain the open prerequisites (the durable store
  shipped in Part 13 - docs/PART13_DURABLE_STORE.md - and did not change
  this refusal), and the prerequisites are enforced, not configuration.
* The ops view (`GET /v1/observability/worker-coordination`) reads claim
  state written by workers and writes nothing; an expired claim is reported
  as absence, never as a dead worker.

## 15. Known gaps for later parts

* Row-level security: policies and the GUC plumbing ship in Part 11, **dormant
  by design** - enablement is the checklist-gated `apps/api/prisma/rls/enable.sql`
  DBA step, verified by the probes in docs/DR.md; coverage is generated from
  the schema and spec-pinned so no tenant table can silently lack a policy.
* No automated dependency scanning in CI.
* No WAF or bot management in front of the API.
* No hardware-backed key storage; `ENCRYPTION_PROVIDER=kms` is the hook.
* Backups: the contract (manifest, validator, dry-run planner, drill record)
  ships in Part 11; Part 12 adds the freshness ledger (per-component cadence
  or explicit waiver, `--due`'s alertable exit code, `--record` with a
  note-level secret scan that JSON escaping cannot launder) - but the
  *scheduler* that runs them on a timer is still deployment-side wiring, so
  backups today are operator processes against a validated, checkable plan,
  not an unverified cron.
* Worker membership registry (Part 12): the heartbeat zset is
  deployment-scoped state, deliberately NOT tenant-scoped (fleet topology
  is operator-visible by necessity); it carries only worker-id tokens, and
  the registry can never grant authority - claims remain the sole gate, so
  a poisoned or forged membership entry buys an attacker deferral of
  nothing and access to nothing.
* The execution engine's default store is process-local (durability
  `false` is REPORTED, not hidden). The Part 13 durable backend
  (`EXECUTION_STORE_BACKEND=postgres`) persists orders, the event journal
  and the fill ledger in the `engine_*` tables under the same tenant law
  as everything else: every store transaction sets `app.tenant_id` first,
  the tables carry `tenant_id UUID` + the generated row-level-security
  policies, and configuration mismatches (postgres without a DSN, a DSN
  with memory, missing tables) are STARTUP refusals - an engine never
  claims durability it does not have.
* Retention (Part 14) is the only deletion path on the engine plane and
  it is triply narrow: the event journal is the ONLY table any engine
  statement deletes from (a test scans the whole service to hold that
  line - orders, the fill ledger, and the run ledger are not deletable by
  ANY configuration), apply mode is dark until `EXECUTION_RETENTION_ENAB-
  LED=true` restarts the process, and every run - including refused-state
  rehearsals and zero-row runs - leaves a row in `engine_retention_runs`,
  under the same RLS law as its subjects. The route is internal-token and
  tenant-header-matched like the commands, is proxied by nothing public,
  and refuses cross-tenant form by construction (one `--tenant` per call,
  enforced by the same canonical-UUID guard the store writes under).
```


## FILE: docs/ROADMAP.md (215 lines)

*Part 14's delivery-log row and the open-list clarification (journal retention closed; the backlog's time-series metrics item - different table, different part - deliberately still open).*

```markdown
# Roadmap

Part 1 is the foundation. Everything below builds on it in an order chosen so
that each part is shippable, testable and reversible on its own.

The ordering rule: **nothing that touches money ships before the thing that
constrains it.** Risk, limits and audit come before execution; execution comes
before automation.

---

## Part 1 - Foundation (delivered)

Multi-tenancy, identity, RBAC, security, the API skeleton, the admin console
foundation, the mobile foundation, service skeletons, Docker.

Execution is hard-disabled.

---

## Part 2 - Exchange connectivity (non-custodial)

**Goal:** a user can securely attach a real exchange account, and the platform
can read from it. Still no order placement.

* Prisma: `ExchangeAccount`, `ExchangeCredential`, `ExchangeBalanceSnapshot`,
  `ExchangeAccountAudit`.
* Credential intake: submitted once, encrypted with envelope encryption at the
  edge, never returned. A validation call proves the key works and, critically,
  proves that withdrawal permission is **absent** - a key with withdrawal rights
  is rejected outright.
* `trading-engine`: real `ccxt` clients per venue, per-account rate limiting,
  a circuit breaker per venue, clock-skew detection.
* Read-only endpoints: balances, positions, open orders, trade history.
* `market-data`: authenticated feeds, websocket ingestion, the streaming flag
  turned on.
* Mobile and admin: connect-account flow, balance display.

**Ships when:** a real exchange key can be attached, validated and read from,
and the plaintext secret is provably absent from the database, the logs and
every API response.

---

## Part 3 - Trader profiles and strategy definitions

**Goal:** the objects copy-trading will reference, with no copying yet.

* Prisma: `TraderProfile`, `Strategy`, `StrategyVersion`, `PerformanceSnapshot`,
  `TraderFollowerLink`.
* Verified performance only: metrics are computed from executed fills recorded
  by the platform. No self-reported numbers, no backtests presented as results.
* Trader onboarding and approval, with a compliance gate.
* Discovery: search, filter and rank traders.
* Admin: trader approval queue, performance review.
* Mobile: trader list and detail screens.

**Ships when:** a trader can be onboarded and approved, and their performance is
derived exclusively from platform-recorded fills.

---

## Part 4 - The copy engine (paper first)

**Goal:** the full copy pipeline, executing against paper accounts only.

* Prisma: `CopySubscription`, `CopyRule`, `SignalEvent`, `MirrorOrder`,
  `PaperFill`.
* Signal pipeline: detect a leader's fill, translate it through the follower's
  sizing rule, apply risk, place a paper order.
* Sizing modes: fixed notional, proportional to equity, fixed multiplier.
* Risk per follower: max notional, max open positions, max leverage, per-symbol
  allow/deny, daily loss cap.
* Latency budget and slippage accounting, measured and exposed.
* Reconciliation: a periodic job that detects and reports divergence between the
  intended and actual mirrored state.
* `EXECUTION_ENABLED` stays `false`; `paper_trading` stays on.

**Ships when:** a follower's paper account mirrors a leader correctly under
adversarial tests - partial fills, rejects, disconnects, duplicate signals - and
reconciliation reports zero unexplained divergence.

---

## Part 5 - Live execution

**Goal:** real orders, on the user's own exchange account.

This is the highest-risk change in the project and gets treated accordingly.

* Order state machine with idempotency keys; a retried request never
  double-places.
* Exchange error taxonomy: which errors are retryable, which are fatal, which
  require human review.
* Kill switches: platform-wide, per tenant, per trader, per follower.
* Position reconciliation against the exchange as the source of truth.
* Progressive rollout: an allowlist of accounts, then a percentage rollout via
  the existing feature-flag bucketing.
* A dry-run mode that logs the exact payload that *would* be sent.

**Ships when:** a full audit trail exists for every order, every kill switch is
verified under load, and reconciliation has run clean for a sustained period on
the allowlist cohort.

---

## Part 6 - Billing and monetisation

* Payment provider integration (Stripe first). The platform stores no card data;
  it holds provider references only.
* Performance fees: high-water mark accounting, crystallisation periods,
  trader revenue share.
* Invoices, dunning, and a subscription lifecycle driven by provider webhooks
  with signature verification and replay protection.
* Payout ledger for trader earnings.

Money movement is double-entry from day one. A single-entry ledger is not
auditable and cannot be reconciled.

---

## Part 7 - Compliance and operations

* KYC/AML provider integration behind the existing `KycProfile` model.
* Jurisdiction rules: which tenants may onboard users from where.
* Suitability and risk questionnaires; risk-profile gating on copy limits.
* Data subject rights: export and erasure, honouring audit-retention duties.
* Regulatory reporting exports.
* SIEM export for the security event stream.

---

## Part 8 - Scale and reliability

* Read replicas and query routing.
* Time-series storage for market data and performance history.
* Horizontal scaling of the copy engine with partitioned work and leader
  election.
* Row-level security in Postgres as defence in depth behind the application-layer
  tenant scoping.
* Full observability: OpenTelemetry traces, RED metrics per endpoint,
  service-level objectives with alerting.
* Chaos testing: exchange outage, Redis failover, database failover.
* Disaster recovery with a rehearsed, timed restore.

---

## Cross-cutting work, continuous

| Track | Detail |
| --- | --- |
| Testing | unit, integration against a real Postgres, contract tests between the API and the Python services, load tests on the copy path |
| Security | dependency scanning in CI, an external penetration test before Part 5, secret-rotation drills |
| Documentation | an ADR for every consequential decision; an operational runbook per service |
| Accessibility | WCAG 2.1 AA on the admin console; screen-reader support in the mobile client |

## Sequencing constraints

These cannot be reordered:

1. **Part 2 before Part 4.** No copying without a validated exchange connection.
2. **Part 4 before Part 5.** Paper trading is how the pipeline earns the right
   to touch real money.
3. **Risk limits before execution.** The constraint ships before the capability.
4. **Audit before money.** Every financial action must be reconstructable from
   the audit trail on the day the feature launches, not retrofitted afterwards.

---

## Delivery log (as of Part 9)

The delivered parts renumbered relative to this early roadmap (which described
a backlog, not a sequence contract). What has shipped, with its authoritative
document:

| Part | Delivered | Document |
| --- | --- | --- |
| 1 | Platform foundation: multi-tenancy, auth/RBAC, audit, API + admin console + mobile skeletons, the pre-trade risk engine skeleton, connectivity transport | docs/PART1_*.md |
| 2 | Trading core library: order book, market data pipeline, clock/latency discipline | docs/PART2_*.md |
| 3 | Billing, notifications, feature flags, security-event pipeline | docs/PART3_*.md |
| 4 | Execution engine and exchange adapters (authenticated REST/WS, paper-first) | docs/PART4_*.md |
| 5 | Live execution control plane: credentials, kill switches, reconciliation, execution incidents | docs/PART5_*.md |
| 6 | Strategy layer: definitions, instances, backtest and paper sessions, metrics | docs/PART6_*.md |
| 7 | Historical datasets: ingestion, manifests, validation, storage, replay | docs/PART7_*.md |
| 8 | Real-time risk engine: the authoritative fail-closed gate, 22-rule catalog, snapshots, reservations, rate windows, switch lifecycle, risk console (+ read-only mobile viewer) | docs/PART8_RISK.md |
| 9 | Observability & operations: Prometheus exposition (both languages, cardinality-lawed), health/readiness/trading-readiness, alert fold with durable dedupe, incident correlation, shared redaction, queue observability, operations console | docs/PART9_OBSERVABILITY.md |
| 10 | Reliability: OTLP tracing (both planes, sampled, redaction-bound, honest export accounting), SLO/error-budget evaluator with burn alerts, queue-depth law, fault injection (non-prod, self-disabling), production config guards | docs/PART10_RELIABILITY.md |
| 11 | Scale & coordination: cross-language lease/partition foundation (fixture-pinned), the trading-worker plane (partitioned TRADE_EXECUTION consumer with deferral accounting and a strict engine failure taxonomy), services/execution-engine hosting the real core ExecutionEngine (simulated; live refuses by code), read-replica fail-closed routing policy, read-only worker ops view, generated + spec-pinned row-level security (dormant until the checklist-gated enablement), DR manifest with validator and timed-drill contract | docs/PART11_WORKER_SCALING.md, docs/DR.md |
| 12 | Self-registering worker membership (heartbeat-zset registry, fixture-pinned staleness law, config list demoted to fallback, resign-on-shutdown fast path, registry read in the ops view) and the DR backup-freshness ledger (manifest cadences or explicit waivers, --due grading with a cron-able exit code, --record with secret-scan and parse-refusal) | docs/PART12_WORKER_MEMBERSHIP.md, docs/DR.md |
| 13 | Durable execution-engine store: PostgresOrderStore over the core OrderStore port (orders/events/fills/reconciliation state), engine_* tables in Prisma with automatic RLS coverage and per-transaction tenant GUC, opt-in EXECUTION_STORE_BACKEND with no silent fallback either direction, and the worker ack-policy re-review that turned the durable-engine tripwire into a coherence check | docs/PART13_DURABLE_STORE.md |
| 14 | Journal retention: the core's pure retention law (terminal_at-not-status, whole-story-or-none, nonsense-proof policy), the engine executor over the store's own transaction contract (one deletable table, seq-listed batches, ceiling-then-resume), the never-pruned `engine_retention_runs` ledger with dry-runs recorded, apply dark behind config, and the cron-able tenant-per-call CLI with exit-code law | docs/PART14_RETENTION.md |

Still open from the original backlog, deliberately NOT absorbed: time-series
storage behind the exposition (metrics are published, not retained; retention
beyond the durable alert/incident state remains future work - Part 14 closed
the EXECUTION STORE's journal retention, docs/PART14_RETENTION.md, which is
a different table and a different problem, and this item's wording is kept
deliberately so the two are never conflated), RED dashboards
beyond the built-in panel, disaster-recovery rehearsals, and the remaining
Part 8-scale items - enabling the shipped row-level-security policies in
staging per the enable.sql checklist (the Part 13 engine tables are
covered by the same generated machinery, so enabling remains one checklist
for every tenant table), and the full
chaos/failover matrix against real infrastructure (the invariants are
unit-pinned; a staging run remains a deployment step, see
docs/PART11_WORKER_SCALING.md sec. 18). Part 12 retired two items from this
list: worker membership is now self-registering (WORKER_MEMBERSHIP_MODE,
docs/PART12_WORKER_MEMBERSHIP.md) and backup cadence has its checking
mechanism (`dr-manifest.mjs --due`, exit-code alertable); Part 13 retired
the durable execution-engine store wiring (docs/PART13_DURABLE_STORE.md -
the store ships, the schema is Prisma-owned, and the worker gate's
ack-policy condition is resolved). What remains of
the backup item is deployment-side WIRING of that command into a scheduler
- the ledger refuses to fake its own seed data, so the first real
`--record` is the first real backup evidence.
```

