# Part 15 - RLS enablement is now a verifiable operation (read-only)

Part 11 shipped row-level security as an *artefact set*: a migration that
defines the function and 42 policies (43 since Part 17's `engine_incidents`), a generator, `enable.sql` with a
five-item pre-flight checklist, `disable.sql` as its inverse, and a coverage
manifest. It also shipped the honest comment above all of that - "dormant
until the checklist-gated enablement". Fourteen parts later the platform
could describe its defences in exact detail and had no way to ANSWER whether
one of them was switched on. Every tool in the repository had to trust the
deployment; the only evidence that RLS existed was a file that says somebody
ran a file.

Part 15 closes that gap the only way a gap in *knowledge* closes: a
verification with a grade, a record, and a freshness policy. It changes
nothing. There is no migration, no new table, no DELETE statement anywhere in
this part, and no code path here that can flip `ENABLE ROW LEVEL SECURITY`.
The verb is "look, count, report", and the reason the verb is safe is exactly
the reason the answer is now trustworthy: it can be run on a live staging
database, by an operator who has no business running DDL, on a Tuesday,
without a change window.

Concretely, five things ship:

1. `libs/trading-core/wlct_trading/enablement.py` - the enablement LAW, pure
   and dependency-free: what a probe must look like to count, which tables may
   legitimately answer a bare read, when a run is `UNVERIFIED` rather than
   green, and what nonsense cannot be a policy at all.
2. `services/execution-engine/app/rls_probe.py` - that law's only executor
   against Postgres: six statements, every one a read, and one design fact
   (the leak probe runs OUTSIDE the tenant transaction) that the whole
   exercise turns on.
3. `POST /internal/v1/enablement/audit` - the internal-plane endpoint that
   runs it, grades it, and answers 200 even when the grade is FAIL.
4. `scripts/rls-enablement.mjs` - the operator's entry point (`audit`,
   `check`, `print-sql`), which never touches a database, plus
   `scripts/dr-manifest.mjs --check-rls / --record-rls` and the
   `docs/dr/rls-evidence.jsonl` ledger.
5. The evidence freshness contract, in `docs/dr/manifest.json` under
   `rlsEvidence`: a weekly re-audit, a one-month window on this service's
   side, and a rule that a recorded FAIL is not a stale PASS.

The rest of this document is the reasoning behind those five, the exact
promises the code makes, and the runbook that turns "we believe RLS is on"
into "here is the audit, its age, and its verdict".


## 1. What was shipped, what was believed, and the gap between

`enable.sql` asks a human five questions before running it: does every write
path use `withTenantRls`; does the deployment role have neither `BYPASSRLS`
nor superuser; are the excluded (platform-scoped) tables confirmed
unaffected; has rollback been rehearsed; is traffic low. Four of those five
are deployment conditions, and a checklist answers them once, at the moment
of maximum attention. Then the platform goes on running for a year, during
which:

* a new tenant-bearing table is added and the RLS generator is not re-run
  (Part 13's `engine_*` tables are exactly this case, and Part 14's ledger
  is exactly that follow-up);
* a role is granted something "temporarily, for the migration";
* a `FORCE` line is lost when a table is recreated by a hand-written
  migration;
* the policies are on and a code path that never sets the GUC starts
  returning zero rows and gets reported as "no orders today".

None of those are detectable by reading the repository. All of them are
detectable, cheaply, by asking the database three questions per table: does
a policy exist, is RLS enabled and forced, and does a read with the tenant
bound see a different number of rows than a read without it. That is the
whole probe. Everything else in Part 15 is the discipline of turning three
questions into an answer nobody can shade.

Why not a migration that verifies at boot? Because a boot check on the engine
either refuses to start (a defence layer's staleness becomes an outage, which
is the exact trade Part 11 refused to make in reverse) or warns (which is
today's checklist with extra steps). Verification is an OPERATION with a
cadence, not a startup condition with a kill switch. That decision is
§11's first entry and it is the part of this design most likely to be
"improved" later, so it is written down rather than implied.


## 2. The law (core), before any SQL existed

`wlct_trading/enablement.py` grades results handed to it by an executor. It
imports no clock, no driver and no filesystem - a structural fact pinned by
an AST test, because an enablement report whose freshness is decided by the
library's own wall clock is not reproducible, and "no write verb in the law"
is not a comment, it is a scan (`tests/test_part15_enablement.py::TestModulePurity`).

Its vocabulary is closed and deliberately asymmetric:

| a probe's grade | meaning |
| --- | --- |
| `pass` | policy exists, RLS enabled AND forced, the scoped count equals the seeded expectation, and (for tenant tables) the bare count is 0 |
| `fail` | any of the above is not true, or the table is absent from the database while present in the coverage manifest |
| `skipped` | the caller declined to probe it, with a reason |

| a run's grade | meaning |
| --- | --- |
| `pass` | every probe passed, nothing skipped, count matches what was asked to cover, and the role can neither bypass nor outrank the policies |
| `fail` | any probe failed, **or** the role has `rolbypassrls`/`rolsuper` |
| `unverified` | nothing was probed, something was skipped, or the probed set does not match the expected coverage count |

Four laws in that table are load-bearing and each has its own test:

* **Absence outranks everything.** A table in `rls_coverage.json` that
  `to_regclass` cannot resolve is a coverage LIE, not a table with RLS off.
  Grading it `enabled=false` understates the finding; the law grades it
  `fail` before looking at any other field.
* **The role veto precedes the counts.** `rolbypassrls` or `rolsuper` makes
  every other number meaningless, so the run fails even when all four probes
  read "isolated". This is checklist item 2 in executable form, and it exists
  because a bypassing role is precisely the failure a "green" report would
  otherwise launder. There is no `pass-with-warning` spelling here on
  purpose: "bypassing but tidy" is not a posture this platform records.
* **`unverified` is not "failed politely".** It is a distinct third answer,
  produced by a run that checked nothing, or skipped a table it was asked to
  cover, or covered fewer tables than the manifest claims. `grade_run` puts
  the reason in `summary["veto"]` so the report says WHY it refuses to be
  green; a dashboard that renders `unverified` as a shade of success is a
  bug in the dashboard, and this module is what gives that test something to
  assert.
* **The exception is a list, not a shrug.** The "bare read must be zero" rule
  is a TENANT-table rule. The seven platform-scoped tables (nullable
  `tenantId`: `audit_logs`, `kill_switches`, `ops_alerts`, `ops_incidents`,
  `roles`, `security_events`, `subscription_plans`) may answer a bare read
  with rows correctly - failing them would nag on a healthy deployment, and
  nagging is how checklists get switched off. `PLATFORM_SCOPED_TABLES` mirrors
  the manifest's exclusion set, and a core test re-derives it from
  `apps/api/prisma/rls/rls_coverage.json` so the mirror cannot silently drift
  in the core's own suite.

Nonsense cannot be constructed: `max_evidence_age_days` must be a plain int
1..36,500 (0 would flood the ledger, a century means "forever fresh");
negative row counts, `True` where an int is claimed, a probe list containing
the same table twice ("a repeated probe is not redundancy, it is one table
left unchecked"), and a covered-table count outside 0..4,096 are all
refusals. `EnablementPolicy.evidence_is_fresh` takes both timestamps as
arguments and treats a run dated in the FUTURE as not fresh - the safe answer
to an unverifiable clock is "go run the audit again", never "credit it".


## 3. The probe, and the one fact it turns on

`app/rls_probe.py` holds six statements. All of them are `SELECT`s plus one
`SET TRANSACTION READ ONLY`, and a test derives the list from the shipped
file's own syntax tree rather than from a list of constants somebody could
forget to extend.

The interesting part is not the statements, it is where they run.

**Inside one `_TenantTransaction`** (Part 13's rhythm: acquire, begin,
`set_config('app.tenant_id', $1, true)`, work, commit) the audit reads
`pg_roles`, `to_regclass`, `pg_class` and `pg_policies`, and counts the
tenant's own rows. The read-only flag is the module's FIRST statement inside
that transaction - legal only before the transaction touches data, which is
why it leads, and pinned as text by `test_transaction_is_forced_read_only_first`.

**On a separate acquisition, with no transaction and no GUC**, it runs the
bare count. This is the whole audit:

> `set_config(..., is_local => true)` dies with its transaction. A connection
> borrowed outside one therefore has no `app.tenant_id`, which is the only
> condition under which "count this table with no tenant predicate" means
> anything.

If both counts ran inside the same transaction, the bare count would be the
scoped count by construction, every table would report `0` leaked rows, and
the audit would be structurally incapable of finding the thing it exists to
find. That sentence is why this part has a test file before it has a route:
`test_a_healthy_database_passes_and_reads_the_way_it_must` asserts the bare
connection made ZERO `set_config` calls, opened NO transaction, and saw
exactly the number of pool acquisitions the design allows (two: the
transaction, and one bare session serving all tables - a per-table borrow
would be a different shape and the fake's `acquires` counter catches it).

There is nothing to "clear" on the bare session. The platform has no
cross-tenant GUC: the `set_config` call is transaction-local by Part 11's
contract, and the docs list a platform-role session concept as future work,
not a variable to reset. An earlier draft of this module cleared a
hypothetical `app.cross_tenant_seed`; that was removed on the ground that a
verification tool must not contain SQL for a mechanism that does not exist,
because it reads as coverage while testing nothing. The only thing that can
defeat a bare read here is a role privilege, and that is what the veto in §2
handles.

Two smaller decisions worth their weight:

* **Nothing is seeded, so nothing must be cleaned up.** The textbook RLS
  probe inserts two tenant-A rows, reads them from a tenant-B session, then
  deletes them. Part 15 ships a tool whose entire claim is "read-only", so it
  does not get to insert. Seed expectations are INPUTS: the operator (or the
  staging script) says "this probe tenant should see 3 rows in each table" and
  the executor checks scoped == that number. Unknown seed is the honest
  default, and it degrades to a weaker-but-real test rather than to a skip:
  the catalogue posture (`policy_exists`, `relrowsecurity`,
  `relforcerowsecurity`) carries the finding and the counts cross-check each
  other. A probe with 0 seeded rows and 0 bare rows is a PASS, not a no-op:
  an empty tenant still proves the predicate is being applied.
* **A refused bare read is the best answer a tenant table can give.** If
  Postgres rejects the unfiltered count with SQLSTATE `42501`
  (insufficient privilege - what `FORCE` plus a SELECT-scoped policy looks
  like for a role with no bypass), the executor records "zero rows reached"
  and the grade stands. Any OTHER failure of that read - connection drop,
  timeout, cancellation - PROPAGATES and the run records nothing. The
  distinction is deliberate and narrow (the swallow is keyed on the SQLSTATE,
  duck-typed so this module never imports the driver's exception hierarchy):
  grading a broken cluster as isolated is the one way this audit could bless
  a failure, so it is refused rather than handled.
* **A probe table list is a constant, not a parameter.** `PROBE_TABLES` names
  the three durable engine tables plus its ledger; a request body may supply
  a seed count for a table outside it and is refused (`ProbeUnknownTable`,
  HTTP 400) before a connection is borrowed. The name reaches `{table}`
  interpolation, so this is the one place a caller could smuggle text into a
  statement, and an allow-list checked against the module's own constant is
  the cheap answer. `coveredExpected` and `seedCounts` are validated before
  the database is touched, and `strict=True` on the seed values is load
  bearing: pydantic's non-strict coercion accepts `"3"`, and - worse -
  `true` as `1`, which would hand the audit a seed nobody wrote.


## 4. The wire surface: one route, three refusals, one non-refusal

`POST /internal/v1/enablement/audit` sits on the internal plane beside
Part 14's retention routes: same token, same tenant-header match, proxied by
nothing public, and absent from the API's worker-forwarding path list (pinned
by `test_the_forwarding_surface_never_reaches_it`: that list IS the public
plane's reach, and an audit is not a job a scheduler should be able to
enqueue).

There is **no apply switch**, deliberately. Part 14 needs
`EXECUTION_RETENTION_ENABLED` because a DELETE needs two yeses; wrapping a
SELECT in a feature flag would be theatre that still has to be documented,
tested and defaulted. What the config DOES carry is the evidence window,
`EXECUTION_ENABLEMENT_MAX_AGE_DAYS` (default 30), whose bounds exist once in
the core and are validated at boot - a typo in a freshness window is exactly
the class of bug that quietly makes an audit useless ("every result is
fresh"), so it refuses startup instead of defaulting.

Three refusals, each saying something rather than erroring:

| answer | when | why that shape |
| --- | --- | --- |
| `409 RETENTION_NO_DURABLE_STORE` | memory-backend runtime | there is no Postgres here: no roles, no policies, nothing to verify. Answering "PASS, 4 tables isolated" would be the single most misleading success on this platform. (Same code as Part 14 on purpose - it means "this maintenance surface needs the durable plane", one fact, one name.) |
| `400 ENABLEMENT_REQUEST_REFUSED` | a seed table outside the allow-list, or a coverage number the core refuses | the request body is not where an audit's scope is decided |
| `503 ENABLEMENT_ROLE_UNKNOWN` | `pg_roles` has no row for the connected role | an audit that cannot read the bypass flag is not an audit; refusing beats assuming "no bypass". The message names the grant that fixes it (`grant.sql`, Part 11) |

And one deliberate **non**-refusal, the most important status-code decision
on the surface: **a FAIL grade is a 200**. The audit ran; its answer is the
finding. Returning 500 would bury the evidence under a transport error, break
`curl`-based CI that reads the body, and - the real risk - tempt somebody to
make the probe "tolerant". 5xx here means "no evidence at all", which is a
different fact with a different remedy, and the two must not share a code.

The response body states its own limits, in two booleans rather than one:

```
grade: pass | fail | unverified
fullPlatform: false            # 5 tables is not the manifest's 43
enginePlaneComplete: true      # everything THIS service can see was read
```

One field cannot honestly say both, and a single `partial: true` would leave a
dashboard free to render the headline green without explaining it. The
per-table list carries the raw counts (`scopedRows`, `bareRows`,
`seededExpectedRows`) alongside the flags, because a report that says "true"
has to be trusted and a report that says "3 / 0 / 3" can be re-audited by a
second operator. The per-table grade in the body is re-derived by the core law
inside the same request - there is no second formatter of this report
anywhere, because two spellings of a grading rule are one careless edit from
disagreeing.

`/internal/v1/status` gained `enablementMaxAgeDays`, and the worker's
compatibility assertion does NOT check it: like the retention knobs, it is
posture for an operator to read, not a condition for a job to be forwarded,
and widening the compatibility law is a change with a blast radius this part
does not need.


## 5. The CLI: `scripts/rls-enablement.mjs`, and why it holds no credentials

```
node scripts/rls-enablement.mjs audit  [--base-url URL] [--token TOK] --tenant UUID
                                       [--seed TABLE=N,...] [--covered-expected N]
                                       [--record] [--json]
node scripts/rls-enablement.mjs check  [--now ISO] [--ledger PATH]
node scripts/rls-enablement.mjs print-sql
```

`audit` calls the endpoint (via `curl`, so the helper has no HTTP stack of its
own and no dependency) and exits 0 on `pass`, 1 on `fail`, 2 on `unverified`
or a transport refusal - the same three-way exit law the platform's other
operator CLIs use, so CI can distinguish "not isolated" from "we do not know".
There are no defaults for `--base-url`, `--token` or `--tenant`: a helper that
guesses an internal endpoint can audit the wrong cluster and report a confident
PASS about it, which is worse than not auditing.

**This script never connects to a database.** That is not a limitation to
apologise for, it is the reason its output can be trusted: a tool that
"audits security" while holding the database password can manufacture the
finding as easily as report it. Here the observation comes from the engine
(which holds a connection because it must serve traffic, and whose audit runs
under the SAME read-only, GUC'd contract as its money path), the judgement
comes from the core law inside it, and this file only moves bytes and appends
them.

`print-sql` prints the executor's SQL by parsing the shipped Python module, so
the DBA-facing copy of the truth has no second copy to rot: a test asserts the
set of names rendered equals the set of `*_SQL` constants in the file, and
that every rendered statement is a `SELECT` (or `SET TRANSACTION READ ONLY`).

`--record` writes evidence by shelling out to the manifest CLI's
`--record-rls`. It does not open the ledger itself. One writer means one set of
shape rules (closed grade vocabulary, single-line fields, secret scan,
refusal-to-append-to-a-corrupt-file) rather than a copy that drifts - and a
recording failure changes nothing about the finding: `audit` still prints the
verdict, and only downgrades a would-be `0` to `2` when the evidence could not
be filed, because "not isolated" and "we cannot prove whether it is" are
different sentences and the exit code must keep them apart.

`check` delegates to `node scripts/dr-manifest.mjs --check-rls`. The
verification command and the freshness policy are in different files on
purpose: one needs an engine and a token, the other needs nothing but a
repository, which is what makes the second one runnable from CI on every
commit.


## 6. The evidence ledger and its freshness policy

`docs/dr/rls-evidence.jsonl`, one line per audit, appended by

```
node scripts/dr-manifest.mjs --record-rls --grade pass|fail|unverified
                             [--probed N] [--role NAME] [--note TEXT] [--at ISO]
```

and graded by `--check-rls`:

```
[ ok  ] rls-enablement: fresh, next due in 6d 23h [pass] 2026-09-14T06:00:00.000Z (6h ago)
[DUE  ] rls-enablement: last passing audit overdue by 9d 6h [pass] ...
[FAIL] rls-enablement: [fail] 2026-09-20T06:00:00.000Z (6h ago) - the recorded audit
        did not conclude "pass", so the platform must not claim enabled-and-enforced
```

The rules, all inherited from Part 12's backup ledger because that ledger's
discipline is already understood: append-only, unknown fields are a problem
("typos hide evidence"), an unparsable line is reported by NUMBER, a corrupt
ledger makes both commands REFUSE rather than grade the fleet on unreadable
evidence, and any secret-shaped content in the file (or in the note about to
be written) is an exit-1 refusal. Evidence describes what was verified, never
what was used to verify it.

Three decisions specific to Part 15:

* **No new table.** The engine side of this part writes nothing to the
  database at all; where a durable record of the *audit object* is wanted,
  `EVIDENCE_LEDGER_TABLE` names Part 14's `engine_retention_runs`, whose
  columns (`dry_run`, `rows_deleted`, `batches`, `exhausted`) are
  reinterpreted in place. The alternative - an `engine_enablement_runs` table
  for a part whose verb is "look" - means a new thing to migrate, to cover
  with RLS, and to forget to prune. The pinning test asserts the reuse rather
  than trusting the comment, and a rename to something more "honest" now
  costs a part boundary. (The route does not write there; the record lives in
  git, which is where a deployment's own security evidence belongs.)
* **Last-entry-of-any-grade ages the clock; last-entry's GRADE decides the
  verdict.** Re-running the audit and finding a leak must not resurrect a
  stale pass, and it must not be erased as "not evidence". A fresh FAIL is
  therefore an alarm, not a gap in the record: `--check-rls` exits 1 and says
  the platform may not claim enabled-and-enforced. A deployment that wants
  the alarm to STOP has exactly one honest option - fix the isolation and
  re-audit.
* **`cadenceHours` is capped at 8760 and `requiredGrade` is not a knob.** The
  validator accepts only `"pass"`, rejecting `fail`, `unverified`, `warning`,
  `true` and `0`: a manifest that lets a report choose its own bar is not a
  bar. A cadence larger than a year is refused as "a way of writing never",
  which is the same reasoning that caps the review cadence elsewhere in the
  manifest.

The manifest also declares **scope**, and the validator refuses an
overclaim:

> The engine endpoint verifies the engine plane only (`engine_orders`,
> `engine_order_events`, `engine_order_fills`, `engine_retention_runs`). The
> platform's other covered tables are audited by the operator-side checklist
> in `apps/api/prisma/rls/enable.sql`, which this manifest's cadence also
> ages.

That paragraph is checked in both directions: the manifest may not name
phrases like "all tables", and the engine test suite asserts that every entry
in `PROBE_TABLES` is named in it. A future change that quietly grows the probe
set while the assurance still says "engine plane only" goes red in one of the
two suites, whichever runs first.


## 7. Drift parity: what the tests actually verify

`services/execution-engine/tests/test_part15_drift_parity.py` re-derives
every claim the audit makes from artifacts three different steps produced:

| pinned | against |
| --- | --- |
| `PROBE_TABLES` | the `engine_*` subset of `enable.sql`'s own ALTER statements - not from a shared constant |
| policy existence | every covered table has `CREATE POLICY tenant_isolation` with `USING`/`WITH CHECK` = `tenant_id = wlct_current_tenant_id()` in the Part 11 migration |
| `ENABLE`/`FORCE` pairing | the two lists in `enable.sql` are identical, 43 entries, and `disable.sql` is exactly their inverse (`NO FORCE`, `DISABLE`) |
| policy name and GUC name | `rls_coverage.json`'s `policyName`/`functionName`, `TENANT_GUC`, and the literal `set_config('app.tenant_id', ...)` in `prisma.service.ts` |
| the tenant function's shape | `RETURNS uuid`, `LANGUAGE sql STABLE`, `nullif(current_setting('app.tenant_id', true), '')` - i.e. still fail-closed |
| the exclusion list | the migration's "Excluded by design" comment == `PLATFORM_SCOPED_TABLES` == the manifest's `excluded` entries |
| the two count statements | they differ by exactly `WHERE tenant_id = $1`, parse with sqlglot, and the bare one has no bind parameter |
| the executor's write-lessness | every SQL-shaped string constant in `rls_probe.py` and `routers/enablement.py` (from the AST) is a `SELECT` or the read-only flag; the router holds none at all |
| the manifest's pointer | `rlsEvidence.verifier` is this router's actual path; the ledger path is the one the CLI writes; the named script exists; the cadence is no looser than the service's own default window |

The core suite adds the other half: `PLATFORM_SCOPED_TABLES` re-derived from
`rls_coverage.json`, the `TENANT_GUC`/ledger-name constants, and the
purity/no-write scans on the law itself. The CLI's node suite pins the
validator's refusals, the ledger's shape rules, the report's freshness
asymmetry, and `print-sql` against the module it documents.

What is NOT verified, in the same font as what is: nothing here reads a real
Postgres in CI. The SQL is parsed (sqlglot) and shape-checked, the catalogue
semantics are modelled by a fake that answers by matching statement text, and
the one behavioural claim that cannot be made honestly in a unit test - "a
`42501` on the bare read really is what FORCE returns" - is exercised only
against a live staging database, per §9. That is stated rather than hidden
because a verification tool that overstates its own verification is the exact
failure Part 15 exists to eliminate.


## 8. Runbook: enablement day, then every week after

1. **Before enabling.** Run the generator and apply the migration as Part 11
   documents; work `enable.sql`'s checklist. The engine endpoint cannot be
   used here - it audits tables that exist, which is after step 2.
2. **Right after enabling.** `node scripts/rls-enablement.mjs audit
   --base-url ... --token ... --tenant <probe-tenant> --seed
   engine_orders=3,... --covered-expected 43 --record`. Expect
   `enginePlaneComplete: true`; expect `fullPlatform: false` unless the
   operator-side checklist covered the other 38 tables. A `fail` here is a
   security finding, not a lint: `disable.sql` is the rollback and the
   note in the ledger line says which table leaked.
3. **Then weekly** (the cadence the manifest declares): re-run `audit
   --record` after any migration that creates, recreates or renames a
   tenant-bearing table, and after any role or grant change. The engine's
   own tables change on exactly those days; so does everything else.
4. **Continuously, from CI or cron:** `node scripts/rls-enablement.mjs
   check` (i.e. `dr-manifest.mjs --check-rls`). Exit 1 = overdue, missing,
   unreadable, or the last audit did not pass. The scheduler wiring is still
   an open item (same status as `--due`'s); what is NOT open is what it
   checks.
5. **On a `fail` grade:** treat it as an isolation incident. Confirm with
   psql using `print-sql`'s output (six statements, all reads, no ceremony);
   `disable.sql` if a table must go dark; the fix is in the migration or the
   grant, never in the ledger. Re-audit before resuming the claim.

`--check-rls` green is a prerequisite for anything that DEPENDS on
isolation - Part 14's first apply included: a prune against a database whose
policies are believed-but-unverified is a deletion whose blast radius is
assumed. §10 move 1 of `docs/PART14_RETENTION.md` now reads "both checks
green before the first apply" (fresh `postgres` backup from Part 12's ledger,
fresh enablement audit from this part's), and the ordering is the whole point:
delete nothing on a database you cannot prove is partitioned.


## 9. Test law, with its limits named

The 48 core tests grade the law directly (boundaries inclusive-by-design, the
role veto reaching per-table grades, `unverified` for every incomplete run,
duplicates refused, JSON-readiness of the summary). The 38 engine tests pin
the executor's conversation: statement-per-statement, which connection said
it, in which transaction, with which bind parameters; the absent-table path
that must not bare-count; the `42501` swallow narrowed by SQLSTATE; the
propagation that keeps a broken cluster ungraded; `ProbeRoleUnknown` refusing
BEFORE touching the tables it would have graded; the non-canonical tenant
UUID that never reaches the database; the 400/409/422/503 shapes; and
`seedCounts` refusals measured as "zero statements on either connection".

The fakes answer by MATCHING statement text, not by replaying a script, and
each pool is single-use: a fake that answered every query would happily let
the executor read tenant-filtered numbers on the unfiltered side - the exact
bug this split exists to catch. The `bare` connection's script and the
`scoped` connection's script are disjoint on purpose, and the pool raises if a
run borrows more than one bare session, so "one unfiltered session per audit"
is a fact the fakes enforce rather than a sentence in this file.


## 10. Decisions, each with its rejected alternative nearby

| decision | rejected alternative, and why |
| --- | --- |
| verification is an operation with a cadence | a boot-time check that refuses startup: a defence layer's staleness becomes an outage, inverting Part 11's whole "enable at low traffic, with a checklist" judgement |
| FAIL is HTTP 200 with the finding in the body | HTTP 500: evidence under a transport error, broken `curl` CI, and pressure to make the probe "tolerant" |
| no apply feature flag on a read-only route | `EXECUTION_ENABLEMENT_ENABLED`: theatre for a SELECT, and theatre still needs a default, docs and tests |
| read-only, never seeding | the textbook insert/read/delete probe: it would make "read-only" false and put a write path on a process that owns money rows, requiring its own audit |
| engine audits only its own 5 tables, and says so | claiming the platform's 43: the API plane's tables are not this service's to name, and a partial audit with a full-platform verdict is the loudest possible lie |
| evidence in git (`docs/dr/*.jsonl`), not a DB table | `engine_enablement_runs`: a new table to migrate, cover with RLS, and forget to prune - for a part that must not write |
| reuse Part 14's ledger constant for the durable name | a new constant: two names for one table is drift waiting to happen, and the reuse is pinned by test so it stays a decision |
| one writer of the evidence ledger (`dr-manifest`) | a second implementation inside `rls-enablement.mjs`: a copy of a policy that drifts, and the copy operators follow when the first is inconvenient |
| `seedCounts` optional, unknown-seed mode legal | requiring exact seeds: the audit would then be unusable before a probe tenant is prepared, which is precisely when enablement day needs it |
| `42501` on the bare read recorded as zero | "treat any error as pass" (launders an outage into a green check) and "treat any error as fail" (makes a correctly locked-down cluster look broken; the leak count IS the evidence). Both extremes are worse than the narrow swallow |
| `unverified` as a third run grade | collapsing it into `pass` (silence) or `fail` (crying wolf until people read `fail` as noise) |


## 11. What this part does NOT do

* It does not enable, disable or alter anything, and no migration ships with
  it. `enable.sql`/`disable.sql` remain the only files that change RLS state,
  and they are unchanged here.
* It does not cover the API plane's 38 other tables from the endpoint. That is
  the operator's checklist against the same manifest; `--covered-expected`
  exists so a partial run cannot be misread as a complete one.
* It does not schedule. `--check-rls` is a cron-able exit code, and wiring it
  into a scheduler is the same open item as `--due`'s (docs/DR.md: "what is
  not yet automated, plainly"). SUPERSEDED BY PART 20 for the wiring half only:
  `--check-rls` is now a derived job line in `docs/dr/schedule/dr.cron` at the
  manifest's RLS cadence, drift-gated by `--check-schedule`, and the open item in
  DR.md is reduced to installing that file plus the first real `--record-rls`.
  The scheduling was never the audit - the sentence above still holds about what
  Part 15 itself did, which was to make the check exist and be honest.
* It does not enforce at request time. No route consults the evidence ledger
  to decide whether to serve traffic; a deployment that wants hard gating
  should build it on top of `--check-rls`, which is now a well-defined
  predicate rather than a vibe.
* It does not prove isolation from unit tests against a fake Postgres. The
  catalogue semantics are modelled, the SQL is parsed, the shapes are
  re-derived - and the live confirmation is step 2 of §8, on staging, with a
  probe tenant.
* It does not add metrics or dashboards. The log line
  (`enablement.audit`, with grade/role/probed count, no row contents) is the
  only new signal; a RED panel over the audit cadence would be honest but is
  not in this part.


## 12. Cross-references

* `docs/ROADMAP.md` - Part 15 row; "RLS staging enablement" is now
  "verification of", with the enablement itself still an operator step.
* `docs/SECURITY.md` - the defence-in-depth list gains the audit surface and
  the "verified, not believed" claim, with its limits.
* `docs/DR.md` - `rlsEvidence` in the manifest, the second ledger, and the
  new prerequisite for Part 14's first apply.
* `docs/PART11_WORKER_SCALING.md` - the policies, the GUC, the checklist;
  unchanged and still the only thing that alters RLS state.
* `docs/PART13_DURABLE_STORE.md` - `_TenantTransaction`, the canonical-UUID
  guard and the literal-SQL law this executor inherits verbatim.
* `docs/PART14_RETENTION.md` - the ledger this part reuses, the feature-flag
  contrast in §4, and the runbook move this part now precedes.
* `libs/trading-core/tests/test_part15_enablement.py`,
  `services/execution-engine/tests/test_part15_enablement.py`,
  `services/execution-engine/tests/test_part15_drift_parity.py`,
  `scripts/dr-manifest.test.mjs` - the law, the surface, the drift traps, the
  ledger.
