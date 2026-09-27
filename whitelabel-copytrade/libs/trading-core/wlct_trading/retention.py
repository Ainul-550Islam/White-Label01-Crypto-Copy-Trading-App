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
