# Part 21 - the operating half: schedule installation, DR rehearsal, chaos matrix, RED

Predecessors that matter to this document: Part 12 (the backup ledger and `--due`,
`docs/DR.md`), Part 15 (RLS enablement evidence, `docs/PART15_RLS_ENABLEMENT.md`), Part 18
(metrics exposition, `docs/PART18_METRICS_EXPOSITION.md`), Part 19 (live enablement and the
refusal-by-default convention, `docs/PART19_LIVE_ENABLEMENT.md`), Part 20 (the generated schedule
and the engine's status edge, `docs/PART20_ENGINE_STATUS_EDGE.md`). Part 20 ended with a list of
things it deliberately did not do. This part is that list, taken in order, with nothing rebuilt.

Every number, output and exit code quoted below was measured in this tree at
2026-09-18T04:39Z by running the command shown. Where a claim could not be measured here, the
sentence says so instead of approximating.

## 1. The audit, before any code

The instruction was to inspect first and not duplicate Part 20. What the audit found, with the
evidence that settled each question:

* `scripts/dr-manifest.mjs` (1,321 lines at the time) already exports the whole rule set -
  `validateManifest`, `scheduleDrift`, `renderSchedule`, `parseLedger`, `dueReport`,
  `parseRlsLedger`, `rlsEvidenceReport`, `findSecretShapes`, `collectEnvNames`, `renderPlan`. The
  schedule generator was **not** rewritten; the installer imports `scheduleDrift` and the rehearsal
  runner imports `dueReport`/`parseLedger`/`validateManifest`. A copy of a rule inside a new tool is a
  second source of truth wearing a validation costume.
* `scripts/rls-enablement.mjs` already answers the live question (`audit --json`, grades
  pass/fail/unverified, exit 0/1/2, `--record` delegating to `--record-rls`). So the RLS gap was not
  a verifier; it was a *repository-side* verifier. That became `--verify-rls` (sec. 7), and
  `enable.sql` / `disable.sql` were not touched at all.
* `infrastructure/` contains `docker/` (six Dockerfiles, all with `HEALTHCHECK`) and `database/`. There
  is no `infrastructure/observability/`, no dashboard file, no systemd unit, and the only cron file in
  the tree is the artifact Part 20 generated. So "dashboards and alert rules live in the deployment"
  was an unimplemented roadmap row, not something to re-wire.
* The core has `wlct_trading/observability/faults.py`, whose docstring states that anything broader
  than its ten fault points "is chaos engineering, which this repository's roadmap explicitly still
  lists as open work; calling this file 'chaos' would be marketing". That sentence is the reason the
  matrix in sec. 5 draws only from `FAULT_POINTS` and grades `UNVERIFIED` by default.
* `wlct_trading/observability/dashboard.py` is the repository's dashboard format: ten fixed sections
  of `{label, value, detail, tone}` rows, and "adding a section is a spec change, not a feature". So
  RED is a producer of rows in that format (sec. 6), not a second document type, and no section was
  added.
* `ALERT_RULES` entries carry a prose `condition` and `threshold: float | None`. There is therefore no
  rule file to derive without inventing numbers; sec. 8 records that as intentionally not added.
* `libs/trading-core/tests/test_observability_boundaries.py` scans every module in the package for
  suppression tokens and for ambient I/O. That is why sec. 5 and sec. 6 modules import no clock, no
  socket and no subprocess, and why they carry no inline suppression comment.

Part 20's shipped surface was left alone on purpose: no second status mirror, no change to
`engine-status-contract.ts`, `engine-posture.service.ts`, `require_internal_auth_readonly`,
`--emit-schedule`, `--check-schedule`, or the live-enablement refusals.

## 2. `scripts/dr-schedule-install.mjs` - the installation layer (701 lines)

The gap Part 20 recorded as "installing the file is a host act" has a middle that was checkable by
nobody: between a correct artifact and a host that runs it, an operator who installed the schedule
could not prove it a week later, and an operator who had not had nothing to fail.

Six laws, each with a reason:

1. **Verify before trusting.** Every path runs `scheduleDrift` from `dr-manifest.mjs` against the
   file on disk and refuses on any finding.
2. **Installation never generates.** A missing artifact is a refusal naming `--emit-schedule`; the
   installer writes the bytes it read. There is no code path in this file that produces a schedule.
3. **A host crontab is somebody else's file too.** A `# BEGIN/END wlct-dr-schedule` block is managed;
   everything outside it survives byte for byte (a test asserts a foreign `0 4 * * 0 /usr/local/bin/dba.sh`
   line and a comment containing `--due` come back unchanged). The markers are not a flag: a
   configurable marker lets one install orphan another's.
4. **Ledger-writing jobs cannot be installed.** The generator already refuses `--record`, and the
   installer re-checks independently, because it is the last component to touch the bytes before a
   machine runs them unattended. The manifest carries no "this write is safe unattended" mark, so the
   refusal is unconditional - if such a key is ever added, the code that reads it is the code that has
   to argue for it.
5. **argv allowlist, no shell.** One binary name in a `Set`, `shell: false`, a timeout per call, and
   the child gets `PATH`, `HOME` and `LC_ALL` only. A test pins the source shape: one `spawn(` call
   site, no `exec`, no `shell: true`, no caller-supplied string reaching `RegExp`.
6. **Test doubles stay doubles.** `MemoryHost` is exported for tests and cannot be named by `--host`;
   asking for it is a refusal. No invocation of this tool can report an install that only happened in
   a unit test.

The one design change the tests forced: install and uninstall re-read the host afterwards and
verify. A first version trusted the exit code, and a fake `crontab` that exited 0 while its own `cat`
was missing from a stripped `PATH` produced a "successful install" of an empty table. That is the
exact class of green this repository refuses, so `--install` now fails with `the host accepted the
write but the installed schedule does not verify` (exit 2) unless the block is found on re-read, and
a test named for that incident asserts it.

Exit codes: 0 ok, 1 not installed, 2 drift or unverified install, 3 refused, 4 no cron facility.
Measured on a host with no `crontab`:

```
$ node scripts/dr-schedule-install.mjs --check      # exit 1
schedule not-installed: no managed block in the host table; run --install (expected sha256 d15556e03403…)
$ node scripts/dr-schedule-install.mjs --install    # exit 4, this host
dr-schedule-install: refusing to install: this host has no cron facility (the `crontab` binary is not on PATH). …
```

Tests: 26 (`scripts/dr-schedule-install.test.mjs`, 511 lines), including a full
install → check → hand-edit → check (drift) → uninstall cycle driven through a real child process
against a fake `crontab` on a temporary `PATH`, so the argv and stdin plumbing is executed rather
than described.

## 3. `scripts/dr-rehearsal.mjs` - the rehearsal runner (1,266 lines)

The manifest validator proves the plan is well-formed; nothing proved it had ever been *walked*. This
generates the drill record as data.

The plan is built from `restoreProcedure` (the document an operator follows) rather than from
`restoreOrder`, and both are then compared - step numbering, one step per component, no duplicates,
no component without a step, and `step` equal to the component's `restoreOrder`. Component-less steps
are the manifest's existing convention for post-restore instructions ("start the worker and confirm
claims", "write the record down"), and they appear in the plan as `PROCEDURAL` steps with one
`unverified` check each, because nothing in this repository can observe them.

Per component, in restore order: declared `paths` are resolved inside the repository (traversal is a
`FAIL` finding, not an attempt) and reported present/missing; every `envRefs` name is checked against
the `.env.example` templates (`FAIL` if the manifest references a name no template declares) and
against the process environment for *presence only*; `verification` and `backupMethod` prose is
carried as an operator obligation graded `UNVERIFIED`. Dependency law is data, not advice: if the key
material's checks fail, every later step is marked `blockedBy: encryption-keys`, following the
manifest's own "stop on any mismatch".

Execution is a closed allowlist of four probes - `manifest-valid`, `schedule-current`,
`schedule-installed`, `rls-audit` - each an argv array, each graded from its exit code, none
reachable from a manifest field or a flag. `rls-audit` is the interesting one: the engine probe exits
2 when it cannot reach a database, and exit 2 grades `UNVERIFIED`, not `PASS` and not `FAIL`.

Refusals, all before any work: `--target production` and `prod`; any target outside the closed
non-production set (`local`, `dev`, `test`, `ci`, `staging`) - "an ambiguous selection is a refusal,
not a warning"; `NODE_ENV=production` regardless of target; `--execute` against a target declared
non-destructive (`ci`); `--execute` without `--confirm <rehearsalId>`, where the id is the digest of
the canonical plan, so the confirmation cannot be copy-pasted onto a different plan or set once in a
shell profile; an invalid manifest (there is no plan to rehearse); paths outside the repository;
unknown flags and flag combinations.

Evidence is appended **only** with `--emit-evidence`, in either mode. The alternative - writing on
every `--execute` - sounds safer and is not: it lets an ad-hoc probe in a scratch environment age the
drill board, and it makes this tool untestable without appending to a ledger. An executed run without
a record gets a sentence on stderr saying so, because an executed restore with no record is what
`docs/DR.md` calls a hope.

Measured, on a fresh checkout (exit 0 for the dry run; exit 3 is a refusal; `--due` is exit 1):

```
$ node scripts/dr-rehearsal.mjs --target local
DR rehearsal b6ab414dfbbb237f - PLANNED (dry-run)
  restore order: encryption-keys -> postgres -> deployment-config -> redis -> dataset-objects
  RPO declared 60 min; RTO declared 4 h; observed RTO UNVERIFIED (no timed restore behind this record)
  …
$ node scripts/dr-rehearsal.mjs --due
[DUE] drill: never rehearsed (cadence 90d) - run this tool; a plan with no rehearsal is the state the DR document calls a hope   # exit 1
```

An executed rehearsal in this sandbox grades the probes it could run and admits the rest:

```
$ node scripts/dr-rehearsal.mjs --target staging --execute --confirm <id> --json
manifest-valid pass · schedule-current pass · schedule-installed unverified (no cron facility, exit 4) · rls-audit unverified (no database, exit 2)
grade: pass   # pass = "the checks that could run passed", with rtoObservedHours: null and 5 rpo warnings
```

That last line deserves care, because it is the place where an honest tool looks least honest. The
overall grade is `pass` while three of five components have no backup evidence, and that is correct:
`pass` covers what the run executed, the `warnings` list carries every unverified check by name, and
`--status` (sec. 4) reports the board red for the same reason. A grade that averaged the two would
hide the absence behind the presence.

## 4. The evidence document

One line per rehearsal in `docs/dr/rehearsals.jsonl`, fields in the order a reviewer asks for them:
`rehearsalId`, `generatedAt`/`startedAt`/`completedAt`, `mode` (`dry-run`/`execute`), `grade`,
`environment` (target, `nodeEnv`, non-production flag), `toolVersion`, `operator` (a reference
string, truncated at 64 chars, never a credential), `manifest{path,sha256}`, `plan{sha256, order,
dependencyBlocked, componentCount}`, `slo{rpoMinutes, rtoHours, rtoObservedHours, rpoEvidence[]}`,
`timing.runnerElapsedMs`, `steps[]` (order, component, kind, executor, grade, blockedBy, per-check
grades with details), `probes[]` (argv, exit status, grade, output digest - not output text),
`criteria[]`, `failedChecks[]`, `warnings[]`, `artifacts{schedule, scheduleFindings, manifestErrors,
drLedger, ledgerProblems, rehearsalLedger}`.

Three properties are enforced rather than described, each with a test:

* **`PLANNED` is not success.** `parseRehearsals` refuses to read a line with `mode: "dry-run"` and
  `grade: "pass"` ("a dry run cannot be recorded as pass"), and `gradeRehearsal` returns `planned`
  whenever nothing ran - so the writer cannot produce that line either.
* **Elapsed time is never a restore time.** `rtoObservedHours` is `null` in every record this version
  can write, and a test asserts that no probe in the allowlist can make it non-null. `runnerElapsedMs`
  sits beside it, labelled as what it is.
* **No secrets, no probe output.** `findSecretShapes` runs over the exact line before the append and a
  hit is a refusal; probe stdout is stored as a digest. A test crafts a manifest whose success
  criteria contain a `DB_PASSWORD=…` string and asserts both the refusal (exit 3) and that no ledger
  file was created.

`docs/DR.md` gained the installation/rehearsal section describing these commands, with the measured
output above pasted from the runs; the drill-record table stays the human artifact it was, because the
judgement in it ("we restored the real dataset, not a toy one") is not something a runner can grant.

## 5. `wlct_trading.observability.chaos` - the failover matrix (598 lines + 366 test lines)

Ten scenarios, A-J, in drill order, each a frozen dataclass with: `requires` (names from a closed
infrastructure vocabulary), `fault_points` (validated as a subset of `FAULT_POINTS` - the injection
universe stays closed and the matrix cannot smuggle in a new lever), `setup`, `injection`,
`expected_invariant`, `observation`, `recovery`, `cleanup`, and a `timeout_seconds` bounded to 5..900.
The invariants are the runbook's own sentences (Part 11 sec. 12/18, Part 12's membership staleness,
Part 13's durable store and ack policy), so a staging run checks what the repository already
committed to rather than a fresh invention.

`run_matrix(injector=…, availability=…, environment=…, generated_at=…, checks=…)` grades: unavailable
requirement → `unverified`; requirement present, no check supplied → `planned`; a harness check →
`pass`/`fail` **with `source: "harness"` recorded on the outcome**; a check that raises → `fail` with
the exception text (a probe that raises has found something), except `ChaosRefusedError`, which
propagates because a refusal is not a result. The module sleeps, threads, spawns and connects to
nothing - the timeouts it reports are declarations for whoever owns the process, and a test asserts
the absence of the imports that would make it a source of flake. Production and every unnamed
environment are refused before a probe is read, as is an availability name or a check key the matrix
does not declare.

```
$ PYTHONPATH=libs/trading-core python3 -m wlct_trading.observability.chaos --environment local   # exit 2
chaos matrix wlct_trading.observability.chaos/1 - UNVERIFIED - environment local (not-supplied, injector off)
[UNVER] exchange_outage          none    required infrastructure not available: exchange
[UNVER] redis_failover           none    required infrastructure not available: redis_cluster, redis_primary
…
grades: unverified=10 - an absent dependency is unverified by law, never pass
```

`--at` exists because the module imports no clock: a run without one is stamped `not-supplied` rather
than being given a plausible time. 22 tests, including a real `subprocess.run` of the module's CLI and
a tree walk asserting that no module outside `observability/` mentions the matrix at all.

## 6. `wlct_trading.observability.red` - RED as a view (402 lines + 247 test lines)

Rate, errors, duration - derived from the families the services already register
(`wlct_risk_decisions_total{result}`, `wlct_risk_decision_micros`, `wlct_market_poll_cycles_total`,
`wlct_market_quotes_updated_total`), read from `ObservabilityRegistry.snapshot()`, emitted as
`DashboardRow`s so the existing dashboard document renders them without a new section.

Five states, and the distinction is the deliverable: `no-data` (the family is not registered),
`zero-traffic` (registered, counts zero), `measured` (traffic, no budget supplied, **no verdict
offered**), `healthy` and `over-budget` (judged against a caller-supplied budget). `unavailable`
deliberately does not exist here: if metrics cannot be read there is no snapshot, and a module inside
the metrics path inventing a "metrics are down" row would be reporting on itself - the health model
already carries that (`wlct_component_health`, `metrics_export_unavailable`).

`RedBudget` requires a non-empty `source` string naming where its threshold came from (the SLO
catalog or the alert rule set), and `RedSurface` requires `error_values` as the service's own label
set, because a RED view that decided "error" by pattern-matching verdict names would silently redefine
an incident whenever a service added a verdict. There is no default budget in the file: the
no-invented-thresholds instruction is satisfied structurally, and a test asserts that supplying
budgets for an absent surface is refused while omitting them yields `measured`, not green.

Rows aggregate over label sets unconditionally; a test puts `tenant_id`, `account_id`, `order_id` and
`symbol` values into the snapshot series and asserts none appears in the document. One row is
deliberately modest: duration reports a labelled mean over recorded observations and its `detail`
says a histogram mean is not a percentile, because this view does not read buckets.

No service's section content changed. Wiring RED rows into `market-data` and `trading-engine` is the
next deployment-side step and is listed in sec. 8 - their dashboard row sets are pinned by their own
tests, and editing a service's pinned output to add a section I was not asked to redesign is the
kind of quiet behaviour change this part's brief rules out.

## 7. `--verify-rls` - repository-side verification, no claim

`node scripts/dr-manifest.mjs --verify-rls [--json]` checks what the repository can actually know
about row-level security: that the three artifacts exist; that the coverage ledger and `enable.sql`
agree **in both directions** (a table in one and not the other is a `FAIL` with both lists named);
that every enabled table can also be disabled, because an unrollbackable enable is a one-way door;
that all three carry the same schema stamp; that the policy and function names the manifest declares
appear in the script; and what the evidence ledger says about the last audit.

```
$ node scripts/dr-manifest.mjs --verify-rls      # exit 3 = unverified
[ok  ] artifact:coverageArtifact    apps/api/prisma/rls/rls_coverage.json present (211 lines)
[ok  ] coverage-parses              43 covered table(s), 7 excluded
[ok  ] scope:enable-vs-coverage     43 table(s) in enable.sql and in the coverage artifact, in both directions
[ok  ] scope:enable-vs-disable      43 table(s) can be enabled and 43 disabled - the rollback is exactly as wide as the change
[ok  ] schema-stamp                 all three artifacts carry stamp 20260913120000
[UNVER] evidence-ledger              [DUE  ] rls-enablement: never recorded (cadence 168h) - run the audit and record it with --record-rls; policies that nobody verified are a hypothesis
rls verification: UNVERIFIED - 7/8 checks pass; not asserted here: …
```

Two guard rails against the failure mode of a scope checker: an empty-on-both-sides comparison grades
`unverified`, never a pass ("refusing to read an empty scope as a pass"), because a regex that matched
nothing would otherwise look clean forever - which is exactly what happened to the first version of
this scan, whose pattern was mangled by an escaping layer and reported `0 table(s)`, and whose "0 vs
0" case still would not have failed. A test now pins the count to 43 on the shipped repository. And
the document carries `"enabled": null` plus a fixed `assertion` string stating that this verifier made
no enablement claim; `enable.sql`, `disable.sql` and the live `docs/PART15_RLS_ENABLEMENT.md` path are
unchanged, and no test marks RLS enabled.

`--verify-rls` also fixed a parser trap that was latent in this file since Part 15: `--json` had to be
registered as a boolean flag, because the parser treats every unrecognised `--x` as value-taking, and
`--verify-rls --json` alone would otherwise have eaten the next argument. A test asserts the shape.

## 8. What stays operator-only, and what was intentionally not built

Open, by choice, in the repository's own style:

* **The restore.** The runner never provisions a database, replays a dump or touches a replica; a
  rehearsal grades its own probes and marks the destructive steps `PLANNED`/`OPERATOR`. An arm-the-
  restore endpoint would be a money-path lever in an operational tool, and the failure-injection
  surface stays the closed set it is (no shell-over-HTTP anywhere in this part).
* **The real failover drill.** The matrix specifies and grades; it cannot reach a process. Every
  `PASS` it can currently produce is labelled `source=harness`, and no run in this tree prints a
  pass at all.
* **Grafana files, and alert rules that this tree cannot answer.** No Grafana format exists here to
  extend (the format that does exist is the section/row document, and RED writes it), and paging
  thresholds stay where they were: the SLO definitions and the alert catalog, both already shipped.
  The Prometheus half of this bullet was overtaken by Part 22, which shipped `infrastructure/
  observability/` as a generated bundle: 4 of the 24 catalog rules rendered, and the 17 that carry
  `threshold: None` still refuse to - the fabricated-number objection was the right objection, and the
  answer was to derive only what already has a number rather than to write the rest (see
  docs/PART22_SCRAPE_SIDE.md).
* **Service-side RED rows.** The view exists and is tested against a live registry; the two services'
  dashboard row sets are pinned by their own tests and were left alone rather than re-pinned here.
* **A second status endpoint.** The scheduler/rehearsal/RLS answers are CLI documents because the API
  runtime image copies `node_modules`, `packages`, `apps/api/dist` and `apps/api/prisma` only - no
  `docs/` - so a panel cannot read `docs/dr/rehearsals.jsonl` in production. The image inventory was
  read to confirm this before deciding, rather than assumed. A future machine-readable surface would
  need an operator-supplied path or an API-side reader, which is a deployment decision, not a report.
* **Nothing new in the ledger's write path.** The schedule refuses `--record`/`--record-rls`, the
  installer refuses them again independently, and the rehearsal ledger's `--due` ages a rehearsal
  without ever recording one on an operator's behalf.

The manifest defect from sec. 3's ordering law is the part worth reading twice: `docs/dr/manifest.json`
has shipped since Part 11 with `restoreProcedure` and `restoreOrder` disagreeing about three of five
components, each representation individually valid and each validated on its own. The rehearsal
runner's first run failed on it. The data was corrected to follow the procedure, `--check` refuses the
disagreement now, and both directions are tested (a gapped order, a missing step, a duplicated
component, and the exact historical mismatch).

## 9. Gates

| Gate | Result |
| --- | --- |
| `node --test scripts/` | 133 passed (63 `dr-manifest`, 26 `dr-schedule-install`, 33 `dr-rehearsal`, 11 `retention-run`) |
| `node scripts/dr-manifest.mjs --check` / `--check-schedule` / `--check-rls` | 0 / 0 / 1 (RLS never recorded, the correct steady state) |
| core `python3 -m pytest -q` | 1696 passed (was 1656; +40 = 34 tests in Part 21's two files + 6 cases the boundary sweep derives from modules on disk) |
| core `ruff check wlct_trading tests` | clean |
| core `mypy wlct_trading` | clean, 152 files (150 before, +chaos.py +red.py) |
| API `tsc --noEmit`, `eslint`, `jest` | measured after this section was written; see the Part 21 handover header |
| engine `pytest` / `ruff` / `mypy app` | measured after this section was written; see the Part 21 handover header |
| handover `--check`, all six parts | green - but only after one fix: the header quotes `dr-rehearsal.mjs --status`, which prints the instant it read, so the first check compared 12,058 identical lines against a document differing only in a timestamp and reported STALE. The generator now passes `--at 2026-09-18T00:00:00Z` to that one gate. Pinned inputs are part of a reproducible document, and a tool that reports a clock honestly is not at fault for doing so |

Money-path safety, since this part touches operations: `apps/api` and `services/execution-engine`
gates are run unchanged, no placement, risk, order or credential file was edited, and the two new
core modules are asserted - by a tree walk in a test, not in prose - to be unreferenced outside
`observability/`. `EXECUTION_MODE=live` still refuses at startup, untouched by this part; the
rehearsal runner's production refusal is the same convention applied to a drill, and one of its tests
runs `--target production` and asserts exit 3.
