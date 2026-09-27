# Part 17 — durable incident recording: the sink that outlives the process

> **What this part is.** The execution engine has, since Part 5, described its
> incident records as "deliberately rare and deliberately durable" while the only
> implementation in the repository was `InMemoryIncidentRecorder`. On a deployment
> running Part 13's Postgres store that meant an order survived a restart and the
> incident explaining the order did not. This part ships the durable sink, the
> composition law that refuses the mismatch, one read-only internal route, and the
> schema the audit can see. **What it is not:** a new capability. No order path
> changed, `EXECUTION_MODE=live` is still refused at startup, and nothing here can
> place, cancel or amend anything.

## 1. The gap, with the evidence

Three places in the repository named this before it was built:

* `libs/trading-core/wlct_trading/execution/incidents.py` — the module docstring:
  "Incidents are deliberately rare and deliberately durable". The only class
  implementing the port was in-memory.
* `services/execution-engine/app/composition.py` — `EngineRuntime.incidents` was
  typed as `InMemoryIncidentRecorder`, not as the `IncidentRecorder` port, and the
  line building it ran after the durable store had already been chosen. The type
  said what the code did, which is how the mismatch became invisible.
* `docs/PART5_EXECUTION.md` — "SQL implementations of the `OrderStore`,
  `IncidentRecorder` and `LockManager` ports": the first arrived with Part 13, the
  third is satisfied by the Redis manager in the core, and the second is this part.

The failure mode is not hypothetical. Part 16's blocked placement review records a
`SAFETY_GATE_BLOCK` incident, and `ExecutionIncident` carries the scrubbed details
that say *which* gate and *why*. Those are exactly the rows an operator consults
after an incident, which is after a restart, which is precisely when a
process-memory list is empty.

## 2. The table, and why it is not `execution_incidents`

`engine_incidents` (`apps/api/prisma/schema.prisma` → `ExecutionEngineIncident`,
DDL owned by `apps/api/prisma/migrations/20260915120000_part17_durable_incidents/`).

There is already an incident table: `execution_incidents`, which backs the API's
console projection. Writing to it from the engine was the first design and it is
the wrong one, for three reasons that are all the same reason:

* its `accountId`/`orderId` are uuid foreign keys into the **API's** aggregates,
  and the engine's order ids live in `engine_orders`, not in `orders`;
* its vocabularies are Postgres enums, and the engine's law (set in Part 13 for
  the same reason) is VARCHAR columns validated by the codec, so a taxonomy that
  grows does not need a migration;
* its timestamps are `timestamptz` while the engine's clock law is epoch
  microseconds.

So this is the Part 13 arrangement repeated: the engine plane owns
`engine_*` tables, the API reads and projects them through its mapper. Two tables
answering to one mapper is architecture; one table answering to two clocks is a
data-integrity incident waiting for a daylight-saving week.

Shape decisions inside the table, each inherited rather than invented:
`seq BIGSERIAL` primary key so "newest first" is decidable when one failed command
emits two incidents in the same microsecond; `incident_id` unique because a
replayed write must be a refusal rather than a second row in an audit trail; no
composite foreign key to `engine_orders`, because an incident often has no order
and a `MATCH SIMPLE` composite key with a nullable column is a constraint that
never fires while reading like a guarantee; the tenant FK `RESTRICT`s, so
deleting a tenant cannot take its failure history with it.

## 3. The sink, and the asymmetry between writing and reading

`services/execution-engine/app/incidents_sql.py` → `PostgresIncidentRecorder`.

**Writes never raise.** The port's law, restated in the module because it is the
kind of sentence an implementer optimises away: losing an incident is bad, stopping
order flow because logging failed is worse. A failed insert is counted
(`stats.failedWrites`) and logged with the incident's own identity, and the
`test_a_failing_write_never_reaches_the_caller_and_is_counted` case pins that the
failure rides the `INSERT` and not the tenant `SET` before it — a sink that
swallowed every exception would also swallow "the table does not exist", and those
two need different answers from a human.

**Reads always raise.** `list_open` wraps any failure in `IncidentReadError` whose
message says why: an empty list is the most convincing wrong answer available,
because "no open incidents" is what a healthy system looks like.

**Every statement runs inside a transaction whose first act is the tenant GUC**,
using `store_sql`'s own `SET_TENANT_SQL` constant rather than a second copy of the
sentence, so there is one spelling of that law in the service. The read path sets
it too, even though its `WHERE` clause already filters by tenant: under a role with
`BYPASSRLS` the predicate is the only thing between one tenant's failures and
another's, and this service does not decide which of the two layers is load-bearing
— it requires both.

**Insert-only.** `ExecutionIncident` is immutable and `resolve()` returns a copy,
so there is no `UPDATE` statement in this file at all. `resolved` and
`resolution_note` are written once. That is the core's law ("the trail cannot be
rewritten after the fact") expressed as the absence of a code path, which is the
only kind of absence that survives a refactor.

## 4. The pairing law, in both directions

`build_runtime(settings, store=..., incidents=...)` now refuses two wirings:

* a durable store with the in-memory sink — the state this part exists to remove;
* a durable sink with the in-memory store — the mirror, refused for the same
  reason it refuses a Postgres-backed config over a memory store: "the config and
  the wiring disagree", and guessing which half was meant is how a deployment ends
  up with an assurance nobody asked for.

`EngineRuntime.incidents` is typed as the port now. The memory sink still has no
`is_durable` attribute, and composition reads it with a default of `False` —
"unproven durable", the same fail-closed convention the engine's own store check
uses. A flag defaulting to `True` would be the loudest possible way to lie about
keeping records.

`app.main` builds the sink over the **same pool** the store came from, after
`open_durable_store` has verified the tables, because "we have a durable plane" is
decided in one place. The verification list (`pg_store.DURABLE_TABLES`) now includes
the incident table, so a deployment whose migration has not been applied refuses to
start rather than discovering it at the first failure — and
`test_part13_pg_store` names the four tables one by one rather than deriving them
from that constant, so a table quietly leaving the startup check fails there.

## 5. One route: `POST /internal/v1/incidents/list`

Internal plane only — same token, same `require_tenant_match`, absent from the
worker client's forwarding path list (a test reads the TypeScript file to hold
that). A read is expressed as a POST with a body because that is how this service
already asks a tenant-scoped question (`retention/inspect`, `enablement/audit`),
and a query string would have made the tenant a client-chosen default.

* `200` with `source`, `durable`, `limit`, `returned`, `incidents[]`.
* `503 INCIDENT_STORE_UNREADABLE` when the sink cannot answer — never a 200 with
  an empty list.
* `409 INCIDENT_SINK_UNWIRED` if a runtime ever has no sink at all. Unreachable
  today (composition always provides one) and kept because the day it is reachable
  is the day somebody needs to see exactly this rather than an empty array.
* `422` from the request model for a limit outside 1..1000. The bound is the
  store's, not the caller's: this reads an append-only table that nothing prunes.

The `accountId` filter runs in the route, after the tenant-scoped select — not
inside the `WHERE`. Scoping is the RLS layer's job and must not be diluted by a
convenience parameter becoming part of the predicate; the test asserts the shape of
the emitted statement to keep that true.

No `resolve` verb exists. An endpoint that flipped `resolved` would be the first
mutable field in an audit trail, and the core's law is that closing an incident
means recording a new one.

## 6. `/status`, and the field that keeps them honest

`StatusResponse` gained a typed `IncidentSinkView` (`sink`, `durable`, `stats`),
mapped in `app/routers/internal.py` exactly like Part 16's placement block, so the
drift test added there (`everything_described_is_published_and_nothing_else`) now
covers this field too: a key added to `describe()` without a decision here fails in
CI instead of being silently unpublished on one surface and visible on another.

`stats` is always a mapping, empty when the sink keeps no accounting. Omitting the
key for the in-memory sink was the first draft, and it broke the parity between
`describe()` and the response body — which is the pair the whole Part 16 view
exists to keep equal. One place, one meaning: `incidents is null` means "an engine
too old to answer"; `stats: {}` means "this sink has nothing to report".

## 7. The audit sees it: 42 covered tables becomes 43

`engine_incidents` has a non-nullable `tenantId @db.Uuid`, so the Part 11 generator
derives it into the tenant-scoped set with no hand-edit:

* `python3 scripts/gen_part11_rls.py` regenerated the policy migration,
  `enable.sql`, `disable.sql` and `rls_coverage.json` — 43 covered tables, 7
  excluded, all four artefacts in lockstep.
* `app/rls_probe.py`'s `PROBE_TABLES` gained the table, so the enablement audit
  verifies it: `probed` is 5, and `test_part15_enablement` asserts that number
  literally, because an audit that quietly shrinks while its report still says
  "engine plane" is the failure mode the whole Part 15 mechanism exists to catch.
* `docs/dr/manifest.json`'s `rlsEvidence.scope` names all five tables. The scope
  sentence and the probe list are pinned against each other in
  `test_part15_drift_parity`, in both directions: the manifest may not claim more
  than the executor can see, and the executor may not grow while the manifest still
  says "engine plane only".
* The count in `test_enable_and_disable_are_an_exact_pair` is pinned as
  `42 + 1` rather than written as `43`, because the `+ 1` is the sentence "this
  part added one table" and a bare number erases who did it.

## 8. What this part did not unlock

* **Live mode is still refused**, with the same startup sentence from Part 16. This
  part touches no transmission path: the engine's incident calls were already
  there; only what happens to their result changed.
* **No retention.** `PRUNABLE_TABLE` is still `engine_order_events` and a test in
  this part asserts it. The incident records are the reason a prune is auditable,
  so they are not a pruning candidate; making them one is a decision, not an edit.
* **No API projection yet.** `execution_incidents` (the console's table) is not fed
  from `engine_incidents`. That sync is a data-flow design of the API plane —
  which incidents the console shows, how dedupe and paging interact with
  `notifiedAt`, whether the engine's `orderId` maps to an API order at all — and
  inventing it here would put an unasked question into a migration. What exists now
  is the durable record and the engine's own read route, which is the half that was
  missing.
* **No admin-web screen.** `apps/admin-web` has no test suite at all (measured in
  the census: 5,496 lines of React, 0 of tests); adding a screen there is a piece
  of work of its own, not a checkbox here.

## 9. Deliberate omissions

* No `UPDATE`, no `resolve` endpoint, no bulk import of historical incidents.
* No second implementation of the recorder for the sibling services —
  `services/trading-engine` and `services/market-data` do not use
  `IncidentRecorder`, and this part does not create a reason for them to.
* No Postgres enums, no `timestamptz`, no `CHECK` constraints on the vocabularies:
  the codec validates them and Part 13 already argued why the database must not.
* No `engine_incidents` row for a failed *incident write*. A sink that records an
  incident about its own inability to record incidents needs a table that can
  always accept a row, which is a different design problem; here the counter and
  the ERROR log line are the answer, and `stats.failedWrites` is published so the
  number is at least visible.

## 10. Verification

```sh
# service (the part's own suite first, then the whole thing)
cd services/execution-engine
python3 -m ruff check app/ tests/
python3 -m mypy app/
python3 -m pytest -q tests/test_part17_incidents.py
python3 -m pytest -q

# core (untouched by this part, re-run because the pairing law reads its port)
cd libs/trading-core && python3 -m pytest -q && python3 -m ruff check wlct_trading tests

# schema and RLS artefacts
cd apps/api && npx prisma validate && npx prisma generate && npx jest -t 'rls-coverage'
python3 scripts/gen_part11_rls.py   # regenerates cleanly and idempotently
node --test scripts/ && node scripts/dr-manifest.mjs --check
```

Expected at the time of writing: service `273 passed, 12 skipped` (the skips are
the live-Postgres suites of Parts 13/14, unchanged in kind — this part ships no
live test because a real database is not what its laws turn on), ruff clean, mypy
clean over 21 source files; `tests/test_part17_incidents.py` is 37 of those 273.
Core `1559 passed`, ruff clean, mypy clean over 148 files. `npx prisma validate`
valid, `prisma generate` clean, `apps/api` `386 passed / 17 suites` with `tsc` and
`eslint` clean, `apps/admin-web` `tsc` clean, `node --test scripts/` `52/0`,
`dr-manifest.mjs --check` valid (5 components), `--check-rls` exit 1 — the shipped
posture: no audit recorded, no simulated pass.

`docs/PART17_HANDOVER_FULL_SOURCE.md` regenerates from
`scripts/gen_part17_handover.py` and embeds every line of every file this part added
or changed; `--check` re-runs the gates and compares. Its ledger reports a
`+158`-line delta across the 22 modified files rather than the `+363` an earlier run
showed, and the reason is worth knowing before anyone reads a smaller number as less
work: Part 16's document lists nine of the same files, and once that ancestor is
regenerated (its own rule requires it to carry current content), Part 17's baseline
already contains Part 17's edits. The coupling is stated in the header, not hidden by
freezing a stale ancestor document at a flattering size.

The same rule has a consequence worth saying before anyone runs the checks in a
different order: `--check` on Part 16 can go stale from an edit that touches no file
Part 16 lists, because its tree figures are counts of the whole repository taken at
its generation time. Editing this document moves Part 16's total by a line or two and
makes a byte-comparison fail, correctly - the document says it measured the tree, and
the tree moved. The remedy is the one the header names: regenerate, do not unfreeze.
So the order that leaves both checks green is Part 17 first, then Part 16, and any
later part that edits the tree inherits the same sequence.

*Corrected by Part 18, on measurement rather than on argument (2026-09-17): that
last sentence is wrong, and it is wrong in the direction that wastes an operator's
time.* Part 18 ran the sweep as written - newest first, Part 17 then Part 16 then
Part 18 - and Part 17's own `--check` came back NOT byte-identical afterwards: its
ledger delta is read out of Part 16's document, so regenerating the ancestor LAST
invalidates the middle child, and the middle child was the one the sentence told us
to write first. The order that converges in one sweep is ancestor first: Part 16,
then Part 17, then Part 18 - after which all three `--check` runs report
byte-identical, measured on the same build. Nothing about the coupling changed;
only the direction of travel does, and the reason it looks like "newest first" from
two documents is that with two, either order converges once the ancestor has already
absorbed the descendant's content. With three, it does not.
